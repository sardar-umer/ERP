import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress,
  Alert, Tooltip, Stack
} from '@mui/material';
import {
  Add as AddIcon, CheckCircle as ConfirmIcon, Delete as DeleteIcon,
  Undo as ReturnIcon, Visibility as ViewIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { getDocCompanyName } from '../../utils/documentCompany';

const STATUS_COLOR = { draft: 'default', confirmed: 'info', posted: 'success' };
const REASONS = ['defective', 'wrong_item', 'over_delivered', 'quality_issue', 'other'];

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 });

const emptyForm = { goodsReceive: '', reason: 'defective', notes: '', items: [] };

export default function PurchaseReturns() {
  const navigate = useNavigate();
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');
  const [open, setOpen]       = useState(false);
  const [form, setForm]       = useState(emptyForm);
  const [saving, setSaving]   = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [grns, setGrns]       = useState([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/procurement/purchase-returns');
      setReturns(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load purchase returns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadGRNs = async () => {
    try {
      // The GRN list comes back as { receives, pagination } and pages at 10 by default
      const res = await api.get('/procurement/goods-receive', { params: { limit: 500 } });
      const data = res.data?.data;
      setGrns(Array.isArray(data) ? data : (Array.isArray(data?.receives) ? data.receives : []));
    } catch { setGrns([]); }
  };

  const openAdd = () => { loadGRNs(); setForm(emptyForm); setOpen(true); };

  const addItem = () => setForm({ ...form, items: [...form.items, { itemName: '', itemCode: '', quantity: 1, unitPrice: 0, reason: '' }] });
  const setItem = (idx, field, val) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: val };
    setForm({ ...form, items });
  };
  const removeItem = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const handleSave = async () => {
    if (!form.goodsReceive) { setError('GRN is required'); return; }
    if (form.items.length === 0) { setError('Add at least one item'); return; }
    setSaving(true);
    try {
      await api.post('/procurement/purchase-returns', form);
      setSuccess('Purchase return created');
      setOpen(false);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to create return');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async (id) => {
    if (!window.confirm('Confirm and post this return? This will reduce inventory and post journal entries.')) return;
    try {
      await api.post(`/procurement/purchase-returns/${id}/confirm`);
      setSuccess('Return confirmed and posted');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Confirm failed');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this draft return?')) return;
    try {
      await api.delete(`/procurement/purchase-returns/${id}`);
      setSuccess('Deleted');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed');
    }
  };

  const openView = async (pr) => {
    try {
      const res = await api.get(`/procurement/purchase-returns/${pr._id}`);
      setSelected(res.data.data);
      setViewOpen(true);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load details');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={700} display="flex" alignItems="center" gap={1}>
          <ReturnIcon color="warning" /> Purchase Returns
        </Typography>
        <Box display="flex" gap={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            color="error"
            onClick={() => navigate('/finance/vendor-refunds')}
            sx={{ fontSize: 12 }}
          >
            Finance: Vendor Refunds
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>New Return</Button>
        </Box>
      </Stack>

      {error   && <Alert severity="error"   onClose={() => setError('')}   sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {loading ? <CircularProgress /> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><b>Return #</b></TableCell>
                <TableCell><b>Company</b></TableCell>
                <TableCell><b>GRN</b></TableCell>
                <TableCell><b>Supplier</b></TableCell>
                <TableCell><b>Date</b></TableCell>
                <TableCell><b>Reason</b></TableCell>
                <TableCell align="right"><b>Total (PKR)</b></TableCell>
                <TableCell><b>Status</b></TableCell>
                <TableCell align="center"><b>Actions</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {returns.length === 0 && (
                <TableRow><TableCell colSpan={9} align="center" sx={{ color: 'text.secondary', py: 4 }}>No purchase returns yet.</TableCell></TableRow>
              )}
              {returns.map(r => (
                <TableRow key={r._id} hover>
                  <TableCell><b>{r.returnNumber}</b></TableCell>
                  <TableCell>{getDocCompanyName(r)}</TableCell>
                  <TableCell>{r.goodsReceive?.receiveNumber || '—'}</TableCell>
                  <TableCell>{r.supplierName || r.supplier?.name || '—'}</TableCell>
                  <TableCell>{r.returnDate ? new Date(r.returnDate).toLocaleDateString() : '—'}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{r.reason?.replace('_', ' ')}</TableCell>
                  <TableCell align="right">{fmt(r.totalAmount)}</TableCell>
                  <TableCell><Chip label={r.status} color={STATUS_COLOR[r.status] || 'default'} size="small" /></TableCell>
                  <TableCell align="center">
                    <Tooltip title="View"><IconButton size="small" onClick={() => openView(r)}><ViewIcon fontSize="small" /></IconButton></Tooltip>
                    {r.status === 'draft' && (
                      <>
                        <Tooltip title="Confirm & Post"><IconButton size="small" color="success" onClick={() => handleConfirm(r._id)}><ConfirmIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDelete(r._id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* New Return Dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>New Purchase Return</DialogTitle>
        <DialogContent>
          <Stack gap={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" gap={2}>
              <TextField select label="GRN *" value={form.goodsReceive} onChange={e => setForm({ ...form, goodsReceive: e.target.value })} fullWidth>
                {grns.map(g => <MenuItem key={g._id} value={g._id}>{g.receiveNumber} — {new Date(g.receiveDate).toLocaleDateString()}</MenuItem>)}
              </TextField>
              <TextField select label="Return Reason" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} fullWidth>
                {REASONS.map(r => <MenuItem key={r} value={r} sx={{ textTransform: 'capitalize' }}>{r.replace('_', ' ')}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} multiline rows={2} fullWidth />

            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle2" fontWeight={600}>Items to Return</Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={addItem}>Add Item</Button>
            </Stack>

            {form.items.map((item, idx) => (
              <Stack key={idx} direction="row" gap={1} alignItems="center">
                <TextField label="Item Name" value={item.itemName} onChange={e => setItem(idx, 'itemName', e.target.value)} fullWidth />
                <TextField label="Code" value={item.itemCode} onChange={e => setItem(idx, 'itemCode', e.target.value)} sx={{ maxWidth: 100 }} />
                <TextField label="Qty" type="number" value={item.quantity} onChange={e => setItem(idx, 'quantity', Number(e.target.value))} sx={{ maxWidth: 80 }} inputProps={{ min: 0.001, step: 0.001 }} />
                <TextField label="Unit Price" type="number" value={item.unitPrice} onChange={e => setItem(idx, 'unitPrice', Number(e.target.value))} sx={{ maxWidth: 110 }} inputProps={{ min: 0 }} />
                <IconButton color="error" size="small" onClick={() => removeItem(idx)}><DeleteIcon fontSize="small" /></IconButton>
              </Stack>
            ))}
            {form.items.length === 0 && (
              <Typography variant="body2" color="text.secondary" align="center">Click "Add Item" to add items to return</Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Create Return'}</Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog */}
      {selected && (
        <Dialog open={viewOpen} onClose={() => setViewOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle>
            Purchase Return — {selected.returnNumber}
            <Chip label={selected.status} color={STATUS_COLOR[selected.status] || 'default'} size="small" sx={{ ml: 1 }} />
          </DialogTitle>
          <DialogContent>
            <Stack gap={1} mb={2}>
              <Typography variant="body2"><b>Company:</b> {getDocCompanyName(selected)}</Typography>
              <Typography variant="body2"><b>GRN:</b> {selected.goodsReceive?.receiveNumber}</Typography>
              <Typography variant="body2"><b>Return Date:</b> {selected.returnDate ? new Date(selected.returnDate).toLocaleDateString() : '—'}</Typography>
              <Typography variant="body2"><b>Reason:</b> {selected.reason?.replace('_', ' ')}</Typography>
              {selected.notes && <Typography variant="body2"><b>Notes:</b> {selected.notes}</Typography>}
              {selected.journalEntry && <Typography variant="body2" color="success.main"><b>Journal Entry:</b> {selected.journalEntry.entryNumber}</Typography>}
            </Stack>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell><b>Item</b></TableCell>
                    <TableCell align="right"><b>Qty</b></TableCell>
                    <TableCell align="right"><b>Unit Price</b></TableCell>
                    <TableCell align="right"><b>Total</b></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selected.items?.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell>{item.itemName || item.inventoryItem?.name || '—'}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right">{fmt(item.unitPrice)}</TableCell>
                      <TableCell align="right"><b>{fmt(item.totalAmount)}</b></TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} align="right"><b>Total</b></TableCell>
                    <TableCell align="right"><b>PKR {fmt(selected.totalAmount)}</b></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setViewOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
