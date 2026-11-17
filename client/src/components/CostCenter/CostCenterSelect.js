import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete, TextField, Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Grid, MenuItem, Alert, CircularProgress, Checkbox
} from '@mui/material';
import { Add as AddIcon, Lock as LockIcon } from '@mui/icons-material';
import api from '../../services/api';

/**
 * Required store cost center picker for payable documents (indent, PO, cash approval, bills).
 *
 * - Lists active cost centers (GET /procurement/cost-centers/options). With `companyId`, only that company's cost
 *   centers plus those with no company (shared by every company); a selection of another company is cleared.
 * - When `departmentId` is given, pre-fills with that department's default cost center — on first load if empty,
 *   and again whenever the department changes (unless the user picked something else by hand).
 * - "Add new cost center" (permitted roles only) opens a small create dialog; the new one is selected.
 * - `lockedReason` shows the value read-only (e.g. copied from the indent).
 * - Marks itself required once the cost center go-live date has passed.
 */

const ADD_NEW = '__add_new__';
const CACHE_MS = 60 * 1000;
let optionsCache = { at: 0, data: null, promise: null };
let policyCache = { at: 0, data: null, promise: null };

const cached = (cache, loader) => {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.data);
  if (!cache.promise) {
    cache.promise = loader()
      .then((data) => { cache.data = data; cache.at = Date.now(); return data; })
      .finally(() => { cache.promise = null; });
  }
  return cache.promise;
};

const loadOptions = (force = false) => {
  if (force) optionsCache.at = 0;
  return cached(optionsCache, async () => {
    const res = await api.get('/procurement/cost-centers/options');
    return res.data?.data || { costCenters: [], canCreate: false };
  });
};

export const loadCostCenterPolicy = () => cached(policyCache, async () => {
  const res = await api.get('/procurement/cost-centers/policy');
  return res.data?.data || { mandatoryFrom: null };
});

/** True when a document started now must carry a cost center */
export const isCostCenterRequiredNow = (policy) => Boolean(
  policy?.mandatoryFrom && new Date() >= new Date(policy.mandatoryFrom)
);

const idOf = (v) => (v && typeof v === 'object' ? v._id : v) || '';
const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const labelOf = (cc) => (cc ? `${cc.code} — ${cc.path || cc.name}` : '');
/** Companies of a cost center (several allowed; older records only have `company`) */
const companiesOf = (cc) => ((cc?.companies && cc.companies.length) ? cc.companies : (cc?.company ? [cc.company] : []))
  .filter(Boolean);
/** A cost center with no company suits every company */
const fitsCompany = (cc, companyId) => {
  const own = companiesOf(cc).map((c) => String(idOf(c)));
  return !companyId || !own.length || own.includes(String(idOf(companyId)));
};

