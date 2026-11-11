import React, { useEffect, useState } from 'react';
import {
  Autocomplete, Box, FormControl, FormControlLabel, Grid, InputLabel, MenuItem, Select, Switch, TextField, Typography
} from '@mui/material';
import api from '../../services/api';

export const emptySiteCharge = () => ({ on: false, project: '', subProject: '', budgetCategory: '' });

/**
 * "Used on a construction project" picker for a Store Issue Note: Project → Sub-Project → budget category.
 * Records which sub-project consumed the stock; the stock itself still comes out of the store business unit.
 * `onStoreProject(id)` is called with the project's linked store business unit when one is set.
 */
export const SubProjectChargePicker = ({ value, onChange, onStoreProject }) => {
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!value.on || projects.length) return undefined;
    let cancelled = false;
    setLoading(true);
    api.get('/indents/project-options')
      .then((res) => {
        if (cancelled) return;
        setProjects(res.data?.data?.projects || []);
        setCategories(res.data?.data?.budgetCategories || []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [value.on, projects.length]);

  const project = projects.find((p) => String(p._id) === String(value.project)) || null;
  const subs = project?.subProjects || [];

  return (
    <Box sx={{ mt: 1, p: 1.5, border: '1px solid', borderColor: value.on ? 'primary.light' : 'divider', borderRadius: 1 }}>
      <FormControlLabel
        control={<Switch size="small" checked={value.on} onChange={(e) => onChange(e.target.checked ? { ...value, on: true } : emptySiteCharge())} />}
        label={<Typography variant="body2" fontWeight={600}>Used on a construction sub-project</Typography>}
      />
      {value.on && (
        <Grid container spacing={1} sx={{ mt: 0.5 }}>
          <Grid item xs={12}>
            <Autocomplete
              size="small"
              options={projects}
              loading={loading}
              value={project}
              getOptionLabel={(p) => (p?.projectNumber ? `${p.projectNumber} — ${p.name}` : p?.name || '')}
              isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
              onChange={(_, p) => {
                onChange({ ...value, project: p?._id || '', subProject: '' });
                if (p?.storeProject && onStoreProject) onStoreProject(String(p.storeProject));
              }}
              renderInput={(params) => <TextField {...params} required label="Construction project" />}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size="small" required disabled={!value.project}>
              <InputLabel>Sub-project</InputLabel>
              <Select
                label="Sub-project"
                value={subs.some((s) => String(s._id) === String(value.subProject)) ? value.subProject : ''}
                onChange={(e) => onChange({ ...value, subProject: e.target.value })}
              >
                {subs.map((s) => <MenuItem key={s._id} value={s._id}>{s.name}</MenuItem>)}
                {value.project && !subs.length && <MenuItem disabled value="">No sub-projects yet</MenuItem>}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size="small" required>
              <InputLabel>Budget category</InputLabel>
              <Select
                label="Budget category"
                value={value.budgetCategory || ''}
                onChange={(e) => onChange({ ...value, budgetCategory: e.target.value })}
              >
                {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="caption" color="text.secondary">
              Shows as Consumed on the project&apos;s Procurement tab. Stock still comes out of the store project above.
            </Typography>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default SubProjectChargePicker;
