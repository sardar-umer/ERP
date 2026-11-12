import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Skeleton, Stack, TextField, Tooltip, Typography
} from '@mui/material';
import { keyframes } from '@mui/material/styles';
import {
  AccountBalance as CashIcon, ArrowForward as ArrowIcon, CallMade as UpIcon, CallReceived as DownIcon, Event as EventIcon,
  Gavel as DecisionIcon, Groups as PeopleIcon, Groups2 as MeetingIcon, HomeWork as TajIcon, Engineering as ProjectIcon,
  Payments as PayIcon, Receipt as ReceivableIcon, Refresh as RefreshIcon, RequestQuote as PayableIcon, TaskAlt as OkIcon,
  TrendingUp as ProfitIcon, Place as PlaceIcon, ErrorOutline as AlertIcon, Schedule as ClockIcon
} from '@mui/icons-material';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis
} from 'recharts';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { approveBudgetRequest, getBudgetApprovals, returnBudgetRequest } from '../../services/projectManagementService';
import ExecutiveCeoPaymentsSection from '../../components/Dashboard/ExecutiveCeoPaymentsSection';
import { useAuth } from '../../contexts/AuthContext';
import { isPresidentUser } from '../../utils/presidentAccess';
import { PASTEL_BG, PASTEL_SHADOW, fmt, fmtShort, plural } from '../../components/ProjectManagement/mainProjectUi';
import { HEALTH_STYLE, ProgressRing, useCountUp } from '../../components/ProjectManagement/portfolioUi';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const rise = keyframes`from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; }`;
const drift = keyframes`0% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-20px) scale(1.15); } 100% { transform: translate(0,0) scale(1); }`;
const grow = keyframes`from { transform: scaleX(0); } to { transform: scaleX(1); }`;
const livePulse = keyframes`0% { box-shadow: 0 0 0 0 rgba(45,212,191,0.6); } 70% { box-shadow: 0 0 0 8px rgba(45,212,191,0); } 100% { box-shadow: 0 0 0 0 rgba(45,212,191,0); }`;
const spin = keyframes`to { transform: rotate(360deg); }`;

const GLASS = { bgcolor: 'rgba(255,255,255,0.68)', border: '1px solid rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(99,102,241,0.08)' };

/** Compact money for headline numbers: Rs 12.4 Cr / 45.2 Lac */
const fmtCompact = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `Rs ${(n / 1e5).toFixed(1)} Lac`;
  return fmt(n);
};
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** % change from `before` to `now`; null when there is nothing to compare */
const change = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : null);

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** White card with a heading */
const Card = ({ title, subtitle, icon, tone = '#6366f1', action, children, sx, delay = 0 }) => (
  <Box
    sx={{
      p: { xs: 2, md: 2.5 }, bgcolor: '#fff', borderRadius: 4, border: `1px solid ${LINE}`,
      boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.04)',
      animation: `${rise} .6s ${delay}s both`, minWidth: 0, height: '100%', ...sx
    }}
  >
    {(title || action) && (
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1} sx={{ mb: 2 }}>
        <Stack direction="row" gap={1.25} alignItems="center" sx={{ minWidth: 0 }}>
          {icon && (
            <Box sx={{ width: 34, height: 34, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: `${tone}14`, color: tone, flexShrink: 0, '& svg': { fontSize: 19 } }}>
              {icon}
            </Box>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, color: INK, fontSize: 16 }}>{title}</Typography>
            {subtitle && <Typography variant="caption" sx={{ color: MUTED }}>{subtitle}</Typography>}
          </Box>
        </Stack>
        {action}
      </Stack>
    )}
    {children}
  </Box>
);

const OpenLink = ({ to, label = 'Open' }) => {
  const navigate = useNavigate();
  return (
    <Button size="small" endIcon={<ArrowIcon sx={{ fontSize: 16 }} />} onClick={() => navigate(to)} sx={{ textTransform: 'none', fontWeight: 700, color: MUTED, flexShrink: 0 }}>
      {label}
    </Button>
  );
};

/** A panel the server could not load */
const PanelError = ({ panel }) => (panel?.error ? <Alert severity="warning" sx={{ borderRadius: 3 }}>{panel.error}</Alert> : null);

/** Up / down badge comparing with last month; `goodWhenUp` false for costs */
const Delta = ({ value, goodWhenUp = true, suffix = 'vs last month' }) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = up === goodWhenUp;
  return (
    <Stack direction="row" alignItems="center" gap={0.25} sx={{ color: good ? '#15803d' : '#b91c1c' }}>
      {up ? <UpIcon sx={{ fontSize: 13 }} /> : <DownIcon sx={{ fontSize: 13 }} />}
      <Typography sx={{ fontSize: 11.5, fontWeight: 800 }}>{Math.abs(value)}%</Typography>
      {suffix && <Typography sx={{ fontSize: 11, color: MUTED, ml: 0.25 }} noWrap>{suffix}</Typography>}
    </Stack>
  );
};

