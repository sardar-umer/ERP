const mongoose = require('mongoose');

/**
 * Manual stock movements (opening stock, add, remove, physical-count adjust) — the only way stock changes
 * outside GRN / SIN. Every movement updates all three records together, the same way GRN / SIN do:
 *   1. Inventory.quantity (item total) + averageCost
 *   2. StockQuant / StockTransaction (per store + project — what SIN checks before issuing)
 *   3. General Ledger:
 *        opening  → DR Inventory / CR Opening Balance Equity
 *        gain/add → DR Inventory / CR COGS (stock gain)
 *        loss     → DR COGS (stock loss) / CR Inventory
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const httpError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const currentCost = (item) => (Number(item.averageCost) > 0 ? Number(item.averageCost) : Number(item.unitPrice) || 0);

/** Store for the movement: chosen store → item's store → first active store */
const resolveStore = async (storeId, item) => {
  const Store = mongoose.model('Store');
  const id = storeId || item.store?._id || item.store;
  if (id) {
    const store = await Store.findById(id).select('_id name').lean();
    if (store) return store;
  }
  const fallback = await Store.findOne({ isActive: true }).sort({ type: 1, createdAt: 1 }).select('_id name').lean();
  if (!fallback) throw httpError('No active store found — create a store first');
  return fallback;
};

const resolveOpeningEquityAccount = async (companyId) => {
  const Account = mongoose.model('Account');
  const { acct } = require('./financePosting');
  const scoped = (q) => (companyId ? { ...q, companyId } : q);
  return (await Account.findOne(scoped({ type: 'Equity', isActive: { $ne: false }, name: { $regex: 'opening\\s*balance', $options: 'i' } })))
    || (await acct(companyId).resolve('3100')); // Retained Earnings
};

const postMovementJournal = async ({ item, kind, qty, unitCost, reference, reason, userId, date }) => {
  const amount = r2(Math.abs(qty) * unitCost);
  if (amount <= 0) return { status: 'skipped', reason: 'Item has no cost — no accounting entry', amount: 0 };
  try {
    const FinanceHelper = require('./financeHelper');
    const { resolveDocumentCompanyId } = require('./financeCompanyContext');
    const { withCompany } = require('./financePosting');
    const companyId = await resolveDocumentCompanyId({ userId });
    const { inventoryAccountId, cogsAccountId } = await FinanceHelper.resolveInventoryAccounts(item, companyId);
    if (!inventoryAccountId) return { status: 'skipped', reason: 'No inventory account for this item', amount };

    let offset;
    if (kind === 'opening') {
      offset = (await resolveOpeningEquityAccount(companyId))?._id;
    } else {
      offset = cogsAccountId;
    }
    if (!offset) return { status: 'skipped', reason: kind === 'opening' ? 'No Opening Balance Equity / Retained Earnings account' : 'No COGS account for this item', amount };

    const isIn = qty > 0;
    const label = kind === 'opening' ? 'Opening stock' : isIn ? 'Stock gain' : 'Stock loss';
    const je = await FinanceHelper.createAndPostJournalEntry(withCompany({
      date: date || new Date(),
      reference,
      description: `${label} – ${item.name} (${isIn ? '+' : ''}${qty} ${item.unit || ''} × ${unitCost})${reason ? ` – ${reason}` : ''}`,
      department: 'procurement',
      module: 'procurement',
      referenceId: item._id,
      referenceType: 'stock_adjustment',
      journalCode: 'INV',
      createdBy: userId,
      lines: isIn ? [
        { account: inventoryAccountId, description: `${label} – ${item.name}`, debit: amount, department: 'procurement' },
        { account: offset, description: `${label} offset – ${item.name}`, credit: amount, department: 'procurement' }
      ] : [
        { account: offset, description: `${label} – ${item.name}`, debit: amount, department: 'procurement' },
        { account: inventoryAccountId, description: `Inventory reduction – ${item.name}`, credit: amount, department: 'procurement' }
      ]
    }, companyId));
    return { status: 'posted', journalEntry: je?._id, amount };
  } catch (err) {
    console.error('[Stock movement] journal failed:', err.message);
    return { status: 'failed', reason: err.message, amount };
  }
};

