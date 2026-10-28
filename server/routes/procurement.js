const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authorize, authMiddleware } = require('../middleware/auth');
const { checkSubRoleAccess } = require('../config/permissions');
const dayjs = require('dayjs');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const Supplier = require('../models/hr/Supplier');
const FinanceHelper = require('../utils/financeHelper');
const AccountsPayable = require('../models/finance/AccountsPayable');
const Inventory = require('../models/procurement/Inventory');
const InventoryCategory = require('../models/procurement/InventoryCategory');
const GoodsReceive = require('../models/procurement/GoodsReceive');
const DeliveryChallan = require('../models/procurement/DeliveryChallan');
const { isFullAdvancePaymentTerm, requiresDeliveryChallanFlow, getGrnDcEligibility } = require('../utils/fullAdvancePoGate');
const GoodsIssue = require('../models/procurement/GoodsIssue');
const StockTransaction = require('../models/procurement/StockTransaction');
const StockQuant = require('../models/procurement/StockQuant');
const CostCenter = require('../models/procurement/CostCenter');
const Quotation = require('../models/procurement/Quotation');
const QuotationInvitation = require('../models/procurement/QuotationInvitation');
const Indent = require('../models/general/Indent');
const Project = require('../models/hr/Project');
const User = require('../models/User');
const { canMutateComparativeAuthorityUsers } = require('../utils/comparativeStatementAuthorityLock');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');
const { notifyApprovers } = require('../utils/approvalWhatsAppNotifier');
const { notifyChatApprovers } = require('../utils/approvalChatNotifier');
const {
  SR_MANAGER_PROCUREMENT_EFFECTIVE_AT,
  isSrManagerProcurementApplicable,
  sanitizeApprovalAuthorities,
  reconcileLegacySrManagerProcurement,
  getApprovedAuthorityKeys: getPoApprovedAuthorityKeys
} = require('../utils/purchaseOrderAuthority');

console.log('✅ Procurement routes loaded successfully');

const router = express.Router();

const PROCUREMENT_MODULE_KEY = 'procurement';
const PROCUREMENT_ASSIGNMENT_MANAGER_ROLE_NAMES = ['gm procurement', 'general manager procurement'];
const AUDIT_MODULE_KEY = 'audit';
const { isAuditDirectorUser, canActAsAuditDirector } = require('../utils/auditDirectorRole');
const { hasAuditAccess, canPerformInitialPreAuditActions } = require('../utils/auditAccess');

const normalizeRoleLabel = (value) => String(value || '').trim().toLowerCase();

const userHasRoleName = (user, acceptedRoleNames = []) => {
  const accepted = acceptedRoleNames.map(normalizeRoleLabel);
  if (!user || accepted.length === 0) return false;

  const directRole = normalizeRoleLabel(user.role);
  if (accepted.includes(directRole)) return true;

  const collectRoleNames = (roleDoc) => ([
    normalizeRoleLabel(roleDoc?.name),
    normalizeRoleLabel(roleDoc?.displayName)
  ].filter(Boolean));

  const roleRefNames = collectRoleNames(user.roleRef || {});
  if (roleRefNames.some((name) => accepted.includes(name))) return true;

  if (Array.isArray(user.roles)) {
    for (const roleDoc of user.roles) {
      const names = collectRoleNames(roleDoc);
      if (names.some((name) => accepted.includes(name))) return true;
    }
  }

  return false;
};

const hasProcurementModuleAccess = (roleDoc) => {
  if (!roleDoc?.isActive || !Array.isArray(roleDoc.permissions)) return false;
  return roleDoc.permissions.some((permission) => permission?.module === PROCUREMENT_MODULE_KEY);
};

const hasModuleAccess = (roleDoc, moduleKey) => {
  if (!roleDoc?.isActive || !Array.isArray(roleDoc.permissions)) return false;
  return roleDoc.permissions.some((permission) => permission?.module === moduleKey);
};

const hasProcurementAccess = (user) => {
  if (!user) return false;
  if (['super_admin', 'admin', 'developer', 'procurement_manager'].includes(user.role)) return true;

  if (hasProcurementModuleAccess(user.roleRef)) return true;
  if (Array.isArray(user.roles) && user.roles.some((roleDoc) => hasProcurementModuleAccess(roleDoc))) return true;
  if (userHasRoleName(user, PROCUREMENT_ASSIGNMENT_MANAGER_ROLE_NAMES)) return true;
  return false;
};

const hasFinanceAccess = (user) => {
  if (!user) return false;
  if (['super_admin', 'admin', 'finance_manager'].includes(user.role)) return true;
  if (hasModuleAccess(user.roleRef, 'finance')) return true;
  if (Array.isArray(user.roles) && user.roles.some((roleDoc) => hasModuleAccess(roleDoc, 'finance'))) return true;
  return false;
};

const {
  hasCeoSecretariatAccess,
  hasCeoSecretariatCoordinatorAccess,
  isDesignatedCeoApprover
} = require('../utils/executiveAccess');

/** Quick vendor create from Centralized Store / General bills — not only procurement roles. */
const canQuickCreateVendor = async (user) => {
  if (!user) return false;
  const role = normalizeRoleLabel(user.role);
  if (
    [
      'super_admin',
      'admin',
      'developer',
      'higher_management',
      'procurement_manager',
      'finance_manager',
      'hr_manager'
    ].includes(role)
  ) {
    return true;
  }
  if (hasProcurementAccess(user) || hasFinanceAccess(user)) return true;
  if (hasModuleAccess(user.roleRef, 'hr')) return true;
  if (Array.isArray(user.roles) && user.roles.some((roleDoc) => hasModuleAccess(roleDoc, 'hr'))) {
    return true;
  }

  const uid = user._id || user.id;
  if (!uid) return false;
  if (await checkSubRoleAccess(uid, 'general', 'centralized_store', 'create')) return true;
  if (await checkSubRoleAccess(uid, 'general', 'centralized_store', 'update')) return true;
  // General Indent holders also create centralized store bills under General module
  if (await checkSubRoleAccess(uid, 'general', 'indents', 'create')) return true;
  return false;
};

const requireVendorQuickCreateAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (await canQuickCreateVendor(req.user)) return next();
    return res.status(403).json({
      success: false,
      message: 'Access denied. Insufficient permissions.'
    });
  } catch (err) {
    console.error('requireVendorQuickCreateAccess error:', err);
    return res.status(500).json({ success: false, message: 'Error checking permissions' });
  }
};

const isAssignedComparativeAuthorityUser = async (indentId, userId) => {
  if (!indentId || !userId) return false;
  const indent = await Indent.findById(indentId)
    .select('comparativeStatementApprovals comparativeApproval')
    .lean();
  if (!indent) return false;
  const uid = String(userId);
  const csa = indent.comparativeStatementApprovals || {};
  const candidateIds = [
    csa.preparedByUser,
    csa.verifiedByUser,
    csa.authorisedRepUser,
    csa.financeRepUser,
    csa.managerProcurementUser
  ]
    .map((id) => String(id || ''))
    .filter(Boolean);

  if (candidateIds.includes(uid)) return true;

  const steps = Array.isArray(indent?.comparativeApproval?.approvers) ? indent.comparativeApproval.approvers : [];
  return steps.some((s) => {
    const approverId = s?.approver?._id || s?.approver;
    return String(approverId || '') === uid;
  });
};

const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pickFirstNonEmptyString = (...values) => {
  for (const value of values) {
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
};
const normalizeQuotationSupplementaryFields = (payload = {}) => ({
  deliveryPlace: pickFirstNonEmptyString(
    payload.deliveryPlace,
    payload.delivery_location,
    payload.delivery_place,
    payload.deliveryplace,
    payload.deliveryLocation,
    payload.deliveryAddress,
    payload.placeOfDelivery,
    payload.delivery,
    payload.terms?.deliveryPlace,
    payload.terms?.delivery_location,
    payload.terms?.delivery_place,
    payload.terms?.deliveryAddress,
    payload.terms?.placeOfDelivery,
    payload.quotationTerms?.delivery_location,
    payload.quotationTerms?.deliveryPlace
  ),
  freightCarriage: pickFirstNonEmptyString(
    payload.freightCarriage,
    payload.freight_carriage,
    payload.freight_and_carriage,
    payload.freightAndCarriage,
    payload.carriage,
    payload.carriageCharges,
    payload.terms?.freightCarriage,
    payload.terms?.freight_carriage,
    payload.terms?.freight_and_carriage,
    payload.terms?.freightAndCarriage,
    payload.terms?.carriage,
    payload.terms?.carriageCharges,
    payload.quotationTerms?.freightCarriage,
    payload.quotationTerms?.freight_carriage,
    payload.quotationTerms?.freightAndCarriage,
    payload.quotationTerms?.carriage
  ),
  installation: pickFirstNonEmptyString(
    payload.installation,
    payload.installationDetails,
    payload.installationCharges,
    payload.installation_charge,
    payload.terms?.installation,
    payload.terms?.installationDetails,
    payload.terms?.installationCharges,
    payload.terms?.installation_charge,
    payload.quotationTerms?.installationDetails,
    payload.quotationTerms?.installationCharges,
    payload.quotationTerms?.installation
  ),
  freight: pickFirstNonEmptyString(
    payload.freight,
    payload.freightCharges,
    payload.shippingCharges,
    payload.terms?.freight,
    payload.terms?.freightCharges,
    payload.terms?.shippingCharges,
    payload.quotationTerms?.freightCharges,
    payload.quotationTerms?.freight
  )
});
const hasAnyOwnProperty = (obj, keys = []) => keys.some((key) => Object.prototype.hasOwnProperty.call(obj || {}, key));
const quotationSupplementaryAliases = {
  deliveryPlace: [
    'deliveryPlace', 'delivery_location', 'delivery_place', 'deliveryplace', 'deliveryLocation',
    'deliveryAddress', 'placeOfDelivery', 'delivery'
  ],
  freightCarriage: [
    'freightCarriage', 'freight_carriage', 'freight_and_carriage', 'freightAndCarriage',
    'carriage', 'carriageCharges'
  ],
  installation: ['installation', 'installationDetails', 'installationCharges', 'installation_charge'],
  freight: ['freight', 'freightCharges', 'shippingCharges']
};
const shouldNormalizeQuotationSupplementaryFields = (payload = {}) => {
  const root = payload || {};
  const terms = root.terms || {};
  const quotationTerms = root.quotationTerms || {};
  const aliases = Object.values(quotationSupplementaryAliases).flat();

  return hasAnyOwnProperty(root, aliases)
    || hasAnyOwnProperty(terms, aliases)
    || hasAnyOwnProperty(quotationTerms, aliases);
};
const tokenMatchesAuthorityText = (token, authorityText) => {
  const normalizedToken = normalizeToken(token);
  const normalizedAuthorityText = normalizeToken(authorityText);
  if (!normalizedToken || !normalizedAuthorityText) return false;
  return normalizedAuthorityText === normalizedToken
    || normalizedAuthorityText.includes(normalizedToken)
    || normalizedToken.includes(normalizedAuthorityText);
};
const buildAuthorityTextConditions = (tokens = []) => {
  const safeTokens = [...new Set((tokens || []).map(normalizeToken).filter(Boolean))];
  if (!safeTokens.length) return [];
  return AUTHORITY_SLOT_CONFIG.flatMap((slot) => safeTokens.map((token) => {
    const cond = {
      [`approvalAuthorities.${slot.key}`]: { $regex: new RegExp(escapeRegex(token), 'i') }
    };
    // Legacy POs (pre Sr Manager slot) must not match on a backfilled Sr Manager name.
    if (slot.key === 'srManagerProcurement') {
      return { ...cond, createdAt: { $gte: SR_MANAGER_PROCUREMENT_EFFECTIVE_AT } };
    }
    return cond;
  }));
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
const getUserIdentityTokens = (user) => {
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
  const tokens = getUserIdentityTokens(user);
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
  const tokens = getUserIdentityTokens(user);
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
      { 'comparativeApproval.approvers.approver': uid },
      { requestedBy: uid },
      { 'approvalChain.approver': uid },
      { 'procurementAssignment.assignedTo': uid }
    ]
  }).select('_id').lean();
  return indents.map((i) => i._id);
};

/**
 * Full PO list visibility (same as higher management / CEO / director / president):
 * - leadership roles
 * - procurement module users
 * - store (centralized store) users
 * Others only see POs they created, are assigned on, or already acted on.
 */
const canViewAllPurchaseOrders = async (user) => {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase().trim();
  const privilegedRoles = new Set([
    'super_admin',
    'admin',
    'developer',
    'higher_management',
    'ceo',
    'hr_manager',
    'director',
    'president',
    'chairman',
    'commercial_director',
    'audit_director',
    'audit_manager',
    'auditor',
    'finance_manager',
    'procurement_manager'
  ]);
  if (privilegedRoles.has(role)) return true;
  if (role === 'audit director') return true;
  if (role.includes('director') || role.includes('president') || role.includes('chairman')) {
    return true;
  }
  if (role.includes('procurement') || role.includes('store')) return true;

  const titleBlob = [
    user.position,
    user.designation,
    user.jobTitle,
    user.title,
    user.employeeCategory
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\b(director|president|chairman|ceo|avp)\b/.test(titleBlob)) return true;

  // Procurement module access → see all POs
  if (hasProcurementAccess(user)) return true;
  if (hasFinanceAccess(user)) return true;

  // Store / centralized-store submodule → see all POs
  const uid = user._id || user.id;
  if (uid) {
    if (await checkSubRoleAccess(uid, 'general', 'centralized_store', 'read')) return true;
    if (await checkSubRoleAccess(uid, 'general', 'centralized_store', 'create')) return true;
    if (await checkSubRoleAccess(uid, 'general', 'centralized_store', 'update')) return true;
    if (await checkSubRoleAccess(uid, 'procurement', 'store', 'read')) return true;
    if (await checkSubRoleAccess(uid, 'procurement', 'purchase_orders', 'read')) return true;
  }

  const dept = String(user.department?.name || user.department || '').toLowerCase();
  if (dept.includes('store') || dept.includes('procurement')) return true;

  return false;
};

const mergePurchaseOrderQueryAnd = (query, condition) => {
  if (!condition || !Object.keys(condition).length) return query;
  if (query.$and) {
    query.$and.push(condition);
  } else if (query.$or) {
    query.$and = [{ $or: query.$or }, condition];
    delete query.$or;
  } else {
    Object.assign(query, condition);
  }
  return query;
};

/** Build $or conditions for POs this user is allowed to see (assigned / created / already acted). */
const buildPurchaseOrderPrivacyOr = async (user) => {
  const uid = user?._id || user?.id;
  if (!uid) return [];
  const indentIds = await getAssignedIndentIdsForUser(uid);
  const tokens = getUserIdentityTokens(user);
  const authorityTextConditions = buildAuthorityTextConditions(tokens);
  return [
    { createdBy: uid },
    { approvedBy: uid },
    { 'authorityApprovals.approver': uid },
    { auditApprovedBy: uid },
    { preAuditInitialApprovedBy: uid },
    { auditReturnedBy: uid },
    { auditRejectedBy: uid },
    { ceoForwardedBy: uid },
    { ceoApprovedBy: uid },
    { ceoRejectedBy: uid },
    { ceoReturnedBy: uid },
    { financeApprovedBy: uid },
    { financeReturnedBy: uid },
    { receivedBy: uid },
    { qaCheckedBy: uid },
    { 'workflowHistory.changedBy': uid },
    ...(indentIds.length ? [{ indent: { $in: indentIds } }] : []),
    ...authorityTextConditions
  ];
};

const applyPurchaseOrderPrivacyFilter = async (query, user) => {
  if (await canViewAllPurchaseOrders(user)) return { query, empty: false };
  const privacyOr = await buildPurchaseOrderPrivacyOr(user);
  if (!privacyOr.length) return { query, empty: true };
  mergePurchaseOrderQueryAnd(query, { $or: privacyOr });
  return { query, empty: false };
};

const userIsInvolvedInPurchaseOrder = async (user, purchaseOrder) => {
  if (!user || !purchaseOrder) return false;
  const uid = String(user._id || user.id || '');
  if (!uid) return false;
  const same = (ref) => {
    if (!ref) return false;
    return String(ref._id || ref) === uid;
  };
  if (same(purchaseOrder.createdBy)) return true;
  if (same(purchaseOrder.approvedBy)) return true;
  if (same(purchaseOrder.auditApprovedBy)) return true;
  if (same(purchaseOrder.preAuditInitialApprovedBy)) return true;
  if (same(purchaseOrder.auditReturnedBy)) return true;
  if (same(purchaseOrder.auditRejectedBy)) return true;
  if (same(purchaseOrder.ceoForwardedBy)) return true;
  if (same(purchaseOrder.ceoApprovedBy)) return true;
  if (same(purchaseOrder.ceoRejectedBy)) return true;
  if (same(purchaseOrder.ceoReturnedBy)) return true;
  if (same(purchaseOrder.financeApprovedBy)) return true;
  if (same(purchaseOrder.financeReturnedBy)) return true;
  if (same(purchaseOrder.receivedBy)) return true;
  if (same(purchaseOrder.qaCheckedBy)) return true;
  if (Array.isArray(purchaseOrder.authorityApprovals)
    && purchaseOrder.authorityApprovals.some((a) => same(a.approver))) {
    return true;
  }
  if (Array.isArray(purchaseOrder.workflowHistory)
    && purchaseOrder.workflowHistory.some((h) => same(h.changedBy))) {
    return true;
  }
  if (isAssignedByAuthorityText(purchaseOrder.approvalAuthorities, user, purchaseOrder.createdAt)) return true;
  const indentRef = purchaseOrder.indent?._id || purchaseOrder.indent;
  if (await isAssignedComparativeAuthorityUser(indentRef, uid)) return true;
  // Indent requester / chain / procurement assignee
  if (indentRef) {
    const indent = await Indent.findById(indentRef)
      .select('requestedBy approvalChain procurementAssignment')
      .lean();
    if (indent) {
      if (same(indent.requestedBy)) return true;
      if (same(indent.procurementAssignment?.assignedTo)) return true;
      if (Array.isArray(indent.approvalChain)
        && indent.approvalChain.some((s) => same(s.approver))) {
        return true;
      }
    }
  }
  return false;
};

const canManageProcurementAssignments = (user) => {
  if (!user) return false;
  if (['super_admin', 'admin', 'developer', 'procurement_manager'].includes(user.role)) return true;
  if (userHasRoleName(user, PROCUREMENT_ASSIGNMENT_MANAGER_ROLE_NAMES)) return true;
  if (user.canAssignProcurementTasks === true) return true;

  const canManageByPermission = (roleDoc) => {
    if (!roleDoc?.isActive || !Array.isArray(roleDoc.permissions)) return false;
    const procurementPermission = roleDoc.permissions.find((permission) => permission?.module === PROCUREMENT_MODULE_KEY);
    if (!procurementPermission) return false;
    const moduleActions = Array.isArray(procurementPermission.actions) ? procurementPermission.actions : [];
    return moduleActions.includes('manage') || moduleActions.includes('update');
  };

  if (canManageByPermission(user.roleRef)) return true;
  if (Array.isArray(user.roles) && user.roles.some((roleDoc) => canManageByPermission(roleDoc))) return true;
  return false;
};

const canConfigureProcurementAssignmentManagers = (user) => {
  if (!user) return false;
  if (['super_admin', 'admin', 'developer'].includes(user.role)) return true;
  if (userHasRoleName(user, PROCUREMENT_ASSIGNMENT_MANAGER_ROLE_NAMES)) return true;
  return false;
};

const normalizeIds = (ids = []) => [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];

const getUserIdsByRoles = async (roles = []) => {
  const users = await User.find({
    isActive: true,
    role: { $in: roles }
  }).select('_id');
  return users.map((u) => String(u._id));
};

const getUserIdsByDepartment = async (departmentName) => {
  if (!departmentName) return [];
  const users = await User.find({
    isActive: true,
    department: { $regex: `^${String(departmentName)}$`, $options: 'i' }
  }).select('_id');
  return users.map((u) => String(u._id));
};

const getStoreWorkflowRecipients = async () => {
  const byStoreDept = await getUserIdsByDepartment('store');
  const byProcurementDept = await getUserIdsByDepartment('procurement');
  const byStoreRoles = await getUserIdsByRoles(['procurement_manager', 'admin', 'super_admin']);
  return [...new Set([...byStoreDept, ...byProcurementDept, ...byStoreRoles])];
};

const getAuditWorkflowRecipients = async () => {
  const byAuditDept = await getUserIdsByDepartment('audit');
  const byAuditRoles = await getUserIdsByRoles(['audit_manager', 'auditor', 'audit_director', 'admin', 'super_admin']);
  return [...new Set([...byAuditDept, ...byAuditRoles])];
};

const getCeoSecretariatRecipients = async () => {
  const byHrRoles = await getUserIdsByRoles(['hr_manager', 'admin', 'super_admin']);
  const byHrDept = await getUserIdsByDepartment('hr');
  return [...new Set([...byHrRoles, ...byHrDept])];
};

const getCeoRecipients = async () => {
  const byRole = await getUserIdsByRoles(['higher_management', 'admin', 'super_admin']);
  return [...new Set(byRole)];
};

const getFinanceWorkflowRecipients = async () => {
  const byFinanceDept = await getUserIdsByDepartment('finance');
  const byFinanceRoles = await getUserIdsByRoles(['finance_manager', 'admin', 'super_admin']);
  return [...new Set([...byFinanceDept, ...byFinanceRoles])];
};

const getProcurementWorkflowRecipients = async () => {
  const byProcurementDept = await getUserIdsByDepartment('procurement');
  const byProcurementRoles = await getUserIdsByRoles(['procurement_manager', 'admin', 'super_admin']);
  return [...new Set([...byProcurementDept, ...byProcurementRoles])];
};

const notifyDocumentRecipients = async ({
  recipientIds = [],
  actorId = null,
  title,
  message,
  actionUrl,
  entityId,
  entityType = 'Document',
  module = 'procurement',
  metadata = {}
}) => {
  const ids = normalizeIds(recipientIds).filter((id) => id !== String(actorId || ''));
  if (ids.length === 0) return;

  await createAndEmitNotification({
    recipientIds: ids,
    title,
    message,
    type: 'info',
    category: 'approval',
    priority: 'high',
    actionUrl,
    createdBy: actorId,
    excludeUserId: actorId,
    metadata: {
      module,
      entityId,
      entityType,
      ...metadata
    }
  });
};

const STORE_SUBMODULE_ROUTES = {
  dashboard: '/procurement/store',
  deliveryChallans: '/procurement/store/delivery-challans',
  goodsReceive: '/procurement/store/goods-receive',
  inventory: '/procurement/store/inventory'
};

const notifyStoreUsers = async ({
  actorId = null,
  title,
  message,
  actionUrl = STORE_SUBMODULE_ROUTES.dashboard,
  entityId,
  entityType = 'PurchaseOrder'
}) => {
  const storeRecipients = await getStoreWorkflowRecipients();
  await notifyDocumentRecipients({
    recipientIds: storeRecipients,
    actorId,
    title,
    message,
    actionUrl,
    entityId,
    entityType,
    module: 'procurement'
  });
};

/** Mongo id for procurement assignee (works whether assignedTo is populated or raw ObjectId). */
const procurementAssigneeId = (indent) => {
  if (!indent?.procurementAssignment?.assignedTo) return null;
  const raw = indent.procurementAssignment.assignedTo;
  try {
    return (raw._id || raw).toString();
  } catch {
    return null;
  }
};

/** Assignment manager OR the user this requisition is assigned to may operate it in procurement workflows. */
const canOperateAssignedProcurementRequisition = (user, indent) => {
  if (!user?.id || !indent) return false;
  if (['super_admin', 'developer'].includes(user.role)) return true;
  if (canManageProcurementAssignments(user)) return true;
  const aid = procurementAssigneeId(indent);
  return Boolean(aid && aid === String(user.id));
};

/** Pre-Audit / audit roles: read quotations for any requisition they need to review */
const isAuditReadRole = (user) => {
  if (!user) return false;
  const n = String(user.role || '').toLowerCase().replace(/\s+/g, '_');
  return n === 'audit_manager' || n === 'auditor' || n === 'audit_director' || user.role === 'Audit Director';
};

/** Read-only access to quotations by indent (GET) for exec / audit / procurement / authority approvers */
const canViewQuotationsByIndentRead = (user, indent) => {
  const uid = user?._id || user?.id;
  if (!uid || !indent) return false;
  if (['super_admin', 'admin', 'developer', 'procurement_manager', 'finance_manager', 'hr_manager'].includes(user.role)) return true;
  if (hasProcurementAccess(user)) return true;
  if (canOperateAssignedProcurementRequisition(user, indent)) return true;
  if (isAuditReadRole(user)) return true;
  if (hasFinanceAccess(user)) return true;
  if (user.role === 'higher_management') return true;
  if (hasCeoSecretariatAccess(user)) return true;
  const uidStr = String(uid);
  const approverSteps = Array.isArray(indent?.comparativeApproval?.approvers) ? indent.comparativeApproval.approvers : [];
  const isComparativeApprover = approverSteps.some((step) => {
    const approverId = step?.approver?._id || step?.approver;
    return String(approverId || '') === uidStr;
  });
  if (isComparativeApprover) return true;
  const csa = indent?.comparativeStatementApprovals || {};
  const csaUsers = [csa.preparedByUser, csa.verifiedByUser, csa.authorisedRepUser, csa.financeRepUser, csa.managerProcurementUser]
    .map((u) => (u?._id || u)?.toString())
    .filter(Boolean);
  if (csaUsers.includes(uidStr)) return true;
  return false;
};

/** Shared indent populate for PO detail / CEO queue so supporting docs render */
const purchaseOrderIndentPopulate = {
  path: 'indent',
  select:
    'indentNumber title erpRef requestedDate requiredDate department requestedBy items notes companyId comparativeStatementApprovals comparativeApproval comparativeApprovals splitPOAssignments approvalChain justification signatures attachments storeRoutingStatus movedToProcurementReason movedToProcurementAt movedToProcurementBy',
  populate: [
    { path: 'department', select: 'name code' },
    { path: 'companyId', select: 'name code symbol' },
    { path: 'requestedBy', select: 'firstName lastName email digitalSignature' },
    { path: 'movedToProcurementBy', select: 'firstName lastName email' },
    { path: 'approvalChain.approver', select: 'firstName lastName email digitalSignature' },
    { path: 'comparativeApproval.approvers.approver', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeApproval.submittedBy', select: 'firstName lastName email' },
    { path: 'comparativeApproval.rejectedBy', select: 'firstName lastName email' },
    { path: 'comparativeApprovals.approvers.approver', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.preparedByUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.verifiedByUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.authorisedRepUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.financeRepUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.managerProcurementUser', select: 'firstName lastName email employeeId digitalSignature' }
  ]
};

const userCanViewPurchaseOrder = async (user, purchaseOrder) => {
  if (!user || !purchaseOrder) return false;
  if (await canViewAllPurchaseOrders(user)) return true;
  return userIsInvolvedInPurchaseOrder(user, purchaseOrder);
};

/** Match quotations for a comparative lot (legacy quotes without lotNumber count as lot A). */
const quotationLotFilter = (lotNumber = 'A') => {
  const lot = lotNumber || 'A';
  if (lot === 'A') {
    return { $or: [{ lotNumber: 'A' }, { lotNumber: null }, { lotNumber: { $exists: false } }] };
  }
  return { lotNumber: lot };
};

const ensureComparativeApprovalObject = (indent, lotNumber = 'A') => {
  if (!Array.isArray(indent.comparativeApprovals)) {
    indent.comparativeApprovals = [];
  }
  let caIndex = indent.comparativeApprovals.findIndex(a => a.lotNumber === lotNumber);
  if (caIndex === -1) {
    indent.comparativeApprovals.push({
      lotNumber,
      status: 'not_configured',
      approvers: [],
      submittedBy: null,
      submittedAt: null,
      lastResubmittedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionObservation: '',
      rejectionObservations: []
    });
    caIndex = indent.comparativeApprovals.length - 1;
  }
  const ca = indent.comparativeApprovals[caIndex];
  if (!Array.isArray(ca.approvers)) ca.approvers = [];
  if (!Array.isArray(ca.rejectionObservations)) ca.rejectionObservations = [];
  indent.comparativeApproval = ca;
  return ca;
};

/** Stable user id string for comparative approver steps (handles ObjectId, populated User, lean {_id}). */
const comparativeApproverStepUserIdString = (step) => {
  if (!step || step.approver == null) return '';
  const a = step.approver;
  if (typeof a === 'object' && (a._id != null || a.id != null)) return String(a._id || a.id);
  return String(a);
};

/** Normalize approver ref to ObjectId for mongoose subdocs when rebuilding arrays. */
const toApproverObjectId = (ref) => {
  if (ref == null) return ref;
  if (ref instanceof mongoose.Types.ObjectId) return ref;
  if (typeof ref === 'object' && (ref._id != null || ref.id != null)) {
    const s = String(ref._id || ref.id);
    return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : ref;
  }
  const s = String(ref);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : ref;
};

const comparativeApprovalIsFullyApproved = (indent) => {
  const ca = indent?.comparativeApproval;
  return !!(
    ca &&
    ca.status === 'approved' &&
    Array.isArray(ca.approvers) &&
    ca.approvers.length > 0 &&
    ca.approvers.every((s) => s.status === 'approved')
  );
};

const pushIndentWorkflowHistory = (indent, {
  fromStatus = '',
  toStatus = '',
  changedBy = null,
  comments = '',
  module = 'Procurement'
} = {}) => {
  if (!indent) return;
  if (!Array.isArray(indent.workflowHistory)) indent.workflowHistory = [];
  indent.workflowHistory.push({
    fromStatus,
    toStatus,
    changedBy,
    changedAt: new Date(),
    comments,
    module
  });
};

// Convert blank string ObjectId-like fields from forms into undefined
// so Mongoose does not try to cast "" to ObjectId.
function normalizeInventoryObjectIdFields(payload = {}) {
  const cleaned = { ...payload };
  const objectIdLikeFields = [
    'supplier',
    'inventoryCategory',
    'inventoryAccount',
    'grniAccount',
    'cogsAccount',
    'salesAccount',
    'purchaseAccount',
    'store',
    'subStore',
    'project',
    'companyId'
  ];
  for (const field of objectIdLikeFields) {
    if (cleaned[field] === '') cleaned[field] = undefined;
  }
  return cleaned;
}

/** Match a GRN line to a PO line: description → product code → same row index (simple, predictable). */
function matchPurchaseOrderLineIndex(poItems, grnLine, grnIndex) {
  if (!poItems?.length) return -1;
  const norm = (s) => (s == null ? '' : String(s).trim().toLowerCase().replace(/\s+/g, ' '));
  const name = norm(grnLine.itemName);
  const code = norm(grnLine.itemCode);
  for (let j = 0; j < poItems.length; j++) {
    if (name && norm(poItems[j].description) === name) return j;
  }
  for (let j = 0; j < poItems.length; j++) {
    const pc = poItems[j].productCode;
    if (pc && code && norm(pc) === code) return j;
  }
  if (grnIndex < poItems.length) return grnIndex;
  return -1;
}

/** Open qty still committed on QA-pending / QA-passed DCs (not yet received on GRN). */
async function getOpenDcQuantitiesByPoLine(poId) {
  const oid = mongoose.Types.ObjectId.isValid(String(poId))
    ? new mongoose.Types.ObjectId(String(poId))
    : poId;
  const rows = await DeliveryChallan.find({
    purchaseOrder: oid,
    status: { $in: ['qa_pending', 'qa_passed'] }
  })
    .select('items')
    .lean();
  const map = {};
  for (const dc of rows) {
    for (const it of dc.items || []) {
      const j = Number(it.poLineIndex);
      if (Number.isNaN(j) || j < 0) continue;
      const open = Math.round(((Number(it.quantity) || 0) - (Number(it.quantityReceived) || 0)) * 100) / 100;
      if (open <= 0) continue;
      map[j] = (map[j] || 0) + open;
    }
  }
  return map;
}

/** Distribute GRN quantities across DC item rows (FIFO) and mark closed when fully received. */
function applyGrnQuantitiesToDeliveryChallan(dcDoc, qtyByPoLineIndex) {
  for (const jStr of Object.keys(qtyByPoLineIndex)) {
    const poLineIndex = Number(jStr);
    let rem = Math.round((Number(qtyByPoLineIndex[jStr]) || 0) * 100) / 100;
    if (rem <= 0 || Number.isNaN(poLineIndex)) continue;
    const lineItems = (dcDoc.items || []).filter((it) => Number(it.poLineIndex) === poLineIndex);
    for (const it of lineItems) {
      if (rem <= 0) break;
      const cap = Math.round(((Number(it.quantity) || 0) - (Number(it.quantityReceived) || 0)) * 100) / 100;
      if (cap <= 0) continue;
      const add = Math.min(rem, cap);
      it.quantityReceived = Math.round(((Number(it.quantityReceived) || 0) + add) * 100) / 100;
      rem = Math.round((rem - add) * 100) / 100;
    }
  }
  const allDone = (dcDoc.items || []).every(
    (it) => (Number(it.quantityReceived) || 0) + 0.0001 >= (Number(it.quantity) || 0)
  );
  dcDoc.status = allDone ? 'closed' : 'qa_passed';
}

/** PO may receive new DC lines in normal store flow, or "Received" only when lines still show open qty (data recovery). */
function purchaseOrderOpenForDeliveryChallan(poDoc) {
  const openStatuses = ['Sent to Store', 'GRN Created', 'Partially Received', 'Approved', 'Ordered'];
  if (openStatuses.includes(poDoc.status)) return { ok: true };
  const hasLineRemaining = (poDoc.items || []).some((it) => {
    const ordered = Number(it.quantity) || 0;
    const received = Number(it.receivedQuantity) || 0;
    return ordered - received > 0.0001;
  });
  if (poDoc.status === 'Received' && hasLineRemaining) return { ok: true, recovered: true };
  return {
    ok: false,
    message:
      poDoc.status === 'Received'
        ? 'This PO is fully received on all lines. Delivery challans should be created before receipt is complete. If receipts were entered incorrectly, correct PO line received quantities first.'
        : `PO status "${poDoc.status}" does not allow new delivery challans.`
  };
}

// Multer for GRN attachments
const grnAttachmentsDir = path.join(__dirname, '../uploads/grn-attachments');
const grnAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(grnAttachmentsDir)) {
      fs.mkdirSync(grnAttachmentsDir, { recursive: true });
    }
    cb(null, grnAttachmentsDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'grn-' + unique + path.extname(file.originalname));
  }
});
const uploadGrnAttachment = multer({
  storage: grnAttachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|gif|webp)$/i.test(file.originalname) ||
      file.mimetype.startsWith('image/') ||
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/msword' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (allowed) cb(null, true);
    else cb(new Error('Invalid file type. Use PDF, image, or Office document.'), false);
  }
});
const handleGrnUpload = (req, res, next) => {
  uploadGrnAttachment.array('attachments', 10)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Each attachment must be 10 MB or less' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, message: 'Maximum 10 attachments allowed' });
    }
    return res.status(400).json({ success: false, message: err.message || 'File upload error' });
  });
};
const parseGrnRequestBody = (req, res, next) => {
  if (req.body?.data) {
    try {
      const parsed = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
      // Parsed JSON wins over raw multipart string fields
      req.body = { ...req.body, ...parsed };
      delete req.body.data;
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid GRN data JSON format' });
    }
  }
  // Multipart often sends nested JSON fields as strings
  if (typeof req.body.items === 'string') {
    try {
      req.body.items = JSON.parse(req.body.items);
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid items JSON format' });
    }
  }
  next();
};
const mapUploadedGrnAttachments = (files = []) => (files || []).map((file) => ({
  filename: file.originalname,
  path: `/uploads/grn-attachments/${file.filename}`,
  uploadedAt: new Date()
}));

