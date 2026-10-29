const {
  calculateMonthlyTaxFYAwareWithOneTimeArrears,
  calculateMonthlyTaxPaidMonths
} = require('./taxCalculator');
const { activeAmount, additionalAllowancesTotal } = require('./allowanceHelpers');
const PayrollTaxSettings = require('../models/hr/PayrollTaxSettings');
const {
  ALLOWANCE_TAX_KEYS,
  defaultAllowancePolicies
} = require('../models/hr/PayrollTaxSettings');

const DEFAULT_SALARY_MEDICAL_EXEMPT_PERCENT = 10;

const defaultSettings = () => ({
  salaryMedicalExemptPercent: DEFAULT_SALARY_MEDICAL_EXEMPT_PERCENT,
  applyScope: 'all',
  selectedEmployeeIds: [],
  allowancePolicies: defaultAllowancePolicies()
});

const normalizeSettings = (raw) => {
  const base = defaultSettings();
  if (!raw) return base;

  const policies = { ...base.allowancePolicies };
  ALLOWANCE_TAX_KEYS.forEach((key) => {
    const p = raw.allowancePolicies?.[key] || {};
    const mode = ['taxable', 'fully_exempt', 'partial_exempt'].includes(p.mode)
      ? p.mode
      : 'taxable';
    let exemptPercent = Number(p.exemptPercent) || 0;
    if (mode === 'fully_exempt') exemptPercent = 100;
    if (mode === 'taxable') exemptPercent = 0;
    exemptPercent = Math.min(100, Math.max(0, exemptPercent));
    policies[key] = { mode, exemptPercent };
  });

  return {
    salaryMedicalExemptPercent:
      raw.salaryMedicalExemptPercent != null
        ? Math.min(100, Math.max(0, Number(raw.salaryMedicalExemptPercent)))
        : DEFAULT_SALARY_MEDICAL_EXEMPT_PERCENT,
    applyScope: raw.applyScope === 'selected' ? 'selected' : 'all',
    selectedEmployeeIds: (raw.selectedEmployeeIds || []).map((id) => String(id)),
    allowancePolicies: policies
  };
};

const employeeUsesAllowanceTaxPolicy = (employeeId, settings) => {
  if (settings.applyScope === 'all') return true;
  if (!employeeId) return false;
  return settings.selectedEmployeeIds.includes(String(employeeId));
};

const taxableAndExemptPartsForAllowance = (amount, policy) => {
  const amt = Math.max(0, Number(amount) || 0);
  if (!amt) return { taxable: 0, exempt: 0 };

  const mode = policy?.mode || 'taxable';
  const exemptPercent =
    mode === 'fully_exempt'
      ? 100
      : mode === 'partial_exempt'
        ? Math.min(100, Math.max(0, Number(policy.exemptPercent) || 0))
        : 0;

  const exempt = Math.round((amt * exemptPercent) / 100);
  return { taxable: amt - exempt, exempt };
};

