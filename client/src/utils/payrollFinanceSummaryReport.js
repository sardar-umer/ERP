const esc = (value) => String(value ?? '—')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const fmtMoney = (amount) =>
  Math.round(Number(amount) || 0).toLocaleString('en-PK');

export const getNetPayableColumnLabel = (periodLabel = '') => {
  const compact = String(periodLabel || '').replace(/\s+/g, '');
  return compact ? `Net Payable ${compact}` : 'Net Payable';
};

export const PROJECT_SUMMARY_AMOUNT_COLUMNS = [
  { key: 'standardGrossSalary', label: 'Standard Gross Salary' },
  { key: 'basic', label: 'Basic' },
  { key: 'arrears', label: 'Arears' },
  { key: 'conveyanceAllowance', label: 'Covance Allowance' },
  { key: 'houseAllowance', label: 'House Allowance' },
  { key: 'foodAllowance', label: 'Food Allowance' },
  { key: 'mobileAllowance', label: 'Mobile Allowance' },
  { key: 'vehicleAllowance', label: 'Vehicle Allowance' },
  { key: 'medicalAllowance', label: 'Medical Allowance' },
  { key: 'fuelAllowance', label: 'Fuel Allowance' },
  { key: 'grossSalary', label: 'Gross Salary' },
  { key: 'incomeTax', label: 'Income Tax' },
  { key: 'companyLoan', label: 'Employee Loan' },
  { key: 'advanceDeduction', label: 'Staff Advance' },
  { key: 'eobiEmployee', label: 'EOBI (Employee)' },
  { key: 'eobiEmployer', label: 'EOBI (Employer)' },
  { key: 'empSecurityDed', label: 'Provident Fund' },
  { key: 'healthInsurance', label: 'Health Insurance' },
  { key: 'attendanceDeduction', label: 'Attendance Ded.' },
  { key: 'leaveDeduction', label: 'Leave Ded.' },
  { key: 'otherDeductions', label: 'Other Deductions' }
];

/** Earnings / allowance lines shown above gross on payroll BPV summary. */
export const PAYROLL_ALLOWANCE_SUMMARY_ROWS = [
  { key: 'basic', label: 'Basic Salary' },
  { key: 'arrears', label: 'Arrears' },
  { key: 'conveyanceAllowance', label: 'Conveyance Allowance' },
  { key: 'houseAllowance', label: 'House Allowance' },
  { key: 'foodAllowance', label: 'Food Allowance' },
  { key: 'mobileAllowance', label: 'Mobile Allowance' },
  { key: 'vehicleAllowance', label: 'Vehicle Allowance' },
  { key: 'medicalAllowance', label: 'Medical Allowance' },
  { key: 'fuelAllowance', label: 'Fuel Allowance' }
];

/** Itemized deductions for payroll BPV summary (gross → deductions → net). */
export const PAYROLL_DEDUCTION_SUMMARY_ROWS = [
  { key: 'incomeTax', label: 'Income Tax (WHT)' },
  { key: 'companyLoan', label: 'Employee Loan Recovery' },
  { key: 'advanceDeduction', label: 'Advance Salary Recovery' },
  { key: 'empSecurityDed', label: 'Provident Fund (Employee)' },
  { key: 'eobiEmployee', label: 'EOBI Payable — Employee Contribution' },
  { key: 'eobiEmployer', label: 'EOBI Payable — Employer Contribution' },
  { key: 'healthInsurance', label: 'Health Insurance' },
  { key: 'attendanceDeduction', label: 'Attendance Deduction' },
  { key: 'leaveDeduction', label: 'Leave Deduction' },
  { key: 'otherDeductions', label: 'Other Payroll Deductions' }
];

