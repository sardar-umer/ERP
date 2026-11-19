/**
 * Procurement Reports (read-only).
 *
 * GET /api/procurement/reports/indents
 *   Indent register: how many indents were created in a period, their amount, their status
 *   and where each one is now (with requester / approvers / store / procurement / CS / PO).
 *
 * GET /api/procurement/reports/purchase-orders
 *   PO register: how many POs were created in a period, their amount, their status, where each
 *   one is now (approval stage / delivery / billing) and received, billed and paid amounts.
 */
const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../middleware/errorHandler');
const Indent = require('../models/general/Indent');
const Quotation = require('../models/procurement/Quotation');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const GoodsReceive = require('../models/procurement/GoodsReceive');
const AccountsPayable = require('../models/finance/AccountsPayable');
const Supplier = require('../models/hr/Supplier');

const router = express.Router();

const PROCUREMENT_MODULE_KEY = 'procurement';
const REPORT_ROLES = ['super_admin', 'admin', 'developer', 'procurement_manager', 'higher_management'];
const MANAGER_ROLE_NAMES = ['gm procurement', 'general manager procurement'];

const hasProcurementModule = (roleDoc) => Boolean(
  roleDoc?.isActive && Array.isArray(roleDoc.permissions)
  && roleDoc.permissions.some((p) => p?.module === PROCUREMENT_MODULE_KEY)
);

const roleNames = (roleDoc) => [roleDoc?.name, roleDoc?.displayName]
  .map((v) => String(v || '').trim().toLowerCase())
  .filter(Boolean);

/** Same people who can read the Procurement module (plus higher management). */
const canViewReports = (user) => {
  if (!user) return false;
  if (REPORT_ROLES.includes(user.role)) return true;
  const docs = [user.roleRef, ...(Array.isArray(user.roles) ? user.roles : [])].filter(Boolean);
  if (docs.some(hasProcurementModule)) return true;
  return docs.some((d) => roleNames(d).some((n) => MANAGER_ROLE_NAMES.includes(n)));
};

