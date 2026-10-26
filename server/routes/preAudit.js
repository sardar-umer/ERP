const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PreAudit = require('../models/audit/PreAudit');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const permissions = require('../middleware/permissions');
const asyncHandler = require('../middleware/errorHandler').asyncHandler;
const { authorize } = require('../middleware/auth');
const { getWorkflowModules, getModuleConfig } = require('../utils/adminWorkflowConfig');
const {
  hasWorkflowInitialAuditApproval,
  mapWorkflowDocumentToPreAuditStatus
} = require('../utils/preAuditWorkflowStatus');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');
const UtilityBill = require('../models/hr/UtilityBill');
const UtilityCentralStore = require('../models/hr/UtilityCentralStore');
const UtilityStoreCategory = require('../models/hr/UtilityStoreCategory');
const UtilityStoreItem = require('../models/hr/UtilityStoreItem');
const {
  postUtilityBillToFinance,
  isUtilityBillAuditFinalApproved,
  normalizeActorId
} = require('../utils/utilityBillFinance');
const { isAuditDirectorUser, canActAsAuditDirector } = require('../utils/auditDirectorRole');
const { hasAuditAccess, canPerformInitialPreAuditActions } = require('../utils/auditAccess');
const { resolveAuditStampMeta } = require('../utils/auditStampMeta');

const normalizePreAuditDepartmentName = (dept) => {
  if (!dept) return 'Admin';
  const raw = String(dept).trim();
  if (!raw) return 'Admin';
  const lower = raw.toLowerCase();
  if (lower === 'general') return 'General';
  if (lower === 'admin' || lower === 'administration') return 'Admin';
  if (lower === 'procurement') return 'Procurement';
  if (lower === 'hr' || lower === 'human resources') return 'HR';
  if (lower === 'finance' || lower === 'accounts') return 'Finance';
  if (lower === 'sales') return 'Sales';
  if (lower === 'audit') return 'Audit';
  if (lower === 'taj_utilities' || lower === 'utilities') return 'Utilities';
  // Standard capitalize words for custom departments
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

/** Cash approvals in Pre-Audit (includes post–Audit Director statuses for Approved tab). */
const CA_PRE_AUDIT_VISIBLE_STATUSES = [
  'Pending Audit',
  'Forwarded to Audit Director',
  'Returned from Audit',
  'Send to CEO Office',
  'Pending Finance'
];

const mapCashApprovalToPreAuditStatus = (ca) => {
  const status = ca?.status;
  if (status === 'Returned from Audit') return 'returned_with_observations';
  if (status === 'Forwarded to Audit Director') return 'forwarded_to_director';
  if (status === 'Send to CEO Office' || status === 'Pending Finance') return 'approved';
  if (status === 'Pending Audit' && ca?.preAuditInitialApprovedAt) return 'under_review';
  return 'pending';
};

const getUserIdsByRoles = async (roles = []) => {
  const users = await User.find({
    isActive: true,
    role: { $in: roles }
  }).select('_id');
  return users.map((u) => String(u._id));
};

const notifyAuditDirectorQueue = async ({ actorId, title, message, entityId, entityType, metadata = {} }) => {
  const recipients = await getUserIdsByRoles(['audit_director', 'super_admin', 'admin']);
  if (!recipients.length) return;
  await createAndEmitNotification({
    recipientIds: recipients,
    title,
    message,
    type: 'info',
    category: 'approval',
    priority: 'high',
    actionUrl: '/audit/pre-audit?tab=forwarded_to_director',
    createdBy: actorId,
    excludeUserId: actorId,
    metadata: {
      module: 'audit',
      entityId,
      entityType,
      queueStage: 'forwarded_to_audit_director',
      targetModule: 'audit',
      targetTab: 'director_queue',
      ...metadata
    }
  });
};

const notifyPreAuditStakeholders = async ({ actorId, title, message, entityId, recipientIds = [], metadata = {} }) => {
  const normalizeRecipientId = (value) => {
    if (!value) return '';
    if (typeof value === 'object') {
      const resolved = value._id || value.id || value.userId || value.recipient;
      return resolved ? String(resolved).trim() : '';
    }
    return String(value).trim();
  };
  const ids = [...new Set((recipientIds || []).map(normalizeRecipientId).filter(Boolean))];
  if (!ids.length) return;
  await createAndEmitNotification({
    recipientIds: ids,
    title,
    message,
    type: 'info',
    category: 'approval',
    priority: 'high',
    actionUrl: '/audit',
    createdBy: actorId,
    excludeUserId: actorId,
    metadata: {
      module: 'audit',
      entityId,
      targetModule: 'audit',
      ...metadata
    }
  });
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/pre-audit');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'pre-audit-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images, PDFs, and documents
    if (file.mimetype.startsWith('image/') || 
        file.mimetype === 'application/pdf' ||
        file.mimetype === 'application/msword' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, and documents are allowed'), false);
    }
  }
});

// ================================
// PRE AUDIT ROUTES
// ================================

