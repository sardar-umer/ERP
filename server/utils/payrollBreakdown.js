const {
  activeAmount,
  vehicleAllowanceAmount,
  fuelAllowanceAmount
} = require('./allowanceHelpers');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** Whole rupees — used for payroll net / bank letter / BPV bank line so all three match. */
const roundRupee = (n) => Math.round(Number(n) || 0);

/** EOBI employer share — equal to employee deduction (50/50 total contribution). */
const resolveEobiEmployerContribution = (employeeDeduction) =>
  Math.round((Number(employeeDeduction) || 0) / 0.2);

/** Credit-side slots for payroll BPV — loans, statutory deductions, and bank. */
const PAYROLL_PAYMENT_CREDIT_SLOTS = [
  {
    key: 'incomeTax',
    label: 'Income Tax (WHT)',
    voucherNarration: 'Income Tax Withheld',
    accountNumber: '2004'
  },
  {
    key: 'companyLoan',
    label: 'Employee Loan Recovery',
    voucherNarration: 'Employee Loan — Recovery',
    accountNumber: '1125'
  },
  {
    key: 'advanceDeduction',
    label: 'Advance Salary Recovery',
    voucherNarration: 'Advance Salary — Recovery',
    accountNumber: '1120'
  },
  {
    key: 'empSecurityDed',
    label: 'Provident Fund (Employee)',
    voucherNarration: 'Provident Fund — Employee Contribution',
    accountNumber: '2210'
  },
  {
    key: 'eobiEmployee',
    label: 'EOBI Payable — Employee Contribution',
    voucherNarration: 'EOBI Payable — Employee Share',
    accountNumber: '2211-01'
  },
  {
    key: 'eobiEmployer',
    label: 'EOBI Payable — Employer Contribution',
    voucherNarration: 'EOBI Payable — Employer Share',
    accountNumber: '2211-02'
  },
  {
    key: 'healthInsurance',
    label: 'Health Insurance',
    voucherNarration: 'Health Insurance Deduction',
    accountNumber: '2212'
  },
  {
    key: 'attendanceDeduction',
    label: 'Attendance Deduction',
    voucherNarration: 'Attendance / Absenteeism Deduction',
    accountNumber: '2212'
  },
  {
    key: 'leaveDeduction',
    label: 'Leave Deduction',
    voucherNarration: 'Unpaid / Leave Deduction',
    accountNumber: '2212'
  },
  {
    key: 'otherDeductions',
    label: 'Other Payroll Deductions',
    voucherNarration: 'Other Payroll Deductions',
    accountNumber: '2212'
  }
];

const PAYROLL_BPV_DEBIT_SLOTS = [
  {
    key: 'grossSalary',
    label: 'Salaries Payable',
    voucherNarration: 'Salaries Payable — Gross',
    accountNumber: '2200'
  },
  {
    key: 'eobiEmployerExpense',
    label: 'EOBI Expense',
    voucherNarration: 'EOBI Expense',
    accountNumber: '5015'
  }
];

/** Debits on payroll accrual JV (at approval) — expense, not payment. */
const PAYROLL_ACCRUAL_DEBIT_SLOTS = [
  {
    key: 'grossSalary',
    label: 'Salaries Expense',
    voucherNarration: 'Salaries Expense — Gross',
    accountNumber: '5002'
  },
  {
    key: 'eobiEmployerExpense',
    label: 'EOBI Expense',
    voucherNarration: 'EOBI Expense',
    accountNumber: '5015'
  }
];

const PAYROLL_BREAKDOWN_TOTAL_KEYS = [
  'standardGrossSalary',
  'basic',
  'arrears',
  'conveyanceAllowance',
  'houseAllowance',
  'foodAllowance',
  'mobileAllowance',
  'vehicleAllowance',
  'medicalAllowance',
  'fuelAllowance',
  'grossSalary',
  'incomeTax',
  'companyLoan',
  'advanceDeduction',
  'eobiEmployee',
  'eobiEmployer',
  'eobiEmployerExpense',
  'empSecurityDed',
  'healthInsurance',
  'attendanceDeduction',
  'leaveDeduction',
  'otherDeductions',
  'netPayable',
  'netPayableBank',
  'netPayableCash'
];

const emptyPayrollBreakdownTotals = () =>
  PAYROLL_BREAKDOWN_TOTAL_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});

