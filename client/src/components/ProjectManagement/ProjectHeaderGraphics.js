import React from 'react';
import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { TEAL_BORDER, TEAL_SURFACE, TEAL_TEXT, fmt, plural } from './mainProjectUi';

// Each money step in its own clean, distinct colour
const BARS = [
  { key: 'budget', label: 'Budget', from: '#64748b', to: '#94a3b8', note: 'Sum of sub project BOQs' },
  { key: 'contracted', label: 'Contracted', from: '#4f46e5', to: '#818cf8', note: 'Sublet contracts signed' },
  { key: 'verified', label: 'Verified', from: '#0284c7', to: '#38bdf8', note: 'Work verified on check requests' },
  { key: 'spent', label: 'Spent', from: '#d97706', to: '#fbbf24', note: 'Certified work billed (IPCs)' },
  { key: 'approved', label: 'CEO Approved', from: '#7c3aed', to: '#a78bfa', note: 'IPCs cleared for payment' },
  { key: 'paid', label: 'Paid', from: '#059669', to: '#34d399', note: 'Paid to contractors by Finance' }
];
// Same soft teal surface as the sub project sidebar, a touch richer at the top; white tracks so the bars stand out
const THEME = {
  card: `linear-gradient(180deg, #d7ece7 0%, ${TEAL_SURFACE} 55%, ${TEAL_SURFACE} 100%)`,
  border: TEAL_BORDER,
  shadow: '0 6px 20px rgba(15,118,110,0.10)',
  glow: 'rgba(255,255,255,0.55)',
  track: '#ffffff',
  dashed: '#9cc9bf',
  text: '#0f172a',
  muted: TEAL_TEXT,
  pill: '#ffffff',
  pillBorder: TEAL_BORDER,
  progress: 'linear-gradient(90deg, #0f766e, #2dd4bf)'
};

// Bars grow from the left one after another; amounts fade in once their bar lands
const grow = keyframes`from { transform: scaleX(0); } to { transform: scaleX(1); }`;
const fadeIn = keyframes`from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; }`;
const STAGGER = 0.12;

const share = (value, base) => (base > 0 ? Math.round((value / base) * 100) : 0);

