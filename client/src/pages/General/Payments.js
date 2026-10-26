import React, { useState, useEffect } from 'react';
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
  Alert,
  Stack,
  Tooltip,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tabs,
  Tab,
  Divider,
  alpha,
  useTheme
} from '@mui/material';
import {
  Visibility as ViewIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Send as SendIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Close as CloseIcon,
  Payment as PaymentIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  Assignment as AssignmentIcon,
  AttachMoney as AttachMoneyIcon,
  AttachFile as AttachFileIcon,
  Print as PrintIcon,
  Edit as EditIcon,
  Search as SearchIcon,
  Add as AddIcon,
  ExpandMore as ExpandMoreIcon,
  Schedule as ScheduleIcon,
  History as HistoryIcon,
  ArrowForward as ArrowForwardIcon
} from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import paymentSettlementService from '../../services/paymentSettlementService';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import { formatPKR } from '../../utils/currency';
import toast from 'react-hot-toast';
import WorkflowHistoryDialog from '../../components/WorkflowHistoryDialog';
import { DigitalSignatureImage, ProcurementDigitalSignaturesRow } from '../../components/common/DigitalSignatureImage';
import CashApprovalDetailTabsView from '../../components/Procurement/CashApprovalDetailTabsView';
import CashApprovalGeneralDetailShell from '../../components/CashApprovals/CashApprovalGeneralDetailShell';
import { isGeneralModuleCashApproval } from '../../components/CashApprovals/cashApprovalGeneralDocumentUtils';
import ComparativeStatementView from '../../components/Procurement/ComparativeStatementView';
import StoreVettingNotice from '../../components/Procurement/StoreVettingNotice';
import { WorkflowAuditFeedbackPanel } from '../../components/Admin/workflowAuditReturn';
import { formatDateTime } from '../../utils/dateUtils';
import IpcReviewDialog from '../../components/ProjectManagement/IpcReviewDialog';
import { formatPurchaseOrderCostCenter } from '../../utils/purchaseOrderAuthority';
import { PO_A4_ONE_PAGE_PRINT_CSS, printPoFitToOneA4 } from '../../utils/poA4PrintStyles';

