import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box, Paper, Typography, Button, Alert, CircularProgress, Chip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import {
  ArrowBack as BackIcon, Print as PrintIcon, AttachFile as AttachFileIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { getImageUrl } from '../../utils/imageService';

/**
 * Document-style view of a vendor bill raised from GRN(s), laid out like the Centralized Store
 * bill: title, bill particulars, item table, totals and the authority / signature table, with Print.
 */

const formatDateTime = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleString('en-PK', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};
const formatDateDmy = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
};
const formatTime12h = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};
const formatAmount = (amount) => new Intl.NumberFormat('en-PK', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(amount || 0));
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const TERMS_LABEL = {
  due_on_receipt: 'Due on receipt', net_15: 'Net 15', net_30: 'Net 30', net_45: 'Net 45', net_60: 'Net 60', custom: 'Custom'
};

const statusLabel = (bill) => {
  if (!bill) return '';
  if (bill.status === 'cancelled') return 'Voided';
  if (bill.status === 'Returned from Audit') return 'Rejected by Audit';
  const approver = bill.approval?.approverName || 'approval authority';
  if (bill.approval?.status === 'Submitted') return `Pending approval — ${approver}`;
  if (bill.approval?.status === 'Rejected') return `Rejected by ${approver}`;
  if (bill.status === 'approved') return 'Approved by Audit';
  return bill.status || 'Draft';
};
const statusColor = (bill) => {
  if (!bill) return 'default';
  if (bill.status === 'cancelled' || bill.status === 'Returned from Audit' || bill.approval?.status === 'Rejected') return 'error';
  if (bill.approval?.status === 'Submitted' || bill.status === 'Pending Audit') return 'warning';
  if (bill.status === 'paid') return 'success';
  return 'info';
};

const cellSx = { border: '1px solid', borderColor: 'grey.500', py: 0.75, px: 1, fontSize: 13 };
const headSx = { ...cellSx, fontWeight: 800, textAlign: 'center', bgcolor: 'grey.100', fontSize: 12 };
const numSx = { ...cellSx, textAlign: 'right', whiteSpace: 'nowrap' };

