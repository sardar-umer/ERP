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
const User = require('../models/User');
const NotificationService = require('../services/notificationService');
const WbsActivity = require('../models/projectManagement/WbsActivity');
const { WBS_PROJECT_TYPES, normalizeProjectType } = require('../models/projectManagement/WbsActivity');
const SlabSchedule = require('../models/projectManagement/SlabSchedule');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const Supplier = require('../models/hr/Supplier');
const { syncProjectMetrics } = require('../services/projectMetricsService');
const { postIpcToFinance, resolveProjectCompanyId, findMainProject } = require('../utils/projectIpcFinance');
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

/** Build Main ↔ Sub monetary allocation summary */
const buildBudgetAllocationSummary = async (mainProject) => {
  const lumpSumBudget = Number(mainProject.lumpSumBudget) || 0;
  const subs = await ConstructionProject.find({
    parentProject: mainProject._id,
    status: { $ne: 'Cancelled' }
  })
    .select('name projectNumber sector projectType allocatedBudget totalEstimatedCost totalApprovedBudget budgetStatus status')
    .sort({ name: 1 })
    .lean();

  const totalAllocated = subs.reduce((s, c) => s + (Number(c.allocatedBudget) || 0), 0);
  const remaining = Math.max(0, lumpSumBudget - totalAllocated);

  return {
    lumpSumBudget,
    totalAllocated,
    remaining,
    budgetStatus: mainProject.budgetStatus,
    subProjects: subs.map((s) => ({
      _id: s._id,
      name: s.name,
      projectNumber: s.projectNumber,
      sector: s.sector,
      projectType: s.projectType,
      allocatedBudget: Number(s.allocatedBudget) || 0,
      totalEstimatedCost: Number(s.totalEstimatedCost) || 0,
      totalApprovedBudget: Number(s.totalApprovedBudget) || 0,
      budgetStatus: s.budgetStatus,
      status: s.status
    }))
  };
};

// ─── PROJECTS ────────────────────────────────────────────────────────────────

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

// ─── COST REPORT (budget vs actual) ──────────────────────────────────────────

/**
 * Budget vs actual for one Sub Project.
 * BOQ lines: budget (scope qty × estimate rate) → contracted (BOQ-wise sublet) → verified (check requests)
 * → billed (Work IPCs) → approved (CEO). Slab-wise contracts are reported per slab.
 */
