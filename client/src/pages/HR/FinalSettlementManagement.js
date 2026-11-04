import React, { useState, useEffect } from 'react';
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
  Chip,
  IconButton,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  Tooltip,
  Fab
} from '@mui/material';
import {
  Add as AddIcon,
  Visibility as ViewIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as ProcessIcon,
  Payment as PaymentIcon,
  Cancel as CancelIcon,
  Assessment as StatsIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  Send as ForwardIcon,
  FactCheck as WorkflowIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import finalSettlementService from '../../services/finalSettlementService';
import {
  ForwardSettlementDialog,
  SettlementProcessDialog,
  WORKFLOW_COLORS,
  workflowLabel,
  canForward,
  IN_APPROVAL
} from '../../components/HR/FinalSettlementWorkflow';

const FinalSettlementManagement = () => {
  const navigate = useNavigate();
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState({
    status: '',
    settlementType: '',
    department: '',
    search: '',
    startDate: '',
    endDate: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [forwardFor, setForwardFor] = useState(null);
  const [processFor, setProcessFor] = useState(null);
  const [workflowMe, setWorkflowMe] = useState({ isAdmin: false, isCeoApprover: false });

  useEffect(() => {
    finalSettlementService.getWorkflowMe().then((r) => setWorkflowMe(r.data || {})).catch(() => {});
  }, []);

  const workflowDone = (message) => {
    setForwardFor(null);
    setProcessFor(null);
    setSnackbar({ open: true, message, severity: 'success' });
    loadSettlements();
  };

  // Load settlements
  const loadSettlements = async () => {
    try {
      setLoading(true);
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        ...filters
      };
      
      const response = await finalSettlementService.getSettlements(params);
      setSettlements(response.data.docs || []);
      setTotalCount(response.data.totalDocs || 0);
    } catch (error) {
      console.error('Error loading settlements:', error);
      setSnackbar({
        open: true,
        message: 'Error loading settlements',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettlements();
  }, [page, rowsPerPage, filters]);

  // Handle page change
  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  // Handle rows per page change
  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Handle filter changes
  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
    setPage(0);
  };

  // Handle settlement actions
  const handleAction = async (action, settlementId) => {
    try {
      switch (action) {
        case 'approve':
          await finalSettlementService.approveSettlement(settlementId);
          setSnackbar({
            open: true,
            message: 'Settlement approved successfully',
            severity: 'success'
          });
          break;
        case 'process':
          await finalSettlementService.processSettlement(settlementId);
          setSnackbar({
            open: true,
            message: 'Settlement processed successfully',
            severity: 'success'
          });
          break;
        case 'paid':
          await finalSettlementService.markAsPaid(settlementId);
          setSnackbar({
            open: true,
            message: 'Settlement marked as paid successfully',
            severity: 'success'
          });
          break;
        case 'cancel':
          await finalSettlementService.cancelSettlement(settlementId);
          setSnackbar({
            open: true,
            message: 'Settlement cancelled successfully',
            severity: 'success'
          });
          break;
        case 'delete':
          await finalSettlementService.deleteSettlement(settlementId);
          setSnackbar({
            open: true,
            message: 'Settlement deleted successfully',
            severity: 'success'
          });
          break;
        default:
          break;
      }
      loadSettlements();
    } catch (error) {
      console.error(`Error performing ${action}:`, error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || `Error performing ${action}`,
        severity: 'error'
      });
    }
  };

  // Get action buttons for each settlement
  const getActionButtons = (settlement) => {
    const buttons = [];

    // View button
    buttons.push(
      <Tooltip key="view" title="View Details">
        <IconButton
          size="small"
          onClick={() => navigate(`/hr/settlements/${settlement._id}`)}
          color="primary"
        >
          <ViewIcon />
        </IconButton>
      </Tooltip>
    );

    // Process: details + approval trail (Approve / Return when it is this user's turn)
    buttons.push(
      <Tooltip key="workflow" title={settlement.myWorkflowRole ? 'Your approval is needed' : 'Process — details & approvals'}>
        <IconButton size="small" color={settlement.myWorkflowRole ? 'warning' : 'info'} onClick={() => setProcessFor(settlement)}>
          <WorkflowIcon />
        </IconButton>
      </Tooltip>
    );

    // Status-specific actions
    const inApproval = IN_APPROVAL.includes(settlement.workflowStatus);
    const lockedTip = `Locked: ${workflowLabel(settlement)}`;
    switch (settlement.status) {
      case 'pending':
        if (canForward(settlement)) {
          buttons.push(
            <Tooltip key="forward" title="Forward for approval (GM HR → AVP → CEO)">
              <IconButton size="small" color="primary" onClick={() => setForwardFor(settlement)}>
                <ForwardIcon />
              </IconButton>
            </Tooltip>
          );
        }
        buttons.push(
          <Tooltip key="edit" title={inApproval && !workflowMe.isAdmin ? lockedTip : 'Edit Settlement'}>
            <span>
              <IconButton
                size="small"
                disabled={inApproval && !workflowMe.isAdmin}
                onClick={() => navigate(`/hr/settlements/${settlement._id}/edit`)}
                color="primary"
              >
                <EditIcon />
              </IconButton>
            </span>
          </Tooltip>
        );
        buttons.push(
          <Tooltip key="delete" title={inApproval ? lockedTip : 'Delete Settlement'}>
            <span>
              <IconButton
                size="small"
                disabled={inApproval}
                onClick={() => handleAction('delete', settlement._id)}
                color="error"
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
        );
        break;
      case 'approved':
        buttons.push(
          <Tooltip key="process" title="Process Settlement">
            <IconButton
              size="small"
              onClick={() => handleAction('process', settlement._id)}
              color="secondary"
            >
              <ProcessIcon />
            </IconButton>
          </Tooltip>
        );
        break;
      case 'processed':
        buttons.push(
          <Tooltip key="paid" title="Mark as Paid">
            <IconButton
              size="small"
              onClick={() => handleAction('paid', settlement._id)}
              color="success"
            >
              <PaymentIcon />
            </IconButton>
          </Tooltip>
        );
        break;
      default:
        break;
    }

    // Cancel button (for non-paid settlements)
    if (settlement.status !== 'paid' && settlement.status !== 'cancelled') {
      buttons.push(
        <Tooltip key="cancel" title="Cancel Settlement">
          <IconButton
            size="small"
            onClick={() => handleAction('cancel', settlement._id)}
            color="error"
          >
            <CancelIcon />
          </IconButton>
        </Tooltip>
      );
    }

    return buttons;
  };

  // Clear filters
  const clearFilters = () => {
    setFilters({
      status: '',
      settlementType: '',
      department: '',
      search: '',
      startDate: '',
      endDate: ''
    });
    setPage(0);
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Final Settlement Management
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<StatsIcon />}
            onClick={() => navigate('/hr/settlements/statistics')}
            sx={{ mr: 2 }}
          >
            Statistics
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/hr/settlements/new')}
          >
            New Settlement
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <FilterIcon sx={{ mr: 1 }} />
          <Typography variant="h6">Filters</Typography>
          <Button
            size="small"
            onClick={() => setShowFilters(!showFilters)}
            sx={{ ml: 'auto' }}
          >
            {showFilters ? 'Hide' : 'Show'} Filters
          </Button>
        </Box>

        {showFilters && (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="Search"
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                placeholder="Employee name, ID, or reason"
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                  label="Status"
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="approved">Approved</MenuItem>
                  <MenuItem value="processed">Processed</MenuItem>
                  <MenuItem value="paid">Paid</MenuItem>
                  <MenuItem value="cancelled">Cancelled</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth>
                <InputLabel>Type</InputLabel>
                <Select
                  value={filters.settlementType}
                  onChange={(e) => handleFilterChange('settlementType', e.target.value)}
                  label="Type"
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="resignation">Resignation</MenuItem>
                  <MenuItem value="termination">Termination</MenuItem>
                  <MenuItem value="retirement">Retirement</MenuItem>
                  <MenuItem value="contract_end">Contract End</MenuItem>
                  <MenuItem value="death">Death</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <TextField
                fullWidth
                label="Department"
                value={filters.department}
                onChange={(e) => handleFilterChange('department', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                type="date"
                label="From Date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                type="date"
                label="To Date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={clearFilters}
                >
                  Clear Filters
                </Button>
                <Button
                  variant="contained"
                  onClick={loadSettlements}
                >
                  Apply Filters
                </Button>
              </Box>
            </Grid>
          </Grid>
        )}
      </Paper>

      {/* Statistics Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Settlements
              </Typography>
              <Typography variant="h4">
                {totalCount}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Pending
              </Typography>
              <Typography variant="h4" color="warning.main">
                {settlements.filter(s => s.status === 'pending').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Approved
              </Typography>
              <Typography variant="h4" color="info.main">
                {settlements.filter(s => s.status === 'approved').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Paid
              </Typography>
              <Typography variant="h4" color="success.main">
                {settlements.filter(s => s.status === 'paid').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Settlements Table */}
      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last Working Date</TableCell>
                <TableCell>Gross Amount</TableCell>
                <TableCell>Net Amount</TableCell>
                <TableCell>Progress</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <LinearProgress />
                  </TableCell>
                </TableRow>
              ) : settlements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography variant="body1" color="textSecondary">
                      No settlements found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                settlements.map((settlement) => (
                  <TableRow key={settlement._id} hover>
                    <TableCell>
                      <Box>
                        <Typography variant="subtitle2">
                          {settlement.employeeName}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {String(settlement.employeeId || '')} • {String(settlement.department || '')}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={finalSettlementService.getSettlementTypeLabel(settlement.settlementType)}
                        size="small"
                        sx={{
                          backgroundColor: finalSettlementService.getSettlementTypeColor(settlement.settlementType),
                          color: 'white'
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-start' }}>
                        <Chip
                          label={finalSettlementService.getStatusLabel(settlement.status)}
                          size="small"
                          sx={{
                            backgroundColor: finalSettlementService.getStatusColor(settlement.status),
                            color: 'white'
                          }}
                        />
                        {settlement.status === 'pending' && (
                          <Chip
                            label={workflowLabel(settlement)}
                            size="small"
                            variant="outlined"
                            color={WORKFLOW_COLORS[settlement.workflowStatus || 'Draft']}
                          />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      {new Date(settlement.lastWorkingDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {finalSettlementService.formatSettlementData(settlement).formattedGrossAmount}
                    </TableCell>
                    <TableCell>
                      {finalSettlementService.formatSettlementData(settlement).formattedNetAmount}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Box sx={{ width: '100%', mr: 1 }}>
                          <LinearProgress
                            variant="determinate"
                            value={finalSettlementService.calculateProgress(settlement)}
                            sx={{ height: 8, borderRadius: 4 }}
                          />
                        </Box>
                        <Box sx={{ minWidth: 35 }}>
                          <Typography variant="body2" color="textSecondary">
                            {Math.round(finalSettlementService.calculateProgress(settlement))}%
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {getActionButtons(settlement)}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[5, 10, 25, 50]}
          component="div"
          count={totalCount}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      </Paper>

      {/* Floating Action Button */}
      <Fab
        color="primary"
        aria-label="add"
        sx={{ position: 'fixed', bottom: 16, right: 16 }}
        onClick={() => navigate('/hr/settlements/new')}
      >
        <AddIcon />
      </Fab>

      {/* Snackbar */}
      <ForwardSettlementDialog settlement={forwardFor} onClose={() => setForwardFor(null)} onDone={workflowDone} />
      <SettlementProcessDialog
        settlement={processFor}
        onClose={() => setProcessFor(null)}
        onDone={workflowDone}
        onEdit={(st) => navigate(`/hr/settlements/${st._id}/edit`)}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default FinalSettlementManagement; 