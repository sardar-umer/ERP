const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');
const permissions = require('../middleware/permissions');
const { checkSubRoleAccess } = require('../config/permissions');
const UtilityBill = require('../models/hr/UtilityBill');
const UtilityStoreItem = require('../models/hr/UtilityStoreItem');
const UtilityStoreCategory = require('../models/hr/UtilityStoreCategory');
const User = require('../models/User');
const Department = require('../models/hr/Department');
const Employee = require('../models/hr/Employee');
const Supplier = require('../models/hr/Supplier');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');
const {
  assertUtilityBillApproversEligible,
  assertActiveUserApproversEligible,
  queryApproverCandidateUsers
} = require('../utils/utilityBillApproverEligibility');
const {
  postUtilityBillToFinance,
  isUtilityBillAuditFinalApproved,
  repairStaleUtilityBillsFinanceStatus,
  syncLinkedUtilityBillsFromApPayment,
  getFinanceApBillRefId
} = require('../utils/utilityBillFinance');
const AccountsPayable = require('../models/finance/AccountsPayable');
const { applyBillLinesToPayload } = require('../utils/utilityBillLines');
const {
  UTILITY_BILL_TYPES,
  isUtilityCategoryName,
  validateBillLinesSameKind
} = require('../utils/centralizedStoreBillKind');
const {
  normalizeApprovalSlots,
  slotsFromApproverIds,
  validateCentralizedApprovalSlots,
  validateStandardApprovalSlots
} = require('../utils/utilityBillApprovalSlots');

const MAX_BILL_ATTACHMENTS = 50;
const LINE_ATTACHMENT_PREFIX = 'lineAttachment_';

/** Resolve store item id on a bill line (string or populated object). */
function getBillLineStoreItemId(line) {
  if (!line?.storeItem) return '';
  const s = line.storeItem;
  if (typeof s === 'object' && s !== null && s._id != null) return String(s._id);
  return String(s);
}

/** Parse multipart field lineAttachment_<storeItemId> or lineAttachment_<storeItemId>_<index>. */
function parseLineAttachmentField(fieldname) {
  if (!fieldname || !fieldname.startsWith(LINE_ATTACHMENT_PREFIX)) return null;
  const rest = fieldname.slice(LINE_ATTACHMENT_PREFIX.length);
  if (!rest) return null;

  const rowMatch = rest.match(/^row_(\d+)(?:_(\d+))?$/);
  if (rowMatch) {
    return { isRowIdx: true, rowIdx: parseInt(rowMatch[1], 10), idx: rowMatch[2] ? parseInt(rowMatch[2], 10) : 0 };
  }

  const idxMatch = rest.match(/^(.+)_(\d+)$/);
  if (idxMatch) {
    return { sid: idxMatch[1], idx: parseInt(idxMatch[2], 10) };
  }
  return { sid: rest, idx: 0 };
}

function findBillLineByStoreItemId(lines, sid) {
  const target = String(sid);
  return lines.find((l) => getBillLineStoreItemId(l) === target);
}

function applyAttachmentUrlsToLine(row, urls) {
  const merged = urls.slice(0, MAX_BILL_ATTACHMENTS);
  row.attachmentUrls = merged;
  row.attachmentUrl = merged[0] || '';
}

/**
 * Merge multipart line uploads into billLines (call after applyBillLinesToPayload).
 *
 * Fields: lineAttachment_row_<lineIdx>_<index> (or legacy lineAttachment_<storeItemId>_<index>)
 * Body:   existingLineAttachments_row_<lineIdx> = JSON array of URLs to keep
 */
function mergeLineUploadsIntoBillLines(files, billData) {
  let lines = billData.billLines;
  if (typeof lines === 'string') {
    try {
      lines = JSON.parse(lines);
    } catch {
      return;
    }
  }
  if (!Array.isArray(lines) || !lines.length) return;

  const newByGroup = new Map();
  for (const f of files || []) {
    const parsed = parseLineAttachmentField(f.fieldname);
    if (!parsed) continue;
    const url = `/uploads/utility-bills/${f.filename}`;
    const groupKey = parsed.isRowIdx ? `row_${parsed.rowIdx}` : parsed.sid;
    
    if (!newByGroup.has(groupKey)) {
      newByGroup.set(groupKey, { 
        isRowIdx: parsed.isRowIdx, 
        identifier: parsed.isRowIdx ? parsed.rowIdx : parsed.sid, 
        entries: [] 
      });
    }
    newByGroup.get(groupKey).entries.push({ idx: parsed.idx, url });
  }

  const mergedKeys = new Set();

  for (const [groupKey, group] of newByGroup) {
    const row = group.isRowIdx ? lines[group.identifier] : findBillLineByStoreItemId(lines, group.identifier);
    if (!row) continue;
    mergedKeys.add(groupKey);
    group.entries.sort((a, b) => a.idx - b.idx);
    const newUrls = group.entries.map((e) => e.url);
    
    const existingKey = group.isRowIdx ? `existingLineAttachments_row_${group.identifier}` : `existingLineAttachments_${group.identifier}`;
    let existingUrls = [];
    if (billData[existingKey] != null && billData[existingKey] !== '') {
      try {
        const parsed = JSON.parse(billData[existingKey]);
        if (Array.isArray(parsed)) existingUrls = parsed.filter(Boolean);
      } catch { /* ignore */ }
      delete billData[existingKey];
    } else {
      if (Array.isArray(row?.attachmentUrls) && row.attachmentUrls.length) {
        existingUrls = row.attachmentUrls.filter(Boolean);
      } else if (row?.attachmentUrl) {
        existingUrls = [row.attachmentUrl];
      }
    }
    
    applyAttachmentUrlsToLine(row, [...existingUrls, ...newUrls]);
  }

  // Lines with no new uploads — restore saved URLs from existingLineAttachments_* only
  Object.keys(billData).forEach((key) => {
    let row, groupKey;
    const rowMatch = /^existingLineAttachments_row_(\d+)$/.exec(key);
    const sidMatch = /^existingLineAttachments_(.+)$/.exec(key);

    if (rowMatch) {
      groupKey = `row_${rowMatch[1]}`;
      row = lines[parseInt(rowMatch[1], 10)];
    } else if (sidMatch) {
      groupKey = sidMatch[1];
      row = findBillLineByStoreItemId(lines, groupKey);
    } else {
      return;
    }

    if (mergedKeys.has(groupKey)) {
      delete billData[key];
      return;
    }
    
    const rawVal = billData[key];
    delete billData[key];
    if (!row) return;
    try {
      const urls = JSON.parse(rawVal);
      if (Array.isArray(urls)) applyAttachmentUrlsToLine(row, urls.filter(Boolean));
    } catch { /* ignore */ }
  });

  billData.billLines = lines;
}