// Multer for quotation attachments
const quotationAttachmentsDir = path.join(__dirname, '../uploads/quotation-attachments');
const quotationAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(quotationAttachmentsDir)) {
      fs.mkdirSync(quotationAttachmentsDir, { recursive: true });
    }
    cb(null, quotationAttachmentsDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'quotation-' + unique + path.extname(file.originalname));
  }
});
const uploadQuotationAttachment = multer({
  storage: quotationAttachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|gif)$/i.test(file.originalname) ||
      file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/msword' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/vnd.ms-excel' || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (allowed) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  }
});

// Multer memory storage for requisition send-email attachment (no disk write)
const requisitionEmailAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|gif)$/i.test(file.originalname) ||
      file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/msword' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/vnd.ms-excel' || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (allowed) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  }
});

// ==================== PURCHASE ORDERS ROUTES ====================

// @route   GET /api/procurement/purchase-orders
// @desc    Get all purchase orders with pagination and filters
// @access  Private (Procurement and Admin)
router.get('/purchase-orders', 
  authMiddleware,
  asyncHandler(async (req, res) => {
    console.log('📦 GET /purchase-orders - User:', req.user?.role);
    
    const { 
      page = 1, 
      limit = 10, 
      status, 
      priority,
      vendor,
      search,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    const privacy = await applyPurchaseOrderPrivacyFilter(query, req.user);
    if (privacy.empty) {
      return res.json({
        success: true,
        data: {
          purchaseOrders: [],
          pagination: {
            currentPage: parseInt(page),
            totalPages: 0,
            totalItems: 0,
            itemsPerPage: parseInt(limit)
          }
        }
      });
    }

    // Apply filters
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (vendor) query.vendor = vendor;

    // Date range filter
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }

    // Search functionality (must not overwrite privacy $or)
    if (search) {
      mergePurchaseOrderQueryAnd(query, {
        $or: [
          { orderNumber: { $regex: search, $options: 'i' } },
          { notes: { $regex: search, $options: 'i' } },
          { 'items.description': { $regex: search, $options: 'i' } }
        ]
      });
    }

    console.log('Query filters:', query);

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    try {
      const purchaseOrders = await PurchaseOrder.find(query)
        .populate('vendor', 'name email phone contactPerson ntnCnic ntnNo cnic address payeeName')
        .populate('companyId', 'name code symbol')
        .populate({
          path: 'indent',
          select: 'comparativeStatementApprovals comparativeApproval companyId',
          populate: [
            { path: 'companyId', select: 'name code symbol' },
            { path: 'comparativeStatementApprovals.preparedByUser', select: 'firstName lastName email' },
            { path: 'comparativeStatementApprovals.verifiedByUser', select: 'firstName lastName email' },
            { path: 'comparativeStatementApprovals.authorisedRepUser', select: 'firstName lastName email' },
            { path: 'comparativeStatementApprovals.financeRepUser', select: 'firstName lastName email' },
            { path: 'comparativeStatementApprovals.managerProcurementUser', select: 'firstName lastName email' },
            { path: 'comparativeApproval.approvers.approver', select: 'firstName lastName email' }
          ]
        })
        .populate('createdBy', 'firstName lastName email')
        .populate('approvedBy', 'firstName lastName')
        .populate('costCenter', 'code name department')
        .populate('revisedFrom', 'orderNumber replacementJustification')
        .populate('supersededBy', 'orderNumber')
        .sort(sortOptions)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .exec();

      const total = await PurchaseOrder.countDocuments(query);

      console.log(`Found ${purchaseOrders.length} purchase orders out of ${total} total`);

      res.json({
        success: true,
        data: {
          purchaseOrders,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: parseInt(limit)
          }
        }
      });
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
      throw error;
    }
  })
);

// @route   GET /api/procurement/purchase-orders/statistics
// @desc    Get purchase orders statistics
// @access  Private (Procurement and Admin)
router.get('/purchase-orders/statistics', 
  authMiddleware,
  asyncHandler(async (req, res) => {
    console.log('📊 GET /purchase-orders/statistics - User:', req.user?.role);
    
    try {
      const privacy = await applyPurchaseOrderPrivacyFilter({}, req.user);
      if (privacy.empty) {
        return res.json({
          success: true,
          data: {
            totalOrders: 0,
            totalValue: 0,
            byStatus: [],
            recentOrders: []
          }
        });
      }
      const statsQuery = privacy.query;
      if (await canViewAllPurchaseOrders(req.user)) {
        const stats = await PurchaseOrder.getStatistics();
        const recentOrders = await PurchaseOrder.find()
          .populate('vendor', 'name')
          .sort({ createdAt: -1 })
          .limit(5)
          .select('orderNumber vendor status totalAmount orderDate');
        return res.json({
          success: true,
          data: {
            ...stats,
            recentOrders
          }
        });
      }

      const [totalOrders, valueAgg, byStatus, recentOrders] = await Promise.all([
        PurchaseOrder.countDocuments(statsQuery),
        PurchaseOrder.aggregate([
          { $match: statsQuery },
          { $group: { _id: null, totalValue: { $sum: '$totalAmount' } } }
        ]),
        PurchaseOrder.aggregate([
          { $match: statsQuery },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        PurchaseOrder.find(statsQuery)
          .populate('vendor', 'name')
          .sort({ createdAt: -1 })
          .limit(5)
          .select('orderNumber vendor status totalAmount orderDate')
      ]);

      console.log('Statistics loaded successfully (privacy-scoped)');

      res.json({
        success: true,
        data: {
          totalOrders,
          totalValue: valueAgg[0]?.totalValue || 0,
          byStatus,
          recentOrders
        }
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
      // Return empty stats instead of erroring
      res.json({
        success: true,
        data: {
          totalOrders: 0,
          totalValue: 0,
          byStatus: [],
          recentOrders: []
        }
      });
    }
  })
);

// @route   GET /api/procurement/purchase-orders/ceo-secretariat
// @desc    Get POs for CEO Secretariat / CEO (status: Send to CEO Office, Forwarded to CEO, Returned from CEO Office)
// @access  Private (Super Admin, Admin, HR Manager, Higher Management)
router.get('/purchase-orders/ceo-secretariat',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const isCoordinator = hasCeoSecretariatCoordinatorAccess(req.user);
    const isCeo = isDesignatedCeoApprover(req.user);
    const statuses = [];
    if (isCoordinator) {
      // Pending / Forwarded / Returned / Approved / Rejected for CEO Secretariat (PS) tabs
      statuses.push(
        'Send to CEO Office',
        'Forwarded to CEO',
        'Returned from CEO Office',
        'Returned from CEO Secretariat',
        'Approved',
        'Pending Finance',
        'Rejected'
      );
    }
    if (isCeo) {
      statuses.push('Forwarded to CEO', 'Returned from CEO Office');
    }
    // Keep Returned visible to CEO as well when override/CEO
    if (isCeo && !statuses.includes('Returned from CEO Office')) {
      statuses.push('Returned from CEO Office');
    }

    let filter;
    if (statuses.length) {
      filter = { status: { $in: [...new Set(statuses)] } };
    } else {
      // Assigned authorities only (higher management without CEO/coordinator rights)
      const indentIds = await getAssignedIndentIdsForUser(req.user.id);
      const tokens = getUserIdentityTokens(req.user);
      const authorityTextConditions = buildAuthorityTextConditions(tokens);
      if (!indentIds.length && !authorityTextConditions.length) {
        return res.json({ success: true, data: [] });
      }
      filter = {
        status: { $in: ['Send to CEO Office', 'Forwarded to CEO', 'Returned from CEO Office', 'Approved', 'Pending Finance', 'Rejected'] },
        $or: [
          ...(indentIds.length ? [{ indent: { $in: indentIds } }] : []),
          ...authorityTextConditions
        ]
      };
      // Non-CEO assigned authorities may not act on Forwarded to CEO, but PS coordinators already hit statuses.length branch
      if (!isCeo && !isCoordinator) {
        filter.status = { $in: ['Send to CEO Office', 'Returned from CEO Office'] };
      }
    }

    const purchaseOrders = await PurchaseOrder.find(filter)
      .populate('vendor', 'name email phone contactPerson')
      .populate('companyId', 'name code symbol')
      .populate('createdBy', 'firstName lastName email')
      .populate(purchaseOrderIndentPopulate)
      .populate('quotation', 'quotationNumber quotationDate')
      .populate('authorityApprovals.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('costCenter', 'code name department')
      .sort({ updatedAt: -1 })
      .exec();
    res.json({
      success: true,
      data: purchaseOrders
    });
  })
);

// @route   GET /api/procurement/purchase-orders/:id
// @desc    Get purchase order by ID
// @access  Private (Procurement, Admin, HR, Higher Management, Pre-Audit / Audit roles, CEO secretariat)
router.get('/purchase-orders/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id)
      .populate('vendor', 'name email phone contactPerson address ntnCnic ntnNo cnic payeeName')
      .populate('companyId', 'name code symbol')
      .populate(purchaseOrderIndentPopulate)
      .populate('quotation', 'quotationNumber quotationDate')
      .populate('revisedFrom', 'orderNumber status replacementJustification')
      .populate('supersededBy', 'orderNumber status')
      .populate('createdBy', 'firstName lastName email digitalSignature')
      .populate('approvedBy', 'firstName lastName email digitalSignature')
      .populate('authorityApprovals.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('receivedBy', 'firstName lastName email digitalSignature')
      .populate('qaCheckedBy', 'firstName lastName digitalSignature')
      .populate('auditApprovedBy', 'firstName lastName email digitalSignature')
      .populate('preAuditInitialApprovedBy', 'firstName lastName email digitalSignature')
      .populate('auditReturnedBy', 'firstName lastName email digitalSignature')
      .populate('auditRejectedBy', 'firstName lastName email digitalSignature')
      .populate('ceoForwardedBy', 'firstName lastName email digitalSignature')
      .populate('ceoApprovedBy', 'firstName lastName email digitalSignature')
      .populate('ceoRejectedBy', 'firstName lastName email digitalSignature')
      .populate('ceoReturnedBy', 'firstName lastName email digitalSignature')
      .populate('financeApprovedBy', 'firstName lastName email digitalSignature')
      .populate('auditObservations.addedBy', 'firstName lastName email digitalSignature')
      .populate('auditObservations.answeredBy', 'firstName lastName email digitalSignature')
      .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature')
      .populate('updatedBy', 'firstName lastName email digitalSignature')
      .populate('costCenter', 'code name department');

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    if (!(await userCanViewPurchaseOrder(req.user, purchaseOrder))) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this purchase order'
      });
    }

    // For older POs with no workflow history, build from audit/CEO fields so Pre-Audit and Procurement show it
    if (!purchaseOrder.workflowHistory || purchaseOrder.workflowHistory.length === 0) {
      const backfill = buildBackfillWorkflowHistory(purchaseOrder);
      if (backfill.length > 0) {
        purchaseOrder.workflowHistory = backfill;
      }
    }

    // When PO has a related indent, include indent workflow (created → approvals → moved to procurement) then PO workflow
    let fullWorkflowHistory = null;
    const indentId = purchaseOrder.indent && (purchaseOrder.indent._id || purchaseOrder.indent);
    if (indentId) {
      const indent = await Indent.findById(indentId)
        .populate('createdBy', 'firstName lastName email digitalSignature')
        .populate('updatedBy', 'firstName lastName email digitalSignature')
        .populate('approvedBy', 'firstName lastName email digitalSignature')
        .populate('requestedBy', 'firstName lastName email digitalSignature')
        .populate('movedToProcurementBy', 'firstName lastName email digitalSignature')
        .lean();
      if (indent) {
        const indentEntries = buildIndentWorkflowHistory(indent);
        const poEntries = (purchaseOrder.workflowHistory || []).map((e) => ({
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          changedBy: e.changedBy,
          changedAt: e.changedAt,
          comments: e.comments,
          module: e.module || 'Procurement'
        }));
        const merged = [...indentEntries, ...poEntries].sort(
          (a, b) => new Date(a.changedAt || 0) - new Date(b.changedAt || 0)
        );
        fullWorkflowHistory = merged;
      }
    }

    // Include fullWorkflowHistory in response (not in schema, so must add to plain object or it gets stripped by toJSON)
    const data = purchaseOrder.toObject ? purchaseOrder.toObject() : { ...purchaseOrder };
    if (fullWorkflowHistory) {
      data.fullWorkflowHistory = fullWorkflowHistory;
    }

    try {
      const elig = await getGrnDcEligibility(purchaseOrder);
      data.grnRequiresDeliveryChallan = elig.grnRequiresDeliveryChallan;
      data.grnDcEligibility = elig;
      const dcStatus = purchaseOrderOpenForDeliveryChallan(purchaseOrder);
      data.dcCreationAllowedByStatus = dcStatus.ok;
      if (!dcStatus.ok) data.dcCreationBlockedReason = dcStatus.message;
      else delete data.dcCreationBlockedReason;
    } catch (_) {
      data.grnRequiresDeliveryChallan = false;
      data.grnDcEligibility = {
        grnRequiresDeliveryChallan: false,
        note: 'Could not evaluate delivery-challan eligibility.'
      };
      data.dcCreationAllowedByStatus = false;
    }

    const [qaPassedDeliveryChallanCount, dcPendingQaCount] = await Promise.all([
      DeliveryChallan.countDocuments({ purchaseOrder: purchaseOrder._id, status: 'qa_passed' }),
      DeliveryChallan.countDocuments({ purchaseOrder: purchaseOrder._id, status: 'qa_pending' })
    ]);
    data.qaPassedDeliveryChallanCount = qaPassedDeliveryChallanCount;
    data.dcPendingQaCount = dcPendingQaCount;

    res.json({
      success: true,
      data
    });
  })
);

// @route   POST /api/procurement/purchase-orders
// @desc    Create new purchase order
// @access  Private (Procurement and Admin)
router.post('/purchase-orders', [
  body('vendor').isMongoId().withMessage('Valid vendor ID is required'),
  body('orderDate').isDate().withMessage('Valid order date is required'),
  body('expectedDeliveryDate').isDate().withMessage('Valid expected delivery date is required'),
  body('deliveryAddress').optional().trim(),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.description').trim().notEmpty().withMessage('Item description is required'),
  body('items.*.quantity').isFloat({ min: 0.01 }).withMessage('Item quantity must be greater than 0'),
  body('items.*.unit').trim().notEmpty().withMessage('Item unit is required'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Item unit price must be non-negative')
], authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  // Verify vendor exists
  const vendor = await Supplier.findById(req.body.vendor);
  if (!vendor) {
    return res.status(404).json({
      success: false,
      message: 'Vendor not found'
    });
  }

  // Filter out any blank or zero-quantity items
  const validIncomingItems = (req.body.items || []).filter(
    item => item.description && item.description.trim() !== '' && (Number(item.quantity) || 0) > 0
  );
  if (validIncomingItems.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Cannot create Purchase Order: Please provide at least one item with a valid description and quantity greater than 0.'
    });
  }

  // Calculate item amounts
  const items = req.body.items.map(item => ({
    ...item,
    amount: (item.quantity * item.unitPrice) - (item.discount || 0) + ((item.quantity * item.unitPrice - (item.discount || 0)) * (item.taxRate || 0) / 100)
  }));
  const preparedByName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim() || req.user?.email || '';

  const bodyData = { ...req.body };
  if (bodyData.costCenter === '') bodyData.costCenter = null;
  delete bodyData.supersededBy;
  const replacementJustification = String(bodyData.replacementJustification || '').trim();
  delete bodyData.replacementJustification;
  delete bodyData.resourcingReleasedBy;
  delete bodyData.resourcingReleasedAt;

  // Re-issue from a rejected PO: the old PO stays closed as Rejected and links to the new one
  let sourcePO = null;
  if (bodyData.revisedFrom) {
    sourcePO = await PurchaseOrder.findById(bodyData.revisedFrom);
    if (!sourcePO) {
      return res.status(404).json({ success: false, message: 'Source (rejected) purchase order not found' });
    }
    if (sourcePO.status !== 'Rejected') {
      return res.status(400).json({ success: false, message: 'A new PO can only be created from a rejected purchase order' });
    }
    if (sourcePO.supersededBy) {
      return res.status(400).json({ success: false, message: 'A new purchase order has already been created from this rejected PO' });
    }
    if (sourcePO.resourcingReleasedAt) {
      return res.status(400).json({ success: false, message: 'This rejected PO was released for re-sourcing; create the new PO from the new Comparative Statement' });
    }
    if (!replacementJustification) {
      return res.status(400).json({ success: false, message: 'Justification is required to replace a rejected purchase order' });
    }
    if (!bodyData.indent && sourcePO.indent) bodyData.indent = sourcePO.indent;
    if (!bodyData.quotation && sourcePO.quotation) bodyData.quotation = sourcePO.quotation;
    if (!bodyData.companyId && sourcePO.companyId) bodyData.companyId = sourcePO.companyId;
  } else {
    delete bodyData.revisedFrom;
  }

  const purchaseOrder = new PurchaseOrder({
    ...bodyData,
    status: 'Pending Approval',
    items,
    createdBy: req.user.id
  });

  if (req.body.quotation) {
    const quotationDoc = await Quotation.findById(req.body.quotation).select('indent').lean();
    if (quotationDoc && quotationDoc.indent) {
      purchaseOrder.indent = quotationDoc.indent;
    }
  }
  if (!purchaseOrder.companyId && purchaseOrder.indent) {
    const indentDoc = await Indent.findById(purchaseOrder.indent).select('companyId').lean();
    if (indentDoc && indentDoc.companyId) {
      purchaseOrder.companyId = indentDoc.companyId;
    }
  }
  if (req.body.approvalAuthorities && typeof req.body.approvalAuthorities === 'object') {
    purchaseOrder.approvalAuthorities = {
      preparedBy: req.body.approvalAuthorities.preparedBy || preparedByName,
      managerProcurement: req.body.approvalAuthorities.managerProcurement || '',
      srManagerProcurement: req.body.approvalAuthorities.srManagerProcurement || '',
      chiefOperatingOfficer: req.body.approvalAuthorities.chiefOperatingOfficer || req.body.approvalAuthorities.verifiedBy || '',
      avpTaj: req.body.approvalAuthorities.avpTaj || req.body.approvalAuthorities.authorisedRep || '',
      technicalDepartment: req.body.approvalAuthorities.technicalDepartment || '',
      verifiedBy: req.body.approvalAuthorities.chiefOperatingOfficer || req.body.approvalAuthorities.verifiedBy || '',
      authorisedRep: req.body.approvalAuthorities.avpTaj || req.body.approvalAuthorities.authorisedRep || '',
      financeRep: req.body.approvalAuthorities.financeRep || ''
    };
  } else {
    purchaseOrder.approvalAuthorities = {
      preparedBy: preparedByName,
      managerProcurement: '',
      srManagerProcurement: '',
      chiefOperatingOfficer: '',
      avpTaj: '',
      technicalDepartment: '',
      verifiedBy: '',
      authorisedRep: '',
      financeRep: ''
    };
  }

  await purchaseOrder.save();
  pushPOWorkflowHistory(
    purchaseOrder,
    '—',
    'Pending Approval',
    req.user.id,
    sourcePO
      ? `Re-issued from rejected PO ${sourcePO.orderNumber} and submitted for authority approval | Justification: ${replacementJustification}`
      : 'Created in Procurement and submitted for authority approval',
    'Procurement'
  );
  await purchaseOrder.save();

  if (sourcePO) {
    sourcePO.supersededBy = purchaseOrder._id;
    sourcePO.replacementJustification = replacementJustification;
    sourcePO.updatedBy = req.user.id;
    pushPOWorkflowHistory(sourcePO, 'Rejected', 'Rejected', req.user.id, `Closed — replaced by new PO ${purchaseOrder.orderNumber} | Justification: ${replacementJustification}`, 'Procurement');
    await sourcePO.save();
  } else {
    await linkReplacementForReleasedPOs(purchaseOrder, req.user.id);
  }

  if (purchaseOrder.indent) {
    try {
      const Indent = require('../models/general/Indent');
      await Indent.updateFulfillment(purchaseOrder.indent);
    } catch (err) {
      console.error('Error updating indent fulfillment after manual PO creation:', err);
    }
  }

  const populatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
    .populate('vendor', 'name email phone')
    .populate('createdBy', 'firstName lastName email')
    .populate('costCenter', 'code name department')
    .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature');

  res.status(201).json({
    success: true,
    message: 'Purchase order created successfully',
    data: populatedOrder
  });
}));

// @route   PUT /api/procurement/purchase-orders/:id
// @desc    Update purchase order
// @access  Private (Procurement and Admin)
router.put('/purchase-orders/:id', [
  body('vendor').optional().isMongoId().withMessage('Valid vendor ID is required'),
  body('orderDate').optional().isDate().withMessage('Valid order date is required'),
  body('expectedDeliveryDate').optional().isDate().withMessage('Valid expected delivery date is required'),
  body('deliveryAddress').optional().trim(),
  body('items').optional().isArray({ min: 1 }).withMessage('At least one item is required')
], authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const purchaseOrder = await PurchaseOrder.findById(req.params.id);
  if (!purchaseOrder) {
    return res.status(404).json({
      success: false,
      message: 'Purchase order not found'
    });
  }

  // Prevent editing approved or completed orders
  if (['Received', 'Cancelled'].includes(purchaseOrder.status) && req.body.status !== 'Cancelled') {
    return res.status(400).json({
      success: false,
      message: 'Cannot edit completed or cancelled purchase orders'
    });
  }

  const isResubmissionFromReject = purchaseOrder.status === 'Rejected';

  if (isResubmissionFromReject && isClosedRejectedPO(purchaseOrder)) {
    return res.status(400).json({
      success: false,
      message: 'This rejected PO has been closed (replaced or released for re-sourcing) and can no longer be resubmitted'
    });
  }

  if (isResubmissionFromReject) {
    // Only allow updating rejection answers and documents
    if (req.body.auditRejectObservations) {
      purchaseOrder.auditRejectObservations = req.body.auditRejectObservations;
    }
    if (req.body.ceoRejectionAnswer) {
      purchaseOrder.ceoRejectionAnswer = req.body.ceoRejectionAnswer;
      purchaseOrder.ceoRejectionAnsweredBy = req.user.id;
      purchaseOrder.ceoRejectionAnsweredAt = new Date();
    }
    if (req.body.indentFile !== undefined) {
      purchaseOrder.indentFile = req.body.indentFile;
    }
    if (req.body.comparativeStatementFile !== undefined) {
      purchaseOrder.comparativeStatementFile = req.body.comparativeStatementFile;
    }

    // Find the status it was rejected FROM
    const history = Array.isArray(purchaseOrder.workflowHistory) ? purchaseOrder.workflowHistory : [];
    const lastRejectWorkflow = [...history].reverse().find((w) => w.toStatus === 'Rejected');
    const rejectFrom = lastRejectWorkflow?.fromStatus || '';
    const rejectModule = lastRejectWorkflow?.module || '';

    // CEO / CEO Secretariat reject → return directly to CEO queue.
    // Do NOT reopen Pending Approval (approval authority must not be asked again).
    const rejectedByCeo =
      rejectFrom === 'Forwarded to CEO' ||
      rejectFrom === 'Send to CEO Office' ||
      rejectModule === 'CEO Secretariat' ||
      Boolean(
        purchaseOrder.ceoRejectedAt &&
          (!purchaseOrder.auditRejectedAt ||
            new Date(purchaseOrder.ceoRejectedAt) >= new Date(purchaseOrder.auditRejectedAt))
      );

    let nextStatus;
    if (rejectedByCeo) {
      nextStatus = 'Forwarded to CEO';
    } else if (
      rejectFrom === 'Pending Audit' ||
      rejectFrom === 'Forwarded to Audit Director' ||
      Boolean(purchaseOrder.auditRejectedAt)
    ) {
      nextStatus = 'Pending Audit';
    } else {
      nextStatus = rejectFrom || 'Pending Approval';
    }

    purchaseOrder.status = nextStatus;
    purchaseOrder.updatedBy = req.user.id;

    pushPOWorkflowHistory(
      purchaseOrder,
      'Rejected',
      nextStatus,
      req.user.id,
      rejectedByCeo
        ? 'Resubmitted after CEO rejection (prior approval authorities preserved)'
        : 'Resubmitted with answers/documents',
      'Procurement'
    );
  } else {
    // Standard update
    // If items are being updated, recalculate amounts
    if (req.body.items) {
      req.body.items = req.body.items.map(item => ({
        ...item,
        amount: (item.quantity * item.unitPrice) - (item.discount || 0) + ((item.quantity * item.unitPrice - (item.discount || 0)) * (item.taxRate || 0) / 100)
      }));
    }

    const bodyData = { ...req.body };
    if (bodyData.costCenter === '') bodyData.costCenter = null;

    Object.assign(purchaseOrder, bodyData);
    purchaseOrder.updatedBy = req.user.id;
    // Never persist Sr Manager on pre-cutoff (legacy) POs
    if (!isSrManagerProcurementApplicable(purchaseOrder.createdAt) && purchaseOrder.approvalAuthorities) {
      purchaseOrder.approvalAuthorities.srManagerProcurement = '';
      if (typeof purchaseOrder.markModified === 'function') {
        purchaseOrder.markModified('approvalAuthorities');
      }
    }
  }

  await purchaseOrder.save();

  const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
    .populate('vendor', 'name email phone')
    .populate('createdBy', 'firstName lastName email')
    .populate('approvedBy', 'firstName lastName email')
    .populate('costCenter', 'code name department');

  res.json({
    success: true,
    message: 'Purchase order updated successfully',
    data: updatedOrder
  });
}));

// @route   PUT /api/procurement/purchase-orders/:id/approve
// @desc    Approve purchase order by assigned authority
// @access  Private (Assigned authority / admin)
router.put('/purchase-orders/:id/approve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    
    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    if (purchaseOrder.status !== 'Pending Approval') {
      return res.status(400).json({
        success: false,
        message: 'Only pending purchase orders can be approved'
      });
    }

    // Drop backfilled Sr Manager on pre-cutoff POs; advance if other slots already done.
    const legacy = await reconcileLegacySrManagerProcurement(purchaseOrder, {
      pushHistory: pushPOWorkflowHistory,
      actorId: req.user.id
    });
    if (legacy.advanced) {
      purchaseOrder.updatedBy = req.user.id;
      await purchaseOrder.save();
      const advancedOrder = await PurchaseOrder.findById(purchaseOrder._id)
        .populate('vendor', 'name email phone')
        .populate('approvedBy', 'firstName lastName email digitalSignature')
        .populate('authorityApprovals.approver', 'firstName lastName email employeeId digitalSignature');
      return res.json({
        success: true,
        message: 'Legacy Sr Manager Procurement requirement cleared. Purchase order sent to Pre-Audit.',
        data: advancedOrder
      });
    }

    const assignedAuthorityAccess =
      await isAssignedComparativeAuthorityUser(purchaseOrder.indent, req.user.id) ||
      isAssignedByAuthorityText(purchaseOrder.approvalAuthorities, req.user, purchaseOrder.createdAt);
    const isAdmin = ['super_admin', 'admin', 'developer'].includes(req.user.role);
    if (!isAdmin && !assignedAuthorityAccess) {
      return res.status(403).json({
        success: false,
        message: 'Only assigned authority can approve this purchase order'
      });
    }

    const requiredSlots = await getRequiredAuthoritySlots(
      purchaseOrder.indent,
      purchaseOrder.approvalAuthorities,
      purchaseOrder.createdAt
    );
    if (!requiredSlots.length) {
      return res.status(400).json({
        success: false,
        message: 'No approval authorities configured on this purchase order'
      });
    }
    const matchedSlots = matchUserToAuthoritySlots(requiredSlots, req.user);
    if (!matchedSlots.length) {
      return res.status(400).json({
        success: false,
        message: 'Your user is not mapped to any pending authority slot'
      });
    }
    const approvals = Array.isArray(purchaseOrder.authorityApprovals) ? [...purchaseOrder.authorityApprovals] : [];
    const approvedKeys = new Set(approvals.map((a) => String(a?.authorityKey || '').trim()).filter(Boolean));
    const pendingMatchedSlots = matchedSlots.filter((slot) => !approvedKeys.has(slot.key));
    if (!pendingMatchedSlots.length) {
      return res.status(400).json({
        success: false,
        message: 'You have already approved your assigned authority slot(s)'
      });
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
    purchaseOrder.authorityApprovals = approvals;
    const requiredKeys = new Set(requiredSlots.map((s) => s.key));
    const updatedApprovedKeys = getPoApprovedAuthorityKeys(purchaseOrder.authorityApprovals);
    const allApproved = [...requiredKeys].every((key) => updatedApprovedKeys.has(key));
    purchaseOrder.approvedBy = req.user.id;
    purchaseOrder.approvedAt = now;
    if (allApproved) {
      purchaseOrder.status = 'Pending Audit';
    }
    purchaseOrder.updatedBy = req.user.id;
    if (allApproved) {
      pushPOWorkflowHistory(
        purchaseOrder,
        'Pending Approval',
        'Pending Audit',
        req.user.id,
        req.body.comments || 'All assigned authorities approved and sent to Pre-Audit',
        'Procurement'
      );
    } else {
      const remaining = requiredSlots.length - updatedApprovedKeys.size;
      pushPOWorkflowHistory(
        purchaseOrder,
        'Pending Approval',
        'Pending Approval',
        req.user.id,
        req.body.comments || `Authority approval recorded. ${remaining} approval(s) remaining.`,
        'Procurement'
      );
    }
    
    await purchaseOrder.save();

    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('approvedBy', 'firstName lastName email digitalSignature')
      .populate('authorityApprovals.approver', 'firstName lastName email employeeId digitalSignature');
    const remaining = requiredSlots.length - updatedApprovedKeys.size;
    const message = allApproved
      ? 'All authority approvals completed. Purchase order sent to Pre-Audit successfully'
      : `Authority approval recorded successfully. ${remaining} approval(s) remaining before Pre-Audit`;

    res.json({
      success: true,
      message,
      data: updatedOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/reject
// @desc    Reject purchase order by assigned authority
// @access  Private (Assigned authority / admin)
router.put('/purchase-orders/:id/reject',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (purchaseOrder.status !== 'Pending Approval') {
      return res.status(400).json({ success: false, message: 'Only pending purchase orders can be rejected' });
    }
    const assignedAuthorityAccess =
      await isAssignedComparativeAuthorityUser(purchaseOrder.indent, req.user.id) ||
      isAssignedByAuthorityText(purchaseOrder.approvalAuthorities, req.user, purchaseOrder.createdAt);
    const isAdmin = ['super_admin', 'admin', 'developer'].includes(req.user.role);
    if (!isAdmin && !assignedAuthorityAccess) {
      return res.status(403).json({ success: false, message: 'Only assigned authority can reject this purchase order' });
    }
    const rejectionComments = req.body?.rejectionComments || req.body?.comments || '';
    const observations = Array.isArray(req.body?.observations)
      ? req.body.observations.filter(o => o && (typeof o === 'string' ? o.trim() : o.observation?.trim()))
      : [];

    purchaseOrder.status = 'Rejected';
    purchaseOrder.updatedBy = req.user.id;
    purchaseOrder.auditRejectedBy = req.user.id;
    purchaseOrder.auditRejectedAt = new Date();
    purchaseOrder.auditRejectionComments = rejectionComments || purchaseOrder.auditRejectionComments || '';
    if (observations.length > 0) {
      purchaseOrder.auditRejectObservations = observations.map(o => typeof o === 'string' ? { observation: o, severity: 'medium' } : { observation: o.observation, severity: o.severity || 'medium' });
    }

    const obsText = observations.length > 0 
      ? ` | Observations: ${observations.map((o, idx) => `${idx + 1}. ${typeof o === 'string' ? o : o.observation}`).join('; ')}`
      : '';

    pushPOWorkflowHistory(
      purchaseOrder,
      'Pending Approval',
      'Rejected',
      req.user.id,
      `${rejectionComments || 'Rejected by assigned authority'}${obsText}`,
      'Procurement'
    );
    await purchaseOrder.save();
    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature');
    res.json({
      success: true,
      message: 'Purchase order rejected successfully',
      data: updatedOrder
    });
  })
);

// Push an entry to Purchase Order workflow history (for display in Pre-Audit, CEO Secretariat, Procurement, etc.)
// module: 'Procurement' | 'Pre-Audit' | 'CEO Secretariat' – where the action was taken
function pushPOWorkflowHistory(po, fromStatus, toStatus, userId, comments, module) {
  if (!po) return;
  po.workflowHistory = po.workflowHistory || [];
  po.workflowHistory.push({
    fromStatus: fromStatus || po.status || 'Draft',
    toStatus: toStatus || po.status,
    changedBy: userId,
    changedAt: new Date(),
    comments: comments || '',
    module: module || ''
  });
}

// A rejected PO is "closed" once it has been replaced or released for re-sourcing; it can't be resubmitted after that
function isClosedRejectedPO(po) {
  return Boolean(po && po.status === 'Rejected' && (po.supersededBy || po.resourcingReleasedAt));
}

/**
 * After a new PO is created for a requisition, link it as the replacement of any rejected PO on the same
 * requisition that was released for re-sourcing and shares at least one item with it.
 */
async function linkReplacementForReleasedPOs(newPO, userId) {
  if (!newPO?.indent) return;
  const released = await PurchaseOrder.find({
    indent: newPO.indent,
    _id: { $ne: newPO._id },
    status: 'Rejected',
    resourcingReleasedAt: { $ne: null },
    $or: [{ supersededBy: null }, { supersededBy: { $exists: false } }]
  });
  if (!released.length) return;
  const norm = (d) => String(d || '').trim().toLowerCase();
  const newDescs = new Set((newPO.items || []).map((it) => norm(it.description)));
  const matched = released.filter((old) => (old.items || []).some((it) => newDescs.has(norm(it.description))));
  for (const old of matched) {
    old.supersededBy = newPO._id;
    old.updatedBy = userId;
    pushPOWorkflowHistory(old, 'Rejected', 'Rejected', userId, `Closed — replaced by new PO ${newPO.orderNumber}${old.replacementJustification ? ` | Justification: ${old.replacementJustification}` : ''}`, 'Procurement');
    await old.save();
  }
  if (matched.length && !newPO.revisedFrom) {
    newPO.revisedFrom = matched[0]._id;
    pushPOWorkflowHistory(newPO, newPO.status, newPO.status, userId, `Replaces rejected PO ${matched.map((o) => o.orderNumber).join(', ')} (re-sourced via new Comparative Statement)`, 'Procurement');
    await newPO.save();
  }
}

/**
 * A PO on the requisition blocks shortlisting/finalizing another quotation unless it is Cancelled, or Rejected
 * and closed (released for re-sourcing / replaced). An open rejected PO still blocks, since it could be resubmitted.
 */
async function findBlockingPOForQuotation(filter) {
  const pos = await PurchaseOrder.find({ ...filter, status: { $ne: 'Cancelled' } })
    .select('orderNumber status supersededBy resourcingReleasedAt')
    .lean();
  const active = pos.find((po) => po.status !== 'Rejected');
  if (active) return active;
  return pos.find((po) => !isClosedRejectedPO(po)) || null;
}

function blockingPOMessage(prefix, po) {
  if (po.status === 'Rejected') {
    return `${prefix}: Purchase Order ${po.orderNumber} for this requisition was rejected but is still open. In Purchase Orders, use "Release for re-sourcing" on ${po.orderNumber} (with justification) to reopen the Comparative Statement, then shortlist/finalize again.`;
  }
  return `${prefix}: A Purchase Order (${po.orderNumber}) has already been created for this requisition.`;
}

function upsertPOAuthorityApproval(po, { key, label, approverId, approvedAt = new Date(), comments = '' }) {
  if (!po || !key || !approverId) return;
  po.authorityApprovals = Array.isArray(po.authorityApprovals) ? po.authorityApprovals : [];
  const idx = po.authorityApprovals.findIndex((entry) => String(entry?.authorityKey || '').trim() === String(key).trim());
  const nextEntry = {
    authorityKey: key,
    authorityLabel: label || key,
    approver: approverId,
    approvedAt,
    comments
  };
  if (idx >= 0) {
    po.authorityApprovals[idx] = {
      ...po.authorityApprovals[idx].toObject?.(),
      ...nextEntry
    };
  } else {
    po.authorityApprovals.push(nextEntry);
  }
}

// Build workflow history entries from an indent (created → submitted → approved → moved to procurement) for display in PO workflow
// indent must have createdBy, updatedBy, approvedBy, movedToProcurementBy populated (e.g. firstName, lastName)
function buildIndentWorkflowHistory(indent) {
  if (!indent) return [];
  const entries = [];
  const createdAt = indent.createdAt || indent.updatedAt;
  const createdBy = indent.createdBy;

  entries.push({
    fromStatus: '—',
    toStatus: 'Draft',
    changedBy: createdBy,
    changedAt: createdAt,
    comments: 'Indent created',
    module: 'Indent'
  });

  if (indent.status && indent.status !== 'Draft' && !['Approved', 'Rejected', 'Rejected in Procurement', 'Partially Fulfilled', 'Fulfilled', 'Cancelled'].includes(indent.status)) {
    const submittedAt = indent.updatedAt || createdAt;
    const submittedBy = indent.updatedBy || indent.requestedBy || createdBy;
    entries.push({
      fromStatus: 'Draft',
      toStatus: indent.status === 'Submitted' ? 'Submitted' : 'Under Review',
      changedBy: submittedBy,
      changedAt: submittedAt,
      comments: indent.status === 'Submitted' ? 'Indent submitted' : 'Indent under review',
      module: 'Indent'
    });
  }

  if (indent.status === 'Approved' && indent.approvedBy && indent.approvedDate) {
    entries.push({
      fromStatus: 'Under Review',
      toStatus: 'Approved',
      changedBy: indent.approvedBy,
      changedAt: indent.approvedDate,
      comments: 'Indent approved',
      module: 'Indent'
    });
  }

  if (indent.status === 'Rejected') {
    entries.push({
      fromStatus: 'Under Review',
      toStatus: 'Rejected',
      changedBy: indent.updatedBy || null,
      changedAt: indent.updatedAt || new Date(),
      comments: indent.rejectionReason || 'Indent rejected',
      module: 'Indent'
    });
  }

  if (indent.storeRoutingStatus === 'moved_to_procurement' && indent.movedToProcurementBy && indent.movedToProcurementAt) {
    entries.push({
      fromStatus: 'Approved',
      toStatus: 'Moved to Procurement',
      changedBy: indent.movedToProcurementBy,
      changedAt: indent.movedToProcurementAt,
      comments: indent.movedToProcurementReason || 'Moved to Procurement (requisition)',
      module: 'Indent'
    });
    // Show Procurement Requisition stage so both Indent and Requisition appear in PO workflow history
    entries.push({
      fromStatus: 'Moved to Procurement',
      toStatus: 'Requisition in Procurement',
      changedBy: indent.movedToProcurementBy,
      changedAt: indent.movedToProcurementAt,
      comments: 'Requisition available in Procurement for quotations',
      module: 'Requisition'
    });
  }

  return entries;
}

// Build workflow history from existing PO audit/CEO fields when workflowHistory is empty (for older POs)
function buildBackfillWorkflowHistory(po) {
  const entries = [];
  const status = po.status || 'Draft';

  if (po.auditReturnedAt) {
    entries.push({
      fromStatus: 'Pending Audit',
      toStatus: 'Returned from Audit',
      changedBy: po.auditReturnedBy,
      changedAt: po.auditReturnedAt,
      comments: po.auditReturnComments || 'Returned from Pre-Audit with observations',
      module: 'Pre-Audit'
    });
  }
  if (po.auditRejectedAt) {
    entries.push({
      fromStatus: 'Pending Audit',
      toStatus: 'Rejected',
      changedBy: po.auditRejectedBy,
      changedAt: po.auditRejectedAt,
      comments: po.auditRejectionComments || 'Rejected with observations',
      module: 'Pre-Audit'
    });
  }
  if (po.auditApprovedAt) {
    entries.push({
      fromStatus: 'Pending Audit',
      toStatus: 'Send to CEO Office',
      changedBy: po.auditApprovedBy,
      changedAt: po.auditApprovedAt,
      comments: po.auditRemarks || 'Approved by Audit',
      module: 'Pre-Audit'
    });
  }
  if (po.ceoForwardedAt) {
    entries.push({
      fromStatus: status === 'Forwarded to CEO' ? 'Send to CEO Office' : 'Returned from CEO Office',
      toStatus: 'Forwarded to CEO',
      changedBy: po.ceoForwardedBy,
      changedAt: po.ceoForwardedAt,
      comments: 'Forwarded to CEO for approval',
      module: 'CEO Secretariat'
    });
  }
  if (po.ceoApprovedAt) {
    const ceoToStatus = po.status === 'Pending Finance' ? 'Pending Finance' : 'Approved';
    entries.push({
      fromStatus: 'Forwarded to CEO',
      toStatus: ceoToStatus,
      changedBy: po.ceoApprovedBy,
      changedAt: po.ceoApprovedAt,
      comments: ceoToStatus === 'Pending Finance' ? (po.ceoApprovalComments || 'Approved by CEO – sent to Finance (advance/partial advance)') : (po.ceoApprovalComments || 'Approved by CEO'),
      module: 'CEO Secretariat'
    });
  }
  if (po.financeApprovedAt) {
    entries.push({
      fromStatus: 'Pending Finance',
      toStatus: 'Approved',
      changedBy: po.financeApprovedBy,
      changedAt: po.financeApprovedAt,
      comments: po.financeRemarks || 'Approved by Finance',
      module: 'Finance'
    });
  }
  if (po.ceoRejectedAt) {
    entries.push({
      fromStatus: 'Forwarded to CEO',
      toStatus: 'Rejected',
      changedBy: po.ceoRejectedBy,
      changedAt: po.ceoRejectedAt,
      comments: po.ceoRejectionComments || 'Rejected by CEO',
      module: 'CEO Secretariat'
    });
  }
  if (po.ceoReturnedAt) {
    entries.push({
      fromStatus: 'Forwarded to CEO',
      toStatus: 'Returned from CEO Office',
      changedBy: po.ceoReturnedBy,
      changedAt: po.ceoReturnedAt,
      comments: po.ceoReturnComments || 'Returned from CEO Office',
      module: 'CEO Secretariat'
    });
  }
  // If PO reached audit at some point, add "Sent to Audit" so it appears before other audit events
  const hasAuditEvent = po.auditApprovedAt || po.auditRejectedAt || po.auditReturnedAt;
  if (hasAuditEvent || status === 'Pending Audit' || status === 'Send to CEO Office' || status === 'Forwarded to CEO' || status === 'Pending Finance' || status === 'Approved') {
    const auditDates = [po.auditApprovedAt, po.auditRejectedAt, po.auditReturnedAt].filter(Boolean).map(d => new Date(d).getTime());
    const sentAt = auditDates.length ? new Date(Math.min(...auditDates) - 1000) : (po.updatedAt || po.createdAt);
    const fromStatus = (status === 'Returned from Audit' || status === 'Rejected') && hasAuditEvent ? status : 'Draft';
    entries.unshift({
      fromStatus,
      toStatus: 'Pending Audit',
      changedBy: po.createdBy || po.updatedBy,
      changedAt: sentAt,
      comments: 'Sent to Pre-Audit',
      module: 'Procurement'
    });
  }
  // Add "Created in Procurement" as first step so full flow always starts from Procurement
  const createdAt = po.createdAt ? new Date(po.createdAt) : (entries.length ? new Date(Math.min(...entries.map(e => new Date(e.changedAt).getTime())) - 2000) : new Date());
  entries.unshift({
    fromStatus: '—',
    toStatus: 'Draft',
    changedBy: po.createdBy || po.updatedBy,
    changedAt: createdAt,
    comments: 'Created in Procurement',
    module: 'Procurement'
  });

  entries.sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));
  return entries;
}