const requireReportAccess = (req, res, next) => {
  if (canViewReports(req.user)) return next();
  return res.status(403).json({ success: false, message: 'You do not have access to procurement reports' });
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const personName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** PO statuses that no longer count as an order placed against the indent */
const DEAD_PO_STATUSES = ['Cancelled', 'Rejected'];

/** Stages, in the order the report shows them */
const INDENT_STAGES = [
  'Draft',
  'Pending Approval',
  'With Store (stock check)',
  'In Procurement',
  'Quotations Received',
  'Comparative Statement',
  'PO Raised',
  'Partially Fulfilled',
  'Fulfilled',
  'Rejected',
  'Cancelled'
];

/**
 * Work out where an indent is now, with a short detail line.
 * `quotes` = number of quotations, `pos` = live POs [{orderNumber, status}].
 */
const indentStage = (ind, quotes, pos) => {
  const poText = pos.map((p) => `${p.orderNumber} (${p.status})`).join(', ');
  switch (ind.status) {
    case 'Draft':
      return { stage: 'Draft', detail: 'Not yet submitted by requester' };
    case 'Submitted':
    case 'Under Review': {
      const pending = (ind.approvalChain || []).filter((a) => a.status === 'pending').map((a) => personName(a.approver)).filter(Boolean);
      return { stage: 'Pending Approval', detail: pending.length ? `Waiting for ${pending.join(', ')}` : 'Waiting for approver' };
    }
    case 'Rejected':
      return { stage: 'Rejected', detail: ind.lastRejectionReason || ind.rejectionReason || 'Rejected by approver' };
    case 'Rejected in Procurement':
      return { stage: 'Rejected', detail: `Rejected in Procurement${ind.procurementRejection?.observation ? `: ${ind.procurementRejection.observation}` : ''}` };
    case 'Cancelled':
      return { stage: 'Cancelled', detail: 'Cancelled' };
    case 'Fulfilled':
      return { stage: 'Fulfilled', detail: poText || 'Fulfilled' };
    case 'Partially Fulfilled':
      return { stage: 'Partially Fulfilled', detail: poText || 'Partially fulfilled' };
    default: break;
  }
  // Approved
  if (ind.storeRoutingStatus === 'pending_store_check') {
    return { stage: 'With Store (stock check)', detail: 'Store is checking stock before Procurement' };
  }
  if (pos.length) return { stage: 'PO Raised', detail: poText };
  const cs = ind.comparativeApproval?.status;
  if (['draft', 'submitted', 'approved', 'rejected'].includes(cs)) {
    const csText = {
      draft: 'Comparative statement being prepared',
      submitted: 'Comparative statement waiting for approval',
      approved: 'Comparative statement approved, PO not yet made',
      rejected: 'Comparative statement rejected'
    }[cs];
    return { stage: 'Comparative Statement', detail: csText };
  }
  if (quotes > 0) return { stage: 'Quotations Received', detail: `${quotes} quotation(s) received` };
  const assignee = personName(ind.procurementAssignment?.assignedTo);
  return { stage: 'In Procurement', detail: assignee ? `Assigned to ${assignee}, awaiting quotations` : 'Not yet assigned, awaiting quotations' };
};

router.get('/indents', requireReportAccess, asyncHandler(async (req, res) => {
  const { from, to, status, stage, department, search } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const all = String(req.query.all).toLowerCase() === 'true';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));

  const filter = { isActive: { $ne: false } };
  const and = [];
  if (from || to) {
    const range = {};
    if (from) range.$gte = new Date(`${from}T00:00:00.000`);
    if (to) range.$lte = new Date(`${to}T23:59:59.999`);
    and.push({ $or: [{ requestedDate: range }, { requestedDate: null, createdAt: range }] });
  }
  if (status) filter.status = status;
  if (department && mongoose.Types.ObjectId.isValid(department)) filter.department = department;
  if (search && String(search).trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
    and.push({ $or: [{ indentNumber: rx }, { title: rx }, { 'items.itemName': rx }, { 'chargeTo.projectName': rx }] });
  }
  if (and.length) filter.$and = and;

  const indents = await Indent.find(filter)
    .select('indentNumber title status storeRoutingStatus department requestedBy requestedDate requiredDate createdAt totalEstimatedCost items.itemName items.itemCode items.description items.brand items.quantity items.unit items.estimatedCost items.purpose items.budgetCategory chargeTo costCenter approvalChain comparativeApproval.status procurementAssignment.assignedTo procurementRejection.observation rejectionReason lastRejectionReason priority')
    .populate('department', 'name')
    .populate('requestedBy', 'firstName lastName')
    .populate('approvalChain.approver', 'firstName lastName')
    .populate('procurementAssignment.assignedTo', 'firstName lastName')
    .populate('costCenter', 'name code')
    .sort({ requestedDate: -1, createdAt: -1 })
    .lean();

  const ids = indents.map((i) => i._id);
  const [quoteAgg, poList] = await Promise.all([
    ids.length ? Quotation.aggregate([
      { $match: { indent: { $in: ids } } },
      { $group: { _id: '$indent', count: { $sum: 1 } } }
    ]) : [],
    ids.length ? PurchaseOrder.find({ indent: { $in: ids }, status: { $nin: DEAD_PO_STATUSES }, supersededBy: null })
      .select('indent orderNumber status totalAmount items.description items.quantity items.unitPrice items.amount')
      .sort({ createdAt: 1 })
      .lean() : []
  ]);
  const quoteCount = new Map(quoteAgg.map((q) => [String(q._id), q.count]));
  const posByIndent = new Map();
  poList.forEach((po) => {
    const key = String(po.indent);
    if (!posByIndent.has(key)) posByIndent.set(key, []);
    posByIndent.get(key).push(po);
  });

  const normName = (v) => String(v || '').trim().toLowerCase();

  let rows = indents.map((ind) => {
    const pos = posByIndent.get(String(ind._id)) || [];
    // PO lines carry the indent item's name as their description, so match each indent line by name
    const items = (ind.items || []).map((it, idx) => {
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.estimatedCost) || 0;
      const onPos = [];
      let poQty = 0;
      let poAmount = 0;
      pos.forEach((po) => {
        (po.items || []).forEach((line) => {
          if (normName(line.description) && normName(line.description) === normName(it.itemName)) {
            if (!onPos.includes(po.orderNumber)) onPos.push(po.orderNumber);
            poQty += Number(line.quantity) || 0;
            poAmount += Number(line.amount) || ((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
          }
        });
      });
      return {
        line: idx + 1,
        itemName: it.itemName || '',
        itemCode: it.itemCode || '',
        description: it.description || '',
        brand: it.brand || '',
        quantity: qty,
        unit: it.unit || '',
        estimatedRate: round2(rate),
        estimatedAmount: round2(qty * rate),
        purpose: it.purpose || '',
        budgetCategory: it.budgetCategory || '',
        poNumbers: onPos.join(', '),
        poQuantity: round2(poQty),
        poAmount: round2(poAmount)
      };
    });
    const { stage: stageName, detail } = indentStage(ind, quoteCount.get(String(ind._id)) || 0, pos);
    return {
      _id: ind._id,
      indentNumber: ind.indentNumber || '',
      title: ind.title || '',
      date: ind.requestedDate || ind.createdAt,
      requiredDate: ind.requiredDate || null,
      department: ind.department?.name || '',
      project: [ind.chargeTo?.projectName, ind.chargeTo?.subProjectName].filter(Boolean).join(' / '),
      costCenter: ind.costCenter ? [ind.costCenter.code, ind.costCenter.name].filter(Boolean).join(' - ') : '',
      requestedBy: personName(ind.requestedBy),
      itemCount: items.length,
      items,
      estimatedAmount: round2(ind.totalEstimatedCost),
      status: ind.status,
      stage: stageName,
      stageDetail: detail,
      quotations: quoteCount.get(String(ind._id)) || 0,
      poCount: pos.length,
      poNumbers: pos.map((p) => p.orderNumber).join(', '),
      poAmount: round2(pos.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0))
    };
  });

  if (stage) rows = rows.filter((r) => r.stage === stage);

  // Summary over the whole filtered set (not just this page)
  const byStatus = new Map();
  const byStage = new Map();
  let totalAmount = 0;
  let totalPoAmount = 0;
  rows.forEach((r) => {
    totalAmount += r.estimatedAmount;
    totalPoAmount += r.poAmount;
    const s = byStatus.get(r.status) || { status: r.status, count: 0, amount: 0 };
    s.count += 1; s.amount += r.estimatedAmount;
    byStatus.set(r.status, s);
    const g = byStage.get(r.stage) || { stage: r.stage, count: 0, amount: 0 };
    g.count += 1; g.amount += r.estimatedAmount;
    byStage.set(r.stage, g);
  });
  const statusOrder = Indent.schema.path('status').enumValues || [];
  const summary = {
    total: rows.length,
    totalAmount: round2(totalAmount),
    totalPoAmount: round2(totalPoAmount),
    byStatus: [...byStatus.values()]
      .map((s) => ({ ...s, amount: round2(s.amount) }))
      .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)),
    byStage: [...byStage.values()]
      .map((s) => ({ ...s, amount: round2(s.amount) }))
      .sort((a, b) => INDENT_STAGES.indexOf(a.stage) - INDENT_STAGES.indexOf(b.stage))
  };

  const total = rows.length;
  const pageRows = all ? rows : rows.slice((page - 1) * limit, page * limit);

  res.json({
    success: true,
    data: {
      rows: pageRows,
      summary,
      stages: INDENT_STAGES,
      statuses: statusOrder,
      pagination: { page: all ? 1 : page, limit: all ? total : limit, total }
    }
  });
}));