const buildSubCostReport = async (projectId) => {
  const pid = new mongoose.Types.ObjectId(String(projectId));
  const { projectFilter } = buildBoqFilter(projectId, { isSubProject: true });
  const [boqItems, contracts, crs, ipcs] = await Promise.all([
    BOQItem.find(projectFilter).select('title description unit cbsCategory estimatedQuantity estimatedUnitPrice discountAmount netEstimatedCost project allocations').lean(),
    SubletContract.find({ project: pid, status: { $in: ['Active', 'Completed'] } })
      .populate('contractor', 'name').select('contractNumber contractType status totalAmount items slabs contractor').lean(),
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
    names.add(c.contractor?.name); contractorsByLine.set(String(i.boqItem), names);
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
    .select('name projectNumber status parentProject lumpSumBudget overallProgress').lean();
  if (!project) return notFound(res, 'Project');
  const isMain = !project.parentProject;

  const units = isMain
    ? await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } })
      .select('name projectNumber sector status overallProgress').sort({ name: 1 }).lean()
    : [project];
  const reports = await Promise.all(units.map((u) => buildSubCostReport(u._id)));

  const subProjects = units.map((u, i) => {
    const { budget, contracted, billed, approved, paid } = reports[i].summary;
    const progress = Number(u.overallProgress) || 0;
    let health = 'On Track';
    if (budget > 0 && billed > budget) health = 'Over Budget';
    else if (u.status === 'Active' && progress < 20) health = 'Needs Attention';
    return {
      _id: u._id, name: u.name, projectNumber: u.projectNumber, sector: u.sector, status: u.status,
      budget, contracted, spent: billed, approved, paid, progress, variance: round2(billed - budget), health
    };
  });

  const sum = (f) => round2(subProjects.reduce((t, s) => t + (Number(s[f]) || 0), 0));
  const budget = sum('budget');
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
        contracted: sum('contracted'),
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
 * Main Project tree: Sub Projects → Sublet Contracts → Check Requests → IPCs.
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

  const [contracts, crs, ipcs] = await Promise.all([
    SubletContract.find({ project: { $in: subIds }, status: { $ne: 'Cancelled' } })
      .populate('contractor', 'name')
      .select('project contractNumber title contractor contractType status totalAmount slabs createdAt')
      .sort({ createdAt: 1 }).lean(),
    CheckRequest.find({ project: { $in: subIds }, status: { $ne: 'Cancelled' } })
      .populate('contractor', 'name')
      .select('project checkRequestNumber title contractor claimType subletContract slab status claimedTotal verifiedTotal createdAt')
      .sort({ createdAt: 1 }).lean(),
    ProjectInvoice.find({ project: { $in: subIds }, invoiceType: 'Subcontractor_IPC', status: { $ne: 'Cancelled' } })
      .select('project invoiceNumber ipcNumber ipcKind checkRequest subletContract grossAmount netPayableAmount paidAmount approvalStatus status issueDate')
      .sort({ issueDate: 1 }).lean()
  ]);

  const ipcView = (i) => ({
    _id: i._id, invoiceNumber: i.invoiceNumber, ipcNumber: i.ipcNumber, ipcKind: i.ipcKind,
    grossAmount: round2(i.grossAmount), netPayableAmount: round2(i.netPayableAmount), paidAmount: round2(i.paidAmount),
    approvalStatus: i.approvalStatus, status: i.status, issueDate: i.issueDate
  });
  const ipcsByCr = new Map();
  ipcs.filter((i) => i.checkRequest).forEach((i) => {
    const key = String(i.checkRequest);
    ipcsByCr.set(key, [...(ipcsByCr.get(key) || []), ipcView(i)]);
  });
  const crView = (c) => ({
    _id: c._id, checkRequestNumber: c.checkRequestNumber, title: c.title, contractor: c.contractor?.name || '',
    claimType: c.claimType, status: c.status, claimedTotal: round2(c.claimedTotal), verifiedTotal: round2(c.verifiedTotal),
    slabName: c.slab?.name || '', ipcs: ipcsByCr.get(String(c._id)) || []
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
    .populate('budgetApprovedBy', 'firstName lastName')
    .populate('createdBy', 'firstName lastName')
    .populate('parentProject', 'name projectNumber isMasterProject projectType status lumpSumBudget society sector')
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
router.put('/projects/:id/lump-sum-budget', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id);
  if (!project) return notFound(res, 'Project');
  if (project.parentProject) {
    return badRequest(res, 'Lump-sum budget can only be set on a Main Project');
  }

  const amount = Math.max(0, Number(req.body.lumpSumBudget) || 0);
  const summary = await buildBudgetAllocationSummary(project);
  if (amount < summary.totalAllocated) {
    return badRequest(
      res,
      `Lump-sum budget (${amount}) cannot be less than already allocated to sub projects (${summary.totalAllocated})`
    );
  }

  project.lumpSumBudget = amount;
  project.updatedBy = req.user?._id;
  // Changing the envelope returns budget to Draft so it can be re-submitted
  if (project.budgetStatus === 'Approved' || project.budgetStatus === 'Submitted') {
    project.budgetStatus = 'Draft';
    project.budgetApprovedBy = null;
    project.budgetApprovedAt = null;
  }
  await project.save();

  const populated = await ConstructionProject.findById(project._id)
    .populate('projectManager', 'firstName lastName email')
    .lean();
  populated.budgetAllocation = await buildBudgetAllocationSummary(populated);

  res.json({ success: true, message: 'Lump-sum budget updated', data: populated });
}));

