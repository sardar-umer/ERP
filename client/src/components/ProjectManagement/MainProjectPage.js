import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, LinearProgress, Paper, Stack,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography
} from '@mui/material';
import {
  AccountTree as TreeIcon, ArrowBack as BackIcon, BarChart as ChartIcon, Dashboard as SummaryIcon,
  DeleteForever as DeleteForeverIcon, Event as DateIcon, Place as PlaceIcon, Refresh as RefreshIcon,
  ShoppingCart as BoqIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { getProjectSummary, getProjectTree } from '../../services/projectManagementService';
import {
  ACCENT, BORDER, INK, Label, PROJECT_STATUS_COLOR, STATUS_DOT, fmt, plural, progressColor
} from './mainProjectUi';
import SubProjectPanel from './SubProjectPanel';
import ProjectSummaryPanel from './ProjectSummaryPanel';

const SUMMARY = 'summary';
// The app's sticky top bar is 96px tall; the sidebar sticks just under it
const STICKY_TOP = 104;

const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

const HeaderStat = ({ label, value, sub, progress, valueColor }) => (
  <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: '#f8fafc', border: `1px solid ${BORDER}` }}>
    <Label>{label}</Label>
    <Typography variant="h6" fontWeight={800} sx={{ color: valueColor || INK, lineHeight: 1.3 }}>{value}</Typography>
    {progress !== undefined && (
      <LinearProgress
        variant="determinate"
        value={Math.min(100, Math.max(0, progress))}
        color={progressColor(progress)}
        sx={{ mt: 0.75, height: 5, borderRadius: 3, bgcolor: '#e2e8f0' }}
      />
    )}
    {sub && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{sub}</Typography>}
  </Box>
);

/** Left sidebar: Project Summary, then each Sub Project */
const Sidebar = ({ subs, moneyById, selected, onSelect }) => {
  const Item = ({ id, active, children }) => (
    <Box
      onClick={() => onSelect(id)}
      sx={{
        px: 1.5, py: 1.25, borderRadius: 2, cursor: 'pointer', borderLeft: '3px solid',
        borderLeftColor: active ? ACCENT : 'transparent',
        bgcolor: active ? 'rgba(15,118,110,0.08)' : 'transparent',
        '&:hover': { bgcolor: active ? 'rgba(15,118,110,0.1)' : '#f1f5f9' }
      }}
    >
      {children}
    </Box>
  );
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1, borderRadius: 3, border: `1px solid ${BORDER}`, bgcolor: '#fff',
        position: { md: 'sticky' }, top: { md: STICKY_TOP },
        maxHeight: { xs: 320, md: `calc(100vh - ${STICKY_TOP + 16}px)` }, overflowY: 'auto'
      }}
    >
      <Item id={SUMMARY} active={selected === SUMMARY}>
        <Stack direction="row" alignItems="center" gap={1}>
          <SummaryIcon fontSize="small" sx={{ color: selected === SUMMARY ? ACCENT : 'text.secondary' }} />
          <Box>
            <Typography variant="body2" fontWeight={800} sx={{ color: INK }}>Project Summary</Typography>
            <Typography variant="caption" color="text.secondary">Money flow, charts, details, photos</Typography>
          </Box>
        </Stack>
      </Item>
      <Typography variant="overline" sx={{ display: 'block', px: 1.5, pt: 1.5, pb: 0.5, color: 'text.secondary', fontWeight: 800, letterSpacing: 1 }}>
        Sub projects ({subs.length})
      </Typography>
      {!subs.length && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pb: 1.5 }}>No sub projects yet.</Typography>
      )}
      {subs.map((s, i) => {
        const id = String(s._id);
        const money = moneyById.get(id);
        return (
          <Item key={id} id={id} active={selected === id}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
                <Box
                  sx={{
                    width: 22, height: 22, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
                    fontSize: 11, fontWeight: 800,
                    bgcolor: selected === id ? ACCENT : '#e2e8f0', color: selected === id ? '#fff' : INK
                  }}
                >
                  {i + 1}
                </Box>
                <Typography variant="body2" fontWeight={700} noWrap sx={{ color: INK }}>{s.name}</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" gap={0.75} sx={{ flexShrink: 0 }}>
                <Tooltip title={s.status || 'Draft'}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATUS_DOT[s.status] || '#94a3b8' }} />
                </Tooltip>
                <Typography variant="caption" fontWeight={800}>{s.progress}%</Typography>
              </Stack>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, s.progress)}
              color={progressColor(s.progress)}
              sx={{ my: 0.75, ml: 3.75, height: 4, borderRadius: 2, bgcolor: '#e2e8f0' }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 3.75 }}>
              {plural(s.totals.contracts, 'contract')} · Spent {fmt(money?.spent ?? s.totals.billed)}
            </Typography>
          </Item>
        );
      })}
    </Paper>
  );
};

