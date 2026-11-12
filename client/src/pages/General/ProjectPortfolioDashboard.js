import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, InputAdornment, MenuItem, Skeleton, Stack, TextField, Tooltip, Typography
} from '@mui/material';
import { keyframes } from '@mui/material/styles';
import {
  AccountTree as TreeIcon, ArrowForward as ArrowIcon, Engineering as ContractorIcon, ErrorOutline as AlertIcon,
  HourglassTop as PendingIcon, AccountBalance as BudgetIcon, Handshake as ContractIcon, TrendingUp as SpentIcon, Payments as PaidIcon, Place as PlaceIcon, Refresh as RefreshIcon, Search as SearchIcon, TaskAlt as OkIcon, Download as DownloadIcon
} from '@mui/icons-material';
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis
} from 'recharts';
import dayjs from 'dayjs';
import { getPortfolio } from '../../services/projectManagementService';
import { ContractTypeTag, PASTEL_BG, PASTEL_SHADOW, fmt, fmtShort, plural } from '../../components/ProjectManagement/mainProjectUi';
import { HEALTH_STYLE, PROJECT_COLORS, ProgressRing, useCountUp } from '../../components/ProjectManagement/portfolioUi';
import PortfolioProjectDialog from '../../components/ProjectManagement/PortfolioProjectDialog';
import { getImageUrl } from '../../utils/imageService';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const drift = keyframes`0% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-20px) scale(1.15); } 100% { transform: translate(0,0) scale(1); }`;
const rise = keyframes`from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; }`;
const grow = keyframes`from { transform: scaleX(0); } to { transform: scaleX(1); }`;
const livePulse = keyframes`0% { box-shadow: 0 0 0 0 rgba(45,212,191,0.6); } 70% { box-shadow: 0 0 0 8px rgba(45,212,191,0); } 100% { box-shadow: 0 0 0 0 rgba(45,212,191,0); }`;
const spin = keyframes`to { transform: rotate(360deg); }`;
const pulse = keyframes`0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.45); } 50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }`;

const STATUS_TONE = { Active: '#15803d', Planning: '#0369a1', 'On Hold': '#c2410c', Completed: '#4338ca' };

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Compact money for big headline numbers: Rs 12.4 Cr / 45.2 Lac */
const fmtCompact = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `Rs ${(n / 1e5).toFixed(1)} Lac`;
  return fmt(n);
};

const STATUS_FILTERS = ['All', 'Active', 'Planning', 'On Hold', 'Completed', 'Draft'];
const SORTS = [
  { value: 'budget', label: 'Biggest budget' },
  { value: 'spent', label: 'Most spent' },
  { value: 'progress', label: 'Most complete' },
  { value: 'risk', label: 'Needs attention first' },
  { value: 'name', label: 'Name (A–Z)' }
];
const RISK = { 'Over Budget': 0, 'Behind Schedule': 1, 'Needs Attention': 2, 'On Track': 3 };

// What each money figure means, shown on hover so every number can be explained
const DEFINITIONS = {
  budget: 'Budget of each main project, approved by the COO, AVP Taj and CEO. A project whose budget is not approved yet counts as 0 and cannot make new contracts.',
  distributed: 'Part of the approved budget that has been given to the sub projects. Each sub project can only make contracts up to its share.',
  contracted: 'Value of the sublet contracts signed with contractors.',
  verified: 'Work the contractors claimed on check requests that site inspection confirmed.',
  spent: 'Work certified for payment on IPCs (interim payment certificates), gross before deductions. Advances are not counted.',
  approved: 'IPCs that went through Pre-Audit, Audit Director and CEO and were approved for payment.',
  paid: 'Cash Finance has actually paid to contractors against IPCs (net of retention, advance recovery and tax). Includes advances paid.',
  clientBilled: 'Invoices raised to the client for this work.',
  clientReceived: 'Money the client has paid against those invoices.'
};

const FLOW = [
  { key: 'budget', label: 'Approved budget', color: '#94a3b8' },
  { key: 'distributed', label: 'Distributed to sub projects', color: '#64748b' },
  { key: 'contracted', label: 'Contracted', color: '#6366f1' },
  { key: 'verified', label: 'Verified', color: '#0ea5e9' },
  { key: 'spent', label: 'Certified (Spent)', color: '#f59e0b' },
  { key: 'approved', label: 'CEO Approved', color: '#a855f7' },
  { key: 'paid', label: 'Paid', color: '#22c55e' }
];
const CLIENT_FLOW = [
  { key: 'clientBilled', label: 'Billed to client', color: '#0f766e' },
  { key: 'clientReceived', label: 'Received from client', color: '#14b8a6' }
];

const HEALTH_MEANING = {
  'On Track': 'Within budget and on schedule',
  'Needs Attention': 'Something needs a decision: e.g. work done but not closed, contracts above budget, missing budget or dates',
  'Behind Schedule': 'Past its end date, or progress well behind the time used',
  'Over Budget': 'Certified work is above the BOQ budget'
};

/** White card with a heading */
const Card = ({ title, subtitle, action, children, sx, delay = 0 }) => (
  <Box
    sx={{
      p: { xs: 2, md: 2.5 }, bgcolor: '#fff', borderRadius: 4, border: `1px solid ${LINE}`,
      boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.04)',
      animation: `${rise} .6s ${delay}s both`, minWidth: 0, ...sx
    }}
  >
    {(title || action) && (
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1} sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 800, color: INK, fontSize: 16 }}>{title}</Typography>
          {subtitle && <Typography variant="caption" sx={{ color: MUTED }}>{subtitle}</Typography>}
        </Box>
        {action}
      </Stack>
    )}
    {children}
  </Box>
);

