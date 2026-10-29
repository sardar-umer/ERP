import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Chip,
  Stack
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { getDocCompanyName } from '../../utils/documentCompany';
import ComparativeStatementView from '../../components/Procurement/ComparativeStatementView';
import ComparativeRejectionObservationsAlert from '../../components/Procurement/ComparativeRejectionObservationsAlert';
import { useAuth } from '../../contexts/AuthContext';
import { canEditComparativeAuthorityUsers } from '../../utils/comparativeStatementAuthority';

const normalizeMongoId = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'object') return String(v._id || v.id || '');
  return String(v);
};

const ComparativeStatements = () => {
  const { user } = useAuth();
  // State management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [requisitions, setRequisitions] = useState([]);
  const [selectedRequisition, setSelectedRequisition] = useState(null);
  const [quotations, setQuotations] = useState([]);
  const [loadingQuotations, setLoadingQuotations] = useState(false);
  const [selectDialog, setSelectDialog] = useState({ open: false, quotation: null });
  const [updating, setUpdating] = useState(false);
  // Editable approval authority (names/designations for signature section)
  const [approvalAuthority, setApprovalAuthority] = useState({
    preparedBy: '',
    verifiedBy: '',
    authorisedRep: '',
    financeRep: '',
    managerProcurement: ''
  });
  // Set to requisition id after user saves approval authorities; vendor Select enabled only then
  const [approvalsSavedForRequisition, setApprovalsSavedForRequisition] = useState(null);
  // Editable note (saved with approval authorities)
  const [comparativeNote, setComparativeNote] = useState('');
  const [creatingSplitPOs, setCreatingSplitPOs] = useState(false);
  const [canManageAssignments, setCanManageAssignments] = useState(false);
  const [approverOptions, setApproverOptions] = useState([]);
  const [approverSearchLoading, setApproverSearchLoading] = useState(false);
  const [authorityUserSelection, setAuthorityUserSelection] = useState({
    preparedBy: null,
    verifiedBy: null,
    authorisedRep: null,
    financeRep: null,
    managerProcurement: null
  });
  const [, setSavingComparativeApprovers] = useState(false);
  const [submittingComparative, setSubmittingComparative] = useState(false);
  const [approvingComparative, setApprovingComparative] = useState(false);
  const [rejectingComparative, setRejectingComparative] = useState(false);
  const [rejectObservation, setRejectObservation] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [deletingComparative, setDeletingComparative] = useState(false);
  const authoritySearchDebounceRef = useRef(null);

  const [selectedQuotationIds, setSelectedQuotationIds] = useState([]);
  const [selectedLot, setSelectedLot] = useState('A');

  // Load requisitions on component mount
  useEffect(() => {
    loadRequisitions();
  }, []);

  const loadRequisitions = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = {
        page: 1,
        limit: 1000
      };
      
      const response = await api.get('/procurement/requisitions', { params });
      if (response.data.success) {
        // The API returns 'indents' not 'requisitions'
        const requisitionsData = response.data.data?.indents || response.data.data?.requisitions || [];
        setRequisitions(requisitionsData);
        setCanManageAssignments(Boolean(response.data.data?.canManageAssignments));
      } else {
        setError('Failed to load requisitions');
      }
    } catch (err) {
      console.error('Error loading requisitions:', err);
      setError(err.response?.data?.message || 'Failed to load requisitions');
      setRequisitions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const [savingApprovals, setSavingApprovals] = useState(false);

  const handleRequisitionSelect = async (requisition) => {
    setSelectedRequisition(requisition);
    setLoadingQuotations(true);
    setError('');
    try {
      // First, get full requisition details with populated fields (includes comparativeStatementApprovals)
      const reqResponse = await api.get(`/indents/${requisition._id}`);
      let fullRequisition = requisition;
      if (reqResponse.data.success) {
        fullRequisition = reqResponse.data.data;
        setSelectedRequisition(fullRequisition);
        const approvals = fullRequisition.comparativeStatementApprovals || {};
        const currentUserOption = user
          ? {
              _id: user._id || user.id,
              firstName: user.firstName || '',
              lastName: user.lastName || '',
              email: user.email || '',
              employeeId: user.employeeId || ''
            }
          : null;
        const preparedBySelection = approvals.preparedByUser || currentUserOption || null;
        setApprovalAuthority({
          preparedBy:
            approvals.preparedBy ||
            (preparedBySelection
              ? ([preparedBySelection.firstName, preparedBySelection.lastName].filter(Boolean).join(' ').trim() || preparedBySelection.email || '')
              : ''),
          managerProcurement: approvals.managerProcurement || ''
        });
        setAuthorityUserSelection({
          preparedBy: preparedBySelection,
          managerProcurement: approvals.managerProcurementUser || null
        });
        setComparativeNote(fullRequisition.notes != null ? String(fullRequisition.notes) : '');
        const hasExistingApprovals = approvals.preparedBy || approvals.managerProcurement;
        setApprovalsSavedForRequisition(hasExistingApprovals ? fullRequisition._id : null);
      }
      
      // Then get quotations
      const response = await api.get(`/procurement/quotations/by-indent/${requisition._id}`);
      if (response.data.success) {
        const rawQuotes = response.data.data || [];
        setQuotations(rawQuotes);

        // Partially fulfilled: prefer remaining-item quotes for next lot, BUT also keep
        // quotes for lots already fully ordered (e.g. Lot A Gutka) so their CS still shows.
        const indentItems = fullRequisition.items || [];
        const quoteMatchesRemaining = (q) =>
          (q.items || []).some((qi) => {
            const matchingIndentItem = indentItems.find(
              (it) => (it.itemName || it.description || '').trim().toLowerCase() === (qi.description || '').trim().toLowerCase()
            );
            const isRemaining = matchingIndentItem
              ? (matchingIndentItem.orderedQuantity || 0) < matchingIndentItem.quantity
              : true;
            return isRemaining && (Number(qi.quantity) > 0 || Number(qi.unitPrice) > 0);
          });
        const quoteMatchesFulfilledLot = (q) => {
          const related = indentItems.filter((it) =>
            (q.items || []).some((qi) =>
              (it.itemName || it.description || '').trim().toLowerCase() === (qi.description || '').trim().toLowerCase()
            )
          );
          return (
            related.length > 0 &&
            related.every((it) => (it.orderedQuantity || 0) >= (Number(it.quantity) || 0))
          );
        };

        if (fullRequisition.status === 'Partially Fulfilled') {
          const remaining = rawQuotes.filter(quoteMatchesRemaining);
          const fulfilledLotQuotes = rawQuotes.filter(quoteMatchesFulfilledLot);
          const merged = [...new Map([...remaining, ...fulfilledLotQuotes].map((q) => [String(q._id), q])).values()];
          setSelectedQuotationIds((merged.length ? merged : rawQuotes).map((q) => q._id));
        } else {
          setSelectedQuotationIds(rawQuotes.map((q) => q._id));
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load quotations');
      setQuotations([]);
      setSelectedQuotationIds([]);
    } finally {
      setLoadingQuotations(false);
    }
  };

  const loadApproverOptions = async (q = '') => {
    try {
      setApproverSearchLoading(true);
      const res = await api.get('/indents/approver-candidates', { params: { search: q, limit: 100 } });
      setApproverOptions(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      setApproverOptions([]);
    } finally {
      setApproverSearchLoading(false);
    }
  };

  const handleAuthoritySearchInput = (value) => {
    if (authoritySearchDebounceRef.current) clearTimeout(authoritySearchDebounceRef.current);
    authoritySearchDebounceRef.current = setTimeout(() => {
      loadApproverOptions(value || '');
    }, 300);
  };

  useEffect(() => {
    if (selectedRequisition?._id) loadApproverOptions('');
  }, [selectedRequisition?._id]);

  useEffect(() => () => {
    if (authoritySearchDebounceRef.current) clearTimeout(authoritySearchDebounceRef.current);
  }, []);

  const currentApproval = selectedRequisition?.comparativeApprovals?.find(a => a.lotNumber === selectedLot) || {};
  const comparativeStatus = currentApproval?.status || 'not_configured';
  const approvalSteps = Array.isArray(currentApproval?.approvers) ? currentApproval.approvers : [];
  const userId = normalizeMongoId(user);
  const isPendingApprover = approvalSteps.some(
    (s) => normalizeMongoId(s?.approver) === userId && s?.status === 'pending'
  );
  const assignedToId = selectedRequisition?.procurementAssignment?.assignedTo?._id || selectedRequisition?.procurementAssignment?.assignedTo;
  const isAssignedProcurementUser = assignedToId && String(assignedToId) === String(userId || '');
  const canConfigureComparative = Boolean(selectedRequisition?._id) && (canManageAssignments || isAssignedProcurementUser);
  const hasVendorSelection = Boolean(
    (Array.isArray(quotations) &&
      quotations.some(
        (q) =>
          (q.lotNumber || 'A') === selectedLot &&
          ['Shortlisted', 'Finalized'].includes(q?.status)
      )) ||
    (selectedRequisition?.splitPOAssignments && Object.keys(selectedRequisition.splitPOAssignments).length > 0)
  );
  // Lot B (etc.) must still be configurable after Lot A is already approved.
  const lotComparativeNeedsSetup = ['not_configured', 'draft', 'rejected'].includes(comparativeStatus);
  const canSubmitComparative =
    canConfigureComparative &&
    ['draft', 'rejected'].includes(comparativeStatus) &&
    approvalSteps.length > 0 &&
    hasVendorSelection;
  const canApproveComparative = comparativeStatus === 'submitted' && isPendingApprover;
  const canEditAuthoritySlots =
    Boolean(canConfigureComparative && selectedRequisition && canEditComparativeAuthorityUsers(user, selectedRequisition));
  // Allow Save for the selected lot even when indent-wide lock is on from another approved lot.
  const canSaveLotAuthorities = Boolean(canConfigureComparative && (canEditAuthoritySlots || lotComparativeNeedsSetup));

  const handleAuthorityUserChange = (fieldKey, userObj) => {
    if (fieldKey === 'preparedBy') return;
    if (!canEditAuthoritySlots) return;
    setAuthorityUserSelection((prev) => ({ ...prev, [fieldKey]: userObj || null }));
    setApprovalAuthority((prev) => ({
      ...prev,
      [fieldKey]:
        userObj
          ? ([userObj.firstName, userObj.lastName].filter(Boolean).join(' ').trim() || userObj.email || '')
          : ''
    }));
  };

  const handleSaveComparativeApprovers = async () => {
    if (!selectedRequisition?._id) return;
    const approverIds = [...new Set(Object.values(authorityUserSelection).map((u) => u?._id).filter(Boolean))];
    if (!approverIds.length) {
      setError('Select at least one comparative approver.');
      return;
    }
    try {
      setSavingComparativeApprovers(true);
      setError('');
      const res = await api.put(`/procurement/requisitions/${selectedRequisition._id}/comparative-approvers`, { lotNumber: selectedLot,
        approverIds
      });
      if (res.data?.success) {
        const updated = res.data.data;
        setSelectedRequisition((prev) => ({
          ...prev,
          comparativeApproval: updated.comparativeApproval,
          comparativeApprovals: updated.comparativeApprovals
        }));
        setSuccess('Comparative approvers configured successfully.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to configure comparative approvers');
      throw err;
    } finally {
      setSavingComparativeApprovers(false);
    }
  };

  const handleSubmitComparative = async () => {
    if (!selectedRequisition?._id) return;
    try {
      setSubmittingComparative(true);
      setError('');
      const res = await api.post(`/procurement/requisitions/${selectedRequisition._id}/comparative-submit`, {
        lotNumber: selectedLot,
        resolutionNote: resolutionNote.trim()
      });
      if (res.data?.success) {
        const rid = selectedRequisition._id;
        try {
          const refreshed = await api.get(`/indents/${rid}`);
          if (refreshed.data?.success && refreshed.data.data) {
            setSelectedRequisition(refreshed.data.data);
          } else {
            const updated = res.data.data;
            setSelectedRequisition((prev) => ({ ...prev, comparativeApprovals: updated.comparativeApprovals }));
          }
        } catch {
          const updated = res.data.data;
          setSelectedRequisition((prev) => ({ ...prev, comparativeApprovals: updated.comparativeApprovals }));
        }
        setSuccess('Comparative statement submitted for approvals.');
        setResolutionNote('');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit comparative statement');
    } finally {
      setSubmittingComparative(false);
    }
  };

  const handleApproveComparative = async () => {
    if (!selectedRequisition?._id) return;
    try {
      setApprovingComparative(true);
      setError('');
      const res = await api.post(`/procurement/requisitions/${selectedRequisition._id}/comparative-approve`, { lotNumber: selectedLot });
      if (res.data?.success) {
        const updated = res.data.data;
        const rid = updated?._id || selectedRequisition?._id;
        if (rid) {
          try {
            const refreshed = await api.get(`/indents/${rid}`);
            if (refreshed.data?.success && refreshed.data.data) {
              setSelectedRequisition(refreshed.data.data);
            } else {
              setSelectedRequisition((prev) => ({ ...prev, comparativeApprovals: updated.comparativeApprovals }));
            }
          } catch {
            setSelectedRequisition((prev) => ({ ...prev, comparativeApprovals: updated.comparativeApprovals }));
          }
        } else {
          setSelectedRequisition((prev) => ({ ...prev, comparativeApprovals: updated.comparativeApprovals }));
        }
        setSuccess(res.data.message || 'Approval recorded.');
        // Server finalizes shortlisted (or split-PO) quotations; refresh list so UI shows Finalized.
        if (updated?.comparativeApprovals?.some(a => a.status === 'approved') && selectedRequisition?._id) {
          try {
            const response = await api.get(`/procurement/quotations/by-indent/${selectedRequisition._id}`);
            if (response.data.success) {
              setQuotations(response.data.data || []);
            }
            setSuccess('All authorities approved. Quotation(s) are finalized where a vendor was shortlisted.');
          } catch (refreshErr) {
            console.error('Refresh quotations after comparative approval failed:', refreshErr);
          }
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to approve comparative statement');
    } finally {
      setApprovingComparative(false);
    }
  };

  const handleRejectComparative = async () => {
    if (!selectedRequisition?._id || !rejectObservation.trim()) return;
    try {
      setRejectingComparative(true);
      setError('');
      const res = await api.post(`/procurement/requisitions/${selectedRequisition._id}/comparative-reject`, { lotNumber: selectedLot,
        observation: rejectObservation.trim()
      });
      if (res.data?.success) {
        const updated = res.data.data;
        setSelectedRequisition((prev) => ({ ...prev, comparativeApprovals: updated.comparativeApprovals }));
        setRejectDialogOpen(false);
        setRejectObservation('');
        setSuccess(res.data.message || 'Comparative statement rejected.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reject comparative statement');
    } finally {
      setRejectingComparative(false);
    }
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined) return '0.00';
    return parseFloat(num).toFixed(2);
  };

  const handleSaveApprovals = async () => {
    if (!selectedRequisition?._id) return;
    try {
      setSavingApprovals(true);
      setError('');
      const preparedByUser =
        authorityUserSelection.preparedBy ||
        (user
          ? {
              _id: user._id || user.id,
              firstName: user.firstName || '',
              lastName: user.lastName || '',
              email: user.email || ''
            }
          : null);
      const payload = {
        preparedBy:
          preparedByUser
            ? ([preparedByUser.firstName, preparedByUser.lastName].filter(Boolean).join(' ').trim() || preparedByUser.email || '')
            : '',
        preparedByUser: preparedByUser?._id || null,
        managerProcurement: approvalAuthority.managerProcurement || '',
        managerProcurementUser: authorityUserSelection.managerProcurement?._id || null,
        notes: comparativeNote
      };
      await api.put(`/indents/${selectedRequisition._id}/comparative-statement-approvals`, {
        ...payload
      });
      await handleSaveComparativeApprovers();
      setApprovalsSavedForRequisition(selectedRequisition._id);
      setSuccess('Approval authorities and note saved successfully.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save approval authorities');
    } finally {
      setSavingApprovals(false);
    }
  };

  const activeQuotations = useMemo(() => {
    if (!selectedQuotationIds.length) return quotations;
    return quotations.filter((q) => selectedQuotationIds.includes(q._id));
  }, [quotations, selectedQuotationIds]);

  const handleSelectVendor = async (quotation) => {
    if (!selectedRequisition?._id || !quotation?._id) return;
    setSelectDialog({ open: true, quotation });
  };

  const handleCreateSplitPOs = async ({ vendorAssignments }) => {
    if (!selectedRequisition?._id) return;
    try {
      setCreatingSplitPOs(true);
      setError('');
      await api.put(`/indents/${selectedRequisition._id}/split-po-assignments`, { vendorAssignments });
      setSelectedRequisition((prev) => (prev ? { ...prev, splitPOAssignments: vendorAssignments } : prev));
      if (selectedRequisition?._id) {
        const response = await api.get(`/procurement/quotations/by-indent/${selectedRequisition._id}`);
        if (response.data.success) {
          setQuotations(response.data.data || []);
        }
      }
      setSuccess('Vendor assignments saved and quotations shortlisted. Create Split POs from the Quotations page.');
      setTimeout(() => setSuccess(''), 8000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to shortlist vendors');
    } finally {
      setCreatingSplitPOs(false);
    }
  };

  const confirmSelectVendor = async () => {
    if (!selectDialog.quotation) return;

    try {
      setUpdating(true);
      setError('');
      const selectedStatus = comparativeStatus === 'approved' ? 'Finalized' : 'Shortlisted';
      await api.put(`/procurement/quotations/${selectDialog.quotation._id}`, {
        status: selectedStatus
      });

      // Keep only one active preferred vendor marker per lot before approval.
      const otherQuotations = quotations.filter(q => 
        q._id !== selectDialog.quotation._id &&
        (q.lotNumber || 'A') === (selectDialog.quotation.lotNumber || 'A')
      );
      for (const quote of otherQuotations) {
        if (quote.status === 'Shortlisted') {
          try {
            await api.put(`/procurement/quotations/${quote._id}`, {
              status: 'Received'
            });
          } catch (err) {
            console.error(`Failed to update quotation ${quote._id}:`, err);
          }
        }
      }

      // Reload quotations to reflect the changes
      if (selectedRequisition?._id) {
        const response = await api.get(`/procurement/quotations/by-indent/${selectedRequisition._id}`);
        if (response.data.success) {
          setQuotations(response.data.data || []);
        }
      }

      setSelectDialog({ open: false, quotation: null });
      setSuccess(
        selectedStatus === 'Finalized'
          ? 'Vendor selected successfully. Quotation status updated to Finalized.'
          : 'Vendor preference saved as Shortlisted. It will be finalized after all authorities approve.'
      );
      
      // Auto-dismiss success message after 5 seconds
      setTimeout(() => {
        setSuccess('');
      }, 5000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to select vendor');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteComparativeStatement = async (targetLot = null) => {
    if (!selectedRequisition?._id) return;
    const isLotDelete = typeof targetLot === 'string';
    const message = isLotDelete
      ? `Are you sure you want to DELETE the PO & Comparative Statement for Lot ${targetLot}?\n\n` +
        `• All linked Purchase Orders (and downstream docs/entries) for Lot ${targetLot} will be DELETED.\n` +
        `• Requisition fulfillment will be re-calculated.\n` +
        `• Quotations for Lot ${targetLot} will be KEPT and reset back to "Received" status.\n\n` +
        'This action is exclusively for developers / super admin.'
      : 'Are you sure you want to DELETE the PO & Comparative Statement for this requisition?\n\n' +
        '• All linked Purchase Orders (and downstream docs/entries) will be DELETED.\n' +
        '• Requisition fulfillment and status will be reset back to "Approved".\n' +
        '• All comparative approvers & approvals will be reset.\n' +
        '• All related quotations will be KEPT and reset back to "Received" status.\n\n' +
        'This action is exclusively for developers / super admin.';
        
    const confirmed = window.confirm(message);
    if (!confirmed) return;

    try {
      setDeletingComparative(true);
      setError('');
      const url = `/procurement/requisitions/${selectedRequisition._id}/comparative-statement${isLotDelete ? `?lot=${encodeURIComponent(targetLot)}` : ''}`;
      const res = await api.delete(url);
      setSuccess(res.data?.message || 'PO and Comparative statement deleted. Quotations preserved.');

      // Reload quotations
      const quoteRes = await api.get(`/procurement/quotations/by-indent/${selectedRequisition._id}`);
      if (quoteRes.data?.success) {
        setQuotations(quoteRes.data.data || []);
      }

      // Update selected requisition state
      if (res.data?.data) {
        setSelectedRequisition(res.data.data);
      }
      await loadRequisitions();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete PO and comparative statement');
    } finally {
      setDeletingComparative(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h5" fontWeight={600}>
            Comparative Statements
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            {(user?.role === 'developer' || user?.role === 'super_admin') && selectedRequisition && (
              <Button
                variant="outlined"
                color="error"
                startIcon={deletingComparative ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
                onClick={() => handleDeleteComparativeStatement(null)}
                disabled={deletingComparative}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                {deletingComparative ? 'Deleting…' : 'Delete PO & Comparative (Developer)'}
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadRequisitions}
              disabled={loading}
            >
              Refresh
            </Button>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
            {success}
          </Alert>
        )}

        {/* Requisition Selection */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <TextField
              select
              fullWidth
              label="Select Requisition"
              value={selectedRequisition?._id || ''}
              onChange={(e) => {
                const req = requisitions.find(r => r._id === e.target.value);
                if (req) handleRequisitionSelect(req);
              }}
              disabled={loading || requisitions.length === 0}
              helperText={loading ? 'Loading requisitions...' : requisitions.length === 0 ? 'No approved requisitions found' : ''}
            >
              {requisitions.length === 0 && !loading && (
                <MenuItem disabled value="">
                  No requisitions available
                </MenuItem>
              )}
              {requisitions.map((req) => (
                <MenuItem key={req._id} value={req._id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                    <span>{req.indentNumber || req._id} - {req.title || 'Untitled'} ({[getDocCompanyName(req, ''), req.department?.name || 'N/A'].filter(Boolean).join(' · ')})</span>
                    {req.status === 'Partially Fulfilled' && (
                      <Chip label="Partially Fulfilled" color="warning" size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                    )}
                  </Box>
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>

        {/* Comparative Statement Display */}
        {selectedRequisition && (
          <>
            <ComparativeRejectionObservationsAlert comparativeApproval={currentApproval} />
            {canSubmitComparative && currentApproval?.status === 'rejected' && (
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Resolution / corrective actions before resubmission"
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                sx={{ mb: 2 }}
              />
            )}

            {/* Quotations Included / Scope Selector Toolbar */}
            {quotations.length > 0 && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  mb: 2.5,
                  bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : '#f8fbfd'),
                  borderColor: 'primary.light',
                  borderRadius: 2
                }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1.5} sx={{ mb: 1.5 }}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700} color="primary.main">
                      Quotations Included in Statement ({activeQuotations.length} of {quotations.length} active)
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Toggle quotations to compare. Only the items quoted in the active selection will appear in the statement.
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button
                      size="small"
                      variant={selectedQuotationIds.length === quotations.length ? 'contained' : 'outlined'}
                      onClick={() => setSelectedQuotationIds(quotations.map((q) => q._id))}
                      sx={{ fontSize: '0.75rem', py: 0.25, textTransform: 'none' }}
                    >
                      All Quotes ({quotations.length})
                    </Button>
                    {selectedRequisition?.status === 'Partially Fulfilled' && (
                      <Button
                        size="small"
                        color="secondary"
                        variant="outlined"
                        onClick={() => {
                          const unfulfilledQuotes = quotations.filter((q) =>
                            (q.items || []).some((qi) => {
                              const matchingIndentItem = (selectedRequisition?.items || []).find(
                                (it) => (it.itemName || it.description || '').trim().toLowerCase() === (qi.description || '').trim().toLowerCase()
                              );
                              const isRemaining = matchingIndentItem ? (matchingIndentItem.orderedQuantity || 0) < matchingIndentItem.quantity : true;
                              return isRemaining && (Number(qi.quantity) > 0 || Number(qi.unitPrice) > 0);
                            })
                          );
                          if (unfulfilledQuotes.length > 0) {
                            setSelectedQuotationIds(unfulfilledQuotes.map((q) => q._id));
                          }
                        }}
                        sx={{ fontSize: '0.75rem', py: 0.25, textTransform: 'none', fontWeight: 600 }}
                      >
                        Remaining Items Quotes Only
                      </Button>
                    )}
                  </Stack>
                </Stack>
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {quotations.map((q) => {
                    const isSelected = selectedQuotationIds.includes(q._id);
                    const quotedItemCount = (q.items || []).filter((i) => Number(i.quantity) > 0 || Number(i.unitPrice) > 0).length;
                    return (
                      <Chip
                        key={q._id}
                        label={`${q.vendor?.name || 'Vendor'} • ${q.quotationNumber || 'Quote'} (${quotedItemCount} items) [${q.status || 'Received'}]`}
                        color={isSelected ? 'primary' : 'default'}
                        variant={isSelected ? 'filled' : 'outlined'}
                        onClick={() => {
                          setSelectedQuotationIds((prev) => {
                            if (prev.includes(q._id)) {
                              if (prev.length === 1) return prev; // Keep at least one selected
                              return prev.filter((id) => id !== q._id);
                            }
                            return [...prev, q._id];
                          });
                        }}
                        sx={{
                          fontWeight: isSelected ? 700 : 500,
                          cursor: 'pointer'
                        }}
                      />
                    );
                  })}
                </Stack>
              </Paper>
            )}

            
            {(() => {
              const lots = [...new Set(quotations.map(q => q.lotNumber || 'A'))].sort();
              return (
                <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    {lots.map(lot => (
                      <Button 
                        key={lot} 
                        variant={selectedLot === lot ? 'contained' : 'outlined'}
                        onClick={() => setSelectedLot(lot)}
                      >
                        Lot {lot}
                      </Button>
                    ))}
                  </Box>
                  
                  {(user?.role === 'developer' || user?.role === 'super_admin') && selectedRequisition && (
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      startIcon={deletingComparative ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
                      onClick={() => handleDeleteComparativeStatement(selectedLot)}
                      disabled={deletingComparative}
                      sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                      {deletingComparative ? 'Deleting…' : `Delete Lot ${selectedLot} (Developer)`}
                    </Button>
                  )}
                </Box>
              );
            })()}

            <ComparativeStatementView
              selectedLot={selectedLot}
              requisition={selectedRequisition}
              quotations={(() => {
                const lotQuotes = quotations.filter((q) => (q.lotNumber || 'A') === selectedLot);
                const selectedLotQuotes = activeQuotations.filter((q) => (q.lotNumber || 'A') === selectedLot);
                // If chip filter dropped a fulfilled lot (common on Partially Fulfilled), still show that lot's CS.
                return selectedLotQuotes.length > 0 ? selectedLotQuotes : lotQuotes;
              })()}
              approvalAuthority={approvalAuthority}
              note={comparativeNote}
              readOnly={false}
              formatNumber={formatNumber}
              loadingQuotations={loadingQuotations}
              onSaveApprovals={canConfigureComparative ? handleSaveApprovals : undefined}
              onSelectVendor={handleSelectVendor}
              savingApprovals={savingApprovals}
              updating={updating}
              approvalsSavedForRequisition={approvalsSavedForRequisition}
              onNoteChange={canConfigureComparative ? setComparativeNote : undefined}
              authorityUserOptions={approverOptions}
              authorityUserLoading={approverSearchLoading}
              authorityUserSelection={authorityUserSelection}
              onAuthorityUserChange={handleAuthorityUserChange}
              onAuthorityUserSearchInput={handleAuthoritySearchInput}
              onCreateSplitPOs={canConfigureComparative ? handleCreateSplitPOs : undefined}
              creatingSplitPOs={creatingSplitPOs}
              showPrintButton
              canSelectVendors={canConfigureComparative}
              onSubmitComparative={handleSubmitComparative}
              submittingComparative={submittingComparative}
              canSubmitComparative={canSubmitComparative}
              onApproveComparative={handleApproveComparative}
              onRejectComparative={() => setRejectDialogOpen(true)}
              canApproveComparative={canApproveComparative}
              approvingComparative={approvingComparative}
              canEditApprovalAuthorities={canSaveLotAuthorities}
            />
          </>
        )}

        {/* Print Styles */}
        <Box
          component="style"
          dangerouslySetInnerHTML={{
            __html: `
              @media print {
                @page {
                  size: A4 landscape;
                  margin: 8mm;
                }
                body * {
                  visibility: hidden;
                }
                .print-content,
                .print-content * {
                  visibility: visible;
                }
                .print-content {
                  position: absolute;
                  left: 0;
                  top: 0;
                  width: 100%;
                  page-break-inside: avoid;
                }
                .comparative-table {
                  font-size: 0.7rem !important;
                }
                .comparative-table th,
                .comparative-table td {
                  padding: 4px 4px !important;
                  font-size: 0.7rem !important;
                  line-height: 1.2 !important;
                }
                .comparative-table thead th {
                  padding: 6px 4px !important;
                }
                .terms-table th,
                .terms-table td {
                  padding: 4px 4px !important;
                  font-size: 0.7rem !important;
                }
                .signature-cell {
                  padding: 10px 5px !important;
                }
                .signature-cell .MuiBox-root {
                  min-height: 30px !important;
                  margin-bottom: 4px !important;
                }
                .signature-cell .MuiTypography-root {
                  font-size: 0.6rem !important;
                }
                * {
                  page-break-inside: avoid;
                  page-break-after: avoid;
                }
                table {
                  page-break-inside: avoid;
                }
                tr {
                  page-break-inside: avoid;
                  page-break-after: avoid;
                }
              }
            `
          }}
        />
      </Paper>

      {/* Select Vendor Confirmation Dialog */}
      <Dialog
        open={selectDialog.open}
        onClose={() => !updating && setSelectDialog({ open: false, quotation: null })}
      >
        <DialogTitle>Select Vendor</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to select <strong>{selectDialog.quotation?.vendor?.name}</strong> as the preferred vendor?
            <br /><br />
            This will:
            <ul>
              <li>Mark this quotation as <strong>{comparativeStatus === 'approved' ? 'Finalized' : 'Shortlisted'}</strong></li>
              <li>Reset any previously shortlisted vendor to <strong>Received</strong></li>
            </ul>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectDialog({ open: false, quotation: null })} disabled={updating}>
            Cancel
          </Button>
          <Button 
            onClick={confirmSelectVendor} 
            variant="contained" 
            color="primary"
            disabled={updating}
            startIcon={updating ? <CircularProgress size={20} /> : <CheckCircleIcon />}
          >
            {updating ? 'Updating...' : (comparativeStatus === 'approved' ? 'Confirm Finalize' : 'Confirm Shortlist')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Comparative Statement</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={4}
            label="Observation (required)"
            value={rejectObservation}
            onChange={(e) => setRejectObservation(e.target.value)}
            inputProps={{ maxLength: 1000 }}
            helperText={`${rejectObservation.length}/1000`}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleRejectComparative} disabled={rejectingComparative || !rejectObservation.trim()}>
            {rejectingComparative ? 'Rejecting...' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ComparativeStatements;