const buildTaxResult = ({
  mainSalary,
  arrearsAmt,
  priorFyArrears = 0,
  priorPaidMonths = null,
  priorTaxDeducted = 0,
  leavingDate = null,
  normalSalaryBase = null,
  salaryBase,
  salaryExempt,
  salaryAfterMedical,
  allowanceTaxable,
  allowanceExempt,
  allowanceBreakdown,
  usesAllowanceTaxPolicy,
  hireDate,
  payrollMonth,
  payrollYear
}) => {
  const {
    monthlyTax,
    fyMonths,
    annualTaxableIncome,
    annualTax,
    finalMonthTrueUp = false,
    taxRefundDue = 0
  } = priorPaidMonths != null && payrollMonth
    // Tax-year context known: the year is the months actually paid + months to come (Sidat method);
    // a leaver's year ends at the leaving month, which is trued up against tax already deducted
    ? calculateMonthlyTaxPaidMonths(salaryBase, normalSalaryBase, arrearsAmt + priorFyArrears, priorPaidMonths, payrollMonth, {
      payrollYear,
      leavingDate,
      priorTaxDeducted
    })
    : calculateMonthlyTaxFYAwareWithOneTimeArrears(
      salaryBase,
      arrearsAmt + priorFyArrears,
      hireDate,
      payrollMonth,
      payrollYear,
      normalSalaryBase
    );

  const totalIncome = mainSalary + arrearsAmt;

  return {
    mainSalary,
    arrears: arrearsAmt,
    // Recurring monthly taxable (gross−medical + taxable allowances) — NOT including arrears
    mainTaxableIncome: Math.round(salaryBase),
    // One-time arrears added to annual only (not × FY months)
    arrearsTaxableIncome: Math.round(arrearsAmt),
    // Arrears paid in earlier months of this FY — stay in the annual figure until June
    priorFyArrears: Math.round(priorFyArrears),
    // Full-month taxable used for the rest of the FY when this month's pay is reduced
    normalMonthlyTaxable: Math.round(normalSalaryBase == null ? salaryBase : normalSalaryBase),
    // Leaver's final month: year closed on actual pay; tax deducted beyond the year's tax is refundable
    finalMonthTrueUp,
    taxRefundDue,
    annualTaxableIncome,
    annualTax,
    fyMonths,
    mainTax: monthlyTax,
    arrearsTax: 0,
    totalTax: monthlyTax,
    mainNetSalary: Math.round(mainSalary - monthlyTax),
    arrearsNetAmount: Math.round(arrearsAmt),
    totalNetSalary: Math.round(totalIncome - monthlyTax),
    salaryMedicalExempt: salaryExempt,
    salaryAfterMedical: Math.round(salaryAfterMedical),
    salaryBase: Math.round(salaryBase),
    allowanceTaxable: Math.round(allowanceTaxable),
    allowanceExempt: Math.round(allowanceExempt),
    allowanceBreakdown: allowanceBreakdown || undefined,
    usesAllowanceTaxPolicy
  };
};

/**
 * Legacy: medical exemption on gross+allowances bundle.
 * annual = (main−10%) × FY months + arrears (once) → FBR ÷ FY months
 */
const calculateTaxLegacy = (
  mainSalary,
  arrears = 0,
  hireDate = null,
  payrollMonth = null,
  payrollYear = null,
  { priorFyArrears = 0, priorPaidMonths = null, priorTaxDeducted = 0, leavingDate = null, normalMainSalary = null } = {}
) => {
  const salaryMedicalExempt = Math.round(mainSalary * 0.1);
  const salaryAfterMedical = mainSalary - salaryMedicalExempt;
  const arrearsAmt = Math.max(0, Number(arrears) || 0);
  const normalSalaryBase = normalMainSalary == null
    ? null
    : normalMainSalary - Math.round(normalMainSalary * 0.1);

  return buildTaxResult({
    mainSalary,
    arrearsAmt,
    priorFyArrears: Math.max(0, Number(priorFyArrears) || 0),
    priorPaidMonths,
    priorTaxDeducted,
    leavingDate,
    normalSalaryBase,
    salaryBase: salaryAfterMedical,
    salaryExempt: salaryMedicalExempt,
    salaryAfterMedical,
    allowanceTaxable: salaryAfterMedical,
    allowanceExempt: 0,
    allowanceBreakdown: undefined,
    usesAllowanceTaxPolicy: false,
    hireDate,
    payrollMonth,
    payrollYear
  });
};

/**
 * Dynamic tax calculation driven by PayrollTaxes page settings.
 *
 * Recurring monthly taxable =
 *   (gross − medical% of gross) + taxable allowances
 *
 * DOJ / FY annualization (July–June):
 *   annual taxable = recurring monthly × FY months  +  arrears (ONCE, not × months)
 *   monthly tax    = FBR(annual) ÷ FY months
 *
 * Example — Javed Karim, DOJ 24/08/2026 (late join → Sep–Jun = 10), 59,354 arrears paid in Sep:
 *   230,000 − 23,000 = 207,000 × 10 = 2,070,000 + 59,354 = 2,129,354
 *   → slab ≈ 108,228 ÷ 10 ≈ 10,823 monthly tax — in Sep AND every later month (priorFyArrears)
 *
 * Optional tax-year context (see loadTaxYearContextByEmployee):
 *   priorFyArrears              — arrears paid in earlier months of this FY, kept in the annual figure
 *   priorPaidMonths             — payrolls already paid earlier in this FY; when given, the tax year is
 *                                  the months actually paid + months to come (instead of DOJ → June)
 *   priorTaxDeducted, leavingDate — a leaver's year ends at the leaving month, trued up in that month
 *   normalGrossSalary/Allowances — full-month pay for the rest of the FY when this month is reduced
 *                                  (partial-pay days, joining proration); omitted = this month's pay
 */
