import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Tooltip,
  Chip,
  Alert,
  Stack,
  Divider,
  Grid,
  Checkbox,
  FormControlLabel,
  List,
  ListItem,
  CircularProgress,
  Tabs,
  Tab,
  Popover
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Cancel as RejectIcon,
  Email as EmailIcon,
  Print as PrintIcon,
  ArticleOutlined as ArticleOutlinedIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import StoreVettingNotice from '../../components/Procurement/StoreVettingNotice';
import {
  getQuoteItemForIndentItem,
  getQuoteLineAmount,
  isBlankQuoteItem
} from '../../utils/comparativeQuoteItemMatch';
import dayjs from 'dayjs';

const ITEM_DESC_PREVIEW_CHARS = 72;
const ITEM_DESC_COMBINED_PREVIEW_CHARS = 100;

function getIndentItemLineName(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.itemName ?? item.name ?? item.productName ?? '').trim();
}

/** Prefer `description`; support legacy / alternate API shapes. */
function getIndentItemLineDescription(item) {
  if (!item || typeof item !== 'object') return '';
  return String(
    item.description ??
      item.itemDescription ??
      item.specification ??
      item.spec ??
      item.details ??
      item.remarks ??
      ''
  ).trim();
}

const Requisitions = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  
  // State management
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [requisitions, setRequisitions] = useState([]);
  const [vendors, setVendors] = useState([]);
  
  // Pagination and filters
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(250);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState('all');
  const [canManageAssignments, setCanManageAssignments] = useState(false);
  const [assignees, setAssignees] = useState([]);
  
  // Dialog states
  const [viewDialog, setViewDialog] = useState({ open: false, data: null, tab: 0 });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: null });
  const [emailDialog, setEmailDialog] = useState({ open: false, requisition: null, selectedVendors: [], paymentTerms: '', attachmentFile: null });
  const [assignDialog, setAssignDialog] = useState({
    open: false,
    requisition: null,
    assigneeId: '',
    note: '',
    submitting: false
  });
  const [rejectDialog, setRejectDialog] = useState({
    open: false,
    requisition: null,
    observation: '',
    submitting: false
  });
  /** Popover (not nested Dialog) so full text appears above the requisition modal. */
  const [itemTextPopover, setItemTextPopover] = useState({
    anchorEl: null,
    sections: [] // { label: string, text: string }[]
  });
  const [quotations, setQuotations] = useState([]);
  const [loadingQuotations, setLoadingQuotations] = useState(false);

  useEffect(() => {
    if (searchParams.get('myTasks') === '1') {
      setAssignmentFilter('mine');
      setPage(0);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('myTasks');
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Load data on component mount
  useEffect(() => {
    loadRequisitions();
    loadVendors();
    loadAssignees();
  }, [page, rowsPerPage, search, statusFilter, assignmentFilter]);

  const canActOnRequisition = (req) => {
    if (canManageAssignments) return true;
    const to = req?.procurementAssignment?.assignedTo;
    if (!to) return false;
    const assigneeId = to._id || to;
    const uid = user?.id || user?._id;
    return uid && String(assigneeId) === String(uid);
  };

  const loadVendors = async () => {
    try {
      const response = await api.get('/procurement/vendors', { params: { limit: 1000 } });
      if (response.data.success) {
        setVendors(response.data.data.vendors || []);
      }
    } catch (err) {
      console.error('Failed to load vendors:', err);
    }
  };

  const loadAssignees = async () => {
    try {
      const response = await api.get('/procurement/requisitions/assignees');
      if (response.data.success) {
        setAssignees(response.data.data || []);
      }
    } catch (err) {
      console.error('Failed to load procurement assignees:', err);
    }
  };

  const loadRequisitions = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        search: search || undefined,
        status: statusFilter || undefined, // undefined lets backend use its default ('Approved', 'Partially Fulfilled', 'Fulfilled')
        forRequisition: 'true', // Only indents moved to procurement by store (exclude pending store check)
        ...(assignmentFilter !== 'all' ? { assignmentStatus: assignmentFilter } : {}),
        ...(assignmentFilter === 'mine' ? { mineOnly: 'true' } : {})
      };
      
      const response = await api.get('/procurement/requisitions', { params });
      if (response.data.success) {
        const requisitionsData = response.data.data?.indents || [];
        const filteredRequisitions = requisitionsData; // Backend already handles the filter properly
        setRequisitions(filteredRequisitions);
        setCanManageAssignments(Boolean(response.data.data?.canManageAssignments));
        setTotalItems(response.data.data?.pagination?.totalItems || filteredRequisitions.length);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load requisitions');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, statusFilter, assignmentFilter]);

  const getAssignmentStatus = (requisition) => {
    const assignment = requisition.procurementAssignment || {};
    if (assignment.status === 'assigned' && assignment.assignedTo) {
      const assigneeName = `${assignment.assignedTo?.firstName || ''} ${assignment.assignedTo?.lastName || ''}`.trim() || 'Assigned User';
      return {
        label: `Assigned to ${assigneeName}`,
        color: 'success'
      };
    }
    return {
      label: 'Pending Assignment',
      color: 'warning'
    };
  };

  const handleOpenAssignDialog = (requisition) => {
    setAssignDialog({
      open: true,
      requisition,
      assigneeId: requisition.procurementAssignment?.assignedTo?._id || '',
      note: requisition.procurementAssignment?.note || '',
      submitting: false
    });
  };

  const handleAssignRequisition = async () => {
    if (!assignDialog.requisition?._id || !assignDialog.assigneeId) {
      setError('Please select a procurement user for assignment.');
      return;
    }

    try {
      setAssignDialog((prev) => ({ ...prev, submitting: true }));
      const response = await api.put(`/procurement/requisitions/${assignDialog.requisition._id}/assign`, {
        assigneeId: assignDialog.assigneeId,
        note: assignDialog.note
      });

      if (response.data.success) {
        setSuccess(response.data.message || 'Requisition assigned successfully.');
        setAssignDialog({ open: false, requisition: null, assigneeId: '', note: '', submitting: false });
        loadRequisitions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign requisition');
      setAssignDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleOpenRejectDialog = (requisition) => {
    setRejectDialog({
      open: true,
      requisition,
      observation: '',
      submitting: false
    });
  };

  const handleRejectRequisition = async () => {
    const requisitionId = rejectDialog.requisition?._id;
    const observation = (rejectDialog.observation || '').trim();
    if (!requisitionId || !observation) {
      setError('Observation is required to reject requisition.');
      return;
    }

    try {
      setRejectDialog((prev) => ({ ...prev, submitting: true }));
      const response = await api.put(`/procurement/requisitions/${requisitionId}/reject`, { observation });
      if (response.data.success) {
        setSuccess(response.data.message || 'Requisition rejected successfully.');
        setRejectDialog({ open: false, requisition: null, observation: '', submitting: false });
        loadRequisitions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reject requisition');
      setRejectDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleView = async (requisition) => {
    setViewDialog({ open: true, data: requisition, tab: 0 });
    if (!requisition._id) return;
    setLoadingQuotations(true);
    try {
      const [detailRes, quotesRes] = await Promise.all([
        api.get(`/indents/${requisition._id}`),
        api.get(`/procurement/quotations/by-indent/${requisition._id}`)
      ]);
      if (detailRes.data?.success && detailRes.data.data) {
        setViewDialog((prev) =>
          prev.open ? { ...prev, data: detailRes.data.data } : prev
        );
      }
      if (quotesRes.data.success) {
        setQuotations(quotesRes.data.data || []);
      }
    } catch (err) {
      console.error('Failed to load requisition detail or quotations:', err);
      setQuotations([]);
    } finally {
      setLoadingQuotations(false);
    }
  };

  const indentApprovalNameFromChain = (ind, index) => {
    if (!ind) return '';
    const step = ind.approvalChain?.[index];
    if (step?.approver) {
      const n = [step.approver.firstName, step.approver.lastName].filter(Boolean).join(' ').trim();
      if (n) return n;
      if (step.approver.email) return step.approver.email;
    }
    const keys = ['headOfDepartment', 'gmPd', 'svpAvp'];
    return ind.signatures?.[keys[index]]?.name || '';
  };

  const indentApprovalDateFromChain = (ind, index) => {
    if (!ind) return null;
    const step = ind.approvalChain?.[index];
    if (step?.actedAt && step?.status === 'approved') return step.actedAt;
    const keys = ['headOfDepartment', 'gmPd', 'svpAvp'];
    return ind.signatures?.[keys[index]]?.date;
  };

  const indentChainStep = (ind, index) => ind?.approvalChain?.[index];

  const openItemTextPopover = (event, item) => {
    const name = getIndentItemLineName(item);
    const desc = getIndentItemLineDescription(item);
    if (!name && !desc) return;
    if (name && desc && name === desc) {
      setItemTextPopover({ anchorEl: event.currentTarget, sections: [{ label: 'Details', text: name }] });
      return;
    }
    const sections = [];
    if (name) sections.push({ label: 'Item name', text: name });
    if (desc && (!name || desc !== name)) {
      sections.push({ label: 'Description', text: desc });
    }
    setItemTextPopover({ anchorEl: event.currentTarget, sections });
  };

  const renderIndentItemDescriptionCell = (item) => {
    const name = getIndentItemLineName(item);
    const desc = getIndentItemLineDescription(item);
    if (!name && !desc) return '___________';

    const truncate = (s, n) => (s.length <= n ? s : `${s.slice(0, n).trimEnd()}…`);

    const showExpand =
      (name && desc && name !== desc) ||
      desc.length > ITEM_DESC_PREVIEW_CHARS ||
      (name || desc).length > ITEM_DESC_COMBINED_PREVIEW_CHARS;

    const expandBtn = showExpand ? (
      <Tooltip title="View full item text">
        <IconButton
          type="button"
          size="small"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openItemTextPopover(e, item);
          }}
          className="requisition-item-expand-btn"
          sx={{ flexShrink: 0, p: '2px', ml: 0.25, alignSelf: 'flex-start' }}
          aria-label="View full item description"
        >
          <ArticleOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    ) : null;

    if (name && desc && name !== desc) {
      const descLong =
        desc.length > ITEM_DESC_PREVIEW_CHARS ||
        name.length + desc.length > ITEM_DESC_COMBINED_PREVIEW_CHARS;
      return (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} component="div">
              {name}
            </Typography>
            <Typography
              component="div"
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {descLong ? truncate(desc, ITEM_DESC_PREVIEW_CHARS) : desc}
            </Typography>
          </Box>
          {expandBtn}
        </Box>
      );
    }

    const single = name || desc;
    if (single.length > ITEM_DESC_COMBINED_PREVIEW_CHARS) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25 }}>
          <Typography
            component="div"
            variant="body2"
            sx={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {truncate(single, ITEM_DESC_COMBINED_PREVIEW_CHARS)}
          </Typography>
          {expandBtn}
        </Box>
      );
    }

    return <Typography component="div" variant="body2">{single}</Typography>;
  };

  const handleTabChange = (event, newValue) => {
    setViewDialog({ ...viewDialog, tab: newValue });
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined) return '0.00';
    return parseFloat(num).toFixed(2);
  };

  const formatDateForPrint = (date) => {
    if (!date) return '';
    return dayjs(date).format('DD/MM/YYYY');
  };

  const handleDelete = (id) => {
    setDeleteDialog({ open: true, id });
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/indents/${deleteDialog.id}`);
      setSuccess('Requisition deleted successfully');
      setDeleteDialog({ open: false, id: null });
      loadRequisitions();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete requisition');
    }
  };

  const handleSendEmail = (requisition) => {
    setEmailDialog({ open: true, requisition, selectedVendors: [], paymentTerms: '', attachmentFile: null });
  };

  const handleSendEmailToVendors = async () => {
    try {
      setLoading(true);
      const { requisition, selectedVendors, paymentTerms, attachmentFile } = emailDialog;
      
      if (selectedVendors.length === 0) {
        setError('Please select at least one vendor');
        return;
      }

      if (attachmentFile) {
        const formData = new FormData();
        formData.append('requisitionId', requisition._id);
        formData.append('vendorIds', JSON.stringify(selectedVendors));
        if (paymentTerms) formData.append('paymentTerms', paymentTerms);
        formData.append('attachment', attachmentFile);
        await api.post('/procurement/requisitions/send-email', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } else {
        await api.post('/procurement/requisitions/send-email', {
          requisitionId: requisition._id,
          vendorIds: selectedVendors,
          ...(paymentTerms && { paymentTerms })
        });
      }

      setSuccess(`Requisition sent to ${selectedVendors.length} vendor(s) successfully`);
      setEmailDialog({ open: false, requisition: null, selectedVendors: [], paymentTerms: '', attachmentFile: null });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send requisition to vendors');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'Draft': 'default',
      'Submitted': 'info',
      'Under Review': 'warning',
      'Approved': 'success',
      'Rejected': 'error',
      'Rejected in Procurement': 'error',
      'Partially Fulfilled': 'warning',
      'Fulfilled': 'success',
      'Cancelled': 'default'
    };
    return colors[status] || 'default';
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
            Procurement Requisitions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            View approved requisitions from departments
          </Typography>
        </Box>
        <Button 
          variant="outlined" 
          startIcon={<RefreshIcon />} 
          onClick={loadRequisitions}
          sx={{ mr: 2 }}
        >
          Refresh
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <TextField
            size="small"
            placeholder="Search requisitions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter || ''}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All Eligible</MenuItem>
            <MenuItem value="Approved">Approved</MenuItem>
            <MenuItem value="Partially Fulfilled">Partially Fulfilled</MenuItem>
            <MenuItem value="Fulfilled">Fully Ordered</MenuItem>
            <MenuItem value="Rejected in Procurement">Rejected in Procurement</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Task Assignment"
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value)}
            sx={{ minWidth: 190 }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="assigned">Assigned</MenuItem>
            <MenuItem value="unassigned">Unassigned</MenuItem>
            <MenuItem value="mine">My Tasks</MenuItem>
          </TextField>
        </Stack>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Requisition #</strong></TableCell>
                <TableCell><strong>Title</strong></TableCell>
                <TableCell><strong>Department</strong></TableCell>
                <TableCell><strong>Company</strong></TableCell>
                <TableCell><strong>Requester</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell><strong>Task Assignment</strong></TableCell>
                <TableCell><strong>Priority</strong></TableCell>
                <TableCell><strong>Date</strong></TableCell>
                <TableCell align="center"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} align="center">
                    <Typography>Loading...</Typography>
                  </TableCell>
                </TableRow>
              ) : requisitions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} align="center">
                    <Typography color="text.secondary">No requisitions found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                requisitions.map((req) => (
                  <TableRow key={req._id} hover>
                    <TableCell>{req.indentNumber}</TableCell>
                    <TableCell>{req.title}</TableCell>
                    <TableCell>{req.department?.name || '-'}</TableCell>
                    <TableCell>{req.companyId?.name || '-'}</TableCell>
                    <TableCell>
                      {req.requestedBy?.firstName} {req.requestedBy?.lastName}
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={req.status === 'Fulfilled' ? 'Fully Ordered' : req.status} 
                        color={getStatusColor(req.status)} 
                        size="small" 
                      />
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const assignmentStatus = getAssignmentStatus(req);
                        return (
                          <Stack spacing={0.5} alignItems="flex-start">
                            <Chip
                              label={assignmentStatus.label}
                              color={assignmentStatus.color}
                              variant={assignmentStatus.color === 'warning' ? 'outlined' : 'filled'}
                              size="small"
                            />
                            {req.procurementAssignment?.assignedAt && (
                              <Typography variant="caption" color="text.secondary">
                                {`Assigned ${formatDate(req.procurementAssignment.assignedAt)}`}
                              </Typography>
                            )}
                          </Stack>
                        );
                      })()}
                    </TableCell>
                    <TableCell>{req.priority || '-'}</TableCell>
                    <TableCell>{formatDate(req.createdAt)}</TableCell>
                    <TableCell align="center">
                      {canManageAssignments && (
                        <Tooltip title="Assign Task">
                          <IconButton
                            size="small"
                            color="secondary"
                            onClick={() => handleOpenAssignDialog(req)}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {canManageAssignments && ['Approved', 'Partially Fulfilled', 'Fulfilled'].includes(req.status) && (
                        <Tooltip title="Reject with Observation">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleOpenRejectDialog(req)}
                          >
                            <RejectIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title={canActOnRequisition(req) ? 'Send to Vendors' : 'Only the assigned procurement user or a manager can send to vendors'}>
                        <IconButton 
                          size="small" 
                          color="primary" 
                          onClick={() => handleSendEmail(req)}
                          disabled={!req.procurementAssignment?.assignedTo || !canActOnRequisition(req)}
                        >
                          <EmailIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="View Details">
                        <IconButton size="small" onClick={() => handleView(req)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {user?.role === 'developer' && (
                        <Tooltip title="Delete requisition & all related records (Developer only)">
                          <IconButton 
                            size="small" 
                            color="error" 
                            onClick={() => handleDelete(req._id)}
                          >
                            <DeleteIcon fontSize="small" />
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
        <TablePagination
          component="div"
          count={totalItems}
          page={page}
          onPageChange={(e, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[25, 50, 100, 250, 500]}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </Paper>

      {/* VIEW DIALOG */}
      <Dialog 
        open={viewDialog.open} 
        onClose={() => setViewDialog({ open: false, data: null, tab: 0 })} 
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: {
            width: viewDialog.tab === 1 ? '95%' : '90%',
            maxWidth: viewDialog.tab === 1 ? '297mm' : '210mm',
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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">
              {viewDialog.tab === 0 ? 'Requisition Details' : 'Comparative Statement'}
            </Typography>
            <Button
              variant="contained"
              startIcon={<PrintIcon />}
              onClick={() => window.print()}
              size="small"
            >
              Print
            </Button>
          </Box>
        </DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', '@media print': { display: 'none' } }}>
          <Tabs value={viewDialog.tab} onChange={handleTabChange} aria-label="requisition tabs">
            <Tab label="Requisition Details" />
            <Tab label="Comparative Statement" />
          </Tabs>
        </Box>
        <DialogContent sx={{ p: 0, overflow: 'auto', '@media print': { p: 0, overflow: 'visible' } }}>
          {viewDialog.data && viewDialog.tab === 0 && (
            <Box sx={{ width: '100%' }} className="print-content">
              {/* Print Content - Same as IndentPrintView */}
              <Paper
                sx={{
                  p: { xs: 3, sm: 3.5, md: 4 },
                  maxWidth: '210mm',
                  mx: 'auto',
                  backgroundColor: '#fff',
                  boxShadow: 'none',
                  width: '100%',
                  '@media print': {
                    boxShadow: 'none',
                    p: 2.5,
                    maxWidth: '100%',
                    backgroundColor: '#fff',
                    mx: 0,
                    width: '100%',
                    pageBreakInside: 'avoid'
                  }
                }}
              >
                {/* Header Section - Logo and Company Name */}
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 0, position: 'relative', minHeight: { xs: 150, print: 130 } }}>
                  <Box
                    component="img"
                    src="/images/taj-logo.png"
                    alt="Company Logo"
                    sx={{
                      height: { xs: 150, print: 130 },
                      width: 'auto',
                      objectFit: 'contain',
                      position: 'absolute',
                      left: 0,
                      top: { xs: 10, print: 5 }
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <Typography
                    variant="h6"
                    fontWeight={700}
                    sx={{
                      fontSize: { xs: '1.6rem', print: '1.4rem' },
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      textAlign: 'center'
                    }}
                  >
                    {viewDialog.data.companyId?.name || '—'}
                  </Typography>
                </Box>

                {/* Document Title */}
                <Typography
                  variant="h5"
                  fontWeight={700}
                  align="center"
                  sx={{
                    textTransform: 'uppercase',
                    mb: 2,
                    fontSize: { xs: '1.1rem', print: '0.95rem' },
                    letterSpacing: 1.5,
                    mt: -4
                  }}
                >
                  Purchase Request Form
                </Typography>

                {/* ERP Ref - Single Row (Centered) */}
                <Box sx={{ mb: 1.5, fontSize: '0.9rem', lineHeight: 1.8, textAlign: 'center' }}>
                  <Box>
                    <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                    <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>
                      {viewDialog.data.erpRef || 'PR #' + (viewDialog.data.indentNumber?.split('-').pop() || '')}
                    </Typography>
                  </Box>
                </Box>

                {/* Date, Required Date, Indent No. - Single Row */}
                <Box sx={{ mb: 1.5, fontSize: '0.9rem', lineHeight: 1.8 }}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' }}>
                    <Box sx={{ minWidth: '120px' }}>
                      <Typography component="span" fontWeight={600}>Date:</Typography>
                      <Typography component="span" sx={{ ml: 1 }}>
                        {formatDateForPrint(viewDialog.data.requestedDate)}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: '150px' }}>
                      <Typography component="span" fontWeight={600}>Required Date:</Typography>
                      <Typography component="span" sx={{ ml: 1 }}>
                        {viewDialog.data.requiredDate ? formatDateForPrint(viewDialog.data.requiredDate) : '___________'}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: '120px' }}>
                      <Typography component="span" fontWeight={600}>Indent No.:</Typography>
                      <Typography component="span" sx={{ ml: 1 }}>
                        {viewDialog.data.indentNumber || '___________'}
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Department and Originator - Single Row */}
                <Box sx={{ mb: 3, fontSize: '0.9rem', lineHeight: 1.8 }}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' }}>
                    <Box sx={{ minWidth: '200px' }}>
                      <Typography component="span" fontWeight={600}>Department:</Typography>
                      <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>
                        {viewDialog.data.department?.name || '___________'}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: '200px' }}>
                      <Typography component="span" fontWeight={600}>Originator:</Typography>
                      <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>
                        {viewDialog.data.requestedBy?.firstName && viewDialog.data.requestedBy?.lastName
                          ? `${viewDialog.data.requestedBy.firstName} ${viewDialog.data.requestedBy.lastName}`
                          : '___________'}
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Items Table */}
                <Box sx={{ mb: 3 }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      border: '1px solid #000',
                      fontSize: '0.85rem',
                      fontFamily: 'Arial, sans-serif'
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                        <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: '5%' }}>
                          S#
                        </th>
                        <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '30%' }}>
                          Description
                        </th>
                        <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '15%' }}>
                          Brand
                        </th>
                        <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '10%' }}>
                          Unit
                        </th>
                        <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: '8%' }}>
                          Qty.
                        </th>
                        <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '32%' }}>
                          Purpose
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewDialog.data.items && viewDialog.data.items.length > 0 ? (
                        viewDialog.data.items.map((item, index) => (
                          <tr key={index} style={{ border: '1px solid #000' }}>
                            <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>
                              {(index + 1).toString().padStart(2, '0')}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {renderIndentItemDescriptionCell(item)}
                                {((item.orderedQuantity || 0) >= item.quantity) && (
                                  <Tooltip title="PO Created / Fully Ordered">
                                    <CheckCircleIcon color="success" fontSize="small" sx={{ '@media print': { display: 'none' } }} />
                                  </Tooltip>
                                )}
                              </Box>
                            </td>
                            <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                              {item.brand || '___________'}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                              {item.unit || '___________'}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>
                              {item.quantity || '___'}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                              {item.purpose || '___________'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center' }}>
                            No items
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Box>

                {/* Justification */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1, fontSize: '0.95rem' }}>
                    Justification:
                  </Typography>
                  <Box
                    sx={{
                      border: '1px solid #ccc',
                      p: 1.5,
                      minHeight: '50px',
                      fontSize: '0.9rem',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.6
                    }}
                  >
                    {viewDialog.data.justification || '___________'}
                  </Box>
                </Box>

                <StoreVettingNotice indent={viewDialog.data} sx={{ mb: 2 }} />

                {/* Signatures — fixed-height boxes; image uses all space between label and name/date */}
                <Box sx={{ mb: 3 }}>
                  <Grid container spacing={1.5}>
                    <Grid item xs={12} sm={6} md={6}>
                      <Box
                        sx={{
                          border: '1px solid #ccc',
                          p: 0.75,
                          height: 150,
                          minHeight: 150,
                          maxHeight: 150,
                          boxSizing: 'border-box',
                          display: 'flex',
                          flexDirection: 'column',
                          overflow: 'hidden',
                          textAlign: 'left'
                        }}
                      >
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          sx={{ mb: 0.25, fontSize: '0.8rem', lineHeight: 1.15, flexShrink: 0 }}
                        >
                          Sig of Requester:
                        </Typography>
                        {viewDialog.data.requestedBy?.digitalSignature ? (
                          <Box
                            sx={{
                              flex: '1 1 0',
                              minHeight: 0,
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              overflow: 'hidden',
                              py: 0.25,
                              pl: 0.25
                            }}
                          >
                            <DigitalSignatureImage
                              userOrPath={viewDialog.data.requestedBy}
                              alt="Requester"
                              sx={{
                                maxHeight: '100%',
                                maxWidth: '100%',
                                width: 'auto',
                                height: '100%',
                                mx: 0,
                                alignSelf: 'center',
                                objectFit: 'contain',
                                objectPosition: 'left center'
                              }}
                            />
                          </Box>
                        ) : null}
                        <Box sx={{ flexShrink: 0, mt: 0.25, minHeight: '18px', fontSize: '0.8rem', lineHeight: 1.2 }}>
                          {viewDialog.data.signatures?.requester?.name ||
                            (viewDialog.data.requestedBy?.firstName && viewDialog.data.requestedBy?.lastName
                              ? `${viewDialog.data.requestedBy.firstName} ${viewDialog.data.requestedBy.lastName}`
                              : '___________')}
                        </Box>
                        {(viewDialog.data.signatures?.requester?.date ||
                          viewDialog.data.requestedDate ||
                          viewDialog.data.createdAt) && (
                          <Typography
                            variant="caption"
                            sx={{ mt: 0.125, display: 'block', fontSize: '0.7rem', lineHeight: 1.1, flexShrink: 0 }}
                          >
                            {formatDateForPrint(
                              viewDialog.data.signatures?.requester?.date ||
                                viewDialog.data.requestedDate ||
                                viewDialog.data.createdAt
                            )}
                          </Typography>
                        )}
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={6}>
                      <Box
                        sx={{
                          border: '1px solid #ccc',
                          p: 0.75,
                          height: 150,
                          minHeight: 150,
                          maxHeight: 150,
                          boxSizing: 'border-box',
                          display: 'flex',
                          flexDirection: 'column',
                          overflow: 'hidden',
                          textAlign: 'left'
                        }}
                      >
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          sx={{ mb: 0.25, fontSize: '0.8rem', lineHeight: 1.15, flexShrink: 0 }}
                        >
                          Head of Department:
                        </Typography>
                        {indentChainStep(viewDialog.data, 0)?.status === 'approved' &&
                        indentChainStep(viewDialog.data, 0)?.approver?.digitalSignature ? (
                          <Box
                            sx={{
                              flex: '1 1 0',
                              minHeight: 0,
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              overflow: 'hidden',
                              py: 0.25,
                              pl: 0.25
                            }}
                          >
                            <DigitalSignatureImage
                              userOrPath={indentChainStep(viewDialog.data, 0).approver}
                              alt="Head of Department"
                              sx={{
                                maxHeight: '100%',
                                maxWidth: '100%',
                                width: 'auto',
                                height: '100%',
                                mx: 0,
                                alignSelf: 'center',
                                objectFit: 'contain',
                                objectPosition: 'left center'
                              }}
                            />
                          </Box>
                        ) : null}
                        <Box sx={{ flexShrink: 0, mt: 0.25, minHeight: '18px', fontSize: '0.8rem', lineHeight: 1.2 }}>
                          {indentApprovalNameFromChain(viewDialog.data, 0) || '___________'}
                        </Box>
                        {indentApprovalDateFromChain(viewDialog.data, 0) ? (
                          <Typography
                            variant="caption"
                            sx={{ mt: 0.125, display: 'block', fontSize: '0.7rem', lineHeight: 1.1, flexShrink: 0 }}
                          >
                            {formatDateForPrint(indentApprovalDateFromChain(viewDialog.data, 0))}
                          </Typography>
                        ) : null}
                      </Box>
                    </Grid>
                  </Grid>
                </Box>

                {/* Distribution Section - Bottom Left */}
                <Box sx={{ mt: 3, pt: 1.5, borderTop: '1px solid #ccc', fontSize: '0.8rem' }}>
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
                    <strong>Original:</strong> Procurement
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
                    <strong>Green:</strong> Store
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    <strong>Yellow:</strong> For Book Record
                  </Typography>
                </Box>
              </Paper>
            </Box>
          )}
          {viewDialog.data && viewDialog.tab === 1 && (
            <Box sx={{ width: '100%' }} className="print-content">
              <Paper
                sx={{
                  p: { xs: 3, sm: 3.5, md: 4 },
                  maxWidth: '210mm',
                  mx: 'auto',
                  backgroundColor: '#fff',
                  boxShadow: 'none',
                  width: '100%',
                  fontFamily: 'Arial, sans-serif',
                  '@media print': {
                    boxShadow: 'none',
                    p: 2.5,
                    maxWidth: '100%',
                    backgroundColor: '#fff',
                    mx: 0,
                    width: '100%',
                    pageBreakInside: 'avoid'
                  }
                }}
              >
                {/* Header Section - Logo and Company Name */}
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 0, position: 'relative', minHeight: { xs: 150, print: 130 } }}>
                  <Box
                    component="img"
                    src="/images/taj-logo.png"
                    alt="Company Logo"
                    sx={{
                      height: { xs: 150, print: 130 },
                      width: 'auto',
                      objectFit: 'contain',
                      position: 'absolute',
                      left: 0,
                      top: { xs: 10, print: 5 }
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <Typography
                    variant="h6"
                    fontWeight={700}
                    sx={{
                      fontSize: { xs: '1.6rem', print: '1.4rem' },
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      textAlign: 'center'
                    }}
                  >
                    {viewDialog.data.companyId?.name || '—'}
                  </Typography>
                </Box>

                {/* Document Title */}
                <Typography
                  variant="h5"
                  fontWeight={700}
                  align="center"
                  sx={{
                    textTransform: 'uppercase',
                    mb: 2,
                    fontSize: { xs: '1.1rem', print: '0.95rem' },
                    letterSpacing: 1.5,
                    mt: -4
                  }}
                >
                  COMPARATIVE STATEMENT
                </Typography>

                {/* Reference Information */}
                <Box sx={{ mb: 2, fontSize: '0.9rem', lineHeight: 1.8 }}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-start', mb: 1 }}>
                    <Box sx={{ minWidth: '120px' }}>
                      <Typography component="span" fontWeight={600}>Date:</Typography>
                      <Typography component="span" sx={{ ml: 1 }}>
                        {formatDateForPrint(viewDialog.data.requestedDate)}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: '150px' }}>
                      <Typography component="span" fontWeight={600}>Required Date:</Typography>
                      <Typography component="span" sx={{ ml: 1 }}>
                        {viewDialog.data.requiredDate ? formatDateForPrint(viewDialog.data.requiredDate) : '___________'}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: '120px' }}>
                      <Typography component="span" fontWeight={600}>Indent No.:</Typography>
                      <Typography component="span" sx={{ ml: 1 }}>
                        {viewDialog.data.indentNumber || '___________'}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-start' }}>
                    <Box sx={{ minWidth: '200px' }}>
                      <Typography component="span" fontWeight={600}>Department:</Typography>
                      <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>
                        {viewDialog.data.department?.name || '___________'}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: '200px' }}>
                      <Typography component="span" fontWeight={600}>Company:</Typography>
                      <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>
                        {viewDialog.data.companyId?.name || '___________'}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: '200px' }}>
                      <Typography component="span" fontWeight={600}>Originator:</Typography>
                      <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>
                        {viewDialog.data.requestedBy?.firstName && viewDialog.data.requestedBy?.lastName
                          ? `${viewDialog.data.requestedBy.firstName} ${viewDialog.data.requestedBy.lastName}`
                          : '___________'}
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Comparative Table */}
                {loadingQuotations ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                  </Box>
                ) : quotations.length === 0 ? (
                  <Box sx={{ p: 3, textAlign: 'center' }}>
                    <Typography>No quotations available for comparison</Typography>
                  </Box>
                ) : (
                  <Box sx={{ mb: 3, overflowX: 'auto' }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        border: '1px solid #000',
                        fontSize: '0.8rem',
                        fontFamily: 'Arial, sans-serif',
                        minWidth: '800px'
                      }}
                    >
                      <thead>
                        <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                          <th rowSpan={2} style={{ border: '1px solid #000', padding: '8px', textAlign: 'center', fontWeight: 700, width: '4%' }}>
                            S/No
                          </th>
                          <th rowSpan={2} style={{ border: '1px solid #000', padding: '8px', fontWeight: 700, textAlign: 'left', width: '30%' }}>
                            Description
                          </th>
                          <th rowSpan={2} style={{ border: '1px solid #000', padding: '8px', fontWeight: 700, textAlign: 'left', width: '8%' }}>
                            Unit
                          </th>
                          <th rowSpan={2} style={{ border: '1px solid #000', padding: '8px', textAlign: 'center', fontWeight: 700, width: '6%' }}>
                            Qty
                          </th>
                          {quotations.map((quote, idx) => (
                            <th key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '8px', fontWeight: 700, textAlign: 'center', width: `${52 / quotations.length}%` }}>
                              Vendor {idx + 1} ({quote.vendor?.name || 'N/A'})
                            </th>
                          ))}
                        </tr>
                        <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                          {quotations.map((quote, idx) => (
                            <React.Fragment key={idx}>
                              <th style={{ border: '1px solid #000', padding: '8px', fontWeight: 700, textAlign: 'center' }}>
                                Unit Rate
                              </th>
                              <th style={{ border: '1px solid #000', padding: '8px', fontWeight: 700, textAlign: 'center' }}>
                                Total Amount
                              </th>
                            </React.Fragment>
                          ))}
                        </tr>
                        {/* Vendor Quotation Numbers Row */}
                        <tr style={{ border: '1px solid #000', fontSize: '0.75rem', backgroundColor: '#fafafa' }}>
                          <td colSpan={4} style={{ border: '1px solid #000', padding: '4px 8px' }}></td>
                          {quotations.map((quote, idx) => (
                            <td key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'center' }}>
                              {quote.quotationNumber} - {formatDateForPrint(quote.quotationDate)}
                            </td>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {viewDialog.data.items && viewDialog.data.items.length > 0 ? (
                          viewDialog.data.items.map((item, itemIndex) => (
                            <tr key={itemIndex} style={{ border: '1px solid #000' }}>
                              <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'center', verticalAlign: 'top' }}>
                                {itemIndex + 1}
                              </td>
                              <td style={{ border: '1px solid #000', padding: '8px', verticalAlign: 'top' }}>
                                {renderIndentItemDescriptionCell(item)}
                              </td>
                              <td style={{ border: '1px solid #000', padding: '8px', verticalAlign: 'top' }}>
                                {item.unit || '___________'}
                              </td>
                              <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'center', verticalAlign: 'top' }}>
                                {item.quantity || '___'}
                              </td>
                              {quotations.map((quote, quoteIdx) => {
                                const quoteItem = getQuoteItemForIndentItem(
                                  quote,
                                  item,
                                  itemIndex,
                                  viewDialog.data.items || []
                                );
                                const isNotQuoted = !quoteItem || isBlankQuoteItem(quoteItem);
                                const itemTotal = !isNotQuoted ? getQuoteLineAmount(quoteItem) : 0;
                                return (
                                  <React.Fragment key={quoteIdx}>
                                    <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'right', verticalAlign: 'top' }}>
                                      {!isNotQuoted ? formatNumber(quoteItem.unitPrice) : '___________'}
                                    </td>
                                    <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'right', verticalAlign: 'top' }}>
                                      {!isNotQuoted ? formatNumber(itemTotal) : '___________'}
                                    </td>
                                  </React.Fragment>
                                );
                              })}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4 + (quotations.length * 2)} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center' }}>
                              No items
                            </td>
                          </tr>
                        )}
                        {/* Total Amount Row */}
                        <tr style={{ borderTop: '2px solid #000', borderBottom: '1px solid #000', backgroundColor: '#e8e8e8', fontWeight: 700 }}>
                          <td colSpan={4} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', fontSize: '0.9rem' }}>
                            Total Amount
                          </td>
                          {quotations.map((quote, idx) => (
                            <td key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', fontSize: '0.9rem' }}>
                              {formatNumber(quote.totalAmount || 0)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </Box>
                )}

                {/* Recommended Vendor Section */}
                {quotations.length > 0 && (
                  <Box sx={{ mt: 3, p: 2, border: '1px solid #ccc', fontSize: '0.9rem' }}>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                      Recommended Vendor:
                    </Typography>
                    <Typography>
                      {quotations.reduce((lowest, quote) => 
                        (!lowest || (quote.totalAmount || 0) < (lowest.totalAmount || 0)) ? quote : lowest
                      , null)?.vendor?.name || 'N/A'}
                    </Typography>
                  </Box>
                )}
              </Paper>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ '@media print': { display: 'none' } }}>
          <Button
            onClick={() => {
              setItemTextPopover({ anchorEl: null, sections: [] });
              setViewDialog({ open: false, data: null, tab: 0 });
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Popover
        open={Boolean(itemTextPopover.anchorEl)}
        anchorEl={itemTextPopover.anchorEl}
        onClose={() => setItemTextPopover({ anchorEl: null, sections: [] })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        disableRestoreFocus
        slotProps={{
          root: {
            sx: {
              zIndex: (theme) => theme.zIndex.modal + 10
            }
          }
        }}
        PaperProps={{
          sx: {
            p: 2,
            maxWidth: 520,
            width: 'min(520px, calc(100vw - 32px))',
            maxHeight: 'min(70vh, 480px)',
            overflow: 'auto',
            '@media print': { display: 'none' }
          }
        }}
      >
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
          Item line — full text
        </Typography>
        {itemTextPopover.sections.map((s, i) => (
          <Box key={`${s.label}-${i}`} sx={{ mb: i < itemTextPopover.sections.length - 1 ? 2 : 0 }}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.5 }} component="div">
              {s.label}
            </Typography>
            <Typography
              component="div"
              variant="body2"
              sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.5 }}
            >
              {s.text}
            </Typography>
          </Box>
        ))}
        <Button size="small" sx={{ mt: 1 }} onClick={() => setItemTextPopover({ anchorEl: null, sections: [] })}>
          Close
        </Button>
      </Popover>

      {/* ASSIGN TASK DIALOG */}
      <Dialog
        open={assignDialog.open}
        onClose={() => setAssignDialog({ open: false, requisition: null, assigneeId: '', note: '', submitting: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Assign Procurement Task</DialogTitle>
        <DialogContent>
          {assignDialog.requisition && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>Requisition #:</strong> {assignDialog.requisition.indentNumber}<br />
                <strong>Title:</strong> {assignDialog.requisition.title}
              </Typography>
              <TextField
                select
                fullWidth
                label="Assign To"
                value={assignDialog.assigneeId}
                onChange={(e) => setAssignDialog((prev) => ({ ...prev, assigneeId: e.target.value }))}
                size="small"
                required
                sx={{ mb: 2 }}
              >
                {assignees.map((assignee) => (
                  <MenuItem key={assignee._id} value={assignee._id}>
                    {`${assignee.firstName || ''} ${assignee.lastName || ''}`.trim()} {assignee.position ? `(${assignee.position})` : ''}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Assignment Note (Optional)"
                value={assignDialog.note}
                onChange={(e) => setAssignDialog((prev) => ({ ...prev, note: e.target.value }))}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignDialog({ open: false, requisition: null, assigneeId: '', note: '', submitting: false })}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAssignRequisition}
            disabled={assignDialog.submitting || !assignDialog.assigneeId}
          >
            {assignDialog.submitting ? 'Assigning...' : 'Assign Task'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Print Styles for Dialog */}
      <Box
        component="style"
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: A4;
                margin: 15mm;
              }
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
              button.requisition-item-expand-btn {
                display: none !important;
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
            }
          `
        }}
      />

      {/* EMAIL DIALOG */}
      <Dialog 
        open={emailDialog.open} 
        onClose={() => setEmailDialog({ open: false, requisition: null, selectedVendors: [], paymentTerms: '', attachmentFile: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Send Requisition to Vendors</DialogTitle>
        <DialogContent>
          {emailDialog.requisition && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Requisition Details
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>Requisition #:</strong> {emailDialog.requisition.indentNumber}<br />
                <strong>Title:</strong> {emailDialog.requisition.title}<br />
                <strong>Department:</strong> {emailDialog.requisition.department?.name || '-'}
              </Typography>
              <TextField
                fullWidth
                select
                size="small"
                label="Payment Terms"
                value={emailDialog.paymentTerms || ''}
                onChange={(e) => setEmailDialog({ ...emailDialog, paymentTerms: e.target.value })}
                sx={{ mt: 2, mb: 1 }}
              >
                <MenuItem value="">None</MenuItem>
                <MenuItem value="Full Advance">Full Advance</MenuItem>
                <MenuItem value="Partial Advance">Partial Advance</MenuItem>
                <MenuItem value="Payment After Delivery">Payment After Delivery</MenuItem>
              </TextField>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Attachment (optional)</Typography>
                <input
                  accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                  style={{ display: 'none' }}
                  id="requisition-email-attachment"
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setEmailDialog({ ...emailDialog, attachmentFile: file || null });
                    e.target.value = '';
                  }}
                />
                <label htmlFor="requisition-email-attachment">
                  <Button variant="outlined" component="span" size="small">
                    {emailDialog.attachmentFile ? emailDialog.attachmentFile.name : 'Choose file'}
                  </Button>
                </label>
                {emailDialog.attachmentFile && (
                  <Chip
                    label="Remove"
                    size="small"
                    onDelete={() => setEmailDialog({ ...emailDialog, attachmentFile: null })}
                    sx={{ ml: 1 }}
                  />
                )}
              </Box>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Select Vendors to Send
              </Typography>
              <List>
                {vendors.map((vendor) => (
                  <ListItem key={vendor._id} dense>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={emailDialog.selectedVendors.includes(vendor._id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEmailDialog({
                                ...emailDialog,
                                selectedVendors: [...emailDialog.selectedVendors, vendor._id]
                              });
                            } else {
                              setEmailDialog({
                                ...emailDialog,
                                selectedVendors: emailDialog.selectedVendors.filter(id => id !== vendor._id)
                              });
                            }
                          }}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2"><strong>{vendor.name}</strong></Typography>
                          <Typography variant="caption" color="text.secondary">
                            {vendor.email} | {vendor.contactPerson}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
              {vendors.length === 0 && (
                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
                  No vendors available
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmailDialog({ open: false, requisition: null, selectedVendors: [], paymentTerms: '', attachmentFile: null })}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSendEmailToVendors}
            disabled={
              loading
              || emailDialog.selectedVendors.length === 0
              || !emailDialog.requisition
              || !canActOnRequisition(emailDialog.requisition)
            }
            startIcon={loading ? <CircularProgress size={20} /> : <EmailIcon />}
          >
            Send Email
          </Button>
        </DialogActions>
      </Dialog>

      {/* REJECT REQUISITION DIALOG */}
      <Dialog
        open={rejectDialog.open}
        onClose={() => setRejectDialog({ open: false, requisition: null, observation: '', submitting: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject Requisition</DialogTitle>
        <DialogContent>
          {rejectDialog.requisition && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>Requisition #:</strong> {rejectDialog.requisition.indentNumber}<br />
                <strong>Title:</strong> {rejectDialog.requisition.title}
              </Typography>
              <TextField
                fullWidth
                multiline
                minRows={4}
                label="Observation (Required)"
                placeholder="Write the procurement observation for rejection..."
                value={rejectDialog.observation}
                onChange={(e) => setRejectDialog((prev) => ({ ...prev, observation: e.target.value }))}
                inputProps={{ maxLength: 1000 }}
                helperText={`${(rejectDialog.observation || '').length}/1000`}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialog({ open: false, requisition: null, observation: '', submitting: false })}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleRejectRequisition}
            disabled={rejectDialog.submitting || !rejectDialog.observation.trim()}
          >
            {rejectDialog.submitting ? 'Rejecting...' : 'Reject Requisition'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* DELETE DIALOG */}
      <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, id: null })}>
        <DialogTitle>Delete Requisition (Developer Only)</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to permanently delete this requisition?</Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            This will permanently delete this requisition and all related documents across Procurement, Pre-Audit, Finance, and CEO Office. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, id: null })}>Cancel</Button>
          <Button variant="contained" color="error" onClick={confirmDelete}>
            Delete Everything
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Requisitions;
