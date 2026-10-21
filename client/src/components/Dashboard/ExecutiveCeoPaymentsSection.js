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
  Stack,
  Tooltip,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  Tabs,
  Tab,
  Divider,
  alpha,
  useTheme,
  useMediaQuery,
  Avatar
} from '@mui/material';
import {
  Visibility as ViewIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Warning as WarningIcon,
  Close as CloseIcon,
  AttachMoney as AttachMoneyIcon,
  Print as PrintIcon,
  Add as AddIcon,
  History as HistoryIcon,
  Refresh as RefreshIcon,
  VerifiedUser as VerifiedUserIcon,
  AccountBalanceWallet as WalletIcon,
  ReceiptLong as ReceiptIcon,
  ShoppingBag as ShoppingBagIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import paymentSettlementService from '../../services/paymentSettlementService';
import api from '../../services/api';
import nonEmployeeService from '../../services/nonEmployeeService';
import ResubmissionHistory from '../../pages/HR/NonEmployeeOnboarding/ResubmissionHistory';
import manualSalaryService from '../../services/manualSalaryService';
import executiveApprovalsService from '../../services/executiveApprovalsService';
import indentService from '../../services/indentService';
import utilityBillService from '../../services/utilityBillService';
import { formatPKR } from '../../utils/currency';
import { getImageUrl } from '../../utils/imageService';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import toast from 'react-hot-toast';
import WorkflowHistoryDialog from '../WorkflowHistoryDialog';
import { DigitalSignatureImage } from '../common/DigitalSignatureImage';
import CashApprovalDetailTabsView from '../Procurement/CashApprovalDetailTabsView';
import CashApprovalGeneralDetailShell from '../CashApprovals/CashApprovalGeneralDetailShell';
import { isGeneralModuleCashApproval } from '../CashApprovals/cashApprovalGeneralDocumentUtils';
import ComparativeStatementView from '../Procurement/ComparativeStatementView';
import { WorkflowAuditFeedbackPanel } from '../Admin/workflowAuditReturn';
import IndentDetail from '../../pages/General/Indents/IndentDetail';
import UtilityBillDetails from '../../pages/Admin/UtilityBillManagement/UtilityBillDetails';
import CentralizedStoreBillInvoiceBody from '../UtilityBill/CentralizedStoreBillInvoiceBody';
import { getCentralizedStoreDocumentTypeLabel } from '../../utils/centralizedStoreBillKind';
import PODocumentView from '../../pages/Procurement/Store/PODocumentView';
import { printNewHiringApproval } from '../../utils/newHiringApprovalPrint';
import {
  formatNewHiringPackage,
  getNewHiringAuthorityCards,
  getNewHiringEmployees
} from '../../utils/newHiringEmployees';

const ExecutiveCeoPaymentsSection = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const { user } = useAuth();

  /** Profile digital signature applied automatically on CEO approve/reject/return */
  const getAutoDigitalSignature = useCallback(() => {
    return (
      user?.digitalSignature ||
      (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : '') ||
      user?.email ||
      'CEO'
    );
  }, [user]);

  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [canApproveAsCeo, setCanApproveAsCeo] = useState(false);
  const [filterTab, setFilterTab] = useState(0); // 0: All, 1: PO, 2: CA, 3: Settlement, 4: Onboarding, 5: Other
  const [actionLoading, setActionLoading] = useState(false);

  // Dialog states
  const [viewDialog, setViewDialog] = useState({
    open: false,
    settlement: null,
    isPurchaseOrder: false,
    isCashApproval: false,
    quotations: [],
    caLinkedDocs: [],
    poQuotations: [],
    poGrns: [],
    poLinkedDocs: [],
    poAuditTab: 0,
    isOnboarding: false,
    isManualSalary: false,
    isIndent: false,
    isUtilityBill: false,
    isVendorBill: false
  });

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const [imageViewer, setImageViewer] = useState({
    open: false,
    imageUrl: '',
    imageName: '',
    isBlob: false
  });

  const [approveDialog, setApproveDialog] = useState({ open: false, settlement: null });
  const [rejectDialog, setRejectDialog] = useState({ open: false, settlement: null });
  const [returnDialog, setReturnDialog] = useState({ open: false, settlement: null });
  const [workflowHistoryDialog, setWorkflowHistoryDialog] = useState({ open: false, settlement: null });

  // Form states for approval/rejection/return (signature comes from profile automatically)
  const [approvalComments, setApprovalComments] = useState('');
  const [approvalAgree, setApprovalAgree] = useState(false);

  const [rejectionComments, setRejectionComments] = useState('');
  const [rejectionAgree, setRejectionAgree] = useState(false);
  const [rejectObservations, setRejectObservations] = useState([{ observation: '', severity: 'medium' }]);

  const [returnComments, setReturnComments] = useState('');
  const [returnAgree, setReturnAgree] = useState(false);
  const [returnObservations, setReturnObservations] = useState([{ observation: '', severity: 'medium' }]);

  // Fetch personal executive inbox (only docs waiting on this user)
  const fetchCeoPayments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await executiveApprovalsService.getMyApprovals();
      const payload = res.data?.data || {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      setCanApproveAsCeo(Boolean(payload.canApproveAsCeo ?? payload.isDesignatedCeo));

      const combined = items.map((item) => {
        const raw = item.raw && typeof item.raw === 'object' ? item.raw : {};
        const companyFromItem = (() => {
          if (typeof item.company === 'string' && item.company.trim()) return item.company.trim();
          if (item.company && typeof item.company === 'object' && item.company.name) {
            return String(item.company.name).trim();
          }
          if (typeof raw.parentCompanyName === 'string' && raw.parentCompanyName.trim()) {
            return raw.parentCompanyName.trim();
          }
          if (typeof raw.subsidiaryName === 'string' && raw.subsidiaryName.trim()) {
            return raw.subsidiaryName.trim();
          }
          if (typeof raw.company === 'string' && raw.company.trim()) return raw.company.trim();
          if (raw.company && typeof raw.company === 'object' && raw.company.name) {
            return String(raw.company.name).trim();
          }
          if (raw.companyId && typeof raw.companyId === 'object' && raw.companyId.name) {
            return String(raw.companyId.name).trim();
          }
          if (typeof raw.companyName === 'string' && raw.companyName.trim()) return raw.companyName.trim();
          if (typeof raw.accountHead === 'string' && raw.accountHead.trim()) return raw.accountHead.trim();
          return null;
        })();

        return {
          ...raw,
          _id: item.id || raw._id,
          isPurchaseOrder: Boolean(item.isPurchaseOrder),
          isCashApproval: Boolean(item.isCashApproval),
          isPaymentSettlement: Boolean(item.isPaymentSettlement),
          isOnboarding: Boolean(item.isOnboarding),
          isManualSalary: Boolean(item.isManualSalary),
          isIndent: Boolean(item.isIndent),
          isUtilityBill: Boolean(item.isUtilityBill),
          isVendorBill: Boolean(item.isVendorBill),
          itemType: item.itemType || 'Document',
          typeLabel: item.itemType || 'Document',
          displayRef: item.displayRef || item.number || raw.orderNumber || raw.caNumber || raw.referenceNumber || item.id,
          displayDate: item.displayDate || item.date || raw.orderDate || raw.date || raw.updatedAt,
          displayAmount: item.displayAmount != null ? item.displayAmount : (item.amount || 0),
          displayVendor: item.displayVendor || item.party || '—',
          displayNotes: item.displayNotes || item.subtitle || item.itemType || '',
          department: item.department || raw.fromDepartment || '—',
          company: companyFromItem || raw.company || null,
          companyName: companyFromItem || raw.companyName || null,
          parentCompanyName: raw.parentCompanyName || companyFromItem || null,
          workflowStatus: item.workflowStatus || item.status || raw.workflowStatus || raw.status,
          status: item.status || raw.status || raw.workflowStatus,
          path: item.path || raw.path || null,
          ceoViewOnly: Boolean(item.ceoViewOnly),
          canAct: Boolean(item.canAct)
        };
      });

      // Sort by date descending
      combined.sort((a, b) => new Date(b.displayDate || 0) - new Date(a.displayDate || 0));
      setPayments(combined);
    } catch (error) {
      console.error('Error fetching executive approvals:', error);
      toast.error(error.response?.data?.message || 'Failed to load your approval inbox');
      setPayments([]);
      setCanApproveAsCeo(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCeoPayments();
  }, [fetchCeoPayments]);

  // Derived metrics
  const poItems = payments.filter((p) => p.isPurchaseOrder);
  const caItems = payments.filter((p) => p.isCashApproval);
  const settlementItems = payments.filter((p) => p.isPaymentSettlement);
  const onboardingItems = payments.filter((p) => p.isOnboarding || p.isManualSalary);
  const otherItems = payments.filter((p) => p.isIndent || p.isUtilityBill || p.isVendorBill);

  const totalAmount = payments.reduce((sum, p) => sum + (Number(p.displayAmount) || 0), 0);
  const poAmount = poItems.reduce((sum, p) => sum + (Number(p.displayAmount) || 0), 0);
  const caAmount = caItems.reduce((sum, p) => sum + (Number(p.displayAmount) || 0), 0);
  const setAmount = settlementItems.reduce((sum, p) => sum + (Number(p.displayAmount) || 0), 0);

  // Filtered list
  const filteredPayments = payments.filter((p) => {
    if (filterTab === 1 && !p.isPurchaseOrder) return false;
    if (filterTab === 2 && !p.isCashApproval) return false;
    if (filterTab === 3 && !p.isPaymentSettlement) return false;
    if (filterTab === 4 && !(p.isOnboarding || p.isManualSalary)) return false;
    if (filterTab === 5 && !(p.isIndent || p.isUtilityBill || p.isVendorBill)) return false;
    return true;
  });

  // Helpers matching Payments.js
  const formatDateForPrint = (date) => {
    if (!date) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(date);
    return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
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

  const formatNumber = (num) => {
    if (num === null || num === undefined) return '0.00';
    return parseFloat(num).toFixed(2);
  };

  const getCompanyValue = (item) => {
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
    if (item.companyId && typeof item.companyId === 'object' && item.companyId.name) {
      return String(item.companyId.name).trim();
    }
    if (item.placementCompany && typeof item.placementCompany === 'object' && item.placementCompany.name) {
      return item.placementCompany.name.trim();
    }
    if (typeof item.subsidiaryName === 'string' && item.subsidiaryName.trim()) {
      return item.subsidiaryName.trim();
    }
    if (typeof item.accountHead === 'string' && item.accountHead.trim()) {
      return item.accountHead.trim();
    }
    if (item.indent?.companyId && typeof item.indent.companyId === 'object' && item.indent.companyId.name) {
      return String(item.indent.companyId.name).trim();
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
    if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
    result += ' Only';
    return result;
  };

  const getWorkflowStatusColor = (status) => {
    switch (status) {
      case 'Draft': return 'default';
      case 'Pending HOD HR': return 'warning';
      case 'Pending AVP': return 'info';
      case 'Send to CEO Office': return 'info';
      case 'Forwarded to CEO': return 'warning';
      case 'Approved by CEO': return 'success';
      case 'Pending Finance': return 'warning';
      case 'Payment Pending': return 'info';
      case 'Paid': return 'success';
      case 'Rejected by CEO': return 'error';
      case 'Returned':
      case 'Returned from CEO Office': return 'warning';
      default: return 'default';
    }
  };

  const userDisplayName = (u) => {
    if (!u) return '';
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';
  };

  // Full Audit / View Opener (identical to Payments.js)
  const openView = async (settlement) => {
    if (settlement.isPurchaseOrder) {
      const baseFlags = {
        isPurchaseOrder: true,
        isCashApproval: false,
        isOnboarding: false,
        isPaymentSettlement: false
      };
      const buildLinkedDocs = (poData, quotations = []) => {
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
        pushDocs(poData?.attachments, 'PO Attachment');
        pushDocs(poData?.indent?.attachments, 'Indent Attachment');
        quotations.forEach((q) => pushDocs(q?.attachments, `Quotation ${q?.quotationNumber || ''}`.trim()));
        return poLinkedDocs;
      };

      try {
        const r = await api.get(`/procurement/purchase-orders/${settlement._id}`);
        const d = {
          ...withCeoDocTypeFlags({ ...settlement, ...(r.data?.data || {}) }, baseFlags)
        };
        const indentId = d?.indent?._id || d?.indent;
        const [qRes, grnRes] = await Promise.all([
          indentId
            ? api.get(`/procurement/quotations/by-indent/${indentId}`).catch(() => ({ data: { data: [] } }))
            : Promise.resolve({ data: { data: [] } }),
          api.get('/procurement/goods-receive', { params: { purchaseOrder: d._id, limit: 100 } }).catch(() => ({ data: { data: { receives: [] } } }))
        ]);
        const poQuotations = Array.isArray(qRes?.data?.data) ? qRes.data.data : [];
        const poGrns = Array.isArray(grnRes?.data?.data?.receives) ? grnRes.data.data.receives : [];
        setViewDialog({
          open: true,
          settlement: d,
          isPurchaseOrder: true,
          isCashApproval: false,
          isOnboarding: false,
          poQuotations,
          poGrns,
          poLinkedDocs: buildLinkedDocs(d, poQuotations),
          poAuditTab: 0
        });
      } catch (e) {
        console.error('Error fetching purchase order details:', e);
        // Fallback: list payload may already include populated indent from ceo-secretariat
        const fallback = withCeoDocTypeFlags(settlement, baseFlags);
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
          isOnboarding: false,
          poQuotations,
          poGrns: [],
          poLinkedDocs: buildLinkedDocs(fallback, poQuotations),
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
        setViewDialog({ open: true, settlement: d, isPurchaseOrder: false, isCashApproval: true, isOnboarding: false, quotations, caLinkedDocs: linkedDocuments, poAuditTab: 0 });
      } catch (e) {
        console.error('Error fetching cash approval details:', e);
        setViewDialog({ open: true, settlement, isPurchaseOrder: false, isCashApproval: true, isOnboarding: false, quotations: [], caLinkedDocs: [], poAuditTab: 0 });
      }
    } else if (settlement.isManualSalary) {
      const baseFlags = {
        isPurchaseOrder: false,
        isCashApproval: false,
        isOnboarding: false,
        isManualSalary: true,
        isIndent: false,
        isUtilityBill: false,
        isVendorBill: false,
        isPaymentSettlement: false
      };
      try {
        const r = await manualSalaryService.getById(settlement._id);
        const detail = r?.data?.data || r?.data || settlement;
      setViewDialog({ 
        open: true, 
          settlement: withCeoDocTypeFlags({ ...settlement, ...detail }, baseFlags),
          ...baseFlags,
          quotations: [],
          caLinkedDocs: [],
          poQuotations: [],
          poGrns: [],
          poLinkedDocs: [],
          poAuditTab: 0
        });
      } catch (e) {
        console.error('Error fetching manual salary details:', e);
        setViewDialog({
          open: true,
          settlement: withCeoDocTypeFlags(settlement, baseFlags),
          ...baseFlags,
          quotations: [],
          caLinkedDocs: [],
          poQuotations: [],
          poGrns: [],
          poLinkedDocs: [],
          poAuditTab: 0
        });
      }
    } else if (settlement.isOnboarding) {
      const baseFlags = {
        isPurchaseOrder: false, 
        isCashApproval: false, 
        isOnboarding: true,
        isManualSalary: false,
        isIndent: false,
        isUtilityBill: false,
        isVendorBill: false,
        isPaymentSettlement: false
      };
      try {
        const r = await nonEmployeeService.getRecordById(settlement._id);
        const detail = r?.data?.data || r?.data || settlement;
        setViewDialog({
          open: true,
          settlement: withCeoDocTypeFlags({ ...settlement, ...detail }, baseFlags),
          ...baseFlags,
          quotations: [],
          caLinkedDocs: [],
          poQuotations: [],
          poGrns: [],
          poLinkedDocs: [],
        poAuditTab: 0 
      });
      } catch (e) {
        console.error('Error fetching new-hiring approval details:', e);
        setViewDialog({
          open: true,
          settlement: withCeoDocTypeFlags(settlement, baseFlags),
          ...baseFlags,
          quotations: [],
          caLinkedDocs: [],
          poQuotations: [],
          poGrns: [],
          poLinkedDocs: [],
          poAuditTab: 0
        });
      }
    } else if (settlement.isIndent || settlement.isUtilityBill || settlement.isVendorBill) {
      const baseFlags = {
        isPurchaseOrder: false,
        isCashApproval: false,
        isOnboarding: false,
        isManualSalary: false,
        isPaymentSettlement: false,
        isIndent: Boolean(settlement.isIndent),
        isUtilityBill: Boolean(settlement.isUtilityBill),
        isVendorBill: Boolean(settlement.isVendorBill)
      };
      try {
        let detail = settlement;
        if (settlement.isIndent) {
          const r = await indentService.getIndentById(settlement._id);
          detail = r?.data || r || settlement;
        } else if (settlement.isUtilityBill) {
          const r = await utilityBillService.getUtilityBill(settlement._id);
          detail = r?.data || r || settlement;
        } else if (settlement.isVendorBill) {
          const r = await api.get(`/finance/accounts-payable/${settlement._id}`);
          detail = r.data?.data || r.data || settlement;
        }
        setViewDialog({
          open: true,
          settlement: withCeoDocTypeFlags({ ...settlement, ...detail }, baseFlags),
          ...baseFlags,
          quotations: [],
          caLinkedDocs: [],
          poQuotations: [],
          poGrns: [],
          poLinkedDocs: [],
          poAuditTab: 0
        });
      } catch (e) {
        console.error('Error fetching assigned document details:', e);
        setViewDialog({
          open: true,
          settlement: withCeoDocTypeFlags(settlement, baseFlags),
          ...baseFlags,
          quotations: [],
          caLinkedDocs: [],
          poQuotations: [],
          poGrns: [],
          poLinkedDocs: [],
          poAuditTab: 0
        });
      }
    } else {
      try {
        const response = await paymentSettlementService.getPaymentSettlement(settlement._id);
        const settlementData = response.data.data || response.data;
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
  };

  /** Keep document-type flags when acting from the view dialog (API payload lacks them). */
  const withCeoDocTypeFlags = (doc, flags = {}) => {
    if (!doc) return doc;
    const isPurchaseOrder =
      Boolean(flags.isPurchaseOrder) ||
      Boolean(doc.isPurchaseOrder) ||
      Boolean(doc.orderNumber) ||
      doc.itemType === 'Purchase Order' ||
      doc.typeLabel === 'Purchase Order';
    const isCashApproval =
      Boolean(flags.isCashApproval) ||
      Boolean(doc.isCashApproval) ||
      Boolean(doc.caNumber) ||
      doc.itemType === 'Cash Approval' ||
      doc.typeLabel === 'Cash Approval';
    const isOnboarding =
      Boolean(flags.isOnboarding) ||
      Boolean(doc.isOnboarding) ||
      Boolean(doc.cnic) ||
      (Array.isArray(doc.employees) && doc.employees.length > 0 && Boolean(doc.recordNumber)) ||
      doc.itemType === 'Onboarding' ||
      doc.itemType === 'New-Employee Onboarding' ||
      doc.itemType === 'New-Hiring Approval' ||
      doc.typeLabel === 'Onboarding' ||
      doc.typeLabel === 'New-Employee Onboarding' ||
      doc.typeLabel === 'New-Hiring Approval';
    const isManualSalary =
      Boolean(flags.isManualSalary) ||
      Boolean(doc.isManualSalary) ||
      doc.itemType === 'Manual Salary' ||
      doc.typeLabel === 'Manual Salary';
    const isIndent =
      Boolean(flags.isIndent) ||
      Boolean(doc.isIndent) ||
      doc.itemType === 'Indent' ||
      Boolean(doc.indentNumber);
    const isUtilityBill =
      Boolean(flags.isUtilityBill) ||
      Boolean(doc.isUtilityBill) ||
      doc.itemType === 'Store / Utility Bill' ||
      Boolean(doc.billId && doc.utilityType);
    const isVendorBill =
      Boolean(flags.isVendorBill) ||
      Boolean(doc.isVendorBill) ||
      doc.itemType === 'Vendor Bill';
    const isPaymentSettlement =
      Boolean(flags.isPaymentSettlement) ||
      Boolean(doc.isPaymentSettlement) ||
      (!isPurchaseOrder && !isCashApproval && !isOnboarding && !isManualSalary && !isIndent && !isUtilityBill && !isVendorBill);

    return {
      ...doc,
      isPurchaseOrder,
      isCashApproval,
      isOnboarding,
      isManualSalary,
      isIndent,
      isUtilityBill,
      isVendorBill,
      isPaymentSettlement,
      itemType: isPurchaseOrder
        ? 'Purchase Order'
        : isCashApproval
          ? 'Cash Approval'
          : isOnboarding
            ? 'New-Hiring Approval'
            : isManualSalary
              ? 'Manual Salary'
            : isIndent
              ? 'Indent'
              : isUtilityBill
                ? getCentralizedStoreDocumentTypeLabel(doc)
                : isVendorBill
                  ? 'Vendor Bill'
                  : doc.itemType || 'Payment Settlement',
      displayRef:
        doc.displayRef ||
        doc.orderNumber ||
        doc.caNumber ||
        doc.indentNumber ||
        doc.billNumber ||
        doc.billId ||
        doc.referenceNumber ||
        doc.recordNumber ||
        doc._id
    };
  };

  // Action Dialog Openers
  const openApprove = (item, flags = {}) => {
    setApproveDialog({ open: true, settlement: withCeoDocTypeFlags(item, flags) });
    setApprovalComments('');
    setApprovalAgree(false);
  };

  const openReject = (item, flags = {}) => {
    setRejectDialog({ open: true, settlement: withCeoDocTypeFlags(item, flags) });
    setRejectionComments('');
    setRejectionAgree(false);
    setRejectObservations([{ observation: '', severity: 'medium' }]);
  };

  const openReturn = (item, flags = {}) => {
    setReturnDialog({ open: true, settlement: withCeoDocTypeFlags(item, flags) });
    setReturnComments('');
    setReturnAgree(false);
    setReturnObservations([{ observation: '', severity: 'medium' }]);
  };

  const openWorkflowHistory = async (item) => {
    if (!item) return;
    let fullDoc = item;
    if (item.isPurchaseOrder && (!item.workflowHistory || item.workflowHistory.length === 0)) {
      try {
        const r = await api.get(`/procurement/purchase-orders/${item._id}`);
        fullDoc = { ...item, ...(r.data?.data || {}) };
      } catch (_) {}
    } else if (item.isCashApproval && (!item.workflowHistory || item.workflowHistory.length === 0)) {
      try {
        const r = await api.get(`/cash-approvals/${item._id}`);
        fullDoc = { ...item, ...(r.data?.data || {}) };
      } catch (_) {}
    } else if (item.isPaymentSettlement && (!item.workflowHistory || item.workflowHistory.length === 0)) {
      try {
        const r = await paymentSettlementService.getPaymentSettlement(item._id);
        fullDoc = { ...item, ...(r.data?.data || r.data?.settlement || {}) };
      } catch (_) {}
    }
    setWorkflowHistoryDialog({ open: true, settlement: fullDoc });
  };

  // Submit Approval
  const resolveDocStatus = (item) =>
    String(item?.workflowStatus || item?.status || '');

  /** CEO-office queue only — not every HM / authority step. */
  const isCeoForwardedStatus = (item) => resolveDocStatus(item) === 'Forwarded to CEO';

  const approveOnboardingForStatus = async (item, payload) => {
    const status = resolveDocStatus(item);
    if (status === 'Pending AVP') return nonEmployeeService.approveByAVP(item._id, payload);
    if (status === 'Pending Chairman') return nonEmployeeService.approveByChairman(item._id, payload);
    if (status === 'Pending HOD HR') return nonEmployeeService.approveByHOD(item._id, payload);
    if (status === 'Pending Sr Director') return nonEmployeeService.approveBySrDirector(item._id, payload);
    if (status === 'Forwarded to CEO') return nonEmployeeService.approveByCEO(item._id, payload);
    return nonEmployeeService.approveByCEO(item._id, payload);
  };

  const rejectOnboardingForStatus = async (item, payload) => {
    const status = resolveDocStatus(item);
    if (status === 'Pending AVP') return nonEmployeeService.rejectByAVP(item._id, payload);
    if (status === 'Pending Chairman') return nonEmployeeService.rejectByChairman(item._id, payload);
    if (status === 'Pending HOD HR') return nonEmployeeService.rejectByHOD(item._id, payload);
    if (status === 'Pending Sr Director') return nonEmployeeService.rejectBySrDirector(item._id, payload);
    if (status === 'Forwarded to CEO') return nonEmployeeService.rejectByCEO(item._id, payload);
    return nonEmployeeService.rejectByCEO(item._id, payload);
  };

  const approveManualSalaryForStatus = async (item, payload) => {
    const status = resolveDocStatus(item);
    if (status === 'Pending HOD HR') return manualSalaryService.approveByHOD(item._id, payload);
    if (status === 'Pending AVP') return manualSalaryService.approveByAVP(item._id, payload);
    if (status === 'Forwarded to CEO') return manualSalaryService.approveByCEO(item._id, payload);
    return manualSalaryService.approveByCEO(item._id, payload);
  };

  const rejectManualSalaryForStatus = async (item, payload) => {
    const status = resolveDocStatus(item);
    if (status === 'Pending HOD HR') return manualSalaryService.rejectByHOD(item._id, payload);
    if (status === 'Pending AVP') return manualSalaryService.rejectByAVP(item._id, payload);
    if (status === 'Forwarded to CEO') return manualSalaryService.rejectByCEO(item._id, payload);
    return manualSalaryService.rejectByCEO(item._id, payload);
  };

  const handleApproveSubmit = async () => {
    if (!approvalAgree) {
      toast.error('Please confirm approval checkbox');
      return;
    }
    const item = withCeoDocTypeFlags(approveDialog.settlement);
    if (!item) return;

    const ceoStep = isCeoForwardedStatus(item);
    if (ceoStep && !canApproveAsCeo) {
      toast.error('Only the designated CEO can approve Forwarded to CEO documents.');
      return;
    }

    const effectiveSig = getAutoDigitalSignature();
    if (!item.isCashApproval && !item.isOnboarding && !item.isManualSalary && !item.isIndent && !item.isUtilityBill && !item.isVendorBill && !effectiveSig) {
      toast.error('No digital signature on your profile. Please add one in Profile settings.');
      return;
    }

    setActionLoading(true);
    try {
      if (item.isPurchaseOrder) {
        if (ceoStep) {
        await api.put(`/procurement/purchase-orders/${item._id}/ceo-approve`, {
          approvalComments,
          digitalSignature: effectiveSig
        });
        } else {
          await api.put(`/procurement/purchase-orders/${item._id}/approve`, {
            comments: approvalComments,
            approvalComments,
            digitalSignature: effectiveSig
          });
        }
        toast.success(`Purchase order ${item.displayRef} approved`);
      } else if (item.isCashApproval) {
        if (ceoStep) {
        await api.put(`/cash-approvals/${item._id}/ceo-approve`, {
          comments: approvalComments,
          approvalComments,
          digitalSignature: effectiveSig
        });
        } else {
          await api.put(`/cash-approvals/${item._id}/approve`, {
            comments: approvalComments,
            approvalComments,
            digitalSignature: effectiveSig
          });
        }
        toast.success(`Cash approval ${item.displayRef} approved`);
      } else if (item.isOnboarding) {
        await approveOnboardingForStatus(item, {
          comments: approvalComments,
          signature: effectiveSig
        });
        toast.success(`New-Hiring Approval ${item.displayRef} approved`);
      } else if (item.isManualSalary) {
        await approveManualSalaryForStatus(item, {
          comments: approvalComments,
          signature: effectiveSig
        });
        toast.success(`Manual salary ${item.displayRef} approved`);
      } else if (item.isIndent) {
        await indentService.approveIndent(item._id);
        toast.success(`Indent ${item.displayRef || item.indentNumber} approved`);
      } else if (item.isUtilityBill) {
        await utilityBillService.approveUtilityBill(item._id, {
          comments: approvalComments,
          digitalSignature: effectiveSig
        });
        toast.success(`Utility bill ${item.displayRef} approved`);
      } else if (item.isVendorBill) {
        await api.post(`/finance/accounts-payable/${item._id}/department-approve`, {
          comments: approvalComments || 'Approved'
        });
        toast.success(`Chart of Accounts bill ${item.displayRef} approved`);
      } else {
        await paymentSettlementService.approvePayment(item._id, {
          comments: approvalComments || 'Approved',
          approvalComments: approvalComments || 'Approved',
          digitalSignature: effectiveSig
        });
        toast.success(`Payment settlement ${item.displayRef} approved`);
      }
      setApproveDialog({ open: false, settlement: null });
      fetchCeoPayments();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve payment');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Rejection
  const handleRejectSubmit = async () => {
    const item = withCeoDocTypeFlags(rejectDialog.settlement);
    if (!rejectionAgree || !rejectionComments.trim()) {
      toast.error('Please provide comments and confirmation');
      return;
    }
    if (!item) return;

    const ceoStep = isCeoForwardedStatus(item);
    if (ceoStep && !canApproveAsCeo) {
      toast.error('Only the designated CEO can reject Forwarded to CEO documents.');
      return;
    }

    const effectiveSig = getAutoDigitalSignature();
    if (!item.isOnboarding && !item.isManualSalary && !item.isIndent && !item.isUtilityBill && !item.isVendorBill && !effectiveSig) {
      toast.error('No digital signature on your profile. Please add one in Profile settings.');
      return;
    }

    setActionLoading(true);
    try {
      const validObs = rejectObservations.filter((o) => o.observation.trim());
      if (item.isPurchaseOrder) {
        if (ceoStep) {
        await api.put(`/procurement/purchase-orders/${item._id}/ceo-reject`, {
          comments: rejectionComments,
            rejectionComments,
            digitalSignature: effectiveSig,
          observations: validObs
        });
        } else {
          await api.put(`/procurement/purchase-orders/${item._id}/reject`, {
            comments: rejectionComments,
            rejectionComments,
            digitalSignature: effectiveSig,
            observations: validObs
          });
        }
      } else if (item.isCashApproval) {
        if (ceoStep) {
        await api.put(`/cash-approvals/${item._id}/ceo-reject`, {
          comments: rejectionComments,
            rejectionComments,
            digitalSignature: effectiveSig,
          observations: validObs
        });
        } else {
          await api.put(`/cash-approvals/${item._id}/reject`, {
            comments: rejectionComments,
            rejectionComments,
            digitalSignature: effectiveSig,
            observations: validObs
          });
        }
      } else if (item.isOnboarding) {
        await rejectOnboardingForStatus(item, {
          comments: rejectionComments,
          signature: effectiveSig,
          observations: validObs
        });
      } else if (item.isManualSalary) {
        await rejectManualSalaryForStatus(item, {
          comments: rejectionComments,
          signature: effectiveSig,
          observations: validObs
        });
      } else if (item.isIndent) {
        await indentService.rejectIndent(item._id, rejectionComments);
      } else if (item.isUtilityBill) {
        await utilityBillService.rejectUtilityBill(item._id, rejectionComments);
      } else if (item.isVendorBill) {
        await api.post(`/finance/accounts-payable/${item._id}/department-reject`, {
          rejectionReason: rejectionComments,
          comments: rejectionComments
        });
      } else {
        await paymentSettlementService.rejectPayment(item._id, {
          comments: rejectionComments,
          digitalSignature: effectiveSig,
          observations: validObs
        });
      }
      toast.success(`${item.itemType} ${item.displayRef} rejected`);
      setRejectDialog({ open: false, settlement: null });
      fetchCeoPayments();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reject payment');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Return (CEO-office queue only)
  const handleReturnSubmit = async () => {
    const validObs = returnObservations.filter((o) => o.observation.trim());
    if (!returnAgree || !returnComments.trim() || validObs.length === 0) {
      toast.error('Please provide return comments, at least one observation, and agree to confirmation');
      return;
    }
    const item = withCeoDocTypeFlags(returnDialog.settlement);
    if (!item) return;

    if (!isCeoForwardedStatus(item) || !canApproveAsCeo) {
      toast.error('Return with observations is only available for Forwarded to CEO documents.');
      return;
    }

    const effectiveSig = getAutoDigitalSignature();
    if (!effectiveSig) {
      toast.error('No digital signature on your profile. Please add one in Profile settings.');
      return;
    }

    setActionLoading(true);
    try {
      if (item.isPurchaseOrder) {
        await api.put(`/procurement/purchase-orders/${item._id}/ceo-return`, {
          comments: returnComments,
          returnComments,
          digitalSignature: effectiveSig,
          observations: validObs
        });
      } else if (item.isCashApproval) {
        await api.put(`/cash-approvals/${item._id}/ceo-return`, {
          comments: returnComments,
          returnComments,
          digitalSignature: effectiveSig,
          observations: validObs
        });
      } else if (item.isOnboarding) {
        await nonEmployeeService.returnByCEO(item._id, {
          comments: returnComments,
          signature: effectiveSig,
          observations: validObs
        });
      } else if (item.isManualSalary) {
        await manualSalaryService.returnByCEO(item._id, {
          comments: returnComments,
          signature: effectiveSig,
          observations: validObs
        });
      } else {
        await paymentSettlementService.updateWorkflowStatus(item._id, {
          workflowStatus: 'Returned from CEO Office',
          comments: returnComments,
          observations: validObs,
          digitalSignature: effectiveSig
        });
      }
      toast.success(`${item.itemType} ${item.displayRef} returned with observations`);
      setReturnDialog({ open: false, settlement: null });
      fetchCeoPayments();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to return payment');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrint = () => {
    if (!viewDialog.settlement) return;
    const settlement = viewDialog.settlement;
    const printDate = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow pop-ups to print');
      return;
    }

    const escapeHtml = (value) => {
      if (value == null || value === '') return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
    const display = (value) => (value == null || String(value).trim() === '' ? '—' : escapeHtml(String(value)));
    const personName = (u) => {
      if (!u) return '';
      return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || '';
    };
    const isImageSig = (sig) => {
      const s = String(sig || '').trim();
      if (!s) return false;
      return (
        s.includes('/uploads/')
        || s.startsWith('data:image')
        || s.startsWith('http')
        || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(s)
      );
    };
    const signatureHtml = (sig, user, alt) => {
      const imagePath = isImageSig(sig)
        ? sig
        : (user?.digitalSignature && isImageSig(user.digitalSignature) ? user.digitalSignature : '');
      if (imagePath) {
        const src = escapeHtml(getImageUrl(imagePath) || imagePath);
        return `<div class="sig-line"><img src="${src}" alt="${escapeHtml(alt)}" /></div>`;
      }
      const typed = String(sig || '').trim() || personName(user);
      if (!typed) return '<div class="sig-line muted">No Signature</div>';
      return `<div class="sig-line typed">${escapeHtml(typed)}</div>`;
    };

    if (viewDialog.isManualSalary) {
      const period = `${MONTH_NAMES[(Number(settlement.month) || 1) - 1] || '—'} ${settlement.year || ''}`.trim();
      const allowanceRows = [
        ['Food Allowance', settlement.foodAllowance],
        ['House Rent Allowance', settlement.houseRentAllowance],
        ['Medical Allowance', settlement.medicalAllowance],
        ['Conveyance Allowance', settlement.conveyanceAllowance],
        ['Vehicle Allowance', settlement.vehicleAllowance],
        ['Fuel Allowance', settlement.fuelAllowance],
        ['Special Allowance', settlement.specialAllowance],
        ['Other Allowance', settlement.otherAllowance],
        ['Income Tax', settlement.incomeTax]
      ].map(([label, value]) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td class="right">${escapeHtml(formatPKR(value || 0))}</td>
        </tr>`).join('');

      const authorityRows = [
        {
          label: 'Initiator',
          by: settlement.initiator,
          at: settlement.initiatedAt || settlement.createdAt,
          sig: settlement.requesterSignature,
          pending: false
        },
        {
          label: 'HOD HR (GM HR)',
          by: settlement.hodApprovedBy || settlement.assignedHod,
          at: settlement.hodApprovedAt,
          sig: settlement.hodSignature,
          pending: !settlement.hodApprovedBy
        },
        {
          label: 'AVP',
          by: settlement.avpApprovedBy || settlement.assignedAvp,
          at: settlement.avpApprovedAt,
          sig: settlement.avpSignature,
          pending: !settlement.avpApprovedBy
        },
        {
          label: 'CEO',
          by: settlement.ceoApprovedBy,
          at: settlement.ceoApprovedAt,
          sig: settlement.ceoSignature,
          pending: !settlement.ceoApprovedBy
        }
      ].map((row) => {
        const name = personName(row.by);
        const statusText = row.pending
          ? (name ? `${name} (Pending)` : 'Pending')
          : (name || (row.label === 'Initiator' ? '—' : 'Approved'));
        return `
          <div class="auth-card">
            <div class="auth-label">${escapeHtml(row.label)}</div>
            <div class="auth-name">${escapeHtml(statusText)}</div>
            ${row.at ? `<div class="muted">${escapeHtml(formatDateTime(row.at))}</div>` : ''}
            ${row.pending ? '<div class="sig-line muted">Awaiting signature</div>' : signatureHtml(row.sig, row.by, `${row.label} Signature`)}
          </div>`;
      }).join('');

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Manual Salary - ${escapeHtml(settlement.name || settlement.empId || '')}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; font-size: 12px; }
    .company { font-size: 15px; font-weight: 700; text-align: center; text-transform: uppercase; margin: 0 0 4px; }
    h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
    .sub { text-align: center; color: #555; margin-bottom: 18px; }
    .header-row { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; border-bottom: 1px solid #ccc; padding-bottom: 12px; }
    .name { font-size: 16px; font-weight: 800; margin: 0 0 4px; }
    .meta { color: #555; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    .field label { display: block; color: #666; font-size: 11px; margin-bottom: 2px; }
    .field .val { font-weight: 700; }
    .net { color: #1b5e20; font-size: 15px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #444; margin: 16px 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
    td.right, th.right { text-align: right; }
    .auth-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 8px; }
    .auth-card { border: 1px solid #ccc; border-radius: 4px; padding: 10px; min-height: 110px; page-break-inside: avoid; }
    .auth-label { font-size: 11px; color: #666; font-weight: 700; margin-bottom: 4px; }
    .auth-name { font-weight: 700; margin-bottom: 2px; }
    .muted { color: #777; font-size: 11px; }
    .sig-line { margin-top: 8px; border-top: 1px solid #ddd; padding-top: 6px; min-height: 36px; }
    .sig-line img { max-height: 60px; max-width: 150px; object-fit: contain; display: block; }
    .typed { font-style: italic; font-family: cursive; font-weight: 600; }
    .remarks { border: 1px dashed #90caf9; background: #f5fbff; padding: 10px; border-radius: 4px; margin-top: 12px; }
    .footer { margin-top: 28px; font-size: 11px; color: #666; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <div class="company">Sardar Group Of Companies</div>
  <h1>Manual Salary Details</h1>
  <div class="sub">Status: ${display(settlement.workflowStatus || settlement.status)} · Period: ${display(period)}</div>

  <div class="header-row">
    <div>
      <div class="name">${display(settlement.name)}</div>
      <div class="meta">${display([settlement.designation, settlement.project].filter(Boolean).join(' · ') || 'Manual Salary')}</div>
    </div>
    <div class="meta" style="text-align:right">
      ${settlement.empId ? `<div>Emp ID: ${display(settlement.empId)}</div>` : ''}
      <div>Period: ${display(period)}</div>
    </div>
  </div>

  <div class="grid">
    <div class="field"><label>Date of Joining</label><div class="val">${display(settlement.doj)}</div></div>
    <div class="field"><label>Basic Salary</label><div class="val">${escapeHtml(formatPKR(settlement.basicSalary || 0))}</div></div>
    <div class="field"><label>Gross Salary</label><div class="val">${escapeHtml(formatPKR(settlement.grossSalary || 0))}</div></div>
    <div class="field"><label>Net Payable</label><div class="val net">${escapeHtml(formatPKR(settlement.netPayable || 0))}</div></div>
  </div>

  <h2>Allowances &amp; Deductions</h2>
  <table>
    <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
    <tbody>${allowanceRows}</tbody>
  </table>

  ${settlement.remarks ? `<div class="remarks"><strong>Remarks</strong><div>${display(settlement.remarks)}</div></div>` : ''}

  <h2>Approval Signatures</h2>
  <div class="auth-grid">${authorityRows}</div>

  <div class="footer">
    <p>Generated from SGC ERP System - CEO Executive Desk</p>
    <p>Printed: ${escapeHtml(printDate)}</p>
  </div>
</body>
</html>`);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 250);
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Payment Settlement - ${settlement?.referenceNumber || settlement?._id || 'N/A'}</title>
          <style>
            body { font-family: 'Times New Roman', serif; padding: 20px; font-size: 14px; }
            .header { text-align: center; margin-bottom: 30px; }
            .header h1 { margin: 0; font-size: 24px; font-weight: bold; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; }
            .info-item { display: flex; }
            .info-label { font-weight: bold; width: 150px; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            .table th, .table td { border: 1px solid #000; padding: 8px; text-align: left; }
            .table th { background-color: #f5f5f5; }
            .total { text-align: right; font-weight: bold; margin-bottom: 40px; }
            .signature-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 50px; }
            .signature-box { border-top: 1px solid #000; padding-top: 10px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${settlement?.parentCompanyName || 'PAYMENT SETTLEMENT'}</h1>
          </div>
          <div class="info-grid">
            <div class="info-item"><span class="info-label">SITE:</span><span>${settlement?.site || 'Head Office'}</span></div>
            <div class="info-item"><span class="info-label">FROM:</span><span>${settlement?.fromDepartment || 'Administration'}</span></div>
            <div class="info-item"><span class="info-label">CUSTODIAN:</span><span>${settlement?.custodian || 'N/A'}</span></div>
            <div class="info-item"><span class="info-label">DATE:</span><span>${formatDateForDocument(settlement?.date)}</span></div>
            <div class="info-item"><span class="info-label">DOCUMENT NO:</span><span>${settlement?.referenceNumber?.trim() || settlement?._id || 'N/A'}</span></div>
            <div class="info-item"><span class="info-label">NOTE:</span><span>${settlement?.attachments && settlement.attachments.length > 0 ? 'All Supportings Attached' : 'No Attachments'}</span></div>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference No</th>
                <th>To Whom Paid</th>
                <th>For What</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${formatDateForDocument(settlement?.date)}</td>
                <td>${settlement?.referenceNumber?.trim() || settlement?._id || 'N/A'}</td>
                <td>${settlement?.toWhomPaid || 'N/A'}</td>
                <td>${settlement?.forWhat || 'N/A'}</td>
                <td style="text-align: right;">${formatPKR(settlement?.amount)}</td>
              </tr>
            </tbody>
          </table>
          <div class="total">
            <strong>Grand Total: ${formatPKR(settlement?.grandTotal || settlement?.amount || 0)}</strong>
          </div>
          <div class="signature-section">
            <div class="signature-box"><div><strong>Prepared By:</strong></div><div>${settlement?.preparedBy || 'N/A'}</div></div>
            <div class="signature-box"><div><strong>Verified By:</strong></div><div>${settlement?.verifiedBy || 'N/A'}</div></div>
            <div class="signature-box"><div><strong>Approved by:</strong></div><div>${settlement?.approvedBy || 'N/A'}</div></div>
          </div>
          <div style="margin-top: 40px; font-size: 12px; color: #666;">
            <p>Generated from SGC ERP System - CEO Executive Desk</p>
            <p>Printed: ${printDate}</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const role = String(user?.role || '');
  const roleLabels = [
    role,
    user?.roleRef?.name,
    user?.roleRef?.displayName,
    ...(Array.isArray(user?.roles) ? user.roles.map((r) => (typeof r === 'string' ? r : r?.name || r?.displayName)) : []),
    ...(Array.isArray(user?.subRoles) ? user.subRoles.map((r) => (typeof r === 'string' ? r : r?.name || r?.displayName)) : [])
  ].map((v) => String(v || '').toLowerCase().trim()).filter(Boolean);
  const isPsRole = roleLabels.some((label) => (
    label === 'ps'
    || label.includes('personal secretary')
    || label === 'ceo secretariat'
    || label.includes('ceo secretariat')
  ));
  const canReceiveExecutiveApprovals = [
    'higher_management',
    'ceo',
    'super_admin',
    'admin',
    'developer'
  ].includes(role) || isPsRole || canApproveAsCeo;

  const canActOnInboxItem = (item) => {
    if (!item) return false;
    if (item.ceoViewOnly) return false;
    if (item.canAct === true) return true;
    if (item.canAct === false) return false;
    const status = item.workflowStatus || item.status || '';
    // Legacy fallback if API omits canAct
    if (status === 'Forwarded to CEO' && !canApproveAsCeo) return false;
    return true;
  };

  /** Return-with-observations is a CEO-office action only. */
  const canReturnInboxItem = (item) =>
    canActOnInboxItem(item)
    && isCeoForwardedStatus(item)
    && canApproveAsCeo
    && !(item.isIndent || item.isUtilityBill || item.isVendorBill);

  // Hide cleanly for users who cannot receive executive/HM approvals and have an empty inbox
  if (!loading && !canReceiveExecutiveApprovals && payments.length === 0) {
    return null;
  }

  const actionBtnSx = (border, bg, hover) => ({
    border: `1px solid ${border}`,
    bgcolor: bg,
    '&:hover': { bgcolor: hover },
    minWidth: { xs: 42, sm: 34 },
    minHeight: { xs: 42, sm: 34 }
  });

  const renderInboxItemActions = (item) => (
    <Stack direction="row" spacing={0.8} justifyContent={{ xs: 'flex-start', sm: 'center' }} flexWrap="wrap" useFlexGap>
      <Tooltip title="View">
        <IconButton
          size="small"
          color="primary"
          onClick={() => openView(item)}
          sx={actionBtnSx('rgba(25, 118, 210, 0.3)', alpha('#1976d2', 0.05), alpha('#1976d2', 0.15))}
        >
          <ViewIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Workflow History">
        <IconButton
          size="small"
          color="info"
          onClick={() => openWorkflowHistory(item)}
          sx={actionBtnSx('rgba(2, 136, 209, 0.3)', alpha('#0288d1', 0.05), alpha('#0288d1', 0.15))}
        >
          <HistoryIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {canActOnInboxItem(item) && (
        <>
          <Tooltip title="Approve">
            <IconButton
              size="small"
              color="success"
              onClick={() => openApprove(item)}
              sx={actionBtnSx('rgba(46, 125, 50, 0.3)', alpha('#2e7d32', 0.08), alpha('#2e7d32', 0.2))}
            >
              <CheckCircleIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reject">
            <IconButton
              size="small"
              color="error"
              onClick={() => openReject(item)}
              sx={actionBtnSx('rgba(211, 47, 47, 0.3)', alpha('#d32f2f', 0.05), alpha('#d32f2f', 0.15))}
            >
              <CancelIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {canReturnInboxItem(item) && (
            <Tooltip title="Return with observations">
              <IconButton
                size="small"
                color="warning"
                onClick={() => openReturn(item)}
                sx={actionBtnSx('rgba(237, 108, 2, 0.3)', alpha('#ed6c02', 0.05), alpha('#ed6c02', 0.15))}
              >
                <WarningIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </>
      )}
    </Stack>
  );

  return (
    <Card
      sx={{
        borderRadius: { xs: 3, sm: 5 },
        background: `linear-gradient(135deg, ${alpha('#0d47a1', 0.04)} 0%, ${alpha('#7b1fa2', 0.04)} 50%, ${alpha('#00897b', 0.03)} 100%)`,
        backdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
        boxShadow: `0 12px 40px ${alpha(theme.palette.primary.main, 0.08)}, 0 4px 12px ${alpha(theme.palette.common.black, 0.04)}`,
        mb: { xs: 3, md: 4 },
        position: 'relative',
        overflow: 'hidden',
        mx: { xs: -0.25, sm: 0 },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '4px',
          background: 'linear-gradient(90deg, #1976d2, #9c27b0, #00acc1, #43a047)'
        }
      }}
    >
      <CardContent sx={{ p: { xs: 1.25, sm: 2.5, md: 3.5 }, '&:last-child': { pb: { xs: 1.5, sm: 2.5, md: 3.5 } } }}>
        {/* Header Bar */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: { xs: 1.5, sm: 2 },
            mb: { xs: 2, sm: 3 }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: { xs: 1.25, sm: 2 }, minWidth: 0 }}>
            <Box
              sx={{
                width: { xs: 40, sm: 48 },
                height: { xs: 40, sm: 48 },
                borderRadius: 3,
                background: 'linear-gradient(135deg, #1976d2 0%, #7b1fa2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 8px 20px rgba(25, 118, 210, 0.35)',
                flexShrink: 0
              }}
            >
              <VerifiedUserIcon sx={{ fontSize: { xs: 22, sm: 26 } }} />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    fontSize: { xs: '1.15rem', sm: '1.5rem' },
                    background: 'linear-gradient(135deg, #0d47a1 0%, #4a148c 100%)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                  }}
                >
                  My Executive Approvals
                </Typography>
                <Chip
                  label={loading ? 'Checking...' : `${payments.length} Pending`}
                  size="small"
                  color={payments.length > 0 ? 'warning' : 'success'}
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    animation: payments.length > 0 ? 'pulse 2s infinite' : 'none'
                  }}
                />
              </Box>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontWeight: 500, fontSize: { xs: '0.75rem', sm: '0.875rem' }, mt: 0.5, display: { xs: 'none', sm: 'block' } }}
              >
                Documents waiting on you — PO, Cash Approval, Settlement, Onboarding, Indent &amp; assigned bills
              </Typography>
            </Box>
          </Box>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ width: { xs: '100%', sm: 'auto' } }}>
            <Tooltip title="Refresh my approval inbox">
              <IconButton
                onClick={fetchCeoPayments}
                disabled={loading}
                sx={{
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                  backgroundColor: alpha(theme.palette.primary.main, 0.05),
                  '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.15) },
                  minWidth: 44,
                  minHeight: 44
                }}
              >
                <RefreshIcon sx={{ animation: loading ? 'rotate 1s linear infinite' : 'none' }} />
              </IconButton>
            </Tooltip>
            <Button
              variant="outlined"
              size="small"
              endIcon={<OpenInNewIcon fontSize="small" />}
              onClick={() => navigate('/general/ceo-secretariat/payments?tab=forwarded')}
              sx={{
                borderRadius: 2.5,
                fontWeight: 600,
                textTransform: 'none',
                flex: { xs: 1, sm: 'none' },
                minHeight: 44,
                borderColor: alpha(theme.palette.primary.main, 0.4),
                '&:hover': { borderColor: theme.palette.primary.main, backgroundColor: alpha(theme.palette.primary.main, 0.05) }
              }}
            >
              {isMobile ? 'Payments Desk' : 'Full Payments Desk'}
            </Button>
          </Stack>
        </Box>

        {/* Metric Summary Cards */}
        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: { xs: 2, sm: 3 } }}>
          {/* Total Pending Value */}
          <Grid item xs={6} sm={6} md={3}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 1.25, sm: 2.2 },
                height: '100%',
                borderRadius: { xs: 2, sm: 3 },
                background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(25, 118, 210, 0.02) 100%)',
                border: '1px solid rgba(25, 118, 210, 0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 1, sm: 2 },
                minWidth: 0
              }}
            >
              <Avatar
                sx={{
                  bgcolor: alpha('#1976d2', 0.15),
                  color: '#1976d2',
                  width: { xs: 32, sm: 44 },
                  height: { xs: 32, sm: 44 },
                  borderRadius: 2.5,
                  display: { xs: 'none', sm: 'flex' },
                  flexShrink: 0
                }}
              >
                <AttachMoneyIcon />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: { xs: '0.62rem', sm: '0.75rem' } }}
                >
                  {isMobile ? 'Pending' : 'Total Pending Amount'}
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 800,
                    color: '#1565c0',
                    lineHeight: 1.2,
                    fontSize: { xs: '0.85rem', sm: '1.25rem' },
                    wordBreak: 'break-word'
                  }}
                >
                  {formatPKR(totalAmount)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.65rem', sm: '0.75rem' } }}>
                  {payments.length} request{payments.length === 1 ? '' : 's'}
                </Typography>
              </Box>
            </Paper>
          </Grid>

          {/* Purchase Orders */}
          <Grid item xs={6} sm={6} md={3}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 1.25, sm: 2.2 },
                height: '100%',
                borderRadius: { xs: 2, sm: 3 },
                background: 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(156, 39, 176, 0.02) 100%)',
                border: '1px solid rgba(156, 39, 176, 0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 1, sm: 2 },
                minWidth: 0
              }}
            >
              <Avatar
                sx={{
                  bgcolor: alpha('#9c27b0', 0.15),
                  color: '#9c27b0',
                  width: { xs: 32, sm: 44 },
                  height: { xs: 32, sm: 44 },
                  borderRadius: 2.5,
                  display: { xs: 'none', sm: 'flex' },
                  flexShrink: 0
                }}
              >
                <ShoppingBagIcon />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: { xs: '0.62rem', sm: '0.75rem' } }}
                >
                  {isMobile ? 'POs' : 'Purchase Orders'}
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 800,
                    color: '#7b1fa2',
                    lineHeight: 1.2,
                    fontSize: { xs: '0.85rem', sm: '1.25rem' },
                    wordBreak: 'break-word'
                  }}
                >
                  {formatPKR(poAmount)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.65rem', sm: '0.75rem' } }}>
                  {poItems.length} pending
                </Typography>
              </Box>
            </Paper>
          </Grid>

          {/* Cash Approvals */}
          <Grid item xs={6} sm={6} md={3}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 1.25, sm: 2.2 },
                height: '100%',
                borderRadius: { xs: 2, sm: 3 },
                background: 'linear-gradient(135deg, rgba(0, 150, 136, 0.08) 0%, rgba(0, 150, 136, 0.02) 100%)',
                border: '1px solid rgba(0, 150, 136, 0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 1, sm: 2 },
                minWidth: 0
              }}
            >
              <Avatar
                sx={{
                  bgcolor: alpha('#009688', 0.15),
                  color: '#00796b',
                  width: { xs: 32, sm: 44 },
                  height: { xs: 32, sm: 44 },
                  borderRadius: 2.5,
                  display: { xs: 'none', sm: 'flex' },
                  flexShrink: 0
                }}
              >
                <WalletIcon />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: { xs: '0.62rem', sm: '0.75rem' } }}
                >
                  {isMobile ? 'Cash' : 'Cash Approvals'}
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 800,
                    color: '#00796b',
                    lineHeight: 1.2,
                    fontSize: { xs: '0.85rem', sm: '1.25rem' },
                    wordBreak: 'break-word'
                  }}
                >
                  {formatPKR(caAmount)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.65rem', sm: '0.75rem' } }}>
                  {caItems.length} pending
                </Typography>
              </Box>
            </Paper>
          </Grid>

          {/* Payment Settlements */}
          <Grid item xs={6} sm={6} md={3}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 1.25, sm: 2.2 },
                height: '100%',
                borderRadius: { xs: 2, sm: 3 },
                background: 'linear-gradient(135deg, rgba(239, 108, 0, 0.08) 0%, rgba(239, 108, 0, 0.02) 100%)',
                border: '1px solid rgba(239, 108, 0, 0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 1, sm: 2 },
                minWidth: 0
              }}
            >
              <Avatar
                sx={{
                  bgcolor: alpha('#ef6c00', 0.15),
                  color: '#ef6c00',
                  width: { xs: 32, sm: 44 },
                  height: { xs: 32, sm: 44 },
                  borderRadius: 2.5,
                  display: { xs: 'none', sm: 'flex' },
                  flexShrink: 0
                }}
              >
                <ReceiptIcon />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: { xs: '0.62rem', sm: '0.75rem' } }}
                >
                  Settlements
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 800,
                    color: '#e65100',
                    lineHeight: 1.2,
                    fontSize: { xs: '0.85rem', sm: '1.25rem' },
                    wordBreak: 'break-word'
                  }}
                >
                  {formatPKR(setAmount)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.65rem', sm: '0.75rem' } }}>
                  {settlementItems.length} pending
                </Typography>
              </Box>
            </Paper>
          </Grid>
        </Grid>

        {/* Filter Tabs & Search */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: { xs: 1, sm: 2 },
            borderBottom: 1,
            borderColor: 'divider',
            pb: { xs: 1, sm: 1.5 },
            mb: { xs: 1.75, sm: 2.5 },
            mx: { xs: -0.5, sm: 0 }
          }}
        >
          <Tabs
            value={filterTab}
            onChange={(_, val) => setFilterTab(val)}
            textColor="primary"
            indicatorColor="primary"
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              width: '100%',
              minHeight: 44,
              '& .MuiTab-root': {
                textTransform: 'none',
                fontWeight: 700,
                fontSize: { xs: '0.78rem', sm: '0.9rem' },
                minHeight: 44,
                px: { xs: 1.25, sm: 2 },
                minWidth: 'auto'
              }
            }}
          >
            <Tab label={`All (${payments.length})`} />
            <Tab label={isMobile ? `PO (${poItems.length})` : `Purchase Orders (${poItems.length})`} />
            <Tab label={isMobile ? `CA (${caItems.length})` : `Cash Approvals (${caItems.length})`} />
            <Tab label={isMobile ? `Settle (${settlementItems.length})` : `Settlements (${settlementItems.length})`} />
            <Tab label={isMobile ? `Onboard (${onboardingItems.length})` : `Onboardings (${onboardingItems.length})`} />
            <Tab label={`Other (${otherItems.length})`} />
          </Tabs>
        </Box>

        {/* Content Table or Empty State */}
        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6, gap: 2 }}>
            <CircularProgress size={36} thickness={4} />
            <Typography variant="body2" color="text.secondary">
              Loading your approval inbox...
            </Typography>
          </Box>
        ) : filteredPayments.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: { xs: 3, sm: 5 },
              textAlign: 'center',
              borderRadius: { xs: 2.5, sm: 4 },
              border: '1px dashed rgba(67, 160, 71, 0.3)',
              backgroundColor: alpha('#43a047', 0.03)
            }}
          >
            <CheckCircleOutlineIcon sx={{ fontSize: { xs: 40, sm: 52 }, color: '#43a047', mb: 1 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#2e7d32', fontSize: { xs: '1rem', sm: '1.25rem' } }}>
              Inbox clear
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', mt: 0.5, fontSize: { xs: '0.8rem', sm: '0.875rem' } }}>
              There are currently no documents waiting for your approval.
            </Typography>
          </Paper>
        ) : isMobile ? (
          <Stack spacing={1.5}>
            {filteredPayments.map((item) => {
              const typeColor = item.isPurchaseOrder ? 'secondary' : item.isCashApproval ? 'info' : 'warning';
              return (
                <Paper
                  key={item._id}
                  elevation={0}
                  sx={{
                    p: 1.75,
                    borderRadius: 2.5,
                    border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
                    background: '#fff',
                    boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.04)}`
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                        <Chip
                          label={item.typeLabel}
                          size="small"
                          color={typeColor}
                          variant="outlined"
                          sx={{ fontWeight: 700, fontSize: '0.68rem', height: 22 }}
                        />
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, wordBreak: 'break-word' }}>
                          {item.displayRef}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }} noWrap>
                        {item.displayVendor}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" noWrap>
                        {getCompanyValue(item)} · {item.department || 'General'}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1565c0' }}>
                        {formatPKR(item.displayAmount)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateForDocument(item.displayDate)}
                      </Typography>
                    </Box>
                  </Stack>
                  {item.displayNotes ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mb: 1.25
                      }}
                    >
                      {item.displayNotes}
                    </Typography>
                  ) : null}
                  {renderInboxItemActions(item)}
                </Paper>
              );
            })}
          </Stack>
        ) : (
          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 3,
              border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch'
            }}
          >
            <Table size="small" sx={{ minWidth: 860 }}>
              <TableHead sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, py: 1.5 }}>Type & Ref #</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Company</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Vendor / Payee</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Department</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Purpose / Notes</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    Amount (PKR)
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700, width: 240 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPayments.map((item) => {
                  const typeColor = item.isPurchaseOrder ? 'secondary' : item.isCashApproval ? 'info' : 'warning';
                  return (
                    <TableRow
                      key={item._id}
                      hover
                      sx={{
                        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.02) }
                      }}
                    >
                      <TableCell sx={{ py: 1.5 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            label={item.typeLabel}
                            size="small"
                            color={typeColor}
                            variant="outlined"
                            sx={{ fontWeight: 700, fontSize: '0.7rem' }}
                          />
                          <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                            {item.displayRef}
                          </Typography>
                        </Stack>
                      </TableCell>

                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                          {getCompanyValue(item)}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {item.displayVendor}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        <Chip
                          label={item.department || 'General'}
                          size="small"
                          sx={{ fontSize: '0.75rem', bgcolor: alpha(theme.palette.grey[500], 0.1) }}
                        />
                      </TableCell>

                      <TableCell sx={{ maxWidth: 220 }}>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                          title={item.displayNotes}
                        >
                          {item.displayNotes}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateForDocument(item.displayDate)}
                        </Typography>
                      </TableCell>

                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontWeight: 800, color: '#1565c0' }}>
                          {formatPKR(item.displayAmount)}
                        </Typography>
                      </TableCell>

                      <TableCell align="center">
                        {renderInboxItemActions(item)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      {/* ========================================================================= */}
      {/* FULL DOCUMENT VIEW MODAL - EXACT SAME WHITE PAPER STYLE AS PAYMENTS.JS   */}
      {/* ========================================================================= */}
      <Dialog
        open={viewDialog.open}
        onClose={() =>
          setViewDialog({
            open: false,
            settlement: null,
            isPurchaseOrder: false,
            isCashApproval: false,
            quotations: [],
            caLinkedDocs: [],
            poQuotations: [],
            poGrns: [],
            poLinkedDocs: [],
            poAuditTab: 0
          })
        }
        maxWidth={false}
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: {
            borderRadius: { xs: 0, sm: 2.5 },
            boxShadow: '0 12px 40px rgba(15, 23, 42, 0.18)',
            background: '#f8fafc',
            width: '100%',
            maxWidth: {
              xs: '100%',
              sm: (viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? '210mm' : 820
            },
            maxHeight: { xs: '100%', sm: '88vh' },
            height: { xs: '100%', sm: 'auto' },
            m: { xs: 0, sm: 2 },
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
              '@media print': {
                boxShadow: 'none',
                maxWidth: '100%',
                margin: 0,
                height: '100%',
                width: '100%',
              maxHeight: '100%',
              borderRadius: 0,
              background: '#ffffff'
              }
          }
        }}
      >
        <DialogTitle
          sx={{
            p: 0,
            m: 0,
            flexShrink: 0,
            '@media print': { display: (viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? 'none' : 'block' }
          }}
        >
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              px: { xs: 1.5, sm: 2 },
              py: 1.25,
              gap: 1,
              flexWrap: 'wrap',
              borderBottom: '1px solid',
              borderColor: 'divider',
              background: '#ffffff'
            }}
          >
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                color: 'text.primary',
                letterSpacing: '-0.01em',
                fontSize: { xs: '0.95rem', sm: '1rem' },
                pr: 1,
                flex: '1 1 auto',
                minWidth: 0
              }}
            >
              {viewDialog.isPurchaseOrder
                ? 'Purchase Order Details'
                : viewDialog.isCashApproval
                ? 'Cash Approval Details'
                : viewDialog.isManualSalary
                ? 'Manual Salary Details'
                : viewDialog.isOnboarding
                ? 'New-Hiring Approval Details'
                : viewDialog.isIndent
                ? 'Indent Details'
                : viewDialog.isUtilityBill
                ? `${getCentralizedStoreDocumentTypeLabel(viewDialog.settlement)} Details`
                : viewDialog.isVendorBill
                ? 'Vendor Bill Details'
                : 'PAYMENT SETTLEMENT'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
              {viewDialog.isPurchaseOrder && (
                <Button
                  variant="outlined"
                  startIcon={<PrintIcon />}
                  onClick={() => window.print()}
                  size="small"
                  sx={{ '@media print': { display: 'none' }, textTransform: 'none', fontWeight: 600 }}
                >
                  Print
                </Button>
              )}
              {viewDialog.isOnboarding && (
                <Button
                  variant="outlined"
                  startIcon={<PrintIcon />}
                  onClick={() => {
                    const result = printNewHiringApproval(viewDialog.settlement);
                    if (!result?.ok) toast.error(result?.message || 'Unable to print');
                  }}
                  size="small"
                  sx={{ '@media print': { display: 'none' }, textTransform: 'none', fontWeight: 600 }}
                >
                  Print
                </Button>
              )}
              <IconButton
                size="small"
                onClick={() =>
                  setViewDialog({
                    open: false,
                    settlement: null,
                    isPurchaseOrder: false,
                    isCashApproval: false,
                    quotations: [],
                    caLinkedDocs: [],
                    poQuotations: [],
                    poGrns: [],
                    poLinkedDocs: [],
                    poAuditTab: 0,
                    isOnboarding: false,
                    isManualSalary: false,
                    isIndent: false,
                    isUtilityBill: false,
                    isVendorBill: false
                  })
                }
                sx={{ color: 'text.secondary', '@media print': { display: 'none' } }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent
          sx={{
            p: 0,
            background: '#f8fafc',
            overflow: 'auto',
            flex: 1,
            '@media print': { p: 0, overflow: 'visible', background: '#ffffff' }
          }}
        >
          {viewDialog.settlement && (
            <Box
              sx={{
                p: (viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? 0 : 1.5,
                background: '#f8fafc',
                fontFamily: (viewDialog.isPurchaseOrder || viewDialog.isCashApproval)
                  ? 'Arial, sans-serif'
                  : 'inherit',
                ...(!(viewDialog.isPurchaseOrder || viewDialog.isCashApproval) && {
                  '& > *': {
                    background: '#ffffff',
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    p: 1.5,
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
                  },
                  '& .MuiTypography-h4': { fontSize: '1.25rem !important', lineHeight: 1.3 },
                  '& .MuiTypography-h5': { fontSize: '1.1rem !important' },
                  '& .MuiTypography-h6': { fontSize: '0.95rem !important' },
                  '& .MuiButton-root': { py: 0.4, px: 1.1, minHeight: { xs: 40, sm: 32 }, fontSize: { xs: '0.8125rem', sm: '0.78rem' } },
                  '& .MuiChip-root': { height: 22, fontSize: '0.72rem' },
                  '& .MuiTableCell-root': { py: 0.65, px: 1, fontSize: '0.78rem' },
                  '& .MuiTableContainer-root': { overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
                  '& .MuiCardContent-root': { p: '12px !important', '&:last-child': { pb: '12px !important' } },
                  '& .MuiGrid-item': { pt: '8px !important' }
                }),
                ...((viewDialog.isPurchaseOrder || viewDialog.isCashApproval) && {
                  background: '#ffffff'
                })
              }}
              className={(viewDialog.isPurchaseOrder || viewDialog.isCashApproval) ? 'print-content' : ''}
            >
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

                  {/* Tab 0: Indent */}
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
                        </Paper>
                      )}
                    </Box>
                  )}

                  {/* Tab 1: Purchase Order View */}
                  {viewDialog.poAuditTab === 1 && (
                    <PODocumentView data={viewDialog.settlement} />
                  )}

                  {/* Tab 2: Comparative Statement */}
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

                  {/* Tab 3: Quotations */}
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
                                <TableCell>Status</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {viewDialog.poQuotations.map((q, idx) => (
                                <TableRow key={q._id || idx}>
                                  <TableCell>{idx + 1}</TableCell>
                                  <TableCell>{q.quotationNumber || q.quotationRef || '—'}</TableCell>
                                  <TableCell>{q.vendor?.name || '—'}</TableCell>
                                  <TableCell>{formatDateForDocument(q.quotationDate || q.createdAt)}</TableCell>
                                  <TableCell align="right">{formatPKR(q.totalAmount || 0)}</TableCell>
                                  <TableCell>
                                    <Chip label={q.status || 'Received'} size="small" />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Box>
                  )}

                  {/* Tab 4: GRNs */}
                  {viewDialog.poAuditTab === 4 && (
                    <Box sx={{ p: 2 }}>
                      {(!viewDialog.poGrns || viewDialog.poGrns.length === 0) ? (
                        <Typography color="text.secondary">No Goods Receipt Notes (GRN) created yet.</Typography>
                      ) : (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>#</TableCell>
                                <TableCell>GRN Number</TableCell>
                                <TableCell>Received Date</TableCell>
                                <TableCell>Received By</TableCell>
                                <TableCell>Status</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {viewDialog.poGrns.map((grn, idx) => (
                                <TableRow key={grn._id || idx}>
                                  <TableCell>{idx + 1}</TableCell>
                                  <TableCell>{grn.receiveNumber || grn.grnNumber || '—'}</TableCell>
                                  <TableCell>{formatDateForDocument(grn.receivedDate || grn.createdAt)}</TableCell>
                                  <TableCell>{grn.receivedBy?.name || grn.receivedBy?.firstName || '—'}</TableCell>
                                  <TableCell>
                                    <Chip label={grn.status || 'Received'} size="small" />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </Box>
                  )}

                  {/* Tab 5: Attached Documents (Full list with Open action) */}
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
              ) : viewDialog.isManualSalary ? (
                <Box sx={{ mb: 2 }}>
                  <Paper 
                    elevation={0} 
                    sx={{ 
                      p: { xs: 3, md: 4 }, 
                      borderRadius: 3, 
                      background: 'linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%)',
                      border: '1px solid',
                      borderColor: 'divider'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, borderBottom: '1px solid', borderColor: 'divider', pb: 2, flexWrap: 'wrap', gap: 2 }}>
                        <Box>
                        <Typography variant="h5" sx={{ fontWeight: 800 }}>
                          {viewDialog.settlement.name || '—'}
                          </Typography>
                        <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
                          {[viewDialog.settlement.designation, viewDialog.settlement.project].filter(Boolean).join(' · ') || 'Manual Salary'}
                          </Typography>
                      </Box>
                      <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                        <Chip 
                          label={viewDialog.settlement.workflowStatus || viewDialog.settlement.status || '—'}
                          size="small" 
                          color={getWorkflowStatusColor(viewDialog.settlement.workflowStatus || viewDialog.settlement.status)}
                          sx={{ mb: 1, fontWeight: 600 }}
                        />
                        <Typography variant="caption" display="block" color="text.secondary">
                          Period:{' '}
                          {MONTH_NAMES[(Number(viewDialog.settlement.month) || 1) - 1] || '—'}{' '}
                          {viewDialog.settlement.year || ''}
                        </Typography>
                        {viewDialog.settlement.empId ? (
                          <Typography variant="caption" display="block" color="text.secondary">
                            Emp ID: {viewDialog.settlement.empId}
                          </Typography>
                        ) : null}
                      </Box>
                    </Box>

                    <Grid container spacing={3}>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="caption" color="text.secondary">Date of Joining</Typography>
                        <Typography variant="body1" fontWeight={600}>{viewDialog.settlement.doj || '—'}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="caption" color="text.secondary">Basic Salary</Typography>
                        <Typography variant="body1" fontWeight={600}>{formatPKR(viewDialog.settlement.basicSalary || 0)}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="caption" color="text.secondary">Gross Salary</Typography>
                        <Typography variant="body1" fontWeight={600}>{formatPKR(viewDialog.settlement.grossSalary || 0)}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="caption" color="text.secondary">Net Payable</Typography>
                        <Typography variant="h6" fontWeight={800} color="success.dark">
                          {formatPKR(viewDialog.settlement.netPayable || 0)}
                          </Typography>
                      </Grid>

                      <Grid item xs={12}>
                        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 1 }}>
                          Allowances &amp; Deductions
                          </Typography>
                        <Table size="small" sx={{ mt: 1 }}>
                          <TableBody>
                            {[
                              ['Food Allowance', viewDialog.settlement.foodAllowance],
                              ['House Rent Allowance', viewDialog.settlement.houseRentAllowance],
                              ['Medical Allowance', viewDialog.settlement.medicalAllowance],
                              ['Conveyance Allowance', viewDialog.settlement.conveyanceAllowance],
                              ['Vehicle Allowance', viewDialog.settlement.vehicleAllowance],
                              ['Fuel Allowance', viewDialog.settlement.fuelAllowance],
                              ['Special Allowance', viewDialog.settlement.specialAllowance],
                              ['Other Allowance', viewDialog.settlement.otherAllowance],
                              ['Income Tax', viewDialog.settlement.incomeTax]
                            ].map(([label, value]) => (
                              <TableRow key={label}>
                                <TableCell sx={{ pl: 0, borderColor: 'divider' }}>{label}</TableCell>
                                <TableCell align="right" sx={{ pr: 0, borderColor: 'divider', fontWeight: 600 }}>
                                  {formatPKR(value || 0)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Grid>

                      {viewDialog.settlement.remarks ? (
                      <Grid item xs={12}>
                          <Box sx={{ p: 2, borderRadius: 2, bgcolor: alpha(theme.palette.info.main, 0.04), border: '1px dashed', borderColor: alpha(theme.palette.info.main, 0.3) }}>
                            <Typography variant="overline" color="info.dark" sx={{ fontWeight: 600 }}>Remarks</Typography>
                            <Typography variant="body2">{viewDialog.settlement.remarks}</Typography>
                        </Box>
                      </Grid>
                      ) : null}

                      <Grid item xs={12}>
                        <Box sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 1, display: 'block', mb: 2 }}>
                            Approval Signatures
                          </Typography>
                          <Grid container spacing={3}>
                            {(() => {
                              const personName = (u) => {
                                if (!u) return '';
                                return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || '';
                              };
                              const isImageSig = (sig) => {
                                const s = String(sig || '').trim();
                                if (!s) return false;
                                return (
                                  s.includes('/uploads/')
                                  || s.startsWith('data:image')
                                  || s.startsWith('http')
                                  || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(s)
                                );
                              };
                              const renderSignature = (sig, user, alt) => {
                                const imagePath = isImageSig(sig)
                                  ? sig
                                  : (user?.digitalSignature && isImageSig(user.digitalSignature) ? user.digitalSignature : '');
                                if (imagePath) {
                                  return (
                                    <Box sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider', pt: 1, display: 'inline-block' }}>
                                      <DigitalSignatureImage userOrPath={{ digitalSignature: imagePath }} alt={alt} />
                                    </Box>
                                  );
                                }
                                const typed = String(sig || '').trim() || personName(user);
                                if (!typed) {
                                  return (
                                    <Box sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider', pt: 1, width: 100 }}>
                                      <Typography variant="caption" color="text.disabled">No Signature</Typography>
                                    </Box>
                                  );
                                }
                                return (
                                  <Box sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
                                    <Typography variant="body2" sx={{ fontStyle: 'italic', fontFamily: 'cursive', fontWeight: 600 }}>
                                      {typed}
                                    </Typography>
                                  </Box>
                                );
                              };

                              const rows = [
                                {
                                  label: 'Initiator',
                                  by: viewDialog.settlement.initiator,
                                  at: viewDialog.settlement.initiatedAt || viewDialog.settlement.createdAt,
                                  sig: viewDialog.settlement.requesterSignature,
                                  comments: null,
                                  alwaysShowName: true
                                },
                                {
                                  label: 'HOD HR (GM HR)',
                                  by: viewDialog.settlement.hodApprovedBy || viewDialog.settlement.assignedHod,
                                  at: viewDialog.settlement.hodApprovedAt,
                                  sig: viewDialog.settlement.hodSignature,
                                  comments: viewDialog.settlement.hodComments,
                                  pending: !viewDialog.settlement.hodApprovedBy
                                },
                                {
                                  label: 'AVP',
                                  by: viewDialog.settlement.avpApprovedBy || viewDialog.settlement.assignedAvp,
                                  at: viewDialog.settlement.avpApprovedAt,
                                  sig: viewDialog.settlement.avpSignature,
                                  comments: viewDialog.settlement.avpComments,
                                  pending: !viewDialog.settlement.avpApprovedBy
                                },
                                {
                                  label: 'CEO',
                                  by: viewDialog.settlement.ceoApprovedBy,
                                  at: viewDialog.settlement.ceoApprovedAt,
                                  sig: viewDialog.settlement.ceoSignature,
                                  comments: viewDialog.settlement.ceoComments,
                                  pending: !viewDialog.settlement.ceoApprovedBy
                                }
                              ];

                              return rows.map((row) => {
                                const name = personName(row.by);
                                return (
                                  <Grid item xs={12} sm={6} md={3} key={row.label}>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                                      {row.label}
                                    </Typography>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {row.alwaysShowName
                                        ? (name || '—')
                                        : row.pending
                                          ? (name ? `${name} (Pending)` : 'Pending')
                                          : (name || 'Approved')}
                              </Typography>
                                    {row.at ? (
                                      <Typography variant="caption" color="text.secondary" display="block">
                                        {formatDateTime(row.at)}
                                </Typography>
                                    ) : null}
                                    {row.comments ? (
                                      <Typography variant="caption" color="text.secondary" display="block">
                                        {row.comments}
                                      </Typography>
                                    ) : null}
                                    {row.alwaysShowName || !row.pending
                                      ? renderSignature(row.sig, row.by, `${row.label} Signature`)
                                      : (
                                        <Box sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider', pt: 1, width: 100 }}>
                                          <Typography variant="caption" color="text.disabled">Awaiting signature</Typography>
                                </Box>
                              )}
                            </Grid>
                                );
                              });
                            })()}
                          </Grid>
                        </Box>
                      </Grid>
                    </Grid>
                  </Paper>
                </Box>
              ) : viewDialog.isOnboarding ? (
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {viewDialog.settlement.recordNumber || viewDialog.settlement.displayRef || 'New-Hiring Approval'}
                              </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Status: {viewDialog.settlement.workflowStatus || viewDialog.settlement.status || '—'}
                        {' · '}
                        Initiated: {formatDateForDocument(viewDialog.settlement.initiatedAt || viewDialog.settlement.createdAt)}
                                </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={viewDialog.settlement.workflowStatus || viewDialog.settlement.status || '—'}
                      color="primary"
                      variant="outlined"
                    />
                  </Box>

                  <ResubmissionHistory record={viewDialog.settlement} sx={{ mb: 3 }} />

                  <Box mb={3}>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 1, display: 'block', mb: 1.5 }}>
                      Candidates recommended for hiring ({getNewHiringEmployees(viewDialog.settlement).length})
                    </Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
                      <Table size="small" sx={{ minWidth: 1000 }}>
                        <TableHead>
                          <TableRow sx={{ bgcolor: 'grey.100' }}>
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
                          {getNewHiringEmployees(viewDialog.settlement).map((emp, index) => {
                            const name = emp.name || [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim() || '—';
                            const designation = emp.designation || emp.role || '—';
                            const pkg = emp.currentPackageMonthly ?? emp.expectedWages;
                            const doj = emp.tentativeDoj
                              ? new Date(emp.tentativeDoj).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                              : '—';
                            const formatted = formatNewHiringPackage(pkg);
                            const pkgLabel = formatted === '—'
                              ? '—'
                              : (/^-?\d+(\.\d+)?$/.test(String(pkg || '').trim()) ? `${formatted} PKR` : formatted);
                            return (
                              <TableRow key={emp._id || index}>
                                <TableCell>{name}</TableCell>
                                <TableCell>{emp.cnic || '—'}</TableCell>
                                <TableCell>{designation}</TableCell>
                                <TableCell>{emp.departmentSubject || '—'}</TableCell>
                                <TableCell>{emp.project || '—'}</TableCell>
                                <TableCell>{emp.location || '—'}</TableCell>
                                <TableCell align="right">{pkgLabel}</TableCell>
                                <TableCell>{doj}</TableCell>
                                <TableCell>{emp.remark || emp.justification || '—'}</TableCell>
                              </TableRow>
                            );
                          })}
                          {getNewHiringEmployees(viewDialog.settlement).length === 0 && (
                            <TableRow>
                              <TableCell colSpan={9} align="center">No candidates</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                                </Box>

                  <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 1, display: 'block', mb: 3 }}>
                      Approval Authorities
                    </Typography>
                    <Grid container spacing={3}>
                      {getNewHiringAuthorityCards(viewDialog.settlement).map((auth) => (
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
              ) : viewDialog.isIndent ? (
                <IndentDetail
                  id={viewDialog.settlement?._id}
                  embedded
                  hideBack
                  hideModuleActions
                />
              ) : viewDialog.isUtilityBill ? (
                <UtilityBillDetails
                  id={viewDialog.settlement?._id}
                  embedded
                  hideBack
                  hideModuleActions
                />
              ) : viewDialog.isVendorBill ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                    Bill Details: {viewDialog.settlement?.billNumber || viewDialog.settlement?.displayRef || '—'}
                  </Typography>
                  <CentralizedStoreBillInvoiceBody
                    bill={{
                      ...viewDialog.settlement,
                      billId: viewDialog.settlement?.billNumber || viewDialog.settlement?.billId,
                      billDate: viewDialog.settlement?.billDate,
                      createdAt: viewDialog.settlement?.createdAt || viewDialog.settlement?.billDate,
                      provider: viewDialog.settlement?.vendorName || viewDialog.settlement?.vendor?.name || viewDialog.settlement?.provider,
                      location: viewDialog.settlement?.company?.name || viewDialog.settlement?.companyName || viewDialog.settlement?.department || 'N/A',
                      notes: viewDialog.settlement?.notes || viewDialog.settlement?.internalNotes || '',
                      forWhat: viewDialog.settlement?.forWhat || viewDialog.settlement?.notes || '',
                      billLines: (viewDialog.settlement?.lineItems && viewDialog.settlement.lineItems.length > 0)
                        ? viewDialog.settlement.lineItems.map((line, idx) => ({
                            ...line,
                            description: line.description || line.itemName || line.name,
                            quantity: line.quantity ?? line.qty,
                            amount: line.amount ?? line.total ?? line.lineTotal,
                            attachments: idx === 0 && viewDialog.settlement?.attachments?.length
                              ? viewDialog.settlement.attachments.map((a) => ({
                                  url: a.path || a.url || a.filename,
                                  originalName: a.originalName || a.filename
                                }))
                              : line.attachments
                          }))
                        : (viewDialog.settlement?.billLines || []),
                      totalAmount: viewDialog.settlement?.totalAmount || viewDialog.settlement?.displayAmount
                    }}
                    showChargesSummary
                  />
                </Box>
              ) : (

                <>
                  {/* Payment Settlement View */}
                  <Box sx={{ mb: 3, borderBottom: '2px solid #000', pb: 2 }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, textAlign: 'center', mb: 3, fontSize: '24px', letterSpacing: '1px' }}>
                      {viewDialog.settlement.parentCompanyName || 'PAYMENT SETTLEMENT'}
                    </Typography>
                    
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>SITE:</Typography>
                        <Typography variant="body2">{viewDialog.settlement.site || 'Head Office'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>FROM:</Typography>
                        <Typography variant="body2">{viewDialog.settlement.fromDepartment || 'Administration'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>CUSTODIAN:</Typography>
                        <Typography variant="body2">{viewDialog.settlement.custodian || 'N/A'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>DATE:</Typography>
                        <Typography variant="body2">{formatDateForDocument(viewDialog.settlement.date)}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>DOCUMENT NUMBER:</Typography>
                        <Typography variant="body2">{viewDialog.settlement.referenceNumber?.trim() || viewDialog.settlement._id || 'N/A'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>NOTE:</Typography>
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
                    <TableContainer component={Paper} sx={{ boxShadow: 'none', border: '1px solid #000' }}>
                      <Table>
                        <TableHead>
                          <TableRow sx={{ background: '#f5f5f5' }}>
                            <TableCell sx={{ border: '1px solid #000', fontWeight: 700, py: 1.5, fontSize: '13px' }}>Date</TableCell>
                            <TableCell sx={{ border: '1px solid #000', fontWeight: 700, py: 1.5, fontSize: '13px' }}>Reference No</TableCell>
                            <TableCell sx={{ border: '1px solid #000', fontWeight: 700, py: 1.5, fontSize: '13px' }}>To Whom Paid</TableCell>
                            <TableCell sx={{ border: '1px solid #000', fontWeight: 700, py: 1.5, fontSize: '13px' }}>For What</TableCell>
                            <TableCell sx={{ border: '1px solid #000', fontWeight: 700, py: 1.5, fontSize: '13px', textAlign: 'right' }}>Amount</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          <TableRow>
                            <TableCell sx={{ border: '1px solid #000', py: 2, fontSize: '13px' }}>{formatDateForDocument(viewDialog.settlement.date)}</TableCell>
                            <TableCell sx={{ border: '1px solid #000', py: 2, fontSize: '13px' }}>{viewDialog.settlement.referenceNumber?.trim() || viewDialog.settlement._id || 'N/A'}</TableCell>
                            <TableCell sx={{ border: '1px solid #000', py: 2, fontSize: '13px' }}>{viewDialog.settlement.toWhomPaid || 'N/A'}</TableCell>
                            <TableCell sx={{ border: '1px solid #000', py: 2, fontSize: '13px', whiteSpace: 'pre-wrap' }}>{viewDialog.settlement.forWhat || 'N/A'}</TableCell>
                            <TableCell sx={{ border: '1px solid #000', py: 2, fontSize: '13px', textAlign: 'right', fontWeight: 600 }}>{formatPKR(viewDialog.settlement.amount)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>

                  {/* Grand Total */}
                  <Box sx={{ mb: 4, display: 'flex', justifyContent: 'flex-end' }}>
                    <Box sx={{ border: '2px solid #000', p: 2, minWidth: '250px', background: '#f9f9f9' }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, textAlign: 'right', fontSize: '18px' }}>
                        Grand Total: {formatPKR(viewDialog.settlement.grandTotal || viewDialog.settlement.amount || 0)}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Approval Section */}
                  <Box sx={{ mt: 4, borderTop: '1px solid #000', pt: 3 }}>
                    <Grid container spacing={4}>
                      <Grid item xs={4}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 2, fontSize: '13px', textDecoration: 'underline' }}>Prepared By:</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, fontSize: '13px' }}>{viewDialog.settlement.preparedBy || 'N/A'}</Typography>
                          <Typography variant="body2" sx={{ fontSize: '12px', color: '#666' }}>{viewDialog.settlement.preparedByDesignation || 'Not specified'}</Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={4}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 2, fontSize: '13px', textDecoration: 'underline' }}>Verified By:</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, fontSize: '13px' }}>{viewDialog.settlement.verifiedBy || 'N/A'}</Typography>
                          <Typography variant="body2" sx={{ fontSize: '12px', color: '#666' }}>{viewDialog.settlement.verifiedByDesignation || 'Not specified'}</Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={4}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 2, fontSize: '13px', textDecoration: 'underline' }}>Approved by:</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, fontSize: '13px' }}>{viewDialog.settlement.approvedBy || 'N/A'}</Typography>
                          <Typography variant="body2" sx={{ fontSize: '12px', color: '#666' }}>{viewDialog.settlement.approvedByDesignation || 'Not specified'}</Typography>
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

                  {/* Document Attachments Section (Identical with ImageViewer trigger) */}
                  {viewDialog.settlement.attachments && viewDialog.settlement.attachments.length > 0 && (
                    <Box sx={{ mt: 4, borderTop: '1px solid #000', pt: 3 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, mb: 2, fontSize: '14px', textDecoration: 'underline' }}>
                        ATTACHMENTS ({viewDialog.settlement.attachments.length}):
                      </Typography>
                      <Box sx={{ border: '1px solid #000', p: 2 }}>
                        <Grid container spacing={1}>
                          {viewDialog.settlement.attachments.map((attachment, index) => {
                            const attachmentUrl = paymentSettlementService.getAttachmentUrl(viewDialog.settlement._id, attachment._id);
                            const isImage = attachment.mimeType && attachment.mimeType.startsWith('image/');
                            const isPdf = attachment.mimeType === 'application/pdf';
                            
                            return (
                              <Grid item xs={12} key={attachment._id || index}>
                                <Box 
                                  sx={{ 
                                    p: 1.5, 
                                    border: '1px solid #ccc', 
                                    cursor: 'pointer', 
                                    transition: 'all 0.2s', 
                                    '&:hover': { borderColor: '#000', background: '#f5f5f5' } 
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
                                  <Typography variant="body2" sx={{ fontSize: '12px', fontWeight: 500 }}>
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

        <DialogActions
          sx={{
            px: { xs: 1.5, sm: 2 },
            py: 1.25,
            borderTop: '1px solid',
            borderColor: 'divider',
            background: '#ffffff',
            justifyContent: 'space-between',
            gap: 1,
            flexShrink: 0,
            flexWrap: 'wrap',
            '@media print': { display: 'none' }
          }}
        >
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' } }}>
            {!viewDialog.isPurchaseOrder && !viewDialog.isCashApproval && (
              <>
                <Chip
                  label={viewDialog.settlement?.workflowStatus || viewDialog.settlement?.status || viewDialog.settlement?.approvalStatus || 'Pending'}
                  color={getWorkflowStatusColor(viewDialog.settlement?.workflowStatus || viewDialog.settlement?.status || 'Draft')}
                  size="small"
                />
                {viewDialog.settlement?.paymentType ? (
                  <Chip label={viewDialog.settlement.paymentType} variant="outlined" size="small" />
                ) : null}
              </>
            )}
            {viewDialog.isCashApproval && (
              <Chip
                label={viewDialog.settlement?.status || 'Draft'}
                color={getWorkflowStatusColor(viewDialog.settlement?.status || 'Draft')}
                size="small"
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', width: { xs: '100%', sm: 'auto' }, justifyContent: { xs: 'stretch', sm: 'flex-end' }, '& .MuiButton-root': { flex: { xs: '1 1 auto', sm: '0 0 auto' }, minHeight: 40 } }}>
            {canActOnInboxItem(viewDialog.settlement) && (
              <>
            <Button
              variant="contained"
              color="success"
              size="small"
              startIcon={<CheckCircleIcon />}
              onClick={() => {
                const flags = {
                  isPurchaseOrder: viewDialog.isPurchaseOrder,
                  isCashApproval: viewDialog.isCashApproval,
                  isOnboarding: viewDialog.isOnboarding,
                  isIndent: viewDialog.isIndent,
                  isUtilityBill: viewDialog.isUtilityBill,
                  isVendorBill: viewDialog.isVendorBill
                };
                const itemToApprove = viewDialog.settlement;
                setViewDialog((prev) => ({ ...prev, open: false }));
                openApprove(itemToApprove, flags);
              }}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Approve
            </Button>
            <Button
              variant="contained"
              color="error"
              size="small"
              startIcon={<CancelIcon />}
              onClick={() => {
                const flags = {
                  isPurchaseOrder: viewDialog.isPurchaseOrder,
                  isCashApproval: viewDialog.isCashApproval,
                  isOnboarding: viewDialog.isOnboarding,
                  isIndent: viewDialog.isIndent,
                  isUtilityBill: viewDialog.isUtilityBill,
                  isVendorBill: viewDialog.isVendorBill
                };
                const itemToReject = viewDialog.settlement;
                setViewDialog((prev) => ({ ...prev, open: false }));
                openReject(itemToReject, flags);
              }}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Reject
            </Button>
            {!(viewDialog.isIndent || viewDialog.isUtilityBill || viewDialog.isVendorBill) && (
            <Button
              variant="contained"
              color="warning"
              size="small"
              startIcon={<WarningIcon />}
              onClick={() => {
                const flags = {
                  isPurchaseOrder: viewDialog.isPurchaseOrder,
                  isCashApproval: viewDialog.isCashApproval,
                  isOnboarding: viewDialog.isOnboarding,
                  isIndent: viewDialog.isIndent,
                  isUtilityBill: viewDialog.isUtilityBill,
                  isVendorBill: viewDialog.isVendorBill
                };
                const itemToReturn = viewDialog.settlement;
                setViewDialog((prev) => ({ ...prev, open: false }));
                openReturn(itemToReturn, flags);
              }}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Return
            </Button>
            )}
              </>
            )}
            <Button
              variant="outlined"
              size="small"
              startIcon={<HistoryIcon />}
              onClick={() => openWorkflowHistory(viewDialog.settlement)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              History
            </Button>
            {!viewDialog.isPurchaseOrder
              && !viewDialog.isCashApproval
              && !viewDialog.isOnboarding
              && !viewDialog.isIndent
              && !viewDialog.isUtilityBill
              && !viewDialog.isVendorBill && (
            <Button
              variant="outlined"
                size="small"
                startIcon={<PrintIcon />}
                onClick={handlePrint}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Print
              </Button>
            )}
            <Button
              size="small"
              onClick={() =>
                setViewDialog({
                  open: false,
                  settlement: null,
                  isPurchaseOrder: false,
                  isCashApproval: false,
                  quotations: [],
                  caLinkedDocs: [],
                  poQuotations: [],
                  poGrns: [],
                  poLinkedDocs: [],
                  poAuditTab: 0,
                  isOnboarding: false,
                  isIndent: false,
                  isUtilityBill: false,
                  isVendorBill: false
                })
              }
              sx={{ textTransform: 'none' }}
            >
              Close
            </Button>
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
      )}

      {/* Image Viewer Dialog */}
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
        fullScreen={isMobile}
        PaperProps={{ sx: { borderRadius: { xs: 0, sm: 2 } } }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">{imageViewer.imageName}</Typography>
          <IconButton
            onClick={() => {
              if (imageViewer.isBlob && imageViewer.imageUrl) {
                URL.revokeObjectURL(imageViewer.imageUrl);
              }
              setImageViewer({ open: false, imageUrl: '', imageName: '', isBlob: false });
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', p: 2 }}>
          {imageViewer.imageUrl && (
            <img
              src={imageViewer.imageUrl}
              alt={imageViewer.imageName}
              style={{
                maxWidth: '100%',
                maxHeight: '70vh',
                objectFit: 'contain'
              }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (imageViewer.isBlob && imageViewer.imageUrl) {
                URL.revokeObjectURL(imageViewer.imageUrl);
              }
              setImageViewer({ open: false, imageUrl: '', imageName: '', isBlob: false });
            }}
          >
            Close
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const link = document.createElement('a');
              link.href = imageViewer.imageUrl;
              link.download = imageViewer.imageName;
              link.target = '_blank';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
          >
            Download
          </Button>
        </DialogActions>
      </Dialog>

      {/* ========================================================================= */}
      {/* APPROVE DIALOG                                                           */}
      {/* ========================================================================= */}
      <Dialog
        open={approveDialog.open}
        onClose={() => setApproveDialog({ open: false, settlement: null })}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{ sx: { borderRadius: { xs: 0, sm: 2 } } }}
      >
        <DialogTitle sx={{ pr: 1, fontSize: { xs: '1.05rem', sm: '1.25rem' } }}>
          {`Approve ${approveDialog.settlement?.itemType || 'Payment'}`}
        </DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You are about to{' '}
            {isCeoForwardedStatus(approveDialog.settlement) ? 'give CEO approval for' : 'approve'}{' '}
            <strong>{approveDialog.settlement?.displayRef}</strong> ({approveDialog.settlement?.itemType}) of amount{' '}
            <strong>{formatPKR(approveDialog.settlement?.displayAmount)}</strong> to{' '}
            <strong>{approveDialog.settlement?.displayVendor}</strong>.
          </Typography>

          {user?.digitalSignature && (
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
            rows={3}
            label="Approval Remarks (Optional)"
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
              isCeoForwardedStatus(approveDialog.settlement)
                ? 'I confirm that I have reviewed all payment details and authorize this approval as CEO'
                : 'I confirm that I have reviewed this document and authorize this approval'
            }
          />
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: { xs: 1.5, sm: 1 }, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1 }}>
          <Button fullWidth={isMobile} onClick={() => setApproveDialog({ open: false, settlement: null })} sx={{ minHeight: 44 }}>
            Cancel
          </Button>
          <Button
            fullWidth={isMobile}
            onClick={handleApproveSubmit}
            variant="contained"
            color="success"
            disabled={actionLoading || !approvalAgree}
            startIcon={<CheckCircleIcon />}
            sx={{ minHeight: 44 }}
          >
            {actionLoading ? <CircularProgress size={20} /> : 'Authorize & Approve'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ========================================================================= */}
      {/* REJECT DIALOG                                                            */}
      {/* ========================================================================= */}
      <Dialog
        open={rejectDialog.open}
        onClose={() => setRejectDialog({ open: false, settlement: null })}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{ sx: { borderRadius: { xs: 0, sm: 2 } } }}
      >
        <DialogTitle sx={{ fontSize: { xs: '1.05rem', sm: '1.25rem' } }}>Reject Payment (CEO)</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You are rejecting <strong>{rejectDialog.settlement?.displayRef}</strong>.
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Rejection Reason (Required)"
            value={rejectionComments}
            onChange={(e) => setRejectionComments(e.target.value)}
            required
            sx={{ mb: 2 }}
          />

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
            label="I confirm the rejection of this payment document"
          />
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: { xs: 1.5, sm: 1 }, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1 }}>
          <Button fullWidth={isMobile} onClick={() => setRejectDialog({ open: false, settlement: null })} sx={{ minHeight: 44 }}>
            Cancel
          </Button>
          <Button
            fullWidth={isMobile}
            onClick={handleRejectSubmit}
            variant="contained"
            color="error"
            disabled={actionLoading || !rejectionAgree || !rejectionComments.trim()}
            startIcon={<CancelIcon />}
            sx={{ minHeight: 44 }}
          >
            {actionLoading ? <CircularProgress size={20} /> : 'Reject Payment'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ========================================================================= */}
      {/* RETURN DIALOG                                                            */}
      {/* ========================================================================= */}
      <Dialog
        open={returnDialog.open}
        onClose={() => setReturnDialog({ open: false, settlement: null })}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{ sx: { borderRadius: { xs: 0, sm: 2 } } }}
      >
        <DialogTitle sx={{ fontSize: { xs: '1.05rem', sm: '1.25rem' } }}>Return with Observations (CEO)</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Return <strong>{returnDialog.settlement?.displayRef}</strong> with required corrections.
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Return Comments (Required)"
            value={returnComments}
            onChange={(e) => setReturnComments(e.target.value)}
            required
            sx={{ mb: 2 }}
          />

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
              Observations (Required)
            </Typography>
            {returnObservations.map((obs, index) => (
              <Box key={index} sx={{ mb: 1.5, p: 1.5, border: '1px solid #ddd', borderRadius: 2 }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} sm={8}>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="Specify observation..."
                      value={obs.observation}
                      onChange={(e) => {
                        const updated = [...returnObservations];
                        updated[index].observation = e.target.value;
                        setReturnObservations(updated);
                      }}
                    />
                  </Grid>
                  <Grid item xs={10} sm={3}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Severity</InputLabel>
                      <Select
                        value={obs.severity}
                        label="Severity"
                        onChange={(e) => {
                          const updated = [...returnObservations];
                          updated[index].severity = e.target.value;
                          setReturnObservations(updated);
                        }}
                      >
                        <MenuItem value="low">Low</MenuItem>
                        <MenuItem value="medium">Medium</MenuItem>
                        <MenuItem value="high">High</MenuItem>
                        <MenuItem value="critical">Critical</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={2} sm={1}>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={returnObservations.length === 1}
                      onClick={() => setReturnObservations(returnObservations.filter((_, i) => i !== index))}
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
              onClick={() => setReturnObservations([...returnObservations, { observation: '', severity: 'medium' }])}
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
            label="I confirm returning this payment with observations as CEO"
          />
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: { xs: 1.5, sm: 1 }, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1 }}>
          <Button fullWidth={isMobile} onClick={() => setReturnDialog({ open: false, settlement: null })} sx={{ minHeight: 44 }}>
            Cancel
          </Button>
          <Button
            fullWidth={isMobile}
            onClick={handleReturnSubmit}
            variant="contained"
            color="warning"
            disabled={actionLoading || !returnAgree || !returnComments.trim() || returnObservations.filter((o) => o.observation.trim()).length === 0}
            startIcon={<WarningIcon />}
            sx={{ minHeight: 44 }}
          >
            {actionLoading ? <CircularProgress size={20} /> : 'Return with Observations'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Workflow History Dialog */}
      {workflowHistoryDialog.open && (
        <WorkflowHistoryDialog
          open={workflowHistoryDialog.open}
          onClose={() => setWorkflowHistoryDialog({ open: false, settlement: null })}
          document={workflowHistoryDialog.settlement}
          documentType={
            workflowHistoryDialog.settlement?.isPurchaseOrder || workflowHistoryDialog.settlement?.orderNumber
              ? 'purchaseOrder'
              : workflowHistoryDialog.settlement?.isCashApproval || workflowHistoryDialog.settlement?.caNumber
              ? 'cashApproval'
              : workflowHistoryDialog.settlement?.isOnboarding || workflowHistoryDialog.settlement?.cnic
              ? 'onboarding'
              : 'settlement'
          }
        />
      )}
    </Card>
  );
};

export default ExecutiveCeoPaymentsSection;