/** Headline number in the header */
const HeroKpi = ({ label, value, tone, icon, note, delta, money = true, delay, hint, onClick }) => {
  const n = useCountUp(Number(value) || 0);
  return (
    <Box
      onClick={onClick}
      sx={{
        ...GLASS, p: 1.5, borderRadius: 3, minWidth: 0, cursor: onClick ? 'pointer' : 'default',
        animation: `${rise} .6s ${delay}s both`, transition: 'transform .2s, box-shadow .2s',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 8px 20px -8px ${tone}66` }
      }}
    >
      <Stack direction="row" alignItems="center" gap={0.75}>
        <Box sx={{ width: 24, height: 24, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: `${tone}1f`, color: tone, '& svg': { fontSize: 15 } }}>{icon}</Box>
        <Tooltip title={hint || ''} placement="top-start">
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: MUTED, cursor: hint ? 'help' : 'inherit' }} noWrap>{label}</Typography>
        </Tooltip>
      </Stack>
      <Tooltip title={money ? fmt(value) : ''} placement="bottom-start">
        <Typography sx={{ mt: 0.75, fontSize: { xs: 18, md: 22 }, fontWeight: 900, color: INK, letterSpacing: -0.5, whiteSpace: 'nowrap', lineHeight: 1.15 }}>
          {money ? fmtCompact(n) : Math.round(n).toLocaleString('en-PK')}
        </Typography>
      </Tooltip>
      <Box sx={{ mt: 0.5, minHeight: 18 }}>
        {delta}
        {!delta && note && <Typography sx={{ fontSize: 11.5, color: MUTED }} noWrap title={note}>{note}</Typography>}
      </Box>
      {delta && note && <Typography sx={{ fontSize: 11.5, color: MUTED }} noWrap title={note}>{note}</Typography>}
    </Box>
  );
};

const Hero = ({ data, user, loading, onRefresh }) => {
  const navigate = useNavigate();
  const f = data?.finance?.error ? null : data?.finance;
  const p = data?.people?.error ? null : data?.people;
  const a = data?.approvals?.error ? null : data?.approvals;
  const ag = data?.agenda?.error ? null : data?.agenda;
  const name = isPresidentUser(user) ? 'Honourable President' : (user?.firstName || 'President');
  const todayCount = ag?.today?.length || 0;
  const atCeo = a?.totalAtCeo || 0;

  return (
    <Box
      sx={{
        position: 'relative', overflow: 'hidden', borderRadius: 4, mb: 2.5, px: { xs: 2, md: 3 }, py: { xs: 2, md: 2.5 },
        background: PASTEL_BG, border: '1px solid rgba(255,255,255,0.85)', boxShadow: PASTEL_SHADOW
      }}
    >
      {[['#5eead4', '-8%', '-60%', 0], ['#a5b4fc', '60%', '-80%', 5], ['#f9a8d4', '85%', '30%', 9]].map(([c, l, tp, d]) => (
        <Box key={c} sx={{ position: 'absolute', left: l, top: tp, width: 380, height: 380, borderRadius: '50%', background: `radial-gradient(circle, ${c}55 0%, transparent 65%)`, animation: `${drift} 16s ${d}s ease-in-out infinite`, pointerEvents: 'none' }} />
      ))}
      <Box sx={{ position: 'relative' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={1.5}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" gap={0.75}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#14b8a6', animation: `${livePulse} 2s infinite` }} />
              <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#0f766e' }}>
                President's Command Center · {dayjs().format('dddd, D MMMM YYYY')}
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: { xs: 24, md: 30 }, fontWeight: 900, color: INK, letterSpacing: -0.8, mt: 0.5 }}>
              {greeting()}, {name}
            </Typography>
            <Typography sx={{ color: MUTED, fontSize: 14, mt: 0.25 }}>
              {loading && !data ? 'Gathering the group\'s numbers…' : (
                <>
                  {todayCount ? `${plural(todayCount, 'engagement')} on your agenda today` : 'Nothing on your agenda today'}
                  {' · '}
                  {atCeo ? `${plural(atCeo, 'document')} waiting at the CEO office` : 'No documents waiting at the CEO office'}
                  {p ? ` · ${p.headcount.toLocaleString('en-PK')} people across the group` : ''}
                </>
              )}
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" gap={1} sx={{ flexShrink: 0 }}>
            {data?.generatedAt && (
              <Typography sx={{ fontSize: 12, color: MUTED }}>Updated {dayjs(data.generatedAt).format('h:mm A')}</Typography>
            )}
            <Tooltip title="Refresh">
              <IconButton onClick={onRefresh} sx={{ ...GLASS }}>
                <RefreshIcon sx={{ animation: loading ? `${spin} 1s linear infinite` : 'none' }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Box sx={{ mt: 2.25, display: 'grid', gap: 1.25, gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(3, minmax(0,1fr))', lg: 'repeat(6, minmax(0,1fr))' } }}>
          {!data ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: 3, bgcolor: 'rgba(255,255,255,0.5)' }} />) : (
            <>
              <HeroKpi
                label="Cash & bank" value={f?.cash.total} tone="#0f766e" icon={<CashIcon />} delay={0}
                delta={f && <Delta value={change(f.cash.total, f.cash.previousMonthEnd)} suffix="vs last month end" />}
                hint="Balance of every bank and cash account, all companies, from posted journals"
                onClick={() => navigate('/finance')}
              />
              <HeroKpi
                label="Revenue MTD" value={f?.thisMonth.revenue} tone="#6366f1" icon={<ProfitIcon />} delay={0.05}
                delta={f && <Delta value={change(f.thisMonth.revenue, f.lastMonth.revenue)} />}
                hint="Posted revenue for the current month, all companies"
              />
              <HeroKpi
                label="Profit MTD" value={f?.thisMonth.netProfit} tone={f?.thisMonth.netProfit < 0 ? '#ef4444' : '#22c55e'} icon={<PayIcon />} delay={0.1}
                note={f && `YTD ${fmtCompact(f.yearToDate.netProfit)}`}
                hint="Revenue minus expenses this month; year to date below"
              />
              <HeroKpi
                label="Receivables" value={f?.receivables.total} tone="#0ea5e9" icon={<ReceivableIcon />} delay={0.15}
                note={f && (f.receivables.overdue ? `${fmtCompact(f.receivables.overdue)} overdue` : `${plural(f.receivables.count, 'open invoice')}`)}
                hint="Unpaid customer invoices, all companies"
                onClick={() => navigate('/finance/aged-receivables')}
              />
              <HeroKpi
                label="Payables" value={f?.payables.total} tone="#f59e0b" icon={<PayableIcon />} delay={0.2}
                note={f && (f.payables.overdue ? `${fmtCompact(f.payables.overdue)} overdue` : `${plural(f.payables.count, 'open bill')}`)}
                hint="Unpaid vendor bills, all companies"
                onClick={() => navigate('/finance/aged-payables')}
              />
              <HeroKpi
                label="People" value={p?.headcount} money={false} tone="#ec4899" icon={<PeopleIcon />} delay={0.25}
                note={p && `+${p.joinedThisMonth} joined · −${p.leftThisMonth} left this month`}
                hint="Active employees across all companies"
                onClick={() => navigate('/hr/employees')}
              />
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
};

const DECISION_KINDS = [
  { key: 'purchaseOrders', label: 'Purchase orders', tone: '#6366f1', to: '/procurement/purchase-orders' },
  { key: 'cashApprovals', label: 'Cash approvals', tone: '#0ea5e9', to: '/general/cash-approvals' },
  { key: 'contractorIpcs', label: 'Contractor IPCs', tone: '#f59e0b', to: '/general/project-management/approvals' },
  { key: 'projectBudgets', label: 'Project budgets', tone: '#a855f7', to: '/budget-approvals' }
];

const waitTone = (days) => (days >= 7 ? '#b91c1c' : days >= 3 ? '#c2410c' : '#15803d');

/** What is waiting for a decision: counts at the CEO office, then the oldest documents */
const DecisionsCard = ({ approvals: a }) => {
  const goToApprovals = () => document.getElementById('president-approvals')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const oldest = useMemo(() => {
    if (!a || a.error) return [];
    return DECISION_KINDS.flatMap((k) => (a[k.key]?.items || []).map((x) => ({ ...x, kind: k })))
      .sort((x, y) => (y.days ?? 0) - (x.days ?? 0))
      .slice(0, 7);
  }, [a]);

  return (
    <Card
      title="Waiting for a decision" icon={<DecisionIcon />} tone="#6366f1" delay={0.1}
      subtitle={a && !a.error ? `${plural(a.totalAtCeo, 'document')} at the CEO office · ${fmtCompact(a.totalAtCeoAmount)}` : 'Approvals across Procurement, Finance and Projects'}
    >
      <PanelError panel={a} />
      {a && !a.error && (
        <>
          <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', md: 'repeat(4, minmax(0,1fr))' } }}>
            {DECISION_KINDS.map((k) => {
              const row = a[k.key] || {};
              const main = k.key === 'projectBudgets' ? row.inApproval : row.atCeo;
              const amount = k.key === 'projectBudgets' ? row.inApprovalAmount : row.atCeoAmount;
              return (
                <Box
                  key={k.key} onClick={goToApprovals}
                  sx={{
                    p: 1.5, borderRadius: 3, cursor: 'pointer', border: `1px solid ${k.tone}33`, background: `linear-gradient(160deg, ${k.tone}12, #fff 70%)`,
                    transition: 'transform .2s, box-shadow .2s', '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 8px 18px -10px ${k.tone}` }
                  }}
                >
                  <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: k.tone }} noWrap>{k.label}</Typography>
                  <Stack direction="row" alignItems="baseline" gap={0.75} sx={{ mt: 0.5 }}>
                    <Typography sx={{ fontSize: 28, fontWeight: 900, color: INK, lineHeight: 1 }}>{main || 0}</Typography>
                    <Typography sx={{ fontSize: 12, color: MUTED }}>{k.key === 'projectBudgets' ? 'in approval' : 'at CEO'}</Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: INK, mt: 0.5 }} noWrap>{fmtCompact(amount)}</Typography>
                  {k.key === 'projectBudgets' && row.inApprovalUtilized > 0 && (
                    <Typography sx={{ fontSize: 11, color: '#6d28d9', fontWeight: 700 }} noWrap>incl. {fmtCompact(row.inApprovalUtilized)} already utilized</Typography>
                  )}
                  <Typography sx={{ fontSize: 11.5, color: MUTED }} noWrap>
                    {k.key === 'projectBudgets'
                      ? (row.oldestDays != null ? `oldest ${row.oldestDays}d` : 'none waiting')
                      : `${row.inApproval || 0} in approval overall`}
                  </Typography>
                </Box>
              );
            })}
          </Box>

          <Typography sx={{ fontSize: 12, fontWeight: 800, color: MUTED, letterSpacing: 0.6, textTransform: 'uppercase', mt: 2.25, mb: 1 }}>
            Longest waiting
          </Typography>
          {oldest.length === 0 ? (
            <Stack direction="row" alignItems="center" gap={1} sx={{ p: 1.5, borderRadius: 3, bgcolor: '#f0fdf4', color: '#15803d' }}>
              <OkIcon fontSize="small" />
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Nothing is waiting at the CEO office — all clear.</Typography>
            </Stack>
          ) : (
            <Stack divider={<Box sx={{ borderTop: `1px dashed ${LINE}` }} />}>
              {oldest.map((x) => (
                <Stack
                  key={`${x.kind.key}-${x.id}`} direction="row" alignItems="center" gap={1.5}
                  onClick={goToApprovals}
                  sx={{ py: 1, px: 0.5, cursor: 'pointer', borderRadius: 2, '&:hover': { bgcolor: '#f8fafc' } }}
                >
                  <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 2, bgcolor: x.kind.tone, flexShrink: 0 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: INK }} noWrap>{x.title}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: MUTED }} noWrap>
                      {x.kind.label.replace(/s$/, '')} · {x.number || '—'}{x.withWhom ? ` · with ${x.withWhom}` : ''}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: INK, whiteSpace: 'nowrap' }}>{fmtCompact(x.amount)}</Typography>
                  <Chip
                    size="small" icon={<ClockIcon sx={{ fontSize: '14px !important' }} />}
                    label={x.days != null ? `${x.days}d` : '—'}
                    sx={{ fontWeight: 800, bgcolor: `${waitTone(x.days || 0)}14`, color: waitTone(x.days || 0), '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                </Stack>
              ))}
            </Stack>
          )}
          {a.indents?.inApproval > 0 && (
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5, p: 1.25, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
              <Typography sx={{ fontSize: 12.5, color: MUTED }}>
                <b style={{ color: INK }}>{a.indents.inApproval}</b> indents in review{a.indents.urgent ? <> · <b style={{ color: '#b91c1c' }}>{a.indents.urgent} urgent/high</b></> : ''}
              </Typography>
              <OpenLink to="/general/indents" label="Indents" />
            </Stack>
          )}
        </>
      )}
    </Card>
  );
};

