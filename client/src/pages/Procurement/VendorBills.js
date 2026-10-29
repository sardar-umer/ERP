import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, Grid, TextField, MenuItem, Button, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Checkbox,
  Tabs, Tab, Chip, CircularProgress, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import api from '../../services/api';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';

const VendorBills = () => {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0);
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [grns, setGrns] = useState([]);
  const [createdBills, setCreatedBills] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [selected, setSelected] = useState({});
  const [allocations, setAllocations] = useState({});
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [billToDelete, setBillToDelete] = useState(null);
  const [deletingBill, setDeletingBill] = useState(false);

  const handleOpenDelete = (bill) => {
    setBillToDelete(bill);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!billToDelete) return;
    try {
      setDeletingBill(true);
      await api.delete(`/finance/accounts-payable/${billToDelete._id}`);
      setSuccess(`✓ Bill ${billToDelete.billNumber} deleted successfully`);
      setDeleteDialogOpen(false);
      setBillToDelete(null);
      loadCreatedBills(vendorId);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete bill');
    } finally {
      setDeletingBill(false);
    }
  };

  const loadGrns = useCallback(async (vId) => {
    try {
      const params = {};
      if (vId) params.vendorId = vId;
      const res = await api.get('/procurement/vendor-bills/billable-grns', { params });
      setGrns(res.data?.data?.grns || []);
      setSelected({});
      setAllocations({});
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load billable GRNs');
    }
  }, []);

  const loadCreatedBills = useCallback(async (vId) => {
    try {
      setBillsLoading(true);
      const params = { limit: 100 };
      if (vId) params.vendorId = vId;
      const res = await api.get('/finance/accounts-payable', { params });
      setCreatedBills(res.data?.data?.bills || res.data?.data || []);
    } catch (e) {
      setError('Failed to load created vendor bills');
    } finally {
      setBillsLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/procurement/vendors', { params: { limit: 1000 } });
        setVendors(res.data?.data?.vendors || []);
      } catch {
        setError('Failed to load vendors');
      }
    })();
    api.get('/indents/companies')
      .then((res) => setCompanies(res.data?.data || []))
      .catch(() => setCompanies([]));
    loadGrns('');
    loadCreatedBills('');
  }, [loadGrns, loadCreatedBills]);

  useEffect(() => {
    loadGrns(vendorId);
    loadCreatedBills(vendorId);
  }, [vendorId, loadGrns, loadCreatedBills]);

  // Bill list returns the company id only; name it from the companies list
  const billCompanyName = (b) => {
    if (b.companyId && typeof b.companyId === 'object') return b.companyId.name || '—';
    const id = String(b.companyId || '');
    return companies.find((c) => String(c._id) === id)?.name || b.company || '—';
  };

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const total = useMemo(() => grns.filter((g) => selected[g._id]).reduce((s, g) => s + (Number(allocations[g._id]) || 0), 0), [grns, selected, allocations]);

  const onCreate = async () => {
    if (!vendorId || selectedIds.length === 0) {
      setError('Select vendor and at least one GRN');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const res = await api.post('/procurement/vendor-bills', {
        vendorId,
        grnIds: selectedIds,
        grnAllocations: selectedIds.map((id) => ({ grnId: id, amount: Number(allocations[id]) || 0 })).filter((x) => x.amount > 0),
        billDate,
        paymentTerms,
        vendorInvoiceNumber,
        notes
      });
      const newBillNo = res.data?.data?.billNumber || 'success';
      setSuccess(`✓ Bill created successfully: ${newBillNo}`);
      setSelected({});
      setAllocations({});
      setVendorInvoiceNumber('');
      setNotes('');
      // Refresh both unbilled GRNs and created bills list, and switch to Created Bills tab
      await Promise.all([loadGrns(vendorId), loadCreatedBills(vendorId)]);
      setTabIndex(1);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to create vendor bill');
    } finally {
      setLoading(false);
    }
  };

  const getBillStatusColor = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('paid')) return 'success';
    if (s.includes('partial')) return 'warning';
    if (s.includes('pending audit')) return 'warning';
    if (s.includes('forwarded')) return 'info';
    if (s.includes('returned')) return 'error';
    if (s.includes('posted') || s.includes('approved')) return 'info';
    if (s.includes('cancel')) return 'error';
    return 'default';
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Procurement GRN's & Bills</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/procurement/vendor-bills/new')}
          >
            Create Bill
          </Button>
        </Box>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField fullWidth select label="Supplier/Vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <MenuItem value="">Select vendor (All)</MenuItem>
              {vendors.map((v) => <MenuItem key={v._id} value={v._id}>{v.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField fullWidth type="date" label="Bill Date" value={billDate} onChange={(e) => setBillDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField fullWidth select label="Terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
              <MenuItem value="due_on_receipt">Due on receipt</MenuItem>
              <MenuItem value="net_15">Net 15</MenuItem>
              <MenuItem value="net_30">Net 30</MenuItem>
              <MenuItem value="net_45">Net 45</MenuItem>
              <MenuItem value="net_60">Net 60</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              label="Vendor Bill No."
              value={vendorInvoiceNumber}
              onChange={(e) => setVendorInvoiceNumber(e.target.value)}
              placeholder="Auto-generated if blank"
              helperText="Optional (Auto-generated)"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <Button fullWidth variant="contained" disabled={loading || !vendorId || selectedIds.length === 0} onClick={onCreate}>
              {loading ? <CircularProgress size={24} /> : 'Create Bill'}
            </Button>
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Tabs value={tabIndex} onChange={(e, v) => setTabIndex(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tab label={`Unbilled GRNs (${grns.length})`} />
          <Tab label={`Created Vendor Bills (${createdBills.length})`} />
        </Tabs>

        {tabIndex === 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Billable GRNs (Bill → GRN → PO) | Selected Total: {formatPKR(total)}
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell />
                    <TableCell>GRN</TableCell>
                    <TableCell>Company</TableCell>
                    <TableCell>Supplier / Vendor</TableCell>
                    <TableCell>PO</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Billing</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Billed</TableCell>
                    <TableCell align="right">Remaining</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {grns.map((g) => (
                    <TableRow key={g._id}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={!!selected[g._id]}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            if (checked && !vendorId && g.vendorId) {
                              setVendorId(String(g.vendorId));
                            }
                            setSelected((p) => ({ ...p, [g._id]: checked }));
                            if (checked) {
                              setAllocations((p) => ({ ...p, [g._id]: Number(g.remainingAmount) || 0 }));
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell>{g.receiveNumber}</TableCell>
                      <TableCell>{g.companyName || '—'}</TableCell>
                      <TableCell>{g.vendorName || '—'}</TableCell>
                      <TableCell>{g.poNumber || '-'}</TableCell>
                      <TableCell>{g.status}</TableCell>
                      <TableCell>{g.billingStatus}</TableCell>
                      <TableCell align="right">{formatPKR(g.amount || 0)}</TableCell>
                      <TableCell align="right">{formatPKR(g.billedAmount || 0)}</TableCell>
                      <TableCell align="right">{formatPKR(g.remainingAmount || 0)}</TableCell>
                      <TableCell align="right" sx={{ width: 180 }}>
                        <TextField
                          size="small"
                          type="number"
                          value={allocations[g._id] ?? (selected[g._id] ? (Number(g.remainingAmount) || 0) : 0)}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setAllocations((p) => ({ ...p, [g._id]: v }));
                          }}
                          inputProps={{ min: 0, max: Number(g.remainingAmount) || 0, step: 0.01 }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {grns.length === 0 && (
                    <TableRow><TableCell colSpan={11} align="center">No billable GRNs found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {tabIndex === 1 && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Created Vendor Bills & Payment Status
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Bill #</TableCell>
                    <TableCell>Company</TableCell>
                    <TableCell>Vendor Invoice #</TableCell>
                    <TableCell>Supplier / Vendor</TableCell>
                    <TableCell>Bill Date</TableCell>
                    <TableCell>Due Date</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Total Amount</TableCell>
                    <TableCell align="right">Balance Due</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {billsLoading ? (
                    <TableRow><TableCell colSpan={10} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                  ) : createdBills.length === 0 ? (
                    <TableRow><TableCell colSpan={10} align="center">No vendor bills created yet</TableCell></TableRow>
                  ) : (
                    createdBills.map((b) => (
                      <TableRow key={b._id} hover>
                        <TableCell><Typography variant="body2" fontWeight="bold">{b.billNumber}</Typography></TableCell>
                        <TableCell>{billCompanyName(b)}</TableCell>
                        <TableCell>{b.vendorInvoiceNumber || '—'}</TableCell>
                        <TableCell>{b.vendorName || b.supplierName || '—'}</TableCell>
                        <TableCell>{formatDate(b.billDate)}</TableCell>
                        <TableCell>{formatDate(b.dueDate)}</TableCell>
                        <TableCell>
                          <Chip
                            label={b.status || 'Draft'}
                            size="small"
                            color={getBillStatusColor(b.status)}
                          />
                        </TableCell>
                        <TableCell align="right"><Typography variant="body2" fontWeight="bold">{formatPKR(b.totalAmount || b.amount || 0)}</Typography></TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" color={b.balanceDue > 0 ? 'error.main' : 'success.main'} fontWeight="bold">
                            {formatPKR(b.balanceDue != null ? b.balanceDue : (b.totalAmount || 0))}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title={b.amountPaid > 0 ? 'Cannot delete bill with recorded payments' : 'Delete Bill'}>
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleOpenDelete(b)}
                                disabled={b.amountPaid > 0}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Paper>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => !deletingBill && setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: 'error.main', display: 'flex', alignItems: 'center', gap: 1 }}>
          <DeleteIcon /> Delete Vendor Bill
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            Are you sure you want to delete bill <strong>{billToDelete?.billNumber}</strong> ({billToDelete?.vendorName || billToDelete?.supplierName}) for <strong>{formatPKR(billToDelete?.totalAmount || billToDelete?.amount || 0)}</strong>?
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
            This will permanently remove the bill and any linked General Ledger postings.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deletingBill} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmDelete}
            disabled={deletingBill}
          >
            {deletingBill ? 'Deleting...' : 'Delete Bill'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VendorBills;

