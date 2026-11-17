import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, TextField, Grid,
  InputAdornment, Card, CardContent, Button, Tooltip
} from '@mui/material';
import {
  Search as SearchIcon, Inbox as InboxIcon,
  Refresh as RefreshIcon, WarningAmber as WarningIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

export default function BillToReceive() {
  const [data, setData]       = useState({ grns: [], totalAccrual: 0, count: 0 });
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
      const res = await api.get('/finance/bill-to-receive', { params });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load pending bills');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK') : '—';

  const daysSince = (d) => {
    if (!d) return '—';
    const diff = Math.floor((Date.now() - new Date(d)) / (1000 * 60 * 60 * 24));
    return `${diff}d ago`;
  };

  const pg = useClientPagination(data.grns);
  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <InboxIcon color="warning" />
          <Typography variant="h5" fontWeight={700}>Bill to Receive</Typography>
          <Chip label="Accrual Gap" size="small" color="warning" variant="outlined" />
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} size="small">Refresh</Button>
      </Box>

      <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
        These are GRNs that have been received but the vendor has not yet sent a bill. They represent an accrued liability (GRNI Clearing Account).
        Go to <strong>Vendors → Vendor Bills</strong> and create a bill from the GRN to clear this.
      </Alert>

      {/* Summary */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ background: 'linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%)', borderRadius: 2 }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                <InboxIcon color="warning" fontSize="small" />
                <Typography variant="body2" color="text.secondary">Pending Accrual Value</Typography>
              </Box>
              <Typography variant="h5" fontWeight={800} color="warning.dark">{fmt(data.totalAccrual)}</Typography>
              <Typography variant="caption" color="text.secondary">{data.count} GRN{data.count !== 1 ? 's' : ''} awaiting vendor bill</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth size="small" label="Search GRN number"
              value={filters.search}
              onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" label="Received From" type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters(f => ({ ...f, fromDate: e.target.value }))}
              InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" label="Received To" type="date"
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
              <TableRow sx={{ bgcolor: 'warning.main' }}>
                {['GRN #', 'PO Reference', 'Received Date', 'Age', 'GRN Status', 'Accrual Value'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.grns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                    No pending bills to receive — all GRNs have been billed
                  </TableCell>
                </TableRow>
              ) : (
                pg.rows.map((grn, i) => {
                  const age = grn.receiveDate ? Math.floor((Date.now() - new Date(grn.receiveDate)) / 864e5) : 0;
                  return (
                    <TableRow key={grn._id || i} hover
                      sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' }, ...(age > 30 ? { bgcolor: 'orange.50' } : {}) }}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} color="warning.dark">{grn.grnNumber}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="primary.main">
                          {grn.purchaseOrder?.orderNumber || '—'}
                        </Typography>
                        {grn.purchaseOrder?.vendor && (
                          <Typography variant="caption" color="text.secondary">
                            {typeof grn.purchaseOrder.vendor === 'string' ? grn.purchaseOrder.vendor : grn.purchaseOrder.vendor?.name}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{fmtDate(grn.receiveDate)}</TableCell>
                      <TableCell>
                        <Chip
                          label={daysSince(grn.receiveDate)}
                          size="small"
                          color={age > 30 ? 'error' : age > 14 ? 'warning' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip label={grn.status} size="small"
                          color={grn.status === 'Complete' ? 'success' : grn.status === 'Partial' ? 'warning' : 'info'} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700} color="warning.dark">
                          {fmt(grn.accrualValue)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              {data.grns.length > 0 && (
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={5} sx={{ fontWeight: 700 }}>Total Accrual ({data.count} GRNs pending)</TableCell>
                  <TableCell sx={{ fontWeight: 800, color: 'warning.dark' }}>{fmt(data.totalAccrual)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}
    </Box>
  );
}
