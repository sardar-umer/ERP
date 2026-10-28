import React, { useState, useEffect } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
  useTheme,
  alpha,
  CircularProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Stack
} from '@mui/material';
import {
  Inventory as InventoryIcon,
  ShoppingCart as ShoppingCartIcon,
  AttachMoney as AttachMoneyIcon,
  Visibility as ViewIcon,
  Close as CloseIcon,
  CalendarMonth as CalendarIcon,
  ExpandMore as ExpandMoreIcon,
  Print as PrintIcon,
  LocalShipping as CreateGRNIcon,
  Assignment as IndentIcon,
  Send as MoveToProcurementIcon,
  History as HistoryIcon,
  Topic as DeliveryChallanIcon
} from '@mui/icons-material';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import indentService from '../../../services/indentService';
import dayjs from 'dayjs';
import PODocumentView from './PODocumentView';
import WorkflowHistoryDialog from '../../../components/WorkflowHistoryDialog';
import { PO_A4_ONE_PAGE_PRINT_CSS, printPoFitToOneA4 } from '../../../utils/poA4PrintStyles';
import StoreStockOverview from '../../../components/Procurement/Store/StoreStockOverview';

const StoreDashboard = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groupedData, setGroupedData] = useState([]);
  const [summary, setSummary] = useState({ totalCount: 0, totalAmount: 0 });
  const [viewDialog, setViewDialog] = useState({ open: false, data: null });
  const [workflowHistoryDialog, setWorkflowHistoryDialog] = useState({ open: false, document: null });
  const [expandedMonths, setExpandedMonths] = useState({});
  const [pendingIndents, setPendingIndents] = useState([]);
  const [movingIndentId, setMovingIndentId] = useState(null);
  const [indentViewDialog, setIndentViewDialog] = useState({ open: false, indent: null });
  const [moveToProcurementDialog, setMoveToProcurementDialog] = useState({ open: false, indent: null, reason: '' });
  const [moveToProcurementError, setMoveToProcurementError] = useState('');
  const [sendPoToProcurementDialog, setSendPoToProcurementDialog] = useState({ open: false, po: null });
  const [sendingPoId, setSendingPoId] = useState(null);

  useEffect(() => {
    loadDashboardData();
    loadPendingIndents();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/procurement/store/dashboard');
      if (response.data.success) {
        setGroupedData(response.data.data.groupedByMonth);
        setSummary(response.data.data.summary);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load store dashboard data');
      console.error('Error loading store dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadPendingIndents = async () => {
    try {
      const response = await api.get('/procurement/store/pending-indents');
      if (response.data.success) {
        setPendingIndents(response.data.data || []);
      }
    } catch (err) {
      console.error('Error loading pending indents:', err);
    }
  };

  const openMoveToProcurementDialog = (indent) => {
    setMoveToProcurementError('');
    setMoveToProcurementDialog({ open: true, indent, reason: '' });
  };

  const handleMoveToProcurement = async () => {
    const { indent, reason } = moveToProcurementDialog;
    if (!indent?._id) return;
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) {
      setMoveToProcurementError('Please provide a reason for moving this indent to Procurement');
      return;
    }
    try {
      setMovingIndentId(indent._id);
      setMoveToProcurementError('');
      await indentService.moveToProcurement(indent._id, trimmedReason);
      setMoveToProcurementDialog({ open: false, indent: null, reason: '' });
      await loadPendingIndents();
      setIndentViewDialog((prev) => (prev.indent?._id === indent._id ? { open: false, indent: null } : prev));
      toast.success('Indent moved to Procurement Requisitions');
    } catch (err) {
      setMoveToProcurementError(err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Failed to move indent to Procurement');
    } finally {
      setMovingIndentId(null);
    }
  };

  const openSendPoToProcurementDialog = (po) => {
    setSendPoToProcurementDialog({ open: true, po });
  };

  const handleSendPoToProcurement = async () => {
    const { po } = sendPoToProcurementDialog;
    if (!po?._id) return;
    try {
      setSendingPoId(po._id);
      await api.post(`/procurement/store/po/${po._id}/send-to-procurement`);
      setSendPoToProcurementDialog({ open: false, po: null });
      await loadDashboardData();
      handleCloseView();
      toast.success('Purchase order sent to Procurement with GRN');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send to Procurement');
    } finally {
      setSendingPoId(null);
    }
  };

  const handleViewIndent = (indent) => {
    setIndentViewDialog({ open: true, indent });
  };

  const handleCloseIndentView = () => {
    setIndentViewDialog({ open: false, indent: null });
  };

  const formatPKR = (amount) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    return dayjs(date).format('DD-MMM-YYYY');
  };

  const getStatusColor = (status) => {
    const colors = {
      'Draft': 'default',
      'Pending Approval': 'warning',
      'Pending Audit': 'warning',
      'Pending Finance': 'info',
      'Send to CEO Office': 'info',
      'Forwarded to CEO': 'primary',
      'Approved': 'success',
      'Sent to Store': 'info',
      'GRN Created': 'success',
      'Sent to Procurement': 'primary',
      'Ordered': 'info',
      'Partially Received': 'secondary',
      'Received': 'success',
      'Cancelled': 'error',
      'Rejected': 'error',
      'Returned from Audit': 'error',
      'Returned from CEO Office': 'warning',
      'Returned from CEO Secretariat': 'error'
    };
    return colors[status] || 'default';
  };

  const getPriorityColor = (priority) => {
    const colors = {
      'Low': 'info',
      'Medium': 'default',
      'High': 'warning',
      'Urgent': 'error'
    };
    return colors[priority] || 'default';
  };

  const handleAccordionChange = (monthYear) => (event, isExpanded) => {
    setExpandedMonths(prev => ({
      ...prev,
      [monthYear]: isExpanded
    }));
  };

  const handleView = async (po) => {
    try {
      // Fetch full PO data with populated fields
      const response = await api.get(`/procurement/purchase-orders/${po._id}`);
      if (response.data.success) {
        setViewDialog({ open: true, data: response.data.data });
      } else {
        setViewDialog({ open: true, data: po });
      }
    } catch (err) {
      setViewDialog({ open: true, data: po });
    }
  };

  const handleCloseView = () => {
    setViewDialog({ open: false, data: null });
  };

  /** GRN from store: full-advance needs at least one QA-passed delivery challan; others need no PO QA. */
  const storeGrnActionAllowed = (po) => {
    if (!po) return false;
    if (!['Sent to Store', 'GRN Created', 'Partially Received'].includes(po.status)) return false;
    if (po.grnRequiresDeliveryChallan) return (po.qaPassedDeliveryChallanCount || 0) > 0;
    return true;
  };

  /** Full-advance PO with no delivery challan yet — prompt store to create one. */
  const dcAwaitingCreation = (po) =>
    !!po?.grnRequiresDeliveryChallan &&
    (po.qaPassedDeliveryChallanCount || 0) === 0 &&
    (po.dcPendingQaCount || 0) === 0;

  const dcAwaitingQa = (po) =>
    !!po?.grnRequiresDeliveryChallan && (po.dcPendingQaCount || 0) > 0;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 2,
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white'
              }}
            >
              <InventoryIcon fontSize="large" />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>
                Store Dashboard
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Stock at a glance, items waiting to be received, and approved indents to issue
              </Typography>
            </Box>
          </Box>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <StoreStockOverview />

      <Alert severity="info" sx={{ mb: 3 }} icon={<DeliveryChallanIcon />}>
        <Typography variant="body2" fontWeight={600} gutterBottom>
          Full-advance purchase orders
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          After a PO is sent to the store, create a <strong>delivery challan (DC)</strong> for it, complete <strong>DC QA</strong>, then post the <strong>GRN</strong>.
          Use <strong>Create DC</strong> on a row below, or open <RouterLink to="/procurement/store/delivery-challans">Delivery Challans</RouterLink>. QA is recorded in <RouterLink to="/procurement/store/delivery-challan-qa">DC Quality Check</RouterLink>.
        </Typography>
      </Alert>

      {/* Approved Indents - Stock Check (first destination after approval) */}
      {pendingIndents.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <IndentIcon color="primary" />
            Approved Indents – Stock Check
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Items are matched to store inventory by name. If all items are in stock, create a Store Issue Note; otherwise move to Procurement with a reason.
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                  <TableCell><strong>Indent #</strong></TableCell>
                  <TableCell><strong>Title</strong></TableCell>
                  <TableCell><strong>Department</strong></TableCell>
                  <TableCell><strong>Company</strong></TableCell>
                  <TableCell><strong>Approved Date</strong></TableCell>
                  <TableCell><strong>Items</strong></TableCell>
                  <TableCell><strong>Stock</strong></TableCell>
                  <TableCell align="center"><strong>Actions</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pendingIndents.map((indent) => (
                  <TableRow key={indent._id} hover>
                    <TableCell>{indent.indentNumber || 'N/A'}</TableCell>
                    <TableCell>{indent.title || 'N/A'}</TableCell>
                    <TableCell>{indent.department?.name || 'N/A'}</TableCell>
                    <TableCell>{indent.companyId?.name || '-'}</TableCell>
                    <TableCell>{formatDate(indent.approvedDate)}</TableCell>
                    <TableCell>{indent.items?.length || 0} item(s)</TableCell>
                    <TableCell>
                      {indent.allItemsInStock ? (
                        <Chip size="small" label="All in stock" color="success" />
                      ) : indent.someItemsInStock ? (
                        <Chip size="small" label="Partial" color="warning" />
                      ) : (
                        <Chip size="small" label="Not in stock" color="error" />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="View indent details">
                        <IconButton
                          size="small"
                          onClick={() => handleViewIndent(indent)}
                        >
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {indent.allItemsInStock && (
                        <Tooltip title="Create Store Issue Note for this indent">
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            sx={{ mr: 0.5 }}
                            onClick={() => navigate('/procurement/store/goods-issue', { state: { fromIndent: indent } })}
                          >
                            Create Issue Note
                          </Button>
                        </Tooltip>
                      )}
                      <Tooltip title={indent.allItemsInStock ? 'Move to Procurement (e.g. if not issuing from store)' : 'Move to Procurement – items not in store'}>
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={<MoveToProcurementIcon />}
                          onClick={() => openMoveToProcurementDialog(indent)}
                          disabled={movingIndentId === indent._id}
                        >
                          {movingIndentId === indent._id ? 'Moving...' : 'Move to Procurement'}
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card sx={{ background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)` }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Total Purchase Orders
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>
                    {summary.totalCount}
                  </Typography>
                </Box>
                <ShoppingCartIcon sx={{ fontSize: 48, color: theme.palette.primary.main, opacity: 0.3 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card sx={{ background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.1)} 0%, ${alpha(theme.palette.success.main, 0.05)} 100%)` }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Total Value
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.success.main }}>
                    {formatPKR(summary.totalAmount)}
                  </Typography>
                </Box>
                <AttachMoneyIcon sx={{ fontSize: 48, color: theme.palette.success.main, opacity: 0.3 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card sx={{ background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.1)} 0%, ${alpha(theme.palette.info.main, 0.05)} 100%)` }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Active Months
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.info.main }}>
                    {groupedData.length}
                  </Typography>
                </Box>
                <CalendarIcon sx={{ fontSize: 48, color: theme.palette.info.main, opacity: 0.3 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Grouped by Month/Year */}
      {groupedData.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <InventoryIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="textSecondary">
            No Purchase Orders sent to Store yet
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            Purchase Orders with status "Sent to Store" will appear here
          </Typography>
        </Paper>
      ) : (
        groupedData.map((monthGroup) => (
          <Accordion
            key={monthGroup.monthYear}
            expanded={expandedMonths[monthGroup.monthYear] !== undefined ? expandedMonths[monthGroup.monthYear] : true}
            onChange={handleAccordionChange(monthGroup.monthYear)}
            sx={{ mb: 2 }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.05),
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.08)
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', mr: 2 }}>
                <CalendarIcon sx={{ color: theme.palette.primary.main }} />
                <Typography variant="h6" sx={{ fontWeight: 'bold', color: theme.palette.primary.main, flexGrow: 1 }}>
                  {monthGroup.monthYearLabel}
                </Typography>
                <Chip
                  label={`${monthGroup.count} PO${monthGroup.count !== 1 ? 's' : ''}`}
                  color="primary"
                  size="small"
                  sx={{ mr: 1 }}
                />
                <Chip
                  label={formatPKR(monthGroup.totalAmount)}
                  color="success"
                  size="small"
                />
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                      <TableCell><strong>Order Number</strong></TableCell>
                      <TableCell><strong>Vendor</strong></TableCell>
                      <TableCell><strong>Order Date</strong></TableCell>
                      <TableCell><strong>Expected Delivery</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell><strong>DC &amp; next step</strong></TableCell>
                      <TableCell><strong>Store</strong></TableCell>
                      <TableCell><strong>Priority</strong></TableCell>
                      <TableCell align="right"><strong>Total Amount</strong></TableCell>
                      <TableCell align="center"><strong>Actions</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {monthGroup.purchaseOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} align="center">
                          <Typography variant="body2" color="textSecondary">
                            No purchase orders found for this month
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      monthGroup.purchaseOrders.map((po) => (
                        <TableRow key={po._id} hover>
                          <TableCell>{po.orderNumber || 'N/A'}</TableCell>
                          <TableCell>{po.vendor?.name || 'Unknown Vendor'}</TableCell>
                          <TableCell>{formatDate(po.orderDate)}</TableCell>
                          <TableCell>{formatDate(po.expectedDeliveryDate)}</TableCell>
                          <TableCell>
                            <Chip
                              label={po.status}
                              color={getStatusColor(po.status)}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>
                            {!po.grnRequiresDeliveryChallan ? (
                              <Typography variant="caption" color="text.secondary">—</Typography>
                            ) : (
                              <Stack spacing={0.75} alignItems="flex-start">
                                <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
                                  {(po.qaPassedDeliveryChallanCount || 0) > 0 && (
                                    <Chip size="small" label={`Passed: ${po.qaPassedDeliveryChallanCount}`} color="success" variant="outlined" />
                                  )}
                                  {(po.dcPendingQaCount || 0) > 0 && (
                                    <Chip size="small" label={`QA pending: ${po.dcPendingQaCount}`} color="warning" variant="outlined" />
                                  )}
                                </Stack>
                                {dcAwaitingCreation(po) && (
                                  <Button
                                    size="small"
                                    variant="contained"
                                    color="warning"
                                    startIcon={<DeliveryChallanIcon />}
                                    onClick={() => navigate(`/procurement/store/delivery-challans?purchaseOrder=${po._id}&openCreate=1`)}
                                  >
                                    Create DC
                                  </Button>
                                )}
                                {dcAwaitingQa(po) && (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="warning"
                                    startIcon={<DeliveryChallanIcon />}
                                    onClick={() => navigate('/procurement/store/delivery-challan-qa')}
                                  >
                                    Pass DC QA
                                  </Button>
                                )}
                                {!dcAwaitingCreation(po) && !dcAwaitingQa(po) && po.grnRequiresDeliveryChallan && (
                                  <Button
                                    size="small"
                                    variant="text"
                                    startIcon={<DeliveryChallanIcon />}
                                    onClick={() => navigate(`/procurement/store/delivery-challans?purchaseOrder=${po._id}`)}
                                  >
                                    Delivery challans
                                  </Button>
                                )}
                              </Stack>
                            )}
                          </TableCell>
                          <TableCell>
                            {po.storeSnapshot
                              ? <Chip label={po.storeSnapshot} size="small" variant="outlined" icon={<span style={{ fontSize: 12 }}>🏪</span>} />
                              : <Typography variant="caption" color="text.secondary">—</Typography>
                            }
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={po.priority || 'Medium'}
                              color={getPriorityColor(po.priority || 'Medium')}
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="right">{formatPKR(po.totalAmount || 0)}</TableCell>
                          <TableCell align="center">
                            <Tooltip title="View">
                              <IconButton size="small" onClick={() => handleView(po)}>
                                <ViewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            {storeGrnActionAllowed(po) && (
                              <Tooltip title="Create GRN">
                                <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={() => navigate(`/procurement/store/goods-receive?createFromPo=${po._id}`)}
                                >
                                  <CreateGRNIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            {po.status === 'GRN Created' && (
                              <Tooltip title="Send to Procurement">
                                <IconButton
                                  size="small"
                                  color="success"
                                  onClick={() => openSendPoToProcurementDialog(po)}
                                >
                                  <MoveToProcurementIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>
        ))
      )}

      {/* View Dialog */}
      <Dialog 
        open={viewDialog.open} 
        onClose={handleCloseView}
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: {
            width: '90%',
            maxWidth: '210mm',
            maxHeight: '95vh',
            m: 2,
            '@media print': {
              boxShadow: 'none',
              maxWidth: '100%',
              margin: 0,
              height: '100%',
              width: '100%',
              maxHeight: '100%'
            }
          }
        }}
      >
        <DialogTitle sx={{ '@media print': { display: 'none' }, pb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h6">Purchase Order Details</Typography>
              {viewDialog.data && (
                <Chip
                  label={
                    viewDialog.data.grnRequiresDeliveryChallan
                      ? `DC — passed: ${viewDialog.data.qaPassedDeliveryChallanCount ?? 0}, QA pending: ${viewDialog.data.dcPendingQaCount ?? 0}`
                      : 'GRN: no DC required'
                  }
                  color={
                    viewDialog.data.grnRequiresDeliveryChallan
                      ? ((viewDialog.data.qaPassedDeliveryChallanCount || 0) > 0 ? 'success' : 'warning')
                      : 'default'
                  }
                  size="small"
                />
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<HistoryIcon />}
                onClick={() => setWorkflowHistoryDialog({ open: true, document: viewDialog.data })}
              >
                See Workflow History
              </Button>
              <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={() => printPoFitToOneA4()}>
                Print
              </Button>
              {viewDialog.data && (
                <Button
                  size="small"
                  variant={dcAwaitingCreation(viewDialog.data) ? 'contained' : 'outlined'}
                  color={dcAwaitingCreation(viewDialog.data) ? 'warning' : 'inherit'}
                  startIcon={<DeliveryChallanIcon />}
                  onClick={() => {
                    const q = dcAwaitingCreation(viewDialog.data) ? '&openCreate=1' : '';
                    navigate(`/procurement/store/delivery-challans?purchaseOrder=${viewDialog.data._id}${q}`);
                    handleCloseView();
                  }}
                >
                  {dcAwaitingCreation(viewDialog.data) ? 'Create delivery challan' : 'Delivery challans'}
                </Button>
              )}
              {viewDialog.data && storeGrnActionAllowed(viewDialog.data) && (
                <Button size="small" variant="contained" startIcon={<CreateGRNIcon />} onClick={() => { handleCloseView(); navigate(`/procurement/store/goods-receive?createFromPo=${viewDialog.data._id}`); }}>
                  Create GRN
                </Button>
              )}
              {viewDialog.data && viewDialog.data.status === 'GRN Created' && (
                <Button size="small" variant="contained" color="success" startIcon={<MoveToProcurementIcon />} onClick={() => openSendPoToProcurementDialog(viewDialog.data)}>
                  Send to Procurement
                </Button>
              )}
              <IconButton onClick={handleCloseView} size="small">
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0, overflow: 'auto', '@media print': { p: 0, overflow: 'visible' } }}>
          {viewDialog.data && dcAwaitingCreation(viewDialog.data) && (
            <Alert severity="warning" sx={{ m: 2, mb: 0 }}>
              This full-advance PO needs a <strong>delivery challan</strong> before GRN. Use <strong>Create delivery challan</strong> above, or go to Delivery challans and create one for this PO.
            </Alert>
          )}
          {viewDialog.data && dcAwaitingQa(viewDialog.data) && (
            <Alert severity="info" sx={{ m: 2, mb: 0 }}>
              One or more delivery challans are <strong>awaiting DC QA</strong>. Open Delivery challans for this PO and pass or fail QA before posting a GRN.
            </Alert>
          )}
          {viewDialog.data && (
            <Box sx={{ width: '100%' }} className="print-content">
              <PODocumentView data={viewDialog.data} />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ '@media print': { display: 'none' } }}>
          <Button onClick={handleCloseView}>Close</Button>
        </DialogActions>
      </Dialog>

      <WorkflowHistoryDialog
        open={workflowHistoryDialog.open}
        onClose={() => setWorkflowHistoryDialog({ open: false, document: null })}
        document={workflowHistoryDialog.document}
      />

      {/* Indent Detail View Dialog (Approved Indents – Stock Check) */}
      <Dialog
        open={indentViewDialog.open}
        onClose={handleCloseIndentView}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { maxHeight: '90vh' } }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
          <Typography variant="h6">Indent Details</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {indentViewDialog.indent?.allItemsInStock && (
              <Button
                size="small"
                variant="outlined"
                color="success"
                onClick={() => { navigate('/procurement/store/goods-issue', { state: { fromIndent: indentViewDialog.indent } }); handleCloseIndentView(); }}
              >
                Create Issue Note
              </Button>
            )}
            {indentViewDialog.indent && (
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<MoveToProcurementIcon />}
                onClick={() => openMoveToProcurementDialog(indentViewDialog.indent)}
                disabled={movingIndentId === indentViewDialog.indent?._id}
              >
                {movingIndentId === indentViewDialog.indent?._id ? 'Moving...' : 'Move to Procurement'}
              </Button>
            )}
            <IconButton size="small" onClick={handleCloseIndentView}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {indentViewDialog.indent && (
            <Box>
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">Indent #</Typography>
                  <Typography variant="body1" fontWeight={600}>{indentViewDialog.indent.indentNumber || 'N/A'}</Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">ERP Ref</Typography>
                  <Typography variant="body1">{indentViewDialog.indent.erpRef || 'N/A'}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="caption" color="textSecondary">Title</Typography>
                  <Typography variant="body1">{indentViewDialog.indent.title || 'N/A'}</Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">Department</Typography>
                  <Typography variant="body1">{indentViewDialog.indent.department?.name || 'N/A'}</Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">Originator (Requested By)</Typography>
                  <Typography variant="body1">
                    {indentViewDialog.indent.requestedBy?.firstName} {indentViewDialog.indent.requestedBy?.lastName}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">Requested Date</Typography>
                  <Typography variant="body1">{formatDate(indentViewDialog.indent.requestedDate)}</Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">Required Date</Typography>
                  <Typography variant="body1">{formatDate(indentViewDialog.indent.requiredDate)}</Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">Approved By</Typography>
                  <Typography variant="body1">
                    {indentViewDialog.indent.approvedBy?.firstName} {indentViewDialog.indent.approvedBy?.lastName}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">Approved Date</Typography>
                  <Typography variant="body1">{formatDate(indentViewDialog.indent.approvedDate)}</Typography>
                </Grid>
                {indentViewDialog.indent.justification && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="textSecondary">Justification</Typography>
                    <Typography variant="body1">{indentViewDialog.indent.justification}</Typography>
                  </Grid>
                )}
              </Grid>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Items</Typography>
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      <TableCell><strong>#</strong></TableCell>
                      <TableCell><strong>Item Name</strong></TableCell>
                      <TableCell><strong>Description</strong></TableCell>
                      <TableCell align="right"><strong>Qty</strong></TableCell>
                      <TableCell><strong>Unit</strong></TableCell>
                      <TableCell><strong>In Store</strong></TableCell>
                      <TableCell><strong>Purpose</strong></TableCell>
                      <TableCell align="right"><strong>Est. Cost</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(indentViewDialog.indent.items || []).map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{idx + 1}</TableCell>
                        <TableCell>{item.itemName || '-'}</TableCell>
                        <TableCell>{item.description || '-'}</TableCell>
                        <TableCell align="right">{item.quantity || 0}</TableCell>
                        <TableCell>{item.unit || 'Piece'}</TableCell>
                        <TableCell>
                          {item.inStock ? (
                            <Chip size="small" label={`In stock (${item.availableQuantity} available)`} color="success" />
                          ) : item.inventoryMatch ? (
                            <Chip size="small" label={`Low stock (${item.availableQuantity} available)`} color="warning" />
                          ) : (
                            <Chip size="small" label="Not in store" color="error" />
                          )}
                        </TableCell>
                        <TableCell>{item.purpose || '-'}</TableCell>
                        <TableCell align="right">{formatPKR(item.estimatedCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {indentViewDialog.indent.totalEstimatedCost > 0 && (
                <Typography variant="body2" sx={{ mt: 2 }} fontWeight={600}>
                  Total Estimated Cost: {formatPKR(indentViewDialog.indent.totalEstimatedCost)}
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Move to Procurement – reason required */}
      <Dialog
        open={moveToProcurementDialog.open}
        onClose={() => { setMoveToProcurementDialog({ open: false, indent: null, reason: '' }); setMoveToProcurementError(''); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Move to Procurement</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Please provide the reason for moving this indent to Procurement (e.g. items not in stock).
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Reason (required)"
            value={moveToProcurementDialog.reason}
            onChange={(e) => setMoveToProcurementDialog((prev) => ({ ...prev, reason: e.target.value }))}
            placeholder="e.g. Items not available in store..."
            error={!!moveToProcurementError}
            helperText={moveToProcurementError}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setMoveToProcurementDialog({ open: false, indent: null, reason: '' }); setMoveToProcurementError(''); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleMoveToProcurement}
            disabled={movingIndentId !== null || !(moveToProcurementDialog.reason || '').trim()}
          >
            {movingIndentId ? 'Moving...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Send PO to Procurement confirmation dialog */}
      <Dialog
        open={sendPoToProcurementDialog.open}
        onClose={() => setSendPoToProcurementDialog({ open: false, po: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Send to Procurement</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            This Purchase Order has GRN created. Sending to Procurement will make the PO and its GRN visible in the Procurement module.
          </Typography>
          {sendPoToProcurementDialog.po && (
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              PO: {sendPoToProcurementDialog.po.orderNumber || sendPoToProcurementDialog.po._id}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendPoToProcurementDialog({ open: false, po: null })}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleSendPoToProcurement}
            disabled={!!sendingPoId}
            startIcon={sendingPoId ? <CircularProgress size={16} /> : <MoveToProcurementIcon />}
          >
            {sendingPoId ? 'Sending...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      <Box
        component="style"
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              body * {
                visibility: hidden;
              }
              .MuiDialog-container,
              .MuiDialog-container *,
              .MuiDialog-paper,
              .MuiDialog-paper *,
              .print-content,
              .print-content * {
                visibility: visible;
              }
              .MuiDialog-container {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                height: 100% !important;
                display: block !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: visible !important;
              }
              .MuiDialog-paper {
                box-shadow: none !important;
                margin: 0 !important;
                max-width: 100% !important;
                width: 100% !important;
                height: auto !important;
                max-height: none !important;
                position: relative !important;
                transform: none !important;
                overflow: visible !important;
              }
              .MuiDialogContent-root {
                overflow: visible !important;
                padding: 0 !important;
                height: auto !important;
                max-height: none !important;
                margin: 0 !important;
              }
              .MuiDialogTitle-root {
                display: none !important;
              }
              .MuiDialogActions-root {
                display: none !important;
              }
              .MuiBackdrop-root {
                display: none !important;
              }
              .MuiPaper-root {
                box-shadow: none !important;
              }
              ${PO_A4_ONE_PAGE_PRINT_CSS}
            }
          `
        }}
      />
    </Box>
  );
};

export default StoreDashboard;