// @route   GET /api/pre-audit
// @desc    Get all pre-audit documents with filtering and pagination
// @access  Private (Super Admin, Audit Manager, Auditor)
router.get('/', 
  authMiddleware,
  authorize('super_admin', 'audit_manager', 'auditor', 'audit_director'),
  asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 20,
      status,
      sourceDepartment,
      sourceModule,
      documentType,
      priority,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filters = { isActive: true };
    
    if (status) filters.status = status;
    if (sourceDepartment) filters.sourceDepartment = sourceDepartment;
    if (sourceModule) filters.sourceModule = sourceModule;
    if (documentType) filters.documentType = documentType;
    if (priority) filters.priority = priority;

    // Search functionality
    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { documentNumber: { $regex: search, $options: 'i' } },
        { referenceNumber: { $regex: search, $options: 'i' } },
        { sourceDepartmentName: { $regex: search, $options: 'i' } }
      ];
    }

    // Sort configuration
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Fetch Pre Audit documents
    const [preAuditDocs, preAuditCount] = await Promise.all([
      PreAudit.find(filters)
        .populate('sourceDepartment', 'name')
        .populate('submittedBy', 'firstName lastName email')
        .populate('reviewedBy', 'firstName lastName email')
        .populate('approvedBy', 'firstName lastName email')
        .populate('createdBy', 'firstName lastName email')
        .populate('observations.addedBy', 'firstName lastName email')
        .sort(sort)
        .lean(),
      PreAudit.countDocuments(filters)
    ]);

    // Fetch workflow documents (Payment Settlement, etc.) with status "Send to Audit"
    const workflowDocs = [];
    const workflowModules = getWorkflowModules();
    
    for (const submodule of workflowModules) {
      const config = getModuleConfig(submodule);
      if (!config) continue;
      
      try {
        const Model = require(config.modelPath);
        
        // Build query for documents that were sent to audit, approved, or returned from audit
        // This includes:
        // 1. Documents currently in "Send to Audit" status
        // 2. Documents approved from "Send to Audit" (status like "Approved (from Send to Audit)")
        // 3. Documents returned/rejected from audit (status "Returned from Audit" or "Rejected (from Send to Audit)")
        
        // Map Pre Audit status to workflow statuses
        // Always fetch all relevant workflow statuses, then filter by mapped status
        // IMPORTANT: Use exact match for "Send to Audit" and "Returned from Audit" to avoid partial matches
        const statusConditions = [
          { [config.workflowStatusField]: 'Send to Audit' },
          { [config.workflowStatusField]: 'Forwarded to Audit Director' },
          { [config.workflowStatusField]: { $regex: /^Approved \(from Send to Audit\)/ } },
          { [config.workflowStatusField]: { $regex: /^Approved \(from Forwarded to Audit Director\)/ } },
          { [config.workflowStatusField]: 'Returned from Audit' },
          { [config.workflowStatusField]: { $regex: /^Rejected \(from Send to Audit\)/ } }
        ];
        
        const workflowQuery = {
          $or: statusConditions
        };
        
        // Apply search filter if provided
        if (search) {
          const searchConditions = [
            { [config.titleField]: { $regex: search, $options: 'i' } },
            { [config.descriptionField]: { $regex: search, $options: 'i' } }
          ];
          workflowQuery.$and = [
            { $or: statusConditions },
            { $or: searchConditions }
          ];
        }
        
        let docsQuery = Model.find(workflowQuery)
          .populate('createdBy', 'firstName lastName email')
          .populate('updatedBy', 'firstName lastName email')
          .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
          .populate('observations.addedBy', 'firstName lastName email')
          .populate('observations.answeredBy', 'firstName lastName email');

        if (submodule === 'utility_bills_management') {
          docsQuery = docsQuery
            .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('billLines.storeItem', 'itemName itemCode code description');
        }
        if (submodule === 'payment_settlement') {
          docsQuery = docsQuery
            .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('approvedByUser', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('rejectedByUser', 'firstName lastName email employeeId digitalSignature approvalStamp');
        }
        if (submodule === 'rental_management') {
          docsQuery = docsQuery
            .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('approvedByUser', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('rejectedByUser', 'firstName lastName email employeeId digitalSignature approvalStamp');
        }

        const docs = await docsQuery
          .sort({ createdAt: -1 })
          .lean();
        
        // Transform workflow documents to Pre Audit format
        for (const doc of docs) {
          const workflowStatus = doc[config.workflowStatusField] || 'Draft';
          const preAuditStatus = mapWorkflowDocumentToPreAuditStatus(doc, config.workflowStatusField);

          workflowDocs.push({
            _id: doc._id,
            documentNumber: doc[config.titleField] || doc._id.toString(),
            title: `${submodule === 'utility_bills_management' && doc.utilityType ? doc.utilityType : config.name}: ${doc[config.titleField] || 'Untitled'}`,
            description: doc[config.descriptionField] || '',
            sourceModule: doc.department ? String(doc.department).trim().toLowerCase() : (doc.originatingModule || 'admin'),
            sourceDepartmentName: normalizePreAuditDepartmentName(doc.department || doc.fromDepartment || doc.originatingModule || 'Admin'),
            documentType: submodule === 'utility_bills_management' && doc.utilityType ? doc.utilityType : config.name,
            documentDate: doc[config.dateField] || doc.createdAt,
            amount: doc[config.amountField] || 0,
            lastMonthAmount: doc.lastMonthAmount,
            referenceNumber: doc[config.titleField] || '',
            status: preAuditStatus,
            priority: 'medium',
            isWorkflowDocument: true,
            workflowSubmodule: submodule,
            workflowConfig: config,
            originalDocument: doc,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            createdBy: doc.createdBy,
            workflowHistory: doc.workflowHistory || [],
            workflowStatus: workflowStatus, // Keep original workflow status for reference
            initialAuditApproved: hasWorkflowInitialAuditApproval(doc),
            initialAuditApprovedAt: hasWorkflowInitialAuditApproval(doc)
              ? (doc.workflowHistory || []).find((h) => String(h?.toStatus || '').toLowerCase() === 'initial audit approval')?.changedAt || null
              : null
          });
        }
      } catch (error) {
        console.error(`Error fetching workflow documents from ${submodule}:`, error);
      }
    }

    // Fetch Purchase Orders sent to audit (Pending Audit, Pending Finance, Returned from Audit, Sent to Audit)
    try {
      const PurchaseOrder = require('../models/procurement/PurchaseOrder');
      const auditStatuses = ['Pending Audit', 'Forwarded to Audit Director', 'Pending Finance', 'Returned from Audit', 'Sent to Audit'];
      const poQuery = { status: { $in: auditStatuses } };
      if (search) {
        poQuery.$and = [
          { status: { $in: auditStatuses } },
          { $or: [
            { orderNumber: { $regex: search, $options: 'i' } },
            { notes: { $regex: search, $options: 'i' } },
            { internalNotes: { $regex: search, $options: 'i' } }
          ]}
        ];
        delete poQuery.status;
      }
      const poDocs = await PurchaseOrder.find(poQuery)
        .populate('vendor', 'name email phone')
        .populate('createdBy', 'firstName lastName email')
        .populate('auditObservations.addedBy', 'firstName lastName email')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .sort({ createdAt: -1 })
        .lean();
      for (const doc of poDocs) {
        let preAuditStatus = 'pending';
        if (doc.status === 'Pending Finance') preAuditStatus = 'approved';
        else if (doc.status === 'Returned from Audit') preAuditStatus = 'returned_with_observations';
        else if (doc.status === 'Forwarded to Audit Director') preAuditStatus = 'forwarded_to_director';
        else if (doc.status === 'Sent to Audit') preAuditStatus = 'pending'; // post-GRN audit queue
        workflowDocs.push({
          _id: doc._id,
          documentNumber: doc.orderNumber || doc._id.toString(),
          title: `Purchase Order: ${doc.orderNumber || 'PO'}`,
          description: doc.notes || (doc.vendor ? `PO from ${doc.vendor.name}` : 'Purchase Order'),
          sourceModule: 'procurement',
          sourceDepartmentName: 'Procurement',
          sourceDepartment: null,
          documentType: 'Purchase Order',
          documentDate: doc.orderDate || doc.createdAt,
          amount: doc.totalAmount || 0,
          referenceNumber: doc.orderNumber || '',
          status: preAuditStatus,
          workflowStatus: doc.status,
          priority: (doc.priority || 'Medium').toLowerCase(),
          isWorkflowDocument: false,
          isPurchaseOrder: true,
          // distinguish post-GRN audit POs from pre-approval ones
          isPostGrnAudit: doc.status === 'Sent to Audit',
          originalDocument: doc,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          createdBy: doc.createdBy,
          workflowHistory: doc.workflowHistory || [],
          auditObservations: doc.auditObservations || [],
          preAuditInitialApprovedAt: doc.preAuditInitialApprovedAt || null,
          initialAuditApproved: Boolean(doc.preAuditInitialApprovedAt)
        });
      }
    } catch (poErr) {
      console.error('Error fetching purchase orders for pre-audit:', poErr);
    }

    // Cash Approvals in audit queue (same lifecycle as PO pre-audit / director forward)
    try {
      const CashApproval = require('../models/procurement/CashApproval');
      const caQuery = { status: { $in: CA_PRE_AUDIT_VISIBLE_STATUSES } };
      if (search) {
        caQuery.$and = [
          { status: { $in: CA_PRE_AUDIT_VISIBLE_STATUSES } },
          {
            $or: [
              { caNumber: { $regex: search, $options: 'i' } },
              { notes: { $regex: search, $options: 'i' } }
            ]
          }
        ];
        delete caQuery.status;
      }
      const caDocs = await CashApproval.find(caQuery)
        .populate('vendor', 'name email phone')
        .populate('createdBy', 'firstName lastName email')
        .populate('auditObservations.addedBy', 'firstName lastName email')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .sort({ createdAt: -1 })
        .lean();
      for (const doc of caDocs) {
        const preAuditStatus = mapCashApprovalToPreAuditStatus(doc);
        workflowDocs.push({
          _id: doc._id,
          documentNumber: doc.caNumber || doc._id.toString(),
          title: `Cash Approval: ${doc.caNumber || 'CA'}`,
          description: doc.notes || doc.purpose || (doc.vendor ? `CA from ${doc.vendor.name}` : 'Cash Approval'),
          sourceModule: doc.originatingModule === 'general' ? 'general' : 'procurement',
          sourceDepartmentName: doc.originatingModule === 'general' ? 'General' : 'Procurement',
          sourceDepartment: null,
          documentType: 'Cash Approval',
          documentDate: doc.approvalDate || doc.createdAt,
          amount: doc.totalAmount || 0,
          referenceNumber: doc.caNumber || '',
          status: preAuditStatus,
          workflowStatus: doc.status,
          priority: (doc.priority || 'Urgent').toLowerCase(),
          isWorkflowDocument: false,
          isPurchaseOrder: false,
          isCashApproval: true,
          originalDocument: doc,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          createdBy: doc.createdBy,
          workflowHistory: doc.workflowHistory || [],
          auditObservations: doc.auditObservations || [],
          preAuditInitialApprovedAt: doc.preAuditInitialApprovedAt || null,
          initialAuditApproved: Boolean(doc.preAuditInitialApprovedAt),
          auditApprovedAt: doc.auditApprovedAt || null
        });
      }
    } catch (caErr) {
      console.error('Error fetching cash approvals for pre-audit:', caErr);
    }

    // Project Management: subcontractor IPCs (same lifecycle as Cash Approvals)
    try {
      const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
      const ipcQuery = {
        invoiceType: 'Subcontractor_IPC',
        $or: [
          { approvalStatus: { $in: ['Pending Audit', 'Forwarded to Audit Director', 'Send to CEO Office', 'Forwarded to CEO', 'Approved'] } },
          { approvalStatus: 'Rejected', returnedFromStatus: { $in: ['Pending Audit', 'Forwarded to Audit Director'] } }
        ]
      };
      if (search) {
        ipcQuery.$and = [{ $or: [
          { invoiceNumber: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ] }];
      }
      const ipcDocs = await ProjectInvoice.find(ipcQuery)
        .populate('contractor', 'name')
        .populate({ path: 'project', select: 'name projectNumber parentProject', populate: { path: 'parentProject', select: 'name' } })
        .populate('createdBy', 'firstName lastName email')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .populate('observations.addedBy', 'firstName lastName email')
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean();
      for (const doc of ipcDocs) {
        const st = doc.approvalStatus;
        const preAuditStatus = st === 'Rejected' ? 'returned_with_observations'
          : st === 'Forwarded to Audit Director' ? 'forwarded_to_director'
            : ['Send to CEO Office', 'Forwarded to CEO', 'Approved'].includes(st) ? 'approved'
              : doc.preAuditInitialApprovedAt ? 'under_review' : 'pending';
        const projectLabel = [doc.project?.parentProject?.name, doc.project?.name].filter(Boolean).join(' / ');
        workflowDocs.push({
          _id: doc._id,
          documentNumber: doc.invoiceNumber,
          title: `${doc.ipcKind && doc.ipcKind !== 'Work' ? `Subcontractor ${doc.ipcKind}` : 'Subcontractor IPC'} #${doc.ipcNumber}: ${doc.invoiceNumber}`,
          description: `${doc.contractor?.name || 'Subcontractor'} — ${projectLabel}${doc.description ? ` — ${doc.description}` : ''}`,
          sourceModule: 'project_management',
          sourceDepartmentName: 'Project Management',
          sourceDepartment: null,
          documentType: 'Subcontractor IPC',
          documentDate: doc.issueDate || doc.createdAt,
          amount: doc.netPayableAmount || doc.invoiceAmount || 0,
          referenceNumber: doc.invoiceNumber,
          status: preAuditStatus,
          workflowStatus: st,
          priority: 'high',
          isWorkflowDocument: false,
          isPurchaseOrder: false,
          isCashApproval: false,
          isProjectIpc: true,
          originalDocument: doc,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          createdBy: doc.createdBy,
          workflowHistory: doc.workflowHistory || [],
          auditObservations: (doc.observations || []).map((o) => ({ ...o, addedBy: o.addedBy })),
          preAuditInitialApprovedAt: doc.preAuditInitialApprovedAt || null,
          initialAuditApproved: Boolean(doc.preAuditInitialApprovedAt),
          auditApprovedAt: doc.auditApprovedAt || null
        });
      }
    } catch (ipcErr) {
      console.error('Error fetching project IPCs for pre-audit:', ipcErr);
    }

    // Vendor Bills in audit queue (Pending Audit, Forwarded to Audit Director, Returned from Audit, Approved)
    try {
      const AccountsPayableModel = require('../models/finance/AccountsPayable');
      const vbAuditStatuses = ['Pending Audit', 'Forwarded to Audit Director', 'Returned from Audit', 'approved'];
      const vbQuery = { 
        status: { $in: vbAuditStatuses },
        referenceType: { $ne: 'utility_bill' }
      };
      if (search) {
        vbQuery.$and = [
          { status: { $in: vbAuditStatuses } },
          { referenceType: { $ne: 'utility_bill' } },
          {
            $or: [
              { billNumber: { $regex: search, $options: 'i' } },
              { vendorInvoiceNumber: { $regex: search, $options: 'i' } },
              { 'vendor.name': { $regex: search, $options: 'i' } },
              { notes: { $regex: search, $options: 'i' } }
            ]
          }
        ];
        delete vbQuery.status;
        delete vbQuery.referenceType;
      }
      const vbDocs = await AccountsPayableModel.find(vbQuery)
        .populate('vendor.vendorId', 'name email phone')
        .populate('createdBy', 'firstName lastName email')
        .populate('observations.addedBy', 'firstName lastName email')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .sort({ createdAt: -1 })
        .lean();
      for (const doc of vbDocs) {
        let preAuditStatus = 'pending';
        if (doc.status === 'approved' || doc.status === 'paid' || doc.status === 'partial') preAuditStatus = 'approved';
        else if (doc.status === 'Returned from Audit') preAuditStatus = 'returned_with_observations';
        else if (doc.status === 'Forwarded to Audit Director') preAuditStatus = 'forwarded_to_director';
        else if (doc.status === 'Pending Audit' && doc.preAuditInitialApprovedAt) preAuditStatus = 'under_review';

        const apModule = (doc.module || doc.department || 'procurement').toLowerCase();
        const apDeptName = normalizePreAuditDepartmentName(doc.department || doc.module || 'Procurement');

        workflowDocs.push({
          _id: doc._id,
          documentNumber: doc.billNumber || doc._id.toString(),
          title: `Vendor Bill: ${doc.billNumber || 'Bill'} (${doc.vendor?.name || 'Vendor'})`,
          description: doc.notes || (doc.vendor?.name ? `Vendor Bill for ${doc.vendor.name}` : 'Vendor Bill'),
          sourceModule: apModule,
          sourceDepartmentName: apDeptName,
          sourceDepartment: null,
          documentType: 'Vendor Bill',
          documentDate: doc.billDate || doc.createdAt,
          amount: doc.totalAmount || 0,
          referenceNumber: doc.billNumber || '',
          status: preAuditStatus,
          workflowStatus: doc.status,
          priority: 'medium',
          isWorkflowDocument: false,
          isPurchaseOrder: false,
          isCashApproval: false,
          isVendorBill: true,
          originalDocument: doc,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          createdBy: doc.createdBy,
          workflowHistory: doc.workflowHistory || [],
          observations: doc.observations || [],
          preAuditInitialApprovedAt: doc.preAuditInitialApprovedAt || null,
          initialAuditApproved: Boolean(doc.preAuditInitialApprovedAt)
        });
      }
    } catch (vbErr) {
      console.error('Error fetching vendor bills for pre-audit:', vbErr);
    }

    // Combine Pre Audit and workflow documents with deduplication
    const rawCombinedDocs = [
      ...preAuditDocs.map(doc => ({ ...doc, isWorkflowDocument: false })), 
      ...workflowDocs
    ];

    // Deduplicate documents: If the same documentNumber appears (e.g. across workflow and AP),
    // prefer the workflow document (which has the complete workflow history & proper module origin).
    const seenDocNumbers = new Set();
    const allDocuments = [];
    // Prioritize workflowDocs first
    const prioritizedDocs = [
      ...rawCombinedDocs.filter(d => d.isWorkflowDocument),
      ...rawCombinedDocs.filter(d => !d.isWorkflowDocument)
    ];
    for (const doc of prioritizedDocs) {
      const docKey = String(doc.documentNumber || doc.referenceNumber || doc._id).trim().toUpperCase();
      if (docKey && seenDocNumbers.has(docKey)) {
        continue;
      }
      if (docKey) {
        seenDocNumbers.add(docKey);
      }
      allDocuments.push(doc);
    }
    
    // Apply status filter if provided (for tab filtering)
    let filteredDocuments = allDocuments;
    if (status) {
      filteredDocuments = allDocuments.filter(doc => {
        // For workflow documents, check the mapped status (must match exactly)
        if (doc.isWorkflowDocument) {
          // Ensure status matches exactly - no partial matches
          return doc.status === status;
        }
        // For regular Pre Audit documents, check the status field (must match exactly)
        return doc.status === status;
      });
    }
    
    // Sort combined documents
    filteredDocuments.sort((a, b) => {
      const aValue = a[sortBy] || a.createdAt;
      const bValue = b[sortBy] || b.createdAt;
      return sortOrder === 'desc' 
        ? new Date(bValue) - new Date(aValue)
        : new Date(aValue) - new Date(bValue);
    });
    
    // Apply pagination to combined results
    const paginatedDocuments = filteredDocuments.slice(skip, skip + parseInt(limit));
    const totalCount = filteredDocuments.length;

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / parseInt(limit));
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      success: true,
      data: paginatedDocuments,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        hasNextPage,
        hasPrevPage,
        limit: parseInt(limit)
      }
    });
  })
);