const populateUtilityBill = (query) => query
  .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('draftApprovalSlots.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('approvedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('rejectedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('observations.addedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('observations.answeredBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
  .populate('consolidatedFrom.bill', 'billId utilityType provider amount billDate accountNumber forWhat lastMonthAmount')
  .populate('consolidatedIntoBillId', 'billId billDate')
  .populate('financeApBillId', 'billNumber totalAmount status amountPaid')
  .populate('vendorId', 'name supplierId')
  .populate('payeeEmployee', 'firstName lastName employeeId email')
  .populate({
    path: 'billLines.storeItem',
    select: 'name code utilityType meterNumber site location category',
    populate: { path: 'category', select: 'name' }
  })
  .populate('billLines.expenseAccount', 'accountNumber name');

const populateUtilityBillDocument = async (bill) => {
  await bill.populate([
    { path: 'createdBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'approvalChain.approver', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'draftApproverIds', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'draftApprovalSlots.approver', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'approvedBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'rejectedBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'workflowHistory.changedBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'observations.addedBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'observations.answeredBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
    { path: 'consolidatedFrom.bill', select: 'billId utilityType provider amount billDate accountNumber forWhat lastMonthAmount' },
    { path: 'consolidatedIntoBillId', select: 'billId billDate' },
    { path: 'financeApBillId', select: 'billNumber totalAmount status amountPaid' },
    { path: 'vendorId', select: 'name supplierId' },
    { path: 'payeeEmployee', select: 'firstName lastName employeeId email' },
    {
      path: 'billLines.storeItem',
      select: 'name code utilityType meterNumber site location category',
      populate: { path: 'category', select: 'name' }
    },
    { path: 'billLines.expenseAccount', select: 'accountNumber name' }
  ]);
  return bill;
};

const addWorkflowHistory = (bill, fromStatus, toStatus, changedBy, comments = '') => {
  if (!Array.isArray(bill.workflowHistory)) bill.workflowHistory = [];
  bill.workflowHistory.push({
    fromStatus,
    toStatus,
    changedBy,
    changedAt: new Date(),
    comments
  });
};

const notifyAuditQueue = async ({ actorId, bill }) => {
  const users = await User.find({
    isActive: true,
    role: { $in: ['audit_manager', 'auditor', 'audit_director', 'super_admin', 'admin'] }
  }).select('_id');
  const recipientIds = users.map((user) => String(user._id));
  if (!recipientIds.length) return;

  await createAndEmitNotification({
    recipientIds,
    title: 'Utility bill pending Pre Audit',
    message: `Utility Bill ${bill.billId || bill._id} moved to Audit queue. Please review in Pre-Audit.`,
    type: 'info',
    category: 'approval',
    priority: 'high',
    actionUrl: '/audit',
    createdBy: actorId,
    excludeUserId: actorId,
    metadata: {
      module: 'audit',
      entityId: bill._id,
      entityType: 'UtilityBill',
      queueStage: 'pending_audit',
      targetModule: 'audit',
      targetTab: 'pre_audit'
    }
  });
};

const normalizeApproverIds = (value) => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return [value].map(String).filter(Boolean);
    }
  }
  return [];
};

const uniqueApproverIds = (ids = []) => [...new Set(ids.map(String).filter(Boolean))];
const getActorId = (req) => String(req?.user?._id || req?.user?.id || '');

/** Resolve approval slots from request body and/or existing bill draft. */
const resolveApprovalSlots = (body = {}, bill = null) => {
  const fromBodySlots = normalizeApprovalSlots(body.approvalSlots || body.draftApprovalSlots);
  if (fromBodySlots.length) return fromBodySlots;

  const fromBodyIds = normalizeApproverIds(body.approverIds);
  if (fromBodyIds.length) return slotsFromApproverIds(fromBodyIds);

  if (bill?.draftApprovalSlots?.length) {
    return normalizeApprovalSlots(
      bill.draftApprovalSlots.map((s) => ({
        role: s.role,
        approverId: s.approver?._id || s.approver
      }))
    );
  }

  const fromDraftIds = normalizeApproverIds(bill?.draftApproverIds || []);
  if (fromDraftIds.length) return slotsFromApproverIds(fromDraftIds);

  return [];
};

const applyDraftApprovalSlotsToPayload = (payload, body, { isCentralized }) => {
  const slots = normalizeApprovalSlots(body.draftApprovalSlots || body.approvalSlots);
  if (!slots.length && body.draftApproverIds !== undefined) {
    const ids = uniqueApproverIds(normalizeApproverIds(body.draftApproverIds));
    const max = isCentralized ? 4 : 2;
    payload.draftApproverIds = ids.slice(0, max);
    payload.draftApprovalSlots = slotsFromApproverIds(payload.draftApproverIds).map((s) => ({
      role: s.role,
      approver: s.approverId
    }));
    return payload.draftApproverIds;
  }

  if (!slots.length) {
    return [];
  }

  const max = isCentralized ? 4 : 2;
  const trimmed = slots.slice(0, max);
  payload.draftApprovalSlots = trimmed.map((s) => ({ role: s.role, approver: s.approverId }));
  payload.draftApproverIds = trimmed.map((s) => s.approverId);
  return payload.draftApproverIds;
};

/**
 * Leadership / oversight roles may see all centralized-store bills.
 * Everyone else only sees bills they created or are assigned to approve.
 */
const canViewAllCentralizedStoreBills = (user) => {
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
    'audit_director'
  ]);
  if (privilegedRoles.has(role)) return true;
  if (role.includes('director') || role.includes('president') || role.includes('chairman')) {
    return true;
  }
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
  return false;
};

