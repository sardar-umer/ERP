import React from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import {
  AccountBalanceWallet as WalletIcon, Payments as PaidIcon, Verified as BadgeIcon
} from '@mui/icons-material';
import { GLASS, GLASS_EDGE, INK, MUTED, PASTEL_BG, PASTEL_SHADOW, fmt, plural } from './mainProjectUi';

// Frosted-glass card on a pastel blue → lavender → peach wash; each money step is a glossy pill bar
const BARS = [
  { key: 'budget', label: 'Budget', from: '#94a3b8', to: '#cbd5e1', glow: '#94a3b8', tone: '#64748b', Icon: BadgeIcon, note: 'Sum of sub project BOQs' },
  { key: 'contracted', label: 'Contracted', from: '#60a5fa', to: '#4f46e5', glow: '#6366f1', tone: '#4f46e5', Icon: BadgeIcon, note: 'Sublet contracts signed' },
  { key: 'verified', label: 'Verified', from: '#3b82f6', to: '#5eead4', glow: '#38bdf8', tone: '#0ea5e9', Icon: BadgeIcon, note: 'Work verified on check requests' },
  { key: 'spent', label: 'Spent', from: '#f59e0b', to: '#fcd34d', glow: '#f59e0b', tone: '#d97706', Icon: WalletIcon, note: 'Certified work billed (IPCs)' },
  { key: 'approved', label: 'CEO Approved', from: '#4c1d95', to: '#c026d3', glow: '#9333ea', tone: '#9333ea', Icon: BadgeIcon, note: 'IPCs cleared for payment' },
  { key: 'paid', label: 'Paid', from: '#16a34a', to: '#86efac', glow: '#22c55e', tone: '#16a34a', Icon: PaidIcon, note: 'Paid to contractors by Finance' }
];

// Bars grow from the left one after another; amounts fade in once their bar lands
const grow = keyframes`from { transform: scaleX(0); } to { transform: scaleX(1); }`;
const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const STAGGER = 0.12;

const share = (value, base) => (base > 0 ? Math.round((value / base) * 100) : 0);

/** Label with icon | glass pill track holding the bar and, at its right end, the amount + %. */
const BarRow = ({ row, width, index }) => {
  const delay = `${index * STAGGER}s`;
  const { Icon } = row;
  return (
    <Tooltip title={row.note} placement="top-start">
      <Box
        sx={{
          display: 'grid', alignItems: 'center', columnGap: 2, rowGap: 0.75,
          gridTemplateColumns: { xs: '1fr', sm: '150px minmax(0, 1fr)' }
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent={{ sm: 'flex-end' }} gap={1}>
          <Icon sx={{ fontSize: 20, color: row.tone }} />
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: INK }}>{row.label}</Typography>
        </Stack>
        <Box
          sx={{
            height: 40, borderRadius: 999, display: 'flex', alignItems: 'center', overflow: 'hidden',
            bgcolor: GLASS, backdropFilter: 'blur(6px)',
            border: row.missing ? '1.5px dashed rgba(100,116,139,0.45)' : `1px solid ${GLASS_EDGE}`,
            boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.06), 0 1px 2px rgba(255,255,255,0.8)'
          }}
        >
          {/* bar area */}
          <Box sx={{ flex: 1, height: '100%', position: 'relative' }}>
            {!row.missing && width > 0 && (
              <Box
                sx={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: `${width}%`, borderRadius: 999,
                  background: row.danger ? 'linear-gradient(90deg, #dc2626, #f87171)' : `linear-gradient(90deg, ${row.from}, ${row.to})`,
                  boxShadow: `0 4px 14px ${row.glow}55, inset 0 2px 0 rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.08)`,
                  transformOrigin: 'left', transform: 'scaleX(0)',
                  animation: `${grow} .9s cubic-bezier(.22,1,.36,1) forwards`, animationDelay: delay
                }}
              />
            )}
          </Box>
          {/* amount at the right end of the track */}
          <Box
            sx={{
              px: { xs: 1.25, sm: 2 }, whiteSpace: 'nowrap', display: 'flex', alignItems: 'baseline', gap: { xs: 0.5, sm: 1 },
              opacity: 0, animation: `${fadeIn} .5s ease-out forwards`, animationDelay: `calc(${delay} + .5s)`
            }}
          >
            {row.missing ? (
              <Typography sx={{ fontSize: { xs: 13, sm: 15 }, fontStyle: 'italic', color: INK }}>Not set</Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: { xs: 13, sm: 15 }, fontWeight: 700, color: INK }}>{fmt(row.value)}</Typography>
                <Typography sx={{ fontSize: { xs: 12, sm: 15 }, fontWeight: 700, color: row.tone }}>{row.pct}%</Typography>
              </>
            )}
          </Box>
        </Box>
      </Box>
    </Tooltip>
  );
};

