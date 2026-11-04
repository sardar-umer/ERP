/**
 * Employee History downloads: PDF report and Excel workbook built from GET /api/hr/employees/:id/history.
 */

export const CAREER_TYPES = ['joining', 'transfer', 'promotion', 'increment', 'salary_change', 'allowance_change', 'status_change', 'reporting', 'leaving', 'settlement'];
export const ACTIVITY_TYPES = ['leave', 'loan', 'advance', 'salary_cut'];

export const TYPE_META = {
  joining: { label: 'Joining', color: '#2e7d32' },
  transfer: { label: 'Transfer', color: '#6a1b9a' },
  promotion: { label: 'Designation', color: '#1565c0' },
  increment: { label: 'Increment', color: '#00838f' },
  salary_change: { label: 'Salary', color: '#00838f' },
  allowance_change: { label: 'Allowance', color: '#00897b' },
  status_change: { label: 'Status', color: '#ef6c00' },
  reporting: { label: 'Reporting', color: '#5d4037' },
  leaving: { label: 'Leaving', color: '#c62828' },
  settlement: { label: 'Settlement', color: '#c62828' },
  payroll: { label: 'Payroll', color: '#546e7a' },
  leave: { label: 'Leave', color: '#0277bd' },
  loan: { label: 'Loan', color: '#f9a825' },
  advance: { label: 'Advance', color: '#f9a825' },
  salary_cut: { label: 'Salary Cut', color: '#d84315' },
  kpi: { label: 'KPI', color: '#7b1fa2' }
};

export const fmtDate = (d, withTime = false) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
};

export const serviceLength = (from, to) => {
  if (!from) return '—';
  const start = new Date(from);
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(start.getTime()) || end < start) return '—';
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || 'Less than a month';
};

const pkr = (n) => Math.round(Number(n) || 0).toLocaleString('en-PK');
const safeName = (s) => String(s || 'Employee').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');

const changeRows = (changes = []) => changes.flatMap((c) => (c.changes || []).map((ch) => ([
  fmtDate(c.changedAt, true), c.changedBy + (c.source === 'audit' ? ' (from audit trail)' : ''), ch.label, ch.from || '—', ch.to || '—'
])));

/** PDF: profile header, career history, payroll by month, leaves/loans, change log. */
export async function downloadEmployeeHistoryPdf(history) {
  const pdfModule = await import('jspdf');
  const JsPDF = pdfModule.jsPDF || pdfModule.default;
  const tableModule = await import('jspdf-autotable');
  const autoTable = tableModule.default || tableModule.autoTable;
  const { employee = {}, timeline = [], payroll = [], changes = [] } = history || {};
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const margin = 36;
  const brand = [25, 59, 104];

  doc.setFillColor(...brand);
  doc.rect(0, 0, W, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Employee History', margin, 32);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`${employee.name || ''}  ·  ID ${employee.employeeId || '—'}`, margin, 52);
  doc.text(`Generated ${fmtDate(new Date(), true)}`, W - margin, 52, { align: 'right' });

  doc.setTextColor(33, 33, 33);
  autoTable(doc, {
    startY: 86,
    theme: 'plain',
    styles: { fontSize: 9.5, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', textColor: [96, 96, 96] }, 2: { fontStyle: 'bold', textColor: [96, 96, 96] }, 4: { fontStyle: 'bold', textColor: [96, 96, 96] } },
    body: [
      ['Designation', employee.designation || '—', 'Department', employee.department || '—', 'Project', employee.project || '—'],
      ['Company', employee.company || '—', 'Location', employee.location || '—', 'Status', employee.status || '—'],
      ['Joined', fmtDate(employee.joinedOn), 'Service', serviceLength(employee.joinedOn, employee.leftOn), 'Gross Salary', `Rs ${pkr(employee.grossSalary)}`]
    ],
    margin: { left: margin, right: margin }
  });

  // The PDF fonts have no "→": print "->" so text is not garbled
  const pdfText = (v) => String(v ?? '').replace(/→/g, '->');
  const section = (title, head, rawBody, opts = {}, rightCols = []) => {
    if (!rawBody.length) return;
    const body = rawBody.map((row) => row.map(pdfText));
    let y = doc.lastAutoTable.finalY + 22;
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...brand);
    doc.text(pdfText(title), margin, y);
    autoTable(doc, {
      startY: y + 8,
      head: [head],
      body,
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: brand, textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: margin, right: margin },
      didParseCell: (cell) => {
        if (rightCols.includes(cell.column.index)) cell.cell.styles.halign = 'right';
      },
      ...opts
    });
  };

  const career = timeline.filter((t) => CAREER_TYPES.includes(t.type));
  section('Career History — transfers, designation, increments, salary, status',
    ['Date', 'Type', 'Event', 'Details'],
    career.map((t) => [fmtDate(t.date), TYPE_META[t.type]?.label || t.type, t.title, t.details]),
    { columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 75 }, 2: { cellWidth: 170 } } });

  section('Payroll by Month',
    ['Month', 'Gross', 'Days', 'Arrears', 'Earnings', 'Income Tax', 'Deductions', 'Net Pay', 'Status'],
    payroll.map((p) => [p.label, pkr(p.grossSalary), p.days, pkr(p.arrears), pkr(p.totalEarnings), pkr(p.incomeTax), pkr(p.totalDeductions), pkr(p.netSalary), p.status]),
    { columnStyles: { 7: { fontStyle: 'bold' } } },
    [1, 3, 4, 5, 6, 7]);

  const activity = timeline.filter((t) => ACTIVITY_TYPES.includes(t.type) || t.type === 'kpi');
  section('Leaves, Loans, Advances, Salary Cuts & KPI',
    ['Date', 'Type', 'Event', 'Details'],
    activity.map((t) => [fmtDate(t.date), TYPE_META[t.type]?.label || t.type, t.title, t.details]),
    { columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 75 }, 2: { cellWidth: 170 } } });

  section('Change Log — every edit (old → new)',
    ['Date', 'Changed By', 'Field', 'Old Value', 'New Value'],
    changeRows(changes),
    { columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 120 }, 2: { cellWidth: 110 } } });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`${employee.name || ''} (${employee.employeeId || ''}) — Employee History`, margin, doc.internal.pageSize.getHeight() - 16);
    doc.text(`Page ${i} of ${pages}`, W - margin, doc.internal.pageSize.getHeight() - 16, { align: 'right' });
  }
  doc.save(`Employee_History_${safeName(employee.employeeId)}_${safeName(employee.name)}.pdf`);
}

