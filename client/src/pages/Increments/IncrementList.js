import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Tooltip,
  DialogContentText
} from '@mui/material';
import {
  Add as AddIcon,
  Visibility as ViewIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  TrendingUp as TrendingUpIcon,
  History as HistoryIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import incrementService from '../../services/incrementService';
import useClientPagination from '../../hooks/useClientPagination';

const IncrementList = () => {
  const navigate = useNavigate();
  const [increments, setIncrements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionDialog, setActionDialog] = useState({ open: false, type: '', increment: null });
  const [comments, setComments] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  
  const filteredIncrements = increments.filter(inc => {
    const incDate = new Date(inc.requestDate);
    return (incDate.getMonth() + 1 === selectedMonth) && (incDate.getFullYear() === selectedYear);
  });
  
  // Delete Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedIncrementForDelete, setSelectedIncrementForDelete] = useState(null);

  useEffect(() => {
    fetchPendingIncrements();
  }, []);

  const fetchPendingIncrements = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('🔍 Fetching all increments...');
      
      const response = await incrementService.getAllIncrements();
      console.log('📊 API Response:', response);
      
      if (response.success) {
        setIncrements(response.data);
        console.log('✅ Increments fetched successfully:', response.data);
      } else {
        console.error('❌ API returned error:', response.error);
        setError(response.error || 'Failed to fetch increments');
      }
    } catch (error) {
      console.error('❌ Error fetching increments:', error);
      console.error('Error details:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      let errorMessage = 'Failed to fetch increments';
      if (error.response?.status === 401) {
        errorMessage = 'Authentication required. Please login again.';
      } else if (error.response?.status === 403) {
        errorMessage = 'Access denied. You do not have permission to view increments.';
      } else if (error.response?.status === 404) {
        errorMessage = 'Increment service not found.';
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    try {
      setActionLoading(true);
      const response = await incrementService.approveIncrement(actionDialog.increment._id, comments);
      if (response.success) {
        setActionDialog({ open: false, type: '', increment: null });
        setComments('');
        fetchPendingIncrements();
      }
    } catch (error) {
      console.error('Error approving increment:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    try {
      setActionLoading(true);
      const response = await incrementService.rejectIncrement(actionDialog.increment._id, comments);
      if (response.success) {
        setActionDialog({ open: false, type: '', increment: null });
        setComments('');
        fetchPendingIncrements();
      }
    } catch (error) {
      console.error('Error rejecting increment:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteClick = (increment) => {
    setSelectedIncrementForDelete(increment);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedIncrementForDelete) return;
    try {
      setLoading(true);
      const response = await incrementService.deleteIncrement(selectedIncrementForDelete._id);
      if (response.success) {
        fetchPendingIncrements();
        setDeleteDialogOpen(false);
        setSelectedIncrementForDelete(null);
      } else {
        setError(response.error || 'Failed to delete increment');
      }
    } catch (error) {
      console.error('Error deleting increment:', error);
      setError('An error occurred while deleting the increment');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setSelectedIncrementForDelete(null);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'warning';
      case 'approved': return 'success';
      case 'rejected': return 'error';
      case 'implemented': return 'info';
      default: return 'default';
    }
  };

  const getIncrementTypeColor = (type) => {
    switch (type) {
      case 'annual': return 'primary';
      case 'performance': return 'success';
      case 'special': return 'secondary';
      case 'market_adjustment': return 'info';
      default: return 'default';
    }
  };

  const pg = useClientPagination(filteredIncrements);
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          <TrendingUpIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Employee Increments
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<HistoryIcon />}
            onClick={() => navigate('/hr/increments/history')}
            sx={{ mr: 1 }}
          >
            View History
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/hr/increments/create')}
          >
            Create Increment
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Filters */}
      <Box display="flex" gap={2} mb={3}>
        <TextField
          select
          label="Month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
            <MenuItem key={month} value={month}>
              {new Date(2000, month - 1, 1).toLocaleString('default', { month: 'long' })}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Year"
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          sx={{ minWidth: 120 }}
        >
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Pending Requests
              </Typography>
              <Typography variant="h4">
                {filteredIncrements.filter(inc => inc.status === 'pending').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Requests
              </Typography>
              <Typography variant="h4">
                {filteredIncrements.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Average Increment
              </Typography>
              <Typography variant="h4">
                {filteredIncrements.length > 0 
                  ? `Rs. ${Math.round(filteredIncrements.reduce((sum, inc) => sum + inc.incrementAmount, 0) / filteredIncrements.length).toLocaleString()}`
                  : 'Rs. 0'
                }
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Amount
              </Typography>
              <Typography variant="h4">
                Rs. {filteredIncrements.reduce((sum, inc) => sum + inc.incrementAmount, 0).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Increments Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            All Increment Requests
          </Typography>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Previous Salary</TableCell>
                  <TableCell>New Salary</TableCell>
                  <TableCell>Increment</TableCell>
                  <TableCell>Percentage</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Request Date</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((increment) => (
                  <TableRow key={increment._id}>
                    <TableCell>
                      <Box>
                        <Typography variant="subtitle2">
                          {increment.employee?.firstName} {increment.employee?.lastName}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {increment.employee?.employeeId}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={increment.incrementType}
                        color={getIncrementTypeColor(increment.incrementType)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      Rs. {increment.previousSalary.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      Rs. {increment.newSalary.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      Rs. {increment.incrementAmount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {increment.incrementPercentage}%
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={increment.status}
                        color={getStatusColor(increment.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      {new Date(increment.requestDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Box display="flex" gap={1}>
                        <Tooltip title="View Details">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/hr/increments/${increment._id}`)}
                          >
                            <ViewIcon />
                          </IconButton>
                        </Tooltip>
                        {increment.status === 'pending' && (
                          <>
                            <Tooltip title="Approve">
                              <IconButton
                                size="small"
                                color="success"
                                onClick={() => setActionDialog({ open: true, type: 'approve', increment })}
                              >
                                <ApproveIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Reject">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => setActionDialog({ open: true, type: 'reject', increment })}
                              >
                                <RejectIcon />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteClick(increment)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog
        open={actionDialog.open}
        onClose={() => setActionDialog({ open: false, type: '', increment: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {actionDialog.type === 'approve' ? 'Approve Increment' : 'Reject Increment'}
        </DialogTitle>
        <DialogContent>
          {actionDialog.increment && (
            <Box mb={2}>
              <Typography variant="body2" color="textSecondary">
                Employee: {actionDialog.increment.employee?.firstName} {actionDialog.increment.employee?.lastName}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Increment: Rs. {actionDialog.increment.incrementAmount.toLocaleString()} ({actionDialog.increment.incrementPercentage}%)
              </Typography>
            </Box>
          )}
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={`Enter comments for ${actionDialog.type}...`}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setActionDialog({ open: false, type: '', increment: null })}
            disabled={actionLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={actionDialog.type === 'approve' ? handleApprove : handleReject}
            color={actionDialog.type === 'approve' ? 'success' : 'error'}
            variant="contained"
            disabled={actionLoading}
          >
            {actionLoading ? <CircularProgress size={20} /> : actionDialog.type === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleCloseDeleteDialog}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this increment for <b>{selectedIncrementForDelete?.employee?.firstName} {selectedIncrementForDelete?.employee?.lastName}</b>?
            <br /><br />
            {['implemented', 'approved'].includes(selectedIncrementForDelete?.status) && (
              <span style={{ color: 'red' }}>
                <b>Warning:</b> Since this increment was {selectedIncrementForDelete.status}, deleting it will reverse its effect. The employee's current salary and any upcoming payrolls will be reduced by Rs. {selectedIncrementForDelete?.incrementAmount?.toLocaleString()}.
              </span>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteDialog}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default IncrementList;
