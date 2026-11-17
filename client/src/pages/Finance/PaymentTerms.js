import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress,
  Alert, Tooltip, Stack
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  CalendarMonth as TermIcon, Bolt as SeedIcon, AddCircle as AddLineIcon, RemoveCircle as RemoveLineIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const emptyLine = { type: 'balance', value: 100, daysAfterInvoice: 0, description: '' };
const emptyForm = { name: '', code: '', note: '', lines: [{ ...emptyLine }] };

export default function PaymentTerms() {
  const [terms, setTerms]     = useState([]);
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
      const res = await api.get('/finance/payment-terms');
      setTerms(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load payment terms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd  = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (t) => { setEditing(t); setForm({ name: t.name, code: t.code, note: t.note || '', lines: t.lines?.length ? t.lines : [{ ...emptyLine }] }); setOpen(true); };

  const handleSave = async () => {
    if (!form.name || !form.code) { setError('Name and Code are required'); return; }
    setSaving(true);
    try {
      if (editing) await api.put(`/finance/payment-terms/${editing._id}`, form);
      else await api.post('/finance/payment-terms', form);
      setSuccess(editing ? 'Updated' : 'Created');
      setOpen(false);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this payment term?')) return;
    try {
      await api.delete(`/finance/payment-terms/${id}`);
      setSuccess('Deleted');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed');
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await api.post('/finance/payment-terms/seed');
      setSuccess('Common payment terms seeded');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Seed failed');
    } finally {
      setSeeding(false);
    }
  };

  const setLine = (idx, field, value) => {
    const lines = [...form.lines];
    lines[idx] = { ...lines[idx], [field]: value };
    setForm({ ...form, lines });
  };

  const addLine    = () => setForm({ ...form, lines: [...form.lines, { ...emptyLine, type: 'percent' }] });
  const removeLine = (idx) => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) });

  const pg = useClientPagination(terms);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={700} display="flex" alignItems="center" gap={1}>
          <TermIcon color="primary" /> Payment Terms
        </Typography>
        <Stack direction="row" gap={1}>
          <Button variant="outlined" startIcon={<SeedIcon />} onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed Defaults'}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>Add Term</Button>
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
                <TableCell><b>Note</b></TableCell>
                <TableCell><b>Instalments</b></TableCell>
                <TableCell align="center"><b>Actions</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {terms.length === 0 && (
                <TableRow><TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 4 }}>No payment terms. Click "Seed Defaults" to start.</TableCell></TableRow>
              )}
              {pg.rows.map(t => (
                <TableRow key={t._id} hover>
                  <TableCell><b>{t.code}</b></TableCell>
                  <TableCell>{t.name}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{t.note || '—'}</TableCell>
                  <TableCell>{t.lines?.length || 1} line(s)</TableCell>
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

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Payment Term' : 'Add Payment Term'}</DialogTitle>
        <DialogContent>
          <Stack gap={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" gap={2}>
              <TextField label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} fullWidth />
              <TextField label="Code *" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} sx={{ maxWidth: 120 }} />
            </Stack>
            <TextField label="Note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} fullWidth />

            <Typography variant="subtitle2" fontWeight={600}>Instalment Lines</Typography>
            {form.lines.map((line, idx) => (
              <Stack key={idx} direction="row" gap={1} alignItems="center">
                <TextField select label="Type" value={line.type} onChange={e => setLine(idx, 'type', e.target.value)} sx={{ minWidth: 100 }}>
                  <MenuItem value="balance">Balance</MenuItem>
                  <MenuItem value="percent">Percent</MenuItem>
                  <MenuItem value="fixed">Fixed</MenuItem>
                </TextField>
                {line.type !== 'balance' && (
                  <TextField label={line.type === 'percent' ? '%' : 'Amount'} type="number" value={line.value}
                    onChange={e => setLine(idx, 'value', Number(e.target.value))} sx={{ width: 90 }} inputProps={{ min: 0 }} />
                )}
                <TextField label="Days" type="number" value={line.daysAfterInvoice}
                  onChange={e => setLine(idx, 'daysAfterInvoice', Number(e.target.value))} sx={{ width: 80 }} inputProps={{ min: 0 }} />
                <TextField label="Description" value={line.description}
                  onChange={e => setLine(idx, 'description', e.target.value)} fullWidth />
                <IconButton color="error" size="small" onClick={() => removeLine(idx)} disabled={form.lines.length <= 1}>
                  <RemoveLineIcon />
                </IconButton>
              </Stack>
            ))}
            <Button startIcon={<AddLineIcon />} onClick={addLine} size="small" sx={{ alignSelf: 'flex-start' }}>Add Line</Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