/**
 * Header chart: one glossy pill bar per money step (budget → paid) that grows in on load, plus a progress pill.
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
        mt: 2, p: { xs: 2, md: 3.5 }, borderRadius: 4, position: 'relative', overflow: 'hidden',
        background: PASTEL_BG,
        border: `1px solid ${GLASS_EDGE}`,
        boxShadow: PASTEL_SHADOW
      }}
    >
      {/* soft light blooms */}
      <Box sx={{ position: 'absolute', left: -120, bottom: -140, width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.7), transparent 70%)', pointerEvents: 'none' }} />
      <Box sx={{ position: 'absolute', right: -100, top: -120, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(196,181,253,0.45), transparent 70%)', pointerEvents: 'none' }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'flex-start' }} gap={2} sx={{ mb: 3, position: 'relative' }}>
        <Box>
          <Stack direction="row" alignItems="center" gap={1.25}>
            <Typography sx={{ fontSize: { xs: 20, md: 26 }, fontWeight: 900, color: INK, letterSpacing: 0.3, lineHeight: 1.15 }}>
              PROJECT AT A GLANCE
            </Typography>
            <Box sx={{ width: 30, height: 22, borderRadius: 1.5, flexShrink: 0, background: 'linear-gradient(135deg, #60a5fa, #a78bfa 50%, #f472b6)', boxShadow: '0 2px 6px rgba(167,139,250,0.5)' }} />
          </Stack>
          <Typography sx={{ mt: 0.75, fontSize: 15, color: MUTED }}>
            {hasBudget
              ? `% shown against budget ${fmt(totals.budget)}`
              : pctBase > 0 ? `No budget yet · % shown against contract value ${fmt(pctBase)}` : 'Nothing contracted yet'}
          </Typography>
        </Box>
        <Box
          sx={{
            px: 2.5, py: 1.75, borderRadius: 3, minWidth: { sm: 230 },
            bgcolor: GLASS, backdropFilter: 'blur(8px)', border: `1px solid ${GLASS_EDGE}`,
            boxShadow: '0 6px 18px rgba(15,23,42,0.08)'
          }}
        >
          <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={2}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: MUTED, letterSpacing: 0.4 }}>PROGRESS</Typography>
            <Typography sx={{ fontSize: 24, fontWeight: 800, color: '#0d9488', lineHeight: 1 }}>{progress}%</Typography>
          </Stack>
          <Box sx={{ mt: 1.25, height: 8, borderRadius: 999, bgcolor: 'rgba(13,148,136,0.15)', overflow: 'hidden' }}>
            <Box
              sx={{
                height: '100%', width: `${progress}%`, borderRadius: 999,
                background: 'linear-gradient(90deg, #0d9488, #5eead4)',
                transformOrigin: 'left', transform: 'scaleX(0)', animation: `${grow} 1s cubic-bezier(.22,1,.36,1) forwards`
              }}
            />
          </Box>
          <Typography sx={{ mt: 1, fontSize: 13, color: MUTED }}>
            {plural(totals.subProjects, 'sub project')} · {totals.activeSubProjects} active
          </Typography>
        </Box>
      </Stack>

      <Stack gap={1.75} sx={{ position: 'relative' }}>
        {rows.map((row, i) => (
          <BarRow key={row.key} row={row} index={i} width={base > 0 ? Math.min(100, (row.value / base) * 100) : 0} />
        ))}
      </Stack>
    </Box>
  );
}