// Build human-readable summary of PO changes compared to snapshot (for audit resubmission)
function buildPOChangeSummary(currentItems, snapshot) {
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

// @route   PUT /api/procurement/purchase-orders/:id/send-to-audit
// @desc    Send purchase order to audit module (status -> Pending Audit)
// @access  Private (Procurement and Admin)
// @route   PUT /api/procurement/purchase-orders/:id/release-for-resourcing
// @desc    Close a rejected PO and reopen its Comparative Statement + quotation so a new CS and PO can be made.
//          Body: { justification }. The next PO created for the same requisition items is linked as its replacement.
// @access  Private (assigned procurement user / assignment manager)
router.put('/purchase-orders/:id/release-for-resourcing',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const justification = String(req.body?.justification || '').trim();
    if (!justification) {
      return res.status(400).json({ success: false, message: 'Justification is required' });
    }
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (purchaseOrder.status !== 'Rejected') {
      return res.status(400).json({ success: false, message: 'Only rejected purchase orders can be released for re-sourcing' });
    }
    if (isClosedRejectedPO(purchaseOrder)) {
      return res.status(400).json({ success: false, message: 'This rejected PO has already been replaced or released for re-sourcing' });
    }

    const indent = purchaseOrder.indent ? await Indent.findById(purchaseOrder.indent) : null;
    if (indent && !canOperateAssignedProcurementRequisition(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned procurement user or an assignment manager can release this PO for re-sourcing.'
      });
    }

    // 1. Reopen the quotation the PO came from
    const quotation = purchaseOrder.quotation ? await Quotation.findById(purchaseOrder.quotation) : null;
    if (quotation && ['Finalized', 'Shortlisted'].includes(quotation.status)) {
      quotation.status = 'Received';
      quotation.updatedBy = req.user.id;
      await quotation.save();
    }

    // 2. Reopen the Comparative Statement approval for that lot (approvers kept, their decisions cleared)
    if (indent) {
      const lotNumber = quotation?.lotNumber || 'A';
      const resetApproval = (ca) => {
        if (!ca) return '';
        const prev = ca.status || 'not_configured';
        (ca.approvers || []).forEach((step) => {
          step.status = 'pending';
          step.actedAt = null;
          step.comment = '';
        });
        ca.status = (ca.approvers || []).length > 0 ? 'draft' : 'not_configured';
        ca.submittedBy = null;
        ca.submittedAt = null;
        ca.rejectedBy = null;
        ca.rejectedAt = null;
        ca.rejectionObservation = '';
        return prev;
      };
      const lotCa = Array.isArray(indent.comparativeApprovals)
        ? indent.comparativeApprovals.find((a) => (a.lotNumber || 'A') === lotNumber)
        : null;
      const previousCsStatus = resetApproval(lotCa || indent.comparativeApproval);
      if (lotCa) indent.comparativeApproval = lotCa;
      indent.markModified('comparativeApprovals');
      indent.markModified('comparativeApproval');

      // Drop saved split assignments that point at the reopened quotation
      if (quotation && indent.splitPOAssignments && typeof indent.splitPOAssignments === 'object') {
        const next = { ...indent.splitPOAssignments };
        Object.keys(next).forEach((k) => {
          if (String(next[k]) === String(quotation._id)) delete next[k];
        });
        indent.splitPOAssignments = Object.keys(next).length ? next : undefined;
        indent.markModified('splitPOAssignments');
      }

      indent.updatedBy = req.user.id;
      pushIndentWorkflowHistory(indent, {
        fromStatus: `Comparative Approval: ${previousCsStatus}`,
        toStatus: `Comparative Approval: ${lotCa?.status || indent.comparativeApproval?.status || 'draft'}`,
        changedBy: req.user.id,
        comments: `Comparative Statement (Lot ${lotNumber}) reopened — PO ${purchaseOrder.orderNumber} rejected and released for re-sourcing. Justification: ${justification}`,
        module: 'Procurement'
      });
      await indent.save();
    }

    // 3. Close the rejected PO
    purchaseOrder.resourcingReleasedBy = req.user.id;
    purchaseOrder.resourcingReleasedAt = new Date();
    purchaseOrder.replacementJustification = justification;
    purchaseOrder.updatedBy = req.user.id;
    pushPOWorkflowHistory(
      purchaseOrder,
      'Rejected',
      'Rejected',
      req.user.id,
      `Released for re-sourcing — Comparative Statement${quotation ? ` and quotation ${quotation.quotationNumber}` : ''} reopened | Justification: ${justification}`,
      'Procurement'
    );
    await purchaseOrder.save(); // post-save hook recounts requisition ordered quantities

    res.json({
      success: true,
      message: `PO ${purchaseOrder.orderNumber} closed. Comparative Statement${quotation ? ` and quotation ${quotation.quotationNumber}` : ''} reopened — prepare a new CS and create the new PO.`,
      data: purchaseOrder
    });
  })
);

