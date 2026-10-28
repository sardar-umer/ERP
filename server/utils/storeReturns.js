const mongoose = require('mongoose');

/**
 * Store Return Notes and SIN cancellation.
 * A return brings issued items back: item total + store/project ledger IN, and DR Inventory / CR COGS at the
 * SIN's own issue cost (only where the SIN's COGS was actually posted, so nothing is reversed twice or invented).
 * Customer SIN qty already billed on an AR invoice cannot come back until that invoice is cancelled / credited.
 *
 * Never call GoodsIssue#save() here — its post-save hook issues stock again. Use updateOne.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const invoicedQtyBySinItem = async (sinId) => {
  const AccountsReceivable = mongoose.model('AccountsReceivable');
  const rows = await AccountsReceivable.aggregate([
    { $match: { 'lineItems.sourceSin': sinId, status: { $ne: 'cancelled' } } },
    { $unwind: '$lineItems' },
    { $match: { 'lineItems.sourceSin': sinId } },
    { $group: { _id: '$lineItems.inventoryItem', qty: { $sum: '$lineItems.quantity' } } }
  ]);
  return new Map(rows.map((r) => [String(r._id), r.qty]));
};

/** Per inventory item on the SIN: issued, returned, invoiced, returnable, issue cost */
const sinReturnableLines = async (sin) => {
  const Inventory = mongoose.model('Inventory');
  const invoiced = sin.issueType === 'customer' ? await invoicedQtyBySinItem(sin._id) : new Map();
  const postedCost = new Map((sin.financePosting || [])
    .filter((p) => p.status === 'posted' && Number(p.qty) > 0)
    .map((p) => [String(p.inventoryItem), Number(p.amount) / Number(p.qty)]));
  const byItem = new Map();
  (sin.items || []).forEach((it) => {
    const id = String(it.inventoryItem?._id || it.inventoryItem);
    const row = byItem.get(id) || { inventoryItem: id, itemCode: it.itemCode, itemName: it.itemName, unit: it.unit, qtyIssued: 0, qtyReturned: 0 };
    row.qtyIssued += Number(it.qtyIssued ?? it.quantity) || 0;
    row.qtyReturned += Number(it.qtyReturnedToStore) || 0;
    byItem.set(id, row);
  });
  const items = await Inventory.find({ _id: { $in: [...byItem.keys()] } }).select('averageCost unitPrice').lean();
  const invById = new Map(items.map((i) => [String(i._id), i]));
  return [...byItem.values()].map((row) => {
    const qtyInvoiced = r2(invoiced.get(row.inventoryItem) || 0);
    const inv = invById.get(row.inventoryItem);
    const cogsPosted = postedCost.has(row.inventoryItem);
    const unitCost = cogsPosted
      ? postedCost.get(row.inventoryItem)
      : (Number(inv?.averageCost) > 0 ? Number(inv.averageCost) : Number(inv?.unitPrice) || 0);
    return {
      ...row,
      qtyIssued: r2(row.qtyIssued),
      qtyReturned: r2(row.qtyReturned),
      qtyInvoiced,
      qtyReturnable: Math.max(0, r2(row.qtyIssued - row.qtyReturned - qtyInvoiced)),
      unitCost: r2(unitCost),
      cogsPosted
    };
  });
};

const postReturnJournal = async ({ item, qty, unitCost, srn, companyId, userId, sinCostCenter }) => {
  const amount = r2(qty * unitCost);
  if (amount <= 0) return { status: 'skipped', reason: 'No cost', amount: 0 };
  try {
    // Reverse COGS on the same cost center / project the SIN charged
    const { resolveFinanceCostCenter } = require('./costCenterLink');
    const costCenter = await resolveFinanceCostCenter(sinCostCenter, companyId).catch(() => null);
    const FinanceHelper = require('./financeHelper');
    const { withCompany } = require('./financePosting');
    const { inventoryAccountId, cogsAccountId } = await FinanceHelper.resolveInventoryAccounts(item, companyId);
    if (!inventoryAccountId || !cogsAccountId) return { status: 'skipped', reason: 'Item has no COGS / inventory accounts', amount };
    const je = await FinanceHelper.createAndPostJournalEntry(withCompany({
      date: srn.returnDate || new Date(),
      reference: srn.returnNumber,
      description: `${srn.returnNumber}: ${srn.kind === 'cancellation' ? 'SIN cancelled' : 'Returned to store'} – ${item.name} (${qty} × ${unitCost}) against ${srn.sinNumber}`,
      department: 'procurement',
      module: 'procurement',
      referenceId: srn._id,
      referenceType: 'stock_adjustment',
      journalCode: 'INV',
      costCenter,
      project: srn.project || null,
      createdBy: userId,
      lines: [
        { account: inventoryAccountId, description: `Inventory back in – ${item.name} via ${srn.returnNumber}`, debit: amount, department: 'procurement', costCenter },
        { account: cogsAccountId, description: `COGS reversed – ${item.name} (${srn.sinNumber})`, credit: amount, department: 'procurement', costCenter }
      ]
    }, companyId));
    return { status: 'posted', journalEntry: je?._id, amount };
  } catch (err) {
    console.error('[SRN] journal failed:', err.message);
    return { status: 'failed', reason: err.message, amount };
  }
};

