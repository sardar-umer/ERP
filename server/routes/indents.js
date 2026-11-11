const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult, query } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authorize, authMiddleware } = require('../middleware/auth');
const Indent = require('../models/general/Indent');
const Department = require('../models/hr/Department');
const User = require('../models/User');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const Quotation = require('../models/procurement/Quotation');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');
const { notifyApprovers } = require('../utils/approvalWhatsAppNotifier');
const { notifyChatApprovers } = require('../utils/approvalChatNotifier');
const {
  canMutateComparativeAuthorityUsers,
  authorityUserRefsChanged
} = require('../utils/comparativeStatementAuthorityLock');

const router = express.Router();

const indentUploadDir = path.join(__dirname, '../uploads/indents');
const indentUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(indentUploadDir)) {
      fs.mkdirSync(indentUploadDir, { recursive: true });
    }
    cb(null, indentUploadDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `indent-${unique}${path.extname(file.originalname)}`);
  }
});

const indentUpload = multer({
  storage: indentUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Attachments must be a PDF or image file'), false);
    }
  }
});

const handleIndentUpload = (req, res, next) => {
  indentUpload.array('attachments', 10)(req, res, (err) => {
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

const { normalizeChargeToBody, validateIndentChargeTo } = require('../utils/projectChargeTo');

const parseIndentRequestBody = (req, res, next) => {
  if (req.body?.data) {
    try {
      const parsed = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
      req.body = { ...parsed, ...req.body };
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid indent data JSON format' });
    }
  }
  normalizeChargeToBody(req.body);
  next();
};

const mapUploadedAttachments = (files = []) => files.map((file) => ({
  filename: file.originalname,
  path: `/uploads/indents/${file.filename}`,
  uploadedAt: new Date()
}));

/**
 * Higher management / CEO / director / president (and ops admins) see all indents.
 * Everyone else only sees own + indents they are assigned to approve or already approved.
 */
const canViewAllIndents = (user) => {
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
    'commercial_director'
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
  if (/\b(director|president|chairman|ceo)\b/.test(titleBlob)) return true;
  return false;
};

const mergeIndentQueryAnd = (filter, condition) => {
  if (!condition || !Object.keys(condition).length) return filter;
  if (filter.$and) {
    filter.$and.push(condition);
  } else if (filter.$or) {
    filter.$and = [{ $or: filter.$or }, condition];
    delete filter.$or;
  } else {
    Object.assign(filter, condition);
  }
  return filter;
};

const buildIndentPrivacyOr = (user) => {
  const uid = user?._id || user?.id;
  if (!uid) return [];
  return [
    { requestedBy: uid },
    { createdBy: uid },
    { approvedBy: uid },
    { 'approvalChain.approver': uid },
    { draftApproverIds: uid },
    { 'comparativeStatementApprovals.preparedByUser': uid },
    { 'comparativeStatementApprovals.verifiedByUser': uid },
    { 'comparativeStatementApprovals.authorisedRepUser': uid },
    { 'comparativeStatementApprovals.financeRepUser': uid },
    { 'comparativeStatementApprovals.managerProcurementUser': uid },
    { 'comparativeApproval.approvers.approver': uid },
    { 'comparativeApprovals.approvers.approver': uid },
    { 'procurementAssignment.assignedTo': uid },
    { 'workflowHistory.changedBy': uid }
  ];
};

const applyIndentPrivacyFilter = (filter, user) => {
  if (canViewAllIndents(user)) return { filter, empty: false };
  const privacyOr = buildIndentPrivacyOr(user);
  if (!privacyOr.length) return { filter, empty: true };
  mergeIndentQueryAnd(filter, { $or: privacyOr });
  return { filter, empty: false };
};

const userCanViewIndent = (user, indent) => {
  if (!user || !indent) return false;
  if (canViewAllIndents(user)) return true;
  const uid = String(user._id || user.id || '');
  if (!uid) return false;
  const same = (ref) => {
    if (!ref) return false;
    return String(ref._id || ref) === uid;
  };
  if (same(indent.requestedBy) || same(indent.createdBy) || same(indent.approvedBy)) return true;
  if (Array.isArray(indent.approvalChain) && indent.approvalChain.some((s) => same(s.approver))) return true;
  if (Array.isArray(indent.draftApproverIds) && indent.draftApproverIds.some((id) => same(id))) return true;
  const csa = indent.comparativeStatementApprovals || {};
  if (
    same(csa.preparedByUser) ||
    same(csa.verifiedByUser) ||
    same(csa.authorisedRepUser) ||
    same(csa.financeRepUser) ||
    same(csa.managerProcurementUser)
  ) {
    return true;
  }
  const caApprovers = indent.comparativeApproval?.approvers || [];
  if (caApprovers.some((s) => same(s.approver))) return true;
  const lotApprovers = Array.isArray(indent.comparativeApprovals)
    ? indent.comparativeApprovals.flatMap((lot) => lot.approvers || [])
    : [];
  if (lotApprovers.some((s) => same(s.approver))) return true;
  if (same(indent.procurementAssignment?.assignedTo)) return true;
  if (Array.isArray(indent.workflowHistory) && indent.workflowHistory.some((h) => same(h.changedBy))) {
    return true;
  }
  return false;
};

const parseRemovedAttachmentIds = (body) => {
  const raw = body.removedAttachmentIds;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const deleteAttachmentFile = (attachment) => {
  if (!attachment?.path) return;
  const filename = path.basename(attachment.path);
  const filePath = path.join(indentUploadDir, filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
};

const APPROVAL_SIGNATURE_KEYS = ['headOfDepartment', 'gmPd', 'svpAvp'];
const LEGACY_APPROVER_ROLES = ['super_admin', 'admin', 'hr_manager'];

/** Automation/local only: never enabled when NODE_ENV is production. */
function isIndentApprovalE2EBypassEnabled() {
  if (process.env.NODE_ENV === 'production') return false;
  const v = process.env.E2E_BYPASS_INDENT_APPROVAL;
  return v === '1' || String(v).toLowerCase() === 'true';
}

const refId = (v) => (v ? String(v._id || v) : null);

/** Approver who rejected the indent (latest rejection), so a resubmission goes back to them. */
function lastIndentRejecterId(indent) {
  const history = Array.isArray(indent?.rejectionHistory) ? indent.rejectionHistory : [];
  const fromHistory = history.length ? refId(history[history.length - 1].rejectedBy) : null;
  if (fromHistory) return fromHistory;
  const step = (indent?.approvalChain || []).find((s) => s.status === 'rejected');
  return step ? refId(step.approver) : null;
}

const INDENT_TARGET_ROUTES = {
  storeDashboard: '/procurement/store',
  procurementRequisitions: '/procurement/requisitions'
};

const getActiveUserIdsByDepartment = async (departmentName) => {
  const users = await User.find({
    isActive: true,
    department: { $regex: `^${String(departmentName)}$`, $options: 'i' }
  }).select('_id');
  return users.map((u) => String(u._id));
};

const getActiveUserIdsByRoles = async (roles = []) => {
  const users = await User.find({
    isActive: true,
    role: { $in: roles }
  }).select('_id');
  return users.map((u) => String(u._id));
};

const getStoreWorkflowRecipients = async () => {
  const byStoreDept = await getActiveUserIdsByDepartment('store');
  const byProcurementDept = await getActiveUserIdsByDepartment('procurement');
  const byStoreRoles = await getActiveUserIdsByRoles(['procurement_manager', 'admin', 'super_admin']);
  return [...new Set([...byStoreDept, ...byProcurementDept, ...byStoreRoles])];
};

const getProcurementWorkflowRecipients = async () => {
  const byProcurementDept = await getActiveUserIdsByDepartment('procurement');
  const byProcurementRoles = await getActiveUserIdsByRoles(['procurement_manager', 'admin', 'super_admin']);
  return [...new Set([...byProcurementDept, ...byProcurementRoles])];
};

const notifyIndentTransition = async ({
  recipientIds = [],
  actorId,
  title,
  message,
  actionUrl,
  indentId
}) => {
  await createAndEmitNotification({
    recipientIds,
    title,
    message,
    priority: 'high',
    type: 'info',
    category: 'approval',
    actionUrl,
    createdBy: actorId,
    excludeUserId: actorId,
    metadata: {
      module: 'procurement',
      entityId: indentId,
      entityType: 'Indent'
    }
  });
};

const pushIndentWorkflowHistory = (indent, {
  fromStatus = '',
  toStatus = '',
  changedBy = null,
  comments = '',
  module = 'Indent'
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

function syncSignatureSlotFromApprover(indent, chainIndex, approverUser) {
  if (!indent.signatures) indent.signatures = {};
  const key = APPROVAL_SIGNATURE_KEYS[chainIndex];
  if (!key || !approverUser) return;
  const name = [approverUser.firstName, approverUser.lastName].filter(Boolean).join(' ').trim();
  indent.signatures[key] = {
    name: name || approverUser.email || '—',
    date: new Date()
  };
}

// ==================== INDENT ROUTES ====================

// @route   GET /api/indents
// @desc    Get all indents with filters and pagination
// @access  Private
router.get('/',
  authMiddleware,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('status').optional().isIn(['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Rejected in Procurement', 'Partially Fulfilled', 'Fulfilled', 'Cancelled']),
    query('category').optional().trim(),
    query('department').optional().isMongoId().withMessage('Invalid department ID'),
    query('search').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = { isActive: true };

    // Privacy: leadership sees all; others see own + assigned/approved
    const privacy = applyIndentPrivacyFilter(filter, req.user);
    if (privacy.empty) {
      return res.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, pages: 0 }
      });
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }
    const andConditions = [];
    // When used for Procurement Requisitions: exclude indents still pending store stock check
    if (req.query.forRequisition === 'true' || req.query.forRequisition === '1') {
      andConditions.push({
        $or: [
          { storeRoutingStatus: { $ne: 'pending_store_check' } },
          { storeRoutingStatus: null }
        ]
      });
    }
    if (req.query.search) {
      andConditions.push({
        $or: [
          { indentNumber: new RegExp(req.query.search, 'i') },
          { title: new RegExp(req.query.search, 'i') },
          { description: new RegExp(req.query.search, 'i') }
        ]
      });
    }
    if (andConditions.length > 0) {
      if (filter.$and) {
        filter.$and.push(...andConditions);
      } else if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, ...andConditions];
        delete filter.$or;
      } else {
        filter.$and = andConditions;
      }
    }
    if (req.query.category) {
      filter.category = req.query.category;
    }
    if (req.query.department) {
      filter.department = req.query.department;
    }

    // Get indents
    const indents = await Indent.find(filter)
      .populate('department', 'name code')
      .populate('companyId', 'name code symbol')
      .populate('requestedBy', 'firstName lastName email employeeId digitalSignature')
      .populate('approvedBy', 'firstName lastName email digitalSignature')
      .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature')
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const total = await Indent.countDocuments(filter);

    res.json({
      success: true,
      data: indents,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  })
);

// @route   GET /api/indents/next-number
// @desc    Get next available indent number
// @access  Private
router.get('/next-number',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indentNumber = await Indent.generateIndentNumber();
    res.json({
      success: true,
      data: { nextIndentNumber: indentNumber }
    });
  })
);

