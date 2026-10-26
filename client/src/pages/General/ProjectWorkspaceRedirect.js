import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import {
  AccountTree as TreeIcon,
  Add as AddIcon,
  Construction as ConstructionIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { getProjects } from '../../services/projectManagementService';

/** Sections that only exist on Sub Projects (Main only has overview + BOQ). */
const SUB_ONLY_SECTIONS = new Set(['sublet-contracts', 'check-requests', 'dpr', 'invoices']);

const SECTION_LABELS = {
  overview: 'Overview',
  boq: 'BOQ',
  'sublet-contracts': 'Sublet Contracts',
  'check-requests': 'Check Requests',
  dpr: 'Daily Reports',
  invoices: 'Invoices'
};

const LAST_PROJECT_KEY = 'pmLastProjectId';
const LAST_SUB_KEY = 'pmLastSubProjectId';

const readStored = (key) => {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
};
const writeStored = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
};

const parentIdOf = (p) => (p?.parentProject ? String(p.parentProject._id || p.parentProject) : null);

const projectSubtitle = (p) =>
  [p.projectNumber, p.sector, p.street, p.side && `${p.side} side`, p.projectType].filter(Boolean).join(' · ');

/**
 * Sidebar workspace shortcut (/general/project-management/workspace/:section).
 * Reopens the last project used for that section when it still exists; otherwise asks which one to open.
 */
export default function ProjectWorkspaceRedirect() {
  const navigate = useNavigate();
  const { section } = useParams();
  const sectionLabel = SECTION_LABELS[section];
  const needsSub = SUB_ONLY_SECTIONS.has(section || '');

  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const openProject = (project) => {
    const pid = String(project._id);
    writeStored(LAST_PROJECT_KEY, pid);
    if (parentIdOf(project)) writeStored(LAST_SUB_KEY, pid);
    navigate(`/general/project-management/${pid}?tab=${section}`, { replace: true });
  };

  useEffect(() => {
    if (!sectionLabel) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const res = await getProjects({ page: 1, limit: 1000 });
        if (cancelled) return;
        const all = res.data?.data?.projects || [];
        // Sub-only sections need a Sub Project; Overview / BOQ work on Main or Sub
        const eligible = all.filter((p) => p.status !== 'Cancelled' && (!needsSub || parentIdOf(p)));
        const byId = new Map(eligible.map((p) => [String(p._id), p]));

        // Only reopen a remembered project that still exists; forget stale ids (deleted / cancelled)
        const lastSub = readStored(LAST_SUB_KEY);
        const lastAny = readStored(LAST_PROJECT_KEY);
        if (lastSub && !all.some((p) => String(p._id) === lastSub)) writeStored(LAST_SUB_KEY, '');
        if (lastAny && !all.some((p) => String(p._id) === lastAny)) writeStored(LAST_PROJECT_KEY, '');

        const remembered = (needsSub ? [lastSub, lastAny] : [lastAny, lastSub])
          .map((pid) => byId.get(pid))
          .find(Boolean);
        if (remembered) {
          openProject(remembered);
          return;
        }
        if (eligible.length === 1) {
          openProject(eligible[0]);
          return;
        }
        setProjects(eligible);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || 'Could not load projects. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // openProject only depends on navigate + section
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, needsSub, sectionLabel]);

  // Group options under their Main Project (Mains group under themselves)
  const options = useMemo(() => {
    const groupName = (p) => (parentIdOf(p) ? (p.parentProject?.name || 'Other') : p.name);
    return [...projects].sort((a, b) =>
      groupName(a).localeCompare(groupName(b)) ||
      (parentIdOf(a) ? 1 : 0) - (parentIdOf(b) ? 1 : 0) ||
      String(a.name).localeCompare(String(b.name))
    ).map((p) => ({ ...p, _group: groupName(p) }));
  }, [projects]);

  if (!sectionLabel) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This page doesn't exist anymore. Please use the Project Management links in the sidebar.
        </Alert>
        <Button variant="contained" onClick={() => navigate('/general/project-management/projects')}>Go to Projects</Button>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">Opening {sectionLabel}…</Typography>
      </Box>
    );
  }

  const kind = needsSub ? 'Sub Project' : 'project';

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 680, borderRadius: 2 }}>
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 1 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'rgba(25,118,210,0.08)', color: 'primary.main' }}>
            <ConstructionIcon />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700}>{sectionLabel}</Typography>
            <Typography variant="body2" color="text.secondary">
              Choose the {kind} you want to work on.
            </Typography>
          </Box>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ my: 2 }} action={<Button color="inherit" size="small" onClick={() => window.location.reload()}>Retry</Button>}>
            {error}
          </Alert>
        )}

        {!error && !options.length ? (
          <Box sx={{ mt: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              {needsSub
                ? `${sectionLabel} is kept per Sub Project, and there are no Sub Projects yet. Create a Main Project, then add a Sub Project under it.`
                : 'There are no projects yet. Create a Main Project to get started.'}
            </Alert>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/general/project-management/projects')}>
              Go to Projects
            </Button>
          </Box>
        ) : !error && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Autocomplete
              autoHighlight
              openOnFocus
              options={options}
              groupBy={(p) => p._group}
              value={selected}
              onChange={(_, v) => setSelected(v)}
              isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
              getOptionLabel={(p) => (p ? `${p.name}${p.projectNumber ? ` (${p.projectNumber})` : ''}` : '')}
              filterOptions={(opts, { inputValue }) => {
                const q = inputValue.trim().toLowerCase();
                if (!q) return opts;
                return opts.filter((p) =>
                  [p.name, p.projectNumber, p.sector, p.street, p.projectType, p._group]
                    .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
              }}
              renderOption={(props, p) => (
                <li {...props} key={p._id}>
                  <Stack direction="row" alignItems="center" gap={1.25} sx={{ width: '100%' }}>
                    {parentIdOf(p)
                      ? <ConstructionIcon fontSize="small" color="action" />
                      : <TreeIcon fontSize="small" color="primary" />}
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{p.name}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">{projectSubtitle(p) || '—'}</Typography>
                    </Box>
                    {!parentIdOf(p) && <Chip size="small" label="Main" variant="outlined" />}
                  </Stack>
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} autoFocus label={needsSub ? 'Sub Project' : 'Project'} placeholder="Search by name, number, sector or street" />
              )}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" disabled={!selected} onClick={() => selected && openProject(selected)}>
                Open {sectionLabel}
              </Button>
              <Button variant="outlined" onClick={() => navigate('/general/project-management/projects')}>
                All Projects
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Next time, {sectionLabel} opens this {kind} directly. Open a different project from the Projects list to switch.
            </Typography>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