// Frosted white tiles on the pastel header, same look as the project page header
const GLASS = { bgcolor: 'rgba(255,255,255,0.68)', border: '1px solid rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(99,102,241,0.08)' };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Tiny trend line for a hero tile */
const Sparkline = ({ values, color, width = 84, height = 26 }) => {
  if (!values.length || !values.some((v) => v > 0)) return null;
  const max = Math.max(...values) || 1;
  const step = width / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const gid = `spark-${color.replace('#', '')}`;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
    </svg>
  );
};

/** Headline number on the header: icon, counted-up value, share bar and an optional trend */
const HeroKpi = ({ label, value, tone, icon, share, note, trend, delay, hint }) => {
  const n = useCountUp(value);
  return (
    <Box
      sx={{
        ...GLASS, p: 1.5, borderRadius: 3, minWidth: 0,
        animation: `${rise} .6s ${delay}s both`, transition: 'transform .2s, box-shadow .2s',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 8px 20px -8px ${tone}66` }
      }}
    >
      <Stack direction="row" alignItems="center" gap={0.75}>
        <Box sx={{ width: 24, height: 24, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: `${tone}1f`, color: tone, '& svg': { fontSize: 15 } }}>{icon}</Box>
        <Tooltip title={hint || ''} placement="top-start">
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: MUTED, cursor: hint ? 'help' : 'default' }} noWrap>{label}</Typography>
        </Tooltip>
      </Stack>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" gap={1} sx={{ mt: 0.75 }}>
        <Tooltip title={fmt(value)} placement="bottom-start">
          <Typography sx={{ fontSize: { xs: 18, md: 22 }, fontWeight: 900, color: INK, letterSpacing: -0.5, whiteSpace: 'nowrap', lineHeight: 1.15 }}>
            {fmtCompact(n)}
          </Typography>
        </Tooltip>
        {trend && <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{trend}</Box>}
      </Stack>
      {share !== undefined && (
        <Box sx={{ mt: 0.75, height: 4, borderRadius: 2, bgcolor: 'rgba(100,116,139,0.15)', overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${Math.min(100, share)}%`, bgcolor: tone, borderRadius: 2, transformOrigin: 'left', animation: `${grow} 1s ${delay + 0.3}s cubic-bezier(.2,.8,.2,1) both` }} />
        </Box>
      )}
      {note && <Typography sx={{ fontSize: 11.5, color: MUTED, mt: 0.5 }} noWrap title={note}>{note}</Typography>}
    </Box>
  );
};

