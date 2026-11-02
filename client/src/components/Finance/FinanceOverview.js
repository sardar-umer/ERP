import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, LinearProgress, Paper, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography
} from '@mui/material';
import {
  AccountBalance as BankIcon, Download as DownloadIcon, Payments as CashIcon, TrendingDown as DownIcon, TrendingUp as UpIcon
} from '@mui/icons-material';
import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis
} from 'recharts';
import api from '../../services/api';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const C = { revenue: '#0f766e', expenses: '#e11d48', profit: '#4f46e5', cash: '#0369a1', ar: '#15803d', ap: '#b45309' };

const full = (n) => `PKR ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;
/** Headline money: 12.4 Cr / 45.2 Lac / 12,500 */
const compact = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)} Lac`;
  return Math.round(v).toLocaleString('en-PK');
};
const axisShort = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(0)}L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
};

const ymd = (d) => d.toISOString().slice(0, 10);
/** Period presets → { fromDate, toDate } (calendar dates, local) */
const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'ytd', label: 'Year to date' },
  { value: '12m', label: 'Last 12 months' }
];
const rangeFor = (preset) => {
  const t = new Date();
  const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
  const y = t.getFullYear();
  const m = t.getMonth();
  const today = utc(y, m, t.getDate());
  switch (preset) {
    case 'lastMonth': return { fromDate: ymd(utc(y, m - 1, 1)), toDate: ymd(utc(y, m, 0)) };
    case 'quarter': return { fromDate: ymd(utc(y, Math.floor(m / 3) * 3, 1)), toDate: ymd(today) };
    case 'ytd': return { fromDate: ymd(utc(y, 0, 1)), toDate: ymd(today) };
    case '12m': return { fromDate: ymd(utc(y, m - 11, 1)), toDate: ymd(today) };
    default: return { fromDate: ymd(utc(y, m, 1)), toDate: ymd(today) };
  }
};

/** % change vs previous; null when there is nothing to compare with */
const change = (now, before) => {
  if (!before) return null;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
};

const Delta = ({ value, goodWhenUp = true }) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <Typography sx={{ fontSize: 11.5, color: MUTED }}>No earlier figure</Typography>;
  }
  const up = value >= 0;
  const good = up === goodWhenUp;
  const Icon = up ? UpIcon : DownIcon;
  return (
    <Stack direction="row" alignItems="center" gap={0.4}>
      <Icon sx={{ fontSize: 15, color: good ? '#15803d' : '#dc2626' }} />
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: good ? '#15803d' : '#dc2626' }}>{up ? '+' : ''}{value}%</Typography>
      <Typography sx={{ fontSize: 11.5, color: MUTED }}>vs previous</Typography>
    </Stack>
  );
};

const Spark = ({ data, dataKey, color }) => (
  <Box sx={{ height: 38, mt: 1, mx: -0.5 }}>
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sp-${dataKey}-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#sp-${dataKey}-${color.slice(1)})`} isAnimationActive />
      </AreaChart>
    </ResponsiveContainer>
  </Box>
);

/** One headline figure: value, change, mini trend; click opens the report behind it */
const Kpi = ({ title, value, color, note, delta, goodWhenUp, spark, sparkKey, onClick, loading }) => (
  <Paper
    elevation={0}
    onClick={onClick}
    sx={{
      p: 2, borderRadius: 3, border: `1px solid ${LINE}`, bgcolor: '#fff', cursor: onClick ? 'pointer' : 'default',
      position: 'relative', overflow: 'hidden', transition: 'all .18s', height: '100%',
      '&:before': { content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, bgcolor: color },
      '&:hover': onClick ? { boxShadow: '0 10px 24px rgba(15,23,42,0.08)', transform: 'translateY(-2px)', borderColor: color } : {}
    }}
  >
    <Typography sx={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</Typography>
    {loading ? <Skeleton width="70%" height={40} /> : (
      <Tooltip title={full(value)} placement="top-start">
        <Typography sx={{ fontSize: 26, fontWeight: 900, color: INK, letterSpacing: -0.5, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
          <Box component="span" sx={{ fontSize: 13, fontWeight: 700, color: MUTED, mr: 0.5 }}>PKR</Box>{compact(value)}
        </Typography>
      </Tooltip>
    )}
    {note && <Typography sx={{ fontSize: 12, color: MUTED, mt: 0.25 }}>{note}</Typography>}
    {delta !== undefined && <Box sx={{ mt: 0.5 }}><Delta value={delta} goodWhenUp={goodWhenUp} /></Box>}
    {spark && spark.length > 0 && <Spark data={spark} dataKey={sparkKey} color={color} />}
  </Paper>
);

const Panel = ({ title, subtitle, action, children, sx }) => (
  <Paper elevation={0} sx={{ p: 2.25, borderRadius: 3, border: `1px solid ${LINE}`, bgcolor: '#fff', height: '100%', ...sx }}>
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1} sx={{ mb: 1.5 }}>
      <Box>
        <Typography sx={{ fontWeight: 800, color: INK, fontSize: 15.5 }}>{title}</Typography>
        {subtitle && <Typography sx={{ fontSize: 12.5, color: MUTED }}>{subtitle}</Typography>}
      </Box>
      {action}
    </Stack>
    {children}
  </Paper>
);

const TrendTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <Paper elevation={3} sx={{ p: 1.25, borderRadius: 2, minWidth: 190 }}>
      <Typography sx={{ fontWeight: 800, fontSize: 12.5, mb: 0.5 }}>{label}</Typography>
      {payload.map((p) => (
        <Stack key={p.dataKey} direction="row" justifyContent="space-between" gap={2}>
          <Typography sx={{ fontSize: 12, color: p.color }}>{p.name}</Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{full(p.value)}</Typography>
        </Stack>
      ))}
    </Paper>
  );
};