export const buildPayrollDeductionSummary = (breakdown = {}) => {
  const allowances = PAYROLL_ALLOWANCE_SUMMARY_ROWS
    .map((row) => ({
      ...row,
      amount: roundAmount(breakdown[row.key] || 0)
    }))
    .filter((row) => row.amount > 0);
  const grossSalary = roundAmount(breakdown.grossSalary || 0);
  const deductions = PAYROLL_DEDUCTION_SUMMARY_ROWS
    .map((row) => ({
      ...row,
      amount: roundAmount(breakdown[row.key] || 0)
    }))
    .filter((row) => row.amount > 0);
  const totalDeductions = roundAmount(deductions.reduce((sum, row) => sum + row.amount, 0));
  const netPayable = roundAmount(breakdown.netPayable || 0);
  const eobiEmployerExpense = roundAmount(breakdown.eobiEmployerExpense || breakdown.eobiEmployer || 0);

  return {
    allowances,
    hasAllowances: allowances.length > 0,
    grossSalary,
    deductions,
    totalDeductions,
    netPayable,
    eobiEmployerExpense,
    hasDeductions: deductions.length > 0
  };
};

const roundAmount = (value) => Math.round(Number(value) || 0);

export const aggregatePayrollBreakdownFromRows = (payrollRows = []) => {
  const totals = PROJECT_SUMMARY_AMOUNT_COLUMNS.reduce((acc, col) => {
    acc[col.key] = 0;
    return acc;
  }, { netPayable: 0, eobiEmployerExpense: 0 });

  payrollRows.forEach((row) => {
    PROJECT_SUMMARY_AMOUNT_COLUMNS.forEach((col) => {
      let val = 0;
      if (col.key === 'eobiEmployee') {
        val = row.eobiEmployee ?? row.eobiDeduction ?? row.eobi ?? 0;
      } else if (col.key === 'advanceDeduction') {
        val = row.advanceSalary ?? row.advanceDeduction ?? row.leaveDeductions?.advanceDeduction ?? 0;
      } else {
        val = row[col.key] ?? 0;
      }
      totals[col.key] += roundAmount(val);
    });
    totals.netPayable += roundAmount(row.netPayable ?? row.netSalary);
  });

  PROJECT_SUMMARY_AMOUNT_COLUMNS.forEach((col) => {
    totals[col.key] = roundAmount(totals[col.key]);
  });
  totals.netPayable = roundAmount(totals.netPayable);
  totals.eobiEmployer = roundAmount(totals.eobiEmployer || (totals.eobiEmployee / 0.2) || 0);
  totals.eobiEmployerExpense = totals.eobiEmployer;
  return totals;
};

