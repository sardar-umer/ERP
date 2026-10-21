const mongoose = require('mongoose');

const projectInvoiceSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConstructionProject',
    required: true,
    index: true
  },
  masterProject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConstructionProject',
    default: null,
    index: true
  },

  invoiceNumber: { type: String, unique: true, sparse: true, trim: true },

  // Subcontractor & IPC Details
  contractor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
  invoiceType: {
    type: String,
    enum: ['Subcontractor_IPC', 'Client_Invoice', 'General'],
    default: 'Subcontractor_IPC'
  },
  ipcNumber: { type: Number, default: 1 },

  // Line items for Progress-Based IPC Invoices
  items: [{
    boqItem: { type: mongoose.Schema.Types.ObjectId, ref: 'BOQItem' },
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    unit: { type: String, trim: true },
    previousQuantity: { type: Number, default: 0 },
    currentQuantity: { type: Number, default: 0 },
    cumulativeQuantity: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    currentAmount: { type: Number, default: 0 }
  }],

  // Financial Breakdown & Deductions
  grossAmount: { type: Number, default: 0 },
  retentionPercentage: { type: Number, default: 0 },
  retentionAmount: { type: Number, default: 0 },
  advanceRecoveryAmount: { type: Number, default: 0 },
  whtPercentage: { type: Number, default: 0 },
  whtAmount: { type: Number, default: 0 },
  netPayableAmount: { type: Number, default: 0 },

  // Milestone link (optional — manual invoices have no milestone)
  milestoneId: { type: mongoose.Schema.Types.ObjectId, default: null },
  milestoneName: { type: String, trim: true },

  // Link to BOQ item if invoice is raised against BOQ (Option B)
  boqItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BOQItem', default: null },

  /** Subcontractor IPC must be raised from an approved Check Request */
  checkRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CheckRequest',
    default: null,
    index: true
  },

  // Client info (snapshot from project at invoice time)
  clientName: { type: String, trim: true },
  clientContact: { type: String, trim: true },
  clientAddress: { type: String, trim: true },

  // Billing
  contractValue: { type: Number, default: 0, min: 0 },
  billingPercentage: { type: Number, default: 0, min: 0, max: 100 },
  invoiceAmount: { type: Number, required: true, min: 0 },

  description: { type: String, trim: true },

  issueDate: { type: Date, default: Date.now },
  dueDate: { type: Date },

  status: {
    type: String,
    enum: ['Draft', 'Sent', 'Paid', 'Partially Paid', 'Cancelled'],
    default: 'Draft'
  },

  paidAmount: { type: Number, default: 0, min: 0 },
  paidDate: { type: Date },
  paymentMethod: { type: String, trim: true },
  paymentReference: { type: String, trim: true },

  notes: { type: String, trim: true },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Auto-generate invoice number (PI = Project Invoice)
projectInvoiceSchema.pre('save', async function (next) {
  if (this.isNew && !this.invoiceNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments();
    this.invoiceNumber = `PI-${year}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

projectInvoiceSchema.index({ project: 1, status: 1 });
projectInvoiceSchema.index({ issueDate: -1 });

module.exports = mongoose.model('ProjectInvoice', projectInvoiceSchema);