const timeLabel = (x) => {
  const t = (v) => (v && /^\d{1,2}:\d{2}/.test(v) ? dayjs(`2000-01-01T${v.padStart(5, '0')}`).format('h:mm A') : v);
  if (!x.startTime) return 'All day';
  return x.endTime ? `${t(x.startTime)} – ${t(x.endTime)}` : t(x.startTime);
};

/** Today's meetings and events as a timeline, then the rest of the week */
const AgendaCard = ({ agenda: ag }) => {
  const navigate = useNavigate();
  const open = (x) => navigate(`/general/president-secretariat/${x.kind === 'Meeting' ? 'meetings' : 'events'}/${x.id}`);
  const Row = ({ x, showDate }) => {
    const tone = x.kind === 'Meeting' ? '#6366f1' : '#ec4899';
    return (
      <Stack direction="row" gap={1.5} onClick={() => open(x)} sx={{ cursor: 'pointer', py: 1, borderRadius: 2, '&:hover': { bgcolor: '#f8fafc' } }}>
        <Box sx={{ width: 64, flexShrink: 0, textAlign: 'right' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: INK }}>{showDate ? dayjs(x.date).format('ddd D') : timeLabel(x).split(' – ')[0]}</Typography>
          {showDate && <Typography sx={{ fontSize: 11, color: MUTED }}>{timeLabel(x).split(' – ')[0]}</Typography>}
        </Box>
        <Box sx={{ position: 'relative', width: 12, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <Box sx={{ position: 'absolute', top: 0, bottom: -8, width: 2, bgcolor: LINE }} />
          <Box sx={{ position: 'relative', mt: 0.5, width: 10, height: 10, borderRadius: '50%', bgcolor: tone, boxShadow: `0 0 0 3px ${tone}26` }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: INK }} noWrap>{x.title}</Typography>
          <Stack direction="row" gap={0.75} alignItems="center" sx={{ color: MUTED, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: tone }}>{x.kind}{x.type ? ` · ${x.type}` : ''}</Typography>
            {x.venue && <Stack direction="row" alignItems="center" gap={0.25}><PlaceIcon sx={{ fontSize: 12 }} /><Typography sx={{ fontSize: 11.5 }} noWrap>{x.venue}</Typography></Stack>}
            {x.status === 'Postponed' && <Chip size="small" label="Postponed" sx={{ height: 18, fontSize: 10.5, fontWeight: 700, bgcolor: '#ffedd5', color: '#c2410c' }} />}
          </Stack>
        </Box>
      </Stack>
    );
  };

  return (
    <Card
      title="Your agenda" icon={<MeetingIcon />} tone="#ec4899" delay={0.15}
      subtitle={ag && !ag.error ? `${plural(ag.today.length, 'item')} today · ${ag.nextSevenDays} in the next 7 days` : 'Meetings and events'}
      action={<OpenLink to="/general/president-secretariat/dashboard" label="Secretariat" />}
    >
      <PanelError panel={ag} />
      {ag && !ag.error && (
        <>
          {ag.today.length === 0 ? (
            <Box sx={{ p: 2, borderRadius: 3, textAlign: 'center', background: 'linear-gradient(160deg, #fdf2f8, #fff)' }}>
              <EventIcon sx={{ color: '#f9a8d4', fontSize: 32 }} />
              <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: INK }}>A clear day</Typography>
              <Typography sx={{ fontSize: 12, color: MUTED }}>No meetings or events scheduled for today</Typography>
            </Box>
          ) : ag.today.map((x) => <Row key={`${x.kind}-${x.id}`} x={x} />)}

          {ag.upcoming.length > 0 && (
            <>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: MUTED, letterSpacing: 0.6, textTransform: 'uppercase', mt: 2, mb: 0.5 }}>Coming up</Typography>
              {ag.upcoming.slice(0, 5).map((x) => <Row key={`${x.kind}-${x.id}`} x={x} showDate />)}
            </>
          )}
          {ag.requestsWaiting > 0 && (
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5, p: 1.25, borderRadius: 2.5, bgcolor: '#fdf2f8' }}>
              <Typography sx={{ fontSize: 12.5, color: MUTED }}><b style={{ color: INK }}>{ag.requestsWaiting}</b> meeting {ag.requestsWaiting === 1 ? 'request' : 'requests'} waiting to be scheduled</Typography>
              <OpenLink to="/general/president-secretariat/meetings" label="Review" />
            </Stack>
          )}
        </>
      )}
    </Card>
  );
};