const resolveAdvanceDeduction = (payroll = {}) =>
  Math.round(
    Number(payroll.advanceSalary)
    || Number(payroll.advanceDeduction)
    || Number(payroll.leaveDeductions?.advanceDeduction)
    || 0
  );

const resolveLeaveDeduction = (payroll = {}) =>
  Math.round(
    Number(payroll.leaveDeductionAmount)
    || Number(payroll.leaveDeduction)
    || Number(payroll.leaveDeductions?.leaveDeductionAmount)
    || Number(payroll.leaveDeductions?.unpaidDeduction)
    || 0
  );

const extractPayrollBreakdown = (payroll = {}) => {
  const allowances = payroll.allowances || {};
  const houseFlexible = activeAmount(allowances.houseRent);
  const houseCore = Number(payroll.houseRentAllowance) || 0;
  const medicalFlexible = activeAmount(allowances.medical);
  const medicalCore = Number(payroll.medicalAllowance) || 0;
  const grossSalary = Math.round(Number(payroll.totalEarnings) || Number(payroll.grossSalary) || 0);
  const incomeTax = Math.round(Number(payroll.incomeTax) || 0);
  const companyLoan = Math.round(Number(payroll.companyLoanDeduction) || Number(payroll.loanDeductions) || 0);
  const advanceDeduction = resolveAdvanceDeduction(payroll);
  const eobiEmployee = Math.round(Number(payroll.eobi) || 0);
  const eobiEmployer = resolveEobiEmployerContribution(eobiEmployee);
  const eobiEmployerExpense = eobiEmployer;
  const empSecurityDed = Math.round(Number(payroll.providentFund) || 0);
  const healthInsurance = Math.round(Number(payroll.healthInsurance) || 0);
  const attendanceDeduction = Math.round(Number(payroll.attendanceDeduction) || 0);
  const leaveDeduction = resolveLeaveDeduction(payroll);
  const netPayable = roundRupee(payroll.netSalary);
  const knownCredits =
    incomeTax +
    companyLoan +
    advanceDeduction +
    eobiEmployee +
    empSecurityDed +
    healthInsurance +
    attendanceDeduction +
    leaveDeduction +
    netPayable;
  const otherDeductions = Math.max(0, Math.round(grossSalary - knownCredits));

  return {
    standardGrossSalary: Math.round(Number(payroll.grossSalary) || 0),
    basic: Math.round(Number(payroll.basicSalary) || 0),
    arrears: Math.round(Number(payroll.arrears) || 0),
    conveyanceAllowance: Math.round(activeAmount(allowances.conveyance)),
    houseAllowance: Math.round(houseCore + houseFlexible),
    foodAllowance: Math.round(activeAmount(allowances.food)),
    mobileAllowance: Math.round(activeAmount(allowances.mobile)),
    vehicleAllowance: Math.round(vehicleAllowanceAmount(allowances)),
    medicalAllowance: Math.round(medicalCore + medicalFlexible),
    fuelAllowance: Math.round(fuelAllowanceAmount(allowances)),
    grossSalary,
    incomeTax,
    companyLoan,
    advanceDeduction,
    eobiEmployee,
    eobiEmployer,
    eobiEmployerExpense,
    /** @deprecated use eobiEmployee */
    eobiDeduction: eobiEmployee,
    empSecurityDed,
    healthInsurance,
    attendanceDeduction,
    leaveDeduction,
    otherDeductions,
    netPayable,
    netPayableBank: Boolean(payroll.isCashSalary) ? 0 : netPayable,
    netPayableCash: Boolean(payroll.isCashSalary) ? netPayable : 0
  };
};

const aggregatePayrollBreakdown = (payrolls = []) => {
  const totals = emptyPayrollBreakdownTotals();
  const keysWithoutOther = PAYROLL_BREAKDOWN_TOTAL_KEYS.filter((key) => key !== 'otherDeductions');

  payrolls.forEach((row) => {
    const breakdown = extractPayrollBreakdown(row);
    keysWithoutOther.forEach((key) => {
      totals[key] += breakdown[key] || 0;
    });
  });

  keysWithoutOther.forEach((key) => {
    totals[key] = roundRupee(totals[key] || 0);
  });

  totals.eobiEmployerExpense = totals.eobiEmployer;

  totals.otherDeductions = Math.max(
    0,
    roundRupee(
      totals.grossSalary -
        totals.incomeTax -
        totals.companyLoan -
        totals.advanceDeduction -
        totals.eobiEmployee -
        totals.empSecurityDed -
        totals.healthInsurance -
        totals.attendanceDeduction -
        totals.leaveDeduction -
        totals.netPayable
    )
  );

  return totals;
};