const mergeQueryAnd = (query, condition) => {
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

/** Restrict centralized-store bill lists to own + assigned for non-leadership users. */
const applyCentralizedStoreBillPrivacy = (query, user, { centralizedStoreOnly } = {}) => {
  if (centralizedStoreOnly !== 'true' && centralizedStoreOnly !== true) {
    return query;
  }
  if (canViewAllCentralizedStoreBills(user)) {
    return query;
  }
  const uid = user?._id || user?.id;
  if (!uid) {
    // Force empty result if no user id
    return mergeQueryAnd(query, { _id: null });
  }
  return mergeQueryAnd(query, {
    $or: [
      { createdBy: uid },
      { 'approvalChain.approver': uid },
      { draftApproverIds: uid }
    ]
  });
};

const canAccessUtilityBillAction = async (req, action = 'read') => {
  const actorId = getActorId(req);
  if (!actorId) return false;
  
  // Centralized store list/create: allow authenticated access (row privacy applied on list/get)
  const isStoreInReq = req.body?.useCentralizedStore === true || req.body?.useCentralizedStore === 'true' || req.query?.centralizedStoreOnly === 'true';
  if (isStoreInReq) return true;

  // If a specific bill ID is accessed, check store privacy + creator/approver
  if (req.params?.id && mongoose.Types.ObjectId.isValid(req.params.id)) {
    try {
      const bill = await UtilityBill.findById(req.params.id).select('useCentralizedStore createdBy approvalChain draftApproverIds').lean();
      if (bill) {
        if (bill.useCentralizedStore) {
          if (canViewAllCentralizedStoreBills(req.user)) return true;
          if (String(bill.createdBy) === actorId) return true;
          const isApprover = (bill.approvalChain || []).some(
            (step) => String(step.approver) === actorId
          );
          if (isApprover) return true;
          const isDraftApprover = (bill.draftApproverIds || []).some((id) => String(id) === actorId);
          if (isDraftApprover) return true;
          return false;
        }
        if (String(bill.createdBy) === actorId) return true;
        const isApprover = (bill.approvalChain || []).some(
          (step) => String(step.approver) === actorId
        );
        if (isApprover) return true;
      }
    } catch (e) {
      console.error('canAccessUtilityBillAction bill lookup error:', e);
    }
  }

  const hasAdmin = await checkSubRoleAccess(actorId, 'admin', 'utility_bills_management', action);
  const hasFinance = await checkSubRoleAccess(actorId, 'finance', 'accounts_payable', action);
  const hasGeneralStore = await checkSubRoleAccess(actorId, 'general', 'centralized_store', action);
  // General Indent role holders also create/manage centralized store bills under General module
  const hasGeneralIndents = await checkSubRoleAccess(actorId, 'general', 'indents', action);
  return hasAdmin || hasFinance || hasGeneralStore || hasGeneralIndents;
};

const requireBillPermission = (action = 'read') => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const ok = await canAccessUtilityBillAction(req, action);
    if (ok) return next();
    return res.status(403).json({ success: false, message: 'Insufficient sub-role permissions to perform this action' });
  } catch (err) {
    console.error('requireBillPermission error:', err);
    return res.status(500).json({ success: false, message: 'Error checking permissions' });
  }
};

/** Bill is with Pre-Audit / director and must not be edited until returned. */
const auditStatusesBlockingEdit = [
  'Send to Audit',
  'Forwarded to Audit Director',
  'Approved (from Send to Audit)',
  'Approved (from Forwarded to Audit Director)',
  'Partially Paid (from Finance)',
  'Paid (from Finance)'
];

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/utility-bills');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'bill-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per file (images are compressed client-side before upload)
    files: 510 // up to 50 attachments × many line items + billImage + lineAttachment_ fields
  },
  fileFilter: (req, file, cb) => {
    const isMain = file.fieldname === 'billImage';
    const isLine = file.fieldname && file.fieldname.startsWith('lineAttachment_');
    if (isMain) {
      if (file.mimetype.startsWith('image/')) return cb(null, true);
      return cb(new Error('Bill image must be an image file'), false);
    }
    if (isLine) {
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        return cb(null, true);
      }
      return cb(new Error('Line attachments must be an image or PDF'), false);
    }
    return cb(new Error(`Unexpected file field: ${file.fieldname}`), false);
  }
});

// Apply authentication middleware
router.use(authMiddleware);

// Get all utility bills with optional filters
const buildUtilityBillStoreScope = (queryParams = {}) => {
  if (queryParams.excludeCentralizedStore === 'true') {
    return {
      $or: [
        { useCentralizedStore: false },
        { useCentralizedStore: { $exists: false } }
      ]
    };
  }
  if (queryParams.centralizedStoreOnly === 'true') {
    return { useCentralizedStore: true };
  }
  return {};
};

/** Mongo equivalent of isCentralizedUtilityBill, so Bills / Utility Bills can be paginated in the DB. */
const buildCentralizedUtilityBillCondition = async () => {
  const categories = await UtilityStoreCategory.find({}).select('name').lean();
  const utilityCategoryIds = categories
    .filter((category) => isUtilityCategoryName(category.name))
    .map((category) => category._id);
  const utilityItemIds = await UtilityStoreItem.find({ category: { $in: utilityCategoryIds } }).distinct('_id');
  const utilityTypeRx = new RegExp(`^\\s*(${UTILITY_BILL_TYPES.join('|')})\\s*$`, 'i');
  return {
    $or: [
      { 'billLines.utilityType': utilityTypeRx },
      { 'billLines.storeItem': { $in: utilityItemIds } },
      { 'billLines.0': { $exists: false }, utilityType: utilityTypeRx }
    ]
  };
};