/** Project budgets whose turn is the President's: approve or return right here */
const BudgetApprovalsCard = ({ onChanged }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { row, action: 'approve' | 'return' }
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getBudgetApprovals();
      setRows(res.data?.data?.waiting || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load project budgets');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async () => {
    const { row, action } = dialog;
    setSaving(true);
    try {
      const res = action === 'approve'
        ? await approveBudgetRequest(row._id, remarks.trim())
        : await returnBudgetRequest(row._id, remarks.trim());
      setMessage(res.data?.message || 'Done');
      setDialog(null);
      setRemarks('');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const returning = dialog?.action === 'return';
  return (
    <Card
      title="Project budgets waiting for you" icon={<ProjectIcon />} tone="#a855f7" delay={0.12}
      subtitle={rows ? (rows.length ? `${plural(rows.length, 'budget')} · ${fmtCompact(rows.reduce((t, r) => t + (Number(r.amount) || 0) + (Number(r.utilized) || 0), 0))}` : 'Nothing waiting for your approval') : 'Loading…'}
      action={<OpenLink to="/budget-approvals" label="All budgets" />}
    >
      {error && <Alert severity="error" sx={{ mb: 1.5, borderRadius: 3 }} onClose={() => setError('')}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 1.5, borderRadius: 3 }} onClose={() => setMessage('')}>{message}</Alert>}
      {!rows ? <Skeleton variant="rounded" height={60} sx={{ borderRadius: 3 }} /> : rows.length === 0 ? (
        <Stack direction="row" alignItems="center" gap={1} sx={{ p: 1.5, borderRadius: 3, bgcolor: '#f0fdf4', color: '#15803d' }}>
          <OkIcon fontSize="small" />
          <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>No project budget is waiting for your approval.</Typography>
        </Stack>
      ) : (
        <Stack gap={1}>
          {rows.map((r) => (
            <Stack key={r._id} direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} gap={1.5} sx={{ p: 1.5, borderRadius: 3, border: `1px solid ${LINE}` }}>
              <Box sx={{ minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => navigate('/budget-approvals')}>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: INK }} noWrap>{r.name}</Typography>
                <Typography sx={{ fontSize: 12, color: MUTED }} noWrap>
                  {[r.documentNo || r.projectNumber, r.revision ? `Revision ${r.revision}` : null, r.location, r.submittedAt ? `sent ${dayjs(r.submittedAt).format('D MMM')}` : null].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
              <Tooltip title={Number(r.utilized) > 0 ? `Total ${fmt((Number(r.amount) || 0) + Number(r.utilized))} = ${fmt(r.utilized)} already utilized before the ERP + ${fmt(r.amount)} remaining` : fmt(r.amount)}>
                <Box sx={{ textAlign: { sm: 'right' } }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 900, color: INK, whiteSpace: 'nowrap' }}>{fmtCompact((Number(r.amount) || 0) + (Number(r.utilized) || 0))}</Typography>
                  {Number(r.utilized) > 0 && <Typography sx={{ fontSize: 11, color: '#6d28d9', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtCompact(r.utilized)} already utilized</Typography>}
                </Box>
              </Tooltip>
              <Stack direction="row" gap={1}>
                <Button size="small" variant="contained" color="success" onClick={() => { setRemarks(''); setDialog({ row: r, action: 'approve' }); }} sx={{ textTransform: 'none', fontWeight: 700 }}>Approve</Button>
                <Button size="small" variant="outlined" color="error" onClick={() => { setRemarks(''); setDialog({ row: r, action: 'return' }); }} sx={{ textTransform: 'none', fontWeight: 700 }}>Return</Button>
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}

      <Dialog open={Boolean(dialog)} onClose={() => !saving && setDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{returning ? 'Return budget' : 'Approve budget'}</DialogTitle>
        <DialogContent>
          {dialog && (
            <Typography sx={{ fontSize: 14, color: MUTED, mb: 2 }}>
              {dialog.row.name} · <b style={{ color: INK }}>{fmt(dialog.row.amount)}</b>
            </Typography>
          )}
          <TextField
            autoFocus fullWidth multiline minRows={2} label={returning ? 'Why is it being returned?' : 'Remarks (optional)'}
            value={remarks} onChange={(e) => setRemarks(e.target.value)}
          />
          {!returning && <Typography sx={{ fontSize: 12, color: MUTED, mt: 1 }}>To change amounts before approving, open it from All budgets.</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button
            variant="contained" color={returning ? 'error' : 'success'} onClick={act}
            disabled={saving || (returning && remarks.trim().length < 3)}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {returning ? 'Return' : 'Approve'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};

const MoneyTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ p: 1.25, bgcolor: '#fff', border: `1px solid ${LINE}`, borderRadius: 2, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }}>
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: INK, mb: 0.5 }}>{label}</Typography>
      {payload.map((p) => (
        <Stack key={p.dataKey} direction="row" justifyContent="space-between" gap={2}>
          <Typography sx={{ fontSize: 12, color: p.color }}>{p.name}</Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: INK }}>{fmt(p.value)}</Typography>
        </Stack>
      ))}
    </Box>
  );
};

