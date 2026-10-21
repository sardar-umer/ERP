/**
 * Shared report export utility.
 * Uses jspdf + jspdf-autotable for PDF, xlsx for Excel.
 */

const COMPANY = 'SGC International';

// ─── helpers ────────────────────────────────────────────────────────────────
const fmtPKR = (n) =>
  'PKR ' + Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const todayStr = () => new Date().toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });

function baseDoc(title, subtitle, jsPDF, companyName = COMPANY) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  // Header bar
  doc.setFillColor(25, 118, 210);
  doc.rect(0, 0, 210, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName || COMPANY, 14, 10);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(title, 14, 17);
  // Subtitle / date line
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(9);
  doc.text(subtitle, 14, 28);
  doc.text(`Generated: ${todayStr()}`, 14, 33);
  doc.setDrawColor(200, 200, 200);
  doc.line(14, 36, 196, 36);
  return doc;
}

// ─── Balance Sheet ───────────────────────────────────────────────────────────
export async function exportBalanceSheetPDF(data) {
  const jsPDF = (await import('jspdf')).default;
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = baseDoc('Balance Sheet', `As of ${new Date(data.asOfDate).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' })}`, jsPDF);
  let y = 42;

  const addSection = (title, rows, total, color) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(title.toUpperCase(), 14, y);
    y += 2;
    doc.setTextColor(60, 60, 60);
    autoTable(doc, {
      startY: y,
      head: [['Account #', 'Account Name', 'Type', 'Balance (PKR)']],
      body: rows.map(r => [r.accountNumber || '', r.accountName || '', r.accountType || '', fmtPKR(r.balance)]),
      foot: [['', '', 'Total ' + title, fmtPKR(total)]],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 240], fontStyle: 'bold', textColor: color },
      columnStyles: { 3: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 6;
  };

  addSection('Assets',      data.assets.rows,      data.assets.total,      [21, 101, 192]);
  addSection('Liabilities', data.liabilities.rows, data.liabilities.total, [198, 40, 40]);
  addSection('Equity',      data.equity.rows,       data.equity.total,      [46, 125, 50]);

  doc.save(`Balance-Sheet-${data.asOfDate}.pdf`);
}