router.get('/', requireBillPermission('read'), async (req, res) => {
  try {
    const { 
      search, 
      utilityType, 
      status, 
      provider,
      accountHead,
      site,
      company,
      location,
      department,
      custodian,
      excludeCentralizedStore,
      centralizedStoreOnly,
      storeCategoryId,
      billKind,
      page = 1, 
      limit = 10 
    } = req.query;

    // Build query
    const query = {
      ...buildUtilityBillStoreScope({ excludeCentralizedStore, centralizedStoreOnly })
    };

    // Privacy: non-leadership users only see their own / assigned centralized-store bills
    applyCentralizedStoreBillPrivacy(query, req.user, { centralizedStoreOnly });

    if (storeCategoryId && mongoose.Types.ObjectId.isValid(storeCategoryId)) {
      const itemIds = await UtilityStoreItem.find({ category: storeCategoryId }).distinct('_id');
      query['billLines.storeItem'] = { $in: itemIds };
    }
    
    if (utilityType) query.utilityType = utilityType;
    if (status) query.status = status;
    if (provider) query.provider = { $regex: provider, $options: 'i' };
    if (accountHead) query.accountHead = accountHead;
    if (location) query.location = { $regex: location, $options: 'i' };
    if (department) query.department = { $regex: department, $options: 'i' };
    if (custodian) query.custodian = { $regex: custodian, $options: 'i' };

    // Company-wise filter (centralized store uses site / billLines.site as company name)
    const companyFilter = String(company || site || '').trim();
    if (companyFilter) {
      const escapedCompany = companyFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const companyRx = new RegExp(`^${escapedCompany}$`, 'i');
      const companyOr = [
        { site: companyRx },
        { 'billLines.site': companyRx }
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: companyOr }];
        delete query.$or;
      } else {
        query.$or = companyOr;
      }
    }

    // Search in DB (before pagination) — includes vendor name, narration, company, line items
    const searchTerm = String(search || '').trim();
    if (searchTerm) {
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      let vendorIds = [];
      try {
        vendorIds = await Supplier.find({ name: rx }).distinct('_id');
      } catch (_) {
        vendorIds = [];
      }
      const searchOr = [
        { billId: rx },
        { provider: rx },
        { accountNumber: rx },
        { description: rx },
        { forWhat: rx },
        { notes: rx },
        { accountHead: rx },
        { site: rx },
        { location: rx },
        { department: rx },
        { custodian: rx },
        { 'billLines.description': rx },
        { 'billLines.site': rx },
        { 'billLines.location': rx }
      ];
      if (vendorIds.length) {
        searchOr.push({ vendorId: { $in: vendorIds } });
      }
      if (query.$and) {
        query.$and.push({ $or: searchOr });
      } else if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    // Centralized store tabs: page within one kind, and report figures that span all pages
    let listQuery = query;
    let kindSummary = {};
    if (centralizedStoreOnly === 'true' && ['bill', 'utility'].includes(billKind)) {
      const utilityCondition = await buildCentralizedUtilityBillCondition();
      const utilityQuery = { $and: [query, utilityCondition] };
      const regularQuery = { $and: [query, { $nor: [utilityCondition] }] };
      listQuery = billKind === 'utility' ? utilityQuery : regularQuery;

      const [utilityCount, regularCount, periodSummary] = await Promise.all([
        UtilityBill.countDocuments(utilityQuery),
        UtilityBill.countDocuments(regularQuery),
        UtilityBill.aggregate([
          { $match: listQuery },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m',
                  date: { $ifNull: ['$billDate', '$dueDate'] },
                  timezone: 'Asia/Karachi',
                  onNull: '0000-00'
                }
              },
              count: { $sum: 1 },
              total: { $sum: { $ifNull: ['$amount', 0] } }
            }
          }
        ])
      ]);
      kindSummary = {
        kindCounts: { bill: regularCount, utility: utilityCount },
        periodSummary: Object.fromEntries(
          periodSummary.map(({ _id, count, total }) => [_id, { count, total }])
        )
      };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with population
    const bills = await populateUtilityBill(UtilityBill.find(listQuery))
      .sort({ billDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await UtilityBill.countDocuments(listQuery);

    const filteredBills = await repairStaleUtilityBillsFinanceStatus(bills, getActorId(req));

    res.json({
      success: true,
      data: filteredBills,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      },
      ...kindSummary
    });
  } catch (error) {
    console.error('Error fetching utility bills:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch utility bills' });
  }
});

// Get utility bills by type
router.get('/by-type/:utilityType', permissions.checkSubRolePermission('admin', 'utility_bills_management', 'read'), async (req, res) => {
  try {
    const { utilityType } = req.params;
    const { status = 'Pending' } = req.query;

    const query = { 
      utilityType,
      status 
    };

    const bills = await populateUtilityBill(UtilityBill.find(query))
      .sort({ billDate: -1 });

    res.json({
      success: true,
      data: bills,
      count: bills.length,
      utilityType,
      status
    });

  } catch (error) {
    console.error('Error fetching utility bills by type:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch utility bills by type',
      error: error.message 
    });
  }
});

// Get utility bills summary by type
router.get('/summary', permissions.checkSubRolePermission('admin', 'utility_bills_management', 'read'), async (req, res) => {
  try {
    const storeScope = buildUtilityBillStoreScope(req.query);
    const summaryMatch = Object.keys(storeScope).length ? [{ $match: storeScope }] : [];

    const summary = await UtilityBill.aggregate([
      ...summaryMatch,
      {
        $group: {
          _id: '$utilityType',
          total: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          paidAmount: { $sum: '$paidAmount' },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] }
          },
          paid: {
            $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, 1, 0] }
          },
          overdue: {
            $sum: { $cond: [{ $eq: ['$status', 'Overdue'] }, 1, 0] }
          },
          partial: {
            $sum: { $cond: [{ $eq: ['$status', 'Partial'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Get monthly totals
    const currentMonth = new Date();
    currentMonth.setDate(1);
    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const monthlySummary = await UtilityBill.aggregate([
      {
        $match: {
          billDate: { $gte: currentMonth, $lt: nextMonth },
          ...storeScope
        }
      },
      {
        $group: {
          _id: null,
          monthlyTotal: { $sum: '$amount' },
          monthlyPaid: { $sum: '$paidAmount' },
          monthlyBills: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        byType: summary,
        monthly: monthlySummary[0] || { monthlyTotal: 0, monthlyPaid: 0, monthlyBills: 0 }
      }
    });

  } catch (error) {
    console.error('Error fetching utility bills summary:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch utility bills summary',
      error: error.message 
    });
  }
});

// Get overdue bills
router.get('/overdue', permissions.checkSubRolePermission('admin', 'utility_bills_management', 'read'), async (req, res) => {
  try {
    const bills = await populateUtilityBill(UtilityBill.find({ 
      status: 'Overdue',
      dueDate: { $lt: new Date() }
    }))
      .sort({ dueDate: 1 });

    res.json({
      success: true,
      data: bills
    });
  } catch (error) {
    console.error('Error fetching overdue bills:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching overdue bills',
      error: error.message
    });
  }
});

// Get pending bills
router.get('/pending', permissions.checkSubRolePermission('admin', 'utility_bills_management', 'read'), async (req, res) => {
  try {
    const bills = await populateUtilityBill(UtilityBill.find({ status: 'Pending' }))
      .sort({ dueDate: 1 });

    res.json({
      success: true,
      data: bills
    });
  } catch (error) {
    console.error('Error fetching pending bills:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending bills',
      error: error.message
    });
  }
});

// Get active users for approval authority selection
router.get('/approver-candidates', authMiddleware, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const limit = parseInt(req.query.limit, 10) || 50;
    const allUsers = req.query.allUsers === 'true' || req.query.allUsers === true;
    const users = await queryApproverCandidateUsers({ search, limit, allUsers });
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Error fetching utility bill approvers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch approvers' });
  }
});

