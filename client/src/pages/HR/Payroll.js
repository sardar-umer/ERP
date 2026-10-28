import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Button,
  Chip,
  IconButton,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Tooltip,
  Collapse,
  InputAdornment,
  Skeleton,
  Stack,
  Divider
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Visibility as ViewIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  TrendingUp as TrendingUpIcon,
  AccountBalance as AccountBalanceIcon,
  Receipt as ReceiptIcon,
  People as PeopleIcon,

  ExpandMore as ExpandMoreIcon,
  GroupWork as GroupWorkIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Download as DownloadIcon,
  CompareArrows as CompareArrowsIcon,
  LocalGasStation as FuelIcon,
  Percent as PercentIcon,
  PictureAsPdf as PictureAsPdfIcon,
  AccountBalanceWallet as EobiIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

import { useData } from '../../contexts/DataContext';
import api from '../../services/authService';
import MonthlyPayrollApprovalSection from '../../components/HR/MonthlyPayrollApprovalSection';
import PayrollMonthlyComparisonDialog from '../../components/HR/PayrollMonthlyComparisonDialog';
import ImportFuelAllowanceDialog from '../../components/HR/ImportFuelAllowanceDialog';
import ImportSalaryPercentageCutDialog from '../../components/HR/ImportSalaryPercentageCutDialog';
import { getPayrollStatusColor, getPayrollStatusLabel } from '../../utils/payrollStatusHelpers';
import PayrollProrationBadge from '../../components/HR/PayrollProrationBadge';
import SalaryAdvanceManagement from '../../components/HR/SalaryAdvanceManagement';
import ManualSalarySheet from '../../components/HR/ManualSalarySheet';
import {
  generateEobiContributionPdf,
  resolveEobiReportScopeLabel
} from '../../utils/eobiContributionReport';
import { Tabs, Tab } from '@mui/material';

// Months array moved outside component to prevent recreation on every render
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

