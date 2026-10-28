/**
 * Build personal executive approval inbox for the logged-in user.
 * Only documents where the user is the active approver right now.
 */

const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const CashApproval = require('../models/procurement/CashApproval');
const PaymentSettlement = require('../models/hr/PaymentSettlement');
const NonEmployeeRecord = require('../models/hr/NonEmployeeRecord');
const ManualSalary = require('../models/hr/ManualSalary');
const Indent = require('../models/general/Indent');
const UtilityBill = require('../models/hr/UtilityBill');
const AccountsPayable = require('../models/finance/AccountsPayable');
const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
const {
  isDesignatedCeoApprover,
  isCeoSecretariatPsRole,
  canViewCeoForwardedQueue,
  isExecutiveOverride,
  resolveDesignatedCeoUserIds,
  userMatchesText,
  sameUserId,
  isDevNewEmployeeSrDirectorApprover
} = require('./executiveAccess');
const {
  isAssignedByAuthorityText: isAssignedByPoAuthorityText,
  userHasPendingAuthoritySlots,
  getAssignedIndentIdsForUser,
  sanitizeApprovalAuthorities
} = require('./purchaseOrderAuthority');
const { getActorPendingDepartmentStepIndex, isGeneralCashApproval } = require('./generalCashApproval');
const { getWorkflowStatusForUserAndRole } = require('./paymentSettlementWorkflow');

/** Resolve a human-readable company label from common document shapes. */
const resolveCompanyLabel = (...sources) => {
  for (const doc of sources) {
    if (!doc) continue;
    if (typeof doc === 'string' && doc.trim()) return doc.trim();
    if (typeof doc !== 'object') continue;
    const candidates = [
      doc.company,
      doc.companyName,
      doc.parentCompanyName,
      doc.subsidiaryName,
      doc.accountHead,
      doc.companyId,
      doc.placementCompany,
      doc.indent?.companyId,
      doc.indent?.company,
      doc.indent?.companyName
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim() && c.trim() !== '—') return c.trim();
      if (c && typeof c === 'object') {
        const name = c.name || c.companyName || c.companyCode;
        if (typeof name === 'string' && name.trim()) return name.trim();
      }
    }
  }
  return null;
};

const card = (partial) => ({
  id: String(partial.id),
  type: partial.type,
  number: partial.number || '—',
  status: partial.status || '—',
  date: partial.date || null,
  amount: partial.amount != null ? Number(partial.amount) : null,
  party: partial.party || null,
  company: partial.company || null,
  subtitle: partial.subtitle || null,
  path: partial.path || null,
  // Flags for existing executive UI / approve routes
  isPurchaseOrder: partial.type === 'purchase_order',
  isCashApproval: partial.type === 'cash_approval',
  isPaymentSettlement: partial.type === 'payment_settlement',
  isOnboarding: partial.type === 'onboarding',
  isManualSalary: partial.type === 'manual_salary',
  isIndent: partial.type === 'indent',
  isUtilityBill: partial.type === 'utility_bill',
  isVendorBill: partial.type === 'vendor_bill',
  isProjectIpc: partial.type === 'project_ipc',
  itemType: partial.itemType,
  displayRef: partial.number,
  displayDate: partial.date,
  displayAmount: partial.amount != null ? Number(partial.amount) : 0,
  displayVendor: partial.party || '—',
  displayNotes: partial.subtitle || partial.itemType || '',
  department: partial.department || null,
  workflowStatus: partial.status,
  /** PS / secretariat may see CEO queue but must not approve as CEO */
  ceoViewOnly: Boolean(partial.ceoViewOnly),
  /** User may use Approve/Reject on the executive desk right now */
  canAct: Boolean(partial.canAct),
  raw: partial.raw || null
});

const isAssignedByAuthorityText = (approvalAuthorities, user, createdAt = null) => {
  const authorities = sanitizeApprovalAuthorities(approvalAuthorities, createdAt);
  const assignedTexts = [
    authorities.preparedBy,
    authorities.verifiedBy,
    authorities.authorisedRep,
    authorities.financeRep,
    authorities.managerProcurement,
    authorities.srManagerProcurement,
    authorities.ceoApproval,
    authorities.avp,
    authorities.chairman
  ].filter(Boolean);
  return assignedTexts.some((t) => userMatchesText(user, t));
};

