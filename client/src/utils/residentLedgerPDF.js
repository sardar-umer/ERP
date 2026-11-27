import dayjs from 'dayjs';
import {
  buildLedgerSectionDisplayRows,
  getLedgerTotalOutstandingBalance
} from './residentLedgerDisplay';

// Configurable layout (adjustable)
const PDF_CONFIG = {
  margin: 10,
  fontSize: 9,
  fontSizeSmall: 7,
  fontSizeTable: 6, // Smaller font for tables
  fontSizeTitle: 14,
  fontSizeSection: 10,
  lineHeight: 4,
  sectionSpacing: 4,
  tableRowHeight: 4,
  textColor: [0, 0, 0], // Black text
  headerFillColor: [200, 200, 200], // Darker grey for headers
  footerFillColor: [220, 220, 220] // Medium grey for footer/totals
};

const formatDate = (d, format = 'DD MMM YYYY') => (d ? dayjs(d).format(format) : '—');
const formatAmount = (value) => {
  const num = Number(value) || 0;
  return Math.abs(num).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

/**
 * Generate Resident Ledger Statement PDF
 * @param {Object} ledger - { resident, invoices, transactions }
 * @param {Object} options - { filename, openInNewTab }
 */
export const generateResidentLedgerPDF = async (ledger, options = {}) => {
  if (!ledger || !ledger.resident) return;

  const jsPDF = (await import('jspdf')).default;
  const { autoTable } = await import('jspdf-autotable');

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = PDF_CONFIG.margin;
  let y = margin;

  const resident = ledger.resident || {};
  const invoices = ledger.invoices || [];
  const transactions = ledger.transactions || [];

  const camInvoices = invoices.filter(inv => inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'CAM');
  const waterInvoices = invoices.filter(inv => inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'WATER');
  const electricityInvoices = invoices.filter(inv => inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'ELECTRICITY');
  const rentInvoices = invoices.filter(inv => inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'RENT');
  const otherInvoices = invoices.filter(inv => {
    const types = inv.chargeTypes || [];
    if (types.length === 0) return true;
    if (types.length > 1) return true;
    return !['CAM', 'WATER', 'ELECTRICITY', 'RENT'].includes(types[0]);
  });

  const contactStr = [resident.contactNumber, resident.email].filter(Boolean).join(' • ') || '—';
  const sectorVal = resident.properties?.[0]?.sector?.name ?? resident.properties?.[0]?.sector ?? '—';
  
  const totalOutstandingBalance = getLedgerTotalOutstandingBalance([
    camInvoices,
    waterInvoices,
    electricityInvoices,
    rentInvoices,
    otherInvoices
  ]);


  // Set default text color
  pdf.setTextColor(...PDF_CONFIG.textColor);

  // Title
  pdf.setFontSize(PDF_CONFIG.fontSizeTitle);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Resident Ledger', margin, y);
  y += 5;

  pdf.setFontSize(PDF_CONFIG.fontSizeSmall);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Generated on ${dayjs().format('DD MMM YYYY, hh:mm A')}`, margin, y);
  y += PDF_CONFIG.sectionSpacing;

  // Resident Information box
  pdf.setDrawColor(100, 100, 100);
  pdf.setLineWidth(0.5);
  const infoBoxHeight = 30;
  pdf.rect(margin, y, pageWidth - 2 * margin, infoBoxHeight);
  pdf.setFontSize(PDF_CONFIG.fontSizeSection);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Resident Information', margin + 2, y + 5);
  
  // Use vertical layout: label on top, value below
  pdf.setFontSize(PDF_CONFIG.fontSizeSmall);
  const col1 = margin + 2;
  const col2 = margin + 28;
  const col3 = margin + 68;
  const col4 = margin + 108;
  const col5 = margin + 148;
  
  let rowY = y + 10;
  
  // Row 1: Resident ID, CNIC, Contact, Sector, Balance
  pdf.setFont('helvetica', 'bold');
  pdf.text('Resident ID', col1, rowY);
  pdf.text('CNIC', col2, rowY);
  pdf.text('Contact', col3, rowY);
  pdf.text('Sector', col4, rowY);
  pdf.text('Balance', col5, rowY);
  
  rowY += 3.5;
  pdf.setFont('helvetica', 'normal');
  pdf.text(String(resident.residentId || '—').substring(0, 12), col1, rowY);
  pdf.text(String(resident.cnic || '—').substring(0, 18), col2, rowY);
  pdf.text(String(contactStr).substring(0, 18), col3, rowY);
  pdf.text(String(sectorVal).substring(0, 18), col4, rowY);
  pdf.text(`PKR ${formatAmount(totalOutstandingBalance)}`, col5, rowY);
  
  // Row 2: Name, Address (full width for these longer fields)
  rowY += 6.5;
  pdf.setFont('helvetica', 'bold');
  pdf.text('Name', col1, rowY);
  pdf.text('Address', pageWidth / 2, rowY);
  
  rowY += 3.5;
  pdf.setFont('helvetica', 'normal');
  pdf.text(String(resident.name || '—').substring(0, 45), col1, rowY);
  pdf.text(String(resident.address || '—').substring(0, 65), pageWidth / 2, rowY);

  y += infoBoxHeight + PDF_CONFIG.sectionSpacing;

  const invoiceTableHead = [['Invoice Date', 'Invoice No', 'Due Date', 'Period From', 'Period To', 'Invoice Amount', 'Arrears', 'Amount Due', 'Balance']];

  const addInvoiceTable = (sectionTitle, list) => {
    pdf.setFontSize(PDF_CONFIG.fontSizeSection);
    pdf.setFont('helvetica', 'bold');
    pdf.text(sectionTitle, margin, y);
    y += 4;

    const displayRows = buildLedgerSectionDisplayRows(list);
    const body = displayRows.length === 0
      ? [['No records', '', '', '', '', '', '', '', '']]
      : displayRows.map((row) => [
          formatDate(row.inv.invoiceDate),
          String(row.inv.invoiceNumber || '—'),
          formatDate(row.inv.dueDate),
          row.inv.periodFrom ? formatDate(row.inv.periodFrom, 'DD MMM YY') : '—',
          row.inv.periodTo ? formatDate(row.inv.periodTo, 'DD MMM YY') : '—',
          formatAmount(row.invoiceAmount),
          row.arrears != null ? formatAmount(row.arrears) : '—',
          formatAmount(row.amountDue),
          formatAmount(row.balance)
        ]);

    // Calculate totals
    let foot = [];
    if (displayRows.length > 0) {
      const totalInvoiceAmount = displayRows.reduce((sum, r) => sum + r.invoiceAmount, 0);
      const totalArrears = displayRows.reduce((sum, r) => sum + (r.arrears || 0), 0);
      const totalAmountDue = displayRows.reduce((sum, r) => sum + r.amountDue, 0);
      const totalBalance = displayRows.reduce((sum, r) => sum + r.balance, 0);
      
      foot = [[
        '', '', '', '', 'Total:',
        formatAmount(totalInvoiceAmount),
        formatAmount(totalArrears),
        formatAmount(totalAmountDue),
        formatAmount(totalBalance)
      ]];
    }

    autoTable(pdf, {
      startY: y,
      head: invoiceTableHead,
      body,
      foot,
      // Grand total only at the end of the table — autotable's default ('everyPage') repeats it
      // on every page, which reads as a wrong page-1 total when a section spills onto page 2.
      showFoot: 'lastPage',
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { 
        fontSize: PDF_CONFIG.fontSizeTable,
        textColor: PDF_CONFIG.textColor,
        lineColor: [100, 100, 100],
        lineWidth: 0.2,
        cellPadding: 1.5
      },
      headStyles: { 
        fillColor: PDF_CONFIG.headerFillColor, 
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        fontSize: PDF_CONFIG.fontSizeTable
      },
      footStyles: { 
        fillColor: PDF_CONFIG.footerFillColor, 
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        fontSize: PDF_CONFIG.fontSizeTable
      },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 30 },
        2: { cellWidth: 20 },
        3: { cellWidth: 18 },
        4: { cellWidth: 18 },
        5: { cellWidth: 21, halign: 'right' },
        6: { cellWidth: 17, halign: 'right' },
        7: { cellWidth: 23, halign: 'right' },
        8: { cellWidth: 23, halign: 'right' }
      }
    });
    y = pdf.lastAutoTable.finalY + PDF_CONFIG.sectionSpacing;
  };

  addInvoiceTable('CAM Charges', camInvoices);
  addInvoiceTable('Water Bills', waterInvoices);
  addInvoiceTable('Electricity Bill', electricityInvoices);
  addInvoiceTable('Rental Management', rentInvoices);
  if (otherInvoices.length > 0) {
    addInvoiceTable('Other / Mixed', otherInvoices);
  }

  // Transactions (only deposits)
  const depositTransactions = transactions.filter(t => t.transactionType === 'deposit');
  
  pdf.setFontSize(PDF_CONFIG.fontSizeSection);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Transactions', margin, y);
  y += 4;

  const txnHead = [['Date', 'Type', 'Description', 'Amount', 'Ref']];
  const txnBody = depositTransactions.length === 0
    ? [['No transactions', '', '', '', '']]
    : depositTransactions.map(t => {
        const diff = (t.balanceAfter ?? 0) - (t.balanceBefore ?? 0);
        const sign = diff >= 0 ? '+' : '-';
        const typeLabel = (t.transactionType || '').replace('_', ' ');
        return [
          formatDate(t.createdAt),
          typeLabel,
          String(t.description || '—').substring(0, 35),
          `${sign} ${formatAmount(t.amount)}`,
          String(t.referenceNumberExternal || t.referenceNumber || '—').substring(0, 18)
        ];
      });

  autoTable(pdf, {
    startY: y,
    head: txnHead,
    body: txnBody,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { 
      fontSize: PDF_CONFIG.fontSizeSmall,
      textColor: PDF_CONFIG.textColor,
      lineColor: [100, 100, 100],
      lineWidth: 0.2,
      cellPadding: 1.5
    },
    headStyles: { 
      fillColor: PDF_CONFIG.headerFillColor, 
      fontStyle: 'bold',
      textColor: [0, 0, 0]
    },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 22 },
      2: { cellWidth: 55 },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 35 }
    }
  });

  const filename = options.filename || `Resident-Ledger-${resident.residentId || resident._id}-${dayjs().format('YYYY-MM-DD')}.pdf`;
  if (options.openInNewTab) {
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    pdf.save(filename);
  }
};

export default generateResidentLedgerPDF;