// @route   GET /api/pre-audit/centralized-store-items
// @desc    Read-only centralized store catalog for audit director reference
// @access  Private (audit module users)
router.get('/centralized-store-items',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!hasAuditAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have access to audit resources.' });
    }

    const store = await UtilityCentralStore.getOrCreate(req.user?.id || req.user?._id);
    const categories = await UtilityStoreCategory.find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .select('name sortOrder')
      .lean();
    const items = await UtilityStoreItem.find({ isActive: true })
      .populate('category', 'name')
      .populate('expenseAccount', 'accountNumber name')
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    res.json({
      success: true,
      data: {
        store: { _id: store._id, name: store.name },
        categories,
        items,
        count: items.length
      }
    });
  })
);

// @route   GET /api/pre-audit/finance-vendors
// @desc    Read-only vendor list with finance summary for audit reference
router.get('/finance-vendors',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!hasAuditAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have access to audit resources.' });
    }
    const { listAuditFinanceVendors } = require('../utils/auditFinanceVendorReference');
    const data = await listAuditFinanceVendors({
      search: req.query.search,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit
    });
    res.json({ success: true, data });
  })
);

// @route   GET /api/pre-audit/finance-vendors/:supplierId
// @desc    Read-only vendor AP bills for audit reference
router.get('/finance-vendors/:supplierId',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!hasAuditAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have access to audit resources.' });
    }
    const { getAuditFinanceVendorDetail } = require('../utils/auditFinanceVendorReference');
    try {
      const data = await getAuditFinanceVendorDetail(req.params.supplierId, {
        billStatus: req.query.billStatus
      });
      res.json({ success: true, data });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to load vendor' });
    }
  })
);

// @route   GET /api/pre-audit/finance-vendors/bills/:id
// @desc    Get bill details for audit reference
// @access  Private (Audit users)
router.get('/finance-vendors/bills/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!hasAuditAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have access to audit resources.' });
    }
    const AccountsPayable = require('../models/finance/AccountsPayable');
    const PurchaseOrder = require('../models/procurement/PurchaseOrder');

    const bill = await AccountsPayable.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email digitalSignature')
      .populate('payeeEmployee', 'firstName lastName employeeId')
      .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
      .populate('observations.addedBy', 'firstName lastName email')
      .lean();
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }



    let poDetail = null;
    let targetPoId = null;
    if (bill.referenceType === 'purchase_order' && bill.referenceId) {
      targetPoId = bill.referenceId;
    } else if (bill.referenceType === 'grn' || (Array.isArray(bill.linkedGRNs) && bill.linkedGRNs.length > 0)) {
      const GoodsReceive = require('../models/procurement/GoodsReceive');
      const sampleGrnId = bill.referenceId || bill.linkedGRNs?.[0]?.grnId;
      if (sampleGrnId) {
        const grnDoc = await GoodsReceive.findById(sampleGrnId).lean();
        if (grnDoc?.purchaseOrder) targetPoId = grnDoc.purchaseOrder;
      }
    }

    if (targetPoId) {
      const Quotation = require('../models/procurement/Quotation');
      const Indent = require('../models/general/Indent');
      const GoodsReceive = require('../models/procurement/GoodsReceive');

      const po = await PurchaseOrder.findById(targetPoId)
        .populate('vendor', 'name email phone address payeeName cnic ntnCnic ntnNo')
        .populate('indent')
        .populate('auditApprovedBy', 'firstName lastName email digitalSignature')
        .populate('auditReturnedBy', 'firstName lastName email')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .lean();

      if (po) {
        const indentId = po.indent?._id || po.indent;
        let quotations = [];
        let indent = null;
        if (indentId) {
          indent = await Indent.findById(indentId)
            .populate('requestedBy', 'firstName lastName name email digitalSignature')
            .populate('department', 'name code')
            .lean();
          quotations = await Quotation.find({ indent: indentId }).populate('vendor', 'name email payeeName cnic ntnCnic').lean();
        }
        const grnIds = (bill.linkedGRNs && bill.linkedGRNs.length > 0)
          ? bill.linkedGRNs.map(g => g.grnId).filter(Boolean)
          : [];
        const grnQuery = grnIds.length > 0 ? { _id: { $in: grnIds } } : { purchaseOrder: po._id };
        const grns = await GoodsReceive.find(grnQuery).populate('supplier', 'name').populate('receivedBy', 'firstName lastName email').lean();
        poDetail = { po, indent, quotations, grns };
      }
    }

    let cashApproval = null;
    const caId = bill.employeeAdvanceAllocations?.[0]?.cashApprovalId;
    if (caId) {
      const CashApproval = require('../models/procurement/CashApproval');
      cashApproval = await CashApproval.findById(caId)
        .populate('workflowHistory.changedBy', 'firstName lastName name email digitalSignature')
        .lean();
    } else if (bill.internalNotes && /CA-\d{4}\d{2}-\d{4}/.test(bill.internalNotes)) {
      const caMatch = bill.internalNotes.match(/CA-\d{4}\d{2}-\d{4}/);
      if (caMatch) {
        const CashApproval = require('../models/procurement/CashApproval');
        cashApproval = await CashApproval.findOne({ caNumber: caMatch[0] })
          .populate('workflowHistory.changedBy', 'firstName lastName name email digitalSignature')
          .lean();
      }
    }

    res.json({
      success: true,
      data: {
        ...bill,
        vendorName: bill.vendor?.name || 'Unknown Vendor',
        poDetail,
        cashApproval
      }
    });
  })
);

