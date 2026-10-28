const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
const {
  getCalendarDaysInMonth,
  resolveSettlementRateDate,
  getSettlementDailyRate,
  getSettlementActualSalary,
  getSettlementShortfallDeduction
} = require('../../utils/finalSettlementDays');

const finalSettlementSchema = new mongoose.Schema({
  // Employee Information
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  employeeId: {
    type: String,
    required: true
  },
  employeeName: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true
  },
  designation: {
    type: String,
    required: true
  },

  // Settlement Details
  settlementType: {
    type: String,
    enum: ['resignation', 'termination', 'retirement', 'contract_end', 'death', 'other'],
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  noticePeriod: {
    type: Number, // in days
    default: 0
  },
  noticePeriodServed: {
    type: Number, // in days
    default: 0
  },
  noticePeriodShortfall: {
    type: Number, // in days
    default: 0
  },

  // Dates
  lastWorkingDate: {
    type: Date,
    required: true
  },
  settlementDate: {
    type: Date,
    required: true
  },
  applicationDate: {
    type: Date,
    default: Date.now
  },
  approvalDate: {
    type: Date
  },
  processedDate: {
    type: Date
  },

  // Salary Calculations
  basicSalary: {
    type: Number,
    required: true
  },
  grossSalary: {
    type: Number,
    required: true
  },
  actualSalary: {
    type: Number,
    default: 0
  },
  netSalary: {
    type: Number,
    required: true
  },

  // Earnings
  earnings: {
    basicSalary: { type: Number, default: 0 },
    houseRent: { type: Number, default: 0 },
    medicalAllowance: { type: Number, default: 0 },
    conveyanceAllowance: { type: Number, default: 0 },
    foodAllowance: { type: Number, default: 0 },
    mobileAllowance: { type: Number, default: 0 },
    vehicleAllowance: { type: Number, default: 0 },
    fuelAllowance: { type: Number, default: 0 },
    specialAllowance: { type: Number, default: 0 },
    otherAllowances: { type: Number, default: 0 },
    otherEarnings: { type: Number, default: 0 },
    overtime: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    gratuity: { type: Number, default: 0 },
    leaveEncashment: { type: Number, default: 0 },
    noticePay: { type: Number, default: 0 },
    providentFund: { type: Number, default: 0 },
    eobi: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 }
  },

  // Deductions
  deductions: {
    incomeTax: { type: Number, default: 0 },
    providentFund: { type: Number, default: 0 },
    eobi: { type: Number, default: 0 },
    loanDeductions: { type: Number, default: 0 },
    noticePeriodDeduction: { type: Number, default: 0 },
    security: { type: Number, default: 0 },
    healthInsurance: { type: Number, default: 0 },
    advanceDeductions: { type: Number, default: 0 },
    pension: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 }
  },

  // Leave Calculations
  leaveBalance: {
    annual: { type: Number, default: 0 },
    sick: { type: Number, default: 0 },
    casual: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  leaveEncashmentAmount: {
    type: Number,
    default: 0
  },

  // Loan Settlement
  loans: [{
    loanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan'
    },
    loanType: String,
    originalAmount: Number,
    outstandingBalance: Number,
    settledAmount: Number,
    settlementType: {
      type: String,
      enum: ['full_settlement', 'partial_settlement', 'waived', 'pending'],
      default: 'pending'
    }
  }],
  totalLoanSettlement: {
    type: Number,
    default: 0
  },

  // Final Calculations
  grossSettlementAmount: {
    type: Number,
    required: true
  },
  netSettlementAmount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'cash', 'cheque', 'online'],
    default: 'bank_transfer'
  },
  bankDetails: {
    bankName: String,
    accountNumber: String,
    accountTitle: String
  },

  // Status and Workflow
  status: {
    type: String,
    enum: ['pending', 'approved', 'processed', 'paid', 'cancelled'],
    default: 'pending'
  },
  approvalLevel: {
    type: String,
    enum: ['hr_manager', 'finance_manager', 'general_manager', 'ceo'],
    default: 'hr_manager'
  },
  currentApprover: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Documents
  documents: [{
    name: String,
    type: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],

  // Comments and Notes
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    comment: String,
    timestamp: { type: Date, default: Date.now }
  }],
  notes: String,

  // Audit
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Add pagination plugin
finalSettlementSchema.plugin(mongoosePaginate);

// Virtual for calculating notice period shortfall
finalSettlementSchema.virtual('noticePeriodShortfallDays').get(function() {
  return Math.max(0, this.noticePeriod - this.noticePeriodServed);
});

// Virtual for calculating notice period deduction amount
finalSettlementSchema.virtual('noticePeriodDeductionAmount').get(function() {
  if (this.noticePeriodShortfallDays <= 0) return 0;
  const rateDate = resolveSettlementRateDate({
    lastWorkingDate: this.lastWorkingDate,
    settlementDate: this.settlementDate
  });
  return getSettlementShortfallDeduction(
    this.grossSalary,
    this.noticePeriod,
    this.noticePeriodServed,
    rateDate
  );
});

// Virtual for calculating total outstanding loans
finalSettlementSchema.virtual('totalOutstandingLoans').get(function() {
  return this.loans.reduce((total, loan) => total + (loan.outstandingBalance || 0), 0);
});

// Virtual for calculating settlement progress
finalSettlementSchema.virtual('settlementProgress').get(function() {
  const statusOrder = ['pending', 'approved', 'processed', 'paid'];
  const currentIndex = statusOrder.indexOf(this.status);
  return ((currentIndex + 1) / statusOrder.length) * 100;
});

  // Pre-save middleware to calculate totals
