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

// Recalculate project.overallProgress from task average
const syncProjectProgress = async (projectId) => {
  const tasks = await ProjectTask.find({ project: projectId, level: { $gt: 0 } }).select('progressPercent');
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
    .populate('parentProject', 'name projectNumber isMasterProject projectType status lumpSumBudget')
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
  const { name, projectType, description, society, sector, plotNumber, address,
    clientName, clientContact, projectManager, startDate, expectedEndDate,
    budgetCategories, notes, tags, isMasterProject, parentProject, contractValue, linkedProperty } = req.body;

  if (!name || !name.trim()) return badRequest(res, 'Project name is required');

  const project = new ConstructionProject({
    name: name.trim(),
    projectType, description, society, sector, plotNumber, address,
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

  await project.save();

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
    'plotNumber', 'address', 'clientName', 'clientContact', 'projectManager',
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

// ─── BOQ ─────────────────────────────────────────────────────────────────────

const boqEst = (i) => (Number(i?.estimatedQuantity) || 0) * (Number(i?.estimatedUnitPrice) || 0) || Number(i?.estimatedTotalCost) || 0;
const boqDisc = (i) => Math.min(Number(i?.discountAmount) || 0, boqEst(i));
const boqNetEst = (i) => boqEst(i) - boqDisc(i);
const boqAct = (i) => (Number(i?.usedQuantity) || 0) * (Number(i?.actualUnitPrice) || 0) || Number(i?.actualTotalCost) || 0;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const buildBoqFilter = (projectId, { search, phase, category, boqHeaderId, isSubProject } = {}) => {
  const pId = new mongoose.Types.ObjectId(projectId);
  const projectFilter = isSubProject ? { subProject: pId } : { project: pId };
  const filter = { ...projectFilter };
  if (phase) filter.phase = phase;
  if (category) filter.category = category;
  if (boqHeaderId && isValidId(boqHeaderId)) filter.boqHeader = boqHeaderId;
  if (search) {
    const re = { $regex: search, $options: 'i' };
    filter.$or = ['title', 'description', 'specification', 'itemCode', 'category', 'unit', 'phase'].map((f) => ({ [f]: re }));
  }
  return { filter, projectFilter };
};

// ─── BOQ DOCUMENT HEADERS (CONTAINERS) ────────────────────────────────────────

// GET /api/project-management/projects/:id/boq-headers — list all BOQ documents for a project
router.get('/projects/:id/boq-headers', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');
  const headers = await ProjectBOQ.find({ project: req.params.id })
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

  const { title, description, unit, estimatedQuantity, estimatedUnitPrice, discountAmount, phase, category, specification, itemCode, notes, orderIndex, contractor, subProject, boqHeader, contractorUnitPrice } = req.body;
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
    specification,
    itemCode,
    contractor: contractor || null,
    subProject: subProject || null,
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
    subProject: item.subProject || null,
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

// GET /api/project-management/projects/:id/tasks
router.get('/projects/:id/tasks', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const tasks = await ProjectTask.find({ project: req.params.id })
    .populate('createdBy', 'firstName lastName')
    .sort({ level: 1, orderIndex: 1, createdAt: 1 })
    .lean();

  // Build tree: phases (level 0) → tasks (level 1) → subtasks (level 2)
  const phases = tasks.filter(t => t.level === 0);
  const byParent = tasks.filter(t => t.level > 0).reduce((acc, t) => {
    const pid = t.parentTask?.toString() || 'root';
    (acc[pid] = acc[pid] || []).push(t);
    return acc;
  }, {});

  const tree = phases.map(phase => ({
    ...phase,
    children: (byParent[phase._id.toString()] || []).map(task => ({
      ...task,
      children: byParent[task._id.toString()] || []
    }))
  }));

  // Include orphan tasks (no parent phase)
  const orphans = tasks.filter(t => t.level === 1 && !t.parentTask);
  if (orphans.length) {
    orphans.forEach(t => tree.push({ ...t, children: byParent[t._id.toString()] || [] }));
  }

  res.json({ success: true, data: { tasks, tree } });
}));

// POST /api/project-management/projects/:id/tasks — create phase or task
router.post('/projects/:id/tasks', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return badRequest(res, 'Invalid project ID');

  const { title, description, level, parentTask, plannedStartDate, plannedEndDate,
    assignedTo, estimatedLaborCost, notes, orderIndex } = req.body;

  if (!title) return badRequest(res, 'Task title is required');

  const task = await ProjectTask.create({
    project: req.params.id,
    title, description,
    level: level ?? 0,
    parentTask: parentTask || null,
    plannedStartDate: plannedStartDate ? new Date(plannedStartDate) : undefined,
    plannedEndDate: plannedEndDate ? new Date(plannedEndDate) : undefined,
    assignedTo, estimatedLaborCost,
    notes,
    orderIndex: orderIndex ?? 0,
    createdBy: req.user?._id
  });

  res.status(201).json({ success: true, message: 'Task created', data: task });
}));

