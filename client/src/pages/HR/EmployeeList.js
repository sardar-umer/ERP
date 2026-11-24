import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Button,
  IconButton,
  TextField,
  InputAdornment,
  Chip,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  Alert,
  Snackbar,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Tooltip,
  Stack
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Visibility as ViewIcon,
  Refresh as RefreshIcon,
  GetApp as GetAppIcon,
  LocalGasStation as FuelIcon,
  InfoOutlined as InfoOutlinedIcon
} from '@mui/icons-material';
import ImportFuelAllowanceDialog from '../../components/HR/ImportFuelAllowanceDialog';
import { useNavigate, useLocation } from 'react-router-dom';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { hasModuleAccess, MODULE_KEYS } from '../../utils/permissions';
import { PageLoading } from '../../components/LoadingSpinner';
import api from '../../services/api';
import { getImageUrl } from '../../utils/imageService';
import {
  PROBATION_ALERT_DAYS_BEFORE,
  getEmployeesProbationEndingSoon,
  formatProbationEndLabel,
  formatProbationDaysLeftLabel
} from '../../utils/probationAlerts';
import { getEmployeeStatusLabel, getEmployeeStatusColor, isEmployedEmployee } from '../../utils/employeeStatus';
import {
  resolveEmployeeCategory,
  getEmployeeCategoryLabel
} from '../../utils/employeeCategory';

