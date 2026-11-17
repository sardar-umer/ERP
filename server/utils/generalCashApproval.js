const {
  assertActiveUserApproversEligible,
  getEligibleUtilityBillApproverUserIds
} = require('./utilityBillApproverEligibility');

const GENERAL_MODULE = 'general';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const hasModuleAccess = (roleDoc, moduleKey) => {
  if (!roleDoc?.isActive || !Array.isArray(roleDoc.permissions)) return false;
  return roleDoc.permissions.some((p) => p?.module === moduleKey);
};

const hasGeneralSubmoduleAccess = (roleDoc, submoduleKey) => {
  if (!roleDoc?.isActive || !Array.isArray(roleDoc.permissions)) return false;
  return roleDoc.permissions.some((p) => {
    if (p?.module !== 'general') return false;
    if (!Array.isArray(p.submodules) || p.submodules.length === 0) return true;
    return p.submodules.some((sm) => {
      if (typeof sm === 'string') return sm === submoduleKey;
      if (sm && typeof sm === 'object') return sm.submodule === submoduleKey;
      return false;
    });
  });
};

const normalizeUserRole = (role) =>
  String(role || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

const hasGeneralModuleAccess = (user) => {
  if (!user) return false;
  const role = normalizeUserRole(user.role);
  if (['super_admin', 'admin', 'higher_management', 'developer'].includes(role)) return true;
  if (hasModuleAccess(user.roleRef, 'general')) return true;
  if (hasGeneralSubmoduleAccess(user.roleRef, 'general_cash_approvals')) return true;
  if (Array.isArray(user.roles) && user.roles.some((r) => hasModuleAccess(r, 'general') || hasGeneralSubmoduleAccess(r, 'general_cash_approvals'))) {
    return true;
  }
  if (Array.isArray(user.subRoles) && user.subRoles.some((sr) => String(sr?.module || '') === 'general')) {
    return true;
  }
  return false;
};

const isGeneralCashApproval = (ca) =>
  ca && String(ca.originatingModule || '').toLowerCase() === GENERAL_MODULE;

const canManageGeneralCashApproval = (user, ca) => {
  if (!user || !ca) return false;
  if (['super_admin', 'admin'].includes(user.role)) return true;
  const uid = String(user._id || user.id || '');
  return uid && String(ca.createdBy?._id || ca.createdBy || '') === uid;
};

const normalizeLineItem = (raw, idx) => {
  const qty = round2(raw.quantity ?? raw.qty ?? 1);
  const rate = round2(raw.unitPrice ?? raw.rate ?? 0);
  const computed = round2(qty * rate);
  const amount = round2(raw.amount ?? raw.totalAmount ?? computed);
  const itemName = String(raw.itemName || raw.name || '').trim();
  const narration = String(raw.description ?? raw.narration ?? raw.specification ?? '').trim();
  const lineDesc = itemName || narration || `Line ${idx + 1}`;
  return {
    itemName,
    description: lineDesc,
    specification: narration,
    location: String(raw.location || '').trim(),
    quantity: qty > 0 ? qty : 0,
    unit: String(raw.unit || 'pcs').trim() || 'pcs',
    unitPrice: rate,
    taxRate: 0,
    discount: 0,
    amount: amount > 0 ? amount : computed,
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.filter((a) => a && a.url).map((a) => ({
        filename: a.filename || '',
        originalName: a.originalName || a.filename || '',
        url: a.url,
        mimeType: a.mimeType || '',
        uploadedAt: a.uploadedAt || new Date()
      }))
      : []
  };
};

const resolveGeneralCashApprovalTotals = (payload) => {
  const items = (payload.items || []).map(normalizeLineItem);
  const subtotal = round2(items.reduce((s, li) => s + (li.amount || 0), 0));
  const shippingCost = round2(payload.shippingCost || 0);
  const discountAmount = Math.max(0, round2(payload.discountAmount || 0));
  const totalAmount = Math.max(0, round2(subtotal + shippingCost - discountAmount));
  return { items, subtotal, taxAmount: 0, discountAmount, shippingCost, totalAmount };
};

const validateGeneralCashApprovalPayload = (payload, { forSubmit = false } = {}) => {
  const errors = [];
  const dept = String(payload.requestingDepartment || '').trim();
  if (!dept) errors.push('Department is required');

  const advanceEmployeeId = String(
    payload.advanceToEmployee?._id || payload.advanceToEmployee || ''
  ).trim();
  if (!advanceEmployeeId) errors.push('Advance to (employee) is required');

  const purpose = String(payload.purpose || '').trim();
  if (!purpose) errors.push('Purpose / narration is required');

  const { items, totalAmount } = resolveGeneralCashApprovalTotals(payload);
  if (!items.length) errors.push('Add at least one line item');
  items.forEach((li, i) => {
    if (!String(li.itemName || '').trim() && !String(li.specification || '').trim()) {
      errors.push(`Line ${i + 1}: item name or description is required`);
    }
    if (!(li.quantity > 0)) errors.push(`Line ${i + 1}: quantity must be greater than zero`);
    if (!(li.amount > 0)) errors.push(`Line ${i + 1}: total amount must be greater than zero`);
  });
  if (totalAmount <= 0) errors.push('Total amount must be greater than zero');

  if (forSubmit) {
    const approverIds = (payload.approverIds || payload.draftApproverIds || [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (!payload.skipApproverIds && approverIds.length !== 2) {
      errors.push('Select Manager Approver and Head Of Department Approver');
    }
  }

  return { errors, items, totalAmount };
};

const buildGeneralCashApprovalDocument = (body, createdBy, advanceRecipient = {}) => {
  const errors = [];
  const dept = String(body.requestingDepartment || '').trim();
  if (!dept) errors.push('Department is required');

  if (!advanceRecipient.advanceToEmployee) errors.push('Advance to (employee) is required');

  const purpose = String(body.purpose || '').trim();
  if (!purpose) errors.push('Purpose / narration is required');

  const totals = resolveGeneralCashApprovalTotals(body);
  if (!totals.items.length) errors.push('Add at least one line item');
  if (totals.totalAmount <= 0) errors.push('Total amount must be greater than zero');

  if (errors.length) {
    return { ok: false, errors };
  }
  const doc = {
    originatingModule: GENERAL_MODULE,
    requestingDepartment: dept,
    purpose,
    notes: String(body.notes || '').trim(),
    internalNotes: String(body.internalNotes || '').trim(),
    priority: body.priority || 'Urgent',
    approvalDate: body.approvalDate ? new Date(body.approvalDate) : new Date(),
    expectedPurchaseDate: body.expectedPurchaseDate
      ? new Date(body.expectedPurchaseDate)
      : body.approvalDate
        ? new Date(body.approvalDate)
        : new Date(),
    advanceTo: advanceRecipient.advanceTo,
    advanceToEmployee: advanceRecipient.advanceToEmployee,
    advanceGlAccount: advanceRecipient.advanceGlAccount,
    advanceGlAccountNumber: advanceRecipient.advanceGlAccountNumber || '',
    advanceToName: advanceRecipient.advanceToName || '',
    advanceAmount: totals.totalAmount,
    costCenter: body.costCenter || null,
    items: totals.items,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    discountAmount: totals.discountAmount,
    shippingCost: totals.shippingCost,
    totalAmount: totals.totalAmount,
    createdBy,
    departmentApprovalStatus: 'Draft',
    draftApproverIds: [],
    departmentApprovalChain: []
  };

  return { ok: true, doc };
};

const uniqueApproverIds = (ids = []) => [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];

const applyGeneralSubmitApprovers = async (ca, approverIds, actorId) => {
  const ids = uniqueApproverIds(approverIds);
  if (ids.length !== 2) {
    const err = new Error('Select Manager Approver and Head Of Department Approver');
    err.statusCode = 400;
    throw err;
  }
  if (actorId && ids.includes(String(actorId))) {
    const err = new Error('Requester cannot be selected as Manager or Head Of Department approver');
    err.statusCode = 400;
    throw err;
  }
  const check = await assertActiveUserApproversEligible(ids);
  if (!check.ok) {
    const err = new Error(check.message || 'Invalid approvers');
    err.statusCode = 400;
    throw err;
  }
  ca.draftApproverIds = [];
  ca.departmentApprovalChain = ids.map((approverId) => ({
    approver: approverId,
    status: 'pending'
  }));
  ca.departmentApprovalStatus = 'Submitted';
  ca.status = 'Pending Approval';
};

const approverIdFromStep = (step) => {
  const a = step?.approver;
  if (!a) return '';
  if (typeof a === 'object' && a._id) return String(a._id);
  return String(a);
};

/** Index of the first step still pending (Manager before HOD). */
const getFirstPendingDepartmentStepIndex = (chain = []) =>
  (chain || []).findIndex((step) => step.status === 'pending');

/** Index of the first rejected step in the department chain. */
const getRejectedDepartmentStepIndex = (chain = []) =>
  (chain || []).findIndex((step) => step.status === 'rejected');

/** Index user may act on, only if they are the current (first pending) approver. */
const getActorPendingDepartmentStepIndex = (chain, userId) => {
  const uid = String(userId || '');
  const idx = getFirstPendingDepartmentStepIndex(chain);
  if (idx === -1) return -1;
  return approverIdFromStep(chain[idx]) === uid ? idx : -1;
};

const GENERAL_RETURN_OR_REJECT_STATUSES = [
  'Rejected',
  'Returned from Audit',
  'Returned from CEO Office',
  'Returned from CEO Secretariat'
];

const isGeneralCashApprovalEditable = (ca) => {
  if (!isGeneralCashApproval(ca)) return false;
  if (GENERAL_RETURN_OR_REJECT_STATUSES.includes(ca.status)) return true;
  return (
    ['Draft', 'Pending Approval'].includes(ca.status) &&
    ['Draft', 'Submitted', 'Rejected'].includes(ca.departmentApprovalStatus || 'Draft')
  );
};

/** Re-queue after rejection — keep approved steps, reopen rejected/pending only (comparative-statement pattern). */
const resubmitGeneralDepartmentApproval = (ca) => {
  const chain = ca.departmentApprovalChain || [];
  const hasRejectedStep = chain.some((step) => step.status === 'rejected');
  const isRejected =
    ca.status === 'Rejected' ||
    ca.departmentApprovalStatus === 'Rejected' ||
    hasRejectedStep;

  if (!chain.length) {
    const err = new Error('No approval chain to resubmit');
    err.statusCode = 400;
    throw err;
  }

  if (!isRejected) {
    const err = new Error('This cash approval is not in a rejected state that can be resubmitted');
    err.statusCode = 400;
    throw err;
  }

  ca.departmentApprovalChain = chain.map((step) => {
    if (step.status === 'approved') {
      return {
        approver: step.approver,
        status: 'approved',
        actedAt: step.actedAt,
        comment: step.comment || ''
      };
    }
    return {
      approver: step.approver,
      status: 'pending',
      actedAt: undefined,
      comment: ''
    };
  });
  ca.departmentApprovalStatus = 'Submitted';
  ca.status = 'Pending Approval';
  ca.departmentRejectedBy = undefined;
  ca.departmentRejectedAt = undefined;
  ca.departmentRejectionReason = '';
  ca.markModified('departmentApprovalChain');
};

const departmentApproverRoleLabel = (index) => {
  if (index === 0) return 'Manager';
  if (index === 1) return 'Head of Department';
  return `Approver ${index + 1}`;
};

/** Who receives the resubmitted request (first pending step after preserving approvals). */
const getResubmitTargetDepartmentStepIndex = (ca) => {
  const chain = ca.departmentApprovalChain || [];
  const rejectedIdx = getRejectedDepartmentStepIndex(chain);
  if (rejectedIdx >= 0) return rejectedIdx;
  return getFirstPendingDepartmentStepIndex(chain);
};

const getResubmitTargetDepartmentRoleLabel = (ca) => {
  const idx = getResubmitTargetDepartmentStepIndex(ca);
  return idx >= 0 ? departmentApproverRoleLabel(idx) : 'approver';
};

const hasPreservedDepartmentApprovals = (ca) =>
  (ca?.departmentApprovalChain || []).some((step) => step.status === 'approved');

const RESUBMIT_TARGET_BY_FROM_STATUS = {
  'Pending Approval': { stage: 'department', status: 'Pending Approval', label: 'department approval' },
  'Pending Audit': { stage: 'audit', status: 'Pending Audit', label: 'Pre-Audit' },
  'Forwarded to Audit Director': { stage: 'audit', status: 'Pending Audit', label: 'Pre-Audit' },
  'Send to CEO Office': { stage: 'ceo_secretariat', status: 'Send to CEO Office', label: 'CEO Secretariat' },
  'Forwarded to CEO': { stage: 'ceo', status: 'Forwarded to CEO', label: 'CEO' },
  'Pending Finance': { stage: 'finance', status: 'Pending Finance', label: 'Finance' },
  // Current return statuses also map directly
  'Returned from Audit': { stage: 'audit', status: 'Pending Audit', label: 'Pre-Audit' },
  'Returned from CEO Office': { stage: 'ceo', status: 'Forwarded to CEO', label: 'CEO' },
  'Returned from CEO Secretariat': { stage: 'ceo_secretariat', status: 'Send to CEO Office', label: 'CEO Secretariat' }
};

const RETURN_TO_STATUS_DEFAULT_FROM = {
  'Returned from Audit': 'Pending Audit',
  'Returned from CEO Office': 'Forwarded to CEO',
  'Returned from CEO Secretariat': 'Send to CEO Office',
  Rejected: ''
};

/** Status the document was in when it was last returned/rejected. */
const getRejectedFromStatus = (ca) => {
  if (ca?.returnedFromStatus && RESUBMIT_TARGET_BY_FROM_STATUS[ca.returnedFromStatus]) {
    return ca.returnedFromStatus;
  }
  // If still in a return status, that status itself encodes the destination
  if (RETURN_TO_STATUS_DEFAULT_FROM[ca?.status]) {
    return RETURN_TO_STATUS_DEFAULT_FROM[ca.status] || ca.returnedFromStatus || '';
  }

  const history = Array.isArray(ca?.workflowHistory) ? ca.workflowHistory : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const toStatus = String(history[i]?.toStatus || '');
    const fromStatus = String(history[i]?.fromStatus || '');
    if (toStatus === 'Rejected') {
      return fromStatus || 'Pending Approval';
    }
    if (RETURN_TO_STATUS_DEFAULT_FROM[toStatus]) {
      return fromStatus || RETURN_TO_STATUS_DEFAULT_FROM[toStatus];
    }
  }
  const dated = [
    { at: ca?.financeRejectedAt, from: 'Pending Finance' },
    { at: ca?.auditRejectedAt, from: 'Pending Audit' },
    { at: ca?.ceoReturnedAt, from: 'Forwarded to CEO' },
    { at: ca?.ceoRejectedAt, from: 'Forwarded to CEO' },
    { at: ca?.departmentRejectedAt, from: 'Pending Approval' }
  ].filter((row) => row.at);
  if (dated.length) {
    dated.sort((a, b) => new Date(b.at) - new Date(a.at));
    return dated[0].from;
  }
  if (getRejectedDepartmentStepIndex(ca?.departmentApprovalChain) >= 0) {
    return 'Pending Approval';
  }
  return '';
};

const resolveGeneralResubmitTarget = (ca) => {
  const fromStatus = getRejectedFromStatus(ca) || 'Pending Approval';
  const target = RESUBMIT_TARGET_BY_FROM_STATUS[fromStatus] || RESUBMIT_TARGET_BY_FROM_STATUS['Pending Approval'];
  return { ...target, fromStatus };
};

const resubmitHistoryComment = (ca, target) => {
  switch (target.stage) {
    case 'department':
      return hasPreservedDepartmentApprovals(ca)
        ? 'Resubmitted after rejection (prior department approvals preserved)'
        : 'Resubmitted after rejection for department review';
    case 'audit':
      return 'Resubmitted after audit rejection for Pre-Audit review';
    case 'finance':
      return 'Resubmitted after finance rejection for finance review';
    case 'ceo_secretariat':
      return 'Resubmitted after CEO Secretariat rejection';
    case 'ceo':
      return 'Resubmitted after CEO rejection';
    default:
      return 'Resubmitted after rejection';
  }
};

const clearReturnedFromStatus = (ca) => {
  ca.returnedFromStatus = '';
};

const resubmitGeneralToAudit = (ca, buildChangeSummary) => {
  const snapshot = ca.auditSnapshotAtReturn;
  if (snapshot && typeof buildChangeSummary === 'function') {
    const summary = buildChangeSummary(ca.items, snapshot);
    ca.resubmissionChangeSummary = summary || ca.resubmissionChangeSummary || '';
  }
  ca.status = 'Pending Audit';
  ca.auditRejectedBy = undefined;
  ca.auditRejectedAt = undefined;
  ca.auditRejectionComments = '';
  clearReturnedFromStatus(ca);
};

const resubmitGeneralToFinance = (ca) => {
  ca.financeAuthorityApprovals = (ca.financeAuthorityApprovals || []).filter(
    (row) => String(row?.decision || 'approved').trim() !== 'rejected'
  );
  ca.financeRejectedBy = undefined;
  ca.financeRejectedAt = undefined;
  ca.financeRejectionComments = '';
  ca.status = 'Pending Finance';
  ca.markModified('financeAuthorityApprovals');
  clearReturnedFromStatus(ca);
};

const resubmitGeneralToCeoSecretariat = (ca) => {
  ca.status = 'Send to CEO Office';
  ca.ceoRejectedBy = undefined;
  ca.ceoRejectedAt = undefined;
  ca.ceoRejectionComments = '';
  ca.ceoReturnedBy = undefined;
  ca.ceoReturnedAt = undefined;
  ca.ceoReturnComments = '';
  clearReturnedFromStatus(ca);
};

const resubmitGeneralToCeo = (ca) => {
  ca.status = 'Forwarded to CEO';
  ca.ceoRejectedBy = undefined;
  ca.ceoRejectedAt = undefined;
  ca.ceoRejectionComments = '';
  ca.ceoReturnedBy = undefined;
  ca.ceoReturnedAt = undefined;
  ca.ceoReturnComments = '';
  clearReturnedFromStatus(ca);
};

const isGeneralCashApprovalResubmitState = (ca) => {
  if (!isGeneralCashApproval(ca) || ca.status === 'Draft') return false;
  if (GENERAL_RETURN_OR_REJECT_STATUSES.includes(ca.status)) return true;
  if (ca.departmentApprovalStatus === 'Rejected') return true;
  return getRejectedDepartmentStepIndex(ca.departmentApprovalChain) >= 0;
};

const applyGeneralResubmit = async (ca, approverIds, actorId, { buildChangeSummary } = {}) => {
  const ids = uniqueApproverIds(approverIds);
  const target = resolveGeneralResubmitTarget(ca);
  // Department stage: preserve approved Manager/HOD steps; only reopen rejected/pending
  if (target.stage === 'department') {
    const chain = ca.departmentApprovalChain || [];
    if (chain.length > 0) {
      if (ids.length === 2) {
        ids.forEach((approverId, idx) => {
          const step = ca.departmentApprovalChain[idx];
          if (step && step.status !== 'approved') {
            step.approver = approverId;
          }
        });
      }
      resubmitGeneralDepartmentApproval(ca);
      clearReturnedFromStatus(ca);
    } else {
      if (!isGeneralCashApprovalResubmitState(ca)) {
        const err = new Error('This cash approval is not in a rejected/returned state that can be resubmitted');
        err.statusCode = 400;
        throw err;
      }
      await applyGeneralSubmitApprovers(ca, ids, actorId);
      clearReturnedFromStatus(ca);
    }
  } else if (target.stage === 'audit') {
    // Keep department approvals intact — go straight back to Pre-Audit
    resubmitGeneralToAudit(ca, buildChangeSummary);
  } else if (target.stage === 'finance') {
    resubmitGeneralToFinance(ca);
  } else if (target.stage === 'ceo_secretariat') {
    // Keep all prior approvals — go back to CEO Secretariat
    resubmitGeneralToCeoSecretariat(ca);
  } else if (target.stage === 'ceo') {
    // Keep all prior approvals — go back to CEO
    resubmitGeneralToCeo(ca);
  }

  return {
    ...target,
    historyComment: resubmitHistoryComment(ca, target)
  };
};

module.exports = {
  GENERAL_MODULE,
  GENERAL_RETURN_OR_REJECT_STATUSES,
  isGeneralCashApproval,
  hasGeneralModuleAccess,
  canManageGeneralCashApproval,
  validateGeneralCashApprovalPayload,
  resolveGeneralCashApprovalTotals,
  buildGeneralCashApprovalDocument,
  normalizeLineItem,
  uniqueApproverIds,
  applyGeneralSubmitApprovers,
  getEligibleUtilityBillApproverUserIds,
  approverIdFromStep,
  getFirstPendingDepartmentStepIndex,
  getActorPendingDepartmentStepIndex,
  getRejectedDepartmentStepIndex,
  isGeneralCashApprovalEditable,
  isGeneralCashApprovalResubmitState,
  resubmitGeneralDepartmentApproval,
  applyGeneralResubmit,
  departmentApproverRoleLabel,
  getResubmitTargetDepartmentStepIndex,
  getResubmitTargetDepartmentRoleLabel,
  hasPreservedDepartmentApprovals,
  getRejectedFromStatus,
  resolveGeneralResubmitTarget,
  resubmitHistoryComment
};
