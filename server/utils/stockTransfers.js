const mongoose = require('mongoose');

/**
 * Stock Transfer Notes: move stock between stores and/or projects.
 * Source ledger OUT, destination ledger IN (both referenceType 'TRANSFER'), quantity checked against the source
 * ledger balance first. Cost moves at the source quant's average cost. No journal: the stock stays in the same
 * Inventory account, only its store / project changes.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const idOf = (v) => String(v?._id || v || '');

/**
 * lines: [{ inventoryItem, quantity, notes? }]
 */
const postStockTransfer = async ({ fromStore, fromProject, toStore, toProject, lines, reason, userId, transferDate, sentByName, receivedByName, vehicleNumber }) => {
  const StockTransfer = require('../models/procurement/StockTransfer');
  const Inventory = mongoose.model('Inventory');
  const StockQuant = mongoose.model('StockQuant');
  const StockTransaction = mongoose.model('StockTransaction');
  const Store = mongoose.model('Store');
  const Project = mongoose.model('Project');

  if (!String(reason || '').trim()) throw httpError('Reason is required');
  if (!fromStore || !toStore || !fromProject || !toProject) throw httpError('Select the source and destination store and project');
  if (idOf(fromStore) === idOf(toStore) && idOf(fromProject) === idOf(toProject)) {
    throw httpError('Source and destination are the same — change the store or the project');
  }

  const [srcStore, dstStore, srcProject, dstProject] = await Promise.all([
    Store.findById(fromStore).select('name isActive').lean(),
    Store.findById(toStore).select('name isActive').lean(),
    Project.findById(fromProject).select('name').lean(),
    Project.findById(toProject).select('name').lean()
  ]);
  if (!srcStore || !dstStore) throw httpError('Store not found', 404);
  if (!dstStore.isActive) throw httpError(`${dstStore.name} is inactive`);
  if (!srcProject || !dstProject) throw httpError('Project not found', 404);

  // Merge repeated items, then check every line before moving anything
  const wanted = new Map();
  (lines || []).forEach((l) => {
    const qty = Number(l.quantity) || 0;
    if (qty <= 0) return;
    const id = idOf(l.inventoryItem);
    const prev = wanted.get(id) || { qty: 0, notes: l.notes || '' };
    wanted.set(id, { ...prev, qty: r2(prev.qty + qty) });
  });
  if (!wanted.size) throw httpError('Enter a quantity for at least one item');

  const items = await Inventory.find({ _id: { $in: [...wanted.keys()] } }).select('name itemCode unit averageCost unitPrice').lean();
  const itemById = new Map(items.map((i) => [String(i._id), i]));
  const balances = await StockTransaction.getBalances(fromStore, fromProject, [...wanted.keys()]);
  const transferItems = [];
  for (const [id, w] of wanted) {
    const item = itemById.get(id);
    if (!item) throw httpError('Item not found', 404);
    const available = r2(balances[id] || 0);
    if (w.qty > available + 1e-9) {
      throw httpError(`${item.name}: only ${available} ${item.unit || ''} in ${srcStore.name} / ${srcProject.name}`);
    }
    const quant = await StockQuant.findOne({ store: fromStore, project: fromProject, item: id }).select('unitPrice').lean();
    const unitCost = Number(quant?.unitPrice) > 0 ? Number(quant.unitPrice)
      : (Number(item.averageCost) > 0 ? Number(item.averageCost) : Number(item.unitPrice) || 0);
    transferItems.push({
      inventoryItem: id, itemCode: item.itemCode, itemName: item.name, unit: item.unit,
      quantity: w.qty, unitCost: Math.round(unitCost * 10000) / 10000, notes: w.notes, __available: available
    });
  }

  const stn = new StockTransfer({
    transferDate: transferDate || new Date(),
    fromStore, fromStoreSnapshot: srcStore.name, fromProject,
    toStore, toStoreSnapshot: dstStore.name, toProject,
    reason: String(reason).trim(), sentByName, receivedByName, vehicleNumber,
    items: transferItems.map(({ __available, ...rest }) => rest),
    createdBy: userId
  });
  await stn.save();

  const route = `${srcStore.name} / ${srcProject.name} → ${dstStore.name} / ${dstProject.name}`;
  for (const line of transferItems) {
    const base = {
      item: line.inventoryItem, itemCode: line.itemCode || '', itemName: line.itemName, unit: line.unit || 'pcs',
      unitPrice: line.unitCost, referenceType: 'TRANSFER', referenceId: stn._id, referenceNumber: stn.transferNumber,
      notes: line.notes || '', createdBy: userId
    };
    await StockTransaction.create({
      ...base, store: fromStore, storeSnapshot: srcStore.name, project: fromProject,
      transactionType: 'OUT', quantity: -line.quantity, balanceAfter: r2(line.__available - line.quantity),
      description: `Transferred out via ${stn.transferNumber}: ${route}`
    });
    const destBalance = await StockTransaction.getBalance(toStore, toProject, line.inventoryItem);
    await StockTransaction.create({
      ...base, store: toStore, storeSnapshot: dstStore.name, project: toProject,
      transactionType: 'IN', quantity: line.quantity, balanceAfter: r2(destBalance + line.quantity),
      description: `Transferred in via ${stn.transferNumber}: ${route}`
    });

    // Quants follow the ledger; a missing / short source quant (older stock) is clamped, never blocks the move
    const srcQuant = await StockQuant.findOne({ store: fromStore, project: fromProject, item: line.inventoryItem });
    if (srcQuant) {
      srcQuant.onHandQuantity = Math.max(0, r2(srcQuant.onHandQuantity - line.quantity));
      srcQuant.reservedQuantity = Math.min(srcQuant.reservedQuantity || 0, srcQuant.onHandQuantity);
      await srcQuant.save();
    }
    // Destination average cost (not addStockAVCO: that also rewrites the item master's price, a transfer must not)
    const dstQuant = await StockQuant.getOrCreateQuant(toStore, toProject, line.inventoryItem);
    const newQty = r2((dstQuant.onHandQuantity || 0) + line.quantity);
    dstQuant.unitPrice = newQty > 0
      ? Number((((dstQuant.onHandQuantity || 0) * (dstQuant.unitPrice || 0) + line.quantity * line.unitCost) / newQty).toFixed(4))
      : line.unitCost;
    dstQuant.onHandQuantity = newQty;
    dstQuant.lastReceivedDate = new Date();
    await dstQuant.save();
  }

  return StockTransfer.findById(stn._id)
    .populate('fromProject', 'name').populate('toProject', 'name').populate('createdBy', 'firstName lastName')
    .lean();
};

module.exports = { postStockTransfer };
