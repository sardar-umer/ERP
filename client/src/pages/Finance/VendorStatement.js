import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, Stack, Card, CardContent,
  Grid, TextField, Button, Avatar
} from '@mui/material';
import { ArrowBack as BackIcon, Receipt as VendorIcon } from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLOR = { paid: 'success', pending: 'warning', partial: 'info', overdue: 'error' };

export default function VendorStatement() {
  const [vendors, setVendors]         = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [statement, setStatement]     = useState(null);
  const [loading, setLoading]         = useState(true);
  const [loading2, setLoading2]       = useState(false);
  const [error, setError]             = useState('');
  const [filters, setFilters]         = useState({ fromDate: '', toDate: '' });

  const loadVendors = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/finance/reports/vendor-statement');
      setVendors(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const openVendor = async (vendor) => {
    setSelectedVendor(vendor);
    setLoading2(true);
    try {
      const params = {};
      if (filters.fromDate) params.fromDate = filters.fromDate;
      if (filters.toDate)   params.toDate   = filters.toDate;
      const res = await api.get(`/finance/reports/vendor-statement/${vendor._id}`, { params });
      setStatement(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load statement');
    } finally {
      setLoading2(false);
    }
  };

  const pg = useClientPagination(vendors);
  const pg2 = useClientPagination(statement?.bills);
  if (selectedVendor) {
    return (
      <Box sx={{ p: 3 }}>
        <Button startIcon={<BackIcon />} onClick={() => { setSelectedVendor(null); setStatement(null); }} sx={{ mb: 2 }}>
          Back to Vendors
        </Button>

        <Typography variant="h5" fontWeight={700} mb={2}>
          Vendor Statement — {selectedVendor.supplierName || 'Unknown'}
        </Typography>

        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

        {statement && (
          <>
            <Grid container spacing={2} mb={3}>
              {[
                { label: 'Total Billed', value: statement.summary.totalBilled, color: 'primary.main' },
                { label: 'Total Paid',   value: statement.summary.totalPaid,   color: 'success.main' },
                { label: 'Balance Due',  value: statement.summary.totalBalance, color: 'error.main' }
              ].map(c => (
                <Grid item xs={12} sm={4} key={c.label}>
                  <Card variant="outlined">
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                      <Typography variant="h6" fontWeight={700} color={c.color}>PKR {fmt(c.value)}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell><b>Reference</b></TableCell>
                    <TableCell><b>Date</b></TableCell>
                    <TableCell><b>Due Date</b></TableCell>
                    <TableCell align="right"><b>Billed (PKR)</b></TableCell>
                    <TableCell align="right"><b>Paid (PKR)</b></TableCell>
                    <TableCell align="right"><b>Balance (PKR)</b></TableCell>
                    <TableCell><b>Status</b></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pg2.rows.map(b => (
                    <TableRow key={b._id} hover>
                      <TableCell>{b.referenceNumber || '—'}</TableCell>
                      <TableCell>{b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—'}</TableCell>
                      <TableCell>{b.dueDate ? new Date(b.dueDate).toLocaleDateString() : '—'}</TableCell>
                      <TableCell align="right">{fmt(b.amount)}</TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(b.paidAmount)}</TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>{fmt(b.balance)}</TableCell>
                      <TableCell><Chip label={b.status} color={STATUS_COLOR[b.status] || 'default'} size="small" /></TableCell>
                    </TableRow>
                  ))}
                  {statement.bills.length === 0 && (
                    <TableRow><TableCell colSpan={7} align="center" sx={{ color: 'text.secondary' }}>No bills found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>{pg2.bar}
            </TableContainer>
          </>
        )}
        {loading2 && <CircularProgress sx={{ mt: 2 }} />}
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" fontWeight={700} display="flex" alignItems="center" gap={1} mb={3}>
        <VendorIcon color="primary" /> Vendor Statements
      </Typography>

      {error   && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? <CircularProgress /> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><b>Vendor</b></TableCell>
                <TableCell align="right"><b>Total Billed (PKR)</b></TableCell>
                <TableCell align="right"><b>Total Paid (PKR)</b></TableCell>
                <TableCell align="right"><b>Balance (PKR)</b></TableCell>
                <TableCell><b>Last Activity</b></TableCell>
                <TableCell align="center"><b>Action</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {vendors.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', py: 4 }}>No vendor data found</TableCell></TableRow>
              )}
              {pg.rows.map(v => (
                <TableRow key={v._id} hover>
                  <TableCell>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.light', fontSize: 12 }}>
                        {(v.supplierName || 'V').charAt(0).toUpperCase()}
                      </Avatar>
                      {v.supplierName || '(Unknown)'}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{fmt(v.totalBilled)}</TableCell>
                  <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(v.totalPaid)}</TableCell>
                  <TableCell align="right" sx={{ color: v.totalBalance > 0 ? 'error.main' : 'text.primary' }}>
                    {fmt(v.totalBalance)}
                  </TableCell>
                  <TableCell>{v.lastActivity ? new Date(v.lastActivity).toLocaleDateString() : '—'}</TableCell>
                  <TableCell align="center">
                    <Button size="small" variant="outlined" onClick={() => openVendor(v)} disabled={!v._id}>View Statement</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}
    </Box>
  );
}
