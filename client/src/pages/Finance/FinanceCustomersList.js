import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  Card,
  CardContent,
  Grid,
  TextField,
  Button,
  Avatar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Divider,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  People as CustomerIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Edit as EditIcon,
  Add as AddIcon
} from '@mui/icons-material';
import api from '../../services/api';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLOR = {
  paid: 'success',
  partial: 'info',
  pending: 'warning',
  overdue: 'error',
  approved: 'info',
  draft: 'default',
  active: 'success',
  inactive: 'default',
  prospect: 'info'
};

const emptyForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  status: 'active',
  type: 'corporate',
  industry: '',
  website: '',
  ntn: '',
  strn: '',
  cnic: '',
  street: '',
  city: ''
};

/** Customer record → form values (address flattened to street / city) */
const toForm = (c = {}) => ({
  ...emptyForm,
  name: c.name || '',
  company: c.company || '',
  email: c.email || '',
  phone: c.phone || '',
  status: c.status || 'active',
  type: c.type || 'corporate',
  industry: c.industry || '',
  website: c.website || '',
  ntn: c.ntn || '',
  strn: c.strn || '',
  cnic: c.cnic || '',
  street: c.address?.street || '',
  city: c.address?.city || ''
});

export default function FinanceCustomersList() {
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [dialogOpen, setDialogOpen] = useState(false);
  // null = creating; customer id = editing that customer
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [statementFilters, setStatementFilters] = useState({ fromDate: '', toDate: '' });
  const [highlightedInvoiceKey, setHighlightedInvoiceKey] = useState(null);
  const paymentsSectionRef = useRef(null);
  const paymentsTabRef = useRef(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 400);
    return () => window.clearTimeout(t);
  }, [search]);

  const isPaymentHighlighted = (payment) => {
    if (!highlightedInvoiceKey || !payment) return false;
    const key = String(highlightedInvoiceKey);
    if (payment.invoiceId && String(payment.invoiceId) === key) return true;
    if (payment.invoiceNumber && String(payment.invoiceNumber) === key) return true;
    return false;
  };

  const focusInvoicePayments = (invoice, { switchToPaymentsTab = false } = {}) => {
    if (!invoice) return;
    const key = invoice._id || invoice.invoiceNumber;
    setHighlightedInvoiceKey(key ? String(key) : null);
    if (switchToPaymentsTab) {
      setDetailTab(1);
      window.setTimeout(() => {
        paymentsTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }
    window.setTimeout(() => {
      paymentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = { limit: 500, page: 1 };
      if (searchDebounced) params.search = searchDebounced;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/finance/customers', { params });
      setCustomers(res.data?.data?.customers || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [searchDebounced, statusFilter]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useFinanceCompanyReload(() => {
    setSelected(null);
    setDetail(null);
    loadCustomers();
  }, { skipInitial: true });

  const openCustomer = async (customer) => {
    setSelected(customer);
    setDetail(null);
    setDetailTab(0);
    setHighlightedInvoiceKey(null);
    setDetailLoading(true);
    try {
      const res = await api.get(`/finance/customers/${customer._id}`, {
        headers: { 'Cache-Control': 'no-cache' },
        params: { _: Date.now(), name: customer.name || undefined }
      });
      setDetail(res.data?.data || null);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load customer finance details');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!(formData.name || '').trim()) {
      setError('Customer name is required');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const { street, city, ...rest } = formData;
      const payload = { ...rest };
      if (!payload.email && !editingId) delete payload.email;
      if (street || city || editingId) {
        const prevAddress = (detail?.customer || selected)?.address || {};
        payload.address = { ...(editingId ? prevAddress : {}), street: street.trim(), city: city.trim() };
      }
      const res = editingId
        ? await api.put(`/finance/customers/${editingId}`, payload)
        : await api.post('/finance/customers', payload);
      if (res.data?.success) {
        setSuccess(editingId ? 'Customer updated successfully' : 'Customer created successfully');
        setDialogOpen(false);
        setFormData(emptyForm);
        await loadCustomers();
        const saved = res.data.data;
        if (editingId && saved) {
          // Keep the open profile and its tab; just refresh the customer details shown
          setSelected((prev) => ({ ...prev, ...saved }));
          setDetail((prev) => (prev ? { ...prev, customer: { ...(prev.customer || {}), ...saved } } : prev));
        } else if (saved?._id) {
          openCustomer(saved);
        }
        setEditingId(null);
      }
    } catch (e) {
      setError(e.response?.data?.message || (editingId ? 'Failed to update customer' : 'Failed to create customer'));
    } finally {
      setSaving(false);
    }
  };

  const openEditCustomer = (customer) => {
    setEditingId(customer._id);
    setFormData(toForm(customer));
    setError('');
    setDialogOpen(true);
  };

  const filteredInvoices = (detail?.invoices || []).filter((inv) => {
    if (!statementFilters.fromDate && !statementFilters.toDate) return true;
    const d = inv.invoiceDate ? new Date(inv.invoiceDate) : null;
    if (!d) return true;
    if (statementFilters.fromDate && d < new Date(statementFilters.fromDate)) return false;
    if (statementFilters.toDate && d > new Date(statementFilters.toDate)) return false;
    return true;
  });

  const filteredPayments = (detail?.payments || []).filter((p) => {
    if (!statementFilters.fromDate && !statementFilters.toDate) return true;
    const d = p.paymentDate ? new Date(p.paymentDate) : null;
    if (!d) return true;
    if (statementFilters.fromDate && d < new Date(statementFilters.fromDate)) return false;
    if (statementFilters.toDate && d > new Date(statementFilters.toDate)) return false;
    return true;
  });

  const customerDialog = (
  <Dialog open={dialogOpen} onClose={() => { if (!saving) { setDialogOpen(false); setEditingId(null); } }} maxWidth="sm" fullWidth>
    <DialogTitle>{editingId ? 'Edit Customer' : 'Create Customer'}</DialogTitle>
    <DialogContent dividers>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid item xs={12}>
          <TextField
            label="Name"
            required
            fullWidth
            size="small"
            value={formData.name}
            onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            label="Company"
            fullWidth
            size="small"
            value={formData.company}
            onChange={(e) => setFormData((f) => ({ ...f, company: e.target.value }))}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <FormControl fullWidth size="small">
            <InputLabel>Type</InputLabel>
            <Select
              label="Type"
              value={formData.type}
              onChange={(e) => setFormData((f) => ({ ...f, type: e.target.value }))}
            >
              <MenuItem value="corporate">Corporate</MenuItem>
              <MenuItem value="individual">Individual</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            label="Email"
            fullWidth
            size="small"
            value={formData.email}
            onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            label="Phone"
            fullWidth
            size="small"
            value={formData.phone}
            onChange={(e) => setFormData((f) => ({ ...f, phone: e.target.value }))}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={formData.status}
              onChange={(e) => setFormData((f) => ({ ...f, status: e.target.value }))}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="prospect">Prospect</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            label="Industry"
            fullWidth
            size="small"
            value={formData.industry}
            onChange={(e) => setFormData((f) => ({ ...f, industry: e.target.value }))}
          />
        </Grid>
        <Grid item xs={12}>
          <Divider textAlign="left" sx={{ my: 0.5 }}>
            <Typography variant="caption" color="text.secondary">Tax &amp; identity (printed on sales tax invoices)</Typography>
          </Divider>
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField
            label="NTN"
            fullWidth
            size="small"
            value={formData.ntn}
            onChange={(e) => setFormData((f) => ({ ...f, ntn: e.target.value }))}
            placeholder="e.g. 2771961-8"
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField
            label="STRN"
            fullWidth
            size="small"
            value={formData.strn}
            onChange={(e) => setFormData((f) => ({ ...f, strn: e.target.value }))}
            placeholder="e.g. 26002771961-15"
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField
            label="CNIC"
            fullWidth
            size="small"
            value={formData.cnic}
            onChange={(e) => setFormData((f) => ({ ...f, cnic: e.target.value }))}
            placeholder="e.g. 61101-7626230-9"
          />
        </Grid>
        <Grid item xs={12} sm={8}>
          <TextField
            label="Street address"
            fullWidth
            size="small"
            value={formData.street}
            onChange={(e) => setFormData((f) => ({ ...f, street: e.target.value }))}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField
            label="City"
            fullWidth
            size="small"
            value={formData.city}
            onChange={(e) => setFormData((f) => ({ ...f, city: e.target.value }))}
          />
        </Grid>
      </Grid>
    </DialogContent>
    <DialogActions>
      <Button onClick={() => { setDialogOpen(false); setEditingId(null); }} disabled={saving}>Cancel</Button>
      <Button variant="contained" onClick={handleCreate} disabled={saving}>
        {saving ? 'Saving…' : editingId ? 'Save' : 'Create'}
      </Button>
    </DialogActions>
  </Dialog>
  );

  if (selected) {
    const customer = detail?.customer || selected;
    const summary = detail?.summary || selected.finance || {};

    return (
      <Box sx={{ p: 3 }}>
        <Button
          startIcon={<BackIcon />}
          onClick={() => {
            setSelected(null);
            setDetail(null);
          }}
          sx={{ mb: 2 }}
        >
          Back to Customers
        </Button>
        {customerDialog}

        <Stack direction="row" alignItems="center" gap={2} mb={2} flexWrap="wrap">
          <Avatar sx={{ bgcolor: 'primary.main' }}>{(customer.name || 'C').charAt(0).toUpperCase()}</Avatar>
          <Box>
            <Typography variant="h5" fontWeight={700}>{customer.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {[customer.company, customer.email, customer.phone].filter(Boolean).join(' · ') || '—'}
            </Typography>
          </Box>
          <Chip
            label={customer.status || '—'}
            color={STATUS_COLOR[customer.status] || 'default'}
            size="small"
          />
          <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={() => openEditCustomer(customer)} sx={{ ml: 'auto' }}>
            Edit customer
          </Button>
        </Stack>
        {(customer.ntn || customer.strn || customer.cnic) && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: -1, mb: 2 }}>
            {[customer.ntn && `NTN: ${customer.ntn}`, customer.strn && `STRN: ${customer.strn}`, customer.cnic && `CNIC: ${customer.cnic}`].filter(Boolean).join('  ·  ')}
          </Typography>
        )}

        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

        {detailLoading ? (
          <CircularProgress />
        ) : (
          <>
            <Grid container spacing={2} mb={3}>
              {[
                { label: 'Total Invoiced', value: summary.totalInvoiced, color: 'primary.main' },
                { label: 'Total Received', value: summary.totalReceived, color: 'success.main' },
                { label: 'Outstanding', value: summary.outstanding, color: (summary.outstanding || 0) > 0 ? 'error.main' : 'text.secondary' },
                { label: 'Invoices', value: summary.invoiceCount, color: 'info.main', isCount: true }
              ].map((c) => (
                <Grid item xs={12} sm={6} md={3} key={c.label}>
                  <Card variant="outlined">
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                      <Typography variant="h6" fontWeight={700} color={c.color}>
                        {c.isCount ? c.value || 0 : `PKR ${fmt(c.value)}`}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            <Paper variant="outlined" sx={{ mb: 2, px: 2 }}>
              <Tabs value={detailTab} onChange={(_, v) => setDetailTab(v)} variant="scrollable" scrollButtons="auto">
                <Tab label={`Invoices (${detail?.invoices?.length || 0})`} />
                <Tab label={`Payments (${detail?.payments?.length || 0})`} />
                <Tab label={`Receipts (${detail?.receipts?.length || 0})`} />
                <Tab label={`Journal Entries (${detail?.journalEntries?.length || 0})`} />
                <Tab label="Statement" />
                <Tab label="Cost Center" />
                <Tab label="Profile" />
              </Tabs>
            </Paper>

            {detailTab === 0 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><b>Invoice #</b></TableCell>
                      <TableCell><b>Date</b></TableCell>
                      <TableCell><b>Due</b></TableCell>
                      <TableCell align="right"><b>Invoiced</b></TableCell>
                      <TableCell align="right"><b>Received</b></TableCell>
                      <TableCell align="right"><b>Balance</b></TableCell>
                      <TableCell><b>Status</b></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail?.invoices || []).map((inv) => (
                      <TableRow
                        key={inv._id}
                        hover
                        onClick={() => focusInvoicePayments(inv, { switchToPaymentsTab: true })}
                        sx={{ cursor: 'pointer' }}
                        title="View payments for this invoice"
                      >
                        <TableCell sx={{ fontFamily: 'monospace' }}>{inv.invoiceNumber || '—'}</TableCell>
                        <TableCell>{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</TableCell>
                        <TableCell align="right">{fmt(inv.totalAmount)}</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(inv.paidAmount ?? inv.amountPaid)}</TableCell>
                        <TableCell align="right" sx={{ color: (inv.balance || 0) > 0 ? 'error.main' : 'text.secondary' }}>
                          {fmt(inv.balance)}
                        </TableCell>
                        <TableCell>
                          <Chip label={inv.status || '—'} size="small" color={STATUS_COLOR[inv.status] || 'default'} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {(detail?.invoices || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No accounts receivable invoices for this customer yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {detailTab === 1 && (
              <Box ref={paymentsTabRef}>
                {highlightedInvoiceKey && (
                  <Alert
                    severity="info"
                    sx={{ mb: 1 }}
                    onClose={() => setHighlightedInvoiceKey(null)}
                  >
                    Showing payments for selected invoice — matching rows are highlighted.
                  </Alert>
                )}
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
                      {(detail?.payments || []).map((p) => {
                        const highlighted = isPaymentHighlighted(p);
                        return (
                          <TableRow
                            key={String(p._id) + String(p.invoiceId)}
                            hover
                            sx={highlighted ? { bgcolor: 'warning.50', outline: '2px solid', outlineColor: 'warning.main' } : undefined}
                          >
                            <TableCell>{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : '—'}</TableCell>
                            <TableCell>{p.paymentMethod || '—'}</TableCell>
                            <TableCell>{p.reference || '—'}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: highlighted ? 700 : 400 }}>
                              {p.invoiceNumber || '—'}
                            </TableCell>
                            <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(p.amount)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {(detail?.payments || []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                            No payments recorded for this customer yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {detailTab === 2 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><b>Receipt #</b></TableCell>
                      <TableCell><b>Date</b></TableCell>
                      <TableCell><b>Narration</b></TableCell>
                      <TableCell><b>Invoice</b></TableCell>
                      <TableCell><b>Reference</b></TableCell>
                      <TableCell align="right"><b>Amount</b></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail?.receipts || []).map((r) => (
                      <TableRow key={r._id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{r.entryNumber || '—'}</TableCell>
                        <TableCell>{r.date ? new Date(r.date).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>{r.description || '—'}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{r.invoiceNumber || '—'}</TableCell>
                        <TableCell>{r.reference || '—'}</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                    {(detail?.receipts || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No receipt vouchers (RV) for this customer yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {detailTab === 3 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><b>Entry #</b></TableCell>
                      <TableCell><b>Date</b></TableCell>
                      <TableCell><b>Description</b></TableCell>
                      <TableCell><b>Reference</b></TableCell>
                      <TableCell align="right"><b>Debits</b></TableCell>
                      <TableCell align="right"><b>Credits</b></TableCell>
                      <TableCell><b>Tag</b></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail?.journalEntries || []).map((je) => (
                      <TableRow key={je._id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{je.entryNumber || '—'}</TableCell>
                        <TableCell>{je.date ? new Date(je.date).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>{je.description || '—'}</TableCell>
                        <TableCell>{je.reference || '—'}</TableCell>
                        <TableCell align="right">{fmt(je.totalDebits)}</TableCell>
                        <TableCell align="right">{fmt(je.totalCredits)}</TableCell>
                        <TableCell>
                          {je.partyTagged ? <Chip label="Party" size="small" color="secondary" /> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(detail?.journalEntries || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No journal entries linked to this customer yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {detailTab === 4 && (
              <Box>
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
                    <TextField
                      label="From Date"
                      type="date"
                      size="small"
                      value={statementFilters.fromDate}
                      onChange={(e) => setStatementFilters((f) => ({ ...f, fromDate: e.target.value }))}
                      InputLabelProps={{ shrink: true }}
                    />
                    <TextField
                      label="To Date"
                      type="date"
                      size="small"
                      value={statementFilters.toDate}
                      onChange={(e) => setStatementFilters((f) => ({ ...f, toDate: e.target.value }))}
                      InputLabelProps={{ shrink: true }}
                    />
                    <Button size="small" variant="outlined" onClick={() => setStatementFilters({ fromDate: '', toDate: '' })}>
                      Clear
                    </Button>
                  </Stack>
                </Paper>

                <Typography variant="subtitle2" fontWeight={700} mb={1}>
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
                        <TableCell align="right"><b>Invoiced</b></TableCell>
                        <TableCell align="right"><b>Received</b></TableCell>
                        <TableCell align="right"><b>Balance</b></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredInvoices.map((inv) => {
                        const selected =
                          highlightedInvoiceKey &&
                          (String(inv._id) === String(highlightedInvoiceKey) ||
                            String(inv.invoiceNumber) === String(highlightedInvoiceKey));
                        return (
                          <TableRow
                            key={inv._id}
                            hover
                            onClick={() => focusInvoicePayments(inv)}
                            sx={{
                              cursor: 'pointer',
                              bgcolor: selected ? 'warning.50' : undefined
                            }}
                            title="Highlight payments for this invoice"
                          >
                            <TableCell sx={{ fontFamily: 'monospace' }}>{inv.invoiceNumber}</TableCell>
                            <TableCell>{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : '—'}</TableCell>
                            <TableCell align="right">{fmt(inv.totalAmount)}</TableCell>
                            <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(inv.paidAmount ?? inv.amountPaid)}</TableCell>
                            <TableCell align="right">{fmt(inv.balance)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredInvoices.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} align="center" sx={{ py: 2, color: 'text.secondary' }}>No invoices in range</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>

                <Box ref={paymentsSectionRef}>
                  <Stack direction="row" alignItems="center" gap={1} mb={1}>
                    <Typography variant="subtitle2" fontWeight={700}>Payments</Typography>
                    {highlightedInvoiceKey && (
                      <Chip
                        size="small"
                        color="warning"
                        label="Filtered highlight on"
                        onDelete={() => setHighlightedInvoiceKey(null)}
                      />
                    )}
                  </Stack>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                          <TableCell><b>Date</b></TableCell>
                          <TableCell><b>Reference</b></TableCell>
                          <TableCell><b>Invoice</b></TableCell>
                          <TableCell align="right"><b>Amount</b></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredPayments.map((p) => {
                          const highlighted = isPaymentHighlighted(p);
                          return (
                            <TableRow
                              key={String(p._id) + '-stmt'}
                              sx={highlighted ? { bgcolor: 'warning.50', outline: '2px solid', outlineColor: 'warning.main' } : undefined}
                            >
                              <TableCell>{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : '—'}</TableCell>
                              <TableCell>{p.reference || '—'}</TableCell>
                              <TableCell sx={{ fontFamily: 'monospace', fontWeight: highlighted ? 700 : 400 }}>
                                {p.invoiceNumber || '—'}
                              </TableCell>
                              <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(p.amount)}</TableCell>
                            </TableRow>
                          );
                        })}
                        {filteredPayments.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} align="center" sx={{ py: 2, color: 'text.secondary' }}>No payments in range</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </Box>
            )}

            {detailTab === 5 && (
              <Box>
                <Grid container spacing={2} mb={3}>
                  {[
                    { label: 'Sales (Open Invoices)', value: detail?.costCenter?.sales, color: 'primary.main' },
                    { label: 'Cost of Sales (Bills)', value: detail?.costCenter?.costOfSales, color: 'warning.main' },
                    { label: 'Net Profit', value: detail?.costCenter?.netProfit, color: (detail?.costCenter?.netProfit || 0) >= 0 ? 'success.main' : 'error.main' },
                    { label: 'Profit %', value: detail?.costCenter?.profitPercent, color: 'info.main', isPct: true }
                  ].map((c) => (
                    <Grid item xs={12} sm={6} md={3} key={c.label}>
                      <Card variant="outlined">
                        <CardContent sx={{ py: 1.5 }}>
                          <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                          <Typography variant="h6" fontWeight={700} color={c.color}>
                            {c.isPct ? `${Number(c.value || 0).toFixed(2)}%` : `PKR ${fmt(c.value)}`}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>

                <Typography variant="subtitle1" fontWeight={700} mb={1}>Sales — Open Invoices</Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell><b>Invoice #</b></TableCell>
                        <TableCell><b>Date</b></TableCell>
                        <TableCell><b>Due</b></TableCell>
                        <TableCell align="right"><b>Amount</b></TableCell>
                        <TableCell align="right"><b>Balance</b></TableCell>
                        <TableCell><b>Status</b></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(detail?.costCenter?.openInvoices || []).map((inv) => (
                        <TableRow key={inv._id} hover>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{inv.invoiceNumber || '—'}</TableCell>
                          <TableCell>{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : '—'}</TableCell>
                          <TableCell>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</TableCell>
                          <TableCell align="right">{fmt(inv.totalAmount)}</TableCell>
                          <TableCell align="right" sx={{ color: 'error.main' }}>{fmt(inv.balance)}</TableCell>
                          <TableCell>
                            <Chip label={inv.status || '—'} size="small" color={STATUS_COLOR[inv.status] || 'default'} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {(detail?.costCenter?.openInvoices || []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                            No open invoices for this customer.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>

                <Typography variant="subtitle1" fontWeight={700} mb={1}>Cost of Sales — Bills</Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell><b>Bill #</b></TableCell>
                        <TableCell><b>Vendor</b></TableCell>
                        <TableCell><b>Bill Date</b></TableCell>
                        <TableCell align="right"><b>Total</b></TableCell>
                        <TableCell align="right"><b>Paid</b></TableCell>
                        <TableCell align="right"><b>Balance</b></TableCell>
                        <TableCell><b>Status</b></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(detail?.costCenter?.bills || []).map((b) => (
                        <TableRow key={b._id} hover>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{b.billNumber || '—'}</TableCell>
                          <TableCell>{b.vendorName || '—'}</TableCell>
                          <TableCell>{b.billDate ? new Date(b.billDate).toLocaleDateString() : '—'}</TableCell>
                          <TableCell align="right">{fmt(b.totalAmount)}</TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(b.amountPaid)}</TableCell>
                          <TableCell align="right" sx={{ color: 'error.main' }}>{fmt(b.balanceDue)}</TableCell>
                          <TableCell>
                            <Chip label={b.status || '—'} size="small" color={STATUS_COLOR[b.status] || 'default'} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {(detail?.costCenter?.bills || []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                            No related cost-of-sales bills found for this customer.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {detailTab === 6 && (
              <Card variant="outlined">
                <CardContent>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Company</Typography>
                      <Typography>{customer.company || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">NTN</Typography>
                      <Typography>{customer.ntn || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">STRN</Typography>
                      <Typography>{customer.strn || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">CNIC</Typography>
                      <Typography>{customer.cnic || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Type</Typography>
                      <Typography>{customer.type || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Email</Typography>
                      <Typography>{customer.email || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Phone</Typography>
                      <Typography>{customer.phone || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Industry</Typography>
                      <Typography>{customer.industry || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Website</Typography>
                      <Typography>{customer.website || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary">Address</Typography>
                      <Typography>
                        {[
                          customer.address?.street,
                          customer.address?.city,
                          customer.address?.state,
                          customer.address?.postalCode,
                          customer.address?.country
                        ].filter(Boolean).join(', ') || '—'}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            )}

          </>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <FinanceCompanyPageHeader title="Customers" icon={CustomerIcon}>
        <Stack direction="row" gap={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadCustomers} size="small">
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            size="small"
            onClick={() => {
              setEditingId(null);
              setFormData(emptyForm);
              setDialogOpen(true);
              setError('');
            }}
          >
            Create Customer
          </Button>
        </Stack>
      </FinanceCompanyPageHeader>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: -2 }}>
        Customer master data with invoices, payments, statements, and linked journal entries — same workflow as Vendor List.
      </Typography>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField
              size="small"
              label="Search customers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 240, flex: 1 }}
              InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Status</InputLabel>
              <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
                <MenuItem value="">All</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
                <MenuItem value="prospect">Prospect</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </CardContent>
      </Card>

      {loading ? (
        <CircularProgress />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><b>Name</b></TableCell>
                <TableCell><b>Company</b></TableCell>
                <TableCell><b>Contact</b></TableCell>
                <TableCell align="right"><b>Total Invoiced</b></TableCell>
                <TableCell align="right"><b>Total Received</b></TableCell>
                <TableCell align="right"><b>Outstanding</b></TableCell>
                <TableCell align="center"><b>Invoices</b></TableCell>
                <TableCell><b>Status</b></TableCell>
                <TableCell align="center"><b>Action</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No customers found.
                  </TableCell>
                </TableRow>
              )}
              {customers.map((c) => (
                <TableRow key={c._id} hover>
                  <TableCell>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>{(c.name || 'C').charAt(0)}</Avatar>
                      {c.name}
                    </Stack>
                  </TableCell>
                  <TableCell>{c.company || '—'}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{c.email || '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.phone || ''}</Typography>
                  </TableCell>
                  <TableCell align="right">PKR {fmt(c.finance?.totalInvoiced)}</TableCell>
                  <TableCell align="right" sx={{ color: 'success.main' }}>PKR {fmt(c.finance?.totalReceived)}</TableCell>
                  <TableCell align="right" sx={{ color: (c.finance?.outstanding || 0) > 0 ? 'error.main' : 'text.primary' }}>
                    PKR {fmt(c.finance?.outstanding)}
                  </TableCell>
                  <TableCell align="center">{c.finance?.invoiceCount || 0}</TableCell>
                  <TableCell>
                    <Chip label={c.status} size="small" color={STATUS_COLOR[c.status] || 'default'} />
                  </TableCell>
                  <TableCell align="center">
                    <Button size="small" variant="outlined" onClick={() => openCustomer(c)}>
                      View finance
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {customerDialog}
    </Box>
  );
}
