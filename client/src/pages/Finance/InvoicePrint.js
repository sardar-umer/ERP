import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { Print as PrintIcon, ArrowBack as BackIcon, Download as DownloadIcon } from '@mui/icons-material';
import api from '../../services/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import { useAuth } from '../../contexts/AuthContext';
import { numberToWords } from '../../utils/numberToWords';
import { getImageUrl } from '../../utils/imageService';

const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtNum = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n) => Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 3 });
const fmtShortDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '');
const fmtDateTime = (d) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const personName = (u) => (u && typeof u === 'object' ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '' : '');
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const formatAddress = (a) => {
  if (!a) return '';
  if (typeof a === 'string') return a;
  return [a.street, a.city, a.state, a.zipCode, a.country].filter(Boolean).join(', ');
};
const STATUS_LABEL = { draft: 'DRAFT', pending: 'UNPAID', sent: 'UNPAID', approved: 'APPROVED', paid: 'PAID', partial: 'PARTIALLY PAID', overdue: 'OVERDUE', cancelled: 'CANCELLED' };
const PAYMENT_TERMS = { net_15: 'Net 15 days', net_30: 'Net 30 days', net_45: 'Net 45 days', net_60: 'Net 60 days', due_on_receipt: 'Due on receipt', cash: 'Cash', credit: 'Credit' };

const DEFAULT_COMPANY = {
  name: 'SGC International',
  phone: '',
  address: '',
  city: '',
  website: 'www.sgc.com',
  ntn: '',
  strn: '',
  logoUrl: '',
  invoiceFooter: ''
};

const pickStr = (...vals) => {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
};

/**
 * Letterhead priority:
 * 1) Invoice companyId (finance company the AR belongs to)
 * 2) Currently selected finance company
 * 3) Global company profile (NTN/STRN/logo/footer)
 * 4) SGC defaults
 */
const resolveCompanyLetterhead = (invoiceCompany, selectedCompany, profile = {}) => {
  const invCo = invoiceCompany && typeof invoiceCompany === 'object' ? invoiceCompany : null;
  const selCo = selectedCompany && typeof selectedCompany === 'object' ? selectedCompany : null;
  const invContact = invCo?.contactInfo || {};
  const selContact = selCo?.contactInfo || {};

  return {
    name: pickStr(invCo?.name, selCo?.name, profile.name, DEFAULT_COMPANY.name),
    legalName: invCo || selCo ? '' : pickStr(profile.legalName),
    email: pickStr(invContact.email, selContact.email, profile.email),
    phone: pickStr(invContact.phone, selContact.phone, profile.phone),
    address: pickStr(invContact.address, selContact.address, profile.address),
    city: pickStr(profile.city),
    website: 'www.sgc.com',
    ntn: pickStr(profile.ntn),
    strn: pickStr(profile.strn),
    logoUrl: pickStr(profile.logoUrl),
    invoiceFooter: pickStr(profile.invoiceFooter),
    bankName: pickStr(profile.bankName),
    bankBranchName: pickStr(profile.bankBranchName),
    bankAccount: pickStr(profile.bankAccount),
    bankIBAN: pickStr(profile.bankIBAN)
  };
};

