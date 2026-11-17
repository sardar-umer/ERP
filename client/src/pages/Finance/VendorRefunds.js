import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, TextField, Grid,
  InputAdornment, Card, CardContent, Button, Select, MenuItem,
  FormControl, InputLabel, Tooltip
} from '@mui/material';
import {
  Search as SearchIcon, AssignmentReturn as RefundIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const STATUS_COLORS = { draft: 'default', confirmed: 'warning', posted: 'success' };
const REASON_LABELS = {
  defective: 'Defective', wrong_item: 'Wrong Item', over_delivered: 'Over Delivered',
  quality_issue: 'Quality Issue', other: 'Other'
};

export default function VendorRefunds() {
  const [data, setData]       = useState({ returns: [], total: 0, count: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', search: '', status: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.fromDate) params.fromDate = filters.fromDate;
      if (filters.toDate)   params.toDate   = filters.toDate;
      if (filters.search)   params.search   = filters.search;
      if (filters.status)   params.status   = filters.status;
      const res = await api.get('/finance/vendor-refunds', { params });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load vendor refunds');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK') : '—';

  const pg = useClientPagination(data.returns);
  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <RefundIcon color="error" />
          <Typography variant="h5" fontWeight={700}>Vendor Refunds</Typography>
          <Chip label="Purchase Returns" size="small" color="error" variant="outlined" />
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} size="small">Refresh</Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Vendor refunds represent goods returned to suppliers. Each posted return generates a reversal journal entry (DR Accounts Payable / CR Inventory).
      </Alert>

      {/* Summary */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ background: 'linear-gradient(135deg, #fce4ec 0%, #f8bbd0 100%)', borderRadius: 2 }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                <RefundIcon color="error" fontSize="small" />
                <Typography variant="body2" color="text.secondary">Total Refund Value</Typography>
              </Box>
              <Typography variant="h5" fontWeight={800} color="error.dark">{fmt(data.total)}</Typography>
              <Typography variant="caption" color="text.secondary">{data.count} return{data.count !== 1 ? 's' : ''}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={3}>
            <TextField
              fullWidth size="small" label="Search return # / supplier"
              value={filters.search}
              onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField fullWidth size="small" label="From Date" type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters(f => ({ ...f, fromDate: e.target.value }))}
              InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField fullWidth size="small" label="To Date" type="date"
              value={filters.toDate}
              onChange={(e) => setFilters(f => ({ ...f, toDate: e.target.value }))}
              InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={filters.status} label="Status"
                onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}>
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="confirmed">Confirmed</MenuItem>
                <MenuItem value="posted">Posted</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} sm={2}>
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
                {['Return #', 'Supplier', 'Return Date', 'Reason', 'GRN Ref', 'Journal', 'Status', 'Total Value'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.returns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                    No vendor refunds / purchase returns found
                  </TableCell>
                </TableRow>
              ) : (
                pg.rows.map((r, i) => (
                  <TableRow key={r._id || i} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} color="error.main">{r.returnNumber}</Typography>
                      {r.creditNoteNumber && <Typography variant="caption" color="text.secondary">CN: {r.creditNoteNumber}</Typography>}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{r.supplier?.name || r.supplierName || '—'}</Typography>
                    </TableCell>
                    <TableCell>{fmtDate(r.returnDate)}</TableCell>
                    <TableCell>
                      <Chip label={REASON_LABELS[r.reason] || r.reason || '—'} size="small" variant="outlined" color="error" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="primary.main">
                        {r.goodsReceive?.grnNumber || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {r.journalEntry ? (
                        <Chip label={r.journalEntry.entryNumber || 'Posted'} size="small" color="success" />
                      ) : (
                        <Chip label="No Entry" size="small" variant="outlined" color="default" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={r.status} size="small" color={STATUS_COLORS[r.status] || 'default'} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700} color="error.dark">{fmt(r.totalAmount)}</Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
              {data.returns.length > 0 && (
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={7} sx={{ fontWeight: 700 }}>Total ({data.count} returns)</TableCell>
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
