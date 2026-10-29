import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Avatar,
  Chip,
  Button,
  CircularProgress,
  Alert,
  Snackbar,
  Divider,
  Paper,
  Switch,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Work as WorkIcon,
  Person as PersonIcon,
  LocationOn as LocationIcon,
  Assignment as AssignmentIcon,
  Phone as EmergencyIcon,
  AttachMoney as SalaryIcon,
  Update as UpdateIcon,
  AccountBalance as LoanIcon,
  Add as AddIcon,
  EventNote as EventNoteIcon,
  Sync as SyncIcon,
  Description as DescriptionIcon,
  Print as PrintIcon,
  School as SchoolIcon,
  History as HistoryIcon
} from '@mui/icons-material';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { formatPKR } from '../../utils/currency';
import api from '../../services/api';
import { useData } from '../../contexts/DataContext';
import ArrearsDialog from '../../components/ArrearsDialog';
import { getImageUrl, handleImageError } from '../../utils/imageService';
import { getEmployeeStatusLabel, getEmployeeStatusColor, isEmployedEmployee } from '../../utils/employeeStatus';
import leaveService from '../../services/leaveService';
import TextField from '@mui/material/TextField';
import { fetchEmployeeKpiWorksheet } from '../../services/kpiWorksheetService';
import { openEmployeeDetailPrint } from '../../utils/employeeDetailPrint';
import { buildJoiningReportPrintHtml, openPrintHtml } from '../../utils/employeeFormPrint';
import AutoCalculatedSalaryBreakdown from '../../components/AutoCalculatedSalaryBreakdown';
import { vehicleAllowanceAmount, fuelAllowanceAmount } from '../../utils/allowanceHelpers';