/** One bar: label | track with gradient fill | amount. On phones the label and amount sit above the bar. */
const BarRow = ({ row, width, index }) => {
  const delay = `${index * STAGGER}s`;
  const amount = (
    <Typography
      component="span"
      sx={{ fontWeight: 800, fontSize: 14, color: THEME.text, whiteSpace: 'nowrap', opacity: 0, animation: `${fadeIn} .5s ease-out forwards`, animationDelay: `calc(${delay} + .6s)` }}
    >
      {row.missing ? 'Not set' : fmt(row.value)}
      {!row.missing && (
        <Box component="span" sx={{ ml: 0.75, fontSize: 11, fontWeight: 800, color: row.key === 'budget' ? THEME.muted : row.from }}>{row.pct}%</Box>
      )}
    </Typography>
  );
  return (
    <Tooltip title={row.note} placement="top-start">
      <Box
        sx={{
          display: 'grid', alignItems: 'center', columnGap: 1.5, rowGap: 0.5,
          gridTemplateColumns: { xs: '1fr auto', sm: '120px minmax(0, 1fr) 150px' },
          gridTemplateAreas: { xs: '"label amount" "bar bar"', sm: '"label bar amount"' }
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent={{ sm: 'flex-end' }} gap={1} sx={{ gridArea: 'label' }}>
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${row.from}, ${row.to})` }} />
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: THEME.text }}>{row.label}</Typography>
        </Stack>
        <Box sx={{ gridArea: 'bar', height: 22, borderRadius: 2, bgcolor: THEME.track, overflow: 'hidden', border: row.missing ? `1px dashed ${THEME.dashed}` : '1px solid rgba(15,118,110,0.08)' }}>
          <Box
            sx={{
              height: '100%', width: `${width}%`, borderRadius: 2,
              background: row.danger ? 'linear-gradient(90deg, #dc2626, #f87171)' : `linear-gradient(90deg, ${row.from}, ${row.to})`,
              boxShadow: width > 0 ? `0 2px 8px ${row.from}40, inset 0 1px 0 rgba(255,255,255,0.35)` : 'none',
              transformOrigin: 'left', transform: 'scaleX(0)',
              animation: `${grow} .9s cubic-bezier(.22,1,.36,1) forwards`, animationDelay: delay
            }}
          />
        </Box>
        <Box sx={{ gridArea: 'amount', textAlign: { xs: 'right', sm: 'left' } }}>{amount}</Box>
      </Box>
    </Tooltip>
  );
};

/**
 * Header chart: one horizontal bar per money step (budget → paid) that grows in on load, plus a progress pill.
 * Bars are sized against the largest amount; the % is against the budget, or the contract value while no budget is set.
 */
export default function ProjectHeaderGraphics({ totals }) {
  const hasBudget = totals.budget > 0;
  const base = Math.max(hasBudget ? totals.budget : 0, totals.contracted, totals.verified || 0, totals.spent, totals.approved, totals.paid);
  const pctBase = hasBudget ? totals.budget : totals.contracted;
  const rows = BARS.map((b) => {
    const value = Number(totals[b.key]) || 0;
    return {
      ...b, value, pct: share(value, pctBase),
      missing: b.key === 'budget' && !hasBudget,
      danger: b.key === 'spent' && hasBudget && totals.spent > totals.budget
    };
  });
  const progress = Math.min(100, Math.max(0, Number(totals.progress) || 0));

  return (
    <Box
      sx={{
        mt: 2, p: { xs: 2, md: 3 }, borderRadius: 3, color: THEME.text, position: 'relative', overflow: 'hidden',
        background: THEME.card, border: `1px solid ${THEME.border}`,
        boxShadow: THEME.shadow
      }}
    >
      {/* soft glow */}
      <Box sx={{ position: 'absolute', right: -80, top: -80, width: 260, height: 260, borderRadius: '50%', background: `radial-gradient(circle, ${THEME.glow}, transparent 70%)`, pointerEvents: 'none' }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={1.5} sx={{ mb: 2.5, position: 'relative' }}>
        <Box>
          <Typography variant="overline" sx={{ color: THEME.muted, fontWeight: 800, letterSpacing: 1.2, lineHeight: 1.4 }}>
            Project at a glance
          </Typography>
          <Typography variant="body2" sx={{ color: THEME.muted }}>
            {hasBudget
              ? `% shown against budget ${fmt(totals.budget)}`
              : pctBase > 0 ? `No budget yet · % shown against contract value ${fmt(pctBase)}` : 'Nothing contracted yet'}
          </Typography>
        </Box>
        <Box sx={{ px: 2, py: 1.25, borderRadius: 2.5, bgcolor: THEME.pill, border: `1px solid ${THEME.pillBorder}`, boxShadow: '0 1px 3px rgba(15,23,42,0.06)', minWidth: { sm: 240 } }}>
          <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={2}>
            <Typography variant="caption" sx={{ color: THEME.muted, fontWeight: 800 }}>PROGRESS</Typography>
            <Typography variant="h5" fontWeight={900} sx={{ lineHeight: 1 }}>{progress}%</Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              mt: 1, height: 8, borderRadius: 4, bgcolor: TEAL_SURFACE,
              '& .MuiLinearProgress-bar': { borderRadius: 4, background: THEME.progress }
            }}
          />
          <Typography variant="caption" sx={{ color: THEME.muted, display: 'block', mt: 0.5 }}>
            {plural(totals.subProjects, 'sub project')} · {totals.activeSubProjects} active
          </Typography>
        </Box>
      </Stack>

      <Stack gap={{ xs: 1.5, sm: 1.25 }} sx={{ position: 'relative' }}>
        {rows.map((row, i) => (
          <BarRow key={row.key} row={row} index={i} width={base > 0 ? Math.min(100, (row.value / base) * 100) : 0} />
        ))}
      </Stack>
    </Box>
  );
}