const Payments = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const getAutoDigitalSignature = () =>
    user?.digitalSignature ||
    (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : '') ||
    user?.email ||
    'CEO';


  const getInitialTab = () => {
    const t = searchParams.get('tab');
    if (t === 'forwarded' || t === 'forwarded_to_ceo' || t === '1') return 1;
    if (t === 'returned' || t === '2') return 2;
    if (t === 'approved' || t === '3') return 3;
    if (t === 'rejected' || t === '4') return 4;
    return 0;
  };
  
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [departments, setDepartments] = useState([]);
  const [tabValue, setTabValue] = useState(getInitialTab);
  const [canApproveAsCeo, setCanApproveAsCeo] = useState(false);
  
  // Dialog states
  const [viewDialog, setViewDialog] = useState({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 });
  const [imageViewer, setImageViewer] = useState({ open: false, imageUrl: '', imageName: '', isBlob: false });
  const [approveDialog, setApproveDialog] = useState({ open: false, settlement: null });
  // Project Management subcontractor IPC opened for review
  const [ipcReviewId, setIpcReviewId] = useState(null);
  const [rejectDialog, setRejectDialog] = useState({ open: false, settlement: null });
  const [returnDialog, setReturnDialog] = useState({ open: false, settlement: null });
  const [workflowHistoryDialog, setWorkflowHistoryDialog] = useState({ open: false, settlement: null });
  
  // Form states
  const [approvalComments, setApprovalComments] = useState('');
  const [approvalAgree, setApprovalAgree] = useState(false);
  const [rejectionComments, setRejectionComments] = useState('');
  const [rejectionAgree, setRejectionAgree] = useState(false);
  const [rejectObservations, setRejectObservations] = useState([{ observation: '', severity: 'medium' }]);
  const [returnComments, setReturnComments] = useState('');
  const [returnAgree, setReturnAgree] = useState(false);
  const [returnObservations, setReturnObservations] = useState([{ observation: '', severity: 'medium' }]);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t) {
      if (t === 'forwarded' || t === 'forwarded_to_ceo' || t === '1') {
        setTabValue(1);
      } else if (t === 'pending' || t === '0') {
        setTabValue(0);
      } else if (t === 'returned' || t === '2') {
        setTabValue(2);
      } else if (t === 'approved' || t === '3') {
        setTabValue(3);
      } else if (t === 'rejected' || t === '4') {
        setTabValue(4);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    fetchSettlements();
    fetchDepartments();
  }, [page, rowsPerPage, searchQuery, departmentFilter, tabValue]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/executive/me');
        if (!cancelled) {
          setCanApproveAsCeo(Boolean(res.data?.data?.canApproveAsCeo ?? res.data?.data?.isDesignatedCeo));
        }
      } catch {
        if (!cancelled) setCanApproveAsCeo(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchDepartments = async () => {
    try {
      const response = await api.get('/hr/departments');
      setDepartments(response.data.data || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const fetchSettlements = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        search: searchQuery || undefined,
        fromDepartment: departmentFilter || undefined
      };

      // Fetch payment settlements, purchase orders, and cash approvals for CEO Secretariat in parallel
      const [settlementsRes, poRes, caRes, ipcRes] = await Promise.all([
        paymentSettlementService.getPaymentSettlements(params),
        api.get('/procurement/purchase-orders/ceo-secretariat').catch(() => ({ data: { data: [] } })),
        api.get('/cash-approvals/ceo-secretariat').catch(() => ({ data: { data: [] } })),
        api.get('/project-management/ipcs/ceo-secretariat').catch(() => ({ data: { data: [] } }))
      ]);
      let allSettlements = settlementsRes.data?.settlements || [];
      const poList = poRes.data?.data || [];
      const poFormatted = poList.map(po => ({
        _id: po._id,
        workflowStatus: po.status,
        isPurchaseOrder: true,
        referenceNumber: po.orderNumber,
        date: po.orderDate,
        toWhomPaid: po.vendor?.name,
        forWhat: po.notes || 'Purchase Order',
        amount: po.totalAmount,
        grandTotal: po.totalAmount,
        fromDepartment: 'Procurement',
        ...po
      }));
      const caList = caRes.data?.data || [];
      const caFormatted = caList.map((ca) => ({
        _id: ca._id,
        workflowStatus: ca.status,
        isCashApproval: true,
        referenceNumber: ca.caNumber,
        date: ca.approvalDate || ca.createdAt,
        toWhomPaid: ca.vendor?.name,
        forWhat: ca.notes || 'Cash Approval',
        amount: ca.totalAmount,
        grandTotal: ca.totalAmount,
        fromDepartment: ca.originatingModule === 'general' ? 'General' : 'Procurement',
        ...ca
      }));
      // Project Management subcontractor IPCs (audit-approved → PS forwards → CEO)
      const ipcFormatted = (ipcRes.data?.data || []).map((ipc) => ({
        ...ipc,
        _id: ipc._id,
        workflowStatus: ipc.approvalStatus,
        isProjectIpc: true,
        itemType: 'Subcontractor IPC',
        referenceNumber: `IPC #${ipc.ipcNumber} · ${ipc.invoiceNumber}`,
        date: ipc.auditApprovedAt || ipc.updatedAt,
        toWhomPaid: ipc.contractor?.name,
        forWhat: [ipc.project?.parentProject?.name, ipc.project?.name].filter(Boolean).join(' / ') || 'Subcontractor IPC',
        amount: ipc.netPayableAmount || ipc.invoiceAmount,
        grandTotal: ipc.netPayableAmount || ipc.invoiceAmount,
        fromDepartment: 'Project Management'
      }));
      allSettlements = [...allSettlements, ...poFormatted, ...caFormatted, ...ipcFormatted];
      
      // Client-side filtering based on tab with proper status categorization
      // Document Flow Logic:
      // - Pending: Documents with "Send to CEO Office" status (waiting for action)
      // - Forwarded: Documents with "Forwarded to CEO" status (forwarded to CEO for review)
      // - Returned: Documents with "Returned from CEO Office" status (returned with observations)
      // - Approved: Documents with "Approved" or "Approved (from Send to CEO Office)" status
      // - Rejected: Documents with "Rejected" or "Rejected (from Send to CEO Office)" status
      // Note: When a returned document is resubmitted (status changes to "Send to CEO Office" or any department),
      // it will appear in Pending tab again if it reaches "Send to CEO Office"
      let filteredSettlements = allSettlements;
      if (tabValue === 0) {
        // Pending - Show "Send to CEO Office" status (exact match, not approved/rejected variants)
        filteredSettlements = allSettlements.filter(s => {
          const status = s.workflowStatus || '';
          // Must be exactly "Send to CEO Office" (includes resubmitted documents that reached CEO Office again)
          return status === 'Send to CEO Office';
        });
      } else if (tabValue === 1) {
        // Forwarded - Show "Forwarded to CEO" status
        filteredSettlements = allSettlements.filter(s => {
          const status = s.workflowStatus || '';
          return status === 'Forwarded to CEO';
        });
      } else if (tabValue === 2) {
        // Returned - Show "Returned from CEO Office" status
        filteredSettlements = allSettlements.filter(s => {
          const status = s.workflowStatus || '';
          return status === 'Returned from CEO Office';
        });
      } else if (tabValue === 3) {
        // Approved — workflow docs use "Approved (from …)"; cash approvals use Pending Finance+ after CEO sign-off
        filteredSettlements = allSettlements.filter((s) => {
          const status = s.workflowStatus || '';
          if (s.isProjectIpc) return status === 'Approved';
          if (s.isCashApproval) {
            return [
              'Pending Finance',
              'Finance Authority Approved',
              'Advance Issued',
              'Evidence Submitted',
              'Payment Settled',
              'Sent to Procurement',
              'Completed'
            ].includes(status);
          }
          return (
            status === 'Approved (from Send to CEO Office)' ||
            status === 'Approved (from Forwarded to CEO)' ||
            (status.startsWith('Approved (from') &&
              (status.includes('Send to CEO Office') || status.includes('Forwarded to CEO')))
          );
        });
      } else if (tabValue === 4) {
        // Rejected - Show only documents rejected from "Send to CEO Office" or "Forwarded to CEO"
        // Must be "Rejected (from Send to CEO Office)" or "Rejected (from Forwarded to CEO)" - not rejected from other departments
        filteredSettlements = allSettlements.filter(s => {
          const status = s.workflowStatus || '';
          if (s.isProjectIpc) return status === 'Rejected' && ['Send to CEO Office', 'Forwarded to CEO'].includes(s.returnedFromStatus);
          // Only show if it's rejected from Send to CEO Office or Forwarded to CEO
          return status === 'Rejected (from Send to CEO Office)' || 
                 status === 'Rejected (from Forwarded to CEO)' ||
                 (status.startsWith('Rejected (from') && (status.includes('Send to CEO Office') || status.includes('Forwarded to CEO')));
        });
      }
      
      setSettlements(filteredSettlements);
      setTotalCount(filteredSettlements.length);
    } catch (error) {
      console.error('Error fetching payments:', error);
      setError(error.response?.data?.message || 'Failed to fetch payments');
    } finally {
      setLoading(false);
    }
  };

  const withCeoDocTypeFlags = (doc, flags = {}) => {
    if (!doc) return doc;
    const isPurchaseOrder =
      Boolean(flags.isPurchaseOrder) ||
      Boolean(doc.isPurchaseOrder) ||
      Boolean(doc.orderNumber) ||
      doc.itemType === 'Purchase Order';
    const isCashApproval =
      Boolean(flags.isCashApproval) ||
      Boolean(doc.isCashApproval) ||
      Boolean(doc.caNumber) ||
      doc.itemType === 'Cash Approval';
    return {
      ...doc,
      isPurchaseOrder,
      isCashApproval,
      workflowStatus: doc.workflowStatus || doc.status,
      itemType: isPurchaseOrder
        ? 'Purchase Order'
        : isCashApproval
          ? 'Cash Approval'
          : doc.isProjectIpc
            ? 'Subcontractor IPC'
            : doc.itemType || 'Payment Settlement'
    };
  };

  const openApproveDialog = (settlement, flags = {}) => {
    setApproveDialog({ open: true, settlement: withCeoDocTypeFlags(settlement, flags) });
    setApprovalComments('');
    setApprovalAgree(false);
  };

  const openRejectDialog = (settlement, flags = {}) => {
    setRejectDialog({ open: true, settlement: withCeoDocTypeFlags(settlement, flags) });
    setRejectionComments('');
    setRejectionAgree(false);
    setRejectObservations([{ observation: '', severity: 'medium' }]);
  };

  const openReturnDialog = (settlement, flags = {}) => {
    setReturnDialog({ open: true, settlement: withCeoDocTypeFlags(settlement, flags) });
    setReturnComments('');
    setReturnAgree(false);
    setReturnObservations([{ observation: '', severity: 'medium' }]);
  };

  /** Project Management IPC actions on this desk: PS forwards / rejects; CEO approves / rejects (returns = reject to initiator) */
  const handleIpcAction = async (doc, kind, comments, observations) => {
    const isCeoStage = doc.workflowStatus === 'Forwarded to CEO';
    const url = kind === 'approve'
      ? (isCeoStage ? 'ceo-approve' : 'forward-to-ceo')
      : (isCeoStage ? 'ceo-reject' : 'ceo-secretariat-reject');
    try {
      setActionLoading(true);
      setError(null);
      const res = await api.put(`/project-management/ipcs/${doc._id}/${url}`, {
        comments,
        rejectionComments: comments,
        digitalSignature: getAutoDigitalSignature(),
        observations: observations && observations.length ? observations : undefined
      });
      toast.success(res.data?.message || 'IPC updated');
      fetchSettlements();
      return true;
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to process IPC');
      toast.error(error.response?.data?.message || 'Failed to process IPC');
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const handleForward = async () => {
    if (!approvalAgree) {
      toast.error('Please agree to terms');
      return;
    }

    const isForwardedToCeo = approveDialog.settlement?.workflowStatus === 'Forwarded to CEO';
    const isCashApproval = approveDialog.settlement?.isCashApproval;

    const effectiveSignature = getAutoDigitalSignature();
    if (isForwardedToCeo && !isCashApproval && !effectiveSignature) {
      toast.error('No digital signature on your profile. Please add one in Profile settings.');
      return;
    }

    if (approveDialog.settlement?.isProjectIpc) {
      if (await handleIpcAction(approveDialog.settlement, 'approve', approvalComments)) {
        setApproveDialog({ open: false, settlement: null });
        setApprovalComments('');
        setApprovalAgree(false);
      }
      return;
    }

    if (approveDialog.settlement?.isPurchaseOrder) {
      try {
        setActionLoading(true);
        setError(null);
        if (isForwardedToCeo) {
          const response = await api.put(`/procurement/purchase-orders/${approveDialog.settlement._id}/ceo-approve`, {
            approvalComments,
            digitalSignature: effectiveSignature
          });
          let successMessage = 'Purchase order approved by CEO successfully';
          if (response.data?.sentToFinance) {
            successMessage = 'Purchase order approved by CEO and sent to Finance (advance terms)';
          } else if (response.data?.accountsPayableCreated) {
            successMessage += ' and added to Accounts Payable';
          }
          toast.success(successMessage);
        } else {
          await api.put(`/procurement/purchase-orders/${approveDialog.settlement._id}/forward-to-ceo`, {
            comments: approvalComments
          });
          toast.success('Purchase order forwarded to CEO successfully');
        }
        setApproveDialog({ open: false, settlement: null });
        setApprovalComments('');
        setApprovalAgree(false);
        fetchSettlements();
      } catch (error) {
        setError(error.response?.data?.message || 'Failed to process purchase order');
        toast.error(error.response?.data?.message || 'Failed to process purchase order');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    if (approveDialog.settlement?.isCashApproval) {
      try {
        setActionLoading(true);
        setError(null);
        if (isForwardedToCeo) {
          await api.put(`/cash-approvals/${approveDialog.settlement._id}/ceo-approve`, {
            comments: approvalComments,
            approvalComments,
            digitalSignature: effectiveSignature
          });
          toast.success('Cash approval approved by CEO and sent to Finance');
        } else {
          await api.put(`/cash-approvals/${approveDialog.settlement._id}/forward-to-ceo`, {
            comments: approvalComments
          });
          toast.success('Cash approval forwarded to CEO successfully');
        }
        setApproveDialog({ open: false, settlement: null });
        setApprovalComments('');
        setApprovalAgree(false);
        fetchSettlements();
      } catch (error) {
        setError(error.response?.data?.message || 'Failed to process cash approval');
        toast.error(error.response?.data?.message || 'Failed to process cash approval');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      
      if (isForwardedToCeo) {
        const response = await paymentSettlementService.approvePayment(approveDialog.settlement._id, {
          comments: approvalComments || 'Approved by CEO',
          digitalSignature: effectiveSignature
        });
        let successMessage = 'Payment approved successfully';
        if (response.data?.accountsPayableCreated) {
          successMessage += ' and added to Accounts Payable';
        }
        toast.success(successMessage);
      } else {
        await paymentSettlementService.updateWorkflowStatus(approveDialog.settlement._id, {
          workflowStatus: 'Forwarded to CEO',
          comments: approvalComments || 'Forwarded to CEO'
        });
        toast.success('Payment forwarded to CEO successfully');
      }
      
      setApproveDialog({ open: false, settlement: null });
      setApprovalComments('');
      setApprovalAgree(false);
      fetchSettlements();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to process payment');
      toast.error(error.response?.data?.message || 'Failed to process payment');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionAgree || !rejectionComments.trim()) {
      toast.error('Please provide comments and agree to terms');
      return;
    }
    const effectiveSignature = getAutoDigitalSignature();
    if (!effectiveSignature) {
      toast.error('No digital signature on your profile. Please add one in Profile settings.');
      return;
    }

    const observations = rejectObservations
      .filter(obs => obs.observation.trim())
      .map(obs => ({
        observation: obs.observation,
        severity: obs.severity
      }));

    const isForwardedToCeo = rejectDialog.settlement?.workflowStatus === 'Forwarded to CEO';

    if (rejectDialog.settlement?.isProjectIpc) {
      if (await handleIpcAction(rejectDialog.settlement, 'reject', rejectionComments, observations)) {
        setRejectDialog({ open: false, settlement: null });
        setRejectionComments('');
        setRejectionAgree(false);
        setRejectObservations([{ observation: '', severity: 'medium' }]);
      }
      return;
    }

    if (rejectDialog.settlement?.isPurchaseOrder) {
      try {
        setActionLoading(true);
        setError(null);
        const endpoint = isForwardedToCeo
          ? `/procurement/purchase-orders/${rejectDialog.settlement._id}/ceo-reject`
          : `/procurement/purchase-orders/${rejectDialog.settlement._id}/ceo-secretariat-reject`;

        await api.put(endpoint, {
          rejectionComments,
          digitalSignature: effectiveSignature,
          observations: observations.length > 0 ? observations : undefined
        });
        toast.success('Purchase order rejected successfully');
        setRejectDialog({ open: false, settlement: null });
        setRejectionComments('');
        setRejectionAgree(false);
        setRejectObservations([{ observation: '', severity: 'medium' }]);
        fetchSettlements();
      } catch (error) {
        setError(error.response?.data?.message || 'Failed to reject purchase order');
        toast.error(error.response?.data?.message || 'Failed to reject purchase order');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    if (rejectDialog.settlement?.isCashApproval) {
      try {
        setActionLoading(true);
        setError(null);
        const endpoint = isForwardedToCeo
          ? `/cash-approvals/${rejectDialog.settlement._id}/ceo-reject`
          : `/cash-approvals/${rejectDialog.settlement._id}/ceo-secretariat-reject`;

        await api.put(endpoint, {
          rejectionComments,
          comments: rejectionComments,
          digitalSignature: effectiveSignature,
          observations: observations.length > 0 ? observations : undefined
        });
        toast.success('Cash approval rejected successfully');
        setRejectDialog({ open: false, settlement: null });
        setRejectionComments('');
        setRejectionAgree(false);
        setRejectObservations([{ observation: '', severity: 'medium' }]);
        fetchSettlements();
      } catch (error) {
        setError(error.response?.data?.message || 'Failed to reject cash approval');
        toast.error(error.response?.data?.message || 'Failed to reject cash approval');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      
      await paymentSettlementService.rejectPayment(rejectDialog.settlement._id, {
        comments: rejectionComments,
        observations: observations.length > 0 ? observations : undefined,
        digitalSignature: effectiveSignature
      });
      
      toast.success('Payment rejected successfully');
      setRejectDialog({ open: false, settlement: null });
      setRejectionComments('');
      setRejectionAgree(false);
      setRejectObservations([{ observation: '', severity: 'medium' }]);
      fetchSettlements();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to reject payment');
      toast.error(error.response?.data?.message || 'Failed to reject payment');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!returnAgree || !returnComments.trim()) {
      toast.error('Please provide comments and agree to terms');
      return;
    }
    const effectiveSignature = getAutoDigitalSignature();
    if (!effectiveSignature) {
      toast.error('No digital signature on your profile. Please add one in Profile settings.');
      return;
    }

    const observations = returnObservations
      .filter(obs => obs.observation.trim())
      .map(obs => ({
        observation: obs.observation,
        severity: obs.severity
      }));

    const isForwardedToCeo = returnDialog.settlement?.workflowStatus === 'Forwarded to CEO';

    // IPCs have one way back: rejected to the Project Management initiator, who revises and resubmits
    if (returnDialog.settlement?.isProjectIpc) {
      if (await handleIpcAction(returnDialog.settlement, 'reject', returnComments, observations)) {
        setReturnDialog({ open: false, settlement: null });
        setReturnComments('');
        setReturnAgree(false);
        setReturnObservations([{ observation: '', severity: 'medium' }]);
      }
      return;
    }

    if (returnDialog.settlement?.isPurchaseOrder) {
      try {
        setActionLoading(true);
        setError(null);
        let endpoint = `/procurement/purchase-orders/${returnDialog.settlement._id}/finance-return`;
        if (isForwardedToCeo) {
          endpoint = `/procurement/purchase-orders/${returnDialog.settlement._id}/ceo-return`;
        } else if (returnDialog.settlement?.workflowStatus === 'Send to CEO Office') {
          endpoint = `/procurement/purchase-orders/${returnDialog.settlement._id}/ceo-secretariat-return`;
        }

        await api.put(endpoint, {
          returnComments,
          comments: returnComments,
          digitalSignature: effectiveSignature,
          observations: observations.length > 0 ? observations : undefined
        });
        toast.success('Purchase order returned with observations to Procurement successfully');
        setReturnDialog({ open: false, settlement: null });
        setReturnComments('');
        setReturnAgree(false);
        setReturnObservations([{ observation: '', severity: 'medium' }]);
        fetchSettlements();
      } catch (error) {
        setError(error.response?.data?.message || 'Failed to return purchase order');
        toast.error(error.response?.data?.message || 'Failed to return purchase order');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    if (returnDialog.settlement?.isCashApproval) {
      try {
        setActionLoading(true);
        setError(null);
        const endpoint = isForwardedToCeo
          ? `/cash-approvals/${returnDialog.settlement._id}/ceo-return`
          : `/cash-approvals/${returnDialog.settlement._id}/ceo-secretariat-return`;

        await api.put(endpoint, {
          comments: returnComments,
          returnComments,
          digitalSignature: effectiveSignature,
          observations: observations.length > 0 ? observations : undefined
        });
        toast.success('Cash approval returned with observations successfully');
        setReturnDialog({ open: false, settlement: null });
        setReturnComments('');
        setReturnAgree(false);
        setReturnObservations([{ observation: '', severity: 'medium' }]);
        fetchSettlements();
      } catch (error) {
        setError(error.response?.data?.message || 'Failed to return cash approval');
        toast.error(error.response?.data?.message || 'Failed to return cash approval');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      
      let returnCommentsText = returnComments;
      if (effectiveSignature) {
        returnCommentsText = `${returnCommentsText} [Digital Signature applied from profile]`;
      }
      
      // Use "Returned from CEO Office" status to indicate it's returned with observations
      await paymentSettlementService.updateWorkflowStatus(returnDialog.settlement._id, {
        workflowStatus: 'Returned from CEO Office',
        comments: returnCommentsText
      });
      
      toast.success('Payment returned with observations successfully');
      setReturnDialog({ open: false, settlement: null });
      setReturnComments('');
      setReturnAgree(false);
      setReturnObservations([{ observation: '', severity: 'medium' }]);
      fetchSettlements();
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to return payment');
      toast.error(error.response?.data?.message || 'Failed to return payment');
    } finally {
      setActionLoading(false);
    }
  };

  const addObservation = (type) => {
    if (type === 'reject') {
      setRejectObservations([...rejectObservations, { observation: '', severity: 'medium' }]);
    } else {
      setReturnObservations([...returnObservations, { observation: '', severity: 'medium' }]);
    }
  };

  const removeObservation = (index, type) => {
    if (type === 'reject') {
      setRejectObservations(rejectObservations.filter((_, i) => i !== index));
    } else {
      setReturnObservations(returnObservations.filter((_, i) => i !== index));
    }
  };

  const updateObservation = (index, field, value, type) => {
    if (type === 'reject') {
      const updated = [...rejectObservations];
      updated[index][field] = value;
      setRejectObservations(updated);
    } else {
      const updated = [...returnObservations];
      updated[index][field] = value;
      setReturnObservations(updated);
    }
  };

  const getWorkflowStatusColor = (workflowStatus) => {
    if (!workflowStatus) return 'default';
    if (workflowStatus.includes('Approved')) return 'success';
    if (workflowStatus.includes('Rejected')) return 'error';
    if (workflowStatus.includes('Returned')) return 'warning';
    if (workflowStatus.includes('Send to')) return 'info';
    return 'default';
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format date to match Payment Settlement style (22-Dec-25)
  const userDisplayName = (userObj) => {
    if (!userObj) return '—';
    const name = [userObj.firstName, userObj.lastName].filter(Boolean).join(' ').trim();
    return name || userObj.email || '—';
  };

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

  const handlePrint = () => {
    if (!viewDialog.settlement) return;
    
    const printWindow = window.open('', '_blank');
    const settlement = viewDialog.settlement;
    const printDate = new Date().toLocaleString();
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Payment Settlement Record - ${settlement?.referenceNumber?.trim() || settlement?._id || 'N/A'}</title>
          <style>
            body { font-family: 'Times New Roman', serif; padding: 20px; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .section { margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #000; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; font-weight: bold; }
            .total { text-align: right; font-weight: bold; }
            .signature-section { margin-top: 40px; display: flex; justify-content: space-around; }
            .signature-box { text-align: center; width: 30%; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>PAYMENT SETTLEMENT</h1>
            <div class="subtitle">Reference Number: ${settlement?.referenceNumber?.trim() || settlement?._id || 'N/A'}</div>
          </div>
          <div class="section">
            <table>
              <tr>
                <th>Date</th>
                <th>Reference No</th>
                <th>To Whom Paid</th>
                <th>For What</th>
                <th>Amount</th>
              </tr>
              <tr>
                <td>${formatDateForDocument(settlement?.date)}</td>
                <td>${settlement?.referenceNumber?.trim() || settlement?._id || 'N/A'}</td>
                <td>${settlement?.toWhomPaid || 'N/A'}</td>
                <td>${settlement?.forWhat || 'N/A'}</td>
                <td class="total">${formatPKR(settlement?.amount)}</td>
              </tr>
            </table>
            <div class="total" style="margin-top: 20px;">
              <strong>Grand Total: ${formatPKR(settlement?.grandTotal)}</strong>
            </div>
          </div>
          <div class="signature-section">
            <div class="signature-box">
              <div><strong>Prepared By:</strong></div>
              <div>${settlement?.preparedBy || 'N/A'}</div>
              <div>${settlement?.preparedByDesignation || ''}</div>
            </div>
            <div class="signature-box">
              <div><strong>Verified By:</strong></div>
              <div>${settlement?.verifiedBy || 'N/A'}</div>
              <div>${settlement?.verifiedByDesignation || ''}</div>
            </div>
            <div class="signature-box">
              <div><strong>Approved by:</strong></div>
              <div>${settlement?.approvedBy || 'N/A'}</div>
              <div>${settlement?.approvedByDesignation || ''}</div>
            </div>
          </div>
          <div style="margin-top: 40px; font-size: 12px; color: #666;">
            <p>Generated from SGC ERP System - Payment Settlement Module</p>
            <p>Printed: ${printDate}</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
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
    if (num === null || num === undefined || isNaN(num)) return '0';
    return Math.round(Number(num)).toLocaleString();
  };

  const getCompanyDisplay = (item) => {
    if (!item) return '—';
    if (typeof item.parentCompanyName === 'string' && item.parentCompanyName.trim()) {
      return item.parentCompanyName.trim();
    }
    if (typeof item.company === 'string' && item.company.trim()) {
      return item.company.trim();
    }
    if (item.company && typeof item.company === 'object' && item.company.name) {
      return item.company.name.trim();
    }
    if (typeof item.companyName === 'string' && item.companyName.trim()) {
      return item.companyName.trim();
    }
    if (item.placementCompany && typeof item.placementCompany === 'object' && item.placementCompany.name) {
      return item.placementCompany.name.trim();
    }
    if (typeof item.subsidiaryName === 'string' && item.subsidiaryName.trim()) {
      return item.subsidiaryName.trim();
    }
    if (item.indent?.company) {
      if (typeof item.indent.company === 'string' && item.indent.company.trim()) {
        return item.indent.company.trim();
      }
      if (typeof item.indent.company === 'object' && item.indent.company.name) {
        return item.indent.company.name.trim();
      }
    }
    if (typeof item.indent?.companyName === 'string' && item.indent.companyName.trim()) {
      return item.indent.companyName.trim();
    }
    return '—';
  };
  // Purchase Order View Component
  const theme = useTheme();
  const PurchaseOrderView = ({ poData }) => {
    const observations = (poData?.auditObservations && poData.auditObservations.length > 0)
      ? poData.auditObservations
      : (poData?.auditRejectObservations || []).map((obs, idx) => ({
          observation: typeof obs === 'object' ? obs.observation : obs,
          severity: typeof obs === 'object' ? (obs.severity || 'medium') : 'medium',
          addedBy: poData.auditRejectedBy,
          addedAt: poData.auditRejectedAt,
          answer: null,
          answeredBy: null,
          answeredAt: null,
          resolved: false
        }));
    const hasObservations = Array.isArray(observations) && observations.length > 0;
    const hasChangeSummary = poData?.resubmissionChangeSummary && String(poData.resubmissionChangeSummary).trim().length > 0;
    const auth = poData?.approvalAuthorities || {};
    const formatDateTime = (date) => {
      if (!date) return '—';
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

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

        {/* Audit Observations & Procurement Responses - show when PO has observations (e.g. after pre-audit) */}
        {hasObservations && (
          <Box sx={{ mb: 3, p: 2, bgcolor: alpha(theme.palette.warning.main, 0.08), border: '1px solid', borderColor: 'warning.main', borderRadius: 1 }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'warning.dark', fontWeight: 'bold' }}>
              Audit Observations &amp; Procurement Responses
            </Typography>
            {poData.auditReturnComments && (
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
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Observation {index + 1}</Typography>
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
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: obs.answer ? 1.5 : 0 }}>{obs.observation}</Typography>
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
        )}

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
            <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.6, mb: 1 }}>
              {poData.vendor?.address || 'Vendor Address'}
            </Typography>
            {(poData.vendor?.ntnCnic || poData.vendor?.ntnNo || poData.vendor?.cnic) && (
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, mb: 1.5, color: 'text.secondary' }}>
                ntn / cnic : {poData.vendor.ntnCnic || poData.vendor.ntnNo || poData.vendor.cnic}
              </Typography>
            )}
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
              <Typography component="span">{poData.shippingAddress ? 
                `${poData.shippingAddress.street || ''} ${poData.shippingAddress.city || ''}`.trim() || '___________' 
                : '___________'}</Typography>
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
                      {item.specification || poData.indent?.items?.[index]?.specification || '___________'}
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
              <Typography component="span" fontWeight={600}>Subtotal:</Typography>
              <Typography component="span">{formatNumber(Math.round(Number(poData.subtotal || poData.totalAmount || 0)))}</Typography>
            </Box>
            {Number(poData.taxAmount) > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography component="span" fontWeight={600}>Tax:</Typography>
                <Typography component="span">{formatNumber(Math.round(Number(poData.taxAmount)))}</Typography>
              </Box>
            )}
            {Number(poData.shippingCost) > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography component="span" fontWeight={600}>Freight Charges:</Typography>
                <Typography component="span">{formatNumber(Math.round(Number(poData.shippingCost)))}</Typography>
              </Box>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography component="span" fontWeight={600}>Total Amount:</Typography>
              <Typography component="span" fontWeight={700}>{formatNumber(Math.round(Number(poData.totalAmount || 0)))}</Typography>
            </Box>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, fontStyle: 'italic', mt: 1 }}>
              Rupees {numberToWords(Math.round(Number(poData.totalAmount || 0)))}
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

        {/* Approval/Signature Section - Procurement style approval progress */}
        <Box sx={{ mt: 4 }}>
          <StoreVettingNotice indent={poData?.indent} sx={{ mb: 0.75, '@media print': { mb: 0.3 } }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, '@media print': { mb: 0.5, fontSize: '11px' } }}>
            Approval Progress
          </Typography>
          {(() => {
            const indent = poData?.indent || {};
            const approvals = indent?.comparativeStatementApprovals || {};
            const approvalSteps = Array.isArray(indent?.comparativeApproval?.approvers)
              ? indent.comparativeApproval.approvers
              : [];
            const stepByUserId = new Map(
              approvalSteps.map((s) => [String(s?.approver?._id || s?.approver || ''), s])
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
            const rows = [
              {
                key: 'preparedBy',
                label: 'Prepared By',
                user: approvals.preparedByUser,
                fallback: poData.approvalAuthorities?.preparedBy || approvals.preparedBy || auth.preparedBy || ''
              },
              {
                key: 'managerProcurement',
                label: 'Manager Procurement',
                user: approvals.managerProcurementUser,
                fallback: poData.approvalAuthorities?.managerProcurement || approvals.managerProcurement || auth.managerProcurement || ''
              },
              ...((poData.approvalAuthorities?.srManagerProcurement || auth.srManagerProcurement) ? [{
                key: 'srManagerProcurement',
                label: 'Sr Manager Procurement',
                user: null,
                fallback: poData.approvalAuthorities?.srManagerProcurement || auth.srManagerProcurement || ''
              }] : []),
              {
                key: 'chiefOperatingOfficer',
                label: 'Chief operating officer',
                user: null,
                fallback: poData.approvalAuthorities?.chiefOperatingOfficer || poData.approvalAuthorities?.verifiedBy || approvals.verifiedBy || auth.verifiedBy || ''
              },
              {
                key: 'avpTaj',
                label: 'AVP Taj',
                user: null,
                fallback: poData.approvalAuthorities?.avpTaj || poData.approvalAuthorities?.authorisedRep || approvals.authorisedRep || auth.authorisedRep || ''
              },
              ...(poData.approvalAuthorities?.technicalDepartment || auth.technicalDepartment ? [{
                key: 'technicalDepartment',
                label: 'Technical Department',
                user: null,
                fallback: poData.approvalAuthorities?.technicalDepartment || auth.technicalDepartment || ''
              }] : []),
              {
                key: 'preAuditInitial',
                label: 'Pre-Audit Initial Approval',
                directApproval: true,
                approver: poData.preAuditInitialApprovedBy || null,
                approvedAt: poData.preAuditInitialApprovedAt || null,
                fallback: ''
              },
              {
                key: 'auditDirectorApproval',
                label: 'Audit Final Approval',
                directApproval: true,
                approver: poData.auditApprovedBy || null,
                approvedAt: poData.auditApprovedAt || null,
                fallback: ''
              },
              {
                key: 'ceoSecretariatForward',
                label: 'CEO Secretariat',
                directApproval: true,
                approver: poData.ceoForwardedBy || null,
                approvedAt: poData.ceoForwardedAt || null,
                fallback: ''
              },
              {
                key: 'ceoApproval',
                label: 'CEO Approval',
                directApproval: true,
                approver: poData.ceoApprovedBy || null,
                approvedAt: poData.ceoApprovedAt || null,
                fallback: ''
              }
            ];
            const authorityApprovals = Array.isArray(poData?.authorityApprovals) ? poData.authorityApprovals : [];
            const byKey = new Map(
              authorityApprovals
                .map((a) => [String(a?.authorityKey || '').trim(), a])
                .filter(([k]) => Boolean(k))
            );
            return (
              <TableContainer component={Box} sx={{ border: '1px solid', borderColor: 'divider' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.100' }}>
                      <TableCell sx={{ fontWeight: 700 }}>Authority</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Digital Signature</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Date & Time</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const uid = String(row?.user?._id || row?.user || '');
                      const step = uid ? stepByUserId.get(uid) : null;
                      const explicitApproval = row?.key ? byKey.get(row.key) : null;
                      const approvalUser = row?.directApproval
                        ? row.approver
                        : (explicitApproval?.approver && typeof explicitApproval.approver === 'object'
                          ? explicitApproval.approver
                          : step?.approver && typeof step.approver === 'object'
                            ? step.approver
                            : row.user);
                      const approvedAt = row?.directApproval
                        ? (row.approvedAt || null)
                        : (explicitApproval?.approvedAt || step?.actedAt || null);
                      const isApproved = Boolean(approvedAt);
                      const displayAuthorityName = explicitApproval?.approver
                        ? ([explicitApproval.approver.firstName, explicitApproval.approver.lastName].filter(Boolean).join(' ').trim() || explicitApproval.approver.email || row.fallback || '—')
                        : personName(approvalUser, row.fallback);
                      return (
                        <TableRow key={row.key || row.label}>
                          <TableCell sx={{ fontWeight: 600 }}>{row.label}</TableCell>
                          <TableCell>{displayAuthorityName}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={isApproved ? 'Approved' : 'Pending'}
                              color={isApproved ? 'success' : 'warning'}
                              variant={isApproved ? 'filled' : 'outlined'}
                            />
                          </TableCell>
                          <TableCell>
                            {isApproved && approvalUser?.digitalSignature ? (
                              <DigitalSignatureImage userOrPath={approvalUser} alt={`${row.label} signature`} />
                            ) : isApproved ? (
                              <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">—</Typography>
                            )}
                          </TableCell>
                          <TableCell>{formatDateTime(approvedAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            );
          })()}
          <ProcurementDigitalSignaturesRow purchaseOrder={poData} />
        </Box>
      </Paper>
    );
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          Payments
        </Typography>
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

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search payments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Department</InputLabel>
                <Select
                  value={departmentFilter}
                  label="Department"
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                >
                  <MenuItem value="">All Departments</MenuItem>
                  {departments.map((dept) => (
                    <MenuItem key={dept._id} value={dept.name}>
                      {dept.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>

          <Tabs value={tabValue} onChange={(e, newValue) => {
            setTabValue(newValue);
            setPage(0);
          }} sx={{ mb: 2 }}>
            <Tab label="Pending" />
            <Tab label="Forwarded" />
            <Tab label="Returned" />
            <Tab label="Approved" />
            <Tab label="Rejected" />
          </Tabs>

          {loading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : settlements.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No payments found
              </Typography>
            </Box>
          ) : (() => {
            // Group settlements by department, then month + year
            const groupedData = settlements.reduce((acc, settlement) => {
              const dept = settlement.fromDepartment || 'Other';
              const date = new Date(settlement.date || settlement.createdAt);
              const year = date.getFullYear();
              const month = date.toLocaleString('default', { month: 'long' }); // e.g., "January"
              const monthNum = date.getMonth(); // 0-11 for sorting
              const monthYearKey = `${month} ${year}`; // e.g., "December 2025"
              const sortKey = `${year}-${String(monthNum).padStart(2, '0')}`; // For sorting: "2025-11"
              
              if (!acc[dept]) {
                acc[dept] = {};
              }
              if (!acc[dept][monthYearKey]) {
                acc[dept][monthYearKey] = { sortKey, settlements: [] };
              }
              acc[dept][monthYearKey].settlements.push(settlement);
              return acc;
            }, {});

            return (
              <Box>
                {Object.entries(groupedData).map(([department, monthYears]) => {
                  const totalSettlements = Object.values(monthYears).reduce((sum, m) => sum + m.settlements.length, 0);

                  return (
                    <Accordion key={department} defaultExpanded sx={{ mb: 2 }}>
                      <AccordionSummary
                        expandIcon={<ExpandMoreIcon />}
                        sx={{
                          backgroundColor: '#f5f5f5',
                          '&:hover': {
                            backgroundColor: '#eeeeee'
                          }
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                          <BusinessIcon color="primary" />
                          <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {department}
                          </Typography>
                          <Chip
                            label={`${totalSettlements} payment${totalSettlements !== 1 ? 's' : ''}`}
                            size="small"
                            color="primary"
                            sx={{ ml: 'auto' }}
                          />
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails sx={{ p: 0 }}>
                        <Box>
                          {Object.entries(monthYears)
                            .sort(([, a], [, b]) => b.sortKey.localeCompare(a.sortKey)) // Sort by year-month descending (newest first)
                            .map(([monthYear, { settlements: monthSettlements }]) => (
                              <Accordion key={`${department}-${monthYear}`} defaultExpanded sx={{ mb: 1, boxShadow: 'none', border: '1px solid #e0e0e0' }}>
                                <AccordionSummary
                                  expandIcon={<ExpandMoreIcon />}
                                  sx={{
                                    backgroundColor: '#fafafa',
                                    '&:hover': {
                                      backgroundColor: '#f5f5f5'
                                    },
                                    pl: 3
                                  }}
                                >
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                                    <ScheduleIcon color="secondary" />
                                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                      {monthYear}
                                    </Typography>
                                    <Chip
                                      label={`${monthSettlements.length} payment${monthSettlements.length !== 1 ? 's' : ''}`}
                                      size="small"
                                      color="secondary"
                                      sx={{ ml: 'auto' }}
                                    />
                                  </Box>
                                </AccordionSummary>
                                <AccordionDetails sx={{ p: 0 }}>
                                  <TableContainer component={Paper} variant="outlined">
                                    <Table>
                                      <TableHead>
                                        <TableRow sx={{ background: '#fafafa' }}>
                                          <TableCell sx={{ fontWeight: 700 }}>Reference No</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Company</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>To Whom Paid</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Amount</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {monthSettlements.map((settlement) => (
                                          <TableRow key={settlement._id} hover>
                                            <TableCell>{settlement.referenceNumber?.trim() || settlement._id || 'N/A'}</TableCell>
                                            <TableCell>
                                              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                                                {getCompanyDisplay(settlement)}
                                              </Typography>
                                            </TableCell>
                                            <TableCell>{settlement.toWhomPaid || 'N/A'}</TableCell>
                                            <TableCell sx={{ fontWeight: 600 }}>
                                              {formatPKR(settlement.grandTotal || settlement.amount)}
                                            </TableCell>
                                            <TableCell>{formatDateForDocument(settlement.date)}</TableCell>
                                            <TableCell>
                                              <Chip
                                                label={settlement.workflowStatus || 'Draft'}
                                                color={getWorkflowStatusColor(settlement.workflowStatus)}
                                                size="small"
                                              />
                                            </TableCell>
                                            <TableCell>
                                              <Stack direction="row" spacing={1}>
                                                <Tooltip title="View Details">
                                                  <IconButton
                                                    size="small"
                                                    onClick={async () => {
                                                      if (settlement.isProjectIpc) {
                                                        setIpcReviewId(settlement._id);
                                                        return;
                                                      }
                                                      if (settlement.isPurchaseOrder) {
                                                        try {
                                                          const r = await api.get(`/procurement/purchase-orders/${settlement._id}`);
                                                          const d = withCeoDocTypeFlags({ ...settlement, ...(r.data?.data || {}) }, { isPurchaseOrder: true });
                                                          const indentId = d?.indent?._id || d?.indent;
                                                          const [qRes, grnRes] = await Promise.all([
                                                            indentId
                                                              ? api.get(`/procurement/quotations/by-indent/${indentId}`).catch(() => ({ data: { data: [] } }))
                                                              : Promise.resolve({ data: { data: [] } }),
                                                            api.get('/procurement/goods-receive', { params: { purchaseOrder: d._id, limit: 100 } }).catch(() => ({ data: { data: { receives: [] } } }))
                                                          ]);
                                                          const poQuotations = Array.isArray(qRes?.data?.data) ? qRes.data.data : [];
                                                          const poGrns = Array.isArray(grnRes?.data?.data?.receives) ? grnRes.data.data.receives : [];
                                                          const poLinkedDocs = [];
                                                          const pushDocs = (items = [], source = 'Attachment') => {
                                                            (items || []).forEach((item, idx) => {
                                                              const url = item?.url || '';
                                                              const name = item?.originalName || item?.filename || `Document ${idx + 1}`;
                                                              if (!name && !url) return;
                                                              poLinkedDocs.push({
                                                                id: item?._id || `${source}-${idx}`,
                                                                source,
                                                                name,
                                                                url,
                                                                uploadedAt: item?.uploadedAt || null,
                                                                mimeType: item?.mimeType || ''
                                                              });
                                                            });
                                                          };
                                                          pushDocs(d?.attachments, 'PO Attachment');
                                                          pushDocs(d?.indent?.attachments, 'Indent Attachment');
                                                          poQuotations.forEach((q) => pushDocs(q?.attachments, `Quotation ${q?.quotationNumber || ''}`.trim()));
                                                          setViewDialog({
                                                            open: true,
                                                            settlement: d,
                                                            isPurchaseOrder: true,
                                                            isCashApproval: false,
                                                            poQuotations,
                                                            poGrns,
                                                            poLinkedDocs,
                                                            poAuditTab: 0
                                                          });
                                                        } catch (e) {
                                                          console.error('Error fetching purchase order details:', e);
                                                          const fallback = withCeoDocTypeFlags(settlement, { isPurchaseOrder: true });
                                                          let poQuotations = [];
                                                          const indentId = fallback?.indent?._id || (typeof fallback?.indent === 'string' ? fallback.indent : null);
                                                          if (indentId) {
                                                            try {
                                                              const qRes = await api.get(`/procurement/quotations/by-indent/${indentId}`);
                                                              poQuotations = Array.isArray(qRes?.data?.data) ? qRes.data.data : [];
                                                            } catch (_) { /* ignore */ }
                                                          }
                                                          setViewDialog({
                                                            open: true,
                                                            settlement: fallback,
                                                            isPurchaseOrder: true,
                                                            isCashApproval: false,
                                                            poQuotations,
                                                            poGrns: [],
                                                            poLinkedDocs: [],
                                                            poAuditTab: 0
                                                          });
                                                        }
                                                      } else if (settlement.isCashApproval) {
                                                        try {
                                                          const r = await api.get(`/cash-approvals/${settlement._id}`);
                                                          const d = r.data?.data || settlement;
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
                                                          if (d?.indent?._id) {
                                                            try {
                                                              const qRes = await api.get(`/procurement/quotations/by-indent/${d.indent._id}`);
                                                              if (qRes.data?.success && Array.isArray(qRes.data.data)) {
                                                                quotations = qRes.data.data;
                                                              }
                                                            } catch (_) { /* ignore */ }
                                                          }
                                                          pushDocs(d?.attachments, 'General Attachment');
                                                          pushDocs(d?.purchaseReceipts, 'Purchase Receipt');
                                                          pushDocs(d?.receiptAttachments, 'Settlement Receipt');
                                                          setViewDialog({ open: true, settlement: d, isPurchaseOrder: false, isCashApproval: true, quotations, caLinkedDocs: linkedDocuments, poAuditTab: 0 });
                                                        } catch (e) {
                                                          console.error('Error fetching cash approval details:', e);
                                                          setViewDialog({ open: true, settlement, isPurchaseOrder: false, isCashApproval: true, quotations: [], caLinkedDocs: [], poAuditTab: 0 });
                                                        }
                                                      } else {
                                                        try {
                                                          const response = await paymentSettlementService.getPaymentSettlement(settlement._id);
                                                          const settlementData = response.data.data || response.data;
                                                          // Check if payment settlement is related to a PO
                                                          if (settlementData.isPurchaseOrder || (settlementData.referenceNumber && settlementData.referenceNumber.startsWith('P'))) {
                                                            try {
                                                              let poResponse;
                                                              if (settlementData.isPurchaseOrder && settlement._id) {
                                                                poResponse = await api.get(`/procurement/purchase-orders/${settlement._id}`);
                                                              } else if (settlementData.referenceNumber) {
                                                                const searchResponse = await api.get(`/procurement/purchase-orders?search=${settlementData.referenceNumber}`);
                                                                if (searchResponse.data?.data?.length > 0) {
                                                                  poResponse = await api.get(`/procurement/purchase-orders/${searchResponse.data.data[0]._id}`);
                                                                }
                                                              }
                                                              if (poResponse?.data?.success) {
                                                                const poData = poResponse.data.data;
                                                                const [qRes, grnRes] = await Promise.all([
                                                                  poData?.indent?._id
                                                                    ? api.get(`/procurement/quotations/by-indent/${poData.indent._id}`).catch(() => ({ data: { data: [] } }))
                                                                    : Promise.resolve({ data: { data: [] } }),
                                                                  api.get('/procurement/goods-receive', { params: { purchaseOrder: poData._id, limit: 100 } }).catch(() => ({ data: { data: { receives: [] } } }))
                                                                ]);
                                                                const poQuotations = Array.isArray(qRes?.data?.data) ? qRes.data.data : [];
                                                                const poGrns = Array.isArray(grnRes?.data?.data?.receives) ? grnRes.data.data.receives : [];
                                                                const poLinkedDocs = [];
                                                                const pushDocs = (items = [], source = 'Attachment') => {
                                                                  items.forEach((item, idx) => {
                                                                    const url = item?.url || '';
                                                                    const name = item?.originalName || item?.filename || `Document ${idx + 1}`;
                                                                    if (!name && !url) return;
                                                                    poLinkedDocs.push({
                                                                      id: item?._id || `${source}-${idx}`,
                                                                      source,
                                                                      name,
                                                                      url,
                                                                      uploadedAt: item?.uploadedAt || null,
                                                                      mimeType: item?.mimeType || ''
                                                                    });
                                                                  });
                                                                };
                                                                pushDocs(poData?.attachments, 'PO Attachment');
                                                                pushDocs(poData?.indent?.attachments, 'Indent Attachment');
                                                                poQuotations.forEach((q) => pushDocs(q?.attachments, `Quotation ${q?.quotationNumber || ''}`.trim()));
                                                                setViewDialog({
                                                                  open: true,
                                                                  settlement: poData,
                                                                  isPurchaseOrder: true,
                                                                  isCashApproval: false,
                                                                  poQuotations,
                                                                  poGrns,
                                                                  poLinkedDocs,
                                                                  poAuditTab: 0
                                                                });
                                                              } else {
                                                                setViewDialog({ open: true, settlement: settlementData, isPurchaseOrder: false, isCashApproval: false });
                                                              }
                                                            } catch (poError) {
                                                              setViewDialog({ open: true, settlement: settlementData, isPurchaseOrder: false, isCashApproval: false });
                                                            }
                                                          } else {
                                                            setViewDialog({ open: true, settlement: settlementData, isPurchaseOrder: false, isCashApproval: false });
                                                          }
                                                        } catch (error) {
                                                          console.error('Error fetching settlement details:', error);
                                                          setViewDialog({ open: true, settlement, isPurchaseOrder: false, isCashApproval: false });
                                                        }
                                                      }
                                                    }}
                                                  >
                                                    <ViewIcon fontSize="small" />
                                                  </IconButton>
                                                </Tooltip>

                                                 {/* Forwarded to CEO: CEO actions only (PS can view, not approve) */}
                                                 {settlement.workflowStatus === 'Forwarded to CEO' && canApproveAsCeo && (
                                                   <>
                                                     <Tooltip title="Approve (CEO)">
                                                       <IconButton
                                                         size="small"
                                                         color="success"
                                                         onClick={() => openApproveDialog(settlement)}
                                                       >
                                                         <CheckCircleIcon fontSize="small" />
                                                       </IconButton>
                                                     </Tooltip>
                                                     <Tooltip title="Reject (CEO)">
                                                       <IconButton
                                                         size="small"
                                                         color="error"
                                                         onClick={() => openRejectDialog(settlement)}
                                                       >
                                                         <CancelIcon fontSize="small" />
                                                       </IconButton>
                                                     </Tooltip>
                                                     <Tooltip title="Return with Observations (CEO)">
                                                       <IconButton
                                                         size="small"
                                                         color="warning"
                                                         onClick={() => openReturnDialog(settlement)}
                                                       >
                                                         <WarningIcon fontSize="small" />
                                                       </IconButton>
                                                     </Tooltip>
                                                   </>
                                                 )}

                                                 {/* Send to CEO Office: Secretariat actions (Forward to CEO, Reject, Return with Observations) */}
                                                 {settlement.workflowStatus === 'Send to CEO Office' && (
                                                   <>
                                                     <Tooltip title="Forward to CEO">
                                                       <IconButton
                                                         size="small"
                                                         color="primary"
                                                         onClick={() => openApproveDialog(settlement)}
                                                       >
                                                         <ArrowForwardIcon fontSize="small" />
                                                       </IconButton>
                                                     </Tooltip>
                                                     <Tooltip title="Reject">
                                                       <IconButton
                                                         size="small"
                                                         color="error"
                                                         onClick={() => openRejectDialog(settlement)}
                                                       >
                                                         <CancelIcon fontSize="small" />
                                                       </IconButton>
                                                     </Tooltip>
                                                     <Tooltip title="Return with Observations">
                                                       <IconButton
                                                         size="small"
                                                         color="warning"
                                                         onClick={() => openReturnDialog(settlement)}
                                                       >
                                                         <WarningIcon fontSize="small" />
                                                       </IconButton>
                                                     </Tooltip>
                                                   </>
                                                 )}

                                                  {/* Pending Finance: Return with Observations to Procurement */}
                                                  {['Pending Finance', 'Sent to Finance'].includes(settlement.workflowStatus) && (
                                                    <Tooltip title="Return with Observations to Procurement">
                                                      <IconButton
                                                        size="small"
                                                        color="warning"
                                                        onClick={() => openReturnDialog(settlement)}
                                                      >
                                                        <WarningIcon fontSize="small" />
                                                      </IconButton>
                                                    </Tooltip>
                                                  )}

                                                 {/* Returned from CEO Office: Forward again */}
                                                 {settlement.workflowStatus === 'Returned from CEO Office' && (
                                                   <Tooltip title="Forward again to CEO">
                                                     <IconButton
                                                       size="small"
                                                       color="primary"
                                                       onClick={() => openApproveDialog(settlement)}
                                                     >
                                                       <ArrowForwardIcon fontSize="small" />
                                                     </IconButton>
                                                   </Tooltip>
                                                 )}
                                              </Stack>
                                            </TableCell>
                                          </TableRow>
                                        ))}
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
        </CardContent>
      </Card>

      {/* View Dialog - Same white paper style as PreAudit */}
      <Dialog
        open={viewDialog.open}
        onClose={() => setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 })}
        maxWidth={(viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? false : "md"}
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 0,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            background: '#ffffff',
            ...((viewDialog.isPurchaseOrder || viewDialog.isCashApproval) && {
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
        <DialogTitle sx={{ p: 0, m: 0, '@media print': { display: (viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? 'none' : 'block' } }}>
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            p: 2,
            borderBottom: '1px solid #e0e0e0'
          }}>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#333' }}>
              {viewDialog.isPurchaseOrder ? 'Purchase Order Details' : viewDialog.isCashApproval ? 'Cash Approval Details' : 'PAYMENT SETTLEMENT'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {viewDialog.isPurchaseOrder && (
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
                onClick={() => setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 })}
                sx={{ color: '#666', '@media print': { display: 'none' } }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0, background: '#ffffff', overflow: 'auto', '@media print': { p: 0, overflow: 'visible' } }}>
          {viewDialog.settlement && (
            <Box sx={{ 
              p: (viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? 0 : 4, 
              background: '#ffffff',
              fontFamily: (viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? 'Arial, sans-serif' : '"Times New Roman", serif'
            }} className={(viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? "print-content" : ""}>
              {/* Show Purchase Order view if it's a PO */}
              {viewDialog.isPurchaseOrder ? (
                <>
                  <Tabs
                    value={viewDialog.poAuditTab ?? 0}
                    onChange={(_, v) => setViewDialog((prev) => ({ ...prev, poAuditTab: v }))}
                    sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider', '@media print': { display: 'none' } }}
                    variant="scrollable"
                    scrollButtons="auto"
                  >
                    <Tab label="Indent" />
                    <Tab label="Purchase Order" />
                    <Tab label="Comparative Statement" />
                    <Tab label={`Quotations (${viewDialog.poQuotations?.length || 0})`} />
                    <Tab label={viewDialog.poGrns?.length > 0 ? `GRN(s) (${viewDialog.poGrns.length})` : 'GRN(s)'} />
                    <Tab label={`Attached Documents (${viewDialog.poLinkedDocs?.length || 0})`} />
                  </Tabs>

                  {viewDialog.poAuditTab === 0 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      {!viewDialog.settlement?.indent ? (
                        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                          No indent linked with this PO.
                        </Typography>
                      ) : (
                        <Paper sx={{ p: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="h5" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1 }}>
                            Purchase Request Form
                          </Typography>
                          {viewDialog.settlement.indent.title && (
                            <Typography variant="h6" fontWeight={600} align="center" sx={{ mb: 2 }}>
                              {viewDialog.settlement.indent.title}
                            </Typography>
                          )}
                          <Box sx={{ mb: 1.5, fontSize: '0.9rem', textAlign: 'center' }}>
                            <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                            <Typography component="span" sx={{ ml: 1 }}>
                              {viewDialog.settlement.indent.erpRef || 'PR #' + (viewDialog.settlement.indent.indentNumber?.split('-').pop() || '')}
                            </Typography>
                          </Box>
                          <Box sx={{ mb: 1.5, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <Box>
                              <Typography component="span" fontWeight={600}>Date:</Typography>
                              <Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.settlement.indent.requestedDate)}</Typography>
                            </Box>
                            <Box>
                              <Typography component="span" fontWeight={600}>Required Date:</Typography>
                              <Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.settlement.indent.requiredDate) || '—'}</Typography>
                            </Box>
                            <Box>
                              <Typography component="span" fontWeight={600}>Indent No.:</Typography>
                              <Typography component="span" sx={{ ml: 1 }}>{viewDialog.settlement.indent.indentNumber || '—'}</Typography>
                            </Box>
                          </Box>
                          <Box sx={{ mb: 3, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <Box>
                              <Typography component="span" fontWeight={600}>Department:</Typography>
                              <Typography component="span" sx={{ ml: 1 }}>{viewDialog.settlement.indent.department?.name || viewDialog.settlement.indent.department || '—'}</Typography>
                            </Box>
                            <Box>
                              <Typography component="span" fontWeight={600}>Originator:</Typography>
                              <Typography component="span" sx={{ ml: 1 }}>
                                {viewDialog.settlement.indent.requestedBy?.firstName && viewDialog.settlement.indent.requestedBy?.lastName
                                  ? `${viewDialog.settlement.indent.requestedBy.firstName} ${viewDialog.settlement.indent.requestedBy.lastName}`
                                  : viewDialog.settlement.indent.requestedBy?.name || '—'}
                              </Typography>
                            </Box>
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
                                {(viewDialog.settlement.indent.items || []).map((item, idx) => (
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
                          {viewDialog.settlement.indent.justification && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Justification:</Typography>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                {viewDialog.settlement.indent.justification}
                              </Typography>
                            </Box>
                          )}
                          {Array.isArray(viewDialog.settlement.indent.approvalChain) && viewDialog.settlement.indent.approvalChain.length > 0 && (
                            <Box sx={{ mt: 3 }}>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                                Indent approval progress
                              </Typography>
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
                                  {viewDialog.settlement.indent.approvalChain.map((step, idx) => {
                                    const approver = step.approver;
                                    const name =
                                      [approver?.firstName, approver?.lastName].filter(Boolean).join(' ').trim() ||
                                      approver?.email ||
                                      `Approver ${idx + 1}`;
                                    const status = step.status || 'pending';
                                    const chipColor = status === 'approved' ? 'success' : status === 'rejected' ? 'error' : 'warning';
                                    const chipLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending approval';
                                    return (
                                      <TableRow key={`${name}-${idx}`}>
                                        <TableCell>{name}</TableCell>
                                        <TableCell>
                                          <Chip size="small" label={chipLabel} color={chipColor} variant={status === 'pending' ? 'outlined' : 'filled'} />
                                        </TableCell>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{step?.actedAt ? formatDateForDocument(step.actedAt) : '—'}</TableCell>
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
                            </Box>
                          )}
                        </Paper>
                      )}
                    </Box>
                  )}

                  {viewDialog.poAuditTab === 1 && (
                    <PurchaseOrderView poData={viewDialog.settlement} />
                  )}

                  {viewDialog.poAuditTab === 2 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                      <ComparativeStatementView
                        requisition={viewDialog.settlement?.indent}
                        quotations={viewDialog.poQuotations || []}
                        approvalAuthority={viewDialog.settlement?.indent?.comparativeStatementApprovals || {}}
                        note={viewDialog.settlement?.indent?.notes ?? ''}
                        readOnly
                        formatNumber={formatNumber}
                        loadingQuotations={false}
                        showPrintButton={false}
                      />
                    </Box>
                  )}

                  {viewDialog.poAuditTab === 3 && (
                    <Box sx={{ p: 2 }}>
                      {(!viewDialog.poQuotations || viewDialog.poQuotations.length === 0) ? (
                        <Typography color="text.secondary">No quotations linked with this PO.</Typography>
                      ) : (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>#</TableCell>
                                <TableCell>Quotation No</TableCell>
                                <TableCell>Vendor</TableCell>
                                <TableCell>Date</TableCell>
                                <TableCell align="right">Total</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {viewDialog.poQuotations.map((q, idx) => (
                                <TableRow key={q._id || idx}>
                                  <TableCell>{idx + 1}</TableCell>
                                  <TableCell>{q.quotationNumber || '—'}</TableCell>
                                  <TableCell>{q.vendor?.name || '—'}</TableCell>
                                  <TableCell>{formatDateForDocument(q.quotationDate)}</TableCell>
                                  <TableCell align="right">{formatPKR(q.totalAmount || 0)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Box>
                  )}

                  {viewDialog.poAuditTab === 4 && (
                    <Box sx={{ p: 2 }}>
                      {(!viewDialog.poGrns || viewDialog.poGrns.length === 0) ? (
                        <Typography color="text.secondary">No GRN attached to this PO.</Typography>
                      ) : (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>#</TableCell>
                                <TableCell>GRN No</TableCell>
                                <TableCell>Date</TableCell>
                                <TableCell>Supplier</TableCell>
                                <TableCell align="right">Net Amount</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {viewDialog.poGrns.map((grn, idx) => (
                                <TableRow key={grn._id || idx}>
                                  <TableCell>{idx + 1}</TableCell>
                                  <TableCell>{grn.receiveNumber || grn._id}</TableCell>
                                  <TableCell>{formatDateForDocument(grn.receiveDate)}</TableCell>
                                  <TableCell>{grn.supplierName || grn.supplier?.name || '—'}</TableCell>
                                  <TableCell align="right">{formatPKR(grn.netAmount || grn.total || 0)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Box>
                  )}

                  {viewDialog.poAuditTab === 5 && (
                    <Box sx={{ p: 2 }}>
                      {(!viewDialog.poLinkedDocs || viewDialog.poLinkedDocs.length === 0) ? (
                        <Typography color="text.secondary">No attached documents found.</Typography>
                      ) : (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>#</TableCell>
                                <TableCell>Source</TableCell>
                                <TableCell>Document</TableCell>
                                <TableCell>Date</TableCell>
                                <TableCell align="right">Action</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {viewDialog.poLinkedDocs.map((doc, idx) => (
                                <TableRow key={doc.id || idx}>
                                  <TableCell>{idx + 1}</TableCell>
                                  <TableCell>{doc.source || 'Attachment'}</TableCell>
                                  <TableCell>{doc.name || 'Document'}</TableCell>
                                  <TableCell>{doc.uploadedAt ? formatDateForDocument(doc.uploadedAt) : '—'}</TableCell>
                                  <TableCell align="right">
                                    {doc.url ? (
                                      <Button size="small" variant="outlined" onClick={() => window.open(doc.url, '_blank', 'noopener,noreferrer')}>
                                        Open
                                      </Button>
                                    ) : '—'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Box>
                  )}
                </>
              ) : viewDialog.isCashApproval && isGeneralModuleCashApproval(viewDialog.settlement) ? (
                <CashApprovalGeneralDetailShell
                  embedded
                  hideBack
                  ca={viewDialog.settlement}
                />
              ) : viewDialog.isCashApproval ? (
                <CashApprovalDetailTabsView
                  cashApproval={viewDialog.settlement}
                  tabValue={viewDialog.poAuditTab ?? 0}
                  onTabChange={(v) => setViewDialog((prev) => ({ ...prev, poAuditTab: v }))}
                  quotations={viewDialog.quotations || []}
                  linkedDocs={viewDialog.caLinkedDocs || []}
                />
              ) : (
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
                  {viewDialog.settlement.parentCompanyName || 'PAYMENT SETTLEMENT'}
                </Typography>
                
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      SITE:
                    </Typography>
                    <Typography variant="body2">
                      {viewDialog.settlement.site || 'Head Office'}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      FROM:
                    </Typography>
                    <Typography variant="body2">
                      {viewDialog.settlement.fromDepartment || 'Administration'}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      CUSTODIEN:
                    </Typography>
                    <Typography variant="body2">
                      {viewDialog.settlement.custodian || 'N/A'}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      DATE:
                    </Typography>
                    <Typography variant="body2">
                      {formatDateForDocument(viewDialog.settlement.date)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      DOCUMENT NUMBER:
                    </Typography>
                    <Typography variant="body2">
                      {viewDialog.settlement.referenceNumber?.trim() || viewDialog.settlement._id || 'N/A'}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      NOTE:
                    </Typography>
                    <Typography variant="body2">
                      {viewDialog.settlement.attachments && viewDialog.settlement.attachments.length > 0 
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
                          {formatDateForDocument(viewDialog.settlement.date)}
                        </TableCell>
                        <TableCell sx={{ 
                          border: '1px solid #000',
                          py: 2,
                          fontSize: '13px'
                        }}>
                          {viewDialog.settlement.referenceNumber?.trim() || viewDialog.settlement._id || 'N/A'}
                        </TableCell>
                        <TableCell sx={{ 
                          border: '1px solid #000',
                          py: 2,
                          fontSize: '13px'
                        }}>
                          {viewDialog.settlement.toWhomPaid || 'N/A'}
                        </TableCell>
                        <TableCell sx={{ 
                          border: '1px solid #000',
                          py: 2,
                          fontSize: '13px',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {viewDialog.settlement.forWhat || 'N/A'}
                        </TableCell>
                        <TableCell sx={{ 
                          border: '1px solid #000',
                          py: 2,
                          fontSize: '13px',
                          textAlign: 'right',
                          fontWeight: 600
                        }}>
                          {formatPKR(viewDialog.settlement.amount)}
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
                    Grand Total: {formatPKR(viewDialog.settlement.grandTotal || viewDialog.settlement.amount || 0)}
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
                        {viewDialog.settlement.preparedBy || 'N/A'}
                      </Typography>
                      <Typography variant="body2" sx={{ 
                        fontSize: '12px',
                        color: '#666'
                      }}>
                        {viewDialog.settlement.preparedByDesignation || 'Not specified'}
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
                        {viewDialog.settlement.verifiedBy || 'N/A'}
                      </Typography>
                      <Typography variant="body2" sx={{ 
                        fontSize: '12px',
                        color: '#666'
                      }}>
                        {viewDialog.settlement.verifiedByDesignation || 'Not specified'}
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
                        {viewDialog.settlement.approvedBy || 'N/A'}
                      </Typography>
                      <Typography variant="body2" sx={{ 
                        fontSize: '12px',
                        color: '#666'
                      }}>
                        {viewDialog.settlement.approvedByDesignation || 'Not specified'}
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </Box>

              <Box sx={{ mt: 4 }}>
                <WorkflowAuditFeedbackPanel
                  document={viewDialog.settlement}
                  formatDateTime={formatDateTime}
                  userDisplayName={userDisplayName}
                  visualVariant="settlement"
                  returnedAuditStatus="Returned from CEO Office"
                />
              </Box>

              {/* Document Attachments Section */}
              {viewDialog.settlement.attachments && viewDialog.settlement.attachments.length > 0 && (
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
                    ATTACHMENTS ({viewDialog.settlement.attachments.length}):
                  </Typography>
                  <Box sx={{ 
                    border: '1px solid #000',
                    p: 2
                  }}>
                    <Grid container spacing={1}>
                      {viewDialog.settlement.attachments.map((attachment, index) => {
                        const attachmentUrl = paymentSettlementService.getAttachmentUrl(viewDialog.settlement._id, attachment._id);
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
                                    const blobUrl = await paymentSettlementService.getAttachmentBlobUrl(viewDialog.settlement._id, attachment._id);
                                    setImageViewer({
                                      open: true,
                                      imageUrl: blobUrl,
                                      imageName: attachment.originalName,
                                      isBlob: true
                                    });
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
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ 
          p: 2, 
          borderTop: '1px solid #e0e0e0',
          background: '#f9f9f9',
          justifyContent: 'space-between',
          '@media print': { display: 'none' }
        }}>
          <Box>
            {!viewDialog.isPurchaseOrder && !viewDialog.isCashApproval && (
              <>
                <Chip
                  label={viewDialog.settlement?.workflowStatus || 'Draft'}
                  color={getWorkflowStatusColor(viewDialog.settlement?.workflowStatus || 'Draft')}
                  size="small"
                  sx={{ mr: 1 }}
                />
                <Chip
                  label={viewDialog.settlement?.paymentType}
                  variant="outlined"
                  size="small"
                />
              </>
            )}
            {viewDialog.isCashApproval && (
              <Chip
                label={viewDialog.settlement?.status || viewDialog.settlement?.workflowStatus || '—'}
                color={getWorkflowStatusColor(viewDialog.settlement?.status || viewDialog.settlement?.workflowStatus || '')}
                size="small"
              />
            )}
          </Box>
          <Box>
            {/* View Dialog Quick Actions based on status */}
            {((viewDialog.settlement?.workflowStatus || viewDialog.settlement?.status) === 'Forwarded to CEO') && canApproveAsCeo && (
              <>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  onClick={() => {
                    const flags = {
                      isPurchaseOrder: viewDialog.isPurchaseOrder,
                      isCashApproval: viewDialog.isCashApproval
                    };
                    const item = viewDialog.settlement;
                    setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 });
                    openApproveDialog(item, flags);
                  }}
                  sx={{ mr: 1 }}
                >
                  Approve (CEO)
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<CancelIcon />}
                  onClick={() => {
                    const flags = {
                      isPurchaseOrder: viewDialog.isPurchaseOrder,
                      isCashApproval: viewDialog.isCashApproval
                    };
                    const item = viewDialog.settlement;
                    setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 });
                    openRejectDialog(item, flags);
                  }}
                  sx={{ mr: 1 }}
                >
                  Reject (CEO)
                </Button>
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<WarningIcon />}
                  onClick={() => {
                    const flags = {
                      isPurchaseOrder: viewDialog.isPurchaseOrder,
                      isCashApproval: viewDialog.isCashApproval
                    };
                    const item = viewDialog.settlement;
                    setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 });
                    openReturnDialog(item, flags);
                  }}
                  sx={{ mr: 1 }}
                >
                  Return with Observations
                </Button>
              </>
            )}

            {((viewDialog.settlement?.workflowStatus || viewDialog.settlement?.status) === 'Send to CEO Office') && (
              <>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<ArrowForwardIcon />}
                  onClick={() => {
                    const flags = {
                      isPurchaseOrder: viewDialog.isPurchaseOrder,
                      isCashApproval: viewDialog.isCashApproval
                    };
                    const item = viewDialog.settlement;
                    setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 });
                    openApproveDialog(item, flags);
                  }}
                  sx={{ mr: 1 }}
                >
                  Forward to CEO
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<CancelIcon />}
                  onClick={() => {
                    const flags = {
                      isPurchaseOrder: viewDialog.isPurchaseOrder,
                      isCashApproval: viewDialog.isCashApproval
                    };
                    const item = viewDialog.settlement;
                    setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 });
                    openRejectDialog(item, flags);
                  }}
                  sx={{ mr: 1 }}
                >
                  Reject
                </Button>
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<WarningIcon />}
                  onClick={() => {
                    const flags = {
                      isPurchaseOrder: viewDialog.isPurchaseOrder,
                      isCashApproval: viewDialog.isCashApproval
                    };
                    const item = viewDialog.settlement;
                    setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 });
                    openReturnDialog(item, flags);
                  }}
                  sx={{ mr: 1 }}
                >
                  Return with Observations
                </Button>
              </>
            )}

            <Button 
              variant="outlined" 
              startIcon={<HistoryIcon />}
              onClick={() => setWorkflowHistoryDialog({ open: true, settlement: viewDialog.settlement })}
              sx={{ minWidth: 150, mr: 1 }}
            >
              See Workflow History
            </Button>
            <Button 
              variant="outlined" 
              onClick={() => setViewDialog({ open: false, settlement: null, isPurchaseOrder: false, isCashApproval: false, quotations: [], caLinkedDocs: [], poQuotations: [], poGrns: [], poLinkedDocs: [], poAuditTab: 0 })}
              sx={{ minWidth: 80, mr: 1 }}
            >
              Close
            </Button>
            {!viewDialog.isPurchaseOrder && !viewDialog.isCashApproval && (
              <Button 
                variant="outlined" 
                startIcon={<PrintIcon />}
                onClick={handlePrint}
                sx={{ minWidth: 100 }}
              >
                Print
              </Button>
            )}
          </Box>
        </DialogActions>
      </Dialog>

      {/* Print Styles for Purchase Order / Cash Approval Dialog */}
      {(viewDialog.isPurchaseOrder || viewDialog.isCashApproval) && (
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
      )}

      {/* Approve Dialog */}
      <Dialog 
        open={approveDialog.open} 
        onClose={() => {
          setApproveDialog({ open: false, settlement: null });
          setApprovalComments('');
          setApprovalAgree(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {approveDialog.settlement?.workflowStatus === 'Forwarded to CEO'
            ? `Approve ${approveDialog.settlement?.isPurchaseOrder ? 'Purchase Order' : approveDialog.settlement?.isCashApproval ? 'Cash Approval' : 'Payment Settlement'}`
            : 'Forward to CEO'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {approveDialog.settlement?.workflowStatus === 'Forwarded to CEO'
              ? 'You are about to give CEO approval for '
              : 'You are about to forward '}
            {approveDialog.settlement?.isPurchaseOrder
              ? 'purchase order'
              : approveDialog.settlement?.isCashApproval
                ? 'cash approval'
                : 'payment settlement'}{' '}
            : <strong>{approveDialog.settlement?.referenceNumber}</strong>
          </Typography>
          {approveDialog.settlement?.workflowStatus === 'Forwarded to CEO' && user?.digitalSignature && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                Your profile signature will be applied automatically
              </Typography>
              <DigitalSignatureImage userOrPath={user} alt="Your signature" />
            </Box>
          )}
          
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Comments (Optional)"
            value={approvalComments}
            onChange={(e) => setApprovalComments(e.target.value)}
            sx={{ mb: 2 }}
          />
          
          <FormControlLabel
            control={
              <Checkbox
                checked={approvalAgree}
                onChange={(e) => setApprovalAgree(e.target.checked)}
              />
            }
            label={
              approveDialog.settlement?.workflowStatus === 'Forwarded to CEO'
                ? (approveDialog.settlement?.isPurchaseOrder
                    ? 'I confirm that I have reviewed all details and approve this purchase order as CEO'
                    : approveDialog.settlement?.isCashApproval
                      ? 'I confirm that I have reviewed all details and approve this cash approval as CEO'
                      : 'I confirm that I have reviewed all payment details and approve this payment settlement as CEO')
                : (approveDialog.settlement?.isPurchaseOrder
                    ? 'I confirm that I have reviewed all details and forward this purchase order to CEO'
                    : approveDialog.settlement?.isCashApproval
                      ? 'I confirm that I have reviewed all details and forward this cash approval to CEO'
                      : 'I confirm that I have reviewed all payment details and forward this payment settlement to CEO')
            }
          />
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setApproveDialog({ open: false, settlement: null });
              setApprovalComments('');
              setApprovalAgree(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleForward}
            variant="contained"
            color={approveDialog.settlement?.workflowStatus === 'Forwarded to CEO' ? 'success' : 'primary'}
            disabled={actionLoading || !approvalAgree}
            startIcon={approveDialog.settlement?.workflowStatus === 'Forwarded to CEO' ? <CheckCircleIcon /> : <ArrowForwardIcon />}
          >
            {actionLoading
              ? <CircularProgress size={20} />
              : approveDialog.settlement?.workflowStatus === 'Forwarded to CEO'
                ? 'Approve'
                : 'Forward to CEO'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog 
        open={rejectDialog.open} 
        onClose={() => {
          setRejectDialog({ open: false, settlement: null });
          setRejectionComments('');
          setRejectionAgree(false);
          setRejectObservations([{ observation: '', severity: 'medium' }]);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {rejectDialog.settlement?.isPurchaseOrder
            ? 'Reject Purchase Order'
            : rejectDialog.settlement?.isCashApproval
              ? 'Reject Cash Approval'
              : 'Reject Payment'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You are about to reject{' '}
            {rejectDialog.settlement?.isPurchaseOrder
              ? 'purchase order'
              : rejectDialog.settlement?.isCashApproval
                ? 'cash approval'
                : 'payment settlement'}
            : <strong>{rejectDialog.settlement?.referenceNumber}</strong>
          </Typography>
          
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Rejection Comments (Required)"
            value={rejectionComments}
            onChange={(e) => setRejectionComments(e.target.value)}
            required
            sx={{ mb: 2 }}
          />
          
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Observations (Optional)
            </Typography>
            {rejectObservations.map((obs, index) => (
              <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid #ddd', borderRadius: 1 }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={8}>
                    <TextField
                      fullWidth
                      multiline
                      rows={2}
                      placeholder="Enter observation..."
                      value={obs.observation}
                      onChange={(e) => updateObservation(index, 'observation', e.target.value, 'reject')}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Severity</InputLabel>
                      <Select
                        value={obs.severity}
                        label="Severity"
                        onChange={(e) => updateObservation(index, 'severity', e.target.value, 'reject')}
                      >
                        <MenuItem value="low">Low</MenuItem>
                        <MenuItem value="medium">Medium</MenuItem>
                        <MenuItem value="high">High</MenuItem>
                        <MenuItem value="critical">Critical</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={1}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => removeObservation(index, 'reject')}
                      disabled={rejectObservations.length === 1}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Grid>
                </Grid>
              </Box>
            ))}
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => addObservation('reject')}
            >
              Add Observation
            </Button>
          </Box>
          {user?.digitalSignature && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                Your profile signature will be applied automatically
              </Typography>
              <DigitalSignatureImage userOrPath={user} alt="Your signature" />
            </Box>
          )}
          
          <FormControlLabel
            control={
              <Checkbox
                checked={rejectionAgree}
                onChange={(e) => setRejectionAgree(e.target.checked)}
              />
            }
            label={
              rejectDialog.settlement?.workflowStatus === 'Forwarded to CEO'
                ? (rejectDialog.settlement?.isPurchaseOrder
                    ? 'I confirm that I have reviewed all details and reject this purchase order as CEO'
                    : rejectDialog.settlement?.isCashApproval
                      ? 'I confirm that I have reviewed all details and reject this cash approval as CEO'
                      : 'I confirm that I have reviewed all payment details and reject this payment settlement as CEO')
                : (rejectDialog.settlement?.isPurchaseOrder
                    ? 'I confirm that I have reviewed all details and reject this purchase order from CEO Secretariat'
                    : rejectDialog.settlement?.isCashApproval
                      ? 'I confirm that I have reviewed all details and reject this cash approval from CEO Secretariat'
                      : 'I confirm that I have reviewed all payment details and reject this payment settlement')
            }
          />
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setRejectDialog({ open: false, settlement: null });
              setRejectionComments('');
              setRejectionAgree(false);
              setRejectObservations([{ observation: '', severity: 'medium' }]);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleReject}
            variant="contained"
            color="error"
            disabled={actionLoading || !rejectionAgree || !rejectionComments.trim()}
            startIcon={<CancelIcon />}
          >
            {actionLoading ? <CircularProgress size={20} /> : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Return with Observations Dialog */}
      <Dialog 
        open={returnDialog.open} 
        onClose={() => {
          setReturnDialog({ open: false, settlement: null });
          setReturnComments('');
          setReturnAgree(false);
          setReturnObservations([{ observation: '', severity: 'medium' }]);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {returnDialog.settlement?.workflowStatus === 'Forwarded to CEO'
            ? (returnDialog.settlement?.isPurchaseOrder
                ? 'Return Purchase Order with Observations (CEO)'
                : returnDialog.settlement?.isCashApproval
                  ? 'Return Cash Approval with Observations (CEO)'
                  : 'Return Payment with Observations (CEO)')
            : (returnDialog.settlement?.isPurchaseOrder
                ? 'Return Purchase Order with Observations'
                : returnDialog.settlement?.isCashApproval
                  ? 'Return Cash Approval with Observations'
                  : 'Return Payment with Observations')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You are about to return{' '}
            {returnDialog.settlement?.isPurchaseOrder
              ? 'purchase order'
              : returnDialog.settlement?.isCashApproval
                ? 'cash approval'
                : 'payment settlement'}
            : <strong>{returnDialog.settlement?.referenceNumber}</strong> with observations
          </Typography>
          
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Return Comments (Required)"
            value={returnComments}
            onChange={(e) => setReturnComments(e.target.value)}
            required
            sx={{ mb: 2 }}
          />
          
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Observations (Required - At least one)
            </Typography>
            {returnObservations.map((obs, index) => (
              <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid #ddd', borderRadius: 1 }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={8}>
                    <TextField
                      fullWidth
                      multiline
                      rows={2}
                      placeholder="Enter observation..."
                      value={obs.observation}
                      onChange={(e) => updateObservation(index, 'observation', e.target.value, 'return')}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Severity</InputLabel>
                      <Select
                        value={obs.severity}
                        label="Severity"
                        onChange={(e) => updateObservation(index, 'severity', e.target.value, 'return')}
                      >
                        <MenuItem value="low">Low</MenuItem>
                        <MenuItem value="medium">Medium</MenuItem>
                        <MenuItem value="high">High</MenuItem>
                        <MenuItem value="critical">Critical</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={1}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => removeObservation(index, 'return')}
                      disabled={returnObservations.length === 1}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Grid>
                </Grid>
              </Box>
            ))}
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => addObservation('return')}
            >
              Add Observation
            </Button>
          </Box>
          {user?.digitalSignature && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                Your profile signature will be applied automatically
              </Typography>
              <DigitalSignatureImage userOrPath={user} alt="Your signature" />
            </Box>
          )}
          
          <FormControlLabel
            control={
              <Checkbox
                checked={returnAgree}
                onChange={(e) => setReturnAgree(e.target.checked)}
              />
            }
            label={
              returnDialog.settlement?.workflowStatus === 'Forwarded to CEO'
                ? (returnDialog.settlement?.isPurchaseOrder
                    ? 'I confirm that I have reviewed all details and return this purchase order with observations as CEO'
                    : returnDialog.settlement?.isCashApproval
                      ? 'I confirm that I have reviewed all details and return this cash approval with observations as CEO'
                      : 'I confirm that I have reviewed all payment details and return this payment settlement with observations as CEO')
                : (returnDialog.settlement?.isPurchaseOrder
                    ? 'I confirm that I have reviewed all details and return this purchase order with observations'
                    : returnDialog.settlement?.isCashApproval
                      ? 'I confirm that I have reviewed all details and return this cash approval with observations'
                      : 'I confirm that I have reviewed all payment details and return this payment settlement with observations')
            }
          />
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setReturnDialog({ open: false, settlement: null });
              setReturnComments('');
              setReturnAgree(false);
              setReturnObservations([{ observation: '', severity: 'medium' }]);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleReturn}
            variant="contained"
            color="warning"
            disabled={
              actionLoading ||
              !returnAgree ||
              !returnComments.trim() ||
              returnObservations.every(obs => !obs.observation.trim())
            }
            startIcon={<WarningIcon />}
          >
            {actionLoading ? <CircularProgress size={20} /> : 'Return with Observations'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Workflow History Dialog */}
      <WorkflowHistoryDialog
        open={workflowHistoryDialog.open}
        onClose={() => setWorkflowHistoryDialog({ open: false, settlement: null })}
        document={workflowHistoryDialog.settlement}
        documentType="settlement"
      />

      {/* Image Viewer Modal */}
      <Dialog
        open={imageViewer.open}
        onClose={() => {
          if (imageViewer.isBlob && imageViewer.imageUrl) {
            URL.revokeObjectURL(imageViewer.imageUrl);
          }
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
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '400px'
          }}
        >
          <IconButton
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              bgcolor: 'rgba(0,0,0,0.5)',
              color: 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }
            }}
            onClick={() => {
              if (imageViewer.isBlob && imageViewer.imageUrl) {
                URL.revokeObjectURL(imageViewer.imageUrl);
              }
              setImageViewer({ open: false, imageUrl: '', imageName: '', isBlob: false });
            }}
          >
            <CloseIcon />
          </IconButton>
          <img
            src={imageViewer.imageUrl}
            alt={imageViewer.imageName}
            style={{
              maxWidth: '100%',
              maxHeight: '90vh',
              objectFit: 'contain'
            }}
          />
        </Box>
      </Dialog>
      <IpcReviewDialog open={Boolean(ipcReviewId)} ipcId={ipcReviewId} onClose={() => setIpcReviewId(null)} />
    </Box>
  );
};

export default Payments;