// @route   GET /api/pre-audit/:id
// @desc    Get a single pre-audit document by ID
// @access  Private (Super Admin, Audit Manager, Auditor)
router.get('/:id',
  authMiddleware,
  authorize('super_admin', 'audit_manager', 'auditor', 'audit_director'),
  asyncHandler(async (req, res) => {
    let document = await PreAudit.findById(req.params.id)
      .populate('sourceDepartment', 'name')
      .populate('submittedBy', 'firstName lastName email')
      .populate('reviewedBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email')
      .populate('observations.addedBy', 'firstName lastName email')
      .populate('observations.resolvedBy', 'firstName lastName email')
      .populate('returnedBy', 'firstName lastName email')
      .populate('departmentResponse.respondedBy', 'firstName lastName email');

    if (!document) {
      // Try Purchase Order (sent to audit)
      const PurchaseOrder = require('../models/procurement/PurchaseOrder');
      const po = await PurchaseOrder.findById(req.params.id)
        .populate('vendor', 'name email phone')
        .populate('createdBy', 'firstName lastName email')
        .populate('auditApprovedBy', 'firstName lastName email')
        .populate('auditReturnedBy', 'firstName lastName email')
        .populate('auditObservations.addedBy', 'firstName lastName email')
        .populate('auditObservations.answeredBy', 'firstName lastName email')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .lean();
      const auditVisibleStatuses = ['Pending Audit', 'Forwarded to Audit Director', 'Pending Finance', 'Returned from Audit', 'Sent to Audit'];
      if (po && auditVisibleStatuses.includes(po.status)) {
        let preAuditStatus = 'pending';
        if (po.status === 'Pending Finance') preAuditStatus = 'approved';
        else if (po.status === 'Returned from Audit') preAuditStatus = 'returned_with_observations';
        else if (po.status === 'Forwarded to Audit Director') preAuditStatus = 'forwarded_to_director';
        return res.json({
          success: true,
          data: {
            _id: po._id,
            documentNumber: po.orderNumber,
            title: `Purchase Order: ${po.orderNumber || 'PO'}`,
            description: po.notes || (po.vendor ? `PO from ${po.vendor.name}` : 'Purchase Order'),
            sourceModule: 'procurement',
            sourceDepartmentName: 'Procurement',
            documentType: 'Purchase Order',
            documentDate: po.orderDate,
            amount: po.totalAmount,
            referenceNumber: po.orderNumber,
            status: preAuditStatus,
            workflowStatus: po.status,
            isWorkflowDocument: false,
            isPurchaseOrder: true,
            isPostGrnAudit: po.status === 'Sent to Audit',
            originalDocument: po,
            auditObservations: po.auditObservations || []
          }
        });
      }
      const CashApproval = require('../models/procurement/CashApproval');
      const ca = await CashApproval.findById(req.params.id)
        .populate('vendor', 'name email phone')
        .populate('createdBy', 'firstName lastName email')
        .populate('indent', 'title indentNumber erpRef')
        .populate('auditObservations.addedBy', 'firstName lastName email')
        .populate('auditObservations.answeredBy', 'firstName lastName email')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .lean();
      if (ca && CA_PRE_AUDIT_VISIBLE_STATUSES.includes(ca.status)) {
        const preAuditStatus = mapCashApprovalToPreAuditStatus(ca);
        return res.json({
          success: true,
          data: {
            _id: ca._id,
            documentNumber: ca.caNumber,
            title: `Cash Approval: ${ca.caNumber || 'CA'}`,
            description: ca.notes || ca.purpose || (ca.vendor ? `CA from ${ca.vendor.name}` : 'Cash Approval'),
            sourceModule: ca.originatingModule === 'general' ? 'general' : 'procurement',
            sourceDepartmentName: ca.originatingModule === 'general' ? 'General' : 'Procurement',
            documentType: 'Cash Approval',
            documentDate: ca.approvalDate,
            amount: ca.totalAmount,
            referenceNumber: ca.caNumber,
            status: preAuditStatus,
            workflowStatus: ca.status,
            isWorkflowDocument: false,
            isPurchaseOrder: false,
            isCashApproval: true,
            originalDocument: ca,
            auditObservations: ca.auditObservations || [],
            preAuditInitialApprovedAt: ca.preAuditInitialApprovedAt || null,
            initialAuditApproved: Boolean(ca.preAuditInitialApprovedAt),
            auditApprovedAt: ca.auditApprovedAt || null
          }
        });
      }
      const AccountsPayableModel = require('../models/finance/AccountsPayable');
      const vb = await AccountsPayableModel.findById(req.params.id)
        .populate('vendor.vendorId', 'name email phone')
        .populate('createdBy', 'firstName lastName email')
        .populate('observations.addedBy', 'firstName lastName email')
        .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
        .lean();
      const vbAuditStatuses = ['Pending Audit', 'Forwarded to Audit Director', 'Returned from Audit', 'approved'];
      if (vb && vbAuditStatuses.includes(vb.status)) {
        let preAuditStatus = 'pending';
        if (vb.status === 'approved' || vb.status === 'paid' || vb.status === 'partial') preAuditStatus = 'approved';
        else if (vb.status === 'Returned from Audit') preAuditStatus = 'returned_with_observations';
        else if (vb.status === 'Forwarded to Audit Director') preAuditStatus = 'forwarded_to_director';
        else if (vb.status === 'Pending Audit' && vb.preAuditInitialApprovedAt) preAuditStatus = 'under_review';

        const apModule = (vb.module || vb.department || 'procurement').toLowerCase();
        const apDeptName = normalizePreAuditDepartmentName(vb.department || vb.module || 'Procurement');

        return res.json({
          success: true,
          data: {
            _id: vb._id,
            documentNumber: vb.billNumber,
            title: `Vendor Bill: ${vb.billNumber || 'Bill'} (${vb.vendor?.name || 'Vendor'})`,
            description: vb.notes || (vb.vendor?.name ? `Vendor Bill for ${vb.vendor.name}` : 'Vendor Bill'),
            sourceModule: apModule,
            sourceDepartmentName: apDeptName,
            documentType: 'Vendor Bill',
            documentDate: vb.billDate,
            amount: vb.totalAmount,
            referenceNumber: vb.billNumber,
            status: preAuditStatus,
            workflowStatus: vb.status,
            isWorkflowDocument: false,
            isPurchaseOrder: false,
            isCashApproval: false,
            isVendorBill: true,
            originalDocument: vb,
            observations: vb.observations || [],
            preAuditInitialApprovedAt: vb.preAuditInitialApprovedAt || null,
            initialAuditApproved: Boolean(vb.preAuditInitialApprovedAt)
          }
        });
      }
      const workflowModules = getWorkflowModules();
      for (const submodule of workflowModules) {
        const config = getModuleConfig(submodule);
        if (!config) continue;

        try {
          const Model = require(config.modelPath);
          let workflowQuery = Model.findById(req.params.id)
            .populate('createdBy', 'firstName lastName email')
            .populate('updatedBy', 'firstName lastName email')
            .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
            .populate('observations.addedBy', 'firstName lastName email')
            .populate('observations.answeredBy', 'firstName lastName email');

          if (submodule === 'utility_bills_management') {
            workflowQuery = workflowQuery
              .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('billLines.storeItem', 'itemName itemCode code description');
          }
          if (submodule === 'payment_settlement') {
            workflowQuery = workflowQuery
              .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('approvedByUser', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('rejectedByUser', 'firstName lastName email employeeId digitalSignature approvalStamp');
          }
          if (submodule === 'rental_management') {
            workflowQuery = workflowQuery
              .populate('createdBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('approvalChain.approver', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('draftApproverIds', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('approvedByUser', 'firstName lastName email employeeId digitalSignature approvalStamp')
              .populate('rejectedByUser', 'firstName lastName email employeeId digitalSignature approvalStamp');
          }

          const workflowDoc = await workflowQuery.lean();
          const workflowStatus = workflowDoc?.[config.workflowStatusField];
          const auditVisibleStatuses = [
            'Send to Audit',
            'Forwarded to Audit Director',
            'Returned from Audit',
            'Approved (from Send to Audit)',
            'Approved (from Forwarded to Audit Director)'
          ];
          if (workflowDoc && auditVisibleStatuses.includes(workflowStatus)) {
            const preAuditStatus = mapWorkflowDocumentToPreAuditStatus(workflowDoc, config.workflowStatusField);
            const initialApproved = hasWorkflowInitialAuditApproval(workflowDoc);

            const wfModule = workflowDoc.department ? String(workflowDoc.department).trim().toLowerCase() : (workflowDoc.originatingModule || 'admin');
            const wfDeptName = normalizePreAuditDepartmentName(workflowDoc.department || workflowDoc.fromDepartment || workflowDoc.originatingModule || 'Admin');

            return res.json({
              success: true,
              data: {
                _id: workflowDoc._id,
                documentNumber: workflowDoc[config.titleField] || workflowDoc._id.toString(),
                title: `${submodule === 'utility_bills_management' && workflowDoc.utilityType ? workflowDoc.utilityType : config.name}: ${workflowDoc[config.titleField] || 'Untitled'}`,
                description: workflowDoc[config.descriptionField] || '',
                sourceModule: wfModule,
                sourceDepartmentName: wfDeptName,
                documentType: submodule === 'utility_bills_management' && workflowDoc.utilityType ? workflowDoc.utilityType : config.name,
                documentDate: workflowDoc[config.dateField] || workflowDoc.createdAt,
                amount: workflowDoc[config.amountField] || 0,
                referenceNumber: workflowDoc[config.titleField] || '',
                status: preAuditStatus,
                workflowStatus,
                isWorkflowDocument: true,
                workflowSubmodule: submodule,
                workflowConfig: config,
                originalDocument: workflowDoc,
                workflowHistory: workflowDoc.workflowHistory || [],
                initialAuditApproved: initialApproved,
                initialAuditApprovedAt: initialApproved
                  ? (workflowDoc.workflowHistory || []).find(
                      (h) => String(h?.toStatus || '').toLowerCase() === 'initial audit approval'
                    )?.changedAt || null
                  : null
              }
            });
          }
        } catch (workflowErr) {
          console.error(`Error fetching workflow document ${submodule}:`, workflowErr.message);
        }
      }
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    res.json({
      success: true,
      data: document
    });
  })
);

// @route   POST /api/pre-audit
// @desc    Create a new pre-audit document (for departments to submit)
// @access  Private (All authenticated users can submit)
router.post('/',
  authMiddleware,
  upload.array('attachments', 10),
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      sourceDepartment,
      sourceDepartmentName,
      sourceModule,
      documentType,
      documentDate,
      amount,
      referenceNumber,
      priority,
      reviewDueDate,
      tags
    } = req.body;

    // Validate required fields
    if (!title || !sourceDepartment || !sourceModule || !documentType || !documentDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, sourceDepartment, sourceModule, documentType, documentDate'
      });
    }

    // Handle file uploads
    const attachments = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        attachments.push({
          filename: file.filename,
          originalName: file.originalname,
          path: file.path,
          fileType: file.mimetype,
          fileSize: file.size,
          uploadedBy: req.user.id,
          uploadedAt: new Date()
        });
      });
    }

    const preAuditDoc = new PreAudit({
      title,
      description,
      sourceDepartment,
      sourceDepartmentName: sourceDepartmentName || req.user.department?.name || 'Unknown',
      sourceModule,
      documentType,
      documentDate: new Date(documentDate),
      amount: amount ? parseFloat(amount) : undefined,
      referenceNumber,
      priority: priority || 'medium',
      reviewDueDate: reviewDueDate ? new Date(reviewDueDate) : undefined,
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [],
      attachments,
      submittedBy: req.user.id,
      createdBy: req.user.id,
      status: 'pending'
    });

    await preAuditDoc.save();
    await preAuditDoc.populate([
      { path: 'sourceDepartment', select: 'name' },
      { path: 'submittedBy', select: 'firstName lastName email' },
      { path: 'createdBy', select: 'firstName lastName email' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Pre-audit document submitted successfully',
      data: preAuditDoc
    });
  })
);

