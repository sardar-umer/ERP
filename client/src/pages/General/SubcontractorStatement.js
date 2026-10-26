import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Grid, Paper, Skeleton, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import { Print as PrintIcon } from '@mui/icons-material';
import dayjs from 'dayjs';
import api from '../../services/api';
import { openPrintHtml } from '../../utils/employeeFormPrint';
import { IPC_APPROVAL_COLOR, ipcStageText } from '../../components/ProjectManagement/IpcApprovalTrail';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kindLabel = (k) => (k === 'Advance' ? 'Advance' : k === 'Retention Release' ? 'Retention release' : 'Work IPC');
const projectLabel = (p) => [p?.parentProject?.name || p?.mainProject, p?.name].filter(Boolean).join(' / ');

const TOTALS = [
  ['contracted', 'Contracted'],
  ['certifiedWork', 'Certified work (CEO approved)'],
  ['workInApproval', 'Work in approval'],
  ['retentionHeld', 'Retention held'],
  ['advanceOutstanding', 'Advance outstanding'],
  ['approvedPayable', 'Approved payable (net)'],
  ['paid', 'Paid by Finance'],
  ['balanceDue', 'Balance due']
];

const printStatement = (d) => {
  const rows = (list, cols) => list.map((r) => `<tr>${cols.map((c) => `<td class="${c.r ? 'r' : ''}">${c.v(r)}</td>`).join('')}</tr>`).join('');
  openPrintHtml(`<!doctype html><html><head><meta charset="utf-8" /><title>Statement — ${esc(d.supplier.name)}</title>
  <style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:11px;color:#1f2937}
  h1{font-size:18px;margin:0}h2{font-size:12px;margin:14px 0 6px;border-bottom:1px solid #d1d5db;padding-bottom:3px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:4px 6px;text-align:left}th{background:#f3f4f6}
  .r{text-align:right}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}
  .k{border:1px solid #d1d5db;border-radius:4px;padding:6px}.k b{display:block;font-size:13px}.muted{color:#6b7280}</style></head><body>
  <h1>Subcontractor Statement — ${esc(d.supplier.name)}</h1>
  <div class="muted">${esc(d.supplier.supplierId || '')} ${esc(d.supplier.phone || '')} · Generated ${esc(dayjs(d.generatedAt).format('DD MMM YYYY, hh:mm A'))}</div>
  <div class="grid">${TOTALS.map(([k, l]) => `<div class="k"><span class="muted">${l}</span><b>${esc(fmt(d.totals[k]))}</b></div>`).join('')}</div>
  <h2>Position by project</h2><table><tr><th>Project</th><th class="r">Retention held</th><th class="r">Advance paid</th><th class="r">Recovered</th><th class="r">Advance outstanding</th></tr>
  ${rows(d.byProject, [{ v: (r) => esc(projectLabel(r.project)) }, { r: 1, v: (r) => esc(fmt(r.retentionAvailable)) }, { r: 1, v: (r) => esc(fmt(r.advancePaid)) }, { r: 1, v: (r) => esc(fmt(r.advanceRecovered)) }, { r: 1, v: (r) => esc(fmt(r.advanceOutstanding)) }])}</table>
  <h2>Contracts</h2><table><tr><th>Contract</th><th>Project</th><th>Type</th><th>Status</th><th class="r">Value</th></tr>
  ${rows(d.contracts, [{ v: (c) => esc(c.contractNumber) }, { v: (c) => esc(projectLabel(c.project)) }, { v: (c) => (c.contractType === 'Slab' ? 'Slab wise' : 'BOQ wise') }, { v: (c) => esc(c.status) }, { r: 1, v: (c) => esc(fmt(c.totalAmount)) }])}</table>
  <h2>IPC ledger</h2><table><tr><th>Date</th><th>IPC</th><th>Kind</th><th>Project</th><th class="r">Gross</th><th class="r">Retention</th><th class="r">Adv. recovered</th><th class="r">WHT</th><th class="r">Net</th><th class="r">Paid</th><th>Stage</th></tr>
  ${rows(d.ipcs, [{ v: (i) => esc(dayjs(i.issueDate).format('DD MMM YYYY')) }, { v: (i) => `#${i.ipcNumber} ${esc(i.invoiceNumber)}` }, { v: (i) => kindLabel(i.ipcKind) }, { v: (i) => esc(projectLabel(i.project)) },
    { r: 1, v: (i) => esc(fmt(i.grossAmount)) }, { r: 1, v: (i) => esc(fmt(i.retentionAmount)) }, { r: 1, v: (i) => esc(fmt(i.advanceRecoveryAmount)) }, { r: 1, v: (i) => esc(fmt(i.whtAmount)) },
    { r: 1, v: (i) => esc(fmt(i.netPayableAmount)) }, { r: 1, v: (i) => esc(fmt(i.paidAmount)) }, { v: (i) => esc(i.status === 'Cancelled' ? 'Cancelled' : ipcStageText(i)) }])}</table>
  </body></html>`);
};

/** One subcontractor's contracts, IPCs, retention, advances and payments across every project. */
export default function SubcontractorStatement() {
  const [params, setParams] = useSearchParams();
  const [subcontractors, setSubcontractors] = useState([]);
  const [selectedId, setSelectedId] = useState(params.get('subcontractor') || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/project-management/subcontractors').then((res) => setSubcontractors(res.data?.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) { setData(null); return; }
    setLoading(true);
    setError('');
    api.get(`/project-management/subcontractors/${selectedId}/statement`)
      .then((res) => setData(res.data?.data || null))
      .catch((err) => setError(err.response?.data?.message || 'Could not load the statement'))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const choose = (id) => {
    setSelectedId(id || '');
    const next = new URLSearchParams(params);
    if (id) next.set('subcontractor', id); else next.delete('subcontractor');
    setParams(next, { replace: true });
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Subcontractor Statement</Typography>
          <Typography variant="body2" color="text.secondary">Contracts, IPCs, retention, advances and payments across all projects</Typography>
        </Box>
        <Stack direction="row" gap={1} alignItems="center">
          <Autocomplete
            sx={{ minWidth: 320 }}
            options={subcontractors}
            value={subcontractors.find((s) => String(s._id) === String(selectedId)) || null}
            onChange={(_, v) => choose(v?._id)}
            getOptionLabel={(s) => `${s.name}${s.supplierId ? ` (${s.supplierId})` : ''}`}
            isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
            renderInput={(p) => <TextField {...p} size="small" label="Subcontractor" />}
          />
          <Button variant="outlined" startIcon={<PrintIcon />} disabled={!data} onClick={() => printStatement(data)}>Print</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!selectedId && <Alert severity="info">Pick a subcontractor to see their statement.</Alert>}
      {loading && <Skeleton height={300} />}

      {data && !loading && (
        <Stack spacing={2.5}>
          <Grid container spacing={1.5}>
            {TOTALS.map(([k, label]) => (
              <Grid item xs={6} md={3} key={k}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.25 }}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="h6" fontWeight={700} color={k === 'balanceDue' && data.totals[k] > 0 ? 'warning.main' : undefined}>{fmt(data.totals[k])}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Position by project</Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: 'grey.50' }}>
                  {['Project', 'Retention held', 'Advance paid', 'Recovered', 'Advance outstanding'].map((h, i) => <TableCell key={h} align={i ? 'right' : 'left'}><strong>{h}</strong></TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {data.byProject.map((r) => (
                    <TableRow key={r.project._id}>
                      <TableCell>{projectLabel(r.project)}</TableCell>
                      <TableCell align="right">{fmt(r.retentionAvailable)}</TableCell>
                      <TableCell align="right">{fmt(r.advancePaid)}</TableCell>
                      <TableCell align="right">{fmt(r.advanceRecovered)}</TableCell>
                      <TableCell align="right">{fmt(r.advanceOutstanding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>

          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Contracts</Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: 'grey.50' }}>
                  {['Contract', 'Project', 'Type', 'Status', 'Value'].map((h, i) => <TableCell key={h} align={i === 4 ? 'right' : 'left'}><strong>{h}</strong></TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {data.contracts.map((c) => (
                    <TableRow key={c._id}>
                      <TableCell>{c.contractNumber}<Typography variant="caption" display="block" color="text.secondary">{c.title}</Typography></TableCell>
                      <TableCell>{projectLabel(c.project)}</TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={c.contractType === 'Slab' ? 'Slab wise' : 'BOQ wise'} /></TableCell>
                      <TableCell>{c.status}</TableCell>
                      <TableCell align="right">{fmt(c.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>

          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>IPC ledger</Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: 'grey.50' }}>
                  {['Date', 'IPC', 'Project', 'Gross', 'Retention', 'Adv. recovered', 'Net', 'Paid', 'Stage'].map((h, i) => (
                    <TableCell key={h} align={i >= 3 && i <= 7 ? 'right' : 'left'}><strong>{h}</strong></TableCell>
                  ))}
                </TableRow></TableHead>
                <TableBody>
                  {data.ipcs.map((i) => (
                    <TableRow key={i._id} sx={{ opacity: i.status === 'Cancelled' ? 0.5 : 1 }}>
                      <TableCell>{dayjs(i.issueDate).format('DD MMM YYYY')}</TableCell>
                      <TableCell>
                        #{i.ipcNumber} {i.invoiceNumber}
                        <Typography variant="caption" display="block" color="text.secondary">
                          {kindLabel(i.ipcKind)}{i.checkRequest?.checkRequestNumber ? ` · ${i.checkRequest.checkRequestNumber}` : ''}{i.financeBillNumber ? ` · AP ${i.financeBillNumber}` : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>{projectLabel(i.project)}</TableCell>
                      <TableCell align="right">{fmt(i.grossAmount)}</TableCell>
                      <TableCell align="right">{fmt(i.retentionAmount)}</TableCell>
                      <TableCell align="right">{fmt(i.advanceRecoveryAmount)}</TableCell>
                      <TableCell align="right">{fmt(i.netPayableAmount)}</TableCell>
                      <TableCell align="right">{fmt(i.paidAmount)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={i.status === 'Cancelled' ? 'Cancelled' : ipcStageText(i)}
                          color={i.status === 'Cancelled' ? 'default' : IPC_APPROVAL_COLOR[i.approvalStatus || 'Draft'] || 'default'} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!data.ipcs.length && <TableRow><TableCell colSpan={9} align="center"><Typography color="text.secondary" py={2}>No IPCs yet</Typography></TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Stack>
      )}
    </Box>
  );
}