export default function CostCenterSelect({
  value,
  onChange,
  departmentId,
  departments,
  companyId,
  lockedReason,
  disabled = false,
  label = 'Cost Center',
  error = false,
  helperText,
  size = 'medium',
  fullWidth = true,
  sx
}) {
  const [options, setOptions] = useState([]);
  const [canCreate, setCanCreate] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  // The cost center we last pre-filled from the department; replaced on department change only if still selected
  const autoFilledRef = useRef('');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(idOf(value));
  valueRef.current = idOf(value);
  const companyIdRef = useRef(companyId);
  companyIdRef.current = companyId;

  const refresh = useCallback(async (force = false) => {
    try {
      const data = await loadOptions(force);
      setOptions(data.costCenters || []);
      setCanCreate(Boolean(data.canCreate));
    } catch (err) {
      console.error('Error loading cost centers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    loadCostCenterPolicy().then(setPolicy).catch(() => setPolicy(null));
  }, [refresh]);

  // Department default pre-fill
  useEffect(() => {
    if (!departmentId || lockedReason || disabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/procurement/cost-centers/department-default/${departmentId}`);
        const def = res.data?.data;
        if (cancelled) return;
        const current = valueRef.current;
        const untouched = !current || current === autoFilledRef.current;
        if (!untouched) return;
        if (def?._id && !fitsCompany(def, companyIdRef.current)) return;
        if (def?._id) {
          autoFilledRef.current = def._id;
          if (current !== def._id) onChangeRef.current?.(def._id, def);
        } else if (current) {
          // New department has no default: drop the previous department's pre-fill
          autoFilledRef.current = '';
          onChangeRef.current?.('', null);
        }
      } catch (err) {
        // No default is fine — the user picks one
      }
    })();
    return () => { cancelled = true; };
  }, [departmentId, lockedReason, disabled]);

  const companyKey = String(idOf(companyId) || '');
  const companyOptions = useMemo(
    () => options.filter((o) => fitsCompany(o, companyKey)),
    [options, companyKey]
  );

  // Company changed: drop a picked cost center that belongs to another company
  useEffect(() => {
    if (lockedReason || disabled || !companyKey || !options.length) return;
    const current = options.find((o) => String(o._id) === String(valueRef.current));
    if (current && !fitsCompany(current, companyKey)) {
      autoFilledRef.current = '';
      onChangeRef.current?.('', null);
    }
  }, [companyKey, options, lockedReason, disabled]);

  const selectedId = idOf(value);
  const selected = useMemo(() => {
    const found = options.find((o) => String(o._id) === String(selectedId));
    if (found) return found;
    // Value set but not in the active list (inactive, or populated object from the document)
    if (selectedId && value && typeof value === 'object') return value;
    return selectedId ? { _id: selectedId, code: '…', name: 'loading' } : null;
  }, [options, selectedId, value]);

  const required = isCostCenterRequiredNow(policy);
  const autoHelp = (() => {
    if (helperText) return helperText;
    if (policy?.mandatoryFrom && !required) {
      return `Required from ${new Date(policy.mandatoryFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }
    return undefined;
  })();

  if (lockedReason) {
    return (
      <TextField
        fullWidth={fullWidth}
        size={size}
        label={label}
        value={selected ? labelOf(selected) : '—'}
        InputProps={{ readOnly: true, startAdornment: <LockIcon fontSize="small" sx={{ mr: 1, color: 'text.disabled' }} /> }}
        helperText={lockedReason}
        sx={sx}
      />
    );
  }

  const listOptions = canCreate ? [...companyOptions, { _id: ADD_NEW }] : companyOptions;

  return (
    <>
      <Autocomplete
        fullWidth={fullWidth}
        size={size}
        options={listOptions}
        value={selected}
        loading={loading}
        disabled={disabled}
        isOptionEqualToValue={(o, v) => String(o._id) === String(v?._id)}
        getOptionLabel={(o) => (o._id === ADD_NEW ? '' : labelOf(o))}
        filterOptions={(opts, state) => {
          const q = normalize(state.inputValue);
          const matched = opts.filter((o) => o._id === ADD_NEW || !q
            || normalize(`${o.code} ${o.name} ${o.path} ${o.department?.name || ''}`).includes(q));
          return matched;
        }}
        renderOption={(props, o) => {
          if (o._id === ADD_NEW) {
            return (
              <li {...props} key={ADD_NEW}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'primary.main', fontWeight: 600 }}>
                  <AddIcon fontSize="small" /> Add new cost center
                </Box>
              </li>
            );
          }
          return (
            <li {...props} key={o._id}>
              <Box>
                <Typography variant="body2" fontWeight={600}>{o.code} — {o.name}</Typography>
                {(o.level > 0 || o.department?.name || companiesOf(o).length > 0) && (
                  <Typography variant="caption" color="text.secondary">
                    {[
                      o.level > 0 ? o.path : null,
                      o.department?.name,
                      companiesOf(o).map((c) => c?.name).filter(Boolean).join(', ')
                    ].filter(Boolean).join(' · ')}
                  </Typography>
                )}
              </Box>
            </li>
          );
        }}
        onChange={(_, o) => {
          if (o?._id === ADD_NEW) {
            setCreateOpen(true);
            return;
          }
          onChange?.(o?._id || '', o || null);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            required={required}
            error={error}
            helperText={autoHelp}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              )
            }}
          />
        )}
        sx={sx}
      />
      {createOpen && (
        <CostCenterCreateDialog
          open={createOpen}
          departmentId={departmentId}
          departments={departments}
          companyId={idOf(companyId)}
          existing={companyOptions}
          onClose={() => setCreateOpen(false)}
          onCreated={async (cc) => {
            setCreateOpen(false);
            await refresh(true);
            onChange?.(cc._id, cc);
          }}
        />
      )}
    </>
  );
}

