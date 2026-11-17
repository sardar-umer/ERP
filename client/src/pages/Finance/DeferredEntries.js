import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress, Alert,
  Stack, Card, CardContent, Grid, Tooltip, Collapse, Autocomplete, LinearProgress
} from '@mui/material';
import {
  Add as AddIcon, PlayArrow as RecognizeIcon,
  WatchLater as DeferredIcon, ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
  Refresh as RunAllIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { financeListFromResponse } from '../../utils/financeApiData';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import useClientPagination from '../../hooks/useClientPagination';

const fmt     = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PK') : '—';
const TYPE_COLOR  = { deferred_revenue: 'success', deferred_expense: 'warning' };
const SCHED_COLOR = { pending: 'warning', posted: 'success', skipped: 'default' };

const emptyForm = {
  type: 'deferred_revenue', name: '', description: '', referenceDoc: '',
  totalAmount: '', startDate: new Date().toISOString().split('T')[0],
  endDate: '', frequency: 'monthly',
  deferredAccount: '', recognitionAccount: '', department: ''
};

function ScheduleRow({ entry, onRecognize }) {
  const [open, setOpen] = useState(false);
  const pct = entry.totalAmount > 0 ? (entry.recognizedAmount / entry.totalAmount * 100) : 0;
  const pendingLines = (entry.schedule || []).filter(s => s.status === 'pending');

  return (
    <>
      <TableRow hover>
        <TableCell padding="checkbox">
          <IconButton size="small" onClick={() => setOpen(v => !v)}>
            {open ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={700}>{entry.name}</Typography>
          {entry.referenceDoc && <Typography variant="caption" color="text.disabled">{entry.referenceDoc}</Typography>}
        </TableCell>
        <TableCell>
          <Chip label={entry.type?.replace('_', ' ')} color={TYPE_COLOR[entry.type] || 'default'} size="small" />
        </TableCell>
        <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(entry.totalAmount)}</TableCell>
        <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(entry.recognizedAmount)}</TableCell>
        <TableCell>
          <Box sx={{ width: 100 }}>
            <LinearProgress variant="determinate" value={Math.min(pct, 100)} color={pct >= 100 ? 'success' : 'primary'} sx={{ borderRadius: 5, height: 8 }} />
            <Typography variant="caption">{pct.toFixed(0)}%</Typography>
          </Box>
        </TableCell>
        <TableCell>{fmtDate(entry.startDate)} → {fmtDate(entry.endDate)}</TableCell>
        <TableCell align="center">{pendingLines.length}</TableCell>
        <TableCell>
          <Chip label={entry.status} color={{ active: 'primary', completed: 'success', cancelled: 'default' }[entry.status] || 'default'} size="small" />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={9} sx={{ p: 0, border: 0 }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ m: 1, bgcolor: 'grey.50', borderRadius: 1, p: 1 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ pl: 1 }}>RECOGNITION SCHEDULE</Typography>
              <Table size="small" sx={{ mt: 0.5 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Period</TableCell><TableCell>Scheduled Date</TableCell>
                    <TableCell align="right">Amount</TableCell><TableCell>Status</TableCell>
                    <TableCell>Posted</TableCell><TableCell align="center">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(entry.schedule || []).map(s => (
                    <TableRow key={s._id} sx={{ bgcolor: s.status === 'posted' ? 'success.50' : 'inherit' }}>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.period}</TableCell>
                      <TableCell>{fmtDate(s.scheduledDate)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(s.amount)}</TableCell>
                      <TableCell><Chip label={s.status} color={SCHED_COLOR[s.status]||'default'} size="small" /></TableCell>
                      <TableCell>{fmtDate(s.postedAt)}</TableCell>
                      <TableCell align="center">
                        {s.status === 'pending' && (
                          <Tooltip title="Recognize this period now">
                            <IconButton size="small" color="success" onClick={() => onRecognize(entry._id, s._id)}>
                              <RecognizeIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default function DeferredEntries() {
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [entRes, accRes] = await Promise.all([
        api.get('/finance/deferred-entries', { params: { type: typeFilter || undefined } }),
        api.get('/finance/accounts', { params: { limit: 500 } })
      ]);
      setEntries(entRes.data.data || []);
      setAccounts(financeListFromResponse(accRes));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);
  useFinanceCompanyReload(load, { skipInitial: true });

  const setF = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSave = async () => {
    if (!form.name || !form.totalAmount || !form.startDate || !form.endDate || !form.deferredAccount || !form.recognitionAccount) {
      setError('Please fill all required fields'); return;
    }
    setSaving(true); setError('');
    try {
      await api.post('/finance/deferred-entries', form);
      setSuccess('Deferred entry created with recognition schedule');
      setOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRecognize = async (entryId, lineId) => {
    try {
      await api.post(`/finance/deferred-entries/${entryId}/recognize/${lineId}`);
      setSuccess('Period recognized and journal entry posted');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Recognition failed');
    }
  };

  const runAllRecognition = async () => {
    setRunning(true); setError('');
    try {
      const res = await api.post('/finance/deferred-entries/run-recognition');
      setSuccess(res.data.message);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  const totalDeferred    = entries.reduce((s, e) => s + (e.totalAmount || 0), 0);
  const totalRecognized  = entries.reduce((s, e) => s + (e.recognizedAmount || 0), 0);
  const totalRemaining   = totalDeferred - totalRecognized;

  const getAcc = (id) => accounts.find(a => a._id === id) || null;

  const pg = useClientPagination(entries);
  return (
    <Box sx={{ p: 3 }}>
      <FinanceCompanyPageHeader title="Deferred Revenue & Expenses" icon={DeferredIcon}>
          <Button variant="outlined" color="success" startIcon={running ? <CircularProgress size={16} color="inherit" /> : <RunAllIcon />}
            onClick={runAllRecognition} disabled={running}>
            Run Current Month
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>New Entry</Button>
      </FinanceCompanyPageHeader>

      {error   && <Alert severity="error"   onClose={() => setError('')}   sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <Grid container spacing={2} mb={3}>
        {[
          { label: 'Total Deferred', value: fmt(totalDeferred), color: 'primary.main' },
          { label: 'Recognized',     value: fmt(totalRecognized), color: 'success.main' },
          { label: 'Remaining',      value: fmt(totalRemaining), color: 'warning.main' },
          { label: 'Active Entries', value: entries.filter(e => e.status === 'active').length, raw: true, color: 'text.primary' }
        ].map(c => (
          <Grid item xs={6} sm={3} key={c.label}>
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                <Typography variant="h6" fontWeight={700} color={c.color}>{c.raw ? c.value : c.value}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Alert severity="info" sx={{ mb: 2 }}>
        Recognition runs automatically on the <strong>1st of every month at 07:30 AM</strong>. Click "Run Current Month" to trigger manually.
        Expand any row with <strong>▼</strong> to see the full schedule and recognize individual periods.
      </Alert>

      {/* Filter */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <TextField select label="Type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} size="small" sx={{ minWidth: 200 }}>
          <MenuItem value="">All Types</MenuItem>
          <MenuItem value="deferred_revenue">Deferred Revenue</MenuItem>
          <MenuItem value="deferred_expense">Deferred Expense</MenuItem>
        </TextField>
      </Paper>

      {loading ? <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor: 'primary.main' }}>
                <TableCell sx={{ bgcolor: 'primary.main', width: 40 }} />
                {['Name','Type','Total','Recognized','Progress','Period','Pending','Status'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700, bgcolor: 'primary.main' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.length === 0 && (
                <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No deferred entries. Create one to spread revenue/expense over multiple periods.
                </TableCell></TableRow>
              )}
              {pg.rows.map(e => (
                <ScheduleRow key={e._id} entry={e} onRecognize={handleRecognize} />
              ))}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}

      {/* Create dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle display="flex" alignItems="center" gap={1}><DeferredIcon color="primary" /> New Deferred Entry</DialogTitle>
        <DialogContent>
          <Stack gap={2} mt={1}>
            <TextField select label="Type *" value={form.type} onChange={setF('type')} size="small" fullWidth>
              <MenuItem value="deferred_revenue">Deferred Revenue (e.g. advance from customer)</MenuItem>
              <MenuItem value="deferred_expense">Deferred Expense (e.g. prepaid insurance)</MenuItem>
            </TextField>
            <Stack direction="row" gap={2}>
              <TextField size="small" label="Name *" value={form.name} onChange={setF('name')} fullWidth />
              <TextField size="small" label="Ref Doc / Invoice #" value={form.referenceDoc} onChange={setF('referenceDoc')} fullWidth />
            </Stack>
            <Stack direction="row" gap={2}>
              <TextField size="small" label="Total Amount (PKR) *" type="number" value={form.totalAmount} onChange={setF('totalAmount')} fullWidth inputProps={{ min: 0 }} />
              <TextField select size="small" label="Frequency" value={form.frequency} onChange={setF('frequency')} fullWidth>
                <MenuItem value="monthly">Monthly</MenuItem>
                <MenuItem value="quarterly">Quarterly</MenuItem>
              </TextField>
            </Stack>
            <Stack direction="row" gap={2}>
              <TextField size="small" label="Start Date *" type="date" value={form.startDate} onChange={setF('startDate')} fullWidth InputLabelProps={{ shrink: true }} />
              <TextField size="small" label="End Date *" type="date" value={form.endDate} onChange={setF('endDate')} fullWidth InputLabelProps={{ shrink: true }} />
            </Stack>
            <Autocomplete size="small" fullWidth
              options={accounts} getOptionLabel={a => `${a.accountNumber} — ${a.name} (${a.type})`}
              value={getAcc(form.deferredAccount)}
              onChange={(_, val) => setForm(f => ({ ...f, deferredAccount: val?._id || '' }))}
              renderInput={(params) => <TextField {...params} label={`Deferred ${form.type === 'deferred_revenue' ? 'Revenue' : 'Expense'} Account *`} placeholder="Balance sheet account (Liability/Asset)" />}
            />
            <Autocomplete size="small" fullWidth
              options={accounts} getOptionLabel={a => `${a.accountNumber} — ${a.name} (${a.type})`}
              value={getAcc(form.recognitionAccount)}
              onChange={(_, val) => setForm(f => ({ ...f, recognitionAccount: val?._id || '' }))}
              renderInput={(params) => <TextField {...params} label="Recognition Account *" placeholder="P&L account (Revenue/Expense)" />}
            />
            <Stack direction="row" gap={2}>
              <TextField size="small" label="Department" value={form.department} onChange={setF('department')} fullWidth />
            </Stack>
            <TextField size="small" label="Description" value={form.description} onChange={setF('description')} fullWidth multiline rows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={18} color="inherit" /> : 'Create & Generate Schedule'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