// @route   GET /api/indents/next-erp-ref
// @desc    Get next available ERP Ref number
// @access  Private
router.get('/next-erp-ref',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const erpRef = await Indent.generateERPRef();
    res.json({
      success: true,
      data: { nextERPRef: erpRef }
    });
  })
);

// @route   GET /api/indents/check-indent-number
// @desc    Check whether an Indent Number is already taken by another indent
// @access  Private
// Query params: value (required), excludeId (optional – the current indent's _id when editing)
router.get('/check-indent-number',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const value = String(req.query.value || '').trim();
    if (!value) {
      return res.json({ success: true, exists: false });
    }

    const query = { indentNumber: value, isActive: { $ne: false } };
    if (req.query.excludeId) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(req.query.excludeId)) {
        query._id = { $ne: req.query.excludeId };
      }
    }

    const existing = await Indent.findOne(query).select('_id indentNumber').lean();
    res.json({
      success: true,
      exists: !!existing,
      usedBy: existing ? existing.indentNumber : null
    });
  })
);

// @route   GET /api/indents/check-erpref
// @desc    Check whether an ERP Ref is already taken by another indent
// @access  Private
// Query params: value (required), excludeId (optional – the current indent's _id when editing)
router.get('/check-erpref',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const value = String(req.query.value || '').trim();
    if (!value) {
      return res.json({ success: true, exists: false });
    }

    const query = { erpRef: value, isActive: { $ne: false } };
    if (req.query.excludeId) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(req.query.excludeId)) {
        query._id = { $ne: req.query.excludeId };
      }
    }

    const existing = await Indent.findOne(query).select('_id indentNumber').lean();
    res.json({
      success: true,
      exists: !!existing,
      usedBy: existing ? existing.indentNumber : null
    });
  })
);

// @route   GET /api/indents/departments
// @desc    Get active departments for indent form dropdown
// @access  Private
router.get('/departments',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const departments = await Department.find({ isActive: true })
      .select('name code')
      .sort({ name: 1 })
      .lean();

    res.json({
      success: true,
      data: departments
    });
  })
);

// @route   GET /api/indents/companies
// @desc    Get active placement companies for indent form dropdown
// @access  Private
// @route   POST /api/indents/budget-check
// @desc    Live budget check while an indent is being filled: { subProject, items, indentId? }
// @access  Private
router.post('/budget-check',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { checkBudget, indentLines } = require('../services/projectProcurementService');
    const { subProject, items, indentId } = req.body || {};
    if (!subProject || !mongoose.Types.ObjectId.isValid(String(subProject))) {
      return res.json({ success: true, data: null });
    }
    const exclude = indentId && mongoose.Types.ObjectId.isValid(String(indentId)) ? { excludeIndentIds: [indentId] } : {};
    const data = await checkBudget(subProject, indentLines(Array.isArray(items) ? items : []), exclude);
    res.json({ success: true, data });
  })
);

// @route   GET /api/indents/:id/budget-check
// @desc    Budget check of a saved project indent (null for department-only indents)
// @access  Private
router.get('/:id/budget-check',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ success: false, message: 'Invalid indent ID' });
    }
    // Full document: the access check looks at requester, approvers, comparative signatories and history
    const indent = await Indent.findById(req.params.id).lean();
    if (!indent || indent.isActive === false) {
      return res.status(404).json({ success: false, message: 'Indent not found' });
    }
    if (!userCanViewIndent(req.user, indent)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (!indent.chargeTo?.subProject) return res.json({ success: true, data: null });
    const { checkBudget, indentLines } = require('../services/projectProcurementService');
    const data = await checkBudget(indent.chargeTo.subProject, indentLines(indent.items), { excludeIndentIds: [indent._id] });
    res.json({ success: true, data });
  })
);