/** Sum of whole-rupee nets — must match bank letter + BPV bank/cash credits. */
const sumPayrollNetWholeRupees = (payrolls = []) =>
  payrolls.reduce((sum, row) => sum + roundRupee(row?.netSalary), 0);

const validatePayrollAccrualTotals = (totals) => {
  const debit = (totals.grossSalary || 0) + (totals.eobiEmployerExpense || 0);
  const credit =
    (totals.incomeTax || 0) +
    (totals.companyLoan || 0) +
    (totals.advanceDeduction || 0) +
    (totals.empSecurityDed || 0) +
    (totals.eobiEmployee || 0) +
    (totals.eobiEmployer || 0) +
    (totals.healthInsurance || 0) +
    (totals.attendanceDeduction || 0) +
    (totals.leaveDeduction || 0) +
    (totals.otherDeductions || 0) +
    (totals.netPayable || 0);

  if (Math.abs(debit - credit) > 1) {
    const err = new Error(
      `Payroll accrual is not balanced (debits ${debit.toLocaleString('en-PK')} vs credits ${credit.toLocaleString('en-PK')}). Review payroll deductions.`
    );
    err.statusCode = 400;
    throw err;
  }
  return { debit, credit };
};

const buildPayrollVoucherLineDescription = (slot, periodLabel, companyName) => {
  const base = slot?.voucherNarration || slot?.label || 'Payroll';
  return `${base} — ${periodLabel} — ${companyName}`;
};

/** Credit amount for payroll accrual credit line. */
const resolvePayrollCreditSlotAmount = (totals, slot) => round2(totals[slot.key]);

const buildPayrollBpvPreviewLines = (totals, { periodLabel = '', companyName = '' } = {}) => {
  validatePayrollAccrualTotals(totals);
  const lines = [];

  for (const slot of PAYROLL_ACCRUAL_DEBIT_SLOTS) {
    const amount = round2(totals[slot.key]);
    if (amount <= 0) continue;
    lines.push({
      side: 'Debit',
      label: slot.label,
      amount
    });
  }

  for (const slot of PAYROLL_PAYMENT_CREDIT_SLOTS) {
    const amount = resolvePayrollCreditSlotAmount(totals, slot);
    if (amount <= 0) continue;
    lines.push({
      side: 'Credit',
      label: slot.label,
      amount
    });
  }

  const netAmountBank = round2(totals.netPayableBank ?? totals.netPayable);
  if (netAmountBank > 0) {
    lines.push({
      side: 'Credit',
      label: 'Bank Payment (Net Salary)',
      amount: netAmountBank
    });
  }

  const netAmountCash = round2(totals.netPayableCash || 0);
  if (netAmountCash > 0) {
    lines.push({
      side: 'Credit',
      label: 'Cash Payment (Net Salary)',
      amount: netAmountCash
    });
  }

  const totalDebit = lines
    .filter((row) => row.side === 'Debit')
    .reduce((sum, row) => sum + row.amount, 0);
  const totalCredit = lines
    .filter((row) => row.side === 'Credit')
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    lines,
    totals,
    totalDebit,
    totalCredit,
    periodLabel,
    companyName,
    balanced: Math.abs(totalDebit - totalCredit) <= 1
  };
};

module.exports = {
  PAYROLL_PAYMENT_CREDIT_SLOTS,
  PAYROLL_BPV_DEBIT_SLOTS,
  PAYROLL_ACCRUAL_DEBIT_SLOTS,
  PAYROLL_BREAKDOWN_TOTAL_KEYS,
  resolveEobiEmployerContribution,
  roundRupee,
  sumPayrollNetWholeRupees,
  extractPayrollBreakdown,
  aggregatePayrollBreakdown,
  validatePayrollAccrualTotals,
  buildPayrollVoucherLineDescription,
  resolvePayrollCreditSlotAmount,
  buildPayrollBpvPreviewLines
};
