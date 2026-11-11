import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Grid,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Stack,
  Divider,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Avatar,
  Tooltip,
  Autocomplete
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Send as SendIcon,
  ArrowBack as ArrowBackIcon,
  Comment as CommentIcon,
  Print as PrintIcon,
  ShoppingCart as POIcon,
  History as HistoryIcon,
  Replay as ReplayIcon,
  AttachFile as AttachFileIcon,
  OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import indentService from '../../../services/indentService';
import api from '../../../services/api';
import dayjs from 'dayjs';
import WorkflowHistoryDialog from '../../../components/WorkflowHistoryDialog';
import { resolveUploadFileHref } from '../../../utils/uploadPaths';
import { DigitalSignatureImage } from '../../../components/common/DigitalSignatureImage';
import { ChargedToPanel } from '../../../components/Procurement/ChargedToPanel';
import { ProjectBudgetCheck } from '../../../components/Procurement/ProjectBudgetCheck';

const approverDisplayName = (u) => {
  if (!u) return '';
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return n || u.email || u.employeeId || '';
};

const IndentDetail = ({
  id: idProp = null,
  embedded = false,
  hideBack = false,
  hideModuleActions = false
} = {}) => {
  const { id: idParam } = useParams();
  const id = idProp || idParam;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [indent, setIndent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [linkedPOs, setLinkedPOs] = useState([]);
  const [loadingPOs, setLoadingPOs] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submitSlots, setSubmitSlots] = useState([null]);
  const [approverSearchOptions, setApproverSearchOptions] = useState([]);
  const [approverSearchLoading, setApproverSearchLoading] = useState(false);
  const [workflowHistoryOpen, setWorkflowHistoryOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load indent data
  const loadIndent = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await indentService.getIndentById(id);
      setIndent(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load indent');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadLinkedPOs = useCallback(async () => {
    try {
      setLoadingPOs(true);
      const res = await api.get(`/indents/${id}/purchase-orders`);
      if (res.data.success) setLinkedPOs(res.data.data || []);
    } catch {
      // non-critical
    } finally {
      setLoadingPOs(false);
    }
  }, [id]);

  useEffect(() => {
    loadIndent();
    loadLinkedPOs();
  }, [loadIndent, loadLinkedPOs]);

  const loadApproverOptions = async (q) => {
    try {
      setApproverSearchLoading(true);
      const res = await api.get('/indents/approver-candidates', {
        params: { search: q || '', limit: 50 }
      });
      setApproverSearchOptions(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      setApproverSearchOptions([]);
    } finally {
      setApproverSearchLoading(false);
    }
  };

  useEffect(() => {
    if (submitDialogOpen) loadApproverOptions('');
  }, [submitDialogOpen]);

  // Handle actions
  const handleApprove = async () => {
    try {
      await indentService.approveIndent(id);
      setSnackbar({
        open: true,
        message: 'Indent approved successfully',
        severity: 'success'
      });
      loadIndent();
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error approving indent',
        severity: 'error'
      });
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('Please enter rejection reason:');
    if (!reason) return;
    
    try {
      await indentService.rejectIndent(id, reason);
      setSnackbar({
        open: true,
        message: 'Indent rejected successfully',
        severity: 'success'
      });
      loadIndent();
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error rejecting indent',
        severity: 'error'
      });
    }
  };

  const runSubmitWithApprovers = async (approverIds) => {
    await indentService.submitIndent(id, { approverIds });
    setSnackbar({
      open: true,
      message: 'Indent submitted for approval successfully',
      severity: 'success'
    });
    setSubmitDialogOpen(false);
    loadIndent();
  };

  const handleSubmit = async () => {
    const chainApprover = indent?.approvalChain?.[0]?.approver?._id || indent?.approvalChain?.[0]?.approver;
    const draft = indent?.draftApproverIds || [];
    const draftId = draft[0] ? (typeof draft[0] === 'object' && draft[0]?._id ? draft[0]._id : draft[0]) : null;
    const targetApproverId = chainApprover || draftId;

    if (targetApproverId) {
      try {
        await runSubmitWithApprovers([targetApproverId]);
      } catch (error) {
        setSnackbar({
          open: true,
          message: error.response?.data?.message || 'Error submitting indent',
          severity: 'error'
        });
      }
      return;
    }

    const prefilled = draft[0] && typeof draft[0] === 'object' && draft[0]._id ? [draft[0]] : [null];
    setSubmitSlots(prefilled);
    setSubmitDialogOpen(true);
  };

  const handleConfirmSubmitDialog = async () => {
    const approverIds = submitSlots.map((u) => u?._id).filter(Boolean);
    if (approverIds.length !== 1) {
      setSnackbar({
        open: true,
        message: 'Select Head of Department approver.',
        severity: 'error'
      });
      return;
    }
    try {
      await runSubmitWithApprovers(approverIds);
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error submitting indent',
        severity: 'error'
      });
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    
    try {
      await indentService.addComment(id, commentText);
      setSnackbar({
        open: true,
        message: 'Comment added successfully',
        severity: 'success'
      });
      setCommentText('');
      setCommentDialogOpen(false);
      loadIndent();
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error adding comment',
        severity: 'error'
      });
    }
  };

  const handleResubmitToProcurement = async () => {
    try {
      await indentService.resubmitToProcurement(id);
      setSnackbar({
        open: true,
        message: 'Requisition resubmitted to procurement successfully',
        severity: 'success'
      });
      loadIndent();
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error resubmitting requisition',
        severity: 'error'
      });
    }
  };

  // Format currency
  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 0
    }).format(value || 0);

  // Format date
  const formatDate = (date) => {
    if (!date) return '—';
    return dayjs(date).format('DD-MMM-YYYY');
  };

  // Get status color
  const getStatusColor = (status) => {
    const colors = {
      'Draft': 'default',
      'Submitted': 'info',
      'Under Review': 'warning',
      'Approved': 'success',
      'Rejected': 'error',
      'Rejected in Procurement': 'error',
      'Partially Fulfilled': 'info',
      'Fulfilled': 'success',
      'Cancelled': 'default'
    };
    return colors[status] || 'default';
  };

  const handleDeleteIndent = async () => {
    try {
      setDeleting(true);
      await indentService.deleteIndent(id);
      setSnackbar({
        open: true,
        message: 'Indent and all related records deleted successfully',
        severity: 'success'
      });
      setDeleteDialogOpen(false);
      setTimeout(() => {
        navigate('/general/indents');
      }, 1000);
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to delete indent',
        severity: 'error'
      });
    } finally {
      setDeleting(false);
    }
  };

  // Check permissions
  const canEdit =
    ['Draft', 'Rejected', 'Rejected in Procurement'].includes(indent?.status) &&
    indent?.requestedBy?._id === user?.id;
  const chain = indent?.approvalChain || [];
  const hasChain = chain.length > 0;
  const uid = user?.id ? String(user.id) : '';
  const userPendingInChain =
    hasChain &&
    chain.some((s) => {
      const aid = s.approver?._id != null ? String(s.approver._id) : String(s.approver || '');
      return aid === uid && s.status === 'pending';
    });
  const canApproveRejectChain =
    hasChain && userPendingInChain && ['Submitted', 'Under Review'].includes(indent?.status);
  const canApproveRejectLegacy =
    !hasChain &&
    ['super_admin', 'developer', 'admin', 'hr_manager'].includes(user?.role) &&
    ['Submitted', 'Under Review'].includes(indent?.status);
  const canApproveReject = canApproveRejectChain || canApproveRejectLegacy;
  const canSubmit = ['Draft', 'Rejected'].includes(indent?.status) && indent?.requestedBy?._id === user?.id;
  const canResubmitToProcurement =
    indent?.status === 'Rejected in Procurement' &&
    indent?.requestedBy?._id === user?.id;
  // A resubmission goes back to the exact person who rejected the indent
  const personName = (u) => (u && typeof u === 'object'
    ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || ''
    : '');
  const rejecterName = (() => {
    if (indent?.status === 'Rejected in Procurement') return personName(indent?.procurementRejection?.rejectedBy);
    if (indent?.status !== 'Rejected') return '';
    const history = Array.isArray(indent?.rejectionHistory) ? indent.rejectionHistory : [];
    const last = history.length ? history[history.length - 1].rejectedBy : null;
    const step = chain.find((s) => s.status === 'rejected');
    return personName(last) || personName(step?.approver);
  })();

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !indent) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Indent not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: embedded ? 0 : { xs: 1.5, sm: 3 } }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          {!hideBack && !embedded && (
            <IconButton onClick={() => navigate('/general/indents')} sx={{ flexShrink: 0 }}>
              <ArrowBackIcon />
            </IconButton>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant={embedded ? 'h5' : 'h4'} fontWeight={700} sx={{ fontSize: { xs: '1.25rem', sm: undefined }, wordBreak: 'break-word' }}>
              {indent.indentNumber}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
              {indent.title}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ '& .MuiButton-root': { minHeight: 40 } }}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => navigate(`/general/indents/${id}/print`)}
          >
            View/Print
          </Button>
          {!hideModuleActions && canEdit && (
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/general/indents/${id}/edit`)}
            >
              Edit
            </Button>
          )}
          {!hideModuleActions && canSubmit && (
            <Button
              variant="contained"
              color="success"
              startIcon={<SendIcon />}
              onClick={handleSubmit}
            >
              {indent?.status === 'Rejected'
                ? `Resubmit${rejecterName ? ` to ${rejecterName}` : ' for Approval'}`
                : 'Submit for Approval'}
            </Button>
          )}
          {!hideModuleActions && canResubmitToProcurement && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<ReplayIcon />}
              onClick={handleResubmitToProcurement}
            >
              {rejecterName ? `Resubmit to ${rejecterName}` : 'Resubmit to Procurement'}
            </Button>
          )}
          {!hideModuleActions && canApproveReject && (
            <>
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckCircleIcon />}
                onClick={handleApprove}
              >
                Approve
              </Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<CancelIcon />}
                onClick={handleReject}
              >
                Reject
              </Button>
            </>
          )}
          <Button
            variant="outlined"
            startIcon={<CommentIcon />}
            onClick={() => setCommentDialogOpen(true)}
          >
            Add Comment
          </Button>
          <Button
            variant="outlined"
            startIcon={<HistoryIcon />}
            onClick={() => setWorkflowHistoryOpen(true)}
          >
            Workflow History
          </Button>
          {!hideModuleActions && user?.role === 'developer' && (
            <Button
              variant="contained"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteDialogOpen(true)}
            >
              Delete (Developer)
            </Button>
          )}
        </Stack>
      </Stack>

      <Grid container spacing={3}>
        {/* Main Details */}
        <Grid item xs={12} md={8}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Details
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">
                    Title
                  </Typography>
                  <Typography variant="body1" fontWeight={500}>
                    {indent.title || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip 
                    label={indent.status} 
                    color={getStatusColor(indent.status)}
                    sx={{ mt: 0.5 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">
                    Priority
                  </Typography>
                  <Chip 
                    label={indent.priority} 
                    variant="outlined"
                    sx={{ mt: 0.5 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">
                    Department
                  </Typography>
                  <Typography variant="body1">
                    {indent.department?.name || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">
                    Category
                  </Typography>
                  <Typography variant="body1">
                    {indent.category || '—'}
                  </Typography>
                  {indent.category === 'Others' && indent.categoryOtherDescription?.trim() && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                      {indent.categoryOtherDescription.trim()}
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">
                    Requested By
                  </Typography>
                  <Typography variant="body1">
                    {indent.requestedBy?.firstName} {indent.requestedBy?.lastName}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">
                    Requested Date
                  </Typography>
                  <Typography variant="body1">
                    {formatDate(indent.requestedDate)}
                  </Typography>
                </Grid>
                {indent.requiredDate && (
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      Required Date
                    </Typography>
                    <Typography variant="body1">
                      {formatDate(indent.requiredDate)}
                    </Typography>
                  </Grid>
                )}
                {indent.approvedBy && (
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      Approved By
                    </Typography>
                    <Typography variant="body1">
                      {indent.approvedBy?.firstName} {indent.approvedBy?.lastName}
                    </Typography>
                  </Grid>
                )}
                {indent.approvedDate && (
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      Approved Date
                    </Typography>
                    <Typography variant="body1">
                      {formatDate(indent.approvedDate)}
                    </Typography>
                  </Grid>
                )}
                {(indent.rejectionReason || indent.lastRejectionReason) && (
                  <Grid item xs={12}>
                    <Alert
                      severity={indent.status === 'Rejected' ? 'error' : 'warning'}
                      sx={{
                        borderRadius: 2,
                        borderLeft: `6px solid ${indent.status === 'Rejected' ? '#d32f2f' : '#ed6c02'}`,
                        bgcolor: indent.status === 'Rejected' ? '#fdeded' : '#fff4e5'
                      }}
                    >
                      <Stack spacing={1}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                          <Typography variant="subtitle2" fontWeight={700} color={indent.status === 'Rejected' ? 'error.main' : 'warning.dark'}>
                            {indent.status === 'Rejected' ? '❌ Indent Rejected / Correction Requested' : '⚠️ Correction Notice & Resubmission to Senior'}
                          </Typography>
                          {indent.status === 'Submitted' && (
                            <Chip label="🔄 Updated Indent Resubmitted for Senior Approval" size="small" color="info" sx={{ fontWeight: 600 }} />
                          )}
                        </Stack>

                        <Typography variant="body2" fontWeight={600}>
                          {indent.status === 'Rejected' ? 'Rejection / Correction Reason:' : 'Previous Rejection / Correction Requested by Senior:'}
                        </Typography>
                        <Typography variant="body2" sx={{ bgcolor: 'rgba(255,255,255,0.9)', p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', fontStyle: 'italic', fontWeight: 500 }}>
                          "{indent.rejectionReason || indent.lastRejectionReason}"
                        </Typography>
                      </Stack>
                    </Alert>
                  </Grid>
                )}
                {indent.procurementRejection?.observation?.trim() && (
                  <Grid item xs={12}>
                    <Alert severity="warning" variant="filled">
                      <Typography variant="body2" fontWeight={700}>
                        Procurement Observation
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                        {indent.procurementRejection.observation.trim()}
                      </Typography>
                    </Alert>
                  </Grid>
                )}
                {Array.isArray(indent.attachments) && indent.attachments.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Attachments ({indent.attachments.length})
                    </Typography>
                    <Stack spacing={1}>
                      {indent.attachments.map((att, idx) => {
                        const fileHref = resolveUploadFileHref(att.path);
                        const isImage = /\.(png|jpe?g|webp|gif)$/i.test(att.path || att.filename || '');
                        const name = att.filename || `Attachment ${idx + 1}`;
                        return (
                          <Paper
                            key={att._id || idx}
                            variant="outlined"
                            sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#fafafa' }}
                          >
                            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                                <AttachFileIcon color="primary" fontSize="small" />
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography variant="body2" fontWeight={600} noWrap>
                                    {name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    Uploaded {att.uploadedAt ? dayjs(att.uploadedAt).format('DD-MMM-YYYY HH:mm') : ''}
                                  </Typography>
                                </Box>
                              </Stack>
                              {fileHref && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<OpenInNewIcon fontSize="small" />}
                                  href={fileHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  sx={{ textTransform: 'none' }}
                                >
                                  View / Download
                                </Button>
                              )}
                            </Stack>
                            {isImage && fileHref && (
                              <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px dashed #e0e0e0' }}>
                                <Box
                                  component="img"
                                  src={fileHref}
                                  alt={name}
                                  sx={{
                                    maxHeight: 220,
                                    maxWidth: '100%',
                                    objectFit: 'contain',
                                    borderRadius: 1,
                                    border: '1px solid #eee'
                                  }}
                                />
                              </Box>
                            )}
                          </Paper>
                        );
                      })}
                    </Stack>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Initiator & Approver Signatures
              </Typography>
              <TableContainer
                component={Box}
                sx={{
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  border: '1.5px solid #334155'
                }}
              >
                <Table
                  size="small"
                  sx={{
                    '& th': {
                      bgcolor: '#f1f5f9',
                      fontWeight: 800,
                      fontSize: 12,
                      border: '1px solid #cbd5e1',
                      py: 0.5,
                      px: 0.8
                    },
                    '& td': {
                      fontSize: 12,
                      border: '1px solid #cbd5e1',
                      py: 0.45,
                      px: 0.8,
                      verticalAlign: 'middle'
                    }
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell>Role</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="center">Digital Signature</TableCell>
                      <TableCell>Date & Time</TableCell>
                      <TableCell>Comment / Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(() => {
                      const initiatorName =
                        indent.signatures?.requester?.name ||
                        approverDisplayName(indent.requestedBy) ||
                        '—';
                      const initiatorAt =
                        indent.signatures?.requester?.date ||
                        indent.requestedDate ||
                        indent.createdAt ||
                        null;
                      const chainLabels = ['Head of Department', 'GM/PD', 'SVP/AVP'];
                      const chain = Array.isArray(indent.approvalChain) ? indent.approvalChain : [];
                      const rows = [
                        {
                          key: 'initiator',
                          role: 'Initiator / Requester',
                          name: initiatorName,
                          status: 'Submitted',
                          statusColor: 'info',
                          signatureUser: indent.requestedBy,
                          showSignature: Boolean(indent.requestedBy?.digitalSignature),
                          actedAt: initiatorAt,
                          comment: '—'
                        },
                        ...chain.map((step, idx) => {
                          const st = step?.status || 'pending';
                          const label =
                            step?.role ||
                            step?.label ||
                            chainLabels[idx] ||
                            `Approver ${idx + 1}`;
                          return {
                            key: `approver-${idx}`,
                            role: label,
                            name: step?.approver ? approverDisplayName(step.approver) : '—',
                            status:
                              st === 'pending'
                                ? 'Pending'
                                : st === 'approved'
                                  ? 'Approved'
                                  : st === 'rejected'
                                    ? 'Rejected'
                                    : st,
                            statusColor:
                              st === 'approved' ? 'success' : st === 'rejected' ? 'error' : 'default',
                            signatureUser: step?.approver || null,
                            showSignature: st === 'approved' && Boolean(step?.approver?.digitalSignature),
                            actedAt: step?.actedAt || null,
                            comment:
                              step?.comment ||
                              (st === 'rejected'
                                ? indent.rejectionReason || indent.lastRejectionReason || '—'
                                : '—')
                          };
                        })
                      ];
                      return rows.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell sx={{ fontWeight: 800 }}>{row.role}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={row.status}
                              color={row.statusColor}
                              variant={row.status === 'Pending' ? 'outlined' : 'filled'}
                            />
                          </TableCell>
                          <TableCell align="center">
                            {row.showSignature ? (
                              <Box
                                sx={{
                                  maxHeight: 28,
                                  display: 'flex',
                                  justifyContent: 'center',
                                  '& img': { maxHeight: 28, width: 'auto', objectFit: 'contain' }
                                }}
                              >
                                <DigitalSignatureImage
                                  userOrPath={row.signatureUser}
                                  alt={`Signature ${row.role}`}
                                  sx={{ maxHeight: 28, maxWidth: 100 }}
                                />
                              </Box>
                            ) : row.status === 'Approved' || row.key === 'initiator' ? (
                              <Typography variant="caption" color="text.secondary">
                                {row.key === 'initiator' && !row.showSignature
                                  ? 'No signature on file'
                                  : 'Approved'}
                              </Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                —
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.actedAt ? dayjs(row.actedAt).format('DD-MMM-YYYY HH:mm') : '—'}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {row.comment || '—'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Items ({indent.items?.length || 0})
              </Typography>
              <ChargedToPanel chargeTo={indent.chargeTo} items={indent.items} />
              <ProjectBudgetCheck indentId={indent._id} chargeTo={indent.chargeTo} />
              {indent.items && indent.items.length > 0 ? (
                <TableContainer sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell><strong>S#</strong></TableCell>
                        <TableCell><strong>Item Name</strong></TableCell>
                        <TableCell><strong>Item Description</strong></TableCell>
                        <TableCell><strong>Brand</strong></TableCell>
                        <TableCell><strong>Unit</strong></TableCell>
                        <TableCell align="right"><strong>Qty</strong></TableCell>
                        <TableCell><strong>Purpose</strong></TableCell>
                        <TableCell align="right"><strong>Est. Cost</strong></TableCell>
                        <TableCell align="right"><strong>Total</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {indent.items.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell>{(index + 1).toString().padStart(2, '0')}</TableCell>
                          <TableCell>{item.itemName || '—'}</TableCell>
                          <TableCell>{item.description || '—'}</TableCell>
                          <TableCell>{item.brand || '—'}</TableCell>
                          <TableCell>{item.unit || '—'}</TableCell>
                          <TableCell align="right">{item.quantity ?? '—'}</TableCell>
                          <TableCell>{item.purpose || '—'}</TableCell>
                          <TableCell align="right">{formatCurrency(item.estimatedCost)}</TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" fontWeight={600}>
                              {formatCurrency((item.estimatedCost || 0) * (item.quantity || 0))}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No items found
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Sidebar */}
        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Financial Summary
              </Typography>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Total Estimated Cost
                  </Typography>
                  <Typography variant="h5" color="primary" fontWeight={700}>
                    {formatCurrency(indent.totalEstimatedCost)}
                  </Typography>
                </Box>
                {indent.amount > 0 && (
                  <>
                    <Divider />
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Amount
                      </Typography>
                      <Typography variant="h6">
                        {formatCurrency(indent.amount)}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Remaining Amount
                      </Typography>
                      <Typography 
                        variant="h6" 
                        color={indent.amount - indent.totalEstimatedCost < 0 ? 'error' : 'success'}
                      >
                        {formatCurrency(indent.amount - indent.totalEstimatedCost)}
                      </Typography>
                    </Box>
                  </>
                )}
                {indent.referenceNo && (
                  <>
                    <Divider />
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Reference No
                      </Typography>
                      <Typography variant="body1">
                        {indent.referenceNo}
                      </Typography>
                    </Box>
                  </>
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* Linked Purchase Orders */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight={600}>
                  Purchase Orders {linkedPOs.length > 0 && `(${linkedPOs.length})`}
                </Typography>
                {loadingPOs && <CircularProgress size={18} />}
              </Stack>
              {linkedPOs.length === 0 && !loadingPOs ? (
                <Typography variant="body2" color="text.secondary">
                  No POs created for this requisition yet.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {linkedPOs.map((po) => (
                    <Box key={po._id} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                        <Stack direction="row" spacing={1} alignItems="center">
                          <POIcon fontSize="small" color="primary" />
                          <Box>
                            <Typography variant="body2" fontWeight={600}>
                              {po.orderNumber}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {po.vendor?.name || '—'}
                            </Typography>
                          </Box>
                        </Stack>
                        <Chip
                          label={po.status}
                          size="small"
                          color={
                            po.status === 'Received' ? 'success'
                            : po.status === 'Approved' || po.status === 'Ordered' ? 'primary'
                            : po.status === 'Cancelled' || po.status === 'Rejected' ? 'error'
                            : po.status === 'Draft' ? 'default'
                            : 'warning'
                          }
                        />
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          {po.items?.length || 0} item(s)
                        </Typography>
                        <Typography variant="caption" fontWeight={600}>
                          {new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(po.totalAmount || 0)}
                        </Typography>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>

          {/* Comments */}
          {indent.comments && indent.comments.length > 0 && (
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                  Comments ({indent.comments.length})
                </Typography>
                <Stack spacing={2}>
                  {indent.comments.map((comment, index) => (
                    <Box key={index}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <Avatar sx={{ width: 32, height: 32 }}>
                          {comment.user?.firstName?.[0]}{comment.user?.lastName?.[0]}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" fontWeight={600}>
                            {comment.user?.firstName} {comment.user?.lastName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {dayjs(comment.createdAt).format('DD-MMM-YYYY HH:mm')}
                          </Typography>
                        </Box>
                      </Stack>
                      <Typography variant="body2" sx={{ pl: 5 }}>
                        {comment.comment}
                      </Typography>
                      {index < indent.comments.length - 1 && <Divider sx={{ mt: 2 }} />}
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>

      <Dialog open={submitDialogOpen} onClose={() => setSubmitDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{indent?.status === 'Rejected' ? 'Resubmit for Approval' : 'Select Head of Department Approver'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 0.5 }}>
            Select Head of Department approver to review this indent.
          </Typography>
          <Stack spacing={2}>
            {['Head of Department'].map((label) => (
              <Autocomplete
                key={label}
                options={approverSearchOptions}
                loading={approverSearchLoading}
                getOptionLabel={(option) => approverDisplayName(option)}
                isOptionEqualToValue={(a, b) => !!a && !!b && a._id === b._id}
                value={submitSlots[0] || null}
                onChange={(_, v) => {
                  setSubmitSlots([v]);
                }}
                onInputChange={(_, input, reason) => {
                  if (reason === 'input') {
                    loadApproverOptions(input);
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={label}
                    size="small"
                    placeholder="Search user…"
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {approverSearchLoading ? <CircularProgress color="inherit" size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      )
                    }}
                  />
                )}
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubmitDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmSubmitDialog} variant="contained">
            {indent?.status === 'Rejected' ? 'Resubmit' : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Comment Dialog */}
      <Dialog open={commentDialogOpen} onClose={() => setCommentDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Comment</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Enter your comment..."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCommentDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAddComment} variant="contained" disabled={!commentText.trim()}>
            Add Comment
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />

      <WorkflowHistoryDialog
        open={workflowHistoryOpen}
        onClose={() => setWorkflowHistoryOpen(false)}
        document={indent}
        documentType="indent"
      />

      {/* Delete Confirmation Dialog (Developer Only) */}
      <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Indent (Developer Only)</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to permanently delete indent <strong>{indent?.indentNumber}</strong>?
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            This will permanently delete this indent and all related records across Procurement, Pre-Audit, Finance, and CEO Office. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Cancel</Button>
          <Button onClick={handleDeleteIndent} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete Everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default IndentDetail;

