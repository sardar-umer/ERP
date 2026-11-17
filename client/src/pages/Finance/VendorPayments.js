import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, TextField, Grid,
  InputAdornment, Card, CardContent, Button, Stack
} from '@mui/material';
import {
  Search as SearchIcon, AccountBalance as BankIcon,
  Refresh as RefreshIcon, Payment as PaymentIcon,
  Add as AddIcon
} from '@mui/icons-material';
import api from '../../services/api';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import QuickbooksPayBillsModal from '../../components/Finance/QuickbooksPayBillsModal';
import useClientPagination from '../../hooks/useClientPagination';

const METHOD_COLORS = {
  bank_transfer: 'primary', check: 'secondary', cheque: 'secondary',
  cash: 'success', other: 'default'
};

export default function VendorPayments() {
  const { selectedCompanyId } = useFinanceCompany();
  const [data, setData]       = useState({ payments: [], totalAmount: 0, count: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', search: '' });
  const [payBillsModalOpen, setPayBillsModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.fromDate) params.fromDate = filters.fromDate;
      if (filters.toDate)   params.toDate   = filters.toDate;
      if (filters.search)   params.search   = filters.search;
      const res = await api.get('/finance/vendor-payments', { params });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load vendor payments');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useFinanceCompanyReload(load, { skipInitial: true });

  const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK') : '—';

  const pg = useClientPagination(data.payments);
  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <FinanceCompanyPageHeader title="Vendor Payments" icon={PaymentIcon}>
        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<PaymentIcon />}
            onClick={() => setPayBillsModalOpen(true)}
            size="small"
            sx={{ fontWeight: 700 }}
          >
            Pay Bills (Multi-Bill)
          </Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} size="small">
            Refresh
          </Button>
        </Stack>
      </FinanceCompanyPageHeader>

      {/* Summary */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)', borderRadius: 2 }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                <BankIcon color="primary" fontSize="small" />
                <Typography variant="body2" color="text.secondary">Total Disbursed</Typography>
              </Box>
              <Typography variant="h5" fontWeight={800} color="primary.dark">{fmt(data.totalAmount)}</Typography>
              <Typography variant="caption" color="text.secondary">{data.count} payment{data.count !== 1 ? 's' : ''}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth size="small" label="Search vendor / bill # / reference"
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
              <TableRow sx={{ bgcolor: 'secondary.main' }}>
                {['Payment Date', 'Bill #', 'Vendor', 'Method', 'Reference', 'Amount Paid'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                    No vendor payments found for selected criteria
                  </TableCell>
                </TableRow>
              ) : (
                pg.rows.map((p, i) => (
                  <TableRow key={p._id || i} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                    <TableCell>{fmtDate(p.paymentDate)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} color="secondary.main">{p.billNumber}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{p.vendorName}</Typography>
                      {p.vendorEmail && <Typography variant="caption" color="text.secondary">{p.vendorEmail}</Typography>}
                    </TableCell>
                    <TableCell>
                      <Chip label={(p.paymentMethod || 'other').replace('_', ' ')} size="small"
                        color={METHOD_COLORS[p.paymentMethod] || 'default'} />
                    </TableCell>
                    <TableCell><Typography variant="body2" color="text.secondary">{p.reference || '—'}</Typography></TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700} color="primary.dark">{fmt(p.amount)}</Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
              {data.payments.length > 0 && (
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={5} sx={{ fontWeight: 700 }}>Total Disbursed ({data.count} payments)</TableCell>
                  <TableCell sx={{ fontWeight: 800, color: 'primary.dark' }}>{fmt(data.totalAmount)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}

      {/* QuickBooks-style Pay Bills Dialog */}
      <QuickbooksPayBillsModal
        open={payBillsModalOpen}
        onClose={() => setPayBillsModalOpen(false)}
        onSuccess={load}
        selectedCompanyId={selectedCompanyId}
      />
    </Box>
  );
}
