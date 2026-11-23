/**
 * Approvers switched off for now (SystemSettings.disabledApprovers).
 *
 * A pending approval step that belongs to a disabled approver is closed as "skipped": no signature, no approver
 * recorded as having approved, and a workflow note saying why. The document then moves on exactly as if the step
 * had been approved (next step, or the next stage when it was the last one).
 *
 * Covered: purchase order authority slots, indent approval chain, utility bill approval chain.
 * Enable an approver again by removing their entry from the list — documents already moved stay where they are.
 */

const SKIP_NOTE = 'Skipped — approver disabled';

const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
const normalize = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** @returns {Promise<Array<{id: string, name: string, tokens: string[]}>>} */
async function getDisabledApprovers() {
  const SystemSettings = require('../models/general/SystemSettings');
  const User = require('../models/User');
  const settings = await SystemSettings.findOne({ key: 'default' }).select('disabledApprovers').lean();
  const entries = settings?.disabledApprovers || [];
  if (!entries.length) return [];
  const users = await User.find({ _id: { $in: entries.map((e) => e.user) } })
    .select('firstName lastName email employeeId').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return entries.map((e) => {
    const u = byId.get(String(e.user)) || {};
    const name = e.name || fullName(u);
    const tokens = [...new Set([name, fullName(u), u.email, u.employeeId].map(normalize).filter(Boolean))];
    return { id: String(e.user), name, tokens };
  });
}

/** Disabled approver whose name / email / employee ID is the authority text on a PO slot (exact match only) */
const disabledForText = (disabled, text) => {
  const t = normalize(text);
  if (!t) return null;
  return disabled.find((d) => d.tokens.includes(t)) || null;
};

const disabledForId = (disabled, id) => disabled.find((d) => d.id === String(id || '')) || null;

/**
 * Purchase order in 'Pending Approval': close every unsigned authority slot held by a disabled approver.
 * When no other slot is left, the PO goes to Pre-Audit like a normal final approval.
 * Mutates `po` (mongoose document). @returns {{skipped: string[], advanced: boolean}}
 */
async function skipOnPurchaseOrder(po, disabled) {
  const result = { skipped: [], advanced: false };
  if (!po || po.status !== 'Pending Approval' || !disabled.length) return result;
  const { getRequiredAuthoritySlots, getApprovedAuthorityKeys } = require('./purchaseOrderAuthority');
  const slots = await getRequiredAuthoritySlots(po.indent?._id || po.indent, po.approvalAuthorities, po.createdAt);
  if (!slots.length) return result;
  const done = getApprovedAuthorityKeys(po.authorityApprovals);
  const now = new Date();
  po.authorityApprovals = Array.isArray(po.authorityApprovals) ? po.authorityApprovals : [];
  slots.forEach((slot) => {
    if (done.has(slot.key)) return;
    const who = (slot.userId && disabledForId(disabled, slot.userId)) || disabledForText(disabled, slot.textToken);
    if (!who) return;
    po.authorityApprovals.push({
      authorityKey: slot.key,
      authorityLabel: slot.label,
      approver: null,
      approvedAt: now,
      comments: `${SKIP_NOTE} (${who.name})`,
      skipped: true
    });
    done.add(slot.key);
    result.skipped.push(`${slot.label}: ${who.name}`);
  });
  if (!result.skipped.length) return result;

  const allDone = slots.every((s) => done.has(s.key));
  po.workflowHistory = po.workflowHistory || [];
  po.workflowHistory.push({
    fromStatus: 'Pending Approval',
    toStatus: allDone ? 'Pending Audit' : 'Pending Approval',
    changedBy: null,
    changedAt: now,
    comments: `${SKIP_NOTE}: ${result.skipped.join('; ')}${allDone ? ' — all authorities complete, sent to Pre-Audit' : ''}`,
    module: 'System'
  });
  if (allDone) {
    po.status = 'Pending Audit';
    result.advanced = true;
  }
  return result;
}

/** Close pending chain steps held by disabled approvers. @returns {string[]} names skipped */
const skipChainSteps = (chain, disabled) => {
  const skipped = [];
  const now = new Date();
  (chain || []).forEach((step) => {
    if (step.status !== 'pending') return;
    const who = disabledForId(disabled, step.approver?._id || step.approver);
    if (!who) return;
    step.status = 'skipped';
    step.actedAt = now;
    step.comment = SKIP_NOTE;
    skipped.push(who.name);
  });
  return skipped;
};

const chainComplete = (chain) => (chain || []).length > 0
  && chain.every((s) => s.status === 'approved' || s.status === 'skipped');

/**
 * Indent in 'Submitted' / 'Under Review' (parallel chain — all must approve). When every step is closed the indent
 * is Approved and goes to the Store Dashboard for stock check, as the approve route does.
 */
async function skipOnIndent(indent, disabled) {
  const result = { skipped: [], advanced: false };
  if (!indent || !['Submitted', 'Under Review'].includes(indent.status) || !disabled.length) return result;
  result.skipped = skipChainSteps(indent.approvalChain, disabled);
  if (!result.skipped.length) return result;
  if (typeof indent.markModified === 'function') indent.markModified('approvalChain');
  const previous = indent.status;
  const allDone = chainComplete(indent.approvalChain);
  if (allDone) {
    indent.status = 'Approved';
    indent.approvedDate = new Date();
    indent.storeRoutingStatus = 'pending_store_check';
    result.advanced = true;
  }
  indent.workflowHistory = indent.workflowHistory || [];
  indent.workflowHistory.push({
    fromStatus: previous,
    toStatus: indent.status,
    changedBy: null,
    changedAt: new Date(),
    comments: `${SKIP_NOTE}: ${result.skipped.join(', ')}${allDone ? '. All approvers complete — sent to Store Dashboard for stock check.' : ''}`,
    module: 'System'
  });
  return result;
}

/**
 * Utility bill with approvalStatus 'Submitted' (sequential chain). When every step is closed the bill is
 * Approved and sent to Pre-Audit, as the approve route does.
 */
async function skipOnUtilityBill(bill, disabled) {
  const result = { skipped: [], advanced: false };
  if (!bill || bill.approvalStatus !== 'Submitted' || !disabled.length) return result;
  result.skipped = skipChainSteps(bill.approvalChain, disabled);
  if (!result.skipped.length) return result;
  if (typeof bill.markModified === 'function') bill.markModified('approvalChain');
  const previous = bill.approvalStatus;
  const now = new Date();
  bill.workflowHistory = bill.workflowHistory || [];
  if (chainComplete(bill.approvalChain)) {
    bill.approvalStatus = 'Approved';
    bill.approvedAt = now;
    const previousAudit = bill.auditStatus || 'Not Sent';
    bill.auditStatus = 'Send to Audit';
    bill.workflowHistory.push({ fromStatus: previousAudit, toStatus: 'Send to Audit', changedBy: null, changedAt: now, comments: 'Sent to Pre-Audit after approval authority completed' });
    result.advanced = true;
  }
  bill.workflowHistory.push({
    fromStatus: previous,
    toStatus: bill.approvalStatus,
    changedBy: null,
    changedAt: now,
    comments: `${SKIP_NOTE}: ${result.skipped.join(', ')}`
  });
  return result;
}

module.exports = {
  SKIP_NOTE,
  getDisabledApprovers,
  skipOnPurchaseOrder,
  skipOnIndent,
  skipOnUtilityBill
};
