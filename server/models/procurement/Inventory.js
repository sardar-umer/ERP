const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  itemCode: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  /** Legacy fixed category — no longer on the form; Finance Category (inventoryCategory) is the real one */
  category: {
    type: String,
    enum: ['Raw Materials', 'Finished Goods', 'Office Supplies', 'Equipment', 'Consumables', 'Other'],
    default: 'Other'
  },
  /** Catalog item (Item Catalog = the item master); this record is its stock card */
  itemMaster: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemMaster',
    default: null,
    index: true
  },
  /** Owning company; null = shared by all companies */
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    default: null,
    index: true
  },
  unit: {
    type: String,
    required: true,
    trim: true
  },
  quantity: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  minQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  maxQuantity: {
    type: Number,
    default: null,
    min: 0
  },
  unitPrice: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  totalValue: {
    type: Number,
    default: 0
  },
  // WMS physical location — populated automatically from GRN
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store'
  },
  storeSnapshot: {
    type: String,
    trim: true
  },
  subStore: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store'
  },
  subStoreSnapshot: {
    type: String,
    trim: true
  },
  location: {
    rack: { type: String, trim: true },
    shelf: { type: String, trim: true },
    bin: { type: String, trim: true }
  },
  barcode: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  barcodeType: {
    type: String,
    enum: ['CODE128', 'QR'],
    default: 'CODE128'
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  status: {
    type: String,
    enum: ['In Stock', 'Low Stock', 'Out of Stock', 'Discontinued'],
    default: 'In Stock'
  },
  lastRestocked: {
    type: Date
  },
  expiryDate: {
    type: Date
  },
  notes: {
    type: String,
    trim: true
  },
  // InventoryCategory link — inherits finance accounts from category automatically
  inventoryCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryCategory'
  },
  // Weighted Average Cost per unit — updated automatically on each GRN receipt
  // Formula: (existingQty × existingWAC + receivedQty × receiptPrice) / (existingQty + receivedQty)
  averageCost: {
    type: Number,
    default: 0,
    min: 0
  },
  // Finance / Chart of Accounts linkage (item-level overrides; falls back to category if not set)
  inventoryAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account'
  },
  // GRNI (Goods Received Not Invoiced) clearing account — item-level override
  grniAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account'
  },
  cogsAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account'
  },
  salesAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account'
  },
  purchaseAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account'
  },
  transactions: [{
    type: {
      type: String,
      enum: ['In', 'Out', 'Adjustment'],
      required: true
    },
    quantity: {
      type: Number,
      required: true
    },
    reference: {
      type: String
    },
    notes: {
      type: String
    },
    date: {
      type: Date,
      default: Date.now
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Calculate total value before saving
inventorySchema.pre('save', function(next) {
  const costForValuation = (Number(this.averageCost) > 0) ? Number(this.averageCost) : Number(this.unitPrice || 0);
  this.totalValue = this.quantity * costForValuation;
  
  // Update status based on quantity
  if (this.quantity === 0) {
    this.status = 'Out of Stock';
  } else if (this.quantity <= this.minQuantity) {
    this.status = 'Low Stock';
  } else {
    this.status = 'In Stock';
  }
  
  next();
});

// Method to add stock (optional unitPrice updates WAC/list price)
inventorySchema.methods.addStock = function(quantity, reference, notes, userId, unitPrice = null) {
  const qty = Number(quantity) || 0;
  const receiptPrice = Number(unitPrice) || 0;
  const existingQty = Number(this.quantity) || 0;
  const existingWac = Number(this.averageCost) > 0 ? Number(this.averageCost) : Number(this.unitPrice || 0);

  if (qty > 0 && receiptPrice > 0) {
    const newTotalQty = existingQty + qty;
    this.averageCost = newTotalQty > 0
      ? Math.round((((existingQty * existingWac) + (qty * receiptPrice)) / newTotalQty) * 100) / 100
      : receiptPrice;
    // Keep list price aligned to latest receipt unless user manually changes later.
    this.unitPrice = receiptPrice;
  }

  this.quantity += quantity;
  this.lastRestocked = new Date();
  this.transactions.push({
    type: 'In',
    quantity,
    reference,
    notes,
    performedBy: userId
  });
  return this.save();
};

// Method to remove stock
inventorySchema.methods.removeStock = function(quantity, reference, notes, userId) {
  if (this.quantity < quantity) {
    throw new Error('Insufficient stock');
  }
  this.quantity -= quantity;
  this.transactions.push({
    type: 'Out',
    quantity,
    reference,
    notes,
    performedBy: userId
  });
  return this.save();
};

// Method to adjust stock
inventorySchema.methods.adjustStock = function(newQuantity, reference, notes, userId) {
  const difference = newQuantity - this.quantity;
  this.quantity = newQuantity;
  this.transactions.push({
    type: 'Adjustment',
    quantity: difference,
    reference,
    notes,
    performedBy: userId
  });
  return this.save();
};

// Static method to get statistics
inventorySchema.statics.getStatistics = async function() {
  const totalItems = await this.countDocuments();
  const inStock = await this.countDocuments({ status: 'In Stock' });
  const lowStock = await this.countDocuments({ status: 'Low Stock' });
  const outOfStock = await this.countDocuments({ status: 'Out of Stock' });
  
  const totalValue = await this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: '$totalValue' }
      }
    }
  ]);
  
  const byCategory = await this.aggregate([
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        totalValue: { $sum: '$totalValue' }
      }
    }
  ]);
  
  return {
    totalItems,
    inStock,
    lowStock,
    outOfStock,
    totalValue: totalValue[0]?.total || 0,
    byCategory
  };
};

/**
 * Generate a unique barcode string for an inventory item.
 * Format: SGC-{sanitisedItemCode}-{6-char random alphanumeric}
 * Retries until a unique value is found.
 */
inventorySchema.statics.generateBarcodeValue = async function (itemCode) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const sanitised = (itemCode || 'ITEM').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10);
  let barcode;
  let attempts = 0;
  do {
    const suffix = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    barcode = `SGC-${sanitised}-${suffix}`;
    const exists = await this.findOne({ barcode });
    if (!exists) break;
    attempts++;
  } while (attempts < 10);
  return barcode;
};

// Indexes for better performance
inventorySchema.index({ itemCode: 1 });
inventorySchema.index({ name: 1 });
inventorySchema.index({ category: 1 });
inventorySchema.index({ status: 1 });
inventorySchema.index({ supplier: 1 });
inventorySchema.index({ barcode: 1 });
inventorySchema.index({ store: 1, subStore: 1 });

const Inventory = mongoose.model('Inventory', inventorySchema);

module.exports = Inventory;

