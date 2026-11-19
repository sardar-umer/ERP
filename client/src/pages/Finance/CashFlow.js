import React, { useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Alert, Stack, Card, CardContent,
  Grid, TextField, Divider, Avatar
} from '@mui/material';
import {
  CurrencyExchange as CashIcon, Refresh as RefreshIcon, Print as PrintIcon,
  TrendingUp, TrendingDown, AccountBalance,
  PictureAsPdf as PdfIcon, GridOn as ExcelIcon
} from '@mui/icons-material';
import api from '../../services/api';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import { exportCashFlowPDF, exportCashFlowExcel } from '../../utils/reportExport';
import { printTovusElement } from '../../utils/tovusPrintBrand';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FlowSection = ({ title, subtitle, rows, total, color, icon }) => (
  <Box mb={3}>
    <Stack direction="row" alignItems="center" gap={1} mb={1}>
      <Avatar sx={{ bgcolor: color, width: 32, height: 32 }}>{icon}</Avatar>
      <Box>
        <Typography fontWeight={700}>{title}</Typography>
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
      </Box>
    </Stack>
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.50' }}>
            <TableCell><b>Account #</b></TableCell>
            <TableCell><b>Account</b></TableCell>
            <TableCell align="right"><b>Net Flow (PKR)</b></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0
            ? <TableRow><TableCell colSpan={3} align="center" sx={{ color: 'text.secondary', py: 2 }}>No activity</TableCell></TableRow>
            : rows.map(r => (
              <TableRow key={r._id || r.accountNumber} hover>
                <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{r.accountNumber}</TableCell>
                <TableCell>{r.accountName}</TableCell>
                <TableCell align="right" sx={{ color: r.netFlow >= 0 ? 'success.main' : 'error.main', fontWeight: 500 }}>
                  {r.netFlow >= 0 ? '+' : ''}{fmt(r.netFlow)}
                </TableCell>
              </TableRow>
            ))}
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell colSpan={2} align="right"><b>Net {title}</b></TableCell>
            <TableCell align="right" sx={{ fontWeight: 800, color: total >= 0 ? 'success.main' : 'error.main' }}>
              <b>{total >= 0 ? '+' : ''}PKR {fmt(Math.abs(total))}</b>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  </Box>
);

export default function CashFlow() {
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
      const res = await api.get('/finance/reports/cash-flow', { params: filters });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load cash flow statement');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useFinanceCompanyReload(load, { skipInitial: true });

  return (
    <Box className="tv-report-area" sx={{ p: 3 }}>
      <FinanceCompanyPageHeader title="Cash Flow Statement" icon={CashIcon}>
          <TextField label="From" type="date" size="small" value={filters.fromDate}
            onChange={e => setFilters({ ...filters, fromDate: e.target.value })} InputLabelProps={{ shrink: true }} />
          <TextField label="To" type="date" size="small" value={filters.toDate}
            onChange={e => setFilters({ ...filters, toDate: e.target.value })} InputLabelProps={{ shrink: true }} />
          <Button variant="contained" onClick={load} disabled={loading} startIcon={<RefreshIcon />}>
            {loading ? 'Loading…' : 'Generate'}
          </Button>
          {data && <>
            <Button variant="outlined" startIcon={<PdfIcon />} color="error" onClick={() => exportCashFlowPDF(data, filters)}>PDF</Button>
            <Button variant="outlined" startIcon={<ExcelIcon />} color="success" onClick={() => exportCashFlowExcel(data, filters)}>Excel</Button>
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => printTovusElement('.tv-report-area', { title: 'Cash Flow Statement', fit: false })}>Print</Button>
          </>}
      </FinanceCompanyPageHeader>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {!data && !loading && (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">Select a period and click Generate to view the Cash Flow Statement.</Typography>
        </Paper>
      )}

      {data && (
        <>
          {/* Summary KPIs */}
          <Grid container spacing={2} mb={3}>
            {[
              { label: 'Operating Activities',   value: data.summary.totalOperating, color: 'primary.main', help: 'Core business operations' },
              { label: 'Investing Activities',   value: data.summary.totalInvesting, color: 'warning.main', help: 'Asset purchases/sales' },
              { label: 'Financing Activities',   value: data.summary.totalFinancing, color: 'info.main',    help: 'Equity & long-term debt' },
              { label: 'Net Cash Change',        value: data.summary.netCashChange,  color: data.summary.netCashChange >= 0 ? 'success.main' : 'error.main', help: 'Total increase/decrease in cash' },
            ].map(c => (
              <Grid item xs={12} sm={6} md={3} key={c.label}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" display="block">{c.label}</Typography>
                    <Typography variant="h6" fontWeight={700} color={c.color}>
                      {c.value >= 0 ? '+' : ''}PKR {fmt(Math.abs(c.value))}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{c.help}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Three sections */}
          <FlowSection
            title="Operating Activities"
            subtitle="Cash from core business operations — revenue, expenses, AR/AP changes"
            rows={data.operating.rows}
            total={data.operating.total}
            color="primary.main"
            icon={<TrendingUp sx={{ fontSize: 18 }} />}
          />
          <FlowSection
            title="Investing Activities"
            subtitle="Cash from buying/selling long-term assets and investments"
            rows={data.investing.rows}
            total={data.investing.total}
            color="warning.main"
            icon={<AccountBalance sx={{ fontSize: 18 }} />}
          />
          <FlowSection
            title="Financing Activities"
            subtitle="Cash from equity issuance, dividends, and long-term borrowings"
            rows={data.financing.rows}
            total={data.financing.total}
            color="info.main"
            icon={<TrendingDown sx={{ fontSize: 18 }} />}
          />

          {/* Net Change Summary */}
          <Paper variant="outlined" sx={{
            p: 2.5, bgcolor: data.summary.netCashChange >= 0 ? 'success.50' : 'error.50',
            borderColor: data.summary.netCashChange >= 0 ? 'success.300' : 'error.300'
          }}>
            <Typography variant="subtitle1" fontWeight={700} mb={1}>Cash Flow Summary</Typography>
            {[
              { label: 'Net cash from operating activities', value: data.summary.totalOperating },
              { label: 'Net cash from investing activities', value: data.summary.totalInvesting },
              { label: 'Net cash from financing activities', value: data.summary.totalFinancing },
            ].map(r => (
              <Stack key={r.label} direction="row" justifyContent="space-between" mb={0.5}>
                <Typography variant="body2">{r.label}</Typography>
                <Typography variant="body2" fontWeight={600} color={r.value >= 0 ? 'success.main' : 'error.main'}>
                  {r.value >= 0 ? '+' : ''}PKR {fmt(r.value)}
                </Typography>
              </Stack>
            ))}
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" justifyContent="space-between">
              <Typography fontWeight={700}>Net Change in Cash</Typography>
              <Typography fontWeight={800} color={data.summary.netCashChange >= 0 ? 'success.main' : 'error.main'}>
                {data.summary.netCashChange >= 0 ? '+' : ''}PKR {fmt(data.summary.netCashChange)}
              </Typography>
            </Stack>
          </Paper>
        </>
      )}
    </Box>
  );
}