// Department + custodian (employee) lists for create/edit — same data as HR dropdowns but allowed for utility_bills_management read (no HR manager role required)
router.get('/form-master-data', authMiddleware, async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true })
      .populate('manager', 'firstName lastName employeeId')
      .populate('parentDepartment', 'name code')
      .sort({ name: 1 })
      .lean();

    const employeeQuery = { isDeleted: false, isActive: true };
    const employees = await Employee.find(employeeQuery)
      .select('firstName lastName employeeId placementDepartment email phone isActive employmentStatus')
      .populate('placementDepartment', 'name code')
      .sort({ isActive: -1, employmentStatus: 1, employeeId: 1 })
      .lean();

    const employeesWithVirtuals = employees.map((employee) => ({
      ...employee,
      fullName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
    }));

    // Employee pool for centralized store payee dropdown (all non-deleted employees, sorted by name)
    const financePayeeEmployees = await Employee.find({
      isDeleted: false,
      $or: [
        { isActive: true },
        { employmentStatus: 'Active' }
      ]
    })
      .select('firstName lastName employeeId')
      .sort({ firstName: 1, lastName: 1 })
      .lean()
      .then((rows) =>
        rows.map((e) => ({
          _id: e._id,
          employeeId: e.employeeId || '',
          name: [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.employeeId || 'Employee'
        }))
      );

    res.json({
      success: true,
      data: {
        departments,
        employees: employeesWithVirtuals,
        financePayeeEmployees
      }
    });
  } catch (error) {
    console.error('Error fetching utility bill form master data:', error);
    res.status(500).json({ success: false, message: 'Failed to load form master data' });
  }
});

// Get single utility bill
router.get('/:id', requireBillPermission('read'), async (req, res) => {
  try {
    let bill = await populateUtilityBill(UtilityBill.findById(req.params.id));

    if (!bill) {
      return res.status(404).json({ success: false, message: 'Utility bill not found' });
    }

    const financeApId = getFinanceApBillRefId(bill.financeApBillId);
    if (financeApId && isUtilityBillAuditFinalApproved(bill.auditStatus)) {
      const ap = await AccountsPayable.findById(financeApId);
      if (ap && ['paid', 'partial'].includes(ap.status)) {
        await syncLinkedUtilityBillsFromApPayment(ap, getActorId(req));
        bill = await populateUtilityBill(UtilityBill.findById(req.params.id));
      }
    }

    res.json({ success: true, data: bill });
  } catch (error) {
    console.error('Error fetching utility bill:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch utility bill' });
  }
});

// Create new utility bill
router.post('/', upload.any(), requireBillPermission('create'), async (req, res) => {
  try {
    const billData = {
      ...req.body,
      createdBy: getActorId(req)
    };
    delete billData.approvalChain;
    delete billData.approvalStatus;
    delete billData.approvedBy;
    delete billData.approvedAt;
    delete billData.rejectedBy;
    delete billData.rejectedAt;
    delete billData.workflowHistory;
    delete billData.auditStatus;
    delete billData.observations;
    delete billData.updatedBy;
    delete billData.isConsolidated;
    delete billData.consolidatedFrom;
    delete billData.consolidatedIntoBillId;
    // Drop multipart helper fields that must not land on the document
    Object.keys(billData).forEach((key) => {
      if (key.startsWith('existingLineAttachments_') || key.startsWith('lineAttachment_')) {
        delete billData[key];
      }
    });

    const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
    billData.vendorId = emptyToNull(billData.vendorId);
    billData.payeeEmployee = emptyToNull(billData.payeeEmployee);
    billData.createdBy = emptyToNull(billData.createdBy) || getActorId(req);
    if (!billData.createdBy || !mongoose.Types.ObjectId.isValid(String(billData.createdBy))) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    {
      const useAllUsersApprovers =
        billData.useCentralizedStore === true || billData.useCentralizedStore === 'true';
      const draftIds = applyDraftApprovalSlotsToPayload(billData, req.body, {
        isCentralized: useAllUsersApprovers
      });
      if (draftIds.length) {
        const approverCheck = useAllUsersApprovers
          ? await assertActiveUserApproversEligible(draftIds)
          : await assertUtilityBillApproversEligible(draftIds);
        if (!approverCheck.ok) {
          return res.status(400).json({ success: false, message: approverCheck.message });
        }
      }
    }

    // Add image path if uploaded (main bill image)
    if (req.files && Array.isArray(req.files)) {
      const mainImg = req.files.find((f) => f.fieldname === 'billImage');
      if (mainImg) {
        billData.billImage = `/uploads/utility-bills/${mainImg.filename}`;
      }
    } else if (req.file) {
      billData.billImage = `/uploads/utility-bills/${req.file.filename}`;
    } else {
      // Ensure billImage is not an empty object
      delete billData.billImage;
    }

    // Convert string values to appropriate types
    if (billData.amount) billData.amount = parseFloat(billData.amount);
    if (billData.paidAmount) billData.paidAmount = parseFloat(billData.paidAmount);
    if (billData.lastMonthAmount) billData.lastMonthAmount = parseFloat(billData.lastMonthAmount);
    if (billData.balanceAmount) billData.balanceAmount = parseFloat(billData.balanceAmount);
    if (billData.grandTotal) billData.grandTotal = parseFloat(billData.grandTotal);
    if (!billData.grandTotal && billData.amount) {
      billData.grandTotal = billData.amount || 0;
    }
    if (!billData.balanceAmount && billData.grandTotal) {
      billData.balanceAmount = Math.max((billData.grandTotal || 0) - (billData.lastMonthAmount || 0), 0);
    }
    if (billData.billDate) billData.billDate = new Date(billData.billDate);
    if (billData.dueDate) billData.dueDate = new Date(billData.dueDate);

    await applyBillLinesToPayload(billData);
    mergeLineUploadsIntoBillLines(req.files, billData);

    // Strip leftover multipart keys after merge
    Object.keys(billData).forEach((key) => {
      if (key.startsWith('existingLineAttachments_') || key.startsWith('lineAttachment_')) {
        delete billData[key];
      }
    });

    if (billData.useCentralizedStore && !billData.vendorId && !billData.payeeEmployee) {
      return res.status(400).json({ success: false, message: 'Select a supplier / vendor or an employee' });
    }
    if (!billData.provider?.trim()) {
      return res.status(400).json({ success: false, message: 'Supplier / vendor or employee is required' });
    }
    if (!billData.dueDate || Number.isNaN(new Date(billData.dueDate).getTime())) {
      return res.status(400).json({ success: false, message: 'Due date is required' });
    }

    const ALLOWED_UTILITY_TYPES = [
      'Electricity', 'Water', 'Gas', 'Internet', 'Phone',
      'Maintenance', 'Security', 'Cleaning', 'Rent', 'Other'
    ];
    if (!ALLOWED_UTILITY_TYPES.includes(String(billData.utilityType || ''))) {
      billData.utilityType = 'Other';
    }
    if (Array.isArray(billData.billLines)) {
      billData.billLines = billData.billLines.map((line) => {
        const next = { ...line };
        if (!ALLOWED_UTILITY_TYPES.includes(String(next.utilityType || ''))) {
          next.utilityType = 'Other';
        }
        if (next.expenseAccount === '' || next.expenseAccount == null) {
          next.expenseAccount = undefined;
        }
        if (next.storeItem === '' || next.storeItem == null) {
          next.storeItem = undefined;
        }
        return next;
      });
    }

    const isStoreBill =
      billData.useCentralizedStore === true || billData.useCentralizedStore === 'true';
    if (isStoreBill && Array.isArray(billData.billLines) && billData.billLines.length) {
      const kindCheck = validateBillLinesSameKind(billData.billLines);
      if (!kindCheck.ok) {
        return res.status(400).json({ success: false, message: kindCheck.message });
      }
      if (kindCheck.kind === 'utility') {
        const missingAmount = billData.billLines.some((l) => !(Number(l.duePaymentAmount) > 0));
        const missingDue = billData.billLines.some((l) => !l.dueDate);
        if (missingDue) {
          return res.status(400).json({ success: false, message: 'Each utility bill line must have a due date' });
        }
        if (missingAmount) {
          return res.status(400).json({
            success: false,
            message: 'Each utility bill line must have Amount after Due Date (does not change bill amount)'
          });
        }
      }
    }

    const bill = new UtilityBill(billData);
    if (Array.isArray(bill.billLines) && bill.billLines.length) {
      bill.markModified('billLines');
    }
    await bill.save();

    try {
      await populateUtilityBillDocument(bill);
    } catch (popErr) {
      console.warn('[UtilityBill] populate after create failed:', popErr.message);
    }

    res.status(201).json({ success: true, data: bill });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Bill ID already exists'
      });
    }
    console.error('Error creating utility bill:', error);
    const message =
      error?.name === 'ValidationError'
        ? Object.values(error.errors || {}).map((e) => e.message).filter(Boolean).join('; ') || error.message
        : (error?.message || 'Failed to create utility bill');
    res.status(500).json({
      success: false,
      message: message || 'Failed to create utility bill'
    });
  }
});

