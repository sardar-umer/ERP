import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, TextField, Grid,
  InputAdornment, Card, CardContent, Button
} from '@mui/material';
import {
  Search as SearchIcon, Receipt as ReceiptIcon,
  Refresh as RefreshIcon, PriorityHigh as PriorityIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const STATUS_COLORS = {
  draft: 'default', pending: 'warning', approved: 'info', paid: 'success', overdue: 'error'
};

const GRN_STATUS_LABELS = {
  no_po: 'No PO Linked',
  not_received: 'Not Yet Received'
};

export default function BilledNotReceived() {
  const [data, setData]       = useState({ bills: [], total: 0, count: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', search: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.fromDate) params.fromDate = filters.fromDate;
      if (filters.toDate)   params.toDate   = filters.toDate;
      if (filters.search)   params.search   = filters.search;
      const res = await api.get('/finance/billed-not-received', { params });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load billed-not-received data');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK') : '—';

  const daysToDue = (d) => {
    if (!d) return null;
    return Math.floor((new Date(d) - Date.now()) / 864e5);
  };

  const pg = useClientPagination(data.bills);
  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <ReceiptIcon color="error" />
          <Typography variant="h5" fontWeight={700}>Billed Not Received</Typography>
          <Chip label="Prepaid Liability" size="small" color="error" variant="outlined" />
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} size="small">Refresh</Button>
      </Box>

      <Alert severity="error" icon={<PriorityIcon />} sx={{ mb: 2 }}>
        These are AP bills where goods have <strong>not yet been received</strong> via a GRN.
        These represent prepaid amounts or billing errors that need follow-up with the vendor or procurement team.
      </Alert>

      {/* Summary */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ background: 'linear-gradient(135deg, #fce4ec 0%, #f8bbd0 100%)', borderRadius: 2 }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                <ReceiptIcon color="error" fontSize="small" />
                <Typography variant="body2" color="text.secondary">Outstanding (Billed Not Received)</Typography>
              </Box>
              <Typography variant="h5" fontWeight={800} color="error.dark">{fmt(data.total)}</Typography>
              <Typography variant="caption" color="text.secondary">{data.count} bill{data.count !== 1 ? 's' : ''} without GRN</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth size="small" label="Search bill # / vendor"
              value={filters.search}
              onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" label="From Date" type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters(f => ({ ...f, fromDate: e.target.value }))}
              InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" label="To Date" type="date"
              value={filters.toDate}
              onChange={(e) => setFilters(f => ({ ...f, toDate: e.target.value }))}
              InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={12} sm={2}>
            <Button fullWidth variant="contained" onClick={load} size="small">Apply</Button>
          </Grid>
        </Grid>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'error.main' }}>
                {['Bill #', 'Vendor', 'Bill Date', 'Due Date', 'Bill Status', 'GRN Status', 'Balance Due'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.bills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                    No billed-not-received entries found — all bills have matching GRNs
                  </TableCell>
                </TableRow>
              ) : (
                pg.rows.map((bill, i) => {
                  const due = daysToDue(bill.dueDate);
                  const balance = (bill.totalAmount || 0) - (bill.amountPaid || 0);
                  return (
                    <TableRow key={bill._id || i} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} color="error.main">{bill.billNumber}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {bill.vendor?.name || (typeof bill.vendor === 'string' ? bill.vendor : '—')}
                        </Typography>
                      </TableCell>
                      <TableCell>{fmtDate(bill.billDate)}</TableCell>
                      <TableCell>
                        <Box>
                          <Typography variant="body2">{fmtDate(bill.dueDate)}</Typography>
                          {due !== null && (
                            <Chip
                              label={due < 0 ? `${Math.abs(due)}d overdue` : `${due}d left`}
                              size="small"
                              color={due < 0 ? 'error' : due < 7 ? 'warning' : 'default'}
                              sx={{ mt: 0.25 }}
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip label={bill.status} size="small" color={STATUS_COLORS[bill.status] || 'default'} />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={GRN_STATUS_LABELS[bill.grnStatus] || bill.grnStatus}
                          size="small"
                          color={bill.grnStatus === 'no_po' ? 'default' : 'warning'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700} color="error.dark">{fmt(balance)}</Typography>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              {data.bills.length > 0 && (
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={6} sx={{ fontWeight: 700 }}>Total Outstanding ({data.count} bills)</TableCell>
                  <TableCell sx={{ fontWeight: 800, color: 'error.dark' }}>{fmt(data.total)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}
    </Box>
  );
}
