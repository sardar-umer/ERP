const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  employeeId: {
    type: String,
    trim: true,
    auto: true
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: false,
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: false,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  dateOfBirth: {
    type: Date,
    required: [true, 'Date of birth is required']
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    required: [true, 'Gender is required']
  },
  idCard: {
    type: String,
    required: [true, 'ID Card number is required'],
    trim: true
  },
  nationality: {
    type: String,
    required: [true, 'Nationality is required'],
    trim: true
  },
  profileImage: {
    type: String,
    trim: true
  },
  religion: {
    type: String,
    enum: ['Islam', 'Christianity', 'Hinduism', 'Sikhism', 'Buddhism', 'Judaism', 'Other', 'None'],
    default: 'Islam'
  },
  maritalStatus: {
    type: String,
    enum: ['Single', 'Married', 'Divorced', 'Widowed'],
    default: 'Single'
  },
  address: {
    street: {
      type: String,
      required: function () {
        return this.employmentStatus !== 'Draft';
      }
    },
    city: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'City',
      required: function () {
        return this.employmentStatus !== 'Draft';
      }
    },
    state: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Province',
      required: function () {
        return this.employmentStatus !== 'Draft';
      }
    },
    country: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Country',
      required: function () {
        return this.employmentStatus !== 'Draft';
      }
    }
  },
  emergencyContact: {
    name: {
      type: String,
      required: function () {
        return this.employmentStatus !== 'Draft';
      }
    },
    relationship: {
      type: String,
      required: function () {
        return this.employmentStatus !== 'Draft';
      }
    },
    phone: {
      type: String,
      required: function () {
        return this.employmentStatus !== 'Draft';
      }
    },
    email: String
  },

  qualification: {
    type: String,
    required: function () {
      return this.employmentStatus !== 'Draft';
    },
    trim: true
  },
  // Additional fields from Excel file
  guardianName: {
    type: String,
    trim: true
  },
  branchCode: {
    type: String,
    trim: true
  },
  accountNumber: {
    type: String,
    trim: true
  },
  /** GL receivable for cash advances to this employee (child of 1120 Advances to employees) */
  employeeAdvanceAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    default: null,
    index: true
  },
  employeeAdvanceAccountNumber: {
    type: String,
    trim: true,
    default: ''
  },
  joiningDate: {
    type: Date
  },
  probationPeriod: {
    type: Number,
    min: [0, 'Probation period cannot be negative']
  },
  // Salary fields from Excel
  excelGrossSalary: {
    type: Number,
    min: [0, 'Gross salary cannot be negative']
  },
  // Arrears Structure (similar to allowances)
  arrears: {
    salaryAdjustment: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Salary adjustment arrears cannot be negative']
      },
      month: {
        type: Number,
        min: [1, 'Month must be between 1 and 12'],
        max: [12, 'Month must be between 1 and 12']
      },
      year: {
        type: Number,
        min: [2020, 'Year must be 2020 or later']
      },
      description: {
        type: String,
        trim: true
      },
      status: {
        type: String,
        enum: ['Pending', 'Paid', 'Overdue', 'Cancelled'],
        default: 'Pending'
      },
      createdDate: {
        type: Date,
        default: Date.now
      }
    },
    bonusPayment: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Bonus payment arrears cannot be negative']
      },
      month: {
        type: Number,
        min: [1, 'Month must be between 1 and 12'],
        max: [12, 'Month must be between 1 and 12']
      },
      year: {
        type: Number,
        min: [2020, 'Year must be 2020 or later']
      },
      description: {
        type: String,
        trim: true
      },
      status: {
        type: String,
        enum: ['Pending', 'Paid', 'Overdue', 'Cancelled'],
        default: 'Pending'
      },
      createdDate: {
        type: Date,
        default: Date.now
      }
    },
    overtimePayment: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Overtime payment arrears cannot be negative']
      },
      month: {
        type: Number,
        min: [1, 'Month must be between 1 and 12'],
        max: [12, 'Month must be between 1 and 12']
      },
      year: {
        type: Number,
        min: [2020, 'Year must be 2020 or later']
      },
      description: {
        type: String,
        trim: true
      },
      status: {
        type: String,
        enum: ['Pending', 'Paid', 'Overdue', 'Cancelled'],
        default: 'Pending'
      },
      createdDate: {
        type: Date,
        default: Date.now
      }
    },
    allowanceAdjustment: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Allowance adjustment arrears cannot be negative']
      },
      month: {
        type: Number,
        min: [1, 'Month must be between 1 and 12'],
        max: [12, 'Month must be between 1 and 12']
      },
      year: {
        type: Number,
        min: [2020, 'Year must be 2020 or later']
      },
      description: {
        type: String,
        trim: true
      },
      status: {
        type: String,
        enum: ['Pending', 'Paid', 'Overdue', 'Cancelled'],
        default: 'Pending'
      },
      createdDate: {
        type: Date,
        default: Date.now
      }
    },
    deductionReversal: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Deduction reversal arrears cannot be negative']
      },
      month: {
        type: Number,
        min: [1, 'Month must be between 1 and 12'],
        max: [12, 'Month must be between 1 and 12']
      },
      year: {
        type: Number,
        min: [2020, 'Year must be 2020 or later']
      },
      description: {
        type: String,
        trim: true
      },
      status: {
        type: String,
        enum: ['Pending', 'Paid', 'Overdue', 'Cancelled'],
        default: 'Pending'
      },
      createdDate: {
        type: Date,
        default: Date.now
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
        min: [0, 'Other arrears cannot be negative']
      },
      month: {
        type: Number,
        min: [1, 'Month must be between 1 and 12'],
        max: [12, 'Month must be between 1 and 12']
      },
      year: {
        type: Number,
        min: [2020, 'Year must be 2020 or later']
      },
      description: {
        type: String,
        trim: true
      },
      status: {
        type: String,
        enum: ['Pending', 'Paid', 'Overdue', 'Cancelled'],
        default: 'Pending'
      },
      createdDate: {
        type: Date,
        default: Date.now
      }
    }
  },
  totalEarnings: {
    type: Number,
    default: 0,
    min: [0, 'Total earnings cannot be negative']
  },
  incomeTax: {
    type: Number,
    default: 0,
    min: [0, 'Income tax cannot be negative']
  },
  eobiDeduction: {
    type: Number,
    default: 0,
    min: [0, 'EOBI deduction cannot be negative']
  },
  netPayable: {
    type: Number,
    default: 0,
    min: [0, 'Net payable cannot be negative']
  },
  bankName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bank',
    required: false
  },
  bankAccountNumber: {
    type: String,
    required: false,
    trim: true
  },
  foreignBankAccount: {
    type: String,
    required: false,
    trim: true
  },
  cashSalary: {
    type: Boolean,
    default: false
  },
  spouseName: {
    type: String,
    required: false,
    trim: true
  },
  appointmentDate: {
    type: Date,
    required: function () {
      return this.employmentStatus !== 'Draft';
    }
  },
  probationPeriodMonths: {
    type: Number,
    required: function () {
      return this.employmentStatus !== 'Draft';
    },
    min: [0, 'Probation period cannot be negative'],
    max: [24, 'Probation period cannot exceed 24 months']
  },
  endOfProbationDate: {
    type: Date,
    required: false
  },
  confirmationDate: {
    type: Date,
    required: false
  },
  // Placement fields
  placementCompany: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlacementCompany',
    required: false
  },
  placementSector: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sector',
    required: false
  },
  placementProject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false
  },
  placementDepartment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: false
  },
  placementSection: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Section',
    required: false
  },
  placementDesignation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Designation',
    required: false
  },
  employeeCategory: {
    type: String,
    enum: ['blue_collar', 'white_collar'],
    required: false
  },
  jobDescription: {
    type: String,
    trim: true,
    required: false
  },
  oldDesignation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Designation',
    required: false,
    default: undefined
  },
  placementLocation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Location',
    required: false
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  hod: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  reportingLine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: false
  },
  position: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Position',
    required: false
  },
  hireDate: {
    type: Date,
    required: function () {
      return this.employmentStatus !== 'Draft';
    },
    default: Date.now
  },
  employmentType: {
    type: String,
    enum: ['Full-time', 'Part-time', 'Contract', 'Intern', 'Temporary'],
    default: 'Full-time'
  },
  employmentStatus: {
    type: String,
    enum: ['Draft', 'Active', 'Inactive', 'Terminated', 'Resigned', 'Retired', 'Reinstated'],
    default: 'Draft'
  },
  // Flexible Allowance Structure (House Rent removed as it's part of distributed salary)
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
  // Basic Salary Structure (for backward compatibility)
  salary: {
    gross: {
      type: Number,
      required: false, // Made optional for updates
      min: [0, 'Gross salary cannot be negative']
    },
    basic: {
      type: Number,
      default: 0,
      min: [0, 'Basic salary cannot be negative']
    }
  },
  /** Fixed payable days per month for selected payroll periods (salary/gross only; allowances stay full). */
  partialSalaryPay: {
    isActive: { type: Boolean, default: false },
    payableDaysPerMonth: {
      type: Number,
      default: 0,
      min: [0, 'Payable days cannot be negative'],
      max: [31, 'Payable days cannot exceed 31']
    },
    periods: [{
      month: { type: Number, min: 1, max: 12, required: true },
      year: { type: Number, min: 2020, required: true }
    }]
  },
  // EOBI (Employees' Old-Age Benefits Institution) - Pakistan
  eobi: {
    isActive: {
      type: Boolean,
      default: false
    },
    amount: {
      type: Number,
      default: 0,
      min: [0, 'EOBI amount cannot be negative']
    },
    percentage: {
      type: Number,
      default: 1, // 1% of minimum wage
      min: [0, 'EOBI percentage cannot be negative']
    }
  },
  // Provident Fund (PF) - Pakistan
  providentFund: {
    isActive: {
      type: Boolean,
      default: false
    },
    amount: {
      type: Number,
      default: 0,
      min: [0, 'Provident Fund amount cannot be negative']
    },
    percentage: {
      type: Number,
      default: 8.34, // 8.34% of basic salary for employees
      min: [0, 'Provident Fund percentage cannot be negative']
    }
  },
  // Employee Security Deduction
  employeeSecurity: {
    isActive: {
      type: Boolean,
      default: false
    },
    amount: {
      type: Number,
      default: 0,
      min: [0, 'Employee security amount cannot be negative']
    }
  },
  currency: {
    type: String,
    default: 'PKR',
    enum: ['PKR', 'USD', 'EUR']
  },
  // Salary calculation helpers
  salaryStructure: {
    type: String,
    enum: ['Basic', 'Gross', 'Net'],
    default: 'Gross'
  },
  // Tax and deductions
  taxExemption: {
    type: Boolean,
    default: false
  },
  taxExemptionAmount: {
    type: Number,
    default: 0,
    min: [0, 'Tax exemption amount cannot be negative']
  },
  // Manual tax override: when isActive, payroll uses fixedAmount instead of auto-calculated tax
  manualTax: {
    isActive: {
      type: Boolean,
      default: false
    },
    fixedAmount: {
      type: Number,
      default: 0,
      min: [0, 'Manual tax amount cannot be negative']
    }
  },
  benefits: {
    healthInsurance: {
      type: Boolean,
      default: false
    },
    dentalInsurance: {
      type: Boolean,
      default: false
    },
    visionInsurance: {
      type: Boolean,
      default: false
    },
    lifeInsurance: {
      type: Boolean,
      default: false
    },
    retirementPlan: {
      type: Boolean,
      default: false
    }
  },
  // Loan Information
  loans: {
    vehicleLoan: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Vehicle loan amount cannot be negative']
      },
      monthlyInstallment: {
        type: Number,
        default: 0,
        min: [0, 'Monthly installment cannot be negative']
      },
      outstandingBalance: {
        type: Number,
        default: 0,
        min: [0, 'Outstanding balance cannot be negative']
      },
      startDate: {
        type: Date
      },
      endDate: {
        type: Date
      }
    },
    companyLoan: {
      isActive: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0,
        min: [0, 'Company loan amount cannot be negative']
      },
      monthlyInstallment: {
        type: Number,
        default: 0,
        min: [0, 'Monthly installment cannot be negative']
      },
      outstandingBalance: {
        type: Number,
        default: 0,
        min: [0, 'Outstanding balance cannot be negative']
      },
      startDate: {
        type: Date
      },
      endDate: {
        type: Date
      }
    }
  },
  documents: [{
    type: {
      type: String,
      enum: ['ID', 'Passport', 'Visa', 'WorkPermit', 'Contract', 'Resume', 'Other'],
      required: true
    },
    name: {
      type: String,
      required: true
    },
    fileUrl: {
      type: String,
      required: true
    },
    uploadDate: {
      type: Date,
      default: Date.now
    },
    expiryDate: Date
  }],
  skills: [{
    name: String,
    level: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Advanced', 'Expert']
    },
    certified: {
      type: Boolean,
      default: false
    }
  }],
  education: [{
    degree: String,
    institution: String,
    field: String,
    graduationYear: Number,
    gpa: Number,
    certificate: String
  }],
  // Academic Background (optional, shown when qualification is education)
  academicBackground: [{
    degree: {
      type: String,
      trim: true
    },
    institution: {
      type: String,
      trim: true
    },
    fieldOfStudy: {
      type: String,
      trim: true
    },
    graduationYear: {
      type: Number,
      min: 1900,
      max: 2100
    },
    gpa: {
      type: Number,
      min: 0,
      max: 4
    },
    percentage: {
      type: Number,
      min: 0,
      max: 100
    },
    grade: {
      type: String,
      trim: true
    },
    certificate: {
      type: String,
      trim: true
    }
  }],
  // Professional Education (optional, shown when qualification is education)
  professionalEducation: [{
    courseName: {
      type: String,
      trim: true
    },
    institution: {
      type: String,
      trim: true
    },
    certificationBody: {
      type: String,
      trim: true
    },
    completionDate: {
      type: Date
    },
    expiryDate: {
      type: Date
    },
    certificateNumber: {
      type: String,
      trim: true
    },
    certificate: {
      type: String,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  // Employment History (optional)
  employmentHistory: [{
    companyName: {
      type: String,
      trim: true
    },
    position: {
      type: String,
      trim: true
    },
    startDate: {
      type: Date
    },
    endDate: {
      type: Date
    },
    isCurrentJob: {
      type: Boolean,
      default: false
    },
    location: {
      type: String,
      trim: true
    },
    responsibilities: {
      type: String,
      trim: true
    },
    reasonForLeaving: {
      type: String,
      trim: true
    },
    salary: {
      type: Number,
      min: 0
    },
    supervisorName: {
      type: String,
      trim: true
    },
    supervisorContact: {
      type: String,
      trim: true
    }
  }],
  workExperience: [{
    company: String,
    position: String,
    startDate: Date,
    endDate: Date,
    description: String,
    achievements: [String]
  }],
  performance: {
    lastReviewDate: Date,
    nextReviewDate: Date,
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comments: String
  },
  attendance: {
    totalDays: {
      type: Number,
      default: 0
    },
    presentDays: {
      type: Number,
      default: 0
    },
    absentDays: {
      type: Number,
      default: 0
    },
    leaveDays: {
      type: Number,
      default: 0
    }
  },
  // Leave configuration limits (customizable per employee)
  leaveConfig: {
    annualLimit: {
      type: Number,
      default: 20,
      min: [0, 'Annual leave limit cannot be negative']
    },
    sickLimit: {
      type: Number,
      default: 10,
      min: [0, 'Sick leave limit cannot be negative']
    },
    casualLimit: {
      type: Number,
      default: 10,
      min: [0, 'Casual leave limit cannot be negative']
    },
    useGlobalDefaults: {
      type: Boolean,
      default: true
    }
  },
  leaveBalance: {
    annual: {
      allocated: {
        type: Number,
        default: 20
      },
      used: {
        type: Number,
        default: 0
      },
      remaining: {
        type: Number,
        default: 20
      },
      carriedForward: {
        type: Number,
        default: 0
      },
      advance: {
        type: Number,
        default: 0,
        min: [0, 'Advance leave cannot be negative']
      }
    },
    casual: {
      allocated: {
        type: Number,
        default: 10
      },
      used: {
        type: Number,
        default: 0
      },
      remaining: {
        type: Number,
        default: 10
      },
      carriedForward: {
        type: Number,
        default: 0
      },
      advance: {
        type: Number,
        default: 0,
        min: [0, 'Advance leave cannot be negative']
      }
    },
    sick: {
      allocated: {
        type: Number,
        default: 10
      },
      used: {
        type: Number,
        default: 0
      },
      remaining: {
        type: Number,
        default: 10
      },
      carriedForward: {
        type: Number,
        default: 0
      },
      advance: {
        type: Number,
        default: 0,
        min: [0, 'Advance leave cannot be negative']
      }
    },
    // Keep medical for backward compatibility
    medical: {
      allocated: {
        type: Number,
        default: 10
      },
      used: {
        type: Number,
        default: 0
      },
      remaining: {
        type: Number,
        default: 10
      },
      carriedForward: {
        type: Number,
        default: 0
      },
      advance: {
        type: Number,
        default: 0,
        min: [0, 'Advance leave cannot be negative']
      }
    },
    maternity: {
      allocated: {
        type: Number,
        default: 0
      },
      used: {
        type: Number,
        default: 0
      },
      remaining: {
        type: Number,
        default: 0
      }
    },
    paternity: {
      allocated: {
        type: Number,
        default: 0
      },
      used: {
        type: Number,
        default: 0
      },
      remaining: {
        type: Number,
        default: 0
      }
    }
  },
  // Leave management integration
  leaveRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeaveRequest'
  }],
  lastLeaveBalanceUpdate: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  isLateEntryForPayroll: {
    type: Boolean,
    default: false
  },
  isLateTerminationEntryForPayroll: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  terminationDate: Date,
  terminationReason: String,
  notes: String,

  // Talent Acquisition Integration
  candidateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate'
  },
  onboardingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmployeeOnboarding'
  },

  // Increment Management Integration
  incrementHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmployeeIncrement'
  }],
  lastIncrementDate: Date,
  nextIncrementEligibleDate: Date,

  // IT Asset Assignments Integration
  assignedAssets: [{
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ITAsset'
    },
    assignedDate: {
      type: Date,
      default: Date.now
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['Active', 'Returned', 'Transferred'],
      default: 'Active'
    },
    conditionAtAssignment: {
      type: String,
      enum: ['Excellent', 'Good', 'Fair', 'Poor']
    },
    notes: String,
    accessories: [String]
  }],

  // IT Software License Assignments
  assignedLicenses: [{
    software: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SoftwareInventory'
    },
    assignedDate: {
      type: Date,
      default: Date.now
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['Active', 'Revoked', 'Expired'],
      default: 'Active'
    },
    notes: String
  }],

  // Joining Report Fields
  joiningReport: {
    documentNumber: {
      type: String,
      trim: true,
      default: 'UD/HR/FRM-005'
    },
    revisionNumber: {
      type: String,
      trim: true,
      default: '00'
    },
    issueDate: {
      type: Date,
      default: Date.now
    },
    employeeName: {
      type: String,
      trim: true
    },
    employmentPosition: {
      type: String,
      trim: true
    },
    employeeTitle: {
      type: String,
      enum: ['Mr.', 'Mrs.', 'Ms.'],
      default: 'Mr.'
    },
    parentSpouseRelation: {
      type: String,
      enum: ['S/o', 'D/o', 'W/o'],
      default: 'S/o'
    },
    parentSpouseName: {
      type: String,
      trim: true
    },
    cnic: {
      type: String,
      trim: true
    },
    contactNumber: {
      type: String,
      trim: true
    },
    reportingLocation: {
      type: String,
      trim: true
    },
    reportingDateTime: {
      type: Date
    },
    employeeSignature: {
      type: String,
      trim: true
    },
    employeeSignatureDate: {
      type: Date
    },
    // Verification (Concerned Department)
    verificationDepartment: {
      type: String,
      trim: true
    },
    hodName: {
      type: String,
      trim: true
    },
    // For Official Use Only (HR Department)
    joiningRemarks: {
      type: String,
      trim: true
    },
    hrSignature: {
      type: String,
      trim: true
    },
    hrSignatureDate: {
      type: Date
    }
  }
}, {
  timestamps: true
});

