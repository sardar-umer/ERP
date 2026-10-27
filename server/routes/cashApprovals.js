/**
 * Cash Approval Routes
 * Full workflow: Draft → Audit → CEO → Finance (Advance) → Finance (Settle) → Procurement → Completed
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { asyncHandler } = require('../middleware/errorHandler');
const { authorize, authMiddleware } = require('../middleware/auth');
const CashApproval = require('../models/procurement/CashApproval');
const Quotation = require('../models/procurement/Quotation');
const Indent = require('../models/general/Indent');
const User = require('../models/User');
const Account = require('../models/finance/Account');
const JournalEntry = require('../models/finance/JournalEntry');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');
const { notifyApprovers } = require('../utils/approvalWhatsAppNotifier');
const { notifyChatApprovers } = require('../utils/approvalChatNotifier');

const FinanceHelper = require('../utils/financeHelper');
const { getCashApprovalNarration, withVoucherNarration } = require('../utils/documentNarration');
const { co, acct, withCompany } = require('../utils/financePosting');
const { resolveDocumentCompanyId, optionalCompanyFilterFromRequest } = require('../utils/financeCompanyContext');
const AccountResolver = require('../utils/accountResolver');
const {
  GENERAL_MODULE,
  isGeneralCashApproval,
  hasGeneralModuleAccess,
  canManageGeneralCashApproval,
  validateGeneralCashApprovalPayload,
  resolveGeneralCashApprovalTotals,
  buildGeneralCashApprovalDocument,
  uniqueApproverIds,
  applyGeneralSubmitApprovers,
  approverIdFromStep,
  getFirstPendingDepartmentStepIndex,
  getActorPendingDepartmentStepIndex,
  getRejectedDepartmentStepIndex,
  isGeneralCashApprovalEditable,
  resubmitGeneralDepartmentApproval,
  isGeneralCashApprovalResubmitState,
  applyGeneralResubmit,
  resolveGeneralResubmitTarget
} = require('../utils/generalCashApproval');
const { queryApproverCandidateUsers } = require('../utils/utilityBillApproverEligibility');
const Employee = require('../models/hr/Employee');
const Department = require('../models/hr/Department');
const {
  listEmployeesForAdvancePicker,
  resolveGeneralAdvanceRecipient,
  resolveEmployeeAdvanceAccount,
  ensureEmployeeAdvanceAccount,
  employeeDisplayName
} = require('../utils/employeeAdvanceAccount');
const { isAuditDirectorUser, canActAsAuditDirector } = require('../utils/auditDirectorRole');
const { hasAuditAccess, canPerformInitialPreAuditActions } = require('../utils/auditAccess');
const {
  authenticateUser,
  validateFilename,
  validateFilePath,
  getFileHeaders
} = require('../utils/fileServer');

const router = express.Router();

/** Legacy dirs + unified line-files (avoids multipart body not ready when multer picks destination). */
const generalCaUploadDir = path.join(__dirname, '..', 'uploads', 'general', 'cash-approvals');
const procurementCaUploadDir = path.join(__dirname, '..', 'uploads', 'procurement', 'cash-approvals');
const cashApprovalLineFilesDir = path.join(__dirname, '..', 'uploads', 'cash-approvals', 'line-files');
[generalCaUploadDir, procurementCaUploadDir, cashApprovalLineFilesDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const lineAttachmentFilename = (_req, file, cb) => {
  const ext = path.extname(file.originalname || '');
  const base = path.basename(file.originalname || 'attachment', ext).replace(/[^a-zA-Z0-9-_]/g, '_');
  cb(null, `${base}-${Date.now()}${ext}`);
};

const cashApprovalLineUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, cashApprovalLineFilesDir),
    filename: lineAttachmentFilename
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP, or PDF files are allowed'));
    cb(null, true);
  }
});

const maybeGeneralMultipart = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  return cashApprovalLineUpload.any()(req, res, next);
};

const parseJsonBodyField = (val, fallback) => {
  if (val == null || val === '') return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

const { mergeCashApprovalLineUploads } = require('../utils/cashApprovalLineAttachments');

const CASH_APPROVAL_LINE_UPLOAD_PREFIX = '/uploads/cash-approvals/line-files/';

const mergeGeneralLineUploads = (files, items, body = {}) =>
  mergeCashApprovalLineUploads(files, items, body, { publicPath: CASH_APPROVAL_LINE_UPLOAD_PREFIX });

const getActorId = (req) => String(req.user?.id || req.user?._id || '');

const signedCheckUploadDir = path.join(__dirname, '..', 'uploads', 'procurement', 'cash-approvals', 'signed-checks');
if (!fs.existsSync(signedCheckUploadDir)) fs.mkdirSync(signedCheckUploadDir, { recursive: true });
const signedCheckStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, signedCheckUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'signed-check', ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const signedCheckUpload = multer({
  storage: signedCheckStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP, or PDF files are allowed'));
    cb(null, true);
  }
});
const purchaseEvidenceUploadDir = path.join(__dirname, '..', 'uploads', 'procurement', 'cash-approvals', 'purchase-evidence');
if (!fs.existsSync(purchaseEvidenceUploadDir)) fs.mkdirSync(purchaseEvidenceUploadDir, { recursive: true });
const purchaseEvidenceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, purchaseEvidenceUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'purchase-evidence', ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const purchaseEvidenceUpload = multer({
  storage: purchaseEvidenceStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP, or PDF files are allowed'));
    cb(null, true);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalizeRoleLabel = (v) => String(v || '').trim().toLowerCase();

const userHasRoleName = (user, names = []) => {
  const accepted = names.map(normalizeRoleLabel);
  if (!user || !accepted.length) return false;
  if (accepted.includes(normalizeRoleLabel(user.role))) return true;
  const collect = (r) => [normalizeRoleLabel(r?.name), normalizeRoleLabel(r?.displayName)].filter(Boolean);
  if (collect(user.roleRef || {}).some((n) => accepted.includes(n))) return true;
  if (Array.isArray(user.roles)) {
    for (const r of user.roles) {
      if (collect(r).some((n) => accepted.includes(n))) return true;
    }
  }
  if (Array.isArray(user.subRoles)) {
    for (const r of user.subRoles) {
      if (collect(r).some((n) => accepted.includes(n))) return true;
    }
  }
  return false;
};

const hasModuleAccess = (roleDoc, moduleKey) => {
  if (!roleDoc?.isActive || !Array.isArray(roleDoc.permissions)) return false;
  return roleDoc.permissions.some((p) => p?.module === moduleKey);
};

const hasFinanceAccess = (user) => {
  if (!user) return false;
  if (['super_admin', 'admin', 'finance_manager'].includes(user.role)) return true;
  if (hasModuleAccess(user.roleRef, 'finance')) return true;
  if (Array.isArray(user.roles) && user.roles.some((r) => hasModuleAccess(r, 'finance'))) return true;
  return false;
};

const PROCUREMENT_EDITABLE_STATUSES = [
  'Pending Approval',
  'Draft',
  'Rejected',
  'Returned from Audit',
  'Returned from CEO Office',
  'Returned from CEO Secretariat'
];

const PROCUREMENT_RESUBMIT_TARGET_BY_FROM = {
  'Pending Approval': { status: 'Pending Approval', label: 'authority approval', stage: 'authority' },
  'Pending Audit': { status: 'Pending Audit', label: 'Pre-Audit', stage: 'audit' },
  'Forwarded to Audit Director': { status: 'Pending Audit', label: 'Pre-Audit', stage: 'audit' },
  'Send to CEO Office': { status: 'Send to CEO Office', label: 'CEO Secretariat', stage: 'ceo_secretariat' },
  'Forwarded to CEO': { status: 'Forwarded to CEO', label: 'CEO', stage: 'ceo' },
  'Pending Finance': { status: 'Pending Finance', label: 'Finance', stage: 'finance' }
};

const PROCUREMENT_RETURN_STATUS_DEFAULT_FROM = {
  'Returned from Audit': 'Pending Audit',
  'Returned from CEO Office': 'Forwarded to CEO',
  'Returned from CEO Secretariat': 'Send to CEO Office'
};

const resolveProcurementResubmitTarget = (ca) => {
  const fromStatus = (ca?.returnedFromStatus && PROCUREMENT_RESUBMIT_TARGET_BY_FROM[ca.returnedFromStatus])
    ? ca.returnedFromStatus
    : (PROCUREMENT_RETURN_STATUS_DEFAULT_FROM[ca?.status] || ca?.returnedFromStatus || 'Pending Audit');
  const target = PROCUREMENT_RESUBMIT_TARGET_BY_FROM[fromStatus]
    || PROCUREMENT_RESUBMIT_TARGET_BY_FROM['Pending Audit'];
  return { ...target, fromStatus };
};

const applyProcurementResubmit = (ca) => {
  const target = resolveProcurementResubmitTarget(ca);
  if (target.stage === 'audit') {
    const snapshot = ca.auditSnapshotAtReturn;
    if (snapshot) {
      const summary = buildCAChangeSummary(ca.items, snapshot);
      ca.resubmissionChangeSummary = summary || ca.resubmissionChangeSummary || '';
    }
    ca.auditRejectedBy = undefined;
    ca.auditRejectedAt = undefined;
    ca.auditRejectionComments = '';
  }
  if (target.stage === 'ceo' || target.stage === 'ceo_secretariat') {
    ca.ceoRejectedBy = undefined;
    ca.ceoRejectedAt = undefined;
    ca.ceoRejectionComments = '';
    ca.ceoReturnedBy = undefined;
    ca.ceoReturnedAt = undefined;
    ca.ceoReturnComments = '';
  }
  if (target.stage === 'finance') {
    ca.financeAuthorityApprovals = (ca.financeAuthorityApprovals || []).filter(
      (row) => String(row?.decision || 'approved').trim() !== 'rejected'
    );
    ca.financeRejectedBy = undefined;
    ca.financeRejectedAt = undefined;
    ca.financeRejectionComments = '';
    ca.markModified('financeAuthorityApprovals');
  }
  // Authority / department / audit / CEO approvals already recorded stay intact
  ca.status = target.status;
  ca.returnedFromStatus = '';
  return target;
};

const FINANCE_EDITABLE_STATUSES = [
  'Pending Finance'
];

const hasProcurementAccess = (user) => {
  if (!user) return false;
  if (['super_admin', 'admin', 'procurement_manager'].includes(user.role)) return true;
  if (hasModuleAccess(user.roleRef, 'procurement')) return true;
  if (Array.isArray(user.roles) && user.roles.some((r) => hasModuleAccess(r, 'procurement'))) return true;
  return false;
};

const hasCeoSecretariatAccess = (user) => {
  const { hasCeoSecretariatAccess: shared } = require('../utils/executiveAccess');
  return shared(user);
};
const { isDesignatedCeoApprover, hasCeoSecretariatCoordinatorAccess } = require('../utils/executiveAccess');

const isAssignedComparativeAuthorityUser = async (indentId, userId) => {
  if (!indentId || !userId) return false;
  const indent = await Indent.findById(indentId)
    .select('comparativeStatementApprovals comparativeApproval')
    .lean();
  if (!indent) return false;
  const uid = String(userId);
  const csa = indent.comparativeStatementApprovals || {};
  const authorityIds = [
    csa.preparedByUser,
    csa.verifiedByUser,
    csa.authorisedRepUser,
    csa.financeRepUser,
    csa.managerProcurementUser
  ]
    .map((id) => String(id || ''))
    .filter(Boolean);
  if (authorityIds.includes(uid)) return true;

  const steps = Array.isArray(indent?.comparativeApproval?.approvers) ? indent.comparativeApproval.approvers : [];
  return steps.some((s) => String(s?.approver?._id || s?.approver || '') === uid);
};

const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const AUTHORITY_SLOT_CONFIG = [
  { key: 'preparedBy', label: 'Prepared By', indentUserField: 'preparedByUser' },
  { key: 'verifiedBy', label: 'Verified By (Procurement Committee)', indentUserField: 'verifiedByUser' },
  { key: 'authorisedRep', label: 'Authorised Rep.', indentUserField: 'authorisedRepUser' },
  { key: 'financeRep', label: 'Finance Rep.', indentUserField: 'financeRepUser' },
  { key: 'managerProcurement', label: 'Manager Procurement', indentUserField: 'managerProcurementUser' }
];
const getUserIdentityTokens = (user) => {
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  return [...new Set([
    normalizeToken(fullName),
    normalizeToken(user?.email),
    normalizeToken(user?.employeeId)
  ].filter(Boolean))];
};
const isAssignedByAuthorityText = (approvalAuthorities, user) => {
  const authorities = approvalAuthorities || {};
  const assignedTexts = [
    authorities.preparedBy,
    authorities.verifiedBy,
    authorities.authorisedRep,
    authorities.financeRep,
    authorities.managerProcurement
  ].map(normalizeToken).filter(Boolean);
  if (!assignedTexts.length) return false;
  const tokens = getUserIdentityTokens(user);
  return tokens.some((t) => assignedTexts.includes(t));
};
const getRequiredAuthoritySlots = async (indentId, approvalAuthorities = {}) => {
  const indent = indentId
    ? await Indent.findById(indentId).select('comparativeStatementApprovals').lean()
    : null;
  const csa = indent?.comparativeStatementApprovals || {};
  return AUTHORITY_SLOT_CONFIG.map((slot) => {
    const textToken = normalizeToken(approvalAuthorities?.[slot.key]);
    // The name assigned on the cash approval wins; the CS user is only a fallback for unassigned slots,
    // otherwise a CS approver could also sign a slot assigned to someone else.
    const userId = textToken ? '' : String(csa?.[slot.indentUserField] || '').trim();
    if (!userId && !textToken) return null;
    return { ...slot, userId: userId || '', textToken: textToken || '' };
  }).filter(Boolean);
};
const matchUserToAuthoritySlots = (requiredSlots, user) => {
  const uid = String(user?.id || user?._id || '').trim();
  const tokens = getUserIdentityTokens(user);
  // Exact identity only (user id / full name / email / employee ID) so one approval signs only its own slot(s)
  return requiredSlots.filter((slot) => {
    if (slot.userId && uid && slot.userId === uid) return true;
    if (slot.textToken && tokens.includes(slot.textToken)) return true;
    return false;
  });
};

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

const normalizeIds = (ids = []) => [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];

const getUserIdsByRoles = async (roles = []) => {
  const users = await User.find({ isActive: true, role: { $in: roles } }).select('_id');
  return users.map((u) => String(u._id));
};
const getUserIdsByDepartment = async (dept) => {
  if (!dept) return [];
  const users = await User.find({ isActive: true, department: { $regex: `^${String(dept)}$`, $options: 'i' } }).select('_id');
  return users.map((u) => String(u._id));
};
const getAuditRecipients = async () => {
  const a = await getUserIdsByDepartment('audit');
  const b = await getUserIdsByRoles(['audit_manager', 'auditor', 'audit_director', 'admin', 'super_admin']);
  return [...new Set([...a, ...b])];
};
const getCeoSecretariatRecipients = async () => {
  const a = await getUserIdsByRoles(['hr_manager', 'admin', 'super_admin']);
  const b = await getUserIdsByDepartment('hr');
  return [...new Set([...a, ...b])];
};
const getCeoRecipients = async () => {
  const byRole = await getUserIdsByRoles(['higher_management', 'admin', 'super_admin']);
  return [...new Set(byRole)];
};
const getFinanceRecipients = async () => {
  const a = await getUserIdsByDepartment('finance');
  const b = await getUserIdsByRoles(['finance_manager', 'admin', 'super_admin']);
  return [...new Set([...a, ...b])];
};
const getProcurementRecipients = async () => {
  const a = await getUserIdsByDepartment('procurement');
  const b = await getUserIdsByRoles(['procurement_manager', 'admin', 'super_admin']);
  return [...new Set([...a, ...b])];
};

const notify = async ({ recipientIds, actorId, title, message, actionUrl, entityId, entityType = 'CashApproval', module = 'procurement', metadata = {} }) => {
  const ids = normalizeIds(recipientIds).filter((id) => id !== String(actorId || ''));
  if (!ids.length) return;
  await createAndEmitNotification({
    recipientIds: ids,
    title,
    message,
    type: 'info',
    category: 'approval',
    priority: 'high',
    actionUrl,
    entityId,
    entityType,
    module,
    metadata
  });
};

const notifyNextGeneralDepartmentApprover = async (ca, actorId) => {
  const chain = ca.departmentApprovalChain || [];
  const idx = getFirstPendingDepartmentStepIndex(chain);
  if (idx < 0) return;
  const recipientId = approverIdFromStep(chain[idx]);
  if (!recipientId) return;
  const roleLabel = idx === 0 ? 'Manager' : 'Head of Department';
  const preservedNote = chain.some((step, stepIdx) => stepIdx < idx && step.status === 'approved')
    ? ' Previous approvals are preserved — only your step is pending.'
    : '';
  await notify({
    recipientIds: [recipientId],
    actorId,
    title: 'Cash Approval awaiting your approval',
    message: `Cash Approval ${ca.caNumber} requires your ${roleLabel} approval.${preservedNote}`,
    actionUrl: `/general/cash-approvals/${ca._id}`,
    entityId: ca._id,
    module: 'general'
  });
  notifyApprovers([recipientId], {
    docType: 'Cash Approval',
    docNumber: ca.caNumber || '',
    fromUser: actorId
  }).catch(() => {});
  notifyChatApprovers([recipientId], {
    docType: 'Cash Approval',
    docNumber: ca.caNumber || '',
    url: `/general/cash-approvals/${ca._id}`,
    fromUser: actorId
  }).catch(() => {});
};

const notifyAfterGeneralResubmit = async (ca, actorId, target) => {
  if (!target) return;
  if (target.stage === 'department') {
    await notifyNextGeneralDepartmentApprover(ca, actorId);
    return;
  }
  if (target.stage === 'audit') {
    const recipients = await getAuditRecipients();
    await notify({
      recipientIds: recipients,
      actorId,
      title: 'General Cash Approval pending Audit review',
      message: `Cash Approval ${ca.caNumber} was corrected and resubmitted to Pre-Audit after rejection.`,
      actionUrl: '/audit',
      entityId: ca._id,
      module: 'general',
      metadata: { queueStage: 'pending_audit', targetModule: 'audit', targetTab: 'pre_audit' }
    });
    return;
  }
  if (target.stage === 'finance') {
    const slots = getRequiredFinanceAuthoritySlots(ca);
    const decidedKeys = new Set(
      (ca.financeAuthorityApprovals || [])
        .map((row) => String(row?.authorityKey || '').trim())
        .filter(Boolean)
    );
    const pendingIds = slots.filter((slot) => !decidedKeys.has(slot.key)).map((slot) => slot.userId);
    const recipients = pendingIds.length ? pendingIds : await getFinanceRecipients();
    await notify({
      recipientIds: recipients,
      actorId,
      title: 'Cash Approval pending Finance review',
      message: `Cash Approval ${ca.caNumber} was corrected and resubmitted to Finance after rejection.`,
      actionUrl: `/general/cash-approvals/${ca._id}`,
      entityId: ca._id,
      module: 'general'
    });
    return;
  }
  if (target.stage === 'ceo_secretariat') {
    const recipients = await getCeoSecretariatRecipients();
    await notify({
      recipientIds: recipients,
      actorId,
      title: 'Cash Approval pending CEO Secretariat review',
      message: `Cash Approval ${ca.caNumber} was corrected and resubmitted to CEO Secretariat after rejection.`,
      actionUrl: `/general/cash-approvals/${ca._id}`,
      entityId: ca._id,
      module: 'general'
    });
    return;
  }
  if (target.stage === 'ceo') {
    const recipients = await getCeoRecipients();
    await notify({
      recipientIds: recipients,
      actorId,
      title: 'Cash Approval pending CEO approval',
      message: `Cash Approval ${ca.caNumber} was corrected and resubmitted to CEO after rejection.`,
      actionUrl: `/general/cash-approvals/${ca._id}`,
      entityId: ca._id,
      module: 'general'
    });
  }
};

const { resolveAuditStampMeta } = require('../utils/auditStampMeta');

const pushHistory = (ca, from, to, userId, comments, module, extra = {}) => {
  ca.workflowHistory.push({
    fromStatus: from,
    toStatus: to,
    changedBy: userId,
    changedAt: new Date(),
    comments: comments || '',
    module: module || 'Procurement',
    ...extra
  });
};

const upsertCaAuthorityApproval = (ca, { key, label, approverId, approvedAt, comments }) => {
  if (!key || !approverId) return;
  const approvals = Array.isArray(ca.authorityApprovals) ? [...ca.authorityApprovals] : [];
  const idx = approvals.findIndex((a) => String(a?.authorityKey || '').trim() === key);
  const entry = {
    authorityKey: key,
    authorityLabel: label || key,
    approver: approverId,
    approvedAt: approvedAt || new Date(),
    comments: comments || ''
  };
  if (idx >= 0) approvals[idx] = { ...approvals[idx], ...entry };
  else approvals.push(entry);
  ca.authorityApprovals = approvals;
};

const FINANCE_AUTHORITY_SLOT_CONFIG = [
  { key: 'accountsOfficerUser', label: 'Accounts Officer' },
  { key: 'accountsManagerUser', label: 'Accounts Manager' },
  { key: 'financeControllerUser', label: 'Finance Controller' }
];

const parseFinanceApprovalAuthoritiesBody = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'string') return parseJsonBodyField(raw, null);
  return raw;
};

