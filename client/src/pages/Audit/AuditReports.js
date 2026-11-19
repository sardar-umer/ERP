import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Alert,
  useTheme,
  Stack,
  Divider,
  Skeleton
} from '@mui/material';
import {
  Assessment as AssessmentIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import api from '../../services/api';
import { printTovusElement } from '../../utils/tovusPrintBrand';

const AuditReports = () => {
  const theme = useTheme();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [reportType, setReportType] = useState('summary');
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: ''
  });

  const fetchReportData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams({
        reportType,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      
      const response = await api.get(`/audit/reports?${params.toString()}`);
      setReportData(response.data.data);
    } catch (err) {
      console.error('Error fetching audit report:', err);
      setError(err.response?.data?.message || 'Failed to fetch audit report.');
    } finally {
      setLoading(false);
    }
  }, [reportType, dateRange]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const handleReportTypeChange = (event) => {
    setReportType(event.target.value);
  };

  const handleDateChange = (field) => (event) => {
    setDateRange({
      ...dateRange,
      [field]: event.target.value
    });
  };

  const handleExportReport = (format) => {
    // Implement export functionality
    console.log(`Exporting report as ${format}`);
  };

  const getChartData = () => {
    if (!reportData) return [];
    
    switch (reportType) {
      case 'summary':
        return [
          { name: 'Total Audits', value: reportData.totalAudits || 0 },
          { name: 'Completed', value: reportData.completedAudits || 0 },
          { name: 'In Progress', value: reportData.inProgressAudits || 0 },
          { name: 'Planned', value: reportData.plannedAudits || 0 }
        ];
      case 'findings':
        return [
          { name: 'Critical', value: reportData.criticalFindings || 0 },
          { name: 'High', value: reportData.highFindings || 0 },
          { name: 'Medium', value: reportData.mediumFindings || 0 },
          { name: 'Low', value: reportData.lowFindings || 0 }
        ];
      case 'compliance':
        return [
          { name: 'Compliant', value: reportData.compliantItems || 0 },
          { name: 'Non-Compliant', value: reportData.nonCompliantItems || 0 },
          { name: 'Under Review', value: reportData.underReviewItems || 0 }
        ];
      default:
        return [];
    }
  };

  const getChartColors = () => {
    switch (reportType) {
      case 'summary':
        return [theme.palette.primary.main, theme.palette.success.main, theme.palette.warning.main, theme.palette.info.main];
      case 'findings':
        return [theme.palette.error.main, theme.palette.error.light, theme.palette.warning.main, theme.palette.success.main];
      case 'compliance':
        return [theme.palette.success.main, theme.palette.error.main, theme.palette.warning.main];
      default:
        return [theme.palette.primary.main];
    }
  };

  const renderSummaryReport = () => (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Audit Overview
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={getChartData()}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                >
                  {getChartData().map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getChartColors()[index % getChartColors().length]} />
                  ))}
                </Pie>
                <RechartsTooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Key Metrics
            </Typography>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1">Total Audits</Typography>
                <Chip 
                  label={reportData?.totalAudits || 0} 
                  color="primary" 
                  icon={<AssessmentIcon />}
                />
              </Box>
              <Divider />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1">Completion Rate</Typography>
                <Chip 
                  label={`${reportData?.completionRate || 0}%`} 
                  color={reportData?.completionRate > 80 ? 'success' : 'warning'}
                  icon={<CheckCircleIcon />}
                />
              </Box>
              <Divider />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1">Avg. Duration</Typography>
                <Typography variant="body2" color="textSecondary">
                  {reportData?.averageDuration || 'N/A'} days
                </Typography>
              </Box>
              <Divider />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1">Total Findings</Typography>
                <Chip 
                  label={reportData?.totalFindings || 0} 
                  color="error"
                  icon={<WarningIcon />}
                />
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  const renderFindingsReport = () => (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Findings by Severity
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={getChartData()}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                <Bar dataKey="value" fill={theme.palette.primary.main} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Findings Trends
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={reportData?.findingsTrend || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                <Line type="monotone" dataKey="critical" stroke={theme.palette.error.main} />
                <Line type="monotone" dataKey="high" stroke={theme.palette.error.light} />
                <Line type="monotone" dataKey="medium" stroke={theme.palette.warning.main} />
                <Line type="monotone" dataKey="low" stroke={theme.palette.success.main} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  const renderComplianceReport = () => (
    <Grid container spacing={3}>
      <Grid item xs={12} md={8}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Compliance Status
            </Typography>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={reportData?.complianceByModule || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="module" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                <Bar dataKey="compliant" stackId="a" fill={theme.palette.success.main} />
                <Bar dataKey="nonCompliant" stackId="a" fill={theme.palette.error.main} />
                <Bar dataKey="underReview" stackId="a" fill={theme.palette.warning.main} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={4}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Compliance Score
            </Typography>
            <Box sx={{ textAlign: 'center', mt: 4 }}>
              <Typography variant="h2" sx={{ 
                fontWeight: 'bold',
                color: reportData?.complianceScore > 90 ? 'success.main' : 
                       reportData?.complianceScore > 70 ? 'warning.main' : 'error.main'
              }}>
                {reportData?.complianceScore || 0}%
              </Typography>
              <Typography variant="h6" color="textSecondary" sx={{ mt: 1 }}>
                Overall Compliance
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  const LoadingSkeleton = () => (
    <Box sx={{ p: 3 }}>
      <Skeleton variant="text" width={260} height={48} />
      <Skeleton variant="text" width={360} height={24} sx={{ mb: 3 }} />
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2}>
          {[3, 2, 2, 2, 3].map((size, idx) => (
            <Grid item xs={12} md={size} key={idx}>
              <Skeleton variant="rounded" height={48} />
            </Grid>
          ))}
        </Grid>
      </Paper>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Skeleton variant="rounded" height={320} />
        </Grid>
        <Grid item xs={12} md={6}>
          <Skeleton variant="rounded" height={320} />
        </Grid>
      </Grid>
    </Box>
  );

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box className="tv-audit-report" sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', color: theme.palette.primary.dark }}>
        <AssessmentIcon sx={{ mr: 1, verticalAlign: 'middle' }} /> Audit Reports
      </Typography>
      <Typography variant="subtitle1" color="textSecondary" sx={{ mb: 3 }}>
        Generate comprehensive audit reports and analytics.
      </Typography>

      {/* Report Controls */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Report Type</InputLabel>
              <Select
                value={reportType}
                label="Report Type"
                onChange={handleReportTypeChange}
              >
                <MenuItem value="summary">Summary Report</MenuItem>
                <MenuItem value="findings">Findings Report</MenuItem>
                <MenuItem value="compliance">Compliance Report</MenuItem>
                <MenuItem value="trends">Trends Analysis</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              label="Start Date"
              type="date"
              fullWidth
              value={dateRange.startDate}
              onChange={handleDateChange('startDate')}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              label="End Date"
              type="date"
              fullWidth
              value={dateRange.endDate}
              onChange={handleDateChange('endDate')}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <Button
              variant="contained"
              onClick={fetchReportData}
              fullWidth
            >
              Generate Report
            </Button>
          </Grid>
          <Grid item xs={12} md={3}>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => handleExportReport('pdf')}
                size="small"
              >
                PDF
              </Button>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => handleExportReport('excel')}
                size="small"
              >
                Excel
              </Button>
              <Button
                variant="outlined"
                startIcon={<PrintIcon />}
                onClick={() => printTovusElement('.tv-audit-report', { title: 'Audit Report', fit: false, strip: [':scope > .MuiTypography-h4'] })}
                size="small"
              >
                Print
              </Button>
            </Stack>
          </Grid>
        </Grid>
      </Paper>

      {/* Report Content */}
      {reportData && (
        <Box>
          {reportType === 'summary' && renderSummaryReport()}
          {reportType === 'findings' && renderFindingsReport()}
          {reportType === 'compliance' && renderComplianceReport()}
          {reportType === 'trends' && (
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Audit Trends Analysis
                </Typography>
                <Alert severity="info">
                  Trends analysis report will be available in the next update.
                </Alert>
              </CardContent>
            </Card>
          )}
        </Box>
      )}

      {!reportData && (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <AssessmentIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="textSecondary">
              Select a report type and date range to generate your audit report
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default AuditReports;
