import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Grid,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
  FactCheck as CheckIcon
} from '@mui/icons-material';
import { format as formatDateFns, subMonths } from 'date-fns';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis
} from 'recharts';
import { fetchReceivableRollForward } from '../../../services/propertyInvoiceService';
import { fetchDepositCollections } from '../../../services/tajResidentsService';

const PRIMARY_BLUE = '#1565C0';
const DEEP_BLUE = '#0D47A1';
const GREEN = '#2E7D32';
const ORANGE = '#EF6C00';
const BORDER = '1px solid #e0e0e0';
const TIMEZONE = 'Asia/Karachi';

const CHARGE_LABELS = {
  ELECTRICITY: 'Electricity',
  CAM: 'CAM',
  RENT: 'Rent',
  WATER: 'Water',
  GROUND: 'Ground Booking',
  OTHER: 'Other'
};
const FILTERS = ['ELECTRICITY', 'CAM', 'RENT', 'WATER', 'GROUND', 'OTHER'];

/** Accountant style: 1,234,567 and negatives in brackets. */
const money = (value) => {
  const n = Math.round(Number(value) || 0);
  const s = Math.abs(n).toLocaleString('en-PK');
  return n < 0 ? `(${s})` : s;
};

const compact = (value) => {
  const n = Number(value) || 0;
  const v = Math.abs(n);
  let s;
  if (v >= 1_000_000) s = `${(v / 1_000_000).toFixed(2)}M`;
  else if (v >= 1_000) s = `${(v / 1_000).toFixed(1)}K`;
  else s = Math.round(v).toLocaleString('en-PK');
  return n < 0 ? `(${s})` : s;
};

/** Received ÷ billed. Above 500% (a month with almost no new bills) is shown as "> 500%". */
const percent = (num, den) => {
  if (!(den > 0)) return '—';
  const p = Math.round((num / den) * 100);
  return p > 500 ? '> 500%' : `${p}%`;
};

/** Full figure under a card only when the card shows a shortened one (K / M). */
const fullIfShortened = (value) => (Math.abs(Number(value) || 0) >= 1000 ? `Rs ${money(value)}` : '');