const applyFinanceAuthorityUpdates = (ca, faBody, userId) => {
  const fa = faBody || {};
  const authorities = {
    accountsOfficerUser: fa.accountsOfficerUser || null,
    accountsManagerUser: fa.accountsManagerUser || null,
    financeControllerUser: fa.financeControllerUser || null
  };
  const ids = Object.values(authorities).map((id) => String(id || '')).filter(Boolean);
  if (ids.length !== new Set(ids).size) {
    const err = new Error('Each finance authority must be assigned to a different user');
    err.statusCode = 400;
    throw err;
  }
  ca.financeApprovalAuthorities = authorities;
  const keepKeys = FINANCE_AUTHORITY_SLOT_CONFIG
    .filter((s) => String(authorities?.[s.key] || '').trim())
    .map((s) => s.key);
  ca.financeAuthorityApprovals = (Array.isArray(ca.financeAuthorityApprovals) ? ca.financeAuthorityApprovals : [])
    .filter((a) => keepKeys.includes(String(a?.authorityKey || '').trim()));
  ca.financeAuthoritiesAssignedBy = userId;
  ca.financeAuthoritiesAssignedAt = new Date();
};

const applySignedCheckUpdates = (ca, body = {}) => {
  if (body.signedCheckNumber !== undefined) ca.signedCheckNumber = body.signedCheckNumber || '';
  if (body.signedCheckDate !== undefined) {
    ca.signedCheckDate = body.signedCheckDate ? new Date(body.signedCheckDate) : null;
  }
  if (body.signedCheckBankName !== undefined) ca.signedCheckBankName = body.signedCheckBankName || '';
  if (body.signedCheckRemarks !== undefined) ca.signedCheckRemarks = body.signedCheckRemarks || '';
};

const applyFinanceAdvanceFieldUpdates = async (ca, body = {}) => {
  if (body.advanceAmount !== undefined && body.advanceAmount !== '') {
    ca.advanceAmount = Math.round((Number(body.advanceAmount) || 0) * 100) / 100;
  }
  if (body.advancePaymentMethod !== undefined) ca.advancePaymentMethod = body.advancePaymentMethod || ca.advancePaymentMethod;
  if (body.advanceRemarks !== undefined) ca.advanceRemarks = body.advanceRemarks || '';
  if (body.advanceVoucherNo !== undefined) ca.advanceVoucherNo = body.advanceVoucherNo || '';
  if (body.financeVerificationNotes !== undefined) ca.financeVerificationNotes = body.financeVerificationNotes || '';
  if (body.settlementRemarks !== undefined) ca.settlementRemarks = body.settlementRemarks || '';
  if (body.internalNotes !== undefined) ca.internalNotes = body.internalNotes || '';
  if (body.advanceTo !== undefined) {
    ca.advanceTo = body.advanceTo || null;
    await applyAdvanceToName(ca, body.advanceTo, body.advanceToName);
  } else if (body.advanceToName !== undefined) {
    ca.advanceToName = body.advanceToName || '';
  }
};

const applyFinanceEditExtras = async (ca, body, userId) => {
  const financeAuthorities = parseFinanceApprovalAuthoritiesBody(body.financeApprovalAuthorities);
  if (financeAuthorities) {
    applyFinanceAuthorityUpdates(ca, financeAuthorities, userId);
  }
  applySignedCheckUpdates(ca, body);
  await applyFinanceAdvanceFieldUpdates(ca, body);
};

const getRequiredFinanceAuthoritySlots = (ca) => {
  const authorities = ca?.financeApprovalAuthorities || {};
  return FINANCE_AUTHORITY_SLOT_CONFIG
    .map((slot) => ({ ...slot, userId: String(authorities?.[slot.key] || '').trim() }))
    .filter((slot) => Boolean(slot.userId));
};
const matchUserToFinanceSlots = (slots, user) => {
  const uid = String(user?.id || user?._id || '').trim();
  return slots.filter((slot) => slot.userId && slot.userId === uid);
};

const ensureVoucherForCashApproval = async (ca, userId, options = {}) => {
  if (ca?.voucherEntryId) return ca.voucherEntryId;
  const amount = Math.round((Number(ca?.totalAmount) || 0) * 100) / 100;
  if (amount <= 0) return null;
  const voucherType = String(options?.voucherType || 'payment').trim().toLowerCase();
  const paymentMethod = String(options?.paymentMethod || 'bank').trim().toLowerCase();
  const remarks = String(options?.remarks || '').trim();

  const companyId = await resolveDocumentCompanyId({ companyId: ca?.companyId });
  const A = acct(companyId);
  let debitAccount = await A.resolve(FinanceHelper.ACCOUNTS.EXPENSE_GENERAL);
  let creditAccount = await A.resolve(FinanceHelper.ACCOUNTS.PAYABLE);
  if (!debitAccount || !creditAccount) {
    const fallback = await Account.find({ isActive: true }).limit(2);
    if (fallback.length < 2) throw new Error('Unable to resolve accounts for voucher creation');
    debitAccount = debitAccount || fallback[0];
    creditAccount = creditAccount || fallback[1];
  }

  const isCashVoucher = paymentMethod === 'cash';
  const caNarration = getCashApprovalNarration(ca);
  const voucher = await FinanceHelper.createAndPostJournalEntry(
    withVoucherNarration(withCompany({
      date: new Date(),
      reference: ca.caNumber,
      description: remarks || `Cash Approval voucher created for ${ca.caNumber}`,
      department: 'finance',
      module: 'finance',
      referenceId: ca._id,
      referenceType: ['payment', 'receipt', 'adjustment', 'manual', 'expense'].includes(voucherType) ? voucherType : 'payment',
      journalCode: isCashVoucher ? 'CASH' : 'BANK',
      voucherSeries: isCashVoucher ? 'CPV' : 'BPV',
      createdBy: userId,
      notes: remarks || undefined,
      lines: [
        { account: debitAccount._id, description: `Cash approval expense (${ca.caNumber})`, debit: amount, department: 'finance' },
        { account: creditAccount._id, description: `Payable for cash approval (${ca.caNumber})`, credit: amount, department: 'finance' }
      ]
    }, companyId), caNarration || remarks)
  );
  ca.voucherEntryId = voucher._id;
  return voucher._id;
};

function buildCAChangeSummary(currentItems, snapshot) {
  if (!snapshot || !Array.isArray(snapshot.items)) return '';
  const prev = snapshot.items;
  const curr = currentItems || [];
  const lines = [];
  const maxLen = Math.max(prev.length, curr.length);
  for (let i = 0; i < maxLen; i++) {
    const p = prev[i];
    const c = curr[i];
    const desc = (c || p)?.description || `Item ${i + 1}`;
    if (!p && c) {
      lines.push(`• Added: "${desc}" — Quantity ${c.quantity || 0} ${(c.unit || '').trim() || 'units'}, Rate ${c.unitPrice != null ? c.unitPrice : '—'}, Amount ${c.amount != null ? c.amount : '—'}`);
      continue;
    }
    if (p && !c) {
      lines.push(`• Removed: "${desc}" (was Quantity ${p.quantity} ${(p.unit || '').trim() || 'units'})`);
      continue;
    }
    if (!p || !c) continue;
    const qtyChange = Number(p.quantity) !== Number(c.quantity);
    const rateChange = (p.unitPrice != null && c.unitPrice != null && Number(p.unitPrice) !== Number(c.unitPrice));
    const amtChange = (p.amount != null && c.amount != null && Number(p.amount) !== Number(c.amount));
    if (qtyChange) {
      lines.push(`• "${desc}": Quantity changed from ${p.quantity} to ${c.quantity}${(c.unit || p.unit) ? ` ${String(c.unit || p.unit).trim()}` : ''}`);
    }
    if (rateChange) {
      lines.push(`• "${desc}": Unit price changed from ${p.unitPrice} to ${c.unitPrice}`);
    }
    if (amtChange && !qtyChange && !rateChange) {
      lines.push(`• "${desc}": Amount changed from ${p.amount} to ${c.amount}`);
    }
  }
  const totalPrev = snapshot.totalAmount != null ? Number(snapshot.totalAmount) : null;
  const totalCurr = curr.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  if (totalPrev != null && Math.abs(totalCurr - totalPrev) > 0.01) {
    lines.push(`• Total amount changed from ${totalPrev} to ${totalCurr}`);
  }
  return lines.length ? lines.join('\n') : '';
}

const indentWithComparativePopulate = {
  path: 'indent',
  select: 'indentNumber title erpRef requestedDate requiredDate department requestedBy items notes justification approvalChain signatures comparativeStatementApprovals comparativeApproval',
  populate: [
    { path: 'department', select: 'name code' },
    { path: 'requestedBy', select: 'firstName lastName email digitalSignature' },
    { path: 'approvalChain.approver', select: 'firstName lastName email digitalSignature' },
    { path: 'comparativeStatementApprovals.preparedByUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.verifiedByUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.authorisedRepUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.financeRepUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.managerProcurementUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeApproval.approvers.approver', select: 'firstName lastName email employeeId digitalSignature' }
  ]
};

const fullPopulate = (q) => q
  .populate('companyId', 'name companyCode')
  .populate('vendor', 'name email phone')
  .populate(indentWithComparativePopulate)
  .populate('quotation', 'quotationNumber')
  .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('updatedBy', 'firstName lastName email')
  .populate('authorityApprovals.approver', 'firstName lastName email employeeId digitalSignature')
  .populate('financeApprovalAuthorities.accountsOfficerUser', 'firstName lastName email employeeId digitalSignature')
  .populate('financeApprovalAuthorities.accountsManagerUser', 'firstName lastName email employeeId digitalSignature')
  .populate('financeApprovalAuthorities.financeControllerUser', 'firstName lastName email employeeId digitalSignature')
  .populate('financeAuthorityApprovals.approver', 'firstName lastName email employeeId digitalSignature')
  .populate('voucherEntryId', 'entryNumber date status totalDebits totalCredits reference description')
  .populate('financeRejectedBy', 'firstName lastName email')
  .populate('financeAuthoritiesAssignedBy', 'firstName lastName email')
  .populate('authorityApprovedBy', 'firstName lastName email employeeId digitalSignature')
  .populate('advanceTo', 'firstName lastName email employeeId department')
  .populate('advanceToEmployee', 'firstName lastName employeeId email employeeAdvanceAccountNumber')
  .populate('advanceGlAccount', 'accountNumber name detailType type')
  .populate('advanceBankAccount', 'accountNumber name')
  .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('advanceIssuedBy', 'firstName lastName email')
  .populate('evidenceSubmittedBy', 'firstName lastName email')
  .populate('settledBy', 'firstName lastName email')
  .populate('sentToProcurementBy', 'firstName lastName email')
  .populate('completedBy', 'firstName lastName email')
  .populate('auditApprovedBy', 'firstName lastName email digitalSignature')
  .populate('preAuditInitialApprovedBy', 'firstName lastName email digitalSignature')
  .populate('auditReturnedBy', 'firstName lastName email digitalSignature')
  .populate('auditRejectedBy', 'firstName lastName email digitalSignature')
  .populate('auditObservations.addedBy', 'firstName lastName email')
  .populate('auditObservations.answeredBy', 'firstName lastName email')
  .populate('ceoApprovedBy', 'firstName lastName email employeeId digitalSignature')
  .populate('ceoForwardedBy', 'firstName lastName email employeeId digitalSignature')
  .populate('ceoReturnedBy', 'firstName lastName email')
  .populate('ceoRejectedBy', 'firstName lastName email')
  .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature approvalStamp')
  .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('departmentApprovalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('departmentApprovedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('departmentRejectedBy', 'firstName lastName email employeeId digitalSignature approvalStamp');

// GET /api/cash-approvals/general/advance-employees
router.get('/general/advance-employees', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasGeneralModuleAccess(req.user)) {
    return res.status(403).json({ success: false, message: 'General module access required' });
  }
  const search = String(req.query.search || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const data = await listEmployeesForAdvancePicker({
    search,
    limit,
    createdBy: req.user.id
  });
  res.json({ success: true, data, total: data.length });
}));

const mapCaPaymentMethodLabel = (paymentMethod) => {
  const v = String(paymentMethod || 'bank_transfer').toLowerCase().replace(/\s+/g, '_');
  if (v === 'cash') return 'Cash';
  if (v === 'check' || v === 'cheque') return 'Cheque';
  if (v === 'bank_transfer' || v === 'bank') return 'Bank Transfer';
  if (v === 'online_transfer' || v === 'other') return 'Online Transfer';
  return 'Bank Transfer';
};

const isCashPaymentMethod = (paymentMethod) =>
  String(paymentMethod || '').toLowerCase().replace(/\s+/g, '_') === 'cash';

const getCaOpenAdvanceAmount = (ca) => {
  const configured = Number(ca?.advanceAmount);
  if (Number.isFinite(configured) && configured > 0) return Math.round(configured * 100) / 100;
  return Math.round((Number(ca?.totalAmount) || 0) * 100) / 100;
};

// GET /api/cash-approvals/finance/advance-payment/employee-payees
router.get('/finance/advance-payment/employee-payees', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasFinanceAccess(req.user) && !['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Finance access required' });
  }
  const includePending = String(req.query.includePending || '').toLowerCase() === 'true';
  const payeeStatuses = includePending
    ? ['Pending Finance', 'Finance Authority Approved']
    : ['Finance Authority Approved'];
  const employeeIds = await CashApproval.distinct('advanceToEmployee', {
    originatingModule: GENERAL_MODULE,
    status: { $in: payeeStatuses },
    advanceToEmployee: { $ne: null },
    $or: [{ advanceIssuedAt: null }, { advanceIssuedAt: { $exists: false } }],
    ...optionalCompanyFilterFromRequest(req)
  });
  if (!employeeIds.length) {
    return res.json({ success: true, data: [] });
  }
  const employees = await Employee.find({ _id: { $in: employeeIds }, isActive: true, isDeleted: { $ne: true } })
    .select('employeeId firstName lastName email placementDepartment')
    .populate('placementDepartment', 'name')
    .sort({ firstName: 1, lastName: 1 })
    .lean();
  const rows = employees.map((e) => ({
    employeeId: String(e._id),
    employeeCode: e.employeeId || '',
    employeeName: employeeDisplayName(e),
    departmentName: e.placementDepartment?.name || ''
  }));
  res.json({ success: true, data: rows });
}));

