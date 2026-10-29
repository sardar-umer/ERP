const mongoose = require('mongoose');
const { calculateMonthlyTax, calculateMonthlyTaxImage, calculateTaxableIncome, calculateTax } = require('../../utils/taxCalculator');
const {
  vehicleFuelTotal,
  vehicleAllowanceAmount,
  fuelAllowanceAmount,
  payrollAllowancesFromEmployee,
  additionalAllowancesTotal,
  getEmployeeEobiDeduction,
  getEmployeeSecurityDeduction
} = require('../../utils/allowanceHelpers');
const {
  applyPayrollProration,
  buildPayrollProrationRemarksSuffix,
  adjustAttendanceForJoiningProration
} = require('../../utils/payrollPartialSalaryPay');
const {
  effectiveLoanDeductionForPayroll,
  activeLoanStatusFilter,
  markLoanCompletedIfPaid
} = require('../../utils/loanPayrollDeduction');

const calculateLoanDeductions = async (employeeId, month, year) => {
  try {
    const Loan = mongoose.model('Loan');
    const activeLoans = await Loan.find({
      employee: employeeId,
      ...activeLoanStatusFilter()
    });

    const nowMonth = month || new Date().getMonth() + 1;
    const nowYear = year || new Date().getFullYear();

    let totalDeductions = 0;
    for (const loan of activeLoans) {
      const amount = effectiveLoanDeductionForPayroll(loan, nowMonth, nowYear);
      if (amount <= 0) {
        // Fully paid but status not updated — stop future deductions
        await markLoanCompletedIfPaid(loan).catch(() => {});
        continue;
      }
      totalDeductions += amount;
    }

    return totalDeductions;
  } catch (error) {
    console.error('Error calculating loan deductions:', error);
    return 0;
  }
};

const calculateSalaryAdvance = async (employeeId, month, year) => {
  try {
    const SalaryAdvance = mongoose.model('SalaryAdvance');
    const activeAdvances = await SalaryAdvance.find({
      employee: employeeId,
      payrollMonth: Number(month),
      payrollYear: Number(year),
      status: 'Unadjusted'
    });

    return activeAdvances.reduce((sum, adv) => sum + (adv.amount || 0), 0);
  } catch (error) {
    console.error('Error calculating salary advance:', error);
    return 0;
  }
};

const payrollSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: [true, 'Employee is required']
  },
  month: {
    type: Number,
    required: [true, 'Month is required'],
    min: [1, 'Month must be between 1 and 12'],
    max: [12, 'Month must be between 1 and 12']
  },
  year: {
    type: Number,
    required: [true, 'Year is required'],
    min: [2020, 'Year must be 2020 or later']
  },
  isManual: {
    type: Boolean,
    default: false
  },
  // Basic salary components
  basicSalary: {
    type: Number,
    required: [true, 'Basic salary is required'],
    min: [0, 'Basic salary cannot be negative']
  },
  // Flexible Allowances (House Rent removed as it's part of distributed salary)
  allowances: {
    conveyance: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Conveyance allowance cannot be negative']
      }
    },
    food: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Food allowance cannot be negative']
      }
    },
    mobile: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Mobile allowance cannot be negative']
      }
    },
    vehicle: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Vehicle allowance cannot be negative']
      }
    },
    fuel: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Fuel allowance cannot be negative']
      }
    },
    /** @deprecated Use vehicle + fuel; kept for existing records */
    vehicleFuel: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Vehicle & fuel allowance cannot be negative']
      }
    },
    medical: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Medical allowance cannot be negative']
      }
    },
    houseRent: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'House rent allowance cannot be negative']
      }
    },
    special: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Special allowance cannot be negative']
      }
    },
    other: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Other allowance cannot be negative']
      }
    }
  },
  // Core Salary Components (separate from flexible allowances)
  houseRentAllowance: {
    type: Number,
    default: 0,
    min: [0, 'House rent allowance cannot be negative']
  },
  medicalAllowance: {
    type: Number,
    default: 0,
    min: [0, 'Medical allowance cannot be negative']
  },
  // Overtime
  overtimeHours: {
    type: Number,
    default: 0,
    min: [0, 'Overtime hours cannot be negative']
  },
  overtimeRate: {
    type: Number,
    default: 0,
    min: [0, 'Overtime rate cannot be negative']
  },
  overtimeAmount: {
    type: Number,
    default: 0,
    min: [0, 'Overtime amount cannot be negative']
  },
  // Bonuses and Arrears
  performanceBonus: {
    type: Number,
    default: 0,
    min: [0, 'Performance bonus cannot be negative']
  },
  otherBonus: {
    type: Number,
    default: 0,
    min: [0, 'Other bonus cannot be negative']
  },
  arrears: {
    type: Number,
    default: 0,
    min: [0, 'Arrears cannot be negative']
  },
  // Deductions
  providentFund: {
    type: Number,
    default: 0,
    min: [0, 'Provident fund cannot be negative']
  },
  providentFundEnabled: {
    type: Boolean,
    default: false
  },
  incomeTax: {
    type: Number,
    default: 0,
    min: [0, 'Income tax cannot be negative']
  },
  healthInsurance: {
    type: Number,
    default: 0,
    min: [0, 'Health insurance cannot be negative']
  },
  loanDeductions: {
    type: Number,
    default: 0,
    min: [0, 'Loan deductions cannot be negative']
  },
  advanceSalary: {
    type: Number,
    default: 0,
    min: [0, 'Advance salary cannot be negative']
  },
  otherDeductions: {
    type: Number,
    default: 0,
    min: [0, 'Other deductions cannot be negative']
  },
  // EOBI (Employees' Old-Age Benefits Institution) - Pakistan
  eobi: {
    type: Number,
    default: 0,
    min: [0, 'EOBI cannot be negative']
  },
  // Employee Security Deduction
  employeeSecurity: {
    type: Number,
    default: 0,
    min: [0, 'Employee security cannot be negative']
  },
  // Attendance
  totalWorkingDays: {
    type: Number,
    required: [true, 'Total working days is required'],
    min: [0, 'Total working days cannot be negative']
  },
  presentDays: {
    type: Number,
    required: [true, 'Present days is required'],
    min: [0, 'Present days cannot be negative']
  },
  absentDays: {
    type: Number,
    default: 0,
    min: [0, 'Absent days cannot be negative']
  },
  leaveDays: {
    type: Number,
    default: 0,
    min: [0, 'Leave days cannot be negative']
  },
  // Attendance calculations (26-day basis)
  dailyRate: {
    type: Number,
    default: 0,
    min: [0, 'Daily rate cannot be negative']
  },
  attendanceDeduction: {
    type: Number,
    default: 0,
    min: [0, 'Attendance deduction cannot be negative']
  },
  // Leave Deductions (similar structure to allowances)
  leaveDeductions: {
    unpaidLeave: {
      type: Number,
      default: 0,
      min: [0, 'Unpaid leave days cannot be negative']
    },
    sickLeave: {
      type: Number,
      default: 0,
      min: [0, 'Sick leave days cannot be negative']
    },
    casualLeave: {
      type: Number,
      default: 0,
      min: [0, 'Casual leave days cannot be negative']
    },
    annualLeave: {
      type: Number,
      default: 0,
      min: [0, 'Annual leave days cannot be negative']
    },
    otherLeave: {
      type: Number,
      default: 0,
      min: [0, 'Other leave days cannot be negative']
    },
    totalLeaveDays: {
      type: Number,
      default: 0,
      min: [0, 'Total leave days cannot be negative']
    },
    leaveDeductionAmount: {
      type: Number,
      default: 0,
      min: [0, 'Leave deduction amount cannot be negative']
    }
  },
  // Leave deduction amount (calculated field for easy access)
  leaveDeductionAmount: {
    type: Number,
    default: 0,
    min: [0, 'Leave deduction amount cannot be negative']
  },
  // Leave integration fields
  leaveDays: {
    type: Number,
    default: 0,
    min: [0, 'Leave days cannot be negative']
  },
  unpaidLeaveDays: {
    type: Number,
    default: 0,
    min: [0, 'Unpaid leave days cannot be negative']
  },
  leaveDeduction: {
    type: Number,
    default: 0,
    min: [0, 'Leave deduction cannot be negative']
  },
  // Advance leave tracking
  advanceLeaveDetails: {
    totalAdvanceLeaves: {
      type: Number,
      default: 0,
      min: [0, 'Total advance leaves cannot be negative']
    },
    annualAdvance: {
      type: Number,
      default: 0,
      min: [0, 'Annual advance leaves cannot be negative']
    },
    sickAdvance: {
      type: Number,
      default: 0,
      min: [0, 'Sick advance leaves cannot be negative']
    },
    casualAdvance: {
      type: Number,
      default: 0,
      min: [0, 'Casual advance leaves cannot be negative']
    },
    advanceDeduction: {
      type: Number,
      default: 0,
      min: [0, 'Advance leave deduction cannot be negative']
    },
    unpaidDeduction: {
      type: Number,
      default: 0,
      min: [0, 'Unpaid leave deduction cannot be negative']
    },
    dailyRate: {
      type: Number,
      default: 0,
      min: [0, 'Daily rate cannot be negative']
    }
  },
  // Calculations
  grossSalary: {
    type: Number,
    min: [0, 'Gross salary cannot be negative']
  },
  totalEarnings: {
    type: Number,
    default: 0,
    min: [0, 'Total earnings cannot be negative']
  },
  totalDeductions: {
    type: Number,
    default: 0,
    min: [0, 'Total deductions cannot be negative']
  },
  netSalary: {
    type: Number,
    min: [0, 'Net salary cannot be negative']
  },
  // Status
  status: {
    type: String,
    enum: [
      'Draft',
      'Pending',
      'Approved by Deputy Manager Payroll HR',
      'Approved by GM HR',
      'Approved by AVP',
      'Approved',
      'Paid',
      'Cancelled'
    ],
    default: 'Draft'
  },
  // Payment details
  paymentDate: {
    type: Date
  },
  paymentMethod: {
    type: String,
    enum: ['Bank Transfer', 'Cash', 'Check', 'Direct Deposit'],
    default: 'Bank Transfer'
  },
  // Cash salary flag — snapshot from employee.cashSalary at generation time
  // When true, this payroll is excluded from BPV and bank letter
  isCashSalary: {
    type: Boolean,
    default: false
  },
  transactionId: {
    type: String,
    trim: true
  },
  // Tax calculation breakdown
  taxCalculation: {
    mainTax: {
      type: Number,
      default: 0,
      min: [0, 'Main tax cannot be negative']
    },
    arrearsTax: {
      type: Number,
      default: 0,
      min: [0, 'Arrears tax cannot be negative']
    },
    totalTax: {
      type: Number,
      default: 0,
      min: [0, 'Total tax cannot be negative']
    },
    mainTaxableIncome: {
      type: Number,
      default: 0,
      min: [0, 'Main taxable income cannot be negative']
    },
    arrearsTaxableIncome: {
      type: Number,
      default: 0,
      min: [0, 'Arrears taxable income cannot be negative']
    },
    annualTaxableIncome: {
      type: Number,
      default: 0,
      min: [0, 'Annual taxable income cannot be negative']
    },
    annualTax: {
      type: Number,
      default: 0,
      min: [0, 'Annual tax cannot be negative']
    },
    fyMonths: {
      type: Number,
      default: 12,
      min: [1, 'FY months must be at least 1']
    },
    /** Arrears paid in earlier months of this FY, kept in the annual taxable figure */
    priorFyArrears: { type: Number, default: 0 },
    /** Full-month taxable used for the rest of the FY (differs from mainTaxableIncome in a reduced month) */
    normalMonthlyTaxable: { type: Number, default: 0 }
  },
  // Metadata
  currency: {
    type: String,
    default: 'PKR',
    enum: ['PKR', 'USD', 'EUR']
  },
  remarks: {
    type: String,
    trim: true
  },
  proration: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined
  },
  // One-month % salary cut (imported) — EOBI kept full when applied
  salaryPercentageCut: {
    percentage: { type: Number, min: 0, max: 100 },
    factor: { type: Number, min: 0, max: 1 },
    appliedAt: { type: Date }
  },
  // Audit fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for attendance percentage