router.put('/purchase-orders/:id/send-to-audit',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (!['Draft', 'Returned from Audit', 'Returned from CEO Secretariat', 'Returned from Finance', 'Rejected'].includes(purchaseOrder.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only Draft, Returned from Audit, Returned from CEO Secretariat, Returned from Finance, or Rejected purchase orders can be sent to audit'
      });
    }
    if (isClosedRejectedPO(purchaseOrder)) {
      return res.status(400).json({
        success: false,
        message: 'This rejected PO has been closed (replaced or released for re-sourcing) and can no longer be resubmitted'
      });
    }
    
    // Handle answers to observations when resubmitting from "Returned from Audit", "Returned from Finance", or "Rejected"
    if (['Returned from Audit', 'Returned from Finance', 'Rejected'].includes(purchaseOrder.status) && req.body.observationAnswers) {
      const { observationAnswers } = req.body; // Array of { observationId, answer }
      
      if (Array.isArray(observationAnswers) && purchaseOrder.auditObservations && purchaseOrder.auditObservations.length > 0) {
        observationAnswers.forEach(({ observationId, answer }) => {
          const observation = purchaseOrder.auditObservations.id(observationId);
          if (observation && answer && answer.trim()) {
            observation.answer = answer.trim();
            observation.answeredBy = req.user.id;
            observation.answeredAt = new Date();
            observation.resolved = true;
          }
        });
      }
    }
    
    // When resubmitting after return/reject, compute change summary from snapshot so audit can see what was edited
    if (['Returned from Audit', 'Returned from Finance', 'Rejected'].includes(purchaseOrder.status)) {
      const snapshot = purchaseOrder.auditSnapshotAtReturn;
      if (snapshot && (purchaseOrder.items || []).length >= 0) {
        const summary = buildPOChangeSummary(purchaseOrder.items, snapshot);
        purchaseOrder.resubmissionChangeSummary = summary || purchaseOrder.resubmissionChangeSummary || '';
      }
    }
    
    const fromStatusSendAudit = purchaseOrder.status;
    pushPOWorkflowHistory(purchaseOrder, fromStatusSendAudit, 'Pending Audit', req.user.id, 'Sent to Pre-Audit', 'Procurement');
    purchaseOrder.status = 'Pending Audit';
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('updatedBy', 'firstName lastName email')
      .populate('auditObservations.addedBy', 'firstName lastName email')
      .populate('auditObservations.answeredBy', 'firstName lastName email')
      .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature');

    const auditRecipients = await getAuditWorkflowRecipients();
    await notifyDocumentRecipients({
      recipientIds: auditRecipients,
      actorId: req.user.id,
      title: 'PO pending Audit review',
      message: `Purchase Order ${purchaseOrder.orderNumber || purchaseOrder.poNumber || ''} moved to Audit queue. Please review in Pre-Audit.`,
      actionUrl: '/audit',
      entityId: purchaseOrder._id,
      entityType: 'PurchaseOrder',
      module: 'procurement',
      metadata: {
        queueStage: 'pending_audit',
        targetModule: 'audit',
        targetTab: 'pre_audit'
      }
    });
    notifyApprovers(auditRecipients, { docType: 'Purchase Order', docNumber: purchaseOrder.orderNumber || purchaseOrder.poNumber || '', fromUser: req.user }).catch(() => {});
    notifyChatApprovers(auditRecipients, { docType: 'Purchase Order', docNumber: purchaseOrder.orderNumber || purchaseOrder.poNumber || '', url: '/audit', fromUser: req.user }).catch(() => {});

    res.json({
      success: true,
      message: 'Purchase order sent to audit successfully',
      data: updatedOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/audit-approve
// @desc    Two-step audit approval for PO:
//          1) Assistant/auditor initial approval in Pending Audit
//          2) Audit Director final approval after Forwarded to Audit Director
// @access  Private (dynamic audit access)
router.put('/purchase-orders/:id/audit-approve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!hasAuditAccess(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to audit this purchase order.'
      });
    }

    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }

    // Step 1: Initial audit approval by assistant/auditor while PO is still in Pending Audit.
    if (purchaseOrder.status === 'Pending Audit') {
      if (!canPerformInitialPreAuditActions(req.user)) {
        return res.status(403).json({
          success: false,
          message: 'Initial pre-audit approval must be completed by General Audit / pre-audit staff before director approval.'
        });
      }
      const initialComments = req.body.approvalComments || req.body.comments || '';
      const initialApprovedAt = new Date();
      purchaseOrder.preAuditInitialApprovedBy = req.user.id;
      purchaseOrder.preAuditInitialApprovedAt = initialApprovedAt;
      purchaseOrder.preAuditInitialComments = initialComments;
      upsertPOAuthorityApproval(purchaseOrder, {
        key: 'preAuditInitial',
        label: 'Initial Pre-Audit',
        approverId: req.user.id,
        approvedAt: initialApprovedAt,
        comments: initialComments || 'Initial pre-audit approval recorded.'
      });
      purchaseOrder.updatedBy = req.user.id;
      pushPOWorkflowHistory(
        purchaseOrder,
        'Pending Audit',
        'Pending Audit',
        req.user.id,
        initialComments || 'Initial pre-audit approval recorded. Forward to Audit Director for final approval.',
        'Pre-Audit'
      );
      await purchaseOrder.save();

      const updatedInitial = await PurchaseOrder.findById(purchaseOrder._id)
        .populate('vendor', 'name email phone')
        .populate('preAuditInitialApprovedBy', 'firstName lastName email digitalSignature')
        .populate('authorityApprovals.approver', 'firstName lastName email employeeId digitalSignature')
        .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature');

      const auditRecipients = await getAuditWorkflowRecipients();
      await notifyDocumentRecipients({
        recipientIds: auditRecipients,
        actorId: req.user.id,
        title: 'Initial pre-audit approval recorded',
        message: `Purchase Order ${purchaseOrder.orderNumber || purchaseOrder.poNumber || ''} has initial audit approval and is ready to forward to Audit Director.`,
        actionUrl: '/audit',
        entityId: purchaseOrder._id,
        entityType: 'PurchaseOrder',
        module: 'procurement',
        metadata: {
          queueStage: 'initial_audit_approved',
          targetModule: 'audit',
          targetTab: 'pre_audit'
        }
      });

      return res.json({
        success: true,
        message: 'Initial pre-audit approval recorded. Please forward to Audit Director for final approval.',
        data: updatedInitial
      });
    }

    // Step 2: Final approval by Audit Director after forwarded.
    if (purchaseOrder.status !== 'Forwarded to Audit Director') {
      return res.status(400).json({
        success: false,
        message: 'Purchase order must be forwarded to Audit Director for final approval.'
      });
    }
    if (!canActAsAuditDirector(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Only Audit Director can provide final approval after forwarding.'
      });
    }
    const fromAuditStatus = purchaseOrder.status;
    pushPOWorkflowHistory(purchaseOrder, fromAuditStatus, 'Send to CEO Office', req.user.id, req.body.approvalComments || req.body.comments || '', 'Pre-Audit');
    const finalApprovalAt = new Date();
    purchaseOrder.status = 'Send to CEO Office';
    purchaseOrder.auditApprovedBy = req.user.id;
    purchaseOrder.auditApprovedAt = finalApprovalAt;
    purchaseOrder.auditRemarks = req.body.approvalComments || req.body.comments || '';
    upsertPOAuthorityApproval(purchaseOrder, {
      key: 'auditDirectorApproval',
      label: 'Audit Director',
      approverId: req.user.id,
      approvedAt: finalApprovalAt,
      comments: purchaseOrder.auditRemarks || 'Final audit approval recorded.'
    });
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('auditApprovedBy', 'firstName lastName email digitalSignature')
      .populate('authorityApprovals.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature');

    const ceoSecretariatRecipients = await getCeoSecretariatRecipients();
    await notifyDocumentRecipients({
      recipientIds: ceoSecretariatRecipients,
      actorId: req.user.id,
      title: 'PO pending CEO Secretariat',
      message: `Purchase Order ${purchaseOrder.orderNumber || purchaseOrder.poNumber || ''} is audit-approved and now waiting in CEO Secretariat queue.`,
      actionUrl: '/general/ceo-secretariat/payments',
      entityId: purchaseOrder._id,
      entityType: 'PurchaseOrder',
      module: 'procurement',
      metadata: {
        queueStage: 'send_to_ceo_office',
        targetModule: 'procurement',
        targetTab: 'ceo_secretariat'
      }
    });
    notifyApprovers(ceoSecretariatRecipients, { docType: 'Purchase Order', docNumber: purchaseOrder.orderNumber || purchaseOrder.poNumber || '', fromUser: req.user }).catch(() => {});
    notifyChatApprovers(ceoSecretariatRecipients, { docType: 'Purchase Order', docNumber: purchaseOrder.orderNumber || purchaseOrder.poNumber || '', url: '/general/ceo-secretariat', fromUser: req.user }).catch(() => {});

    res.json({
      success: true,
      message: 'Purchase order audit-approved successfully and sent to CEO Office',
      data: updatedOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/audit-reject
// @desc    Audit module rejects purchase order (status -> Rejected)
// @access  Private (Super Admin, Audit Manager, Auditor)
router.put('/purchase-orders/:id/audit-reject',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!hasAuditAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Audit access required' });
    }
    const { rejectionComments, observations } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (!['Pending Audit', 'Forwarded to Audit Director'].includes(purchaseOrder.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only purchase orders in Pending Audit or Forwarded to Audit Director can be audit-rejected'
      });
    }
    pushPOWorkflowHistory(purchaseOrder, purchaseOrder.status, 'Rejected', req.user.id, rejectionComments || 'Rejected with observations', 'Pre-Audit');
    purchaseOrder.status = 'Rejected';
    purchaseOrder.auditRejectedBy = req.user.id;
    purchaseOrder.auditRejectedAt = new Date();
    purchaseOrder.auditRejectionComments = rejectionComments || '';
    purchaseOrder.auditRejectObservations = observations || [];
    // Snapshot items and totals so we can compute change summary when procurement resubmits
    purchaseOrder.auditSnapshotAtReturn = {
      items: JSON.parse(JSON.stringify(purchaseOrder.items || [])),
      totalAmount: purchaseOrder.totalAmount,
      subtotal: purchaseOrder.subtotal
    };
    // Also add to auditObservations so procurement can answer each observation when resubmitting
    if (observations && Array.isArray(observations) && observations.length > 0) {
      purchaseOrder.auditObservations = purchaseOrder.auditObservations || [];
      observations.forEach(obs => {
        purchaseOrder.auditObservations.push({
          observation: typeof obs === 'string' ? obs : (obs.observation || obs.text || ''),
          severity: (typeof obs === 'object' && obs.severity ? obs.severity : 'medium').toLowerCase(),
          addedBy: req.user.id,
          addedAt: new Date(),
          resolved: false
        });
      });
    }
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('auditRejectedBy', 'firstName lastName email')
      .populate('auditObservations.addedBy', 'firstName lastName email')
      .populate('auditObservations.answeredBy', 'firstName lastName email');
    res.json({
      success: true,
      message: 'Purchase order audit-rejected successfully',
      data: updatedOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/audit-return
// @desc    Audit module returns purchase order to procurement (status -> Returned from Audit)
// @access  Private (Super Admin, Audit Manager, Auditor)
router.put('/purchase-orders/:id/audit-return',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!hasAuditAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Audit access required' });
    }
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (!['Pending Audit', 'Forwarded to Audit Director'].includes(purchaseOrder.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only purchase orders in Pending Audit or Forwarded to Audit Director can be returned from audit'
      });
    }
    pushPOWorkflowHistory(purchaseOrder, purchaseOrder.status, 'Returned from Audit', req.user.id, req.body.returnComments || '', 'Pre-Audit');
    purchaseOrder.status = 'Returned from Audit';
    purchaseOrder.auditReturnedBy = req.user.id;
    purchaseOrder.auditReturnedAt = new Date();
    purchaseOrder.auditReturnComments = req.body.returnComments || '';
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('auditReturnedBy', 'firstName lastName email')
      .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature');
    res.json({
      success: true,
      message: 'Purchase order returned from audit successfully',
      data: updatedOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/forward-to-ceo
// @desc    CEO Coordinator forwards PO to CEO (status -> Forwarded to CEO)
// @access  Private (Super Admin, Admin, HR Manager / CEO Coordinator)
router.put('/purchase-orders/:id/forward-to-ceo',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    const assignedAuthorityAccess =
      await isAssignedComparativeAuthorityUser(purchaseOrder.indent, req.user.id) ||
      isAssignedByAuthorityText(purchaseOrder.approvalAuthorities, req.user, purchaseOrder.createdAt);
    if (!hasCeoSecretariatAccess(req.user) && !assignedAuthorityAccess) {
      return res.status(403).json({ success: false, message: 'CEO Secretariat access required' });
    }
    if (!['Send to CEO Office', 'Returned from CEO Office'].includes(purchaseOrder.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only POs in Send to CEO Office or Returned from CEO Office can be forwarded to CEO'
      });
    }
    const ceoSecretariatForwardAt = new Date();
    pushPOWorkflowHistory(purchaseOrder, purchaseOrder.status, 'Forwarded to CEO', req.user.id, 'Forwarded to CEO for approval', 'CEO Secretariat');
    purchaseOrder.status = 'Forwarded to CEO';
    purchaseOrder.ceoForwardedBy = req.user.id;
    purchaseOrder.ceoForwardedAt = ceoSecretariatForwardAt;
    upsertPOAuthorityApproval(purchaseOrder, {
      key: 'ceoSecretariatForward',
      label: 'CEO Secretariat',
      approverId: req.user.id,
      approvedAt: ceoSecretariatForwardAt,
      comments: req.body.comments || 'Forwarded to CEO for approval'
    });
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('ceoForwardedBy', 'firstName lastName email');

    const ceoRecipients = await getCeoRecipients();
    await notifyDocumentRecipients({
      recipientIds: ceoRecipients,
      actorId: req.user.id,
      title: 'PO pending CEO approval',
      message: `Purchase Order ${purchaseOrder.orderNumber || purchaseOrder.poNumber || ''} is forwarded to CEO and awaiting approval action.`,
      actionUrl: '/general/ceo-secretariat/payments',
      entityId: purchaseOrder._id,
      entityType: 'PurchaseOrder',
      module: 'procurement',
      metadata: {
        queueStage: 'forwarded_to_ceo',
        targetModule: 'procurement',
        targetTab: 'ceo_approval'
      }
    });
    notifyApprovers(ceoRecipients, { docType: 'Purchase Order', docNumber: purchaseOrder.orderNumber || purchaseOrder.poNumber || '', fromUser: req.user }).catch(() => {});
    notifyChatApprovers(ceoRecipients, { docType: 'Purchase Order', docNumber: purchaseOrder.orderNumber || purchaseOrder.poNumber || '', url: '/dashboard', fromUser: req.user }).catch(() => {});

    res.json({
      success: true,
      message: 'Purchase order forwarded to CEO successfully',
      data: updatedOrder
    });
  })
);

// Helper: check if payment terms require Finance (advance or partial advance)
function isAdvanceOrPartialAdvance(paymentTerms) {
  const terms = (paymentTerms || '').toLowerCase().trim();
  if (!terms) return false;
  return terms.includes('advance') || terms.includes('partial advance');
}

function isFullAdvance(paymentTerms) {
  const terms = (paymentTerms || '').toLowerCase().trim();
  if (!terms) return false;
  return terms.includes('full advance') || (terms.includes('advance') && !terms.includes('partial'));
}

function buildBillNumber(prefix = 'BILL') {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}-${y}${m}-${rand}`;
}

function computeDueDateFromTerms(billDate, paymentTerms) {
  const base = new Date(billDate || new Date());
  base.setHours(0, 0, 0, 0);
  const term = String(paymentTerms || 'net_30').toLowerCase();
  if (term === 'due_on_receipt') return base;
  const map = { net_15: 15, net_30: 30, net_45: 45, net_60: 60 };
  const days = map[term] || 30;
  const due = new Date(base);
  due.setDate(due.getDate() + days);
  return due;
}

// @route   PUT /api/procurement/purchase-orders/:id/ceo-approve
// @desc    CEO approves PO. If payment terms are Advance/Partial Advance -> status Pending Finance; else -> Approved
// @access  Private (Super Admin, Admin, Higher Management / CEO)
router.put('/purchase-orders/:id/ceo-approve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { approvalComments, digitalSignature } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id).populate('vendor');
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (!isDesignatedCeoApprover(req.user)) {
      return res.status(403).json({ success: false, message: 'CEO approval access required' });
    }
    if (purchaseOrder.status !== 'Forwarded to CEO') {
      return res.status(400).json({
        success: false,
        message: 'Only POs in Forwarded to CEO can be approved by CEO'
      });
    }

    const sendToFinance = isAdvanceOrPartialAdvance(purchaseOrder.paymentTerms);
    const nextStatus = sendToFinance ? 'Pending Finance' : 'Approved';

    pushPOWorkflowHistory(purchaseOrder, 'Forwarded to CEO', nextStatus, req.user.id, approvalComments || '', 'CEO Secretariat');
    const ceoApprovedAt = new Date();
    purchaseOrder.status = nextStatus;
    purchaseOrder.ceoApprovedBy = req.user.id;
    purchaseOrder.ceoApprovedAt = ceoApprovedAt;
    purchaseOrder.ceoApprovalComments = approvalComments || '';
    purchaseOrder.ceoDigitalSignature = digitalSignature || '';
    upsertPOAuthorityApproval(purchaseOrder, {
      key: 'ceoApproval',
      label: 'CEO',
      approverId: req.user.id,
      approvedAt: ceoApprovedAt,
      comments: approvalComments || 'Approved by CEO'
    });
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();

    if (sendToFinance) {
      const isVendorAdvanceFlow = isFullAdvance(purchaseOrder.paymentTerms);
      const financeRecipients = await getFinanceWorkflowRecipients();
      await notifyDocumentRecipients({
        recipientIds: financeRecipients,
        actorId: req.user.id,
        title: 'Purchase Order moved to Finance',
        message: `Purchase Order ${purchaseOrder.orderNumber || purchaseOrder.poNumber || ''} is approved by CEO and now waiting in Finance queue.`,
        actionUrl: isVendorAdvanceFlow ? '/finance/vendor-advance' : '/finance/accounts-payable',
        entityId: purchaseOrder._id,
        entityType: 'PurchaseOrder',
        module: 'finance',
        metadata: {
          queueStage: 'pending_finance',
          targetModule: 'finance',
          targetTab: isVendorAdvanceFlow ? 'vendor-advance' : 'accounts-payable'
        }
      });
      notifyApprovers(financeRecipients, { docType: 'Purchase Order', docNumber: purchaseOrder.orderNumber || purchaseOrder.poNumber || '', fromUser: req.user }).catch(() => {});
      notifyChatApprovers(financeRecipients, { docType: 'Purchase Order', docNumber: purchaseOrder.orderNumber || purchaseOrder.poNumber || '', url: '/finance', fromUser: req.user }).catch(() => {});
    } else {
      const procurementRecipients = await getProcurementWorkflowRecipients();
      await notifyDocumentRecipients({
        recipientIds: procurementRecipients,
        actorId: req.user.id,
        title: 'Purchase Order approved by CEO',
        message: `Purchase Order ${purchaseOrder.orderNumber || purchaseOrder.poNumber || ''} is approved by CEO and returned to Procurement flow.`,
        actionUrl: '/procurement/purchase-orders',
        entityId: purchaseOrder._id,
        entityType: 'PurchaseOrder',
        module: 'procurement',
        metadata: {
          queueStage: 'approved',
          targetModule: 'procurement',
          targetTab: 'purchase-orders'
        }
      });
    }

    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('ceoApprovedBy', 'firstName lastName email digitalSignature');
    res.json({
      success: true,
      message: sendToFinance
        ? 'Purchase order approved by CEO and sent to Finance (advance/partial advance terms)'
        : 'Purchase order approved by CEO successfully',
      data: updatedOrder,
      sentToFinance: sendToFinance
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/ceo-reject
// @desc    CEO rejects PO (status -> Rejected)
// @access  Private (Super Admin, Admin, Higher Management / CEO)
router.put('/purchase-orders/:id/ceo-reject',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { rejectionComments, comments, digitalSignature, observations } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (!isDesignatedCeoApprover(req.user)) {
      return res.status(403).json({ success: false, message: 'CEO rejection access required' });
    }
    if (purchaseOrder.status !== 'Forwarded to CEO') {
      return res.status(400).json({
        success: false,
        message: 'Only POs in Forwarded to CEO can be rejected by CEO'
      });
    }
    const rejectText = rejectionComments || comments || '';
    pushPOWorkflowHistory(purchaseOrder, 'Forwarded to CEO', 'Rejected', req.user.id, rejectText, 'CEO Secretariat');
    purchaseOrder.status = 'Rejected';
    purchaseOrder.ceoRejectedBy = req.user.id;
    purchaseOrder.ceoRejectedAt = new Date();
    purchaseOrder.ceoRejectionComments = rejectText;
    purchaseOrder.ceoDigitalSignature = digitalSignature || '';
    if (observations && Array.isArray(observations) && observations.length > 0) {
      purchaseOrder.observations = purchaseOrder.observations || [];
      observations.forEach((obs) => {
        const text = obs.observation || obs.text || obs;
        if (!text) return;
        purchaseOrder.observations.push({
          observation: text,
          severity: obs.severity || 'medium',
          addedBy: req.user.id,
          addedAt: new Date(),
          resolved: false
        });
      });
    }
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    res.json({
      success: true,
      message: 'Purchase order rejected by CEO successfully',
      data: purchaseOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/ceo-return
// @desc    CEO returns PO (status -> Returned from CEO Office)
// @access  Private (Super Admin, Admin, Higher Management / CEO)
router.put('/purchase-orders/:id/ceo-return',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { returnComments, digitalSignature } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (!isDesignatedCeoApprover(req.user)) {
      return res.status(403).json({ success: false, message: 'CEO return access required' });
    }
    if (purchaseOrder.status !== 'Forwarded to CEO') {
      return res.status(400).json({
        success: false,
        message: 'Only POs in Forwarded to CEO can be returned by CEO'
      });
    }
    pushPOWorkflowHistory(purchaseOrder, 'Forwarded to CEO', 'Returned from CEO Office', req.user.id, returnComments || '', 'CEO Secretariat');
    purchaseOrder.status = 'Returned from CEO Office';
    purchaseOrder.ceoReturnedBy = req.user.id;
    purchaseOrder.ceoReturnedAt = new Date();
    purchaseOrder.ceoReturnComments = returnComments || '';
    purchaseOrder.ceoDigitalSignature = digitalSignature || '';
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    res.json({
      success: true,
      message: 'Purchase order returned by CEO successfully',
      data: purchaseOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/finance-approve
// @desc    Finance approves PO that was sent from CEO (status Pending Finance -> Approved)
// @access  Private (Super Admin, Admin, Finance Manager)
router.put('/purchase-orders/:id/finance-approve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { approvalComments } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id).populate('vendor');
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    const assignedAuthorityAccess =
      await isAssignedComparativeAuthorityUser(purchaseOrder.indent, req.user.id) ||
      isAssignedByAuthorityText(purchaseOrder.approvalAuthorities, req.user, purchaseOrder.createdAt);
    if (!hasFinanceAccess(req.user) && !assignedAuthorityAccess) {
      return res.status(403).json({ success: false, message: 'Finance approval access required' });
    }
    if (purchaseOrder.status !== 'Pending Finance') {
      return res.status(400).json({
        success: false,
        message: 'Only POs in Pending Finance can be approved by Finance'
      });
    }
    if (isFullAdvance(purchaseOrder.paymentTerms)) {
      return res.status(400).json({
        success: false,
        message: 'Full-advance PO is auto-approved after recording vendor advance payment'
      });
    }
    pushPOWorkflowHistory(purchaseOrder, 'Pending Finance', 'Approved', req.user.id, approvalComments || 'Approved by Finance', 'Finance');
    purchaseOrder.status = 'Approved';
    purchaseOrder.financeApprovedBy = req.user.id;
    purchaseOrder.financeApprovedAt = new Date();
    purchaseOrder.financeRemarks = approvalComments || '';
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();

    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('financeApprovedBy', 'firstName lastName email digitalSignature');
    res.json({
      success: true,
      message: 'Purchase order approved by Finance successfully',
      data: updatedOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/finance-return
// @desc    Finance module returns PO to procurement with observations/comments (status -> Returned from Finance)
// @access  Private (Super Admin, Admin, Finance Manager)
router.put('/purchase-orders/:id/finance-return',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { returnComments, observations } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    const assignedAuthorityAccess =
      await isAssignedComparativeAuthorityUser(purchaseOrder.indent, req.user.id) ||
      isAssignedByAuthorityText(purchaseOrder.approvalAuthorities, req.user, purchaseOrder.createdAt);
    if (!hasFinanceAccess(req.user) && !assignedAuthorityAccess) {
      return res.status(403).json({ success: false, message: 'Finance access required' });
    }
    if (!['Pending Finance', 'Sent to Finance'].includes(purchaseOrder.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only purchase orders in Pending Finance or Sent to Finance can be returned by Finance'
      });
    }

    // Save snapshot before return if not already created
    purchaseOrder.auditSnapshotAtReturn = snapshotPOItemsAndTotals(purchaseOrder);

    // If observations were provided by Finance, add them to auditObservations array
    if (Array.isArray(observations) && observations.length > 0) {
      observations.forEach(obs => {
        const obsText = typeof obs === 'string' ? obs : obs.observation;
        if (obsText && obsText.trim()) {
          purchaseOrder.auditObservations.push({
            observation: obsText.trim(),
            severity: obs.severity || 'medium',
            addedBy: req.user.id,
            addedAt: new Date()
          });
        }
      });
    }

    pushPOWorkflowHistory(purchaseOrder, purchaseOrder.status, 'Returned from Finance', req.user.id, returnComments || 'Returned by Finance with observations', 'Finance');
    purchaseOrder.status = 'Returned from Finance';
    purchaseOrder.financeReturnedBy = req.user.id;
    purchaseOrder.financeReturnedAt = new Date();
    purchaseOrder.financeReturnComments = returnComments || '';
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();

    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('financeReturnedBy', 'firstName lastName email')
      .populate('workflowHistory.changedBy', 'firstName lastName email digitalSignature');

    res.json({
      success: true,
      message: 'Purchase order returned to Procurement by Finance successfully',
      data: updatedOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/ceo-secretariat-reject
// @desc    CEO Coordinator rejects PO from CEO Secretariat (status -> Rejected)
// @access  Private (Super Admin, Admin, HR Manager / CEO Coordinator)
router.put('/purchase-orders/:id/ceo-secretariat-reject',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { rejectionComments, digitalSignature, observations } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    const assignedAuthorityAccess =
      await isAssignedComparativeAuthorityUser(purchaseOrder.indent, req.user.id) ||
      isAssignedByAuthorityText(purchaseOrder.approvalAuthorities, req.user, purchaseOrder.createdAt);
    if (!hasCeoSecretariatAccess(req.user) && !assignedAuthorityAccess) {
      return res.status(403).json({ success: false, message: 'CEO Secretariat access required' });
    }
    if (purchaseOrder.status !== 'Send to CEO Office') {
      return res.status(400).json({
        success: false,
        message: 'Only POs in Send to CEO Office can be rejected by CEO Secretariat'
      });
    }
    pushPOWorkflowHistory(purchaseOrder, 'Send to CEO Office', 'Rejected', req.user.id, rejectionComments || '', 'CEO Secretariat');
    purchaseOrder.status = 'Rejected';
    purchaseOrder.ceoRejectedBy = req.user.id;
    purchaseOrder.ceoRejectedAt = new Date();
    purchaseOrder.ceoRejectionComments = rejectionComments || '';
    purchaseOrder.ceoDigitalSignature = digitalSignature || '';
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    res.json({
      success: true,
      message: 'Purchase order rejected by CEO Secretariat successfully',
      data: purchaseOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/ceo-secretariat-return
// @desc    CEO Coordinator returns PO to procurement (status -> Returned from CEO Secretariat)
// @access  Private (Super Admin, Admin, HR Manager / CEO Coordinator)
router.put('/purchase-orders/:id/ceo-secretariat-return',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { returnComments, digitalSignature, observations } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    const assignedAuthorityAccess =
      await isAssignedComparativeAuthorityUser(purchaseOrder.indent, req.user.id) ||
      isAssignedByAuthorityText(purchaseOrder.approvalAuthorities, req.user, purchaseOrder.createdAt);
    if (!hasCeoSecretariatAccess(req.user) && !assignedAuthorityAccess) {
      return res.status(403).json({ success: false, message: 'CEO Secretariat access required' });
    }
    if (purchaseOrder.status !== 'Send to CEO Office') {
      return res.status(400).json({
        success: false,
        message: 'Only POs in Send to CEO Office can be returned by CEO Secretariat'
      });
    }
    pushPOWorkflowHistory(purchaseOrder, 'Send to CEO Office', 'Returned from CEO Secretariat', req.user.id, returnComments || '', 'CEO Secretariat');
    purchaseOrder.status = 'Returned from CEO Secretariat';
    purchaseOrder.ceoReturnedBy = req.user.id;
    purchaseOrder.ceoReturnedAt = new Date();
    purchaseOrder.ceoReturnComments = returnComments || '';
    purchaseOrder.ceoDigitalSignature = digitalSignature || '';
    purchaseOrder.updatedBy = req.user.id;
    await purchaseOrder.save();
    res.json({
      success: true,
      message: 'Purchase order returned to procurement by CEO Secretariat successfully',
      data: purchaseOrder
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/send-to-store
// @desc    Send approved PO to Store (status -> Sent to Store)
// @access  Private (Procurement and Admin)
router.put('/purchase-orders/:id/send-to-store',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const { comments } = req.body;
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (purchaseOrder.status !== 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved purchase orders can be sent to store'
      });
    }
    pushPOWorkflowHistory(purchaseOrder, 'Approved', 'Sent to Store', req.user.id, comments || '', 'Procurement');
    purchaseOrder.status = 'Sent to Store';
    purchaseOrder.updatedBy = req.user.id;
    if (comments) {
      purchaseOrder.internalNotes = (purchaseOrder.internalNotes || '') + (purchaseOrder.internalNotes ? '\n' : '') + `Sent to Store: ${comments}`;
    }
    await purchaseOrder.save();
    
    const updatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('updatedBy', 'firstName lastName email');

    await notifyStoreUsers({
      actorId: req.user.id,
      title: 'PO sent to Store',
      message: `Purchase Order ${purchaseOrder.poNumber || ''} is awaiting store action.`,
      actionUrl: STORE_SUBMODULE_ROUTES.dashboard,
      entityId: purchaseOrder._id,
      entityType: 'PurchaseOrder'
    });
    
    res.json({
      success: true,
      message: 'Purchase order sent to store successfully',
      data: updatedOrder
    });
  })
);

// Helper: match indent item to store inventory by name (and optionally unit). Returns best match or null.
function matchIndentItemToInventory(indentItem, inventoryList) {
  const itemName = (indentItem.itemName || '').trim();
  const itemNameNorm = itemName.toLowerCase();
  const itemUnit = (indentItem.unit || '').trim().toLowerCase();
  if (!itemNameNorm) return null;

  const candidates = inventoryList.filter((inv) => {
    const invName = (inv.name || '').trim().toLowerCase();
    if (!invName) return false;
    // Exact match (case-insensitive)
    if (invName === itemNameNorm) return true;
    // One contains the other (e.g. "chair" vs "chairs", "office chair")
    if (invName.includes(itemNameNorm) || itemNameNorm.includes(invName)) return true;
    // Optional: same word when singular/plural normalized (e.g. remove trailing 's')
    const invBase = invName.replace(/\s*s$/, '');
    const itemBase = itemNameNorm.replace(/\s*s$/, '');
    if (invBase === itemBase || invName === itemBase || itemNameNorm === invBase) return true;
    return false;
  });

  if (candidates.length === 0) return null;
  // Prefer exact name match, then same unit, then by available quantity (desc)
  const exact = candidates.find((c) => (c.name || '').trim().toLowerCase() === itemNameNorm);
  if (exact) return exact;
  const sameUnit = itemUnit ? candidates.filter((c) => (c.unit || '').trim().toLowerCase() === itemUnit) : candidates;
  const list = sameUnit.length ? sameUnit : candidates;
  list.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
  return list[0];
}

// @route   GET /api/procurement/store/pending-indents
// @desc    Get approved indents pending store stock check; each indent item enriched with inventory match and inStock flag
// @access  Private (Procurement, Admin, Store Manager)
router.get('/store/pending-indents',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const indents = await Indent.find({
      status: 'Approved',
      storeRoutingStatus: 'pending_store_check',
      isActive: true
    })
      .populate('department', 'name code')
      .populate('companyId', 'name code symbol')
      .populate('requestedBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName email')
      .sort({ approvedDate: -1, createdAt: -1 })
      .lean();

    const inventoryList = await Inventory.find({})
      .select('_id itemCode name quantity unit')
      .lean();

    const enriched = indents.map((indent) => {
      const items = (indent.items || []).map((item) => {
        const inv = matchIndentItemToInventory(item, inventoryList);
        const requiredQty = Number(item.quantity) || 0;
        const availableQty = inv ? (Number(inv.quantity) || 0) : 0;
        const inStock = inv && availableQty >= requiredQty;
        return {
          ...item,
          inventoryMatch: inv ? { _id: inv._id, itemCode: inv.itemCode, name: inv.name, quantity: inv.quantity, unit: inv.unit } : null,
          inStock: !!inStock,
          availableQuantity: availableQty
        };
      });
      const allInStock = items.length > 0 && items.every((i) => i.inStock);
      const someInStock = items.some((i) => i.inStock);
      return {
        ...indent,
        items,
        allItemsInStock: allInStock,
        someItemsInStock: someInStock
      };
    });

    res.json({
      success: true,
      data: enriched
    });
  })
);

// @route   GET /api/procurement/store/dashboard
// @desc    Get Purchase Orders available for GRN workflow grouped by month/year
// @access  Private (Procurement, Admin, Store Manager)
// @route   GET /api/procurement/store/stock-kpis
// @desc    Store Dashboard numbers: stock value by project, low / out of stock, receiving & issuing activity
router.get('/store/stock-kpis',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
    const StoreReturn = require('../models/procurement/StoreReturn');
    const { findStockMismatches } = require('../utils/inventoryMovements');
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

    const [byProject, lowStock, outOfStock, totalItems, poAwaiting, dcQaPending, grnMonth, sinToday, sinMonth, srnMonth, customerSins, mismatches, recent] = await Promise.all([
      // Stock value per project: ledger qty per project + item × the item's average cost
      StockTransaction.aggregate([
        { $group: { _id: { project: '$project', item: '$item' }, qty: { $sum: '$quantity' } } },
        { $match: { qty: { $gt: 0 } } },
        { $lookup: { from: 'inventories', localField: '_id.item', foreignField: '_id', as: 'inv' } },
        { $unwind: '$inv' },
        { $project: { project: '$_id.project', qty: 1, value: { $multiply: ['$qty', { $cond: [{ $gt: ['$inv.averageCost', 0] }, '$inv.averageCost', { $ifNull: ['$inv.unitPrice', 0] }] }] } } },
        { $group: { _id: '$project', value: { $sum: '$value' }, items: { $sum: 1 } } },
        { $lookup: { from: 'projects', localField: '_id', foreignField: '_id', as: 'p' } },
        { $project: { project: { $ifNull: [{ $arrayElemAt: ['$p.name', 0] }, '—'] }, value: 1, items: 1 } },
        { $sort: { value: -1 } }
      ]),
      Inventory.find({ minQuantity: { $gt: 0 }, $expr: { $lte: ['$quantity', '$minQuantity'] } })
        .select('itemCode name unit quantity minQuantity').sort({ quantity: 1 }).limit(10).lean(),
      Inventory.countDocuments({ quantity: { $lte: 0 } }),
      Inventory.countDocuments({}),
      PurchaseOrder.countDocuments({ status: { $in: ['Sent to Store', 'GRN Created', 'Partially Received'] } }),
      DeliveryChallan.countDocuments({ status: 'qa_pending' }),
      GoodsReceive.countDocuments({ receiveDate: { $gte: startOfMonth } }),
      GoodsIssue.countDocuments({ status: 'Issued', issueDate: { $gte: startOfDay } }),
      GoodsIssue.countDocuments({ status: 'Issued', issueDate: { $gte: startOfMonth } }),
      StoreReturn.countDocuments({ returnDate: { $gte: startOfMonth } }),
      GoodsIssue.find({ status: 'Issued', issueType: 'customer' }).select('_id items').lean(),
      findStockMismatches(),
      StockTransaction.find({}).populate('project', 'name').sort({ createdAt: -1 }).limit(8)
        .select('createdAt itemName itemCode quantity unit referenceType referenceNumber project storeSnapshot').lean()
    ]);
    const lowStockCount = await Inventory.countDocuments({ minQuantity: { $gt: 0 }, $expr: { $lte: ['$quantity', '$minQuantity'] } });

    // Customer SINs with qty not yet on an AR invoice
    let customerSinsToInvoice = 0;
    if (customerSins.length) {
      const AccountsReceivable = require('../models/finance/AccountsReceivable');
      const invoiced = await AccountsReceivable.aggregate([
        { $match: { 'lineItems.sourceSin': { $in: customerSins.map((x) => x._id) }, status: { $ne: 'cancelled' } } },
        { $unwind: '$lineItems' },
        { $group: { _id: '$lineItems.sourceSin', qty: { $sum: '$lineItems.quantity' } } }
      ]);
      const invMap = new Map(invoiced.map((x) => [String(x._id), x.qty]));
      customerSinsToInvoice = customerSins.filter((x) => {
        const net = (x.items || []).reduce((t, it) => t + (Number(it.qtyIssued ?? it.quantity) || 0) - (Number(it.qtyReturnedToStore) || 0), 0);
        return net - (invMap.get(String(x._id)) || 0) > 1e-9;
      }).length;
    }

    res.json({
      success: true,
      data: {
        stockValue: r2(byProject.reduce((t, p) => t + p.value, 0)),
        stockByProject: byProject.map((p) => ({ project: p.project, value: r2(p.value), items: p.items })),
        totalItems,
        lowStockCount,
        lowStock,
        outOfStock,
        poAwaitingReceipt: poAwaiting,
        dcQaPending,
        grnThisMonth: grnMonth,
        sinToday,
        sinThisMonth: sinMonth,
        returnsThisMonth: srnMonth,
        customerSinsToInvoice,
        stockCheckMismatches: mismatches.length,
        recentMovements: recent
      }
    });
  })
);

router.get('/store/dashboard',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    try {
      // Include partially received POs too so additional GRNs can be created until fully received
      const purchaseOrders = await PurchaseOrder.find({ status: { $in: ['Sent to Store', 'GRN Created', 'Partially Received'] } })
        .populate('vendor', 'name email phone contactPerson')
        .populate('createdBy', 'firstName lastName email')
        .populate('updatedBy', 'firstName lastName email')
        .populate('qaCheckedBy', 'firstName lastName')
        .populate('indent', 'indentNumber title')
        .sort({ updatedAt: -1 })
        .lean();

      const poIds = purchaseOrders.map((p) => p._id);
      const dcAgg = poIds.length
        ? await DeliveryChallan.aggregate([
            { $match: { purchaseOrder: { $in: poIds } } },
            {
              $group: {
                _id: '$purchaseOrder',
                qaPassed: { $sum: { $cond: [{ $eq: ['$status', 'qa_passed'] }, 1, 0] } },
                qaPending: { $sum: { $cond: [{ $eq: ['$status', 'qa_pending'] }, 1, 0] } }
              }
            }
          ])
        : [];
      const dcByPo = {};
      dcAgg.forEach((row) => {
        dcByPo[String(row._id)] = {
          qaPassed: row.qaPassed || 0,
          qaPending: row.qaPending || 0
        };
      });
      purchaseOrders.forEach((po) => {
        po.grnRequiresDeliveryChallan = requiresDeliveryChallanFlow(po);
        const d = dcByPo[String(po._id)] || { qaPassed: 0, qaPending: 0 };
        po.qaPassedDeliveryChallanCount = d.qaPassed;
        po.dcPendingQaCount = d.qaPending;
      });

      // Group by month/year
      const groupedByMonth = {};
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December'];

      purchaseOrders.forEach(po => {
        const date = new Date(po.updatedAt || po.createdAt);
        const year = date.getFullYear();
        const month = date.getMonth(); // 0-11
        const monthYear = `${year}-${String(month + 1).padStart(2, '0')}`;
        const monthYearLabel = `${monthNames[month]} ${year}`;

        if (!groupedByMonth[monthYear]) {
          groupedByMonth[monthYear] = {
            monthYear,
            monthYearLabel,
            month,
            year,
            purchaseOrders: [],
            totalAmount: 0,
            count: 0
          };
        }

        groupedByMonth[monthYear].purchaseOrders.push(po);
        groupedByMonth[monthYear].totalAmount += po.totalAmount || 0;
        groupedByMonth[monthYear].count += 1;
      });

      // Convert to array and sort by date (newest first)
      const groupedArray = Object.values(groupedByMonth).sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

      // Calculate totals
      const totalCount = purchaseOrders.length;
      const totalAmount = purchaseOrders.reduce((sum, po) => sum + (po.totalAmount || 0), 0);

      res.json({
        success: true,
        data: {
          groupedByMonth: groupedArray,
          summary: {
            totalCount,
            totalAmount
          }
        }
      });
    } catch (error) {
      console.error('Error fetching store dashboard data:', error);
      throw error;
    }
  })
);

// @route   GET /api/procurement/store/purchase-orders-for-dc-create
// @desc    Full-advance POs that may receive new delivery challans (no PO-level QA).
// @access  Private (Procurement, Admin, Store Manager)
router.get('/store/purchase-orders-for-dc-create',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const raw = await PurchaseOrder.find({
      status: { $in: ['Sent to Store', 'GRN Created', 'Partially Received', 'Approved', 'Ordered', 'Received'] }
    })
      .populate('vendor', 'name email phone contactPerson')
      .populate('indent', 'indentNumber title')
      .sort({ updatedAt: -1 })
      .limit(400)
      .lean();

    const purchaseOrders = raw.filter((po) => {
      if (!isFullAdvancePaymentTerm(po.paymentTerms)) return false;
      const dcSt = purchaseOrderOpenForDeliveryChallan(po);
      return dcSt.ok;
    });

    res.json({
      success: true,
      data: { purchaseOrders }
    });
  })
);

// @route   GET /api/procurement/store/grn-prefill-purchase-orders
// @desc    POs that can be selected to prefill GRN (no PO QA gate; full-advance still uses DC on form).
// @access  Private (Procurement, Admin, Store Manager)
router.get('/store/grn-prefill-purchase-orders',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const purchaseOrders = await PurchaseOrder.find({
      status: { $in: ['Sent to Store', 'GRN Created', 'Partially Received'] }
    })
      .select('orderNumber poNumber status paymentTerms totalAmount vendor')
      .populate('vendor', 'name')
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean();

    purchaseOrders.forEach((po) => {
      po.grnRequiresDeliveryChallan = requiresDeliveryChallanFlow(po);
    });

    res.json({
      success: true,
      data: { purchaseOrders }
    });
  })
);

// @route   POST /api/procurement/store/po/:id/send-to-procurement
// @desc    Send PO (with GRN) back to Procurement from Store
// @access  Private (Procurement, Admin, Store Manager)
router.post('/store/po/:id/send-to-procurement',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (po.status !== 'GRN Created') {
      return res.status(400).json({
        success: false,
        message: 'Only purchase orders with status "GRN Created" can be sent to Procurement'
      });
    }
    const previousStatus = po.status;
    po.status = 'Sent to Procurement';
    po.updatedBy = req.user.id;
    po.workflowHistory = po.workflowHistory || [];
    po.workflowHistory.push({
      fromStatus: previousStatus,
      toStatus: 'Sent to Procurement',
      changedBy: req.user.id,
      changedAt: new Date(),
      comments: 'Sent to Procurement from Store (GRN attached)',
      module: 'Store'
    });
    await po.save();
    await po.populate('vendor', 'name email phone contactPerson');
    await po.populate('indent', 'indentNumber title');
    const procurementRecipients = await getUserIdsByRoles(['procurement_manager', 'admin', 'super_admin']);
    await notifyDocumentRecipients({
      recipientIds: procurementRecipients,
      actorId: req.user.id,
      title: 'PO sent to Procurement',
      message: `Purchase Order ${po.poNumber || ''} has been sent from Store to Procurement.`,
      actionUrl: '/procurement/purchase-orders',
      entityId: po._id,
      entityType: 'PurchaseOrder',
      module: 'procurement'
    });
    res.json({
      success: true,
      message: 'Purchase order sent to Procurement with GRN',
      data: po
    });
  })
);

// @route   POST /api/procurement/store/po/:id/send-to-audit
// @desc    Send PO (with GRN) from Procurement to Audit for review before Finance
// @access  Private (Procurement, Admin)
router.post('/store/po/:id/send-to-audit',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (po.status !== 'Sent to Procurement') {
      return res.status(400).json({
        success: false,
        message: 'Only purchase orders with status "Sent to Procurement" can be sent to Audit'
      });
    }
    const previousStatus = po.status;
    po.status = 'Sent to Audit';
    po.sentToPostGrnAuditBy = req.user.id;
    po.sentToPostGrnAuditAt = new Date();
    po.updatedBy = req.user.id;
    po.workflowHistory = po.workflowHistory || [];
    po.workflowHistory.push({
      fromStatus: previousStatus,
      toStatus: 'Sent to Audit',
      changedBy: req.user.id,
      changedAt: new Date(),
      comments: req.body.comments || 'Sent to Audit for post-GRN review (Indent, Quotations, Comparative Statement, PO, GRN attached)',
      module: 'Procurement'
    });
    await po.save();
    await po.populate('vendor', 'name email phone contactPerson');
    await po.populate('indent', 'indentNumber title');
    const auditRecipients = await getUserIdsByRoles(['audit_manager', 'admin', 'super_admin']);
    await notifyDocumentRecipients({
      recipientIds: auditRecipients,
      actorId: req.user.id,
      title: 'PO sent to Audit',
      message: `Purchase Order ${po.poNumber || ''} requires your audit review.`,
      actionUrl: '/audit',
      entityId: po._id,
      entityType: 'PurchaseOrder',
      module: 'procurement'
    });
    res.json({
      success: true,
      message: 'Purchase order sent to Audit for review',
      data: po
    });
  })
);

// @route   POST /api/procurement/store/po/:id/send-to-finance
// @desc    Send PO (with GRN) from Audit to Finance for billing
// @access  Private (Audit Manager, Admin)
router.post('/store/po/:id/send-to-finance',
  authorize('super_admin', 'admin', 'audit_manager', 'procurement_manager', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    if (po.status !== 'Sent to Audit') {
      return res.status(400).json({
        success: false,
        message: 'Only purchase orders with status "Sent to Audit" can be sent to Finance'
      });
    }
    const previousStatus = po.status;
    po.status = 'Sent to Finance';
    po.postGrnAuditForwardedBy = req.user.id;
    po.postGrnAuditForwardedAt = new Date();
    po.postGrnAuditComments = req.body.comments || '';
    po.updatedBy = req.user.id;
    po.workflowHistory = po.workflowHistory || [];
    po.workflowHistory.push({
      fromStatus: previousStatus,
      toStatus: 'Sent to Finance',
      changedBy: req.user.id,
      changedAt: new Date(),
      comments: req.body.comments || 'Sent to Finance for billing after Audit review (Indent, Quotations, Comparative Statement, PO, GRN attached)',
      module: 'Audit'
    });
    await po.save();
    await po.populate('vendor', 'name email phone contactPerson address');
    await po.populate('indent', 'indentNumber title department requestedBy comparativeStatementApprovals');
    const financeRecipients = await getUserIdsByRoles(['finance_manager', 'admin', 'super_admin']);
    await notifyDocumentRecipients({
      recipientIds: financeRecipients,
      actorId: req.user.id,
      title: 'PO sent to Finance',
      message: `Purchase Order ${po.poNumber || ''} is ready for finance processing.`,
      actionUrl: '/finance/accounts-payable',
      entityId: po._id,
      entityType: 'PurchaseOrder',
      module: 'procurement'
    });
    res.json({
      success: true,
      message: 'Purchase order sent to Finance for billing',
      data: po
    });
  })
);

// @route   PUT /api/procurement/purchase-orders/:id/receive
// @desc    Mark items as received
// @access  Private (Procurement and Admin)
router.put('/purchase-orders/:id/receive', 
  authorize('super_admin', 'admin', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
  
  if (!purchaseOrder) {
    return res.status(404).json({
      success: false,
      message: 'Purchase order not found'
    });
  }

  if (!['Approved', 'Ordered', 'Partially Received'].includes(purchaseOrder.status)) {
    return res.status(400).json({
      success: false,
      message: 'Purchase order must be approved before receiving items'
    });
  }

  // Update received quantities
  req.body.items.forEach((receivedItem, index) => {
    if (purchaseOrder.items[index]) {
      purchaseOrder.items[index].receivedQuantity = receivedItem.receivedQuantity;
    }
  });

  purchaseOrder.receivedBy = req.user.id;
  purchaseOrder.receivedAt = new Date();
  purchaseOrder.updateReceivingStatus();
  
  await purchaseOrder.save();

  res.json({
    success: true,
    message: 'Receiving information updated successfully',
    data: purchaseOrder
  });
}));

// @route   DELETE /api/procurement/purchase-orders/:id
// @desc    Delete purchase order
// @access  Private (Admin only)
router.delete('/purchase-orders/:id', 
  authorize('super_admin', 'admin'), 
  asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    
    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    // Prevent deleting approved or received orders
    if (['Approved', 'Ordered', 'Partially Received', 'Received'].includes(purchaseOrder.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete approved or received purchase orders. Cancel instead.'
      });
    }

    await PurchaseOrder.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Purchase order deleted successfully'
    });
  })
);

// ==================== VENDORS ROUTES ====================

const generateNextSupplierId = async () => {
  const suppliers = await Supplier.find({ supplierId: /^SUP-\d+$/i }).select('supplierId').lean();
  let maxNum = 0;
  for (const s of suppliers) {
    if (s.supplierId) {
      const match = String(s.supplierId).match(/^SUP-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (Number.isFinite(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  let candidateId = `SUP-${String(maxNum + 1).padStart(4, '0')}`;
  let tries = 0;
  while (await Supplier.exists({ supplierId: candidateId }) && tries < 1000) {
    maxNum++;
    candidateId = `SUP-${String(maxNum + 1).padStart(4, '0')}`;
    tries++;
  }

  return candidateId;
};

// @route   GET /api/procurement/vendors
// @desc    Get all vendors (suppliers)
// @access  Private (Procurement and Admin)
router.get('/vendors', 
  authMiddleware, 
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 10, 
      search,
      status,
      category
    } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (category) {
      query.vendorCategory = category;
    }

    const trimmedSearch = search != null ? String(search).trim() : '';
    if (trimmedSearch) {
      // Literal match for all fields, match from the start of any word for name
      const escaped = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordStartRegex = `(^|\\\\W)${escaped}`;
      query.$or = [
        { name: { $regex: wordStartRegex, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { contactPerson: { $regex: escaped, $options: 'i' } },
        { supplierId: { $regex: escaped, $options: 'i' } },
        { vendorCategory: { $regex: escaped, $options: 'i' } },
        { payeeName: { $regex: escaped, $options: 'i' } },
        { ntnCnic: { $regex: escaped, $options: 'i' } },
        { address: { $regex: escaped, $options: 'i' } },
        { notes: { $regex: escaped, $options: 'i' } }
      ];
    }

    const vendors = await Supplier.find(query)
      .populate('createdBy', 'firstName lastName')
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Supplier.countDocuments(query);

    res.json({
      success: true,
      data: {
        vendors,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/procurement/vendors/statistics
// @desc    Get vendor statistics
// @access  Private (Procurement and Admin)
router.get('/vendors/statistics', 
  authorize('super_admin', 'admin', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const totalVendors = await Supplier.countDocuments();
    const activeVendors = await Supplier.countDocuments({ status: 'Active' });
    const inactiveVendors = await Supplier.countDocuments({ status: 'Inactive' });
    
    // Get payment terms breakdown
    const paymentTermsBreakdown = await Supplier.aggregate([
      {
        $group: {
          _id: '$paymentTerms',
          count: { $sum: 1 }
        }
      }
    ]);

    const categoryBreakdown = await Supplier.aggregate([
      {
        $group: {
          _id: { $ifNull: ['$vendorCategory', ''] },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        totalVendors,
        activeVendors,
        inactiveVendors,
        paymentTermsBreakdown,
        categoryBreakdown: categoryBreakdown.map((c) => ({
          category: c._id || 'Uncategorized',
          count: c.count
        }))
      }
    });
  })
);

// @route   GET /api/procurement/vendors/categories
// @desc    Distinct vendor categories (AVL sections)
// @access  Private
router.get('/vendors/categories',
  authorize('super_admin', 'admin', 'procurement_manager', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const raw = await Supplier.distinct('vendorCategory');
    const categories = raw
      .map((c) => (c || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    res.json({ success: true, data: { categories } });
  })
);

// @route   GET /api/procurement/vendors/:id
// @desc    Get vendor by ID
// @access  Private (Procurement and Admin)
router.get('/vendors/:id', 
  authorize('super_admin', 'admin', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const vendor = await Supplier.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    res.json({
      success: true,
      data: vendor
    });
  })
);

// @route   POST /api/procurement/vendors/quick
// @desc    Quick-create vendor (e.g. from centralized store bill form)
// @access  Private
router.post('/vendors/quick', [
  body('name').trim().notEmpty().withMessage('Vendor name is required')
], requireVendorQuickCreateAccess, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0]?.msg || 'Validation failed', errors: errors.array() });
  }

  const slug = String(req.body.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
  const vendor = new Supplier({
    name: req.body.name.trim(),
    contactPerson: (req.body.contactPerson || '—').trim(),
    phone: (req.body.phone || '—').trim(),
    email: (req.body.email || `${slug || 'vendor'}-${Date.now()}@sgc.local`).trim().toLowerCase(),
    address: (req.body.address || '—').trim(),
    paymentTerms: req.body.paymentTerms || 'Cash',
    status: 'Active',
    vendorCategory: req.body.vendorCategory || '',
    notes: req.body.notes || '',
    supplierId: await generateNextSupplierId(),
    createdBy: req.user.id || req.user._id
  });

  await vendor.save();
  const populatedVendor = await Supplier.findById(vendor._id).populate('createdBy', 'firstName lastName');

  res.status(201).json({
    success: true,
    message: 'Vendor created successfully',
    data: populatedVendor
  });
}));

// @route   POST /api/procurement/vendors
// @desc    Create new vendor or subcontractor
// @access  Private
router.post('/vendors', [
  body('name').trim().notEmpty().withMessage('Vendor/Subcontractor name is required'),
  body('contactPerson').optional({ checkFalsy: true }).trim(),
  body('phone').optional({ checkFalsy: true }).trim(),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Valid email address is required'),
  body('address').optional({ checkFalsy: true }).trim()
], authorize('super_admin', 'admin', 'procurement_manager', 'finance_manager', 'project_manager', 'site_engineer', 'hr_manager', 'general_manager', 'director', 'executive'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array().map(e => e.msg).join(', '),
      errors: errors.array()
    });
  }

  const newSupplierId = await generateNextSupplierId();
  const slug = String(req.body.name || 'vendor').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);

  const vendor = new Supplier({
    ...req.body,
    contactPerson: (req.body.contactPerson || '—').trim(),
    phone: (req.body.phone || '—').trim(),
    email: (req.body.email || `${slug || 'vendor'}-${Date.now()}@sgc.local`).trim().toLowerCase(),
    address: (req.body.address || '—').trim(),
    supplierId: newSupplierId,
    createdBy: req.user.id || req.user._id
  });

  await vendor.save();

  const populatedVendor = await Supplier.findById(vendor._id)
    .populate('createdBy', 'firstName lastName');

  res.status(201).json({
    success: true,
    message: 'Vendor created successfully',
    data: populatedVendor
  });
}));

// @route   PUT /api/procurement/vendors/:id
// @desc    Update vendor
// @access  Private
router.put('/vendors/:id', [
  body('name').optional({ checkFalsy: true }).trim().notEmpty().withMessage('Vendor name cannot be empty'),
  body('contactPerson').optional({ checkFalsy: true }).trim(),
  body('phone').optional({ checkFalsy: true }).trim(),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Valid email address is required'),
  body('address').optional({ checkFalsy: true }).trim()
], authorize('super_admin', 'admin', 'procurement_manager', 'finance_manager', 'project_manager', 'site_engineer', 'hr_manager', 'general_manager', 'director', 'executive'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array().map(e => e.msg).join(', '),
      errors: errors.array()
    });
  }

  const vendor = await Supplier.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  ).populate('createdBy', 'firstName lastName');

  if (!vendor) {
    return res.status(404).json({
      success: false,
      message: 'Vendor not found'
    });
  }

  res.json({
    success: true,
    message: 'Vendor updated successfully',
    data: vendor
  });
}));

// @route   DELETE /api/procurement/vendors/:id
// @desc    Delete vendor
// @access  Private (Admin only)
router.delete('/vendors/:id', 
  authorize('super_admin', 'admin'), 
  asyncHandler(async (req, res) => {
    // Check if vendor is used in any purchase orders
    const usedInPO = await PurchaseOrder.findOne({ vendor: req.params.id });
    
    if (usedInPO) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete vendor that has associated purchase orders. Set status to Inactive instead.'
      });
    }

    const vendor = await Supplier.findByIdAndDelete(req.params.id);
    
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    res.json({
      success: true,
      message: 'Vendor deleted successfully'
    });
  })
);

// ==================== INVENTORY ROUTES ====================

// @route   GET /api/procurement/inventory
// @desc    Get all inventory items
// @access  Private (Procurement and Admin)
router.get('/inventory', 
  authorize('super_admin', 'admin', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 10, 
      search,
      category,
      status,
      supplier
    } = req.query;

    const query = {};

    if (category) query.category = category;
    if (req.query.inventoryCategory) query.inventoryCategory = req.query.inventoryCategory;
    if (status) query.status = status;
    if (supplier) query.supplier = supplier;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { itemCode: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const items = await Inventory.find(query)
      .populate('supplier', 'name contactPerson')
      .populate('createdBy', 'firstName lastName')
      .populate('inventoryCategory', 'name stockValuationAccount stockInputAccount stockOutputAccount purchaseAccount salesAccount')
      .populate('inventoryAccount', 'accountNumber name type')
      .populate('grniAccount',      'accountNumber name type')
      .populate('cogsAccount',      'accountNumber name type')
      .populate('salesAccount',     'accountNumber name type')
      .populate('purchaseAccount',  'accountNumber name type')
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Inventory.countDocuments(query);

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/procurement/inventory/statistics
// @desc    Get inventory statistics
// @access  Private (Procurement and Admin)
router.get('/inventory/statistics', 
  authorize('super_admin', 'admin', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const stats = await Inventory.getStatistics();
    
    // Get low stock items
    const lowStockItems = await Inventory.find({ status: 'Low Stock' })
      .limit(10)
      .select('name itemCode quantity minQuantity')
      .sort({ quantity: 1 });

    res.json({
      success: true,
      data: {
        ...stats,
        lowStockItems
      }
    });
  })
);

// @route   GET /api/procurement/inventory/:id
// @desc    Get inventory item by ID
// @access  Private (Procurement and Admin)
router.get('/inventory/:id', 
  authorize('super_admin', 'admin', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const item = await Inventory.findById(req.params.id)
      .populate('supplier', 'name contactPerson email phone')
      .populate('createdBy', 'firstName lastName email')
      .populate('transactions.performedBy', 'firstName lastName')
      .populate('inventoryCategory', 'name stockValuationAccount stockInputAccount stockOutputAccount purchaseAccount salesAccount')
      .populate('inventoryAccount', 'accountNumber name type')
      .populate('grniAccount',      'accountNumber name type')
      .populate('cogsAccount',      'accountNumber name type')
      .populate('salesAccount',     'accountNumber name type')
      .populate('purchaseAccount',  'accountNumber name type');

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    res.json({
      success: true,
      data: item
    });
  })
);

// @route   POST /api/procurement/inventory
// @desc    Create new inventory item
// @access  Private (Procurement and Admin)
router.post('/inventory', [
  body('name').if(body('itemMaster').isEmpty()).trim().notEmpty().withMessage('Item name is required'),
  body('category').optional({ checkFalsy: true }).isIn(['Raw Materials', 'Finished Goods', 'Office Supplies', 'Equipment', 'Consumables', 'Other']).withMessage('Valid category is required'),
  body('unit').trim().notEmpty().withMessage('Unit is required'),
  body('quantity').isFloat({ min: 0 }).withMessage('Quantity must be non-negative'),
  body('unitPrice').isFloat({ min: 0 }).withMessage('Unit price must be non-negative'),
  body('itemCode').optional().trim().isLength({ min: 1, max: 64 }).withMessage('itemCode must be 1–64 characters')
], authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0]?.msg, errors: errors.array()
    });
  }

  // Item Catalog is the item master — a stock card is created for a catalog item (one card per item)
  const { resolveCatalogItem, createUncatalogued } = require('../utils/itemCatalog');
  let catalogItem = null;
  if (req.body.itemMaster) {
    catalogItem = await resolveCatalogItem({ itemMaster: req.body.itemMaster });
    if (!catalogItem) return res.status(400).json({ success: false, message: 'Catalog item not found' });
    const existingCard = await Inventory.findOne({ $or: [{ itemMaster: catalogItem._id }, ...(catalogItem.inventoryItem ? [{ _id: catalogItem.inventoryItem }] : [])] }).select('itemCode').lean();
    if (existingCard) {
      return res.status(400).json({ success: false, message: `${catalogItem.name} already has a stock card (${existingCard.itemCode}) — use Add Stock on it instead` });
    }
    req.body.name = catalogItem.name;
    req.body.itemCode = catalogItem.itemCode;
    if (!req.body.unit && catalogItem.unit) req.body.unit = catalogItem.unit;
  } else if (req.body.name) {
    // Typed a name that is already in the catalog — use that catalog item rather than duplicating it
    const sameName = await resolveCatalogItem({ name: req.body.name });
    if (sameName) {
      const card = await Inventory.findOne({ itemMaster: sameName._id }).select('itemCode').lean();
      if (card) {
        return res.status(400).json({ success: false, message: `${sameName.name} already has a stock card (${card.itemCode}) — use Add Stock on it instead` });
      }
      catalogItem = sameName;
      req.body.itemCode = sameName.itemCode;
    }
  }

  let newItemCode = (req.body.itemCode != null && String(req.body.itemCode).trim() !== '')
    ? String(req.body.itemCode).trim()
    : '';
  if (newItemCode) {
    const taken = await Inventory.findOne({ itemCode: newItemCode });
    if (taken) {
      return res.status(400).json({ success: false, message: 'itemCode already exists' });
    }
  } else {
    const { nextDocumentNumber } = require('../utils/documentSequence');
    newItemCode = await nextDocumentNumber({ key: 'INV-ITEM', model: 'Inventory', field: 'itemCode', prefix: 'INV-', pad: 5 });
  }

  // Opening stock must belong to a project (SIN checks project stock) and is posted like any other stock in
  const openingQty = Number(req.body.quantity) || 0;
  if (openingQty > 0 && !req.body.openingProject) {
    return res.status(400).json({ success: false, message: 'Select the project for the opening stock (or leave quantity 0 and receive stock by GRN)' });
  }

  let normalizedBody = normalizeInventoryObjectIdFields(req.body);
  if (!normalizedBody.inventoryCategory) {
    // Catalog item's Finance Category, else the default category
    const { defaultFinanceCategory } = require('../utils/itemCatalog');
    const def = catalogItem?.inventoryCategory ? { _id: catalogItem.inventoryCategory } : await defaultFinanceCategory();
    if (def) normalizedBody.inventoryCategory = def._id;
  }

  const { openingProject, openingStore, itemMaster: _ignored, ...itemFields } = normalizedBody;
  const item = new Inventory({
    ...itemFields,
    quantity: 0,
    averageCost: 0,
    transactions: [],
    itemCode: newItemCode,
    createdBy: req.user.id,
    lastRestocked: new Date()
  });

  await item.save();

  // Link to the catalog (adding the item to the catalog when it is new, with the same code)
  try {
    if (!catalogItem) catalogItem = await createUncatalogued({ name: item.name, unit: item.unit, itemCode: item.itemCode });
    const ItemMaster = require('../models/general/ItemMaster');
    await Promise.all([
      Inventory.updateOne({ _id: item._id }, { $set: { itemMaster: catalogItem._id } }),
      ItemMaster.updateOne({ _id: catalogItem._id }, { $set: { inventoryItem: item._id, ...(catalogItem.unit ? {} : { unit: item.unit }) } })
    ]);
  } catch (linkErr) {
    console.warn('[Inventory create] catalog link skipped:', linkErr.message);
  }

  let openingResult = null;
  if (openingQty > 0) {
    const { postStockMovement } = require('../utils/inventoryMovements');
    try {
      openingResult = await postStockMovement({
        item, kind: 'opening', qty: openingQty, projectId: openingProject, storeId: openingStore,
        unitCost: Number(req.body.unitPrice) || 0, reference: `OPEN-${item.itemCode}`, reason: 'Opening stock', userId: req.user.id,
        location: req.body.location || {}
      });
    } catch (err) {
      // Item without its opening stock would silently disagree with the project ledger — undo the create
      await Inventory.deleteOne({ _id: item._id });
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  }

  const populatedItem = await Inventory.findById(item._id)
    .populate('supplier', 'name contactPerson')
    .populate('createdBy', 'firstName lastName')
    .populate('inventoryCategory', 'name stockValuationAccount stockInputAccount stockOutputAccount purchaseAccount salesAccount')
    .populate('inventoryAccount', 'accountNumber name type')
    .populate('grniAccount', 'accountNumber name type')
    .populate('cogsAccount', 'accountNumber name type')
    .populate('salesAccount', 'accountNumber name type')
    .populate('purchaseAccount', 'accountNumber name type');

  res.status(201).json({
    success: true,
    message: openingResult
      ? `Item created with opening stock ${openingQty} ${item.unit || ''} in ${openingResult.project} / ${openingResult.store}`
        + (openingResult.finance.status === 'posted' ? '' : ` (no accounting entry: ${openingResult.finance.reason})`)
      : 'Inventory item created successfully',
    data: populatedItem
  });
}));

// @route   PUT /api/procurement/inventory/:id
// @desc    Update inventory item
// @access  Private (Procurement and Admin)
router.put('/inventory/:id', [
  body('name').optional().trim().notEmpty().withMessage('Item name is required'),
  body('category').optional().isIn(['Raw Materials', 'Finished Goods', 'Office Supplies', 'Equipment', 'Consumables', 'Other']).withMessage('Valid category is required'),
  body('unit').optional().trim().notEmpty().withMessage('Unit is required'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('Unit price must be non-negative')
], authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const item = await Inventory.findById(req.params.id);
  if (!item) {
    return res.status(404).json({
      success: false,
      message: 'Inventory item not found'
    });
  }

  const normalizedBody = normalizeInventoryObjectIdFields(req.body);
  // Quantity / cost / value only change through GRN, SIN or the stock buttons, so stock, project ledger
  // and accounts stay equal. Unit price (fallback cost) is editable only while the item has no stock.
  ['quantity', 'averageCost', 'totalValue', 'status', 'transactions', 'itemCode', 'createdBy', 'lastRestocked', 'openingProject', 'openingStore']
    .forEach((k) => delete normalizedBody[k]);
  if (normalizedBody.unitPrice != null && Number(item.quantity) > 0
    && Number(normalizedBody.unitPrice) !== Number(item.unitPrice)) {
    return res.status(400).json({
      success: false,
      message: `Unit price cannot change while ${item.quantity} ${item.unit || ''} are in stock — cost comes from GRN receipts (average cost ${item.averageCost || item.unitPrice})`
    });
  }
  Object.assign(item, normalizedBody);
  item.updatedBy = req.user.id;
  await item.save();

  const updatedItem = await Inventory.findById(item._id)
    .populate('supplier', 'name contactPerson')
    .populate('createdBy', 'firstName lastName')
    .populate('inventoryCategory', 'name stockValuationAccount stockInputAccount stockOutputAccount purchaseAccount salesAccount')
    .populate('inventoryAccount', 'accountNumber name type')
    .populate('grniAccount', 'accountNumber name type')
    .populate('cogsAccount', 'accountNumber name type')
    .populate('salesAccount', 'accountNumber name type')
    .populate('purchaseAccount', 'accountNumber name type');

  res.json({
    success: true,
    message: 'Inventory item updated successfully',
    data: updatedItem
  });
}));

// Manual stock movements — each one updates the item total, the store + project ledger and the accounts
const runStockMovement = (kind) => [[
  body('quantity').isFloat({ min: kind === 'adjust' ? 0 : 0.0001 }).withMessage(kind === 'adjust' ? 'Counted quantity must be 0 or more' : 'Quantity must be greater than 0'),
  body('project').isMongoId().withMessage('Select the project'),
  body('reason').trim().notEmpty().withMessage('Reason is required'),
  body('store').optional({ checkFalsy: true }).isMongoId(),
  body('unitCost').optional({ checkFalsy: true }).isFloat({ min: 0 })
], authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0]?.msg, errors: errors.array() });
  }
  const item = await Inventory.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, message: 'Inventory item not found' });
  }
  const { postStockMovement } = require('../utils/inventoryMovements');
  try {
    const result = await postStockMovement({
      item, kind, qty: Number(req.body.quantity), projectId: req.body.project, storeId: req.body.store || null,
      unitCost: Number(req.body.unitCost) || 0, reference: req.body.reference || '', reason: req.body.reason,
      userId: req.user.id
    });
    const verb = result.delta > 0 ? `+${result.delta}` : `${result.delta}`;
    res.json({
      success: true,
      message: `Stock ${verb} ${item.unit || ''} in ${result.project} / ${result.store} (now ${result.balanceAfter})`
        + (result.finance.status === 'posted' ? '' : ` — no accounting entry: ${result.finance.reason}`),
      data: result.item,
      finance: result.finance
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
})];

// @route   POST /api/procurement/inventory/:id/add-stock   { quantity, project, store?, unitCost?, reason }
router.post('/inventory/:id/add-stock', ...runStockMovement('add'));

// @route   POST /api/procurement/inventory/:id/remove-stock   { quantity, project, store?, reason }
router.post('/inventory/:id/remove-stock', ...runStockMovement('remove'));

// @route   POST /api/procurement/inventory/:id/adjust-stock   { quantity (counted, for this project + store), project, store?, reason }
router.post('/inventory/:id/adjust-stock', ...runStockMovement('adjust'));

// @route   GET /api/procurement/inventory/:id/movements
// @desc    Store + project stock history of one item (GRN / SIN / SRN / adjustments)
router.get('/inventory/:id/movements',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid item' });
    const rows = await StockTransaction.find({ item: req.params.id })
      .populate('project', 'name')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json({ success: true, data: rows });
  })
);

// @route   GET /api/procurement/inventory-stock-check
// @desc    Items whose total differs from their store + project stock
router.get('/inventory-stock-check',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const { findStockMismatches } = require('../utils/inventoryMovements');
    res.json({ success: true, data: await findStockMismatches() });
  })
);

// @route   POST /api/procurement/inventory/:id/reconcile   { project?, store? }
// @desc    Fix one mismatch: allocate unallocated stock to a project, or raise the item total to the ledger
router.post('/inventory/:id/reconcile',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Inventory item not found' });
    const { reconcileItemStock } = require('../utils/inventoryMovements');
    try {
      const r = await reconcileItemStock({ item, projectId: req.body.project, storeId: req.body.store || null, userId: req.user.id });
      res.json({
        success: true,
        message: r.action === 'allocated'
          ? `${r.qty} ${item.unit || ''} allocated to ${r.project} / ${r.store}`
          : `Item total raised by ${r.qty} to match project stock`,
        data: r
      });
    } catch (err) {
      res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  })
);

// @route   DELETE /api/procurement/inventory/:id
// @desc    Delete inventory item. Use ?force=true to delete even when stock > 0 (use with care).
// @access  Private (Admin only)
router.delete('/inventory/:id', 
  authorize('super_admin', 'admin'), 
  asyncHandler(async (req, res) => {
    const item = await Inventory.findById(req.params.id);
    const force = req.query.force === 'true' || req.body?.force === true;

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    // Block delete when quantity > 0 unless force is set
    if (item.quantity > 0 && !force) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete item with existing stock. Adjust stock to zero first, or use force delete.'
      });
    }

    await Inventory.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Inventory item deleted successfully'
    });
  })
);

// ==================== DELIVERY CHALLAN (full-advance PO → QA → GRN) ====================

// @route   GET /api/procurement/delivery-challans
router.get('/delivery-challans',
  authorize('super_admin', 'admin', 'procurement_manager', 'store_qa', 'audit_manager', 'auditor', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { purchaseOrder, status, page = 1, limit = 30 } = req.query;
    const q = {};
    if (purchaseOrder) q.purchaseOrder = purchaseOrder;
    if (status) q.status = status;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (pg - 1) * lim;
    const [items, total] = await Promise.all([
      DeliveryChallan.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .populate('purchaseOrder', 'orderNumber poNumber status totalAmount paymentTerms items')
        .populate('createdBy', 'firstName lastName email')
        .populate('qaTestedBy', 'firstName lastName email')
        .lean(),
      DeliveryChallan.countDocuments(q)
    ]);
    res.json({
      success: true,
      data: {
        items,
        pagination: { currentPage: pg, itemsPerPage: lim, totalItems: total, totalPages: Math.ceil(total / lim) || 1 }
      }
    });
  })
);

// @route   GET /api/procurement/delivery-challans/:id
router.get('/delivery-challans/:id',
  authorize('super_admin', 'admin', 'procurement_manager', 'store_qa', 'audit_manager', 'auditor', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const doc = await DeliveryChallan.findById(req.params.id)
      .populate('purchaseOrder')
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email')
      .populate('qaTestedBy', 'firstName lastName email')
      .populate('grnIds', 'receiveNumber receiveDate status');
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    res.json({ success: true, data: doc });
  })
);

// @route   POST /api/procurement/delivery-challans
router.post('/delivery-challans',
  authorize('super_admin', 'admin', 'procurement_manager'),
  [
    body('purchaseOrder').isMongoId().withMessage('Valid purchase order ID is required'),
    body('items').isArray({ min: 1 }).withMessage('At least one line is required'),
    body('items.*.poLineIndex').isInt({ min: 0 }).withMessage('Each line needs poLineIndex'),
    body('items.*.quantity').isFloat({ min: 0.01 }).withMessage('Each line needs quantity > 0')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    const { purchaseOrder: poId, vendorDcReference, items } = req.body;

    const po = await PurchaseOrder.findById(poId);
    if (!po) {
      return res.status(400).json({ success: false, message: 'Purchase order not found' });
    }
    if (!isFullAdvancePaymentTerm(po.paymentTerms)) {
      return res.status(400).json({
        success: false,
        message: 'Delivery challans are only used for full-advance payment terms on this PO.'
      });
    }
    const dcStatus = purchaseOrderOpenForDeliveryChallan(po);
    if (!dcStatus.ok) {
      return res.status(400).json({
        success: false,
        message: dcStatus.message
      });
    }

    const poItems = po.items || [];
    const merged = new Map();
    for (const row of items) {
      const j = Number(row.poLineIndex);
      const q = Number(row.quantity) || 0;
      if (Number.isNaN(j) || j < 0 || q <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid poLineIndex or quantity' });
      }
      merged.set(j, Math.round(((merged.get(j) || 0) + q) * 100) / 100);
    }

    const openByLine = await getOpenDcQuantitiesByPoLine(po._id);
    const dcItems = [];
    for (const [jStr, qty] of merged.entries()) {
      const j = Number(jStr);
      if (j >= poItems.length) {
        return res.status(400).json({ success: false, message: `PO line index ${j} is out of range` });
      }
      const poLine = poItems[j];
      const ordered = Number(poLine.quantity) || 0;
      const received = Number(poLine.receivedQuantity) || 0;
      const remaining = Math.max(0, Math.round((ordered - received) * 100) / 100);
      const openDc = openByLine[j] || 0;
      const available = Math.max(0, Math.round((remaining - openDc) * 100) / 100);
      if (qty - available > 0.0001) {
        return res.status(400).json({
          success: false,
          message: `Line ${j + 1}: quantity exceeds PO remaining minus open delivery challans. Available: ${available}, requested: ${qty}`
        });
      }
      dcItems.push({
        poLineIndex: j,
        productCode: (poLine.productCode && String(poLine.productCode).trim()) || '',
        itemCode: (poLine.productCode && String(poLine.productCode).trim()) || '',
        itemName: (poLine.description && String(poLine.description).trim()) || '—',
        quantity: qty,
        unit: (poLine.unit && String(poLine.unit).trim()) || '—',
        unitPrice: Number(poLine.unitPrice) || 0,
        quantityReceived: 0
      });
    }

    const dc = await DeliveryChallan.createWithUniqueDcNumber({
      purchaseOrder: po._id,
      vendorDcReference: vendorDcReference ? String(vendorDcReference).trim() : undefined,
      status: 'qa_pending',
      qaStatus: 'pending',
      items: dcItems,
      grnIds: [],
      createdBy: req.user.id,
      updatedBy: req.user.id
    });
    await dc.populate([
      { path: 'purchaseOrder', select: 'orderNumber poNumber status totalAmount paymentTerms' },
      { path: 'createdBy', select: 'firstName lastName email' }
    ]);
    res.status(201).json({ success: true, message: 'Delivery challan created', data: dc });
  })
);

// @route   PATCH /api/procurement/delivery-challans/:id/qa
router.patch('/delivery-challans/:id/qa',
  authorize('super_admin', 'admin', 'procurement_manager', 'store_qa'),
  [
    body('qaStatus').isIn(['passed', 'failed']).withMessage('qaStatus must be passed or failed'),
    body('qaRemarks').optional().isString().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    const doc = await DeliveryChallan.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    if (!['qa_pending'].includes(doc.status)) {
      return res.status(400).json({
        success: false,
        message: `QA can only be recorded while challan is pending QA (current: ${doc.status})`
      });
    }
    const { qaStatus, qaRemarks } = req.body;
    doc.qaStatus = qaStatus;
    doc.qaRemarks = qaRemarks ? String(qaRemarks).trim() : '';
    doc.qaTestedBy = req.user.id;
    doc.qaTestedAt = new Date();
    doc.updatedBy = req.user.id;
    if (qaStatus === 'passed') {
      doc.status = 'qa_passed';
    } else {
      doc.status = 'qa_failed';
    }
    await doc.save();
    res.json({ success: true, message: 'QA status updated', data: doc });
  })
);

// ==================== GOODS RECEIVE ROUTES ====================

// @route   GET /api/procurement/goods-receive
// @desc    Get all goods receive records
// @access  Private (Procurement and Admin)
router.get('/goods-receive',
  authorize('super_admin', 'admin', 'procurement_manager', 'audit_manager', 'auditor', 'finance_manager', 'higher_management', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search, status, supplier, purchaseOrder, startDate, endDate } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (supplier) query.supplier = supplier;
    if (purchaseOrder) query.purchaseOrder = purchaseOrder;
    
    if (startDate || endDate) {
      query.receiveDate = {};
      if (startDate) query.receiveDate.$gte = new Date(startDate);
      if (endDate) query.receiveDate.$lte = new Date(endDate);
    }
    
    if (search) {
      query.$or = [
        { receiveNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    const receives = await GoodsReceive.find(query)
      .populate('supplier', 'name contactPerson supplierId address')
      .populate('purchaseOrder', 'orderNumber')
      .populate('deliveryChallan', 'dcNumber gatePassNo status')
      .populate('receivedBy', 'firstName lastName')
      .sort({ receiveDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await GoodsReceive.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        receives,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/procurement/goods-receive/:id
// @desc    Get single goods receive record
// @access  Private
router.get('/goods-receive/:id',
  authorize('super_admin', 'admin', 'procurement_manager', 'audit_manager', 'auditor', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const receive = await GoodsReceive.findById(req.params.id)
      .populate('supplier', 'name contactPerson email phone supplierId address')
      .populate('purchaseOrder')
      .populate('deliveryChallan', 'dcNumber gatePassNo status qaStatus')
      .populate('items.inventoryItem')
      .populate('receivedBy', 'firstName lastName email');
    
    if (!receive) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }
    
    res.json({ success: true, data: receive });
  })
);

// @route   GET /api/procurement/vendor-bills/billable-grns
// @desc    Get GRNs that can be billed for a selected vendor
// @access  Private
router.get('/vendor-bills/billable-grns',
  authorize('super_admin', 'admin', 'procurement_manager', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { vendorId } = req.query;
    const query = {
      status: { $in: ['Received', 'Complete', 'Partial'] },
      billingStatus: { $ne: 'fully_billed' }
    };
    if (vendorId) query.supplier = vendorId;

    const grns = await GoodsReceive.find(query)
      .populate('purchaseOrder', 'orderNumber')
      .populate('supplier', 'name')
      .sort({ receiveDate: -1, createdAt: -1 })
      .lean();

    const list = grns.map((g) => {
      const totalAmount = Math.round((Number(g.netAmount || g.total || 0) || 0) * 100) / 100;
      const billedAmount = Math.round((Number(g.billedAmount) || 0) * 100) / 100;
      const remainingAmount = Math.round((totalAmount - billedAmount) * 100) / 100;
      return {
        _id: g._id,
        receiveNumber: g.receiveNumber,
        receiveDate: g.receiveDate,
        vendorId: g.supplier?._id || g.supplier || null,
        vendorName: g.supplier?.name || g.supplierName || '—',
        poId: g.purchaseOrder?._id || g.purchaseOrder || null,
        poNumber: g.purchaseOrder?.orderNumber || g.poNumber || '',
        amount: totalAmount,
        billedAmount,
        remainingAmount,
        status: g.status,
        billingStatus: g.billingStatus || 'nothing_to_bill'
      };
    }).filter((g) => g.remainingAmount > 0.009);

    res.json({ success: true, data: { grns: list } });
  })
);

// @route   POST /api/procurement/vendor-bills
// @desc    Create vendor bill from one or multiple GRNs (Procurement bill creation)
// @access  Private
router.post('/vendor-bills',
  authorize('super_admin', 'admin', 'procurement_manager', 'finance_manager'),
  [
    body('vendorId').isMongoId().withMessage('Valid vendorId is required'),
    body('grnIds').optional().isArray({ min: 1 }).withMessage('At least one GRN must be selected'),
    body('grnIds.*').optional().isMongoId(),
    body('grnAllocations').optional().isArray({ min: 1 }),
    body('grnAllocations.*.grnId').optional().isMongoId(),
    body('grnAllocations.*.amount').optional().isFloat({ min: 0.01 }),
    body('billDate').optional().isISO8601(),
    body('vendorInvoiceNumber').optional().isString(),
    body('paymentTerms').optional().isIn(['due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60', 'custom']),
    body('notes').optional().isString()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const {
      vendorId,
      grnIds,
      grnAllocations,
      billDate,
      vendorInvoiceNumber,
      paymentTerms = 'net_30',
      notes
    } = req.body;

    const vendor = await Supplier.findById(vendorId).lean();
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    const hasAllocations = Array.isArray(grnAllocations) && grnAllocations.length > 0;
    const selectedSource = hasAllocations ? grnAllocations.map((x) => x.grnId) : (grnIds || []);
    const uniqueGrnIds = [...new Set(selectedSource.map(String))];
    if (uniqueGrnIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one GRN' });
    }
    const grns = await GoodsReceive.find({
      _id: { $in: uniqueGrnIds },
      supplier: vendorId,
      status: { $in: ['Received', 'Complete', 'Partial'] }
    })
      .populate('purchaseOrder', 'orderNumber')
      .lean();

    if (grns.length !== uniqueGrnIds.length) {
      return res.status(400).json({ success: false, message: 'One or more selected GRNs are invalid for this vendor' });
    }

    const lines = [];
    const linkedGRNs = [];
    let totalAmount = 0;
    const allocMap = new Map((grnAllocations || []).map((x) => [String(x.grnId), Number(x.amount) || 0]));
    const grnUpdates = [];
    for (const g of grns) {
      const gross = Math.round((Number(g.netAmount || g.total || 0) || 0) * 100) / 100;
      const billed = Math.round((Number(g.billedAmount) || 0) * 100) / 100;
      const remaining = Math.round((gross - billed) * 100) / 100;
      if (remaining <= 0.009) {
        return res.status(400).json({ success: false, message: `GRN ${g.receiveNumber} is already fully billed` });
      }
      const requested = hasAllocations ? Math.round((allocMap.get(String(g._id)) || 0) * 100) / 100 : remaining;
      const amt = requested;
      if (amt <= 0) continue;
      if (amt - remaining > 0.01) {
        return res.status(400).json({ success: false, message: `Billing amount for GRN ${g.receiveNumber} exceeds remaining amount (${remaining})` });
      }
      if (amt <= 0) continue;
      totalAmount += amt;
      lines.push({
        description: `GRN ${g.receiveNumber}${g.poNumber ? ` / PO ${g.poNumber}` : ''}`,
        quantity: 1,
        unitPrice: amt,
        grnId: g._id,
        poId: g.purchaseOrder?._id || g.purchaseOrder || undefined
      });
      linkedGRNs.push({
        grnId: g._id,
        grnNumber: g.receiveNumber,
        poId: g.purchaseOrder?._id || g.purchaseOrder || undefined,
        poNumber: g.purchaseOrder?.orderNumber || g.poNumber || '',
        amount: amt
      });
      grnUpdates.push({ id: g._id, nextBilledAmount: Math.round((billed + amt) * 100) / 100, total: gross });
    }

    if (totalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Selected GRNs have zero billable amount' });
    }

    const effectiveBillDate = billDate ? new Date(billDate) : new Date();
    const dueDate = computeDueDateFromTerms(effectiveBillDate, paymentTerms);
    const billNumber = buildBillNumber('VBILL');
    const resolvedVendorInvoiceNumber = (vendorInvoiceNumber && String(vendorInvoiceNumber).trim())
      ? String(vendorInvoiceNumber).trim()
      : billNumber;

    const apBill = await FinanceHelper.createAPFromBill({
      vendorName: vendor.name || 'Unknown Vendor',
      vendorEmail: vendor.email || '',
      vendorId: vendor._id,
      billNumber,
      vendorInvoiceNumber: resolvedVendorInvoiceNumber,
      billDate: effectiveBillDate,
      dueDate,
      paymentTerms,
      amount: totalAmount,
      department: 'procurement',
      module: 'procurement',
      referenceId: grns[0]._id, // primary reference; linkedGRNs keeps full mapping
      referenceType: 'grn',
      lineItems: lines,
      linkedGRNs,
      notes: notes || `Procurement vendor bill from ${grns.length} GRN(s)`,
      createdBy: req.user.id
    });

    // Workflow transition: newly created bill starts in 'Pending Audit' status for Pre-Audit review
    apBill.status = 'Pending Audit';
    apBill.workflowHistory = Array.isArray(apBill.workflowHistory) ? apBill.workflowHistory : [];
    apBill.workflowHistory.push({
      fromStatus: 'Draft',
      toStatus: 'Pending Audit',
      changedBy: req.user.id,
      changedAt: new Date(),
      comments: notes || `Vendor bill created from ${grns.length} GRN(s) and routed to Pre-Audit`,
      module: 'Procurement'
    });
    await apBill.save();

    for (const u of grnUpdates) {
      const remaining = Math.round((u.total - u.nextBilledAmount) * 100) / 100;
      await GoodsReceive.updateOne(
        { _id: u.id },
        {
          $set: {
            billedAmount: u.nextBilledAmount,
            billingStatus: remaining <= 0.009 ? 'fully_billed' : 'waiting_bills',
            vendorBill: apBill._id,
            vendorBillNumber: apBill.billNumber
          }
        }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Vendor bill created from selected GRN(s)',
      data: apBill
    });
  })
);

// @route   PUT /api/procurement/goods-receive/:id/sync-inventory
// @desc    Sync GRN items to inventory (for existing GRNs or when post-save did not run)
// @access  Private
router.put('/goods-receive/:id/sync-inventory',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const grn = await GoodsReceive.findById(req.params.id).lean();
    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }
    await GoodsReceive.syncItemsToInventory(grn);
    res.json({ success: true, message: 'GRN items synced to inventory' });
  })
);

// @route   POST /api/procurement/goods-receive
// @desc    Create GRN (Goods Received Note) record
// @access  Private
router.post('/goods-receive',
  authorize('super_admin', 'admin', 'procurement_manager'),
  handleGrnUpload,
  parseGrnRequestBody,
  [
    body('receiveDate').optional().isISO8601(),
    body('project').isMongoId().withMessage('Valid project ID is required'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.productCode').optional().trim(),
    body('items.*.inventoryItem').optional().isMongoId().withMessage('Valid inventory item ID when provided'),
    body('items.*.quantity').isFloat({ min: 0.01 }).withMessage('Quantity must be greater than 0'),
    body('items.*.itemCode').optional().trim(),
    body('items.*.itemName').optional().trim(),
    body('items.*.unit').optional().trim(),
    body('items.*.unitPrice').optional().isFloat({ min: 0 }),
    body('deliveryChallan').optional().isMongoId().withMessage('Valid delivery challan ID when provided')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      receiveDate, supplier, supplierName, purchaseOrder, poNumber, items, notes,
      narration, supplierAddress, prNumber, store, gatePassNo, currency,
      discount, otherCharges, observation, status: bodyStatus, project,
      deliveryChallan
    } = req.body;

    // Validate project exists
    const projectDoc = await Project.findById(project);
    if (!projectDoc) {
      return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    let resolvedSupplierAddress = supplierAddress;
    if (supplier && !resolvedSupplierAddress) {
      const sup = await Supplier.findById(supplier).select('address').lean();
      if (sup) resolvedSupplierAddress = sup.address;
    }

    const itemsWithDetails = await Promise.all(
      items.map(async (item) => {
        const qty = Number(item.quantity) || 0;
        let inventoryItem = null;
        let itemCode = (item.itemCode != null && String(item.itemCode).trim() !== '') ? String(item.itemCode).trim() : '';
        let itemName = (item.itemName != null && String(item.itemName).trim() !== '') ? String(item.itemName).trim() : '';
        let unit = (item.unit != null && String(item.unit).trim() !== '') ? String(item.unit).trim() : '';
        let rate = (typeof item.unitPrice === 'number' ? item.unitPrice : (item.unitPrice !== '' && item.unitPrice != null ? Number(item.unitPrice) : 0));
        if (item.inventoryItem) {
          const inventory = await Inventory.findById(item.inventoryItem);
          if (inventory) {
            inventoryItem = inventory._id;
            if (!itemCode) itemCode = inventory.itemCode || '';
            if (!itemName) itemName = inventory.name || '';
            if (!unit) unit = inventory.unit || '';
            if (!rate) rate = inventory.unitPrice || 0;
          }
        }
        return {
          productCode: (item.productCode != null && String(item.productCode).trim() !== '') ? String(item.productCode).trim() : '',
          inventoryItem,
          itemCode: itemCode || '—',
          itemName: itemName || '—',
          quantity: qty,
          unit: unit || '—',
          unitPrice: rate,
          valueExcludingSalesTax: qty * rate,
          subStore: item.subStore || undefined,
          location: {
            rack: item.location?.rack || '',
            shelf: item.location?.shelf || '',
            bin: item.location?.bin || ''
          },
          notes: item.notes
        };
      })
    );

    // Validate GRN quantity against remaining PO quantity so multiple GRNs are allowed
    // until PO is fulfilled, but over-receipt is blocked.
    /** When full-advance flow, GRN must reference a QA-passed DC; we update this after save. */
    let deliveryChallanIdForPostSave = null;
    if (purchaseOrder) {
      const poForValidation = await PurchaseOrder.findById(purchaseOrder);
      if (!poForValidation) {
        return res.status(400).json({ success: false, message: 'Linked purchase order not found' });
      }
      if (!['Sent to Store', 'GRN Created', 'Partially Received', 'Approved', 'Ordered'].includes(poForValidation.status)) {
        return res.status(400).json({ success: false, message: `PO ${poForValidation.orderNumber || ''} is not open for GRN creation` });
      }
      const isFullAdvanceFlow = requiresDeliveryChallanFlow(poForValidation);

      if (deliveryChallan && !isFullAdvanceFlow) {
        return res.status(400).json({
          success: false,
          message: 'deliveryChallan is only for full-advance POs (by payment terms).'
        });
      }

      if (isFullAdvanceFlow) {
        if (!deliveryChallan) {
          return res.status(400).json({
            success: false,
            message: 'This PO is on full advance: select a QA-passed delivery challan to post the GRN.'
          });
        }
        const dcDoc = await DeliveryChallan.findById(deliveryChallan);
        if (!dcDoc || String(dcDoc.purchaseOrder) !== String(purchaseOrder)) {
          return res.status(400).json({ success: false, message: 'Invalid delivery challan for this purchase order' });
        }
        if (dcDoc.status !== 'qa_passed') {
          return res.status(400).json({
            success: false,
            message: `Delivery challan must be QA passed before GRN. Current status: ${dcDoc.status}`
          });
        }
        const dcOpenByLine = {};
        for (const it of dcDoc.items || []) {
          const j = Number(it.poLineIndex);
          const open = Math.round(((Number(it.quantity) || 0) - (Number(it.quantityReceived) || 0)) * 100) / 100;
          if (open <= 0) continue;
          dcOpenByLine[j] = (dcOpenByLine[j] || 0) + open;
        }
        const requestedByPoLine = {};
        for (let i = 0; i < itemsWithDetails.length; i++) {
          const grnLine = itemsWithDetails[i];
          const j = matchPurchaseOrderLineIndex(poForValidation.items || [], grnLine, i);
          if (j < 0) {
            return res.status(400).json({ success: false, message: `GRN item "${grnLine.itemName || grnLine.itemCode || i + 1}" is not matched to PO line` });
          }
          const q = Number(grnLine.quantity) || 0;
          requestedByPoLine[j] = (requestedByPoLine[j] || 0) + q;
        }
        for (const jStr of Object.keys(requestedByPoLine)) {
          const j = Number(jStr);
          const reqQ = requestedByPoLine[jStr];
          const allowed = dcOpenByLine[j] || 0;
          if (reqQ - allowed > 0.0001) {
            return res.status(400).json({
              success: false,
              message: `GRN qty exceeds remaining quantity on the selected delivery challan for PO line ${j + 1}. Allowed: ${allowed}, requested: ${reqQ}`
            });
          }
        }
        deliveryChallanIdForPostSave = dcDoc._id;
      }

      for (let i = 0; i < itemsWithDetails.length; i++) {
        const grnLine = itemsWithDetails[i];
        const j = matchPurchaseOrderLineIndex(poForValidation.items || [], grnLine, i);
        if (j < 0) {
          return res.status(400).json({ success: false, message: `GRN item "${grnLine.itemName || grnLine.itemCode || i + 1}" is not matched to PO line` });
        }
        const poLine = poForValidation.items[j];
        const ordered = Number(poLine.quantity) || 0;
        const received = Number(poLine.receivedQuantity) || 0;
        const remaining = Math.max(0, Math.round((ordered - received) * 100) / 100);
        const requested = Number(grnLine.quantity) || 0;
        if (requested - remaining > 0.0001) {
          return res.status(400).json({
            success: false,
            message: `GRN qty exceeds remaining PO qty for line ${j + 1}. Remaining: ${remaining}, requested: ${requested}`
          });
        }
      }
    }

    const preparedByName = req.user.firstName && req.user.lastName
      ? `${req.user.firstName} ${req.user.lastName}`.trim()
      : (req.user.email || 'Prepared By');

    // Resolve store name snapshot for denormalization
    let storeSnapshot = 'Main Store';
    if (store) {
      const Store = require('../models/procurement/Store');
      const storeDoc = await Store.findById(store).select('name').lean();
      if (storeDoc) storeSnapshot = storeDoc.name;
    }

    const grnStatus = (bodyStatus === 'Complete' || bodyStatus === 'Partial') ? bodyStatus : 'Partial';

    let resolvedGatePassNo = (gatePassNo != null && String(gatePassNo).trim() !== '') ? String(gatePassNo).trim() : '';
    if (deliveryChallanIdForPostSave) {
      const dcGp = await DeliveryChallan.findById(deliveryChallanIdForPostSave);
      if (!dcGp) {
        return res.status(400).json({ success: false, message: 'Delivery challan not found' });
      }
      if (!dcGp.gatePassNo) {
        await dcGp.save();
      }
      resolvedGatePassNo = dcGp.gatePassNo || resolvedGatePassNo;
    }

    const uploadedAttachments = mapUploadedGrnAttachments(req.files || []);

    const receive = new GoodsReceive({
      receiveDate: receiveDate || new Date(),
      supplier,
      supplierName,
      supplierAddress: resolvedSupplierAddress,
      purchaseOrder,
      deliveryChallan: deliveryChallanIdForPostSave || undefined,
      poNumber,
      narration: narration || undefined,
      prNumber: prNumber || undefined,
      store: store || undefined,
      storeSnapshot,
      project: project,
      gatePassNo: resolvedGatePassNo || undefined,
      currency: currency || 'Rupees',
      discount: Number(discount) || 0,
      otherCharges: Number(otherCharges) || 0,
      observation: observation || undefined,
      preparedByName,
      items: itemsWithDetails,
      notes,
      attachments: uploadedAttachments,
      receivedBy: req.user.id,
      status: grnStatus,
      billingStatus: 'waiting_bills',
      billedAmount: 0
    });

    // Retry on rare duplicate receiveNumber race (unique index)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        if (attempt > 0) {
          receive.receiveNumber = await GoodsReceive.allocateNextReceiveNumber();
        }
        await receive.save();
        break;
      } catch (saveErr) {
        const isDup =
          saveErr?.code === 11000 ||
          /duplicate key|E11000/i.test(String(saveErr?.message || ''));
        if (!isDup || attempt === 4) throw saveErr;
      }
    }
    await receive.populate([
      { path: 'project', select: 'name projectId' },
      { path: 'supplier', select: 'name contactPerson supplierId address' },
      { path: 'purchaseOrder', select: 'orderNumber' },
      { path: 'deliveryChallan', select: 'dcNumber gatePassNo status qaStatus' },
      { path: 'receivedBy', select: 'firstName lastName' },
      {
        path: 'items.inventoryItem',
        populate: [
          { path: 'inventoryCategory', select: 'name stockValuationAccount stockInputAccount stockOutputAccount purchaseAccount salesAccount' },
          { path: 'inventoryAccount grniAccount cogsAccount purchaseAccount salesAccount', select: 'accountNumber name type' }
        ]
      }
    ]);

    // Auto-post GRN journal entries — resolveInventoryAccounts handles the full
    // fallback chain: item-level account → inventoryCategory → global account number.
    // We call it for every received item; skipping is done inside postGRNJournal.
    const FinanceHelper = require('../utils/financeHelper');
    for (const grnItem of receive.items) {
      let inv = grnItem.inventoryItem;
      // Manual GRN can arrive without explicit inventoryItem link.
      // In that case, resolve by item code/product code/name so finance posting
      // still happens for the exact inventory row that stock sync updated.
      if (!inv) {
        const code = String(grnItem.itemCode || grnItem.productCode || '').trim();
        const name = String(grnItem.itemName || '').trim();
        if (code && code !== '—') {
          inv = await Inventory.findOne({ itemCode: code });
        }
        if (!inv && name && name !== '—') {
          inv = await Inventory.findOne({ name }).sort({ createdAt: -1 });
        }
      }
      if (!inv) continue;
      await FinanceHelper.postGRNJournal({
        inventoryItem: inv.toObject ? inv.toObject() : inv,
        grnDoc: receive,
        qty: grnItem.quantity,
        unitPrice: grnItem.unitPrice,
        createdBy: req.user.id
      });
    }

    // Apply received quantities to the linked PO (accumulates across multiple GRNs)
    if (purchaseOrder) {
      const poDoc = await PurchaseOrder.findById(purchaseOrder);
      if (poDoc?.items?.length) {
        const prevStatus = poDoc.status;
        itemsWithDetails.forEach((grnLine, i) => {
          const qty = Number(grnLine.quantity) || 0;
          if (qty <= 0) return;
          const j = matchPurchaseOrderLineIndex(poDoc.items, grnLine, i);
          if (j < 0) return;
          const prev = Number(poDoc.items[j].receivedQuantity) || 0;
          poDoc.items[j].receivedQuantity = Math.round((prev + qty) * 100) / 100;
        });
        poDoc.updatedBy = req.user.id;
        poDoc.updateReceivingStatus();
        poDoc.workflowHistory = poDoc.workflowHistory || [];
        poDoc.workflowHistory.push({
          fromStatus: prevStatus,
          toStatus: poDoc.status,
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: `GRN ${receive.receiveNumber || ''} — quantities applied to PO`,
          module: 'Store'
        });
        await poDoc.save();

        await notifyStoreUsers({
          actorId: req.user.id,
          title: 'GRN created in Store',
          message: `GRN ${receive.receiveNumber || ''} has been created for PO ${poDoc.poNumber || poDoc.orderNumber || ''}.`,
          actionUrl: STORE_SUBMODULE_ROUTES.goodsReceive,
          entityId: poDoc._id,
          entityType: 'PurchaseOrder'
        });

        if (deliveryChallanIdForPostSave) {
          const qtyByPoLine = {};
          itemsWithDetails.forEach((grnLine, i) => {
            const qty = Number(grnLine.quantity) || 0;
            if (qty <= 0) return;
            const j = matchPurchaseOrderLineIndex(poDoc.items, grnLine, i);
            if (j < 0) return;
            qtyByPoLine[j] = Math.round(((qtyByPoLine[j] || 0) + qty) * 100) / 100;
          });
          const dcMutable = await DeliveryChallan.findById(deliveryChallanIdForPostSave);
          if (dcMutable) {
            applyGrnQuantitiesToDeliveryChallan(dcMutable, qtyByPoLine);
            dcMutable.grnIds = dcMutable.grnIds || [];
            dcMutable.grnIds.push(receive._id);
            dcMutable.updatedBy = req.user.id;
            await dcMutable.save();
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'GRN created successfully and inventory updated',
      data: receive
    });
  })
);

// ==================== GOODS ISSUE ROUTES ====================

// @route   GET /api/procurement/goods-issue
// @desc    Get all goods issue records
// @access  Private (Procurement and Admin)
// Customer dropdown for customer-wise SINs — reads the same Finance → Customers list as AR invoices
router.get('/goods-issue-customers',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const SalesCustomer = require('../models/sales/SalesCustomer');
    const customers = await SalesCustomer.find({ status: { $ne: 'inactive' } })
      .select('name company phone email')
      .sort({ name: 1 })
      .limit(5000)
      .lean();
    res.json({ success: true, data: customers });
  })
);

router.get('/goods-issue',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search, status, department, startDate, endDate } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (department) query.department = department;
    
    if (startDate || endDate) {
      query.issueDate = {};
      if (startDate) query.issueDate.$gte = new Date(startDate);
      if (endDate) query.issueDate.$lte = new Date(endDate);
    }
    
    if (search) {
      query.$or = [
        { issueNumber: { $regex: search, $options: 'i' } },
        { sinNumber: { $regex: search, $options: 'i' } },
        { departmentName: { $regex: search, $options: 'i' } },
        { requestedByName: { $regex: search, $options: 'i' } },
        { costCenterName: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } }
      ];
    }

    const issues = await GoodsIssue.find(query)
      .populate('requestedBy', 'firstName lastName')
      .populate('issuedBy', 'firstName lastName')
      .populate('costCenter', 'code name department')
      .populate('referenceIndent', 'indentNumber title status')
      .populate('referencePurchaseOrder', 'orderNumber status totalAmount')
      .populate('referenceGoodsReceive', 'receiveNumber poNumber status')
      .sort({ issueDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await GoodsIssue.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        issues,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/procurement/goods-issue/:id
// @desc    Get single goods issue record
// @access  Private
// ── Store Return Notes (SRN) and SIN cancellation ────────────────────────────
// @route   GET /api/procurement/goods-issue/:id/returnable
router.get('/goods-issue/:id/returnable',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const sin = await GoodsIssue.findById(req.params.id).lean();
    if (!sin) return res.status(404).json({ success: false, message: 'Store Issue Note not found' });
    const { sinReturnableLines } = require('../utils/storeReturns');
    res.json({ success: true, data: { sinNumber: sin.issueNumber, status: sin.status, lines: await sinReturnableLines(sin) } });
  })
);

// @route   POST /api/procurement/goods-issue/:id/cancel   { reason }
router.post('/goods-issue/:id/cancel',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const { cancelStoreIssue } = require('../utils/storeReturns');
    try {
      const { srn } = await cancelStoreIssue({ sinId: req.params.id, reason: req.body.reason, userId: req.user.id });
      res.json({
        success: true,
        message: srn ? `Store Issue Note cancelled — stock returned via ${srn.returnNumber}` : 'Store Issue Note cancelled',
        data: srn
      });
    } catch (err) {
      res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  })
);

// @route   GET /api/procurement/store-returns
router.get('/store-returns',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const StoreReturn = require('../models/procurement/StoreReturn');
    const { page = 1, limit = 10, search, goodsIssue } = req.query;
    const query = {};
    if (goodsIssue) query.goodsIssue = goodsIssue;
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ returnNumber: rx }, { sinNumber: rx }, { customerName: rx }, { reason: rx }, { 'items.itemName': rx }];
    }
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 10));
    const [rows, total] = await Promise.all([
      StoreReturn.find(query).populate('project', 'name').populate('createdBy', 'firstName lastName')
        .sort({ returnDate: -1, createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      StoreReturn.countDocuments(query)
    ]);
    res.json({ success: true, data: { returns: rows, pagination: { total, page: pageNum, limit: limitNum } } });
  })
);

// @route   POST /api/procurement/store-returns   { goodsIssue, items: [{ inventoryItem, quantity, condition?, notes? }], reason, returnDate?, returnedByName?, receivedByName? }
router.post('/store-returns',
  authorize('super_admin', 'admin', 'procurement_manager'),
  [
    body('goodsIssue').isMongoId().withMessage('Select the Store Issue Note'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('reason').trim().notEmpty().withMessage('Reason is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0]?.msg, errors: errors.array() });
    const { postStoreReturn } = require('../utils/storeReturns');
    try {
      const srn = await postStoreReturn({
        sinId: req.body.goodsIssue, lines: req.body.items, reason: req.body.reason, userId: req.user.id,
        returnDate: req.body.returnDate || undefined, returnedByName: req.body.returnedByName, receivedByName: req.body.receivedByName
      });
      const notPosted = (srn.financePosting || []).filter((f) => f.status !== 'posted');
      res.status(201).json({
        success: true,
        message: `${srn.returnNumber} posted — ${srn.totalQuantity} unit(s) back in stock`
          + (notPosted.length ? ` (no accounting entry for ${notPosted.map((f) => `${f.itemName}: ${f.reason}`).join('; ')})` : ''),
        data: srn
      });
    } catch (err) {
      res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
  })
);

router.get('/goods-issue/:id',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const issue = await GoodsIssue.findById(req.params.id)
      .populate('companyId', 'name code')
      .populate('cancelledBy', 'firstName lastName')
      .populate('requestedBy', 'firstName lastName email')
      .populate('issuedBy', 'firstName lastName email')
      .populate('costCenter', 'code name department')
      .populate('project', 'name projectId')
      .populate('referenceIndent', 'indentNumber title status')
      .populate('referencePurchaseOrder', 'orderNumber status totalAmount')
      .populate('referenceGoodsReceive', 'receiveNumber poNumber status')
      .populate('items.inventoryItem');
    
    if (!issue) {
      return res.status(404).json({ success: false, message: 'Goods issue not found' });
    }
    
    res.json({ success: true, data: issue });
  })
);

// @route   POST /api/procurement/goods-issue
// @desc    Create Store Issue Note (SIN) record
// @access  Private
router.post('/goods-issue',
  authorize('super_admin', 'admin', 'procurement_manager'),
  [
    body('issueDate').optional().isISO8601(),
    body('project').isMongoId().withMessage('Valid project ID is required'),
    body('issueType').optional().isIn(['project', 'customer']).withMessage('Issue type must be project or customer'),
    body('customer').if(body('issueType').equals('customer')).isMongoId().withMessage('Select the customer for a customer-wise SIN'),
    body('department').optional({ checkFalsy: true }).isString(),
    body('companyId').optional({ checkFalsy: true }).isMongoId().withMessage('Valid company is required'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.inventoryItem').isMongoId().withMessage('Valid inventory item ID is required'),
    body('items.*.quantity').optional().isFloat({ min: 0 }),
    body('items.*.qtyIssued').optional().isFloat({ min: 0 }),
    body('referenceIndent').optional().isMongoId(),
    body('referencePurchaseOrder').optional().isMongoId(),
    body('referenceGoodsReceive').optional().isMongoId()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      issueDate, department, departmentName, costCenter, costCenterCode, costCenterName,
      requestedBy, requestedByName, items, purpose, notes,
      issuingLocation, requiredFor, justification, eprNo, concernedDepartment,
      returnedByName, approvedByName, receivedByName, project, store,
      referenceIndent, referencePurchaseOrder, referenceGoodsReceive
    } = req.body;
    const normalizedCostCenter = (typeof costCenter === 'string' && costCenter.trim() === '') ? undefined : costCenter;
    const normalizedRequestedBy = (typeof requestedBy === 'string' && requestedBy.trim() === '') ? undefined : requestedBy;

    const issueType = req.body.issueType === 'customer' ? 'customer' : 'project';
    let customerDoc = null;
    if (issueType === 'customer') {
      const SalesCustomer = require('../models/sales/SalesCustomer');
      customerDoc = await SalesCustomer.findById(req.body.customer).select('name').lean();
      if (!customerDoc) {
        return res.status(400).json({ success: false, message: 'Customer not found' });
      }
    }

    // Validate project exists
    const projectDoc = await Project.findById(project);
    if (!projectDoc) {
      return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const Store = require('../models/procurement/Store');
    const storeFromBody = (store && String(store).trim() !== '') ? store : undefined;
    let defaultStoreDoc = undefined;
    const ensureDefaultStore = async () => {
      if (defaultStoreDoc !== undefined) return defaultStoreDoc;
      defaultStoreDoc = await Store.findOne({ isActive: true }).sort({ type: 1, createdAt: 1 }).select('_id name').lean();
      return defaultStoreDoc;
    };

    if (normalizedCostCenter) {
      const costCenterDoc = await CostCenter.findById(normalizedCostCenter);
      if (!costCenterDoc || !costCenterDoc.isActive) {
        throw new Error('Invalid or inactive cost center');
      }
    }

    const itemsWithDetails = await Promise.all(
      items.map(async (item) => {
        const inventory = await Inventory.findById(item.inventoryItem);
        if (!inventory) {
          throw new Error(`Inventory item ${item.inventoryItem} not found`);
        }
        const qtyIssued = (item.qtyIssued != null && item.qtyIssued !== '') ? Number(item.qtyIssued) : (Number(item.quantity) || 0);
        if (qtyIssued <= 0) {
          throw new Error(`Quantity issued must be greater than 0 for ${inventory.name}`);
        }

        // Store + project + item must match GRN ledger; use inventory.store when header store is blank (avoids wrong "first active" store).
        const invStoreId = inventory.store?._id || inventory.store;
        let itemStoreId = item.subStore || storeFromBody || invStoreId;
        if (!itemStoreId) {
          const ds = await ensureDefaultStore();
          itemStoreId = ds ? ds._id : undefined;
        }

        // Check project-wise stock balance
        if (itemStoreId) {
          const projectBalance = await StockTransaction.getBalance(itemStoreId, project, inventory._id);
          if (projectBalance < qtyIssued) {
            throw new Error(`Insufficient stock for ${inventory.name} in this project. Available: ${projectBalance}, Requested: ${qtyIssued}`);
          }
        }

        // Also check overall inventory quantity (for backward compatibility)
        if (inventory.quantity < qtyIssued) {
          throw new Error(`Insufficient stock for ${inventory.name}. Available: ${inventory.quantity}, Requested: ${qtyIssued}`);
        }
        const qtyReturned = (item.qtyReturned != null && item.qtyReturned !== '') ? Number(item.qtyReturned) : 0;
        const balanceQty = (item.balanceQty != null && item.balanceQty !== '') ? Number(item.balanceQty) : 0;
        const itemCode = (item.itemCode != null && String(item.itemCode).trim() !== '') ? String(item.itemCode).trim() : inventory.itemCode;
        const itemName = (item.itemName != null && String(item.itemName).trim() !== '') ? String(item.itemName).trim() : inventory.name;
        const unit = (item.unit != null && String(item.unit).trim() !== '') ? String(item.unit).trim() : inventory.unit;
        return {
          inventoryItem: inventory._id,
          itemCode,
          itemName,
          quantity: qtyIssued,
          qtyReturned,
          qtyIssued,
          balanceQty,
          issuedFromNewStock: !!item.issuedFromNewStock,
          issuedFromOldStock: !!item.issuedFromOldStock,
          subStore: item.subStore || undefined,
          location: {
            rack: item.location?.rack || '',
            shelf: item.location?.shelf || '',
            bin: item.location?.bin || ''
          },
          unit,
          notes: item.notes,
          __itemStoreId: itemStoreId
        };
      })
    );

    const docStoreId = storeFromBody || itemsWithDetails.find((r) => r.__itemStoreId)?.__itemStoreId;
    let storeSnapshot = issuingLocation || 'Main Store';
    if (docStoreId) {
      const storeDoc = await Store.findById(docStoreId).select('name').lean();
      if (storeDoc) storeSnapshot = storeDoc.name;
    }

    const itemsForIssue = itemsWithDetails.map(({ __itemStoreId, ...rest }) => rest);

    const issuedByName = req.user.firstName && req.user.lastName
      ? `${req.user.firstName} ${req.user.lastName}`.trim()
      : (req.user.email || '');

    let issueCompanyId = req.body.companyId || undefined;
    if (!issueCompanyId && referenceIndent) {
      const indentDoc = await Indent.findById(referenceIndent).select('companyId').lean();
      if (indentDoc && indentDoc.companyId) issueCompanyId = indentDoc.companyId;
    }
    if (!issueCompanyId && referencePurchaseOrder) {
      const poDoc = await PurchaseOrder.findById(referencePurchaseOrder).select('companyId').lean();
      if (poDoc && poDoc.companyId) issueCompanyId = poDoc.companyId;
    }
    // Company decides which books the COGS entry goes to — never leave it to guesswork
    if (!issueCompanyId) {
      throw Object.assign(new Error('Select the company for this Store Issue Note'), { statusCode: 400 });
    }

    const issue = new GoodsIssue({
      issueDate: issueDate || new Date(),
      issuingLocation: issuingLocation || undefined,
      companyId: issueCompanyId,
      store: docStoreId || undefined,
      storeSnapshot,
      project: project,
      issueType,
      customer: customerDoc?._id || null,
      customerName: customerDoc?.name || '',
      referenceIndent: referenceIndent || undefined,
      referencePurchaseOrder: referencePurchaseOrder || undefined,
      referenceGoodsReceive: referenceGoodsReceive || undefined,
      department,
      departmentName,
      concernedDepartment: concernedDepartment || undefined,
      costCenter: normalizedCostCenter,
      costCenterCode,
      costCenterName,
      requiredFor: requiredFor || undefined,
      justification: justification || undefined,
      eprNo: eprNo || undefined,
      requestedBy: normalizedRequestedBy,
      requestedByName,
      returnedByName: returnedByName || undefined,
      approvedByName: approvedByName || undefined,
      issuedByName,
      receivedByName: receivedByName || undefined,
      items: itemsForIssue,
      purpose,
      notes,
      issuedBy: req.user.id,
      status: 'Issued'
    });

    await issue.save();
    await issue.populate([
      { path: 'project', select: 'name projectId' },
      { path: 'requestedBy', select: 'firstName lastName' },
      { path: 'issuedBy', select: 'firstName lastName' },
      { path: 'costCenter', select: 'code name department' },
      {
        path: 'items.inventoryItem',
        populate: [
          { path: 'inventoryCategory', select: 'name stockValuationAccount stockInputAccount stockOutputAccount' },
          { path: 'inventoryAccount grniAccount cogsAccount', select: 'accountNumber name type' }
        ]
      }
    ]);

    // COGS / inventory GL: GoodsIssue post-save hook calls postSINJournal per item — do not also postCOGSJournal here (duplicate JE).

    res.status(201).json({
      success: true,
      message: 'Store Issue Note created successfully and inventory updated',
      data: issue
    });
  })
);

// ==================== STOCK BALANCE ROUTES ====================

// @route   GET /api/procurement/stock-balance
// @desc    Get project-wise stock balances. storeId (ObjectId) is preferred; falls back to first active store.
// @access  Private
router.get('/stock-balance',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const { storeId, project, item } = req.query;

    if (!project) {
      return res.status(400).json({ success: false, message: 'Project ID is required' });
    }

    const projectDoc = await Project.findById(project);
    if (!projectDoc) {
      return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    // Resolve store ObjectId — if not provided, use the default (first active) store
    const Store = require('../models/procurement/Store');
    let resolvedStoreId = storeId;
    let storeLabel = 'All Stores';
    if (!resolvedStoreId) {
      const defaultStore = await Store.findOne({ isActive: true }).sort({ type: 1, createdAt: 1 }).select('_id name').lean();
      if (defaultStore) {
        resolvedStoreId = defaultStore._id;
        storeLabel = defaultStore.name;
      }
    } else {
      const storeDoc = await Store.findById(resolvedStoreId).select('name').lean();
      if (storeDoc) storeLabel = storeDoc.name;
    }

    if (item) {
      const balance = await StockTransaction.getBalance(resolvedStoreId, project, item);
      res.json({
        success: true,
        data: {
          store: { _id: resolvedStoreId, name: storeLabel },
          project: { _id: projectDoc._id, name: projectDoc.name, projectId: projectDoc.projectId },
          item,
          balance
        }
      });
    } else {
      const balances = await StockTransaction.getProjectBalances(resolvedStoreId, project);
      res.json({
        success: true,
        data: {
          store: { _id: resolvedStoreId, name: storeLabel },
          project: { _id: projectDoc._id, name: projectDoc.name, projectId: projectDoc.projectId },
          balances
        }
      });
    }
  })
);

// @route   GET /api/procurement/inventory/:id/barcode
// @desc    Get barcode data for an inventory item (for label printing)
// @access  Private
router.get('/inventory/:id/barcode',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const item = await Inventory.findById(req.params.id)
      .select('_id itemCode name unit barcode barcodeType location')
      .lean();

    if (!item) {
      return res.status(404).json({ success: false, message: 'Inventory item not found' });
    }

    if (!item.barcode) {
      // Generate on-demand if missing
      const barcodeValue = await Inventory.generateBarcodeValue(item.itemCode);
      await Inventory.findByIdAndUpdate(item._id, { barcode: barcodeValue });
      item.barcode = barcodeValue;
    }

    res.json({
      success: true,
      data: {
        _id: item._id,
        itemCode: item.itemCode,
        name: item.name,
        unit: item.unit,
        barcode: item.barcode,
        barcodeType: item.barcodeType || 'CODE128',
        location: item.location
      }
    });
  })
);

// ==================== COST CENTERS ROUTES ====================

// Helper function to build cost center path and level
async function computeCostCenterHierarchy(parentId, currentName) {
  if (!parentId) {
    return { level: 0, path: currentName };
  }
  const parentDoc = await CostCenter.findById(parentId);
  if (!parentDoc) {
    return { level: 0, path: currentName };
  }
  const parentPath = parentDoc.path || parentDoc.name;
  return {
    level: (parentDoc.level || 0) + 1,
    path: `${parentPath} / ${currentName}`
  };
}

// @route   GET /api/procurement/cost-centers/next-code
// @desc    Generate next auto-incremented cost center code dynamically (+1)
// @access  Private
router.get('/cost-centers/next-code',
  authorize('super_admin', 'admin', 'procurement_manager', 'hr_manager', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { parentId } = req.query;
    
    let prefix = 'CC-';
    if (parentId) {
      const parentDoc = await CostCenter.findById(parentId).lean();
      if (parentDoc && parentDoc.code) {
        // Strip trailing hyphen/number if any, or append clean separator
        prefix = `${parentDoc.code}-`;
      }
    }

    // Find all cost centers with matching prefix
    const regex = new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'i');
    const existing = await CostCenter.find({ code: regex }).select('code').lean();
    let maxNum = 0;

    existing.forEach((item) => {
      const remainder = item.code.slice(prefix.length);
      const match = remainder.match(/^(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });

    // If no existing code with that prefix found and it's root
    if (maxNum === 0 && !parentId) {
      const allCC = await CostCenter.find({}).select('code').lean();
      allCC.forEach((item) => {
        const match = item.code.match(/(\d+)$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      });
    }

    const nextNumber = maxNum + 1;
    const padded = String(nextNumber).padStart(3, '0');
    const nextCode = `${prefix}${padded}`;

    res.json({
      success: true,
      data: {
        code: nextCode,
        nextNumber,
        prefix
      }
    });
  })
);

// @route   GET /api/procurement/cost-centers
// @desc    Get all cost centers (flat with pagination or full tree)
// @access  Private
router.get('/cost-centers',
  authorize('super_admin', 'admin', 'procurement_manager', 'hr_manager', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, search, department, company, project, tree, activeOnly } = req.query;
    
    const query = {};
    if (activeOnly === 'true') {
      query.isActive = true;
    }
    if (department) {
      query.department = department;
    }
    if (company) {
      query.company = company;
    }
    if (project) {
      query.project = project;
    }
    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { path: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // If tree view requested or all items needed for hierarchy
    if (tree === 'true' || limit === 'all' || limit === '0') {
      const allCostCenters = await CostCenter.find(query)
        .populate('manager', 'firstName lastName email name')
        .populate('department', 'name code')
        .populate('company', 'name code companyCode')
        .populate('project', 'name code')
        .populate('parent', 'name code path')
        .sort({ level: 1, name: 1 })
        .lean();

      return res.json({
        success: true,
        data: {
          costCenters: allCostCenters,
          total: allCostCenters.length
        }
      });
    }
    
    const costCenters = await CostCenter.find(query)
      .populate('manager', 'firstName lastName email name')
      .populate('department', 'name code')
      .populate('company', 'name code companyCode')
      .populate('project', 'name code')
      .populate('parent', 'name code path')
      .sort({ path: 1, code: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();
    
    const total = await CostCenter.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        costCenters,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/procurement/cost-centers/:id
// @desc    Get single cost center
// @access  Private
router.get('/cost-centers/:id',
  authorize('super_admin', 'admin', 'procurement_manager', 'hr_manager', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const costCenter = await CostCenter.findById(req.params.id)
      .populate('manager', 'firstName lastName email name')
      .populate('department', 'name code')
      .populate('company', 'name code companyCode')
      .populate('project', 'name code')
      .populate('parent', 'name code path')
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');
    
    if (!costCenter) {
      return res.status(404).json({ success: false, message: 'Cost center not found' });
    }
    
    res.json({ success: true, data: costCenter });
  })
);

// @route   POST /api/procurement/cost-centers
// @desc    Create cost center (with optional parent hierarchy)
// @access  Private
router.post('/cost-centers',
  authorize('super_admin', 'admin', 'procurement_manager', 'hr_manager', 'finance_manager'),
  [
    body('code').trim().notEmpty().withMessage('Cost center code is required'),
    body('name').trim().notEmpty().withMessage('Cost center name is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    
    const {
      code, name, description, parent, company, project,
      department, departmentName, location, manager, managerName,
      budget, budgetPeriod, isActive, notes
    } = req.body;
    
    const existingCode = await CostCenter.findOne({ code: code.toUpperCase() });
    if (existingCode) {
      return res.status(400).json({ success: false, message: 'Cost center code already exists' });
    }
    
    const parentId = parent && parent.trim() !== '' ? parent : null;
    const { level, path } = await computeCostCenterHierarchy(parentId, name.trim());

    const deptId = department && department.trim() !== '' ? department : null;
    const companyId = company && company.trim() !== '' ? company : null;
    const projectId = project && project.trim() !== '' ? project : null;
    const managerId = manager && manager.trim() !== '' ? manager : null;
    
    const costCenter = new CostCenter({
      code: code.toUpperCase(),
      name: name.trim(),
      description,
      parent: parentId,
      company: companyId,
      project: projectId,
      level,
      path,
      department: deptId,
      departmentName: departmentName || '',
      location,
      manager: managerId,
      managerName: managerName || '',
      budget: budget || 0,
      budgetPeriod: budgetPeriod || 'Annual',
      isActive: isActive !== undefined ? isActive : true,
      notes,
      createdBy: req.user.id
    });
    
    await costCenter.save();
    await costCenter.populate('manager', 'firstName lastName name');
    await costCenter.populate('department', 'name code');
    await costCenter.populate('company', 'name code companyCode');
    await costCenter.populate('project', 'name code');
    await costCenter.populate('parent', 'name code path');
    
    res.status(201).json({
      success: true,
      message: 'Cost center created successfully',
      data: costCenter
    });
  })
);

// @route   PUT /api/procurement/cost-centers/:id
// @desc    Update cost center
// @access  Private
router.put('/cost-centers/:id',
  authorize('super_admin', 'admin', 'procurement_manager', 'hr_manager', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const costCenter = await CostCenter.findById(req.params.id);
    
    if (!costCenter) {
      return res.status(404).json({ success: false, message: 'Cost center not found' });
    }
    
    const {
      code, name, description, parent, company, project,
      department, departmentName, location, manager, managerName,
      budget, budgetPeriod, isActive, notes
    } = req.body;
    
    if (code && code.toUpperCase() !== costCenter.code) {
      const existingCode = await CostCenter.findOne({ code: code.toUpperCase() });
      if (existingCode) {
        return res.status(400).json({ success: false, message: 'Cost center code already exists' });
      }
      costCenter.code = code.toUpperCase();
    }
    
    if (name) costCenter.name = name.trim();
    if (description !== undefined) costCenter.description = description;

    // Hierarchy cycle check: parent cannot be this cost center or its descendant
    if (parent !== undefined) {
      const newParentId = parent && parent.trim() !== '' ? parent : null;
      if (newParentId) {
        if (String(newParentId) === String(costCenter._id)) {
          return res.status(400).json({ success: false, message: 'A cost center cannot be its own parent' });
        }
        // Check if new parent is a descendant of this cost center
        let curr = await CostCenter.findById(newParentId);
        while (curr && curr.parent) {
          if (String(curr.parent) === String(costCenter._id)) {
            return res.status(400).json({ success: false, message: 'Cannot set a child/descendant cost center as parent' });
          }
          curr = await CostCenter.findById(curr.parent);
        }
      }
      costCenter.parent = newParentId;
    }

    const { level, path } = await computeCostCenterHierarchy(costCenter.parent, costCenter.name);
    costCenter.level = level;
    costCenter.path = path;

    if (company !== undefined) costCenter.company = company && company.trim() !== '' ? company : null;
    if (project !== undefined) costCenter.project = project && project.trim() !== '' ? project : null;
    if (department !== undefined) costCenter.department = department && department.trim() !== '' ? department : null;
    if (departmentName !== undefined) costCenter.departmentName = departmentName;
    if (location !== undefined) costCenter.location = location;
    if (manager !== undefined) costCenter.manager = manager && manager.trim() !== '' ? manager : null;
    if (managerName !== undefined) costCenter.managerName = managerName;
    if (budget !== undefined) costCenter.budget = budget;
    if (budgetPeriod) costCenter.budgetPeriod = budgetPeriod;
    if (isActive !== undefined) costCenter.isActive = isActive;
    if (notes !== undefined) costCenter.notes = notes;
    costCenter.updatedBy = req.user.id;
    
    await costCenter.save();
    await costCenter.populate('manager', 'firstName lastName name');
    await costCenter.populate('department', 'name code');
    await costCenter.populate('company', 'name code companyCode');
    await costCenter.populate('project', 'name code');
    await costCenter.populate('parent', 'name code path');
    
    res.json({
      success: true,
      message: 'Cost center updated successfully',
      data: costCenter
    });
  })
);

// @route   DELETE /api/procurement/cost-centers/:id
// @desc    Delete cost center
// @access  Private (Admin only)
router.delete('/cost-centers/:id',
  authorize('super_admin', 'admin', 'hr_manager', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const costCenter = await CostCenter.findById(req.params.id);
    
    if (!costCenter) {
      return res.status(404).json({ success: false, message: 'Cost center not found' });
    }

    // Check if this cost center has children
    const childCount = await CostCenter.countDocuments({ parent: costCenter._id });
    if (childCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete cost center. It has ${childCount} sub-cost center(s). Delete or reassign children first.`
      });
    }
    
    // Check if cost center is used in goods issues
    const GoodsIssue = require('../models/procurement/GoodsIssue');
    const usageCount = await GoodsIssue.countDocuments({ costCenter: costCenter._id });
    
    if (usageCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete cost center. It is used in ${usageCount} goods issue(s).`
      });
    }
    
    await CostCenter.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Cost center deleted successfully'
    });
  })
);

// ==================== REQUISITIONS ROUTES (Proxy to Indents) ====================

// @route   POST /api/procurement/requisitions/send-email
// @desc    Send requisition to vendors via email (optional: paymentTerms, attachment)
// @access  Private (Procurement and Admin)
router.post('/requisitions/send-email',
  authorize('super_admin', 'admin', 'procurement_manager'),
  requisitionEmailAttachmentUpload.single('attachment'),
  [
    body('requisitionId').isMongoId().withMessage('Valid requisition ID is required'),
    body('vendorIds').optional(), // can be array (JSON) or string (multipart)
    body('paymentTerms').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { requisitionId, vendorIds: vendorIdsRaw, paymentTerms } = req.body;
    const attachment = req.file; // { buffer, originalname } if present
    const vendorIds = Array.isArray(vendorIdsRaw) ? vendorIdsRaw : (typeof vendorIdsRaw === 'string' ? JSON.parse(vendorIdsRaw) : []);
    if (!vendorIds.length) {
      return res.status(400).json({ success: false, message: 'At least one vendor must be selected' });
    }

    // Get requisition (indent)
    const indent = await Indent.findById(requisitionId)
      .populate('department', 'name')
      .populate('requestedBy', 'firstName lastName email');

    if (!indent) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Guard: requisition cannot move to quotation/email stage before approval
    if (indent.status !== 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved requisitions can be sent to vendors.'
      });
    }

    if (indent.storeRoutingStatus !== 'moved_to_procurement') {
      return res.status(400).json({
        success: false,
        message: 'Requisition is not yet available in Procurement.'
      });
    }

    if (indent.procurementAssignment?.status !== 'assigned' || !indent.procurementAssignment?.assignedTo) {
      return res.status(400).json({
        success: false,
        message: 'Requisition must be assigned by Senior Manager Procurement before sending to vendors.'
      });
    }

    if (!canOperateAssignedProcurementRequisition(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned procurement user or an assignment manager can send this requisition to vendors.'
      });
    }

    // Get vendors
    const vendors = await Supplier.find({ _id: { $in: vendorIds } });

    if (vendors.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No vendors found'
      });
    }

    // Create quotation invitations and send emails
    const emailService = require('../services/emailService');
    const results = [];

    for (const vendor of vendors) {
      try {
        // Check if invitation already exists
        let invitation = await QuotationInvitation.findOne({
          indent: requisitionId,
          vendor: vendor._id,
          status: 'Pending'
        });

        // Create new invitation if doesn't exist
        if (!invitation) {
          invitation = new QuotationInvitation({
            indent: requisitionId,
            vendor: vendor._id,
            email: vendor.email
          });
          await invitation.save();
        }

        // Send email with invitation token (optional payment terms and attachment)
        const emailResult = await emailService.sendRequisitionEmail(vendor, indent, invitation.token, {
          paymentTerms: paymentTerms || undefined,
          attachment: attachment ? { buffer: attachment.buffer, filename: attachment.originalname } : undefined
        });
        results.push({
          vendorId: vendor._id,
          vendorName: vendor.name,
          email: vendor.email,
          success: emailResult.success,
          messageId: emailResult.messageId,
          invitationId: invitation._id,
          error: emailResult.error
        });
      } catch (error) {
        results.push({
          vendorId: vendor._id,
          vendorName: vendor.name,
          email: vendor.email,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: `Requisition sent to ${successCount} vendor(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
      data: {
        results,
        summary: {
          total: vendors.length,
          success: successCount,
          failed: failCount
        }
      }
    });
  })
);