export default function InvoicePrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const printRef = useRef();
  const { selectedCompany, companies } = useFinanceCompany();
  const { user } = useAuth();
  // ?autoprint=1: opened in a hidden frame from AR Invoices — open the print preview as soon as it is drawn
  const [searchParams] = useSearchParams();
  const autoPrint = searchParams.get('autoprint') === '1';

  const [invoice, setInvoice] = useState(null);
  const [profile, setProfile] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [invRes, cpRes] = await Promise.all([
          api.get(`/finance/accounts-receivable/${id}`),
          api.get('/finance/company-profile').catch(() => ({ data: { data: {} } }))
        ]);
        setInvoice(invRes.data.data || invRes.data);
        setProfile(cpRes.data?.data || {});
      } catch (e) {
        setError(e.response?.data?.message || 'Invoice not found');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const invoiceCompany = useMemo(() => {
    const raw = invoice?.companyId;
    if (raw && typeof raw === 'object' && raw.name) return raw;
    const idStr = raw?._id || raw;
    if (!idStr) return null;
    return companies.find((c) => String(c._id) === String(idStr)) || null;
  }, [invoice, companies]);

  const company = useMemo(
    () => resolveCompanyLetterhead(invoiceCompany, selectedCompany, profile),
    [invoiceCompany, selectedCompany, profile]
  );

  useEffect(() => {
    if (!autoPrint || loading || !invoice) return undefined;
    const timer = setTimeout(async () => {
      const images = Array.from(document.images || []).filter((img) => !img.complete);
      await Promise.all(images.map((img) => new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      })));
      window.print();
    }, 300);
    return () => clearTimeout(timer);
  }, [autoPrint, loading, invoice]);

  const handleDownloadPDF = () => {
    if (!invoice) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const co = company;
    // Header
    doc.setFillColor(25, 118, 210);
    doc.rect(0, 0, 210, 34, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text(co.name, 14, 12);
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text('Invoice', 14, 20);
    doc.setFontSize(8);
    doc.text('www.sgc.com', 14, 26);
    if (co.ntn) doc.text(`NTN: ${co.ntn}`, 14, 31);
    if (co.strn) doc.text(`STRN: ${co.strn}`, 60, 31);
    doc.setFontSize(10);
    doc.text(invoice.invoiceNumber, 196, 12, { align: 'right' });
    doc.text(`Status: ${invoice.status?.toUpperCase()}`, 196, 20, { align: 'right' });

    // Bill To / Invoice Info
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(9);
    let y = 42;
    doc.setFont('helvetica', 'bold'); doc.text('BILL TO:', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.customer?.name || '—', 14, y + 5);
    if (invoice.customer?.email) doc.text(invoice.customer.email, 14, y + 10);
    if (invoice.customer?.phone) doc.text(invoice.customer.phone, 14, y + 15);
    if (invoice.customer?.address) doc.text(invoice.customer.address, 14, y + 20);

    doc.setFont('helvetica', 'bold'); doc.text('INVOICE DETAILS:', 130, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`Invoice #: ${invoice.invoiceNumber}`, 130, y + 5);
    doc.text(`Date: ${fmtDate(invoice.invoiceDate)}`, 130, y + 10);
    doc.text(`Due Date: ${fmtDate(invoice.dueDate)}`, 130, y + 15);
    if (invoice.department) doc.text(`Dept: ${invoice.department}`, 130, y + 20);
    const ccLabel = invoice.costCenter
      ? (typeof invoice.costCenter === 'object'
        ? [invoice.costCenter.code, invoice.costCenter.name].filter(Boolean).join(' — ')
        : String(invoice.costCenter))
      : '';
    if (ccLabel) doc.text(`Cost Center: ${ccLabel}`, 130, y + 25);

    y += 30;
    doc.setDrawColor(200, 200, 200); doc.line(14, y, 196, y);
    y += 4;

    // Line items table
    const hasItems = invoice.lineItems && invoice.lineItems.length > 0;
    autoTable(doc, {
      startY: y,
      head: hasItems
        ? [['#', 'Description', 'Qty', 'Unit Price', 'Tax', 'Amount']]
        : [['Description', 'Amount']],
      body: hasItems
        ? invoice.lineItems.map((it, i) => [
            i + 1,
            it.description || it.itemName || '',
            it.quantity || 1,
            fmt(it.unitPrice || 0),
            it.taxRate ? `${it.taxRate}%` : '—',
            fmt(it.amount || 0)
          ])
        : [['Invoice Amount', fmt(invoice.totalAmount)]],
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      headStyles: { fillColor: [25, 118, 210], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      columnStyles: hasItems
        ? { 0: { halign: 'center', cellWidth: 10 }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'center' }, 5: { halign: 'right' } }
        : { 1: { halign: 'right' } },
    });

    y = doc.lastAutoTable.finalY + 6;

    // Totals
    const totalsX = 130;
    const drawRow = (label, value, bold) => {
      if (bold) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); }
      else { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); }
      doc.text(label, totalsX, y);
      doc.text(value, 196, y, { align: 'right' });
      y += 6;
    };

    if (invoice.subtotal) drawRow('Subtotal:', fmt(invoice.subtotal));
    if (invoice.taxAmount) drawRow('Tax:', fmt(invoice.taxAmount));
    doc.setDrawColor(180); doc.line(totalsX, y - 2, 196, y - 2);
    drawRow('Total:', fmt(invoice.totalAmount), true);
    drawRow('Paid:', fmt(invoice.amountPaid || invoice.paidAmount || 0));
    doc.setTextColor(invoice.balanceDue > 0 ? 198 : 46, invoice.balanceDue > 0 ? 40 : 125, invoice.balanceDue > 0 ? 40 : 50);
    drawRow('Balance Due:', fmt(invoice.balanceDue || (invoice.totalAmount - (invoice.amountPaid || invoice.paidAmount || 0))), true);
    doc.setTextColor(40, 40, 40);

    // Footer
    if (invoice.notes) {
      y += 4;
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.text('Notes:', 14, y);
      doc.setFont('helvetica', 'normal'); doc.text(invoice.notes, 14, y + 5);
    }

    y = 275;
    doc.setFontSize(8); doc.setTextColor(140);
    const footerText = co.invoiceFooter || `Thank you for your business — ${co.name}`;
    doc.text(footerText, 105, y, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.text('www.sgc.com', 105, y + 5, { align: 'center' });

    doc.save(`Invoice-${invoice.invoiceNumber}.pdf`);
  };

  if (loading) return <Box display="flex" justifyContent="center" py={10}><CircularProgress /></Box>;
  if (error)   return <Box p={3}><Alert severity="error">{error}</Alert></Box>;
  if (!invoice) return null;

  const paid = Number(invoice.amountPaid || invoice.paidAmount || 0);
  const balance = invoice.balanceDue ?? (invoice.totalAmount - paid);
  const lines = (invoice.lineItems || []).map((it) => {
    const qty = Number(it.quantity) || 1;
    const rate = Number(it.unitPrice) || 0;
    const gross = round2(qty * rate) || round2(it.amount);
    const tax = round2(it.taxAmount ?? (gross * (Number(it.taxRate) || 0)) / 100);
    return {
      description: it.description || it.itemName || '—',
      account: it.account && typeof it.account === 'object' ? it.account.name : '',
      qty,
      rate,
      gross,
      taxRate: Number(it.taxRate) || 0,
      tax,
      net: round2(gross + tax)
    };
  });
  const totalQty = lines.reduce((t, l) => t + l.qty, 0);
  const totalGross = lines.length ? round2(lines.reduce((t, l) => t + l.gross, 0)) : round2(invoice.subtotal || invoice.totalAmount);
  const totalTax = lines.length ? round2(lines.reduce((t, l) => t + l.tax, 0)) : round2(invoice.taxAmount);
  const netTotal = round2(invoice.totalAmount ?? totalGross + totalTax);
  const hasTax = totalTax > 0;
  const customer = invoice.customer || {};
  const customerAddress = formatAddress(customer.address);
  const costCenter = invoice.costCenter
    ? (typeof invoice.costCenter === 'object'
      ? [invoice.costCenter.code, invoice.costCenter.name].filter(Boolean).join(' — ')
      : String(invoice.costCenter))
    : '';
  const createdByName = personName(invoice.createdBy);
  const printedBy = personName(user);
  const statusLabel = STATUS_LABEL[invoice.status] || String(invoice.status || '').toUpperCase();
  const leftInfo = [
    ['Invoice # :', invoice.invoiceNumber, true],
    ['Customer :', customer.name || invoice.customerName || '—', true],
    ['Address :', customerAddress],
    ['Phone :', customer.phone],
    ['Email :', customer.email],
    ['Department :', invoice.department],
    ['CNIC :', customer.cnic]
  ].filter(([, v]) => v);
  const rightInfo = [
    ['Invoice Date :', fmtShortDate(invoice.invoiceDate), true],
    ['Due Date :', fmtShortDate(invoice.dueDate)],
    ['NTN :', customer.ntn],
    ['STRN :', customer.strn],
    ['Payment :', PAYMENT_TERMS[invoice.paymentTerms] || invoice.paymentTerms],
    ['Cost Center :', costCenter],
    ['Reference :', invoice.referenceNumber]
  ].filter(([, v]) => v);
  const cellSx = { border: '1px solid #111', px: 0.75, py: 0.6, fontSize: 12, color: '#111', lineHeight: 1.3 };
  const headSx = { ...cellSx, fontWeight: 700, textAlign: 'center', bgcolor: '#fff' };
  const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

  return (
    <Box>
      {/* Action bar — hidden when printing */}
      <Box sx={{ p: 2, bgcolor: 'grey.100', display: 'flex', gap: 1, justifyContent: 'space-between', alignItems: 'center', '@media print': { display: 'none' } }}>
        <Button startIcon={<BackIcon />} onClick={() => navigate(-1)}>Back</Button>
        <Box display="flex" gap={1}>
          <Button variant="outlined" color="error" startIcon={<DownloadIcon />} onClick={handleDownloadPDF}>Download PDF</Button>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
        </Box>
      </Box>

      {/* Invoice document */}
      <Box ref={printRef} sx={{
        maxWidth: '210mm', mx: 'auto', my: 2, p: '12mm 12mm 10mm', bgcolor: 'white', color: '#111',
        boxShadow: '0 2px 10px rgba(0,0,0,0.08)', fontFamily: '"Calibri", "Segoe UI", Arial, sans-serif',
        '@media print': { maxWidth: '100%', m: 0, p: '6mm 8mm', boxShadow: 'none' }
      }}>
        {/* Letterhead: logo · company · printed info */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '120px 1fr 160px', alignItems: 'center', gap: 2 }}>
          <Box>
            {company.logoUrl ? (
              <Box component="img" src={company.logoUrl} alt={company.name} sx={{ maxWidth: 120, maxHeight: 90, objectFit: 'contain' }} />
            ) : (
              <Box sx={{ width: 72, height: 72, borderRadius: '50%', border: '2px solid #1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24, color: '#1e3a5f' }}>
                {initials(company.name)}
              </Box>
            )}
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2 }}>{company.legalName || company.name}</Typography>
            {(company.address || company.city) && (
              <Typography sx={{ fontSize: 13 }}>{[company.address, company.city].filter(Boolean).join(', ')}</Typography>
            )}
            {(company.phone || company.email) && (
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                {[company.phone && `PH : ${company.phone}`, company.email].filter(Boolean).join('  ·  ')}
              </Typography>
            )}
            {(company.ntn || company.strn) && (
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                {[company.ntn && `NTN: ${company.ntn}`, company.strn && `STRN: ${company.strn}`].filter(Boolean).join('  ')}
              </Typography>
            )}
          </Box>
          <Box sx={{ fontSize: 11.5, lineHeight: 1.6 }}>
            <div>Printed: {fmtDateTime(new Date())}</div>
            {printedBy && <div>By: {printedBy}</div>}
            {createdByName && <div>Prepared by: {createdByName}</div>}
          </Box>
        </Box>

        {/* Title + status */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', mt: 2, mb: 2 }}>
          <span />
          <Box sx={{ border: '1.5px solid #111', px: 6, py: 0.75 }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{hasTax ? 'Sales Tax / Sales Invoice' : 'Sales Invoice'}</Typography>
          </Box>
          <Box sx={{ justifySelf: 'end', border: '1.5px solid #111', borderRadius: 1, px: 2, py: 0.5, fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>
            {statusLabel}
          </Box>
        </Box>

        {/* Invoice / customer details */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', columnGap: 4, mb: 1.5 }}>
          {[leftInfo, rightInfo].map((rows, col) => (
            <Box key={col} component="table" sx={{ borderCollapse: 'collapse', fontSize: 13.5, alignSelf: 'start' }}>
              <tbody>
                {rows.map(([label, value, strong]) => (
                  <tr key={label}>
                    <Box component="td" sx={{ fontWeight: 700, pr: 2, py: 0.35, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{label}</Box>
                    <Box component="td" sx={{ py: 0.35, verticalAlign: 'top', fontWeight: strong ? 700 : 400, textDecoration: strong ? 'underline' : 'none' }}>{value}</Box>
                  </tr>
                ))}
              </tbody>
            </Box>
          ))}
        </Box>

        {/* Line items */}
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', borderTop: '2px solid #111', borderBottom: '2px solid #111' }}>
          <thead>
            <tr>
              <Box component="th" sx={{ ...headSx, width: 36 }}>Sr.<br />No</Box>
              <Box component="th" sx={{ ...headSx, textAlign: 'left' }}>Description</Box>
              <Box component="th" sx={{ ...headSx, width: 55 }}>Qty.</Box>
              <Box component="th" sx={{ ...headSx, width: 85 }}>Rate</Box>
              <Box component="th" sx={{ ...headSx, width: 95 }}>Gross</Box>
              {hasTax && <Box component="th" sx={{ ...headSx, width: 50 }}>Tax %</Box>}
              {hasTax && <Box component="th" sx={{ ...headSx, width: 85 }}>Sales<br />Tax</Box>}
              <Box component="th" sx={{ ...headSx, width: 100 }}>Net<br />Amount</Box>
            </tr>
          </thead>
          <tbody>
            {(lines.length ? lines : [{ description: 'Invoice amount', qty: 1, rate: netTotal, gross: netTotal, taxRate: 0, tax: 0, net: netTotal }]).map((l, i) => (
              <tr key={i}>
                <Box component="td" sx={{ ...cellSx, textAlign: 'center', borderTop: 0, borderBottom: '1px dotted #999' }}>{i + 1}</Box>
                <Box component="td" sx={{ ...cellSx, borderTop: 0, borderBottom: '1px dotted #999' }}>
                  {l.description}
                  {l.account && l.account !== l.description && <Box component="span" sx={{ color: '#555' }}> · {l.account}</Box>}
                </Box>
                <Box component="td" sx={{ ...cellSx, ...num, borderTop: 0, borderBottom: '1px dotted #999' }}>{fmtQty(l.qty)}</Box>
                <Box component="td" sx={{ ...cellSx, ...num, borderTop: 0, borderBottom: '1px dotted #999' }}>{fmtNum(l.rate)}</Box>
                <Box component="td" sx={{ ...cellSx, ...num, borderTop: 0, borderBottom: '1px dotted #999' }}>{fmtNum(l.gross)}</Box>
                {hasTax && <Box component="td" sx={{ ...cellSx, ...num, borderTop: 0, borderBottom: '1px dotted #999' }}>{l.taxRate ? `${l.taxRate}` : '-'}</Box>}
                {hasTax && <Box component="td" sx={{ ...cellSx, ...num, borderTop: 0, borderBottom: '1px dotted #999' }}>{l.tax ? fmtNum(l.tax) : '-'}</Box>}
                <Box component="td" sx={{ ...cellSx, ...num, borderTop: 0, borderBottom: '1px dotted #999' }}>{fmtNum(l.net)}</Box>
              </tr>
            ))}
            <tr>
              <Box component="td" colSpan={2} sx={{ ...cellSx, fontWeight: 700, textAlign: 'center', borderTop: '2px solid #111' }}>GRAND TOTAL :</Box>
              <Box component="td" sx={{ ...cellSx, ...num, fontWeight: 700, borderTop: '2px solid #111' }}>{lines.length ? fmtQty(totalQty) : '-'}</Box>
              <Box component="td" sx={{ ...cellSx, borderTop: '2px solid #111' }} />
              <Box component="td" sx={{ ...cellSx, ...num, fontWeight: 700, borderTop: '2px solid #111' }}>{fmtNum(totalGross)}</Box>
              {hasTax && <Box component="td" sx={{ ...cellSx, borderTop: '2px solid #111' }} />}
              {hasTax && <Box component="td" sx={{ ...cellSx, ...num, fontWeight: 700, borderTop: '2px solid #111' }}>{fmtNum(totalTax)}</Box>}
              <Box component="td" sx={{ ...cellSx, ...num, fontWeight: 700, borderTop: '2px solid #111' }}>{fmtNum(netTotal)}</Box>
            </tr>
          </tbody>
        </Box>

        {/* Amount in words + totals */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', columnGap: 3, mt: 3 }}>
          <Box>
            <Typography sx={{ fontSize: 13.5, borderBottom: '1.5px solid #111', pb: 0.5 }}>
              Amount in Word : <strong>{numberToWords(netTotal)}</strong>
            </Typography>
            {invoice.notes && (
              <Typography sx={{ fontSize: 12, mt: 1.5, whiteSpace: 'pre-wrap' }}>
                <strong>Notes:</strong> {invoice.notes}
              </Typography>
            )}
            {company.bankName && (
              <Typography sx={{ fontSize: 12, mt: 1.5, lineHeight: 1.5 }}>
                <strong>Bank details:</strong> {company.bankName}
                {company.bankBranchName ? `, ${company.bankBranchName}` : ''}
                {company.bankAccount ? ` · A/C ${company.bankAccount}` : ''}
                {company.bankIBAN ? ` · IBAN ${company.bankIBAN}` : ''}
              </Typography>
            )}
            {company.invoiceFooter && (
              <Typography sx={{ fontSize: 11.5, mt: 1.5, color: '#333', textAlign: 'justify', whiteSpace: 'pre-wrap' }}>
                {company.invoiceFooter}
              </Typography>
            )}
          </Box>
          <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 14, alignSelf: 'start', width: '100%' }}>
            <tbody>
              {[
                ['Total Amount :', totalGross],
                ...(hasTax ? [['Sales Tax :', totalTax]] : []),
                ['Net Total', netTotal, true],
                ...(paid > 0 ? [['Amount Received :', paid], ['Balance Due', balance, true]] : [])
              ].map(([label, value, strong], i, all) => (
                <tr key={label}>
                  <Box component="td" sx={{ fontWeight: 700, py: 0.75, pl: 1, borderRight: '1.5px solid #111', borderTop: strong ? '1.5px solid #111' : 0, borderBottom: i === all.length - 1 ? 0 : undefined }}>{label}</Box>
                  <Box component="td" sx={{ ...num, py: 0.75, pr: 1, fontWeight: strong ? 800 : 400, borderTop: strong ? '1.5px solid #111' : 0 }}>{fmtNum(value)}</Box>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>

        {/* Signatures */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12, mt: 7, alignItems: 'end' }}>
          <Box sx={{ borderTop: '1.5px solid #111', pt: 0.75, textAlign: 'center', fontSize: 13 }}>Customer signature / stamp</Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>{company.legalName || company.name}</Typography>
            {invoice.createdBy?.digitalSignature && (
              <Box component="img" src={getImageUrl(invoice.createdBy.digitalSignature)} alt="Signature" sx={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain', mb: 0.5 }} />
            )}
            <Box sx={{ borderTop: '1.5px solid #111', pt: 0.75, fontSize: 13 }}>For {company.legalName || company.name}</Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
