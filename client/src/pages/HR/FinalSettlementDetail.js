import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  Button,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Edit as EditIcon,
  CheckCircle as ApproveIcon,
  PlayArrow as ProcessIcon,
  Payment as PaymentIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Comment as CommentIcon,
  Person as PersonIcon,
  AccountBalance as MoneyIcon,
  Schedule as TimeIcon,
  Description as DescriptionIcon,
  Print as PrintIcon,
  Download as DownloadIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import finalSettlementService from '../../services/finalSettlementService';
import api from '../../services/api';
import { formatPKR } from '../../utils/currency';
import {
  downloadFinalSettlementPdf,
  printFinalSettlementPdf
} from '../../utils/finalSettlementDocumentUtils';

const FinalSettlementDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [settlement, setSettlement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [commentDialog, setCommentDialog] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [company, setCompany] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    loadSettlement();
    loadCompanyProfile();
  }, [id]);

  const loadCompanyProfile = async () => {
    try {
      const response = await api.get('/finance/company-profile');
      setCompany(response.data.data || {});
    } catch {
      setCompany({});
    }
  };

  const loadSettlement = async () => {
    try {
      setLoading(true);
      const response = await finalSettlementService.getSettlement(id);
      setSettlement(response.data);
    } catch (error) {
      console.error('Error loading settlement:', error);
      setError('Error loading settlement details');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action) => {
    try {
      setActionLoading(true);
      
      switch (action) {
        case 'approve':
          await finalSettlementService.approveSettlement(id);
          setSnackbar({
            open: true,
            message: 'Settlement approved successfully',
            severity: 'success'
          });
          break;
        case 'process':
          await finalSettlementService.processSettlement(id);
          setSnackbar({
            open: true,
            message: 'Settlement processed successfully',
            severity: 'success'
          });
          break;
        case 'paid':
          await finalSettlementService.markAsPaid(id);
          setSnackbar({
            open: true,
            message: 'Settlement marked as paid successfully',
            severity: 'success'
          });
          break;
        case 'cancel':
          await finalSettlementService.cancelSettlement(id);
          setSnackbar({
            open: true,
            message: 'Settlement cancelled successfully',
            severity: 'success'
          });
          break;
        case 'delete':
          await finalSettlementService.deleteSettlement(id);
          setSnackbar({
            open: true,
            message: 'Settlement deleted successfully',
            severity: 'success'
          });
          setTimeout(() => navigate('/hr/settlements'), 1500);
          break;
        default:
          break;
      }
      
      loadSettlement(); // Reload data
    } catch (error) {
      console.error(`Error performing ${action}:`, error);
      setSnackbar({
        open: true,
        message: `Error performing ${action}`,
        severity: 'error'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!settlement) return;
    downloadFinalSettlementPdf(settlement, company);
  };

  const handlePrint = () => {
    if (!settlement) return;
    printFinalSettlementPdf(settlement, company);
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    
    try {
      await finalSettlementService.addComment(id, newComment);
      setSnackbar({
        open: true,
        message: 'Comment added successfully',
        severity: 'success'
      });
      setNewComment('');
      setCommentDialog(false);
      loadSettlement();
    } catch (error) {
      console.error('Error adding comment:', error);
      setSnackbar({
        open: true,
        message: 'Error adding comment',
        severity: 'error'
      });
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!settlement) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Settlement not found</Alert>
      </Box>
    );
  }

  const formattedSettlement = finalSettlementService.formatSettlementData(settlement);
  const formattedEarnings = finalSettlementService.formatEarnings(settlement.earnings);
  const formattedDeductions = finalSettlementService.formatDeductions(settlement.deductions);
  const formattedLoans = finalSettlementService.formatLoanSettlements(settlement.loans);

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Final Settlement Details
          </Typography>
          <Typography variant="body1" color="textSecondary">
            {String(settlement.employeeName || '')} - {String(settlement.employeeId || '')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={handlePrint}
          >
            Print
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownloadPdf}
          >
            Download PDF
          </Button>
          <Button
            variant="outlined"
            startIcon={<BackIcon />}
            onClick={() => navigate('/hr/settlements')}
          >
            Back
          </Button>
          {settlement.status === 'pending' && (
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/hr/settlements/${id}/edit`)}
            >
              Edit
            </Button>
          )}
        </Box>
      </Box>

      {/* Status and Progress */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Settlement Progress</Typography>
            <Chip
              label={finalSettlementService.getStatusLabel(settlement.status)}
              sx={{
                backgroundColor: finalSettlementService.getStatusColor(settlement.status),
                color: 'white',
                fontWeight: 'bold'
              }}
            />
          </Box>
          <LinearProgress
            variant="determinate"
            value={formattedSettlement.progressPercentage}
            sx={{ height: 10, borderRadius: 5 }}
          />
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            {Math.round(formattedSettlement.progressPercentage)}% Complete
          </Typography>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        {/* Employee Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PersonIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Employee Information</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Employee ID</Typography>
                  <Typography variant="body1">{String(settlement.employeeId || 'N/A')}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Name</Typography>
                  <Typography variant="body1">{String(settlement.employeeName || 'N/A')}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Department</Typography>
                  <Typography variant="body1">{String(settlement.department || 'N/A')}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Designation</Typography>
                  <Typography variant="body1">{String(settlement.designation || 'N/A')}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Settlement Details */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <DescriptionIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Settlement Details</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Type</Typography>
                  <Chip
                    label={finalSettlementService.getSettlementTypeLabel(settlement.settlementType)}
                    size="small"
                    sx={{
                      backgroundColor: finalSettlementService.getSettlementTypeColor(settlement.settlementType),
                      color: 'white'
                    }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Last Working Date</Typography>
                  <Typography variant="body1">
                    {new Date(settlement.lastWorkingDate).toLocaleDateString()}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Settlement Date</Typography>
                  <Typography variant="body1">
                    {new Date(settlement.settlementDate).toLocaleDateString()}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Notice Period</Typography>
                  <Typography variant="body1">
                    {settlement.noticePeriodServed}/{settlement.noticePeriod} days
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">Shortfall</Typography>
                  <Typography variant="body1" fontWeight="bold" color={formattedSettlement.noticePeriodShortfallDays > 0 ? 'error.main' : 'inherit'}>
                    {formattedSettlement.noticePeriodShortfallDays || 0} days
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Salary & Calculations — mirrors create form */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <MoneyIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Salary & Calculations</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6} md={3}>
                  <Typography variant="body2" color="textSecondary">Gross Salary</Typography>
                  <Typography variant="body1" fontWeight="bold">{formattedSettlement.formattedGrossSalary}</Typography>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="body2" color="textSecondary">Basic Salary</Typography>
                  <Typography variant="body1" fontWeight="bold">{formattedSettlement.formattedBasicSalary}</Typography>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="body2" color="textSecondary">Daily Rate (from Gross)</Typography>
                  <Typography variant="body1" fontWeight="bold">{formattedSettlement.formattedDailyRate}</Typography>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="body2" color="textSecondary">Month Days</Typography>
                  <Typography variant="body1" fontWeight="bold">{formattedSettlement.calendarDaysInMonth}</Typography>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="body2" color="textSecondary">Actual Salary (Gross × Served)</Typography>
                  <Typography variant="body1" fontWeight="bold" color="primary.main">
                    {formattedSettlement.formattedActualSalary}
                  </Typography>
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="body2" color="textSecondary">Notice Deduction (Gross × Shortfall)</Typography>
                  <Typography variant="body1" fontWeight="bold" color="error.main">
                    {formattedSettlement.formattedShortfallDeduction}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Financial Summary */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <MoneyIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Financial Summary</Typography>
              </Box>
              <Grid container spacing={3}>
                <Grid item xs={12} md={4}>
                  <Card variant="outlined">
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography variant="h4" color="primary">
                        {formattedSettlement.formattedGrossAmount}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Gross Settlement Amount
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Card variant="outlined">
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography variant="h4" color="error">
                        {formattedSettlement.formattedTotalDeductions}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Total Deductions
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Card variant="outlined">
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography variant="h4" color="success.main">
                        {formattedSettlement.formattedNetAmount}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Net Settlement Amount
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Earnings Breakdown */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Earnings Breakdown</Typography>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Basic Salary</TableCell>
                      <TableCell align="right">{formattedEarnings.basicSalary}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>House Rent</TableCell>
                      <TableCell align="right">{formattedEarnings.houseRent}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Medical Allowance</TableCell>
                      <TableCell align="right">{formattedEarnings.medicalAllowance}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Conveyance Allowance</TableCell>
                      <TableCell align="right">{formattedEarnings.conveyanceAllowance}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Food Allowance</TableCell>
                      <TableCell align="right">{formattedEarnings.foodAllowance}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Mobile Allowance</TableCell>
                      <TableCell align="right">{formattedEarnings.mobileAllowance}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Vehicle Allowance</TableCell>
                      <TableCell align="right">{formattedEarnings.vehicleAllowance}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Fuel Allowance</TableCell>
                      <TableCell align="right">{formattedEarnings.fuelAllowance}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Special Allowance</TableCell>
                      <TableCell align="right">{formattedEarnings.specialAllowance}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Other Allowances</TableCell>
                      <TableCell align="right">{formattedEarnings.otherAllowances}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Other Earnings</TableCell>
                      <TableCell align="right">{formattedEarnings.otherEarnings}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Overtime</TableCell>
                      <TableCell align="right">{formattedEarnings.overtime}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Bonus</TableCell>
                      <TableCell align="right">{formattedEarnings.bonus}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Gratuity</TableCell>
                      <TableCell align="right">{formattedEarnings.gratuity}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Leave Encashment</TableCell>
                      <TableCell align="right">{formattedEarnings.leaveEncashment}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Notice Pay</TableCell>
                      <TableCell align="right">{formattedEarnings.noticePay}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Provident Fund</TableCell>
                      <TableCell align="right">{formattedEarnings.providentFund}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>EOBI</TableCell>
                      <TableCell align="right">{formattedEarnings.eobi}</TableCell>
                    </TableRow>
                    <TableRow sx={{ backgroundColor: 'primary.light', color: 'white' }}>
                      <TableCell><strong>Total Earnings</strong></TableCell>
                      <TableCell align="right"><strong>{formattedEarnings.totalEarnings}</strong></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Deductions Breakdown */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Deductions Breakdown</Typography>
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>Income Tax</TableCell>
                      <TableCell align="right">{formattedDeductions.incomeTax}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Provident Fund</TableCell>
                      <TableCell align="right">{formattedDeductions.providentFund}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>EOBI</TableCell>
                      <TableCell align="right">{formattedDeductions.eobi}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Loan Deductions</TableCell>
                      <TableCell align="right">{formattedDeductions.loanDeductions}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Notice Period Deduction</TableCell>
                      <TableCell align="right">{formattedDeductions.noticePeriodDeduction}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Employee Security</TableCell>
                      <TableCell align="right">{formattedDeductions.security}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Health Insurance</TableCell>
                      <TableCell align="right">{formattedDeductions.healthInsurance}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Advance Deductions</TableCell>
                      <TableCell align="right">{formattedDeductions.advanceDeductions}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Pension</TableCell>
                      <TableCell align="right">{formattedDeductions.pension}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Other Deductions</TableCell>
                      <TableCell align="right">{formattedDeductions.otherDeductions}</TableCell>
                    </TableRow>
                    <TableRow sx={{ backgroundColor: 'error.light', color: 'white' }}>
                      <TableCell><strong>Total Deductions</strong></TableCell>
                      <TableCell align="right"><strong>{formattedDeductions.totalDeductions}</strong></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Loan Settlements */}
        {formattedLoans.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Loan Settlements</Typography>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Loan Type</TableCell>
                        <TableCell align="right">Original Amount</TableCell>
                        <TableCell align="right">Outstanding Balance</TableCell>
                        <TableCell align="right">Settled Amount</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {formattedLoans.map((loan, index) => (
                        <TableRow key={index}>
                          <TableCell>{loan.loanType}</TableCell>
                          <TableCell align="right">{loan.formattedOriginalAmount}</TableCell>
                          <TableCell align="right">{loan.formattedOutstandingBalance}</TableCell>
                          <TableCell align="right">{loan.formattedSettledAmount}</TableCell>
                          <TableCell>
                            <Chip
                              label={loan.settlementType.replace('_', ' ')}
                              size="small"
                              sx={{
                                backgroundColor: loan.settlementTypeColor,
                                color: 'white'
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Comments */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Comments & Notes</Typography>
                <Button
                  variant="outlined"
                  startIcon={<CommentIcon />}
                  onClick={() => setCommentDialog(true)}
                >
                  Add Comment
                </Button>
              </Box>
              
              {settlement.comments && settlement.comments.length > 0 ? (
                <List>
                  {settlement.comments.map((comment, index) => (
                    <ListItem key={index} alignItems="flex-start">
                      <ListItemAvatar>
                        <Avatar>
                          <PersonIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={typeof comment.user === 'object' ? comment.user.name || 'Unknown User' : 'Unknown User'}
                        secondary={
                          <Box>
                            <Typography variant="body2" color="textPrimary">
                              {comment.comment}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              {new Date(comment.timestamp).toLocaleString()}
                            </Typography>
                          </Box>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="textSecondary">
                  No comments yet
                </Typography>
              )}

              {settlement.notes && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Additional Notes:
                  </Typography>
                  <Typography variant="body2">
                    {settlement.notes}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Action Buttons */}
      <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'center' }}>
        {settlement.status === 'pending' && (
          <Button
            variant="contained"
            color="success"
            startIcon={<ApproveIcon />}
            onClick={() => handleAction('approve')}
            disabled={actionLoading}
          >
            Approve Settlement
          </Button>
        )}
        
        {settlement.status === 'approved' && (
          <Button
            variant="contained"
            color="secondary"
            startIcon={<ProcessIcon />}
            onClick={() => handleAction('process')}
            disabled={actionLoading}
          >
            Process Settlement
          </Button>
        )}
        
        {settlement.status === 'processed' && (
          <Button
            variant="contained"
            color="success"
            startIcon={<PaymentIcon />}
            onClick={() => handleAction('paid')}
            disabled={actionLoading}
          >
            Mark as Paid
          </Button>
        )}
        
        {settlement.status !== 'paid' && settlement.status !== 'cancelled' && (
          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            onClick={() => handleAction('cancel')}
            disabled={actionLoading}
          >
            Cancel Settlement
          </Button>
        )}
        
        {settlement.status === 'pending' && (
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => handleAction('delete')}
            disabled={actionLoading}
          >
            Delete Settlement
          </Button>
        )}
      </Box>

      {/* Comment Dialog */}
      <Dialog open={commentDialog} onClose={() => setCommentDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Comment</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Enter your comment..."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCommentDialog(false)}>Cancel</Button>
          <Button onClick={handleAddComment} variant="contained">
            Add Comment
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Alert
        open={snackbar.open}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        severity={snackbar.severity}
        sx={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999 }}
      >
        {snackbar.message}
      </Alert>
    </Box>
  );
};

export default FinalSettlementDetail; 