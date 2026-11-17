import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Grid, Link, Paper, Skeleton, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import { Print as PrintIcon, ArrowBack as BackIcon } from '@mui/icons-material';
import dayjs from 'dayjs';
import api from '../../services/api';
import { openPrintHtml } from '../../utils/employeeFormPrint';
import useClientPagination from '../../hooks/useClientPagination';

const fmt = (v) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(Number(v || 0));
/** Payable shows plain; a negative balance means the vendor holds our advance */
const fmtBalance = (v) => (Number(v) < -0.004 ? `${fmt(Math.abs(v))} Adv` : fmt(v));
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '');
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TYPE_CHIP = {
  bill: { label: 'Bill', color: 'primary' },
  payment: { label: 'Payment', color: 'success' },
  advance: { label: 'Advance', color: 'warning' }
};

const periodText = (d) => {
  if (d.fromDate && d.toDate) return `${fmtDate(d.fromDate)} to ${fmtDate(d.toDate)}`;
  if (d.fromDate) return `From ${fmtDate(d.fromDate)}`;
  if (d.toDate) return `Up to ${fmtDate(d.toDate)}`;
  return 'All dates';
};

const printLedger = (d) => {
  const rows = d.entries.map((e) => `<tr><td>${esc(fmtDate(e.date))}</td><td>${TYPE_CHIP[e.type].label}</td><td>${esc(e.document)}</td>
    <td>${esc(e.particulars)}</td><td>${esc(e.poNumbers)}</td><td class="r">${e.debit ? esc(fmt(e.debit)) : ''}</td>
    <td class="r">${e.credit ? esc(fmt(e.credit)) : ''}</td><td class="r">${esc(fmtBalance(e.balance))}</td></tr>`).join('');
  openPrintHtml(`<!doctype html><html><head><meta charset="utf-8" /><title>Vendor Ledger — ${esc(d.vendor.name)}</title>
  <style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:11px;color:#1f2937}
  h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{border:1px solid #d1d5db;padding:4px 6px;text-align:left}th{background:#f3f4f6}.r{text-align:right}
  .muted{color:#6b7280}tfoot td,.open td{font-weight:bold;background:#f9fafb}</style></head><body>
  <h1>Vendor Ledger (Procurement) — ${esc(d.vendor.name)}</h1>
  <div class="muted">${esc([d.vendor.supplierId, d.vendor.phone, d.vendor.ntnCnic && `NTN/CNIC ${d.vendor.ntnCnic}`].filter(Boolean).join(' · '))}</div>
  <div class="muted">${esc(periodText(d))} · Generated ${esc(dayjs(d.generatedAt).format('DD MMM YYYY, hh:mm A'))}</div>
  <table><thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Particulars</th><th>PO</th><th class="r">Debit (paid)</th><th class="r">Credit (billed)</th><th class="r">Balance</th></tr></thead>
  <tbody><tr class="open"><td colspan="7">Opening balance</td><td class="r">${esc(fmtBalance(d.openingBalance))}</td></tr>${rows}</tbody>
  <tfoot><tr><td colspan="5">Total / closing balance</td><td class="r">${esc(fmt(d.totals.paid + d.totals.advances))}</td>
  <td class="r">${esc(fmt(d.totals.billed))}</td><td class="r">${esc(fmtBalance(d.totals.closingBalance))}</td></tr></tfoot></table>
  </body></html>`);
};