// @route   GET /api/indents/project-options
// @desc    Construction Projects with their Sub Projects and budget categories, for "Charged to" on an indent
// @access  Private
router.get('/project-options',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const ConstructionProject = require('../models/projectManagement/ConstructionProject');
    const { BUDGET_CATEGORIES } = ConstructionProject;
    const rows = await ConstructionProject.find({ status: { $ne: 'Cancelled' } })
      .select('name projectNumber parentProject status storeProject')
      .sort({ name: 1 })
      .lean();
    const subsByParent = new Map();
    rows.filter((p) => p.parentProject).forEach((p) => {
      const key = String(p.parentProject);
      if (!subsByParent.has(key)) subsByParent.set(key, []);
      subsByParent.get(key).push({ _id: p._id, name: p.name, projectNumber: p.projectNumber || '', status: p.status });
    });
    const projects = rows
      .filter((p) => !p.parentProject)
      .map((p) => ({
        _id: p._id,
        name: p.name,
        projectNumber: p.projectNumber || '',
        status: p.status,
        storeProject: p.storeProject || null,
        subProjects: subsByParent.get(String(p._id)) || []
      }));
    res.json({ success: true, data: { projects, budgetCategories: BUDGET_CATEGORIES } });
  })
);

router.get('/companies',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const PlacementCompany = require('../models/hr/Company');
    const companies = await PlacementCompany.find({ isActive: true })
      .select('name code symbol')
      .sort({ name: 1 })
      .lean();

    res.json({
      success: true,
      data: companies
    });
  })
);

// @route   GET /api/indents/dashboard
// @desc    Get dashboard statistics for indents
// @access  Private
router.get('/dashboard',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const baseFilter = { isActive: true };
    const privacy = applyIndentPrivacyFilter(baseFilter, req.user);
    const scopeFilter = privacy.empty ? { _id: null } : baseFilter;

    // Get scoped indents for statistics
    const allIndents = await Indent.find(scopeFilter);

    // Get user's department
    const user = await User.findById(userId).populate('department');
    const userDepartment = user?.department?._id || null;

    // Calculate statistics
    const stats = {
      total: allIndents.length,
      byStatus: {
        Draft: allIndents.filter(i => i.status === 'Draft').length,
        Submitted: allIndents.filter(i => i.status === 'Submitted').length,
        'Under Review': allIndents.filter(i => i.status === 'Under Review').length,
        Approved: allIndents.filter(i => i.status === 'Approved').length,
        Rejected: allIndents.filter(i => i.status === 'Rejected').length,
        'Partially Fulfilled': allIndents.filter(i => i.status === 'Partially Fulfilled').length,
        Fulfilled: allIndents.filter(i => i.status === 'Fulfilled').length,
        Cancelled: allIndents.filter(i => i.status === 'Cancelled').length
      },
      byPriority: {
        Low: allIndents.filter(i => i.priority === 'Low').length,
        Medium: allIndents.filter(i => i.priority === 'Medium').length,
        High: allIndents.filter(i => i.priority === 'High').length,
        Urgent: allIndents.filter(i => i.priority === 'Urgent').length
      },
      totalEstimatedCost: allIndents.reduce((sum, i) => sum + (i.totalEstimatedCost || 0), 0),
      myIndents: allIndents.filter(i => i.requestedBy?.toString() === userId.toString()).length,
      pendingApproval: allIndents.filter(i =>
        i.status === 'Submitted' || i.status === 'Under Review'
      ).length
    };

    // Get recent indents (privacy-scoped)
    const recentIndents = await Indent.find(scopeFilter)
      .populate('department', 'name code')
      .populate('requestedBy', 'firstName lastName email digitalSignature')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get my indents
    const myIndents = await Indent.find({
      isActive: true,
      $or: [
        { requestedBy: userId },
        ...(userDepartment ? [{ department: userDepartment }] : [])
      ]
    })
      .populate('department', 'name code')
      .populate('requestedBy', 'firstName lastName email digitalSignature')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        stats,
        recentIndents,
        myIndents
      }
    });
  })
);

// @route   GET /api/indents/approver-candidates
// @desc    Active users for indent approver pickers (any authenticated user)
// @access  Private
router.get('/approver-candidates',
  authMiddleware,
  [
    query('search').optional().trim(),
    query('departmentLike').optional().trim(),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1–100')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const raw = String(req.query.search || '').trim();
    const departmentLike = String(req.query.departmentLike || '').trim();
    const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = { isActive: true };
    if (raw) {
      const rx = new RegExp(escapeRx(raw), 'i');
      filter.$or = [
        { firstName: rx },
        { lastName: rx },
        { email: rx },
        { employeeId: rx }
      ];
    }
    if (departmentLike) {
      const tokens = departmentLike
        .split(/[,\|/]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(escapeRx);
      if (tokens.length) {
        filter.department = { $regex: tokens.join('|'), $options: 'i' };
      }
    }
    const users = await User.find(filter)
      .select('firstName lastName email employeeId department position')
      .sort({ firstName: 1, lastName: 1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: users
    });
  })
);

// @route   GET /api/indents/:id
// @desc    Get single indent by ID
// @access  Private
router.get('/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id)
      .populate('department', 'name code')
      .populate('companyId', 'name code symbol')
      .populate('requestedBy', 'firstName lastName email employeeId department digitalSignature')
      .populate('approvedBy', 'firstName lastName email digitalSignature')
      .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature')
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email')
      .populate('comments.user', 'firstName lastName email')
      .populate('procurementRejection.rejectedBy', 'firstName lastName email')
      .populate('comparativeStatementApprovals.preparedByUser', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeStatementApprovals.verifiedByUser', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeStatementApprovals.authorisedRepUser', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeStatementApprovals.financeRepUser', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeStatementApprovals.managerProcurementUser', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeApproval.approvers.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeApproval.submittedBy', 'firstName lastName email')
      .populate('comparativeApproval.rejectedBy', 'firstName lastName email')
      .populate('comparativeApproval.rejectionObservations.rejectedBy', 'firstName lastName email employeeId')
      .populate('comparativeApproval.rejectionObservations.resolvedBy', 'firstName lastName email employeeId')
      .populate('comparativeApprovals.approvers.approver', 'firstName lastName email employeeId digitalSignature')
      .populate('comparativeApprovals.submittedBy', 'firstName lastName email')
      .populate('comparativeApprovals.rejectedBy', 'firstName lastName email')
      .populate('comparativeApprovals.rejectionObservations.rejectedBy', 'firstName lastName email employeeId')
      .populate('comparativeApprovals.rejectionObservations.resolvedBy', 'firstName lastName email employeeId')
      .populate('rejectionHistory.rejectedBy', 'firstName lastName email')
      .populate('workflowHistory.changedBy', 'firstName lastName email');

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    if (!userCanViewIndent(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own indents or ones assigned to you.'
      });
    }

    // Backfill initial history entry for records created before workflow tracking
    // or rare cases where first event wasn't written.
    if (!Array.isArray(indent.workflowHistory) || indent.workflowHistory.length === 0) {
      const createdById =
        indent.createdBy?._id || indent.createdBy || indent.requestedBy?._id || indent.requestedBy || null;
      pushIndentWorkflowHistory(indent, {
        fromStatus: '',
        toStatus: indent.status || 'Draft',
        changedBy: createdById,
        comments: 'Indent created',
        module: 'Indent'
      });
      await indent.save({ validateBeforeSave: false });
      await indent.populate('workflowHistory.changedBy', 'firstName lastName email');
    }

    res.json({
      success: true,
      data: indent
    });
  })
);