const userPendingInChain = (chain, user) => {
  if (!Array.isArray(chain) || !chain.length) return false;
  const uid = String(user._id || user.id || '');
  return chain.some((step) => {
    if (String(step.status || '').toLowerCase() !== 'pending') return false;
    return sameUserId(step.approver, uid);
  });
};

/** First pending approver id on a chain (string), or ''. */
const firstPendingApproverId = (chain) => {
  if (!Array.isArray(chain)) return '';
  const step = chain.find((s) => String(s.status || '').toLowerCase() === 'pending');
  if (!step) return '';
  return String(step.approver?._id || step.approver || '');
};

/**
 * CEO office ids for Other-tab queue (Indent / Utility / Vendor).
 * Includes env + role=ceo; also the logged-in designated CEO (non-override).
 */
async function getCeoOfficeApproverIds(user) {
  if (!canViewCeoForwardedQueue(user)) return [];
  const mongoose = require('mongoose');
  const ids = await resolveDesignatedCeoUserIds();
  const uid = String(user._id || user.id || '');
  if (
    uid
    && isDesignatedCeoApprover(user)
    && !isExecutiveOverride(user)
    && !ids.includes(uid)
  ) {
    ids.push(uid);
  }
  return ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
}

const isPendingOnCeoOffice = (chain, ceoIds) => {
  if (!ceoIds?.length) return false;
  const pendingId = firstPendingApproverId(chain);
  return Boolean(pendingId && ceoIds.some((id) => String(id) === pendingId));
};

/**
 * Sequential approvalChain: only the first pending step may act (matches AP / indent APIs).
 */
function resolveSequentialChainAction(chain, user, ceoIds = []) {
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);
  const uid = String(user._id || user.id || '');
  const pendingId = firstPendingApproverId(chain);
  if (!pendingId) {
    return { include: false, canAct: false, ceoViewOnly: false };
  }
  const onCeoQueue = (ceoIds || []).some((id) => String(id) === pendingId);
  if (pendingId === uid) {
    return { include: true, canAct: true, ceoViewOnly: false };
  }
  if (onCeoQueue && canViewCeoQueue) {
    return { include: true, canAct: isCeo, ceoViewOnly: !isCeo };
  }
  return { include: false, canAct: false, ceoViewOnly: false };
}

async function fetchPurchaseOrdersForUser(user) {
  const uid = String(user._id || user.id || '');
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);

  const or = [];
  if (canViewCeoQueue) {
    or.push({ status: 'Forwarded to CEO' });
  }

  const indentIds = await getAssignedIndentIdsForUser(uid);
  if (indentIds.length) {
    or.push({ status: 'Pending Approval', indent: { $in: indentIds } });
  }

  const populatePoCompany = (q) => q
    .populate('vendor', 'name')
    .populate('companyId', 'name companyCode')
    .populate({
      path: 'indent',
      select: 'indentNumber title comparativeStatementApprovals companyId companyName',
      populate: { path: 'companyId', select: 'name companyCode' }
    });

  let docs = [];
  if (or.length) {
    docs = await populatePoCompany(
      PurchaseOrder.find({ $or: or }).populate('createdBy', 'firstName lastName')
    )
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
  }

  const candidates = await populatePoCompany(
    PurchaseOrder.find({
      status: 'Pending Approval',
      _id: { $nin: docs.map((d) => d._id) }
    })
  )
    .sort({ updatedAt: -1 })
    .limit(80)
    .lean();

  docs = [
    ...docs,
    ...candidates.filter((po) => isAssignedByPoAuthorityText(po.approvalAuthorities, user, po.createdAt))
  ];

  const seen = new Set();
  const cards = [];

  for (const po of docs) {
    const id = String(po._id);
    if (seen.has(id)) continue;
    seen.add(id);

    const status = po.status;
    let canAct = false;
    let ceoViewOnly = false;

    if (status === 'Forwarded to CEO') {
      if (!canViewCeoQueue) continue;
      canAct = isCeo;
      ceoViewOnly = !isCeo;
    } else if (status === 'Pending Approval') {
      const pending = await userHasPendingAuthoritySlots(
        po.indent?._id || po.indent,
        po.approvalAuthorities,
        po.authorityApprovals,
        user,
        po.createdAt
      );
      if (!pending) continue;
      canAct = true;
    } else {
      continue;
    }

    if (!canAct && !ceoViewOnly) continue;

    cards.push(card({
      id: po._id,
      type: 'purchase_order',
      itemType: 'Purchase Order',
      number: po.orderNumber || po.poNumber,
      status: po.status,
      date: po.orderDate || po.updatedAt,
      amount: po.totalAmount,
      party: po.vendor?.name,
      company: resolveCompanyLabel(po, po.indent),
      subtitle: po.notes || (po.indent?.title ? `PR: ${po.indent.title}` : 'Purchase Order'),
      department: 'Procurement',
      path: `/procurement/purchase-orders/${po._id}`,
      ceoViewOnly,
      canAct,
      raw: po
    }));
  }

  return cards;
}

