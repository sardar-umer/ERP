const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/errorHandler');

const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const ProjectBOQ = require('../models/projectManagement/ProjectBOQ');
const BOQItem = require('../models/projectManagement/BOQItem');
const ProjectTask = require('../models/projectManagement/ProjectTask');
const ProjectExpense = require('../models/projectManagement/ProjectExpense');
const DailyProgressReport = require('../models/projectManagement/DailyProgressReport');
const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
const CheckRequest = require('../models/projectManagement/CheckRequest');
const SubletContract = require('../models/projectManagement/SubletContract');
const InspectionReport = require('../models/projectManagement/InspectionReport');
const TajProperty = require('../models/tajResidencia/TajProperty');
const User = require('../models/User');
const NotificationService = require('../services/notificationService');
const WbsActivity = require('../models/projectManagement/WbsActivity');
const { WBS_PROJECT_TYPES, normalizeProjectType } = require('../models/projectManagement/WbsActivity');
const SlabSchedule = require('../models/projectManagement/SlabSchedule');
const ProjectSector = require('../models/projectManagement/ProjectSector');
const Employee = require('../models/hr/Employee');
require('../models/hr/Designation');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const Supplier = require('../models/hr/Supplier');
const { syncProjectMetrics } = require('../services/projectMetricsService');
const { getProjectProcurementSummary } = require('../services/projectProcurementService');
const { postIpcToFinance, postBarterHandover, resolveProjectCompanyId, findMainProject } = require('../utils/projectIpcFinance');
const { postClientInvoiceToFinance, reverseClientInvoiceInFinance } = require('../utils/projectClientInvoiceFinance');
const { hasAuditAccess, canPerformInitialPreAuditActions } = require('../utils/auditAccess');
const { canActAsAuditDirector } = require('../utils/auditDirectorRole');
const {
  isDesignatedCeoApprover,
  hasCeoSecretariatAccess,
  hasCeoSecretariatCoordinatorAccess
} = require('../utils/executiveAccess');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');

const router = express.Router();

// ─── File upload setup ────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../uploads/project-management');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });


// Inspection evidence: photos + site videos, kept apart from other PM uploads
const INSPECTION_MIN_IMAGES = 3;
const INSPECTION_MIN_VIDEOS = 1;
const INSPECTION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const inspectionDir = path.join(uploadDir, 'inspections');
if (!fs.existsSync(inspectionDir)) fs.mkdirSync(inspectionDir, { recursive: true });
const inspectionUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, inspectionDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 16 },
  // Skip (don't abort on) wrong file types so parsing finishes cleanly; the handler rejects and cleans up
  fileFilter: (req, file, cb) => {
    const ok = (file.fieldname === 'images' && file.mimetype.startsWith('image/'))
      || (file.fieldname === 'videos' && file.mimetype.startsWith('video/'));
    if (!ok) (req.rejectedEvidence = req.rejectedEvidence || []).push(file.originalname);
    cb(null, ok);
  }
}).fields([{ name: 'images', maxCount: 12 }, { name: 'videos', maxCount: 3 }]);

/** Run the inspection upload, turning multer errors into 400s and removing files on any failure */
const removeUploaded = (req) => Object.values(req.files || {}).flat().forEach((f) => fs.unlink(f.path, () => {}));
const withInspectionUpload = (req, res, next) => inspectionUpload(req, res, (err) => {
  if (!err) return next();
  removeUploaded(req);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each video must be under 200 MB' : err.message;
  return res.status(400).json({ success: false, message });
});

// Check request supporting documents: photos, PDFs and office files
const CR_ATTACHMENT_PREFIX = '/uploads/project-management/check-requests/';
const crAttachmentDir = path.join(uploadDir, 'check-requests');
if (!fs.existsSync(crAttachmentDir)) fs.mkdirSync(crAttachmentDir, { recursive: true });
const CR_ATTACHMENT_TYPES = /^(image\/|application\/pdf$|application\/msword$|application\/vnd\.openxmlformats-officedocument\.|application\/vnd\.ms-excel$|text\/csv$)/;
const crAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, crAttachmentDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ok = CR_ATTACHMENT_TYPES.test(file.mimetype);
    if (!ok) (req.rejectedFiles = req.rejectedFiles || []).push(file.originalname);
    cb(null, ok);
  }
}).array('files', 10);

/** Attachments sent with a check request: only files uploaded through the check request upload */
const cleanCrAttachments = (list) => (Array.isArray(list) ? list : [])
  .filter((a) => a && typeof a.url === 'string' && a.url.startsWith(CR_ATTACHMENT_PREFIX) && !a.url.includes('..'))
  .slice(0, 20)
  .map((a) => ({ url: a.url, originalName: String(a.originalName || '').slice(0, 200), mimeType: String(a.mimeType || ''), size: Number(a.size) || 0, uploadedAt: a.uploadedAt || new Date() }));
const CR_ATTACHMENT_REQUIRED = 'Attach at least one supporting document (measurement sheet, photos or the contractor’s bill)';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const notFound = (res, entity = 'Record') =>
  res.status(404).json({ success: false, message: `${entity} not found` });

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

// Recalculate parent project's progress based on its child projects
const syncParentProjectProgress = async (parentProjectId) => {
  if (!parentProjectId) return;
  const children = await ConstructionProject.find({ parentProject: parentProjectId, status: { $ne: 'Cancelled' } }).select('overallProgress');
  if (!children.length) {
    await ConstructionProject.findByIdAndUpdate(parentProjectId, { overallProgress: 0 });
    return;
  }
  const avg = Math.round(children.reduce((s, c) => s + (c.overallProgress || 0), 0) / children.length);
  await ConstructionProject.findByIdAndUpdate(parentProjectId, { overallProgress: avg });

  // Recursively update if the parent itself has a parent
  const parent = await ConstructionProject.findById(parentProjectId).select('parentProject');
  if (parent && parent.parentProject) {
    await syncParentProjectProgress(parent.parentProject);
  }
};

// Recalculate project budget from BOQ items total
const syncProjectBOQBudget = async (projectId) => {
  if (!projectId) return;
  const boqAgg = await BOQItem.aggregate([
    { $match: { project: new mongoose.Types.ObjectId(projectId) } },
    {
      $group: {
        _id: null,
        totalEstimated: { $sum: { $ifNull: ['$netEstimatedCost', { $ifNull: ['$estimatedTotalCost', 0] }] } }
      }
    }
  ]);

  const totalEstimated = boqAgg[0]?.totalEstimated || 0;
  const project = await ConstructionProject.findById(projectId);
  if (!project) return;

  // Main lump-sum envelope must not be overwritten by BOQ totals
  if (!project.parentProject) return;

  const update = { totalEstimatedCost: totalEstimated };
  if (project.budgetStatus === 'Approved') {
    update.totalApprovedBudget = totalEstimated;
  } else {
    update.totalApprovedBudget = 0;
  }

  // Use findByIdAndUpdate to trigger parent rollup hooks automatically
  await ConstructionProject.findByIdAndUpdate(projectId, { $set: update }, { new: true });
};

/** Amount of the Main Project budget currently in force (the last fully approved version) */
const approvedBudgetAmount = (main) => {
  if (main?.approvedBudget?.amount > 0) return Number(main.approvedBudget.amount);
  return main?.budgetStatus === 'Approved' ? Number(main.lumpSumBudget) || 0 : 0;
};

/**
 * Sum of sublet contract values per Sub Project (Draft, Active and Completed all hold budget).
 * A cancelled contract keeps holding the value of the work done on it before it was cancelled.
 */
const committedBySub = async (subIds, excludeContractId = null) => {
  const match = {
    project: { $in: subIds },
    $or: [{ status: { $ne: 'Cancelled' } }, { 'cancellation.workDone.amount': { $gt: 0 } }]
  };
  if (excludeContractId) match._id = { $ne: new mongoose.Types.ObjectId(String(excludeContractId)) };
  const isCancelled = { $eq: ['$status', 'Cancelled'] };
  const rows = await SubletContract.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$project',
        amount: { $sum: { $cond: [isCancelled, { $ifNull: ['$cancellation.workDone.amount', 0] }, { $ifNull: ['$totalAmount', 0] }] } },
        contracts: { $sum: { $cond: [isCancelled, 0, 1] } }
      }
    }
  ]);
  return new Map(rows.map((r) => [String(r._id), { amount: Math.round(r.amount * 100) / 100, contracts: r.contracts }]));
};

/**
 * Main ↔ Sub budget: the Main Project's CEO-approved budget, what has been distributed to each Sub Project,
 * and how much of each Sub's share is already committed to sublet contracts.
 */
const buildBudgetAllocationSummary = async (mainProject) => {
  const lumpSumBudget = Number(mainProject.lumpSumBudget) || 0;
  const subs = await ConstructionProject.find({
    parentProject: mainProject._id,
    status: { $ne: 'Cancelled' }
  })
    .select('name projectNumber sector projectType allocatedBudget utilizedBudget totalEstimatedCost totalApprovedBudget budgetStatus status')
    .sort({ name: 1 })
    .lean();
  const committed = await committedBySub(subs.map((s) => s._id));

  const totalAllocated = subs.reduce((s, c) => s + (Number(c.allocatedBudget) || 0), 0);
  const remaining = Math.max(0, lumpSumBudget - totalAllocated);
  const approver = mainProject.budgetApprovedBy && isValidId(mainProject.budgetApprovedBy._id || mainProject.budgetApprovedBy)
    ? await User.findById(mainProject.budgetApprovedBy._id || mainProject.budgetApprovedBy).select('firstName lastName').lean()
    : null;

  return {
    lumpSumBudget,
    totalAllocated,
    remaining,
    totalCommitted: Math.round([...committed.values()].reduce((t, c) => t + c.amount, 0) * 100) / 100,
    budgetStatus: mainProject.budgetStatus,
    // A revision can be in approval while the last approved budget stays in force
    inForce: approvedBudgetAmount(mainProject) > 0,
    approvedAmount: approvedBudgetAmount(mainProject),
    // Ongoing projects: already utilized before the ERP (total budget = approvedAmount + approvedUtilized)
    approvedUtilized: Number(mainProject.approvedBudget?.utilized) || 0,
    budgetSubmittedAt: mainProject.budgetSubmittedAt || null,
    budgetApprovedAt: mainProject.budgetApprovedAt || null,
    budgetApprovedBy: approver ? `${approver.firstName || ''} ${approver.lastName || ''}`.trim() : null,
    budgetNotes: mainProject.budgetNotes || '',
    subProjects: subs.map((s) => {
      const c = committed.get(String(s._id)) || { amount: 0, contracts: 0 };
      const allocated = Number(s.allocatedBudget) || 0;
      return {
        _id: s._id,
        name: s.name,
        projectNumber: s.projectNumber,
        sector: s.sector,
        projectType: s.projectType,
        allocatedBudget: allocated,
        utilizedBudget: Number(s.utilizedBudget) || 0,
        totalBudget: Math.round((allocated + (Number(s.utilizedBudget) || 0)) * 100) / 100,
        committed: c.amount,
        contracts: c.contracts,
        available: Math.round((allocated - c.amount) * 100) / 100,
        totalEstimatedCost: Number(s.totalEstimatedCost) || 0,
        totalApprovedBudget: Number(s.totalApprovedBudget) || 0,
        budgetStatus: s.budgetStatus,
        status: s.status
      };
    })
  };
};

const fmtPkr = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;

/**
 * Budget gate for sublet contracts: the Main Project's budget must be fully approved (COO → AVP → CEO), the Sub Project must have
 * budget distributed to it, and all its contracts together must fit inside that budget. Returns an error message or null.
 */
const checkContractBudget = async (subProjectId, amount, excludeContractId = null) => {
  const sub = await ConstructionProject.findById(subProjectId).select('name parentProject allocatedBudget').lean();
  if (!sub?.parentProject) return null;
  const main = await ConstructionProject.findById(sub.parentProject).select('name lumpSumBudget budgetStatus approvedBudget.amount').lean();
  if (!main) return null;
  if (approvedBudgetAmount(main) <= 0) {
    return `${main.name}'s budget is ${main.budgetStatus === 'Submitted' ? 'still in approval' : 'not approved yet'} — contracts can be made once it is approved`;
  }
  const allocated = Number(sub.allocatedBudget) || 0;
  if (allocated <= 0) return `${sub.name} is not in ${main.name}'s approved budget yet — add it to the budget (revise it) and get the revision approved`;
  const used = (await committedBySub([sub._id], excludeContractId)).get(String(sub._id))?.amount || 0;
  const value = Number(amount) || 0;
  if (used + value > allocated + 0.5) {
    return `${sub.name} has ${fmtPkr(Math.max(0, allocated - used))} of its ${fmtPkr(allocated)} budget left — this contract is ${fmtPkr(value)}. Ask for more budget to be distributed to it`;
  }
  return null;
};

// ─── PROJECTS ────────────────────────────────────────────────────────────────

/** Name new Sub Projects are given as Project Manager unless someone else is picked */
const DEFAULT_PROJECT_MANAGER = process.env.PM_DEFAULT_PROJECT_MANAGER || 'Zia Ullah Khan';
const employeeOption = (e) => ({
  _id: e._id,
  name: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
  employeeId: e.employeeId || '',
  designation: e.placementDesignation?.title || ''
});
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/project-management/employee-options?q= — active employees to pick as Project Manager (+ the default one)
router.get('/employee-options', asyncHandler(async (req, res) => {
  const active = { isActive: { $ne: false }, employmentStatus: { $in: ['Active', 'Reinstated'] } };
  const q = String(req.query.q || '').trim();
  const filter = { ...active };
  if (q) {
    const parts = q.split(/\s+/).map((p) => new RegExp(escapeRegex(p), 'i'));
    filter.$and = parts.map((re) => ({ $or: [{ firstName: re }, { lastName: re }, { employeeId: re }] }));
  }
  const [options, defaults] = await Promise.all([
    Employee.find(filter).select('firstName lastName employeeId placementDesignation').populate('placementDesignation', 'title')
      .sort({ firstName: 1, lastName: 1 }).limit(25).lean(),
    q ? [] : Employee.find(active).select('firstName lastName employeeId placementDesignation').populate('placementDesignation', 'title').lean()
      .then((list) => list.filter((e) => `${e.firstName || ''} ${e.lastName || ''}`.trim().toLowerCase() === DEFAULT_PROJECT_MANAGER.toLowerCase()))
  ]);
  res.json({ success: true, data: { options: options.map(employeeOption), defaultManager: defaults[0] ? employeeOption(defaults[0]) : null } });
}));

// GET /api/project-management/sectors — Sector / Block names added from the project form
router.get('/sectors', asyncHandler(async (req, res) => {
  const list = await ProjectSector.find().select('name').sort({ name: 1 }).lean();
  res.json({ success: true, data: list.map((s) => s.name) });
}));

// POST /api/project-management/sectors { name } — add a new Sector / Block (returns the existing one if already there)
router.post('/sectors', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  if (!name) return res.status(400).json({ success: false, message: 'Sector name is required' });
  if (name.length > 100) return res.status(400).json({ success: false, message: 'Sector name is too long' });
  const nameKey = name.toLowerCase();
  const sector = await ProjectSector.findOneAndUpdate(
    { nameKey },
    { $setOnInsert: { name, nameKey, createdBy: req.user?._id } },
    { upsert: true, new: true }
  ).lean();
  res.json({ success: true, data: sector.name });
}));

// GET /api/project-management/projects — list with filters + pagination
router.get('/projects', asyncHandler(async (req, res) => {
  const { search, status, projectType, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (projectType) filter.projectType = projectType;
  if (search) {
    const re = { $regex: search, $options: 'i' };
    filter.$or = [{ name: re }, { projectNumber: re }, { clientName: re }, { society: re }, { sector: re }];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [projects, total] = await Promise.all([
    ConstructionProject.find(filter)
      .populate('projectManager', 'firstName lastName email')
      .populate('projectManagerEmployee', 'firstName lastName employeeId')
      .populate('budgetApprovedBy', 'firstName lastName')
      .populate('parentProject', 'name projectNumber isMasterProject projectType status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    ConstructionProject.countDocuments(filter)
  ]);

  res.json({
    success: true,
    data: { projects, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } }
  });
}));

// GET /api/project-management/projects/statistics — dashboard stats
router.get('/projects/statistics', asyncHandler(async (req, res) => {
  const [statusCounts, financials, totalCount] = await Promise.all([
    ConstructionProject.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ConstructionProject.aggregate([
      { $match: { isMasterProject: { $ne: true }, status: { $ne: 'Cancelled' } } },
      {
        $group: {
          _id: null,
          totalBudget: {
            $sum: {
              $cond: [
                { $gt: ['$totalApprovedBudget', 0] },
                '$totalApprovedBudget',
                { $ifNull: ['$totalEstimatedCost', 0] }
              ]
            }
          },
          totalSpent: {
            $sum: { $cond: [{ $ifNull: ['$parentProject', false] }, { $ifNull: ['$totalActualSpent', 0] }, 0] }
          }
        }
      }
    ]),
    ConstructionProject.countDocuments()
  ]);

  const byStatus = statusCounts.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {});
  const fin = financials[0] || { totalBudget: 0, totalSpent: 0 };

  res.json({
    success: true,
    data: {
      totalProjects: totalCount,
      active: byStatus['Active'] || 0,
      onHold: byStatus['On Hold'] || 0,
      completed: byStatus['Completed'] || 0,
      draft: byStatus['Draft'] || 0,
      planning: byStatus['Planning'] || 0,
      cancelled: byStatus['Cancelled'] || 0,
      totalBudget: fin.totalBudget,
      totalSpent: fin.totalSpent,
      variance: fin.totalSpent - fin.totalBudget
    }
  });
}));

/** Project types a Main Project can be created with (legacy values stay valid on old records) */
const MAIN_PROJECT_TYPES = ['INFRASTRUCTURE DEVELOPMENT', 'COMMERCIAL', 'VILLAS'];
const CONTRACT_BASES = ['BOQ', 'Slab'];
const PAYMENT_MODES = ['Cash', 'Barter', 'Mixed'];
const SUB_CONTRACT_TYPES = ['Barter', 'Labor Rate', 'Finishing'];

/**
 * Property (barter) share of a contract from its project's payment mode: Cash 0%, Barter 100%,
 * Mixed the share entered (1–99). Returns { propertyPercent } or { error }.
 */
const resolvePropertyPercent = (project, raw, fallback = 0) => {
  const mode = project?.paymentMode || 'Cash';
  if (mode === 'Cash') return { propertyPercent: 0 };
  if (mode === 'Barter') return { propertyPercent: 100 };
  const pct = Number(raw ?? fallback);
  if (!(pct > 0 && pct < 100)) {
    return { error: `${project.name || 'This project'} is paid part money (cash / bank), part property — enter the property share (1–99%)` };
  }
  return { propertyPercent: Math.round(pct * 100) / 100 };
};
const contractBasisLabel = (b) => (b === 'Slab' ? 'Slab-wise' : 'BOQ-wise');

/** IPC approval stages still waiting on someone */
const PENDING_IPC_STAGES = ['Pending Audit', 'Forwarded to Audit Director', 'Send to CEO Office', 'Forwarded to CEO'];

// Dates on the portfolio are judged in Pakistan time (UTC+5, no DST)
const PK_TZ = 'Asia/Karachi';
const PK_OFFSET_MS = 5 * 3600 * 1000;
/** End of the Pakistan calendar day that `date` falls on */
const pkEndOfDay = (date) => {
  const pk = new Date(new Date(date).getTime() + PK_OFFSET_MS);
  return new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate() + 1) - PK_OFFSET_MS - 1);
};
const DAY_MS = 24 * 3600 * 1000;
const daysSince = (date, now) => (date ? Math.max(0, Math.floor((now - new Date(date)) / DAY_MS)) : null);
const HEALTH_RANK = { 'On Track': 0, 'Needs Attention': 1, 'Behind Schedule': 2, 'Over Budget': 3 };

/**
 * Portfolio dashboard for management: every non-cancelled Main Project with its money flow
 * (same figures as each project's summary / cost report), health, approvals waiting and a cover photo,
 * plus portfolio totals and 12 months of certified work billed per Main Project.
 */
router.get('/portfolio', asyncHandler(async (req, res) => {
  const mains = await ConstructionProject.find({ parentProject: null, status: { $ne: 'Cancelled' } })
    .select('name projectNumber projectType contractBasis status society sector address clientName startDate expectedEndDate actualEndDate lumpSumBudget budgetStatus budgetSubmittedAt approvedBudget.amount approvedBudget.utilized budgetRequest.revision budgetRequest.approvers.name budgetRequest.approvers.role budgetRequest.currentStep overallProgress projectManager createdAt')
    .populate('projectManager', 'firstName lastName')
    .sort({ createdAt: -1 }).lean();
  const mainIds = mains.map((m) => m._id);
  const subs = await ConstructionProject.find({ parentProject: { $in: mainIds }, status: { $ne: 'Cancelled' } })
    .select('name parentProject status overallProgress allocatedBudget').lean();
  const subIds = subs.map((s) => s._id);
  const mainOfSub = new Map(subs.map((s) => [String(s._id), String(s.parentProject)]));
  const mainOf = (projectId) => mainOfSub.get(String(projectId)) || String(projectId);

  // First day of the month 11 months back, in Pakistan time
  const pkNow = new Date(Date.now() + PK_OFFSET_MS);
  const sinceY = pkNow.getUTCFullYear();
  const sinceM = pkNow.getUTCMonth() - 11;
  const since = new Date(Date.UTC(sinceY, sinceM, 1) - PK_OFFSET_MS);
  const [reports, contracts, openIpcs, monthly, inspections, clientInvoices] = await Promise.all([
    Promise.all(subs.map((s) => buildSubCostReport(s._id))),
    SubletContract.find({ project: { $in: subIds }, status: { $ne: 'Cancelled' } }).select('project contractor status').lean(),
    // Pending, plus Draft (not submitted yet) and Rejected (sent back), so every certified rupee is accounted for
    ProjectInvoice.find({ project: { $in: subIds }, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' }, approvalStatus: { $in: [...PENDING_IPC_STAGES, 'Draft', 'Rejected'] } })
      .select('project approvalStatus netPayableAmount grossAmount submittedAt createdAt').lean(),
    ProjectInvoice.aggregate([
      { $match: { project: { $in: subIds }, invoiceType: 'Subcontractor_IPC', ipcKind: { $nin: NON_WORK_IPC_KINDS }, status: { $ne: 'Cancelled' }, issueDate: { $gte: since } } },
      {
        $group: {
          _id: { p: '$project', y: { $year: { date: '$issueDate', timezone: PK_TZ } }, m: { $month: { date: '$issueDate', timezone: PK_TZ } } },
          amount: { $sum: { $ifNull: ['$grossAmount', 0] } }
        }
      }
    ]),
    InspectionReport.find({ project: { $in: subIds }, 'inspectors.attachments.0': { $exists: true } })
      .select('project inspectionDate inspectors').sort({ inspectionDate: -1 }).limit(200).lean(),
    // Revenue side: invoices raised to the client, on the Main Project or any of its Sub Projects
    ProjectInvoice.find({ project: { $in: [...mainIds, ...subIds] }, invoiceType: 'Client_Invoice', status: { $ne: 'Cancelled' } })
      .select('project invoiceAmount grossAmount paidAmount').lean()
  ]);

  const coverByMain = new Map();
  inspections.forEach((ir) => {
    const key = mainOf(ir.project);
    if (coverByMain.has(key)) return;
    const img = (ir.inspectors || []).flatMap((i) => i.attachments || []).find((a) => a.kind === 'image');
    if (img) coverByMain.set(key, img.url);
  });

  const pendingIpcs = openIpcs.filter((i) => PENDING_IPC_STAGES.includes(i.approvalStatus));
  const now = new Date();
  const waitingDays = (i) => daysSince(i.submittedAt || i.createdAt, now);
  const projects = mains.map((m) => {
    const id = String(m._id);
    const mySubs = subs.filter((s) => String(s.parentProject) === id);
    const myReports = mySubs.map((s) => reports[subs.indexOf(s)]);
    const mySummaries = myReports.map((r) => r.summary);
    // Slab-wise progress (stages claimed / billed) and BOQ-wise coverage (lines contracted)
    const slabRows = myReports.flatMap((r) => r.slabContracts.flatMap((c) => c.slabs));
    const boqLines = myReports.flatMap((r) => r.lines);
    const slabs = {
      total: slabRows.length,
      verified: slabRows.filter((x) => x.verified > 0).length,
      billed: slabRows.filter((x) => x.billed > 0).length,
      approved: slabRows.filter((x) => x.approved > 0).length,
      value: round2(slabRows.reduce((t, x) => t + (Number(x.amount) || 0), 0))
    };
    const lines = {
      total: boqLines.length,
      contracted: boqLines.filter((l) => l.contracted > 0).length,
      billed: boqLines.filter((l) => l.billed > 0).length
    };
    const sum = (f) => round2(mySummaries.reduce((t, r) => t + (Number(r[f]) || 0), 0));
    // Budget = the Main Project budget the CEO approved; the BOQ total is kept as the estimate
    const boqEstimate = sum('budget');
    const budgetStatus = m.budgetStatus || 'Draft';
    const budget = approvedBudgetAmount(m);
    const revisionPending = budget > 0 && budgetStatus === 'Submitted';
    const distributed = round2(mySubs.reduce((t, x) => t + (Number(x.allocatedBudget) || 0), 0));
    const spent = sum('billed');
    const progress = Number(m.overallProgress) || 0;
    const myContracts = contracts.filter((c) => mainOf(c.project) === id);
    const myPending = pendingIpcs.filter((i) => mainOf(i.project) === id);
    const contracted = sum('contracted');
    const linesOverBudget = sum('linesOverBudget');
    const completed = m.status === 'Completed';
    const started = !['Draft', 'Planning'].includes(m.status);
    // A project is overdue only once its whole end date (Pakistan time) has passed
    const overdue = Boolean(m.expectedEndDate && !completed && now > pkEndOfDay(m.expectedEndDate));
    const daysOverdue = overdue ? Math.max(1, Math.ceil((now - pkEndOfDay(m.expectedEndDate)) / DAY_MS)) : 0;
    // Planned progress from the timeline, so a project can be flagged as behind schedule
    let plannedProgress = null;
    if (m.startDate && m.expectedEndDate) {
      const span = pkEndOfDay(m.expectedEndDate) - new Date(m.startDate);
      if (span > 0) plannedProgress = Math.max(0, Math.min(100, Math.round(((now - new Date(m.startDate)) / span) * 100)));
    }

    // Every reason the project is not simply "on track", worst first, so management sees why
    const reasons = [];
    const flag = (level, text) => reasons.push({ level, text });
    if (budget > 0 && spent > budget) flag('Over Budget', `Certified work is ${round2(spent - budget).toLocaleString('en-PK')} above the approved budget`);
    if (!completed) {
      if (budget <= 0 && budgetStatus === 'Submitted') {
        const wait = daysSince(m.budgetSubmittedAt, now);
        const withWhom = m.budgetRequest?.approvers?.[m.budgetRequest.currentStep];
        flag('Needs Attention', `Budget waiting for approval${withWhom ? ` by ${withWhom.name} (${withWhom.role})` : ''}${wait ? ` for ${wait} day${wait === 1 ? '' : 's'}` : ''} — no new contracts until approved`);
      } else if (budget <= 0) {
        flag('Needs Attention', m.budgetRequest?.approvers?.length ? 'Budget not sent for approval yet — no new contracts until approved' : 'No budget prepared yet — no contracts can be made until one is approved');
      } else if (mySubs.length && mySubs.some((x) => !(Number(x.allocatedBudget) > 0) && x.status !== 'Completed')) {
        const n = mySubs.filter((x) => !(Number(x.allocatedBudget) > 0) && x.status !== 'Completed').length;
        flag('Needs Attention', `${n} sub project${n === 1 ? ' is' : 's are'} not in the approved budget — ${revisionPending ? 'a budget revision is in approval' : 'add them with a budget revision'}; no contracts until then`);
      }
    }
    if (!completed && progress >= 100) flag('Needs Attention', 'Work is 100% done but the project is not marked Completed');
    else if (overdue && !started) flag('Behind Schedule', `Still ${m.status} ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} after its planned end date`);
    else if (overdue) flag('Behind Schedule', `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} past its end date at ${progress}% done`);
    else if (!started && m.startDate && now > new Date(m.startDate)) flag('Needs Attention', `Start date has passed but the project is still ${m.status}`);
    else if (started && plannedProgress !== null && plannedProgress - progress > 25) flag('Behind Schedule', `${progress}% done while ${plannedProgress}% of the planned time has passed`);
    if (budget > 0 && contracted > budget) flag('Needs Attention', `Contracts are ${round2(contracted - budget).toLocaleString('en-PK')} above the approved budget`);
    if (m.contractBasis !== 'Slab' && linesOverBudget > 0) flag('Needs Attention', `${linesOverBudget} BOQ line${linesOverBudget === 1 ? '' : 's'} over the BOQ estimate or quantity`);
    if (!m.startDate || !m.expectedEndDate) flag('Needs Attention', 'Start or end date missing, so schedule cannot be tracked');
    reasons.sort((a, b) => HEALTH_RANK[b.level] - HEALTH_RANK[a.level]);
    const health = reasons[0]?.level || 'On Track';
    const myClient = clientInvoices.filter((i) => mainOf(i.project) === id);
    const earnedValue = round2((budget * progress) / 100);
    return {
      _id: m._id,
      name: m.name,
      projectNumber: m.projectNumber,
      projectType: m.projectType,
      contractBasis: m.contractBasis || null,
      slabs,
      lines,
      status: m.status,
      location: [m.society, m.sector].filter(Boolean).join(', '),
      clientName: m.clientName || '',
      projectManager: m.projectManager ? `${m.projectManager.firstName || ''} ${m.projectManager.lastName || ''}`.trim() : '',
      startDate: m.startDate,
      expectedEndDate: m.expectedEndDate,
      actualEndDate: m.actualEndDate,
      cover: coverByMain.get(id) || null,
      progress,
      plannedProgress,
      overdue,
      daysOverdue,
      health,
      healthReasons: reasons.map((r) => r.text),
      lumpSumBudget: Number(m.lumpSumBudget) || 0,
      budgetStatus,
      budget,
      // Ongoing projects: spent before the ERP; total budget = utilizedBudget + budget
      utilizedBudget: budget > 0 ? Number(m.approvedBudget?.utilized) || 0 : 0,
      revisionPending,
      boqEstimate,
      distributed,
      contracted,
      verified: sum('verified'),
      spent,
      approved: sum('approved'),
      paid: sum('paid'),
      retentionHeld: sum('retentionHeld'),
      advanceOutstanding: sum('advanceOutstanding'),
      linesOverBudget,
      clientBilled: round2(myClient.reduce((t, i) => t + (Number(i.invoiceAmount) || Number(i.grossAmount) || 0), 0)),
      clientReceived: round2(myClient.reduce((t, i) => t + (Number(i.paidAmount) || 0), 0)),
      variance: round2(spent - budget),
      cpi: spent > 0 && budget > 0 ? Math.round((earnedValue / spent) * 100) / 100 : null,
      subProjects: mySubs.length,
      activeSubProjects: mySubs.filter((s) => s.status === 'Active').length,
      contracts: myContracts.length,
      contractors: new Set(myContracts.map((c) => String(c.contractor)).filter(Boolean)).size,
      pendingApprovals: myPending.length,
      pendingAmount: round2(myPending.reduce((t, i) => t + (Number(i.netPayableAmount) || Number(i.grossAmount) || 0), 0)),
      oldestPendingDays: myPending.length ? Math.max(...myPending.map(waitingDays)) : null
    };
  });

  const total = (f) => round2(projects.reduce((t, p) => t + (Number(p[f]) || 0), 0));
  const budget = total('budget');
  const totals = {
    projects: projects.length,
    active: projects.filter((p) => p.status === 'Active').length,
    completed: projects.filter((p) => p.status === 'Completed').length,
    boqWise: projects.filter((p) => p.contractBasis === 'BOQ').length,
    slabWise: projects.filter((p) => p.contractBasis === 'Slab').length,
    subProjects: total('subProjects'),
    contractors: new Set(contracts.map((c) => String(c.contractor)).filter(Boolean)).size,
    lumpSumBudget: total('lumpSumBudget'),
    budget,
    utilizedBudget: total('utilizedBudget'),
    boqEstimate: total('boqEstimate'),
    distributed: total('distributed'),
    budgetsPending: projects.filter((p) => !(p.budget > 0) && p.status !== 'Completed').length,
    contracted: total('contracted'),
    verified: total('verified'),
    spent: total('spent'),
    approved: total('approved'),
    paid: total('paid'),
    retentionHeld: total('retentionHeld'),
    pendingApprovals: total('pendingApprovals'),
    pendingAmount: total('pendingAmount'),
    clientBilled: total('clientBilled'),
    clientReceived: total('clientReceived'),
    // Budget-weighted progress, so big projects count for more
    progress: budget > 0
      ? Math.round(projects.reduce((t, p) => t + p.progress * p.budget, 0) / budget)
      : Math.round(projects.reduce((t, p) => t + p.progress, 0) / (projects.length || 1)),
    health: ['On Track', 'Needs Attention', 'Behind Schedule', 'Over Budget']
      .map((h) => ({ health: h, count: projects.filter((p) => p.health === h).length }))
  };

  const approvalStages = PENDING_IPC_STAGES.map((stage) => {
    const list = pendingIpcs.filter((i) => i.approvalStatus === stage);
    return {
      stage,
      count: list.length,
      amount: round2(list.reduce((t, i) => t + (Number(i.netPayableAmount) || Number(i.grossAmount) || 0), 0)),
      oldestDays: list.length ? Math.max(...list.map(waitingDays)) : null
    };
  });
  const outside = (status) => {
    const list = openIpcs.filter((i) => i.approvalStatus === status);
    return { count: list.length, amount: round2(list.reduce((t, i) => t + (Number(i.grossAmount) || 0), 0)) };
  };
  const ipcNotInChain = { draft: outside('Draft'), rejected: outside('Rejected') };

  // Certified work billed per month, one key per Main Project id
  // Pakistan calendar months, oldest first
  const monthlySpend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(sinceY, sinceM + i, 1));
    return { month: d.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }), total: 0 };
  });
  const firstMonth = new Date(Date.UTC(sinceY, sinceM, 1));
  monthly.forEach((r) => {
    const idx = (r._id.y - firstMonth.getUTCFullYear()) * 12 + (r._id.m - 1 - firstMonth.getUTCMonth());
    if (idx < 0 || idx > 11) return;
    const key = mainOf(r._id.p);
    monthlySpend[idx][key] = round2((monthlySpend[idx][key] || 0) + r.amount);
    monthlySpend[idx].total = round2(monthlySpend[idx].total + r.amount);
  });

  res.json({ success: true, data: { totals, projects, approvalStages, ipcNotInChain, monthlySpend } });
}));

// ─── COST REPORT (budget vs actual) ──────────────────────────────────────────

/**
 * Budget vs actual for one Sub Project.
 * BOQ lines: budget (scope qty × estimate rate) → contracted (BOQ-wise sublet) → verified (check requests)
 * → billed (Work IPCs) → approved (CEO). Slab-wise contracts are reported per slab.
 */
/**
 * A contract as it holds cost: an open / completed one at its value; a cancelled one only at the work done on it
 * (its done BOQ quantities, or the slabs done) — the rest of its scope went back to be re-contracted.
 */
const asHeldContract = (c) => {
  if (c.status !== 'Cancelled') return c;
  const done = c.cancellation?.workDone || {};
  const doneSlabs = new Map((done.slabs || []).map((s) => [String(s.slabId), s]));
  return {
    ...c,
    originalValue: c.totalAmount,
    totalAmount: Number(done.amount) || 0,
    items: (done.lines || []).map((l) => ({ boqItem: l.boqItem, title: l.title, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount })),
    slabs: (c.slabs || []).filter((s) => doneSlabs.has(String(s._id))).map((s) => ({ ...s, amount: doneSlabs.get(String(s._id)).amount }))
  };
};

const buildSubCostReport = async (projectId) => {
  const pid = new mongoose.Types.ObjectId(String(projectId));
  const { projectFilter } = buildBoqFilter(projectId, { isSubProject: true });
  const [boqItems, contracts, crs, ipcs] = await Promise.all([
    BOQItem.find(projectFilter).select('title description unit cbsCategory estimatedQuantity estimatedUnitPrice discountAmount netEstimatedCost project allocations').lean(),
    // A cancelled contract counts at the work done on it before it was cancelled
    SubletContract.find({ project: pid, $or: [{ status: { $in: ['Active', 'Completed'] } }, { status: 'Cancelled', 'cancellation.workDone.amount': { $gt: 0 } }] })
      .populate('contractor', 'name').select('contractNumber contractType status totalAmount items slabs contractor cancellation').lean()
      .then((list) => list.map(asHeldContract)),
    CheckRequest.find({ project: pid, status: { $in: ['Verified', 'Billed'] } }).select('claimType items slab subletContract verifiedTotal').lean(),
    ProjectInvoice.find({ project: pid, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' } })
      .select('ipcKind approvalStatus items grossAmount checkRequest paidAmount retentionAmount advanceRecoveryAmount').lean()
  ]);

  const add = (map, key, f) => map.set(String(key), (map.get(String(key)) || 0) + f);
  const contractedQty = new Map(); const contractedAmt = new Map(); const contractorsByLine = new Map();
  contracts.filter((c) => c.contractType !== 'Slab').forEach((c) => (c.items || []).forEach((i) => {
    add(contractedQty, i.boqItem, Number(i.quantity) || 0);
    add(contractedAmt, i.boqItem, Number(i.amount) || (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0));
    const names = contractorsByLine.get(String(i.boqItem)) || new Set();
    names.add(c.status === 'Cancelled' ? `${c.contractor?.name || ''} (cancelled)` : c.contractor?.name); contractorsByLine.set(String(i.boqItem), names);
  }));
  const verifiedQty = new Map(); const verifiedAmt = new Map();
  crs.filter((c) => c.claimType !== 'Slab').forEach((c) => (c.items || []).forEach((i) => {
    add(verifiedQty, i.boqItem, Number(i.verifiedQuantity) || 0);
    add(verifiedAmt, i.boqItem, Number(i.verifiedAmount) || 0);
  }));
  const work = ipcs.filter((i) => !NON_WORK_IPC_KINDS.includes(i.ipcKind));
  const billedQty = new Map(); const billedAmt = new Map(); const approvedAmt = new Map();
  work.forEach((inv) => (inv.items || []).forEach((i) => {
    add(billedQty, i.boqItem, Number(i.currentQuantity) || 0);
    add(billedAmt, i.boqItem, Number(i.currentAmount) || 0);
    if (inv.approvalStatus === 'Approved') add(approvedAmt, i.boqItem, Number(i.currentAmount) || 0);
  }));

  const lines = boqItems.map((b) => {
    const id = String(b._id);
    const own = String(b.project) === String(projectId);
    // Lines allocated from the Main Project budget only the quantity allocated to this Sub
    const scopeQty = own
      ? Number(b.estimatedQuantity) || 0
      : (b.allocations || []).filter((a) => String(a.subProject) === String(projectId)).reduce((t, a) => t + (Number(a.allocatedQuantity) || 0), 0);
    const rate = Number(b.estimatedUnitPrice) || 0;
    const budget = round2(own && b.netEstimatedCost ? b.netEstimatedCost : scopeQty * rate);
    const contracted = round2(contractedAmt.get(id) || 0);
    const verified = round2(verifiedAmt.get(id) || 0);
    const billed = round2(billedAmt.get(id) || 0);
    const flags = [];
    if (contracted > budget + 0.5) flags.push('Contracted above budget');
    if ((verifiedQty.get(id) || 0) > scopeQty + 1e-6) flags.push('Verified quantity above BOQ');
    if (contracted && billed > contracted + 0.5) flags.push('Billed above contract');
    return {
      boqItem: id,
      title: b.title || b.description,
      unit: b.unit,
      cbsCategory: b.cbsCategory || 'Other',
      scopeQty,
      rate,
      budget,
      contractors: [...(contractorsByLine.get(id) || [])].filter(Boolean),
      contractedQty: contractedQty.get(id) || 0,
      contracted,
      verifiedQty: verifiedQty.get(id) || 0,
      verified,
      billedQty: billedQty.get(id) || 0,
      billed,
      approved: round2(approvedAmt.get(id) || 0),
      variance: round2((contracted || verified) - budget),
      flags
    };
  });

  const slabContracts = contracts.filter((c) => c.contractType === 'Slab').map((c) => {
    const crForSlab = (slabId) => crs.find((cr) => cr.claimType === 'Slab' && String(cr.slab?.slabId) === String(slabId));
    return {
      contractNumber: c.contractNumber,
      contractor: c.contractor?.name,
      status: c.status,
      value: c.totalAmount,
      ...(c.status === 'Cancelled' ? { originalValue: c.originalValue, cancellationDate: c.cancellation?.cancellationDate || null } : {}),
      slabs: (c.slabs || []).map((sl) => {
        const cr = crForSlab(sl._id);
        const ipc = cr && work.find((i) => String(i.checkRequest) === String(cr._id));
        return {
          name: sl.name,
          percentage: sl.percentage,
          amount: sl.amount,
          activities: (sl.activities || []).map((a) => a.name),
          verified: cr ? round2(cr.verifiedTotal) : 0,
          billed: ipc ? round2(ipc.grossAmount) : 0,
          approved: ipc && ipc.approvalStatus === 'Approved' ? round2(ipc.grossAmount) : 0
        };
      })
    };
  });

  const sum = (list, f) => round2(list.reduce((t, r) => t + (Number(r[f]) || 0), 0));
  const slabRows = slabContracts.flatMap((c) => c.slabs);
  const summary = {
    budget: sum(lines, 'budget'),
    contracted: round2(contracts.reduce((t, c) => t + (Number(c.totalAmount) || 0), 0)),
    verified: round2(sum(lines, 'verified') + sum(slabRows, 'verified')),
    billed: sum(work, 'grossAmount'),
    approved: sum(work.filter((i) => i.approvalStatus === 'Approved'), 'grossAmount'),
    paid: sum(work.concat(ipcs.filter((i) => NON_WORK_IPC_KINDS.includes(i.ipcKind))), 'paidAmount'),
    retentionHeld: round2(sum(work.filter((i) => i.approvalStatus === 'Approved'), 'retentionAmount')
      - sum(ipcs.filter((i) => i.ipcKind === 'Retention Release'), 'grossAmount')),
    advanceOutstanding: Math.max(0, round2(sum(ipcs.filter((i) => i.ipcKind === 'Advance' && i.approvalStatus === 'Approved'), 'grossAmount')
      - sum(work, 'advanceRecoveryAmount'))),
    linesOverBudget: lines.filter((l) => l.flags.length).length
  };
  summary.variance = round2(summary.contracted - summary.budget);
  return { lines, slabContracts, summary };
};

/**
 * Cost detail of one Sub Project below the cost report: per sublet contract (its BOQ lines or slabs),
 * per check request (claimed → verified → billed per line) and per IPC (gross → deductions → net → paid).
 * Used by the portfolio drill-down so every level has its own cost report.
 */
router.get('/projects/:id/cost-detail', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('parentProject').lean();
  if (!project) return notFound(res, 'Project');
  if (!project.parentProject) return badRequest(res, 'Cost detail is for Sub Projects');
  const pid = project._id;

  const [report, contracts, crs, ipcs] = await Promise.all([
    buildSubCostReport(pid),
    // Cancelled contracts that had started stay in the detail — their claims and IPCs belong to them
    SubletContract.find({ project: pid, $or: [{ status: { $ne: 'Cancelled' } }, { activatedAt: { $ne: null } }] })
      .select('contractNumber contractType status totalAmount items slabs activatedAt cancellation').lean(),
    CheckRequest.find({ project: pid, status: { $ne: 'Cancelled' } }).select('subletContract claimType slab items claimedTotal verifiedTotal status').lean(),
    ProjectInvoice.find({ project: pid, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' } })
      .select('subletContract checkRequest ipcKind ipcNumber issueDate approvalStatus items grossAmount retentionPercentage retentionAmount advanceRecoveryAmount whtPercentage whtAmount netPayableAmount paidAmount payments.amount payments.paidDate payments.paymentMethod payments.paymentReference')
      .sort({ issueDate: 1, ipcNumber: 1 }).lean()
  ]);

  const budgetByLine = new Map(report.lines.map((l) => [l.boqItem, l]));
  const isWork = (i) => !NON_WORK_IPC_KINDS.includes(i.ipcKind);
  const approvedOnly = (list) => list.filter((i) => i.approvalStatus === 'Approved');
  const sum = (list, f) => round2(list.reduce((t, x) => t + (Number(typeof f === 'function' ? f(x) : x[f]) || 0), 0));

  // IPC money per check request
  const ipcsByCr = new Map();
  ipcs.filter((i) => i.checkRequest).forEach((i) => {
    const key = String(i.checkRequest);
    ipcsByCr.set(key, [...(ipcsByCr.get(key) || []), i]);
  });
  const ipcMoney = (list) => {
    const work = list.filter(isWork);
    return {
      billed: sum(work, 'grossAmount'),
      approved: sum(approvedOnly(work), 'grossAmount'),
      netPayable: sum(list, 'netPayableAmount'),
      paid: sum(list, 'paidAmount')
    };
  };

  const checkRequests = {};
  crs.forEach((cr) => {
    const crIpcs = ipcsByCr.get(String(cr._id)) || [];
    const billedByLine = new Map();
    crIpcs.filter(isWork).forEach((i) => (i.items || []).forEach((it) => {
      const k = String(it.boqItem);
      const prev = billedByLine.get(k) || { qty: 0, amount: 0 };
      billedByLine.set(k, { qty: prev.qty + (Number(it.currentQuantity) || 0), amount: prev.amount + (Number(it.currentAmount) || 0) });
    }));
    checkRequests[String(cr._id)] = {
      claimType: cr.claimType,
      slab: cr.claimType === 'Slab' ? { name: cr.slab?.name, percentage: cr.slab?.percentage, amount: round2(cr.slab?.amount) } : null,
      claimed: round2(cr.claimedTotal),
      verified: round2(cr.verifiedTotal),
      ...ipcMoney(crIpcs),
      lines: (cr.items || []).map((it) => {
        const billed = billedByLine.get(String(it.boqItem)) || { qty: 0, amount: 0 };
        return {
          title: it.title || it.description, unit: it.unit, unitPrice: round2(it.unitPrice),
          claimedQty: Number(it.claimedQuantity) || 0, claimed: round2(it.claimedAmount || (it.claimedQuantity * it.unitPrice)),
          verifiedQty: Number(it.verifiedQuantity) || 0, verified: round2(it.verifiedAmount),
          billedQty: billed.qty, billed: round2(billed.amount)
        };
      })
    };
  });

  const contractDetail = contracts.map((c) => {
    const cid = String(c._id);
    const cCrs = crs.filter((cr) => String(cr.subletContract) === cid);
    const cIpcs = ipcs.filter((i) => String(i.subletContract) === cid
      || (i.checkRequest && cCrs.some((cr) => String(cr._id) === String(i.checkRequest))));
    const work = cIpcs.filter(isWork);
    const advances = approvedOnly(cIpcs.filter((i) => i.ipcKind === 'Advance'));
    const money = {
      value: round2(c.totalAmount),
      verified: sum(cCrs, 'verifiedTotal'),
      ...ipcMoney(cIpcs),
      retentionHeld: round2(sum(approvedOnly(work), 'retentionAmount') - sum(cIpcs.filter((i) => i.ipcKind === 'Retention Release'), 'grossAmount')),
      advancePaid: sum(advances, 'grossAmount'),
      advanceRecovered: sum(work, 'advanceRecoveryAmount'),
      wht: sum(cIpcs, 'whtAmount')
    };
    money.advanceOutstanding = Math.max(0, round2(money.advancePaid - money.advanceRecovered));
    money.remaining = round2(money.value - money.billed);
    const isCancelled = c.status === 'Cancelled';
    if (isCancelled) {
      // Ends at the work done on it; nothing more is to be billed beyond what was verified
      money.originalValue = money.value;
      money.value = round2(c.cancellation?.workDone?.amount);
      money.remaining = Math.max(0, round2(money.value - money.billed));
    }

    let lines = [];
    let slabs = [];
    if (c.contractType === 'Slab') {
      slabs = (c.slabs || []).map((sl) => {
        const cr = cCrs.find((x) => x.claimType === 'Slab' && String(x.slab?.slabId) === String(sl._id));
        const m = cr ? ipcMoney(ipcsByCr.get(String(cr._id)) || []) : { billed: 0, approved: 0, paid: 0 };
        return {
          _id: sl._id, name: sl.name, percentage: sl.percentage, amount: round2(sl.amount),
          verified: cr ? round2(cr.verifiedTotal) : 0, billed: m.billed, approved: m.approved, paid: m.paid
        };
      });
    } else {
      const add = (map, key, qty, amount) => {
        const prev = map.get(key) || { qty: 0, amount: 0 };
        map.set(key, { qty: prev.qty + (Number(qty) || 0), amount: prev.amount + (Number(amount) || 0) });
      };
      const verified = new Map(); const billed = new Map(); const approved = new Map();
      cCrs.forEach((cr) => (cr.items || []).forEach((it) => add(verified, String(it.boqItem), it.verifiedQuantity, it.verifiedAmount)));
      work.forEach((i) => (i.items || []).forEach((it) => {
        add(billed, String(it.boqItem), it.currentQuantity, it.currentAmount);
        if (i.approvalStatus === 'Approved') add(approved, String(it.boqItem), it.currentQuantity, it.currentAmount);
      }));
      lines = (c.items || []).map((it) => {
        const k = String(it.boqItem);
        const contracted = round2(it.amount || (it.quantity * it.unitPrice));
        const b = billed.get(k) || { qty: 0, amount: 0 };
        const line = budgetByLine.get(k);
        return {
          title: it.title || it.description || line?.title, unit: it.unit || line?.unit,
          budget: line ? line.budget : null, scopeQty: line ? line.scopeQty : null,
          contractedQty: Number(it.quantity) || 0, rate: round2(it.unitPrice), contracted,
          verifiedQty: (verified.get(k) || {}).qty || 0, verified: round2((verified.get(k) || {}).amount),
          billedQty: b.qty, billed: round2(b.amount), approved: round2((approved.get(k) || {}).amount),
          remaining: isCancelled
            ? Math.max(0, round2(((verified.get(k) || {}).amount || 0) - b.amount))
            : round2(contracted - b.amount)
        };
      });
    }
    return {
      _id: c._id, contractNumber: c.contractNumber, contractType: c.contractType, status: c.status || 'Active',
      cancellation: isCancelled
        ? { cancellationDate: c.cancellation?.cancellationDate || null, reason: c.cancellation?.reason || '', workDone: round2(c.cancellation?.workDone?.amount) }
        : null,
      money, lines, slabs
    };
  });

  // Each IPC with its deductions and where it leaves the contract
  const ipcDetail = {};
  // Work IPCs usually link their contract only through the check request
  const contractOf = (i) => String(i.subletContract || crs.find((cr) => String(cr._id) === String(i.checkRequest))?.subletContract || '');
  ipcs.forEach((i) => {
    const cid = contractOf(i);
    const sameContract = cid ? ipcs.filter((x) => contractOf(x) === cid && isWork(x)) : [];
    const upTo = sameContract.slice(0, sameContract.findIndex((x) => String(x._id) === String(i._id)) + 1);
    const contract = contracts.find((c) => String(c._id) === cid);
    ipcDetail[String(i._id)] = {
      gross: round2(i.grossAmount),
      retentionPercentage: Number(i.retentionPercentage) || 0,
      retention: round2(i.retentionAmount),
      advanceRecovery: round2(i.advanceRecoveryAmount),
      whtPercentage: Number(i.whtPercentage) || 0,
      wht: round2(i.whtAmount),
      net: round2(i.netPayableAmount),
      paid: round2(i.paidAmount),
      balance: Math.max(0, round2((i.netPayableAmount || 0) - (i.paidAmount || 0))),
      contractValue: contract ? round2(contract.totalAmount) : null,
      billedToDate: isWork(i) && upTo.length ? sum(upTo, 'grossAmount') : null,
      lines: (i.items || []).map((it) => ({
        title: it.title || it.description, unit: it.unit,
        previousQty: Number(it.previousQuantity) || 0, currentQty: Number(it.currentQuantity) || 0,
        cumulativeQty: Number(it.cumulativeQuantity) || 0, unitPrice: round2(it.unitPrice), amount: round2(it.currentAmount)
      })),
      payments: (i.payments || []).map((p) => ({ amount: round2(p.amount), paidDate: p.paidDate, method: p.paymentMethod, reference: p.paymentReference }))
    };
  });

  res.json({ success: true, data: { contracts: contractDetail, checkRequests, ipcs: ipcDetail } });
}));

// GET /api/project-management/projects/:id/cost-report — Sub: per line + per slab; Main: per Sub Project
router.get('/projects/:id/cost-report', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('name parentProject totalEstimatedCost lumpSumBudget').lean();
  if (!project) return notFound(res, 'Project');
  if (project.parentProject) {
    return res.json({ success: true, data: { level: 'sub', ...(await buildSubCostReport(req.params.id)) } });
  }
  const subs = await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } })
    .select('name projectNumber sector').sort({ name: 1 }).lean();
  const rows = await Promise.all(subs.map(async (sp) => ({ project: sp, ...(await buildSubCostReport(sp._id)).summary })));
  const keys = ['budget', 'contracted', 'verified', 'billed', 'approved', 'paid', 'retentionHeld', 'advanceOutstanding', 'variance', 'linesOverBudget'];
  const summary = Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0))]));
  summary.lumpSumBudget = Number(project.lumpSumBudget) || 0;
  res.json({ success: true, data: { level: 'main', subProjects: rows, summary } });
}));

/**
 * One-page project summary for the Project Detail Overview.
 * Built on the cost report so Budget / Spent match the Cost Report tab:
 * budget = BOQ scope, spent = certified work IPCs (gross), progress = synced overallProgress.
 * Main: totals over its non-cancelled Sub Projects. Sub: its own figures.
 */
router.get('/projects/:id/summary', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id)
    .select('name projectNumber status parentProject lumpSumBudget budgetStatus approvedBudget.amount approvedBudget.utilized allocatedBudget utilizedBudget overallProgress').lean();
  if (!project) return notFound(res, 'Project');
  const isMain = !project.parentProject;

  const units = isMain
    ? await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } })
      .select('name projectNumber sector status overallProgress allocatedBudget').sort({ name: 1 }).lean()
    : [project];
  const reports = await Promise.all(units.map((u) => buildSubCostReport(u._id)));

  const subProjects = units.map((u, i) => {
    const { budget: boqEstimate, contracted, verified, billed, approved, paid } = reports[i].summary;
    // Budget = the share of the approved Main Project budget given to this Sub Project; the BOQ
    // estimate only stands in when none has been given (slab-wise projects have no BOQ at all)
    const budget = Number(u.allocatedBudget) > 0 ? round2(u.allocatedBudget) : boqEstimate;
    const progress = Number(u.overallProgress) || 0;
    let health = 'On Track';
    if (budget > 0 && billed > budget) health = 'Over Budget';
    else if (u.status === 'Active' && progress < 20) health = 'Needs Attention';
    return {
      _id: u._id, name: u.name, projectNumber: u.projectNumber, sector: u.sector, status: u.status,
      budget, contracted, verified, spent: billed, approved, paid, progress, variance: round2(billed - budget), health
    };
  });

  const sum = (f) => round2(subProjects.reduce((t, s) => t + (Number(s[f]) || 0), 0));
  // Main Project: its CEO-approved budget (stays in force while a revision is in approval)
  const mainApproved = isMain ? approvedBudgetAmount(project) : 0;
  const budget = mainApproved > 0 ? round2(mainApproved) : sum('budget');
  const spent = sum('spent');
  const progress = Number(project.overallProgress) || 0;
  // CPI only means something once work has been billed
  const earnedValue = round2((budget * progress) / 100);
  const cpi = spent > 0 && budget > 0 ? Math.round((earnedValue / spent) * 100) / 100 : null;

  const byCategory = new Map();
  reports.forEach((r) => r.lines.forEach((l) => byCategory.set(l.cbsCategory, (byCategory.get(l.cbsCategory) || 0) + l.budget)));
  const budgetByCategory = [...byCategory].map(([category, amount]) => ({ category, budget: round2(amount) }))
    .filter((c) => c.budget > 0).sort((a, b) => b.budget - a.budget);

  // Certified work billed per month, last 12 months
  const unitIds = units.map((u) => u._id);
  const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0); since.setMonth(since.getMonth() - 11);
  const monthly = await ProjectInvoice.aggregate([
    { $match: { project: { $in: unitIds }, invoiceType: 'Subcontractor_IPC', ipcKind: { $nin: NON_WORK_IPC_KINDS }, status: { $ne: 'Cancelled' }, issueDate: { $gte: since } } },
    { $group: { _id: { y: { $year: '$issueDate' }, m: { $month: '$issueDate' } }, amount: { $sum: { $ifNull: ['$grossAmount', 0] } } } }
  ]);
  const monthAmount = new Map(monthly.map((r) => [`${r._id.y}-${r._id.m}`, r.amount]));
  const monthlySpend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
    return {
      month: d.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
      amount: round2(monthAmount.get(`${d.getFullYear()}-${d.getMonth() + 1}`) || 0)
    };
  });

  const inspections = await InspectionReport.find({ project: { $in: unitIds }, 'inspectors.attachments.0': { $exists: true } })
    .select('reportNumber inspectionDate location inspectors project')
    .populate('project', 'name')
    .sort({ inspectionDate: -1 }).limit(10).lean();
  const sitePhotos = inspections.flatMap((ir) => (ir.inspectors || []).flatMap((insp) =>
    (insp.attachments || []).filter((a) => a.kind === 'image').map((a) => ({
      url: a.url,
      reportNumber: ir.reportNumber,
      inspector: insp.name,
      location: ir.location,
      projectName: ir.project?.name,
      date: insp.actedAt || ir.inspectionDate
    })))).slice(0, 12);

  res.json({
    success: true,
    data: {
      project: { _id: project._id, name: project.name, projectNumber: project.projectNumber, status: project.status, isMain },
      totals: {
        budget,
        lumpSumBudget: isMain ? Number(project.lumpSumBudget) || 0 : null,
        // Ongoing projects: already utilized before the ERP (not part of spent / budget above)
        utilizedBudget: isMain ? (mainApproved > 0 ? Number(project.approvedBudget?.utilized) || 0 : 0) : Number(project.utilizedBudget) || 0,
        contracted: sum('contracted'),
        verified: sum('verified'),
        spent,
        approved: sum('approved'),
        paid: sum('paid'),
        variance: round2(spent - budget),
        progress,
        earnedValue,
        cpi,
        subProjects: isMain ? subProjects.length : 0,
        activeSubProjects: isMain ? subProjects.filter((s) => s.status === 'Active').length : 0
      },
      subProjects: isMain ? subProjects : [],
      budgetByCategory,
      monthlySpend,
      sitePhotos
    }
  });
}));

/**
 * Main Project tree: Sub Projects → Sublet Contracts → Check Requests (with their inspection reports) → IPCs.
 * Slab-wise contracts list every slab with the check request / IPC that claimed it.
 * Advance and Retention Release IPCs hang off their contract; anything not linked to a contract is returned per Sub as `unlinked`.
 */
router.get('/projects/:id/tree', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('name projectNumber parentProject').lean();
  if (!project) return notFound(res, 'Project');
  if (project.parentProject) return badRequest(res, 'Project tree is for Main Projects');

  const subs = await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } })
    .select('name projectNumber sector status overallProgress').sort({ name: 1 }).lean();
  const subIds = subs.map((s) => s._id);

  const [contracts, crs, ipcs, inspections] = await Promise.all([
    // Cancelled contracts that had started stay in the tree, with their claims and IPCs under them
    SubletContract.find({ project: { $in: subIds }, $or: [{ status: { $ne: 'Cancelled' } }, { activatedAt: { $ne: null } }] })
      .populate('contractor', 'name')
      .select('project contractNumber title contractor contractType status totalAmount slabs createdAt cancellation replacesContract')
      .sort({ createdAt: 1 }).lean(),
    CheckRequest.find({ project: { $in: subIds }, status: { $ne: 'Cancelled' } })
      .populate('contractor', 'name')
      .select('project checkRequestNumber title contractor claimType subletContract slab status claimedTotal verifiedTotal createdAt')
      .sort({ createdAt: 1 }).lean(),
    ProjectInvoice.find({ project: { $in: subIds }, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' } })
      .select('project invoiceNumber ipcNumber ipcKind checkRequest subletContract grossAmount netPayableAmount paidAmount approvalStatus status issueDate submittedAt createdAt')
      .sort({ issueDate: 1 }).lean(),
    InspectionReport.find({ project: { $in: subIds }, status: { $ne: 'Cancelled' } })
      .select('checkRequest reportNumber inspectionDate location remarks claimType items slab inspectedTotal inspectors.name inspectors.designation inspectors.status inspectors.observations inspectors.signature inspectors.attachments inspectors.actedAt status completedAt')
      .sort({ inspectionDate: 1 }).lean()
  ]);

  const inspectionsByCr = new Map();
  inspections.forEach((ir) => {
    const key = String(ir.checkRequest);
    inspectionsByCr.set(key, [...(inspectionsByCr.get(key) || []), { ...ir, inspectedTotal: round2(ir.inspectedTotal) }]);
  });

  const ipcView = (i) => ({
    _id: i._id, invoiceNumber: i.invoiceNumber, ipcNumber: i.ipcNumber, ipcKind: i.ipcKind,
    grossAmount: round2(i.grossAmount), netPayableAmount: round2(i.netPayableAmount), paidAmount: round2(i.paidAmount),
    approvalStatus: i.approvalStatus, status: i.status, issueDate: i.issueDate, submittedAt: i.submittedAt || null
  });
  const ipcsByCr = new Map();
  ipcs.filter((i) => i.checkRequest).forEach((i) => {
    const key = String(i.checkRequest);
    ipcsByCr.set(key, [...(ipcsByCr.get(key) || []), ipcView(i)]);
  });
  const crView = (c) => ({
    _id: c._id, checkRequestNumber: c.checkRequestNumber, title: c.title, contractor: c.contractor?.name || '',
    claimType: c.claimType, status: c.status, claimedTotal: round2(c.claimedTotal), verifiedTotal: round2(c.verifiedTotal),
    slabName: c.slab?.name || '', ipcs: ipcsByCr.get(String(c._id)) || [],
    inspections: inspectionsByCr.get(String(c._id)) || []
  });

  const contractIds = new Set(contracts.map((c) => String(c._id)));
  const crIds = new Set(crs.map((c) => String(c._id)));
  const rollup = (crList, extraIpcs) => {
    const all = [...crList.flatMap((c) => c.ipcs), ...extraIpcs];
    const work = all.filter((i) => !NON_WORK_IPC_KINDS.includes(i.ipcKind));
    return {
      checkRequests: crList.length,
      ipcs: all.length,
      billed: round2(work.reduce((t, i) => t + i.grossAmount, 0)),
      approved: round2(work.filter((i) => i.approvalStatus === 'Approved').reduce((t, i) => t + i.grossAmount, 0)),
      paid: round2(all.reduce((t, i) => t + i.paidAmount, 0))
    };
  };

  const subProjects = subs.map((sub) => {
    const sid = String(sub._id);
    const subCrs = crs.filter((c) => String(c.project) === sid);
    const subIpcs = ipcs.filter((i) => String(i.project) === sid);

    const contractNodes = contracts.filter((c) => String(c.project) === sid).map((c) => {
      const cid = String(c._id);
      const cCrs = subCrs.filter((cr) => String(cr.subletContract) === cid).map(crView);
      // Advances / retention releases (and any IPC whose check request is gone) sit directly under the contract
      const otherIpcs = subIpcs
        .filter((i) => String(i.subletContract) === cid && (!i.checkRequest || !crIds.has(String(i.checkRequest))))
        .map(ipcView);
      const node = {
        _id: c._id, contractNumber: c.contractNumber, title: c.title, contractor: c.contractor?.name || '',
        contractType: c.contractType, status: c.status, totalAmount: round2(c.totalAmount),
        replacesContract: c.replacesContract ? String(c.replacesContract) : null,
        cancellation: c.status === 'Cancelled'
          ? { cancellationDate: c.cancellation?.cancellationDate || null, reason: c.cancellation?.reason || '', workDone: round2(c.cancellation?.workDone?.amount) }
          : null,
        checkRequests: cCrs, otherIpcs, totals: rollup(cCrs, otherIpcs)
      };
      if (c.contractType === 'Slab') {
        node.slabs = (c.slabs || []).map((sl) => {
          const claims = cCrs.filter((cr) => {
            const raw = subCrs.find((x) => String(x._id) === String(cr._id));
            return String(raw?.slab?.slabId) === String(sl._id);
          });
          return { _id: sl._id, name: sl.name, percentage: sl.percentage, amount: round2(sl.amount), checkRequests: claims };
        });
      }
      return node;
    });

    const unlinkedCrs = subCrs.filter((cr) => !cr.subletContract || !contractIds.has(String(cr.subletContract))).map(crView);
    const unlinkedIpcs = subIpcs
      .filter((i) => (!i.checkRequest || !crIds.has(String(i.checkRequest))) && (!i.subletContract || !contractIds.has(String(i.subletContract))))
      .map(ipcView);

    return {
      _id: sub._id, name: sub.name, projectNumber: sub.projectNumber, sector: sub.sector, status: sub.status,
      progress: Number(sub.overallProgress) || 0,
      contracts: contractNodes,
      unlinked: { checkRequests: unlinkedCrs, ipcs: unlinkedIpcs },
      totals: { contracts: contractNodes.length, ...rollup(subCrs.map(crView), unlinkedIpcs.concat(contractNodes.flatMap((c) => c.otherIpcs))) }
    };
  });

  res.json({ success: true, data: { project: { _id: project._id, name: project.name, projectNumber: project.projectNumber }, subProjects } });
}));

/**
 * Cost analysis (Main or Sub Project): one flat row per sublet contract (plus a "no contract" row per Sub / contractor
 * for check requests and IPCs raised without one), each with its Sub Project, contractor, check request and
 * IPC counts and money. Sub Project budget figures come from the cost report so every view agrees.
 * The client groups these rows by Sub Project, contractor, contract, etc.
 */
router.get('/projects/:id/cost-analysis', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id)
    .select('name projectNumber parentProject lumpSumBudget allocatedBudget utilizedBudget approvedBudget.amount approvedBudget.utilized sector projectType status overallProgress').lean();
  if (!project) return notFound(res, 'Project');
  const isSub = Boolean(project.parentProject);

  // A Sub Project reports on itself; a Main Project on all its non-cancelled Sub Projects
  const subs = isSub
    ? [project]
    : await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } })
      .select('name projectNumber sector projectType status overallProgress allocatedBudget utilizedBudget').sort({ name: 1 }).lean();
  // Legacy type names (Villa, Infrastructure…) are reported under the three master types
  const typeOf = (sub) => normalizeProjectType(sub.projectType) || sub.projectType || 'Other';
  const subIds = subs.map((s) => s._id);

  const [reports, contracts, crs, ipcs] = await Promise.all([
    Promise.all(subs.map((s) => buildSubCostReport(s._id))),
    // Cancelled contracts that had started keep their own bucket, valued at the work done on them
    SubletContract.find({ project: { $in: subIds }, $or: [{ status: { $ne: 'Cancelled' } }, { activatedAt: { $ne: null } }] })
      .populate('contractor', 'name')
      .select('project contractNumber title contractor contractType status totalAmount slabs cancellation').lean(),
    CheckRequest.find({ project: { $in: subIds }, status: { $ne: 'Cancelled' } })
      .populate('contractor', 'name')
      .select('project contractor subletContract status claimedTotal verifiedTotal').lean(),
    ProjectInvoice.find({ project: { $in: subIds }, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' } })
      .populate('contractor', 'name')
      .select('project contractor subletContract checkRequest ipcKind approvalStatus grossAmount netPayableAmount paidAmount retentionAmount').lean()
  ]);

  const subById = new Map(subs.map((s) => [String(s._id), s]));
  const crById = new Map(crs.map((c) => [String(c._id), c]));
  const contractById = new Map(contracts.map((c) => [String(c._id), c]));
  const party = (c) => (c?._id ? { _id: c._id, name: c.name } : null);

  // One bucket per contract; work raised without a contract goes to a per-Sub, per-contractor bucket
  const buckets = new Map();
  const bucketFor = (subId, contractId, contractor) => {
    const cid = contractId && contractById.has(String(contractId)) ? String(contractId) : null;
    const key = cid || `none:${subId}:${contractor?._id || ''}`;
    if (!buckets.has(key)) {
      const c = cid ? contractById.get(cid) : null;
      const sub = subById.get(String(subId));
      buckets.set(key, {
        _id: cid || key,
        contract: c ? {
          _id: c._id, contractNumber: c.contractNumber, title: c.title, type: c.contractType, status: c.status,
          value: round2(c.status === 'Cancelled' ? c.cancellation?.workDone?.amount : c.totalAmount),
          ...(c.status === 'Cancelled' ? { originalValue: round2(c.totalAmount), cancellationDate: c.cancellation?.cancellationDate || null } : {}),
          slabs: (c.slabs || []).length
        } : null,
        contractor: c ? party(c.contractor) : contractor,
        subProject: sub ? { _id: sub._id, name: sub.name, projectNumber: sub.projectNumber, projectType: typeOf(sub), sector: sub.sector || '' } : null,
        checkRequests: { count: 0, byStatus: {}, byStatusAmount: {}, claimed: 0, verified: 0 },
        ipcs: { count: 0, byApproval: {}, byApprovalAmount: {}, byKind: {}, billed: 0, approved: 0, approvedNet: 0, paid: 0, retention: 0 }
      });
    }
    return buckets.get(key);
  };
  contracts.forEach((c) => bucketFor(c.project, c._id));

  crs.forEach((cr) => {
    const b = bucketFor(cr.project, cr.subletContract, party(cr.contractor));
    const r = b.checkRequests;
    r.count += 1;
    r.byStatus[cr.status] = (r.byStatus[cr.status] || 0) + 1;
    r.claimed = round2(r.claimed + (Number(cr.claimedTotal) || 0));
    const isVerified = ['Verified', 'Billed'].includes(cr.status);
    if (isVerified) r.verified = round2(r.verified + (Number(cr.verifiedTotal) || 0));
    // Money at each stage: verified value once verified, claimed value before that
    const stageAmount = isVerified ? Number(cr.verifiedTotal) || 0 : Number(cr.claimedTotal) || 0;
    r.byStatusAmount[cr.status] = round2((r.byStatusAmount[cr.status] || 0) + stageAmount);
  });

  ipcs.forEach((i) => {
    const contractId = i.subletContract || crById.get(String(i.checkRequest))?.subletContract;
    const b = bucketFor(i.project, contractId, party(i.contractor));
    const r = b.ipcs;
    const gross = Number(i.grossAmount) || 0;
    const approved = i.approvalStatus === 'Approved';
    const work = !NON_WORK_IPC_KINDS.includes(i.ipcKind);
    r.count += 1;
    r.byApproval[i.approvalStatus] = (r.byApproval[i.approvalStatus] || 0) + 1;
    r.byApprovalAmount[i.approvalStatus] = round2((r.byApprovalAmount[i.approvalStatus] || 0) + gross);
    r.byKind[i.ipcKind] = (r.byKind[i.ipcKind] || 0) + 1;
    if (work) {
      r.billed = round2(r.billed + gross);
      if (approved) {
        r.approved = round2(r.approved + gross);
        r.retention = round2(r.retention + (Number(i.retentionAmount) || 0));
      }
    }
    if (approved) r.approvedNet = round2(r.approvedNet + (Number(i.netPayableAmount) || gross));
    r.paid = round2(r.paid + (Number(i.paidAmount) || 0));
  });

  const rows = [...buckets.values()].map((b) => ({
    ...b,
    outstanding: round2(Math.max(0, b.ipcs.approvedNet - b.ipcs.paid)),
    remaining: b.contract ? round2(b.contract.value - b.ipcs.billed) : null
  }));

  const subProjects = subs.map((s, i) => ({
    _id: s._id, name: s.name, projectNumber: s.projectNumber, sector: s.sector || '', projectType: typeOf(s), status: s.status,
    progress: Number(s.overallProgress) || 0,
    ...reports[i].summary,
    // Ongoing projects: spent before the ERP (outside contracted / billed / paid); total budget = this + its remaining share
    utilizedBudget: Number(s.utilizedBudget) || 0,
    remainingBudget: Number(s.allocatedBudget) || 0
  }));
  const keys = ['budget', 'contracted', 'verified', 'billed', 'approved', 'paid', 'retentionHeld', 'advanceOutstanding', 'variance'];
  const totals = Object.fromEntries(keys.map((k) => [k, round2(subProjects.reduce((t, r) => t + (Number(r[k]) || 0), 0))]));
  totals.lumpSumBudget = isSub ? 0 : Number(project.lumpSumBudget) || 0;
  totals.utilizedBudget = round2(subProjects.reduce((t, r) => t + (Number(r.utilizedBudget) || 0), 0));
  totals.remainingBudget = isSub ? Number(project.allocatedBudget) || 0 : approvedBudgetAmount(project);
  totals.outstanding = round2(rows.reduce((t, r) => t + r.outstanding, 0));

  res.json({ success: true, data: { level: isSub ? 'sub' : 'main', project: { _id: project._id, name: project.name, projectNumber: project.projectNumber }, totals, subProjects, rows } });
}));

// GET /api/project-management/projects/:id/workflow — step-by-step status for the Sub Project workflow strip
router.get('/projects/:id/workflow', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('parentProject').lean();
  if (!project) return notFound(res, 'Project');
  if (!project.parentProject) return badRequest(res, 'Workflow applies to Sub Projects only');

  const { projectFilter } = buildBoqFilter(req.params.id, { isSubProject: true });
  const [boqLines, contracts, checkRequests, ipcs] = await Promise.all([
    BOQItem.countDocuments(projectFilter),
    SubletContract.find({ project: req.params.id, status: { $ne: 'Cancelled' } }).select('status').lean(),
    CheckRequest.find({ project: req.params.id, status: { $ne: 'Cancelled' } })
      .select('status items claimType verifiedTotal linkedInvoice').lean(),
    ProjectInvoice.find({ project: req.params.id, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' } })
      .select('status approvalStatus netPayableAmount invoiceAmount paidAmount').lean()
  ]);

  const countBy = (rows, status) => rows.filter((r) => r.status === status).length;
  const billable = (cr) => checkRequestBillable(cr) > 0;
  // Finance owes only what the CEO has approved
  const unpaid = ipcs.filter((i) => i.approvalStatus === 'Approved' && i.status !== 'Paid');

  res.json({
    success: true,
    data: {
      boq: { lines: boqLines },
      contracts: {
        draft: countBy(contracts, 'Draft'),
        active: countBy(contracts, 'Active'),
        completed: countBy(contracts, 'Completed')
      },
      checkRequests: {
        draft: countBy(checkRequests, 'Draft'),
        rejected: countBy(checkRequests, 'Rejected'),
        submitted: countBy(checkRequests, 'Submitted'),
        readyForIpc: checkRequests.filter(billable).length,
        verifiedOrBilled: checkRequests.filter((c) => ['Verified', 'Billed'].includes(c.status)).length
      },
      ipcs: {
        total: ipcs.length,
        draft: ipcs.filter((i) => (i.approvalStatus || 'Draft') === 'Draft').length,
        rejected: ipcs.filter((i) => i.approvalStatus === 'Rejected').length,
        inApproval: ipcs.filter((i) => ['Pending Audit', 'Forwarded to Audit Director', 'Send to CEO Office', 'Forwarded to CEO'].includes(i.approvalStatus)).length,
        approved: ipcs.filter((i) => i.approvalStatus === 'Approved').length,
        unpaid: unpaid.length,
        unpaidAmount: unpaid.reduce(
          (s, i) => s + Math.max(0, (Number(i.netPayableAmount) || Number(i.invoiceAmount) || 0) - (Number(i.paidAmount) || 0)), 0
        ),
        paid: countBy(ipcs, 'Paid')
      }
    }
  });
}));

// GET /api/project-management/projects/:id — single project
router.get('/projects/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id)
    .populate('projectManager', 'firstName lastName email')
    .populate({ path: 'projectManagerEmployee', select: 'firstName lastName employeeId placementDesignation', populate: { path: 'placementDesignation', select: 'title' } })
    .populate('budgetApprovedBy', 'firstName lastName')
    .populate('createdBy', 'firstName lastName')
    .populate('parentProject', 'name projectNumber isMasterProject projectType status lumpSumBudget society sector storeProject')
    .populate('storeProject', 'name code')
    .lean();

  if (!project) return notFound(res, 'Project');

  // Main: include allocation pool summary; Sub: include parent remaining context
  if (!project.parentProject) {
    project.budgetAllocation = await buildBudgetAllocationSummary(project);
  } else if (project.parentProject?._id) {
    const parentDoc = await ConstructionProject.findById(project.parentProject._id).lean();
    if (parentDoc) {
      project.budgetAllocation = await buildBudgetAllocationSummary(parentDoc);
    }
  }

  res.json({ success: true, data: project });
}));

// PUT /api/project-management/projects/:id/lump-sum-budget — set Main lump-sum envelope
router.put('/projects/:id/lump-sum-budget', asyncHandler(async (req, res) => (
  // Retired: the total now comes from the budget request (sum of its sub project lines) and is approved there
  badRequest(res, 'The budget is set through the budget request — its total is the sum of the sub project lines')
)));

// PUT /api/project-management/projects/:id/budget-allocations — allocate Main pool to Subs
router.put('/projects/:id/budget-allocations', asyncHandler(async (req, res) => (
  // Retired: the split per Sub Project is approved with the budget request; revise the request to change it
  badRequest(res, 'The split per sub project is approved with the budget — revise the budget request to change it')
)));


// POST /api/project-management/projects — create
router.post('/projects', asyncHandler(async (req, res) => {
  const { name, projectType, description, society, sector, street, side, plotNumber, address, sizeValue, sizeUnit,
    clientName, clientContact, projectManager, projectManagerEmployee, startDate, expectedEndDate,
    budgetCategories, notes, tags, isMasterProject, parentProject, contractValue, linkedProperty, companyId } = req.body;

  if (!name || !name.trim()) return badRequest(res, 'Project name is required');
  // The Main Project carries the Finance company; Sub Projects, contracts and IPCs inherit it
  if (!parentProject && !(companyId && isValidId(companyId))) {
    return badRequest(res, 'Select the Finance Company for this Main Project — its Sub Projects, contracts and IPCs post to that company');
  }

  // Project type and contract basis are chosen on the Main Project; Sub Projects take them from it
  let type = projectType;
  let contractBasis = null;
  let paymentMode = 'Cash';
  if (!parentProject) {
    if (!MAIN_PROJECT_TYPES.includes(projectType)) return badRequest(res, 'Select the Project Type');
    if (!CONTRACT_BASES.includes(req.body.contractBasis)) return badRequest(res, 'Select whether this project is BOQ-wise or Slab-wise');
    contractBasis = req.body.contractBasis;
    if (req.body.paymentMode !== undefined && !PAYMENT_MODES.includes(req.body.paymentMode)) {
      return badRequest(res, 'Select how contractors are paid: Cash / Bank, Barter or Mixed');
    }
    paymentMode = req.body.paymentMode || 'Cash';
  } else {
    if (!isValidId(parentProject)) return badRequest(res, 'Invalid Main Project');
    const parent = await ConstructionProject.findById(parentProject).select('projectType contractBasis paymentMode').lean();
    if (!parent) return notFound(res, 'Main Project');
    type = parent.projectType || projectType;
    contractBasis = parent.contractBasis || null;
    paymentMode = parent.paymentMode || 'Cash';
    // Contract Type applies to Villa Sub Projects only
    if (type === 'VILLAS' && !SUB_CONTRACT_TYPES.includes(req.body.contractType)) {
      return badRequest(res, 'Select the Contract Type: Barter, Labor Rate or Finishing');
    }
  }

  const project = new ConstructionProject({
    name: name.trim(),
    projectType: type, contractBasis, paymentMode, description, society, sector, plotNumber, address,
    contractType: parentProject && type === 'VILLAS' ? req.body.contractType : '',
    street: street || '',
    sizeValue: parentProject && Number(sizeValue) > 0 ? Number(sizeValue) : null,
    sizeUnit: parentProject && Number(sizeValue) > 0 ? String(sizeUnit || '').trim() : '',
    side: ['Left', 'Right'].includes(side) ? side : '',
    clientName, clientContact, notes, tags,
    companyId: !parentProject && companyId && isValidId(companyId) ? companyId : null,
    projectManager: projectManager || null,
    projectManagerEmployee: projectManagerEmployee && isValidId(projectManagerEmployee) ? projectManagerEmployee : null,
    startDate: startDate ? new Date(startDate) : undefined,
    expectedEndDate: expectedEndDate ? new Date(expectedEndDate) : undefined,
    budgetCategories: budgetCategories?.length ? budgetCategories : undefined,
    isMasterProject: Boolean(isMasterProject),
    parentProject: parentProject || null,
    contractValue: Number(contractValue) || 0,
    linkedProperty: linkedProperty || null,
    createdBy: req.user?._id,
    updatedBy: req.user?._id
  });

  // Two projects created at the same moment can draw the same number; regenerate and retry
  for (let attempt = 1; ; attempt += 1) {
    try {
      await project.save();
      break;
    } catch (err) {
      if (err?.code !== 11000 || !err.keyPattern?.projectNumber || attempt >= 5) throw err;
      project.projectNumber = undefined;
    }
  }

  if (project.parentProject) {
    await syncParentProjectProgress(project.parentProject);
  }

  const populated = await ConstructionProject.findById(project._id)
    .populate('projectManager', 'firstName lastName email').lean();

  res.status(201).json({ success: true, message: 'Project created successfully', data: populated });
}));

// PUT /api/project-management/projects/:id — update
router.put('/projects/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const allowed = [
    'name', 'projectType', 'description', 'status', 'society', 'sector',
    'plotNumber', 'street', 'side', 'address', 'clientName', 'clientContact', 'projectManager',
    'startDate', 'expectedEndDate', 'actualEndDate', 'budgetCategories',
    'notes', 'tags', 'overallProgress', 'linkedProperty', 'isMasterProject',
    'parentProject', 'contractValue', 'companyId', 'contractBasis', 'paymentMode', 'projectManagerEmployee',
    'sizeValue', 'sizeUnit', 'contractType', 'storeProject'
  ];

  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (updates.companyId !== undefined) updates.companyId = updates.companyId && isValidId(updates.companyId) ? updates.companyId : null;
  if (updates.sizeValue !== undefined || updates.sizeUnit !== undefined) {
    // Size is a Sub Project field: a blank / zero value clears both
    const v = Number(updates.sizeValue);
    updates.sizeValue = v > 0 ? v : null;
    updates.sizeUnit = v > 0 ? String(updates.sizeUnit || '').trim() : '';
  }
  if (updates.contractType !== undefined && !['', ...SUB_CONTRACT_TYPES].includes(updates.contractType)) {
    return badRequest(res, 'Select the Contract Type: Barter, Labor Rate or Finishing');
  }
  updates.updatedBy = req.user?._id;

  // Convert empty string refs to null to avoid CastError
  ['parentProject', 'linkedProperty', 'projectManager', 'projectManagerEmployee'].forEach(k => {
    if (updates[k] === '') {
      updates[k] = null;
    }
  });

  const oldProject = await ConstructionProject.findById(req.params.id)
    .select('name parentProject overallProgress allocatedBudget companyId projectType contractBasis paymentMode status actualEndDate')
    .lean();
  if (!oldProject) return notFound(res, 'Project');

  // Project type and contract basis live on the Main Project and flow down to its Sub Projects
  const nextParent = updates.parentProject !== undefined ? updates.parentProject : oldProject.parentProject;
  let cascade = null;
  if (nextParent) {
    delete updates.contractBasis;
    delete updates.paymentMode;
    if (updates.parentProject !== undefined && String(updates.parentProject || '') !== String(oldProject.parentProject || '')) {
      // Moved under another Main Project: take that project's type and basis
      const parent = await ConstructionProject.findById(nextParent).select('projectType contractBasis paymentMode').lean();
      if (!parent) return notFound(res, 'Main Project');
      updates.projectType = parent.projectType;
      updates.contractBasis = parent.contractBasis || null;
      updates.paymentMode = parent.paymentMode || 'Cash';
    } else {
      delete updates.projectType;
    }
  } else {
    if (updates.projectType !== undefined && !MAIN_PROJECT_TYPES.includes(updates.projectType) && updates.projectType !== oldProject.projectType) {
      return badRequest(res, 'Select a valid Project Type');
    }
    if (updates.contractBasis !== undefined && !CONTRACT_BASES.includes(updates.contractBasis)) {
      return badRequest(res, 'Select whether this project is BOQ-wise or Slab-wise');
    }
    if (updates.paymentMode !== undefined && !PAYMENT_MODES.includes(updates.paymentMode)) {
      return badRequest(res, 'Select how contractors are paid: Cash / Bank, Barter or Mixed');
    }
    const basisChanged = updates.contractBasis !== undefined && updates.contractBasis !== oldProject.contractBasis;
    const typeChanged = updates.projectType !== undefined && updates.projectType !== oldProject.projectType;
    const modeChanged = updates.paymentMode !== undefined && updates.paymentMode !== (oldProject.paymentMode || 'Cash');
    if (basisChanged || typeChanged || modeChanged) {
      const subIds = (await ConstructionProject.find({ parentProject: oldProject._id }).select('_id').lean()).map((s) => s._id);
      if (basisChanged) {
        // Cannot switch once contracts of the other kind exist under it
        const otherKind = updates.contractBasis === 'Slab' ? { $ne: 'Slab' } : 'Slab';
        const clash = await SubletContract.countDocuments({ project: { $in: subIds }, status: { $ne: 'Cancelled' }, contractType: otherKind });
        if (clash) {
          return badRequest(res, `${oldProject.name} already has ${clash} ${contractBasisLabel(updates.contractBasis === 'Slab' ? 'BOQ' : 'Slab')} contract(s) — cancel them before making it ${contractBasisLabel(updates.contractBasis)}`);
        }
      }
      if (modeChanged) {
        // Contracts already agreed under the old mode would no longer match it
        const live = await SubletContract.countDocuments({ project: { $in: subIds }, status: { $ne: 'Cancelled' } });
        if (live) {
          return badRequest(res, `${oldProject.name} already has ${live} sublet contract(s) — cancel them before changing how contractors are paid`);
        }
      }
      cascade = { subIds, set: {} };
      if (basisChanged) cascade.set.contractBasis = updates.contractBasis;
      if (modeChanged) cascade.set.paymentMode = updates.paymentMode;
      if (typeChanged) cascade.set.projectType = updates.projectType;
    }
  }

  // Main Project must keep a Finance company; once its IPCs / invoices posted to Finance it cannot move company
  const willBeMain = !(updates.parentProject !== undefined ? updates.parentProject : oldProject.parentProject);
  const nextCompany = updates.companyId !== undefined ? updates.companyId : oldProject.companyId;
  if (willBeMain && !nextCompany) {
    return badRequest(res, 'Select the Finance Company for this Main Project — its Sub Projects, contracts and IPCs post to that company');
  }
  if (!willBeMain) delete updates.companyId; // Sub Projects inherit from their Main Project
  // Store business unit lives on the Main Project only
  if (!willBeMain) delete updates.storeProject;
  else if (updates.storeProject !== undefined) {
    if (!updates.storeProject) updates.storeProject = null;
    else if (!isValidId(updates.storeProject) || !(await require('../models/hr/Project').exists({ _id: updates.storeProject }))) {
      return badRequest(res, 'Select a valid store business unit');
    }
  }
  if (willBeMain && oldProject.companyId && nextCompany && String(oldProject.companyId) !== String(nextCompany)) {
    const familyIds = [oldProject._id];
    for (let frontier = [oldProject._id], depth = 0; frontier.length && depth < 10; depth += 1) {
      const children = await ConstructionProject.find({ parentProject: { $in: frontier } }).select('_id').lean();
      frontier = children.map((c) => c._id);
      familyIds.push(...frontier);
    }
    const posted = await ProjectInvoice.countDocuments({
      project: { $in: familyIds },
      $or: [{ financeApBillId: { $ne: null } }, { financeArId: { $ne: null } }, { financePostedAt: { $ne: null } }]
    });
    if (posted) {
      return badRequest(res, `${posted} IPC(s) / invoice(s) of ${oldProject.name} already posted to the current Finance company — the company can no longer be changed`);
    }
  }

  // Sub category totals cannot exceed Main allocation
  if (oldProject.parentProject && Array.isArray(updates.budgetCategories)) {
    const catEst = updates.budgetCategories.reduce((s, c) => s + (Number(c.estimatedAmount) || 0), 0);
    const ceiling = Number(oldProject.allocatedBudget) || 0;
    if (ceiling > 0 && catEst > ceiling) {
      return badRequest(
        res,
        `Category total (${catEst}) exceeds allocated budget from Main (${ceiling})`
      );
    }
  }

  // Record when a project was completed, unless a date was given
  if (updates.status === 'Completed' && oldProject.status !== 'Completed' && updates.actualEndDate === undefined && !oldProject.actualEndDate) {
    updates.actualEndDate = new Date();
  }
  // Re-opened: it is no longer finished, so it has no completion date
  if (updates.status && updates.status !== 'Completed' && oldProject.status === 'Completed' && updates.actualEndDate === undefined) {
    updates.actualEndDate = null;
  }

  const project = await ConstructionProject.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  ).populate('projectManager', 'firstName lastName email').lean();

  if (!project) return notFound(res, 'Project');
  if (cascade && cascade.subIds.length) {
    await ConstructionProject.updateMany({ _id: { $in: cascade.subIds } }, { $set: cascade.set });
  }

  // Quick status change on a Main Project can carry its (non-cancelled) Sub Projects along
  let subsUpdated = 0;
  if (req.body.applyStatusToSubs === true && updates.status && !project.parentProject && updates.status !== 'Cancelled') {
    const subFilter = { parentProject: project._id, status: { $ne: 'Cancelled' } };
    subsUpdated = (await ConstructionProject.updateMany(subFilter, { $set: { status: updates.status, updatedBy: req.user?._id } })).modifiedCount || 0;
    if (updates.status === 'Completed') {
      await ConstructionProject.updateMany({ ...subFilter, actualEndDate: null }, { $set: { actualEndDate: new Date() } });
    }
  }

  // Trigger sync of parent project progress
  if (project.parentProject) {
    await syncParentProjectProgress(project.parentProject);
  }
  if (oldProject && oldProject.parentProject && String(oldProject.parentProject) !== String(project.parentProject)) {
    await syncParentProjectProgress(oldProject.parentProject);
    await syncProjectMetrics(oldProject.parentProject);
  }
  await syncProjectMetrics(project._id);

  res.json({
    success: true,
    message: subsUpdated ? `Project and ${subsUpdated} sub project(s) updated` : 'Project updated successfully',
    data: project
  });
}));

// PUT /api/project-management/projects/:id/budget-status — submit or approve budget
router.put('/projects/:id/budget-status', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const { action, notes } = req.body; // action: 'submit' | 'approve' | 'reset'

  const project = await ConstructionProject.findById(req.params.id);
  if (!project) return notFound(res, 'Project');

  project.updatedBy = req.user?._id;

  const isMain = !project.parentProject;
  if (isMain && action !== 'reset') {
    return badRequest(res, 'Main Project budgets go through the budget request (details + COO, AVP Taj and CEO approval)');
  }
  if (isMain && ['approve', 'reset'].includes(action) && !isDesignatedCeoApprover(req.user)) {
    return res.status(403).json({ success: false, message: 'Only the CEO can approve or reopen a Main Project budget' });
  }
  if (isMain && action === 'approve' && project.budgetStatus !== 'Submitted') {
    return badRequest(res, 'The budget must be submitted for approval first');
  }

  if (action === 'submit') {
    if (isMain && !(Number(project.lumpSumBudget) > 0)) {
      return badRequest(res, 'Set a lump-sum budget before submitting');
    }
    if (!isMain) {
      const catEst = (project.budgetCategories || []).reduce((s, c) => s + (c.estimatedAmount || 0), 0);
      const ceiling = Number(project.allocatedBudget) || 0;
      if (ceiling <= 0) {
        return badRequest(res, 'This sub project has no budget allocated from the Main Project yet');
      }
      if (catEst > ceiling) {
        return badRequest(res, `Category total (${catEst}) exceeds allocated budget (${ceiling})`);
      }
      if (catEst <= 0 && ceiling <= 0) {
        return badRequest(res, 'Enter category amounts or wait for Main allocation before submitting');
      }
    }
    project.budgetStatus = 'Submitted';
    project.budgetSubmittedAt = new Date();
  } else if (action === 'approve') {
    project.budgetStatus = 'Approved';
    project.budgetApprovedBy = req.user?._id;
    project.budgetApprovedAt = new Date();
    project.budgetNotes = notes || '';

    if (!isMain && project.budgetCategories && project.budgetCategories.length) {
      // Copy estimatedAmount to approvedAmount upon approval (category-wise Sub budget)
      project.budgetCategories.forEach(cat => {
        cat.approvedAmount = cat.estimatedAmount;
      });
    }
  } else if (action === 'reset') {
    project.budgetStatus = 'Draft';
    project.budgetApprovedBy = null;
    project.budgetApprovedAt = null;
    if (!isMain && project.budgetCategories && project.budgetCategories.length) {
      project.budgetCategories.forEach(cat => {
        cat.approvedAmount = 0;
      });
    }
  } else {
    return badRequest(res, 'Invalid action. Use submit, approve or reset');
  }

  await project.save();

  if (isMain && (action === 'submit' || action === 'approve')) {
    const ceoSide = action === 'submit';
    const recipients = ceoSide
      ? await userIdsByRoles(['higher_management', 'admin', 'super_admin'])
      : [project.createdBy, project.projectManager].filter(Boolean).map(String);
    const ids = [...new Set(recipients)].filter((rid) => rid !== String(req.user?._id || ''));
    if (ids.length) {
      try {
        await createAndEmitNotification({
          recipientIds: ids,
          title: ceoSide ? `Budget for approval: ${project.name}` : `Budget approved: ${project.name}`,
          message: ceoSide
            ? `${fmtPkr(project.lumpSumBudget)} budget submitted for CEO approval`
            : `${fmtPkr(project.lumpSumBudget)} approved — it can now be distributed to sub projects`,
          type: 'info',
          category: 'approval',
          priority: ceoSide ? 'high' : 'medium',
          actionUrl: `/general/project-management/${project._id}?tab=budget`,
          entityId: project._id,
          entityType: 'ConstructionProject',
          module: 'project_management'
        });
      } catch (err) {
        console.error('Budget notification failed:', err.message);
      }
    }
  }

  const populated = await ConstructionProject.findById(project._id)
    .populate('projectManager', 'firstName lastName email')
    .populate('parentProject', 'name projectNumber isMasterProject projectType status lumpSumBudget')
    .lean();

  if (!populated.parentProject) {
    populated.budgetAllocation = await buildBudgetAllocationSummary(populated);
  }

  const done = { submit: 'Budget submitted to the CEO', approve: 'Budget approved', reset: 'Budget reopened' }[action];
  res.json({ success: true, message: done, data: populated });
}));

// ─── MAIN PROJECT BUDGET REQUEST (details + approval chain) ───────────────────

/** Default approval chain, in order; people are found by their designation and can be changed before sending */
const DEFAULT_BUDGET_APPROVERS = [
  // "COO" as a whole word, so "COO & GM Procurement" matches but "Coordinator" does not
  { role: 'Chief Operating Officer', match: /chief operating officer|\bcoo\b/i },
  { role: 'AVP Taj', match: /^assistant vice president$|^avp$|avp.*taj|assistant vice president.*taj/i },
  { role: 'Chief Executive Officer', match: /^ceo$|chief executive/i }
];
const personName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

const suggestBudgetApprovers = async () => {
  const people = await User.find({ isActive: true, position: { $exists: true, $ne: '' } })
    .select('firstName lastName position role').lean();
  return DEFAULT_BUDGET_APPROVERS.map((d) => {
    const u = people.find((p) => d.match.test(String(p.position || '').trim()));
    return { role: d.role, user: u ? String(u._id) : '', name: personName(u), designation: u?.position || '' };
  });
};

/** People who can be picked as budget approvers: management by role or designation */
const budgetApproverCandidates = async () => {
  const users = await User.find({
    isActive: true,
    $or: [
      { role: { $in: ['super_admin', 'higher_management'] } },
      { position: /president|chief|director|ceo|coo|cfo|head/i }
    ]
  }).select('firstName lastName position role').sort({ firstName: 1 }).lean();
  return users.map((u) => ({ _id: String(u._id), name: personName(u), designation: u.position || '' }));
};

/** A draft shows the revision number it will get when sent */
const budgetDocNo = (p) => `BUD-${p.projectNumber || String(p._id).slice(-6).toUpperCase()}-R${(p.budgetRequest?.revision || 0) + (p.budgetStatus === 'Draft' || !p.budgetStatus ? 1 : 0)}`;

/** Budget request view: the request, the Sub Projects it can split into (with what each has in contracts) and who may act */
const buildBudgetRequestView = async (project, user) => {
  const subs = await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } })
    .select('name projectNumber sector street allocatedBudget utilizedBudget status').sort({ name: 1 }).lean();
  const committed = await committedBySub(subs.map((s) => s._id));
  const req = project.budgetRequest || null;
  const sumOf = (lines, key) => round2((lines || []).reduce((t, l) => t + (Number(l[key]) || 0), 0));
  const current = req && project.budgetStatus === 'Submitted' ? req.approvers?.[req.currentStep] : null;
  // Letterhead for the budget document: the Main Project's Finance company
  const company = project.companyId
    ? await mongoose.model('PlacementCompany').findById(project.companyId).select('name contactInfo').lean().catch(() => null)
    : null;
  return {
    company,
    project: {
      _id: project._id, name: project.name, projectNumber: project.projectNumber, projectType: project.projectType,
      contractBasis: project.contractBasis, society: project.society, sector: project.sector, address: project.address,
      startDate: project.startDate, expectedEndDate: project.expectedEndDate, clientName: project.clientName
    },
    status: project.budgetStatus || 'Draft',
    // Total of the request being prepared / in approval; `approved` is the budget in force
    amount: req?.lines?.length ? sumOf(req.lines, 'amount') : Number(project.lumpSumBudget) || 0,
    // Ongoing projects: already utilized before the ERP; total budget = utilized + remaining (amount)
    utilizedAmount: req?.lines?.length ? sumOf(req.lines, 'utilized') : Number(project.approvedBudget?.utilized) || 0,
    approvedAt: project.budgetApprovedAt || null,
    documentNo: budgetDocNo(project),
    request: req,
    approved: project.approvedBudget?.amount > 0 ? project.approvedBudget : null,
    approvedAmount: approvedBudgetAmount(project),
    approvedUtilized: Number(project.approvedBudget?.utilized) || 0,
    approvedDocumentNo: project.approvedBudget?.revision
      ? `BUD-${project.projectNumber || String(project._id).slice(-6).toUpperCase()}-R${project.approvedBudget.revision}` : null,
    suggestedApprovers: req?.approvers?.length ? null : await suggestBudgetApprovers(),
    subProjects: subs.map((s) => ({
      _id: s._id, name: s.name, projectNumber: s.projectNumber, sector: s.sector, status: s.status,
      allocatedBudget: Number(s.allocatedBudget) || 0,
      utilizedBudget: Number(s.utilizedBudget) || 0,
      committed: committed.get(String(s._id))?.amount || 0,
      contracts: committed.get(String(s._id))?.contracts || 0
    })),
    // Sub Projects with no share in the budget in force (e.g. created after it was approved)
    newSubProjects: approvedBudgetAmount(project) > 0
      ? subs.filter((s) => !(Number(s.allocatedBudget) > 0) && s.status !== 'Completed').map((s) => ({ _id: s._id, name: s.name }))
      : [],
    canApprove: Boolean(current && user && String(current.user) === String(user._id)),
    currentApprover: current ? { name: current.name, role: current.role } : null
  };
};

const notifyBudget = async (recipientIds, actorId, title, message, project) => {
  const ids = [...new Set((recipientIds || []).filter(Boolean).map(String))].filter((rid) => rid !== String(actorId || ''));
  if (!ids.length) return;
  try {
    await createAndEmitNotification({
      recipientIds: ids, title, message, type: 'info', category: 'approval', priority: 'high',
      actionUrl: `/budget-approvals?project=${project._id}`,
      entityId: project._id, entityType: 'ConstructionProject', module: 'project_management'
    });
  } catch (err) {
    console.error('Budget notification failed:', err.message);
  }
};

const loadMainForBudget = async (req, res) => {
  if (!isValidId(req.params.id)) { badRequest(res, 'Invalid project ID'); return null; }
  const project = await ConstructionProject.findById(req.params.id);
  if (!project) { notFound(res, 'Project'); return null; }
  if (project.parentProject) { badRequest(res, 'Budgets are requested on the Main Project'); return null; }
  return project;
};

// GET /api/project-management/projects/:id/budget-request
router.get('/projects/:id/budget-request', asyncHandler(async (req, res) => {
  const project = await loadMainForBudget(req, res); if (!project) return;
  const view = await buildBudgetRequestView(project.toObject(), req.user);
  view.candidates = await budgetApproverCandidates();
  res.json({ success: true, data: view });
}));

// PUT /api/project-management/projects/:id/budget-request — save the draft (purpose, split per Sub Project, approvers)
router.put('/projects/:id/budget-request', asyncHandler(async (req, res) => {
  const project = await loadMainForBudget(req, res); if (!project) return;
  if (project.budgetStatus === 'Submitted') return badRequest(res, 'The budget is with the approvers — it cannot be changed until they approve or return it');

  const subs = await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } }).select('name').lean();
  const subById = new Map(subs.map((s) => [String(s._id), s]));
  const lines = (Array.isArray(req.body.lines) ? req.body.lines : [])
    .filter((l) => subById.has(String(l.subProject)))
    .map((l) => ({
      subProject: l.subProject, name: subById.get(String(l.subProject)).name, scope: String(l.scope || '').trim(),
      utilized: Math.max(0, round2(l.utilized)), amount: Math.max(0, round2(l.amount))
    }));
  const approvers = [];
  for (const a of Array.isArray(req.body.approvers) ? req.body.approvers : []) {
    if (!a.user || !isValidId(a.user)) continue;
    const u = await User.findById(a.user).select('firstName lastName position').lean();
    if (u) approvers.push({ role: String(a.role || u.position || 'Approver').trim(), user: u._id, name: personName(u), designation: u.position || '' });
  }

  const wasApproved = project.budgetStatus === 'Approved';
  const prev = project.budgetRequest ? project.budgetRequest.toObject() : {};
  project.budgetRequest = {
    ...prev,
    purpose: String(req.body.purpose || '').trim(),
    notes: String(req.body.notes || '').trim(),
    lines,
    approvers,
    currentStep: -1,
    preparedBy: req.user?._id || prev.preparedBy || null,
    preparedByName: personName(req.user) || prev.preparedByName || ''
  };
  if (wasApproved) {
    // Revising: the approved budget stays in force (existing shares keep working) until the revision is approved
    project.budgetStatus = 'Draft';
    project.budgetRequest.history = [...(prev.history || []), { action: 'Revision started', name: personName(req.user), at: new Date() }];
  }
  project.updatedBy = req.user?._id;
  await project.save();
  const inForce = approvedBudgetAmount(project) > 0;
  res.json({
    success: true,
    message: wasApproved || (inForce && project.budgetStatus === 'Draft')
      ? 'Revision saved — the approved budget stays in force until the revision is approved'
      : 'Budget draft saved',
    data: await buildBudgetRequestView(project.toObject(), req.user)
  });
}));

// POST /api/project-management/projects/:id/budget-request/submit — send to the first approver
router.post('/projects/:id/budget-request/submit', asyncHandler(async (req, res) => {
  const project = await loadMainForBudget(req, res); if (!project) return;
  if (project.budgetStatus === 'Submitted') return badRequest(res, 'The budget is already with the approvers');
  const br = project.budgetRequest;
  if (!br) return badRequest(res, 'Fill in the budget details first');
  if (String(br.purpose || '').trim().length < 10) return badRequest(res, 'Describe what the budget is for (purpose and scope)');
  const total = round2((br.lines || []).reduce((t, l) => t + (Number(l.amount) || 0), 0));
  if (total <= 0) return badRequest(res, 'Enter the budget for at least one sub project');
  if (!br.approvers?.length) return badRequest(res, 'Choose who approves the budget');
  const userIds = br.approvers.map((a) => String(a.user));
  if (new Set(userIds).size !== userIds.length) return badRequest(res, 'The same person is listed twice as an approver');

  // A Sub Project's new budget cannot be below what it already has in contracts
  const subs = await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } }).select('name').lean();
  const committed = await committedBySub(subs.map((s) => s._id));
  for (const s of subs) {
    const used = committed.get(String(s._id))?.amount || 0;
    const line = br.lines.find((l) => String(l.subProject) === String(s._id));
    if (used > 0 && (Number(line?.amount) || 0) + 0.5 < used) {
      return badRequest(res, `${s.name} already has ${fmtPkr(used)} in sublet contracts — its budget cannot be less than that`);
    }
  }

  // lumpSumBudget / approval stamps stay those of the budget in force until this one is approved
  project.budgetStatus = 'Submitted';
  project.budgetSubmittedAt = new Date();
  br.approvers.forEach((a) => { a.status = 'Pending'; a.remarks = ''; a.signature = ''; a.actedAt = undefined; a.changes = []; });
  br.submittedLines = br.lines.map((l) => ({ subProject: l.subProject, amount: Number(l.amount) || 0, utilized: Number(l.utilized) || 0 }));
  br.currentStep = 0;
  br.revision = (br.revision || 0) + 1;
  br.submittedAt = new Date();
  br.returned = undefined;
  br.history.push({ action: `Submitted for approval (revision ${br.revision})`, name: personName(req.user), at: new Date() });
  project.updatedBy = req.user?._id;
  await project.save();

  const utilizedTotal = round2((br.lines || []).reduce((t, l) => t + (Number(l.utilized) || 0), 0));
  await notifyBudget([br.approvers[0].user], req.user?._id, `Budget for your approval: ${project.name}`,
    `${fmtPkr(total + utilizedTotal)} budget for ${project.name}${utilizedTotal > 0 ? ` (${fmtPkr(utilizedTotal)} already utilized + ${fmtPkr(total)} remaining)` : ''} is waiting for your approval`, project);
  res.json({ success: true, message: `Sent to ${br.approvers[0].name} (${br.approvers[0].role})`, data: await buildBudgetRequestView(project.toObject(), req.user) });
}));

/** The approver whose turn it is must be the signed-in user */
const currentBudgetApprover = (project, user) => {
  const br = project.budgetRequest;
  if (project.budgetStatus !== 'Submitted' || !br) return { error: 'This budget is not waiting for approval' };
  const step = br.approvers[br.currentStep];
  if (!step) return { error: 'This budget is not waiting for approval' };
  if (!user || String(step.user) !== String(user._id)) return { error: `It is ${step.name}'s turn (${step.role}) to approve this budget`, forbidden: true };
  return { step };
};

// POST /api/project-management/projects/:id/budget-request/approve
router.post('/projects/:id/budget-request/approve', asyncHandler(async (req, res) => {
  const project = await loadMainForBudget(req, res); if (!project) return;
  const { step, error, forbidden } = currentBudgetApprover(project, req.user);
  if (error) return res.status(forbidden ? 403 : 400).json({ success: false, message: error });
  const br = project.budgetRequest;
  const remarks = String(req.body.remarks || '').trim();

  // The approver may cut or add amounts; the next approver sees the changed figures
  const changes = [];
  if (Array.isArray(req.body.lines)) {
    const committed = await committedBySub(br.lines.map((l) => l.subProject));
    for (const row of req.body.lines) {
      const line = br.lines.find((l) => String(l.subProject) === String(row.subProject));
      if (!line) continue;
      const to = Math.max(0, round2(row.amount));
      const from = Number(line.amount) || 0;
      if (Math.abs(to - from) < 0.005) continue;
      const used = committed.get(String(line.subProject))?.amount || 0;
      if (to + 0.5 < used) return badRequest(res, `${line.name} already has ${fmtPkr(used)} in sublet contracts — its budget cannot be less than that`);
      changes.push({ subProject: line.subProject, name: line.name, from, to });
    }
    if (changes.length && remarks.length < 3) return badRequest(res, 'Write why the amounts were changed');
    const newTotal = round2(br.lines.reduce((t, l) => {
      const c = changes.find((x) => String(x.subProject) === String(l.subProject));
      return t + (c ? c.to : Number(l.amount) || 0);
    }, 0));
    if (newTotal <= 0) return badRequest(res, 'The budget cannot be zero — return it instead');
    changes.forEach((c) => { br.lines.find((l) => String(l.subProject) === String(c.subProject)).amount = c.to; });
  }

  const me = await User.findById(req.user._id).select('digitalSignature').lean();
  step.status = 'Approved';
  step.changes = changes;
  step.remarks = remarks;
  step.signature = me?.digitalSignature || '';
  step.actedAt = new Date();
  const changeText = changes.map((c) => `${c.name} ${fmtPkr(c.from)} → ${fmtPkr(c.to)}`).join('; ');
  br.history.push({ action: `Approved by ${step.role}${changes.length ? ' with changes' : ''}`, name: step.name, remarks: [changeText, step.remarks].filter(Boolean).join(' — '), at: new Date() });

  const last = br.currentStep >= br.approvers.length - 1;
  if (!last) {
    br.currentStep += 1;
    project.updatedBy = req.user._id;
    await project.save();
    const next = br.approvers[br.currentStep];
    await notifyBudget([next.user], req.user._id, `Budget for your approval: ${project.name}`,
      `${fmtPkr(br.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0))} budget for ${project.name}, approved by ${step.name}${changes.length ? ` with changes (${changeText})` : ''} — now waiting for you`, project);
    return res.json({ success: true, message: `Approved${changes.length ? ' with your changes' : ''} — sent on to ${next.name} (${next.role})`, data: await buildBudgetRequestView(project.toObject(), req.user) });
  }

  // Final approval: this version is now the budget in force and each line becomes that Sub Project's budget
  br.currentStep = -1;
  const total = round2(br.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0));
  const utilizedTotal = round2(br.lines.reduce((t, l) => t + (Number(l.utilized) || 0), 0));
  project.lumpSumBudget = total;
  project.approvedBudget = {
    amount: total,
    utilized: utilizedTotal,
    revision: br.revision,
    approvedAt: new Date(),
    submittedAt: br.submittedAt,
    purpose: br.purpose,
    notes: br.notes,
    preparedByName: br.preparedByName,
    lines: br.lines.map((l) => ({
      subProject: l.subProject, name: l.name, scope: l.scope, utilized: Number(l.utilized) || 0, amount: l.amount,
      requested: (br.submittedLines || []).find((x) => String(x.subProject) === String(l.subProject))?.amount ?? l.amount
    })),
    approvers: br.approvers.map((a) => ({
      role: a.role, user: a.user, name: a.name, designation: a.designation, status: a.status, remarks: a.remarks, signature: a.signature, actedAt: a.actedAt,
      changes: (a.changes || []).map((c) => ({ subProject: c.subProject, name: c.name, from: c.from, to: c.to }))
    }))
  };
  project.budgetStatus = 'Approved';
  project.budgetApprovedBy = req.user._id;
  project.budgetApprovedAt = new Date();
  project.budgetNotes = step.remarks;
  project.updatedBy = req.user._id;
  await project.save();
  const amounts = new Map(br.lines.map((l) => [String(l.subProject), Number(l.amount) || 0]));
  const utilizedBySub = new Map(br.lines.map((l) => [String(l.subProject), Number(l.utilized) || 0]));
  const subs = await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } });
  for (const sub of subs) {
    const amount = amounts.get(String(sub._id)) || 0;
    const utilized = utilizedBySub.get(String(sub._id)) || 0;
    if ((Number(sub.allocatedBudget) || 0) === amount && (Number(sub.utilizedBudget) || 0) === utilized) continue;
    sub.allocatedBudget = amount;
    sub.utilizedBudget = utilized;
    sub.updatedBy = req.user._id;
    await sub.save();
  }
  await notifyBudget([br.preparedBy, project.createdBy, project.projectManager], req.user._id, `Budget approved: ${project.name}`,
    `${fmtPkr(project.lumpSumBudget + utilizedTotal)}${utilizedTotal > 0 ? ` (${fmtPkr(utilizedTotal)} already utilized + ${fmtPkr(project.lumpSumBudget)} remaining)` : ''} approved by ${br.approvers.map((a) => a.role).join(', ')} — sub projects can now make contracts within their share`, project);
  res.json({ success: true, message: 'Budget approved — each sub project now has its share', data: await buildBudgetRequestView(project.toObject(), req.user) });
}));

// POST /api/project-management/projects/:id/budget-request/return — the current approver sends it back with remarks
router.post('/projects/:id/budget-request/return', asyncHandler(async (req, res) => {
  const project = await loadMainForBudget(req, res); if (!project) return;
  const { step, error, forbidden } = currentBudgetApprover(project, req.user);
  if (error) return res.status(forbidden ? 403 : 400).json({ success: false, message: error });
  const remarks = String(req.body.remarks || '').trim();
  if (remarks.length < 3) return badRequest(res, 'Write why the budget is being returned');
  const br = project.budgetRequest;
  step.status = 'Rejected';
  step.remarks = remarks;
  step.actedAt = new Date();
  br.returned = { name: step.name, role: step.role, remarks, at: new Date() };
  br.currentStep = -1;
  br.history.push({ action: `Returned by ${step.role}`, name: step.name, remarks, at: new Date() });
  project.budgetStatus = 'Draft';
  project.updatedBy = req.user._id;
  await project.save();
  await notifyBudget([br.preparedBy, project.createdBy, project.projectManager], req.user._id, `Budget returned: ${project.name}`,
    `${step.name} (${step.role}) returned the budget: ${remarks}`, project);
  res.json({ success: true, message: 'Budget returned to the project team', data: await buildBudgetRequestView(project.toObject(), req.user) });
}));

// POST /api/project-management/projects/:id/budget-request/discard — drop a revision, back to the budget in force
router.post('/projects/:id/budget-request/discard', asyncHandler(async (req, res) => {
  const project = await loadMainForBudget(req, res); if (!project) return;
  const ab = project.approvedBudget;
  if (!(ab?.amount > 0)) return badRequest(res, 'There is no approved budget to go back to');
  if (project.budgetStatus === 'Submitted') return badRequest(res, 'The revision is with the approvers — it can be returned by the approver whose turn it is');
  if (project.budgetStatus === 'Approved') return badRequest(res, 'There is no revision to discard');
  const br = project.budgetRequest;
  br.purpose = ab.purpose;
  br.notes = ab.notes;
  br.lines = ab.lines.map((l) => ({ subProject: l.subProject, name: l.name, scope: l.scope, utilized: Number(l.utilized) || 0, amount: l.amount }));
  br.approvers = ab.approvers.filter((a) => a.user).map((a) => ({ ...a }));
  br.revision = ab.revision;
  br.currentStep = -1;
  br.returned = undefined;
  br.history.push({ action: 'Revision discarded', name: personName(req.user), at: new Date() });
  project.budgetStatus = 'Approved';
  project.updatedBy = req.user?._id;
  await project.save();
  res.json({ success: true, message: 'Revision discarded — the approved budget is unchanged', data: await buildBudgetRequestView(project.toObject(), req.user) });
}));

// GET /api/project-management/budget-approvals — budgets waiting for me, and ones I acted on recently
router.get('/budget-approvals', asyncHandler(async (req, res) => {
  const me = String(req.user?._id || '');
  const mains = await ConstructionProject.find({ parentProject: null, 'budgetRequest.approvers.user': req.user?._id })
    .select('name projectNumber projectType contractBasis society sector lumpSumBudget budgetStatus budgetSubmittedAt budgetApprovedAt budgetRequest')
    .sort({ budgetSubmittedAt: -1 }).lean();
  const rows = mains.map((p) => {
    const br = p.budgetRequest || {};
    const current = p.budgetStatus === 'Submitted' ? br.approvers?.[br.currentStep] : null;
    const mine = (br.approvers || []).find((a) => String(a.user) === me);
    return {
      _id: p._id, name: p.name, projectNumber: p.projectNumber, projectType: p.projectType, contractBasis: p.contractBasis,
      location: [p.society, p.sector].filter(Boolean).join(', '),
      amount: (br.lines || []).reduce((t, l) => t + (Number(l.amount) || 0), 0) || Number(p.lumpSumBudget) || 0,
      utilized: (br.lines || []).reduce((t, l) => t + (Number(l.utilized) || 0), 0),
      status: p.budgetStatus, submittedAt: br.submittedAt || p.budgetSubmittedAt,
      revision: br.revision || 0, documentNo: budgetDocNo(p),
      waitingForMe: Boolean(current && String(current.user) === me),
      waitingFor: current ? `${current.name} (${current.role})` : null,
      myStatus: mine?.status || null, myActedAt: mine?.actedAt || null
    };
  });
  res.json({ success: true, data: { waiting: rows.filter((r) => r.waitingForMe), others: rows.filter((r) => !r.waitingForMe) } });
}));

// PUT /api/project-management/projects/:id/milestones/:milestoneId — update milestone
// ─── Units (villas) of a Sub Project ───────────────────────────────────────────

const cleanUnit = (raw = {}) => ({
  name: String(raw.name || '').trim(),
  plotNumber: String(raw.plotNumber || '').trim(),
  street: String(raw.street || '').trim(),
  side: ['Left', 'Right'].includes(raw.side) ? raw.side : '',
  notes: String(raw.notes || '').trim()
});

const unitNameKey = (name) => String(name || '').trim().toLowerCase();

/** Loads a Sub Project for unit edits, or sends the error response and returns null */
const loadSubForUnits = async (req, res) => {
  if (!isValidId(req.params.id)) { badRequest(res, 'Invalid project ID'); return null; }
  const project = await ConstructionProject.findById(req.params.id);
  if (!project) { notFound(res, 'Project'); return null; }
  if (!project.parentProject) { badRequest(res, `${unitNames(project)[1]} are added on Sub Projects only`); return null; }
  return project;
};

// GET /api/project-management/projects/:id/units
router.get('/projects/:id/units', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('units').lean();
  if (!project) return notFound(res, 'Project');
  res.json({ success: true, data: project.units || [] });
}));

// POST /api/project-management/projects/:id/units — body { units: [{ name, plotNumber, street, side, notes }] }
router.post('/projects/:id/units', asyncHandler(async (req, res) => {
  const project = await loadSubForUnits(req, res);
  if (!project) return;

  const incoming = (Array.isArray(req.body.units) ? req.body.units : [req.body]).map(cleanUnit);
  if (!incoming.length) return badRequest(res, `Add at least one ${unitLabel(project)}`);
  if (incoming.some((u) => !u.name)) return badRequest(res, `Every ${unitLabel(project)} needs a name`);

  const taken = new Set((project.units || []).map((u) => unitNameKey(u.name)));
  for (const u of incoming) {
    const key = unitNameKey(u.name);
    if (taken.has(key)) return badRequest(res, `"${u.name}" is already in this Sub Project`);
    taken.add(key);
  }

  project.units.push(...incoming);
  project.updatedBy = req.user?._id;
  await project.save();
  res.status(201).json({ success: true, message: `${incoming.length} added`, data: project.units });
}));

/**
 * Villa-by-stage progress of a Sub Project. Columns are the stages (slabs) of its slab-wise
 * contracts; each cell is the state of that stage's claim for that villa. A villa's progress is
 * the value of its verified work over the value of the contracts covering it (each contract's
 * value is split equally across its villas; a contract without villas covers all of them).
 */
const DONE_CR = ['Verified', 'Billed'];
router.get('/projects/:id/units/progress', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('name units projectType').lean();
  if (!project) return notFound(res, 'Project');
  const units = project.units || [];
  const [unitName, unitNamePlural] = unitNames(project);
  if (!units.length) return res.json({ success: true, data: { unitName, unitNamePlural, units: [], columns: [], summary: { units: 0, complete: 0, started: 0, progress: 0 } } });

  const [contracts, crs] = await Promise.all([
    // A cancelled contract counts only for the work done on it, on the villas it was done for
    SubletContract.find({ project: project._id, $or: [{ status: { $ne: 'Cancelled' } }, { 'cancellation.workDone.amount': { $gt: 0 } }] })
      .select('contractNumber contractType contractor units slabs totalAmount status cancellation').populate('contractor', 'name').sort({ createdAt: 1 }).lean(),
    CheckRequest.find({ project: project._id, status: { $ne: 'Cancelled' } })
      .select('checkRequestNumber claimType subletContract slab units status verifiedTotal claimedTotal contractor').lean()
  ]);

  const allIds = units.map((u) => String(u._id));
  const coveredBy = (list) => (list?.length ? list.map((u) => String(u.unit)) : allIds);
  const row = new Map(units.map((u) => [String(u._id), {
    _id: u._id, name: u.name, plotNumber: u.plotNumber || '', value: 0, done: 0, boqVerified: 0, cells: {}
  }]));

  const columns = [];
  const contractById = new Map();
  contracts.forEach((c) => {
    const covered = coveredBy(c.units).filter((id) => row.has(id));
    if (c.status === 'Cancelled') {
      const done = c.cancellation?.workDone || {};
      const slabCovered = new Map();
      if (c.contractType === 'Slab') {
        (done.slabs || []).forEach((ds) => {
          const ids = (ds.units?.length ? ds.units.map((u) => String(u.unit)) : covered).filter((id) => row.has(id));
          if (!ids.length) return;
          slabCovered.set(String(ds.slabId), { ids, amount: Number(ds.amount) || 0 });
          ids.forEach((id) => { row.get(id).value += (Number(ds.amount) || 0) / ids.length; });
          const sl = (c.slabs || []).find((x) => String(x._id) === String(ds.slabId));
          const key = `${c._id}:${ds.slabId}`;
          columns.push({
            key, contract: c._id, contractNumber: c.contractNumber, contractor: `${c.contractor?.name || ''} (cancelled)`,
            slab: sl?.name || ds.name, percentage: sl?.percentage ?? ds.percentage, cancelled: true
          });
          ids.forEach((id) => { row.get(id).cells[key] = { status: 'Not claimed' }; });
        });
      } else if (covered.length) {
        covered.forEach((id) => { row.get(id).value += (Number(done.amount) || 0) / covered.length; });
      }
      contractById.set(String(c._id), { contract: c, covered, slabCovered });
      return;
    }
    contractById.set(String(c._id), { contract: c, covered });
    if (!covered.length) return;
    const share = (Number(c.totalAmount) || 0) / covered.length;
    covered.forEach((id) => { row.get(id).value += share; });
    if (c.contractType !== 'Slab') return;
    (c.slabs || []).forEach((sl) => {
      const key = `${c._id}:${sl._id}`;
      columns.push({
        key, contract: c._id, contractNumber: c.contractNumber, contractor: c.contractor?.name || '',
        slab: sl.name, percentage: sl.percentage
      });
      covered.forEach((id) => { row.get(id).cells[key] = { status: 'Not claimed' }; });
    });
  });

  crs.forEach((cr) => {
    if (cr.claimType === 'Slab') {
      const hit = contractById.get(String(cr.subletContract));
      if (!hit) return;
      const key = `${cr.subletContract}:${cr.slab?.slabId}`;
      const slab = (hit.contract.slabs || []).find((sl) => String(sl._id) === String(cr.slab?.slabId));
      // Cancelled contract: only its done slabs (on the villas done) are in the grid
      const doneSlab = hit.slabCovered?.get(String(cr.slab?.slabId));
      if (hit.slabCovered && !doneSlab) return;
      const scope = doneSlab ? doneSlab.ids : hit.covered;
      const perUnit = doneSlab ? doneSlab.amount / (doneSlab.ids.length || 1) : (Number(slab?.amount) || 0) / (hit.covered.length || 1);
      coveredBy(cr.units).filter((id) => scope.includes(id)).forEach((id) => {
        const r = row.get(id);
        r.cells[key] = { status: cr.status, checkRequestNumber: cr.checkRequestNumber };
        if (DONE_CR.includes(cr.status)) r.done += perUnit;
      });
    } else if (DONE_CR.includes(cr.status) && cr.units?.length) {
      const share = (Number(cr.verifiedTotal) || 0) / cr.units.length;
      cr.units.forEach((u) => {
        const r = row.get(String(u.unit));
        if (r) { r.done += share; r.boqVerified += share; }
      });
    }
  });

  const out = [...row.values()].map((r) => ({
    ...r,
    value: round2(r.value),
    done: round2(r.done),
    boqVerified: round2(r.boqVerified),
    progress: r.value > 0 ? Math.min(100, Math.round((r.done / r.value) * 100)) : 0
  }));
  const totalValue = out.reduce((s, r) => s + r.value, 0);
  res.json({
    success: true,
    data: {
      unitName,
      unitNamePlural,
      units: out,
      columns,
      summary: {
        units: out.length,
        complete: out.filter((r) => r.value > 0 && r.progress >= 100).length,
        started: out.filter((r) => r.done > 0).length,
        progress: totalValue > 0 ? Math.min(100, Math.round((out.reduce((s, r) => s + r.done, 0) / totalValue) * 100)) : 0
      }
    }
  });
}));

// PUT /api/project-management/projects/:id/units/:unitId
router.put('/projects/:id/units/:unitId', asyncHandler(async (req, res) => {
  const project = await loadSubForUnits(req, res);
  if (!project) return;
  const unit = project.units.id(req.params.unitId);
  if (!unit) return notFound(res, unitNames(project)[0]);

  const next = cleanUnit({ ...unit.toObject(), ...req.body });
  if (!next.name) return badRequest(res, 'Name is required');
  const clash = project.units.find((u) => String(u._id) !== String(unit._id) && unitNameKey(u.name) === unitNameKey(next.name));
  if (clash) return badRequest(res, `"${next.name}" is already in this Sub Project`);

  unit.set(next);
  project.updatedBy = req.user?._id;
  await project.save();
  await SubletContract.updateMany(
    { project: project._id, 'units.unit': unit._id },
    { $set: { 'units.$[u].name': unit.name } },
    { arrayFilters: [{ 'u.unit': unit._id }] }
  );
  res.json({ success: true, message: 'Updated', data: project.units });
}));

// DELETE /api/project-management/projects/:id/units/:unitId
router.delete('/projects/:id/units/:unitId', asyncHandler(async (req, res) => {
  const project = await loadSubForUnits(req, res);
  if (!project) return;
  const unit = project.units.id(req.params.unitId);
  if (!unit) return notFound(res, unitNames(project)[0]);

  const usedBy = await SubletContract.findOne({ project: project._id, 'units.unit': unit._id, status: { $ne: 'Cancelled' } })
    .select('contractNumber').lean();
  if (usedBy) return badRequest(res, `${unit.name} is covered by sublet contract ${usedBy.contractNumber} — remove it from that contract first`);

  unit.deleteOne();
  project.updatedBy = req.user?._id;
  await project.save();
  res.json({ success: true, message: 'Removed', data: project.units });
}));

router.put('/projects/:id/milestones/:milestoneId',asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id);
  if (!project) return notFound(res, 'Project');

  const ms = project.milestones.id(req.params.milestoneId);
  if (!ms) return notFound(res, 'Milestone');

  const allowed = ['title', 'description', 'plannedDate', 'actualDate', 'status', 'completionPercentage', 'billingTrigger', 'billingPercentage', 'notes'];
  allowed.forEach(k => { if (req.body[k] !== undefined) ms[k] = req.body[k]; });
  project.updatedBy = req.user?._id;
  await project.save();

  res.json({ success: true, message: 'Milestone updated', data: project });
}));

// POST /api/project-management/projects/:id/milestones — add milestone
router.post('/projects/:id/milestones', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id);
  if (!project) return notFound(res, 'Project');

  const { title, description, plannedDate, billingTrigger, billingPercentage, notes } = req.body;
  if (!title) return badRequest(res, 'Milestone title is required');

  project.milestones.push({ title, description, plannedDate, billingTrigger, billingPercentage, notes });
  project.updatedBy = req.user?._id;
  await project.save();

  res.status(201).json({ success: true, message: 'Milestone added', data: project });
}));

// DELETE /api/project-management/projects/:id/milestones/:milestoneId
router.delete('/projects/:id/milestones/:milestoneId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id);
  if (!project) return notFound(res, 'Project');

  project.milestones = project.milestones.filter(m => m._id.toString() !== req.params.milestoneId);
  await project.save();

  res.json({ success: true, message: 'Milestone removed' });
}));

// DELETE /api/project-management/projects/:id — soft-delete (cancel)
router.delete('/projects/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'Cancelled', updatedBy: req.user?._id } },
    { new: true }
  );
  if (!project) return notFound(res, 'Project');

  if (project.parentProject) {
    await syncParentProjectProgress(project.parentProject);
  }

  res.json({ success: true, message: 'Project cancelled successfully' });
}));

// ─── Developer-only permanent delete (project + every Sub Project + all their records) ──

const requireDeveloper = (req, res) => {
  if (req.user?.role === 'developer') return true;
  res.status(403).json({ success: false, message: 'Only a developer can permanently delete projects' });
  return false;
};

/** The project plus all descendant Sub Projects (any depth). */
const collectProjectTree = async (rootId) => {
  const ids = [new mongoose.Types.ObjectId(rootId)];
  for (let frontier = [...ids]; frontier.length;) {
    const children = await ConstructionProject.find({ parentProject: { $in: frontier } }).select('_id').lean();
    frontier = children.map((c) => c._id).filter((id) => !ids.some((x) => x.equals(id)));
    ids.push(...frontier);
  }
  return ids;
};

const PROJECT_CHILD_MODELS = [
  ['boqItems', BOQItem],
  ['boqHeaders', ProjectBOQ],
  ['subletContracts', SubletContract],
  ['checkRequests', CheckRequest],
  ['inspectionReports', InspectionReport],
  ['invoices', ProjectInvoice],
  ['expenses', ProjectExpense],
  // Daily reports were retired; old ones are still removed with their project
  ['dailyReports', DailyProgressReport],
  ['wbsRows', ProjectTask]
];

const countProjectDeleteImpact = async (ids) => {
  const counts = { subProjects: ids.length - 1 };
  await Promise.all(PROJECT_CHILD_MODELS.map(async ([key, Model]) => {
    counts[key] = await Model.countDocuments({ project: { $in: ids } });
  }));
  return counts;
};

// GET /api/project-management/projects/:id/delete-impact — what a permanent delete would remove
router.get('/projects/:id/delete-impact', asyncHandler(async (req, res) => {
  if (!requireDeveloper(req, res)) return;
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('name projectNumber parentProject').lean();
  if (!project) return notFound(res, 'Project');

  const ids = await collectProjectTree(project._id);
  res.json({ success: true, data: { project, counts: await countProjectDeleteImpact(ids) } });
}));

// DELETE /api/project-management/projects/:id/permanent — developer only, cannot be undone
router.delete('/projects/:id/permanent', asyncHandler(async (req, res) => {
  if (!requireDeveloper(req, res)) return;
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('name projectNumber parentProject').lean();
  if (!project) return notFound(res, 'Project');

  // Guard against deleting the wrong record: the client must echo the project number (or name if it has none)
  const expected = String(project.projectNumber || project.name || '').trim();
  if (!expected || String(req.body?.confirmText || '').trim() !== expected) {
    return badRequest(res, `Type "${expected}" exactly to confirm deletion`);
  }

  const ids = await collectProjectTree(project._id);
  const counts = await countProjectDeleteImpact(ids);

  for (const [, Model] of PROJECT_CHILD_MODELS) {
    await Model.deleteMany({ project: { $in: ids } });
  }
  // BOQ lines of surviving (parent) projects may be allocated to the deleted Sub Projects
  await BOQItem.updateMany(
    { 'allocations.subProject': { $in: ids } },
    { $pull: { allocations: { subProject: { $in: ids } } } }
  );
  await BOQItem.updateMany({ subProject: { $in: ids } }, { $set: { subProject: null } });
  await ConstructionProject.deleteMany({ _id: { $in: ids } });

  if (project.parentProject) {
    await syncParentProjectProgress(project.parentProject);
  }

  console.log(`[project-management] Developer ${req.user?._id} permanently deleted project ${project.projectNumber} (${project.name}) with`, counts);
  res.json({
    success: true,
    message: `${project.projectNumber} — ${project.name} permanently deleted${counts.subProjects ? ` with ${counts.subProjects} Sub Project(s)` : ''}`,
    data: counts
  });
}));

// ─── BOQ ─────────────────────────────────────────────────────────────────────

const boqEst = (i) => (Number(i?.estimatedQuantity) || 0) * (Number(i?.estimatedUnitPrice) || 0) || Number(i?.estimatedTotalCost) || 0;
const boqDisc = (i) => Math.min(Number(i?.discountAmount) || 0, boqEst(i));
const boqNetEst = (i) => boqEst(i) - boqDisc(i);
const boqAct = (i) => (Number(i?.usedQuantity) || 0) * (Number(i?.actualUnitPrice) || 0) || Number(i?.actualTotalCost) || 0;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const buildBoqFilter = (projectId, { search, phase, category, boqHeaderId, isSubProject } = {}) => {
  const pId = new mongoose.Types.ObjectId(projectId);

  // Sub: own items + items tagged/allocated to this Sub from Main
  const scopeOr = isSubProject
    ? [{ project: pId }, { subProject: pId }, { 'allocations.subProject': pId }]
    : null;

  const projectFilter = isSubProject ? { $or: scopeOr } : { project: pId };
  const filter = {};

  if (phase) filter.phase = phase;
  if (category) filter.category = category;
  if (boqHeaderId && isValidId(boqHeaderId)) filter.boqHeader = boqHeaderId;

  if (search) {
    const re = { $regex: search, $options: 'i' };
    const searchOr = ['title', 'description', 'specification', 'itemCode', 'category', 'unit', 'phase'].map((f) => ({ [f]: re }));
    if (isSubProject) {
      filter.$and = [{ $or: scopeOr }, { $or: searchOr }];
    } else {
      filter.project = pId;
      filter.$or = searchOr;
    }
  } else if (isSubProject) {
    filter.$or = scopeOr;
  } else {
    filter.project = pId;
  }

  return { filter, projectFilter };
};

// ─── BOQ DOCUMENT HEADERS (CONTAINERS) ────────────────────────────────────────

// GET /api/project-management/projects/:id/boq-headers — list all BOQ documents for a project
router.get('/projects/:id/boq-headers', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id).select('parentProject').lean();
  if (!project) return notFound(res, 'Project');

  const projectIds = [req.params.id];
  if (project.parentProject) {
    projectIds.push(String(project.parentProject));
  }

  const headers = await ProjectBOQ.find({ project: { $in: projectIds } })
    .populate('createdBy', 'firstName lastName')
    .sort({ createdAt: 1 })
    .lean();

  res.json({ success: true, data: headers });
}));

// POST /api/project-management/projects/:id/boq-headers — create a new BOQ document
router.post('/projects/:id/boq-headers', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const { title, description, version, notes, status } = req.body;
  if (!title) return badRequest(res, 'BOQ Title is required');

  const boqHeader = await ProjectBOQ.create({
    project: req.params.id,
    title: String(title).trim(),
    description: description || '',
    version: version || '1.0',
    status: status || 'Active',
    notes: notes || '',
    createdBy: req.user?._id
  });

  res.status(201).json({ success: true, message: 'BOQ Document created', data: boqHeader });
}));

// PUT /api/project-management/projects/:id/boq-headers/:boqId
router.put('/projects/:id/boq-headers/:boqId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.boqId)) return badRequest(res, 'Invalid ID');

  const allowed = ['title', 'description', 'version', 'status', 'notes'];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

  const updated = await ProjectBOQ.findOneAndUpdate(
    { _id: req.params.boqId, project: req.params.id },
    { $set: update },
    { new: true, runValidators: true }
  ).lean();

  if (!updated) return notFound(res, 'BOQ Document');
  res.json({ success: true, message: 'BOQ Document updated', data: updated });
}));

// DELETE /api/project-management/projects/:id/boq-headers/:boqId
router.delete('/projects/:id/boq-headers/:boqId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.boqId)) return badRequest(res, 'Invalid ID');

  const deleted = await ProjectBOQ.findOneAndDelete({ _id: req.params.boqId, project: req.params.id });
  if (!deleted) return notFound(res, 'BOQ Document');

  await BOQItem.deleteMany({ boqHeader: req.params.boqId, project: req.params.id });

  res.json({ success: true, message: 'BOQ Document and linked items deleted' });
}));

// POST /api/project-management/projects/:id/boq/allocate — allocate item quantity to Sub-Project & Subcontractor
router.post('/projects/:id/boq/allocate', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const { itemId, subProjectId, allocatedQuantity, notes } = req.body;
  if (!itemId || !isValidId(itemId)) return badRequest(res, 'Valid itemId is required');
  // Subcontractors are assigned only through Sublet Contracts on the Sub Project
  if (!subProjectId || !isValidId(subProjectId)) return badRequest(res, 'Select the Sub Project to allocate this quantity to');
  const subProject = await ConstructionProject.findOne({ _id: subProjectId, parentProject: req.params.id }).select('_id').lean();
  if (!subProject) return badRequest(res, 'Sub Project must belong to this Main Project');

  const item = await BOQItem.findById(itemId);
  if (!item) return notFound(res, 'BOQ Item');

  const allocQty = Math.max(0, Number(allocatedQuantity) || 0);
  const currentAllocatedTotal = (item.allocations || []).reduce((sum, a) => sum + (Number(a.allocatedQuantity) || 0), 0);
  const remainingQty = Math.max(0, (Number(item.estimatedQuantity) || 0) - currentAllocatedTotal);

  if (allocQty > remainingQty) {
    return badRequest(
      res,
      `Cannot allocate ${allocQty} ${item.unit}. Only ${remainingQty} ${item.unit} remaining unallocated out of Master BOQ quantity (${item.estimatedQuantity} ${item.unit}).`
    );
  }

  if (allocQty <= 0) return badRequest(res, 'Allocated quantity must be greater than zero');

  item.allocations.push({
    subProject: subProjectId,
    allocatedQuantity: allocQty,
    notes: notes || ''
  });
  item.subProject = subProjectId;

  await item.save();

  const updatedItem = await BOQItem.findById(item._id)
    .populate('contractor', 'name email phone vendorType')
    .populate('subProject', 'name projectNumber')
    .populate('allocations.subProject', 'name projectNumber')
    .populate('allocations.contractor', 'name email phone vendorType')
    .lean();

  res.json({ success: true, message: `Successfully allocated ${allocQty} ${item.unit}`, data: updatedItem });
}));

// DELETE /api/project-management/projects/:id/boq/allocate/:itemId/:allocationId — remove an allocation
router.delete('/projects/:id/boq/allocate/:itemId/:allocationId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.itemId)) return badRequest(res, 'Invalid ID');

  const item = await BOQItem.findById(req.params.itemId);
  if (!item) return notFound(res, 'BOQ Item');

  item.allocations = (item.allocations || []).filter(a => String(a._id) !== String(req.params.allocationId));
  await item.save();

  res.json({ success: true, message: 'Allocation removed successfully', data: item });
}));

const withBoqTotals = (item) => {
  const estimatedTotalCost = boqEst(item);
  const discountAmount = boqDisc(item);
  const netEstimatedCost = boqNetEst(item);
  const actualTotalCost = boqAct(item);

  const allocatedQuantityTotal = (item.allocations || []).reduce((sum, a) => sum + (Number(a.allocatedQuantity) || 0), 0);
  const remainingQuantity = Math.max(0, (Number(item.estimatedQuantity) || 0) - allocatedQuantityTotal);

  return {
    ...item,
    discountAmount,
    estimatedTotalCost,
    netEstimatedCost,
    actualTotalCost,
    allocatedQuantityTotal,
    remainingQuantity,
    quantityVariance: (Number(item.usedQuantity) || 0) - (Number(item.estimatedQuantity) || 0),
    costVariance: actualTotalCost - netEstimatedCost
  };
};

const calcBoqSummary = (rows, boqDiscountRaw = 0) => {
  const totalEstimated = round2(rows.reduce((s, i) => s + boqEst(i), 0));
  const totalDiscount = round2(rows.reduce((s, i) => s + boqDisc(i), 0));
  const netAfterItems = round2(rows.reduce((s, i) => s + boqNetEst(i), 0));
  const boqDiscountAmount = Math.min(Math.max(0, Number(boqDiscountRaw) || 0), netAfterItems);
  return {
    totalEstimated,
    totalDiscount,
    netAfterItems,
    boqDiscountAmount,
    netEstimated: round2(netAfterItems - boqDiscountAmount),
    totalActual: round2(rows.reduce((s, i) => s + boqAct(i), 0))
  };
};

// GET /api/project-management/projects/:id/boq
router.get('/projects/:id/boq', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const { page = 1, limit = 25 } = req.query;
  const project = await ConstructionProject.findById(req.params.id).select('boqDiscountAmount parentProject').lean();
  if (!project) return notFound(res, 'Project');

  const isSubProject = Boolean(project.parentProject);
  const { filter, projectFilter } = buildBoqFilter(req.params.id, { ...req.query, isSubProject });
  const skip = (Number(page) - 1) * Number(limit);
  const totalFields = 'estimatedQuantity estimatedUnitPrice discountAmount usedQuantity actualUnitPrice estimatedTotalCost netEstimatedCost actualTotalCost';

  const [items, total, allProjectRows, phases, allItemsCount] = await Promise.all([
    BOQItem.find(filter)
      .populate('contractor', 'name email phone vendorType')
      .populate('subProject', 'name projectNumber')
      .populate('allocations.subProject', 'name projectNumber')
      .populate('allocations.contractor', 'name email phone vendorType')
      .populate('boqHeader', 'title boqNumber version')
      .sort({ phase: 1, orderIndex: 1, createdAt: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    BOQItem.countDocuments(filter),
    BOQItem.find(projectFilter).select(totalFields).lean(),
    BOQItem.distinct('phase', projectFilter),
    BOQItem.countDocuments(projectFilter)
  ]);

  const itemsWithTotals = items.map(withBoqTotals);
  const summary = calcBoqSummary(allProjectRows, project?.boqDiscountAmount);

  res.json({
    success: true,
    data: {
      items: itemsWithTotals,
      ...summary,
      allItemsCount,
      phases: phases.map(p => p || 'General').sort((a, b) => a.localeCompare(b)),
      pagination: { total, page: Number(page), limit: Number(limit) }
    }
  });
}));

// PUT /api/project-management/projects/:id/boq/discount — whole BOQ discount
router.put('/projects/:id/boq/discount', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const amount = Math.max(0, Number(req.body?.boqDiscountAmount) || 0);
  const project = await ConstructionProject.findByIdAndUpdate(
    req.params.id,
    { $set: { boqDiscountAmount: amount, updatedBy: req.user?._id } },
    { new: true, runValidators: true }
  ).select('boqDiscountAmount').lean();

  if (!project) return notFound(res, 'Project');

  const rows = await BOQItem.find({ project: req.params.id })
    .select('estimatedQuantity estimatedUnitPrice discountAmount usedQuantity actualUnitPrice estimatedTotalCost netEstimatedCost actualTotalCost')
    .lean();

  res.json({
    success: true,
    message: 'BOQ discount updated',
    data: { boqDiscountAmount: project.boqDiscountAmount, ...calcBoqSummary(rows, project.boqDiscountAmount) }
  });
}));

// POST /api/project-management/projects/:id/boq — add single item
router.post('/projects/:id/boq', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const projectDoc = await ConstructionProject.findById(req.params.id).select('parentProject').lean();
  if (!projectDoc) return notFound(res, 'Project');
  const isSub = Boolean(projectDoc.parentProject);

  const { title, description, unit, estimatedQuantity, estimatedUnitPrice, discountAmount, phase, category, specification, itemCode, notes, orderIndex, contractor, subProject, boqHeader, contractorUnitPrice, cbsCategory } = req.body;
  if (!description) return badRequest(res, 'Description is required');
  if (!unit) return badRequest(res, 'Unit is required');
  if (estimatedQuantity == null) return badRequest(res, 'Estimated quantity is required');
  if (estimatedUnitPrice == null) return badRequest(res, 'Estimated unit price is required');

  const item = await BOQItem.create({
    project: req.params.id,
    boqHeader: boqHeader || null,
    title: String(title || '').trim(),
    description,
    unit,
    estimatedQuantity: Number(estimatedQuantity),
    estimatedUnitPrice: Number(estimatedUnitPrice),
    discountAmount: Number(discountAmount) || 0,
    phase: phase || 'General',
    category,
    cbsCategory: cbsCategory || 'Materials',
    specification,
    itemCode,
    contractor: contractor || null,
    // On Sub Project, tag the item to this Sub so it always appears in Sub BOQ scope
    subProject: isSub ? req.params.id : (subProject || null),
    contractorUnitPrice: Number(contractorUnitPrice) || 0,
    notes,
    orderIndex: orderIndex || 0,
    createdBy: req.user?._id
  });

  await syncProjectBOQBudget(req.params.id);

  res.status(201).json({ success: true, message: 'BOQ item added', data: item });
}));

// POST /api/project-management/projects/:id/boq/bulk — bulk import
router.post('/projects/:id/boq/bulk', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const projectDoc = await ConstructionProject.findById(req.params.id).select('parentProject').lean();
  if (!projectDoc) return notFound(res, 'Project');
  const isSub = Boolean(projectDoc.parentProject);

  const { items, boqHeader } = req.body;
  if (!Array.isArray(items) || !items.length) return badRequest(res, 'Items array is required');

  const docs = items.map((item, idx) => ({
    project: req.params.id,
    boqHeader: item.boqHeader || boqHeader || null,
    title: String(item.title || '').trim(),
    description: item.description,
    unit: item.unit,
    estimatedQuantity: Number(item.estimatedQuantity) || 0,
    estimatedUnitPrice: Number(item.estimatedUnitPrice) || 0,
    discountAmount: Number(item.discountAmount) || 0,
    phase: item.phase || 'General',
    category: item.category || '',
    specification: item.specification || '',
    itemCode: item.itemCode || '',
    contractor: item.contractor || null,
    subProject: isSub ? req.params.id : (item.subProject || null),
    contractorUnitPrice: Number(item.contractorUnitPrice) || 0,
    notes: item.notes || '',
    orderIndex: item.orderIndex ?? idx,
    createdBy: req.user?._id
  }));

  const inserted = await BOQItem.insertMany(docs);
  await syncProjectBOQBudget(req.params.id);
  res.status(201).json({ success: true, message: `${inserted.length} BOQ items added`, data: inserted });
}));

// PUT /api/project-management/projects/:id/boq/:itemId
router.put('/projects/:id/boq/:itemId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.itemId)) return badRequest(res, 'Invalid ID');

  const allowed = ['title', 'description', 'unit', 'phase', 'category', 'specification', 'itemCode',
    'estimatedQuantity', 'estimatedUnitPrice', 'discountAmount', 'orderedQuantity', 'receivedQuantity',
    'usedQuantity', 'actualUnitPrice', 'notes', 'orderIndex', 'contractor', 'subProject', 'boqHeader', 'contractorUnitPrice', 'contractorBilledQuantity', 'contractorBilledAmount'];

  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  ['estimatedQuantity', 'estimatedUnitPrice', 'discountAmount', 'orderedQuantity', 'receivedQuantity', 'usedQuantity', 'actualUnitPrice', 'contractorUnitPrice', 'contractorBilledQuantity', 'contractorBilledAmount']
    .forEach((key) => {
      if (updates[key] !== undefined) updates[key] = Number(updates[key]);
    });

  const item = await BOQItem.findOneAndUpdate(
    { _id: req.params.itemId, project: req.params.id },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!item) return notFound(res, 'BOQ item');

  await syncProjectBOQBudget(req.params.id);

  res.json({ success: true, message: 'BOQ item updated', data: item });
}));

// DELETE /api/project-management/projects/:id/boq/:itemId
router.delete('/projects/:id/boq/:itemId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.itemId)) return badRequest(res, 'Invalid ID');

  const item = await BOQItem.findOneAndDelete({ _id: req.params.itemId, project: req.params.id });
  if (!item) return notFound(res, 'BOQ item');

  await syncProjectBOQBudget(req.params.id);

  res.json({ success: true, message: 'BOQ item deleted' });
}));

// ─── TASKS ───────────────────────────────────────────────────────────────────

/**
 * Make a Sub Project's WBS mirror the master activities of its Project Type.
 * Creates missing group (level 0) / activity (level 1) rows and keeps titles + order in sync.
 * Per-project fields (dates, progress, verification) are never touched.
 */
const syncProjectWbsFromMaster = async (project) => {
  const projectType = normalizeProjectType(project.projectType);
  if (!projectType) return { projectType: null };

  const masters = await WbsActivity.find({ projectType, isActive: true })
    .sort({ orderIndex: 1, name: 1 })
    .lean();

  const existing = await ProjectTask.find({
    project: project._id,
    $or: [{ activity: { $ne: null } }, { level: 0, activityGroup: { $ne: '' } }]
  });
  const groupRows = new Map(existing.filter((t) => t.level === 0 && t.activityGroup).map((t) => [t.activityGroup, t]));
  const activityRows = new Map(existing.filter((t) => t.activity).map((t) => [String(t.activity), t]));

  // Group order follows first appearance in the sorted master list
  const groupOrder = [];
  masters.forEach((m) => { if (!groupOrder.includes(m.group)) groupOrder.push(m.group); });

  // A concurrent request may create the same row first; the unique index rejects ours, so reuse theirs
  const createOrFind = async (doc, findFilter) => {
    try {
      return await ProjectTask.create(doc);
    } catch (err) {
      if (err?.code !== 11000) throw err;
      return ProjectTask.findOne(findFilter);
    }
  };

  for (let gi = 0; gi < groupOrder.length; gi += 1) {
    const group = groupOrder[gi];
    let row = groupRows.get(group);
    if (!row) {
      row = await createOrFind(
        { project: project._id, level: 0, title: group, activityGroup: group, orderIndex: gi },
        { project: project._id, level: 0, activityGroup: group }
      );
      groupRows.set(group, row);
    } else if (row.orderIndex !== gi || row.title !== group) {
      row.orderIndex = gi;
      row.title = group;
      await row.save();
    }
  }

  for (let ai = 0; ai < masters.length; ai += 1) {
    const m = masters[ai];
    const parent = groupRows.get(m.group);
    const row = activityRows.get(String(m._id));
    if (!row) {
      await createOrFind(
        {
          project: project._id,
          level: 1,
          parentTask: parent._id,
          activity: m._id,
          activityGroup: m.group,
          title: m.name,
          description: m.description || '',
          orderIndex: ai
        },
        { project: project._id, activity: m._id }
      );
    } else if (
      row.title !== m.name ||
      row.activityGroup !== m.group ||
      String(row.parentTask || '') !== String(parent._id) ||
      row.orderIndex !== ai
    ) {
      row.title = m.name;
      row.activityGroup = m.group;
      row.parentTask = parent._id;
      row.orderIndex = ai;
      await row.save();
    }
  }

  return { projectType, activeActivityIds: new Set(masters.map((m) => String(m._id))) };
};

// GET /api/project-management/projects/:id/tasks — WBS built from the master activities of the project's type
router.get('/projects/:id/tasks', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id).select('projectType parentProject').lean();
  if (!project) return notFound(res, 'Project');

  const { projectType, activeActivityIds = new Set() } = await syncProjectWbsFromMaster(project);

  const rows = await ProjectTask.find({
    project: req.params.id,
    $or: [{ activity: { $ne: null } }, { level: 0, activityGroup: { $ne: '' } }]
  })
    .populate('activity', 'code unit isActive')
    .sort({ orderIndex: 1, createdAt: 1 })
    .lean();

  // Hide activities removed from the master unless work was already recorded on them
  const activities = rows.filter((t) => t.level > 0 && (
    activeActivityIds.has(String(t.activity?._id || t.activity)) ||
    (t.progressPercent || 0) > 0 ||
    t.isPhysicallyVerified
  ));
  const byParent = activities.reduce((acc, t) => {
    const pid = String(t.parentTask || 'root');
    (acc[pid] = acc[pid] || []).push(t);
    return acc;
  }, {});

  const tree = rows
    .filter((t) => t.level === 0)
    .map((group) => ({ ...group, children: byParent[String(group._id)] || [] }))
    .filter((group) => group.children.length > 0);

  // Roll group progress and planned/actual span up from its activities
  const minDate = (dates) => (dates.length ? new Date(Math.min(...dates.map((d) => new Date(d).getTime()))) : null);
  const maxDate = (dates) => (dates.length ? new Date(Math.max(...dates.map((d) => new Date(d).getTime()))) : null);
  tree.forEach((group) => {
    const kids = group.children;
    const avg = Math.round(kids.reduce((s, c) => s + (c.progressPercent || 0), 0) / kids.length);
    group.progressPercent = avg;
    group.status = avg === 100 ? 'Completed' : avg > 0 ? 'In Progress' : 'Not Started';
    group.plannedStartDate = minDate(kids.map((c) => c.plannedStartDate).filter(Boolean));
    group.plannedEndDate = maxDate(kids.map((c) => c.plannedEndDate).filter(Boolean));
    group.actualStartDate = minDate(kids.map((c) => c.actualStartDate).filter(Boolean));
    group.actualEndDate = avg === 100 ? maxDate(kids.map((c) => c.actualEndDate).filter(Boolean)) : null;
  });

  const tasks = tree.flatMap((g) => [g, ...g.children]);
  res.json({ success: true, data: { tasks, tree, projectType } });
}));

// POST /api/project-management/projects/:id/tasks — retired: activities come from the WBS master
router.post('/projects/:id/tasks', asyncHandler(async (req, res) => (
  badRequest(res, 'WBS activities are managed in Project Management → WBS Activities (per Project Type)')
)));

// PUT /api/project-management/projects/:id/tasks/:taskId — per-project progress, dates and verification
router.put('/projects/:id/tasks/:taskId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.taskId)) return badRequest(res, 'Invalid ID');

  const allowed = ['status', 'progressPercent', 'plannedStartDate',
    'plannedEndDate', 'actualStartDate', 'actualEndDate', 'assignedTo',
    'estimatedLaborCost', 'actualLaborCost', 'notes', 'orderIndex', 'dependencies',
    'isPhysicallyVerified', 'verifiedAt', 'verifiedBy', 'verificationNotes', 'verificationPhotoUrl'];

  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const task = await ProjectTask.findOneAndUpdate(
    { _id: req.params.taskId, project: req.params.id },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!task) return notFound(res, 'Task');

  res.json({ success: true, message: 'Task updated', data: task });
}));

// DELETE /api/project-management/projects/:id/tasks/:taskId — retired: deactivate the master activity instead
router.delete('/projects/:id/tasks/:taskId', asyncHandler(async (req, res) => (
  badRequest(res, 'WBS activities are managed in Project Management → WBS Activities (per Project Type)')
)));

// ─── WBS ACTIVITY MASTER (per Project Type) ──────────────────────────────────

// GET /api/project-management/wbs-activities?projectType=VILLAS&includeInactive=true
router.get('/wbs-activities', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.projectType) {
    const type = normalizeProjectType(req.query.projectType);
    if (!type) return badRequest(res, 'Invalid project type');
    filter.projectType = type;
  }
  if (req.query.includeInactive !== 'true') filter.isActive = true;

  const activities = await WbsActivity.find(filter)
    .sort({ projectType: 1, orderIndex: 1, name: 1 })
    .lean();
  const groups = [...new Set(activities.map((a) => a.group))];

  res.json({ success: true, data: { activities, groups, projectTypes: WBS_PROJECT_TYPES } });
}));

const pickActivityFields = (body) => {
  const out = {};
  ['group', 'name', 'code', 'unit', 'description'].forEach((k) => {
    if (body[k] !== undefined) out[k] = String(body[k] || '').trim();
  });
  if (body.orderIndex !== undefined) out.orderIndex = Number(body.orderIndex) || 0;
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
  return out;
};

const duplicateActivityResponse = (res, err) => {
  if (err?.code === 11000) return badRequest(res, 'An activity with this name already exists in this group');
  throw err;
};

// POST /api/project-management/wbs-activities
router.post('/wbs-activities', asyncHandler(async (req, res) => {
  const projectType = normalizeProjectType(req.body.projectType);
  if (!projectType) return badRequest(res, 'Project type is required');
  const fields = pickActivityFields(req.body);
  if (!fields.group) return badRequest(res, 'Activity group is required');
  if (!fields.name) return badRequest(res, 'Activity name is required');

  if (fields.orderIndex === undefined) {
    const last = await WbsActivity.findOne({ projectType }).sort({ orderIndex: -1 }).select('orderIndex').lean();
    fields.orderIndex = (Number(last?.orderIndex) || 0) + 1;
  }

  try {
    const activity = await WbsActivity.create({
      ...fields,
      projectType,
      createdBy: req.user?._id,
      updatedBy: req.user?._id
    });
    res.status(201).json({ success: true, message: 'Activity created', data: activity });
  } catch (err) {
    duplicateActivityResponse(res, err);
  }
}));

// PUT /api/project-management/wbs-activities/:activityId
router.put('/wbs-activities/:activityId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.activityId)) return badRequest(res, 'Invalid activity ID');
  const fields = pickActivityFields(req.body);
  if (fields.group === '') return badRequest(res, 'Activity group is required');
  if (fields.name === '') return badRequest(res, 'Activity name is required');

  try {
    const activity = await WbsActivity.findByIdAndUpdate(
      req.params.activityId,
      { $set: { ...fields, updatedBy: req.user?._id } },
      { new: true, runValidators: true }
    );
    if (!activity) return notFound(res, 'Activity');
    res.json({ success: true, message: 'Activity updated', data: activity });
  } catch (err) {
    duplicateActivityResponse(res, err);
  }
}));

// DELETE /api/project-management/wbs-activities/:activityId — delete if unused, otherwise deactivate
router.delete('/wbs-activities/:activityId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.activityId)) return badRequest(res, 'Invalid activity ID');
  const activity = await WbsActivity.findById(req.params.activityId);
  if (!activity) return notFound(res, 'Activity');

  const [usedInProgress, usedInSchedules, usedInContracts] = await Promise.all([
    ProjectTask.exists({ activity: activity._id, $or: [{ progressPercent: { $gt: 0 } }, { isPhysicallyVerified: true }] }),
    SlabSchedule.exists({ 'slabs.activities': activity._id }),
    SubletContract.exists({ 'slabs.activities.activity': activity._id })
  ]);

  if (usedInProgress || usedInSchedules || usedInContracts) {
    activity.isActive = false;
    activity.updatedBy = req.user?._id;
    await activity.save();
    return res.json({ success: true, message: 'Activity is in use, so it was deactivated instead of deleted', data: activity });
  }

  await ProjectTask.deleteMany({ activity: activity._id });
  await activity.deleteOne();
  res.json({ success: true, message: 'Activity deleted' });
}));

// ─── SLAB SCHEDULES (percentage-wise payment stages per Project Type) ────────

const populateSlabSchedule = (query) =>
  query.populate('slabs.activities', 'name group code unit isActive');

/** Validate slab rows: names, % totalling 100, activities from the same project type. */
const buildSlabRows = async (projectType, rawSlabs = []) => {
  if (!Array.isArray(rawSlabs) || !rawSlabs.length) return { error: 'Add at least one slab' };

  const slabs = rawSlabs.map((s) => ({
    name: String(s.name || '').trim(),
    percentage: Number(s.percentage) || 0,
    description: String(s.description || '').trim(),
    activities: [...new Set((s.activities || []).map((a) => String(a?._id || a)).filter(isValidId))]
  }));

  if (slabs.some((s) => !s.name)) return { error: 'Every slab needs a name' };
  if (slabs.some((s) => s.percentage <= 0)) return { error: 'Every slab needs a percentage above 0' };
  const total = slabs.reduce((sum, s) => sum + s.percentage, 0);
  if (Math.abs(total - 100) > 0.001) return { error: `Slab percentages must total 100% (currently ${total}%)` };

  const allIds = slabs.flatMap((s) => s.activities);
  const seen = new Set();
  for (const id of allIds) {
    if (seen.has(id)) return { error: 'An activity can only belong to one slab in a schedule' };
    seen.add(id);
  }
  if (allIds.length) {
    const count = await WbsActivity.countDocuments({ _id: { $in: allIds }, projectType });
    if (count !== allIds.length) return { error: `All activities must belong to ${projectType}` };
  }

  return { slabs };
};

// GET /api/project-management/slab-schedules?projectType=VILLAS
router.get('/slab-schedules', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.projectType) {
    const type = normalizeProjectType(req.query.projectType);
    if (!type) return badRequest(res, 'Invalid project type');
    filter.projectType = type;
  }
  if (req.query.includeInactive !== 'true') filter.isActive = true;

  const schedules = await populateSlabSchedule(
    SlabSchedule.find(filter).sort({ projectType: 1, name: 1 })
  ).lean();
  res.json({ success: true, data: schedules });
}));

// POST /api/project-management/slab-schedules
router.post('/slab-schedules', asyncHandler(async (req, res) => {
  const projectType = normalizeProjectType(req.body.projectType);
  if (!projectType) return badRequest(res, 'Project type is required');
  const name = String(req.body.name || '').trim();
  if (!name) return badRequest(res, 'Schedule name is required');

  const { slabs, error } = await buildSlabRows(projectType, req.body.slabs);
  if (error) return badRequest(res, error);

  const schedule = await SlabSchedule.create({
    projectType,
    name,
    description: String(req.body.description || '').trim(),
    slabs,
    createdBy: req.user?._id,
    updatedBy: req.user?._id
  });
  const populated = await populateSlabSchedule(SlabSchedule.findById(schedule._id)).lean();
  res.status(201).json({ success: true, message: 'Slab schedule created', data: populated });
}));

// PUT /api/project-management/slab-schedules/:scheduleId
router.put('/slab-schedules/:scheduleId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.scheduleId)) return badRequest(res, 'Invalid schedule ID');
  const schedule = await SlabSchedule.findById(req.params.scheduleId);
  if (!schedule) return notFound(res, 'Slab schedule');

  if (req.body.name !== undefined) {
    const name = String(req.body.name || '').trim();
    if (!name) return badRequest(res, 'Schedule name is required');
    schedule.name = name;
  }
  if (req.body.description !== undefined) schedule.description = String(req.body.description || '').trim();
  if (req.body.isActive !== undefined) schedule.isActive = Boolean(req.body.isActive);
  if (req.body.slabs !== undefined) {
    const { slabs, error } = await buildSlabRows(schedule.projectType, req.body.slabs);
    if (error) return badRequest(res, error);
    schedule.slabs = slabs;
  }
  schedule.updatedBy = req.user?._id;
  await schedule.save();

  const populated = await populateSlabSchedule(SlabSchedule.findById(schedule._id)).lean();
  res.json({ success: true, message: 'Slab schedule updated', data: populated });
}));

// DELETE /api/project-management/slab-schedules/:scheduleId — delete if unused, otherwise deactivate
router.delete('/slab-schedules/:scheduleId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.scheduleId)) return badRequest(res, 'Invalid schedule ID');
  const schedule = await SlabSchedule.findById(req.params.scheduleId);
  if (!schedule) return notFound(res, 'Slab schedule');

  if (await SubletContract.exists({ slabSchedule: schedule._id })) {
    schedule.isActive = false;
    schedule.updatedBy = req.user?._id;
    await schedule.save();
    return res.json({ success: true, message: 'Schedule is used by sublet contracts, so it was deactivated instead of deleted' });
  }
  await schedule.deleteOne();
  res.json({ success: true, message: 'Slab schedule deleted' });
}));

// POST /api/project-management/projects/:id/boq/create-po
// Creates a PurchaseOrder from selected BOQ items, updates BOQ item tracked quantities
router.post('/projects/:id/boq/create-po', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const { vendorId, expectedDeliveryDate, deliveryAddress, notes, items } = req.body;

  if (!vendorId) return badRequest(res, 'Vendor is required');
  if (!expectedDeliveryDate) return badRequest(res, 'Expected delivery date is required');
  if (!Array.isArray(items) || !items.length) return badRequest(res, 'At least one item is required');

  // Validate vendor exists
  const vendor = await Supplier.findById(vendorId).lean();
  if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

  // Load project for reference
  const project = await ConstructionProject.findById(req.params.id).lean();
  if (!project) return notFound(res, 'Project');

  // Build PO items (calculate amounts)
  const poItems = items.map(item => ({
    description: item.description,
    specification: item.specification || '',
    quantity: Number(item.quantity),
    unit: item.unit,
    unitPrice: Number(item.unitPrice),
    taxRate: Number(item.taxRate) || 0,
    discount: Number(item.discount) || 0,
    amount: Number(item.quantity) * Number(item.unitPrice)
  }));

  const subtotal = poItems.reduce((s, i) => s + i.amount, 0);
  const taxAmount = poItems.reduce((s, i) => s + (i.amount * (i.taxRate / 100)), 0);

  // Create PO in existing procurement system
  const po = new PurchaseOrder({
    vendor: vendorId,
    orderDate: new Date(),
    expectedDeliveryDate: new Date(expectedDeliveryDate),
    deliveryAddress: deliveryAddress || project.address || '',
    items: poItems,
    subtotal,
    taxAmount,
    totalAmount: subtotal + taxAmount,
    notes: notes || '',
    internalNotes: `Created from Construction Project: ${project.name} (${project.projectNumber})`,
    status: 'Draft',
    createdBy: req.user?._id
  });

  await po.save();

  // Update each BOQ item's orderedQuantity and link PO
  const boqUpdates = items.filter(i => i.boqItemId && isValidId(i.boqItemId));
  await Promise.all(boqUpdates.map(item =>
    BOQItem.findByIdAndUpdate(item.boqItemId, {
      $inc: { orderedQuantity: Number(item.quantity) },
      $addToSet: { linkedPurchaseOrders: po._id }
    })
  ));

  // Update project totalCommitted
  await ConstructionProject.findByIdAndUpdate(req.params.id, {
    $inc: { totalCommitted: po.totalAmount }
  });

  const populated = await PurchaseOrder.findById(po._id)
    .populate('vendor', 'name email phone')
    .populate('createdBy', 'firstName lastName')
    .lean();

  res.status(201).json({
    success: true,
    message: `Purchase Order ${po.orderNumber} created successfully`,
    data: populated
  });
}));

// GET /api/project-management/projects/:id/purchase-orders
// Returns all POs linked to any BOQ item in this project
// GET /api/project-management/projects/:id/procurement-documents
// Indents, POs and GRNs charged to this project (Main = every Sub Project under it), newest first
router.get('/projects/:id/procurement-documents', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const project = await ConstructionProject.findById(req.params.id).select('parentProject').lean();
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
  const key = project.parentProject ? 'chargeTo.subProject' : 'chargeTo.project';
  const match = { [key]: project._id };
  const Indent = require('../models/general/Indent');
  const GoodsReceive = require('../models/procurement/GoodsReceive');
  const LIMIT = 300;
  const { isCommitted, poLines } = require('../services/projectProcurementService');

  const GoodsIssue = require('../models/procurement/GoodsIssue');
  const [indents, pos, grns, issues] = await Promise.all([
    Indent.find({ ...match, isActive: { $ne: false } })
      .select('indentNumber title status requestedDate createdAt chargeTo items.quantity items.estimatedCost items.budgetCategory')
      .sort({ createdAt: -1 }).limit(LIMIT).lean(),
    PurchaseOrder.find(match)
      .select('orderNumber status orderDate createdAt totalAmount financeApprovedAt chargeTo vendor indent items.quantity items.amount items.receivedQuantity items.budgetCategory')
      .populate('vendor', 'name')
      .populate('indent', 'indentNumber')
      .sort({ createdAt: -1 }).limit(LIMIT).lean(),
    GoodsReceive.find(match)
      .select('receiveNumber receiveDate createdAt status total netAmount poNumber purchaseOrder supplierName chargeTo items.budgetCategory')
      .sort({ createdAt: -1 }).limit(LIMIT).lean(),
    GoodsIssue.find({ ...match, issueType: { $ne: 'customer' } })
      .select('issueNumber sinNumber issueDate createdAt status chargeTo project requiredFor items.qtyIssued items.quantity items.qtyReturnedToStore items.budgetCategory')
      .populate('project', 'name')
      .sort({ createdAt: -1 }).limit(LIMIT).lean()
  ]);

  const categoriesOf = (items) => [...new Set((items || []).map((i) => i.budgetCategory).filter(Boolean))];
  res.json({
    success: true,
    data: {
      indents: indents.map((d) => ({
        _id: d._id,
        number: d.indentNumber,
        title: d.title,
        status: d.status,
        date: d.requestedDate || d.createdAt,
        subProjectId: d.chargeTo?.subProject || null,
        subProjectName: d.chargeTo?.subProjectName || '',
        categories: categoriesOf(d.items),
        amount: (d.items || []).reduce((t, i) => t + (Number(i.estimatedCost) || 0) * (Number(i.quantity) || 0), 0)
      })),
      purchaseOrders: pos.map((d) => {
        const ordered = (d.items || []).reduce((t, i) => t + (Number(i.quantity) || 0), 0);
        const received = (d.items || []).reduce((t, i) => t + Math.min(Number(i.receivedQuantity) || 0, Number(i.quantity) || 0), 0);
        return {
          _id: d._id,
          number: d.orderNumber,
          status: d.status,
          date: d.orderDate || d.createdAt,
          vendorName: d.vendor?.name || '',
          indentNumber: d.indent?.indentNumber || '',
          subProjectId: d.chargeTo?.subProject || null,
        subProjectName: d.chargeTo?.subProjectName || '',
          categories: categoriesOf(d.items),
          amount: poLines(d).reduce((t, l) => t + l.amount, 0),
          committed: isCommitted(d),
          receivedPercent: ordered > 0 ? Math.round((received / ordered) * 100) : 0
        };
      }),
      grns: grns.map((d) => ({
        _id: d._id,
        number: d.receiveNumber,
        status: d.status,
        date: d.receiveDate || d.createdAt,
        poNumber: d.poNumber || '',
        supplierName: d.supplierName || '',
        subProjectId: d.chargeTo?.subProject || null,
        subProjectName: d.chargeTo?.subProjectName || '',
        categories: categoriesOf(d.items),
        amount: Number(d.total ?? d.netAmount) || 0
      })),
      issues: issues.map((d) => ({
        _id: d._id,
        number: d.sinNumber || d.issueNumber,
        status: d.status,
        date: d.issueDate || d.createdAt,
        storeProjectName: d.project?.name || '',
        requiredFor: d.requiredFor || '',
        subProjectId: d.chargeTo?.subProject || null,
        subProjectName: d.chargeTo?.subProjectName || '',
        categories: categoriesOf(d.items),
        quantity: (d.items || []).reduce((t, i) => t + Math.max(0, (Number(i.qtyIssued ?? i.quantity) || 0) - (Number(i.qtyReturnedToStore) || 0)), 0)
      })),
      limit: LIMIT
    }
  });
}));

// GET /api/project-management/projects/:id/procurement-summary
// Budget / indented / committed / actual / available per Sub Project and budget category,
// from the indents, POs and GRNs charged to this project (Main = all its Sub Projects)
router.get('/projects/:id/procurement-summary', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const summary = await getProjectProcurementSummary(req.params.id);
  if (!summary) return res.status(404).json({ success: false, message: 'Project not found' });
  res.json({ success: true, data: summary });
}));

router.get('/projects/:id/purchase-orders', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  // Collect all PO IDs from BOQ items
  const boqItems = await BOQItem.find({ project: req.params.id }, 'linkedPurchaseOrders').lean();
  const poIds = [...new Set(boqItems.flatMap(b => (b.linkedPurchaseOrders || []).map(id => id.toString())))];

  if (!poIds.length) return res.json({ success: true, data: [] });

  const pos = await PurchaseOrder.find({ _id: { $in: poIds } })
    .populate('vendor', 'name email phone')
    .populate('createdBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, data: pos });
}));

// ─── PROJECT INVOICES (MILESTONE BILLING) ────────────────────────────────────

// Helper: sync totalInvoiced on project
const syncProjectInvoiceTotals = async (projectId) => {
  const [{ total } = { total: 0 }] = await ProjectInvoice.aggregate([
    { $match: { project: new mongoose.Types.ObjectId(projectId), status: { $nin: ['Cancelled'] } } },
    { $group: { _id: null, total: { $sum: '$invoiceAmount' } } }
  ]);
  await ConstructionProject.findByIdAndUpdate(projectId, { totalInvoiced: total });
};

/**
 * Undo what an IPC billed: check request billed quantities / slab, and the BOQ contractor counters.
 * Called when an unpaid IPC is cancelled or deleted, so the verified work can be billed again.
 */
const reverseIpcBilling = async (invoice, userId) => {
  if (invoice.invoiceType !== 'Subcontractor_IPC') return;
  await Promise.all((invoice.items || []).map((item) =>
    BOQItem.updateOne(
      { _id: item.boqItem },
      { $inc: { contractorBilledQuantity: -(Number(item.currentQuantity) || 0), contractorBilledAmount: -(Number(item.currentAmount) || 0) } }
    )
  ));
  if (!invoice.checkRequest) return;
  const cr = await CheckRequest.findById(invoice.checkRequest);
  if (!cr) return;
  (invoice.items || []).forEach((item) => {
    const crItem = cr.items.find((i) => String(i.boqItem) === String(item.boqItem));
    if (crItem) crItem.billedQuantity = Math.max(0, (Number(crItem.billedQuantity) || 0) - (Number(item.currentQuantity) || 0));
  });
  if (String(cr.linkedInvoice || '') === String(invoice._id)) cr.linkedInvoice = null;
  if (cr.status === 'Billed') cr.status = 'Verified';
  cr.updatedBy = userId;
  await cr.save();
};

/** Add (sign 1) or remove (sign -1) an IPC's lines from the BOQ contractor counters */
const applyBoqCounters = (items, sign) => Promise.all((items || []).map((item) =>
  BOQItem.updateOne(
    { _id: item.boqItem },
    { $inc: { contractorBilledQuantity: sign * (Number(item.currentQuantity) || 0), contractorBilledAmount: sign * (Number(item.currentAmount) || 0) } }
  )
));

const invoiceBalance = (inv) => Math.max(0, (Number(inv.netPayableAmount) || Number(inv.invoiceAmount) || 0) - (Number(inv.paidAmount) || 0));

// GET /api/project-management/projects/:id/invoices
router.get('/projects/:id/invoices', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const invoices = await ProjectInvoice.find({
    $or: [{ project: req.params.id }, { masterProject: req.params.id }]
  })
    .populate('contractor', 'name email phone vendorType')
    .populate('createdBy', 'firstName lastName')
    .populate('items.boqItem', 'title description unit estimatedQuantity estimatedUnitPrice contractorUnitPrice contractorBilledQuantity')
    .sort({ issueDate: -1 })
    .lean();

  // Summary stats
  const live = invoices.filter((i) => i.status !== 'Cancelled');
  const totalInvoiced = live.reduce((s, i) => s + (Number(i.netPayableAmount) || Number(i.invoiceAmount) || 0), 0);
  const totalPaid = live.reduce((s, i) => s + (Number(i.paidAmount) || 0), 0);
  const totalOutstanding = live.reduce((s, i) => s + invoiceBalance(i), 0);

  res.json({ success: true, data: { invoices, totalInvoiced, totalPaid, totalOutstanding } });
}));

/**
 * Lines for a BOQ-wise IPC from a verified check request: quantities capped at verified-but-unbilled,
 * rate locked to the verified rate, "previous" = this subcontractor's earlier IPCs on this line.
 * excludeInvoiceId leaves an IPC being revised out of "previous".
 * Returns { processedItems, grossAmount } or { error }.
 */
const buildIpcLines = async (projectId, cr, items, excludeInvoiceId = null) => {
  const inputByBoq = new Map();
  (Array.isArray(items) ? items : []).forEach((itemInput) => {
    const key = String(itemInput.boqItemId || itemInput.boqItem || '');
    if (key) inputByBoq.set(key, itemInput);
  });

  const processedItems = [];
  let grossAmount = 0;
  for (const crItem of cr.items) {
    const billableQty = Math.max(0, (Number(crItem.verifiedQuantity) || 0) - (Number(crItem.billedQuantity) || 0));
    if (billableQty <= 0) continue;

    const override = inputByBoq.get(String(crItem.boqItem));
    const currentQuantity = override?.currentQuantity !== undefined ? Number(override.currentQuantity) || 0 : billableQty;
    if (currentQuantity <= 0) continue;
    if (currentQuantity > billableQty) {
      return { error: `Quantity for "${crItem.title || crItem.description}" exceeds verified unpaid qty (${billableQty} ${crItem.unit}).` };
    }

    // Rate is the one verified on the check request (the sublet contract rate) — not editable on the IPC
    const unitPrice = Number(crItem.unitPrice) || 0;
    const currentAmount = Math.round(currentQuantity * unitPrice * 100) / 100;
    grossAmount += currentAmount;

    const [prev] = await ProjectInvoice.aggregate([
      {
        $match: {
          project: new mongoose.Types.ObjectId(String(projectId)),
          contractor: cr.contractor,
          invoiceType: 'Subcontractor_IPC',
          status: { $ne: 'Cancelled' },
          ...(excludeInvoiceId ? { _id: { $ne: new mongoose.Types.ObjectId(String(excludeInvoiceId)) } } : {})
        }
      },
      { $unwind: '$items' },
      { $match: { 'items.boqItem': crItem.boqItem } },
      { $group: { _id: null, qty: { $sum: '$items.currentQuantity' } } }
    ]);
    const previousQuantity = Number(prev?.qty) || 0;

    processedItems.push({
      boqItem: crItem.boqItem,
      title: crItem.title || '',
      description: crItem.description || '',
      unit: crItem.unit || '',
      previousQuantity,
      currentQuantity,
      cumulativeQuantity: previousQuantity + currentQuantity,
      unitPrice,
      currentAmount,
      _crItemId: crItem._id
    });
  }
  if (!processedItems.length) return { error: 'No billable verified quantities left on this Check Request' };
  return { processedItems, grossAmount: Math.round(grossAmount * 100) / 100 };
};

/** Apply an IPC's lines to the BOQ contractor counters and the check request's billed quantities. */
const applyIpcBilling = async (cr, processedItems, invoiceId, userId) => {
  await Promise.all(processedItems.map((item) =>
    BOQItem.findByIdAndUpdate(item.boqItem, {
      $inc: { contractorBilledQuantity: item.currentQuantity, contractorBilledAmount: item.currentAmount }
    })
  ));
  for (const item of processedItems) {
    const crItem = cr.items.id(item._crItemId) || cr.items.find((i) => String(i.boqItem) === String(item.boqItem));
    if (crItem) crItem.billedQuantity = (Number(crItem.billedQuantity) || 0) + item.currentQuantity;
  }
  const stillBillable = cr.items.some((i) => (Number(i.verifiedQuantity) || 0) - (Number(i.billedQuantity) || 0) > 0.0001);
  cr.status = cr.claimType === 'Slab' || !stillBillable ? 'Billed' : 'Verified';
  cr.linkedInvoice = invoiceId;
  cr.updatedBy = userId;
  await cr.save();
};

/** IPC kinds that are not certified work (no cost, no check request) */
const NON_WORK_IPC_KINDS = ['Advance', 'Retention Release'];

/**
 * Money position of one subcontractor on one Sub Project, from its (non-cancelled) IPCs:
 * retention held / released and advances paid / recovered. excludeInvoiceId leaves an IPC being revised out.
 */
const subcontractorBalances = async (projectId, contractorId, excludeInvoiceId = null) => {
  const filter = {
    project: new mongoose.Types.ObjectId(String(projectId)),
    contractor: new mongoose.Types.ObjectId(String(contractorId)),
    invoiceType: 'Subcontractor_IPC',
    status: { $ne: 'Cancelled' }
  };
  if (excludeInvoiceId) filter._id = { $ne: new mongoose.Types.ObjectId(String(excludeInvoiceId)) };
  const rows = await ProjectInvoice.find(filter)
    .select('ipcKind approvalStatus grossAmount retentionAmount advanceRecoveryAmount advanceRecoveryPercent ceoApprovedAt createdAt')
    .lean();
  const approved = (r) => r.approvalStatus === 'Approved';
  const sum = (list, f) => round2(list.reduce((t, r) => t + (Number(r[f]) || 0), 0));
  const work = rows.filter((r) => !NON_WORK_IPC_KINDS.includes(r.ipcKind));
  const advances = rows.filter((r) => r.ipcKind === 'Advance');
  const releases = rows.filter((r) => r.ipcKind === 'Retention Release');

  const retentionHeld = sum(work.filter(approved), 'retentionAmount');
  const retentionReleased = sum(releases, 'grossAmount'); // pending releases count too, so nothing is released twice
  const advancePaid = sum(advances.filter(approved), 'grossAmount');
  const advanceRecovered = sum(work, 'advanceRecoveryAmount');
  const latestAdvance = advances.filter(approved)
    .sort((a, b) => new Date(b.ceoApprovedAt || b.createdAt) - new Date(a.ceoApprovedAt || a.createdAt))[0];
  return {
    retentionHeld,
    retentionPendingApproval: sum(work.filter((r) => !approved(r)), 'retentionAmount'),
    retentionReleased,
    retentionAvailable: Math.max(0, round2(retentionHeld - retentionReleased)),
    advancePaid,
    advancePendingApproval: sum(advances.filter((r) => !approved(r)), 'grossAmount'),
    advanceRecovered,
    advanceOutstanding: Math.max(0, round2(advancePaid - advanceRecovered)),
    recoveryPercent: Number(latestAdvance?.advanceRecoveryPercent) || 0
  };
};

/** Advance recovery for a Work IPC: given → must fit the outstanding advance; omitted → recovery % of gross, capped */
const resolveAdvanceRecovery = async (projectId, contractorId, gross, given, excludeInvoiceId = null) => {
  const bal = await subcontractorBalances(projectId, contractorId, excludeInvoiceId);
  if (given === undefined || given === null || given === '') {
    return { amount: Math.min(bal.advanceOutstanding, round2((gross * bal.recoveryPercent) / 100)) };
  }
  const amount = Number(given) || 0;
  if (amount > bal.advanceOutstanding + 0.01) {
    return { error: `Advance recovery (${amount}) is more than the advance still outstanding (${bal.advanceOutstanding})` };
  }
  return { amount };
};

/**
 * Property (barter) share of a contractor's IPCs: the linked contract's share, or — for BOQ claims,
 * which aren't tied to one contract — the share of the contractor's contracts on this Sub Project.
 */
const ipcPropertyPercent = async (projectId, contractorId, subletContractId = null) => {
  if (subletContractId) {
    const c = await SubletContract.findById(subletContractId).select('propertyPercent').lean();
    return { percent: Number(c?.propertyPercent) || 0 };
  }
  // Retention can be released after a contract is cancelled — its share still applies
  const contracts = await SubletContract.find({ project: projectId, contractor: contractorId, $or: [{ status: { $ne: 'Cancelled' } }, { activatedAt: { $ne: null } }] })
    .select('propertyPercent').lean();
  const shares = [...new Set(contracts.map((c) => Number(c.propertyPercent) || 0))];
  if (shares.length > 1) {
    return { error: `This subcontractor's contracts here have different property shares (${shares.join('%, ')}%) — the IPC can't tell which applies` };
  }
  return { percent: shares[0] || 0 };
};

/**
 * Barter / Mixed: part of an IPC is settled in property — (gross − retention) × share — and only the
 * rest is cash. Advances are always cash; their recovery and WHT come out of the cash part.
 */
const barterSplit = ({ kind = 'Work', gross, retentionAmount = 0, advanceRecoveryAmount = 0, whtAmount = 0 }, percent) => {
  const pct = kind === 'Advance' ? 0 : Math.max(0, Math.min(100, Number(percent) || 0));
  const base = round2(gross - retentionAmount - advanceRecoveryAmount - whtAmount);
  if (!pct) return { propertyPercent: 0, propertySettlementAmount: 0, netPayableAmount: Math.max(0, base) };
  const property = round2(((gross - (kind === 'Work' ? retentionAmount : 0)) * pct) / 100);
  const cash = round2(base - property);
  if (cash < -0.01) {
    return { error: `Advance recovery and WHT (${round2(advanceRecoveryAmount + whtAmount)}) are more than the cash part of this IPC (${round2(gross - retentionAmount - property)}) — ${pct}% is settled in property` };
  }
  return { propertyPercent: pct, propertySettlementAmount: property, netPayableAmount: Math.max(0, cash) };
};

/** Retention / WHT / advance → net payable, or { error } when they don't fit the gross. */
const computeIpcDeductions = (gross, { retentionPercentage = 0, whtPercentage = 0, advanceRecoveryAmount = 0 }) => {
  const retentionP = Number(retentionPercentage) || 0;
  const whtP = Number(whtPercentage) || 0;
  const advRec = Number(advanceRecoveryAmount) || 0;
  if (retentionP < 0 || retentionP > 100) return { error: 'Retention must be between 0% and 100%' };
  if (whtP < 0 || whtP > 100) return { error: 'WHT must be between 0% and 100%' };
  if (advRec < 0) return { error: 'Advance recovery cannot be negative' };
  const retentionAmount = Math.round(gross * (retentionP / 100) * 100) / 100;
  const whtAmount = Math.round(gross * (whtP / 100) * 100) / 100;
  if (retentionAmount + whtAmount + advRec > gross) {
    return { error: `Deductions (${retentionAmount + whtAmount + advRec}) exceed the gross bill (${gross})` };
  }
  return {
    retentionPercentage: retentionP,
    retentionAmount,
    whtPercentage: whtP,
    whtAmount,
    advanceRecoveryAmount: advRec,
    netPayableAmount: Math.max(0, Math.round((gross - retentionAmount - advRec - whtAmount) * 100) / 100)
  };
};

/**
 * Verified work not yet billed to the client:
 *  - BOQ lines: verified quantity left, priced at the BOQ (client) rate
 *  - slab stages: billed once, suggested at the contract's client value × slab % (editable)
 */
const clientBillableLines = async (projectId) => {
  const slabCrs = await CheckRequest.find({
    project: projectId, claimType: 'Slab', status: { $in: ['Verified', 'Billed'] }, $or: [{ clientInvoice: null }, { clientInvoice: { $exists: false } }]
  }).populate('contractor', 'name').populate('subletContract', 'contractNumber clientValue totalAmount units')
    .select('checkRequestNumber contractor slab verifiedTotal subletContract units').lean();
  // A claim for some of a contract's villas bills the client that share of the stage
  const unitShare = (cr) => {
    const all = cr.subletContract?.units?.length || 0;
    return all && cr.units?.length ? cr.units.length / all : 1;
  };
  const slabLines = slabCrs.map((cr) => ({
    kind: 'slab',
    checkRequest: String(cr._id),
    checkRequestNumber: cr.checkRequestNumber,
    contractor: cr.contractor?.name,
    crItem: `slab:${cr._id}`,
    title: `Slab: ${cr.slab?.name} (${cr.slab?.percentage}%)${cr.units?.length ? ` · ${cr.units.map((u) => u.name).join(', ')}` : ''}${cr.subletContract?.contractNumber ? ` — ${cr.subletContract.contractNumber}` : ''}`,
    unit: 'stage',
    remaining: 1,
    costAmount: round2(cr.verifiedTotal),
    suggestedClientAmount: cr.subletContract?.clientValue
      ? round2(((Number(cr.subletContract.clientValue) * (Number(cr.slab?.percentage) || 0)) / 100) * unitShare(cr))
      : 0
  }));

  const crs = await CheckRequest.find({ project: projectId, claimType: { $ne: 'Slab' }, status: { $in: ['Verified', 'Billed'] } })
    .populate('contractor', 'name').select('checkRequestNumber title contractor items verifiedAt units').sort({ verifiedAt: 1 }).lean();
  const boqIds = [...new Set(crs.flatMap((c) => c.items.map((i) => String(i.boqItem))))];
  const boqs = await BOQItem.find({ _id: { $in: boqIds } }).select('estimatedUnitPrice title description unit').lean();
  const boqById = new Map(boqs.map((b) => [String(b._id), b]));
  return crs.flatMap((cr) => cr.items.map((i) => {
    const remaining = round2((Number(i.verifiedQuantity) || 0) - (Number(i.clientBilledQuantity) || 0));
    if (remaining <= 0) return null;
    const boq = boqById.get(String(i.boqItem));
    const clientRate = Number(boq?.estimatedUnitPrice) || 0;
    return {
      kind: 'boq',
      checkRequest: String(cr._id),
      checkRequestNumber: cr.checkRequestNumber,
      contractor: cr.contractor?.name,
      crItem: String(i._id),
      boqItem: String(i.boqItem),
      title: `${i.title || boq?.title || boq?.description}${cr.units?.length ? ` · ${cr.units.map((u) => u.name).join(', ')}` : ''}`,
      unit: i.unit || boq?.unit,
      remaining,
      clientRate,
      costRate: Number(i.unitPrice) || 0
    };
  })).filter(Boolean).concat(slabLines);
};

// GET /api/project-management/projects/:id/client-billable — verified work not yet billed to the client
router.get('/projects/:id/client-billable', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  res.json({ success: true, data: await clientBillableLines(req.params.id) });
}));

/** Give a client invoice's verified quantities back (cancel / delete) */
const reverseClientBilling = async (invoice) => {
  for (const src of invoice.clientBillingSources || []) {
    if (!src.crItem) {
      // Slab stage: free it to be billed to the client again
      await CheckRequest.updateOne({ _id: src.checkRequest, clientInvoice: invoice._id }, { $set: { clientBilledAmount: 0, clientInvoice: null } });
      continue;
    }
    const cr = await CheckRequest.findById(src.checkRequest);
    const item = cr?.items.id(src.crItem);
    if (!item) continue;
    item.clientBilledQuantity = Math.max(0, round2((Number(item.clientBilledQuantity) || 0) - (Number(src.quantity) || 0)));
    await cr.save();
  }
};

// POST /api/project-management/projects/:id/invoices — manual / Subcontractor IPC invoice creation
router.post('/projects/:id/invoices', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id).lean();
  if (!project) return notFound(res, 'Project');

  const masterProjectId = project.parentProject || null;

  const { invoiceType = 'Subcontractor_IPC', items = [], retentionPercentage = 0,
    advanceRecoveryAmount: advanceRecoveryInput, whtPercentage = 0, invoiceAmount, description, issueDate, dueDate,
    billingPercentage, milestoneId, milestoneName, notes, clientName, clientContact, clientAddress,
    boqItemId, checkRequestId } = req.body;

  // Subcontractor money goes only through IPCs; the only other bill is the client milestone invoice
  if (!['Subcontractor_IPC', 'Client_Invoice'].includes(invoiceType)) {
    return badRequest(res, 'Invoice type must be a Subcontractor IPC or a Client Milestone Invoice');
  }

  let processedItems = [];
  let grossAmount = 0;
  let ipcNumber = 1;
  let linkedCheckRequest = null;

  // Client Invoice from verified work: bill verified quantities at the BOQ (client) rate, once each
  if (invoiceType === 'Client_Invoice' && Array.isArray(req.body.clientLines) && req.body.clientLines.length) {
    const available = new Map((await clientBillableLines(req.params.id)).map((l) => [l.crItem, l]));
    const lines = [];
    for (const row of req.body.clientLines) {
      const line = available.get(String(row.crItem));
      if (!line) return badRequest(res, 'A selected line is no longer available to bill');
      if (line.kind === 'slab') {
        const slabAmount = round2(row.amount ?? line.suggestedClientAmount);
        if (!(slabAmount > 0)) return badRequest(res, `Enter the client amount for ${line.title}`);
        lines.push({ line, qty: 1, amount: slabAmount });
        continue;
      }
      const qty = round2(row.quantity);
      if (!(qty > 0)) continue;
      if (qty > line.remaining + 1e-6) return badRequest(res, `"${line.title}" has only ${line.remaining} ${line.unit} left to bill to the client`);
      lines.push({ line, qty });
    }
    if (!lines.length) return badRequest(res, 'Enter a quantity to bill on at least one line');
    const prevByBoq = new Map();
    (await ProjectInvoice.find({ project: req.params.id, invoiceType: 'Client_Invoice', status: { $ne: 'Cancelled' } }).select('items').lean())
      .forEach((inv) => (inv.items || []).forEach((i) => prevByBoq.set(String(i.boqItem), (prevByBoq.get(String(i.boqItem)) || 0) + (Number(i.currentQuantity) || 0))));
    const items = lines.map(({ line, qty, amount: slabAmount }) => {
      if (line.kind === 'slab') {
        return { title: line.title, unit: 'stage', previousQuantity: 0, currentQuantity: 1, cumulativeQuantity: 1, unitPrice: slabAmount, currentAmount: slabAmount };
      }
      const previousQuantity = prevByBoq.get(line.boqItem) || 0;
      prevByBoq.set(line.boqItem, previousQuantity + qty);
      return {
        boqItem: line.boqItem, title: line.title, unit: line.unit, previousQuantity, currentQuantity: qty,
        cumulativeQuantity: previousQuantity + qty, unitPrice: line.clientRate, currentAmount: round2(qty * line.clientRate)
      };
    });
    const amount = round2(items.reduce((t, i) => t + i.currentAmount, 0));
    if (!(amount > 0)) return badRequest(res, 'These lines have no client rate on the BOQ — set the BOQ unit price first');
    const project = await ConstructionProject.findById(req.params.id).select('parentProject clientName clientContact address contractValue').lean();
    const invoice = await ProjectInvoice.create({
      project: req.params.id,
      masterProject: project?.parentProject || null,
      invoiceType: 'Client_Invoice',
      items,
      grossAmount: amount,
      netPayableAmount: amount,
      invoiceAmount: amount,
      clientBillingSources: lines.map(({ line, qty, amount: slabAmount }) => (line.kind === 'slab'
        ? { checkRequest: line.checkRequest, quantity: 0, slabAmount, costAmount: line.costAmount }
        : { checkRequest: line.checkRequest, crItem: line.crItem, quantity: qty, costAmount: round2(qty * line.costRate) })),
      clientName: clientName || project?.clientName || '',
      clientContact: clientContact || project?.clientContact || '',
      clientAddress: clientAddress || project?.address || '',
      contractValue: project?.contractValue || 0,
      description: description || 'Client invoice for verified work',
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      notes,
      createdBy: req.user?._id
    });
    for (const { line, qty, amount: slabAmount } of lines) {
      if (line.kind === 'slab') {
        await CheckRequest.updateOne({ _id: line.checkRequest }, { $set: { clientBilledAmount: slabAmount, clientInvoice: invoice._id } });
      } else {
        await CheckRequest.updateOne({ _id: line.checkRequest, 'items._id': line.crItem }, { $inc: { 'items.$.clientBilledQuantity': qty } });
      }
    }
    await syncProjectInvoiceTotals(req.params.id);
    if (project?.parentProject) await syncProjectInvoiceTotals(project.parentProject);
    const populated = await ProjectInvoice.findById(invoice._id).lean();
    return res.status(201).json({ success: true, message: `Client invoice created — ${amount} for verified work`, data: populated });
  }

  // Subcontractor IPC must come from a Verified Check Request
  if (invoiceType === 'Subcontractor_IPC') {
    if (!checkRequestId || !isValidId(checkRequestId)) {
      return badRequest(res, 'Select a Verified Check Request before creating a Subcontractor IPC');
    }
    linkedCheckRequest = await CheckRequest.findOne({
      _id: checkRequestId,
      project: req.params.id,
      status: 'Verified'
    });
    if (!linkedCheckRequest) {
      return badRequest(res, 'Check Request not found or not in Verified status');
    }
  }

  // An IPC pays the subcontractor who raised the check request — never someone picked on the form
  if (linkedCheckRequest) {
    if (!linkedCheckRequest.contractor) return badRequest(res, 'This check request has no subcontractor to pay');
    const lastIpc = await ProjectInvoice.findOne({
      project: req.params.id,
      contractor: linkedCheckRequest.contractor,
      invoiceType: 'Subcontractor_IPC'
    }).sort({ ipcNumber: -1 }).select('ipcNumber').lean();
    ipcNumber = (Number(lastIpc?.ipcNumber) || 0) + 1;
  }

  const slabClaim = linkedCheckRequest?.claimType === 'Slab';
  if (slabClaim) {
    grossAmount = checkRequestBillable(linkedCheckRequest);
    if (grossAmount <= 0) return badRequest(res, 'This slab has already been billed');
  } else if (linkedCheckRequest) {

    const built = await buildIpcLines(req.params.id, linkedCheckRequest, items);
    if (built.error) return badRequest(res, built.error);
    processedItems = built.processedItems;
    grossAmount = built.grossAmount;
  } else if (Array.isArray(items) && items.length > 0) {
    // Non-IPC invoices may still use free BOQ lines
    for (const itemInput of items) {
      if (!itemInput.boqItemId || !isValidId(itemInput.boqItemId)) continue;
      const searchCriteria = masterProjectId
        ? { _id: itemInput.boqItemId, $or: [{ project: req.params.id }, { project: masterProjectId }] }
        : { _id: itemInput.boqItemId, project: req.params.id };

      const boq = await BOQItem.findOne(searchCriteria);
      if (!boq) continue;

      const previousQuantity = Number(boq.contractorBilledQuantity) || 0;
      const currentQuantity = Number(itemInput.currentQuantity) || 0;
      const cumulativeQuantity = previousQuantity + currentQuantity;

      if (cumulativeQuantity > boq.estimatedQuantity) {
        return badRequest(
          res,
          `Billing quantity for item "${boq.title || boq.description}" (${cumulativeQuantity} ${boq.unit}) exceeds authorized BOQ estimated quantity (${boq.estimatedQuantity} ${boq.unit}).`
        );
      }

      const unitPrice = Number(itemInput.unitPrice) || Number(boq.contractorUnitPrice) || Number(boq.estimatedUnitPrice) || 0;
      const currentAmount = currentQuantity * unitPrice;
      grossAmount += currentAmount;

      processedItems.push({
        boqItem: boq._id,
        title: boq.title || '',
        description: boq.description || '',
        unit: boq.unit || '',
        previousQuantity,
        currentQuantity,
        cumulativeQuantity,
        unitPrice,
        currentAmount
      });
    }
  }

  const computedGross = processedItems.length > 0 || slabClaim;
  const finalGross = computedGross ? grossAmount : (Number(invoiceAmount) || 0);
  if (finalGross <= 0 && (!invoiceAmount || Number(invoiceAmount) <= 0)) {
    return badRequest(res, 'Invoice amount or valid BOQ executed line items are required');
  }

  let advanceRecoveryAmount = 0;
  if (linkedCheckRequest) {
    const recovery = await resolveAdvanceRecovery(req.params.id, linkedCheckRequest.contractor, finalGross, advanceRecoveryInput);
    if (recovery.error) return badRequest(res, recovery.error);
    advanceRecoveryAmount = recovery.amount;
  }

  const retentionP = Number(retentionPercentage) || 0;
  const whtP = Number(whtPercentage) || 0;
  const advRec = Number(advanceRecoveryAmount) || 0;
  if (retentionP < 0 || retentionP > 100) return badRequest(res, 'Retention must be between 0% and 100%');
  if (whtP < 0 || whtP > 100) return badRequest(res, 'WHT must be between 0% and 100%');
  if (advRec < 0) return badRequest(res, 'Advance recovery cannot be negative');
  const retentionAmount = Math.round(finalGross * (retentionP / 100) * 100) / 100;
  const whtAmount = Math.round(finalGross * (whtP / 100) * 100) / 100;
  if (computedGross && retentionAmount + whtAmount + advRec > finalGross) {
    return badRequest(res, `Deductions (${retentionAmount + whtAmount + advRec}) exceed the gross bill (${finalGross})`);
  }

  let netPayableAmount = Math.max(0, Math.round((finalGross - retentionAmount - advRec - whtAmount) * 100) / 100);
  // Barter / Mixed contracts: part of the work is settled in property, the rest is cash
  let barter = { propertyPercent: 0, propertySettlementAmount: 0 };
  if (linkedCheckRequest && computedGross) {
    const share = await ipcPropertyPercent(req.params.id, linkedCheckRequest.contractor, linkedCheckRequest.subletContract);
    if (share.error) return badRequest(res, share.error);
    const split = barterSplit({ gross: finalGross, retentionAmount, advanceRecoveryAmount: advRec, whtAmount }, share.percent);
    if (split.error) return badRequest(res, split.error);
    barter = split;
    netPayableAmount = split.netPayableAmount;
  }
  const finalInvoiceAmt = computedGross ? netPayableAmount : Number(invoiceAmount);

  // Client invoices bill the client — they never carry a subcontractor
  const invoiceContractor = linkedCheckRequest ? linkedCheckRequest.contractor : null;

  const invoice = await ProjectInvoice.create({
    project: req.params.id,
    masterProject: masterProjectId,
    contractor: invoiceContractor,
    invoiceType,
    ipcNumber,
    items: processedItems.map(({ _crItemId, ...rest }) => rest),
    grossAmount: finalGross,
    retentionPercentage: retentionP,
    retentionAmount,
    advanceRecoveryAmount: advRec,
    whtPercentage: whtP,
    whtAmount,
    netPayableAmount,
    propertyPercent: barter.propertyPercent,
    propertySettlementAmount: barter.propertySettlementAmount,
    milestoneId: milestoneId || null,
    milestoneName: milestoneName || '',
    boqItemId: boqItemId || null,
    checkRequest: linkedCheckRequest?._id || null,
    clientName: clientName || project.clientName || '',
    clientContact: clientContact || project.clientContact || '',
    clientAddress: clientAddress || project.address || '',
    contractValue: project.contractValue || 0,
    billingPercentage: Number(billingPercentage) || 0,
    invoiceAmount: finalInvoiceAmt,
    description: description || (invoiceType === 'Subcontractor_IPC'
      ? `IPC #${ipcNumber} from ${linkedCheckRequest.checkRequestNumber}${slabClaim
        ? ` — Slab: ${linkedCheckRequest.slab?.name} (${linkedCheckRequest.slab?.percentage}%)${linkedCheckRequest.units?.length ? ` · ${linkedCheckRequest.units.map((u) => u.name).join(', ')}` : ''}`
        : ''}`
      : ''),
    issueDate: issueDate ? new Date(issueDate) : new Date(),
    dueDate: dueDate ? new Date(dueDate) : undefined,
    notes,
    createdBy: req.user?._id
  });

  // Update BOQ + Check Request billed quantities (client invoices don't bill the subcontractor)
  if (linkedCheckRequest) {
    await applyIpcBilling(linkedCheckRequest, processedItems, invoice._id, req.user?._id);
  }

  await syncProjectInvoiceTotals(req.params.id);
  if (masterProjectId) {
    await syncProjectInvoiceTotals(masterProjectId);
  }
  await syncProjectMetrics(req.params.id);

  const populated = await ProjectInvoice.findById(invoice._id)
    .populate('contractor', 'name email phone vendorType')
    .populate('createdBy', 'firstName lastName')
    .populate('checkRequest', 'checkRequestNumber title status')
    .populate('items.boqItem', 'title description unit estimatedQuantity estimatedUnitPrice contractorUnitPrice contractorBilledQuantity')
    .lean();

  res.status(201).json({ success: true, message: 'Invoice created successfully', data: populated });
}));

// POST /api/project-management/projects/:id/milestones/:msId/generate-invoice
// Auto-generate invoice from a milestone with billingTrigger
router.post('/projects/:id/milestones/:msId/generate-invoice', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id);
  if (!project) return notFound(res, 'Project');

  const ms = project.milestones.id(req.params.msId);
  if (!ms) return notFound(res, 'Milestone');

  if (!ms.billingTrigger) return badRequest(res, 'This milestone does not have billing trigger enabled');
  if (!project.contractValue) return badRequest(res, 'Project contract value is not set. Please set it before generating invoices.');

  const invoiceAmount = (ms.billingPercentage / 100) * project.contractValue;
  if (invoiceAmount <= 0) return badRequest(res, 'Calculated invoice amount is zero. Check billing percentage and contract value.');

  // Check if invoice already generated for this milestone
  const existing = await ProjectInvoice.findOne({ project: req.params.id, milestoneId: ms._id });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: `Invoice ${existing.invoiceNumber} already generated for this milestone`
    });
  }

  const dueDate = req.body.dueDate
    ? new Date(req.body.dueDate)
    : ms.plannedDate ? new Date(ms.plannedDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const invoice = await ProjectInvoice.create({
    project: req.params.id,
    milestoneId: ms._id,
    milestoneName: ms.title,
    clientName: project.clientName || '',
    clientContact: project.clientContact || '',
    clientAddress: project.address || '',
    contractValue: project.contractValue,
    billingPercentage: ms.billingPercentage,
    invoiceAmount,
    description: `Milestone payment: ${ms.title} (${ms.billingPercentage}% of contract value)`,
    issueDate: new Date(),
    dueDate,
    notes: req.body.notes || '',
    createdBy: req.user?._id
  });

  await syncProjectInvoiceTotals(req.params.id);
  res.status(201).json({ success: true, message: `Invoice ${invoice.invoiceNumber} generated for milestone "${ms.title}"`, data: invoice });
}));

// PUT /api/project-management/projects/:id/invoices/:invoiceId
router.put('/projects/:id/invoices/:invoiceId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.invoiceId)) return badRequest(res, 'Invalid ID');

  const invoice = await ProjectInvoice.findOne({ _id: req.params.invoiceId, project: req.params.id });
  if (!invoice) return notFound(res, 'Invoice');
  if (invoice.status === 'Cancelled') return badRequest(res, 'Cancelled invoices cannot be edited');

  const isIpc = invoice.invoiceType === 'Subcontractor_IPC';
  const inChain = isIpc || (invoice.invoiceType === 'Client_Invoice' && invoice.status === 'Draft');
  if (inChain && !ipcWithInitiator(invoice)) {
    return badRequest(res, `This IPC is ${invoice.approvalStatus} — it can only be edited while Draft or Rejected`);
  }
  // IPC amounts come from the verified check request; payments use /payments; cancelling uses /cancel
  const allowed = isIpc
    ? ['description', 'issueDate', 'dueDate', 'notes']
    : ['invoiceAmount', 'description', 'issueDate', 'dueDate', 'notes', 'clientName', 'clientContact',
      'clientAddress', 'billingPercentage', 'boqItemId'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) invoice[k] = req.body[k]; });

  if (req.body.status !== undefined && req.body.status !== invoice.status) {
    if (req.body.status !== 'Sent' || invoice.status !== 'Draft') {
      return badRequest(res, 'Only Draft → Sent can be set here; record payments or cancel with their own actions');
    }
    if (invoice.invoiceType === 'Client_Invoice') {
      return badRequest(res, 'Client invoices are sent once the CEO approves them — submit it for approval');
    }
    invoice.status = 'Sent';
  }
  if (!isIpc && req.body.invoiceAmount !== undefined && (invoice.clientBillingSources || []).length
    && Number(req.body.invoiceAmount) !== Number(invoice.grossAmount)) {
    return badRequest(res, 'This client invoice is priced from verified work — cancel it and raise a new one to change the amount');
  }
  if (!isIpc && req.body.invoiceAmount !== undefined && (Number(invoice.paidAmount) || 0) > Number(invoice.invoiceAmount)) {
    return badRequest(res, 'Invoice amount cannot be less than what has already been paid');
  }

  await invoice.save();
  await syncProjectInvoiceTotals(req.params.id);
  await syncProjectMetrics(req.params.id);
  res.json({ success: true, message: 'Invoice updated', data: invoice });
}));

// POST /api/project-management/projects/:id/invoices/:invoiceId/payments — record a (part) payment
router.post('/projects/:id/invoices/:invoiceId/payments', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.invoiceId)) return badRequest(res, 'Invalid ID');

  const invoice = await ProjectInvoice.findOne({ _id: req.params.invoiceId, project: req.params.id });
  if (!invoice) return notFound(res, 'Invoice');
  if (['Cancelled', 'Paid'].includes(invoice.status)) return badRequest(res, `This invoice is already ${invoice.status.toLowerCase()}`);
  if (invoice.invoiceType === 'Subcontractor_IPC') {
    return badRequest(res, 'Subcontractor IPCs are paid by Finance from their Accounts Payable bill once the CEO approves them');
  }
  if (invoice.financeArId) {
    return badRequest(res, `This invoice is in Finance as receivable ${invoice.financeArNumber} — record the receipt there`);
  }
  if (invoice.invoiceType === 'Client_Invoice' && invoice.status === 'Draft') {
    return badRequest(res, 'Submit the client invoice for approval — receipts are recorded in Finance once the CEO approves it');
  }

  const amount = Math.round((Number(req.body.amount) || 0) * 100) / 100;
  const balance = invoiceBalance(invoice);
  if (amount <= 0) return badRequest(res, 'Payment amount must be greater than zero');
  if (amount > balance + 0.009) return badRequest(res, `Payment exceeds the balance due (${balance})`);

  invoice.payments.push({
    amount,
    paidDate: req.body.paidDate ? new Date(req.body.paidDate) : new Date(),
    paymentMethod: req.body.paymentMethod || '',
    paymentReference: req.body.paymentReference || '',
    recordedBy: req.user?._id
  });
  invoice.paidAmount = Math.round(invoice.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
  invoice.paidDate = invoice.payments[invoice.payments.length - 1].paidDate;
  invoice.paymentMethod = req.body.paymentMethod || invoice.paymentMethod;
  invoice.paymentReference = req.body.paymentReference || invoice.paymentReference;
  invoice.status = invoiceBalance(invoice) <= 0.009 ? 'Paid' : 'Partially Paid';
  await invoice.save();

  await syncProjectInvoiceTotals(req.params.id);
  await syncProjectMetrics(req.params.id);
  res.json({
    success: true,
    message: invoice.status === 'Paid' ? 'Payment recorded — fully paid' : `Payment recorded — ${invoiceBalance(invoice)} still due`,
    data: invoice
  });
}));

// POST /api/project-management/projects/:id/invoices/:invoiceId/cancel — void an unpaid invoice, freeing its work to rebill
router.post('/projects/:id/invoices/:invoiceId/cancel', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.invoiceId)) return badRequest(res, 'Invalid ID');

  const invoice = await ProjectInvoice.findOne({ _id: req.params.invoiceId, project: req.params.id });
  if (!invoice) return notFound(res, 'Invoice');
  if (invoice.status === 'Cancelled') return badRequest(res, 'Already cancelled');
  if ((Number(invoice.paidAmount) || 0) > 0) return badRequest(res, 'Payments have been recorded — a paid invoice cannot be cancelled');
  if (invoice.invoiceType === 'Subcontractor_IPC' && !ipcWithInitiator(invoice)) {
    return badRequest(res, `This IPC is ${invoice.approvalStatus} — it can only be cancelled while Draft or Rejected`);
  }
  if (invoice.invoiceType === 'Client_Invoice' && !ipcWithInitiator(invoice) && invoice.approvalStatus !== 'Approved') {
    return badRequest(res, `This invoice is ${invoice.approvalStatus} — it can only be cancelled while Draft, Rejected or after approval`);
  }
  const arReversal = await reverseClientInvoiceInFinance(invoice, req.user?._id);
  if (!arReversal.ok) return badRequest(res, arReversal.error);

  await reverseIpcBilling(invoice, req.user?._id);
  await reverseClientBilling(invoice);
  invoice.status = 'Cancelled';
  invoice.cancelledAt = new Date();
  invoice.cancellationReason = String(req.body?.reason || '').trim();
  await invoice.save();

  await syncProjectInvoiceTotals(req.params.id);
  await syncProjectMetrics(req.params.id);
  res.json({ success: true, message: 'Invoice cancelled — its verified work can be billed again', data: invoice });
}));

// DELETE /api/project-management/projects/:id/invoices/:invoiceId — Draft only (anything sent is cancelled instead)
router.delete('/projects/:id/invoices/:invoiceId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.invoiceId)) return badRequest(res, 'Invalid ID');

  const invoice = await ProjectInvoice.findOne({ _id: req.params.invoiceId, project: req.params.id });
  if (!invoice) return notFound(res, 'Invoice');
  if (invoice.status !== 'Draft' || (Number(invoice.paidAmount) || 0) > 0
    || (['Subcontractor_IPC', 'Client_Invoice'].includes(invoice.invoiceType) && (invoice.approvalStatus || 'Draft') !== 'Draft')) {
    return badRequest(res, 'Only unpaid Draft invoices that were never submitted can be deleted — cancel it instead to keep the record');
  }

  // A cancelled IPC was already reversed; anything else gives its work back before it goes
  await reverseIpcBilling(invoice, req.user?._id);
  await reverseClientBilling(invoice);
  await invoice.deleteOne();

  await syncProjectInvoiceTotals(req.params.id);
  await syncProjectMetrics(req.params.id);
  res.json({ success: true, message: 'Invoice deleted' });
}));

// ─── IPC APPROVAL CHAIN ──────────────────────────────────────────────────────
// Draft → Pending Audit (pre-audit initial approval, then forward) → Forwarded to Audit Director →
// Send to CEO Office (PS forwards) → Forwarded to CEO → Approved → posted to Finance (AP).
// Any desk can reject: IPC goes back to its initiator as Rejected (returnedFromStatus = that desk);
// after revising, resubmission returns it straight to the desk that rejected it.

const IPC_STAGE_LABEL = {
  'Pending Audit': 'Pre-Audit',
  'Forwarded to Audit Director': 'Audit Director',
  'Send to CEO Office': 'CEO Secretariat',
  'Forwarded to CEO': 'CEO'
};

/** IPC is back with the project team (never submitted, or rejected) */
const ipcWithInitiator = (inv) => ['Draft', 'Rejected', undefined, null, ''].includes(inv.approvalStatus);

const userIdsByRoles = async (roles) =>
  (await User.find({ isActive: true, role: { $in: roles } }).select('_id').lean()).map((u) => String(u._id));

const notifyIpc = async (recipientIds, actorId, title, message, invoice, actionUrl) => {
  const ids = [...new Set((recipientIds || []).map(String).filter(Boolean))].filter((id) => id !== String(actorId || ''));
  if (!ids.length) return;
  try {
    await createAndEmitNotification({
      recipientIds: ids,
      title,
      message,
      type: 'info',
      category: 'approval',
      priority: 'high',
      actionUrl,
      entityId: invoice._id,
      entityType: 'ProjectInvoice',
      module: 'project_management',
      metadata: { entityId: invoice._id, entityType: 'ProjectInvoice', projectId: invoice.project }
    });
  } catch (err) {
    console.error('[IPC workflow] notification failed:', err.message);
  }
};

const ipcInitiatorUrl = (inv) => `/general/project-management/${inv.project?._id || inv.project}?tab=invoices`;

const pushIpcHistory = (inv, from, to, userId, comments, module) => {
  inv.workflowHistory = inv.workflowHistory || [];
  inv.workflowHistory.push({ fromStatus: from, toStatus: to, changedBy: userId, changedAt: new Date(), comments: comments || '', module });
};

const populateIpc = (query) =>
  query
    .populate('contractor', 'name email phone')
    .populate({ path: 'project', select: 'name projectNumber sector society parentProject companyId', populate: { path: 'parentProject', select: 'name projectNumber companyId' } })
    .populate('checkRequest', 'checkRequestNumber title claimType slab verifiedBy verifiedAt')
    .populate('createdBy', 'firstName lastName email')
    .populate('submittedBy', 'firstName lastName email')
    .populate('workflowHistory.changedBy', 'firstName lastName email employeeId digitalSignature approvalStamp')
    .populate('observations.addedBy', 'firstName lastName')
    .populate('preAuditInitialApprovedBy auditApprovedBy ceoForwardedBy ceoApprovedBy', 'firstName lastName digitalSignature')
    .populate('rejection.by', 'firstName lastName');

const loadIpc = async (req, res) => {
  if (!isValidId(req.params.ipcId)) { badRequest(res, 'Invalid IPC ID'); return null; }
  // Subcontractor IPCs and client invoices share the approval chain
  const inv = await ProjectInvoice.findOne({ _id: req.params.ipcId, invoiceType: { $in: ['Subcontractor_IPC', 'Client_Invoice'] } });
  if (!inv) { notFound(res, 'IPC'); return null; }
  return inv;
};

const ipcDone = async (res, inv, message) => {
  const data = await populateIpc(ProjectInvoice.findById(inv._id)).lean();
  return res.json({ success: true, message, data });
};

/** Reject from any desk: back to the initiator with comments + observations; remembers the desk */
const rejectIpc = async (req, res, inv, stage) => {
  const comments = String(req.body.rejectionComments || req.body.returnComments || req.body.comments || '').trim();
  if (!comments) return badRequest(res, 'Write the reason for rejection');
  pushIpcHistory(inv, stage, 'Rejected', req.user._id, comments, IPC_STAGE_LABEL[stage]);
  inv.approvalStatus = 'Rejected';
  inv.returnedFromStatus = stage;
  inv.rejection = { stage, by: req.user._id, at: new Date(), comments };
  (Array.isArray(req.body.observations) ? req.body.observations : []).forEach((o) => {
    const text = String(o?.observation || o?.text || o || '').trim();
    if (!text) return;
    inv.observations.push({
      observation: text,
      severity: ['low', 'medium', 'high', 'critical'].includes(String(o?.severity).toLowerCase()) ? String(o.severity).toLowerCase() : 'medium',
      stage: IPC_STAGE_LABEL[stage],
      addedBy: req.user._id
    });
  });
  inv.updatedBy = req.user._id;
  await inv.save();
  await notifyIpc([inv.createdBy, inv.submittedBy], req.user._id, `IPC ${inv.invoiceNumber} rejected by ${IPC_STAGE_LABEL[stage]}`,
    `Reason: ${comments}. Revise it in Project Management → Invoices and resubmit.`, inv, ipcInitiatorUrl(inv));
  return ipcDone(res, inv, `IPC rejected — sent back to the initiator`);
};

// GET /api/project-management/ipcs/ceo-secretariat — CEO Secretariat (PS) and CEO queues
router.get('/ipcs/ceo-secretariat', asyncHandler(async (req, res) => {
  const statuses = [];
  if (hasCeoSecretariatCoordinatorAccess(req.user)) statuses.push('Send to CEO Office', 'Forwarded to CEO', 'Approved', 'Rejected');
  if (isDesignatedCeoApprover(req.user)) statuses.push('Forwarded to CEO');
  if (!statuses.length) return res.json({ success: true, data: [] });
  const filter = { invoiceType: { $in: ['Subcontractor_IPC', 'Client_Invoice'] }, approvalStatus: { $in: [...new Set(statuses)] } };
  // Finished items only for the recent past so the queue stays readable
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const list = await populateIpc(ProjectInvoice.find({
    ...filter,
    $or: [{ approvalStatus: { $in: ['Send to CEO Office', 'Forwarded to CEO'] } }, { updatedAt: { $gte: since } }]
  }).sort({ updatedAt: -1 }).limit(300)).lean();
  res.json({ success: true, data: list });
}));

// GET /api/project-management/ipcs/desk-report — average days per desk + IPCs waiting now
router.get('/ipcs/desk-report', asyncHandler(async (req, res) => {
  const { buildDeskReport } = require('../utils/projectIpcReminders');
  const sinceDays = Math.min(730, Math.max(7, Number(req.query.days) || 180));
  res.json({ success: true, data: await buildDeskReport({ sinceDays }) });
}));

// GET /api/project-management/ipcs/:ipcId — full IPC for any desk in the chain
router.get('/ipcs/:ipcId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.ipcId)) return badRequest(res, 'Invalid IPC ID');
  const data = await populateIpc(ProjectInvoice.findOne({ _id: req.params.ipcId, invoiceType: { $in: ['Subcontractor_IPC', 'Client_Invoice'] } })).lean();
  if (!data) return notFound(res, 'IPC');
  res.json({ success: true, data });
}));

// GET /api/project-management/ipcs/:ipcId/dossier — certificate + all supporting records for every review desk
router.get('/ipcs/:ipcId/dossier', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.ipcId)) return badRequest(res, 'Invalid IPC ID');
  const ipc = await populateIpc(ProjectInvoice.findOne({ _id: req.params.ipcId, invoiceType: { $in: ['Subcontractor_IPC', 'Client_Invoice'] } })).lean();
  if (!ipc) return notFound(res, 'IPC');
  const { buildIpcDossier } = require('../utils/ipcDossier');
  const data = await buildIpcDossier(ipc, { subcontractorBalances, resolveProjectCompanyId });
  res.json({ success: true, data });
}));

/** Advance against a sublet contract: contract must be Active; all live advances on it stay within its value */
const checkAdvanceAmount = async (contractId, amount, excludeInvoiceId = null) => {
  if (!(amount > 0)) return { error: 'Enter the advance amount' };
  const contract = contractId ? await SubletContract.findById(contractId).select('status totalAmount contractNumber').lean() : null;
  if (!contract) return { error: 'Sublet contract not found' };
  if (contract.status !== 'Active') return { error: `Advances are paid only against Active contracts (${contract.contractNumber} is ${contract.status})` };
  const filter = { subletContract: contract._id, ipcKind: 'Advance', status: { $ne: 'Cancelled' } };
  if (excludeInvoiceId) filter._id = { $ne: excludeInvoiceId };
  const others = round2((await ProjectInvoice.find(filter).select('grossAmount').lean()).reduce((t, r) => t + (Number(r.grossAmount) || 0), 0));
  if (others + amount > (Number(contract.totalAmount) || 0) + 0.01) {
    return { error: `Advances (${others + amount}) would exceed contract ${contract.contractNumber}'s value (${contract.totalAmount})` };
  }
  return { contract };
};

/** Retention release: only retention already held on CEO-approved Work IPCs, minus earlier / pending releases */
const checkRetentionRelease = async (projectId, contractorId, amount, excludeInvoiceId = null) => {
  if (!(amount > 0)) return { error: 'Enter the retention amount to release' };
  const bal = await subcontractorBalances(projectId, contractorId, excludeInvoiceId);
  if (amount > bal.retentionAvailable + 0.01) {
    return { error: `Only ${bal.retentionAvailable} of retention is held and not yet released for this subcontractor` };
  }
  return { bal };
};

/** Shared create for the non-work IPC kinds (no check request, no deductions) */
const createNonWorkIpc = async (req, { kind, contractor, amount, subletContract = null, recoveryPercent = 0, propertyPercent = 0 }) => {
  const split = barterSplit({ kind, gross: amount }, propertyPercent);
  const project = await ConstructionProject.findById(req.params.id).select('parentProject').lean();
  const lastIpc = await ProjectInvoice.findOne({ project: req.params.id, contractor, invoiceType: 'Subcontractor_IPC' })
    .sort({ ipcNumber: -1 }).select('ipcNumber').lean();
  const ipcNumber = (Number(lastIpc?.ipcNumber) || 0) + 1;
  return ProjectInvoice.create({
    project: req.params.id,
    masterProject: project?.parentProject || null,
    contractor,
    invoiceType: 'Subcontractor_IPC',
    ipcKind: kind,
    ipcNumber,
    subletContract,
    advanceRecoveryPercent: kind === 'Advance' ? recoveryPercent : 0,
    items: [],
    grossAmount: amount,
    netPayableAmount: split.netPayableAmount,
    propertyPercent: split.propertyPercent,
    propertySettlementAmount: split.propertySettlementAmount,
    invoiceAmount: split.netPayableAmount,
    description: req.body.description || `${kind} — IPC #${ipcNumber}`,
    issueDate: req.body.issueDate ? new Date(req.body.issueDate) : new Date(),
    dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
    notes: req.body.notes || '',
    createdBy: req.user?._id
  });
};

// GET /api/project-management/projects/:id/subcontractor-balances[?contractor=] — retention & advance position
router.get('/projects/:id/subcontractor-balances', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const contractorIds = req.query.contractor && isValidId(req.query.contractor)
    ? [req.query.contractor]
    // Contractors of cancelled contracts stay listed — retention, advances and unpaid bills may still be open
    : (await SubletContract.distinct('contractor', { project: req.params.id, $or: [{ status: { $ne: 'Cancelled' } }, { activatedAt: { $ne: null } }] })).map(String);
  const suppliers = await Supplier.find({ _id: { $in: contractorIds } }).select('name').lean();
  const nameById = new Map(suppliers.map((sp) => [String(sp._id), sp.name]));
  const contracts = await SubletContract.find({ project: req.params.id, contractor: { $in: contractorIds }, status: { $in: ['Active', 'Cancelled'] } })
    .select('contractNumber title contractType totalAmount contractor status activatedAt cancellation.cancellationDate cancellation.workDone.amount').lean();
  const data = await Promise.all(contractorIds.map(async (cid) => ({
    contractor: { _id: cid, name: nameById.get(String(cid)) || '—' },
    activeContracts: contracts.filter((c) => c.status === 'Active' && String(c.contractor) === String(cid)),
    cancelledContracts: contracts.filter((c) => c.status === 'Cancelled' && c.activatedAt && String(c.contractor) === String(cid))
      .map((c) => ({ _id: c._id, contractNumber: c.contractNumber, title: c.title, cancellationDate: c.cancellation?.cancellationDate || null, workDone: round2(c.cancellation?.workDone?.amount) })),
    ...(await subcontractorBalances(req.params.id, cid))
  })));
  res.json({ success: true, data });
}));

// POST /api/project-management/projects/:id/advances — mobilisation advance IPC against an active sublet contract
router.post('/projects/:id/advances', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const amount = round2(req.body.amount);
  const recoveryPercent = Number(req.body.recoveryPercent);
  if (!(recoveryPercent > 0 && recoveryPercent <= 100)) {
    return badRequest(res, 'Set the recovery % — the share of each later IPC deducted until the advance is recovered');
  }
  if (!isValidId(req.body.subletContract)) return badRequest(res, 'Select the sublet contract');
  const check = await checkAdvanceAmount(req.body.subletContract, amount);
  if (check.error) return badRequest(res, check.error);
  const contract = await SubletContract.findOne({ _id: req.body.subletContract, project: req.params.id }).select('contractor').lean();
  if (!contract) return badRequest(res, 'That contract is not on this Sub Project');
  const inv = await createNonWorkIpc(req, { kind: 'Advance', contractor: contract.contractor, amount, subletContract: contract._id, recoveryPercent });
  await syncProjectInvoiceTotals(req.params.id);
  return ipcDone(res.status(201), inv, `Advance IPC created — submit it for approval`);
}));

// POST /api/project-management/projects/:id/retention-releases — pay back retention held from a subcontractor
router.post('/projects/:id/retention-releases', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.body.contractor)) return badRequest(res, 'Select the subcontractor');
  if (!String(req.body.description || '').trim()) {
    return badRequest(res, 'Say why retention is being released (e.g. defects liability period ended on …)');
  }
  const amount = round2(req.body.amount);
  const check = await checkRetentionRelease(req.params.id, req.body.contractor, amount);
  if (check.error) return badRequest(res, check.error);
  // Retention released on a barter contract is settled in the same cash / property share
  const share = await ipcPropertyPercent(req.params.id, req.body.contractor);
  if (share.error) return badRequest(res, share.error);
  const inv = await createNonWorkIpc(req, { kind: 'Retention Release', contractor: req.body.contractor, amount, propertyPercent: share.percent });
  await syncProjectInvoiceTotals(req.params.id);
  return ipcDone(res.status(201), inv, 'Retention release IPC created — submit it for approval');
}));

// POST /api/project-management/ipcs/:ipcId/submit — initiator sends a Draft IPC to Pre-Audit
router.post('/ipcs/:ipcId/submit', asyncHandler(async (req, res) => {
  const inv = await loadIpc(req, res); if (!inv) return;
  if ((inv.approvalStatus || 'Draft') !== 'Draft') return badRequest(res, `This IPC is already ${inv.approvalStatus}`);
  if (inv.status === 'Cancelled') return badRequest(res, 'Cancelled IPCs cannot be submitted');
  if (inv.invoiceType === 'Client_Invoice' && inv.status !== 'Draft') {
    return badRequest(res, 'This client invoice was already issued before the approval chain existed');
  }
  // IPCs paid from Project Management before the approval chain existed must not reach Finance a second time
  if ((Number(inv.paidAmount) || 0) > 0) return badRequest(res, 'This IPC was already paid outside the approval chain and cannot be submitted');
  const project = await ConstructionProject.findById(inv.project).select('name companyId parentProject').lean();
  if (!(await resolveProjectCompanyId(project))) {
    const main = await findMainProject(project);
    return badRequest(res, `Main Project "${main?.name || project?.name || ''}" has no Finance Company — open Projects, edit "${main?.name || 'the Main Project'}", select its Finance Company and submit again`);
  }
  pushIpcHistory(inv, 'Draft', 'Pending Audit', req.user._id, req.body.comments || 'Submitted for pre-audit', 'Project Management');
  inv.approvalStatus = 'Pending Audit';
  inv.submittedBy = req.user._id;
  inv.submittedAt = new Date();
  // IPCs count as issued once submitted; a client invoice stays Draft until the CEO approves it
  if (inv.status === 'Draft' && inv.invoiceType === 'Subcontractor_IPC') inv.status = 'Sent';
  await inv.save();
  await notifyIpc(await userIdsByRoles(['audit_manager', 'auditor', 'admin', 'super_admin']), req.user._id,
    `${inv.invoiceType === 'Client_Invoice' ? 'Client invoice' : 'IPC'} ${inv.invoiceNumber} pending pre-audit`,
    `${inv.invoiceType === 'Client_Invoice' ? `Client invoice for ${inv.clientName || 'the client'}` : `Subcontractor IPC #${inv.ipcNumber}`} — PKR ${Number(inv.netPayableAmount || inv.invoiceAmount || 0).toLocaleString()} is waiting in Pre-Audit.`,
    inv, '/audit/pre-audit');
  return ipcDone(res, inv, 'IPC submitted to Pre-Audit');
}));

// POST /api/project-management/ipcs/:ipcId/resubmit — after revising, back to the desk that rejected it
router.post('/ipcs/:ipcId/resubmit', asyncHandler(async (req, res) => {
  const inv = await loadIpc(req, res); if (!inv) return;
  if (inv.approvalStatus !== 'Rejected') return badRequest(res, 'Only rejected IPCs can be resubmitted');
  const comments = String(req.body.comments || '').trim();
  if (!comments) return badRequest(res, 'Write what you changed / your response to the observations');
  const target = IPC_STAGE_LABEL[inv.returnedFromStatus] ? inv.returnedFromStatus : 'Pending Audit';
  // Rejected at the first desk → that desk approves again from scratch
  if (target === 'Pending Audit') {
    inv.preAuditInitialApprovedAt = undefined;
    inv.preAuditInitialApprovedBy = undefined;
  }
  inv.observations.forEach((o) => {
    if (!o.resolved) { o.resolved = true; o.initiatorResponse = comments; }
  });
  pushIpcHistory(inv, 'Rejected', target, req.user._id, `Resubmitted: ${comments}`, 'Project Management');
  inv.approvalStatus = target;
  inv.returnedFromStatus = '';
  inv.updatedBy = req.user._id;
  await inv.save();
  const recipients = target === 'Forwarded to CEO'
    ? await userIdsByRoles(['higher_management', 'admin', 'super_admin'])
    : target === 'Send to CEO Office'
      ? await userIdsByRoles(['hr_manager', 'admin', 'super_admin'])
      : await userIdsByRoles(['audit_manager', 'auditor', 'audit_director', 'admin', 'super_admin']);
  await notifyIpc(recipients, req.user._id, `IPC ${inv.invoiceNumber} resubmitted`,
    `Revised IPC is back with ${IPC_STAGE_LABEL[target]}: ${comments}`, inv, target.startsWith('Pending') || target.includes('Audit') ? '/audit/pre-audit' : '/general/ceo-secretariat/payments');
  return ipcDone(res, inv, `Resubmitted to ${IPC_STAGE_LABEL[target]}`);
}));

// POST /api/project-management/projects/:id/invoices/:invoiceId/revise — initiator edits quantities / deductions while Draft or Rejected
router.post('/projects/:id/invoices/:invoiceId/revise', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.invoiceId)) return badRequest(res, 'Invalid ID');
  const inv = await ProjectInvoice.findOne({ _id: req.params.invoiceId, project: req.params.id, invoiceType: 'Subcontractor_IPC' });
  if (!inv) return notFound(res, 'IPC');
  if (!ipcWithInitiator(inv) || inv.status === 'Cancelled') return badRequest(res, 'Only Draft or Rejected IPCs can be revised');

  if (NON_WORK_IPC_KINDS.includes(inv.ipcKind)) {
    const amount = round2(req.body.amount ?? inv.grossAmount);
    const check = inv.ipcKind === 'Advance'
      ? await checkAdvanceAmount(inv.subletContract, amount, inv._id)
      : await checkRetentionRelease(req.params.id, inv.contractor, amount, inv._id);
    if (check.error) return badRequest(res, check.error);
    if (inv.ipcKind === 'Advance' && req.body.recoveryPercent !== undefined) {
      const pct = Number(req.body.recoveryPercent);
      if (!(pct > 0 && pct <= 100)) return badRequest(res, 'Recovery % must be between 1 and 100');
      inv.advanceRecoveryPercent = pct;
    }
    const before = `amount ${inv.grossAmount}`;
    Object.assign(inv, { grossAmount: amount, netPayableAmount: amount, invoiceAmount: amount });
    ['description', 'issueDate', 'dueDate', 'notes'].forEach((k) => { if (req.body[k] !== undefined) inv[k] = req.body[k]; });
    pushIpcHistory(inv, inv.approvalStatus || 'Draft', inv.approvalStatus || 'Draft', req.user._id,
      `Revised: ${before} → ${amount}${req.body.comments ? ` — ${req.body.comments}` : ''}`, 'Project Management');
    inv.updatedBy = req.user._id;
    await inv.save();
    await syncProjectInvoiceTotals(req.params.id);
    return ipcDone(res, inv, 'IPC revised');
  }

  const cr = inv.checkRequest ? await CheckRequest.findById(inv.checkRequest) : null;
  if (!cr) return badRequest(res, 'The check request behind this IPC no longer exists');

  // Give this IPC's quantities back, rebuild from the request, then bill again — all-or-nothing
  const snapshot = cr.toObject();
  await reverseIpcBilling(inv, req.user._id);
  const freshCr = await CheckRequest.findById(cr._id);
  let gross;
  let lines = [];
  if (freshCr.claimType === 'Slab') {
    gross = checkRequestBillable(freshCr);
  } else {
    const built = await buildIpcLines(req.params.id, freshCr, req.body.items, inv._id);
    if (built.error) {
      await CheckRequest.updateOne({ _id: cr._id }, { $set: { items: snapshot.items, status: snapshot.status, linkedInvoice: snapshot.linkedInvoice } });
      await applyBoqCounters(inv.items, 1);
      return badRequest(res, built.error);
    }
    lines = built.processedItems;
    gross = built.grossAmount;
  }
  const recovery = await resolveAdvanceRecovery(req.params.id, inv.contractor, gross,
    req.body.advanceRecoveryAmount ?? inv.advanceRecoveryAmount, inv._id);
  const ded = recovery.error ? recovery : computeIpcDeductions(gross, {
    retentionPercentage: req.body.retentionPercentage ?? inv.retentionPercentage,
    whtPercentage: req.body.whtPercentage ?? inv.whtPercentage,
    advanceRecoveryAmount: recovery.amount
  });
  const split = ded.error ? ded : barterSplit({ gross, ...ded }, inv.propertyPercent);
  if (split.error) {
    await CheckRequest.updateOne({ _id: cr._id }, { $set: { items: snapshot.items, status: snapshot.status, linkedInvoice: snapshot.linkedInvoice } });
    await applyBoqCounters(inv.items, 1);
    return badRequest(res, split.error);
  }
  Object.assign(ded, split);

  const before = `gross ${inv.grossAmount}, net ${inv.netPayableAmount}`;
  inv.items = lines.map(({ _crItemId, ...rest }) => rest);
  inv.grossAmount = gross;
  Object.assign(inv, ded);
  inv.invoiceAmount = ded.netPayableAmount;
  ['description', 'issueDate', 'dueDate', 'notes'].forEach((k) => { if (req.body[k] !== undefined) inv[k] = req.body[k]; });
  pushIpcHistory(inv, inv.approvalStatus || 'Draft', inv.approvalStatus || 'Draft', req.user._id,
    `Revised: ${before} → gross ${gross}, net ${ded.netPayableAmount}${req.body.comments ? ` — ${req.body.comments}` : ''}`, 'Project Management');
  inv.updatedBy = req.user._id;
  await inv.save();
  await applyIpcBilling(freshCr, lines, inv._id, req.user._id);

  await syncProjectInvoiceTotals(req.params.id);
  await syncProjectMetrics(req.params.id);
  return ipcDone(res, inv, 'IPC revised');
}));

// PUT /api/project-management/ipcs/:ipcId/audit-approve — pre-audit initial approval, then Audit Director final approval
router.put('/ipcs/:ipcId/audit-approve', asyncHandler(async (req, res) => {
  if (!hasAuditAccess(req.user)) return res.status(403).json({ success: false, message: 'Audit access required' });
  const inv = await loadIpc(req, res); if (!inv) return;
  const comments = req.body.approvalComments || req.body.comments || '';

  if (inv.approvalStatus === 'Pending Audit') {
    if (!canPerformInitialPreAuditActions(req.user)) {
      return res.status(403).json({ success: false, message: 'Initial approval is done by pre-audit staff, not the Audit Director' });
    }
    inv.preAuditInitialApprovedBy = req.user._id;
    inv.preAuditInitialApprovedAt = new Date();
    inv.preAuditInitialComments = comments;
    pushIpcHistory(inv, 'Pending Audit', 'Pending Audit', req.user._id, comments || 'Initial pre-audit approval recorded', 'Pre-Audit');
    await inv.save();
    return ipcDone(res, inv, 'Initial pre-audit approval recorded. Forward to Audit Director for final approval.');
  }

  if (inv.approvalStatus !== 'Forwarded to Audit Director') {
    return badRequest(res, 'IPC must be Pending Audit or Forwarded to Audit Director');
  }
  if (!canActAsAuditDirector(req.user)) return res.status(403).json({ success: false, message: 'Only the Audit Director can give final audit approval' });
  pushIpcHistory(inv, 'Forwarded to Audit Director', 'Send to CEO Office', req.user._id, comments || 'Audit Director approved', 'Pre-Audit');
  inv.approvalStatus = 'Send to CEO Office';
  inv.auditApprovedBy = req.user._id;
  inv.auditApprovedAt = new Date();
  inv.auditComments = comments;
  await inv.save();
  await notifyIpc(await userIdsByRoles(['hr_manager', 'admin', 'super_admin']), req.user._id,
    `IPC ${inv.invoiceNumber} pending CEO Secretariat`, 'Audit-approved subcontractor IPC is waiting in Payments (CEO Secretariat).',
    inv, '/general/ceo-secretariat/payments');
  return ipcDone(res, inv, 'Audit approved — sent to CEO Secretariat');
}));

// PUT /api/project-management/ipcs/:ipcId/forward-to-audit-director
router.put('/ipcs/:ipcId/forward-to-audit-director', asyncHandler(async (req, res) => {
  if (!hasAuditAccess(req.user)) return res.status(403).json({ success: false, message: 'Audit access required' });
  const inv = await loadIpc(req, res); if (!inv) return;
  if (inv.approvalStatus !== 'Pending Audit') return badRequest(res, 'IPC must be Pending Audit');
  if (!inv.preAuditInitialApprovedAt) return badRequest(res, 'Initial pre-audit approval is required before forwarding to the Audit Director');
  pushIpcHistory(inv, 'Pending Audit', 'Forwarded to Audit Director', req.user._id, req.body.comments || 'Forwarded to Audit Director', 'Pre-Audit');
  inv.approvalStatus = 'Forwarded to Audit Director';
  await inv.save();
  await notifyIpc(await userIdsByRoles(['audit_director', 'admin', 'super_admin']), req.user._id,
    `IPC ${inv.invoiceNumber} forwarded to Audit Director`, 'Subcontractor IPC is waiting for your approval.', inv, '/audit/pre-audit');
  return ipcDone(res, inv, 'Forwarded to Audit Director');
}));

// PUT /api/project-management/ipcs/:ipcId/audit-reject (and audit-return — same: back to the initiator)
const auditReject = asyncHandler(async (req, res) => {
  if (!hasAuditAccess(req.user)) return res.status(403).json({ success: false, message: 'Audit access required' });
  const inv = await loadIpc(req, res); if (!inv) return;
  if (!['Pending Audit', 'Forwarded to Audit Director'].includes(inv.approvalStatus)) {
    return badRequest(res, 'Audit can only reject IPCs that are Pending Audit or with the Audit Director');
  }
  return rejectIpc(req, res, inv, inv.approvalStatus);
});
router.put('/ipcs/:ipcId/audit-reject', auditReject);
router.put('/ipcs/:ipcId/audit-return', auditReject);

// PUT /api/project-management/ipcs/:ipcId/forward-to-ceo — CEO Secretariat (PS)
router.put('/ipcs/:ipcId/forward-to-ceo', asyncHandler(async (req, res) => {
  if (!hasCeoSecretariatAccess(req.user)) return res.status(403).json({ success: false, message: 'CEO Secretariat access required' });
  const inv = await loadIpc(req, res); if (!inv) return;
  if (inv.approvalStatus !== 'Send to CEO Office') return badRequest(res, 'IPC must be in Send to CEO Office');
  pushIpcHistory(inv, 'Send to CEO Office', 'Forwarded to CEO', req.user._id, req.body.comments || 'Forwarded to CEO for approval', 'CEO Secretariat');
  inv.approvalStatus = 'Forwarded to CEO';
  inv.ceoForwardedBy = req.user._id;
  inv.ceoForwardedAt = new Date();
  await inv.save();
  await notifyIpc(await userIdsByRoles(['higher_management', 'admin', 'super_admin']), req.user._id,
    `IPC ${inv.invoiceNumber} pending CEO approval`, 'Subcontractor IPC was forwarded to the CEO.', inv, '/dashboard');
  return ipcDone(res, inv, 'Forwarded to CEO');
}));

// PUT /api/project-management/ipcs/:ipcId/ceo-secretariat-reject (and -return)
const secretariatReject = asyncHandler(async (req, res) => {
  if (!hasCeoSecretariatAccess(req.user)) return res.status(403).json({ success: false, message: 'CEO Secretariat access required' });
  const inv = await loadIpc(req, res); if (!inv) return;
  if (inv.approvalStatus !== 'Send to CEO Office') return badRequest(res, 'IPC must be in Send to CEO Office');
  return rejectIpc(req, res, inv, 'Send to CEO Office');
});
router.put('/ipcs/:ipcId/ceo-secretariat-reject', secretariatReject);
router.put('/ipcs/:ipcId/ceo-secretariat-return', secretariatReject);

// PUT /api/project-management/ipcs/:ipcId/ceo-approve → Approved, posted to Finance as an AP bill
router.put('/ipcs/:ipcId/ceo-approve', asyncHandler(async (req, res) => {
  if (!isDesignatedCeoApprover(req.user)) return res.status(403).json({ success: false, message: 'CEO approval access required' });
  const inv = await loadIpc(req, res); if (!inv) return;
  if (inv.approvalStatus !== 'Forwarded to CEO') return badRequest(res, 'IPC must be Forwarded to CEO');
  const comments = req.body.comments || 'CEO approved';
  pushIpcHistory(inv, 'Forwarded to CEO', 'Approved', req.user._id, comments, 'CEO');
  inv.approvalStatus = 'Approved';
  inv.ceoApprovedBy = req.user._id;
  inv.ceoApprovedAt = new Date();
  inv.ceoComments = comments;
  inv.ceoDigitalSignature = (req.body.digitalSignature && String(req.body.digitalSignature).trim())
    || req.user.digitalSignature || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
  await inv.save();

  const isClient = inv.invoiceType === 'Client_Invoice';
  const posting = isClient
    ? await postClientInvoiceToFinance(inv._id, req.user._id)
    : await postIpcToFinance(inv._id, req.user._id);
  const financeRef = isClient ? `receivable ${posting.arNumber || ''}` : posting.billNumber;
  // An approved client invoice is issued to the client once its receivable exists
  if (isClient && posting.posted) await ProjectInvoice.updateOne({ _id: inv._id, status: 'Draft' }, { $set: { status: 'Sent' } });
  await notifyIpc([inv.createdBy, inv.submittedBy], req.user._id, `${isClient ? 'Client invoice' : 'IPC'} ${inv.invoiceNumber} approved by CEO`,
    posting.posted ? `Posted to Finance as ${financeRef}.` : `Approved — Finance posting pending: ${posting.error}`,
    inv, ipcInitiatorUrl(inv));
  const fresh = await ProjectInvoice.findById(inv._id);
  return ipcDone(res, fresh, posting.posted
    ? `CEO approved — posted to Finance as ${financeRef}`
    : `CEO approved, but Finance posting needs attention: ${posting.error}`);
}));

// PUT /api/project-management/ipcs/:ipcId/ceo-reject (and ceo-return)
const ceoReject = asyncHandler(async (req, res) => {
  if (!isDesignatedCeoApprover(req.user)) return res.status(403).json({ success: false, message: 'CEO access required' });
  const inv = await loadIpc(req, res); if (!inv) return;
  if (inv.approvalStatus !== 'Forwarded to CEO') return badRequest(res, 'IPC must be Forwarded to CEO');
  return rejectIpc(req, res, inv, 'Forwarded to CEO');
});
router.put('/ipcs/:ipcId/ceo-reject', ceoReject);
router.put('/ipcs/:ipcId/ceo-return', ceoReject);

// POST /api/project-management/ipcs/:ipcId/post-to-finance — retry after Finance fixes its chart / company
router.post('/ipcs/:ipcId/post-to-finance', asyncHandler(async (req, res) => {
  const inv = await loadIpc(req, res); if (!inv) return;
  if (inv.approvalStatus !== 'Approved') return badRequest(res, 'Only CEO-approved documents can be posted to Finance');
  const isClient = inv.invoiceType === 'Client_Invoice';
  const posting = isClient ? await postClientInvoiceToFinance(inv._id, req.user._id) : await postIpcToFinance(inv._id, req.user._id);
  if (!posting.posted) return badRequest(res, posting.error);
  if (isClient) await ProjectInvoice.updateOne({ _id: inv._id, status: 'Draft' }, { $set: { status: 'Sent' } });
  const fresh = await ProjectInvoice.findById(inv._id);
  return ipcDone(res, fresh, `Posted to Finance as ${isClient ? posting.arNumber : posting.billNumber}`);
}));

// ─── CHECK REQUESTS (commercial gate before IPC / payment) ───────────────────

const populateCheckRequest = (query) =>
  query
    .populate('contractor', 'name email phone vendorType')
    .populate('task', 'title status progressPercent')
    .populate('activity', 'name group code unit projectType')
    .populate('items.boqItem', 'title description unit estimatedQuantity estimatedUnitPrice contractorUnitPrice contractorBilledQuantity')
    .populate('createdBy', 'firstName lastName')
    .populate('submittedBy', 'firstName lastName')
    .populate('linkedInvoice', 'invoiceNumber ipcNumber status invoiceAmount')
    .populate('subletContract', 'contractNumber title contractType totalAmount');

/**
 * Resolve the WBS activity for a check request: it must be an active master activity of the
 * Sub Project's type. Required whenever that type has activities defined.
 * Returns { activityId } or { error }.
 */
const resolveCheckRequestActivity = async (project, rawActivity, { keepId = null } = {}) => {
  const projectType = normalizeProjectType(project.projectType);
  const id = rawActivity?._id || rawActivity;
  if (!id) {
    if (projectType && await WbsActivity.exists({ projectType, isActive: true })) {
      return { error: 'Select the WBS activity this check request is for' };
    }
    return { activityId: null };
  }
  if (!isValidId(id)) return { error: 'Invalid WBS activity' };
  // An activity already on this check request stays valid even if later deactivated in the master
  if (keepId && String(keepId) === String(id)) return { activityId: keepId };
  const activity = await WbsActivity.findOne({ _id: id, isActive: true }).select('projectType').lean();
  if (!activity) return { error: 'WBS activity not found or inactive' };
  if (activity.projectType !== projectType) {
    return { error: `That activity belongs to ${activity.projectType}, but this Sub Project is ${projectType || 'not typed'}` };
  }
  return { activityId: activity._id };
};

/**
 * A check request is raised by a subcontractor holding an Active sublet contract on this Sub Project.
 * Returns { contractorId, types } — types = contract types held ('BOQ' / 'Slab').
 * keepId lets an edited request keep its contractor even if that contract has since closed.
 */
const resolveCheckRequestContractor = async (projectId, rawContractor, { keepId = null } = {}) => {
  const id = rawContractor?._id || rawContractor;
  if (!id) return { error: 'Select the subcontractor this check request is for' };
  if (!isValidId(id)) return { error: 'Invalid subcontractor' };

  const contracts = await SubletContract.find({ project: projectId, contractor: id, status: 'Active' })
    .select('contractType')
    .lean();
  const keeping = keepId && String(keepId) === String(id);
  if (!contracts.length && !keeping) {
    return { error: 'This subcontractor has no active Sublet Contract on this Sub Project' };
  }
  return { contractorId: id, types: new Set(contracts.map((c) => c.contractType || 'BOQ')) };
};

/**
 * Slab-wise claim: one payment stage (slab) of the contractor's Active slab contract.
 * On a contract covering villas / units the stage is claimed for some of them and priced at that
 * share; each villa's stage can be claimed by one live check request (cancelled ones free it up).
 * Without units the whole stage is claimed once.
 */
const resolveSlabClaim = async (projectId, contractorId, rawContractId, rawSlabId, excludeCrId = null, rawUnits = [], project = null) => {
  if (!rawContractId || !isValidId(rawContractId)) return { error: 'Select the slab-wise contract' };
  if (!rawSlabId || !isValidId(rawSlabId)) return { error: 'Select the slab (stage) being claimed' };

  const contract = await SubletContract.findOne({
    _id: rawContractId, project: projectId, contractor: contractorId, contractType: 'Slab'
  }).lean();
  if (!contract) return { error: "Slab-wise contract not found for this subcontractor on this Sub Project" };
  if (contract.status !== 'Active') return { error: 'Only stages of an Active contract can be claimed' };

  const slab = (contract.slabs || []).find((sl) => String(sl._id) === String(rawSlabId));
  if (!slab) return { error: 'That slab is not part of the selected contract' };

  const others = await CheckRequest.find({
    subletContract: contract._id,
    'slab.slabId': slab._id,
    status: { $ne: 'Cancelled' },
    ...(excludeCrId ? { _id: { $ne: excludeCrId } } : {})
  }).select('checkRequestNumber units slab.amount').lean();

  const stageAmount = Number(slab.amount) || Math.round(((Number(contract.totalAmount) || 0) * (Number(slab.percentage) || 0)) / 100);
  const contractUnits = contract.units || [];
  let units = [];
  let amount = stageAmount;

  if (!contractUnits.length) {
    if (others.length) return { error: `Slab "${slab.name}" is already claimed in ${others[0].checkRequestNumber}` };
  } else {
    const ids = [...new Set((Array.isArray(rawUnits) ? rawUnits : []).map((u) => String(u?.unit || u?._id || u)))];
    if (!ids.length) return { error: `Select the ${unitLabel(project, true)} this stage is claimed for` };
    const byId = new Map(contractUnits.map((u) => [String(u.unit), u]));
    if (ids.some((id) => !byId.has(id))) return { error: `Some selected ${unitLabel(project, true)} are not on this contract` };
    units = contractUnits.filter((u) => ids.includes(String(u.unit))).map((u) => ({ unit: u.unit, name: u.name }));

    // A claim without units (made before units existed) covers the whole contract
    const claimedBy = new Map();
    others.forEach((o) => (o.units?.length ? o.units : contractUnits).forEach((u) => claimedBy.set(String(u.unit), o.checkRequestNumber)));
    const clash = units.filter((u) => claimedBy.has(String(u.unit)));
    if (clash.length) {
      return { error: `Slab "${slab.name}" is already claimed for ${clash.map((u) => `${u.name} (${claimedBy.get(String(u.unit))})`).join(', ')}` };
    }

    // Share of the stage; the claim that completes the stage takes what is left so the claims add up to it exactly
    if (claimedBy.size + units.length >= contractUnits.length) {
      amount = Math.max(0, stageAmount - others.reduce((s, o) => s + (Number(o.slab?.amount) || 0), 0));
    } else {
      amount = Math.round((stageAmount * units.length) / contractUnits.length);
    }
  }

  return {
    contract,
    units,
    slab: {
      slabId: slab._id,
      name: slab.name,
      percentage: Number(slab.percentage) || 0,
      amount,
      activities: (slab.activities || []).map((a) => ({ activity: a.activity, name: a.name }))
    }
  };
};

/**
 * Villas / units a BOQ claim's work was done on. They must be on one of the contractor's Active
 * BOQ-wise contracts here; required when all those contracts cover named villas. A contract
 * without villas (whole Sub Project) leaves the choice optional among the Sub Project's villas.
 */
const resolveBoqClaimUnits = async (project, contractorId, rawUnits) => {
  const listed = project.units || [];
  if (!listed.length) return { units: [] };
  const contracts = await SubletContract.find({
    project: project._id, contractor: contractorId, status: 'Active', contractType: { $ne: 'Slab' }
  }).select('units').lean();
  const wholeSub = !contracts.length || contracts.some((c) => !c.units?.length);
  const allowed = new Set(wholeSub
    ? listed.map((u) => String(u._id))
    : contracts.flatMap((c) => c.units.map((u) => String(u.unit))));

  const ids = [...new Set((Array.isArray(rawUnits) ? rawUnits : []).map((u) => String(u?.unit || u?._id || u)))];
  if (!ids.length) {
    return wholeSub ? { units: [] } : { error: `Select the ${unitLabel(project, true)} this work was done on` };
  }
  if (ids.some((id) => !allowed.has(id))) {
    return { error: `Some selected ${unitLabel(project, true)} are not on this subcontractor's BOQ-wise contract` };
  }
  return { units: listed.filter((u) => ids.includes(String(u._id))).map((u) => ({ unit: u._id, name: u.name })) };
};

/** Verified value still to be billed as an IPC (slab claims bill once, in full). */
const checkRequestBillable = (cr) => {
  if (cr.status !== 'Verified') return 0;
  if (cr.claimType === 'Slab') return cr.linkedInvoice ? 0 : Number(cr.verifiedTotal) || 0;
  return (cr.items || []).reduce(
    (s, i) => s + Math.max(0, (Number(i.verifiedQuantity) || 0) - (Number(i.billedQuantity) || 0)) * (Number(i.unitPrice) || 0), 0
  );
};

const buildCheckRequestItems = async (projectId, masterProjectId, rawItems = []) => {
  const items = [];
  let claimedTotal = 0;

  for (const row of rawItems) {
    const boqId = row.boqItemId || row.boqItem;
    if (!boqId || !isValidId(boqId)) continue;

    const searchCriteria = masterProjectId
      ? { _id: boqId, $or: [{ project: projectId }, { project: masterProjectId }] }
      : { _id: boqId, project: projectId };

    const boq = await BOQItem.findOne(searchCriteria).lean();
    if (!boq) continue;

    const claimedQuantity = Math.max(0, Number(row.claimedQuantity) || 0);
    if (claimedQuantity <= 0) continue;

    const unitPrice = Number(row.unitPrice) || Number(boq.contractorUnitPrice) || Number(boq.estimatedUnitPrice) || 0;
    const claimedAmount = claimedQuantity * unitPrice;
    claimedTotal += claimedAmount;

    items.push({
      boqItem: boq._id,
      title: boq.title || '',
      description: boq.description || '',
      unit: boq.unit || '',
      claimedQuantity,
      verifiedQuantity: 0,
      billedQuantity: 0,
      unitPrice,
      claimedAmount,
      verifiedAmount: 0,
      notes: row.notes || ''
    });
  }

  return { items, claimedTotal };
};

// GET /api/project-management/projects/:id/check-requests
router.get('/projects/:id/check-requests', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const filter = { project: req.params.id };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.billable === 'true') {
    filter.status = 'Verified';
  }

  const rows = await populateCheckRequest(
    CheckRequest.find(filter).sort({ createdAt: -1 })
  ).lean();

  const billable = rows
    .filter((cr) => cr.status === 'Verified')
    .map((cr) => {
      const remainingItems = (cr.items || [])
        .map((i) => ({
          ...i,
          billableQuantity: Math.max(0, (Number(i.verifiedQuantity) || 0) - (Number(i.billedQuantity) || 0))
        }))
        .filter((i) => i.billableQuantity > 0);
      const billableTotal = remainingItems.reduce(
        (s, i) => s + i.billableQuantity * (Number(i.unitPrice) || 0),
        0
      );
      return { ...cr, remainingItems, billableTotal: cr.claimType === 'Slab' ? checkRequestBillable(cr) : billableTotal };
    })
    .filter((cr) => (req.query.billable === 'true' ? cr.billableTotal > 0 : true));

  res.json({
    success: true,
    data: {
      checkRequests: req.query.billable === 'true' ? billable : rows,
      counts: {
        draft: rows.filter((r) => r.status === 'Draft').length,
        submitted: rows.filter((r) => r.status === 'Submitted').length,
        verified: rows.filter((r) => r.status === 'Verified').length,
        rejected: rows.filter((r) => r.status === 'Rejected').length,
        billed: rows.filter((r) => r.status === 'Billed').length
      }
    }
  });
}));

// GET /api/project-management/projects/:id/check-requests/:crId
router.get('/projects/:id/check-requests/:crId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.crId)) return badRequest(res, 'Invalid ID');

  const cr = await populateCheckRequest(
    CheckRequest.findOne({ _id: req.params.crId, project: req.params.id })
  ).lean();
  if (!cr) return notFound(res, 'Check Request');

  res.json({ success: true, data: cr });
}));

// POST /api/project-management/projects/:id/check-requests
// POST /api/project-management/projects/:id/check-requests/attachments — upload supporting documents (field "files")
router.post('/projects/:id/check-requests/attachments', (req, res, next) => crAttachmentUpload(req, res, (err) => {
  if (!err) return next();
  (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
  return badRequest(res, err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be under 20 MB' : err.message);
}), asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return badRequest(res, req.rejectedFiles?.length
      ? `Not allowed: ${req.rejectedFiles.join(', ')} — attach photos, PDF, Word or Excel files`
      : 'Choose at least one file');
  }
  res.status(201).json({
    success: true,
    message: req.rejectedFiles?.length ? `Skipped (wrong type): ${req.rejectedFiles.join(', ')}` : 'Uploaded',
    data: files.map((f) => ({
      url: `${CR_ATTACHMENT_PREFIX}${f.filename}`, originalName: f.originalname, mimeType: f.mimetype, size: f.size, uploadedAt: new Date()
    }))
  });
}));

router.post('/projects/:id/check-requests', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id).lean();
  if (!project) return notFound(res, 'Project');
  if (!project.parentProject) {
    return badRequest(res, 'Check Requests are created on Sub Projects only');
  }

  const { title, contractor, task, items = [], notes } = req.body;
  if (!title || !String(title).trim()) return badRequest(res, 'Title is required');
  const claimType = req.body.claimType === 'Slab' ? 'Slab' : 'BOQ';
  const attachments = cleanCrAttachments(req.body.attachments);
  if (!attachments.length) return badRequest(res, CR_ATTACHMENT_REQUIRED);

  const { contractorId, types, error: contractorError } = await resolveCheckRequestContractor(req.params.id, contractor);
  if (contractorError) return badRequest(res, contractorError);
  if (!types.has(claimType)) {
    return badRequest(res, `This subcontractor has no active ${claimType === 'Slab' ? 'slab-wise' : 'BOQ-wise'} contract here`);
  }

  const base = {
    project: req.params.id,
    masterProject: project.parentProject,
    title: String(title).trim(),
    contractor: contractorId,
    claimType,
    task: task && isValidId(task) ? task : null,
    verifiedTotal: 0,
    notes: notes || '',
    attachments,
    status: 'Draft',
    createdBy: req.user?._id,
    updatedBy: req.user?._id
  };

  let cr;
  if (claimType === 'Slab') {
    const claim = await resolveSlabClaim(req.params.id, contractorId, req.body.subletContract, req.body.slabId, null, req.body.units, project);
    if (claim.error) return badRequest(res, claim.error);
    cr = await CheckRequest.create({
      ...base,
      subletContract: claim.contract._id,
      slab: claim.slab,
      units: claim.units,
      activity: null,
      items: [],
      claimedTotal: claim.slab.amount
    });
  } else {
    const { activityId, error: activityError } = await resolveCheckRequestActivity(project, req.body.activity);
    if (activityError) return badRequest(res, activityError);

    const { units, error: unitsError } = await resolveBoqClaimUnits(project, contractorId, req.body.units);
    if (unitsError) return badRequest(res, unitsError);

    const { items: builtItems, claimedTotal } = await buildCheckRequestItems(req.params.id, project.parentProject, items);
    if (!builtItems.length) {
      return badRequest(res, 'Add at least one BOQ line with claimed quantity');
    }
    cr = await CheckRequest.create({ ...base, activity: activityId, units, items: builtItems, claimedTotal });
  }

  const populated = await populateCheckRequest(CheckRequest.findById(cr._id)).lean();
  res.status(201).json({ success: true, message: 'Check Request created', data: populated });
}));

// PUT /api/project-management/projects/:id/check-requests/:crId
router.put('/projects/:id/check-requests/:crId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.crId)) return badRequest(res, 'Invalid ID');

  const cr = await CheckRequest.findOne({ _id: req.params.crId, project: req.params.id });
  if (!cr) return notFound(res, 'Check Request');
  if (!['Draft', 'Rejected'].includes(cr.status)) {
    return badRequest(res, 'Only Draft or Rejected Check Requests can be edited');
  }

  const project = await ConstructionProject.findById(req.params.id).select('parentProject projectType units').lean();
  const { title, contractor, task, items, notes } = req.body;
  const claimType = req.body.claimType
    ? (req.body.claimType === 'Slab' ? 'Slab' : 'BOQ')
    : (cr.claimType || 'BOQ');
  if (req.body.attachments !== undefined) {
    const attachments = cleanCrAttachments(req.body.attachments);
    if (!attachments.length) return badRequest(res, CR_ATTACHMENT_REQUIRED);
    cr.attachments = attachments;
  }

  if (title !== undefined) {
    if (!String(title).trim()) return badRequest(res, 'Title cannot be empty');
    cr.title = String(title).trim();
  }
  if (contractor !== undefined || req.body.claimType !== undefined) {
    const resolved = await resolveCheckRequestContractor(
      req.params.id,
      contractor !== undefined ? contractor : cr.contractor,
      { keepId: cr.contractor }
    );
    if (resolved.error) return badRequest(res, resolved.error);
    const changed = String(resolved.contractorId) !== String(cr.contractor) || claimType !== (cr.claimType || 'BOQ');
    if (changed && !resolved.types.has(claimType)) {
      return badRequest(res, `This subcontractor has no active ${claimType === 'Slab' ? 'slab-wise' : 'BOQ-wise'} contract here`);
    }
    cr.contractor = resolved.contractorId;
  }
  if (task !== undefined) {
    cr.task = task && isValidId(task) ? task : null;
  }
  if (notes !== undefined) cr.notes = notes || '';

  if (claimType === 'Slab') {
    const claim = await resolveSlabClaim(
      req.params.id,
      cr.contractor,
      req.body.subletContract !== undefined ? req.body.subletContract : cr.subletContract,
      req.body.slabId !== undefined ? req.body.slabId : cr.slab?.slabId,
      cr._id,
      req.body.units !== undefined ? req.body.units : cr.units,
      project
    );
    if (claim.error) return badRequest(res, claim.error);
    cr.claimType = 'Slab';
    cr.subletContract = claim.contract._id;
    cr.slab = claim.slab;
    cr.units = claim.units;
    cr.activity = null;
    cr.items = [];
    cr.claimedTotal = claim.slab.amount;
    cr.verifiedTotal = 0;
  } else {
    if (cr.claimType === 'Slab' && !Array.isArray(items)) {
      return badRequest(res, 'Add the BOQ lines being claimed');
    }
    const wasSlab = cr.claimType === 'Slab';
    cr.claimType = 'BOQ';
    cr.subletContract = null;
    cr.slab = undefined;
    if (req.body.units !== undefined || wasSlab) {
      const { units, error: unitsError } = await resolveBoqClaimUnits(project, cr.contractor, req.body.units);
      if (unitsError) return badRequest(res, unitsError);
      cr.units = units;
    }
    if (req.body.activity !== undefined) {
      const { activityId, error: activityError } = await resolveCheckRequestActivity(project, req.body.activity, { keepId: cr.activity });
      if (activityError) return badRequest(res, activityError);
      cr.activity = activityId;
    }
    if (Array.isArray(items)) {
      const { items: builtItems, claimedTotal } = await buildCheckRequestItems(
        req.params.id,
        project?.parentProject,
        items
      );
      if (!builtItems.length) {
        return badRequest(res, 'Add at least one BOQ line with claimed quantity');
      }
      cr.items = builtItems;
      cr.claimedTotal = claimedTotal;
      cr.verifiedTotal = 0;
    }
  }

  if (cr.status === 'Rejected') {
    cr.status = 'Draft';
    cr.rejectionReason = '';
    cr.rejectedAt = undefined;
    cr.rejectedBy = undefined;
  }

  cr.updatedBy = req.user?._id;
  await cr.save();

  const populated = await populateCheckRequest(CheckRequest.findById(cr._id)).lean();
  res.json({ success: true, message: 'Check Request updated', data: populated });
}));

// POST submit
router.post('/projects/:id/check-requests/:crId/submit', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.crId)) return badRequest(res, 'Invalid ID');

  const cr = await CheckRequest.findOne({ _id: req.params.crId, project: req.params.id });
  if (!cr) return notFound(res, 'Check Request');
  if (!['Draft', 'Rejected'].includes(cr.status)) {
    return badRequest(res, 'Only Draft or Rejected Check Requests can be submitted');
  }
  if (cr.claimType !== 'Slab' && !cr.items?.length) return badRequest(res, 'Check Request has no items');
  if (!cr.attachments?.length) return badRequest(res, `${CR_ATTACHMENT_REQUIRED} — edit the check request to add it`);

  cr.status = 'Submitted';
  cr.submittedAt = new Date();
  cr.submittedBy = req.user?._id;
  cr.rejectionReason = '';
  cr.updatedBy = req.user?._id;
  await cr.save();

  const populated = await populateCheckRequest(CheckRequest.findById(cr._id)).lean();
  res.json({ success: true, message: 'Check Request submitted for verification', data: populated });
}));

/**
 * Mark a Submitted check request Verified. BOQ claims take verified quantities (capped by claim and
 * remaining BOQ); slab claims verify the whole stage. Used by the inspection report once every
 * inspector has approved. Returns { cr } or { error }.
 */
const applyCheckRequestVerification = async (cr, {
  projectId, userId, verifiedBy, verificationNotes = '', verificationPhotoUrl = '', items: verifiedRows = []
}) => {
  if (cr.status !== 'Submitted') return { error: 'Only Submitted Check Requests can be verified' };

  // Slab claim: the auditor confirms the whole stage is complete
  if (cr.claimType === 'Slab') {
    cr.status = 'Verified';
    cr.verifiedTotal = Number(cr.slab?.amount) || Number(cr.claimedTotal) || 0;
    cr.verifiedAt = new Date();
    cr.verifiedBy = String(verifiedBy).trim();
    cr.verifiedByUser = userId;
    cr.verificationNotes = verificationNotes || '';
    cr.verificationPhotoUrl = verificationPhotoUrl || '';
    cr.updatedBy = userId;
    await cr.save();
    await syncProjectMetrics(projectId);
    return { cr };
  }

  const overrideMap = new Map();
  (Array.isArray(verifiedRows) ? verifiedRows : []).forEach((row) => {
    const key = String(row.boqItemId || row.boqItem || row._id || '');
    if (key) overrideMap.set(key, row);
  });

  let verifiedTotal = 0;
  for (const item of cr.items) {
    const key = String(item.boqItem);
    const override = overrideMap.get(key) || overrideMap.get(String(item._id));
    let verifiedQuantity = override?.verifiedQuantity !== undefined
      ? Number(override.verifiedQuantity) || 0
      : Number(item.claimedQuantity) || 0;

    if (verifiedQuantity < 0) verifiedQuantity = 0;
    if (verifiedQuantity > Number(item.claimedQuantity)) {
      return { error: `Verified qty for "${item.title || item.description}" cannot exceed claimed qty (${item.claimedQuantity} ${item.unit})` };
    }

    // Cap against remaining BOQ estimate after already-verified (other CRs) + billed
    const boq = await BOQItem.findById(item.boqItem).select('estimatedQuantity title description unit').lean();
    if (boq) {
      const otherVerified = await CheckRequest.aggregate([
        {
          $match: {
            project: new mongoose.Types.ObjectId(projectId),
            _id: { $ne: cr._id },
            status: { $in: ['Verified', 'Billed', 'Submitted'] }
          }
        },
        { $unwind: '$items' },
        { $match: { 'items.boqItem': boq._id } },
        {
          $group: {
            _id: null,
            qty: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['Verified', 'Billed']] },
                  '$items.verifiedQuantity',
                  '$items.claimedQuantity'
                ]
              }
            }
          }
        }
      ]);
      const reserved = Number(otherVerified[0]?.qty) || 0;
      const remainingEst = Math.max(0, (Number(boq.estimatedQuantity) || 0) - reserved);
      if (verifiedQuantity > remainingEst) {
        return { error: `Verified qty for "${boq.title || boq.description}" exceeds remaining BOQ quantity (${remainingEst} ${boq.unit})` };
      }
    }

    item.verifiedQuantity = verifiedQuantity;
    item.verifiedAmount = verifiedQuantity * (Number(item.unitPrice) || 0);
    verifiedTotal += item.verifiedAmount;
  }

  if (verifiedTotal <= 0 && !cr.items.some((i) => (Number(i.verifiedQuantity) || 0) > 0)) {
    return { error: 'At least one line must have verified quantity greater than zero' };
  }

  cr.status = 'Verified';
  cr.verifiedTotal = verifiedTotal;
  cr.verifiedAt = new Date();
  cr.verifiedBy = String(verifiedBy).trim();
  cr.verifiedByUser = userId;
  cr.verificationNotes = verificationNotes || '';
  cr.verificationPhotoUrl = verificationPhotoUrl || '';
  cr.updatedBy = userId;
  await cr.save();
  await syncProjectMetrics(projectId);
  return { cr };
};

// POST verify — retired: check requests are verified by an approved Inspection Report
router.post('/projects/:id/check-requests/:crId/verify', asyncHandler(async (req, res) => (
  badRequest(res, 'Check requests are verified through an Inspection Report — create one and have every inspector approve it')
)));

// POST reject
router.post('/projects/:id/check-requests/:crId/reject', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.crId)) return badRequest(res, 'Invalid ID');

  const cr = await CheckRequest.findOne({ _id: req.params.crId, project: req.params.id });
  if (!cr) return notFound(res, 'Check Request');
  if (cr.status !== 'Submitted') {
    return badRequest(res, 'Only Submitted Check Requests can be rejected');
  }

  const reason = String(req.body?.rejectionReason || '').trim();
  if (!reason) return badRequest(res, 'Rejection reason is required');
  if (await InspectionReport.exists({ checkRequest: cr._id, status: 'Pending' })) {
    return badRequest(res, 'An inspection report is in progress — inspectors approve or reject it there');
  }

  cr.status = 'Rejected';
  cr.rejectionReason = reason;
  cr.rejectedAt = new Date();
  cr.rejectedBy = req.user?._id;
  cr.updatedBy = req.user?._id;
  await cr.save();

  const populated = await populateCheckRequest(CheckRequest.findById(cr._id)).lean();
  res.json({ success: true, message: 'Check Request rejected', data: populated });
}));

// DELETE / cancel
router.delete('/projects/:id/check-requests/:crId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.crId)) return badRequest(res, 'Invalid ID');

  const cr = await CheckRequest.findOne({ _id: req.params.crId, project: req.params.id });
  if (!cr) return notFound(res, 'Check Request');
  if (['Billed'].includes(cr.status)) {
    return badRequest(res, 'Billed Check Requests cannot be cancelled');
  }
  if (cr.status === 'Verified' && cr.items.some((i) => (Number(i.billedQuantity) || 0) > 0)) {
    return badRequest(res, 'Check Request already partially billed — cannot cancel');
  }

  cr.status = 'Cancelled';
  cr.updatedBy = req.user?._id;
  await cr.save();
  await InspectionReport.updateMany(
    { checkRequest: cr._id, status: 'Pending' },
    { $set: { status: 'Cancelled', completedAt: new Date(), updatedBy: req.user?._id } }
  );
  await syncProjectMetrics(req.params.id);

  res.json({ success: true, message: 'Check Request cancelled' });
}));

// ─── INSPECTION REPORTS (site inspection that verifies a Submitted Check Request) ───

const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || '';

const populateInspection = (query) =>
  query
    .populate({
      path: 'checkRequest',
      select: 'checkRequestNumber title status claimType contractor subletContract slab claimedTotal',
      populate: [
        { path: 'contractor', select: 'name' },
        { path: 'subletContract', select: 'contractNumber contractType' }
      ]
    })
    .populate('inspectors.user', 'firstName lastName email position digitalSignature')
    .populate('createdBy', 'firstName lastName');

// GET /api/project-management/projects/:id/inspection-reports[?checkRequest=]
router.get('/projects/:id/inspection-reports', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const filter = { project: req.params.id };
  if (req.query.checkRequest && isValidId(req.query.checkRequest)) filter.checkRequest = req.query.checkRequest;
  const reports = await populateInspection(InspectionReport.find(filter).sort({ createdAt: -1 })).lean();
  res.json({ success: true, data: reports });
}));

// POST /api/project-management/projects/:id/check-requests/:crId/inspection-reports — assign inspectors
router.post('/projects/:id/check-requests/:crId/inspection-reports', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.crId)) return badRequest(res, 'Invalid ID');

  const cr = await CheckRequest.findOne({ _id: req.params.crId, project: req.params.id });
  if (!cr) return notFound(res, 'Check Request');
  if (cr.status !== 'Submitted') return badRequest(res, 'Inspection reports are raised on Submitted check requests');
  const open = await InspectionReport.findOne({ checkRequest: cr._id, status: { $in: ['Pending', 'Approved'] } })
    .select('reportNumber status').lean();
  if (open) return badRequest(res, `${open.reportNumber} is already ${open.status.toLowerCase()} for this check request`);

  const { inspectionDate, location = '', remarks = '', inspectors = [], items = [] } = req.body;
  const inspectorIds = [...new Set((Array.isArray(inspectors) ? inspectors : []).map((u) => String(u?._id || u)))]
    .filter(isValidId);
  if (!inspectorIds.length) return badRequest(res, 'Assign at least one inspector');
  const users = await User.find({ _id: { $in: inspectorIds }, isActive: { $ne: false } })
    .select('firstName lastName email position').lean();
  if (users.length !== inspectorIds.length) return badRequest(res, 'One or more inspectors were not found or are inactive');
  const userById = new Map(users.map((u) => [String(u._id), u]));

  let reportItems = [];
  let inspectedTotal = 0;
  if (cr.claimType === 'Slab') {
    inspectedTotal = Number(cr.slab?.amount) || Number(cr.claimedTotal) || 0;
  } else {
    const byBoq = new Map((Array.isArray(items) ? items : []).map((r) => [String(r.boqItemId || r.boqItem), r]));
    for (const it of cr.items) {
      const row = byBoq.get(String(it.boqItem));
      const inspected = row?.inspectedQuantity !== undefined ? Number(row.inspectedQuantity) : Number(it.claimedQuantity);
      if (!Number.isFinite(inspected) || inspected < 0) return badRequest(res, `Invalid inspected quantity for "${it.title}"`);
      if (inspected > Number(it.claimedQuantity)) {
        return badRequest(res, `Inspected qty for "${it.title || it.description}" cannot exceed claimed qty (${it.claimedQuantity} ${it.unit})`);
      }
      reportItems.push({
        boqItem: it.boqItem, title: it.title || it.description, unit: it.unit,
        claimedQuantity: it.claimedQuantity, inspectedQuantity: inspected, unitPrice: it.unitPrice
      });
      inspectedTotal += inspected * (Number(it.unitPrice) || 0);
    }
    if (!reportItems.some((i) => i.inspectedQuantity > 0)) {
      return badRequest(res, 'At least one line must have an inspected quantity greater than zero');
    }
  }

  const project = await ConstructionProject.findById(req.params.id).select('parentProject').lean();
  const report = await InspectionReport.create({
    project: req.params.id,
    masterProject: project?.parentProject || null,
    checkRequest: cr._id,
    inspectionDate: inspectionDate ? new Date(inspectionDate) : new Date(),
    location,
    remarks,
    claimType: cr.claimType || 'BOQ',
    items: reportItems,
    slab: cr.claimType === 'Slab' ? { name: cr.slab?.name, percentage: cr.slab?.percentage, amount: cr.slab?.amount } : undefined,
    inspectedTotal,
    inspectors: inspectorIds.map((id) => ({
      user: id,
      name: fullName(userById.get(id)),
      designation: userById.get(id)?.position || ''
    })),
    createdBy: req.user?._id,
    updatedBy: req.user?._id
  });

  try {
    await NotificationService.createSystemAlert(
      `Inspection ${report.reportNumber} assigned to you`,
      `Please inspect ${cr.checkRequestNumber} — ${cr.title} and approve or reject with your observations.`,
      'high',
      inspectorIds,
      { module: 'other', entityId: report._id, entityType: 'InspectionReport', additionalData: { projectId: req.params.id } }
    );
  } catch { /* notification failure must not block the report */ }

  const populated = await populateInspection(InspectionReport.findById(report._id)).lean();
  res.status(201).json({ success: true, message: `Inspection report ${report.reportNumber} created`, data: populated });
}));

// POST /api/project-management/projects/:id/inspection-reports/:irId/decision — inspector approves / rejects
router.post('/projects/:id/inspection-reports/:irId/decision', withInspectionUpload, asyncHandler(async (req, res) => {
  // Any early return below must not leave orphaned uploads behind
  const fail = (status, message) => { removeUploaded(req); return res.status(status).json({ success: false, message }); };
  if (!isValidId(req.params.id) || !isValidId(req.params.irId)) return fail(400, 'Invalid ID');

  if (req.rejectedEvidence?.length) {
    return fail(400, `${req.rejectedEvidence.join(', ')}: photos must be image files and videos must be video files`);
  }
  const images = req.files?.images || [];
  const videos = req.files?.videos || [];
  if (images.length < INSPECTION_MIN_IMAGES || videos.length < INSPECTION_MIN_VIDEOS) {
    return fail(400, `Attach at least ${INSPECTION_MIN_IMAGES} photos and ${INSPECTION_MIN_VIDEOS} video of the site (got ${images.length} photo(s), ${videos.length} video(s))`);
  }
  const bigImage = images.find((f) => f.size > INSPECTION_IMAGE_MAX_BYTES);
  if (bigImage) return fail(400, `${bigImage.originalname} is over 10 MB — photos must be under 10 MB each`);

  const decision = req.body?.decision === 'Approved' ? 'Approved' : req.body?.decision === 'Rejected' ? 'Rejected' : null;
  const observations = String(req.body?.observations || '').trim();
  if (!decision) return fail(400, 'Decision must be Approved or Rejected');
  if (decision === 'Rejected' && !observations) return fail(400, 'Write your observations to reject');

  const report = await InspectionReport.findOne({ _id: req.params.irId, project: req.params.id });
  if (!report) return fail(404, 'Inspection Report not found');
  if (report.status !== 'Pending') return fail(400, `This inspection report is already ${report.status.toLowerCase()}`);

  const me = String(req.user?._id || '');
  const slot = report.inspectors.find((i) => String(i.user) === me);
  if (!slot) return fail(403, 'You are not an assigned inspector on this report');
  if (slot.status !== 'Pending') return fail(400, `You already ${slot.status.toLowerCase()} this report`);

  const user = await User.findById(me).select('firstName lastName email position digitalSignature').lean();
  if (!user?.digitalSignature) {
    return fail(400, 'Upload your digital signature in your profile before signing an inspection report');
  }

  slot.status = decision;
  slot.observations = observations;
  slot.signature = user.digitalSignature;
  slot.name = fullName(user) || slot.name;
  slot.designation = user.position || slot.designation;
  slot.actedAt = new Date();
  slot.attachments = [
    ...images.map((f) => ({ kind: 'image', file: f })),
    ...videos.map((f) => ({ kind: 'video', file: f }))
  ].map(({ kind, file }) => ({
    kind,
    url: `/uploads/project-management/inspections/${file.filename}`,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  }));

  const cr = await CheckRequest.findById(report.checkRequest);
  if (!cr) return fail(404, 'Check Request not found');

  if (decision === 'Rejected') {
    report.status = 'Rejected';
    report.completedAt = new Date();
    if (cr.status === 'Submitted') {
      cr.status = 'Rejected';
      cr.rejectionReason = `Inspection ${report.reportNumber} rejected by ${slot.name}: ${observations}`;
      cr.rejectedAt = new Date();
      cr.rejectedBy = req.user?._id;
      cr.updatedBy = req.user?._id;
      await cr.save();
    }
  } else if (report.inspectors.every((i) => i.status === 'Approved')) {
    // Last signature: verify the check request first so a failed cap leaves the report pending
    const signers = report.inspectors.map((i) => i.name).filter(Boolean).join(', ');
    const notes = [
      `Inspection Report ${report.reportNumber}`,
      report.remarks,
      ...report.inspectors.filter((i) => i.observations).map((i) => `${i.name}: ${i.observations}`)
    ].filter(Boolean).join(' — ');
    const result = await applyCheckRequestVerification(cr, {
      projectId: req.params.id,
      userId: req.user?._id,
      verifiedBy: signers,
      verificationNotes: notes,
      items: report.items.map((i) => ({ boqItemId: i.boqItem, verifiedQuantity: i.inspectedQuantity }))
    });
    if (result.error) return fail(400, result.error);
    report.status = 'Approved';
    report.completedAt = new Date();
  }

  report.updatedBy = req.user?._id;
  await report.save();

  const populated = await populateInspection(InspectionReport.findById(report._id)).lean();
  const message = report.status === 'Approved'
    ? 'All inspectors approved — check request verified and ready for IPC'
    : report.status === 'Rejected'
      ? 'Inspection rejected — check request sent back with your observations'
      : `${decision} — waiting for the other inspectors`;
  res.json({ success: true, message, data: populated });
}));

// POST /api/project-management/projects/:id/inspection-reports/:irId/cancel
router.post('/projects/:id/inspection-reports/:irId/cancel', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.irId)) return badRequest(res, 'Invalid ID');
  const report = await InspectionReport.findOne({ _id: req.params.irId, project: req.params.id });
  if (!report) return notFound(res, 'Inspection Report');
  if (report.status !== 'Pending') return badRequest(res, 'Only pending inspection reports can be cancelled');
  report.status = 'Cancelled';
  report.completedAt = new Date();
  report.updatedBy = req.user?._id;
  await report.save();
  res.json({ success: true, message: `Inspection report ${report.reportNumber} cancelled` });
}));

// ─── SUBLET CONTRACTS (sublet BOQ lines to subcontractors) ───────────────────

const populateSublet = (query) =>
  query
    .populate('contractor', 'name email phone vendorType vendorCategory supplierId')
    .populate('items.boqItem', 'title description unit estimatedQuantity estimatedUnitPrice contractorUnitPrice contractor')
    .populate('slabSchedule', 'name projectType')
    .populate('createdBy', 'firstName lastName')
    .populate('activatedBy', 'firstName lastName')
    // Re-contracting chain: enough of each linked contract for the history and the rate comparison
    .populate({
      path: 'replacesContract replacedBy',
      select: 'contractNumber title status contractType totalAmount ratePerUnit units items.boqItem items.title items.unit items.quantity items.unitPrice slabs.name slabs.percentage cancellation.cancellationDate cancellation.reason cancellation.workDone.amount activatedAt createdAt',
      populate: { path: 'contractor', select: 'name' }
    });

const getAlreadySublettedQty = async (projectId, boqItemId, excludeContractId = null) => {
  const match = {
    project: new mongoose.Types.ObjectId(projectId),
    status: { $in: ['Draft', 'Active', 'Completed'] }
  };
  if (excludeContractId) {
    match._id = { $ne: new mongoose.Types.ObjectId(excludeContractId) };
  }
  const boqId = new mongoose.Types.ObjectId(boqItemId);
  const rows = await SubletContract.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $match: { 'items.boqItem': boqId } },
    { $group: { _id: null, qty: { $sum: '$items.quantity' } } }
  ]);
  // Quantity done under a cancelled contract stays taken — only the rest can be contracted again
  const doneMatch = { project: match.project, status: 'Cancelled', 'cancellation.workDone.lines.boqItem': boqId };
  if (match._id) doneMatch._id = match._id;
  const done = await SubletContract.aggregate([
    { $match: doneMatch },
    { $unwind: '$cancellation.workDone.lines' },
    { $match: { 'cancellation.workDone.lines.boqItem': boqId } },
    { $group: { _id: null, qty: { $sum: '$cancellation.workDone.lines.quantity' } } }
  ]);
  return (Number(rows[0]?.qty) || 0) + (Number(done[0]?.qty) || 0);
};

const buildSubletItems = async (projectId, masterProjectId, rawItems = [], excludeContractId = null) => {
  const items = [];
  let totalAmount = 0;

  for (const row of rawItems) {
    const boqId = row.boqItemId || row.boqItem;
    if (!boqId || !isValidId(boqId)) continue;

    const searchCriteria = masterProjectId
      ? { _id: boqId, $or: [{ project: projectId }, { project: masterProjectId }] }
      : { _id: boqId, project: projectId };

    const boq = await BOQItem.findOne(searchCriteria).lean();
    if (!boq) continue;

    const quantity = Math.max(0, Number(row.quantity) || 0);
    if (quantity <= 0) continue;

    const already = await getAlreadySublettedQty(projectId, boq._id, excludeContractId);
    const ceiling = Number(boq.estimatedQuantity) || 0;
    if (already + quantity > ceiling + 0.0001) {
      const err = new Error(
        `Cannot sublet ${quantity} ${boq.unit} of "${boq.title || boq.description}". ` +
        `Already subletted ${already}, BOQ qty ${ceiling}, remaining ${Math.max(0, ceiling - already)}.`
      );
      err.statusCode = 400;
      throw err;
    }

    const unitPrice = Number(row.unitPrice) || Number(boq.contractorUnitPrice) || Number(boq.estimatedUnitPrice) || 0;
    const amount = quantity * unitPrice;
    totalAmount += amount;

    items.push({
      boqItem: boq._id,
      title: boq.title || '',
      description: boq.description || '',
      unit: boq.unit || '',
      quantity,
      unitPrice,
      amount,
      notes: row.notes || ''
    });
  }

  return { items, totalAmount };
};

/**
 * Villas / units a contract covers. A Sub Project with units listed needs at least one picked;
 * one without units covers the whole Sub Project (empty list).
 */
const resolveContractUnits = (project, rawUnits) => {
  const listed = project.units || [];
  if (!listed.length) return { units: [] };
  const ids = [...new Set((Array.isArray(rawUnits) ? rawUnits : []).map((u) => String(u?.unit || u?._id || u)))];
  if (!ids.length) return { error: `Select the ${unitLabel(project, true)} this contract covers` };
  const byId = new Map(listed.map((u) => [String(u._id), u]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) return { error: `Some selected ${unitLabel(project, true)} are not in this Sub Project` };
  // Keep the Sub Project's own order (Villa 1, 2, 3 …)
  return { units: listed.filter((u) => ids.includes(String(u._id))).map((u) => ({ unit: u._id, name: u.name })) };
};

/** What a Sub Project's units are called for its type (same names as the screens) */
const UNIT_NAMES = {
  VILLAS: ['Villa', 'Villas'],
  COMMERCIAL: ['Floor / Unit', 'Floors / Units'],
  'INFRASTRUCTURE DEVELOPMENT': ['Section', 'Sections']
};
const unitNames = (project) => UNIT_NAMES[normalizeProjectType(project?.projectType)] || ['Unit', 'Units'];
const unitLabel = (project, plural = false) => unitNames(project)[plural ? 1 : 0].toLowerCase();

/** Two contracts share work only if their units overlap — an empty list means the whole Sub Project */
const unitsOverlap = (a = [], b = []) => {
  if (!a.length || !b.length) return true;
  const ids = new Set(a.map((u) => String(u.unit)));
  return b.some((u) => ids.has(String(u.unit)));
};

/**
 * Slab-wise contract value: with units it is rate per unit × units (client value likewise),
 * otherwise the lump sums entered.
 */
const slabContractValues = (body, units, fallback = {}) => {
  if (!units.length) {
    return {
      contractValue: Number(body.contractValue ?? fallback.contractValue) || 0,
      clientValue: Math.max(0, Number(body.clientValue ?? fallback.clientValue) || 0),
      ratePerUnit: 0,
      clientRatePerUnit: 0
    };
  }
  const ratePerUnit = Math.max(0, Number(body.ratePerUnit ?? fallback.ratePerUnit) || 0);
  const clientRatePerUnit = Math.max(0, Number(body.clientRatePerUnit ?? fallback.clientRatePerUnit) || 0);
  return {
    contractValue: ratePerUnit * units.length,
    clientValue: clientRatePerUnit * units.length,
    ratePerUnit,
    clientRatePerUnit
  };
};

/**
 * Slab-wise contract stages: % of contract value, each covering master WBS activities of the
 * sub project's type. An activity can sit in only one open slab-wise contract per villa / unit
 * (per Sub Project when it has no units).
 */
const buildSubletSlabs = async (project, { contractValue, slabs: rawSlabs, slabSchedule, units = [] }, excludeContractId = null) => {
  const fail = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  };

  const projectType = normalizeProjectType(project.projectType);
  if (!projectType) fail('Set the Sub Project\'s Project Type (Infra / Commercial / Villas) before creating a slab-wise contract');

  const value = Number(contractValue) || 0;
  if (value <= 0) fail(units.length ? `Enter the rate per ${unitLabel(project)}` : 'Enter the contract value for a slab-wise contract');

  let scheduleId = null;
  if (slabSchedule) {
    if (!isValidId(slabSchedule)) fail('Invalid slab schedule');
    const schedule = await SlabSchedule.findById(slabSchedule).select('projectType').lean();
    if (!schedule) fail('Slab schedule not found');
    if (schedule.projectType !== projectType) fail(`Slab schedule is for ${schedule.projectType}, but this Sub Project is ${projectType}`);
    scheduleId = schedule._id;
  }

  const { slabs, error } = await buildSlabRows(projectType, rawSlabs);
  if (error) fail(error);

  const activityIds = slabs.flatMap((s) => s.activities);
  const masters = activityIds.length
    ? await WbsActivity.find({ _id: { $in: activityIds } }).select('name group').lean()
    : [];
  const masterById = new Map(masters.map((m) => [String(m._id), m]));

  if (activityIds.length) {
    const clashFilter = {
      project: project._id,
      contractType: 'Slab',
      status: { $in: ['Draft', 'Active', 'Completed'] },
      'slabs.activities.activity': { $in: activityIds }
    };
    if (excludeContractId) clashFilter._id = { $ne: excludeContractId };
    const candidates = await SubletContract.find(clashFilter).select('contractNumber slabs.activities units').lean();
    const clash = candidates.find((c) => unitsOverlap(c.units, units));
    if (clash) {
      const taken = new Set(clash.slabs.flatMap((s) => s.activities.map((a) => String(a.activity))));
      const names = activityIds.filter((id) => taken.has(id)).map((id) => masterById.get(id)?.name).filter(Boolean);
      const shared = units.length && clash.units?.length
        ? ` for ${clash.units.filter((u) => units.some((x) => String(x.unit) === String(u.unit))).map((u) => u.name).join(', ')}`
        : '';
      fail(`Already covered by sublet contract ${clash.contractNumber}${shared}: ${names.join(', ')}`);
    }

    // Slabs already done under a cancelled contract stay with it (for the villas they were done for)
    const doneFilter = {
      project: project._id,
      contractType: 'Slab',
      status: 'Cancelled',
      'cancellation.workDone.slabs.0': { $exists: true }
    };
    if (excludeContractId) doneFilter._id = { $ne: excludeContractId };
    const cancelled = await SubletContract.find(doneFilter).select('contractNumber slabs units cancellation.workDone.slabs').lean();
    const wanted = new Set(activityIds.map(String));
    for (const c of cancelled) {
      for (const ds of c.cancellation.workDone.slabs) {
        const slab = (c.slabs || []).find((s) => String(s._id) === String(ds.slabId));
        if (!slab) continue;
        const doneUnits = ds.units?.length ? ds.units : (c.units || []);
        if (!unitsOverlap(doneUnits, units)) continue;
        const hit = slab.activities.filter((a) => wanted.has(String(a.activity))).map((a) => masterById.get(String(a.activity))?.name || a.name);
        if (hit.length) {
          const where = units.length && doneUnits.length
            ? ` for ${doneUnits.filter((u) => units.some((x) => String(x.unit) === String(u.unit))).map((u) => u.name).join(', ')}`
            : '';
          fail(`Already done under cancelled contract ${c.contractNumber} (${slab.name})${where}: ${hit.join(', ')}`);
        }
      }
    }
  }

  // Round each slab to whole rupees; the last slab absorbs the remainder so slabs sum to the contract value
  let allocated = 0;
  const built = slabs.map((s, idx) => {
    const amount = idx === slabs.length - 1
      ? Math.max(0, value - allocated)
      : Math.round((value * s.percentage) / 100);
    allocated += amount;
    return {
      name: s.name,
      percentage: s.percentage,
      amount,
      notes: s.description || '',
      activities: s.activities.map((id) => ({
        activity: id,
        name: masterById.get(id)?.name || '',
        group: masterById.get(id)?.group || ''
      }))
    };
  });

  return { slabs: built, totalAmount: value, slabSchedule: scheduleId };
};

const syncSubletToBoq = async (contract, projectId) => {
  for (const line of contract.items) {
    const boq = await BOQItem.findById(line.boqItem);
    if (!boq) continue;

    boq.contractor = contract.contractor;
    boq.contractorUnitPrice = Number(line.unitPrice) || boq.contractorUnitPrice || 0;
    boq.subProject = projectId;

    // Upsert allocation row for this sub + contractor
    const existing = (boq.allocations || []).find(
      (a) =>
        String(a.subProject || '') === String(projectId) &&
        String(a.contractor || '') === String(contract.contractor)
    );
    if (existing) {
      existing.allocatedQuantity = Number(line.quantity) || 0;
      existing.contractorUnitPrice = Number(line.unitPrice) || 0;
      existing.notes = `Sublet ${contract.contractNumber}`;
    } else {
      boq.allocations = boq.allocations || [];
      boq.allocations.push({
        subProject: projectId,
        contractor: contract.contractor,
        allocatedQuantity: Number(line.quantity) || 0,
        contractorUnitPrice: Number(line.unitPrice) || 0,
        notes: `Sublet ${contract.contractNumber}`
      });
    }
    await boq.save();
  }
};

// ─── CANCELLING A SUBLET CONTRACT ────────────────────────────────────────────

const DONE_CR_STATUSES = ['Verified', 'Billed'];
const PENDING_CR_STATUSES = ['Draft', 'Submitted'];
const PENDING_IPC_STATUSES = ['Draft', ...PENDING_IPC_STAGES];

/**
 * Where a sublet contract stands: the work done on it (verified claims, per BOQ line or per slab),
 * its money (billed, paid, payable, retention held, advance not yet recovered) and anything still
 * in progress (claims not verified, bills not approved) that must be finished before it can be cancelled.
 */
const contractSettlement = async (contract) => {
  const crs = await CheckRequest.find({ subletContract: contract._id, status: { $nin: ['Cancelled', 'Rejected'] } })
    .select('checkRequestNumber claimType slab units items status verifiedTotal').lean();
  const crIds = crs.map((c) => c._id);
  const ipcs = await ProjectInvoice.find({
    invoiceType: 'Subcontractor_IPC',
    status: { $ne: 'Cancelled' },
    $or: [{ subletContract: contract._id }, ...(crIds.length ? [{ checkRequest: { $in: crIds } }] : [])]
  }).select('invoiceNumber ipcNumber ipcKind approvalStatus grossAmount retentionAmount advanceRecoveryAmount netPayableAmount paidAmount').lean();

  const sum = (list, f) => round2(list.reduce((t, x) => t + (Number(x[f]) || 0), 0));
  const done = crs.filter((c) => DONE_CR_STATUSES.includes(c.status));

  // Work done per BOQ line / per slab
  const lines = [];
  const slabs = [];
  if (contract.contractType === 'Slab') {
    const bySlab = new Map();
    done.filter((c) => c.claimType === 'Slab' && c.slab?.slabId).forEach((c) => {
      const key = String(c.slab.slabId);
      const prev = bySlab.get(key) || { amount: 0, units: new Map(), whole: false };
      prev.amount += Number(c.verifiedTotal) || 0;
      if (!c.units?.length) prev.whole = true;
      (c.units || []).forEach((u) => prev.units.set(String(u.unit), { unit: u.unit, name: u.name }));
      bySlab.set(key, prev);
    });
    (contract.slabs || []).forEach((s) => {
      const d = bySlab.get(String(s._id));
      if (!d) return;
      slabs.push({
        slabId: s._id, name: s.name, percentage: s.percentage, amount: round2(d.amount),
        units: d.whole ? [] : [...d.units.values()]
      });
    });
  } else {
    const byLine = new Map();
    done.forEach((c) => (c.items || []).forEach((it) => {
      const key = String(it.boqItem);
      const prev = byLine.get(key) || { qty: 0, amount: 0 };
      byLine.set(key, { qty: prev.qty + (Number(it.verifiedQuantity) || 0), amount: prev.amount + (Number(it.verifiedAmount) || 0) });
    }));
    (contract.items || []).forEach((it) => {
      const d = byLine.get(String(it.boqItem?._id || it.boqItem));
      if (!d || d.qty <= 0) return;
      lines.push({
        boqItem: it.boqItem?._id || it.boqItem,
        title: it.title || it.boqItem?.title || it.description || '',
        unit: it.unit || it.boqItem?.unit || '',
        contractedQuantity: Number(it.quantity) || 0,
        quantity: d.qty,
        unitPrice: round2(it.unitPrice),
        amount: round2(d.amount)
      });
    });
  }
  const workDoneAmount = round2([...lines, ...slabs].reduce((t, x) => t + (Number(x.amount) || 0), 0));

  // Money, the same way the cost detail counts it
  const work = ipcs.filter((i) => !NON_WORK_IPC_KINDS.includes(i.ipcKind));
  const approved = (list) => list.filter((i) => i.approvalStatus === 'Approved');
  const advancePaid = sum(approved(ipcs.filter((i) => i.ipcKind === 'Advance')), 'grossAmount');
  const verified = sum(done, 'verifiedTotal');
  const billed = sum(work, 'grossAmount');
  const money = {
    verified,
    billed,
    unbilled: Math.max(0, round2(verified - billed)),
    paid: sum(ipcs, 'paidAmount'),
    payable: Math.max(0, round2(sum(approved(ipcs), 'netPayableAmount') - sum(approved(ipcs), 'paidAmount'))),
    retentionHeld: Math.max(0, round2(sum(approved(work), 'retentionAmount') - sum(ipcs.filter((i) => i.ipcKind === 'Retention Release'), 'grossAmount'))),
    advanceOutstanding: Math.max(0, round2(advancePaid - sum(work, 'advanceRecoveryAmount')))
  };

  const pending = [
    ...crs.filter((c) => PENDING_CR_STATUSES.includes(c.status))
      .map((c) => ({ kind: 'Check request', number: c.checkRequestNumber, status: c.status })),
    ...ipcs.filter((i) => PENDING_IPC_STATUSES.includes(i.approvalStatus))
      .map((i) => ({ kind: i.ipcKind === 'Work' || !i.ipcKind ? 'IPC' : `${i.ipcKind} IPC`, number: i.invoiceNumber || `#${i.ipcNumber}`, status: i.approvalStatus }))
  ];

  return { workDone: { amount: workDoneAmount, lines, slabs }, money, pending };
};

/** After a cancellation, a contractor's BOQ allocation on the Sub Project shrinks to what they still hold */
const resyncBoqAllocationsAfterCancel = async (contract, projectId) => {
  const boqIds = (contract.items || []).map((it) => it.boqItem?._id || it.boqItem).filter(Boolean);
  if (!boqIds.length) return;
  const others = await SubletContract.find({
    project: projectId, contractor: contract.contractor, _id: { $ne: contract._id },
    $or: [{ status: { $in: ['Active', 'Completed'] } }, { status: 'Cancelled', 'cancellation.workDone.lines.0': { $exists: true } }]
  }).select('status items cancellation.workDone.lines').lean();
  const held = (boqId, own) => {
    const key = String(boqId);
    let qty = own;
    others.forEach((c) => {
      const list = c.status === 'Cancelled' ? c.cancellation.workDone.lines : c.items;
      (list || []).forEach((it) => { if (String(it.boqItem) === key) qty += Number(it.quantity) || 0; });
    });
    return qty;
  };
  const doneQty = new Map((contract.cancellation?.workDone?.lines || []).map((l) => [String(l.boqItem), Number(l.quantity) || 0]));
  for (const boqId of boqIds) {
    const boq = await BOQItem.findById(boqId);
    if (!boq) continue;
    const row = (boq.allocations || []).find((a) =>
      String(a.subProject || '') === String(projectId) && String(a.contractor || '') === String(contract.contractor));
    if (!row) continue;
    const qty = held(boqId, doneQty.get(String(boqId)) || 0);
    if (qty > 0) {
      row.allocatedQuantity = qty;
    } else {
      boq.allocations = boq.allocations.filter((a) => a !== row);
    }
    await boq.save();
  }
};

const loadContractForCancel = async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.scId)) { badRequest(res, 'Invalid ID'); return null; }
  const contract = await SubletContract.findOne({ _id: req.params.scId, project: req.params.id })
    .populate('items.boqItem', 'title unit');
  if (!contract) { notFound(res, 'Sublet Contract'); return null; }
  return contract;
};

const pendingMessage = (pending) =>
  `Finish or reject these first — they are still in progress on this contract: ${pending.map((p) => `${p.kind} ${p.number} (${p.status})`).join(', ')}`;

// GET what cancelling would mean: work done, money, properties released, anything blocking it
router.get('/projects/:id/sublet-contracts/:scId/cancel-preview', asyncHandler(async (req, res) => {
  const contract = await loadContractForCancel(req, res); if (!contract) return;
  if (contract.status === 'Cancelled') return badRequest(res, 'This contract is already cancelled');
  if (contract.status === 'Completed') return badRequest(res, 'Completed contracts cannot be cancelled');
  const s = contract.status === 'Draft'
    ? { workDone: { amount: 0, lines: [], slabs: [] }, money: null, pending: [] }
    : await contractSettlement(contract);
  res.json({
    success: true,
    data: {
      contractNumber: contract.contractNumber,
      status: contract.status,
      contractType: contract.contractType || 'BOQ',
      contractValue: round2(contract.totalAmount),
      ...s,
      budgetReleased: Math.max(0, round2((Number(contract.totalAmount) || 0) - s.workDone.amount)),
      propertiesToRelease: (contract.barterProperties || []).filter((p) => p.status === 'Reserved')
        .map((p) => ({ label: p.label || p.plotNumber || 'Property', agreedValue: round2(p.agreedValue) })),
      canCancel: !s.pending.length
    }
  });
}));

/**
 * Cancel a sublet contract. Draft: simply cancelled. Active: needs a reason; claims and bills in progress must be
 * finished first; the work done is frozen on the contract (it keeps that budget and that scope), properties not yet
 * handed over are released, and the money position at that moment is recorded.
 */
const cancelSubletContract = async (req, res) => {
  const contract = await loadContractForCancel(req, res); if (!contract) return;
  if (contract.status === 'Cancelled') return badRequest(res, 'This contract is already cancelled');
  if (contract.status === 'Completed') return badRequest(res, 'Completed contracts cannot be cancelled');

  const reason = String(req.body?.reason || '').trim();
  const wasActive = contract.status === 'Active';
  if (wasActive && reason.length < 5) return badRequest(res, 'Write the reason for cancelling this contract');
  let cancellationDate = new Date();
  if (req.body?.cancellationDate) {
    cancellationDate = new Date(req.body.cancellationDate);
    if (Number.isNaN(cancellationDate.getTime())) return badRequest(res, 'Invalid cancellation date');
    if (cancellationDate.getTime() > Date.now() + 24 * 3600e3) return badRequest(res, 'The cancellation date cannot be in the future');
  }

  const s = wasActive ? await contractSettlement(contract) : { workDone: { amount: 0, lines: [], slabs: [] }, money: {}, pending: [] };
  if (s.pending.length) return badRequest(res, pendingMessage(s.pending));

  let released = 0;
  (contract.barterProperties || []).forEach((p) => {
    if (p.status !== 'Reserved') return;
    p.status = 'Released';
    p.notes = [p.notes, `Released — contract cancelled ${cancellationDate.toISOString().slice(0, 10)}`].filter(Boolean).join(' · ');
    released += 1;
  });

  contract.status = 'Cancelled';
  contract.cancellation = {
    reason,
    cancellationDate,
    cancelledAt: new Date(),
    cancelledBy: req.user?._id,
    cancelledByName: personName(req.user),
    workDone: s.workDone,
    settlement: s.money,
    releasedProperties: released
  };
  contract.updatedBy = req.user?._id;
  await contract.save();
  if (wasActive && contract.contractType !== 'Slab') await resyncBoqAllocationsAfterCancel(contract, req.params.id);
  await syncProjectMetrics(req.params.id);

  const freed = Math.max(0, round2((Number(contract.totalAmount) || 0) - s.workDone.amount));
  const message = wasActive
    ? `Contract cancelled. Work done ${fmtPkr(s.workDone.amount)} stays with it; ${fmtPkr(freed)} of budget and the remaining scope are free for a new contract${released ? `; ${released} propert${released === 1 ? 'y' : 'ies'} released` : ''}`
    : 'Draft contract cancelled';
  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  return res.json({ success: true, message, data: populated });
};

router.post('/projects/:id/sublet-contracts/:scId/cancel', asyncHandler(cancelSubletContract));

// ─── RE-CONTRACTING THE REMAINING WORK ───────────────────────────────────────

/**
 * What is left of a cancelled contract, at its old rates, to pre-fill a new contract.
 * BOQ: each line's contracted quantity minus the quantity done (and minus anything already given to another
 * replacement contract). Slab: the slabs not yet done, per villa — villas at the same stage are grouped,
 * since one contract covers one set of villas with one set of slabs.
 */
const remainingScope = async (contract) => {
  const done = contract.cancellation?.workDone || { lines: [], slabs: [] };
  // Work given to a replacement is not offered again here. If that replacement is cancelled too, what it left
  // undone is re-contracted from it (the newest contract in the chain); only a replacement cancelled while
  // still a Draft (never started) hands its share back.
  const replacements = (await SubletContract.find({ replacesContract: contract._id })
    .select('contractNumber status activatedAt items units slabs').lean())
    .filter((r) => r.status !== 'Cancelled' || r.activatedAt);
  const heldItems = (r) => r.items || [];
  const heldSlabs = (r) => (r.slabs || []).map((sl) => ({ name: sl.name, units: r.units || [] }));

  if (contract.contractType !== 'Slab') {
    const doneQty = new Map((done.lines || []).map((l) => [String(l.boqItem), Number(l.quantity) || 0]));
    const takenQty = new Map();
    replacements.forEach((r) => heldItems(r).forEach((it) => {
      const k = String(it.boqItem);
      takenQty.set(k, (takenQty.get(k) || 0) + (Number(it.quantity) || 0));
    }));
    const lines = (contract.items || []).map((it) => {
      const k = String(it.boqItem?._id || it.boqItem);
      const contracted = Number(it.quantity) || 0;
      const doneQ = doneQty.get(k) || 0;
      const already = takenQty.get(k) || 0;
      const remaining = Math.max(0, round2(contracted - doneQ - already));
      return {
        boqItem: k, title: it.title || it.boqItem?.title || '', unit: it.unit || it.boqItem?.unit || '',
        contractedQuantity: contracted, doneQuantity: doneQ, recontractedQuantity: already,
        remainingQuantity: remaining, oldRate: round2(it.unitPrice), oldAmount: round2(remaining * (Number(it.unitPrice) || 0))
      };
    }).filter((l) => l.remainingQuantity > 0);
    return { lines, groups: [], remainingValue: round2(lines.reduce((t, l) => t + l.oldAmount, 0)) };
  }

  // Slab: which slabs are still to do, villa by villa (a contract with no villas is one "whole" scope)
  const cUnits = contract.units || [];
  const scopes = cUnits.length ? cUnits.map((u) => ({ unit: u.unit, name: u.name })) : [null];
  const doneFor = (slab, scope) => (done.slabs || []).some((ds) => String(ds.slabId) === String(slab._id)
    && (!ds.units?.length || (scope && ds.units.some((u) => String(u.unit) === String(scope.unit)))));
  // Villas / slabs already handed to a replacement contract are not offered again
  const takenBy = (slab, scope) => replacements.some((r) => heldSlabs(r).some((s) => s.name === slab.name
    && (!scope || !s.units.length || s.units.some((u) => String(u.unit) === String(scope.unit)))));

  const groups = new Map();
  scopes.forEach((scope) => {
    const left = (contract.slabs || []).filter((s) => !doneFor(s, scope) && !takenBy(s, scope));
    if (!left.length) return;
    const key = left.map((s) => String(s._id)).join(',');
    const g = groups.get(key) || { units: [], slabs: left };
    if (scope) g.units.push(scope);
    groups.set(key, g);
  });

  const perUnit = Number(contract.ratePerUnit) > 0 && cUnits.length > 0;
  const out = [...groups.values()].map((g) => {
    const pct = g.slabs.reduce((t, s) => t + (Number(s.percentage) || 0), 0);
    const oldValue = perUnit
      ? round2((Number(contract.ratePerUnit) * g.units.length * pct) / 100)
      : round2((Number(contract.totalAmount) || 0) * pct / 100);
    return {
      units: g.units,
      remainingPercent: round2(pct),
      oldValue,
      // Per villa at the old rate, for the remaining share — the starting point for the new rate
      oldRatePerUnit: perUnit ? round2((Number(contract.ratePerUnit) * pct) / 100) : 0,
      // Remaining slabs re-weighted to 100% of the new contract
      slabs: g.slabs.map((s) => ({
        slabId: s._id, name: s.name, oldPercentage: s.percentage,
        percentage: pct > 0 ? round2((Number(s.percentage) * 100) / pct) : 0,
        notes: s.notes || '',
        activities: (s.activities || []).map((a) => String(a.activity))
      }))
    };
  });
  // Rounding: make each group's slabs add up to exactly 100
  out.forEach((g) => {
    const diff = round2(100 - g.slabs.reduce((t, s) => t + s.percentage, 0));
    if (g.slabs.length && diff) g.slabs[g.slabs.length - 1].percentage = round2(g.slabs[g.slabs.length - 1].percentage + diff);
  });
  return { lines: [], groups: out, remainingValue: round2(out.reduce((t, g) => t + g.oldValue, 0)) };
};

// GET the remaining work of a cancelled contract, to start a new contract from
router.get('/projects/:id/sublet-contracts/:scId/remaining', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.scId)) return badRequest(res, 'Invalid ID');
  const contract = await SubletContract.findOne({ _id: req.params.scId, project: req.params.id })
    .populate('items.boqItem', 'title unit').populate('contractor', 'name').lean();
  if (!contract) return notFound(res, 'Sublet Contract');
  if (contract.status !== 'Cancelled') return badRequest(res, 'Only a cancelled contract\'s remaining work can be re-contracted');
  const scope = await remainingScope(contract);
  res.json({
    success: true,
    data: {
      contract: {
        _id: contract._id, contractNumber: contract.contractNumber, title: contract.title,
        contractType: contract.contractType || 'BOQ', contractor: contract.contractor,
        propertyPercent: contract.propertyPercent || 0, slabSchedule: contract.slabSchedule || null,
        ratePerUnit: contract.ratePerUnit || 0, cancellation: contract.cancellation
      },
      ...scope,
      hasRemaining: scope.lines.length > 0 || scope.groups.length > 0
    }
  });
}));

/** Check a new contract's `replacesContract`: a cancelled contract of the same Sub Project */
const resolveReplacedContract = async (projectId, replacesId) => {
  if (!replacesId) return { replaced: null };
  if (!isValidId(replacesId)) return { error: 'Invalid contract being replaced' };
  const replaced = await SubletContract.findOne({ _id: replacesId, project: projectId }).select('contractNumber status').lean();
  if (!replaced) return { error: 'The contract being replaced was not found on this Sub Project' };
  if (replaced.status !== 'Cancelled') return { error: `${replaced.contractNumber} is ${replaced.status} — only a cancelled contract's work can be re-contracted` };
  return { replaced };
};

// GET /api/project-management/projects/:id/sublet-contracts
router.get('/projects/:id/sublet-contracts', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const filter = { project: req.params.id };
  if (req.query.status) filter.status = req.query.status;
  // Contracts saved before contract types existed have no field and are BOQ-wise
  if (req.query.contractType === 'Slab') filter.contractType = 'Slab';
  if (req.query.contractType === 'BOQ') filter.contractType = { $ne: 'Slab' };
  if (req.query.contractor && isValidId(req.query.contractor)) {
    filter.contractor = req.query.contractor;
  }

  const contracts = await populateSublet(
    SubletContract.find(filter).sort({ createdAt: -1 })
  ).lean();

  res.json({
    success: true,
    data: {
      contracts,
      counts: {
        draft: contracts.filter((c) => c.status === 'Draft').length,
        active: contracts.filter((c) => c.status === 'Active').length,
        completed: contracts.filter((c) => c.status === 'Completed').length,
        cancelled: contracts.filter((c) => c.status === 'Cancelled').length
      }
    }
  });
}));

// GET one
router.get('/projects/:id/sublet-contracts/:scId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.scId)) return badRequest(res, 'Invalid ID');

  const contract = await populateSublet(
    SubletContract.findOne({ _id: req.params.scId, project: req.params.id })
  ).lean();
  if (!contract) return notFound(res, 'Sublet Contract');

  res.json({ success: true, data: contract });
}));

// POST create
router.post('/projects/:id/sublet-contracts', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id)
    .populate('parentProject', 'name projectNumber society sector')
    .lean();
  if (!project) return notFound(res, 'Project');
  if (!project.parentProject) {
    return badRequest(res, 'Sublet Contracts are created on Sub Projects only');
  }

  const masterProjectId = project.parentProject._id || project.parentProject;
  const mainProjectName = project.parentProject.name || '';
  const subProjectName = project.name || '';
  const sector = project.sector || project.parentProject.sector || '';
  const society = project.society || project.parentProject.society || '';

  const { title, contractor, items = [], notes, startDate, endDate, activate } = req.body;
  const contractType = req.body.contractType === 'Slab' ? 'Slab' : 'BOQ';
  if (project.contractBasis && contractType !== project.contractBasis) {
    return badRequest(res, `${project.name} is ${contractBasisLabel(project.contractBasis)} — only ${contractBasisLabel(project.contractBasis)} contracts can be made here`);
  }
  if (!title || !String(title).trim()) return badRequest(res, 'Title is required');
  if (!contractor || !isValidId(contractor)) return badRequest(res, 'Subcontractor is required');

  const { units, error: unitsError } = resolveContractUnits(project, req.body.units);
  if (unitsError) return badRequest(res, unitsError);
  const { propertyPercent, error: payError } = resolvePropertyPercent(project, req.body.propertyPercent);
  if (payError) return badRequest(res, payError);
  // Re-contracting the remaining work of a cancelled contract
  const { replaced, error: replacedError } = await resolveReplacedContract(req.params.id, req.body.replacesContract);
  if (replacedError) return badRequest(res, replacedError);
  let clientValue = 0;

  let typeFields;
  try {
    if (contractType === 'Slab') {
      const values = slabContractValues(req.body, units);
      clientValue = values.clientValue;
      const built = await buildSubletSlabs(project, { ...req.body, contractValue: values.contractValue, units });
      typeFields = {
        items: [], slabs: built.slabs, slabSchedule: built.slabSchedule, totalAmount: built.totalAmount,
        ratePerUnit: values.ratePerUnit, clientRatePerUnit: values.clientRatePerUnit
      };
    } else {
      const built = await buildSubletItems(req.params.id, masterProjectId, items);
      if (!built.items.length) {
        return badRequest(res, 'Add at least one BOQ line with quantity to sublet');
      }
      typeFields = { items: built.items, slabs: [], slabSchedule: null, totalAmount: built.totalAmount };
    }
  } catch (err) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    throw err;
  }

  const budgetError = await checkContractBudget(req.params.id, typeFields.totalAmount);
  if (budgetError) return badRequest(res, budgetError);

  const contract = await SubletContract.create({
    project: req.params.id,
    masterProject: masterProjectId,
    mainProjectName,
    subProjectName,
    sector,
    society,
    title: String(title).trim(),
    contractor,
    contractType,
    units,
    propertyPercent,
    ...typeFields,
    clientValue,
    notes: notes || '',
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    status: 'Draft',
    replacesContract: replaced?._id || null,
    createdBy: req.user?._id,
    updatedBy: req.user?._id
  });
  if (replaced) {
    await SubletContract.updateOne({ _id: replaced._id }, { $addToSet: { replacedBy: contract._id } });
  }

  // Barter / Mixed contracts wait in Draft until the properties given in exchange are added
  const needsProperties = barterShortfall(contract) > 0;
  if (activate && !needsProperties) {
    contract.status = 'Active';
    contract.activatedAt = new Date();
    contract.activatedBy = req.user?._id;
    await contract.save();
    if (contractType === 'BOQ') await syncSubletToBoq(contract, req.params.id);
  }

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  res.status(201).json({
    success: true,
    message: needsProperties
      ? 'Sublet contract created as Draft — add the properties given in exchange, then activate it'
      : `${activate ? 'Sublet contract created and activated' : 'Sublet contract created'}${replaced ? ` — takes over the remaining work of ${replaced.contractNumber}` : ''}`,
    data: populated
  });
}));

// PUT update (Draft only)
router.put('/projects/:id/sublet-contracts/:scId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.scId)) return badRequest(res, 'Invalid ID');

  const contract = await SubletContract.findOne({ _id: req.params.scId, project: req.params.id });
  if (!contract) return notFound(res, 'Sublet Contract');
  if (contract.status !== 'Draft') {
    return badRequest(res, 'Only Draft sublet contracts can be edited');
  }

  const project = await ConstructionProject.findById(req.params.id).select('name parentProject projectType contractBasis paymentMode units').lean();
  const { title, contractor, items, notes, startDate, endDate } = req.body;
  const contractType = req.body.contractType === 'Slab' || req.body.contractType === 'BOQ'
    ? req.body.contractType
    : (contract.contractType || 'BOQ');
  if (project?.contractBasis && contractType !== project.contractBasis) {
    return badRequest(res, `${project.name} is ${contractBasisLabel(project.contractBasis)} — only ${contractBasisLabel(project.contractBasis)} contracts can be made here`);
  }

  if (title !== undefined) {
    if (!String(title).trim()) return badRequest(res, 'Title cannot be empty');
    contract.title = String(title).trim();
  }
  if (contractor !== undefined) {
    if (!contractor || !isValidId(contractor)) return badRequest(res, 'Subcontractor is required');
    contract.contractor = contractor;
  }
  if (notes !== undefined) contract.notes = notes || '';
  if (startDate !== undefined) contract.startDate = startDate ? new Date(startDate) : undefined;
  if (endDate !== undefined) contract.endDate = endDate ? new Date(endDate) : undefined;

  const { propertyPercent, error: payError } = resolvePropertyPercent(project, req.body.propertyPercent, contract.propertyPercent);
  if (payError) return badRequest(res, payError);
  contract.propertyPercent = propertyPercent;

  const unitsChanged = req.body.units !== undefined;
  const { units, error: unitsError } = resolveContractUnits(project, unitsChanged ? req.body.units : contract.units);
  if (unitsError) return badRequest(res, unitsError);
  contract.units = units;

  const values = slabContractValues(req.body, units, {
    contractValue: contract.totalAmount,
    clientValue: contract.clientValue,
    ratePerUnit: contract.ratePerUnit,
    clientRatePerUnit: contract.clientRatePerUnit
  });
  const typeChanged = contractType !== (contract.contractType || 'BOQ');
  try {
    if (contractType === 'Slab' && (typeChanged || unitsChanged || req.body.slabs !== undefined || req.body.contractValue !== undefined || req.body.ratePerUnit !== undefined)) {
      const built = await buildSubletSlabs(
        project,
        {
          units,
          contractValue: values.contractValue,
          slabs: req.body.slabs ?? contract.slabs.map((s) => ({
            name: s.name,
            percentage: s.percentage,
            description: s.notes,
            activities: s.activities.map((a) => a.activity)
          })),
          slabSchedule: req.body.slabSchedule !== undefined ? req.body.slabSchedule : contract.slabSchedule
        },
        contract._id
      );
      contract.slabs = built.slabs;
      contract.slabSchedule = built.slabSchedule;
      contract.totalAmount = built.totalAmount;
      contract.items = [];
    }
    if (contractType === 'Slab') {
      contract.clientValue = values.clientValue;
      contract.ratePerUnit = values.ratePerUnit;
      contract.clientRatePerUnit = values.clientRatePerUnit;
    } else if (contractType === 'BOQ' && (typeChanged || Array.isArray(items))) {
      const built = await buildSubletItems(
        req.params.id,
        project?.parentProject,
        Array.isArray(items) ? items : [],
        contract._id
      );
      if (!built.items.length) {
        return badRequest(res, 'Add at least one BOQ line with quantity to sublet');
      }
      contract.items = built.items;
      contract.totalAmount = built.totalAmount;
      contract.slabs = [];
      contract.slabSchedule = null;
    }
    if (contractType === 'BOQ') {
      contract.clientValue = 0;
      contract.ratePerUnit = 0;
      contract.clientRatePerUnit = 0;
    }
  } catch (err) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    throw err;
  }
  contract.contractType = contractType;

  const budgetError = await checkContractBudget(req.params.id, contract.totalAmount, contract._id);
  if (budgetError) return badRequest(res, budgetError);

  contract.updatedBy = req.user?._id;
  await contract.save();
  await syncProjectMetrics(req.params.id);

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  res.json({ success: true, message: 'Sublet contract updated', data: populated });
}));

// ─── Barter properties on a contract ───────────────────────────────────────────

/** Property share not yet covered by properties still on the deal (0 when covered or not barter) */
const barterShortfall = (contract) => {
  if (!(Number(contract.propertyAmount) > 0)) return 0;
  const covered = (contract.barterProperties || [])
    .filter((p) => p.status !== 'Released')
    .reduce((s, p) => s + (Number(p.agreedValue) || 0), 0);
  return Math.max(0, Math.round(Number(contract.propertyAmount) - covered));
};

const plotKey = (p) => {
  const plot = String(p.plotNumber || '').trim().toLowerCase();
  return plot ? `${String(p.sector || '').trim().toLowerCase()}|${plot}` : '';
};

/** Every property promised on a live contract: property id / sector+plot → contract number */
const reservedProperties = async (excludeContractId = null) => {
  const filter = { status: { $ne: 'Cancelled' }, 'barterProperties.0': { $exists: true } };
  if (excludeContractId) filter._id = { $ne: excludeContractId };
  const contracts = await SubletContract.find(filter).select('contractNumber barterProperties').lean();
  const byId = new Map();
  const byPlot = new Map();
  contracts.forEach((c) => (c.barterProperties || []).filter((p) => p.status !== 'Released').forEach((p) => {
    if (p.property) byId.set(String(p.property), c.contractNumber);
    const key = plotKey(p);
    if (key) byPlot.set(key, c.contractNumber);
  }));
  return { byId, byPlot };
};

const propertyLabel = (tp) => [tp.propertyType, tp.propertyName, tp.plotNumber && `Plot ${tp.plotNumber}`, tp.unit && `Unit ${tp.unit}`, tp.block && `Block ${tp.block}`, tp.sector]
  .filter(Boolean).join(' · ');

// GET /api/project-management/barter-properties/search?q= — Taj Residencia properties to give in exchange
router.get('/barter-properties/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = ['propertyName', 'plotNumber', 'sector', 'block', 'unit', 'propertyType', 'street'].map((k) => ({ [k]: rx }));
  }
  const [props, reserved] = await Promise.all([
    TajProperty.find(filter)
      .select('propertyType propertyName plotNumber sector block unit street areaValue areaUnit ownerName status')
      .sort({ sector: 1, plotNumber: 1 }).limit(25).lean(),
    reservedProperties(req.query.contract && isValidId(req.query.contract) ? req.query.contract : null)
  ]);
  res.json({
    success: true,
    data: props.map((tp) => ({
      _id: tp._id,
      label: propertyLabel(tp),
      propertyType: tp.propertyType || '',
      plotNumber: tp.plotNumber || '',
      sector: tp.sector || '',
      area: tp.areaValue ? `${tp.areaValue} ${tp.areaUnit || ''}`.trim() : '',
      ownerName: tp.ownerName || '',
      reservedBy: reserved.byId.get(String(tp._id)) || reserved.byPlot.get(plotKey(tp)) || ''
    }))
  });
}));

/**
 * PUT /api/project-management/projects/:id/sublet-contracts/:scId/barter-properties
 * body { properties: [{ _id?, property?, label, propertyType, plotNumber, sector, area, agreedValue, notes, status? }] }
 * Sets the properties given in exchange. Handed-over ones stay as they are; a property can be
 * promised on one live contract only.
 */
router.put('/projects/:id/sublet-contracts/:scId/barter-properties', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.scId)) return badRequest(res, 'Invalid ID');
  const contract = await SubletContract.findOne({ _id: req.params.scId, project: req.params.id });
  if (!contract) return notFound(res, 'Sublet Contract');
  if (['Completed', 'Cancelled'].includes(contract.status)) return badRequest(res, `A ${contract.status.toLowerCase()} contract can't be changed`);
  if (!(Number(contract.propertyPercent) > 0)) return badRequest(res, 'This contract is paid in money (cash / bank) — it has no property share');

  const incoming = Array.isArray(req.body.properties) ? req.body.properties : [];
  const handed = (contract.barterProperties || []).filter((p) => p.status === 'Handed over');
  const handedIds = new Set(handed.map((p) => String(p._id)));
  const reserved = await reservedProperties(contract._id);

  const rows = [];
  const seen = new Set();
  for (const raw of incoming) {
    if (raw._id && handedIds.has(String(raw._id))) continue; // handed over: kept unchanged below
    const agreedValue = Math.max(0, Number(raw.agreedValue) || 0);
    let row = {
      label: String(raw.label || '').trim(),
      propertyType: String(raw.propertyType || '').trim(),
      plotNumber: String(raw.plotNumber || '').trim(),
      sector: String(raw.sector || '').trim(),
      area: String(raw.area || '').trim(),
      agreedValue,
      status: raw.status === 'Released' ? 'Released' : 'Reserved',
      notes: String(raw.notes || '').trim(),
      property: null
    };
    if (raw.property) {
      if (!isValidId(raw.property)) return badRequest(res, 'Invalid property');
      const tp = await TajProperty.findById(raw.property).select('propertyType propertyName plotNumber sector block unit areaValue areaUnit').lean();
      if (!tp) return badRequest(res, 'Property not found in Taj Residencia records');
      row = {
        ...row,
        property: tp._id,
        label: row.label || propertyLabel(tp),
        propertyType: tp.propertyType || row.propertyType,
        plotNumber: tp.plotNumber || row.plotNumber,
        sector: tp.sector || row.sector,
        area: row.area || (tp.areaValue ? `${tp.areaValue} ${tp.areaUnit || ''}`.trim() : '')
      };
    }
    if (!row.label && !row.plotNumber) return badRequest(res, 'Describe each property — pick it from Taj Residencia or enter its plot / unit');
    if (!row.label) row.label = [[row.propertyType || 'Plot', row.plotNumber].filter(Boolean).join(' '), row.sector].filter(Boolean).join(' · ');
    if (row.status !== 'Released' && agreedValue <= 0) return badRequest(res, `Enter the agreed value of ${row.label}`);

    if (row.status !== 'Released') {
      const key = row.property ? `id:${row.property}` : `plot:${plotKey(row)}`;
      if (seen.has(key) && key !== 'plot:') return badRequest(res, `${row.label} is listed twice`);
      seen.add(key);
      const takenBy = (row.property && reserved.byId.get(String(row.property))) || (plotKey(row) && reserved.byPlot.get(plotKey(row)));
      if (takenBy) return badRequest(res, `${row.label} is already promised on sublet contract ${takenBy}`);
    }
    if (raw._id && isValidId(raw._id)) row._id = raw._id;
    rows.push(row);
  }

  contract.barterProperties = [...handed, ...rows];
  contract.updatedBy = req.user?._id;
  await contract.save();

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  const gap = barterShortfall(populated);
  res.json({
    success: true,
    message: gap > 0 ? `Saved — ${fmtPkr(gap)} of the property share is not covered yet` : 'Properties saved',
    data: populated
  });
}));

/**
 * Barter position per contractor on a Sub Project: property share agreed, property earned on
 * CEO-approved IPCs (and in approval), properties reserved / handed over, and cash certified / paid.
 * owedInProperty = earned − handed over — what can still be handed over.
 */
const barterBalances = async (projectId, contractorId = null) => {
  const pid = new mongoose.Types.ObjectId(String(projectId));
  // Cancelled contracts that had started still owe property for the work done on them
  const cFilter = { project: pid, $or: [{ status: { $ne: 'Cancelled' } }, { activatedAt: { $ne: null } }], propertyPercent: { $gt: 0 } };
  if (contractorId) cFilter.contractor = new mongoose.Types.ObjectId(String(contractorId));
  const contracts = (await SubletContract.find(cFilter)
    .select('contractNumber contractor title totalAmount propertyPercent propertyAmount cashAmount barterProperties status cancellation.workDone.amount')
    .populate('contractor', 'name').lean())
    .map((c) => {
      if (c.status !== 'Cancelled') return c;
      const held = Number(c.cancellation?.workDone?.amount) || 0;
      const propertyAmount = Math.round((held * (Number(c.propertyPercent) || 0)) / 100);
      return { ...c, totalAmount: held, propertyAmount, cashAmount: Math.max(0, held - propertyAmount) };
    });
  const contractorIds = [...new Set(contracts.map((c) => String(c.contractor?._id || c.contractor)))];
  const ipcs = contractorIds.length ? await ProjectInvoice.find({
    project: pid, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' },
    contractor: { $in: contractorIds.map((id) => new mongoose.Types.ObjectId(id)) }
  }).select('contractor approvalStatus propertySettlementAmount netPayableAmount paidAmount').lean() : [];

  return contractorIds.map((id) => {
    const mine = contracts.filter((c) => String(c.contractor?._id || c.contractor) === id);
    const myIpcs = ipcs.filter((i) => String(i.contractor) === id);
    const approved = myIpcs.filter((i) => i.approvalStatus === 'Approved');
    const sum = (list, f) => round2(list.reduce((t, r) => t + (Number(r[f]) || 0), 0));
    const props = mine.flatMap((c) => (c.barterProperties || []).map((p) => ({ ...p, contractNumber: c.contractNumber })));
    const byStatus = (st) => round2(props.filter((p) => p.status === st).reduce((t, p) => t + (Number(p.agreedValue) || 0), 0));
    const earned = sum(approved, 'propertySettlementAmount');
    const handedOver = byStatus('Handed over');
    const propertyShare = round2(mine.reduce((t, c) => t + (Number(c.propertyAmount) || 0), 0));
    return {
      contractor: mine[0].contractor,
      contracts: mine.map((c) => ({ _id: c._id, contractNumber: c.contractNumber, title: c.title, status: c.status, totalAmount: c.totalAmount, propertyPercent: c.propertyPercent })),
      propertyShare,
      cashShare: round2(mine.reduce((t, c) => t + (Number(c.cashAmount) || 0), 0)),
      propertyEarned: earned,
      propertyInApproval: sum(myIpcs.filter((i) => i.approvalStatus !== 'Approved'), 'propertySettlementAmount'),
      propertyToEarn: Math.max(0, round2(propertyShare - earned)),
      reserved: byStatus('Reserved'),
      handedOver,
      owedInProperty: round2(earned - handedOver),
      cashCertified: sum(approved, 'netPayableAmount'),
      cashPaid: sum(myIpcs, 'paidAmount'),
      properties: props.filter((p) => p.status !== 'Released').map((p) => ({
        _id: p._id, label: p.label, area: p.area, agreedValue: p.agreedValue, status: p.status,
        handedOverAt: p.handedOverAt, handoverReference: p.handoverReference, contractNumber: p.contractNumber
      }))
    };
  });
};

// GET /api/project-management/projects/:id/barter-balances
router.get('/projects/:id/barter-balances', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  res.json({ success: true, data: await barterBalances(req.params.id) });
}));

/**
 * POST /api/project-management/projects/:id/sublet-contracts/:scId/barter-properties/:propId/handover
 * body { date?, notes? } — hand a reserved property over to the contractor. Only up to the property
 * value they have earned on CEO-approved IPCs; posts DR Barter Payable / CR Property Sales - Barter.
 */
router.post('/projects/:id/sublet-contracts/:scId/barter-properties/:propId/handover', asyncHandler(async (req, res) => {
  if (![req.params.id, req.params.scId, req.params.propId].every(isValidId)) return badRequest(res, 'Invalid ID');
  const contract = await SubletContract.findOne({ _id: req.params.scId, project: req.params.id });
  if (!contract) return notFound(res, 'Sublet Contract');
  if (contract.status !== 'Active' && contract.status !== 'Completed') return badRequest(res, 'Properties are handed over on an Active contract');
  const property = contract.barterProperties.id(req.params.propId);
  if (!property) return notFound(res, 'Property');
  if (property.status !== 'Reserved') return badRequest(res, `${property.label} is ${property.status.toLowerCase()} — only reserved properties can be handed over`);

  const [bal] = await barterBalances(req.params.id, contract.contractor);
  const value = Number(property.agreedValue) || 0;
  if (!bal || value > bal.owedInProperty + 0.5) {
    return badRequest(res, `${property.label} is worth ${fmtPkr(value)}, but the contractor has only ${fmtPkr(Math.max(0, bal?.owedInProperty || 0))} of property value earned and not yet handed over (earned ${fmtPkr(bal?.propertyEarned || 0)} on approved IPCs, handed over ${fmtPkr(bal?.handedOver || 0)})`);
  }

  const date = req.body.date ? new Date(req.body.date) : new Date();
  const posting = await postBarterHandover({ contract, property, actorId: req.user?._id, date });
  if (posting.error) return badRequest(res, posting.error);

  property.status = 'Handed over';
  property.handedOverAt = date;
  property.handedOverBy = req.user?._id;
  property.handoverJournal = posting.journalId;
  property.handoverReference = posting.reference;
  if (req.body.notes) property.notes = String(req.body.notes).trim();
  contract.updatedBy = req.user?._id;
  await contract.save();

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  res.json({ success: true, message: `${property.label} handed over — posted to Finance as ${posting.reference}`, data: populated });
}));

// POST activate — sync BOQ contractor assignment
router.post('/projects/:id/sublet-contracts/:scId/activate', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.scId)) return badRequest(res, 'Invalid ID');

  const contract = await SubletContract.findOne({ _id: req.params.scId, project: req.params.id });
  if (!contract) return notFound(res, 'Sublet Contract');
  if (contract.status !== 'Draft') {
    return badRequest(res, 'Only Draft contracts can be activated');
  }
  const isSlab = contract.contractType === 'Slab';
  if (isSlab && !contract.slabs?.length) return badRequest(res, 'Contract has no slabs');
  if (!isSlab && !contract.items?.length) return badRequest(res, 'Contract has no items');
  const barterGap = barterShortfall(contract);
  if (barterGap > 0) {
    return badRequest(res, `Add the properties given in exchange first — they cover ${fmtPkr(contract.propertyAmount - barterGap)} of the ${fmtPkr(contract.propertyAmount)} property share`);
  }

  // Re-validate against other contracts (BOQ quantities / slab activities)
  const project = await ConstructionProject.findById(req.params.id).select('parentProject projectType').lean();
  try {
    if (isSlab) {
      await buildSubletSlabs(
        project,
        {
          contractValue: contract.totalAmount,
          units: contract.units || [],
          slabs: contract.slabs.map((s) => ({
            name: s.name,
            percentage: s.percentage,
            description: s.notes,
            activities: s.activities.map((a) => a.activity)
          })),
          slabSchedule: contract.slabSchedule
        },
        contract._id
      );
    } else {
      await buildSubletItems(
        req.params.id,
        project?.parentProject,
        contract.items.map((i) => ({
          boqItemId: i.boqItem,
          quantity: i.quantity,
          unitPrice: i.unitPrice
        })),
        contract._id
      );
    }
  } catch (err) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    throw err;
  }

  const budgetError = await checkContractBudget(req.params.id, contract.totalAmount, contract._id);
  if (budgetError) return badRequest(res, budgetError);

  contract.status = 'Active';
  contract.activatedAt = new Date();
  contract.activatedBy = req.user?._id;
  contract.updatedBy = req.user?._id;
  await contract.save();
  if (!isSlab) await syncSubletToBoq(contract, req.params.id);
  await syncProjectMetrics(req.params.id);

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  res.json({
    success: true,
    message: isSlab
      ? 'Slab-wise sublet contract activated'
      : 'Sublet contract activated — BOQ lines assigned to subcontractor',
    data: populated
  });
}));

// POST complete
router.post('/projects/:id/sublet-contracts/:scId/complete', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.scId)) return badRequest(res, 'Invalid ID');

  const contract = await SubletContract.findOne({ _id: req.params.scId, project: req.params.id });
  if (!contract) return notFound(res, 'Sublet Contract');
  if (contract.status !== 'Active') {
    return badRequest(res, 'Only Active contracts can be completed');
  }

  contract.status = 'Completed';
  contract.completedAt = new Date();
  contract.updatedBy = req.user?._id;
  await contract.save();
  await syncProjectMetrics(req.params.id);

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  res.json({ success: true, message: 'Sublet contract marked completed', data: populated });
}));

// DELETE cancel (older clients) — same rules as POST …/cancel
router.delete('/projects/:id/sublet-contracts/:scId', asyncHandler(cancelSubletContract));

// ─── SUBCONTRACTOR STATEMENT ─────────────────────────────────────────────────

// GET /api/project-management/subcontractors — everyone holding (or who held) a sublet contract
router.get('/subcontractors', asyncHandler(async (req, res) => {
  const ids = await SubletContract.distinct('contractor', { $or: [{ status: { $ne: 'Cancelled' } }, { activatedAt: { $ne: null } }] });
  const list = await Supplier.find({ _id: { $in: ids } }).select('name supplierId phone email').sort({ name: 1 }).lean();
  res.json({ success: true, data: list });
}));

// GET /api/project-management/subcontractors/:supplierId/statement — contracts, IPCs and balances across projects
router.get('/subcontractors/:supplierId/statement', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.supplierId)) return badRequest(res, 'Invalid subcontractor');
  const supplier = await Supplier.findById(req.params.supplierId).select('name supplierId phone email address contactPerson').lean();
  if (!supplier) return notFound(res, 'Subcontractor');

  const projectPopulate = { path: 'project', select: 'name projectNumber sector parentProject', populate: { path: 'parentProject', select: 'name' } };
  const [contracts, ipcs] = await Promise.all([
    // Cancelled contracts stay on the statement (marked), held at the work done on them
    SubletContract.find({ contractor: supplier._id, $or: [{ status: { $ne: 'Cancelled' } }, { activatedAt: { $ne: null } }] })
      .populate(projectPopulate)
      .populate('replacedBy', 'contractNumber status activatedAt')
      .select('contractNumber title contractType status totalAmount startDate endDate project activatedAt cancellation.cancellationDate cancellation.reason cancellation.workDone.amount replacedBy')
      .sort({ createdAt: 1 }).lean(),
    ProjectInvoice.find({ contractor: supplier._id, invoiceType: 'Subcontractor_IPC' })
      .populate(projectPopulate)
      .populate('checkRequest', 'checkRequestNumber')
      .select('invoiceNumber ipcNumber ipcKind approvalStatus status issueDate grossAmount retentionAmount advanceRecoveryAmount whtAmount netPayableAmount paidAmount financeBillNumber project checkRequest cancelledAt')
      .sort({ issueDate: 1, createdAt: 1 }).lean()
  ]);

  const projectIds = [...new Set([...contracts, ...ipcs].map((r) => String(r.project?._id || r.project)).filter(Boolean))];
  const byProject = await Promise.all(projectIds.map(async (pid) => {
    const sample = [...contracts, ...ipcs].find((r) => String(r.project?._id || r.project) === pid)?.project;
    return {
      project: { _id: pid, name: sample?.name, mainProject: sample?.parentProject?.name, sector: sample?.sector },
      ...(await subcontractorBalances(pid, supplier._id))
    };
  }));

  const live = ipcs.filter((i) => i.status !== 'Cancelled');
  const sum = (list, f) => round2(list.reduce((t, r) => t + (Number(r[f]) || 0), 0));
  const approved = live.filter((i) => i.approvalStatus === 'Approved');
  const approvedWork = approved.filter((i) => !NON_WORK_IPC_KINDS.includes(i.ipcKind));
  const totals = {
    contracted: round2(contracts.reduce((t, c) => t + (Number(c.status === 'Cancelled' ? c.cancellation?.workDone?.amount : c.totalAmount) || 0), 0)),
    certifiedWork: sum(approvedWork, 'grossAmount'),
    workInApproval: sum(live.filter((i) => i.approvalStatus !== 'Approved' && !NON_WORK_IPC_KINDS.includes(i.ipcKind)), 'grossAmount'),
    retentionHeld: sum(byProject, 'retentionAvailable'),
    advanceOutstanding: sum(byProject, 'advanceOutstanding'),
    approvedPayable: sum(approved, 'netPayableAmount'),
    paid: sum(live, 'paidAmount')
  };
  totals.balanceDue = Math.max(0, round2(totals.approvedPayable - totals.paid));

  res.json({ success: true, data: { supplier, contracts, ipcs, byProject, totals, generatedAt: new Date() } });
}));

// ─── APPROVALS INBOX (everything waiting on someone, across all projects) ───

// GET /api/project-management/approvals
router.get('/approvals', asyncHandler(async (req, res) => {
  const projectFields = 'name projectNumber parentProject';
  const withProject = (q) => q
    .populate({ path: 'project', select: projectFields, populate: { path: 'parentProject', select: 'name projectNumber' } })
    .populate('contractor', 'name')
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();

  const me = req.user?._id;
  const [myInspections, runningInspections] = await Promise.all([
    me
      ? InspectionReport.find({ status: 'Pending', inspectors: { $elemMatch: { user: me, status: 'Pending' } } })
        .select('reportNumber checkRequest project inspectionDate inspectedTotal inspectors updatedAt')
        .populate({ path: 'project', select: projectFields, populate: { path: 'parentProject', select: 'name projectNumber' } })
        .populate({ path: 'checkRequest', select: 'checkRequestNumber title contractor', populate: { path: 'contractor', select: 'name' } })
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean()
      : [],
    InspectionReport.find({ status: 'Pending' }).distinct('checkRequest')
  ]);
  const inspecting = new Set(runningInspections.map(String));

  const [contracts, toVerify, verified, ipcs] = await Promise.all([
    withProject(SubletContract.find({ status: 'Draft' }).select('contractNumber title contractType totalAmount project contractor updatedAt')),
    withProject(CheckRequest.find({ status: 'Submitted' }).select('checkRequestNumber title claimedTotal project contractor submittedAt updatedAt')),
    withProject(CheckRequest.find({ status: 'Verified' })
      .select('checkRequestNumber title status claimType slab linkedInvoice verifiedTotal items project contractor verifiedAt updatedAt')),
    // IPCs waiting on the project team: never submitted, or rejected back for revision
    withProject(ProjectInvoice.find({
      invoiceType: 'Subcontractor_IPC',
      status: { $nin: ['Cancelled', 'Paid', 'Partially Paid'] },
      $or: [{ approvalStatus: { $in: ['Draft', 'Rejected'] } }, { approvalStatus: { $exists: false } }]
    }).select('invoiceNumber ipcNumber status approvalStatus returnedFromStatus rejection netPayableAmount invoiceAmount paidAmount dueDate project contractor updatedAt'))
  ]);

  const readyForIpc = verified
    .map(({ items, ...cr }) => ({ ...cr, billableAmount: checkRequestBillable({ ...cr, items }) }))
    .filter((cr) => cr.billableAmount > 0);

  res.json({
    success: true,
    data: {
      contractsToActivate: contracts,
      inspectionsToSign: myInspections.map((r) => ({
        ...r,
        contractor: r.checkRequest?.contractor,
        signed: (r.inspectors || []).filter((i) => i.status === 'Approved').length,
        total: (r.inspectors || []).length
      })),
      checkRequestsToVerify: toVerify.filter((cr) => !inspecting.has(String(cr._id))),
      checkRequestsReadyForIpc: readyForIpc,
      ipcsToSubmit: ipcs
    }
  });
}));

module.exports = router;