const calculatePayrollTaxWithSettings = ({
  grossSalary = 0,
  allowances = {},
  arrears = 0,
  employeeId = null,
  settings = null,
  hireDate = null,
  payrollMonth = null,
  payrollYear = null,
  priorFyArrears = 0,
  priorPaidMonths = null,
  priorTaxDeducted = 0,
  leavingDate = null,
  normalGrossSalary = null,
  normalAllowances = null
}) => {
  const config = normalizeSettings(settings);
  const gross = Math.max(0, Number(grossSalary) || 0);
  const arrearsAmt = Math.max(0, Number(arrears) || 0);
  const priorArrears = Math.max(0, Number(priorFyArrears) || 0);
  const totalAllowances = additionalAllowancesTotal(allowances);
  const hasNormal = normalGrossSalary != null;
  const normalGross = hasNormal ? Math.max(0, Number(normalGrossSalary) || 0) : gross;
  const normalAllow = hasNormal ? (normalAllowances || allowances) : allowances;

  if (!employeeUsesAllowanceTaxPolicy(employeeId, config)) {
    return calculateTaxLegacy(gross + totalAllowances, arrearsAmt, hireDate, payrollMonth, payrollYear, {
      priorFyArrears: priorArrears,
      priorPaidMonths,
      priorTaxDeducted,
      leavingDate,
      normalMainSalary: hasNormal ? normalGross + additionalAllowancesTotal(normalAllow) : null
    });
  }

  const taxableAllowances = (allow, breakdown = null) => {
    let taxable = 0;
    let exempt = 0;
    ALLOWANCE_TAX_KEYS.forEach((key) => {
      const amount = activeAmount(allow?.[key]);
      const parts = taxableAndExemptPartsForAllowance(amount, config.allowancePolicies[key]);
      taxable += parts.taxable;
      exempt += parts.exempt;
      if (breakdown) {
        breakdown[key] = {
          amount,
          ...parts,
          mode: config.allowancePolicies[key]?.mode || 'taxable'
        };
      }
    });
    return { taxable, exempt };
  };

  const allowanceBreakdown = {};
  const { taxable: allowanceTaxable, exempt: allowanceExempt } = taxableAllowances(allowances, allowanceBreakdown);

  const salaryExemptPercent = config.salaryMedicalExemptPercent;
  const salaryExempt = Math.round((gross * salaryExemptPercent) / 100);
  const salaryAfterMedical = gross - salaryExempt;
  const salaryBase = salaryAfterMedical + allowanceTaxable;

  let normalSalaryBase = null;
  if (hasNormal) {
    const normalAfterMedical = normalGross - Math.round((normalGross * salaryExemptPercent) / 100);
    normalSalaryBase = normalAfterMedical + taxableAllowances(normalAllow).taxable;
  }

  return buildTaxResult({
    mainSalary: gross + totalAllowances,
    arrearsAmt,
    priorFyArrears: priorArrears,
    priorPaidMonths,
    priorTaxDeducted,
    leavingDate,
    normalSalaryBase,
    salaryBase,
    salaryExempt,
    salaryAfterMedical,
    allowanceTaxable,
    allowanceExempt,
    allowanceBreakdown,
    usesAllowanceTaxPolicy: true,
    hireDate,
    payrollMonth,
    payrollYear
  });
};

/** Payroll months of the same FY (July–June) before this one, as a Mongo filter on month/year */
const priorFyMonthsFilter = (payrollMonth, payrollYear) => {
  const pm = Number(payrollMonth);
  const py = Number(payrollYear);
  if (!pm || !py || pm === 7) return null;
  const fyStartYear = pm >= 7 ? py : py - 1;
  const or = [{ year: fyStartYear, month: { $gte: 7, $lt: pm >= 7 ? pm : 13 } }];
  if (pm < 7) or.push({ year: py, month: { $lt: pm } });
  return { $or: or };
};

