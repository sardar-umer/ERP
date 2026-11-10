/**
 * Return to Vendor (GRN reversal) — the only path that takes received goods back out of stock.
 *
 * Rules (as in SAP/Odoo):
 *  - Only goods physically still in the store can go back: a line can't return more than was
 *    received on that GRN line minus what was already returned, nor more than is on hand.
 *  - A billed GRN can't be returned past its unbilled amount — void (or correct) the bill first,
 *    so the vendor is never billed for goods that went back.
 *  - Posting mirrors the GRN: journal DR GRNI / CR Inventory, then Inventory card, StockQuant
 *    and the stock ledger (OUT, PURCHASE_RETURN), and the GRN line's returned quantity.
 */
const GoodsReceive = require('../models/procurement/GoodsReceive');
const Inventory = require('../models/procurement/Inventory');
const StockQuant = require('../models/procurement/StockQuant');
const StockTransaction = require('../models/procurement/StockTransaction');
const AccountsPayable = require('../models/finance/AccountsPayable');
const FinanceHelper = require('./financeHelper');
const { getPurchaseReturnNarration, withVoucherNarration } = require('./documentNarration');
const { resolveDocumentCompanyId } = require('./financeCompanyContext');
const { withCompany } = require('./financePosting');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

class ReturnError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

/** GRN amount still billable: original value, less goods returned, less what is already billed. */
function grnBillableRemaining(grn) {
  const gross = round2(grn.netAmount || grn.total);
  return round2(gross - (Number(grn.returnedAmount) || 0) - (Number(grn.billedAmount) || 0));
}

function lineStoreId(grn, line) {
  return line.subStore?._id || line.subStore || grn.store?._id || grn.store || null;
}

/** Per-line: received, already returned, still returnable, and what is physically on hand. */
async function returnableLines(grnOrId) {
  const grn = grnOrId && grnOrId.items ? grnOrId : await GoodsReceive.findById(grnOrId).lean();
  if (!grn) throw new ReturnError('GRN not found', 404);
  const projectId = grn.project?._id || grn.project || null;
  const lines = [];
  for (let i = 0; i < (grn.items || []).length; i += 1) {
    const l = grn.items[i];
    const received = round3(l.acceptedQuantity != null ? l.acceptedQuantity : l.quantity);
    const returned = round3(l.returnedQuantity);
    const invId = l.inventoryItem?._id || l.inventoryItem || null;
    let onHand = null;
    if (invId) {
      const storeId = lineStoreId(grn, l);
      const quant = storeId && projectId
        ? await StockQuant.findOne({ store: storeId, project: projectId, item: invId }).select('onHandQuantity').lean()
        : null;
      const inv = await Inventory.findById(invId).select('quantity').lean();
      const candidates = [quant ? Number(quant.onHandQuantity) : null, inv ? Number(inv.quantity) : null].filter((x) => x != null);
      onHand = candidates.length ? round3(Math.min(...candidates)) : 0;
    }
    const returnable = Math.max(0, round3(received - returned));
    lines.push({
      grnItem: l._id,
      lineIndex: i,
      inventoryItem: invId,
      itemCode: l.itemCode || l.productCode || '',
      itemName: l.itemName || '',
      unit: l.unit || '',
      unitPrice: round2(l.unitPrice),
      received,
      returned,
      returnable,
      onHand,
      maxReturn: invId ? Math.max(0, Math.min(returnable, onHand || 0)) : 0,
      blockedReason: !invId
        ? 'Line not linked to a stock item — sync the GRN to inventory first'
        : (returnable > 0 && (onHand || 0) < returnable
          ? `Only ${onHand || 0} in stock — the rest was already issued`
          : '')
    });
  }
  return {
    grnId: grn._id,
    receiveNumber: grn.receiveNumber,
    supplier: grn.supplier?._id || grn.supplier || null,
    supplierName: grn.supplierName || grn.supplier?.name || '',
    purchaseOrder: grn.purchaseOrder?._id || grn.purchaseOrder || null,
    billedAmount: round2(grn.billedAmount),
    returnedAmount: round2(grn.returnedAmount),
    billableRemaining: grnBillableRemaining(grn),
    lines
  };
}

