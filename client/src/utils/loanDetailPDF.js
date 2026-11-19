import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getEmployeeDepartmentLabel, getEmployeePositionLabel } from './payslipPreviewUtils';

const COMPANY = 'SGC International';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const fmtPKR = (amount) =>
  `PKR ${Number(amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDate = (date) =>
  date
    ? new Date(date).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

const employeeName = (loan) => {
  const emp = loan?.employee;
  if (!emp) return '—';
  return [emp.firstName, emp.lastName].filter(Boolean).join(' ') || '—';
};

export const generateLoanDetailPdf = (loan) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.setFillColor(25, 118, 210);
  doc.rect(0, 0, pageWidth, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(COMPANY, margin, 11);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Loan Details', margin, 19);

  const loanRef = loan.loanNumber || loan._id?.slice(-8)?.toUpperCase() || '—';
  doc.setFontSize(9);
  doc.text(`Ref: ${loanRef}`, pageWidth - margin, 11, { align: 'right' });
  doc.text(`Status: ${(loan.status || '—').toUpperCase()}`, pageWidth - margin, 19, { align: 'right' });

  doc.setTextColor(40, 40, 40);
  let y = 36;

  const addSectionTitle = (title) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(25, 118, 210);
    doc.text(title.toUpperCase(), margin, y);
    y += 6;
    doc.setTextColor(40, 40, 40);
  };

  const addKeyValueRows = (pairs) => {
    autoTable(doc, {
      startY: y,
      body: pairs.map(([label, value]) => [label, value || '—']),
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 1.5 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 52, textColor: [90, 90, 90] },
        1: { cellWidth: 'auto' }
      },
      margin: { left: margin, right: margin }
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  addSectionTitle('Employee Information');
  addKeyValueRows([
    ['Employee', `${employeeName(loan)} (${loan.employee?.employeeId || '—'})`],
    ['Department', getEmployeeDepartmentLabel(loan.employee)],
    ['Designation', getEmployeePositionLabel(loan.employee)]
  ]);

  addSectionTitle('Loan Information');
  addKeyValueRows([
    ['Loan Type', loan.loanType],
    ['Purpose', loan.purpose],
    ['Application Date', fmtDate(loan.applicationDate)],
    ['Approval Date', fmtDate(loan.approvalDate)],
    ['Disbursement Date', fmtDate(loan.disbursementDate)],
    ['Interest Rate', loan.interestRate != null ? `${loan.interestRate}%` : '—'],
    ['Loan Term', loan.loanTerm != null ? `${loan.loanTerm} month(s)` : '—'],
    ['Progress', loan.progressPercentage != null ? `${loan.progressPercentage}%` : '—']
  ]);

  addSectionTitle('Financial Summary');
  addKeyValueRows([
    ['Loan Amount', fmtPKR(loan.loanAmount)],
    ['Monthly EMI', fmtPKR(loan.monthlyInstallment)],
    ['Total Payable', fmtPKR(loan.totalPayable)],
    ['Outstanding Balance', fmtPKR(loan.outstandingBalance)],
    ['Remaining Installments', String(loan.remainingInstallments ?? '—')]
  ]);

  if (loan.pausedMonths?.length) {
    addSectionTitle('Paused Deduction Months');
    autoTable(doc, {
      startY: y,
      head: [['Month / Year', 'Reason', 'Paused At']],
      body: loan.pausedMonths.map((p) => [
        `${MONTH_NAMES[p.month - 1] || p.month} ${p.year}`,
        p.reason || '—',
        p.pausedAt ? fmtDate(p.pausedAt) : '—'
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
      margin: { left: margin, right: margin }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (loan.payments?.length) {
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    addSectionTitle('Direct Payments (outside payroll)');
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Type', 'Amount', 'Method / Ref', 'Balance', 'Installment', 'Months Left']],
      body: [...loan.payments]
        .sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate))
        .map((p) => [
          fmtDate(p.paymentDate),
          p.paymentType,
          fmtPKR(p.amount),
          `${p.paymentMethod || ''}${p.reference ? ` / ${p.reference}` : ''}`,
          `${fmtPKR(p.principalBefore)} > ${fmtPKR(p.principalAfter)}`,
          p.paymentType === 'Full Settlement'
            ? '—'
            : `${fmtPKR(p.installmentBefore)} > ${fmtPKR(p.installmentAfter)}`,
          `${p.remainingInstallmentsBefore ?? '—'} > ${p.remainingInstallmentsAfter ?? '—'}`
        ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' } },
      margin: { left: margin, right: margin }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (loan.loanSchedule?.length) {
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    addSectionTitle('Loan Schedule');
    autoTable(doc, {
      startY: y,
      head: [['#', 'Due Date', 'Amount', 'Principal', 'Interest', 'Balance', 'Status']],
      body: loan.loanSchedule.map((row) => [
        row.installmentNumber,
        fmtDate(row.dueDate),
        fmtPKR(row.amount),
        fmtPKR(row.principal),
        fmtPKR(row.interest),
        fmtPKR(row.balance),
        row.isLumpSum ? `${row.status || 'Paid'} (Lump sum)` : (row.status || '—')
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' }
      },
      margin: { left: margin, right: margin }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (loan.guarantor?.name || loan.guarantor?.phone) {
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    addSectionTitle('Guarantor');
    addKeyValueRows([
      ['Name', loan.guarantor?.name],
      ['Relationship', loan.guarantor?.relationship],
      ['Phone', loan.guarantor?.phone],
      ['ID Card', loan.guarantor?.idCard]
    ]);
  }

  if (loan.notes?.length) {
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    addSectionTitle('Notes');
    autoTable(doc, {
      startY: y,
      head: [['Note', 'Added By', 'Date']],
      body: loan.notes.map((note) => [
        note.content || '—',
        [note.addedBy?.firstName, note.addedBy?.lastName].filter(Boolean).join(' ') || '—',
        fmtDate(note.addedAt)
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
      margin: { left: margin, right: margin }
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(
      `Generated ${new Date().toLocaleDateString('en-PK')} · Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'center' }
    );
  }

  return doc;
};

export const downloadLoanDetailPDF = (loan) => {
  const doc = generateLoanDetailPdf(loan);
  const empId = loan.employee?.employeeId || 'employee';
  const safeName = employeeName(loan).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'loan';
  doc.save(`loan-${safeName}-${empId}.pdf`);
};