/**
 * kind: 'opening' | 'add' | 'remove' | 'adjust'
 * qty: quantity for opening/add/remove (positive); for adjust, the counted quantity for this store + project
 * unitCost: cost per unit for stock coming in (defaults to the item's current cost)
 * postToLedger: false only for allocating already-counted stock to a project (no value change)
 */
const postStockMovement = async ({
  item, kind, qty, projectId, storeId, unitCost, reference, reason = '', userId, location = {}, postToLedger = true
}) => {
  const Project = mongoose.model('Project');
  const StockTransaction = mongoose.model('StockTransaction');
  const StockQuant = mongoose.model('StockQuant');

  if (!projectId || !mongoose.Types.ObjectId.isValid(String(projectId))) throw httpError('Select the project this stock belongs to');
  const project = await Project.findById(projectId).select('_id name').lean();
  if (!project) throw httpError('Project not found');
  const store = await resolveStore(storeId, item);

  const balance = await StockTransaction.getBalance(store._id, project._id, item._id);
  let delta;
  if (kind === 'adjust') {
    const counted = Number(qty);
    if (!(counted >= 0)) throw httpError('Counted quantity must be 0 or more');
    delta = r2(counted - balance);
    if (delta === 0) throw httpError(`Nothing to adjust — ${project.name} already shows ${balance} ${item.unit || ''} in ${store.name}`);
  } else {
    const n = Number(qty);
    if (!(n > 0)) throw httpError('Quantity must be greater than 0');
    delta = kind === 'remove' ? -n : n;
  }

  if (delta < 0) {
    if (balance + delta < -1e-9) {
      throw httpError(`Only ${balance} ${item.unit || ''} of ${item.name} in ${project.name} / ${store.name} — cannot remove ${-delta}`);
    }
    if (Number(item.quantity) + delta < -1e-9) {
      throw httpError(`Item total is only ${item.quantity} ${item.unit || ''} — cannot remove ${-delta}`);
    }
  }

  const cost = delta > 0 && Number(unitCost) > 0 ? Number(unitCost) : currentCost(item);
  const ref = reference || `${kind === 'opening' ? 'OPEN' : 'ADJ'}-${item.itemCode}`;
  const notes = reason || (kind === 'opening' ? 'Opening stock' : 'Manual stock adjustment');

  // 1. Item total (+ average cost on stock in)
  if (delta > 0) {
    await item.addStock(delta, ref, notes, userId, cost);
    await StockQuant.addStockAVCO(store._id, project._id, item._id, delta, cost, location);
  } else {
    await item.removeStock(-delta, ref, notes, userId);
    await StockQuant.deductStock(store._id, project._id, item._id, -delta).catch((e) => {
      console.warn('[Stock movement] StockQuant deduct notice:', e.message);
    });
  }

  // 2. Store + project ledger
  await StockTransaction.create({
    store: store._id,
    storeSnapshot: store.name,
    project: project._id,
    item: item._id,
    itemCode: item.itemCode,
    itemName: item.name,
    transactionType: kind === 'adjust' ? 'ADJUSTMENT' : delta > 0 ? 'IN' : 'OUT',
    quantity: delta,
    unit: item.unit,
    unitPrice: cost,
    referenceType: 'ADJUSTMENT',
    referenceId: item._id,
    referenceNumber: ref,
    balanceAfter: r2(balance + delta),
    location: { rack: location.rack || '', shelf: location.shelf || '', bin: location.bin || '' },
    description: `${kind === 'opening' ? 'Opening stock' : kind === 'adjust' ? 'Physical count adjustment' : delta > 0 ? 'Manual stock in' : 'Manual stock out'} – ${notes}`,
    notes,
    createdBy: userId
  });

  // 3. Accounts
  const finance = postToLedger
    ? await postMovementJournal({ item, kind, qty: delta, unitCost: cost, reference: ref, reason, userId })
    : { status: 'skipped', reason: 'Allocation only — value already on the item', amount: 0 };

  const Inventory = mongoose.model('Inventory');
  const fresh = await Inventory.findById(item._id);
  return { item: fresh, delta, project: project.name, store: store.name, balanceAfter: r2(balance + delta), finance };
};

