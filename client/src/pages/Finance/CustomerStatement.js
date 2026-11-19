import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, Stack, Card, CardContent,
  Grid, TextField, Button, Avatar, IconButton, Tooltip
} from '@mui/material';
import {
  ArrowBack as BackIcon, People as CustomerIcon,
  Print as PrintIcon, Refresh as RefreshIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';
import { printTovusElement } from '../../utils/tovusPrintBrand';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_COLOR = { paid: 'success', pending: 'warning', partial: 'info', overdue: 'error', draft: 'default' };

export default function CustomerStatement() {
  const [customers, setCustomers]         = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [statement, setStatement]         = useState(null);
  const [loading, setLoading]             = useState(true);
  const [loading2, setLoading2]           = useState(false);
  const [error, setError]                 = useState('');
  const [filters, setFilters]             = useState({ fromDate: '', toDate: '' });
  const [highlightedInvoiceKey, setHighlightedInvoiceKey] = useState(null);
  const paymentsSectionRef = useRef(null);

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/finance/reports/customer-statement');
      setCustomers(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const openCustomer = async (customer) => {
    const customerName = typeof customer._id === 'string' ? customer._id : customer.customerName;
    if (!customerName) return;
    setSelectedCustomer({ ...customer, _id: customerName });
    setHighlightedInvoiceKey(null);
    setLoading2(true);
    try {
      const params = {};
      if (filters.fromDate) params.fromDate = filters.fromDate;
      if (filters.toDate)   params.toDate   = filters.toDate;
      const res = await api.get(`/finance/reports/customer-statement/${encodeURIComponent(customerName)}`, { params });
      setStatement(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load statement');
    } finally {
      setLoading2(false);
    }
  };

  const back = () => {
    setSelectedCustomer(null);
    setStatement(null);
    setHighlightedInvoiceKey(null);
  };

  const payments = useMemo(() => {
    const rows = [];
    (statement?.invoices || []).forEach((inv) => {
      (inv.payments || []).forEach((p) => {
        rows.push({
          _id: p._id,
          invoiceId: inv._id,
          invoiceNumber: inv.invoiceNumber,
          paymentDate: p.paymentDate,
          amount: p.amount,
          paymentMethod: p.paymentMethod,
          reference: p.reference
        });
      });
    });
    rows.sort((a, b) => new Date(b.paymentDate || 0) - new Date(a.paymentDate || 0));
    return rows;
  }, [statement]);

  const isPaymentHighlighted = (payment) => {
    if (!highlightedInvoiceKey || !payment) return false;
    const key = String(highlightedInvoiceKey);
    if (payment.invoiceId && String(payment.invoiceId) === key) return true;
    if (payment.invoiceNumber && String(payment.invoiceNumber) === key) return true;
    return false;
  };

  const focusInvoicePayments = (invoice) => {
    if (!invoice) return;
    const key = invoice._id || invoice.invoiceNumber;
    setHighlightedInvoiceKey(key ? String(key) : null);
    window.setTimeout(() => {
      paymentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const pg = useClientPagination(customers);

  // ── Customer List ──────────────────────────────────────────────────────────
  if (!selectedCustomer) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" fontWeight={700} display="flex" alignItems="center" gap={1} mb={3}>
          <CustomerIcon color="primary" /> Customer Statements
        </Typography>

        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

        <Paper variant="outlined" sx={{ p: 2, mb: 3 }} className="print-hide-toolbar">
          <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
            <TextField label="From Date" type="date" size="small" value={filters.fromDate}
              onChange={e => setFilters(f => ({ ...f, fromDate: e.target.value }))} InputLabelProps={{ shrink: true }} />
            <TextField label="To Date" type="date" size="small" value={filters.toDate}
              onChange={e => setFilters(f => ({ ...f, toDate: e.target.value }))} InputLabelProps={{ shrink: true }} />
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadCustomers}>Refresh</Button>
          </Stack>
        </Paper>

        {loading ? (
          <Box textAlign="center" py={6}><CircularProgress /></Box>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><b>Customer</b></TableCell>
                  <TableCell align="right"><b>Total Invoiced</b></TableCell>
                  <TableCell align="right"><b>Total Received</b></TableCell>
                  <TableCell align="right"><b>Outstanding Balance</b></TableCell>
                  <TableCell><b>Last Activity</b></TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {customers.length === 0 && (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No customer invoices found
                  </TableCell></TableRow>
                )}
                {pg.rows.map((c, i) => (
                  <TableRow key={i} hover>
                    <TableCell>
                      <Stack direction="row" alignItems="center" gap={1.5}>
                        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.100', color: 'primary.main', fontSize: 13 }}>
                          {(c._id || '?')[0]?.toUpperCase()}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" fontWeight={600}>{c._id || '—'}</Typography>
                          {c.customerEmail && (
                            <Typography variant="caption" color="text.secondary">{c.customerEmail}</Typography>
                          )}
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">PKR {fmt(c.totalInvoiced)}</TableCell>
                    <TableCell align="right" sx={{ color: 'success.main' }}>PKR {fmt(c.totalReceived)}</TableCell>
                    <TableCell align="right">
                      <Typography fontWeight={700} color={c.totalBalance > 0 ? 'error.main' : 'text.secondary'}>
                        PKR {fmt(c.totalBalance)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                      {c.lastActivity ? new Date(c.lastActivity).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>
                      <Button size="small" variant="outlined"
                        disabled={!c._id}
                        onClick={() => openCustomer(c)}>
                        View Statement
                      </Button>
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

  // ── Customer Detail Statement ──────────────────────────────────────────────
  return (
    <Box className="tv-report-area" sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" gap={1} mb={3} className="print-hide-toolbar">
        <IconButton onClick={back}><BackIcon /></IconButton>
        <Typography variant="h5" fontWeight={700}>
          Customer Statement — {statement?.customer?.name || selectedCustomer?._id || '…'}
        </Typography>
        <Box flex={1} />
        <Tooltip title="Print Statement">
          <IconButton onClick={() => printTovusElement('.tv-report-area', { title: 'Customer Statement', fit: false })}><PrintIcon /></IconButton>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }} className="print-hide-toolbar">
        <Stack direction="row" gap={2} alignItems="center">
          <TextField label="From Date" type="date" size="small" value={filters.fromDate}
            onChange={e => setFilters(f => ({ ...f, fromDate: e.target.value }))} InputLabelProps={{ shrink: true }} />
          <TextField label="To Date" type="date" size="small" value={filters.toDate}
            onChange={e => setFilters(f => ({ ...f, toDate: e.target.value }))} InputLabelProps={{ shrink: true }} />
          <Button variant="contained" size="small" onClick={() => openCustomer(selectedCustomer)}>Apply</Button>
        </Stack>
      </Paper>

      {loading2 ? (
        <Box textAlign="center" py={6}><CircularProgress /></Box>
      ) : statement ? (
        <>
          <Grid container spacing={2} mb={3}>
            {[
              { label: 'Total Invoiced',   value: statement.summary?.totalInvoiced, color: 'primary.main' },
              { label: 'Total Received',   value: statement.summary?.totalReceived, color: 'success.main' },
              { label: 'Outstanding',      value: statement.summary?.totalBalance,  color: statement.summary?.totalBalance > 0 ? 'error.main' : 'text.secondary' },
            ].map(c => (
              <Grid item xs={12} md={4} key={c.label}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                    <Typography variant="h6" fontWeight={700} color={c.color}>PKR {fmt(c.value)}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Typography variant="subtitle1" fontWeight={700} mb={1}>
            Invoices
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              (click a row to highlight its payments)
            </Typography>
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><b>Invoice #</b></TableCell>
                  <TableCell><b>Date</b></TableCell>
                  <TableCell><b>Due Date</b></TableCell>
                  <TableCell align="right"><b>Invoiced</b></TableCell>
                  <TableCell align="right"><b>Received</b></TableCell>
                  <TableCell align="right"><b>Balance</b></TableCell>
                  <TableCell><b>Status</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(statement.invoices || []).length === 0 && (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>No invoices found</TableCell></TableRow>
                )}
                {(statement.invoices || []).map(inv => {
                  const bal = (inv.totalAmount || inv.amount || 0) - (inv.amountPaid || inv.paidAmount || 0);
                  const selected =
                    highlightedInvoiceKey &&
                    (String(inv._id) === String(highlightedInvoiceKey) ||
                      String(inv.invoiceNumber) === String(highlightedInvoiceKey));
                  return (
                    <TableRow
                      key={inv._id}
                      hover
                      onClick={() => focusInvoicePayments(inv)}
                      sx={{ cursor: 'pointer', bgcolor: selected ? 'warning.50' : undefined }}
                      title="Highlight payments for this invoice"
                    >
                      <TableCell sx={{ fontFamily: 'monospace' }}>{inv.invoiceNumber}</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                        {inv.invoiceDate || inv.createdAt ? new Date(inv.invoiceDate || inv.createdAt).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell align="right">{fmt(inv.totalAmount || inv.amount)}</TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(inv.amountPaid || inv.paidAmount)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: bal > 0 ? 'error.main' : 'text.secondary' }}>
                        {fmt(bal)}
                      </TableCell>
                      <TableCell>
                        <Chip label={inv.status} size="small" color={STATUS_COLOR[inv.status] || 'default'} />
                      </TableCell>
                    </TableRow>
                  );
                })}

                <TableRow sx={{ bgcolor: 'primary.50' }}>
                  <TableCell colSpan={3} align="right"><b>Totals</b></TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>PKR {fmt(statement.summary?.totalInvoiced)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, color: 'success.main' }}>PKR {fmt(statement.summary?.totalReceived)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, color: statement.summary?.totalBalance > 0 ? 'error.main' : 'text.secondary' }}>
                    PKR {fmt(statement.summary?.totalBalance)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          <Box ref={paymentsSectionRef} sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" gap={1} mb={1}>
              <Typography variant="subtitle1" fontWeight={700}>Payments</Typography>
              {highlightedInvoiceKey && (
                <Chip
                  size="small"
                  color="warning"
                  label="Highlight on"
                  onDelete={() => setHighlightedInvoiceKey(null)}
                />
              )}
            </Stack>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell><b>Date</b></TableCell>
                    <TableCell><b>Method</b></TableCell>
                    <TableCell><b>Reference</b></TableCell>
                    <TableCell><b>Invoice</b></TableCell>
                    <TableCell align="right"><b>Amount</b></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                        No payments found for these invoices.
                      </TableCell>
                    </TableRow>
                  )}
                  {payments.map((p) => {
                    const highlighted = isPaymentHighlighted(p);
                    return (
                      <TableRow
                        key={String(p._id) + String(p.invoiceId)}
                        hover
                        sx={highlighted ? { bgcolor: 'warning.50', outline: '2px solid', outlineColor: 'warning.main' } : undefined}
                      >
                        <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                          {p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>{p.paymentMethod || '—'}</TableCell>
                        <TableCell>{p.reference || '—'}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: highlighted ? 700 : 400 }}>
                          {p.invoiceNumber || '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(p.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>

          <Typography variant="subtitle1" fontWeight={700} mb={1}>Journal Entries</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><b>Entry #</b></TableCell>
                  <TableCell><b>Date</b></TableCell>
                  <TableCell><b>Description</b></TableCell>
                  <TableCell><b>Reference</b></TableCell>
                  <TableCell align="right"><b>Debit</b></TableCell>
                  <TableCell align="right"><b>Credit</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(statement.journalEntries || []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      No party-tagged journal entries for this customer.
                    </TableCell>
                  </TableRow>
                )}
                {(statement.journalEntries || []).map((je) => (
                  <TableRow key={je._id} hover>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{je.entryNumber || '—'}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                      {je.date ? new Date(je.date).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>{je.description || '—'}</TableCell>
                    <TableCell>{je.reference || '—'}</TableCell>
                    <TableCell align="right">{fmt(je.debit)}</TableCell>
                    <TableCell align="right">{fmt(je.credit)}</TableCell>
                  </TableRow>
                ))}
                {(statement.journalEntries || []).length > 0 && (
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell colSpan={4} align="right"><b>Party JE totals</b></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800 }}>
                      PKR {fmt(statement.summary?.partyJournalDebits)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800 }}>
                      PKR {fmt(statement.summary?.partyJournalCredits)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : null}
    </Box>
  );
}