/** Excel: Summary, Career, Payroll, Activity, Change Log sheets. */
export async function downloadEmployeeHistoryExcel(history) {
  const XLSX = await import('xlsx');
  const { employee = {}, timeline = [], payroll = [], changes = [] } = history || {};
  const wb = XLSX.utils.book_new();
  const sheet = (name, rows, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  sheet('Summary', [
    ['Employee History'],
    ['Name', employee.name || ''],
    ['Employee ID', employee.employeeId || ''],
    ['Designation', employee.designation || ''],
    ['Department', employee.department || ''],
    ['Project', employee.project || ''],
    ['Company', employee.company || ''],
    ['Location', employee.location || ''],
    ['Status', employee.status || ''],
    ['Joined', fmtDate(employee.joinedOn)],
    ['Service', serviceLength(employee.joinedOn, employee.leftOn)],
    ['Gross Salary', Number(employee.grossSalary) || 0],
    ['Generated', fmtDate(new Date(), true)]
  ], [18, 40]);

  const events = (types) => [['Date', 'Type', 'Event', 'Details'],
    ...timeline.filter((t) => types.includes(t.type)).map((t) => [fmtDate(t.date), TYPE_META[t.type]?.label || t.type, t.title, t.details])];
  sheet('Career', events(CAREER_TYPES), [14, 14, 40, 90]);
  sheet('Payroll', [['Month', 'Gross', 'Days', 'Arrears', 'Earnings', 'Income Tax', 'Deductions', 'Net Pay', 'Status'],
    ...payroll.map((p) => [p.label, p.grossSalary, p.days, p.arrears, p.totalEarnings, p.incomeTax, p.totalDeductions, p.netSalary, p.status])],
  [12, 12, 8, 12, 12, 12, 12, 12, 18]);
  sheet('Leaves & Loans', events([...ACTIVITY_TYPES, 'kpi']), [14, 14, 40, 90]);
  sheet('Change Log', [['Date', 'Changed By', 'Field', 'Old Value', 'New Value'], ...changeRows(changes)], [20, 28, 22, 40, 40]);

  XLSX.writeFile(wb, `Employee_History_${safeName(employee.employeeId)}_${safeName(employee.name)}.xlsx`);
}