// PUT /api/project-management/projects/:id/budget-allocations — allocate Main pool to Subs
router.put('/projects/:id/budget-allocations', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const main = await ConstructionProject.findById(req.params.id);
  if (!main) return notFound(res, 'Project');
  if (main.parentProject) {
    return badRequest(res, 'Budget allocation can only be done from a Main Project');
  }

  const lump = Number(main.lumpSumBudget) || 0;
  if (lump <= 0) {
    return badRequest(res, 'Set a lump-sum budget on the Main Project first');
  }

  let allocations = req.body.allocations;
  // Allow single-item shorthand
  if (!Array.isArray(allocations) && req.body.subProjectId !== undefined) {
    allocations = [{ subProjectId: req.body.subProjectId, amount: req.body.amount }];
  }
  if (!Array.isArray(allocations) || !allocations.length) {
    return badRequest(res, 'Provide allocations: [{ subProjectId, amount }]');
  }

  const subs = await ConstructionProject.find({
    parentProject: main._id,
    status: { $ne: 'Cancelled' }
  });
  const byId = new Map(subs.map((s) => [String(s._id), s]));

  // Start from current allocations, then apply updates
  const nextAmounts = new Map(subs.map((s) => [String(s._id), Number(s.allocatedBudget) || 0]));

  for (const row of allocations) {
    const sid = String(row.subProjectId || '');
    if (!byId.has(sid)) {
      return badRequest(res, `Sub project not found under this Main: ${row.subProjectId}`);
    }
    const amount = Math.max(0, Number(row.amount) || 0);
    const sub = byId.get(sid);
    const catEst = (sub.budgetCategories || []).reduce((s, c) => s + (c.estimatedAmount || 0), 0);
    if (amount > 0 && catEst > amount) {
      return badRequest(
        res,
        `${sub.name}: allocated amount (${amount}) cannot be less than category estimates (${catEst})`
      );
    }
    nextAmounts.set(sid, amount);
  }

  const totalAllocated = [...nextAmounts.values()].reduce((s, v) => s + v, 0);
  if (totalAllocated > lump) {
    return badRequest(
      res,
      `Total allocation (${totalAllocated}) exceeds Main lump-sum budget (${lump}). Remaining would be negative.`
    );
  }

  for (const [sid, amount] of nextAmounts.entries()) {
    const sub = byId.get(sid);
    if ((Number(sub.allocatedBudget) || 0) === amount) continue;
    sub.allocatedBudget = amount;
    sub.updatedBy = req.user?._id;
    // If no category breakdown yet, keep totals aligned with allocation
    const catEst = (sub.budgetCategories || []).reduce((s, c) => s + (c.estimatedAmount || 0), 0);
    if (catEst === 0) {
      // leave budgetStatus as-is; pre-save will set totalEstimatedCost from allocatedBudget
    }
    await sub.save();
  }

  const populated = await ConstructionProject.findById(main._id)
    .populate('projectManager', 'firstName lastName email')
    .lean();
  populated.budgetAllocation = await buildBudgetAllocationSummary(populated);

  res.json({ success: true, message: 'Budget allocated to sub projects', data: populated });
}));