// @route   POST /api/indents
// @desc    Create new indent
// @access  Private
router.post('/',
  authMiddleware,
  handleIndentUpload,
  parseIndentRequestBody,
  [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    body('department').isMongoId().withMessage('Valid department is required'),
    body('requiredDate').notEmpty().withMessage('Required date is required').isISO8601().withMessage('Required date must be a valid date'),
    body('justification').trim().notEmpty().withMessage('Justification is required'),
    body('priority').notEmpty().withMessage('Priority is required').isIn(['Low', 'Medium', 'High', 'Urgent']).withMessage('Invalid priority'),
    body('category').trim().notEmpty().withMessage('Category is required').isLength({ max: 200 }).withMessage('Category cannot exceed 200 characters'),
    body('categoryOtherDescription').optional().trim().isLength({ max: 500 }).withMessage('Category detail cannot exceed 500 characters'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.itemName').trim().notEmpty().withMessage('Item name is required'),
    body('items.*.description').trim().notEmpty().withMessage('Item description is required'),
    body('items.*.brand').trim().notEmpty().withMessage('Brand is required'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('items.*.unit').trim().notEmpty().withMessage('Unit is required'),
    body('items.*.purpose').trim().notEmpty().withMessage('Purpose is required'),
    body('items.*.estimatedCost').isFloat({ min: 0 }).withMessage('Estimated cost is required and must be 0 or greater')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const uploadedAttachments = mapUploadedAttachments(req.files || []);

    const indentData = {
      ...req.body,
      requestedBy: req.user.id,
      createdBy: req.user.id,
      status: req.body.status || 'Draft',
      attachments: uploadedAttachments
    };

    delete indentData.approvalChain;
    if (Array.isArray(indentData.draftApproverIds)) {
      const uniq = [...new Set(indentData.draftApproverIds.map(String).filter(Boolean))];
      if (uniq.length > 3) {
        return res.status(400).json({
          success: false,
          message: 'At most three draft approvers are allowed.'
        });
      }
      indentData.draftApproverIds = uniq;
    } else {
      delete indentData.draftApproverIds;
    }

    // Allow manual indentNumber if provided; otherwise auto-generate in pre-save middleware
    if (indentData.indentNumber !== undefined) {
      indentData.indentNumber = String(indentData.indentNumber || '').trim();
      if (!indentData.indentNumber) delete indentData.indentNumber;
    }

    if (indentData.erpRef !== undefined) {
      indentData.erpRef = String(indentData.erpRef || '').trim();
      if (!indentData.erpRef) delete indentData.erpRef;
    }

    // Check Indent Number uniqueness before save
    if (indentData.indentNumber) {
      const indentNoExists = await Indent.findOne({ indentNumber: indentData.indentNumber, isActive: { $ne: false } }).select('indentNumber').lean();
      if (indentNoExists) {
        return res.status(409).json({
          success: false,
          message: `Indent No. "${indentData.indentNumber}" is already taken. Please choose a different Indent Number.`
        });
      }
    }

    // Check ERP Ref uniqueness before save to give a clear error message
    if (indentData.erpRef) {
      const erpRefExists = await Indent.findOne({ erpRef: indentData.erpRef, isActive: { $ne: false } }).select('indentNumber').lean();
      if (erpRefExists) {
        return res.status(409).json({
          success: false,
          message: `ERP Ref "${indentData.erpRef}" is already used by indent ${erpRefExists.indentNumber}. Please choose a different ERP Ref.`
        });
      }
    }

    const cat = String(indentData.category || '').trim();
    const otherDesc = String(indentData.categoryOtherDescription || '').trim();
    if (cat === 'Others') {
      if (!otherDesc) {
        return res.status(400).json({
          success: false,
          message: 'When category is Others, describe what is required.'
        });
      }
      indentData.categoryOtherDescription = otherDesc;
    } else {
      indentData.categoryOtherDescription = '';
    }

    const indent = new Indent(indentData);
    const chargeToError = await validateIndentChargeTo(indent);
    if (chargeToError) {
      return res.status(400).json({ success: false, message: chargeToError });
    }
    pushIndentWorkflowHistory(indent, {
      fromStatus: '',
      toStatus: indent.status || 'Draft',
      changedBy: req.user.id,
      comments: 'Indent created',
      module: 'Indent'
    });
    await indent.save();

    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email digitalSignature');
    await indent.populate('createdBy', 'firstName lastName email');
    await indent.populate('workflowHistory.changedBy', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Indent created successfully',
      data: indent
    });
  })
);

// @route   PUT /api/indents/:id
// @desc    Update indent
// @access  Private
router.put('/:id',
  authMiddleware,
  handleIndentUpload,
  parseIndentRequestBody,
  [
    body('title').optional().trim().isLength({ min: 1, max: 200 }).withMessage('Title must be less than 200 characters'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    body('items.*.itemName').optional().trim().notEmpty().withMessage('Item name cannot be empty'),
    body('items.*.quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('status').optional().isIn(['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Rejected in Procurement', 'Partially Fulfilled', 'Fulfilled', 'Cancelled'])
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    // Check if user can edit (draft, rejected, or rejected in procurement indents owned by user)
    const isEditableStatus = ['Draft', 'Rejected', 'Rejected in Procurement'].includes(indent.status);
    const isOwner = indent.requestedBy.toString() === req.user.id.toString();
    const isSuperOrDev = ['super_admin', 'developer'].includes(req.user?.role);

    if (!isEditableStatus || (!isOwner && !isSuperOrDev)) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit draft or rejected indents that you requested'
      });
    }

    // Check Indent Number uniqueness before save (exclude the current indent)
    const incomingIndentNumber = req.body.indentNumber ? String(req.body.indentNumber).trim() : null;
    if (incomingIndentNumber && incomingIndentNumber !== indent.indentNumber) {
      const indentNoExists = await Indent.findOne({
        indentNumber: incomingIndentNumber,
        isActive: { $ne: false },
        _id: { $ne: indent._id }
      }).select('indentNumber').lean();
      if (indentNoExists) {
        return res.status(409).json({
          success: false,
          message: `Indent No. "${incomingIndentNumber}" is already taken. Please choose a different Indent Number.`
        });
      }
    }

    // Check ERP Ref uniqueness before save (exclude the current indent)
    const incomingErpRef = req.body.erpRef ? String(req.body.erpRef).trim() : null;
    if (incomingErpRef && incomingErpRef !== indent.erpRef) {
      const erpRefExists = await Indent.findOne({
        erpRef: incomingErpRef,
        isActive: { $ne: false },
        _id: { $ne: indent._id }
      }).select('indentNumber').lean();
      if (erpRefExists) {
        return res.status(409).json({
          success: false,
          message: `ERP Ref "${incomingErpRef}" is already used by indent ${erpRefExists.indentNumber}. Please choose a different ERP Ref.`
        });
      }
    }

    if (req.body.draftApproverIds !== undefined) {
      if (!['Draft', 'Rejected'].includes(indent.status)) {
        return res.status(400).json({
          success: false,
          message: 'Approvers can only be changed while the indent is in Draft or Rejected status.'
        });
      }
      const arr = Array.isArray(req.body.draftApproverIds) ? req.body.draftApproverIds : [];
      const uniq = [...new Set(arr.map(String).filter(Boolean))];
      if (uniq.length > 3) {
        return res.status(400).json({
          success: false,
          message: 'At most three draft approvers are allowed.'
        });
      }
      indent.draftApproverIds = uniq;
    }

    // Handle attachments removal & new additions
    const removedIds = parseRemovedAttachmentIds(req.body);
    const existing = (indent.attachments || []).filter((att) => {
      const idStr = String(att._id || '');
      if (removedIds.includes(idStr)) {
        deleteAttachmentFile(att);
        return false;
      }
      return true;
    });
    const newAttachments = mapUploadedAttachments(req.files || []);
    indent.attachments = [...existing, ...newAttachments];

    // Update fields (now also allowing indentNumber updates); never take approvalChain from client
    Object.keys(req.body).forEach(key => {
      if (key !== '_id' && key !== 'createdAt' && key !== 'updatedAt' && key !== 'approvalChain' && key !== 'draftApproverIds' && key !== 'attachments' && key !== 'removedAttachmentIds' && key !== 'data') {
        indent[key] = req.body[key];
      }
    });

    const cat = String(indent.category || '').trim();
    const otherDesc = String(indent.categoryOtherDescription || '').trim();
    if (cat === 'Others') {
      if (!otherDesc) {
        return res.status(400).json({
          success: false,
          message: 'When category is Others, describe what is required.'
        });
      }
      if (otherDesc.length > 500) {
        return res.status(400).json({
          success: false,
          message: 'Category detail cannot exceed 500 characters.'
        });
      }
      indent.categoryOtherDescription = otherDesc;
    } else {
      indent.categoryOtherDescription = '';
    }

    const chargeToError = await validateIndentChargeTo(indent);
    if (chargeToError) {
      return res.status(400).json({ success: false, message: chargeToError });
    }

    indent.updatedBy = req.user.id;
    await indent.save();

    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email digitalSignature');
    await indent.populate('updatedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Indent updated successfully',
      data: indent
    });
  })
);

