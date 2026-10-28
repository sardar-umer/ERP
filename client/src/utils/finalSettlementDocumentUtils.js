import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import finalSettlementService from '../services/finalSettlementService';
import {
  getCalendarDaysInMonth,
  resolveSettlementRateDate,
  getSettlementDailyRate,
  getSettlementActualSalary
} from './finalSettlementDays';

const fmtPKR = (amount) =>
  `PKR ${Number(amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDate = (date) =>
  date
    ? new Date(date).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

const earningRows = (earnings = {}) =>
  [
    ['Basic Salary', earnings.basicSalary],
    ['House Rent', earnings.houseRent],
    ['Medical Allowance', earnings.medicalAllowance],
    ['Conveyance', earnings.conveyanceAllowance],
    ['Food Allowance', earnings.foodAllowance],
    ['Mobile Allowance', earnings.mobileAllowance],
    ['Vehicle Allowance', earnings.vehicleAllowance],
    ['Fuel Allowance', earnings.fuelAllowance],
    ['Special Allowance', earnings.specialAllowance],
    ['Other Allowances', earnings.otherAllowances],
    ['Other Earnings', earnings.otherEarnings],
    ['Overtime', earnings.overtime],
    ['Bonus', earnings.bonus],
    ['Gratuity', earnings.gratuity],
    ['Leave Encashment', earnings.leaveEncashment],
    ['Notice Pay', earnings.noticePay]
  ].filter(([, amount]) => Number(amount) > 0);

const deductionRows = (deductions = {}) =>
  [
    ['Income Tax', deductions.incomeTax],
    ['Provident Fund', deductions.providentFund],
    ['EOBI', deductions.eobi],
    ['Loan Deductions', deductions.loanDeductions],
    ['Notice Period Deduction', deductions.noticePeriodDeduction],
    ['Security', deductions.security],
    ['Health Insurance', deductions.healthInsurance],
    ['Advance Deductions', deductions.advanceDeductions],
    ['Pension', deductions.pension],
    ['Other Deductions', deductions.otherDeductions]
  ].filter(([, amount]) => Number(amount) > 0);

const sumRows = (rows) => rows.reduce((s, [, a]) => s + (Number(a) || 0), 0);

/**
 * Compact single-page A4 Final Settlement statement.
 */
export const generateFinalSettlementPdf = (settlement, company = {}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;

  const rateDate = resolveSettlementRateDate({
    lastWorkingDate: settlement.lastWorkingDate,
    settlementDate: settlement.settlementDate
  });
  const dailyRate = Math.round(getSettlementDailyRate(settlement.grossSalary || 0, rateDate));
  const actualSalary =
    Number(settlement.actualSalary) > 0
      ? Number(settlement.actualSalary)
      : getSettlementActualSalary(settlement.grossSalary || 0, settlement.noticePeriodServed, rateDate);
  const shortfallDays = Math.max(
    0,
    (Number(settlement.noticePeriod) || 0) - (Number(settlement.noticePeriodServed) || 0)
  );
  // Use stored deduction only (defaults to 0; do not auto-apply computed shortfall)
  const shortfallDeduction = Number(settlement.deductions?.noticePeriodDeduction) || 0;
  const monthDays = getCalendarDaysInMonth(rateDate);
  const earningsBody = earningRows(settlement.earnings);
  const deductionsBody = deductionRows(settlement.deductions);
  const totalEarnings =
    Number(settlement.earnings?.totalEarnings) > 0
      ? Number(settlement.earnings.totalEarnings)
      : Number(settlement.grossSettlementAmount) || sumRows(earningsBody);
  const totalDeductions =
    Number(settlement.deductions?.totalDeductions) > 0
      ? Number(settlement.deductions.totalDeductions)
      : sumRows(deductionsBody);

  // Header bar
  doc.setFillColor(25, 118, 210);
  doc.rect(0, 0, pageWidth, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(company.name || 'SGC International', margin, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Final Settlement Statement', margin, 14);
  doc.setFontSize(8);
  doc.text(`Emp: ${settlement.employeeId || '—'}`, pageWidth - margin, 8, { align: 'right' });
  doc.text(
    `Status: ${finalSettlementService.getStatusLabel(settlement.status).toUpperCase()}`,
    pageWidth - margin,
    14,
    { align: 'right' }
  );

  doc.setTextColor(33, 33, 33);
  let y = 23;

  // Employee + settlement meta (two columns, compact)
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 7.5, cellPadding: 0.8, textColor: [40, 40, 40] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 28 },
      1: { cellWidth: 55 },
      2: { fontStyle: 'bold', cellWidth: 30 },
      3: { cellWidth: contentWidth - 113 }
    },
    body: [
      [
        'Employee',
        settlement.employeeName || '—',
        'Type',
        finalSettlementService.getSettlementTypeLabel(settlement.settlementType)
      ],
      [
        'Employee ID',
        settlement.employeeId || '—',
        'Last Working',
        fmtDate(settlement.lastWorkingDate)
      ],
      [
        'Department',
        settlement.department || '—',
        'Settlement Date',
        fmtDate(settlement.settlementDate)
      ],
      [
        'Designation',
        settlement.designation || '—',
        'Notice Period',
        `${settlement.noticePeriodServed || 0}/${settlement.noticePeriod || 0} days`
      ]
    ],
    margin: { left: margin, right: margin }
  });

  y = doc.lastAutoTable.finalY + 3;

  // Salary & Calculations strip
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(25, 118, 210);
  doc.text('Salary & Calculations (from Gross)', margin, y);
  y += 1.5;

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.1, halign: 'center' },
    headStyles: { fillColor: [227, 242, 253], textColor: [13, 71, 161], fontStyle: 'bold', fontSize: 6.5 },
    bodyStyles: { fontStyle: 'bold', fontSize: 7.5 },
    head: [['Gross Salary', 'Basic', 'Daily Rate', 'Month Days', 'Actual Salary', 'Shortfall', 'Notice Deduction']],
    body: [[
      fmtPKR(settlement.grossSalary),
      fmtPKR(settlement.basicSalary),
      fmtPKR(dailyRate),
      String(monthDays),
      fmtPKR(actualSalary),
      `${shortfallDays} d`,
      fmtPKR(shortfallDeduction)
    ]],
    margin: { left: margin, right: margin },
    tableWidth: contentWidth
  });

  y = doc.lastAutoTable.finalY + 3;

  // Earnings + Deductions side by side
  const midGap = 3;
  const colWidth = (contentWidth - midGap) / 2;
  const leftX = margin;
  const rightX = margin + colWidth + midGap;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(46, 125, 50);
  doc.text('Earnings Breakdown', leftX, y);
  doc.setTextColor(198, 40, 40);
  doc.text('Deductions Breakdown', rightX, y);
  y += 1.5;

  const earnTableBody = [
    ...earningsBody.map(([label, amount]) => [label, fmtPKR(amount)]),
    ['Total Earnings', fmtPKR(totalEarnings)]
  ];
  const dedTableBody = [
    ...deductionsBody.map(([label, amount]) => [label, fmtPKR(amount)]),
    ['Total Deductions', fmtPKR(totalDeductions)]
  ];

  autoTable(doc, {
    startY: y,
    theme: 'striped',
    styles: { fontSize: 6.5, cellPadding: 0.9 },
    headStyles: { fillColor: [76, 175, 80], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    columnStyles: { 0: { cellWidth: colWidth * 0.62 }, 1: { halign: 'right', cellWidth: colWidth * 0.38 } },
    head: [['Component', 'Amount']],
    body: earnTableBody.length > 1 ? earnTableBody : [['—', fmtPKR(0)], ['Total Earnings', fmtPKR(totalEarnings)]],
    margin: { left: leftX, right: pageWidth - leftX - colWidth },
    tableWidth: colWidth,
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === earnTableBody.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [232, 245, 233];
      }
    }
  });
  const earnEndY = doc.lastAutoTable.finalY;

  autoTable(doc, {
    startY: y,
    theme: 'striped',
    styles: { fontSize: 6.5, cellPadding: 0.9 },
    headStyles: { fillColor: [244, 67, 54], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    columnStyles: { 0: { cellWidth: colWidth * 0.62 }, 1: { halign: 'right', cellWidth: colWidth * 0.38 } },
    head: [['Component', 'Amount']],
    body: dedTableBody.length > 1 ? dedTableBody : [['—', fmtPKR(0)], ['Total Deductions', fmtPKR(totalDeductions)]],
    margin: { left: rightX, right: margin },
    tableWidth: colWidth,
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === dedTableBody.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [255, 235, 238];
      }
    }
  });
  const dedEndY = doc.lastAutoTable.finalY;
  y = Math.max(earnEndY, dedEndY) + 3;

  // Net summary
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.4, fontStyle: 'bold' },
    headStyles: { fillColor: [25, 118, 210], textColor: 255, fontSize: 8 },
    columnStyles: { 0: { cellWidth: contentWidth * 0.55 }, 1: { halign: 'right', cellWidth: contentWidth * 0.45 } },
    head: [['Description', 'Amount']],
    body: [
      ['Total Earnings (Gross Settlement)', fmtPKR(totalEarnings)],
      ['Total Deductions', fmtPKR(totalDeductions)],
      ['Net Settlement Amount', fmtPKR(settlement.netSettlementAmount)]
    ],
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === 2) {
        data.cell.styles.fillColor = [232, 245, 233];
        data.cell.styles.textColor = [27, 94, 32];
      }
    }
  });
  y = doc.lastAutoTable.finalY + 2;

  // Loans (compact) if any
  if (Array.isArray(settlement.loans) && settlement.loans.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(66, 66, 66);
    doc.text('Loan Settlements', margin, y + 3);
    y += 4;
    autoTable(doc, {
      startY: y,
      theme: 'striped',
      styles: { fontSize: 6.5, cellPadding: 0.8 },
      headStyles: { fillColor: [96, 125, 139], textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
      head: [['Loan Type', 'Original', 'Outstanding', 'Settled']],
      body: settlement.loans.slice(0, 4).map((loan) => [
        loan.loanType || '—',
        fmtPKR(loan.originalAmount),
        fmtPKR(loan.outstandingBalance),
        fmtPKR(loan.settledAmount)
      ]),
      margin: { left: margin, right: margin }
    });
    y = doc.lastAutoTable.finalY + 2;
  }

  // Reason / notes (one line truncated to stay on page)
  if (settlement.reason || settlement.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(66, 66, 66);
    if (settlement.reason) {
      doc.text('Reason:', margin, y + 3);
      doc.setFont('helvetica', 'normal');
      const reasonLines = doc.splitTextToSize(String(settlement.reason), contentWidth - 16);
      doc.text(reasonLines.slice(0, 2), margin + 16, y + 3);
      y += 3 + Math.min(reasonLines.length, 2) * 3.2;
    }
    if (settlement.notes) {
      doc.setFont('helvetica', 'bold');
      doc.text('Notes:', margin, y + 3);
      doc.setFont('helvetica', 'normal');
      const noteLines = doc.splitTextToSize(String(settlement.notes), contentWidth - 14);
      doc.text(noteLines.slice(0, 2), margin + 14, y + 3);
      y += 3 + Math.min(noteLines.length, 2) * 3.2;
    }
  }

  // Signature row
  const sigY = Math.min(y + 10, pageHeight - 22);
  doc.setDrawColor(160);
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  const sigW = contentWidth / 3;
  ['Prepared By', 'Checked By', 'Approved By'].forEach((label, i) => {
    const x = margin + i * sigW + 4;
    doc.line(x, sigY, x + sigW - 12, sigY);
    doc.text(label, x + (sigW - 12) / 2, sigY + 4, { align: 'center' });
  });

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(130, 130, 130);
  doc.text(
    company.invoiceFooter || `${company.name || 'SGC International'} — Final Settlement (single page)`,
    pageWidth / 2,
    pageHeight - 6,
    { align: 'center' }
  );

  return doc;
};

export const downloadFinalSettlementPdf = (settlement, company = {}) => {
  const doc = generateFinalSettlementPdf(settlement, company);
  const fileName = `final-settlement-${settlement.employeeId || 'record'}-${new Date(settlement.settlementDate || Date.now()).toISOString().slice(0, 10)}.pdf`;
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
