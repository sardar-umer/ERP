import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, CircularProgress, Alert,
  Stack, Tooltip, Autocomplete, Divider
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Category as CategoryIcon, CheckCircle as SeedIcon,
  PublishedWithChanges as ApplyStdIcon
} from '@mui/icons-material';
import api from '../../services/api';

const AccountPicker = ({ label, value, onChange, accounts }) => (
  <Autocomplete
    options={accounts}
    value={value}
    onChange={(_, v) => onChange(v)}
    getOptionLabel={o => o ? `${o.accountNumber} – ${o.name}` : ''}
    isOptionEqualToValue={(o, v) => o?._id === v?._id}
    renderInput={(params) => (
      <TextField {...params} label={label} size="small" fullWidth
        helperText={value ? `Type: ${value.type}` : 'Optional — leave blank to inherit from parent'}
      />
    )}
    renderOption={(props, o) => (
      <li {...props} key={o._id}>
        <Box>
          <Typography fontFamily="monospace" fontSize="0.75rem" color="text.secondary">{o.accountNumber}</Typography>
          <Typography variant="body2">{o.name}</Typography>
          <Typography variant="caption" color="text.secondary">{o.type}</Typography>
        </Box>
      </li>
    )}
    clearOnBlur
    size="small"
  />
);

const emptyForm = {
  name: '', description: '',
  stockValuationAccount: null,
  stockInputAccount: null,
  stockOutputAccount: null,
  purchaseAccount: null,
  salesAccount: null
};

