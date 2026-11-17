import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, TextField, Grid,
  InputAdornment, Card, CardContent, Button, Tooltip
} from '@mui/material';
import {
  Search as SearchIcon, ReceiptLong as CreditNoteIcon,
  Refresh as RefreshIcon, TrendingDown as TrendingDownIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const STATUS_COLORS = {
  draft: 'default', pending: 'warning', approved: 'info',
  paid: 'success', partial: 'warning', overdue: 'error', cancelled: 'error'
};

export default function CreditNotes() {
  const [data, setData]       = useState({ notes: [], total: 0, count: 0 });
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
      const res = await api.get('/finance/credit-notes', { params });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load credit notes');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => `PKR ${Math.abs(Number(n || 0)).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK') : '—';

  const pg = useClientPagination(data.notes);
  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <CreditNoteIcon color="warning" />
          <Typography variant="h5" fontWeight={700}>Credit Notes</Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} size="small">Refresh</Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }} icon={<TrendingDownIcon />}>
        Credit notes reduce the amount owed by a customer. They are issued for returns, adjustments, or billing corrections.
      </Alert>

      {/* Summary */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ background: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)', borderRadius: 2 }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                <CreditNoteIcon color="warning" fontSize="small" />
                <Typography variant="body2" color="text.secondary">Total Credit Issued</Typography>
              </Box>
              <Typography variant="h5" fontWeight={800} color="warning.dark">{fmt(data.total)}</Typography>
              <Typography variant="caption" color="text.secondary">{data.count} credit note{data.count !== 1 ? 's' : ''}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth size="small" label="Search customer / credit note #"
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
              <TableRow sx={{ bgcolor: 'warning.main' }}>
                {['Credit Note #', 'Customer', 'Date', 'Status', 'Notes', 'Credit Amount'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.notes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                    No credit notes found for selected criteria
                  </TableCell>
                </TableRow>
              ) : (
                pg.rows.map((cn, i) => (
                  <TableRow key={cn._id || i} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} color="warning.dark">
                        {cn.invoiceNumber}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{cn.customer?.name || '—'}</Typography>
                      {cn.customer?.email && <Typography variant="caption" color="text.secondary">{cn.customer.email}</Typography>}
                    </TableCell>
                    <TableCell>{fmtDate(cn.invoiceDate)}</TableCell>
                    <TableCell>
                      <Chip label={cn.status || 'draft'} size="small" color={STATUS_COLORS[cn.status] || 'default'} />
                    </TableCell>
                    <TableCell>
                      <Tooltip title={cn.notes || ''}>
                        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cn.notes || '—'}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700} color="warning.dark">
                        ({fmt(cn.totalAmount)})
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
              {data.notes.length > 0 && (
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={5} sx={{ fontWeight: 700 }}>Total ({data.count} credit notes)</TableCell>
                  <TableCell sx={{ fontWeight: 800, color: 'warning.dark' }}>({fmt(data.total)})</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}
    </Box>
  );
}