async function resolveCashApprovalCanAct(ca, user) {
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);
  const uid = String(user._id || user.id || '');
  const status = ca.status || ca.workflowStatus;

  if (status === 'Forwarded to CEO') {
    if (!canViewCeoQueue) return { include: false, canAct: false, ceoViewOnly: false };
    return { include: true, canAct: isCeo, ceoViewOnly: !isCeo };
  }

  if (status !== 'Pending Approval') {
    return { include: false, canAct: false, ceoViewOnly: false };
  }

  if (isGeneralCashApproval(ca)) {
    const stepIndex = getActorPendingDepartmentStepIndex(ca.departmentApprovalChain, uid);
    if (stepIndex >= 0) {
      return { include: true, canAct: true, ceoViewOnly: false };
    }
    return { include: false, canAct: false, ceoViewOnly: false };
  }

  const pending = await userHasPendingAuthoritySlots(
    ca.indent?._id || ca.indent,
    ca.approvalAuthorities,
    ca.authorityApprovals,
    user
  );
  if (pending) {
    return { include: true, canAct: true, ceoViewOnly: false };
  }
  return { include: false, canAct: false, ceoViewOnly: false };
}

async function fetchCashApprovalsForUser(user) {
  const uid = String(user._id || user.id || '');
  const canViewCeoQueue = canViewCeoForwardedQueue(user);

  const or = [];
  if (canViewCeoQueue) or.push({ status: 'Forwarded to CEO' });

  or.push({
    status: 'Pending Approval',
    'departmentApprovalChain.approver': uid,
    'departmentApprovalChain.status': 'pending',
    departmentApprovalStatus: { $in: ['Submitted', 'Pending'] }
  });

  const indentIds = await getAssignedIndentIdsForUser(uid);
  if (indentIds.length) {
    or.push({ status: 'Pending Approval', indent: { $in: indentIds } });
  }

  let docs = await CashApproval.find({ $or: or })
    .populate('vendor', 'name')
    .populate('companyId', 'name companyCode')
    .populate('createdBy', 'firstName lastName')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  const candidates = await CashApproval.find({
    status: 'Pending Approval',
    _id: { $nin: docs.map((d) => d._id) }
  })
    .populate('vendor', 'name')
    .populate('companyId', 'name companyCode')
    .sort({ updatedAt: -1 })
    .limit(80)
    .lean();

  docs = [
    ...docs,
    ...candidates.filter((ca) => isAssignedByPoAuthorityText(ca.approvalAuthorities, user))
  ];

  const seen = new Set();
  const cards = [];

  for (const ca of docs) {
    const id = String(ca._id);
    if (seen.has(id)) continue;
    seen.add(id);

    const { include, canAct, ceoViewOnly } = await resolveCashApprovalCanAct(ca, user);
    if (!include || (!canAct && !ceoViewOnly)) continue;

    cards.push(card({
      id: ca._id,
      type: 'cash_approval',
      itemType: 'Cash Approval',
      number: ca.caNumber,
      status: ca.status || ca.workflowStatus,
      date: ca.approvalDate || ca.updatedAt,
      amount: ca.totalAmount || ca.advanceAmount,
      party: ca.advanceToName || ca.vendor?.name || ca.requestingDepartment,
      company: resolveCompanyLabel(ca),
      subtitle: ca.purpose || 'Cash Approval',
      department: ca.requestingDepartment || 'Cash Approval',
      path: `/procurement/cash-approvals/${ca._id}`,
      ceoViewOnly,
      canAct,
      raw: ca
    }));
  }

  return cards;
}