/**
 * Tax-year context per employee from their payrolls earlier in this FY (not Cancelled):
 *   priorFyArrears   — arrears paid, kept in the annual taxable figure until June
 *   priorPaidMonths  — months already paid, so a month with no pay (e.g. a joining month paid later as
 *                      arrears) is not projected
 *   priorTaxDeducted — income tax already deducted, for a leaver's final-month true-up
 *   leavingDate      — employee's termination date, else their final settlement's last working date
 * @returns {Promise<Map<string, { priorFyArrears, priorPaidMonths, priorTaxDeducted, leavingDate }>>}
 *          employeeId → context (employees with no earlier payroll are absent → use taxYearContextFor)
 */
const loadTaxYearContextByEmployee = async ({ payrollMonth, payrollYear, employeeIds = null }) => {
  const map = new Map();
  const monthsFilter = priorFyMonthsFilter(payrollMonth, payrollYear);
  if (monthsFilter) {
    const Payroll = require('../models/hr/Payroll');
    const match = { ...monthsFilter, status: { $ne: 'Cancelled' } };
    if (employeeIds) match.employee = { $in: employeeIds };
    const rows = await Payroll.aggregate([
      { $match: match },
      // one payroll per month counts once, even if a month was regenerated
      {
        $group: {
          _id: { employee: '$employee', year: '$year', month: '$month' },
          arrears: { $max: '$arrears' },
          tax: { $max: '$incomeTax' }
        }
      },
      { $group: { _id: '$_id.employee', arrears: { $sum: '$arrears' }, tax: { $sum: '$tax' }, months: { $sum: 1 } } }
    ]);
    rows.forEach((r) => map.set(String(r._id), {
      priorFyArrears: Math.round(Number(r.arrears) || 0),
      priorPaidMonths: r.months,
      priorTaxDeducted: Math.round(Number(r.tax) || 0),
      leavingDate: null
    }));
  }

  // Leaving dates in this FY: termination date on the employee, else the final settlement's last working date
  const pm = Number(payrollMonth);
  const py = Number(payrollYear);
  if (pm && py) {
    const fyStartYear = pm >= 7 ? py : py - 1;
    const range = { $gte: new Date(fyStartYear, 6, 1), $lt: new Date(fyStartYear + 1, 6, 1) };
    const Employee = require('../models/hr/Employee');
    const FinalSettlement = require('../models/hr/FinalSettlement');
    const empFilter = { terminationDate: range };
    const fsFilter = { lastWorkingDate: range, status: { $ne: 'cancelled' } };
    if (employeeIds) {
      empFilter._id = { $in: employeeIds };
      fsFilter.employee = { $in: employeeIds };
    }
    const [terminated, settlements] = await Promise.all([
      Employee.find(empFilter).select('_id terminationDate').lean(),
      FinalSettlement.find(fsFilter).select('employee lastWorkingDate').sort({ createdAt: 1 }).lean()
    ]);
    const leaving = new Map();
    settlements.forEach((s) => leaving.set(String(s.employee), s.lastWorkingDate));
    terminated.forEach((e) => leaving.set(String(e._id), e.terminationDate));
    leaving.forEach((date, id) => {
      const ctx = map.get(id) || { priorFyArrears: 0, priorPaidMonths: 0, priorTaxDeducted: 0 };
      map.set(id, { ...ctx, leavingDate: date });
    });
  }
  return map;
};

/** Context for one employee from a loaded map; no earlier payroll this FY = nothing paid yet */
const taxYearContextFor = (contextByEmployee, employeeId) =>
  contextByEmployee.get(String(employeeId)) || { priorFyArrears: 0, priorPaidMonths: 0, priorTaxDeducted: 0, leavingDate: null };

/**
 * Normal full-month pay for the rest of the FY — only when this month is reduced (partial-pay days,
 * joining proration), so the reduced month is not annualized. Otherwise {} (this month = normal).
 */
const normalPayForTax = ({ proration, monthlyGross, employee }) => {
  if (!proration || !(Number(proration.factor) < 1)) return {};
  return {
    normalGrossSalary: Math.max(0, Number(monthlyGross) || 0),
    normalAllowances: employee?.allowances || {}
  };
};