// Indexes for better query performance
// Partial unique: employeeId must be unique only among non-deleted employees (allows reusing IDs from deleted employees)
employeeSchema.index(
  { employeeId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
// Partial unique: idCard must be unique only among active non-deleted employees (allows creating a new employee with the same ID card if previous employee is inactive/terminated)
employeeSchema.index(
  { idCard: 1 },
  { unique: true, partialFilterExpression: { isActive: true, isDeleted: false } }
);
// Partial index: only index non-empty emails. Allows multiple docs with null/empty email.
employeeSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true, $gt: '' } } }
);
employeeSchema.index({ department: 1 });
employeeSchema.index({ position: 1 });
employeeSchema.index({ employmentStatus: 1 });
employeeSchema.index({ hireDate: 1 });
employeeSchema.index({ isDeleted: 1 });
employeeSchema.index({ isActive: 1 });
employeeSchema.index({ candidateId: 1 });
employeeSchema.index({ onboardingId: 1 });

// Virtual for full name
employeeSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for age
employeeSchema.virtual('age').get(function () {
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
});

// Virtual for years of service
employeeSchema.virtual('yearsOfService').get(function () {
  const today = new Date();
  const hireDate = new Date(this.hireDate);
  let years = today.getFullYear() - hireDate.getFullYear();
  const monthDiff = today.getMonth() - hireDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < hireDate.getDate())) {
    years--;
  }

  return years;
});

