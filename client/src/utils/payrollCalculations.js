import { vehicleAllowanceAmount, fuelAllowanceAmount } from './allowanceHelpers';

/**
 * 🧮 Payroll Calculation Utilities
 * Optimized, reusable calculations for payroll management
 * Ensures consistency between frontend and backend calculations
 */

/**
 * Calculate Gross Salary (Base) from basic salary components
 * @param {number} basicSalary - Basic salary amount
 * @param {number} houseRentAllowance - House rent allowance
 * @param {number} medicalAllowance - Medical allowance
 * @returns {number} Gross salary (base)
 */
export const calculateGrossSalary = (basicSalary = 0, houseRentAllowance = 0, medicalAllowance = 0) => {
  return basicSalary + houseRentAllowance + medicalAllowance;
};

/**
 * Calculate Total Earnings including all allowances and bonuses
 * @param {Object} payroll - Payroll object with salary and allowance data
 * @returns {number} Total earnings
 */
export const calculateTotalEarnings = (payroll) => {
  if (!payroll) return 0;

  // 🔧 FIXED: Prioritize stored totalEarnings from backend
  // Only recalculate if the stored value is missing or invalid
  if (payroll.totalEarnings && payroll.totalEarnings > 0) {
    console.log('💰 Using stored Total Earnings from backend:', payroll.totalEarnings);
    return payroll.totalEarnings;
  }

  console.log('💰 Stored Total Earnings not found, recalculating...');
  
  // Calculate Gross Salary (Base) from basic salary components
  const grossSalary = calculateGrossSalary(
    payroll.basicSalary || 0,
    payroll.houseRentAllowance || 0,
    payroll.medicalAllowance || 0
  );

  // Calculate additional allowances that should be added to Gross Salary
  const additionalAllowances = [
    payroll?.allowances?.conveyance?.isActive ? (payroll.allowances.conveyance.amount || 0) : 0,
    payroll?.allowances?.food?.isActive ? (payroll.allowances.food.amount || 0) : 0,
    payroll?.allowances?.mobile?.isActive ? (payroll.allowances.mobile.amount || 0) : 0,
    vehicleAllowanceAmount(payroll?.allowances),
    fuelAllowanceAmount(payroll?.allowances),
    payroll?.allowances?.special?.isActive ? (payroll.allowances.special.amount || 0) : 0,
    payroll?.allowances?.other?.isActive ? (payroll.allowances.other.amount || 0) : 0
  ];

  // Sum of all additional allowances
  const totalAdditionalAllowances = additionalAllowances.reduce((sum, amount) => sum + amount, 0);

  // Total Earnings = Gross Salary (Base) + Additional Allowances + Overtime + Bonuses
  const totalEarnings = grossSalary + totalAdditionalAllowances + 
    (payroll.overtimeAmount || 0) + 
    (payroll.performanceBonus || 0) + 
    (payroll.otherBonus || 0);

  console.log('💰 Calculated Total Earnings:', {
    grossSalary,
    totalAdditionalAllowances,
    overtimeAmount: payroll.overtimeAmount || 0,
    performanceBonus: payroll.performanceBonus || 0,
    otherBonus: payroll.otherBonus || 0,
    totalEarnings
  });

  return totalEarnings;
};

/**
 * Calculate Daily Rate for 26-day system
 * @param {number} grossSalary - Gross salary (base)
 * @returns {number} Daily rate
 */
export const calculateDailyRate = (grossSalary = 0) => {
  return grossSalary > 0 ? grossSalary / 26 : 0;
};

/**
 * Calculate Attendance Deduction
 * @param {number} absentDays - Number of absent days
 * @param {number} dailyRate - Daily rate
 * @returns {number} Attendance deduction amount
 */
export const calculateAttendanceDeduction = (absentDays = 0, dailyRate = 0) => {
  return absentDays > 0 && dailyRate > 0 ? absentDays * dailyRate : 0;
};

/**
 * Calculate Total Deductions excluding Provident Fund
 * @param {Object} payroll - Payroll object
 * @param {number} calculatedTax - Calculated tax amount
 * @returns {number} Total deductions
 */