const EmployeeList = () => {
  const { employees, departments, projects, companies, loading: dataLoading, fetchEmployees, fetchDepartments, fetchProjects, fetchCompanies, errors } = useData();
  const { user } = useAuth();
  const [paginationLoading, setPaginationLoading] = useState(false);
  const fetchAttemptedRef = useRef(false);
  const departmentsFetchAttemptedRef = useRef(false);
  const projectsFetchAttemptedRef = useRef(false);
  const companiesFetchAttemptedRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [fuelDialogOpen, setFuelDialogOpen] = useState(false);
  const [exportPages, setExportPages] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [probationCompletedEmployees, setProbationCompletedEmployees] = useState([]);
  const [probationDialogOpen, setProbationDialogOpen] = useState(false);
  // Pagination state
  const location = useLocation();
  const [page, setPage] = useState(() => {
    // Restore page from location state if available (when returning from edit)
    return location.state?.page || 0;
  });
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [totalItems, setTotalItems] = useState(0);
  const [paginatedEmployees, setPaginatedEmployees] = useState([]);
  
  const navigate = useNavigate();
  const canAccessHRModule = hasModuleAccess(user?.role, MODULE_KEYS.HR);
  
  // Update page when location state changes (e.g., returning from edit)
  useEffect(() => {
    if (location.state?.page !== undefined) {
      setPage(location.state.page);
      // Clear the state after using it to avoid issues on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Fallback: If employees are empty and not loading, try to fetch (in case DataContext didn't load)
  useEffect(() => {
    if (employees.length === 0 && !dataLoading.employees && !errors.employees && !fetchAttemptedRef.current) {
      fetchAttemptedRef.current = true;
      fetchEmployees(true).catch(() => {
        fetchAttemptedRef.current = false; // Allow retry on error
      });
    }
  }, [employees.length, dataLoading.employees, errors.employees, fetchEmployees]);

  // Fetch departments and projects if they're empty (only once, prevent infinite loops)
  useEffect(() => {
    if (departments.length === 0 && !dataLoading.departments && !departmentsFetchAttemptedRef.current && !errors.departments) {
      departmentsFetchAttemptedRef.current = true;
      fetchDepartments().catch(err => {
        // If 403 error, don't retry; otherwise allow retry
        if (err.response?.status !== 403) {
          departmentsFetchAttemptedRef.current = false;
        }
      });
    }
  }, [departments.length, dataLoading.departments, errors.departments, fetchDepartments]);

  useEffect(() => {
    if (projects.length === 0 && !dataLoading.projects && !projectsFetchAttemptedRef.current && !errors.projects) {
      projectsFetchAttemptedRef.current = true;
      fetchProjects().catch(err => {
        // If 403 error, don't retry; otherwise allow retry
        if (err.response?.status !== 403) {
          projectsFetchAttemptedRef.current = false;
        }
      });
    }
  }, [projects.length, dataLoading.projects, errors.projects, fetchProjects]);

  useEffect(() => {
    if (companies.length === 0 && !dataLoading.companies && !companiesFetchAttemptedRef.current && !errors.companies) {
      companiesFetchAttemptedRef.current = true;
      fetchCompanies().catch((err) => {
        if (err.response?.status !== 403) {
          companiesFetchAttemptedRef.current = false;
        }
      });
    }
  }, [companies.length, dataLoading.companies, errors.companies, fetchCompanies]);

  // Pagination handlers
  const handleChangePage = useCallback((event, newPage) => {
    setPaginationLoading(true);
    setPage(newPage);
    // Small delay to show loading state
    setTimeout(() => setPaginationLoading(false), 300);
  }, []);

  const handleChangeRowsPerPage = useCallback((event) => {
    setPaginationLoading(true);
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0); // Reset to first page when changing rows per page
    // Small delay to show loading state
    setTimeout(() => setPaginationLoading(false), 300);
  }, []);

  // Handle filter changes and reset pagination
  const handleSearchChange = useCallback((value) => {
    setSearchTerm(value);
    setPage(0); // Reset to first page when search changes
  }, []);

  const handleDepartmentFilterChange = useCallback((value) => {
    setDepartmentFilter(value);
    setPage(0); // Reset to first page when department filter changes
  }, []);

  const handleStatusFilterChange = useCallback((value) => {
    setStatusFilter(value);
    setPage(0); // Reset to first page when status filter changes
  }, []);

  const handleProjectFilterChange = useCallback((value) => {
    setProjectFilter(value);
    setPage(0); // Reset to first page when project filter changes
  }, []);

  const handleCompanyFilterChange = useCallback((value) => {
    setCompanyFilter(value);
    setPage(0);
  }, []);

  const handleCategoryFilterChange = useCallback((value) => {
    setCategoryFilter(value);
    // Category filter is scoped to active employees
    if (value) {
      setStatusFilter('active');
    }
    setPage(0);
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearchTerm('');
    setDepartmentFilter('');
    setStatusFilter('');
    setProjectFilter('');
    setCompanyFilter('');
    setCategoryFilter('');
    setPage(0); // Reset to first page when clearing filters
  }, []);

  const handleNewThisMonthCardClick = useCallback(() => {
    const now = new Date();
    const monthLabel = now.toLocaleString('default', { month: 'long' });
    setSearchTerm('');
    setDepartmentFilter('');
    setProjectFilter('');
    setCompanyFilter('');
    setCategoryFilter('');
    setStatusFilter('');
    setPage(0);
    setSnackbar({
      open: true,
      message: `Showing employees hired in ${monthLabel} ${now.getFullYear()} in the table below`,
      severity: 'info'
    });
  }, []);

  // Handle manual refresh
  const handleRefresh = useCallback(async () => {
    try {
      await fetchEmployees(true); // Force refresh
      setSnackbar({
        open: true,
        message: 'Employees refreshed successfully',
        severity: 'success'
      });
    } catch (error) {
      setSnackbar({
        open: true,
        message: 'Error refreshing employees',
        severity: 'error'
      });
    }
  }, [fetchEmployees]);

  // No need for useEffect - data is provided by DataContext

  // "Approval not given" employees are hidden from the shared list; the Status filter loads them on demand
  const [unapprovedEmployees, setUnapprovedEmployees] = useState([]);
  useEffect(() => {
    if (statusFilter !== 'approval_not_given') return;
    let cancelled = false;
    api.get('/hr/employees', { params: { getAll: true, approval: 'not_given' } })
      .then((res) => { if (!cancelled) setUnapprovedEmployees(res.data?.data || []); })
      .catch(() => { if (!cancelled) setUnapprovedEmployees([]); });
    return () => { cancelled = true; };
  }, [statusFilter]);

  // Filter employees
  const filteredEmployees = useMemo(() => {
    const source = statusFilter === 'approval_not_given' && !categoryFilter ? unapprovedEmployees : employees;
    return source.filter(employee => {
      // Simple search - only search in name and employee ID
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        (employee.firstName || '').toLowerCase().includes(searchLower) ||
        (employee.lastName || '').toLowerCase().includes(searchLower) ||
        (employee.employeeId || '').toLowerCase().includes(searchLower);
      
      const employeeDepartment = typeof employee.placementDepartment === 'object' ? employee.placementDepartment?.name : employee.placementDepartment;
      const matchesDepartment = !departmentFilter || employeeDepartment === departmentFilter;
      
      // Handle project filter
      const employeeProject = typeof employee.placementProject === 'object' ? employee.placementProject?.name : employee.placementProject;
      const matchesProject = !projectFilter || employeeProject === projectFilter;

      const employeeCompany = typeof employee.placementCompany === 'object'
        ? employee.placementCompany?.name
        : employee.placementCompany;
      const matchesCompany = !companyFilter || employeeCompany === companyFilter;
      
      // Handle status filter
      // Category filter always uses active employees only
      const effectiveStatus = categoryFilter ? 'active' : statusFilter;
      let matchesStatus = true;
      if (effectiveStatus && effectiveStatus !== 'approval_not_given') {
        if (effectiveStatus === 'active') {
          matchesStatus = isEmployedEmployee(employee);
        } else if (effectiveStatus === 'draft') {
          matchesStatus = employee.employmentStatus === 'Draft';
        } else if (effectiveStatus === 'inactive') {
          matchesStatus = !isEmployedEmployee(employee) && employee.employmentStatus !== 'Draft';
        }
      }

      // Resolve category from stored field or designation (many older records lack employeeCategory)
      const resolvedCategory = resolveEmployeeCategory(employee);
      const matchesCategory = !categoryFilter || resolvedCategory === categoryFilter;

      return matchesSearch && matchesDepartment && matchesProject && matchesCompany && matchesStatus && matchesCategory;
    });
  }, [employees, unapprovedEmployees, searchTerm, departmentFilter, projectFilter, companyFilter, statusFilter, categoryFilter]);

  // Sort filtered employees by status first (active at top, inactive at end), then by Employee ID
  const sortedEmployees = useMemo(() => {
    return [...filteredEmployees].sort((a, b) => {
      // First priority: Active employees first, inactive/draft at the end
      const aIsActive = isEmployedEmployee(a);
      const bIsActive = isEmployedEmployee(b);
      
      if (aIsActive !== bIsActive) {
        return aIsActive ? -1 : 1; // active first
      }
      
      // Second priority: Employee ID (ascending order for same status)
      const idA = parseInt(a.employeeId) || 0;
      const idB = parseInt(b.employeeId) || 0;
      return idA - idB;
    });
  }, [filteredEmployees]);

  // Memoize statistics calculations
  const statistics = useMemo(() => {
    const activeEmployees = employees.filter((emp) => isEmployedEmployee(emp)).length;
    const draftEmployees = employees.filter(emp => emp.employmentStatus === 'Draft').length;
    const inactiveEmployees = employees.filter((emp) => !isEmployedEmployee(emp) && emp.employmentStatus !== 'Draft').length;
    
    const newThisMonth = employees.filter(emp => {
      const hireDate = new Date(emp.hireDate);
      const now = new Date();
      return hireDate.getMonth() === now.getMonth() && 
             hireDate.getFullYear() === now.getFullYear();
    }).length;
    
    return {
      totalEmployees: employees.length,
      activeEmployees,
      draftEmployees,
      inactiveEmployees,
      departmentsCount: departments.length,
      newThisMonth
    };
  }, [employees, departments]);

  useEffect(() => {
    if (!canAccessHRModule) {
      setProbationCompletedEmployees([]);
      setProbationDialogOpen(false);
      return;
    }

    const endingSoon = getEmployeesProbationEndingSoon(employees, PROBATION_ALERT_DAYS_BEFORE);

    setProbationCompletedEmployees(endingSoon);
    setProbationDialogOpen(endingSoon.length > 0);
  }, [employees, canAccessHRModule]);

  // Scroll to specific employee after create/edit (must be after sortedEmployees is defined)
  useEffect(() => {
    if (location.state?.employeeId && sortedEmployees && sortedEmployees.length > 0) {
      const employeeIndex = sortedEmployees.findIndex(emp => emp._id === location.state.employeeId);
      if (employeeIndex !== -1) {
        const targetPage = Math.floor(employeeIndex / rowsPerPage);
        setPage(targetPage);
        
        // Scroll to the employee row after a short delay to ensure DOM is updated
        setTimeout(() => {
          const rowElement = document.querySelector(`[data-employee-id="${location.state.employeeId}"]`);
          if (rowElement) {
            rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Highlight the row briefly
            rowElement.style.backgroundColor = '#e3f2fd';
            setTimeout(() => {
              rowElement.style.backgroundColor = '';
            }, 2000);
          }
        }, 300);
        
        // Clear the state after using it
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state?.employeeId, sortedEmployees, rowsPerPage]);

  // Handle pagination for sorted employees
  useEffect(() => {
    const startIndex = page * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginated = sortedEmployees.slice(startIndex, endIndex);
    setPaginatedEmployees(paginated);
    setTotalItems(sortedEmployees.length);
  }, [sortedEmployees, page, rowsPerPage]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    try {
      await api.delete(`/hr/employees/${selectedEmployee._id}`);
      setSnackbar({
        open: true,
        message: 'Employee deleted successfully',
        severity: 'success'
      });
      setDeleteDialogOpen(false);
      setSelectedEmployee(null);
      // Refresh the employee data immediately
      await fetchEmployees(true);
    } catch (error) {
      setSnackbar({
        open: true,
        message: 'Error deleting employee',
        severity: 'error'
      });
    }
  }, [selectedEmployee, fetchEmployees]);

  const getStatusColor = (employee) => getEmployeeStatusColor(employee);

  const getStatusText = (employee) => getEmployeeStatusLabel(employee);



  // Format employee ID to 5 digits with leading zeros
  const formatEmployeeId = (employeeId) => {
    if (!employeeId) return '';
    return employeeId.toString().padStart(5, '0');
  };

  const totalPages = Math.ceil(totalItems / rowsPerPage) || 1;

  const handleExportToExcel = useCallback(async () => {
    if (!sortedEmployees || sortedEmployees.length === 0) {
      setSnackbar({ open: true, message: 'No employees to export', severity: 'warning' });
      return;
    }
    try {
      setExporting(true);
      const pagesToExport = exportPages === 'all' || exportPages >= totalPages
        ? totalPages
        : Math.min(Number(exportPages) || 1, totalPages);
      const count = Math.min(pagesToExport * rowsPerPage, sortedEmployees.length);
      const dataToExport = sortedEmployees.slice(0, count);

      const headers = [
        'Employee Name',
        'Employee ID',
        'ID Card',
        'Religion',
        'Marital Status',
        'Qualification',
        'Bank Name',
        'Bank Account Number',
        'Spouse Name',
        'Appointment Date',
        'Probation Period',
        'End of Probation',
        'Confirmation Date',
        'Department',
        'Designation',
        'Email',
        'Phone',
        'Status'
      ];

      const rows = dataToExport.map((emp) => [
        `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        formatEmployeeId(emp.employeeId),
        emp.idCard || '',
        emp.religion || '',
        emp.maritalStatus || '',
        emp.qualification || '',
        typeof emp.bankName === 'object' ? emp.bankName?.name || '' : emp.bankName || '',
        emp.bankAccountNumber || emp.accountNumber || '',
        emp.spouseName || '',
        emp.appointmentDate ? new Date(emp.appointmentDate).toLocaleDateString() : '',
        emp.probationPeriodMonths ? `${emp.probationPeriodMonths} months` : '',
        emp.endOfProbationDate ? new Date(emp.endOfProbationDate).toLocaleDateString() : '',
        emp.confirmationDate ? new Date(emp.confirmationDate).toLocaleDateString() : '',
        emp.placementDepartment?.name || '',
        emp.placementDesignation?.title || '',
        emp.email || '',
        emp.phone || '',
        getStatusText(emp)
      ]);

      const xlsx = await import('xlsx');
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [
        { wch: 22 }, { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
        { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
        { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 10 }
      ];
      xlsx.utils.book_append_sheet(wb, ws, 'Employees');
      const fileName = `employees-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      xlsx.writeFile(wb, fileName);
      setSnackbar({
        open: true,
        message: `Exported ${dataToExport.length} employee(s) to Excel`,
        severity: 'success'
      });
      setExportDialogOpen(false);
    } catch (err) {
      console.error('Export error:', err);
      setSnackbar({
        open: true,
        message: err.message || 'Failed to export to Excel',
        severity: 'error'
      });
    } finally {
      setExporting(false);
    }
  }, [sortedEmployees, exportPages, totalPages, rowsPerPage]);

  if (dataLoading.employees || dataLoading.departments) {
    return (
      <PageLoading 
        message="Loading employees..." 
        showSkeleton={true}
        skeletonType="table"
      />
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Employee Management</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<FuelIcon />}
            onClick={() => setFuelDialogOpen(true)}
            color="primary"
          >
            Import Fuel Allowance
          </Button>
          <Button
            variant="outlined"
            startIcon={<GetAppIcon />}
            onClick={() => setExportDialogOpen(true)}
            disabled={dataLoading.employees || totalItems === 0}
          >
            Export
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            disabled={dataLoading.employees}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/hr/employees/add')}
          >
            Add Employee
          </Button>
        </Box>
      </Box>

      {/* Error Alert */}
      {errors.employees && (
        <Alert 
          severity="error" 
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={handleRefresh}>
              Retry
            </Button>
          }
        >
          Error loading employees: {errors.employees}
        </Alert>
      )}

      {/* Statistics Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={2}>
          <Card
            sx={{ cursor: 'pointer', transition: 'all 0.2s ease', '&:hover': { boxShadow: 4 } }}
            onClick={clearAllFilters}
          >
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Employees
              </Typography>
              <Typography variant="h4">
                {statistics.totalEmployees}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                (Excluding deleted)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card
            sx={{ cursor: 'pointer', transition: 'all 0.2s ease', '&:hover': { boxShadow: 4 } }}
            onClick={() => handleStatusFilterChange('active')}
          >
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Active Employees
              </Typography>
              <Typography variant="h4">
                {statistics.activeEmployees}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                (Excluding deleted)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card
            sx={{ cursor: 'pointer', transition: 'all 0.2s ease', '&:hover': { boxShadow: 4 } }}
            onClick={() => handleStatusFilterChange('draft')}
          >
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Draft Employees
              </Typography>
              <Typography variant="h4" color="warning.main">
                {statistics.draftEmployees}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                (Completed onboarding)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card
            sx={{ cursor: 'pointer', transition: 'all 0.2s ease', '&:hover': { boxShadow: 4 } }}
            onClick={() => handleStatusFilterChange('inactive')}
          >
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Inactive Employees
              </Typography>
              <Typography variant="h4" color="error.main">
                {statistics.inactiveEmployees}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                (Terminated/Resigned)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card
            sx={{ cursor: 'pointer', transition: 'all 0.2s ease', '&:hover': { boxShadow: 4 } }}
            onClick={() => navigate('/hr/departments')}
          >
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Departments
              </Typography>
              <Typography variant="h4">
                {statistics.departmentsCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card
            sx={{ cursor: 'pointer', transition: 'all 0.2s ease', '&:hover': { boxShadow: 4 } }}
            onClick={handleNewThisMonthCardClick}
          >
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                New This Month
              </Typography>
              <Typography variant="h4">
                {statistics.newThisMonth}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                (Excluding deleted)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              placeholder="Search employees..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth>
              <InputLabel>Company</InputLabel>
              <Select
                value={companyFilter}
                onChange={(e) => handleCompanyFilterChange(e.target.value)}
                label="Company"
                sx={{
                  '& .MuiSelect-select': { paddingRight: '32px' },
                  '& .MuiSelect-icon': { right: '8px' }
                }}
              >
                <MenuItem value="">
                  <em>All Companies</em>
                </MenuItem>
                {companies
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((company) => (
                    <MenuItem key={company._id} value={company.name}>
                      {company.name}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth>
              <InputLabel>Department</InputLabel>
              <Select
                value={departmentFilter}
                onChange={(e) => handleDepartmentFilterChange(e.target.value)}
                label="Department"
                sx={{
                  '& .MuiSelect-select': {
                    paddingRight: '32px', // Ensure space for dropdown icon
                  },
                  '& .MuiSelect-icon': {
                    right: '8px', // Position icon properly
                  }
                }}
              >
                <MenuItem value="">All Departments</MenuItem>
                {departments
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((dept) => (
                    <MenuItem key={dept._id} value={dept.name}>
                      {dept.name}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth>
              <InputLabel>Project</InputLabel>
              <Select
                value={projectFilter}
                onChange={(e) => handleProjectFilterChange(e.target.value)}
                label="Project"
                sx={{
                  '& .MuiSelect-select': {
                    paddingRight: '32px',
                  },
                  '& .MuiSelect-icon': {
                    right: '8px',
                  }
                }}
              >
                <MenuItem value="">
                  <em>All Projects</em>
                </MenuItem>
                {projects
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((project) => (
                    <MenuItem key={project._id} value={project.name}>
                      {project.name}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={1.5}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={categoryFilter ? 'active' : statusFilter}
                onChange={(e) => handleStatusFilterChange(e.target.value)}
                label="Status"
                disabled={Boolean(categoryFilter)}
                sx={{
                  '& .MuiSelect-select': {
                    paddingRight: '32px',
                  },
                  '& .MuiSelect-icon': {
                    right: '8px',
                  }
                }}
              >
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
                <MenuItem value="approval_not_given">Approval not given</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={1.5}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={categoryFilter}
                onChange={(e) => handleCategoryFilterChange(e.target.value)}
                label="Category"
                sx={{
                  '& .MuiSelect-select': {
                    paddingRight: '32px',
                  },
                  '& .MuiSelect-icon': {
                    right: '8px',
                  }
                }}
              >
                <MenuItem value="">All Categories</MenuItem>
                <MenuItem value="white_collar">White Collar</MenuItem>
                <MenuItem value="blue_collar">Blue Collar</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={1.5}>
            <Button
              variant="outlined"
              onClick={clearAllFilters}
              fullWidth
              sx={{ height: 56 }}
            >
              Clear Filters
            </Button>
          </Grid>
        </Grid>
        
        {/* Search Results Summary */}
        {(searchTerm || departmentFilter || projectFilter || companyFilter || statusFilter || categoryFilter) && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'info.50', borderRadius: 1, border: '1px solid', borderColor: 'info.200' }}>
            <Typography variant="body2" color="info.main" sx={{ fontWeight: 500 }}>
              🔍 Filtered Results: Found {totalItems} employee(s)
              {totalItems > rowsPerPage && (
                <span> • Use pagination below to navigate through all results</span>
              )}
            </Typography>
            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
              {searchTerm && `Search: "${searchTerm}"`}
              {departmentFilter && ` • Department: ${departmentFilter}`}
              {projectFilter && ` • Project: ${projectFilter}`}
              {companyFilter && ` • Company: ${companyFilter}`}
              {categoryFilter
                ? ' • Status: Active'
                : (statusFilter && ` • Status: ${statusFilter === 'active' ? 'Active' : statusFilter === 'draft' ? 'Draft' : statusFilter === 'approval_not_given' ? 'Approval not given' : 'Inactive'}`)}
              {categoryFilter && ` • Category: ${getEmployeeCategoryLabel(categoryFilter)} (active only)`}
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Employee Table */}
      <Paper sx={{ width: '100%', overflow: 'hidden' }}>
        {/* Pagination Info */}
        <Box sx={{ 
          p: 2, 
          bgcolor: 'grey.50', 
          borderBottom: '1px solid',
          borderColor: 'grey.200',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2
        }}>
          <Box>
            <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
              👥 Employee List
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Showing {page * rowsPerPage + 1}-{Math.min((page + 1) * rowsPerPage, totalItems)} of {totalItems} employees
            </Typography>
            <Typography variant="caption" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              📊 Sorted by Status (Inactive/Draft first), then Employee ID
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="textSecondary">
              Page {page + 1} of {Math.ceil(totalItems / rowsPerPage)}
            </Typography>
            {totalItems > 0 && (
              <Chip 
                label={`${Math.ceil(totalItems / rowsPerPage)} pages`} 
                size="small" 
                color="primary" 
                variant="outlined"
              />
            )}
          </Box>
        </Box>
        
        <TableContainer sx={{ width: '100%', overflowX: 'hidden' }}>
          <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: '26%' }}>Employee</TableCell>
                <TableCell sx={{ width: '22%' }}>Placement</TableCell>
                <TableCell sx={{ width: '20%' }}>Contact</TableCell>
                <TableCell sx={{ width: '14%' }}>Dates</TableCell>
                <TableCell sx={{ width: '10%' }}>Status</TableCell>
                <TableCell sx={{ width: '8%' }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginationLoading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Box sx={{ textAlign: 'center' }}>
                      <CircularProgress size={24} sx={{ mb: 2 }} />
                      <Typography variant="body2" color="textSecondary">
                        Loading page {page + 1}...
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : paginatedEmployees.length > 0 ? (
                paginatedEmployees.map((employee) => {
                  const bankLabel = typeof employee.bankName === 'object'
                    ? employee.bankName?.name
                    : employee.bankName;
                  const detailLines = [
                    `ID Card: ${employee.idCard || 'N/A'}`,
                    `Religion: ${employee.religion || 'N/A'}`,
                    `Marital: ${employee.maritalStatus || 'N/A'}`,
                    `Qualification: ${employee.qualification || 'N/A'}`,
                    `Bank: ${bankLabel || 'N/A'}`,
                    `Account: ${employee.bankAccountNumber || employee.accountNumber || 'N/A'}`,
                    `Spouse: ${employee.spouseName || 'N/A'}`,
                    `Probation: ${employee.probationPeriodMonths ? `${employee.probationPeriodMonths} months` : 'N/A'}`,
                    `Confirm: ${employee.confirmationDate ? new Date(employee.confirmationDate).toLocaleDateString() : 'N/A'}`
                  ];
                  return (
                  <TableRow key={employee._id} data-employee-id={employee._id} hover>
                    <TableCell sx={{ overflow: 'hidden' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 1 }}>
                        <Avatar
                          src={employee.profileImage ? getImageUrl(employee.profileImage) : undefined}
                          sx={{ width: 36, height: 36, flexShrink: 0 }}
                          imgProps={{
                            onError: (e) => {
                              e.target.style.display = 'none';
                            }
                          }}
                        >
                          {employee.firstName?.charAt(0)}{employee.lastName?.charAt(0)}
                        </Avatar>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="subtitle2" noWrap>
                            {employee.firstName} {employee.lastName}
                          </Typography>
                          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                            <Typography variant="caption" color="textSecondary" noWrap>
                              {formatEmployeeId(employee.employeeId)}
                            </Typography>
                            <Tooltip
                              title={
                                <Box sx={{ py: 0.5 }}>
                                  {detailLines.map((line) => (
                                    <Typography key={line} variant="caption" display="block">
                                      {line}
                                    </Typography>
                                  ))}
                                </Box>
                              }
                              arrow
                              placement="right"
                            >
                              <IconButton size="small" sx={{ p: 0.25 }} aria-label="More employee details">
                                <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ overflow: 'hidden' }}>
                      <Typography variant="body2" noWrap fontWeight={600}>
                        {employee.placementCompany?.name || 'N/A'}
                      </Typography>
                      <Typography variant="caption" color="textSecondary" noWrap display="block">
                        {employee.placementDepartment?.name || 'N/A'}
                      </Typography>
                      <Typography variant="caption" color="textSecondary" noWrap display="block">
                        {employee.placementDesignation?.title || 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ overflow: 'hidden' }}>
                      <Tooltip title={employee.email || ''} arrow>
                        <Typography variant="body2" noWrap>
                          {employee.email || 'N/A'}
                        </Typography>
                      </Tooltip>
                      <Typography variant="caption" color="textSecondary" noWrap display="block">
                        {employee.phone || 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ overflow: 'hidden' }}>
                      <Typography variant="caption" display="block" noWrap>
                        Appt: {employee.appointmentDate ? new Date(employee.appointmentDate).toLocaleDateString() : 'N/A'}
                      </Typography>
                      <Typography variant="caption" color="textSecondary" display="block" noWrap>
                        Prob. end: {employee.endOfProbationDate ? new Date(employee.endOfProbationDate).toLocaleDateString() : 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getStatusText(employee)}
                        color={getStatusColor(employee)}
                        size="small"
                        sx={{ maxWidth: '100%' }}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/hr/employees/${employee._id}`, { state: { page } })}
                        title="View Details"
                      >
                        <ViewIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/hr/employees/${employee._id}/edit`, { state: { page } })}
                        title="Edit Employee"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          setSelectedEmployee(employee);
                          setDeleteDialogOpen(true);
                        }}
                        title="Delete Employee"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h6" color="textSecondary" gutterBottom>
                        {dataLoading.employees ? 'Loading employees...' : 'No employees found'}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {dataLoading.employees 
                          ? 'Please wait while we fetch your employee data...' 
                          : searchTerm || departmentFilter || projectFilter || companyFilter || statusFilter || categoryFilter
                            ? 'Try adjusting your search criteria or filters'
                            : 'No employees in the system yet'
                        }
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        
        {/* Table Pagination */}
        <TablePagination
          rowsPerPageOptions={[5, 10, 25, 50, 100]}
          component="div"
          count={totalItems}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="Employees per page:"
          labelDisplayedRows={({ from, to, count }) => 
            `${from}-${to} of ${count !== -1 ? count : `more than ${to}`} employees`
          }
          sx={{
            bgcolor: 'background.paper',
            borderTop: '1px solid',
            borderColor: 'grey.200',
            '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
              fontWeight: 500,
            },
            '& .MuiTablePagination-select': {
              borderRadius: 1,
            }
          }}
        />
      </Paper>

      {/* Export to Excel Dialog */}
      <Dialog open={exportDialogOpen} onClose={() => !exporting && setExportDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Export to Excel</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Total: {totalPages} page{totalPages !== 1 ? 's' : ''} ({totalItems} employees). Each page has {rowsPerPage} employees.
          </Typography>
          <FormControl fullWidth>
            <InputLabel>Pages to export</InputLabel>
            <Select
              value={exportPages}
              label="Pages to export"
              onChange={(e) => setExportPages(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              {[1, 2, 3, 5, 10, 20, 50].filter((n) => n <= totalPages || n === 1).map((n) => (
                <MenuItem key={n} value={n}>
                  {n} page{n !== 1 ? 's' : ''} ({Math.min(n * rowsPerPage, totalItems)} employees)
                </MenuItem>
              ))}
              {totalPages > 1 && (
                <MenuItem value="all">
                  All {totalPages} pages ({totalItems} employees)
                </MenuItem>
              )}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportDialogOpen(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={handleExportToExcel} variant="contained" disabled={exporting} startIcon={exporting ? <CircularProgress size={18} /> : <GetAppIcon />}>
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={probationDialogOpen} onClose={() => setProbationDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Probation Ending Soon</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            The following employees will complete probation within the next {PROBATION_ALERT_DAYS_BEFORE} days.
            Please review and update confirmation details if needed.
          </Alert>
          {probationCompletedEmployees.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No employees with probation ending in the next {PROBATION_ALERT_DAYS_BEFORE} days.
            </Typography>
          ) : (
            <List disablePadding>
              {probationCompletedEmployees.map((emp) => {
                const probationEndLabel = formatProbationEndLabel(emp);
                const daysLeftLabel = formatProbationDaysLeftLabel(emp);
                return (
                  <ListItem key={emp._id} disablePadding sx={{ mb: 0.5 }}>
                    <ListItemButton
                      onClick={() => {
                        setProbationDialogOpen(false);
                        navigate(`/hr/employees/${emp._id}`, { state: { page } });
                      }}
                      sx={{ borderRadius: 1 }}
                    >
                      <ListItemAvatar>
                        <Avatar src={getImageUrl(emp.profileImage)}>
                          {(emp.firstName || '?')[0]}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={`${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee'}
                        secondary={
                          <>
                            {emp.placementDepartment?.name || emp.department?.name || '—'}
                            {' · '}
                            <Chip component="span" size="small" color="warning" label={`${daysLeftLabel} · ${probationEndLabel}`} sx={{ height: 20, ml: 0.5 }} />
                          </>
                        }
                        secondaryTypographyProps={{ component: 'div' }}
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProbationDialogOpen(false)} variant="contained">Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete {selectedEmployee?.firstName} {selectedEmployee?.lastName}?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Import Fuel Allowance Dialog */}
      <ImportFuelAllowanceDialog
        open={fuelDialogOpen}
        onClose={() => setFuelDialogOpen(false)}
        onImportSuccess={() => {
          fetchEmployees();
          setSnackbar({ open: true, message: 'Fuel Allowance imported successfully!', severity: 'success' });
        }}
      />

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default EmployeeList; 