function CostCenterCreateDialog({ open, departmentId, departments, companyId, existing, onClose, onCreated }) {
  const [form, setForm] = useState({ code: '', name: '', department: departmentId || '', companies: companyId ? [companyId] : [], description: '' });
  const [deptList, setDeptList] = useState(departments || []);
  const [companyList, setCompanyList] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [confirmSimilar, setConfirmSimilar] = useState(false);

  useEffect(() => {
    api.get('/procurement/cost-centers/next-code')
      .then((res) => setForm((f) => ({ ...f, code: f.code || res.data?.data?.code || '' })))
      .catch(() => {});
    if (!departments || departments.length === 0) {
      api.get('/hr/departments')
        .then((res) => setDeptList(res.data?.data || []))
        .catch(() => {});
    }
    api.get('/hr/companies')
      .then((res) => setCompanyList(res.data?.data || []))
      .catch(() => {});
  }, [departments]);

  const similar = useMemo(() => {
    const n = normalize(form.name);
    if (n.length < 3) return [];
    return (existing || []).filter((cc) => {
      const m = normalize(cc.name);
      return m === n || m.includes(n) || n.includes(m);
    }).slice(0, 3);
  }, [form.name, existing]);

  useEffect(() => { setConfirmSimilar(false); }, [form.name]);

  const handleSave = async () => {
    if (similar.length && !confirmSimilar) {
      setConfirmSimilar(true);
      return;
    }
    try {
      setSaving(true);
      setErr('');
      const dept = (deptList || []).find((d) => String(d._id || d.id) === String(form.department));
      const res = await api.post('/procurement/cost-centers', {
        code: form.code,
        name: form.name.trim(),
        department: form.department || '',
        departmentName: dept?.name || '',
        companies: form.companies || [],
        description: form.description,
        isActive: true
      });
      onCreated(res.data.data);
    } catch (e) {
      setErr(e.response?.data?.message || e.response?.data?.errors?.[0]?.msg || 'Failed to create cost center');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>New cost center</DialogTitle>
      <DialogContent dividers>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth size="small" label="Code" required value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            />
          </Grid>
          <Grid item xs={12} sm={8}>
            <TextField
              fullWidth size="small" label="Name" required autoFocus value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth select size="small" label="Companies" value={form.companies}
              onChange={(e) => {
                const v = e.target.value;
                setForm({ ...form, companies: typeof v === 'string' ? v.split(',') : v });
              }}
              SelectProps={{
                multiple: true,
                displayEmpty: true,
                renderValue: (selected) => (selected.length
                  ? companyList.filter((c) => selected.includes(c._id)).map((c) => c.name).join(', ')
                  : <em>All companies (shared)</em>)
              }}
              InputLabelProps={{ shrink: true }}
              helperText={form.companies.length ? 'Only documents of these companies can use it' : 'Shared — every company can use it'}
            >
              {companyList.map((c) => (
                <MenuItem key={c._id} value={c._id}>
                  <Checkbox size="small" checked={form.companies.includes(c._id)} sx={{ p: 0.5, mr: 1 }} />
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth select size="small" label="Department (optional)" value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {(deptList || []).map((d) => (
                <MenuItem key={d._id || d.id} value={d._id || d.id}>{d.name}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth multiline rows={2} size="small" label="Description" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Grid>
        </Grid>
        {similar.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Similar cost center{similar.length > 1 ? 's' : ''} already exist:{' '}
            {similar.map((cc) => `${cc.code} — ${cc.name}`).join(', ')}.
            {confirmSimilar ? ' Click Create again if this really is a different one.' : ' Did you mean one of these?'}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !form.code.trim() || !form.name.trim()}>
          {saving ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
