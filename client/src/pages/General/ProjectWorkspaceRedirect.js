import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { getProjects } from '../../services/projectManagementService';

/** Sections that only exist on Sub Projects (Main only has overview + BOQ). */
const SUB_ONLY_SECTIONS = new Set(['sublet-contracts', 'tasks', 'check-requests', 'expenses', 'dpr', 'gantt', 'invoices']);
const KNOWN_SECTIONS = new Set(['overview', 'boq', 'sublet-contracts', 'tasks', 'check-requests', 'expenses', 'dpr', 'gantt', 'invoices']);

const parentIdOf = (p) => {
  if (!p?.parentProject) return null;
  return String(p.parentProject._id || p.parentProject);
};

export default function ProjectWorkspaceRedirect() {
  const navigate = useNavigate();
  const { section } = useParams();
  const hasKnownSection = KNOWN_SECTIONS.has(section || '');
  const needsSub = SUB_ONLY_SECTIONS.has(section || '');

  const lastProjectId = localStorage.getItem('pmLastProjectId');
  const lastSubProjectId = localStorage.getItem('pmLastSubProjectId');

  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState([]);
  const [selectedSubId, setSelectedSubId] = useState(lastSubProjectId || '');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!hasKnownSection) {
        setLoading(false);
        return;
      }

      // Fast path: we already know a Sub Project for Sub-only sections
      if (needsSub && lastSubProjectId) {
        navigate(`/general/project-management/${lastSubProjectId}?tab=${section}`, { replace: true });
        return;
      }

      // Fast path: BOQ/overview can open last project of either kind
      if (!needsSub && lastProjectId) {
        navigate(`/general/project-management/${lastProjectId}?tab=${section}`, { replace: true });
        return;
      }

      // Need a Sub Project — load options so user can pick one
      try {
        setLoading(true);
        setError('');
        const res = await getProjects({ page: 1, limit: 500 });
        const list = res.data?.data?.projects || [];
        const subList = list.filter((p) => Boolean(parentIdOf(p)));
        if (cancelled) return;
        setSubs(subList);

        // If lastProjectId is itself a Sub, use it
        if (lastProjectId && subList.some((p) => String(p._id) === String(lastProjectId))) {
          localStorage.setItem('pmLastSubProjectId', lastProjectId);
          navigate(`/general/project-management/${lastProjectId}?tab=${section}`, { replace: true });
          return;
        }

        // Single Sub available — open it directly
        if (subList.length === 1) {
          const only = subList[0]._id;
          localStorage.setItem('pmLastProjectId', only);
          localStorage.setItem('pmLastSubProjectId', only);
          navigate(`/general/project-management/${only}?tab=${section}`, { replace: true });
          return;
        }

        setSelectedSubId((prev) => prev || (subList[0]?._id || ''));
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Failed to load projects');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [hasKnownSection, needsSub, lastProjectId, lastSubProjectId, navigate, section]);

  const groupedSubs = useMemo(() => {
    const byMain = {};
    subs.forEach((s) => {
      const mainName = s.parentProject?.name || 'Main Project';
      if (!byMain[mainName]) byMain[mainName] = [];
      byMain[mainName].push(s);
    });
    return byMain;
  }, [subs]);

  const openSelected = () => {
    if (!selectedSubId) return;
    localStorage.setItem('pmLastProjectId', selectedSubId);
    localStorage.setItem('pmLastSubProjectId', selectedSubId);
    navigate(`/general/project-management/${selectedSubId}?tab=${section}`, { replace: true });
  };

  if (!hasKnownSection) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          Unknown workspace section. Please use Project Management sidebar links.
        </Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Opening workspace…
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Paper variant="outlined" sx={{ p: 2.5, maxWidth: 640 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
          Select a Sub Project
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          {needsSub
            ? `${String(section).toUpperCase()} opens on a Sub Project (not the Main Project). Pick one below — next time this shortcut will reopen it directly.`
            : 'Open a project to use this workspace shortcut.'}
        </Alert>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {subs.length === 0 ? (
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
              No Sub Projects found. Create a Main Project, then add a Sub Project under it.
            </Alert>
            <Button variant="contained" onClick={() => navigate('/general/project-management/projects')}>
              Go to Projects
            </Button>
          </>
        ) : (
          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Sub Project</InputLabel>
              <Select
                label="Sub Project"
                value={selectedSubId}
                onChange={(e) => setSelectedSubId(e.target.value)}
              >
                {Object.entries(groupedSubs).flatMap(([mainName, items]) => [
                  <MenuItem key={`hdr-${mainName}`} disabled sx={{ opacity: 1, fontWeight: 700 }}>
                    {mainName}
                  </MenuItem>,
                  ...items.map((s) => (
                    <MenuItem key={s._id} value={s._id} sx={{ pl: 3 }}>
                      {s.name} {s.projectNumber ? `(${s.projectNumber})` : ''}
                    </MenuItem>
                  ))
                ])}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" disabled={!selectedSubId} onClick={openSelected}>
                Open {section}
              </Button>
              <Button variant="outlined" onClick={() => navigate('/general/project-management/projects')}>
                Projects list
              </Button>
            </Stack>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
