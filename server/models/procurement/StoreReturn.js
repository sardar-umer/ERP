const mongoose = require('mongoose');

/**
 * Store Return Note (SRN) — items issued on a Store Issue Note coming back to the store.
 * Posted once on create by the route (no save hooks): stock back in at the SIN's issue cost,
 * project ledger IN, and DR Inventory / CR COGS (reverses the SIN's COGS entry for the returned qty).
 */
const storeReturnSchema = new mongoose.Schema({
  returnNumber: { type: String, unique: true, trim: true },
  returnDate: { type: Date, required: true, default: Date.now },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlacementCompany', default: null, index: true },
  goodsIssue: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsIssue', required: true, index: true },
  sinNumber: { type: String, trim: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  storeSnapshot: { type: String, trim: true },
  issueType: { type: String, enum: ['project', 'customer'], default: 'project' },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesCustomer', default: null },
  customerName: { type: String, trim: true, default: '' },
  /** 'return' = items came back; 'cancellation' = whole SIN reversed */
  kind: { type: String, enum: ['return', 'cancellation'], default: 'return' },
  reason: { type: String, required: true, trim: true },
  returnedByName: { type: String, trim: true },
  receivedByName: { type: String, trim: true },
  items: [{
    _id: false,
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    itemCode: { type: String, trim: true },
    itemName: { type: String, trim: true },
    unit: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0 },
    condition: { type: String, enum: ['good', 'damaged'], default: 'good' },
    notes: { type: String, trim: true }
  }],
  totalQuantity: { type: Number, default: 0 },
  totalValue: { type: Number, default: 0 },
  financePosting: [{
    _id: false,
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory' },
    itemName: { type: String, trim: true },
    status: { type: String, enum: ['posted', 'skipped', 'failed'] },
    reason: { type: String, trim: true, default: '' },
    journalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
    amount: { type: Number, default: 0 }
  }],
  financePostingStatus: { type: String, enum: ['posted', 'partial', 'failed', 'not_posted', ''], default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

storeReturnSchema.pre('save', async function (next) {
  if (!this.returnNumber) {
    const { nextDocumentNumber } = require('../../utils/documentSequence');
    this.returnNumber = await nextDocumentNumber({ key: 'SRN', model: 'StoreReturn', field: 'returnNumber', prefix: 'SRN', pad: 8 });
  }
  this.totalQuantity = (this.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  this.totalValue = Math.round((this.items || []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitCost) || 0), 0) * 100) / 100;
  next();
});

storeReturnSchema.index({ returnDate: -1 });

module.exports = mongoose.model('StoreReturn', storeReturnSchema);
