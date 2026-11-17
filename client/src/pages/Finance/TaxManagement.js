import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress,
  Alert, Tooltip, Switch, FormControlLabel, Stack
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Percent as TaxIcon, Bolt as SeedIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const TAX_TYPES = [
  { value: 'gst',         label: 'GST (Sales Tax)',       color: 'primary' },
  { value: 'wht',         label: 'WHT (Withholding Tax)', color: 'warning' },
  { value: 'income_tax',  label: 'Income Tax',            color: 'error' },
  { value: 'custom_duty', label: 'Custom Duty',           color: 'secondary' },
  { value: 'other',       label: 'Other',                 color: 'default' }
];

const SCOPES = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'sale',     label: 'Sale' },
  { value: 'both',     label: 'Both' }
];

const emptyForm = { name: '', code: '', taxType: 'gst', scope: 'both', rate: 17, computeMethod: 'percentage', priceIncludesTax: false, description: '', isActive: true };

export default function TaxManagement() {
  const [taxes, setTaxes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');
  const [open, setOpen]       = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState(emptyForm);
  const [saving, setSaving]   = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/finance/taxes');
      setTaxes(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load taxes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd  = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (t) => { setEditing(t); setForm({ ...t, taxPayableAccount: t.taxPayableAccount?._id || '', taxReceivableAccount: t.taxReceivableAccount?._id || '', whtPayableAccount: t.whtPayableAccount?._id || '' }); setOpen(true); };
  const handleClose = () => { setOpen(false); setError(''); };

  const handleSave = async () => {
    if (!form.name || !form.code) { setError('Name and Code are required'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/finance/taxes/${editing._id}`, form);
        setSuccess('Tax updated');
      } else {
        await api.post('/finance/taxes', form);
        setSuccess('Tax created');
      }
      setOpen(false);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this tax?')) return;
    try {
      await api.delete(`/finance/taxes/${id}`);
      setSuccess('Tax deleted');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed');
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await api.post('/finance/taxes/seed');
      setSuccess('Default Pakistan taxes seeded');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Seed failed');
    } finally {
      setSeeding(false);
    }
  };

  const typeInfo = (t) => TAX_TYPES.find(x => x.value === t) || { label: t, color: 'default' };

  const pg = useClientPagination(taxes);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={700} display="flex" alignItems="center" gap={1}>
          <TaxIcon color="primary" /> Tax Management
        </Typography>
        <Stack direction="row" gap={1}>
          <Button variant="outlined" startIcon={<SeedIcon />} onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed Pakistan Defaults'}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>Add Tax</Button>
        </Stack>
      </Stack>

      {error   && <Alert severity="error"   onClose={() => setError('')}   sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {loading ? <CircularProgress /> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><b>Code</b></TableCell>
                <TableCell><b>Name</b></TableCell>
                <TableCell><b>Type</b></TableCell>
                <TableCell><b>Scope</b></TableCell>
                <TableCell align="right"><b>Rate %</b></TableCell>
                <TableCell><b>Method</b></TableCell>
                <TableCell><b>Status</b></TableCell>
                <TableCell align="center"><b>Actions</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {taxes.length === 0 && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ color: 'text.secondary', py: 4 }}>No taxes configured. Click "Seed Pakistan Defaults" to start.</TableCell></TableRow>
              )}
              {pg.rows.map(t => (
                <TableRow key={t._id} hover>
                  <TableCell><b>{t.code}</b></TableCell>
                  <TableCell>{t.name}</TableCell>
                  <TableCell><Chip label={typeInfo(t.taxType).label} color={typeInfo(t.taxType).color} size="small" /></TableCell>
                  <TableCell>{t.scope}</TableCell>
                  <TableCell align="right">{t.rate}%</TableCell>
                  <TableCell>{t.computeMethod === 'percentage' ? 'Percentage' : 'Fixed'}</TableCell>
                  <TableCell><Chip label={t.isActive ? 'Active' : 'Inactive'} color={t.isActive ? 'success' : 'default'} size="small" /></TableCell>
                  <TableCell align="center">
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(t)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDelete(t._id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Tax' : 'Add Tax'}</DialogTitle>
        <DialogContent>
          <Stack gap={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" gap={2}>
              <TextField label="Tax Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} fullWidth />
              <TextField label="Code *" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} sx={{ maxWidth: 120 }} />
            </Stack>
            <Stack direction="row" gap={2}>
              <TextField select label="Tax Type *" value={form.taxType} onChange={e => setForm({ ...form, taxType: e.target.value })} fullWidth>
                {TAX_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </TextField>
              <TextField select label="Scope" value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} fullWidth>
                {SCOPES.map(s => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
              </TextField>
            </Stack>
            <Stack direction="row" gap={2}>
              <TextField label="Rate %" type="number" value={form.rate} onChange={e => setForm({ ...form, rate: Number(e.target.value) })} fullWidth inputProps={{ min: 0, max: 100, step: 0.01 }} />
              <TextField select label="Compute Method" value={form.computeMethod} onChange={e => setForm({ ...form, computeMethod: e.target.value })} fullWidth>
                <MenuItem value="percentage">Percentage</MenuItem>
                <MenuItem value="fixed">Fixed Amount</MenuItem>
              </TextField>
            </Stack>
            <FormControlLabel control={<Switch checked={!!form.priceIncludesTax} onChange={e => setForm({ ...form, priceIncludesTax: e.target.checked })} />} label="Price includes tax (inclusive)" />
            <TextField label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} multiline rows={2} fullWidth />
            {editing && (
              <FormControlLabel control={<Switch checked={!!form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />} label="Active" />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
