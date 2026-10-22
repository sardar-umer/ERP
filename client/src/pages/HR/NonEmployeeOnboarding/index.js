import React, { useState, useEffect } from 'react';
import { 
  Alert,
  Box, 
  Button, 
  Paper, 
  Typography, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Checkbox,
  Grid,
  Tooltip
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Visibility as ViewIcon, Print as PrintIcon } from '@mui/icons-material';
import { DigitalSignatureImage } from '../../../components/common/DigitalSignatureImage';
import { formatDateTime } from '../../../utils/dateUtils';
import { alpha, useTheme } from '@mui/material/styles';
import nonEmployeeService from '../../../services/nonEmployeeService';
import NonEmployeeForm from './NonEmployeeForm';
import ResubmissionHistory from './ResubmissionHistory';
import { useAuth } from '../../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { printNewHiringApproval } from '../../../utils/newHiringApprovalPrint';
import {
  formatNewHiringPackage,
  getNewHiringAuthorityCards,
  getNewHiringEmployees
} from '../../../utils/newHiringEmployees';

const NonEmployeeOnboarding = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [approvalDialog, setApprovalDialog] = useState({ open: false, record: null });
  const [approvalComments, setApprovalComments] = useState('');
  const [approvalSignature, setApprovalSignature] = useState('');
  const [approvalAgree, setApprovalAgree] = useState(false);
  const [approvalType, setApprovalType] = useState('HOD'); // 'HOD' or 'AVP'
  const [rejectDialog, setRejectDialog] = useState({ open: false, record: null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, record: null });
  const [viewDialog, setViewDialog] = useState({ open: false, record: null });
  const [editData, setEditData] = useState(null);
  const [formInitialComment, setFormInitialComment] = useState('');
  const [formInitialObsResponses, setFormInitialObsResponses] = useState({});
  const [detailsResubmitComment, setDetailsResubmitComment] = useState('');
  const [detailsObsResponses, setDetailsObsResponses] = useState({});
  const [detailsResubmitting, setDetailsResubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const { user } = useAuth();
  const theme = useTheme();

  const observationKey = (obs, idx) => (obs?._id ? String(obs._id) : `idx-${idx}`);

  const openViewDetails = (record) => {
    setDetailsResubmitComment('');
    setDetailsObsResponses({});
    setViewDialog({ open: true, record });
  };

  const openEditResubmit = (record, { comment = '', obsResponses = {} } = {}) => {
    setFormInitialComment(comment);
    setFormInitialObsResponses(obsResponses);
    setEditData(record);
    setOpenForm(true);
  };

  const handleDetailsResubmit = async () => {
    const record = viewDialog.record;
    if (!record?._id) return;
    if (!detailsResubmitComment.trim()) {
      toast.error('Please add your comment on the observations before resubmitting');
      return;
    }
    const returnObservations = Array.isArray(record.returnObservations)
      ? record.returnObservations.filter((o) => String(o?.observation || '').trim())
      : [];
    const employees = getNewHiringEmployees(record).map((e) => ({
      name: String(e.name || [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || '').trim(),
      cnic: String(e.cnic || '').trim(),
      designation: String(e.designation || e.role || '').trim(),
      departmentSubject: String(e.departmentSubject || e.department || '').trim(),
      project: String(e.project || '').trim(),
      location: String(e.location || '').trim(),
      currentPackageMonthly: String(e.currentPackageMonthly ?? e.expectedWages ?? '').trim(),
      tentativeDoj: e.tentativeDoj || null,
      remark: String(e.remark || e.justification || '').trim()
    }));
    const inferredResubmitStatus =
      record.returnedFromStatus
      || (record.workflowStatus === 'Rejected by CEO' ? 'Forwarded to CEO' : '')
      || (record.srDirectorApprovedBy ? 'Forwarded to CEO' : '')
      || (record.chairmanApprovedBy ? 'Pending Sr Director' : '')
      || (record.avpApprovedBy ? 'Pending Chairman' : '')
      || (record.hodApprovedBy ? 'Pending AVP' : '')
      || '';

    setDetailsResubmitting(true);
    try {
      await nonEmployeeService.updateRecord(record._id, {
        employees,
        assignedHod: record.assignedHod?._id || record.assignedHod || '',
        assignedSrDirector: record.assignedSrDirector?._id || record.assignedSrDirector || '',
        assignedAvp: record.assignedAvp?._id || record.assignedAvp || '',
        assignedChairman: record.assignedChairman?._id || record.assignedChairman || '',
        requesterSignature:
          user?.digitalSignature
          || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.email || ''),
        ...(inferredResubmitStatus
          ? { resubmitToStatus: inferredResubmitStatus, returnedFromStatus: inferredResubmitStatus }
          : {}),
        resubmitComment: detailsResubmitComment.trim(),
        observationResponses: JSON.stringify(
          returnObservations.map((obs, idx) => ({
            observationId: obs?._id ? String(obs._id) : '',
            index: idx,
            response: String(detailsObsResponses[observationKey(obs, idx)] || '').trim()
          }))
        )
      });
      toast.success('Resubmitted with your comments on the observations');
      setViewDialog({ open: false, record: null });
      fetchRecords();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to resubmit');
    } finally {
      setDetailsResubmitting(false);
    }
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const response = await nonEmployeeService.getRecords();
      setRecords(response.data.data || []);
    } catch (error) {
      toast.error('Failed to load records');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const openApproveDialog = (record, type) => {
    setApprovalDialog({ open: true, record });
    setApprovalComments('');
    setApprovalSignature(
      user?.digitalSignature ||
      (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.email || '')
    );
    setApprovalAgree(false);
    setApprovalType(type);
  };

  const handleApproveSubmit = async () => {
    if (!approvalAgree) {
      toast.error('Please confirm approval checkbox');
      return;
    }
    const item = approvalDialog.record;
    if (!item) return;

    setActionLoading(true);
    try {
      if (approvalType === 'HOD') {
        await nonEmployeeService.approveByHOD(item._id, {
          comments: approvalComments,
          signature: approvalSignature.trim()
        });
      } else if (approvalType === 'SrDirector') {
        await nonEmployeeService.approveBySrDirector(item._id, {
          comments: approvalComments,
          signature: approvalSignature.trim()
        });
      } else if (approvalType === 'Chairman') {
        await nonEmployeeService.approveByChairman(item._id, {
          comments: approvalComments,
          signature: approvalSignature.trim()
        });
      } else {
        await nonEmployeeService.approveByAVP(item._id, {
          comments: approvalComments,
          signature: approvalSignature.trim()
        });
      }
      toast.success('Approved successfully');
      setApprovalDialog({ open: false, record: null });
      fetchRecords();
    } catch (error) {
      toast.error('Failed to approve');
      console.error(error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSubmit = async () => {
    const item = rejectDialog.record;
    if (!item) return;

    if (!approvalComments.trim()) {
      toast.error('Please provide rejection comments');
      return;
    }

    setActionLoading(true);
    try {
      if (approvalType === 'HOD') {
        await nonEmployeeService.rejectByHOD(item._id, {
          comments: approvalComments,
          signature: approvalSignature.trim()
        });
      } else if (approvalType === 'SrDirector') {
        await nonEmployeeService.rejectBySrDirector(item._id, {
          comments: approvalComments,
          signature: approvalSignature.trim()
        });
      } else if (approvalType === 'Chairman') {
        await nonEmployeeService.rejectByChairman(item._id, {
          comments: approvalComments,
          signature: approvalSignature.trim()
        });
      } else {
        await nonEmployeeService.rejectByAVP(item._id, {
          comments: approvalComments,
          signature: approvalSignature.trim()
        });
      }
      toast.success('Rejected successfully');
      setRejectDialog({ open: false, record: null });
      fetchRecords();
    } catch (error) {
      toast.error('Failed to reject');
      console.error(error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSubmit = async () => {
    const item = deleteDialog.record;
    if (!item) return;

    setActionLoading(true);
    try {
      await nonEmployeeService.deleteRecord(item._id);
      toast.success('Record deleted successfully');
      setDeleteDialog({ open: false, record: null });
      fetchRecords();
    } catch (error) {
      toast.error('Failed to delete record');
      console.error(error);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">New-Hiring Approval</Typography>
        <Button 
          variant="contained" 
          color="primary" 
          startIcon={<AddIcon />}
          onClick={() => {
            setEditData(null);
            setOpenForm(true);
          }}
        >
          New Record
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Record #</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>CNIC/Passport No.</TableCell>
              <TableCell>Designation</TableCell>
              <TableCell>Department/Subject</TableCell>
              <TableCell>Project</TableCell>
              <TableCell>Location</TableCell>
              <TableCell align="right">Current Package Monthly</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Approval Authority</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((record) => {
              const authorityMap = {
                'Pending HOD HR': 'HOD HR',
                'Pending AVP': 'AVP (Taj Fahad Farid)',
                'Pending Chairman': 'Chairman Steering Committee',
                'Pending Sr Director': 'Sr Director (Hamza Tanveer)',
                'Forwarded to CEO': 'CEO Secretariat',
                'Approved by CEO': 'Approved',
                'Rejected by CEO': 'Returned to Initiator (CEO Rejected)',
                'Returned': 'Returned to Initiator'
              };
              const authority = authorityMap[record.workflowStatus] || record.workflowStatus;

              const userId = String(user?.id || user?._id || '');
              const sameAssignee = (field) => {
                const assigned = String(field?._id || field || '');
                return Boolean(userId && assigned && userId === assigned);
              };
              // Dev-only: Hamza Tanveer is Sr Director for New-Hiring Approval
              const isDevSrDirector = process.env.NODE_ENV !== 'production' && (
                String(user?.email || '').toLowerCase() === 'hamzatanveer@tovus.net'
                || `${user?.firstName || ''} ${user?.lastName || ''}`.trim().toLowerCase().replace(/\s+/g, '') === 'hamzatanveer'
              );
              const isPendingHOD = record.workflowStatus === 'Pending HOD HR' && sameAssignee(record.assignedHod);
              const isPendingAVP = record.workflowStatus === 'Pending AVP' && sameAssignee(record.assignedAvp);
              const isPendingChairman = record.workflowStatus === 'Pending Chairman' && sameAssignee(record.assignedChairman);
              const isPendingSrDirector = record.workflowStatus === 'Pending Sr Director'
                && (sameAssignee(record.assignedSrDirector) || isDevSrDirector);
              const isPendingAuthority = isPendingHOD || isPendingAVP || isPendingChairman || isPendingSrDirector;
              const currentPendingType = isPendingHOD
                ? 'HOD'
                : isPendingAVP
                  ? 'AVP'
                  : isPendingChairman
                    ? 'Chairman'
                    : isPendingSrDirector
                      ? 'SrDirector'
                      : null;
              const currentPendingLabel = currentPendingType === 'SrDirector' ? 'Sr Director' : currentPendingType;
              
              const isDeveloper = user?.email === 'developer@tovus.net';
              const initiatorId = String(record.initiator?._id || record.initiator || '');
              const isInitiator = Boolean(userId && initiatorId && userId === initiatorId);
              const isInitiatorEditable = ['Pending HOD HR', 'Draft', 'Returned', 'Rejected by CEO'].includes(record.workflowStatus)
                && isInitiator;
              const needsResubmit = ['Returned', 'Rejected by CEO'].includes(record.workflowStatus) && isInitiator;
              const canEdit = isDeveloper || isInitiatorEditable;
              const canDelete = isInitiatorEditable;
              const feedbackComments = record.returnComments || record.rejectionComments || '';
              const feedbackObservations = Array.isArray(record.returnObservations)
                ? record.returnObservations.filter((o) => String(o?.observation || '').trim())
                : [];
              const feedbackSummary = [
                feedbackComments,
                ...feedbackObservations.map((o) => `[${o.severity || 'medium'}] ${o.observation}`)
              ].filter(Boolean).join('\n');

              const history = Array.isArray(record.resubmissionHistory) ? record.resubmissionHistory : [];
              const latestResubmission = history.length ? history[history.length - 1] : null;

              const employees = getNewHiringEmployees(record);
              const numEmployees = employees.length;
              const empName = (e) =>
                e?.name
                || [e?.firstName, e?.lastName].filter(Boolean).join(' ').trim()
                || '—';
              const empDesignation = (e) => e?.designation || e?.role || '—';
              const empPackage = (e) => e?.currentPackageMonthly ?? e?.expectedWages;
              const displayName = numEmployees > 0
                ? employees.map(empName).join(', ')
                : 'N/A';
              const displayDesignation = numEmployees > 0
                ? employees.map(empDesignation).join(', ')
                : 'N/A';
              const displayCnic = numEmployees > 0
                ? employees.map((e) => e.cnic || '—').join(', ')
                : 'N/A';
              const displayDept = numEmployees > 0
                ? employees.map((e) => e.departmentSubject || '—').join(', ')
                : 'N/A';
              const displayProject = numEmployees > 0
                ? employees.map((e) => e.project || '—').join(', ')
                : 'N/A';
              const displayLocation = numEmployees > 0
                ? employees.map((e) => e.location || '—').join(', ')
                : 'N/A';
              const displayPackage = numEmployees > 0
                ? employees.map((e) => formatNewHiringPackage(empPackage(e))).join(', ')
                : 'N/A';

              return (
                <TableRow key={record._id}>
                  <TableCell>{record.recordNumber}</TableCell>
                  <TableCell>{displayName}</TableCell>
                  <TableCell>{displayCnic}</TableCell>
                  <TableCell>{displayDesignation}</TableCell>
                  <TableCell>{displayDept}</TableCell>
                  <TableCell>{displayProject}</TableCell>
                  <TableCell>{displayLocation}</TableCell>
                  <TableCell align="right">{displayPackage}</TableCell>
                  <TableCell>
                  <Chip 
                    label={record.workflowStatus} 
                    color={
                      record.workflowStatus === 'Approved by CEO' ? 'success' :
                      record.workflowStatus === 'Rejected by CEO' ? 'error' : 'warning'
                    } 
                    size="small" 
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight="bold">
                    {authority}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={1} alignItems="center">
                    <IconButton 
                      color="info" 
                      size="small" 
                      title="View Details"
                      onClick={() => openViewDetails(record)}
                    >
                      <ViewIcon fontSize="small" />
                    </IconButton>
                    {isPendingAuthority && (
                      <>
                        <Button 
                          variant="contained" 
                          color="success" 
                          size="small" 
                          onClick={() => openApproveDialog(record, currentPendingType)}
                        >
                          Approve ({currentPendingLabel})
                        </Button>
                        <Button 
                          variant="contained" 
                          color="error" 
                          size="small" 
                          onClick={() => {
                            setRejectDialog({ open: true, record });
                            setApprovalComments('');
                            setApprovalSignature(user?.digitalSignature || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.email || ''));
                            setApprovalType(currentPendingType);
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {(canEdit || canDelete) && (
                      <React.Fragment>
                        {canEdit && (
                          <Tooltip
                            title={
                              needsResubmit
                                ? `Edit & resubmit to ${
                                    {
                                      'Pending HOD HR': 'HOD HR',
                                      'Pending AVP': 'AVP',
                                      'Pending Chairman': 'Chairman',
                                      'Pending Sr Director': 'Sr Director',
                                      'Forwarded to CEO': 'CEO'
                                    }[record.returnedFromStatus] || 'the rejector'
                                  }`
                                : 'Edit'
                            }
                          >
                            <Button
                              variant={needsResubmit ? 'contained' : 'text'}
                              color="primary"
                              size="small"
                              startIcon={<EditIcon fontSize="small" />}
                              onClick={() => openEditResubmit(record)}
                            >
                              {needsResubmit ? 'Edit & Resubmit' : 'Edit'}
                            </Button>
                          </Tooltip>
                        )}
                        {canDelete && (
                          <IconButton 
                            color="error" 
                            size="small" 
                            onClick={() => setDeleteDialog({ open: true, record })}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </React.Fragment>
                    )}
                    {!needsResubmit && latestResubmission?.initiatorComment && (
                      <Tooltip
                        title={
                          <Box sx={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>
                            <strong>Initiator comment:</strong> {latestResubmission.initiatorComment}
                          </Box>
                        }
                      >
                        <Chip
                          size="small"
                          color="info"
                          variant="outlined"
                          label={history.length > 1 ? `Resubmitted (${history.length}x)` : 'Resubmitted'}
                          onClick={() => openViewDetails(record)}
                        />
                      </Tooltip>
                    )}
                    {needsResubmit && feedbackSummary && (
                      <Tooltip
                        title={
                          <Box sx={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>
                            {feedbackSummary}
                          </Box>
                        }
                      >
                        <Chip
                          size="small"
                          color="warning"
                          variant="outlined"
                          label={
                            feedbackObservations.length
                              ? `${feedbackObservations.length} observation(s)`
                              : 'See return remarks'
                          }
                        />
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
            {records.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} align="center">
                  {loading ? 'Loading...' : 'No records found.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <NonEmployeeForm 
        open={openForm} 
        editData={editData}
        initialResubmitComment={formInitialComment}
        initialObservationResponses={formInitialObsResponses}
        onClose={() => {
          setOpenForm(false);
          setFormInitialComment('');
          setFormInitialObsResponses({});
        }} 
        onSuccess={() => {
          setOpenForm(false);
          setFormInitialComment('');
          setFormInitialObsResponses({});
          setViewDialog({ open: false, record: null });
          fetchRecords();
        }} 
      />

      <Dialog open={approvalDialog.open} onClose={() => setApprovalDialog({ open: false, record: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Approve New-Hiring Approval</DialogTitle>
        <DialogContent dividers>
          <Box mb={2}>
            <Typography variant="subtitle1" fontWeight="bold">
              Batch Record: {approvalDialog.record?.recordNumber}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Contains {getNewHiringEmployees(approvalDialog.record).length} employees
            </Typography>
          </Box>
          <TextField
            label="Comments"
            fullWidth
            multiline
            rows={3}
            value={approvalComments}
            onChange={(e) => setApprovalComments(e.target.value)}
            margin="normal"
          />
          <Box mt={2} p={2} bgcolor="background.default" borderRadius={1}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={approvalAgree}
                  onChange={(e) => setApprovalAgree(e.target.checked)}
                  color="primary"
                />
              }
              label="I hereby approve this onboarding record and confirm the details are correct."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApprovalDialog({ open: false, record: null })}>Cancel</Button>
          <Button
            onClick={handleApproveSubmit}
            variant="contained"
            color="success"
            disabled={!approvalAgree || actionLoading}
          >
            {actionLoading ? 'Approving...' : 'Confirm Approval'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rejectDialog.open} onClose={() => setRejectDialog({ open: false, record: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Reject New-Hiring Approval</DialogTitle>
        <DialogContent dividers>
          <Box mb={2}>
            <Typography variant="subtitle1" fontWeight="bold">
              Batch Record: {rejectDialog.record?.recordNumber}
            </Typography>
          </Box>
          <TextField
            label="Rejection Comments"
            fullWidth
            required
            multiline
            rows={3}
            value={approvalComments}
            onChange={(e) => setApprovalComments(e.target.value)}
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialog({ open: false, record: null })}>Cancel</Button>
          <Button
            onClick={handleRejectSubmit}
            variant="contained"
            color="error"
            disabled={!approvalComments.trim() || actionLoading}
          >
            {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, record: null })} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Record</DialogTitle>
        <DialogContent dividers>
          <Typography>Are you sure you want to delete the batch onboarding record <strong>{deleteDialog.record?.recordNumber}</strong>?</Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>This action cannot be undone and will delete all employees in this batch.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, record: null })}>Cancel</Button>
          <Button
            onClick={handleDeleteSubmit}
            variant="contained"
            color="error"
            disabled={actionLoading}
          >
            {actionLoading ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={viewDialog.open} onClose={() => setViewDialog({ open: false, record: null })} maxWidth="xl" fullWidth>
        <DialogTitle sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05), borderBottom: '1px solid', borderColor: 'divider', fontWeight: 700 }}>
          New-Hiring Approval Details - {viewDialog.record?.recordNumber}
        </DialogTitle>
        <DialogContent sx={{ p: { xs: 2, md: 3 } }}>
          {(() => {
            const record = viewDialog.record;
            if (!record) return null;
            const userId = String(user?.id || user?._id || '');
            const initiatorId = String(record.initiator?._id || record.initiator || '');
            const isInitiator = Boolean(userId && initiatorId && userId === initiatorId);
            const isDeveloper = user?.email === 'developer@tovus.net';
            const needsResubmit = ['Returned', 'Rejected by CEO'].includes(record.workflowStatus)
              && (isInitiator || isDeveloper);
            const returnObservations = Array.isArray(record.returnObservations)
              ? record.returnObservations.filter((o) => String(o?.observation || '').trim())
              : [];
            if (!(record.workflowStatus === 'Returned' || record.workflowStatus === 'Rejected by CEO')) {
              return null;
            }
            return (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
                Returned to initiator for revision
                {record.returnedFromStatus
                  ? ` → will go back to ${record.returnedFromStatus}`
                  : ''}
              </Typography>
              {(record.returnComments || record.rejectionComments) && (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
                  <strong>Comments:</strong> {record.returnComments || record.rejectionComments}
                </Typography>
              )}
              {returnObservations.length > 0 && (
                <Box>
                  <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
                    Observations ({returnObservations.length})
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {returnObservations.map((obs, idx) => (
                      <Box component="li" key={obs._id || idx} sx={{ mb: 1.25 }}>
                        <Typography variant="body2">
                          <strong style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
                            [{obs.severity || 'medium'}]
                          </strong>{' '}
                          {obs.observation}
                        </Typography>
                        {needsResubmit && (
                          <TextField
                            size="small"
                            fullWidth
                            multiline
                            minRows={1}
                            placeholder="Your response to this observation (optional)"
                            value={detailsObsResponses[observationKey(obs, idx)] || ''}
                            onChange={(e) => {
                              const key = observationKey(obs, idx);
                              setDetailsObsResponses((prev) => ({ ...prev, [key]: e.target.value }));
                            }}
                            sx={{ mt: 0.75, bgcolor: 'background.paper' }}
                          />
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
              {needsResubmit && (
                <TextField
                  label="Your comment on the observations (required to resubmit)"
                  placeholder="Explain what you changed or clarify the observations raised"
                  fullWidth
                  required
                  multiline
                  minRows={3}
                  value={detailsResubmitComment}
                  onChange={(e) => setDetailsResubmitComment(e.target.value)}
                  error={!detailsResubmitComment.trim()}
                  helperText={
                    detailsResubmitComment.trim()
                      ? 'This comment will be sent with the resubmitted record.'
                      : 'A comment is required before you can resubmit.'
                  }
                  sx={{ mt: 2, bgcolor: 'background.paper' }}
                />
              )}
              {!needsResubmit && (
                <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                  Waiting for the initiator to comment on observations and resubmit.
                </Typography>
              )}
            </Alert>
            );
          })()}
          <Box mb={4}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 1, display: 'block', mb: 1.5 }}>
              Candidates recommended for hiring ({getNewHiringEmployees(viewDialog.record).length})
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 1000 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell align="center" sx={{ width: 56 }}><b>Sr No</b></TableCell>
                    <TableCell><b>Name</b></TableCell>
                    <TableCell><b>CNIC/Passport No.</b></TableCell>
                    <TableCell><b>Designation</b></TableCell>
                    <TableCell><b>Department/Subject</b></TableCell>
                    <TableCell><b>Project</b></TableCell>
                    <TableCell><b>Location</b></TableCell>
                    <TableCell align="right"><b>Current Package Monthly</b></TableCell>
                    <TableCell><b>Tentative DOJ</b></TableCell>
                    <TableCell><b>Remark</b></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {getNewHiringEmployees(viewDialog.record).map((emp, index) => {
                    const name = emp.name || [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim() || '—';
                    const designation = emp.designation || emp.role || '—';
                    const pkg = emp.currentPackageMonthly ?? emp.expectedWages;
                    const doj = emp.tentativeDoj
                      ? new Date(emp.tentativeDoj).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—';
                    const pkgLabel = formatNewHiringPackage(pkg);
                    return (
                      <TableRow key={index}>
                        <TableCell align="center">{index + 1}</TableCell>
                        <TableCell>{name}</TableCell>
                        <TableCell>{emp.cnic || '—'}</TableCell>
                        <TableCell>{designation}</TableCell>
                        <TableCell>{emp.departmentSubject || '—'}</TableCell>
                        <TableCell>{emp.project || '—'}</TableCell>
                        <TableCell>{emp.location || '—'}</TableCell>
                        <TableCell align="right">
                          {pkgLabel === '—' ? '—' : `${pkgLabel}${/^-?\d+(\.\d+)?$/.test(String(pkg || '').trim()) ? ' PKR' : ''}`}
                        </TableCell>
                        <TableCell>{doj}</TableCell>
                        <TableCell>{emp.remark || emp.justification || '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                  {getNewHiringEmployees(viewDialog.record).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} align="center">No candidates</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>

          <ResubmissionHistory record={viewDialog.record} sx={{ mb: 4 }} />

          <Box>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 1, display: 'block', mb: 3 }}>
                Approval Authorities
              </Typography>
              <Grid container spacing={4}>
                {getNewHiringAuthorityCards(viewDialog.record).map((auth) => (
                  <Grid item xs={12} sm={6} md={4} key={auth.key}>
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
                        {auth.label}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        {auth.statusLabel}
                      </Typography>
                      {auth.at && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                          {formatDateTime(auth.at)}
                        </Typography>
                      )}
                      {auth.sig ? (
                        <Box sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider', pt: 1, display: 'inline-block' }}>
                          <DigitalSignatureImage userOrPath={{ digitalSignature: auth.sig }} alt={`${auth.label} Signature`} />
                        </Box>
                      ) : (
                        <Box sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider', pt: 1, width: '100px' }}>
                          <Typography variant="caption" color="text.disabled">No Signature</Typography>
                        </Box>
                      )}
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, bgcolor: 'background.default', borderTop: '1px solid', borderColor: 'divider', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={async () => {
              const result = await printNewHiringApproval(viewDialog.record);
              if (!result?.ok) toast.error(result?.message || 'Unable to print');
            }}
          >
            Print
          </Button>
          {(() => {
            const record = viewDialog.record;
            if (!record) return null;
            const userId = String(user?.id || user?._id || '');
            const initiatorId = String(record.initiator?._id || record.initiator || '');
            const isInitiator = Boolean(userId && initiatorId && userId === initiatorId);
            const isDeveloper = user?.email === 'developer@tovus.net';
            const canEdit = isDeveloper || (
              isInitiator
              && ['Pending HOD HR', 'Draft', 'Returned', 'Rejected by CEO'].includes(record.workflowStatus)
            );
            const needsResubmit = ['Returned', 'Rejected by CEO'].includes(record.workflowStatus)
              && (isInitiator || isDeveloper);
            if (!canEdit) return null;
            return (
              <>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<EditIcon />}
                  onClick={() => {
                    openEditResubmit(record, {
                      comment: detailsResubmitComment,
                      obsResponses: detailsObsResponses
                    });
                  }}
                >
                  {needsResubmit ? 'Edit Candidates & Resubmit' : 'Edit'}
                </Button>
                {needsResubmit && (
                  <Button
                    variant="contained"
                    color="primary"
                    disabled={detailsResubmitting || !detailsResubmitComment.trim()}
                    onClick={handleDetailsResubmit}
                  >
                    {detailsResubmitting ? 'Resubmitting...' : 'Resubmit with Comments'}
                  </Button>
                )}
              </>
            );
          })()}
          <Button variant="contained" color="inherit" onClick={() => setViewDialog({ open: false, record: null })}>Close window</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NonEmployeeOnboarding;
