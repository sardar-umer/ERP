import React from 'react';
import {
  Alert,
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Divider
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Remove as RemoveIcon,
  Print as PrintIcon
} from '@mui/icons-material';
import MonthlyPayrollApprovalSection from './MonthlyPayrollApprovalSection';
import PayrollApprovalAuthorityTable from './PayrollApprovalAuthorityTable';
import { getPayrollStatusColor, getPayrollStatusLabel } from '../../utils/payrollStatusHelpers';
import { printTovusElement } from '../../utils/tovusPrintBrand';

const formatCurrency = (amount) => {
  const value = Number(amount) || 0;
  return `Rs. ${value.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatIncrementType = (value) => {
  if (!value) return '—';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const ChangeChip = ({ value, suffix = '' }) => {
  const num = Number(value) || 0;
  if (num > 0) {
    return (
      <Chip
        size="small"
        color="success"
        icon={<TrendingUpIcon />}
        label={`+${num}${suffix}`}
      />
    );
  }
  if (num < 0) {
    return (
      <Chip
        size="small"
        color="error"
        icon={<TrendingDownIcon />}
        label={`${num}${suffix}`}
      />
    );
  }
  return <Chip size="small" icon={<RemoveIcon />} label={`0${suffix}`} />;
};

const SummaryCard = ({ title, value, subtitle }) => (
  <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
    <Typography variant="caption" color="text.secondary" display="block">
      {title}
    </Typography>
    <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 600 }}>
      {value}
    </Typography>
    {subtitle ? (
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {subtitle}
      </Typography>
    ) : null}
  </Paper>
);

const EmployeeTable = ({ title, rows, emptyMessage, showTermination = false, showNote = false, summaryOnly = false }) => (
  <Box sx={{ mt: 3 }}>
    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
      {title} ({rows?.length || 0})
    </Typography>
    {!rows?.length ? (
      <Alert severity="info" sx={{ mt: 1 }}>{emptyMessage}</Alert>
    ) : summaryOnly ? null : (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '12%' }}>Employee ID</TableCell>
              <TableCell sx={{ width: '20%' }}>Name</TableCell>
              <TableCell sx={{ width: '20%' }}>Department</TableCell>
              <TableCell sx={{ width: '15%' }}>Gross Salary</TableCell>
              <TableCell sx={{ width: '15%' }}>{showTermination ? 'Separation Date' : 'Joining Date'}</TableCell>
              {showTermination ? <TableCell sx={{ width: '10%' }}>Status</TableCell> : null}
              {showTermination || showNote ? <TableCell sx={{ width: 'auto' }}>{showTermination ? 'Reason / Note' : 'Note'}</TableCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row.employeeId}-${index}`}>
                <TableCell>{row.employeeId}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.department}</TableCell>
                <TableCell>{formatCurrency(row.grossSalary)}</TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    {formatDate(showTermination ? row.terminationDate : row.joiningDate)}
                    {(!showTermination && row.isLateEntryForPayroll) && (
                      <Chip label="Late Entry" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
                    )}
                    {(showTermination && row.isLateTerminationEntryForPayroll) && (
                      <Chip label="Late Entry" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
                    )}
                  </Box>
                </TableCell>
                {showTermination ? <TableCell>{row.employmentStatus || '—'}</TableCell> : null}
                {showTermination || showNote ? (
                  <TableCell>{row.reason || row.note || '—'}</TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )}
  </Box>
);

