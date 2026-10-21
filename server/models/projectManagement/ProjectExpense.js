const mongoose = require('mongoose');

const projectExpenseSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConstructionProject',
    required: true,
    index: true
  },
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectTask', default: null },

  /** Optional link — payment expense against an approved Check Request */
  checkRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CheckRequest',
    default: null,
    index: true
  },

  expenseNumber: { type: String, unique: true, sparse: true, trim: true },

  category: {
    type: String,
    enum: ['Civil Works', 'Finishes', 'Electrical', 'Plumbing', 'Sewerage', 'Water Supply & Gas', 'Labor', 'Consultancy', 'Materials', 'Contingency', 'Miscellaneous'],
    required: true
  },
  description: { type: String, required: true, trim: true },

  amount: { type: Number, required: true, min: 0 },
  expenseDate: { type: Date, required: true, default: Date.now },

  vendor: { type: String, trim: true },
  invoiceNumber: { type: String, trim: true },

  paymentStatus: {
    type: String,
    enum: ['Pending', 'Paid', 'Cancelled'],
    default: 'Pending'
  },
  paymentDate: { type: Date },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Bank Transfer', 'Cheque', 'Online'],
    default: 'Bank Transfer'
  },

  linkedPurchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },

  attachments: [{
    filename: { type: String, trim: true },
    url: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now }
  }],

  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date },

  notes: { type: String, trim: true },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Auto-generate expense number
projectExpenseSchema.pre('save', async function (next) {
  if (this.isNew && !this.expenseNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    this.expenseNumber = `EXP-${year}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

projectExpenseSchema.index({ project: 1, category: 1 });
projectExpenseSchema.index({ project: 1, expenseDate: -1 });
projectExpenseSchema.index({ paymentStatus: 1 });

module.exports = mongoose.model('ProjectExpense', projectExpenseSchema);
