const mongoose = require('mongoose');

/**
 * Stock Transfer Note (STN) — moves stock store → store and/or project → project.
 * Posted once on create by the route (no save hooks): OUT on the source ledger, IN on the destination ledger
 * at the source's average cost. The item's company-wide total and its Inventory GL balance do not change.
 */
const stockTransferSchema = new mongoose.Schema({
  transferNumber: { type: String, unique: true, trim: true },
  transferDate: { type: Date, required: true, default: Date.now },
  fromStore: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  fromStoreSnapshot: { type: String, trim: true },
  fromProject: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  toStore: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  toStoreSnapshot: { type: String, trim: true },
  toProject: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  reason: { type: String, required: true, trim: true },
  sentByName: { type: String, trim: true },
  receivedByName: { type: String, trim: true },
  vehicleNumber: { type: String, trim: true },
  items: [{
    _id: false,
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    itemCode: { type: String, trim: true },
    itemName: { type: String, trim: true },
    unit: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0 },
    notes: { type: String, trim: true }
  }],
  totalQuantity: { type: Number, default: 0 },
  totalValue: { type: Number, default: 0 },
  status: { type: String, enum: ['Completed'], default: 'Completed' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

stockTransferSchema.pre('save', async function (next) {
  if (!this.transferNumber) {
    const { nextDocumentNumber } = require('../../utils/documentSequence');
    this.transferNumber = await nextDocumentNumber({ key: 'STN', model: 'StockTransfer', field: 'transferNumber', prefix: 'STN', pad: 8 });
  }
  this.totalQuantity = (this.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  this.totalValue = Math.round((this.items || []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitCost) || 0), 0) * 100) / 100;
  next();
});

stockTransferSchema.index({ transferDate: -1 });
stockTransferSchema.index({ fromStore: 1, fromProject: 1 });
stockTransferSchema.index({ toStore: 1, toProject: 1 });

module.exports = mongoose.model('StockTransfer', stockTransferSchema);