payrollSchema.virtual('attendancePercentage').get(function() {
  if (this.totalWorkingDays === 0) return 0;
  return ((this.presentDays / this.totalWorkingDays) * 100).toFixed(2);
});

// Virtual for total allowances
payrollSchema.virtual('totalAllowances').get(function() {
  let total = 0;
  
  if (this.allowances) {
    if (this.allowances.conveyance?.isActive) {
      total += this.allowances.conveyance.amount || 0;
    }
    if (this.allowances.food?.isActive) {
      total += this.allowances.food.amount || 0;
    }
    if (this.allowances.mobile?.isActive) {
      total += this.allowances.mobile.amount || 0;
    }
    if (this.allowances.vehicle?.isActive) {
      total += this.allowances.vehicle.amount || 0;
    }
    if (this.allowances.fuel?.isActive) {
      total += this.allowances.fuel.amount || 0;
    }
    if (!this.allowances.vehicle?.isActive && !this.allowances.fuel?.isActive && this.allowances.vehicleFuel?.isActive) {
      total += this.allowances.vehicleFuel.amount || 0;
    }
    if (this.allowances.medical?.isActive) {
      total += this.allowances.medical.amount || 0;
    }
    if (this.allowances.houseRent?.isActive) {
      total += this.allowances.houseRent.amount || 0;
    }
    if (this.allowances.special?.isActive) {
      total += this.allowances.special.amount || 0;
    }
    if (this.allowances.other?.isActive) {
      total += this.allowances.other.amount || 0;
    }
  }
  
  return total;
});

// Virtual for total bonuses
payrollSchema.virtual('totalBonuses').get(function() {
  return this.performanceBonus + this.otherBonus;
});

