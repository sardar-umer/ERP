import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import {
  createWbsActivity,
  deleteWbsActivity,
  getWbsActivities,
  updateWbsActivity
} from '../../services/projectManagementService';
import { WBS_PROJECT_TYPES } from '../../utils/wbsProjectTypes';

const UNIT_OPTIONS = ['Cum', 'Sqft', 'Sqm', 'Rft', 'Rm', 'Kg', 'Ton', 'No.', 'Job', 'LS'];

const emptyForm = { group: '', name: '', code: '', unit: '', description: '', orderIndex: '' };

/**
 * Master WBS activities, defined once per Project Type (Infra / Commercial / Villas).
 * Every Sub Project of that type gets these activities in its WBS automatically.
 */
const WbsActivities = () => {
  const [projectType, setProjectType] = useState(WBS_PROJECT_TYPES[0].value);
  const [activities, setActivities] = useState([]);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getWbsActivities({ projectType, includeInactive: 'true' });
      setActivities(res.data?.data?.activities || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  }, [projectType]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => activities.filter((a) => showInactive || a.isActive),
    [activities, showInactive]
  );

  const grouped = useMemo(() => {
    const map = new Map();
    visible.forEach((a) => {
      if (!map.has(a.group)) map.set(a.group, []);
      map.get(a.group).push(a);
    });
    return [...map.entries()];
  }, [visible]);

  const groupOptions = useMemo(() => [...new Set(activities.map((a) => a.group))], [activities]);

  const openAdd = (group = '') => {
    setEditing(null);
    setForm({ ...emptyForm, group });
    setDialogError('');
    setDialogOpen(true);
  };

  const openEdit = (activity) => {
    setEditing(activity);
    setForm({
      group: activity.group,
      name: activity.name,
      code: activity.code || '',
      unit: activity.unit || '',
      description: activity.description || '',
      orderIndex: activity.orderIndex ?? ''
    });
    setDialogError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.group.trim()) { setDialogError('Group is required'); return; }
    if (!form.name.trim()) { setDialogError('Activity name is required'); return; }
    setSaving(true);
    setDialogError('');
    try {
      const payload = {
        group: form.group.trim(),
        name: form.name.trim(),
        code: form.code,
        unit: form.unit,
        description: form.description,
        ...(form.orderIndex !== '' ? { orderIndex: Number(form.orderIndex) } : {})
      };
      if (editing) {
        await updateWbsActivity(editing._id, payload);
      } else {
        await createWbsActivity({ ...payload, projectType });
      }
      setSuccess(editing ? 'Activity updated' : 'Activity created');
      setDialogOpen(false);
      load();
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Failed to save activity');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (activity) => {
    try {
      await updateWbsActivity(activity._id, { isActive: !activity.isActive });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update activity');
    }
  };

  const handleDelete = async (activity) => {
    if (!window.confirm(`Delete activity "${activity.name}"?`)) return;
    try {
      const res = await deleteWbsActivity(activity._id);
      setSuccess(res.data?.message || 'Activity deleted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete activity');
    }
  };

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>WBS Activities</Typography>
          <Typography variant="body2" color="text.secondary">
            Master activities per Project Type. Every Sub Project of that type gets these in its WBS, sublet contracts and check requests.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => openAdd()}>Add Activity</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ pr: 2 }}>
          <Tabs value={projectType} onChange={(_, v) => setProjectType(v)} variant="scrollable" scrollButtons="auto">
            {WBS_PROJECT_TYPES.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
          </Tabs>
          <FormControlLabel
            sx={{ pl: { xs: 2, sm: 0 } }}
            control={<Switch size="small" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />}
            label={<Typography variant="body2">Show inactive</Typography>}
          />
        </Stack>
      </Paper>

      {loading ? (
        <Skeleton height={300} />
      ) : !grouped.length ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            No activities for this project type yet. Add groups like "Earthwork", "Structure" or "Finishing" and their activities.
          </Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => openAdd()}>Add Activity</Button>
        </Paper>
      ) : (
        grouped.map(([group, rows]) => (
          <Paper key={group} variant="outlined" sx={{ mb: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.25, bgcolor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}>
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography variant="subtitle1" fontWeight={700}>{group}</Typography>
                <Chip size="small" label={`${rows.length} activit${rows.length === 1 ? 'y' : 'ies'}`} />
              </Stack>
              <Button size="small" startIcon={<AddIcon />} onClick={() => openAdd(group)}>Add to group</Button>
            </Stack>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 60 }}>#</TableCell>
                    <TableCell sx={{ width: 110 }}>Code</TableCell>
                    <TableCell>Activity</TableCell>
                    <TableCell sx={{ width: 90 }}>Unit</TableCell>
                    <TableCell sx={{ width: 110 }}>Status</TableCell>
                    <TableCell align="right" sx={{ width: 140 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a._id} hover sx={{ opacity: a.isActive ? 1 : 0.55 }}>
                      <TableCell>{a.orderIndex}</TableCell>
                      <TableCell>{a.code || '—'}</TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>{a.name}</Typography>
                        {a.description && <Typography variant="caption" color="text.secondary">{a.description}</Typography>}
                      </TableCell>
                      <TableCell>{a.unit || '—'}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={a.isActive ? 'Active' : 'Inactive'}
                          color={a.isActive ? 'success' : 'default'}
                          variant={a.isActive ? 'filled' : 'outlined'}
                          onClick={() => handleToggleActive(a)}
                          sx={{ cursor: 'pointer' }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(a)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete (deactivates if already in use)">
                          <IconButton size="small" color="error" onClick={() => handleDelete(a)}><DeleteIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        ))
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editing ? `Edit Activity: ${editing.name}` : `Add Activity — ${WBS_PROJECT_TYPES.find((t) => t.value === projectType)?.label}`}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12}>
              <Autocomplete
                freeSolo
                options={groupOptions}
                value={form.group}
                onInputChange={(_, v) => setForm((prev) => ({ ...prev, group: v || '' }))}
                renderInput={(params) => (
                  <TextField {...params} required label="Group" helperText="e.g. Earthwork, Structure, Finishing — pick existing or type a new one" />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth required label="Activity Name" value={form.name} onChange={set('name')} placeholder="e.g. Roof slab casting" />
            </Grid>
            <Grid item xs={6} sm={4}>
              <TextField fullWidth label="Code" value={form.code} onChange={set('code')} placeholder="e.g. STR-05" />
            </Grid>
            <Grid item xs={6} sm={4}>
              <Autocomplete
                freeSolo
                options={UNIT_OPTIONS}
                value={form.unit}
                onInputChange={(_, v) => setForm((prev) => ({ ...prev, unit: v || '' }))}
                renderInput={(params) => <TextField {...params} label="Unit" />}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth type="number" label="Order" value={form.orderIndex} onChange={set('orderIndex')} helperText={editing ? '' : 'Blank = add at end'} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth multiline rows={2} label="Description" value={form.description} onChange={set('description')} />
            </Grid>
          </Grid>
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

export default WbsActivities;
