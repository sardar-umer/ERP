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
const WbsActivity = require('../models/projectManagement/WbsActivity');
const { WBS_PROJECT_TYPES, normalizeProjectType } = require('../models/projectManagement/WbsActivity');
const SlabSchedule = require('../models/projectManagement/SlabSchedule');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const Supplier = require('../models/hr/Supplier');

const router = express.Router();

// ─── File upload setup ────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../uploads/project-management');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Helpers ─────────────────────────────────────────────────────────────────
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const notFound = (res, entity = 'Record') =>
  res.status(404).json({ success: false, message: `${entity} not found` });

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

// Recalculate project.totalActualSpent from expense records
const syncProjectActuals = async (projectId) => {
  const [{ total } = { total: 0 }] = await ProjectExpense.aggregate([
    { $match: { project: new mongoose.Types.ObjectId(projectId), paymentStatus: { $ne: 'Cancelled' } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  await ConstructionProject.findByIdAndUpdate(projectId, { totalActualSpent: total });
};

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

// Recalculate project.overallProgress from WBS activity average
const syncProjectProgress = async (projectId) => {
  const tasks = await ProjectTask.find({ project: projectId, level: { $gt: 0 }, activity: { $ne: null } }).select('progressPercent');
  if (!tasks.length) return;
  const avg = Math.round(tasks.reduce((s, t) => s + (t.progressPercent || 0), 0) / tasks.length);
  const project = await ConstructionProject.findByIdAndUpdate(projectId, { overallProgress: avg }, { new: true });
  if (project && project.parentProject) {
    await syncParentProjectProgress(project.parentProject);
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
          totalSpent: { $sum: { $ifNull: ['$totalActualSpent', 0] } }
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

// GET /api/project-management/projects/:id/rollup — Senior Management Upper-Level Consolidated Rollup
router.get('/projects/:id/rollup', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const ProjectRollupService = require('../services/projectRollupService');
  const summary = await ProjectRollupService.getProjectRollupSummary(req.params.id);
  res.json({
    success: true,
    data: summary
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
    budgetCategories, notes, tags, isMasterProject, parentProject, contractValue, linkedProperty } = req.body;

  if (!name || !name.trim()) return badRequest(res, 'Project name is required');

  const project = new ConstructionProject({
    name: name.trim(),
    projectType, description, society, sector, plotNumber, address,
    street: street || '',
    side: ['Left', 'Right'].includes(side) ? side : '',
    clientName, clientContact, notes, tags,
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
    'parentProject', 'contractValue'
  ];

  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  updates.updatedBy = req.user?._id;

  // Convert empty string refs to null to avoid CastError
  ['parentProject', 'linkedProperty', 'projectManager'].forEach(k => {
    if (updates[k] === '') {
      updates[k] = null;
    }
  });

  const oldProject = await ConstructionProject.findById(req.params.id)
    .select('parentProject overallProgress allocatedBudget')
    .lean();
  if (!oldProject) return notFound(res, 'Project');

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
  }

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
  ['invoices', ProjectInvoice],
  ['expenses', ProjectExpense],
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
  const { itemId, subProjectId, contractorId, allocatedQuantity, contractorUnitPrice, notes } = req.body;
  if (!itemId || !isValidId(itemId)) return badRequest(res, 'Valid itemId is required');

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

  item.allocations.push({
    subProject: subProjectId || null,
    contractor: contractorId || null,
    allocatedQuantity: allocQty,
    contractorUnitPrice: Number(contractorUnitPrice) || item.contractorUnitPrice || item.estimatedUnitPrice || 0,
    notes: notes || ''
  });

  if (contractorId) item.contractor = contractorId;
  if (subProjectId) item.subProject = subProjectId;
  if (contractorUnitPrice) item.contractorUnitPrice = Number(contractorUnitPrice);

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

// PUT /api/project-management/projects/:id/boq/batch-assign-contractor
router.put('/projects/:id/boq/batch-assign-contractor', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const { itemIds, contractorId, subProjectId, contractorUnitPrice } = req.body;
  if (!Array.isArray(itemIds) || !itemIds.length) return badRequest(res, 'itemIds array is required');

  const update = {};
  if (contractorId) update.contractor = contractorId;
  if (subProjectId) update.subProject = subProjectId;
  if (contractorUnitPrice != null && contractorUnitPrice !== '') {
    update.contractorUnitPrice = Number(contractorUnitPrice);
  }

  await BOQItem.updateMany(
    { _id: { $in: itemIds }, project: req.params.id },
    { $set: update }
  );

  res.json({ success: true, message: `${itemIds.length} BOQ items assigned successfully` });
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

  // Sync project progress when a task's progress changes
  if (updates.progressPercent !== undefined) {
    await syncProjectProgress(req.params.id);
  }

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

// ─── EXPENSES ────────────────────────────────────────────────────────────────

// GET /api/project-management/projects/:id/expenses
router.get('/projects/:id/expenses', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const { category, paymentStatus, page = 1, limit = 50 } = req.query;
  const filter = { project: req.params.id };
  if (category) filter.category = category;
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  const skip = (Number(page) - 1) * Number(limit);
  const [expenses, total] = await Promise.all([
    ProjectExpense.find(filter)
      .populate('approvedBy', 'firstName lastName')
      .sort({ expenseDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    ProjectExpense.countDocuments(filter)
  ]);

  // Category-wise summary
  const summary = await ProjectExpense.aggregate([
    { $match: { project: new mongoose.Types.ObjectId(req.params.id), paymentStatus: { $ne: 'Cancelled' } } },
    { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } }
  ]);

  res.json({
    success: true,
    data: {
      expenses,
      summary,
      pagination: { total, page: Number(page), limit: Number(limit) }
    }
  });
}));

// POST /api/project-management/projects/:id/expenses — add expense
router.post('/projects/:id/expenses', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const { category, description, amount, expenseDate, vendor, invoiceNumber,
    paymentStatus, paymentMethod, paymentDate, task, checkRequest, notes } = req.body;

  if (!description) return badRequest(res, 'Description is required');
  if (!category) return badRequest(res, 'Category is required');
  if (!amount || Number(amount) <= 0) return badRequest(res, 'Valid amount is required');

  let checkRequestId = null;
  if (checkRequest) {
    if (!isValidId(checkRequest)) return badRequest(res, 'Invalid check request ID');
    const cr = await CheckRequest.findOne({ _id: checkRequest, project: req.params.id });
    if (!cr) return badRequest(res, 'Check request not found on this project');
    if (!['Verified', 'Billed'].includes(cr.status)) {
      return badRequest(res, 'Expense can only be linked to a Verified (or billed) Check Request');
    }
    checkRequestId = cr._id;
  }

  const expense = await ProjectExpense.create({
    project: req.params.id,
    category, description,
    amount: Number(amount),
    expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
    vendor, invoiceNumber,
    paymentStatus: paymentStatus || 'Pending',
    paymentMethod: paymentMethod || 'Bank Transfer',
    paymentDate: paymentDate ? new Date(paymentDate) : undefined,
    task: task || null,
    checkRequest: checkRequestId,
    notes,
    createdBy: req.user?._id
  });

  await syncProjectActuals(req.params.id);
  res.status(201).json({ success: true, message: 'Expense recorded', data: expense });
}));

// PUT /api/project-management/projects/:id/expenses/:expenseId
router.put('/projects/:id/expenses/:expenseId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.expenseId)) return badRequest(res, 'Invalid ID');

  const allowed = ['category', 'description', 'amount', 'expenseDate', 'vendor',
    'invoiceNumber', 'paymentStatus', 'paymentMethod', 'paymentDate', 'notes'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const expense = await ProjectExpense.findOneAndUpdate(
    { _id: req.params.expenseId, project: req.params.id },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!expense) return notFound(res, 'Expense');

  await syncProjectActuals(req.params.id);
  res.json({ success: true, message: 'Expense updated', data: expense });
}));

// DELETE /api/project-management/projects/:id/expenses/:expenseId
router.delete('/projects/:id/expenses/:expenseId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.expenseId)) return badRequest(res, 'Invalid ID');

  const expense = await ProjectExpense.findOneAndDelete({ _id: req.params.expenseId, project: req.params.id });
  if (!expense) return notFound(res, 'Expense');

  await syncProjectActuals(req.params.id);
  res.json({ success: true, message: 'Expense deleted' });
}));

// ─── DAILY PROGRESS REPORTS ──────────────────────────────────────────────────

// GET /api/project-management/projects/:id/dpr
router.get('/projects/:id/dpr', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [reports, total] = await Promise.all([
    DailyProgressReport.find({ project: req.params.id })
      .populate('submittedBy', 'firstName lastName')
      .sort({ reportDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    DailyProgressReport.countDocuments({ project: req.params.id })
  ]);

  res.json({
    success: true,
    data: { reports, pagination: { total, page: Number(page), limit: Number(limit) } }
  });
}));

// GET /api/project-management/projects/:id/dpr/:dprId — single DPR
router.get('/projects/:id/dpr/:dprId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.dprId)) return badRequest(res, 'Invalid ID');

  const report = await DailyProgressReport.findOne({ _id: req.params.dprId, project: req.params.id })
    .populate('submittedBy', 'firstName lastName')
    .populate('workDone.task', 'title level')
    .lean();

  if (!report) return notFound(res, 'DPR');
  res.json({ success: true, data: report });
}));

// POST /api/project-management/projects/:id/dpr — submit DPR with optional photo uploads
router.post('/projects/:id/dpr', upload.array('photos', 20), asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const {
    reportDate, weather, temperature,
    workforceCivil, workforceElectrical, workforcePlumbing, workforceSupervisors,
    summary, nextDayPlan
  } = req.body;

  if (!reportDate) return badRequest(res, 'Report date is required');

  // Parse JSON arrays from multipart form
  const parseField = (field) => {
    try { return typeof field === 'string' ? JSON.parse(field) : field || []; }
    catch { return []; }
  };

  const workDone = parseField(req.body.workDone);
  const materialsUsed = parseField(req.body.materialsUsed);
  const issues = parseField(req.body.issues);

  // Build photos array from uploaded files
  const photos = (req.files || []).map((f, idx) => ({
    url: `/uploads/project-management/${f.filename}`,
    caption: (parseField(req.body.photoCaptions))[idx] || '',
    uploadedAt: new Date()
  }));

  const report = await DailyProgressReport.create({
    project: req.params.id,
    reportDate: new Date(reportDate),
    weather, temperature,
    workforceCivil: Number(workforceCivil) || 0,
    workforceElectrical: Number(workforceElectrical) || 0,
    workforcePlumbing: Number(workforcePlumbing) || 0,
    workforceSupervisors: Number(workforceSupervisors) || 0,
    workDone, materialsUsed, issues, photos,
    summary, nextDayPlan,
    submittedBy: req.user?._id,
    createdBy: req.user?._id
  });

  res.status(201).json({ success: true, message: 'DPR submitted successfully', data: report });
}));

