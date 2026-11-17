import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Container,
  Stack,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  useTheme,
  alpha,
  Fade,
  Divider
} from '@mui/material';
import {
  AttachMoney,
  Download,
  ArrowBack,
  TrendingUp,
  TrendingDown,
  People,
  AccountBalance,
  Receipt,
  GetApp,
  Search
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { formatPKR } from '../../../utils/currency';
import api from '../../../services/api';
import useClientPagination from '../../../hooks/useClientPagination';

const PayrollReport = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { reportType } = useParams();
  
  // State management
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [reportData, setReportData] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [departments, setDepartments] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [filters, setFilters] = useState({
    month: 8, // August 2025 (has complete data for all 679 employees)
    year: 2025,
    department: '',
    project: '',
    format: 'json'
  });

  // Months array
  const months = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' }
  ];

  // Years array (last 5 years)
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  // Report configurations
  const reportConfigs = {
    monthly: {
      title: 'Monthly Payroll Summary',
      description: 'Complete monthly payroll breakdown for all employees',
      icon: <AttachMoney />,
      color: '#4caf50'
    },
    department: {
      title: 'Department-wise Payroll',
      description: 'Payroll analysis grouped by department',
      icon: <People />,
      color: '#2196f3'
    },
    salary: {
      title: 'Salary Analysis',
      description: 'Detailed salary structure and analysis',
      icon: <TrendingUp />,
      color: '#ff9800'
    }
  };

  const currentConfig = reportConfigs[reportType] || reportConfigs.monthly;

  // Load departments
  const loadDepartments = async () => {
    setLoadingDepartments(true);
    try {
      const response = await api.get('/hr/departments');
      if (response.data.success) {
        setDepartments(response.data.data || []);
      }
    } catch (error) {
      console.error('Error loading departments:', error);
    } finally {
      setLoadingDepartments(false);
    }
  };

  // Load projects
  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const response = await api.get('/projects');
      if (response.data.success) {
        setProjects(response.data.data || []);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoadingProjects(false);
    }
  };

  // Load report data
  const loadReportData = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/hr/reports/payroll/${reportType}`, {
        params: {
          month: filters.month,
          year: filters.year,
          department: filters.department,
          project: filters.project,
          format: 'json'
        }
      });

      if (response.data.success) {
        setReportData(response.data.data);
      } else {
        setSnackbar({ open: true, message: response.data.message || 'Failed to load report data', severity: 'error' });
      }
    } catch (error) {
      console.error('Error loading report:', error);
      setSnackbar({ open: true, message: 'Error loading report data', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Export report
  const exportReport = async (format) => {
    try {
      const response = await api.get(`/hr/reports/payroll/${reportType}`, {
        params: {
          month: filters.month,
          year: filters.year,
          department: filters.department,
          project: filters.project,
          format: format
        },
        responseType: format === 'csv' ? 'blob' : 'json'
      });

      if (format === 'csv') {
        const blob = new Blob([response.data], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${reportType}-payroll-${filters.month}-${filters.year}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
      } else {
        // Handle PDF export
        setSnackbar({ open: true, message: 'PDF export coming soon!', severity: 'info' });
      }
    } catch (error) {
      console.error('Error exporting report:', error);
      setSnackbar({ open: true, message: 'Error exporting report', severity: 'error' });
    }
  };

  useEffect(() => {
    loadDepartments();
    loadProjects();
    loadReportData();
  }, [reportType, filters.month, filters.year, filters.department, filters.project]);

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // Filter data based on search term
  const getFilteredData = () => {
    if (!reportData?.data || !Array.isArray(reportData.data)) return [];
    
    if (!searchTerm.trim()) return reportData.data;
    
    const term = searchTerm.toLowerCase();
    return reportData.data.filter(row => 
      (row.employeeName && row.employeeName.toLowerCase().includes(term)) ||
      (row.employeeId && row.employeeId.toString().includes(term)) ||
      (row.department && row.department.toLowerCase().includes(term)) ||
      (row.project && row.project.toLowerCase().includes(term))
    );
  };

  // Render summary cards
  const renderSummaryCards = () => {
    if (!reportData?.summary) return null;

    const summary = reportData.summary;
    const cards = [
      {
        title: 'Total Employees',
        value: summary.totalEmployees || 0,
        icon: <People />,
        color: '#2196f3'
      },
      {
        title: 'Total Gross Salary',
        value: formatPKR(summary.totalGrossSalary || 0),
        icon: <AttachMoney />,
        color: '#4caf50'
      },
      {
        title: 'Total Deductions',
        value: formatPKR(summary.totalDeductions || 0),
        icon: <TrendingDown />,
        color: '#f44336'
      },
      {
        title: 'Net Pay',
        value: formatPKR(summary.netPay || 0),
        icon: <AccountBalance />,
        color: '#ff9800'
      }
    ];

    return (
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {cards.map((card, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Fade in timeout={300 + index * 100}>
              <Card
                sx={{
                  height: '100%',
                  background: `linear-gradient(135deg, ${alpha(card.color, 0.1)} 0%, ${alpha(card.color, 0.05)} 100%)`,
                  border: `2px solid ${alpha(card.color, 0.2)}`,
                  borderRadius: 3
                }}
              >
                <CardContent sx={{ textAlign: 'center', py: 3 }}>
                  <Box
                    sx={{
                      display: 'inline-flex',
                      p: 2,
                      borderRadius: '50%',
                      backgroundColor: alpha(card.color, 0.1),
                      color: card.color,
                      mb: 2
                    }}
                  >
                    {card.icon}
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
                    {card.value}
                  </Typography>
                  <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                    {card.title}
                  </Typography>
                </CardContent>
              </Card>
            </Fade>
          </Grid>
        ))}
      </Grid>
    );
  };

  const pg = useClientPagination(getFilteredData());

  // Render data table
  const renderDataTable = () => {
    if (!reportData?.data || !Array.isArray(reportData.data)) return null;

    const filteredData = getFilteredData();

    return (
      <Card sx={{ borderRadius: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              Detailed Data
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                Showing {filteredData.length} of {reportData.data.length} employees
              </Typography>
            </Box>
          </Box>
          
          {/* Search Bar */}
          <TextField
            fullWidth
            placeholder="Search by employee name, ID, department, or project..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ mb: 3 }}
            InputProps={{
              startAdornment: (
                <Search sx={{ mr: 1, color: theme.palette.text.secondary }} />
              )
            }}
          />

          <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: alpha(theme.palette.primary.main, 0.1) }}>
                  <TableCell sx={{ fontWeight: 'bold' }}>Employee ID</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Employee Name</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Department</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Project</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Gross Salary</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Deductions</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Net Pay</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((row, index) => (
                  <TableRow key={index} hover>
                    <TableCell sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>
                      {row.employeeId || 'N/A'}
                    </TableCell>
                    <TableCell>{row.employeeName || 'N/A'}</TableCell>
                    <TableCell>{row.department || 'N/A'}</TableCell>
                    <TableCell>{row.project || 'N/A'}</TableCell>
                    <TableCell>{formatPKR(row.grossSalary || 0)}</TableCell>
                    <TableCell>{formatPKR(row.deductions || 0)}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>
                      {formatPKR(row.netPay || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        </CardContent>
      </Card>
    );
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate('/hr/reports')}
          sx={{ mb: 2 }}
        >
          Back to Reports
        </Button>
        
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              backgroundColor: alpha(currentConfig.color, 0.1),
              color: currentConfig.color,
              mr: 2
            }}
          >
            {currentConfig.icon}
          </Box>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>
              {currentConfig.title}
            </Typography>
            <Typography variant="body1" sx={{ color: theme.palette.text.secondary }}>
              {currentConfig.description}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Filters */}
      <Card sx={{ mb: 4, borderRadius: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 3, fontWeight: 'bold' }}>
            Report Filters
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Month</InputLabel>
                <Select
                  value={filters.month}
                  label="Month"
                  onChange={(e) => handleFilterChange('month', e.target.value)}
                >
                  {months.map((month) => (
                    <MenuItem key={month.value} value={month.value}>
                      {month.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Year</InputLabel>
                <Select
                  value={filters.year}
                  label="Year"
                  onChange={(e) => handleFilterChange('year', e.target.value)}
                >
                  {years.map((year) => (
                    <MenuItem key={year} value={year}>
                      {year}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Department</InputLabel>
                <Select
                  value={filters.department}
                  label="Department"
                  onChange={(e) => handleFilterChange('department', e.target.value)}
                  disabled={loadingDepartments}
                >
                  <MenuItem value="">
                    <em>All Departments</em>
                  </MenuItem>
                  {departments.map((dept) => (
                    <MenuItem key={dept._id} value={dept._id}>
                      {dept.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Project</InputLabel>
                <Select
                  value={filters.project}
                  label="Project"
                  onChange={(e) => handleFilterChange('project', e.target.value)}
                  disabled={loadingProjects}
                >
                  <MenuItem value="">
                    <em>All Projects</em>
                  </MenuItem>
                  {projects
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((project) => (
                      <MenuItem key={project._id} value={project._id}>
                        {project.name}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Button
                variant="outlined"
                startIcon={<Download />}
                fullWidth
                onClick={() => exportReport('csv')}
                sx={{ py: 1.5 }}
              >
                Export CSV
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Loading State */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Summary Cards */}
      {!loading && reportData && renderSummaryCards()}

      {/* Data Table */}
      {!loading && reportData && renderDataTable()}

      {/* No Data State */}
      {!loading && !reportData && (
        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              No Data Available
            </Typography>
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 3 }}>
              No payroll data found for {months.find(m => m.value === filters.month)?.label || filters.month}/{filters.year}
            </Typography>
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 3 }}>
              Please select a different month/year or check if payroll data has been generated for this period.
            </Typography>
            <Button variant="contained" onClick={loadReportData}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default PayrollReport;
