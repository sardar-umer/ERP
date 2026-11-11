/**
 * Procurement roll-up for a Construction Project / Sub Project, per budget category.
 *
 * Worked out live from the POs and GRNs charged to the project (chargeTo), so nothing is stored
 * and nothing can drift:
 * - Indented  = estimated cost of indent quantities not yet put on a PO (pipeline, not counted in Available)
 * - Committed = value of approved POs (a PO stops counting the moment it is cancelled or rejected)
 * - Actual    = value of what has been received on those POs, less goods returned to the vendor
 * - Open      = Committed − Actual (ordered, not received yet)
 * - Available = Budget − Committed
 * - Consumed  = stock issued to the sub-project on Store Issue Notes, less returns to store (from any business unit's stock)
 *
 * All amounts are at PO cost including tax, with order-level discount / shipping spread over the lines,
 * so Committed and Actual are on the same basis.
 */
const mongoose = require('mongoose');
const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const GoodsReceive = require('../models/procurement/GoodsReceive');
const { matchPurchaseOrderLineIndex } = require('../utils/poLineMatch');

const { BUDGET_CATEGORIES } = ConstructionProject;
const UNCATEGORISED = 'Uncategorised';

/** POs past final approval. Older flows used Ordered / Partially Received / Received. */
const POST_APPROVAL_STATUSES = [
  'Approved', 'Sent to Store', 'GRN Created', 'Sent to Procurement', 'Sent to Audit', 'Sent to Finance',
  'Ordered', 'Partially Received', 'Received'
];
const DEAD_STATUSES = ['Cancelled', 'Rejected'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A PO commits budget once approved, and keeps doing so if later returned for rework (until cancelled / rejected) */
const isCommitted = (po) => !DEAD_STATUSES.includes(po.status)
  && (POST_APPROVAL_STATUSES.includes(po.status) || Boolean(po.financeApprovedAt));

/** Cost of one unit on each PO line, with order-level discount / shipping spread pro rata over the lines */
const unitCosts = (po) => {
  const items = po.items || [];
  const linesTotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const factor = linesTotal > 0 && Number(po.totalAmount) > 0 ? Number(po.totalAmount) / linesTotal : 1;
  return items.map((it) => {
    const qty = Number(it.quantity) || 0;
    return qty > 0 ? ((Number(it.amount) || 0) * factor) / qty : 0;
  });
};

const emptyRow = (category) => ({ category, budget: 0, indented: 0, committed: 0, actual: 0, consumed: 0, open: 0, available: 0, poCount: 0 });

/**
 * Committed / actual per Sub Project and category for the given Sub Project ids.
 * Returns Map(subId → Map(category → row)).
 */
const rollUpBySubProject = async (subIds, { excludeIndentIds = [], excludePoIds = [] } = {}) => {
  const ids = subIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const out = new Map(ids.map((id) => [String(id), new Map()]));
  if (!ids.length) return out;

  const rowFor = (subId, category) => {
    const cats = out.get(String(subId));
    if (!cats) return null;
    const key = category || UNCATEGORISED;
    if (!cats.has(key)) cats.set(key, emptyRow(key));
    return cats.get(key);
  };

  // Indented: approved indents not yet turned into POs (estimated cost of the quantity still to order)
  const Indent = require('../models/general/Indent');
  const indents = await Indent.find({
    'chargeTo.subProject': { $in: ids },
    _id: { $nin: excludeIndentIds.map((x) => new mongoose.Types.ObjectId(String(x))) },
    isActive: { $ne: false },
    status: { $in: ['Submitted', 'Under Review', 'Approved', 'Partially Fulfilled'] }
  }).select('chargeTo items.quantity items.orderedQuantity items.estimatedCost items.budgetCategory').lean();
  indents.forEach((ind) => {
    (ind.items || []).forEach((it) => {
      const qty = Number(it.quantity) || 0;
      const left = Math.max(0, qty - (Number(it.orderedQuantity) || 0));
      if (!qty || !left) return;
      // estimatedCost is per unit
      const row = rowFor(ind.chargeTo.subProject, it.budgetCategory);
      if (row) row.indented += (Number(it.estimatedCost) || 0) * left;
    });
  });

  // Consumed: stock issued to the sub-project on Store Issue Notes, less what came back to store.
  // Valued like Store Returns do: posted issue cost per unit, otherwise the item's average cost.
  const GoodsIssue = require('../models/procurement/GoodsIssue');
  const issues = await GoodsIssue.find({ 'chargeTo.subProject': { $in: ids }, status: 'Issued', issueType: { $ne: 'customer' } })
    .select('chargeTo items.inventoryItem items.quantity items.qtyIssued items.qtyReturnedToStore items.budgetCategory financePosting')
    .lean();
  if (issues.length) {
    const Inventory = require('../models/procurement/Inventory');
    const itemIds = [...new Set(issues.flatMap((d) => (d.items || []).map((it) => String(it.inventoryItem))))];
    const invCost = new Map((await Inventory.find({ _id: { $in: itemIds } }).select('averageCost unitPrice').lean())
      .map((i) => [String(i._id), Number(i.averageCost) > 0 ? Number(i.averageCost) : Number(i.unitPrice) || 0]));
    issues.forEach((d) => {
      const posted = new Map((d.financePosting || [])
        .filter((p) => p.status === 'posted' && Number(p.qty) > 0)
        .map((p) => [String(p.inventoryItem), Number(p.amount) / Number(p.qty)]));
      (d.items || []).forEach((it) => {
        const id = String(it.inventoryItem);
        const used = Math.max(0, (Number(it.qtyIssued ?? it.quantity) || 0) - (Number(it.qtyReturnedToStore) || 0));
        const row = used > 0 ? rowFor(d.chargeTo.subProject, it.budgetCategory) : null;
        if (row) row.consumed += used * (posted.has(id) ? posted.get(id) : (invCost.get(id) || 0));
      });
    });
  }

  const pos = await PurchaseOrder.find({
    'chargeTo.subProject': { $in: ids },
    _id: { $nin: excludePoIds.map((x) => new mongoose.Types.ObjectId(String(x))) },
    status: { $nin: DEAD_STATUSES }
  })
    .select('status financeApprovedAt totalAmount chargeTo items.description items.productCode items.quantity items.amount items.receivedQuantity items.budgetCategory')
    .lean();
  const committedPos = pos.filter(isCommitted);
  if (!committedPos.length) return out;

  // Goods sent back to the vendor, per PO line
  const returnedByPo = new Map();
  const grns = await GoodsReceive.find({
    purchaseOrder: { $in: committedPos.map((p) => p._id) },
    'items.returnedQuantity': { $gt: 0 }
  }).select('purchaseOrder items.itemName items.itemCode items.returnedQuantity').lean();
  const poById = new Map(committedPos.map((p) => [String(p._id), p]));
  grns.forEach((grn) => {
    const po = poById.get(String(grn.purchaseOrder));
    if (!po) return;
    const perLine = returnedByPo.get(String(po._id)) || new Map();
    (grn.items || []).forEach((line, i) => {
      const ret = Number(line.returnedQuantity) || 0;
      if (ret <= 0) return;
      const j = matchPurchaseOrderLineIndex(po.items || [], line, i);
      if (j >= 0) perLine.set(j, (perLine.get(j) || 0) + ret);
    });
    returnedByPo.set(String(po._id), perLine);
  });

  committedPos.forEach((po) => {
    const costs = unitCosts(po);
    const returned = returnedByPo.get(String(po._id)) || new Map();
    const touched = new Set();
    (po.items || []).forEach((it, j) => {
      const row = rowFor(po.chargeTo.subProject, it.budgetCategory);
      if (!row) return;
      const qty = Number(it.quantity) || 0;
      const received = Math.max(0, (Number(it.receivedQuantity) || 0) - (returned.get(j) || 0));
      row.committed += qty * costs[j];
      row.actual += Math.min(received, qty) * costs[j];
      touched.add(row.category);
    });
    touched.forEach((cat) => { rowFor(po.chargeTo.subProject, cat).poCount += 1; });
  });

  return out;
};

/** Sub Project budget per category: approved amounts once the budget is approved, otherwise the estimate */
const categoryBudgets = (sub) => {
  const approved = sub.budgetStatus === 'Approved';
  const map = new Map();
  (sub.budgetCategories || []).forEach((c) => {
    map.set(c.category, Number(approved ? c.approvedAmount : c.estimatedAmount) || 0);
  });
  return map;
};

const finishRows = (rows) => rows.map((r) => {
  const committed = round2(r.committed);
  const actual = round2(r.actual);
  return {
    ...r,
    consumed: round2(r.consumed),
    budget: round2(r.budget),
    indented: round2(r.indented),
    committed,
    actual,
    open: round2(committed - actual),
    available: round2(r.budget - committed)
  };
});

const sumRows = (rows) => {
  const t = rows.reduce((acc, r) => {
    ['budget', 'indented', 'committed', 'actual', 'consumed', 'poCount'].forEach((k) => { acc[k] += Number(r[k]) || 0; });
    return acc;
  }, { budget: 0, indented: 0, committed: 0, actual: 0, consumed: 0, poCount: 0 });
  return finishRows([{ category: 'Total', ...t }])[0];
};

/**
 * Procurement summary for a Main Project (all its Sub Projects) or a single Sub Project.
 * Sub Project total budget is its approved / allocated budget even when it has no category split.
 */
const getProjectProcurementSummary = async (projectId) => {
  if (!mongoose.Types.ObjectId.isValid(String(projectId))) return null;
  const project = await ConstructionProject.findById(projectId)
    .select('name projectNumber parentProject budgetStatus budgetCategories allocatedBudget totalApprovedBudget totalEstimatedCost')
    .lean();
  if (!project) return null;

  const isMain = !project.parentProject;
  const subs = isMain
    ? await ConstructionProject.find({ parentProject: project._id, status: { $ne: 'Cancelled' } })
      .select('name projectNumber budgetStatus budgetCategories allocatedBudget totalApprovedBudget totalEstimatedCost')
      .sort({ name: 1 })
      .lean()
    : [project];

  const rolled = await rollUpBySubProject(subs.map((s) => s._id));

  const subProjects = subs.map((sub) => {
    const budgets = categoryBudgets(sub);
    const cats = rolled.get(String(sub._id)) || new Map();
    // Every category with a budget or any procurement against it; standard order, Uncategorised last
    const names = [...BUDGET_CATEGORIES, UNCATEGORISED].filter((c) => (budgets.get(c) || 0) > 0 || cats.has(c));
    const categories = finishRows(names.map((c) => ({ ...(cats.get(c) || emptyRow(c)), budget: budgets.get(c) || 0 })));
    const totals = sumRows(categories);
    // A Sub Project without a category split still has its approved / allocated total
    const subBudget = Number(sub.budgetStatus === 'Approved' ? sub.totalApprovedBudget : sub.totalEstimatedCost)
      || Number(sub.allocatedBudget) || 0;
    if (subBudget > totals.budget) {
      totals.budget = round2(subBudget);
      totals.available = round2(subBudget - totals.committed);
    }
    return {
      _id: sub._id,
      name: sub.name,
      projectNumber: sub.projectNumber || '',
      budgetStatus: sub.budgetStatus,
      categories,
      totals
    };
  });

  const totals = sumRows(subProjects.map((s) => s.totals));
  return {
    project: { _id: project._id, name: project.name, projectNumber: project.projectNumber || '', isMain },
    subProjects,
    totals
  };
};

/**
 * Budget check for a document charged to a Sub Project (an indent being raised, or a PO being approved).
 * `lines` = [{ category, amount }] — the document's own value per category.
 * The document itself is left out of the roll-up (excludeIndentIds / excludePoIds) so it is never counted twice.
 *
 * Compared per category when the Sub Project's budget is split by category; otherwise against its total.
 * Never blocks anything — it only reports, so the screen can warn.
 */
const checkBudget = async (subProjectId, lines, exclude = {}) => {
  if (!mongoose.Types.ObjectId.isValid(String(subProjectId))) return null;
  const sub = await ConstructionProject.findById(subProjectId)
    .select('name projectNumber parentProject budgetStatus budgetCategories allocatedBudget totalApprovedBudget totalEstimatedCost')
    .lean();
  if (!sub || !sub.parentProject) return null;

  const rolled = (await rollUpBySubProject([sub._id], exclude)).get(String(sub._id)) || new Map();
  const budgets = categoryBudgets(sub);
  const thisByCat = new Map();
  (lines || []).forEach((l) => {
    const key = l.category || UNCATEGORISED;
    thisByCat.set(key, (thisByCat.get(key) || 0) + (Number(l.amount) || 0));
  });

  const build = (category, budget, others, thisAmount) => {
    const committed = round2(others.committed);
    const availableBefore = round2(budget - committed);
    const availableAfter = round2(availableBefore - thisAmount);
    return {
      category,
      budget: round2(budget),
      committed,
      actual: round2(others.actual),
      indentedElsewhere: round2(others.indented),
      thisAmount: round2(thisAmount),
      availableBefore,
      availableAfter,
      overBy: availableAfter < 0 ? round2(-availableAfter) : 0
    };
  };

  const categoryBudgetTotal = [...budgets.values()].reduce((t, v) => t + v, 0);
  let mode;
  let rows;
  if (categoryBudgetTotal > 0) {
    mode = 'category';
    rows = [...thisByCat.keys()].map((cat) => build(cat, budgets.get(cat) || 0, rolled.get(cat) || emptyRow(cat), thisByCat.get(cat)));
  } else {
    mode = 'total';
    const all = [...rolled.values()].reduce((t, r) => ({
      committed: t.committed + r.committed, actual: t.actual + r.actual, indented: t.indented + r.indented
    }), { committed: 0, actual: 0, indented: 0 });
    const total = Number(sub.budgetStatus === 'Approved' ? sub.totalApprovedBudget : sub.totalEstimatedCost) || Number(sub.allocatedBudget) || 0;
    const thisTotal = [...thisByCat.values()].reduce((t, v) => t + v, 0);
    rows = [build('Sub-project total', total, all, thisTotal)];
  }

  const overBy = round2(rows.reduce((t, r) => t + r.overBy, 0));
  return {
    subProject: { _id: sub._id, name: sub.name, projectNumber: sub.projectNumber || '' },
    budgetStatus: sub.budgetStatus,
    budgetApproved: sub.budgetStatus === 'Approved',
    mode,
    rows,
    thisTotal: round2([...thisByCat.values()].reduce((t, v) => t + v, 0)),
    overBudget: overBy > 0,
    overBy
  };
};

/** This PO's value per budget category, on the same basis as Committed */
const poLines = (po) => {
  const costs = unitCosts(po);
  return (po.items || []).map((it, j) => ({ category: it.budgetCategory, amount: (Number(it.quantity) || 0) * costs[j] }));
};

/** An indent's estimated value per budget category (estimatedCost is per unit) */
const indentLines = (items) => (items || []).map((it) => ({
  category: it.budgetCategory,
  amount: (Number(it.estimatedCost) || 0) * (Number(it.quantity) || 0)
}));

module.exports = {
  checkBudget,
  poLines,
  indentLines,
  getProjectProcurementSummary,
  rollUpBySubProject,
  isCommitted,
  POST_APPROVAL_STATUSES
};
