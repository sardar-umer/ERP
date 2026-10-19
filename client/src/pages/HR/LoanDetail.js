import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Button,
  Chip,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  LinearProgress,
  IconButton,
  Tooltip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  AccountBalance as DisburseIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  Description as DescriptionIcon,
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Comment as CommentIcon,
  Pause as PauseIcon,
  PlayArrow as ResumeIcon,
  EditNote as AdjustIcon,
  PictureAsPdf as PdfIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { loanService } from '../../services/loanService';
import { formatPKR } from '../../utils/currency';
import { downloadLoanDetailPDF } from '../../utils/loanDetailPDF';
import { useAuth } from '../../contexts/AuthContext';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/** Loans that can have payroll deductions paused or adjusted */
const DEDUCTION_MANAGE_STATUSES = ['Approved', 'Active', 'Disbursed'];

const buildConsecutivePauseMonths = (startMonth, startYear, monthCount) => {
  const result = [];
  let m = Number(startMonth);
  let y = Number(startYear);
  const count = Math.min(Math.max(1, Number(monthCount) || 1), 36);

  for (let i = 0; i < count; i++) {
    result.push({ month: m, year: y });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
};

const LoanDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useAuth();
  const isDeveloper =
    user?.role === 'developer' ||
    (Array.isArray(user?.roles) && user.roles.includes('developer'));
  
  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Dialog states
  const [approvalDialog, setApprovalDialog] = useState(false);
  const [rejectionDialog, setRejectionDialog] = useState(false);
  const [disbursementDialog, setDisbursementDialog] = useState(false);
  const [noteDialog, setNoteDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pauseDialog, setPauseDialog] = useState(false);
  const [adjustDialog, setAdjustDialog] = useState(false);

  // Form states
  const [rejectionReason, setRejectionReason] = useState('');
  const [disbursementData, setDisbursementData] = useState({
    disbursementMethod: 'Bank Transfer',
    bankAccount: ''
  });
  const [noteContent, setNoteContent] = useState('');

  const now = new Date();
  const [pauseData, setPauseData] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    monthCount: 1,
    reason: ''
  });
  const [pauseSubmitting, setPauseSubmitting] = useState(false);
  const [adjustData, setAdjustData] = useState({ newAmount: '', reason: '' });
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  useEffect(() => {
    fetchLoan();
  }, [id]);

  const fetchLoan = async () => {
    try {
      setLoading(true);
      const data = await loanService.getLoanById(id);
      setLoan(data);
    } catch (error) {
      setError(error.message || 'Failed to fetch loan details');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    try {
      await loanService.approveLoan(id);
      setSuccess('Loan approved successfully');
      setApprovalDialog(false);
      fetchLoan();
    } catch (error) {
      setError(error.message || 'Failed to approve loan');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await loanService.deleteLoan(id);
      setDeleteDialog(false);
      navigate('/hr/loans');
    } catch (error) {
      setError(error.response?.data?.message || error.message || 'Failed to delete loan');
      setDeleteDialog(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleReject = async () => {
    try {
      await loanService.rejectLoan(id, rejectionReason);
      setSuccess('Loan rejected successfully');
      setRejectionDialog(false);
      setRejectionReason('');
      fetchLoan();
    } catch (error) {
      setError(error.message || 'Failed to reject loan');
    }
  };

  const handleDisburse = async () => {
    try {
      await loanService.disburseLoan(id, disbursementData);
      setSuccess('Loan disbursed successfully');
      setDisbursementDialog(false);
      fetchLoan();
    } catch (error) {
      setError(error.message || 'Failed to disburse loan');
    }
  };

  const handleAddNote = async () => {
    try {
      await loanService.addNote(id, noteContent);
      setSuccess('Note added successfully');
      setNoteDialog(false);
      setNoteContent('');
      fetchLoan();
    } catch (error) {
      setError(error.message || 'Failed to add note');
    }
  };

  const openPauseDialog = () => {
    const current = new Date();
    setPauseData({
      month: current.getMonth() + 1,
      year: current.getFullYear(),
      monthCount: 1,
      reason: ''
    });
    setPauseDialog(true);
  };

  const handlePauseMonth = async () => {
    try {
      setPauseSubmitting(true);
      setError('');
      const result = await loanService.pauseMonths(id, {
        startMonth: pauseData.month,
        startYear: pauseData.year,
        monthCount: pauseData.monthCount,
        reason: pauseData.reason
      });

      const addedCount = result.added?.length || pauseData.monthCount;
      const skippedCount = result.skipped?.length || 0;
      let message = result.message || `Loan paused for ${addedCount} month(s). Schedule extended.`;
      if (skippedCount > 0 && !result.message) {
        message += ` ${skippedCount} month(s) could not be paused.`;
      }
      setSuccess(message);
      setPauseDialog(false);
      fetchLoan();
    } catch (error) {
      setError(error.message || 'Failed to pause loan');
    } finally {
      setPauseSubmitting(false);
    }
  };

  const handleResumeMonth = async (month, year) => {
    try {
      const result = await loanService.resumeMonth(id, month, year);
      setSuccess(result.message || `Loan deduction resumed for ${MONTH_NAMES[month - 1]} ${year}`);
      fetchLoan();
    } catch (error) {
      setError(error.message || 'Failed to resume loan');
    }
  };

  const handleAdjustInstallment = async () => {
    try {
      setAdjustSubmitting(true);
      setError('');
      const result = await loanService.adjustInstallment(id, adjustData.newAmount, adjustData.reason);
      setSuccess(result.message || `EMI updated to Rs ${Number(adjustData.newAmount).toLocaleString()}`);
      setAdjustDialog(false);
      setAdjustData({ newAmount: '', reason: '' });
      fetchLoan();
    } catch (error) {
      setError(error.message || 'Failed to adjust installment');
    } finally {
      setAdjustSubmitting(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'Pending': 'warning',
      'Approved': 'info',
      'Rejected': 'error',
      'Disbursed': 'success',
      'Active': 'secondary',
      'Completed': 'success',
      'Defaulted': 'error'
    };
    return colors[status] || 'default';
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-PK', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const handleDownloadPDF = () => {
    try {
      downloadLoanDetailPDF(loan);
      setSuccess('Loan PDF downloaded successfully');
    } catch (err) {
      setError(err.message || 'Failed to download PDF');
    }
  };

  const renderLoanSummary = () => (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Typography variant="h6" gutterBottom>
              Loan Information
            </Typography>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Employee
              </Typography>
              <Typography variant="body1">
                {loan.employee?.firstName} {loan.employee?.lastName} ({loan.employee?.employeeId})
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Loan Type
              </Typography>
              <Typography variant="body1">{loan.loanType}</Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Purpose
              </Typography>
              <Typography variant="body1">{loan.purpose}</Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Status
              </Typography>
              <Chip
                label={loan.status}
                color={getStatusColor(loan.status)}
                size="small"
              />
            </Box>
          </Grid>
          
          <Grid item xs={12} md={6}>
            <Typography variant="h6" gutterBottom>
              Financial Details
            </Typography>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Loan Amount
              </Typography>
              <Typography variant="h6" color="primary">
                {formatPKR(loan.loanAmount)}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Monthly EMI
              </Typography>
              <Typography variant="h6" color="secondary">
                {formatPKR(loan.monthlyInstallment)}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Remaining Installments
              </Typography>
              <Typography variant="h6">
                {loan.remainingInstallments ?? loan.loanSchedule?.filter((i) => ['Pending', 'Overdue', 'Partial'].includes(i.status)).length ?? '—'}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Total Payable
              </Typography>
              <Typography variant="h6" color="error">
                {formatPKR(loan.totalPayable)}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Outstanding Balance
              </Typography>
              <Typography variant="h6" color="warning.main">
                {formatPKR(loan.outstandingBalance)}
              </Typography>
            </Box>
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />
        
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Progress
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: '100%', mr: 1 }}>
              <LinearProgress
                variant="determinate"
                value={loan.progressPercentage || 0}
                sx={{ height: 10, borderRadius: 5 }}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {loan.progressPercentage || 0}%
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  const renderLoanSchedule = () => (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          <ScheduleIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Loan Schedule
        </Typography>
        
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Installment</TableCell>
                <TableCell>Due Date</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Principal</TableCell>
                <TableCell>Interest</TableCell>
                <TableCell>Balance</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loan.loanSchedule?.map((installment) => (
                <TableRow key={installment.installmentNumber}>
                  <TableCell>{installment.installmentNumber}</TableCell>
                  <TableCell>{formatDate(installment.dueDate)}</TableCell>
                                      <TableCell>{formatPKR(installment.amount)}</TableCell>
                    <TableCell>{formatPKR(installment.principal)}</TableCell>
                    <TableCell>{formatPKR(installment.interest)}</TableCell>
                    <TableCell>{formatPKR(installment.balance)}</TableCell>
                  <TableCell>
                    <Chip
                      label={installment.status}
                      size="small"
                      color={
                        installment.status === 'Paid' ? 'success' :
                        installment.status === 'Paused' ? 'warning' :
                        installment.status === 'Overdue' ? 'error' :
                        installment.status === 'Partial' ? 'warning' : 'default'
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );

  const renderDeductionManagement = () => {
    const canManageDeductions = DEDUCTION_MANAGE_STATUSES.includes(loan.status);
    const paused = loan.pausedMonths || [];

    if (!canManageDeductions && paused.length === 0) {
      return (
        <Card sx={{ mb: 3, borderLeft: 4, borderColor: 'grey.400' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Salary Deduction Management
            </Typography>
            <Alert severity="info">
              Pause months or adjust EMI after the loan is <strong>Approved</strong> or <strong>Disbursed</strong>.
              Current status: <strong>{loan.status}</strong>
            </Alert>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card sx={{ mb: 3, borderLeft: 4, borderColor: 'primary.main' }}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2} mb={2}>
            <Box>
              <Typography variant="h6" gutterBottom>
                Salary Deduction Management
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Adjust EMI</strong> — permanently change monthly deduction; remaining installments recalculate automatically.
                <br />
                <strong>Pause Months</strong> — no payroll deduction that month; loan schedule extends with extra installment(s) at the end.
              </Typography>
              <Alert severity="success" sx={{ mt: 1.5 }}>
                Payroll deducts the current EMI each month (except paused months). When payroll is marked <strong>Paid</strong>, the loan schedule updates automatically.
              </Alert>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Current EMI: <strong>{formatPKR(loan.monthlyInstallment)}</strong>
                {' · '}
                Remaining installments: <strong>{loan.remainingInstallments ?? '—'}</strong>
              </Typography>
            </Box>
            {canManageDeductions && (
              <Box display="flex" flexWrap="wrap" gap={1}>
                <Button size="small" variant="contained" color="warning" startIcon={<PauseIcon />} onClick={openPauseDialog}>
                  Pause Months
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="info"
                  startIcon={<AdjustIcon />}
                  onClick={() => {
                    setAdjustData({ newAmount: loan.monthlyInstallment || '', reason: '' });
                    setAdjustDialog(true);
                  }}
                >
                  Adjust EMI
                </Button>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            <PauseIcon sx={{ mr: 0.5, verticalAlign: 'middle', fontSize: 20, color: 'warning.main' }} />
            Paused Deduction Months
          </Typography>
          {paused.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No months paused — full EMI is deducted each payroll month.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Month / Year</TableCell>
                    <TableCell>Reason</TableCell>
                    <TableCell>Paused At</TableCell>
                    {canManageDeductions && <TableCell align="right">Action</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paused.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Chip label={`${MONTH_NAMES[p.month - 1]} ${p.year}`} color="warning" size="small" />
                      </TableCell>
                      <TableCell>{p.reason || '—'}</TableCell>
                      <TableCell>{p.pausedAt ? new Date(p.pausedAt).toLocaleDateString() : '—'}</TableCell>
                      {canManageDeductions && (
                        <TableCell align="right">
                          <Tooltip title="Resume deductions for this month">
                            <Button size="small" color="success" startIcon={<ResumeIcon />} onClick={() => handleResumeMonth(p.month, p.year)}>
                              Resume
                            </Button>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderGuarantorInfo = () => (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Guarantor Information
        </Typography>
        
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <Typography variant="body2" color="text.secondary">
              Name
            </Typography>
            <Typography variant="body1">
              {loan.guarantor?.name || 'Not provided'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="body2" color="text.secondary">
              Relationship
            </Typography>
            <Typography variant="body1">
              {loan.guarantor?.relationship || 'Not provided'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="body2" color="text.secondary">
              Phone
            </Typography>
            <Typography variant="body1">
              {loan.guarantor?.phone || 'Not provided'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="body2" color="text.secondary">
              ID Card
            </Typography>
            <Typography variant="body1">
              {loan.guarantor?.idCard || 'Not provided'}
            </Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );

  const renderNotes = () => (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">
            <CommentIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Notes & Comments
          </Typography>
          <Button
            startIcon={<AddIcon />}
            onClick={() => setNoteDialog(true)}
            size="small"
          >
            Add Note
          </Button>
        </Box>
        
        {loan.notes?.length > 0 ? (
          <List>
            {loan.notes.map((note, index) => (
              <ListItem key={index} alignItems="flex-start">
                <ListItemIcon>
                  <CommentIcon />
                </ListItemIcon>
                <ListItemText
                  primary={note.content}
                  secondary={`${note.addedBy?.firstName} ${note.addedBy?.lastName} - ${formatDate(note.addedAt)}`}
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No notes added yet.
          </Typography>
        )}
      </CardContent>
    </Card>
  );

  const renderActionButtons = () => {
    const buttons = [];

    if (loan.status === 'Pending') {
      buttons.push(
        <Button
          key="approve"
          variant="contained"
          color="success"
          startIcon={<ApproveIcon />}
          onClick={() => setApprovalDialog(true)}
          sx={{ mr: 1 }}
        >
          Approve
        </Button>,
        <Button
          key="reject"
          variant="contained"
          color="error"
          startIcon={<RejectIcon />}
          onClick={() => setRejectionDialog(true)}
          sx={{ mr: 1 }}
        >
          Reject
        </Button>
      );
    }

    if (loan.status === 'Approved') {
      buttons.push(
        <Button
          key="disburse"
          variant="contained"
          color="primary"
          startIcon={<DisburseIcon />}
          onClick={() => setDisbursementDialog(true)}
          sx={{ mr: 1 }}
        >
          Disburse
        </Button>
      );
    }

    if (loan.status === 'Pending') {
      buttons.push(
        <Button
          key="edit"
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={() => navigate(`/hr/loans/${id}/edit`)}
          sx={{ mr: 1 }}
        >
          Edit
        </Button>
      );
    }

    if (loan.status === 'Pending' || isDeveloper) {
      buttons.push(
        <Button
          key="delete"
          variant="outlined"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() => setDeleteDialog(true)}
        >
          {loan.status === 'Pending' ? 'Delete' : 'Delete (Developer)'}
        </Button>
      );
    }

    return buttons;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (!loan) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Loan not found</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} mb={3}>
        <Box display="flex" alignItems="center">
          <Button
            startIcon={<BackIcon />}
            onClick={() => navigate('/hr/loans')}
            sx={{ mr: 2 }}
          >
            Back
          </Button>
          <Typography variant="h4" component="h1">
            Loan Details
          </Typography>
        </Box>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<PdfIcon />}
          onClick={handleDownloadPDF}
        >
          Download PDF
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <Box sx={{ mb: 3 }}>
        {renderActionButtons()}
      </Box>

      {renderLoanSummary()}
      {renderDeductionManagement()}
      {renderLoanSchedule()}
      {renderGuarantorInfo()}
      {renderNotes()}

      {/* Approval Dialog */}
      <Dialog open={approvalDialog} onClose={() => setApprovalDialog(false)}>
        <DialogTitle>Approve Loan</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to approve this loan application?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApprovalDialog(false)}>Cancel</Button>
          <Button onClick={handleApprove} color="success" variant="contained">
            Approve
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog (Pending for all; any status for developer) */}
      <Dialog open={deleteDialog} onClose={() => !deleting && setDeleteDialog(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this loan application? This action cannot be undone.
          </Typography>
          {loan?.status && loan.status !== 'Pending' && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Developer override: this loan is currently <strong>{loan.status}</strong>.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(false)} disabled={deleting}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rejection Dialog */}
      <Dialog open={rejectionDialog} onClose={() => setRejectionDialog(false)}>
        <DialogTitle>Reject Loan</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Rejection Reason"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectionDialog(false)}>Cancel</Button>
          <Button 
            onClick={handleReject} 
            color="error" 
            variant="contained"
            disabled={!rejectionReason.trim()}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      {/* Disbursement Dialog */}
      <Dialog open={disbursementDialog} onClose={() => setDisbursementDialog(false)}>
        <DialogTitle>Disburse Loan</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Disbursement Method</InputLabel>
                <Select
                  value={disbursementData.disbursementMethod}
                  label="Disbursement Method"
                  onChange={(e) => setDisbursementData(prev => ({
                    ...prev,
                    disbursementMethod: e.target.value
                  }))}
                >
                  {loanService.getDisbursementMethodOptions().map(option => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Bank Account (if applicable)"
                value={disbursementData.bankAccount}
                onChange={(e) => setDisbursementData(prev => ({
                  ...prev,
                  bankAccount: e.target.value
                }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisbursementDialog(false)}>Cancel</Button>
          <Button onClick={handleDisburse} color="primary" variant="contained">
            Disburse
          </Button>
        </DialogActions>
      </Dialog>

      {/* Note Dialog */}
      <Dialog open={noteDialog} onClose={() => setNoteDialog(false)}>
        <DialogTitle>Add Note</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Note Content"
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteDialog(false)}>Cancel</Button>
          <Button
            onClick={handleAddNote}
            color="primary"
            variant="contained"
            disabled={!noteContent.trim()}
          >
            Add Note
          </Button>
        </DialogActions>
      </Dialog>

      {/* Pause Months Dialog */}
      <Dialog open={pauseDialog} onClose={() => setPauseDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <PauseIcon sx={{ mr: 1, verticalAlign: 'middle', color: 'warning.main' }} />
          Pause Loan Deduction
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            No payroll deduction for the selected month(s). Matching schedule month(s) are marked <strong>Paused</strong> and the same repayment is added at the end of the loan.
          </Alert>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Start Month</InputLabel>
                <Select
                  value={pauseData.month}
                  label="Start Month"
                  onChange={(e) => setPauseData((p) => ({ ...p, month: Number(e.target.value) }))}
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <MenuItem key={idx + 1} value={idx + 1}>{name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Start Year"
                value={pauseData.year}
                onChange={(e) => setPauseData((p) => ({ ...p, year: Number(e.target.value) }))}
                inputProps={{ min: 2020, max: 2099 }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                type="number"
                label="Number of Months to Pause"
                value={pauseData.monthCount}
                onChange={(e) => setPauseData((p) => ({
                  ...p,
                  monthCount: Math.min(36, Math.max(1, Number(e.target.value) || 1))
                }))}
                inputProps={{ min: 1, max: 36 }}
                helperText="Consecutive months from the start date (max 36)"
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Months that will be paused:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {buildConsecutivePauseMonths(pauseData.month, pauseData.year, pauseData.monthCount).map((p) => (
                  <Chip
                    key={`${p.month}-${p.year}`}
                    label={`${MONTH_NAMES[p.month - 1]} ${p.year}`}
                    size="small"
                    color="warning"
                    variant="outlined"
                  />
                ))}
              </Box>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Reason (optional)"
                value={pauseData.reason}
                onChange={(e) => setPauseData((p) => ({ ...p, reason: e.target.value }))}
                multiline
                rows={2}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPauseDialog(false)} disabled={pauseSubmitting}>Cancel</Button>
          <Button
            onClick={handlePauseMonth}
            color="warning"
            variant="contained"
            disabled={pauseSubmitting || !pauseData.monthCount}
          >
            {pauseSubmitting
              ? 'Pausing...'
              : `Pause ${pauseData.monthCount} Month${pauseData.monthCount > 1 ? 's' : ''}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Adjust EMI Dialog */}
      <Dialog open={adjustDialog} onClose={() => setAdjustDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <AdjustIcon sx={{ mr: 1, verticalAlign: 'middle', color: 'info.main' }} />
          Adjust Monthly EMI
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Lower EMI → more remaining months. Higher EMI → fewer remaining months.
            The loan schedule and payroll deduction update automatically.
            Current EMI: <strong>{formatPKR(loan?.monthlyInstallment)}</strong>
            {' · '}
            Outstanding: <strong>{formatPKR(loan?.outstandingBalance)}</strong>
          </Alert>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                type="number"
                label="New Monthly Installment (Rs)"
                value={adjustData.newAmount}
                onChange={(e) => setAdjustData((d) => ({ ...d, newAmount: e.target.value }))}
                inputProps={{ min: 0 }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Reason"
                value={adjustData.reason}
                onChange={(e) => setAdjustData((d) => ({ ...d, reason: e.target.value }))}
                multiline
                rows={2}
                placeholder="e.g., Hardship reduction, agreed restructuring..."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdjustDialog(false)} disabled={adjustSubmitting}>Cancel</Button>
          <Button
            onClick={handleAdjustInstallment}
            color="info"
            variant="contained"
            disabled={adjustSubmitting || !adjustData.newAmount || Number(adjustData.newAmount) <= 0}
          >
            {adjustSubmitting ? 'Updating...' : 'Update EMI & Schedule'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LoanDetail; 