// Update utility bill
router.put('/:id', upload.any(), requireBillPermission('update'), async (req, res) => {
  try {
    const updateData = { ...req.body };
    delete updateData.approvalChain;
    delete updateData.approvalStatus;
    delete updateData.approvedBy;
    delete updateData.approvedAt;
    delete updateData.rejectedBy;
    delete updateData.rejectedAt;
    delete updateData.workflowHistory;
    delete updateData.auditStatus;
    delete updateData.observations;
    delete updateData.updatedBy;
    delete updateData.isConsolidated;
    delete updateData.consolidatedFrom;
    delete updateData.consolidatedIntoBillId;
    if (req.body.draftApproverIds !== undefined || req.body.draftApprovalSlots !== undefined || req.body.approvalSlots !== undefined) {
      const existingBill = await UtilityBill.findById(req.params.id).select('useCentralizedStore').lean();
      const useAllUsersApprovers =
        updateData.useCentralizedStore === true ||
        updateData.useCentralizedStore === 'true' ||
        existingBill?.useCentralizedStore === true;
      const draftIds = applyDraftApprovalSlotsToPayload(updateData, req.body, {
        isCentralized: useAllUsersApprovers
      });
      if (draftIds.length) {
        const approverCheck = useAllUsersApprovers
          ? await assertActiveUserApproversEligible(draftIds)
          : await assertUtilityBillApproversEligible(draftIds);
        if (!approverCheck.ok) {
          return res.status(400).json({ success: false, message: approverCheck.message });
        }
      } else {
        updateData.draftApproverIds = [];
        updateData.draftApprovalSlots = [];
      }
    }

    // Add image path if uploaded
    if (req.files && Array.isArray(req.files)) {
      const mainImg = req.files.find((f) => f.fieldname === 'billImage');
      if (mainImg) {
        updateData.billImage = `/uploads/utility-bills/${mainImg.filename}`;
      }
    } else if (req.file) {
      updateData.billImage = `/uploads/utility-bills/${req.file.filename}`;
    } else if (updateData.billImage === '{}' || updateData.billImage === '') {
      // Remove empty billImage field
      delete updateData.billImage;
    }

    if (updateData.amount) updateData.amount = parseFloat(updateData.amount);
    if (updateData.paidAmount) updateData.paidAmount = parseFloat(updateData.paidAmount);
    if (updateData.lastMonthAmount) updateData.lastMonthAmount = parseFloat(updateData.lastMonthAmount);
    if (updateData.balanceAmount) updateData.balanceAmount = parseFloat(updateData.balanceAmount);
    if (updateData.grandTotal) updateData.grandTotal = parseFloat(updateData.grandTotal);
    if (!updateData.grandTotal && updateData.amount) {
      updateData.grandTotal = updateData.amount || 0;
    }
    if (!updateData.balanceAmount && updateData.grandTotal) {
      updateData.balanceAmount = Math.max((updateData.grandTotal || 0) - (updateData.lastMonthAmount || 0), 0);
    }
    if (updateData.billDate) updateData.billDate = new Date(updateData.billDate);
    if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate);

    if (updateData.billLines !== undefined) {
      await applyBillLinesToPayload(updateData);
      mergeLineUploadsIntoBillLines(req.files, updateData);
    }

    const existingBill = await UtilityBill.findById(req.params.id)
      .select('approvalStatus auditStatus consolidatedIntoBillId useCentralizedStore');
    if (!existingBill) {
      return res.status(404).json({ success: false, message: 'Utility bill not found' });
    }
    if (updateData.billLines !== undefined) {
      const isStoreBill =
        updateData.useCentralizedStore === true ||
        updateData.useCentralizedStore === 'true' ||
        existingBill.useCentralizedStore === true;
      if (isStoreBill && Array.isArray(updateData.billLines) && updateData.billLines.length) {
        const kindCheck = validateBillLinesSameKind(updateData.billLines);
        if (!kindCheck.ok) {
          return res.status(400).json({ success: false, message: kindCheck.message });
        }
        if (kindCheck.kind === 'utility') {
          const missingAmount = updateData.billLines.some((l) => !(Number(l.duePaymentAmount) > 0));
          const missingDue = updateData.billLines.some((l) => !l.dueDate);
          if (missingDue) {
            return res.status(400).json({ success: false, message: 'Each utility bill line must have a due date' });
          }
          if (missingAmount) {
            return res.status(400).json({
              success: false,
              message: 'Each utility bill line must have Amount after Due Date (does not change bill amount)'
            });
          }
        }
      }
    }
    if (existingBill.consolidatedIntoBillId) {
      return res.status(400).json({
        success: false,
        message: 'Bundled bills cannot be updated from this form. Open the consolidated main bill.'
      });
    }
    if (
      existingBill.approvalStatus === 'Approved' &&
      auditStatusesBlockingEdit.includes(existingBill.auditStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: 'This bill is with audit and cannot be edited until it is returned for correction.'
      });
    }

    const bill = await UtilityBill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Utility bill not found' });
    }

    const { billLines, ...scalarUpdate } = updateData;
    Object.keys(scalarUpdate).forEach((key) => {
      if (key.startsWith('existingLineAttachments_')) return;
      bill.set(key, scalarUpdate[key]);
    });
    if (billLines !== undefined) {
      bill.billLines = billLines;
      bill.markModified('billLines');
    }
    await bill.save({ runValidators: true });

    await populateUtilityBillDocument(bill);

    res.json({ success: true, data: bill });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Bill ID already exists'
      });
    }
    console.error('Error updating utility bill:', error);
    res.status(500).json({ success: false, message: 'Failed to update utility bill' });
  }
});

