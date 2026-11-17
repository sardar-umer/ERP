import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  TextField,
  Stack,
  Alert,
  CircularProgress,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  Add as AddIcon,
  Visibility as ViewIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../../contexts/AuthContext';
import generalCashApprovalService from '../../../services/generalCashApprovalService';
import { formatPKR } from '../../../utils/currency';
import { formatDate } from '../../../utils/dateUtils';
import {
  canApproveCashApprovalRow,
  isCashApprovalDeptApproved
} from '../../../utils/departmentApprovalListActions';
import { canEditGeneralCashApproval } from '../../../utils/generalCashApprovalWorkflow';
import useClientPagination from '../../../hooks/useClientPagination';

const statusColor = (status) => {
  if (status === 'Draft') return 'default';
  if (status === 'Pending Approval') return 'warning';
  if (status === 'Pending Audit' || status === 'Forwarded to Audit Director') return 'info';
  if (['Completed', 'Advance Issued', 'Payment Settled'].includes(status)) return 'success';
  if (['Rejected', 'Cancelled'].includes(status)) return 'error';
  if (String(status || '').startsWith('Returned')) return 'warning';
  return 'default';
};

const GeneralCashApprovalsList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState('');
  const [rejectDialog, setRejectDialog] = useState({ open: false, row: null });
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await generalCashApprovalService.list({
        search,
        mine: ['super_admin', 'admin'].includes(user?.role) ? '' : 'true',
        limit: 200
      });
      setRows(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load cash approvals');
    } finally {
      setLoading(false);
    }
  }, [search, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (row) => {
    try {
      setActionLoadingId(row._id);
      await generalCashApprovalService.approve(row._id);
      toast.success('Approved');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Approve failed');
    } finally {
      setActionLoadingId('');
    }
  };

  const openRejectDialog = (row) => {
    setRejectReason('');
    setRejectDialog({ open: true, row });
  };

  const handleReject = async () => {
    const row = rejectDialog.row;
    if (!row) return;
    if (!rejectReason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    try {
      setActionLoadingId(row._id);
      await generalCashApprovalService.reject(row._id, rejectReason.trim());
      toast.success('Rejected');
      setRejectDialog({ open: false, row: null });
      setRejectReason('');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reject failed');
    } finally {
      setActionLoadingId('');
    }
  };

  const pg = useClientPagination(rows);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={3} flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h4" fontWeight={600}>Cash Approvals</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            General module cash advance requests with line items and Manager / HOD approval.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/general/cash-approvals/create')}>
          New cash approval
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            placeholder="Search CA number, purpose, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 280 }}
          />
          <Tooltip title="Refresh">
            <IconButton onClick={load}><RefreshIcon /></IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <Table size="small" sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow>
                <TableCell>CA #</TableCell>
                <TableCell>Initiator</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Purpose</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Dept. approval</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No cash approvals yet.
                  </TableCell>
                </TableRow>
              ) : (
                pg.rows.map((row) => (
                  <TableRow key={row._id} hover>
                    <TableCell>{row.caNumber}</TableCell>
                    <TableCell>
                      {row.createdBy
                        ? `${row.createdBy.firstName || ''} ${row.createdBy.lastName || ''}`.trim() || row.createdBy.email || '—'
                        : '—'}
                    </TableCell>
                    <TableCell>{row.requestingDepartment || '—'}</TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>{row.purpose}</TableCell>
                    <TableCell align="right">{formatPKR(row.totalAmount)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.departmentApprovalStatus || '—'} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={row.status} color={statusColor(row.status)} />
                    </TableCell>
                    <TableCell>{formatDate(row.approvalDate || row.createdAt)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        {isCashApprovalDeptApproved(row) && (
                          <Tooltip title="Manager / HOD approval completed">
                            <CheckCircleIcon fontSize="small" color="success" sx={{ mx: 0.5 }} />
                          </Tooltip>
                        )}
                        {canApproveCashApprovalRow(row, user) && (
                          <>
                            <Tooltip title="Approve">
                              <span>
                                <IconButton
                                  size="small"
                                  color="success"
                                  disabled={actionLoadingId === row._id}
                                  onClick={() => handleApprove(row)}
                                >
                                  <CheckCircleIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title="Reject">
                              <span>
                                <IconButton
                                  size="small"
                                  color="error"
                                  disabled={actionLoadingId === row._id}
                                  onClick={() => openRejectDialog(row)}
                                >
                                  <CancelIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </>
                        )}
                        <Tooltip title="View">
                          <IconButton size="small" onClick={() => navigate(`/general/cash-approvals/${row._id}`)}>
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {canEditGeneralCashApproval(row, user) && (
                          <Tooltip title={['Rejected', 'Returned from Audit', 'Returned from CEO Office', 'Returned from CEO Secretariat'].includes(row.status) ? 'Edit & Resubmit' : 'Edit'}>
                            <IconButton size="small" onClick={() => navigate(`/general/cash-approvals/${row._id}/edit`)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}

      <Dialog
        open={rejectDialog.open}
        onClose={() => !actionLoadingId && setRejectDialog({ open: false, row: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject cash approval</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {rejectDialog.row?.caNumber ? `CA # ${rejectDialog.row.caNumber}` : 'Provide a reason for rejection.'}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Rejection reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialog({ open: false, row: null })} disabled={Boolean(actionLoadingId)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={Boolean(actionLoadingId) || !rejectReason.trim()}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GeneralCashApprovalsList;