/** Financial year starts in July. */
const financialYearStart = (date = new Date()) => {
  const y = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${y}-07`;
};

const GO_LIVE_MONTH = '2025-12';

const PRESETS = [
  { id: 'month', label: 'This month', range: () => [formatDateFns(new Date(), 'yyyy-MM'), formatDateFns(new Date(), 'yyyy-MM')] },
  { id: '3m', label: 'Last 3 months', range: () => [formatDateFns(subMonths(new Date(), 2), 'yyyy-MM'), formatDateFns(new Date(), 'yyyy-MM')] },
  { id: 'fy', label: 'Financial year to date', range: () => [financialYearStart(), formatDateFns(new Date(), 'yyyy-MM')] },
  { id: 'all', label: 'Since go-live', range: () => [GO_LIVE_MONTH, formatDateFns(new Date(), 'yyyy-MM')] }
];

/** Split a month's used deposits by the bill month they paid: this month, last month, older, later. */
const splitUsedByBillMonth = (usedByBillMonth = {}, monthKey) => {
  const [year, month] = String(monthKey).split('-').map(Number);
  const prevKey = formatDateFns(new Date(year, month - 2, 1), 'yyyy-MM');
  const parts = { current: 0, previous: 0, older: 0, later: 0 };
  Object.entries(usedByBillMonth).forEach(([billMonth, amount]) => {
    const value = Number(amount) || 0;
    if (billMonth === monthKey) parts.current += value;
    else if (billMonth === prevKey) parts.previous += value;
    else if (billMonth > monthKey && billMonth !== 'unknown') parts.later += value;
    else parts.older += value;
  });
  return { ...parts, prevKey };
};

const monthName = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return formatDateFns(new Date(y, m - 1, 1), 'MMM yyyy');
};

const KpiCard = ({ title, value, sub, color = PRIMARY_BLUE, loading, hint }) => (
  <Paper elevation={0} sx={{ p: 1.5, border: BORDER, bgcolor: '#fff', flex: '1 1 170px', minWidth: 160 }}>
    <Tooltip title={hint || ''} placement="top" arrow disableHoverListener={!hint}>
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', cursor: hint ? 'help' : 'default' }}>
        {title}
      </Typography>
    </Tooltip>
    {loading ? (
      <Skeleton width="70%" height={34} />
    ) : (
      <>
        <Typography variant="h6" fontWeight={700} sx={{ color, lineHeight: 1.3 }}>
          {value}
        </Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </>
    )}
  </Paper>
);

const numCell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const headCell = { fontWeight: 700, bgcolor: '#f5f7fa', whiteSpace: 'nowrap' };

const RollForwardHead = ({ first, showBroughtForward, extra = [] }) => (
  <TableHead>
    <TableRow>
      <TableCell sx={headCell}>{first}</TableCell>
      <TableCell sx={headCell} align="right">Opening</TableCell>
      {showBroughtForward && (
        <TableCell sx={headCell} align="right">
          <Tooltip title="Balances owed from before the system went live, taken from each property's first bill." arrow>
            <span>+ Brought<br />forward</span>
          </Tooltip>
        </TableCell>
      )}
      <TableCell sx={headCell} align="right">+ Billed</TableCell>
      <TableCell sx={headCell} align="right">
        <Tooltip title="Late-payment surcharge saved on bills, and any other amount on a bill beyond its own charges." arrow>
          <span>+ Surcharge<br />/ adj.</span>
        </Tooltip>
      </TableCell>
      <TableCell sx={headCell} align="right">− Received</TableCell>
      <TableCell sx={{ ...headCell, color: DEEP_BLUE }} align="right">= Closing</TableCell>
      {extra.map((e) => (
        <TableCell key={e} sx={headCell} align="right">{e}</TableCell>
      ))}
    </TableRow>
  </TableHead>
);

const RollForwardCells = ({ r, showBroughtForward, bold }) => {
  const sx = { ...numCell, fontWeight: bold ? 700 : 400 };
  return (
    <>
      <TableCell align="right" sx={sx}>{money(r.opening)}</TableCell>
      {showBroughtForward && <TableCell align="right" sx={sx}>{money(r.broughtForward)}</TableCell>}
      <TableCell align="right" sx={sx}>{money(r.billed)}</TableCell>
      <TableCell align="right" sx={sx}>{money(r.adjustments)}</TableCell>
      <TableCell align="right" sx={{ ...sx, color: GREEN }}>{money(r.received)}</TableCell>
      <TableCell align="right" sx={{ ...sx, fontWeight: 700, color: DEEP_BLUE }}>{money(r.closing)}</TableCell>
    </>
  );
};

const MonthRow = ({ m, showBroughtForward, cash }) => {
  const [open, setOpen] = useState(false);
  const t = m.totals;
  const bankTotal = m.bank?.bankTotal || 0;
  const used = cash ? splitUsedByBillMonth(cash.usedByBillMonth, m.month) : null;
  const usedParts = used
    ? [
        { label: `${m.monthLabel} bills`, value: used.current },
        { label: `${monthName(used.prevKey)} bills`, value: used.previous },
        { label: 'older bills', value: used.older },
        { label: 'later bills', value: used.later },
        { label: 'not linked to a bill', value: cash.usedNotLinked }
      ].filter((p) => Math.round(p.value) !== 0)
    : [];
  // Month + roll-forward columns + Bank deposits + Collection
  const colSpan = 1 + (showBroughtForward ? 6 : 5) + 2;

  return (
    <>
      <TableRow hover sx={{ '& > td': { borderBottom: open ? 'none' : undefined }, cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
          <IconButton size="small" sx={{ mr: 0.5 }} aria-label={open ? 'Hide details' : 'Show details'}>
            {open ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
          </IconButton>
          {m.monthLabel}
        </TableCell>
        <RollForwardCells r={t} showBroughtForward={showBroughtForward} />
        <TableCell align="right" sx={numCell}>{money(bankTotal)}</TableCell>
        <TableCell align="right" sx={numCell}>{percent(t.received, t.billed + t.adjustments)}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={colSpan} sx={{ p: 0, bgcolor: '#fbfcfe' }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700} color={PRIMARY_BLUE} sx={{ mb: 0.5 }}>
                {m.monthLabel} by charge type
              </Typography>
              <Table size="small">
                <RollForwardHead first="Charge type" showBroughtForward={showBroughtForward} extra={['Bills']} />
                <TableBody>
                  {m.rows.map((r) => (
                    <TableRow key={r.chargeType}>
                      <TableCell>{CHARGE_LABELS[r.chargeType] || r.chargeType}</TableCell>
                      <RollForwardCells r={r} showBroughtForward={showBroughtForward} />
                      <TableCell align="right" sx={numCell}>{r.invoiceCount.toLocaleString('en-PK')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mt: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block' }}>
                    Bank in {m.monthLabel} (same as Deposits page)
                  </Typography>
                  <Typography variant="body2">
                    Deposits {money(m.bank?.deposits)} + Suspense {money(m.bank?.suspense)} = <b>{money(bankTotal)}</b>
                  </Typography>
                </Box>
                {usedParts.length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block' }}>
                      Deposits of {m.monthLabel} applied to
                    </Typography>
                    <Typography variant="body2">
                      {usedParts.map((p) => `${p.label} ${money(p.value)}`).join(' · ')}
                    </Typography>
                  </Box>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Received counts payments recorded on bills by payment date; the bank figure counts deposits by deposit date,
                so the two differ slightly when a deposit is applied to bills in a later month.
              </Typography>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

const LedgerCheck = ({ check, loading, onRun }) => {
  if (!check?.residentLedgerTotal && check?.residentLedgerTotal !== 0) {
    return (
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          Compare today's receivable with the total of all Resident Ledgers. This reads every bill, so it takes a little longer.
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={onRun}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : <CheckIcon />}
          sx={{ borderColor: PRIMARY_BLUE, color: PRIMARY_BLUE, whiteSpace: 'nowrap' }}
        >
          Run ledger check
        </Button>
      </Stack>
    );
  }
  return (
    <Box>
      <Table size="small" sx={{ maxWidth: 620 }}>
        <TableBody>
          <TableRow>
            <TableCell>Receivable today (this page)</TableCell>
            <TableCell align="right" sx={numCell}>{money(check.receivableAsOfToday)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Total of all Resident Ledgers</TableCell>
            <TableCell align="right" sx={numCell}>{money(check.residentLedgerTotal)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Difference (ledgers − this page)</TableCell>
            <TableCell align="right" sx={{ ...numCell, fontWeight: 700 }}>{money(check.difference)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        Known reasons the two differ, until they are fixed in the Resident Ledger:
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          <li>
            The ledgers add a 10% late-payment surcharge on overdue unpaid bills that is not saved on any bill
            (up to {money(check.ledgerLatePaymentSurchargeNotOnBills)} today). This page counts only what is on the bills.
          </li>
          <li>
            For properties with more than one electricity meter, the ledgers keep the opening arrears of only one meter;
            this page counts every meter.
          </li>
        </Box>
        Adding up the balance stored on every bill would give {money(check.storedInvoiceBalanceSum)}. That counts the same unpaid
        amount again on every later bill (as arrears), so it is not used.
      </Typography>
    </Box>
  );
};

const ReceivablesView = () => {
  const [startMonth, setStartMonth] = useState(() => formatDateFns(subMonths(new Date(), 2), 'yyyy-MM'));
  const [endMonth, setEndMonth] = useState(() => formatDateFns(new Date(), 'yyyy-MM'));
  const [chargeFilter, setChargeFilter] = useState([]);
  const [data, setData] = useState(null);
  const [cashByMonth, setCashByMonth] = useState({});
  const [loading, setLoading] = useState(true);
  const [checkLoading, setCheckLoading] = useState(false);
  const [error, setError] = useState('');

  const chargeTypes = useMemo(() => [...chargeFilter].sort().join(','), [chargeFilter]);
  const validRange = /^\d{4}-\d{2}$/.test(startMonth) && /^\d{4}-\d{2}$/.test(endMonth);

  const load = useCallback(
    async ({ refresh = false, ledgerCheck = false } = {}) => {
      if (!validRange) return;
      if (ledgerCheck) setCheckLoading(true);
      else setLoading(true);
      setError('');
      try {
        const params = {
          startMonth,
          endMonth,
          timezone: TIMEZONE,
          ...(chargeTypes ? { chargeTypes } : {}),
          ...(refresh ? { refresh: 'true' } : {}),
          ...(ledgerCheck ? { ledgerCheck: 'true' } : {})
        };
        const [rf, cash] = await Promise.all([
          fetchReceivableRollForward(params),
          ledgerCheck
            ? Promise.resolve(null)
            : fetchDepositCollections({ startMonth, endMonth, timezone: TIMEZONE }).catch(() => null)
        ]);
        setData(rf.data?.data || null);
        if (cash) setCashByMonth(cash.data?.data?.months || {});
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load receivables');
      } finally {
        setLoading(false);
        setCheckLoading(false);
      }
    },
    [startMonth, endMonth, chargeTypes, validRange]
  );

  useEffect(() => {
    load();
  }, [load]);

  const activePreset = PRESETS.find((p) => {
    const [s, e] = p.range();
    return s === startMonth && e === endMonth;
  })?.id;

  const range = data?.range;
  const t = range?.totals;
  const showBroughtForward = !!data && (Math.round(t?.broughtForward || 0) !== 0 || (data.months || []).some((m) => Math.round(m.totals.broughtForward) !== 0));
  const bankTotal = (data?.months || []).reduce((s, m) => s + (m.bank?.bankTotal || 0), 0);
  const firstLabel = data?.months?.[0]?.monthLabel;
  const lastLabel = data?.months?.[data.months.length - 1]?.monthLabel;
  const rangeLabel = firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`;

  const chartData = (data?.months || []).map((m) => ({
    month: m.monthLabel,
    Billed: Math.round(m.totals.billed + m.totals.adjustments),
    Received: Math.round(m.totals.received),
    'Closing receivable': Math.round(m.totals.closing)
  }));
  // More than 6 months: slimmer bars and fewer month labels so the chart stays readable beside the table
  const longRange = chartData.length > 6;

  return (
    <Box>
      {/* Filters */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, border: BORDER, bgcolor: '#fff' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label="From month"
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{ width: 165 }}
            />
            <TextField
              label="To month"
              type="month"
              value={endMonth}
              onChange={(e) => setEndMonth(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{ width: 165 }}
            />
          </Stack>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {PRESETS.map((p) => (
              <Chip
                key={p.id}
                label={p.label}
                size="small"
                clickable
                color={activePreset === p.id ? 'primary' : 'default'}
                variant={activePreset === p.id ? 'filled' : 'outlined'}
                onClick={() => {
                  const [s, e] = p.range();
                  setStartMonth(s);
                  setEndMonth(e);
                }}
              />
            ))}
          </Stack>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            size="small"
            startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={() => load({ refresh: true })}
            disabled={loading}
            sx={{ borderColor: PRIMARY_BLUE, color: PRIMARY_BLUE }}
          >
            Refresh
          </Button>
        </Stack>
        <ToggleButtonGroup
          value={chargeFilter}
          onChange={(_e, v) => setChargeFilter(v || [])}
          size="small"
          sx={{
            mt: 1.5,
            flexWrap: 'wrap',
            gap: 0.5,
            '& .MuiToggleButton-root': {
              px: 1.75,
              py: 0.5,
              fontWeight: 600,
              fontSize: '0.75rem',
              border: `1px solid ${PRIMARY_BLUE}40`,
              '&.Mui-selected': { bgcolor: PRIMARY_BLUE, color: '#fff', '&:hover': { bgcolor: DEEP_BLUE } }
            }
          }}
        >
          {FILTERS.map((f) => (
            <ToggleButton key={f} value={f}>
              {CHARGE_LABELS[f]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          {chargeFilter.length ? 'Showing selected charge types only.' : 'All charge types. Select one or more to narrow every figure on this page.'}
        </Typography>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {!validRange && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Choose both a From and a To month.
        </Alert>
      )}

      {/* KPI cards */}
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5} sx={{ mb: 1 }}>
        <KpiCard
          loading={loading}
          title={`Opening receivable${firstLabel ? ` · 1 ${firstLabel}` : ''}`}
          value={`Rs ${compact(t?.opening)}`}
          sub={t ? fullIfShortened(t.opening) : ''}
          color="#424242"
          hint="What residents owed at the start of the first month in the range."
        />
        <KpiCard
          loading={loading}
          title="Billed in period"
          value={`Rs ${compact((t?.billed || 0) + (t?.adjustments || 0))}`}
          sub={t ? `Charges ${money(t.billed)} · Surcharge/adj. ${money(t.adjustments)}${Math.round(t.broughtForward) ? ` (+ brought forward ${money(t.broughtForward)}, not billing)` : ''}` : ''}
          hint="This period's own charges plus surcharge. Arrears carried on bills and balances brought forward from before go-live are not billing, so they are not included."
        />
        <KpiCard
          loading={loading}
          title="Received on bills"
          value={`Rs ${compact(t?.received)}`}
          sub={t ? `Rs ${money(t.received)} · Bank ${money(bankTotal)}` : ''}
          color={GREEN}
          hint="Payments recorded on bills, by payment date. Bank = deposits + suspense on the Deposits page for the same months."
        />
        <KpiCard
          loading={loading}
          title="Collection rate"
          value={t ? percent(t.received, t.billed + t.adjustments) : '—'}
          sub="Received ÷ billed in period"
          color={GREEN}
          hint="Above 100% means more arrears were recovered than new bills were raised."
        />
        <KpiCard
          loading={loading}
          title={`Closing receivable${lastLabel ? ` · end ${lastLabel}` : ''}`}
          value={`Rs ${compact(t?.closing)}`}
          sub={t ? fullIfShortened(t.closing) : ''}
          color={DEEP_BLUE}
          hint="Opening + brought forward + billed + surcharge − received."
        />
      </Stack>
      {t && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {rangeLabel}: Opening {money(t.opening)}
          {showBroughtForward ? ` + Brought forward ${money(t.broughtForward)}` : ''} + Billed {money(t.billed)} + Surcharge/adj.{' '}
          {money(t.adjustments)} − Received {money(t.received)} = Closing {money(t.closing)}
        </Typography>
      )}

      {/* Range roll-forward by charge type (left) + billed vs received chart (right); stacked on smaller screens */}
      <Grid container spacing={2} sx={{ mb: 2 }} alignItems="stretch">
        <Grid item xs={12} lg={8}>
          <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', height: '100%' }}>
            <Box sx={{ px: 2, py: 1.25, borderBottom: BORDER, bgcolor: '#f5f5f5' }}>
              <Typography fontWeight={700} color={PRIMARY_BLUE}>
                Receivable roll-forward{rangeLabel ? ` — ${rangeLabel}` : ''}
              </Typography>
            </Box>
            {loading ? (
              <Box sx={{ p: 2 }}>
                <Skeleton variant="rectangular" height={220} />
              </Box>
            ) : range ? (
              <TableContainer>
                {/* Tighter side padding so Received and Closing stay visible beside the chart */}
                <Table size="small" sx={{ '& .MuiTableCell-root': { px: 1, fontSize: '0.8125rem' }, '& .MuiTableCell-root:first-of-type': { pl: 2 }, '& .MuiTableCell-root:last-of-type': { pr: 2 } }}>
                  <RollForwardHead first="Charge type" showBroughtForward={showBroughtForward} />
                  <TableBody>
                    {range.rows.map((r) => (
                      <TableRow key={r.chargeType} hover>
                        <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{CHARGE_LABELS[r.chargeType] || r.chargeType}</TableCell>
                        <RollForwardCells r={r} showBroughtForward={showBroughtForward} />
                      </TableRow>
                    ))}
                    <TableRow sx={{ bgcolor: '#eef3fb' }}>
                      <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                      <RollForwardCells r={t} showBroughtForward={showBroughtForward} bold />
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            ) : null}
          </Paper>
        </Grid>
        <Grid item xs={12} lg={4}>
          <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ px: 2, py: 1.25, borderBottom: BORDER, bgcolor: '#f5f5f5' }}>
              <Typography fontWeight={700} color={PRIMARY_BLUE}>
                Billed vs received, with closing receivable
              </Typography>
            </Box>
            {loading ? (
              <Box sx={{ p: 2 }}>
                <Skeleton variant="rectangular" height={220} />
              </Box>
            ) : chartData.length > 0 ? (
              <Box sx={{ p: 1.5, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 280 }}>
                <Box sx={{ flex: 1, minHeight: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={longRange ? 1 : 3}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11 }}
                        interval={longRange ? 'preserveStartEnd' : 0}
                        minTickGap={8}
                        tickFormatter={longRange ? (v) => String(v).replace(/ (\d{2})(\d{2})$/, " '$2") : undefined}
                      />
                      <YAxis yAxisId="flow" tickFormatter={compact} tick={{ fontSize: 10 }} width={48} />
                      <YAxis yAxisId="bal" orientation="right" tickFormatter={compact} tick={{ fontSize: 10 }} width={48} />
                      <RTooltip formatter={(v) => `Rs ${money(v)}`} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar yAxisId="flow" dataKey="Billed" fill={PRIMARY_BLUE} radius={[3, 3, 0, 0]} maxBarSize={longRange ? 14 : 30} />
                      <Bar yAxisId="flow" dataKey="Received" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={longRange ? 14 : 30} />
                      <Line yAxisId="bal" type="monotone" dataKey="Closing receivable" stroke={ORANGE} strokeWidth={2.5} dot={{ r: longRange ? 2 : 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Bars: left axis (billed includes surcharge). Line: right axis.
                </Typography>
              </Box>
            ) : null}
          </Paper>
        </Grid>
      </Grid>

      {/* Month by month */}
      <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', mb: 2 }}>
        <Box sx={{ px: 2, py: 1.25, borderBottom: BORDER, bgcolor: '#f5f5f5' }}>
          <Typography fontWeight={700} color={PRIMARY_BLUE}>
            Month by month
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Each month's closing is the next month's opening. Click a month for the charge-type split and the bank detail.
          </Typography>
        </Box>
        {loading ? (
          <Box sx={{ p: 2 }}>
            <Skeleton variant="rectangular" height={160} />
          </Box>
        ) : data ? (
          <TableContainer>
            <Table size="small">
              <RollForwardHead first="Month" showBroughtForward={showBroughtForward} extra={['Bank deposits', 'Collection']} />
              <TableBody>
                {data.months.map((m) => (
                  <MonthRow key={m.month} m={m} showBroughtForward={showBroughtForward} cash={cashByMonth[m.month]} />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}
      </Paper>

      {/* Ledger check */}
      {data && (
        <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', p: 2, mb: 2 }}>
          <Typography fontWeight={700} color={PRIMARY_BLUE} sx={{ mb: 1 }}>
            Check against Resident Ledgers
          </Typography>
          <LedgerCheck check={data.check} loading={checkLoading} onRun={() => load({ ledgerCheck: true })} />
        </Paper>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        How these figures are built: Billed is each bill's own charges in its billing month; arrears printed on a bill are a copy of
        earlier unpaid bills and are not added again. Received is payments recorded on bills, by payment date ({TIMEZONE}).
        Brought forward is what residents owed before the system went live.
        {data?.generatedAt ? ` Updated ${formatDateFns(new Date(data.generatedAt), 'd MMM yyyy, h:mm a')}.` : ''}
      </Typography>
    </Box>
  );
};

export default ReceivablesView;