/** Pastel portfolio header: greeting and counts, then overall progress and the headline money */
const PortfolioHero = ({ totals: t, monthlySpend, projects, loadedAt, loading, onRefresh }) => {
  const trend = monthlySpend.map((m) => m.total);
  const thisMonth = trend[trend.length - 1] || 0;
  const statusCounts = ['Active', 'Planning', 'On Hold', 'Completed']
    .map((st) => ({ st, n: projects.filter((p) => p.status === st).length })).filter((x) => x.n);
  const attention = projects.filter((p) => p.health !== 'On Track').length;
  return (
    <Box
      sx={{
        position: 'relative', overflow: 'hidden', borderRadius: 4, mb: 2.5, px: { xs: 2, md: 3 }, py: { xs: 2, md: 2.5 },
        background: PASTEL_BG, border: '1px solid rgba(255,255,255,0.85)', boxShadow: PASTEL_SHADOW
      }}
    >
      {/* Soft drifting light */}
      {[['#5eead4', '-8%', '-60%', 0], ['#a5b4fc', '60%', '-80%', 5]].map(([c, l, tp, d]) => (
        <Box key={c} sx={{ position: 'absolute', left: l, top: tp, width: 380, height: 380, borderRadius: '50%', background: `radial-gradient(circle, ${c}55 0%, transparent 65%)`, animation: `${drift} 16s ${d}s ease-in-out infinite`, pointerEvents: 'none' }} />
      ))}

      <Box sx={{ position: 'relative' }}>
        {/* Title row */}
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={1.5}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" gap={0.75}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#14b8a6', animation: `${livePulse} 2s infinite` }} />
              <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#0f766e' }}>
                Project Portfolio · {dayjs().format('ddd, DD MMM YYYY')}
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 900, letterSpacing: -0.5, lineHeight: 1.2, mt: 0.5, color: INK }}>
              {greeting()},{' '}
              <Box component="span" sx={{ background: 'linear-gradient(90deg, #0f766e, #4f46e5)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                every project at a glance
              </Box>
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" gap={1} sx={{ flexShrink: 0 }}>
            <Typography sx={{ fontSize: 12, color: MUTED }}>{loadedAt ? `Updated ${dayjs(loadedAt).format('h:mm A')}` : ''}</Typography>
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={onRefresh} disabled={loading} sx={{ ...GLASS, color: INK, '&:hover': { bgcolor: '#fff' } }}>
                <RefreshIcon fontSize="small" sx={{ animation: loading ? `${spin} 1s linear infinite` : 'none' }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 1.25 }}>
          {t ? (
            <>
              {[
                [plural(t.projects, 'main project'), INK],
                [plural(t.subProjects, 'sub project'), INK],
                [plural(t.contractors, 'contractor'), INK],
                ...statusCounts.map(({ st, n }) => [`${n} ${st.toLowerCase()}`, STATUS_TONE[st]])
              ].map(([label, c]) => (
                <Chip key={label} size="small" label={label} sx={{ height: 22, fontSize: 12, fontWeight: 700, color: c, bgcolor: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.95)' }} />
              ))}
              <Chip
                size="small"
                label={attention ? `${attention} need attention` : 'All on track'}
                sx={{ height: 22, fontSize: 12, fontWeight: 800, color: attention ? '#b91c1c' : '#15803d', bgcolor: attention ? '#fee2e2' : '#dcfce7' }}
              />
            </>
          ) : <Skeleton width={320} height={24} />}
        </Stack>

        {/* Progress + money */}
        <Box sx={{ mt: 2, display: 'grid', gap: 1.25, alignItems: 'stretch', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', lg: '190px repeat(4, minmax(0,1fr))' } }}>
          <Box sx={{ ...GLASS, gridColumn: { xs: '1 / -1', lg: 'auto' }, p: 1.5, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 1.5, animation: `${rise} .6s both` }}>
            {t ? <ProgressRing value={t.progress} size={72} stroke={7} color="#0f766e" track="rgba(100,116,139,0.15)" label="done" />
              : <Skeleton variant="circular" width={72} height={72} />}
            <Box>
              <Typography sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: MUTED }}>Overall</Typography>
              <Typography sx={{ fontSize: 13, color: INK, fontWeight: 800 }}>{t ? `${t.active} active` : '–'}</Typography>
              <Typography sx={{ fontSize: 12.5, color: '#15803d', fontWeight: 700 }}>{t ? `${t.completed} completed` : ''}</Typography>
            </Box>
          </Box>
          {t ? (
            <>
              <HeroKpi
                hint={DEFINITIONS.budget} label="Total budget" value={t.budget} tone="#64748b" icon={<BudgetIcon />} delay={0.1}
                note={[
                  t.utilizedBudget > 0 ? `+ ${fmtCompact(t.utilizedBudget)} already utilized before the ERP` : null,
                  t.budgetsPending ? `${plural(t.budgetsPending, 'project')} without an approved budget` : `${fmtCompact(t.distributed)} distributed`
                ].filter(Boolean).join(' · ')}
              />
              <HeroKpi
                hint={DEFINITIONS.contracted} label="Contracted" value={t.contracted} tone="#4f46e5" icon={<ContractIcon />} delay={0.2}
                share={pct(t.contracted, t.budget)} note={t.budget ? `${pct(t.contracted, t.budget)}% of budget` : 'No budget set yet'}
              />
              <HeroKpi
                hint={DEFINITIONS.spent} label="Spent (certified)" value={t.spent} tone="#d97706" icon={<SpentIcon />} delay={0.3}
                share={pct(t.spent, t.contracted || t.budget)}
                note={thisMonth ? `${fmtCompact(thisMonth)} this month` : `${pct(t.spent, t.contracted || t.budget)}% of ${t.contracted ? 'contracted' : 'budget'}`}
                trend={<Sparkline values={trend} color="#d97706" />}
              />
              <HeroKpi
                hint={DEFINITIONS.paid} label="Paid to contractors" value={t.paid} tone="#16a34a" icon={<PaidIcon />} delay={0.4}
                share={pct(t.paid, t.approved || t.spent)}
                note={t.pendingApprovals ? `${plural(t.pendingApprovals, 'IPC')} · ${fmtCompact(t.pendingAmount)} awaiting approval` : 'No IPCs awaiting approval'}
              />
            </>
          ) : [0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: 3 }} />)}
        </Box>
      </Box>
    </Box>
  );
};