export const calculateTotalDeductions = (payroll, calculatedTax = 0) => {
  if (!payroll) return 0;

  // Use calculated tax if available, otherwise fall back to stored amount
  const taxAmount = calculatedTax || payroll.incomeTax || 0;

  const totalDeductions = taxAmount + 
         (payroll.healthInsurance || 0) + 
         (payroll.loanDeductions || 0) +
         (payroll.eobi || 0) + 
         (payroll.attendanceDeduction || 0) + 
         (payroll.leaveDeductionAmount || 0) + // Include leave deduction amount
         (payroll.otherDeductions || 0);

  console.log(`💰 Frontend Total Deductions Breakdown:`);
  console.log(`   Income Tax: Rs ${taxAmount}`);
  console.log(`   Health Insurance: Rs ${payroll.healthInsurance || 0}`);
  console.log(`   Loan Deductions: Rs ${payroll.loanDeductions || 0}`);
  console.log(`   EOBI: Rs ${payroll.eobi || 0}`);
  console.log(`   Attendance Deduction: Rs ${payroll.attendanceDeduction || 0}`);
  console.log(`   Leave Deduction: Rs ${payroll.leaveDeductionAmount || 0}`);
  console.log(`   Other Deductions: Rs ${payroll.otherDeductions || 0}`);
  console.log(`   Total Deductions: Rs ${totalDeductions}`);

  return totalDeductions;
};

/**
 * Calculate Net Salary
 * @param {number} totalEarnings - Total earnings
 * @param {number} totalDeductions - Total deductions
 * @returns {number} Net salary
 */
export const calculateNetSalary = (totalEarnings = 0, totalDeductions = 0) => {
  return totalEarnings - totalDeductions;
};

/**
 * Calculate Tax using Pakistan FBR 2026-2027 rules
 * @param {number} totalEarnings - Total earnings
 * @returns {Object} Tax breakdown
 */
export const calculateTaxBreakdown = (totalEarnings = 0) => {
  if (!totalEarnings || totalEarnings <= 0) return null;

  // Medical allowance is 10% of total earnings (tax-exempt)
  const medicalAllowance = Math.round(totalEarnings * 0.10);
  
  // Taxable income is total earnings minus medical allowance
  const taxableIncome = totalEarnings - medicalAllowance;
  
  // Calculate annual taxable income
  const annualTaxableIncome = taxableIncome * 12;
  
  // FBR 2026-2027 Tax Slabs for Salaried Persons
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
  
  // Apply 9% surcharge if annual taxable income exceeds Rs. 10,000,000
  if (annualTaxableIncome > 10000000) {
    const surcharge = annualTax * 0.09;
    annualTax += surcharge;
  }
  
  // Convert to monthly tax
  const monthlyTax = Math.round(annualTax / 12);
  
  return {
    totalEarnings,
    medicalAllowance,
    taxableIncome,
    annualTaxableIncome,
    monthlyTax,
    annualTax
  };
};

/**
 * Get comprehensive payroll summary with all calculations
 * @param {Object} payroll - Payroll object
 * @returns {Object} Complete payroll summary
 */
export const getPayrollSummary = (payroll) => {
  if (!payroll) return null;

  // Calculate all components
  const grossSalary = calculateGrossSalary(
    payroll.basicSalary || 0,
    payroll.houseRentAllowance || 0,
    payroll.medicalAllowance || 0
  );

  const totalEarnings = calculateTotalEarnings(payroll);
  const dailyRate = calculateDailyRate(grossSalary);
  const attendanceDeduction = calculateAttendanceDeduction(
    payroll.absentDays || 0, 
    dailyRate
  );

  // Update payroll with calculated values for consistency
  const updatedPayroll = {
    ...payroll,
    grossSalary,
    dailyRate,
    attendanceDeduction
  };

  const taxBreakdown = calculateTaxBreakdown(totalEarnings);
  const totalDeductions = calculateTotalDeductions(updatedPayroll, taxBreakdown?.monthlyTax);
  const netSalary = calculateNetSalary(totalEarnings, totalDeductions);

  return {
    grossSalary,
    totalEarnings,
    dailyRate,
    attendanceDeduction,
    totalDeductions,
    netSalary,
    taxBreakdown,
    payroll: updatedPayroll
  };
};

/**
 * Format currency for display
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount = 0) => {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

/**
 * Validate payroll data integrity
 * @param {Object} payroll - Payroll object to validate
 * @returns {Object} Validation result
 */
export const validatePayrollData = (payroll) => {
  if (!payroll) {
    return { isValid: false, errors: ['Payroll data is required'] };
  }

  const errors = [];
  
  // Check required fields
  if (!payroll.basicSalary || payroll.basicSalary <= 0) {
    errors.push('Basic salary must be greater than 0');
  }
  
  if (!payroll.employee) {
    errors.push('Employee information is required');
  }
  
  if (!payroll.month || !payroll.year) {
    errors.push('Pay period (month/year) is required');
  }

  // Check calculation consistency
  const summary = getPayrollSummary(payroll);
  if (summary) {
    const expectedGross = payroll.basicSalary + (payroll.houseRentAllowance || 0) + (payroll.medicalAllowance || 0);
    if (Math.abs(summary.grossSalary - expectedGross) > 1) {
      errors.push('Gross salary calculation mismatch');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    summary: errors.length === 0 ? summary : null
  };
};
