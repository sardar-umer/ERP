const mongoose = require('mongoose');
const FinanceHelper = require('../../utils/financeHelper');

const goodsIssueSchema = new mongoose.Schema({
  issueNumber: {
    type: String,
    unique: true,
    required: false, // Auto-generated in pre-save hook
    trim: true
  },
  sinNumber: {
    type: String,
    trim: true
  },
  issueDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  issuingLocation: {
    type: String,
    trim: true,
    default: 'Main Store'
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    index: true,
    default: null
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
  /** Project stock the items come out of — required for both issue types (stock is held per store + project) */
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  /** 'project' = internal use; 'customer' = sold to a customer and billed later from AR Invoices */
  issueType: {
    type: String,
    enum: ['project', 'customer'],
    default: 'project',
    index: true
  },
  /** Same Finance → Customers list the AR invoice uses */
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesCustomer',
    default: null,
    index: true
  },
  customerName: {
    type: String,
    trim: true,
    default: ''
  },
  /** Optional traceability — SIN always issues stock by inventory line; these link back to the business document */
  referenceIndent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Indent'
  },
  referencePurchaseOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder'
  },
  referenceGoodsReceive: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GoodsReceive'
  },
  department: {
    type: String,
    required: true,
    trim: true,
    default: 'general'
  },
  departmentName: {
    type: String,
    trim: true
  },
  concernedDepartment: {
    type: String,
    trim: true
  },
  costCenter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CostCenter'
  },
  costCenterCode: {
    type: String,
    trim: true
  },
  costCenterName: {
    type: String,
    trim: true
  },
  requiredFor: {
    type: String,
    trim: true
  },
  justification: {
    type: String,
    trim: true
  },
  eprNo: {
    type: String,
    trim: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  requestedByName: {
    type: String,
    trim: true
  },
  items: [{
    inventoryItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      required: true
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
      min: 0
    },
    /** Legacy typed field (never moved stock) — returns now go through Store Return Notes */
    qtyReturned: {
      type: Number,
      default: 0,
      min: 0
    },
    /** Qty brought back to stock by Store Return Notes (kept by the SRN route, never typed) */
    qtyReturnedToStore: {
      type: Number,
      default: 0,
      min: 0
    },
    qtyIssued: {
      type: Number,
      default: 0,
      min: 0
    },
    balanceQty: {
      type: Number,
      default: 0,
      min: 0
    },
    issuedFromNewStock: {
      type: Boolean,
      default: true
    },
    issuedFromOldStock: {
      type: Boolean,
      default: false
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
    unit: {
      type: String,
      required: true
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
  purpose: {
    type: String,
    trim: true
  },
  /** Finance outcome per issued line (DR COGS / CR Inventory); failed / skipped lines show in Finance for retry */
  financePosting: [{
    _id: false,
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory' },
    itemName: { type: String, trim: true },
    qty: { type: Number, default: 0 },
    status: { type: String, enum: ['posted', 'skipped', 'failed'] },
    reason: { type: String, trim: true, default: '' },
    journalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
    amount: { type: Number, default: 0 },
    at: { type: Date, default: Date.now }
  }],
  financePostingStatus: { type: String, enum: ['posted', 'partial', 'failed', 'not_posted', ''], default: '', index: true },
  notes: {
    type: String,
    trim: true
  },
  returnedByName: {
    type: String,
    trim: true
  },
  approvedByName: {
    type: String,
    trim: true
  },
  issuedByName: {
    type: String,
    trim: true
  },
  receivedByName: {
    type: String,
    trim: true
  },
  issuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Issued', 'Cancelled'],
    default: 'Issued'
  },
  cancelledAt: { type: Date },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelReason: { type: String, trim: true, default: '' },
  /** Outward Gate Pass / Delivery Note — lets the issued goods leave the premises (number given once) */
  gatePass: {
    number: { type: String, trim: true },
    vehicleNumber: { type: String, trim: true },
    driverName: { type: String, trim: true },
    driverPhone: { type: String, trim: true },
    transporter: { type: String, trim: true },
    deliverTo: { type: String, trim: true },
    deliveryAddress: { type: String, trim: true },
    remarks: { type: String, trim: true },
    returnable: { type: Boolean, default: false },
    dispatchedAt: { type: Date },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }
}, {
  timestamps: true
});

// Pre-save: Generate SIN number (Store Issue Note) and issueNumber if not provided
goodsIssueSchema.pre('save', async function(next) {
  if (!this.issueNumber) {
    const { nextDocumentNumber } = require('../../utils/documentSequence');
    const sin = await nextDocumentNumber({ key: 'SIN', model: 'GoodsIssue', field: 'issueNumber', prefix: 'SIN', pad: 8 });
    this.sinNumber = sin;
    this.issueNumber = sin;
  }
  if (!this.sinNumber && this.issueNumber) {
    this.sinNumber = this.issueNumber;
  }

  if (this.items && this.items.length > 0) {
    this.totalItems = this.items.length;
    this.items.forEach((item) => {
      const issued = item.qtyIssued ?? item.quantity ?? 0;
      item.qtyIssued = issued;
      if (item.quantity === undefined) item.quantity = issued;
    });
    this.totalQuantity = this.items.reduce((sum, item) => sum + (item.qtyIssued ?? item.quantity ?? 0), 0);
  }

  next();
});

// Post-save: Update inventory and create stock transactions if status is 'Issued'
goodsIssueSchema.post('save', async function(doc) {
  if (doc.status === 'Issued' && doc.items && doc.items.length > 0) {
    if (!doc.project) {
      console.error('GoodsIssue post-save: project is required');
      return;
    }
    
    const Inventory = mongoose.model('Inventory');
    const StockTransaction = mongoose.model('StockTransaction');
    const StockQuant = mongoose.model('StockQuant');
    const Store = mongoose.model('Store');
    // store is now an ObjectId; fall back to inventory row store (matches GRN / SIN validation)
    const storeId = doc.store?._id || doc.store;
    const projectId = doc.project._id || doc.project;
    const issueNumber = doc.issueNumber || doc.sinNumber || 'SIN';
    const qtyToDeduct = (item) => item.qtyIssued ?? item.quantity ?? 0;
    let defaultStoreForOut = undefined;
    const ensureDefaultStoreOut = async () => {
      if (defaultStoreForOut !== undefined) return defaultStoreForOut;
      defaultStoreForOut = await Store.findOne({ isActive: true }).sort({ type: 1, createdAt: 1 }).select('_id name').lean();
      return defaultStoreForOut;
    };

    // Lines already posted to Finance on an earlier save are never posted twice
    const postedBefore = new Map((doc.financePosting || [])
      .filter((r) => r.status === 'posted').map((r) => [String(r.inventoryItem), r]));
    const financeResults = [];

    for (const item of doc.items) {
      const qty = qtyToDeduct(item);
      if (qty <= 0) continue;
      try {
        const inventory = await Inventory.findById(item.inventoryItem);
        if (inventory) {
          await inventory.removeStock(
            qty,
            issueNumber,
            item.notes || `Issued via ${issueNumber} (Store Issue Note)`,
            doc.issuedBy
          );

          // COGS journal: always attempted (category / global accounts may apply); the outcome is recorded
          const earlier = postedBefore.get(String(inventory._id));
          const posting = earlier
            ? { status: 'posted', journalEntry: earlier.journalEntry, amount: earlier.amount }
            : await FinanceHelper.postSINJournal({
              inventoryItem: inventory,
              sinDoc: doc,
              qty,
              createdBy: doc.issuedBy,
              companyId: doc.companyId
            });
          financeResults.push({
            inventoryItem: inventory._id,
            itemName: inventory.name,
            qty,
            status: posting?.status || 'failed',
            reason: posting?.reason || '',
            journalEntry: posting?.journalEntry,
            amount: posting?.amount || 0
          });

          const invStoreId = inventory.store?._id || inventory.store;
          let txStoreId = item.subStore?._id || item.subStore || storeId || invStoreId;
          if (!txStoreId) {
            const ds = await ensureDefaultStoreOut();
            txStoreId = ds ? ds._id : null;
          }
          if (txStoreId && projectId) {
            try {
              await StockQuant.deductStock(txStoreId, projectId, inventory._id, qty);
            } catch (sqErr) {
              console.error('StockQuant deductStock notice:', sqErr.message);
            }
          }

          const currentBalance = await StockTransaction.getBalance(txStoreId, projectId, inventory._id);
          const balanceAfter = currentBalance - qty;

          await StockTransaction.create({
            store: txStoreId,
            storeSnapshot: doc.storeSnapshot || doc.issuingLocation || 'Main Store',
            project: projectId,
            item: inventory._id,
            itemCode: item.itemCode || inventory.itemCode,
            itemName: item.itemName || inventory.name,
            transactionType: 'OUT',
            quantity: -qty,
            unit: item.unit || inventory.unit,
            unitPrice: 0,
            referenceType: 'SIN',
            referenceId: doc._id,
            referenceNumber: issueNumber,
            balanceAfter,
            location: {
              rack: item.location?.rack || '',
              shelf: item.location?.shelf || '',
              bin: item.location?.bin || ''
            },
            description: `Issued via ${issueNumber} (Store Issue Note)`,
            notes: item.notes || '',
            createdBy: doc.issuedBy
          });
        }
      } catch (error) {
        console.error(`Error updating inventory for item ${item.itemCode}:`, error.message);
        financeResults.push({ inventoryItem: item.inventoryItem, itemName: item.itemName, qty, status: 'failed', reason: error.message });
      }
    }

    if (financeResults.length) {
      const posted = financeResults.filter((r) => r.status === 'posted').length;
      const financePostingStatus = posted === financeResults.length ? 'posted' : posted ? 'partial'
        : financeResults.some((r) => r.status === 'failed') ? 'failed' : 'not_posted';
      // updateOne (not save) so this hook does not run again
      await doc.constructor.updateOne({ _id: doc._id }, { $set: { financePosting: financeResults, financePostingStatus } })
        .catch((e) => console.error('GoodsIssue finance outcome not recorded:', e.message));
    }
  }
});

goodsIssueSchema.index({ issueNumber: 1 });
goodsIssueSchema.index({ issueDate: -1 });
goodsIssueSchema.index({ department: 1 });
goodsIssueSchema.index({ status: 1 });

module.exports = mongoose.model('GoodsIssue', goodsIssueSchema);