/** Build return items from GRN lines (prices always come from the GRN, never the client). */
async function buildReturnItems(grnId, requested) {
  const info = await returnableLines(grnId);
  const byLine = new Map(info.lines.map((l) => [String(l.grnItem), l]));
  const items = [];
  for (const r of requested || []) {
    const qty = round3(r.quantity);
    if (!(qty > 0)) continue;
    const line = byLine.get(String(r.grnItem || ''));
    if (!line) throw new ReturnError('Each returned item must be a line of the selected GRN');
    items.push({
      grnItem: line.grnItem,
      inventoryItem: line.inventoryItem,
      itemCode: line.itemCode,
      itemName: line.itemName,
      quantity: qty,
      unitPrice: line.unitPrice,
      reason: r.reason || ''
    });
  }
  if (!items.length) throw new ReturnError('Enter a quantity for at least one item');
  return { info, items };
}

/** Check a return against GRN quantities, stock on hand and billing. Throws ReturnError. */
async function validateReturn(grnId, items) {
  const info = await returnableLines(grnId);
  const byLine = new Map(info.lines.map((l) => [String(l.grnItem), l]));
  const perLine = new Map();
  let amount = 0;
  for (const it of items) {
    const line = byLine.get(String(it.grnItem || ''));
    if (!line) throw new ReturnError(`"${it.itemName || 'Item'}" is not a line of GRN ${info.receiveNumber}`);
    const key = String(line.grnItem);
    perLine.set(key, round3((perLine.get(key) || 0) + Number(it.quantity)));
    amount += Number(it.quantity) * line.unitPrice;
  }
  for (const [key, qty] of perLine) {
    const line = byLine.get(key);
    if (!line.inventoryItem) throw new ReturnError(`${line.itemName}: ${line.blockedReason}`);
    if (qty - line.returnable > 0.0005) {
      throw new ReturnError(`${line.itemName}: only ${line.returnable} ${line.unit} can be returned (received ${line.received}, already returned ${line.returned})`);
    }
    if (qty - (line.onHand || 0) > 0.0005) {
      throw new ReturnError(`${line.itemName}: only ${line.onHand || 0} ${line.unit} is still in stock — the rest was already issued. Get it back into the store (Store Return) before returning it to the vendor.`);
    }
  }
  amount = round2(amount);
  const unbilled = round2(info.billableRemaining);
  if (amount - unbilled > 0.01) {
    const bills = await AccountsPayable.find({ 'linkedGRNs.grnId': info.grnId, status: { $ne: 'cancelled' } })
      .select('billNumber status').lean();
    const names = bills.map((b) => `${b.billNumber} (${b.status})`).join(', ');
    throw new ReturnError(
      `GRN ${info.receiveNumber} is already billed${names ? ` on ${names}` : ''}. Only PKR ${unbilled} is unbilled but this return is PKR ${amount}. Void the bill in GRN's & Bills first, then return the goods and re-bill the rest.`
    );
  }
  return { info, amount };
}