// GET /api/cash-approvals/finance/advance-payment/outstanding?employeeId=
router.get('/finance/advance-payment/outstanding', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasFinanceAccess(req.user) && !['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Finance access required' });
  }
  const employeeId = String(req.query.employeeId || '').trim();
  if (!employeeId) {
    return res.status(400).json({ success: false, message: 'employeeId is required' });
  }
  const includePending = String(req.query.includePending || '').toLowerCase() === 'true';
  const outstandingStatuses = includePending
    ? ['Pending Finance', 'Finance Authority Approved']
    : ['Finance Authority Approved'];
  const cas = await CashApproval.find({
    originatingModule: GENERAL_MODULE,
    status: { $in: outstandingStatuses },
    advanceToEmployee: employeeId,
    $or: [{ advanceIssuedAt: null }, { advanceIssuedAt: { $exists: false } }],
    ...optionalCompanyFilterFromRequest(req)
  })
    .select('caNumber approvalDate expectedPurchaseDate totalAmount advanceAmount advanceToEmployee advanceToName')
    .sort({ approvalDate: 1, createdAt: 1 })
    .lean();
  const rows = cas.map((ca) => ({
    cashApprovalId: String(ca._id),
    caNumber: ca.caNumber,
    dueDate: ca.expectedPurchaseDate || ca.approvalDate,
    totalAmount: Math.round((Number(ca.totalAmount) || 0) * 100) / 100,
    outstanding: getCaOpenAdvanceAmount(ca)
  })).filter((r) => r.outstanding > 0);
  res.json({ success: true, data: rows });
}));

// GET /api/cash-approvals/general/departments
router.get('/general/departments', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasGeneralModuleAccess(req.user)) {
    return res.status(403).json({ success: false, message: 'General module access required' });
  }
  const departments = await Department.find({ isActive: true })
    .select('name code')
    .sort({ name: 1 })
    .lean();
  res.json({ success: true, data: departments });
}));

// GET /api/cash-approvals/general/approver-candidates
router.get('/general/approver-candidates', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasGeneralModuleAccess(req.user)) {
    return res.status(403).json({ success: false, message: 'General module access required' });
  }
  const search = String(req.query.search || '').trim();
  const limit = parseInt(req.query.limit, 10) || 50;
  const users = await queryApproverCandidateUsers({ search, limit, allUsers: true });
  res.json({ success: true, data: users });
}));

// ─── CRUD ─────────────────────────────────────────────────────────────────────

// GET /api/cash-approvals
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search = '',
    status = '',
    vendor = '',
    priority = '',
    originatingModule = '',
    department = '',
    mine = ''
  } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (vendor) filter.vendor = vendor;
  if (priority) filter.priority = priority;
  if (originatingModule) filter.originatingModule = originatingModule;
  if (department) filter.requestingDepartment = department;
  const searchOr = search
    ? [
      { caNumber: { $regex: search, $options: 'i' } },
      { notes: { $regex: search, $options: 'i' } },
      { purpose: { $regex: search, $options: 'i' } },
      { requestingDepartment: { $regex: search, $options: 'i' } }
    ]
    : null;
  if (originatingModule === 'general' && mine === 'true' && !['super_admin', 'admin'].includes(req.user.role)) {
    const userId = req.user._id || req.user.id;
    const mineOr = [
      { createdBy: userId },
      { 'departmentApprovalChain.approver': userId }
    ];
    if (searchOr) {
      filter.$and = [{ $or: mineOr }, { $or: searchOr }];
    } else {
      filter.$or = mineOr;
    }
  } else if (searchOr) {
    filter.$or = searchOr;
  }
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [data, total] = await Promise.all([
    fullPopulate(CashApproval.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))),
    CashApproval.countDocuments(filter)
  ]);
  res.json({ success: true, data, total, page: parseInt(page), limit: parseInt(limit) });
}));

// GET /api/cash-approvals/statistics
router.get('/statistics', authMiddleware, asyncHandler(async (req, res) => {
  const stats = await CashApproval.getStatistics();
  res.json({ success: true, data: stats });
}));

// GET /api/cash-approvals/pending-finance  (for Finance view)
router.get('/pending-finance', authMiddleware, asyncHandler(async (req, res) => {
  const filter = {
    status: { $in: ['Pending Finance', 'Finance Authority Approved', 'Advance Issued', 'Payment Settled'] },
    ...optionalCompanyFilterFromRequest(req)
  };
  const data = await fullPopulate(
    CashApproval.find(filter).sort({ createdAt: -1 })
  );
  res.json({ success: true, data });
}));

// GET /api/cash-approvals/ceo-secretariat — same queue stages as PO (Payments / CEO flow)
router.get('/ceo-secretariat',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const isCoordinator = hasCeoSecretariatCoordinatorAccess(req.user);
    const isCeo = isDesignatedCeoApprover(req.user);
    const statuses = [];
    if (isCoordinator) {
      statuses.push(
        'Send to CEO Office',
        'Forwarded to CEO',
        'Returned from CEO Office',
        'Returned from CEO Secretariat',
        'Pending Finance',
        'Finance Authority Approved',
        'Advance Issued',
        'Evidence Submitted',
        'Payment Settled',
        'Sent to Procurement',
        'Completed',
        'Rejected'
      );
    }
    if (isCeo) {
      statuses.push('Forwarded to CEO', 'Returned from CEO Office');
    }

    let filter;
    if (statuses.length) {
      filter = { status: { $in: [...new Set(statuses)] } };
    } else {
      const indentIds = await getAssignedIndentIdsForUser(req.user.id);
      const tokens = getUserIdentityTokens(req.user);
      const authorityTextConditions = tokens.length ? [
        { 'approvalAuthorities.preparedBy': { $in: tokens } },
        { 'approvalAuthorities.verifiedBy': { $in: tokens } },
        { 'approvalAuthorities.authorisedRep': { $in: tokens } },
        { 'approvalAuthorities.financeRep': { $in: tokens } },
        { 'approvalAuthorities.managerProcurement': { $in: tokens } }
      ] : [];
      if (!indentIds.length && !authorityTextConditions.length) {
        return res.json({ success: true, data: [] });
      }
      filter = {
        status: {
          $in: [
            'Send to CEO Office',
            'Returned from CEO Office',
            'Returned from CEO Secretariat',
            'Pending Finance',
            'Advance Issued',
            'Evidence Submitted',
            'Payment Settled',
            'Sent to Procurement',
            'Completed',
            'Rejected'
          ]
        },
        $or: [
          ...(indentIds.length ? [{ indent: { $in: indentIds } }] : []),
          ...authorityTextConditions
        ]
      };
    }
    const list = await fullPopulate(
      CashApproval.find(filter).sort({ updatedAt: -1 })
    );
    res.json({ success: true, data: list });
  })
);

// GET /api/cash-approvals/:id
router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await fullPopulate(CashApproval.findById(req.params.id));
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  res.json({ success: true, data: ca });
}));

// POST /api/cash-approvals/:id/signed-check-upload
router.post('/:id/signed-check-upload', authMiddleware, signedCheckUpload.array('files', 5), asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (!hasFinanceAccess(req.user) && !['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Finance access required' });
  }
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return res.status(400).json({ success: false, message: 'At least one file is required' });
  const attachments = files.map((f) => ({
    filename: f.filename,
    originalName: f.originalname,
    url: `/uploads/procurement/cash-approvals/signed-checks/${f.filename}`,
    mimeType: f.mimetype,
    uploadedAt: new Date()
  }));
  ca.signedCheckAttachments = [
    ...(Array.isArray(ca.signedCheckAttachments) ? ca.signedCheckAttachments : []),
    ...attachments
  ];
  ca.updatedBy = req.user.id;
  await ca.save();
  res.json({ success: true, message: 'Signed check evidence uploaded', data: attachments });
}));

// POST /api/cash-approvals/:id/purchase-evidence-upload
router.post('/:id/purchase-evidence-upload', authMiddleware, purchaseEvidenceUpload.array('files', 10), asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const assignedAuthorityAccess = await isAssignedComparativeAuthorityUser(ca.indent, req.user.id);
  if (!hasProcurementAccess(req.user) && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'Procurement access required' });
  }
  if (!['Advance Issued', 'Evidence Submitted', 'Returned from Audit'].includes(ca.status)) {
    return res.status(400).json({ success: false, message: `Cannot upload purchase evidence in status: ${ca.status}` });
  }
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return res.status(400).json({ success: false, message: 'At least one file is required' });
  const attachments = files.map((f) => ({
    filename: f.filename,
    originalName: f.originalname,
    url: `/uploads/procurement/cash-approvals/purchase-evidence/${f.filename}`,
    mimeType: f.mimetype,
    uploadedAt: new Date()
  }));
  ca.purchaseReceipts = [
    ...(Array.isArray(ca.purchaseReceipts) ? ca.purchaseReceipts : []),
    ...attachments
  ];
  ca.updatedBy = req.user.id;
  await ca.save();
  res.json({ success: true, message: 'Purchase evidence uploaded', data: attachments });
}));

// PUT /api/cash-approvals/:id/signed-check-details
router.put('/:id/signed-check-details', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (!hasFinanceAccess(req.user) && !['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Finance access required' });
  }

  const { signedCheckNumber, signedCheckDate, signedCheckBankName, signedCheckRemarks } = req.body || {};
  ca.signedCheckNumber = signedCheckNumber || '';
  ca.signedCheckDate = signedCheckDate ? new Date(signedCheckDate) : null;
  ca.signedCheckBankName = signedCheckBankName || '';
  ca.signedCheckRemarks = signedCheckRemarks || '';
  ca.updatedBy = req.user.id;
  await ca.save();

  const updated = await fullPopulate(CashApproval.findById(ca._id));
  res.json({ success: true, message: 'Signed check details updated', data: updated });
}));

const applyAdvanceToName = async (doc, payeeId, explicitName) => {
  if (explicitName) {
    doc.advanceToName = explicitName;
    return;
  }
  if (!payeeId) return;
  const payee = await User.findById(payeeId).select('firstName lastName email').lean();
  if (payee) {
    doc.advanceToName = `${payee.firstName || ''} ${payee.lastName || ''}`.trim() || payee.email || '';
  }
};

// POST /api/cash-approvals
router.post('/', authMiddleware, maybeGeneralMultipart, asyncHandler(async (req, res) => {
  const { quotationId, submit, ...rawBody } = req.body;
  const body = { ...rawBody };
  if (body.items) body.items = parseJsonBodyField(body.items, []);
  if (body.approverIds) body.approverIds = parseJsonBodyField(body.approverIds, []);
  if (body.draftApproverIds) body.draftApproverIds = parseJsonBodyField(body.draftApproverIds, []);

  const isGeneralRequest =
    body.originatingModule === GENERAL_MODULE ||
    body.generalModule === true ||
    body.generalModule === 'true';

  if (isGeneralRequest) {
    if (!hasGeneralModuleAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'General module access required' });
    }
    body.items = mergeGeneralLineUploads(req.files, body.items || [], body);
    if (!body.requestingDepartment?.trim()) {
      body.requestingDepartment = String(req.user?.department || '').trim();
    }
    const shouldSubmit = submit === true || submit === 'true';
    const advanceRecipient = await resolveGeneralAdvanceRecipient(body, req.user.id);
    const built = buildGeneralCashApprovalDocument(body, req.user.id, advanceRecipient);
    if (!built.ok) {
      return res.status(400).json({ success: false, message: built.errors.join('; ') });
    }
    const { errors: submitErrors } = validateGeneralCashApprovalPayload(
      { ...body, ...advanceRecipient },
      { forSubmit: shouldSubmit }
    );
    if (shouldSubmit && submitErrors.length) {
      return res.status(400).json({ success: false, message: submitErrors.join('; ') });
    }
    const ca = new CashApproval({
      ...built.doc,
      status: shouldSubmit ? 'Pending Approval' : 'Draft',
      departmentApprovalStatus: shouldSubmit ? 'Submitted' : 'Draft'
    });
    await applyAdvanceToName(ca, built.doc.advanceTo, built.doc.advanceToName);
    if (shouldSubmit) {
      const approverIds = uniqueApproverIds(
        body.approverIds?.length ? body.approverIds : body.draftApproverIds
      );
      await applyGeneralSubmitApprovers(ca, approverIds, getActorId(req));
    } else if (body.draftApproverIds?.length) {
      ca.draftApproverIds = uniqueApproverIds(body.draftApproverIds);
    }
    await ca.save();
    pushHistory(
      ca,
      '—',
      ca.status,
      req.user.id,
      shouldSubmit
        ? 'Submitted from General module for Manager / HOD approval'
        : 'Saved as draft in General module',
      'General'
    );
    await ca.save();
    if (shouldSubmit) {
      await notifyNextGeneralDepartmentApprover(ca, req.user.id);
    }
    const saved = await fullPopulate(CashApproval.findById(ca._id));
    return res.status(201).json({
      success: true,
      message: shouldSubmit
        ? 'Cash Approval submitted for approval'
        : 'Cash Approval draft saved successfully',
      data: saved
    });
  }

  // Pre-fill from quotation if provided
  if (quotationId) {
    const quotation = await Quotation.findById(quotationId).populate('indent');
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });
    body.vendor = body.vendor || quotation.vendor;
    body.indent = body.indent || (quotation.indent?._id || quotation.indent);
    body.quotation = quotationId;
    if (!body.items || !body.items.length) {
      body.items = (quotation.items || []).map((item) => ({
        description: item.description || item.name || '',
        specification: item.specification || '',
        brand: item.brand || '',
        quantity: item.quantity || 1,
        unit: item.unit || 'pcs',
        unitPrice: item.unitPrice || item.price || 0,
        taxRate: item.taxRate || 0,
        discount: item.discount || 0,
        amount: ((item.quantity || 1) * (item.unitPrice || item.price || 0)) - (item.discount || 0)
      }));
    }
    if (!body.notes && quotation.notes) body.notes = quotation.notes;
    // Pre-fill approval authorities from comparative statement approvals on indent
    if (quotation.indent && quotation.indent.comparativeStatementApprovals) {
      const csa = quotation.indent.comparativeStatementApprovals;
      body.approvalAuthorities = body.approvalAuthorities || {};
      body.approvalAuthorities.preparedBy = body.approvalAuthorities.preparedBy || csa.preparedBy || '';
      body.approvalAuthorities.verifiedBy = body.approvalAuthorities.verifiedBy || csa.verifiedBy || '';
      body.approvalAuthorities.authorisedRep = body.approvalAuthorities.authorisedRep || csa.authorisedRep || '';
      body.approvalAuthorities.financeRep = body.approvalAuthorities.financeRep || csa.financeRep || '';
      body.approvalAuthorities.managerProcurement = body.approvalAuthorities.managerProcurement || csa.managerProcurement || '';
    }
  }

  if (body.items) {
    const parsedItems = parseJsonBodyField(body.items, []);
    body.items = mergeCashApprovalLineUploads(req.files, parsedItems, body, {
      publicPath: CASH_APPROVAL_LINE_UPLOAD_PREFIX
    });
  }

  const ca = new CashApproval({ ...body, status: 'Pending Approval', createdBy: req.user.id });
  await ca.save();
  pushHistory(ca, '—', 'Pending Approval', req.user.id, 'Created in Procurement and submitted for authority approval', 'Procurement');
  await ca.save();
  const saved = await fullPopulate(CashApproval.findById(ca._id));
  res.status(201).json({ success: true, message: 'Cash Approval created successfully', data: saved });
}));

