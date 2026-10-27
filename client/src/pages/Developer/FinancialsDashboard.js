import React, { useState, useCallback, useEffect } from 'react';
import {
  Box, Card, CardContent, Chip, CircularProgress, Divider, Grid,
  IconButton, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography, Alert,
  Slider, Button, TextField, InputAdornment
} from '@mui/material';
import {
  AttachMoney as MoneyIcon, People as PeopleIcon, TrendingUp as TrendIcon,
  AccountBalance as FinanceIcon, ShoppingCart as ProcIcon, LocationCity as TajIcon,
  Groups as HRIcon, BarChart as ChartIcon, Refresh as RefreshIcon,
  CalendarToday as CalIcon, TouchApp as ActIcon,
  Savings as SavingsIcon, Calculate as CalcIcon, Security as LicenseIcon,
  CheckCircle as CheckIcon, Cancel as CrossIcon, CompareArrows as CompareIcon,
  Star as StarIcon
} from '@mui/icons-material';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';
import { getFinancials } from '../../services/developerService';

const PKR = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));

const SHORT_PKR = (v) => {
  const n = Number(v || 0);
  if (n >= 1e9) return `PKR ${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `PKR ${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `PKR ${(n / 1e3).toFixed(0)}K`;
  return PKR(n);
};

const daysSince = (date) => {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
};

const formatDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' });
};