// @route   PUT /api/indents/:id/comparative-statement-approvals
// @desc    Save comparative statement approval authorities (names/designations) for an indent
// @access  Private
router.put('/:id/comparative-statement-approvals',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    if (authorityUserRefsChanged(indent, req.body) && !canMutateComparativeAuthorityUsers(req.user, indent)) {
      return res.status(403).json({
        success: false,
        message:
          'Only Prepared By, Procurement Manager (GM), or Super Admin can change comparative approval authority users after they have been set.'
      });
    }

    const {
      preparedBy,
      verifiedBy,
      authorisedRep,
      financeRep,
      managerProcurement,
      preparedByUser,
      verifiedByUser,
      authorisedRepUser,
      financeRepUser,
      managerProcurementUser,
      notes
    } = req.body;

    const userFields = {
      preparedByUser,
      verifiedByUser,
      authorisedRepUser,
      financeRepUser,
      managerProcurementUser
    };
    const validIds = Object.values(userFields).filter((v) => v && mongoose.Types.ObjectId.isValid(String(v)));
    if (validIds.length > 0) {
      const activeUsers = await User.find({ _id: { $in: validIds }, isActive: true }).select('_id firstName lastName email');
      const byId = new Map(activeUsers.map((u) => [String(u._id), u]));
      for (const [fieldKey, fieldVal] of Object.entries(userFields)) {
        if (!fieldVal) continue;
        const keyStr = String(fieldVal);
        if (!byId.has(keyStr)) {
          return res.status(400).json({
            success: false,
            message: `${fieldKey} must be an active user.`
          });
        }
      }
      // Autofill authority display names from selected users (keeps print-friendly names in sync)
      if (preparedByUser) {
        const u = byId.get(String(preparedByUser));
        if (u) indent.comparativeStatementApprovals.preparedBy = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
      }
      if (verifiedByUser) {
        const u = byId.get(String(verifiedByUser));
        if (u) indent.comparativeStatementApprovals.verifiedBy = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
      }
      if (authorisedRepUser) {
        const u = byId.get(String(authorisedRepUser));
        if (u) indent.comparativeStatementApprovals.authorisedRep = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
      }
      if (financeRepUser) {
        const u = byId.get(String(financeRepUser));
        if (u) indent.comparativeStatementApprovals.financeRep = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
      }
      if (managerProcurementUser) {
        const u = byId.get(String(managerProcurementUser));
        if (u) indent.comparativeStatementApprovals.managerProcurement = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
      }
    }

    if (!indent.comparativeStatementApprovals) {
      indent.comparativeStatementApprovals = {};
    }
    if (preparedBy !== undefined) indent.comparativeStatementApprovals.preparedBy = preparedBy || '';
    if (verifiedBy !== undefined) indent.comparativeStatementApprovals.verifiedBy = verifiedBy || '';
    if (authorisedRep !== undefined) indent.comparativeStatementApprovals.authorisedRep = authorisedRep || '';
    if (financeRep !== undefined) indent.comparativeStatementApprovals.financeRep = financeRep || '';
    if (managerProcurement !== undefined) indent.comparativeStatementApprovals.managerProcurement = managerProcurement || '';
    if (preparedByUser !== undefined) indent.comparativeStatementApprovals.preparedByUser = preparedByUser || null;
    if (verifiedByUser !== undefined) indent.comparativeStatementApprovals.verifiedByUser = verifiedByUser || null;
    if (authorisedRepUser !== undefined) indent.comparativeStatementApprovals.authorisedRepUser = authorisedRepUser || null;
    if (financeRepUser !== undefined) indent.comparativeStatementApprovals.financeRepUser = financeRepUser || null;
    if (managerProcurementUser !== undefined) indent.comparativeStatementApprovals.managerProcurementUser = managerProcurementUser || null;
    if (notes !== undefined) indent.notes = notes == null ? '' : String(notes).trim();

    indent.updatedBy = req.user.id;
    await indent.save();

    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email digitalSignature');
    await indent.populate('updatedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Comparative statement approvals saved successfully',
      data: indent
    });
  })
);

// @route   PUT /api/indents/:id/split-po-assignments
// @desc    Save per-item vendor assignments from Comparative Statement and set involved quotations to Shortlisted. Create actual POs from Quotations page.
// @access  Private
router.put('/:id/split-po-assignments',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    const { vendorAssignments } = req.body;
    if (!vendorAssignments || typeof vendorAssignments !== 'object' || Object.keys(vendorAssignments).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'vendorAssignments is required and must be a non-empty object (item index -> quotation id)'
      });
    }

    indent.splitPOAssignments = vendorAssignments;
    indent.updatedBy = req.user.id;
    await indent.save();

    const quotationIds = [...new Set(Object.values(vendorAssignments))]
      .map((id) => (id != null ? String(id) : ''))
      .filter(Boolean);

    // Shortlist only assigned vendors; clear prior Shortlisted on the same lots that are no longer assigned.
    const assignedQuotes = quotationIds.length
      ? await Quotation.find({ _id: { $in: quotationIds }, indent: indent._id }).select('_id lotNumber').lean()
      : [];
    const lotsAffected = [...new Set(assignedQuotes.map((q) => q.lotNumber || 'A'))];

    for (const lot of lotsAffected) {
      const lotMatch =
        lot === 'A'
          ? { $or: [{ lotNumber: 'A' }, { lotNumber: null }, { lotNumber: { $exists: false } }] }
          : { lotNumber: lot };
      const idsInLot = assignedQuotes
        .filter((q) => (q.lotNumber || 'A') === lot)
        .map((q) => q._id);
      await Quotation.updateMany(
        {
          indent: indent._id,
          status: 'Shortlisted',
          _id: { $nin: idsInLot },
          ...lotMatch
        },
        { $set: { status: 'Received' } }
      );
    }

    if (quotationIds.length) {
      await Quotation.updateMany(
        { _id: { $in: quotationIds }, indent: indent._id },
        { $set: { status: 'Shortlisted' } }
      );
    }

    res.json({
      success: true,
      message: 'Vendor assignments saved and quotations shortlisted. Create Split POs from the Quotations page.',
      data: { indent: indent.toObject ? indent.toObject() : indent }
    });
  })
);

