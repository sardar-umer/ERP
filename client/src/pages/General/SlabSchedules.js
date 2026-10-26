import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import {
  createSlabSchedule,
  deleteSlabSchedule,
  getSlabSchedules,
  getWbsActivities,
  updateSlabSchedule
} from '../../services/projectManagementService';
import SlabRowsEditor, { emptySlab, slabsTotalPercent } from '../../components/ProjectManagement/SlabRowsEditor';
import { WBS_ACTIVITIES_PATH, WBS_PROJECT_TYPES } from '../../utils/wbsProjectTypes';

const toEditorSlabs = (slabs = []) =>
  slabs.map((s) => ({
    key: s._id,
    name: s.name,
    percentage: s.percentage,
    description: s.description || '',
    activities: (s.activities || []).map((a) => a?._id || a)
  }));

/**
 * Reusable slab (percentage-wise) payment schedules per Project Type.
 * Loaded into slab-wise Sublet Contracts so stages and % don't have to be typed each time.
 */
const SlabSchedules = () => {
  const [projectType, setProjectType] = useState(WBS_PROJECT_TYPES[0].value);
  const [schedules, setSchedules] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', slabs: [] });
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [schedRes, actRes] = await Promise.all([
        getSlabSchedules({ projectType }),
        getWbsActivities({ projectType })
      ]);
      setSchedules(schedRes.data?.data || []);
      setActivities(actRes.data?.data?.activities || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load slab schedules');
    } finally {
      setLoading(false);
    }
  }, [projectType]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', description: '', slabs: [emptySlab()] });
    setDialogError('');
    setDialogOpen(true);
  };

  const openEdit = (schedule) => {
    setEditing(schedule);
    setForm({ name: schedule.name, description: schedule.description || '', slabs: toEditorSlabs(schedule.slabs) });
    setDialogError('');
    setDialogOpen(true);
  };

  const openCopy = (schedule) => {
    setEditing(null);
    setForm({ name: `${schedule.name} (copy)`, description: schedule.description || '', slabs: toEditorSlabs(schedule.slabs).map((s) => ({ ...s, key: emptySlab().key })) });
    setDialogError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setDialogError('Schedule name is required'); return; }
    if (!form.slabs.length) { setDialogError('Add at least one slab'); return; }
    if (form.slabs.some((s) => !String(s.name).trim())) { setDialogError('Every slab needs a name'); return; }
    if (Math.abs(slabsTotalPercent(form.slabs) - 100) >= 0.001) { setDialogError('Slab percentages must total 100%'); return; }

    setSaving(true);
    setDialogError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        slabs: form.slabs.map((s) => ({
          name: String(s.name).trim(),
          percentage: Number(s.percentage) || 0,
          description: s.description || '',
          activities: s.activities
        }))
      };
      if (editing) {
        await updateSlabSchedule(editing._id, payload);
      } else {
        await createSlabSchedule({ ...payload, projectType });
      }
      setSuccess(editing ? 'Slab schedule updated' : 'Slab schedule created');
      setDialogOpen(false);
      load();
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Failed to save slab schedule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (schedule) => {
    if (!window.confirm(`Delete slab schedule "${schedule.name}"?`)) return;
    try {
      const res = await deleteSlabSchedule(schedule._id);
      setSuccess(res.data?.message || 'Slab schedule deleted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete slab schedule');
    }
  };

  const typeLabel = WBS_PROJECT_TYPES.find((t) => t.value === projectType)?.label;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Slabs (Percentage Wise)</Typography>
          <Typography variant="body2" color="text.secondary">
            Standard payment stages per Project Type. Each slab is a % of the contract value and covers a set of WBS activities.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openAdd}>New Slab Schedule</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={projectType} onChange={(_, v) => setProjectType(v)} variant="scrollable" scrollButtons="auto">
          {WBS_PROJECT_TYPES.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
        </Tabs>
      </Paper>

      {!loading && !activities.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No WBS activities for {typeLabel} yet. You can still create slabs, but add activities in{' '}
          <RouterLink to={WBS_ACTIVITIES_PATH}>WBS Activities</RouterLink> to link each slab to its work.
        </Alert>
      )}

      {loading ? (
        <Skeleton height={300} />
      ) : !schedules.length ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>No slab schedules for {typeLabel} yet.</Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openAdd}>New Slab Schedule</Button>
        </Paper>
      ) : (
        schedules.map((schedule) => (
          <Paper key={schedule._id} variant="outlined" sx={{ mb: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.25, bgcolor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}>
              <Box>
                <Stack direction="row" alignItems="center" gap={1}>
                  <Typography variant="subtitle1" fontWeight={700}>{schedule.name}</Typography>
                  <Chip size="small" label={`${schedule.slabs.length} slab${schedule.slabs.length === 1 ? '' : 's'}`} />
                </Stack>
                {schedule.description && <Typography variant="caption" color="text.secondary">{schedule.description}</Typography>}
              </Box>
              <Stack direction="row">
                <Tooltip title="Duplicate"><IconButton size="small" onClick={() => openCopy(schedule)}><CopyIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(schedule)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Delete (deactivates if used by contracts)">
                  <IconButton size="small" color="error" onClick={() => handleDelete(schedule)}><DeleteIcon fontSize="small" /></IconButton>
                </Tooltip>
              </Stack>
            </Stack>
            <Box sx={{ p: 2 }}>
              <SlabRowsEditor
                readOnly
                slabs={toEditorSlabs(schedule.slabs)}
                activities={schedule.slabs.flatMap((s) => s.activities || [])}
                onChange={() => {}}
              />
            </Box>
          </Paper>
        ))
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{editing ? `Edit Slab Schedule: ${editing.name}` : `New Slab Schedule — ${typeLabel}`}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0, mb: 2 }}>
            <Grid item xs={12} md={5}>
              <TextField
                fullWidth required label="Schedule Name" value={form.name}
                placeholder="e.g. Villa construction – 5 slabs"
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={7}>
              <TextField
                fullWidth label="Description" value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </Grid>
          </Grid>
          <SlabRowsEditor
            slabs={form.slabs}
            activities={activities}
            onChange={(slabs) => setForm((p) => ({ ...p, slabs }))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SlabSchedules;