const settlementAuthorizationTexts = (s) => [
  s.preparedBy,
  s.checkedBy,
  s.approvedBy,
  s.authorisedBy,
  s.verifiedBy,
  s.custodian
];

function resolveSettlementCanAct(s, user) {
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);
  const ws = s.workflowStatus || s.status || '';

  if (!ws || ws.startsWith('Approved (from ') || ws.startsWith('Rejected (from ')) {
    return { include: false, canAct: false, ceoViewOnly: false };
  }

  if (ws === 'Forwarded to CEO') {
    if (!canViewCeoQueue) return { include: false, canAct: false, ceoViewOnly: false };
    return { include: true, canAct: isCeo, ceoViewOnly: !isCeo };
  }

  if (ws === 'Forwarded to Audit Director') {
    return { include: false, canAct: false, ceoViewOnly: false };
  }

  const roleStatus = getWorkflowStatusForUserAndRole(user.email, user.role);
  if (roleStatus && ws === roleStatus) {
    return { include: true, canAct: true, ceoViewOnly: false };
  }

  if (ws.includes('Send to')) {
    if (!roleStatus) {
      const nameMatch = settlementAuthorizationTexts(s).some((t) => userMatchesText(user, t));
      if (nameMatch) {
        return { include: true, canAct: true, ceoViewOnly: false };
      }
    }
    const privileged = ['super_admin', 'admin', 'developer'].includes(String(user.role || ''));
    if (privileged && ws.startsWith('Send to ')) {
      return { include: true, canAct: true, ceoViewOnly: false };
    }
  }

  return { include: false, canAct: false, ceoViewOnly: false };
}

async function fetchSettlementsForUser(user) {
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);
  const roleStatus = getWorkflowStatusForUserAndRole(user.email, user.role);

  const or = [];
  if (canViewCeoQueue) or.push({ workflowStatus: 'Forwarded to CEO' });
  if (roleStatus) or.push({ workflowStatus: roleStatus });

  let docs = [];
  if (or.length) {
    docs = await PaymentSettlement.find({ $or: or })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
  }

  const privileged = ['super_admin', 'admin', 'developer'].includes(String(user.role || ''));
  if (!roleStatus && (!isCeo || privileged)) {
    const byName = await PaymentSettlement.find({
      workflowStatus: { $regex: /^Send to / },
      _id: { $nin: docs.map((d) => d._id) }
    })
      .sort({ updatedAt: -1 })
      .limit(80)
      .lean();
    const extra = byName.filter((s) => {
      if (privileged) return true;
      return settlementAuthorizationTexts(s).some((t) => userMatchesText(user, t));
    });
    docs = [...docs, ...extra];
  }

  const seen = new Set();
  const cards = [];

  for (const s of docs) {
    const id = String(s._id);
    if (seen.has(id)) continue;
    seen.add(id);

    const { include, canAct, ceoViewOnly } = resolveSettlementCanAct(s, user);
    if (!include || (!canAct && !ceoViewOnly)) continue;

    cards.push(card({
      id: s._id,
      type: 'payment_settlement',
      itemType: 'Payment Settlement',
      number: s.referenceNumber || String(s._id),
      status: s.workflowStatus || s.status,
      date: s.date || s.updatedAt,
      amount: parseFloat(String(s.grandTotal || s.amount || '0').replace(/,/g, '')) || 0,
      party: s.toWhomPaid || s.custodian,
      subtitle: s.forWhat || s.notes || 'Payment Settlement',
      department: s.fromDepartment || 'Administration',
      company: resolveCompanyLabel(s) || s.subsidiaryName || s.parentCompanyName || null,
      path: `/admin/payment-settlement`,
      ceoViewOnly,
      canAct,
      raw: s
    }));
  }

  return cards;
}