// DELETE /api/project-management/projects/:id/dpr/:dprId
router.delete('/projects/:id/dpr/:dprId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.dprId)) return badRequest(res, 'Invalid ID');

  const report = await DailyProgressReport.findOneAndDelete({ _id: req.params.dprId, project: req.params.id });
  if (!report) return notFound(res, 'DPR');

  // Clean up uploaded photos
  report.photos?.forEach(p => {
    const filePath = path.join(__dirname, '..', p.url);
    if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
  });

  res.json({ success: true, message: 'DPR deleted' });
}));

// ─── BOQ → PURCHASE ORDER ─────────────────────────────────────────────────────

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
  const totalInvoiced = invoices.filter(i => i.status !== 'Cancelled').reduce((s, i) => s + (i.netPayableAmount || i.invoiceAmount), 0);
  const totalPaid = invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + (i.paidAmount || i.invoiceAmount), 0);
  const totalOutstanding = totalInvoiced - totalPaid;

  res.json({ success: true, data: { invoices, totalInvoiced, totalPaid, totalOutstanding } });
}));

// POST /api/project-management/projects/:id/invoices — manual / Subcontractor IPC invoice creation
router.post('/projects/:id/invoices', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const project = await ConstructionProject.findById(req.params.id).lean();
  if (!project) return notFound(res, 'Project');

  const masterProjectId = project.parentProject || null;

  const { invoiceType = 'Subcontractor_IPC', contractor, items = [], retentionPercentage = 0,
    advanceRecoveryAmount = 0, whtPercentage = 0, invoiceAmount, description, issueDate, dueDate,
    billingPercentage, milestoneId, milestoneName, notes, clientName, clientContact, clientAddress,
    boqItemId, checkRequestId } = req.body;

  let processedItems = [];
  let grossAmount = 0;
  let ipcNumber = 1;
  let linkedCheckRequest = null;

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

  if (linkedCheckRequest) {
    if (contractor && isValidId(contractor)) {
      const existingIpcCount = await ProjectInvoice.countDocuments({
        $or: [{ project: req.params.id }, { masterProject: req.params.id }],
        contractor,
        invoiceType: 'Subcontractor_IPC',
        status: { $ne: 'Cancelled' }
      });
      ipcNumber = existingIpcCount + 1;
    } else if (linkedCheckRequest.contractor) {
      const existingIpcCount = await ProjectInvoice.countDocuments({
        $or: [{ project: req.params.id }, { masterProject: req.params.id }],
        contractor: linkedCheckRequest.contractor,
        invoiceType: 'Subcontractor_IPC',
        status: { $ne: 'Cancelled' }
      });
      ipcNumber = existingIpcCount + 1;
    }

    const inputByBoq = new Map();
    (Array.isArray(items) ? items : []).forEach((itemInput) => {
      const key = String(itemInput.boqItemId || itemInput.boqItem || '');
      if (key) inputByBoq.set(key, itemInput);
    });

    for (const crItem of linkedCheckRequest.items) {
      const billableQty = Math.max(
        0,
        (Number(crItem.verifiedQuantity) || 0) - (Number(crItem.billedQuantity) || 0)
      );
      if (billableQty <= 0) continue;

      const override = inputByBoq.get(String(crItem.boqItem));
      let currentQuantity = override?.currentQuantity !== undefined
        ? Number(override.currentQuantity) || 0
        : billableQty;
      if (currentQuantity <= 0) continue;
      if (currentQuantity > billableQty) {
        return badRequest(
          res,
          `Quantity for "${crItem.title || crItem.description}" exceeds verified unpaid qty (${billableQty} ${crItem.unit}).`
        );
      }

      const unitPrice = Number(override?.unitPrice) || Number(crItem.unitPrice) || 0;
      const currentAmount = currentQuantity * unitPrice;
      grossAmount += currentAmount;

      const boq = await BOQItem.findById(crItem.boqItem).select('contractorBilledQuantity estimatedQuantity').lean();
      const previousQuantity = Number(boq?.contractorBilledQuantity) || 0;

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

    if (!processedItems.length) {
      return badRequest(res, 'No billable verified quantities left on this Check Request');
    }
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

  const finalGross = processedItems.length > 0 ? grossAmount : (Number(invoiceAmount) || 0);
  if (finalGross <= 0 && (!invoiceAmount || Number(invoiceAmount) <= 0)) {
    return badRequest(res, 'Invoice amount or valid BOQ executed line items are required');
  }

  const retentionP = Math.max(0, Number(retentionPercentage) || 0);
  const retentionAmount = Math.round(finalGross * (retentionP / 100) * 100) / 100;
  const advRec = Math.max(0, Number(advanceRecoveryAmount) || 0);
  const whtP = Math.max(0, Number(whtPercentage) || 0);
  const whtAmount = Math.round(finalGross * (whtP / 100) * 100) / 100;

  const netPayableAmount = Math.max(0, Math.round((finalGross - retentionAmount - advRec - whtAmount) * 100) / 100);
  const finalInvoiceAmt = processedItems.length > 0 ? netPayableAmount : Number(invoiceAmount);

  const invoiceContractor = (contractor && isValidId(contractor))
    ? contractor
    : (linkedCheckRequest?.contractor || null);

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
      ? `IPC #${ipcNumber} from ${linkedCheckRequest.checkRequestNumber}`
      : ''),
    issueDate: issueDate ? new Date(issueDate) : new Date(),
    dueDate: dueDate ? new Date(dueDate) : undefined,
    notes,
    createdBy: req.user?._id
  });

  // Update BOQ + Check Request billed quantities
  if (processedItems.length > 0) {
    await Promise.all(processedItems.map((item) =>
      BOQItem.findByIdAndUpdate(item.boqItem, {
        $inc: {
          contractorBilledQuantity: item.currentQuantity,
          contractorBilledAmount: item.currentAmount
        }
      })
    ));
  }

  if (linkedCheckRequest) {
    for (const item of processedItems) {
      const crItem = linkedCheckRequest.items.id(item._crItemId)
        || linkedCheckRequest.items.find((i) => String(i.boqItem) === String(item.boqItem));
      if (crItem) {
        crItem.billedQuantity = (Number(crItem.billedQuantity) || 0) + item.currentQuantity;
      }
    }
    const stillBillable = linkedCheckRequest.items.some(
      (i) => (Number(i.verifiedQuantity) || 0) - (Number(i.billedQuantity) || 0) > 0.0001
    );
    linkedCheckRequest.status = stillBillable ? 'Verified' : 'Billed';
    linkedCheckRequest.linkedInvoice = invoice._id;
    linkedCheckRequest.updatedBy = req.user?._id;
    await linkedCheckRequest.save();
  }

  await syncProjectInvoiceTotals(req.params.id);
  if (masterProjectId) {
    await syncProjectInvoiceTotals(masterProjectId);
  }

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

  const allowed = ['status', 'invoiceAmount', 'description', 'issueDate', 'dueDate',
    'paidAmount', 'paidDate', 'paymentMethod', 'paymentReference', 'notes',
    'clientName', 'clientContact', 'clientAddress', 'billingPercentage', 'boqItemId'];

  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const invoice = await ProjectInvoice.findOneAndUpdate(
    { _id: req.params.invoiceId, project: req.params.id },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!invoice) return notFound(res, 'Invoice');

  await syncProjectInvoiceTotals(req.params.id);
  res.json({ success: true, message: 'Invoice updated', data: invoice });
}));

