import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, FormControl, Grid, IconButton,
  InputLabel, MenuItem, Paper, Select, Skeleton, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography, Divider,
  Autocomplete
} from '@mui/material';
import {
  Add as AddIcon, CheckCircle as PaidIcon, Delete as DeleteIcon,
  Edit as EditIcon, Receipt as InvoiceIcon, Refresh as RefreshIcon,
  Send as SendIcon, Visibility as ViewIcon, Engineering as ContractorIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import {
  getProjectInvoices, createProjectInvoice, updateProjectInvoice, deleteProjectInvoice,
  getBOQ, getSuppliers, getCheckRequests
} from '../../services/projectManagementService';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })
    .format(Number(v || 0));

const STATUS_COLOR = {
  Draft: 'default', Sent: 'info', Paid: 'success',
  'Partially Paid': 'warning', Cancelled: 'error'
};

const EMPTY_FORM = {
  invoiceType: 'Subcontractor_IPC',
  contractor: '',
  checkRequestId: '',
  invoiceAmount: '', description: '', issueDate: dayjs().format('YYYY-MM-DD'),
  dueDate: '', billingPercentage: '', clientName: '', clientContact: '',
  clientAddress: '', notes: '', status: 'Draft', boqItemId: '',
  retentionPercentage: 5, advanceRecoveryAmount: 0, whtPercentage: 0,
  ipcItems: [] // [{ boqItemId, currentQuantity, unitPrice }]
};