async function fetchManualSalariesForUser(user) {
  const uid = String(user._id || user.id || '');
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);
  const or = [
    { workflowStatus: 'Pending HOD HR', assignedHod: uid },
    { workflowStatus: 'Pending AVP', assignedAvp: uid }
  ];
  if (canViewCeoQueue) or.push({ workflowStatus: 'Forwarded to CEO' });

  const docs = await ManualSalary.find({ $or: or })
    .populate('assignedHod', 'firstName lastName email digitalSignature')
    .populate('assignedAvp', 'firstName lastName email digitalSignature')
    .populate('hodApprovedBy', 'firstName lastName email digitalSignature')
    .populate('avpApprovedBy', 'firstName lastName email digitalSignature')
    .populate('ceoApprovedBy', 'firstName lastName email digitalSignature')
    .populate('initiator', 'firstName lastName email digitalSignature')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return docs.map((r) => {
    const ws = r.workflowStatus;
    let canAct = false;
    let ceoViewOnly = false;
    if (ws === 'Forwarded to CEO') {
      canAct = isCeo;
      ceoViewOnly = !isCeo && canViewCeoQueue;
    } else if (ws === 'Pending HOD HR' && sameUserId(r.assignedHod, uid)) canAct = true;
    else if (ws === 'Pending AVP' && sameUserId(r.assignedAvp, uid)) canAct = true;

    if (!canAct && !ceoViewOnly) return null;

    const period = `${monthNames[(r.month || 1) - 1] || ''} ${r.year || ''}`.trim();
    return card({
      id: r._id,
      type: 'manual_salary',
      itemType: 'Manual Salary',
      number: r.empId || String(r._id).slice(-6),
      status: r.workflowStatus,
      date: r.updatedAt || r.createdAt,
      amount: r.netPayable,
      party: r.name,
      company: r.project || null,
      subtitle: `Manual salary — ${period}${r.designation ? ` · ${r.designation}` : ''}`,
      department: 'HR',
      path: `/hr/payroll`,
      ceoViewOnly,
      canAct,
      raw: r
    });
  }).filter(Boolean);
}

async function fetchOnboardingForUser(user) {
  const uid = String(user._id || user.id || '');
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);
  const isDevSrDirector = isDevNewEmployeeSrDirectorApprover(user);
  const or = [
    { workflowStatus: 'Pending AVP', assignedAvp: uid },
    { workflowStatus: 'Pending Chairman', assignedChairman: uid },
    { workflowStatus: 'Pending HOD HR', assignedHod: uid },
    { workflowStatus: 'Pending Sr Director', assignedSrDirector: uid }
  ];
  // Dev only: Hamza Tanveer can see all Pending Sr Director onboarding items
  if (isDevSrDirector) {
    or.push({ workflowStatus: 'Pending Sr Director' });
  }
  if (canViewCeoQueue) or.push({ workflowStatus: 'Forwarded to CEO' });

  const docs = await NonEmployeeRecord.find({ $or: or })
    .populate('assignedAvp', 'firstName lastName')
    .populate('assignedChairman', 'firstName lastName')
    .populate('assignedHod', 'firstName lastName')
    .populate('assignedSrDirector', 'firstName lastName')
    .populate('hodApprovedBy', 'firstName lastName email')
    .populate('avpApprovedBy', 'firstName lastName email')
    .populate('chairmanApprovedBy', 'firstName lastName email')
    .populate('srDirectorApprovedBy', 'firstName lastName email')
    .populate('ceoApprovedBy', 'firstName lastName email')
    .populate('returnObservations.addedBy', 'firstName lastName email')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  return docs.map((r) => {
    const first = Array.isArray(r.employees) && r.employees[0] ? r.employees[0] : null;
    const party = first
      ? (first.name || [first.firstName, first.lastName].filter(Boolean).join(' ').trim())
      : (r.employeeName || [r.firstName, r.lastName].filter(Boolean).join(' ') || '—');
    const extra = Array.isArray(r.employees) && r.employees.length > 1
      ? ` (+${r.employees.length - 1} more)`
      : '';
    const ws = r.workflowStatus;
    const sameAssignee = (field) => sameUserId(field, uid);
    let canAct = false;
    let ceoViewOnly = false;
    if (ws === 'Forwarded to CEO') {
      canAct = isCeo;
      ceoViewOnly = !isCeo && canViewCeoQueue;
    } else if (ws === 'Pending AVP' && sameAssignee(r.assignedAvp)) canAct = true;
    else if (ws === 'Pending Chairman' && sameAssignee(r.assignedChairman)) canAct = true;
    else if (ws === 'Pending HOD HR' && sameAssignee(r.assignedHod)) canAct = true;
    else if (
      ws === 'Pending Sr Director'
      && (sameAssignee(r.assignedSrDirector) || isDevSrDirector)
    ) {
      canAct = true;
    }

    if (!canAct && !ceoViewOnly) return null;

    return card({
      id: r._id,
      type: 'onboarding',
      itemType: 'New-Hiring Approval',
      number: r.recordNumber || first?.cnic || String(r._id),
      status: r.workflowStatus,
      date: r.updatedAt || r.createdAt,
      amount: null,
      party: `${party || '—'}${extra}`,
      company: resolveCompanyLabel(r, first) || first?.project || first?.location || null,
      subtitle: 'New-Hiring Approval',
      department: 'HR',
      path: `/hr/non-employee-onboarding`,
      ceoViewOnly,
      canAct,
      raw: r
    });
  }).filter(Boolean);
}