// DELETE /api/project-management/projects/:id/invoices/:invoiceId
router.delete('/projects/:id/invoices/:invoiceId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.invoiceId)) return badRequest(res, 'Invalid ID');

  const invoice = await ProjectInvoice.findOneAndDelete({
    _id: req.params.invoiceId, project: req.params.id
  });
  if (!invoice) return notFound(res, 'Invoice');

  await syncProjectInvoiceTotals(req.params.id);
  res.json({ success: true, message: 'Invoice deleted' });
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
    .populate('linkedInvoice', 'invoiceNumber ipcNumber status invoiceAmount');

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
      return { ...cr, remainingItems, billableTotal };
    })
    .filter((cr) => (req.query.billable === 'true' ? cr.remainingItems.length > 0 : true));

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

  const { activityId, error: activityError } = await resolveCheckRequestActivity(project, req.body.activity);
  if (activityError) return badRequest(res, activityError);

  const { items: builtItems, claimedTotal } = await buildCheckRequestItems(
    req.params.id,
    project.parentProject,
    items
  );
  if (!builtItems.length) {
    return badRequest(res, 'Add at least one BOQ line with claimed quantity');
  }

  const cr = await CheckRequest.create({
    project: req.params.id,
    masterProject: project.parentProject,
    title: String(title).trim(),
    contractor: contractor && isValidId(contractor) ? contractor : null,
    activity: activityId,
    task: task && isValidId(task) ? task : null,
    items: builtItems,
    claimedTotal,
    verifiedTotal: 0,
    notes: notes || '',
    status: 'Draft',
    createdBy: req.user?._id,
    updatedBy: req.user?._id
  });

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

  if (title !== undefined) {
    if (!String(title).trim()) return badRequest(res, 'Title cannot be empty');
    cr.title = String(title).trim();
  }
  if (contractor !== undefined) {
    cr.contractor = contractor && isValidId(contractor) ? contractor : null;
  }
  if (task !== undefined) {
    cr.task = task && isValidId(task) ? task : null;
  }
  if (req.body.activity !== undefined) {
    const { activityId, error: activityError } = await resolveCheckRequestActivity(project, req.body.activity, { keepId: cr.activity });
    if (activityError) return badRequest(res, activityError);
    cr.activity = activityId;
  }
  if (notes !== undefined) cr.notes = notes || '';

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
  if (!cr.items?.length) return badRequest(res, 'Check Request has no items');

  cr.status = 'Submitted';
  cr.submittedAt = new Date();
  cr.submittedBy = req.user?._id;
  cr.rejectionReason = '';
  cr.updatedBy = req.user?._id;
  await cr.save();

  const populated = await populateCheckRequest(CheckRequest.findById(cr._id)).lean();
  res.json({ success: true, message: 'Check Request submitted for verification', data: populated });
}));