// Pre-save middleware to calculate totals - TEMPORARILY DISABLED
/*
payrollSchema.pre('save', function(next) {
  // Auto-calculate Provident Fund (8.34% of basic salary) if not provided
  if (!this.providentFund && this.basicSalary > 0) {
    this.providentFund = Math.round((this.basicSalary * 8.34) / 100);
  }
  
  // EOBI is set to 407 PKR for employees with active EOBI (Pakistan EOBI fixed amount)
  this.eobi = 407;
  
  // Auto-calculate core salary components if not provided
  if (!this.medicalAllowance && this.allowances?.medical?.isActive) {
    this.medicalAllowance = this.allowances.medical.amount;
  }
  
  // Auto-calculate house rent allowance if not provided (23.34% of gross salary)
  if (!this.houseRentAllowance && this.basicSalary > 0) {
    // Calculate what the gross salary should be based on basic salary (66.66% of total gross)
    const expectedGrossSalary = Math.round(this.basicSalary / 0.6666);
    this.houseRentAllowance = Math.round(expectedGrossSalary * 0.2334);
  }
  
  // TWO-TIER ALLOWANCE SYSTEM:
  // If monthly payroll allowances are not explicitly set, use employee master allowances as defaults
  // This allows monthly overrides while maintaining employee master settings as fallbacks
  
  // Note: The allowances are already populated from the frontend when creating payroll
  // This hook ensures calculations are correct based on the final allowance values
  
  // Recalculate gross salary (Base only - Basic + Medical + House Rent)
  this.grossSalary = this.basicSalary + 
    (this.houseRentAllowance || 0) + 
    (this.medicalAllowance || 0);
  
  // 🔧 FIXED: Total Earnings should ONLY change when salary structure changes
  // NOT when attendance or deductions change
  const shouldRecalculateTotalEarnings = 
    this.isModified('basicSalary') ||
    this.isModified('houseRentAllowance') ||
    this.isModified('medicalAllowance') ||
    this.isModified('allowances') ||
    this.isModified('overtimeAmount') ||
    this.isModified('performanceBonus') ||
    this.isModified('otherBonus') ||
    !this.totalEarnings; // Only calculate if not set initially

  if (shouldRecalculateTotalEarnings) {
    // Calculate Total Earnings (Gross Salary Base + Additional Allowances + Overtime + Bonuses)
    const additionalAllowances = 
      (this.allowances?.conveyance?.isActive ? this.allowances.conveyance.amount : 0) +
      (this.allowances?.food?.isActive ? this.allowances.food.amount : 0) +
      (this.allowances?.mobile?.isActive ? this.allowances.mobile.amount : 0) +
      (this.allowances?.vehicleFuel?.isActive ? this.allowances.vehicleFuel.amount : 0) +
      (this.allowances?.special?.isActive ? this.allowances.special.amount : 0) +
      (this.allowances?.other?.isActive ? this.allowances.other.amount : 0);
    
    // Total Earnings = Gross Salary (Base) + Additional Allowances + Overtime + Bonuses
    this.totalEarnings = this.grossSalary + additionalAllowances + 
      (this.overtimeAmount || 0) + 
      (this.performanceBonus || 0) + 
      (this.otherBonus || 0);
    
    // Log the Total Earnings calculation breakdown
    console.log(`💰 Total Earnings Calculation (Salary Structure Changed):`);
    console.log(`   Gross Salary (Base): Rs. ${this.grossSalary?.toFixed(2) || 0}`);
    console.log(`   Additional Allowances: Rs. ${additionalAllowances?.toFixed(2) || 0}`);
    console.log(`   Overtime Amount: Rs. ${this.overtimeAmount?.toFixed(2) || 0}`);
    console.log(`   Performance Bonus: Rs. ${this.performanceBonus?.toFixed(2) || 0}`);
    console.log(`   Other Bonus: Rs. ${this.otherBonus?.toFixed(2) || 0}`);
    console.log(`   Total Earnings: Rs. ${this.totalEarnings?.toFixed(2) || 0}`);
  } else {
    // IMPORTANT: Preserve the existing total earnings value
    const originalTotalEarnings = this.totalEarnings;
    console.log(`💰 Total Earnings UNCHANGED: Rs. ${originalTotalEarnings?.toFixed(2) || 0} (No salary structure changes)`);
    
    // Ensure total earnings is not modified during attendance updates
    if (this.isModified('presentDays') || this.isModified('absentDays') || this.isModified('leaveDays')) {
      console.log(`   📊 Attendance update detected - preserving total earnings: Rs. ${originalTotalEarnings?.toFixed(2) || 0}`);
    }
  }
  
  // Tax calculation according to user's formula (ONLY if income tax is completely undefined/null)
  // If income tax has any value (including 0), respect it and don't recalculate
  if (this.incomeTax === undefined || this.incomeTax === null) {
    // 1. Calculate medical allowance (10% of total earnings - tax exempt)
    const medicalAllowanceForTax = Math.round(this.totalEarnings * 0.10);
    
    // 2. Calculate taxable income (total earnings - medical allowance)
    const taxableIncome = this.totalEarnings - medicalAllowanceForTax;
    
    // 3. Calculate tax using FBR 2026-2027 rules on taxable income
    const annualTaxableIncome = taxableIncome * 12;
    
    let annualTax = 0;
    
    if (annualTaxableIncome <= 600000) {
      annualTax = 0;
    } else if (annualTaxableIncome <= 1200000) {
      annualTax = (annualTaxableIncome - 600000) * 0.01;
    } else if (annualTaxableIncome <= 2200000) {
      annualTax = 6000 + (annualTaxableIncome - 1200000) * 0.11;
    } else if (annualTaxableIncome <= 3200000) {
      annualTax = 116000 + (annualTaxableIncome - 2200000) * 0.20;
    } else if (annualTaxableIncome <= 4100000) {
      annualTax = 316000 + (annualTaxableIncome - 3200000) * 0.25;
    } else if (annualTaxableIncome <= 5600000) {
      annualTax = 541000 + (annualTaxableIncome - 4100000) * 0.29;
    } else if (annualTaxableIncome <= 7000000) {
      annualTax = 976000 + (annualTaxableIncome - 5600000) * 0.32;
    } else {
      annualTax = 1424000 + (annualTaxableIncome - 7000000) * 0.35;
    }
    
    // 4. Convert to monthly tax (don't add medical allowance back)
    const monthlyTax = Math.round(annualTax / 12);
    this.incomeTax = monthlyTax;
    
    console.log(`💰 Pre-save Tax Calculation (User's Formula): Total Earnings: ${this.totalEarnings}, Medical (10%): ${medicalAllowanceForTax}, Taxable: ${taxableIncome}, Monthly Tax: ${monthlyTax}`);
  } else {
    console.log(`💰 Pre-save: Income Tax already set to ${this.incomeTax} - respecting existing value`);
  }
  
  // 26-Day Attendance System: Calculate daily rate and attendance deduction
  if (this.grossSalary > 0) {
    this.dailyRate = this.grossSalary / 26; // Daily Rate = Gross Salary ÷ 26
    console.log(`💰 Daily Rate Calculation: ${this.grossSalary} ÷ 26 = ${this.dailyRate.toFixed(2)}`);
  }
  
  // 🔧 AUTOMATIC ABSENT DAYS CALCULATION
  // Always recalculate absent days based on present days and leave days
  if (this.totalWorkingDays > 0 && this.presentDays !== undefined) {
    const calculatedAbsentDays = Math.max(0, this.totalWorkingDays - this.presentDays - (this.leaveDays || 0));
    
    // Only update if the calculated value is different from current value
    if (this.absentDays !== calculatedAbsentDays) {
      console.log(`🧮 Pre-save: Auto-calculating absent days: ${this.totalWorkingDays} - ${this.presentDays} - ${this.leaveDays || 0} = ${calculatedAbsentDays}`);
      console.log(`   Previous absent days: ${this.absentDays}, New absent days: ${calculatedAbsentDays}`);
      this.absentDays = calculatedAbsentDays;
    }
  }
  
  // 🔧 ALWAYS RECALCULATE ATTENDANCE DEDUCTION
  // Calculate attendance deduction based on absent days and daily rate
  if (this.dailyRate > 0 && this.absentDays > 0) {
    this.attendanceDeduction = this.absentDays * this.dailyRate; // Deduction = Daily Rate × Absent Days
    console.log(`💰 Attendance Deduction: ${this.absentDays} absent days × Rs. ${this.dailyRate.toFixed(2)} = Rs. ${this.attendanceDeduction.toFixed(2)}`);
  } else {
    this.attendanceDeduction = 0;
    console.log(`💰 No Attendance Deduction: ${this.absentDays || 0} absent days, Daily Rate: ${this.dailyRate?.toFixed(2) || 0}`);
  }
  
  // Calculate total deductions (excluding Provident Fund as requested)
  this.totalDeductions = 
    // (this.providentFund || 0) + // Excluded as requested
    (this.incomeTax || 0) + 
    (this.healthInsurance || 0) + 
    (this.loanDeductions || 0) +
    (this.advanceSalary || 0) +
    (this.eobi || 0) + 
    (this.employeeSecurity || 0) + 
    (this.attendanceDeduction || 0) + // Attendance deduction (26-day basis)
    (this.leaveDeduction || 0) + // Leave deduction
    (this.otherDeductions || 0);
  
  // Log the Total Deductions calculation breakdown
  console.log(`💰 Total Deductions Calculation:`);
  console.log(`   Income Tax: Rs. ${this.incomeTax?.toFixed(2) || 0}`);
  console.log(`   Health Insurance: Rs. ${this.healthInsurance?.toFixed(2) || 0}`);
  console.log(`   Loan Deductions: Rs. ${this.loanDeductions?.toFixed(2) || 0}`);
  console.log(`   Advance Salary: Rs. ${this.advanceSalary?.toFixed(2) || 0}`);
  console.log(`   EOBI: Rs. ${this.eobi || 0}`);
  console.log(`   Attendance Deduction: Rs. ${this.attendanceDeduction?.toFixed(2) || 0}`);
  console.log(`   Other Deductions: Rs. ${this.otherDeductions?.toFixed(2) || 0}`);
  console.log(`   Total Deductions: Rs. ${this.totalDeductions?.toFixed(2) || 0}`);
  
  // Calculate net salary
  this.netSalary = this.totalEarnings - this.totalDeductions;
  
  // Log the final calculations
  console.log(`💰 Final Payroll Calculations:`);
  console.log(`   Gross Salary (Base): Rs. ${this.grossSalary?.toFixed(2) || 0}`);
  console.log(`   Total Earnings: Rs. ${this.totalEarnings?.toFixed(2) || 0}`);
  console.log(`   Total Deductions: Rs. ${this.totalDeductions?.toFixed(2) || 0}`);
  console.log(`   Net Salary: Rs. ${this.netSalary?.toFixed(2) || 0}`);
  console.log(`   Attendance Deduction: Rs. ${this.attendanceDeduction?.toFixed(2) || 0} (${this.absentDays || 0} days × Rs. ${this.dailyRate?.toFixed(2) || 0})`);
  
  next();
});
*/

