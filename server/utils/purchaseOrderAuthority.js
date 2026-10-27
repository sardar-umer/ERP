/**
 * Shared PO / procurement authority slot logic (mirrors procurement approve route).
 *
 * Sr Manager Procurement was added 2026-10-02. Documents created before that date
 * must not require / match that slot (even if the field was backfilled).
 */

const Indent = require('../models/general/Indent');

/** Inclusive: POs created on/after this instant may use Sr Manager Procurement. */
const SR_MANAGER_PROCUREMENT_EFFECTIVE_AT = new Date('2026-10-02T00:00:00+05:00');

const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const tokenMatchesAuthorityText = (token, authorityText) => {
  const normalizedToken = normalizeToken(token);
  const normalizedAuthorityText = normalizeToken(authorityText);
  if (!normalizedToken || !normalizedAuthorityText) return false;
  return normalizedAuthorityText === normalizedToken
    || normalizedAuthorityText.includes(normalizedToken)
    || normalizedToken.includes(normalizedAuthorityText);
};

const AUTHORITY_SLOT_CONFIG = [
  { key: 'preparedBy', label: 'Prepared By', indentUserField: 'preparedByUser' },
  { key: 'managerProcurement', label: 'Manager Procurement', indentUserField: 'managerProcurementUser' },
  { key: 'srManagerProcurement', label: 'Sr Manager Procurement', indentUserField: '' },
  { key: 'chiefOperatingOfficer', label: 'Chief operating officer', indentUserField: '' },
  { key: 'avpTaj', label: 'AVP Taj', indentUserField: '' },
  { key: 'technicalDepartment', label: 'Technical Department', indentUserField: '' },
  { key: 'verifiedBy', label: 'Chief operating officer', indentUserField: '' },
  { key: 'authorisedRep', label: 'AVP Taj', indentUserField: '' },
  { key: 'financeRep', label: 'Finance Rep.', indentUserField: 'financeRepUser' }
];

const isSrManagerProcurementApplicable = (createdAt) => {
  if (!createdAt) return false;
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return created >= SR_MANAGER_PROCUREMENT_EFFECTIVE_AT;
};

/**
 * Strip Sr Manager from authority text for pre-cutoff (legacy) documents.
 */
const sanitizeApprovalAuthorities = (approvalAuthorities, createdAt) => {
  const authorities = { ...(approvalAuthorities || {}) };
  if (!isSrManagerProcurementApplicable(createdAt)) {
    authorities.srManagerProcurement = '';
  }
  return authorities;
};

const getUserIdentityTokensForAuthority = (user) => {
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  return [...new Set([
    normalizeToken(fullName),
    normalizeToken(user?.email),
    normalizeToken(user?.employeeId)
  ].filter(Boolean))];
};

const isAssignedByAuthorityText = (approvalAuthorities, user, createdAt = null) => {
  const authorities = sanitizeApprovalAuthorities(approvalAuthorities, createdAt);
  const assignedTexts = [
    authorities.preparedBy,
    authorities.managerProcurement,
    authorities.srManagerProcurement,
    authorities.chiefOperatingOfficer || authorities.verifiedBy,
    authorities.avpTaj || authorities.authorisedRep,
    authorities.technicalDepartment,
    authorities.financeRep
  ].map(normalizeToken).filter(Boolean);
  if (!assignedTexts.length) return false;
  const tokens = getUserIdentityTokensForAuthority(user);
  return tokens.some((t) => assignedTexts.some((assigned) => tokenMatchesAuthorityText(t, assigned)));
};

const getRequiredAuthoritySlots = async (indentId, approvalAuthorities = {}, createdAt = null) => {
  const authorities = sanitizeApprovalAuthorities(approvalAuthorities, createdAt);
  const indent = indentId
    ? await Indent.findById(indentId).select('comparativeStatementApprovals').lean()
    : null;
  const csa = indent?.comparativeStatementApprovals || {};
  return AUTHORITY_SLOT_CONFIG.map((slot) => {
    if (slot.key === 'srManagerProcurement' && !isSrManagerProcurementApplicable(createdAt)) {
      return null;
    }
    const textToken = normalizeToken(authorities?.[slot.key]);
    const userId = (!textToken && slot.indentUserField) ? String(csa?.[slot.indentUserField] || '').trim() : '';
    if (!userId && !textToken) return null;
    return { ...slot, userId: userId || '', textToken: textToken || '' };
  }).filter(Boolean);
};