const ProjectInvoicesTab = ({ project }) => {
  const [data, setData] = useState(null);
  const [boqItems, setBoqItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [billableCheckRequests, setBillableCheckRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewIpcDialog, setViewIpcDialog] = useState(null); // IPC invoice for detail modal
  const [editInvoice, setEditInvoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [payForm, setPayForm] = useState({ paidAmount: '', paidDate: dayjs().format('YYYY-MM-DD'), paymentMethod: '', paymentReference: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, boqRes, suppRes, crRes] = await Promise.all([
        getProjectInvoices(project._id),
        getBOQ(project._id),
        getSuppliers().catch(() => ({ data: { data: [] } })),
        getCheckRequests(project._id, { billable: 'true' }).catch(() => ({ data: { data: { checkRequests: [] } } }))
      ]);
      setData(res.data?.data || null);
      setBoqItems(boqRes.data?.data?.items || []);
      const suppList = suppRes.data?.data?.suppliers || suppRes.data?.data || [];
      setSuppliers(suppList);
      setBillableCheckRequests(crRes.data?.data?.checkRequests || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load invoices');
    } finally { setLoading(false); }
  }, [project._id]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditInvoice(null);
    setForm({
      ...EMPTY_FORM,
      clientName: project.clientName || '',
      clientContact: project.clientContact || '',
      clientAddress: project.address || ''
    });
    setDialogOpen(true);
  };

  const openEdit = (inv) => {
    setEditInvoice(inv);
    setForm({
      invoiceType: inv.invoiceType || 'Subcontractor_IPC',
      contractor: inv.contractor?._id || inv.contractor || '',
      invoiceAmount: inv.invoiceAmount,
      description: inv.description || '',
      issueDate: inv.issueDate ? dayjs(inv.issueDate).format('YYYY-MM-DD') : '',
      dueDate: inv.dueDate ? dayjs(inv.dueDate).format('YYYY-MM-DD') : '',
      billingPercentage: inv.billingPercentage || '',
      clientName: inv.clientName || '',
      clientContact: inv.clientContact || '',
      clientAddress: inv.clientAddress || '',
      notes: inv.notes || '',
      status: inv.status,
      boqItemId: inv.boqItemId || '',
      retentionPercentage: inv.retentionPercentage || 0,
      advanceRecoveryAmount: inv.advanceRecoveryAmount || 0,
      whtPercentage: inv.whtPercentage || 0,
      ipcItems: (inv.items || []).map(i => ({
        boqItemId: i.boqItem?._id || i.boqItem,
        currentQuantity: i.currentQuantity || 0,
        unitPrice: i.unitPrice || 0
      }))
    });
    setDialogOpen(true);
  };

  // Prepare IPC items from a Verified Check Request
  const handleCheckRequestChange = (checkRequestId) => {
    const cr = billableCheckRequests.find((r) => r._id === checkRequestId);
    if (!cr) {
      setForm((prev) => ({ ...prev, checkRequestId: '', ipcItems: [], contractor: '' }));
      return;
    }
    const ipcItems = (cr.remainingItems || cr.items || [])
      .map((i) => {
        const billableQty = i.billableQuantity !== undefined
          ? Number(i.billableQuantity)
          : Math.max(0, (Number(i.verifiedQuantity) || 0) - (Number(i.billedQuantity) || 0));
        if (billableQty <= 0) return null;
        return {
          boqItemId: i.boqItem?._id || i.boqItem,
          label: i.title || i.description,
          unit: i.unit,
          currentQuantity: billableQty,
          unitPrice: i.unitPrice || 0
        };
      })
      .filter(Boolean);

    setForm((prev) => ({
      ...prev,
      checkRequestId,
      contractor: cr.contractor?._id || cr.contractor || prev.contractor || '',
      ipcItems,
      description: prev.description || `IPC from ${cr.checkRequestNumber}`
    }));
  };

  // Legacy helper for non-IPC invoice types
  const handleContractorChange = (contractorId) => {
    setForm(prev => {
      const assigned = contractorId
        ? boqItems.filter(b => (b.contractor?._id || b.contractor) === contractorId || !b.contractor)
        : boqItems;

      const ipcItems = assigned.map(b => ({
        boqItemId: b._id,
        currentQuantity: 0,
        unitPrice: b.contractorUnitPrice || b.estimatedUnitPrice || 0
      }));

      return { ...prev, contractor: contractorId, ipcItems };
    });
  };

  const updateIpcItemQty = (boqItemId, qty) => {
    setForm(prev => ({
      ...prev,
      ipcItems: prev.ipcItems.map(item => item.boqItemId === boqItemId ? { ...item, currentQuantity: Number(qty) || 0 } : item)
    }));
  };

  const updateIpcItemPrice = (boqItemId, price) => {
    setForm(prev => ({
      ...prev,
      ipcItems: prev.ipcItems.map(item => item.boqItemId === boqItemId ? { ...item, unitPrice: Number(price) || 0 } : item)
    }));
  };

  // Calculations for Subcontractor IPC
  const calcGross = () => {
    return form.ipcItems.reduce((sum, item) => sum + (Number(item.currentQuantity) * Number(item.unitPrice)), 0);
  };

  const grossAmt = calcGross();
  const retAmt = Math.round(grossAmt * ((Number(form.retentionPercentage) || 0) / 100));
  const advAmt = Number(form.advanceRecoveryAmount) || 0;
  const whtAmt = Math.round(grossAmt * ((Number(form.whtPercentage) || 0) / 100));
  const netPayableAmt = Math.max(0, grossAmt - retAmt - advAmt - whtAmt);

  const handleSave = async () => {
    setError('');
    if (form.invoiceType === 'Subcontractor_IPC') {
      if (!form.checkRequestId) {
        setError('Select a Verified Check Request first. IPC cannot be created without it.');
        return;
      }
      const activeItems = form.ipcItems.filter(i => Number(i.currentQuantity) > 0);
      if (!activeItems.length) {
        setError('Enter billable quantities from the Check Request.');
        return;
      }
    } else {
      if (!form.invoiceAmount || Number(form.invoiceAmount) <= 0) {
        setError('Invoice amount is required'); return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        checkRequestId: form.checkRequestId || undefined,
        items: form.ipcItems.filter(i => Number(i.currentQuantity) > 0),
        invoiceAmount: form.invoiceType === 'Subcontractor_IPC' && grossAmt > 0 ? netPayableAmt : Number(form.invoiceAmount)
      };

      if (editInvoice) {
        await updateProjectInvoice(project._id, editInvoice._id, payload);
        setSuccess('Invoice updated successfully');
      } else {
        await createProjectInvoice(project._id, payload);
        setSuccess('Invoice / IPC created successfully');
      }
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save invoice');
    } finally { setSaving(false); }
  };

  const openMarkPaid = (inv) => {
    setPayingInvoice(inv);
    setPayForm({
      paidAmount: inv.netPayableAmount || inv.invoiceAmount,
      paidDate: dayjs().format('YYYY-MM-DD'),
      paymentMethod: 'Bank Transfer',
      paymentReference: ''
    });
    setPayDialogOpen(true);
  };

  const handleMarkPaid = async () => {
    setSaving(true); setError('');
    try {
      await updateProjectInvoice(project._id, payingInvoice._id, {
        status: 'Paid',
        paidAmount: Number(payForm.paidAmount),
        paidDate: payForm.paidDate,
        paymentMethod: payForm.paymentMethod,
        paymentReference: payForm.paymentReference
      });
      setSuccess('Invoice marked as paid');
      setPayDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update invoice');
    } finally { setSaving(false); }
  };

  const handleMarkSent = async (inv) => {
    try {
      await updateProjectInvoice(project._id, inv._id, { status: 'Sent' });
      setSuccess('Invoice marked as sent');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update status');
    }
  };

  const handleDelete = async (invId) => {
    if (!window.confirm('Delete this invoice?')) return;
    try {
      await deleteProjectInvoice(project._id, invId);
      setSuccess('Invoice deleted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete');
    }
  };

  const contractValue = project.contractValue || 0;
  const invoicesList = data?.invoices || [];

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Summary KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Total Invoiced / IPCs</Typography>
              <Typography variant="h5" fontWeight={700} color="primary.main">{fmt(data?.totalInvoiced)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Total Paid to Date</Typography>
              <Typography variant="h5" fontWeight={700} color="success.main">{fmt(data?.totalPaid)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Outstanding Balance</Typography>
              <Typography variant="h5" fontWeight={700} color={data?.totalOutstanding > 0 ? 'error.main' : 'text.primary'}>
                {fmt(data?.totalOutstanding)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Toolbar */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>Project Invoices & Subcontractor IPCs</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} size="small">Refresh</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd} size="small">
            Create Bill / IPC
          </Button>
        </Stack>
      </Stack>

      {/* Table */}
      {loading ? (
        <Skeleton variant="rectangular" height={250} />
      ) : invoicesList.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <InvoiceIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography variant="subtitle1" color="text.secondary">No invoices or IPC bills created yet</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd} sx={{ mt: 2 }}>
            Create First Invoice / IPC
          </Button>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><strong>Invoice # / IPC</strong></TableCell>
                <TableCell><strong>Type</strong></TableCell>
                <TableCell><strong>Contractor / Client</strong></TableCell>
                <TableCell><strong>Issue Date</strong></TableCell>
                <TableCell align="right"><strong>Gross Amount</strong></TableCell>
                <TableCell align="right"><strong>Net Payable</strong></TableCell>
                <TableCell align="center"><strong>Status</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoicesList.map(inv => (
                <TableRow key={inv._id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {inv.invoiceType === 'Subcontractor_IPC' ? `IPC #${inv.ipcNumber || 1} (${inv.invoiceNumber})` : inv.invoiceNumber}
                    </Typography>
                    {inv.description && <Typography variant="caption" color="text.secondary" display="block">{inv.description}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={inv.invoiceType === 'Subcontractor_IPC' ? 'Subcontractor IPC' : 'Client Invoice'}
                      color={inv.invoiceType === 'Subcontractor_IPC' ? 'info' : 'primary'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {inv.contractor?.name || inv.clientName || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>{inv.issueDate ? dayjs(inv.issueDate).format('DD MMM YYYY') : '—'}</TableCell>
                  <TableCell align="right">{fmt(inv.grossAmount || inv.invoiceAmount)}</TableCell>
                  <TableCell align="right">
                    <strong>{fmt(inv.netPayableAmount || inv.invoiceAmount)}</strong>
                  </TableCell>
                  <TableCell align="center">
                    <Chip size="small" label={inv.status} color={STATUS_COLOR[inv.status] || 'default'} />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {inv.items?.length > 0 && (
                        <Tooltip title="View Detailed IPC Bill Statement">
                          <IconButton size="small" onClick={() => setViewIpcDialog(inv)} color="info">
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {inv.status !== 'Paid' && (
                        <Tooltip title="Mark as Paid">
                          <IconButton size="small" color="success" onClick={() => openMarkPaid(inv)}>
                            <PaidIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {inv.status === 'Draft' && (
                        <Tooltip title="Mark Sent">
                          <IconButton size="small" color="info" onClick={() => handleMarkSent(inv)}>
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <IconButton size="small" onClick={() => openEdit(inv)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(inv._id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create/Edit Invoice & Subcontractor IPC Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editInvoice ? 'Edit Bill / Invoice' : 'Create Subcontractor IPC / Invoice'}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Billing Category / Mode</InputLabel>
                <Select
                  value={form.invoiceType}
                  label="Billing Category / Mode"
                  onChange={e => setForm(p => ({ ...p, invoiceType: e.target.value }))}
                >
                  <MenuItem value="Subcontractor_IPC">Subcontractor IPC (RA Bill against BOQ)</MenuItem>
                  <MenuItem value="Client_Invoice">Client Milestone Invoice</MenuItem>
                  <MenuItem value="General">General Ad-hoc Invoice</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {form.invoiceType === 'Subcontractor_IPC' && (
              <Grid item xs={12}>
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  Subcontractor IPC must be created from a <strong>Verified Check Request</strong>.
                  Create and verify one under the Check Requests tab first.
                </Alert>
                <FormControl fullWidth size="small" required>
                  <InputLabel>Verified Check Request</InputLabel>
                  <Select
                    label="Verified Check Request"
                    value={form.checkRequestId}
                    onChange={(e) => handleCheckRequestChange(e.target.value)}
                    disabled={Boolean(editInvoice)}
                  >
                    <MenuItem value="">Select check request…</MenuItem>
                    {billableCheckRequests.map((cr) => (
                      <MenuItem key={cr._id} value={cr._id}>
                        {cr.checkRequestNumber} — {cr.title}
                        {cr.contractor?.name ? ` (${cr.contractor.name})` : ''}
                        {` · ${fmt(cr.billableTotal || cr.verifiedTotal || 0)}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {billableCheckRequests.length === 0 && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    No verified unpaid Check Requests available on this Sub Project.
                  </Alert>
                )}
              </Grid>
            )}

            {form.invoiceType === 'Subcontractor_IPC' && form.checkRequestId && (
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  options={suppliers}
                  getOptionLabel={(option) => {
                    if (typeof option === 'string') return option;
                    if (!option) return '';
                    const idStr = option.supplierId ? ` (${option.supplierId})` : '';
                    const catStr = option.vendorCategory ? ` - [${option.vendorCategory}]` : (option.vendorType ? ` - [${option.vendorType}]` : '');
                    return `${option.name || ''}${idStr}${catStr}`;
                  }}
                  value={suppliers.find(s => String(s._id) === String(form.contractor)) || null}
                  onChange={(event, newValue) => {
                    setForm((p) => ({ ...p, contractor: newValue ? newValue._id : '' }));
                  }}
                  isOptionEqualToValue={(option, value) => String(option._id) === String(value._id || value)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Subcontractor"
                      size="small"
                      placeholder="From check request (editable)"
                    />
                  )}
                />
              </Grid>
            )}

            {/* Subcontractor IPC lines from Check Request */}
            {form.invoiceType === 'Subcontractor_IPC' && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 1, mb: 1, color: 'primary.dark' }}>
                  Verified Check Request Quantities (billable)
                </Typography>
                {form.ipcItems.length === 0 ? (
                  <Alert severity="info">Select a Verified Check Request to load billable quantities.</Alert>
                ) : (
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>BOQ Description</strong></TableCell>
                          <TableCell><strong>Unit</strong></TableCell>
                          <TableCell align="right"><strong>BOQ Est Qty</strong></TableCell>
                          <TableCell align="right"><strong>Prev Billed</strong></TableCell>
                          <TableCell align="right" sx={{ width: 130 }}><strong>Current Exec Qty</strong></TableCell>
                          <TableCell align="right" sx={{ width: 120 }}><strong>Contractor Rate</strong></TableCell>
                          <TableCell align="right"><strong>Current Amount</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {form.ipcItems.map(itemInput => {
                          const boq = boqItems.find(b => String(b._id) === String(itemInput.boqItemId));
                          const prevQty = boq?.contractorBilledQuantity || 0;
                          const estQty = boq?.estimatedQuantity;
                          const cumQty = prevQty + Number(itemInput.currentQuantity || 0);
                          const isOver = estQty != null && cumQty > estQty;

                          return (
                            <TableRow key={itemInput.boqItemId} hover sx={{ bgcolor: isOver ? 'error.50' : 'inherit' }}>
                              <TableCell>
                                <Typography variant="body2" fontWeight={600}>
                                  {itemInput.label || boq?.title || boq?.description || 'BOQ item'}
                                </Typography>
                              </TableCell>
                              <TableCell>{itemInput.unit || boq?.unit || '—'}</TableCell>
                              <TableCell align="right">{estQty ?? '—'}</TableCell>
                              <TableCell align="right">{prevQty}</TableCell>
                              <TableCell align="right">
                                <TextField
                                  size="small"
                                  type="number"
                                  value={itemInput.currentQuantity || ''}
                                  onChange={e => updateIpcItemQty(boq._id, e.target.value)}
                                  error={isOver}
                                  helperText={isOver ? `Exceeds max (${boq.estimatedQuantity})` : ''}
                                  inputProps={{ min: 0, step: 'any' }}
                                />
                              </TableCell>
                              <TableCell align="right">
                                <TextField
                                  size="small"
                                  type="number"
                                  value={itemInput.unitPrice}
                                  onChange={e => updateIpcItemPrice(boq._id, e.target.value)}
                                  inputProps={{ min: 0 }}
                                />
                              </TableCell>
                              <TableCell align="right">
                                <strong>{fmt(itemInput.currentQuantity * itemInput.unitPrice)}</strong>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}

                {/* IPC Financial Deductions Section */}
                <Card variant="outlined" sx={{ mt: 2, p: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>Deductions & Net Payable Summary</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={3}>
                      <Typography variant="caption" color="text.secondary">Gross Bill Amount</Typography>
                      <Typography variant="h6" fontWeight={700}>{fmt(grossAmt)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <TextField
                        size="small"
                        fullWidth
                        label="Retention Money (%)"
                        type="number"
                        value={form.retentionPercentage}
                        onChange={e => setForm(p => ({ ...p, retentionPercentage: e.target.value }))}
                        helperText={`Deducted: ${fmt(retAmt)}`}
                      />
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <TextField
                        size="small"
                        fullWidth
                        label="Advance Recovery (PKR)"
                        type="number"
                        value={form.advanceRecoveryAmount}
                        onChange={e => setForm(p => ({ ...p, advanceRecoveryAmount: e.target.value }))}
                      />
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <TextField
                        size="small"
                        fullWidth
                        label="WHT Tax (%)"
                        type="number"
                        value={form.whtPercentage}
                        onChange={e => setForm(p => ({ ...p, whtPercentage: e.target.value }))}
                        helperText={`Deducted: ${fmt(whtAmt)}`}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Divider sx={{ my: 1 }} />
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle1" fontWeight={700} color="primary.main">Net Amount Payable to Subcontractor:</Typography>
                        <Typography variant="h5" fontWeight={800} color="success.main">{fmt(netPayableAmt)}</Typography>
                      </Stack>
                    </Grid>
                  </Grid>
                </Card>
              </Grid>
            )}

            {form.invoiceType !== 'Subcontractor_IPC' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth required label="Invoice Amount (PKR)" type="number"
                  value={form.invoiceAmount} onChange={e => setForm(p => ({ ...p, invoiceAmount: e.target.value }))}
                  inputProps={{ min: 0 }}
                />
              </Grid>
            )}

            <Grid item xs={12}>
              <TextField fullWidth label="Description / Bill Notes" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} multiline rows={2} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth type="date" label="Issue Date" InputLabelProps={{ shrink: true }}
                value={form.issueDate} onChange={e => setForm(p => ({ ...p, issueDate: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth type="date" label="Due Date" InputLabelProps={{ shrink: true }}
                value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : null}>
            {saving ? 'Saving…' : editInvoice ? 'Update Bill' : 'Generate IPC / Bill'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Detailed IPC Statement Modal */}
      {viewIpcDialog && (
        <Dialog open={Boolean(viewIpcDialog)} onClose={() => setViewIpcDialog(null)} maxWidth="md" fullWidth>
          <DialogTitle>
            Interim Payment Certificate (IPC #{viewIpcDialog.ipcNumber || 1}) — {viewIpcDialog.invoiceNumber}
          </DialogTitle>
          <DialogContent dividers>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6}>
                <Typography variant="body2"><strong>Subcontractor:</strong> {viewIpcDialog.contractor?.name || '—'}</Typography>
                <Typography variant="body2"><strong>Project:</strong> {project.name}</Typography>
              </Grid>
              <Grid item xs={6} align="right">
                <Typography variant="body2"><strong>Date:</strong> {dayjs(viewIpcDialog.issueDate).format('DD MMM YYYY')}</Typography>
                <Typography variant="body2"><strong>Status:</strong> {viewIpcDialog.status}</Typography>
              </Grid>
            </Grid>

            <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ mt: 2 }}>Executed BOQ Statement</Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell><strong>Description</strong></TableCell>
                    <TableCell><strong>Unit</strong></TableCell>
                    <TableCell align="right"><strong>Prev Qty</strong></TableCell>
                    <TableCell align="right"><strong>Curr Qty</strong></TableCell>
                    <TableCell align="right"><strong>Total Cum. Qty</strong></TableCell>
                    <TableCell align="right"><strong>Rate</strong></TableCell>
                    <TableCell align="right"><strong>Amount</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {viewIpcDialog.items?.map((i, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{i.title || i.description}</TableCell>
                      <TableCell>{i.unit}</TableCell>
                      <TableCell align="right">{i.previousQuantity}</TableCell>
                      <TableCell align="right"><strong>{i.currentQuantity}</strong></TableCell>
                      <TableCell align="right">{i.cumulativeQuantity}</TableCell>
                      <TableCell align="right">{fmt(i.unitPrice)}</TableCell>
                      <TableCell align="right"><strong>{fmt(i.currentAmount)}</strong></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Grid container spacing={1}>
                <Grid item xs={6}><Typography variant="body2">Gross Executed Amount:</Typography></Grid>
                <Grid item xs={6} align="right"><Typography variant="body2" fontWeight={700}>{fmt(viewIpcDialog.grossAmount || viewIpcDialog.invoiceAmount)}</Typography></Grid>

                {viewIpcDialog.retentionAmount > 0 && (
                  <>
                    <Grid item xs={6}><Typography variant="body2" color="error.main">Less Retention Money ({viewIpcDialog.retentionPercentage}%):</Typography></Grid>
                    <Grid item xs={6} align="right"><Typography variant="body2" color="error.main">−{fmt(viewIpcDialog.retentionAmount)}</Typography></Grid>
                  </>
                )}
                {viewIpcDialog.advanceRecoveryAmount > 0 && (
                  <>
                    <Grid item xs={6}><Typography variant="body2" color="error.main">Less Advance Recovery:</Typography></Grid>
                    <Grid item xs={6} align="right"><Typography variant="body2" color="error.main">−{fmt(viewIpcDialog.advanceRecoveryAmount)}</Typography></Grid>
                  </>
                )}
                {viewIpcDialog.whtAmount > 0 && (
                  <>
                    <Grid item xs={6}><Typography variant="body2" color="error.main">Less Withholding Tax ({viewIpcDialog.whtPercentage}%):</Typography></Grid>
                    <Grid item xs={6} align="right"><Typography variant="body2" color="error.main">−{fmt(viewIpcDialog.whtAmount)}</Typography></Grid>
                  </>
                )}
                <Grid item xs={12}><Divider sx={{ my: 1 }} /></Grid>
                <Grid item xs={6}><Typography variant="subtitle1" fontWeight={800} color="success.main">Net Amount Payable:</Typography></Grid>
                <Grid item xs={6} align="right"><Typography variant="subtitle1" fontWeight={800} color="success.main">{fmt(viewIpcDialog.netPayableAmount || viewIpcDialog.invoiceAmount)}</Typography></Grid>
              </Grid>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setViewIpcDialog(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Mark as Paid Dialog */}
      <Dialog open={payDialogOpen} onClose={() => setPayDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Mark IPC / Invoice as Paid</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {payingInvoice && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Invoice {payingInvoice.invoiceNumber} — Net Payable: {fmt(payingInvoice.netPayableAmount || payingInvoice.invoiceAmount)}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField fullWidth label="Amount Paid (PKR)" type="number"
                value={payForm.paidAmount}
                onChange={e => setPayForm(p => ({ ...p, paidAmount: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth type="date" label="Payment Date" InputLabelProps={{ shrink: true }}
                value={payForm.paidDate}
                onChange={e => setPayForm(p => ({ ...p, paidDate: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select value={payForm.paymentMethod} label="Payment Method"
                  onChange={e => setPayForm(p => ({ ...p, paymentMethod: e.target.value }))}>
                  {['Cash', 'Cheque', 'Bank Transfer', 'Online', 'Other'].map(m =>
                    <MenuItem key={m} value={m}>{m}</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Reference / Cheque No."
                value={payForm.paymentReference}
                onChange={e => setPayForm(p => ({ ...p, paymentReference: e.target.value }))} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={handleMarkPaid} disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : <PaidIcon />}>
            {saving ? 'Saving…' : 'Confirm Payment'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProjectInvoicesTab;