/** Items whose total (Inventory.quantity) differs from the sum of their store + project ledger */
const findStockMismatches = async () => {
  const Inventory = mongoose.model('Inventory');
  const StockTransaction = mongoose.model('StockTransaction');
  const [items, ledger] = await Promise.all([
    Inventory.find({}).select('itemCode name unit quantity averageCost unitPrice').lean(),
    StockTransaction.aggregate([
      { $group: { _id: { item: '$item', project: '$project', store: '$store' }, qty: { $sum: '$quantity' } } },
      { $lookup: { from: 'projects', localField: '_id.project', foreignField: '_id', as: 'p' } },
      { $lookup: { from: 'stores', localField: '_id.store', foreignField: '_id', as: 's' } },
      { $project: { item: '$_id.item', qty: 1, project: { $arrayElemAt: ['$p.name', 0] }, store: { $arrayElemAt: ['$s.name', 0] } } }
    ])
  ]);
  const byItem = new Map();
  ledger.forEach((row) => {
    const key = String(row.item);
    const entry = byItem.get(key) || { total: 0, breakdown: [] };
    entry.total = r2(entry.total + row.qty);
    if (Math.abs(row.qty) > 1e-9) entry.breakdown.push({ project: row.project || '—', store: row.store || '—', qty: r2(row.qty) });
    byItem.set(key, entry);
  });
  return items
    .map((it) => {
      const led = byItem.get(String(it._id)) || { total: 0, breakdown: [] };
      return {
        _id: it._id,
        itemCode: it.itemCode,
        name: it.name,
        unit: it.unit,
        itemQuantity: r2(it.quantity),
        ledgerQuantity: led.total,
        difference: r2((Number(it.quantity) || 0) - led.total),
        breakdown: led.breakdown
      };
    })
    .filter((r) => Math.abs(r.difference) > 1e-9)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
};

/**
 * Fix one mismatched item:
 *  item total > ledger → allocate the unallocated qty to a project (no accounting — value is already on the item)
 *  ledger > item total → raise the item total to the ledger total
 */
const reconcileItemStock = async ({ item, projectId, storeId, userId }) => {
  const StockTransaction = mongoose.model('StockTransaction');
  const [row] = await StockTransaction.aggregate([
    { $match: { item: item._id } },
    { $group: { _id: null, qty: { $sum: '$quantity' } } }
  ]);
  const ledgerQty = r2(row?.qty || 0);
  const diff = r2((Number(item.quantity) || 0) - ledgerQty);
  if (Math.abs(diff) < 1e-9) throw httpError('Item total already matches the project stock');

  if (diff > 0) {
    // Ledger only — the item total already includes this qty
    const Project = mongoose.model('Project');
    if (!projectId || !mongoose.Types.ObjectId.isValid(String(projectId))) throw httpError('Select the project to allocate the unallocated stock to');
    const project = await Project.findById(projectId).select('_id name').lean();
    if (!project) throw httpError('Project not found');
    const store = await resolveStore(storeId, item);
    const StockQuant = mongoose.model('StockQuant');
    const balance = await StockTransaction.getBalance(store._id, project._id, item._id);
    await StockQuant.addStockAVCO(store._id, project._id, item._id, diff, currentCost(item));
    await StockTransaction.create({
      store: store._id, storeSnapshot: store.name, project: project._id, item: item._id,
      itemCode: item.itemCode, itemName: item.name, transactionType: 'ADJUSTMENT', quantity: diff,
      unit: item.unit, unitPrice: currentCost(item), referenceType: 'ADJUSTMENT', referenceId: item._id,
      referenceNumber: `ALLOC-${item.itemCode}`, balanceAfter: r2(balance + diff),
      description: `Unallocated stock assigned to ${project.name}`, notes: 'Stock reconciliation', createdBy: userId
    });
    return { action: 'allocated', qty: diff, project: project.name, store: store.name };
  }

  // Ledger shows more than the item total — bring the item total up (no ledger / accounting change)
  // save() (not updateOne) so the pre-save hook refreshes totalValue and status
  item.quantity = ledgerQty;
  item.transactions.push({ type: 'Adjustment', quantity: -diff, reference: 'RECONCILE', notes: 'Item total aligned to project stock', performedBy: userId });
  await item.save();
  return { action: 'item_total_raised', qty: -diff };
};

module.exports = { postStockMovement, findStockMismatches, reconcileItemStock };