// @route   DELETE /api/indents/:id
// @desc    Cascade delete indent and all related documents across procurement, pre-audit, finance, CEO office, general indent
// @access  Private (Developer only)
router.delete('/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    // Only allow Developer to delete indents and related documents
    if (req.user.role !== 'developer') {
      return res.status(403).json({
        success: false,
        message: 'Only Developer can delete indents and their related documents'
      });
    }

    const indent = await Indent.findById(req.params.id);
    if (!indent) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    const indentId = indent._id;
    const indentNumber = indent.indentNumber;

    // Load related models
    const QuotationInvitation = require('../models/procurement/QuotationInvitation');
    const Quotation = require('../models/procurement/Quotation');
    const PurchaseOrder = require('../models/procurement/PurchaseOrder');
    const CashApproval = require('../models/procurement/CashApproval');
    const InwardGatePass = require('../models/procurement/InwardGatePass');
    const GoodsReceive = require('../models/procurement/GoodsReceive');
    const QualityInspection = require('../models/procurement/QualityInspection');
    const DeliveryChallan = require('../models/procurement/DeliveryChallan');
    const PurchaseReturn = require('../models/procurement/PurchaseReturn');
    const GoodsIssue = require('../models/procurement/GoodsIssue');
    const LandedCostVoucher = require('../models/procurement/LandedCostVoucher');
    const AccountsPayable = require('../models/finance/AccountsPayable');
    const VendorAdvance = require('../models/finance/VendorAdvance');
    const ApPaymentApplication = require('../models/finance/ApPaymentApplication');
    const JournalEntry = require('../models/finance/JournalEntry');
    const Notification = require('../models/hr/Notification');
    const BOQItem = require('../models/projectManagement/BOQItem');
    const ProjectExpense = require('../models/projectManagement/ProjectExpense');

    // 1. Find all POs linked to this indent
    const pos = await PurchaseOrder.find({ indent: indentId }).select('_id orderNumber poNumber').lean();
    const poIds = pos.map(p => p._id);
    const poNumbers = pos.map(p => p.orderNumber || p.poNumber).filter(Boolean);

    // 2. Find all Cash Approvals linked to this indent
    const cas = await CashApproval.find({ indent: indentId }).select('_id approvalNumber voucherEntryId').lean();
    const caIds = cas.map(c => c._id);
    const caNumbers = cas.map(c => c.approvalNumber).filter(Boolean);
    const caVoucherIds = cas.map(c => c.voucherEntryId).filter(Boolean);

    // 3. Find Goods Receive (GRNs) for these POs to delete LandedCostVouchers
    const grns = poIds.length ? await GoodsReceive.find({ purchaseOrder: { $in: poIds } }).select('_id').lean() : [];
    const grnIds = grns.map(g => g._id);

    // 4. Find Accounts Payable records for these POs or Cash Approvals
    const aps = (poIds.length || caIds.length) ? await AccountsPayable.find({
      $or: [
        ...(poIds.length ? [{ 'poDetails.poId': { $in: poIds } }, { poId: { $in: poIds } }] : []),
        ...(caIds.length ? [{ cashApprovalId: { $in: caIds } }] : [])
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

    // 7. Delete Goods Issues referencing PO or Indent
    await GoodsIssue.deleteMany({
      $or: [
        { referenceIndent: indentId },
        ...(poIds.length > 0 ? [{ referencePurchaseOrder: { $in: poIds } }] : [])
      ]
    });

    // 8. Delete AP Payment Applications
    if (caIds.length > 0 || apIds.length > 0) {
      await ApPaymentApplication.deleteMany({
        $or: [
          ...(caIds.length > 0 ? [{ cashApprovalId: { $in: caIds } }] : []),
          ...(apIds.length > 0 ? [{ billId: { $in: apIds } }] : [])
        ]
      });
    }

    // 9. Delete Accounts Payable bills
    if (apIds.length > 0 || poIds.length > 0 || caIds.length > 0) {
      await AccountsPayable.deleteMany({
        $or: [
          ...(apIds.length > 0 ? [{ _id: { $in: apIds } }] : []),
          ...(poIds.length > 0 ? [{ 'poDetails.poId': { $in: poIds } }, { poId: { $in: poIds } }] : []),
          ...(caIds.length > 0 ? [{ cashApprovalId: { $in: caIds } }] : [])
        ]
      });
    }

    // 10. Delete Journal Entries / Vouchers
    const allVoucherEntryIds = [...caVoucherIds, ...apVoucherIds].filter(Boolean);
    const voucherRefs = [indentNumber, indent.erpRef, ...poNumbers, ...caNumbers].filter(Boolean);
    if (allVoucherEntryIds.length > 0 || poIds.length > 0 || voucherRefs.length > 0) {
      await JournalEntry.deleteMany({
        $or: [
          ...(allVoucherEntryIds.length > 0 ? [{ _id: { $in: allVoucherEntryIds } }] : []),
          ...(poIds.length > 0 ? [{ purchaseOrder: { $in: poIds } }] : []),
          ...(voucherRefs.length > 0 ? [{ 'lines.reference': { $in: voucherRefs } }] : [])
        ]
      });
    }

    // 11. Delete Purchase Orders and Cash Approvals
    await PurchaseOrder.deleteMany({ indent: indentId });
    await CashApproval.deleteMany({ indent: indentId });

    // 12. Delete Quotations and Quotation Invitations
    await Quotation.deleteMany({ indent: indentId });
    await QuotationInvitation.deleteMany({ indent: indentId });

    // 13. Delete Notifications related to this indent or downstream docs
    await Notification.deleteMany({
      $or: [
        { 'data.indentId': indentId },
        ...(poIds.length > 0 ? [{ 'data.purchaseOrderId': { $in: poIds } }, { 'data.poId': { $in: poIds } }] : []),
        ...(caIds.length > 0 ? [{ 'data.cashApprovalId': { $in: caIds } }] : [])
      ]
    });

    // 14. Delete the Indent document itself
    await Indent.findByIdAndDelete(indentId);

    res.json({
      success: true,
      message: `Indent ${indentNumber || ''} and all related documents across procurement, pre-audit, finance, and CEO office deleted successfully.`
    });
  })
);

// @route   POST /api/indents/:id/submit
// @desc    Submit indent for approval
// @access  Private
router.post('/:id/submit',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    if (!['Draft', 'Rejected'].includes(indent.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only draft or rejected indents can be submitted'
      });
    }

    if (indent.requestedBy.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only submit your own indents'
      });
    }

    const fromBody = Array.isArray(req.body?.approverIds) ? req.body.approverIds.map(String).filter(Boolean) : [];
    const fromDraft = (indent.draftApproverIds || []).map((id) => id.toString());
    // A rejected indent goes back to the exact approver who rejected it
    const rejectedById = indent.status === 'Rejected' ? lastIndentRejecterId(indent) : null;
    const merged = rejectedById ? [rejectedById] : (fromBody.length ? fromBody : fromDraft);
    const requesterId = indent.requestedBy.toString();
    const e2eBypass = isIndentApprovalE2EBypassEnabled();
    let unique = [...new Set(merged)];

    if (unique.length === 0 && e2eBypass) {
      unique = [requesterId];
    }

    if (unique.length !== 1) {
      return res.status(400).json({
        success: false,
        message: 'Exactly one approver is required. Choose Head of Department approver.'
      });
    }

    const approverUsers = await User.find({
      _id: { $in: unique },
      isActive: true
    })
      .select('_id firstName lastName email')
      .lean();

    if (approverUsers.length !== 1) {
      return res.status(400).json({
        success: false,
        message: rejectedById
          ? 'The approver who rejected this indent is no longer an active user. Ask an admin to reassign it.'
          : 'Selected approver must be a valid active user.'
      });
    }

    const previousStatus = indent.status;
    indent.approvalChain = unique.map((id) => ({
      approver: id,
      status: 'pending'
    }));
    indent.draftApproverIds = [];
    indent.status = 'Submitted';
    if (previousStatus === 'Rejected' || previousStatus === 'Rejected in Procurement') {
      if (indent.rejectionReason) {
        indent.lastRejectionReason = indent.rejectionReason;
      }
    }
    pushIndentWorkflowHistory(indent, {
      fromStatus: previousStatus,
      toStatus: indent.status,
      changedBy: req.user.id,
      comments: previousStatus === 'Rejected' ? 'Resubmitted for approval after edits' : 'Submitted for approval',
      module: 'Indent'
    });
    indent.updatedBy = req.user.id;
    await indent.save();

    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email digitalSignature');
    await indent.populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature');

    const approver = approverUsers[0];
    await createAndEmitNotification({
      recipientIds: [approver._id],
      title: rejectedById ? 'Rejected indent resubmitted to you' : 'Indent submitted for your approval',
      message: rejectedById
        ? `Indent ${indent.indentNumber || ''} you rejected has been edited by the requester and resubmitted for your approval.`
        : `Indent ${indent.indentNumber || ''} has been submitted and is awaiting your approval.`,
      priority: 'high',
      type: 'info',
      category: 'approval',
      actionUrl: '/general/indents',
      createdBy: req.user.id,
      excludeUserId: req.user.id,
      metadata: {
        module: 'procurement',
        entityId: indent._id,
        entityType: 'Indent'
      }
    });
    notifyApprovers([approver._id], {
      docType: 'Indent',
      docNumber: indent.indentNumber || '',
      fromUser: req.user
    }).catch(() => { });
    notifyChatApprovers([approver._id], {
      docType: 'Indent',
      docNumber: indent.indentNumber || '',
      url: '/general/indents',
      fromUser: req.user
    }).catch(() => { });

    res.json({
      success: true,
      message: 'Indent submitted successfully',
      data: indent
    });
  })
);