// @route   PUT /api/pre-audit/:id/forward
// @desc    Forward a pre-audit document to Audit Director (works for both Pre Audit and workflow documents)
// @access  Private (Super Admin, Audit Manager, Auditor — not Audit Director; they approve after forward)
router.put('/:id/forward',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!canPerformInitialPreAuditActions(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Only General Audit / pre-audit staff can forward to Audit Director (not Audit Director).'
      });
    }
    const { forwardComments } = req.body;

    // Check if it's a workflow document by trying to find it in workflow modules
    let isWorkflowDocument = false;
    let workflowDocument = null;
    let workflowConfig = null;
    
    const workflowModules = getWorkflowModules();
    for (const submodule of workflowModules) {
      const config = getModuleConfig(submodule);
      if (!config) continue;
      
      try {
        const Model = require(config.modelPath);
        const doc = await Model.findById(req.params.id);
        if (doc) {
          // Check if document is in a status that can be forwarded (Send to Audit) or already forwarded
          const workflowStatus = doc[config.workflowStatusField];
          if (workflowStatus === 'Send to Audit' || workflowStatus === 'Forwarded to Audit Director') {
            isWorkflowDocument = true;
            workflowDocument = doc;
            workflowConfig = config;
            break;
          }
        }
      } catch (error) {
        // Continue to next module
        console.error(`Error checking workflow module ${submodule}:`, error.message);
      }
    }

    // Project Management IPC: Pending Audit -> Forwarded to Audit Director
    {
      const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
      const ipc = await ProjectInvoice.findOne({ _id: req.params.id, invoiceType: 'Subcontractor_IPC' }).catch(() => null);
      if (ipc) {
        if (ipc.approvalStatus === 'Forwarded to Audit Director') {
          return res.status(400).json({ success: false, message: 'Document is already forwarded to Audit Director' });
        }
        if (ipc.approvalStatus !== 'Pending Audit') {
          return res.status(400).json({ success: false, message: `IPC is ${ipc.approvalStatus}, not Pending Audit` });
        }
        if (!ipc.preAuditInitialApprovedAt) {
          return res.status(400).json({ success: false, message: 'Initial pre-audit approval is required before forwarding to Audit Director.' });
        }
        ipc.workflowHistory.push({
          fromStatus: 'Pending Audit',
          toStatus: 'Forwarded to Audit Director',
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: forwardComments || 'Forwarded to Audit Director for approval',
          module: 'Pre-Audit'
        });
        ipc.approvalStatus = 'Forwarded to Audit Director';
        await ipc.save();
        await notifyAuditDirectorQueue({
          actorId: req.user.id,
          title: 'Document forwarded to Audit Director',
          message: `Subcontractor IPC ${ipc.invoiceNumber} is waiting for your approval.`,
          entityId: ipc._id,
          entityType: 'ProjectInvoice'
        });
        return res.json({
          success: true,
          message: 'Document forwarded to Audit Director successfully',
          data: { _id: ipc._id, isProjectIpc: true, status: 'Forwarded to Audit Director', workflowStatus: ipc.approvalStatus }
        });
      }
    }

    // Purchase Order in pre-audit: forward Pending Audit -> Forwarded to Audit Director
    if (!isWorkflowDocument) {
      const PurchaseOrderModel = require('../models/procurement/PurchaseOrder');
      const po = await PurchaseOrderModel.findById(req.params.id);
      if (po && ['Pending Audit', 'Forwarded to Audit Director'].includes(po.status)) {
        if (po.status === 'Forwarded to Audit Director') {
          return res.status(400).json({
            success: false,
            message: 'Document is already forwarded to Audit Director'
          });
        }
        if (!po.preAuditInitialApprovedAt) {
          return res.status(400).json({
            success: false,
            message: 'Initial pre-audit approval is required before forwarding to Audit Director.'
          });
        }
        po.workflowHistory = po.workflowHistory || [];
        po.workflowHistory.push({
          fromStatus: 'Pending Audit',
          toStatus: 'Forwarded to Audit Director',
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: forwardComments || 'Forwarded to Audit Director for approval',
          module: 'Pre-Audit'
        });
        po.status = 'Forwarded to Audit Director';
        po.updatedBy = req.user.id;
        await po.save();
        const updated = await PurchaseOrderModel.findById(po._id)
          .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp');

        await notifyAuditDirectorQueue({
          actorId: req.user.id,
          title: 'Document forwarded to Audit Director',
          message: `Purchase Order ${po.orderNumber || po.poNumber || ''} is waiting for your approval.`,
          entityId: po._id,
          entityType: 'PurchaseOrder'
        });

        return res.json({
          success: true,
          message: 'Document forwarded to Audit Director successfully',
          data: {
            _id: po._id,
            isWorkflowDocument: false,
            isPurchaseOrder: true,
            status: 'Forwarded to Audit Director',
            workflowStatus: updated.status
          }
        });
      }

      const CashApprovalForward = require('../models/procurement/CashApproval');
      const caFwd = await CashApprovalForward.findById(req.params.id);
      if (caFwd && ['Pending Audit', 'Forwarded to Audit Director'].includes(caFwd.status)) {
        if (caFwd.status === 'Forwarded to Audit Director') {
          return res.status(400).json({
            success: false,
            message: 'Document is already forwarded to Audit Director'
          });
        }
        if (!caFwd.preAuditInitialApprovedAt) {
          return res.status(400).json({
            success: false,
            message: 'Initial pre-audit approval is required before forwarding to Audit Director.'
          });
        }
        caFwd.workflowHistory = caFwd.workflowHistory || [];
        caFwd.workflowHistory.push({
          fromStatus: 'Pending Audit',
          toStatus: 'Forwarded to Audit Director',
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: forwardComments || 'Forwarded to Audit Director for approval',
          module: 'Pre-Audit'
        });
        caFwd.status = 'Forwarded to Audit Director';
        caFwd.updatedBy = req.user.id;
        await caFwd.save();
        const updatedCa = await CashApprovalForward.findById(caFwd._id)
          .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp');

        await notifyAuditDirectorQueue({
          actorId: req.user.id,
          title: 'Document forwarded to Audit Director',
          message: `Cash Approval ${caFwd.caNumber || ''} is waiting for your approval.`,
          entityId: caFwd._id,
          entityType: 'CashApproval'
        });

        return res.json({
          success: true,
          message: 'Document forwarded to Audit Director successfully',
          data: {
            _id: caFwd._id,
            isWorkflowDocument: false,
            isCashApproval: true,
            status: 'Forwarded to Audit Director',
            workflowStatus: updatedCa.status
          }
        });
      }

      const AccountsPayableForward = require('../models/finance/AccountsPayable');
      const vbFwd = await AccountsPayableForward.findById(req.params.id);
      if (vbFwd && ['Pending Audit', 'Forwarded to Audit Director'].includes(vbFwd.status)) {
        if (vbFwd.status === 'Forwarded to Audit Director') {
          return res.status(400).json({
            success: false,
            message: 'Document is already forwarded to Audit Director'
          });
        }
        if (!vbFwd.preAuditInitialApprovedAt) {
          return res.status(400).json({
            success: false,
            message: 'Initial pre-audit approval is required before forwarding to Audit Director.'
          });
        }
        vbFwd.workflowHistory = vbFwd.workflowHistory || [];
        vbFwd.workflowHistory.push({
          fromStatus: 'Pending Audit',
          toStatus: 'Forwarded to Audit Director',
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: forwardComments || 'Forwarded to Audit Director for approval',
          module: 'Pre-Audit'
        });
        vbFwd.status = 'Forwarded to Audit Director';
        vbFwd.updatedBy = req.user.id;
        await vbFwd.save();
        const updatedVb = await AccountsPayableForward.findById(vbFwd._id)
          .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp');

        await notifyAuditDirectorQueue({
          actorId: req.user.id,
          title: 'Document forwarded to Audit Director',
          message: `Vendor Bill ${vbFwd.billNumber || ''} is waiting for your approval.`,
          entityId: vbFwd._id,
          entityType: 'AccountsPayable'
        });

        return res.json({
          success: true,
          message: 'Document forwarded to Audit Director successfully',
          data: {
            _id: vbFwd._id,
            isWorkflowDocument: false,
            isVendorBill: true,
            status: 'Forwarded to Audit Director',
            workflowStatus: updatedVb.status
          }
        });
      }
    }

    if (isWorkflowDocument) {
      // For workflow documents, update status to "Forwarded to Audit Director"
      if (workflowDocument[workflowConfig.workflowStatusField] === 'Forwarded to Audit Director') {
        return res.status(400).json({
          success: false,
          message: 'Document is already forwarded to Audit Director'
        });
      }

      if (workflowDocument[workflowConfig.workflowStatusField] === 'Approved (from Send to Audit)') {
        return res.status(400).json({
          success: false,
          message: 'Document is already approved'
        });
      }
      if (!hasWorkflowInitialAuditApproval(workflowDocument)) {
        return res.status(400).json({
          success: false,
          message: 'Initial pre-audit approval is required before forwarding to Audit Director.'
        });
      }

      // Update workflow status
      workflowDocument[workflowConfig.workflowStatusField] = 'Forwarded to Audit Director';
      
      // Add forwarding information to workflow history if it exists
      if (workflowDocument.workflowHistory && Array.isArray(workflowDocument.workflowHistory)) {
        workflowDocument.workflowHistory.push({
          fromStatus: 'Send to Audit',
          toStatus: 'Forwarded to Audit Director',
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: forwardComments || 'Forwarded to Audit Director for approval'
        });
      }

      workflowDocument.updatedBy = req.user.id;
      await workflowDocument.save();
      
      await workflowDocument.populate([
        { path: 'updatedBy', select: 'firstName lastName email' },
        { path: 'createdBy', select: 'firstName lastName email' }
      ]);

      await notifyAuditDirectorQueue({
        actorId: req.user.id,
        title: 'Document forwarded to Audit Director',
        message: `${workflowConfig.label || 'Workflow document'} is waiting for your approval.`,
        entityId: workflowDocument._id,
        entityType: workflowConfig.label || 'WorkflowDocument'
      });

      return res.json({
        success: true,
        message: 'Document forwarded to Audit Director successfully',
        data: {
          _id: workflowDocument._id,
          isWorkflowDocument: true,
          workflowSubmodule: workflowConfig.submodule,
          status: 'Forwarded to Audit Director',
          workflowStatus: workflowDocument[workflowConfig.workflowStatusField]
        }
      });
    }

    // Handle regular Pre Audit documents
    const document = await PreAudit.findById(req.params.id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    if (document.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Document is already approved'
      });
    }

    if (document.status === 'forwarded_to_director') {
      return res.status(400).json({
        success: false,
        message: 'Document is already forwarded to Audit Director'
      });
    }
    if (!document.reviewedAt) {
      return res.status(400).json({
        success: false,
        message: 'Initial pre-audit approval is required before forwarding to Audit Director.'
      });
    }

    document.status = 'forwarded_to_director';
    document.forwardedTo = 'audit_director';
    document.forwardedBy = req.user.id;
    document.forwardedAt = new Date();
    document.forwardComments = forwardComments;
    document.updatedBy = req.user.id;

    await document.save();
    await document.populate([
      { path: 'forwardedBy', select: 'firstName lastName email' },
      { path: 'sourceDepartment', select: 'name' }
    ]);

    await notifyAuditDirectorQueue({
      actorId: req.user.id,
      title: 'Document forwarded to Audit Director',
      message: `${document.documentNumber || document.referenceNumber || 'A pre-audit document'} is waiting for your approval.`,
      entityId: document._id,
      entityType: 'PreAudit'
    });

    res.json({
      success: true,
      message: 'Document forwarded to Audit Director successfully',
      data: document
    });
  })
);