/** Post a draft purchase return: journal, stock out, GRN returned quantities. */
async function postPurchaseReturn(pr, userId) {
  if (pr.status !== 'draft') throw new ReturnError('Return is already posted');
  if (!pr.goodsReceive) throw new ReturnError('Return has no GRN');
  const grnId = pr.goodsReceive._id || pr.goodsReceive;
  const { amount } = await validateReturn(grnId, pr.items);
  const grn = await GoodsReceive.findById(grnId);
  const projectId = grn.project?._id || grn.project || null;

  // 1. Journal first — if it can't post, nothing moves (GRN was DR Inventory / CR GRNI)
  const companyId = await resolveDocumentCompanyId({ grnId, purchaseOrderId: pr.purchaseOrder || grn.purchaseOrder, userId });
  const journalLines = [];
  for (const item of pr.items) {
    const inv = await Inventory.findById(item.inventoryItem).lean();
    if (!inv) throw new ReturnError(`Stock item for ${item.itemName} not found`);
    const { inventoryAccountId, grniAccountId } = await FinanceHelper.resolveInventoryAccounts(inv, companyId);
    const lineAmt = round2(item.quantity * item.unitPrice);
    if (!(lineAmt > 0)) continue;
    if (!inventoryAccountId || !grniAccountId) {
      throw new ReturnError(`No Inventory / GRNI account for ${inv.name} — set it on the item or its category first`);
    }
    journalLines.push(
      { account: grniAccountId, description: `Return – ${item.itemName || inv.name} (${pr.returnNumber})`, debit: lineAmt, department: 'procurement' },
      { account: inventoryAccountId, description: `Stock reduction – ${item.itemName || inv.name}`, credit: lineAmt, department: 'procurement' }
    );
  }
  let journalEntry = null;
  if (journalLines.length) {
    journalEntry = await FinanceHelper.createAndPostJournalEntry(
      withVoucherNarration(withCompany({
        date: pr.returnDate || new Date(),
        reference: pr.returnNumber,
        description: `Purchase Return ${pr.returnNumber} against GRN ${grn.receiveNumber}`,
        department: 'procurement',
        module: 'procurement',
        referenceId: pr._id,
        referenceType: 'purchase_return',
        journalCode: 'INV',
        createdBy: userId,
        lines: journalLines
      }, companyId), getPurchaseReturnNarration(pr))
    );
  }

  // 2. Stock out: inventory card, store quant, stock ledger
  for (const item of pr.items) {
    const inv = await Inventory.findById(item.inventoryItem);
    const line = grn.items.id(item.grnItem);
    const qty = Number(item.quantity);
    await inv.removeStock(qty, pr.returnNumber, `Returned to vendor via ${pr.returnNumber} (GRN ${grn.receiveNumber})`, userId);
    const storeId = lineStoreId(grn, line || {}) || inv.store?._id || inv.store || null;
    if (storeId && projectId) {
      try {
        await StockQuant.deductStock(storeId, projectId, inv._id, qty);
      } catch (sqErr) {
        console.warn('[PurchaseReturn] StockQuant deduct:', sqErr.message);
      }
    }
    if (storeId) {
      const balance = await StockTransaction.getBalance(storeId, projectId, inv._id);
      await StockTransaction.create({
        store: storeId,
        storeSnapshot: grn.storeSnapshot || inv.storeSnapshot || 'Main Store',
        project: projectId,
        item: inv._id,
        itemCode: inv.itemCode,
        itemName: inv.name,
        transactionType: 'OUT',
        quantity: -qty,
        unit: inv.unit,
        unitPrice: Number(item.unitPrice) || 0,
        referenceType: 'PURCHASE_RETURN',
        referenceId: pr._id,
        referenceNumber: pr.returnNumber,
        balanceAfter: balance - qty,
        location: { rack: line?.location?.rack || '', shelf: line?.location?.shelf || '', bin: line?.location?.bin || '' },
        description: `Returned to vendor via ${pr.returnNumber} (GRN ${grn.receiveNumber})`,
        createdBy: userId
      });
    }
    if (line) line.returnedQuantity = round3((Number(line.returnedQuantity) || 0) + qty);
  }

  // 3. GRN: returned value and status (amount no longer billable)
  grn.returnedAmount = round2((Number(grn.returnedAmount) || 0) + amount);
  const allBack = grn.items.every((l) => {
    const rec = Number(l.acceptedQuantity != null ? l.acceptedQuantity : l.quantity) || 0;
    return rec <= 0 || (Number(l.returnedQuantity) || 0) >= rec - 0.0005;
  });
  grn.returnStatus = allBack ? 'full' : 'partial';
  const remaining = grnBillableRemaining(grn);
  if (remaining <= 0.009 && (Number(grn.billedAmount) || 0) > 0) grn.billingStatus = 'fully_billed';
  else if (remaining <= 0.009) grn.billingStatus = 'nothing_to_bill';
  grn.returnHistory = Array.isArray(grn.returnHistory) ? grn.returnHistory : [];
  grn.returnHistory.push({ purchaseReturn: pr._id, returnNumber: pr.returnNumber, amount, at: new Date(), by: userId });
  // Plain update: GRN post-save would try to re-sync stock
  await GoodsReceive.updateOne({ _id: grn._id }, {
    $set: {
      items: grn.items.map((l) => (l.toObject ? l.toObject() : l)),
      returnedAmount: grn.returnedAmount,
      returnStatus: grn.returnStatus,
      billingStatus: grn.billingStatus,
      returnHistory: grn.returnHistory
    }
  });

  pr.status = 'posted';
  pr.journalEntry = journalEntry?._id;
  pr.confirmedBy = userId;
  pr.confirmedAt = new Date();
  await pr.save();
  return pr;
}

module.exports = { ReturnError, returnableLines, buildReturnItems, validateReturn, postPurchaseReturn, grnBillableRemaining };