export async function exportBalanceSheetExcel(data) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const rows = [
    ['SGC International — Balance Sheet'],
    [`As of: ${data.asOfDate}`],
    [`Generated: ${todayStr()}`],
    [],
    ['ASSETS'],
    ['Account #', 'Account Name', 'Type', 'Balance (PKR)'],
    ...data.assets.rows.map(r => [r.accountNumber, r.accountName, r.accountType, r.balance]),
    ['', '', 'Total Assets', data.assets.total],
    [],
    ['LIABILITIES'],
    ['Account #', 'Account Name', 'Type', 'Balance (PKR)'],
    ...data.liabilities.rows.map(r => [r.accountNumber, r.accountName, r.accountType, r.balance]),
    ['', '', 'Total Liabilities', data.liabilities.total],
    [],
    ['EQUITY'],
    ['Account #', 'Account Name', 'Type', 'Balance (PKR)'],
    ...data.equity.rows.map(r => [r.accountNumber, r.accountName, r.accountType, r.balance]),
    ['', '', 'Total Equity', data.equity.total],
    [],
    ['', '', 'Total Assets', data.totals.totalAssets],
    ['', '', 'Liabilities + Equity + net P&L', data.totals.liabilitiesEquityAndPL ?? data.totals.liabilitiesAndEquity],
    ['', '', 'Balanced?', data.totals.isBalanced ? 'YES' : 'NO'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 24 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Balance Sheet');
  XLSX.writeFile(wb, `Balance-Sheet-${data.asOfDate}.xlsx`);
}

// ─── Profit & Loss ───────────────────────────────────────────────────────────
export async function exportProfitLossPDF(data, filters) {
  const jsPDF = (await import('jspdf')).default;
  const autoTable = (await import('jspdf-autotable')).default;
  const sub = `Period: ${filters.fromDate || 'Start'} → ${filters.toDate || 'Today'}`;
  const doc = baseDoc('Profit & Loss Statement', sub, jsPDF);
  let y = 42;

  const addSection = (title, rows, total, color) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(title.toUpperCase(), 14, y);
    y += 2;
    doc.setTextColor(60, 60, 60);
    autoTable(doc, {
      startY: y,
      head: [['Account #', 'Account Name', 'Amount (PKR)']],
      body: rows.map(r => [r.accountNumber || '', r.accountName || '', fmtPKR(r.balance)]),
      foot: [['', 'Total ' + title, fmtPKR(total)]],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 240], fontStyle: 'bold', textColor: color },
      columnStyles: { 2: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 6;
  };

  addSection('Revenue',  data.revenue.rows,  data.revenue.total,  [46, 125, 50]);
  addSection('Expenses', data.expenses.rows, data.expenses.total, [198, 40, 40]);

  // Net profit line
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  const netColor = data.netProfit >= 0 ? [46, 125, 50] : [198, 40, 40];
  doc.setTextColor(...netColor);
  doc.text(`Net ${data.netProfit >= 0 ? 'Profit' : 'Loss'}: ${fmtPKR(Math.abs(data.netProfit))}`, 14, y + 4);
  doc.save(`Profit-Loss-${filters.fromDate}-${filters.toDate}.pdf`);
}

export async function exportProfitLossExcel(data, filters) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const rows = [
    ['SGC International — Profit & Loss Statement'],
    [`Period: ${filters.fromDate || 'Start'} to ${filters.toDate || 'Today'}`],
    [`Generated: ${todayStr()}`],
    [],
    ['REVENUE'],
    ['Account #', 'Account Name', 'Amount (PKR)'],
    ...data.revenue.rows.map(r => [r.accountNumber, r.accountName, r.balance]),
    ['', 'Total Revenue', data.revenue.total],
    [],
    ['EXPENSES'],
    ['Account #', 'Account Name', 'Amount (PKR)'],
    ...data.expenses.rows.map(r => [r.accountNumber, r.accountName, r.balance]),
    ['', 'Total Expenses', data.expenses.total],
    [],
    ['', `Net ${data.netProfit >= 0 ? 'Profit' : 'Loss'}`, data.netProfit],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, 'P&L');
  XLSX.writeFile(wb, `Profit-Loss-${filters.fromDate}-${filters.toDate}.xlsx`);
}

// ─── Trial Balance ───────────────────────────────────────────────────────────
export async function exportTrialBalancePDF(data, asOfDate) {
  const jsPDF = (await import('jspdf')).default;
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = baseDoc('Trial Balance', `As of ${asOfDate}`, jsPDF);
  const totalOpening = data.accounts?.reduce((s, a) => s + (a.openingBalance || 0), 0) || 0;
  const totalDebits = data.accounts?.reduce((s, a) => s + (a.totalDebit || 0), 0) || 0;
  const totalCredits = data.accounts?.reduce((s, a) => s + (a.totalCredit || 0), 0) || 0;
  const totalClosing = data.accounts?.reduce((s, a) => s + (a.closingBalance || 0), 0) || 0;
  autoTable(doc, {
    startY: 42,
    head: [['Account #', 'Account Name', 'Type', 'Opening (PKR)', 'Debit (PKR)', 'Credit (PKR)', 'Closing (PKR)']],
    body: (data.accounts || []).map(a => [
      a.accountNumber || '', a.accountName || '', a.accountType || '',
      fmtPKR(a.openingBalance || 0),
      a.totalDebit ? fmtPKR(a.totalDebit) : '',
      a.totalCredit ? fmtPKR(a.totalCredit) : '',
      fmtPKR(a.closingBalance ?? a.balance ?? 0)
    ]),
    foot: [['', '', 'TOTALS',
      fmtPKR(totalOpening),
      fmtPKR(totalDebits),
      fmtPKR(totalCredits),
      fmtPKR(totalClosing)
    ]],
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 240], fontStyle: 'bold' },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  });
  doc.save(`Trial-Balance-${asOfDate}.pdf`);
}