const matchUserToAuthoritySlots = (requiredSlots, user) => {
  const uid = String(user?.id || user?._id || '').trim();
  const tokens = getUserIdentityTokensForAuthority(user);
  // Exact identity (user id / full name / email / employee ID) wins. Substring matching is only a fallback,
  // otherwise "Muhammad Ali" would also match a "Muhammad Ali Raza" slot and sign both authorities.
  const exact = requiredSlots.filter((slot) => {
    if (slot.userId && uid && slot.userId === uid) return true;
    return Boolean(slot.textToken && tokens.some((token) => normalizeToken(token) === normalizeToken(slot.textToken)));
  });
  if (exact.length) return exact;
  return requiredSlots.filter((slot) =>
    Boolean(slot.textToken && tokens.some((token) => tokenMatchesAuthorityText(token, slot.textToken)))
  );
};

const getApprovedAuthorityKeys = (authorityApprovals) => new Set(
  (Array.isArray(authorityApprovals) ? authorityApprovals : [])
    .map((a) => String(a?.authorityKey || '').trim())
    .filter(Boolean)
);

/**
 * True when user maps to at least one required slot not yet in authorityApprovals.
 */
async function userHasPendingAuthoritySlots(indentId, approvalAuthorities, authorityApprovals, user, createdAt = null) {
  const requiredSlots = await getRequiredAuthoritySlots(indentId, approvalAuthorities, createdAt);
  if (!requiredSlots.length) return false;
  const matchedSlots = matchUserToAuthoritySlots(requiredSlots, user);
  if (!matchedSlots.length) return false;
  const approvedKeys = getApprovedAuthorityKeys(authorityApprovals);
  return matchedSlots.some((slot) => !approvedKeys.has(slot.key));
}

/**
 * Clear legacy Sr Manager assignment and advance PO when all real slots are done.
 * Mutates the mongoose document (or plain object). Returns { cleared, advanced }.
 */
async function reconcileLegacySrManagerProcurement(purchaseOrder, { pushHistory, actorId } = {}) {
  const result = { cleared: false, advanced: false };
  if (!purchaseOrder) return result;

  const createdAt = purchaseOrder.createdAt;
  if (isSrManagerProcurementApplicable(createdAt)) return result;

  const current = String(purchaseOrder.approvalAuthorities?.srManagerProcurement || '').trim();
  if (current) {
    if (!purchaseOrder.approvalAuthorities) purchaseOrder.approvalAuthorities = {};
    purchaseOrder.approvalAuthorities.srManagerProcurement = '';
    if (typeof purchaseOrder.markModified === 'function') {
      purchaseOrder.markModified('approvalAuthorities');
    }
    result.cleared = true;
  }

  if (purchaseOrder.status !== 'Pending Approval') return result;

  const requiredSlots = await getRequiredAuthoritySlots(
    purchaseOrder.indent?._id || purchaseOrder.indent,
    purchaseOrder.approvalAuthorities,
    createdAt
  );
  if (!requiredSlots.length) return result;

  const approvedKeys = getApprovedAuthorityKeys(purchaseOrder.authorityApprovals);
  const allApproved = requiredSlots.every((slot) => approvedKeys.has(slot.key));
  if (!allApproved) return result;

  purchaseOrder.status = 'Pending Audit';
  result.advanced = true;
  if (typeof pushHistory === 'function') {
    pushHistory(
      purchaseOrder,
      'Pending Approval',
      'Pending Audit',
      actorId || purchaseOrder.updatedBy || null,
      'Legacy Sr Manager Procurement slot cleared; remaining authorities already approved — sent to Pre-Audit',
      'System'
    );
  }
  return result;
}

const getAssignedIndentIdsForUser = async (userId) => {
  if (!userId) return [];
  const uid = String(userId);
  const indents = await Indent.find({
    $or: [
      { 'comparativeStatementApprovals.preparedByUser': uid },
      { 'comparativeStatementApprovals.verifiedByUser': uid },
      { 'comparativeStatementApprovals.authorisedRepUser': uid },
      { 'comparativeStatementApprovals.financeRepUser': uid },
      { 'comparativeStatementApprovals.managerProcurementUser': uid },
      { 'comparativeApproval.approvers.approver': uid }
    ]
  }).select('_id').lean();
  return indents.map((i) => i._id);
};

module.exports = {
  AUTHORITY_SLOT_CONFIG,
  SR_MANAGER_PROCUREMENT_EFFECTIVE_AT,
  isSrManagerProcurementApplicable,
  sanitizeApprovalAuthorities,
  normalizeToken,
  tokenMatchesAuthorityText,
  isAssignedByAuthorityText,
  getRequiredAuthoritySlots,
  matchUserToAuthoritySlots,
  userHasPendingAuthoritySlots,
  getAssignedIndentIdsForUser,
  getUserIdentityTokensForAuthority,
  getApprovedAuthorityKeys,
  reconcileLegacySrManagerProcurement
};
