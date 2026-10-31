import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, InputAdornment, MenuItem, Skeleton, Stack, TextField, Tooltip, Typography
} from '@mui/material';
import { keyframes } from '@mui/material/styles';
import {
  AccountTree as TreeIcon, ArrowForward as ArrowIcon, Engineering as ContractorIcon, ErrorOutline as AlertIcon,
  HourglassTop as PendingIcon, Place as PlaceIcon, Refresh as RefreshIcon, Search as SearchIcon, TaskAlt as OkIcon
} from '@mui/icons-material';
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis
} from 'recharts';
import dayjs from 'dayjs';
import { getPortfolio } from '../../services/projectManagementService';
import { fmt, fmtShort, plural } from '../../components/ProjectManagement/mainProjectUi';
import { HEALTH_STYLE, PROJECT_COLORS, ProgressRing, useCountUp } from '../../components/ProjectManagement/portfolioUi';
import PortfolioProjectDialog from '../../components/ProjectManagement/PortfolioProjectDialog';
import { getImageUrl } from '../../utils/imageService';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const drift = keyframes`0% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-20px) scale(1.15); } 100% { transform: translate(0,0) scale(1); }`;
const rise = keyframes`from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; }`;
const grow = keyframes`from { transform: scaleX(0); } to { transform: scaleX(1); }`;
const pulse = keyframes`0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.45); } 50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }`;

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

const FLOW = [
  { key: 'budget', label: 'Budget', color: '#94a3b8' },
  { key: 'contracted', label: 'Contracted', color: '#6366f1' },
  { key: 'verified', label: 'Verified', color: '#0ea5e9' },
  { key: 'spent', label: 'Certified (Spent)', color: '#f59e0b' },
  { key: 'approved', label: 'CEO Approved', color: '#a855f7' },
  { key: 'paid', label: 'Paid', color: '#22c55e' }
];

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

/** Headline number on the hero, counts up */
const HeroKpi = ({ label, value, note, tone, delay }) => {
  const n = useCountUp(value);
  return (
    <Box
      sx={{
        p: 2, borderRadius: 3, minWidth: 0,
        bgcolor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)',
        animation: `${rise} .7s ${delay}s both`
      }}
    >
      <Stack direction="row" alignItems="center" gap={0.75}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tone, boxShadow: `0 0 10px ${tone}` }} />
        <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>{label}</Typography>
      </Stack>
      <Tooltip title={fmt(value)} placement="bottom-start">
        <Typography sx={{ mt: 0.75, fontSize: { xs: 20, md: 26 }, fontWeight: 900, color: '#fff', letterSpacing: -0.5, whiteSpace: 'nowrap' }}>
          {fmtCompact(n)}
        </Typography>
      </Tooltip>
      {note && <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', mt: 0.25 }}>{note}</Typography>}
    </Box>
  );
};

/** Budget → … → Paid as horizontal bars, each against the budget */
const MoneyFlow = ({ totals }) => {
  const base = Math.max(totals.budget, ...FLOW.map((f) => totals[f.key] || 0)) || 1;
  return (
    <Stack gap={1.5}>
      {FLOW.map((f, i) => (
        <Box key={f.key}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2" fontWeight={700} sx={{ color: INK }}>{f.label}</Typography>
            <Typography variant="body2" sx={{ color: MUTED }}>
              <Box component="span" sx={{ fontWeight: 800, color: INK }}>{fmtCompact(totals[f.key])}</Box>
              {f.key !== 'budget' && totals.budget > 0 && ` · ${pct(totals[f.key], totals.budget)}%`}
            </Typography>
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
      ))}
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
          <Stack key={h.health} direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.25, py: 0.75, borderRadius: 2, bgcolor: HEALTH_STYLE[h.health].bg }}>
            <Stack direction="row" alignItems="center" gap={1}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: HEALTH_STYLE[h.health].dot }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: HEALTH_STYLE[h.health].fg }}>{h.health}</Typography>
            </Stack>
            <Typography variant="body2" fontWeight={900} sx={{ color: HEALTH_STYLE[h.health].fg }}>{h.count}</Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
};

