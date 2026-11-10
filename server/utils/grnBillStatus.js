/**
 * GRN ↔ Vendor Bill status helpers.
 *
 * A bill being rejected by Audit is a paperwork/financial event: it never moves stock.
 * These helpers only expose the bill's state on the GRN side and keep the GRN's
 * billed amount in step when a bill is voided.
 */
const AccountsPayable = require('../models/finance/AccountsPayable');
const GoodsReceive = require('../models/procurement/GoodsReceive');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Latest audit rejection on a bill: reason, when, by whom, and its open observations. */
function auditReturnInfo(bill) {
  if (!bill || bill.status !== 'Returned from Audit') return null;
  const history = Array.isArray(bill.workflowHistory) ? bill.workflowHistory : [];
  let entry = null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const h = history[i];
    if (h && h.toStatus === 'Returned from Audit' && /^Rejected with observations:/i.test(String(h.comments || ''))) {
      entry = h;
      break;
    }
  }
  if (!entry) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i] && history[i].toStatus === 'Returned from Audit') { entry = history[i]; break; }
    }
  }
  const by = entry?.changedBy;
  const byName = by && typeof by === 'object' && (by.firstName || by.lastName)
    ? `${by.firstName || ''} ${by.lastName || ''}`.trim()
    : '';
  const observations = (Array.isArray(bill.observations) ? bill.observations : [])
    .filter((o) => o && !o.resolved && o.observation)
    .map((o) => ({ observation: o.observation, severity: o.severity || 'medium', addedAt: o.addedAt }));
  return {
    reason: String(entry?.comments || '').replace(/^Rejected with observations:\s*/i, '') || 'Returned by Audit',
    returnedAt: entry?.changedAt || bill.updatedAt || null,
    returnedBy: byName,
    observations
  };
}

/** Short shape of a bill for GRN-side screens. */
function summarizeBill(bill) {
  return {
    _id: bill._id,
    billNumber: bill.billNumber,
    vendorInvoiceNumber: bill.vendorInvoiceNumber || '',
    status: bill.status,
    totalAmount: round2(bill.totalAmount),
    voidedAt: bill.voidedAt || null,
    voidReason: bill.voidReason || '',
    auditReturn: auditReturnInfo(bill)
  };
}

/** Bills linked to any of these GRNs (voided ones included, so the GRN shows them), grouped by GRN id. */
async function billsByGrn(grnIds) {
  const ids = (grnIds || []).filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;
  const bills = await AccountsPayable.find({
    $or: [
      { 'linkedGRNs.grnId': { $in: ids } },
      { referenceType: 'grn', referenceId: { $in: ids } }
    ]
  })
    .select('billNumber vendorInvoiceNumber status totalAmount linkedGRNs referenceId referenceType workflowHistory observations voidedAt voidReason updatedAt createdAt')
    .populate('workflowHistory.changedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean();
  const idSet = new Set(ids.map(String));
  for (const b of bills) {
    const linked = new Set((b.linkedGRNs || []).map((l) => String(l.grnId)));
    if (b.referenceType === 'grn' && b.referenceId) linked.add(String(b.referenceId));
    for (const gid of linked) {
      if (!idSet.has(gid)) continue;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid).push(summarizeBill(b));
    }
  }
  return map;
}

/**
 * A voided bill no longer bills its GRNs: give each linked GRN its amount back so
 * the GRN shows up again under Unbilled GRNs and can be billed correctly.
 */
async function releaseGrnBilling(bill) {
  const links = Array.isArray(bill?.linkedGRNs) ? bill.linkedGRNs : [];
  for (const l of links) {
    if (!l?.grnId) continue;
    const grn = await GoodsReceive.findById(l.grnId).select('billedAmount netAmount total returnedAmount vendorBill').lean();
    if (!grn) continue;
    const total = round2((Number(grn.netAmount || grn.total) || 0) - (Number(grn.returnedAmount) || 0));
    const nextBilled = Math.max(0, round2((Number(grn.billedAmount) || 0) - (Number(l.amount) || 0)));
    const set = {
      billedAmount: nextBilled,
      billingStatus: nextBilled <= 0.009 ? 'nothing_to_bill' : (total - nextBilled <= 0.009 ? 'fully_billed' : 'waiting_bills')
    };
    const update = { $set: set };
    if (String(grn.vendorBill || '') === String(bill._id)) {
      update.$unset = { vendorBill: '', vendorBillNumber: '' };
    }
    await GoodsReceive.updateOne({ _id: grn._id }, update);
  }
}

module.exports = { auditReturnInfo, summarizeBill, billsByGrn, releaseGrnBilling };
