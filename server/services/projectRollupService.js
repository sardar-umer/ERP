const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const BOQItem = require('../models/projectManagement/BOQItem');
const ProjectTask = require('../models/projectManagement/ProjectTask');
const GoodsReceive = require('../models/procurement/GoodsReceive');
const GoodsIssue = require('../models/procurement/GoodsIssue');
const AccountsPayable = require('../models/finance/AccountsPayable');

/**
 * Project Rollup Aggregation Service
 * Computes consolidated upper-level metrics for Master Projects & Portfolios
 */
const ProjectRollupService = {
  /**
   * Get consolidated metrics for a Master Project and all its child sub-projects
   * @param {String|ObjectId} masterProjectId
   * @returns {Object} Combined rollup metrics for Senior Management
   */
  getProjectRollupSummary: async (masterProjectId) => {

    // 1. Fetch Master Project & all Child Sub-Projects
    const masterProject = await ConstructionProject.findById(masterProjectId).lean();
    if (!masterProject) {
      throw new Error('Master project not found');
    }

    const childProjects = await ConstructionProject.find({
      $or: [
        { _id: masterProjectId },
        { parentProject: masterProjectId }
      ]
    }).lean();

    const allProjectIds = childProjects.map((p) => p._id);
    const subProjectIds = childProjects
      .filter((p) => String(p._id) !== String(masterProjectId))
      .map((p) => p._id);

    // 2. Aggregate BOQ Budgets & Quantities across projects
    const boqAgg = await BOQItem.aggregate([
      { $match: { project: { $in: allProjectIds } } },
      {
        $group: {
          _id: '$cbsCategory',
          totalEstimatedCost: { $sum: { $ifNull: ['$netEstimatedCost', '$estimatedTotalCost'] } },
          totalActualCost: { $sum: { $ifNull: ['$actualTotalCost', 0] } },
          itemCount: { $sum: 1 }
        }
      }
    ]);

    const cbsSummary = {
      Materials: { estimated: 0, actual: 0 },
      Labor: { estimated: 0, actual: 0 },
      Equipment: { estimated: 0, actual: 0 },
      Subcontractor: { estimated: 0, actual: 0 },
      Contingency: { estimated: 0, actual: 0 },
      Other: { estimated: 0, actual: 0 }
    };

    let grandEstimatedBudget = 0;
    let grandActualCost = 0;

    boqAgg.forEach((row) => {
      const cat = row._id || 'Other';
      if (cbsSummary[cat]) {
        cbsSummary[cat].estimated += row.totalEstimatedCost || 0;
        cbsSummary[cat].actual += row.totalActualCost || 0;
      }
      grandEstimatedBudget += row.totalEstimatedCost || 0;
      grandActualCost += row.totalActualCost || 0;
    });

    // Fall back to direct project model budgeted amount if BOQs not added yet
    if (grandEstimatedBudget === 0) {
      const subProjects = childProjects.filter(p => String(p._id) !== String(masterProjectId));
      if (subProjects.length > 0) {
        grandEstimatedBudget = subProjects.reduce((sum, p) => sum + (p.totalApprovedBudget || p.totalEstimatedCost || 0), 0);
      } else {
        grandEstimatedBudget = masterProject.totalApprovedBudget || masterProject.totalEstimatedCost || 0;
      }
    }

    // 3. Aggregate Actual Expenditure from Financial Documents (GRN, AP Bills, Store Issues, Subcontractor IPCs)
    const ProjectInvoice = require('../models/projectManagement/ProjectInvoice');
    const ipcMatch = { project: { $in: allProjectIds }, invoiceType: 'Subcontractor_IPC', ipcKind: { $nin: ['Advance', 'Retention Release'] }, status: { $ne: 'Cancelled' } };
    const [grnAgg, apAgg, sinAgg, expAgg] = await Promise.all([
      GoodsReceive.aggregate([
        { $match: { project: { $in: allProjectIds }, status: 'Received' } },
        { $group: { _id: '$project', total: { $sum: { $ifNull: ['$totalAmount', 0] } } } }
      ]),
      AccountsPayable.aggregate([
        { $match: { project: { $in: allProjectIds } } },
        { $group: { _id: '$project', total: { $sum: { $ifNull: ['$totalAmount', 0] } } } }
      ]),
      GoodsIssue.aggregate([
        { $match: { project: { $in: allProjectIds }, status: 'Issued' } },
        { $group: { _id: '$project', total: { $sum: { $ifNull: ['$totalQuantity', 0] } } } }
      ]),
      ProjectInvoice.aggregate([
        { $match: ipcMatch },
        { $group: { _id: '$project', total: { $sum: { $ifNull: ['$grossAmount', 0] } } } }
      ])
    ]);

    const grnSpentMap = new Map(grnAgg.map(g => [String(g._id), g.total || 0]));
    const apSpentMap = new Map(apAgg.map(a => [String(a._id), a.total || 0]));
    const expSpentMap = new Map(expAgg.map(e => [String(e._id), e.total || 0]));

    const grnTotalSpent = grnAgg.reduce((sum, g) => sum + (g.total || 0), 0);
    const apTotalSpent = apAgg.reduce((sum, a) => sum + (a.total || 0), 0);
    const expTotalSpent = expAgg.reduce((sum, e) => sum + (e.total || 0), 0);

    // 4. Calculate Child Unit Performance Breakdown with dynamic actual spending
    const childUnitBreakdown = childProjects
      .filter((p) => String(p._id) !== String(masterProjectId) || childProjects.length === 1)
      .map((p) => {
        const pIdStr = String(p._id);
        const estBudget = p.totalApprovedBudget || p.totalEstimatedCost || 0;
        const actualCost = p.totalActualSpent || expSpentMap.get(pIdStr) || apSpentMap.get(pIdStr) || grnSpentMap.get(pIdStr) || 0;

        const milestones = p.milestones || [];
        const totalMilestones = milestones.length;
        const completedMilestones = milestones.filter((m) => m.status === 'Completed').length;
        const milestoneProgress = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;

        const completionPercentage = p.overallProgress ?? p.overallProgressPercentage ?? milestoneProgress;
        return {
          _id: p._id,
          projectNumber: p.projectNumber,
          name: p.name,
          projectType: p.projectType,
          status: p.status,
          estimatedBudget: estBudget,
          actualCost,
          completionPercentage,
          healthStatus: completionPercentage < 20 && p.status === 'Active' ? 'Requires Attention' : 'On Track'
        };
      });

    // 5. Calculate Weighted Master Physical Progress
    const totalUnits = childUnitBreakdown.length || 1;
    const masterOverallProgress = Math.round(
      childUnitBreakdown.reduce((sum, u) => sum + u.completionPercentage, 0) / totalUnits
    );

    // 6. Calculate EVM (Earned Value Management) & Predictive Cash Flow
    const earnedValue = Math.round((grandEstimatedBudget * masterOverallProgress) / 100);
    const actualCostForEvm = grandActualCost || expTotalSpent || grnTotalSpent || 1;
    const cpi = Number((earnedValue / actualCostForEvm).toFixed(2)); // Cost Performance Index
    const spi = Number(((masterOverallProgress || 1) / 50).toFixed(2)); // Schedule Performance Index (normalized vs 50% midpoint benchmark)

    // 7. Ground visual proof: latest site photos inspectors attached to inspection reports
    const InspectionReport = require('../models/projectManagement/InspectionReport');
    const inspections = await InspectionReport.find({
      project: { $in: allProjectIds },
      'inspectors.attachments.0': { $exists: true }
    })
      .select('reportNumber inspectionDate location inspectors project')
      .populate('project', 'name projectNumber')
      .sort({ inspectionDate: -1 })
      .limit(10)
      .lean();

    const groundPhotoStream = [];
    inspections.forEach((ir) => {
      (ir.inspectors || []).forEach((insp) => {
        (insp.attachments || []).filter((a) => a.kind === 'image').forEach((a) => {
          groundPhotoStream.push({
            url: a.url,
            caption: `${ir.reportNumber} — ${insp.name || 'Inspector'}${ir.location ? ` · ${ir.location}` : ''}`,
            isVerifiedLocation: false,
            uploadedAt: insp.actedAt || ir.inspectionDate,
            projectName: ir.project?.name || 'Sub-Unit'
          });
        });
      });
    });
    groundPhotoStream.splice(24);

    const costVariance = (grandActualCost || expTotalSpent) - grandEstimatedBudget;
    const costHealthStatus = costVariance > 0 ? 'Over Budget' : 'Under Budget';

    // 8. Dynamic Monthly S-Curve Progress Timeline
    const monthsBack = 6;
    const now = new Date();
    const sCurveData = [];
    const cashFlowTrendData = [];

    // Aggregate monthly IPC value (the only money path for project costs)
    const monthlyExpenses = await ProjectInvoice.aggregate([
      { $match: ipcMatch },
      {
        $group: {
          _id: {
            year: { $year: '$issueDate' },
            month: { $month: '$issueDate' }
          },
          totalAmount: { $sum: { $ifNull: ['$grossAmount', 0] } }
        }
      }
    ]);

    const expenseMonthMap = new Map();
    monthlyExpenses.forEach((item) => {
      const key = `${item._id.year}-${String(item._id.month).padStart(2, '0')}`;
      expenseMonthMap.set(key, item.totalAmount);
    });

    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = d.toLocaleString('en-US', { month: 'short' });
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      
      const targetPlanned = Math.min(100, Math.round(((monthsBack - i) / monthsBack) * 100));
      const actualProgress = i === 0 ? masterOverallProgress : Math.round((masterOverallProgress * (monthsBack - i)) / monthsBack);
      
      sCurveData.push({
        month: monthLabel,
        planned: targetPlanned,
        actual: actualProgress
      });

      const monthSpent = expenseMonthMap.get(key) || 0;
      cashFlowTrendData.push({
        month: monthLabel,
        cashOutflow: monthSpent
      });
    }

    // 9. Calculate 30-Day Liquidity Demand Forecast
    const cashDemandForecast30Days = Math.round(Math.max(0, grandEstimatedBudget - (grandActualCost || expTotalSpent)) * 0.15);

    return {
      masterProject: {
        _id: masterProject._id,
        name: masterProject.name,
        projectNumber: masterProject.projectNumber,
        status: masterProject.status,
        isMasterProject: true
      },
      summaryMetrics: {
        totalSubUnits: childUnitBreakdown.length,
        grandEstimatedBudget,
        grandActualCost: grandActualCost || expTotalSpent,
        grnTotalSpent,
        apTotalSpent,
        expTotalSpent,
        costVariance,
        costHealthStatus,
        masterOverallProgress,
        earnedValueManagement: {
          earnedValue,
          cpi,
          spi,
          cpiStatus: cpi >= 1.0 ? 'On/Under Budget' : 'Cost Overrun Warning',
          spiStatus: spi >= 1.0 ? 'On/Ahead of Schedule' : 'Schedule Lag Warning'
        },
        cashDemandForecast30Days
      },
      cbsCostBreakdown: cbsSummary,
      subUnitBreakdown: childUnitBreakdown,
      groundPhotoStream: groundPhotoStream.slice(0, 8),
      sCurveData,
      cashFlowTrendData
    };
  }
};

module.exports = ProjectRollupService;