// POST verify (physical verification of Check Request)
router.post('/projects/:id/check-requests/:crId/verify', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.crId)) return badRequest(res, 'Invalid ID');

  const cr = await CheckRequest.findOne({ _id: req.params.crId, project: req.params.id });
  if (!cr) return notFound(res, 'Check Request');
  if (cr.status !== 'Submitted') {
    return badRequest(res, 'Only Submitted Check Requests can be verified');
  }

  const {
    verifiedBy = '',
    verificationNotes = '',
    verificationPhotoUrl = '',
    items: verifiedRows = []
  } = req.body;

  if (!String(verifiedBy).trim()) {
    return badRequest(res, 'Verified by (auditor name) is required');
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
      return badRequest(
        res,
        `Verified qty for "${item.title || item.description}" cannot exceed claimed qty (${item.claimedQuantity} ${item.unit})`
      );
    }

    // Cap against remaining BOQ estimate after already-verified (other CRs) + billed
    const boq = await BOQItem.findById(item.boqItem).select('estimatedQuantity title description unit').lean();
    if (boq) {
      const otherVerified = await CheckRequest.aggregate([
        {
          $match: {
            project: new mongoose.Types.ObjectId(req.params.id),
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
        return badRequest(
          res,
          `Verified qty for "${boq.title || boq.description}" exceeds remaining BOQ quantity (${remainingEst} ${boq.unit})`
        );
      }
    }

    item.verifiedQuantity = verifiedQuantity;
    item.verifiedAmount = verifiedQuantity * (Number(item.unitPrice) || 0);
    verifiedTotal += item.verifiedAmount;
  }

  if (verifiedTotal <= 0 && !cr.items.some((i) => (Number(i.verifiedQuantity) || 0) > 0)) {
    return badRequest(res, 'At least one line must have verified quantity greater than zero');
  }

  cr.status = 'Verified';
  cr.verifiedTotal = verifiedTotal;
  cr.verifiedAt = new Date();
  cr.verifiedBy = String(verifiedBy).trim();
  cr.verifiedByUser = req.user?._id;
  cr.verificationNotes = verificationNotes || '';
  cr.verificationPhotoUrl = verificationPhotoUrl || '';
  cr.updatedBy = req.user?._id;
  await cr.save();

  const populated = await populateCheckRequest(CheckRequest.findById(cr._id)).lean();
  res.json({ success: true, message: 'Check Request verified — ready for IPC / expense', data: populated });
}));

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

  res.json({ success: true, message: 'Check Request cancelled' });
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

  res.json({ success: true, message: 'Sublet contract cancelled' });
}));

module.exports = router;
