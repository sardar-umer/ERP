const mongoose = require('mongoose');

/**
 * StockTransaction Model
 * Tracks all stock movements (in/out/adjustments) with project-wise and store-wise separation.
 * Store field now references the Store collection (supports main + sub-stores).
 * Balance: SUM(quantity) GROUP BY store._id, project._id, item._id
 * Location (rack/shelf/bin) is recorded per transaction for bin-level traceability.
 */
const stockTransactionSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true
  },
  storeSnapshot: {
    type: String,
    trim: true
  },
  location: {
    rack: { type: String, trim: true },
    shelf: { type: String, trim: true },
    bin: { type: String, trim: true }
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  item: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true,
    index: true
  },
  itemCode: {
    type: String,
    required: true,
    trim: true
  },
  itemName: {
    type: String,
    required: true,
    trim: true
  },
  transactionType: {
    type: String,
    required: true,
    enum: ['IN', 'OUT', 'ADJUSTMENT'],
    index: true
  },
  quantity: {
    type: Number,
    required: true
    // Positive for IN, negative for OUT, can be +/- for ADJUSTMENT
  },
  unit: {
    type: String,
    required: true,
    trim: true
  },
  unitPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  // Reference to source document
  referenceType: {
    type: String,
    enum: ['GRN', 'SIN', 'SRN', 'ADJUSTMENT', 'TRANSFER', 'OTHER'],
    required: true
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false
  },
  referenceNumber: {
    type: String,
    trim: true
  },
  // Balance after this transaction (for this store + project + item combination)
  balanceAfter: {
    type: Number,
    required: true,
    default: 0
  },
  description: {
    type: String,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient balance queries
stockTransactionSchema.index({ store: 1, project: 1, item: 1 });
stockTransactionSchema.index({ store: 1, project: 1, item: 1, createdAt: -1 });
stockTransactionSchema.index({ store: 1, project: 1, item: 1, 'location.rack': 1 });
stockTransactionSchema.index({ referenceType: 1, referenceId: 1 });
stockTransactionSchema.index({ transactionType: 1, createdAt: -1 });

/**
 * Static method to get current balance for a store + project + item combination
 */
stockTransactionSchema.statics.getBalance = async function(store, projectId, itemId) {
  const storeObjId =
    store && typeof store === 'string' && mongoose.Types.ObjectId.isValid(store)
      ? new mongoose.Types.ObjectId(store)
      : store;
  const projectObjId = (typeof projectId === 'string' && mongoose.Types.ObjectId.isValid(projectId)) ? new mongoose.Types.ObjectId(projectId) : projectId;
  const itemObjId = (typeof itemId === 'string' && mongoose.Types.ObjectId.isValid(itemId)) ? new mongoose.Types.ObjectId(itemId) : itemId;
  const result = await this.aggregate([
    {
      $match: {
        store: storeObjId,
        project: projectObjId,
        item: itemObjId
      }
    },
    {
      $group: {
        _id: null,
        balance: { $sum: '$quantity' }
      }
    }
  ]);
  
  return result.length > 0 ? result[0].balance : 0;
};

/**
 * Static method to get balances for multiple items (store + project + items)
 * Returns: { itemId: balance, ... }
 */
stockTransactionSchema.statics.getBalances = async function(store, projectId, itemIds) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) return {};
  
  const storeObjId =
    store && typeof store === 'string' && mongoose.Types.ObjectId.isValid(store)
      ? new mongoose.Types.ObjectId(store)
      : store;
  const objectIds = itemIds.map(id => 
    (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) ? new mongoose.Types.ObjectId(id) : id
  );
  const projectObjId = (typeof projectId === 'string' && mongoose.Types.ObjectId.isValid(projectId)) ? new mongoose.Types.ObjectId(projectId) : projectId;
  
  const results = await this.aggregate([
    {
      $match: {
        store: storeObjId,
        project: projectObjId,
        item: { $in: objectIds }
      }
    },
    {
      $group: {
        _id: '$item',
        balance: { $sum: '$quantity' }
      }
    }
  ]);
  
  const balances = {};
  results.forEach(r => {
    balances[r._id.toString()] = r.balance;
  });
  
  // Ensure all items have a balance entry (0 if no transactions)
  itemIds.forEach(id => {
    const idStr = id.toString ? id.toString() : String(id);
    if (!(idStr in balances)) {
      balances[idStr] = 0;
    }
  });
  
  return balances;
};

/**
 * Static method to get all balances for a store + project
 * Returns array of { item, itemCode, itemName, balance, unit }
 */
stockTransactionSchema.statics.getProjectBalances = async function(store, projectId) {
  const projectObjId = (typeof projectId === 'string' && mongoose.Types.ObjectId.isValid(projectId)) ? new mongoose.Types.ObjectId(projectId) : projectId;
  
  const results = await this.aggregate([
    {
      $match: {
        store: store,
        project: projectObjId
      }
    },
    {
      $group: {
        _id: '$item',
        itemCode: { $first: '$itemCode' },
        itemName: { $first: '$itemName' },
        unit: { $first: '$unit' },
        balance: { $sum: '$quantity' }
      }
    },
    {
      $match: {
        balance: { $ne: 0 } // Only return items with non-zero balance
      }
    },
    {
      $sort: { itemCode: 1 }
    }
  ]);
  
  return results.map(r => ({
    item: r._id,
    itemCode: r.itemCode,
    itemName: r.itemName,
    unit: r.unit,
    balance: r.balance
  }));
};

module.exports = mongoose.model('StockTransaction', stockTransactionSchema);
