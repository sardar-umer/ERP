const mongoose = require('mongoose');
require('./StockQuant');
require('./StockTransaction');
require('./Store');
require('./Inventory');

const goodsReceiveSchema = new mongoose.Schema({
  receiveNumber: {
    type: String,
    unique: true,
    required: false,
    trim: true
  },
  receiveDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  supplierName: {
    type: String,
    trim: true
  },
  purchaseOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder'
  },
  /** When set, GRN was posted against a procurement delivery challan (full-advance PO flow). */
  deliveryChallan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryChallan'
  },
  inwardGatePass: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InwardGatePass'
  },
  qualityInspection: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QualityInspection'
  },
  poNumber: {
    type: String,
    trim: true
  },
  supplierAddress: {
    type: String,
    trim: true
  },
  narration: {
    type: String,
    trim: true
  },
  prNumber: {
    type: String,
    trim: true
  },
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store'
  },
  storeSnapshot: {
    type: String,
    trim: true,
    default: 'Main Store'
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  gatePassNo: {
    type: String,
    trim: true
  },
  currency: {
    type: String,
    trim: true,
    default: 'Rupees'
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  otherCharges: {
    type: Number,
    default: 0,
    min: 0
  },
  netAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  total: {
    type: Number,
    default: 0,
    min: 0
  },
  observation: {
    type: String,
    trim: true
  },
  preparedByName: {
    type: String,
    trim: true
  },
  items: [{
    productCode: {
      type: String,
      trim: true
    },
    inventoryItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      required: false
    },
    itemCode: {
      type: String,
      required: true
    },
    itemName: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.01
    },
    acceptedQuantity: {
      type: Number,
      min: 0
    },
    rejectedQuantity: {
      type: Number,
      default: 0,
      min: 0
    },
    damagedQuantity: {
      type: Number,
      default: 0,
      min: 0
    },
    batchNumber: { type: String, trim: true },
    lotNumber: { type: String, trim: true },
    heatNumber: { type: String, trim: true },
    expiryDate: { type: Date },
    unit: {
      type: String,
      required: true
    },
    unitPrice: {
      type: Number,
      default: 0
    },
    valueExcludingSalesTax: {
      type: Number,
      default: 0
    },
    subStore: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store'
    },
    location: {
      rack: { type: String, trim: true },
      shelf: { type: String, trim: true },
      bin: { type: String, trim: true }
    },
    notes: String
  }],
  totalItems: {
    type: Number,
    default: 0
  },
  totalQuantity: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    trim: true
  },
  attachments: [{
    filename: { type: String, trim: true },
    path: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now }
  }],
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Received', 'Complete', 'Partial'],
    default: 'Partial'
  },
  // Finance / billing integration
  billingStatus: {
    type: String,
    enum: ['nothing_to_bill', 'waiting_bills', 'fully_billed'],
    default: 'nothing_to_bill'
  },
  billedAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  // AP bill generated from this GRN
  vendorBill: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AccountsPayable'
  },
  vendorBillNumber: {
    type: String,
    trim: true
  },
  // Journal entry posted on receipt
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry'
  },
  financePosted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

