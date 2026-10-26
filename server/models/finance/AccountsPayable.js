const mongoose = require('mongoose');

const accountsPayableSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    default: null,
    index: true
  },
  // Vendor information
  vendor: {
    name: {
      type: String,
      required: [true, 'Vendor name is required'],
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      trim: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    },
    taxId: {
      type: String,
      trim: true
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier' // References Supplier model in server/models/hr/Supplier.js
    }
  },
  /** Employee payee when bill settles a cash approval advance */
  payeeEmployee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null,
    index: true
  },
  employeeAdvanceAllocations: [{
    cashApprovalId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashApproval' },
    caNumber: { type: String, trim: true },
    amount: { type: Number, default: 0 },
    appliedAt: { type: Date, default: Date.now }
  }],
  // Bill details
  billNumber: {
    type: String,
    required: [true, 'Bill number is required'],
    trim: true
  },
  vendorInvoiceNumber: {
    type: String,
    trim: true
  },
  billDate: {
    type: Date,
    required: [true, 'Bill date is required'],
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: [true, 'Due date is required']
  },
  // Financial details
  subtotal: {
    type: Number,
    required: [true, 'Subtotal is required'],
    min: [0, 'Subtotal cannot be negative'],
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  taxAmount: {
    type: Number,
    default: 0,
    min: [0, 'Tax amount cannot be negative'],
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: [0, 'Discount amount cannot be negative'],
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  totalAmount: {
    type: Number,
    required: [true, 'Total amount is required'],
    min: [0, 'Total amount cannot be negative'],
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  /**
   * Scheduled payment after due date (from Centralized Store / Utility bills).
   * Independent of totalAmount (original bill). Once dueDate has passed, payable /
   * open balance / payment cap use this amount dynamically.
   */
  duePaymentAmount: {
    type: Number,
    min: 0,
    default: 0,
    get: function(val) {
      return Math.round((Number(val) || 0) * 100) / 100;
    },
    set: function(val) {
      return Math.round((Number(val) || 0) * 100) / 100;
    }
  },
  amountPaid: {
    type: Number,
    default: 0,
    min: [0, 'Amount paid cannot be negative'],
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  advanceApplied: {
    type: Number,
    default: 0,
    min: [0, 'Advance applied cannot be negative'],
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  /** Advance apply submitted; voucher pending finance signatures */
  advancePending: {
    type: Number,
    default: 0,
    min: 0,
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  /** Bank/cash payment submitted; voucher pending finance signatures */
  paymentPending: {
    type: Number,
    default: 0,
    min: 0,
    get: function(val) {
      return Math.round(val * 100) / 100;
    },
    set: function(val) {
      return Math.round(val * 100) / 100;
    }
  },
  balanceDue: {
    type: Number,
    get: function() {
      const total = Number(this.totalAmount) || 0;
      const duePay = Number(this.duePaymentAmount) || 0;
      let payableBase = total;
      if (duePay > total + 0.009 && this.dueDate) {
        const due = new Date(this.dueDate);
        if (!Number.isNaN(due.getTime())) {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          if (due < startOfToday) payableBase = duePay;
        }
      }
      return Math.round(
        (payableBase
          - (this.amountPaid || 0)
          - (this.advanceApplied || 0)
          - (this.advancePending || 0)
          - (this.paymentPending || 0)) * 100
      ) / 100;
    }
  },
  // Payment terms
  paymentTerms: {
    type: String,
    enum: ['net_15', 'net_30', 'net_45', 'net_60', 'due_on_receipt', 'custom', 'Cash', 'cash', 'Immediate', 'immediate'],
    default: 'net_30'
  },
  // Status tracking
  status: {
    type: String,
    enum: [
      'draft',
      'received',
      'approved',
      'partial',
      'paid',
      'overdue',
      'cancelled',
      'Pending Audit',
      'Forwarded to Audit Director',
      'Returned from Audit',
      // Finance returned to initiator for correction — dept approvalChain stays intact
      'Returned from Finance'
    ],
    default: 'draft'
  },
  // Department integration
  department: {
    type: String,
    trim: true,
    default: 'procurement'
  },
  module: {
    type: String,
    trim: true,
    default: 'general'
  },
  // Reference to source document
  referenceId: {
    type: mongoose.Schema.Types.ObjectId
  },
  referenceType: {
    type: String,
    enum: ['purchase_order', 'grn', 'sin', 'receipt', 'service', 'product', 'bill', 'manual', 'utility_bill', 'project_ipc'],
    default: 'manual'
  },
  preAuditInitialApprovedAt: { type: Date },
  preAuditInitialApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Line items
  lineItems: [{
    itemName: {
      type: String,
      trim: true,
      default: ''
    },
    itemCode: {
      type: String,
      trim: true,
      default: ''
    },
    description: {
      type: String,
      required: [true, 'Line item description is required'],
      trim: true
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0, 'Quantity cannot be negative']
    },
    unitPrice: {
      type: Number,
      required: [true, 'Unit price is required'],
      min: [0, 'Unit price cannot be negative'],
      get: function(val) {
        return Math.round(val * 100) / 100;
      },
      set: function(val) {
        return Math.round(val * 100) / 100;
      }
    },
    amount: {
      type: Number,
      get: function() {
        return Math.round((this.quantity * this.unitPrice) * 100) / 100;
      }
    },
    /** Scheduled payment after due date for this line (utility / store bills). */
    duePaymentAmount: {
      type: Number,
      min: 0,
      default: 0,
      get: function(val) {
        return Math.round((Number(val) || 0) * 100) / 100;
      },
      set: function(val) {
        return Math.round((Number(val) || 0) * 100) / 100;
      }
    },
    taxRate: {
      type: Number,
      default: 0,
      min: [0, 'Tax rate cannot be negative'],
      max: [100, 'Tax rate cannot exceed 100%']
    },
    taxAmount: {
      type: Number,
      default: 0,
      get: function() {
        return Math.round((this.amount * this.taxRate / 100) * 100) / 100;
      }
    },
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    company: {
      type: String,
      trim: true,
      default: ''
    },
    project: {
      type: String,
      trim: true,
      default: ''
    },
    // Optional traceability for procurement billing
    grnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GoodsReceive'
    },
    poId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder'
    }
  }],
  // Bill-level GRN/PO link map for multi-GRN vendor bills
  linkedGRNs: [{
    grnId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceive' },
    grnNumber: String,
    poId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    poNumber: String,
    amount: { type: Number, default: 0 }
  }],
  // Payment history
  payments: [{
    paymentDate: {
      type: Date,
      required: [true, 'Payment date is required']
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: [0, 'Payment amount cannot be negative'],
      get: function(val) {
        return Math.round(val * 100) / 100;
      },
      set: function(val) {
        return Math.round(val * 100) / 100;
      }
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'check', 'cheque', 'credit_card', 'bank_transfer', 'bank', 'ach', 'other'],
      required: [true, 'Payment method is required']
    },
    reference: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      trim: true
    },
    // Optional advanced payment allocation: Bill -> GRN portions
    allocations: [{
      grnId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GoodsReceive'
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Allocation amount cannot be negative']
      }
    }],
    journalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Created by user is required']
    },
    batchId: {
      type: String,
      trim: true
    }
  }],
  // Aging information
  aging: {
    current: {
      type: Number,
      default: 0,
      get: function(val) {
        return Math.round(val * 100) / 100;
      },
      set: function(val) {
        return Math.round(val * 100) / 100;
      }
    },
    days_30: {
      type: Number,
      default: 0,
      get: function(val) {
        return Math.round(val * 100) / 100;
      },
      set: function(val) {
        return Math.round(val * 100) / 100;
      }
    },
    days_60: {
      type: Number,
      default: 0,
      get: function(val) {
        return Math.round(val * 100) / 100;
      },
      set: function(val) {
        return Math.round(val * 100) / 100;
      }
    },
    days_90: {
      type: Number,
      default: 0,
      get: function(val) {
        return Math.round(val * 100) / 100;
      },
      set: function(val) {
        return Math.round(val * 100) / 100;
      }
    },
    days_90_plus: {
      type: Number,
      default: 0,
      get: function(val) {
        return Math.round(val * 100) / 100;
      },
      set: function(val) {
        return Math.round(val * 100) / 100;
      }
    }
  },
  // Approval workflow
  approval: {
    required: {
      type: Boolean,
      default: false
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedDate: Date,
    approvalNotes: String
  },
  /**
   * Department approval (Chart of Accounts bills) — same role as Centralized Store Manager/HOD chain.
   * Default COA chain: Sr Manager Finance → GM Finance, then Pre-Audit / Audit Director, then Finance voucher.
   * This is NOT financeApprovalAuthorities (voucher payment authorities).
   */
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
    roleLabel: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    actedAt: Date,
    comment: {
      type: String,
      trim: true
    }
  }],
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedAt: Date,
  rejectionReason: {
    type: String,
    trim: true,
    default: ''
  },
  // Additional fields
  company: {
    type: String,
    trim: true,
    default: ''
  },
  project: {
    type: String,
    trim: true,
    default: ''
  },
  notes: String,
  internalNotes: String,
  attachments: [{
    filename: String,
    originalName: String,
    path: String,
    mimeType: String,
    size: Number,
    uploadedAt: Date,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by user is required']
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  workflowHistory: [{
    fromStatus: String,
    toStatus: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    comments: String,
    module: String,
    approvalStamp: String,
    digitalSignature: String,
    stampPosition: String
  }],
  /**
   * Finance voucher / payment authorities (Accounts Officer, Sr Manager Accounts, GM Finance on BPV etc.).
   * Do not use this for Chart of Accounts bill department approval — that lives on approvalChain.
   */
  financeApprovalAuthorities: [{
    levelKey: { type: String, trim: true },
    levelName: { type: String, trim: true },
    assignedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String, trim: true },
    status: { type: String, trim: true, default: 'pending' },
    actedAt: Date,
    digitalSignature: String,
    comments: String
  }],
  observations: [{
    observation: String,
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false }
  }]
}, {
  timestamps: true
});