export default function InventoryCategories() {
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState(emptyForm);
  const [saving, setSaving]         = useState(false);
  const [seeding, setSeeding]       = useState(false);
  const [applyingStd, setApplyingStd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, accRes] = await Promise.all([
        api.get('/inventory-categories', {
          params: { isActive: 'all', _t: Date.now() },
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        }),
        api.get('/finance/accounts', { params: { page: 1, limit: 5000 } })
      ]);
      setCategories(catRes.data.data || []);
      setAccounts(accRes.data.data?.accounts || []);
    } catch {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (cat) => {
    setEditing(cat);
    const findAcc = (a) => a ? accounts.find(x => x._id === (a._id || a)) || null : null;
    setForm({
      name: cat.name,
      description: cat.description || '',
      stockValuationAccount: findAcc(cat.stockValuationAccount),
      stockInputAccount:     findAcc(cat.stockInputAccount),
      stockOutputAccount:    findAcc(cat.stockOutputAccount),
      purchaseAccount:       findAcc(cat.purchaseAccount),
      salesAccount:          findAcc(cat.salesAccount)
    });
    setDialogOpen(true);
  };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };

  const toId = (obj) => obj?._id || null;

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        stockValuationAccount: toId(form.stockValuationAccount),
        stockInputAccount:     toId(form.stockInputAccount),
        stockOutputAccount:    toId(form.stockOutputAccount),
        purchaseAccount:       toId(form.purchaseAccount),
        salesAccount:          toId(form.salesAccount)
      };
      if (editing) {
        await api.put(`/inventory-categories/${editing._id}`, payload);
        setSuccess('Category updated');
      } else {
        await api.post('/inventory-categories', payload);
        setSuccess('Category created');
      }
      closeDialog();
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleMakeDefault = async (cat) => {
    try {
      await api.put(`/inventory-categories/${cat._id}`, { isDefault: true });
      setSuccess(`"${cat.name}" is now the default Finance Category`);
      load();
    } catch (e) { setError(e.response?.data?.message || 'Could not set default'); }
  };

  const handleDelete = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}"?`)) return;
    try {
      await api.delete(`/inventory-categories/${cat._id}`);
      setSuccess('Category deleted');
      load();
    } catch (e) { setError(e.response?.data?.message || 'Delete failed'); }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await api.post('/inventory-categories/seed/defaults');
      const created = res.data.results?.filter(r => r.action === 'created').length || 0;
      setSuccess(`Seeded defaults. ${created} new category/categories created.`);
      load();
    } catch (e) { setError(e.response?.data?.message || 'Seeding failed'); }
    finally { setSeeding(false); }
  };

  const handleApplyStandardAccounts = async () => {
    const ok = window.confirm(
      'Apply standard chart accounts to ALL inventory categories (1100 Inventory, 2100 GRNI, 5000 COGS, purchase & sales defaults)?\n\n' +
      'Items without a finance category link will be mapped from their legacy type to a category.\n' +
      'Item-level account overrides will be cleared so posting uses category defaults.\n\nContinue?'
    );
    if (!ok) return;
    setApplyingStd(true);
    try {
      const res = await api.post('/inventory-categories/apply-standard-accounts', {});
      const d = res.data?.data;
      const extra = d?.linkNote ? ` ${d.linkNote}` : '';
      setSuccess(
        `Applied standard accounts. Categories updated: ${d?.categoriesModified ?? 0}. ` +
        `Items linked: ${d?.itemsLinked ?? 0}. Overrides cleared: ${d?.itemAccountOverridesCleared ?? 0}.${extra}`
      );
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Apply standard accounts failed');
    } finally {
      setApplyingStd(false);
    }
  };

  const accLabel = (a) => a ? `${a.accountNumber} – ${a.name}` : '—';

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CategoryIcon color="primary" sx={{ fontSize: 30 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>Inventory Categories</Typography>
            <Typography variant="body2" color="text.secondary">
              Each category defines default finance accounts for GRN, SIN and AP journal entries
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button variant="outlined" startIcon={seeding ? <CircularProgress size={16} /> : <SeedIcon />} onClick={handleSeedDefaults} disabled={seeding}>
            Seed Defaults
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={applyingStd ? <CircularProgress size={16} /> : <ApplyStdIcon />}
            onClick={handleApplyStandardAccounts}
            disabled={applyingStd || seeding}
          >
            Apply standard accounts (all)
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New Category
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
                {['Category', 'Stock Valuation (DR GRN)', 'GRNI / Stock Input (CR GRN)', 'COGS (DR SIN)', 'Status', 'Actions'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={32} sx={{ my: 3 }} /></TableCell></TableRow>
              ) : categories.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No categories. Click "Seed Defaults" to create standard categories with account links.
                </TableCell></TableRow>
              ) : categories.map(cat => (
                <TableRow key={cat._id} hover>
                  <TableCell>
                    <Typography fontWeight={700}>
                      {cat.name}
                      {cat.isDefault && <Chip label="Default" size="small" color="primary" sx={{ ml: 1, height: 20 }} />}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{cat.description}</Typography>
                  </TableCell>
                  <TableCell>
                    {cat.stockValuationAccount
                      ? <Chip label={accLabel(cat.stockValuationAccount)} size="small" color="primary" variant="outlined" />
                      : <Typography variant="caption" color="text.secondary">Not set</Typography>}
                  </TableCell>
                  <TableCell>
                    {cat.stockInputAccount
                      ? <Chip label={accLabel(cat.stockInputAccount)} size="small" color="warning" variant="outlined" />
                      : <Typography variant="caption" color="error.main">⚠ Not set (GRNI)</Typography>}
                  </TableCell>
                  <TableCell>
                    {cat.stockOutputAccount
                      ? <Chip label={accLabel(cat.stockOutputAccount)} size="small" color="error" variant="outlined" />
                      : <Typography variant="caption" color="text.secondary">Not set</Typography>}
                  </TableCell>
                  <TableCell>
                    <Chip label={cat.isActive ? 'Active' : 'Inactive'} color={cat.isActive ? 'success' : 'default'} size="small" variant="outlined" />
                    {!cat.isDefault && cat.isActive && (
                      <Tooltip title="Items with no Finance Category use the default one">
                        <Button size="small" sx={{ ml: 1 }} onClick={() => handleMakeDefault(cat)}>Make default</Button>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(cat)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDelete(cat)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? `Edit: ${editing.name}` : 'Create Inventory Category'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Category Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} fullWidth />
            <TextField label="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} fullWidth />

            <Divider><Typography variant="caption" color="text.secondary">Finance Accounts (Odoo-style)</Typography></Divider>

            <Box sx={{ p: 2, bgcolor: 'success.50', border: '1px solid', borderColor: 'success.200', borderRadius: 1 }}>
              <Typography variant="body2" fontWeight={600} gutterBottom color="success.dark">
                GRN Receipt Accounts
              </Typography>
              <Stack spacing={1.5}>
                <AccountPicker label="Stock Valuation Account (DR on GRN) — e.g. 1100 Inventory" value={form.stockValuationAccount} onChange={v => setForm(p => ({ ...p, stockValuationAccount: v }))} accounts={accounts.filter(a => a.type === 'Asset')} />
                <AccountPicker label="Stock Input / GRNI Account (CR on GRN) — e.g. 2100 GRNI" value={form.stockInputAccount} onChange={v => setForm(p => ({ ...p, stockInputAccount: v }))} accounts={accounts.filter(a => a.type === 'Liability')} />
              </Stack>
            </Box>

            <Box sx={{ p: 2, bgcolor: 'error.50', border: '1px solid', borderColor: 'error.200', borderRadius: 1 }}>
              <Typography variant="body2" fontWeight={600} gutterBottom color="error.dark">
                SIN / Goods Issue Accounts
              </Typography>
              <AccountPicker label="Stock Output / COGS Account (DR on SIN) — e.g. 5000 COGS" value={form.stockOutputAccount} onChange={v => setForm(p => ({ ...p, stockOutputAccount: v }))} accounts={accounts.filter(a => a.type === 'Expense')} />
            </Box>

            <Box sx={{ p: 2, bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200', borderRadius: 1 }}>
              <Typography variant="body2" fontWeight={600} gutterBottom>
                Other Accounts
              </Typography>
              <Stack spacing={1.5}>
                <AccountPicker label="Purchase / Expense Account" value={form.purchaseAccount} onChange={v => setForm(p => ({ ...p, purchaseAccount: v }))} accounts={accounts.filter(a => a.type === 'Expense')} />
                <AccountPicker label="Sales / Revenue Account" value={form.salesAccount} onChange={v => setForm(p => ({ ...p, salesAccount: v }))} accounts={accounts.filter(a => a.type === 'Revenue')} />
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !form.name}>
            {saving ? <CircularProgress size={20} /> : (editing ? 'Update' : 'Create')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