/** Budget → … → Paid as horizontal bars, each against the budget */
const MoneyFlow = ({ totals }) => {
  const base = Math.max(totals.budget, ...FLOW.map((f) => totals[f.key] || 0)) || 1;
  const hasClient = totals.clientBilled > 0 || totals.clientReceived > 0;
  const Bar = ({ f, i, of }) => (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Tooltip title={DEFINITIONS[f.key]} placement="top-start">
          <Typography variant="body2" fontWeight={700} sx={{ color: INK, cursor: 'help', borderBottom: `1px dotted ${MUTED}` }}>{f.label}</Typography>
        </Tooltip>
        <Tooltip title={fmt(totals[f.key])}>
          <Typography variant="body2" sx={{ color: MUTED }}>
            <Box component="span" sx={{ fontWeight: 800, color: INK }}>{fmtCompact(totals[f.key])}</Box>
            {of && ` · ${of}`}
          </Typography>
        </Tooltip>
      </Stack>
      <Box sx={{ height: 10, borderRadius: 5, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
        <Box
          sx={{
            height: '100%', width: `${Math.max(1, ((totals[f.key] || 0) / base) * 100)}%`, borderRadius: 5,
            background: `linear-gradient(90deg, ${f.color}aa, ${f.color})`, transformOrigin: 'left',
            animation: `${grow} 1s ${0.2 + i * 0.1}s cubic-bezier(.2,.8,.2,1) both`
          }}
        />
      </Box>
    </Box>
  );
  return (
    <Stack gap={1.5}>
      {FLOW.map((f, i) => (
        <Bar key={f.key} f={f} i={i} of={f.key !== 'budget' && totals.budget > 0 ? `${pct(totals[f.key], totals.budget)}%` : null} />
      ))}
      {totals.utilizedBudget > 0 && (
        <Tooltip title={`${fmt(totals.utilizedBudget)} was spent on ongoing projects before they came into the ERP. It is part of their total budget but not of the bars above, which show the remaining budget and the work done in the ERP.`}>
          <Box sx={{ px: 1.25, py: 0.75, borderRadius: 2, bgcolor: '#f5f3ff', border: '1px solid #ddd6fe', cursor: 'help' }}>
            <Typography variant="body2" sx={{ color: '#5b21b6', fontWeight: 700 }}>
              + {fmtCompact(totals.utilizedBudget)} already utilized before the ERP · total budget {fmtCompact(totals.budget + totals.utilizedBudget)}
            </Typography>
          </Box>
        </Tooltip>
      )}
      {!totals.budget && totals.contracted > 0 && (
        <Typography variant="caption" sx={{ color: '#b45309' }}>No budget approved yet, so bars are compared to the largest figure.</Typography>
      )}
      {hasClient && (
        <>
          <Typography sx={{ mt: 0.5, pt: 1.25, borderTop: `1px dashed ${LINE}`, fontSize: 12, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 }}>Client side</Typography>
          {CLIENT_FLOW.map((f, i) => (
            <Bar key={f.key} f={f} i={FLOW.length + i} of={f.key === 'clientReceived' && totals.clientBilled > 0 ? `${pct(totals.clientReceived, totals.clientBilled)}% of billed` : null} />
          ))}
        </>
      )}
    </Stack>
  );
};

/** Donut of project health */
const HealthDonut = ({ health, total }) => {
  const data = health.filter((h) => h.count > 0);
  return (
    <Stack direction={{ xs: 'column', sm: 'row', md: 'column', lg: 'row' }} alignItems="center" gap={2}>
      <Box sx={{ position: 'relative', width: 170, height: 170, flexShrink: 0 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data.length ? data : [{ health: 'None', count: 1 }]} dataKey="count" nameKey="health" innerRadius={56} outerRadius={80} paddingAngle={data.length > 1 ? 3 : 0} stroke="none">
              {(data.length ? data : [{ health: 'None' }]).map((h) => <Cell key={h.health} fill={HEALTH_STYLE[h.health]?.dot || LINE} />)}
            </Pie>
            {data.length > 0 && <ChartTooltip formatter={(v, n) => [plural(v, 'project'), n]} />}
          </PieChart>
        </ResponsiveContainer>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
          <Box>
            <Typography sx={{ fontSize: 30, fontWeight: 900, color: INK, lineHeight: 1 }}>{total}</Typography>
            <Typography variant="caption" sx={{ color: MUTED, fontWeight: 700 }}>projects</Typography>
          </Box>
        </Box>
      </Box>
      <Stack gap={1} sx={{ width: '100%' }}>
        {health.map((h) => (
          <Tooltip key={h.health} title={HEALTH_MEANING[h.health]} placement="left">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.25, py: 0.75, borderRadius: 2, bgcolor: HEALTH_STYLE[h.health].bg, cursor: 'help' }}>
            <Stack direction="row" alignItems="center" gap={1}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: HEALTH_STYLE[h.health].dot }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: HEALTH_STYLE[h.health].fg }}>{h.health}</Typography>
            </Stack>
            <Typography variant="body2" fontWeight={900} sx={{ color: HEALTH_STYLE[h.health].fg }}>{h.count}</Typography>
          </Stack>
          </Tooltip>
        ))}
      </Stack>
    </Stack>
  );
};