// Indexes
accountsPayableSchema.index({ billNumber: 1 });
accountsPayableSchema.index({ 'vendor.vendorId': 1 });
accountsPayableSchema.index({ billDate: 1 });
accountsPayableSchema.index({ dueDate: 1 });
accountsPayableSchema.index({ status: 1 });
accountsPayableSchema.index({ department: 1 });
accountsPayableSchema.index({ module: 1 });
accountsPayableSchema.index({ balanceDue: 1 });

// Virtuals
accountsPayableSchema.virtual('isOverdue').get(function() {
  return this.dueDate < new Date() && this.balanceDue > 0;
});

accountsPayableSchema.virtual('daysOverdue').get(function() {
  if (!this.isOverdue) return 0;
  return Math.floor((new Date() - this.dueDate) / (1000 * 60 * 60 * 24));
});

accountsPayableSchema.virtual('formattedTotalAmount').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.totalAmount);
});

accountsPayableSchema.virtual('formattedBalanceDue').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.balanceDue);
});

// Pre-save middleware
accountsPayableSchema.pre('save', function(next) {
  // Calculate total amount from line items
  if (this.lineItems && this.lineItems.length > 0) {
    this.subtotal = this.lineItems.reduce((sum, item) => sum + item.amount, 0);
    this.taxAmount = this.lineItems.reduce((sum, item) => sum + item.taxAmount, 0);
    this.totalAmount = this.subtotal + this.taxAmount - this.discountAmount;
  }

  // Update status based on balance and approval
  const settled = (this.amountPaid || 0) + (this.advanceApplied || 0);
  if (this.balanceDue <= 0 && settled > 0) {
    this.status = settled < this.totalAmount ? 'partial' : 'paid';
  } else if (this.isOverdue) {
    this.status = 'overdue';
  } else if (this.approval.required && this.approval.approvedBy) {
    this.status = 'approved';
  }

  // Calculate aging
  this.calculateAging();

  next();
});

