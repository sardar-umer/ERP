import jsPDF from 'jspdf';
import { getCalendarDaysInMonth, resolveSettlementRateDate } from './finalSettlementDays';

/**
 * Final Dues (final settlement) — single A4 page in the same layout as Sidat's "FINAL DUES":
 * employee block, Allowances (Standard / Actual) | Deductions (Actual) | Non-Salary (Actual), Net Payable,
 * Prepared / Verified / Approved, and the employee's receipt statement.
 */

const amt = (n) => Math.round(Number(n) || 0).toLocaleString('en-PK');

const fmtDate = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
};

const monthYear = (date) => {
  const d = new Date(date || Date.now());
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

/** Salary components prorated for the last month: [label, earningsKey, standardKey] */
const PRORATED = [
  ['Gross Salary', 'basicSalary'],
  ['House Rent', 'houseRent'],
  ['Medical Allowance', 'medicalAllowance'],
  ['Conveyance Allowance', 'conveyanceAllowance'],
  ['Food Allowance', 'foodAllowance'],
  ['Mobile Allowance', 'mobileAllowance'],
  ['Vehicle Allowance', 'vehicleAllowance'],
  ['Fuel Allowance', 'fuelAllowance'],
  ['Special Allowance', 'specialAllowance'],
  ['Other Allowances', 'otherAllowances']
];
/** One-off earnings (Standard = Actual) */
const ONE_OFF = [
  ['Notice Pay', 'noticePay'],
  ['Leave Encashment', 'leaveEncashment'],
  ['Gratuity', 'gratuity'],
  ['Bonus', 'bonus'],
  ['Overtime', 'overtime']
];
const DEDUCTIONS = [
  ['Income Tax', 'incomeTax'],
  ['EOBI', 'eobi'],
  ['Provident Fund', 'providentFund'],
  ['Loan Recovery', 'loanDeductions'],
  ['Advance Recovery', 'advanceDeductions'],
  ['Notice Period Deduction', 'noticePeriodDeduction'],
  ['Security', 'security'],
  ['Health Insurance', 'healthInsurance'],
  ['Pension', 'pension'],
  ['Other Deduction', 'otherDeductions']
];

const personName = (u) => (u && typeof u === 'object' ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '');

const addressText = (address) => {
  if (!address) return '';
  if (typeof address === 'string') return address;
  return [address.street, address.area, typeof address.city === 'object' ? address.city?.name : ''].filter(Boolean).join(', ');
};

export const generateFinalSettlementPdf = (settlement, company = {}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const L = 14;
  const R = W - 14;
  const emp = settlement.employee && typeof settlement.employee === 'object' ? settlement.employee : {};
  const e = settlement.earnings || {};
  const std = settlement.standardEarnings || {};
  const d = settlement.deductions || {};

  const rateDate = resolveSettlementRateDate({ lastWorkingDate: settlement.lastWorkingDate, settlementDate: settlement.settlementDate });
  const monthDays = getCalendarDaysInMonth(rateDate);
  const served = Number(settlement.noticePeriodServed) || 0;
  // Standard (monthly) amount: saved snapshot, else back-calculated from the prorated actual
  const standardOf = (key) => {
    if (Number(std[key]) > 0) return Number(std[key]);
    if (key === 'basicSalary' && Number(settlement.grossSalary) > 0) return Number(settlement.grossSalary);
    const actual = Number(e[key]) || 0;
    return served > 0 && actual > 0 ? Math.round((actual / served) * monthDays) : actual;
  };

  const allowanceRows = [
    ...PRORATED.filter(([, k]) => Number(e[k]) > 0).map(([label, k]) => [label, standardOf(k), Number(e[k]) || 0]),
    ...ONE_OFF.filter(([, k]) => Number(e[k]) > 0).map(([label, k]) => [label, Number(e[k]), Number(e[k])])
  ];
  const deductionRows = DEDUCTIONS.filter(([, k]) => Number(d[k]) > 0).map(([label, k]) => [label, Number(d[k])]);
  const nonSalaryRows = Number(e.otherEarnings) > 0 ? [['Other Earnings', Number(e.otherEarnings)]] : [];

  // Lines are shown rounded; totals add the exact amounts and round once (Sidat)
  const totalStandard = Math.round(allowanceRows.reduce((s, r) => s + r[1], 0));
  const totalActual = Math.round(allowanceRows.reduce((s, r) => s + r[2], 0));
  const totalDeductions = Math.round(deductionRows.reduce((s, r) => s + r[1], 0));
  const totalNonSalary = Math.round(nonSalaryRows.reduce((s, r) => s + r[1], 0));
  const netPayable = Number(settlement.netSettlementAmount) || (totalActual + totalNonSalary - totalDeductions);

  const name = settlement.employeeName || personName(emp) || '';
  const joined = emp.appointmentDate || emp.hireDate;
  const confirmed = emp.confirmationDate && new Date(emp.confirmationDate) <= new Date(settlement.lastWorkingDate || Date.now());

  // ---- Header
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(company.name || 'Sardar Group of Companies', W / 2, 16, { align: 'center' });
  doc.setFontSize(11);
  doc.text('FINAL DUES', W / 2, 23, { align: 'center' });
  doc.setFontSize(8.5);
  doc.text(`For the month of ${monthYear(settlement.settlementDate || settlement.lastWorkingDate)}`, W / 2, 29, { align: 'center' });

  // ---- Employee block (two columns)
  const info = (x, y, label, value, valueX) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(String(value || '—'), (x < W / 2 ? W / 2 - 4 : R) - valueX);
    doc.text(lines.slice(0, 2), valueX, y);
    return lines.length > 1 ? 3.4 : 0;
  };
  let y = 38;
  const left = [
    ['Employee', `${settlement.employeeId || emp.employeeId || ''}      ${name}`],
    ["Father's Name", emp.guardianName],
    ['Designation', settlement.designation !== 'Unknown' ? settlement.designation : emp.placementDesignation?.title],
    ['Service Period :', `${fmtDate(joined)}   to   ${fmtDate(settlement.lastWorkingDate)}`],
    ['Confirmation Status:', emp.confirmationDate ? (confirmed ? 'Permanent' : 'Probation') : (emp.employmentStatus || '—')],
    ['CNIC #', emp.idCard]
  ];
  const right = [
    ['Section', emp.placementSection?.name],
    ['Department', settlement.department !== 'Unknown' ? settlement.department : emp.placementDepartment?.name],
    ['Project', emp.placementProject?.name],
    ['Salary Period:', `Up to   ${fmtDate(settlement.lastWorkingDate)}`],
    ['Settlement Type', String(settlement.settlementType || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())],
    ['Address', addressText(emp.address)]
  ];
  let yl = y;
  let yr = y;
  left.forEach(([l, v]) => { yl += info(L + 2, yl, l, v, L + 36) + 6; });
  right.forEach(([l, v]) => { yr += info(W / 2 + 14, yr, l, v, W / 2 + 46) + 6; });
  y = Math.max(yl, yr);

  // ---- Columns
  const cols = {
    allowance: L, standard: L + 64, actual: L + 86, deduction: L + 92, dedActual: L + 138, nonSalary: L + 146, nonActual: R
  };
  doc.setLineWidth(0.5);
  doc.line(L, y - 2, R, y - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Allowances', cols.allowance, y + 3);
  doc.text('Standard', cols.standard, y + 3, { align: 'right' });
  doc.text('Actual', cols.actual, y + 3, { align: 'right' });
  doc.text('Deductions', cols.deduction, y + 3);
  doc.text('Actual', cols.dedActual, y + 3, { align: 'right' });
  doc.text('Non-Salary', cols.nonSalary, y + 3);
  doc.text('Actual', cols.nonActual, y + 3, { align: 'right' });
  doc.line(L, y + 5.5, R, y + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const rowsTop = y + 12;
  const rowH = 5.6;
  allowanceRows.forEach(([label, s, a], i) => {
    const ry = rowsTop + i * rowH;
    doc.text(label, cols.allowance, ry);
    doc.text(amt(s), cols.standard, ry, { align: 'right' });
    doc.text(amt(a), cols.actual, ry, { align: 'right' });
  });
  // Deductions & non-salary start lower, like Sidat (aligned to the bottom of the allowance list)
  const rowCount = Math.max(allowanceRows.length, deductionRows.length, nonSalaryRows.length, 1);
  const dedStart = rowsTop + (rowCount - deductionRows.length) * rowH;
  deductionRows.forEach(([label, a], i) => {
    const ry = dedStart + i * rowH;
    doc.text(label, cols.deduction, ry);
    doc.text(amt(a), cols.dedActual, ry, { align: 'right' });
  });
  const nonStart = rowsTop + (rowCount - nonSalaryRows.length) * rowH;
  nonSalaryRows.forEach(([label, a], i) => {
    const ry = nonStart + i * rowH;
    doc.text(label, cols.nonSalary, ry);
    doc.text(amt(a), cols.nonActual, ry, { align: 'right' });
  });

  // ---- Totals with double rules
  const ty = rowsTop + rowCount * rowH;
  const totalCell = (xRight, width, value) => {
    doc.setLineWidth(0.35);
    doc.line(xRight - width, ty - 3, xRight, ty - 3);
    doc.line(xRight - width, ty - 2.3, xRight, ty - 2.3);
    doc.setFont('helvetica', 'bold');
    doc.text(amt(value), xRight, ty + 2, { align: 'right' });
    doc.line(xRight - width, ty + 3.6, xRight, ty + 3.6);
    doc.line(xRight - width, ty + 4.3, xRight, ty + 4.3);
  };
  totalCell(cols.standard, 20, totalStandard);
  totalCell(cols.actual, 20, totalActual);
  totalCell(cols.dedActual, 20, totalDeductions);
  totalCell(cols.nonActual, 20, totalNonSalary);

  // ---- Net payable + signatures + receipt
  const ny = ty + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Net Payable :', W / 2 + 40, ny, { align: 'right' });
  doc.setLineWidth(0.4);
  doc.rect(W / 2 + 44, ny - 5, 34, 8.5);
  doc.text(amt(netPayable), W / 2 + 76, ny + 0.5, { align: 'right' });

  doc.setFontSize(8.5);
  [['Prepared By', ny + 4], ['Verified By', ny + 19], ['Approved By', ny + 34]].forEach(([label, sy]) => {
    doc.text(label, L + 30, sy);
    doc.setLineWidth(0.25);
    doc.line(L + 50, sy + 0.5, L + 78, sy + 0.5);
  });

  const receipt = `I  (  ${name}  ) , Received [Rs.] ${amt(netPayable)} against the full and final settlement of my dues.`;
  doc.setFont('helvetica', 'bold');
  doc.text(doc.splitTextToSize(receipt, 52), W / 2 + 14, ny + 23);
  doc.setLineWidth(0.4);
  doc.rect(W / 2 + 14, ny + 37, 52, 10);

  // ---- Footer
  doc.setLineWidth(0.25);
  doc.line(L, H - 14, R, H - 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(60, 60, 60);
  doc.text('Human Capital Management · Tovus ERP', L, H - 10);
  doc.text(`Status: ${String(settlement.status || '').toUpperCase()}`, W / 2, H - 10, { align: 'center' });
  doc.text(`${new Date().toLocaleString('en-GB')}    Page 1 / 1`, R, H - 10, { align: 'right' });

  return doc;
};

export const downloadFinalSettlementPdf = (settlement, company = {}) => {
  const doc = generateFinalSettlementPdf(settlement, company);
  const fileName = `final-dues-${settlement.employeeId || 'record'}-${new Date(settlement.settlementDate || Date.now()).toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
};

export const printFinalSettlementPdf = (settlement, company = {}) => {
  const doc = generateFinalSettlementPdf(settlement, company);
  const blobUrl = doc.output('bloburl');
  const printWindow = window.open(blobUrl, '_blank');
  if (printWindow) {
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }
};
