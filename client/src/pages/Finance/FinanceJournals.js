import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress,
  Alert, Tooltip, Stack
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  MenuBook as JournalIcon, CheckCircle as SeedIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const JOURNAL_TYPES = [
  { value: 'purchase',    label: 'Purchase Journal',     color: 'error' },
  { value: 'sale',        label: 'Sales Journal',        color: 'success' },
  { value: 'bank',        label: 'Bank Journal',         color: 'primary' },
  { value: 'cash',        label: 'Cash Journal',         color: 'info' },
  { value: 'inventory',   label: 'Inventory Journal',    color: 'warning' },
  { value: 'payroll',     label: 'Payroll Journal',      color: 'secondary' },
  { value: 'depreciation',label: 'Depreciation Journal', color: 'default' },
  { value: 'general',     label: 'General Journal',      color: 'default' }
];

const typeColor = (type) => JOURNAL_TYPES.find(t => t.value === type)?.color || 'default';
const typeLabel = (type) => JOURNAL_TYPES.find(t => t.value === type)?.label || type;

const emptyForm = { name: '', code: '', type: 'general', description: '' };

export default function FinanceJournals() {
  const [journals, setJournals]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState(emptyForm);
  const [saving, setSaving]       = useState(false);
  const [seeding, setSeeding]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/finance/journals?isActive=all');
      setJournals(res.data.data || []);
    } catch {
      setError('Failed to load journals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit   = (j) => { setEditing(j); setForm({ name: j.name, code: j.code, type: j.type, description: j.description || '' }); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const handleSave = async () => {
    if (!form.name || !form.code || !form.type) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/finance/journals/${editing._id}`, form);
        setSuccess('Journal updated');
      } else {
        await api.post('/finance/journals', form);
        setSuccess('Journal created');
      }
      closeDialog();
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (j) => {
    if (!window.confirm(`Delete journal "${j.name}"?`)) return;
    try {
      await api.delete(`/finance/journals/${j._id}`);
      setSuccess('Journal deleted');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed');
    }
  };

  const handleSeedSystem = async () => {
    setSeeding(true);
    try {
      const res = await api.post('/finance/journals/seed/system');
      const created = res.data.results?.filter(r => r.action === 'created').length || 0;
      setSuccess(`Seeded system journals. ${created} new journal(s) created.`);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Seeding failed');
    } finally {
      setSeeding(false);
    }
  };

  const pg = useClientPagination(journals);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <JournalIcon color="primary" sx={{ fontSize: 30 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>Finance Journals</Typography>
            <Typography variant="body2" color="text.secondary">
              Journals are folders that categorize journal entries by source (Purchase, Inventory, Bank, etc.)
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" gap={1}>
          <Button
            variant="outlined"
            startIcon={seeding ? <CircularProgress size={16} /> : <SeedIcon />}
            onClick={handleSeedSystem}
            disabled={seeding}
          >
            Seed System Journals
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New Journal
          </Button>
        </Stack>
      </Stack>

      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper elevation={2}>
        <TableContainer>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'primary.main' }}>
              <TableRow>
                {['Code', 'Name', 'Type', 'Description', 'Status', 'System', 'Actions'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={32} sx={{ my: 3 }} /></TableCell></TableRow>
              ) : journals.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No journals. Click "Seed System Journals" to create the standard set.
                </TableCell></TableRow>
              ) : pg.rows.map(j => (
                <TableRow key={j._id} hover>
                  <TableCell><Typography fontWeight={700} fontFamily="monospace">{j.code}</Typography></TableCell>
                  <TableCell>{j.name}</TableCell>
                  <TableCell>
                    <Chip label={typeLabel(j.type)} color={typeColor(j.type)} size="small" />
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', maxWidth: 300 }}>{j.description || '—'}</TableCell>
                  <TableCell>
                    <Chip label={j.isActive ? 'Active' : 'Inactive'} color={j.isActive ? 'success' : 'default'} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {j.isSystem && <Chip label="System" size="small" color="warning" />}
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(j)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    {!j.isSystem && (
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDelete(j)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      </Paper>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Journal' : 'Create Journal'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Journal Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} fullWidth />
            <TextField label="Code *" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} fullWidth inputProps={{ maxLength: 10 }} helperText="Short code, e.g. PURCH, INV, BANK" disabled={!!editing?.isSystem} />
            <TextField select label="Type *" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} fullWidth>
              {JOURNAL_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </TextField>
            <TextField label="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} fullWidth multiline rows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !form.name || !form.code}>
            {saving ? <CircularProgress size={20} /> : (editing ? 'Update' : 'Create')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