// @route   GET /api/procurement/requisitions
// @desc    Get all requisitions (indents) with pagination and filters
// @access  Private (Procurement and Admin)
router.get('/requisitions', 
  authMiddleware,
  asyncHandler(async (req, res) => {
    const hasFullProcurementRead = hasProcurementAccess(req.user);
    const requesterId = String(req.user?._id || req.user?.id || '');

    const { 
      page = 1, 
      limit = 10, 
      status,
      search,
      department,
      assignmentStatus,
      assignee,
      mineOnly,
      forRequisition
    } = req.query;

    const filter = { isActive: true };

    if (status) {
      if (['Draft', 'Submitted', 'Under Review', 'Rejected'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Only approved requisitions can move forward in procurement.'
        });
      }
      filter.status = status;
    } else {
      // Default to forward-eligible requisitions only
      filter.status = { $in: ['Approved', 'Partially Fulfilled', 'Fulfilled'] };
    }
    if (department) filter.department = department;
    if (assignmentStatus && ['assigned', 'unassigned'].includes(assignmentStatus)) {
      filter['procurementAssignment.status'] = assignmentStatus;
    }
    if (assignee && mongoose.Types.ObjectId.isValid(assignee)) {
      filter['procurementAssignment.assignedTo'] = assignee;
    }

    const isForRequisition = String(forRequisition).toLowerCase() === 'true';

    // Procurement requisitions screen should only show indents that Store explicitly moved to Procurement.
    filter.$and = isForRequisition
      ? [{ storeRoutingStatus: 'moved_to_procurement' }]
      : [
          {
            $or: [
              { storeRoutingStatus: { $ne: 'pending_store_check' } },
              { storeRoutingStatus: null }
            ]
          }
        ];

    if (search) {
      filter.$and.push({
        $or: [
          { indentNumber: new RegExp(search, 'i') },
          { title: new RegExp(search, 'i') },
          { description: new RegExp(search, 'i') }
        ]
      });
    }

    const isManager = canManageProcurementAssignments(req.user);
    if (String(mineOnly).toLowerCase() === 'true') {
      filter['procurementAssignment.assignedTo'] = req.user._id || req.user.id;
    }

    // Relaxed read-access for Comparative approvers:
    // users without procurement role can still view only requisitions where
    // they are configured as comparative approver.
    if (!hasFullProcurementRead) {
      if (!requesterId || !mongoose.Types.ObjectId.isValid(requesterId)) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to view procurement requisitions.'
        });
      }
      filter['comparativeApproval.approvers.approver'] = new mongoose.Types.ObjectId(requesterId);
      // Comparative approvers should only see records participating in comparative flow.
      filter['comparativeApproval.status'] = { $in: ['submitted', 'approved', 'rejected', 'draft'] };
    }

    const skip = (page - 1) * limit;

    const sortSpec = isForRequisition
      ? { movedToProcurementAt: -1, createdAt: -1 }
      : { createdAt: -1 };

    const indents = await Indent.find(filter)
      .populate('department', 'name code')
      .populate('requestedBy', 'firstName lastName email employeeId digitalSignature')
      .populate('approvedBy', 'firstName lastName email digitalSignature')
      .populate('movedToProcurementBy', 'firstName lastName email')
      .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('procurementAssignment.assignedTo', 'firstName lastName email department position role')
      .populate('procurementAssignment.assignedBy', 'firstName lastName email')
      .populate('procurementRejection.rejectedBy', 'firstName lastName email')
      .sort(sortSpec)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Indent.countDocuments(filter);

    res.json({
      success: true,
      data: {
        canManageAssignments: hasFullProcurementRead ? isManager : false,
        indents,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/procurement/requisitions/assignees
// @desc    Get active procurement users available for assignment
// @access  Private (Procurement and Admin)
router.get('/requisitions/assignees',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!canManageProcurementAssignments(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to manage requisition assignments.'
      });
    }

    const users = await User.find({
      isActive: true,
      department: { $regex: '^procurement$', $options: 'i' }
    })
      .select('firstName lastName email employeeId role roleRef roles department position')
      .populate('roleRef', 'name displayName permissions isActive')
      .populate('roles', 'name displayName permissions isActive')
      .lean();

    const assignees = users
      .filter((user) => hasProcurementAccess(user))
      .map((user) => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        employeeId: user.employeeId,
        role: user.role,
        department: user.department,
        position: user.position
      }));

    res.json({
      success: true,
      data: assignees
    });
  })
);