/** 12 months of revenue vs expenses with net profit, and cash at each month end */
const FinanceCard = ({ finance: f }) => (
  <Card
    title="Group financial performance" icon={<ProfitIcon />} tone="#6366f1" delay={0.2}
    subtitle="Last 12 months, all companies, from posted journals"
    action={<OpenLink to="/finance" label="Finance" />}
  >
    <PanelError panel={f} />
    {f && !f.error && (
      <>
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(4, minmax(0,1fr))' }, mb: 2 }}>
          {[
            ['Revenue YTD', f.yearToDate.revenue, '#6366f1'],
            ['Expenses YTD', f.yearToDate.expenses, '#f59e0b'],
            ['Net profit YTD', f.yearToDate.netProfit, f.yearToDate.netProfit < 0 ? '#ef4444' : '#22c55e'],
            ['Margin YTD', null, '#0ea5e9']
          ].map(([label, v, tone]) => (
            <Box key={label} sx={{ p: 1.25, borderRadius: 2.5, bgcolor: '#f8fafc', borderLeft: `3px solid ${tone}` }}>
              <Typography sx={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>{label}</Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 900, color: INK }}>
                {v === null ? (f.yearToDate.revenue > 0 ? `${Math.round((f.yearToDate.netProfit / f.yearToDate.revenue) * 1000) / 10}%` : '—') : fmtCompact(v)}
              </Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ height: 280 }}>
          <ResponsiveContainer>
            <ComposedChart data={f.trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={48} />
              <ChartTooltip content={<MoneyTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue" name="Revenue" fill="#818cf8" radius={[6, 6, 0, 0]} maxBarSize={22} />
              <Bar dataKey="expenses" name="Expenses" fill="#fbbf24" radius={[6, 6, 0, 0]} maxBarSize={22} />
              <Line dataKey="netProfit" name="Net profit" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </>
    )}
  </Card>
);

const COMPANY_TONES = ['#0f766e', '#6366f1', '#0ea5e9', '#f59e0b', '#ec4899', '#a855f7', '#22c55e', '#ef4444'];

/** Cash position: month-end trend, then where it sits by company */
const CashCard = ({ finance: f }) => {
  const total = f && !f.error ? f.cash.byCompany.reduce((t, c) => t + Math.max(0, c.balance), 0) : 0;
  return (
    <Card title="Cash position" icon={<CashIcon />} tone="#0f766e" delay={0.25} subtitle="Bank and cash at each month end, then by company" action={<OpenLink to="/finance/banking" label="Banking" />}>
      <PanelError panel={f} />
      {f && !f.error && (
        <>
          <Box sx={{ height: 120, mx: -1 }}>
            <ResponsiveContainer>
              <AreaChart data={f.trend} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="presCash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" hide />
                <ChartTooltip content={<MoneyTooltip />} />
                <Area dataKey="cashBalance" name="Cash & bank" stroke="#0d9488" strokeWidth={2.5} fill="url(#presCash)" type="monotone" />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 1, mb: 1.5 }}>
            <Box>
              <Typography sx={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>Cash in this month</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#15803d' }}>{fmtCompact(f.thisMonth.cashIn)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>Cash out this month</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#b91c1c' }}>{fmtCompact(f.thisMonth.cashOut)}</Typography>
            </Box>
          </Stack>
          <Stack gap={1.1}>
            {f.cash.byCompany.slice(0, 6).map((c, i) => (
              <Box key={c.companyId || c.name}>
                <Stack direction="row" justifyContent="space-between" gap={1}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: INK }} noWrap title={c.name}>{c.name}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: c.balance < 0 ? '#b91c1c' : INK, whiteSpace: 'nowrap' }}>{fmtCompact(c.balance)}</Typography>
                </Stack>
                <Box sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${pct(Math.max(0, c.balance), total)}%`, bgcolor: COMPANY_TONES[i % COMPANY_TONES.length], borderRadius: 3, transformOrigin: 'left', animation: `${grow} 1s ${0.3 + i * 0.05}s cubic-bezier(.2,.8,.2,1) both` }} />
                </Box>
              </Box>
            ))}
            {f.cash.byCompany.length === 0 && <Typography sx={{ fontSize: 13, color: MUTED }}>No bank or cash balances posted yet.</Typography>}
          </Stack>
        </>
      )}
    </Card>
  );
};

const STATUS_TONE = { Active: '#15803d', Planning: '#0369a1', 'On Hold': '#c2410c', Completed: '#4338ca', Draft: '#64748b' };

/** Construction portfolio: overall progress, money flow and the projects that need attention */
const ProjectsCard = ({ projects: pr }) => {
  const navigate = useNavigate();
  const flow = pr && !pr.error ? [
    ['Approved budget', pr.totals.budget, '#94a3b8'],
    ['Certified work', pr.totals.certified, '#f59e0b'],
    ['Paid to contractors', pr.totals.paid, '#22c55e'],
    ['Billed to clients', pr.totals.clientBilled, '#0f766e'],
    ['Received from clients', pr.totals.clientReceived, '#14b8a6']
  ] : [];
  const max = Math.max(1, ...flow.map((x) => x[1]));
  return (
    <Card
      title="Construction projects" icon={<ProjectIcon />} tone="#f59e0b" delay={0.3}
      subtitle={pr && !pr.error ? `${plural(pr.count, 'main project')}` : 'Portfolio'}
      action={<OpenLink to="/general/project-management/dashboard" label="Portfolio" />}
    >
      <PanelError panel={pr} />
      {pr && !pr.error && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2.5} alignItems={{ sm: 'center' }}>
            <Stack alignItems="center" gap={1} sx={{ flexShrink: 0 }}>
              <ProgressRing value={pr.overallProgress} size={112} stroke={10} color="#f59e0b" label="complete" />
              <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="center" sx={{ maxWidth: 180 }}>
                {pr.byStatus.map((s) => (
                  <Chip key={s.status} size="small" label={`${s.count} ${s.status}`} sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: `${STATUS_TONE[s.status]}14`, color: STATUS_TONE[s.status] }} />
                ))}
              </Stack>
            </Stack>
            <Stack gap={1.1} sx={{ flex: 1, minWidth: 0 }}>
              {flow.map(([label, v, tone], i) => (
                <Box key={label}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography sx={{ fontSize: 12.5, color: MUTED, fontWeight: 600 }}>{label}</Typography>
                    <Tooltip title={fmt(v)}><Typography sx={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{fmtCompact(v)}</Typography></Tooltip>
                  </Stack>
                  <Box sx={{ mt: 0.5, height: 7, borderRadius: 4, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${pct(v, max)}%`, bgcolor: tone, borderRadius: 4, transformOrigin: 'left', animation: `${grow} 1s ${0.3 + i * 0.06}s cubic-bezier(.2,.8,.2,1) both` }} />
                  </Box>
                </Box>
              ))}
              {pr.totals.utilized > 0 && (
                <Tooltip title={`${fmt(pr.totals.utilized)} was spent on ongoing projects before they came into the ERP. It is part of their total budget, not of the bars above.`}>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#6d28d9', cursor: 'help' }}>
                    + {fmtCompact(pr.totals.utilized)} already utilized before the ERP · total budget {fmtCompact(pr.totals.budget + pr.totals.utilized)}
                  </Typography>
                </Tooltip>
              )}
            </Stack>
          </Stack>

          <Typography sx={{ fontSize: 12, fontWeight: 800, color: MUTED, letterSpacing: 0.6, textTransform: 'uppercase', mt: 2.5, mb: 1 }}>
            {pr.atRisk.length ? 'Needs your attention' : 'Largest projects'}
          </Typography>
          <Stack gap={1}>
            {(pr.atRisk.length ? pr.atRisk : pr.top.slice(0, 4)).map((p) => {
              const hs = HEALTH_STYLE[p.health] || HEALTH_STYLE['On Track'];
              return (
                <Stack
                  key={p._id} direction="row" alignItems="center" gap={1.5}
                  onClick={() => navigate('/general/project-management/dashboard')}
                  sx={{ p: 1.25, borderRadius: 2.5, border: `1px solid ${LINE}`, cursor: 'pointer', '&:hover': { borderColor: hs.dot, bgcolor: `${hs.bg}66` } }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: INK }} noWrap>{p.name}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: MUTED }} noWrap>
                      {p.overdue ? `${p.daysOverdue} days past end date` : p.plannedProgress !== null ? `${p.progress}% done · ${p.plannedProgress}% of time used` : `${p.progress}% done`}
                      {p.budget ? ` · ${fmtCompact(p.certified)} of ${fmtCompact(p.budget)}` : ''}
                      {p.utilized > 0 ? ` · ${fmtCompact(p.utilized)} utilized before ERP` : ''}
                    </Typography>
                    <Box sx={{ mt: 0.75, height: 4, borderRadius: 2, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                      <Box sx={{ height: '100%', width: `${Math.min(100, p.progress)}%`, bgcolor: hs.dot }} />
                    </Box>
                  </Box>
                  <Chip size="small" label={p.health} sx={{ fontWeight: 800, fontSize: 11, bgcolor: hs.bg, color: hs.fg, flexShrink: 0 }} />
                </Stack>
              );
            })}
            {pr.count === 0 && <Typography sx={{ fontSize: 13, color: MUTED }}>No projects yet.</Typography>}
          </Stack>
        </>
      )}
    </Card>
  );
};