const GrnVendorBillView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get(`/procurement/vendor-bills/${id}`);
        if (!cancelled) setBill(res.data?.data || null);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.message || 'Failed to load bill');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // One row per GRN item line, numbered across the whole bill
  const lines = useMemo(() => {
    const out = [];
    (bill?.grns || []).forEach((g) => {
      (g.items || []).forEach((it) => out.push({ ...it, grnNumber: g.grnNumber, poNumber: g.poNumber }));
    });
    return out;
  }, [bill]);
  const grns = bill?.grns || [];
  const itemsTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const billTotal = Number(bill?.totalAmount) || 0;
  // A bill can cover only part of a GRN — say so, since the item lines then add up to more than the bill
  const isPartial = Math.abs(itemsTotal - billTotal) > 0.01;
  const settled = (Number(bill?.amountPaid) || 0) + (Number(bill?.advanceApplied) || 0);
  const grnNumbers = grns.map((g) => g.grnNumber).filter(Boolean).join(', ');
  const poNumbers = [...new Set(grns.map((g) => g.poNumber).filter(Boolean))].join(', ');
  const stamps = (bill?.signatures || []).filter((s) => s.stamp);

  const meta = bill ? [
    ['Company', bill.companyName],
    ['Bill No.', bill.billNumber],
    ['Vendor Invoice #', bill.vendorInvoiceNumber],
    ['Date', formatDateDmy(bill.billDate)],
    ['Supplier', bill.vendorName],
    ['GRN', grnNumbers],
    ['PO', poNumbers],
    ['Terms', TERMS_LABEL[bill.paymentTerms] || bill.paymentTerms],
    ['Due Date', formatDateDmy(bill.dueDate)]
  ] : [];

  const totals = bill ? [
    ...(isPartial ? [['GRN Value', itemsTotal, false]] : []),
    [isPartial ? 'Net Total (billed on this bill)' : 'Net Total', billTotal, true],
    ...(settled > 0.009 ? [['Paid', settled, false]] : []),
    ['Balance Due', bill.balanceDue, true]
  ] : [];

  const buildPrintHtml = () => {
    const rowHtml = lines.map((l, i) => `<tr>
        <td class="c-num">${i + 1}</td>
        <td>${esc(l.grnNumber)}</td>
        <td class="c-code">${esc(l.itemCode)}</td>
        <td class="c-desc">${esc(l.itemName)}</td>
        <td class="c-center">${esc(l.unit || '—')}</td>
        <td class="c-num">${formatAmount(l.quantity)}</td>
        <td class="c-num">${formatAmount(l.unitPrice)}</td>
        <td class="c-num">${formatAmount(l.amount)}</td>
      </tr>`).join('');
    const metaHtml = meta
      .map(([label, value]) => `<div class="meta-row"><span class="lbl">${esc(label)}</span><span>${esc(value || '—')}</span></div>`)
      .join('');
    const totalsHtml = totals
      .map(([label, value, strong]) => `<div class="sum-row${strong ? ' net' : ''}"><span>${esc(label)}</span><span>${formatAmount(value)}</span></div>`)
      .join('');
    const signatureHtml = (bill.signatures || []).map((row) => `<tr>
        <td style="font-weight:800">${esc(row.authority)}</td>
        <td>${esc(row.name || '-')}</td>
        <td>${row.signature ? `<img src="${esc(getImageUrl(row.signature))}" alt="" />` : esc(row.at ? row.name : '-')}</td>
        <td>${esc(formatDateTime(row.at) || '-')}</td>
      </tr>`).join('');
    return `<!DOCTYPE html>
<html>
  <head>
    <title></title>
    <style>
      @page { size: A4 portrait; margin: 10mm 12mm; }
      * { box-sizing: border-box; }
      html, body { width: 100%; margin: 0; padding: 0; background: #fff; color: #111;
        font-family: Arial, Helvetica, sans-serif; font-size: 11px;
        -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .doc-title { text-align: center; margin: 0 0 10px; }
      .doc-title .org { font-size: 18px; font-weight: 700; letter-spacing: 0.3px; line-height: 1.2; }
      .doc-title .sub { font-size: 14px; font-weight: 700; margin-top: 2px; }
      .meta { display: grid; grid-template-columns: 1.4fr 0.6fr; gap: 8px 20px; margin-bottom: 8px;
        border-bottom: 1px solid #bbb; padding-bottom: 8px; }
      .meta-row { display: grid; grid-template-columns: 105px minmax(0, 1fr); column-gap: 8px; font-weight: 700; margin-bottom: 2px; }
      .meta-row span:last-child { word-break: break-word; }
      .meta-right { text-align: right; font-weight: 700; line-height: 1.6; }
      .lbl { color: #444; }
      .narration { background: #ffe7c2; border: 1px solid #e8b86a; padding: 7px 10px; margin: 0 0 10px; font-weight: 700; line-height: 1.35; }
      table.inv { width: 100%; border-collapse: collapse; table-layout: fixed; }
      table.inv th { font-size: 9.5px; font-weight: 800; text-align: center; border: 1px solid #888; padding: 5px 3px; background: #f2f2f2; }
      table.inv td { border: 1px solid #999; padding: 5px 4px; vertical-align: top; font-size: 10.5px; word-break: break-word; }
      table.inv .c-num { text-align: right; white-space: nowrap; }
      table.inv .c-center { text-align: center; }
      table.inv .c-code { font-size: 10px; }
      table.inv tr.subtotal td { font-weight: 800; border-top: 2px solid #333; background: #fafafa; }
      .footer-sum { display: flex; justify-content: flex-end; margin-top: 10px; }
      .sum-box { width: 300px; max-width: 50%; }
      .sum-row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px solid #ddd; }
      .sum-row.net { font-weight: 800; font-size: 12px; }
      .approval-table { margin-top: 18px; border: 1px solid #999; width: 100%; border-collapse: collapse; page-break-inside: avoid; }
      .approval-table th { text-align: left; font-size: 10px; background: #f5f5f5; border-bottom: 1px solid #999; padding: 6px 8px; }
      .approval-table td { border-bottom: 1px solid #ddd; padding: 6px 8px; font-size: 10px; vertical-align: middle; }
      .approval-table tr:last-child td { border-bottom: 0; }
      .approval-table img { max-height: 32px; max-width: 110px; object-fit: contain; }
    </style>
  </head>
  <body>
    <div class="doc-title">
      ${bill.companyName ? `<div class="org">${esc(bill.companyName)}</div>` : ''}
      <div class="sub">Vendor Bill (GRN)</div>
    </div>
    <div class="meta">
      <div>${metaHtml}</div>
      <div class="meta-right">
        <div><span class="lbl">Time</span> ${esc(formatTime12h(bill.createdAt))}</div>
        <div><span class="lbl">Status</span> ${esc(statusLabel(bill))}</div>
      </div>
    </div>
    ${bill.notes ? `<div class="narration">Narration: ${esc(bill.notes)}</div>` : ''}
    <table class="inv">
      <colgroup>
        <col style="width:5%" /><col style="width:12%" /><col style="width:12%" /><col style="width:29%" />
        <col style="width:7%" /><col style="width:10%" /><col style="width:11%" /><col style="width:14%" />
      </colgroup>
      <thead>
        <tr><th>S.<br/>No</th><th>GRN</th><th>Product<br/>Code</th><th>Description</th><th>Units</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr>
      </thead>
      <tbody>
        ${rowHtml || '<tr><td colspan="8" style="text-align:center">No item lines found on the GRN(s)</td></tr>'}
        <tr class="subtotal"><td colspan="7" style="text-align:right;">Sub Total</td><td class="c-num">${formatAmount(itemsTotal)}</td></tr>
      </tbody>
    </table>
    <div class="footer-sum"><div class="sum-box">${totalsHtml}</div></div>
    <table class="approval-table">
      <colgroup><col style="width:28%" /><col style="width:24%" /><col style="width:26%" /><col style="width:22%" /></colgroup>
      <thead><tr><th>Authority</th><th>Name</th><th>Digital Signature</th><th>Date &amp; Time</th></tr></thead>
      <tbody>${signatureHtml}</tbody>
    </table>
  </body>
</html>`;
  };

  const handlePrint = () => {
    if (!bill) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError('Unable to open print window. Please allow pop-ups and try again.');
      return;
    }
    printWindow.document.write(buildPrintHtml());
    printWindow.document.close();
    // Give signature images a moment to load before the print dialog opens
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  };

  const backToList = () => navigate(`/procurement/vendor-bills?bill=${id}`);

  if (loading) {
    return <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress /></Box>;
  }
  if (!bill) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error || 'Bill not found'}</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/procurement/vendor-bills')}>Back to GRN's &amp; Bills</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
          <Button startIcon={<BackIcon />} onClick={backToList}>Back to GRN's &amp; Bills</Button>
          <Chip label={statusLabel(bill)} color={statusColor(bill)} size="small" />
        </Stack>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>Print</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {bill.status === 'cancelled' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          This bill is voided{bill.voidedAt ? ` (${formatDateDmy(bill.voidedAt)})` : ''}{bill.voidReason ? `: ${bill.voidReason}` : ''}
        </Alert>
      )}
      {bill.approval?.status === 'Rejected' && bill.status !== 'cancelled' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Rejected by {bill.approval.approverName || 'the approval authority'}: {bill.approval.rejectionReason || 'no reason recorded'}
        </Alert>
      )}
      {bill.auditReturn && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Rejected by Audit{bill.auditReturn.returnedBy ? ` (${bill.auditReturn.returnedBy})` : ''}: {bill.auditReturn.reason}
          {(bill.auditReturn.observations || []).map((o, i) => (
            <Typography key={i} variant="body2">• [{o.severity}] {o.observation}</Typography>
          ))}
        </Alert>
      )}

      {/* The bill document */}
      <Paper sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          {bill.companyName && (
            <Typography sx={{ fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: 700, fontSize: { xs: 20, md: 22 }, letterSpacing: 0.2 }}>
              {bill.companyName}
            </Typography>
          )}
          <Typography sx={{ fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: 700, fontSize: { xs: 16, md: 18 }, mt: 0.5 }}>
            Vendor Bill (GRN)
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'grey.400', pb: 1.5, mb: 1.5 }}>
          <Box sx={{ flex: '1 1 420px', minWidth: 0 }}>
            {meta.map(([label, value]) => (
              <Box key={label} sx={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', columnGap: 1, mb: 0.25 }}>
                <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'text.secondary' }}>{label}</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 14, wordBreak: 'break-word' }}>{value || '—'}</Typography>
              </Box>
            ))}
          </Box>
          <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14 }}>
              <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>Time</Box>{formatTime12h(bill.createdAt)}
            </Typography>
          </Box>
        </Box>

        {bill.notes && (
          <Box sx={{ bgcolor: '#ffe7c2', border: '1px solid #e8b86a', px: 1.5, py: 1, mb: 2, fontWeight: 700, fontSize: 14, wordBreak: 'break-word' }}>
            Narration: {bill.notes}
          </Box>
        )}

        <TableContainer>
          <Table size="small" sx={{ borderCollapse: 'collapse' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headSx, width: '5%' }}>S. No</TableCell>
                <TableCell sx={{ ...headSx, width: '12%' }}>GRN</TableCell>
                <TableCell sx={{ ...headSx, width: '12%' }}>Product Code</TableCell>
                <TableCell sx={headSx}>Description</TableCell>
                <TableCell sx={{ ...headSx, width: '7%' }}>Units</TableCell>
                <TableCell sx={{ ...headSx, width: '10%' }}>Quantity</TableCell>
                <TableCell sx={{ ...headSx, width: '11%' }}>Rate</TableCell>
                <TableCell sx={{ ...headSx, width: '14%' }}>Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow><TableCell colSpan={8} sx={{ ...cellSx, textAlign: 'center' }}>No item lines found on the GRN(s)</TableCell></TableRow>
              ) : lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell sx={numSx}>{i + 1}</TableCell>
                  <TableCell sx={cellSx}>{l.grnNumber || '—'}</TableCell>
                  <TableCell sx={cellSx}>{l.itemCode || '—'}</TableCell>
                  <TableCell sx={{ ...cellSx, wordBreak: 'break-word' }}>{l.itemName || '—'}</TableCell>
                  <TableCell sx={{ ...cellSx, textAlign: 'center' }}>{l.unit || '—'}</TableCell>
                  <TableCell sx={numSx}>{formatAmount(l.quantity)}</TableCell>
                  <TableCell sx={numSx}>{formatAmount(l.unitPrice)}</TableCell>
                  <TableCell sx={numSx}>{formatAmount(l.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={7} sx={{ ...numSx, fontWeight: 800, borderTop: '2px solid', borderTopColor: 'grey.800', bgcolor: 'grey.50' }}>Sub Total</TableCell>
                <TableCell sx={{ ...numSx, fontWeight: 800, borderTop: '2px solid', borderTopColor: 'grey.800', bgcolor: 'grey.50' }}>{formatAmount(itemsTotal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
          <Box sx={{ width: 340, maxWidth: '100%' }}>
            {totals.map(([label, value, strong]) => (
              <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.5, borderBottom: '1px solid', borderColor: 'grey.300' }}>
                <Typography sx={{ fontSize: strong ? 15 : 14, fontWeight: strong ? 800 : 500 }}>{label}</Typography>
                <Typography sx={{ fontSize: strong ? 15 : 14, fontWeight: strong ? 800 : 500, whiteSpace: 'nowrap' }}>{formatAmount(value)}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
        {isPartial && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', mt: 0.5 }}>
            This bill covers part of the GRN value; the item lines above show the full GRN.
          </Typography>
        )}

        <TableContainer sx={{ mt: 3, border: '1px solid', borderColor: 'grey.500' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 800, bgcolor: 'grey.100' } }}>
                <TableCell sx={{ width: '28%' }}>Authority</TableCell>
                <TableCell sx={{ width: '24%' }}>Name</TableCell>
                <TableCell sx={{ width: '26%' }}>Digital Signature</TableCell>
                <TableCell>Date &amp; Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(bill.signatures || []).map((row, i) => (
                <TableRow key={`${row.authority}-${i}`}>
                  <TableCell sx={{ fontWeight: 800 }}>{row.authority}</TableCell>
                  <TableCell>
                    {row.name || '-'}
                    {row.state === 'rejected' && <Chip label="Rejected" color="error" size="small" sx={{ ml: 1 }} />}
                    {row.state === 'pending' && <Chip label="Pending" color="warning" size="small" variant="outlined" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>
                    {row.signature ? (
                      <Box component="img" src={getImageUrl(row.signature)} alt={`${row.authority} signature`} sx={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain', display: 'block' }} />
                    ) : (row.at ? row.name : '-')}
                  </TableCell>
                  <TableCell>{formatDateTime(row.at) || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {stamps.length > 0 && (
          <Box sx={{ mt: 3, p: 2, border: '2px solid', borderColor: 'grey.300', borderRadius: 1.5, bgcolor: 'grey.50' }}>
            <Typography sx={{ fontWeight: 900, fontSize: 16, mb: 1.5 }}>Approval Stamp</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {stamps.map((s) => (
                <Box key={s.authority} sx={{ flex: 1, minWidth: 240, p: 2, bgcolor: 'white', border: '1.5px solid', borderColor: 'grey.400', borderRadius: 1.5 }}>
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>{s.authority} Stamp</Typography>
                  <Box component="img" src={getImageUrl(s.stamp)} alt={`${s.authority} stamp`} sx={{ display: 'block', maxHeight: 170, width: '100%', objectFit: 'contain' }} />
                  <Typography sx={{ mt: 1, fontSize: 12.5, color: 'grey.700' }}>{formatDateTime(s.at) || '-'}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Paper>

      {/* Supporting information — on screen only, not part of the printed bill */}
      <Box sx={{ maxWidth: 1100, mx: 'auto', mt: 2 }}>
        {(bill.attachments || []).length > 0 && (
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Attachments</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {bill.attachments.map((a) => (
                <Chip
                  key={a.path}
                  size="small"
                  variant="outlined"
                  icon={<AttachFileIcon />}
                  label={a.originalName || a.filename || 'Attachment'}
                  component="a"
                  href={getImageUrl(a.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  clickable
                />
              ))}
            </Stack>
          </Paper>
        )}

        {(bill.history || []).length > 0 && (
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>History</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date &amp; Time</TableCell>
                    <TableCell>Step</TableCell>
                    <TableCell>By</TableCell>
                    <TableCell>Comments</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bill.history.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(h.at) || '—'}</TableCell>
                      <TableCell>{h.fromStatus === h.toStatus ? h.toStatus : `${h.fromStatus || '—'} → ${h.toStatus || '—'}`}</TableCell>
                      <TableCell>{h.byName || '—'}</TableCell>
                      <TableCell sx={{ wordBreak: 'break-word' }}>{h.comments || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </Box>
    </Box>
  );
};

export default GrnVendorBillView;