// 🚫 MIDDLEWARE DISABLED - Route calculations will be preserved exactly as calculated
console.log('🚫 Pre-save middleware DISABLED - preserving route calculations');

// Capture status on load so we can lock financial edits after leaving Draft
payrollSchema.post('init', function () {
  this.$locals = this.$locals || {};
  this.$locals.originalStatus = this.status;
});

// Non-Draft monthly payrolls are immutable except approval/payment workflow fields
payrollSchema.pre('save', function (next) {
  if (this.isNew) return next();

  const { isPayrollRecordLocked, payrollLockMessage } = require('../../utils/payrollLock');
  const originalStatus = this.$locals?.originalStatus ?? this.status;
  if (!isPayrollRecordLocked(originalStatus)) return next();

  const workflowPaths = new Set([
    'status',
    'approvedBy',
    'approvedAt',
    'paymentDate',
    'paymentMethod',
    'paymentReference',
    'paidBy',
    'updatedBy',
    'updatedAt',
    '__v'
  ]);

  const forbidden = this.modifiedPaths().filter((path) => {
    const root = path.split('.')[0];
    return !workflowPaths.has(root);
  });

  if (forbidden.length > 0) {
    return next(new Error(payrollLockMessage(this)));
  }

  return next();
});

// Tax calculation according to user's formula
payrollSchema.methods.calculateTax = function() {
  if (!this.totalEarnings) return 0;
  
  // 1. Calculate medical allowance (10% of total earnings - tax exempt)
  const medicalAllowanceForTax = Math.round(this.totalEarnings * 0.10);
  
  // 2. Calculate taxable income (total earnings - medical allowance)
  const taxableIncome = this.totalEarnings - medicalAllowanceForTax;
  
  // 3. Calculate tax using FBR 2026-2027 rules on taxable income
  const annualTaxableIncome = taxableIncome * 12;
  
  let annualTax = 0;
  
  if (annualTaxableIncome <= 600000) {
    annualTax = 0;
  } else if (annualTaxableIncome <= 1200000) {
    annualTax = (annualTaxableIncome - 600000) * 0.01;
  } else if (annualTaxableIncome <= 2200000) {
    annualTax = 6000 + (annualTaxableIncome - 1200000) * 0.11;
  } else if (annualTaxableIncome <= 3200000) {
    annualTax = 116000 + (annualTaxableIncome - 2200000) * 0.20;
  } else if (annualTaxableIncome <= 4100000) {
    annualTax = 316000 + (annualTaxableIncome - 3200000) * 0.25;
  } else if (annualTaxableIncome <= 5600000) {
    annualTax = 541000 + (annualTaxableIncome - 4100000) * 0.29;
  } else if (annualTaxableIncome <= 7000000) {
    annualTax = 976000 + (annualTaxableIncome - 5600000) * 0.32;
  } else {
    annualTax = 1424000 + (annualTaxableIncome - 7000000) * 0.35;
  }
  
  // 4. Convert to monthly tax (don't add medical allowance back)
  const monthlyTax = Math.round(annualTax / 12);
  
  console.log(`💰 calculateTax Method (User's Formula): Total Earnings: ${this.totalEarnings}, Medical (10%): ${medicalAllowanceForTax}, Taxable: ${taxableIncome}, Monthly Tax: ${monthlyTax}`);
  
  return monthlyTax;
};

