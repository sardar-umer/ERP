import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Divider,
  Alert,
  Skeleton,
  alpha,
  useTheme,
  Tabs,
  Tab,
  Stack,
  Tooltip,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormControlLabel,
  Checkbox,
  Badge,
  Collapse
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Search as SearchIcon,
  CheckCircle as CheckCircleIcon,
  Comment as CommentIcon,
  Send as SendIcon,
  Description as DescriptionIcon,
  Business as BusinessIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  AttachFile as AttachFileIcon,
  Cancel as CancelIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  FilterList as FilterListIcon,
  History as HistoryIcon,
  Print as PrintIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  RestartAlt as RestartAltIcon,
  Store as StoreIcon,
  Business as VendorIcon
} from '@mui/icons-material';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import paymentSettlementService from '../../services/paymentSettlementService';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import { formatPKR } from '../../utils/currency';
import { getImageUrl } from '../../utils/imageService';
import toast from 'react-hot-toast';
import WorkflowHistoryDialog from '../../components/WorkflowHistoryDialog';
import ComparativeStatementView from '../../components/Procurement/ComparativeStatementView';
import QuotationDetailView from '../../components/Procurement/QuotationDetailView';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import CashApprovalGeneralDetailShell from '../../components/CashApprovals/CashApprovalGeneralDetailShell';
import { isGeneralModuleCashApproval } from '../../components/CashApprovals/cashApprovalGeneralDocumentUtils';
import {
  consolidatedMemoSecondaryHeading,
  getConsolidatedLineTotals,
  hasConsolidatedBreakdown,
  sortedConsolidatedLines,
  UTILITY_MEMO_COL_WIDTHS,
  utilityMemoDateCellSx,
  utilityMemoRefCellSx,
  utilityMemoTableSx
} from '../../utils/utilityBillMemoUtils';
import { WorkflowAuditFeedbackPanel } from '../../components/Admin/workflowAuditReturn';
import CentralizedStoreBillInvoiceBody from '../../components/UtilityBill/CentralizedStoreBillInvoiceBody';
import CentralizedStoreItemsAuditPanel from '../../components/Audit/CentralizedStoreItemsAuditPanel';
import FinanceVendorsAuditPanel from '../../components/Audit/FinanceVendorsAuditPanel';
import { collectUtilityBillWorkflowImages } from '../../utils/utilityBillAttachments';
import { getApprovalRoleLabel } from '../../utils/utilityBillApprovalSlots';
import {
  getStoreInvoiceOrgTitle,
  getCentralizedStoreDocumentTypeLabel,
  isCentralizedStoreBill
} from '../../utils/centralizedStoreBillDisplay';
import { canPerformInitialPreAuditActions } from '../../utils/auditAccess';
import { formatPurchaseOrderCostCenter } from '../../utils/purchaseOrderAuthority';
import { PO_A4_ONE_PAGE_PRINT_CSS, printPoFitToOneA4 } from '../../utils/poA4PrintStyles';
import StoreVettingNotice from '../../components/Procurement/StoreVettingNotice';

/** Comment from the most recent workflow step that moved the document to Pre-Audit (Send to Audit), e.g. resubmit notes. */
function getLatestSendToAuditWorkflowComment(workflowHistory) {
  if (!Array.isArray(workflowHistory) || !workflowHistory.length) return '';
  for (let i = workflowHistory.length - 1; i >= 0; i -= 1) {
    const entry = workflowHistory[i];
    if (String(entry?.toStatus || '').trim() !== 'Send to Audit') continue;
    const text = String(entry?.comments || '').trim();
    if (text) return text;
  }
  return '';
}

const PRE_AUDIT_TAB_STATUS_KEYS = [
  'pending',
  'under_review',
  'forwarded_to_director',
  'approved',
  'returned_with_observations'
];
const PRE_AUDIT_TAB_LABELS = [
  'Pending',
  'Under Review',
  'Forwarded to Director',
  'Approved',
  'Returned'
];