const Payroll = () => {
  const navigate = useNavigate();
  const { employees, departments, projects, loading: dataLoading } = useData();
  const [activeTab, setActiveTab] = useState(0);
  const [payrolls, setPayrolls] = useState([]);
  const [monthlyPayrolls, setMonthlyPayrolls] = useState([]);
  const [paginatedMonthlyPayrolls, setPaginatedMonthlyPayrolls] = useState([]);
  const [manualSalaries, setManualSalaries] = useState([]);
  const [manualSalariesLoading, setManualSalariesLoading] = useState(false);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [paginationLoading, setPaginationLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [totalItems, setTotalItems] = useState(0);
  const [monthlyFilters, setMonthlyFilters] = useState({
    status: '',
    department: '',
    project: ''
  });
  const [generalFilters, setGeneralFilters] = useState({
    searchQuery: '',
    department: '',
    project: ''
  });
  const [bulkCreateDialogOpen, setBulkCreateDialogOpen] = useState(false);
  const [fuelDialogOpen, setFuelDialogOpen] = useState(false);
  const [salaryCutDialogOpen, setSalaryCutDialogOpen] = useState(false);
  const [bulkCreateLoading, setBulkCreateLoading] = useState(false);
  const [bulkCreateForm, setBulkCreateForm] = useState({
    month: (new Date().getMonth() + 1).toString().padStart(2, '0'),
    year: new Date().getFullYear()
  });

  const [expandedMonths, setExpandedMonths] = useState(new Set());
  const [generalPayrollExpanded, setGeneralPayrollExpanded] = useState(false);
  const [employeeDetailsPage, setEmployeeDetailsPage] = useState({});
  const [employeeDetailsRowsPerPage, setEmployeeDetailsRowsPerPage] = useState(10);
  const [employeeDetailsSearch, setEmployeeDetailsSearch] = useState({});
  const [generalPayrollPage, setGeneralPayrollPage] = useState(0);
  const [generalPayrollRowsPerPage, setGeneralPayrollRowsPerPage] = useState(10);
  const [currentOverview, setCurrentOverview] = useState(null);
  const [currentOverviewLoading, setCurrentOverviewLoading] = useState(false);
  const [masterDepartments, setMasterDepartments] = useState([]);
  const [masterProjects, setMasterProjects] = useState([]);
  const [exportMonth, setExportMonth] = useState((new Date().getMonth() + 1).toString());
  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exportLoadingKey, setExportLoadingKey] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [bulkApproveLoadingKey, setBulkApproveLoadingKey] = useState(null);
  const [monthlyApprovals, setMonthlyApprovals] = useState({});
  const [monthlyApprovalLoadingKeys, setMonthlyApprovalLoadingKeys] = useState(new Set());
  const [comparisonDialogOpen, setComparisonDialogOpen] = useState(false);
  const [comparisonReport, setComparisonReport] = useState(null);
  const [comparisonGeneratedAt, setComparisonGeneratedAt] = useState(null);
  const [comparisonReportStatus, setComparisonReportStatus] = useState('Draft');
  const [comparisonContext, setComparisonContext] = useState(null);
  const [comparisonLoadingKey, setComparisonLoadingKey] = useState(null);

  const fetchMonthlyApproval = useCallback(async (month, year) => {
    const key = `${month}-${year}`;
    setMonthlyApprovalLoadingKeys((prev) => new Set(prev).add(key));
    try {
      const response = await api.get(`/payroll/monthly-approval/${month}/${year}`);
      setMonthlyApprovals((prev) => ({ ...prev, [key]: response.data?.data }));
    } catch (fetchError) {
      console.error('Error loading monthly payroll approval:', fetchError);
    } finally {
      setMonthlyApprovalLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  // Define functions with useCallback to avoid dependency issues
  const fetchPayrolls = useCallback(async () => {
    // This function is kept for backward compatibility but now calls fetchMonthlyPayrolls
    return fetchMonthlyPayrolls();
  }, []); // eslint-disable-next-line react-hooks/exhaustive-deps

  const fetchStats = useCallback(async () => {
    try {
      // Get General Payroll statistics from current overview instead of historical payrolls
      const response = await api.get('/payroll/current-overview');
      const overviewData = response.data.data || {};

      // Transform current overview data to match the expected stats format
      setStats({
        totalPayrolls: overviewData.totalEmployees || 0,
        totalGrossSalary: overviewData.totalGrossSalary || 0,
        totalNetSalary: overviewData.totalNetSalary || 0,
        averageNetSalary: overviewData.totalEmployees > 0 ?
          (overviewData.totalNetSalary / overviewData.totalEmployees) : 0
      });
    } catch (error) {
      console.error('Error fetching General Payroll stats:', error);
    }
  }, []);

  // Function to fetch monthly payrolls (all data for proper grouping)
  const fetchMonthlyPayrolls = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (monthlyFilters.status) {
        params.set('status', monthlyFilters.status);
      }

      const response = await api.get(`/payroll/monthly?${params}`, {
        timeout: 90000 // 90 seconds timeout for large payroll datasets
      });
      const payrollData = response.data.data || [];

      // Validate payroll data before setting state
      const validatedPayrolls = payrollData.filter(payroll =>
        payroll &&
        typeof payroll.month === 'number' &&
        typeof payroll.year === 'number' &&
        payroll.employee
      );

      setPayrolls(validatedPayrolls);
      setTotalItems(validatedPayrolls.length);

      if (response.data.count && response.data.count >= 5000) {
        console.warn(`⚠️ Loaded ${response.data.count} payrolls. If data seems incomplete, try filtering by date range.`);
      }
    } catch (error) {
      console.error('Error fetching monthly payrolls:', error);
      if (error.code === 'ECONNABORTED') {
        setError('Request timed out. Try filtering by a smaller date range or contact support.');
      } else {
        setError('Failed to load payroll data. Please try again or filter by date range.');
      }
      setPayrolls([]);
      setTotalItems(0);
    } finally {
      setLoading(false);
    }
  }, [monthlyFilters.status]);

  const fetchManualSalaries = useCallback(async () => {
    try {
      setManualSalariesLoading(true);
      const res = await api.get('/hr/manual-salary');
      setManualSalaries(res.data.data || []);
    } catch (error) {
      console.error('Error fetching manual salaries:', error);
    } finally {
      setManualSalariesLoading(false);
    }
  }, []);

  const fetchCurrentOverview = useCallback(async () => {
    try {
      setCurrentOverviewLoading(true);
      const response = await api.get('/payroll/current-overview');
      setCurrentOverview(response.data.data);
    } catch (error) {
      console.error('Error fetching current overview:', error);
      setError('Failed to load current payroll overview');
    } finally {
      setCurrentOverviewLoading(false);
    }
  }, []);

  const fetchMasterFilterOptions = useCallback(async () => {
    try {
      const [departmentsRes, projectsRes] = await Promise.allSettled([
        api.get('/hr/departments'),
        api.get('/projects')
      ]);

      if (departmentsRes.status === 'fulfilled') {
        setMasterDepartments(departmentsRes.value.data?.data || []);
      }
      if (projectsRes.status === 'fulfilled') {
        setMasterProjects(projectsRes.value.data?.data || []);
      }
    } catch (error) {
      console.error('Error fetching master filter options:', error);
    }
  }, []);

  const getFilteredPayrolls = useCallback(() => {
    let filtered = (payrolls || []).filter((p) => p && p.month && p.year && p.employee);
    const getDepartmentId = (payroll) =>
      payroll?.employee?.placementDepartment?._id ||
      payroll?.employee?.department?._id ||
      payroll?.employee?.department;
    const getProjectId = (payroll) =>
      payroll?.employee?.placementProject?._id ||
      payroll?.employee?.placementProject;
    const getStatusValue = (payroll) => String(payroll?.status || '').toLowerCase();

    if (monthlyFilters.status) {
      const targetStatus = String(monthlyFilters.status).toLowerCase();
      filtered = filtered.filter((p) => getStatusValue(p) === targetStatus);
    }
    if (monthlyFilters.department) {
      filtered = filtered.filter(
        (p) => String(getDepartmentId(p)) === String(monthlyFilters.department)
      );
    }
    if (monthlyFilters.project) {
      filtered = filtered.filter(
        (p) => String(getProjectId(p)) === String(monthlyFilters.project)
      );
    }

    return filtered;
  }, [payrolls, monthlyFilters]);

  // Initial data fetch - use monthly endpoint to get all data for both sections
  useEffect(() => {
    fetchMonthlyPayrolls();
    fetchStats();
    fetchManualSalaries();
  }, [fetchMonthlyPayrolls, fetchStats, fetchManualSalaries]); // Include dependencies

  // Fetch current overview when component mounts and when general payroll is expanded
  useEffect(() => {
    fetchCurrentOverview();
    fetchMasterFilterOptions();
  }, [fetchCurrentOverview, fetchMasterFilterOptions]);

  useEffect(() => {
    if (generalPayrollExpanded) {
      // Data is already loaded, just ensure it's fresh
      fetchCurrentOverview();
    }
  }, [generalPayrollExpanded, fetchCurrentOverview]);

  // Group payrolls by month and year - fixed dependency array
  useEffect(() => {
    const filteredPayrolls = getFilteredPayrolls();

    if (filteredPayrolls.length > 0) {
      const grouped = filteredPayrolls.reduce((acc, payroll) => {
        // Ensure month and year exist before processing
        if (!payroll.month || !payroll.year) {
          console.warn('Payroll missing month or year:', payroll);
          return acc;
        }

        const key = `${payroll.month}-${payroll.year}`;
        if (!acc[key]) {
          acc[key] = {
            month: payroll.month,
            year: payroll.year,
            monthName: months.find(m => m.value === payroll.month?.toString().padStart(2, '0'))?.label || `Month ${payroll.month}`,
            payrolls: [],
            totalEmployees: 0,
            totalGrossSalary: 0,
            totalNetSalary: 0,
            totalBasicSalary: 0,
            statuses: new Set()
          };
        }
        acc[key].payrolls.push(payroll);
        acc[key].totalEmployees++;
        acc[key].totalGrossSalary += payroll.grossSalary || 0;
        // Match monthly CSV Net Payable: exclude attendance deduction from net
        acc[key].totalNetSalary +=
          (payroll.netSalary || 0) + (payroll.attendanceDeduction || 0);
        acc[key].totalBasicSalary += payroll.basicSalary || 0;
        acc[key].statuses.add(payroll.status);
        return acc;
      }, {});

      const monthlyArray = Object.values(grouped).sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

      // Sort employees within each monthly group by Employee ID in ascending order
      monthlyArray.forEach(monthly => {
        monthly.payrolls.sort((a, b) => {
          // Convert Employee ID to number for proper numerical sorting
          const idA = parseInt(a.employee?.employeeId) || 0;
          const idB = parseInt(b.employee?.employeeId) || 0;
          return idA - idB; // Ascending order (1, 2, 3, ...)
        });
      });

      // Additional safety check - filter out any invalid entries
      monthlyArray.forEach(monthly => {
        monthly.payrolls = monthly.payrolls.filter(payroll =>
          payroll && payroll.month && payroll.year && payroll.employee
        );
      });

      setMonthlyPayrolls(monthlyArray);
      setTotalItems(monthlyArray.length);
      if (monthlyArray.length > 0) {
        setExportMonth(String(monthlyArray[0].month));
        setExportYear(monthlyArray[0].year);
      }
    } else {
      setMonthlyPayrolls([]);
      setTotalItems(0);
    }
  }, [payrolls, monthlyFilters, getFilteredPayrolls]);

  // Handle pagination for monthly payrolls
  useEffect(() => {
    const startIndex = page * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginated = monthlyPayrolls.slice(startIndex, endIndex);
    setPaginatedMonthlyPayrolls(paginated);
  }, [monthlyPayrolls, page, rowsPerPage]);

  // Calculate current overview from employees data (unused function)
  // const calculateCurrentOverview = () => {
  //   if (!employees || employees.length === 0) return {};
  //   
  //   const activeEmployees = employees.filter(emp => emp.employmentStatus === 'Active');
  //   
  //   let totalBasicSalary = 0;
  //   let totalGrossSalary = 0;
  //   let totalNetSalary = 0;
  //   
  //   activeEmployees.forEach(emp => {
  //     if (emp.salary && emp.salary.gross) {
  //       const gross = emp.salary.gross;
  //       const basic = gross * 0.6666; // 66.66% of gross
  //       // const medical = gross * 0.1; // 10% of gross (tax exempt)
  //       // const houseRent = gross * 0.2334; // 23.34% of gross
  //       
  //       totalBasicSalary += basic;
  //       totalGrossSalary += gross;
  //       
  //       // Calculate net salary (gross - deductions)
  //       // For now, using gross as net (deductions will be calculated later)
  //       totalNetSalary += gross;
  //     }
  //   });
  //   
  //   return {
  //     totalEmployees: activeEmployees.length,
  //     totalBasicSalary: Math.round(totalBasicSalary),
  //     totalGrossSalary: Math.round(totalGrossSalary),
  //     totalNetSalary: Math.round(totalNetSalary)
  //   };
  // };

  // No need to fetch employees, departments, positions - they're provided by DataContext

  const handleChangePage = (event, newPage) => {
    setPaginationLoading(true);
    setPage(newPage);
    // Small delay to show loading state
    setTimeout(() => setPaginationLoading(false), 300);
  };

  const handleChangeRowsPerPage = (event) => {
    setPaginationLoading(true);
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0); // Reset to first page when changing rows per page
    // Small delay to show loading state
    setTimeout(() => setPaginationLoading(false), 300);
  };

  const handleEmployeeDetailsPageChange = (monthKey, newPage) => {
    setEmployeeDetailsPage(prev => ({
      ...prev,
      [monthKey]: newPage
    }));
  };

  const handleEmployeeDetailsRowsPerPageChange = (monthKey, newRowsPerPage) => {
    setEmployeeDetailsRowsPerPage(prev => ({
      ...prev,
      [monthKey]: parseInt(newRowsPerPage, 10)
    }));
    // Reset to first page when changing rows per page
    setEmployeeDetailsPage(prev => ({
      ...prev,
      [monthKey]: 0
    }));
  };

  const handleEmployeeDetailsSearchChange = (monthKey, value) => {
    setEmployeeDetailsSearch((prev) => ({
      ...prev,
      [monthKey]: value
    }));
    // Search applies across all pages — always restart at page 1
    setEmployeeDetailsPage((prev) => ({
      ...prev,
      [monthKey]: 0
    }));
  };

  const handleGeneralPayrollPageChange = (newPage) => {
    setGeneralPayrollPage(newPage);
  };

  const handleGeneralPayrollRowsPerPageChange = (newRowsPerPage) => {
    setGeneralPayrollRowsPerPage(parseInt(newRowsPerPage, 10));
    setGeneralPayrollPage(0); // Reset to first page when changing rows per page
  };

  const getPaginatedEmployeeDetails = (monthly) => {
    const monthKey = `${monthly.month}-${monthly.year}`;
    const currentPage = employeeDetailsPage[monthKey] || 0;
    const currentRowsPerPage = employeeDetailsRowsPerPage[monthKey] || 10;
    const searchQuery = String(employeeDetailsSearch[monthKey] || '').trim().toLowerCase();

    // Filter full month list first so search covers every page, then paginate
    const filteredPayrolls = !searchQuery
      ? (monthly.payrolls || [])
      : (monthly.payrolls || []).filter((payroll) => {
          const emp = payroll.employee || {};
          const first = String(emp.firstName || '').toLowerCase();
          const last = String(emp.lastName || '').toLowerCase();
          const full = `${first} ${last}`.trim();
          const rawId = String(emp.employeeId || '').toLowerCase();
          const paddedId = formatEmployeeId(emp.employeeId).toLowerCase();
          return (
            first.includes(searchQuery) ||
            last.includes(searchQuery) ||
            full.includes(searchQuery) ||
            rawId.includes(searchQuery) ||
            paddedId.includes(searchQuery)
          );
        });

    const totalPages = Math.ceil(filteredPayrolls.length / currentRowsPerPage) || 0;
    const safePage = totalPages > 0 ? Math.min(currentPage, totalPages - 1) : 0;
    const startIndex = safePage * currentRowsPerPage;
    const endIndex = startIndex + currentRowsPerPage;

    return {
      paginatedEmployees: filteredPayrolls.slice(startIndex, endIndex),
      currentPage: safePage,
      currentRowsPerPage,
      totalEmployees: filteredPayrolls.length,
      totalInMonth: (monthly.payrolls || []).length,
      searchQuery,
      totalPages
    };
  };

  const handleMonthlyFilterChange = (field, value) => {
    setMonthlyFilters((prev) => ({ ...prev, [field]: value }));
    setPage(0);
  };

  const clearMonthlyFilters = () => {
    setMonthlyFilters({ status: '', department: '', project: '' });
    setPage(0);
  };

  const handleGeneralFilterChange = (field, value) => {
    setGeneralFilters((prev) => ({ ...prev, [field]: value }));
    setGeneralPayrollPage(0);
  };

  const clearGeneralFilters = () => {
    setGeneralFilters({ searchQuery: '', department: '', project: '' });
    setGeneralPayrollPage(0);
  };

  const getStatusColor = (status) => getPayrollStatusColor(status);

  const getStatusLabel = (status) => getPayrollStatusLabel(status);

  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return 'PKR 0';
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Format employee ID to 5 digits with leading zeros
  const formatEmployeeId = (employeeId) => {
    if (!employeeId) return '';
    return employeeId.toString().padStart(5, '0');
  };

  const exportYearOptions = useMemo(() => {
    const years = new Set(monthlyPayrolls.map((m) => m.year));
    const current = new Date().getFullYear();
    for (let y = current; y >= current - 8; y--) years.add(y);
    return Array.from(years).sort((a, b) => b - a);
  }, [monthlyPayrolls]);

  const downloadCsvBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const exportMonthPayrollCsv = async (month, year, periodLabel) => {
    const key = `${month}-${year}`;
    const monthNum = Number(month);
    const yearNum = Number(year);
    if (!monthNum || monthNum < 1 || monthNum > 12 || !yearNum) {
      setError('Select a valid month and year to export.');
      return;
    }

    try {
      setExportLoadingKey(key);
      setError(null);

      const response = await api.get('/hr/reports/payroll/monthly', {
        params: {
          month: monthNum,
          year: yearNum,
          ...(monthlyFilters.department ? { department: monthlyFilters.department } : {}),
          ...(monthlyFilters.project ? { project: monthlyFilters.project } : {}),
          format: 'csv'
        },
        responseType: 'blob',
        timeout: 120000
      });

      const contentType = response.headers?.['content-type'] || '';
      if (contentType.includes('application/json')) {
        const text = await response.data.text();
        const json = JSON.parse(text);
        setError(json.message || 'No payroll data to export for this period.');
        return;
      }

      const safeLabel = (periodLabel || `${monthNum}-${yearNum}`).replace(/\s+/g, '-');
      downloadCsvBlob(
        new Blob([response.data], { type: 'text/csv;charset=utf-8;' }),
        `payroll-detail-${safeLabel}.csv`
      );
    } catch (exportError) {
      console.error('Error exporting month payroll:', exportError);
      const blob = exportError.response?.data;
      if (blob instanceof Blob) {
        try {
          const text = await blob.text();
          const json = JSON.parse(text);
          setError(json.message || 'Failed to export payroll for this month.');
        } catch {
          setError('Failed to export payroll for this month.');
        }
      } else {
        setError(exportError.response?.data?.message || 'Failed to export payroll for this month.');
      }
    } finally {
      setExportLoadingKey(null);
    }
  };

  const exportMonthPayrollPdf = async (month, year, periodLabel) => {
    const key = `pdf-${month}-${year}`;
    const monthNum = Number(month);
    const yearNum = Number(year);
    if (!monthNum || monthNum < 1 || monthNum > 12 || !yearNum) {
      setError('Select a valid month and year to export.');
      return;
    }

    try {
      setExportLoadingKey(key);
      setError(null);

      const response = await api.get('/hr/reports/payroll/monthly', {
        params: {
          month: monthNum,
          year: yearNum,
          ...(monthlyFilters.department ? { department: monthlyFilters.department } : {}),
          ...(monthlyFilters.project ? { project: monthlyFilters.project } : {}),
          format: 'json'
        },
        timeout: 120000
      });

      const reportData = response.data?.data || response.data;
      if (!reportData || !reportData.data || !reportData.data.length) {
        setError('No payroll data to export for this period.');
        return;
      }

      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

      // Header bar
      doc.setFillColor(25, 118, 210);
      doc.rect(0, 0, 420, 22, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('SGC International', 14, 10);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Monthly Payroll - ${periodLabel}`, 14, 17);
      doc.setTextColor(80, 80, 80);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-PK')}`, 14, 33);
      doc.setDrawColor(200, 200, 200);
      doc.line(14, 36, 406, 36);

      const headers = [
        'Sr No', 'ID', 'Name', 'CNIC', 'Bank', 'Account No', 'Project', 'Company', 'Department', 'Designation',
        'Gross Salary', 'Arrears', 'Total Earn', 'Salary Ded', 'Total Ded', 'Net Payable'
      ];

      const rows = reportData.data.map((r, i) => [
        i + 1,
        r.employeeId || 'N/A',
        r.employeeName || 'N/A',
        r.idCard || 'N/A',
        r.bankName || 'N/A',
        r.accountNumber || 'N/A',
        r.project || 'N/A',
        r.company || 'N/A',
        r.department || 'N/A',
        r.designation || 'N/A',
        Math.round(r.grossSalary || 0).toLocaleString('en-PK'),
        Math.round(r.arrears || 0).toLocaleString('en-PK'),
        Math.round(r.totalEarnings || 0).toLocaleString('en-PK'),
        Math.round(r.salaryDeduction || 0).toLocaleString('en-PK'),
        Math.round(r.deductions || 0).toLocaleString('en-PK'),
        Math.round(r.netPay || r.netPayable || 0).toLocaleString('en-PK')
      ]);

      autoTable(doc, {
        startY: 42,
        head: [headers],
        body: rows,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [245, 245, 245], textColor: [60, 60, 60], fontStyle: 'bold' }
      });

      doc.save(`monthly-payroll-${periodLabel}.pdf`);
    } catch (exportError) {
      console.error('Error exporting month payroll to PDF:', exportError);
      setError(exportError.response?.data?.message || 'Failed to export payroll PDF for this month.');
    } finally {
      setExportLoadingKey(null);
    }
  };

  const exportEobiContributionReport = async (month, year, periodLabel) => {
    const key = `eobi-${month}-${year}`;
    const monthNum = Number(month);
    const yearNum = Number(year);
    if (!monthNum || monthNum < 1 || monthNum > 12 || !yearNum) {
      setError('Select a valid month and year to export EOBI contribution.');
      return;
    }

    try {
      setExportLoadingKey(key);
      setError(null);

      const response = await api.get('/hr/reports/payroll/monthly', {
        params: {
          month: monthNum,
          year: yearNum,
          ...(monthlyFilters.department ? { department: monthlyFilters.department } : {}),
          ...(monthlyFilters.project ? { project: monthlyFilters.project } : {}),
          format: 'json'
        },
        timeout: 120000
      });

      const reportData = response.data?.data || response.data;
      if (!reportData || !reportData.data || !reportData.data.length) {
        setError('No payroll data found for this period.');
        return;
      }

      const scopeLabel = resolveEobiReportScopeLabel(
        reportData.data,
        monthlyFilters,
        projects || [],
        departments || []
      );

      const result = await generateEobiContributionPdf({
        reportData,
        month: monthNum,
        year: yearNum,
        periodLabel,
        scopeLabel
      });

      if (!result.saved) {
        setError('No EOBI contributions found for this payroll period (employees with EOBI deduction).');
      }
    } catch (exportError) {
      console.error('Error exporting EOBI contribution report:', exportError);
      setError(exportError.response?.data?.message || 'Failed to export EOBI contribution report.');
    } finally {
      setExportLoadingKey(null);
    }
  };

  const exportManualSalarySheet = async (month, year, periodLabel) => {
    const key = `manual-pdf-${month}-${year}`;
    const monthNum = Number(month);
    const yearNum = Number(year);
    if (!monthNum || monthNum < 1 || monthNum > 12 || !yearNum) {
      setError('Select a valid month and year to export.');
      return;
    }

    try {
      setExportLoadingKey(key);
      setError(null);

      const response = await api.get('/hr/reports/payroll/monthly', {
        params: {
          month: monthNum,
          year: yearNum,
          ...(monthlyFilters.department ? { department: monthlyFilters.department } : {}),
          ...(monthlyFilters.project ? { project: monthlyFilters.project } : {}),
          format: 'json'
        },
        timeout: 120000
      });

      const reportData = response.data?.data || response.data;
      if (!reportData || !reportData.data || !reportData.data.length) {
        setError('No payroll data to export for this period.');
        return;
      }

      // Filter to only include manual payrolls
      const manualPayrolls = reportData.data.filter(p => p.isManual === true);
      
      if (manualPayrolls.length === 0) {
        setError(`No manual payrolls found for ${periodLabel}.`);
        return;
      }

      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      
      // Header section
      doc.setFillColor(180, 180, 180); // Gray background
      doc.rect(0, 0, 300, 35, 'F');
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('SARDAR GROUP OF COMPANIES', 148.5, 10, { align: 'center' });
      
      doc.setFontSize(14);
      doc.text('SGC - Head Office', 148.5, 20, { align: 'center' });
      
      doc.setFontSize(14);
      doc.text(`Salary ${periodLabel.replace('-', ' ')}`, 148.5, 30, { align: 'center' });

      const headers = [
        'Sr. No', 'Emp ID', 'Name', 'Designation', 'Project', 'DOJ',
        'Basic Salary', 'Food Allowance', `Gross Salary ${periodLabel.replace('-', ' ')}`, 'Income Tax', 'Net Payable', 'Remarks'
      ];

      let totalNetPayable = 0;

      const rows = manualPayrolls.map((r, i) => {
        const netPay = r.netPay || r.netPayable || 0;
        totalNetPayable += netPay;
        return [
          i + 1,
          r.employeeId || 'N/A',
          r.employeeName || 'N/A',
          r.designation || 'N/A',
          r.project || 'SGC-Head Office',
          r.doj ? new Date(r.doj).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-') : 'N/A',
          Math.round(r.basicSalary || 0).toLocaleString('en-PK'),
          Math.round(r.foodAllowance || 0).toLocaleString('en-PK'),
          Math.round(r.grossSalary || 0).toLocaleString('en-PK'),
          Math.round(r.incomeTax || 0).toLocaleString('en-PK'),
          Math.round(netPay).toLocaleString('en-PK'),
          r.bankAccount ? r.bankAccount : (r.remarks || '')
        ];
      });

      // Add total row
      rows.push([
        '', '', '', '', '', 'Total',
        '', '', '', '', Math.round(totalNetPayable).toLocaleString('en-PK'), ''
      ]);

      autoTable(doc, {
        startY: 35,
        head: [headers],
        body: rows,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2, textColor: [0, 0, 0], lineColor: [100, 100, 100], lineWidth: 0.1 },
        headStyles: { fillColor: [180, 180, 180], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', valign: 'middle' },
        didParseCell: function(data) {
          // Yellow highlight for specific columns (Basic, Food, Gross, Net)
          if (data.section === 'head' && [6, 7, 8, 10].includes(data.column.index)) {
            data.cell.styles.fillColor = [255, 255, 0]; // Yellow
          }
          if (data.section === 'body' && data.row.index === rows.length - 1) {
            // Total row
            data.cell.styles.fontStyle = 'bold';
            if (![10].includes(data.column.index)) {
              data.cell.styles.fillColor = [180, 180, 180];
            } else {
              data.cell.styles.fillColor = [255, 255, 0];
            }
          }
        },
        columnStyles: {
          6: { halign: 'right' },
          7: { halign: 'right' },
          8: { halign: 'right' },
          9: { halign: 'right' },
          10: { halign: 'right', fillColor: [255, 255, 0] },
          11: { halign: 'center' }
        }
      });

      doc.save(`manual-salary-sheet-${periodLabel}.pdf`);
    } catch (exportError) {
      console.error('Error exporting manual salary sheet:', exportError);
      setError(exportError.response?.data?.message || 'Failed to export manual salary sheet for this month.');
    } finally {
      setExportLoadingKey(null);
    }
  };

  const openMonthlyComparisonReport = async (month, year, periodLabel, draftCount = 0) => {
    const key = `${month}-${year}`;
    try {
      setComparisonLoadingKey(key);
      setError(null);
      setComparisonDialogOpen(true);
      setComparisonReport(null);
      setComparisonGeneratedAt(null);
      setComparisonReportStatus('Draft');
      setComparisonContext({ month, year, periodLabel, draftCount });

      const [reportResponse] = await Promise.all([
        api.post(`/payroll/monthly-comparison/${month}/${year}/generate`),
        fetchMonthlyApproval(month, year)
      ]);
      const data = reportResponse.data?.data;
      setComparisonReport(data?.report || null);
      setComparisonGeneratedAt(data?.generatedAt || new Date().toISOString());
      setComparisonReportStatus(data?.status || 'Draft');
      if (data?.monthlyApproval) {
        setMonthlyApprovals((prev) => ({ ...prev, [key]: data.monthlyApproval }));
      }
    } catch (err) {
      console.error('Monthly comparison report error:', err);
      setComparisonDialogOpen(false);
      setComparisonContext(null);
      setError(err.response?.data?.message || `Failed to generate comparison report for ${periodLabel}.`);
    } finally {
      setComparisonLoadingKey(null);
    }
  };

  const refreshComparisonDialogData = useCallback(async () => {
    if (!comparisonContext?.month || !comparisonContext?.year) return;
    const { month, year } = comparisonContext;
    const key = `${month}-${year}`;
    try {
      const [reportResponse] = await Promise.all([
        api.get(`/payroll/monthly-comparison/${month}/${year}`),
        fetchMonthlyApproval(month, year)
      ]);
      const data = reportResponse.data?.data;
      if (data?.report) setComparisonReport(data.report);
      if (data?.generatedAt) setComparisonGeneratedAt(data.generatedAt);
      if (data?.status) setComparisonReportStatus(data.status);
      if (data?.monthlyApproval) {
        setMonthlyApprovals((prev) => ({ ...prev, [key]: data.monthlyApproval }));
      }
    } catch (err) {
      console.error('Error refreshing comparison report:', err);
    }
  }, [comparisonContext, fetchMonthlyApproval]);

  const handleExportMonthlySummary = () => {
    try {
      if (!monthlyPayrolls.length) {
        setError('No monthly payroll data available to export.');
        return;
      }

      const rows = monthlyPayrolls.map((monthly) => ({
        period: `${monthly.monthName} ${monthly.year}`,
        employees: monthly.totalEmployees || 0,
        totalBasicSalary: Math.round(monthly.totalBasicSalary || 0),
        totalGrossSalary: Math.round(monthly.totalGrossSalary || 0),
        totalNetSalary: Math.round(monthly.totalNetSalary || 0),
        status: getMonthStatusLabel(monthly.statuses || new Set())
      }));

      const csvHeader = ['Pay Period', 'Employees', 'Total Basic Salary', 'Total Gross Pay', 'Total Net Pay', 'Status'];
      const csvRows = rows.map((row) => ([
        row.period,
        row.employees,
        row.totalBasicSalary,
        row.totalGrossSalary,
        row.totalNetSalary,
        row.status
      ]));

      const csvContent = [csvHeader, ...csvRows]
        .map((line) => line.map((item) => `"${String(item).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const now = new Date();
      const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      downloadCsvBlob(
        new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }),
        `monthly-payroll-summary-all-periods-${datePart}.csv`
      );
    } catch (exportError) {
      console.error('Error exporting monthly payroll summary:', exportError);
      setError('Failed to export monthly payroll summary.');
    }
  };

  // Same criteria as GET /payroll/current-overview and POST /payroll bulk create
  const isPayrollEligibleEmployee = (employee = {}) => {
    const status = String(employee.employmentStatus || '').trim();
    const gross = Number(employee.salary?.gross ?? employee.grossSalary ?? 0);
    return (status === 'Active' || status === 'Reinstated') && gross > 0;
  };

  const bulkPayrollEligibleCount =
    currentOverview?.totalEmployees ??
    (currentOverview?.employees?.length ||
      employees.filter(isPayrollEligibleEmployee).length);

  const departmentOptions = useMemo(() => {
    const map = new Map();
    const pushOption = (id, name) => {
      if (!id) return;
      const key = String(id);
      if (!map.has(key)) map.set(key, { _id: key, name: name || key });
    };

    (masterDepartments || []).forEach((dept) => pushOption(dept?._id, dept?.name));
    (departments || []).forEach((dept) => pushOption(dept?._id, dept?.name));
    (payrolls || []).forEach((p) => {
      const deptObj = p?.employee?.placementDepartment || p?.employee?.department;
      if (deptObj && typeof deptObj === 'object') pushOption(deptObj._id, deptObj.name);
      else if (deptObj) pushOption(deptObj, deptObj);
    });
    (currentOverview?.employees || []).forEach((emp) => {
      const deptObj = emp?.placementDepartment || emp?.department;
      if (deptObj && typeof deptObj === 'object') pushOption(deptObj._id, deptObj.name);
      else if (deptObj) pushOption(deptObj, deptObj);
    });

    return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [masterDepartments, departments, payrolls, currentOverview]);

  const projectOptions = useMemo(() => {
    const map = new Map();
    const pushOption = (id, name) => {
      if (!id) return;
      const key = String(id);
      if (!map.has(key)) map.set(key, { _id: key, name: name || key });
    };

    (masterProjects || []).forEach((project) => pushOption(project?._id, project?.name));
    (projects || []).forEach((project) => pushOption(project?._id, project?.name));
    (payrolls || []).forEach((p) => {
      const projectObj = p?.employee?.placementProject;
      if (projectObj && typeof projectObj === 'object') pushOption(projectObj._id, projectObj.name);
      else if (projectObj) pushOption(projectObj, projectObj);
    });
    (currentOverview?.employees || []).forEach((emp) => {
      const projectObj = emp?.placementProject;
      if (projectObj && typeof projectObj === 'object') pushOption(projectObj._id, projectObj.name);
      else if (projectObj) pushOption(projectObj, projectObj);
    });

    return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [masterProjects, projects, payrolls, currentOverview]);

  const employeeLookup = useMemo(() => {
    const map = new Map();
    (employees || []).forEach((e) => map.set(String(e._id), e));
    return map;
  }, [employees]);

  const resolveGeneralEmployeeDeptId = useCallback(
    (emp) => {
      const full = employeeLookup.get(String(emp?._id));
      const dept =
        full?.placementDepartment ||
        full?.department ||
        emp?.placementDepartment ||
        emp?.department;
      return dept?._id || dept || '';
    },
    [employeeLookup]
  );

  const resolveGeneralEmployeeProjectId = useCallback(
    (emp) => {
      const full = employeeLookup.get(String(emp?._id));
      const project = full?.placementProject || emp?.placementProject;
      return project?._id || project || '';
    },
    [employeeLookup]
  );

  const getGeneralEmployeeDeptName = (emp) => {
    const dept =
      emp?.placementDepartment ||
      emp?.department ||
      employeeLookup.get(String(emp?._id))?.placementDepartment ||
      employeeLookup.get(String(emp?._id))?.department;
    if (dept && typeof dept === 'object') return dept.name || '';
    return '';
  };

  const getGeneralEmployeeProjectName = (emp) => {
    const project =
      emp?.placementProject || employeeLookup.get(String(emp?._id))?.placementProject;
    if (project && typeof project === 'object') return project.name || '';
    return '';
  };

  const filteredGeneralEmployees = useMemo(() => {
    let list = currentOverview?.employees || [];

    if (generalFilters.department) {
      list = list.filter(
        (emp) => String(resolveGeneralEmployeeDeptId(emp)) === String(generalFilters.department)
      );
    }
    if (generalFilters.project) {
      list = list.filter(
        (emp) => String(resolveGeneralEmployeeProjectId(emp)) === String(generalFilters.project)
      );
    }
    if (generalFilters.searchQuery) {
      const query = generalFilters.searchQuery.toLowerCase();
      list = list.filter(
        (emp) =>
          emp.firstName?.toLowerCase().includes(query) ||
          emp.lastName?.toLowerCase().includes(query) ||
          String(emp.employeeId || '')
            .toLowerCase()
            .includes(query)
      );
    }

    return list;
  }, [
    currentOverview,
    generalFilters,
    resolveGeneralEmployeeDeptId,
    resolveGeneralEmployeeProjectId
  ]);

  const generalPayrollSummary = useMemo(() => {
    const totals = filteredGeneralEmployees.reduce(
      (acc, emp) => {
        acc.totalBasicSalary += emp.basicSalary || 0;
        acc.totalGrossSalary += emp.totalEarnings || 0;
        acc.totalNetSalary += emp.netSalary || 0;
        return acc;
      },
      { totalBasicSalary: 0, totalGrossSalary: 0, totalNetSalary: 0 }
    );

    return {
      totalEmployees: filteredGeneralEmployees.length,
      ...totals
    };
  }, [filteredGeneralEmployees]);

  const hasGeneralFilters = Object.values(generalFilters).some((v) => v !== '' && v != null);
  const hasMonthlyFilters = Object.values(monthlyFilters).some((v) => v !== '' && v != null);

  const getPaginatedGeneralPayrollEmployees = () => {
    const employeesToShow = filteredGeneralEmployees;
    const startIndex = generalPayrollPage * generalPayrollRowsPerPage;
    const endIndex = startIndex + generalPayrollRowsPerPage;

    return {
      paginatedEmployees: employeesToShow.slice(startIndex, endIndex),
      currentPage: generalPayrollPage,
      currentRowsPerPage: generalPayrollRowsPerPage,
      totalEmployees: employeesToShow.length,
      totalPages: Math.ceil(employeesToShow.length / generalPayrollRowsPerPage) || 0
    };
  };

  const exportGeneralPayrollCsv = () => {
    if (!filteredGeneralEmployees.length) {
      setError('No current payroll data to export for the selected filters.');
      return;
    }

    const escapeCsv = (value) => {
      const str = value == null ? '' : String(value);
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    const headers = [
      'Employee ID',
      'Employee Name',
      'Department',
      'Project',
      'Basic Salary',
      'Arrears',
      'Gross Pay',
      'Net Pay'
    ];
    const rows = filteredGeneralEmployees.map((emp) => [
      formatEmployeeId(emp.employeeId),
      `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
      getGeneralEmployeeDeptName(emp),
      getGeneralEmployeeProjectName(emp),
      emp.basicSalary ?? 0,
      emp.arrears ?? 0,
      emp.totalEarnings ?? 0,
      emp.netSalary ?? 0
    ]);

    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
    downloadCsvBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      `current-payroll-${new Date().toISOString().slice(0, 10)}.csv`
    );
  };

  // Unused function - handleApprove
  // const handleApprove = async (payrollId) => {
  //   try {
  //     await api.patch(`/payroll/${payrollId}/approve`);
  //     fetchPayrolls();
  //     fetchStats();
  //   } catch (error) {
  //     console.error('Error approving payroll:', error);
  //     setError('Failed to approve payroll');
  //   }
  // };

  // Unused function - handleMarkAsPaid
  // const handleMarkAsPaid = async (payrollId) => {
  //   try {
  //     await api.patch(`/payroll/${payrollId}/mark-paid`);
  //     fetchPayrolls();
  //     fetchStats();
  //   } catch (error) {
  //     console.error('Error marking payroll as paid:', error);
  //     setError('Failed to mark payroll as paid');
  //   }
  // };

  // Unused function - handleMarkAsUnpaid
  // const handleMarkAsUnpaid = async (payrollId) => {
  //   try {
  //     await api.patch(`/payroll/${payrollId}/mark-unpaid`);
  //     fetchPayrolls();
  //     fetchStats();
  //   } catch (error) {
  //     console.error('Error marking payroll as unpaid:', error);
  //     setError('Failed to mark payroll as unpaid');
  //   }
  // };

  const handleDelete = async (payrollId) => {
    if (window.confirm('Are you sure you want to delete this payroll?')) {
      try {
        await api.delete(`/payroll/${payrollId}`);
        fetchPayrolls();
        fetchStats();
      } catch (err) {
        console.error(err);
        setError('Failed to delete payroll');
      }
    }
  };

  const handleDeleteMonthlySummary = async (month, year, monthName) => {
    if (window.confirm(`Are you sure you want to delete all payrolls for ${monthName} ${year}?`)) {
      try {
        await api.delete(`/payroll/month/${year}/${month}`);
        alert(`Successfully deleted all payrolls for ${monthName} ${year}`);
        fetchPayrolls();
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.message || 'Failed to delete monthly payrolls');
      }
    }
  };

  const handleBulkCreate = async () => {
    try {
      setBulkCreateLoading(true);

      // Get month and year from form
      const month = parseInt(bulkCreateForm.month);
      const year = bulkCreateForm.year;

      // Check if payrolls already exist for this month
      const existingPayrolls = payrolls.filter(
        p => p.month === month && p.year === year
      );

      let forceRegenerate = false;

      if (existingPayrolls.length > 0) {
        const confirmMessage = `${existingPayrolls.length} payrolls already exist for ${months.find(m => m.value === bulkCreateForm.month)?.label} ${bulkCreateForm.year}. 
        
Do you want to:
1. Regenerate all payrolls (overwrite existing)?
2. Skip employees who already have payrolls?
3. Cancel?`;

        const choice = window.confirm(confirmMessage) ?
          (window.confirm('Regenerate all payrolls? This will overwrite existing ones.') ? 'regenerate' : 'skip') :
          'cancel';

        if (choice === 'cancel') {
          setBulkCreateLoading(false);
          return;
        }

        forceRegenerate = (choice === 'regenerate');
      } else {
        // No existing payrolls, create for all active employees
        const confirmMessage = `Create payrolls for all active employees for ${months.find(m => m.value === bulkCreateForm.month)?.label} ${bulkCreateForm.year}?`;
        if (!window.confirm(confirmMessage)) {
          setBulkCreateLoading(false);
          return;
        }
      }

      // Use the new bulk generation API endpoint
      const response = await api.post('/payroll', {
        month: month,
        year: year,
        forceRegenerate: forceRegenerate
      }, {
        timeout: 600000
      });

      setBulkCreateDialogOpen(false);
      setBulkCreateForm({
        month: (new Date().getMonth() + 1).toString().padStart(2, '0'),
        year: new Date().getFullYear()
      });

      // Refresh data
      fetchPayrolls();
      fetchStats();

      setError(null);

      // Show success message
      if (response.data.success) {
        const summary = response.data.data.summary;
        const skippedCount = response.data.data.skippedEmployees ? response.data.data.skippedEmployees.length : 0;
        const createdCount = summary.payrollsCreated ?? 0;
        const processedCount = summary.totalEmployees ?? createdCount;
        const errorCount = summary.errors ?? (response.data.data.errors?.length || 0);

        let message = `✅ Successfully generated ${createdCount} payrolls for ${months.find(m => m.value === bulkCreateForm.month)?.label} ${bulkCreateForm.year}.\n\n`;
        message += `📊 Summary:\n`;
        message += `• Employees Processed: ${processedCount}\n`;
        message += `• Payrolls Created: ${createdCount}\n`;
        message += `• Total Gross Salary: Rs. ${summary.totalGrossSalary.toLocaleString()}\n`;
        message += `• Total Net Salary: Rs. ${summary.totalNetSalary.toLocaleString()}\n`;
        message += `• Total Tax: Rs. ${summary.totalTax.toLocaleString()}\n`;

        if (summary.arrearsUpdated > 0) {
          message += `\n💰 Arrears Status Updated: ${summary.arrearsUpdated} employees marked as 'Paid'`;
        }

        if (skippedCount > 0) {
          message += `\n⏭️  Skipped: ${skippedCount} employees (already had payrolls)`;
        }

        if (errorCount > 0) {
          message += `\n⚠️  Errors: ${errorCount} (see console for details)`;
        }

        alert(message);
      } else {
        alert('Payroll generation completed but with some issues. Please check the console for details.');
      }
    } catch (error) {
      console.error('Error creating bulk payrolls:', error);
      const backendMessage = error.response?.data?.message;
      const backendDetail = error.response?.data?.error;
      setError(`Failed to create bulk payrolls: ${backendMessage || backendDetail || error.message}`);
    } finally {
      setBulkCreateLoading(false);
    }
  };

  const toggleMonthExpansion = (monthKey) => {
    setExpandedMonths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(monthKey)) {
        newSet.delete(monthKey);
      } else {
        newSet.add(monthKey);
        setEmployeeDetailsPage((prevPages) => ({
          ...prevPages,
          [monthKey]: 0
        }));
        const [month, year] = monthKey.split('-').map(Number);
        if (month && year) fetchMonthlyApproval(month, year);
      }
      return newSet;
    });
  };

  useEffect(() => {
    paginatedMonthlyPayrolls.forEach((monthly) => {
      const key = `${monthly.month}-${monthly.year}`;
      if (!monthlyApprovals[key] && !monthlyApprovalLoadingKeys.has(key)) {
        fetchMonthlyApproval(monthly.month, monthly.year);
      }
    });
  }, [paginatedMonthlyPayrolls, monthlyApprovals, monthlyApprovalLoadingKeys, fetchMonthlyApproval]);

  const toggleGeneralPayrollExpansion = () => {
    setGeneralPayrollExpanded(prev => !prev);
    // Reset pagination when expanding
    if (!generalPayrollExpanded) {
      setGeneralPayrollPage(0);
    }
  };

  const normalizeMonthStatuses = (statuses) => {
    const raw = statuses instanceof Set ? [...statuses] : Array.isArray(statuses) ? statuses : [];
    return new Set(
      raw
        .map((s) => (s == null ? '' : String(s).trim()))
        .filter(Boolean)
    );
  };

  const getMonthStatusColor = (statuses) => {
    const set = normalizeMonthStatuses(statuses);
    if (set.size === 0) return 'default';
    if (set.size === 1) return getPayrollStatusColor([...set][0]);
    if (set.has('Approved by AVP') && !set.has('Draft')) return 'success';
    if (set.has('Approved by GM HR')) return 'primary';
    if (set.has('Approved by Deputy Manager Payroll HR')) return 'info';
    if (set.has('Draft') && set.has('Approved')) return 'warning';
    if (set.has('Approved') && set.has('Paid')) return 'info';
    if (set.has('Draft')) return 'warning';
    return 'warning';
  };

  const getMonthStatusLabel = (statuses) => {
    const set = normalizeMonthStatuses(statuses);
    if (set.size === 0) return '—';
    if (set.size === 1) {
      const only = [...set][0];
      if (only === 'Paid') return 'All Paid';
      return getPayrollStatusLabel(only);
    }
    if (set.has('Approved by AVP') && !set.has('Draft')) return 'Approved by AVP';
    if (set.has('Approved by GM HR') && !set.has('Draft')) return 'Approved by GM HR';
    if (set.has('Approved by Deputy Manager Payroll HR') && !set.has('Draft')) {
      return 'Approved by Deputy Manager Payroll HR';
    }
    if (set.has('Draft') && set.has('Approved') && !set.has('Paid')) return 'Partially Approved';
    if (set.has('Approved') && set.has('Paid') && !set.has('Draft')) return 'Partially Paid';
    if (set.has('Draft') && set.has('Paid')) return 'Mixed';
    return 'Mixed';
  };

  const countDraftPayrolls = (payrollList) =>
    (payrollList || []).filter((p) => String(p?.status || '').toLowerCase() === 'draft').length;

  const canApproveDraftsForMonth = (month, year) =>
    monthlyApprovals[`${month}-${year}`]?.authorityStatus === 'approved';

  // eslint-disable-next-line no-unused-vars
  const bulkApprovePayrolls = async (month, year, periodLabel, options = {}) => {
    const { silent = false } = options;
    const monthNum = Number(month);
    const yearNum = Number(year);
    if (!monthNum || monthNum < 1 || monthNum > 12 || !yearNum) {
      setError('Select a valid month and year to approve payrolls.');
      return;
    }

    if (!canApproveDraftsForMonth(monthNum, yearNum)) {
      setError('All monthly payroll approval authorities must approve before draft payrolls can be approved.');
      return;
    }

    const label =
      periodLabel ||
      `${months.find((m) => String(parseInt(m.value, 10)) === String(monthNum))?.label || monthNum} ${yearNum}`;

    const draftCount =
      monthlyPayrolls.find((m) => m.month === monthNum && m.year === yearNum)?.payrolls?.filter(
        (p) => String(p?.status || '').toLowerCase() === 'draft'
      ).length ?? null;

    const confirmMsg =
      draftCount != null
        ? `Approve all ${draftCount} draft payroll(s) for ${label}?`
        : `Approve all draft payrolls for ${label}?`;

    if (!window.confirm(confirmMsg)) return;

    const loadingKey = `${monthNum}-${yearNum}`;

    try {
      setBulkApproveLoadingKey(loadingKey);
      setError(null);

      const response = await api.post(
        '/payroll/bulk-approve',
        {
          month: monthNum,
          year: yearNum,
          ...(monthlyFilters.department ? { department: monthlyFilters.department } : {}),
          ...(monthlyFilters.project ? { project: monthlyFilters.project } : {})
        },
        { timeout: 300000 }
      );

      const { approved = 0, failed = 0 } = response.data?.data || {};
      await fetchMonthlyPayrolls();
      fetchStats();

      if (!silent) {
        const msg = response.data?.message || `Approved ${approved} payroll(s).`;
        if (failed > 0) {
          alert(`${msg}\n\n${failed} payroll(s) could not be approved. Check console for details.`);
          console.warn('Bulk approve errors:', response.data?.data?.errors);
        } else {
          alert(msg);
        }
      }
    } catch (err) {
      console.error('Bulk approve failed:', err);
      setError(err.response?.data?.message || 'Failed to approve payrolls for this month.');
    } finally {
      setBulkApproveLoadingKey(null);
    }
  };


  if ((loading && payrolls.length === 0) || dataLoading.employees || dataLoading.departments || dataLoading.positions) {
    return (
      <Box sx={{ p: 3 }}>
        {/* Header Skeleton */}
        <Box sx={{ mb: 3 }}>
          <Skeleton variant="text" width={200} height={40} sx={{ mb: 2 }} />
          <Skeleton variant="text" width={300} height={24} />
        </Box>

        {/* Stats Cards Skeleton */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[1, 2, 3, 4].map((i) => (
            <Grid item xs={12} sm={6} md={3} key={i}>
              <Card sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Skeleton variant="circular" width={40} height={40} sx={{ mr: 2 }} />
                    <Skeleton variant="text" width={120} height={24} />
                  </Box>
                  <Skeleton variant="text" width={80} height={32} sx={{ mb: 1 }} />
                  <Skeleton variant="text" width={100} height={20} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Filter Controls Skeleton */}
        <Card sx={{ mb: 3, borderRadius: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <Skeleton variant="circular" width={24} height={24} />
              <Skeleton variant="text" width={100} height={24} />
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <Skeleton variant="rectangular" width="100%" height={56} sx={{ borderRadius: 1 }} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Skeleton variant="rectangular" width="100%" height={56} sx={{ borderRadius: 1 }} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Skeleton variant="rectangular" width="100%" height={56} sx={{ borderRadius: 1 }} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Skeleton variant="rectangular" width="100%" height={56} sx={{ borderRadius: 1 }} />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Table Skeleton */}
        <Card sx={{ borderRadius: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Skeleton variant="text" width={150} height={28} />
              <Skeleton variant="rectangular" width={120} height={36} sx={{ borderRadius: 1 }} />
            </Box>

            <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
              <Table>
                <TableHead>
                  <TableRow>
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <TableCell key={i}>
                        <Skeleton variant="text" width={80} height={20} />
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[1, 2, 3, 4, 5].map((row) => (
                    <TableRow key={row}>
                      {[1, 2, 3, 4, 5, 6].map((cell) => (
                        <TableCell key={cell}>
                          <Skeleton variant="text" width={cell === 1 ? 100 : 80} height={20} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Pagination Skeleton */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
              <Skeleton variant="text" width={120} height={20} />
              <Skeleton variant="rectangular" width={200} height={32} sx={{ borderRadius: 1 }} />
            </Box>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Payroll Management
        </Typography>
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
            startIcon={<PercentIcon />}
            onClick={() => setSalaryCutDialogOpen(true)}
            color="warning"
          >
            Import Salary % Cut
          </Button>
          <Button
            variant="outlined"
            startIcon={<GroupWorkIcon />}
            onClick={() => {
              fetchCurrentOverview();
              setBulkCreateDialogOpen(true);
            }}
            color="secondary"
          >
            Bulk Create Payroll
          </Button>
        </Box>
      </Box>

      {/* Statistics Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <AccountBalanceIcon sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Employees
                  </Typography>
                  <Typography variant="h4">
                    {stats.totalPayrolls || 0}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TrendingUpIcon sx={{ fontSize: 40, color: 'success.main', mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Gross Pay
                  </Typography>
                  <Typography variant="h4">
                    {formatCurrency(stats.totalGrossSalary)}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <ReceiptIcon sx={{ fontSize: 40, color: 'warning.main', mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Net Pay
                  </Typography>
                  <Typography variant="h4">
                    {formatCurrency(stats.totalNetSalary)}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <PeopleIcon sx={{ fontSize: 40, color: 'info.main', mr: 2 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Avg Net Pay
                  </Typography>
                  <Typography variant="h4">
                    {formatCurrency(stats.averageNetSalary)}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Navigation Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          indicatorColor="primary"
          textColor="primary"
        >
          <Tab label="Monthly Payroll & Overview" />
          <Tab label="Salary Advances" />
          <Tab label="Manual Salary Sheet" />
        </Tabs>
      </Paper>

      {activeTab === 2 ? (
        <ManualSalarySheet 
          manualSalaries={manualSalaries} 
          loading={manualSalariesLoading} 
          onRefresh={fetchManualSalaries} 
        />
      ) : activeTab === 1 ? (
        <SalaryAdvanceManagement employees={employees} />
      ) : (
        <>
          {/* General Payroll Overview Card */}
          <Card sx={{ mb: 3, bgcolor: 'primary.50' }}>
            <CardContent>
              <Typography variant="h6" color="primary.main" sx={{ mb: 2, fontWeight: 600 }}>
                📋 General Payroll
                {hasGeneralFilters && (
                  <Chip
                    label="Filtered"
                    size="small"
                    color="primary"
                    variant="outlined"
                    sx={{ ml: 2, fontSize: '0.75rem' }}
                  />
                )}
              </Typography>

              <Box
                sx={{
                  mb: 2,
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.03)
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  alignItems={{ xs: 'stretch', md: 'flex-end' }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      fontWeight={700}
                      color="text.secondary"
                      sx={{ mb: 1.25, display: 'block', letterSpacing: '0.06em' }}
                    >
                      FILTERS
                    </Typography>
                    <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" alignItems="flex-end">
                      <TextField
                        size="small"
                        label="Search employee"
                        placeholder="Name or ID..."
                        value={generalFilters.searchQuery}
                        onChange={(e) => handleGeneralFilterChange('searchQuery', e.target.value)}
                        sx={{ minWidth: { xs: '100%', sm: 200 }, flex: { sm: '1 1 200px' } }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <SearchIcon fontSize="small" color="action" />
                            </InputAdornment>
                          )
                        }}
                      />
                      <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 150 }, flex: { sm: '1 1 150px' } }}>
                        <InputLabel>Department</InputLabel>
                        <Select
                          value={generalFilters.department}
                          onChange={(e) => handleGeneralFilterChange('department', e.target.value)}
                          label="Department"
                        >
                          <MenuItem value="">All Departments</MenuItem>
                          {departmentOptions.map((dept) => (
                            <MenuItem key={dept._id} value={dept._id}>
                              {dept.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 150 }, flex: { sm: '1 1 150px' } }}>
                        <InputLabel>Project</InputLabel>
                        <Select
                          value={generalFilters.project}
                          onChange={(e) => handleGeneralFilterChange('project', e.target.value)}
                          label="Project"
                        >
                          <MenuItem value="">All Projects</MenuItem>
                          {projectOptions
                            .slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((project) => (
                              <MenuItem key={project._id} value={project._id}>
                                {project.name}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      <Button
                        variant="outlined"
                        color="inherit"
                        size="small"
                        startIcon={<ClearIcon />}
                        onClick={clearGeneralFilters}
                        disabled={!hasGeneralFilters}
                        sx={{ height: 40, flexShrink: 0, px: 2 }}
                      >
                        Clear
                      </Button>
                    </Stack>
                  </Box>

                  <Divider orientation="horizontal" sx={{ display: { xs: 'block', md: 'none' } }} />
                  <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />

                  <Box sx={{ flexShrink: 0 }}>
                    <Typography
                      variant="caption"
                      fontWeight={700}
                      color="text.secondary"
                      sx={{ mb: 1.25, display: 'block', letterSpacing: '0.06em' }}
                    >
                      EXPORT
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={
                        exportLoadingKey === 'general-current' ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <DownloadIcon />
                        )
                      }
                      disabled={!!exportLoadingKey || !filteredGeneralEmployees.length}
                      onClick={exportGeneralPayrollCsv}
                      sx={{ height: 40, whiteSpace: 'nowrap' }}
                    >
                      Export current payroll
                    </Button>
                  </Box>
                </Stack>
              </Box>

              <Paper sx={{ width: '100%', overflow: 'hidden' }}>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Pay Period</TableCell>
                        <TableCell>Employees</TableCell>
                        <TableCell>Total Basic Salary</TableCell>
                        <TableCell>Total Gross Pay</TableCell>
                        <TableCell>Total Net Pay</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="center">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow hover sx={{ bgcolor: 'background.paper' }}>
                        <TableCell>
                          <Box>
                            <Typography variant="subtitle2">
                              Current Payroll
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              General
                              {currentOverview?.month && currentOverview?.year ? (
                                <> · {months.find((m) => Number(m.value) === Number(currentOverview.month))?.label || currentOverview.month} {currentOverview.year}</>
                              ) : null}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {currentOverviewLoading ? (
                              <CircularProgress size={16} />
                            ) : (
                              `${generalPayrollSummary.totalEmployees} Employees`
                            )}
                            {hasGeneralFilters && !currentOverviewLoading && (
                              <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 0.5 }}>
                                Filtered view
                              </Typography>
                            )}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {currentOverviewLoading ? (
                            <CircularProgress size={16} />
                          ) : (
                            formatCurrency(generalPayrollSummary.totalBasicSalary)
                          )}
                        </TableCell>
                        <TableCell>
                          {currentOverviewLoading ? (
                            <CircularProgress size={16} />
                          ) : (
                            formatCurrency(generalPayrollSummary.totalGrossSalary)
                          )}
                        </TableCell>
                        <TableCell>
                          {currentOverviewLoading ? (
                            <CircularProgress size={16} />
                          ) : (
                            formatCurrency(generalPayrollSummary.totalNetSalary)
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label="Active"
                            size="small"
                            color="success"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                            <Tooltip title="Export current payroll (CSV)">
                              <span>
                                <IconButton
                                  size="small"
                                  color="primary"
                                  disabled={exportLoadingKey === 'general-current' || !filteredGeneralEmployees.length}
                                  onClick={exportGeneralPayrollCsv}
                                >
                                  {exportLoadingKey === 'general-current' ? (
                                    <CircularProgress size={18} />
                                  ) : (
                                    <DownloadIcon fontSize="small" />
                                  )}
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={generalPayrollExpanded ? 'Hide Details' : 'View Details'}>
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={toggleGeneralPayrollExpansion}
                              >
                                {generalPayrollExpanded ? <ExpandMoreIcon /> : <ViewIcon />}
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              {/* Expanded Employee Details for General Payroll */}
              <Collapse in={generalPayrollExpanded} timeout="auto" unmountOnExit>
                <Box sx={{ margin: 1 }}>
                  <Typography variant="h6" gutterBottom component="div">
                    Employee Details - Current Payroll
                    <Chip
                      label="↑ Sorted by Employee ID"
                      size="small"
                      color="primary"
                      variant="outlined"
                      sx={{ ml: 2, fontSize: '0.75rem', height: 24 }}
                    />
                  </Typography>

                  {/* Employee Details Pagination Info */}
                  {(() => {
                    const paginationInfo = getPaginatedGeneralPayrollEmployees();
                    return (
                      <Box sx={{
                        mb: 2,
                        p: 2,
                        bgcolor: 'grey.50',
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'grey.200'
                      }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                          <Box>
                            <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
                              👥 Employee List
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                              Showing {paginationInfo.currentPage * paginationInfo.currentRowsPerPage + 1}-{Math.min((paginationInfo.currentPage + 1) * paginationInfo.currentRowsPerPage, paginationInfo.totalEmployees)} of {paginationInfo.totalEmployees} employees
                            </Typography>
                            <Typography variant="caption" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              📊 Sorted by Employee ID (1, 2, 3...)
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" color="textSecondary">
                              Page {paginationInfo.currentPage + 1} of {paginationInfo.totalPages}
                            </Typography>
                            {paginationInfo.totalPages > 1 && (
                              <Chip
                                label={`${paginationInfo.totalPages} pages`}
                                size="small"
                                color="primary"
                                variant="outlined"
                              />
                            )}
                          </Box>
                        </Box>
                      </Box>
                    );
                  })()}

                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Employee</TableCell>
                        <TableCell>Basic Salary</TableCell>
                        <TableCell>Gross Pay</TableCell>
                        <TableCell>Net Pay</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="center">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(() => {
                        const paginationInfo = getPaginatedGeneralPayrollEmployees();
                        if (paginationInfo.paginatedEmployees.length === 0) {
                          return (
                            <TableRow>
                              <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                                <Box sx={{ textAlign: 'center' }}>
                                  <Typography variant="body2" color="textSecondary">
                                    No active employees found
                                  </Typography>
                                </Box>
                              </TableCell>
                            </TableRow>
                          );
                        }

                        return paginationInfo.paginatedEmployees.map((employee) => {
                          return (
                            <TableRow key={employee._id}>
                              <TableCell>
                                <Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                    <Typography variant="subtitle2">
                                      {employee.firstName} {employee.lastName}
                                    </Typography>
                                    <PayrollProrationBadge payroll={{ proration: employee.proration }} />
                                    {employee.isCashSalary && (
                                      <Chip label="Cash" size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                                    )}
                                  </Box>
                                  <Typography variant="caption" color="textSecondary">
                                    {employee.employeeId}
                                  </Typography>
                                </Box>
                              </TableCell>
                              <TableCell>{formatCurrency(employee.basicSalary)}</TableCell>
                              <TableCell>{formatCurrency(employee.totalEarnings)}</TableCell>
                              <TableCell>{formatCurrency(employee.netSalary)}</TableCell>
                              <TableCell>
                                <Chip
                                  label="Active"
                                  color="success"
                                  size="small"
                                />
                              </TableCell>
                              <TableCell align="center">
                                <Tooltip title="View Payroll Details">
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    onClick={() => navigate(`/hr/payroll/view/employee/${employee._id}`)}
                                  >
                                    <ViewIcon />
                                  </IconButton>
                                </Tooltip>
                              </TableCell>
                            </TableRow>
                          );
                        });
                      })()}
                    </TableBody>
                  </Table>

                  {/* General Payroll Employee Details Pagination Controls */}
                  {(() => {
                    const paginationInfo = getPaginatedGeneralPayrollEmployees();
                    if (paginationInfo.totalPages <= 1) return null;

                    return (
                      <Box sx={{
                        mt: 2,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 2
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Typography variant="body2" color="textSecondary">
                            Employees per page:
                          </Typography>
                          <FormControl size="small" sx={{ minWidth: 80 }}>
                            <Select
                              value={paginationInfo.currentRowsPerPage}
                              onChange={(e) => handleGeneralPayrollRowsPerPageChange(e.target.value)}
                              sx={{ height: 32 }}
                            >
                              <MenuItem value={5}>5</MenuItem>
                              <MenuItem value={10}>10</MenuItem>
                              <MenuItem value={25}>25</MenuItem>
                              <MenuItem value={50}>50</MenuItem>
                            </Select>
                          </FormControl>
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Button
                            size="small"
                            onClick={() => handleGeneralPayrollPageChange(paginationInfo.currentPage - 1)}
                            disabled={paginationInfo.currentPage === 0}
                            variant="outlined"
                          >
                            Previous
                          </Button>

                          <Typography variant="body2" sx={{ px: 2 }}>
                            {paginationInfo.currentPage + 1} of {paginationInfo.totalPages}
                          </Typography>

                          <Button
                            size="small"
                            onClick={() => handleGeneralPayrollPageChange(paginationInfo.currentPage + 1)}
                            disabled={paginationInfo.currentPage === paginationInfo.totalPages - 1}
                            variant="outlined"
                          >
                            Next
                          </Button>
                        </Box>
                      </Box>
                    );
                  })()}
                </Box>
              </Collapse>
            </CardContent>
          </Card>

          {/* Monthly Payroll Summary Table */}
          <Paper sx={{ width: '100%', overflow: 'hidden' }}>
            {/* Filters + export toolbar */}
            <Box
              sx={{
                px: { xs: 2, sm: 2.5 },
                py: 2,
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.03)
              }}
            >
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                spacing={2}
                alignItems={{ xs: 'stretch', lg: 'flex-end' }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    fontWeight={700}
                    color="text.secondary"
                    sx={{ mb: 1.25, display: 'block', letterSpacing: '0.06em' }}
                  >
                    FILTERS
                  </Typography>
                  <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" alignItems="flex-end">
                    <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 150 }, flex: { sm: '1 1 150px', md: '1 1 0' }, maxWidth: { md: 200 } }}>
                      <InputLabel>Status</InputLabel>
                      <Select
                        value={monthlyFilters.status}
                        onChange={(e) => handleMonthlyFilterChange('status', e.target.value)}
                        label="Status"
                      >
                        <MenuItem value="">All Statuses</MenuItem>
                        <MenuItem value="draft">Draft</MenuItem>
                        <MenuItem value="approved">Approved</MenuItem>
                        <MenuItem value="paid">Paid</MenuItem>
                        <MenuItem value="cancelled">Cancelled</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 150 }, flex: { sm: '1 1 150px', md: '1 1 0' }, maxWidth: { md: 220 } }}>
                      <InputLabel>Department</InputLabel>
                      <Select
                        value={monthlyFilters.department}
                        onChange={(e) => handleMonthlyFilterChange('department', e.target.value)}
                        label="Department"
                      >
                        <MenuItem value="">All Departments</MenuItem>
                        {departmentOptions.map((dept) => (
                          <MenuItem key={dept._id} value={dept._id}>
                            {dept.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 150 }, flex: { sm: '1 1 150px', md: '1 1 0' }, maxWidth: { md: 220 } }}>
                      <InputLabel>Project</InputLabel>
                      <Select
                        value={monthlyFilters.project}
                        onChange={(e) => handleMonthlyFilterChange('project', e.target.value)}
                        label="Project"
                      >
                        <MenuItem value="">All Projects</MenuItem>
                        {projectOptions
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((project) => (
                            <MenuItem key={project._id} value={project._id}>
                              {project.name}
                            </MenuItem>
                          ))}
                      </Select>
                    </FormControl>
                    <Button
                      variant="outlined"
                      color="inherit"
                      size="small"
                      startIcon={<ClearIcon />}
                      onClick={clearMonthlyFilters}
                      disabled={!hasMonthlyFilters}
                      sx={{ height: 40, flexShrink: 0, px: 2 }}
                    >
                      Clear
                    </Button>
                  </Stack>
                </Box>

                <Divider orientation="horizontal" sx={{ display: { xs: 'block', lg: 'none' } }} />
                <Divider
                  orientation="vertical"
                  flexItem
                  sx={{ display: { xs: 'none', lg: 'block' }, alignSelf: 'stretch' }}
                />

                <Box sx={{ flex: { lg: '0 0 auto' }, width: { lg: 'auto' }, minWidth: { lg: 480 } }}>
                  <Typography
                    variant="caption"
                    fontWeight={700}
                    color="text.secondary"
                    sx={{ mb: 1.25, display: 'block', letterSpacing: '0.06em' }}
                  >
                    EXPORT
                  </Typography>
                  <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" alignItems="flex-end">
                    <FormControl size="small" sx={{ minWidth: 120, width: { xs: 'calc(50% - 6px)', sm: 130 } }}>
                      <InputLabel>Month</InputLabel>
                      <Select
                        value={exportMonth}
                        onChange={(e) => setExportMonth(e.target.value)}
                        label="Month"
                      >
                        {months.map((m) => (
                          <MenuItem key={m.value} value={String(parseInt(m.value, 10))}>
                            {m.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 96, width: { xs: 'calc(50% - 6px)', sm: 100 } }}>
                      <InputLabel>Year</InputLabel>
                      <Select
                        value={exportYear}
                        onChange={(e) => setExportYear(Number(e.target.value))}
                        label="Year"
                      >
                        {exportYearOptions.map((y) => (
                          <MenuItem key={y} value={y}>
                            {y}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{
                        height: 40,
                        flex: { xs: '1 1 100%', sm: '0 0 auto' },
                        alignItems: 'stretch',
                        '& .MuiButton-root': { height: 40, whiteSpace: 'nowrap' }
                      }}
                    >
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={
                          exportLoadingKey === `${exportMonth}-${exportYear}` ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <DownloadIcon />
                          )
                        }
                        disabled={!!exportLoadingKey}
                        onClick={() => {
                          const label = months.find((m) => String(parseInt(m.value, 10)) === String(exportMonth))?.label;
                          exportMonthPayrollCsv(exportMonth, exportYear, `${label || exportMonth}-${exportYear}`);
                        }}
                      >
                        Export month (CSV)
                      </Button>
                      <Button
                        variant="contained"
                        color="secondary"
                        size="small"
                        startIcon={
                          exportLoadingKey === `pdf-${exportMonth}-${exportYear}` ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <PictureAsPdfIcon />
                          )
                        }
                        disabled={!!exportLoadingKey}
                        onClick={() => {
                          const label = months.find((m) => String(parseInt(m.value, 10)) === String(exportMonth))?.label;
                          exportMonthPayrollPdf(exportMonth, exportYear, `${label || exportMonth}-${exportYear}`);
                        }}
                      >
                        Export month (PDF)
                      </Button>
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        startIcon={
                          exportLoadingKey === `eobi-${exportMonth}-${exportYear}` ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <EobiIcon />
                          )
                        }
                        disabled={!!exportLoadingKey}
                        onClick={() => {
                          const label = months.find((m) => String(parseInt(m.value, 10)) === String(exportMonth))?.label;
                          exportEobiContributionReport(exportMonth, exportYear, `${label || exportMonth} ${exportYear}`);
                        }}
                      >
                        EOBI Contribution
                      </Button>

                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<DownloadIcon />}
                        onClick={handleExportMonthlySummary}
                        disabled={!!exportLoadingKey || !monthlyPayrolls.length}
                      >
                        Export all periods
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              </Stack>
            </Box>

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
                  📊 Monthly Payroll Summary
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Showing {page * rowsPerPage + 1}-{Math.min((page + 1) * rowsPerPage, totalItems)} of {totalItems} months
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

            <TableContainer>
              <Table stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Pay Period</TableCell>
                    <TableCell>Employees</TableCell>
                    <TableCell>Total Basic Salary</TableCell>
                    <TableCell>Total Gross Pay</TableCell>
                    <TableCell>Total Net Pay</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginationLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                        <Box sx={{ textAlign: 'center' }}>
                          <CircularProgress size={24} sx={{ mb: 2 }} />
                          <Typography variant="body2" color="textSecondary">
                            Loading page {page + 1}...
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ) : paginatedMonthlyPayrolls.length > 0 ? (
                    paginatedMonthlyPayrolls.map((monthly) => {
                      const monthKey = `${monthly.month}-${monthly.year}`;
                      const isExpanded = expandedMonths.has(monthKey);
                      const draftCount = countDraftPayrolls(monthly.payrolls);
                      const approvalDoc = monthlyApprovals[monthKey];
                      const approvalLoading = monthlyApprovalLoadingKeys.has(monthKey);
                      const canApproveDrafts = canApproveDraftsForMonth(monthly.month, monthly.year);
                      // eslint-disable-next-line no-unused-vars
                      const bulkApproveTooltip = (draftCount > 0 && !canApproveDrafts)
                        ? 'Configure approval authorities and complete all sign-offs first'
                        : `Approve all ${draftCount} draft payroll(s)`;

                      return (
                        <React.Fragment key={monthKey}>
                          <TableRow hover>
                            <TableCell>
                              <Box>
                                <Typography variant="subtitle2">
                                  {monthly.monthName} {monthly.year}
                                </Typography>
                                <Typography variant="caption" color="textSecondary">
                                  Payroll Period
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {monthly.totalEmployees} Employees
                              </Typography>
                            </TableCell>
                            <TableCell>{formatCurrency(monthly.totalBasicSalary)}</TableCell>
                            <TableCell>{formatCurrency(monthly.totalGrossSalary)}</TableCell>
                            <TableCell>{formatCurrency(monthly.totalNetSalary)}</TableCell>
                            <TableCell>
                              <Chip
                                label={getMonthStatusLabel(monthly.statuses)}
                                color={getMonthStatusColor(monthly.statuses)}
                                size="small"
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                                <Tooltip title="Export this month's payroll (CSV)">
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="primary"
                                      disabled={exportLoadingKey === monthKey}
                                      onClick={() => exportMonthPayrollCsv(monthly.month, monthly.year, `${monthly.monthName}-${monthly.year}`)}
                                    >
                                      {exportLoadingKey === monthKey ? (
                                        <CircularProgress size={18} />
                                      ) : (
                                        <DownloadIcon fontSize="small" />
                                      )}
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title="Monthly comparison report (vs last month)">
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="secondary"
                                      disabled={comparisonLoadingKey === monthKey || !monthly.totalEmployees}
                                      onClick={() => openMonthlyComparisonReport(
                                        monthly.month,
                                        monthly.year,
                                        `${monthly.monthName} ${monthly.year}`,
                                        draftCount
                                      )}
                                    >
                                      {comparisonLoadingKey === monthKey ? (
                                        <CircularProgress size={18} />
                                      ) : (
                                        <CompareArrowsIcon fontSize="small" />
                                      )}
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title="EOBI Contribution report (PDF)">
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="success"
                                      disabled={exportLoadingKey === `eobi-${monthKey}` || !monthly.totalEmployees}
                                      onClick={() => exportEobiContributionReport(
                                        monthly.month,
                                        monthly.year,
                                        `${monthly.monthName} ${monthly.year}`
                                      )}
                                    >
                                      {exportLoadingKey === `eobi-${monthKey}` ? (
                                        <CircularProgress size={18} />
                                      ) : (
                                        <EobiIcon fontSize="small" />
                                      )}
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title={isExpanded ? "Hide Details" : "View Details"}>
                                  <IconButton
                                    size="small"
                                    onClick={() => toggleMonthExpansion(monthKey)}
                                  >
                                    {isExpanded ? <ExpandMoreIcon /> : <ViewIcon />}
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Delete Monthly Summary">
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => handleDeleteMonthlySummary(monthly.month, monthly.year, monthly.monthName)}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            </TableCell>
                          </TableRow>

                          {/* Expanded Employee Details */}
                          <TableRow>
                            <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
                              <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                <Box sx={{ margin: 1 }}>
                                  <MonthlyPayrollApprovalSection
                                    month={monthly.month}
                                    year={monthly.year}
                                    periodLabel={`${monthly.monthName} ${monthly.year}`}
                                    draftCount={draftCount}
                                    approvalDoc={approvalDoc}
                                    loading={approvalLoading}
                                    onRefresh={async () => {
                                      await fetchMonthlyApproval(monthly.month, monthly.year);
                                      await fetchMonthlyPayrolls();
                                    }}
                                    onUpdated={(doc) => {
                                      if (doc) {
                                        setMonthlyApprovals((prev) => ({ ...prev, [monthKey]: doc }));
                                      }
                                    }}
                                  />
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                                    <Typography variant="h6" component="div">
                                      Employee Details - {monthly.monthName} {monthly.year}
                                      <Chip
                                        label="↑ Sorted by Employee ID"
                                        size="small"
                                        color="primary"
                                        variant="outlined"
                                        sx={{ ml: 2, fontSize: '0.75rem', height: 24 }}
                                      />
                                    </Typography>
                                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        color="info"
                                        label="Payrolls update when each authority approves"
                                      />
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={exportLoadingKey === monthKey ? <CircularProgress size={14} /> : <DownloadIcon />}
                                        disabled={exportLoadingKey === monthKey}
                                        onClick={() => exportMonthPayrollCsv(monthly.month, monthly.year, `${monthly.monthName}-${monthly.year}`)}
                                      >
                                        Export {monthly.monthName} {monthly.year}
                                      </Button>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        color="success"
                                        startIcon={
                                          exportLoadingKey === `eobi-${monthKey}`
                                            ? <CircularProgress size={14} />
                                            : <EobiIcon fontSize="small" />
                                        }
                                        disabled={!!exportLoadingKey || !monthly.totalEmployees}
                                        onClick={() => exportEobiContributionReport(
                                          monthly.month,
                                          monthly.year,
                                          `${monthly.monthName} ${monthly.year}`
                                        )}
                                      >
                                        EOBI Contribution
                                      </Button>
                                    </Stack>
                                  </Box>

                                  {/* Employee Details Pagination Info */}
                                  {(() => {
                                    const paginationInfo = getPaginatedEmployeeDetails(monthly);
                                    const searchValue = employeeDetailsSearch[monthKey] || '';
                                    return (
                                      <Box sx={{
                                        mb: 2,
                                        p: 2,
                                        bgcolor: 'grey.50',
                                        borderRadius: 2,
                                        border: '1px solid',
                                        borderColor: 'grey.200'
                                      }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
                                          <Box>
                                            <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
                                              👥 Employee List
                                            </Typography>
                                            <Typography variant="body2" color="textSecondary">
                                              {paginationInfo.totalEmployees === 0
                                                ? 'No employees match this search'
                                                : `Showing ${paginationInfo.currentPage * paginationInfo.currentRowsPerPage + 1}-${Math.min((paginationInfo.currentPage + 1) * paginationInfo.currentRowsPerPage, paginationInfo.totalEmployees)} of ${paginationInfo.totalEmployees} employees`}
                                              {paginationInfo.searchQuery
                                                ? ` (filtered from ${paginationInfo.totalInMonth})`
                                                : ''}
                                            </Typography>
                                            <Typography variant="caption" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                              📊 Sorted by Employee ID (1, 2, 3...) · Search covers all pages
                                            </Typography>
                                          </Box>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="body2" color="textSecondary">
                                              Page {paginationInfo.totalEmployees ? paginationInfo.currentPage + 1 : 0} of {paginationInfo.totalPages || 0}
                                            </Typography>
                                            {paginationInfo.totalPages > 1 && (
                                              <Chip
                                                label={`${paginationInfo.totalPages} pages`}
                                                size="small"
                                                color="primary"
                                                variant="outlined"
                                              />
                                            )}
                                          </Box>
                                        </Box>
                                        <TextField
                                          size="small"
                                          placeholder="Search by name or ID…"
                                          value={searchValue}
                                          onChange={(e) => handleEmployeeDetailsSearchChange(monthKey, e.target.value)}
                                          InputProps={{
                                            startAdornment: (
                                              <InputAdornment position="start">
                                                <SearchIcon fontSize="small" color="action" />
                                              </InputAdornment>
                                            )
                                          }}
                                          sx={{ width: { xs: '100%', sm: 280 }, maxWidth: '100%' }}
                                        />
                                      </Box>
                                    );
                                  })()}

                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Employee</TableCell>
                                        <TableCell>Basic Salary</TableCell>
                                        <TableCell>Gross Pay</TableCell>
                                        <TableCell>Net Pay</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell align="center">Actions</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {(() => {
                                        const paginationInfo = getPaginatedEmployeeDetails(monthly);
                                        if (paginationInfo.paginatedEmployees.length === 0) {
                                          return (
                                            <TableRow>
                                              <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                                                <Box sx={{ textAlign: 'center' }}>
                                                  <Typography variant="body2" color="textSecondary">
                                                    {paginationInfo.searchQuery
                                                      ? 'No employees match this search in this month'
                                                      : 'No employees found for this month'}
                                                  </Typography>
                                                </Box>
                                              </TableCell>
                                            </TableRow>
                                          );
                                        }

                                        return paginationInfo.paginatedEmployees.map((payroll) => (
                                          <TableRow key={payroll._id}>
                                            <TableCell>
                                              <Box>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                                  <Typography variant="subtitle2">
                                                    {payroll.employee?.firstName} {payroll.employee?.lastName}
                                                  </Typography>
                                                  <PayrollProrationBadge payroll={payroll} />
                                                  {payroll.isCashSalary && (
                                                    <Chip label="Cash" size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                                                  )}
                                                  {payroll.isManual && (
                                                    <Chip label="Manual" size="small" color="secondary" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                                                  )}
                                                </Box>
                                                <Typography variant="caption" color="textSecondary">
                                                  {formatEmployeeId(payroll.employee?.employeeId)}
                                                </Typography>
                                              </Box>
                                            </TableCell>
                                            <TableCell>{formatCurrency(payroll.basicSalary)}</TableCell>
                                            <TableCell>{formatCurrency(payroll.grossSalary)}</TableCell>
                                            <TableCell>{formatCurrency(payroll.netSalary)}</TableCell>
                                            <TableCell>
                                              <Chip
                                                label={getStatusLabel(payroll.status)}
                                                color={getStatusColor(payroll.status)}
                                                size="small"
                                              />
                                            </TableCell>
                                            <TableCell align="center">
                                              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                                                <Tooltip title="View Details">
                                                  <IconButton
                                                    size="small"
                                                    onClick={() => navigate(`/hr/payroll/view/${payroll._id}`)}
                                                  >
                                                    <ViewIcon />
                                                  </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Edit Payroll">
                                                  <IconButton
                                                    size="small"
                                                    onClick={() => navigate(`/hr/payroll/${payroll._id}/edit`)}
                                                  >
                                                    <EditIcon />
                                                  </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Delete Payroll">
                                                  <IconButton
                                                    size="small"
                                                    color="error"
                                                    onClick={() => handleDelete(payroll._id)}
                                                  >
                                                    <DeleteIcon />
                                                  </IconButton>
                                                </Tooltip>
                                              </Box>
                                            </TableCell>
                                          </TableRow>
                                        ));
                                      })()}
                                    </TableBody>
                                  </Table>

                                  {/* Employee Details Pagination Controls */}
                                  {(() => {
                                    const paginationInfo = getPaginatedEmployeeDetails(monthly);
                                    if (paginationInfo.totalPages <= 1) return null;

                                    return (
                                      <Box sx={{
                                        mt: 2,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 2
                                      }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                          <Typography variant="body2" color="textSecondary">
                                            Employees per page:
                                          </Typography>
                                          <FormControl size="small" sx={{ minWidth: 80 }}>
                                            <Select
                                              value={paginationInfo.currentRowsPerPage}
                                              onChange={(e) => handleEmployeeDetailsRowsPerPageChange(`${monthly.month}-${monthly.year}`, e.target.value)}
                                              sx={{ height: 32 }}
                                            >
                                              <MenuItem value={5}>5</MenuItem>
                                              <MenuItem value={10}>10</MenuItem>
                                              <MenuItem value={25}>25</MenuItem>
                                              <MenuItem value={50}>50</MenuItem>
                                            </Select>
                                          </FormControl>
                                        </Box>

                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <Button
                                            size="small"
                                            onClick={() => handleEmployeeDetailsPageChange(`${monthly.month}-${monthly.year}`, paginationInfo.currentPage - 1)}
                                            disabled={paginationInfo.currentPage === 0}
                                            variant="outlined"
                                          >
                                            Previous
                                          </Button>

                                          <Typography variant="body2" sx={{ px: 2 }}>
                                            {paginationInfo.currentPage + 1} of {paginationInfo.totalPages}
                                          </Typography>

                                          <Button
                                            size="small"
                                            onClick={() => handleEmployeeDetailsPageChange(`${monthly.month}-${monthly.year}`, paginationInfo.currentPage + 1)}
                                            disabled={paginationInfo.currentPage === paginationInfo.totalPages - 1}
                                            variant="outlined"
                                          >
                                            Next
                                          </Button>
                                        </Box>
                                      </Box>
                                    );
                                  })()}
                                </Box>
                              </Collapse>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="h6" color="textSecondary" gutterBottom>
                            {(loading || dataLoading.employees || dataLoading.departments || dataLoading.positions) ? 'Loading payrolls...' : 'No payrolls found'}
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            {(loading || dataLoading.employees || dataLoading.departments || dataLoading.positions)
                              ? 'Please wait while we fetch your payroll data...'
                              : hasMonthlyFilters
                                ? 'Try adjusting your monthly payroll filters'
                                : 'Use Bulk Create Payroll to generate payrolls for a month'
                            }
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              rowsPerPageOptions={[5, 10, 25, 50]}
              component="div"
              count={totalItems}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={handleChangePage}
              onRowsPerPageChange={handleChangeRowsPerPage}
              labelRowsPerPage="Months per page:"
              labelDisplayedRows={({ from, to, count }) =>
                `${from}-${to} of ${count !== -1 ? count : `more than ${to}`} months`
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

          {/* Bulk Create Payroll Dialog */}
          <Dialog open={bulkCreateDialogOpen} onClose={() => setBulkCreateDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Bulk Create Payroll for All Employees</DialogTitle>
            <DialogContent>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Month</InputLabel>
                    <Select
                      value={bulkCreateForm.month}
                      onChange={(e) => setBulkCreateForm(prev => ({ ...prev, month: e.target.value }))}
                      label="Month"
                    >
                      {months.map((month) => (
                        <MenuItem key={month.value} value={month.value}>
                          {month.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Year"
                    value={bulkCreateForm.year}
                    onChange={(e) => setBulkCreateForm(prev => ({ ...prev, year: parseInt(e.target.value) }))}
                    inputProps={{ min: 2020, max: 2030 }}
                  />
                </Grid>

                {/* Employee Count Information */}
                <Grid item xs={12}>
                  <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.300' }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Employee Information
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Employees for payroll: <strong>{bulkPayrollEligibleCount}</strong>
                      {currentOverviewLoading ? ' (loading…)' : ''}
                    </Typography>
                    <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 0.5 }}>
                      Active employees with salary configured (same as General Payroll overview)
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                      Selected Period: <strong>{months.find(m => m.value === bulkCreateForm.month)?.label} {bulkCreateForm.year}</strong>
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12}>
                  <Alert severity="info">
                    This will create payroll records for <strong>ALL {bulkPayrollEligibleCount} payroll-eligible employees</strong> for {months.find(m => m.value === bulkCreateForm.month)?.label} {bulkCreateForm.year}.
                    Each employee will have a draft payroll with their basic salary and default values.
                  </Alert>
                </Grid>

                {/* Warning about existing payrolls */}
                {(() => {
                  const existingCount = payrolls.filter(
                    p => p.month === parseInt(bulkCreateForm.month) && p.year === bulkCreateForm.year
                  ).length;
                  if (existingCount > 0) {
                    const remainingCount = bulkPayrollEligibleCount - existingCount;

                    return (
                      <Grid item xs={12}>
                        <Alert severity="warning">
                          <strong>Existing Payrolls Found:</strong> {existingCount} payroll records already exist for {months.find(m => m.value === bulkCreateForm.month)?.label} {bulkCreateForm.year}.
                          {remainingCount > 0 ? ` Only ${remainingCount} employees still need payrolls created.` : ' All active employees already have payrolls for this month.'}
                        </Alert>
                      </Grid>
                    );
                  }
                  return null;
                })()}
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setBulkCreateDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleBulkCreate}
                variant="contained"
                disabled={bulkCreateLoading}
                startIcon={bulkCreateLoading ? <CircularProgress size={20} /> : <GroupWorkIcon />}
              >
                {bulkCreateLoading ? `Creating... (${bulkPayrollEligibleCount} employees)` : `Create All Payrolls (${bulkPayrollEligibleCount} employees)`}
              </Button>
            </DialogActions>
          </Dialog>

          <PayrollMonthlyComparisonDialog
            open={comparisonDialogOpen}
            onClose={() => {
              setComparisonDialogOpen(false);
              setComparisonReport(null);
              setComparisonGeneratedAt(null);
              setComparisonReportStatus('Draft');
              setComparisonContext(null);
            }}
            report={comparisonReport}
            generatedAt={comparisonGeneratedAt}
            reportStatus={comparisonReportStatus}
            loading={!!comparisonLoadingKey}
            month={comparisonContext?.month}
            year={comparisonContext?.year}
            periodLabel={comparisonContext?.periodLabel}
            draftCount={comparisonContext?.draftCount || 0}
            approvalDoc={
              comparisonContext
                ? monthlyApprovals[`${comparisonContext.month}-${comparisonContext.year}`]
                : null
            }
            approvalLoading={
              comparisonContext
                ? monthlyApprovalLoadingKeys.has(`${comparisonContext.month}-${comparisonContext.year}`)
                : false
            }
            onRefreshApproval={refreshComparisonDialogData}
            onApprovalUpdated={async (doc) => {
              if (!comparisonContext) return;
              const key = `${comparisonContext.month}-${comparisonContext.year}`;
              if (doc) {
                setMonthlyApprovals((prev) => ({ ...prev, [key]: doc }));
              }
              await refreshComparisonDialogData();
              await fetchMonthlyPayrolls();
            }}
          />

          <ImportFuelAllowanceDialog
            open={fuelDialogOpen}
            onClose={() => setFuelDialogOpen(false)}
            onImportSuccess={() => {
              fetchMonthlyPayrolls();
            }}
          />
          <ImportSalaryPercentageCutDialog
            open={salaryCutDialogOpen}
            onClose={() => setSalaryCutDialogOpen(false)}
            currentMonth={Number(exportMonth) || Number(bulkCreateForm.month) || (new Date().getMonth() + 1)}
            currentYear={Number(exportYear) || Number(bulkCreateForm.year) || new Date().getFullYear()}
            onImportSuccess={() => {
              fetchMonthlyPayrolls();
              fetchPayrolls();
            }}
          />
        </>
      )}
    </Box>
  );
};

export default Payroll; 