import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, Button, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Grid,
  Select, MenuItem, FormControl, InputLabel, Switch, FormControlLabel,
  Tooltip, Divider, Autocomplete
} from '@mui/material';
import {
  Repeat as RecurIcon, Add as AddIcon, PlayArrow as RunIcon,
  Edit as EditIcon, Delete as DeleteIcon,
  Refresh as RefreshIcon, Schedule as ScheduleIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { financeListFromResponse } from '../../utils/financeApiData';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import useClientPagination from '../../hooks/useClientPagination';

const FREQ_COLORS = { daily: 'error', weekly: 'warning', monthly: 'primary', quarterly: 'success', yearly: 'secondary' };
const FREQ_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK') : '—';
const fmt     = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`;

const EMPTY_LINE = { account: null, description: '', debit: '', credit: '' };
const EMPTY_FORM = {
  name: '', description: '', frequency: 'monthly', dayOfMonth: 1,
  startDate: new Date().toISOString().split('T')[0], endDate: '',
  journalCode: 'GEN', department: 'finance', isActive: true, lines: [EMPTY_LINE, EMPTY_LINE]
};

export default function RecurringJournals() {
  const [rows, setRows]         = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  const [dialog, setDialog]     = useState({ open: false, editing: null });
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rj, accts] = await Promise.all([
        api.get('/finance/recurring-journals'),
        api.get('/finance/accounts', { params: { limit: 500 } })
      ]);
      setRows(rj.data.data || []);
      setAccounts(financeListFromResponse(accts));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFinanceCompanyReload(load, { skipInitial: true });

  const openNew  = () => { setForm(EMPTY_FORM); setDialog({ open: true, editing: null }); };
  const openEdit = (rj) => {
    setForm({
      name: rj.name, description: rj.description || '', frequency: rj.frequency,
      dayOfMonth: rj.dayOfMonth || 1, startDate: rj.startDate?.split('T')[0] || '',
      endDate: rj.endDate?.split('T')[0] || '', journalCode: rj.journalCode || 'GEN',
      department: rj.department || 'finance', isActive: rj.isActive,
      lines: rj.lines.map(l => ({
        account: accounts.find(a => a._id === (l.account?._id || l.account)) || l.account,
        description: l.description || '', debit: l.debit || '', credit: l.credit || ''
      }))
    });
    setDialog({ open: true, editing: rj._id });
  };
  const closeDialog = () => setDialog({ open: false, editing: null });

  const setLine = (i, field, val) => {
    const lines = [...form.lines];
    lines[i] = { ...lines[i], [field]: val };
    setForm(f => ({ ...f, lines }));
  };
  const addLine    = () => setForm(f => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const totalDR = form.lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCR = form.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDR - totalCR) < 0.01;

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!balanced) { setError(`Lines not balanced: DR ${totalDR.toFixed(2)} ≠ CR ${totalCR.toFixed(2)}`); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        lines: form.lines.map(l => ({
          account:     l.account?._id || l.account,
          description: l.description,
          debit:       parseFloat(l.debit)  || 0,
          credit:      parseFloat(l.credit) || 0,
          department:  form.department
        }))
      };
      if (dialog.editing) {
        await api.put(`/finance/recurring-journals/${dialog.editing}`, payload);
        setSuccess('Recurring journal updated');
      } else {
        await api.post('/finance/recurring-journals', payload);
        setSuccess('Recurring journal created');
      }
      closeDialog();
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async (rj) => {
    if (!window.confirm(`Post "${rj.name}" as a journal entry now?`)) return;
    try {
      const res = await api.post(`/finance/recurring-journals/${rj._id}/run`);
      setSuccess(res.data.message);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to run');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this recurring journal?')) return;
    try {
      await api.delete(`/finance/recurring-journals/${id}`);
      setSuccess('Deleted');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed');
    }
  };

  const handleToggle = async (rj) => {
    try {
      await api.put(`/finance/recurring-journals/${rj._id}`, { isActive: !rj.isActive });
      load();
    } catch (e) {
      setError('Toggle failed');
    }
  };

  const pg = useClientPagination(rows);
  return (
    <Box sx={{ p: 3 }}>
      <FinanceCompanyPageHeader title="Recurring Journal Entries" icon={RecurIcon}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} size="small">Refresh</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>New Recurring Journal</Button>
      </FinanceCompanyPageHeader>

      <Alert severity="info" sx={{ mb: 2 }}>
        Recurring journals auto-post at 6:00 AM PKT on their scheduled date.
        Use "Run Now" to post immediately. Common uses: rent, depreciation provisions, insurance, subscriptions.
      </Alert>

      {error   && <Alert severity="error"   onClose={() => setError('')}   sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'primary.main' }}>
                {['Name', 'Frequency', 'Next Run', 'Last Run', 'Runs', 'Lines', 'Status', 'Actions'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.disabled' }}>
                    No recurring journals yet — click "New Recurring Journal" to create one
                  </TableCell>
                </TableRow>
              ) : pg.rows.map(rj => (
                <TableRow key={rj._id} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' }, opacity: rj.isActive ? 1 : 0.55 }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{rj.name}</Typography>
                    {rj.description && <Typography variant="caption" color="text.secondary">{rj.description}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Chip label={FREQ_LABELS[rj.frequency]} size="small" color={FREQ_COLORS[rj.frequency]} />
                  </TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <ScheduleIcon fontSize="small" color={rj.nextRunDate && new Date(rj.nextRunDate) <= new Date() ? 'error' : 'action'} />
                      <Typography variant="body2">{fmtDate(rj.nextRunDate)}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell><Typography variant="body2" color="text.secondary">{fmtDate(rj.lastRunDate)}</Typography></TableCell>
                  <TableCell><Chip label={rj.runCount || 0} size="small" variant="outlined" /></TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {(rj.lines || []).length} lines
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={rj.isActive ? 'Click to deactivate' : 'Click to activate'}>
                      <Chip
                        label={rj.isActive ? 'Active' : 'Paused'}
                        size="small"
                        color={rj.isActive ? 'success' : 'default'}
                        onClick={() => handleToggle(rj)}
                        sx={{ cursor: 'pointer' }}
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Box display="flex" gap={0.5}>
                      <Tooltip title="Run Now (Post immediately)">
                        <IconButton size="small" color="success" onClick={() => handleRun(rj)} disabled={!rj.isActive}>
                          <RunIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton size="small" color="primary" onClick={() => openEdit(rj)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => handleDelete(rj._id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialog.open} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <RecurIcon color="primary" />
            {dialog.editing ? 'Edit Recurring Journal' : 'New Recurring Journal'}
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={8}>
              <TextField fullWidth size="small" label="Name *" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Frequency</InputLabel>
                <Select value={form.frequency} label="Frequency"
                  onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                  {Object.entries(FREQ_LABELS).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth size="small" label="Description" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth size="small" label="Day of Month" type="number" inputProps={{ min: 1, max: 28 }}
                value={form.dayOfMonth}
                onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth size="small" label="Start Date *" type="date" value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth size="small" label="End Date (optional)" type="date" value={form.endDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <FormControlLabel control={
                <Switch checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} color="success" />
              } label="Active" />
            </Grid>

            <Grid item xs={12}>
              <Divider><Typography variant="caption" color="text.secondary">Journal Lines</Typography></Divider>
            </Grid>

            {form.lines.map((line, i) => (
              <React.Fragment key={i}>
                <Grid item xs={12} sm={4}>
                  <Autocomplete
                    size="small"
                    options={accounts}
                    getOptionLabel={a => `${a.accountNumber} — ${a.name}`}
                    value={line.account}
                    onChange={(_, val) => setLine(i, 'account', val)}
                    renderInput={params => <TextField {...params} label={`Account (line ${i + 1})`} />}
                  />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth size="small" label="Description" value={line.description}
                    onChange={e => setLine(i, 'description', e.target.value)} />
                </Grid>
                <Grid item xs={5} sm={2}>
                  <TextField fullWidth size="small" label="Debit" type="number" value={line.debit}
                    onChange={e => setLine(i, 'debit', e.target.value)} inputProps={{ min: 0 }} />
                </Grid>
                <Grid item xs={5} sm={2}>
                  <TextField fullWidth size="small" label="Credit" type="number" value={line.credit}
                    onChange={e => setLine(i, 'credit', e.target.value)} inputProps={{ min: 0 }} />
                </Grid>
                <Grid item xs={2} sm={1} display="flex" alignItems="center">
                  {form.lines.length > 2 && (
                    <IconButton size="small" color="error" onClick={() => removeLine(i)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Grid>
              </React.Fragment>
            ))}

            <Grid item xs={12}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Button size="small" startIcon={<AddIcon />} onClick={addLine}>Add Line</Button>
                <Box display="flex" gap={2}>
                  <Typography variant="body2" color="primary.main" fontWeight={700}>DR: {fmt(totalDR)}</Typography>
                  <Typography variant="body2" color="success.main" fontWeight={700}>CR: {fmt(totalCR)}</Typography>
                  {!balanced && <Chip label="Not Balanced!" size="small" color="error" />}
                  {balanced  && totalDR > 0 && <Chip label="Balanced ✓" size="small" color="success" />}
                </Box>
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !balanced || !form.name}>
            {saving ? 'Saving…' : dialog.editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