/**
 * lines: [{ inventoryItem, quantity, condition?, notes? }]
 */
const postStoreReturn = async ({ sinId, lines, reason, kind = 'return', userId, returnDate, returnedByName, receivedByName }) => {
  const GoodsIssue = mongoose.model('GoodsIssue');
  const StoreReturn = require('../models/procurement/StoreReturn');
  const Inventory = mongoose.model('Inventory');
  const StockQuant = mongoose.model('StockQuant');
  const StockTransaction = mongoose.model('StockTransaction');
  const Store = mongoose.model('Store');

  if (!String(reason || '').trim()) throw httpError('Reason is required');
  const sin = await GoodsIssue.findById(sinId).lean();
  if (!sin) throw httpError('Store Issue Note not found', 404);
  if (sin.status !== 'Issued') throw httpError(`${sin.issueNumber} is ${sin.status} — only issued SINs can be returned`);
  const sinNumber = sin.issueNumber || sin.sinNumber;

  const balances = await sinReturnableLines(sin);
  const wanted = new Map();
  (lines || []).forEach((l) => {
    const qty = Number(l.quantity) || 0;
    if (qty <= 0) return;
    const id = String(l.inventoryItem);
    const prev = wanted.get(id) || { qty: 0, condition: l.condition, notes: l.notes };
    wanted.set(id, { ...prev, qty: r2(prev.qty + qty) });
  });
  if (!wanted.size) throw httpError('Enter a return quantity for at least one item');

  const srnItems = [];
  for (const [id, w] of wanted) {
    const bal = balances.find((b) => b.inventoryItem === id);
    if (!bal) throw httpError(`Item is not on ${sinNumber}`);
    if (w.qty > bal.qtyReturnable + 1e-9) {
      const why = bal.qtyInvoiced > 0 ? ` (${bal.qtyInvoiced} already invoiced to the customer — cancel or credit that invoice first)` : '';
      throw httpError(`${bal.itemName}: only ${bal.qtyReturnable} ${bal.unit || ''} can be returned${why}`);
    }
    srnItems.push({
      inventoryItem: id, itemCode: bal.itemCode, itemName: bal.itemName, unit: bal.unit,
      quantity: w.qty, unitCost: bal.unitCost, condition: w.condition === 'damaged' ? 'damaged' : 'good', notes: w.notes || '',
      __cogsPosted: bal.cogsPosted
    });
  }

  const storeId = sin.store || null;
  const storeDoc = storeId ? await Store.findById(storeId).select('name').lean() : null;
  const srn = new StoreReturn({
    returnDate: returnDate || new Date(),
    companyId: sin.companyId || null,
    goodsIssue: sin._id,
    sinNumber,
    project: sin.project,
    store: storeId,
    storeSnapshot: storeDoc?.name || sin.storeSnapshot || '',
    issueType: sin.issueType || 'project',
    customer: sin.customer || null,
    customerName: sin.customerName || '',
    kind,
    reason: String(reason).trim(),
    returnedByName,
    receivedByName,
    items: srnItems.map(({ __cogsPosted, ...rest }) => rest),
    createdBy: userId
  });
  await srn.save();

  const { resolveDocumentCompanyId } = require('./financeCompanyContext');
  const companyId = await resolveDocumentCompanyId({ companyId: sin.companyId, userId });
  const finance = [];

  for (const line of srnItems) {
    const item = await Inventory.findById(line.inventoryItem);
    if (!item) { finance.push({ inventoryItem: line.inventoryItem, itemName: line.itemName, status: 'failed', reason: 'Item not found' }); continue; }
    // Back into the same store / project the SIN took it from
    const sinLine = (sin.items || []).find((it) => String(it.inventoryItem) === line.inventoryItem);
    const txStore = sinLine?.subStore || storeId || item.store;
    await item.addStock(line.quantity, srn.returnNumber, `Returned via ${srn.returnNumber} (${sinNumber})`, userId, line.unitCost);
    if (txStore) {
      await StockQuant.addStockAVCO(txStore, sin.project, item._id, line.quantity, line.unitCost);
      const balance = await StockTransaction.getBalance(txStore, sin.project, item._id);
      await StockTransaction.create({
        store: txStore, storeSnapshot: srn.storeSnapshot || 'Main Store', project: sin.project, item: item._id,
        itemCode: item.itemCode, itemName: item.name, transactionType: 'IN', quantity: line.quantity, unit: item.unit,
        unitPrice: line.unitCost, referenceType: 'SRN', referenceId: srn._id, referenceNumber: srn.returnNumber,
        balanceAfter: r2(balance + line.quantity), description: `Returned via ${srn.returnNumber} against ${sinNumber}`,
        notes: line.notes || '', createdBy: userId
      });
    }
    const posting = line.__cogsPosted
      ? await postReturnJournal({ item, qty: line.quantity, unitCost: line.unitCost, srn, companyId, userId, sinCostCenter: sin.costCenter })
      : { status: 'skipped', reason: `${sinNumber} had no COGS entry for this item — nothing to reverse`, amount: 0 };
    finance.push({ inventoryItem: item._id, itemName: item.name, ...posting });

    // Spread the returned qty over the SIN's lines for this item (updateOne — see note at top)
    let left = line.quantity;
    for (let i = 0; i < (sin.items || []).length && left > 1e-9; i++) {
      const it = sin.items[i];
      if (String(it.inventoryItem) !== line.inventoryItem) continue;
      const room = (Number(it.qtyIssued ?? it.quantity) || 0) - (Number(it.qtyReturnedToStore) || 0);
      const take = Math.min(room, left);
      if (take <= 0) continue;
      await GoodsIssue.updateOne({ _id: sin._id }, { $inc: { [`items.${i}.qtyReturnedToStore`]: r2(take) } });
      it.qtyReturnedToStore = (Number(it.qtyReturnedToStore) || 0) + take;
      left = r2(left - take);
    }
  }

  const posted = finance.filter((f) => f.status === 'posted').length;
  const financePostingStatus = posted === finance.length ? 'posted' : posted ? 'partial'
    : finance.some((f) => f.status === 'failed') ? 'failed' : 'not_posted';
  await StoreReturn.updateOne({ _id: srn._id }, { $set: { financePosting: finance, financePostingStatus } });
  return StoreReturn.findById(srn._id).lean();
};

