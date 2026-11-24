/**
 * Reject a submitted GRN from Procurement → GRN's & Bills → Unbilled GRNs.
 *
 * The GRN goes back to Store (status "Returned") with the reviewer's observation, and every
 * posting it made is undone so Store can correct it and submit again:
 *  - stock          → OUT on the item card, store quant and stock ledger
 *  - GRN journal    → each posted GRN journal (and developer corrections) reversed
 *  - PO             → received quantities taken back; status reopened
 *  - delivery chall.→ received quantities taken back; challan reopened (qa_passed)
 * Blocked when the GRN is billed (even partly), has goods returned to the vendor, or its goods
 * were already issued out of the store.
 */
const GoodsReceive = require('../models/procurement/GoodsReceive');
const Inventory = require('../models/procurement/Inventory');
const StockQuant = require('../models/procurement/StockQuant');
const StockTransaction = require('../models/procurement/StockTransaction');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const DeliveryChallan = require('../models/procurement/DeliveryChallan');
const AccountsPayable = require('../models/finance/AccountsPayable');
const JournalEntry = require('../models/finance/JournalEntry');
const FinanceHelper = require('./financeHelper');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

class GrnRejectError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

const POSTED_STATUSES = ['Received', 'Complete', 'Partial'];

async function rejectGrn({ grnId, observation, userId, matchPoLine }) {
  const text = String(observation || '').trim();
  if (text.length < 5) throw new GrnRejectError('Write the observation (why the GRN is rejected) — Store will see it');

  const grn = await GoodsReceive.findById(grnId).lean();
  if (!grn) throw new GrnRejectError('GRN not found', 404);
  if (!POSTED_STATUSES.includes(grn.status)) {
    throw new GrnRejectError(`GRN ${grn.receiveNumber} is ${grn.status} — only a submitted GRN can be rejected`);
  }

  // ── Guards ──
  if ((Number(grn.billedAmount) || 0) > 0.009 || grn.billingStatus === 'fully_billed') {
    throw new GrnRejectError(`GRN ${grn.receiveNumber} is already billed — void the bill first`);
  }
  const bills = await AccountsPayable.find({
    status: { $ne: 'cancelled' },
    $or: [{ 'linkedGRNs.grnId': grn._id }, { referenceType: 'grn', referenceId: grn._id }]
  }).select('billNumber status').lean();
  if (bills.length) {
    throw new GrnRejectError(`GRN ${grn.receiveNumber} is on bill ${bills.map((b) => b.billNumber).join(', ')} — void the bill first`);
  }
  if ((Number(grn.returnedAmount) || 0) > 0.009 || (grn.returnStatus && grn.returnStatus !== 'none')) {
    throw new GrnRejectError(`Goods on GRN ${grn.receiveNumber} were returned to the vendor — it can't be rejected`);
  }

  const projectId = grn.project?._id || grn.project || null;
  const grnStore = grn.store?._id || grn.store || null;
  const plan = []; // stock to take back, per line
  for (let i = 0; i < (grn.items || []).length; i += 1) {
    const line = grn.items[i];
    const qty = round3(line.acceptedQuantity != null ? line.acceptedQuantity : line.quantity);
    const invId = line.inventoryItem?._id || line.inventoryItem;
    if (!(qty > 0) || !invId) continue;
    const label = line.itemName || line.itemCode || `Line ${i + 1}`;
    const storeId = line.subStore?._id || line.subStore || grnStore;
    const inv = await Inventory.findById(invId).select('quantity name').lean();
    if (!inv) continue;
    const quant = storeId && projectId
      ? await StockQuant.findOne({ store: storeId, project: projectId, item: invId }).select('onHandQuantity').lean()
      : null;
    const onHand = Math.min(Number(inv.quantity) || 0, quant ? Number(quant.onHandQuantity) || 0 : Infinity);
    if (qty - onHand > 0.0005) {
      throw new GrnRejectError(`${label}: only ${round3(onHand)} of ${qty} still in the store — the rest was already issued, so GRN ${grn.receiveNumber} can't be rejected`);
    }
    plan.push({ idx: i, line, qty, invId, storeId, label, hasQuant: !!quant });
  }

  const rejectNo = (grn.rejectionHistory || []).length + 1;
  const ref = `${grn.receiveNumber}-REJ${rejectNo}`;
  const note = `GRN ${grn.receiveNumber} rejected: ${text}`.slice(0, 250);

  // ── 1. Journals (GRN posting + any developer corrections) ──
  const journals = await JournalEntry.find({
    referenceType: 'grn',
    referenceId: grn._id,
    status: 'posted',
    isReversed: { $ne: true }
  });
  const reversals = [];
  for (const je of journals) {
    const rev = await FinanceHelper.reverseJournalEntry(je, { reason: `${note}`.slice(0, 250), createdBy: userId });
    reversals.push(rev._id);
  }

  // ── 2. Stock ──
  for (const p of plan) {
    const inv = await Inventory.findById(p.invId);
    await inv.removeStock(p.qty, ref, note, userId);
    if (p.storeId && projectId && p.hasQuant) {
      try { await StockQuant.deductStock(p.storeId, projectId, inv._id, p.qty); } catch (e) { console.warn('[GRN reject] quant:', e.message); }
    }
    if (p.storeId) {
      const balance = await StockTransaction.getBalance(p.storeId, projectId, inv._id);
      await StockTransaction.create({
        store: p.storeId,
        storeSnapshot: grn.storeSnapshot || inv.storeSnapshot || 'Main Store',
        project: projectId,
        item: inv._id,
        itemCode: inv.itemCode,
        itemName: inv.name,
        transactionType: 'OUT',
        quantity: -p.qty,
        unit: inv.unit,
        unitPrice: Number(p.line.unitPrice) || 0,
        referenceType: 'ADJUSTMENT',
        referenceId: grn._id,
        referenceNumber: ref,
        balanceAfter: balance - p.qty,
        location: { rack: p.line.location?.rack || '', shelf: p.line.location?.shelf || '', bin: p.line.location?.bin || '' },
        description: note,
        createdBy: userId
      });
    }
  }

  // ── 3. PO received quantities ──
  const poId = grn.purchaseOrder?._id || grn.purchaseOrder;
  const qtyByPoLine = {};
  if (poId) {
    const po = await PurchaseOrder.findById(poId);
    if (po?.items?.length) {
      const prevStatus = po.status;
      (grn.items || []).forEach((line, i) => {
        const q = round2(line.quantity);
        if (!(q > 0)) return;
        const j = matchPoLine(po.items, line, i);
        if (j < 0) return;
        po.items[j].receivedQuantity = Math.max(0, round2((Number(po.items[j].receivedQuantity) || 0) - q));
        qtyByPoLine[j] = round2((qtyByPoLine[j] || 0) + q);
      });
      const anyReceived = po.items.some((it) => (Number(it.receivedQuantity) || 0) > 0);
      if (anyReceived) {
        po.updateReceivingStatus();
      } else {
        // Nothing received any more: back to the status the PO had before its first GRN
        const firstApply = (po.workflowHistory || []).find((h) => /quantities applied to PO/.test(h.comments || ''));
        po.status = firstApply?.fromStatus && !['Received', 'Partially Received'].includes(firstApply.fromStatus)
          ? firstApply.fromStatus
          : 'Sent to Store';
      }
      po.workflowHistory = po.workflowHistory || [];
      po.workflowHistory.push({
        fromStatus: prevStatus,
        toStatus: po.status,
        changedBy: userId,
        changedAt: new Date(),
        comments: `GRN ${grn.receiveNumber} rejected — quantities taken back: ${text}`.slice(0, 500),
        module: 'Store'
      });
      po.updatedBy = userId;
      await po.save();
    }
  }

  // ── 4. Delivery challan ──
  const dcId = grn.deliveryChallan?._id || grn.deliveryChallan;
  if (dcId && Object.keys(qtyByPoLine).length) {
    const dc = await DeliveryChallan.findById(dcId);
    if (dc) {
      for (const jStr of Object.keys(qtyByPoLine)) {
        let rem = qtyByPoLine[jStr];
        const lines = (dc.items || []).filter((it) => Number(it.poLineIndex) === Number(jStr)).reverse();
        for (const it of lines) {
          if (rem <= 0) break;
          const take = Math.min(rem, Number(it.quantityReceived) || 0);
          it.quantityReceived = round2((Number(it.quantityReceived) || 0) - take);
          rem = round2(rem - take);
        }
      }
      dc.grnIds = (dc.grnIds || []).filter((x) => String(x) !== String(grn._id));
      if (dc.status === 'closed') dc.status = 'qa_passed';
      dc.updatedBy = userId;
      await dc.save();
    }
  }

  // ── 5. GRN back to Store (plain update — post-save would re-sync stock) ──
  const now = new Date();
  await GoodsReceive.updateOne({ _id: grn._id }, {
    $set: {
      status: 'Returned',
      billingStatus: 'nothing_to_bill',
      lastRejectedAt: now,
      procurementReturn: { active: true, observation: text, returnedBy: userId, returnedAt: now, reference: ref }
    },
    $push: {
      rejectionHistory: { observation: text, returnedBy: userId, returnedAt: now, fromStatus: grn.status, reference: ref, reversalEntries: reversals },
      workflowHistory: { fromStatus: grn.status, toStatus: 'Returned', changedBy: userId, changedAt: now, comments: `Rejected from GRN's & Bills: ${text}` }
    }
  });

  return { receiveNumber: grn.receiveNumber, reference: ref, journalsReversed: reversals.length, linesReversed: plan.length, purchaseOrder: poId };
}

module.exports = { rejectGrn, GrnRejectError };
