const {
  applyJoiningProration,
  buildProrationRemarksSuffix: buildJoiningProrationRemarksSuffix,
  adjustAttendanceForJoiningProration
} = require('./payrollJoiningProration');
const { allowancesForPayrollMonth } = require('./allowanceHelpers');

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const normalizePeriods = (periods = []) =>
  periods
    .map((p) => ({
      month: Number(p.month),
      year: Number(p.year)
    }))
    .filter((p) => p.month >= 1 && p.month <= 12 && p.year >= 2020);

const matchesPartialSalaryPeriod = (employee, month, year) => {
  const config = employee?.partialSalaryPay;
  if (!config?.isActive) return false;
  const payableDays = Number(config.payableDaysPerMonth);
  if (!payableDays || payableDays < 1) return false;

  return normalizePeriods(config.periods).some(
    (p) => p.month === Number(month) && p.year === Number(year)
  );
};

const getPartialSalaryProration = (employee, month, year) => {
  if (!matchesPartialSalaryPeriod(employee, month, year)) return null;

  const payableDaysPerMonth = Number(employee.partialSalaryPay.payableDaysPerMonth);
  const daysInMonth = new Date(year, month, 0).getDate();
  const payableDays = Math.min(payableDaysPerMonth, daysInMonth);
  const factor = payableDays / daysInMonth;
  const monthLabel = MONTH_NAMES[month] || `Month ${month}`;

  return {
    factor,
    isProrated: factor < 1,
    skipPayroll: false,
    payableDays,
    daysInMonth,
    type: 'partial_salary',
    salaryOnly: true,
    workingDaysFromJoining: payableDays,
    reason: `Partial pay: ${payableDays}/${daysInMonth} days on salary only (allowances & other components full) for ${monthLabel} ${year}`
  };
};

const buildPartialSalaryRemarksSuffix = (proration) => {
  if (!proration?.isProrated || proration.type !== 'partial_salary') return '';
  return ` (Partial pay ${proration.payableDays}/${proration.daysInMonth} days on salary only)`;
};

const ALLOWANCE_LABELS = {
  conveyance: 'Conveyance',
  food: 'Food',
  mobile: 'Mobile',
  vehicle: 'Vehicle',
  fuel: 'Fuel',
  medical: 'Medical',
  houseRent: 'House Rent',
  special: 'Special',
  other: 'Other'
};

const buildAllowanceOverrideRemarksSuffix = (proration) => {
  const amounts = proration?.allowanceOverride?.amounts;
  if (!amounts || !Object.keys(amounts).length) return '';
  const parts = Object.entries(amounts).map(
    ([key, amount]) => `${ALLOWANCE_LABELS[key] || key} ${Number(amount).toLocaleString('en-PK')}`
  );
  return ` (Allowance changed for this month only: ${parts.join(', ')})`;
};

const buildPayrollProrationRemarksSuffix = (proration) => {
  const overrideSuffix = buildAllowanceOverrideRemarksSuffix(proration);
  if (!proration?.isProrated) return overrideSuffix;
  if (proration.type === 'partial_salary') {
    return buildPartialSalaryRemarksSuffix(proration) + overrideSuffix;
  }
  return buildJoiningProrationRemarksSuffix(proration) + overrideSuffix;
};

/**
 * Joining-date proration, overridden by employee partial-salary schedule for matching months.
 * Partial salary scales GROSS/SALARY only — allowances stay at full monthly amounts.
 */
const applyPayrollProration = (employee, month, year, monthlyGross) => {
  // One-month allowance change (employee master untouched) — this month's payroll uses these amounts
  const { allowances: monthAllowances, override } = allowancesForPayrollMonth(employee, month, year);
  const monthEmployee = override
    ? { hireDate: employee?.hireDate, appointmentDate: employee?.appointmentDate, allowances: monthAllowances }
    : employee;
  const withOverride = (result) => (
    override && result.proration
      ? { ...result, proration: { ...result.proration, allowanceOverride: override } }
      : result
  );

  const joiningResult = applyJoiningProration(monthEmployee, month, year, monthlyGross);
  if (joiningResult.skipPayroll) return joiningResult;

  const partialProration = getPartialSalaryProration(employee, month, year);
  if (!partialProration) return withOverride(joiningResult);

  const factor = partialProration.factor;
  return withOverride({
    skipPayroll: false,
    proration: partialProration,
    joiningDate: joiningResult.joiningDate,
    grossSalary: Math.round((Number(monthlyGross) || 0) * factor),
    // Partial pay must NOT scale allowances / other pay heads — only salary (gross).
    allowances: monthAllowances
  });
};

module.exports = {
  normalizePeriods,
  matchesPartialSalaryPeriod,
  getPartialSalaryProration,
  buildPartialSalaryRemarksSuffix,
  buildPayrollProrationRemarksSuffix,
  applyPayrollProration,
  adjustAttendanceForJoiningProration
};