export async function exportTrialBalanceExcel(data, asOfDate) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const rows = [
    ['SGC International — Trial Balance'],
    [`As of: ${asOfDate}`],
    [`Generated: ${todayStr()}`],
    [],
    ['Account #', 'Account Name', 'Type', 'Opening (PKR)', 'Debit (PKR)', 'Credit (PKR)', 'Closing (PKR)'],
    ...(data.accounts || []).map(a => [a.accountNumber, a.accountName, a.accountType, a.openingBalance || 0, a.totalDebit || 0, a.totalCredit || 0, a.closingBalance ?? a.balance ?? 0]),
    [],
    ['', '', 'TOTALS',
      data.accounts?.reduce((s, a) => s + (a.openingBalance || 0), 0),
      data.accounts?.reduce((s, a) => s + (a.totalDebit || 0), 0),
      data.accounts?.reduce((s, a) => s + (a.totalCredit || 0), 0),
      data.accounts?.reduce((s, a) => s + (a.closingBalance || 0), 0)
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Trial Balance');
  XLSX.writeFile(wb, `Trial-Balance-${asOfDate}.xlsx`);
}

// ─── Cash Flow ───────────────────────────────────────────────────────────────
export async function exportCashFlowPDF(data, filters) {
  const jsPDF = (await import('jspdf')).default;
  const autoTable = (await import('jspdf-autotable')).default;
  const sub = `Period: ${filters.fromDate || 'Start'} → ${filters.toDate || 'Today'}`;
  const doc = baseDoc('Cash Flow Statement', sub, jsPDF);
  let y = 42;

  const addSection = (title, items, total, color) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(title.toUpperCase(), 14, y);
    y += 2;
    doc.setTextColor(60, 60, 60);
    autoTable(doc, {
      startY: y,
      head: [['Reference', 'Description', 'Amount (PKR)']],
      body: (items || []).map(i => [i.reference || '', i.description || '', fmtPKR(i.amount)]),
      foot: [['', 'Net ' + title, fmtPKR(total)]],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 240], fontStyle: 'bold', textColor: color },
      columnStyles: { 2: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 6;
  };

  addSection('Operating Activities', data.operating?.items, data.operating?.total, [25, 118, 210]);
  addSection('Investing Activities', data.investing?.items, data.investing?.total, [102, 60, 196]);
  addSection('Financing Activities', data.financing?.items, data.financing?.total, [0, 150, 136]);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text(`Net Change in Cash: ${fmtPKR(data.netChange)}`, 14, y + 4);
  doc.save(`Cash-Flow-${filters.fromDate}-${filters.toDate}.pdf`);
}

export async function exportCashFlowExcel(data, filters) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const makeSection = (title, items, total) => [
    [title.toUpperCase()],
    ['Reference', 'Description', 'Amount (PKR)'],
    ...(items || []).map(i => [i.reference || '', i.description || '', i.amount || 0]),
    ['', 'Net ' + title, total || 0],
    [],
  ];
  const rows = [
    ['SGC International — Cash Flow Statement'],
    [`Period: ${filters.fromDate || 'Start'} to ${filters.toDate || 'Today'}`],
    [`Generated: ${todayStr()}`],
    [],
    ...makeSection('Operating Activities', data.operating?.items, data.operating?.total),
    ...makeSection('Investing Activities', data.investing?.items, data.investing?.total),
    ...makeSection('Financing Activities', data.financing?.items, data.financing?.total),
    ['', 'NET CHANGE IN CASH', data.netChange || 0],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Cash Flow');
  XLSX.writeFile(wb, `Cash-Flow-${filters.fromDate}-${filters.toDate}.xlsx`);
}

// ─── Tax Summary ─────────────────────────────────────────────────────────────
export async function exportTaxSummaryPDF(data, filters) {
  const jsPDF = (await import('jspdf')).default;
  const autoTable = (await import('jspdf-autotable')).default;
  const sub = `Period: ${filters.fromDate || 'Start'} → ${filters.toDate || 'Today'}`;
  const doc = baseDoc('FBR Tax Summary', sub, jsPDF);
  let y = 42;

  const addTable = (title, rows, color) => {
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(title, 14, y); y += 2;
    doc.setTextColor(60, 60, 60);
    autoTable(doc, {
      startY: y,
      head: [['Tax Name', 'Rate', 'Base Amount', 'Tax Amount']],
      body: rows.map(r => [r.taxName || r.name || '', `${r.rate || 0}%`, fmtPKR(r.baseAmount), fmtPKR(r.taxAmount)]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 6;
  };

  if (data.inputTax?.length)  addTable('Input Tax (GST Paid)', data.inputTax, [46, 125, 50]);
  if (data.outputTax?.length) addTable('Output Tax (GST Collected)', data.outputTax, [198, 40, 40]);
  if (data.whtTax?.length)    addTable('Withholding Tax (WHT)', data.whtTax, [230, 81, 0]);

  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  const net = (data.totalOutputTax || 0) - (data.totalInputTax || 0);
  doc.text(`Net Tax Payable: ${fmtPKR(net)}`, 14, y + 4);
  doc.save(`Tax-Summary-${filters.fromDate}-${filters.toDate}.pdf`);
}

export async function exportBankReconciliationPDF(data, filters, bankName, companyName) {
  const jsPDF = (await import('jspdf')).default;
  const autoTable = (await import('jspdf-autotable')).default;
  
  let subtitle = `${bankName} | As of: ${filters.asOfDate}`;
  if (data.reconciledUpTo) {
    subtitle += ` | Reconciled Up To: ${new Date(data.reconciledUpTo).toLocaleDateString('en-PK')}`;
  }
  
  const doc = baseDoc('Bank Reconciliation Statement', subtitle, jsPDF, companyName);

  let y = 45;

  // Summary Table
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, font: 'helvetica' },
    headStyles: { fillColor: [240, 240, 240], textColor: [40, 40, 40], fontStyle: 'bold' },
    body: [
      ['Balance as Per Bank Ledger', `${data.glBalance < 0 ? `-${fmtPKR(data.glBalance)}` : fmtPKR(data.glBalance)} ${data.glBalanceType}`],
      ['Difference (Unpresented / Uncleared Cheques)', `${data.difference < 0 ? `-${fmtPKR(data.difference)}` : fmtPKR(data.difference)} ${data.differenceType}`],
      [{ content: 'Balance as Per Bank Statement', styles: { fontStyle: 'bold' } }, { content: `${data.bankStatementBalance < 0 ? `-${fmtPKR(data.bankStatementBalance)}` : fmtPKR(data.bankStatementBalance)} ${data.bankStatementBalanceType}`, styles: { fontStyle: 'bold' } }]
    ]
  });

  y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text(`Unpresented / Uncleared Cheques & Payments (${(data.unpresentedTransactions || []).length})`, 14, y);
  y += 5;

  const unpresentedData = (data.unpresentedTransactions || []).map((t) => [
    t.date ? new Date(t.date).toLocaleDateString('en-PK') : '',
    t.vrNo || '',
    t.narration || '',
    t.reference || '',
    `${t.type === 'Cr' ? '-' : ''}${fmtPKR(t.amount)} ${t.type}`,
    t.clearingDate ? new Date(t.clearingDate).toLocaleDateString('en-PK') : ''
  ]);

  autoTable(doc, {
    startY: y,
    theme: 'striped',
    head: [['Date', 'VrNo', 'Narration', 'Reference', 'Amount', 'Expected Clear Date']],
    body: unpresentedData,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [60, 60, 60], textColor: [255, 255, 255] },
    columnStyles: {
      4: { halign: 'right' }
    }
  });

  y = doc.lastAutoTable.finalY + 10;
  
  if (y > 270) {
    doc.addPage();
    y = 20;
  }
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text(`Period Activity (${filters.fromDate} to ${filters.toDate})`, 14, y);
  y += 5;

  const periodData = [
    [{ content: 'Opening Balance', colSpan: 4, styles: { fontStyle: 'bold', halign: 'right' } }, { content: `${data.openingBalance < 0 ? '-' : ''}${fmtPKR(data.openingBalance)} ${data.openingBalanceType || ''}`, styles: { fontStyle: 'bold', halign: 'right' } }, ''],
    ...(data.periodTransactions || []).map((t) => [
      t.date ? new Date(t.date).toLocaleDateString('en-PK') : '',
      t.vrNo || '',
      t.narration || '',
      t.reference || '',
      `${t.type === 'Cr' ? '-' : ''}${fmtPKR(t.amount)} ${t.type}`,
      t.clearingDate ? new Date(t.clearingDate).toLocaleDateString('en-PK') : ''
    ]),
    [{ content: 'Closing Balance', colSpan: 4, styles: { fontStyle: 'bold', halign: 'right' } }, { content: `${data.statementTotal < 0 ? '-' : ''}${fmtPKR(data.statementTotal)} ${data.statementTotalType || ''}`, styles: { fontStyle: 'bold', halign: 'right' } }, '']
  ];

  autoTable(doc, {
    startY: y,
    theme: 'striped',
    head: [['Date', 'VrNo', 'Narration', 'Reference', 'Amount', 'Clear Date']],
    body: periodData,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [60, 60, 60], textColor: [255, 255, 255] },
    columnStyles: {
      4: { halign: 'right' }
    }
  });

  doc.save(`Bank-Reconciliation-${filters.asOfDate}.pdf`);
}

