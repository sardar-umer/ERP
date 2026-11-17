const mongoose = require('mongoose');

const cashApprovalSchema = new mongoose.Schema({
  caNumber: {
    type: String,
    unique: true,
    trim: true
  },
  originatingModule: {
    type: String,
    enum: ['procurement', 'general', 'admin', 'hr', 'finance'],
    default: 'procurement',
    index: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    default: null,
    index: true
  },
  requestingDepartment: {
    type: String,
    trim: true,
    default: ''
  },
  purpose: {
    type: String,
    trim: true,
    default: ''
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  indent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Indent'
  },
  /** Store cost center — from the indent when there is one, else picked on the form (utils/costCenterPolicy) */
  costCenter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CostCenter',
    default: null
  },
  quotation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quotation'
  },
  approvalDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  expectedPurchaseDate: {
    type: Date
  },
  deliveryAddress: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: [
      'Draft',
      'Pending Approval',
      'Pending Audit',
      'Forwarded to Audit Director',
      'Send to CEO Office',
      'Forwarded to CEO',
      'Pending Finance',
      'Finance Authority Approved',
      'Advance Issued',
      'Evidence Submitted',
      'Payment Settled',
      'Sent to Procurement',
      'Completed',
      'Cancelled',
      'Rejected',
      'Returned from Audit',
      'Returned from CEO Office',
      'Returned from CEO Secretariat'
    ],
    default: 'Draft'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Urgent'
  },

  // ─── Items ───────────────────────────────────────────────────────────────────
  items: [{
    itemName: { type: String, trim: true, default: '' },
    productCode: { type: String, trim: true },
    description: { type: String, trim: true, default: '' },
    specification: { type: String, trim: true },
    location: { type: String, trim: true, default: '' },
    brand: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    discount: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true },
    attachments: [{
      filename: { type: String },
      originalName: { type: String },
      url: { type: String },
      mimeType: { type: String },
      uploadedAt: { type: Date, default: Date.now }
    }]
  }],

  /** General module: Manager + HOD approval (same pattern as utility / centralized store bills) */
  departmentApprovalStatus: {
    type: String,
    enum: ['Draft', 'Submitted', 'Approved', 'Rejected'],
    default: 'Draft',
    index: true
  },
  draftApproverIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  departmentApprovalChain: [{
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    actedAt: { type: Date },
    comment: { type: String, trim: true }
  }],
  departmentApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  departmentApprovedAt: { type: Date },
  departmentRejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  departmentRejectedAt: { type: Date },
  departmentRejectionReason: { type: String, trim: true },
  subtotal: { type: Number, required: true, default: 0 },
  taxAmount: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  shippingCost: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true, default: 0 },

  // ─── Approval Authorities (5-person signature block) ─────────────────────────
  approvalAuthorities: {
    preparedBy: { type: String, trim: true, default: '' },
    verifiedBy: { type: String, trim: true, default: '' },
    authorisedRep: { type: String, trim: true, default: '' },
    financeRep: { type: String, trim: true, default: '' },
    managerProcurement: { type: String, trim: true, default: '' }
  },
  authorityApprovals: [{
    authorityKey: { type: String, trim: true },
    authorityLabel: { type: String, trim: true },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date, default: Date.now },
    comments: { type: String, trim: true }
  }],
  authorityApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorityApprovedAt: { type: Date },
  authorityApprovalComments: { type: String, trim: true },

  // ─── Audit workflow ───────────────────────────────────────────────────────────
  preAuditInitialApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  preAuditInitialApprovedAt: { type: Date },
  preAuditInitialComments: { type: String },
  auditApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auditApprovedAt: { type: Date },
  auditRemarks: { type: String },
  auditObservations: [{
    observation: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    addedAt: { type: Date, default: Date.now },
    answer: { type: String, trim: true },
    answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    answeredAt: { type: Date },
    resolved: { type: Boolean, default: false }
  }],
  auditReturnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auditReturnedAt: { type: Date },
  auditReturnComments: { type: String },
  auditRejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  auditRejectedAt: { type: Date },
  auditRejectionComments: { type: String },
  auditSnapshotAtReturn: { type: mongoose.Schema.Types.Mixed },
  resubmissionChangeSummary: { type: String, trim: true },

  // ─── CEO workflow ─────────────────────────────────────────────────────────────
  ceoForwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ceoForwardedAt: { type: Date },
  ceoApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ceoApprovedAt: { type: Date },
  ceoApprovalComments: { type: String },
  ceoDigitalSignature: { type: String },
  ceoRejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ceoRejectedAt: { type: Date },
  ceoRejectionComments: { type: String },
  ceoReturnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ceoReturnedAt: { type: Date },
  ceoReturnComments: { type: String },

  /**
   * Status to restore on initiator resubmit after return/reject
   * (e.g. 'Forwarded to CEO'). Prior approvals stay intact.
   */
  returnedFromStatus: { type: String, trim: true, default: '' },

  // ─── Finance: Advance ────────────────────────────────────────────────────────
  // Who will physically receive the advance (procurement officer / buyer)
  advanceTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  advanceToName: { type: String, trim: true },
  /** General module: HR employee receiving the advance */
  advanceToEmployee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null,
    index: true
  },
  /** GL asset — Advances to employees (per-employee sub-account when applicable) */
  advanceGlAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    default: null
  },
  advanceGlAccountNumber: {
    type: String,
    trim: true,
    default: ''
  },
  advanceAmount: { type: Number, default: 0 },
  /** Amount of this advance applied to external AP bills (Bill Payment adjustment) */
  apAdvanceApplied: { type: Number, default: 0 },
  advancePaymentMethod: {
    type: String,
    enum: ['Cash', 'Bank Transfer', 'Cheque', 'Online Transfer'],
    default: 'Cash'
  },
  advanceVoucherNo: { type: String, trim: true },
  advanceWhtRate: { type: Number, default: 0 },
  advanceBankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    default: null
  },
  advanceRemarks: { type: String, trim: true },
  advanceIssuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  advanceIssuedAt: { type: Date },
  voucherEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  signedCheckNumber: { type: String, trim: true },
  signedCheckDate: { type: Date },
  signedCheckBankName: { type: String, trim: true },
  signedCheckRemarks: { type: String, trim: true },
  signedCheckAttachments: [{
    filename: { type: String },
    originalName: { type: String },
    url: { type: String },
    mimeType: { type: String },
    uploadedAt: { type: Date, default: Date.now }
  }],
  financeApprovalAuthorities: {
    accountsOfficerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    accountsManagerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    financeControllerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  financeAuthorityApprovals: [{
    authorityKey: { type: String, trim: true },
    authorityLabel: { type: String, trim: true },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decision: { type: String, enum: ['approved', 'rejected'], default: 'approved' },
    approvedAt: { type: Date, default: Date.now },
    comments: { type: String, trim: true }
  }],
  financeRejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  financeRejectedAt: { type: Date },
  financeRejectionComments: { type: String, trim: true },
  financeAuthoritiesAssignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  financeAuthoritiesAssignedAt: { type: Date },

  // ─── Procurement Evidence Submission (after advance issued, before finance settles) ──
  evidenceSubmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  evidenceSubmittedAt: { type: Date },
  purchaseInvoiceNo: { type: String, trim: true },
  evidenceActualAmount: { type: Number, default: 0 },
  evidenceRemarks: { type: String, trim: true },
  purchaseReceipts: [{
    filename: { type: String },
    originalName: { type: String },
    url: { type: String },
    mimeType: { type: String },
    uploadedAt: { type: Date, default: Date.now }
  }],

  // ─── Finance: Settlement ──────────────────────────────────────────────────────
  actualAmountSpent: { type: Number, default: 0 },
  excessReturned: { type: Number, default: 0 },
  additionalPaid: { type: Number, default: 0 },
  receiptAttachments: [{
    filename: { type: String },
    url: { type: String },
    uploadedAt: { type: Date, default: Date.now }
  }],
  settlementRemarks: { type: String, trim: true },
  settlementDate: { type: Date },
  settledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  financeVerificationNotes: { type: String, trim: true },

  // ─── Finance: Sent back ───────────────────────────────────────────────────────
  sentToProcurementBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sentToProcurementAt: { type: Date },
  sentToProcurementRemarks: { type: String, trim: true },

  // ─── Procurement completion ───────────────────────────────────────────────────
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  completedAt: { type: Date },
  completionRemarks: { type: String, trim: true },

  notes: { type: String, trim: true },
  internalNotes: { type: String, trim: true },
  attachments: [{
    filename: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  workflowHistory: [{
    fromStatus: { type: String, trim: true },
    toStatus: { type: String, trim: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    comments: { type: String, trim: true },
    module: { type: String, trim: true },
    stampUsed: { type: Boolean, default: false },
    stampImage: { type: String, trim: true }
  }]
}, {
  timestamps: true
});

// ─── Cost center: copied from the indent when it has one; required from the go-live date ─────────────────────
cashApprovalSchema.pre('save', async function (next) {
  try {
    if (!(this.isNew || this.isModified('indent') || this.isModified('costCenter') || this.isModified('companyId'))) return next();
    let chainStartDate = null;
    if (this.indent) {
      const indent = await mongoose.model('Indent').findById(this.indent).select('costCenter createdAt').lean();
      if (indent) {
        chainStartDate = indent.createdAt;
        // Copied when the CA is raised from the indent; a later Finance correction is kept
        if (indent.costCenter && (this.isNew || this.isModified('indent'))) this.costCenter = indent.costCenter;
      }
    }
    const { checkDocumentCostCenter } = require('../../utils/costCenterPolicy');
    await checkDocumentCostCenter(this, { chainStartDate, label: 'Cash approval' });
    next();
  } catch (err) {
    next(err);
  }
});

// ─── Auto-generate CA number ──────────────────────────────────────────────────
cashApprovalSchema.pre('save', async function (next) {
  if (this.isNew && !this.caNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const prefix = `CA-${year}${month}`;
    const last = await this.constructor.findOne({
      caNumber: new RegExp(`^${prefix}`)
    }).sort({ caNumber: -1 });
    let seq = 1;
    if (last && last.caNumber) {
      const parts = last.caNumber.split('-');
      const lastSeq = parseInt(parts[2]);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }
    this.caNumber = `${prefix}-${String(seq).padStart(4, '0')}`;
  }

  // Recalculate totals
  if (this.items && this.items.length > 0) {
    this.subtotal = this.items.reduce((sum, item) => {
      return sum + ((item.quantity * item.unitPrice) - (item.discount || 0));
    }, 0);
    this.taxAmount = this.items.reduce((sum, item) => {
      const base = (item.quantity * item.unitPrice) - (item.discount || 0);
      return sum + (base * (item.taxRate || 0) / 100);
    }, 0);
    this.discountAmount = this.items.reduce((sum, item) => sum + (item.discount || 0), 0);
    this.totalAmount = this.subtotal + this.taxAmount + (this.shippingCost || 0);
  }

  if (!this.companyId) {
    try {
      const { resolveDocumentCompanyId } = require('../../utils/financeCompanyContext');
      this.companyId = await resolveDocumentCompanyId({
        employeeId: this.advanceToEmployee,
        indentId: this.indent
      });
    } catch {
      /* keep null — historical fallback at posting time */
    }
  }

  next();
});

cashApprovalSchema.statics.getStatistics = async function () {
  const stats = await this.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' } } }
  ]);
  const totalCAs = await this.countDocuments();
  const totalValueAgg = await this.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]);
  return {
    totalCAs,
    totalValue: totalValueAgg[0]?.total || 0,
    byStatus: stats
  };
};

const CashApproval = mongoose.model('CashApproval', cashApprovalSchema);
module.exports = CashApproval;
