import React from 'react';
import {
  Box,
  Typography,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import PayrollProrationBadge from './PayrollProrationBadge';

const formatAmount = (amount) => `Rs ${(Number(amount) || 0).toLocaleString()}`;

const PayslipReviewModal = ({
  open,
  data,
  onClose,
  employeeLoans = [],
  onDownload,
  downloadLoading = false
}) => {
  if (!data) return null;

  const { employee, period, earnings, deductions, attendance, totals } = data;
  const activeLoans = employeeLoans.filter((loan) =>
    ['Active', 'Disbursed', 'Approved'].includes(loan.status)
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { minHeight: '80vh', borderRadius: 2 } }}
    >
      <DialogTitle sx={{ textAlign: 'center', borderBottom: '2px solid #f0f0f0', pb: 2, mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, color: '#2c3e50' }}>
          SARDAR GROUP OF COMPANIES
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 600, color: '#2c3e50', mt: 1 }}>
          PAY SLIP
        </Typography>
        <Typography variant="subtitle1" sx={{ mt: 1, color: '#666' }}>
          For the month of {period?.monthName} {period?.year}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2">
            <strong>Payslip No:</strong> {data.payslipNumber}
          </Typography>
          <Typography variant="body2">
            <strong>Issue Date:</strong> {data.issueDate}
          </Typography>
        </Box>
        {data.proration?.isProrated && (
          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
            <PayrollProrationBadge payroll={{ proration: data.proration, remarks: data.remarks }} />
          </Box>
        )}
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: '#2c3e50' }}>
          Employee Information
        </Typography>
        <TableContainer component={Paper} sx={{ mb: 3 }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell><strong>Name:</strong></TableCell>
                <TableCell>
                  {employee?.firstName} {employee?.lastName}
                </TableCell>
                <TableCell><strong>Department:</strong></TableCell>
                <TableCell>{employee?.department}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><strong>Employee ID:</strong></TableCell>
                <TableCell>{employee?.employeeId}</TableCell>
                <TableCell><strong>Designation:</strong></TableCell>
                <TableCell>{employee?.designation}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, color: '#2c3e50' }}>
          Earnings & Deductions
        </Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#f5f5f5' }}>
                  <TableRow>
                    <TableCell><strong>EARNINGS</strong></TableCell>
                    <TableCell align="right"><strong>AMOUNT</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[
                    ['Basic Salary', earnings?.basicSalary],
                    ['House Rent Allowance', earnings?.houseRent],
                    ['Medical Allowance', earnings?.medicalAllowance],
                    ['Conveyance Allowance', earnings?.conveyanceAllowance],
                    ['Food Allowance', earnings?.foodAllowance],
                    ['Mobile Allowance', earnings?.mobileAllowance],
                    ['Vehicle Allowance', earnings?.vehicleAllowance],
                    ['Fuel Allowance', earnings?.fuelAllowance],
                    ['Medical Allowance (from allowances)', earnings?.medicalFromAllowances],
                    ['House Rent Allowance (from allowances)', earnings?.houseRentFromAllowances],
                    ['Special Allowance', earnings?.specialAllowance],
                    ['Other Allowances', earnings?.otherAllowances],
                    ['Overtime', earnings?.overtime],
                    ['Performance Bonus', earnings?.bonus],
                    ['Other Bonus', earnings?.otherBonus],
                    ['Arrears', earnings?.arrears]
                  ]
                    .filter(([, amount]) => (Number(amount) || 0) > 0)
                    .map(([label, amount]) => (
                      <TableRow key={label}>
                        <TableCell>{label}</TableCell>
                        <TableCell align="right">{formatAmount(amount)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>

          <Grid item xs={12} md={6}>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#f5f5f5' }}>
                  <TableRow>
                    <TableCell><strong>DEDUCTIONS</strong></TableCell>
                    <TableCell align="right"><strong>AMOUNT</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[
                    ['EOBI', deductions?.eobi],
                    ['Employee Security', deductions?.employeeSecurity],
                    ['Income Tax', deductions?.incomeTax],
                    ['Provident Fund', deductions?.providentFund],
                    ['Health Insurance', deductions?.healthInsurance],
                    ['Attendance Deduction', deductions?.attendanceDeduction],
                    ['Leave Deduction', deductions?.leaveDeduction],
                    ['Other Deductions', deductions?.otherDeductions]
                  ]
                    .filter(([, amount]) => (Number(amount) || 0) > 0)
                    .map(([label, amount]) => (
                      <TableRow key={label}>
                        <TableCell>{label}</TableCell>
                        <TableCell align="right">{formatAmount(amount)}</TableCell>
                      </TableRow>
                    ))}
                  {activeLoans.map((loan) => (
                    <TableRow key={loan._id}>
                      <TableCell>
                        {loan.loanType} Loan Deduction ({loan.status})
                      </TableCell>
                      <TableCell align="right">{formatAmount(loan.monthlyInstallment)}</TableCell>
                    </TableRow>
                  ))}
                  {(deductions?.loanDeductions || 0) > 0 && activeLoans.length === 0 && (
                    <TableRow>
                      <TableCell>Loan Deductions</TableCell>
                      <TableCell align="right">{formatAmount(deductions.loanDeductions)}</TableCell>
                    </TableRow>
                  )}
                  {(deductions?.loanDeductions || 0) > 0 && activeLoans.length > 0 && (
                    <TableRow>
                      <TableCell><strong>Total Loan Deductions</strong></TableCell>
                      <TableCell align="right">
                        <strong>{formatAmount(deductions.loanDeductions)}</strong>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
        </Grid>

        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, color: '#2c3e50' }}>
          Summary of Earnings and Deductions
        </Typography>
        <TableContainer component={Paper} sx={{ mb: 3 }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell><strong>Total Earnings</strong></TableCell>
                <TableCell align="right">
                  <strong>{formatAmount(totals?.grossSalary)}</strong>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><strong>Total Deductions</strong></TableCell>
                <TableCell align="right">
                  <strong>{formatAmount(totals?.totalDeductions)}</strong>
                </TableCell>
              </TableRow>
              <TableRow sx={{ bgcolor: '#e8f5e8' }}>
                <TableCell><strong>Net Salary</strong></TableCell>
                <TableCell align="right">
                  <strong>{formatAmount(totals?.netSalary)}</strong>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, color: '#2c3e50' }}>
          Attendance Summary
        </Typography>
        <TableContainer component={Paper} sx={{ mb: 3 }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell><strong>Total Working Days:</strong></TableCell>
                <TableCell>{attendance?.totalDays}</TableCell>
                <TableCell><strong>Present Days:</strong></TableCell>
                <TableCell>{attendance?.presentDays}</TableCell>
                <TableCell><strong>Absent Days:</strong></TableCell>
                <TableCell>{attendance?.absentDays}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        {data.remarks && (
          <Typography variant="body2" sx={{ mb: 3, fontStyle: 'italic', color: '#666' }}>
            {data.remarks}
          </Typography>
        )}
        <Typography variant="body2" sx={{ mb: 3, fontStyle: 'italic', color: '#666' }}>
          Payroll period: {period?.monthName} {period?.year}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ borderTop: '2px solid #f0f0f0', p: 2 }}>
        <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" sx={{ color: '#666' }}>
            Generated on {new Date().toLocaleDateString('en-PK')}
          </Typography>
          <Box>
            <Button onClick={onClose} variant="outlined" sx={{ mr: 1 }}>
              Close
            </Button>
            {onDownload && (
              <Button
                variant="contained"
                startIcon={<DownloadIcon />}
                onClick={onDownload}
                disabled={downloadLoading}
              >
                {downloadLoading ? 'Downloading...' : 'Download PDF'}
              </Button>
            )}
          </Box>
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default PayslipReviewModal;
