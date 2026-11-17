import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  TextField,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Tabs,
  Tab,
  Divider
} from '@mui/material';
import {
  FileDownload as FileDownloadIcon,
  Print as PrintIcon,
  OpenInNew as OpenInNewIcon,
  Refresh as RefreshIcon,
  Assessment as AssessmentIcon,
  FormatListNumbered as FormatListNumberedIcon,
  Business as BusinessIcon,
  CheckCircle as CheckCircleIcon,
  HourglassEmpty as HourglassEmptyIcon,
  TrendingUp as TrendingUpIcon,
  People as PeopleIcon
} from '@mui/icons-material';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';
import KPITabNavigation from '../../../components/HR/KPITabNavigation';
import { fetchKpiSubmissions } from '../../../services/kpiWorksheetService';
import useClientPagination from '../../../hooks/useClientPagination';

const MONTHS = [
  { v: 1, label: 'January' },
  { v: 2, label: 'February' },
  { v: 3, label: 'March' },
  { v: 4, label: 'April' },
  { v: 5, label: 'May' },
  { v: 6, label: 'June' },
  { v: 7, label: 'July' },
  { v: 8, label: 'August' },
  { v: 9, label: 'September' },
  { v: 10, label: 'October' },
  { v: 11, label: 'November' },
  { v: 12, label: 'December' }
];

const STATUS_META = {
  submitted: { label: 'Submitted by Employee', color: 'success' },
  manager_reviewed: { label: 'Submitted by Reporting Line', color: 'primary' },
  draft: { label: 'Draft (Pending)', color: 'warning' },
  not_started: { label: 'Not Started (Pending)', color: 'default' }
};

/** Default report period = previous calendar month (same as KPI Submission). */
const getDefaultKpiPeriod = (d = new Date()) => {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
};

const formatDateTime = (value) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-PK', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
};

const employeeName = (employee) =>
  [employee?.firstName, employee?.lastName].filter(Boolean).join(' ').trim() ||
  employee?.employeeId ||
  '—';

const isBlueCollarRecord = (r) => r?.employeeCategory === 'blue_collar';

/** Waiting on employee (white collar draft / not started). Blue collar does not self-submit. */
const isPendingByEmployee = (r) =>
  !isBlueCollarRecord(r) && (r.status === 'draft' || r.status === 'not_started');

/** Waiting on reporting line: white = employee submitted; blue = draft / not started. */
const isPendingByReportingLine = (r) => {
  if (isBlueCollarRecord(r)) return r.status === 'draft' || r.status === 'not_started';
  return r.status === 'submitted';
};