// Static method to generate payroll for an employee
payrollSchema.statics.generatePayroll = async function(employeeId, month, year, attendanceData = {}) {
  const Employee = mongoose.model('Employee');
  const employee = await Employee.findById(employeeId).populate('department position');
  
  if (!employee) {
    throw new Error('Employee not found');
  }

  // Check if payroll already exists for this month/year
  const existingPayroll = await this.findOne({
    employee: employeeId,
    month: month,
    year: year
  });

  if (existingPayroll) {
    throw new Error('Payroll already exists for this month');
  }

  const monthlyGross =
    Number(employee.salary?.gross) ||
    (Number(employee.salary?.basic) || 0) + additionalAllowancesTotal(employee.allowances);

  const prorationResult = applyPayrollProration(employee, month, year, monthlyGross);
  if (prorationResult.skipPayroll) {
    throw new Error(
      prorationResult.proration?.reason || 'Employee not yet joined in this payroll period'
    );
  }

  const proration = prorationResult.proration;
  const grossSalary = prorationResult.grossSalary;
  const factor = proration.factor;
  const isPartialSalary = proration.type === 'partial_salary';

  // Basic: scale from master when needed. Gross is already prorated by applyPayrollProration —
  // do not multiply factor again when falling back to gross * 0.6666.
  const basicSalary = employee.salary?.basic
    ? Math.round((Number(employee.salary.basic) || 0) * (factor < 1 ? factor : 1))
    : Math.round(grossSalary * 0.6666);
  
  // Calculate attendance (26 working days per month - excluding Sundays)
  let totalWorkingDays = attendanceData.totalWorkingDays || 26;
  let presentDays = attendanceData.presentDays || totalWorkingDays;
  let absentDays = attendanceData.absentDays || 0;
  let leaveDays = attendanceData.leaveDays || 0;
  
  // Allowances: already full for partial_salary; joining month may be prorated
  const payrollAllowances = payrollAllowancesFromEmployee(prorationResult.allowances);
  
  // Calculate automatic allowances based on gross salary
  const automaticMedicalAllowance = Math.round(grossSalary * 0.10); // 10% of gross salary
  const automaticHouseRentAllowance = Math.round(grossSalary * 0.2334); // 23.34% of gross salary
  
  const adjustedAttendance = adjustAttendanceForJoiningProration(
    {
      totalWorkingDays,
      presentDays,
      absentDays,
      leaveDays,
      dailyRate: grossSalary / totalWorkingDays,
      attendanceDeduction: absentDays * (grossSalary / totalWorkingDays)
    },
    proration,
    grossSalary
  );
  totalWorkingDays = adjustedAttendance.totalWorkingDays;
  presentDays = adjustedAttendance.presentDays;
  absentDays = adjustedAttendance.absentDays;
  leaveDays = adjustedAttendance.leaveDays;
  const dailyRate = adjustedAttendance.dailyRate;
  const attendanceDeduction = adjustedAttendance.attendanceDeduction;

  // Calculate Total Earnings (Gross Salary Base + Additional Allowances + Overtime + Bonuses + Arrears)
  const additionalAllowances = 
    (payrollAllowances.conveyance.isActive ? payrollAllowances.conveyance.amount : 0) +
    (payrollAllowances.food.isActive ? payrollAllowances.food.amount : 0) +
    (payrollAllowances.mobile?.isActive ? payrollAllowances.mobile.amount : 0) +
    vehicleFuelTotal(payrollAllowances) +
    (payrollAllowances.medical.isActive ? payrollAllowances.medical.amount : 0) +
    (payrollAllowances.houseRent.isActive ? payrollAllowances.houseRent.amount : 0) +
    (payrollAllowances.special.isActive ? payrollAllowances.special.amount : 0) +
    (payrollAllowances.other.isActive ? payrollAllowances.other.amount : 0);
  
  // Get arrears from employee record (for current month only)
  const currentMonth = month;
  const currentYear = year;
  let employeeArrears = 0;
  
  // Check if employee has arrears for the current month
  if (employee.arrears) {
    // Check all arrears types for the current month
    const arrearsTypes = ['salaryAdjustment', 'bonusPayment', 'overtimePayment', 'allowanceAdjustment', 'deductionReversal', 'other'];
    
    for (const arrearsType of arrearsTypes) {
      const arrearsData = employee.arrears[arrearsType];
      if (arrearsData && arrearsData.isActive && 
          arrearsData.month === currentMonth && 
          arrearsData.year === currentYear && 
          arrearsData.status !== 'Paid' && 
          arrearsData.status !== 'Cancelled') {
        employeeArrears += arrearsData.amount || 0;
        console.log(`💰 Found ${arrearsType} arrears for ${currentMonth}/${currentYear}: Rs. ${arrearsData.amount || 0}`);
      }
    }
  }
  
  console.log(`💰 Total employee arrears for ${currentMonth}/${currentYear}: Rs. ${employeeArrears}`);
  
  // Total Earnings = Gross Salary (Base) + Additional Allowances + Overtime + Bonuses + Arrears
  const totalEarnings = grossSalary + additionalAllowances + employeeArrears;

  // Calculate overtime (if any)
  const overtimeHours = attendanceData.overtimeHours || 0;
  const overtimeRate = (basicSalary / 176); // Assuming 176 working hours per month
  const overtimeAmount = overtimeHours * overtimeRate;

  // Get loan deductions and salary advances
  const loanDeductions = await calculateLoanDeductions(employee._id, month, year);
  const advanceSalary = await calculateSalaryAdvance(employee._id, month, year);

  // Create payroll object
  const payrollData = {
    employee: employeeId,
    month: month,
    year: year,
    basicSalary: basicSalary,
    allowances: payrollAllowances,
    // Set direct allowance fields for backward compatibility
    conveyanceAllowance: payrollAllowances.conveyance.isActive ? payrollAllowances.conveyance.amount : 0,
    foodAllowance: payrollAllowances.food.isActive ? payrollAllowances.food.amount : 0,
    mobileAllowance: payrollAllowances.mobile?.isActive ? payrollAllowances.mobile.amount : 0,
    vehicleAllowance: vehicleAllowanceAmount(payrollAllowances),
    fuelAllowance: fuelAllowanceAmount(payrollAllowances),
    vehicleFuelAllowance: vehicleFuelTotal(payrollAllowances),
    // Automatic allowances based on gross salary
    houseRentAllowance: automaticHouseRentAllowance,
    medicalAllowance: automaticMedicalAllowance,
    overtimeHours: overtimeHours,
    overtimeRate: overtimeRate,
    overtimeAmount: overtimeAmount,
    performanceBonus: attendanceData.performanceBonus || 0,
    otherBonus: attendanceData.otherBonus || 0,
    arrears: employeeArrears,
    providentFund: attendanceData.providentFund || Math.round((basicSalary * 8.34) / 100),
    incomeTax: attendanceData.incomeTax || 0,
    healthInsurance: attendanceData.healthInsurance || 0,
    loanDeductions: loanDeductions,
    advanceSalary: advanceSalary,
    otherDeductions: attendanceData.otherDeductions || 0,
    totalWorkingDays: totalWorkingDays,
    presentDays: presentDays,
    absentDays: absentDays,
    leaveDays: leaveDays,
    dailyRate: dailyRate,
    attendanceDeduction: attendanceDeduction,
    grossSalary: grossSalary,
    totalEarnings: totalEarnings,
    eobi: (() => {
      let eobi = getEmployeeEobiDeduction(employee);
      // Partial salary: salary only — do not scale EOBI. Joining month still prorates.
      if (factor < 1 && !isPartialSalary) eobi = Math.round(eobi * factor);
      return eobi;
    })(),
    employeeSecurity: (() => {
      let sec = getEmployeeSecurityDeduction(employee);
      if (factor < 1 && !isPartialSalary) sec = Math.round(sec * factor);
      return sec;
    })(),
    currency: employee.currency || 'PKR',
    remarks: `Monthly payroll generated for ${month}/${year}${buildPayrollProrationRemarksSuffix(proration)}`,
    proration: proration?.isProrated ? proration : undefined,
    status: 'Draft',
    createdBy: attendanceData.createdBy || 'system'
  };

  return new this(payrollData);
};

