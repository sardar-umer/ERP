import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Alert,
  Stack,
  CircularProgress,
  InputAdornment,
  Autocomplete
} from '@mui/material';
import {
  Assessment as ReportsIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Person as PersonIcon,
  AccountBalance as TransactionIcon,
  GetApp as DownloadIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { fetchReports, fetchAllInvoices } from '../../../services/propertyInvoiceService';
import { fetchResidentLedger } from '../../../services/tajResidentsService';
import { generateResidentLedgerPDF } from '../../../utils/residentLedgerPDF';
import {
  buildLedgerSectionDisplayRows,
  getLedgerTotalOutstandingBalance
} from '../../../utils/residentLedgerDisplay';
import DepositReconciliationReport from './DepositReconciliationReport';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

const ALL_PROPERTIES_OPTION = { _id: '', label: 'All properties' };

const getTransactionTypeLabel = (type) => {
  const t = (type || '').toLowerCase();
  if (t === 'deposit') return { color: 'success', label: 'Deposit' };
  if (t === 'bill_payment' || t === 'payment') return { color: 'info', label: 'Payment' };
  if (t === 'withdraw') return { color: 'error', label: 'Withdraw' };
  if (t === 'transfer') return { color: 'primary', label: 'Transfer' };
  return { color: 'default', label: t || '—' };
};

const TajUtilitiesReports = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startMonth, setStartMonth] = useState(dayjs().subtract(11, 'month').format('YYYY-MM'));
  const [endMonth, setEndMonth] = useState(dayjs().format('YYYY-MM'));
  const [chargeTypeFilter, setChargeTypeFilter] = useState('all');
  const [report, setReport] = useState({ byMonth: [], totals: {} });

  const CHARGE_TYPE_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'CAM', label: 'CAM Charges' },
    { value: 'WATER', label: 'Water Bills' },
    { value: 'ELECTRICITY', label: 'Electricity Bills' },
    { value: 'RENT', label: 'Rental Management' },
    { value: 'OPEN_INVOICE', label: 'Open Invoices' },
    { value: 'DEPOSITS', label: 'Deposits' }
  ];

  const [ledgerResidentId, setLedgerResidentId] = useState('');
  const [ledgerPropertyId, setLedgerPropertyId] = useState('');
  const [ledgerPropertyOptions, setLedgerPropertyOptions] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState('');
  const [ledger, setLedger] = useState(null);
  // When several residents share the typed Resident ID: the choices, and the one the user picked
  const [ledgerCandidates, setLedgerCandidates] = useState([]);
  const [ledgerResidentKey, setLedgerResidentKey] = useState('');

  const getPropertyOptionLabel = (property) => {
    if (!property) return '';
    const parts = [
      property.srNo != null ? `Sr ${property.srNo}` : null,
      property.plotNumber || property.propertyName,
      property.ownerName
    ].filter(Boolean);
    return parts.join(' — ') || 'Property';
  };
  const [exportingMonthKey, setExportingMonthKey] = useState(null);

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = { startMonth, endMonth };
      if (chargeTypeFilter && chargeTypeFilter !== 'all') {
        params.chargeType = chargeTypeFilter;
      }
      const response = await fetchReports(params);
      const data = response.data?.data || {};
      setReport({
        byMonth: data.byMonth || [],
        totals: data.totals || {}
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load report');
      setReport({ byMonth: [], totals: {} });
    } finally {
      setLoading(false);
    }
  }, [startMonth, endMonth, chargeTypeFilter]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const loadLedger = useCallback(async (propertyIdOverride, residentKeyOverride) => {
    const typedId = (ledgerResidentId || '').trim();
    if (!typedId) {
      setLedgerError('Please enter Resident ID');
      return;
    }
    // A resident picked from a shared ID is loaded by its own record, not by the ID again
    const id = residentKeyOverride || ledgerResidentKey || typedId;
    const propertyId = propertyIdOverride !== undefined ? propertyIdOverride : ledgerPropertyId;
    try {
      setLedgerLoading(true);
      setLedgerError('');
      setLedger(null);
      const params = propertyId ? { propertyId } : {};
      const response = await fetchResidentLedger(id, params);
      const data = response.data?.data || {};
      if (data.ambiguous) {
        setLedgerCandidates(data.candidates || []);
        setLedgerPropertyOptions([]);
        return;
      }
      setLedgerCandidates([]);
      setLedger(data);
      const properties = data.resident?.properties || [];
      setLedgerPropertyOptions(properties);
      if (propertyIdOverride !== undefined) {
        setLedgerPropertyId(propertyIdOverride);
      }
    } catch (err) {
      setLedgerError(err.response?.data?.message || 'Failed to load ledger');
      setLedger(null);
    } finally {
      setLedgerLoading(false);
    }
  }, [ledgerResidentId, ledgerPropertyId, ledgerResidentKey]);

  const exportMonthInvoicesToExcel = useCallback(async (monthKey) => {
    if (!monthKey) return;
    try {
      setExportingMonthKey(monthKey);
      const params = { monthYear: monthKey, limit: 10000 };
      if (chargeTypeFilter && chargeTypeFilter !== 'all') {
        params.chargeType = chargeTypeFilter;
        if (chargeTypeFilter === 'OPEN_INVOICE') params.openInvoices = 'true';
      }
      const response = await fetchAllInvoices(params);
      const invoices = response.data?.data || [];
      const monthData = report.byMonth.find((r) => r.month === monthKey);
      const deposits = monthData?.deposits || [];

      const headers = [
        'Invoice #',
        'Resident ID',
        'Property',
        'Owner',
        'Address',
        'Charge Types',
        'Period From',
        'Period To',
        'Due Date',
        'Deposit Date',
        'Invoice Amount (Subtotal)',
        'Arrears',
        'Grand Total',
        'Paid',
        'Balance',
        'Payment Status',
        'Status',
        'Recorded By',
        'Customer Name',
        'Customer Address',
        'Sector'
      ];
      const rows = invoices.map((inv) => {
        const isOpen = !inv.property;
        const residentId = isOpen ? '—' : (inv.property?.resident?.residentId ?? inv.property?.residentId ?? '—');
        const propertyName = isOpen ? (inv.customerName || 'Open Invoice') : (inv.property?.propertyName || inv.property?.plotNumber || '—');
        const owner = isOpen ? (inv.customerName || '—') : (inv.property?.ownerName || '—');
        const address = isOpen ? (inv.customerAddress || '—') : (inv.property?.address || inv.property?.resident?.address || inv.customerAddress || '—');
        const chargeTypes = Array.isArray(inv.chargeTypes) ? inv.chargeTypes.join(', ') : (inv.chargeTypes || '—');
        const recordedBy = inv.createdBy ? [inv.createdBy.firstName, inv.createdBy.lastName].filter(Boolean).join(' ') : '—';
        const num = (v) => Number(v) || 0;
        const paid = inv.totalPaid != null && inv.totalPaid !== ''
          ? num(inv.totalPaid)
          : (Array.isArray(inv.payments) ? inv.payments.reduce((sum, p) => sum + (num(p.amount) || num(p.totalAmount)), 0) : 0);
        const residentDeposits = (deposits || []).filter((d) => String(d.residentId || '').trim() !== '' && String(residentId || '').trim() !== '' && String(d.residentId) === String(residentId));
        const depositDateStr = residentDeposits.length > 0
          ? residentDeposits
              .map((d) => d.depositDate ? dayjs(d.depositDate).format('DD MMM YYYY') : null)
              .filter(Boolean)
              .join(', ') || '—'
          : '—';
        return [
          inv.invoiceNumber || '—',
          residentId,
          propertyName,
          owner,
          address,
          chargeTypes,
          inv.periodFrom ? dayjs(inv.periodFrom).format('DD MMM YYYY') : '—',
          inv.periodTo ? dayjs(inv.periodTo).format('DD MMM YYYY') : '—',
          inv.dueDate ? dayjs(inv.dueDate).format('DD MMM YYYY') : '—',
          depositDateStr,
          num(inv.subtotal),
          num(inv.totalArrears),
          num(inv.grandTotal),
          paid,
          num(inv.balance),
          inv.paymentStatus || '—',
          inv.status || '—',
          recordedBy,
          inv.customerName || '—',
          inv.customerAddress || '—',
          inv.sector || (inv.property?.sector?.name ?? inv.property?.sector ?? '—')
        ];
      });
      const { Workbook } = await import('exceljs');
      const workbook = new Workbook();

      const worksheet = workbook.addWorksheet('Invoices', { views: [{ state: 'frozen', ySplit: 1 }] });
      const colWidths = [20, 14, 26, 22, 28, 24, 14, 14, 14, 16, 18, 16, 18, 16, 16, 14, 12, 18, 22, 24, 12];
      headers.forEach((h, i) => {
        worksheet.getColumn(i + 1).width = colWidths[i] || 12;
      });
      const headerRow = worksheet.addRow(headers);
      headerRow.font = { bold: true, size: 12 };
      headerRow.alignment = { vertical: 'middle' };
      rows.forEach((row) => worksheet.addRow(row));

      const totalInvoiceAmount = rows.reduce((s, row) => s + (Number(row[10]) || 0), 0);
      const totalArrears = rows.reduce((s, row) => s + (Number(row[11]) || 0), 0);
      const totalGrandTotal = rows.reduce((s, row) => s + (Number(row[12]) || 0), 0);
      const totalPaid = rows.reduce((s, row) => s + (Number(row[13]) || 0), 0);
      const totalBalance = rows.reduce((s, row) => s + (Number(row[14]) || 0), 0);
      const totalsRow = [
        '', '', '', '', '', '', '', '', '', '',
        totalInvoiceAmount,
        totalArrears,
        totalGrandTotal,
        totalPaid,
        totalBalance,
        '', '', '', '', '', ''
      ];
      const totalsRowNode = worksheet.addRow(totalsRow);
      totalsRowNode.font = { bold: true, size: 11 };
      totalsRowNode.getCell(1).value = 'Total';
      totalsRowNode.getCell(11).numFmt = '#,##0.00';
      totalsRowNode.getCell(12).numFmt = '#,##0.00';
      totalsRowNode.getCell(13).numFmt = '#,##0.00';
      totalsRowNode.getCell(14).numFmt = '#,##0.00';
      totalsRowNode.getCell(15).numFmt = '#,##0.00';

      const depositHeaders = ['Deposit Date', 'Resident ID', 'Resident Name', 'Amount'];
      const depositRows = deposits.map((d) => [
        d.depositDate ? dayjs(d.depositDate).format('DD MMM YYYY HH:mm') : '—',
        d.residentId || '—',
        d.residentName || '—',
        Number(d.amount) || 0
      ]);
      const depositSheet = workbook.addWorksheet('Deposits', { views: [{ state: 'frozen', ySplit: 1 }] });
      [14, 14, 22, 14].forEach((w, i) => depositSheet.getColumn(i + 1).width = w);
      const depositHeaderRow = depositSheet.addRow(depositHeaders);
      depositHeaderRow.font = { bold: true, size: 12 };
      depositHeaderRow.alignment = { vertical: 'middle' };
      depositRows.forEach((row) => depositSheet.addRow(row));

      const filename = `report-${monthKey}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to export invoices');
    } finally {
      setExportingMonthKey(null);
    }
  }, [report.byMonth, chargeTypeFilter]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <ReportsIcon color="primary" />
        <Typography variant="h5" fontWeight={600}>
          Taj Utilities Reports
        </Typography>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4} md={2}>
              <TextField
                fullWidth
                label="Start Month"
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4} md={2}>
              <TextField
                fullWidth
                label="End Month"
                type="month"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Charge Type</InputLabel>
                <Select
                  value={chargeTypeFilter}
                  label="Charge Type"
                  onChange={(e) => setChargeTypeFilter(e.target.value)}
                >
                  {CHARGE_TYPE_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4} md={2}>
              <Button
                fullWidth
                variant="contained"
                startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />}
                onClick={loadReport}
                disabled={loading}
              >
                Refresh
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {chargeTypeFilter === 'DEPOSITS' ? 'Total Suspense Amount' : 'Total Invoice Amount'}
              </Typography>
              <Typography variant="h6" fontWeight={700}>
                {formatCurrency(report.totals.invoiceAmount)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {chargeTypeFilter === 'DEPOSITS' ? 'Total Deposits' : 'Total Arrears'}
              </Typography>
              <Typography variant="h6" fontWeight={700} color="warning.main">
                {formatCurrency(report.totals.arrears)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Total Payments Received
              </Typography>
              <Typography variant="h6" fontWeight={700} color="success.main">
                {formatCurrency(report.totals.paymentsReceived)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Total Invoices
              </Typography>
              <Typography variant="h6" fontWeight={700}>
                {report.totals.invoiceCount ?? 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Month-wise table */}
      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
            Month-wise Breakdown
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {chargeTypeFilter === 'DEPOSITS'
              ? 'Suspense Amount and Deposits by month; Payments Received = Suspense + Deposits.'
              : 'Invoice Amount, Arrears, and Payments Received are all grouped by billing period (invoice month), matching the Invoices page.'}
          </Typography>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : report.byMonth.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No data for the selected period
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell><strong>Month</strong></TableCell>
                    <TableCell align="right"><strong>{chargeTypeFilter === 'DEPOSITS' ? 'Suspense Amount' : 'Invoice Amount'}</strong></TableCell>
                    <TableCell align="right"><strong>{chargeTypeFilter === 'DEPOSITS' ? 'Deposits' : 'Arrears'}</strong></TableCell>
                    <TableCell align="right"><strong>Payments Received</strong></TableCell>
                    <TableCell align="right"><strong>Invoices</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.byMonth.map((row) => (
                    <TableRow key={row.month} hover>
                      <TableCell>{row.monthLabel}</TableCell>
                      <TableCell align="right">{formatCurrency(row.invoiceAmount)}</TableCell>
                      <TableCell align="right" sx={{ color: 'warning.main' }}>
                        {formatCurrency(row.arrears)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>
                        {formatCurrency(row.paymentsReceived)}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.5}>
                          <span>{row.invoiceCount}</span>
                          {row.invoiceCount > 0 && (
                            <Tooltip title="Download invoices report (Excel)">
                              <IconButton
                                size="small"
                                color="success"
                                onClick={() => exportMonthInvoicesToExcel(row.month)}
                                disabled={!!exportingMonthKey}
                              >
                                {exportingMonthKey === row.month ? (
                                  <CircularProgress size={18} color="inherit" />
                                ) : (
                                  <DownloadIcon fontSize="small" />
                                )}
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <DepositReconciliationReport />

      {/* Resident Ledger */}
      <Card sx={{ mt: 4 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <PersonIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              Resident Ledger
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter Resident ID, optionally select a property, then view invoices, deposits, and transactions.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" sx={{ mb: 2 }}>
            <TextField
              size="small"
              label="Resident ID"
              placeholder="e.g. 00001"
              value={ledgerResidentId}
              onChange={(e) => {
                setLedgerResidentId(e.target.value);
                setLedgerResidentKey('');
                setLedgerCandidates([]);
                setLedgerPropertyId('');
                setLedgerPropertyOptions([]);
                setLedger(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && loadLedger()}
              sx={{ minWidth: 200 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                )
              }}
            />
            <Autocomplete
              size="small"
              sx={{ minWidth: 280, flex: 1 }}
              options={[ALL_PROPERTIES_OPTION, ...ledgerPropertyOptions]}
              value={
                ledgerPropertyId
                  ? ledgerPropertyOptions.find((p) => String(p._id) === String(ledgerPropertyId)) || null
                  : ALL_PROPERTIES_OPTION
              }
              onChange={(_, newValue) => {
                const nextId = newValue && newValue._id ? String(newValue._id) : '';
                setLedgerPropertyId(nextId);
                if (ledgerResidentId.trim() && (ledger || ledgerPropertyOptions.length > 0)) {
                  loadLedger(nextId);
                }
              }}
              getOptionLabel={(option) => (option?.label ? option.label : getPropertyOptionLabel(option))}
              isOptionEqualToValue={(option, value) => String(option?._id || '') === String(value?._id || '')}
              disabled={ledgerLoading || ledgerPropertyOptions.length === 0}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Property"
                  placeholder={ledgerPropertyOptions.length ? 'All properties' : 'Load resident first'}
                />
              )}
            />
            <Button
              variant="contained"
              onClick={() => loadLedger()}
              disabled={ledgerLoading || !ledgerResidentId.trim()}
              startIcon={ledgerLoading ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
            >
              {ledgerLoading ? 'Loading...' : 'View Ledger'}
            </Button>
          </Stack>

          {ledgerError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLedgerError('')}>
              {ledgerError}
            </Alert>
          )}

          {ledgerCandidates.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Resident ID {ledgerResidentId.trim()} is used by {ledgerCandidates.length} residents — choose the one you want:
              </Typography>
              <Stack spacing={1}>
                {ledgerCandidates.map((c) => (
                  <Stack key={c._id} direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        setLedgerResidentKey(String(c._id));
                        setLedgerPropertyId('');
                        loadLedger('', String(c._id));
                      }}
                    >
                      View Ledger
                    </Button>
                    <Typography variant="body2">
                      <strong>{c.name || '(no name)'}</strong>
                      {c.cnic ? ` · CNIC ${c.cnic}` : ''}
                      {c.properties?.length ? ` · ${c.properties.join(', ')}` : ' · no property'}
                      {c.isActive === false ? ' · inactive' : ''}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Alert>
          )}

          {ledger && (
            <>
              <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={<DownloadIcon />}
                  onClick={() => generateResidentLedgerPDF(ledger, { openInNewTab: false })}
                >
                  Download PDF
                </Button>
              </Stack>

              {/* Resident Information (as per sketch) */}
              {(() => {
                const allLedgerLists = [
                  (ledger.invoices || []).filter((inv) => inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'CAM'),
                  (ledger.invoices || []).filter((inv) => inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'WATER'),
                  (ledger.invoices || []).filter((inv) => inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'ELECTRICITY'),
                  (ledger.invoices || []).filter((inv) => inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'RENT'),
                  (ledger.invoices || []).filter((inv) => {
                    const types = inv.chargeTypes || [];
                    if (types.length === 0) return true;
                    if (types.length > 1) return true;
                    return !['CAM', 'WATER', 'ELECTRICITY', 'RENT'].includes(types[0]);
                  })
                ];
                const totalOutstandingBalance = getLedgerTotalOutstandingBalance(allLedgerLists);

                return (
                  <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: 'grey.50' }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                      Resident Information
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" color="text.secondary" display="block">Resident ID</Typography>
                        <Typography variant="body2" fontWeight={500}>{ledger.resident?.residentId || '—'}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" color="text.secondary" display="block">Name</Typography>
                        <Typography variant="body2" fontWeight={500}>{ledger.resident?.name || '—'}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" color="text.secondary" display="block">CNIC</Typography>
                        <Typography variant="body2" fontWeight={500}>{ledger.resident?.cnic || '—'}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" color="text.secondary" display="block">Contact</Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {[ledger.resident?.contactNumber, ledger.resident?.email].filter(Boolean).join(' • ') || '—'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" color="text.secondary" display="block">Address</Typography>
                        <Typography variant="body2" fontWeight={500}>{ledger.resident?.address || '—'}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" color="text.secondary" display="block">Sector</Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {ledger.selectedProperty?.sector?.name
                            ?? ledger.selectedProperty?.sector
                            ?? ledger.resident?.properties?.[0]?.sector?.name
                            ?? ledger.resident?.properties?.[0]?.sector
                            ?? '—'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" color="text.secondary" display="block">Property</Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {ledger.selectedProperty
                            ? getPropertyOptionLabel(ledger.selectedProperty)
                            : 'All properties'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" color="text.secondary" display="block">Balance</Typography>
                        <Typography variant="body2" fontWeight={600} color="primary.main">
                          {formatCurrency(totalOutstandingBalance)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Paper>
                );
              })()}

              {/* Partition invoices by charge type */}
              {(() => {
                const invoices = ledger.invoices || [];
                const camInvoices = invoices.filter(inv =>
                  inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'CAM'
                );
                const waterInvoices = invoices.filter(inv =>
                  inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'WATER'
                );
                const electricityInvoices = invoices.filter(inv =>
                  inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'ELECTRICITY'
                );
                const rentInvoices = invoices.filter(inv =>
                  inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'RENT'
                );
                const otherInvoices = invoices.filter(inv => {
                  const types = inv.chargeTypes || [];
                  if (types.length === 0) return true;
                  if (types.length > 1) return true;
                  return !['CAM', 'WATER', 'ELECTRICITY', 'RENT'].includes(types[0]);
                });

                const ledgerTable = (title, list) => {
                  const displayRows = buildLedgerSectionDisplayRows(list);
                  const totalInvoiceAmount = displayRows.reduce((sum, r) => sum + r.invoiceAmount, 0);
                  const totalArrears = displayRows.reduce((sum, r) => sum + (r.arrears || 0), 0);
                  const totalAmountDue = displayRows.reduce((sum, r) => sum + r.amountDue, 0);
                  const totalBalance = displayRows.reduce((sum, r) => sum + r.balance, 0);

                  return (
                    <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ bgcolor: 'action.hover' }}>
                            <TableCell><strong>Invoice Date</strong></TableCell>
                            <TableCell><strong>Invoice No</strong></TableCell>
                            <TableCell><strong>Due Date</strong></TableCell>
                            <TableCell><strong>Period From</strong></TableCell>
                            <TableCell><strong>Period To</strong></TableCell>
                            <TableCell align="right"><strong>Invoice Amount</strong></TableCell>
                            <TableCell align="right"><strong>Arrears</strong></TableCell>
                            <TableCell align="right"><strong>Amount Due</strong></TableCell>
                            <TableCell align="right"><strong>Balance</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {list.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={9} align="center" sx={{ py: 2 }}>
                                <Typography variant="body2" color="text.secondary">No records</Typography>
                              </TableCell>
                            </TableRow>
                          ) : (
                            <>
                              {displayRows.map((row) => (
                                <TableRow key={row.inv._id}>
                                  <TableCell>{row.inv.invoiceDate ? dayjs(row.inv.invoiceDate).format('DD MMM YYYY') : '—'}</TableCell>
                                  <TableCell>{row.inv.invoiceNumber}</TableCell>
                                  <TableCell>{row.inv.dueDate ? dayjs(row.inv.dueDate).format('DD MMM YYYY') : '—'}</TableCell>
                                  <TableCell>{row.inv.periodFrom ? dayjs(row.inv.periodFrom).format('DD MMM YY') : '—'}</TableCell>
                                  <TableCell>{row.inv.periodTo ? dayjs(row.inv.periodTo).format('DD MMM YY') : '—'}</TableCell>
                                  <TableCell align="right">{formatCurrency(row.invoiceAmount)}</TableCell>
                                  <TableCell align="right" sx={{ color: row.arrears ? 'warning.main' : 'text.secondary' }}>
                                    {row.arrears != null ? formatCurrency(row.arrears) : '—'}
                                  </TableCell>
                                  <TableCell align="right">{formatCurrency(row.amountDue)}</TableCell>
                                  <TableCell align="right" sx={{ color: row.balance > 0 ? 'warning.main' : 'text.primary' }}>
                                    {formatCurrency(row.balance)}
                                  </TableCell>
                                </TableRow>
                              ))}
                              <TableRow sx={{ bgcolor: 'grey.100' }}>
                                <TableCell colSpan={5} align="right"><strong>Total:</strong></TableCell>
                                <TableCell align="right"><strong>{formatCurrency(totalInvoiceAmount)}</strong></TableCell>
                                <TableCell align="right" sx={{ color: 'warning.main' }}><strong>{formatCurrency(totalArrears)}</strong></TableCell>
                                <TableCell align="right"><strong>{formatCurrency(totalAmountDue)}</strong></TableCell>
                                <TableCell align="right" sx={{ color: totalBalance > 0 ? 'warning.main' : 'text.primary' }}>
                                  <strong>{formatCurrency(totalBalance)}</strong>
                                </TableCell>
                              </TableRow>
                            </>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  );
                };

                return (
                  <>
                    {/* CAM Charges */}
                    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, mt: 2 }}>
                      CAM Charges
                    </Typography>
                    {ledgerTable('CAM', camInvoices)}

                    {/* Electricity Bill */}
                    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, mt: 2 }}>
                      Electricity Bill
                    </Typography>
                    {ledgerTable('Electricity', electricityInvoices)}

                    {/* Water Bills */}
                    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, mt: 2 }}>
                      Water Bills
                    </Typography>
                    {ledgerTable('Water', waterInvoices)}

                    {/* Rental Management */}
                    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, mt: 2 }}>
                      Rental Management
                    </Typography>
                    {ledgerTable('Rental', rentInvoices)}

                    {/* Other / Mixed (if any) */}
                    {otherInvoices.length > 0 && (
                      <>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, mt: 2 }}>
                          Other / Mixed
                        </Typography>
                        {ledgerTable('Other', otherInvoices)}
                      </>
                    )}

                    {/* Transactions */}
                    {(() => {
                      const depositTransactions = (ledger.transactions || []).filter(t => t.transactionType === 'deposit');
                      return (
                        <>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, mt: 3 }}>
                            <TransactionIcon sx={{ fontSize: 20, verticalAlign: 'middle', mr: 0.5 }} />
                            Transactions ({depositTransactions.length})
                          </Typography>
                          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
                            <Table size="small" stickyHeader>
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'action.hover' }}>
                                  <TableCell><strong>Date</strong></TableCell>
                                  <TableCell><strong>Type</strong></TableCell>
                                  <TableCell><strong>Description</strong></TableCell>
                                  <TableCell align="right"><strong>Amount</strong></TableCell>
                                  <TableCell><strong>Ref</strong></TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {depositTransactions.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={5} align="center" sx={{ py: 2 }}>
                                      <Typography variant="body2" color="text.secondary">No transactions</Typography>
                                    </TableCell>
                                  </TableRow>
                                ) : (
                                  depositTransactions.map((txn) => {
                                    const typeConfig = getTransactionTypeLabel(txn.transactionType);
                                    const diff = (txn.balanceAfter ?? 0) - (txn.balanceBefore ?? 0);
                                    const isCredit = diff >= 0;
                                    return (
                                      <TableRow key={txn._id}>
                                        <TableCell>{dayjs(txn.createdAt).format('DD MMM YYYY')}</TableCell>
                                        <TableCell>
                                          <Chip size="small" color={typeConfig.color} label={typeConfig.label} />
                                        </TableCell>
                                        <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {txn.description || '—'}
                                        </TableCell>
                                        <TableCell align="right">
                                          <Typography component="span" color={isCredit ? 'success.main' : 'error.main'}>
                                            {isCredit ? '+' : '-'}{formatCurrency(Math.abs(txn.amount || 0))}
                                          </Typography>
                                          {txn.transactionType === 'deposit' && txn.remainingAmount != null && (
                                            <Typography variant="caption" display="block" color="text.secondary">
                                              Remaining: {formatCurrency(txn.remainingAmount)}
                                            </Typography>
                                          )}
                                        </TableCell>
                                        <TableCell>{txn.referenceNumberExternal || txn.referenceNumber || '—'}</TableCell>
                                      </TableRow>
                                    );
                                  })
                                )}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </>
                      );
                    })()}
                  </>
                );
              })()}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default TajUtilitiesReports;
