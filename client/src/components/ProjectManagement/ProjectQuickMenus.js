/**
 * One-click changes from wherever a project is shown (list, project page headers), without opening Edit:
 * - ProjectStatusMenu: the status chip opens a menu of statuses; on a Main Project it can apply to its Sub Projects too.
 * - ProjectTypeMenu: on a Main Project, change the Project Type or BOQ-wise / Slab-wise; its Sub Projects follow.
 * - StoreProjectMenu: on a Main Project, the store business unit whose stock its goods go into.
 */
import React, { useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Tooltip, Typography
} from '@mui/material';
import { Check as CheckIcon, ExpandMore as MoreIcon, Warehouse as StoreIcon } from '@mui/icons-material';
import { updateProject } from '../../services/projectManagementService';
import api from '../../services/api';
import { ContractTypeTag, STATUS_DOT } from './mainProjectUi';

// Cancelling stays on its own action (with its confirmation), so it is not offered here
const STATUSES = [
  { value: 'Draft', text: 'Being set up' },
  { value: 'Planning', text: 'Approved, preparing to start' },
  { value: 'Active', text: 'Work in progress on site' },
  { value: 'On Hold', text: 'Paused' },
  { value: 'Completed', text: 'All work done and closed' }
];
const STATUS_CHIP_COLOR = { Draft: 'default', Planning: 'info', Active: 'success', 'On Hold': 'warning', Completed: 'primary', Cancelled: 'error' };
const PROJECT_TYPES = ['INFRASTRUCTURE DEVELOPMENT', 'COMMERCIAL', 'VILLAS'];
const basisLabel = (b) => (b === 'Slab' ? 'Slab-wise' : 'BOQ-wise');

const isMain = (p) => !(p?.parentProject?._id || p?.parentProject);

/** Small confirm dialog shared by both menus */
const Confirm = ({ open, title, children, error, busy, onCancel, onConfirm, confirmLabel = 'Change' }) => (
  <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth="xs" fullWidth onClick={(e) => e.stopPropagation()}>
    <DialogTitle sx={{ fontWeight: 800 }}>{title}</DialogTitle>
    <DialogContent>
      {children}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}>
      <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button variant="contained" onClick={onConfirm} disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : null}>{confirmLabel}</Button>
    </DialogActions>
  </Dialog>
);

/**
 * Status chip that changes the status in place.
 * `chipSx` restyles the chip for dark headers; `subCount` (Main only) shows how many Sub Projects can follow.
 */
export function ProjectStatusMenu({ project, onChanged, subCount, chipSx, size = 'small' }) {
  const [anchor, setAnchor] = useState(null);
  const [pending, setPending] = useState(null);
  const [cascade, setCascade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const main = isMain(project);
  const status = project.status || 'Draft';
  const locked = status === 'Cancelled';

  const save = async (next, applyToSubs) => {
    setBusy(true);
    setError('');
    try {
      await updateProject(project._id, { status: next, applyStatusToSubs: Boolean(applyToSubs) });
      setPending(null);
      onChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not change the status');
      if (!pending) setPending({ status: next });
    } finally {
      setBusy(false);
    }
  };

  const pick = (next) => {
    setAnchor(null);
    if (next === status) return;
    // A Main Project asks whether its Sub Projects should follow; a Sub Project changes straight away
    if (main && subCount !== 0) {
      setCascade(['Completed', 'On Hold'].includes(next));
      setError('');
      setPending({ status: next });
    } else {
      save(next, false);
    }
  };

  return (
    <>
      <Tooltip title={locked ? 'Cancelled projects cannot change status here' : 'Change status'}>
        <Chip
          label={busy && !pending ? 'Saving…' : status}
          size={size}
          color={STATUS_CHIP_COLOR[status] || 'default'}
          onClick={locked ? undefined : (e) => { e.stopPropagation(); setAnchor(e.currentTarget); }}
          onDelete={locked ? undefined : (e) => { e.stopPropagation(); setAnchor(e.currentTarget.closest('.MuiChip-root')); }}
          deleteIcon={locked ? undefined : <MoreIcon />}
          sx={{ fontWeight: 700, cursor: locked ? 'default' : 'pointer', ...chipSx }}
        />
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 800 }}>Set status</ListSubheader>
        {STATUSES.map((s) => (
          <MenuItem key={s.value} selected={s.value === status} onClick={() => pick(s.value)} sx={{ minWidth: 250 }}>
            <ListItemIcon><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: STATUS_DOT[s.value] || '#94a3b8', ml: 0.5 }} /></ListItemIcon>
            <ListItemText primary={s.value} secondary={s.text} primaryTypographyProps={{ fontWeight: 700 }} />
            {s.value === status && <CheckIcon fontSize="small" color="primary" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}
      </Menu>
      <Confirm
        open={Boolean(pending)}
        title={`Set ${project.name} to ${pending?.status}?`}
        error={error}
        busy={busy}
        onCancel={() => { setPending(null); setError(''); }}
        onConfirm={() => save(pending.status, main && cascade)}
      >
        {main ? (
          <FormControlLabel
            control={<Checkbox checked={cascade} onChange={(e) => setCascade(e.target.checked)} />}
            label={`Also set ${subCount ? `its ${subCount} sub project${subCount === 1 ? '' : 's'}` : 'all its sub projects'} to ${pending?.status}`}
          />
        ) : (
          <Typography variant="body2">The status of this sub project will change.</Typography>
        )}
        {pending?.status === 'Completed' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Today is recorded as the completion date if none is set.</Typography>
        )}
      </Confirm>
    </>
  );
}