/** Excel export for Bank Statement & Period Activity section only. */
export async function exportBankStatementPeriodExcel(data, filters, bankName, companyName) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const fmtAmt = (n) => Number(Math.abs(n || 0));
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PK') : '');

  const rows = [
    [companyName || COMPANY],
    ['Bank Statement & Period Activity'],
    [`Bank: ${bankName || '—'}`],
    [`Period: ${filters.fromDate || ''} to ${filters.toDate || ''}`],
    [`Generated: ${todayStr()}`],
    [],
    ['Date', 'VrNo', 'Narration', 'Reference', 'Amount', 'Type', 'Clearing Date'],
    [
      '',
      '',
      'Opening Balance',
      '',
      fmtAmt(data.openingBalance),
      data.openingBalanceType || '',
      ''
    ],
    ...(data.periodTransactions || []).map((t) => [
      fmtDate(t.date),
      t.vrNo || '',
      t.narration || '',
      t.reference || '',
      fmtAmt(t.amount),
      t.type || '',
      fmtDate(t.clearingDate)
    ]),
    [
      '',
      '',
      'Total / Closing Balance',
      '',
      fmtAmt(data.statementTotal),
      data.statementTotalType || '',
      ''
    ]
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 45 },
    { wch: 18 },
    { wch: 16 },
    { wch: 8 },
    { wch: 14 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Period Activity');
  XLSX.writeFile(
    wb,
    `Bank-Statement-Period-${filters.fromDate || 'from'}-${filters.toDate || 'to'}.xlsx`
  );
}