// Submit utility bill for approval
router.post('/:id/submit', requireBillPermission('update'), async (req, res) => {
  try {
    const bill = await UtilityBill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Utility bill not found' });
    }

    if (!['Draft', 'Submitted', 'Rejected'].includes(bill.approvalStatus)) {
      return res.status(400).json({ success: false, message: 'Only draft, submitted, or rejected bills can be submitted' });
    }

    const slots = resolveApprovalSlots(req.body || {}, bill);
    const slotValidation = bill.useCentralizedStore
      ? validateCentralizedApprovalSlots(slots)
      : validateStandardApprovalSlots(slots);
    if (!slotValidation.ok) {
      return res.status(400).json({ success: false, message: slotValidation.message });
    }

    const approverIds = slots.map((s) => s.approverId);

    const actorId = getActorId(req);
    if (actorId && approverIds.includes(actorId)) {
      return res.status(400).json({
        success: false,
        message: 'Requester cannot be selected as an approval authority'
      });
    }

    const useAllUsersApprovers = bill.useCentralizedStore === true;
    const approverDeptCheck = useAllUsersApprovers
      ? await assertActiveUserApproversEligible(approverIds)
      : await assertUtilityBillApproversEligible(approverIds);
    if (!approverDeptCheck.ok) {
      return res.status(400).json({ success: false, message: approverDeptCheck.message });
    }

    const approvers = await User.find({ _id: { $in: approverIds }, isActive: true }).select('_id');
    if (approvers.length !== approverIds.length) {
      return res.status(400).json({ success: false, message: 'Selected approval authorities are not valid' });
    }

    const previousStatus = bill.approvalStatus;
    bill.approvalStatus = 'Submitted';
    bill.approvalChain = slots.map((s) => ({
      approver: s.approverId,
      role: s.role,
      status: 'pending'
    }));
    bill.draftApproverIds = [];
    bill.draftApprovalSlots = [];
    bill.approvedBy = undefined;
    bill.approvedAt = undefined;
    bill.rejectedBy = undefined;
    bill.rejectedAt = undefined;
    bill.rejectionReason = '';
    addWorkflowHistory(bill, previousStatus, bill.approvalStatus, actorId, 'Submitted for approval');
    await bill.save();
    await populateUtilityBillDocument(bill);

    if (bill.useCentralizedStore) {
      const { notifyChatApprovers } = require('../utils/approvalChatNotifier');
      notifyChatApprovers(approverIds, { 
        docType: 'Centralized Store Bill', 
        docNumber: bill.billId || '',
        url: `/general/centralized-store/bills/${bill._id}`,
        fromUser: req.user
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Utility bill submitted for approval', data: bill });
  } catch (error) {
    console.error('Error submitting utility bill:', error);
    res.status(500).json({ success: false, message: 'Failed to submit utility bill' });
  }
});

// Approve utility bill
router.post('/:id/approve', requireBillPermission('update'), async (req, res) => {
  try {
    const bill = await UtilityBill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Utility bill not found' });
    }

    if (bill.approvalStatus !== 'Submitted') {
      return res.status(400).json({ success: false, message: 'Only submitted bills can be approved' });
    }

    const userId = getActorId(req);
    if (bill.createdBy?.toString() === userId) {
      return res.status(403).json({
        success: false,
        message: 'Requester cannot approve Manager or Head Of Department approval authority'
      });
    }
    const firstPendingIndex = (bill.approvalChain || []).findIndex((step) => step.status === 'pending');
    const pendingIndex = (bill.approvalChain || []).findIndex((step) => (
      step.approver?.toString() === userId && step.status === 'pending'
    ));

    if (pendingIndex === -1 || firstPendingIndex !== pendingIndex) {
      return res.status(403).json({
        success: false,
        message: pendingIndex === -1
          ? 'You are not the pending approval authority for this bill'
          : 'Earlier approval authorities must approve first'
      });
    }

    bill.approvalChain[pendingIndex].status = 'approved';
    bill.approvalChain[pendingIndex].actedAt = new Date();

    const previousStatus = bill.approvalStatus;
    const allApproved = (bill.approvalChain || []).every((step) => step.status === 'approved');
    if (allApproved) {
      bill.approvalStatus = 'Approved';
      bill.approvedBy = userId;
      bill.approvedAt = new Date();
      const previousAuditStatus = bill.auditStatus || 'Not Sent';
      bill.auditStatus = 'Send to Audit';
      addWorkflowHistory(bill, previousAuditStatus, bill.auditStatus, userId, 'Sent to Pre-Audit after approval authority completed');
    }
    addWorkflowHistory(bill, previousStatus, bill.approvalStatus, userId, allApproved ? 'Approved' : 'Approval authority approved');
    await bill.save();
    if (allApproved) {
      await notifyAuditQueue({ actorId: userId, bill });
    }
    await populateUtilityBillDocument(bill);

    res.json({ success: true, message: 'Utility bill approved', data: bill });
  } catch (error) {
    console.error('Error approving utility bill:', error);
    res.status(500).json({ success: false, message: 'Failed to approve utility bill' });
  }
});

// Reject utility bill
router.post('/:id/reject', requireBillPermission('update'), async (req, res) => {
  try {
    const reason = String(req.body?.rejectionReason || '').trim();
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const bill = await UtilityBill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Utility bill not found' });
    }

    if (bill.approvalStatus !== 'Submitted') {
      return res.status(400).json({ success: false, message: 'Only submitted bills can be rejected' });
    }

    const userId = getActorId(req);
    if (bill.createdBy?.toString() === userId) {
      return res.status(403).json({
        success: false,
        message: 'Requester cannot reject Manager or Head Of Department approval authority'
      });
    }
    const firstPendingIndex = (bill.approvalChain || []).findIndex((step) => step.status === 'pending');
    const pendingIndex = (bill.approvalChain || []).findIndex((step) => (
      step.approver?.toString() === userId && step.status === 'pending'
    ));

    if (pendingIndex === -1 || firstPendingIndex !== pendingIndex) {
      return res.status(403).json({
        success: false,
        message: pendingIndex === -1
          ? 'You are not the pending approval authority for this bill'
          : 'Earlier approval authorities must approve first'
      });
    }

    bill.approvalChain[pendingIndex].status = 'rejected';
    bill.approvalChain[pendingIndex].actedAt = new Date();
    bill.approvalChain[pendingIndex].comment = reason;

    const previousStatus = bill.approvalStatus;
    bill.approvalStatus = 'Rejected';
    bill.rejectedBy = userId;
    bill.rejectedAt = new Date();
    bill.rejectionReason = reason;
    addWorkflowHistory(bill, previousStatus, bill.approvalStatus, userId, reason);
    await bill.save();
    await populateUtilityBillDocument(bill);

    res.json({ success: true, message: 'Utility bill rejected', data: bill });
  } catch (error) {
    console.error('Error rejecting utility bill:', error);
    res.status(500).json({ success: false, message: 'Failed to reject utility bill' });
  }
});

