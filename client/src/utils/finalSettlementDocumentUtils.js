import jsPDF from 'jspdf';
import { getCalendarDaysInMonth, resolveSettlementRateDate } from './finalSettlementDays';
import { numberToWords } from './numberToWords';
import { getImageUrl } from './imageService';

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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Salary for October 2026" — label of a month salary paid through the settlement */
export const monthSalaryLabel = (row) => `Salary for ${MONTH_NAMES[Number(row?.month) - 1] || `Month ${row?.month}`} ${row?.year || ''}`.trim();

/** Month salary lines with an amount, oldest month first */
export const monthSalaryRows = (settlement) => (settlement?.monthSalaries || [])
  .filter((row) => Number(row.amount) > 0)
  .slice()
  .sort((a, b) => (a.year - b.year) || (a.month - b.month));

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
    // Salary of another month paid here: Standard = the full monthly gross (same as the Gross Salary line),
    // Actual = the amount HR typed
    ...monthSalaryRows(settlement).map((row) => [
      monthSalaryLabel(row),
      standardOf('basicSalary') || Number(row.amount),
      Number(row.amount)
    ]),
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

  // ---- Employee block: two columns of "Label : Value", labels / colons / values each on one line-up
  const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim() || '—';
  const leftCol = { label: L, colon: L + 33, value: L + 36, end: W / 2 - 4 };
  const rightCol = { label: W / 2 + 6, colon: W / 2 + 33, value: W / 2 + 36, end: R };
  const infoCell = (col, y, label, value) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(label, col.label, y);
    doc.text(':', col.colon, y);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(cleanText(value), col.end - col.value).slice(0, 2);
    doc.text(lines, col.value, y);
    return lines.length;
  };
  const employeeCode = cleanText(settlement.employeeId || emp.employeeId || '');
  const left = [
    ['Employee', [employeeCode !== '—' ? employeeCode : '', name].filter(Boolean).join(' - ')],
    ["Father's Name", emp.guardianName],
    ['Designation', settlement.designation !== 'Unknown' ? settlement.designation : emp.placementDesignation?.title],
    ['Service Period', `${fmtDate(joined)} to ${fmtDate(settlement.lastWorkingDate)}`],
    ['Confirmation Status', emp.confirmationDate ? (confirmed ? 'Permanent' : 'Probation') : emp.employmentStatus],
    ['CNIC #', emp.idCard]
  ];
  const right = [
    ['Section', emp.placementSection?.name],
    ['Department', settlement.department !== 'Unknown' ? settlement.department : emp.placementDepartment?.name],
    ['Project', emp.placementProject?.name],
    ['Salary Period', `Up to ${fmtDate(settlement.lastWorkingDate)}`],
    ['Settlement Type', String(settlement.settlementType || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())],
    ['Address', addressText(emp.address)]
  ];
  // Same row on both sides shares one baseline; a wrapped value pushes the whole row down
  let y = 39;
  left.forEach(([label, value], i) => {
    const leftLines = infoCell(leftCol, y, label, value);
    const rightLines = right[i] ? infoCell(rightCol, y, right[i][0], right[i][1]) : 1;
    y += 6.2 + (Math.max(leftLines, rightLines) - 1) * 3.6;
  });
  y += 2;

  // ---- Columns
  const cols = {
    allowance: L, standard: L + 64, actual: L + 86, deduction: L + 92, dedActual: L + 138, nonSalary: L + 146, nonActual: R
  };
  // Rules are thin and grey so they frame the figures without overpowering them
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.2);
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

  // ---- Totals: one thin rule above and one below
  const ty = rowsTop + rowCount * rowH;
  const totalCell = (xRight, width, value) => {
    doc.setLineWidth(0.2);
    doc.line(xRight - width, ty - 2.6, xRight, ty - 2.6);
    doc.setFont('helvetica', 'bold');
    doc.text(amt(value), xRight, ty + 2, { align: 'right' });
    doc.line(xRight - width, ty + 4, xRight, ty + 4);
  };
  doc.setFont('helvetica', 'bold');
  doc.text('Total', cols.allowance, ty + 2);
  totalCell(cols.standard, 20, totalStandard);
  totalCell(cols.actual, 20, totalActual);
  totalCell(cols.dedActual, 20, totalDeductions);
  totalCell(cols.nonActual, 20, totalNonSalary);

  // ---- Net payable (right, in line with the amount columns) with the amount in words
  const ny = ty + 17;
  const boxW = 40;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Net Payable', R - boxW - 4, ny, { align: 'right' });
  doc.setLineWidth(0.25);
  doc.rect(R - boxW, ny - 5.6, boxW, 8.6);
  doc.text(amt(netPayable), R - 3, ny, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Amount in words: ${numberToWords(Math.round(netPayable))}`, R, ny + 8.5, { align: 'right' });

  // ---- Receipt statement across the page
  const receiptY = ny + 24;
  doc.setLineWidth(0.2);
  doc.line(L, receiptY - 7, R, receiptY - 7);
  const receipt = `I, ${name}, have received Rs. ${amt(netPayable)} against the full and final settlement of my dues.`;
  const receiptLines = doc.splitTextToSize(receipt, R - L);
  doc.text(receiptLines, L, receiptY);

  // ---- Signatures: four across the page, a line with the title under it
  const signY = receiptY + receiptLines.length * 4 + 26;
  const signTitles = ['Prepared By', 'Verified By', 'Approved By', 'Employee Signature'];
  const slotW = (R - L) / signTitles.length;
  doc.setFont('helvetica', 'bold');
  signTitles.forEach((title, i) => {
    const center = L + slotW * i + slotW / 2;
    doc.line(center - 17, signY, center + 17, signY);
    doc.text(title, center, signY + 4.5, { align: 'center' });
  });

  // ---- Footer
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(60, 60, 60);
  doc.text('Tovus ERP', W / 2, H - 10, { align: 'center' });

  return doc;
};

export const downloadFinalSettlementPdf = (settlement, company = {}) => {
  const doc = generateFinalSettlementPdf(settlement, company);
  const fileName = `final-dues-${settlement.employeeId || 'record'}-${new Date(settlement.settlementDate || Date.now()).toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
};

// ───────────────────────── Attachments in the printed copy ─────────────────────────
// Each attachment goes on its own page after the Final Dues page: an image fills one page, a PDF gets
// one page per PDF page, and other files (Word / Excel) get a page naming the file.

const isImageDoc = (d) => /^image\//i.test(d.mimeType || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(d.filePath || d.name || '');
const isPdfDoc = (d) => /pdf/i.test(d.mimeType || '') || /\.pdf$/i.test(d.filePath || d.name || '');

/** Canvas → JPEG picture on a white background (keeps the print file small) */
const canvasPicture = (source, width, height) => {
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: canvas.width, height: canvas.height };
};