// @route   PUT /api/procurement/requisitions/:id/assign
// @desc    Assign procurement requisition to a procurement user
// @access  Private (Assignment manager only)
router.put('/requisitions/:id/assign',
  authMiddleware,
  [
    body('assigneeId').isMongoId().withMessage('Valid assignee ID is required'),
    body('note').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    if (!canManageProcurementAssignments(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to assign requisitions.'
      });
    }

    const { assigneeId, note = '' } = req.body;
    const indent = await Indent.findById(req.params.id);
    if (!indent) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    if (!['Approved', 'Partially Fulfilled', 'Fulfilled'].includes(indent.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only approved requisitions can be assigned.'
      });
    }

    if (indent.storeRoutingStatus !== 'moved_to_procurement') {
      return res.status(400).json({
        success: false,
        message: 'Requisition is not yet moved to procurement.'
      });
    }

    const assignee = await User.findById(assigneeId)
      .select('firstName lastName email employeeId role roleRef roles department position isActive')
      .populate('roleRef', 'name displayName permissions isActive')
      .populate('roles', 'name displayName permissions isActive');

    if (!assignee || !assignee.isActive || !hasProcurementAccess(assignee)) {
      return res.status(400).json({
        success: false,
        message: 'Assignee must be an active procurement user.'
      });
    }

    indent.procurementAssignment = indent.procurementAssignment || {};
    indent.procurementAssignment.status = 'assigned';
    indent.procurementAssignment.assignedTo = assignee._id;
    indent.procurementAssignment.assignedBy = req.user.id;
    indent.procurementAssignment.assignedAt = new Date();
    indent.procurementAssignment.note = note;
    indent.procurementAssignment.history = Array.isArray(indent.procurementAssignment.history)
      ? indent.procurementAssignment.history
      : [];
    indent.procurementAssignment.history.push({
      assignedTo: assignee._id,
      assignedBy: req.user.id,
      assignedAt: new Date(),
      note
    });
    indent.updatedBy = req.user.id;
    await indent.save();

    const updated = await Indent.findById(indent._id)
      .populate('department', 'name code')
      .populate('requestedBy', 'firstName lastName email employeeId')
      .populate('procurementAssignment.assignedTo', 'firstName lastName email employeeId department position')
      .populate('procurementAssignment.assignedBy', 'firstName lastName email');

    await notifyDocumentRecipients({
      recipientIds: [assignee._id],
      actorId: req.user.id,
      title: 'New requisition assigned',
      message: `Requisition ${indent.indentNumber || ''} has been assigned to you.`,
      actionUrl: '/procurement/requisitions',
      entityId: indent._id,
      entityType: 'Indent',
      module: 'procurement'
    });

    res.json({
      success: true,
      message: 'Requisition assigned successfully.',
      data: updated
    });
  })
);