finalSettlementSchema.pre('save', function(next) {
  const rateDate = resolveSettlementRateDate({
    lastWorkingDate: this.lastWorkingDate,
    settlementDate: this.settlementDate
  });
  const servedDays = Math.max(0, Number(this.noticePeriodServed) || 0);
  const shortfallDays = Math.max(0, (Number(this.noticePeriod) || 0) - servedDays);

  // Actual salary = GROSS daily rate × days served (matches Salary & Calculations)
  this.actualSalary = getSettlementActualSalary(this.grossSalary, servedDays, rateDate);
  this.noticePeriodShortfall = shortfallDays;

  // Notice period deduction is user-controlled (default 0). Do not auto-fill shortfall.
  if (!this.deductions) this.deductions = {};
  if (this.deductions.noticePeriodDeduction == null || this.deductions.noticePeriodDeduction === '') {
    this.deductions.noticePeriodDeduction = 0;
  }

  // Calculate total earnings (include all allowance components from the form)
  const e = this.earnings || {};
  this.earnings.totalEarnings =
    (e.basicSalary || 0) +
    (e.houseRent || 0) +
    (e.medicalAllowance || 0) +
    (e.conveyanceAllowance || 0) +
    (e.foodAllowance || 0) +
    (e.mobileAllowance || 0) +
    (e.vehicleAllowance || 0) +
    (e.fuelAllowance || 0) +
    (e.specialAllowance || 0) +
    (e.otherAllowances || 0) +
    (e.otherEarnings || 0) +
    (e.overtime || 0) +
    (e.bonus || 0) +
    (e.gratuity || 0) +
    (e.leaveEncashment || 0) +
    (e.noticePay || 0) +
    (e.providentFund || 0) +
    (e.eobi || 0);

  // Calculate total deductions
  const d = this.deductions || {};
  this.deductions.totalDeductions =
    (d.incomeTax || 0) +
    (d.providentFund || 0) +
    (d.eobi || 0) +
    (d.loanDeductions || 0) +
    (d.noticePeriodDeduction || 0) +
    (d.security || 0) +
    (d.healthInsurance || 0) +
    (d.advanceDeductions || 0) +
    (d.pension || 0) +
    (d.otherDeductions || 0);

  // Prefer client-provided settlement totals when they match the breakdown
  const computedGross = this.earnings.totalEarnings;
  const computedNet = computedGross - this.deductions.totalDeductions;
  if (!(Number(this.grossSettlementAmount) > 0)) {
    this.grossSettlementAmount = computedGross;
  } else {
    this.grossSettlementAmount = computedGross;
  }
  this.netSettlementAmount = computedNet;

  // Calculate total loan settlement
  this.totalLoanSettlement = (this.loans || []).reduce((total, loan) => {
    return total + (loan.settledAmount || 0);
  }, 0);

  next();
});

// Method to calculate leave encashment
finalSettlementSchema.methods.calculateLeaveEncashment = function() {
  const rateDate = resolveSettlementRateDate({
    lastWorkingDate: this.lastWorkingDate,
    settlementDate: this.settlementDate
  });
  const dailyRate = getSettlementDailyRate(this.grossSalary, rateDate);
  const encashableLeaves = Math.min(this.leaveBalance.total, 30); // Max 30 days encashment (policy cap)
  return dailyRate * encashableLeaves;
};

// Method to calculate gratuity
finalSettlementSchema.methods.calculateGratuity = function() {
  // One month's gross salary for each completed year (calendar month of settlement)
  const yearsOfService = this.getYearsOfService();
  const rateDate = resolveSettlementRateDate({
    lastWorkingDate: this.lastWorkingDate,
    settlementDate: this.settlementDate
  });
  const daysInMonth = getCalendarDaysInMonth(rateDate);
  const dailyRate = getSettlementDailyRate(this.grossSalary, rateDate);
  return dailyRate * daysInMonth * yearsOfService;
};

// Method to get years of service
finalSettlementSchema.methods.getYearsOfService = function() {
  // This would need to be calculated based on employee joining date
  // For now, returning a placeholder
  return 1;
};

// Method to process loan settlements
finalSettlementSchema.methods.processLoanSettlements = function() {
  this.loans.forEach(loan => {
    if (loan.outstandingBalance > 0) {
      if (this.netSettlementAmount >= loan.outstandingBalance) {
        // Full settlement
        loan.settledAmount = loan.outstandingBalance;
        loan.settlementType = 'full_settlement';
        this.deductions.loanDeductions += loan.outstandingBalance;
      } else {
        // Partial settlement
        loan.settledAmount = this.netSettlementAmount;
        loan.settlementType = 'partial_settlement';
        this.deductions.loanDeductions += this.netSettlementAmount;
      }
    }
  });
};

// Static method to get settlement statistics
finalSettlementSchema.statics.getSettlementStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalSettlements: { $sum: 1 },
        totalAmount: { $sum: '$netSettlementAmount' },
        pendingSettlements: {
          $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
        },
        approvedSettlements: {
          $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
        },
        processedSettlements: {
          $sum: { $cond: [{ $eq: ['$status', 'processed'] }, 1, 0] }
        },
        paidSettlements: {
          $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] }
        },
        avgSettlementAmount: { $avg: '$netSettlementAmount' }
      }
    }
  ]);

  return stats[0] || {
    totalSettlements: 0,
    totalAmount: 0,
    pendingSettlements: 0,
    approvedSettlements: 0,
    processedSettlements: 0,
    paidSettlements: 0,
    avgSettlementAmount: 0
  };
};

module.exports = mongoose.model('FinalSettlement', finalSettlementSchema); 