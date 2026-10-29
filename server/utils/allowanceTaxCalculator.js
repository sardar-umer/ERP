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
  priorMonths = null,
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
    annualTax
  } = priorPaidMonths != null && payrollMonth
    // Tax-year context known: the year is the months actually paid + months to come (Sidat method)
    ? calculateMonthlyTaxPaidMonths(salaryBase, normalSalaryBase, arrearsAmt + priorFyArrears, priorPaidMonths, payrollMonth, priorMonths)
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
  { priorFyArrears = 0, priorPaidMonths = null, priorMonths = null, normalMainSalary = null } = {}
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
    priorMonths,
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
 *   priorMonths                 — those months in order; the year rolls month by month with partial-pay
 *                                  months at their actual pay (see calculateMonthlyTaxPaidMonths)
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
  priorMonths = null,
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
      priorMonths,
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
    priorMonths,
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
 * Pay of a payroll before a one-month salary cut (a cut reduces pay, not tax): gross, allowances, arrears
 */
const payBeforeSalaryCut = (payroll) => {
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
  return { grossSalary, allowances, arrears: uncut(payroll.arrears), uncut };
};

/**
 * An earlier month as the tax year counts it: taxable on the salary actually paid, and whether it was a
 * partial-pay month (prorated, or salary paid below gross — e.g. unpaid days in imported months)
 */
const paidMonthForTax = (payroll, settings) => {
  const { grossSalary, allowances, arrears, uncut } = payBeforeSalaryCut(payroll);
  const earnedSalary = uncut(
    (Number(payroll.totalEarnings) || 0) - additionalAllowancesTotal(payroll.allowances) - (Number(payroll.arrears) || 0)
  );
  const salaryPaid = earnedSalary > 0 && earnedSalary < grossSalary ? earnedSalary : grossSalary;
  const partial = Number(payroll.proration?.factor) < 1 || salaryPaid < grossSalary - 1;
  const { mainTaxableIncome } = calculatePayrollTaxWithSettings({
    grossSalary: salaryPaid,
    allowances,
    employeeId: payroll.employee,
    settings
  });
  return { month: payroll.month, taxable: Math.round(mainTaxableIncome), partial, arrears };
};

/**
 * Tax-year context per employee from their payrolls earlier in this FY (not Cancelled):
 *   priorFyArrears  — arrears paid, kept in the annual taxable figure until June
 *   priorPaidMonths — months already paid, so a month with no pay (e.g. a joining month paid later as
 *                     arrears) is not projected
 *   priorMonths     — those months in order (taxable as paid, partial-pay flag, arrears), so the year
 *                     rolls month by month and a partial month counts at its actual pay
 * @returns {Promise<Map<string, { priorFyArrears: number, priorPaidMonths: number, priorMonths: Array }>>}
 *          employeeId → context (employees with no earlier payroll are absent → use taxYearContextFor)
 */
const loadTaxYearContextByEmployee = async ({ payrollMonth, payrollYear, employeeIds = null }) => {
  const monthsFilter = priorFyMonthsFilter(payrollMonth, payrollYear);
  if (!monthsFilter) return new Map();
  const Payroll = require('../models/hr/Payroll');
  const match = { ...monthsFilter, status: { $ne: 'Cancelled' } };
  if (employeeIds) match.employee = { $in: employeeIds };
  const payrolls = await Payroll.find(match)
    .select('employee month year grossSalary basicSalary houseRentAllowance medicalAllowance totalEarnings allowances arrears salaryPercentageCut proration updatedAt')
    .sort({ updatedAt: 1 })
    .lean();
  const settings = await loadPayrollTaxSettings();

  // one payroll per month counts once, even if a month was regenerated (latest kept)
  const byMonth = new Map();
  payrolls.forEach((p) => byMonth.set(`${p.employee}|${p.year}|${p.month}`, p));
  const byEmployee = new Map();
  byMonth.forEach((p) => {
    const id = String(p.employee);
    if (!byEmployee.has(id)) byEmployee.set(id, []);
    byEmployee.get(id).push(p);
  });

  const map = new Map();
  byEmployee.forEach((rows, id) => {
    rows.sort((a, b) => (a.year - b.year) || (a.month - b.month));
    const priorMonths = rows.map((p) => paidMonthForTax(p, settings));
    map.set(id, {
      priorFyArrears: Math.round(priorMonths.reduce((sum, m) => sum + m.arrears, 0)),
      priorPaidMonths: priorMonths.length,
      priorMonths
    });
  });
  return map;
};

/** Context for one employee from a loaded map; no earlier payroll this FY = nothing paid yet */
const taxYearContextFor = (contextByEmployee, employeeId) =>
  contextByEmployee.get(String(employeeId)) || { priorFyArrears: 0, priorPaidMonths: 0, priorMonths: [] };

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
 * @param {object} [args.taxYearContext] - { priorFyArrears, priorPaidMonths, priorMonths } preloaded (bulk); loaded when omitted
 */
const calculateTaxForExistingPayroll = async ({ payroll, employee, settings, taxYearContext = null }) => {
  const { grossSalary, allowances, arrears } = payBeforeSalaryCut(payroll);

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
    arrears,
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