// Virtual for attendance percentage
employeeSchema.virtual('attendancePercentage').get(function () {
  if (this.attendance.totalDays === 0) return 0;
  return ((this.attendance.presentDays / this.attendance.totalDays) * 100).toFixed(2);
});

// Auto-calculate salary components based on gross salary
employeeSchema.virtual('calculatedBasic').get(function () {
  if (!this.salary?.gross) return 0;
  return Math.round(this.salary.gross * 0.6666); // 66.66% of gross
});

employeeSchema.virtual('calculatedHouseRent').get(function () {
  if (!this.salary?.gross) return 0;
  return Math.round(this.salary.gross * 0.3); // 30% of gross
});

employeeSchema.virtual('calculatedMedical').get(function () {
  if (!this.salary?.gross) return 0;
  return Math.round(this.salary.gross * 0.1); // 10% of gross
});

// Salary calculation virtuals
employeeSchema.virtual('totalAllowances').get(function () {
  if (!this.salary) return 0;
  return (
    (this.salary.houseRent || this.calculatedHouseRent) +
    (this.salary.medical || this.calculatedMedical)
  );
});

employeeSchema.virtual('grossSalary').get(function () {
  if (!this.salary) return 0;
  return this.salary.gross || 0;
});

employeeSchema.virtual('basicSalary').get(function () {
  return this.salary?.basic || 0;
});

