import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, CircularProgress, Alert,
  Stack, Tooltip, Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import {
  CalendarMonth as PeriodIcon, Lock as LockIcon, LockOpen as UnlockIcon,
  Close as CloseIcon, Add as AddIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const statusColor = (s) => ({ open: 'success', closed: 'warning', locked: 'error' }[s] || 'default');

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

export default function FiscalPeriods() {
  const [periods, setPeriods]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [generateYear, setGenerateYear] = useState(new Date().getFullYear());
  const [genDialog, setGenDialog] = useState(false);
  const [generating, setGenerating] = useState(false);

  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/fiscal-periods?year=${filterYear}`);
      setPeriods(res.data.data || []);
    } catch {
      setError('Failed to load fiscal periods');
    } finally {
      setLoading(false);
    }
  }, [filterYear]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post('/finance/fiscal-periods/generate', { year: generateYear });
      setSuccess(res.data.message);
      setGenDialog(false);
      if (generateYear === filterYear) load();
    } catch (e) {
      setError(e.response?.data?.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleClose = async (p) => {
    if (!window.confirm(`Close period "${p.name}"? Posting will be blocked after this.`)) return;
    try {
      await api.put(`/finance/fiscal-periods/${p._id}/close`);
      setSuccess(`Period "${p.name}" closed`);
      load();
    } catch (e) { setError(e.response?.data?.message || 'Failed'); }
  };

  const handleReopen = async (p) => {
    if (!window.confirm(`Reopen period "${p.name}"?`)) return;
    try {
      await api.put(`/finance/fiscal-periods/${p._id}/reopen`);
      setSuccess(`Period "${p.name}" reopened`);
      load();
    } catch (e) { setError(e.response?.data?.message || 'Failed'); }
  };

  const handleLock = async (p) => {
    if (!window.confirm(`PERMANENTLY lock period "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.put(`/finance/fiscal-periods/${p._id}/lock`);
      setSuccess(`Period "${p.name}" locked permanently`);
      load();
    } catch (e) { setError(e.response?.data?.message || 'Failed'); }
  };

  const pg = useClientPagination(periods);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PeriodIcon color="primary" sx={{ fontSize: 30 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>Fiscal Periods</Typography>
            <Typography variant="body2" color="text.secondary">
              Closed periods block retroactive journal entries — protecting finalized reports
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" gap={1} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Year</InputLabel>
            <Select value={filterYear} label="Year" onChange={e => setFilterYear(e.target.value)}>
              {years.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </Select>
          </FormControl>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setGenDialog(true)}>
            Generate Year
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
                {['Period', 'Start Date', 'End Date', 'Status', 'Closed By', 'Actions'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={32} sx={{ my: 3 }} /></TableCell></TableRow>
              ) : periods.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No periods for {filterYear}. Click "Generate Year" to create them.
                </TableCell></TableRow>
              ) : pg.rows.map(p => (
                <TableRow key={p._id} hover>
                  <TableCell><Typography fontWeight={600}>{p.name}</Typography></TableCell>
                  <TableCell>{new Date(p.startDate).toLocaleDateString('en-PK')}</TableCell>
                  <TableCell>{new Date(p.endDate).toLocaleDateString('en-PK')}</TableCell>
                  <TableCell>
                    <Chip label={p.status.toUpperCase()} color={statusColor(p.status)} size="small" />
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {p.closedBy ? `${p.closedBy.firstName} ${p.closedBy.lastName}` : '—'}
                  </TableCell>
                  <TableCell>
                    {p.status === 'open' && (
                      <Tooltip title="Close Period">
                        <IconButton size="small" color="warning" onClick={() => handleClose(p)}><CloseIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                    {p.status === 'closed' && (
                      <>
                        <Tooltip title="Reopen Period">
                          <IconButton size="small" color="success" onClick={() => handleReopen(p)}><UnlockIcon fontSize="small" /></IconButton>
                        </Tooltip>
                        <Tooltip title="Lock Period (Permanent)">
                          <IconButton size="small" color="error" onClick={() => handleLock(p)}><LockIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      </>
                    )}
                    {p.status === 'locked' && (
                      <Chip label="Locked" size="small" icon={<LockIcon />} color="error" variant="outlined" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      </Paper>

      {/* Generate Year Dialog */}
      <Dialog open={genDialog} onClose={() => setGenDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Generate Fiscal Periods</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            This will create 12 monthly periods (Jan–Dec) for the selected year. Existing periods are not overwritten.
          </Typography>
          <TextField
            select label="Year" value={generateYear}
            onChange={e => setGenerateYear(e.target.value)}
            fullWidth sx={{ mt: 2 }}
          >
            {years.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleGenerate} disabled={generating}>
            {generating ? <CircularProgress size={20} /> : 'Generate'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
