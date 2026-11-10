/**
 * Developer-only GRN correction (an audited data fix, not the normal flow).
 *
 * Normal corrections go through Return to Vendor. This exists for data mistakes, and keeps
 * every ledger in step with the change:
 *  - quantity up/down  → stock adjustment on the item card, store quant and stock ledger (ADJUSTMENT)
 *  - value up/down     → journal Inventory ↔ GRNI for the difference; item average cost revalued
 *  - PO received qty   → adjusted by the same quantity difference
 *  - every change      → GRN editHistory (who, when, why, old → new, journal)
 * Blocked while a bill is active on the GRN (void it first), below already-returned quantity,
 * or below what is still in stock (issued goods can't be un-received).
 */
const GoodsReceive = require('../models/procurement/GoodsReceive');
const Inventory = require('../models/procurement/Inventory');
const StockQuant = require('../models/procurement/StockQuant');
const StockTransaction = require('../models/procurement/StockTransaction');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const AccountsPayable = require('../models/finance/AccountsPayable');
const FinanceHelper = require('./financeHelper');
const { resolveDocumentCompanyId } = require('./financeCompanyContext');
const { withCompany } = require('./financePosting');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

class GrnEditError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

const HEADER_FIELDS = ['receiveDate', 'notes', 'narration', 'observation', 'gatePassNo'];
const sameDate = (a, b) => (a ? new Date(a).toISOString().slice(0, 10) : '') === (b ? new Date(b).toISOString().slice(0, 10) : '');
const locStr = (l) => [l?.rack, l?.shelf, l?.bin].map((x) => x || '').join('/');