employeeSchema.virtual('houseRentAllowance').get(function () {
  return this.salary?.houseRent || 0;
});

employeeSchema.virtual('medicalAllowance').get(function () {
  return this.salary?.medical || 0;
});

employeeSchema.virtual('conveyanceAllowance').get(function () {
  return this.salary?.conveyance || 0;
});

employeeSchema.virtual('specialAllowance').get(function () {
  return this.salary?.special || 0;
});

employeeSchema.virtual('otherAllowance').get(function () {
  return this.salary?.other || 0;
});

// Pre-save middleware to auto-generate Employee ID, calculate probation dates, salary components, and update user reference
employeeSchema.pre('save', async function (next) {
  // Unset email when empty - partial index allows multiple docs with null/empty
  const emailVal = this.email;
  if (emailVal === '' || emailVal === null || emailVal === undefined ||
    (typeof emailVal === 'string' && (emailVal.trim() === '' || emailVal === 'null' || emailVal.toLowerCase() === 'undefined'))) {
    this.email = undefined;
  }

  // Auto-generate Employee ID only for brand-new employees that have no ID yet.
  // Never re-assign an ID on an existing document — even if employeeId was accidentally cleared.
  if (!this.employeeId && this.isNew) {
    try {
      // Find ALL employees (including deleted ones) to get the highest ID ever created
      // This ensures no ID is ever reused, even if employee is deleted
      const allEmployees = await this.constructor.find({}, { employeeId: 1 }).lean();

      let highestId = 0;

      // Convert all employee IDs to numbers and find the highest
      allEmployees.forEach(emp => {
        if (emp.employeeId) {
          // Remove leading zeros and convert to number
          const numericId = parseInt(emp.employeeId.replace(/^0+/, ''));
          if (!isNaN(numericId) && numericId > highestId) {
            highestId = numericId;
          }
        }
      });

      // Next ID is the highest + 1 (regardless of deletion status)
      const nextId = highestId + 1;

      // Format as 5-digit string with leading zeros (e.g., 00001, 00002, 06381, 06382)
      this.employeeId = nextId.toString().padStart(5, '0');

      console.log(`Generated new Employee ID: ${this.employeeId} (highest existing ID: ${highestId})`);
    } catch (error) {
      console.error('Error generating Employee ID:', error);
      // Fallback to timestamp-based ID
      this.employeeId = Date.now().toString().slice(-6);
    }
  }

  // Auto-calculate salary components if gross salary is provided
  if (this.salary?.gross && this.isModified('salary.gross')) {
    this.salary.houseRent = Math.round(this.salary.gross * 0.2334); // 23.34% of gross
    this.salary.medical = Math.round(this.salary.gross * 0.1); // 10% of gross
    // Basic (~66.66%) takes the rounding remainder so the three parts add up to gross exactly
    this.salary.basic = Math.round(this.salary.gross) - this.salary.houseRent - this.salary.medical;

    // Sync EOBI amount with active flag (respect user-configured amount)
    if (!this.eobi?.isActive) {
      this.eobi.amount = 0;
    } else if (!this.eobi.amount || this.eobi.amount <= 0) {
      this.eobi.amount = 407;
      this.eobi.percentage = this.eobi.percentage || 1;
    }

    // Calculate Provident Fund amount if PF is active
    if (this.providentFund?.isActive) {
      // Pakistan Provident Fund: 8.34% of basic salary
      const basicSalary = this.salary.basic;
      const pfPercentage = this.providentFund.percentage || 8.34;

      // Calculate PF amount (8.34% of basic salary)
      const pfAmount = Math.round((basicSalary * pfPercentage) / 100);

      this.providentFund.amount = pfAmount;
    } else {
      this.providentFund.amount = 0;
    }

    // Update related payrolls if this is an update (not a new employee)
    if (!this.isNew) {
      try {
        const Payroll = this.constructor.model('Payroll');
        const { calculateMonthlyTax, calculateTaxableIncome, calculateTaxableIncomeCorrected } = require('../../utils/taxCalculator');
        const FBRTaxSlab = require('./FBRTaxSlab');

        // Find Draft payrolls only — non-Draft monthly payrolls are locked forever
        const relatedPayrolls = await Payroll.find({
          employee: this._id,
          status: 'Draft'
        });

        // Update each draft payroll with new salary structure
        for (const payroll of relatedPayrolls) {
          // Update basic salary and allowances
          payroll.basicSalary = this.salary.basic;
          payroll.houseRentAllowance = this.salary.houseRent;
          payroll.medicalAllowance = this.salary.medical;

          // Recalculate gross salary
          payroll.grossSalary = payroll.basicSalary +
            payroll.houseRentAllowance +
            payroll.medicalAllowance +
            payroll.conveyanceAllowance +
            payroll.specialAllowance +
            payroll.otherAllowance +
            payroll.overtimeAmount +
            payroll.performanceBonus +
            payroll.otherBonus;

          // Recalculate tax
          try {
            const taxableIncome = calculateTaxableIncome({
              basic: payroll.basicSalary,
              allowances: {
                housing: payroll.houseRentAllowance,
                transport: payroll.conveyanceAllowance,
                meal: payroll.specialAllowance,
                other: payroll.otherAllowance,
                medical: payroll.medicalAllowance
              }
            });

            const annualTaxableIncome = taxableIncome * 12;
            const taxAmount = await FBRTaxSlab.calculateTax(annualTaxableIncome);
            payroll.incomeTax = Math.round(taxAmount / 12);
          } catch (error) {
            console.error('Error recalculating tax for payroll:', payroll._id, error);
            // Fallback to old calculation
            const taxableIncome = calculateTaxableIncomeCorrected({
              basic: payroll.basicSalary,
              allowances: {
                housing: payroll.houseRentAllowance,
                transport: payroll.conveyanceAllowance,
                meal: payroll.specialAllowance,
                other: payroll.otherAllowance,
                medical: payroll.medicalAllowance
              }
            });
            payroll.incomeTax = calculateMonthlyTax(taxableIncome);
          }

          // Recalculate total deductions
          payroll.totalDeductions = payroll.providentFund +
            payroll.incomeTax +
            payroll.healthInsurance +
            payroll.otherDeductions;

          // Recalculate net salary
          payroll.netSalary = payroll.grossSalary - payroll.totalDeductions;

          // Save the updated payroll
          await payroll.save();
        }

        console.log(`Updated ${relatedPayrolls.length} payrolls for employee ${this.employeeId}`);
      } catch (error) {
        console.error('Error updating related payrolls:', error);
        // Don't fail the employee save if payroll update fails
      }
    }
  }

  if (this.isModified('eobi.isActive') || this.isModified('eobi.amount') || this.isModified('eobi')) {
    if (!this.eobi?.isActive) {
      this.eobi.amount = 0;
    } else if (!this.eobi.amount || this.eobi.amount <= 0) {
      this.eobi.amount = 407;
      this.eobi.percentage = this.eobi.percentage || 1;
    }
  }

  if (this.isModified('employeeSecurity.isActive') || this.isModified('employeeSecurity.amount') || this.isModified('employeeSecurity')) {
    if (!this.employeeSecurity?.isActive) {
      if (this.employeeSecurity) this.employeeSecurity.amount = 0;
    }
  }

  // Calculate end of probation date and confirmation date if appointment date or probation period changes
  if (this.appointmentDate && this.probationPeriodMonths) {
    const endDate = new Date(this.appointmentDate);
    endDate.setMonth(endDate.getMonth() + this.probationPeriodMonths);
    this.endOfProbationDate = endDate;
    this.confirmationDate = new Date(endDate); // Confirmation date is the same as end of probation date
  }

  // Update corresponding user document
  if (this.isModified('firstName') || this.isModified('lastName') || this.isModified('email')) {
    this.constructor.model('User').findByIdAndUpdate(
      this.user,
      {
        firstName: this.firstName,
        lastName: this.lastName,
        email: this.email
      },
      { new: true }
    ).catch(err => console.error('Error updating user:', err));
  }
  next();
});