/** Main Project only: Project Type + BOQ-wise / Slab-wise, changed in place (Sub Projects follow) */
export function ProjectTypeMenu({ project, onChanged, dark = false }) {
  const [anchor, setAnchor] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isMain(project)) return null;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await updateProject(project._id, pending.changes);
      setPending(null);
      onChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save the change');
    } finally {
      setBusy(false);
    }
  };

  const ask = (changes, title, text) => {
    setAnchor(null);
    setError('');
    setPending({ changes, title, text });
  };

  return (
    <>
      <Tooltip title="Change project type or BOQ-wise / Slab-wise">
        <Box
          component="span"
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }}
          onKeyDown={(e) => e.key === 'Enter' && setAnchor(e.currentTarget)}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, borderRadius: 2, cursor: 'pointer',
            border: '1px dashed', borderColor: dark ? 'rgba(255,255,255,0.4)' : 'divider',
            '&:hover': { borderColor: 'primary.main', bgcolor: dark ? 'rgba(255,255,255,0.08)' : 'action.hover' }
          }}
        >
          {project.contractBasis ? <ContractTypeTag type={project.contractBasis} /> : (
            <Chip size="small" label="Set BOQ / Slab" color="warning" variant="outlined" sx={{ fontWeight: 700 }} />
          )}
          <Typography variant="caption" fontWeight={700} sx={{ color: dark ? 'rgba(255,255,255,0.85)' : 'text.secondary', whiteSpace: 'nowrap' }}>
            {project.projectType || 'No type'}
          </Typography>
          <MoreIcon sx={{ fontSize: 16, color: dark ? '#fff' : 'text.secondary' }} />
        </Box>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 800 }}>Contract basis</ListSubheader>
        {['BOQ', 'Slab'].map((b) => (
          <MenuItem
            key={b}
            selected={project.contractBasis === b}
            onClick={() => (project.contractBasis === b ? setAnchor(null) : ask(
              { contractBasis: b },
              `Make ${project.name} ${basisLabel(b)}?`,
              `All its sub projects become ${basisLabel(b)}, and only ${basisLabel(b)} sublet contracts can be made under it. This is refused if it already has ${basisLabel(b === 'Slab' ? 'BOQ' : 'Slab')} contracts.`
            ))}
            sx={{ minWidth: 260 }}
          >
            <ListItemText primary={<ContractTypeTag type={b} />} />
            {project.contractBasis === b && <CheckIcon fontSize="small" color="primary" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}
        <Divider />
        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 800 }}>Project type</ListSubheader>
        {PROJECT_TYPES.map((t) => (
          <MenuItem
            key={t}
            selected={project.projectType === t}
            onClick={() => (project.projectType === t ? setAnchor(null) : ask(
              { projectType: t },
              `Change ${project.name} to ${t}?`,
              'All its sub projects take this type too. Their Sector / Block choices follow the new type.'
            ))}
          >
            <ListItemText primary={t} primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }} />
            {project.projectType === t && <CheckIcon fontSize="small" color="primary" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}
      </Menu>
      <Confirm
        open={Boolean(pending)}
        title={pending?.title}
        error={error}
        busy={busy}
        onCancel={() => { setPending(null); setError(''); }}
        onConfirm={save}
      >
        <Typography variant="body2">{pending?.text}</Typography>
      </Confirm>
    </>
  );
}