// PUT /api/project-management/projects/:id/tasks/:taskId
router.put('/projects/:id/tasks/:taskId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.taskId)) return badRequest(res, 'Invalid ID');

  const allowed = ['title', 'description', 'status', 'progressPercent', 'plannedStartDate',
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

// DELETE /api/project-management/projects/:id/tasks/:taskId
router.delete('/projects/:id/tasks/:taskId', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.taskId)) return badRequest(res, 'Invalid ID');

  // Also delete child tasks
  await ProjectTask.deleteMany({ parentTask: req.params.taskId });
  const task = await ProjectTask.findOneAndDelete({ _id: req.params.taskId, project: req.params.id });
  if (!task) return notFound(res, 'Task');

  res.json({ success: true, message: 'Task deleted' });
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
    paymentStatus, paymentMethod, paymentDate, task, notes } = req.body;

  if (!description) return badRequest(res, 'Description is required');
  if (!category) return badRequest(res, 'Category is required');
  if (!amount || Number(amount) <= 0) return badRequest(res, 'Valid amount is required');

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
    billingPercentage, milestoneId, milestoneName, notes, clientName, clientContact, clientAddress, boqItemId } = req.body;

  let processedItems = [];
  let grossAmount = 0;
  let ipcNumber = 1;

  if (Array.isArray(items) && items.length > 0) {
    if (contractor && isValidId(contractor)) {
      const existingIpcCount = await ProjectInvoice.countDocuments({
        $or: [{ project: req.params.id }, { masterProject: req.params.id }],
        contractor,
        invoiceType: 'Subcontractor_IPC',
        status: { $ne: 'Cancelled' }
      });
      ipcNumber = existingIpcCount + 1;
    }

    for (const itemInput of items) {
      if (!itemInput.boqItemId || !isValidId(itemInput.boqItemId)) continue;
      // Search BOQ item under current project OR Master Project
      const searchCriteria = masterProjectId
        ? { _id: itemInput.boqItemId, $or: [{ project: req.params.id }, { project: masterProjectId }] }
        : { _id: itemInput.boqItemId, project: req.params.id };

      const boq = await BOQItem.findOne(searchCriteria);
      if (!boq) continue;

      const previousQuantity = Number(boq.contractorBilledQuantity) || 0;
      const currentQuantity = Number(itemInput.currentQuantity) || 0;
      const cumulativeQuantity = previousQuantity + currentQuantity;

      // Over-billing validation against Master BOQ estimated quantity
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

  const invoice = await ProjectInvoice.create({
    project: req.params.id,
    masterProject: masterProjectId,
    contractor: contractor && isValidId(contractor) ? contractor : null,
    invoiceType,
    ipcNumber,
    items: processedItems,
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
    clientName: clientName || project.clientName || '',
    clientContact: clientContact || project.clientContact || '',
    clientAddress: clientAddress || project.address || '',
    contractValue: project.contractValue || 0,
    billingPercentage: Number(billingPercentage) || 0,
    invoiceAmount: finalInvoiceAmt,
    description: description || (invoiceType === 'Subcontractor_IPC' ? `IPC #${ipcNumber} Subcontractor Bill` : ''),
    issueDate: issueDate ? new Date(issueDate) : new Date(),
    dueDate: dueDate ? new Date(dueDate) : undefined,
    notes,
    createdBy: req.user?._id
  });

  // Update BOQ items billed quantities
  if (processedItems.length > 0) {
    await Promise.all(processedItems.map(item =>
      BOQItem.findByIdAndUpdate(item.boqItem, {
        $inc: {
          contractorBilledQuantity: item.currentQuantity,
          contractorBilledAmount: item.currentAmount
        }
      })
    ));
  }

  await syncProjectInvoiceTotals(req.params.id);
  if (masterProjectId) {
    await syncProjectInvoiceTotals(masterProjectId);
  }

  const populated = await ProjectInvoice.findById(invoice._id)
    .populate('contractor', 'name email phone vendorType')
    .populate('createdBy', 'firstName lastName')
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

module.exports = router;