// After audit return: save optional observation replies and send bill back to Pre-Audit queue
router.post('/:id/resend-to-audit', requireBillPermission('update'), async (req, res) => {
  try {
    const bill = await UtilityBill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Utility bill not found' });
    }
    if (bill.consolidatedIntoBillId) {
      return res.status(400).json({
        success: false,
        message: 'Bundled bills cannot be resent to audit from this screen.'
      });
    }
    if (bill.auditStatus !== 'Returned from Audit') {
      return res.status(400).json({
        success: false,
        message: 'Only bills returned from audit can be sent back to Pre-Audit.'
      });
    }
    if (bill.approvalStatus !== 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'Bill must be approved by internal authorities before it can re-enter the audit queue.'
      });
    }

    const actorId = getActorId(req);
    const observationAnswers = req.body?.observationAnswers;

    if (Array.isArray(observationAnswers)) {
      for (const entry of observationAnswers) {
        const oid = entry?.observationId;
        const text = String(entry?.answer || '').trim();
        if (!oid || !text) continue;
        try {
          const sub = bill.observations.id(oid);
          if (sub) {
            sub.answer = text;
            sub.answeredBy = actorId;
            sub.answeredAt = new Date();
            sub.resolved = true;
            const obsPreview = String(sub.observation || '').trim().slice(0, 120);
            addWorkflowHistory(
              bill,
              bill.auditStatus,
              bill.auditStatus,
              actorId,
              `Administration response to observation${obsPreview ? `: "${obsPreview}${sub.observation.length > 120 ? '…' : ''}"` : ''} — ${text}`
            );
          }
        } catch (e) {
          // ignore invalid subdocument ids
        }
      }
    }

    const previousAudit = bill.auditStatus;
    bill.auditStatus = 'Send to Audit';
    const note = String(req.body?.resubmitComments || '').trim();
    addWorkflowHistory(
      bill,
      previousAudit,
      bill.auditStatus,
      actorId,
      note ? `Resent to Pre-Audit: ${note}` : 'Resent to Pre-Audit after corrections'
    );
    bill.updatedBy = actorId;
    await bill.save();
    await populateUtilityBillDocument(bill);
    await notifyAuditQueue({ actorId, bill });

    res.json({ success: true, message: 'Bill sent back to the Pre-Audit queue.', data: bill });
  } catch (error) {
    console.error('Error resending utility bill to audit:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to resend to audit' });
  }
});

// Post audit-approved bill to Finance (AP + GL) — manual retry if auto-post failed
router.post('/:id/post-to-finance', permissions.checkSubRolePermission('admin', 'utility_bills_management', 'update'), async (req, res) => {
  try {
    const bill = await UtilityBill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Utility bill not found' });
    }
    if (!isUtilityBillAuditFinalApproved(bill.auditStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Bill must be finally approved by Audit Director before posting to Finance.'
      });
    }
    const actorId = req.user?.id || req.user?._id;
    const result = await postUtilityBillToFinance(bill, actorId);
    await populateUtilityBillDocument(bill);

    if (result.error && !result.posted && !result.apId) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Failed to post to Finance',
        data: result
      });
    }

    const message = result.posted
      ? (result.repaired ? 'Finance GL repaired and linked to this utility bill.' : 'Posted to Finance (Accounts Payable).')
      : result.reason === 'already_posted'
        ? 'Already posted to Finance.'
        : 'No changes made.';

    res.json({ success: true, message, data: { bill, financePost: result } });
  } catch (error) {
    console.error('Error posting utility bill to finance:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to post to Finance' });
  }
});

// Record payment
router.put('/:id/payment', permissions.checkSubRolePermission('admin', 'utility_bills_management', 'update'), async (req, res) => {
  try {
    const { paidAmount, paymentMethod, paymentDate, notes } = req.body;

    const bill = await UtilityBill.findById(req.params.id);
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Utility bill not found'
      });
    }

    if (bill.financeApBillId) {
      return res.status(400).json({
        success: false,
        message: 'This bill was posted to Finance Accounts Payable. Record payment in Finance → Accounts Payable, not here.'
      });
    }

    bill.paidAmount = paidAmount;
    bill.paymentMethod = paymentMethod;
    bill.paymentDate = paymentDate || new Date();
    if (notes) bill.notes = notes;
    
    await bill.save();

    const populatedBill = await populateUtilityBill(UtilityBill.findById(bill._id));

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      data: populatedBill
    });
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({
      success: false,
      message: 'Error recording payment',
      error: error.message
    });
  }
});

// Delete utility bill
router.delete('/:id', permissions.checkSubRolePermission('admin', 'utility_bills_management', 'delete'), async (req, res) => {
  try {
    const bill = await UtilityBill.findById(req.params.id);

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Utility bill not found'
      });
    }

    if (bill.consolidatedIntoBillId) {
      return res.status(400).json({
        success: false,
        message: 'This bill is part of a consolidated bundle. Remove it from the parent bill workflow first (or delete the consolidated parent).'
      });
    }

    if (bill.isConsolidated) {
      await UtilityBill.updateMany(
        { consolidatedIntoBillId: bill._id },
        { $set: { consolidatedIntoBillId: null } }
      );
    }

    await UtilityBill.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Utility bill deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting utility bill:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting utility bill',
      error: error.message
    });
  }
});

module.exports = router;