// Static method to find active employees
employeeSchema.statics.findActive = function () {
  return this.find({ isActive: true, employmentStatus: 'Active' });
};

// Static method to find employees by department
employeeSchema.statics.findByDepartment = function (departmentId) {
  return this.find({ department: departmentId, isActive: true });
};

// Static method to find employees by position
employeeSchema.statics.findByPosition = function (positionId) {
  return this.find({ position: positionId, isActive: true });
};

// Static method to get employee statistics
employeeSchema.statics.getStatistics = async function () {
  const stats = await this.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        totalEmployees: { $sum: 1 },
        activeEmployees: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$isActive', true] }, { $eq: ['$employmentStatus', 'Active'] }] }, 1, 0]
          }
        },
        averageBasicSalary: { $avg: '$salary.basic' },
        totalBasicSalary: { $sum: '$salary.basic' },
        averageGrossSalary: { $avg: '$salary.gross' },
        totalGrossSalary: { $sum: '$salary.gross' }
      }
    }
  ]);

  return stats[0] || {
    totalEmployees: 0,
    activeEmployees: 0,
    averageBasicSalary: 0,
    totalBasicSalary: 0,
    averageGrossSalary: 0,
    totalGrossSalary: 0
  };
};

// Static method to update all payrolls for an employee
employeeSchema.statics.updateEmployeePayrolls = async function (employeeId) {
  const employee = await this.findOne({ _id: employeeId, isDeleted: false });
  if (!employee) {
    throw new Error('Employee not found or has been deleted');
  }

  const Payroll = this.model('Payroll');
  const { calculateMonthlyTax, calculateTaxableIncome, calculateTaxableIncomeCorrected } = require('../../utils/taxCalculator');
  const FBRTaxSlab = require('./FBRTaxSlab');

  // Only Draft payrolls may be resynced from master salary — non-Draft months stay locked
  const relatedPayrolls = await Payroll.find({
    employee: employeeId,
    status: 'Draft'
  });

  let updatedCount = 0;

  // Update each draft payroll with new salary structure
  for (const payroll of relatedPayrolls) {
    // Update basic salary and allowances
    payroll.basicSalary = employee.salary.basic;
    payroll.houseRentAllowance = employee.salary.houseRent;
    payroll.medicalAllowance = employee.salary.medical;

    // Recalculate gross salary
    payroll.grossSalary = payroll.basicSalary +
      payroll.houseRentAllowance +
      payroll.medicalAllowance +
      payroll.conveyanceAllowance +
      payroll.specialAllowance +
      payroll.otherAllowance +
      payroll.overtimeAmount +
      payroll.performanceBonus +
      payroll.otherBonus;

    // Recalculate tax
    try {
      const taxableIncome = calculateTaxableIncome({
        basic: payroll.basicSalary,
        allowances: {
          housing: payroll.houseRentAllowance,
          transport: payroll.conveyanceAllowance,
          meal: payroll.specialAllowance,
          other: payroll.otherAllowance,
          medical: payroll.medicalAllowance
        }
      });

      const annualTaxableIncome = taxableIncome * 12;
      const taxAmount = await FBRTaxSlab.calculateTax(annualTaxableIncome);
      payroll.incomeTax = Math.round(taxAmount / 12);
    } catch (error) {
      console.error('Error recalculating tax for payroll:', payroll._id, error);
      // Fallback to old calculation
      const taxableIncome = calculateTaxableIncomeCorrected({
        basic: payroll.basicSalary,
        allowances: {
          housing: payroll.houseRentAllowance,
          transport: payroll.conveyanceAllowance,
          meal: payroll.specialAllowance,
          other: payroll.otherAllowance,
          medical: payroll.medicalAllowance
        }
      });
      payroll.incomeTax = calculateMonthlyTax(taxableIncome);
    }

    // Recalculate total deductions
    payroll.totalDeductions = payroll.providentFund +
      payroll.incomeTax +
      payroll.healthInsurance +
      payroll.otherDeductions;

    // Recalculate net salary
    payroll.netSalary = payroll.grossSalary - payroll.totalDeductions;

    // Save the updated payroll
    await payroll.save();
    updatedCount++;
  }

  return {
    employeeId: employee.employeeId,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    updatedPayrolls: updatedCount,
    totalPayrolls: relatedPayrolls.length
  };
};

