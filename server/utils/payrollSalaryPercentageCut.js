/**
 * Apply a one-month salary % cut to payroll amounts.
 * Everything is scaled by (100 - percentage) / 100 except EOBI and income tax (kept full —
 * tax stays on the normal salary, as Sidat calculates it). Loan / advance repayments are left unchanged.
 */

const roundPKR = (n) => Math.round(Number(n) || 0);

const scale = (value, factor) => roundPKR((Number(value) || 0) * factor);

const SCALE_FIELDS = [
  'basicSalary',
  'houseRentAllowance',
  'medicalAllowance',
  'conveyanceAllowance',
  'foodAllowance',
  'mobileAllowance',
  'vehicleAllowance',
  'fuelAllowance',
  'vehicleFuelAllowance',
  'overtimeAmount',
  'overtimeRate',
  'performanceBonus',
  'otherBonus',
  'arrears',
  'providentFund',
  'healthInsurance',
  'employeeSecurity',
  'otherDeductions',
  'attendanceDeduction',
  'dailyRate',
  'grossSalary',
  'totalEarnings'
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

const stripSalaryCutRemark = (remarks) =>
  String(remarks || '')
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p && !/^Salary cut\b/i.test(p))
    .join(' | ');

/**
 * Undo a previously applied % cut (scale back by 1/factor). EOBI was never cut.
 */
const removeSalaryPercentageCutFromPayrollData = (payrollData) => {
  if (!payrollData?.salaryPercentageCut?.percentage) return payrollData;

  const oldPct = Number(payrollData.salaryPercentageCut.percentage);
  let oldFactor = Number(payrollData.salaryPercentageCut.factor);
  if (!Number.isFinite(oldFactor) || oldFactor <= 0) {
    oldFactor = Number.isFinite(oldPct) && oldPct > 0 ? (100 - oldPct) / 100 : 0;
  }
  if (!Number.isFinite(oldFactor) || oldFactor <= 0) {
    payrollData.salaryPercentageCut = undefined;
    payrollData.remarks = stripSalaryCutRemark(payrollData.remarks);
    return payrollData;
  }

  const reverse = 1 / oldFactor;
  const eobiKeep = roundPKR(payrollData.eobi);

  for (const field of SCALE_FIELDS) {
    if (payrollData[field] != null) {
      payrollData[field] = scale(payrollData[field], reverse);
    }
  }

  if (payrollData.allowances) {
    payrollData.allowances = scaleAllowances(payrollData.allowances, reverse);
  }

  payrollData.eobi = eobiKeep;
  recalcTotals(payrollData);
  payrollData.salaryPercentageCut = undefined;
  payrollData.remarks = stripSalaryCutRemark(payrollData.remarks);
  return payrollData;
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

  // Same % already applied — no-op
  if (
    payrollData.salaryPercentageCut &&
    Number(payrollData.salaryPercentageCut.percentage) === pct
  ) {
    return payrollData;
  }

  // Different % already applied — reverse first so we never compound cuts
  if (payrollData.salaryPercentageCut?.percentage) {
    removeSalaryPercentageCutFromPayrollData(payrollData);
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

  payrollData.eobi = eobiKeep;
  recalcTotals(payrollData);

  payrollData.salaryPercentageCut = {
    percentage: pct,
    factor,
    appliedAt: new Date()
  };

  const note = `Salary cut ${pct}% this month only (EOBI & income tax full)`;
  const remarks = stripSalaryCutRemark(payrollData.remarks);
  payrollData.remarks = remarks ? `${remarks} | ${note}` : note;

  return payrollData;
};

module.exports = {
  applySalaryPercentageCutToPayrollData,
  removeSalaryPercentageCutFromPayrollData,
  roundPKR
};