// @route   POST /api/indents/:id/approve
// @desc    Approve indent
// @access  Private (Admin/Manager)
router.post('/:id/approve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    if (!['Submitted', 'Under Review'].includes(indent.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only submitted or under review indents can be approved'
      });
    }

    const userId = req.user._id.toString();
    const chain = indent.approvalChain || [];

    if (chain.length > 0) {
      const stepIndex = chain.findIndex(
        (step) => step.approver.toString() === userId && step.status === 'pending'
      );
      if (stepIndex === -1) {
        return res.status(403).json({
          success: false,
          message: 'You are not a pending approver for this indent.'
        });
      }

      const actingUser = await User.findById(req.user._id).select('firstName lastName email').lean();
      const previousStatus = indent.status;
      indent.approvalChain[stepIndex].status = 'approved';
      indent.approvalChain[stepIndex].actedAt = new Date();
      syncSignatureSlotFromApprover(indent, stepIndex, actingUser);

      const allApproved = indent.approvalChain.every((s) => s.status === 'approved');
      if (allApproved) {
        indent.status = 'Approved';
        indent.approvedBy = req.user._id;
        indent.approvedDate = new Date();
        indent.storeRoutingStatus = 'pending_store_check';
      } else {
        indent.status = 'Under Review';
      }

      const approverName = [actingUser?.firstName, actingUser?.lastName].filter(Boolean).join(' ').trim() || actingUser?.email || 'Approver';
      pushIndentWorkflowHistory(indent, {
        fromStatus: previousStatus,
        toStatus: indent.status,
        changedBy: req.user.id,
        comments: allApproved
          ? `${approverName} approved indent. Sent to Store Dashboard for stock check.`
          : `${approverName} approved their step.`,
        module: 'Indent'
      });

      indent.updatedBy = req.user.id;
      await indent.save();

      await indent.populate('department', 'name code');
      await indent.populate('requestedBy', 'firstName lastName email digitalSignature');
      await indent.populate('approvedBy', 'firstName lastName email digitalSignature');
      await indent.populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature');

      if (allApproved) {
        const storeRecipients = await getStoreWorkflowRecipients();
        await notifyIndentTransition({
          recipientIds: storeRecipients,
          actorId: req.user.id,
          title: 'Indent sent to Store Dashboard',
          message: `Indent ${indent.indentNumber || ''} is approved and now pending Store stock check.`,
          actionUrl: INDENT_TARGET_ROUTES.storeDashboard,
          indentId: indent._id
        });
      }

      return res.json({
        success: true,
        message: allApproved
          ? 'Indent approved successfully (all approvers completed)'
          : 'Your approval has been recorded.',
        data: indent
      });
    }

    if (!LEGACY_APPROVER_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to approve this indent.'
      });
    }

    indent.status = 'Approved';
    indent.approvedBy = req.user.id;
    indent.approvedDate = new Date();
    indent.updatedBy = req.user.id;
    indent.storeRoutingStatus = 'pending_store_check'; // Goes to Store first for stock check
    pushIndentWorkflowHistory(indent, {
      fromStatus: 'Submitted',
      toStatus: indent.status,
      changedBy: req.user.id,
      comments: 'Approved and sent to Store Dashboard for stock check.',
      module: 'Indent'
    });
    await indent.save();

    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email digitalSignature');
    await indent.populate('approvedBy', 'firstName lastName email digitalSignature');

    const storeRecipients = await getStoreWorkflowRecipients();
    await notifyIndentTransition({
      recipientIds: storeRecipients,
      actorId: req.user.id,
      title: 'Indent sent to Store Dashboard',
      message: `Indent ${indent.indentNumber || ''} is approved and now pending Store stock check.`,
      actionUrl: INDENT_TARGET_ROUTES.storeDashboard,
      indentId: indent._id
    });

    res.json({
      success: true,
      message: 'Indent approved successfully',
      data: indent
    });
  })
);

// @route   POST /api/indents/:id/move-to-procurement
// @desc    Store user moves approved indent to Procurement Requisitions (items not in stock). Reason required.
// @access  Private (Store/Procurement/Admin)
router.post('/:id/move-to-procurement',
  authMiddleware,
  authorize('super_admin', 'admin', 'procurement_manager'),
  [
    body('reason').trim().notEmpty().withMessage('Reason for moving to procurement is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    if (indent.status !== 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved indents can be moved to procurement'
      });
    }

    if (indent.storeRoutingStatus === 'moved_to_procurement') {
      return res.status(400).json({
        success: false,
        message: 'Indent already moved to Procurement Requisitions'
      });
    }

    const previousStatus = indent.status;
    indent.storeRoutingStatus = 'moved_to_procurement';
    indent.movedToProcurementBy = req.user.id;
    indent.movedToProcurementAt = new Date();
    indent.movedToProcurementReason = (req.body.reason || '').trim();
    pushIndentWorkflowHistory(indent, {
      fromStatus: previousStatus,
      toStatus: previousStatus,
      changedBy: req.user.id,
      comments: `Moved to Procurement Requisitions. Reason: ${indent.movedToProcurementReason}`,
      module: 'Store'
    });
    indent.updatedBy = req.user.id;
    await indent.save({ validateBeforeSave: false });

    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email digitalSignature');
    await indent.populate('approvedBy', 'firstName lastName email digitalSignature');
    await indent.populate('movedToProcurementBy', 'firstName lastName');

    const procurementRecipients = await getProcurementWorkflowRecipients();
    await notifyIndentTransition({
      recipientIds: procurementRecipients,
      actorId: req.user.id,
      title: 'Indent moved to Procurement Requisitions',
      message: `Indent ${indent.indentNumber || ''} has been moved from Store to Procurement.`,
      actionUrl: INDENT_TARGET_ROUTES.procurementRequisitions,
      indentId: indent._id
    });

    res.json({
      success: true,
      message: 'Indent moved to Procurement Requisitions successfully',
      data: indent
    });
  })
);