/** IPC approval chain with what is waiting at each stage */
const ApprovalPipeline = ({ stages }) => {
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
            <Box sx={{ mt: 0.5, height: 5, borderRadius: 3, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${(s.count / max) * 100}%`, bgcolor: '#f59e0b', borderRadius: 3, transformOrigin: 'left', animation: `${grow} .9s ${0.3 + i * 0.1}s both` }} />
            </Box>
          </Box>
        </Stack>
      ))}
    </Stack>
  );
};

/** One Main Project card */
const ProjectCard = ({ p, color, index, onOpen }) => {
  const health = HEALTH_STYLE[p.health] || HEALTH_STYLE['On Track'];
  const spentPct = pct(p.spent, p.budget);
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
          <Chip size="small" label={p.health} sx={{ height: 22, bgcolor: health.bg, color: health.fg, fontWeight: 800, fontSize: 11 }} />
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

        <Stack direction="row" justifyContent="space-between" alignItems="baseline">
          <Typography variant="caption" sx={{ color: MUTED, fontWeight: 700 }}>SPENT OF BUDGET</Typography>
          <Typography variant="caption" sx={{ fontWeight: 900, color: spentPct > 100 ? '#dc2626' : INK }}>{spentPct}%</Typography>
        </Stack>
        <Box sx={{ position: 'relative', mt: 0.5, height: 8, borderRadius: 4, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
          <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, pct(p.contracted, p.budget))}%`, bgcolor: `${color}33` }} />
          <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, spentPct)}%`, background: spentPct > 100 ? '#ef4444' : `linear-gradient(90deg, ${color}bb, ${color})`, borderRadius: 4, transformOrigin: 'left', animation: `${grow} 1s .3s both` }} />
        </Box>

        <Box sx={{ mt: 1.75, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 1 }}>
          {[['Budget', p.budget], ['Spent', p.spent], ['Paid', p.paid]].map(([label, v]) => (
            <Box key={label} sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</Typography>
              <Tooltip title={fmt(v)}><Typography sx={{ fontSize: 14, fontWeight: 800, color: INK, whiteSpace: 'nowrap' }}>{fmtCompact(v)}</Typography></Tooltip>
            </Box>
          ))}
        </Box>

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
  projects.forEach((p) => {
    if (p.health === 'Over Budget') items.push({ p, tone: '#dc2626', text: `Over budget by ${fmtCompact(p.spent - p.budget)}` });
    if (p.overdue && p.status !== 'Completed') items.push({ p, tone: '#ea580c', text: `Past its end date (${dayjs(p.expectedEndDate).format('DD MMM YYYY')})` });
    else if (p.health === 'Behind Schedule') items.push({ p, tone: '#ea580c', text: `${p.progress}% done but ${p.plannedProgress}% of the time is gone` });
    if (p.linesOverBudget > 0) items.push({ p, tone: '#ca8a04', text: `${plural(p.linesOverBudget, 'BOQ line')} over budget or over quantity` });
    if (p.pendingApprovals > 0) items.push({ p, tone: '#b45309', text: `${plural(p.pendingApprovals, 'IPC')} awaiting approval · ${fmtCompact(p.pendingAmount)}` });
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
  const [sort, setSort] = useState('budget');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getPortfolio();
      setData(res.data?.data || null);
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
      && (!q || [p.name, p.projectNumber, p.location, p.clientName].some((v) => (v || '').toLowerCase().includes(q))));
    const by = {
      budget: (a, b) => b.budget - a.budget,
      spent: (a, b) => b.spent - a.spent,
      progress: (a, b) => b.progress - a.progress,
      risk: (a, b) => RISK[a.health] - RISK[b.health] || b.pendingApprovals - a.pendingApprovals,
      name: (a, b) => a.name.localeCompare(b.name)
    };
    return [...list].sort(by[sort]);
  }, [projects, search, status, sort]);

  const openIndex = shown.findIndex((p) => String(p._id) === openId);
  const openItem = openIndex >= 0 ? shown[openIndex] : null;
  const prev = openIndex > 0 ? () => setOpenId(String(shown[openIndex - 1]._id)) : null;
  const next = openIndex >= 0 && openIndex < shown.length - 1 ? () => setOpenId(String(shown[openIndex + 1]._id)) : null;

  const t = data?.totals;
  const hasSpend = (data?.monthlySpend || []).some((m) => m.total > 0);
  const spendSeries = projects.filter((p) => (data?.monthlySpend || []).some((m) => m[String(p._id)] > 0));

  return (
    <Box sx={{ pb: 4 }}>
      {/* Hero */}
      <Box
        sx={{
          position: 'relative', overflow: 'hidden', borderRadius: 5, mb: 2.5, px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 }, color: '#fff',
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 45%, #111827 100%)'
        }}
      >
        {/* Drifting light */}
        {[['#14b8a6', '-10%', '-40%', 0], ['#6366f1', '55%', '-60%', 4], ['#f59e0b', '80%', '40%', 8]].map(([c, l, tp, d]) => (
          <Box key={c} sx={{ position: 'absolute', left: l, top: tp, width: 420, height: 420, borderRadius: '50%', background: `radial-gradient(circle, ${c}55 0%, transparent 65%)`, filter: 'blur(10px)', animation: `${drift} 14s ${d}s ease-in-out infinite`, pointerEvents: 'none' }} />
        ))}
        <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '22px 22px', pointerEvents: 'none' }} />

        <Box sx={{ position: 'relative' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: '#5eead4' }}>Project Portfolio</Typography>
              <Typography sx={{ fontSize: { xs: 26, md: 36 }, fontWeight: 900, letterSpacing: -1, lineHeight: 1.1, mt: 0.5 }}>
                Every project, one view
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', mt: 0.75, fontSize: 14 }}>
                {t ? `${plural(t.projects, 'main project')} · ${plural(t.subProjects, 'sub project')} · ${plural(t.contractors, 'contractor')}` : 'Loading…'}
                {' · '}as of {dayjs().format('DD MMM YYYY')}
              </Typography>
            </Box>
            <Tooltip title="Refresh">
              <IconButton onClick={load} sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,0.08)', '&:hover': { bgcolor: 'rgba(255,255,255,0.16)' } }}><RefreshIcon /></IconButton>
            </Tooltip>
          </Stack>

          <Box sx={{ mt: 3, display: 'grid', gap: 1.5, alignItems: 'stretch', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', md: 'auto repeat(4, minmax(0,1fr))' } }}>
            <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, display: 'flex', alignItems: 'center', gap: 2, pr: { md: 2 } }}>
              {t ? <ProgressRing value={t.progress} size={110} stroke={10} color="#2dd4bf" track="rgba(255,255,255,0.1)" textColor="#fff" label="overall" />
                : <Skeleton variant="circular" width={110} height={110} sx={{ bgcolor: 'rgba(255,255,255,0.1)' }} />}
              <Box>
                <Typography sx={{ fontSize: 28, fontWeight: 900 }}>{t?.active ?? '–'}</Typography>
                <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>active now</Typography>
                <Typography sx={{ fontSize: 13, color: '#86efac', fontWeight: 800, mt: 0.5 }}>{t ? `${t.completed} completed` : ''}</Typography>
              </Box>
            </Box>
            {t ? (
              <>
                <HeroKpi label="Total budget" value={t.budget} note={t.lumpSumBudget ? `Lump sum ${fmtCompact(t.lumpSumBudget)}` : 'Sum of all BOQs'} tone="#94a3b8" delay={0.1} />
                <HeroKpi label="Contracted" value={t.contracted} note={`${pct(t.contracted, t.budget)}% of budget`} tone="#818cf8" delay={0.2} />
                <HeroKpi label="Spent (certified)" value={t.spent} note={`${pct(t.spent, t.budget)}% of budget`} tone="#fbbf24" delay={0.3} />
                <HeroKpi label="Paid to contractors" value={t.paid} note={t.pendingApprovals ? `${t.pendingApprovals} IPCs · ${fmtCompact(t.pendingAmount)} awaiting approval` : 'No IPCs waiting'} tone="#4ade80" delay={0.4} />
              </>
            ) : [0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={100} sx={{ bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 3 }} />)}
          </Box>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>{error}</Alert>}

      {t && (
        <>
          {/* Insights */}
          <Box sx={{ display: 'grid', gap: 2, mb: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0,1fr))', xl: 'repeat(4, minmax(0,1fr))' } }}>
            <Card title="Money flow" subtitle="From budget to cash paid, all projects" delay={0.1}><MoneyFlow totals={t} /></Card>
            <Card title="Project health" subtitle="Budget and schedule" delay={0.15}><HealthDonut health={t.health} total={t.projects} /></Card>
            <Card title="IPC approvals" subtitle="Waiting at each stage" delay={0.2}><ApprovalPipeline stages={data.approvalStages} /></Card>
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