// PUT /api/cash-approvals/:id
router.put('/:id', authMiddleware, maybeGeneralMultipart, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });

  if (isGeneralCashApproval(ca)) {
    const isFinanceEdit = FINANCE_EDITABLE_STATUSES.includes(ca.status)
      && (hasFinanceAccess(req.user) || ['super_admin', 'admin'].includes(req.user.role));

    if (isFinanceEdit) {
      const body = { ...req.body };
      if (body.notes !== undefined) ca.notes = body.notes;
      if (body.purpose !== undefined) ca.purpose = body.purpose;
      try {
        await applyFinanceEditExtras(ca, body, req.user.id);
      } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message });
      }
      ca.updatedBy = req.user.id;
      await ca.save();
      const updated = await fullPopulate(CashApproval.findById(ca._id));
      return res.json({ success: true, message: 'Cash Approval updated', data: updated });
    }

    if (!canManageGeneralCashApproval(req.user, ca) && !hasGeneralModuleAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Not allowed to edit this cash approval' });
    }
    if (!isGeneralCashApprovalEditable(ca)) {
      return res.status(400).json({ success: false, message: `Cannot edit cash approval in "${ca.status}" status` });
    }
    const body = { ...req.body };
    if (body.items) {
      body.items = mergeGeneralLineUploads(
        req.files,
        parseJsonBodyField(body.items, ca.items || []),
        body
      );
    }
    const merged = {
      purpose: body.purpose ?? ca.purpose,
      notes: body.notes ?? ca.notes,
      internalNotes: body.internalNotes ?? ca.internalNotes,
      priority: body.priority ?? ca.priority,
      approvalDate: body.approvalDate ?? ca.approvalDate,
      expectedPurchaseDate: body.expectedPurchaseDate ?? ca.expectedPurchaseDate,
      requestingDepartment: body.requestingDepartment ?? ca.requestingDepartment,
      advanceTo: body.advanceTo ?? ca.advanceTo?._id ?? ca.advanceTo,
      advanceToName: body.advanceToName ?? ca.advanceToName,
      discountAmount: body.discountAmount !== undefined ? Number(body.discountAmount) || 0 : ca.discountAmount,
      shippingCost: body.shippingCost ?? ca.shippingCost,
      items: body.items ?? ca.items
    };
    let advanceRecipient = null;
    if (body.advanceToEmployee || body.advanceToEmployeeId) {
      advanceRecipient = await resolveGeneralAdvanceRecipient(body, req.user.id);
    } else if (ca.advanceToEmployee) {
      advanceRecipient = {
        advanceToEmployee: ca.advanceToEmployee,
        advanceTo: ca.advanceTo,
        advanceToName: ca.advanceToName,
        advanceGlAccount: ca.advanceGlAccount,
        advanceGlAccountNumber: ca.advanceGlAccountNumber
      };
    }
    const mergedWithAdvance = advanceRecipient ? { ...merged, ...advanceRecipient } : merged;
    const { errors } = validateGeneralCashApprovalPayload(mergedWithAdvance, { forSubmit: false });
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join('; ') });
    }
    const totals = resolveGeneralCashApprovalTotals(merged);
    Object.assign(ca, {
      purpose: merged.purpose,
      notes: merged.notes,
      internalNotes: merged.internalNotes,
      priority: merged.priority,
      approvalDate: merged.approvalDate,
      expectedPurchaseDate: merged.expectedPurchaseDate || merged.approvalDate,
      requestingDepartment: merged.requestingDepartment,
      advanceAmount: totals.totalAmount,
      ...totals
    });
    if (advanceRecipient) {
      Object.assign(ca, advanceRecipient);
    }
    if (body.draftApproverIds) {
      ca.draftApproverIds = uniqueApproverIds(parseJsonBodyField(body.draftApproverIds, []));
    }
    const shouldResubmit = body.resubmit === true || body.resubmit === 'true';
    if (shouldResubmit) {
      const resubmitTarget = resolveGeneralResubmitTarget(ca);
      const skipApproverIds = resubmitTarget.stage !== 'department';
      const approverIds = uniqueApproverIds(
        parseJsonBodyField(body.approverIds, ca.draftApproverIds?.map((id) => String(id._id || id)) || [])
      );
      const payload = {
        purpose: ca.purpose,
        requestingDepartment: ca.requestingDepartment,
        advanceToEmployee: ca.advanceToEmployee?._id || ca.advanceToEmployee,
        advanceGlAccount: ca.advanceGlAccount?._id || ca.advanceGlAccount,
        items: ca.items,
        discountAmount: ca.discountAmount,
        shippingCost: ca.shippingCost,
        approverIds,
        skipApproverIds
      };
      const { errors: resubmitErrors } = validateGeneralCashApprovalPayload(payload, { forSubmit: true });
      if (resubmitErrors.length) {
        return res.status(400).json({ success: false, message: resubmitErrors.join('; ') });
      }
      const previousStatus = ca.status;
      const target = await applyGeneralResubmit(ca, approverIds, getActorId(req), {
        buildChangeSummary: buildCAChangeSummary
      });
      pushHistory(ca, previousStatus, target.status, req.user.id, target.historyComment, 'General');
      await notifyAfterGeneralResubmit(ca, req.user.id, target);
    }
    ca.updatedBy = req.user.id;
    await ca.save();
    const updated = await fullPopulate(CashApproval.findById(ca._id));
    return res.json({
      success: true,
      message: shouldResubmit
        ? 'Cash Approval updated and resubmitted for approval'
        : 'Cash Approval updated',
      data: updated
    });
  }

  const isProcurementEditable = PROCUREMENT_EDITABLE_STATUSES.includes(ca.status);
  const isFinanceEditable = FINANCE_EDITABLE_STATUSES.includes(ca.status)
    && (hasFinanceAccess(req.user) || ['super_admin', 'admin'].includes(req.user.role));
  if (!isProcurementEditable && !isFinanceEditable) {
    return res.status(400).json({ success: false, message: `Cannot edit a Cash Approval in "${ca.status}" status` });
  }
  const {
    status: _s,
    caNumber: _n,
    createdBy: _c,
    workflowHistory: _w,
    originatingModule: _om,
    financeApprovalAuthorities: _fa,
    signedCheckNumber: _scn,
    signedCheckDate: _scd,
    signedCheckBankName: _scb,
    signedCheckRemarks: _scr,
    advanceAmount: _aa,
    advancePaymentMethod: _apm,
    advanceRemarks: _ar,
    advanceVoucherNo: _avn,
    financeVerificationNotes: _fvn,
    settlementRemarks: _sr,
    internalNotes: _in,
    advanceTo: _at,
    advanceToName: _atn,
    ...updates
  } = req.body;

  if (updates.items) {
    updates.items = mergeCashApprovalLineUploads(
      req.files,
      parseJsonBodyField(updates.items, ca.items || []),
      req.body,
      { publicPath: CASH_APPROVAL_LINE_UPLOAD_PREFIX }
    );
  }

  if (updates.approvalAuthorities && typeof updates.approvalAuthorities === 'string') {
    updates.approvalAuthorities = parseJsonBodyField(updates.approvalAuthorities, ca.approvalAuthorities || {});
  }

  Object.assign(ca, updates);

  if (isFinanceEditable) {
    try {
      await applyFinanceEditExtras(ca, req.body, req.user.id);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  ca.updatedBy = req.user.id;
  await ca.save();
  const updated = await fullPopulate(CashApproval.findById(ca._id));
  res.json({ success: true, message: 'Cash Approval updated', data: updated });
}));

// PUT /api/cash-approvals/:id/submit — General module draft → Manager / HOD queue
router.put('/:id/submit', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (!isGeneralCashApproval(ca)) {
    return res.status(400).json({ success: false, message: 'Submit endpoint is only for General module cash approvals' });
  }
  if (!canManageGeneralCashApproval(req.user, ca)) {
    return res.status(403).json({ success: false, message: 'Not allowed to submit this cash approval' });
  }
  const isResubmit = isGeneralCashApprovalResubmitState(ca);
  if (!isResubmit && ca.status !== 'Draft') {
    return res.status(400).json({
      success: false,
      message: `Only draft or rejected cash approvals can be submitted (current status: ${ca.status})`
    });
  }
  const resubmitTarget = isResubmit ? resolveGeneralResubmitTarget(ca) : null;
  const skipApproverIds = resubmitTarget && resubmitTarget.stage !== 'department';
  const approverIds = uniqueApproverIds(
    req.body?.approverIds || ca.draftApproverIds?.map((id) => String(id._id || id)) || []
  );
  const payload = {
    purpose: ca.purpose,
    requestingDepartment: ca.requestingDepartment,
    advanceToEmployee: ca.advanceToEmployee?._id || ca.advanceToEmployee,
    advanceGlAccount: ca.advanceGlAccount?._id || ca.advanceGlAccount,
    items: ca.items,
    discountAmount: ca.discountAmount,
    shippingCost: ca.shippingCost,
    approverIds,
    skipApproverIds
  };
  const { errors } = validateGeneralCashApprovalPayload(payload, { forSubmit: true });
  if (errors.length) {
    return res.status(400).json({ success: false, message: errors.join('; ') });
  }

  if (isResubmit) {
    const previousStatus = ca.status;
    const target = await applyGeneralResubmit(ca, approverIds, getActorId(req), {
      buildChangeSummary: buildCAChangeSummary
    });
    pushHistory(ca, previousStatus, target.status, req.user.id, target.historyComment, 'General');
    ca.updatedBy = req.user.id;
    await ca.save();
    await notifyAfterGeneralResubmit(ca, req.user.id, target);
    const updated = await fullPopulate(CashApproval.findById(ca._id));
    return res.json({
      success: true,
      message: `Cash Approval resubmitted to ${target.label}`,
      data: updated
    });
  }

  await applyGeneralSubmitApprovers(ca, approverIds, getActorId(req));
  pushHistory(ca, 'Draft', 'Pending Approval', req.user.id, 'Submitted from General module for Manager / HOD approval', 'General');
  ca.updatedBy = req.user.id;
  await ca.save();
  await notifyNextGeneralDepartmentApprover(ca, req.user.id);
  const updated = await fullPopulate(CashApproval.findById(ca._id));
  res.json({
    success: true,
    message: 'Cash Approval submitted for approval',
    data: updated
  });
}));

// DELETE /api/cash-approvals/:id
router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (isGeneralCashApproval(ca)) {
    if (!canManageGeneralCashApproval(req.user, ca) && !['super_admin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not allowed to delete this cash approval' });
    }
  } else if (!['super_admin', 'admin', 'procurement_manager'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Procurement manager access required' });
  }
  if (!['Pending Approval', 'Draft', 'Cancelled', 'Rejected'].includes(ca.status)) {
    return res.status(400).json({ success: false, message: 'Only Draft, Cancelled, or Rejected Cash Approvals can be deleted' });
  }
  await CashApproval.deleteOne({ _id: ca._id });
  res.json({ success: true, message: 'Cash Approval deleted' });
}));

// ─── Workflow Actions ─────────────────────────────────────────────────────────

