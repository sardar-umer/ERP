import React, { useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Alert, Stack,
  Card, CardContent, Grid, Chip, TextField, Collapse, IconButton
} from '@mui/material';
import {
  TrendingUp as PLIcon,
  Print as PrintIcon,
  Refresh as RefreshIcon,
  PictureAsPdf as PdfIcon,
  GridOn as ExcelIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowRight as CollapseIcon
} from '@mui/icons-material';
import api from '../../services/api';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import { exportProfitLossPDF, exportProfitLossExcel } from '../../utils/reportExport';
import { printTovusElement } from '../../utils/tovusPrintBrand';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PLSectionWithSubgroups = ({ title, rows, total, color, isExpense = false }) => {
  const [openGroups, setOpenGroups] = useState({
    Utilities: true,
    Sales: true
  });

  const toggleGroup = (groupName) => {
    setOpenGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  // Partition rows into special sub-groups (e.g. Utilities, Sales) and standard individual accounts
  const grouped = {};
  const standardRows = [];

  (rows || []).forEach((r) => {
    const detail = (r.accountDetailType || '').trim();
    const category = (r.accountCategory || '').trim();
    const name = (r.accountName || '').toLowerCase();

    const isUtility =
      detail.toLowerCase() === 'utilities' ||
      category.toLowerCase() === 'utilities' ||
      name.includes('electricity') ||
      name.includes('gas charges') ||
      name.includes('water charges') ||
      name.includes('internet charges') ||
      name.includes('water-utilities');

    const isSales =
      !isExpense && (
        detail.toLowerCase() === 'sales' ||
        category.toLowerCase() === 'sales' ||
        name.includes('fee collection') ||
        name.includes('student fee')
      );

    if (isExpense && isUtility) {
      if (!grouped['Utilities']) grouped['Utilities'] = [];
      grouped['Utilities'].push(r);
    } else if (!isExpense && isSales) {
      if (!grouped['Sales']) grouped['Sales'] = [];
      grouped['Sales'].push(r);
    } else {
      standardRows.push(r);
    }
  });

  return (
    <Box mb={2.5}>
      <Typography variant="subtitle2" fontWeight={700} color={color} sx={{ mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 12 }}>
        {title}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ fontWeight: 700, width: '15%' }}>Account #</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Account Name</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: '25%' }}>Amount (PKR)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ color: 'text.secondary', py: 2.5 }}>
                  No entries for this period.
                </TableCell>
              </TableRow>
            )}

            {/* Render Standard Direct Rows */}
            {standardRows.map((r) => (
              <TableRow key={r._id || r.accountNumber} hover>
                <TableCell sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>{r.accountNumber}</TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{r.accountName}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(r.balance)}</TableCell>
              </TableRow>
            ))}

            {/* Render Sub-groups (e.g. Sales, Utilities) */}
            {Object.keys(grouped).map((groupName) => {
              const groupRows = grouped[groupName];
              const groupTotal = groupRows.reduce((s, r) => s + (Number(r.balance) || 0), 0);
              const isOpen = openGroups[groupName] !== false;

              return (
                <React.Fragment key={groupName}>
                  {/* Group Header Row */}
                  <TableRow
                    sx={{ bgcolor: 'grey.50', cursor: 'pointer' }}
                    onClick={() => toggleGroup(groupName)}
                    hover
                  >
                    <TableCell colSpan={2} sx={{ fontWeight: 700, color: 'text.primary', pl: 1.5 }}>
                      <IconButton size="small" sx={{ mr: 0.5, p: 0.2 }}>
                        {isOpen ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}
                      </IconButton>
                      <b>{groupName}</b>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                      {/* Subtotal shown on summary row or below */}
                    </TableCell>
                  </TableRow>

                  {/* Group Items (Indented) */}
                  {groupRows.map((r) => (
                    <TableRow
                      key={r._id || r.accountNumber}
                      sx={{ display: isOpen ? 'table-row' : 'none' }}
                      hover
                    >
                      <TableCell sx={{ color: 'text.secondary', fontFamily: 'monospace', pl: 4 }}>
                        {r.accountNumber}
                      </TableCell>
                      <TableCell sx={{ pl: 4, color: 'text.primary' }}>
                        <span style={{ color: '#9ca3af', marginRight: 6 }}>↳</span>
                        {r.accountName}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 500 }}>
                        {fmt(r.balance)}
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Total for Group Row */}
                  <TableRow sx={{ bgcolor: 'grey.100', display: isOpen ? 'table-row' : 'none' }}>
                    <TableCell colSpan={2} sx={{ pl: 3.5, fontWeight: 700, fontSize: '0.85rem' }}>
                      Total for {groupName}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.85rem', color }}>
                      PKR {fmt(groupTotal)}
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}

            {/* Total Section Row */}
            <TableRow sx={{ bgcolor: isExpense ? 'error.50' : 'success.50' }}>
              <TableCell colSpan={2} align="right" sx={{ fontWeight: 800, fontSize: '0.9rem' }}>
                Total {title}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 800, fontSize: '0.95rem', color }}>
                PKR {fmt(total)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default function ProfitLoss() {
  const curYear = new Date().getFullYear();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [filters, setFilters] = useState({
    fromDate: `${curYear}-01-01`,
    toDate:   new Date().toISOString().split('T')[0]
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/finance/reports/profit-loss', { params: filters });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load P&L');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useFinanceCompanyReload(load, { skipInitial: true });

  const grossProfit = data ? (Number(data.totals?.totalRevenue) || 0) : 0;

  return (
    <Box className="tv-report-area" sx={{ p: 3 }}>
      <FinanceCompanyPageHeader title="Profit & Loss (Income Statement)" icon={PLIcon}>
        <TextField
          label="From Date"
          type="date"
          size="small"
          value={filters.fromDate}
          onChange={e => setFilters({ ...filters, fromDate: e.target.value })}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="To Date"
          type="date"
          size="small"
          value={filters.toDate}
          onChange={e => setFilters({ ...filters, toDate: e.target.value })}
          InputLabelProps={{ shrink: true }}
        />
        <Button variant="contained" color="success" onClick={load} disabled={loading} startIcon={<RefreshIcon />}>
          {loading ? 'Loading…' : 'Generate'}
        </Button>
        {data && (
          <>
            <Button variant="outlined" startIcon={<PdfIcon />} color="error" onClick={() => exportProfitLossPDF(data, filters)}>PDF</Button>
            <Button variant="outlined" startIcon={<ExcelIcon />} color="success" onClick={() => exportProfitLossExcel(data, filters)}>Excel</Button>
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => printTovusElement('.tv-report-area', { title: 'Profit & Loss Statement', fit: false })}>Print</Button>
          </>
        )}
      </FinanceCompanyPageHeader>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {!data && !loading && (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">Select a date range and click Generate to view the Profit & Loss Statement.</Typography>
        </Paper>
      )}

      {data && (
        <>
          {/* Header */}
          <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: data.totals.isProfitable ? 'success.50' : 'error.50', borderColor: data.totals.isProfitable ? 'success.200' : 'error.200' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="h6" fontWeight={700}>Profit & Loss Statement</Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(data.fromDate).toLocaleDateString('en-PK', { month: 'long', day: 'numeric', year: 'numeric' })} —{' '}
                  {new Date(data.toDate).toLocaleDateString('en-PK', { month: 'long', day: 'numeric', year: 'numeric' })}
                </Typography>
              </Box>
              <Chip
                label={data.totals.isProfitable ? `Net Profit: PKR ${fmt(data.totals.netProfit)}` : `Net Loss: PKR ${fmt(Math.abs(data.totals.netProfit))}`}
                color={data.totals.isProfitable ? 'success' : 'error'}
                size="medium"
              />
            </Stack>
          </Paper>

          {/* KPI Row */}
          <Grid container spacing={2} mb={3}>
            {[
              { label: 'Total Revenue',  value: data.totals.totalRevenue,  color: 'success.main' },
              { label: 'Gross Profit',   value: grossProfit,               color: 'primary.main' },
              { label: 'Total Expenses', value: data.totals.totalExpenses, color: 'error.main'   },
              { label: data.totals.isProfitable ? 'Net Profit' : 'Net Loss', value: Math.abs(data.totals.netProfit), color: data.totals.isProfitable ? 'success.main' : 'error.main' },
            ].map(c => (
              <Grid item xs={12} sm={6} md={3} key={c.label}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                    <Typography variant="h6" fontWeight={700} color={c.color}>
                      PKR {fmt(c.value)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* P&L Sections */}
          <PLSectionWithSubgroups title="Income / Revenue" rows={data.revenue.rows} total={data.revenue.total} color="#2e7d32" isExpense={false} />
          
          {/* Gross Profit Divider / Bar */}
          <Paper variant="outlined" sx={{ p: 1.75, mb: 2.5, bgcolor: 'primary.50', borderColor: 'primary.200' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle1" fontWeight={700} color="primary.dark">
                Gross Profit
              </Typography>
              <Typography variant="h6" fontWeight={800} color="primary.dark">
                PKR {fmt(grossProfit)}
              </Typography>
            </Stack>
          </Paper>

          <PLSectionWithSubgroups title="Expenses" rows={data.expenses.rows} total={data.expenses.total} color="#c62828" isExpense={true} />

          {/* Net Profit / Earnings Summary */}
          <Paper variant="outlined" sx={{ p: 2, bgcolor: data.totals.isProfitable ? 'success.50' : 'error.50', borderColor: data.totals.isProfitable ? 'success.300' : 'error.300' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6" fontWeight={700}>
                {data.totals.isProfitable ? 'Net Profit' : 'Net Earnings (Loss)'}
              </Typography>
              <Typography variant="h5" fontWeight={800} color={data.totals.isProfitable ? 'success.main' : 'error.main'}>
                {data.totals.netProfit < 0 ? `-PKR ${fmt(Math.abs(data.totals.netProfit))}` : `PKR ${fmt(data.totals.netProfit)}`}
              </Typography>
            </Stack>
          </Paper>
        </>
      )}
    </Box>
  );
}