const loadImagePicture = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      resolve(canvasPicture(img, img.naturalWidth, img.naturalHeight));
    } catch (e) {
      reject(e);
    }
  };
  img.onerror = () => reject(new Error('Could not load the image'));
  img.src = url;
});

/** PDF → one picture per page (drawn with PDF.js, same as the Finance bill print) */
const loadPdfPictures = async (url) => {
  const pdfjs = await import('pdfjs-dist/build/pdf');
  await import('pdfjs-dist/build/pdf.worker.entry');
  const pdf = await pdfjs.getDocument({ url, withCredentials: false }).promise;
  const pictures = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pictures.push(canvasPicture(canvas, canvas.width, canvas.height));
  }
  return pictures;
};

/** Settlement documents → [{ name, pictures: [{ dataUrl, width, height }], note }] ready to be put on pages */
const loadSettlementAttachments = async (documents = []) => Promise.all(
  (documents || []).filter((d) => d && d.filePath).map(async (d) => {
    const name = d.name || 'Attachment';
    const url = getImageUrl(d.filePath);
    try {
      if (isImageDoc(d)) return { name, pictures: [await loadImagePicture(url)] };
      if (isPdfDoc(d)) return { name, pictures: await loadPdfPictures(url) };
      return { name, pictures: [], note: 'This file type cannot be printed here. Open it from the settlement and print it separately.' };
    } catch (e) {
      return { name, pictures: [], note: `This attachment could not be opened for printing (${e?.message || 'unknown error'}).` };
    }
  })
);

/** Add the attachment pages to the Final Dues PDF — one picture per A4 page, fitted inside the margins */
export const addAttachmentPages = (doc, attachments = []) => {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 12;
  const top = 20;
  const total = attachments.length;
  attachments.forEach((attachment, index) => {
    const pages = attachment.pictures?.length ? attachment.pictures : [null];
    pages.forEach((picture, part) => {
      doc.addPage('a4', 'portrait');
      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      const partLabel = pages.length > 1 ? ` (page ${part + 1} of ${pages.length})` : '';
      const title = doc.splitTextToSize(`Attachment ${index + 1} of ${total} - ${attachment.name}${partLabel}`, W - margin * 2)[0];
      doc.text(title, margin, 13);
      if (!picture) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.text(doc.splitTextToSize(attachment.note || 'This attachment has nothing to print.', W - margin * 2), margin, top + 6);
        return;
      }
      const boxW = W - margin * 2;
      const boxH = H - top - margin;
      const ratio = Math.min(boxW / picture.width, boxH / picture.height);
      const w = picture.width * ratio;
      const h = picture.height * ratio;
      doc.addImage(picture.dataUrl, 'JPEG', (W - w) / 2, top, w, h);
    });
  });
  return doc;
};

/**
 * Print the Final Dues page; when the settlement has attachments they follow it, each on its own page.
 * The print tab is opened straight away (browsers block a tab opened after waiting for files to load).
 */
export const printFinalSettlementPdf = async (settlement, company = {}) => {
  const doc = generateFinalSettlementPdf(settlement, company);
  const documents = (settlement.documents || []).filter((d) => d && d.filePath);

  if (!documents.length) {
    const printWindow = window.open(doc.output('bloburl'), '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
      };
    }
    return { attachments: 0, notPrinted: [] };
  }

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.title = 'Final Dues';
    printWindow.document.body.innerHTML =
      '<p style="font-family: Arial, sans-serif; padding: 24px;">Preparing the Final Dues and its attachments for printing…</p>';
  }
  const attachments = await loadSettlementAttachments(documents);
  addAttachmentPages(doc, attachments);
  const blobUrl = doc.output('bloburl');
  if (printWindow && !printWindow.closed) {
    printWindow.location.replace(blobUrl);
    // The PDF viewer needs a moment to load before the print dialog can open
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (e) {
        // The tab still shows the PDF; it can be printed from the viewer
      }
    }, 1200);
  } else {
    window.open(blobUrl, '_blank');
  }
  return {
    attachments: attachments.length,
    notPrinted: attachments.filter((a) => !a.pictures?.length).map((a) => a.name)
  };
};