// IT Asset Management Methods
employeeSchema.methods.assignAsset = async function (assetId, assignedBy, assignmentData) {
  const assetAssignment = {
    asset: assetId,
    assignedDate: new Date(),
    assignedBy: assignedBy,
    status: 'Active',
    ...assignmentData
  };

  this.assignedAssets.push(assetAssignment);
  await this.save();
  return assetAssignment;
};

employeeSchema.methods.returnAsset = async function (assetId, returnData) {
  const assetAssignment = this.assignedAssets.find(
    assignment => assignment.asset.toString() === assetId.toString() && assignment.status === 'Active'
  );

  if (assetAssignment) {
    assetAssignment.status = 'Returned';
    assetAssignment.returnDate = new Date();
    Object.assign(assetAssignment, returnData);
    await this.save();
    return assetAssignment;
  }

  return null;
};

employeeSchema.methods.assignLicense = async function (softwareId, assignedBy, assignmentData) {
  const licenseAssignment = {
    software: softwareId,
    assignedDate: new Date(),
    assignedBy: assignedBy,
    status: 'Active',
    ...assignmentData
  };

  this.assignedLicenses.push(licenseAssignment);
  await this.save();
  return licenseAssignment;
};

employeeSchema.methods.revokeLicense = async function (softwareId, revocationData) {
  const licenseAssignment = this.assignedLicenses.find(
    assignment => assignment.software.toString() === softwareId.toString() && assignment.status === 'Active'
  );

  if (licenseAssignment) {
    licenseAssignment.status = 'Revoked';
    licenseAssignment.revokedDate = new Date();
    Object.assign(licenseAssignment, revocationData);
    await this.save();
    return licenseAssignment;
  }

  return null;
};

employeeSchema.methods.getActiveAssets = function () {
  return this.assignedAssets.filter(assignment => assignment.status === 'Active');
};

employeeSchema.methods.getActiveLicenses = function () {
  return this.assignedLicenses.filter(assignment => assignment.status === 'Active');
};

module.exports = mongoose.model('Employee', employeeSchema); 