async function fetchIndentsForUser(user, ceoIds = []) {
  const uid = String(user._id || user.id || '');
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);

  const or = [
    { approvalChain: { $elemMatch: { approver: uid, status: 'pending' } } }
  ];
  if (canViewCeoQueue && ceoIds.length) {
    or.push({
      approvalChain: {
        $elemMatch: { approver: { $in: ceoIds }, status: 'pending' }
      }
    });
  }

  const docs = await Indent.find({
    $or: or,
    status: { $nin: ['Draft', 'Cancelled', 'Rejected', 'Fulfilled'] }
  })
    .populate('requestedBy', 'firstName lastName')
    .populate('department', 'name')
    .populate('companyId', 'name companyCode')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  const seen = new Set();
  return docs.filter((ind) => {
    const id = String(ind._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((ind) => {
    const { include, canAct, ceoViewOnly } = resolveSequentialChainAction(ind.approvalChain, user, ceoIds);
    if (!include || (!canAct && !ceoViewOnly)) return null;
    return card({
      id: ind._id,
      type: 'indent',
      itemType: 'Indent',
      number: ind.indentNumber,
      status: ind.status,
      date: ind.requestedDate || ind.updatedAt,
      amount: ind.estimatedTotal || null,
      party: ind.requestedBy
        ? `${ind.requestedBy.firstName || ''} ${ind.requestedBy.lastName || ''}`.trim()
        : null,
      subtitle: ind.title || 'Indent pending approval',
      department: ind.department?.name || 'Indent',
      company: resolveCompanyLabel(ind),
      path: `/general/indents/${ind._id}`,
      ceoViewOnly,
      canAct,
      raw: ind
    });
  }).filter(Boolean);
}

async function fetchUtilityBillsForUser(user, ceoIds = []) {
  const uid = String(user._id || user.id || '');
  const isCeo = isDesignatedCeoApprover(user);
  const canViewCeoQueue = canViewCeoForwardedQueue(user);

  const or = [
    { approvalChain: { $elemMatch: { approver: uid, status: 'pending' } } }
  ];
  if (canViewCeoQueue && ceoIds.length) {
    or.push({
      approvalChain: {
        $elemMatch: { approver: { $in: ceoIds }, status: 'pending' }
      }
    });
  }

  const docs = await UtilityBill.find({
    $or: or,
    approvalStatus: 'Submitted'
  })
    .populate('createdBy', 'firstName lastName')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  const seen = new Set();
  return docs.filter((b) => {
    const id = String(b._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((b) => {
    const { include, canAct, ceoViewOnly } = resolveSequentialChainAction(b.approvalChain, user, ceoIds);
    if (!include || (!canAct && !ceoViewOnly)) return null;
    return card({
      id: b._id,
      type: 'utility_bill',
      itemType: 'Store / Utility Bill',
      number: b.billId || b.billNumber || String(b._id),
      status: b.approvalStatus || b.status,
      date: b.billDate || b.updatedAt,
      amount: b.totalAmount,
      party: b.provider || b.vendorName,
      company: resolveCompanyLabel(b) || b.accountHead || b.site || null,
      subtitle: b.forWhat || b.notes || 'Bill pending approval',
      department: 'Centralized Store',
      path: `/general/centralized-store/bills`,
      ceoViewOnly,
      canAct,
      raw: b
    });
  }).filter(Boolean);
}

async function fetchVendorBillsForUser(user, ceoIds = []) {
  const canViewCeoQueue = canViewCeoForwardedQueue(user);
  const uid = String(user._id || user.id || '');

  // Chart of Accounts bills: department approvalChain (Sr Manager Finance → GM Finance), sequential pending step
  const or = [
    { approvalChain: { $elemMatch: { approver: uid, status: 'pending' } } }
  ];
  if (canViewCeoQueue && ceoIds.length) {
    or.push({
      approvalChain: {
        $elemMatch: { approver: { $in: ceoIds }, status: 'pending' }
      }
    });
  }

  const docs = await AccountsPayable.find({
    approvalStatus: 'Submitted',
    $or: or,
    status: { $nin: ['paid', 'cancelled', 'void', 'approved', 'partial'] }
  })
    .select('billNumber billDate totalAmount status approvalStatus vendor vendorName company companyId notes approvalChain module referenceType')
    .populate('companyId', 'name companyCode')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean()
    .catch(() => []);

  const seen = new Set();
  return (docs || [])
    .filter((b) => {
      const id = String(b._id);
      if (seen.has(id)) return false;
      seen.add(id);
      const chain = Array.isArray(b.approvalChain) ? b.approvalChain : [];
      const { include } = resolveSequentialChainAction(chain, user, ceoIds);
      return include;
    })
    .map((b) => {
      const chain = Array.isArray(b.approvalChain) ? b.approvalChain : [];
      const { include, canAct, ceoViewOnly } = resolveSequentialChainAction(chain, user, ceoIds);
      if (!include || (!canAct && !ceoViewOnly)) return null;
      return card({
        id: b._id,
        type: 'vendor_bill',
        itemType: 'Chart of Accounts Bill',
        number: b.billNumber,
        status: b.approvalStatus || b.status,
        date: b.billDate || b.updatedAt,
        amount: b.totalAmount,
        party: b.vendorName || b.vendor?.name,
        company: resolveCompanyLabel(b),
        subtitle: b.notes || 'Pending department approval (Finance)',
        department: 'Finance',
        path: `/finance/accounts-payable`,
        ceoViewOnly,
        canAct,
        raw: b
      });
    })
    .filter(Boolean);
}

/** Project Management subcontractor IPCs forwarded by the PS: CEO acts, PS / coordinators view only. */
async function fetchProjectIpcsForUser(user) {
  if (!canViewCeoForwardedQueue(user)) return [];
  const isCeo = isDesignatedCeoApprover(user);
  const docs = await ProjectInvoice.find({ invoiceType: { $in: ['Subcontractor_IPC', 'Client_Invoice'] }, approvalStatus: 'Forwarded to CEO' })
    .populate('contractor', 'name')
    .populate({ path: 'project', select: 'name parentProject', populate: { path: 'parentProject', select: 'name' } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  // Company comes from the Main Project's Finance company (IPCs don't store one)
  const { ipcCompanyNames } = require('./projectIpcFinance');
  const companyNames = await ipcCompanyNames(docs);
  return docs.map((inv) => card({
    id: inv._id,
    type: 'project_ipc',
    itemType: inv.invoiceType === 'Client_Invoice' ? 'Client Invoice'
      : inv.ipcKind && inv.ipcKind !== 'Work' ? `Subcontractor ${inv.ipcKind}` : 'Subcontractor IPC',
    number: inv.invoiceType === 'Client_Invoice' ? inv.invoiceNumber : `IPC #${inv.ipcNumber} · ${inv.invoiceNumber}`,
    status: inv.approvalStatus,
    date: inv.ceoForwardedAt || inv.updatedAt,
    amount: inv.netPayableAmount || inv.invoiceAmount,
    party: inv.invoiceType === 'Client_Invoice' ? inv.clientName : inv.contractor?.name,
    company: companyNames.get(String(inv._id)) || null,
    subtitle: [inv.project?.parentProject?.name, inv.project?.name].filter(Boolean).join(' / ') || 'Subcontractor IPC',
    department: 'Project Management',
    path: `/general/project-management/${inv.project?._id}?tab=invoices`,
    ceoViewOnly: !isCeo,
    canAct: isCeo,
    raw: inv
  }));
}

/**
 * @param {object} user - req.user
 * @returns {Promise<{ items: object[], counts: object, isDesignatedCeo: boolean }>}
 */
async function buildExecutiveMyApprovals(user) {
  if (!user) {
    return {
      items: [],
      counts: {},
      isDesignatedCeo: false,
      canApproveAsCeo: false,
      isCeoSecretariatPs: false,
      canViewCeoForwardedQueue: false
    };
  }

  const ceoIds = await getCeoOfficeApproverIds(user).catch((e) => {
    console.error('[executiveMyApprovals] ceoIds', e.message);
    return [];
  });

  const [
    purchaseOrders,
    cashApprovals,
    settlements,
    onboarding,
    manualSalaries,
    indents,
    utilityBills,
    vendorBills,
    projectIpcs
  ] = await Promise.all([
    fetchPurchaseOrdersForUser(user).catch((e) => {
      console.error('[executiveMyApprovals] PO', e.message);
      return [];
    }),
    fetchCashApprovalsForUser(user).catch((e) => {
      console.error('[executiveMyApprovals] CA', e.message);
      return [];
    }),
    fetchSettlementsForUser(user).catch((e) => {
      console.error('[executiveMyApprovals] Settlement', e.message);
      return [];
    }),
    fetchOnboardingForUser(user).catch((e) => {
      console.error('[executiveMyApprovals] Onboarding', e.message);
      return [];
    }),
    fetchManualSalariesForUser(user).catch((e) => {
      console.error('[executiveMyApprovals] ManualSalary', e.message);
      return [];
    }),
    fetchIndentsForUser(user, ceoIds).catch((e) => {
      console.error('[executiveMyApprovals] Indent', e.message);
      return [];
    }),
    fetchUtilityBillsForUser(user, ceoIds).catch((e) => {
      console.error('[executiveMyApprovals] UtilityBill', e.message);
      return [];
    }),
    fetchVendorBillsForUser(user, ceoIds).catch((e) => {
      console.error('[executiveMyApprovals] VendorBill', e.message);
      return [];
    }),
    fetchProjectIpcsForUser(user).catch((e) => {
      console.error('[executiveMyApprovals] ProjectIpc', e.message);
      return [];
    })
  ]);

  const items = [
    ...purchaseOrders,
    ...cashApprovals,
    ...settlements,
    ...onboarding,
    ...manualSalaries,
    ...indents,
    ...utilityBills,
    ...vendorBills,
    ...projectIpcs
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const counts = {
    purchase_order: purchaseOrders.length,
    cash_approval: cashApprovals.length,
    payment_settlement: settlements.length,
    onboarding: onboarding.length,
    manual_salary: manualSalaries.length,
    indent: indents.length,
    utility_bill: utilityBills.length,
    vendor_bill: vendorBills.length,
    project_ipc: projectIpcs.length,
    total: items.length
  };

  return {
    items,
    counts,
    isDesignatedCeo: isDesignatedCeoApprover(user),
    canApproveAsCeo: isDesignatedCeoApprover(user),
    isCeoSecretariatPs: isCeoSecretariatPsRole(user),
    canViewCeoForwardedQueue: canViewCeoForwardedQueue(user)
  };
}

module.exports = {
  buildExecutiveMyApprovals,
  userPendingInChain,
  isAssignedByAuthorityText,
  resolveSequentialChainAction
};
