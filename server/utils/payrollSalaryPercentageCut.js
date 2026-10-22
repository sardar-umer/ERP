/**
 * Apply a one-month salary % cut to payroll amounts.
 * Everything is scaled by (100 - percentage) / 100 except EOBI (kept full).
 * Loan / advance repayments are left unchanged.
 */

const roundPKR = (n) => Math.round(Number(n) || 0);

const scale = (value, factor) => roundPKR((Number(value) || 0) * factor);

const SCALE_FIELDS = [
  'basicSalary',
  'houseRentAllowance',
  'medicalAllowance',
  'conveyanceAllowance',
  'foodAllowance',
  'vehicleAllowance',
  'fuelAllowance',
  'vehicleFuelAllowance',
  'overtimeAmount',
  'overtimeRate',
  'performanceBonus',
  'otherBonus',
  'arrears',
  'providentFund',
  'incomeTax',
  'healthInsurance',
  'employeeSecurity',
  'otherDeductions',
  'attendanceDeduction',
  'dailyRate',
  'grossSalary',
  'totalEarnings'
];

const TAX_CALC_SCALE_FIELDS = [
  'mainTax',
  'arrearsTax',
  'totalTax',
  'mainTaxableIncome',
  'arrearsTaxableIncome',
  'annualTaxableIncome',
  'annualTax'
];

const scaleAllowances = (allowances, factor) => {
  if (!allowances || typeof allowances !== 'object') return allowances;
  const next = { ...allowances };
  for (const key of Object.keys(next)) {
    const slot = next[key];
    if (slot && typeof slot === 'object' && slot.amount != null) {
      next[key] = { ...slot, amount: scale(slot.amount, factor) };
    }
  }
  return next;
};

const recalcTotals = (data) => {
  // Provident Fund is display-only (not deducted) — same as bulk generation
  data.totalDeductions = roundPKR(
    (data.incomeTax || 0) +
      (data.eobi || 0) +
      (data.employeeSecurity || 0) +
      (data.healthInsurance || 0) +
      (data.loanDeductions || 0) +
      (data.advanceSalary || 0) +
      (data.attendanceDeduction || 0) +
      (data.otherDeductions || 0)
  );
  data.netSalary = roundPKR((data.totalEarnings || 0) - data.totalDeductions);
  return data;
};

/**
 * @param {object} payrollData - plain payroll payload or lean doc
 * @param {number} percentage - e.g. 10 means pay 90%, cut 10%
 * @returns {object}
 */
const applySalaryPercentageCutToPayrollData = (payrollData, percentage) => {
  if (!payrollData) return payrollData;
  const pct = Number(percentage);
  if (!Number.isFinite(pct) || pct <= 0) return payrollData;
  if (pct >= 100) {
    throw new Error('Salary cut percentage must be less than 100');
  }

  // Avoid double-applying if already cut at same %
  if (
    payrollData.salaryPercentageCut &&
    Number(payrollData.salaryPercentageCut.percentage) === pct
  ) {
    return payrollData;
  }

  const factor = (100 - pct) / 100;
  const eobiKeep = roundPKR(payrollData.eobi);

  for (const field of SCALE_FIELDS) {
    if (payrollData[field] != null) {
      payrollData[field] = scale(payrollData[field], factor);
    }
  }

  if (payrollData.allowances) {
    payrollData.allowances = scaleAllowances(payrollData.allowances, factor);
  }

  if (payrollData.taxCalculation && typeof payrollData.taxCalculation === 'object') {
    const tax = { ...payrollData.taxCalculation };
    for (const field of TAX_CALC_SCALE_FIELDS) {
      if (tax[field] != null) tax[field] = scale(tax[field], factor);
    }
    payrollData.taxCalculation = tax;
  }

  payrollData.eobi = eobiKeep;
  recalcTotals(payrollData);

  payrollData.salaryPercentageCut = {
    percentage: pct,
    factor,
    appliedAt: new Date()
  };

  const note = `Salary cut ${pct}% this month only (EOBI full)`;
  const remarks = String(payrollData.remarks || '');
  if (!remarks.includes('Salary cut')) {
    payrollData.remarks = remarks ? `${remarks} | ${note}` : note;
  }

  return payrollData;
};

module.exports = {
  applySalaryPercentageCutToPayrollData,
  roundPKR
};