/* ------------------------------------------------------------------ */
/* Purchase Orders                                                     */
/* ------------------------------------------------------------------ */

/** Stages, in the order the report shows them */
const PO_STAGES = [
  'Draft',
  'Procurement Approval',
  'Pre-Audit',
  'CEO Office',
  'Finance',
  'Returned for Correction',
  'Approved, Awaiting Delivery',
  'Partially Received',
  'Received',
  'Bill Processing',
  'Rejected',
  'Cancelled'
];

const RETURNED_TEXT = {
  'Returned from Audit': 'Returned by Audit for correction',
  'Returned from CEO Office': 'Returned by CEO Office for correction',
  'Returned from CEO Secretariat': 'Returned by CEO Secretariat for correction',
  'Returned from Finance': 'Returned by Finance for correction'
};

/**
 * Work out where a PO is now, with a short detail line.
 * `recv` = { orderedQty, receivedQty }, `grns` = GRN numbers, `bill` = { billed, paid, bills: [billNumber] }.
 */
const poStage = (po, recv, grns, bill) => {
  const s = po.status;
  const grnText = grns.length ? `GRN ${grns.join(', ')}` : '';
  const billText = bill.bills.length ? `Bill ${bill.bills.join(', ')}` : '';
  const partly = recv.receivedQty > 0 && recv.receivedQty + 0.0001 < recv.orderedQty;
  const fully = recv.orderedQty > 0 && recv.receivedQty + 0.0001 >= recv.orderedQty;
  switch (s) {
    case 'Draft': return { stage: 'Draft', detail: 'Not yet submitted for approval' };
    case 'Pending Approval': return { stage: 'Procurement Approval', detail: 'Waiting for procurement authorities to sign' };
    case 'Pending Audit': return { stage: 'Pre-Audit', detail: 'With Pre-Audit' };
    case 'Forwarded to Audit Director': return { stage: 'Pre-Audit', detail: 'With Audit Director' };
    case 'Send to CEO Office': return { stage: 'CEO Office', detail: 'With CEO Secretariat' };
    case 'Forwarded to CEO': return { stage: 'CEO Office', detail: 'Forwarded to CEO for approval' };
    case 'Pending Finance': return { stage: 'Finance', detail: 'With Finance for approval' };
    case 'Rejected': return { stage: 'Rejected', detail: po.supersededBy ? 'Rejected and re-issued as a new PO' : 'Rejected' };
    case 'Cancelled': return { stage: 'Cancelled', detail: 'Cancelled' };
    case 'Sent to Procurement':
    case 'Sent to Audit':
    case 'Sent to Finance': {
      const who = s.replace('Sent to ', '');
      return { stage: 'Bill Processing', detail: [`Goods received, with ${who} for billing`, grnText, billText].filter(Boolean).join(' · ') };
    }
    default: break;
  }
  if (RETURNED_TEXT[s]) return { stage: 'Returned for Correction', detail: RETURNED_TEXT[s] };
  if (s === 'Received' || s === 'GRN Created' || fully) {
    return { stage: 'Received', detail: [grnText || 'Goods received', billText].filter(Boolean).join(' · ') };
  }
  if (s === 'Partially Received' || partly) {
    const pct = recv.orderedQty ? Math.round((recv.receivedQty / recv.orderedQty) * 100) : 0;
    return { stage: 'Partially Received', detail: [`${pct}% received`, grnText].filter(Boolean).join(' · ') };
  }
  // Approved / Ordered / Sent to Store with nothing received yet
  const due = po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate) : null;
  const overdue = due && due < new Date();
  const where = s === 'Sent to Store' ? 'Sent to Store, waiting for goods' : 'Approved, waiting for goods';
  const dueText = due ? `${overdue ? 'overdue since' : 'due'} ${due.toISOString().slice(0, 10)}` : '';
  return { stage: 'Approved, Awaiting Delivery', detail: [where, dueText].filter(Boolean).join(', ') };
};

