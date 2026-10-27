const mongoose = require('mongoose');

const accountsReceivableSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    default: null,
    index: true
  },
  // Customer information
  customer: {
    name: {
      type: String,
      required: [true, 'Customer name is required'],
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
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer' // If you have a separate Customer model
    },
    // Copied from the customer when the invoice is made (printed on the sales tax invoice)
    ntn: { type: String, trim: true, default: '' },
    strn: { type: String, trim: true, default: '' },
    cnic: { type: String, trim: true, default: '' }
  },
  // Invoice details
  invoiceNumber: {
    type: String,
    required: [true, 'Invoice number is required'],
    unique: true,
    trim: true
  },
  invoiceDate: {
    type: Date,
    required: [true, 'Invoice date is required'],
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
  balanceDue: {
    type: Number,
    get: function() {
      return Math.round((this.totalAmount - this.amountPaid) * 100) / 100;
    }
  },
  // Payment terms
  paymentTerms: {
    type: String,
    enum: ['net_15', 'net_30', 'net_45', 'net_60', 'due_on_receipt', 'custom'],
    default: 'net_30'
  },
  // Status tracking
  status: {
    type: String,
    enum: ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'cancelled'],
    default: 'draft'
  },
  // Department integration
  department: {
    type: String,
    trim: true,
    default: 'sales'
  },
  costCenter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FinanceCostCenter',
    default: null
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
    enum: ['sales_order', 'project', 'service', 'product', 'manual', 'invoice'],
    default: 'manual'
  },
  // Line items
  lineItems: [{
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
      ref: 'Account',
      default: null
    }
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
    installmentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    journalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Created by user is required']
    }
  }],
  // Installment schedule (planning only — no JE until a receipt is recorded)
  installments: [{
    sequence: { type: Number, default: 1 },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Installment amount must be positive'],
      get: function(val) { return Math.round((val || 0) * 100) / 100; },
      set: function(val) { return Math.round((Number(val) || 0) * 100) / 100; }
    },
    dueDate: {
      type: Date,
      required: [true, 'Installment due date is required']
    },
    status: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue', 'cancelled'],
      default: 'pending'
    },
    paidAmount: {
      type: Number,
      default: 0,
      get: function(val) { return Math.round((val || 0) * 100) / 100; },
      set: function(val) { return Math.round((Number(val) || 0) * 100) / 100; }
    },
    notes: { type: String, trim: true },
    lastPaymentDate: { type: Date },
    lastJournalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry'
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
  // Additional fields
  notes: String,
  internalNotes: String,
  attachments: [{
    filename: String,
    originalName: String,
    path: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  // Audit trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by user is required']
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
accountsReceivableSchema.index({ invoiceNumber: 1 });
accountsReceivableSchema.index({ 'customer.customerId': 1 });
accountsReceivableSchema.index({ invoiceDate: 1 });
accountsReceivableSchema.index({ dueDate: 1 });
accountsReceivableSchema.index({ status: 1 });
accountsReceivableSchema.index({ department: 1 });
accountsReceivableSchema.index({ module: 1 });
accountsReceivableSchema.index({ balanceDue: 1 });

// Virtuals
accountsReceivableSchema.virtual('isOverdue').get(function() {
  return this.dueDate < new Date() && this.balanceDue > 0;
});

accountsReceivableSchema.virtual('daysOverdue').get(function() {
  if (!this.isOverdue) return 0;
  return Math.floor((new Date() - this.dueDate) / (1000 * 60 * 60 * 24));
});

accountsReceivableSchema.virtual('formattedTotalAmount').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.totalAmount);
});

accountsReceivableSchema.virtual('formattedBalanceDue').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(this.balanceDue);
});

// Pre-save middleware
accountsReceivableSchema.pre('save', function(next) {
  // Calculate total amount from line items
  if (this.lineItems && this.lineItems.length > 0) {
    this.subtotal = this.lineItems.reduce((sum, item) => sum + item.amount, 0);
    this.taxAmount = this.lineItems.reduce((sum, item) => sum + item.taxAmount, 0);
    this.totalAmount = this.subtotal + this.taxAmount;
  }

  // Update status based on balance
  if (this.balanceDue <= 0 && this.amountPaid > 0) {
    this.status = this.amountPaid < this.totalAmount ? 'partial' : 'paid';
  } else if (this.isOverdue) {
    this.status = 'overdue';
  }

  // Calculate aging
  this.calculateAging();

  next();
});

// Method to calculate aging
accountsReceivableSchema.methods.calculateAging = function() {
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

// Method to record payment
accountsReceivableSchema.methods.recordPayment = async function(paymentData) {
  if (this.balanceDue <= 0) {
    throw new Error('Invoice is already fully paid');
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

  // Find cash/bank account (assuming account number 1000 for cash)
  const cashAccount = await Account.findOne({ accountNumber: '1000' });
  const arAccount = await Account.findOne({ accountNumber: '1200' }); // Accounts Receivable

  if (!cashAccount || !arAccount) {
    throw new Error('Required accounts not found');
  }

  const customerParty = this.customer?.customerId
    ? { partyType: 'Customer', party: this.customer.customerId }
    : {};

  const journalEntry = new JournalEntry({
    date: this.dueDate || paymentData.paymentDate || new Date(),
    reference: `PAY-${this.invoiceNumber}`,
    description: `Payment received for invoice ${this.invoiceNumber}`,
    department: this.department,
    module: this.module,
    referenceId: this._id,
    referenceType: 'receipt',
    voucherSeries: 'RV',
    lines: [
      {
        account: cashAccount._id,
        description: `Payment received from ${this.customer.name}`,
        debit: paymentData.amount,
        department: this.department
      },
      {
        account: arAccount._id,
        description: `Payment applied to invoice ${this.invoiceNumber}`,
        credit: paymentData.amount,
        department: this.department,
        ...customerParty
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
accountsReceivableSchema.statics.getAgingReport = async function(preMatch = {}) {
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

accountsReceivableSchema.statics.getOverdueInvoices = function() {
  return this.find({
    dueDate: { $lt: new Date() },
    balanceDue: { $gt: 0 }
  }).sort({ dueDate: 1 });
};

accountsReceivableSchema.statics.getCustomerStatement = async function(customerId, startDate, endDate) {
  const query = {
    'customer.customerId': customerId
  };

  if (startDate || endDate) {
    query.invoiceDate = {};
    if (startDate) query.invoiceDate.$gte = startDate;
    if (endDate) query.invoiceDate.$lte = endDate;
  }

  return this.find(query)
    .sort({ invoiceDate: 1 });
};

module.exports = mongoose.model('AccountsReceivable', accountsReceivableSchema);
