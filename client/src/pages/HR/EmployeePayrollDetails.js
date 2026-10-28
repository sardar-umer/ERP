import React, { useState, useEffect } from 'react';
import { vehicleAllowanceAmount, fuelAllowanceAmount } from '../../utils/allowanceHelpers';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  Tooltip,
  Avatar
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Visibility as ViewIcon,
  Edit as EditIcon,
  AccountBalance as AccountBalanceIcon,
  Download as DownloadIcon
} from '@mui/icons-material';
import api from '../../services/api';
import leaveService from '../../services/leaveService';
import PayrollProrationBadge from '../../components/HR/PayrollProrationBadge';
import PayslipReviewModal from '../../components/HR/PayslipReviewModal';
import {
  buildPayslipPreviewData,
  buildPayslipCreatePayload,
  formatPayslipEmployeeId,
  getEmployeeDepartmentLabel,
  getEmployeePositionLabel,
  previewToPayslipPdfPayload,
  downloadBlobFile,
  buildPayslipPdfFilename
} from '../../utils/payslipPreviewUtils';
import { downloadPayslipPreviewPDF } from '../../services/payslipService';

// Months array for month name lookup
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

const EmployeePayrollDetails = () => {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [employeeData, setEmployeeData] = useState(null);
  const [payslipModal, setPayslipModal] = useState({ open: false, data: null });
  const [payslipDownloadLoading, setPayslipDownloadLoading] = useState(false);
  const [employeeLoans, setEmployeeLoans] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [leaveLoading, setLeaveLoading] = useState(false);

  useEffect(() => {
    fetchEmployeePayrollDetails();
    fetchEmployeeLoans();
    fetchEmployeeLeaveBalance();
  }, [employeeId]); // eslint-disable-next-line react-hooks/exhaustive-deps

  const fetchEmployeeLeaveBalance = async () => {
    try {
      setLeaveLoading(true);
      const currentYear = new Date().getFullYear();
      const response = await leaveService.getEmployeeLeaveSummary(employeeId, null, currentYear);
      setLeaveBalance(response.data);
    } catch (error) {
      console.error('Error fetching leave balance:', error);
      // Don't set error state, just log it - leave data is optional
    } finally {
      setLeaveLoading(false);
    }
  };

  const fetchEmployeePayrollDetails = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/payroll/view/employee/${employeeId}`);
      setEmployeeData(response.data.data);
    } catch (error) {
      console.error('Error fetching employee payroll details:', error);
      setError('Failed to load employee payroll details');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployeeLoans = async () => {
    try {
      console.log('🔍 Fetching loans for employeeId:', employeeId);
      const response = await api.get(`/loans/employee/${employeeId}`);
      console.log('🔍 Loans response:', response.data);
      setEmployeeLoans(response.data || []);
    } catch (error) {
      console.error('Error fetching employee loans:', error);
      console.error('Error details:', error.response?.data);
    }
  };

  // Helper function to calculate total loan deductions from active loans
  const calculateLoanDeductions = () => {
    return employeeLoans
      .filter(loan => ['Active', 'Disbursed', 'Approved'].includes(loan.status))
      .reduce((total, loan) => total + (loan.monthlyInstallment || 0), 0);
  };

  // Helper function to calculate advance leave deduction (DISABLED FOR NOW - RETURNS 0)
  const calculateAdvanceLeaveDeduction = () => {
    return 0;
    /*
    if (!leaveBalance || !leaveBalance.balance) return 0;

    const totalAdvanceLeaves = leaveBalance.balance.totalAdvanceLeaves || 0;
    if (totalAdvanceLeaves === 0) return 0;

    const dailyRate = currentPayroll.dailyRate || (employee?.salary?.basic ? employee.salary.basic / 26 : 0);
    return totalAdvanceLeaves * dailyRate;
    */
  };

  // Helper function to calculate total deductions including loans and advance leaves
  const calculateTotalDeductions = () => {
    const loanDeductions = calculateLoanDeductions();
    const advanceLeaveDeduction = calculateAdvanceLeaveDeduction();

    return (currentPayroll.incomeTax || 0) +
      (currentPayroll.eobi || 0) +
      (currentPayroll.employeeSecurity || 0) +
      (currentPayroll.healthInsurance || 0) +
      loanDeductions +
      (currentPayroll.attendanceDeduction || 0) +
      (currentPayroll.leaveDeduction || 0) +
      advanceLeaveDeduction +
      (currentPayroll.otherDeductions || 0);
  };

  // Helper function to calculate net salary
  const calculateNetSalary = () => {
    return (currentPayroll.totalEarnings || 0) - calculateTotalDeductions();
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatPKR = (amount) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Approved':
        return 'success';
      case 'Pending':
        return 'warning';
      case 'Rejected':
        return 'error';
      case 'Paid':
        return 'success';
      default:
        return 'default';
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/hr/payroll')}
        >
          Back to Payroll
        </Button>
      </Box>
    );
  }

  if (!employeeData) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Employee payroll data not found
        </Alert>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/hr/payroll')}
        >
          Back to Payroll
        </Button>
      </Box>
    );
  }

  const { employee, currentPayroll, existingPayrolls } = employeeData;

  const openPayslipPreview = (payroll, totalsOverride = {}) => {
    if (!employee || !payroll) return;
    const preview = buildPayslipPreviewData({
      employee,
      payroll,
      loanDeductions: totalsOverride.loanDeductions ?? calculateLoanDeductions(),
      advanceLeaveDeduction: totalsOverride.advanceLeaveDeduction ?? calculateAdvanceLeaveDeduction(),
      totalDeductions: totalsOverride.totalDeductions,
      netSalary: totalsOverride.netSalary
    });
    setPayslipModal({ open: true, data: preview });
  };

  const handleDownloadPayslipPreview = async () => {
    if (!payslipModal.data) return;

    try {
      setPayslipDownloadLoading(true);
      const pdfPayload = previewToPayslipPdfPayload(payslipModal.data);
      const blob = await downloadPayslipPreviewPDF(pdfPayload);
      downloadBlobFile(blob, buildPayslipPdfFilename(payslipModal.data));
    } catch (error) {
      console.error('Error downloading payslip PDF:', error);
      alert(`Failed to download payslip PDF: ${error.response?.data?.message || error.message}`);
    } finally {
      setPayslipDownloadLoading(false);
    }
  };

  const generatePayslip = async (payroll) => {
    try {
      const payslipData = buildPayslipCreatePayload({ employee, payroll });
      const response = await api.post('/payslips', payslipData);

      if (response.data.success) {
        const pdfResponse = await api.get(`/payslips/${response.data.data._id}/download`, {
          responseType: 'blob'
        });

        const blob = new Blob([pdfResponse.data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `payslip-${employee.firstName}-${employee.lastName}-${payroll.month}-${payroll.year}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        alert('Payslip generated and downloaded successfully!');
      }
    } catch (error) {
      console.error('Error generating payslip:', error);
      alert(`Failed to generate payslip: ${error.response?.data?.message || error.message}`);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/hr/payroll')}
          sx={{ minWidth: 'auto' }}
        >
          Back
        </Button>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Employee Payroll Details
        </Typography>
        <PayrollProrationBadge payroll={currentPayroll} />
        <Button
          variant="contained"
          color="primary"
          startIcon={<ViewIcon />}
          onClick={() =>
            openPayslipPreview(currentPayroll, {
              totalDeductions: calculateTotalDeductions(),
              netSalary: calculateNetSalary()
            })
          }
          sx={{ ml: 'auto' }}
        >
          Review
        </Button>
      </Box>

      {/* Employee Information Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Employee Information
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Avatar sx={{ width: 56, height: 56, bgcolor: 'primary.main' }}>
              {employee.firstName?.charAt(0)}{employee.lastName?.charAt(0)}
            </Avatar>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                <Typography variant="h5">
                  {employee.firstName} {employee.lastName}
                </Typography>
                <PayrollProrationBadge payroll={currentPayroll} />
              </Box>
              <Typography variant="body1" color="textSecondary">
                ID: {formatPayslipEmployeeId(employee.employeeId)}
              </Typography>
            </Box>
          </Box>
          <Typography variant="body2" color="textSecondary">
            <strong>Department:</strong> {getEmployeeDepartmentLabel(employee)}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Position:</strong> {getEmployeePositionLabel(employee)}
          </Typography>
        </CardContent>
      </Card>

      {/* Database Payroll Data - Earnings */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Earnings (Database Values)
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Basic Salary</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.basicSalary || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>House Rent Allowance</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.houseRentAllowance || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Medical Allowance</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.medicalAllowance || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Conveyance Allowance</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.allowances?.conveyance?.amount || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Food Allowance</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.allowances?.food?.amount || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Mobile Allowance</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.allowances?.mobile?.amount || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Vehicle Allowance</TableCell>
                      <TableCell align="right">{formatPKR(vehicleAllowanceAmount(currentPayroll.allowances))}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Fuel Allowance</TableCell>
                      <TableCell align="right">{formatPKR(fuelAllowanceAmount(currentPayroll.allowances))}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Special Allowance</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.allowances?.special?.amount || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Other Allowance</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.allowances?.other?.amount || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Medical Allowance (from allowances)</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.allowances?.medical?.amount || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>House Rent Allowance (from allowances)</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.allowances?.houseRent?.amount || 0)}</TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell>Gross Salary</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.grossSalary || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Overtime Amount</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.overtimeAmount || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Performance Bonus</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.performanceBonus || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Other Bonus</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.otherBonus || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Arrears</TableCell>
                      <TableCell align="right" sx={{ color: 'warning.main', fontWeight: 600 }}>
                        {formatPKR(currentPayroll.arrears || 0)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Total Earnings</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.totalEarnings || 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Database Payroll Data - Deductions */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Deductions (Database Values)
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Income Tax</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.taxCalculation?.totalTax || currentPayroll.incomeTax || 0)}</TableCell>
                    </TableRow>
                    {(currentPayroll.taxCalculation?.arrearsTaxableIncome > 0 || currentPayroll.arrears > 0) && (
                      <TableRow>
                        <TableCell sx={{ pl: 4, color: 'text.secondary' }}>
                          Arrears in annual taxable (once, not × months)
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'text.secondary' }}>
                          {formatPKR(currentPayroll.taxCalculation?.arrearsTaxableIncome || currentPayroll.arrears || 0)}
                        </TableCell>
                      </TableRow>
                    )}
                    {currentPayroll.taxCalculation?.annualTaxableIncome > 0 && (
                      <TableRow>
                        <TableCell sx={{ pl: 4, color: 'text.secondary' }}>
                          Annual taxable ({currentPayroll.taxCalculation?.fyMonths || 12} FY mo.)
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'text.secondary' }}>
                          {formatPKR(currentPayroll.taxCalculation.annualTaxableIncome)}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell><strong>Total Income Tax</strong></TableCell>
                      <TableCell align="right"><strong>{formatPKR(currentPayroll.taxCalculation?.totalTax || currentPayroll.incomeTax || 0)}</strong></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>EOBI</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.eobi || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Health Insurance</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.healthInsurance || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Attendance Deduction</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.attendanceDeduction || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Leave Deduction Amount</TableCell>
                      <TableCell align="right">{formatPKR((currentPayroll.dailyRate || 0) * (currentPayroll.leaveDays || 0))}</TableCell>
                    </TableRow>

                    {/* Advance Leave Deduction */}
                    {leaveBalance && leaveBalance.balance && leaveBalance.balance.totalAdvanceLeaves > 0 && (
                      <>
                        <TableRow>
                          <TableCell sx={{ bgcolor: 'warning.light', py: 1 }} colSpan={2}>
                            <Typography variant="body2" fontWeight="bold" color="warning.dark">
                              Advance Leave Deduction
                            </Typography>
                          </TableCell>
                        </TableRow>

                        {leaveBalance.balance.annual.advance > 0 && (
                          <TableRow>
                            <TableCell sx={{ pl: 4 }}>
                              Annual Advance ({leaveBalance.balance.annual.advance} days × {formatPKR(currentPayroll.dailyRate || 0)})
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" color="error">
                                {formatPKR(leaveBalance.balance.annual.advance * (currentPayroll.dailyRate || 0))}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}

                        {leaveBalance.balance.sick.advance > 0 && (
                          <TableRow>
                            <TableCell sx={{ pl: 4 }}>
                              Sick Advance ({leaveBalance.balance.sick.advance} days × {formatPKR(currentPayroll.dailyRate || 0)})
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" color="error">
                                {formatPKR(leaveBalance.balance.sick.advance * (currentPayroll.dailyRate || 0))}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}

                        {leaveBalance.balance.casual.advance > 0 && (
                          <TableRow>
                            <TableCell sx={{ pl: 4 }}>
                              Casual Advance ({leaveBalance.balance.casual.advance} days × {formatPKR(currentPayroll.dailyRate || 0)})
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" color="error">
                                {formatPKR(leaveBalance.balance.casual.advance * (currentPayroll.dailyRate || 0))}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}

                        <TableRow>
                          <TableCell sx={{ pl: 4 }}>
                            <Typography variant="body2" fontWeight="bold">
                              Total Advance Leave Deduction ({leaveBalance.balance.totalAdvanceLeaves} days)
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontWeight="bold" color="error">
                              {formatPKR(calculateAdvanceLeaveDeduction())}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      </>
                    )}

                    <TableRow>
                      <TableCell>Provident Fund</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.providentFund || 0)}</TableCell>
                    </TableRow>
                    {currentPayroll.employeeSecurity > 0 && (
                      <TableRow>
                        <TableCell>Employee Security</TableCell>
                        <TableCell align="right">{formatPKR(currentPayroll.employeeSecurity || 0)}</TableCell>
                      </TableRow>
                    )}
                    {/* Individual Loan Deductions */}
                    {console.log('🔍 Employee loans for deductions:', employeeLoans)}
                    {employeeLoans
                      .filter(loan => ['Active', 'Disbursed', 'Approved'].includes(loan.status))
                      .map((loan, index) => (
                        <TableRow key={loan._id}>
                          <TableCell>{loan.loanType} Loan Deduction ({loan.status})</TableCell>
                          <TableCell align="right">{formatPKR(loan.monthlyInstallment || 0)}</TableCell>
                        </TableRow>
                      ))}
                    <TableRow>
                      <TableCell><strong>Total Loan Deductions</strong></TableCell>
                      <TableCell align="right"><strong>{formatPKR(calculateLoanDeductions())}</strong></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Other Deductions</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.otherDeductions || 0)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><strong>Total Deductions</strong></TableCell>
                      <TableCell align="right"><strong>{formatPKR(calculateTotalDeductions())}</strong></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Database Payroll Data - Attendance & Leave Details */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Attendance Details (Database Values)
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Total Working Days</TableCell>
                      <TableCell align="right">{currentPayroll.totalWorkingDays || 0}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Present Days</TableCell>
                      <TableCell align="right">{currentPayroll.presentDays || 0}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Absent Days</TableCell>
                      <TableCell align="right">{currentPayroll.absentDays || 0}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Leave Days</TableCell>
                      <TableCell align="right">{currentPayroll.leaveDays || 0}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Daily Rate</TableCell>
                      <TableCell align="right">{formatPKR(currentPayroll.dailyRate || 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {false && (
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Leave Deductions (Database Values)
              </Typography>

              {leaveLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={30} />
                </Box>
              ) : leaveBalance ? (
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      {/* Current Year Leave Balance */}
                      <TableRow>
                        <TableCell colSpan={2} sx={{ bgcolor: 'primary.light', py: 1 }}>
                          <Typography variant="body2" fontWeight="bold">
                            Current Year Balance ({new Date().getFullYear()})
                          </Typography>
                        </TableCell>
                      </TableRow>

                      <TableRow>
                        <TableCell>Annual Leave</TableCell>
                        <TableCell align="right">
                          {leaveBalance.balance.annual.remaining} / {leaveBalance.balance.annual.allocated + leaveBalance.balance.annual.carriedForward}
                          {leaveBalance.balance.annual.advance > 0 && (
                            <Chip
                              label={`Adv: ${leaveBalance.balance.annual.advance}`}
                              size="small"
                              color="error"
                              sx={{ ml: 1, height: 18 }}
                            />
                          )}
                        </TableCell>
                      </TableRow>

                      <TableRow>
                        <TableCell>Sick Leave</TableCell>
                        <TableCell align="right">
                          {leaveBalance.balance.sick.remaining} / {leaveBalance.balance.sick.allocated + leaveBalance.balance.sick.carriedForward}
                          {leaveBalance.balance.sick.advance > 0 && (
                            <Chip
                              label={`Adv: ${leaveBalance.balance.sick.advance}`}
                              size="small"
                              color="error"
                              sx={{ ml: 1, height: 18 }}
                            />
                          )}
                        </TableCell>
                      </TableRow>

                      <TableRow>
                        <TableCell>Casual Leave</TableCell>
                        <TableCell align="right">
                          {leaveBalance.balance.casual.remaining} / {leaveBalance.balance.casual.allocated + leaveBalance.balance.casual.carriedForward}
                          {leaveBalance.balance.casual.advance > 0 && (
                            <Chip
                              label={`Adv: ${leaveBalance.balance.casual.advance}`}
                              size="small"
                              color="error"
                              sx={{ ml: 1, height: 18 }}
                            />
                          )}
                        </TableCell>
                      </TableRow>

                      {/* Advance Leave Deduction Details */}
                      {leaveBalance.balance.totalAdvanceLeaves > 0 && (
                        <>
                          <TableRow>
                            <TableCell colSpan={2} sx={{ bgcolor: 'warning.light', py: 1 }}>
                              <Typography variant="body2" fontWeight="bold" color="warning.dark">
                                Advance Leave Deduction
                              </Typography>
                            </TableCell>
                          </TableRow>

                          <TableRow>
                            <TableCell sx={{ pl: 4 }}>Total Advance Leaves</TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" color="error" fontWeight="bold">
                                {leaveBalance.balance.totalAdvanceLeaves} days
                              </Typography>
                            </TableCell>
                          </TableRow>

                          {leaveBalance.balance.annual.advance > 0 && (
                            <TableRow>
                              <TableCell sx={{ pl: 4 }}>Annual Advance</TableCell>
                              <TableCell align="right">{leaveBalance.balance.annual.advance} days</TableCell>
                            </TableRow>
                          )}

                          {leaveBalance.balance.sick.advance > 0 && (
                            <TableRow>
                              <TableCell sx={{ pl: 4 }}>Sick Advance</TableCell>
                              <TableCell align="right">{leaveBalance.balance.sick.advance} days</TableCell>
                            </TableRow>
                          )}

                          {leaveBalance.balance.casual.advance > 0 && (
                            <TableRow>
                              <TableCell sx={{ pl: 4 }}>Casual Advance</TableCell>
                              <TableCell align="right">{leaveBalance.balance.casual.advance} days</TableCell>
                            </TableRow>
                          )}

                          <TableRow>
                            <TableCell colSpan={2} sx={{ py: 0.5 }}>
                              <Alert severity="warning" sx={{ py: 0.5 }}>
                                <Typography variant="caption">
                                  These advance leaves will be deducted from payroll at the daily rate
                                </Typography>
                              </Alert>
                            </TableCell>
                          </TableRow>
                        </>
                      )}

                      {/* Leave Statistics */}
                      <TableRow>
                        <TableCell colSpan={2} sx={{ bgcolor: 'info.light', py: 1 }}>
                          <Typography variant="body2" fontWeight="bold">
                            Leave Statistics
                          </Typography>
                        </TableCell>
                      </TableRow>

                      <TableRow>
                        <TableCell>Total Requests</TableCell>
                        <TableCell align="right">{leaveBalance.statistics.totalRequests}</TableCell>
                      </TableRow>

                      <TableRow>
                        <TableCell>Approved</TableCell>
                        <TableCell align="right">{leaveBalance.statistics.approved}</TableCell>
                      </TableRow>

                      <TableRow>
                        <TableCell>Pending</TableCell>
                        <TableCell align="right">{leaveBalance.statistics.pending}</TableCell>
                      </TableRow>

                      <TableRow>
                        <TableCell>Rejected</TableCell>
                        <TableCell align="right">{leaveBalance.statistics.rejected}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell colSpan={2}>
                          <Alert severity="info">
                            <Typography variant="body2">
                              No leave data available. Leave balance will be displayed once leave records are created.
                            </Typography>
                          </Alert>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
        )}
      </Grid>

      {/* Database Payroll Data - Summary */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Summary (Database Values)
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: 'primary.light', color: 'white' }}>
                <Typography variant="h4">{formatPKR(currentPayroll.totalEarnings || 0)}</Typography>
                <Typography variant="body2">Total Earnings</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: 'error.light', color: 'white' }}>
                <Typography variant="h4">{formatPKR(calculateTotalDeductions())}</Typography>
                <Typography variant="body2">Total Deductions</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: 'success.light', color: 'white' }}>
                <Typography variant="h4">{formatPKR(calculateNetSalary())}</Typography>
                <Typography variant="body2">Net Salary</Typography>
              </Paper>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Existing Payroll History */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" component="h3" sx={{ mb: 3, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
            <AccountBalanceIcon color="primary" />
            Payroll History (Last 12 Months)
          </Typography>

          {existingPayrolls.length > 0 ? (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Pay Period</TableCell>
                    <TableCell>Basic Salary</TableCell>
                    <TableCell>Gross Salary</TableCell>
                    <TableCell>Net Salary</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {existingPayrolls.map((payroll) => (
                    <TableRow key={payroll._id} hover>
                      <TableCell>
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="subtitle2">
                              {months.find(month => month.value === payroll.month.toString().padStart(2, '0'))?.label || `Month ${payroll.month}`} {payroll.year}
                            </Typography>
                            <PayrollProrationBadge payroll={payroll} />
                          </Box>
                          <Typography variant="caption" color="textSecondary">
                            Payroll Period
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>{formatCurrency(payroll.basicSalary)}</TableCell>
                      <TableCell>{formatCurrency(payroll.grossSalary)}</TableCell>
                      <TableCell>{formatCurrency(payroll.netSalary)}</TableCell>
                      <TableCell>
                        <Chip
                          label={payroll.status}
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
                          <Tooltip title="Generate Payslip">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => generatePayslip(payroll)}
                            >
                              <DownloadIcon />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" color="textSecondary" gutterBottom>
                No previous payroll records found
              </Typography>
              <Typography variant="body2" color="textSecondary">
                This employee doesn't have any previous payroll records yet.
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      <PayslipReviewModal
        open={payslipModal.open}
        data={payslipModal.data}
        employeeLoans={employeeLoans}
        onClose={() => setPayslipModal({ open: false, data: null })}
        onDownload={handleDownloadPayslipPreview}
        downloadLoading={payslipDownloadLoading}
      />
    </Box>
  );
};

export default EmployeePayrollDetails;