const EmployeeView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { fetchEmployees } = useData();
  
  // Get the page number from location state (if coming from EmployeeList)
  const savedPage = location.state?.page || 0;
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [updatingPayrolls, setUpdatingPayrolls] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusDialog, setStatusDialog] = useState({ open: false, newStatus: null });
  const [loans, setLoans] = useState([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [arrearsDialog, setArrearsDialog] = useState({ open: false, editData: null });
  
  // Leave management states
  const [leaveSummary, setLeaveSummary] = useState(null);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveConfigDialog, setLeaveConfigDialog] = useState(false);
  const [leaveConfig, setLeaveConfig] = useState({
    annualLimit: 20,
    sickLimit: 10,
    casualLimit: 10,
    useGlobalDefaults: true
  });
  const [kpiSummary, setKpiSummary] = useState(null);
  const [kpiLoading, setKpiLoading] = useState(false);

  const fetchEmployee = async () => {
    if (!id) return;
    
    // Validate ID format before making request
    if (id && !/^[0-9a-fA-F]{24}$/.test(id)) {
      console.error('❌ Invalid employee ID format:', id);
      setSnackbar({
        open: true,
        message: `Invalid employee ID format: ${id}. Please check the URL.`,
        severity: 'error'
      });
      return;
    }
    
    try {
      setLoading(true);
      
      // Fetch employee data and arrears data in parallel
      const [employeeResponse, arrearsResponse, statsResponse] = await Promise.all([
        api.get(`/hr/employees/${id}`),
        api.get(`/hr/arrears/${id}`),
        api.get(`/hr/arrears/stats/${id}`)
      ]);
      
      const employeeData = employeeResponse.data.data;
      const arrearsData = arrearsResponse.data.data || [];
      const statsData = statsResponse.data.data || {};
      
      // Process arrears data for display
      employeeData.arrearsMonths = arrearsData.map(arrear => ({
        _id: arrear._id,
        monthName: arrear.monthName,
        year: arrear.year,
        month: arrear.month,
        amount: arrear.amount,
        status: arrear.status,
        description: arrear.description,
        type: arrear.type,
        createdDate: arrear.createdDate,
        updatedDate: arrear.updatedDate
      }));
      
      // Set arrears statistics
      employeeData.totalArrears = statsData.totalArrears || 0;
      employeeData.arrearsPaid = statsData.totalPaid || 0;
      employeeData.arrearsPending = statsData.totalPending || 0;
      employeeData.arrearsOverdue = statsData.overdueMonths || 0;
      employeeData.monthsWithArrears = statsData.monthsWithArrears || 0;
      
      // Calculate current month arrears (most recent month)
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const currentMonthArrear = arrearsData.find(a => 
        a.month === currentMonth && a.year === currentYear && a.status !== 'Paid'
      );
      employeeData.currentMonthArrears = currentMonthArrear ? currentMonthArrear.amount : 0;
      
      // Set overall arrears status
      if (statsData.totalOverdue > 0) {
        employeeData.arrearsStatus = 'Overdue';
      } else if (statsData.totalPending > 0) {
        employeeData.arrearsStatus = 'Pending';
      } else if (statsData.totalPaid > 0 && statsData.totalPending === 0) {
        employeeData.arrearsStatus = 'Paid';
      } else {
        employeeData.arrearsStatus = 'None';
      }
      
      setEmployee(employeeData);
    } catch (error) {
      console.error('Error fetching employee:', error);
      setSnackbar({
        open: true,
        message: 'Error fetching employee details',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployee();
    fetchLoans();
    fetchLeaveData();
    fetchKpiSummary();
  }, [id]);

  const fetchKpiSummary = async () => {
    if (!id) return;
    try {
      setKpiLoading(true);
      const now = new Date();
      const response = await fetchEmployeeKpiWorksheet(id, {
        year: now.getFullYear(),
        month: now.getMonth() + 1
      });
      setKpiSummary(response.data?.data || null);
    } catch (error) {
      setKpiSummary(null);
    } finally {
      setKpiLoading(false);
    }
  };

  const fetchLoans = async () => {
    if (!id) return;
    try {
      setLoansLoading(true);
      const response = await api.get(`/loans/employee/${id}`);
      setLoans(response.data);
    } catch (error) {
      console.error('Error fetching loans:', error);
    } finally {
      setLoansLoading(false);
    }
  };

  const fetchLeaveData = async () => {
    if (!id) return;
    setLeaveLoading(true);
    try {
      const response = await leaveService.getEmployeeLeaveSummary(id);
      setLeaveSummary(response.data);
      if (response.data.leaveConfig) {
        setLeaveConfig(response.data.leaveConfig);
      }
    } catch (error) {
      console.error('Error fetching leave data:', error);
    } finally {
      setLeaveLoading(false);
    }
  };

  const handleUpdateLeaveConfig = async () => {
    try {
      await leaveService.updateEmployeeLeaveConfig(id, leaveConfig);
      setSnackbar({ open: true, message: 'Leave configuration updated successfully', severity: 'success' });
      setLeaveConfigDialog(false);
      fetchLeaveData();
    } catch (error) {
      setSnackbar({ open: true, message: 'Failed to update leave configuration', severity: 'error' });
    }
  };

  const handleSyncLeaveBalance = async () => {
    try {
      setLeaveLoading(true);
      await leaveService.syncEmployeeLeaveBalance(id);
      setSnackbar({ open: true, message: 'Leave balance synced successfully', severity: 'success' });
      fetchLeaveData();
    } catch (error) {
      setSnackbar({ open: true, message: 'Failed to sync leave balance', severity: 'error' });
      setLeaveLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (employee) => getEmployeeStatusColor(employee);

  const getStatusText = (employee) => getEmployeeStatusLabel(employee);

  const getStatusLabelColor = (employee) => {
    const color = getStatusColor(employee);
    if (color === 'default') return 'text.secondary';
    return `${color}.main`;
  };

  const safeRenderText = (value) => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (value && typeof value === 'object') {
      // Handle populated objects
      if (value.name) return value.name;
      if (value.title) return value.title;
      if (value.code) return value.code;
      // Handle arrays or other object types
      if (Array.isArray(value)) return value.join(', ');
      // If it's an object but no recognizable properties, return a fallback
      return 'N/A';
    }
    return 'N/A';
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDateLong = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = date.getDate();
    const suffix = day === 1 || day === 21 || day === 31 ? 'st' : 
                   day === 2 || day === 22 ? 'nd' : 
                   day === 3 || day === 23 ? 'rd' : 'th';
    return `${day}${suffix} ${date.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}`;
  };

  const handlePrintEmployeeDetail = () => {
    if (!employee) return;

    const result = openEmployeeDetailPrint({
      employee,
      leaveSummary,
      kpiSummary,
      loans,
      profileImageUrl: employee.profileImage ? getImageUrl(employee.profileImage) : null
    });

    if (result?.ok === false) {
      setSnackbar({
        open: true,
        message: result.message,
        severity: 'warning'
      });
    }
  };

  const handlePrintJoiningReport = () => {
    if (!employee?.joiningReport) return;

    const result = openPrintHtml(buildJoiningReportPrintHtml(
      employee.joiningReport,
      `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
    ));

    if (result?.ok === false) {
      setSnackbar({
        open: true,
        message: result.message || 'Unable to print joining report.',
        severity: 'warning'
      });
    }
  };


  const handleToggleStatus = () => {
    const newStatus = !employee.isActive;
    setStatusDialog({ open: true, newStatus });
  };

  const handleConfirmStatusChange = async () => {
    try {
      setUpdatingStatus(true);
      const response = await api.put(`/hr/employees/${id}`, {
        isActive: statusDialog.newStatus
      });
      
      setEmployee(response.data.data);
      setSnackbar({
        open: true,
        message: `Employee ${statusDialog.newStatus ? 'activated' : 'deactivated'} successfully`,
        severity: 'success'
      });
      // Refresh the employee data immediately
      await fetchEmployees(true);
    } catch (error) {
      console.error('Error updating employee status:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Failed to update employee status',
        severity: 'error'
      });
    } finally {
      setUpdatingStatus(false);
      setStatusDialog({ open: false, newStatus: null });
    }
  };

  const handleCancelStatusChange = () => {
    setStatusDialog({ open: false, newStatus: null });
  };

  const handleMarkPaid = async (arrear) => {
    try {
      // Update the arrears status to 'Paid'
      await api.put(`/hr/arrears/${arrear._id}`, {
        status: 'Paid'
      });
      
      setSnackbar({
        open: true,
        message: 'Arrears marked as paid successfully',
        severity: 'success'
      });
      
      // Refresh employee data
      fetchEmployee();
    } catch (error) {
      console.error('Error marking arrears as paid:', error);
      setSnackbar({
        open: true,
        message: 'Failed to mark arrears as paid',
        severity: 'error'
      });
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading employee details...</Typography>
      </Box>
    );
  }

  if (!employee) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Alert severity="error">Employee not found</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/hr/employees', { state: { page: savedPage } })}
          >
            Back to List
          </Button>
          <Typography variant="h4">Employee Details</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={isEmployedEmployee(employee)}
                  onChange={handleToggleStatus}
                  disabled={updatingStatus || employee?.employmentStatus === 'Reinstated'}
                  color="primary"
                  size="medium"
                />
              }
              label={
                <Typography variant="body2" fontWeight="medium" color={getStatusLabelColor(employee)}>
                  {updatingStatus ? 'Updating...' : getStatusText(employee)}
                </Typography>
              }
              sx={{ margin: 0 }}
            />
          </Box>
          {/* <Button
            variant="outlined"
            startIcon={<UpdateIcon />}
            onClick={handleUpdatePayrolls}
            disabled={updatingPayrolls}
          >
            {updatingPayrolls ? 'Updating...' : 'Update Payrolls'}
          </Button> */}
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={handlePrintEmployeeDetail}
          >
            Print
          </Button>
          <Button
            variant="contained"
            startIcon={<EditIcon />}
            onClick={() => navigate(`/hr/employees/${id}/edit`, { state: { page: savedPage } })}
          >
            Edit Employee
          </Button>
        </Box>
      </Box>

      {/* Employee Header Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={3} alignItems="center">
            <Grid item>
              <Avatar 
                src={getImageUrl(employee.profileImage)}
                onError={(e) => handleImageError(e)}
                sx={{ width: 100, height: 100, fontSize: '2rem' }}
              >
                {employee.firstName?.charAt(0)}{employee.lastName?.charAt(0)}
              </Avatar>
            </Grid>
            <Grid item xs>
              <Typography variant="h5" gutterBottom>
                {employee.firstName} {employee.lastName}
              </Typography>
              <Typography variant="subtitle1" color="textSecondary" gutterBottom>
                Employee ID: {employee.employeeId}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip
                  label={getStatusText(employee)}
                  color={getStatusColor(employee)}
                  size="small"
                />
                <Typography variant="body2" color="textSecondary">
                  {safeRenderText(employee.placementDepartment?.name || employee.department?.name)} • {safeRenderText(employee.placementDesignation)}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Details Grid */}
      <Grid container spacing={3}>
        {/* Personal Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonIcon />
                Personal Information
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Email</Typography>
                  <Typography variant="body1">{employee.email}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Phone</Typography>
                  <Typography variant="body1">{employee.phone}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Date of Birth</Typography>
                  <Typography variant="body1">{formatDate(employee.dateOfBirth)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Gender</Typography>
                  <Typography variant="body1">{employee.gender}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">ID Card</Typography>
                  <Typography variant="body1">{employee.idCard}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Nationality</Typography>
                  <Typography variant="body1">{employee.nationality}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Religion</Typography>
                  <Typography variant="body1">{employee.religion}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Marital Status</Typography>
                  <Typography variant="body1">{employee.maritalStatus}</Typography>
                </Grid>
                {employee.maritalStatus === 'Married' && (
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">Spouse Name</Typography>
                    <Typography variant="body1">{employee.spouseName}</Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Joining Report Section */}
        {employee.joiningReport && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DescriptionIcon />
                    Joining Report
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<PrintIcon />}
                    onClick={handlePrintJoiningReport}
                  >
                    Print Report
                  </Button>
                </Box>
                <Divider sx={{ mb: 2 }} />
                
                {/* Document Information */}
                {(employee.joiningReport.documentNumber || employee.joiningReport.revisionNumber || employee.joiningReport.issueDate) && (
                  <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 0.5 }}>
                      Document Information
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      {employee.joiningReport.documentNumber && `Document No: ${employee.joiningReport.documentNumber}`}
                      {employee.joiningReport.documentNumber && employee.joiningReport.revisionNumber && ' | '}
                      {employee.joiningReport.revisionNumber && `Rev.#: ${employee.joiningReport.revisionNumber}`}
                      {employee.joiningReport.issueDate && (employee.joiningReport.documentNumber || employee.joiningReport.revisionNumber) && ' | '}
                      {employee.joiningReport.issueDate && `Issue Date: ${formatDate(employee.joiningReport.issueDate)}`}
                    </Typography>
                  </Box>
                )}
                
                <Grid container spacing={2}>
                  {employee.joiningReport.employeeName && (
                    <Grid item xs={12}>
                      <Typography variant="body2" color="textSecondary">Employee Name</Typography>
                      <Typography variant="body1">
                        {employee.joiningReport.employeeTitle} {employee.joiningReport.employeeName}
                      </Typography>
                    </Grid>
                  )}
                  
                  {employee.joiningReport.employmentPosition && (
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2" color="textSecondary">Employment Position</Typography>
                      <Typography variant="body1">{employee.joiningReport.employmentPosition}</Typography>
                    </Grid>
                  )}
                  
                  {(employee.joiningReport.parentSpouseRelation || employee.joiningReport.parentSpouseName) && (
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2" color="textSecondary">Parent/Spouse</Typography>
                      <Typography variant="body1">
                        {employee.joiningReport.parentSpouseRelation} {employee.joiningReport.parentSpouseName}
                      </Typography>
                    </Grid>
                  )}
                  
                  {employee.joiningReport.cnic && (
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2" color="textSecondary">CNIC #</Typography>
                      <Typography variant="body1">{employee.joiningReport.cnic}</Typography>
                    </Grid>
                  )}
                  
                  {employee.joiningReport.contactNumber && (
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2" color="textSecondary">Contact Number</Typography>
                      <Typography variant="body1">{employee.joiningReport.contactNumber}</Typography>
                    </Grid>
                  )}
                  
                  {employee.joiningReport.reportingLocation && (
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2" color="textSecondary">Reporting Location</Typography>
                      <Typography variant="body1">{employee.joiningReport.reportingLocation}</Typography>
                    </Grid>
                  )}
                  
                  {employee.joiningReport.reportingDateTime && (
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2" color="textSecondary">Reporting Date & Time</Typography>
                      <Typography variant="body1">{formatDate(employee.joiningReport.reportingDateTime)}</Typography>
                    </Grid>
                  )}
                  
                  {(employee.joiningReport.employeeSignature || employee.joiningReport.employeeSignatureDate) && (
                    <>
                      <Grid item xs={12}>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1 }}>
                          Employee Signature
                        </Typography>
                      </Grid>
                      {employee.joiningReport.employeeSignature && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="textSecondary">Signature</Typography>
                          <Typography variant="body1">{employee.joiningReport.employeeSignature}</Typography>
                        </Grid>
                      )}
                      {employee.joiningReport.employeeSignatureDate && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="textSecondary">Date</Typography>
                          <Typography variant="body1">{formatDate(employee.joiningReport.employeeSignatureDate)}</Typography>
                        </Grid>
                      )}
                    </>
                  )}
                  
                  {(employee.joiningReport.verificationDepartment || employee.joiningReport.hodName) && (
                    <>
                      <Grid item xs={12}>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1 }}>
                          Verification (Department)
                        </Typography>
                      </Grid>
                      {employee.joiningReport.verificationDepartment && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="textSecondary">Department</Typography>
                          <Typography variant="body1">{employee.joiningReport.verificationDepartment}</Typography>
                        </Grid>
                      )}
                      {employee.joiningReport.hodName && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="textSecondary">HOD Name</Typography>
                          <Typography variant="body1">{employee.joiningReport.hodName}</Typography>
                        </Grid>
                      )}
                    </>
                  )}
                  
                  {(employee.joiningReport.joiningRemarks || employee.joiningReport.hrSignature || employee.joiningReport.hrSignatureDate) && (
                    <>
                      <Grid item xs={12}>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1 }}>
                          HR Department (Official Use)
                        </Typography>
                      </Grid>
                      {employee.joiningReport.joiningRemarks && (
                        <Grid item xs={12}>
                          <Typography variant="body2" color="textSecondary">Joining Remarks</Typography>
                          <Typography variant="body1">{employee.joiningReport.joiningRemarks}</Typography>
                        </Grid>
                      )}
                      {employee.joiningReport.hrSignature && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="textSecondary">HR Signature</Typography>
                          <Typography variant="body1">{employee.joiningReport.hrSignature}</Typography>
                        </Grid>
                      )}
                      {employee.joiningReport.hrSignatureDate && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="textSecondary">HR Date</Typography>
                          <Typography variant="body1">{formatDate(employee.joiningReport.hrSignatureDate)}</Typography>
                        </Grid>
                      )}
                    </>
                  )}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Employment Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WorkIcon />
                Employment Information
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Department</Typography>
                  <Typography variant="body1">{safeRenderText(employee.placementDepartment?.name || employee.department?.name)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Designation</Typography>
                  <Typography variant="body1">{safeRenderText(employee.placementDesignation)}</Typography>
                </Grid>
                {employee.employeeCategory && (
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">Employee Category</Typography>
                    <Chip
                      label={employee.employeeCategory === 'blue_collar' ? 'Blue Collar' : 'White Collar'}
                      color={employee.employeeCategory === 'blue_collar' ? 'info' : 'success'}
                      size="small"
                      sx={{ mt: 0.5 }}
                    />
                  </Grid>
                )}
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Reporting Line</Typography>
                  <Typography variant="body1">
                    {employee.reportingLine
                      ? [
                          employee.reportingLine.firstName,
                          employee.reportingLine.lastName
                        ].filter(Boolean).join(' ') ||
                        employee.reportingLine.employeeId ||
                        '—'
                      : '—'}
                    {employee.reportingLine?.employeeId
                      ? ` (${employee.reportingLine.employeeId})`
                      : ''}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Qualification</Typography>
                  <Typography variant="body1">{employee.qualification}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Bank Name</Typography>
                  <Typography variant="body1">{safeRenderText(employee.bankName)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Bank Account Number</Typography>
                  <Typography variant="body1">{safeRenderText(employee.bankAccountNumber || employee.accountNumber)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Employment Status</Typography>
                  <Chip
                    label={getStatusText(employee)}
                    color={getStatusColor(employee)}
                    size="small"
                    sx={{ mt: 0.5 }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Hire Date</Typography>
                  <Typography variant="body1">{formatDate(employee.hireDate)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Appointment Date</Typography>
                  <Typography variant="body1">{formatDate(employee.appointmentDate)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Probation Period</Typography>
                  <Typography variant="body1">{employee.probationPeriodMonths} months</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">End of Probation</Typography>
                  <Typography variant="body1">{formatDate(employee.endOfProbationDate)}</Typography>
                </Grid>
                {employee.confirmationDate && (
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">Confirmation Date</Typography>
                    <Typography variant="body1">{formatDate(employee.confirmationDate)}</Typography>
                  </Grid>
                )}
                {employee.terminationDate && (
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">
                      {employee.employmentStatus === 'Active'
                        ? 'Leaving Date (last working day)'
                        : employee.employmentStatus === 'Reinstated' ? 'Previous Separation Date' : 'Termination/Separation Date'}
                    </Typography>
                    <Typography variant="body1">{formatDate(employee.terminationDate)}</Typography>
                  </Grid>
                )}
                {employee.foreignBankAccount && (
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary">Foreign Bank Account</Typography>
                    <Typography variant="body1">{employee.foreignBankAccount}</Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Placement Information */}
        {(employee.placementCompany || employee.placementProject || employee.placementSection || employee.placementLocation) && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AssignmentIcon />
                  Placement Information
                </Typography>
                <Grid container spacing={2}>
                  {employee.placementCompany && (
                    <Grid item xs={6}>
                      <Typography variant="body2" color="textSecondary">Company</Typography>
                      <Typography variant="body1">{safeRenderText(employee.placementCompany)}</Typography>
                    </Grid>
                  )}
                   {employee.placementCompany && (
                    <Grid item xs={6}>
                      <Typography variant="body2" color="textSecondary">Sector</Typography>
                      <Typography variant="body1">{safeRenderText(employee.placementSector)}</Typography>
                    </Grid>
                  )}
                  {employee.placementProject && (
                    <Grid item xs={6}>
                      <Typography variant="body2" color="textSecondary">Project</Typography>
                      <Typography variant="body1">{safeRenderText(employee.placementProject)}</Typography>
                    </Grid>
                  )}
                  {employee.placementProject && (
                    <Grid item xs={6}>
                      <Typography variant="body2" color="textSecondary">Department</Typography>
                      <Typography variant="body1">{safeRenderText(employee.placementDepartment)}</Typography>
                    </Grid>
                  )}
                  {employee.placementSection && (
                    <Grid item xs={6}>
                      <Typography variant="body2" color="textSecondary">Section</Typography>
                      <Typography variant="body1">{safeRenderText(employee.placementSection)}</Typography>
                    </Grid>
                  )}
                  {employee.placementSection && (
                    <Grid item xs={6}>
                      <Typography variant="body2" color="textSecondary">Designation/Position</Typography>
                      <Typography variant="body1">{safeRenderText(employee.placementDesignation)}</Typography>
                    </Grid>
                  )}
                  {employee.oldDesignation && (
                    <Grid item xs={6}>
                      <Typography variant="body2" color="textSecondary">Old Designation</Typography>
                      <Typography variant="body1">{safeRenderText(employee.oldDesignation)}</Typography>
                    </Grid>
                  )}
                  {employee.placementLocation && (
                    <Grid item xs={6}>
                      <Typography variant="body2" color="textSecondary">Location</Typography>
                      <Typography variant="body1">{safeRenderText(employee.placementLocation)}</Typography>
                    </Grid>
                  )}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Job Description Section */}
        {employee.jobDescription && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <WorkIcon />
                  Job Description (JD)
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', color: 'text.primary', lineHeight: 1.6 }}>
                  {employee.jobDescription}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AssignmentIcon />
                KPI section
              </Typography>
              <Divider sx={{ mb: 2 }} />
              {kpiLoading ? (
                <CircularProgress size={24} />
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="textSecondary">Current month</Typography>
                    <Typography variant="body1">{kpiSummary?.month ? `${kpiSummary.month}/${kpiSummary.year}` : 'Not available'}</Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="textSecondary">Total KPI score</Typography>
                    <Typography variant="body1">{kpiSummary?.totalKPIScore ?? '—'}</Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="textSecondary">Total weight</Typography>
                    <Typography variant="body1">{kpiSummary?.totalWeight ?? 0}%</Typography>
                  </Grid>
                </Grid>
              )}
              <Button
                variant="outlined"
                sx={{ mt: 2 }}
                onClick={() => navigate(`/hr/kpi/sheet?employeeId=${id}`)}
              >
                Open monthly KPI sheet
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Academic Background Section */}
        {employee.academicBackground && employee.academicBackground.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SchoolIcon />
                  Academic Background
                </Typography>
                <Grid container spacing={2}>
                  {employee.academicBackground.map((record, index) => (
                    <Grid item xs={12} key={index}>
                      <Paper sx={{ p: 2, backgroundColor: '#f8f9fa', mb: 2 }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                          Record #{index + 1}
                        </Typography>
                        <Grid container spacing={2}>
                          {record.degree && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Degree</Typography>
                              <Typography variant="body1">{record.degree}</Typography>
                            </Grid>
                          )}
                          {record.institution && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Institution</Typography>
                              <Typography variant="body1">{record.institution}</Typography>
                            </Grid>
                          )}
                          {record.fieldOfStudy && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Field of Study</Typography>
                              <Typography variant="body1">{record.fieldOfStudy}</Typography>
                            </Grid>
                          )}
                          {record.graduationYear && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Graduation Year</Typography>
                              <Typography variant="body1">{record.graduationYear}</Typography>
                            </Grid>
                          )}
                          {record.gpa && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">GPA</Typography>
                              <Typography variant="body1">{record.gpa}</Typography>
                            </Grid>
                          )}
                          {record.percentage && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Percentage</Typography>
                              <Typography variant="body1">{record.percentage}%</Typography>
                            </Grid>
                          )}
                          {record.grade && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Grade</Typography>
                              <Typography variant="body1">{record.grade}</Typography>
                            </Grid>
                          )}
                          {record.certificate && (
                            <Grid item xs={12}>
                              <Typography variant="body2" color="textSecondary">Certificate</Typography>
                              <Typography variant="body1">{record.certificate}</Typography>
                            </Grid>
                          )}
                        </Grid>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Professional Education Section */}
        {employee.professionalEducation && employee.professionalEducation.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SchoolIcon />
                  Professional Education
                </Typography>
                <Grid container spacing={2}>
                  {employee.professionalEducation.map((course, index) => (
                    <Grid item xs={12} key={index}>
                      <Paper sx={{ p: 2, backgroundColor: '#f8f9fa', mb: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                          <Typography variant="subtitle1" fontWeight="bold">
                            Course #{index + 1}
                          </Typography>
                          {course.isActive && (
                            <Chip label="Active" color="success" size="small" />
                          )}
                        </Box>
                        <Grid container spacing={2}>
                          {course.courseName && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Course Name</Typography>
                              <Typography variant="body1">{course.courseName}</Typography>
                            </Grid>
                          )}
                          {course.institution && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Institution</Typography>
                              <Typography variant="body1">{course.institution}</Typography>
                            </Grid>
                          )}
                          {course.certificationBody && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Certification Body</Typography>
                              <Typography variant="body1">{course.certificationBody}</Typography>
                            </Grid>
                          )}
                          {course.certificateNumber && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Certificate Number</Typography>
                              <Typography variant="body1">{course.certificateNumber}</Typography>
                            </Grid>
                          )}
                          {course.completionDate && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Completion Date</Typography>
                              <Typography variant="body1">{formatDate(course.completionDate)}</Typography>
                            </Grid>
                          )}
                          {course.expiryDate && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Expiry Date</Typography>
                              <Typography variant="body1">{formatDate(course.expiryDate)}</Typography>
                            </Grid>
                          )}
                          {course.certificate && (
                            <Grid item xs={12}>
                              <Typography variant="body2" color="textSecondary">Certificate</Typography>
                              <Typography variant="body1">{course.certificate}</Typography>
                            </Grid>
                          )}
                        </Grid>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Employment History Section */}
        {employee.employmentHistory && employee.employmentHistory.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HistoryIcon />
                  Employment History
                </Typography>
                <Grid container spacing={2}>
                  {employee.employmentHistory.map((record, index) => (
                    <Grid item xs={12} key={index}>
                      <Paper sx={{ p: 2, backgroundColor: '#f8f9fa', mb: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                          <Typography variant="subtitle1" fontWeight="bold">
                            Employment Record #{index + 1}
                          </Typography>
                          {record.isCurrentJob && (
                            <Chip label="Current Job" color="primary" size="small" />
                          )}
                        </Box>
                        <Grid container spacing={2}>
                          {record.companyName && (
                            <Grid item xs={12} md={6}>
                              <Typography variant="body2" color="textSecondary">Company Name</Typography>
                              <Typography variant="body1">{record.companyName}</Typography>
                            </Grid>
                          )}
                          {record.position && (
                            <Grid item xs={12} md={6}>
                              <Typography variant="body2" color="textSecondary">Position</Typography>
                              <Typography variant="body1">{record.position}</Typography>
                            </Grid>
                          )}
                          {record.startDate && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Start Date</Typography>
                              <Typography variant="body1">{formatDate(record.startDate)}</Typography>
                            </Grid>
                          )}
                          {record.endDate && !record.isCurrentJob && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">End Date</Typography>
                              <Typography variant="body1">{formatDate(record.endDate)}</Typography>
                            </Grid>
                          )}
                          {record.location && (
                            <Grid item xs={12} md={4}>
                              <Typography variant="body2" color="textSecondary">Location</Typography>
                              <Typography variant="body1">{record.location}</Typography>
                            </Grid>
                          )}
                          {record.salary && (
                            <Grid item xs={12} md={6}>
                              <Typography variant="body2" color="textSecondary">Salary</Typography>
                              <Typography variant="body1">{formatPKR(record.salary)}</Typography>
                            </Grid>
                          )}
                          {record.supervisorName && (
                            <Grid item xs={12} md={6}>
                              <Typography variant="body2" color="textSecondary">Supervisor Name</Typography>
                              <Typography variant="body1">{record.supervisorName}</Typography>
                            </Grid>
                          )}
                          {record.supervisorContact && (
                            <Grid item xs={12} md={6}>
                              <Typography variant="body2" color="textSecondary">Supervisor Contact</Typography>
                              <Typography variant="body1">{record.supervisorContact}</Typography>
                            </Grid>
                          )}
                          {record.responsibilities && (
                            <Grid item xs={12}>
                              <Typography variant="body2" color="textSecondary">Responsibilities & Achievements</Typography>
                              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{record.responsibilities}</Typography>
                            </Grid>
                          )}
                          {record.reasonForLeaving && !record.isCurrentJob && (
                            <Grid item xs={12}>
                              <Typography variant="body2" color="textSecondary">Reason for Leaving</Typography>
                              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{record.reasonForLeaving}</Typography>
                            </Grid>
                          )}
                        </Grid>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Address Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LocationIcon />
                Address Information
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="body2" color="textSecondary">Street Address</Typography>
                  <Typography variant="body1">{employee.address?.street}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">City</Typography>
                  <Typography variant="body1">{safeRenderText(employee.address?.city)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">State/Province</Typography>
                  <Typography variant="body1">{safeRenderText(employee.address?.state)}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Country</Typography>
                  <Typography variant="body1">{safeRenderText(employee.address?.country)}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Emergency Contact */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <EmergencyIcon />
                Emergency Contact
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Name</Typography>
                  <Typography variant="body1">{employee.emergencyContact?.name}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Relationship</Typography>
                  <Typography variant="body1">{employee.emergencyContact?.relationship}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Phone</Typography>
                  <Typography variant="body1">{employee.emergencyContact?.phone}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Salary Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SalaryIcon />
                Salary Information
              </Typography>
              <Typography variant="h6" color="primary" gutterBottom>
                Gross Salary: {formatPKR(employee.salary?.gross || 0)}
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Auto-Calculated Salary Breakdown
              </Typography>
              <AutoCalculatedSalaryBreakdown gross={employee.salary?.gross || 0} dense />
              {vehicleAllowanceAmount(employee.allowances) > 0 && (
                <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                  Vehicle Allowance: {formatPKR(vehicleAllowanceAmount(employee.allowances))}
                </Typography>
              )}
              {fuelAllowanceAmount(employee.allowances) > 0 && (
                <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                  Fuel Allowance: {formatPKR(fuelAllowanceAmount(employee.allowances))}
                </Typography>
              )}
              {employee.allowances?.food?.isActive && (
                <Typography variant="body2" color="success.main">
                  Food Allowance: {formatPKR(employee.allowances.food.amount || 0)}
                </Typography>
              )}
              {employee.allowances?.mobile?.isActive && (
                <Typography variant="body2" color="success.main">
                  Mobile Allowance: {formatPKR(employee.allowances.mobile.amount || 0)}
                </Typography>
              )}
              {employee.allowances?.conveyance?.isActive && (
                <Typography variant="body2" color="success.main">
                  Conveyance: {formatPKR(employee.allowances.conveyance.amount || 0)}
                </Typography>
              )}
              {employee.allowances?.medical?.isActive && (
                <Typography variant="body2" color="success.main">
                  Medical Allowance: {formatPKR(employee.allowances.medical.amount || 0)}
                </Typography>
              )}
              {employee.allowances?.houseRent?.isActive && (
                <Typography variant="body2" color="success.main">
                  House Allowance: {formatPKR(employee.allowances.houseRent.amount || 0)}
                </Typography>
              )}
              {employee.allowances?.special?.isActive && (
                <Typography variant="body2" color="success.main">
                  Special: {formatPKR(employee.allowances.special.amount || 0)}
                </Typography>
              )}
              {employee.allowances?.other?.isActive && (
                <Typography variant="body2" color="success.main">
                  Other: {formatPKR(employee.allowances.other.amount || 0)}
                </Typography>
              )}
              {employee.eobi?.isActive && (
                <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                  EOBI Deduction: {formatPKR(employee.eobi?.amount || 0)}
                </Typography>
              )}
              {employee.providentFund?.isActive && (
                <Typography variant="body2" color="error">
                  Provident Fund: {formatPKR(employee.providentFund?.amount || 0)}
                </Typography>
              )}
              {employee.employeeSecurity?.isActive && (
                <Typography variant="body2" color="error">
                  Employee Security: {formatPKR(employee.employeeSecurity?.amount || 0)}
                </Typography>
              )}
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                Monthly compensation (Gross Salary)
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Leave Balance Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <EventNoteIcon />
                  Leave Balance ({new Date().getFullYear()})
                </Typography>
                <Box>
                  <Button
                    size="small"
                    startIcon={<SyncIcon />}
                    onClick={handleSyncLeaveBalance}
                    disabled={leaveLoading}
                    sx={{ mr: 1 }}
                  >
                    Sync
                  </Button>
                  <Button
                    size="small"
                    startIcon={<EditIcon />}
                    onClick={() => setLeaveConfigDialog(true)}
                  >
                    Configure
                  </Button>
                </Box>
              </Box>
              
              {leaveLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress />
                </Box>
              ) : leaveSummary ? (
                <Grid container spacing={2}>
                  {/* Annual Leave */}
                  <Grid item xs={12}>
                    <Box sx={{ p: 2, bgcolor: 'primary.light', borderRadius: 1 }}>
                      <Typography variant="body2" sx={{ color: 'primary.contrastText', fontWeight: 'medium' }}>
                        Annual Leave
                      </Typography>
                      <Typography variant="h5" sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>
                        {leaveSummary.balance.annual.used} / {leaveSummary.balance.annual.allocated + leaveSummary.balance.annual.carriedForward}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="caption" sx={{ color: 'primary.contrastText' }}>
                          Used: {leaveSummary.balance.annual.used}
                        </Typography>
                        {leaveSummary.balance.annual.carriedForward > 0 && (
                          <Chip 
                            label={`CF: ${leaveSummary.balance.annual.carriedForward}`} 
                            size="small" 
                            sx={{ bgcolor: 'success.main', color: 'white', height: 20 }}
                          />
                        )}
                        {leaveSummary.balance.annual.advance > 0 && (
                          <Chip 
                            label={`Advance: ${leaveSummary.balance.annual.advance}`} 
                            size="small" 
                            color="error"
                            sx={{ height: 20 }}
                          />
                        )}
                      </Box>
                    </Box>
                  </Grid>
                  
                  {/* Sick Leave */}
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary" fontWeight="medium">
                      Sick Leave
                    </Typography>
                    <Typography variant="h6" fontWeight="bold">
                      {leaveSummary.balance.sick.used} / 10
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="caption" color="textSecondary">
                        Used: {leaveSummary.balance.sick.used}
                      </Typography>
                      {leaveSummary.balance.sick.advance > 0 && (
                        <Chip 
                          label={`Adv: ${leaveSummary.balance.sick.advance}`} 
                          size="small" 
                          color="error"
                          sx={{ height: 18, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                  </Grid>
                  
                  {/* Casual Leave */}
                  <Grid item xs={6}>
                    <Typography variant="body2" color="textSecondary" fontWeight="medium">
                      Casual Leave
                    </Typography>
                    <Typography variant="h6" fontWeight="bold">
                      {leaveSummary.balance.casual.used} / 10
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="caption" color="textSecondary">
                        Used: {leaveSummary.balance.casual.used}
                      </Typography>
                      {leaveSummary.balance.casual.advance > 0 && (
                        <Chip 
                          label={`Adv: ${leaveSummary.balance.casual.advance}`} 
                          size="small" 
                          color="error"
                          sx={{ height: 18, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                  </Grid>
                  
                  {/* Statistics */}
                  <Grid item xs={12}>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" color="textSecondary">
                      Total Requests: {leaveSummary.statistics.totalRequests} | 
                      Approved: {leaveSummary.statistics.approved} | 
                      Pending: {leaveSummary.statistics.pending}
                    </Typography>
                  </Grid>
                  
                  {/* Advance Leave Warning */}
                  {leaveSummary.balance.totalAdvanceLeaves > 0 && (
                    <Grid item xs={12}>
                      <Alert severity="warning" sx={{ py: 0.5 }}>
                        <Typography variant="caption">
                          Total Advance Leaves: {leaveSummary.balance.totalAdvanceLeaves} days - Will be deducted from payroll
                        </Typography>
                      </Alert>
                    </Grid>
                  )}
                </Grid>
              ) : (
                <Typography variant="body2" color="textSecondary">
                  No leave data available
                </Typography>
              )}
              
              <Button 
                fullWidth 
                variant="outlined" 
                size="small"
                sx={{ mt: 2 }}
                onClick={() => navigate(`/hr/leaves/employee/${id}`)}
              >
                View Leave History
              </Button>
            </CardContent>
          </Card>
        </Grid>

        {/* Arrears Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AssignmentIcon />
                Arrears Information
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="h6" color="warning.main" gutterBottom>
                    Total Outstanding: {formatPKR(employee.totalArrears || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    Current Month
                  </Typography>
                  <Typography variant="body1" color="warning.main" fontWeight="medium">
                    {formatPKR(employee.currentMonthArrears || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    Previous Months
                  </Typography>
                  <Typography variant="body1" color="textSecondary">
                    {formatPKR((employee.totalArrears || 0) - (employee.currentMonthArrears || 0))}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    Total Paid
                  </Typography>
                  <Typography variant="body1" color="success.main" fontWeight="medium">
                    {formatPKR(employee.arrearsPaid || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    Status
                  </Typography>
                  <Chip
                    label={employee.arrearsStatus || 'None'}
                    color={
                      employee.arrearsStatus === 'Paid' ? 'success' :
                      employee.arrearsStatus === 'Pending' ? 'warning' :
                      employee.arrearsStatus === 'Overdue' ? 'error' : 'default'
                    }
                    size="small"
                  />
                </Grid>
              </Grid>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                Outstanding payments and adjustments
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Detailed Arrears Management Section */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AssignmentIcon />
            Arrears Management
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
            Detailed month-wise arrears tracking and management
          </Typography>
          
          {/* Arrears Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'warning.light', color: 'warning.contrastText' }}>
                <Typography variant="h6">{formatPKR(employee.totalArrears || 0)}</Typography>
                <Typography variant="body2">Total Outstanding</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'info.light', color: 'info.contrastText' }}>
                <Typography variant="h6">{employee.monthsWithArrears || 0}</Typography>
                <Typography variant="body2">Months with Arrears</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'success.light', color: 'success.contrastText' }}>
                <Typography variant="h6">{formatPKR(employee.arrearsPaid || 0)}</Typography>
                <Typography variant="body2">Total Paid</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'error.light', color: 'error.contrastText' }}>
                <Typography variant="h6">{employee.arrearsOverdue || 0}</Typography>
                <Typography variant="body2">Overdue Months</Typography>
              </Paper>
            </Grid>
          </Grid>

          {/* Month-wise Arrears Table */}
          <Box sx={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5' }}>
                  <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Month/Year</th>
                  <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Type</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>Amount</th>
                  <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid #ddd' }}>Status</th>
                  <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Description</th>
                  <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Created Date</th>
                  <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employee.arrearsMonths && employee.arrearsMonths.length > 0 ? (
                  employee.arrearsMonths.map((arrear, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '12px' }}>
                        <Typography variant="body2" fontWeight="medium">
                          {arrear.monthName} {arrear.year}
                        </Typography>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Chip
                          label={arrear.type || 'Other'}
                          color="primary"
                          size="small"
                          variant="outlined"
                        />
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <Typography variant="body2" color="warning.main" fontWeight="medium">
                          {formatPKR(arrear.amount)}
                        </Typography>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <Chip
                          label={arrear.status}
                          color={
                            arrear.status === 'Paid' ? 'success' :
                            arrear.status === 'Pending' ? 'warning' :
                            arrear.status === 'Overdue' ? 'error' : 'default'
                          }
                          size="small"
                        />
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Typography variant="body2" color="textSecondary">
                          {arrear.description || 'Monthly arrears'}
                        </Typography>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Typography variant="body2" color="textSecondary">
                          {formatDate(arrear.createdDate)}
                        </Typography>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button 
                            size="small" 
                            variant="outlined" 
                            color="primary"
                            onClick={() => setArrearsDialog({ open: true, editData: arrear })}
                          >
                            Edit
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined" 
                            color="success"
                            onClick={() => handleMarkPaid(arrear)}
                          >
                            Mark Paid
                          </Button>
                        </Box>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" style={{ padding: '24px', textAlign: 'center' }}>
                      <Typography variant="body2" color="textSecondary">
                        No arrears records found
                      </Typography>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Box>

          {/* Add New Arrears Button */}
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AssignmentIcon />}
              onClick={() => setArrearsDialog({ open: true, editData: null })}
            >
              Add New Arrears
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Loan Management Section */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6" component="h2">
              <LoanIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
              Loan Management
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate(`/hr/loans/new?employeeId=${id}`)}
              size="small"
            >
              Add Loan
            </Button>
          </Box>
          <Divider sx={{ mb: 2 }} />
          
          {loansLoading ? (
            <Box display="flex" justifyContent="center" p={2}>
              <CircularProgress />
            </Box>
          ) : loans.length === 0 ? (
            <Typography color="textSecondary" textAlign="center" py={2}>
              No loans found for this employee
            </Typography>
          ) : (
            <Grid container spacing={2}>
              {loans.map((loan) => (
                <Grid item xs={12} md={6} key={loan._id}>
                  <Paper sx={{ p: 2, border: '1px solid #e0e0e0' }}>
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        {loan.loanType} Loan
                      </Typography>
                      <Chip
                        label={loan.status}
                        size="small"
                        color={
                          loan.status === 'Active' ? 'success' :
                          loan.status === 'Disbursed' ? 'primary' :
                          loan.status === 'Paid' ? 'info' : 'default'
                        }
                      />
                    </Box>
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                      Amount: {formatPKR(loan.loanAmount)} | Installment: {formatPKR(loan.monthlyInstallment)}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                      Outstanding: {formatPKR(loan.outstandingBalance)} | Term: {loan.loanTerm} months
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                      Purpose: {loan.purpose}
                    </Typography>
                    <Box display="flex" gap={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate(`/hr/loans/${loan._id}`)}
                      >
                        View Details
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate(`/hr/loans/${loan._id}/edit`)}
                      >
                        Edit
                      </Button>
                    </Box>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          )}
        </CardContent>
      </Card>

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

      {/* Status Change Confirmation Dialog */}
      <Dialog
        open={statusDialog.open}
        onClose={handleCancelStatusChange}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Confirm Status Change
        </DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to {statusDialog.newStatus ? 'activate' : 'deactivate'} {' '}
            <strong>{employee?.firstName} {employee?.lastName}</strong>?
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            {statusDialog.newStatus 
              ? 'This will make the employee active and they will be able to access the system.'
              : 'This will deactivate the employee and they will no longer be able to access the system.'
            }
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelStatusChange} disabled={updatingStatus}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmStatusChange} 
            variant="contained" 
            color={statusDialog.newStatus ? 'success' : 'error'}
            disabled={updatingStatus}
          >
            {updatingStatus ? 'Updating...' : (statusDialog.newStatus ? 'Activate' : 'Deactivate')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Arrears Dialog */}
      <ArrearsDialog
        open={arrearsDialog.open}
        onClose={() => setArrearsDialog({ open: false, editData: null })}
        employee={employee}
        editData={arrearsDialog.editData}
        onSuccess={(message) => {
          setSnackbar({
            open: true,
            message,
            severity: 'success'
          });
          // Refresh employee data
          fetchEmployee();
        }}
      />

      {/* Leave Configuration Dialog */}
      <Dialog open={leaveConfigDialog} onClose={() => setLeaveConfigDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Configure Leave Limits</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={leaveConfig.useGlobalDefaults}
                    onChange={(e) => setLeaveConfig({ ...leaveConfig, useGlobalDefaults: e.target.checked })}
                  />
                }
                label="Use Global Defaults (20, 10, 10)"
              />
            </Grid>
            
            {!leaveConfig.useGlobalDefaults && (
              <>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Annual Leave Limit"
                    type="number"
                    value={leaveConfig.annualLimit}
                    onChange={(e) => setLeaveConfig({ ...leaveConfig, annualLimit: parseInt(e.target.value) || 0 })}
                    inputProps={{ min: 0, max: 365 }}
                    helperText="Number of annual leave days per year"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Sick Leave Limit"
                    type="number"
                    value={leaveConfig.sickLimit}
                    onChange={(e) => setLeaveConfig({ ...leaveConfig, sickLimit: parseInt(e.target.value) || 0 })}
                    inputProps={{ min: 0, max: 365 }}
                    helperText="Number of sick leave days per year"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Casual Leave Limit"
                    type="number"
                    value={leaveConfig.casualLimit}
                    onChange={(e) => setLeaveConfig({ ...leaveConfig, casualLimit: parseInt(e.target.value) || 0 })}
                    inputProps={{ min: 0, max: 365 }}
                    helperText="Number of casual leave days per year"
                  />
                </Grid>
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaveConfigDialog(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleUpdateLeaveConfig}
          >
            Save Configuration
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EmployeeView; 