// @route   PUT /api/procurement/requisitions/:id/comparative-approvers
// @desc    Configure comparative statement approvers (non-sequential) for a requisition
// @access  Private (assigned user or assignment manager)
router.put('/requisitions/:id/comparative-approvers',
  authMiddleware,
  [
    body('approverIds').isArray({ min: 1 }).withMessage('At least one approver is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const indent = await Indent.findById(req.params.id);
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }
    if (!canOperateAssignedProcurementRequisition(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned procurement user or an assignment manager can configure approvers.'
      });
    }
    if (!['Approved', 'Partially Fulfilled', 'Fulfilled'].includes(indent.status) || indent.storeRoutingStatus !== 'moved_to_procurement') {
      return res.status(400).json({
        success: false,
        message: 'Requisition must be in procurement stage to configure comparative approvers.'
      });
    }

    const approverIds = [...new Set((req.body.approverIds || []).map((id) => String(id)).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
    if (approverIds.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one valid approver is required.' });
    }

    const activeUsers = await User.find({ _id: { $in: approverIds }, isActive: true }).select('_id');
    const activeIdSet = new Set(activeUsers.map((u) => String(u._id)));
    const filteredIds = approverIds.filter((id) => activeIdSet.has(id));
    if (filteredIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Selected approvers must be active users.' });
    }

    const targetLot = req.body.lotNumber || 'A';
    const ca = ensureComparativeApprovalObject(indent, targetLot);
    // Another lot already approved must not block setting up a new lot (e.g. Lot B after Lot A).
    const lotNeedsSetup = ['not_configured', 'draft', 'rejected'].includes(ca.status || 'not_configured');
    if (!lotNeedsSetup && !canMutateComparativeAuthorityUsers(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message:
          'Only Prepared By, Procurement Manager (GM), or Super Admin can change comparative approvers after approval authorities have been set.'
      });
    }
    const previousStatus = ca.status;
    ca.approvers = filteredIds.map((id) => ({
      approver: id,
      status: 'pending',
      actedAt: null,
      comment: ''
    }));
    ca.status = 'draft';
    ca.submittedBy = null;
    ca.submittedAt = null;
    ca.rejectedBy = null;
    ca.rejectedAt = null;
    ca.rejectionObservation = '';
    indent.comparativeApproval = ca;
    indent.markModified('comparativeApprovals');
    indent.markModified('comparativeApproval');
    indent.updatedBy = req.user.id;

    pushIndentWorkflowHistory(indent, {
      fromStatus: `Comparative Approval: ${previousStatus}`,
      toStatus: 'Comparative Approval: draft',
      changedBy: req.user.id,
      comments: `Comparative approvers configured (${filteredIds.length} approver${filteredIds.length > 1 ? 's' : ''}).`,
      module: 'Procurement'
    });

    await indent.save();

    const updated = await Indent.findById(indent._id)
      .populate('comparativeStatementApprovals.preparedByUser', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeStatementApprovals.managerProcurementUser', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeApproval.approvers.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeApprovals.approvers.approver', 'firstName lastName email employeeId digitalSignature');

    res.json({
      success: true,
      message: 'Comparative approvers configured successfully.',
      data: updated
    });
  })
);

// @route   POST /api/procurement/requisitions/:id/comparative-submit
// @desc    Submit comparative statement for approvals (non-sequential)
// @access  Private (assigned user or assignment manager)
router.post('/requisitions/:id/comparative-submit',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id);
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }
    if (!canOperateAssignedProcurementRequisition(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned procurement user or an assignment manager can submit comparative statement.'
      });
    }

    const ca = ensureComparativeApprovalObject(indent, req.body.lotNumber || 'A');
    if (!Array.isArray(ca.approvers) || ca.approvers.length === 0) {
      return res.status(400).json({ success: false, message: 'Configure comparative approvers first.' });
    }
    if (ca.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: `Comparative statement for Lot ${ca.lotNumber || 'A'} is already approved.`
      });
    }
    if (ca.status === 'submitted') {
      return res.status(400).json({
        success: false,
        message: `Comparative statement for Lot ${ca.lotNumber || 'A'} is already submitted for approval.`
      });
    }

    const previousStatus = ca.status;
    const resolutionNote = String(req.body?.resolutionNote || '').trim();
    if (resolutionNote && Array.isArray(ca.rejectionObservations) && ca.rejectionObservations.length > 0) {
      ca.rejectionObservations = ca.rejectionObservations.map((obs) => {
        if (obs?.resolvedAt) return obs;
        return {
          ...obs,
          resolutionNote,
          resolvedBy: req.user.id,
          resolvedAt: new Date()
        };
      });
    }
    // After a rejection, keep existing approvals and only reopen rejected (and still-pending) steps.
    // First-time submit / draft: all approvers start as pending.
    if (previousStatus === 'rejected') {
      ca.approvers = ca.approvers.map((s) => {
        const approverRef = toApproverObjectId(s.approver);
        if (s.status === 'approved') {
          return {
            approver: approverRef,
            status: 'approved',
            actedAt: s.actedAt || null,
            comment: s.comment || ''
          };
        }
        return {
          approver: approverRef,
          status: 'pending',
          actedAt: null,
          comment: ''
        };
      });
    } else {
      ca.approvers = ca.approvers.map((s) => ({
        approver: toApproverObjectId(s.approver),
        status: 'pending',
        actedAt: null,
        comment: ''
      }));
    }
    ca.status = 'submitted';
    if (!ca.submittedAt) ca.submittedAt = new Date();
    else ca.lastResubmittedAt = new Date();
    ca.submittedBy = req.user.id;
    ca.rejectedBy = null;
    ca.rejectedAt = null;
    ca.rejectionObservation = '';
    indent.updatedBy = req.user.id;

    pushIndentWorkflowHistory(indent, {
      fromStatus: `Comparative Approval: ${previousStatus}`,
      toStatus: 'Comparative Approval: submitted',
      changedBy: req.user.id,
      comments:
        previousStatus === 'rejected'
          ? (resolutionNote
            ? `Comparative statement resubmitted (prior approvals preserved). Resolution: ${resolutionNote}`
            : 'Comparative statement resubmitted (prior approvals preserved).')
          : (resolutionNote
            ? `Comparative statement submitted for approvals. Resolution: ${resolutionNote}`
            : 'Comparative statement submitted for approvals.'),
      module: 'Procurement'
    });

    indent.markModified('comparativeApprovals');
    indent.markModified('comparativeApproval');
    await indent.save();

    const pendingApproverIds = [
      ...new Set(
        ca.approvers
          .filter((s) => s.status === 'pending')
          .map((s) => s.approver)
          .filter(Boolean)
          .map((id) => String(id))
      )
    ];
    if (pendingApproverIds.length > 0) {
      await notifyDocumentRecipients({
        recipientIds: pendingApproverIds,
        actorId: req.user.id,
        title:
          previousStatus === 'rejected'
            ? 'Comparative Statement resubmitted — approval needed'
            : 'Comparative Statement needs your approval',
        message:
          previousStatus === 'rejected'
            ? `Requisition ${indent.indentNumber || ''} Lot ${ca.lotNumber || 'A'} comparative was resubmitted. Only approvers with a pending step need to act (previous approvals are kept).`
            : `Requisition ${indent.indentNumber || ''} Lot ${ca.lotNumber || 'A'} comparative statement is submitted for approval.`,
        actionUrl: '/procurement/comparative-statements',
        entityId: indent._id,
        entityType: 'Indent',
        module: 'procurement'
      });
      notifyApprovers(pendingApproverIds, { docType: 'Requisition', docNumber: indent.indentNumber || '', fromUser: req.user }).catch(() => {});
      notifyChatApprovers(pendingApproverIds, { docType: 'Requisition', docNumber: indent.indentNumber || '', url: '/general/indents', fromUser: req.user }).catch(() => {});
    }

    const updated = await Indent.findById(indent._id)
      .populate('comparativeApprovals.approvers.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeApproval.approvers.approver', 'firstName lastName email employeeId digitalSignature');

    res.json({
      success: true,
      message: `Lot ${ca.lotNumber || 'A'} comparative statement submitted for approvals.`,
      data: updated
    });
  })
);

// @route   POST /api/procurement/requisitions/:id/comparative-approve
// @desc    Approve comparative statement as one of selected approvers (non-sequential)
// @access  Private (selected approver)
router.post('/requisitions/:id/comparative-approve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id);
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }
    const ca = ensureComparativeApprovalObject(indent, req.body.lotNumber || 'A');
    if (ca.status !== 'submitted') {
      return res.status(400).json({ success: false, message: 'Comparative statement is not awaiting approval.' });
    }

    const uid = String(req.user._id || req.user.id || '');
    const idx = ca.approvers.findIndex(
      (s) => comparativeApproverStepUserIdString(s) === uid && s.status === 'pending'
    );
    if (idx === -1) {
      return res.status(403).json({ success: false, message: 'You are not a pending approver for this comparative statement.' });
    }

    // Enforce Prepared By first approval (if configured as an approver)
    const rawPb = indent?.comparativeStatementApprovals?.preparedByUser;
    const preparedById = rawPb != null ? comparativeApproverStepUserIdString({ approver: rawPb }) : '';
    if (preparedById && uid !== preparedById) {
      const preparedStep = ca.approvers.find((s) => comparativeApproverStepUserIdString(s) === preparedById);
      if (preparedStep && preparedStep.status !== 'approved') {
        return res.status(400).json({
          success: false,
          message: 'Prepared By must approve first before other approvers can act.'
        });
      }
    }

    ca.approvers[idx].status = 'approved';
    ca.approvers[idx].actedAt = new Date();
    ca.approvers[idx].comment = '';

    const allApproved = ca.approvers.every((s) => s.status === 'approved');
    const previousStatus = ca.status;
    if (allApproved) ca.status = 'approved';

    pushIndentWorkflowHistory(indent, {
      fromStatus: `Comparative Approval: ${previousStatus}`,
      toStatus: `Comparative Approval: ${ca.status}`,
      changedBy: req.user.id,
      comments: allApproved
        ? 'Comparative statement fully approved by all selected approvers.'
        : 'Comparative statement approved by one approver.',
      module: 'Procurement'
    });

    indent.updatedBy = req.user.id;
    await indent.save();

    if (allApproved) {
      // Lot-based rule: at most one Finalized quotation per lot.
      // Auto-finalize only when exactly one Shortlisted winner exists for this lot.
      // Multiple Shortlisted (split-PO assignments) stay Shortlisted — do not bulk-finalize.
      const approvedLot = ca.lotNumber || req.body.lotNumber || 'A';
      const lotFilter = quotationLotFilter(approvedLot);

      const alreadyFinalized = await Quotation.findOne({
        indent: indent._id,
        status: 'Finalized',
        ...lotFilter
      })
        .select('_id')
        .lean();

      if (!alreadyFinalized) {
        const shortlistedForLot = await Quotation.find({
          indent: indent._id,
          status: 'Shortlisted',
          ...lotFilter
        })
          .select('_id')
          .lean();

        if (shortlistedForLot.length === 1) {
          await Quotation.updateOne(
            { _id: shortlistedForLot[0]._id },
            { $set: { status: 'Finalized' } }
          );
        } else if (shortlistedForLot.length === 0 && indent.splitPOAssignments && typeof indent.splitPOAssignments === 'object') {
          // Fallback: assignments saved but quotes not re-tagged — finalize only if a single vendor for this lot.
          const rawIds = [...new Set(Object.values(indent.splitPOAssignments))];
          const ids = rawIds
            .map((id) => (mongoose.Types.ObjectId.isValid(String(id)) ? String(id) : null))
            .filter(Boolean);
          if (ids.length) {
            const assignedForLot = await Quotation.find({
              _id: { $in: ids },
              indent: indent._id,
              ...lotFilter
            })
              .select('_id')
              .lean();
            if (assignedForLot.length === 1) {
              await Quotation.updateOne(
                { _id: assignedForLot[0]._id },
                { $set: { status: 'Finalized' } }
              );
            }
          }
        }
      }

      const recipients = [indent.requestedBy, procurementAssigneeId(indent)].filter(Boolean);
      await notifyDocumentRecipients({
        recipientIds: recipients,
        actorId: req.user.id,
        title: 'Comparative Statement approved',
        message: `Requisition ${indent.indentNumber || ''} comparative statement is fully approved. You can now create PO/Split PO.`,
        actionUrl: '/procurement/comparative-statements',
        entityId: indent._id,
        entityType: 'Indent',
        module: 'procurement'
      });
    }

    const updated = await Indent.findById(indent._id)

    res.json({
      success: true,
      message: allApproved ? 'Comparative statement fully approved.' : 'Your approval has been recorded.',
      data: updated
    });
  })
);

// @route   POST /api/procurement/requisitions/:id/comparative-reject
// @desc    Reject comparative statement with observation
// @access  Private (selected approver)
router.post('/requisitions/:id/comparative-reject',
  authMiddleware,
  [
    body('observation')
      .trim()
      .notEmpty()
      .withMessage('Observation is required')
      .isLength({ max: 1000 })
      .withMessage('Observation cannot exceed 1000 characters')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const indent = await Indent.findById(req.params.id);
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    const ca = ensureComparativeApprovalObject(indent, req.body.lotNumber || 'A');
    if (ca.status !== 'submitted') {
      return res.status(400).json({ success: false, message: 'Comparative statement is not awaiting approval.' });
    }

    const uid = String(req.user._id || req.user.id || '');
    const idx = ca.approvers.findIndex(
      (s) => comparativeApproverStepUserIdString(s) === uid && s.status === 'pending'
    );
    if (idx === -1) {
      return res.status(403).json({ success: false, message: 'You are not a pending approver for this comparative statement.' });
    }

    // Enforce Prepared By first action (if configured as an approver)
    const rawPb = indent?.comparativeStatementApprovals?.preparedByUser;
    const preparedById = rawPb != null ? comparativeApproverStepUserIdString({ approver: rawPb }) : '';
    if (preparedById && uid !== preparedById) {
      const preparedStep = ca.approvers.find((s) => comparativeApproverStepUserIdString(s) === preparedById);
      if (preparedStep && preparedStep.status !== 'approved') {
        return res.status(400).json({
          success: false,
          message: 'Prepared By must approve first before other approvers can act.'
        });
      }
    }

    const observation = String(req.body.observation || '').trim();
    ca.approvers[idx].status = 'rejected';
    ca.approvers[idx].actedAt = new Date();
    ca.approvers[idx].comment = observation;
    const previousStatus = ca.status;
    ca.status = 'rejected';
    ca.rejectedBy = req.user.id;
    ca.rejectedAt = new Date();
    ca.rejectionObservation = observation;
    if (!Array.isArray(ca.rejectionObservations)) ca.rejectionObservations = [];
    ca.rejectionObservations.push({
      observation,
      rejectedBy: req.user.id,
      rejectedAt: new Date(),
      resolutionNote: '',
      resolvedBy: null,
      resolvedAt: null
    });

    pushIndentWorkflowHistory(indent, {
      fromStatus: `Comparative Approval: ${previousStatus}`,
      toStatus: 'Comparative Approval: rejected',
      changedBy: req.user.id,
      comments: `Comparative statement rejected with observation: ${observation}`,
      module: 'Procurement'
    });

    indent.updatedBy = req.user.id;
    await indent.save();

    const recipients = [indent.requestedBy, procurementAssigneeId(indent)].filter(Boolean);
    await notifyDocumentRecipients({
      recipientIds: recipients,
      actorId: req.user.id,
      title: 'Comparative Statement rejected',
      message: `Requisition ${indent.indentNumber || ''} comparative statement was rejected. Observation: ${observation}`,
      actionUrl: '/procurement/comparative-statements',
      entityId: indent._id,
      entityType: 'Indent',
      module: 'procurement'
    });

    const updated = await Indent.findById(indent._id)

    res.json({
      success: true,
      message: 'Comparative statement rejected. Requester can edit and resubmit with same approvers.',
      data: updated
    });
  })
);

// @route   DELETE /api/procurement/requisitions/:id/comparative-statement
// @desc    Developer option to delete POs, delete/reset comparative statement for a requisition and reset related quotations to Received status (preserving quotations)
// @access  Private (Developer only)
router.delete('/requisitions/:id/comparative-statement',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'developer' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only developer can delete / reset comparative statements and POs.'
      });
    }

    const targetLot = req.query.lot;

    const indent = await Indent.findById(req.params.id);
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    const indentId = indent._id;
    const indentNumber = indent.indentNumber || '';

    // Models for cascading deletion of Purchase Orders & downstream docs
    const InwardGatePass = mongoose.models.InwardGatePass || require('../models/procurement/InwardGatePass');
    const QualityInspection = mongoose.models.QualityInspection || require('../models/procurement/QualityInspection');
    const LandedCostVoucher = mongoose.models.LandedCostVoucher || require('../models/procurement/LandedCostVoucher');
    const PurchaseReturn = mongoose.models.PurchaseReturn || require('../models/procurement/PurchaseReturn');
    const VendorAdvance = mongoose.models.VendorAdvance || require('../models/finance/VendorAdvance');
    const ApPaymentApplication = mongoose.models.ApPaymentApplication || require('../models/finance/ApPaymentApplication');
    const JournalEntry = mongoose.models.JournalEntry || require('../models/finance/JournalEntry');
    const Notification = mongoose.models.Notification || require('../models/hr/Notification');
    const BOQItem = mongoose.models.BOQItem || require('../models/projectManagement/BOQItem');
    const ProjectExpense = mongoose.models.ProjectExpense || require('../models/projectManagement/ProjectExpense');
    const GoodsIssue = mongoose.models.GoodsIssue || require('../models/inventory/GoodsIssue');

    // 1. Identify Quotations to target
    let quotationQuery = { indent: indentId };
    if (targetLot) {
      quotationQuery = { indent: indentId, ...quotationLotFilter(targetLot) };
    }
    const targetQuotations = await Quotation.find(quotationQuery).select('_id').lean();
    const targetQuotationIds = targetQuotations.map(q => q._id);

    // 2. Find all POs linked to this indent (and target quotations if lot is provided)
    let poQuery = { indent: indentId };
    if (targetLot && targetQuotationIds.length > 0) {
      poQuery.quotation = { $in: targetQuotationIds };
    } else if (targetLot && targetQuotationIds.length === 0) {
      // No quotations found for this lot, so no POs to delete.
      poQuery._id = null; // force empty
    }

    const pos = await PurchaseOrder.find(poQuery).select('_id orderNumber poNumber').lean();
    const poIds = pos.map(p => p._id);
    const poNumbers = pos.map(p => p.orderNumber || p.poNumber).filter(Boolean);

    // 3. Find GRNs for these POs to delete LandedCostVouchers
    const grns = poIds.length ? await GoodsReceive.find({ purchaseOrder: { $in: poIds } }).select('_id').lean() : [];
    const grnIds = grns.map(g => g._id);

    // 4. Find Accounts Payable records for these POs
    const aps = poIds.length ? await AccountsPayable.find({
      $or: [
        { 'poDetails.poId': { $in: poIds } },
        { poId: { $in: poIds } }
      ]
    }).select('_id voucherEntryId').lean() : [];
    const apIds = aps.map(a => a._id);
    const apVoucherIds = aps.map(a => a.voucherEntryId).filter(Boolean);

    // 5. Delete LandedCostVouchers
    if (grnIds.length > 0) {
      await LandedCostVoucher.deleteMany({ goodsReceive: { $in: grnIds } });
    }

    // 6. Delete downstream PO documents
    if (poIds.length > 0) {
      await InwardGatePass.deleteMany({ purchaseOrder: { $in: poIds } });
      await GoodsReceive.deleteMany({ purchaseOrder: { $in: poIds } });
      await QualityInspection.deleteMany({ purchaseOrder: { $in: poIds } });
      await DeliveryChallan.deleteMany({ purchaseOrder: { $in: poIds } });
      await PurchaseReturn.deleteMany({ purchaseOrder: { $in: poIds } });
      await VendorAdvance.deleteMany({ purchaseOrder: { $in: poIds } });
      await ProjectExpense.deleteMany({ linkedPurchaseOrder: { $in: poIds } });
      await BOQItem.updateMany(
        { linkedPurchaseOrders: { $in: poIds } },
        { $pull: { linkedPurchaseOrders: { $in: poIds } } }
      );
    }

    // 7. Delete Goods Issues referencing these POs
    if (poIds.length > 0) {
      await GoodsIssue.deleteMany({ referencePurchaseOrder: { $in: poIds } });
    }

    // 8. Delete AP Payment Applications for these AP bills
    if (apIds.length > 0) {
      await ApPaymentApplication.deleteMany({ billId: { $in: apIds } });
    }

    // 9. Delete Accounts Payable bills for these POs
    if (apIds.length > 0 || poIds.length > 0) {
      await AccountsPayable.deleteMany({
        $or: [
          ...(apIds.length > 0 ? [{ _id: { $in: apIds } }] : []),
          ...(poIds.length > 0 ? [{ 'poDetails.poId': { $in: poIds } }, { poId: { $in: poIds } }] : [])
        ]
      });
    }

    // 10. Delete Journal Entries / Vouchers related to these POs
    const voucherRefs = [...poNumbers].filter(Boolean);
    if (apVoucherIds.length > 0 || poIds.length > 0 || voucherRefs.length > 0) {
      await JournalEntry.deleteMany({
        $or: [
          ...(apVoucherIds.length > 0 ? [{ _id: { $in: apVoucherIds } }] : []),
          ...(poIds.length > 0 ? [{ purchaseOrder: { $in: poIds } }] : []),
          ...(voucherRefs.length > 0 ? [{ 'lines.reference': { $in: voucherRefs } }] : [])
        ]
      });
    }

    // 11. Delete Purchase Orders
    if (poIds.length > 0) {
      await PurchaseOrder.deleteMany({ _id: { $in: poIds } });
    }

    // 12. Delete Notifications related to these POs
    if (poIds.length > 0) {
      await Notification.deleteMany({
        $or: [
          { 'data.purchaseOrderId': { $in: poIds } },
          { 'data.poId': { $in: poIds } }
        ]
      });
    }

    if (!targetLot) {
      // 13. Reset comparative approval object on Indent
      indent.comparativeApproval = {
        status: 'not_configured',
        approvers: [],
        submittedBy: null,
        submittedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionObservation: '',
        rejectionObservations: []
      };

      // 14. Reset comparative statement authority approvals if present
      indent.comparativeStatementApprovals = {
        preparedByUser: null,
        procurementManagerUser: null,
        auditOfficerUser: null,
        financeDirectorUser: null,
        cooUser: null,
        ceoUser: null
      };

      // 15. Reset split PO assignments
      indent.splitPOAssignments = {};

      if (Array.isArray(indent.items)) {
        indent.items.forEach(item => {
          item.orderedQuantity = 0;
        });
      }
      indent.status = 'Approved';
      indent.fulfilledDate = null;
    } else {
      if (Array.isArray(indent.comparativeApprovals)) {
        indent.comparativeApprovals = indent.comparativeApprovals.filter(ca => ca.lotNumber !== targetLot);
        if (indent.comparativeApprovals.length === 0) {
          indent.comparativeApproval = {
            status: 'not_configured',
            approvers: [],
            submittedBy: null,
            submittedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectionObservation: '',
            rejectionObservations: []
          };
        }
      }
      if (indent.splitPOAssignments) {
        let hasChanges = false;
        const newAssignments = { ...indent.splitPOAssignments };
        for (const [key, val] of Object.entries(newAssignments)) {
          if (targetQuotationIds.some(id => id.toString() === val.toString())) {
            delete newAssignments[key];
            hasChanges = true;
          }
        }
        if (hasChanges) {
          indent.splitPOAssignments = newAssignments;
          indent.markModified('splitPOAssignments');
        }
      }
    }

    indent.updatedBy = req.user.id;

    pushIndentWorkflowHistory(indent, {
      fromStatus: indent.status,
      toStatus: targetLot ? indent.status : 'Comparative Statement & PO Deleted / Reset',
      changedBy: req.user.id,
      comments: targetLot ? `Comparative statement and linked PO(s) for Lot ${targetLot} were deleted/reset by developer.` : 'Comparative statement and linked PO(s) were deleted/reset by developer. All related quotations kept and reset to Received.',
      module: 'Procurement'
    });

    await indent.save();

    // Recompute ordered quantities and fulfillment status dynamically
    await Indent.updateFulfillment(indent._id);

    // 16. Reset all related quotations to status 'Received'
    if (targetQuotationIds.length > 0) {
      await Quotation.updateMany(
        { _id: { $in: targetQuotationIds } },
        {
          $set: {
            status: 'Received',
            updatedBy: req.user.id
          }
        }
      );
    }

    const updatedIndent = await Indent.findById(indent._id)

    res.json({
      success: true,
      message: targetLot ? `Lot ${targetLot} PO(s) and Comparative Statement reset successfully.` : 'PO(s) and Comparative Statement deleted/reset successfully. Quotations have been preserved and reset to Received.',
      data: updatedIndent
    });
  })
);

// @route   PUT/POST /api/procurement/requisitions/:id/reject
// @desc    Reject requisition in procurement stage with observation
// @access  Private (Assignment manager only)
const rejectRequisitionValidators = [
  body('observation')
    .trim()
    .notEmpty()
    .withMessage('Observation is required')
    .isLength({ max: 1000 })
    .withMessage('Observation cannot exceed 1000 characters')
];

const rejectRequisitionHandler = asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    if (!canManageProcurementAssignments(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to reject requisitions.'
      });
    }

    const indent = await Indent.findById(req.params.id);
    if (!indent) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    if (!['Approved', 'Partially Fulfilled', 'Fulfilled'].includes(indent.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only active procurement requisitions can be rejected.'
      });
    }

    if (indent.storeRoutingStatus !== 'moved_to_procurement') {
      return res.status(400).json({
        success: false,
        message: 'Only requisitions moved to procurement can be rejected.'
      });
    }

    const observation = String(req.body.observation || '').trim();
    const previousStatus = indent.status;
    indent.status = 'Rejected in Procurement';
    indent.procurementRejection = {
      rejectedBy: req.user.id,
      rejectedAt: new Date(),
      observation
    };
    indent.updatedBy = req.user.id;

    // Keep assignment metadata but mark it closed for further operations.
    indent.procurementAssignment = indent.procurementAssignment || {};
    indent.procurementAssignment.status = 'unassigned';
    indent.procurementAssignment.assignedTo = null;
    indent.procurementAssignment.note = '';

    pushIndentWorkflowHistory(indent, {
      fromStatus: previousStatus,
      toStatus: 'Rejected in Procurement',
      changedBy: req.user.id,
      comments: `Rejected in Procurement: ${observation}`,
      module: 'Procurement'
    });

    await indent.save();

    const updated = await Indent.findById(indent._id)
      .populate('department', 'name code')
      .populate('requestedBy', 'firstName lastName email employeeId')
      .populate('procurementRejection.rejectedBy', 'firstName lastName email')
      .populate('procurementAssignment.assignedBy', 'firstName lastName email')
      .populate('workflowHistory.changedBy', 'firstName lastName email');

    await notifyDocumentRecipients({
      recipientIds: [indent.requestedBy],
      actorId: req.user.id,
      title: 'Requisition rejected in Procurement',
      message: `Requisition ${indent.indentNumber || ''} was rejected with observation: ${observation}`,
      actionUrl: `/general/indents/${indent._id}`,
      entityId: indent._id,
      entityType: 'Indent',
      module: 'procurement'
    });

  res.json({
    success: true,
    message: 'Requisition rejected with observation.',
    data: updated
  });
});

router.put('/requisitions/:id/reject', authMiddleware, rejectRequisitionValidators, rejectRequisitionHandler);
router.post('/requisitions/:id/reject', authMiddleware, rejectRequisitionValidators, rejectRequisitionHandler);