// Phase 3: Authority Approve (assigned authority -> move to Pending Audit)
router.put('/:id/approve', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (ca.status !== 'Pending Approval') {
    return res.status(400).json({ success: false, message: 'Only pending cash approvals can be approved' });
  }

  if (isGeneralCashApproval(ca)) {
    const userId = getActorId(req);
    if (String(ca.createdBy) === userId) {
      return res.status(403).json({
        success: false,
        message: 'Requester cannot approve Manager or Head Of Department approval authority'
      });
    }
    const isAdmin = ['super_admin', 'admin'].includes(req.user.role);
    let pendingIndex = getActorPendingDepartmentStepIndex(ca.departmentApprovalChain, userId);
    if (pendingIndex === -1 && isAdmin) {
      pendingIndex = getFirstPendingDepartmentStepIndex(ca.departmentApprovalChain);
    }
    if (pendingIndex === -1) {
      return res.status(403).json({
        success: false,
        message: 'You are not the current pending approval authority for this request (Manager approves first, then Head of Department)'
      });
    }
    ca.departmentApprovalChain[pendingIndex].status = 'approved';
    ca.departmentApprovalChain[pendingIndex].actedAt = new Date();
    if (req.body?.comments) ca.departmentApprovalChain[pendingIndex].comment = req.body.comments;
    const allApproved = (ca.departmentApprovalChain || []).every((step) => step.status === 'approved');
    if (allApproved) {
      ca.departmentApprovalStatus = 'Approved';
      ca.departmentApprovedBy = req.user.id;
      ca.departmentApprovedAt = new Date();
      pushHistory(ca, 'Pending Approval', 'Pending Audit', req.user.id, 'Sent to Pre-Audit after Manager / HOD approval', 'General');
      ca.status = 'Pending Audit';
      const recipients = await getAuditRecipients();
      await notify({
        recipientIds: recipients,
        actorId: req.user.id,
        title: 'General Cash Approval pending Audit review',
        message: `Cash Approval ${ca.caNumber} received Manager / HOD approval and is now in Pre-Audit queue.`,
        actionUrl: '/audit',
        entityId: ca._id,
        module: 'general'
      });
    } else {
      pushHistory(ca, 'Pending Approval', 'Pending Approval', req.user.id, req.body?.comments || 'Approval authority approved', 'General');
    }
    ca.updatedBy = req.user.id;
    await ca.save();
    if (!allApproved) {
      await notifyNextGeneralDepartmentApprover(ca, req.user.id);
    }
    const message = allApproved
      ? 'All approvals completed. Cash Approval sent to Pre-Audit'
      : 'Approval recorded. Next approver has been notified';
    return res.json({ success: true, message, data: await fullPopulate(CashApproval.findById(ca._id)) });
  }

  const assignedAuthorityAccess =
    await isAssignedComparativeAuthorityUser(ca.indent, req.user.id) ||
    isAssignedByAuthorityText(ca.approvalAuthorities, req.user);
  const isAdmin = ['super_admin', 'admin'].includes(req.user.role);
  if (!isAdmin && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'Only assigned authority can approve this cash approval' });
  }
  const requiredSlots = await getRequiredAuthoritySlots(ca.indent, ca.approvalAuthorities);
  if (!requiredSlots.length) {
    return res.status(400).json({ success: false, message: 'No approval authorities configured on this cash approval' });
  }
  const matchedSlots = matchUserToAuthoritySlots(requiredSlots, req.user);
  if (!matchedSlots.length) {
    return res.status(400).json({ success: false, message: 'Your user is not mapped to any pending authority slot' });
  }
  const approvals = Array.isArray(ca.authorityApprovals) ? [...ca.authorityApprovals] : [];
  const approvedKeys = new Set(approvals.map((a) => String(a?.authorityKey || '').trim()).filter(Boolean));
  const pendingMatchedSlots = matchedSlots.filter((slot) => !approvedKeys.has(slot.key));
  if (!pendingMatchedSlots.length) {
    return res.status(400).json({ success: false, message: 'You have already approved your assigned authority slot(s)' });
  }
  const now = new Date();
  pendingMatchedSlots.forEach((slot) => {
    approvals.push({
      authorityKey: slot.key,
      authorityLabel: slot.label,
      approver: req.user.id,
      approvedAt: now,
      comments: req.body.comments || ''
    });
  });
  ca.authorityApprovals = approvals;
  const requiredKeys = new Set(requiredSlots.map((s) => s.key));
  const updatedApprovedKeys = new Set(ca.authorityApprovals.map((a) => String(a?.authorityKey || '').trim()).filter(Boolean));
  const allApproved = [...requiredKeys].every((key) => updatedApprovedKeys.has(key));
  ca.authorityApprovedBy = req.user.id;
  ca.authorityApprovedAt = now;
  ca.authorityApprovalComments = req.body.comments || '';
  if (allApproved) {
    pushHistory(ca, 'Pending Approval', 'Pending Audit', req.user.id, req.body.comments || 'All assigned authorities approved and sent to Pre-Audit', 'Procurement');
    ca.status = 'Pending Audit';
  } else {
    const remaining = requiredSlots.length - updatedApprovedKeys.size;
    pushHistory(ca, 'Pending Approval', 'Pending Approval', req.user.id, req.body.comments || `Authority approval recorded. ${remaining} approval(s) remaining.`, 'Procurement');
  }
  ca.updatedBy = req.user.id;
  await ca.save();
  if (allApproved) {
    const recipients = await getAuditRecipients();
    await notify({
      recipientIds: recipients,
      actorId: req.user.id,
      title: 'Cash Approval pending Audit review',
      message: `Cash Approval ${ca.caNumber} received all authority approvals and is now waiting in Pre-Audit queue.`,
      actionUrl: '/audit',
      entityId: ca._id
    });
  }
  const remaining = requiredSlots.length - updatedApprovedKeys.size;
  const message = allApproved
    ? 'All authority approvals completed. Cash Approval sent to Pre-Audit successfully'
    : `Authority approval recorded successfully. ${remaining} approval(s) remaining before Pre-Audit`;
  res.json({ success: true, message, data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 3: Authority Reject
router.put('/:id/reject', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (ca.status !== 'Pending Approval') {
    return res.status(400).json({ success: false, message: 'Only pending cash approvals can be rejected' });
  }

  if (isGeneralCashApproval(ca)) {
    const reason = String(req.body?.rejectionReason || req.body?.rejectionComments || req.body?.comments || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }
    const userId = getActorId(req);
    const isAdmin = ['super_admin', 'admin'].includes(req.user.role);
    let pendingIndex = getActorPendingDepartmentStepIndex(ca.departmentApprovalChain, userId);
    if (pendingIndex === -1 && isAdmin) {
      pendingIndex = getFirstPendingDepartmentStepIndex(ca.departmentApprovalChain);
    }
    if (pendingIndex === -1) {
      return res.status(403).json({
        success: false,
        message: 'You are not the current pending approval authority for this request'
      });
    }
    ca.departmentApprovalChain[pendingIndex].status = 'rejected';
    ca.departmentApprovalChain[pendingIndex].actedAt = new Date();
    ca.departmentApprovalChain[pendingIndex].comment = reason;
    ca.departmentApprovalStatus = 'Rejected';
    ca.departmentRejectedBy = req.user.id;
    ca.departmentRejectedAt = new Date();
    ca.departmentRejectionReason = reason;
    pushHistory(ca, 'Pending Approval', 'Rejected', req.user.id, reason, 'General');
    ca.status = 'Rejected';
    ca.returnedFromStatus = 'Pending Approval';
    ca.updatedBy = req.user.id;
    await ca.save();
    return res.json({ success: true, message: 'Cash Approval rejected', data: await fullPopulate(CashApproval.findById(ca._id)) });
  }

  const assignedAuthorityAccess =
    await isAssignedComparativeAuthorityUser(ca.indent, req.user.id) ||
    isAssignedByAuthorityText(ca.approvalAuthorities, req.user);
  const isAdmin = ['super_admin', 'admin'].includes(req.user.role);
  if (!isAdmin && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'Only assigned authority can reject this cash approval' });
  }
  const rejectMsg = req.body?.rejectionComments || req.body?.comments || '';
  pushHistory(ca, 'Pending Approval', 'Rejected', req.user.id, rejectMsg || 'Rejected by assigned authority', 'Procurement');
  ca.status = 'Rejected';
  ca.returnedFromStatus = 'Pending Approval';
  ca.auditRejectionComments = rejectMsg;
  ca.updatedBy = req.user.id;
  await ca.save();
  res.json({ success: true, message: 'Cash Approval rejected successfully', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 4: Send to Audit (Draft / audit-return only — other returns use resubmit-after-return)
router.put('/:id/send-to-audit', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasProcurementAccess(req.user)) {
    return res.status(403).json({ success: false, message: 'Procurement access required' });
  }
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const allowed = ['Draft', 'Returned from Audit'];
  if (!allowed.includes(ca.status)) {
    // Rejected / CEO returns: route back to the rejector, not always Audit
    if (['Rejected', 'Returned from CEO Office', 'Returned from CEO Secretariat'].includes(ca.status)) {
      return res.status(400).json({
        success: false,
        message: 'Use resubmit-after-return so the request goes back to the stage that returned or rejected it'
      });
    }
    return res.status(400).json({ success: false, message: `Cannot send to audit from status: ${ca.status}` });
  }

  if (ca.status === 'Returned from Audit' && req.body.observationAnswers) {
    const { observationAnswers } = req.body;
    if (Array.isArray(observationAnswers) && ca.auditObservations && ca.auditObservations.length > 0) {
      observationAnswers.forEach(({ observationId, answer }) => {
        const observation = ca.auditObservations.id(observationId);
        if (observation && answer && answer.trim()) {
          observation.answer = answer.trim();
          observation.answeredBy = req.user.id;
          observation.answeredAt = new Date();
          observation.resolved = true;
        }
      });
    }
  }
  if (ca.status === 'Returned from Audit') {
    const snapshot = ca.auditSnapshotAtReturn;
    if (snapshot && (ca.items || []).length >= 0) {
      const summary = buildCAChangeSummary(ca.items, snapshot);
      ca.resubmissionChangeSummary = summary || ca.resubmissionChangeSummary || '';
    }
  }

  const prev = ca.status;
  pushHistory(ca, prev, 'Pending Audit', req.user.id, req.body.comments || 'Sent to Pre-Audit', 'Procurement');
  ca.status = 'Pending Audit';
  ca.returnedFromStatus = '';
  ca.updatedBy = req.user.id;
  await ca.save();
  const recipients = await getAuditRecipients();
  await notify({
    recipientIds: recipients,
    actorId: req.user.id,
    title: 'Cash Approval pending Audit review',
    message: `Cash Approval ${ca.caNumber} moved to Audit queue. Please review in Pre-Audit.`,
    actionUrl: '/audit',
    entityId: ca._id,
    metadata: { queueStage: 'pending_audit', targetModule: 'audit', targetTab: 'pre_audit' }
  });
  res.json({ success: true, message: 'Cash Approval sent to Audit', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Resubmit after return/reject → back to rejector stage; prior approvals stay intact
router.put('/:id/resubmit-after-return', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });

  const returnOrReject = ['Rejected', 'Returned from Audit', 'Returned from CEO Office', 'Returned from CEO Secretariat'];
  if (!returnOrReject.includes(ca.status)) {
    return res.status(400).json({
      success: false,
      message: `Only returned or rejected cash approvals can be resubmitted (current: ${ca.status})`
    });
  }

  if (isGeneralCashApproval(ca)) {
    if (!canManageGeneralCashApproval(req.user, ca)) {
      return res.status(403).json({ success: false, message: 'Not allowed to resubmit this cash approval' });
    }
    const approverIds = uniqueApproverIds(
      req.body?.approverIds || ca.draftApproverIds?.map((id) => String(id._id || id)) || []
    );
    const previousStatus = ca.status;
    const target = await applyGeneralResubmit(ca, approverIds, getActorId(req), {
      buildChangeSummary: buildCAChangeSummary
    });
    pushHistory(
      ca,
      previousStatus,
      target.status,
      req.user.id,
      req.body?.comments || target.historyComment,
      'General'
    );
    ca.updatedBy = req.user.id;
    await ca.save();
    await notifyAfterGeneralResubmit(ca, req.user.id, target);
    return res.json({
      success: true,
      message: `Cash Approval resubmitted to ${target.label}`,
      data: await fullPopulate(CashApproval.findById(ca._id))
    });
  }

  if (!hasProcurementAccess(req.user) && String(ca.createdBy) !== String(req.user.id)) {
    return res.status(403).json({ success: false, message: 'Not allowed to resubmit this cash approval' });
  }

  if (req.body?.observationAnswers && Array.isArray(req.body.observationAnswers) && ca.auditObservations?.length) {
    req.body.observationAnswers.forEach(({ observationId, answer }) => {
      const observation = ca.auditObservations.id(observationId);
      if (observation && answer && String(answer).trim()) {
        observation.answer = String(answer).trim();
        observation.answeredBy = req.user.id;
        observation.answeredAt = new Date();
        observation.resolved = true;
      }
    });
  }

  const previousStatus = ca.status;
  const target = applyProcurementResubmit(ca);
  pushHistory(
    ca,
    previousStatus,
    target.status,
    req.user.id,
    req.body?.comments || `Resubmitted to ${target.label} (prior approvals preserved)`,
    'Procurement'
  );
  ca.updatedBy = req.user.id;
  await ca.save();

  if (target.stage === 'audit') {
    const recipients = await getAuditRecipients();
    await notify({
      recipientIds: recipients,
      actorId: req.user.id,
      title: 'Cash Approval pending Audit review',
      message: `Cash Approval ${ca.caNumber} was corrected and resubmitted to Pre-Audit.`,
      actionUrl: '/audit',
      entityId: ca._id,
      metadata: { queueStage: 'pending_audit', targetModule: 'audit', targetTab: 'pre_audit' }
    });
  } else if (target.stage === 'ceo_secretariat') {
    const recipients = await getCeoSecretariatRecipients();
    await notify({
      recipientIds: recipients,
      actorId: req.user.id,
      title: 'Cash Approval pending CEO Secretariat review',
      message: `Cash Approval ${ca.caNumber} was corrected and resubmitted to CEO Secretariat.`,
      actionUrl: '/procurement/cash-approvals',
      entityId: ca._id
    });
  } else if (target.stage === 'ceo') {
    const recipients = await getCeoRecipients();
    await notify({
      recipientIds: recipients,
      actorId: req.user.id,
      title: 'Cash Approval pending CEO approval',
      message: `Cash Approval ${ca.caNumber} was corrected and resubmitted to CEO.`,
      actionUrl: '/procurement/cash-approvals',
      entityId: ca._id
    });
  } else if (target.stage === 'finance') {
    const recipients = await getFinanceRecipients();
    await notify({
      recipientIds: recipients,
      actorId: req.user.id,
      title: 'Cash Approval pending Finance review',
      message: `Cash Approval ${ca.caNumber} was corrected and resubmitted to Finance.`,
      actionUrl: '/procurement/cash-approvals',
      entityId: ca._id
    });
  }

  res.json({
    success: true,
    message: `Cash Approval resubmitted to ${target.label}`,
    data: await fullPopulate(CashApproval.findById(ca._id))
  });
}));

// Phase 4a: Audit initial approval (Pre-Audit assistant)
router.put('/:id/audit-approve', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasAuditAccess(req.user)) {
    return res.status(403).json({ success: false, message: 'Audit access required' });
  }
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });

  const approvalText = req.body.approvalComments || req.body.comments || '';
  const stampMeta = resolveAuditStampMeta(req);

  // Step 1: Initial pre-audit approval (assistant/auditor)
  if (ca.status === 'Pending Audit') {
    if (!canPerformInitialPreAuditActions(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Initial approval must be done by General Audit / pre-audit staff, not the Audit Director.'
      });
    }
    const initialAt = new Date();
    ca.preAuditInitialApprovedBy = req.user.id;
    ca.preAuditInitialApprovedAt = initialAt;
    ca.preAuditInitialComments = approvalText;
    upsertCaAuthorityApproval(ca, {
      key: 'preAuditInitial',
      label: 'Pre-Audit Authority',
      approverId: req.user.id,
      approvedAt: initialAt,
      comments: approvalText || 'Initial pre-audit approval recorded'
    });
    ca.updatedBy = req.user.id;
    pushHistory(
      ca,
      'Pending Audit',
      'Pending Audit',
      req.user.id,
      approvalText || 'Initial pre-audit approval recorded',
      'Pre-Audit',
      stampMeta
    );
    await ca.save();
    return res.json({ success: true, message: 'Initial pre-audit approval recorded. Forward to Audit Director for final approval.', data: await fullPopulate(CashApproval.findById(ca._id)) });
  }

  // Step 2: Audit Director final approval
  if (ca.status !== 'Forwarded to Audit Director') {
    return res.status(400).json({ success: false, message: 'Must be in "Forwarded to Audit Director" status for final approval.' });
  }
  if (!canActAsAuditDirector(req.user)) {
    return res.status(403).json({ success: false, message: 'Only Audit Director can provide final approval.' });
  }
  const isSettlementFlow = Boolean(ca.advanceIssuedAt && ca.evidenceSubmittedAt);
  if (isSettlementFlow) {
    pushHistory(
      ca,
      'Forwarded to Audit Director',
      'Pending Finance',
      req.user.id,
      approvalText || 'Settlement bill audit-approved and sent to Finance',
      'Pre-Audit',
      stampMeta
    );
    ca.status = 'Pending Finance';
  } else {
    pushHistory(
      ca,
      'Forwarded to Audit Director',
      'Send to CEO Office',
      req.user.id,
      approvalText,
      'Pre-Audit',
      stampMeta
    );
    ca.status = 'Send to CEO Office';
  }
  const directorAt = new Date();
  ca.auditApprovedBy = req.user.id;
  ca.auditApprovedAt = directorAt;
  ca.auditRemarks = approvalText;
  upsertCaAuthorityApproval(ca, {
    key: 'auditDirectorApproval',
    label: 'Audit Director',
    approverId: req.user.id,
    approvedAt: directorAt,
    comments: approvalText || (isSettlementFlow ? 'Settlement bill audit-approved' : 'Audit director approved')
  });
  ca.updatedBy = req.user.id;
  await ca.save();
  if (isSettlementFlow) {
    const financeRecipients = await getFinanceRecipients();
    await notify({
      recipientIds: financeRecipients,
      actorId: req.user.id,
      title: 'Settlement bill pending Finance',
      message: `Cash Approval ${ca.caNumber} settlement bill is audit-approved and pending Finance adjustment.`,
      actionUrl: '/procurement/cash-approvals',
      entityId: ca._id,
      entityType: 'CashApproval',
      module: 'finance',
      metadata: {
        queueStage: 'pending_finance_settlement',
        targetModule: 'finance',
        targetTab: 'cash_approvals'
      }
    });
    return res.json({ success: true, message: 'Settlement bill audit-approved and sent to Finance', data: await fullPopulate(CashApproval.findById(ca._id)) });
  }
  const ceoRecipients = await getCeoSecretariatRecipients();
  await notify({
    recipientIds: ceoRecipients,
    actorId: req.user.id,
    title: 'Cash Approval pending CEO Secretariat',
    message: `Cash Approval ${ca.caNumber} is audit-approved and now waiting in CEO Secretariat queue (Payments).`,
    actionUrl: '/procurement/cash-approvals',
    entityId: ca._id,
    entityType: 'CashApproval',
    module: 'procurement',
    metadata: {
      queueStage: 'send_to_ceo_office',
      targetModule: 'general',
      targetTab: 'ceo_secretariat_payments'
    }
  });
  res.json({ success: true, message: 'Cash Approval audit-approved and sent to CEO Office', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 4b: Forward to Audit Director
router.put('/:id/forward-to-audit-director', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasAuditAccess(req.user)) return res.status(403).json({ success: false, message: 'Audit access required' });
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (ca.status !== 'Pending Audit') return res.status(400).json({ success: false, message: 'Cash Approval must be in Pending Audit status' });
  if (!ca.preAuditInitialApprovedBy) return res.status(400).json({ success: false, message: 'Initial pre-audit approval required before forwarding to Audit Director' });
  pushHistory(ca, 'Pending Audit', 'Forwarded to Audit Director', req.user.id, req.body.comments || 'Forwarded to Audit Director', 'Pre-Audit');
  ca.status = 'Forwarded to Audit Director';
  ca.updatedBy = req.user.id;
  await ca.save();
  res.json({ success: true, message: 'Forwarded to Audit Director', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 4c: Audit reject
router.put('/:id/audit-reject', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasAuditAccess(req.user)) return res.status(403).json({ success: false, message: 'Audit access required' });
  const { rejectionComments, observations } = req.body;
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (!['Pending Audit', 'Forwarded to Audit Director'].includes(ca.status)) {
    return res.status(400).json({ success: false, message: 'Can only reject from Pending Audit or Forwarded to Audit Director' });
  }
  const rejectMsg = rejectionComments || req.body.comments || 'Rejected with observations';
  const auditFromStatus = ca.status;
  pushHistory(ca, auditFromStatus, 'Rejected', req.user.id, rejectMsg, 'Pre-Audit');
  ca.status = 'Rejected';
  ca.returnedFromStatus = auditFromStatus === 'Forwarded to Audit Director'
    ? 'Forwarded to Audit Director'
    : 'Pending Audit';
  ca.auditRejectedBy = req.user.id;
  ca.auditRejectedAt = new Date();
  ca.auditRejectionComments = rejectionComments || req.body.comments || '';
  ca.auditSnapshotAtReturn = {
    items: JSON.parse(JSON.stringify(ca.items || [])),
    totalAmount: ca.totalAmount,
    subtotal: ca.subtotal
  };
  if (observations && Array.isArray(observations) && observations.length > 0) {
    ca.auditObservations = ca.auditObservations || [];
    observations.forEach((obs) => {
      ca.auditObservations.push({
        observation: typeof obs === 'string' ? obs : (obs.observation || obs.text || ''),
        severity: (typeof obs === 'object' && obs.severity ? obs.severity : 'medium').toLowerCase(),
        addedBy: req.user.id,
        addedAt: new Date(),
        resolved: false
      });
    });
  }
  ca.updatedBy = req.user.id;
  await ca.save();
  const procRecipients = await getProcurementRecipients();
  const rejectUrl = isGeneralCashApproval(ca)
    ? `/general/cash-approvals/${ca._id}`
    : '/procurement/cash-approvals';
  await notify({
    recipientIds: [String(ca.createdBy || ''), ...procRecipients].filter(Boolean),
    actorId: req.user.id,
    title: 'Cash Approval Rejected by Audit',
    message: `Cash Approval ${ca.caNumber} was rejected by Audit. Reason: ${rejectMsg}`,
    actionUrl: rejectUrl,
    entityId: ca._id
  });
  res.json({ success: true, message: 'Cash Approval rejected by Audit', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 4d: Audit return
router.put('/:id/audit-return', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasAuditAccess(req.user)) return res.status(403).json({ success: false, message: 'Audit access required' });
  const { returnComments, observations } = req.body;
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (!['Pending Audit', 'Forwarded to Audit Director'].includes(ca.status)) {
    return res.status(400).json({ success: false, message: 'Can only return from Pending Audit or Forwarded to Audit Director' });
  }
  const retMsg = returnComments || req.body.comments || '';
  const auditFromStatus = ca.status;
  pushHistory(ca, auditFromStatus, 'Returned from Audit', req.user.id, retMsg, 'Pre-Audit');
  ca.status = 'Returned from Audit';
  ca.returnedFromStatus = auditFromStatus === 'Forwarded to Audit Director'
    ? 'Forwarded to Audit Director'
    : 'Pending Audit';
  ca.auditReturnedBy = req.user.id;
  ca.auditReturnedAt = new Date();
  ca.auditReturnComments = retMsg;
  ca.auditSnapshotAtReturn = {
    items: JSON.parse(JSON.stringify(ca.items || [])),
    totalAmount: ca.totalAmount,
    subtotal: ca.subtotal
  };
  if (observations && Array.isArray(observations) && observations.length > 0) {
    ca.auditObservations = ca.auditObservations || [];
    observations.forEach((obs) => {
      ca.auditObservations.push({
        observation: obs.observation || obs.text || obs,
        severity: (obs.severity || 'medium').toLowerCase(),
        addedBy: req.user.id,
        addedAt: new Date(),
        resolved: false
      });
    });
  }
  ca.updatedBy = req.user.id;
  await ca.save();
  const procRecipients = await getProcurementRecipients();
  await notify({ recipientIds: procRecipients, actorId: req.user.id, title: 'Cash Approval Returned from Audit', message: `Cash Approval ${ca.caNumber} was returned from Audit for corrections.`, actionUrl: '/procurement/cash-approvals', entityId: ca._id });
  res.json({ success: true, message: 'Cash Approval returned from Audit', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 5: CEO Secretariat forward to CEO (same rules as PO)
router.put('/:id/forward-to-ceo', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const assignedAuthorityAccess =
    await isAssignedComparativeAuthorityUser(ca.indent, req.user.id) ||
    isAssignedByAuthorityText(ca.approvalAuthorities, req.user);
  if (!hasCeoSecretariatAccess(req.user) && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'CEO Secretariat access required' });
  }
  if (!['Send to CEO Office', 'Returned from CEO Office'].includes(ca.status)) {
    return res.status(400).json({
      success: false,
      message: 'Only Cash Approvals in Send to CEO Office or Returned from CEO Office can be forwarded to CEO'
    });
  }
  const from = ca.status;
  const forwardAt = new Date();
  const forwardComments = req.body.comments || 'Forwarded to CEO for approval';
  pushHistory(ca, from, 'Forwarded to CEO', req.user.id, forwardComments, 'CEO Secretariat');
  ca.status = 'Forwarded to CEO';
  ca.ceoForwardedBy = req.user.id;
  ca.ceoForwardedAt = forwardAt;
  upsertCaAuthorityApproval(ca, {
    key: 'ceoSecretariatForward',
    label: 'PS to CEO',
    approverId: req.user.id,
    approvedAt: forwardAt,
    comments: forwardComments
  });
  ca.updatedBy = req.user.id;
  await ca.save();
  const ceoRecipients = await getCeoRecipients();
  await notify({
    recipientIds: ceoRecipients,
    actorId: req.user.id,
    title: 'Cash Approval pending CEO approval',
    message: `Cash Approval ${ca.caNumber} was forwarded to CEO and is awaiting approval.`,
    actionUrl: '/procurement/cash-approvals',
    entityId: ca._id,
    entityType: 'CashApproval',
    module: 'procurement',
    metadata: {
      queueStage: 'forwarded_to_ceo',
      targetModule: 'general',
      targetTab: 'ceo_secretariat_payments'
    }
  });
  res.json({ success: true, message: 'Forwarded to CEO', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 5: CEO Secretariat return (Send to CEO Office only — matches PO)
router.put('/:id/ceo-secretariat-return', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const assignedAuthorityAccess =
    await isAssignedComparativeAuthorityUser(ca.indent, req.user.id) ||
    isAssignedByAuthorityText(ca.approvalAuthorities, req.user);
  if (!hasCeoSecretariatAccess(req.user) && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'CEO Secretariat access required' });
  }
  if (ca.status !== 'Send to CEO Office') {
    return res.status(400).json({
      success: false,
      message: 'Only Cash Approvals in Send to CEO Office can be returned by CEO Secretariat'
    });
  }
  pushHistory(ca, 'Send to CEO Office', 'Returned from CEO Secretariat', req.user.id, req.body.returnComments || req.body.comments || '', 'CEO Secretariat');
  ca.status = 'Returned from CEO Secretariat';
  ca.returnedFromStatus = 'Send to CEO Office';
  ca.ceoReturnedBy = req.user.id;
  ca.ceoReturnedAt = new Date();
  ca.ceoReturnComments = req.body.returnComments || req.body.comments || '';
  ca.updatedBy = req.user.id;
  await ca.save();
  const procRecipients = await getProcurementRecipients();
  await notify({ recipientIds: procRecipients, actorId: req.user.id, title: 'Cash Approval Returned from CEO Secretariat', message: `Cash Approval ${ca.caNumber} was returned from CEO Secretariat.`, actionUrl: '/procurement/cash-approvals', entityId: ca._id });
  res.json({ success: true, message: 'Returned from CEO Secretariat', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 5: CEO Secretariat reject (Send to CEO Office only — matches PO)
router.put('/:id/ceo-secretariat-reject', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const assignedAuthorityAccess =
    await isAssignedComparativeAuthorityUser(ca.indent, req.user.id) ||
    isAssignedByAuthorityText(ca.approvalAuthorities, req.user);
  if (!hasCeoSecretariatAccess(req.user) && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'CEO Secretariat access required' });
  }
  if (ca.status !== 'Send to CEO Office') {
    return res.status(400).json({
      success: false,
      message: 'Only Cash Approvals in Send to CEO Office can be rejected by CEO Secretariat'
    });
  }
  const rejectionComments = req.body.rejectionComments || req.body.comments || '';
  pushHistory(ca, 'Send to CEO Office', 'Rejected', req.user.id, rejectionComments, 'CEO Secretariat');
  ca.status = 'Rejected';
  ca.returnedFromStatus = 'Send to CEO Office';
  ca.ceoRejectedBy = req.user.id;
  ca.ceoRejectedAt = new Date();
  ca.ceoRejectionComments = rejectionComments;
  if (req.body.digitalSignature) {
    ca.ceoDigitalSignature = req.body.digitalSignature;
  }
  ca.updatedBy = req.user.id;
  await ca.save();
  const procRecipients = await getProcurementRecipients();
  const rejectUrl = isGeneralCashApproval(ca)
    ? `/general/cash-approvals/${ca._id}`
    : '/procurement/cash-approvals';
  await notify({
    recipientIds: [String(ca.createdBy || ''), ...procRecipients].filter(Boolean),
    actorId: req.user.id,
    title: 'Cash Approval rejected by CEO Secretariat',
    message: `Cash Approval ${ca.caNumber} was rejected from Payments (CEO Secretariat).`,
    actionUrl: rejectUrl,
    entityId: ca._id
  });
  res.json({ success: true, message: 'Cash Approval rejected by CEO Secretariat', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 5: CEO Approve → always goes to Pending Finance for cash approvals
router.put('/:id/ceo-approve', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (!isDesignatedCeoApprover(req.user)) {
    return res.status(403).json({ success: false, message: 'CEO approval access required' });
  }
  if (ca.status !== 'Forwarded to CEO') {
    return res.status(400).json({ success: false, message: 'Cash Approval must be "Forwarded to CEO" to approve' });
  }
  const ceoApprovedAt = new Date();
  const ceoComments = req.body.comments || 'CEO Approved';
  pushHistory(ca, 'Forwarded to CEO', 'Pending Finance', req.user.id, ceoComments, 'CEO');
  ca.status = 'Pending Finance';
  ca.ceoApprovedBy = req.user.id;
  ca.ceoApprovedAt = ceoApprovedAt;
  const effectiveSig = (req.body.digitalSignature && String(req.body.digitalSignature).trim()) ||
    req.user.digitalSignature ||
    (req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : req.user.email || 'CEO');
  ca.ceoDigitalSignature = effectiveSig;
  upsertCaAuthorityApproval(ca, {
    key: 'ceoApproval',
    label: 'CEO',
    approverId: req.user.id,
    approvedAt: ceoApprovedAt,
    comments: ceoComments
  });
  ca.updatedBy = req.user.id;
  await ca.save();
  const financeRecipients = await getFinanceRecipients();
  await notify({ recipientIds: financeRecipients, actorId: req.user.id, title: 'Cash Approval pending Finance', message: `Cash Approval ${ca.caNumber} CEO-approved. Please issue the advance.`, actionUrl: '/procurement/cash-approvals', entityId: ca._id, entityType: 'CashApproval', module: 'finance' });
  res.json({ success: true, message: 'CEO approved. Cash Approval moved to Pending Finance.', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 5: CEO Reject
router.put('/:id/ceo-reject', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (!isDesignatedCeoApprover(req.user)) {
    return res.status(403).json({ success: false, message: 'CEO rejection access required' });
  }
  if (ca.status !== 'Forwarded to CEO') {
    return res.status(400).json({ success: false, message: 'Cash Approval must be "Forwarded to CEO" to reject' });
  }
  const rejectMsg = req.body.rejectionComments || req.body.comments || '';
  pushHistory(ca, 'Forwarded to CEO', 'Rejected', req.user.id, rejectMsg, 'CEO');
  ca.status = 'Rejected';
  ca.returnedFromStatus = 'Forwarded to CEO';
  ca.ceoRejectedBy = req.user.id;
  ca.ceoRejectedAt = new Date();
  ca.ceoRejectionComments = rejectMsg;
  ca.updatedBy = req.user.id;
  await ca.save();
  const procRecipients = await getProcurementRecipients();
  const rejectUrl = isGeneralCashApproval(ca)
    ? `/general/cash-approvals/${ca._id}`
    : '/procurement/cash-approvals';
  await notify({ recipientIds: procRecipients, actorId: req.user.id, title: 'Cash Approval Rejected by CEO', message: `Cash Approval ${ca.caNumber} was rejected by CEO.`, actionUrl: rejectUrl, entityId: ca._id });
  res.json({ success: true, message: 'Cash Approval rejected by CEO', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 5: CEO Return
router.put('/:id/ceo-return', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (!isDesignatedCeoApprover(req.user)) {
    return res.status(403).json({ success: false, message: 'CEO return access required' });
  }
  if (ca.status !== 'Forwarded to CEO') {
    return res.status(400).json({ success: false, message: 'Cash Approval must be "Forwarded to CEO" to return' });
  }
  pushHistory(ca, 'Forwarded to CEO', 'Returned from CEO Office', req.user.id, req.body.comments || '', 'CEO');
  ca.status = 'Returned from CEO Office';
  ca.returnedFromStatus = 'Forwarded to CEO';
  ca.ceoReturnedBy = req.user.id;
  ca.ceoReturnedAt = new Date();
  ca.ceoReturnComments = req.body.comments || '';
  // Persist observations for initiator (same pattern as New-Hiring)
  const observations = Array.isArray(req.body.observations) ? req.body.observations : [];
  if (observations.length) {
    ca.auditObservations = ca.auditObservations || [];
    observations.forEach((obs) => {
      const text = String(obs?.observation || obs?.text || '').trim();
      if (!text) return;
      ca.auditObservations.push({
        observation: text,
        severity: String(obs?.severity || 'medium').toLowerCase(),
        addedBy: req.user.id,
        addedAt: new Date(),
        resolved: false
      });
    });
  }
  ca.updatedBy = req.user.id;
  await ca.save();
  const procRecipients = await getProcurementRecipients();
  const returnUrl = isGeneralCashApproval(ca)
    ? `/general/cash-approvals/${ca._id}`
    : '/procurement/cash-approvals';
  await notify({ recipientIds: [String(ca.createdBy || ''), ...procRecipients].filter(Boolean), actorId: req.user.id, title: 'Cash Approval Returned from CEO', message: `Cash Approval ${ca.caNumber} was returned from CEO for corrections.`, actionUrl: returnUrl, entityId: ca._id });
  res.json({ success: true, message: 'Returned from CEO', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 6a: Configure Finance approval authorities for advance issue
router.put('/:id/finance-authorities', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (ca.status !== 'Pending Finance') {
    return res.status(400).json({ success: false, message: 'Finance authorities can only be configured in Pending Finance status' });
  }
  const isOwner = String(ca.createdBy || '') === String(req.user.id);
  const isAllowed = hasFinanceAccess(req.user) || ['super_admin', 'admin'].includes(req.user.role) || isOwner;
  if (!isAllowed) {
    return res.status(403).json({ success: false, message: 'Only initiator, finance, or admin can configure finance authorities' });
  }
  const fa = req.body?.financeApprovalAuthorities || {};
  const authorities = {
    accountsOfficerUser: fa.accountsOfficerUser || null,
    accountsManagerUser: fa.accountsManagerUser || null,
    financeControllerUser: fa.financeControllerUser || null
  };
  const ids = Object.values(authorities).map((id) => String(id || '')).filter(Boolean);
  const distinctCount = new Set(ids).size;
  if (ids.length !== distinctCount) {
    return res.status(400).json({ success: false, message: 'Each finance authority must be assigned to a different user' });
  }
  ca.financeApprovalAuthorities = authorities;
  const keepKeys = FINANCE_AUTHORITY_SLOT_CONFIG
    .filter((s) => String(authorities?.[s.key] || '').trim())
    .map((s) => s.key);
  ca.financeAuthorityApprovals = (Array.isArray(ca.financeAuthorityApprovals) ? ca.financeAuthorityApprovals : [])
    .filter((a) => keepKeys.includes(String(a?.authorityKey || '').trim()));
  ca.financeAuthoritiesAssignedBy = req.user.id;
  ca.financeAuthoritiesAssignedAt = new Date();
  ca.updatedBy = req.user.id;
  await ca.save();
  res.json({ success: true, message: 'Finance approval authorities configured', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 6aa: Finance creates voucher entry explicitly from Pending Finance
router.put('/:id/create-voucher', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (ca.status !== 'Pending Finance') {
    return res.status(400).json({ success: false, message: 'Voucher can only be created in Pending Finance status' });
  }
  if (!hasFinanceAccess(req.user) && !['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Finance access required' });
  }
  if (ca.voucherEntryId) {
    const existingJe = await JournalEntry.findById(ca.voucherEntryId).select('status entryNumber');
    if (existingJe?.status === 'posted') {
      return res.json({
        success: true,
        message: 'Voucher already posted for this cash approval',
        data: await fullPopulate(CashApproval.findById(ca._id))
      });
    }
    if (!isGeneralCashApproval(ca)) {
      return res.json({
        success: true,
        message: 'Voucher already created for this cash approval',
        data: await fullPopulate(CashApproval.findById(ca._id))
      });
    }
  }

  const fa = req.body?.financeApprovalAuthorities || {};
  const authorities = {
    accountsOfficerUser: fa.accountsOfficerUser || ca?.financeApprovalAuthorities?.accountsOfficerUser || null,
    accountsManagerUser: fa.accountsManagerUser || ca?.financeApprovalAuthorities?.accountsManagerUser || null,
    financeControllerUser: fa.financeControllerUser || ca?.financeApprovalAuthorities?.financeControllerUser || null
  };
  const ids = Object.values(authorities).map((id) => String(id || '')).filter(Boolean);
  const distinctCount = new Set(ids).size;
  if (!ids.length) {
    return res.status(400).json({ success: false, message: 'Please save finance approval authorities before creating voucher' });
  }
  if (ids.length !== distinctCount) {
    return res.status(400).json({ success: false, message: 'Each finance authority must be assigned to a different user' });
  }
  if (isGeneralCashApproval(ca)) {
    const reference = String(req.body?.reference || req.body?.signedCheckNumber || '').trim();
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Reference / Cheque # / TT # is required' });
    }
  }
  ca.financeApprovalAuthorities = authorities;
  ca.financeAuthorityApprovals = [];
  ca.financeAuthoritiesAssignedBy = req.user.id;
  ca.financeAuthoritiesAssignedAt = new Date();
  ca.advanceTo = req.body?.advanceTo || null;
  ca.advanceToName = req.body?.advanceToName || '';
  const parsedAdvance = Number(req.body?.advanceAmount);
  ca.advanceAmount = Number.isFinite(parsedAdvance) && parsedAdvance > 0
    ? Math.round(parsedAdvance * 100) / 100
    : Math.round((Number(ca.totalAmount) || 0) * 100) / 100;
  ca.advancePaymentMethod = isGeneralCashApproval(ca)
    ? mapCaPaymentMethodLabel(req.body?.paymentMethod || req.body?.advancePaymentMethod)
    : (req.body?.advancePaymentMethod || 'Cash');
  ca.advanceWhtRate = Math.max(0, Number(req.body?.whtRate) || 0);
  if (req.body?.bankAccountId) ca.advanceBankAccount = req.body.bankAccountId;
  ca.advanceRemarks = req.body?.remarks || req.body?.advanceRemarks || req.body?.comments || '';
  ca.signedCheckNumber = String(req.body?.reference || req.body?.signedCheckNumber || '').trim();
  const payDate = req.body?.paymentDate || req.body?.signedCheckDate;
  ca.signedCheckDate = payDate ? new Date(payDate) : null;
  ca.signedCheckBankName = req.body?.signedCheckBankName || '';
  ca.signedCheckRemarks = req.body?.signedCheckRemarks || '';

  if (!isGeneralCashApproval(ca)) {
    await ensureVoucherForCashApproval(ca, req.user.id, {
      voucherType: req.body?.voucherType,
      paymentMethod: req.body?.paymentMethod,
      remarks: req.body?.remarks || req.body?.comments
    });
    if (ca.voucherEntryId) {
      const voucherDoc = await JournalEntry.findById(ca.voucherEntryId).select('entryNumber');
      if (voucherDoc?.entryNumber) ca.advanceVoucherNo = voucherDoc.entryNumber;
    }
  } else {
    await ensurePostedBpvForGeneralCashApproval(ca, req.user.id, {
      advanceAmount: ca.advanceAmount,
      paymentMethod: req.body?.paymentMethod || req.body?.advancePaymentMethod,
      bankAccountId: req.body?.bankAccountId || ca.advanceBankAccount,
      reference: req.body?.reference || req.body?.signedCheckNumber,
      paymentDate: req.body?.paymentDate || req.body?.signedCheckDate,
      whtRate: req.body?.whtRate
    });
  }
  pushHistory(
    ca,
    'Pending Finance',
    'Pending Finance',
    req.user.id,
    req.body?.comments || (isGeneralCashApproval(ca)
      ? 'Finance authorities configured for advance payment'
      : 'Voucher created by Finance'),
    'Finance'
  );
  ca.updatedBy = req.user.id;
  await ca.save();

  return res.json({
    success: true,
    message: isGeneralCashApproval(ca)
      ? `BPV ${ca.advanceVoucherNo || ''} created and posted to the ledger. Complete finance approvals, then mark the voucher signed/cleared in Vouchers.`
      : 'Voucher created successfully. Continue remaining approvals from Vouchers.',
    data: await fullPopulate(CashApproval.findById(ca._id))
  });
}));

// Phase 6b: Finance authority approval for advance issue
router.put('/:id/finance-approve', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (ca.status !== 'Pending Finance') {
    return res.status(400).json({ success: false, message: 'Finance authority approval is only allowed in Pending Finance status' });
  }
  const slots = getRequiredFinanceAuthoritySlots(ca);
  if (!slots.length) {
    return res.status(400).json({ success: false, message: 'Finance approval authorities are not configured yet' });
  }
  const matchedSlots = matchUserToFinanceSlots(slots, req.user);
  if (!matchedSlots.length) {
    return res.status(403).json({ success: false, message: 'Your user is not assigned as a finance authority for this document' });
  }
  const approvals = Array.isArray(ca.financeAuthorityApprovals) ? [...ca.financeAuthorityApprovals] : [];
  const approvedKeys = new Set(
    approvals
      .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
      .map((a) => String(a?.authorityKey || '').trim())
      .filter(Boolean)
  );
  const pendingMatchedSlots = matchedSlots.filter((slot) => !approvedKeys.has(slot.key));
  if (!pendingMatchedSlots.length) {
    return res.status(400).json({ success: false, message: 'You have already approved your assigned finance authority slot' });
  }
  const now = new Date();
  pendingMatchedSlots.forEach((slot) => {
    approvals.push({
      authorityKey: slot.key,
      authorityLabel: slot.label,
      approver: req.user.id,
      decision: 'approved',
      approvedAt: now,
      comments: req.body?.comments || ''
    });
  });
  ca.financeAuthorityApprovals = approvals;

  const approvedKeysThisAction = pendingMatchedSlots.map((slot) => slot.key);
  if (approvedKeysThisAction.includes('accountsOfficerUser') && !ca.voucherEntryId && !isGeneralCashApproval(ca)) {
    await ensureVoucherForCashApproval(ca, req.user.id);
    pushHistory(ca, 'Pending Finance', 'Pending Finance', req.user.id, 'Voucher auto-created after Accounts Officer / AM approval', 'Finance');
  }

  ca.updatedBy = req.user.id;
  await ca.save();
  const requiredKeys = new Set(slots.map((s) => s.key));
  const approvedNow = new Set(
    ca.financeAuthorityApprovals
      .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
      .map((a) => String(a?.authorityKey || '').trim())
      .filter(Boolean)
  );
  const remaining = [...requiredKeys].filter((k) => !approvedNow.has(k)).length;
  if (remaining === 0) {
    pushHistory(ca, 'Pending Finance', 'Finance Authority Approved', req.user.id, req.body?.comments || 'All finance authorities approved', 'Finance');
    ca.status = 'Finance Authority Approved';
    if (isGeneralCashApproval(ca) && ca.voucherEntryId) {
      const draftJe = await JournalEntry.findById(ca.voucherEntryId);
      if (draftJe?.status === 'draft') {
        await postJournalEntryWithGl(draftJe, req.user.id);
      }
    }
    await ca.save();
  }
  const message = remaining === 0
    ? 'Finance authority approvals completed. Status updated to Finance Authority Approved.'
    : `Finance authority approval recorded. ${remaining} approval(s) remaining.`;
  res.json({ success: true, message, data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 6c: Finance authority rejection for advance issue
router.put('/:id/finance-reject', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (ca.status !== 'Pending Finance') {
    return res.status(400).json({ success: false, message: 'Finance authority rejection is only allowed in Pending Finance status' });
  }
  const slots = getRequiredFinanceAuthoritySlots(ca);
  if (!slots.length) {
    return res.status(400).json({ success: false, message: 'Finance approval authorities are not configured yet' });
  }
  const matchedSlots = matchUserToFinanceSlots(slots, req.user);
  if (!matchedSlots.length) {
    return res.status(403).json({ success: false, message: 'Your user is not assigned as a finance authority for this document' });
  }
  const approvals = Array.isArray(ca.financeAuthorityApprovals) ? [...ca.financeAuthorityApprovals] : [];
  const decidedKeys = new Set(approvals.map((a) => String(a?.authorityKey || '').trim()).filter(Boolean));
  const pendingMatchedSlots = matchedSlots.filter((slot) => !decidedKeys.has(slot.key));
  if (!pendingMatchedSlots.length) {
    return res.status(400).json({ success: false, message: 'You have already acted on your assigned finance authority slot' });
  }
  const now = new Date();
  pendingMatchedSlots.forEach((slot) => {
    approvals.push({
      authorityKey: slot.key,
      authorityLabel: slot.label,
      approver: req.user.id,
      decision: 'rejected',
      approvedAt: now,
      comments: req.body?.comments || req.body?.rejectionComments || ''
    });
  });
  ca.financeAuthorityApprovals = approvals;
  ca.financeRejectedBy = req.user.id;
  ca.financeRejectedAt = now;
  ca.financeRejectionComments = req.body?.comments || req.body?.rejectionComments || '';
  pushHistory(ca, 'Pending Finance', 'Rejected', req.user.id, ca.financeRejectionComments || 'Rejected by finance authority', 'Finance');
  ca.status = 'Rejected';
  ca.returnedFromStatus = 'Pending Finance';
  ca.updatedBy = req.user.id;
  await ca.save();
  res.json({ success: true, message: 'Finance authority rejection recorded. Cash Approval has been rejected.', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

const resolveBankAccountForCaPayment = async (bankAccountId, paymentMethod, userId, companyId) => {
  let bankAccount = bankAccountId ? await Account.findById(bankAccountId) : null;
  if (bankAccount && companyId) {
    bankAccount = await AccountResolver.mapAccountToCompany(companyId, bankAccount);
  }
  if (bankAccountId && !bankAccount) {
    const err = new Error('Selected bank or cash account was not found');
    err.statusCode = 400;
    throw err;
  }
  const A = acct(companyId);
  if (!bankAccount) {
    bankAccount = await A.resolve(
      isCashPaymentMethod(paymentMethod) ? FinanceHelper.ACCOUNTS.CASH : FinanceHelper.ACCOUNTS.BANK
    );
  }
  if (!bankAccount) {
    const err = new Error('Bank or cash account not found for payment');
    err.statusCode = 400;
    throw err;
  }
  return bankAccount;
};

const buildGeneralAdvancePaymentLines = async ({
  cas,
  employee,
  payRows,
  bankAccount,
  whtRate,
  paymentMethod,
  payRef,
  createdBy,
  companyId
}) => {
  const grossAmount = Math.round(payRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const wht = whtRate > 0 ? Math.round(grossAmount * (whtRate / 100) * 100) / 100 : 0;
  const netBank = Math.round((grossAmount - wht) * 100) / 100;
  const isCash = isCashPaymentMethod(paymentMethod);
  const employeeName = employeeDisplayName(employee);
  const jeLines = [];
  const A = acct(companyId);

  for (const ca of cas) {
    const row = payRows.find((r) => r.cashApprovalId === String(ca._id));
    if (!row) continue;
    let debitAdvanceAcc = null;
    if (ca.advanceGlAccount) {
      debitAdvanceAcc = await Account.findById(ca.advanceGlAccount);
    }
    if (!debitAdvanceAcc) {
      debitAdvanceAcc = await resolveEmployeeAdvanceAccount(employee, { createdBy, companyId });
    }
    if (!debitAdvanceAcc) {
      debitAdvanceAcc = await ensureEmployeeAdvanceAccount(employee, createdBy, companyId);
    }
    if (!debitAdvanceAcc) {
      const err = new Error(`Could not resolve employee advance account for ${ca.caNumber}`);
      err.statusCode = 400;
      throw err;
    }
    if (!ca.advanceGlAccount) {
      ca.advanceGlAccount = debitAdvanceAcc._id;
      ca.advanceGlAccountNumber = debitAdvanceAcc.accountNumber;
    }
    jeLines.push({
      account: debitAdvanceAcc._id,
      description: `Employee advance — ${ca.caNumber} (${employeeName})`,
      debit: row.amount,
      department: 'general'
    });
  }

  jeLines.push({
    account: bankAccount._id,
    description: `${isCash ? 'Cash' : 'Bank'} payment — ${payRef || employeeName}`,
    credit: netBank,
    department: 'finance'
  });

  if (wht > 0) {
    const whtAccount = await A.resolve('2004');
    if (whtAccount) {
      jeLines.push({
        account: whtAccount._id,
        description: `WHT @ ${whtRate}% on employee advance payment`,
        credit: wht,
        department: 'finance'
      });
    } else {
      jeLines[jeLines.length - 1].credit = grossAmount;
    }
  }

  return { jeLines, grossAmount, isCash };
};

const postJournalEntryWithGl = async (entry, userId) => {
  entry.status = 'posted';
  entry.postedBy = userId;
  entry.postedDate = new Date();
  await entry.save();
  await FinanceHelper.postToGeneralLedger(entry._id);
  return entry;
};

/** Create or update BPV/CPV and post immediately so Trial Balance / GL include it (same as AP bills). */
const ensurePostedBpvForGeneralCashApproval = async (ca, userId, opts = {}) => {
  if (!isGeneralCashApproval(ca) || !ca.advanceToEmployee) return null;

  const amount = Math.round((Number(opts.advanceAmount) || getCaOpenAdvanceAmount(ca)) * 100) / 100;
  if (amount <= 0) return null;

  const paymentMethod = opts.paymentMethod || 'bank_transfer';
  const payRef = String(opts.reference || ca.signedCheckNumber || ca.caNumber || '').trim();
  const postingDate = opts.paymentDate ? new Date(opts.paymentDate) : (ca.signedCheckDate || new Date());
  const whtRate = Math.max(0, Number(opts.whtRate) || 0);
  const employee = await Employee.findById(ca.advanceToEmployee);
  if (!employee) {
    const err = new Error('Employee payee not found for voucher');
    err.statusCode = 400;
    throw err;
  }
  const companyId = await resolveDocumentCompanyId({ companyId: ca?.companyId, employee });
  const bankAccount = await resolveBankAccountForCaPayment(opts.bankAccountId, paymentMethod, userId, companyId);

  const payRows = [{ cashApprovalId: String(ca._id), amount }];
  const { jeLines, isCash } = await buildGeneralAdvancePaymentLines({
    cas: [ca],
    employee,
    payRows,
    bankAccount,
    whtRate,
    paymentMethod,
    payRef,
    createdBy: userId,
    companyId
  });

  const employeeName = employeeDisplayName(employee);
  const caNarration = getCashApprovalNarration(ca);
  const meta = withVoucherNarration({
    date: postingDate,
    reference: payRef,
    description: `Cash approval advance — ${employeeName} — ${ca.caNumber}`,
    department: 'general',
    module: 'general',
    referenceId: ca._id,
    referenceType: 'payment',
    journalCode: isCash ? 'CASH' : 'BANK',
    voucherSeries: isCash ? 'CPV' : 'BPV'
  }, caNarration);

  if (ca.voucherEntryId) {
    const existing = await JournalEntry.findById(ca.voucherEntryId);
    if (existing?.status === 'posted') return existing;
    if (existing?.status === 'draft') {
      const narrated = withVoucherNarration({ ...meta, lines: jeLines }, caNarration);
      Object.assign(existing, narrated);
      const posted = await postJournalEntryWithGl(existing, userId);
      ca.advanceVoucherNo = posted.entryNumber || ca.advanceVoucherNo;
      return posted;
    }
  }

  const voucher = await FinanceHelper.createAndPostJournalEntry(
    withVoucherNarration(withCompany({ ...meta, createdBy: userId, lines: jeLines }, companyId), caNarration)
  );
  ca.voucherEntryId = voucher._id;
  ca.advanceVoucherNo = voucher.entryNumber || '';
  return voucher;
};

const assertFinanceAuthoritiesApproved = (ca) => {
  const requiredFinanceSlots = getRequiredFinanceAuthoritySlots(ca);
  if (!requiredFinanceSlots.length) {
    const err = new Error('Configure finance approval authorities before issuing advance');
    err.statusCode = 400;
    throw err;
  }
  const approvedFinanceKeys = new Set(
    (Array.isArray(ca.financeAuthorityApprovals) ? ca.financeAuthorityApprovals : [])
      .filter((a) => String(a?.decision || 'approved').trim() !== 'rejected')
      .map((a) => String(a?.authorityKey || '').trim())
      .filter(Boolean)
  );
  const remainingFinanceApprovals = requiredFinanceSlots.filter((s) => !approvedFinanceKeys.has(s.key));
  if (remainingFinanceApprovals.length > 0) {
    const err = new Error(
      `Advance cannot be issued until all finance authorities approve. Pending: ${remainingFinanceApprovals.map((s) => s.label).join(', ')}`
    );
    err.statusCode = 400;
    throw err;
  }
};

const postGeneralCashApprovalAdvancePayment = async ({
  req,
  primaryCa,
  allocations,
  paymentMethod,
  bankAccountId,
  reference,
  paymentDate,
  whtRate,
  advanceRemarks,
  signedCheckAttachments
}) => {
  const payRows = (Array.isArray(allocations) ? allocations : [])
    .map((row) => ({
      cashApprovalId: String(row?.cashApprovalId || row?.caId || '').trim(),
      amount: Math.round((Number(row?.amount) || 0) * 100) / 100
    }))
    .filter((row) => row.cashApprovalId && row.amount > 0);
  if (!payRows.length) {
    const err = new Error('Enter payment amount against at least one outstanding cash approval');
    err.statusCode = 400;
    throw err;
  }

  const caIds = payRows.map((r) => r.cashApprovalId);
  const cas = await CashApproval.find({
    _id: { $in: caIds },
    originatingModule: GENERAL_MODULE,
    status: 'Finance Authority Approved'
  });
  if (cas.length !== payRows.length) {
    const err = new Error('One or more cash approvals are not available for payment');
    err.statusCode = 400;
    throw err;
  }

  const employeeIds = new Set(cas.map((c) => String(c.advanceToEmployee || '')).filter(Boolean));
  if (employeeIds.size !== 1) {
    const err = new Error('All selected cash approvals must belong to the same employee payee');
    err.statusCode = 400;
    throw err;
  }
  const employeeId = [...employeeIds][0];
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    const err = new Error('Employee payee not found');
    err.statusCode = 400;
    throw err;
  }

  for (const ca of cas) {
    assertFinanceAuthoritiesApproved(ca);
    const row = payRows.find((r) => r.cashApprovalId === String(ca._id));
    const open = getCaOpenAdvanceAmount(ca);
    if (row.amount > open + 0.01) {
      const err = new Error(`Payment for ${ca.caNumber} exceeds open balance PKR ${open}`);
      err.statusCode = 400;
      throw err;
    }
  }

  const methodLabel = mapCaPaymentMethodLabel(paymentMethod);
  const postingDate = paymentDate ? new Date(paymentDate) : new Date();
  const payRef = String(reference || primaryCa?.caNumber || '').trim();
  const companyId = await resolveDocumentCompanyId({ companyId: primaryCa?.companyId, employee });
  const bankAccount = await resolveBankAccountForCaPayment(bankAccountId, paymentMethod, req.user.id, companyId);
  const employeeName = employeeDisplayName(employee);
  const caNarration = getCashApprovalNarration(primaryCa || cas[0]);
  const { jeLines, isCash } = await buildGeneralAdvancePaymentLines({
    cas,
    employee,
    payRows,
    bankAccount,
    whtRate,
    paymentMethod,
    payRef,
    createdBy: req.user.id,
    companyId
  });

  let voucher = null;
  const draftId = primaryCa?.voucherEntryId || cas[0]?.voucherEntryId;
  if (draftId) {
    const draft = await JournalEntry.findById(draftId);
    if (draft?.status === 'posted') {
      voucher = draft;
    } else if (draft?.status === 'draft') {
      draft.date = postingDate;
      draft.reference = payRef || cas.map((c) => c.caNumber).join(', ');
      const narratedDraft = withVoucherNarration(
        { description: `Cash approval advance payment to ${employeeName}`, lines: jeLines },
        caNarration
      );
      draft.description = narratedDraft.description;
      draft.lines = narratedDraft.lines;
      draft.voucherSeries = isCash ? 'CPV' : 'BPV';
      draft.journalCode = isCash ? 'CASH' : 'BANK';
      voucher = await postJournalEntryWithGl(draft, req.user.id);
    }
  }

  if (!voucher) {
    voucher = await FinanceHelper.createAndPostJournalEntry(
      withVoucherNarration(withCompany({
        date: postingDate,
        reference: payRef || cas.map((c) => c.caNumber).join(', '),
        description: `Cash approval advance payment to ${employeeName}`,
        department: 'general',
        module: 'general',
        referenceId: primaryCa?._id || cas[0]._id,
        referenceType: 'payment',
        journalCode: isCash ? 'CASH' : 'BANK',
        voucherSeries: isCash ? 'CPV' : 'BPV',
        createdBy: req.user.id,
        lines: jeLines
      }, companyId), caNarration)
    );
  }

  for (const ca of cas) {
    if (ca.voucherEntryId && String(ca.voucherEntryId) !== String(voucher._id)) {
      const orphan = await JournalEntry.findById(ca.voucherEntryId);
      if (orphan?.status === 'draft') {
        orphan.status = 'cancelled';
        await orphan.save();
      }
    }
  }

  const attachmentPayload = (Array.isArray(signedCheckAttachments) ? signedCheckAttachments : [])
    .filter((a) => a && a.url)
    .map((a) => ({
      filename: a.filename || '',
      originalName: a.originalName || a.filename || '',
      url: a.url,
      mimeType: a.mimeType || '',
      uploadedAt: a.uploadedAt || new Date()
    }));

  const updatedIds = [];
  for (const ca of cas) {
    const row = payRows.find((r) => r.cashApprovalId === String(ca._id));
    pushHistory(
      ca,
      'Finance Authority Approved',
      'Advance Issued',
      req.user.id,
      `Advance of ${row.amount} issued via ${methodLabel}. Voucher: ${voucher.entryNumber || '-'}.`,
      'Finance'
    );
    ca.status = 'Advance Issued';
    ca.advanceAmount = row.amount;
    ca.advancePaymentMethod = methodLabel;
    ca.advanceVoucherNo = voucher.entryNumber || '';
    ca.advanceRemarks = advanceRemarks || '';
    ca.advanceIssuedBy = req.user.id;
    ca.advanceIssuedAt = postingDate;
    ca.voucherEntryId = voucher._id;
    ca.signedCheckNumber = payRef || ca.signedCheckNumber || '';
    ca.signedCheckDate = postingDate;
    ca.signedCheckBankName = bankAccount.name || '';
    if (attachmentPayload.length) ca.signedCheckAttachments = attachmentPayload;
    ca.updatedBy = req.user.id;
    await ca.save();
    updatedIds.push(ca._id);
  }

  return { voucher, updatedIds, grossAmount, employeeName };
};

// Phase 6: Finance Issue Advance
router.put('/:id/issue-advance', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const assignedAuthorityAccess =
    await isAssignedComparativeAuthorityUser(ca.indent, req.user.id) ||
    isAssignedByAuthorityText(ca.approvalAuthorities, req.user);
  if (!hasFinanceAccess(req.user) && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'Finance access required' });
  }
  if (ca.status !== 'Finance Authority Approved') {
    return res.status(400).json({ success: false, message: 'Cash Approval must be in "Finance Authority Approved" status to issue advance' });
  }

  const paymentMethod = req.body?.paymentMethod || req.body?.advancePaymentMethod || 'bank_transfer';
  const isGeneralPayment =
    isGeneralCashApproval(ca) ||
    (Array.isArray(req.body?.allocations) && req.body.allocations.length > 0);

  if (isGeneralPayment && isGeneralCashApproval(ca)) {
    const reference = String(req.body?.reference || req.body?.signedCheckNumber || '').trim();
    const normalizedAttachments = Array.isArray(req.body?.signedCheckAttachments)
      ? req.body.signedCheckAttachments.filter((a) => a && a.url)
      : [];
    if (!reference && !normalizedAttachments.length) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference (cheque / TT #) or supporting evidence is required'
      });
    }

    const allocations = Array.isArray(req.body?.allocations) && req.body.allocations.length
      ? req.body.allocations
      : [{
        cashApprovalId: String(ca._id),
        amount: Math.round((Number(req.body?.advanceAmount) || getCaOpenAdvanceAmount(ca)) * 100) / 100
      }];

    try {
      const result = await postGeneralCashApprovalAdvancePayment({
        req,
        primaryCa: ca,
        allocations,
        paymentMethod,
        bankAccountId: req.body?.bankAccountId || null,
        reference,
        paymentDate: req.body?.paymentDate || req.body?.signedCheckDate || null,
        whtRate: Number(req.body?.whtRate) || 0,
        advanceRemarks: req.body?.advanceRemarks || req.body?.remarks || '',
        signedCheckAttachments: normalizedAttachments
      });
      const refreshed = await fullPopulate(CashApproval.findById(ca._id));
      return res.json({
        success: true,
        message: `Advance payment posted (${result.voucher?.entryNumber || 'BPV'}). ${result.updatedIds.length} cash approval(s) updated.`,
        data: refreshed,
        voucherEntryNumber: result.voucher?.entryNumber || null
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to post advance payment' });
    }
  }

  try {
    assertFinanceAuthoritiesApproved(ca);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }

  const {
    advanceTo,
    advanceToName,
    advanceAmount,
    advancePaymentMethod,
    advanceVoucherNo,
    advanceRemarks,
    signedCheckNumber,
    signedCheckDate,
    signedCheckBankName,
    signedCheckRemarks,
    signedCheckAttachments
  } = req.body;
  if (!advanceAmount || advanceAmount <= 0) return res.status(400).json({ success: false, message: 'Advance amount is required and must be > 0' });
  const normalizedAttachments = Array.isArray(signedCheckAttachments)
    ? signedCheckAttachments.filter((a) => a && a.url)
    : [];
  if (!normalizedAttachments.length) {
    return res.status(400).json({ success: false, message: 'Upload signed check evidence before issuing advance' });
  }

  const amount = Math.round(parseFloat(advanceAmount) * 100) / 100;
  const isCash = (advancePaymentMethod || 'Cash').toLowerCase() === 'cash';

  pushHistory(ca, 'Finance Authority Approved', 'Advance Issued', req.user.id, `Advance of ${amount} issued via ${advancePaymentMethod || 'Cash'}. Voucher: ${advanceVoucherNo || '-'}.`, 'Finance');
  ca.status = 'Advance Issued';
  ca.advanceTo = advanceTo || null;
  ca.advanceToName = advanceToName || '';
  ca.advanceAmount = amount;
  ca.advancePaymentMethod = advancePaymentMethod || 'Cash';
  ca.advanceVoucherNo = advanceVoucherNo || '';
  ca.advanceRemarks = advanceRemarks || '';
  ca.advanceIssuedBy = req.user.id;
  ca.advanceIssuedAt = new Date();
  ca.signedCheckNumber = signedCheckNumber || '';
  ca.signedCheckDate = signedCheckDate || null;
  ca.signedCheckBankName = signedCheckBankName || '';
  ca.signedCheckRemarks = signedCheckRemarks || '';
  ca.signedCheckAttachments = normalizedAttachments.map((a) => ({
    filename: a.filename || '',
    originalName: a.originalName || a.filename || '',
    url: a.url,
    mimeType: a.mimeType || '',
    uploadedAt: a.uploadedAt || new Date()
  }));
  ca.updatedBy = req.user.id;
  await ca.save();

  try {
    let debitAdvanceAcc = null;
    let companyId = null;
    if (isGeneralCashApproval(ca) && ca.advanceToEmployee) {
      const payee = await Employee.findById(ca.advanceToEmployee).select('placementCompany');
      companyId = await resolveDocumentCompanyId({ companyId: ca?.companyId, employee: payee });
    } else {
      companyId = await resolveDocumentCompanyId({ companyId: ca?.companyId });
    }
    const A = acct(companyId);
    if (isGeneralCashApproval(ca) && ca.advanceGlAccount) {
      debitAdvanceAcc = await AccountResolver.mapAccountToCompany(companyId, ca.advanceGlAccount);
      if (!debitAdvanceAcc) debitAdvanceAcc = await Account.findById(ca.advanceGlAccount);
    }
    if (!debitAdvanceAcc) {
      debitAdvanceAcc = await FinanceHelper.ensureStaffAdvanceAccount(req.user.id, companyId);
    }
    const cashBankAcc = await A.resolve(
      isCash ? FinanceHelper.ACCOUNTS.CASH : FinanceHelper.ACCOUNTS.BANK
    );
    if (debitAdvanceAcc && cashBankAcc) {
      const jeDept = isGeneralCashApproval(ca) ? 'general' : 'procurement';
      const jeModule = isGeneralCashApproval(ca) ? 'general' : 'procurement';
      const caNarration = getCashApprovalNarration(ca);
      const voucher = await FinanceHelper.createAndPostJournalEntry(
        withVoucherNarration(withCompany({
          date: new Date(),
          reference: advanceVoucherNo || ca.caNumber,
          description: `Cash Advance issued for ${ca.caNumber}${advanceToName ? ` to ${advanceToName}` : ''}`,
          department: jeDept,
          module: jeModule,
          referenceId: ca._id,
          referenceType: 'payment',
          journalCode: isCash ? 'CASH' : 'BANK',
          voucherSeries: isCash ? 'CPV' : 'BPV',
          createdBy: req.user.id,
          lines: [
            {
              account: debitAdvanceAcc._id,
              description: `Employee advance for ${ca.caNumber}${advanceToName ? ` — ${advanceToName}` : ''}${ca.advanceGlAccountNumber ? ` (${ca.advanceGlAccountNumber})` : ''}`,
              debit: amount,
              department: jeDept
            },
            {
              account: cashBankAcc._id,
              description: `${isCash ? 'Cash' : 'Bank'} payment — advance for ${ca.caNumber}`,
              credit: amount,
              department: 'finance'
            }
          ]
        }, companyId), caNarration)
      );
      if (voucher?.entryNumber) {
        ca.advanceVoucherNo = voucher.entryNumber;
        ca.voucherEntryId = voucher._id;
        await ca.save();
      }
    }
  } catch (jeErr) {
    console.error(`⚠️  JE (advance) failed for ${ca.caNumber}:`, jeErr.message);
  }

  res.json({ success: true, message: 'Advance issued successfully and kept in finance workflow', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 7: Procurement submits settlement bill with evidence
router.put('/:id/submit-settlement-bill', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const assignedAuthorityAccess = await isAssignedComparativeAuthorityUser(ca.indent, req.user.id);
  if (!hasProcurementAccess(req.user) && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'Procurement access required' });
  }
  if (!['Advance Issued', 'Returned from Audit'].includes(ca.status)) {
    return res.status(400).json({ success: false, message: `Settlement bill can only be submitted from Advance Issued or Returned from Audit status. Current: ${ca.status}` });
  }

  const purchaseReceipts = Array.isArray(req.body?.purchaseReceipts)
    ? req.body.purchaseReceipts.filter((a) => a && a.url)
    : [];
  const existingReceipts = Array.isArray(ca.purchaseReceipts) ? ca.purchaseReceipts : [];
  const mergedReceipts = purchaseReceipts.length ? purchaseReceipts : existingReceipts;
  if (!mergedReceipts.length) {
    return res.status(400).json({ success: false, message: 'Upload purchase evidence before submitting settlement bill' });
  }

  const parsedActual = Number(req.body?.evidenceActualAmount);
  const evidenceActualAmount = Number.isFinite(parsedActual) ? Math.max(parsedActual, 0) : Number(ca.evidenceActualAmount || 0);
  if (evidenceActualAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Actual utilized amount is required and must be greater than 0' });
  }

  const previousStatus = ca.status;
  ca.purchaseInvoiceNo = String(req.body?.purchaseInvoiceNo || '').trim();
  ca.evidenceActualAmount = Math.round(evidenceActualAmount * 100) / 100;
  ca.evidenceRemarks = String(req.body?.evidenceRemarks || req.body?.remarks || '').trim();
  ca.purchaseReceipts = mergedReceipts.map((a) => ({
    filename: a.filename || '',
    originalName: a.originalName || a.filename || '',
    url: a.url,
    mimeType: a.mimeType || '',
    uploadedAt: a.uploadedAt || new Date()
  }));
  ca.evidenceSubmittedBy = req.user.id;
  ca.evidenceSubmittedAt = new Date();
  ca.status = 'Pending Audit';
  ca.updatedBy = req.user.id;
  pushHistory(ca, previousStatus, 'Pending Audit', req.user.id, ca.evidenceRemarks || 'Settlement bill submitted with evidence for Pre-Audit review', 'Procurement');
  await ca.save();

  const recipients = await getAuditRecipients();
  await notify({
    recipientIds: recipients,
    actorId: req.user.id,
    title: 'Cash Approval settlement bill pending Audit',
    message: `Settlement bill for ${ca.caNumber} submitted with evidence and moved to Pre-Audit.`,
    actionUrl: '/audit',
    entityId: ca._id,
    metadata: { queueStage: 'pending_audit', targetModule: 'audit', targetTab: 'pre_audit' }
  });

  res.json({ success: true, message: 'Settlement bill submitted to Pre-Audit', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 8: Finance settles advance after audit review of settlement bill
router.put('/:id/settle-payment', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const assignedAuthorityAccess = await isAssignedComparativeAuthorityUser(ca.indent, req.user.id);
  if (!hasFinanceAccess(req.user) && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'Finance access required' });
  }
  const isSettlementFlow = Boolean(ca.advanceIssuedAt && ca.evidenceSubmittedAt);
  if (ca.status !== 'Pending Finance' || !isSettlementFlow) {
    return res.status(400).json({ success: false, message: 'Settlement is only allowed in Pending Finance after procurement evidence submission' });
  }

  const fallbackActual = Number(ca.evidenceActualAmount || 0);
  const requestedActual = Number(req.body?.actualAmountSpent);
  const actualAmountSpent = Number.isFinite(requestedActual) ? requestedActual : fallbackActual;
  if (!Number.isFinite(actualAmountSpent) || actualAmountSpent <= 0) {
    return res.status(400).json({ success: false, message: 'Actual amount spent must be greater than 0' });
  }

  const advanceAmount = Number(ca.advanceAmount || 0);
  const roundedActual = Math.round(actualAmountSpent * 100) / 100;
  const excessReturned = Math.round(Math.max(advanceAmount - roundedActual, 0) * 100) / 100;
  const additionalPaid = Math.round(Math.max(roundedActual - advanceAmount, 0) * 100) / 100;

  ca.actualAmountSpent = roundedActual;
  ca.excessReturned = excessReturned;
  ca.additionalPaid = additionalPaid;
  ca.settlementRemarks = String(req.body?.settlementRemarks || req.body?.remarks || '').trim();
  ca.financeVerificationNotes = String(req.body?.financeVerificationNotes || '').trim();
  ca.receiptAttachments = Array.isArray(req.body?.receiptAttachments)
    ? req.body.receiptAttachments.filter((a) => a && a.url).map((a) => ({
      filename: a.filename || '',
      url: a.url,
      uploadedAt: a.uploadedAt || new Date()
    }))
    : (Array.isArray(ca.receiptAttachments) ? ca.receiptAttachments : []);
  ca.settlementDate = new Date();
  ca.settledBy = req.user.id;
  ca.status = 'Payment Settled';
  ca.updatedBy = req.user.id;
  pushHistory(ca, 'Pending Finance', 'Payment Settled', req.user.id, ca.settlementRemarks || 'Finance adjusted advance against settlement bill', 'Finance');
  await ca.save();

  res.json({ success: true, message: 'Advance settlement completed by Finance', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 8: Finance Send to Procurement
router.put('/:id/send-to-procurement', authMiddleware, asyncHandler(async (req, res) => {
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const assignedAuthorityAccess = await isAssignedComparativeAuthorityUser(ca.indent, req.user.id);
  if (!hasFinanceAccess(req.user) && !assignedAuthorityAccess) {
    return res.status(403).json({ success: false, message: 'Finance access required' });
  }
  if (ca.status !== 'Payment Settled') {
    return res.status(400).json({ success: false, message: 'Payment must be settled before sending back to Procurement' });
  }
  pushHistory(ca, 'Payment Settled', 'Sent to Procurement', req.user.id, req.body.remarks || 'Sent back to Procurement for confirmation', 'Finance');
  ca.status = 'Sent to Procurement';
  ca.sentToProcurementBy = req.user.id;
  ca.sentToProcurementAt = new Date();
  ca.sentToProcurementRemarks = req.body.remarks || '';
  ca.updatedBy = req.user.id;
  await ca.save();
  const procRecipients = await getProcurementRecipients();
  await notify({ recipientIds: procRecipients, actorId: req.user.id, title: 'Cash Approval ready for Procurement closure', message: `Cash Approval ${ca.caNumber} payment settled. Please confirm goods received and complete.`, actionUrl: '/procurement/cash-approvals', entityId: ca._id });
  res.json({ success: true, message: 'Sent to Procurement for final confirmation', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Phase 9: Procurement Complete
router.put('/:id/complete', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasProcurementAccess(req.user)) return res.status(403).json({ success: false, message: 'Procurement access required' });
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  if (ca.status !== 'Sent to Procurement') {
    return res.status(400).json({ success: false, message: 'Cash Approval must be in "Sent to Procurement" status to complete' });
  }
  pushHistory(ca, 'Sent to Procurement', 'Completed', req.user.id, req.body.remarks || 'Goods received and confirmed. Cash Approval completed.', 'Procurement');
  ca.status = 'Completed';
  ca.completedBy = req.user.id;
  ca.completedAt = new Date();
  ca.completionRemarks = req.body.remarks || '';
  ca.updatedBy = req.user.id;
  await ca.save();
  res.json({ success: true, message: 'Cash Approval completed successfully', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

// Cancel
router.put('/:id/cancel', authMiddleware, asyncHandler(async (req, res) => {
  if (!hasProcurementAccess(req.user)) return res.status(403).json({ success: false, message: 'Procurement access required' });
  const ca = await CashApproval.findById(req.params.id);
  if (!ca) return res.status(404).json({ success: false, message: 'Cash Approval not found' });
  const cancellable = ['Draft', 'Returned from Audit', 'Returned from CEO Office', 'Returned from CEO Secretariat'];
  if (!cancellable.includes(ca.status)) {
    return res.status(400).json({ success: false, message: `Cannot cancel Cash Approval in "${ca.status}" status` });
  }
  pushHistory(ca, ca.status, 'Cancelled', req.user.id, req.body.reason || 'Cancelled', 'Procurement');
  ca.status = 'Cancelled';
  ca.updatedBy = req.user.id;
  await ca.save();
  res.json({ success: true, message: 'Cash Approval cancelled', data: await fullPopulate(CashApproval.findById(ca._id)) });
}));

const LINE_ATTACHMENT_SEARCH_DIRS = [
  cashApprovalLineFilesDir,
  generalCaUploadDir,
  procurementCaUploadDir
];

const findLineAttachmentFile = (filename) => {
  for (const dir of LINE_ATTACHMENT_SEARCH_DIRS) {
    const filePath = path.join(dir, filename);
    const pathValidation = validateFilePath(filePath, dir);
    if (pathValidation.error) continue;
    if (fs.existsSync(filePath)) return { filePath, dir };
  }
  return null;
};

const serveLineAttachmentFile = async (req, res) => {
  try {
    const authResult = await authenticateUser(req);
    if (authResult.error) {
      return res.status(authResult.error.status).json({
        success: false,
        message: authResult.error.message
      });
    }

    const filename = req.params.filename;
    const filenameValidation = validateFilename(filename);
    if (filenameValidation.error) {
      return res.status(filenameValidation.error.status).json({
        success: false,
        message: filenameValidation.error.message
      });
    }

    const found = findLineAttachmentFile(filename);
    if (!found) {
      return res.status(404).json({ success: false, message: 'File not found on server' });
    }

    const headers = getFileHeaders(found.filePath, filename);
    Object.keys(headers).forEach((key) => {
      res.setHeader(key, headers[key]);
    });
    return res.sendFile(found.filePath);
  } catch (err) {
    console.error('Cash approval line file serve error:', err);
    return res.status(500).json({ success: false, message: 'Error serving file' });
  }
};

/** Serve line-item attachments (token in query or Authorization header — for img tags). */
const lineFileRouter = express.Router();
lineFileRouter.get('/line-files/general/:filename', serveLineAttachmentFile);
lineFileRouter.get('/line-files/procurement/:filename', serveLineAttachmentFile);
lineFileRouter.get('/line-files/:filename', serveLineAttachmentFile);

module.exports = router;
module.exports.lineFileRouter = lineFileRouter;