export const buildPayrollBpvPreviewLines = (payrollRows = [], { periodLabel = '', companyName = '' } = {}) => {
  const totals = aggregatePayrollBreakdownFromRows(payrollRows);
  const lines = [];

  [
    { key: 'grossSalary', label: 'Salaries Expense' },
    { key: 'eobiEmployerExpense', label: 'EOBI Expense' }
  ].forEach((slot) => {
    const amount = roundAmount(totals[slot.key]);
    if (amount > 0) lines.push({ side: 'Debit', label: slot.label, amount });
  });

  PAYROLL_DEDUCTION_SUMMARY_ROWS.forEach((slot) => {
    const amount = roundAmount(totals[slot.key]);
    if (amount > 0) lines.push({ side: 'Credit', label: slot.label, amount });
  });

  const netAmount = roundAmount(totals.netPayable);
  if (netAmount > 0) {
    lines.push({ side: 'Credit', label: 'Bank Payment (Net Salary)', amount: netAmount });
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

const emptyAmountTotals = () =>
  PROJECT_SUMMARY_AMOUNT_COLUMNS.reduce((acc, col) => {
    acc[col.key] = 0;
    return acc;
  }, {});

const createCompanySummaryRow = (company) => ({
  company,
  employeeCount: 0,
  ...emptyAmountTotals(),
  netPayable: 0
});

const addPayrollToCompanySummary = (entry, payroll) => {
  entry.employeeCount += 1;
  PROJECT_SUMMARY_AMOUNT_COLUMNS.forEach((col) => {
    entry[col.key] += roundAmount(payroll[col.key]);
  });
  entry.netPayable += roundAmount(payroll.netPayable ?? payroll.netSalary);
};

const roundCompanySummaryRow = (row) => {
  const rounded = { ...row };
  PROJECT_SUMMARY_AMOUNT_COLUMNS.forEach((col) => {
    rounded[col.key] = Math.round(rounded[col.key] || 0);
  });
  rounded.netPayable = Math.round(rounded.netPayable || 0);
  return rounded;
};

export const buildPayrollCompanySummary = (payrollRows = []) => {
  const byCompany = new Map();

  payrollRows.forEach((row) => {
    const company = (row.employee?.company || '').trim() || 'Unassigned';
    if (!byCompany.has(company)) {
      byCompany.set(company, createCompanySummaryRow(company));
    }
    addPayrollToCompanySummary(byCompany.get(company), row);
  });

  const rows = [...byCompany.values()]
    .map(roundCompanySummaryRow)
    .sort((a, b) => a.company.localeCompare(b.company));

  const totals = createCompanySummaryRow('Grand Total (All Companies)');
  totals.company = 'Grand Total (All Companies)';
  payrollRows.forEach((row) => addPayrollToCompanySummary(totals, row));
  const roundedTotals = roundCompanySummaryRow(totals);

  return { rows, totals: roundedTotals };
};

/** @deprecated Use buildPayrollCompanySummary */
export const buildPayrollProjectSummary = buildPayrollCompanySummary;

const buildSummaryHtml = ({ periodLabel, company = {}, summary }) => {
  const netPayableLabel = getNetPayableColumnLabel(periodLabel);
  const headerCells = `
    <th>Sr No</th>
    <th>Company Name</th>
    <th class="num">No of Employees</th>
    ${PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => `<th class="num">${esc(col.label)}</th>`).join('')}
    <th class="num">${esc(netPayableLabel)}</th>
  `;

  const rowsHtml = summary.rows.map((row, index) => {
    const amountCells = PROJECT_SUMMARY_AMOUNT_COLUMNS
      .map((col) => `<td class="num">${fmtMoney(row[col.key])}</td>`)
      .join('');
    return `
      <tr>
        <td class="num">${index + 1}</td>
        <td>${esc(row.company)}</td>
        <td class="num">${row.employeeCount}</td>
        ${amountCells}
        <td class="num">${fmtMoney(row.netPayable)}</td>
      </tr>
    `;
  }).join('');

  const totalAmountCells = PROJECT_SUMMARY_AMOUNT_COLUMNS
    .map((col) => `<td class="num"><strong>${fmtMoney(summary.totals[col.key])}</strong></td>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payroll Summary — ${esc(periodLabel)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111;
      margin: 0;
      padding: 20px 24px;
      background: #fff;
    }
    .org-title {
      text-align: center;
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 6px;
      text-transform: uppercase;
    }
    .report-subtitle {
      text-align: center;
      font-size: 13px;
      margin: 0 0 18px;
      font-weight: 600;
    }
    table { width: 100%; border-collapse: collapse; font-size: 9px; }
    th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; vertical-align: middle; }
    th { background: #d9d9d9; font-weight: 700; text-align: center; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tfoot td {
      font-weight: 800;
      background: #e5e7eb;
      font-size: 10px;
      color: #111;
    }
    tfoot strong { font-weight: 800; }
  </style>
</head>
<body>
  <div class="org-title">${esc(company.name || 'SARDAR GROUP OF COMPANIES')}</div>
  <div class="report-subtitle">Company-Wise Summary of Salary for the month of ${esc(periodLabel)}</div>

  <table>
    <thead>
      <tr>${headerCells}</tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" align="right"><strong>Grand Total (All Companies)</strong></td>
        <td class="num"><strong>${summary.totals.employeeCount}</strong></td>
        ${totalAmountCells}
        <td class="num"><strong>${fmtMoney(summary.totals.netPayable)}</strong></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
};

const printHtmlInHiddenFrame = (html, frameId = 'payroll-summary-print-frame') => {
  const existing = document.getElementById(frameId);
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = frameId;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.title = 'Payroll summary print';
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument || win?.document;
  if (!doc || !win) {
    iframe.remove();
    return { ok: false, message: 'Unable to prepare print preview.' };
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 500);
  };

  const triggerPrint = () => {
    try {
      win.focus();
      win.print();
      win.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 60000);
    } catch {
      iframe.remove();
      return { ok: false, message: 'Unable to open print dialog.' };
    }
    return { ok: true };
  };

  if (iframe.contentDocument?.readyState === 'complete') {
    setTimeout(triggerPrint, 100);
  } else {
    iframe.onload = () => setTimeout(triggerPrint, 100);
  }

  return { ok: true };
};

export const openPayrollCompanySummaryPrint = ({ periodLabel, company = {}, summary }) => {
  if (!summary?.rows?.length) {
    return { ok: false, message: 'No payroll summary data available.' };
  }
  const html = buildSummaryHtml({ periodLabel, company, summary });
  return printHtmlInHiddenFrame(html);
};

/** @deprecated Use openPayrollCompanySummaryPrint */
export const openPayrollProjectSummaryPrint = openPayrollCompanySummaryPrint;

const EXCEL_THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' }
};

const EXCEL_HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9D9D9' }
};

const styleTitleRow = (worksheet, rowIndex, colCount, text) => {
  worksheet.mergeCells(rowIndex, 1, rowIndex, colCount);
  const cell = worksheet.getCell(rowIndex, 1);
  cell.value = text;
  cell.font = { bold: true, size: 13 };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  worksheet.getRow(rowIndex).height = 24;
};

const styleDataRow = (row, colCount, { bold = false, fill = null } = {}) => {
  for (let col = 1; col <= colCount; col += 1) {
    const cell = row.getCell(col);
    cell.font = { bold };
    if (fill) cell.fill = fill;
    cell.border = EXCEL_THIN_BORDER;

    if (col === 1) {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    } else if (col === 2) {
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    } else {
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      if (col >= 3) cell.numFmt = '#,##0';
    }
  }
};

export const downloadPayrollCompanySummaryExcel = async ({ periodLabel, summary }) => {
  if (!summary?.rows?.length) {
    return { ok: false, message: 'No payroll summary data available.' };
  }

  const { Workbook } = await import('exceljs');
  const netPayableLabel = getNetPayableColumnLabel(periodLabel);
  const headers = [
    'Sr No',
    'Company Name',
    'No of Employees',
    ...PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => col.label),
    netPayableLabel
  ];
  const colCount = headers.length;

  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet('Company Wise Summary', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  worksheet.columns = [
    { width: 8 },
    { width: 28 },
    { width: 16 },
    ...PROJECT_SUMMARY_AMOUNT_COLUMNS.map(() => ({ width: 18 })),
    { width: 20 }
  ];

  styleTitleRow(worksheet, 1, colCount, 'SARDAR GROUP OF COMPANIES');
  styleTitleRow(
    worksheet,
    2,
    colCount,
    `Company-Wise Summary of Salary for the month of ${periodLabel}`
  );
  worksheet.addRow(Array(colCount).fill(''));

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = EXCEL_HEADER_FILL;
    cell.border = EXCEL_THIN_BORDER;
  });

  summary.rows.forEach((row, index) => {
    const dataRow = worksheet.addRow([
      index + 1,
      row.company,
      row.employeeCount,
      ...PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => row[col.key] ?? 0),
      row.netPayable ?? 0
    ]);
    dataRow.height = 20;
    styleDataRow(dataRow, colCount);
  });

  const footerRow = worksheet.addRow([
    '',
    'Grand Total (All Companies)',
    summary.totals.employeeCount,
    ...PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => summary.totals[col.key] ?? 0),
    summary.totals.netPayable ?? 0
  ]);
  footerRow.height = 22;
  styleDataRow(footerRow, colCount, {
    bold: true,
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }
  });

  const safePeriod = String(periodLabel || 'payroll').replace(/\s+/g, '-').toLowerCase();
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob(
    [buffer],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payroll-company-summary-${safePeriod}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { ok: true };
};

/** @deprecated Use downloadPayrollCompanySummaryExcel */
export const downloadPayrollProjectSummaryExcel = downloadPayrollCompanySummaryExcel;