async function developerEditGrn({ grnId, body, userId, matchPoLine, newAttachments = [] }) {
  const reason = String(body?.reason || '').trim();
  if (reason.length < 5) throw new GrnEditError('Give a reason for this correction (it is kept in the GRN history)');

  const grn = await GoodsReceive.findById(grnId).lean();
  if (!grn) throw new GrnEditError('GRN not found', 404);
  const projectId = grn.project?._id || grn.project || null;
  const changes = [];
  const set = {};

  // ── Header fields (no ledger effect) ──
  for (const f of HEADER_FIELDS) {
    if (body[f] === undefined) continue;
    const next = f === 'receiveDate' ? (body[f] ? new Date(body[f]) : grn[f]) : String(body[f] ?? '');
    const same = f === 'receiveDate' ? sameDate(next, grn[f]) : String(grn[f] ?? '') === next;
    if (same) continue;
    changes.push({ field: f, from: f === 'receiveDate' ? (grn[f] ? new Date(grn[f]).toISOString().slice(0, 10) : '') : String(grn[f] ?? ''), to: f === 'receiveDate' ? next.toISOString().slice(0, 10) : next });
    set[f] = next;
  }

  // ── Lines ──
  const items = (grn.items || []).map((l) => ({ ...l }));
  const reqLines = new Map((Array.isArray(body.items) ? body.items : []).map((x) => [String(x._id), x]));
  const moves = []; // { line, idx, qtyDelta, valueDelta, oldQty, newQty, oldPrice, newPrice }
  let linesTouched = false; // location / notes / qty / rate changed on some line
  for (let i = 0; i < items.length; i += 1) {
    const line = items[i];
    const r = reqLines.get(String(line._id));
    if (!r) continue;
    const label = line.itemName || line.itemCode || `Line ${i + 1}`;
    const oldQty = round3(line.quantity);
    const oldPrice = round2(line.unitPrice);
    const newQty = r.quantity !== undefined && r.quantity !== '' ? round3(r.quantity) : oldQty;
    const newPrice = r.unitPrice !== undefined && r.unitPrice !== '' ? round2(r.unitPrice) : oldPrice;
    if (!(newQty >= 0) || !(newPrice >= 0)) throw new GrnEditError(`${label}: quantity and rate must be zero or more`);

    if (r.location && locStr(r.location) !== locStr(line.location)) {
      changes.push({ field: 'location', line: label, from: locStr(line.location), to: locStr(r.location) });
      line.location = { rack: r.location.rack || '', shelf: r.location.shelf || '', bin: r.location.bin || '' };
      linesTouched = true;
    }
    if (r.notes !== undefined && String(r.notes) !== String(line.notes || '')) {
      changes.push({ field: 'notes', line: label, from: line.notes || '', to: String(r.notes) });
      line.notes = String(r.notes);
      linesTouched = true;
    }

    if (newQty === oldQty && newPrice === oldPrice) continue;
    if (line.acceptedQuantity != null && round3(line.acceptedQuantity) !== oldQty) {
      throw new GrnEditError(`${label}: this line has a QC accepted/rejected split — correct it through QC, not here`);
    }
    const returned = round3(line.returnedQuantity);
    if (newQty < returned) throw new GrnEditError(`${label}: ${returned} already returned to the vendor — quantity can't go below that`);
    const invId = line.inventoryItem?._id || line.inventoryItem;
    if (!invId) throw new GrnEditError(`${label}: line is not linked to a stock item — sync the GRN to inventory first`);

    const qtyDelta = round3(newQty - oldQty);
    const invNow = await Inventory.findById(invId).select('quantity').lean();
    const lineStore = line.subStore?._id || line.subStore || grn.store?._id || grn.store;
    const quantNow = lineStore && projectId ? await StockQuant.findOne({ store: lineStore, project: projectId, item: invId }).select('onHandQuantity').lean() : null;
    const onHand = Math.max(0, Math.min(Number(invNow?.quantity) || 0, quantNow ? Number(quantNow.onHandQuantity) : Infinity));
    // Units of this GRN line still in the store (the rest were issued or returned)
    const onHandFromLine = round3(Math.min(onHand, Math.max(0, oldQty - returned)));
    if (qtyDelta < 0) {
      if (-qtyDelta - onHand > 0.0005) {
        throw new GrnEditError(`${label}: only ${round3(onHand)} still in stock — the rest was already issued, so the GRN can't be reduced by ${-qtyDelta}`);
      }
    }
    const valueDelta = round2(newQty * newPrice - oldQty * oldPrice);
    if (qtyDelta !== 0) changes.push({ field: 'quantity', line: label, from: String(oldQty), to: String(newQty) });
    if (newPrice !== oldPrice) changes.push({ field: 'unitPrice', line: label, from: String(oldPrice), to: String(newPrice) });
    line.quantity = newQty;
    if (line.acceptedQuantity != null) line.acceptedQuantity = newQty;
    line.unitPrice = newPrice;
    line.valueExcludingSalesTax = round2(newQty * newPrice);
    // Value split: the quantity change at the new rate, plus a rate correction on the units already received.
    // Of that rate correction, only units still on hand stay in Inventory; issued/returned units go to COGS.
    const rateDiff = round2(valueDelta - qtyDelta * newPrice);
    const inventoryRevalue = round2(onHandFromLine * (newPrice - oldPrice));
    const cogsShare = round2(rateDiff - inventoryRevalue);
    moves.push({ line, idx: i, invId, label, qtyDelta, valueDelta, newPrice, inventoryRevalue, cogsShare });
  }

  // ── Attachments (add new files, remove wrong ones) ──
  let attachments = null;
  const removeIds = new Set((Array.isArray(body.removeAttachmentIds) ? body.removeAttachmentIds : []).map(String));
  if (removeIds.size || newAttachments.length) {
    const current = Array.isArray(grn.attachments) ? grn.attachments : [];
    const removed = current.filter((a) => removeIds.has(String(a._id)));
    attachments = current.filter((a) => !removeIds.has(String(a._id))).concat(newAttachments);
    if (removed.length) changes.push({ field: 'attachments', from: removed.map((a) => a.filename).join(', '), to: 'removed' });
    if (newAttachments.length) changes.push({ field: 'attachments', from: '', to: `added ${newAttachments.map((a) => a.filename).join(', ')}` });
  }

  if (!changes.length) return { changed: false, grn };

  // Quantity/value changes would leave an active bill out of step with its GRN
  if (moves.length) {
    const bills = await AccountsPayable.find({
      status: { $ne: 'cancelled' },
      $or: [{ 'linkedGRNs.grnId': grn._id }, { referenceType: 'grn', referenceId: grn._id }]
    }).select('billNumber status').lean();
    if (bills.length) {
      throw new GrnEditError(`GRN is billed on ${bills.map((b) => `${b.billNumber} (${b.status})`).join(', ')}. Void the bill in GRN's & Bills first, correct the GRN, then re-bill.`);
    }
  }

  // ── 1. Journal for the value difference (GRN was DR Inventory / CR GRNI) ──
  let journalEntry = null;
  const editRef = `${grn.receiveNumber}-EDIT${(grn.editHistory || []).length + 1}`;
  if (moves.some((m) => Math.abs(m.valueDelta) > 0.009 || Math.abs(m.cogsShare) > 0.009)) {
    const companyId = await resolveDocumentCompanyId({ grnId: grn._id, purchaseOrderId: grn.purchaseOrder, userId });
    const lines = [];
    for (const m of moves) {
      const inv = await Inventory.findById(m.invId).lean();
      const { inventoryAccountId, grniAccountId, cogsAccountId } = await FinanceHelper.resolveInventoryAccounts(inv, companyId);
      if (!inventoryAccountId || !grniAccountId) throw new GrnEditError(`No Inventory / GRNI account for ${inv?.name || m.label}`);
      const desc = `GRN correction ${editRef} – ${m.label}`;
      const side = (account, amount, what) => {
        const a = round2(amount);
        if (Math.abs(a) <= 0.009) return;
        // positive = debit this account (and credit GRNI), negative = the reverse
        lines.push(a > 0
          ? { account, description: `${desc}${what}`, debit: a, department: 'procurement' }
          : { account, description: `${desc}${what}`, credit: -a, department: 'procurement' });
      };
      const invAmt = round2(m.qtyDelta * m.newPrice + m.inventoryRevalue);
      let cogsAmt = m.cogsShare;
      if (Math.abs(cogsAmt) > 0.009 && !cogsAccountId) {
        throw new GrnEditError(`${m.label}: no COGS account to carry the rate difference on issued units`);
      }
      side(inventoryAccountId, invAmt, '');
      side(cogsAccountId, cogsAmt, ' (rate difference on issued / returned units)');
      side(grniAccountId, -round2(invAmt + cogsAmt), '');
    }
    if (lines.length) journalEntry = await FinanceHelper.createAndPostJournalEntry(withCompany({
      date: new Date(),
      reference: editRef,
      description: `GRN ${grn.receiveNumber} corrected by developer: ${reason}`.slice(0, 250),
      department: 'procurement',
      module: 'procurement',
      referenceId: grn._id,
      referenceType: 'grn',
      journalCode: 'INV',
      createdBy: userId,
      lines
    }, companyId));
  }

  // ── 2. Stock for the quantity difference; average cost for the value difference ──
  for (const m of moves) {
    const inv = await Inventory.findById(m.invId);
    const storeId = m.line.subStore?._id || m.line.subStore || grn.store?._id || grn.store || inv.store?._id || inv.store;
    const note = `GRN ${grn.receiveNumber} corrected (${editRef}): ${reason}`;
    if (m.qtyDelta > 0) {
      await inv.addStock(m.qtyDelta, editRef, note, userId, m.newPrice);
      if (storeId && projectId) await StockQuant.addStockAVCO(storeId, projectId, inv._id, m.qtyDelta, m.newPrice, m.line.location);
    } else if (m.qtyDelta < 0) {
      await inv.removeStock(-m.qtyDelta, editRef, note, userId);
      if (storeId && projectId) {
        try { await StockQuant.deductStock(storeId, projectId, inv._id, -m.qtyDelta); } catch (e) { console.warn('[GRN edit] quant:', e.message); }
      }
    }
    // Rate correction on units still on hand → revalue the item's average cost
    const revalue = m.inventoryRevalue;
    if (Math.abs(revalue) > 0.009) {
      const fresh = await Inventory.findById(inv._id);
      const q = Number(fresh.quantity) || 0;
      if (q > 0) {
        const avg = Number(fresh.averageCost) > 0 ? Number(fresh.averageCost) : Number(fresh.unitPrice) || 0;
        fresh.averageCost = Math.max(0, round2((q * avg + revalue) / q));
        await fresh.save();
      }
    }
    if (m.qtyDelta !== 0 && storeId) {
      const balance = await StockTransaction.getBalance(storeId, projectId, inv._id);
      await StockTransaction.create({
        store: storeId,
        storeSnapshot: grn.storeSnapshot || inv.storeSnapshot || 'Main Store',
        project: projectId,
        item: inv._id,
        itemCode: inv.itemCode,
        itemName: inv.name,
        transactionType: m.qtyDelta > 0 ? 'IN' : 'OUT',
        quantity: m.qtyDelta,
        unit: inv.unit,
        unitPrice: m.newPrice,
        referenceType: 'ADJUSTMENT',
        referenceId: grn._id,
        referenceNumber: editRef,
        balanceAfter: balance + m.qtyDelta,
        location: { rack: m.line.location?.rack || '', shelf: m.line.location?.shelf || '', bin: m.line.location?.bin || '' },
        description: note.slice(0, 250),
        createdBy: userId
      });
    }
  }

  // ── 3. PO received quantities ──
  const poId = grn.purchaseOrder?._id || grn.purchaseOrder;
  if (poId && moves.some((m) => m.qtyDelta !== 0)) {
    const po = await PurchaseOrder.findById(poId);
    if (po?.items?.length) {
      for (const m of moves) {
        if (!m.qtyDelta) continue;
        const j = matchPoLine(po.items, m.line, m.idx);
        if (j < 0) continue;
        po.items[j].receivedQuantity = Math.max(0, round2((Number(po.items[j].receivedQuantity) || 0) + m.qtyDelta));
      }
      po.updateReceivingStatus();
      po.workflowHistory = po.workflowHistory || [];
      po.workflowHistory.push({ fromStatus: po.status, toStatus: po.status, changedBy: userId, changedAt: new Date(), comments: `GRN ${grn.receiveNumber} quantities corrected (${editRef})`, module: 'Store' });
      po.updatedBy = userId;
      await po.save();
    }
  }

  // ── 4. GRN document: lines, totals, history (plain update — post-save would re-sync stock) ──
  // Only what actually changed is written: an attachment-only edit touches attachments + history, nothing else
  if (attachments) set.attachments = attachments;
  if (linesTouched || moves.length) set.items = items;
  if (moves.length) {
    set.totalItems = items.length;
    set.totalQuantity = round3(items.reduce((s, l) => s + (Number(l.quantity) || 0), 0));
    const subtotal = items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
    set.netAmount = round2(subtotal - (Number(grn.discount) || 0) + (Number(grn.otherCharges) || 0));
    set.total = set.netAmount;
    const billable = round2(set.netAmount - (Number(grn.returnedAmount) || 0) - (Number(grn.billedAmount) || 0));
    set.billingStatus = billable <= 0.009 && (Number(grn.billedAmount) || 0) > 0 ? 'fully_billed' : (Number(grn.billedAmount) || 0) > 0 ? 'waiting_bills' : 'nothing_to_bill';
  }
  await GoodsReceive.updateOne({ _id: grn._id }, {
    $set: set,
    $push: { editHistory: { at: new Date(), by: userId, reason, reference: editRef, changes, journalEntry: journalEntry?._id } }
  });

  return { changed: true, editRef, changes, journalEntry: journalEntry ? { _id: journalEntry._id, entryNumber: journalEntry.entryNumber } : null };
}

module.exports = { developerEditGrn, GrnEditError };