// POST /api/project-management/projects — create
router.post('/projects', asyncHandler(async (req, res) => {
  const { name, projectType, description, society, sector, street, side, plotNumber, address,
    clientName, clientContact, projectManager, startDate, expectedEndDate,
    budgetCategories, notes, tags, isMasterProject, parentProject, contractValue, linkedProperty, companyId } = req.body;

  if (!name || !name.trim()) return badRequest(res, 'Project name is required');
  // The Main Project carries the Finance company; Sub Projects, contracts and IPCs inherit it
  if (!parentProject && !(companyId && isValidId(companyId))) {
    return badRequest(res, 'Select the Finance Company for this Main Project — its Sub Projects, contracts and IPCs post to that company');
  }

  const project = new ConstructionProject({
    name: name.trim(),
    projectType, description, society, sector, plotNumber, address,
    street: street || '',
    side: ['Left', 'Right'].includes(side) ? side : '',
    clientName, clientContact, notes, tags,
    companyId: !parentProject && companyId && isValidId(companyId) ? companyId : null,
    projectManager: projectManager || null,
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
    'parentProject', 'contractValue', 'companyId'
  ];

  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (updates.companyId !== undefined) updates.companyId = updates.companyId && isValidId(updates.companyId) ? updates.companyId : null;
  updates.updatedBy = req.user?._id;

  // Convert empty string refs to null to avoid CastError
  ['parentProject', 'linkedProperty', 'projectManager'].forEach(k => {
    if (updates[k] === '') {
      updates[k] = null;
    }
  });

  const oldProject = await ConstructionProject.findById(req.params.id)
    .select('name parentProject overallProgress allocatedBudget companyId')
    .lean();
  if (!oldProject) return notFound(res, 'Project');

  // Main Project must keep a Finance company; once its IPCs / invoices posted to Finance it cannot move company
  const willBeMain = !(updates.parentProject !== undefined ? updates.parentProject : oldProject.parentProject);
  const nextCompany = updates.companyId !== undefined ? updates.companyId : oldProject.companyId;
  if (willBeMain && !nextCompany) {
    return badRequest(res, 'Select the Finance Company for this Main Project — its Sub Projects, contracts and IPCs post to that company');
  }
  if (!willBeMain) delete updates.companyId; // Sub Projects inherit from their Main Project
  if (willBeMain && oldProject.companyId && nextCompany && String(oldProject.companyId) !== String(nextCompany)) {
    const familyIds = [oldProject._id];
    for (let frontier = [oldProject._id], depth = 0; frontier.length && depth < 10; depth += 1) {
      const children = await ConstructionProject.find({ parentProject: { $in: frontier } }).select('_id').lean();
      frontier = children.map((c) => c._id);
      familyIds.push(...frontier);
    }
    const posted = await ProjectInvoice.countDocuments({
      project: { $in: familyIds },
      $or: [{ financeApBillId: { $ne: null } }, { financeArId: { $ne: null } }]
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

  const project = await ConstructionProject.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  ).populate('projectManager', 'firstName lastName email').lean();

  if (!project) return notFound(res, 'Project');

  // Trigger sync of parent project progress
  if (project.parentProject) {
    await syncParentProjectProgress(project.parentProject);
  }
  if (oldProject && oldProject.parentProject && String(oldProject.parentProject) !== String(project.parentProject)) {
    await syncParentProjectProgress(oldProject.parentProject);
    await syncProjectMetrics(oldProject.parentProject);
  }
  await syncProjectMetrics(project._id);

  res.json({ success: true, message: 'Project updated successfully', data: project });
}));

// PUT /api/project-management/projects/:id/budget-status — submit or approve budget
router.put('/projects/:id/budget-status', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const { action, notes } = req.body; // action: 'submit' | 'approve' | 'reset'

  const project = await ConstructionProject.findById(req.params.id);
  if (!project) return notFound(res, 'Project');

  project.updatedBy = req.user?._id;

  const isMain = !project.parentProject;

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

  const populated = await ConstructionProject.findById(project._id)
    .populate('projectManager', 'firstName lastName email')
    .populate('parentProject', 'name projectNumber isMasterProject projectType status lumpSumBudget')
    .lean();

  if (!populated.parentProject) {
    populated.budgetAllocation = await buildBudgetAllocationSummary(populated);
  }

  res.json({ success: true, message: `Budget ${action}d successfully`, data: populated });
}));

// PUT /api/project-management/projects/:id/milestones/:milestoneId — update milestone
router.put('/projects/:id/milestones/:milestoneId', asyncHandler(async (req, res) => {
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
  }).populate('contractor', 'name').populate('subletContract', 'contractNumber clientValue totalAmount')
    .select('checkRequestNumber contractor slab verifiedTotal subletContract').lean();
  const slabLines = slabCrs.map((cr) => ({
    kind: 'slab',
    checkRequest: String(cr._id),
    checkRequestNumber: cr.checkRequestNumber,
    contractor: cr.contractor?.name,
    crItem: `slab:${cr._id}`,
    title: `Slab: ${cr.slab?.name} (${cr.slab?.percentage}%)${cr.subletContract?.contractNumber ? ` — ${cr.subletContract.contractNumber}` : ''}`,
    unit: 'stage',
    remaining: 1,
    costAmount: round2(cr.verifiedTotal),
    suggestedClientAmount: cr.subletContract?.clientValue
      ? round2((Number(cr.subletContract.clientValue) * (Number(cr.slab?.percentage) || 0)) / 100)
      : 0
  }));

  const crs = await CheckRequest.find({ project: projectId, claimType: { $ne: 'Slab' }, status: { $in: ['Verified', 'Billed'] } })
    .populate('contractor', 'name').select('checkRequestNumber title contractor items verifiedAt').sort({ verifiedAt: 1 }).lean();
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
      title: i.title || boq?.title || boq?.description,
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

  const netPayableAmount = Math.max(0, Math.round((finalGross - retentionAmount - advRec - whtAmount) * 100) / 100);
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
        ? ` — Slab: ${linkedCheckRequest.slab?.name} (${linkedCheckRequest.slab?.percentage}%)`
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
const createNonWorkIpc = async (req, { kind, contractor, amount, subletContract = null, recoveryPercent = 0 }) => {
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
    netPayableAmount: amount,
    invoiceAmount: amount,
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
    : (await SubletContract.distinct('contractor', { project: req.params.id, status: { $ne: 'Cancelled' } })).map(String);
  const suppliers = await Supplier.find({ _id: { $in: contractorIds } }).select('name').lean();
  const nameById = new Map(suppliers.map((sp) => [String(sp._id), sp.name]));
  const contracts = await SubletContract.find({ project: req.params.id, contractor: { $in: contractorIds }, status: 'Active' })
    .select('contractNumber title contractType totalAmount contractor').lean();
  const data = await Promise.all(contractorIds.map(async (cid) => ({
    contractor: { _id: cid, name: nameById.get(String(cid)) || '—' },
    activeContracts: contracts.filter((c) => String(c.contractor) === String(cid)),
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
  const inv = await createNonWorkIpc(req, { kind: 'Retention Release', contractor: req.body.contractor, amount });
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
  if (ded.error) {
    await CheckRequest.updateOne({ _id: cr._id }, { $set: { items: snapshot.items, status: snapshot.status, linkedInvoice: snapshot.linkedInvoice } });
    await applyBoqCounters(inv.items, 1);
    return badRequest(res, ded.error);
  }

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
 * A slab can be claimed by only one live check request (cancelled ones free it up).
 */
const resolveSlabClaim = async (projectId, contractorId, rawContractId, rawSlabId, excludeCrId = null) => {
  if (!rawContractId || !isValidId(rawContractId)) return { error: 'Select the slab-wise contract' };
  if (!rawSlabId || !isValidId(rawSlabId)) return { error: 'Select the slab (stage) being claimed' };

  const contract = await SubletContract.findOne({
    _id: rawContractId, project: projectId, contractor: contractorId, contractType: 'Slab'
  }).lean();
  if (!contract) return { error: "Slab-wise contract not found for this subcontractor on this Sub Project" };
  if (contract.status !== 'Active') return { error: 'Only stages of an Active contract can be claimed' };

  const slab = (contract.slabs || []).find((sl) => String(sl._id) === String(rawSlabId));
  if (!slab) return { error: 'That slab is not part of the selected contract' };

  const duplicate = await CheckRequest.findOne({
    subletContract: contract._id,
    'slab.slabId': slab._id,
    status: { $ne: 'Cancelled' },
    ...(excludeCrId ? { _id: { $ne: excludeCrId } } : {})
  }).select('checkRequestNumber').lean();
  if (duplicate) return { error: `Slab "${slab.name}" is already claimed in ${duplicate.checkRequestNumber}` };

  const amount = Number(slab.amount) || Math.round(((Number(contract.totalAmount) || 0) * (Number(slab.percentage) || 0)) / 100);
  return {
    contract,
    slab: {
      slabId: slab._id,
      name: slab.name,
      percentage: Number(slab.percentage) || 0,
      amount,
      activities: (slab.activities || []).map((a) => ({ activity: a.activity, name: a.name }))
    }
  };
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
    status: 'Draft',
    createdBy: req.user?._id,
    updatedBy: req.user?._id
  };

  let cr;
  if (claimType === 'Slab') {
    const claim = await resolveSlabClaim(req.params.id, contractorId, req.body.subletContract, req.body.slabId);
    if (claim.error) return badRequest(res, claim.error);
    cr = await CheckRequest.create({
      ...base,
      subletContract: claim.contract._id,
      slab: claim.slab,
      activity: null,
      items: [],
      claimedTotal: claim.slab.amount
    });
  } else {
    const { activityId, error: activityError } = await resolveCheckRequestActivity(project, req.body.activity);
    if (activityError) return badRequest(res, activityError);

    const { items: builtItems, claimedTotal } = await buildCheckRequestItems(req.params.id, project.parentProject, items);
    if (!builtItems.length) {
      return badRequest(res, 'Add at least one BOQ line with claimed quantity');
    }
    cr = await CheckRequest.create({ ...base, activity: activityId, items: builtItems, claimedTotal });
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

  const project = await ConstructionProject.findById(req.params.id).select('parentProject projectType').lean();
  const { title, contractor, task, items, notes } = req.body;
  const claimType = req.body.claimType
    ? (req.body.claimType === 'Slab' ? 'Slab' : 'BOQ')
    : (cr.claimType || 'BOQ');

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
      cr._id
    );
    if (claim.error) return badRequest(res, claim.error);
    cr.claimType = 'Slab';
    cr.subletContract = claim.contract._id;
    cr.slab = claim.slab;
    cr.activity = null;
    cr.items = [];
    cr.claimedTotal = claim.slab.amount;
    cr.verifiedTotal = 0;
  } else {
    if (cr.claimType === 'Slab' && !Array.isArray(items)) {
      return badRequest(res, 'Add the BOQ lines being claimed');
    }
    cr.claimType = 'BOQ';
    cr.subletContract = null;
    cr.slab = undefined;
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
    .populate('activatedBy', 'firstName lastName');

const getAlreadySublettedQty = async (projectId, boqItemId, excludeContractId = null) => {
  const match = {
    project: new mongoose.Types.ObjectId(projectId),
    status: { $in: ['Draft', 'Active', 'Completed'] }
  };
  if (excludeContractId) {
    match._id = { $ne: new mongoose.Types.ObjectId(excludeContractId) };
  }
  const rows = await SubletContract.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $match: { 'items.boqItem': new mongoose.Types.ObjectId(boqItemId) } },
    { $group: { _id: null, qty: { $sum: '$items.quantity' } } }
  ]);
  return Number(rows[0]?.qty) || 0;
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
 * Slab-wise contract stages: % of contract value, each covering master WBS activities of the
 * sub project's type. An activity can sit in only one open slab-wise contract per sub project.
 */
const buildSubletSlabs = async (project, { contractValue, slabs: rawSlabs, slabSchedule }, excludeContractId = null) => {
  const fail = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  };

  const projectType = normalizeProjectType(project.projectType);
  if (!projectType) fail('Set the Sub Project\'s Project Type (Infra / Commercial / Villas) before creating a slab-wise contract');

  const value = Number(contractValue) || 0;
  if (value <= 0) fail('Enter the contract value for a slab-wise contract');

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
    const clash = await SubletContract.findOne(clashFilter).select('contractNumber slabs.activities').lean();
    if (clash) {
      const taken = new Set(clash.slabs.flatMap((s) => s.activities.map((a) => String(a.activity))));
      const names = activityIds.filter((id) => taken.has(id)).map((id) => masterById.get(id)?.name).filter(Boolean);
      fail(`Already covered by sublet contract ${clash.contractNumber}: ${names.join(', ')}`);
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
  const clientValue = contractType === 'Slab' ? Math.max(0, Number(req.body.clientValue) || 0) : 0;
  if (!title || !String(title).trim()) return badRequest(res, 'Title is required');
  if (!contractor || !isValidId(contractor)) return badRequest(res, 'Subcontractor is required');

  let typeFields;
  try {
    if (contractType === 'Slab') {
      const built = await buildSubletSlabs(project, req.body);
      typeFields = { items: [], slabs: built.slabs, slabSchedule: built.slabSchedule, totalAmount: built.totalAmount };
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
    ...typeFields,
    clientValue,
    notes: notes || '',
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    status: 'Draft',
    createdBy: req.user?._id,
    updatedBy: req.user?._id
  });

  if (activate) {
    contract.status = 'Active';
    contract.activatedAt = new Date();
    contract.activatedBy = req.user?._id;
    await contract.save();
    if (contractType === 'BOQ') await syncSubletToBoq(contract, req.params.id);
  }

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  res.status(201).json({
    success: true,
    message: activate ? 'Sublet contract created and activated' : 'Sublet contract created',
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

  const project = await ConstructionProject.findById(req.params.id).select('parentProject projectType').lean();
  const { title, contractor, items, notes, startDate, endDate } = req.body;
  const contractType = req.body.contractType === 'Slab' || req.body.contractType === 'BOQ'
    ? req.body.contractType
    : (contract.contractType || 'BOQ');

  if (title !== undefined) {
    if (!String(title).trim()) return badRequest(res, 'Title cannot be empty');
    contract.title = String(title).trim();
  }
  if (contractor !== undefined) {
    if (!contractor || !isValidId(contractor)) return badRequest(res, 'Subcontractor is required');
    contract.contractor = contractor;
  }
  if (notes !== undefined) contract.notes = notes || '';
  if (req.body.clientValue !== undefined) contract.clientValue = Math.max(0, Number(req.body.clientValue) || 0);
  if (startDate !== undefined) contract.startDate = startDate ? new Date(startDate) : undefined;
  if (endDate !== undefined) contract.endDate = endDate ? new Date(endDate) : undefined;

  const typeChanged = contractType !== (contract.contractType || 'BOQ');
  try {
    if (contractType === 'Slab' && (typeChanged || req.body.slabs !== undefined || req.body.contractValue !== undefined)) {
      const built = await buildSubletSlabs(
        project,
        {
          contractValue: req.body.contractValue ?? contract.totalAmount,
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
  } catch (err) {
    if (err.statusCode === 400) return badRequest(res, err.message);
    throw err;
  }
  contract.contractType = contractType;

  contract.updatedBy = req.user?._id;
  await contract.save();
  await syncProjectMetrics(req.params.id);

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  res.json({ success: true, message: 'Sublet contract updated', data: populated });
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

  // Re-validate against other contracts (BOQ quantities / slab activities)
  const project = await ConstructionProject.findById(req.params.id).select('parentProject projectType').lean();
  try {
    if (isSlab) {
      await buildSubletSlabs(
        project,
        {
          contractValue: contract.totalAmount,
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
  contract.updatedBy = req.user?._id;
  await contract.save();
  await syncProjectMetrics(req.params.id);

  const populated = await populateSublet(SubletContract.findById(contract._id)).lean();
  res.json({ success: true, message: 'Sublet contract marked completed', data: populated });
}));

// DELETE cancel
router.delete('/projects/:id/sublet-contracts/:scId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.scId)) return badRequest(res, 'Invalid ID');

  const contract = await SubletContract.findOne({ _id: req.params.scId, project: req.params.id });
  if (!contract) return notFound(res, 'Sublet Contract');
  if (contract.status === 'Completed') {
    return badRequest(res, 'Completed contracts cannot be cancelled');
  }

  contract.status = 'Cancelled';
  contract.updatedBy = req.user?._id;
  await contract.save();
  await syncProjectMetrics(req.params.id);

  res.json({ success: true, message: 'Sublet contract cancelled' });
}));

// ─── SUBCONTRACTOR STATEMENT ─────────────────────────────────────────────────

// GET /api/project-management/subcontractors — everyone holding (or who held) a sublet contract
router.get('/subcontractors', asyncHandler(async (req, res) => {
  const ids = await SubletContract.distinct('contractor', { status: { $ne: 'Cancelled' } });
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
    SubletContract.find({ contractor: supplier._id, status: { $ne: 'Cancelled' } })
      .populate(projectPopulate)
      .select('contractNumber title contractType status totalAmount startDate endDate project activatedAt')
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
    contracted: sum(contracts, 'totalAmount'),
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