const PreAudit = () => {
  const theme = useTheme();
  const { user } = useAuth();
  const location = useLocation();
  
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    sourceDepartment: '',
    sourceModule: '',
    documentType: '',
    priority: ''
  });
  const [tabValue, setTabValue] = useState(0);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [tabCounts, setTabCounts] = useState({
    pending: null,
    under_review: null,
    forwarded_to_director: null,
    approved: null,
    returned_with_observations: null
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const tabParam = String(params.get('tab') || params.get('status') || '').toLowerCase();
    if (!tabParam) return;
    const tabMap = {
      pending: 0,
      under_review: 1,
      forwarded_to_director: 2,
      approved: 3,
      returned_with_observations: 4
    };
    if (Object.prototype.hasOwnProperty.call(tabMap, tabParam)) {
      setTabValue(tabMap[tabParam]);
    }
  }, [location.search]);
  
  // Dialog states
  const [viewDialog, setViewDialog] = useState({ open: false, document: null, fullDocument: null, loading: false, quotations: [], grns: [], caLinkedDocs: [], poAuditTab: 0 });
  const [imageViewer, setImageViewer] = useState({ open: false, imageUrl: '', imageName: '', isBlob: false });
  const [imageZoom, setImageZoom] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState({ active: false, startX: 0, startY: 0 });
  const [approveDialog, setApproveDialog] = useState({ open: false, document: null });
  const [forwardDialog, setForwardDialog] = useState({ open: false, document: null });
  const [observationDialog, setObservationDialog] = useState({ open: false, document: null });
  const [returnDialog, setReturnDialog] = useState({ open: false, document: null });
  const [rejectDialog, setRejectDialog] = useState({ open: false, document: null });
  const [workflowHistoryDialog, setWorkflowHistoryDialog] = useState({ open: false, document: null });
  const changeImageZoom = (delta) => {
    setImageZoom((prev) => Math.min(3, Math.max(0.5, +(prev + delta).toFixed(2))));
  };
  const startImageDrag = (event) => {
    if (imageZoom <= 1) return;
    event.preventDefault();
    setDragState({
      active: true,
      startX: event.clientX - imageOffset.x,
      startY: event.clientY - imageOffset.y
    });
  };
  const onImageDrag = (event) => {
    if (!dragState.active) return;
    setImageOffset({
      x: event.clientX - dragState.startX,
      y: event.clientY - dragState.startY
    });
  };
  const stopImageDrag = () => {
    if (dragState.active) setDragState((prev) => ({ ...prev, active: false }));
  };
  const openImageViewer = (imageUrl, imageName = 'Attachment Image') => {
    if (!imageUrl) return;
    setImageViewer({
      open: true,
      imageUrl,
      imageName,
      isBlob: false
    });
    setImageZoom(1);
    setImageOffset({ x: 0, y: 0 });
  };
  const [approvalComments, setApprovalComments] = useState('');
  const [useStampForAction, setUseStampForAction] = useState(false);
  const [forwardComments, setForwardComments] = useState('');
  const [observation, setObservation] = useState({ text: '', severity: 'medium' });
  const [returnComments, setReturnComments] = useState('');
  const [rejectionComments, setRejectionComments] = useState('');
  const [rejectObservations, setRejectObservations] = useState([{ observation: '', severity: 'medium' }]);
  const [storeCatalogOpen, setStoreCatalogOpen] = useState(false);
  const [vendorsCatalogOpen, setVendorsCatalogOpen] = useState(false);

  const normalizeRole = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const collapseRepeatedChars = (value) => String(value || '').replace(/(.)\1+/g, '$1');
  const isAuditDirectorLabel = (value) => {
    const normalized = normalizeRole(value);
    const collapsed = collapseRepeatedChars(normalized);
    return collapsed.includes('audit') && collapsed.includes('director');
  };
  const userHasRoleLabel = (accepted = []) => {
    const set = accepted.map((r) => normalizeRole(r));
    const direct = normalizeRole(user?.role);
    if (set.includes(direct)) return true;
    const roleRefNames = [user?.roleRef?.name, user?.roleRef?.displayName].map(normalizeRole).filter(Boolean);
    if (roleRefNames.some((n) => set.includes(n))) return true;
    const roleNames = Array.isArray(user?.roles)
      ? user.roles.flatMap((r) => [normalizeRole(r?.name), normalizeRole(r?.displayName)]).filter(Boolean)
      : [];
    if (roleNames.some((n) => set.includes(n))) return true;
    const subRoleNames = Array.isArray(user?.subRoles)
      ? user.subRoles.flatMap((r) => [normalizeRole(r?.name), normalizeRole(r?.displayName)]).filter(Boolean)
      : [];
    return subRoleNames.some((n) => set.includes(n));
  };
  const userHasRoleByPredicate = (predicate) => {
    if (typeof predicate !== 'function') return false;
    if (predicate(user?.role)) return true;
    const roleRefNames = [user?.roleRef?.name, user?.roleRef?.displayName];
    if (roleRefNames.some((n) => predicate(n))) return true;
    const roleNames = Array.isArray(user?.roles)
      ? user.roles.flatMap((r) => [r?.name, r?.displayName]).filter(Boolean)
      : [];
    if (roleNames.some((n) => predicate(n))) return true;
    const subRoleNames = Array.isArray(user?.subRoles)
      ? user.subRoles.flatMap((r) => [r?.name, r?.displayName]).filter(Boolean)
      : [];
    return subRoleNames.some((n) => predicate(n));
  };
  const isAuditDirectorUser = () =>
    userHasRoleByPredicate(isAuditDirectorLabel) ||
    normalizeRole(user?.role) === 'super_admin' ||
    normalizeRole(user?.role) === 'developer';
  const isAuditReviewerUser = () => canPerformInitialPreAuditActions(user);
  const isCashApprovalBillDoc = (doc) => {
    if (!doc?.isCashApproval) return false;
    if (doc?.originalDocument?.evidenceSubmittedAt) return true;
    const probe = `${doc?.title || ''} ${doc?.description || ''} ${doc?.documentType || ''}`.toLowerCase();
    return probe.includes('cash approval bill') || probe.includes('settlement bill');
  };
  const hasInitialApproval = (doc) =>
    Boolean(
      doc?.initialAuditApproved ||
      doc?.initialAuditApprovedAt ||
      doc?.preAuditInitialApprovedAt ||
      doc?.reviewedAt
    );

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Remove status from filters since we set it based on tab
      const { status: _, ...filtersWithoutStatus } = filters;
      
      const params = new URLSearchParams({
        page: page + 1,
        limit: rowsPerPage,
        ...filtersWithoutStatus
      });
      
      // Filter by status based on tab
      if (tabValue === 0) {
        params.set('status', 'pending');
      } else if (tabValue === 1) {
        params.set('status', 'under_review');
      } else if (tabValue === 2) {
        params.set('status', 'forwarded_to_director');
      } else if (tabValue === 3) {
        params.set('status', 'approved');
      } else if (tabValue === 4) {
        params.set('status', 'returned_with_observations');
      }
      
      if (searchQuery) {
        params.append('search', searchQuery);
      }

      const response = await api.get(`/pre-audit?${params}`);
      setDocuments(response.data.data);
      const count = response.data.pagination.totalCount;
      setTotalCount(count);
      const statusKey = PRE_AUDIT_TAB_STATUS_KEYS[tabValue];
      if (statusKey) {
        setTabCounts((prev) => ({ ...prev, [statusKey]: count }));
      }
    } catch (error) {
      console.error('Error fetching pre-audit documents:', error);
      setError(error.response?.data?.message || 'Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, searchQuery, filters, tabValue]);

  const getDocumentAmount = (doc) =>
    doc?.amount ?? doc?.totalAmount ?? doc?.originalDocument?.amount ?? doc?.originalDocument?.totalAmount ?? doc?.originalDocument?.grandTotal;

  const getDaysWaiting = (doc) => {
    const raw = doc?.documentDate || doc?.createdAt || doc?.date;
    if (!raw) return null;
    const start = new Date(raw);
    if (Number.isNaN(start.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
  };

  const activeFilterCount = [filters.sourceModule, filters.documentType, filters.priority].filter(Boolean).length;

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleForward = async () => {
    try {
      setError(null);
      const doc = forwardDialog.document;
      
      // Forward to Audit Director - works for both PreAudit and workflow documents
      await api.put(`/pre-audit/${doc._id}/forward`, {
        forwardComments
      });
      
      setSuccess('Document forwarded to Audit Director successfully');
      setForwardDialog({ open: false, document: null });
      setForwardComments('');
      fetchDocuments();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to forward document');
    }
  };

  const handleApprove = async () => {
    try {
      setError(null);
      const doc = approveDialog.document;

      let approveResponse;
      if (doc.isCashApproval) {
        approveResponse = await api.put(`/cash-approvals/${doc._id}/audit-approve`, {
          approvalComments,
          useStamp: useStampForAction
        });
      } else if (doc.isPurchaseOrder && !doc.isPostGrnAudit) {
        approveResponse = await api.put(`/procurement/purchase-orders/${doc._id}/audit-approve`, {
          approvalComments
        });
      } else {
        approveResponse = await api.put(`/pre-audit/${doc._id}/approve`, {
          approvalComments,
          useStamp: useStampForAction
        });
      }

      const serverMessage = approveResponse?.data?.message;
      const financePost = approveResponse?.data?.data?.financePost;
      if (financePost?.error) {
        setError(`Approved, but Finance posting failed: ${financePost.error}`);
      }
      setSuccess(serverMessage || 'Document approved successfully');
      setApproveDialog({ open: false, document: null });
      setApprovalComments('');
      setUseStampForAction(false);
      fetchDocuments();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to approve document');
    }
  };

  const handleSendToFinanceFromAudit = async (doc) => {
    try {
      setError(null);
      await api.post(`/procurement/store/po/${doc._id}/send-to-finance`);
      setSuccess('Purchase order sent to Finance for billing');
      fetchDocuments();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to send purchase order to Finance');
    }
  };

  const handleAddObservation = async () => {
    try {
      setError(null);
      await api.put(`/pre-audit/${observationDialog.document._id}/add-observation`, {
        observation: observation.text,
        severity: observation.severity
      });
      setSuccess('Observation added successfully');
      setObservationDialog({ open: false, document: null });
      setObservation({ text: '', severity: 'medium' });
      fetchDocuments();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to add observation');
    }
  };

  const handleReturn = async () => {
    try {
      setError(null);
      const doc = returnDialog.document;
      
      if (doc.isCashApproval) {
        await api.put(`/cash-approvals/${doc._id}/audit-return`, {
          returnComments
        });
      } else if (doc.isPurchaseOrder) {
        await api.put(`/procurement/purchase-orders/${doc._id}/audit-return`, {
          returnComments
        });
      } else if (doc.isWorkflowDocument) {
        // For workflow documents, return to "Returned from Audit" status
        // Collect observations from the document if they exist
        const observations = doc.observations && doc.observations.length > 0
          ? doc.observations.map(obs => ({
              observation: obs.observation || obs.text || obs,
              severity: obs.severity || 'medium'
            }))
          : [];
        
        await api.put(`/pre-audit/${doc._id}/return`, {
          returnComments,
          observations: observations.length > 0 ? observations : undefined
        });
      } else {
        // For regular Pre Audit documents
        await api.put(`/pre-audit/${doc._id}/return`, {
          returnComments
        });
      }
      
      setSuccess('Document returned to department successfully');
      setReturnDialog({ open: false, document: null });
      setReturnComments('');
      fetchDocuments();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to return document');
    }
  };

  const handleReject = async () => {
    try {
      setError(null);
      const doc = rejectDialog.document;
      
      // Prepare observations array
      const observations = rejectObservations
        .filter(obs => obs.observation.trim())
        .map(obs => ({
          observation: obs.observation,
          severity: obs.severity
        }));

      if (!rejectionComments.trim() && observations.length === 0) {
        setError('Please provide rejection comments or at least one observation');
        return;
      }

      if (doc.isCashApproval) {
        await api.put(`/cash-approvals/${doc._id}/audit-reject`, {
          rejectionComments: rejectionComments || 'Rejected with observations',
          observations: observations.length > 0 ? observations : undefined
        });
        setSuccess('Cash approval rejected successfully.');
      } else if (doc.isPurchaseOrder) {
        await api.put(`/procurement/purchase-orders/${doc._id}/audit-reject`, {
          rejectionComments: rejectionComments || 'Rejected with observations',
          observations: observations.length > 0 ? observations : undefined
        });
        setSuccess('Purchase order rejected successfully.');
      } else if (doc.isVendorBill) {
        await api.put(`/pre-audit/${doc._id}/reject`, {
          rejectionComments: rejectionComments || 'Rejected with observations',
          observations: observations.length > 0 ? observations : undefined,
          useStamp: useStampForAction
        });
        setSuccess('Vendor bill rejected and returned to finance. They can correct and resend.');
      } else {
        await api.put(`/pre-audit/${doc._id}/reject`, {
          rejectionComments: rejectionComments || 'Rejected with observations',
          observations: observations.length > 0 ? observations : undefined,
          useStamp: useStampForAction
        });
        setSuccess('Document rejected and returned to initiator. They can correct and resend.');
      }
      setRejectDialog({ open: false, document: null });
      setRejectionComments('');
      setRejectObservations([{ observation: '', severity: 'medium' }]);
      setUseStampForAction(false);
      fetchDocuments();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to reject document');
    }
  };

  const addRejectObservation = () => {
    setRejectObservations([...rejectObservations, { observation: '', severity: 'medium' }]);
  };

  const removeRejectObservation = (index) => {
    setRejectObservations(rejectObservations.filter((_, i) => i !== index));
  };

  const updateRejectObservation = (index, field, value) => {
    const updated = [...rejectObservations];
    updated[index][field] = value;
    setRejectObservations(updated);
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: 'warning',
      under_review: 'info',
      forwarded_to_director: 'primary',
      approved: 'success',
      returned_with_observations: 'error',
      rejected: 'error'
    };
    return colors[status] || 'default';
  };

  const getPriorityColor = (priority) => {
    const colors = {
      low: 'default',
      medium: 'info',
      high: 'warning',
      urgent: 'error'
    };
    return colors[priority] || 'default';
  };

  const getSeverityColor = (severity) => {
    const colors = {
      low: 'default',
      medium: 'info',
      high: 'warning',
      critical: 'error'
    };
    return colors[severity] || 'default';
  };

  // Format date to match Payment Settlement style (22-Dec-25)
  const formatDateForDocument = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      const day = date.getDate();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = monthNames[date.getMonth()];
      const year = date.getFullYear().toString().slice(-2);
      return `${day}-${month}-${year}`;
    } catch {
      return dateString;
    }
  };

  const displayValue = (value) => value || '';
  const userDisplayName = (userObj) => {
    if (!userObj) return '';
    return [userObj.firstName, userObj.lastName].filter(Boolean).join(' ').trim() || userObj.email || userObj.employeeId || '';
  };
  const formatUtilityAmount = (amount) => new Intl.NumberFormat('en-PK', {
    maximumFractionDigits: 0
  }).format(Number(amount || 0));
  const getSignatureSource = (row) => row?.signatureUser?.digitalSignature || '';
  const getUtilityGrandTotal = (bill) => bill?.grandTotal ?? ((Number(bill?.amount) || 0) + (Number(bill?.balanceAmount) || 0));
  const getUtilityBalanceToPay = (bill) => (
    Number(bill?.balanceAmount) || Math.max((Number(getUtilityGrandTotal(bill)) || 0) - (Number(bill?.lastMonthAmount) || 0), 0)
  );
  const getPaymentSettlementApprovalRows = (document) => {
    const chain = document?.approvalChain || [];
    const workflowHistory = document?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findLatestByToStatus = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return accepted.some((status) => toStatus === status || toStatus.startsWith(status));
    });
    const findPreferredAuditEntry = (accepted = []) => {
      const entries = history.filter((entry) => {
        const toStatus = normalize(entry?.toStatus);
        return accepted.some((status) => toStatus === status || toStatus.startsWith(status));
      });
      return entries.find((e) => e?.changedBy?.digitalSignature) || entries[0];
    };
    const preAuditActorEntry = findPreferredAuditEntry(['initial audit approval', 'pending audit'])
      || findPreferredAuditEntry(['forwarded to audit director']);
    const directorApproval = findLatestByToStatus(['approved (from forwarded to audit director)', 'approved (from send to audit)']);

    return [
      {
        authority: 'Sig of Requester',
        name: userDisplayName(document?.createdBy),
        signatureUser: document?.createdBy,
        dateTime: document?.createdAt ? formatDateTime(document.createdAt) : ''
      },
      {
        authority: 'Manager Approver',
        name: userDisplayName(chain[0]?.approver),
        signatureUser: chain[0]?.status === 'approved' ? chain[0]?.approver : null,
        dateTime: chain[0]?.status === 'approved' && chain[0]?.actedAt ? formatDateTime(chain[0].actedAt) : ''
      },
      {
        authority: 'Head Of Department Approver',
        name: userDisplayName(chain[1]?.approver),
        signatureUser: chain[1]?.status === 'approved' ? chain[1]?.approver : null,
        dateTime: chain[1]?.status === 'approved' && chain[1]?.actedAt ? formatDateTime(chain[1].actedAt) : ''
      },
      {
        authority: 'Pre-Audit Authority',
        name: userDisplayName(preAuditActorEntry?.changedBy),
        signatureUser: preAuditActorEntry?.changedBy || null,
        dateTime: preAuditActorEntry?.changedAt ? formatDateTime(preAuditActorEntry.changedAt) : ''
      },
      {
        authority: 'Audit Director',
        name: userDisplayName(directorApproval?.changedBy),
        signatureUser: directorApproval?.changedBy || null,
        signaturePath: directorApproval?.stampUsed && directorApproval?.stampImage
          ? directorApproval.stampImage
          : directorApproval?.changedBy?.digitalSignature || '',
        dateTime: directorApproval?.changedAt ? formatDateTime(directorApproval.changedAt) : ''
      }
    ];
  };
  const getPaymentSettlementStampRows = (document) => {
    const workflowHistory = document?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findStampedEntry = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return (entry?.stampUsed && entry?.stampImage)
        && accepted.some((status) => toStatus === status || toStatus.startsWith(status));
    });
    const preAuditStamp = findStampedEntry(['forwarded to audit director', 'initial audit approval']);
    const directorStamp = findStampedEntry(['approved (from forwarded to audit director)', 'approved (from send to audit)']);
    return [
      { authority: 'Pre-Audit Authority Stamp', stampImage: preAuditStamp?.stampImage || '', dateTime: preAuditStamp?.changedAt ? formatDateTime(preAuditStamp.changedAt) : '' },
      { authority: 'Audit Director Stamp', stampImage: directorStamp?.stampImage || '', dateTime: directorStamp?.changedAt ? formatDateTime(directorStamp.changedAt) : '' }
    ].filter((row) => row.stampImage);
  };
  const getRentalManagementApprovalRows = (document) => {
    const chain = document?.approvalChain || [];
    const workflowHistory = document?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findLatestByToStatus = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return accepted.some((status) => toStatus === status || toStatus.startsWith(status));
    });
    const findPreferredAuditEntry = (accepted = []) => {
      const entries = history.filter((entry) => {
        const toStatus = normalize(entry?.toStatus);
        return accepted.some((status) => toStatus === status || toStatus.startsWith(status));
      });
      return entries.find((e) => e?.changedBy?.digitalSignature) || entries[0];
    };
    const preAuditActorEntry = findPreferredAuditEntry(['initial audit approval', 'pending audit'])
      || findPreferredAuditEntry(['forwarded to audit director']);
    const directorApproval = findLatestByToStatus(['approved (from forwarded to audit director)', 'approved (from send to audit)']);

    return [
      { authority: 'Sig of Requester', name: userDisplayName(document?.createdBy), signatureUser: document?.createdBy, dateTime: document?.createdAt ? formatDateTime(document.createdAt) : '' },
      { authority: 'Manager Approver', name: userDisplayName(chain[0]?.approver), signatureUser: chain[0]?.status === 'approved' ? chain[0]?.approver : null, dateTime: chain[0]?.status === 'approved' && chain[0]?.actedAt ? formatDateTime(chain[0].actedAt) : '' },
      { authority: 'Head Of Department Approver', name: userDisplayName(chain[1]?.approver), signatureUser: chain[1]?.status === 'approved' ? chain[1]?.approver : null, dateTime: chain[1]?.status === 'approved' && chain[1]?.actedAt ? formatDateTime(chain[1].actedAt) : '' },
      { authority: 'Pre-Audit Authority', name: userDisplayName(preAuditActorEntry?.changedBy), signatureUser: preAuditActorEntry?.changedBy || null, dateTime: preAuditActorEntry?.changedAt ? formatDateTime(preAuditActorEntry.changedAt) : '' },
      { authority: 'Audit Director', name: userDisplayName(directorApproval?.changedBy), signatureUser: directorApproval?.changedBy || null, signaturePath: directorApproval?.stampUsed && directorApproval?.stampImage ? directorApproval.stampImage : directorApproval?.changedBy?.digitalSignature || '', dateTime: directorApproval?.changedAt ? formatDateTime(directorApproval.changedAt) : '' }
    ];
  };
  const getRentalManagementStampRows = (document) => {
    const workflowHistory = document?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findStampedEntry = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return (entry?.stampUsed && entry?.stampImage)
        && accepted.some((status) => toStatus === status || toStatus.startsWith(status));
    });
    const preAuditStamp = findStampedEntry(['forwarded to audit director', 'initial audit approval']);
    const directorStamp = findStampedEntry(['approved (from forwarded to audit director)', 'approved (from send to audit)']);
    return [
      { authority: 'Pre-Audit Authority Stamp', stampImage: preAuditStamp?.stampImage || '', dateTime: preAuditStamp?.changedAt ? formatDateTime(preAuditStamp.changedAt) : '' },
      { authority: 'Audit Director Stamp', stampImage: directorStamp?.stampImage || '', dateTime: directorStamp?.changedAt ? formatDateTime(directorStamp.changedAt) : '' }
    ].filter((row) => row.stampImage);
  };
  const getUtilityApprovalRows = (bill) => {
    const chain = bill?.approvalChain || [];
    const workflowHistory = bill?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findLatestAuditEntry = (keywords = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      const fromStatus = normalize(entry?.fromStatus);
      return keywords.some((keyword) => toStatus.includes(keyword) || fromStatus.includes(keyword));
    });
    const findLatestByToStatus = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return accepted.some((status) => (
        toStatus === status || toStatus.startsWith(status)
      ));
    });

    const preAuditActorEntry = findLatestByToStatus([
      'forwarded to audit director',
      'initial audit approval'
    ]) || findLatestAuditEntry([
      'forwarded to audit director',
      'initial audit approval'
    ]);
    const directorApproval = findLatestByToStatus([
      'approved (from forwarded to audit director)',
      'approved (from send to audit)'
    ]) || findLatestAuditEntry([
      'approved (from forwarded to audit director)',
      'approved (from send to audit)'
    ]);

    const rows = [
      {
        authority: 'Sig of Requester',
        name: userDisplayName(bill?.createdBy),
        signatureUser: bill?.createdBy,
        dateTime: bill?.createdAt ? formatDateTime(bill.createdAt) : ''
      }
    ];

    (Array.isArray(chain) ? chain : []).forEach((step, idx) => {
      const approved = step?.status === 'approved';
      rows.push({
        authority: getApprovalRoleLabel(step?.role, idx),
        name: userDisplayName(step?.approver),
        signatureUser: approved ? step?.approver : null,
        dateTime: approved && step?.actedAt ? formatDateTime(step.actedAt) : ''
      });
    });

    rows.push(
      {
        authority: 'Pre-Audit Authority',
        name: userDisplayName(preAuditActorEntry?.changedBy),
        signatureUser: preAuditActorEntry?.changedBy || null,
        dateTime: preAuditActorEntry?.changedAt ? formatDateTime(preAuditActorEntry.changedAt) : ''
      },
      {
        authority: 'Audit Director',
        name: userDisplayName(directorApproval?.changedBy),
        signatureUser: directorApproval?.changedBy || null,
        signaturePath: directorApproval?.stampUsed && directorApproval?.stampImage
          ? directorApproval.stampImage
          : directorApproval?.changedBy?.digitalSignature || '',
        dateTime: directorApproval?.changedAt ? formatDateTime(directorApproval.changedAt) : ''
      }
    );

    return rows;
  };
  const getUtilityStampRows = (bill) => {
    const workflowHistory = bill?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findStampedEntry = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return (entry?.stampUsed && entry?.stampImage)
        && accepted.some((status) => toStatus === status || toStatus.startsWith(status));
    });
    const preAuditStamp = findStampedEntry(['forwarded to audit director', 'initial audit approval']);
    const directorStamp = findStampedEntry(['approved (from forwarded to audit director)', 'approved (from send to audit)']);
    return [
      { authority: 'Pre-Audit Authority Stamp', stampImage: preAuditStamp?.stampImage || '', dateTime: preAuditStamp?.changedAt ? formatDateTime(preAuditStamp.changedAt) : '' },
      { authority: 'Audit Director Stamp', stampImage: directorStamp?.stampImage || '', dateTime: directorStamp?.changedAt ? formatDateTime(directorStamp.changedAt) : '' }
    ].filter((row) => row.stampImage);
  };
  const isImageLike = (value = '') => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(value || ''));
  const getWorkflowDocImageAttachments = (doc = {}, submodule = '') => {
    const images = [];
    const pushImage = (src, name = 'Bill Image') => {
      if (!src) return;
      const resolved = getImageUrl(src);
      if (!resolved) return;
      if (!images.some((img) => img.src === resolved)) {
        images.push({ src: resolved, name });
      }
    };

    if (submodule === 'utility_bills_management') {
      return collectUtilityBillWorkflowImages(doc, getImageUrl);
    }

    const list = Array.isArray(doc.attachments) ? doc.attachments : [];
    list.forEach((att, idx) => {
      const src = att?.filePath || att?.path || att?.url || '';
      const mime = String(att?.mimeType || '').toLowerCase();
      if (src && (mime.startsWith('image/') || isImageLike(src))) {
        pushImage(src, att?.originalName || att?.fileName || `Attachment ${idx + 1}`);
      }
    });
    return images;
  };

  const renderWorkflowSendToAuditNoteBanner = (entity) => {
    const text = getLatestSendToAuditWorkflowComment(entity?.workflowHistory);
    if (!text) return null;
    return (
      <Alert severity="info" icon={<CommentIcon />} sx={{ mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Note with this submission
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text}
        </Typography>
      </Alert>
    );
  };

  const renderAuditFeedbackPanel = (entity) => (
    <WorkflowAuditFeedbackPanel
      document={entity}
      formatDateTime={formatDateTime}
      userDisplayName={userDisplayName}
      visualVariant="settlement"
      answerTitle="Administration response:"
    />
  );

  const renderUtilityBillMemoView = (bill) => {
    if (!bill) return null;
    const isStoreInvoice = isCentralizedStoreBill(bill);
    const billImages = getWorkflowDocImageAttachments(bill, 'utility_bills_management');
    const primaryHeading = isStoreInvoice
      ? getStoreInvoiceOrgTitle(bill)
      : (bill.accountHead || bill.site || bill.location || bill.provider || bill.utilityType || 'Utility Bill').toUpperCase();
    const secondaryHeading = isStoreInvoice
      ? getCentralizedStoreDocumentTypeLabel(bill)
      : consolidatedMemoSecondaryHeading(
        bill,
        [bill.provider, bill.utilityType].filter(Boolean).join(' - ')
      );
    return (
      <Paper
        elevation={0}
        sx={{
          maxWidth: 1050,
          mx: 'auto',
          p: { xs: 2.25, md: 5 },
          bgcolor: 'background.paper',
          color: '#151515',
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'grey.200'
        }}
      >
        {renderWorkflowSendToAuditNoteBanner(bill)}
        {renderAuditFeedbackPanel(bill)}
        <Box
          textAlign="center"
          sx={{ lineHeight: 1.12, mb: 1.75, pb: 1.25, borderBottom: '1px solid', borderColor: 'grey.200' }}
        >
          <Typography
            variant={isStoreInvoice ? 'h5' : 'h6'}
            sx={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: isStoreInvoice ? 700 : 800,
              textTransform: isStoreInvoice ? 'none' : 'uppercase',
              letterSpacing: isStoreInvoice ? 0.2 : 0.6,
              fontSize: isStoreInvoice ? { xs: 20, md: 22 } : { xs: 17, md: 19 }
            }}
          >
            {primaryHeading}
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: 700,
              fontSize: isStoreInvoice ? { xs: 16, md: 18 } : { xs: 15, md: 17 },
              mt: isStoreInvoice ? 0.5 : 0
            }}
          >
            {secondaryHeading}
          </Typography>
        </Box>

        {isStoreInvoice ? (
          <CentralizedStoreBillInvoiceBody bill={bill} />
        ) : (
        <>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 170px' }, alignItems: 'start', mb: 3 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr',
              width: { xs: '100%', md: 390 },
              ml: { xs: 0, md: 18 },
              lineHeight: 1.45,
              fontSize: 13
            }}
          >
            <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 13 }}>SITE :</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{displayValue(bill.site || bill.location)}</Typography>
            <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 13 }}>From:</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{displayValue(bill.department)}</Typography>
            <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 13 }}>Custodian:</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{displayValue(bill.custodian)}</Typography>
          </Box>
          <Box sx={{ textAlign: { xs: 'left', md: 'right' }, lineHeight: 2, mt: { xs: 2, md: 0 }, color: 'grey.800' }}>
            <Typography sx={{ fontWeight: 800, fontSize: 13, textTransform: 'uppercase' }}>{displayValue(bill.company)}</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 13 }}>{formatDateForDocument(bill.billDate)}</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 13 }}>{bill.billId}</Typography>
          </Box>
        </Box>

        <TableContainer sx={{ width: '100%', overflowX: 'auto' }}>
        <Table
          size="small"
          sx={{
            ...utilityMemoTableSx,
            mt: 1,
            borderTop: '1px solid',
            borderBottom: '1px solid',
            borderColor: 'grey.300',
            '& th': {
              bgcolor: 'grey.50',
              borderBottom: '1px solid',
              borderRight: '1px solid',
              borderColor: 'grey.300',
              p: 1,
              fontSize: 12,
              fontWeight: 800,
              textAlign: 'center',
              color: 'grey.700',
              lineHeight: 1.25
            },
            '& th:last-of-type': { borderRight: 0 },
            '& td': {
              borderBottom: 0,
              borderTop: '1px solid',
              borderRight: '1px solid',
              borderColor: 'grey.200',
              p: 1.25,
              fontSize: 13,
              verticalAlign: 'top'
            },
            '& td:last-of-type': { borderRight: 0 }
          }}
        >
          <colgroup>
            {UTILITY_MEMO_COL_WIDTHS.map((width, colIdx) => (
              <col key={`memo-col-${colIdx}`} style={{ width }} />
            ))}
          </colgroup>
          <TableHead>
            <TableRow>
              {['Date', 'Reference No', 'To Whom Paid', 'For What', 'Amount', 'Last Month Amount'].map((label) => (
                <TableCell key={label} sx={{ textAlign: label.includes('Amount') ? 'right' : 'center' }}>
                  {label === 'Reference No' ? <>Reference<br />No</> : label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {hasConsolidatedBreakdown(bill) ? (
              <>
                {sortedConsolidatedLines(bill).map((line, idx) => {
                  const ref = displayValue(line.accountNumber) || line.billId || '—';
                  const forWhatLine = displayValue(line.forWhat) || line.utilityType || '—';
                  return (
                    <TableRow key={line.bill?._id || line.bill || idx}>
                      <TableCell sx={utilityMemoDateCellSx}>
                        {formatDateForDocument(line.billDate)}
                      </TableCell>
                      <TableCell sx={utilityMemoRefCellSx}>
                        <Typography component="span" sx={{ fontWeight: 700 }}>{ref}</Typography>
                        {line.billId ? (
                          <Typography variant="caption" display="block" color="text.secondary">
                            Bill {line.billId}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                        {displayValue(line.provider)}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 700, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                        {forWhatLine}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>{formatUtilityAmount(line.amount)}</TableCell>
                      <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>
                        {formatUtilityAmount(Number(line.lastMonthAmount) || 0)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(() => {
                  const totals = getConsolidatedLineTotals(bill);
                  return (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ p: 0.6, pr: 2, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: '1px solid', borderColor: 'grey.300' }}>
                        Total
                      </TableCell>
                      <TableCell sx={{ p: 0.6, pr: 1.25, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: '1px solid', borderColor: 'grey.300' }}>
                        {formatUtilityAmount(totals.amountTotal)}
                      </TableCell>
                      <TableCell sx={{ p: 0.6, pr: 1.25, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: '1px solid', borderColor: 'grey.300' }}>
                        {formatUtilityAmount(totals.lastMonthTotal)}
                      </TableCell>
                    </TableRow>
                  );
                })()}
              </>
            ) : (
              <>
                <TableRow>
                  <TableCell sx={utilityMemoDateCellSx}>
                    {formatDateForDocument(bill.billDate)}
                  </TableCell>
                  <TableCell sx={utilityMemoRefCellSx}>{displayValue(bill.accountNumber)}</TableCell>
                  <TableCell sx={{ fontWeight: 700, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{displayValue(bill.provider)}</TableCell>
                  <TableCell sx={{ fontWeight: 700, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                    {bill.forWhat || bill.description || ''}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>{formatUtilityAmount(bill.amount)}</TableCell>
                  <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>{formatUtilityAmount(bill.lastMonthAmount)}</TableCell>
                </TableRow>
                {[
                  ['Grand Total', formatUtilityAmount(getUtilityGrandTotal(bill))],
                  ['Cash Deposit Last Month', formatUtilityAmount(bill.lastMonthAmount)],
                  ['Balance Amount to be Paid', formatUtilityAmount(getUtilityBalanceToPay(bill))]
                ].map(([label, value]) => (
                  <TableRow key={label}>
                    <TableCell colSpan={4} sx={{ p: 0.6, pr: 2, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>
                      {label}
                    </TableCell>
                    <TableCell sx={{ p: 0.6, pr: 1.25, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>
                      {value}
                    </TableCell>
                    <TableCell sx={{ borderTop: 0 }} />
                  </TableRow>
                ))}
              </>
            )}
          </TableBody>
        </Table>
        </TableContainer>
        </>
        )}

        {!isStoreInvoice && billImages.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography sx={{ fontWeight: 800, mb: 1.25 }}>Attached Bill Image{billImages.length > 1 ? 's' : ''}</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {billImages.map((img, idx) => (
                <Box key={`${img.src}-${idx}`} sx={{ flex: 1, minWidth: 240, border: '1px solid', borderColor: 'grey.300', borderRadius: 1.25, p: 1.25, bgcolor: 'grey.50' }}>
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.75, color: 'text.secondary' }}>
                    {img.name}
                  </Typography>
                  <Box
                    component="img"
                    src={img.src}
                    alt={img.name}
                    onClick={() => openImageViewer(img.src, img.name)}
                    sx={{ width: '100%', maxHeight: 320, objectFit: 'contain', backgroundColor: '#fff', borderRadius: 1, cursor: 'zoom-in' }}
                  />
                </Box>
              ))}
            </Stack>
          </Box>
        )}

        {isStoreInvoice && bill.billImage && (
          <Box sx={{ mt: 3 }}>
            <Typography sx={{ fontWeight: 800, mb: 1.25 }}>Bill header image</Typography>
            <Box
              component="img"
              src={getImageUrl(bill.billImage)}
              alt="Bill header"
              onClick={() => openImageViewer(getImageUrl(bill.billImage), 'Bill header image')}
              sx={{
                maxWidth: '100%',
                maxHeight: 320,
                objectFit: 'contain',
                border: '1px solid',
                borderColor: 'grey.300',
                borderRadius: 1,
                cursor: 'zoom-in',
                bgcolor: '#fff'
              }}
            />
          </Box>
        )}

        <Table
          size="small"
          sx={{
            mt: 7,
            border: '1px solid',
            borderColor: 'grey.300',
            '& th': { bgcolor: 'grey.100', fontWeight: 800, fontSize: 14, borderBottom: '1px solid', borderColor: 'grey.300' },
            '& td': { fontSize: 14, borderBottom: '1px solid', borderColor: 'grey.200', py: 1.4 },
            '& tr:last-child td': { borderBottom: 0 }
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>Authority</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Digital Signature</TableCell>
              <TableCell>Date &amp; Time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {getUtilityApprovalRows(bill).map((row) => (
              <TableRow key={row.authority}>
                <TableCell sx={{ fontWeight: 800 }}>{row.authority}</TableCell>
                <TableCell>{row.name || '-'}</TableCell>
                <TableCell>
                  {getSignatureSource(row) ? (
                    <DigitalSignatureImage userOrPath={getSignatureSource(row)} alt={`${row.authority} signature`} />
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>{row.dateTime || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {getUtilityStampRows(bill).length > 0 && (
          <Box sx={{ mt: 3, p: 2.5, border: '2px solid', borderColor: 'grey.300', borderRadius: 1.5, backgroundColor: 'grey.50' }}>
            <Typography sx={{ fontWeight: 900, fontSize: 17, mb: 2 }}>Approval Stamp</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {getUtilityStampRows(bill).map((stampRow) => (
                <Box key={stampRow.authority} sx={{ flex: 1, minWidth: 260, p: 2, bgcolor: 'white', border: '1.5px solid', borderColor: 'grey.400', borderRadius: 1.5, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)' }}>
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>{stampRow.authority}</Typography>
                  <Box
                    component="img"
                    src={getImageUrl(stampRow.stampImage)}
                    alt={stampRow.authority}
                    onClick={() => openImageViewer(getImageUrl(stampRow.stampImage), stampRow.authority)}
                    sx={{ display: 'block', maxHeight: 170, width: '100%', objectFit: 'contain', border: '2px dashed', borderColor: 'grey.400', p: 1.5, backgroundColor: '#fff', cursor: 'zoom-in'  }}
                  />
                  <Typography sx={{ mt: 1, fontSize: 12.5, color: 'grey.700' }}>{stampRow.dateTime || '-'}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Paper>
    );
  };

  const renderPaymentSettlementMemoView = (document) => {
    if (!document) return null;
    const billImages = getWorkflowDocImageAttachments(document, 'payment_settlement');
    return (
      <Paper
        elevation={0}
        sx={{
          maxWidth: 1050,
          mx: 'auto',
          p: { xs: 2.25, md: 5 },
          bgcolor: 'background.paper',
          color: '#151515',
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'grey.200'
        }}
      >
        {renderWorkflowSendToAuditNoteBanner(document)}
        {renderAuditFeedbackPanel(document)}
        <Box
          textAlign="center"
          sx={{ lineHeight: 1.12, mb: 1.75, pb: 1.25, borderBottom: '1px solid', borderColor: 'grey.200' }}
        >
          <Typography
            variant="h6"
            sx={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              fontSize: { xs: 17, md: 19 }
            }}
          >
            {document.parentCompanyName || 'PAYMENT SETTLEMENT'}
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, fontSize: { xs: 15, md: 17 } }}
          >
            {document.subsidiaryName || 'Payment Settlement'}
          </Typography>
        </Box>

        <Box
          sx={{
            mb: 3.5,
            p: { xs: 1.5, md: 2 },
            border: '1px solid',
            borderColor: 'grey.200',
            borderRadius: 1.5,
            background: 'linear-gradient(180deg, #fafafa 0%, #ffffff 100%)'
          }}
        >
          <Grid container spacing={1.25}>
            <Grid item xs={12} md={8}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '100px 1fr', sm: '120px 1fr' }, rowGap: 0.75, columnGap: 1 }}>
                <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5, letterSpacing: 0.3 }}>SITE</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{document.site || 'Head Office'}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5, letterSpacing: 0.3 }}>FROM</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{document.fromDepartment || 'Administration'}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5, letterSpacing: 0.3 }}>CUSTODIAN</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{document.custodian || 'N/A'}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5, letterSpacing: 0.3 }}>NOTE</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
                  {document.attachments && document.attachments.length > 0 ? 'All Supportings Attached' : 'No Attachments'}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={4}>
              <Box
                sx={{
                  height: '100%',
                  p: 1.25,
                  border: '2px dashed',
                  borderColor: 'grey.300',
                  borderRadius: 1,
                  backgroundColor: 'grey.50',
                  display: 'grid',
                  alignContent: 'center',
                  rowGap: 0.9
                }}
              >
                <Box>
                  <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 11.5, letterSpacing: 0.4 }}>DATE</Typography>
                  <Typography sx={{ fontWeight: 800, fontSize: 13.5, color: 'grey.900' }}>
                    {formatDateForDocument(document.date)}
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 11.5, letterSpacing: 0.4 }}>DOCUMENT NO.</Typography>
                  <Typography sx={{ fontWeight: 800, fontSize: 13.5, color: 'grey.900' }}>
                    {document.referenceNumber || 'N/A'}
                  </Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Box>

        <Table
          size="small"
          sx={{
            width: '100%',
            tableLayout: 'fixed',
            mt: 1,
            borderTop: '1px solid',
            borderBottom: '1px solid',
            borderColor: 'grey.300',
            '& th': {
              bgcolor: 'grey.50',
              borderBottom: '1px solid',
              borderRight: '1px solid',
              borderColor: 'grey.300',
              p: 1,
              fontSize: 12,
              fontWeight: 800,
              textAlign: 'center',
              color: 'grey.700',
              lineHeight: 1.25
            },
            '& th:last-of-type': { borderRight: 0 },
            '& td': {
              borderBottom: 0,
              borderTop: '1px solid',
              borderRight: '1px solid',
              borderColor: 'grey.200',
              p: 1.25,
              fontSize: 13,
              verticalAlign: 'top'
            },
            '& td:last-of-type': { borderRight: 0 }
          }}
        >
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Reference No</TableCell>
              <TableCell>To Whom Paid</TableCell>
              <TableCell>For What</TableCell>
              <TableCell sx={{ textAlign: 'right' }}>Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap' }}>{formatDateForDocument(document.date)}</TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{document.referenceNumber || 'N/A'}</TableCell>
              <TableCell sx={{ fontWeight: 700, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{document.toWhomPaid || 'N/A'}</TableCell>
              <TableCell sx={{ fontWeight: 700, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{document.forWhat || ''}</TableCell>
              <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>{formatPKR(document.amount || document.grandTotal || 0)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={4} sx={{ p: 0.6, pr: 2, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>
                Grand Total
              </TableCell>
              <TableCell sx={{ p: 0.6, pr: 1.25, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>
                {formatPKR(document.grandTotal || document.amount || 0)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {billImages.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography sx={{ fontWeight: 800, mb: 1.25 }}>Attached Bill Image{billImages.length > 1 ? 's' : ''}</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {billImages.map((img, idx) => (
                <Box key={`${img.src}-${idx}`} sx={{ flex: 1, minWidth: 240, border: '1px solid', borderColor: 'grey.300', borderRadius: 1.25, p: 1.25, bgcolor: 'grey.50' }}>
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.75, color: 'text.secondary' }}>
                    {img.name}
                  </Typography>
                  <Box
                    component="img"
                    src={img.src}
                    alt={img.name}
                    onClick={() => openImageViewer(img.src, img.name)}
                    sx={{ width: '100%', maxHeight: 320, objectFit: 'contain', backgroundColor: '#fff', borderRadius: 1, cursor: 'zoom-in' }}
                  />
                </Box>
              ))}
            </Stack>
          </Box>
        )}

        <Table
          size="small"
          sx={{
            mt: 7,
            border: '1px solid',
            borderColor: 'grey.300',
            '& th': { bgcolor: 'grey.100', fontWeight: 800, fontSize: 14, borderBottom: '1px solid', borderColor: 'grey.300' },
            '& td': { fontSize: 14, borderBottom: '1px solid', borderColor: 'grey.200', py: 1.4 },
            '& tr:last-child td': { borderBottom: 0 }
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>Authority</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Digital Signature</TableCell>
              <TableCell>Date &amp; Time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {getPaymentSettlementApprovalRows(document).map((row) => (
              <TableRow key={row.authority}>
                <TableCell sx={{ fontWeight: 800 }}>{row.authority}</TableCell>
                <TableCell>{row.name || '-'}</TableCell>
                <TableCell>
                  {getSignatureSource(row) ? (
                    <DigitalSignatureImage userOrPath={getSignatureSource(row)} alt={`${row.authority} signature`} />
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>{row.dateTime || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {getPaymentSettlementStampRows(document).length > 0 && (
          <Box sx={{ mt: 3, p: 2.5, border: '2px solid', borderColor: 'grey.300', borderRadius: 1.5, backgroundColor: 'grey.50' }}>
            <Typography sx={{ fontWeight: 900, fontSize: 17, mb: 2 }}>Approval Stamp</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {getPaymentSettlementStampRows(document).map((stampRow) => (
                <Box key={stampRow.authority} sx={{ flex: 1, minWidth: 260, p: 2, bgcolor: 'white', border: '1.5px solid', borderColor: 'grey.400', borderRadius: 1.5, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)' }}>
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>{stampRow.authority}</Typography>
                  <Box
                    component="img"
                    src={getImageUrl(stampRow.stampImage)}
                    alt={stampRow.authority}
                    onClick={() => openImageViewer(getImageUrl(stampRow.stampImage), stampRow.authority)}
                    sx={{ display: 'block', maxHeight: 170, width: '100%', objectFit: 'contain', border: '2px dashed', borderColor: 'grey.400', p: 1.5, backgroundColor: '#fff', cursor: 'zoom-in'  }}
                  />
                  <Typography sx={{ mt: 1, fontSize: 12.5, color: 'grey.700' }}>{stampRow.dateTime || '-'}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Paper>
    );
  };

  const renderRentalManagementMemoView = (document) => {
    if (!document) return null;
    const billImages = getWorkflowDocImageAttachments(document, 'rental_management');
    const statusLabel = (document.workflowStatus && document.workflowStatus !== 'Draft')
      ? document.workflowStatus
      : (document.approvalStatus || document.status || 'Draft');
    const statusColor = String(statusLabel).includes('Approved')
      ? 'success'
      : (statusLabel === 'Submitted' || statusLabel === 'Send to Audit' || statusLabel === 'Forwarded to Audit Director')
        ? 'warning'
        : (String(statusLabel).includes('Rejected') || statusLabel === 'Returned from Audit')
          ? 'error'
          : 'default';
    return (
      <Paper
        elevation={0}
        sx={{
          maxWidth: 1050,
          mx: 'auto',
          p: { xs: 2.25, md: 5 },
          bgcolor: 'background.paper',
          color: '#151515',
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'grey.200'
        }}
      >
        {renderWorkflowSendToAuditNoteBanner(document)}
        {renderAuditFeedbackPanel(document)}
        <Box textAlign="center" sx={{ lineHeight: 1.12, mb: 1.75, pb: 1.25, borderBottom: '1px solid', borderColor: 'grey.200' }}>
          <Typography
            variant="h6"
            sx={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              fontSize: { xs: 17, md: 19 }
            }}
          >
            {document.parentCompanyName || 'RENTAL MANAGEMENT'}
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, fontSize: { xs: 15, md: 17 } }}
          >
            {document.subsidiaryName || 'Rental Management'}
          </Typography>
        </Box>

        <Box sx={{ mb: 3.5, p: { xs: 1.5, md: 2 }, border: '1px solid', borderColor: 'grey.200', borderRadius: 1.5, background: 'linear-gradient(180deg, #fafafa 0%, #ffffff 100%)' }}>
          <Grid container spacing={1.25}>
            <Grid item xs={12} md={8}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '100px 1fr', sm: '120px 1fr' }, rowGap: 0.75, columnGap: 1 }}>
                <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5, letterSpacing: 0.3 }}>SITE</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{document.site || 'N/A'}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5, letterSpacing: 0.3 }}>FROM</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{document.fromDepartment || 'N/A'}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5, letterSpacing: 0.3 }}>CUSTODIAN</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{document.custodian || 'N/A'}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5, letterSpacing: 0.3 }}>STATUS</Typography>
                <Box>
                  <Chip label={statusLabel} color={statusColor} size="small" />
                </Box>
              </Box>
            </Grid>
            <Grid item xs={12} md={4}>
              <Box sx={{ height: '100%', p: 1.25, border: '2px dashed', borderColor: 'grey.300', borderRadius: 1, backgroundColor: 'grey.50', display: 'grid', alignContent: 'center', rowGap: 0.9 }}>
                <Box>
                  <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 11.5, letterSpacing: 0.4 }}>DATE</Typography>
                  <Typography sx={{ fontWeight: 800, fontSize: 13.5, color: 'grey.900' }}>{formatDateForDocument(document.date)}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 11.5, letterSpacing: 0.4 }}>DOCUMENT NO.</Typography>
                  <Typography sx={{ fontWeight: 800, fontSize: 13.5, color: 'grey.900' }}>{document.referenceNumber || document.referenceNo || document.voucherNumber || document._id}</Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Box>

        <Table size="small" sx={{ width: '100%', tableLayout: 'fixed', mt: 1, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'grey.300', '& th': { bgcolor: 'grey.50', borderBottom: '1px solid', borderRight: '1px solid', borderColor: 'grey.300', p: 1, fontSize: 12, fontWeight: 800, textAlign: 'center', color: 'grey.700', lineHeight: 1.25 }, '& th:last-of-type': { borderRight: 0 }, '& td': { borderBottom: 0, borderTop: '1px solid', borderRight: '1px solid', borderColor: 'grey.200', p: 1.25, fontSize: 13, verticalAlign: 'top' }, '& td:last-of-type': { borderRight: 0 } }}>
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Reference No</TableCell>
              <TableCell>To Whom Paid</TableCell>
              <TableCell>For What</TableCell>
              <TableCell sx={{ textAlign: 'right' }}>Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap' }}>{formatDateForDocument(document.date)}</TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{document.referenceNumber || document.referenceNo || document.voucherNumber || 'N/A'}</TableCell>
              <TableCell sx={{ fontWeight: 700, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{document.toWhomPaid || 'N/A'}</TableCell>
              <TableCell sx={{ fontWeight: 700, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{document.forWhat || ''}</TableCell>
              <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>{formatPKR(document.amount || document.grandTotal || 0)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={4} sx={{ p: 0.6, pr: 2, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>Grand Total</TableCell>
              <TableCell sx={{ p: 0.6, pr: 1.25, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>{formatPKR(document.grandTotal || document.amount || 0)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {billImages.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography sx={{ fontWeight: 800, mb: 1.25 }}>Attached Bill Image{billImages.length > 1 ? 's' : ''}</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {billImages.map((img, idx) => (
                <Box key={`${img.src}-${idx}`} sx={{ flex: 1, minWidth: 240, border: '1px solid', borderColor: 'grey.300', borderRadius: 1.25, p: 1.25, bgcolor: 'grey.50' }}>
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.75, color: 'text.secondary' }}>
                    {img.name}
                  </Typography>
                  <Box
                    component="img"
                    src={img.src}
                    alt={img.name}
                    onClick={() => openImageViewer(img.src, img.name)}
                    sx={{ width: '100%', maxHeight: 320, objectFit: 'contain', backgroundColor: '#fff', borderRadius: 1, cursor: 'zoom-in' }}
                  />
                </Box>
              ))}
            </Stack>
          </Box>
        )}

        <Table size="small" sx={{ mt: 7, border: '1px solid', borderColor: 'grey.300', '& th': { bgcolor: 'grey.100', fontWeight: 800, fontSize: 14, borderBottom: '1px solid', borderColor: 'grey.300' }, '& td': { fontSize: 14, borderBottom: '1px solid', borderColor: 'grey.200', py: 1.4 }, '& tr:last-child td': { borderBottom: 0 } }}>
          <TableHead>
            <TableRow>
              <TableCell>Authority</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Digital Signature</TableCell>
              <TableCell>Date &amp; Time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {getRentalManagementApprovalRows(document).map((row) => (
              <TableRow key={row.authority}>
                <TableCell sx={{ fontWeight: 800 }}>{row.authority}</TableCell>
                <TableCell>{row.name || '-'}</TableCell>
                <TableCell>
                  {getSignatureSource(row) ? (
                    <DigitalSignatureImage userOrPath={getSignatureSource(row)} alt={`${row.authority} signature`} />
                  ) : '-'}
                </TableCell>
                <TableCell>{row.dateTime || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {getRentalManagementStampRows(document).length > 0 && (
          <Box sx={{ mt: 3, p: 2.5, border: '2px solid', borderColor: 'grey.300', borderRadius: 1.5, backgroundColor: 'grey.50' }}>
            <Typography sx={{ fontWeight: 900, fontSize: 17, mb: 2 }}>Approval Stamp</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {getRentalManagementStampRows(document).map((stampRow) => (
                <Box key={stampRow.authority} sx={{ flex: 1, minWidth: 260, p: 2, bgcolor: 'white', border: '1.5px solid', borderColor: 'grey.400', borderRadius: 1.5, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)' }}>
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>{stampRow.authority}</Typography>
                  <Box
                    component="img"
                    src={getImageUrl(stampRow.stampImage)}
                    alt={stampRow.authority}
                    onClick={() => openImageViewer(getImageUrl(stampRow.stampImage), stampRow.authority)}
                    sx={{ display: 'block', maxHeight: 170, width: '100%', objectFit: 'contain', border: '2px dashed', borderColor: 'grey.400', p: 1.5, backgroundColor: '#fff', cursor: 'zoom-in'  }}
                  />
                  <Typography sx={{ mt: 1, fontSize: 12.5, color: 'grey.700' }}>{stampRow.dateTime || '-'}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Paper>
    );
  };

  // Number to words converter for Purchase Orders
  const numberToWords = (num) => {
    if (!num || num === 0) return 'Zero Rupees Only';
    
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    
    const convert = (n) => {
      if (n === 0) return '';
      if (n < 10) return ones[n];
      if (n < 20) return teens[n - 10];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
      if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
      if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
      if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
      return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
    };
    
    const amount = Math.floor(num);
    const paise = Math.round((num - amount) * 100);
    
    let result = convert(amount) + ' Rupees';
    if (paise > 0) {
      result += ' and ' + convert(paise) + ' Paise';
    }
    result += ' Only';
    
    return result;
  };

  const formatDateForPrint = (date) => {
    if (!date) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(date);
    return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined) return '0.00';
    return parseFloat(num).toFixed(2);
  };

  const renderIndentApprovalProgress = (indent, { title = 'Indent approval progress' } = {}) => {
    if (!indent) return null;
    const steps = Array.isArray(indent.approvalChain) ? indent.approvalChain : [];
    return (
      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
          {title}
        </Typography>
        {steps.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No indent approval chain is recorded for this requisition.
          </Typography>
        ) : (
          <Table size="small" sx={{ border: '1px solid', borderColor: 'divider', maxWidth: 760 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ fontWeight: 700 }}>Approver</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Date &amp; time</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Digital signature</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {steps.map((step, idx) => {
                const approver = step.approver;
                const aid = approver?._id || approver;
                const name =
                  [approver?.firstName, approver?.lastName].filter(Boolean).join(' ').trim() ||
                  approver?.email ||
                  (aid ? `User ${String(aid).slice(-6)}` : `Approver ${idx + 1}`);
                const status = step.status || 'pending';
                const chipColor = status === 'approved' ? 'success' : status === 'rejected' ? 'error' : 'warning';
                const chipLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending approval';
                return (
                  <TableRow key={String(aid || idx)}>
                    <TableCell>{name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={chipLabel}
                        color={chipColor}
                        variant={status === 'pending' ? 'outlined' : 'filled'}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {step.actedAt ? new Date(step.actedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell align="center">
                      {status === 'approved' && approver?.digitalSignature ? (
                        <DigitalSignatureImage userOrPath={approver} alt={`Signature ${name}`} />
                      ) : status === 'approved' ? (
                        <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Box>
    );
  };

  // Purchase Order View Component
  const PurchaseOrderView = ({ poData }) => {
    if (!poData) return null;
    const authorityText = poData.approvalAuthorities || {};
    const indent = poData.indent && typeof poData.indent === 'object' ? poData.indent : {};
    const csa = indent.comparativeStatementApprovals || {};
    const approvalSteps = Array.isArray(indent?.comparativeApproval?.approvers)
      ? indent.comparativeApproval.approvers
      : [];
    const stepByUserId = new Map(
      approvalSteps.map((step) => [String(step?.approver?._id || step?.approver || ''), step])
    );
    const personName = (user, fallback = '') => {
      if (fallback && String(fallback).trim()) return String(fallback).trim();
      if (user) {
        const n = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
        if (n) return n;
        if (user?.email) return user.email;
      }
      return '—';
    };
    const authorityRows = [
      { key: 'preparedBy', label: 'Prepared By', user: csa.preparedByUser, fallback: authorityText.preparedBy || csa.preparedBy || '' },
      { key: 'managerProcurement', label: 'Manager Procurement', user: csa.managerProcurementUser, fallback: authorityText.managerProcurement || csa.managerProcurement || '' },
      ...(authorityText.srManagerProcurement ? [
        { key: 'srManagerProcurement', label: 'Sr Manager Procurement', user: null, fallback: authorityText.srManagerProcurement || '' }
      ] : []),
      { key: 'chiefOperatingOfficer', label: 'Chief operating officer', user: null, fallback: authorityText.chiefOperatingOfficer || authorityText.verifiedBy || csa.verifiedBy || '' },
      { key: 'avpTaj', label: 'AVP Taj', user: null, fallback: authorityText.avpTaj || authorityText.authorisedRep || csa.authorisedRep || '' },
      ...(authorityText.technicalDepartment || csa.technicalDepartment ? [
        { key: 'technicalDepartment', label: 'Technical Department', user: null, fallback: authorityText.technicalDepartment || csa.technicalDepartment || '' }
      ] : []),
      { key: 'preAuditInitial', label: 'Initial Pre-Audit', user: poData.preAuditInitialApprovedBy, fallback: '' },
      { key: 'auditDirectorApproval', label: 'Audit Director', user: poData.auditApprovedBy, fallback: '' }
    ];
    const authorityApprovalByKey = new Map(
      (Array.isArray(poData.authorityApprovals) ? poData.authorityApprovals : [])
        .filter((entry) => entry?.authorityKey)
        .map((entry) => [String(entry.authorityKey), entry])
    );
    const auditAction = poData.auditRejectedBy
        ? {
            label: 'Rejected by Pre-Audit',
            user: poData.auditRejectedBy,
            actedAt: poData.auditRejectedAt,
            comments: poData.auditRejectionComments || ''
          }
        : poData.auditReturnedBy
          ? {
              label: 'Returned by Pre-Audit',
              user: poData.auditReturnedBy,
              actedAt: poData.auditReturnedAt,
              comments: poData.auditReturnComments || ''
            }
          : null;
    
    return (
      <Paper
        className="po-print-page"
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
            p: '7mm 9mm',
            maxWidth: '100%',
            backgroundColor: '#fff',
            mx: 0,
            width: '100%'
          }
        }}
      >
        {/* Title - Centered */}
        <Typography
          variant="h4"
          fontWeight={700}
          align="center"
          sx={{
            textTransform: 'uppercase',
            mb: 3,
            fontSize: { xs: '1.8rem', print: '1.6rem' },
            letterSpacing: 1,
            '@media print': { mb: 1, fontSize: '22px' }
          }}
        >
          Purchase Order
        </Typography>

        {/* Audit Rejection Observations - Show if status is Rejected */}
        {poData.status === 'Rejected' && poData.auditRejectObservations && poData.auditRejectObservations.length > 0 && (
          <Box sx={{ mb: 3, p: 2, bgcolor: alpha(theme.palette.error.main, 0.1), border: `1px solid ${theme.palette.error.main}`, borderRadius: 1 }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'error.main', fontWeight: 'bold' }}>
              Audit Rejection Observations
            </Typography>
            {poData.auditRejectionComments && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Rejection Comments:</Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                  {poData.auditRejectionComments}
                </Typography>
              </Box>
            )}
            {poData.auditRejectObservations.map((obs, index) => (
              <Box key={index} sx={{ mb: 1.5, p: 1.5, bgcolor: '#fff', borderRadius: 1, border: '1px solid', borderColor: 'error.light' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    Observation {index + 1}
                  </Typography>
                  {obs.severity && (
                    <Chip 
                      label={obs.severity.charAt(0).toUpperCase() + obs.severity.slice(1)} 
                      size="small" 
                      color={obs.severity === 'critical' ? 'error' : obs.severity === 'high' ? 'warning' : 'default'}
                    />
                  )}
                </Box>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                  {obs.observation}
                </Typography>
              </Box>
            ))}
            {poData.auditRejectedBy && (
              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                Rejected by: {poData.auditRejectedBy?.firstName || ''} {poData.auditRejectedBy?.lastName || ''}
                {poData.auditRejectedAt && ` on ${formatDate(poData.auditRejectedAt)}`}
              </Typography>
            )}
          </Box>
        )}

        {/* Audit Observations & Procurement Responses - Show when PO was returned/rejected and resubmitted (Pending Audit) or has answers */}
        {(() => {
          const observations = poData.auditObservations && poData.auditObservations.length > 0
            ? poData.auditObservations
            : (poData.auditRejectObservations || []).map((obs, idx) => ({
                observation: typeof obs === 'object' ? obs.observation : obs,
                severity: typeof obs === 'object' ? (obs.severity || 'medium') : 'medium',
                addedBy: poData.auditRejectedBy,
                addedAt: poData.auditRejectedAt,
                answer: null,
                answeredBy: null,
                answeredAt: null,
                resolved: false
              }));
          const showSection = (poData.status === 'Pending Audit' || poData.status === 'Returned from Audit') && observations.length > 0;
          const hasChangeSummary = poData.resubmissionChangeSummary && String(poData.resubmissionChangeSummary).trim().length > 0;
          if (!showSection) return null;
          return (
            <Box sx={{ mb: 3, p: 2, bgcolor: alpha(theme.palette.warning.main, 0.08), border: '1px solid', borderColor: 'warning.main', borderRadius: 1 }}>
              <Typography variant="h6" sx={{ mb: 2, color: 'warning.dark', fontWeight: 'bold' }}>
                Audit Observations &amp; Procurement Responses
              </Typography>
              {poData.auditReturnComments && poData.status === 'Returned from Audit' && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Return Comments:</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                    {poData.auditReturnComments}
                  </Typography>
                </Box>
              )}
              {poData.auditRejectionComments && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Rejection Comments:</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                    {poData.auditRejectionComments}
                  </Typography>
                </Box>
              )}
              {/* Show changes made to PO by Procurement when they resubmitted (e.g. quantity reduced) */}
              {hasChangeSummary && (
                <Box sx={{ mb: 2, p: 1.5, bgcolor: alpha(theme.palette.info.main, 0.08), borderRadius: 1, border: '1px solid', borderColor: 'info.light' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'info.dark' }}>
                    Changes made to PO by Procurement (on resubmission):
                  </Typography>
                  <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.875rem', m: 0 }}>
                    {poData.resubmissionChangeSummary}
                  </Typography>
                </Box>
              )}
              {observations.map((obs, index) => (
                <Box key={obs._id || index} sx={{ mb: 2, p: 1.5, bgcolor: '#fff', borderRadius: 1, border: '1px solid', borderColor: 'warning.light' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Observation {index + 1}
                    </Typography>
                    {obs.severity && (
                      <Chip
                        label={String(obs.severity).charAt(0).toUpperCase() + String(obs.severity).slice(1)}
                        size="small"
                        color={obs.severity === 'critical' ? 'error' : obs.severity === 'high' ? 'warning' : 'default'}
                      />
                    )}
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                    Raised by Audit{obs.addedBy ? `: ${obs.addedBy?.firstName || ''} ${obs.addedBy?.lastName || ''}` : ''}
                    {obs.addedAt ? ` on ${formatDate(obs.addedAt)}` : ''}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: obs.answer ? 1.5 : 0 }}>
                    {obs.observation}
                  </Typography>
                  {obs.answer ? (
                    <Box sx={{ mt: 1.5, p: 1.5, bgcolor: alpha(theme.palette.success.main, 0.1), borderRadius: 1, border: '1px solid', borderColor: 'success.light' }}>
                      <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5, color: 'success.dark' }}>
                        Response from Procurement (edit / correction):
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{obs.answer}</Typography>
                      {obs.answeredBy && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                          Answered by: {obs.answeredBy?.firstName || ''} {obs.answeredBy?.lastName || ''}
                          {obs.answeredAt ? ` on ${formatDate(obs.answeredAt)}` : ''}
                        </Typography>
                      )}
                    </Box>
                  ) : hasChangeSummary ? (
                    <Typography variant="caption" sx={{ color: 'info.dark', display: 'block', mt: 1 }}>
                      Procurement updated the PO in response (see changes above).
                    </Typography>
                  ) : (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic', display: 'block', mt: 1 }}>
                      No response from Procurement yet
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          );
        })()}

        {/* Buyer Information - First Row */}
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: '1.1rem' }}>
            {poData.companyId?.name || poData.indent?.companyId?.name || '—'}
          </Typography>
          <Typography sx={{ fontSize: '0.9rem' }}>
            Link Road I-14, adjacent to CDA Sectors I-14 and I-15
          </Typography>
        </Box>

        {/* Divider */}
        <Divider sx={{ my: 2.5, borderWidth: 1, borderColor: '#ccc' }} />

        {/* Vendor and PO Details - Second Row in Columns */}
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', gap: 3 }}>
          {/* Left Column - Vendor Info */}
          <Box sx={{ width: '45%', fontSize: '0.9rem' }}>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: '1.1rem' }}>
              {poData.vendor?.name || 'Vendor Name'}
            </Typography>
            <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.6, mb: 2 }}>
              {poData.vendor?.address || 'Vendor Address'}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', lineHeight: 1.6 }}>
              <Typography component="span" sx={{ fontWeight: 600, mr: 1 }}>Indent Details:</Typography>
              <Typography component="span">
                Indent# {poData.indent?.indentNumber || 'N/A'} Dated. {poData.indent?.requestedDate ? formatDateForPrint(poData.indent.requestedDate) : 'N/A'}.
                {poData.indent?.title && ` ${poData.indent.title}.`}
                {poData.indent?.requestedBy && ` End User. ${poData.indent.requestedBy.firstName} ${poData.indent.requestedBy.lastName}`}
              </Typography>
            </Box>
          </Box>

          {/* Right Column - PO Details */}
          <Box sx={{ width: '50%', fontSize: '0.9rem', lineHeight: 2 }}>
            <Box sx={{ display: 'flex', mb: 0.5 }}>
              <Typography component="span" sx={{ minWidth: '140px', fontWeight: 600 }}>P.O No.:</Typography>
              <Typography component="span">
                {poData.orderNumber ? 
                  (poData.orderNumber.startsWith('P') && !poData.orderNumber.includes('-')
                    ? poData.orderNumber
                    : 'P' + (poData.orderNumber.match(/\d+$/)?.[0] || poData.orderNumber.split('-').pop() || '').padStart(9, '0'))
                  : 'N/A'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', mb: 0.5 }}>
              <Typography component="span" sx={{ minWidth: '140px', fontWeight: 600 }}>Date:</Typography>
              <Typography component="span">{formatDateForPrint(poData.orderDate)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', mb: 0.5 }}>
              <Typography component="span" sx={{ minWidth: '140px', fontWeight: 600 }}>Delivery Date:</Typography>
              <Typography component="span">{poData.expectedDeliveryDate ? formatDateForPrint(poData.expectedDeliveryDate) : '___________'}</Typography>
            </Box>
            <Box sx={{ display: 'flex', mb: 0.5 }}>
              <Typography component="span" sx={{ minWidth: '140px', fontWeight: 600 }}>Delivery Address:</Typography>
              <Typography component="span">
                {typeof poData.deliveryAddress === 'string' && poData.deliveryAddress.trim()
                  ? poData.deliveryAddress.trim()
                  : poData.shippingAddress && typeof poData.shippingAddress === 'object'
                    ? [poData.shippingAddress.street, poData.shippingAddress.city, poData.shippingAddress.state, poData.shippingAddress.zipCode, poData.shippingAddress.country].filter(Boolean).join(', ') || (poData.vendor?.address || '___________')
                    : poData.vendor?.address || '___________'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', mb: 0.5 }}>
              <Typography component="span" sx={{ minWidth: '140px', fontWeight: 600 }}>Cost Center:</Typography>
              <Typography component="span">{formatPurchaseOrderCostCenter(poData)}</Typography>
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
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'center', width: '5%' }}>
                  Sr no
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '11%' }}>
                  Product
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '23%' }}>
                  Description
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '14%' }}>
                  Specification
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '11%' }}>
                  Brand
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'center', width: '11%' }}>
                  Quantity Unit
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'right', width: '10%' }}>
                  Rate
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'right', width: '10%' }}>
                  Discount
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'right', width: '11%' }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {poData.items && poData.items.length > 0 ? (
                poData.items.map((item, index) => (
                  <tr key={index} style={{ border: '1px solid #000' }}>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>
                      {index + 1}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.productCode || poData.indent?.items?.[index]?.itemCode || `44-001-${String(index + 1).padStart(4, '0')}`}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.description || poData.indent?.items?.[index]?.itemName || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.specification || poData.indent?.items?.[index]?.specification || poData.indent?.items?.[index]?.description || poData.indent?.items?.[index]?.purpose || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.brand || poData.indent?.items?.[index]?.brand || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>
                      {item.quantity ? `${formatNumber(item.quantity)} ${item.unit || 'Nos'}` : '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>
                      {item.unitPrice != null ? formatNumber(item.unitPrice) : '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>
                      {formatNumber(item.discount || 0)}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>
                      {item.amount != null ? formatNumber(item.amount) : '___________'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center' }}>
                    No items
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Box>

        {/* Financial Summary - Right Aligned */}
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Box sx={{ width: '300px', fontSize: '0.9rem' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography component="span" fontWeight={600}>Total (Rupees):</Typography>
              <Typography component="span">{formatNumber(poData.totalAmount || 0)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography component="span" fontWeight={600}>Net Total:</Typography>
              <Typography component="span">{formatNumber(poData.totalAmount || 0)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
              <Typography component="span" fontWeight={600}>Freight Charges:</Typography>
              <Typography component="span">{formatNumber(poData.shippingCost || 0)}</Typography>
            </Box>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, fontStyle: 'italic' }}>
              Rupees {numberToWords(poData.totalAmount || 0)}
            </Typography>
          </Box>
        </Box>

        {/* Terms & Conditions */}
        <Box sx={{ mb: 3, border: '1px solid #ccc', p: 2, fontSize: '0.9rem' }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, textDecoration: 'underline' }}>
            TERMS & CONDITIONS
          </Typography>
          <Box sx={{ lineHeight: 1.8 }}>
            <Typography sx={{ mb: 1, fontWeight: 600 }}>Main Terms & Conditions</Typography>
            <Box sx={{ mb: 1 }}>
              <Typography component="span" fontWeight={600}>Payment Terms:</Typography>
              <Typography component="span" sx={{ ml: 1 }}>
                {poData.paymentTerms || '100% Advance Payment'}
              </Typography>
            </Box>
            <Box sx={{ mb: 1 }}>
              <Typography component="span" fontWeight={600}>Delivery Terms:</Typography>
              <Typography component="span" sx={{ ml: 1 }}>
                At-Site Delivery
              </Typography>
            </Box>
            <Box sx={{ mb: 1 }}>
              <Typography component="span" fontWeight={600}>Delivery Time.</Typography>
              <Typography component="span" sx={{ ml: 1 }}>
                Delivery within: {poData.quotation?.deliveryTime || '03 days'} of confirmed PO & Payment
              </Typography>
            </Box>
            <Typography sx={{ mb: 1 }}>
              Rates Are Exclusive Of all The Taxes
            </Typography>
            {poData.vendor?.cnic && (
              <Typography sx={{ mb: 1 }}>
                CNIC {poData.vendor.cnic}
              </Typography>
            )}
            {poData.vendor?.payeeName && (
              <Typography>
                Payee Name: {poData.vendor.payeeName}
              </Typography>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 3, '@media print': { my: 0.6 } }} />

        <Box
          className="po-approval-block"
          sx={{ '@media print': { mb: 0 } }}
        >
        <StoreVettingNotice indent={indent} sx={{ mb: 0.75, '@media print': { mb: 0.25 } }} />
        <Typography variant="subtitle1" fontWeight={700} mb={1.5} sx={{ textAlign: 'center', '@media print': { mb: 0.35, fontSize: '9px' } }}>
          APPROVAL AUTHORITIES
        </Typography>
        <TableContainer component={Box} sx={{ border: '1px solid #ccc', mb: 4, '@media print': { mb: 0.5 } }}>
          <Table
            size="small"
            className="po-authority-table"
            sx={{
              '& th, & td': {
                '@media print': { py: '1px !important', px: '3px !important', fontSize: '8.5px !important', lineHeight: 1.15 }
              },
              '& img': {
                '@media print': { maxHeight: '14px !important', maxWidth: '70px !important' }
              }
            }}
          >
            <TableHead>
              <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700 }}>Authority</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700, textAlign: 'center' }}>Digital Signature</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700 }}>Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {authorityRows.map((row) => {
                const uid = String(row?.user?._id || row?.user || '');
                const step = uid ? stepByUserId.get(uid) : null;
                const authorityApproval = authorityApprovalByKey.get(String(row.key));
                const authorityUser = authorityApproval?.approver && typeof authorityApproval.approver === 'object'
                  ? authorityApproval.approver
                  : step?.approver && typeof step.approver === 'object'
                    ? step.approver
                    : row.user;
                const actionDate = authorityApproval?.approvedAt
                  || step?.actedAt
                  || (row.key === 'preAuditInitial' ? poData.preAuditInitialApprovedAt : null)
                  || (row.key === 'auditDirectorApproval' ? poData.auditApprovedAt : null)
                  || null;
                const displayAuthorityName = authorityApproval?.approver
                  ? ([authorityApproval.approver.firstName, authorityApproval.approver.lastName].filter(Boolean).join(' ').trim() || authorityApproval.approver.email || row.fallback || '—')
                  : personName(authorityUser, row.fallback);
                return (
                  <TableRow key={row.key}>
                    <TableCell sx={{ border: '1px solid #ccc', fontWeight: 600 }}>{row.label}</TableCell>
                    <TableCell sx={{ border: '1px solid #ccc' }}>{displayAuthorityName}</TableCell>
                    <TableCell sx={{ border: '1px solid #ccc', textAlign: 'center' }}>
                      {authorityUser?.digitalSignature ? (
                        <DigitalSignatureImage userOrPath={authorityUser} alt={`${row.label} signature`} />
                      ) : (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ border: '1px solid #ccc' }}>
                      {actionDate ? formatDateTime(actionDate) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
              {auditAction && (
                <TableRow>
                  <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700, color: 'primary.main' }}>
                    {auditAction.label}
                  </TableCell>
                  <TableCell sx={{ border: '1px solid #ccc' }}>
                    {personName(auditAction.user)}
                    {auditAction.comments ? (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
                        {auditAction.comments}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell sx={{ border: '1px solid #ccc', textAlign: 'center' }}>
                    {auditAction.user?.digitalSignature ? (
                      <DigitalSignatureImage userOrPath={auditAction.user} alt="Pre-Audit signature" />
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ border: '1px solid #ccc' }}>
                    {auditAction.actedAt ? formatDateTime(auditAction.actedAt) : '—'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        </Box>

      </Paper>
    );
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box
        sx={{
          mb: 2.5,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 2
        }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', letterSpacing: '-0.02em' }}>
            Pre Audit
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Work queue · {PRE_AUDIT_TAB_LABELS[tabValue]}
            {typeof totalCount === 'number' ? ` · ${totalCount} document${totalCount === 1 ? '' : 's'}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {PRE_AUDIT_TAB_STATUS_KEYS.slice(0, 4).map((key, idx) => {
            const count = tabCounts[key];
            const isActive = tabValue === idx;
            return (
              <Chip
                key={key}
                size="small"
                label={`${PRE_AUDIT_TAB_LABELS[idx]}${count != null ? ` ${count}` : ''}`}
                color={isActive ? 'primary' : 'default'}
                variant={isActive ? 'filled' : 'outlined'}
                onClick={() => {
                  setPage(0);
                  setTabValue(idx);
                }}
                sx={{ fontWeight: isActive ? 600 : 500 }}
              />
            );
          })}
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Card
        sx={{
          mb: 3,
          borderRadius: 2,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          border: '1px solid',
          borderColor: 'divider'
        }}
      >
        <CardContent sx={{ pb: '16px !important' }}>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.5,
              alignItems: 'center',
              mb: 1.5
            }}
          >
            <TextField
              size="small"
              placeholder="Search by number, title, vendor…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{ flex: '1 1 240px', minWidth: 200, maxWidth: 420 }}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />
              }}
            />
            <Button
              size="small"
              variant={moreFiltersOpen || activeFilterCount > 0 ? 'contained' : 'outlined'}
              color={activeFilterCount > 0 ? 'primary' : 'inherit'}
              startIcon={<FilterListIcon />}
              endIcon={moreFiltersOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              onClick={() => setMoreFiltersOpen((v) => !v)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Button>
            {activeFilterCount > 0 && (
              <Button
                size="small"
                color="inherit"
                onClick={() => setFilters({ status: '', sourceDepartment: '', sourceModule: '', documentType: '', priority: '' })}
                sx={{ textTransform: 'none' }}
              >
                Clear
              </Button>
            )}
          </Box>

          <Collapse in={moreFiltersOpen}>
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={4} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Module</InputLabel>
                  <Select
                    value={filters.sourceModule}
                    label="Module"
                    onChange={(e) => setFilters({ ...filters, sourceModule: e.target.value })}
                  >
                    <MenuItem value="">All</MenuItem>
                    <MenuItem value="hr">HR</MenuItem>
                    <MenuItem value="finance">Finance</MenuItem>
                    <MenuItem value="procurement">Procurement</MenuItem>
                    <MenuItem value="admin">Admin</MenuItem>
                    <MenuItem value="sales">Sales</MenuItem>
                    <MenuItem value="crm">CRM</MenuItem>
                    <MenuItem value="it">IT</MenuItem>
                    <MenuItem value="general">General</MenuItem>
                    <MenuItem value="taj_residencia">Taj Residencia</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Document Type</InputLabel>
                  <Select
                    value={filters.documentType}
                    label="Document Type"
                    onChange={(e) => setFilters({ ...filters, documentType: e.target.value })}
                  >
                    <MenuItem value="">All</MenuItem>
                    <MenuItem value="invoice">Invoice</MenuItem>
                    <MenuItem value="receipt">Receipt</MenuItem>
                    <MenuItem value="agreement">Agreement</MenuItem>
                    <MenuItem value="report">Report</MenuItem>
                    <MenuItem value="statement">Statement</MenuItem>
                    <MenuItem value="certificate">Certificate</MenuItem>
                    <MenuItem value="license">License</MenuItem>
                    <MenuItem value="permit">Permit</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Priority</InputLabel>
                  <Select
                    value={filters.priority}
                    label="Priority"
                    onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
                  >
                    <MenuItem value="">All</MenuItem>
                    <MenuItem value="low">Low</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                    <MenuItem value="urgent">Urgent</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Collapse>

          <Tabs
            value={tabValue}
            onChange={(e, newValue) => {
              setPage(0);
              setTabValue(newValue);
            }}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              mb: 2,
              minHeight: 44,
              borderBottom: 1,
              borderColor: 'divider',
              '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontWeight: 600, fontSize: '0.875rem' }
            }}
          >
            {PRE_AUDIT_TAB_LABELS.map((label, idx) => {
              const key = PRE_AUDIT_TAB_STATUS_KEYS[idx];
              const count = tabCounts[key];
              return (
                <Tab
                  key={key}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>{label}</span>
                      {count != null && (
                        <Badge
                          badgeContent={count > 99 ? '99+' : count}
                          color={tabValue === idx ? 'primary' : 'default'}
                          sx={{
                            '& .MuiBadge-badge': {
                              position: 'static',
                              transform: 'none',
                              fontSize: '0.7rem',
                              height: 20,
                              minWidth: 20,
                              borderRadius: 10,
                              fontWeight: 700
                            }
                          }}
                        />
                      )}
                    </Box>
                  }
                />
              );
            })}
          </Tabs>

          {tabValue === 2 && (
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                startIcon={<StoreIcon />}
                onClick={() => setStoreCatalogOpen(true)}
              >
                View Centralized Store Items
              </Button>
              <Button
                variant="outlined"
                startIcon={<VendorIcon />}
                onClick={() => setVendorsCatalogOpen(true)}
              >
                View Vendors &amp; Bills
              </Button>
            </Box>
          )}

          {loading ? (
            <Box>
              <Skeleton variant="rectangular" height={200} sx={{ mb: 2 }} />
              <Skeleton variant="rectangular" height={200} />
            </Box>
          ) : documents.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <DescriptionIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1.5 }} />
              <Typography variant="subtitle1" fontWeight={600} color="text.secondary">
                No documents in this queue
              </Typography>
              <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
                Try another tab or clear filters
              </Typography>
            </Box>
          ) : (() => {
            // Group documents by department, then month + year
            const groupedData = documents.reduce((acc, doc) => {
              const dept = doc.sourceDepartmentName || 'Other';
              const date = new Date(doc.documentDate || doc.createdAt || doc.date);
              const year = date.getFullYear();
              const month = date.toLocaleString('default', { month: 'long' }); // e.g., "January"
              const monthNum = date.getMonth(); // 0-11 for sorting
              const monthYearKey = `${month} ${year}`; // e.g., "December 2025"
              const sortKey = `${year}-${String(monthNum).padStart(2, '0')}`; // For sorting: "2025-11"
              
              if (!acc[dept]) {
                acc[dept] = {};
              }
              if (!acc[dept][monthYearKey]) {
                acc[dept][monthYearKey] = { sortKey, documents: [] };
              }
              acc[dept][monthYearKey].documents.push(doc);
              return acc;
            }, {});

            return (
              <Box>
                {Object.entries(groupedData).map(([department, monthYears]) => {
                  const totalDocuments = Object.values(monthYears).reduce((sum, m) => sum + m.documents.length, 0);

                  return (
                    <Accordion
                      key={department}
                      defaultExpanded
                      sx={{
                        mb: 1.5,
                        borderRadius: '8px !important',
                        border: '1px solid',
                        borderColor: 'divider',
                        boxShadow: 'none',
                        '&:before': { display: 'none' },
                        overflow: 'hidden'
                      }}
                    >
                      <AccordionSummary
                        expandIcon={<ExpandMoreIcon />}
                        sx={{
                          backgroundColor: alpha(theme.palette.primary.main, 0.04),
                          minHeight: 48,
                          '&:hover': {
                            backgroundColor: alpha(theme.palette.primary.main, 0.07)
                          }
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', pr: 1 }}>
                          <BusinessIcon color="primary" fontSize="small" />
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {department}
                          </Typography>
                          <Chip
                            label={totalDocuments}
                            size="small"
                            color="primary"
                            sx={{ ml: 'auto', height: 22, fontWeight: 700 }}
                          />
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails sx={{ p: 0 }}>
                        <Box>
                          {Object.entries(monthYears)
                            .sort(([, a], [, b]) => b.sortKey.localeCompare(a.sortKey)) // Sort by year-month descending (newest first)
                            .map(([monthYear, { documents: monthDocuments }]) => (
                              <Accordion
                                key={`${department}-${monthYear}`}
                                defaultExpanded
                                sx={{ mb: 0.5, boxShadow: 'none', border: 'none', '&:before': { display: 'none' } }}
                              >
                                <AccordionSummary
                                  expandIcon={<ExpandMoreIcon />}
                                  sx={{
                                    backgroundColor: 'grey.50',
                                    minHeight: 40,
                                    '& .MuiAccordionSummary-content': { my: 0.5 },
                                    pl: 3
                                  }}
                                >
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', pr: 1 }}>
                                    <ScheduleIcon color="action" fontSize="small" />
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {monthYear}
                                    </Typography>
                                    <Chip
                                      label={monthDocuments.length}
                                      size="small"
                                      variant="outlined"
                                      sx={{ ml: 'auto', height: 20, fontSize: '0.7rem' }}
                                    />
                                  </Box>
                                </AccordionSummary>
                                <AccordionDetails sx={{ p: 0 }}>
                                  <TableContainer>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow sx={{ background: alpha(theme.palette.grey[500], 0.06) }}>
                                          <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Document #</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Title</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Module</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }} align="right">Amount</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }} align="right">Prev. Month</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Age</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Priority</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {monthDocuments.map((doc) => {
                                          const amt = getDocumentAmount(doc);
                                          const daysWaiting = getDaysWaiting(doc);
                                          const priorityBorder =
                                            doc.priority === 'urgent'
                                              ? theme.palette.error.main
                                              : doc.priority === 'high'
                                                ? theme.palette.warning.main
                                                : 'transparent';
                                          return (
                                          <TableRow
                                            key={doc._id}
                                            hover
                                            sx={{
                                              borderLeft: `3px solid ${priorityBorder}`,
                                              '& td': { py: 1 }
                                            }}
                                          >
                                            <TableCell>
                                              <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8rem' }}>
                                                {doc.documentNumber}
                                              </Typography>
                                            </TableCell>
                                            <TableCell sx={{ maxWidth: 320 }}>
                                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                                <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>
                                                  {doc.isCashApproval
                                                    ? `${isCashApprovalBillDoc(doc) ? 'Cash Approval Bill' : 'Cash Approval'}: ${doc.documentNumber || doc?.originalDocument?.caNumber || doc.title || '—'}`
                                                    : doc.title}
                                                </Typography>
                                                {doc.isWorkflowDocument && !doc.isPostGrnAudit && (
                                                  <Chip label="Workflow" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                                                )}
                                                {doc.isPostGrnAudit && (
                                                  <Chip label="Post-GRN" size="small" color="warning" variant="filled" sx={{ height: 20, fontSize: '0.65rem' }} />
                                                )}
                                                {doc.isCashApproval && (
                                                  <Chip
                                                    label={isCashApprovalBillDoc(doc) ? 'CA Bill' : 'Cash Approval'}
                                                    size="small"
                                                    color="success"
                                                    variant="outlined"
                                                    sx={{ height: 20, fontSize: '0.65rem' }}
                                                  />
                                                )}
                                                {doc.isVendorBill && (
                                                  <Chip label="Vendor Bill" size="small" color="secondary" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                                                )}
                                              </Box>
                                              {doc.description && (
                                                <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 280, display: 'block' }}>
                                                  {doc.description}
                                                </Typography>
                                              )}
                                              {doc.isWorkflowDocument && (() => {
                                                const sendNote = getLatestSendToAuditWorkflowComment(doc.workflowHistory);
                                                if (!sendNote) return null;
                                                return (
                                                  <Typography
                                                    variant="caption"
                                                    component="div"
                                                    color="info.dark"
                                                    sx={{
                                                      mt: 0.5,
                                                      maxWidth: 400,
                                                      whiteSpace: 'normal',
                                                      lineHeight: 1.4,
                                                      wordBreak: 'break-word'
                                                    }}
                                                  >
                                                    <Box component="span" sx={{ fontWeight: 700 }}>Submission note: </Box>
                                                    {sendNote}
                                                  </Typography>
                                                );
                                              })()}
                                            </TableCell>
                                            <TableCell>
                                              <Chip
                                                label={doc.sourceModule}
                                                size="small"
                                                variant="outlined"
                                                sx={{ height: 22, textTransform: 'capitalize', fontSize: '0.7rem' }}
                                              />
                                            </TableCell>
                                            <TableCell>
                                              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                                                {doc.documentType || '—'}
                                              </Typography>
                                            </TableCell>
                                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                              <Typography variant="body2">{formatDate(doc.documentDate)}</Typography>
                                            </TableCell>
                                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                              <Typography variant="body2" fontWeight={700}>
                                                {(amt !== undefined && amt !== null) ? formatPKR(amt) : '—'}
                                              </Typography>
                                            </TableCell>
                                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                              {(() => {
                                                const lastMonthAmt = doc.lastMonthAmount ?? doc.originalDocument?.lastMonthAmount;
                                                return (
                                                  <Typography variant="body2" color="text.secondary">
                                                    {(lastMonthAmt !== undefined && lastMonthAmt !== null) ? formatPKR(lastMonthAmt) : '—'}
                                                  </Typography>
                                                );
                                              })()}
                                            </TableCell>
                                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                              {daysWaiting != null ? (
                                                <Chip
                                                  size="small"
                                                  label={daysWaiting === 0 ? 'Today' : `${daysWaiting}d`}
                                                  color={daysWaiting >= 7 ? 'warning' : 'default'}
                                                  variant={daysWaiting >= 7 ? 'filled' : 'outlined'}
                                                  sx={{ height: 22, fontWeight: 600, fontSize: '0.7rem' }}
                                                />
                                              ) : '—'}
                                            </TableCell>
                                            <TableCell>
                                              <Chip
                                                label={doc.priority}
                                                size="small"
                                                color={getPriorityColor(doc.priority)}
                                                sx={{ height: 22, textTransform: 'capitalize', fontSize: '0.7rem', fontWeight: 600 }}
                                              />
                                            </TableCell>
                                            <TableCell>
                                              <Chip
                                                label={doc.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                                size="small"
                                                color={getStatusColor(doc.status)}
                                                sx={{ height: 22, fontSize: '0.68rem', fontWeight: 600 }}
                                              />
                                            </TableCell>
                                            <TableCell align="right">
                                              <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                                                <Tooltip title="View Details">
                                                  <IconButton
                                                    size="small"
                                                    onClick={async () => {
                                                      setViewDialog({ open: true, document: doc, fullDocument: null, loading: true });
                                                      
                                                      // If it's a Purchase Order, fetch full PO and related Comparative Statement data (quotations by indent)
                                                      if (doc.isPurchaseOrder) {
                                                        try {
                                                          const response = await api.get(`/procurement/purchase-orders/${doc._id}`);
                                                          let quotations = [];
                                                          let grns = [];
                                                          const poData = response.data.success ? response.data.data : null;
                                                          if (poData?.indent?._id) {
                                                            try {
                                                              const qRes = await api.get(`/procurement/quotations/by-indent/${poData.indent._id}`);
                                                              if (qRes.data?.success && Array.isArray(qRes.data.data)) {
                                                                quotations = qRes.data.data;
                                                              }
                                                            } catch (_) { /* ignore */ }
                                                          }
                                                          // Fetch GRNs linked to this PO
                                                          try {
                                                            const grnRes = await api.get('/procurement/goods-receive', { params: { purchaseOrder: doc._id, limit: 100 } });
                                                            if (grnRes.data?.success && Array.isArray(grnRes.data.data?.receives)) {
                                                              grns = grnRes.data.data.receives;
                                                            } else if (grnRes.data?.success && Array.isArray(grnRes.data.data)) {
                                                              grns = grnRes.data.data;
                                                            }
                                                          } catch (_) { /* ignore */ }
                                                          setViewDialog({ 
                                                            open: true, 
                                                            document: { ...doc, isPurchaseOrder: true }, 
                                                            fullDocument: poData,
                                                            loading: false,
                                                            quotations,
                                                            grns,
                                                            poAuditTab: 0
                                                          });
                                                        } catch (error) {
                                                          console.error('Error fetching purchase order:', error);
                                                          setViewDialog({ open: true, document: { ...doc, isPurchaseOrder: true }, fullDocument: null, loading: false, quotations: [], grns: [], poAuditTab: 0 });
                                                        }
                                                      } else if (doc.isCashApproval) {
                                                        try {
                                                          const response = await api.get(`/cash-approvals/${doc._id}`);
                                                          const caData = response.data?.success ? response.data.data : null;
                                                          let quotations = [];
                                                          const linkedDocuments = [];
                                                          const pushDocs = (items = [], source = 'Attachment') => {
                                                            items.forEach((item, idx) => {
                                                              const url = item?.url || '';
                                                              const name = item?.originalName || item?.filename || `Document ${idx + 1}`;
                                                              if (!name && !url) return;
                                                              linkedDocuments.push({
                                                                id: item?._id || `${source}-${idx}`,
                                                                source,
                                                                name,
                                                                url,
                                                                uploadedAt: item?.uploadedAt || null,
                                                                mimeType: item?.mimeType || ''
                                                              });
                                                            });
                                                          };
                                                          if (caData?.indent?._id) {
                                                            try {
                                                              const qRes = await api.get(`/procurement/quotations/by-indent/${caData.indent._id}`);
                                                              if (qRes.data?.success && Array.isArray(qRes.data.data)) {
                                                                quotations = qRes.data.data;
                                                              }
                                                            } catch (_) { /* ignore */ }
                                                          }
                                                          pushDocs(caData?.attachments, 'General Attachment');
                                                          pushDocs(caData?.purchaseReceipts, 'Purchase Receipt');
                                                          pushDocs(caData?.receiptAttachments, 'Settlement Receipt');
                                                          setViewDialog({
                                                            open: true,
                                                            document: { ...doc, isCashApproval: true },
                                                            fullDocument: caData,
                                                            loading: false,
                                                            quotations,
                                                            caLinkedDocs: linkedDocuments,
                                                            grns: [],
                                                            poAuditTab: 0
                                                          });
                                                        } catch (error) {
                                                          console.error('Error fetching cash approval:', error);
                                                          setViewDialog({ open: true, document: { ...doc, isCashApproval: true }, fullDocument: null, loading: false, quotations: [], grns: [], caLinkedDocs: [], poAuditTab: 0 });
                                                        }
                                                      }
                                                      // Utility Bills should show the same memo/detail view used in Utility Bills Management.
                                                      else if (doc.isWorkflowDocument && doc.workflowSubmodule === 'utility_bills_management') {
                                                        try {
                                                          const response = await api.get(`/pre-audit/${doc._id}`);
                                                          const utilityBillData = response.data?.data?.originalDocument || doc.originalDocument || null;
                                                          setViewDialog({
                                                            open: true,
                                                            document: doc,
                                                            fullDocument: utilityBillData,
                                                            loading: false
                                                          });
                                                        } catch (error) {
                                                          console.error('Error fetching utility bill:', error);
                                                          setViewDialog({
                                                            open: true,
                                                            document: doc,
                                                            fullDocument: doc.originalDocument || null,
                                                            loading: false
                                                          });
                                                        }
                                                      }
                                                      // Payment Settlement: open dedicated settlement memo/detail view
                                                      else if (doc.isWorkflowDocument && doc.workflowSubmodule === 'payment_settlement') {
                                                        try {
                                                          const response = await paymentSettlementService.getPaymentSettlement(doc._id);
                                                          const settlementData = response.data?.data || response.data;
                                                          setViewDialog({
                                                            open: true,
                                                            document: doc,
                                                            fullDocument: settlementData,
                                                            loading: false
                                                          });
                                                        } catch (error) {
                                                          console.error('Error fetching payment settlement:', error);
                                                          setViewDialog({
                                                            open: true,
                                                            document: doc,
                                                            fullDocument: doc.originalDocument || null,
                                                            loading: false
                                                          });
                                                        }
                                                      }
                                                      // Rental Management: open dedicated rental memo/detail view
                                                      else if (doc.isWorkflowDocument && doc.workflowSubmodule === 'rental_management') {
                                                        try {
                                                          const response = await api.get(`/rental-management/${doc._id}`);
                                                          const rentalData = response.data;
                                                          setViewDialog({
                                                            open: true,
                                                            document: doc,
                                                            fullDocument: rentalData,
                                                            loading: false
                                                          });
                                                        } catch (error) {
                                                          console.error('Error fetching rental management:', error);
                                                          setViewDialog({
                                                            open: true,
                                                            document: doc,
                                                            fullDocument: doc.originalDocument || null,
                                                            loading: false
                                                          });
                                                        }
                                                      } else {
                                                        // Check if doc has originalDocument with isPurchaseOrder flag
                                                        if (doc.originalDocument?.isPurchaseOrder || doc.originalDocument?.orderNumber) {
                                                          setViewDialog({ 
                                                            open: true, 
                                                            document: { ...doc, isPurchaseOrder: true }, 
                                                            fullDocument: doc.originalDocument || null, 
                                                            loading: false 
                                                          });
                                                        } else if (doc.isVendorBill) {
                                                          try {
                                                            const response = await api.get(`/pre-audit/finance-vendors/bills/${doc._id}`);
                                                            const billData = response.data?.success ? response.data.data : doc.originalDocument;
                                                            setViewDialog({
                                                              open: true,
                                                              document: { ...doc, isVendorBill: true },
                                                              fullDocument: billData,
                                                              quotations: billData?.poDetail?.quotations || [],
                                                              grns: billData?.poDetail?.grns || [],
                                                              loading: false
                                                            });
                                                          } catch (error) {
                                                            console.error('Error fetching vendor bill:', error);
                                                            setViewDialog({
                                                              open: true,
                                                              document: { ...doc, isVendorBill: true },
                                                              fullDocument: doc.originalDocument || null,
                                                              quotations: [],
                                                              grns: [],
                                                              loading: false
                                                            });
                                                          }
                                                        } else {
                                                          setViewDialog({ open: true, document: doc, fullDocument: null, loading: false });
                                                        }
                                                      }
                                                    }}
                                                  >
                                                    <ViewIcon fontSize="small" />
                                                  </IconButton>
                                                </Tooltip>
                                                {/* Action buttons based on status and user role */}
                                                {doc.status === 'pending' || doc.status === 'under_review' ? (
                                                  <>
                                                    {/* Post-GRN audit POs: Show "Send to Finance" instead of standard audit actions */}
                                                    {doc.isPostGrnAudit ? (
                                                      canPerformInitialPreAuditActions(user) && (
                                                        <Tooltip title="Send to Finance">
                                                          <IconButton
                                                            size="small"
                                                            color="success"
                                                            onClick={() => handleSendToFinanceFromAudit(doc)}
                                                          >
                                                            <SendIcon fontSize="small" />
                                                          </IconButton>
                                                        </Tooltip>
                                                      )
                                                    ) : (
                                                      <>
                                                        {/* Audit staff: forward to Audit Director (director approves after forward) */}
                                                        {isAuditReviewerUser() && (
                                                          <Tooltip title={hasInitialApproval(doc) ? 'Forward to Audit Director' : 'Initial approval required first'}>
                                                            <IconButton
                                                              size="small"
                                                              color="primary"
                                                              onClick={() => setForwardDialog({ open: true, document: doc })}
                                                              disabled={!hasInitialApproval(doc)}
                                                            >
                                                              <SendIcon fontSize="small" />
                                                            </IconButton>
                                                          </Tooltip>
                                                        )}
                                                        {/* Initial approval by assistant/auditor (or super admin) */}
                                                        {isAuditReviewerUser() && (
                                                          <Tooltip title={hasInitialApproval(doc) ? 'Initial approval already recorded' : 'Initial Approve'}>
                                                            <IconButton
                                                              size="small"
                                                              color="success"
                                                              onClick={() => setApproveDialog({ open: true, document: doc })}
                                                              disabled={hasInitialApproval(doc)}
                                                            >
                                                              <CheckCircleIcon fontSize="small" />
                                                            </IconButton>
                                                          </Tooltip>
                                                        )}
                                                        <Tooltip title="Add Observation">
                                                          <IconButton
                                                            size="small"
                                                            color="info"
                                                            onClick={() => setObservationDialog({ open: true, document: doc })}
                                                          >
                                                            <CommentIcon fontSize="small" />
                                                          </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title="Reject with Observation">
                                                          <IconButton
                                                            size="small"
                                                            color="error"
                                                            onClick={() => setRejectDialog({ open: true, document: doc })}
                                                          >
                                                            <CancelIcon fontSize="small" />
                                                          </IconButton>
                                                        </Tooltip>
                                                        {doc.observations && doc.observations.length > 0 && (
                                                          <Tooltip title="Return to Department">
                                                            <IconButton
                                                              size="small"
                                                              color="warning"
                                                              onClick={() => setReturnDialog({ open: true, document: doc })}
                                                            >
                                                              <SendIcon fontSize="small" />
                                                            </IconButton>
                                                          </Tooltip>
                                                        )}
                                                      </>
                                                    )}
                                                  </>
                                                ) : (doc.status === 'forwarded_to_director' || doc.workflowStatus === 'Forwarded to Audit Director') ? (
                                                  <>
                                                    {/* Audit Director: final approval after forwarding */}
                                                    {isAuditDirectorUser() && (
                                                      <>
                                                        <Tooltip title="Final Approve">
                                                          <IconButton
                                                            size="small"
                                                            color="success"
                                                            onClick={() => setApproveDialog({ open: true, document: doc })}
                                                          >
                                                            <CheckCircleIcon fontSize="small" />
                                                          </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title="Reject with Observation">
                                                          <IconButton
                                                            size="small"
                                                            color="error"
                                                            onClick={() => setRejectDialog({ open: true, document: doc })}
                                                          >
                                                            <CancelIcon fontSize="small" />
                                                          </IconButton>
                                                        </Tooltip>
                                                      </>
                                                    )}
                                                  </>
                                                ) : null}
                                              </Stack>
                                            </TableCell>
                                          </TableRow>
                                          );
                                        })}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </AccordionDetails>
                              </Accordion>
                            ))}
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  );
                })}
              </Box>
            );
          })()}

          <TablePagination
            component="div"
            count={totalCount}
            page={page}
            onPageChange={(e, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 20, 50, 100]}
          />
        </CardContent>
      </Card>

      {/* View Document Dialog */}
      <Dialog
        open={viewDialog.open}
        onClose={() => setViewDialog({ open: false, document: null, fullDocument: null, loading: false, quotations: [], grns: [], caLinkedDocs: [], poAuditTab: 0 })}
        maxWidth={(viewDialog.document?.isPurchaseOrder || viewDialog.document?.isCashApproval || (viewDialog.document?.isWorkflowDocument && (viewDialog.fullDocument?.isPurchaseOrder || viewDialog.document?.workflowSubmodule === 'utility_bills_management' || viewDialog.document?.workflowSubmodule === 'payment_settlement' || viewDialog.document?.workflowSubmodule === 'rental_management'))) ? false : "md"}
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 0,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            background: '#ffffff',
            ...((viewDialog.document?.isPurchaseOrder || viewDialog.document?.isCashApproval || (viewDialog.document?.isWorkflowDocument && (viewDialog.fullDocument?.isPurchaseOrder || viewDialog.document?.workflowSubmodule === 'utility_bills_management' || viewDialog.document?.workflowSubmodule === 'payment_settlement' || viewDialog.document?.workflowSubmodule === 'rental_management'))) && {
              width: '90%',
              maxWidth: '210mm',
              maxHeight: '95vh',
              '@media print': {
                boxShadow: 'none',
                maxWidth: '100%',
                margin: 0,
                height: '100%',
                width: '100%',
                maxHeight: '100%'
              }
            })
          }
        }}
      >
        <DialogTitle sx={{ 
          p: 0,
          m: 0,
          '@media print': { display: (viewDialog.document?.isPurchaseOrder || viewDialog.document?.isCashApproval || (viewDialog.document?.isWorkflowDocument && (viewDialog.fullDocument?.isPurchaseOrder || viewDialog.document?.workflowSubmodule === 'utility_bills_management' || viewDialog.document?.workflowSubmodule === 'payment_settlement' || viewDialog.document?.workflowSubmodule === 'rental_management'))) ? 'none' : 'block' }
        }}>
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            p: 2,
            borderBottom: '1px solid #e0e0e0'
          }}>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#333' }}>
              {viewDialog.document?.isVendorBill
                ? 'Vendor Bill & Supporting Documents'
                : viewDialog.document?.isCashApproval
                  ? `${isCashApprovalBillDoc(viewDialog.document) ? 'Cash Approval Bill' : 'Cash Approval'} Details`
                  : (viewDialog.document?.isPurchaseOrder || (viewDialog.document?.isWorkflowDocument && viewDialog.fullDocument?.isPurchaseOrder))
                    ? 'Purchase Order Details'
                    : viewDialog.document?.workflowSubmodule === 'utility_bills_management'
                      ? (viewDialog.fullDocument?.utilityType?.toUpperCase() || 'UTILITY BILL')
                      : viewDialog.document?.workflowSubmodule === 'rental_management'
                        ? 'RENTAL MANAGEMENT'
                        : 'PAYMENT SETTLEMENT'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {(viewDialog.document?.isPurchaseOrder || viewDialog.document?.isCashApproval || (viewDialog.document?.isWorkflowDocument && (viewDialog.fullDocument?.isPurchaseOrder || viewDialog.document?.workflowSubmodule === 'utility_bills_management' || viewDialog.document?.workflowSubmodule === 'payment_settlement' || viewDialog.document?.workflowSubmodule === 'rental_management'))) && (
                <Button
                  variant="contained"
                  startIcon={<PrintIcon />}
                  onClick={() => printPoFitToOneA4()}
                  size="small"
                  sx={{ '@media print': { display: 'none' } }}
                >
                  Print
                </Button>
              )}
              <IconButton 
                size="small" 
                onClick={() => setViewDialog({ open: false, document: null, fullDocument: null, loading: false, quotations: [], grns: [], caLinkedDocs: [], poAuditTab: 0 })}
                sx={{ color: '#666', '@media print': { display: 'none' } }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
          {viewDialog.document && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1.25,
                background: alpha(theme.palette.primary.main, 0.04),
                borderBottom: '1px solid',
                borderColor: 'divider',
                '@media print': { display: 'none' }
              }}
            >
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              >
                {viewDialog.document.documentNumber || viewDialog.fullDocument?.documentNumber || '—'}
              </Typography>
              {viewDialog.document.sourceModule && (
                <Chip
                  size="small"
                  label={viewDialog.document.sourceModule}
                  variant="outlined"
                  sx={{ height: 22, textTransform: 'capitalize', fontSize: '0.7rem' }}
                />
              )}
              {viewDialog.document.status && (
                <Chip
                  size="small"
                  label={String(viewDialog.document.status).replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  color={getStatusColor(viewDialog.document.status)}
                  sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                />
              )}
              {viewDialog.document.priority && (
                <Chip
                  size="small"
                  label={viewDialog.document.priority}
                  color={getPriorityColor(viewDialog.document.priority)}
                  sx={{ height: 22, textTransform: 'capitalize', fontSize: '0.7rem', fontWeight: 600 }}
                />
              )}
              <Typography variant="body2" sx={{ ml: 'auto', fontWeight: 700 }}>
                {(() => {
                  const amt = getDocumentAmount(viewDialog.document) ?? getDocumentAmount(viewDialog.fullDocument);
                  return amt != null ? formatPKR(amt) : '';
                })()}
              </Typography>
            </Box>
          )}
        </DialogTitle>
        <DialogContent sx={{ p: 0, background: '#ffffff', overflow: 'auto', '@media print': { p: 0, overflow: 'visible' } }}>
          {viewDialog.loading ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <CircularProgress />
              <Typography variant="body2" sx={{ mt: 2 }}>Loading document details...</Typography>
            </Box>
          ) : viewDialog.document && (
            <Box sx={{ 
              p: (viewDialog.document.isPurchaseOrder || viewDialog.document.isCashApproval || (viewDialog.document.isWorkflowDocument && (viewDialog.fullDocument?.isPurchaseOrder || viewDialog.document?.workflowSubmodule === 'utility_bills_management' || viewDialog.document?.workflowSubmodule === 'payment_settlement' || viewDialog.document?.workflowSubmodule === 'rental_management'))) ? 0 : 4,
              background: '#ffffff',
              fontFamily: (viewDialog.document.isPurchaseOrder || viewDialog.document.isCashApproval || (viewDialog.document.isWorkflowDocument && (viewDialog.fullDocument?.isPurchaseOrder || viewDialog.document?.workflowSubmodule === 'utility_bills_management' || viewDialog.document?.workflowSubmodule === 'payment_settlement' || viewDialog.document?.workflowSubmodule === 'rental_management'))) ? 'Arial, sans-serif' : '"Times New Roman", serif'
            }} className={(viewDialog.document.isPurchaseOrder || viewDialog.document.isCashApproval || (viewDialog.document.isWorkflowDocument && (viewDialog.fullDocument?.isPurchaseOrder || viewDialog.document?.workflowSubmodule === 'utility_bills_management' || viewDialog.document?.workflowSubmodule === 'payment_settlement' || viewDialog.document?.workflowSubmodule === 'rental_management'))) ? "print-content" : ""}>
              {/* Show Purchase Order + Comparative Statement + Quotations when it's a PO (for audit) */}
              {(viewDialog.document.isPurchaseOrder && viewDialog.fullDocument) ? (
                <>
                  <Tabs
                    value={viewDialog.poAuditTab ?? 0}
                    onChange={(_, v) => setViewDialog(prev => ({ ...prev, poAuditTab: v }))}
                    sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider', '@media print': { display: 'none' } }}
                    variant="scrollable"
                    scrollButtons="auto"
                  >
                    <Tab label="Indent" />
                    <Tab label="Purchase Order" />
                    <Tab label="Comparative Statement" />
                    <Tab label={`Quotations (${viewDialog.quotations?.length || 0})`} />
                    <Tab label={viewDialog.grns?.length > 0 ? `GRN(s) (${viewDialog.grns.length})` : 'GRN(s)'} />
                  </Tabs>

                  {/* Tab 0: Indent */}
                  {viewDialog.poAuditTab === 0 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {!viewDialog.fullDocument?.indent ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No indent linked to this Purchase Order.</Typography>
                      ) : (
                        <Paper sx={{ p: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="h5" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1 }}>
                            Purchase Request Form
                          </Typography>
                          {viewDialog.fullDocument.indent.title && (
                            <Typography variant="h6" fontWeight={600} align="center" sx={{ mb: 2 }}>{viewDialog.fullDocument.indent.title}</Typography>
                          )}
                          <Box sx={{ mb: 1.5, fontSize: '0.9rem', textAlign: 'center' }}>
                            <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                            <Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.indent.erpRef || 'PR #' + (viewDialog.fullDocument.indent.indentNumber?.split('-').pop() || '')}</Typography>
                          </Box>
                          <Box sx={{ mb: 1.5, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <Box><Typography component="span" fontWeight={600}>Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.fullDocument.indent.requestedDate)}</Typography></Box>
                            <Box><Typography component="span" fontWeight={600}>Required Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.fullDocument.indent.requiredDate) || '—'}</Typography></Box>
                            <Box><Typography component="span" fontWeight={600}>Indent No.:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.indent.indentNumber || '—'}</Typography></Box>
                          </Box>
                          <Box sx={{ mb: 3, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <Box><Typography component="span" fontWeight={600}>Department:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.indent.department?.name || viewDialog.fullDocument.indent.department || '—'}</Typography></Box>
                            <Box><Typography component="span" fontWeight={600}>Originator:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.indent.requestedBy?.firstName && viewDialog.fullDocument.indent.requestedBy?.lastName ? `${viewDialog.fullDocument.indent.requestedBy.firstName} ${viewDialog.fullDocument.indent.requestedBy.lastName}` : viewDialog.fullDocument.indent.requestedBy?.name || '—'}</Typography></Box>
                          </Box>
                          <Box sx={{ mb: 3 }}>
                            <Table size="small" sx={{ border: '1px solid', borderColor: 'divider' }}>
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.100' }}>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>S#</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Item Name</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Description</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Brand</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Unit</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="center">Qty</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Purpose</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="right">Est. Cost</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {(viewDialog.fullDocument.indent.items || []).map((item, idx) => (
                                  <TableRow key={idx}>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="center">{idx + 1}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.itemName || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.description || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.brand || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.unit || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="center">{item.quantity ?? '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.purpose || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{item.estimatedCost != null ? Number(item.estimatedCost).toFixed(2) : '—'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                          {viewDialog.fullDocument.indent.justification && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Justification:</Typography>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>{viewDialog.fullDocument.indent.justification}</Typography>
                            </Box>
                          )}
                          {renderIndentApprovalProgress(viewDialog.fullDocument.indent, {
                            title: 'Indent approval progress'
                          })}
                        </Paper>
                      )}
                    </Box>
                  )}

                  {/* Tab 1: Purchase Order */}
                  {viewDialog.poAuditTab === 1 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      <PurchaseOrderView 
                        poData={{
                          ...viewDialog.fullDocument,
                          auditObservations: viewDialog.fullDocument?.auditObservations || 
                                            viewDialog.document?.auditObservations || 
                                            viewDialog.document?.originalDocument?.auditObservations ||
                                            []
                        }} 
                      />
                    </Box>
                  )}

                  {/* Tab 2: Comparative Statement */}
                  {viewDialog.poAuditTab === 2 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      <ComparativeStatementView
                        requisition={viewDialog.fullDocument?.indent}
                        quotations={viewDialog.quotations || []}
                        approvalAuthority={viewDialog.fullDocument?.indent?.comparativeStatementApprovals || {}}
                        note={viewDialog.fullDocument?.indent?.notes ?? ''}
                        readOnly
                        formatNumber={formatNumber}
                        loadingQuotations={false}
                        showPrintButton={false}
                      />
                    </Box>
                  )}

                  {/* Tab 3: Quotations */}
                  {viewDialog.poAuditTab === 3 && (
                    <Box sx={{ p: 2 }}>
                      {(!viewDialog.quotations || viewDialog.quotations.length === 0) ? (
                        <Typography color="text.secondary">No quotations for this requisition.</Typography>
                      ) : (
                        <Stack spacing={4}>
                          {viewDialog.quotations.map((q) => (
                            <QuotationDetailView
                              key={q._id}
                              quotation={q}
                              formatNumber={formatNumber}
                              formatDateForPrint={formatDateForPrint}
                            />
                          ))}
                        </Stack>
                      )}
                    </Box>
                  )}

                  {/* Tab 4: GRN(s) */}
                  {viewDialog.poAuditTab === 4 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {(!viewDialog.grns || viewDialog.grns.length === 0) ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No GRN(s) attached to this Purchase Order.</Typography>
                      ) : (
                        viewDialog.grns.map((grn) => (
                          <Paper key={grn._id} sx={{ p: 4, mb: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="overline" color="textSecondary" sx={{ display: 'block', mb: 1 }}>Goods Received Note</Typography>
                            <Grid container sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', pb: 2 }} alignItems="center">
                              <Grid item xs={4}><Typography variant="h6" fontWeight="bold">SGC</Typography><Typography variant="body2" color="textSecondary">Head Office</Typography></Grid>
                              <Grid item xs={4} sx={{ textAlign: 'center' }}><Typography variant="h5" fontWeight="bold">Goods Received Note</Typography></Grid>
                              <Grid item xs={4} />
                            </Grid>
                            <Grid container spacing={3} sx={{ mb: 2 }}>
                              <Grid item xs={12} md={6}>
                                <Typography variant="caption" color="textSecondary">No.</Typography>
                                <Typography variant="body1" fontWeight="bold">{grn.receiveNumber || grn._id}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Supplier</Typography>
                                <Typography variant="body2">{[grn.supplier?.supplierId, grn.supplierName || grn.supplier?.name].filter(Boolean).join(' ') || '—'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Address</Typography>
                                <Typography variant="body2">{grn.supplierAddress || grn.supplier?.address || '—'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Narration</Typography>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{grn.narration || '—'}</Typography>
                              </Grid>
                              <Grid item xs={12} md={6}>
                                <Typography variant="caption" color="textSecondary">Date</Typography>
                                <Typography variant="body2">{formatDateForPrint(grn.receiveDate)}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Currency</Typography>
                                <Typography variant="body2">{grn.currency || 'Rupees'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>P.R No.</Typography>
                                <Typography variant="body2">{grn.prNumber || '—'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>P.O No.</Typography>
                                <Typography variant="body2">{grn.poNumber || viewDialog.fullDocument?.orderNumber || '—'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Store</Typography>
                                <Typography variant="body2">{grn.storeSnapshot || '—'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Gate Pass No.</Typography>
                                <Typography variant="body2">{grn.gatePassNo || '—'}</Typography>
                              </Grid>
                            </Grid>
                            <TableContainer sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                              <Table size="small">
                                <TableHead>
                                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                                    <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>S. No</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Product Code</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Description</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Unit</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="right">Quantity</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="right">Rate</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="right">Value Excl. ST</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {(grn.items || []).map((item, idx) => (
                                    <TableRow key={idx}>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{idx + 1}</TableCell>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.itemCode || '—'}</TableCell>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.itemName || '—'}</TableCell>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.unit || '—'}</TableCell>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatNumber(item.quantity)}</TableCell>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatNumber(item.unitPrice)}</TableCell>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatNumber(item.valueExcludingSalesTax ?? ((item.quantity || 0) * (item.unitPrice || 0)))}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                              <Grid container spacing={1} sx={{ maxWidth: 320 }}>
                                <Grid item xs={6}><Typography variant="body2">Discount</Typography></Grid>
                                <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2">{formatNumber(grn.discount)}</Typography></Grid>
                                <Grid item xs={6}><Typography variant="body2">Other Charges</Typography></Grid>
                                <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2">{formatNumber(grn.otherCharges)}</Typography></Grid>
                                <Grid item xs={6}><Typography variant="body2" fontWeight="bold">Net Amount</Typography></Grid>
                                <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2" fontWeight="bold">{formatNumber(grn.netAmount)}</Typography></Grid>
                                <Grid item xs={6}><Typography variant="body2" fontWeight="bold">Total</Typography></Grid>
                                <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2" fontWeight="bold">{formatNumber(grn.total ?? grn.netAmount)}</Typography></Grid>
                              </Grid>
                            </Box>
                            <Divider sx={{ my: 2 }} />
                            <Typography variant="caption" color="textSecondary">Observation</Typography>
                            <Typography variant="body2" sx={{ minHeight: 24 }}>{grn.observation || ' '}</Typography>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mt: 3 }}>
                              <Box>
                                <Typography variant="caption" color="textSecondary">Prepared By</Typography>
                                <Typography variant="body2" fontWeight="medium">{grn.preparedByName || (grn.receivedBy?.firstName && grn.receivedBy?.lastName ? `${grn.receivedBy.firstName} ${grn.receivedBy.lastName}` : '—')}</Typography>
                              </Box>
                              <Box sx={{ width: 120, height: 40, border: '2px dashed', borderColor: 'divider' }} />
                            </Box>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}
                </>
              ) : (viewDialog.document.isVendorBill && viewDialog.fullDocument) ? (
                <>
                  <Tabs
                    value={viewDialog.poAuditTab ?? 0}
                    onChange={(_, v) => setViewDialog(prev => ({ ...prev, poAuditTab: v }))}
                    sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider', '@media print': { display: 'none' } }}
                    variant="scrollable"
                    scrollButtons="auto"
                  >
                    <Tab label="Vendor Bill" />
                    <Tab label={viewDialog.fullDocument?.poDetail?.po ? 'Purchase Order' : 'PO'} />
                    <Tab label={viewDialog.fullDocument?.poDetail?.indent ? 'Indent' : 'Indent'} />
                    <Tab label="Comparative Statement" />
                    <Tab label={`Quotations (${viewDialog.fullDocument?.poDetail?.quotations?.length || viewDialog.quotations?.length || 0})`} />
                    <Tab label={(viewDialog.fullDocument?.poDetail?.grns?.length || viewDialog.grns?.length) > 0 ? `GRN(s) (${viewDialog.fullDocument?.poDetail?.grns?.length || viewDialog.grns?.length})` : 'GRN(s)'} />
                  </Tabs>

                  {/* Tab 0: Vendor Bill Details */}
                  {(viewDialog.poAuditTab ?? 0) === 0 && (
                    <Box sx={{ p: 3 }}>
                      <CentralizedStoreBillInvoiceBody
                        bill={{
                          ...viewDialog.fullDocument,
                          billId: viewDialog.fullDocument.billNumber,
                          billDate: viewDialog.fullDocument.billDate,
                          createdAt: viewDialog.fullDocument.createdAt || viewDialog.fullDocument.billDate,
                          provider: viewDialog.fullDocument.vendorName || viewDialog.fullDocument.vendor?.name,
                          location: viewDialog.fullDocument.vendor?.address?.city || viewDialog.fullDocument.department || 'N/A',
                          notes: viewDialog.fullDocument.notes || viewDialog.fullDocument.internalNotes,
                          billLines: (viewDialog.fullDocument.lineItems || []).map((line, idx) => ({
                            ...line,
                            itemName: line.description,
                            itemCode: line.itemCode || 'N/A',
                            amount: line.amount || (line.quantity * line.unitPrice)
                          }))
                        }}
                        showChargesSummary={true}
                      />

                      {/* Approval Authority Table */}
                      <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 4, mb: 1, color: '#333' }}>
                        Approval Authorities
                      </Typography>
                      {(() => {
                        const bill = viewDialog.fullDocument;
                        const chain = bill?.approvalChain || [];
                        const workflowHistory = bill?.workflowHistory || [];
                        const normalize = (value) => String(value || '').trim().toLowerCase();
                        const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
                        
                        const findLatestAuditEntry = (keywords = []) => history.find((entry) => {
                          const toStatus = normalize(entry?.toStatus);
                          const fromStatus = normalize(entry?.fromStatus);
                          return keywords.some((keyword) => toStatus.includes(keyword) || fromStatus.includes(keyword));
                        });
                        const findLatestByToStatus = (accepted = []) => history.find((entry) => {
                          const toStatus = normalize(entry?.toStatus);
                          return accepted.some((status) => (
                            toStatus === status || toStatus.startsWith(status)
                          ));
                        });

                        const preAuditActorEntry = findLatestByToStatus([
                          'forwarded to audit director',
                          'initial audit approval'
                        ]) || findLatestAuditEntry([
                          'forwarded to audit director',
                          'initial audit approval'
                        ]);
                        const directorApproval = findLatestByToStatus([
                          'approved (from forwarded to audit director)',
                          'approved (from send to audit)'
                        ]) || findLatestAuditEntry([
                          'approved (from forwarded to audit director)',
                          'approved (from send to audit)'
                        ]);

                        const rows = [
                          {
                            authority: 'Sig of Requester',
                            name: userDisplayName(bill?.createdBy),
                            signatureUser: bill?.createdBy,
                            dateTime: bill?.createdAt ? formatDateTime(bill.createdAt) : '-'
                          },
                          {
                            authority: 'Pre-Audit Authority',
                            name: userDisplayName(preAuditActorEntry?.changedBy),
                            signatureUser: preAuditActorEntry?.changedBy || null,
                            dateTime: preAuditActorEntry?.changedAt ? formatDateTime(preAuditActorEntry.changedAt) : '-'
                          },
                          {
                            authority: 'Audit Director',
                            name: userDisplayName(directorApproval?.changedBy),
                            signatureUser: directorApproval?.changedBy || null,
                            signaturePath: directorApproval?.stampUsed && directorApproval?.stampImage
                              ? directorApproval.stampImage
                              : directorApproval?.changedBy?.digitalSignature || '',
                            dateTime: directorApproval?.changedAt ? formatDateTime(directorApproval.changedAt) : '-'
                          }
                        ];

                        const getSignatureSource = (row) => row?.signaturePath || row?.signatureUser?.digitalSignature || '';

                        return (
                          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.100' }}>
                                  <TableCell sx={{ fontWeight: 800 }}>Authority</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Name</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Digital Signature</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Date &amp; Time</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {rows.map((row) => (
                                  <TableRow key={row.authority}>
                                    <TableCell sx={{ fontWeight: 800 }}>{row.authority}</TableCell>
                                    <TableCell>{row.name || '-'}</TableCell>
                                    <TableCell>
                                      {getSignatureSource(row) ? (
                                        <DigitalSignatureImage userOrPath={getSignatureSource(row)} alt={`${row.authority} signature`} />
                                      ) : (
                                        '-'
                                      )}
                                    </TableCell>
                                    <TableCell>{row.dateTime || '-'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        );
                      })()}
                    </Box>
                  )}

                  {/* Tab 1: Purchase Order */}
                  {viewDialog.poAuditTab === 1 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {!viewDialog.fullDocument?.poDetail?.po ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Purchase Order linked to this Vendor Bill.</Typography>
                      ) : (
                        <PurchaseOrderView poData={viewDialog.fullDocument.poDetail.po} />
                      )}
                    </Box>
                  )}

                  {/* Tab 2: Indent */}
                  {viewDialog.poAuditTab === 2 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {!viewDialog.fullDocument?.poDetail?.indent ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Indent linked to this Vendor Bill.</Typography>
                      ) : (
                        <Paper sx={{ p: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="h5" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1 }}>
                            Purchase Request Form
                          </Typography>
                          <Typography variant="subtitle2" align="center" color="text.secondary" sx={{ mb: 3 }}>
                            Requisition #{viewDialog.fullDocument.poDetail.indent.indentNumber || '—'}
                          </Typography>
                          <Grid container spacing={2} sx={{ mb: 3 }}>
                            <Grid item xs={6}><Typography variant="caption" color="text.secondary" display="block">Title</Typography><Typography variant="body2">{viewDialog.fullDocument.poDetail.indent.title || '—'}</Typography></Grid>
                            <Grid item xs={6}><Typography variant="caption" color="text.secondary" display="block">Department</Typography><Typography variant="body2">{viewDialog.fullDocument.poDetail.indent.department?.name || '—'}</Typography></Grid>
                            <Grid item xs={6}><Typography variant="caption" color="text.secondary" display="block">Requested By</Typography><Typography variant="body2">{[viewDialog.fullDocument.poDetail.indent.requestedBy?.firstName, viewDialog.fullDocument.poDetail.indent.requestedBy?.lastName].filter(Boolean).join(' ') || '—'}</Typography></Grid>
                            <Grid item xs={6}><Typography variant="caption" color="text.secondary" display="block">Required Date</Typography><Typography variant="body2">{formatDate(viewDialog.fullDocument.poDetail.indent.requiredDate)}</Typography></Grid>
                          </Grid>
                          {viewDialog.fullDocument.poDetail.indent.justification && (
                            <Box sx={{ mb: 3 }}>
                              <Typography variant="subtitle2" fontWeight={600} mb={0.5}>Justification</Typography>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>{viewDialog.fullDocument.poDetail.indent.justification}</Typography>
                            </Box>
                          )}
                          {renderIndentApprovalProgress(viewDialog.fullDocument.poDetail.indent, { title: 'Indent approval progress' })}
                        </Paper>
                      )}
                    </Box>
                  )}

                  {/* Tab 3: Comparative Statement */}
                  {viewDialog.poAuditTab === 3 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {!viewDialog.fullDocument?.poDetail?.indent ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Comparative Statement available.</Typography>
                      ) : (
                        <ComparativeStatementView
                          requisition={viewDialog.fullDocument.poDetail.indent}
                          quotations={viewDialog.fullDocument.poDetail.quotations || viewDialog.quotations || []}
                          approvalAuthority={viewDialog.fullDocument.poDetail.indent?.comparativeStatementApprovals || {}}
                          note={viewDialog.fullDocument.poDetail.indent?.notes ?? ''}
                          readOnly
                          formatNumber={formatNumber}
                          loadingQuotations={false}
                          showPrintButton={false}
                        />
                      )}
                    </Box>
                  )}

                  {/* Tab 4: Quotations */}
                  {viewDialog.poAuditTab === 4 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {!(viewDialog.fullDocument?.poDetail?.quotations?.length || viewDialog.quotations?.length) ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Quotations found.</Typography>
                      ) : (
                        (viewDialog.fullDocument?.poDetail?.quotations || viewDialog.quotations || []).map((q, idx) => (
                          <Paper key={q._id || idx} sx={{ p: 3, mb: 3, maxWidth: '210mm', mx: 'auto', border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
                              Quotation: {q.vendor?.name || 'Vendor'} {q.quotationNumber ? `(${q.quotationNumber})` : ''}
                            </Typography>
                            <Grid container spacing={2} sx={{ mb: 2 }}>
                              <Grid item xs={4}><Typography variant="caption" color="text.secondary" display="block">Quotation Date</Typography><Typography variant="body2">{formatDate(q.quotationDate)}</Typography></Grid>
                              <Grid item xs={4}><Typography variant="caption" color="text.secondary" display="block">Delivery Time</Typography><Typography variant="body2">{q.deliveryTime || '—'}</Typography></Grid>
                              <Grid item xs={4}><Typography variant="caption" color="text.secondary" display="block">Payment Terms</Typography><Typography variant="body2">{q.paymentTerms || '—'}</Typography></Grid>
                            </Grid>
                            <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                                    <TableCell sx={{ fontWeight: 'bold' }}>Description</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>Qty</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>Unit Price</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>Total</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {(q.items || []).map((item, i) => (
                                    <TableRow key={i}>
                                      <TableCell>{item.description}</TableCell>
                                      <TableCell align="right">{item.quantity} {item.unit}</TableCell>
                                      <TableCell align="right">{formatNumber(item.unitPrice)}</TableCell>
                                      <TableCell align="right">{formatNumber((item.quantity || 0) * (item.unitPrice || 0))}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}

                  {/* Tab 5: Goods Receive Notes (GRNs) */}
                  {viewDialog.poAuditTab === 5 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {!(viewDialog.fullDocument?.poDetail?.grns?.length || viewDialog.grns?.length) ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Goods Receive Notes linked.</Typography>
                      ) : (
                        (viewDialog.fullDocument?.poDetail?.grns || viewDialog.grns || []).map((grn, gIdx) => (
                          <Paper key={grn._id || gIdx} sx={{ p: 3, mb: 3, maxWidth: '210mm', mx: 'auto', border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="h6" fontWeight={700} align="center" sx={{ mb: 2 }}>
                              GOODS RECEIVE NOTE #{grn.receiveNumber || '—'}
                            </Typography>
                            <Grid container spacing={2} sx={{ mb: 2 }}>
                              <Grid item xs={6}><Typography variant="caption" color="text.secondary" display="block">Supplier</Typography><Typography variant="body2">{grn.supplierName || grn.supplier?.name || '—'}</Typography></Grid>
                              <Grid item xs={6}><Typography variant="caption" color="text.secondary" display="block">Receive Date</Typography><Typography variant="body2">{formatDate(grn.receiveDate)}</Typography></Grid>
                            </Grid>
                            <TableContainer sx={{ mb: 2 }}>
                              <Table size="small">
                                <TableHead>
                                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                                    <TableCell sx={{ fontWeight: 'bold' }}>Product Code</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>Description</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>Qty</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>Rate</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>Total Value</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {(grn.items || []).map((item, idx) => (
                                    <TableRow key={idx}>
                                      <TableCell>{item.itemCode || '—'}</TableCell>
                                      <TableCell>{item.itemName || '—'}</TableCell>
                                      <TableCell align="right">{formatNumber(item.quantity)} {item.unit || ''}</TableCell>
                                      <TableCell align="right">{formatNumber(item.unitPrice)}</TableCell>
                                      <TableCell align="right">{formatNumber((item.quantity || 0) * (item.unitPrice || 0))}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </Paper>
                        ))
                      )}
                    </Box>
                  )}
                </>
              ) : viewDialog.document.isWorkflowDocument && viewDialog.document.workflowSubmodule === 'utility_bills_management' && viewDialog.fullDocument ? (
                renderUtilityBillMemoView(viewDialog.fullDocument)
              ) : viewDialog.document.isWorkflowDocument && viewDialog.document.workflowSubmodule === 'payment_settlement' && viewDialog.fullDocument ? (
                renderPaymentSettlementMemoView(viewDialog.fullDocument)
              ) : viewDialog.document.isWorkflowDocument && viewDialog.document.workflowSubmodule === 'rental_management' && viewDialog.fullDocument ? (
                renderRentalManagementMemoView(viewDialog.fullDocument)
              ) : viewDialog.document.isWorkflowDocument && viewDialog.fullDocument ? (
                <>
                  {/* Document Header */}
                  <Box sx={{ 
                    mb: 3, 
                    borderBottom: '2px solid #000',
                    pb: 2
                  }}>
                    <Typography variant="h5" sx={{ 
                      fontWeight: 700, 
                      textAlign: 'center',
                      mb: 3,
                      fontSize: '24px',
                      letterSpacing: '1px'
                    }}>
                      {viewDialog.fullDocument.accountHead || viewDialog.fullDocument.parentCompanyName || (viewDialog.document?.workflowSubmodule === 'utility_bills_management' ? (viewDialog.fullDocument?.utilityType?.toUpperCase() || 'UTILITY BILL') : viewDialog.document?.workflowSubmodule === 'rental_management' ? 'RENTAL MANAGEMENT' : 'PAYMENT SETTLEMENT')}
                    </Typography>
                    
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                          SITE:
                        </Typography>
                        <Typography variant="body2">
                          {viewDialog.fullDocument.site || 'Head Office'}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                          FROM:
                        </Typography>
                        <Typography variant="body2">
                          {viewDialog.fullDocument.department || viewDialog.fullDocument.fromDepartment || 'Administration'}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                          CUSTODIEN:
                        </Typography>
                        <Typography variant="body2">
                          {viewDialog.fullDocument.custodian || 'N/A'}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                          DATE:
                        </Typography>
                        <Typography variant="body2">
                          {formatDateForDocument(viewDialog.fullDocument.date || viewDialog.fullDocument.billDate)}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                          DOCUMENT NUMBER:
                        </Typography>
                        <Typography variant="body2">
                          {viewDialog.fullDocument.referenceNumber || viewDialog.fullDocument.accountNumber || viewDialog.document?.documentNumber || 'N/A'}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                          NOTE:
                        </Typography>
                        <Typography variant="body2">
                          {viewDialog.fullDocument.attachments && viewDialog.fullDocument.attachments.length > 0 
                            ? 'All Supportings Attached' 
                            : 'No Attachments'}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>

                  {/* Transaction Details Table */}
                  <Box sx={{ mb: 3 }}>
                    <TableContainer component={Paper} sx={{ 
                      boxShadow: 'none',
                      border: '1px solid #000'
                    }}>
                      <Table>
                        <TableHead>
                          <TableRow sx={{ background: '#f5f5f5' }}>
                            <TableCell sx={{ 
                              border: '1px solid #000', 
                              fontWeight: 700,
                              py: 1.5,
                              fontSize: '13px'
                            }}>
                              Date
                            </TableCell>
                            <TableCell sx={{ 
                              border: '1px solid #000', 
                              fontWeight: 700,
                              py: 1.5,
                              fontSize: '13px'
                            }}>
                              Reference No
                            </TableCell>
                            <TableCell sx={{ 
                              border: '1px solid #000', 
                              fontWeight: 700,
                              py: 1.5,
                              fontSize: '13px'
                            }}>
                              To Whom Paid
                            </TableCell>
                            <TableCell sx={{ 
                              border: '1px solid #000', 
                              fontWeight: 700,
                              py: 1.5,
                              fontSize: '13px'
                            }}>
                              For What
                            </TableCell>
                            <TableCell sx={{ 
                              border: '1px solid #000', 
                              fontWeight: 700,
                              py: 1.5,
                              fontSize: '13px',
                              textAlign: 'right'
                            }}>
                              Amount
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          <TableRow>
                            <TableCell sx={{ 
                              border: '1px solid #000',
                              py: 2,
                              fontSize: '13px'
                            }}>
                              {formatDateForDocument(viewDialog.fullDocument.date || viewDialog.fullDocument.billDate)}
                            </TableCell>
                            <TableCell sx={{ 
                              border: '1px solid #000',
                              py: 2,
                              fontSize: '13px'
                            }}>
                              {viewDialog.fullDocument.referenceNumber || viewDialog.fullDocument.accountNumber || 'N/A'}
                            </TableCell>
                            <TableCell sx={{ 
                              border: '1px solid #000',
                              py: 2,
                              fontSize: '13px'
                            }}>
                              {viewDialog.fullDocument.toWhomPaid || viewDialog.fullDocument.provider || 'N/A'}
                            </TableCell>
                            <TableCell sx={{ 
                              border: '1px solid #000',
                              py: 2,
                              fontSize: '13px',
                              whiteSpace: 'pre-wrap'
                            }}>
                              {viewDialog.fullDocument.forWhat || 'N/A'}
                            </TableCell>
                            <TableCell sx={{ 
                              border: '1px solid #000',
                              py: 2,
                              fontSize: '13px',
                              textAlign: 'right',
                              fontWeight: 600
                            }}>
                              {formatPKR(viewDialog.fullDocument.grandTotal || viewDialog.fullDocument.amount)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>

                  {/* Grand Total */}
                  <Box sx={{ 
                    mb: 4,
                    display: 'flex',
                    justifyContent: 'flex-end'
                  }}>
                    <Box sx={{ 
                      border: '2px solid #000',
                      p: 2,
                      minWidth: '250px',
                      background: '#f9f9f9'
                    }}>
                      <Typography variant="h6" sx={{ 
                        fontWeight: 700,
                        textAlign: 'right',
                        fontSize: '18px'
                      }}>
                        Grand Total: {formatPKR(viewDialog.fullDocument.grandTotal || viewDialog.fullDocument.amount || 0)}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Approval Section */}
                  <Box sx={{ 
                    mt: 4,
                    borderTop: '1px solid #000',
                    pt: 3
                  }}>
                    <Grid container spacing={4}>
                      <Grid item xs={4}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="body2" sx={{ 
                            fontWeight: 600, 
                            mb: 2,
                            fontSize: '13px',
                            textDecoration: 'underline'
                          }}>
                            Prepared By:
                          </Typography>
                          <Typography variant="body2" sx={{ 
                            fontWeight: 600,
                            mb: 0.5,
                            fontSize: '13px'
                          }}>
                            {viewDialog.fullDocument.preparedBy || 'N/A'}
                          </Typography>
                          <Typography variant="body2" sx={{ 
                            fontSize: '12px',
                            color: '#666'
                          }}>
                            {viewDialog.fullDocument.preparedByDesignation || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={4}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="body2" sx={{ 
                            fontWeight: 600, 
                            mb: 2,
                            fontSize: '13px',
                            textDecoration: 'underline'
                          }}>
                            Verified By:
                          </Typography>
                          <Typography variant="body2" sx={{ 
                            fontWeight: 600,
                            mb: 0.5,
                            fontSize: '13px'
                          }}>
                            {viewDialog.fullDocument.verifiedBy || 'N/A'}
                          </Typography>
                          <Typography variant="body2" sx={{ 
                            fontSize: '12px',
                            color: '#666'
                          }}>
                            {viewDialog.fullDocument.verifiedByDesignation || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={4}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="body2" sx={{ 
                            fontWeight: 600, 
                            mb: 2,
                            fontSize: '13px',
                            textDecoration: 'underline'
                          }}>
                            Approved by:
                          </Typography>
                          <Typography variant="body2" sx={{ 
                            fontWeight: 600,
                            mb: 0.5,
                            fontSize: '13px'
                          }}>
                            {viewDialog.fullDocument.approvedBy || 'N/A'}
                          </Typography>
                          <Typography variant="body2" sx={{ 
                            fontSize: '12px',
                            color: '#666'
                          }}>
                            {viewDialog.fullDocument.approvedByDesignation || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>
                  </Box>

                  {/* Observations Section */}
                  {(() => {
                    // Extract observations from workflowHistory
                    const observations = viewDialog.document.workflowHistory?.filter(entry => 
                      entry.comments && (
                        entry.comments.toLowerCase().includes('observation') || 
                        entry.comments.toLowerCase().includes('returned from pre audit with observations')
                      )
                    ) || [];

                    if (observations.length === 0) return null;

                    return (
                      <Box sx={{ 
                        mt: 4,
                        borderTop: '2px solid #d32f2f',
                        pt: 3
                      }}>
                        <Box sx={{ 
                          display: 'flex',
                          alignItems: 'center',
                          mb: 2
                        }}>
                          <ErrorIcon sx={{ color: '#d32f2f', mr: 1, fontSize: '20px' }} />
                          <Typography variant="body2" sx={{ 
                            fontWeight: 700, 
                            fontSize: '15px',
                            color: '#d32f2f',
                            textTransform: 'uppercase'
                          }}>
                            CRITICAL OBSERVATIONS:
                          </Typography>
                        </Box>
                        <Box sx={{ 
                          border: '2px solid #d32f2f',
                          p: 2.5,
                          background: '#ffebee',
                          borderRadius: '4px'
                        }}>
                          {observations.map((entry, index) => {
                            const observationMatch = entry.comments.match(/Observation\s*\(([^)]+)\):\s*(.+)/i);
                            const returnedMatch = entry.comments.match(/Returned from Pre Audit with observations:\s*(.+)/i);
                            
                            let observationText = entry.comments;
                            let severity = 'medium';
                            if (observationMatch) {
                              observationText = observationMatch[2];
                              severity = observationMatch[1].toLowerCase();
                            } else if (returnedMatch) {
                              observationText = returnedMatch[1];
                            }

                            const isCritical = severity.includes('high') || severity.includes('critical') || severity.includes('urgent');

                            return (
                              <Box key={index} sx={{ 
                                mb: index < observations.length - 1 ? 2.5 : 0,
                                p: 1.5,
                                background: isCritical ? '#ffcdd2' : '#fff',
                                border: `1px solid ${isCritical ? '#d32f2f' : '#ef5350'}`,
                                borderRadius: '4px'
                              }}>
                                {isCritical && (
                                  <Chip
                                    label="CRITICAL"
                                    size="small"
                                    sx={{
                                      mb: 1,
                                      background: '#d32f2f',
                                      color: '#fff',
                                      fontWeight: 700,
                                      fontSize: '10px'
                                    }}
                                  />
                                )}
                                <Typography variant="body2" sx={{ 
                                  fontSize: '12px',
                                  whiteSpace: 'pre-wrap',
                                  lineHeight: 1.7,
                                  color: '#c62828',
                                  fontWeight: 500
                                }}>
                                  {observationText}
                                </Typography>
                                {entry.changedBy && (
                                  <Typography variant="caption" sx={{ 
                                    display: 'block',
                                    mt: 1,
                                    color: '#d32f2f',
                                    fontSize: '11px'
                                  }}>
                                    — {entry.changedBy.firstName} {entry.changedBy.lastName}
                                    {(() => {
                                      // Extract department from workflowStatus
                                      let department = '';
                                      if (entry.toStatus) {
                                        if (entry.toStatus.includes('AM Admin')) department = 'AM Admin';
                                        else if (entry.toStatus.includes('HOD Admin')) department = 'HOD Admin';
                                        else if (entry.toStatus.includes('Audit')) department = 'Audit';
                                        else if (entry.toStatus.includes('Finance')) department = 'Finance';
                                        else if (entry.toStatus.includes('CEO Office')) department = 'CEO Office';
                                        else if (entry.toStatus.includes('Pre Audit')) department = 'Pre Audit';
                                      }
                                      return department ? ` (${department})` : '';
                                    })()}
                                    {entry.changedAt && ` • ${formatDateForDocument(entry.changedAt)}`}
                                  </Typography>
                                )}
                                {index < observations.length - 1 && (
                                  <Box sx={{ borderTop: '1px dashed #ef5350', mt: 2, pt: 2 }} />
                                )}
                              </Box>
                            );
                          })}
                        </Box>
                      </Box>
                    );
                  })()}

                  {/* Document Attachments Section */}
                  {viewDialog.fullDocument.attachments && viewDialog.fullDocument.attachments.length > 0 && (
                    <Box sx={{ 
                      mt: 4,
                      borderTop: '1px solid #000',
                      pt: 3
                    }}>
                      <Typography variant="body2" sx={{ 
                        fontWeight: 700, 
                        mb: 2,
                        fontSize: '14px',
                        textDecoration: 'underline'
                      }}>
                        ATTACHMENTS ({viewDialog.fullDocument.attachments.length}):
                      </Typography>
                      <Box sx={{ 
                        border: '1px solid #000',
                        p: 2
                      }}>
                        <Grid container spacing={1}>
                          {viewDialog.fullDocument.attachments.map((attachment, index) => {
                            const attachmentUrl = paymentSettlementService.getAttachmentUrl(viewDialog.fullDocument._id, attachment._id);
                            const isImage = attachment.mimeType.startsWith('image/');
                            const isPdf = attachment.mimeType === 'application/pdf';
                            
                            return (
                              <Grid item xs={12} key={attachment._id || index}>
                                <Box 
                                  sx={{ 
                                    p: 1.5, 
                                    border: '1px solid #ccc',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    '&:hover': {
                                      borderColor: '#000',
                                      background: '#f5f5f5'
                                    }
                                  }}
                                  onClick={async () => {
                                    if (isImage) {
                                      try {
                                        const blobUrl = await paymentSettlementService.getAttachmentBlobUrl(viewDialog.fullDocument._id, attachment._id);
                                        setImageViewer({
                                          open: true,
                                          imageUrl: blobUrl,
                                          imageName: attachment.originalName,
                                          isBlob: true
                                        });
                                        setImageZoom(1);
                                        setImageOffset({ x: 0, y: 0 });
                                      } catch (error) {
                                        toast.error('Failed to load image');
                                      }
                                    } else if (isPdf) {
                                      window.open(attachmentUrl, '_blank');
                                    } else {
                                      const link = document.createElement('a');
                                      link.href = attachmentUrl;
                                      link.download = attachment.originalName;
                                      link.target = '_blank';
                                      document.body.appendChild(link);
                                      link.click();
                                      document.body.removeChild(link);
                                    }
                                  }}
                                >
                                  <Typography variant="body2" sx={{ 
                                    fontSize: '12px',
                                    fontWeight: 500
                                  }}>
                                    {index + 1}. {attachment.originalName}
                                  </Typography>
                                </Box>
                              </Grid>
                            );
                          })}
                        </Grid>
                      </Box>
                    </Box>
                  )}
                </>
              ) : (viewDialog.document.isCashApproval && viewDialog.fullDocument && isGeneralModuleCashApproval(viewDialog.fullDocument)) ? (
                <CashApprovalGeneralDetailShell
                  embedded
                  hideBack
                  showStatusChips
                  ca={viewDialog.fullDocument}
                />
              ) : (viewDialog.document.isCashApproval && viewDialog.fullDocument) ? (
                <>
                  <Tabs
                    value={viewDialog.poAuditTab ?? 0}
                    onChange={(_, v) => setViewDialog(prev => ({ ...prev, poAuditTab: v }))}
                    sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider', '@media print': { display: 'none' } }}
                    variant="scrollable"
                    scrollButtons="auto"
                  >
                    <Tab label="Indent" />
                    <Tab label="Cash Approval" />
                    <Tab label="Comparative Statement" />
                    <Tab label={`Quotations (${viewDialog.quotations?.length || 0})`} />
                    <Tab label="Cash Approval Bill" />
                  </Tabs>

                  {viewDialog.poAuditTab === 0 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {!viewDialog.fullDocument?.indent ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                          No indent linked to this Cash Approval.
                        </Typography>
                      ) : (
                        <Paper sx={{ p: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="h5" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1 }}>
                            Purchase Request Form
                          </Typography>
                          {viewDialog.fullDocument.indent.title && (
                            <Typography variant="h6" fontWeight={600} align="center" sx={{ mb: 2 }}>
                              {viewDialog.fullDocument.indent.title}
                            </Typography>
                          )}
                          <Box sx={{ mb: 1.5, fontSize: '0.9rem', textAlign: 'center' }}>
                            <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                            <Typography component="span" sx={{ ml: 1 }}>
                              {viewDialog.fullDocument.indent.erpRef || 'PR #' + (viewDialog.fullDocument.indent.indentNumber?.split('-').pop() || '')}
                            </Typography>
                          </Box>
                          <Box sx={{ mb: 1.5, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <Box><Typography component="span" fontWeight={600}>Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.fullDocument.indent.requestedDate)}</Typography></Box>
                            <Box><Typography component="span" fontWeight={600}>Required Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.fullDocument.indent.requiredDate) || '—'}</Typography></Box>
                            <Box><Typography component="span" fontWeight={600}>Indent No.:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.indent.indentNumber || '—'}</Typography></Box>
                          </Box>
                          <Box sx={{ mb: 3, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <Box><Typography component="span" fontWeight={600}>Department:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.indent.department?.name || viewDialog.fullDocument.indent.department || '—'}</Typography></Box>
                            <Box><Typography component="span" fontWeight={600}>Originator:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.indent.requestedBy?.firstName && viewDialog.fullDocument.indent.requestedBy?.lastName ? `${viewDialog.fullDocument.indent.requestedBy.firstName} ${viewDialog.fullDocument.indent.requestedBy.lastName}` : viewDialog.fullDocument.indent.requestedBy?.name || '—'}</Typography></Box>
                          </Box>
                          <Box sx={{ mb: 3 }}>
                            <Table size="small" sx={{ border: '1px solid', borderColor: 'divider' }}>
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.100' }}>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>S#</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Item Name</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Description</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Brand</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Unit</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="center">Qty</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Purpose</TableCell>
                                  <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="right">Est. Cost</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {(viewDialog.fullDocument.indent.items || []).map((item, idx) => (
                                  <TableRow key={idx}>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="center">{idx + 1}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.itemName || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.description || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.brand || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.unit || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="center">{item.quantity ?? '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.purpose || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{item.estimatedCost != null ? Number(item.estimatedCost).toFixed(2) : '—'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                          {viewDialog.fullDocument.indent.justification && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Justification:</Typography>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                {viewDialog.fullDocument.indent.justification}
                              </Typography>
                            </Box>
                          )}
                          {renderIndentApprovalProgress(viewDialog.fullDocument.indent, {
                            title: 'Indent approval progress'
                          })}
                        </Paper>
                      )}
                    </Box>
                  )}

                  {viewDialog.poAuditTab === 1 && (
                    <Paper sx={{ p: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider', '@media print': { p: 2.5, maxWidth: '100%', mx: 0 } }}>
                      <Typography variant="h5" align="center" fontWeight={700} sx={{ mb: 2, letterSpacing: 1 }}>
                        CASH APPROVAL
                      </Typography>
                      <Box sx={{ mb: 1.5, fontSize: '0.9rem', textAlign: 'center' }}>
                        <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                        <Typography component="span" sx={{ ml: 1 }}>
                          {viewDialog.fullDocument?.indent?.erpRef || viewDialog.fullDocument?.caNumber || '—'}
                        </Typography>
                      </Box>
                      <Box sx={{ mb: 1.5, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <Box><Typography component="span" fontWeight={600}>CA Number:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.caNumber || '—'}</Typography></Box>
                        <Box><Typography component="span" fontWeight={600}>Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.fullDocument.approvalDate)}</Typography></Box>
                        <Box><Typography component="span" fontWeight={600}>Status:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.status || '—'}</Typography></Box>
                      </Box>
                      <Box sx={{ mb: 3, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <Box><Typography component="span" fontWeight={600}>Vendor:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.fullDocument.vendor?.name || '—'}</Typography></Box>
                        <Box><Typography component="span" fontWeight={600}>Expected Purchase:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.fullDocument.expectedPurchaseDate) || '—'}</Typography></Box>
                        <Box><Typography component="span" fontWeight={600}>Total:</Typography><Typography component="span" sx={{ ml: 1, fontWeight: 700 }}>{formatPKR(viewDialog.fullDocument.totalAmount)}</Typography></Box>
                      </Box>
                      <Divider sx={{ my: 2 }} />
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Items</Typography>
                      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>#</TableCell>
                              <TableCell>Description</TableCell>
                              <TableCell align="right">Qty</TableCell>
                              <TableCell>Unit</TableCell>
                              <TableCell align="right">Unit Price</TableCell>
                              <TableCell align="right">Amount</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(viewDialog.fullDocument.items || []).map((row, idx) => (
                              <TableRow key={idx}>
                                <TableCell>{idx + 1}</TableCell>
                                <TableCell>{row.description}</TableCell>
                                <TableCell align="right">{row.quantity}</TableCell>
                                <TableCell>{row.unit}</TableCell>
                                <TableCell align="right">{formatPKR(row.unitPrice)}</TableCell>
                                <TableCell align="right">{formatPKR(row.amount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                        Approval authorities (recorded trail)
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                        Each row is an approval action on this Cash Approval, in chronological order.
                      </Typography>
                      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700 }} width={48}>#</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Authority</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Approver</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Date &amp; Time</TableCell>
                              <TableCell sx={{ fontWeight: 700 }} align="center">Digital Signature</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(() => {
                              const ca = viewDialog.fullDocument;
                              const personName = (user, fallback = '') => (
                                [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
                                || user?.email
                                || fallback
                                || '—'
                              );
                              const normalizeAuthKey = (k) => String(k || '').trim().toLowerCase();
                              const slotLabels = {
                                preparedby: 'Prepared By',
                                verifiedby: 'Verified By (Procurement Committee)',
                                authorisedrep: 'Authorised Rep.',
                                financerep: 'Finance Rep.',
                                managerprocurement: 'Manager Procurement'
                              };
                              const roleLabel = (entry) => {
                                const lbl = String(entry.authorityLabel || '').trim();
                                if (lbl) return lbl;
                                const k = normalizeAuthKey(entry.authorityKey);
                                return slotLabels[k] || (entry.authorityKey ? String(entry.authorityKey).trim() : 'Authority');
                              };
                              const rawAuthorityApprovals = Array.isArray(ca?.authorityApprovals) ? ca.authorityApprovals : [];
                              const trailSorted = [...rawAuthorityApprovals]
                                .filter((e) => e?.approver != null)
                                .sort((a, b) => {
                                  const ta = a.approvedAt ? new Date(a.approvedAt).getTime() : 0;
                                  const tb = b.approvedAt ? new Date(b.approvedAt).getTime() : 0;
                                  return ta - tb;
                                });
                              const auditAction = ca?.auditRejectedBy
                                ? {
                                    label: 'Rejected by Pre-Audit',
                                    user: ca.auditRejectedBy,
                                    actedAt: ca.auditRejectedAt,
                                    comments: ca.auditRejectionComments || ''
                                  }
                                : ca?.auditReturnedBy
                                  ? {
                                      label: 'Returned by Pre-Audit',
                                      user: ca.auditReturnedBy,
                                      actedAt: ca.auditReturnedAt,
                                      comments: ca.auditReturnComments || ''
                                    }
                                  : null;

                              const rows = [];
                              let step = 0;

                              trailSorted.forEach((entry, idx) => {
                                step += 1;
                                const approver = entry.approver;
                                const userObj = approver && typeof approver === 'object' ? approver : null;
                                const idHint = typeof approver === 'string' ? `User …${String(approver).slice(-6)}` : '';
                                const label = roleLabel(entry);
                                rows.push(
                                  <TableRow key={`ca-trail-${String(entry._id || entry.authorityKey || idx)}-${idx}`}>
                                    <TableCell>{step}</TableCell>
                                    <TableCell>{label}</TableCell>
                                    <TableCell>
                                      {personName(userObj, idHint)}
                                      {entry.comments ? (
                                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
                                          {entry.comments}
                                        </Typography>
                                      ) : null}
                                    </TableCell>
                                    <TableCell>
                                      <Chip size="small" label="Approved" color="success" variant="filled" />
                                    </TableCell>
                                    <TableCell>{entry.approvedAt ? formatDateTime(entry.approvedAt) : '—'}</TableCell>
                                    <TableCell align="center">
                                      {userObj?.digitalSignature ? (
                                        <DigitalSignatureImage userOrPath={userObj} alt={`${label} signature`} />
                                      ) : (
                                        <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              });

                              if (!trailSorted.length && ca?.authorityApprovedBy && ca?.authorityApprovedAt) {
                                step += 1;
                                const userObj = typeof ca.authorityApprovedBy === 'object' ? ca.authorityApprovedBy : null;
                                rows.push(
                                  <TableRow key="ca-trail-legacy">
                                    <TableCell>{step}</TableCell>
                                    <TableCell>Authority approval (legacy record)</TableCell>
                                    <TableCell>{personName(userObj)}</TableCell>
                                    <TableCell>
                                      <Chip size="small" label="Approved" color="success" variant="filled" />
                                    </TableCell>
                                    <TableCell>{formatDateTime(ca.authorityApprovedAt)}</TableCell>
                                    <TableCell align="center">
                                      {userObj?.digitalSignature ? (
                                        <DigitalSignatureImage userOrPath={userObj} alt="Legacy authority signature" />
                                      ) : (
                                        <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              }

                              if (ca?.preAuditInitialApprovedBy || ca?.preAuditInitialApprovedAt) {
                                step += 1;
                                const userObj = typeof ca.preAuditInitialApprovedBy === 'object' ? ca.preAuditInitialApprovedBy : null;
                                rows.push(
                                  <TableRow key="ca-pre-audit-initial">
                                    <TableCell>{step}</TableCell>
                                    <TableCell>Initial Pre-Audit</TableCell>
                                    <TableCell>{personName(userObj)}</TableCell>
                                    <TableCell>
                                      <Chip size="small" label="Approved" color="success" variant="filled" />
                                    </TableCell>
                                    <TableCell>{ca.preAuditInitialApprovedAt ? formatDateTime(ca.preAuditInitialApprovedAt) : '—'}</TableCell>
                                    <TableCell align="center">
                                      {userObj?.digitalSignature ? (
                                        <DigitalSignatureImage userOrPath={userObj} alt="Initial Pre-Audit signature" />
                                      ) : (
                                        <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              }

                              if (ca?.auditApprovedBy || ca?.auditApprovedAt) {
                                step += 1;
                                const userObj = typeof ca.auditApprovedBy === 'object' ? ca.auditApprovedBy : null;
                                rows.push(
                                  <TableRow key="ca-audit-director">
                                    <TableCell>{step}</TableCell>
                                    <TableCell>Audit Director (final)</TableCell>
                                    <TableCell>{personName(userObj)}</TableCell>
                                    <TableCell>
                                      <Chip size="small" label="Approved" color="success" variant="filled" />
                                    </TableCell>
                                    <TableCell>{ca.auditApprovedAt ? formatDateTime(ca.auditApprovedAt) : '—'}</TableCell>
                                    <TableCell align="center">
                                      {userObj?.digitalSignature ? (
                                        <DigitalSignatureImage userOrPath={userObj} alt="Audit Director signature" />
                                      ) : (
                                        <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              }

                              if (auditAction) {
                                step += 1;
                                rows.push(
                                  <TableRow key="ca-audit-action">
                                    <TableCell>{step}</TableCell>
                                    <TableCell sx={{ fontWeight: 700, color: 'primary.main' }}>{auditAction.label}</TableCell>
                                    <TableCell>
                                      {personName(auditAction.user)}
                                      {auditAction.comments ? (
                                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
                                          {auditAction.comments}
                                        </Typography>
                                      ) : null}
                                    </TableCell>
                                    <TableCell>
                                      <Chip size="small" label="—" color="default" variant="outlined" />
                                    </TableCell>
                                    <TableCell>{auditAction.actedAt ? formatDateTime(auditAction.actedAt) : '—'}</TableCell>
                                    <TableCell align="center">
                                      {auditAction.user?.digitalSignature ? (
                                        <DigitalSignatureImage userOrPath={auditAction.user} alt="Pre-Audit signature" />
                                      ) : (
                                        <Typography variant="body2" color="text.secondary">—</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              }

                              if (!rows.length) {
                                return (
                                  <TableRow>
                                    <TableCell colSpan={6}>
                                      <Typography variant="body2" color="text.secondary">
                                        No authority approvals recorded on this Cash Approval yet.
                                      </Typography>
                                    </TableCell>
                                  </TableRow>
                                );
                              }

                              return <>{rows}</>;
                            })()}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Paper>
                  )}

                  {viewDialog.poAuditTab === 2 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      <ComparativeStatementView
                        requisition={viewDialog.fullDocument?.indent}
                        quotations={viewDialog.quotations || []}
                        approvalAuthority={viewDialog.fullDocument?.indent?.comparativeStatementApprovals || {}}
                        note={viewDialog.fullDocument?.indent?.notes ?? ''}
                        readOnly
                        formatNumber={formatNumber}
                        loadingQuotations={false}
                        showPrintButton={false}
                      />
                    </Box>
                  )}

                  {viewDialog.poAuditTab === 3 && (
                    <Box sx={{ p: 2 }}>
                      {(!viewDialog.quotations || viewDialog.quotations.length === 0) ? (
                        <Typography color="text.secondary">No quotations for this requisition.</Typography>
                      ) : (
                        <Stack spacing={4}>
                          {viewDialog.quotations.map((q) => (
                            <QuotationDetailView
                              key={q._id}
                              quotation={q}
                              formatNumber={formatNumber}
                              formatDateForPrint={formatDateForPrint}
                            />
                          ))}
                        </Stack>
                      )}
                    </Box>
                  )}

                  {viewDialog.poAuditTab === 4 && (
                    <Box sx={{ p: 2 }}>
                      <Paper sx={{ p: 3, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="h5" align="center" fontWeight={700} sx={{ mb: 2, letterSpacing: 0.8 }}>
                          CASH APPROVAL BILL
                        </Typography>
                        <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                          <Table size="small">
                            <TableBody>
                              <TableRow>
                                <TableCell sx={{ width: '32%', fontWeight: 700, bgcolor: 'action.hover' }}>Advance Issued Amount</TableCell>
                                <TableCell>{formatPKR(Number(viewDialog.fullDocument?.advanceAmount) || Number(viewDialog.fullDocument?.totalAmount) || 0)}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700, bgcolor: 'action.hover' }}>Actual Amount Spent (Procurement Bill)</TableCell>
                                <TableCell>{formatPKR(viewDialog.fullDocument?.evidenceActualAmount || 0)}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700, bgcolor: 'action.hover' }}>Invoice / Receipt No.</TableCell>
                                <TableCell>{viewDialog.fullDocument?.purchaseInvoiceNo || '—'}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700, bgcolor: 'action.hover' }}>Bill Submitted By</TableCell>
                                <TableCell>
                                  {[viewDialog.fullDocument?.evidenceSubmittedBy?.firstName, viewDialog.fullDocument?.evidenceSubmittedBy?.lastName].filter(Boolean).join(' ')
                                    || viewDialog.fullDocument?.evidenceSubmittedBy?.email
                                    || '—'}
                                </TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700, bgcolor: 'action.hover' }}>Bill Submitted At</TableCell>
                                <TableCell>{viewDialog.fullDocument?.evidenceSubmittedAt ? formatDate(viewDialog.fullDocument.evidenceSubmittedAt) : '—'}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700, bgcolor: 'action.hover' }}>Bill Remarks</TableCell>
                                <TableCell sx={{ whiteSpace: 'pre-wrap' }}>{viewDialog.fullDocument?.evidenceRemarks || '—'}</TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </TableContainer>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                          Approval Authorities
                        </Typography>
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 700 }}>Authority</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Approver</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Date &amp; Time</TableCell>
                                <TableCell sx={{ fontWeight: 700 }} align="center">Digital Signature</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {[
                                {
                                  key: 'pre-audit-initial',
                                  label: 'Initial Pre-Audit',
                                  user: viewDialog.fullDocument?.preAuditInitialApprovedBy,
                                  actedAt: viewDialog.fullDocument?.preAuditInitialApprovedAt
                                },
                                {
                                  key: 'audit-director-final',
                                  label: 'Audit Director (final)',
                                  user: viewDialog.fullDocument?.auditApprovedBy,
                                  actedAt: viewDialog.fullDocument?.auditApprovedAt
                                }
                              ].map((row) => {
                                const billSubmittedAt = viewDialog.fullDocument?.evidenceSubmittedAt
                                  ? new Date(viewDialog.fullDocument.evidenceSubmittedAt)
                                  : null;
                                const userObj = row.user && typeof row.user === 'object' ? row.user : null;
                                const userId = userObj?._id || userObj?.id || (typeof row.user === 'string' ? row.user : '');
                                const actedAtDate = row.actedAt ? new Date(row.actedAt) : null;
                                const hasValidActionDate = Boolean(actedAtDate && !Number.isNaN(actedAtDate.getTime()));
                                const isInBillCycle = !billSubmittedAt
                                  || Number.isNaN(billSubmittedAt.getTime())
                                  || (hasValidActionDate && actedAtDate >= billSubmittedAt);
                                const baseApproverName = userObj
                                  ? ([userObj.firstName, userObj.lastName].filter(Boolean).join(' ').trim() || userObj.email || '—')
                                  : '—';
                                const currentStatus = String(viewDialog.fullDocument?.status || '').trim();
                                const hasFinalBillApprovalStatus = !['Pending Audit', 'Forwarded to Audit Director', 'Returned from Audit'].includes(currentStatus);
                                const isApproved = row.key === 'audit-director-final'
                                  ? (Boolean(userId) && hasValidActionDate && isInBillCycle && hasFinalBillApprovalStatus)
                                  : (Boolean(userId) && hasValidActionDate);
                                const approverName = isApproved ? baseApproverName : '—';
                                return (
                                  <TableRow key={row.key}>
                                    <TableCell>{row.label}</TableCell>
                                    <TableCell>{approverName}</TableCell>
                                    <TableCell>
                                      <Chip
                                        size="small"
                                        label={isApproved ? 'Approved' : 'Pending'}
                                        color={isApproved ? 'success' : 'warning'}
                                        variant={isApproved ? 'filled' : 'outlined'}
                                      />
                                    </TableCell>
                                    <TableCell>{isApproved ? formatDateTime(row.actedAt) : '—'}</TableCell>
                                    <TableCell align="center">
                                      {isApproved && userObj?.digitalSignature ? (
                                        <DigitalSignatureImage userOrPath={userObj} alt={`${row.label} signature`} />
                                      ) : isApproved ? (
                                        <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                                      ) : (
                                        <Typography variant="caption" color="text.secondary">—</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Paper>
                    </Box>
                  )}

                </>
              ) : (
                /* Regular Pre Audit Document View */
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={12}>
                    <Typography variant="h6">{viewDialog.document.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {viewDialog.document.description}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Department</Typography>
                    <Typography variant="body2">{viewDialog.document.sourceDepartmentName}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Module</Typography>
                    <Typography variant="body2">{viewDialog.document.sourceModule}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Document Type</Typography>
                    <Typography variant="body2">{viewDialog.document.documentType}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Document Date</Typography>
                    <Typography variant="body2">{formatDate(viewDialog.document.documentDate)}</Typography>
                  </Grid>
                  {viewDialog.document.amount && (
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Amount</Typography>
                      <Typography variant="body2">{formatPKR(viewDialog.document.amount)}</Typography>
                    </Grid>
                  )}
                  {/* Show observations for regular PreAudit documents */}
                  {viewDialog.document.observations && 
                   !viewDialog.document.isPurchaseOrder && 
                   !viewDialog.document.isCashApproval &&
                   !(viewDialog.document.isWorkflowDocument && viewDialog.fullDocument?.isPurchaseOrder) &&
                   viewDialog.document.observations.length > 0 && (
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>Observations</Typography>
                      {viewDialog.document.observations.map((obs, idx) => (
                        <Paper key={idx} sx={{ p: 2, mb: 1, bgcolor: alpha(theme.palette.warning.main, 0.1) }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Chip
                              label={obs.severity}
                              size="small"
                              color={getSeverityColor(obs.severity)}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(obs.addedAt)}
                            </Typography>
                          </Box>
                          <Typography variant="body2" sx={{ mb: obs.answer ? 1.5 : 0 }}>{obs.observation}</Typography>
                          {obs.answer && (
                            <Box sx={{ mt: 1.5, p: 1.5, bgcolor: alpha(theme.palette.success.main, 0.1), borderRadius: 1, border: '1px solid', borderColor: 'success.light' }}>
                              <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                                Response from Procurement:
                              </Typography>
                              <Typography variant="body2">{obs.answer}</Typography>
                              {obs.answeredBy && (
                                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                                  Answered by: {obs.answeredBy?.firstName || ''} {obs.answeredBy?.lastName || ''}
                                  {obs.answeredAt && ` on ${formatDate(obs.answeredAt)}`}
                                </Typography>
                              )}
                            </Box>
                          )}
                        </Paper>
                      ))}
                    </Grid>
                  )}
                  {/* Show auditObservations for Purchase Orders */}
                  {(() => {
                    const isPO = viewDialog.document?.isPurchaseOrder || viewDialog.document?.isCashApproval || (viewDialog.document?.isWorkflowDocument && viewDialog.fullDocument?.isPurchaseOrder);
                    const observations = viewDialog.fullDocument?.auditObservations || viewDialog.document?.auditObservations || [];
                    const hasObservations = Array.isArray(observations) && observations.length > 0;
                    return isPO && hasObservations;
                  })() && (
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>Audit Observations</Typography>
                      {(viewDialog.fullDocument?.auditObservations || viewDialog.document?.auditObservations || []).map((obs, idx) => (
                        <Paper key={obs._id || idx} sx={{ p: 2, mb: 1, bgcolor: alpha(theme.palette.warning.main, 0.1), border: '1px solid', borderColor: 'warning.light' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Chip
                              label={obs.severity || 'medium'}
                              size="small"
                              color={getSeverityColor(obs.severity)}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {obs.addedAt ? formatDate(obs.addedAt) : 'N/A'}
                              {obs.addedBy && ` by ${obs.addedBy?.firstName || ''} ${obs.addedBy?.lastName || ''}`}
                            </Typography>
                          </Box>
                          <Typography variant="body2" sx={{ mb: obs.answer ? 1.5 : 0, fontWeight: 500 }}>
                            {obs.observation}
                          </Typography>
                          {obs.answer && (
                            <Box sx={{ mt: 1.5, p: 1.5, bgcolor: alpha(theme.palette.success.main, 0.1), borderRadius: 1, border: '1px solid', borderColor: 'success.light' }}>
                              <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5, color: 'success.dark' }}>
                                Response from Procurement:
                              </Typography>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{obs.answer}</Typography>
                              {obs.answeredBy && (
                                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                                  Answered by: {obs.answeredBy?.firstName || ''} {obs.answeredBy?.lastName || ''}
                                  {obs.answeredAt && ` on ${formatDate(obs.answeredAt)}`}
                                </Typography>
                              )}
                            </Box>
                          )}
                          {!obs.answer && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic', display: 'block', mt: 1 }}>
                              No response provided yet
                            </Typography>
                          )}
                        </Paper>
                      ))}
                    </Grid>
                  )}
                  {viewDialog.document.attachments && viewDialog.document.attachments.length > 0 && (
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>Attachments</Typography>
                      {viewDialog.document.attachments.map((att, idx) => (
                        <Box key={idx} sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                          <AttachFileIcon sx={{ mr: 1 }} />
                          <Typography variant="body2">{att.originalName}</Typography>
                        </Box>
                      ))}
                    </Grid>
                  )}
                </Grid>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ 
          p: 2, 
          borderTop: '1px solid #e0e0e0',
          background: '#f9f9f9',
          justifyContent: 'space-between'
        }}>
          <Box>
            {viewDialog.document?.isWorkflowDocument && viewDialog.fullDocument && (
              <>
                <Chip
                  label={viewDialog.fullDocument.workflowStatus || viewDialog.document.workflowStatus || 'Draft'}
                  color={getStatusColor(viewDialog.document.status)}
                  size="small"
                  sx={{ mr: 1 }}
                />
                <Chip
                  label={viewDialog.fullDocument.paymentType}
                  variant="outlined"
                  size="small"
                />
              </>
            )}
          </Box>
          <Box>
            {(viewDialog.document?.isWorkflowDocument || viewDialog.document?.isCashApproval || viewDialog.document?.isVendorBill) && viewDialog.fullDocument && (
              <Button
                variant="outlined"
                startIcon={<HistoryIcon />}
                onClick={() => setWorkflowHistoryDialog({ open: true, document: viewDialog.fullDocument })}
                sx={{ minWidth: 150, mr: 1, '@media print': { display: 'none' } }}
              >
                See Workflow History
              </Button>
            )}
            <Button 
              onClick={() => setViewDialog({ open: false, document: null, fullDocument: null, loading: false, quotations: [], grns: [], caLinkedDocs: [], poAuditTab: 0 })}
              variant="outlined"
              sx={{ minWidth: 80, '@media print': { display: 'none' } }}
            >
              Close
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* Print styles: hide rest of app, show dialog + .print-content (PO, CA, and admin workflow memos incl. utility bills). */}
      {(viewDialog.document?.isPurchaseOrder ||
        viewDialog.document?.isCashApproval ||
        (viewDialog.document?.isWorkflowDocument &&
          (viewDialog.fullDocument?.isPurchaseOrder ||
            viewDialog.document?.workflowSubmodule === 'utility_bills_management' ||
            viewDialog.document?.workflowSubmodule === 'payment_settlement' ||
            viewDialog.document?.workflowSubmodule === 'rental_management'))) && (
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
                .print-content img {
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
                ${PO_A4_ONE_PAGE_PRINT_CSS}
              }
            `
          }}
        />
      )}

      {/* Workflow History Dialog */}
      <WorkflowHistoryDialog
        open={workflowHistoryDialog.open}
        onClose={() => setWorkflowHistoryDialog({ open: false, document: null })}
        document={workflowHistoryDialog.document}
        documentType="preAudit"
      />

      {/* Image Viewer Modal */}
      <Dialog
        open={imageViewer.open}
        onClose={() => {
          if (imageViewer.isBlob && imageViewer.imageUrl) {
            URL.revokeObjectURL(imageViewer.imageUrl);
          }
          setImageZoom(1);
          setImageOffset({ x: 0, y: 0 });
          setImageViewer({ open: false, imageUrl: '', imageName: '', isBlob: false });
        }}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'transparent',
            boxShadow: 'none',
            maxHeight: '90vh'
          }
        }}
      >
        <Box
          sx={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            borderRadius: 2,
            p: 2
          }}
        >
          <Box sx={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 1, zIndex: 2 }}>
            <IconButton
              onClick={() => changeImageZoom(-0.2)}
              sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.3)' }
              }}
              title="Zoom out"
            >
              <ZoomOutIcon />
            </IconButton>
            <IconButton
              onClick={() => { setImageZoom(1); setImageOffset({ x: 0, y: 0 }); }}
              sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.3)' }
              }}
              title="Reset zoom"
            >
              <RestartAltIcon />
            </IconButton>
            <IconButton
              onClick={() => changeImageZoom(0.2)}
              sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.3)' }
              }}
              title="Zoom in"
            >
              <ZoomInIcon />
            </IconButton>
          </Box>
          <IconButton
            onClick={() => {
              if (imageViewer.isBlob && imageViewer.imageUrl) {
                URL.revokeObjectURL(imageViewer.imageUrl);
              }
              setImageZoom(1);
              setImageOffset({ x: 0, y: 0 });
              setImageViewer({ open: false, imageUrl: '', imageName: '', isBlob: false });
            }}
            sx={{
              position: 'absolute',
              top: 16,
              right: 16,
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.3)'
              },
              zIndex: 1
            }}
          >
            <CloseIcon />
          </IconButton>
          <Box
            sx={{
              maxWidth: '100%',
              maxHeight: '80vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: imageZoom > 1 ? (dragState.active ? 'grabbing' : 'grab') : 'default'
            }}
            onMouseMove={onImageDrag}
            onMouseUp={stopImageDrag}
            onMouseLeave={stopImageDrag}
          >
            <img
              src={imageViewer.imageUrl}
              alt={imageViewer.imageName}
              onMouseDown={startImageDrag}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                borderRadius: 8,
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
                ,
                transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageZoom})`,
                transformOrigin: 'center center',
                transition: dragState.active ? 'none' : 'transform 0.15s ease',
                userSelect: 'none'
              }}
            />
          </Box>
          <Box
            sx={{
              position: 'absolute',
              bottom: 16,
              left: 16,
              right: 16,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              borderRadius: 1,
              p: 2,
              color: 'white'
            }}
          >
            <Typography variant="subtitle1" fontWeight="bold" noWrap>
              {imageViewer.imageName}
            </Typography>
          </Box>
        </Box>
      </Dialog>

      {/* Centralized Store catalog (Audit Director reference) */}
      <Dialog
        open={storeCatalogOpen}
        onClose={() => setStoreCatalogOpen(false)}
        maxWidth="lg"
        fullWidth
        scroll="paper"
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <StoreIcon color="primary" />
          Centralized Store Items
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Catalog reference for centralized store bills. Filter by category, location, or site while reviewing forwarded documents.
          </Typography>
          <CentralizedStoreItemsAuditPanel open={storeCatalogOpen} embedded />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStoreCatalogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Finance vendors & AP bills (Audit Director reference) */}
      <Dialog
        open={vendorsCatalogOpen}
        onClose={() => setVendorsCatalogOpen(false)}
        maxWidth="lg"
        fullWidth
        scroll="paper"
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <VendorIcon color="primary" />
          Vendors &amp; Bills
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Finance vendor register and accounts payable bills — same data as Finance → Vendors. Use while reviewing forwarded documents.
          </Typography>
          <FinanceVendorsAuditPanel open={vendorsCatalogOpen} embedded />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVendorsCatalogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Forward to Audit Director Dialog */}
      <Dialog
        open={forwardDialog.open}
        onClose={() => {
          setForwardDialog({ open: false, document: null });
          setForwardComments('');
        }}
      >
        <DialogTitle>Forward to Audit Director</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Forward Comments (Optional)"
            value={forwardComments}
            onChange={(e) => setForwardComments(e.target.value)}
            sx={{ mt: 2, minWidth: 400 }}
            placeholder="Add any comments for the Audit Director..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setForwardDialog({ open: false, document: null });
            setForwardComments('');
          }}>Cancel</Button>
          <Button onClick={handleForward} variant="contained" color="primary">
            Forward to Audit Director
          </Button>
        </DialogActions>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog
        open={approveDialog.open}
        onClose={() => {
          setApproveDialog({ open: false, document: null });
          setApprovalComments('');
          setUseStampForAction(false);
        }}
      >
        <DialogTitle>
          {approveDialog.document?.status === 'forwarded_to_director' ||
          approveDialog.document?.workflowStatus === 'Forwarded to Audit Director'
            ? 'Final Approve (Audit Director)'
            : 'Initial Approve (Pre-Audit)'}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label={
              approveDialog.document?.status === 'forwarded_to_director' ||
              approveDialog.document?.workflowStatus === 'Forwarded to Audit Director'
                ? 'Final Approval Comments'
                : 'Initial Approval Comments'
            }
            value={approvalComments}
            onChange={(e) => setApprovalComments(e.target.value)}
            sx={{ mt: 2, minWidth: 400 }}
          />
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Checkbox checked={useStampForAction} onChange={(e) => setUseStampForAction(e.target.checked)} />}
            label="Use my approval stamp (if uploaded)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setApproveDialog({ open: false, document: null });
            setApprovalComments('');
            setUseStampForAction(false);
          }}>Cancel</Button>
          <Button onClick={handleApprove} variant="contained" color="success">
            {approveDialog.document?.status === 'forwarded_to_director' ||
            approveDialog.document?.workflowStatus === 'Forwarded to Audit Director'
              ? 'Final Approve'
              : 'Initial Approve'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Observation Dialog */}
      <Dialog
        open={observationDialog.open}
        onClose={() => {
          setObservationDialog({ open: false, document: null });
          setObservation({ text: '', severity: 'medium' });
        }}
      >
        <DialogTitle>Add Observation</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Observation"
            value={observation.text}
            onChange={(e) => setObservation({ ...observation, text: e.target.value })}
            sx={{ mt: 2, mb: 2, minWidth: 400 }}
            required
          />
          <FormControl fullWidth>
            <InputLabel>Severity</InputLabel>
            <Select
              value={observation.severity}
              label="Severity"
              onChange={(e) => setObservation({ ...observation, severity: e.target.value })}
            >
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
              <MenuItem value="critical">Critical</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setObservationDialog({ open: false, document: null });
            setObservation({ text: '', severity: 'medium' });
          }}>Cancel</Button>
          <Button
            onClick={handleAddObservation}
            variant="contained"
            color="primary"
            disabled={!observation.text}
          >
            Add Observation
          </Button>
        </DialogActions>
      </Dialog>

      {/* Return Dialog */}
      <Dialog
        open={returnDialog.open}
        onClose={() => {
          setReturnDialog({ open: false, document: null });
          setReturnComments('');
        }}
      >
        <DialogTitle>Return Document to Department</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Return Comments"
            value={returnComments}
            onChange={(e) => setReturnComments(e.target.value)}
            sx={{ mt: 2, minWidth: 400 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setReturnDialog({ open: false, document: null });
            setReturnComments('');
          }}>Cancel</Button>
          <Button onClick={handleReturn} variant="contained" color="warning">
            Return to Department
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialog.open}
        onClose={() => {
          setRejectDialog({ open: false, document: null });
          setRejectionComments('');
          setRejectObservations([{ observation: '', severity: 'medium' }]);
          setUseStampForAction(false);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Reject Document with Observations</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will reject the document and return it to the initiator. They can correct and resend it.
          </Alert>
          
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Rejection Comments"
            value={rejectionComments}
            onChange={(e) => setRejectionComments(e.target.value)}
            sx={{ mb: 3 }}
            required
          />
          <FormControlLabel
            sx={{ mb: 2 }}
            control={<Checkbox checked={useStampForAction} onChange={(e) => setUseStampForAction(e.target.checked)} />}
            label="Use my approval stamp (if uploaded)"
          />

          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
            Observations (Optional)
          </Typography>
          
          {rejectObservations.map((obs, index) => (
            <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={8}>
                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    label={`Observation ${index + 1}`}
                    value={obs.observation}
                    onChange={(e) => updateRejectObservation(index, 'observation', e.target.value)}
                    placeholder="Enter observation..."
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Severity</InputLabel>
                    <Select
                      value={obs.severity}
                      label="Severity"
                      onChange={(e) => updateRejectObservation(index, 'severity', e.target.value)}
                    >
                      <MenuItem value="low">Low</MenuItem>
                      <MenuItem value="medium">Medium</MenuItem>
                      <MenuItem value="high">High</MenuItem>
                      <MenuItem value="critical">Critical</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={1}>
                  {rejectObservations.length > 1 && (
                    <IconButton
                      color="error"
                      onClick={() => removeRejectObservation(index)}
                      size="small"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Grid>
              </Grid>
            </Box>
          ))}
          
          <Button
            startIcon={<AddIcon />}
            onClick={addRejectObservation}
            variant="outlined"
            size="small"
            sx={{ mt: 1 }}
          >
            Add Another Observation
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setRejectDialog({ open: false, document: null });
            setRejectionComments('');
            setRejectObservations([{ observation: '', severity: 'medium' }]);
          }}>Cancel</Button>
          <Button 
            onClick={handleReject} 
            variant="contained" 
            color="error"
            disabled={!rejectionComments.trim() && rejectObservations.every(obs => !obs.observation.trim())}
          >
            Reject & Return
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PreAudit;

