import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  Grid,
  Typography,
  CircularProgress,
  Alert,
  Stack,
  Skeleton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip as MuiTooltip,
  Tabs,
  Tab
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { subMonths, format as formatDateFns } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import {
  fetchAllInvoices,
  fetchReports,
  fetchReportsOpenInvoiceBucket,
  fetchDashboardResidentsOutstanding
} from '../../../services/propertyInvoiceService';
import { fetchProperties as fetchTajProperties } from '../../../services/tajPropertiesService';
import { fetchResidents } from '../../../services/tajResidentsService';
import { fetchProperties as fetchRentalProperties } from '../../../services/tajRentalManagementService';
import { fetchAllDeposits, fetchDepositCollections } from '../../../services/tajResidentsService';

const PRIMARY_BLUE = '#1565C0';
const LIGHT_BLUE = '#64B5F6';
const DEEP_BLUE = '#0D47A1';
const ORANGE = '#FF9800';
const BORDER = '1px solid #e0e0e0';

/** Compact money like 12M, 34.70M */
const formatCompactMoney = (value) => {
  const v = Math.abs(Number(value) || 0);
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    const s = m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2);
    return `${s.replace(/\.?0+$/, '')}M`;
  }
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`.replace(/\.00K$/, 'K');
  return Math.round(v).toLocaleString('en-PK');
};

const formatTableNumber = (value) =>
  Math.round(Number(value) || 0).toLocaleString('en-PK');

const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatMonthKey = (monthKey) => {
  const [year, month] = String(monthKey).split('-').map(Number);
  if (!year || !month) return String(monthKey);
  return formatDateFns(new Date(year, month - 1, 1), 'MMM yyyy');
};

/** Where a month's used deposits went: this month's bills, last month's bills, and everything older. */
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

const CHART_BLUE = LIGHT_BLUE;
const CHART_BLUE_DARK = DEEP_BLUE;

const FILTER_DEFS = [
  { id: 'CAM', label: 'CAM' },
  { id: 'ELECTRICITY', label: 'ELECTRICITY' },
  { id: 'GROUND', label: 'GROUND BOOKING' },
  { id: 'OTHER', label: 'OTHER' },
  { id: 'RENT', label: 'RENT' },
  { id: 'WATER', label: 'WATER' }
];

/** Map report totals into charge-row shape; Paid = Payments Received (sum of invoice totalPaid), same as Taj Utilities Reports. */
const statsFromReportData = (reportData) => {
  const totals = reportData?.totals || {};
  const invoiced = Number(totals.invoiceAmount || 0);
  const arrears = Number(totals.arrears || 0);
  const total = invoiced + arrears;
  const paymentsReceived = Math.max(0, Number(totals.paymentsReceived || 0));
  const balances = Math.max(0, total - paymentsReceived);
  return {
    totalProperties: Number(totals.invoiceCount || 0),
    totalAmount: invoiced,
    totalArrears: arrears,
    totalAmountAllPages: invoiced,
    totalArrearsAllPages: balances,
    paymentsReceived
  };
};

const KpiCard = ({ title, value, loading }) => (
  <Paper
    elevation={0}
    sx={{
      p: 2,
      height: '100%',
      border: BORDER,
      borderRadius: 1,
      bgcolor: '#fff'
    }}
  >
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.3 }}>
      {title}
    </Typography>
    {loading ? (
      <Skeleton variant="text" width="70%" height={40} sx={{ mt: 0.5 }} />
    ) : (
      <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 700, color: PRIMARY_BLUE }}>
        {value}
      </Typography>
    )}
  </Paper>
);

const CashFigure = ({ label, value, strong }) => (
  <Box sx={{ flex: '1 1 150px', minWidth: 140 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
      {label}
    </Typography>
    <Typography variant="body1" sx={{ fontWeight: strong ? 700 : 600, color: strong ? PRIMARY_BLUE : 'text.primary' }}>
      Rs {formatTableNumber(value)}
    </Typography>
  </Box>
);

/** Same five figures as the Deposits page month cards, plus where the used amount went. */
const CashReceivedPanel = ({ monthKey, monthLabel, cash }) => {
  if (!cash) {
    return (
      <Box sx={{ px: 2, py: 1.5, borderTop: BORDER }}>
        <Typography variant="body2" color="text.secondary">
          Cash received in {monthLabel}: no deposits recorded.
        </Typography>
      </Box>
    );
  }
  const split = splitUsedByBillMonth(cash.usedByBillMonth, monthKey);
  const usedParts = [
    { label: `${monthLabel} bills`, value: split.current },
    { label: `${formatMonthKey(split.prevKey)} bills`, value: split.previous },
    { label: 'older bills', value: split.older },
    { label: 'later bills', value: split.later },
    { label: 'not linked to a bill', value: cash.usedNotLinked }
  ].filter((part) => Math.round(part.value) !== 0);

  return (
    <Box sx={{ px: 2, py: 1.5, borderTop: BORDER, bgcolor: '#f8fbff' }}>
      <Typography variant="subtitle2" fontWeight={700} color={PRIMARY_BLUE} sx={{ mb: 1 }}>
        Cash received in {monthLabel} (matches the Deposits page for {monthLabel})
      </Typography>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
        <CashFigure label="Deposits" value={cash.depositAmount} />
        <CashFigure label="Suspense Account" value={cash.suspenseAmount} />
        <CashFigure label="Total Amount (Suspense + Deposits)" value={cash.totalAmount} strong />
        <CashFigure label="Used" value={cash.totalUsed} />
        <CashFigure label="Remaining" value={cash.totalRemaining} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Total {formatTableNumber(cash.totalAmount)} = Used {formatTableNumber(cash.totalUsed)} + Remaining {formatTableNumber(cash.totalRemaining)}
        {cash.suspenseRemaining > 0 ? ` (of which ${formatTableNumber(cash.suspenseRemaining)} is unapplied suspense)` : ''}.
      </Typography>
      {usedParts.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Used went to: {usedParts.map((part) => `${part.label} ${formatTableNumber(part.value)}`).join(' · ')}.
          The Collected column above splits this Used amount by charge type.
        </Typography>
      )}
    </Box>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startMonth, setStartMonth] = useState(() => formatDateFns(subMonths(new Date(), 2), 'yyyy-MM'));
  const [endMonth, setEndMonth] = useState(() => formatDateFns(new Date(), 'yyyy-MM'));
  /* Aliases for stale HMR bundles that still reference dateFrom/dateTo (same as month strings). */
  // eslint-disable-next-line no-unused-vars -- legacy name kept for hot-reload compatibility
  const dateFrom = startMonth;
  // eslint-disable-next-line no-unused-vars -- legacy name kept for hot-reload compatibility
  const dateTo = endMonth;
  const [chargeFilter, setChargeFilter] = useState(() => new Set());
  const chargeFilterKey = useMemo(() => [...chargeFilter].sort().join(','), [chargeFilter]);
  const [stats, setStats] = useState({
    cam: { totalProperties: 0, totalAmount: 0, totalArrears: 0, totalAmountAllPages: 0, totalArrearsAllPages: 0 },
    water: { totalProperties: 0, totalAmount: 0, totalArrears: 0, totalAmountAllPages: 0, totalArrearsAllPages: 0 },
    electricity: { totalProperties: 0, totalAmount: 0, totalArrears: 0, totalAmountAllPages: 0, totalArrearsAllPages: 0 },
    properties: 0,
    residents: 0,
    rentalProperties: 0,
    invoices: 0,
    openInvoices: 0,
    suspenseTotal: 0,
    suspenseRemaining: 0,
    topResidents: [],
    rentRollup: null,
    groundRollup: null,
    otherRollup: null,
    reconciliationByMonth: [],
    globalDepositSuspense: 0
  });

  const [activeMonthTab, setActiveMonthTab] = useState(0);
  const [monthlyChargeData, setMonthlyChargeData] = useState({});
  const [collectionsByMonth, setCollectionsByMonth] = useState({});
  const monthKeys = useMemo(() => Object.keys(monthlyChargeData).sort(), [monthlyChargeData]);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      let sm = startMonth || formatDateFns(subMonths(new Date(), 2), 'yyyy-MM');
      let em = endMonth || formatDateFns(new Date(), 'yyyy-MM');
      if (sm > em) [sm, em] = [em, sm];
      const reportParams = { startMonth: sm, endMonth: em };

      const [
        allReportRes,
        camReportRes,
        waterReportRes,
        electricityReportRes,
        rentReportRes,
        groundReportRes,
        otherReportRes,
        propertiesRes,
        residentsRes,
        rentalRes,
        suspenseRes,
        residentsByBalanceRes,
        collectionsRes
      ] = await Promise.all([
        fetchReports({ ...reportParams, chargeType: 'all' }).catch(() => ({ data: { data: { totals: {}, byMonth: [] } } })),
        fetchReports({ ...reportParams, chargeType: 'CAM' }).catch(() => ({ data: { data: { totals: {}, byMonth: [] } } })),
        fetchReports({ ...reportParams, chargeType: 'WATER' }).catch(() => ({ data: { data: { totals: {}, byMonth: [] } } })),
        fetchReports({ ...reportParams, chargeType: 'ELECTRICITY' }).catch(() => ({ data: { data: { totals: {}, byMonth: [] } } })),
        fetchReports({ ...reportParams, chargeType: 'RENT' }).catch(() => ({ data: { data: { totals: {}, byMonth: [] } } })),
        fetchReportsOpenInvoiceBucket({ ...reportParams, bucket: 'ground' }).catch(() => ({ data: { data: { totals: {}, byMonth: [] } } })),
        fetchReportsOpenInvoiceBucket({ ...reportParams, bucket: 'other' }).catch(() => ({ data: { data: { totals: {}, byMonth: [] } } })),
        fetchTajProperties({ page: 1, limit: 1 }),
        fetchResidents({ page: 1, limit: 1 }),
        fetchRentalProperties({ page: 1, limit: 1 }),
        fetchAllDeposits({ page: 1, limit: 10000, suspenseAccount: 'true' }).catch(() => ({ data: { data: { deposits: [] } } })),
        fetchDashboardResidentsOutstanding({
          limit: 12,
          ...(chargeFilterKey ? { chargeTypes: chargeFilterKey } : {})
        }).catch(() => ({ data: { data: [] } })),
        fetchDepositCollections({ startMonth: sm, endMonth: em, timezone: BROWSER_TIMEZONE }).catch(() => ({ data: { data: { months: {} } } }))
      ]);

      setCollectionsByMonth(collectionsRes.data?.data?.months || {});

      const allData = allReportRes.data?.data || {};
      const byMonthAll = allData.byMonth || [];

      // Extract month-by-month breakdowns for each charge type
      const extractMonthlyMap = (resData) => {
        const list = resData?.byMonth || [];
        const map = {};
        for (const item of list) {
          const key = item.month;
          const invoiced = Number(item.invoiceAmount || 0);
          const arrears = Number(item.arrears || 0);
          const total = invoiced + arrears;
          const paymentsReceived = Math.max(0, Number(item.paymentsReceived || 0));
          const balances = Math.max(0, total - paymentsReceived);
          map[key] = {
            totalProperties: Number(item.invoiceCount || 0),
            totalAmount: invoiced,
            totalArrears: arrears,
            paymentsReceived,
            balances,
            monthLabel: item.monthLabel || item.month
          };
        }
        return map;
      };

      const camMonthly = extractMonthlyMap(camReportRes.data?.data);
      const waterMonthly = extractMonthlyMap(waterReportRes.data?.data);
      const elecMonthly = extractMonthlyMap(electricityReportRes.data?.data);
      const rentMonthly = extractMonthlyMap(rentReportRes.data?.data);
      const groundMonthly = extractMonthlyMap(groundReportRes.data?.data);
      const otherMonthly = extractMonthlyMap(otherReportRes.data?.data);

      // Build month-keyed dictionary of charge stats
      const mDataDict = {};
      for (const mObj of byMonthAll) {
        const k = mObj.month;
        mDataDict[k] = {
          monthLabel: mObj.monthLabel || k,
          cam: camMonthly[k] || { totalProperties: 0, totalAmount: 0, totalArrears: 0, paymentsReceived: 0, balances: 0 },
          water: waterMonthly[k] || { totalProperties: 0, totalAmount: 0, totalArrears: 0, paymentsReceived: 0, balances: 0 },
          electricity: elecMonthly[k] || { totalProperties: 0, totalAmount: 0, totalArrears: 0, paymentsReceived: 0, balances: 0 },
          rentRollup: rentMonthly[k] || { totalProperties: 0, totalAmount: 0, totalArrears: 0, paymentsReceived: 0, balances: 0 },
          groundRollup: groundMonthly[k] || { totalProperties: 0, totalAmount: 0, totalArrears: 0, paymentsReceived: 0, balances: 0 },
          otherRollup: otherMonthly[k] || { totalProperties: 0, totalAmount: 0, totalArrears: 0, paymentsReceived: 0, balances: 0 }
        };
      }
      setMonthlyChargeData(mDataDict);

      const gdsFromTotals = Number(allData.totals?.depositPlusSuspense);
      const globalDepositSuspense = Number.isFinite(gdsFromTotals)
        ? gdsFromTotals
        : byMonthAll.reduce(
            (s, r) => s + (Number(r.depositTotal) || 0) + (Number(r.suspenseAmount) || 0),
            0
          );

      const camData = statsFromReportData(camReportRes.data?.data);
      const waterData = statsFromReportData(waterReportRes.data?.data);
      const elecData = statsFromReportData(electricityReportRes.data?.data);
      const rentFromReports = statsFromReportData(rentReportRes.data?.data);
      const groundFromReports = statsFromReportData(groundReportRes.data?.data);
      const otherFromReports = statsFromReportData(otherReportRes.data?.data);
      const invoiceCountInRange = Number(allData.totals?.invoiceCount) || 0;
      const propData = propertiesRes.data?.data;
      const residentData = residentsRes.data?.data;
      const rentalData = rentalRes.data?.data;

      const propertiesTotal = propertiesRes.data?.pagination?.total ?? (Array.isArray(propData) ? propData.length : 0);
      const residentsTotal = residentsRes.data?.pagination?.total ?? (Array.isArray(residentData) ? residentData.length : 0);
      const rentalTotal = Array.isArray(rentalData) ? rentalData.length : 0;

      const deposits = suspenseRes.data?.data?.deposits || [];
      const suspenseTotal = deposits.reduce((s, d) => s + (d.amount || 0), 0);
      const suspenseRemaining = deposits.reduce((s, d) => s + (d.remainingAmount ?? d.amount ?? 0), 0);

      let openInvoicesCount = 0;
      try {
        const openRes = await fetchAllInvoices({ page: 1, limit: 1, openInvoices: 'true', paymentStatus: 'unpaid,partial_paid' });
        openInvoicesCount = openRes.data?.pagination?.total ?? 0;
      } catch {
        // ignore
      }

      const topList = residentsByBalanceRes.data?.data;
      const topResidents = Array.isArray(topList)
        ? topList
            .filter((r) => (Number(r.balance) || 0) > 0)
            .slice(0, 8)
            .map((r) => {
              const props = r.properties;
              const first = Array.isArray(props) && props[0] ? props[0] : null;
              const propertyLabel =
                first?.propertyName ||
                first?.fullAddress ||
                [first?.plotNumber, first?.sector, first?.block].filter(Boolean).join(' ') ||
                '—';
              return {
                id: r._id,
                residentId: r.residentId || '—',
                owner: r.name || '—',
                property: propertyLabel,
                balance: Number(r.balance) || 0
              };
            })
        : [];

      const reconciliationByMonth = byMonthAll.map((r) => ({
        monthKey: r.month,
        month: r.monthLabel || r.month,
        value: (Number(r.depositTotal) || 0) + (Number(r.suspenseAmount) || 0)
      }));

      setStats({
        cam: {
          totalProperties: camData.totalProperties ?? 0,
          totalAmount: camData.totalAmountAllPages ?? camData.totalAmount ?? 0,
          totalArrears: camData.totalArrears ?? 0,
          totalAmountAllPages: camData.totalAmountAllPages ?? camData.totalAmount ?? 0,
          totalArrearsAllPages: camData.totalArrearsAllPages ?? 0,
          paymentsReceived: camData.paymentsReceived ?? 0
        },
        water: {
          totalProperties: waterData.totalProperties ?? 0,
          totalAmount: waterData.totalAmountAllPages ?? waterData.totalAmount ?? 0,
          totalArrears: waterData.totalArrears ?? 0,
          totalAmountAllPages: waterData.totalAmountAllPages ?? waterData.totalAmount ?? 0,
          totalArrearsAllPages: waterData.totalArrearsAllPages ?? 0,
          paymentsReceived: waterData.paymentsReceived ?? 0
        },
        electricity: {
          totalProperties: elecData.totalProperties ?? 0,
          totalAmount: elecData.totalAmountAllPages ?? elecData.totalAmount ?? 0,
          totalArrears: elecData.totalArrears ?? 0,
          totalAmountAllPages: elecData.totalAmountAllPages ?? elecData.totalAmount ?? 0,
          totalArrearsAllPages: elecData.totalArrearsAllPages ?? 0,
          paymentsReceived: elecData.paymentsReceived ?? 0
        },
        properties: propertiesTotal,
        residents: residentsTotal,
        rentalProperties: rentalTotal,
        invoices: invoiceCountInRange,
        openInvoices: openInvoicesCount,
        suspenseTotal,
        suspenseRemaining,
        topResidents,
        rentRollup: rentFromReports,
        groundRollup: groundFromReports,
        otherRollup: otherFromReports,
        reconciliationByMonth,
        globalDepositSuspense,
        byMonthBreakdown: byMonthAll
      });
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError(err.response?.data?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [startMonth, endMonth, chargeFilterKey]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const monthlyChargeTables = useMemo(() => {
    const mk = (id, label, s, collected) => {
      const invoiced = Math.round(Number(s?.totalAmountAllPages ?? s?.totalAmount ?? 0));
      const arrears = Math.round(Number(s?.totalArrears ?? 0));
      const total = invoiced + arrears;
      const paid = Math.round(Math.max(0, Number(s?.paymentsReceived ?? 0)));
      const balances = Math.max(0, total - paid);
      return {
        id,
        label,
        no: s?.totalProperties ?? 0,
        invoiced,
        arrears,
        total,
        paid,
        balances,
        collected: Math.round(Number(collected) || 0)
      };
    };

    return monthKeys.map((monthKey) => {
      const mData = monthlyChargeData[monthKey] || {};
      const usedByCharge = collectionsByMonth[monthKey]?.usedByCharge || {};
      const rows = [
        mk('ELECTRICITY', 'ELECTRICITY', mData.electricity, usedByCharge.ELECTRICITY),
        mk('CAM', 'CAM', mData.cam, usedByCharge.CAM),
        mk('RENT', 'RENT', mData.rentRollup, usedByCharge.RENT),
        mk('WATER', 'WATER', mData.water, usedByCharge.WATER),
        mk('GROUND', 'GROUND BOOKING', mData.groundRollup, usedByCharge.GROUND),
        mk('OTHER', 'OTHER', mData.otherRollup, usedByCharge.OTHER)
      ];

      const filtered =
        chargeFilter.size === 0
          ? rows
          : rows.filter((r) => chargeFilter.has(r.id));

      const totals = filtered.reduce(
        (acc, r) => ({
          no: acc.no + r.no,
          invoiced: acc.invoiced + r.invoiced,
          arrears: acc.arrears + r.arrears,
          total: acc.total + r.total,
          paid: acc.paid + r.paid,
          balances: acc.balances + r.balances,
          collected: acc.collected + r.collected
        }),
        { no: 0, invoiced: 0, arrears: 0, total: 0, paid: 0, balances: 0, collected: 0 }
      );

      return {
        monthKey,
        monthLabel: mData.monthLabel || monthKey,
        rows: filtered,
        totals,
        cash: collectionsByMonth[monthKey] || null
      };
    });
  }, [monthlyChargeData, monthKeys, chargeFilter, collectionsByMonth]);

  const filteredByMonthSummary = useMemo(() => {
    return monthlyChargeTables.map((mTable) => ({
      month: mTable.monthKey,
      monthLabel: mTable.monthLabel,
      invoiceAmount: mTable.totals.invoiced,
      paymentsReceived: mTable.totals.paid,
      cashReceived: Number(mTable.cash?.totalAmount) || 0,
      invoiceCount: mTable.totals.no
    }));
  }, [monthlyChargeTables]);

  const chargeRows = useMemo(() => {
    if (monthlyChargeTables.length > 0) {
      // Use latest month for top KPI metrics
      const latest = monthlyChargeTables[monthlyChargeTables.length - 1];
      return { rows: latest.rows, totals: latest.totals, kpiTotals: latest.totals, monthLabel: latest.monthLabel };
    }
    return {
      monthLabel: '',
      rows: [],
      totals: { no: 0, invoiced: 0, arrears: 0, total: 0, paid: 0, balances: 0 },
      kpiTotals: { no: 0, invoiced: 0, arrears: 0, total: 0, paid: 0, balances: 0 }
    };
  }, [monthlyChargeTables]);

  const kpis = useMemo(() => {
    const { kpiTotals } = chargeRows;
    const invoicedAmount = kpiTotals.invoiced;
    const balances = kpiTotals.balances;
    /** Same as Reports: sum of invoice Payments Received across all charge types in range. */
    const receivedAmount = kpiTotals.paid;
    const totalArrears = kpiTotals.arrears;
    return {
      monthLabel: chargeRows.monthLabel,
      totalInvoices: kpiTotals.no,
      invoicedAmount,
      receivedAmount,
      balances,
      totalArrears
    };
  }, [chargeRows]);

  const barChartData = useMemo(
    () =>
      chargeRows.rows.map((r) => ({
        name: r.label.length > 12 ? r.label.slice(0, 11) + '…' : r.label,
        invoiced: r.invoiced,
        paid: r.paid,
        balances: r.balances
      })),
    [chargeRows.rows]
  );

  const monthlyCollection = useMemo(() => {
    const rows = stats.reconciliationByMonth || [];
    if (!rows.length) return [];
    const last3 = rows.slice(-3);
    return last3.map((r) => ({
      month: r.month,
      value: Math.round(Number(r.value) || 0)
    }));
  }, [stats.reconciliationByMonth]);

  const donutData = useMemo(() => {
    const inv = Math.max(0, kpis.invoicedAmount);
    const rec = Math.max(0, kpis.receivedAmount);
    const rest = Math.max(0, inv - rec);
    if (inv === 0 && rec === 0) {
      return [
        { name: 'Paid against bills', value: 1 },
        { name: 'Invoiced (remaining)', value: 1 }
      ];
    }
    return [
      { name: 'Paid against bills', value: rec },
      { name: 'Invoiced (remaining)', value: rest }
    ];
  }, [kpis.invoicedAmount, kpis.receivedAmount]);

  const residentsTotalBalance = useMemo(
    () => stats.topResidents.reduce((s, r) => s + r.balance, 0),
    [stats.topResidents]
  );

  const handleFilter = (_e, ids) => {
    if (ids == null) setChargeFilter(new Set());
    else setChargeFilter(new Set(ids));
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#fafafa', minHeight: '100%' }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h5" fontWeight={700} sx={{ color: '#212121' }}>
              Taj Utilities & Charges — Dashboard
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Utility and charge management summary (filters apply to the charge summary, charts, and resident balance).
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={loadDashboard}
            disabled={loading}
            sx={{ borderColor: PRIMARY_BLUE, color: PRIMARY_BLUE }}
          >
            Refresh
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {/* Month range + KPIs */}
        <Paper elevation={0} sx={{ p: 2, mb: 2, border: BORDER, bgcolor: '#fff' }}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ lg: 'center' }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
              <TextField
                label="Start month"
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                InputLabelProps={{ shrink: true }}
                size="small"
                sx={{ width: 170 }}
              />
              <TextField
                label="End month"
                type="month"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value)}
                InputLabelProps={{ shrink: true }}
                size="small"
                sx={{ width: 170 }}
              />
            </Stack>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ flex: 1, '& > *': { flex: '1 1 140px', minWidth: 120 } }}>
              <KpiCard title="Invoices" value={formatTableNumber(kpis.totalInvoices)} loading={loading} />
              <KpiCard title="Invoiced Amount" value={formatCompactMoney(kpis.invoicedAmount)} loading={loading} />
              <KpiCard title="Arrears (included in Balances)" value={formatCompactMoney(kpis.totalArrears)} loading={loading} />
              <KpiCard title="Paid against these bills" value={formatCompactMoney(kpis.receivedAmount)} loading={loading} />
              <KpiCard title="Balances" value={formatCompactMoney(kpis.balances)} loading={loading} />
            </Stack>
          </Stack>
          {kpis.monthLabel && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Cards show {kpis.monthLabel} bills (the last month in the range), same as the {kpis.monthLabel} Charge Summary below.
              Cash received in each month is shown under that month's Charge Summary and matches the Deposits page.
            </Typography>
          )}
        </Paper>

        {/* Charge type filters */}
        <Paper elevation={0} sx={{ p: 1.5, mb: 2, border: BORDER, bgcolor: '#fff' }}>
          <ToggleButtonGroup
            value={Array.from(chargeFilter)}
            onChange={handleFilter}
            exclusive={false}
            aria-label="charge type filter"
            size="small"
            sx={{
              flexWrap: 'wrap',
              gap: 0.5,
              '& .MuiToggleButton-root': {
                px: 2,
                py: 0.75,
                fontWeight: 600,
                fontSize: '0.75rem',
                border: `1px solid ${PRIMARY_BLUE}40`,
                '&.Mui-selected': {
                  bgcolor: PRIMARY_BLUE,
                  color: '#fff',
                  '&:hover': { bgcolor: DEEP_BLUE }
                }
              }
            }}
          >
            {FILTER_DEFS.map((f) => (
              <ToggleButton key={f.id} value={f.id} aria-label={f.label}>
                {f.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Select one or more charge types to filter the summary table, bar chart, and resident balance. Empty selection shows all.
          </Typography>
        </Paper>

        {/* Middle: table per month + bar chart */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} lg={7}>
            <Stack spacing={2}>
              {loading ? (
                <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', p: 2 }}>
                  <Skeleton variant="text" width="40%" height={32} sx={{ mb: 1 }} />
                  <Skeleton variant="rectangular" height={200} />
                </Paper>
              ) : monthlyChargeTables.length === 0 ? (
                <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', p: 3, textAlign: 'center' }}>
                  <Typography color="text.secondary">No charge data found for selected month range.</Typography>
                </Paper>
              ) : (
                monthlyChargeTables.map((mTable) => (
                  <Paper key={mTable.monthKey} elevation={0} sx={{ border: BORDER, bgcolor: '#fff' }}>
                    <Box sx={{ px: 2, py: 1.25, borderBottom: BORDER, bgcolor: '#f5f5f5' }}>
                      <Typography fontWeight={700} color={PRIMARY_BLUE}>
                        Charge Summary — {mTable.monthLabel}
                      </Typography>
                    </Box>
                    <TableContainer>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, bgcolor: '#fafafa' }}>Charge Types</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#fafafa' }}>
                              Invoices
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#fafafa' }}>
                              Invoiced
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#fafafa' }}>
                              Arrears
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#fafafa' }}>
                              Total
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#fafafa' }}>
                              <MuiTooltip title="Payments recorded against this month's bills, whenever they were paid">
                                <span>Paid against these bills</span>
                              </MuiTooltip>
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#fafafa' }}>
                              Balances
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#fafafa' }}>
                              <MuiTooltip title="This month's deposits applied to bills of any month (the Deposits page 'Used' amount, split by charge type)">
                                <span>Collected (this month's deposits)</span>
                              </MuiTooltip>
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {mTable.rows.map((row, idx) => (
                            <TableRow
                              key={row.id}
                              hover
                              sx={{
                                bgcolor: idx % 2 === 0 ? '#fff' : '#fafafa',
                                cursor: 'pointer'
                              }}
                              onClick={() => {
                                const routes = {
                                  CAM: '/finance/taj-utilities-charges/cam-charges',
                                  WATER: '/finance/taj-utilities-charges/water-bills',
                                  ELECTRICITY: '/finance/taj-utilities-charges/electricity-bills',
                                  RENT: '/finance/taj-utilities-charges/rental-management',
                                  GROUND: '/finance/taj-utilities-charges/open-invoices',
                                  OTHER: '/finance/taj-utilities-charges/open-invoices'
                                };
                                if (routes[row.id]) navigate(routes[row.id]);
                              }}
                            >
                              <TableCell sx={{ fontWeight: 600 }}>{row.label}</TableCell>
                              <TableCell align="right">{formatTableNumber(row.no)}</TableCell>
                              <TableCell align="right">
                                <MuiTooltip title={`PKR ${row.invoiced.toLocaleString('en-PK')}`}>
                                  <span>{formatTableNumber(row.invoiced)}</span>
                                </MuiTooltip>
                              </TableCell>
                              <TableCell align="right">
                                <MuiTooltip title={`PKR ${row.arrears.toLocaleString('en-PK')}`}>
                                  <span>{formatTableNumber(row.arrears)}</span>
                                </MuiTooltip>
                              </TableCell>
                              <TableCell align="right">
                                <MuiTooltip title={`PKR ${row.total.toLocaleString('en-PK')}`}>
                                  <span>{formatTableNumber(row.total)}</span>
                                </MuiTooltip>
                              </TableCell>
                              <TableCell align="right">
                                <MuiTooltip title={`PKR ${row.paid.toLocaleString('en-PK')}`}>
                                  <span>{formatTableNumber(row.paid)}</span>
                                </MuiTooltip>
                              </TableCell>
                              <TableCell align="right">
                                <MuiTooltip title={`PKR ${row.balances.toLocaleString('en-PK')}`}>
                                  <span>{formatTableNumber(row.balances)}</span>
                                </MuiTooltip>
                              </TableCell>
                              <TableCell align="right">{formatTableNumber(row.collected)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow sx={{ bgcolor: '#eeeeee', '& td': { fontWeight: 700 } }}>
                            <TableCell>Total ({mTable.monthLabel})</TableCell>
                            <TableCell align="right">{formatTableNumber(mTable.totals.no)}</TableCell>
                            <TableCell align="right">
                              <MuiTooltip title={`PKR ${mTable.totals.invoiced.toLocaleString('en-PK')}`}>
                                <span>{formatTableNumber(mTable.totals.invoiced)}</span>
                              </MuiTooltip>
                            </TableCell>
                            <TableCell align="right">
                              <MuiTooltip title={`PKR ${mTable.totals.arrears.toLocaleString('en-PK')}`}>
                                <span>{formatTableNumber(mTable.totals.arrears)}</span>
                              </MuiTooltip>
                            </TableCell>
                            <TableCell align="right">
                              <MuiTooltip title={`PKR ${mTable.totals.total.toLocaleString('en-PK')}`}>
                                <span>{formatTableNumber(mTable.totals.total)}</span>
                              </MuiTooltip>
                            </TableCell>
                            <TableCell align="right">
                              <MuiTooltip title={`PKR ${mTable.totals.paid.toLocaleString('en-PK')}`}>
                                <span>{formatTableNumber(mTable.totals.paid)}</span>
                              </MuiTooltip>
                            </TableCell>
                            <TableCell align="right">
                              <MuiTooltip title={`PKR ${mTable.totals.balances.toLocaleString('en-PK')}`}>
                                <span>{formatTableNumber(mTable.totals.balances)}</span>
                              </MuiTooltip>
                            </TableCell>
                            <TableCell align="right">{formatTableNumber(mTable.totals.collected)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <CashReceivedPanel monthKey={mTable.monthKey} monthLabel={mTable.monthLabel} cash={mTable.cash} />
                  </Paper>
                ))
              )}
            </Stack>
          </Grid>
          <Grid item xs={12} lg={5}>
            <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', p: 2, height: 380 }}>
              <Typography fontWeight={700} color={PRIMARY_BLUE} sx={{ mb: 1 }}>
                By charge type{kpis.monthLabel ? ` — ${kpis.monthLabel}` : ''}
              </Typography>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={barChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={56} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)}
                  />
                  <RTooltip formatter={(val) => formatTableNumber(val)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="invoiced" name="Invoiced" fill={CHART_BLUE} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="paid" name="Paid against these bills" fill={CHART_BLUE_DARK} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="balances" name="Balances" fill={ORANGE} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        </Grid>

        {/* Bottom row */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', height: 360, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: BORDER, bgcolor: '#f5f5f5' }}>
                <Typography fontWeight={700} color={PRIMARY_BLUE}>
                  Month-wise Invoice Summary
                </Typography>
              </Box>
              <TableContainer sx={{ flex: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Month</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Invoiced</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Paid against bills</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Cash received</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f5f5f5' }}>Invoices</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 5 }).map((__, j) => (
                            <TableCell key={j}><Skeleton /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : filteredByMonthSummary.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                            No data for selected period
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredByMonthSummary.map((row, idx) => (
                        <TableRow key={row.month} sx={{ bgcolor: idx % 2 === 0 ? '#fff' : '#fafafa' }} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{row.monthLabel || row.month}</TableCell>
                          <TableCell align="right">
                            <MuiTooltip title={`PKR ${Number(row.invoiceAmount || 0).toLocaleString('en-PK')}`}>
                              <span>{formatTableNumber(row.invoiceAmount)}</span>
                            </MuiTooltip>
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'success.main', fontWeight: 600 }}>
                            <MuiTooltip title={`PKR ${Number(row.paymentsReceived || 0).toLocaleString('en-PK')}`}>
                              <span>{formatTableNumber(row.paymentsReceived)}</span>
                            </MuiTooltip>
                          </TableCell>
                          <TableCell align="right">{formatTableNumber(row.cashReceived)}</TableCell>
                          <TableCell align="right">{row.invoiceCount || 0}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', p: 2, height: 360 }}>
              <Typography fontWeight={700} color={PRIMARY_BLUE} sx={{ mb: 1 }}>
                Monthly collection
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Cash received: deposits + suspense per month (same as the Deposits page Total and the Reconciliation Amount). Shows the last three months in the selected range.
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={monthlyCollection} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PRIMARY_BLUE} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={PRIMARY_BLUE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}K`)}
                  />
                  <RTooltip formatter={(val) => formatTableNumber(val)} />
                  <Area type="monotone" dataKey="value" stroke={PRIMARY_BLUE} fillOpacity={1} fill="url(#colorCol)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper elevation={0} sx={{ border: BORDER, bgcolor: '#fff', p: 2, height: 360 }}>
              <Typography fontWeight={700} color={PRIMARY_BLUE} sx={{ mb: 1 }}>
                Invoiced vs paid{kpis.monthLabel ? ` — ${kpis.monthLabel} bills` : ''}
              </Typography>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={68}
                    outerRadius={96}
                    paddingAngle={1}
                    dataKey="value"
                    label={({ name, percent }) => `${String(name).split(' ')[0]} ${((percent || 0) * 100).toFixed(1)}%`}
                  >
                    {donutData.map((entry, index) => (
                      <Cell key={entry.name} fill={index === 0 ? DEEP_BLUE : LIGHT_BLUE} />
                    ))}
                  </Pie>
                  <RTooltip formatter={(val) => formatCompactMoney(val)} />
                </PieChart>
              </ResponsiveContainer>
              <Stack direction="row" justifyContent="center" spacing={3} sx={{ mt: -1 }}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: DEEP_BLUE }} />
                  <Typography variant="caption">Paid against bills {formatCompactMoney(donutData[0]?.value)}</Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: LIGHT_BLUE }} />
                  <Typography variant="caption">Invoiced remaining {formatCompactMoney(donutData[1]?.value)}</Typography>
                </Stack>
              </Stack>
            </Paper>
          </Grid>
        </Grid>
      </Box>
    </LocalizationProvider>
  );
};

export default Dashboard;