/**
 * Main Project page: header with key numbers and a view switch (Sub Projects / Bill of Quantities / Cost Report).
 * Sub Projects view = sidebar of sub projects + a panel showing the selected one's
 * contracts → check requests → IPCs → payments (or the project summary).
 */
export default function MainProjectPage({ project, view, onViewChange, onBack, onRefresh, onDelete, boqView, costView }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, t] = await Promise.all([getProjectSummary(project._id), getProjectTree(project._id)]);
      setSummary(s.data?.data || null);
      setTree(t.data?.data || null);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load the project');
    } finally {
      setLoading(false);
    }
  }, [project._id]);

  // Re-load when the header refresh reloads the project
  useEffect(() => { load(); }, [load, project.updatedAt]);

  const subs = tree?.subProjects || [];
  const moneyById = new Map((summary?.subProjects || []).map((m) => [String(m._id), m]));
  const requested = searchParams.get('sub');
  const selected = requested === SUMMARY || subs.some((s) => String(s._id) === requested)
    ? requested
    : (subs[0] ? String(subs[0]._id) : SUMMARY);
  const select = (id) => {
    setSearchParams({ tab: 'overview', sub: id }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const selectedSub = subs.find((s) => String(s._id) === selected);

  const totals = summary?.totals;
  const location = [project.society, project.sector].filter(Boolean).join(', ');
  const overBudget = totals && totals.budget > 0 && totals.spent > totals.budget;
  const currentView = view === 'boq' || view === 'cost' ? view : 'overview';

  return (
    <Box>
      {/* Header */}
      <Paper elevation={0} sx={{ mb: 2, p: { xs: 2, sm: 2.5 }, borderRadius: 3, border: `1px solid ${BORDER}`, bgcolor: '#fff' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Button startIcon={<BackIcon />} onClick={onBack} size="small" sx={{ ml: -1, color: 'text.secondary', textTransform: 'none', whiteSpace: 'nowrap' }}>
            All Projects
          </Button>
          <Stack direction="row" gap={1} alignItems="center">
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={onRefresh} sx={{ border: `1px solid ${BORDER}` }}><RefreshIcon fontSize="small" /></IconButton>
            </Tooltip>
            {onDelete && (
              <Tooltip title="Delete permanently (Developer)">
                <Button size="small" variant="outlined" color="error" onClick={onDelete} sx={{ textTransform: 'none', whiteSpace: 'nowrap', minWidth: 0 }}>
                  <DeleteForeverIcon fontSize="small" />
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, ml: 0.5 }}>Delete (Developer)</Box>
                </Button>
              </Tooltip>
            )}
          </Stack>
        </Stack>

        <Stack direction="row" alignItems="center" gap={2} sx={{ minWidth: 0 }}>
          <Box sx={{ width: 48, height: 48, flexShrink: 0, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: 'rgba(15,118,110,0.1)', color: ACCENT }}>
            <TreeIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
              <Typography variant="h5" fontWeight={800} sx={{ color: INK }}>{project.name}</Typography>
              <Chip label="Main Project" size="small" sx={{ bgcolor: 'rgba(15,118,110,0.1)', color: ACCENT, fontWeight: 700 }} />
              <Chip label={project.status || 'Draft'} size="small" color={PROJECT_STATUS_COLOR[project.status] || 'default'} />
            </Stack>
            <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mt: 0.25, color: 'text.secondary' }}>
              <Typography variant="body2" fontWeight={600}>{project.projectNumber}</Typography>
              {location && (
                <Stack direction="row" alignItems="center" gap={0.5}>
                  <PlaceIcon sx={{ fontSize: 16 }} /><Typography variant="body2">{location}</Typography>
                </Stack>
              )}
              <Stack direction="row" alignItems="center" gap={0.5}>
                <DateIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2">{fmtDate(project.startDate)} → {fmtDate(project.expectedEndDate)}</Typography>
              </Stack>
            </Stack>
          </Box>
        </Stack>

        {totals && (
          <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
            <HeaderStat
              label="Budget"
              value={fmt(totals.budget)}
              sub={totals.budget > 0 ? 'Sum of sub project BOQs' : 'No BOQ lines yet'}
            />
            <HeaderStat
              label="Spent"
              value={fmt(totals.spent)}
              valueColor={overBudget ? 'error.main' : undefined}
              sub={totals.budget > 0
                ? `${Math.round((totals.spent / totals.budget) * 100)}% of budget`
                : 'Certified work billed'}
            />
            <HeaderStat label="Progress" value={`${totals.progress}%`} progress={totals.progress} />
            <HeaderStat label="Paid" value={fmt(totals.paid)} sub={`of ${fmt(totals.approved)} CEO approved`} />
          </Box>
        )}

        <ToggleButtonGroup
          exclusive
          size="small"
          value={currentView}
          onChange={(_, v) => v && onViewChange(v)}
          sx={{
            mt: 2, width: { xs: '100%', sm: 'auto' },
            '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: { xs: 1, sm: 2 }, gap: 0.75, flex: { xs: 1, sm: 'none' }, whiteSpace: 'nowrap' },
            '& .MuiSvgIcon-root': { display: { xs: 'none', sm: 'inline-block' } },
            '& .Mui-selected': { bgcolor: 'rgba(15,118,110,0.1) !important', color: `${ACCENT} !important` }
          }}
        >
          <ToggleButton value="overview"><TreeIcon fontSize="small" /> Sub Projects</ToggleButton>
          <ToggleButton value="boq">
            <BoqIcon fontSize="small" />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Bill of Quantities</Box>
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>BOQ</Box>
          </ToggleButton>
          <ToggleButton value="cost"><ChartIcon fontSize="small" /> Cost Report</ToggleButton>
        </ToggleButtonGroup>
      </Paper>

      {/* Body */}
      {currentView === 'boq' && (
        <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2.5 }, borderRadius: 3, border: `1px solid ${BORDER}`, bgcolor: '#fff' }}>{boqView}</Paper>
      )}
      {currentView === 'cost' && (
        <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2.5 }, borderRadius: 3, border: `1px solid ${BORDER}`, bgcolor: '#fff' }}>{costView}</Paper>
      )}
      {currentView === 'overview' && (
        loading && !tree ? (
          <Box display="flex" justifyContent="center" py={6}><CircularProgress size={28} /></Box>
        ) : error ? (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>{error}</Alert>
        ) : (
          <Box sx={{ display: 'grid', gap: 2, alignItems: 'start', gridTemplateColumns: { xs: '1fr', md: '280px minmax(0, 1fr)' } }}>
            <Sidebar subs={subs} moneyById={moneyById} selected={selected} onSelect={select} />
            <Box sx={{ minWidth: 0 }}>
              {selectedSub
                ? (
                  <SubProjectPanel
                    sub={selectedSub}
                    money={moneyById.get(String(selectedSub._id))}
                    index={subs.indexOf(selectedSub)}
                    count={subs.length}
                  />
                )
                : summary && <ProjectSummaryPanel project={project} summary={summary} />}
            </Box>
          </Box>
        )
      )}
    </Box>
  );
}