const IncrementTable = ({ title, rows, emptyMessage }) => (
  <Box sx={{ mt: 3 }}>
    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
      {title} ({rows?.length || 0})
    </Typography>
    {!rows?.length ? (
      <Alert severity="info" sx={{ mt: 1 }}>{emptyMessage}</Alert>
    ) : (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '10%' }}>Employee ID</TableCell>
              <TableCell sx={{ width: '15%' }}>Name</TableCell>
              <TableCell sx={{ width: '15%' }}>Department</TableCell>
              <TableCell sx={{ width: '10%' }}>Type</TableCell>
              <TableCell align="right" sx={{ width: '12%' }}>Previous Salary</TableCell>
              <TableCell align="right" sx={{ width: '12%' }}>New Salary</TableCell>
              <TableCell align="right" sx={{ width: '12%' }}>Increment</TableCell>
              <TableCell sx={{ width: '10%' }}>Effective Date</TableCell>
              <TableCell sx={{ width: 'auto' }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row.employeeId}-${index}`}>
                <TableCell>{row.employeeId}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.department}</TableCell>
                <TableCell>{formatIncrementType(row.incrementType)}</TableCell>
                <TableCell align="right">{formatCurrency(row.previousSalary)}</TableCell>
                <TableCell align="right">{formatCurrency(row.newSalary)}</TableCell>
                <TableCell align="right">
                  {formatCurrency(row.incrementAmount)}
                  {row.incrementPercentage ? ` (${row.incrementPercentage}%)` : ''}
                </TableCell>
                <TableCell>{formatDate(row.effectiveDate)}</TableCell>
                <TableCell>{row.status || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )}
  </Box>
);

const AdvanceSalaryTable = ({ title, rows, totalAmount, emptyMessage }) => (
  <Box sx={{ mt: 3 }}>
    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
      {title} ({rows?.length || 0}) — Total: {formatCurrency(totalAmount)}
    </Typography>
    {!rows?.length ? (
      <Alert severity="info" sx={{ mt: 1 }}>{emptyMessage}</Alert>
    ) : (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '12%' }}>Employee ID</TableCell>
              <TableCell sx={{ width: '22%' }}>Name</TableCell>
              <TableCell sx={{ width: '20%' }}>Department</TableCell>
              <TableCell align="right" sx={{ width: '15%' }}>Advance Amount</TableCell>
              <TableCell sx={{ width: '15%' }}>Payment Method</TableCell>
              <TableCell sx={{ width: '16%' }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row.employeeId}-${index}`}>
                <TableCell>{row.employeeId}</TableCell>
                <TableCell><b>{row.name}</b></TableCell>
                <TableCell>{row.department}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{formatCurrency(row.amount)}</TableCell>
                <TableCell>{row.paymentMethod || 'Bank Transfer'}</TableCell>
                <TableCell>
                  <Chip
                    label={row.status || 'Unadjusted'}
                    size="small"
                    color={row.status === 'Adjusted' ? 'success' : 'warning'}
                    variant="outlined"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )}
  </Box>
);