const KPIReports = () => {
  const [year, setYear] = useState(() => getDefaultKpiPeriod().year);
  const [month, setMonth] = useState(() => getDefaultKpiPeriod().month);
  const [projectId, setProjectId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [categoryTab, setCategoryTab] = useState('blue_collar'); // blue_collar | white_collar | all
  const [subViewTab, setSubViewTab] = useState(0); // 0: Summary, 1: Detailed Items, 2: Dept Analytics

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [records, setRecords] = useState([]);
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [categoryCounts, setCategoryCounts] = useState({ blueCollar: 0, whiteCollar: 0 });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchKpiSubmissions({
        year,
        month,
        projectId,
        departmentId,
        submittedOnly: false,
        search,
        employeeCategory: categoryTab === 'all' ? undefined : categoryTab
      });
      const data = res.data?.data || {};
      setRecords(data.records || []);
      setCategoryCounts({
        blueCollar: data.summary?.blueCollar || 0,
        whiteCollar: data.summary?.whiteCollar || 0
      });
      if (data.filterOptions) {
        setProjects(data.filterOptions.projects || []);
        setDepartments(data.filterOptions.departments || []);
      }
    } catch (err) {
      console.error('Failed to load KPI reports:', err);
      setError(err.response?.data?.message || 'Failed to fetch KPI monthly report data');
    } finally {
      setLoading(false);
    }
  }, [year, month, projectId, departmentId, search, categoryTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter records locally by status
  const filteredRecords = useMemo(() => {
    if (statusFilter === 'all') return records;
    if (statusFilter === 'pending_employee') return records.filter(isPendingByEmployee);
    if (statusFilter === 'pending_reporting_line') return records.filter(isPendingByReportingLine);
    return records.filter((r) => r.status === statusFilter);
  }, [records, statusFilter]);

  // Use full month set for headline cards (not status-filtered), so counts stay easy to scan
  const metrics = useMemo(() => {
    const total = records.length;
    const byEmployee = records.filter((r) => r.status === 'submitted').length;
    const byReportingLine = records.filter((r) => r.status === 'manager_reviewed').length;
    const pendingByEmployee = records.filter(isPendingByEmployee).length;
    const pendingByReportingLine = records.filter(isPendingByReportingLine).length;
    const scoredRecords = records.filter((r) => r.totalKPIScore != null && Number(r.totalKPIScore) > 0);
    const avgScore =
      scoredRecords.length > 0
        ? (scoredRecords.reduce((sum, r) => sum + Number(r.totalKPIScore), 0) / scoredRecords.length).toFixed(2)
        : '0.00';

    return {
      total,
      byEmployee,
      byReportingLine,
      pendingByEmployee,
      pendingByReportingLine,
      avgScore
    };
  }, [records]);

  // Department level aggregation
  const deptAnalytics = useMemo(() => {
    const map = new Map();
    filteredRecords.forEach((r) => {
      const deptName = r.department?.name || 'Unassigned Department';
      if (!map.has(deptName)) {
        map.set(deptName, {
          departmentName: deptName,
          totalCount: 0,
          submittedCount: 0,
          reviewedCount: 0,
          pendingByEmployee: 0,
          pendingByReportingLine: 0,
          scores: []
        });
      }
      const entry = map.get(deptName);
      entry.totalCount += 1;
      if (r.status === 'submitted') entry.submittedCount += 1; // by employee
      if (r.status === 'manager_reviewed') entry.reviewedCount += 1; // by reporting line
      if (isPendingByEmployee(r)) entry.pendingByEmployee += 1;
      if (isPendingByReportingLine(r)) entry.pendingByReportingLine += 1;
      if (r.totalKPIScore != null) entry.scores.push(Number(r.totalKPIScore));
    });

    return Array.from(map.values()).map((dept) => {
      const avg =
        dept.scores.length > 0
          ? (dept.scores.reduce((a, b) => a + b, 0) / dept.scores.length).toFixed(2)
          : '—';
      const completionRate =
        dept.totalCount > 0
          ? Math.round(((dept.submittedCount + dept.reviewedCount) / dept.totalCount) * 100)
          : 0;
      return { ...dept, avgScore: avg, completionRate };
    });
  }, [filteredRecords]);

  // Flattened detailed rows for itemized view
  const detailedRows = useMemo(() => {
    const list = [];
    filteredRecords.forEach((rec) => {
      const empNameStr = employeeName(rec.employee);
      const deptStr = rec.department?.name || 'Unassigned';
      const projStr = rec.project?.name || 'Unassigned';

      if (rec.rows && rec.rows.length > 0) {
        rec.rows.forEach((row, idx) => {
          list.push({
            id: `${rec.employee?._id || idx}-${idx}`,
            employeeId: rec.employee?.employeeId || '—',
            employeeName: empNameStr,
            department: deptStr,
            project: projStr,
            kpiArea: row.kpiArea || '—',
            weight: row.weight != null ? Number(row.weight).toFixed(2) : '—',
            employeeAchieved: row.employeeAchieved ?? row.achieved ?? 0,
            employeeTotalAssigned: row.employeeTotalAssigned ?? row.totalAssigned ?? 0,
            managerAchieved: row.managerAchieved ?? 0,
            managerTotalAssigned: row.managerTotalAssigned ?? 0,
            score1to5: row.score1to5 != null ? Number(row.score1to5).toFixed(2) : '—',
            finalWeightage: row.finalWeightage != null ? Number(row.finalWeightage).toFixed(2) : '—'
          });
        });
      } else {
        list.push({
          id: `${rec.employee?._id || 'none'}`,
          employeeId: rec.employee?.employeeId || '—',
          employeeName: empNameStr,
          department: deptStr,
          project: projStr,
          kpiArea: 'No KPI entries registered',
          weight: '—',
          employeeAchieved: '—',
          employeeTotalAssigned: '—',
          managerAchieved: '—',
          managerTotalAssigned: '—',
          score1to5: '—',
          finalWeightage: '—'
        });
      }
    });
    return list;
  }, [filteredRecords]);

  // Export Report to Excel
  const handleExportExcel = () => {
    if (filteredRecords.length === 0) {
      toast.error('No data available to export');
      return;
    }

    try {
      const selectedMonthLabel = MONTHS.find((m) => m.v === Number(month))?.label || month;

      // Sheet 1: KPI Summary
      const summaryData = filteredRecords.map((r) => ({
        'Year': year,
        'Month': selectedMonthLabel,
        'Employee ID': r.employee?.employeeId || '—',
        'Employee Name': employeeName(r.employee),
        'Designation': r.employee?.designation || '—',
        'Department': r.department?.name || 'Unassigned',
        'Project': r.project?.name || 'Unassigned',
        'Reporting Manager': r.employee?.reportingLine || '—',
        'Status': STATUS_META[r.status]?.label || r.status,
        'Total KPI Score (5)': r.totalKPIScore != null ? Number(r.totalKPIScore).toFixed(2) : '—',
        'Total Weightage (%)': r.totalWeight != null ? Number(r.totalWeight).toFixed(0) : '—',
        'Last Saved / Submitted': formatDateTime(r.lastSavedAt)
      }));

      // Sheet 2: Detailed KPI Breakdown
      const detailData = detailedRows.map((d) => ({
        'Year': year,
        'Month': selectedMonthLabel,
        'Employee ID': d.employeeId,
        'Employee Name': d.employeeName,
        'Department': d.department,
        'Project': d.project,
        'KPI Area': d.kpiArea,
        'Weightage (%)': d.weight,
        'Emp Achieved': d.employeeAchieved,
        'Emp Assigned': d.employeeTotalAssigned,
        'Manager Achieved': d.managerAchieved,
        'Manager Assigned': d.managerTotalAssigned,
        'Score (1-5)': d.score1to5,
        'Final Weighted Score': d.finalWeightage
      }));

      // Sheet 3: Department Analytics
      const deptData = deptAnalytics.map((da) => ({
        'Department': da.departmentName,
        'Total Employees': da.totalCount,
        'Submitted by Employee': da.submittedCount,
        'Submitted by Reporting Line': da.reviewedCount,
        'Pending by Employees': da.pendingByEmployee,
        'Pending by Reporting Line': da.pendingByReportingLine,
        'Completion Rate (%)': `${da.completionRate}%`,
        'Average KPI Score': da.avgScore
      }));

      const workbook = XLSX.utils.book_new();

      const wsSummary = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, wsSummary, 'KPI Summary');

      const wsDetail = XLSX.utils.json_to_sheet(detailData);
      XLSX.utils.book_append_sheet(workbook, wsDetail, 'Detailed KPI Items');

      const wsDept = XLSX.utils.json_to_sheet(deptData);
      XLSX.utils.book_append_sheet(workbook, wsDept, 'Dept Summary');

      const filename = `KPI_Monthly_Report_${year}_${selectedMonthLabel}.xlsx`;
      XLSX.writeFile(workbook, filename);
      toast.success(`Successfully downloaded ${filename}`);
    } catch (err) {
      console.error('Excel Export Error:', err);
      toast.error('Failed to generate Excel report');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const pg = useClientPagination(filteredRecords);
  const pg2 = useClientPagination(detailedRows);
  return (
    <Box sx={{ p: 3 }}>
      {/* Top Navigation Tabs */}
      <KPITabNavigation />

      <Tabs
        value={categoryTab}
        onChange={(_, v) => setCategoryTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="blue_collar" label={`Blue collar (${categoryCounts.blueCollar})`} />
        <Tab value="white_collar" label={`White collar (${categoryCounts.whiteCollar})`} />
        <Tab value="all" label="All" />
      </Tabs>

      {/* Header & Main Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} color="primary.main" gutterBottom>
            KPI Monthly Reports & Analytics
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Blue collar (supervisor marks) and white collar (employee + manager) reports, downloadable as Excel.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadData}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={handlePrint}
          >
            Print / PDF
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<FileDownloadIcon />}
            onClick={handleExportExcel}
            disabled={loading || filteredRecords.length === 0}
            sx={{ fontWeight: 600 }}
          >
            Export to Excel (.xlsx)
          </Button>
        </Stack>
      </Box>

      {/* Filter Card */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              fullWidth
              size="small"
              label="Year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              fullWidth
              size="small"
              label="Month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS.map((m) => (
                <MenuItem key={m.v} value={m.v}>
                  {m.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid item xs={12} sm={6} md={2.5}>
            <TextField
              select
              fullWidth
              size="small"
              label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <MenuItem value="">All Projects</MenuItem>
              {projects.map((p) => (
                <MenuItem key={p._id} value={p._id}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid item xs={12} sm={6} md={2.5}>
            <TextField
              select
              fullWidth
              size="small"
              label="Department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <MenuItem value="">All Departments</MenuItem>
              {departments.map((d) => (
                <MenuItem key={d._id} value={d._id}>
                  {d.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <TextField
              select
              fullWidth
              size="small"
              label="Submission Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="all">All Statuses</MenuItem>
              <MenuItem value="submitted">Submitted by Employee</MenuItem>
              <MenuItem value="manager_reviewed">Submitted by Reporting Line</MenuItem>
              <MenuItem value="pending_employee">Pending by Employees</MenuItem>
              <MenuItem value="pending_reporting_line">Pending by Reporting Line</MenuItem>
              <MenuItem value="draft">Draft only</MenuItem>
              <MenuItem value="not_started">Not Started only</MenuItem>
            </TextField>
          </Grid>

          <Grid item xs={12} md={12}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search by Employee ID, Employee Name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Grid>
        </Grid>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Metric Cards — clickable to filter by that status */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          {
            key: 'all',
            label: 'Total Employees',
            value: metrics.total,
            color: 'primary.main',
            icon: <PeopleIcon color="primary" sx={{ fontSize: 36, opacity: 0.8 }} />
          },
          {
            key: 'submitted',
            label: 'Submitted by Employee',
            value: metrics.byEmployee,
            color: 'success.main',
            icon: <CheckCircleIcon color="success" sx={{ fontSize: 36, opacity: 0.8 }} />
          },
          {
            key: 'manager_reviewed',
            label: 'Submitted by Reporting Line',
            value: metrics.byReportingLine,
            color: 'info.main',
            icon: <AssessmentIcon color="info" sx={{ fontSize: 36, opacity: 0.8 }} />
          },
          {
            key: 'pending_employee',
            label: 'Pending by Employees',
            value: metrics.pendingByEmployee,
            color: 'warning.main',
            icon: <HourglassEmptyIcon color="warning" sx={{ fontSize: 36, opacity: 0.8 }} />
          },
          {
            key: 'pending_reporting_line',
            label: 'Pending by Reporting Line',
            value: metrics.pendingByReportingLine,
            color: 'error.main',
            icon: <HourglassEmptyIcon color="error" sx={{ fontSize: 36, opacity: 0.8 }} />
          },
          {
            key: 'avg',
            label: 'Average KPI Score / 5',
            value: metrics.avgScore,
            color: 'secondary.main',
            icon: <TrendingUpIcon color="secondary" sx={{ fontSize: 36, opacity: 0.8 }} />
          }
        ].map((card) => (
          <Grid item xs={12} sm={6} md={4} lg={true} key={card.key}>
            <Card
              sx={{
                bgcolor: 'background.paper',
                borderLeft: 4,
                borderColor: card.color,
                cursor: card.key === 'avg' ? 'default' : 'pointer',
                outline: statusFilter === card.key ? '2px solid' : 'none',
                outlineColor: card.color,
                height: '100%'
              }}
              onClick={() => {
                if (card.key === 'avg') return;
                setStatusFilter(card.key === 'all' ? 'all' : card.key);
              }}
            >
              <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {card.label}
                    </Typography>
                    <Typography variant="h4" fontWeight={700} sx={{ color: card.color, lineHeight: 1.2 }}>
                      {card.value}
                    </Typography>
                    {card.sub && (
                      <Typography variant="caption" color="text.secondary">
                        {card.sub}
                      </Typography>
                    )}
                  </Box>
                  {card.icon}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Sub-view selection tabs */}
      <Paper elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={subViewTab} onChange={(e, val) => setSubViewTab(val)}>
          <Tab icon={<AssessmentIcon />} iconPosition="start" label="Summary Report" />
          <Tab icon={<FormatListNumberedIcon />} iconPosition="start" label="Detailed KPI Items" />
          <Tab icon={<BusinessIcon />} iconPosition="start" label="Department Analytics" />
        </Tabs>
      </Paper>

      {/* Content Rendering */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : filteredRecords.length === 0 ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          No KPI records match the selected year, month, or filters.
        </Alert>
      ) : (
        <>
          {/* Sub-View 0: Summary Report */}
          {subViewTab === 0 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead sx={{ bgcolor: 'action.hover' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Employee ID</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Employee Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Designation</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Department</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Project</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Reporting Line</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>KPI Score (5.0)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Weight %</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Last Saved</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700 }}>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pg.rows.map((row) => {
                    const statusMeta = STATUS_META[row.status] || STATUS_META.not_started;
                    return (
                      <TableRow key={row.employee?._id || row.worksheetId} hover>
                        <TableCell>{row.employee?.employeeId || '—'}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{employeeName(row.employee)}</TableCell>
                        <TableCell>{row.employee?.designation || '—'}</TableCell>
                        <TableCell>{row.department?.name || '—'}</TableCell>
                        <TableCell>{row.project?.name || '—'}</TableCell>
                        <TableCell>{row.employee?.reportingLine || '—'}</TableCell>
                        <TableCell>
                          <Chip size="small" label={statusMeta.label} color={statusMeta.color} variant="outlined" />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: 'primary.main' }}>
                          {row.totalKPIScore != null ? Number(row.totalKPIScore).toFixed(2) : '—'}
                        </TableCell>
                        <TableCell align="right">
                          {row.totalWeight != null ? `${Number(row.totalWeight).toFixed(0)}%` : '—'}
                        </TableCell>
                        <TableCell>{formatDateTime(row.lastSavedAt)}</TableCell>
                        <TableCell align="center">
                          <Button
                            component={RouterLink}
                            to={`/hr/kpi/sheet?employeeId=${row.employee?._id}&year=${year}&month=${month}`}
                            size="small"
                            endIcon={<OpenInNewIcon />}
                          >
                            Sheet
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>{pg.bar}
            </TableContainer>
          )}

          {/* Sub-View 1: Detailed KPI Items */}
          {subViewTab === 1 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead sx={{ bgcolor: 'action.hover' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Employee ID</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Employee Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Department</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>KPI Area</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Weight %</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Emp (Ach / Assg)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Manager (Ach / Assg)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Score (1-5)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Final Score</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pg2.rows.map((d) => (
                    <TableRow key={d.id} hover>
                      <TableCell>{d.employeeId}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{d.employeeName}</TableCell>
                      <TableCell>{d.department}</TableCell>
                      <TableCell sx={{ maxWidth: 300 }}>{d.kpiArea}</TableCell>
                      <TableCell align="right">{d.weight}</TableCell>
                      <TableCell align="right">{`${d.employeeAchieved} / ${d.employeeTotalAssigned}`}</TableCell>
                      <TableCell align="right">{`${d.managerAchieved} / ${d.managerTotalAssigned}`}</TableCell>
                      <TableCell align="right">{d.score1to5}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{d.finalWeightage}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>{pg2.bar}
            </TableContainer>
          )}

          {/* Sub-View 2: Department Analytics */}
          {subViewTab === 2 && (
            <Grid container spacing={3}>
              {deptAnalytics.map((dept) => (
                <Grid item xs={12} sm={6} md={4} key={dept.departmentName}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="h6" fontWeight={600} gutterBottom>
                        {dept.departmentName}
                      </Typography>
                      <Divider sx={{ my: 1 }} />
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">
                            Total Employees:
                          </Typography>
                          <Typography variant="body2" fontWeight={600}>
                            {dept.totalCount}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">
                            Submit By Employee:
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="success.main">
                            {dept.submittedCount}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">
                            Submit By Reporting Line:
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="info.main">
                            {dept.reviewedCount}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">
                            Pending by Employees:
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="warning.main">
                            {dept.pendingByEmployee}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">
                            Pending by Reporting Line:
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="warning.dark">
                            {dept.pendingByReportingLine}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">
                            Completion Rate:
                          </Typography>
                          <Typography variant="body2" fontWeight={600}>
                            {dept.completionRate}%
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="body2" color="text.secondary">
                            Average KPI Score:
                          </Typography>
                          <Typography variant="body2" fontWeight={700} color="primary.main">
                            {dept.avgScore} / 5.0
                          </Typography>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </>
      )}
    </Box>
  );
};

export default KPIReports;