const EXPENSE_COLORS = ['#e11d48', '#f97316', '#f59e0b', '#84cc16', '#14b8a6', '#0ea5e9', '#8b5cf6', '#94a3b8'];

/** Where the money went this period: largest expense accounts as bars with their share */
const SpendingPanel = ({ rows, total, loading, onOpen }) => (
  <Panel
    title="Where the money went"
    subtitle={total ? `Expenses ${full(total)} this period` : 'Expenses by account, this period'}
    action={<Chip size="small" label="Profit & loss" onClick={onOpen} sx={{ fontWeight: 700 }} />}
  >
    {loading ? <Skeleton variant="rounded" height={240} /> : !rows.length ? (
      <Box sx={{ height: 240, display: 'grid', placeItems: 'center', bgcolor: '#f8fafc', borderRadius: 2 }}>
        <Typography sx={{ color: MUTED }}>No expenses posted in this period.</Typography>
      </Box>
    ) : (
      <Stack gap={1.25}>
        {rows.map((r, i) => {
          const share = total > 0 ? Math.round((r.amount / total) * 1000) / 10 : 0;
          return (
            <Box key={r._id}>
              <Stack direction="row" justifyContent="space-between" gap={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: INK }}>{r.name}</Typography>
                  {r.category && <Typography noWrap sx={{ fontSize: 11, color: MUTED }}>{r.category}</Typography>}
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                  <Tooltip title={full(r.amount)}><Typography sx={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{compact(r.amount)}</Typography></Tooltip>
                  <Typography sx={{ fontSize: 11, color: MUTED }}>{share}%</Typography>
                </Box>
              </Stack>
              <Box sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${share}%`, bgcolor: EXPENSE_COLORS[i % EXPENSE_COLORS.length], borderRadius: 3, transition: 'width .6s' }} />
              </Box>
            </Box>
          );
        })}
      </Stack>
    )}
  </Panel>
);

/** Money into and out of the bank / cash accounts each month, with the closing balance */
const CashFlowPanel = ({ trend, loading, onOpen }) => {
  const has = (trend || []).some((m) => m.cashIn || m.cashOut);
  return (
    <Panel
      title="Cash in vs cash out"
      subtitle="Bank and cash accounts, last 12 months"
      action={<Chip size="small" label="Banking" onClick={onOpen} sx={{ fontWeight: 700 }} />}
    >
      {loading ? <Skeleton variant="rounded" height={240} /> : !has ? (
        <Box sx={{ height: 240, display: 'grid', placeItems: 'center', bgcolor: '#f8fafc', borderRadius: 2 }}>
          <Typography sx={{ color: MUTED }}>No bank or cash movements in the last 12 months.</Typography>
        </Box>
      ) : (
        <Box sx={{ height: 240 }}>
          <ResponsiveContainer>
            <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={LINE} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={axisShort} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={44} />
              <RTooltip content={<TrendTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="cashIn" name="Cash in" fill="#16a34a" radius={[5, 5, 0, 0]} maxBarSize={18} />
              <Bar dataKey="cashOut" name="Cash out" fill="#f97316" radius={[5, 5, 0, 0]} maxBarSize={18} />
              <Line type="monotone" dataKey="balance" name="Closing balance" stroke={C.cash} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Panel>
  );
};

/** Cost-centre budgets against what was actually spent in the period */
const BudgetPanel = ({ data, loading, onOpen }) => {
  const rows = (data?.rows || []).filter((r) => r.budget > 0 || r.actual > 0).sort((a, b) => b.budget - a.budget).slice(0, 6);
  const tb = data?.totals?.budget ?? rows.reduce((t, r) => t + r.budget, 0);
  const ta = data?.totals?.actual ?? rows.reduce((t, r) => t + r.actual, 0);
  return (
    <Panel
      title="Budget vs actual"
      subtitle={tb > 0 ? `${full(ta)} spent of ${full(tb)} budgeted (${Math.round((ta / tb) * 100)}%)` : 'Cost-centre budgets, this period'}
      action={<Chip size="small" label="Full report" onClick={onOpen} sx={{ fontWeight: 700 }} />}
    >
      {loading ? <Skeleton variant="rounded" height={240} /> : !rows.length ? (
        <Box sx={{ height: 240, display: 'grid', placeItems: 'center', bgcolor: '#f8fafc', borderRadius: 2, p: 2, textAlign: 'center' }}>
          <Typography sx={{ color: MUTED }}>No cost-centre budgets set yet. Give cost centres a budget to compare spending against it here.</Typography>
        </Box>
      ) : (
        <Stack gap={1.4}>
          {rows.map((r) => {
            const used = r.budget > 0 ? Math.round((r.actual / r.budget) * 100) : null;
            const over = r.budget > 0 && r.actual > r.budget;
            return (
              <Box key={r._id}>
                <Stack direction="row" justifyContent="space-between" gap={1}>
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: INK }}>{r.name}{r.department ? ` · ${r.department}` : ''}</Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, color: over ? '#dc2626' : INK, whiteSpace: 'nowrap' }}>
                    {used === null ? 'No budget' : `${used}%`}
                  </Typography>
                </Stack>
                <Box sx={{ mt: 0.5, height: 8, borderRadius: 4, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${Math.min(100, used ?? 100)}%`, bgcolor: over ? '#dc2626' : used !== null && used > 85 ? '#f59e0b' : '#0f766e', borderRadius: 4 }} />
                </Box>
                <Typography sx={{ fontSize: 11, color: MUTED, mt: 0.25 }}>
                  {compact(r.actual)} of {compact(r.budget)}{over ? ` · ${compact(r.actual - r.budget)} over` : ''}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      )}
    </Panel>
  );
};

/** Spreadsheet (CSV) of everything on the overview, for meetings and email */
const exportOverview = ({ data, budget, ar, ap, companyName, periodLabel }) => {
  const rows = [];
  const add = (...cells) => rows.push(cells);
  const p = data?.pl?.current || {};
  const pr = data?.pl?.previous || {};
  add('Finance dashboard', companyName || '', periodLabel || '');
  add('Period', data?.period ? `${new Date(data.period.fromDate).toISOString().slice(0, 10)} to ${new Date(data.period.toDate).toISOString().slice(0, 10)}` : '');
  add('');
  add('Figure', 'This period', 'Previous period');
  add('Revenue', p.revenue, pr.revenue);
  add('Expenses', p.expenses, pr.expenses);
  add('Net profit', p.netProfit, pr.netProfit);
  add('Margin %', p.margin ?? '', pr.margin ?? '');
  add('Cash & bank (today)', data?.cash?.total, data?.cash?.previousMonthEnd);
  add('Receivables outstanding', ar?.total ?? '');
  add('Receivables past due', ar?.overdue ?? '');
  add('Payables outstanding', ap?.total ?? '');
  add('Payables past due', ap?.overdue ?? '');
  add('');
  add('Month', 'Revenue', 'Expenses', 'Net profit', 'Cash in', 'Cash out', 'Closing cash');
  (data?.monthly || []).forEach((m, i) => {
    const c = data.cash?.trend?.[i] || {};
    add(m.label, m.revenue, m.expenses, m.netProfit, c.cashIn ?? '', c.cashOut ?? '', c.balance ?? '');
  });
  add('');
  add('Bank / cash account', 'Account number', 'Balance');
  (data?.cash?.accounts || []).forEach((a) => add(a.name, a.accountNumber || '', a.balance));
  add('');
  add('Expense account', 'Category', 'Amount');
  (data?.expenses || []).forEach((e) => add(e.name, e.category, e.amount));
  if (budget?.rows?.length) {
    add('');
    add('Cost centre', 'Budget', 'Actual', 'Variance');
    budget.rows.forEach((r) => add(r.name, r.budget, r.actual, r.variance));
  }
  const cell = (v) => {
    const str = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = rows.map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `finance-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Top of the Finance dashboard: period picker, headline KPIs, 12-month revenue / expense / profit
 * trend and cash by bank — all for the finance company selected in the app.
 * ar / ap: { total, overdue } from the ageing reports the dashboard already loads.
 */
export default function FinanceOverview({ ar, ap, companyName, reloadKey }) {
  const navigate = useNavigate();
  const [preset, setPreset] = useState(() => {
    try { return localStorage.getItem('finance-dash-period') || 'month'; } catch { return 'month'; }
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [budget, setBudget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = rangeFor(preset);
      const [res, bva] = await Promise.all([
        api.get('/finance/dashboard/overview', { params: range }),
        api.get('/finance/reports/budget-vs-actual', { params: range }).catch(() => null)
      ]);
      setData(res.data?.data || null);
      setBudget(bva?.data?.data || { rows: [] });
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the finance overview');
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const pick = (v) => {
    if (!v) return;
    setPreset(v);
    try { localStorage.setItem('finance-dash-period', v); } catch { /* not remembered */ }
  };

  const cur = data?.pl?.current;
  const prev = data?.pl?.previous;
  const monthly = data?.monthly || [];
  const cash = data?.cash;
  const hasTrend = monthly.some((m) => m.revenue || m.expenses);
  const periodLabel = PERIODS.find((p) => p.value === preset)?.label;

  const banks = useMemo(() => (cash?.accounts || []).filter((a) => Math.abs(a.balance) > 0.005 || a.kind === 'Bank'), [cash]);
  const maxBank = Math.max(1, ...banks.map((b) => Math.abs(b.balance)));

  return (
    <Box sx={{ mb: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={1.5} sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 800, color: INK, fontSize: 17 }}>
            Overview{companyName ? ` — ${companyName}` : ''}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: MUTED }}>
            From posted journals · {periodLabel?.toLowerCase()}
            {data?.period && ` (${new Date(data.period.fromDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${new Date(data.period.toDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })})`}
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}>
          <ToggleButtonGroup
            exclusive size="small" value={preset} onChange={(_, v) => pick(v)}
            sx={{ bgcolor: '#fff', flexWrap: 'wrap', '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 1.5, fontSize: 12.5 } }}
          >
            {PERIODS.map((p) => <ToggleButton key={p.value} value={p.value}>{p.label}</ToggleButton>)}
          </ToggleButtonGroup>
          <Button
            size="small" variant="outlined" startIcon={<DownloadIcon />} disabled={!data}
            onClick={() => exportOverview({ data, budget, ar, ap, companyName, periodLabel })}
            sx={{ textTransform: 'none', fontWeight: 700, bgcolor: '#fff', whiteSpace: 'nowrap' }}
          >
            Export
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1, borderRadius: 1 }} />}

      {/* Headline KPIs */}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', xl: 'repeat(6, 1fr)' }, mb: 2 }}>
        <Kpi
          title="Cash & bank" value={cash?.total} color={C.cash} loading={!data}
          note={`${banks.length} account${banks.length === 1 ? '' : 's'} · today`}
          delta={cash ? change(cash.total, cash.previousMonthEnd) : undefined}
          spark={cash?.trend} sparkKey="balance"
          onClick={() => navigate('/finance/bank-reconciliation')}
        />
        <Kpi
          title="Revenue" value={cur?.revenue} color={C.revenue} loading={!data}
          delta={cur ? change(cur.revenue, prev?.revenue) : undefined}
          spark={monthly} sparkKey="revenue"
          onClick={() => navigate('/finance/profit-loss')}
        />
        <Kpi
          title="Expenses" value={cur?.expenses} color={C.expenses} loading={!data} goodWhenUp={false}
          delta={cur ? change(cur.expenses, prev?.expenses) : undefined}
          spark={monthly} sparkKey="expenses"
          onClick={() => navigate('/finance/profit-loss')}
        />
        <Kpi
          title="Net profit" value={cur?.netProfit} color={cur && cur.netProfit < 0 ? '#dc2626' : C.profit} loading={!data}
          note={cur?.margin !== null && cur?.margin !== undefined ? `${cur.margin}% margin` : 'No revenue in period'}
          delta={cur ? change(cur.netProfit, prev?.netProfit) : undefined}
          spark={monthly} sparkKey="netProfit"
          onClick={() => navigate('/finance/profit-loss')}
        />
        <Kpi
          title="Receivables" value={ar?.total} color={C.ar} loading={!ar}
          note={ar?.overdue > 0 ? `${compact(ar.overdue)} past due date` : 'Nothing overdue'}
          onClick={() => navigate('/finance/aged-receivables')}
        />
        <Kpi
          title="Payables" value={ap?.total} color={C.ap} loading={!ap}
          note={ap?.overdue > 0 ? `${compact(ap.overdue)} past due date` : 'Nothing overdue'}
          onClick={() => navigate('/finance/aged-payables')}
        />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' } }}>
        {/* 12-month trend */}
        <Panel
          title="Revenue, expenses & profit"
          subtitle="Last 12 months, from posted journals"
          action={<Chip size="small" label="Profit & loss" onClick={() => navigate('/finance/profit-loss')} sx={{ fontWeight: 700 }} />}
        >
          {!data ? <Skeleton variant="rounded" height={280} /> : !hasTrend ? (
            <Box sx={{ height: 280, display: 'grid', placeItems: 'center', bgcolor: '#f8fafc', borderRadius: 2 }}>
              <Typography sx={{ color: MUTED }}>No revenue or expenses posted in the last 12 months.</Typography>
            </Box>
          ) : (
            <Box sx={{ height: 280 }}>
              <ResponsiveContainer>
                <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={LINE} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={axisShort} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} width={48} />
                  <RTooltip content={<TrendTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="Revenue" fill={C.revenue} radius={[6, 6, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="expenses" name="Expenses" fill={C.expenses} radius={[6, 6, 0, 0]} maxBarSize={26} />
                  <Line type="monotone" dataKey="netProfit" name="Net profit" stroke={C.profit} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Panel>

        {/* Cash by bank */}
        <Panel
          title="Cash & bank"
          subtitle={cash ? `Total ${full(cash.total)}` : 'Balances from the general ledger'}
          action={<Chip size="small" label="Reconcile" onClick={() => navigate('/finance/bank-reconciliation')} sx={{ fontWeight: 700 }} />}
        >
          {!data ? <Skeleton variant="rounded" height={280} /> : !banks.length ? (
            <Box sx={{ height: 280, display: 'grid', placeItems: 'center', bgcolor: '#f8fafc', borderRadius: 2, textAlign: 'center', p: 2 }}>
              <Typography sx={{ color: MUTED }}>No bank or cash accounts on this company's chart of accounts.</Typography>
            </Box>
          ) : (
            <Stack gap={1.25} sx={{ maxHeight: 290, overflowY: 'auto', pr: 0.5 }}>
              {banks.map((b) => (
                <Box key={b._id}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                    <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
                      {b.kind === 'Bank' ? <BankIcon sx={{ fontSize: 18, color: C.cash }} /> : <CashIcon sx={{ fontSize: 18, color: '#0f766e' }} />}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: INK }}>{b.name}</Typography>
                        {b.accountNumber && <Typography sx={{ fontSize: 11, color: MUTED }}>{b.accountNumber}</Typography>}
                      </Box>
                    </Stack>
                    <Tooltip title={full(b.balance)}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: b.balance < 0 ? '#dc2626' : INK, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {compact(b.balance)}
                      </Typography>
                    </Tooltip>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, (Math.abs(b.balance) / maxBank) * 100)}
                    sx={{ mt: 0.6, height: 6, borderRadius: 3, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: b.balance < 0 ? '#dc2626' : C.cash, borderRadius: 3 } }}
                  />
                </Box>
              ))}
            </Stack>
          )}
        </Panel>
      </Box>

      {/* Spending, cash movement, budgets */}
      <Box sx={{ display: 'grid', gap: 2, mt: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' } }}>
        <SpendingPanel rows={data?.expenses || []} total={cur?.expenses || 0} loading={!data} onOpen={() => navigate('/finance/profit-loss')} />
        <CashFlowPanel trend={cash?.trend} loading={!data} onOpen={() => navigate('/finance/banking')} />
        <BudgetPanel data={budget} loading={!budget} onOpen={() => navigate('/finance/budget-vs-actual')} />
      </Box>
    </Box>
  );
}