export async function exportTaxSummaryExcel(data, filters) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const rows = [
    ['SGC International — FBR Tax Summary'],
    [`Period: ${filters.fromDate || 'Start'} to ${filters.toDate || 'Today'}`],
    [`Generated: ${todayStr()}`],
    [],
    ['INPUT TAX (GST PAID)'],
    ['Tax Name', 'Rate', 'Base Amount', 'Tax Amount'],
    ...(data.inputTax || []).map(r => [r.taxName || r.name, `${r.rate || 0}%`, r.baseAmount || 0, r.taxAmount || 0]),
    ['', '', 'Total Input Tax', data.totalInputTax || 0],
    [],
    ['OUTPUT TAX (GST COLLECTED)'],
    ['Tax Name', 'Rate', 'Base Amount', 'Tax Amount'],
    ...(data.outputTax || []).map(r => [r.taxName || r.name, `${r.rate || 0}%`, r.baseAmount || 0, r.taxAmount || 0]),
    ['', '', 'Total Output Tax', data.totalOutputTax || 0],
    [],
    ['WITHHOLDING TAX (WHT)'],
    ['Tax Name', 'Rate', 'Base Amount', 'Tax Amount'],
    ...(data.whtTax || []).map(r => [r.taxName || r.name, `${r.rate || 0}%`, r.baseAmount || 0, r.taxAmount || 0]),
    ['', '', 'Total WHT', data.totalWht || 0],
    [],
    ['', 'NET TAX PAYABLE', (data.totalOutputTax || 0) - (data.totalInputTax || 0)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Tax Summary');
  XLSX.writeFile(wb, `Tax-Summary-${filters.fromDate}-${filters.toDate}.xlsx`);
}
