import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, Button, TextField,
  Grid, Checkbox, FormControl, InputLabel, Select, MenuItem, Card,
  CardContent, Divider, Tooltip, Stack, InputAdornment
} from '@mui/material';
import {
  Payment as PayIcon, SelectAll as SelectAllIcon, Search as SearchIcon,
  CheckCircle as PaidIcon, AccountBalance as BankIcon
} from '@mui/icons-material';
import api from '../../services/api';

const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK') : '—';

const STATUS_COLOR = { draft: 'default', pending: 'warning', approved: 'info', partial: 'warning', overdue: 'error' };

export default function BatchPayment() {
  const [bills, setBills]         = useState([]);
  const [selected, setSelected]   = useState(new Set());
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [paying, setPaying]       = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [search, setSearch]       = useState('');
  const [result, setResult]       = useState(null);

  const [payment, setPayment] = useState({
    paymentMethod: 'bank_transfer',
    bankAccountId: '',
    reference: '',
    date: new Date().toISOString().split('T')[0],
    whtRate: 0
  });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [billRes, bankRes] = await Promise.all([
        // Server expects a single status value; fetch recent bills and filter unpaid here.
        api.get('/finance/accounts-payable', { params: { limit: 200 } }),
        api.get('/finance/banking/accounts')
      ]);
      const billPayload = billRes.data?.data;
      const billList = Array.isArray(billPayload)
        ? billPayload
        : (billPayload?.bills || billRes.data?.bills || []);
      const unpaid = billList.filter(b => b.status !== 'paid' && ((b.outstandingAmount ?? (b.totalAmount - (b.amountPaid || 0) - (b.advanceApplied || 0))) > 0.01));
      // ?bills=id,id (from the Payables Hub): pre-select them, loading any not in the recent list
      const wanted = (new URLSearchParams(window.location.search).get('bills') || '').split(',').filter(Boolean);
      const missing = wanted.filter((id) => !unpaid.some((b) => String(b._id) === id));
      const extra = (await Promise.all(missing.map((id) => api.get(`/finance/accounts-payable/${id}`).then((r) => r.data?.data).catch(() => null))))
        .filter((b) => b && b.status !== 'paid' && b.status !== 'cancelled');
      setBills([...unpaid, ...extra]);
      if (wanted.length) setSelected(new Set(wanted.filter((id) => [...unpaid, ...extra].some((b) => String(b._id) === id))));
      const bankPayload = bankRes.data?.data;
      const accountList = Array.isArray(bankPayload)
        ? bankPayload
        : (bankPayload?.accounts || bankRes.data?.accounts || []);
      setBankAccounts(Array.isArray(accountList) ? accountList : []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load bills in Batch Vendor Payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = bills.filter(b => {
    if (!search) return true;
    const q = search.toLowerCase();
    return b.billNumber?.toLowerCase().includes(q) || b.vendor?.name?.toLowerCase().includes(q) || (typeof b.vendor === 'string' && b.vendor.toLowerCase().includes(q));
  });

  const toggle = (id) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(b => b._id)));
  };

  const selectedBills = bills.filter(b => selected.has(b._id));
  const totalSelected = selectedBills.reduce((s, b) => s + (b.outstandingAmount ?? ((b.totalAmount || 0) - (b.amountPaid || 0) - (b.advanceApplied || 0))), 0);
  const whtAmount     = payment.whtRate > 0 ? Math.round(totalSelected * (payment.whtRate / 100) * 100) / 100 : 0;
  const netAmount     = Math.round((totalSelected - whtAmount) * 100) / 100;

  const handlePay = async () => {
    if (selected.size === 0) { setError('Select at least one bill'); return; }
    if (!window.confirm(`Pay ${selected.size} bill(s) totaling ${fmt(totalSelected)}?`)) return;
    setPaying(true); setError(''); setSuccess(''); setResult(null);
    try {
      const billsPayload = [...selected].map(id => {
        const bill = bills.find(b => b._id === id);
        return {
          billId: id,
          amount: bill.outstandingAmount ?? ((bill.totalAmount || 0) - (bill.amountPaid || 0) - (bill.advanceApplied || 0))
        };
      });

      const res = await api.post('/finance/accounts-payable/batch-payment', {
        bills: billsPayload,
        ...payment
      });
      setResult(res.data.data);
      setSuccess(res.data.message);
      setSelected(new Set());
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Batch payment failed');
    } finally {
      setPaying(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <PayIcon color="secondary" />
          <Typography variant="h5" fontWeight={700}>Batch Vendor Payments</Typography>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Select multiple unpaid vendor bills below, fill payment details once, and pay them all in a single action.
        Each bill will be fully settled for its remaining balance.
      </Alert>

      {error   && <Alert severity="error"   onClose={() => setError('')}   sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <Grid container spacing={2}>
        {/* Left: Bill selection */}
        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ mb: 2, p: 1.5 }}>
            <TextField fullWidth size="small" placeholder="Search vendor or bill number…"
              value={search} onChange={e => setSearch(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
          </Paper>

          {loading ? <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box> : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ bgcolor: '#6a0032' }}>
                    <TableCell padding="checkbox" sx={{ bgcolor: '#6a0032' }}>
                      <Tooltip title={selected.size === filtered.length ? 'Deselect All' : 'Select All'}>
                        <Checkbox
                          checked={filtered.length > 0 && selected.size === filtered.length}
                          indeterminate={selected.size > 0 && selected.size < filtered.length}
                          onChange={toggleAll}
                          sx={{
                            color: '#fff',
                            '&.Mui-checked': { color: '#fff' },
                            '&.MuiCheckbox-indeterminate': { color: '#fff' }
                          }}
                        />
                      </Tooltip>
                    </TableCell>
                    {['Bill #', 'Vendor', 'Due Date', 'Status', 'Balance Due'].map(h => (
                      <TableCell key={h} sx={{ color: '#fff', fontWeight: 800, bgcolor: '#6a0032' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                      No unpaid bills found
                    </TableCell></TableRow>
                  )}
                  {filtered.map(bill => {
                    const balance = bill.outstandingAmount ?? ((bill.totalAmount || 0) - (bill.amountPaid || 0) - (bill.advanceApplied || 0));
                    const isSelected = selected.has(bill._id);
                    const overdue = bill.dueDate && new Date(bill.dueDate) < new Date();
                    return (
                      <TableRow key={bill._id} hover selected={isSelected}
                        onClick={() => toggle(bill._id)} sx={{ cursor: 'pointer',
                          '&.Mui-selected': { bgcolor: 'secondary.50' },
                          ...(overdue ? { bgcolor: isSelected ? 'secondary.50' : 'error.50' } : {})
                        }}>
                        <TableCell padding="checkbox">
                          <Checkbox checked={isSelected} onChange={() => toggle(bill._id)} onClick={e => e.stopPropagation()} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600} color="secondary.main">{bill.billNumber}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{bill.vendor?.name || (typeof bill.vendor === 'string' ? bill.vendor : '—')}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color={overdue ? 'error.main' : 'text.primary'}>{fmtDate(bill.dueDate)}</Typography>
                          {overdue && <Typography variant="caption" color="error.main">Overdue</Typography>}
                        </TableCell>
                        <TableCell>
                          <Chip label={bill.status} size="small" color={STATUS_COLOR[bill.status] || 'default'} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={700} color={overdue ? 'error.main' : 'text.primary'}>{fmt(balance)}</Typography>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Grid>

        {/* Right: Payment panel */}
        <Grid item xs={12} md={4}>
          <Paper variant="outlined" sx={{ p: 2, position: 'sticky', top: 80 }}>
            <Typography variant="subtitle1" fontWeight={700} mb={2} display="flex" alignItems="center" gap={1}>
              <BankIcon fontSize="small" color="secondary" /> Payment Details
            </Typography>

            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Payment Method</InputLabel>
                <Select value={payment.paymentMethod} label="Payment Method"
                  onChange={e => setPayment(p => ({ ...p, paymentMethod: e.target.value }))}>
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="check">Cheque</MenuItem>
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>Pay From Account</InputLabel>
                <Select value={payment.bankAccountId} label="Pay From Account"
                  onChange={e => setPayment(p => ({ ...p, bankAccountId: e.target.value }))}>
                  <MenuItem value="">— Auto (default bank) —</MenuItem>
                  {bankAccounts.map(a => (
                    <MenuItem key={a._id} value={a._id}>{a.accountNumber} — {a.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField fullWidth size="small" label="Payment Date" type="date"
                value={payment.date} onChange={e => setPayment(p => ({ ...p, date: e.target.value }))}
                InputLabelProps={{ shrink: true }} />

              <TextField fullWidth size="small" label="Reference / Cheque No."
                value={payment.reference} onChange={e => setPayment(p => ({ ...p, reference: e.target.value }))} />

              <TextField fullWidth size="small" label="WHT Rate %" type="number"
                value={payment.whtRate} onChange={e => setPayment(p => ({ ...p, whtRate: e.target.value }))}
                inputProps={{ min: 0, max: 30, step: 0.5 }} />
            </Stack>

            <Divider sx={{ my: 2 }} />

            {/* Summary */}
            <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 1.5, mb: 2 }}>
              <Stack spacing={0.5}>
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">Bills Selected</Typography>
                  <Typography variant="body2" fontWeight={700}>{selected.size}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">Total Balance Due</Typography>
                  <Typography variant="body2" fontWeight={700}>{fmt(totalSelected)}</Typography>
                </Box>
                {whtAmount > 0 && (
                  <Box display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">WHT @ {payment.whtRate}%</Typography>
                    <Typography variant="body2" color="warning.main">— {fmt(whtAmount)}</Typography>
                  </Box>
                )}
                <Divider />
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="body2" fontWeight={800}>Net Bank Amount</Typography>
                  <Typography variant="body1" fontWeight={900} color="secondary.main">{fmt(netAmount)}</Typography>
                </Box>
              </Stack>
            </Box>

            <Button
              fullWidth variant="contained" color="secondary" size="large"
              startIcon={paying ? <CircularProgress size={18} color="inherit" /> : <PayIcon />}
              onClick={handlePay}
              disabled={paying || selected.size === 0}
            >
              {paying ? 'Processing…' : `Pay ${selected.size > 0 ? selected.size : ''} Bill${selected.size !== 1 ? 's' : ''}`}
            </Button>
          </Paper>
        </Grid>
      </Grid>

      {/* Result summary */}
      {result && (
        <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
          <Typography variant="subtitle1" fontWeight={700} mb={1} color="success.main" display="flex" alignItems="center" gap={1}>
            <PaidIcon /> Payment Summary
          </Typography>
          <Alert severity="success">
            Batch payment application successfully created and is now pending finance authorization!
            <br />
            <strong>Application ID:</strong> {result.applicationId || '—'}
            <br />
            <strong>Draft Journal Entry ID:</strong> {result.journalEntryId || '—'}
          </Alert>
        </Paper>
      )}
    </Box>
  );
}