/**
 * Tax for an already-generated payroll (edit / recalculation / dry run), with the same rules as generation:
 * a one-month salary cut reduces pay, not tax (worked out on the pay before the cut); a prorated month
 * (partial-pay days, joining) counts at its actual pay with the normal pay for the rest of the FY; and
 * arrears paid earlier this FY stay in the annual figure.
 * @param {object} args.payroll        - Payroll doc / lean object
 * @param {object} args.employee       - Employee (hireDate, appointmentDate, allowances)
 * @param {object} [args.taxYearContext] - { priorFyArrears, priorPaidMonths } preloaded (bulk); loaded when omitted
 */
const calculateTaxForExistingPayroll = async ({ payroll, employee, settings, taxYearContext = null }) => {
  const cutFactor = Number(payroll.salaryPercentageCut?.factor) || 1;
  const uncut = (v) => (cutFactor > 0 && cutFactor < 1 ? Math.round((Number(v) || 0) / cutFactor) : (Number(v) || 0));
  const rawAllowances = payroll.allowances?.toObject?.() || payroll.allowances || {};
  const allowances = cutFactor < 1
    ? Object.fromEntries(Object.entries(rawAllowances).map(([k, slot]) => [
      k, slot && typeof slot === 'object' && slot.amount != null ? { ...slot, amount: uncut(slot.amount) } : slot
    ]))
    : rawAllowances;
  const grossSalary = uncut(
    payroll.grossSalary ||
    (payroll.basicSalary || 0) + (payroll.houseRentAllowance || 0) + (payroll.medicalAllowance || 0)
  );

  let context = taxYearContext;
  if (!context) {
    const empId = payroll.employee?._id || payroll.employee;
    const map = await loadTaxYearContextByEmployee({
      payrollMonth: payroll.month,
      payrollYear: payroll.year,
      employeeIds: [empId]
    });
    context = taxYearContextFor(map, empId);
  }

  // Prorated month: the stored gross is (normal × factor), so the normal gross is gross ÷ factor
  const factor = Number(payroll.proration?.factor);
  const normalPay = factor > 0 && factor < 1
    ? normalPayForTax({ proration: payroll.proration, monthlyGross: Math.round(grossSalary / factor), employee })
    : {};

  return calculatePayrollTaxWithSettings({
    grossSalary,
    allowances,
    arrears: uncut(payroll.arrears),
    employeeId: employee?._id || payroll.employee,
    settings,
    hireDate: employee?.hireDate || employee?.appointmentDate,
    payrollMonth: payroll.month,
    payrollYear: payroll.year,
    ...context,
    ...normalPay
  });
};

/** taxCalculation sub-document as stored on a payroll */
const toStoredTaxCalculation = (taxCalculation) => ({
  mainTax: Math.round(taxCalculation.mainTax),
  arrearsTax: Math.round(taxCalculation.arrearsTax),
  totalTax: Math.round(taxCalculation.totalTax),
  mainTaxableIncome: Math.round(taxCalculation.mainTaxableIncome),
  arrearsTaxableIncome: Math.round(taxCalculation.arrearsTaxableIncome),
  annualTaxableIncome: Math.round(taxCalculation.annualTaxableIncome || 0),
  annualTax: Math.round(taxCalculation.annualTax || 0),
  fyMonths: taxCalculation.fyMonths || 12,
  priorFyArrears: taxCalculation.priorFyArrears || 0,
  normalMonthlyTaxable: taxCalculation.normalMonthlyTaxable || 0,
  finalMonthTrueUp: Boolean(taxCalculation.finalMonthTrueUp),
  taxRefundDue: taxCalculation.taxRefundDue || 0,
  usesAllowanceTaxPolicy: taxCalculation.usesAllowanceTaxPolicy
});

const loadPayrollTaxSettings = async () => {
  const doc = await PayrollTaxSettings.getOrCreate();
  return normalizeSettings(doc.toObject());
};

module.exports = {
  ALLOWANCE_TAX_KEYS,
  defaultAllowancePolicies,
  defaultSettings,
  normalizeSettings,
  employeeUsesAllowanceTaxPolicy,
  calculatePayrollTaxWithSettings,
  calculateTaxLegacy,
  loadPayrollTaxSettings,
  loadTaxYearContextByEmployee,
  taxYearContextFor,
  normalPayForTax,
  calculateTaxForExistingPayroll,
  toStoredTaxCalculation
};