/** Next GR######## from highest existing number (countDocuments breaks after deletes / gaps). */
async function allocateNextReceiveNumber(GoodsReceiveModel) {
  const re = /^GR(\d+)$/i;
  const docs = await GoodsReceiveModel.find({ receiveNumber: /^GR\d+$/i })
    .select('receiveNumber')
    .lean();
  let max = 0;
  for (const d of docs) {
    const m = String(d.receiveNumber || '').match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return `GR${String(max + 1).padStart(8, '0')}`;
}

goodsReceiveSchema.statics.allocateNextReceiveNumber = function allocateNext() {
  return allocateNextReceiveNumber(this);
};

// Pre-save: Generate receive number if not provided (GR00000129 style)
goodsReceiveSchema.pre('save', async function(next) {
  if (!this.receiveNumber) {
    this.receiveNumber = await allocateNextReceiveNumber(mongoose.model('GoodsReceive'));
  }

  if (this.items && this.items.length > 0) {
    this.totalItems = this.items.length;
    this.totalQuantity = this.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    this.items.forEach((item) => {
      item.valueExcludingSalesTax = (item.quantity || 0) * (item.unitPrice || 0);
    });
    const subtotal = this.items.reduce((sum, item) => sum + (item.valueExcludingSalesTax || 0), 0);
    this.netAmount = subtotal - (this.discount || 0) + (this.otherCharges || 0);
    this.total = this.netAmount;
  }

  next();
});

// Shared logic: sync GRN items to inventory and create stock transactions
goodsReceiveSchema.statics.syncItemsToInventory = async function(grnDoc) {
  const receivedStatuses = ['Received', 'Complete', 'Partial'];
  if (!grnDoc || !receivedStatuses.includes(grnDoc.status) || !grnDoc.items || grnDoc.items.length === 0) return;
  if (!grnDoc.project) {
    console.error('GoodsReceive syncItemsToInventory: project is required');
    return;
  }

  const receiveNumber = grnDoc.receiveNumber || grnDoc._id?.toString() || 'GRN';
  const storeId = grnDoc.store?._id || grnDoc.store;
  const storeSnapshot = grnDoc.storeSnapshot || 'Main Store';
  const projectId = grnDoc.project._id || grnDoc.project;
  const db = this.db || mongoose;
  const Inventory = db.model('Inventory');
  const StockTransaction = db.model('StockTransaction');
  const StockQuant = db.model('StockQuant');
  const Store = db.model('Store');
  const items = Array.isArray(grnDoc.items) ? grnDoc.items : [];

  // Pre-fetch store names for snapshots to avoid repeated DB calls
  const storeNameCache = {};
  const resolveStoreName = async (id) => {
    if (!id) return '';
    const key = id.toString();
    if (!storeNameCache[key]) {
      const s = await Store.findById(id).select('name').lean();
      storeNameCache[key] = s?.name || '';
    }
    return storeNameCache[key];
  };

  let defaultStoreCached = undefined;
  const getDefaultStore = async () => {
    if (defaultStoreCached !== undefined) return defaultStoreCached;
    defaultStoreCached = await Store.findOne({ isActive: true }).sort({ type: 1, createdAt: 1 }).select('_id name').lean();
    return defaultStoreCached;
  };

  const linkInventoryOnGrnLine = async (lineIndex, inventoryId) => {
    if (!grnDoc?._id || inventoryId == null || lineIndex < 0) return;
    try {
      await this.updateOne(
        { _id: grnDoc._id },
        { $set: { [`items.${lineIndex}.inventoryItem`]: inventoryId } }
      );
      if (grnDoc.items?.[lineIndex]) {
        grnDoc.items[lineIndex].inventoryItem = inventoryId;
      }
    } catch (linkErr) {
      console.error('GoodsReceive syncItemsToInventory: failed to link inventoryItem on GRN line', linkErr);
    }
  };

  const alreadyPostedForLine = async (inventoryId, lineIndex) => {
    const q = {
      referenceType: 'GRN',
      referenceId: grnDoc._id,
      transactionType: 'IN'
    };
    if (inventoryId) q.item = inventoryId;
    const existing = await StockTransaction.findOne(q).select('_id item').lean();
    if (existing) return true;
    // Fallback when older txs had null item: same GRN + line index marker in notes is not used;
    // count IN txs for this GRN and skip if this line index was already covered.
    const count = await StockTransaction.countDocuments({
      referenceType: 'GRN',
      referenceId: grnDoc._id,
      referenceNumber: receiveNumber,
      transactionType: 'IN'
    });
    return count > lineIndex;
  };

  const applyStockToInventory = async (inv, item, qty, txStoreId, ledgerStoreSnapshot, subStoreId, subStoreSnapshot) => {
    if (storeId) {
      inv.store = storeId;
      inv.storeSnapshot = storeSnapshot;
    } else if (txStoreId) {
      inv.store = txStoreId;
      inv.storeSnapshot = ledgerStoreSnapshot || storeSnapshot;
    }
    if (subStoreId) {
      inv.subStore = subStoreId;
      inv.subStoreSnapshot = subStoreSnapshot;
    }
    if (item.location && (item.location.rack || item.location.shelf || item.location.bin)) {
      inv.location = {
        rack: item.location.rack || '',
        shelf: item.location.shelf || '',
        bin: item.location.bin || ''
      };
    }
    await inv.save();

    // Decimal qty (e.g. 0.5) is supported — use Number, never force integers
    const effectiveQty = item.acceptedQuantity != null ? Number(item.acceptedQuantity) : qty;
    if (!(effectiveQty > 0)) return;

    await inv.addStock(
      effectiveQty,
      receiveNumber,
      item.notes || `Received via GRN ${receiveNumber}`,
      grnDoc.receivedBy,
      Number(item.unitPrice) || 0
    );
    if (txStoreId && projectId) {
      await StockQuant.addStockAVCO(txStoreId, projectId, inv._id, effectiveQty, Number(item.unitPrice) || 0, item.location);
    }
    if (txStoreId) {
      const currentBalance = await StockTransaction.getBalance(txStoreId, projectId, inv._id);
      const balanceAfter = currentBalance + effectiveQty;
      await StockTransaction.create({
        store: txStoreId,
        storeSnapshot: ledgerStoreSnapshot,
        project: projectId,
        item: inv._id,
        itemCode: inv.itemCode,
        itemName: inv.name,
        transactionType: 'IN',
        quantity: effectiveQty,
        unit: inv.unit,
        unitPrice: Number(item.unitPrice) || 0,
        referenceType: 'GRN',
        referenceId: grnDoc._id,
        referenceNumber: receiveNumber,
        balanceAfter,
        location: {
          rack: item.location?.rack || '',
          shelf: item.location?.shelf || '',
          bin: item.location?.bin || ''
        },
        description: `Received via GRN ${receiveNumber}`,
        notes: item.notes || '',
        createdBy: grnDoc.receivedBy
      });
    }
  };

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx] && typeof items[idx].toObject === 'function' ? items[idx].toObject() : items[idx];
    if (!item || item.quantity == null) continue;
    try {
      const linkedId = item.inventoryItem?._id || item.inventoryItem;
      const codeStr = item.itemCode != null ? String(item.itemCode).trim() : (item.productCode != null ? String(item.productCode).trim() : '');
      const nameStr = item.itemName != null ? String(item.itemName).trim() : '';

      const subStoreId = item.subStore?._id || item.subStore || null;
      let txStoreId = subStoreId || storeId;
      const subStoreSnapshot = subStoreId ? await resolveStoreName(subStoreId) : '';
      const qty = Number(item.quantity) || 0;
      if (!txStoreId && qty > 0) {
        const ds = await getDefaultStore();
        if (ds) txStoreId = ds._id;
      }
      const ledgerStoreSnapshot = subStoreSnapshot || (txStoreId ? await resolveStoreName(txStoreId) : '') || storeSnapshot;

      // 1) Explicit inventory link from GRN form
      if (linkedId) {
        if (await alreadyPostedForLine(linkedId, idx)) {
          continue;
        }
        const inv = await Inventory.findById(linkedId);
        if (!inv) {
          console.error(`GoodsReceive syncItemsToInventory: inventoryItem not found ${linkedId}`);
          continue;
        }
        await applyStockToInventory(inv, item, qty, txStoreId, ledgerStoreSnapshot, subStoreId, subStoreSnapshot);
        continue;
      }

      // 2) Exact master itemCode only (no name/static matching — avoids dumping onto old GRN rows)
      if (codeStr && codeStr !== '—') {
        const byCode = await Inventory.findOne({ itemCode: codeStr });
        if (byCode) {
          if (await alreadyPostedForLine(byCode._id, idx)) {
            await linkInventoryOnGrnLine(idx, byCode._id);
            continue;
          }
          await applyStockToInventory(byCode, item, qty, txStoreId, ledgerStoreSnapshot, subStoreId, subStoreSnapshot);
          await linkInventoryOnGrnLine(idx, byCode._id);
          continue;
        }
      }

      // 3) Dynamic inventory row for this GRN (works for whole or decimal qty)
      if (await alreadyPostedForLine(null, idx)) {
        continue;
      }

      let baseCode = (codeStr && codeStr !== '—') ? codeStr : nameStr || `ITEM-${idx + 1}`;
      let uniqueCode = `${baseCode}-GRN${receiveNumber}-${idx + 1}`;
      let existing = await Inventory.findOne({ itemCode: uniqueCode });
      if (existing) {
        if (await alreadyPostedForLine(existing._id, idx)) {
          await linkInventoryOnGrnLine(idx, existing._id);
          continue;
        }
        // Same GRN line re-sync: use existing dynamic row
        await applyStockToInventory(existing, item, qty, txStoreId, ledgerStoreSnapshot, subStoreId, subStoreSnapshot);
        await linkInventoryOnGrnLine(idx, existing._id);
        continue;
      }

      const name = (nameStr && nameStr !== '—') ? nameStr : uniqueCode;
      const barcodeValue = await Inventory.generateBarcodeValue(uniqueCode);
      const inv = new Inventory({
        itemCode: uniqueCode,
        name,
        description: item.description || `Received via GRN ${receiveNumber}`,
        category: item.category || 'Other',
        unit: (item.unit && item.unit !== '—') ? item.unit : 'Nos',
        quantity: 0,
        unitPrice: Number(item.unitPrice) || 0,
        barcode: barcodeValue,
        barcodeType: 'CODE128',
        store: storeId || txStoreId || undefined,
        storeSnapshot: storeId ? storeSnapshot : (ledgerStoreSnapshot || storeSnapshot),
        subStore: subStoreId || undefined,
        subStoreSnapshot: subStoreSnapshot,
        location: {
          rack: item.location?.rack || '',
          shelf: item.location?.shelf || '',
          bin: item.location?.bin || ''
        },
        createdBy: grnDoc.receivedBy
      });
      await inv.save();
      await applyStockToInventory(inv, item, qty, txStoreId, ledgerStoreSnapshot, subStoreId, subStoreSnapshot);
      await linkInventoryOnGrnLine(idx, inv._id);
    } catch (error) {
      console.error(`GoodsReceive syncItemsToInventory error for item ${item.itemCode}:`, error);
    }
  }
};

// Post-save: Update inventory when goods are received
goodsReceiveSchema.post('save', async function(doc) {
  try {
    await this.constructor.syncItemsToInventory(doc);
  } catch (error) {
    console.error('GoodsReceive post-save syncItemsToInventory error:', error);
  }
});

goodsReceiveSchema.index({ receiveNumber: 1 });
goodsReceiveSchema.index({ receiveDate: -1 });
goodsReceiveSchema.index({ supplier: 1 });
goodsReceiveSchema.index({ status: 1 });

module.exports = mongoose.model('GoodsReceive', goodsReceiveSchema);
