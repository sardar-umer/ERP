import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Stack,
  TextField,
  MenuItem,
  Button,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Alert,
  CircularProgress,
  Divider
} from '@mui/material';
import {
  Assessment as ReportIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Paid as PaidIcon,
  ShoppingCart as POIcon,
  Description as ReqIcon,
  RequestQuote as QuoteIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import procurementService from '../../services/procurementService';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';
import useClientPagination from '../../hooks/useClientPagination';

const STATUS_COLORS = {
  Draft: 'default',
  Submitted: 'info',
  Approved: 'success',
  Rejected: 'error',
  Received: 'info',
  Shortlisted: 'warning',
  Finalized: 'success',
  'Under Review': 'warning',
  Cancelled: 'default',
  Fulfilled: 'success',
  'Partially Fulfilled': 'warning'
};

const getStatusColor = (status) => STATUS_COLORS[status] || 'default';

const toDate = (value) => {
  const d = dayjs(value);
  return d.isValid() ? d : null;
};

const ProcurementReports = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requisitions, setRequisitions] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [rangePreset, setRangePreset] = useState('30d');
  const [fromDate, setFromDate] = useState(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
  const [toDateValue, setToDateValue] = useState(dayjs().format('YYYY-MM-DD'));

  const loadReportsData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [reqRes, quoteRes, poRes, vendorRes] = await Promise.all([
        procurementService.getRequisitions({ page: 1, limit: 1000 }),
        procurementService.getQuotations({ page: 1, limit: 1000 }),
        procurementService.getPurchaseOrders({ page: 1, limit: 1000 }),
        procurementService.getVendors({ page: 1, limit: 1000 })
      ]);

      setRequisitions(reqRes?.data?.indents || []);
      setQuotations(quoteRes?.data?.quotations || []);
      setPurchaseOrders(poRes?.data?.purchaseOrders || []);
      setVendors(vendorRes?.data?.vendors || []);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load procurement reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReportsData();
  }, [loadReportsData]);

  useEffect(() => {
    const today = dayjs();
    if (rangePreset === '30d') {
      setFromDate(today.subtract(30, 'day').format('YYYY-MM-DD'));
      setToDateValue(today.format('YYYY-MM-DD'));
    } else if (rangePreset === '90d') {
      setFromDate(today.subtract(90, 'day').format('YYYY-MM-DD'));
      setToDateValue(today.format('YYYY-MM-DD'));
    } else if (rangePreset === 'ytd') {
      setFromDate(today.startOf('year').format('YYYY-MM-DD'));
      setToDateValue(today.format('YYYY-MM-DD'));
    }
  }, [rangePreset]);

  const isInRange = useCallback((dateValue) => {
    const d = toDate(dateValue);
    if (!d) return false;
    const from = toDate(fromDate);
    const to = toDate(toDateValue);
    if (!from || !to) return true;
    return (d.isAfter(from.subtract(1, 'day')) && d.isBefore(to.add(1, 'day')));
  }, [fromDate, toDateValue]);

  const filteredRequisitions = useMemo(
    () => requisitions.filter((r) => isInRange(r.requestedDate || r.createdAt)),
    [requisitions, isInRange]
  );
  const filteredQuotations = useMemo(
    () => quotations.filter((q) => isInRange(q.quotationDate || q.createdAt)),
    [quotations, isInRange]
  );
  const filteredPOs = useMemo(
    () => purchaseOrders.filter((po) => isInRange(po.orderDate || po.createdAt)),
    [purchaseOrders, isInRange]
  );

  const totalPOValue = useMemo(
    () => filteredPOs.reduce((sum, po) => sum + (Number(po.totalAmount) || 0), 0),
    [filteredPOs]
  );
  const finalizedQuotes = useMemo(
    () => filteredQuotations.filter((q) => q.status === 'Finalized').length,
    [filteredQuotations]
  );
  const approvedRequisitions = useMemo(
    () => filteredRequisitions.filter((r) => r.status === 'Approved').length,
    [filteredRequisitions]
  );

  const quotationConversionRate = useMemo(() => {
    if (!filteredQuotations.length) return 0;
    return Math.round((finalizedQuotes / filteredQuotations.length) * 100);
  }, [filteredQuotations.length, finalizedQuotes]);

  const poByStatus = useMemo(() => {
    return filteredPOs.reduce((acc, po) => {
      const key = po.status || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [filteredPOs]);

  const quoteByStatus = useMemo(() => {
    return filteredQuotations.reduce((acc, q) => {
      const key = q.status || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [filteredQuotations]);

  const vendorSpend = useMemo(() => {
    const map = new Map();
    filteredPOs.forEach((po) => {
      const vendorName = po.vendor?.name || 'Unknown Vendor';
      const current = map.get(vendorName) || { orders: 0, spend: 0 };
      current.orders += 1;
      current.spend += Number(po.totalAmount) || 0;
      map.set(vendorName, current);
    });
    return Array.from(map.entries())
      .map(([vendorName, stats]) => ({ vendorName, ...stats }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);
  }, [filteredPOs]);

  const downloadCsv = () => {
    const rows = [
      ['Report', 'From', 'To', 'Generated At'],
      ['Procurement Reports', fromDate, toDateValue, dayjs().format('YYYY-MM-DD HH:mm:ss')],
      [],
      ['KPI', 'Value'],
      ['Total Requisitions', String(filteredRequisitions.length)],
      ['Approved Requisitions', String(approvedRequisitions)],
      ['Total Quotations', String(filteredQuotations.length)],
      ['Finalized Quotations', String(finalizedQuotes)],
      ['Quotation Conversion (%)', String(quotationConversionRate)],
      ['Total Purchase Orders', String(filteredPOs.length)],
      ['Total PO Value', String(totalPOValue)],
      ['Active Vendors', String(vendors.filter((v) => v.status === 'Active').length)]
    ];

    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `procurement-reports-${dayjs().format('YYYYMMDD-HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const pg = useClientPagination(vendorSpend);
  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', minHeight: 320, alignItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main' }}>
            Procurement Reports
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Analytical view of requisitions, quotations, purchase orders, and vendor performance
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadReportsData}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<DownloadIcon />} onClick={downloadCsv}>
            Export CSV
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              select
              size="small"
              label="Range Preset"
              value={rangePreset}
              onChange={(e) => setRangePreset(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="30d">Last 30 Days</MenuItem>
              <MenuItem value="90d">Last 90 Days</MenuItem>
              <MenuItem value="ytd">Year to Date</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </TextField>
            <TextField
              size="small"
              type="date"
              label="From"
              value={fromDate}
              onChange={(e) => {
                setRangePreset('custom');
                setFromDate(e.target.value);
              }}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={toDateValue}
              onChange={(e) => {
                setRangePreset('custom');
                setToDateValue(e.target.value);
              }}
              InputLabelProps={{ shrink: true }}
            />
            <Chip
              icon={<ReportIcon />}
              label={`${fromDate} to ${toDateValue}`}
              color="primary"
              variant="outlined"
              sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
            />
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <Card><CardContent><Stack direction="row" spacing={1.5}><ReqIcon color="primary" /><Box><Typography variant="caption" color="text.secondary">Requisitions</Typography><Typography variant="h5" fontWeight={700}>{filteredRequisitions.length}</Typography><Typography variant="caption" color="text.secondary">{approvedRequisitions} approved</Typography></Box></Stack></CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card><CardContent><Stack direction="row" spacing={1.5}><QuoteIcon color="warning" /><Box><Typography variant="caption" color="text.secondary">Quotations</Typography><Typography variant="h5" fontWeight={700}>{filteredQuotations.length}</Typography><Typography variant="caption" color="text.secondary">{quotationConversionRate}% conversion</Typography></Box></Stack></CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card><CardContent><Stack direction="row" spacing={1.5}><POIcon color="info" /><Box><Typography variant="caption" color="text.secondary">Purchase Orders</Typography><Typography variant="h5" fontWeight={700}>{filteredPOs.length}</Typography><Typography variant="caption" color="text.secondary">{Object.keys(poByStatus).length} statuses</Typography></Box></Stack></CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card><CardContent><Stack direction="row" spacing={1.5}><PaidIcon color="success" /><Box><Typography variant="caption" color="text.secondary">PO Value</Typography><Typography variant="h5" fontWeight={700}>{formatPKR(totalPOValue)}</Typography><Typography variant="caption" color="text.secondary">{vendors.length} vendors</Typography></Box></Stack></CardContent></Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>PO Status Breakdown</Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Stack spacing={1}>
                {Object.entries(poByStatus).length === 0 ? (
                  <Typography color="text.secondary" variant="body2">No purchase order data</Typography>
                ) : (
                  Object.entries(poByStatus).map(([status, count]) => (
                    <Stack key={status} direction="row" justifyContent="space-between" alignItems="center">
                      <Chip size="small" label={status} color={getStatusColor(status)} />
                      <Typography fontWeight={700}>{count}</Typography>
                    </Stack>
                  ))
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Quotation Status Breakdown</Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Stack spacing={1}>
                {Object.entries(quoteByStatus).length === 0 ? (
                  <Typography color="text.secondary" variant="body2">No quotation data</Typography>
                ) : (
                  Object.entries(quoteByStatus).map(([status, count]) => (
                    <Stack key={status} direction="row" justifyContent="space-between" alignItems="center">
                      <Chip size="small" label={status} color={getStatusColor(status)} />
                      <Typography fontWeight={700}>{count}</Typography>
                    </Stack>
                  ))
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Report Summary</Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Stack spacing={1}>
                <Typography variant="body2"><strong>Date Range:</strong> {fromDate} to {toDateValue}</Typography>
                <Typography variant="body2"><strong>Avg PO Value:</strong> {filteredPOs.length ? formatPKR(totalPOValue / filteredPOs.length) : formatPKR(0)}</Typography>
                <Typography variant="body2"><strong>Finalized Quotations:</strong> {finalizedQuotes}</Typography>
                <Typography variant="body2"><strong>Approved Requisitions:</strong> {approvedRequisitions}</Typography>
                <Typography variant="body2"><strong>Generated At:</strong> {dayjs().format('DD-MMM-YYYY HH:mm')}</Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Top Vendors by Spend</Typography>
              <Divider sx={{ mb: 1.5 }} />
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Vendor</strong></TableCell>
                      <TableCell><strong>Orders</strong></TableCell>
                      <TableCell align="right"><strong>Total Spend</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {vendorSpend.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} align="center">
                          <Typography variant="body2" color="text.secondary">No vendor spend data available</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pg.rows.map((v) => (
                        <TableRow key={v.vendorName} hover>
                          <TableCell>{v.vendorName}</TableCell>
                          <TableCell>{v.orders}</TableCell>
                          <TableCell align="right">{formatPKR(v.spend)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>{pg.bar}
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Recent Procurement Activity</Typography>
              <Divider sx={{ mb: 1.5 }} />
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Type</strong></TableCell>
                      <TableCell><strong>Reference</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell><strong>Date</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...filteredPOs.slice(0, 4).map((po) => ({ type: 'Purchase Order', ref: po.orderNumber || '-', status: po.status || '-', date: po.orderDate || po.createdAt })), ...filteredQuotations.slice(0, 4).map((q) => ({ type: 'Quotation', ref: q.quotationNumber || '-', status: q.status || '-', date: q.quotationDate || q.createdAt })), ...filteredRequisitions.slice(0, 4).map((r) => ({ type: 'Requisition', ref: r.indentNumber || '-', status: r.status || '-', date: r.requestedDate || r.createdAt }))].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).map((row, idx) => (
                      <TableRow key={`${row.type}-${row.ref}-${idx}`} hover>
                        <TableCell>{row.type}</TableCell>
                        <TableCell>{row.ref}</TableCell>
                        <TableCell><Chip size="small" label={row.status} color={getStatusColor(row.status)} /></TableCell>
                        <TableCell>{formatDate(row.date)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProcurementReports;
