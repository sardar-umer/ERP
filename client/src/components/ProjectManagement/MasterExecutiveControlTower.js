import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Grid, Card, CardContent, Stack, Chip, CircularProgress,
  Alert, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Tooltip, IconButton, Button, Dialog, DialogContent
} from '@mui/material';
import {
  AccountTree as StructureIcon, TrendingUp as ProgressIcon, AttachMoney as MoneyIcon,
  CheckCircle as CheckIcon, Warning as WarningIcon, Refresh as RefreshIcon,
  Visibility as ViewIcon, Business as UnitIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, LineChart, Line
} from 'recharts';
import { getProjectRollup } from '../../services/projectManagementService';
import { getImageUrl } from '../../utils/imageService';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));

export default function MasterExecutiveControlTower({ masterProjectId, onClose }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const loadRollup = useCallback(async () => {
    if (!masterProjectId) return;
    try {
      setLoading(true);
      setError('');
      const res = await getProjectRollup(masterProjectId);
      if (res.data?.success) {
        setData(res.data.data);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load master project rollup');
    } finally {
      setLoading(false);
    }
  }, [masterProjectId]);

  useEffect(() => {
    loadRollup();
  }, [loadRollup]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={300} p={4}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
          Consolidating Upper-Level Master Metrics for Senior Management…
        </Typography>
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={loadRollup}>Retry</Button>}>
        {error || 'No rollup data found'}
      </Alert>
    );
  }

  const { masterProject, summaryMetrics, cbsCostBreakdown, subUnitBreakdown } = data;
  const progressColor = summaryMetrics.masterOverallProgress >= 80 ? 'success' : summaryMetrics.masterOverallProgress >= 40 ? 'warning' : 'error';

  const COLORS = ['#1a237e', '#00b0ff', '#00e676', '#ff9100', '#d500f9', '#ff1744'];
  const BAR_COLORS = ['#3f51b5', '#00bcd4', '#4caf50', '#ff9800', '#9c27b0', '#e91e63', '#009688'];

  const pieData = Object.entries(cbsCostBreakdown || {})
    .map(([name, val]) => ({ name, value: val.actual || val.estimated || 0 }))
    .filter((d) => d.value > 0);

  if (pieData.length === 0) {
    pieData.push({ name: 'Budget Allocated', value: summaryMetrics.grandEstimatedBudget || 100000 });
  }

  const barData = (subUnitBreakdown || []).map((u, i) => ({
    name: u.name.length > 12 ? `${u.name.substring(0, 12)}…` : u.name,
    progress: u.completionPercentage || 0,
    fillColor: BAR_COLORS[i % BAR_COLORS.length]
  }));

  const budgetVsActualBarData = (subUnitBreakdown || []).map((u) => ({
    name: u.name.length > 10 ? `${u.name.substring(0, 10)}…` : u.name,
    budget: u.estimatedBudget || 0,
    spent: u.actualCost || Math.round((u.estimatedBudget * (u.completionPercentage || 0)) / 100)
  }));

  const sCurveData = data.sCurveData && data.sCurveData.length > 0 ? data.sCurveData : [
    { month: 'Start', planned: 0, actual: 0 },
    { month: 'Current', planned: summaryMetrics.masterOverallProgress || 0, actual: summaryMetrics.masterOverallProgress || 0 }
  ];

  const cashFlowTrendData = data.cashFlowTrendData && data.cashFlowTrendData.length > 0 ? data.cashFlowTrendData : [
    { month: 'Spent', cashOutflow: summaryMetrics.grandActualCost || summaryMetrics.grnTotalSpent || 0 },
    { month: '30-Day Forecast', cashOutflow: summaryMetrics.cashDemandForecast30Days || 0 }
  ];

  return (
    <Box sx={{ pb: 2 }}>
      {/* Executive Gold Header Bar */}
      <Paper
        elevation={4}
        sx={{
          p: 3, mb: 3, borderRadius: 3, border: '1px solid #c5a059',
          background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
          color: '#ffffff'
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box
              sx={{
                width: 52, height: 52, borderRadius: '50%',
                bgcolor: 'rgba(197, 160, 89, 0.2)', border: '2px solid #c5a059',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <Typography sx={{ fontSize: 28 }}>👑</Typography>
            </Box>
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h4" fontWeight={800} sx={{ color: '#f5d77f', letterSpacing: 0.5 }}>
                  {masterProject.name}
                </Typography>
                <Chip
                  label="CEO EXECUTIVE CONTROL TOWER"
                  size="small"
                  sx={{
                    bgcolor: '#c5a059', color: '#000000', fontWeight: 800, fontSize: '0.65rem',
                    letterSpacing: 0.8
                  }}
                />
              </Stack>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mt: 0.5 }}>
                Upper-Level Portfolio Dashboard • Consolidating {summaryMetrics.totalSubUnits} Sub-Units & Villa Construction Lifecycles
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <IconButton onClick={loadRollup} sx={{ color: '#f5d77f' }} title="Refresh Rollup Data">
              <RefreshIcon />
            </IconButton>
            {onClose && (
              <Button
                variant="outlined"
                size="small"
                onClick={onClose}
                sx={{ borderColor: '#c5a059', color: '#f5d77f', textTransform: 'none', fontWeight: 700 }}
              >
                Back to Projects List
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>

      {/* Summary KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Tooltip title="Click to view Cost Breakdown Structure (CBS)">
            <Card variant="outlined" 
              onClick={() => document.getElementById('cbs-matrix')?.scrollIntoView({ behavior: 'smooth' })}
              sx={{
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s',
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 3, borderColor: 'primary.main' }
              }}
            >
              <CardContent>
                <Typography variant="caption" color="text.secondary">Total Master Budget</Typography>
                <Typography variant="h5" fontWeight={700} color="primary.main">
                  {fmt(summaryMetrics.grandEstimatedBudget)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Across {summaryMetrics.totalSubUnits} Sub-Units
                </Typography>
              </CardContent>
            </Card>
          </Tooltip>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Tooltip title="Click to view Budget vs Actual Expenditure Chart">
            <Card variant="outlined"
              onClick={() => document.getElementById('budget-vs-actual-chart')?.scrollIntoView({ behavior: 'smooth' })}
              sx={{
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s',
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 3, borderColor: 'primary.main' }
              }}
            >
              <CardContent>
                <Typography variant="caption" color="text.secondary">Total Actual Spent</Typography>
                <Typography variant="h5" fontWeight={700} color={summaryMetrics.costVariance > 0 ? 'error.main' : 'success.main'}>
                  {fmt(summaryMetrics.grandActualCost)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Variance: {fmt(summaryMetrics.costVariance)} ({summaryMetrics.costHealthStatus})
                </Typography>
              </CardContent>
            </Card>
          </Tooltip>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Tooltip title="Click to view Sub-Project performance details">
            <Card variant="outlined"
              onClick={() => document.getElementById('villas-grid')?.scrollIntoView({ behavior: 'smooth' })}
              sx={{
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s',
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 3, borderColor: 'primary.main' }
              }}
            >
              <CardContent>
                <Typography variant="caption" color="text.secondary">Physical Completion</Typography>
                <Typography variant="h5" fontWeight={700} color="info.main">
                  {summaryMetrics.masterOverallProgress}%
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <LinearProgress variant="determinate" value={summaryMetrics.masterOverallProgress} color={progressColor} sx={{ height: 6, borderRadius: 3 }} />
                </Box>
              </CardContent>
            </Card>
          </Tooltip>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Tooltip title="Click to open Procurement Module">
            <Card variant="outlined"
              onClick={() => navigate('/procurement')}
              sx={{
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s',
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 3, borderColor: 'primary.main' }
              }}
            >
              <CardContent>
                <Typography variant="caption" color="text.secondary">Procurement & AP Bills</Typography>
                <Typography variant="h6" fontWeight={600}>
                  GRN: {fmt(summaryMetrics.grnTotalSpent)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  AP Bills: {fmt(summaryMetrics.apTotalSpent)}
                </Typography>
              </CardContent>
            </Card>
          </Tooltip>
        </Grid>
      </Grid>      {/* EVM & Cash Demand Row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Tooltip title="Click to view schedule S-Curve analytics">
            <Card variant="outlined" 
              onClick={() => document.getElementById('s-curve-chart')?.scrollIntoView({ behavior: 'smooth' })}
              sx={{
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s',
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 3, borderColor: 'primary.main' }
              }}
            >
              <CardContent>
                <Typography variant="caption" color="text.secondary">Earned Value (EV)</Typography>
                <Typography variant="h6" fontWeight={700} color="primary.main">
                  {fmt(summaryMetrics.earnedValueManagement?.earnedValue)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Budgeted value of completed work
                </Typography>
              </CardContent>
            </Card>
          </Tooltip>
        </Grid>

        <Grid item xs={12} md={4}>
          <Tooltip title="Click to view Budget vs Actual expenditure chart">
            <Card variant="outlined"
              onClick={() => document.getElementById('budget-vs-actual-chart')?.scrollIntoView({ behavior: 'smooth' })}
              sx={{
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s',
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 3, borderColor: 'primary.main' }
              }}
            >
              <CardContent>
                <Typography variant="caption" color="text.secondary">Cost Performance Index (CPI)</Typography>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="h6" fontWeight={700} color={summaryMetrics.earnedValueManagement?.cpi >= 1.0 ? 'success.main' : 'error.main'}>
                    {summaryMetrics.earnedValueManagement?.cpi || 1.0}
                  </Typography>
                  <Chip
                    label={summaryMetrics.earnedValueManagement?.cpiStatus} size="small"
                    color={summaryMetrics.earnedValueManagement?.cpi >= 1.0 ? 'success' : 'error'}
                    sx={{ height: 18, fontSize: '0.65rem' }}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {summaryMetrics.earnedValueManagement?.cpi >= 1.0 ? 'Within approved cost parameters' : 'Over budget trend detected'}
                </Typography>
              </CardContent>
            </Card>
          </Tooltip>
        </Grid>

        <Grid item xs={12} md={4}>
          <Tooltip title="Click to view Cash Flow Trend Forecast chart">
            <Card variant="outlined"
              onClick={() => document.getElementById('cash-flow-chart')?.scrollIntoView({ behavior: 'smooth' })}
              sx={{
                borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s',
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 3, borderColor: 'primary.main' }
              }}
            >
              <CardContent>
                <Typography variant="caption" color="text.secondary">30-Day Liquidity Demand Forecast</Typography>
                <Typography variant="h6" fontWeight={700} color="warning.main">
                  {fmt(summaryMetrics.cashDemandForecast30Days)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Projected cash requirement for next 30 days
                </Typography>
              </CardContent>
            </Card>
          </Tooltip>
        </Grid>
      </Grid>

      {/* Ground Visual Verification Stream */}
      {data.groundPhotoStream?.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            📷 Ground Visual Verification Stream (Inspection Report Photos)
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Grid container spacing={2}>
            {data.groundPhotoStream.map((photo, idx) => (
              <Grid item xs={12} sm={6} md={3} key={idx}>
                <Tooltip title="Click to preview full-size photo">
                  <Card variant="outlined"
                    onClick={() => setSelectedPhoto(photo.url)}
                    sx={{
                      borderRadius: 2, height: '100%', cursor: 'pointer', transition: 'all 0.2s',
                      '&:hover': { transform: 'scale(1.02)', boxShadow: 3 }
                    }}
                  >
                    <Box
                      component="img"
                      src={getImageUrl(photo.url) || 'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b7?w=600&auto=format&fit=crop&q=80'}
                      alt={photo.caption}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b7?w=600&auto=format&fit=crop&q=80';
                      }}
                      sx={{ width: '100%', height: 130, objectFit: 'cover', borderBottom: '1px solid', borderColor: 'divider' }}
                    />
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="caption" fontWeight={600} display="block" noWrap>
                        {photo.projectName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" noWrap>
                        {photo.caption}
                      </Typography>
                      {photo.isVerifiedLocation && (
                        <Chip label="📍 GPS Verified Location" size="small" color="success" sx={{ fontSize: '0.6rem', height: 16, mt: 0.5 }} />
                      )}
                    </CardContent>
                  </Card>
                </Tooltip>
              </Grid>
            ))}
          </Grid>
        </Paper>
      )}

      {/* Interactive Executive Visual Analytics Section (Pie Chart & Bar Chart) */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {/* CBS Cost Share Donut Pie Chart */}
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" id="cbs-donut-chart" sx={{ p: 2.5, borderRadius: 2, height: 380, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MoneyIcon color="primary" /> CBS Cost Share Breakdown (Executive Donut Chart)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Proportional financial expenditure split across Materials, Labor, Equipment, and Subcontractors
            </Typography>
            <ResponsiveContainer width="100%" height={290}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={105}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="#ffffff" strokeWidth={2} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(value) => [fmt(value), 'Cost Incurred']} />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Villa Units Physical Progress Multi-Color Bar Chart */}
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" id="subunit-progress-chart" sx={{ p: 2.5, borderRadius: 2, height: 380, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ProgressIcon color="primary" /> Sub-Units Physical Completion (Multi-Color Bar Chart)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Distinct color-coded physical completion percentage per Villa unit
            </Typography>
            <ResponsiveContainer width="100%" height={290}>
              <BarChart data={barData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} unit="%" />
                <RechartsTooltip formatter={(value) => [`${value}%`, 'Completion']} />
                <Bar dataKey="progress" name="Physical Progress %" radius={[8, 8, 0, 0]}>
                  {barData.map((entry, index) => (
                    <Cell key={`bar-cell-${index}`} fill={entry.fillColor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* 3. S-Curve Cumulative Progress (Planned vs Actual Line Chart) */}
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" id="s-curve-chart" sx={{ p: 2.5, borderRadius: 2, height: 380 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              📈 Master Project S-Curve (Planned vs Actual Line Chart)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Cumulative schedule performance comparing planned milestone timeline vs actual ground progress
            </Typography>
            <ResponsiveContainer width="100%" height={290}>
              <LineChart data={sCurveData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis domain={[0, 100]} unit="%" />
                <RechartsTooltip formatter={(value) => [`${value}%`, 'Progress']} />
                <Legend />
                <Line type="monotone" dataKey="planned" name="Planned S-Curve %" stroke="#1976d2" strokeWidth={3} dot={{ r: 5 }} />
                <Line type="monotone" dataKey="actual" name="Actual Ground Progress %" stroke="#2e7d32" strokeWidth={3} dot={{ r: 5 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* 4. Sub-Unit Budget vs Actual Spend Comparison (Grouped Bar Chart) */}
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" id="budget-vs-actual-chart" sx={{ p: 2.5, borderRadius: 2, height: 380 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              📊 Budget vs Actual Expenditure (Grouped Bar Chart)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Side-by-side financial comparison of approved budget vs actual incurred cost per Villa
            </Typography>
            <ResponsiveContainer width="100%" height={290}>
              <BarChart data={budgetVsActualBarData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <RechartsTooltip formatter={(value) => [fmt(value), 'Amount']} />
                <Legend />
                <Bar dataKey="budget" name="Approved Budget" fill="#0288d1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spent" name="Actual Spent" fill="#ed6c02" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
      </Grid>

      {/* CBS Breakdown & Unit Drill-down Matrix */}
      <Grid container spacing={3}>
        {/* Cost Breakdown Structure (CBS) Matrix */}
        <Grid item xs={12} md={5}>
          <Paper variant="outlined" id="cbs-matrix" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MoneyIcon color="primary" /> Cost Breakdown Structure (CBS)
            </Typography>
            <Divider sx={{ my: 1.5 }} />

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Cost Category</strong></TableCell>
                    <TableCell align="right"><strong>Estimated</strong></TableCell>
                    <TableCell align="right"><strong>Actual Spent</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(cbsCostBreakdown).map(([cat, val]) => (
                    <TableRow key={cat}>
                      <TableCell><Typography variant="body2">{cat}</Typography></TableCell>
                      <TableCell align="right">{fmt(val.estimated)}</TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={600} color={val.actual > val.estimated && val.estimated > 0 ? 'error.main' : 'text.primary'}>
                          {fmt(val.actual)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        {/* Sub-Projects / Villa Drill-down Table */}
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" id="villas-grid" sx={{ p: 2.5, borderRadius: 2 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <UnitIcon color="primary" /> Sub-Project Units Performance (Villas Grid)
            </Typography>
            <Divider sx={{ my: 1.5 }} />

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Sub-Unit / Villa</strong></TableCell>
                    <TableCell><strong>Status</strong></TableCell>
                    <TableCell><strong>Progress</strong></TableCell>
                    <TableCell align="right"><strong>Approved Budget</strong></TableCell>
                    <TableCell align="right"><strong>Action</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {subUnitBreakdown.map((unit) => (
                    <TableRow key={unit._id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>{unit.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{unit.projectNumber || unit.projectType}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={unit.healthStatus} size="small"
                          color={unit.healthStatus === 'On Track' ? 'success' : 'error'}
                          sx={{ fontSize: '0.65rem', height: 20 }}
                        />
                      </TableCell>
                      <TableCell sx={{ minWidth: 100 }}>
                        <Stack spacing={0.5}>
                          <Typography variant="caption" fontWeight={600}>{unit.completionPercentage}%</Typography>
                          <LinearProgress variant="determinate" value={unit.completionPercentage} color={unit.completionPercentage >= 80 ? 'success' : unit.completionPercentage >= 40 ? 'warning' : 'error'} sx={{ height: 5, borderRadius: 2 }} />
                        </Stack>
                      </TableCell>
                      <TableCell align="right">{fmt(unit.estimatedBudget)}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="Drill-Down to Villa Details">
                          <IconButton size="small" color="primary" onClick={() => navigate(`/general/project-management/${unit._id}`)}>
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>



      {/* Photo Preview Dialog */}
      <Dialog open={Boolean(selectedPhoto)} onClose={() => setSelectedPhoto(null)} maxWidth="lg">
        <DialogContent sx={{ p: 0, bgcolor: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <Box
            component="img"
            src={getImageUrl(selectedPhoto)}
            alt="Inspection photo preview"
            sx={{ maxWidth: '100%', maxHeight: '85vh', display: 'block', objectFit: 'contain' }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
}