// Method to calculate aging
accountsPayableSchema.methods.calculateAging = function() {
  const now = new Date();
  const daysDiff = Math.floor((now - this.dueDate) / (1000 * 60 * 60 * 24));
  
  this.aging = {
    current: 0,
    days_30: 0,
    days_60: 0,
    days_90: 0,
    days_90_plus: 0
  };

  if (this.balanceDue > 0) {
    if (daysDiff <= 0) {
      this.aging.current = this.balanceDue;
    } else if (daysDiff <= 30) {
      this.aging.days_30 = this.balanceDue;
    } else if (daysDiff <= 60) {
      this.aging.days_60 = this.balanceDue;
    } else if (daysDiff <= 90) {
      this.aging.days_90 = this.balanceDue;
    } else {
      this.aging.days_90_plus = this.balanceDue;
    }
  }
};

// Method to approve bill
accountsPayableSchema.methods.approve = async function(approvedBy, approvalNotes) {
  if (this.approval.required && !this.approval.approvedBy) {
    this.approval.approvedBy = approvedBy;
    this.approval.approvedDate = new Date();
    this.approval.approvalNotes = approvalNotes;
    this.status = 'approved';
    return this.save();
  }
  throw new Error('Bill does not require approval or is already approved');
};

// Method to record payment
accountsPayableSchema.methods.recordPayment = async function(paymentData) {
  if (this.balanceDue <= 0) {
    throw new Error('Bill is already fully paid');
  }

  if (paymentData.amount > this.balanceDue) {
    throw new Error('Payment amount cannot exceed balance due');
  }

  // Add payment to history
  this.payments.push({
    ...paymentData,
    paymentDate: paymentData.paymentDate || new Date()
  });

  // Update amount paid
  this.amountPaid += paymentData.amount;

  // Create journal entry for payment
  const JournalEntry = mongoose.model('JournalEntry');
  const Account = mongoose.model('Account');

  // Find accounts payable and cash/bank account
  const apAccount = await Account.findOne({ accountNumber: '2100' }); // Accounts Payable
  const cashAccount = await Account.findOne({ accountNumber: '1000' }); // Cash

  if (!apAccount || !cashAccount) {
    throw new Error('Required accounts not found');
  }

  const journalEntry = new JournalEntry({
    date: paymentData.paymentDate || new Date(),
    reference: `PAY-${this.billNumber}`,
    description: `Payment made for bill ${this.billNumber}`,
    department: this.department,
    module: this.module,
    referenceId: this._id,
    referenceType: 'payment',
    lines: [
      {
        account: apAccount._id,
        description: `Payment to ${this.vendor.name}`,
        debit: paymentData.amount,
        department: this.department
      },
      {
        account: cashAccount._id,
        description: `Payment for bill ${this.billNumber}`,
        credit: paymentData.amount,
        department: this.department
      }
    ],
    createdBy: paymentData.createdBy
  });

  await journalEntry.post(paymentData.createdBy);

  // Update payment reference
  this.payments[this.payments.length - 1].journalEntry = journalEntry._id;

  return this.save();
};

