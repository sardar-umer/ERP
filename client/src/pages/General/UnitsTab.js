import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, Grid, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import {
  addProjectUnits, deleteProjectUnit, getProjectUnits, updateProjectUnit
} from '../../services/projectManagementService';
import UnitProgressGrid from '../../components/ProjectManagement/UnitProgressGrid';
import { unitWord } from '../../utils/wbsProjectTypes';

export { unitWord };

const emptyUnit = { name: '', plotNumber: '', street: '', side: '', notes: '' };

/** Dialog for one unit, or a numbered series (Villa 1 … Villa 20) */
const UnitDialog = ({ open, onClose, onSave, editing, word, saving }) => {
  // "Floor / Unit" → name the series "Floor 1, Floor 2 …"
  const prefix = word.split(' / ')[0];
  const [mode, setMode] = useState('one');
  const [form, setForm] = useState(emptyUnit);
  const [series, setSeries] = useState({ prefix, from: 1, to: 10, plotPrefix: '', street: '', side: '' });

  useEffect(() => {
    if (!open) return;
    setMode('one');
    setForm(editing ? { ...emptyUnit, ...editing } : emptyUnit);
    setSeries({ prefix, from: 1, to: 10, plotPrefix: '', street: '', side: '' });
  }, [open, editing, prefix]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setS = (k) => (e) => setSeries((s) => ({ ...s, [k]: e.target.value }));

  const from = Math.max(1, parseInt(series.from, 10) || 1);
  const to = Math.max(from, parseInt(series.to, 10) || from);
  const seriesUnits = Array.from({ length: Math.min(500, to - from + 1) }, (_, i) => ({
    name: `${String(series.prefix || prefix).trim()} ${from + i}`,
    plotNumber: series.plotPrefix ? `${series.plotPrefix}${from + i}` : '',
    street: series.street,
    side: series.side,
    notes: ''
  }));

  const sideSelect = (value, onChange) => (
    <FormControl fullWidth size="small">
      <InputLabel>Side</InputLabel>
      <Select label="Side" value={value} onChange={onChange}>
        <MenuItem value="">—</MenuItem>
        <MenuItem value="Left">Left</MenuItem>
        <MenuItem value="Right">Right</MenuItem>
      </Select>
    </FormControl>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? `Edit ${editing.name}` : `Add ${word}`}</DialogTitle>
      <DialogContent dividers>
        {!editing && (
          <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, v) => v && setMode(v)} sx={{ mb: 2 }}>
            <ToggleButton value="one">One {word.toLowerCase()}</ToggleButton>
            <ToggleButton value="series">Numbered series</ToggleButton>
          </ToggleButtonGroup>
        )}
        {mode === 'one' ? (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Name" value={form.name} onChange={set('name')} placeholder={`${prefix} 1`} autoFocus /></Grid>
            <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Plot number" value={form.plotNumber} onChange={set('plotNumber')} /></Grid>
            <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Street" value={form.street} onChange={set('street')} /></Grid>
            <Grid item xs={12} sm={6}>{sideSelect(form.side, set('side'))}</Grid>
            <Grid item xs={12}><TextField fullWidth size="small" label="Notes" value={form.notes} onChange={set('notes')} multiline minRows={2} /></Grid>
          </Grid>
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Name prefix" value={series.prefix} onChange={setS('prefix')} /></Grid>
            <Grid item xs={6} sm={4}><TextField fullWidth size="small" type="number" label="From" value={series.from} onChange={setS('from')} /></Grid>
            <Grid item xs={6} sm={4}><TextField fullWidth size="small" type="number" label="To" value={series.to} onChange={setS('to')} /></Grid>
            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Plot no. prefix" value={series.plotPrefix} onChange={setS('plotPrefix')} placeholder="e.g. D-" helperText="Optional" /></Grid>
            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Street" value={series.street} onChange={setS('street')} /></Grid>
            <Grid item xs={12} sm={4}>{sideSelect(series.side, setS('side'))}</Grid>
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">
                Adds {seriesUnits.length}: {seriesUnits[0]?.name}{seriesUnits.length > 1 ? ` … ${seriesUnits[seriesUnits.length - 1].name}` : ''}
                {series.plotPrefix ? ` (plots ${seriesUnits[0]?.plotNumber}${seriesUnits.length > 1 ? ` … ${seriesUnits[seriesUnits.length - 1].plotNumber}` : ''})` : ''}
              </Typography>
            </Grid>
          </Grid>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || (mode === 'one' ? !form.name.trim() : !seriesUnits.length)}
          onClick={() => onSave(mode === 'one' ? [form] : seriesUnits)}
        >
          {saving ? 'Saving…' : editing ? 'Save' : mode === 'one' ? 'Add' : `Add ${seriesUnits.length}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/** Sub Project tab: the villas / units being built in it */
export default function UnitsTab({ projectId, project }) {
  const word = unitWord(project?.projectType);
  const words = unitWord(project?.projectType, true);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialog, setDialog] = useState({ open: false, editing: null });
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('progress');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProjectUnits(projectId);
      setUnits(res.data?.data || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || `Could not load ${words.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [projectId, words]);

  useEffect(() => { load(); }, [load]);

  const save = async (rows) => {
    setSaving(true);
    try {
      const res = dialog.editing
        ? await updateProjectUnit(projectId, dialog.editing._id, rows[0])
        : await addProjectUnits(projectId, rows);
      setUnits(res.data?.data || []);
      setSuccess(dialog.editing ? `${rows[0].name} updated` : `${rows.length} ${rows.length === 1 ? word.toLowerCase() : words.toLowerCase()} added`);
      setError('');
      setDialog({ open: false, editing: null });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (unit) => {
    if (!window.confirm(`Remove ${unit.name}?`)) return;
    try {
      const res = await deleteProjectUnit(projectId, unit._id);
      setUnits(res.data?.data || []);
      setSuccess(`${unit.name} removed`);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove');
    }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>{words} ({units.length})</Typography>
          <Typography variant="body2" color="text.secondary">
            The {words.toLowerCase()} built in {project?.name || 'this Sub Project'}. Sublet contracts and claims will be made against these.
          </Typography>
        </Box>
        <Stack direction="row" gap={1} alignItems="center">
          {units.length > 0 && (
            <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)}>
              <ToggleButton value="progress">Progress</ToggleButton>
              <ToggleButton value="list">List</ToggleButton>
            </ToggleButtonGroup>
          )}
          <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, editing: null })}>
            Add {words}
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {loading ? (
        <Box textAlign="center" py={4}><CircularProgress size={28} /></Box>
      ) : !units.length ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
          <Typography color="text.secondary">No {words.toLowerCase()} added yet.</Typography>
          <Button sx={{ mt: 2 }} variant="outlined" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, editing: null })}>
            Add {words}
          </Button>
        </Paper>
      ) : view === 'progress' ? (
        <UnitProgressGrid projectId={projectId} word={word} reloadKey={units} />
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: '#f8fafc' } }}>
                <TableCell width={48}>#</TableCell>
                <TableCell>{word}</TableCell>
                <TableCell>Plot no.</TableCell>
                <TableCell>Street</TableCell>
                <TableCell>Side</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell align="right" width={96} />
              </TableRow>
            </TableHead>
            <TableBody>
              {units.map((u, i) => (
                <TableRow key={u._id} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{u.name}</TableCell>
                  <TableCell>{u.plotNumber || '—'}</TableCell>
                  <TableCell>{u.street || '—'}</TableCell>
                  <TableCell>{u.side || '—'}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{u.notes || '—'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setDialog({ open: true, editing: u })}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(u)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <UnitDialog
        open={dialog.open}
        editing={dialog.editing}
        word={word}
        saving={saving}
        onClose={() => setDialog({ open: false, editing: null })}
        onSave={save}
      />
    </Box>
  );
}