// @route   GET /api/procurement/requisitions/assignment-managers
// @desc    Get procurement users and their assignment-manager rights
// @access  Private (Super Admin / Admin / GM Procurement)
router.get('/requisitions/assignment-managers',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!canConfigureProcurementAssignmentManagers(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to configure assignment managers.'
      });
    }

    const users = await User.find({
      isActive: true,
      department: { $regex: '^procurement$', $options: 'i' }
    })
      .select('firstName lastName email employeeId role roleRef roles department position canAssignProcurementTasks')
      .populate('roleRef', 'name displayName permissions isActive')
      .populate('roles', 'name displayName permissions isActive')
      .lean();

    const procurementUsers = users
      .filter((user) => hasProcurementAccess(user))
      .map((user) => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        employeeId: user.employeeId,
        role: user.role,
        department: user.department,
        position: user.position,
        canAssignProcurementTasks: Boolean(user.canAssignProcurementTasks)
      }));

    res.json({
      success: true,
      data: procurementUsers
    });
  })
);

// @route   PUT /api/procurement/requisitions/assignment-managers
// @desc    Set which procurement users can assign requisition tasks
// @access  Private (Super Admin / Admin / GM Procurement)
router.put('/requisitions/assignment-managers',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!canConfigureProcurementAssignmentManagers(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to configure assignment managers.'
      });
    }

    const incomingIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    const normalizedIds = [...new Set(incomingIds.map((id) => String(id)).filter((id) => mongoose.Types.ObjectId.isValid(id)))];

    const eligibleUsers = await User.find({
      _id: { $in: normalizedIds },
      isActive: true,
      department: { $regex: '^procurement$', $options: 'i' }
    })
      .select('_id role roleRef roles')
      .populate('roleRef', 'name displayName permissions isActive')
      .populate('roles', 'name displayName permissions isActive');

    const eligibleIds = new Set(
      eligibleUsers
        .filter((user) => hasProcurementAccess(user))
        .map((user) => String(user._id))
    );

    const usersToGrant = [...eligibleIds];

    await User.updateMany(
      {
        isActive: true,
        department: { $regex: '^procurement$', $options: 'i' }
      },
      { $set: { canAssignProcurementTasks: false } }
    );

    if (usersToGrant.length > 0) {
      await User.updateMany(
        { _id: { $in: usersToGrant } },
        { $set: { canAssignProcurementTasks: true } }
      );
    }

    res.json({
      success: true,
      message: 'Procurement assignment managers updated successfully',
      data: {
        userIds: usersToGrant
      }
    });
  })
);

// ==================== PUBLIC QUOTATION ROUTES ====================

// @route   GET /api/procurement/public-quotation/:token
// @desc    Get quotation invitation by token (public)
// @access  Public
router.get('/public-quotation/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;

  const invitation = await QuotationInvitation.findOne({ token })
    .populate('indent', 'indentNumber title description department items')
    .populate('vendor', 'name email contactPerson phone address')
    .populate('indent.department', 'name')
    .populate('indent.requestedBy', 'firstName lastName');

  if (!invitation) {
    return res.status(404).json({
      success: false,
      message: 'Invalid quotation link'
    });
  }

  // Check if expired
  if (invitation.isExpired()) {
    return res.status(400).json({
      success: false,
      message: 'This quotation link has expired',
      expired: true
    });
  }

  // Check if already submitted
  if (invitation.status === 'Submitted') {
    return res.status(400).json({
      success: false,
      message: 'This quotation has already been submitted',
      submitted: true,
      quotationId: invitation.quotation
    });
  }

  res.json({
    success: true,
    data: {
      invitation: {
        _id: invitation._id,
        token: invitation.token,
        expiresAt: invitation.expiresAt
      },
      requisition: invitation.indent,
      vendor: invitation.vendor
    }
  });
}));

// @route   POST /api/procurement/public-quotation/:token
// @desc    Submit quotation via public form (public)
// @access  Public
router.post('/public-quotation/:token', [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.description').optional({ values: 'null' }).trim(),
  body('items.*.quantity').isFloat({ min: 0 }).withMessage('Item quantity must be non-negative'),
  body('items.*.unit').optional({ values: 'null' }).trim(),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Item unit price must be non-negative'),
  body('quotationDate').optional().isISO8601().withMessage('Valid quotation date is required'),
  body('validityDays').optional().isInt({ min: 1 }).withMessage('Validity days must be a positive integer')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  const hasAtLeastOneQuotedItem = (req.body.items || []).some((i) => (Number(i.quantity) || 0) > 0 && (Number(i.unitPrice) || 0) > 0);
  if (!hasAtLeastOneQuotedItem) {
    return res.status(400).json({
      success: false,
      message: 'At least one item must have quantity and unit price greater than 0'
    });
  }

  const { token } = req.params;

  // Find invitation
  const invitation = await QuotationInvitation.findOne({ token })
    .populate('indent')
    .populate('vendor');

  if (!invitation) {
    return res.status(404).json({
      success: false,
      message: 'Invalid quotation link'
    });
  }

  // Check if expired
  if (invitation.isExpired()) {
    return res.status(400).json({
      success: false,
      message: 'This quotation link has expired'
    });
  }

  // Check if already submitted
  if (invitation.status === 'Submitted') {
    return res.status(400).json({
      success: false,
      message: 'This quotation has already been submitted'
    });
  }

  // Calculate item amounts
  const items = req.body.items.map(item => {
    const subtotal = item.quantity * item.unitPrice;
    const discountAmount = item.discount || 0;
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = (afterDiscount * (item.taxRate || 0)) / 100;
    const amount = afterDiscount + taxAmount;
    
    return {
      ...item,
      amount
    };
  });

  const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const discountAmount = items.reduce((sum, item) => sum + (item.discount || 0), 0);
  const taxAmount = items.reduce((sum, item) => {
    const afterDiscount = (item.quantity * item.unitPrice) - (item.discount || 0);
    return sum + (afterDiscount * (item.taxRate || 0) / 100);
  }, 0);
  const totalAmount = subtotal - discountAmount + taxAmount;

  // Calculate expiry date
  const validityDays = req.body.validityDays || 30;
  const expiryDate = req.body.quotationDate 
    ? new Date(new Date(req.body.quotationDate).getTime() + validityDays * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

  // Create quotation
  const normalizedSupplementaryFields = normalizeQuotationSupplementaryFields(req.body);
  const quotation = new Quotation({
    indent: invitation.indent._id,
    vendor: invitation.vendor._id,
    quotationDate: req.body.quotationDate ? new Date(req.body.quotationDate) : new Date(),
    expiryDate,
    status: 'Received',
    items,
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount,
    validityDays,
    deliveryTime: req.body.deliveryTime || '',
    paymentTerms: req.body.paymentTerms || '',
    ...normalizedSupplementaryFields,
    notes: req.body.notes || '',
    createdBy: null // Public submission, no user
  });

  await quotation.save();

  // Update invitation
  invitation.status = 'Submitted';
  invitation.submittedAt = new Date();
  invitation.quotation = quotation._id;
  await invitation.save();

  const populatedQuotation = await Quotation.findById(quotation._id)
    .populate('indent', 'indentNumber title')
    .populate('vendor', 'name email phone');

  res.status(201).json({
    success: true,
    message: 'Quotation submitted successfully',
    data: populatedQuotation
  });
}));

// ==================== QUOTATIONS ROUTES ====================

// @route   GET /api/procurement/quotations/by-indent/:indentId
// @desc    Get all quotations for a specific indent/requisition
// @access  Private (Assignee, procurement managers/admins, audit read roles, higher management)
router.get('/quotations/by-indent/:indentId',
  asyncHandler(async (req, res) => {
    const { indentId } = req.params;

    const indent = await Indent.findById(indentId).select('procurementAssignment comparativeApproval.approvers');
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }
    if (!canViewQuotationsByIndentRead(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message: 'You can only view quotations for requisitions you are assigned to or if you manage procurement assignments.'
      });
    }

    const quotations = await Quotation.find({ indent: indentId })
      .populate({
        path: 'indent',
        select: 'indentNumber title items erpRef requestedDate requiredDate department requestedBy',
        populate: [
          { path: 'department', select: 'name code' },
          { path: 'requestedBy', select: 'firstName lastName email' }
        ]
      })
      .populate('vendor', 'name email phone contactPerson address')
      .sort({ createdAt: 1 })
      .exec();

    res.json({
      success: true,
      data: quotations
    });
  })
);

// @route   GET /api/procurement/quotations
// @desc    Get all quotations with pagination and filters
// @access  Private (Procurement, Admin, Developer)
router.get('/quotations', 
  authorize('super_admin', 'admin', 'developer', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 10, 
      status,
      vendor,
      indent,
      search,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    // Apply filters
    if (status) query.status = status;
    if (vendor) query.vendor = vendor;
    if (indent) query.indent = indent;

    // Date range filter
    if (startDate || endDate) {
      query.quotationDate = {};
      if (startDate) query.quotationDate.$gte = new Date(startDate);
      if (endDate) query.quotationDate.$lte = new Date(endDate);
    }

    // Search functionality
    if (search) {
      query.$or = [
        { quotationNumber: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
        { 'items.description': { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const quotations = await Quotation.find(query)
      .populate({
        path: 'indent',
        select: 'indentNumber title status items comparativeApproval',
        populate: {
          path: 'comparativeApproval.rejectionObservations.rejectedBy',
          select: 'firstName lastName email'
        }
      })
      .populate('vendor', 'name email phone contactPerson')
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Quotation.countDocuments(query);

    res.json({
      success: true,
      data: {
        quotations,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  })
);

// @route   GET /api/procurement/quotations/:id
// @desc    Get quotation by ID
// @access  Private (Procurement and Admin)
router.get('/quotations/:id', 
  authorize('super_admin', 'admin', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const quotation = await Quotation.findById(req.params.id)
      .populate({
        path: 'indent',
        select: 'indentNumber title items erpRef requestedDate requiredDate department requestedBy justification signatures comparativeStatementApprovals comparativeApproval',
        populate: [
          { path: 'department', select: 'name code' },
          { path: 'requestedBy', select: 'firstName lastName email' },
          { path: 'comparativeApproval.rejectionObservations.rejectedBy', select: 'firstName lastName email' }
        ]
      })
      .populate('vendor', 'name email phone contactPerson address')
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    res.json({
      success: true,
      data: quotation
    });
  })
);

// @route   POST /api/procurement/quotations/upload
// @desc    Upload attachment for quotation (single file)
// @access  Private (Procurement and Admin)
router.post('/quotations/upload',
  authorize('super_admin', 'admin', 'procurement_manager'),
  uploadQuotationAttachment.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const url = '/uploads/quotation-attachments/' + req.file.filename;
    res.status(200).json({
      success: true,
      data: { filename: req.file.originalname, url }
    });
  })
);

// @route   POST /api/procurement/quotations
// @desc    Create new quotation
// @access  Private (Procurement and Admin)
router.post('/quotations', [
  body('indent').isMongoId().withMessage('Valid indent ID is required'),
  body('vendor').isMongoId().withMessage('Valid vendor ID is required'),
  body('quotationDate').isISO8601().withMessage('Valid quotation date is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.description').optional({ values: 'null' }).trim(),
  body('items.*.quantity').isFloat({ min: 0 }).withMessage('Item quantity must be non-negative'),
  body('items.*.unit').optional({ values: 'null' }).trim(),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Item unit price must be non-negative')
], authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  const hasAtLeastOneQuotedItem = (req.body.items || []).some((i) => (Number(i.quantity) || 0) > 0 && (Number(i.unitPrice) || 0) > 0);
  if (!hasAtLeastOneQuotedItem) {
    return res.status(400).json({
      success: false,
      message: 'At least one item must have quantity and unit price greater than 0'
    });
  }

  // Verify indent exists
  const indent = await Indent.findById(req.body.indent);
  if (!indent) {
    return res.status(404).json({
      success: false,
      message: 'Indent not found'
    });
  }

  // Guard: quotation creation is allowed only after requisition approval
  if (indent.status !== 'Approved' && indent.status !== 'Partially Fulfilled' && indent.status !== 'Fulfilled') {
    return res.status(400).json({
      success: false,
      message: 'Quotation can only be created for approved requisitions.'
    });
  }

  if (indent.storeRoutingStatus !== 'moved_to_procurement') {
    return res.status(400).json({
      success: false,
      message: 'Requisition is not yet available in Procurement.'
    });
  }

  if (indent.procurementAssignment?.status !== 'assigned' || !indent.procurementAssignment?.assignedTo) {
    return res.status(400).json({
      success: false,
      message: 'Requisition must be assigned before creating quotations.'
    });
  }

  if (!canOperateAssignedProcurementRequisition(req.user, indent)) {
    return res.status(403).json({
      success: false,
      message: 'Only the assigned procurement user or an assignment manager can create quotations for this requisition.'
    });
  }

  // Verify vendor exists
  const vendor = await Supplier.findById(req.body.vendor);
  if (!vendor) {
    return res.status(404).json({
      success: false,
      message: 'Vendor not found'
    });
  }

  // Calculate item amounts
  const items = req.body.items.map(item => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    const subtotal = quantity * unitPrice;
    const discountAmount = Number(item.discount) || 0;
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = (afterDiscount * (Number(item.taxRate) || 0)) / 100;
    const amount = afterDiscount + taxAmount;
    
    return {
      ...item,
      quantity,
      unitPrice,
      discount: discountAmount,
      taxRate: Number(item.taxRate) || 0,
      amount
    };
  });
  const normalizedSupplementaryFields = normalizeQuotationSupplementaryFields(req.body);

  if (['Finalized', 'Shortlisted'].includes(req.body.status)) {
    const existingActiveQuote = await Quotation.findOne({
      indent: req.body.indent,
      status: { $in: ['Finalized', 'Shortlisted'] }
    });
    if (existingActiveQuote) {
      return res.status(400).json({
        success: false,
        message: `Cannot create quotation as ${req.body.status.toLowerCase()}: Quotation ${existingActiveQuote.quotationNumber} is already ${existingActiveQuote.status.toLowerCase()} for this requisition.`
      });
    }

    const existingPO = await findBlockingPOForQuotation({ indent: req.body.indent });
    if (existingPO) {
      return res.status(400).json({
        success: false,
        message: blockingPOMessage(`Cannot create quotation as ${req.body.status.toLowerCase()}`, existingPO)
      });
    }
  }

  const quotation = new Quotation({
    ...req.body,
    ...normalizedSupplementaryFields,
    items,
    createdBy: req.user.id
  });
  // Set expiryDate only when valid; clear when empty so Mongoose doesn't get '' (CastError)
  const expiryStr = req.body.expiryDate && String(req.body.expiryDate).trim();
  if (expiryStr) {
    quotation.expiryDate = new Date(req.body.expiryDate);
  } else {
    quotation.expiryDate = undefined;
  }

  await quotation.save();

  const populatedQuotation = await Quotation.findById(quotation._id)
    .populate('indent', 'indentNumber title')
    .populate('vendor', 'name email phone')
    .populate('createdBy', 'firstName lastName email');

  res.status(201).json({
    success: true,
    message: 'Quotation created successfully',
    data: populatedQuotation
  });
}));

// @route   PUT /api/procurement/quotations/:id
// @desc    Update quotation
// @access  Private (Procurement and Admin)
router.put('/quotations/:id', [
  body('vendor').optional().isMongoId().withMessage('Valid vendor ID is required'),
  body('quotationDate').optional().isISO8601().withMessage('Valid quotation date is required'),
  body('items').optional().isArray({ min: 1 }).withMessage('At least one item is required'),
  body('status').optional().isIn(['Received', 'Shortlisted', 'Finalized', 'Rejected']),
  body('editReason').optional().isIn(['Negotiating purpose']).withMessage('Edit reason must be "Negotiating purpose"')
], authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const quotation = await Quotation.findById(req.params.id).populate({
    path: 'indent',
    select: 'procurementAssignment'
  });
  if (!quotation) {
    return res.status(404).json({
      success: false,
      message: 'Quotation not found'
    });
  }

  if (quotation.indent && !canOperateAssignedProcurementRequisition(req.user, quotation.indent)) {
    return res.status(403).json({
      success: false,
      message: 'Only the assigned procurement user or an assignment manager can update this quotation.'
    });
  }

  // Prevent editing finalized quotations
  if (quotation.status === 'Finalized' && req.body.status !== 'Finalized') {
    return res.status(400).json({
      success: false,
      message: 'Cannot edit finalized quotations'
    });
  }

  // Prevent multiple finalized / shortlisted quotations or finalizing if PO already exists
  if (['Finalized', 'Shortlisted'].includes(req.body.status) && quotation.status !== req.body.status) {
    const indentId = quotation.indent?._id || quotation.indent;
    if (indentId) {
      const indentDoc = await Indent.findById(indentId);
      const isPartiallyFulfilled = indentDoc?.status === 'Partially Fulfilled';

      // If requisition is not partially fulfilled, enforce single active quote rule
      if (!isPartiallyFulfilled) {
        const existingActiveQuote = await Quotation.findOne({
          indent: indentId,
          _id: { $ne: quotation._id },
          status: { $in: ['Finalized', 'Shortlisted'] },
          lotNumber: quotation.lotNumber || 'A'
        });
        if (existingActiveQuote) {
          return res.status(400).json({
            success: false,
            message: `Cannot mark quotation as ${req.body.status.toLowerCase()}: Quotation ${existingActiveQuote.quotationNumber} is already ${existingActiveQuote.status.toLowerCase()} for this requisition.`
          });
        }

        const lotQuotes = await Quotation.find({ indent: indentId, lotNumber: quotation.lotNumber || 'A' }).select('_id');
        const lotQuoteIds = lotQuotes.map(q => q._id);

        const existingPO = await findBlockingPOForQuotation({
          indent: indentId,
          quotation: { $in: lotQuoteIds, $ne: quotation._id }
        });
        if (existingPO) {
          return res.status(400).json({
            success: false,
            message: blockingPOMessage(`Cannot mark quotation as ${req.body.status.toLowerCase()}`, existingPO)
          });
        }
      } else {
        // For partially fulfilled requisitions, ensure no other *un-ordered* active quote conflicts
        const otherShortlisted = await Quotation.findOne({
          indent: indentId,
          _id: { $ne: quotation._id },
          status: 'Shortlisted',
          lotNumber: quotation.lotNumber || 'A'
        });
        if (otherShortlisted) {
          return res.status(400).json({
            success: false,
            message: `Cannot mark quotation as ${req.body.status.toLowerCase()}: Quotation ${otherShortlisted.quotationNumber} is currently shortlisted for this requisition.`
          });
        }
      }
    }
  }

  // If items are being updated, recalculate amounts
  if (req.body.items) {
    const hasAtLeastOneQuotedItem = req.body.items.some((i) => (Number(i.quantity) || 0) > 0 && (Number(i.unitPrice) || 0) > 0);
    if (!hasAtLeastOneQuotedItem) {
      return res.status(400).json({
        success: false,
        message: 'At least one item must have quantity and unit price greater than 0'
      });
    }
    req.body.items = req.body.items.map(item => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const subtotal = quantity * unitPrice;
      const discountAmount = Number(item.discount) || 0;
      const afterDiscount = subtotal - discountAmount;
      const taxAmount = (afterDiscount * (Number(item.taxRate) || 0)) / 100;
      const amount = afterDiscount + taxAmount;
      
      return {
        ...item,
        quantity,
        unitPrice,
        discount: discountAmount,
        taxRate: Number(item.taxRate) || 0,
        amount
      };
    });
  }
  if (shouldNormalizeQuotationSupplementaryFields(req.body)) {
    const normalizedSupplementaryFields = normalizeQuotationSupplementaryFields(req.body);
    Object.assign(req.body, normalizedSupplementaryFields);
  }

  const wasFinalized = quotation.status === 'Finalized';
  const isBeingFinalized = req.body.status === 'Finalized' && quotation.status !== 'Finalized';

  Object.assign(quotation, req.body);
  quotation.updatedBy = req.user.id;
  // Normalise expiryDate: valid date or unset (avoid empty string causing CastError)
  const expiryStr = req.body.expiryDate != null && String(req.body.expiryDate).trim();
  if (req.body.hasOwnProperty('expiryDate')) {
    quotation.expiryDate = expiryStr ? new Date(req.body.expiryDate) : undefined;
  }

  await quotation.save();

  // PO is created only when user clicks Create PO icon → opens dialog → clicks Create (not on finalize)
  if (false && isBeingFinalized) {
    const existingPO = await PurchaseOrder.findOne({ quotation: quotation._id });
    if (!existingPO) {
      // Populate quotation data for PO creation
      await quotation.populate('indent', 'indentNumber title');
      await quotation.populate('vendor', 'name email phone');

      // Calculate expected delivery date based on delivery time or expiry date
      let expectedDeliveryDate = quotation.expiryDate;
      if (!expectedDeliveryDate && quotation.deliveryTime) {
        // Try to parse delivery time (e.g., "2-3 weeks", "30 days")
        const deliveryMatch = quotation.deliveryTime.match(/(\d+)/);
        if (deliveryMatch) {
          const days = parseInt(deliveryMatch[1]);
          expectedDeliveryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        } else {
          expectedDeliveryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days
        }
      }
      if (!expectedDeliveryDate) {
        expectedDeliveryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days
      }

      // Create purchase order from quotation
      const purchaseOrder = new PurchaseOrder({
        vendor: quotation.vendor._id,
        indent: quotation.indent?._id || null,
        quotation: quotation._id,
        orderDate: new Date(),
        expectedDeliveryDate,
        status: 'Draft',
        priority: 'Medium',
        items: quotation.items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate || 0,
          discount: item.discount || 0,
          amount: item.amount
        })),
        shippingCost: 0,
        paymentTerms: quotation.paymentTerms || '',
        notes: `Created from quotation ${quotation.quotationNumber}`,
        internalNotes: `Source: Quotation ${quotation.quotationNumber}, Indent: ${quotation.indent?.indentNumber || 'N/A'}`,
        createdBy: req.user.id
      });

      await purchaseOrder.save();
    }
  }

  const updatedQuotation = await Quotation.findById(quotation._id)
    .populate('indent', 'indentNumber title')
    .populate('vendor', 'name email phone')
    .populate('createdBy', 'firstName lastName email')
    .populate('updatedBy', 'firstName lastName email');

  const message = isBeingFinalized
    ? 'Quotation finalized successfully. Use "Create PO" to create a Purchase Order.'
    : 'Quotation updated successfully';

  res.json({
    success: true,
    message,
    data: updatedQuotation
  });
}));

// @route   DELETE /api/procurement/quotations/:id
// @desc    Delete quotation
// @access  Private (Procurement and Admin)
router.delete('/quotations/:id', 
  authorize('super_admin', 'admin', 'procurement_manager'), 
  asyncHandler(async (req, res) => {
    const quotation = await Quotation.findById(req.params.id);
    
    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    // Prevent deleting finalized quotations
    if (quotation.status === 'Finalized') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete finalized quotations'
      });
    }

    const existingPO = await PurchaseOrder.findOne({
      quotation: quotation._id,
      status: { $ne: 'Cancelled' }
    });
    if (existingPO) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete quotation: linked to Purchase Order ${existingPO.orderNumber}`
      });
    }

    await Quotation.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Quotation deleted successfully'
    });
  })
);

// @route   POST /api/procurement/quotations/:id/create-po
// @desc    Create purchase order from quotation
// @access  Private (Procurement and Admin)
router.post('/quotations/:id/create-po',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const quotation = await Quotation.findById(req.params.id)
      .populate({ path: 'indent', select: 'indentNumber title procurementAssignment comparativeApproval' })
      .populate('vendor', 'name email phone');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found'
      });
    }

    if (quotation.indent && !canOperateAssignedProcurementRequisition(req.user, quotation.indent)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned procurement user or an assignment manager can create a PO from this quotation.'
      });
    }

    if (quotation.status !== 'Finalized') {
      return res.status(400).json({
        success: false,
        message: 'Only finalized quotations can be converted to purchase orders'
      });
    }

    const quotationCountForIndent = await Quotation.countDocuments({ indent: quotation.indent });
    if (quotation.indent && quotationCountForIndent > 1 && !comparativeApprovalIsFullyApproved(quotation.indent)) {
      return res.status(400).json({
        success: false,
        message: 'Comparative Statement must be fully approved before creating PO.'
      });
    }

    // Create purchase order from quotation
    const purchaseOrder = new PurchaseOrder({
      vendor: quotation.vendor._id,
      indent: quotation.indent?._id || quotation.indent || undefined,
      quotation: quotation._id,
      orderDate: new Date(),
      expectedDeliveryDate: quotation.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      status: 'Draft',
      priority: 'Medium',
      items: quotation.items.map(item => ({
        description: item.description,
        specification: item.specification || '',
        brand: item.brand || '',
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate || 0,
        discount: item.discount || 0,
        amount: item.amount
      })),
      shippingCost: 0,
      paymentTerms: quotation.paymentTerms || '',
      notes: `Created from quotation ${quotation.quotationNumber}`,
      internalNotes: `Source: Quotation ${quotation.quotationNumber}, Indent: ${quotation.indent?.indentNumber || 'N/A'}`,
      createdBy: req.user.id
    });

    await purchaseOrder.save();
    await linkReplacementForReleasedPOs(purchaseOrder, req.user.id);

    // Trigger indent fulfillment update
    if (purchaseOrder.indent) {
      try {
        const Indent = require('../models/general/Indent');
        await Indent.updateFulfillment(purchaseOrder.indent);
      } catch (err) {
        console.error('Error updating indent fulfillment after PO creation:', err);
      }
    }

    // Update quotation status to indicate PO was created
    quotation.updatedBy = req.user.id;
    await quotation.save();

    const populatedOrder = await PurchaseOrder.findById(purchaseOrder._id)
      .populate('vendor', 'name email phone')
      .populate('createdBy', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Purchase order created from quotation successfully',
      data: populatedOrder
    });
  })
);

// @route   GET /api/procurement/indents-with-split-assignments
// @desc    List requisitions (indents) that have split PO assignments saved (ready to create split POs from Quotations).
// @access  Private (procurement_manager, admin, super_admin)
router.get('/indents-with-split-assignments',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const splitFilter = {
      isActive: true,
      splitPOAssignments: { $exists: true, $ne: null }
    };
    if (!canManageProcurementAssignments(req.user)) {
      splitFilter['procurementAssignment.assignedTo'] = req.user.id;
    }
    const indents = await Indent.find(splitFilter)
      .select('indentNumber title department splitPOAssignments procurementAssignment')
      .populate('department', 'name')
      .sort({ updatedAt: -1 })
      .lean();

    const withKeys = (indents || []).filter(
      (i) => i.splitPOAssignments && typeof i.splitPOAssignments === 'object' && Object.keys(i.splitPOAssignments).length > 0
    );

    res.json({
      success: true,
      data: withKeys
    });
  })
);

// @route   POST /api/procurement/quotations/by-indent/:indentId/create-split-pos
// @desc    Create one PO per vendor based on per-item vendor assignments from the Comparative Statement.
//          Body: { vendorAssignments: { "0": "quotationId", "1": "quotationId", ... } }
//          Each key is the indent item index (0-based). Groups items by quotation/vendor, creates one PO per group.
// @access  Private (procurement_manager, admin, super_admin)
router.post('/quotations/by-indent/:indentId/create-split-pos',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const { vendorAssignments } = req.body; // { "0": quotationId, "2": quotationId, ... }

    if (!vendorAssignments || typeof vendorAssignments !== 'object' || Object.keys(vendorAssignments).length === 0) {
      return res.status(400).json({ success: false, message: 'vendorAssignments is required' });
    }

    const indent = await Indent.findById(req.params.indentId).lean();
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Indent not found' });
    }

    if (!canOperateAssignedProcurementRequisition(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned procurement user or an assignment manager can create split POs for this requisition.'
      });
    }

    if (!comparativeApprovalIsFullyApproved(indent)) {
      return res.status(400).json({
        success: false,
        message: 'Comparative Statement must be fully approved before creating Split POs.'
      });
    }

    // Collect unique quotation IDs
    const quotationIds = [...new Set(Object.values(vendorAssignments))];
    const quotations = await Quotation.find({ _id: { $in: quotationIds } })
      .populate('vendor', 'name email phone')
      .lean();

    const quotationMap = {};
    quotations.forEach(q => { quotationMap[q._id.toString()] = q; });

    // Group item indices by quotation
    const groupsByQuotation = {}; // { quotationId: [itemIndex, ...] }
    for (const [itemIndexStr, quotationId] of Object.entries(vendorAssignments)) {
      const itemIndex = parseInt(itemIndexStr, 10);
      if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= indent.items.length) continue;
      if (!quotationMap[quotationId]) continue;
      if (!groupsByQuotation[quotationId]) groupsByQuotation[quotationId] = [];
      groupsByQuotation[quotationId].push(itemIndex);
    }

    if (Object.keys(groupsByQuotation).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid vendor assignments found' });
    }

    const createdPOs = [];

    for (const [quotationId, itemIndices] of Object.entries(groupsByQuotation)) {
      const quotation = quotationMap[quotationId];

      const poItems = itemIndices.map(idx => {
        const indentItem = indent.items[idx];
        const quoteItem = quotation.items[idx];
        if (!indentItem) return null;
        const unitPrice = quoteItem ? (quoteItem.unitPrice || 0) : 0;
        const taxRate = quoteItem ? (quoteItem.taxRate || 0) : 0;
        const discount = quoteItem ? (quoteItem.discount || 0) : 0;
        const remainingQty = Math.max(0, (indentItem.quantity || 0) - (indentItem.orderedQuantity || 0));
        const quantity = (quoteItem && Number(quoteItem.quantity) > 0) ? Number(quoteItem.quantity) : (remainingQty > 0 ? remainingQty : (indentItem.quantity || 0));
        const amount = (quantity * unitPrice) - discount + ((quantity * unitPrice - discount) * taxRate / 100);
        return {
          description: indentItem.itemName || indentItem.description || '',
          specification: indentItem.description || '',
          brand: indentItem.brand || '',
          quantity,
          unit: indentItem.unit || 'Piece',
          unitPrice,
          taxRate,
          discount,
          amount
        };
      }).filter(Boolean);

      if (poItems.length === 0) continue;

      const purchaseOrder = new PurchaseOrder({
        vendor: quotation.vendor._id,
        indent: indent._id,
        quotation: quotation._id,
        orderDate: new Date(),
        expectedDeliveryDate: quotation.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'Draft',
        priority: indent.priority || 'Medium',
        items: poItems,
        paymentTerms: quotation.paymentTerms || '',
        notes: `Created from Comparative Statement for Indent ${indent.indentNumber}`,
        internalNotes: `Source: Quotation ${quotation.quotationNumber}, Indent: ${indent.indentNumber}`,
        createdBy: req.user.id
      });

      await purchaseOrder.save();
      pushPOWorkflowHistory(purchaseOrder, '—', 'Draft', req.user.id, `Created from CS split for Indent ${indent.indentNumber}`, 'Procurement');
      await purchaseOrder.save();
      await linkReplacementForReleasedPOs(purchaseOrder, req.user.id);

      const populated = await PurchaseOrder.findById(purchaseOrder._id)
        .populate('vendor', 'name email phone')
        .populate('createdBy', 'firstName lastName email')
        .lean();
      createdPOs.push(populated);
    }

    try {
      const Indent = require('../models/general/Indent');
      await Indent.updateFulfillment(indent._id);
    } catch (err) {
      console.error('Error updating indent fulfillment after split POs:', err);
    }

    res.status(201).json({
      success: true,
      message: `${createdPOs.length} Purchase Order(s) created from Comparative Statement`,
      data: createdPOs
    });
  })
);

// @route   POST /api/procurement/quotations/by-indent/:indentId/create-split-pos-from-saved
// @desc    Create split POs using vendorAssignments saved on the indent (from Comparative Statement shortlist). Clears splitPOAssignments after creation.
// @access  Private (procurement_manager, admin, super_admin)
router.post('/quotations/by-indent/:indentId/create-split-pos-from-saved',
  authorize('super_admin', 'admin', 'procurement_manager'),
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.indentId).lean();
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Indent not found' });
    }

    if (!canOperateAssignedProcurementRequisition(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned procurement user or an assignment manager can create split POs for this requisition.'
      });
    }

    if (!comparativeApprovalIsFullyApproved(indent)) {
      return res.status(400).json({
        success: false,
        message: 'Comparative Statement must be fully approved before creating Split POs.'
      });
    }

    const vendorAssignments = indent.splitPOAssignments;
    if (!vendorAssignments || typeof vendorAssignments !== 'object' || Object.keys(vendorAssignments).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No saved vendor assignments for this requisition. Use Comparative Statement to assign vendors first.'
      });
    }

    const quotationIds = [...new Set(Object.values(vendorAssignments))];
    const quotations = await Quotation.find({ _id: { $in: quotationIds } })
      .populate('vendor', 'name email phone')
      .lean();

    const quotationMap = {};
    quotations.forEach(q => { quotationMap[q._id.toString()] = q; });

    const groupsByQuotation = {};
    for (const [itemIndexStr, quotationId] of Object.entries(vendorAssignments)) {
      const itemIndex = parseInt(itemIndexStr, 10);
      if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= (indent.items || []).length) continue;
      if (!quotationMap[quotationId]) continue;
      if (!groupsByQuotation[quotationId]) groupsByQuotation[quotationId] = [];
      groupsByQuotation[quotationId].push(itemIndex);
    }

    if (Object.keys(groupsByQuotation).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid vendor assignments found' });
    }

    const createdPOs = [];

    for (const [quotationId, itemIndices] of Object.entries(groupsByQuotation)) {
      const quotation = quotationMap[quotationId];

      const poItems = itemIndices.map(idx => {
        const indentItem = indent.items[idx];
        const quoteItem = quotation.items[idx];
        if (!indentItem) return null;
        const unitPrice = quoteItem ? (quoteItem.unitPrice || 0) : 0;
        const taxRate = quoteItem ? (quoteItem.taxRate || 0) : 0;
        const discount = quoteItem ? (quoteItem.discount || 0) : 0;
        const quantity = indentItem.quantity || 0;
        const amount = (quantity * unitPrice) - discount + ((quantity * unitPrice - discount) * taxRate / 100);
        return {
          description: indentItem.itemName || indentItem.description || '',
          specification: indentItem.description || '',
          brand: indentItem.brand || '',
          quantity,
          unit: indentItem.unit || 'Piece',
          unitPrice,
          taxRate,
          discount,
          amount
        };
      }).filter(Boolean);

      if (poItems.length === 0) continue;

      const purchaseOrder = new PurchaseOrder({
        vendor: quotation.vendor._id,
        indent: indent._id,
        quotation: quotation._id,
        orderDate: new Date(),
        expectedDeliveryDate: quotation.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'Draft',
        priority: indent.priority || 'Medium',
        items: poItems,
        paymentTerms: quotation.paymentTerms || '',
        notes: `Created from Quotations (split) for Indent ${indent.indentNumber}`,
        internalNotes: `Source: Quotation ${quotation.quotationNumber}, Indent: ${indent.indentNumber}`,
        createdBy: req.user.id
      });

      await purchaseOrder.save();
      pushPOWorkflowHistory(purchaseOrder, '—', 'Draft', req.user.id, `Created from Quotations split for Indent ${indent.indentNumber}`, 'Procurement');
      await purchaseOrder.save();
      await linkReplacementForReleasedPOs(purchaseOrder, req.user.id);

      const populated = await PurchaseOrder.findById(purchaseOrder._id)
        .populate('vendor', 'name email phone')
        .populate('createdBy', 'firstName lastName email')
        .lean();
      createdPOs.push(populated);
    }

    const indentDoc = await Indent.findById(req.params.indentId);
    if (indentDoc) {
      indentDoc.splitPOAssignments = undefined;
      indentDoc.markModified('splitPOAssignments');
      await indentDoc.save();
    }

    try {
      const IndentModel = require('../models/general/Indent');
      await IndentModel.updateFulfillment(req.params.indentId);
    } catch (err) {
      console.error('Error updating indent fulfillment after split POs from saved:', err);
    }

    res.status(201).json({
      success: true,
      message: `${createdPOs.length} Purchase Order(s) created. You can track them in Purchase Orders.`,
      data: createdPOs
    });
  })
);

module.exports = router;