/** IPC approval chain with what is waiting at each stage */
const ApprovalPipeline = ({ stages, notInChain }) => {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <Stack gap={1.25}>
      {stages.map((s, i) => (
        <Stack key={s.stage} direction="row" alignItems="center" gap={1.5}>
          <Box
            sx={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 14,
              bgcolor: s.count ? '#fef3c7' : '#f1f5f9', color: s.count ? '#b45309' : MUTED,
              animation: s.count && i === stages.length - 1 ? `${pulse} 2s infinite` : 'none'
            }}
          >
            {s.count}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" justifyContent="space-between" gap={1}>
              <Typography variant="body2" fontWeight={700} noWrap sx={{ color: INK }}>{s.stage}</Typography>
              <Typography variant="caption" fontWeight={800} sx={{ color: MUTED, whiteSpace: 'nowrap' }}>{s.count ? fmtCompact(s.amount) : '—'}</Typography>
            </Stack>
            {s.count > 0 && s.oldestDays !== null && (
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: s.oldestDays > 7 ? '#dc2626' : MUTED }}>
                Oldest waiting {s.oldestDays === 0 ? 'since today' : `${s.oldestDays} day${s.oldestDays === 1 ? '' : 's'}`}
              </Typography>
            )}
            <Box sx={{ mt: 0.5, height: 5, borderRadius: 3, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${(s.count / max) * 100}%`, bgcolor: '#f59e0b', borderRadius: 3, transformOrigin: 'left', animation: `${grow} .9s ${0.3 + i * 0.1}s both` }} />
            </Box>
          </Box>
        </Stack>
      ))}
      {notInChain && (notInChain.draft.count > 0 || notInChain.rejected.count > 0) && (
        <Box sx={{ mt: 0.5, pt: 1.25, borderTop: `1px dashed ${LINE}` }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.75 }}>Not in the approval chain</Typography>
          {[['Draft, not submitted yet', notInChain.draft, MUTED], ['Rejected, sent back for revision', notInChain.rejected, '#b91c1c']].filter(([, v]) => v.count).map(([label, v, c]) => (
            <Stack key={label} direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
              <Typography variant="body2" sx={{ color: c, fontWeight: 600 }}>{v.count} · {label}</Typography>
              <Typography variant="caption" fontWeight={800} sx={{ color: MUTED }}>{fmtCompact(v.amount)}</Typography>
            </Stack>
          ))}
        </Box>
      )}
    </Stack>
  );
};

/** One Main Project card */
const ProjectCard = ({ p, color, index, onOpen }) => {
  const health = HEALTH_STYLE[p.health] || HEALTH_STYLE['On Track'];
  const isSlab = p.contractBasis === 'Slab';
  // Slab-wise work is measured against the slab contracts; BOQ-wise against the BOQ budget
  const base = isSlab ? p.contracted : p.budget;
  const spentPct = pct(p.spent, base);
  const figures = isSlab
    ? [['Contract value', p.contracted], ['Billed', p.spent], ['Paid', p.paid]]
    // The approved budget stays in force while a revision is prepared or in approval
    : [['Budget', p.budget > 0 ? p.budget + (p.utilizedBudget || 0) : (p.budgetStatus === 'Submitted' ? 'With CEO' : 'Not set')], ['Spent', p.spent], ['Paid', p.paid]];
  const scope = isSlab
    ? (p.slabs?.total ? `${p.slabs.billed} of ${plural(p.slabs.total, 'slab')} billed · ${p.slabs.verified} verified` : 'No slabs contracted yet')
    : p.contractBasis === 'BOQ'
      ? (p.lines?.total ? `${p.lines.contracted} of ${plural(p.lines.total, 'BOQ line')} contracted · ${p.lines.billed} billed` : 'No BOQ lines yet')
      : null;
  const daysLeft = p.expectedEndDate ? dayjs(p.expectedEndDate).diff(dayjs(), 'day') : null;
  return (
    <Box
      onClick={onOpen}
      sx={{
        position: 'relative', cursor: 'pointer', borderRadius: 4, overflow: 'hidden', bgcolor: '#fff', border: `1px solid ${LINE}`,
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)', animation: `${rise} .6s ${0.05 * Math.min(index, 12)}s both`,
        transition: 'transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .25s, border-color .25s',
        '&:hover': { transform: 'translateY(-6px)', boxShadow: `0 20px 40px -12px ${color}55`, borderColor: `${color}88` },
        '&:hover .open-arrow': { transform: 'translateX(4px)', opacity: 1 }
      }}
    >
      {/* Cover */}
      <Box
        sx={{
          position: 'relative', height: 112, px: 2, pt: 1.5, color: '#fff',
          background: `radial-gradient(circle at 90% 0%, ${color} 0%, transparent 60%), linear-gradient(135deg, #0f172a 0%, #1e293b 100%)`
        }}
      >
        {p.cover && (
          <Box sx={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.2), rgba(15,23,42,0.85)), url(${getImageUrl(p.cover)})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        )}
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ position: 'relative' }}>
          <Tooltip
            title={p.healthReasons?.length
              ? <Box component="ul" sx={{ m: 0, pl: 2 }}>{p.healthReasons.map((r) => <li key={r}>{r}</li>)}</Box>
              : HEALTH_MEANING[p.health]}
          >
            <Chip size="small" label={p.health} sx={{ height: 22, bgcolor: health.bg, color: health.fg, fontWeight: 800, fontSize: 11, cursor: 'help' }} />
          </Tooltip>
          {p.pendingApprovals > 0 && (
            <Tooltip title={`${plural(p.pendingApprovals, 'IPC')} waiting for approval · ${fmt(p.pendingAmount)}`}>
              <Chip size="small" icon={<PendingIcon sx={{ fontSize: '14px !important', color: '#fff !important' }} />} label={p.pendingApprovals}
                sx={{ height: 22, bgcolor: 'rgba(239,68,68,0.9)', color: '#fff', fontWeight: 800, animation: `${pulse} 2s infinite` }} />
            </Tooltip>
          )}
        </Stack>
        <Box sx={{ position: 'absolute', left: 16, right: 100, bottom: 12 }}>
          <Typography sx={{ fontWeight: 900, fontSize: 18, lineHeight: 1.2, textShadow: '0 1px 8px rgba(0,0,0,0.4)' }} noWrap>{p.name}</Typography>
          <Typography sx={{ fontSize: 12, opacity: 0.75, fontWeight: 600 }} noWrap>{p.projectNumber}{p.status ? ` · ${p.status}` : ''}</Typography>
        </Box>
        <Box sx={{ position: 'absolute', right: 14, bottom: -34, bgcolor: '#fff', borderRadius: '50%', p: 0.5, boxShadow: '0 6px 16px rgba(15,23,42,0.15)' }}>
          <ProgressRing value={p.progress} size={76} stroke={7} color={color} />
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ p: 2, pt: 1.5 }}>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ color: MUTED, mb: 1.5, pr: 10, minHeight: 20 }}>
          {p.location && <><PlaceIcon sx={{ fontSize: 15 }} /><Typography variant="caption" noWrap>{p.location}</Typography></>}
        </Stack>
        {p.contractBasis && (
          <Stack direction="row" alignItems="center" gap={1} sx={{ mt: -0.75, mb: 1.25, pr: 10, minWidth: 0 }}>
            <ContractTypeTag type={p.contractBasis} />
            {scope && <Typography sx={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }} noWrap>{scope}</Typography>}
          </Stack>
        )}

        <Stack direction="row" justifyContent="space-between" alignItems="baseline">
          <Typography variant="caption" sx={{ color: MUTED, fontWeight: 700 }}>{isSlab ? 'BILLED OF CONTRACT VALUE' : 'SPENT OF BUDGET'}</Typography>
          <Typography variant="caption" sx={{ fontWeight: 900, color: spentPct > 100 ? '#dc2626' : INK }}>{spentPct}%</Typography>
        </Stack>
        <Box sx={{ position: 'relative', mt: 0.5, height: 8, borderRadius: 4, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
          {!isSlab && <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, pct(p.contracted, p.budget))}%`, bgcolor: `${color}33` }} />}
          <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, spentPct)}%`, background: spentPct > 100 ? '#ef4444' : `linear-gradient(90deg, ${color}bb, ${color})`, borderRadius: 4, transformOrigin: 'left', animation: `${grow} 1s .3s both` }} />
        </Box>

        <Box sx={{ mt: 1.75, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 1 }}>
          {figures.map(([label, v]) => (
            <Box key={label} sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</Typography>
              {typeof v === 'string'
                ? <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#b45309', whiteSpace: 'nowrap' }}>{v}</Typography>
                : <Tooltip title={fmt(v)}><Typography sx={{ fontSize: 14, fontWeight: 800, color: INK, whiteSpace: 'nowrap' }}>{fmtCompact(v)}</Typography></Tooltip>}
            </Box>
          ))}
        </Box>
        {p.utilizedBudget > 0 && (
          <Tooltip title={`Total budget ${fmt(p.budget + p.utilizedBudget)} = ${fmt(p.utilizedBudget)} already utilized before the ERP + ${fmt(p.budget)} remaining for contracts`}>
            <Typography sx={{ mt: 0.75, fontSize: 11.5, fontWeight: 700, color: '#6d28d9' }} noWrap>
              {fmtCompact(p.utilizedBudget)} already utilized · {fmtCompact(p.budget)} remaining
            </Typography>
          </Tooltip>
        )}

        {p.plannedProgress !== null && (
          <Box sx={{ mt: 1.75 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography sx={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>Timeline {p.plannedProgress}% gone · work {p.progress}% done</Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: p.overdue ? '#dc2626' : MUTED }}>
                {p.status === 'Completed' ? 'Completed' : daysLeft === null ? '' : daysLeft < 0 ? `${-daysLeft}d overdue` : `${daysLeft}d left`}
              </Typography>
            </Stack>
            <Box sx={{ position: 'relative', mt: 0.5, height: 4, borderRadius: 2, bgcolor: '#f1f5f9' }}>
              <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${p.progress}%`, bgcolor: color, borderRadius: 2 }} />
              <Tooltip title="Where the project should be by today">
                <Box sx={{ position: 'absolute', top: -3, width: 2, height: 10, bgcolor: INK, borderRadius: 1, left: `calc(${p.plannedProgress}% - 1px)` }} />
              </Tooltip>
            </Box>
          </Box>
        )}

        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, pt: 1.5, borderTop: `1px dashed ${LINE}` }}>
          <Stack direction="row" gap={1.5} sx={{ color: MUTED, '& svg': { fontSize: 15 } }}>
            <Tooltip title="Sub projects"><Stack direction="row" gap={0.5} alignItems="center"><TreeIcon /><Typography variant="caption" fontWeight={800}>{p.subProjects}</Typography></Stack></Tooltip>
            <Tooltip title="Contractors"><Stack direction="row" gap={0.5} alignItems="center"><ContractorIcon /><Typography variant="caption" fontWeight={800}>{p.contractors}</Typography></Stack></Tooltip>
            <Typography variant="caption" fontWeight={700}>{plural(p.contracts, 'contract')}</Typography>
          </Stack>
          <Stack direction="row" alignItems="center" gap={0.5} sx={{ color }}>
            <Typography variant="caption" fontWeight={900}>View all</Typography>
            <ArrowIcon className="open-arrow" sx={{ fontSize: 16, opacity: 0.6, transition: 'all .2s' }} />
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
};

/** Things management should look at first */
const Attention = ({ projects, onOpen }) => {
  const items = [];
  [...projects].sort((a, b) => RISK[a.health] - RISK[b.health]).forEach((p) => {
    const tone = HEALTH_STYLE[p.health]?.fg || '#b45309';
    (p.healthReasons || []).forEach((text) => items.push({ p, tone, text }));
    if (p.pendingApprovals > 0) {
      const wait = p.oldestPendingDays ? ` · oldest waiting ${p.oldestPendingDays} day${p.oldestPendingDays === 1 ? '' : 's'}` : '';
      items.push({ p, tone: '#b45309', text: `${plural(p.pendingApprovals, 'IPC')} awaiting approval · ${fmtCompact(p.pendingAmount)}${wait}` });
    }
  });
  if (!items.length) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 4, color: '#16a34a', textAlign: 'center' }} gap={1}>
        <OkIcon sx={{ fontSize: 40 }} />
        <Typography fontWeight={800}>All clear</Typography>
        <Typography variant="body2" sx={{ color: MUTED }}>No project needs attention right now.</Typography>
      </Stack>
    );
  }
  return (
    <Stack gap={1} sx={{ maxHeight: 290, overflowY: 'auto', pr: 0.5 }}>
      {items.slice(0, 20).map(({ p, tone, text }, i) => (
        <Stack
          key={`${p._id}-${i}`} direction="row" gap={1.25} alignItems="flex-start" onClick={() => onOpen(p)}
          sx={{ p: 1.25, borderRadius: 2, cursor: 'pointer', bgcolor: '#f8fafc', borderLeft: `3px solid ${tone}`, transition: 'background .15s', '&:hover': { bgcolor: '#f1f5f9' } }}
        >
          <AlertIcon sx={{ fontSize: 18, color: tone, mt: 0.25 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={800} noWrap sx={{ color: INK }}>{p.name}</Typography>
            <Typography variant="caption" sx={{ color: MUTED }}>{text}</Typography>
          </Box>
        </Stack>
      ))}
    </Stack>
  );
};

/**
 * Portfolio Dashboard: every Main Project at a glance for management and owners.
 * Clicking a project opens a full-screen view with its summary, sub projects and cost report.
 */
export default function ProjectPortfolioDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [basis, setBasis] = useState('All');
  const [sort, setSort] = useState('budget');
  const [openId, setOpenId] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getPortfolio();
      setData(res.data?.data || null);
      setLoadedAt(new Date());
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load the portfolio');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const projects = useMemo(() => data?.projects || [], [data]);
  const colorOf = useMemo(() => {
    const map = new Map(projects.map((p, i) => [String(p._id), PROJECT_COLORS[i % PROJECT_COLORS.length]]));
    return (id) => map.get(String(id)) || PROJECT_COLORS[0];
  }, [projects]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => (status === 'All' || p.status === status)
      && (basis === 'All' || p.contractBasis === basis)
      && (!q || [p.name, p.projectNumber, p.location, p.clientName].some((v) => (v || '').toLowerCase().includes(q))));
    const by = {
      budget: (a, b) => b.budget - a.budget,
      spent: (a, b) => b.spent - a.spent,
      progress: (a, b) => b.progress - a.progress,
      risk: (a, b) => RISK[a.health] - RISK[b.health] || b.pendingApprovals - a.pendingApprovals,
      name: (a, b) => a.name.localeCompare(b.name)
    };
    return [...list].sort(by[sort]);
  }, [projects, search, status, basis, sort]);

  const openIndex = shown.findIndex((p) => String(p._id) === openId);
  const openItem = openIndex >= 0 ? shown[openIndex] : null;
  const prev = openIndex > 0 ? () => setOpenId(String(shown[openIndex - 1]._id)) : null;
  const next = openIndex >= 0 && openIndex < shown.length - 1 ? () => setOpenId(String(shown[openIndex + 1]._id)) : null;

  // Spreadsheet of the projects in view, for handing over after a meeting
  const exportCsv = () => {
    const d = (v) => (v ? dayjs(v).format('DD-MMM-YYYY') : '');
    const headers = ['Project', 'Number', 'Contract Basis', 'Status', 'Health', 'Why', 'Location', 'Manager', 'Start', 'End', 'Progress %', 'Planned %',
      'Sub Projects', 'Contracts', 'Contractors', 'Budget Status', 'Approved Budget (remaining)', 'Already Utilized (before ERP)', 'Total Budget', 'Distributed', 'BOQ Estimate', 'Contracted', 'Verified', 'Certified (Spent)', 'CEO Approved', 'Paid',
      'Retention Held', 'Advance Outstanding', 'IPCs Awaiting Approval', 'Awaiting Amount', 'Oldest Wait (days)', 'Billed to Client', 'Received from Client'];
    const rows = shown.map((p) => [p.name, p.projectNumber, p.contractBasis ? (p.contractBasis === 'Slab' ? 'Slab-wise' : 'BOQ-wise') : 'Not set', p.status, p.health, (p.healthReasons || []).join('; '), p.location, p.projectManager,
      d(p.startDate), d(p.expectedEndDate), p.progress, p.plannedProgress ?? '', p.subProjects, p.contracts, p.contractors,
      p.budgetStatus, p.budget, p.utilizedBudget || 0, (p.budget || 0) + (p.utilizedBudget || 0), p.distributed, p.boqEstimate, p.contracted, p.verified, p.spent, p.approved, p.paid, p.retentionHeld, p.advanceOutstanding,
      p.pendingApprovals, p.pendingAmount, p.oldestPendingDays ?? '', p.clientBilled, p.clientReceived]);
    const cell = (v) => {
      const str = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-portfolio-${dayjs().format('YYYY-MM-DD')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const t = data?.totals;
  const hasSpend = (data?.monthlySpend || []).some((m) => m.total > 0);
  const spendSeries = projects.filter((p) => (data?.monthlySpend || []).some((m) => m[String(p._id)] > 0));

  return (
    <Box sx={{ pb: 4 }}>
      <PortfolioHero totals={t} monthlySpend={data?.monthlySpend || []} projects={projects} loadedAt={loadedAt} loading={loading} onRefresh={load} />

      {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>{error}</Alert>}

      {t && (
        <>
          {/* Insights */}
          <Box sx={{ display: 'grid', gap: 2, mb: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0,1fr))', xl: 'repeat(4, minmax(0,1fr))' } }}>
            <Card title="Money flow" subtitle="From budget to cash paid, all projects" delay={0.1}><MoneyFlow totals={t} /></Card>
            <Card title="Project health" subtitle="Budget and schedule" delay={0.15}><HealthDonut health={t.health} total={t.projects} /></Card>
            <Card title="IPC approvals" subtitle="Waiting at each stage" delay={0.2}><ApprovalPipeline stages={data.approvalStages} notInChain={data.ipcNotInChain} /></Card>
            <Card title="Needs attention" subtitle="Click to open the project" delay={0.25}><Attention projects={projects} onOpen={(p) => setOpenId(String(p._id))} /></Card>
          </Box>

          {/* Monthly spend */}
          <Card title="Certified work per month" subtitle="Work IPCs billed, last 12 months, by project" sx={{ mb: 2.5 }} delay={0.3}>
            {!hasSpend ? (
              <Box sx={{ py: 6, textAlign: 'center', color: MUTED, bgcolor: '#f8fafc', borderRadius: 2 }}>No work billed in the last 12 months.</Box>
            ) : (
              <Box sx={{ height: 280 }}>
                <ResponsiveContainer>
                  <AreaChart data={data.monthlySpend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      {spendSeries.map((p) => (
                        <linearGradient key={p._id} id={`pf-${p._id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={colorOf(p._id)} stopOpacity={0.55} />
                          <stop offset="100%" stopColor={colorOf(p._id)} stopOpacity={0.05} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={LINE} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} width={48} />
                    <ChartTooltip formatter={(v, n) => [fmt(v), projects.find((p) => String(p._id) === n)?.name || n]} contentStyle={{ borderRadius: 12, border: `1px solid ${LINE}` }} />
                    {spendSeries.map((p) => (
                      <Area key={p._id} type="monotone" dataKey={String(p._id)} stackId="1" stroke={colorOf(p._id)} strokeWidth={2} fill={`url(#pf-${p._id})`} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Card>
        </>
      )}

      {/* Projects */}
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={1.5} sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 900, fontSize: 22, color: INK, letterSpacing: -0.3 }}>Main projects</Typography>
          <Typography variant="body2" sx={{ color: MUTED }}>Click a project to see everything about it</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
          <TextField
            size="small" placeholder="Search name, number, location" value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: { sm: 260 }, '& .MuiOutlinedInput-root': { borderRadius: 3, bgcolor: '#fff' } }}
          />
          <TextField select size="small" value={sort} onChange={(e) => setSort(e.target.value)} sx={{ minWidth: 200, '& .MuiOutlinedInput-root': { borderRadius: 3, bgcolor: '#fff' } }}>
            {SORTS.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </TextField>
          <Tooltip title="Download the projects in view as a spreadsheet (CSV)">
            <span>
              <Button
                variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={!shown.length}
                sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700, bgcolor: '#fff', color: INK, borderColor: LINE, height: 40, whiteSpace: 'nowrap', '&:hover': { borderColor: INK, bgcolor: '#fff' } }}
              >
                Export
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
        {STATUS_FILTERS.map((s) => {
          const count = s === 'All' ? projects.length : projects.filter((p) => p.status === s).length;
          if (s !== 'All' && !count) return null;
          const on = status === s;
          return (
            <Chip
              key={s} label={`${s} · ${count}`} onClick={() => setStatus(s)}
              sx={{ fontWeight: 800, bgcolor: on ? INK : '#fff', color: on ? '#fff' : INK, border: `1px solid ${on ? INK : LINE}`, '&:hover': { bgcolor: on ? INK : '#f1f5f9' } }}
            />
          );
        })}
        {projects.some((p) => p.contractBasis) && (
          <>
            <Box sx={{ width: '1px', bgcolor: LINE, mx: 0.5 }} />
            {[['All', 'All bases'], ['BOQ', 'BOQ-wise'], ['Slab', 'Slab-wise']].map(([value, label]) => {
              const count = value === 'All' ? projects.length : projects.filter((p) => p.contractBasis === value).length;
              if (value !== 'All' && !count) return null;
              const on = basis === value;
              const tone = value === 'Slab' ? '#6d28d9' : value === 'BOQ' ? '#0369a1' : INK;
              return (
                <Chip
                  key={value} label={`${label} · ${count}`} onClick={() => setBasis(value)}
                  sx={{ fontWeight: 800, bgcolor: on ? tone : '#fff', color: on ? '#fff' : tone, border: `1px solid ${on ? tone : LINE}`, '&:hover': { bgcolor: on ? tone : '#f1f5f9' } }}
                />
              );
            })}
          </>
        )}
      </Stack>

      {loading && !data ? (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} variant="rounded" height={330} sx={{ borderRadius: 4 }} />)}
        </Box>
      ) : !shown.length ? (
        <Box sx={{ py: 8, textAlign: 'center', color: MUTED, bgcolor: '#fff', borderRadius: 4, border: `1px dashed ${LINE}` }}>
          {projects.length ? 'No project matches these filters.' : 'No main projects yet.'}
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {shown.map((p, i) => (
            <ProjectCard key={p._id} p={p} index={i} color={colorOf(p._id)} onOpen={() => setOpenId(String(p._id))} />
          ))}
        </Box>
      )}

      <PortfolioProjectDialog
        item={openItem}
        color={openItem ? colorOf(openItem._id) : PROJECT_COLORS[0]}
        position={openItem ? `${openIndex + 1} / ${shown.length}` : ''}
        onClose={() => setOpenId(null)}
        onPrev={prev}
        onNext={next}
      />
    </Box>
  );
}