/** Procurement-only vendor ledger: GRN bills against payments and advances, with a running balance. */
export default function VendorLedger() {
  const [params, setParams] = useSearchParams();
  const vendorId = params.get('vendor') || '';
  const fromDate = params.get('from') || '';
  const toDate = params.get('to') || '';
  const [vendors, setVendors] = useState([]);
  const [allVendors, setAllVendors] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/procurement/vendor-ledger')
      .then((res) => setVendors(res.data?.data?.vendors || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load vendors'))
      .finally(() => setListLoading(false));
    // The picker offers every vendor, not only those that already have bills
    api.get('/procurement/vendors', { params: { limit: 5000 } })
      .then((res) => setAllVendors(res.data?.data?.vendors || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!vendorId) { setData(null); return; }
    setLoading(true);
    setError('');
    api.get(`/procurement/vendor-ledger/${vendorId}`, { params: { fromDate: fromDate || undefined, toDate: toDate || undefined } })
      .then((res) => setData(res.data?.data || null))
      .catch((err) => { setData(null); setError(err.response?.data?.message || 'Could not load the ledger'); })
      .finally(() => setLoading(false));
  }, [vendorId, fromDate, toDate]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: key !== 'vendor' });
  };

  const options = useMemo(() => {
    const seen = new Set(vendors.map((v) => v.vendorId));
    return [
      ...vendors.map((v) => ({ id: v.vendorId, name: v.name, supplierId: v.supplierId })),
      ...allVendors.filter((v) => !seen.has(String(v._id))).map((v) => ({ id: String(v._id), name: v.name, supplierId: v.supplierId }))
    ].sort((a, b) => a.name.localeCompare(b.name));
  }, [vendors, allVendors]);

  const grand = useMemo(() => vendors.reduce((t, v) => ({
    billed: t.billed + v.billed, paid: t.paid + v.paid, advances: t.advances + v.advances, balance: t.balance + v.balance
  }), { billed: 0, paid: 0, advances: 0, balance: 0 }), [vendors]);

  const cards = data ? [
    ['Opening balance', fmtBalance(data.openingBalance)],
    ['Billed (GRN bills)', fmt(data.totals.billed)],
    ['Paid against bills', fmt(data.totals.paid)],
    ['Advances paid', fmt(data.totals.advances)],
    ['Closing balance', fmtBalance(data.totals.closingBalance), data.totals.closingBalance > 0 ? 'warning.main' : undefined],
    ['Advance not yet adjusted', fmt(data.unadjustedAdvance)]
  ] : [];

  const pg = useClientPagination(vendors);
  const pg2 = useClientPagination(data?.entries);
  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Vendor Ledger</Typography>
          <Typography variant="body2" color="text.secondary">
            Procurement only — GRN bills, their payments and purchase advances
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}>
          <Autocomplete
            sx={{ minWidth: 300 }}
            options={options}
            value={options.find((o) => o.id === vendorId) || null}
            onChange={(_, v) => setParam('vendor', v?.id)}
            getOptionLabel={(o) => `${o.name}${o.supplierId ? ` (${o.supplierId})` : ''}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderOption={(props, o) => <li {...props} key={o.id}>{o.name}{o.supplierId ? ` (${o.supplierId})` : ''}</li>}
            renderInput={(p) => <TextField {...p} size="small" label="Vendor" />}
          />
          <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={fromDate} onChange={(e) => setParam('from', e.target.value)} />
          <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={toDate} onChange={(e) => setParam('to', e.target.value)} />
          <Button variant="outlined" startIcon={<PrintIcon />} disabled={!data || loading} onClick={() => printLedger(data)}>Print</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!vendorId && (
        listLoading ? <Skeleton height={300} /> : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead><TableRow sx={{ bgcolor: 'grey.50' }}>
                {['Vendor', 'Bills', 'Billed', 'Paid', 'Advances paid', 'Balance payable', 'Last activity'].map((h, i) => (
                  <TableCell key={h} align={i >= 1 && i <= 5 ? 'right' : 'left'}><strong>{h}</strong></TableCell>
                ))}
              </TableRow></TableHead>
              <TableBody>
                {pg.rows.map((v) => (
                  <TableRow key={v.vendorId} hover sx={{ cursor: 'pointer' }} onClick={() => setParam('vendor', v.vendorId)}>
                    <TableCell>
                      <Link component="button" underline="hover" sx={{ textAlign: 'left' }}>{v.name}</Link>
                      {v.supplierId && <Typography variant="caption" display="block" color="text.secondary">{v.supplierId}</Typography>}
                    </TableCell>
                    <TableCell align="right">{v.bills}</TableCell>
                    <TableCell align="right">{fmt(v.billed)}</TableCell>
                    <TableCell align="right">{fmt(v.paid)}</TableCell>
                    <TableCell align="right">{fmt(v.advances)}</TableCell>
                    <TableCell align="right"><strong>{fmtBalance(v.balance)}</strong></TableCell>
                    <TableCell>{fmtDate(v.lastActivity)}</TableCell>
                  </TableRow>
                ))}
                {vendors.length > 0 && (
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell colSpan={2}><strong>Total — {vendors.length} vendors</strong></TableCell>
                    <TableCell align="right"><strong>{fmt(grand.billed)}</strong></TableCell>
                    <TableCell align="right"><strong>{fmt(grand.paid)}</strong></TableCell>
                    <TableCell align="right"><strong>{fmt(grand.advances)}</strong></TableCell>
                    <TableCell align="right"><strong>{fmtBalance(grand.balance)}</strong></TableCell>
                    <TableCell />
                  </TableRow>
                )}
                {!vendors.length && (
                  <TableRow><TableCell colSpan={7} align="center"><Typography color="text.secondary" py={3}>No vendor has a GRN bill or purchase advance yet</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        )
      )}

      {vendorId && loading && <Skeleton height={300} />}

      {vendorId && data && !loading && (
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
            <Button size="small" startIcon={<BackIcon />} onClick={() => setParam('vendor', '')}>All vendors</Button>
            <Typography variant="subtitle1" fontWeight={700}>{data.vendor.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {[data.vendor.supplierId, data.vendor.phone, data.vendor.ntnCnic && `NTN/CNIC ${data.vendor.ntnCnic}`].filter(Boolean).join(' · ')}
            </Typography>
          </Stack>

          <Grid container spacing={1.5}>
            {cards.map(([label, value, color]) => (
              <Grid item xs={6} md={2} key={label}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="h6" fontWeight={700} color={color}>{value}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead><TableRow sx={{ bgcolor: 'grey.50' }}>
                {['Date', 'Type', 'Document', 'Particulars', 'PO', 'Debit (paid)', 'Credit (billed)', 'Balance'].map((h, i) => (
                  <TableCell key={h} align={i >= 5 ? 'right' : 'left'}><strong>{h}</strong></TableCell>
                ))}
              </TableRow></TableHead>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7}><strong>Opening balance</strong></TableCell>
                  <TableCell align="right"><strong>{fmtBalance(data.openingBalance)}</strong></TableCell>
                </TableRow>
                {pg2.rows.map((e, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <TableRow key={i} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={TYPE_CHIP[e.type].label} color={TYPE_CHIP[e.type].color} /></TableCell>
                    <TableCell>
                      {e.type === 'bill'
                        ? <Link component={RouterLink} to={`/procurement/vendor-bills/view/${e.billId}`} underline="hover">{e.document}</Link>
                        : e.document}
                    </TableCell>
                    <TableCell>
                      {e.particulars}
                      {e.type === 'bill' && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {e.status}{e.advanceAdjusted > 0 ? ` · advance adjusted ${fmt(e.advanceAdjusted)}` : ''}
                        </Typography>
                      )}
                      {e.type === 'advance' && e.unadjusted > 0 && (
                        <Typography variant="caption" display="block" color="text.secondary">{fmt(e.unadjusted)} not yet adjusted against a bill</Typography>
                      )}
                    </TableCell>
                    <TableCell>{e.poNumbers}</TableCell>
                    <TableCell align="right">{e.debit ? fmt(e.debit) : ''}</TableCell>
                    <TableCell align="right">{e.credit ? fmt(e.credit) : ''}</TableCell>
                    <TableCell align="right">{fmtBalance(e.balance)}</TableCell>
                  </TableRow>
                ))}
                {!data.entries.length && (
                  <TableRow><TableCell colSpan={8} align="center"><Typography color="text.secondary" py={2}>No procurement entries for this vendor in the selected dates</Typography></TableCell></TableRow>
                )}
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell colSpan={5}><strong>Total / closing balance</strong></TableCell>
                  <TableCell align="right"><strong>{fmt(data.totals.paid + data.totals.advances)}</strong></TableCell>
                  <TableCell align="right"><strong>{fmt(data.totals.billed)}</strong></TableCell>
                  <TableCell align="right"><strong>{fmtBalance(data.totals.closingBalance)}</strong></TableCell>
                </TableRow>
              </TableBody>
            </Table>{pg2.bar}
          </TableContainer>
          <Typography variant="caption" color="text.secondary">
            Balance is what is still payable to the vendor; “Adv” means the vendor holds more advance than has been billed.
            An advance is counted on the day it is paid, so adjusting it against a bill later adds no new line.
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