/** Reverse a whole SIN: everything not yet returned comes back, then the SIN is marked Cancelled */
const cancelStoreIssue = async ({ sinId, reason, userId }) => {
  const GoodsIssue = mongoose.model('GoodsIssue');
  if (!String(reason || '').trim()) throw httpError('Reason is required');
  const sin = await GoodsIssue.findById(sinId).lean();
  if (!sin) throw httpError('Store Issue Note not found', 404);
  if (sin.status === 'Cancelled') throw httpError(`${sin.issueNumber} is already cancelled`);
  const lines = await sinReturnableLines(sin);
  const invoiced = lines.filter((l) => l.qtyInvoiced > 0);
  if (invoiced.length) {
    throw httpError(`${sin.issueNumber} is billed on a customer invoice (${invoiced.map((l) => `${l.itemName}: ${l.qtyInvoiced}`).join(', ')}) — cancel that invoice first`);
  }
  let srn = null;
  const toReturn = lines.filter((l) => l.qtyReturnable > 0).map((l) => ({ inventoryItem: l.inventoryItem, quantity: l.qtyReturnable }));
  if (toReturn.length) {
    srn = await postStoreReturn({ sinId, lines: toReturn, reason: `Cancelled: ${reason}`, kind: 'cancellation', userId });
  }
  await GoodsIssue.updateOne({ _id: sin._id }, {
    $set: { status: 'Cancelled', cancelledAt: new Date(), cancelledBy: userId, cancelReason: String(reason).trim() }
  });
  return { srn };
};

module.exports = { sinReturnableLines, postStoreReturn, cancelStoreIssue };