// Static method to get payroll statistics
payrollSchema.statics.getStatistics = async function(year, month) {
  const matchStage = {};
  if (year) matchStage.year = year;
  if (month) matchStage.month = month;

  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalPayrolls: { $sum: 1 },
        totalGrossSalary: { $sum: '$grossSalary' },
        totalNetSalary: { $sum: '$netSalary' },
        totalDeductions: { $sum: '$totalDeductions' },
        totalOvertime: { $sum: '$overtimeAmount' },
        totalBonuses: { $sum: { $add: ['$performanceBonus', '$otherBonus'] } },
        averageGrossSalary: { $avg: '$grossSalary' },
        averageNetSalary: { $avg: '$netSalary' }
      }
    }
  ]);

  return stats[0] || {
    totalPayrolls: 0,
    totalGrossSalary: 0,
    totalNetSalary: 0,
    totalDeductions: 0,
    totalOvertime: 0,
    totalBonuses: 0,
    averageGrossSalary: 0,
    averageNetSalary: 0
  };
};

// Static method to get payroll statistics (alias for getStatistics)
payrollSchema.statics.getPayrollStats = async function(filters = {}) {
  const { startDate, endDate, status } = filters;
  
  const matchStage = {};
  
  if (status) matchStage.status = status;
  
  if (startDate && endDate) {
    matchStage.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalPayrolls: { $sum: 1 },
        totalGrossSalary: { $sum: '$grossSalary' },
        totalNetSalary: { $sum: '$netSalary' },
        totalDeductions: { $sum: '$totalDeductions' },
        totalOvertime: { $sum: '$overtimeAmount' },
        totalBonuses: { $sum: { $add: ['$performanceBonus', '$otherBonus'] } },
        averageGrossSalary: { $avg: '$grossSalary' },
        averageNetSalary: { $avg: '$netSalary' },
        totalTax: { $sum: '$incomeTax' },
        totalProvidentFund: { $sum: '$providentFund' }
      }
    }
  ]);

  return stats[0] || {
    totalPayrolls: 0,
    totalGrossSalary: 0,
    totalNetSalary: 0,
    totalDeductions: 0,
    totalOvertime: 0,
    totalBonuses: 0,
    averageGrossSalary: 0,
    averageNetSalary: 0,
    totalTax: 0,
    totalProvidentFund: 0
  };
};

// Static method to calculate tax for a payroll
payrollSchema.statics.calculateTaxForPayroll = async function(payrollId) {
  const payroll = await this.findById(payrollId);
  if (!payroll) {
    throw new Error('Payroll not found');
  }
  
        return payroll.calculateTax();
};