const KpiCard = ({ label, value, sub, color, icon, highlight }) => (
  <Card
    sx={{
      borderRadius: 3, height: '100%',
      border: '1px solid', borderColor: highlight ? color : 'divider',
      background: highlight
        ? `linear-gradient(135deg, ${color}22 0%, ${color}08 100%)`
        : 'background.paper',
      transition: 'all 0.2s',
      '&:hover': { boxShadow: 4, transform: 'translateY(-2px)' }
    }}
    elevation={highlight ? 2 : 0}
  >
    <CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box flex={1}>
          <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase" letterSpacing={0.8} display="block">
            {label}
          </Typography>
          <Typography variant="h5" fontWeight={800} sx={{ color: color || 'text.primary', mt: 0.5, lineHeight: 1.2 }}>
            {value}
          </Typography>
          {sub && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{sub}</Typography>}
        </Box>
        <Box sx={{
          p: 1.2, borderRadius: 2, bgcolor: `${color}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44
        }}>
          <Box sx={{ color }}>{icon}</Box>
        </Box>
      </Stack>
    </CardContent>
  </Card>
);

const SectionTitle = ({ icon, children, sub }) => (
  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2.5, mt: 4 }}>
    <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
    <Box>
      <Typography variant="h6" fontWeight={800}>{children}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Box>
    <Divider sx={{ flex: 1 }} />
  </Stack>
);

const MODULE_COLORS = {
  hr: '#7c4dff',
  procurement: '#00b0ff',
  finance: '#00e676',
  tajResidencia: '#ff9100',
};
const ACTIVITY_COLORS = ['#7c4dff', '#00b0ff', '#ff9100', '#00e676', '#e91e63', '#009688'];

export default function FinancialsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ERP Licensing Calculator State
  const [perUserRate, setPerUserRate] = useState(5000); // PKR 5,000 / user / month
  const [volumeFeePercent, setVolumeFeePercent] = useState(0.15); // 0.15% of total throughput
  const [developmentCostPKR, setDevelopmentCostPKR] = useState(1500000); // Default PKR 1.5M Development Cost
  const [currencyMode, setCurrencyMode] = useState('PKR'); // PKR or USD
  const [usdExchangeRate] = useState(278); // 1 USD = 278 PKR

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await getFinancials();
      if (res.data?.success) setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load financials');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight={500}>
      <CircularProgress size={48} />
      <Typography variant="body1" color="text.secondary" sx={{ ml: 2 }}>Aggregating financial records…</Typography>
    </Box>
  );

  if (error) return (
    <Box p={3}><Alert severity="error" action={
      <IconButton size="small" onClick={load}><RefreshIcon /></IconButton>
    }>{error}</Alert></Box>
  );

  if (!data) return null;

  const { goLiveDate, activeUsers, totalUsers, usersByRole, totalActions, totalLogins,
    grandTotal, moduleFinancials, monthlyTrend, activityBreakdown,
    moduleActivity, topUsers } = data;
  const { hr, procurement, finance, tajResidencia } = moduleFinancials;
  const liveDays = daysSince(goLiveDate);
  const liveMonths = Math.max(1, Math.round(liveDays / 30.4375));

  const moduleBreakdown = [
    { name: 'HR & Payroll', value: hr.total, color: MODULE_COLORS.hr },
    { name: 'Procurement', value: procurement.total, color: MODULE_COLORS.procurement },
    { name: 'Finance', value: finance.total, color: MODULE_COLORS.finance },
    { name: 'Taj Residencia', value: tajResidencia.total, color: MODULE_COLORS.tajResidencia },
  ].filter(m => m.value > 0);

  const barChartData = moduleBreakdown.map(m => ({ name: m.name.split(' ')[0], value: m.value, color: m.color }));

  const activityPieData = Object.entries(activityBreakdown || {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // ── Licensing Calculations (Purely with respect to License Pricing Controls) ──────────────────
  const monthlyPerUserCostPKR = activeUsers * perUserRate;
  const annualPerUserCostPKR = monthlyPerUserCostPKR * 12;
  const cumulativeLicensePriceUptillNowPKR = monthlyPerUserCostPKR * liveMonths; // Pure software license price uptill now

  // Net ROI / License value after deducting initial Development Cost
  const netLicenseValAfterDevCostPKR = cumulativeLicensePriceUptillNowPKR - developmentCostPKR;

  const volumeBasedAnnualCostPKR = (grandTotal * (volumeFeePercent / 100));
  const volumeBasedMonthlyCostPKR = volumeBasedAnnualCostPKR / 12;

  // Commercial Off-the-Shelf (SAP / Oracle / Dynamics / Odoo) comparison estimates
  const commercialSapPerUserMoUSD = 165; // Average SAP S/4HANA Cloud Professional User
  const commercialSapAnnualCostPKR = (activeUsers * commercialSapPerUserMoUSD * 12) * usdExchangeRate;

  const commercialDynamicsPerUserMoUSD = 180; // Microsoft Dynamics 365 Finance & Operations
  const commercialDynamicsAnnualCostPKR = (activeUsers * commercialDynamicsPerUserMoUSD * 12) * usdExchangeRate;

  const commercialOdooPerUserMoUSD = 45; // Odoo Enterprise User + avg app add-ons ($24.90 base + apps)
  const commercialOdooAnnualCostPKR = (activeUsers * commercialOdooPerUserMoUSD * 12) * usdExchangeRate;

  // Commercial Monthly Costs
  const commercialSapMonthlyPKR = (activeUsers * commercialSapPerUserMoUSD) * usdExchangeRate;
  const commercialDynamicsMonthlyPKR = (activeUsers * commercialDynamicsPerUserMoUSD) * usdExchangeRate;
  const commercialOdooMonthlyPKR = (activeUsers * commercialOdooPerUserMoUSD) * usdExchangeRate;

  // Monthly Savings
  const monthlySavingsVsSapPKR = commercialSapMonthlyPKR - monthlyPerUserCostPKR;
  const monthlySavingsVsDynamicsPKR = commercialDynamicsMonthlyPKR - monthlyPerUserCostPKR;
  const monthlySavingsVsOdooPKR = commercialOdooMonthlyPKR - monthlyPerUserCostPKR;

  // Annual Savings
  const annualSavingsVsSapPKR = monthlySavingsVsSapPKR * 12;
  const annualSavingsVsDynamicsPKR = monthlySavingsVsDynamicsPKR * 12;
  const annualSavingsVsOdooPKR = monthlySavingsVsOdooPKR * 12;

  // Uptill Now (Cumulative) Savings
  const cumulativeSavingsVsSapPKR = monthlySavingsVsSapPKR * liveMonths;
  const cumulativeSavingsVsDynamicsPKR = monthlySavingsVsDynamicsPKR * liveMonths;
  const cumulativeSavingsVsOdooPKR = monthlySavingsVsOdooPKR * liveMonths;

  const estimatedSavingsPKR = annualSavingsVsSapPKR;

  const formatCurr = (valInPKR) => {
    if (currencyMode === 'USD') {
      const usdVal = valInPKR / usdExchangeRate;
      return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(usdVal)}`;
    }
    return PKR(valInPKR);
  };

  // Competitor Matrix Data
  const competitorMatrix = [
    {
      module: 'HR & Payroll (Tax, Salary, EOBI, Loans)',
      ourStatus: 'Included (Full)',
      sapStatus: 'Requires SuccessFactors ($85/usr/mo)',
      odooStatus: 'Requires Payroll & HR Apps ($15/app/mo)',
      dynamicsStatus: 'Requires Dynamics HR ($120/usr/mo)'
    },
    {
      module: 'Finance & Accounting (AP, GL, Vouchers)',
      ourStatus: 'Included (Full)',
      sapStatus: 'Included in Core ($165/usr/mo)',
      odooStatus: 'Requires Accounting App ($20/mo)',
      dynamicsStatus: 'Requires Dynamics Finance ($180/usr/mo)'
    },
    {
      module: 'Procurement & Stores (PO, Indent, GRN, QA)',
      ourStatus: 'Included (Full)',
      sapStatus: 'Included in Core (MM)',
      odooStatus: 'Requires Purchase + Inventory Apps',
      dynamicsStatus: 'Requires Supply Chain ($180/usr/mo)'
    },
    {
      module: 'Taj Residencia Real Estate (Land, CAM, Water)',
      ourStatus: 'Included (Fully Tailored)',
      sapStatus: 'Not Available (Custom ABAP Dev $200k+)',
      odooStatus: 'Not Available (Custom Python Dev)',
      dynamicsStatus: 'Not Available (Custom ISV Partner Dev)'
    },
    {
      module: 'Project Management (BOQ, WBS, EVM, Inspections)',
      ourStatus: 'Included (Full)',
      sapStatus: 'Requires SAP PS ($60/usr/mo)',
      odooStatus: 'Requires Project App ($15/mo)',
      dynamicsStatus: 'Requires Project Ops ($120/usr/mo)'
    },
    {
      module: 'CRM & Sales (Leads, Campaigns, Surveys)',
      ourStatus: 'Included (Full)',
      sapStatus: 'Requires Sales Cloud ($105/usr/mo)',
      odooStatus: 'Requires CRM + Sales Apps',
      dynamicsStatus: 'Requires Dynamics Sales ($105/usr/mo)'
    },
    {
      module: 'Pre-Audit & Quality Control Gate Passes',
      ourStatus: 'Included (Full)',
      sapStatus: 'Requires SAP GRC (Separate Suite)',
      odooStatus: 'Requires Quality App ($15/mo)',
      dynamicsStatus: 'Requires Governance Add-on'
    },
    {
      module: 'Document Tracking & Approval Workflows',
      ourStatus: 'Included (Full)',
      sapStatus: 'Requires OpenText ECM Integration',
      odooStatus: 'Requires Documents App ($15/mo)',
      dynamicsStatus: 'Requires SharePoint / Power Automate'
    }
  ];

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>

      {/* Executive Header */}
      <Paper
        sx={{
          p: 3.5, mb: 3, borderRadius: 3,
          background: 'linear-gradient(135deg, #0d0d1a 0%, #1a0533 40%, #0d2137 100%)',
          border: '1px solid rgba(124,77,255,0.3)', color: '#fff'
        }}
        elevation={6}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box sx={{ p: 1.5, bgcolor: 'rgba(124,77,255,0.25)', borderRadius: 2, display: 'flex', border: '1px solid rgba(124,77,255,0.4)' }}>
              <TrendIcon sx={{ fontSize: 38, color: '#b39ddb' }} />
            </Box>
            <Box>
              <Typography variant="h4" fontWeight={900} sx={{ color: '#ce93d8', letterSpacing: 0.5 }}>
                ERP Financial Value & Competitor Licensing Report
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.55)', mt: 0.5 }}>
                Total financial volume processed, custom licensing calculator & SAP / Odoo / Dynamics comparison
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Chip label={`Live since ${formatDate(goLiveDate)}`} icon={<CalIcon />}
              sx={{ bgcolor: 'rgba(255,255,255,0.08)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)', border: '1px solid', fontWeight: 600 }} />
            <Tooltip title="Refresh">
              <IconButton onClick={load} sx={{ color: 'rgba(255,255,255,0.6)', '&:hover': { color: '#fff' } }}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {/* TOVUS License Pricing Uptill Now Banner (Based purely on controls) */}
        <Box sx={{ mt: 3, p: 3, borderRadius: 2.5, bgcolor: 'rgba(124,77,255,0.15)', border: '1px solid rgba(124,77,255,0.4)', textAlign: 'center' }}>
          <Typography variant="overline" sx={{ color: '#ce93d8', fontWeight: 800, letterSpacing: 2 }}>
            💳 TOVUS LICENSE PRICING UPTILL NOW ({liveMonths} MONTHS)
          </Typography>
          <Typography variant="h2" fontWeight={900} sx={{ color: '#ffd54f', mt: 0.5, textShadow: '0 0 30px rgba(255,213,79,0.5)' }}>
            {formatCurr(cumulativeLicensePriceUptillNowPKR)}
          </Typography>
          <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)', mt: 0.5 }}>
            Calculated at {formatCurr(perUserRate)}/usr/mo for {activeUsers} active user seats across {liveMonths} operational months
          </Typography>
        </Box>
      </Paper>

      {/* Top KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard label="License Value Uptill Now" value={SHORT_PKR(cumulativeLicensePriceUptillNowPKR)} sub={`${liveMonths} mos @ ${formatCurr(perUserRate)}/mo`} color="#7c4dff" icon={<LicenseIcon />} highlight />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard label="Development Cost" value={SHORT_PKR(developmentCostPKR)} sub="Initial setup & custom dev" color="#ff9100" icon={<CalcIcon />} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard label="Active User Seats" value={activeUsers} sub={`${totalUsers} total registered`} color="#00b0ff" icon={<PeopleIcon />} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard label="System Operational" value={`${liveMonths} Months`} sub={`Live since ${formatDate(goLiveDate)} (${liveDays} days)`} color="#00e676" icon={<CalIcon />} />
        </Grid>
      </Grid>

      {/* ── ERP LICENSING & BILLING CALCULATOR ────────────────── */}
      <SectionTitle icon={<LicenseIcon />} sub="Detailed breakdown of how ERP licensing is charged per user seat vs volume">
        ERP Software Licensing & Billing Model
      </SectionTitle>

      <Paper sx={{ p: 3, mb: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.main', bgcolor: 'background.paper' }} elevation={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} sx={{ mb: 3 }}>
          <Box>
            <Typography variant="h6" fontWeight={800} color="primary.main">
              💳 Interactive Licensing & Subscription Cost Generator
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Calculate software subscription cost based on current active user seats vs volume processed.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant={currencyMode === 'PKR' ? 'contained' : 'outlined'}
              onClick={() => setCurrencyMode('PKR')}
              sx={{ fontWeight: 700 }}
            >
              PKR (Rs.)
            </Button>
            <Button
              size="small"
              variant={currencyMode === 'USD' ? 'contained' : 'outlined'}
              onClick={() => setCurrencyMode('USD')}
              sx={{ fontWeight: 700 }}
            >
              USD ($)
            </Button>
          </Stack>
        </Stack>

        <Grid container spacing={3}>
          {/* Controls Column */}
          <Grid item xs={12} md={5}>
            <Card variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2" fontWeight={800} textTransform="uppercase" letterSpacing={0.8} color="text.secondary" sx={{ mb: 2 }}>
                ⚙️ License Pricing Controls
              </Typography>

              {/* Slider 1: Per User Monthly Rate */}
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" fontWeight={700} id="per-user-slider-label">
                  TOVUS Per User Seat Rate: <Typography component="span" fontWeight={900} color="primary.main">{formatCurr(perUserRate)} / user / mo</Typography>
                </Typography>
                <Slider
                  aria-labelledby="per-user-slider-label"
                  value={perUserRate}
                  min={1000}
                  max={25000}
                  step={500}
                  onChange={(e, val) => setPerUserRate(val)}
                  sx={{ mt: 1 }}
                />
                <Typography variant="caption" color="text.secondary">
                  Adjust per-seat monthly subscription fee for TOVUS ERP
                </Typography>
              </Box>

              {/* Slider 2: Transaction Volume Percentage Rate */}
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" fontWeight={700} id="volume-slider-label">
                  Volume Processing Fee Rate: <Typography component="span" fontWeight={900} color="secondary.main">{volumeFeePercent.toFixed(2)}%</Typography>
                </Typography>
                <Slider
                  aria-labelledby="volume-slider-label"
                  value={volumeFeePercent}
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  onChange={(e, val) => setVolumeFeePercent(val)}
                  color="secondary"
                  sx={{ mt: 1 }}
                />
                <Typography variant="caption" color="text.secondary">
                  Percentage charge based on total financial throughput processed
                </Typography>
              </Box>

              {/* Input 3: Development Cost Input */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
                  Initial Development & Setup Cost:
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  value={developmentCostPKR}
                  onChange={(e) => setDevelopmentCostPKR(Number(e.target.value) || 0)}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">{currencyMode === 'USD' ? '$' : 'PKR'}</InputAdornment>,
                  }}
                  helperText="Enter your custom system development cost"
                />
              </Box>

              {/* Active User Breakdown Table */}
              <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2, mb: 1 }}>
                👥 Current User Seats Breakdown:
              </Typography>
              <Stack spacing={1}>
                {usersByRole?.map((r, i) => (
                  <Stack key={i} direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" fontWeight={600} textTransform="capitalize">
                      • {String(r._id).replace(/_/g, ' ')}
                    </Typography>
                    <Typography variant="caption" fontWeight={700}>
                      {r.active} Active / {r.count} Total
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Card>
          </Grid>

          {/* Licensing Models Output Column */}
          <Grid item xs={12} md={7}>
            <Grid container spacing={2}>
              {/* Model 1 Card: Per User Seat Subscription */}
              <Grid item xs={12} sm={6}>
                <Card sx={{ p: 2.5, borderRadius: 2.5, border: '2px solid', borderColor: 'primary.main', height: '100%', bgcolor: 'primary.50' }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <PeopleIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={900} color="primary.main">
                      1. Per-User Seat Model
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Based on <Typography component="span" fontWeight={800}>{activeUsers} active user seats</Typography> (All Modules Included)
                  </Typography>

                  <Box sx={{ my: 2 }}>
                    <Typography variant="caption" color="text.secondary" display="block">Est. Monthly Subscription</Typography>
                    <Typography variant="h5" fontWeight={900} color="primary.main">
                      {formatCurr(monthlyPerUserCostPKR)} <Typography component="span" variant="caption">/ month</Typography>
                    </Typography>
                  </Box>

                  <Divider sx={{ my: 1.5 }} />

                  <Typography variant="caption" color="text.secondary" display="block">Est. Annual License Revenue (ARR)</Typography>
                  <Typography variant="h6" fontWeight={800} color="text.primary" sx={{ mb: 1 }}>
                    {formatCurr(annualPerUserCostPKR)} <Typography component="span" variant="caption">/ year</Typography>
                  </Typography>

                  <Box sx={{ p: 1.2, borderRadius: 1.5, bgcolor: 'rgba(124,77,255,0.1)', border: '1px solid rgba(124,77,255,0.2)' }}>
                    <Typography variant="caption" fontWeight={800} color="primary.main" display="block">
                      🏆 LICENSE VALUE UPTILL NOW ({liveMonths} MOS)
                    </Typography>
                    <Typography variant="subtitle1" fontWeight={900} color="primary.main">
                      {formatCurr(cumulativeLicensePriceUptillNowPKR)}
                    </Typography>
                  </Box>
                </Card>
              </Grid>

              {/* Model 2 Card: Transaction Volume Based */}
              <Grid item xs={12} sm={6}>
                <Card sx={{ p: 2.5, borderRadius: 2.5, border: '2px solid', borderColor: 'secondary.main', height: '100%', bgcolor: 'secondary.50' }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <CalcIcon color="secondary" />
                    <Typography variant="subtitle1" fontWeight={900} color="secondary.main">
                      2. Volume Throughput Model
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Based on <Typography component="span" fontWeight={800}>{SHORT_PKR(grandTotal)}</Typography> processed
                  </Typography>

                  <Box sx={{ my: 2 }}>
                    <Typography variant="caption" color="text.secondary" display="block">Est. Monthly Volume Fee</Typography>
                    <Typography variant="h5" fontWeight={900} color="secondary.main">
                      {formatCurr(volumeBasedMonthlyCostPKR)} <Typography component="span" variant="caption">/ month</Typography>
                    </Typography>
                  </Box>

                  <Divider sx={{ my: 1.5 }} />

                  <Typography variant="caption" color="text.secondary" display="block">Est. Annual Volume Fee ({volumeFeePercent.toFixed(2)}%)</Typography>
                  <Typography variant="h6" fontWeight={800} color="text.primary">
                    {formatCurr(volumeBasedAnnualCostPKR)} <Typography component="span" variant="caption">/ year</Typography>
                  </Typography>
                </Card>
              </Grid>

              {/* Savings vs SAP / Oracle Commercial Card */}
              <Grid item xs={12}>
                <Paper sx={{ p: 2, borderRadius: 2, bgcolor: 'success.main', color: '#fff' }} elevation={1}>
                  <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" justifyContent="space-between">
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <SavingsIcon sx={{ fontSize: 32 }} />
                      <Box>
                        <Typography variant="subtitle2" fontWeight={900}>
                          💡 Estimated Annual Commercial ERP Licensing Savings
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.9 }}>
                          Compared to SAP S/4HANA Cloud (@ $165/user/month for {activeUsers} users + add-ons)
                        </Typography>
                      </Box>
                    </Stack>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h6" fontWeight={900}>
                        Save {formatCurr(estimatedSavingsPKR)} / year
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.8 }}>
                        (SAP Commercial Cost: {formatCurr(commercialSapAnnualCostPKR)}/yr)
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Paper>

      {/* ── COMPETITOR ERP COMPARISON MATRIX (NEW SECTION) ────────────────── */}
      <SectionTitle icon={<CompareIcon />} sub="Detailed comparison of TOVUS ERP vs SAP, Odoo, and Microsoft Dynamics 365">
        Commercial ERP Competitor Comparison (SAP, Odoo, Dynamics 365)
      </SectionTitle>

      {/* Highlights Banner */}
      <Paper sx={{ p: 2.5, mb: 3, borderRadius: 3, background: 'linear-gradient(135deg, #1e1e2f 0%, #0d1b2a 100%)', color: '#fff' }} elevation={2}>
        <Stack direction="row" spacing={2} alignItems="center">
          <StarIcon sx={{ color: '#ffd54f', fontSize: 36 }} />
          <Box>
            <Typography variant="subtitle1" fontWeight={900} sx={{ color: '#ffd54f' }}>
              ⭐ Key Advantage: ALL 10+ Modules Included Out of the Box in TOVUS
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.3 }}>
              While SAP, Odoo, and Microsoft Dynamics charge extra per module / per app / per user suite, <strong>TOVUS ERP includes every single module in one unified license</strong> with zero hidden per-module fees.
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* Side-by-Side Cost Summary Table */}
      <Paper sx={{ p: 3, mb: 4, borderRadius: 3, border: '1px solid', borderColor: 'divider' }} elevation={0}>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>
          📊 Annual Cost Comparison for {activeUsers} Active Users
        </Typography>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ p: 2, borderRadius: 2, border: '2px solid #7c4dff', bgcolor: 'rgba(124,77,255,0.05)' }}>
              <Chip label="TOVUS ERP" color="primary" size="small" sx={{ fontWeight: 900, mb: 1 }} />
              <Typography variant="h6" fontWeight={900} color="primary.main">{formatCurr(annualPerUserCostPKR)}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">/ year ({formatCurr(perUserRate)}/usr/mo)</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" fontWeight={700} color="success.main">
                ✅ ALL 10+ Modules Included
              </Typography>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Chip label="SAP S/4HANA Cloud" variant="outlined" size="small" sx={{ fontWeight: 800, mb: 1 }} />
              <Typography variant="h6" fontWeight={900}>{formatCurr(commercialSapAnnualCostPKR)}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">/ year ($165/usr/mo base)</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" color="error.main" fontWeight={600}>
                ❌ +$100k-$500k Implementation Fee
              </Typography>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Chip label="Microsoft Dynamics 365" variant="outlined" size="small" sx={{ fontWeight: 800, mb: 1 }} />
              <Typography variant="h6" fontWeight={900}>{formatCurr(commercialDynamicsAnnualCostPKR)}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">/ year ($180/usr/mo base)</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" color="error.main" fontWeight={600}>
                ❌ +$60-$120/usr for extra apps
              </Typography>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Chip label="Odoo Enterprise" variant="outlined" size="small" sx={{ fontWeight: 800, mb: 1 }} />
              <Typography variant="h6" fontWeight={900}>{formatCurr(commercialOdooAnnualCostPKR)}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">/ year ($45/usr/mo + app fees)</Typography>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" color="warning.main" fontWeight={600}>
                ⚠️ Charged Per App Added
              </Typography>
            </Card>
          </Grid>
        </Grid>

        {/* 💰 DETAILED COST SAVINGS SUMMARY CARD (MONTHLY, ANNUAL, UPTILL NOW) */}
        <Paper
          sx={{
            p: 3, mb: 3.5, borderRadius: 3,
            background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
            color: '#fff', border: '1px solid rgba(0,230,118,0.4)'
          }}
          elevation={3}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <SavingsIcon sx={{ color: '#69f0ae', fontSize: 32 }} />
            <Box>
              <Typography variant="h6" fontWeight={900} sx={{ color: '#69f0ae' }}>
                💰 TOVUS ERP Total Net Savings Summary
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                Exact calculated savings across Monthly, Annual, and Cumulative Uptill Now ({liveMonths} months since go-live for {activeUsers} active user seats)
              </Typography>
            </Box>
          </Stack>

          <Grid container spacing={2}>
            {/* Vs SAP */}
            <Grid item xs={12} md={4}>
              <Card sx={{ p: 2, borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}>
                <Chip label="vs. SAP S/4HANA Cloud" size="small" sx={{ bgcolor: 'rgba(105,240,174,0.2)', color: '#69f0ae', fontWeight: 800, mb: 1.5 }} />

                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block' }}>Saved Per Month</Typography>
                  <Typography variant="h6" fontWeight={900} sx={{ color: '#69f0ae' }}>
                    {formatCurr(monthlySavingsVsSapPKR)} <Typography component="span" variant="caption">/ mo</Typography>
                  </Typography>
                </Box>

                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block' }}>Saved Per Year</Typography>
                  <Typography variant="h6" fontWeight={900} sx={{ color: '#69f0ae' }}>
                    {formatCurr(annualSavingsVsSapPKR)} <Typography component="span" variant="caption">/ yr</Typography>
                  </Typography>
                </Box>

                <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.15)' }} />

                <Box>
                  <Typography variant="caption" sx={{ opacity: 0.8, fontWeight: 700, display: 'block', color: '#ffd54f' }}>
                    🏆 SAVED UPTILL NOW ({liveMonths} mos)
                  </Typography>
                  <Typography variant="h5" fontWeight={900} sx={{ color: '#ffd54f', textShadow: '0 0 15px rgba(255,213,79,0.3)' }}>
                    {formatCurr(cumulativeSavingsVsSapPKR)}
                  </Typography>
                </Box>
              </Card>
            </Grid>

            {/* Vs Microsoft Dynamics 365 */}
            <Grid item xs={12} md={4}>
              <Card sx={{ p: 2, borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}>
                <Chip label="vs. MS Dynamics 365" size="small" sx={{ bgcolor: 'rgba(0,176,255,0.2)', color: '#40c4ff', fontWeight: 800, mb: 1.5 }} />

                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block' }}>Saved Per Month</Typography>
                  <Typography variant="h6" fontWeight={900} sx={{ color: '#40c4ff' }}>
                    {formatCurr(monthlySavingsVsDynamicsPKR)} <Typography component="span" variant="caption">/ mo</Typography>
                  </Typography>
                </Box>

                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block' }}>Saved Per Year</Typography>
                  <Typography variant="h6" fontWeight={900} sx={{ color: '#40c4ff' }}>
                    {formatCurr(annualSavingsVsDynamicsPKR)} <Typography component="span" variant="caption">/ yr</Typography>
                  </Typography>
                </Box>

                <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.15)' }} />

                <Box>
                  <Typography variant="caption" sx={{ opacity: 0.8, fontWeight: 700, display: 'block', color: '#ffd54f' }}>
                    🏆 SAVED UPTILL NOW ({liveMonths} mos)
                  </Typography>
                  <Typography variant="h5" fontWeight={900} sx={{ color: '#ffd54f', textShadow: '0 0 15px rgba(255,213,79,0.3)' }}>
                    {formatCurr(cumulativeSavingsVsDynamicsPKR)}
                  </Typography>
                </Box>
              </Card>
            </Grid>

            {/* Vs Odoo Enterprise */}
            <Grid item xs={12} md={4}>
              <Card sx={{ p: 2, borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}>
                <Chip label="vs. Odoo Enterprise" size="small" sx={{ bgcolor: 'rgba(255,145,0,0.2)', color: '#ffab40', fontWeight: 800, mb: 1.5 }} />

                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block' }}>Saved Per Month</Typography>
                  <Typography variant="h6" fontWeight={900} sx={{ color: '#ffab40' }}>
                    {formatCurr(monthlySavingsVsOdooPKR)} <Typography component="span" variant="caption">/ mo</Typography>
                  </Typography>
                </Box>

                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block' }}>Saved Per Year</Typography>
                  <Typography variant="h6" fontWeight={900} sx={{ color: '#ffab40' }}>
                    {formatCurr(annualSavingsVsOdooPKR)} <Typography component="span" variant="caption">/ yr</Typography>
                  </Typography>
                </Box>

                <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.15)' }} />

                <Box>
                  <Typography variant="caption" sx={{ opacity: 0.8, fontWeight: 700, display: 'block', color: '#ffd54f' }}>
                    🏆 SAVED UPTILL NOW ({liveMonths} mos)
                  </Typography>
                  <Typography variant="h5" fontWeight={900} sx={{ color: '#ffd54f', textShadow: '0 0 15px rgba(255,213,79,0.3)' }}>
                    {formatCurr(cumulativeSavingsVsOdooPKR)}
                  </Typography>
                </Box>
              </Card>
            </Grid>
          </Grid>
        </Paper>

        {/* Feature & Module Comparison Table */}
        <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 2 }}>
          📑 Module & Feature Inclusion Matrix
        </Typography>

        <TableContainer>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 800 }}>ERP Feature / Module</TableCell>
                <TableCell sx={{ fontWeight: 800, color: 'primary.main' }}>TOVUS ERP</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>SAP S/4HANA Cloud</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Odoo Enterprise</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>MS Dynamics 365</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {competitorMatrix.map((row, idx) => (
                <TableRow key={idx} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                  <TableCell sx={{ fontWeight: 700 }}>{row.module}</TableCell>
                  <TableCell sx={{ bgcolor: 'rgba(124,77,255,0.06)' }}>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <CheckIcon color="primary" fontSize="small" />
                      <Typography variant="caption" fontWeight={800} color="primary.main">
                        {row.ourStatus}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color={row.sapStatus.includes('Requires') || row.sapStatus.includes('Not') ? 'error.main' : 'text.primary'} fontWeight={600}>
                      {row.sapStatus}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color={row.odooStatus.includes('Requires') || row.odooStatus.includes('Not') ? 'warning.main' : 'text.primary'} fontWeight={600}>
                      {row.odooStatus}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color={row.dynamicsStatus.includes('Requires') || row.dynamicsStatus.includes('Not') ? 'error.main' : 'text.primary'} fontWeight={600}>
                      {row.dynamicsStatus}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Module Breakdown + Pie Chart */}
      <SectionTitle icon={<ChartIcon />} sub="Financial value managed per module">Module-wise Financial Breakdown</SectionTitle>
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider' }} elevation={0}>
            <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 2, textTransform: 'uppercase', letterSpacing: 1 }}>
              Total by Module (PKR)
            </Typography>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barChartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 600 }} />
                <YAxis tickFormatter={v => SHORT_PKR(v)} tick={{ fontSize: 11 }} width={80} />
                <RechartsTooltip formatter={v => [PKR(v), 'Amount']} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {barChartData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', height: '100%' }} elevation={0}>
            <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 2, textTransform: 'uppercase', letterSpacing: 1 }}>
              Value Share
            </Typography>
            {moduleBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={moduleBreakdown} cx="50%" cy="50%" innerRadius={55} outerRadius={95}
                    dataKey="value" nameKey="name" paddingAngle={3}>
                    {moduleBreakdown.map((m, i) => <Cell key={i} fill={m.color} />)}
                  </Pie>
                  <RechartsTooltip formatter={v => [PKR(v)]} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                  <Legend formatter={(v) => <span style={{ fontSize: 12, fontWeight: 600 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
                <Typography color="text.secondary">No financial data yet</Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Monthly Trend */}
      <SectionTitle icon={<TrendIcon />} sub="Last 12 months financial flow">Monthly Financial Trend</SectionTitle>
      <Paper sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider' }} elevation={0}>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={monthlyTrend} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
            <defs>
              <linearGradient id="gPayroll" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c4dff" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#7c4dff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gProc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00b0ff" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00b0ff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gFin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00e676" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00e676" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => SHORT_PKR(v)} tick={{ fontSize: 11 }} width={80} />
            <RechartsTooltip formatter={v => [PKR(v)]} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Area type="monotone" dataKey="payroll" name="HR & Payroll" stroke="#7c4dff" fill="url(#gPayroll)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="procurement" name="Procurement" stroke="#00b0ff" fill="url(#gProc)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="finance" name="Finance (AP)" stroke="#00e676" fill="url(#gFin)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Paper>

      {/* Detailed Module Tables */}
      <SectionTitle icon={<HRIcon />} sub="Payroll & workforce costs">HR & Payroll</SectionTitle>
      <Grid container spacing={2}>
        {[
          { label: 'Total Payroll Disbursed', value: PKR(hr.payrollDisbursed), badge: `${hr.payrollCount} payslips`, color: '#7c4dff' },
        ].map(({ label, value, badge, color }) => (
          <Grid item xs={12} sm={6} md={4} key={label}>
            <KpiCard label={label} value={value} sub={badge} color={color} icon={<HRIcon />} highlight />
          </Grid>
        ))}
      </Grid>

      <SectionTitle icon={<ProcIcon />} sub="Purchase orders, GRNs, vendor transactions">Procurement</SectionTitle>
      <Grid container spacing={2}>
        {[
          { label: 'Purchase Orders Total', value: PKR(procurement.purchaseOrdersTotal), badge: `${procurement.purchaseOrdersCount} POs`, color: '#00b0ff' },
          { label: 'Goods Received (GRN)', value: PKR(procurement.grnTotal), badge: `${procurement.grnCount} GRNs`, color: '#00acc1' },
          { label: 'Total Procurement', value: PKR(procurement.total), badge: 'PO + GRN combined', color: '#006064', highlight: true },
        ].map(({ label, value, badge, color, highlight }) => (
          <Grid item xs={12} sm={6} md={4} key={label}>
            <KpiCard label={label} value={value} sub={badge} color={color} icon={<ProcIcon />} highlight={highlight} />
          </Grid>
        ))}
      </Grid>

      <SectionTitle icon={<FinanceIcon />} sub="Vendor bills, journals, fixed assets, cash approvals">Finance</SectionTitle>
      <Grid container spacing={2}>
        {[
          { label: 'Vendor Bills (AP)', value: PKR(finance.vendorBillsTotal), badge: `${finance.vendorBillsCount} bills`, color: '#00e676' },
          { label: 'Journal Entries Debits', value: PKR(finance.journalEntriesTotal), badge: `${finance.journalEntriesCount} entries`, color: '#1de9b6' },
          { label: 'Fixed Assets Registered', value: PKR(finance.fixedAssetsTotal), badge: `${finance.fixedAssetsCount} assets`, color: '#69f0ae' },
          { label: 'Cash Approvals', value: PKR(finance.cashApprovalsTotal), badge: `${finance.cashApprovalsCount} approvals`, color: '#b9f6ca' },
          { label: 'Total Finance Value', value: PKR(finance.total), badge: 'All finance combined', color: '#00c853', highlight: true },
        ].map(({ label, value, badge, color, highlight }) => (
          <Grid item xs={12} sm={6} md={4} key={label}>
            <KpiCard label={label} value={value} sub={badge} color={color} icon={<FinanceIcon />} highlight={highlight} />
          </Grid>
        ))}
      </Grid>

      <SectionTitle icon={<TajIcon />} sub="CAM, water, electricity, land, property invoices">Taj Residencia</SectionTitle>
      <Grid container spacing={2}>
        {[
          { label: 'CAM Charges Billed', value: PKR(tajResidencia.camChargesTotal), badge: `${tajResidencia.camChargesCount} invoices`, color: '#ff9100' },
          { label: 'Water Charges', value: PKR(tajResidencia.waterChargesTotal), badge: `${tajResidencia.waterChargesCount} bills`, color: '#ff6d00' },
          { label: 'Electricity Bills', value: PKR(tajResidencia.electricityTotal), badge: `${tajResidencia.electricityCount} bills`, color: '#ffab40' },
          { label: 'Land Purchases', value: PKR(tajResidencia.landPurchasesTotal), badge: `${tajResidencia.landPurchasesCount} transactions`, color: '#ff3d00' },
          { label: 'Property Invoices', value: PKR(tajResidencia.propertyInvoicesTotal), badge: `${tajResidencia.propertyInvoicesCount} invoices`, color: '#dd2c00' },
          { label: 'Total Taj Residencia', value: PKR(tajResidencia.total), badge: 'All Taj modules', color: '#bf360c', highlight: true },
        ].map(({ label, value, badge, color, highlight }) => (
          <Grid item xs={12} sm={6} md={4} key={label}>
            <KpiCard label={label} value={value} sub={badge} color={color} icon={<TajIcon />} highlight={highlight} />
          </Grid>
        ))}
      </Grid>

      {/* User Activity */}
      <SectionTitle icon={<ActIcon />} sub="System usage statistics">User Activity & Usage</SectionTitle>
      <Grid container spacing={3}>
        {/* Activity Type Pie */}
        {activityPieData.length > 0 && (
          <Grid item xs={12} md={5}>
            <Paper sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider' }} elevation={0}>
              <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 2, textTransform: 'uppercase', letterSpacing: 1 }}>
                Action Types
              </Typography>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={activityPieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name" paddingAngle={2}>
                    {activityPieData.map((_, i) => <Cell key={i} fill={ACTIVITY_COLORS[i % ACTIVITY_COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                  <Legend formatter={v => <span style={{ fontSize: 11, fontWeight: 600 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        )}

        {/* Module Activity Table */}
        {moduleActivity?.length > 0 && (
          <Grid item xs={12} md={7}>
            <Paper sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }} elevation={0}>
              <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={1}>
                  Most Used Modules
                </Typography>
              </Box>
              <TableContainer sx={{ maxHeight: 260 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', color: 'text.secondary' }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', color: 'text.secondary' }}>Module</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', color: 'text.secondary' }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {moduleActivity.map((m, i) => (
                      <TableRow key={i} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                        <TableCell><Chip size="small" label={i + 1} sx={{ bgcolor: ACTIVITY_COLORS[i % ACTIVITY_COLORS.length], color: '#fff', fontWeight: 800, minWidth: 28 }} /></TableCell>
                        <TableCell sx={{ fontWeight: 600, textTransform: 'capitalize' }}>{String(m._id || 'Unknown').replace(/_/g, ' ')}</TableCell>
                        <TableCell align="right"><Typography fontWeight={700} color="primary.main">{Number(m.count).toLocaleString()}</Typography></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>
        )}
      </Grid>

      {/* Top Users */}
      {topUsers?.length > 0 && (
        <>
          <SectionTitle icon={<PeopleIcon />} sub="Most active users by total actions">Top Active Users</SectionTitle>
          <TableContainer component={Paper} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }} elevation={0}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  {['Rank', 'Name', 'Email', 'Total Actions'].map(h => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {topUsers.map((u, i) => (
                  <TableRow key={i} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                    <TableCell>
                      <Chip size="small" label={`#${i + 1}`}
                        sx={{ bgcolor: ACTIVITY_COLORS[i % ACTIVITY_COLORS.length], color: '#fff', fontWeight: 800, minWidth: 36 }} />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{u.username || '—'}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>{u.email}</TableCell>
                    <TableCell><Chip size="small" label={Number(u.actions).toLocaleString()} color="primary" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* Footer Note */}
      <Box sx={{ mt: 4, p: 2, borderRadius: 2, bgcolor: 'action.hover', textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          All figures represent the total financial volume managed through the ERP system since go-live ({formatDate(goLiveDate)}).
          Data is aggregated directly from the database in real-time.
        </Typography>
      </Box>
    </Box>
  );
}