// @route   PUT /api/pre-audit/:id/approve
// @desc    Approve a pre-audit document (can be done by Audit Manager or Audit Director)
// @access  Private (Super Admin, Audit Manager, Auditor, Audit Director)
router.put('/:id/approve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!hasAuditAccess(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to perform pre-audit approvals.'
      });
    }
    const { approvalComments } = req.body;
    const stampMeta = resolveAuditStampMeta(req);

    // Check if it's a workflow document by trying to find it in workflow modules
    let isWorkflowDocument = false;
    let workflowDocument = null;
    let workflowConfig = null;
    
    const workflowModules = getWorkflowModules();
    for (const submodule of workflowModules) {
      const config = getModuleConfig(submodule);
      if (!config) continue;
      
      try {
        const Model = require(config.modelPath);
        const doc = await Model.findById(req.params.id);
        if (doc && (doc[config.workflowStatusField] === 'Send to Audit' || 
                    doc[config.workflowStatusField] === 'Forwarded to Audit Director')) {
          isWorkflowDocument = true;
          workflowDocument = doc;
          workflowConfig = config;
          break;
        }
      } catch (error) {
        // Continue to next module
      }
    }

    if (isWorkflowDocument) {
      const wfStatus = workflowDocument[workflowConfig.workflowStatusField];
      // Step 1: Initial approval by assistant/auditor while still in Send to Audit.
      if (wfStatus === 'Send to Audit') {
        if (!canPerformInitialPreAuditActions(req.user)) {
          return res.status(403).json({
            success: false,
            message: 'Initial approval must be completed by General Audit / pre-audit staff before director final approval.'
          });
        }
        if (!Array.isArray(workflowDocument.workflowHistory)) workflowDocument.workflowHistory = [];
        workflowDocument.workflowHistory.push({
          fromStatus: 'Send to Audit',
          toStatus: 'Initial Audit Approval',
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: approvalComments || 'Initial pre-audit approval recorded',
          ...stampMeta
        });
        workflowDocument.updatedBy = req.user.id;
        await workflowDocument.save();
        await workflowDocument.populate([
          { path: 'updatedBy', select: 'firstName lastName email' },
          { path: 'createdBy', select: 'firstName lastName email' }
        ]);
        await notifyAuditDirectorQueue({
          actorId: req.user.id,
          title: 'Initial pre-audit approval recorded',
          message: `${workflowConfig.label || 'Workflow document'} has initial audit approval and is ready for director forwarding.`,
          entityId: workflowDocument._id,
          entityType: workflowConfig.label || 'WorkflowDocument',
          metadata: { queueStage: 'initial_audit_approved', targetTab: 'under_review' }
        });
        return res.json({
          success: true,
          message: 'Initial pre-audit approval recorded. Forward to Audit Director for final approval.',
          data: {
            _id: workflowDocument._id,
            isWorkflowDocument: true,
            workflowSubmodule: workflowConfig.submodule,
            status: 'initial_approved',
            workflowStatus: workflowDocument[workflowConfig.workflowStatusField]
          }
        });
      }

      // For workflow documents, check if forwarded and only Audit Director can approve
      if (wfStatus === 'Forwarded to Audit Director') {
        if (!canActAsAuditDirector(req.user)) {
          return res.status(403).json({
            success: false,
            message: 'Only Audit Director can approve documents forwarded to them'
          });
        }
      }

      // Check if already approved
      if (workflowDocument[workflowConfig.workflowStatusField] && 
          workflowDocument[workflowConfig.workflowStatusField].includes('Approved')) {
        return res.status(400).json({
          success: false,
          message: 'Document is already approved'
        });
      }

      // Store the source status for display
      const sourceStatus = workflowDocument[workflowConfig.workflowStatusField];
      
      // Update workflow status to "Approved (from {sourceStatus})"
      workflowDocument[workflowConfig.workflowStatusField] = `Approved (from ${sourceStatus})`;
      
      // Add to workflow history
      if (workflowDocument.workflowHistory && Array.isArray(workflowDocument.workflowHistory)) {
        workflowDocument.workflowHistory.push({
          fromStatus: sourceStatus,
          toStatus: `Approved (from ${sourceStatus})`,
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: approvalComments || 'Document approved',
          ...stampMeta
        });
      }

      workflowDocument.updatedBy = req.user.id;
      await workflowDocument.save();

      let financePostResult = null;
      const actorId = normalizeActorId(req.user);
      if (
        workflowConfig.submodule === 'utility_bills_management' &&
        isUtilityBillAuditFinalApproved(workflowDocument[workflowConfig.workflowStatusField])
      ) {
        const freshBill = await UtilityBill.findById(workflowDocument._id);
        financePostResult = await postUtilityBillToFinance(freshBill || workflowDocument, actorId);
        if (financePostResult?.error) {
          console.error(
            `[pre-audit] Utility bill finance post failed (${freshBill?.billId || workflowDocument._id}):`,
            financePostResult.error
          );
        }
      }
      
      await workflowDocument.populate([
        { path: 'updatedBy', select: 'firstName lastName email' },
        { path: 'createdBy', select: 'firstName lastName email' },
        { path: 'financeApBillId', select: 'billNumber totalAmount status' }
      ]);
      await notifyPreAuditStakeholders({
        actorId: req.user.id,
        title: 'Audit Director final approval completed',
        message: `${workflowConfig.label || 'Workflow document'} has been finally approved by Audit Director.`,
        entityId: workflowDocument._id,
        recipientIds: [workflowDocument.createdBy],
        metadata: { queueStage: 'final_director_approved', targetTab: 'approved' }
      });

      let approvalMessage = 'Document approved successfully';
      if (workflowConfig.submodule === 'utility_bills_management') {
        if (financePostResult?.posted) {
          approvalMessage = financePostResult.repaired
            ? 'Document approved. Finance GL was repaired for Accounts Payable.'
            : 'Document approved and posted to Finance (Accounts Payable).';
        } else if (financePostResult?.error) {
          approvalMessage = `Document approved. Finance posting failed: ${financePostResult.error}`;
        } else if (financePostResult?.reason === 'already_posted') {
          approvalMessage = 'Document approved. Already linked to Finance Accounts Payable.';
        }
      }

      return res.json({
        success: true,
        message: approvalMessage,
        data: {
          _id: workflowDocument._id,
          isWorkflowDocument: true,
          workflowSubmodule: workflowConfig.submodule,
          status: 'approved',
          workflowStatus: workflowDocument[workflowConfig.workflowStatusField],
          financePost: financePostResult || undefined
        }
      });
    }

    // Handle Vendor Bill pre-audit approval (Pending Audit -> initial approval, Forwarded to Audit Director -> final approval -> approved)
    const AccountsPayableApprove = require('../models/finance/AccountsPayable');
    const vbApprove = await AccountsPayableApprove.findById(req.params.id);
    if (vbApprove && ['Pending Audit', 'Forwarded to Audit Director'].includes(vbApprove.status)) {
      if (vbApprove.status === 'Pending Audit') {
        if (!canPerformInitialPreAuditActions(req.user)) {
          return res.status(403).json({
            success: false,
            message: 'Initial pre-audit approval must be completed by General Audit / pre-audit staff before director approval.'
          });
        }
        vbApprove.preAuditInitialApprovedBy = req.user.id;
        vbApprove.preAuditInitialApprovedAt = new Date();
        vbApprove.workflowHistory = vbApprove.workflowHistory || [];
        vbApprove.workflowHistory.push({
          fromStatus: 'Pending Audit',
          toStatus: 'Initial Pre-Audit Approved',
          changedBy: req.user.id,
          changedAt: new Date(),
          comments: approvalComments || 'Initial pre-audit approval recorded',
          module: 'Pre-Audit',
          ...stampMeta
        });
        vbApprove.updatedBy = req.user.id;
        await vbApprove.save();
        await notifyAuditDirectorQueue({
          actorId: req.user.id,
          title: 'Initial pre-audit approval recorded',
          message: `Vendor Bill ${vbApprove.billNumber || ''} has initial audit approval and is ready for director forwarding.`,
          entityId: vbApprove._id,
          entityType: 'AccountsPayable',
          metadata: { queueStage: 'initial_audit_approved', targetTab: 'under_review' }
        });
        return res.json({
          success: true,
          message: 'Initial pre-audit approval recorded. Forward to Audit Director for final approval.',
          data: {
            _id: vbApprove._id,
            isVendorBill: true,
            status: 'initial_approved',
            workflowStatus: vbApprove.status
          }
        });
      }

      if (vbApprove.status === 'Forwarded to Audit Director') {
        if (!canActAsAuditDirector(req.user)) {
          return res.status(403).json({
            success: false,
            message: 'Only Audit Director can approve documents forwarded to them'
          });
        }
      }

      vbApprove.workflowHistory = vbApprove.workflowHistory || [];
      vbApprove.workflowHistory.push({
        fromStatus: vbApprove.status,
        toStatus: 'approved',
        changedBy: req.user.id,
        changedAt: new Date(),
        comments: approvalComments || 'Vendor Bill approved by Audit Director',
        module: 'Pre-Audit',
        ...stampMeta
      });
      vbApprove.status = 'approved';
      vbApprove.updatedBy = req.user.id;
      await vbApprove.save();

      // Chart of Accounts bills defer GL until audit final approval (created with skipJournal)
      let financePost = null;
      if (vbApprove.referenceType === 'manual' || vbApprove.module === 'finance') {
        try {
          const FinanceHelper = require('../utils/financeHelper');
          financePost = await FinanceHelper.postAPBillJournalIfMissing(vbApprove, req.user.id);
          if (financePost?.posted) {
            vbApprove.workflowHistory.push({
              fromStatus: 'approved',
              toStatus: 'Posted to Finance GL',
              changedBy: req.user.id,
              changedAt: new Date(),
              comments: 'AP journal posted after Audit Director approval',
              module: 'Finance'
            });
            await vbApprove.save();
          }
        } catch (postErr) {
          console.error('Failed to post COA bill journal after audit approval:', postErr);
          financePost = { posted: false, error: postErr.message };
        }
      }

      await notifyPreAuditStakeholders({
        actorId: req.user.id,
        title: 'Audit Director final approval completed',
        message: `Vendor Bill ${vbApprove.billNumber || ''} has been finally approved by Audit Director and is active in Finance.`,
        entityId: vbApprove._id,
        recipientIds: [vbApprove.createdBy],
        metadata: { queueStage: 'final_director_approved', targetTab: 'approved' }
      });

      return res.json({
        success: true,
        message: financePost?.error && !financePost?.posted
          ? `Vendor bill approved by Audit Director, but Finance GL post failed: ${financePost.error}`
          : 'Vendor bill approved successfully by Audit Director and activated in Finance.',
        data: {
          _id: vbApprove._id,
          isVendorBill: true,
          status: 'approved',
          workflowStatus: 'approved',
          financePost: financePost || undefined
        }
      });
    }

    // Handle regular Pre Audit documents
    const document = await PreAudit.findById(req.params.id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    if (document.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Document is already approved'
      });
    }

    // Step 1: initial approval by assistant/auditor
    if (document.status === 'pending' || document.status === 'under_review') {
      if (!canPerformInitialPreAuditActions(req.user)) {
        return res.status(403).json({
          success: false,
          message: 'Initial approval must be completed by General Audit / pre-audit staff before director final approval.'
        });
      }
      document.status = 'under_review';
      document.reviewedBy = req.user.id;
      document.reviewedAt = new Date();
      document.reviewComments = approvalComments || '';
      document.updatedBy = req.user.id;
      await document.save();
      await document.populate([
        { path: 'reviewedBy', select: 'firstName lastName email' },
        { path: 'sourceDepartment', select: 'name' }
      ]);
      await notifyAuditDirectorQueue({
        actorId: req.user.id,
        title: 'Initial pre-audit approval recorded',
        message: `${document.documentNumber || document.referenceNumber || 'Pre-audit document'} has initial audit approval and is ready for director forwarding.`,
        entityId: document._id,
        entityType: 'PreAudit',
        metadata: { queueStage: 'initial_audit_approved', targetTab: 'under_review' }
      });
      return res.json({
        success: true,
        message: 'Initial pre-audit approval recorded. Forward to Audit Director for final approval.',
        data: document
      });
    }

    // If document is forwarded to director, only Audit Director can approve
    if (document.status === 'forwarded_to_director') {
      if (!canActAsAuditDirector(req.user)) {
        return res.status(403).json({
          success: false,
          message: 'Only Audit Director can approve documents forwarded to them'
        });
      }
    }

    document.status = 'approved';
    document.approvedBy = req.user.id;
    document.approvedAt = new Date();
    document.approvalComments = approvalComments;
    document.updatedBy = req.user.id;

    await document.save();
    await document.populate([
      { path: 'approvedBy', select: 'firstName lastName email' },
      { path: 'forwardedBy', select: 'firstName lastName email' },
      { path: 'sourceDepartment', select: 'name' }
    ]);
    await notifyPreAuditStakeholders({
      actorId: req.user.id,
      title: 'Audit Director final approval completed',
      message: `${document.documentNumber || document.referenceNumber || 'Pre-audit document'} has been finally approved by Audit Director.`,
      entityId: document._id,
      recipientIds: [document.submittedBy, document.createdBy],
      metadata: { queueStage: 'final_director_approved', targetTab: 'approved' }
    });

    res.json({
      success: true,
      message: 'Document approved successfully',
      data: document
    });
  })
);