/** POs that no longer count towards the "live" PO amount */
const isDeadPo = (status) => DEAD_PO_STATUSES.includes(status);

router.get('/purchase-orders', requireReportAccess, asyncHandler(async (req, res) => {
  const { from, to, status, stage, vendor, department, search } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const all = String(req.query.all).toLowerCase() === 'true';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));

  const filter = {};
  const and = [];
  if (from || to) {
    const range = {};
    if (from) range.$gte = new Date(`${from}T00:00:00.000`);
    if (to) range.$lte = new Date(`${to}T23:59:59.999`);
    and.push({ $or: [{ orderDate: range }, { orderDate: null, createdAt: range }] });
  }
  if (status) filter.status = status;
  if (vendor && mongoose.Types.ObjectId.isValid(vendor)) filter.vendor = vendor;
  if (search && String(search).trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
    const vendorIds = await Supplier.find({ name: rx }).select('_id').limit(200).lean();
    const indentIds = await Indent.find({ indentNumber: rx }).select('_id').limit(200).lean();
    and.push({
      $or: [
        { orderNumber: rx },
        { 'items.description': rx },
        { 'chargeTo.projectName': rx },
        { vendor: { $in: vendorIds.map((v) => v._id) } },
        { indent: { $in: indentIds.map((i) => i._id) } }
      ]
    });
  }
  if (and.length) filter.$and = and;

  const pos = await PurchaseOrder.find(filter)
    .select('orderNumber orderDate createdAt expectedDeliveryDate status vendor indent costCenter chargeTo items.description items.specification items.brand items.productCode items.quantity items.unit items.unitPrice items.taxRate items.discount items.amount items.receivedQuantity items.budgetCategory subtotal taxAmount totalAmount supersededBy priority')
    .populate('vendor', 'name')
    .populate({ path: 'indent', select: 'indentNumber department', populate: { path: 'department', select: 'name' } })
    .populate('costCenter', 'name code')
    .sort({ orderDate: -1, createdAt: -1 })
    .lean();

  let list = pos;
  if (department && mongoose.Types.ObjectId.isValid(department)) {
    list = list.filter((po) => String(po.indent?.department?._id || '') === String(department));
  }

  const ids = list.map((po) => po._id);
  const [grnList, billList] = await Promise.all([
    ids.length ? GoodsReceive.find({ purchaseOrder: { $in: ids } }).select('purchaseOrder receiveNumber').sort({ receiveDate: 1 }).lean() : [],
    ids.length ? AccountsPayable.find({ 'linkedGRNs.poId': { $in: ids }, status: { $ne: 'cancelled' } })
      .select('billNumber linkedGRNs amountPaid advanceApplied status')
      .lean() : []
  ]);

  const grnsByPo = new Map();
  grnList.forEach((g) => {
    const key = String(g.purchaseOrder);
    if (!grnsByPo.has(key)) grnsByPo.set(key, []);
    if (g.receiveNumber) grnsByPo.get(key).push(g.receiveNumber);
  });

  // A bill can cover several POs: split its paid amount by each PO's share of the bill
  const billByPo = new Map();
  billList.forEach((b) => {
    const links = (b.linkedGRNs || []).filter((l) => l.poId);
    const linkedTotal = links.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const settled = (Number(b.amountPaid) || 0) + (Number(b.advanceApplied) || 0);
    links.forEach((l) => {
      const key = String(l.poId);
      const cur = billByPo.get(key) || { billed: 0, paid: 0, bills: [] };
      const amount = Number(l.amount) || 0;
      cur.billed += amount;
      cur.paid += linkedTotal > 0 ? settled * (amount / linkedTotal) : 0;
      if (b.billNumber && !cur.bills.includes(b.billNumber)) cur.bills.push(b.billNumber);
      billByPo.set(key, cur);
    });
  });

  let rows = list.map((po) => {
    const key = String(po._id);
    const items = po.items || [];
    const recv = items.reduce((acc, it) => {
      const qty = Number(it.quantity) || 0;
      const got = Math.min(qty, Number(it.receivedQuantity) || 0);
      acc.orderedQty += qty;
      acc.receivedQty += got;
      acc.receivedValue += got * (Number(it.unitPrice) || 0);
      return acc;
    }, { orderedQty: 0, receivedQty: 0, receivedValue: 0 });
    const grns = grnsByPo.get(key) || [];
    const bill = billByPo.get(key) || { billed: 0, paid: 0, bills: [] };
    const { stage: stageName, detail } = poStage(po, recv, grns, bill);
    return {
      _id: po._id,
      orderNumber: po.orderNumber || '',
      date: po.orderDate || po.createdAt,
      expectedDeliveryDate: po.expectedDeliveryDate || null,
      vendor: po.vendor?.name || '',
      vendorId: po.vendor?._id || null,
      indentNumber: po.indent?.indentNumber || '',
      indentId: po.indent?._id || null,
      department: po.indent?.department?.name || '',
      project: [po.chargeTo?.projectName, po.chargeTo?.subProjectName].filter(Boolean).join(' / '),
      costCenter: po.costCenter ? [po.costCenter.code, po.costCenter.name].filter(Boolean).join(' - ') : '',
      itemCount: items.length,
      items: items.map((it, idx) => {
        const qty = Number(it.quantity) || 0;
        const got = Number(it.receivedQuantity) || 0;
        return {
          line: idx + 1,
          description: it.description || '',
          specification: it.specification || '',
          brand: it.brand || '',
          productCode: it.productCode || '',
          quantity: qty,
          unit: it.unit || '',
          unitPrice: round2(it.unitPrice),
          taxRate: Number(it.taxRate) || 0,
          discount: round2(it.discount),
          amount: round2(it.amount),
          receivedQuantity: round2(got),
          pendingQuantity: round2(Math.max(0, qty - got)),
          budgetCategory: it.budgetCategory || ''
        };
      }),
      subtotal: round2(po.subtotal),
      taxAmount: round2(po.taxAmount),
      totalAmount: round2(po.totalAmount),
      receivedPercent: recv.orderedQty ? Math.round((recv.receivedQty / recv.orderedQty) * 100) : 0,
      receivedValue: round2(recv.receivedValue),
      grnNumbers: grns.join(', '),
      billedAmount: round2(bill.billed),
      paidAmount: round2(bill.paid),
      billNumbers: bill.bills.join(', '),
      status: po.status,
      stage: stageName,
      stageDetail: detail,
      live: !isDeadPo(po.status)
    };
  });

  if (stage) rows = rows.filter((r) => r.stage === stage);

  // Summary over the whole filtered set (not just this page)
  const byStatus = new Map();
  const byStage = new Map();
  const totals = { totalAmount: 0, liveAmount: 0, liveCount: 0, receivedValue: 0, billedAmount: 0, paidAmount: 0 };
  rows.forEach((r) => {
    totals.totalAmount += r.totalAmount;
    if (r.live) { totals.liveAmount += r.totalAmount; totals.liveCount += 1; }
    totals.receivedValue += r.receivedValue;
    totals.billedAmount += r.billedAmount;
    totals.paidAmount += r.paidAmount;
    const st = byStatus.get(r.status) || { status: r.status, count: 0, amount: 0 };
    st.count += 1; st.amount += r.totalAmount;
    byStatus.set(r.status, st);
    const g = byStage.get(r.stage) || { stage: r.stage, count: 0, amount: 0 };
    g.count += 1; g.amount += r.totalAmount;
    byStage.set(r.stage, g);
  });
  const statusOrder = PurchaseOrder.schema.path('status').enumValues || [];
  const summary = {
    total: rows.length,
    liveCount: totals.liveCount,
    totalAmount: round2(totals.totalAmount),
    liveAmount: round2(totals.liveAmount),
    receivedValue: round2(totals.receivedValue),
    billedAmount: round2(totals.billedAmount),
    paidAmount: round2(totals.paidAmount),
    byStatus: [...byStatus.values()]
      .map((x) => ({ ...x, amount: round2(x.amount) }))
      .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)),
    byStage: [...byStage.values()]
      .map((x) => ({ ...x, amount: round2(x.amount) }))
      .sort((a, b) => PO_STAGES.indexOf(a.stage) - PO_STAGES.indexOf(b.stage))
  };

  const total = rows.length;
  const pageRows = all ? rows : rows.slice((page - 1) * limit, page * limit);

  res.json({
    success: true,
    data: {
      rows: pageRows,
      summary,
      stages: PO_STAGES,
      statuses: statusOrder,
      pagination: { page: all ? 1 : page, limit: all ? total : limit, total }
    }
  });
}));

module.exports = router;
module.exports.indentStage = indentStage;
module.exports.poStage = poStage;