/**
 * Store business unit of a Main Project (the store's "Project", e.g. Boly.Pk). GRNs made from this
 * project's POs put stock under it automatically; its Sub Projects use the same one.
 */
export function StoreProjectMenu({ project, onChanged, dark = false }) {
  const [anchor, setAnchor] = useState(null);
  const [options, setOptions] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isMain(project)) return null;

  const current = project.storeProject && typeof project.storeProject === 'object' ? project.storeProject : null;

  const open = async (e) => {
    e.stopPropagation();
    setAnchor(e.currentTarget);
    if (options) return;
    try {
      let res = await api.get('/finance/fixed-assets/projects');
      let list = Array.isArray(res.data?.data) ? res.data.data : [];
      if (!list.length) {
        res = await api.get('/projects');
        list = Array.isArray(res.data?.data) ? res.data.data : [];
      }
      setOptions(list);
    } catch {
      try {
        const res = await api.get('/projects');
        setOptions(Array.isArray(res.data?.data) ? res.data.data : []);
      } catch {
        setOptions([]);
      }
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await updateProject(project._id, { storeProject: pending?._id || null });
      setPending(null);
      onChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save the change');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title="Store business unit: GRNs for this project's purchases put stock here">
        <Box
          component="span"
          role="button"
          tabIndex={0}
          onClick={open}
          onKeyDown={(e) => e.key === 'Enter' && open(e)}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, borderRadius: 2, cursor: 'pointer',
            border: '1px dashed', borderColor: dark ? 'rgba(255,255,255,0.4)' : 'divider',
            '&:hover': { borderColor: 'primary.main', bgcolor: dark ? 'rgba(255,255,255,0.08)' : 'action.hover' }
          }}
        >
          <StoreIcon sx={{ fontSize: 16, color: dark ? '#fff' : 'text.secondary' }} />
          {current ? (
            <Typography variant="caption" fontWeight={700} sx={{ color: dark ? 'rgba(255,255,255,0.85)' : 'text.secondary', whiteSpace: 'nowrap' }}>
              Store: {current.name}
            </Typography>
          ) : (
            <Chip size="small" label="Link store unit" color="warning" variant="outlined" sx={{ fontWeight: 700 }} />
          )}
          <MoreIcon sx={{ fontSize: 16, color: dark ? '#fff' : 'text.secondary' }} />
        </Box>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
        PaperProps={{ sx: { maxHeight: 420 } }}
      >
        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 800 }}>Store business unit</ListSubheader>
        {options === null && (
          <MenuItem disabled><CircularProgress size={16} sx={{ mr: 1 }} /> Loading…</MenuItem>
        )}
        {current && (
          <MenuItem onClick={() => { setAnchor(null); setError(''); setPending({ _id: null, name: '' }); }}>
            <ListItemText primary="Remove link" primaryTypographyProps={{ color: 'error.main', fontSize: 14 }} />
          </MenuItem>
        )}
        {(options || []).map((o) => {
          const selected = current && String(current._id) === String(o._id);
          return (
            <MenuItem
              key={o._id}
              selected={selected}
              onClick={() => {
                setAnchor(null);
                if (selected) return;
                setError('');
                setPending(o);
              }}
              sx={{ minWidth: 260 }}
            >
              <ListItemText primary={o.name} secondary={o.code || null} primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }} />
              {selected && <CheckIcon fontSize="small" color="primary" sx={{ ml: 1 }} />}
            </MenuItem>
          );
        })}
      </Menu>
      <Confirm
        open={Boolean(pending)}
        title={pending?._id ? `Link ${project.name} to ${pending.name}?` : `Remove the store link from ${project.name}?`}
        error={error}
        busy={busy}
        onCancel={() => { setPending(null); setError(''); }}
        onConfirm={save}
        confirmLabel={pending?._id ? 'Link' : 'Remove'}
      >
        <Typography variant="body2">
          {pending?._id
            ? `GRNs made from this project's POs (all its sub projects) will put stock under ${pending.name} automatically. Stock already received is not moved.`
            : 'New GRNs for this project will no longer fill the store business unit automatically. Stock already received is not moved.'}
        </Typography>
      </Confirm>
    </>
  );
}
