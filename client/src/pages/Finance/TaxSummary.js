import React, { useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Alert, Stack, Card, CardContent,
  Grid, Chip, TextField, Divider
} from '@mui/material';
import { Percent as TaxIcon, Refresh as RefreshIcon, Print as PrintIcon, PictureAsPdf as PdfIcon, GridOn as ExcelIcon } from '@mui/icons-material';
import api from '../../services/api';
import { exportTaxSummaryPDF, exportTaxSummaryExcel } from '../../utils/reportExport';
import { printTovusElement } from '../../utils/tovusPrintBrand';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TaxSummary() {
  const curYear = new Date().getFullYear();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [filters, setFilters] = useState({
    fromDate: `${curYear}-01-01`,
    toDate:   new Date().toISOString().split('T')[0]
  });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/finance/reports/tax-summary', { params: filters });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load tax summary');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  return (
    <Box className="tv-report-area" sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3} className="print-hide-toolbar">
        <Typography variant="h5" fontWeight={700} display="flex" alignItems="center" gap={1}>
          <TaxIcon color="error" /> Tax Summary — FBR Report
        </Typography>
        <Stack direction="row" gap={1} alignItems="center">
          <TextField label="From" type="date" size="small" value={filters.fromDate}
            onChange={e => setFilters({ ...filters, fromDate: e.target.value })} InputLabelProps={{ shrink: true }} />
          <TextField label="To" type="date" size="small" value={filters.toDate}
            onChange={e => setFilters({ ...filters, toDate: e.target.value })} InputLabelProps={{ shrink: true }} />
          <Button variant="contained" color="error" onClick={load} disabled={loading} startIcon={<RefreshIcon />}>
            {loading ? 'Loading…' : 'Generate'}
          </Button>
          {data && <>
            <Button variant="outlined" startIcon={<PdfIcon />} color="error" onClick={() => exportTaxSummaryPDF(data, filters)}>PDF</Button>
            <Button variant="outlined" startIcon={<ExcelIcon />} color="success" onClick={() => exportTaxSummaryExcel(data, filters)}>Excel</Button>
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => printTovusElement('.tv-report-area', { title: 'Tax Summary', fit: false })}>Print</Button>
          </>}
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {!data && !loading && (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">Select a period and click Generate to view the FBR Tax Summary.</Typography>
        </Paper>
      )}

      {data && (
        <>
          {/* Summary KPIs */}
          <Grid container spacing={2} mb={3}>
            {[
              { label: 'GST Input (Purchases)', value: data.summary.totalInputTax,  color: 'info.main',    help: 'GST paid on purchases (claimable)' },
              { label: 'GST Output (Sales)',    value: data.summary.totalOutputTax, color: 'success.main', help: 'GST collected on sales (payable to FBR)' },
              { label: data.summary.isRefundable ? 'Refund Due from FBR' : 'Net GST Payable to FBR',
                value: Math.abs(data.summary.netTaxPayable), color: data.summary.isRefundable ? 'success.main' : 'error.main',
                help: data.summary.isRefundable ? 'Input > Output — refund due' : 'Output > Input — pay to FBR' }
            ].map(c => (
              <Grid item xs={12} md={4} key={c.label}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="caption" color="text.secondary" display="block">{c.label}</Typography>
                    <Typography variant="h5" fontWeight={800} color={c.color}>PKR {fmt(c.value)}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.help}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* GST Return Summary Box */}
          <Paper variant="outlined" sx={{ p: 2.5, mb: 3, bgcolor: data.summary.isRefundable ? 'success.50' : 'error.50', borderColor: data.summary.isRefundable ? 'success.200' : 'error.200' }}>
            <Typography variant="subtitle1" fontWeight={700} mb={1}>FBR Sales Tax Return Summary</Typography>
            <Stack gap={0.5}>
              <Stack direction="row" justifyContent="space-between">
                <Typography>Output Tax (Sales Tax Collected)</Typography>
                <Typography fontWeight={600}>PKR {fmt(data.summary.totalOutputTax)}</Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography>Input Tax (Sales Tax Paid on Purchases)</Typography>
                <Typography fontWeight={600} color="info.main">— PKR {fmt(data.summary.totalInputTax)}</Typography>
              </Stack>
              <Divider />
              <Stack direction="row" justifyContent="space-between">
                <Typography fontWeight={700}>{data.summary.isRefundable ? 'Refund Due' : 'Net Tax Payable to FBR'}</Typography>
                <Typography fontWeight={800} color={data.summary.isRefundable ? 'success.main' : 'error.main'}>
                  PKR {fmt(Math.abs(data.summary.netTaxPayable))}
                </Typography>
              </Stack>
            </Stack>
          </Paper>

          {/* Input Tax Details */}
          <Typography variant="subtitle1" fontWeight={700} mb={1} color="info.main">Input Tax — Purchases</Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><b>Bill #</b></TableCell>
                  <TableCell><b>Vendor</b></TableCell>
                  <TableCell align="right"><b>Subtotal</b></TableCell>
                  <TableCell align="right"><b>Tax Amount</b></TableCell>
                  <TableCell><b>Date</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.inputTax.rows.length === 0
                  ? <TableRow><TableCell colSpan={5} align="center" sx={{ color: 'text.secondary' }}>No taxable purchases in this period</TableCell></TableRow>
                  : data.inputTax.rows.map(r => (
                    <TableRow key={r._id} hover>
                      <TableCell>{r.billNumber}</TableCell>
                      <TableCell>{r.vendor?.name || '—'}</TableCell>
                      <TableCell align="right">{fmt(r.subtotal)}</TableCell>
                      <TableCell align="right" sx={{ color: 'info.main', fontWeight: 600 }}>{fmt(r.taxAmount)}</TableCell>
                      <TableCell>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  ))}
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={3} align="right"><b>Total Input Tax</b></TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, color: 'info.main' }}>PKR {fmt(data.inputTax.total)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* Output Tax Details */}
          <Typography variant="subtitle1" fontWeight={700} mb={1} color="success.main">Output Tax — Sales</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><b>Invoice #</b></TableCell>
                  <TableCell><b>Customer</b></TableCell>
                  <TableCell align="right"><b>Amount</b></TableCell>
                  <TableCell align="right"><b>Tax Amount</b></TableCell>
                  <TableCell><b>Date</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.outputTax.rows.length === 0
                  ? <TableRow><TableCell colSpan={5} align="center" sx={{ color: 'text.secondary' }}>No taxable sales in this period</TableCell></TableRow>
                  : data.outputTax.rows.map(r => (
                    <TableRow key={r._id} hover>
                      <TableCell>{r.invoiceNumber}</TableCell>
                      <TableCell>{r.customerName || '—'}</TableCell>
                      <TableCell align="right">{fmt(r.amount)}</TableCell>
                      <TableCell align="right" sx={{ color: 'success.main', fontWeight: 600 }}>{fmt(r.taxAmount)}</TableCell>
                      <TableCell>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  ))}
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={3} align="right"><b>Total Output Tax</b></TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, color: 'success.main' }}>PKR {fmt(data.outputTax.total)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