const PayrollMonthlyComparisonDialog = ({
  open,
  onClose,
  report,
  generatedAt,
  reportStatus = 'Draft',
  loading = false,
  month,
  year,
  periodLabel,
  draftCount = 0,
  approvalDoc,
  approvalLoading = false,
  onRefreshApproval,
  onApprovalUpdated
}) => {
  if (!report && !loading) return null;

  const {
    current,
    previous,
    comparison,
    previousPeriod,
    periodLabel: reportPeriodLabel
  } = report || {};

  const displayPeriodLabel = periodLabel || reportPeriodLabel || '—';

  const handleApprovalUpdated = async (doc) => {
    onApprovalUpdated?.(doc);
    await onRefreshApproval?.();
  };

  const handlePrint = () => {
    // Tovus-branded report print (normal size, flows over pages, footer on every page)
    printTovusElement('#payroll-comparison-print-area', {
      title: 'Payroll Monthly Comparison',
      docRef: displayPeriodLabel !== '—' ? displayPeriodLabel : undefined,
      fit: false
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper" sx={{ '@media print': { '& .MuiDialog-container': { height: 'auto' }, '& .MuiPaper-root': { boxShadow: 'none', margin: 0, maxWidth: '100%', width: '100%', maxHeight: 'none' } } }}>
      <DialogTitle sx={{ '@media print': { display: 'none' } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            Monthly Payroll Comparison — {displayPeriodLabel}
            {generatedAt ? (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Generated {formatDate(generatedAt)}
              </Typography>
            ) : null}
          </Box>
          {!loading && (
            <Chip
              size="small"
              color={getPayrollStatusColor(reportStatus)}
              label={`Report: ${getPayrollStatusLabel(reportStatus)}`}
            />
          )}
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ '@media print': { overflow: 'visible', border: 'none', p: 0 } }}>
        {loading ? (
          <Typography color="text.secondary">Building comparison report…</Typography>
        ) : (
          <Box id="payroll-comparison-print-area">
            {/* Print Header */}
            <Box sx={{ display: 'none', '@media print': { display: 'block', mb: 3, textAlign: 'center' } }}>
              <Typography variant="h5" fontWeight={700}>Monthly Payroll Comparison Report</Typography>
              <Typography variant="subtitle1">{displayPeriodLabel}</Typography>
              {generatedAt && (
                <Typography variant="caption" color="text.secondary">
                  Generated {formatDate(generatedAt)}
                </Typography>
              )}
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Comparing payroll headcount and totals with {previousPeriod?.label || 'the previous month'}.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <SummaryCard
                  title="This Month (Payroll)"
                  value={current?.payrollCount ?? 0}
                  subtitle={displayPeriodLabel}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <SummaryCard
                  title="Last Month (Payroll)"
                  value={previous?.payrollCount ?? 0}
                  subtitle={previousPeriod?.label}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <SummaryCard
                  title="Headcount Change"
                  value={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>{comparison?.headcountChange ?? 0}</span>
                      <ChangeChip value={comparison?.headcountChange} />
                    </Box>
                  }
                  subtitle={
                    comparison?.headcountChangePercent != null
                      ? `${comparison.headcountChangePercent}% vs last month`
                      : ''
                  }
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <SummaryCard
                  title="Hirings / Separations"
                  value={`${report?.hirings?.length || 0} / ${report?.separations?.length || 0}`}
                  subtitle="New joins vs leavers this month"
                />
              </Grid>
            </Grid>

            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Salary Totals Comparison
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Metric</TableCell>
                      <TableCell align="right">{previousPeriod?.label}</TableCell>
                      <TableCell align="right">{displayPeriodLabel}</TableCell>
                      <TableCell align="right">Change</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell>Employees on Payroll</TableCell>
                      <TableCell align="right">{previous?.payrollCount ?? 0}</TableCell>
                      <TableCell align="right">{current?.payrollCount ?? 0}</TableCell>
                      <TableCell align="right">
                        <ChangeChip value={comparison?.headcountChange} />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Total Gross Salary</TableCell>
                      <TableCell align="right">{formatCurrency(previous?.totalGrossSalary)}</TableCell>
                      <TableCell align="right">{formatCurrency(current?.totalGrossSalary)}</TableCell>
                      <TableCell align="right">
                        <ChangeChip value={comparison?.grossSalaryChange} />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Total Net Salary</TableCell>
                      <TableCell align="right">{formatCurrency(previous?.totalNetSalary)}</TableCell>
                      <TableCell align="right">{formatCurrency(current?.totalNetSalary)}</TableCell>
                      <TableCell align="right">
                        <ChangeChip value={comparison?.netSalaryChange} />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Salary Advances Disbursed</TableCell>
                      <TableCell align="right">{formatCurrency(report?.salaryAdvances?.previous?.totalAmount)}</TableCell>
                      <TableCell align="right">{formatCurrency(report?.salaryAdvances?.current?.totalAmount)}</TableCell>
                      <TableCell align="right">
                        <ChangeChip value={(report?.salaryAdvances?.current?.totalAmount || 0) - (report?.salaryAdvances?.previous?.totalAmount || 0)} />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            <EmployeeTable
              title="New Hirings This Month"
              rows={report?.hirings}
              emptyMessage="No new hirings recorded for this month."
            />

            <EmployeeTable
              title="Separations / Leavers This Month"
              rows={report?.separations}
              emptyMessage="No separations recorded for this month."
              showTermination
            />

            <IncrementTable
              title="Salary Increments This Month"
              rows={report?.salaryIncrements}
              emptyMessage="No salary increments effective in this month."
            />

            <AdvanceSalaryTable
              title="Salary Advances Issued This Month"
              rows={report?.salaryAdvances?.current?.items}
              totalAmount={report?.salaryAdvances?.current?.totalAmount || 0}
              emptyMessage="No salary advances issued for this month."
            />

            <EmployeeTable
              title="Reinstated Employees This Month"
              rows={report?.reinstatedEmployees ?? report?.resumedEmployees}
              emptyMessage="No reinstated employees on payroll this month."
              showNote
            />

            {(report?.newOnPayroll?.length > 0 || report?.removedFromPayroll?.length > 0) ? (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Payroll Roster Changes (vs Last Month)
                </Typography>
                <EmployeeTable
                  title="Added to Payroll (not on last month)"
                  rows={report?.newOnPayroll}
                  emptyMessage="No employees added to payroll compared with last month."
                  summaryOnly
                />
                <EmployeeTable
                  title="Removed from Payroll (were on last month)"
                  rows={report?.removedFromPayroll}
                  emptyMessage="No employees removed from payroll compared with last month."
                  showTermination
                  summaryOnly
                />
              </>
            ) : null}

            <Divider sx={{ my: 3 }} />

            <MonthlyPayrollApprovalSection
              month={month}
              year={year}
              periodLabel={displayPeriodLabel}
              draftCount={draftCount}
              approvalDoc={approvalDoc}
              loading={approvalLoading}
              coversComparisonReport
              onRefresh={onRefreshApproval}
              onUpdated={handleApprovalUpdated}
            />

            <PayrollApprovalAuthorityTable
              monthlyApproval={approvalDoc}
              title="Approval Authority Signatures (Payroll & Comparison Report)"
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ '@media print': { display: 'none' } }}>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint} sx={{ mr: 'auto' }}>
          Print / Save as PDF
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default PayrollMonthlyComparisonDialog;
