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
    // 'General' is legacy only (ad-hoc bills retired — subcontractor money goes through IPCs)
    enum: ['Subcontractor_IPC', 'Client_Invoice', 'General'],
    default: 'Subcontractor_IPC'
  },
  ipcNumber: { type: Number, default: 1 },
  /**
   * Subcontractor IPC kinds (all go through the same approval chain):
   * Work = certified work from a verified check request; Advance = mobilisation advance against a sublet
   * contract (recovered from later Work IPCs); Retention Release = pays back retention held.
   */
  ipcKind: { type: String, enum: ['Work', 'Advance', 'Retention Release'], default: 'Work', index: true },
  /** Client Invoice built from verified work: which check-request lines (and how much) it bills */
  clientBillingSources: [{
    _id: false,
    checkRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'CheckRequest' },
    crItem: { type: mongoose.Schema.Types.ObjectId },
    quantity: { type: Number, default: 0 },
    /** Slab stage billed to the client (quantity unused): the client amount for that stage */
    slabAmount: { type: Number, default: 0 },
    costAmount: { type: Number, default: 0 }
  }],
  /** Client invoices: Finance Accounts Receivable entry (posted when the invoice is sent) */
  financeArId: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountsReceivable', default: null },
  financeArNumber: { type: String, trim: true, default: '' },
  subletContract: { type: mongoose.Schema.Types.ObjectId, ref: 'SubletContract', default: null },
  /** Advance only: % of each later Work IPC's gross recovered against this advance */
  advanceRecoveryPercent: { type: Number, default: 0, min: 0, max: 100 },

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
  /** Each payment recorded against this IPC / invoice; paidAmount is their sum */
  payments: [{
    amount: { type: Number, required: true, min: 0.01 },
    paidDate: { type: Date, default: Date.now },
    paymentMethod: { type: String, trim: true, default: '' },
    paymentReference: { type: String, trim: true, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recordedAt: { type: Date, default: Date.now }
  }],
  cancelledAt: { type: Date },
  cancellationReason: { type: String, trim: true, default: '' },

  // ─── IPC approval chain (same stages as Cash Approvals) ─────────────────────
  // Draft → Pending Audit (pre-audit initial approval) → Forwarded to Audit Director →
  // Send to CEO Office (PS) → Forwarded to CEO → Approved (posted to Finance AP).
  // Any stage can reject → Rejected (returnedFromStatus remembers where), initiator revises and resubmits.
  approvalStatus: {
    type: String,
    enum: ['Draft', 'Pending Audit', 'Forwarded to Audit Director', 'Send to CEO Office', 'Forwarded to CEO', 'Rejected', 'Approved'],
    default: 'Draft',
    index: true
  },
  returnedFromStatus: { type: String, trim: true, default: '' },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedAt: { type: Date },
  preAuditInitialApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  preAuditInitialApprovedAt: { type: Date },
  preAuditInitialComments: { type: String, trim: true, default: '' },
  auditApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auditApprovedAt: { type: Date },
  auditComments: { type: String, trim: true, default: '' },
  ceoForwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ceoForwardedAt: { type: Date },
  ceoApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ceoApprovedAt: { type: Date },
  ceoComments: { type: String, trim: true, default: '' },
  ceoDigitalSignature: { type: String, trim: true, default: '' },
  rejection: {
    stage: { type: String, trim: true, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date },
    comments: { type: String, trim: true, default: '' }
  },
  observations: [{
    observation: { type: String, trim: true, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    stage: { type: String, trim: true, default: '' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false },
    initiatorResponse: { type: String, trim: true, default: '' }
  }],
  workflowHistory: [{
    fromStatus: { type: String, trim: true },
    toStatus: { type: String, trim: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    comments: { type: String, trim: true, default: '' },
    module: { type: String, trim: true, default: '' }
  }],

  // ─── Finance hand-off (Accounts Payable bill + GL) ─────────────────────────
  financeApBillId: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountsPayable', default: null },
  financeBillNumber: { type: String, trim: true, default: '' },
  financePostedAt: { type: Date },
  financePostingError: { type: String, trim: true, default: '' },
  /** Last daily "still waiting" reminder sent for this IPC */
  lastReminderAt: { type: Date, default: null },
  paidDate: { type: Date },
  paymentMethod: { type: String, trim: true },
  paymentReference: { type: String, trim: true },

  notes: { type: String, trim: true },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Auto-generate invoice number (PI = Project Invoice)
projectInvoiceSchema.pre('save', async function (next) {
  if (this.isNew && !this.invoiceNumber) {
    // Next number after the highest one this year (a count repeats numbers once anything is deleted)
    const year = new Date().getFullYear();
    const prefix = `PI-${year}-`;
    const latest = await this.constructor
      .findOne({ invoiceNumber: new RegExp(`^${prefix}`) })
      .sort({ invoiceNumber: -1 })
      .select('invoiceNumber')
      .lean();
    const last = latest ? parseInt(latest.invoiceNumber.split('-').pop(), 10) : 0;
    this.invoiceNumber = `${prefix}${String((Number.isNaN(last) ? 0 : last) + 1).padStart(4, '0')}`;
  }
  next();
});

projectInvoiceSchema.index({ project: 1, status: 1 });
projectInvoiceSchema.index({ issueDate: -1 });

module.exports = mongoose.model('ProjectInvoice', projectInvoiceSchema);