// Static methods
accountsPayableSchema.statics.getAgingReport = async function(preMatch = {}) {
  const pipeline = [];
  if (preMatch && Object.keys(preMatch).length) {
    pipeline.push({ $match: preMatch });
  }
  pipeline.push(
    {
      $group: {
        _id: null,
        current: { $sum: '$aging.current' },
        days_30: { $sum: '$aging.days_30' },
        days_60: { $sum: '$aging.days_60' },
        days_90: { $sum: '$aging.days_90' },
        days_90_plus: { $sum: '$aging.days_90_plus' },
        total: { $sum: '$balanceDue' }
      }
    }
  );

  const result = await this.aggregate(pipeline);
  return result[0] || {
    current: 0,
    days_30: 0,
    days_60: 0,
    days_90: 0,
    days_90_plus: 0,
    total: 0
  };
};

accountsPayableSchema.statics.getOverdueBills = function() {
  return this.find({
    dueDate: { $lt: new Date() },
    balanceDue: { $gt: 0 }
  }).sort({ dueDate: 1 });
};

accountsPayableSchema.statics.getVendorStatement = async function(vendorId, startDate, endDate) {
  const query = {
    'vendor.vendorId': vendorId
  };

  if (startDate || endDate) {
    query.billDate = {};
    if (startDate) query.billDate.$gte = startDate;
    if (endDate) query.billDate.$lte = endDate;
  }

  return this.find(query)
    .sort({ billDate: 1 });
};

module.exports = mongoose.model('AccountsPayable', accountsPayableSchema);