// @route   POST /api/indents/:id/resubmit-to-procurement
// @desc    Requester resubmits a procurement-rejected indent back to procurement stage (no re-approval chain)
// @access  Private
router.post('/:id/resubmit-to-procurement',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    if (indent.status !== 'Rejected in Procurement') {
      return res.status(400).json({
        success: false,
        message: 'Only requisitions rejected in procurement can be resubmitted.'
      });
    }

    if (String(indent.requestedBy) !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Only the requester can resubmit this requisition.'
      });
    }

    // Goes back to the exact procurement user who rejected it (assigned to them)
    const rejecterId = refId(indent.procurementRejection?.rejectedBy);
    const rejecter = rejecterId
      ? await User.findOne({ _id: rejecterId, isActive: true }).select('_id firstName lastName email').lean()
      : null;
    const rejecterName = rejecter
      ? [rejecter.firstName, rejecter.lastName].filter(Boolean).join(' ').trim() || rejecter.email
      : '';

    const previousStatus = indent.status;
    indent.status = 'Approved';
    indent.storeRoutingStatus = 'moved_to_procurement';
    indent.procurementRejection = {
      rejectedBy: null,
      rejectedAt: null,
      observation: ''
    };
    indent.procurementAssignment = indent.procurementAssignment || {};
    if (rejecter) {
      const note = 'Resubmitted by requester after your rejection';
      indent.procurementAssignment.status = 'assigned';
      indent.procurementAssignment.assignedTo = rejecter._id;
      indent.procurementAssignment.assignedBy = req.user.id;
      indent.procurementAssignment.assignedAt = new Date();
      indent.procurementAssignment.note = note;
      if (!Array.isArray(indent.procurementAssignment.history)) indent.procurementAssignment.history = [];
      indent.procurementAssignment.history.push({
        assignedTo: rejecter._id,
        assignedBy: req.user.id,
        assignedAt: new Date(),
        note
      });
    } else {
      indent.procurementAssignment.status = 'unassigned';
      indent.procurementAssignment.assignedTo = null;
      indent.procurementAssignment.note = '';
    }
    indent.updatedBy = req.user.id;

    pushIndentWorkflowHistory(indent, {
      fromStatus: previousStatus,
      toStatus: indent.status,
      changedBy: req.user.id,
      comments: rejecter
        ? `Requester revised and resubmitted to Procurement — sent back to ${rejecterName} who rejected it.`
        : 'Requester revised and resubmitted to Procurement (no re-approval required).',
      module: 'Indent'
    });

    await indent.save({ validateBeforeSave: false });

    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email employeeId digitalSignature');
    await indent.populate('approvedBy', 'firstName lastName email digitalSignature');
    await indent.populate('procurementRejection.rejectedBy', 'firstName lastName email');
    await indent.populate('workflowHistory.changedBy', 'firstName lastName email');

    const procurementRecipients = rejecter ? [String(rejecter._id)] : await getProcurementWorkflowRecipients();
    await notifyIndentTransition({
      recipientIds: procurementRecipients,
      actorId: req.user.id,
      title: rejecter ? 'Rejected requisition resubmitted to you' : 'Requisition resubmitted to Procurement',
      message: rejecter
        ? `Requisition ${indent.indentNumber || ''} you rejected has been revised by the requester and resubmitted to you.`
        : `Requisition ${indent.indentNumber || ''} has been revised by requester and resubmitted.`,
      actionUrl: INDENT_TARGET_ROUTES.procurementRequisitions,
      indentId: indent._id
    });

    res.json({
      success: true,
      message: rejecter
        ? `Requisition resubmitted to ${rejecterName} who rejected it.`
        : 'Requisition resubmitted to procurement successfully.',
      data: indent
    });
  })
);

// @route   POST /api/indents/:id/reject
// @desc    Reject indent
// @access  Private (Admin/Manager)
router.post('/:id/reject',
  authMiddleware,
  [
    body('rejectionReason').trim().notEmpty().withMessage('Rejection reason is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    if (!['Submitted', 'Under Review'].includes(indent.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only submitted or under review indents can be rejected'
      });
    }

    const userId = req.user._id.toString();
    const chain = indent.approvalChain || [];

    if (chain.length > 0) {
      const stepIndex = chain.findIndex(
        (step) => step.approver.toString() === userId && step.status === 'pending'
      );
      if (stepIndex === -1) {
        return res.status(403).json({
          success: false,
          message: 'You are not a pending approver for this indent.'
        });
      }

      const previousStatus = indent.status;
      indent.approvalChain[stepIndex].status = 'rejected';
      indent.approvalChain[stepIndex].actedAt = new Date();
      indent.approvalChain[stepIndex].comment = req.body.rejectionReason;
      indent.status = 'Rejected';
      indent.rejectionReason = req.body.rejectionReason;
      indent.lastRejectionReason = req.body.rejectionReason;
      if (!Array.isArray(indent.rejectionHistory)) indent.rejectionHistory = [];
      indent.rejectionHistory.push({
        rejectedBy: req.user.id,
        rejectedAt: new Date(),
        reason: req.body.rejectionReason,
        fromStatus: previousStatus
      });
      pushIndentWorkflowHistory(indent, {
        fromStatus: previousStatus,
        toStatus: indent.status,
        changedBy: req.user.id,
        comments: `Rejected: ${req.body.rejectionReason}`,
        module: 'Indent'
      });
      indent.updatedBy = req.user.id;
      await indent.save();

      await indent.populate('department', 'name code');
      await indent.populate('requestedBy', 'firstName lastName email digitalSignature');
      await indent.populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature');

      return res.json({
        success: true,
        message: 'Indent rejected successfully',
        data: indent
      });
    }

    if (!LEGACY_APPROVER_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to reject this indent.'
      });
    }

    const previousStatus = indent.status;
    indent.status = 'Rejected';
    indent.rejectionReason = req.body.rejectionReason;
    indent.lastRejectionReason = req.body.rejectionReason;
    if (!Array.isArray(indent.rejectionHistory)) indent.rejectionHistory = [];
    indent.rejectionHistory.push({
      rejectedBy: req.user.id,
      rejectedAt: new Date(),
      reason: req.body.rejectionReason,
      fromStatus: previousStatus
    });
    pushIndentWorkflowHistory(indent, {
      fromStatus: previousStatus,
      toStatus: indent.status,
      changedBy: req.user.id,
      comments: `Rejected: ${req.body.rejectionReason}`,
      module: 'Indent'
    });
    indent.updatedBy = req.user.id;
    await indent.save();

    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email digitalSignature');

    res.json({
      success: true,
      message: 'Indent rejected successfully',
      data: indent
    });
  })
);

// @route   POST /api/indents/:id/comment
// @desc    Add comment to indent
// @access  Private
router.post('/:id/comment',
  authMiddleware,
  [
    body('comment').trim().notEmpty().withMessage('Comment is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const indent = await Indent.findById(req.params.id);

    if (!indent || !indent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Indent not found'
      });
    }

    indent.comments.push({
      user: req.user.id,
      comment: req.body.comment
    });

    indent.updatedBy = req.user.id;
    await indent.save();

    await indent.populate('comments.user', 'firstName lastName email');
    await indent.populate('department', 'name code');
    await indent.populate('requestedBy', 'firstName lastName email digitalSignature');

    res.json({
      success: true,
      message: 'Comment added successfully',
      data: indent
    });
  })
);

// @route   GET /api/indents/:id/purchase-orders
// @desc    Get all purchase orders linked to an indent (for PO tracking from requisition)
// @access  Private
router.get('/:id/purchase-orders',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const indent = await Indent.findById(req.params.id).select('_id').lean();
    if (!indent) {
      return res.status(404).json({ success: false, message: 'Indent not found' });
    }
    const pos = await PurchaseOrder.find({ indent: req.params.id })
      .populate('vendor', 'name email phone')
      .select('orderNumber status vendor orderDate totalAmount items quotation createdAt')
      .sort({ createdAt: 1 })
      .lean();
    res.json({ success: true, data: pos });
  })
);

module.exports = router;