// @route   PUT /api/pre-audit/:id/add-observation
// @desc    Add observation to a pre-audit document (works for both Pre Audit and workflow documents)
// @access  Private (Super Admin, Audit Manager, Auditor)
router.put('/:id/add-observation',
  authMiddleware,
  authorize('super_admin', 'audit_manager', 'auditor', 'audit_director'),
  asyncHandler(async (req, res) => {
    const { observation, severity } = req.body;

    if (!observation) {
      return res.status(400).json({
        success: false,
        message: 'Observation is required'
      });
    }

    // Check if it's a workflow document by trying to find it in workflow modules
    let isWorkflowDocument = false;
    let workflowDocument = null;
    let workflowConfig = null;
    
    const workflowModules = getWorkflowModules();
    for (const submodule of workflowModules) {
      const config = getModuleConfig(submodule);
      if (!config) continue;
      
      try {
        const Model = require(config.modelPath);
        const doc = await Model.findById(req.params.id);
        if (doc && ['Send to Audit', 'Forwarded to Audit Director'].includes(doc[config.workflowStatusField])) {
          isWorkflowDocument = true;
          workflowDocument = doc;
          workflowConfig = config;
          break;
        }
      } catch (error) {
        // Continue to next module
      }
    }

    if (isWorkflowDocument) {
      const sourceStatus = workflowDocument[workflowConfig.workflowStatusField] || 'Send to Audit';
      // For workflow documents, add observation to observations field
      workflowDocument.observations = workflowDocument.observations || [];
      workflowDocument.observations.push({
        observation: observation,
        severity: severity || 'medium',
        addedBy: req.user.id,
        addedAt: new Date(),
        resolved: false
      });
      
      // Also add observation as a comment in workflow history for tracking
      workflowDocument.workflowHistory = workflowDocument.workflowHistory || [];
      workflowDocument.workflowHistory.push({
        fromStatus: sourceStatus,
        toStatus: sourceStatus,
        changedBy: req.user.id,
        changedAt: new Date(),
        comments: `Observation (${severity || 'medium'}): ${observation}`
      });
      
      workflowDocument.updatedBy = req.user.id;
      await workflowDocument.save();
      
      await workflowDocument.populate([
        { path: 'workflowHistory.changedBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
        { path: 'createdBy', select: 'firstName lastName email' },
        { path: 'observations.addedBy', select: 'firstName lastName email' }
      ]);

      return res.json({
        success: true,
        message: 'Observation added successfully',
        data: {
          _id: workflowDocument._id,
          isWorkflowDocument: true,
          observation: {
            observation,
            severity: severity || 'medium',
            addedBy: req.user,
            addedAt: new Date()
          }
        }
      });
    }

    // Purchase Order in pre-audit queue (before or after forward to director)
    const PurchaseOrderModel = require('../models/procurement/PurchaseOrder');
    const po = await PurchaseOrderModel.findById(req.params.id);
    if (po && ['Pending Audit', 'Forwarded to Audit Director'].includes(po.status)) {
      po.auditObservations = po.auditObservations || [];
      po.auditObservations.push({
        observation,
        severity: severity || 'medium',
        addedBy: req.user.id,
        addedAt: new Date()
      });
      po.updatedBy = req.user.id;
      await po.save();
      return res.json({
        success: true,
        message: 'Observation added successfully',
        data: {
          _id: po._id,
          isPurchaseOrder: true,
          observation: { observation, severity: severity || 'medium', addedBy: req.user, addedAt: new Date() }
        }
      });
    }

    const CashApprovalObs = require('../models/procurement/CashApproval');
    const caObs = await CashApprovalObs.findById(req.params.id);
    if (caObs && ['Pending Audit', 'Forwarded to Audit Director'].includes(caObs.status)) {
      caObs.auditObservations = caObs.auditObservations || [];
      caObs.auditObservations.push({
        observation,
        severity: (severity || 'medium').toLowerCase(),
        addedBy: req.user.id,
        addedAt: new Date()
      });
      caObs.updatedBy = req.user.id;
      await caObs.save();
      return res.json({
        success: true,
        message: 'Observation added successfully',
        data: {
          _id: caObs._id,
          isCashApproval: true,
          observation: { observation, severity: severity || 'medium', addedBy: req.user, addedAt: new Date() }
        }
      });
    }

    const AccountsPayableObs = require('../models/finance/AccountsPayable');
    const vbObs = await AccountsPayableObs.findById(req.params.id);
    if (vbObs && ['Pending Audit', 'Forwarded to Audit Director'].includes(vbObs.status)) {
      vbObs.observations = vbObs.observations || [];
      vbObs.observations.push({
        observation,
        severity: (severity || 'medium').toLowerCase(),
        addedBy: req.user.id,
        addedAt: new Date()
      });
      vbObs.updatedBy = req.user.id;
      await vbObs.save();
      return res.json({
        success: true,
        message: 'Observation added successfully',
        data: {
          _id: vbObs._id,
          isVendorBill: true,
          observation: { observation, severity: severity || 'medium', addedBy: req.user, addedAt: new Date() }
        }
      });
    }

    // Handle regular Pre Audit documents
    const document = await PreAudit.findById(req.params.id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    document.observations.push({
      observation,
      severity: severity || 'medium',
      addedBy: req.user.id,
      addedAt: new Date()
    });

    // Update status if not already under review
    if (document.status === 'pending') {
      document.status = 'under_review';
      document.reviewedBy = req.user.id;
      document.reviewedAt = new Date();
    }

    document.updatedBy = req.user.id;
    await document.save();
    await document.populate([
      { path: 'observations.addedBy', select: 'firstName lastName email' },
      { path: 'sourceDepartment', select: 'name' }
    ]);

    res.json({
      success: true,
      message: 'Observation added successfully',
      data: document
    });
  })
);

// @route   PUT /api/pre-audit/:id/return
// @desc    Return document to department with observations (works for both Pre Audit and workflow documents)
// @access  Private (Super Admin, Audit Manager, Auditor)
router.put('/:id/return',
  authMiddleware,
  authorize('super_admin', 'audit_manager', 'auditor', 'audit_director'),
  asyncHandler(async (req, res) => {
    const { returnComments, observations } = req.body;

    // Check if it's a workflow document
    let isWorkflowDocument = false;
    let workflowDocument = null;
    let workflowConfig = null;
    
    const workflowModules = getWorkflowModules();
    for (const submodule of workflowModules) {
      const config = getModuleConfig(submodule);
      if (!config) continue;
      
      try {
        const Model = require(config.modelPath);
        const doc = await Model.findById(req.params.id);
        if (doc && ['Send to Audit', 'Forwarded to Audit Director'].includes(doc[config.workflowStatusField])) {
          isWorkflowDocument = true;
          workflowDocument = doc;
          workflowConfig = config;
          break;
        }
      } catch (error) {
        // Continue to next module
      }
    }

    if (isWorkflowDocument) {
      const sourceStatus = workflowDocument[workflowConfig.workflowStatusField] || 'Send to Audit';
      // For workflow documents, set status to "Returned from Audit" so initiator can see it in Admin Dashboard
      workflowDocument[workflowConfig.workflowStatusField] = 'Returned from Audit';
      workflowDocument.workflowHistory = workflowDocument.workflowHistory || [];
      
      // Store observations if provided
      if (observations && Array.isArray(observations) && observations.length > 0) {
        workflowDocument.observations = workflowDocument.observations || [];
        observations.forEach(obs => {
          workflowDocument.observations.push({
            observation: obs.observation || obs.text || obs,
            severity: obs.severity || 'medium',
            addedBy: req.user.id,
            addedAt: new Date(),
            resolved: false
          });
        });
      }
      
      workflowDocument.workflowHistory.push({
        fromStatus: sourceStatus,
        toStatus: 'Returned from Audit',
        changedBy: req.user.id,
        changedAt: new Date(),
        comments: `Returned from Pre Audit with observations: ${returnComments || 'Please review and correct'}`
      });
      
      workflowDocument.updatedBy = req.user.id;
      await workflowDocument.save();
      
      await workflowDocument.populate([
        { path: 'workflowHistory.changedBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
        { path: 'createdBy', select: 'firstName lastName email' }
      ]);

      return res.json({
        success: true,
        message: 'Document returned to initiator successfully. They can correct and resend to Pre Audit.',
        data: {
          _id: workflowDocument._id,
          isWorkflowDocument: true,
          workflowStatus: workflowDocument[workflowConfig.workflowStatusField]
        }
      });
    }

    const PurchaseOrderForReturn = require('../models/procurement/PurchaseOrder');
    const poForReturn = await PurchaseOrderForReturn.findById(req.params.id);
    if (poForReturn && ['Pending Audit', 'Forwarded to Audit Director'].includes(poForReturn.status)) {
      const fromPoStatus = poForReturn.status;
      // Workflow history for display in Pre-Audit
      poForReturn.workflowHistory = poForReturn.workflowHistory || [];
      poForReturn.workflowHistory.push({
        fromStatus: fromPoStatus,
        toStatus: 'Returned from Audit',
        changedBy: req.user.id,
        changedAt: new Date(),
        comments: returnComments || 'Returned from Pre-Audit with observations',
        module: 'Pre-Audit'
      });
      poForReturn.status = 'Returned from Audit';
      poForReturn.auditReturnedBy = req.user.id;
      poForReturn.auditReturnedAt = new Date();
      poForReturn.auditReturnComments = returnComments || '';
      // Snapshot items and totals so we can compute change summary when procurement resubmits
      poForReturn.auditSnapshotAtReturn = {
        items: JSON.parse(JSON.stringify(poForReturn.items || [])),
        totalAmount: poForReturn.totalAmount,
        subtotal: poForReturn.subtotal
      };
      // Store observations on the PO so procurement can see and answer them when resubmitting
      if (observations && Array.isArray(observations) && observations.length > 0) {
        poForReturn.auditObservations = poForReturn.auditObservations || [];
        observations.forEach(obs => {
          poForReturn.auditObservations.push({
            observation: obs.observation || obs.text || obs,
            severity: (obs.severity || 'medium').toLowerCase(),
            addedBy: req.user.id,
            addedAt: new Date(),
            resolved: false
          });
        });
      }
      poForReturn.updatedBy = req.user.id;
      await poForReturn.save();
      return res.json({
        success: true,
        message: 'Purchase order returned to procurement successfully. They can correct and resend to Pre Audit.',
        data: { _id: poForReturn._id, isPurchaseOrder: true, status: 'Returned from Audit' }
      });
    }

    const CashApprovalReturn = require('../models/procurement/CashApproval');
    const caForReturn = await CashApprovalReturn.findById(req.params.id);
    if (caForReturn && ['Pending Audit', 'Forwarded to Audit Director'].includes(caForReturn.status)) {
      const fromCaStatus = caForReturn.status;
      caForReturn.workflowHistory = caForReturn.workflowHistory || [];
      caForReturn.workflowHistory.push({
        fromStatus: fromCaStatus,
        toStatus: 'Returned from Audit',
        changedBy: req.user.id,
        changedAt: new Date(),
        comments: returnComments || 'Returned from Pre-Audit with observations',
        module: 'Pre-Audit'
      });
      caForReturn.status = 'Returned from Audit';
      caForReturn.auditReturnedBy = req.user.id;
      caForReturn.auditReturnedAt = new Date();
      caForReturn.auditReturnComments = returnComments || '';
      caForReturn.auditSnapshotAtReturn = {
        items: JSON.parse(JSON.stringify(caForReturn.items || [])),
        totalAmount: caForReturn.totalAmount,
        subtotal: caForReturn.subtotal
      };
      if (observations && Array.isArray(observations) && observations.length > 0) {
        caForReturn.auditObservations = caForReturn.auditObservations || [];
        observations.forEach((obs) => {
          caForReturn.auditObservations.push({
            observation: obs.observation || obs.text || obs,
            severity: (obs.severity || 'medium').toLowerCase(),
            addedBy: req.user.id,
            addedAt: new Date(),
            resolved: false
          });
        });
      }
      caForReturn.updatedBy = req.user.id;
      await caForReturn.save();
      return res.json({
        success: true,
        message: 'Cash approval returned to procurement successfully. They can correct and resend to Pre Audit.',
        data: { _id: caForReturn._id, isCashApproval: true, status: 'Returned from Audit' }
      });
    }

    const AccountsPayableReturn = require('../models/finance/AccountsPayable');
    const vbForReturn = await AccountsPayableReturn.findById(req.params.id);
    if (vbForReturn && ['Pending Audit', 'Forwarded to Audit Director'].includes(vbForReturn.status)) {
      const fromVbStatus = vbForReturn.status;
      vbForReturn.workflowHistory = vbForReturn.workflowHistory || [];
      vbForReturn.workflowHistory.push({
        fromStatus: fromVbStatus,
        toStatus: 'Returned from Audit',
        changedBy: req.user.id,
        changedAt: new Date(),
        comments: returnComments || 'Returned from Pre-Audit with observations',
        module: 'Pre-Audit'
      });
      vbForReturn.status = 'Returned from Audit';
      vbForReturn.auditReturnedBy = req.user.id;
      vbForReturn.auditReturnedAt = new Date();
      vbForReturn.auditReturnComments = returnComments || '';
      if (observations && Array.isArray(observations) && observations.length > 0) {
        vbForReturn.observations = vbForReturn.observations || [];
        observations.forEach((obs) => {
          vbForReturn.observations.push({
            observation: obs.observation || obs.text || obs,
            severity: (obs.severity || 'medium').toLowerCase(),
            addedBy: req.user.id,
            addedAt: new Date(),
            resolved: false
          });
        });
      }
      vbForReturn.updatedBy = req.user.id;
      await vbForReturn.save();
      return res.json({
        success: true,
        message: 'Vendor bill returned to procurement successfully.',
        data: { _id: vbForReturn._id, isVendorBill: true, status: 'Returned from Audit' }
      });
    }

    // Handle regular Pre Audit documents
    const document = await PreAudit.findById(req.params.id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    if (document.observations.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot return document without observations'
      });
    }

    document.status = 'returned_with_observations';
    document.returnedToDepartment = true;
    document.returnedAt = new Date();
    document.returnComments = returnComments;
    document.returnedBy = req.user.id;
    document.updatedBy = req.user.id;

    await document.save();
    await document.populate([
      { path: 'returnedBy', select: 'firstName lastName email' },
      { path: 'sourceDepartment', select: 'name' }
    ]);

    res.json({
      success: true,
      message: 'Document returned to department successfully',
      data: document
    });
  })
);

// @route   PUT /api/pre-audit/:id/reject
// @desc    Reject document with observations (works for both Pre Audit and workflow documents)
// @access  Private (Super Admin, Audit Manager, Auditor)
router.put('/:id/reject',
  authMiddleware,
  authorize('super_admin', 'audit_manager', 'auditor', 'audit_director'),
  asyncHandler(async (req, res) => {
    const { rejectionComments, observations } = req.body;
    const stampMeta = (req.user?.approvalStamp)
      ? { stampUsed: true, stampImage: req.user.approvalStamp }
      : { stampUsed: false };

    if (!rejectionComments) {
      return res.status(400).json({
        success: false,
        message: 'Rejection comments are required'
      });
    }

    // Check if it's a workflow document
    let isWorkflowDocument = false;
    let workflowDocument = null;
    let workflowConfig = null;
    
    const workflowModules = getWorkflowModules();
    for (const submodule of workflowModules) {
      const config = getModuleConfig(submodule);
      if (!config) continue;
      
      try {
        const Model = require(config.modelPath);
        const doc = await Model.findById(req.params.id);
        if (doc && ['Send to Audit', 'Forwarded to Audit Director'].includes(doc[config.workflowStatusField])) {
          isWorkflowDocument = true;
          workflowDocument = doc;
          workflowConfig = config;
          break;
        }
      } catch (error) {
        // Continue to next module
      }
    }

    if (isWorkflowDocument) {
      const sourceStatus = workflowDocument[workflowConfig.workflowStatusField] || 'Send to Audit';
      // For workflow documents, reject and return to Draft
      workflowDocument[workflowConfig.workflowStatusField] = `Rejected (from ${sourceStatus})`;
      workflowDocument.workflowHistory = workflowDocument.workflowHistory || [];
      
      // Persist structured observations on the document (same as return flow)
      if (observations && Array.isArray(observations) && observations.length > 0) {
        workflowDocument.observations = workflowDocument.observations || [];
        observations.forEach((obs) => {
          const text = obs.observation || obs.text || obs;
          if (!text) return;
          workflowDocument.observations.push({
            observation: text,
            severity: obs.severity || 'medium',
            addedBy: req.user.id,
            addedAt: new Date(),
            resolved: false
          });
          workflowDocument.workflowHistory.push({
            fromStatus: sourceStatus,
            toStatus: `Rejected (from ${sourceStatus})`,
            changedBy: req.user.id,
            changedAt: new Date(),
            comments: `Observation (${obs.severity || 'medium'}): ${text}`,
            ...stampMeta
          });
        });
      }
      
      // Add rejection comment
      workflowDocument.workflowHistory.push({
        fromStatus: `Rejected (from ${sourceStatus})`,
        toStatus: 'Returned from Audit',
        changedBy: req.user.id,
        changedAt: new Date(),
        comments: `Rejected with observations: ${rejectionComments}`,
        ...stampMeta
      });
      
      // Set status to "Returned from Audit" so initiator can see it in Admin Dashboard
      workflowDocument[workflowConfig.workflowStatusField] = 'Returned from Audit';
      
      workflowDocument.updatedBy = req.user.id;
      await workflowDocument.save();
      
      await workflowDocument.populate([
        { path: 'workflowHistory.changedBy', select: 'firstName lastName email employeeId digitalSignature approvalStamp' },
        { path: 'observations.addedBy', select: 'firstName lastName email' },
        { path: 'createdBy', select: 'firstName lastName email' }
      ]);

      return res.json({
        success: true,
        message: 'Document rejected and returned to initiator. They can correct and resend to Pre Audit.',
        data: {
          _id: workflowDocument._id,
          isWorkflowDocument: true,
          workflowStatus: workflowDocument[workflowConfig.workflowStatusField]
        }
      });
    }

    // Vendor bills (Finance AP) — reject with observations returns to finance for correction
    const AccountsPayableReject = require('../models/finance/AccountsPayable');
    const vbReject = await AccountsPayableReject.findById(req.params.id);
    if (vbReject && ['Pending Audit', 'Forwarded to Audit Director'].includes(vbReject.status)) {
      const fromVbStatus = vbReject.status;
      vbReject.workflowHistory = vbReject.workflowHistory || [];
      vbReject.observations = vbReject.observations || [];

      if (observations && Array.isArray(observations) && observations.length > 0) {
        observations.forEach((obs) => {
          const text = obs.observation || obs.text || obs;
          if (!text) return;
          vbReject.observations.push({
            observation: text,
            severity: (obs.severity || 'medium').toLowerCase(),
            addedBy: req.user.id,
            addedAt: new Date(),
            resolved: false
          });
          vbReject.workflowHistory.push({
            fromStatus: fromVbStatus,
            toStatus: 'Returned from Audit',
            changedBy: req.user.id,
            changedAt: new Date(),
            comments: `Observation (${obs.severity || 'medium'}): ${text}`,
            module: 'Pre-Audit',
            ...stampMeta
          });
        });
      }

      vbReject.workflowHistory.push({
        fromStatus: fromVbStatus,
        toStatus: 'Returned from Audit',
        changedBy: req.user.id,
        changedAt: new Date(),
        comments: `Rejected with observations: ${rejectionComments}`,
        module: 'Pre-Audit',
        ...stampMeta
      });
      vbReject.status = 'Returned from Audit';
      vbReject.preAuditInitialApprovedAt = undefined;
      vbReject.preAuditInitialApprovedBy = undefined;
      vbReject.lastModifiedBy = req.user.id;
      await vbReject.save();

      await createAndEmitNotification({
        recipientIds: [vbReject.createdBy].filter(Boolean).map((id) => String(id._id || id)),
        title: 'Vendor Bill rejected by Audit',
        message: `Vendor Bill ${vbReject.billNumber || ''} was rejected by Audit and returned for correction.`,
        type: 'warning',
        category: 'approval',
        priority: 'high',
        actionUrl: '/finance/accounts-payable',
        createdBy: req.user.id,
        excludeUserId: req.user.id,
        metadata: {
          module: 'finance',
          entityId: vbReject._id,
          entityType: 'AccountsPayable',
          targetTab: 'returned',
          isVendorBill: true
        }
      });

      return res.json({
        success: true,
        message: 'Vendor bill rejected and returned to finance. They can correct and resend to Pre-Audit.',
        data: {
          _id: vbReject._id,
          isVendorBill: true,
          status: 'Returned from Audit'
        }
      });
    }

    // Handle regular Pre Audit documents
    const document = await PreAudit.findById(req.params.id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    // Add observations if provided
    if (observations && Array.isArray(observations)) {
      observations.forEach(obs => {
        document.observations.push({
          observation: obs.observation || obs,
          severity: obs.severity || 'medium',
          addedBy: req.user.id,
          addedAt: new Date()
        });
      });
    }

    document.status = 'rejected';
    document.rejectedBy = req.user.id;
    document.rejectedAt = new Date();
    document.rejectionComments = rejectionComments;
    document.returnedToDepartment = true;
    document.updatedBy = req.user.id;

    await document.save();
    await document.populate([
      { path: 'rejectedBy', select: 'firstName lastName email' },
      { path: 'sourceDepartment', select: 'name' }
    ]);

    res.json({
      success: true,
      message: 'Document rejected successfully',
      data: document
    });
  })
);

// @route   PUT /api/pre-audit/:id/respond
// @desc    Department response to returned document
// @access  Private (Department users)
router.put('/:id/respond',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { response } = req.body;
    const files = req.files || [];

    if (!response) {
      return res.status(400).json({
        success: false,
        message: 'Response is required'
      });
    }

    const document = await PreAudit.findById(req.params.id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    // Check if user belongs to the source department
    if (String(document.sourceDepartment) !== String(req.user.department)) {
      return res.status(403).json({
        success: false,
        message: 'You can only respond to documents from your department'
      });
    }

    if (document.status !== 'returned_with_observations') {
      return res.status(400).json({
        success: false,
        message: 'Document is not in returned status'
      });
    }

    // Handle response attachments
    const responseAttachments = [];
    if (files.length > 0) {
      files.forEach(file => {
        responseAttachments.push({
          filename: file.filename,
          originalName: file.originalname,
          path: file.path,
          uploadedAt: new Date()
        });
      });
    }

    document.departmentResponse = {
      response,
      respondedBy: req.user.id,
      respondedAt: new Date(),
      attachments: responseAttachments
    };

    // Mark observations as resolved if all are addressed
    document.observations.forEach(obs => {
      if (!obs.resolved) {
        obs.resolved = true;
        obs.resolvedAt = new Date();
        obs.resolvedBy = req.user.id;
      }
    });

    document.status = 'under_review';
    document.updatedBy = req.user.id;

    await document.save();
    await document.populate([
      { path: 'departmentResponse.respondedBy', select: 'firstName lastName email' },
      { path: 'sourceDepartment', select: 'name' }
    ]);

    res.json({
      success: true,
      message: 'Response submitted successfully',
      data: document
    });
  })
);

// @route   PUT /api/pre-audit/:id
// @desc    Update a pre-audit document
// @access  Private (Super Admin, Audit Manager, Auditor)
router.put('/:id',
  authMiddleware,
  authorize('super_admin', 'audit_manager', 'auditor', 'audit_director'),
  asyncHandler(async (req, res) => {
    const document = await PreAudit.findById(req.params.id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    const allowedUpdates = ['title', 'description', 'priority', 'reviewDueDate', 'tags'];
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        document[field] = req.body[field];
      }
    });

    document.updatedBy = req.user.id;
    await document.save();
    await document.populate([
      { path: 'sourceDepartment', select: 'name' },
      { path: 'updatedBy', select: 'firstName lastName email' }
    ]);

    res.json({
      success: true,
      message: 'Document updated successfully',
      data: document
    });
  })
);

// @route   DELETE /api/pre-audit/:id
// @desc    Soft delete a pre-audit document
// @access  Private (Super Admin, Audit Manager)
router.delete('/:id',
  authMiddleware,
  authorize('super_admin', 'audit_manager', 'audit_director'),
  asyncHandler(async (req, res) => {
    const document = await PreAudit.findById(req.params.id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Pre-audit document not found'
      });
    }

    document.isActive = false;
    document.updatedBy = req.user.id;
    await document.save();

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  })
);

module.exports = router;

