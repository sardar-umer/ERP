const mongoose = require('mongoose');
const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const SubletContract = require('../models/projectManagement/SubletContract');
const CheckRequest = require('../models/projectManagement/CheckRequest');
const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');

const sumField = async (Model, match, field) => {
  const [row] = await Model.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: { $ifNull: [`$${field}`, 0] } } } }
  ]);
  return Number(row?.total) || 0;
};

/**
 * Sub Project figures, all derived from the one money path (Contract → Check Request → IPC):
 * - progress = verified work value / active + completed sublet contract value
 *   (falls back to the Sub's BOQ estimate when no contract is active yet)
 * - spent    = gross value of non-cancelled Subcontractor IPCs
 */
const computeSubProjectMetrics = async (project) => {
  const id = new mongoose.Types.ObjectId(String(project._id));

  const [contractValue, verifiedValue, spent] = await Promise.all([
    sumField(SubletContract, { project: id, status: { $in: ['Active', 'Completed'] } }, 'totalAmount'),
    sumField(CheckRequest, { project: id, status: { $in: ['Verified', 'Billed'] } }, 'verifiedTotal'),
    // Only certified work is cost — advances and retention releases are balance-sheet movements
    sumField(ProjectInvoice, { project: id, invoiceType: 'Subcontractor_IPC', ipcKind: { $nin: ['Advance', 'Retention Release'] }, status: { $ne: 'Cancelled' } }, 'grossAmount')
  ]);

  const scopeValue = contractValue || Number(project.totalEstimatedCost) || 0;
  let progress = 0;
  if (project.status === 'Completed') progress = 100;
  else if (scopeValue > 0) progress = Math.min(100, Math.round((verifiedValue / scopeValue) * 100));

  return { progress, spent, contractValue, verifiedValue };
};

/** Main Project spent = sum of its Sub Projects (progress is averaged by the model's rollup hook). */
const syncMainProjectSpent = async (mainId) => {
  if (!mainId) return;
  const total = await sumField(
    ConstructionProject,
    { parentProject: new mongoose.Types.ObjectId(String(mainId)), status: { $ne: 'Cancelled' } },
    'totalActualSpent'
  );
  await ConstructionProject.updateOne({ _id: mainId }, { $set: { totalActualSpent: total } });
};

/**
 * Recalculate progress + spent for a project and roll up to its Main.
 * Call after anything that changes contracts, check requests, IPCs or project status.
 */
const syncProjectMetrics = async (projectId) => {
  if (!projectId || !mongoose.Types.ObjectId.isValid(String(projectId))) return null;
  const project = await ConstructionProject.findById(projectId)
    .select('parentProject status totalEstimatedCost')
    .lean();
  if (!project) return null;

  if (!project.parentProject) {
    await syncMainProjectSpent(project._id);
    return null;
  }

  const metrics = await computeSubProjectMetrics(project);
  // findByIdAndUpdate fires the model hook that re-averages the Main's progress
  await ConstructionProject.findByIdAndUpdate(project._id, {
    $set: { overallProgress: metrics.progress, totalActualSpent: metrics.spent }
  });
  await syncMainProjectSpent(project.parentProject);
  return metrics;
};

module.exports = { syncProjectMetrics, computeSubProjectMetrics };