const ATTENDANCE_SLICES = [
  ['present', 'Present', '#22c55e'],
  ['onLeave', 'On leave', '#0ea5e9'],
  ['absent', 'Absent', '#ef4444']
];

/** Workforce: today's attendance, headcount by company, joiners vs leavers and payroll */
const PeopleCard = ({ people: p }) => {
  const slices = p && !p.error ? ATTENDANCE_SLICES.map(([k, label, color]) => ({ name: label, value: p.attendanceToday[k], color })).filter((s) => s.value > 0) : [];
  const headMax = p && !p.error ? Math.max(1, ...p.byCompany.map((c) => c.count)) : 1;
  return (
    <Card
      title="People" icon={<PeopleIcon />} tone="#ec4899" delay={0.35}
      subtitle={p && !p.error ? `${p.headcount.toLocaleString('en-PK')} active employees` : 'Workforce'}
      action={<OpenLink to="/hr/employees" label="HR" />}
    >
      <PanelError panel={p} />
      {p && !p.error && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems={{ sm: 'center' }}>
            <Box sx={{ position: 'relative', width: 130, height: 130, flexShrink: 0, mx: { xs: 'auto', sm: 0 } }}>
              {slices.length ? (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={slices} dataKey="value" innerRadius={44} outerRadius={62} paddingAngle={2} stroke="none">
                      {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
                    </Pie>
                    <ChartTooltip formatter={(v, n) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <Box sx={{ width: 124, height: 124, m: '3px', borderRadius: '50%', border: '14px solid #f1f5f9' }} />}
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
                <Box>
                  <Typography sx={{ fontSize: 22, fontWeight: 900, color: INK, lineHeight: 1 }}>{p.attendanceToday.marked ? `${pct(p.attendanceToday.present, p.attendanceToday.marked)}%` : '—'}</Typography>
                  <Typography sx={{ fontSize: 10.5, color: MUTED, fontWeight: 700 }}>{p.attendanceToday.marked ? 'present today' : 'not marked yet'}</Typography>
                </Box>
              </Box>
            </Box>
            <Stack gap={0.75} sx={{ flex: 1, minWidth: 0 }}>
              {ATTENDANCE_SLICES.map(([k, label, color]) => (
                <Stack key={k} direction="row" alignItems="center" justifyContent="space-between">
                  <Stack direction="row" alignItems="center" gap={0.75}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
                    <Typography sx={{ fontSize: 12.5, color: MUTED }}>{label}</Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: INK }}>{p.attendanceToday[k]}</Typography>
                </Stack>
              ))}
              {p.attendanceToday.late > 0 && <Typography sx={{ fontSize: 11.5, color: '#c2410c' }}>{p.attendanceToday.late} came in late</Typography>}
              {p.lastPayroll && (
                <Box sx={{ mt: 0.5, p: 1, borderRadius: 2, bgcolor: '#fdf2f8' }}>
                  <Typography sx={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>Payroll · {p.lastPayroll.label}</Typography>
                  <Tooltip title={`Gross ${fmt(p.lastPayroll.gross)}`}>
                    <Typography sx={{ fontSize: 15, fontWeight: 900, color: INK }}>{fmtCompact(p.lastPayroll.net)} <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>net · {p.lastPayroll.employees} staff</span></Typography>
                  </Tooltip>
                </Box>
              )}
            </Stack>
          </Stack>

          <Typography sx={{ fontSize: 12, fontWeight: 800, color: MUTED, letterSpacing: 0.6, textTransform: 'uppercase', mt: 2.25, mb: 1 }}>Headcount by company</Typography>
          <Stack gap={0.9}>
            {p.byCompany.slice(0, 6).map((c, i) => (
              <Stack key={c.name} direction="row" alignItems="center" gap={1}>
                <Typography sx={{ fontSize: 12, color: INK, fontWeight: 600, width: { xs: 110, sm: 150 }, flexShrink: 0 }} noWrap title={c.name}>{c.name}</Typography>
                <Box sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${pct(c.count, headMax)}%`, bgcolor: COMPANY_TONES[(i + 4) % COMPANY_TONES.length], borderRadius: 4, transformOrigin: 'left', animation: `${grow} 1s ${0.3 + i * 0.05}s cubic-bezier(.2,.8,.2,1) both` }} />
                </Box>
                <Typography sx={{ fontSize: 12, fontWeight: 800, color: INK, width: 40, textAlign: 'right' }}>{c.count}</Typography>
              </Stack>
            ))}
          </Stack>

          <Typography sx={{ fontSize: 12, fontWeight: 800, color: MUTED, letterSpacing: 0.6, textTransform: 'uppercase', mt: 2.25, mb: 0.5 }}>Joined vs left · 6 months</Typography>
          <Box sx={{ height: 120 }}>
            <ResponsiveContainer>
              <BarChart data={p.trend} margin={{ top: 5, right: 0, left: -24, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: MUTED }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: MUTED }} axisLine={false} tickLine={false} />
                <ChartTooltip cursor={{ fill: 'rgba(236,72,153,0.06)' }} />
                <Bar dataKey="joined" name="Joined" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={16} />
                <Bar dataKey="left" name="Left" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </>
      )}
    </Card>
  );
};

/** Taj Residencia: monthly collections, unpaid bills and complaints */
const TajCard = ({ taj: t }) => {
  const navigate = useNavigate();
  return (
    <Card
      title="Taj Residencia" icon={<TajIcon />} tone="#0ea5e9" delay={0.4}
      subtitle="Cash received from residents, unpaid bills and complaints"
      action={<OpenLink to="/finance/taj-utilities-charges/dashboard" label="Taj dashboard" />}
    >
      <PanelError panel={t} />
      {t && !t.error && (
        <Stack direction={{ xs: 'column', md: 'row' }} gap={2.5}>
          <Box sx={{ flex: 2, minWidth: 0 }}>
            <Stack direction="row" alignItems="baseline" gap={1.5} flexWrap="wrap">
              <Box>
                <Typography sx={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>Received this month</Typography>
                <Typography sx={{ fontSize: 24, fontWeight: 900, color: INK }}>{fmtCompact(t.collectedThisMonth)}</Typography>
              </Box>
              <Delta value={change(t.collectedThisMonth, t.collectedLastMonth)} />
            </Stack>
            <Box sx={{ height: 170, mt: 1 }}>
              <ResponsiveContainer>
                <AreaChart data={t.trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="presTaj" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={48} />
                  <ChartTooltip content={<MoneyTooltip />} />
                  <Area dataKey="amount" name="Received" stroke="#0284c7" strokeWidth={2.5} fill="url(#presTaj)" type="monotone" />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Box>
          <Stack gap={1.25} sx={{ flex: 1, minWidth: 0 }}>
            <Box onClick={() => navigate('/finance/taj-utilities-charges/dashboard')} sx={{ p: 1.5, borderRadius: 3, cursor: 'pointer', background: 'linear-gradient(160deg, #fff7ed, #fff)', border: '1px solid #fed7aa' }}>
              <Typography sx={{ fontSize: 11, color: '#c2410c', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>Unpaid resident bills</Typography>
              <Typography sx={{ fontSize: 20, fontWeight: 900, color: INK }}>{fmtCompact(t.outstanding.amount)}</Typography>
              <Typography sx={{ fontSize: 12, color: MUTED }}>{plural(t.outstanding.count, 'invoice')} with a balance</Typography>
            </Box>
            <Box onClick={() => navigate('/taj-residencia/complains-tickets')} sx={{ p: 1.5, borderRadius: 3, cursor: 'pointer', background: 'linear-gradient(160deg, #f0f9ff, #fff)', border: '1px solid #bae6fd' }}>
              <Typography sx={{ fontSize: 11, color: '#0369a1', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>Open complaints</Typography>
              <Typography sx={{ fontSize: 20, fontWeight: 900, color: INK }}>{t.complaints.open}</Typography>
              <Typography sx={{ fontSize: 12, color: MUTED }}>
                {t.complaints.new} new{t.complaints.approvalRequired ? ` · ${t.complaints.approvalRequired} need approval` : ''} · {t.complaints.completed} resolved
              </Typography>
            </Box>
          </Stack>
        </Stack>
      )}
    </Card>
  );
};

/** Short plain-language notes on what stands out, worst first */
const buildAlerts = (d) => {
  if (!d) return [];
  const out = [];
  const f = d.finance?.error ? null : d.finance;
  const a = d.approvals?.error ? null : d.approvals;
  const pr = d.projects?.error ? null : d.projects;
  if (f && f.thisMonth.netProfit < 0) out.push({ tone: 'error', text: `The group is running at a loss this month (${fmtCompact(f.thisMonth.netProfit)})` });
  if (f && f.payables.overdueCount) out.push({ tone: 'warning', text: `${plural(f.payables.overdueCount, 'vendor bill')} past due — ${fmtCompact(f.payables.overdue)}` });
  if (f && f.receivables.overdueCount) out.push({ tone: 'warning', text: `${fmtCompact(f.receivables.overdue)} owed by customers is overdue` });
  const stale = a ? DECISION_KINDS.flatMap((k) => a[k.key]?.items || []).filter((x) => (x.days || 0) >= 7).length : 0;
  if (stale) out.push({ tone: 'error', text: `${plural(stale, 'document')} waiting a week or more for approval` });
  const overBudget = pr ? pr.atRisk.filter((p) => p.health === 'Over Budget').length : 0;
  if (overBudget) out.push({ tone: 'error', text: `${plural(overBudget, 'project')} over the approved budget` });
  const late = pr ? pr.atRisk.filter((p) => p.health === 'Behind Schedule').length : 0;
  if (late) out.push({ tone: 'warning', text: `${plural(late, 'project')} behind schedule` });
  return out;
};

const PresidentDashboard = () => {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/president-dashboard/overview');
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const alerts = useMemo(() => buildAlerts(data), [data]);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, bgcolor: '#f8fafc', minHeight: '100%' }}>
      <Hero data={data} user={user} loading={loading} onRefresh={load} />

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }} action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>{error}</Alert>}

      {alerts.length > 0 && (
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 2.5, animation: `${rise} .6s .05s both` }}>
          {alerts.map((x) => (
            <Chip
              key={x.text} icon={<AlertIcon />} label={x.text}
              sx={{
                height: 'auto', py: 0.75, borderRadius: 2.5, fontWeight: 700, fontSize: 12.5, '& .MuiChip-label': { whiteSpace: 'normal' },
                bgcolor: x.tone === 'error' ? '#fef2f2' : '#fffbeb', color: x.tone === 'error' ? '#b91c1c' : '#a16207',
                border: `1px solid ${x.tone === 'error' ? '#fecaca' : '#fde68a'}`, '& .MuiChip-icon': { color: 'inherit' }
              }}
            />
          ))}
        </Stack>
      )}

      {!data && loading ? (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1.6fr 1fr' } }}>
          {[360, 360, 380, 380].map((h, i) => <Skeleton key={i} variant="rounded" height={h} sx={{ borderRadius: 4 }} />)}
        </Box>
      ) : data && (
        <Stack gap={2.5}>
          <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1.6fr) minmax(0,1fr)' } }}>
            <DecisionsCard approvals={data.approvals} />
            <AgendaCard agenda={data.agenda} />
          </Box>
          <Box id="president-approvals" sx={{ animation: `${rise} .6s .1s both` }}>
            <Typography sx={{ fontWeight: 900, color: INK, fontSize: 20, letterSpacing: -0.4, mb: 1.5 }}>Approve or reject</Typography>
            <Stack gap={2.5}>
              <BudgetApprovalsCard onChanged={load} />
              <ExecutiveCeoPaymentsSection showIpcTab />
            </Stack>
          </Box>
          <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1.6fr) minmax(0,1fr)' } }}>
            <FinanceCard finance={data.finance} />
            <CashCard finance={data.finance} />
          </Box>
          <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'repeat(2, minmax(0,1fr))' } }}>
            <ProjectsCard projects={data.projects} />
            <PeopleCard people={data.people} />
          </Box>
          <TajCard taj={data.taj} />
        </Stack>
      )}
    </Box>
  );
};

export default PresidentDashboard;