// Static method to calculate tax for all payrolls in a month/year
payrollSchema.statics.calculateTaxForMonth = async function(month, year) {
  const payrolls = await this.find({ month, year });
  const results = [];
  
  for (const payroll of payrolls) {
    try {
              const tax = payroll.calculateTax();
      results.push({
        payrollId: payroll._id,
        employeeId: payroll.employee,
        tax: tax
      });
    } catch (error) {
      console.error(`Error calculating tax for payroll ${payroll._id}:`, error);
      results.push({
        payrollId: payroll._id,
        employeeId: payroll.employee,
        error: error.message
      });
    }
  }
  
  return results;
};

// Instance method to approve payroll
payrollSchema.methods.approve = async function(approvedByUserId) {
  if (this.status !== 'Draft') {
    throw new Error('Only draft payrolls can be approved');
  }
  
  this.status = 'Approved';
  this.approvedBy = approvedByUserId;
  this.approvedAt = new Date();
  
  // Update employee's arrears status to 'Paid' for this month when payroll is approved
  if (this.arrears > 0) {
    const { markEmployeeArrearsPaidForPeriod } = require('../../utils/employeeArrearsUpdate');
    const updated = await markEmployeeArrearsPaidForPeriod(this.employee, this.month, this.year);
    if (updated) {
      console.log(`✅ Employee arrears updated to 'Paid' for ${this.month}/${this.year} (Payroll Approved)`);
    }
  }
  
  return await this.save();
};

// Instance method to mark payroll as paid
payrollSchema.methods.markAsPaid = async function(paymentMethod = 'Bank Transfer') {
  const { isPayrollFinalApprovedStatus } = require('../../utils/payrollAuthorityPayrollStatus');
  if (!isPayrollFinalApprovedStatus(this.status)) {
    throw new Error('Only fully approved payrolls can be marked as paid');
  }
  
  this.status = 'Paid';
  this.paymentMethod = paymentMethod;
  this.paymentDate = new Date();
  
  // 🏦 Process loan payments from payroll deductions
  try {
    const LoanPayrollService = require('../../services/loanPayrollService');
    const loanResult = await LoanPayrollService.processLoanPayments(this, 'paid');
    
    if (loanResult.success) {
      console.log(`🏦 Loan payments processed: ${loanResult.processedLoans} loans, Rs ${loanResult.totalProcessed}`);
    } else {
      console.error(`❌ Loan payment processing failed: ${loanResult.message}`);
    }
  } catch (loanError) {
    console.error(`❌ Error processing loan payments:`, loanError);
    // Continue with payroll processing even if loan processing fails
  }

  // 💵 Adjust Salary Advances when payroll is paid
  try {
    const SalaryAdvance = mongoose.model('SalaryAdvance');
    await SalaryAdvance.updateMany(
      {
        employee: this.employee,
        payrollMonth: this.month,
        payrollYear: this.year,
        status: 'Unadjusted'
      },
      {
        $set: {
          status: 'Adjusted',
          adjustedPayroll: this._id,
          adjustedAt: new Date()
        }
      }
    );
    console.log(`💵 Salary advances adjusted for employee ${this.employee} for ${this.month}/${this.year}`);
  } catch (advError) {
    console.error(`❌ Error adjusting salary advances:`, advError);
  }
  
  // Reset arrears to 0 after payroll is processed
  if (this.arrears > 0) {
    console.log(`💰 Resetting arrears to 0 for employee ${this.employee} after payroll processing for ${this.month}/${this.year}`);
    this.arrears = 0;
  }
  
  // Update employee's arrears status to 'Paid' for this month
  const { markEmployeeArrearsPaidForPeriod } = require('../../utils/employeeArrearsUpdate');
  const updated = await markEmployeeArrearsPaidForPeriod(this.employee, this.month, this.year);
  if (updated) {
    console.log(`✅ Employee arrears updated to 'Paid' for ${this.month}/${this.year}`);
  }
  
  return await this.save();
};

// Instance method to mark payroll as unpaid (revert to draft)
payrollSchema.methods.markAsUnpaid = async function() {
  if (this.status !== 'Paid') {
    throw new Error('Only paid payrolls can be marked as unpaid');
  }
  
  this.status = 'Draft';
  this.paymentMethod = undefined;
  this.paymentDate = undefined;
  this.approvedBy = undefined;
  this.approvedAt = undefined;
  
  return await this.save();
};

// Instance method to calculate attendance deduction
payrollSchema.methods.calculateAttendanceDeduction = function() {
  if (this.grossSalary > 0 && this.absentDays > 0) {
    this.dailyRate = this.grossSalary / 26;
    this.attendanceDeduction = this.absentDays * this.dailyRate;
    
    console.log(`💰 Attendance Deduction Calculation:`);
    console.log(`   Gross Salary: Rs. ${this.grossSalary.toFixed(2)}`);
    console.log(`   Daily Rate: Rs. ${this.dailyRate.toFixed(2)} (${this.grossSalary} ÷ 26)`);
    console.log(`   Absent Days: ${this.absentDays}`);
    console.log(`   Attendance Deduction: Rs. ${this.attendanceDeduction.toFixed(2)} (${this.absentDays} × ${this.dailyRate.toFixed(2)})`);
    
    return this.attendanceDeduction;
  } else {
    this.attendanceDeduction = 0;
    console.log(`💰 No Attendance Deduction: Gross Salary: ${this.grossSalary}, Absent Days: ${this.absentDays}`);
    return 0;
  }
};

// Index for efficient queries
payrollSchema.index({ employee: 1, month: 1, year: 1, isManual: 1 }, { unique: true });
payrollSchema.index({ status: 1 });
payrollSchema.index({ month: 1, year: 1 });
payrollSchema.index({ createdAt: -1 }); // For sorting by creation date
payrollSchema.index({ employee: 1, status: 1 }); // For employee-specific queries
payrollSchema.index({ year: -1, month: -1 }); // For date range queries

module.exports = mongoose.model('Payroll', payrollSchema); 