const mongoose = require('mongoose');

const utilityBillSchema = new mongoose.Schema({
  billId: {
    type: String,
    required: true,
    unique: true,
    default: function() {
      const prefix = this.utilityType ? this.utilityType.substring(0, 3).toUpperCase() : 'UB';
      return `${prefix}${Date.now().toString().slice(-6)}`;
    }
  },
  accountHead: {
    type: String,
    enum: ['President Personal', 'Head Office', 'SGCHQ', 'Boly.pk', 'Usman Solar', ''],
    default: '',
    trim: true
  },
  site: {
    type: String,
    trim: true,
    maxlength: [200, 'Site cannot exceed 200 characters']
  },
  utilityType: {
    type: String,
    required: true,
    enum: [
      'Electricity',    // K-Electric, WAPDA, etc.
      'Water',          // Water supply bills
      'Gas',            // Gas supply bills
      'Internet',       // Internet service bills
      'Phone',          // Phone/telecom bills
      'Maintenance',    // Building maintenance
      'Security',       // Security services
      'Cleaning',       // Cleaning services
      'Rent',           // Rent bills
      'Other'           // Other utility bills
    ],
    default: 'Electricity'
  },
  provider: {
    type: String,
    required: true,
    trim: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    default: null,
    index: true
  },
  /** When bill is for an employee (links to Finance AP / cash advance payee) */
  payeeEmployee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null,
    index: true
  },
  /** Bill created from Centralized Store catalog (vendor + line items) */
  useCentralizedStore: {
    type: Boolean,
    default: false
  },
  billLines: [{
    storeItem: { type: mongoose.Schema.Types.ObjectId, ref: 'UtilityStoreItem' },
    /** Snapshot of UtilityStoreItem.code at billing time (unique catalog product code). */
    itemCode: { type: String, trim: true, default: '' },
    itemName: { type: String, trim: true },
    description: { type: String, trim: true, default: '' },
    utilityType: { type: String, trim: true },
    meterNumber: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    site: { type: String, trim: true, default: '' },
    amount: { type: Number, min: 0, default: 0 },
    quantity: { type: Number, min: 0, default: 1 },
    unitPrice: { type: Number, min: 0, default: 0 },
    /** Absolute line discount (PKR); net amount = qty × unitPrice − discount */
    discount: { type: Number, min: 0, default: 0 },
    expenseAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
    expenseAccountNumber: { type: String, trim: true, default: '' },
    dueDate: { type: Date },
    /**
     * Scheduled payment amount for this line (entered after Due Date on Create Utility Bill).
     * Does NOT replace line.amount / bill.amount — applied for payment when dueDate passes.
     */
    duePaymentAmount: { type: Number, min: 0, default: 0 },
    /** Legacy single attachment (kept for backward compat with older bills). */
    attachmentUrl: { type: String, trim: true, default: '' },
    /** Multiple document images per line item (compressed on the client). */
    attachmentUrls: { type: [String], default: [] }
  }],
  accountNumber: {
    type: String,
    trim: true
  },
  billDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  /**
   * Total scheduled payment (usually sum of billLines.duePaymentAmount).
   * Independent of `amount` — used when due date passes; never overwrites bill amount.
   */
  duePaymentAmount: {
    type: Number,
    min: 0,
    default: 0
  },
  /** Set by overdue cron when duePaymentAmount becomes payable (due date passed). */
  duePaymentApplied: {
    type: Boolean,
    default: false
  },
  duePaymentAppliedAt: {
    type: Date
  },
  lastMonthAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  balanceAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  grandTotal: {
    type: Number,
    min: 0
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['Pending', 'Paid', 'Overdue', 'Partial'],
    default: 'Pending'
  },
  approvalStatus: {
    type: String,
    enum: ['Draft', 'Submitted', 'Approved', 'Rejected'],
    default: 'Draft',
    index: true
  },
  approvalChain: [{
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    /** manager | hod | sr_manager | avp_taj — used for labels & optional extras */
    role: {
      type: String,
      enum: ['manager', 'hod', 'sr_manager', 'avp_taj'],
      default: 'manager'
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    actedAt: {
      type: Date
    },
    comment: {
      type: String,
      trim: true
    }
  }],
  draftApproverIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  /** Draft slots with roles (centralized store optional Sr Manager / AVP Taj). */
  draftApprovalSlots: [{
    role: {
      type: String,
      enum: ['manager', 'hod', 'sr_manager', 'avp_taj'],
      required: true
    },
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  }],
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedAt: {
    type: Date
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  workflowHistory: [{
    fromStatus: { type: String, trim: true },
    toStatus: { type: String, trim: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    comments: { type: String, trim: true },
    module: { type: String, trim: true },
    stampUsed: { type: Boolean, default: false },
    stampImage: { type: String, trim: true }
  }],
  auditStatus: {
    type: String,
    enum: [
      'Not Sent',
      'Send to Audit',
      'Forwarded to Audit Director',
      'Approved (from Send to Audit)',
      'Approved (from Forwarded to Audit Director)',
      'Partially Paid (from Finance)',
      'Paid (from Finance)',
      'Returned from Audit',
      'Rejected (from Send to Audit)'
    ],
    default: 'Not Sent',
    index: true
  },
  observations: [{
    observation: { type: String, trim: true },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now },
    answer: { type: String, trim: true },
    answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    answeredAt: { type: Date },
    resolved: { type: Boolean, default: false }
  }],
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  /**
   * Finance returned the linked AP bill to the initiator (e.g. wrong company). While `active`, the initiator can
   * edit this bill and resubmit; the AP bill is rebuilt from it and goes straight back to Finance.
   */
  financeReturn: {
    active: { type: Boolean, default: false, index: true },
    reason: { type: String, trim: true, default: '' },
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    returnedAt: { type: Date, default: null },
    resubmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resubmittedAt: { type: Date, default: null }
  },
  /** Linked Finance AP bill (created after Audit Director final approval) */
  financeApBillId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AccountsPayable',
    default: null,
    index: true
  },
  financePostedAt: {
    type: Date,
    default: null
  },
  financePostedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  paymentDate: {
    type: Date
  },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Bank Transfer', 'Cheque', 'Online', 'Credit Card', 'Other', null],
    default: null
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  forWhat: {
    type: String,
    trim: true,
    maxlength: [1000, 'For what cannot exceed 1000 characters']
  },
  attachment: {
    type: String, // File path for bill attachment
    default: null
  },
  billImage: {
    type: String, // Image path for bill image
    default: null
  },
  location: {
    type: String,
    trim: true,
    default: 'Main Office'
  },
  department: {
    type: String,
    trim: true,
    maxlength: [100, 'Department cannot exceed 100 characters']
  },
  custodian: {
    type: String,
    trim: true,
    maxlength: [200, 'Custodian cannot exceed 200 characters']
  },
  // Additional fields for better management
  billingPeriod: {
    startDate: { type: Date },
    endDate: { type: Date }
  },
  previousReading: {
    type: Number,
    min: 0
  },
  currentReading: {
    type: Number,
    min: 0
  },
  units: {
    type: Number,
    min: 0
  },
  ratePerUnit: {
    type: Number,
    min: 0
  },
  taxes: {
    gst: { type: Number, default: 0 },
    other: { type: Number, default: 0 }
  },
  notes: {
    type: String,
    trim: true
  },
  /** True when this bill is the parent document that bundles several source bills */
  isConsolidated: {
    type: Boolean,
    default: false,
    index: true
  },
  /** Snapshot + link to each utility bill rolled into this consolidated bill */
  consolidatedFrom: [{
    bill: { type: mongoose.Schema.Types.ObjectId, ref: 'UtilityBill' },
    billId: { type: String, trim: true },
    utilityType: { type: String, trim: true },
    provider: { type: String, trim: true },
    site: { type: String, trim: true },
    department: { type: String, trim: true },
    custodian: { type: String, trim: true },
    accountNumber: { type: String, trim: true, default: '' },
    forWhat: { type: String, trim: true, default: '' },
    amount: { type: Number, min: 0 },
    lastMonthAmount: { type: Number, default: 0, min: 0 },
    billDate: { type: Date },
    dueDate: { type: Date }
  }],
  /** When set, this bill is only a line inside a consolidated parent (see that bill for one workflow) */
  consolidatedIntoBillId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UtilityBill',
    default: null,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes for performance
utilityBillSchema.index({ billId: 1 });
utilityBillSchema.index({ utilityType: 1 });
utilityBillSchema.index({ status: 1 });
utilityBillSchema.index({ approvalStatus: 1 });
utilityBillSchema.index({ billDate: -1 });
utilityBillSchema.index({ dueDate: 1 });
utilityBillSchema.index({ provider: 1 });
utilityBillSchema.index({ accountHead: 1 });
utilityBillSchema.index({ site: 1 });
utilityBillSchema.index({ location: 1 });
utilityBillSchema.index({ department: 1 });
utilityBillSchema.index({ custodian: 1 });
utilityBillSchema.index({ createdBy: 1 });

// Virtual for remaining amount
utilityBillSchema.virtual('remainingAmount').get(function() {
  return this.amount - this.paidAmount;
});

// Virtual for days overdue
utilityBillSchema.virtual('daysOverdue').get(function() {
  if (this.status === 'Overdue' && this.dueDate < new Date()) {
    return Math.ceil((new Date() - this.dueDate) / (1000 * 60 * 60 * 24));
  }
  return 0;
});

// Virtual for payment percentage
utilityBillSchema.virtual('paymentPercentage').get(function() {
  return this.amount > 0 ? Math.round((this.paidAmount / this.amount) * 100) : 0;
});

// Pre-save middleware to update status
utilityBillSchema.pre('save', function(next) {
  if (this.isModified('auditStatus')) {
    const status = String(this.auditStatus || '');
    this.$locals = this.$locals || {};
    this.$locals.postToFinanceAfterSave =
      status.startsWith('Approved (from ') && !this.consolidatedIntoBillId;
  }

  const now = new Date();
  
  if (this.paidAmount >= this.amount) {
    this.status = 'Paid';
    if (!this.paymentDate) {
      this.paymentDate = now;
    }
  } else if (this.paidAmount > 0) {
    this.status = 'Partial';
  } else if (this.dueDate < now) {
    this.status = 'Overdue';
  } else {
    this.status = 'Pending';
  }
  
  next();
});

// Auto-post to Finance when Audit Director final approval is saved on auditStatus
utilityBillSchema.post('save', async function postSaveUtilityBillFinance(doc) {
  if (!doc.$locals?.postToFinanceAfterSave) return;

  const actorId = doc.updatedBy || doc.financePostedBy || doc.createdBy;
  try {
    const { tryAutoPostUtilityBillToFinance } = require('../../utils/utilityBillFinance');
    const result = await tryAutoPostUtilityBillToFinance(doc._id, actorId);
    if (result?.posted) {
      console.log(`[UtilityBill] Finance posted for ${doc.billId}: AP ${result.billNumber || result.apId}`);
    } else if (result?.error) {
      console.error(`[UtilityBill] Finance post failed for ${doc.billId}:`, result.error);
    }
  } catch (err) {
    console.error(`[UtilityBill] Finance post error for ${doc.billId}:`, err.message);
  }
});

// Virtual for utility type description
utilityBillSchema.virtual('utilityTypeDescription').get(function() {
  const descriptions = {
    'Electricity': 'Electricity supply bill',
    'Water': 'Water supply bill',
    'Gas': 'Gas supply bill',
    'Internet': 'Internet service bill',
    'Phone': 'Phone/telecom bill',
    'Maintenance': 'Building maintenance bill',
    'Security': 'Security service bill',
    'Cleaning': 'Cleaning service bill',
    'Other': 'Other utility bill'
  };
  return descriptions[this.utilityType] || 'Utility bill';
});

// Method to get bill details
utilityBillSchema.methods.getBillDetails = function() {
  return {
    billId: this.billId,
    site: this.site,
    utilityType: this.utilityType,
    utilityTypeDescription: this.utilityTypeDescription,
    provider: this.provider,
    department: this.department,
    custodian: this.custodian,
    amount: this.amount,
    paidAmount: this.paidAmount,
    remainingAmount: this.remainingAmount,
    status: this.status,
    dueDate: this.dueDate,
    daysOverdue: this.daysOverdue,
    paymentPercentage: this.paymentPercentage
  };
};

module.exports = mongoose.model('UtilityBill', utilityBillSchema);
