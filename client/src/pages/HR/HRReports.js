import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  Switch,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Radio,
  RadioGroup,
  Autocomplete,
  InputAdornment,
  Avatar,
  LinearProgress,
  CardHeader,
  CardActions,
  Badge,
  Stack,
  Container,
  useTheme,
  alpha
} from '@mui/material';
import { PageLoading, CardsSkeleton } from '../../components/LoadingSpinner';
import {
  DateRange,
  Download,
  Assessment,
  ExpandMore,
  FileDownload,
  Visibility,
  Description,
  TableChart,

  People,
  AttachMoney,
  Work,
  School,
  LocalHospital,
  AccountBalance,
  TrendingUp,
  FilterList,
  Refresh,
  Print,
  Share,
  BarChart,
  PieChart,
  Timeline,
  Business,
  LocationOn,
  CalendarToday,
  Person,
  Group,
  SupervisorAccount,
  Assignment,
  Payment,
  Receipt,
  AccountCircle,
  WorkOutline,
  BusinessCenter,
  EmojiEvents,
  Warning,
  CheckCircle,
  Cancel,
  Pending,
  Done,
  Schedule,
  Event,
  Today,
  Search,
  Clear,
  Save,
  GetApp,
  CloudDownload,
  Analytics,
  Dashboard,
  Report,
  Summarize,
  TrendingDown,
  TrendingFlat,
  Money,
  AccountBalanceWallet,
  CreditCard,
  ReceiptLong,
  MoreVert,
  Info,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  TrendingFlat as TrendingFlatIcon
} from '@mui/icons-material';
import { formatPKR } from '../../utils/currency';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const HRReports = () => {
  const theme = useTheme();
  
  // State management
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState('csv');
  const [selectedReport, setSelectedReport] = useState('employee_summary');
  const [viewMode, setViewMode] = useState('summary'); // 'summary' or 'detailed'
  
  // Date filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  
  // Filter states
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [salaryRangeFilter, setSalaryRangeFilter] = useState('');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('');
  
  // Payroll-specific filters
  const [payrollMonth, setPayrollMonth] = useState((new Date().getMonth() + 1).toString().padStart(2, '0'));
  const [payrollYear, setPayrollYear] = useState(new Date().getFullYear().toString());
  const [compareMonth, setCompareMonth] = useState('');
  const [compareYear, setCompareYear] = useState('');
  const [salaryRangeMin, setSalaryRangeMin] = useState('');
  const [salaryRangeMax, setSalaryRangeMax] = useState('');
  const [deductionType, setDeductionType] = useState('');
  
  // Data states
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [employees, setEmployees] = useState([]);

  // Months array for payroll reports
  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' }
  ];

  // Report types with light colors
  const reportTypes = [
    {
      id: 'employee_summary',
      name: 'Employee Summary Report',
      description: 'Comprehensive overview of all employees with key metrics',
      icon: <People />,
      category: 'Employee',
      color: '#1976d2',
      bgColor: '#e3f2fd'
    },
    {
      id: 'salary_analysis',
      name: 'Salary Analysis Report',
      description: 'Detailed salary breakdown by department, designation, and range',
      icon: <AttachMoney />,
      category: 'Financial',
      color: '#388e3c',
      bgColor: '#e8f5e8'
    },
    {
      id: 'attendance_report',
      name: 'Attendance Report',
      description: 'Employee attendance patterns and statistics',
      icon: <Work />,
      category: 'Attendance',
      color: '#0288d1',
      bgColor: '#e1f5fe'
    },
    {
      id: 'payroll_report',
      name: 'Payroll Report',
      description: 'Monthly payroll summary with earnings and deductions',
      icon: <Payment />,
      category: 'Financial',
      color: '#f57c00',
      bgColor: '#fff3e0'
    },
    {
      id: 'department_payroll_report',
      name: 'Department Payroll Report',
      description: 'Payroll analysis by specific department with cost breakdown',
      icon: <Business />,
      category: 'Financial',
      color: '#7b1fa2',
      bgColor: '#f3e5f5'
    },
    {
      id: 'monthly_comparison_report',
      name: 'Monthly Comparison Report',
      description: 'Compare payroll costs across different months and years',
      icon: <Timeline />,
      category: 'Financial',
      color: '#d32f2f',
      bgColor: '#ffebee'
    },
    {
      id: 'salary_range_report',
      name: 'Salary Range Analysis',
      description: 'Analyze employee distribution across salary ranges',
      icon: <BarChart />,
      category: 'Analytics',
      color: '#388e3c',
      bgColor: '#e8f5e8'
    },
    {
      id: 'deduction_analysis_report',
      name: 'Deduction Analysis Report',
      description: 'Detailed breakdown of all deductions and taxes',
      icon: <Receipt />,
      category: 'Financial',
      color: '#ff9800',
      bgColor: '#fff8e1'
    },
    {
      id: 'executive_payroll_summary',
      name: 'Executive Payroll Summary',
      description: 'High-level payroll summary for management review',
      icon: <SupervisorAccount />,
      category: 'Analytics',
      color: '#1976d2',
      bgColor: '#e3f2fd'
    },
    {
      id: 'loan_report',
      name: 'Loan Management Report',
      description: 'Employee loans, outstanding amounts, and repayment status',
      icon: <AccountBalance />,
      category: 'Financial',
      color: '#d32f2f',
      bgColor: '#ffebee'
    },
    {
      id: 'provident_fund_report',
      name: 'Provident Fund Report',
      description: 'PF contributions and balances for all employees',
      icon: <AccountBalanceWallet />,
      category: 'Benefits',
      color: '#7b1fa2',
      bgColor: '#f3e5f5'
    },
    {
      id: 'eobi_report',
      name: 'EOBI Report',
      description: 'EOBI contributions and compliance status',
      icon: <LocalHospital />,
      category: 'Benefits',
      color: '#388e3c',
      bgColor: '#e8f5e8'
    },
    {
      id: 'leave_report',
      name: 'Leave Management Report',
      description: 'Employee leave balances and usage patterns',
      icon: <CalendarToday />,
      category: 'Attendance',
      color: '#0288d1',
      bgColor: '#e1f5fe'
    },
    {
      id: 'recruitment_report',
      name: 'Recruitment Report',
      description: 'Hiring statistics and recruitment pipeline',
      icon: <Person />,
      category: 'Recruitment',
      color: '#1976d2',
      bgColor: '#e3f2fd'
    },
    {
      id: 'turnover_report',
      name: 'Employee Turnover Report',
      description: 'Employee retention and turnover analysis',
      icon: <TrendingDown />,
      category: 'Analytics',
      color: '#d32f2f',
      bgColor: '#ffebee'
    },
    {
      id: 'performance_report',
      name: 'Performance Report',
      description: 'Employee performance metrics and ratings',
      icon: <EmojiEvents />,
      category: 'Performance',
      color: '#f57c00',
      bgColor: '#fff3e0'
    },
    {
      id: 'settlement_report',
      name: 'Final Settlement Report',
      description: 'Employee settlements and exit processing',
      icon: <ReceiptLong />,
      category: 'HR',
      color: '#7b1fa2',
      bgColor: '#f3e5f5'
    },
    {
      id: 'compliance_report',
      name: 'Compliance Report',
      description: 'Legal compliance and regulatory requirements',
      icon: <CheckCircle />,
      category: 'Compliance',
      color: '#388e3c',
      bgColor: '#e8f5e8'
    },
    {
      id: 'cost_analysis',
      name: 'HR Cost Analysis',
      description: 'Total HR costs including salaries, benefits, and overheads',
      icon: <Analytics />,
      category: 'Financial',
      color: '#d32f2f',
      bgColor: '#ffebee'
    },
    {
      id: 'demographics_report',
      name: 'Demographics Report',
      description: 'Employee demographics and diversity statistics',
      icon: <Group />,
      category: 'Analytics',
      color: '#0288d1',
      bgColor: '#e1f5fe'
    }
  ];

  // Tab categories with light colors
  const tabCategories = [
    { 
      label: 'Employee Reports', 
      value: 0,
      icon: <People />,
      color: '#1976d2'
    },
    { 
      label: 'Financial Reports', 
      value: 1,
      icon: <AttachMoney />,
      color: '#388e3c'
    },
    { 
      label: 'Attendance Reports', 
      value: 2,
      icon: <Work />,
      color: '#0288d1'
    },
    { 
      label: 'Benefits Reports', 
      value: 3,
      icon: <AccountBalance />,
      color: '#7b1fa2'
    },
    { 
      label: 'Analytics Reports', 
      value: 4,
      icon: <Analytics />,
      color: '#f57c00'
    }
  ];

  // Load initial data - only run once on mount
  useEffect(() => {
    loadInitialData();
  }, []); // Empty dependency array - only run once

  const loadInitialData = async () => {
    try {
      setLoading(true);
      
      // Load departments (no auth required)
      console.log('Loading departments...');
      try {
        const deptResponse = await api.get('/hr/departments');
        console.log('Departments loaded:', deptResponse.data);
        setDepartments(deptResponse.data.data || []);
      } catch (deptError) {
        console.error('Error loading departments:', deptError);
        setDepartments([]);
      }
      
      // Load designations (requires auth)
      console.log('Loading designations...');
      try {
        const desigResponse = await api.get('/designations');
        console.log('Designations loaded:', desigResponse.data);
        setDesignations(desigResponse.data.data || []);
      } catch (desigError) {
        console.error('Error loading designations:', desigError);
        setDesignations([]);
        if (desigError.response?.status === 403) {
          setSnackbar({
            open: true,
            message: 'Designations data not available due to permissions. Reports will work with available data.',
            severity: 'warning'
          });
        }
      }
      
      // Load employees for filters (requires auth)
      console.log('Loading employees...');
      try {
        const empResponse = await api.get('/hr/employees');
        console.log('Employees loaded:', empResponse.data);
        setEmployees(empResponse.data.data || []);
      } catch (empError) {
        console.error('Error loading employees:', empError);
        setEmployees([]);
        if (empError.response?.status === 403) {
          setSnackbar({
            open: true,
            message: 'Employees data not available due to permissions. Reports will work with available data.',
            severity: 'warning'
          });
        }
      }
      
      console.log('Initial data loading completed');
      
    } catch (error) {
      console.error('Unexpected error loading initial data:', error);
      setSnackbar({
        open: true,
        message: 'Error loading initial data. Please refresh the page.',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  // Generate report
  const generateReport = async (format = 'json', isDownload = false) => {
    if (!selectedReport) {
      setSnackbar({
        open: true,
        message: 'Please select a report type',
        severity: 'error'
      });
      return;
    }

    setLoading(true);
    try {
      const params = {
        reportType: selectedReport,
        startDate,
        endDate,
        month: payrollMonth,
        year: payrollYear,
        compareMonth,
        compareYear,
        department: departmentFilter,
        designation: designationFilter,
        status: statusFilter,
        salaryRange: salaryRangeFilter,
        employmentType: employmentTypeFilter,
        salaryRangeMin,
        salaryRangeMax,
        deductionType,
        format
      };

      const response = await api.get('/hr/reports', {
        params,
        responseType: format === 'csv' ? 'blob' : 'json'
      });

      if (isDownload) {
        // Handle file download
        const blob = new Blob([response.data], { 
          type: 'text/csv' 
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${selectedReport}-${payrollMonth || 'all'}-${payrollYear || 'data'}.${format}`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        setSnackbar({
          open: true,
          message: `Report downloaded successfully as ${format.toUpperCase()}`,
          severity: 'success'
        });
      } else {
        // Handle JSON response
        setReportData(response.data);
        console.log('Report Data Received:', response.data); // Debug log
        setSnackbar({
          open: true,
          message: 'Report generated successfully',
          severity: 'success'
        });
      }
    } catch (error) {
      console.error('Error generating report:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error generating report',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle tab change
  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  // Get reports by category
  const getReportsByCategory = (category) => {
    const categoryMap = {
      0: 'Employee',
      1: 'Financial',
      2: 'Attendance',
      3: 'Benefits',
      4: 'Analytics'
    };
    return reportTypes.filter(report => report.category === categoryMap[category]);
  };

  // Clear filters
  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setMonth('');
    setYear(new Date().getFullYear().toString());
    setDepartmentFilter('');
    setDesignationFilter('');
    setStatusFilter('');
    setSalaryRangeFilter('');
    setEmploymentTypeFilter('');
    
    // Clear payroll-specific filters
    setPayrollMonth((new Date().getMonth() + 1).toString().padStart(2, '0'));
    setPayrollYear(new Date().getFullYear().toString());
    setCompareMonth('');
    setCompareYear('');
    setSalaryRangeMin('');
    setSalaryRangeMax('');
    setDeductionType('');
  };

  // Open download dialog
  const openDownloadDialog = () => {
    setDownloadDialogOpen(true);
  };

  // Handle download
  const handleDownload = () => {
    generateReport(selectedFormat, true);
    setDownloadDialogOpen(false);
  };

  // Format date
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Get status color
  const getStatusColor = (status) => {
    const colors = {
      active: 'success',
      inactive: 'error',
      pending: 'warning',
      approved: 'success',
      rejected: 'error',
      completed: 'info'
    };
    return colors[status] || 'default';
  };

  // Get selected report info
  const getSelectedReportInfo = () => {
    return reportTypes.find(report => report.id === selectedReport);
  };

  // Check if selected report is payroll-related
  const isPayrollReport = () => {
    const payrollReportIds = [
      'payroll_report',
      'department_payroll_report',
      'monthly_comparison_report',
      'salary_range_report',
      'deduction_analysis_report',
      'executive_payroll_summary'
    ];
    return payrollReportIds.includes(selectedReport);
  };

  // Check if selected report needs comparison dates
  const needsComparisonDates = () => {
    return selectedReport === 'monthly_comparison_report';
  };

  // Show loading state for initial data loading
  const pg = useClientPagination(reportData?.data);
  if (loading && departments.length === 0 && designations.length === 0 && employees.length === 0) {
    return (
      <PageLoading 
        message="Loading HR reports..." 
        showSkeleton={true}
        skeletonType="cards"
      />
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Light Header */}
      <Card sx={{ mb: 3, background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)', color: '#1976d2' }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
                <Assessment sx={{ mr: 2, verticalAlign: 'middle', fontSize: '2rem' }} />
                HR Reports & Analytics
              </Typography>
              <Typography variant="body1" sx={{ opacity: 0.9 }}>
                Comprehensive HR reports and analytics for informed decision making
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={loadInitialData}
                disabled={loading}
                sx={{ 
                  color: '#1976d2', 
                  borderColor: '#1976d2',
                  '&:hover': { borderColor: '#1976d2', backgroundColor: 'rgba(25,118,210,0.1)' }
                }}
              >
                Refresh
              </Button>
              {reportData && (
                <Button
                  variant="contained"
                  startIcon={<Download />}
                  onClick={openDownloadDialog}
                  sx={{ 
                    backgroundColor: '#1976d2', 
                    color: 'white',
                    '&:hover': { backgroundColor: '#1565c0' }
                  }}
                >
                  Download
                </Button>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Quick Access Payroll Reports */}
      <Card sx={{ mb: 3, background: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)', border: '1px solid', borderColor: '#ffb74d' }}>
        <CardContent>
          <Typography variant="h6" gutterBottom sx={{ color: '#f57c00', fontWeight: 600 }}>
            🚀 Quick Access - Payroll Reports
          </Typography>
          <Typography variant="body2" sx={{ color: '#f57c00', mb: 2, opacity: 0.9 }}>
            Generate common payroll reports quickly for management review
          </Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Payment />}
                onClick={() => {
                  setSelectedReport('payroll_report');
                  setPayrollMonth((new Date().getMonth() + 1).toString().padStart(2, '0'));
                  setPayrollYear(new Date().getFullYear().toString());
                  generateReport();
                }}
                sx={{ 
                  borderColor: '#f57c00', 
                  color: '#f57c00',
                  '&:hover': { borderColor: '#e65100', backgroundColor: 'rgba(245,124,0,0.1)' }
                }}
              >
                Current Month Payroll
              </Button>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Business />}
                onClick={() => {
                  setSelectedReport('department_payroll_report');
                  setPayrollMonth((new Date().getMonth() + 1).toString().padStart(2, '0'));
                  setPayrollYear(new Date().getFullYear().toString());
                  generateReport();
                }}
                sx={{ 
                  borderColor: '#7b1fa2', 
                  color: '#7b1fa2',
                  '&:hover': { borderColor: '#4a148c', backgroundColor: 'rgba(123,31,162,0.1)' }
                }}
              >
                Department Analysis
              </Button>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Timeline />}
                onClick={() => {
                  setSelectedReport('monthly_comparison_report');
                  setPayrollMonth((new Date().getMonth() + 1).toString().padStart(2, '0'));
                  setPayrollYear(new Date().getFullYear().toString());
                  generateReport();
                }}
                sx={{ 
                  borderColor: '#d32f2f', 
                  color: '#d32f2f',
                  '&:hover': { borderColor: '#b71c1c', backgroundColor: 'rgba(211,47,47,0.1)' }
                }}
              >
                Monthly Comparison
              </Button>
            </Grid>
            
            <Grid item xs={12} sm={6} md={3}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<SupervisorAccount />}
                onClick={() => {
                  setSelectedReport('executive_payroll_summary');
                  setPayrollMonth((new Date().getMonth() + 1).toString().padStart(2, '0'));
                  setPayrollYear(new Date().getFullYear().toString());
                  generateReport();
                }}
                sx={{ 
                  borderColor: '#1976d2', 
                  color: '#1976d2',
                  '&:hover': { borderColor: '#0d47a1', backgroundColor: 'rgba(25,118,210,0.1)' }
                }}
              >
                Executive Summary
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Light Report Categories Tabs */}
      <Card sx={{ mb: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <CardContent sx={{ p: 0 }}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ 
              borderBottom: 1, 
              borderColor: 'divider',
              '& .MuiTab-root': {
                minHeight: 64,
                fontSize: '0.9rem',
                fontWeight: 600
              }
            }}
          >
            {tabCategories.map((tab) => (
              <Tab
                key={tab.value}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {tab.icon}
                    {tab.label}
                  </Box>
                }
                value={tab.value}
                sx={{
                  color: tab.color,
                  '&.Mui-selected': {
                    color: tab.color,
                    fontWeight: 'bold'
                  }
                }}
              />
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Enhanced Report Configuration */}
      <Grid container spacing={3}>
        {/* Light Report Selection */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: 'fit-content', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Description sx={{ color: theme.palette.primary.main }} />
                  <Typography variant="h6">Select Report</Typography>
                </Box>
              }
              sx={{ pb: 1 }}
            />
            <CardContent>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Report Type</InputLabel>
                <Select
                  value={selectedReport}
                  onChange={(e) => setSelectedReport(e.target.value)}
                  label="Report Type"
                >
                  {getReportsByCategory(activeTab).map((report) => (
                    <MenuItem key={report.id} value={report.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                        <Avatar sx={{ 
                          bgcolor: report.bgColor, 
                          color: report.color,
                          width: 32,
                          height: 32
                        }}>
                          {report.icon}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {report.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {report.description}
                          </Typography>
                        </Box>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button
                variant="contained"
                fullWidth
                startIcon={<Visibility />}
                onClick={() => generateReport('json', false)}
                disabled={loading || !selectedReport}
                sx={{ 
                  py: 1.5,
                  fontSize: '1rem',
                  fontWeight: 600
                }}
              >
                {loading ? <CircularProgress size={20} /> : 'Generate Report'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Light Date Filters */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: 'fit-content', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DateRange sx={{ color: theme.palette.info.main }} />
                  <Typography variant="h6">Date Range</Typography>
                </Box>
              }
              sx={{ pb: 1 }}
            />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Start Date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    size="small"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="End Date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Month"
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Year"
                    type="number"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">Y</InputAdornment>
                    }}
                    size="small"
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Light Additional Filters */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: 'fit-content', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FilterList sx={{ color: theme.palette.warning.main }} />
                  <Typography variant="h6">Filters</Typography>
                </Box>
              }
              sx={{ pb: 1 }}
            />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Department</InputLabel>
                    <Select
                      value={departmentFilter}
                      onChange={(e) => setDepartmentFilter(e.target.value)}
                      label="Department"
                    >
                      <MenuItem value="">All Departments</MenuItem>
                      {departments.length > 0 ? (
                        departments.map((dept) => (
                          <MenuItem key={dept._id} value={dept._id}>
                            {dept.name}
                          </MenuItem>
                        ))
                      ) : (
                        <MenuItem disabled>No departments available</MenuItem>
                      )}
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={12}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Designation</InputLabel>
                    <Select
                      value={designationFilter}
                      onChange={(e) => setDesignationFilter(e.target.value)}
                      label="Designation"
                    >
                      <MenuItem value="">All Designations</MenuItem>
                      {designations.length > 0 ? (
                        designations.map((desig) => (
                          <MenuItem key={desig._id} value={desig._id}>
                            {desig.title}
                          </MenuItem>
                        ))
                      ) : (
                        <MenuItem disabled>No designations available</MenuItem>
                      )}
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={12} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      label="Status"
                    >
                      <MenuItem value="">All Status</MenuItem>
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="inactive">Inactive</MenuItem>
                      <MenuItem value="pending">Pending</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                
                {/* Payroll-specific filters */}
                {isPayrollReport() && (
                  <>
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Payroll Month</InputLabel>
                        <Select
                          value={payrollMonth}
                          onChange={(e) => setPayrollMonth(e.target.value)}
                          label="Payroll Month"
                        >
                          {months.map((month) => (
                            <MenuItem key={month.value} value={month.value}>
                              {month.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    
                    <Grid item xs={12} md={3}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Payroll Year"
                        value={payrollYear}
                        onChange={(e) => setPayrollYear(e.target.value)}
                        inputProps={{ min: 2020, max: 2030 }}
                      />
                    </Grid>
                    
                    {needsComparisonDates() && (
                      <>
                        <Grid item xs={12} md={3}>
                          <FormControl fullWidth size="small">
                            <InputLabel>Compare Month</InputLabel>
                            <Select
                              value={compareMonth}
                              onChange={(e) => setCompareMonth(e.target.value)}
                              label="Compare Month"
                            >
                              <MenuItem value="">Select Month</MenuItem>
                              {months.map((month) => (
                                <MenuItem key={month.value} value={month.value}>
                                  {month.label}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        
                        <Grid item xs={12} md={3}>
                          <TextField
                            fullWidth
                            size="small"
                            type="number"
                            label="Compare Year"
                            value={compareYear}
                            onChange={(e) => setCompareYear(e.target.value)}
                            inputProps={{ min: 2020, max: 2030 }}
                          />
                        </Grid>
                      </>
                    )}
                    
                    {selectedReport === 'salary_range_report' && (
                      <>
                        <Grid item xs={12} md={3}>
                          <TextField
                            fullWidth
                            size="small"
                            type="number"
                            label="Min Salary"
                            value={salaryRangeMin}
                            onChange={(e) => setSalaryRangeMin(e.target.value)}
                            placeholder="0"
                          />
                        </Grid>
                        
                        <Grid item xs={12} md={3}>
                          <TextField
                            fullWidth
                            size="small"
                            type="number"
                            label="Max Salary"
                            value={salaryRangeMax}
                            onChange={(e) => setSalaryRangeMax(e.target.value)}
                            placeholder="1000000"
                          />
                        </Grid>
                      </>
                    )}
                    
                    {selectedReport === 'deduction_analysis_report' && (
                      <Grid item xs={12} md={3}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Deduction Type</InputLabel>
                          <Select
                            value={deductionType}
                            onChange={(e) => setDeductionType(e.target.value)}
                            label="Deduction Type"
                          >
                            <MenuItem value="">All Deductions</MenuItem>
                            <MenuItem value="providentFund">Provident Fund</MenuItem>
                            <MenuItem value="eobi">EOBI</MenuItem>
                            <MenuItem value="incomeTax">Income Tax</MenuItem>
                            <MenuItem value="other">Other Deductions</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                    )}
                  </>
                )}
                
                <Grid item xs={12}>
                  <Button
                    variant="outlined"
                    fullWidth
                    startIcon={<Clear />}
                    onClick={clearFilters}
                    size="small"
                  >
                    Clear Filters
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Light Report Results */}
      {reportData && (
        <Box sx={{ mt: 3 }}>
          <Card sx={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ 
                    bgcolor: getSelectedReportInfo()?.bgColor, 
                    color: getSelectedReportInfo()?.color 
                  }}>
                    {getSelectedReportInfo()?.icon}
                  </Avatar>
                  <Box>
                    <Typography variant="h6">
                      {getSelectedReportInfo()?.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {getSelectedReportInfo()?.description}
                    </Typography>
                  </Box>
                </Box>
              }
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="outlined"
                    startIcon={<Print />}
                    size="small"
                  >
                    Print
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<Share />}
                    size="small"
                  >
                    Share
                  </Button>
                </Box>
              }
            />
            
            <CardContent>
              {/* Payroll Report Summary for Management */}
              {isPayrollReport() && reportData.summary && (
                <Box sx={{ mb: 4, p: 3, bgcolor: 'primary.50', borderRadius: 2, border: '1px solid', borderColor: 'primary.200' }}>
                  <Typography variant="h6" color="primary.main" gutterBottom sx={{ fontWeight: 600 }}>
                    📊 Executive Summary - {months.find(m => m.value === payrollMonth)?.label} {payrollYear}
                  </Typography>
                  
                  <Grid container spacing={3}>
                    <Grid item xs={12} sm={6} md={3}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'primary.300' }}>
                        <Typography variant="h4" color="primary.main" sx={{ fontWeight: 'bold' }}>
                          {reportData.summary.totalEmployees || 0}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          Total Employees
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6} md={3}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'success.300' }}>
                        <Typography variant="h4" color="success.main" sx={{ fontWeight: 'bold' }}>
                          {formatPKR(reportData.summary.totalGrossSalary || 0)}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          Total Gross Payroll
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6} md={3}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'warning.300' }}>
                        <Typography variant="h4" color="warning.main" sx={{ fontWeight: 'bold' }}>
                          {formatPKR(reportData.summary.totalDeductions || 0)}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          Total Deductions
                        </Typography>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12} sm={6} md={3}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'info.300' }}>
                        <Typography variant="h4" color="info.main" sx={{ fontWeight: 'bold' }}>
                          {formatPKR(reportData.summary.totalNetSalary || 0)}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          Total Net Payroll
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                  
                  {/* Additional Payroll Insights */}
                  <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                      💡 Key Insights:
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="body2">
                          <strong>Employees with Payroll:</strong> {reportData.summary.employeesWithPayroll || 0}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="body2">
                          <strong>Average Gross Salary:</strong> {formatPKR(reportData.summary.averageGrossSalary || 0)}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="body2">
                          <strong>Average Net Salary:</strong> {formatPKR(reportData.summary.averageNetSalary || 0)}
                        </Typography>
                      </Grid>
                      {reportData.summary.totalProvidentFund && (
                        <Grid item xs={12} sm={6} md={3}>
                          <Typography variant="body2">
                            <strong>Provident Fund:</strong> {formatPKR(reportData.summary.totalProvidentFund)}
                          </Typography>
                        </Grid>
                      )}
                      {reportData.summary.totalEOBI && (
                        <Grid item xs={12} sm={6} md={3}>
                          <Typography variant="body2">
                            <strong>EOBI:</strong> {formatPKR(reportData.summary.totalEOBI)}
                          </Typography>
                        </Grid>
                      )}
                      {reportData.summary.totalIncomeTax && (
                        <Grid item xs={12} sm={6} md={3}>
                          <Typography variant="body2">
                            <strong>Income Tax:</strong> {formatPKR(reportData.summary.totalIncomeTax)}
                          </Typography>
                        </Grid>
                      )}
                    </Grid>
                  </Box>
                </Box>
              )}
              
              {/* View Mode Toggle */}
              <Box sx={{ mb: 3 }}>
                <FormControl component="fieldset">
                  <RadioGroup
                    row
                    value={viewMode}
                    onChange={(e) => setViewMode(e.target.value)}
                  >
                    <FormControlLabel 
                      value="summary" 
                      control={<Radio />} 
                      label="Summary View" 
                    />
                    <FormControlLabel 
                      value="detailed" 
                      control={<Radio />} 
                      label="Detailed View" 
                    />
                  </RadioGroup>
                </FormControl>
              </Box>
              
              {/* Enhanced Report Summary */}
              {reportData.summary && viewMode === 'summary' && (
                <Grid container spacing={3} sx={{ mb: 3 }}>
                  {Object.entries(reportData.summary).map(([key, value]) => (
                    <Grid item xs={12} sm={6} md={3} key={key}>
                      <Card 
                        variant="outlined" 
                        sx={{ 
                          p: 2,
                          textAlign: 'center',
                          transition: 'all 0.3s ease',
                          backgroundColor: '#fafafa',
                          borderColor: '#e0e0e0',
                          '&:hover': {
                            transform: 'translateY(-2px)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                            backgroundColor: '#f5f5f5'
                          }
                        }}
                      >
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </Typography>
                        <Typography 
                          variant="h4" 
                          color="primary"
                          sx={{ fontWeight: 'bold' }}
                        >
                          {typeof value === 'number' && key.toLowerCase().includes('salary') 
                            ? formatPKR(value) 
                            : typeof value === 'number' && key.toLowerCase().includes('rate')
                            ? `${value.toFixed(1)}%`
                            : typeof value === 'number'
                            ? value.toLocaleString()
                            : value}
                        </Typography>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}

              {/* Payroll Management Recommendations */}
              {isPayrollReport() && reportData.summary && (
                <Box sx={{ mb: 4, p: 3, bgcolor: 'warning.50', borderRadius: 2, border: '1px solid', borderColor: 'warning.200' }}>
                  <Typography variant="h6" color="warning.main" gutterBottom sx={{ fontWeight: 600 }}>
                    🎯 Management Insights & Recommendations
                  </Typography>
                  
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                        📈 Cost Analysis:
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemIcon>
                            <TrendingUpIcon color="success" />
                          </ListItemIcon>
                          <ListItemText 
                            primary="Payroll Cost per Employee" 
                            secondary={`${formatPKR((reportData.summary.totalGrossSalary || 0) / (reportData.summary.totalEmployees || 1))}`}
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemIcon>
                            <TrendingDownIcon color="warning" />
                          </ListItemIcon>
                          <ListItemText 
                            primary="Deduction Rate" 
                            secondary={`${((reportData.summary.totalDeductions || 0) / (reportData.summary.totalGrossSalary || 1) * 100).toFixed(1)}%`}
                          />
                        </ListItem>
                      </List>
                    </Grid>
                    
                    <Grid item xs={12} md={6}>
                      <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                        💡 Recommendations:
                      </Typography>
                      <List dense>
                        <ListItem>
                          <ListItemIcon>
                            <Info color="info" />
                          </ListItemIcon>
                          <ListItemText 
                            primary="Review high-salary outliers" 
                            secondary="Consider salary benchmarking"
                          />
                        </ListItem>
                        <ListItem>
                          <ListItemIcon>
                            <Info color="info" />
                          </ListItemIcon>
                          <ListItemText 
                            primary="Optimize deduction structure" 
                            secondary="Maximize tax benefits"
                          />
                        </ListItem>
                      </List>
                    </Grid>
                  </Grid>
                </Box>
              )}

              {/* Debug Information for Payroll Reports */}
              {isPayrollReport() && reportData && (
                <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.300' }}>
                  <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                    🔍 Debug Information:
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    Summary Keys: {Object.keys(reportData.summary || {}).join(', ')}
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    Data Length: {reportData.data ? reportData.data.length : 'No data array'}
                  </Typography>
                  {reportData.data && reportData.data.length > 0 && (
                    <Typography variant="body2" color="textSecondary" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      First Row Keys: {Object.keys(reportData.data[0]).join(', ')}
                    </Typography>
                  )}
                </Box>
              )}

              {/* Enhanced Report Data Table */}
              {reportData.data && reportData.data.length > 0 && (
                <Box>
                  <Typography variant="h6" gutterBottom>
                    Detailed Data ({reportData.data.length} records)
                  </Typography>
                  <TableContainer 
                    component={Paper} 
                    variant="outlined"
                                         sx={{ 
                       maxHeight: 600,
                       '& .MuiTableHead-root': {
                         backgroundColor: '#f5f5f5'
                       }
                     }}
                  >
                    <Table stickyHeader>
                      <TableHead>
                        <TableRow>
                          {Object.keys(reportData.data[0]).map((header) => (
                            <TableCell 
                              key={header}
                                                             sx={{ 
                                 fontWeight: 'bold',
                                 backgroundColor: '#f5f5f5'
                               }}
                            >
                              {header.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {pg.rows.map((row, index) => (
                          <TableRow 
                            key={index}
                                                         sx={{ 
                               '&:nth-of-type(odd)': { backgroundColor: '#fafafa' },
                               '&:hover': { backgroundColor: '#f0f0f0' }
                             }}
                          >
                            {Object.values(row).map((cell, cellIndex) => (
                              <TableCell key={cellIndex}>
                                {typeof cell === 'boolean' ? (
                                  <Chip
                                    label={cell ? 'Yes' : 'No'}
                                    color={cell ? 'success' : 'default'}
                                    size="small"
                                    variant="outlined"
                                  />
                                ) : typeof cell === 'string' && cell.includes('PKR') ? (
                                  formatPKR(parseFloat(cell.replace(/[^\d.]/g, '')))
                                ) : typeof cell === 'number' && cell > 1000 ? (
                                  cell.toLocaleString()
                                ) : cell}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>{pg.bar}
                  </TableContainer>
                </Box>
              )}

              {/* No Data Message */}
              {(!reportData.data || reportData.data.length === 0) && (
                <Alert 
                  severity="info"
                  sx={{ 
                    mt: 2,
                    '& .MuiAlert-icon': { fontSize: '2rem' }
                  }}
                >
                  <Typography variant="h6" gutterBottom>
                    No data found
                  </Typography>
                  <Typography>
                    No data found for the selected criteria. Please adjust your filters and try again.
                  </Typography>
                </Alert>
              )}
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Enhanced Download Dialog */}
      <Dialog 
        open={downloadDialogOpen} 
        onClose={() => setDownloadDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Download sx={{ color: theme.palette.primary.main }} />
            Download Report
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" gutterBottom>
            Select your preferred format for downloading the report:
          </Typography>
          <FormControl component="fieldset" sx={{ mt: 2 }}>
            <RadioGroup
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value)}
            >
              <FormControlLabel 
                value="csv" 
                control={<Radio />} 
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TableChart sx={{ color: theme.palette.success.main }} />
                    CSV Spreadsheet (Recommended)
                  </Box>
                } 
              />
              <FormControlLabel 
                value="excel" 
                control={<Radio />} 
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TableChart sx={{ color: theme.palette.info.main }} />
                    Excel Spreadsheet
                  </Box>
                } 
              />
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDownloadDialogOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleDownload} 
            variant="contained"
            startIcon={<Download />}
          >
            Download
          </Button>
        </DialogActions>
      </Dialog>

      {/* Enhanced Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default HRReports; 