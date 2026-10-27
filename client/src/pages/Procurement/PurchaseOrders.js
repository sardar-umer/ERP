import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Card,
  CardContent,
  Grid,
  Chip,
  Alert,
  Avatar,
  alpha,
  useTheme,
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
  CircularProgress,
  Stack,
  Divider,
  Tabs,
  Tab,
  Autocomplete,
  Popper,
  useMediaQuery
} from '@mui/material';
import {
  ShoppingCart as ShoppingCartIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Send as SendIcon,
  Print as PrintIcon,
  History as HistoryIcon,
  LockOpen as ReleaseIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../../services/api';
import WorkflowHistoryDialog from '../../components/WorkflowHistoryDialog';
import { DigitalSignatureImage, ProcurementDigitalSignaturesRow } from '../../components/common/DigitalSignatureImage';
import ComparativeStatementView from '../../components/Procurement/ComparativeStatementView';
import QuotationDetailView from '../../components/Procurement/QuotationDetailView';
import StoreVettingNotice from '../../components/Procurement/StoreVettingNotice';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';
import dayjs from 'dayjs';
import { useAuth } from '../../contexts/AuthContext';
import { getCurrentHolder } from '../../utils/documentTracker';
import {
  isSrManagerProcurementApplicable,
  sanitizeApprovalAuthorities,
  formatPurchaseOrderCostCenter
} from '../../utils/purchaseOrderAuthority';
import { PO_A4_ONE_PAGE_PRINT_CSS, printPoFitToOneA4 } from '../../utils/poA4PrintStyles';
import {
  isBlankQuoteItem,
  isQuoteLineStillOrderable
} from '../../utils/comparativeQuoteItemMatch';

const PO_APPROVAL_AUTHORITY_FIELDS = [
  { key: 'preparedBy', label: 'Prepared By' },
  { key: 'managerProcurement', label: 'Manager Procurement' },
  { key: 'srManagerProcurement', label: 'Sr Manager Procurement' },
  { key: 'chiefOperatingOfficer', label: 'Chief operating officer' },
  { key: 'avpTaj', label: 'AVP Taj' },
  { key: 'technicalDepartment', label: 'Technical Department' }
];
const poAuthorityFieldsForDoc = (createdAt) => (
  isSrManagerProcurementApplicable(createdAt)
    ? PO_APPROVAL_AUTHORITY_FIELDS
    : PO_APPROVAL_AUTHORITY_FIELDS.filter((f) => f.key !== 'srManagerProcurement')
);
const normalizeAuthorityToken = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const tokenMatchesAuthorityText = (token, authorityText) => {
  const normalizedToken = normalizeAuthorityToken(token);
  const normalizedAuthorityText = normalizeAuthorityToken(authorityText);
  if (!normalizedToken || !normalizedAuthorityText) return false;
  return normalizedAuthorityText === normalizedToken
    || normalizedAuthorityText.includes(normalizedToken)
    || normalizedToken.includes(normalizedAuthorityText);
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
        <TableContainer component={Box} sx={{ border: '1px solid', borderColor: 'divider', maxWidth: 760 }}>
          <Table size="small">
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
                      <Chip size="small" label={chipLabel} color={chipColor} variant={status === 'pending' ? 'outlined' : 'filled'} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {step?.actedAt ? formatDate(step.actedAt) : '—'}
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
        </TableContainer>
      )}
    </Box>
  );
};

const WidePopper = (props) => {
  const { style, ...rest } = props;
  return (
    <Popper
      {...rest}
      placement="bottom-start"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 900 ? 'calc(100vw - 32px)' : 720,
        ...style
      }}
    />
  );
};

const PurchaseOrders = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { user } = useAuth();
  
  // State management
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [companies, setCompanies] = useState([]);
  
  // Pagination and filters
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  
  // Dialog states (quotationId set when creating PO from Quotations page)
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', data: null, quotationId: null, revisedFromPO: null });
  const [viewDialog, setViewDialog] = useState({ open: false, data: null, attachedGrns: [], quotations: [], poDetailTab: 0 });
  const [workflowHistoryDialog, setWorkflowHistoryDialog] = useState({ open: false, document: null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: null });
  const [rejectDialog, setRejectDialog] = useState({ open: false, order: null });
  const [releaseDialog, setReleaseDialog] = useState({ open: false, order: null, justification: '', saving: false });
  const [rejectionComments, setRejectionComments] = useState('');
  const [rejectObservations, setRejectObservations] = useState([{ observation: '', severity: 'medium' }]);
  const [rejectingOrder, setRejectingOrder] = useState(false);
  
  // Approval authorities for create/edit form (prefilled from comparative statement when creating from quotation)
  const [approvalAuthority, setApprovalAuthority] = useState({
    preparedBy: '',
    verifiedBy: '',
    authorisedRep: '',
    financeRep: '',
    managerProcurement: '',
    srManagerProcurement: ''
  });

  const authoritySearchDebounceRef = useRef(null);
  const [authoritySearchOptions, setAuthoritySearchOptions] = useState([]);
  const [authoritySearchLoading, setAuthoritySearchLoading] = useState(false);

  const loadAuthorityApproverOptions = useCallback(async (q) => {
    try {
      setAuthoritySearchLoading(true);
      const res = await api.get('/indents/approver-candidates', {
        params: { search: q || '', limit: 50 }
      });
      setAuthoritySearchOptions(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      setAuthoritySearchOptions([]);
    } finally {
      setAuthoritySearchLoading(false);
    }
  }, []);

  const approverLabel = (u) => {
    if (!u) return '';
    const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return n || u.email || u.employeeId || '';
  };

  const handleAuthoritySearchInput = (value) => {
    if (authoritySearchDebounceRef.current) clearTimeout(authoritySearchDebounceRef.current);
    authoritySearchDebounceRef.current = setTimeout(() => {
      loadAuthorityApproverOptions(value);
    }, 300);
  };

  useEffect(() => {
    if (!formDialog.open) return;
    loadAuthorityApproverOptions('');
  }, [formDialog.open, loadAuthorityApproverOptions]);
  
  // Observation answers when resubmitting to audit
  const [observationAnswers, setObservationAnswers] = useState({});
  const [ceoAnswer, setCeoAnswer] = useState('');
  
  // Form data
  const [formData, setFormData] = useState({
    vendor: '',
    company: '',
    orderDate: new Date().toISOString().split('T')[0],
    expectedDeliveryDate: '',
    deliveryAddress: '',
    status: 'Draft',
    priority: 'Medium',
    items: [{ description: '', quantity: 1, unit: 'pcs', unitPrice: 0, taxRate: 0, discount: 0 }],
    shippingCost: 0,
    orderDiscount: 0,
    paymentTerms: '',
    notes: '',
    internalNotes: '',
    costCenter: ''
  });

  // Filter cost centers based on selected company in form (or show all if no company selected)
  const filteredCostCenters = useMemo(() => {
    if (!formData.company) return costCenters;
    return costCenters.filter((cc) => {
      const ccCompanyId = cc.company?._id || cc.company;
      return !ccCompanyId || String(ccCompanyId) === String(formData.company);
    });
  }, [costCenters, formData.company]);

  // Prefilled quotation tracking info
  const [quotationPrefillInfo, setQuotationPrefillInfo] = useState(null);

  // When navigated from Quotations with createFromQuotationId, fetch quotation and open create form prefilled
  useEffect(() => {
    const quotationId = location.state?.createFromQuotationId;
    if (!quotationId) return;

    const openCreateFromQuotation = async () => {
      try {
        const res = await api.get(`/procurement/quotations/${quotationId}`);
        if (!res.data?.success || !res.data?.data) return;
        const q = res.data.data;
        const indent = q.indent || {};
        const approvals = indent.comparativeStatementApprovals || {};

        const indentItems = indent.items || [];
        // Count / include by quotation lines (name-matched to indent). Blind index drops lot items.
        const orderableQuoteItems = (q.items || []).filter((item, idx) =>
          isQuoteLineStillOrderable(indentItems, item, idx)
        );
        const totalQuoteItems = (q.items || []).filter((item) => !isBlankQuoteItem(item)).length;
        const filteredItems = orderableQuoteItems.map((item) => ({
          description: item.description || '',
          specification: item.specification || '',
          brand: item.brand || '',
          quantity: item.quantity || 1,
          unit: item.unit || 'pcs',
          unitPrice: item.unitPrice || 0,
          taxRate: item.taxRate || 0,
          discount: item.discount || 0
        }));

        const isFullyOrdered = totalQuoteItems > 0 && filteredItems.length === 0;
        const isPartiallyOrdered = totalQuoteItems > 0 && filteredItems.length > 0 && filteredItems.length < totalQuoteItems;

        setQuotationPrefillInfo({
          quotationNumber: q.quotationNumber,
          indentNumber: indent.indentNumber,
          totalQuoteItems,
          remainingItems: filteredItems.length,
          isFullyOrdered,
          isPartiallyOrdered
        });

        if (isFullyOrdered) {
          setError(`All items for Quotation ${q.quotationNumber || ''} (Indent ${indent.indentNumber || ''}) have already been ordered into Purchase Order(s).`);
          navigate(location.pathname, { replace: true, state: {} });
          return;
        }

        setFormData({
          vendor: q.vendor?._id || q.vendor || '',
          orderDate: new Date().toISOString().split('T')[0],
          expectedDeliveryDate: q.expiryDate ? dayjs(q.expiryDate).format('YYYY-MM-DD') : dayjs().add(30, 'day').format('YYYY-MM-DD'),
          deliveryAddress: q.vendor?.address || '',
          status: 'Draft',
          priority: 'Medium',
          items: filteredItems.length > 0 ? filteredItems : [{ description: '', quantity: 1, unit: 'pcs', unitPrice: 0, taxRate: 0, discount: 0 }],
          shippingCost: 0,
          orderDiscount: 0,
          paymentTerms: q.paymentTerms || '',
          notes: q.notes ? `From quotation ${q.quotationNumber || ''}. ${q.notes}` : `Created from quotation ${q.quotationNumber || ''}`,
          internalNotes: q.indent?.indentNumber ? `Source: Quotation ${q.quotationNumber || ''}, Indent: ${q.indent.indentNumber}` : '',
          costCenter: q.indent?.costCenter?._id || q.indent?.costCenter || ''
        });
        setApprovalAuthority({
          preparedBy: approvals.preparedBy || approverLabel(user) || '',
          managerProcurement: approvals.managerProcurement || '',
          srManagerProcurement: approvals.srManagerProcurement || '',
          chiefOperatingOfficer: approvals.chiefOperatingOfficer || approvals.verifiedBy || '',
          avpTaj: approvals.avpTaj || approvals.authorisedRep || '',
          technicalDepartment: approvals.technicalDepartment || ''
        });
        setFormDialog({ open: true, mode: 'create', data: null, quotationId });
      } catch (err) {
        console.error('Failed to load quotation for PO', err);
        setError(err.response?.data?.message || 'Failed to load quotation');
      }
      navigate(location.pathname, { replace: true, state: {} });
    };

    openCreateFromQuotation();
  }, [location.state?.createFromQuotationId, location.pathname, navigate]);

  const loadPurchaseOrders = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        search,
        status: statusFilter,
        priority: priorityFilter
      };

      const response = await api.get('/procurement/purchase-orders', { params });
      
      if (response.data.success) {
        setPurchaseOrders(response.data.data.purchaseOrders);
        setTotalItems(response.data.data.pagination.totalItems);
      }
    } catch (err) {
      setError('Failed to load purchase orders');
      console.error('Error loading purchase orders:', err);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, statusFilter, priorityFilter]);

  const loadStatistics = useCallback(async () => {
    try {
      const response = await api.get('/procurement/purchase-orders/statistics');
      if (response.data.success) {
        setStatistics(response.data.data);
      }
    } catch (err) {
      console.error('Error loading statistics:', err);
    }
  }, []);

  const loadVendors = useCallback(async () => {
    try {
      const response = await api.get('/procurement/vendors', { params: { limit: 1000 } });
      if (response.data.success) {
        setVendors(response.data.data.vendors);
      }
    } catch (err) {
      console.error('Error loading vendors:', err);
    }
  }, []);

  const loadCostCenters = useCallback(async () => {
    try {
      const response = await api.get('/procurement/cost-centers', { params: { limit: 1000, isActive: true } });
      if (response.data.success) {
        setCostCenters(response.data.data.costCenters || []);
      }
    } catch (err) {
      console.error('Error loading cost centers:', err);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      const response = await api.get('/hr/companies');
      if (response.data.success) {
        setCompanies(response.data.data || []);
      }
    } catch (err) {
      console.error('Error loading companies:', err);
    }
  }, []);

  useEffect(() => {
    loadPurchaseOrders();
  }, [loadPurchaseOrders]);

  useEffect(() => {
    loadStatistics();
    loadVendors();
    loadCostCenters();
    loadCompanies();
  }, [loadStatistics, loadVendors, loadCostCenters, loadCompanies]);

  const handleCreate = () => {
    setApprovalAuthority({
      preparedBy: approverLabel(user) || '',
      managerProcurement: '',
      srManagerProcurement: '',
      chiefOperatingOfficer: '',
      avpTaj: '',
      technicalDepartment: ''
    });
    setFormData({
      vendor: '',
      orderDate: new Date().toISOString().split('T')[0],
      expectedDeliveryDate: '',
      deliveryAddress: '',
      status: 'Draft',
      priority: 'Medium',
      items: [{ description: '', quantity: 1, unit: 'pcs', unitPrice: 0, taxRate: 0, discount: 0 }],
      shippingCost: 0,
      orderDiscount: 0,
      paymentTerms: '',
      notes: '',
      internalNotes: '',
      costCenter: ''
    });
    setFormDialog({ open: true, mode: 'create', data: null, quotationId: null });
  };

  const handleReleaseForResourcing = async () => {
    const { order, justification } = releaseDialog;
    if (!order || !justification.trim()) return;
    try {
      setReleaseDialog((d) => ({ ...d, saving: true }));
      const res = await api.put(`/procurement/purchase-orders/${order._id}/release-for-resourcing`, { justification: justification.trim() });
      setSuccess(res.data?.message || 'PO released for re-sourcing');
      setReleaseDialog({ open: false, order: null, justification: '', saving: false });
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to release PO for re-sourcing');
      setReleaseDialog((d) => ({ ...d, saving: false }));
    }
  };

  const handleEdit = async (order) => {
    try {
      // Fetch full PO data with populated fields (especially audit rejection fields)
      const response = await api.get(`/procurement/purchase-orders/${order._id}`);
      const fullOrder = response.data.success ? response.data.data : order;
      
      setFormData({
        ...fullOrder,
        vendor: fullOrder.vendor?._id || fullOrder.vendor,
        orderDate: fullOrder.orderDate ? new Date(fullOrder.orderDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        expectedDeliveryDate: fullOrder.expectedDeliveryDate ? new Date(fullOrder.expectedDeliveryDate).toISOString().split('T')[0] : '',
        deliveryAddress: fullOrder.deliveryAddress || '',
        orderDiscount: fullOrder.orderDiscount || 0,
        costCenter: fullOrder.costCenter?._id || fullOrder.costCenter || ''
      });
      const approvals = fullOrder.approvalAuthorities || {};
      setApprovalAuthority({
        preparedBy: approvals.preparedBy || '',
        managerProcurement: approvals.managerProcurement || '',
        srManagerProcurement: approvals.srManagerProcurement || '',
        chiefOperatingOfficer: approvals.chiefOperatingOfficer || approvals.verifiedBy || '',
        avpTaj: approvals.avpTaj || approvals.authorisedRep || '',
        technicalDepartment: approvals.technicalDepartment || ''
      });
      // Initialize observation answers if there are observations
      const answers = {};
      if (fullOrder.auditObservations && fullOrder.auditObservations.length > 0) {
        fullOrder.auditObservations.forEach(obs => {
          if (obs.answer) {
            answers[obs._id] = obs.answer;
          }
        });
      }
      if (fullOrder.auditRejectObservations && fullOrder.auditRejectObservations.length > 0) {
        fullOrder.auditRejectObservations.forEach(obs => {
          if (obs.answer) {
            answers[obs._id] = obs.answer;
          }
        });
      }
      setObservationAnswers(answers);
      setCeoAnswer(fullOrder.ceoRejectionAnswer || '');

      setFormDialog({ open: true, mode: 'edit', data: fullOrder, quotationId: null });
    } catch (err) {
      // Fallback to using the order passed in if fetch fails
      setFormData({
        ...order,
        vendor: order.vendor?._id || order.vendor,
        orderDate: order.orderDate ? new Date(order.orderDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        expectedDeliveryDate: order.expectedDeliveryDate ? new Date(order.expectedDeliveryDate).toISOString().split('T')[0] : '',
        deliveryAddress: order.deliveryAddress || '',
        orderDiscount: order.orderDiscount || 0,
        costCenter: order.costCenter?._id || order.costCenter || ''
      });
      const approvals = order.approvalAuthorities || {};
      setApprovalAuthority({
        preparedBy: approvals.preparedBy || '',
        managerProcurement: approvals.managerProcurement || '',
        srManagerProcurement: approvals.srManagerProcurement || '',
        chiefOperatingOfficer: approvals.chiefOperatingOfficer || approvals.verifiedBy || '',
        avpTaj: approvals.avpTaj || approvals.authorisedRep || '',
        technicalDepartment: approvals.technicalDepartment || ''
      });
      setFormDialog({ open: true, mode: 'edit', data: order, quotationId: null });
      setError('Failed to load full purchase order details');
    }
  };

  const handleView = async (order) => {
    try {
      const [poRes, grnRes] = await Promise.all([
        api.get(`/procurement/purchase-orders/${order._id}`),
        api.get('/procurement/goods-receive', { params: { purchaseOrder: order._id, limit: 100 } })
      ]);
      const poData = poRes.data?.success ? poRes.data.data : order;
      const grns = grnRes.data?.success ? (grnRes.data.data?.receives || []) : [];

      let quotations = [];
      const indentId = poData.indent?._id || poData.indent;
      if (indentId) {
        try {
          const qRes = await api.get(`/procurement/quotations/by-indent/${indentId}`);
          quotations = qRes.data?.success ? (qRes.data.data || []) : [];
        } catch {
          quotations = [];
        }
      }

      setViewDialog({ open: true, data: poData, attachedGrns: grns, quotations, poDetailTab: 0 });
    } catch (err) {
      setViewDialog({ open: true, data: order, attachedGrns: [], quotations: [], poDetailTab: 0 });
    }
  };

  // Number to words converter
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

  const formatGRNDate = (d) => {
    if (!d) return '';
    const x = new Date(d);
    const days = String(x.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days}-${months[x.getMonth()]}-${x.getFullYear()}`;
  };

  const formatGRNNumber = (n) => (n == null || n === '') ? '' : Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleDelete = (id) => {
    setDeleteDialog({ open: true, id });
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/procurement/purchase-orders/${deleteDialog.id}`);
      setSuccess('Purchase order deleted successfully');
      setDeleteDialog({ open: false, id: null });
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete purchase order');
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      const payload = { ...formData };
      const authorityCreatedAt = formDialog.mode === 'create' ? new Date() : formDialog.data?.createdAt;
      payload.approvalAuthorities = sanitizeApprovalAuthorities(
        { ...approvalAuthority },
        authorityCreatedAt
      );
      if (formDialog.mode === 'create' && formDialog.quotationId) {
        payload.quotation = formDialog.quotationId;
      }
      if (formDialog.mode === 'create' && formDialog.revisedFromPO?._id) {
        if (!String(payload.replacementJustification || '').trim()) {
          setError('Justification is required to replace a rejected purchase order.');
          setLoading(false);
          return;
        }
        payload.revisedFrom = formDialog.revisedFromPO._id;
      } else {
        delete payload.replacementJustification;
      }

      // Validate items have descriptions and quantity
      const validItems = (payload.items || []).filter(item => item.description && item.description.trim() !== '' && (Number(item.quantity) || 0) > 0);
      if (validItems.length === 0) {
        setError('Cannot create Purchase Order: Please add at least one item with a valid description and quantity.');
        setLoading(false);
        return;
      }
      payload.items = validItems;

      // When editing, ensure status is handled properly
      if (formDialog.mode === 'edit' && formDialog.data) {
        if (formDialog.data.status === 'Rejected') {
          // Pass observation answers specifically for the rejected state
          if (formDialog.data.auditRejectObservations && formDialog.data.auditRejectObservations.length > 0) {
            payload.auditRejectObservations = formDialog.data.auditRejectObservations.map(obs => ({
              ...obs,
              answer: observationAnswers[obs._id] ? observationAnswers[obs._id].trim() : (obs.answer || '')
            }));
          }
          if (ceoAnswer.trim()) {
            payload.ceoRejectionAnswer = ceoAnswer.trim();
          }
        } else if (!payload.status || payload.status === '') {
          payload.status = formDialog.data.status || 'Draft';
        }
      }

      if (formDialog.mode === 'create') {
        await api.post('/procurement/purchase-orders', payload);
        setSuccess(
          formDialog.revisedFromPO
            ? `New purchase order created; rejected PO ${formDialog.revisedFromPO.orderNumber} is now closed`
            : 'Purchase order created successfully'
        );
      } else {
        await api.put(`/procurement/purchase-orders/${formDialog.data._id}`, payload);
        setSuccess(
          formDialog.data.status === 'Rejected'
            ? (formDialog.data.ceoRejectionComments || formDialog.data.ceoRejectedAt
              ? 'Purchase order resubmitted to CEO (prior approval authorities preserved)'
              : 'Purchase order updated and resubmitted to the reviewer successfully')
            : 'Purchase order updated successfully'
        );
      }
      
      setFormDialog({ open: false, mode: 'create', data: null, quotationId: null, revisedFromPO: null });
      setObservationAnswers({}); // Clear observation answers
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save purchase order');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      const res = await api.put(`/procurement/purchase-orders/${id}/approve`);
      setSuccess(res?.data?.message || 'Authority approval recorded successfully');
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to approve purchase order');
    }
  };

  const handleOpenRejectDialog = (order) => {
    setRejectDialog({ open: true, order });
    setRejectionComments('');
    setRejectObservations([{ observation: '', severity: 'medium' }]);
  };

  const addRejectObservation = () => {
    setRejectObservations(prev => [...prev, { observation: '', severity: 'medium' }]);
  };

  const updateRejectObservation = (index, field, value) => {
    setRejectObservations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeRejectObservation = (index) => {
    setRejectObservations(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleConfirmReject = async () => {
    const order = rejectDialog.order;
    if (!order) return;
    const validObservations = rejectObservations
      .filter(o => o.observation.trim())
      .map(o => ({ observation: o.observation.trim(), severity: o.severity || 'medium' }));

    try {
      setRejectingOrder(true);
      await api.put(`/procurement/purchase-orders/${order._id || order}/reject`, {
        rejectionComments: rejectionComments.trim(),
        observations: validObservations
      });
      setSuccess('Purchase order rejected with observations successfully');
      setRejectDialog({ open: false, order: null });
      setRejectionComments('');
      setRejectObservations([{ observation: '', severity: 'medium' }]);
      if (viewDialog.open) {
        setViewDialog(prev => ({ ...prev, open: false, data: null }));
      }
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reject purchase order');
    } finally {
      setRejectingOrder(false);
    }
  };

  const handleSendToAudit = async (id, order = null) => {
    try {
      // If order is provided and has observations, prepare observation answers
      let payload = {};
      if (order && order.auditObservations && order.auditObservations.length > 0) {
        const answers = order.auditObservations
          .filter(obs => observationAnswers[obs._id] && observationAnswers[obs._id].trim())
          .map(obs => ({
            observationId: obs._id,
            answer: observationAnswers[obs._id].trim()
          }));
        if (answers.length > 0) {
          payload.observationAnswers = answers;
        }
      }
      
      await api.put(`/procurement/purchase-orders/${id}/send-to-audit`, payload);
      setSuccess('Purchase order sent to audit successfully. It will appear in the Pre-Audit page.');
      setObservationAnswers({}); // Clear observation answers
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send purchase order to audit');
    }
  };

  const handleSendToStore = async (id) => {
    try {
      await api.put(`/procurement/purchase-orders/${id}/send-to-store`, {
        comments: 'Sent to Store from Procurement'
      });
      setSuccess('Purchase order sent to store successfully');
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send purchase order to store');
    }
  };

  const handleFinanceApprove = async (id) => {
    try {
      // Optional field in API; prompt keeps the flow unblocked without extra UI complexity.
      const approvalComments = window.prompt('Finance approval comments (optional):', 'Approved by Finance') || '';
      await api.put(`/procurement/purchase-orders/${id}/finance-approve`, {
        approvalComments
      });
      setSuccess('Purchase order approved by Finance successfully');
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to approve purchase order by Finance');
    }
  };

  const handleSendToPostGrnAudit = async (id) => {
    try {
      await api.post(`/procurement/store/po/${id}/send-to-audit`);
      setSuccess('Purchase order sent to Audit for post-GRN review');
      loadPurchaseOrders();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send purchase order to Audit');
    }
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { description: '', quantity: 1, unit: 'pcs', unitPrice: 0, taxRate: 0, discount: 0 }]
    }));
  };

  const removeItem = (index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const updateItem = (index, field, value) => {
    const items = [...formData.items];
    items[index][field] = value;
    setFormData(prev => ({ ...prev, items }));
  };

  const calculateTotal = () => {
    const subtotal = formData.items.reduce((sum, item) => {
      const itemSubtotal = item.quantity * item.unitPrice - (item.discount || 0);
      return sum + itemSubtotal;
    }, 0);
    
    const tax = formData.items.reduce((sum, item) => {
      const itemSubtotal = item.quantity * item.unitPrice - (item.discount || 0);
      return sum + (itemSubtotal * (item.taxRate || 0) / 100);
    }, 0);
    
    return subtotal + tax + (formData.shippingCost || 0) - (formData.orderDiscount || 0);
  };

  const getStatusColor = (status) => {
    const colors = {
      'Draft': 'default',
      'Pending Approval': 'warning',
      'Pending Audit': 'warning',
      'Forwarded to Audit Director': 'primary',
      'Pending Finance': 'info',
      'Send to CEO Office': 'info',
      'Forwarded to CEO': 'primary',
      'Approved': 'success',
      'Sent to Store': 'info',
      'GRN Created': 'info',
      'Sent to Procurement': 'info',
      'Sent to Audit': 'secondary',
      'Sent to Finance': 'primary',
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

  const isFullAdvanceOrder = (order) => {
    const terms = String(order?.paymentTerms || '').toLowerCase().trim();
    if (!terms) return false;
    return terms.includes('full advance') || (terms.includes('advance') && !terms.includes('partial'));
  };

  const isAssignedAuthorityUser = (order) => {
    const uid = String(user?.id || user?._id || '');
    if (!uid) return false;
    const csa = order?.indent?.comparativeStatementApprovals || {};
    const authorityIds = [
      csa.preparedByUser?._id || csa.preparedByUser,
      csa.verifiedByUser?._id || csa.verifiedByUser,
      csa.authorisedRepUser?._id || csa.authorisedRepUser,
      csa.financeRepUser?._id || csa.financeRepUser,
      csa.managerProcurementUser?._id || csa.managerProcurementUser
    ].map((id) => String(id || '')).filter(Boolean);
    const chainIds = Array.isArray(order?.indent?.comparativeApproval?.approvers)
      ? order.indent.comparativeApproval.approvers.map((s) => String(s?.approver?._id || s?.approver || '')).filter(Boolean)
      : [];
    const csaText = sanitizeApprovalAuthorities(order?.approvalAuthorities, order?.createdAt);
    const userTokens = [
      normalizeAuthorityToken(`${user?.firstName || ''} ${user?.lastName || ''}`),
      normalizeAuthorityToken(user?.email),
      normalizeAuthorityToken(user?.employeeId)
    ].filter(Boolean);
    const textAssigned = [
      csaText.preparedBy,
      csaText.managerProcurement,
      csaText.srManagerProcurement,
      csaText.chiefOperatingOfficer || csaText.verifiedBy,
      csaText.avpTaj || csaText.authorisedRep,
      csaText.technicalDepartment,
      csaText.financeRep
    ].map((v) => normalizeAuthorityToken(v)).filter(Boolean);
    return [...authorityIds, ...chainIds].includes(uid)
      || userTokens.some((t) => textAssigned.some((assigned) => tokenMatchesAuthorityText(t, assigned)));
  };
  const hasCurrentUserApprovedAuthority = (order) => {
    const uid = String(user?.id || user?._id || '');
    if (!uid) return false;
    return Array.isArray(order?.authorityApprovals)
      && order.authorityApprovals.some((a) => String(a?.approver?._id || a?.approver || '') === uid);
  };

  const getStatusLabel = (order) => {
    if (!order) return '';
    if (order.status === 'Approved' && (order.financeApprovedAt || order.financeApprovedBy)) {
      return 'Finance Approved';
    }
    return order.status;
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

  // Statistics cards
  const stats = [
    {
      title: 'Total Orders',
      value: statistics?.totalOrders || 0,
      color: theme.palette.primary.main,
      bgColor: alpha(theme.palette.primary.main, 0.1)
    },
    {
      title: 'Total Value',
      value: formatPKR(statistics?.totalValue || 0),
      color: theme.palette.success.main,
      bgColor: alpha(theme.palette.success.main, 0.1)
    },
    {
      title: 'Pending Approval',
      value: statistics?.byStatus?.find(s => s._id === 'Pending Approval')?.count || 0,
      color: theme.palette.warning.main,
      bgColor: alpha(theme.palette.warning.main, 0.1)
    },
    {
      title: 'Approved',
      value: statistics?.byStatus?.find(s => s._id === 'Approved')?.count || 0,
      color: theme.palette.info.main,
      bgColor: alpha(theme.palette.info.main, 0.1)
    }
  ];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 56, height: 56 }}>
              <ShoppingCartIcon fontSize="large" />
            </Avatar>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>
                Purchase Orders
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Manage procurement purchase orders
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => {
                loadPurchaseOrders();
                loadStatistics();
                loadVendors();
              }}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleCreate}
            >
              New Purchase Order
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {stats.map((stat, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: stat.bgColor, color: stat.color, width: 48, height: 48 }}>
                    <ShoppingCartIcon />
                  </Avatar>
                  <Box>
                    <Typography variant="body2" color="textSecondary">
                      {stat.title}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                      {stat.value}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Filters and Search */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search orders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
              }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="Draft">Draft</MenuItem>
              <MenuItem value="Pending Approval">Pending Approval</MenuItem>
              <MenuItem value="Pending Audit">Pending Audit</MenuItem>
              <MenuItem value="Forwarded to Audit Director">Forwarded to Audit Director</MenuItem>
              <MenuItem value="Pending Finance">Pending Finance</MenuItem>
              <MenuItem value="Send to CEO Office">Send to CEO Office</MenuItem>
              <MenuItem value="Forwarded to CEO">Forwarded to CEO</MenuItem>
              <MenuItem value="Approved">Approved</MenuItem>
              <MenuItem value="Sent to Store">Sent to Store</MenuItem>
              <MenuItem value="GRN Created">GRN Created</MenuItem>
              <MenuItem value="Sent to Procurement">Sent to Procurement</MenuItem>
              <MenuItem value="Sent to Audit">Sent to Audit</MenuItem>
              <MenuItem value="Sent to Finance">Sent to Finance</MenuItem>
              <MenuItem value="Ordered">Ordered</MenuItem>
              <MenuItem value="Partially Received">Partially Received</MenuItem>
              <MenuItem value="Received">Received</MenuItem>
              <MenuItem value="Returned from Audit">Returned from Audit</MenuItem>
              <MenuItem value="Returned from CEO Office">Returned from CEO Office</MenuItem>
              <MenuItem value="Returned from CEO Secretariat">Returned from CEO Secretariat</MenuItem>
              <MenuItem value="Rejected">Rejected</MenuItem>
              <MenuItem value="Cancelled">Cancelled</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              select
              size="small"
              label="Priority"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <MenuItem value="">All Priorities</MenuItem>
              <MenuItem value="Low">Low</MenuItem>
              <MenuItem value="Medium">Medium</MenuItem>
              <MenuItem value="High">High</MenuItem>
              <MenuItem value="Urgent">Urgent</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </Paper>

      {/* Purchase Orders Table */}
      <Paper>
        <TableContainer sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <Table sx={{ minWidth: 960 }}>
            <TableHead>
              <TableRow>
                <TableCell><strong>Order Number</strong></TableCell>
                <TableCell><strong>Vendor</strong></TableCell>
                <TableCell><strong>Initiator</strong></TableCell>
                <TableCell><strong>Order Date</strong></TableCell>
                <TableCell><strong>Expected Delivery</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell><strong>Currently With</strong></TableCell>
                <TableCell><strong>Priority</strong></TableCell>
                <TableCell align="right"><strong>Total Amount</strong></TableCell>
                <TableCell align="center"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} align="center">
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : purchaseOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} align="center">
                    <Typography variant="body2" color="textSecondary">
                      No purchase orders found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                purchaseOrders.map((order) => (
                  <TableRow key={order._id} hover>
                    <TableCell>{order.orderNumber}</TableCell>
                    <TableCell>{order.vendor?.name || 'N/A'}</TableCell>
                    <TableCell>
                      {order.createdBy
                        ? `${order.createdBy.firstName || ''} ${order.createdBy.lastName || ''}`.trim() || order.createdBy.email || '—'
                        : '—'}
                    </TableCell>
                    <TableCell>{formatDate(order.orderDate)}</TableCell>
                    <TableCell>{formatDate(order.expectedDeliveryDate)}</TableCell>
                    <TableCell>
                      <Chip 
                        label={getStatusLabel(order)}
                        color={getStatusColor(order.status)}
                        size="small"
                      />
                      {order.supersededBy ? (
                        <Typography variant="caption" display="block" color="text.secondary">
                          Closed — replaced by {order.supersededBy.orderNumber || 'new PO'}
                        </Typography>
                      ) : order.resourcingReleasedAt && (
                        <Typography variant="caption" display="block" color="warning.main">
                          Closed — released for re-sourcing, awaiting new PO
                        </Typography>
                      )}
                      {order.status === 'Rejected' && order.replacementJustification && (
                        <Tooltip title={order.replacementJustification}>
                          <Typography variant="caption" display="block" color="text.secondary" noWrap sx={{ maxWidth: 220 }}>
                            Justification: {order.replacementJustification}
                          </Typography>
                        </Tooltip>
                      )}
                      {order.revisedFrom && (
                        <Tooltip title={order.revisedFrom.replacementJustification ? `Justification: ${order.revisedFrom.replacementJustification}` : ''}>
                          <Typography variant="caption" display="block" color="text.secondary">
                            Replaces {order.revisedFrom.orderNumber || 'rejected PO'}
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const tracker = getCurrentHolder('PO', order);
                        return (
                          <Chip 
                            label={tracker.holder}
                            color={tracker.type === 'authority' || tracker.type === 'user' ? 'secondary' : tracker.type === 'department' ? 'info' : 'default'}
                            variant="outlined"
                            size="small"
                          />
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={order.priority} 
                        color={getPriorityColor(order.priority)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">{formatPKR(order.totalAmount)}</TableCell>
                    <TableCell align="center">
                      <Tooltip title="View">
                        <IconButton size="small" onClick={() => handleView(order)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {(order.status === 'Draft' || order.status === 'Returned from Audit' || order.status === 'Returned from CEO Secretariat' || order.status === 'Returned from Finance') && (
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => handleEdit(order)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {order.status === 'Rejected' && !order.supersededBy && !order.resourcingReleasedAt && (
                        <Tooltip title="Release for re-sourcing (reopen Comparative Statement & quotation)">
                          <IconButton size="small" color="warning" onClick={() => setReleaseDialog({ open: true, order, justification: '', saving: false })}>
                            <ReleaseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {(order.status === 'Draft' || order.status === 'Returned from Audit' || order.status === 'Returned from CEO Secretariat' || order.status === 'Returned from Finance') && (
                        <Tooltip title="Send to Audit">
                          <IconButton size="small" color="primary" onClick={() => handleSendToAudit(order._id, order)}>
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {order.status === 'Pending Approval' && isAssignedAuthorityUser(order) && !hasCurrentUserApprovedAuthority(order) && (
                        <Tooltip title="Approve">
                          <IconButton size="small" color="success" onClick={() => handleApprove(order._id)}>
                            <ApproveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {order.status === 'Pending Approval' && isAssignedAuthorityUser(order) && !hasCurrentUserApprovedAuthority(order) && (
                        <Tooltip title="Reject with Observation">
                          <IconButton size="small" color="error" onClick={() => handleOpenRejectDialog(order)}>
                            <RejectIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {order.status === 'Pending Finance' && !isFullAdvanceOrder(order) && (
                        <Tooltip title="Finance Approve">
                          <IconButton size="small" color="primary" onClick={() => handleFinanceApprove(order._id)}>
                            <ApproveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {order.status === 'Approved' && (
                        <Tooltip title="Send to Store">
                          <IconButton size="small" color="primary" onClick={() => handleSendToStore(order._id)}>
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {order.status === 'Sent to Procurement' && (
                        <Tooltip title="Send to Audit">
                          <IconButton size="small" color="secondary" onClick={() => handleSendToPostGrnAudit(order._id)}>
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {order.status === 'Draft' && (
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => handleDelete(order._id)}>
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
          onPageChange={(e, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[5, 10, 25, 50]}
        />
      </Paper>

      {/* Create/Edit Dialog */}
      <Dialog 
        open={formDialog.open} 
        onClose={() => {
          setFormDialog({ open: false, mode: 'create', data: null, quotationId: null, revisedFromPO: null });
          setObservationAnswers({}); // Clear observation answers
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {formDialog.mode === 'create'
            ? (formDialog.revisedFromPO ? `Create New PO (replacing rejected ${formDialog.revisedFromPO.orderNumber})` : 'Create Purchase Order')
            : 'Edit Purchase Order'}
        </DialogTitle>
        <DialogContent>
          {formDialog.mode === 'create' && formDialog.revisedFromPO && (
            <Alert severity="info" sx={{ mt: 1 }}>
              Prefilled from rejected PO <strong>{formDialog.revisedFromPO.orderNumber}</strong>
              {formDialog.revisedFromPO.rejectReason ? ` — rejection: ${formDialog.revisedFromPO.rejectReason}` : ''}.
              {' '}Change vendor, quantities or prices as needed. The new PO goes through the full approval chain and the rejected PO will be closed.
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Vendor"
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                required
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                helperText={(() => {
                  const sel = vendors.find((v) => v._id === formData.vendor);
                  const val = sel?.ntnCnic || sel?.ntnNo || sel?.cnic;
                  return val ? `ntn / cnic : ${val}` : '';
                })()}
              >
                {vendors.map((vendor) => {
                  const val = vendor.ntnCnic || vendor.ntnNo || vendor.cnic;
                  return (
                    <MenuItem key={vendor._id} value={vendor._id}>
                      {vendor.name} {val ? `(NTN/CNIC: ${val})` : ''}
                    </MenuItem>
                  );
                })}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Company (Optional)"
                value={formData.company || ''}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                helperText="Filters available cost centers"
              >
                <MenuItem value=""><em>All / General</em></MenuItem>
                {companies.map((comp) => (
                  <MenuItem key={comp._id} value={comp._id}>
                    {comp.name} {comp.code ? `(${comp.code})` : ''}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Cost Center"
                value={formData.costCenter || ''}
                onChange={(e) => setFormData({ ...formData, costCenter: e.target.value })}
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {filteredCostCenters.map((cc) => (
                  <MenuItem key={cc._id} value={cc._id}>
                    {cc.level > 0 ? ' '.repeat(cc.level * 3) + '↳ ' : ''}{cc.code} — {cc.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
              >
                <MenuItem value="Low">Low</MenuItem>
                <MenuItem value="Medium">Medium</MenuItem>
                <MenuItem value="High">High</MenuItem>
                <MenuItem value="Urgent">Urgent</MenuItem>
              </TextField>
            </Grid>
            {formDialog.mode === 'edit' && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  select
                  label="Status"
                  value={formData.status || 'Draft'}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                >
                  <MenuItem value="Draft">Draft</MenuItem>
                  <MenuItem value="Pending Audit">Pending Audit</MenuItem>
                  <MenuItem value="Forwarded to Audit Director">Forwarded to Audit Director</MenuItem>
                  <MenuItem value="Pending Finance">Pending Finance</MenuItem>
                  <MenuItem value="Send to CEO Office">Send to CEO Office</MenuItem>
                  <MenuItem value="Forwarded to CEO">Forwarded to CEO</MenuItem>
                  <MenuItem value="Approved">Approved</MenuItem>
                  <MenuItem value="Sent to Store">Sent to Store</MenuItem>
                  <MenuItem value="GRN Created">GRN Created</MenuItem>
                  <MenuItem value="Sent to Procurement">Sent to Procurement</MenuItem>
                  <MenuItem value="Sent to Audit">Sent to Audit</MenuItem>
                  <MenuItem value="Sent to Finance">Sent to Finance</MenuItem>
                  <MenuItem value="Ordered">Ordered</MenuItem>
                  <MenuItem value="Partially Received">Partially Received</MenuItem>
                  <MenuItem value="Received">Received</MenuItem>
                  <MenuItem value="Rejected">Rejected</MenuItem>
                  <MenuItem value="Returned from Audit">Returned from Audit</MenuItem>
                  <MenuItem value="Returned from Finance">Returned from Finance</MenuItem>
                  <MenuItem value="Returned from CEO Office">Returned from CEO Office</MenuItem>
                  <MenuItem value="Returned from CEO Secretariat">Returned from CEO Secretariat</MenuItem>
                  <MenuItem value="Cancelled">Cancelled</MenuItem>
                </TextField>
              </Grid>
            )}
            
            {/* Audit Rejection Observations - Show in edit mode if PO was rejected */}
            {formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected' && formDialog.data?.auditRejectObservations && formDialog.data.auditRejectObservations.length > 0 && (
              <Grid item xs={12}>
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                    Audit Rejection Observations - Please address these issues:
                  </Typography>
                  {formDialog.data.auditRejectionComments && (
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Rejection Comments:</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {formDialog.data.auditRejectionComments}
                      </Typography>
                    </Box>
                  )}
                  {formDialog.data.auditRejectObservations.map((obs, index) => (
                    <Box key={index} sx={{ mb: 1.5, p: 1.5, bgcolor: alpha(theme.palette.error.main, 0.05), borderRadius: 1, border: '1px solid', borderColor: 'error.light' }}>
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
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {obs.observation}
                      </Typography>
                      {obs.answer && (
                        <Box sx={{ mb: 1.5, p: 1, bgcolor: 'error.light', borderRadius: 1 }}>
                          <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                            Previous Answer:
                          </Typography>
                          <Typography variant="body2">
                            {obs.answer}
                          </Typography>
                          {obs.answeredBy && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                              Answered by: {obs.answeredBy?.firstName || ''} {obs.answeredBy?.lastName || ''}
                              {obs.answeredAt && ` on ${formatDate(obs.answeredAt)}`}
                            </Typography>
                          )}
                        </Box>
                      )}
                      <TextField
                        fullWidth
                        multiline
                        rows={3}
                        label={`Your Response to Observation ${index + 1}${obs.answer ? ' (Update existing answer)' : ''}`}
                        value={observationAnswers[obs._id] || obs.answer || ''}
                        onChange={(e) => setObservationAnswers(prev => ({
                          ...prev,
                          [obs._id]: e.target.value
                        }))}
                        placeholder="Provide your response to this rejection observation..."
                        sx={{ mt: 1 }}
                      />
                    </Box>
                  ))}
                  {formDialog.data.auditRejectedBy && (
                    <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                      Rejected by: {formDialog.data.auditRejectedBy?.firstName || ''} {formDialog.data.auditRejectedBy?.lastName || ''}
                      {formDialog.data.auditRejectedAt && ` on ${formatDate(formDialog.data.auditRejectedAt)}`}
                    </Typography>
                  )}
                </Alert>
              </Grid>
            )}
            
            {/* CEO Rejection Observations - Show in edit mode if PO was rejected by CEO */}
            {formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected' && formDialog.data?.ceoRejectionComments && (
              <Grid item xs={12}>
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                    CEO Rejection Comments - Please address this issue:
                  </Typography>
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {formDialog.data.ceoRejectionComments}
                    </Typography>
                  </Box>
                  
                  {formDialog.data.ceoRejectionAnswer && (
                    <Box sx={{ mb: 1.5, p: 1, bgcolor: 'error.light', borderRadius: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                        Previous Answer:
                      </Typography>
                      <Typography variant="body2">
                        {formDialog.data.ceoRejectionAnswer}
                      </Typography>
                      {formDialog.data.ceoRejectionAnsweredBy && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                          Answered by: {formDialog.data.ceoRejectionAnsweredBy?.firstName || ''} {formDialog.data.ceoRejectionAnsweredBy?.lastName || ''}
                          {formDialog.data.ceoRejectionAnsweredAt && ` on ${formatDate(formDialog.data.ceoRejectionAnsweredAt)}`}
                        </Typography>
                      )}
                    </Box>
                  )}
                  
                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    label={`Your Response${formDialog.data.ceoRejectionAnswer ? ' (Update existing answer)' : ''}`}
                    value={ceoAnswer}
                    onChange={(e) => setCeoAnswer(e.target.value)}
                    placeholder="Provide your response to this rejection..."
                    sx={{ mt: 1 }}
                  />
                  
                  {formDialog.data.ceoRejectedBy && (
                    <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                      Rejected by: {formDialog.data.ceoRejectedBy?.firstName || ''} {formDialog.data.ceoRejectedBy?.lastName || ''}
                      {formDialog.data.ceoRejectedAt && ` on ${formatDate(formDialog.data.ceoRejectedAt)}`}
                    </Typography>
                  )}
                </Alert>
              </Grid>
            )}
            
            {/* Audit Observations with Answer Fields - Show when PO was returned from audit or finance */}
            {formDialog.mode === 'edit' && ['Returned from Audit', 'Returned from Finance'].includes(formDialog.data?.status) && formDialog.data?.auditObservations && formDialog.data.auditObservations.length > 0 && (
              <Grid item xs={12}>
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2 }}>
                    {formDialog.data.status === 'Returned from Finance' ? 'Finance Observations' : 'Audit Observations'} - Please provide responses before resubmitting:
                  </Typography>
                  {(formDialog.data.auditReturnComments || formDialog.data.financeReturnComments) && (
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Return Comments:</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {formDialog.data.financeReturnComments || formDialog.data.auditReturnComments}
                      </Typography>
                    </Box>
                  )}
                  {formDialog.data.auditObservations.map((obs, index) => (
                    <Box key={obs._id || index} sx={{ mb: 2, p: 1.5, bgcolor: alpha(theme.palette.warning.main, 0.05), borderRadius: 1, border: '1px solid', borderColor: 'warning.light' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
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
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1.5 }}>
                        {obs.observation}
                      </Typography>
                      {obs.answer && (
                        <Box sx={{ mb: 1.5, p: 1, bgcolor: 'success.light', borderRadius: 1 }}>
                          <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                            Previous Answer:
                          </Typography>
                          <Typography variant="body2">
                            {obs.answer}
                          </Typography>
                          {obs.answeredBy && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                              Answered by: {obs.answeredBy?.firstName || ''} {obs.answeredBy?.lastName || ''}
                              {obs.answeredAt && ` on ${formatDate(obs.answeredAt)}`}
                            </Typography>
                          )}
                        </Box>
                      )}
                      <TextField
                        fullWidth
                        multiline
                        rows={3}
                        label={`Your Response to Observation ${index + 1}${obs.answer ? ' (Update existing answer)' : ''}`}
                        value={observationAnswers[obs._id] || obs.answer || ''}
                        onChange={(e) => setObservationAnswers(prev => ({
                          ...prev,
                          [obs._id]: e.target.value
                        }))}
                        placeholder="Provide your response/correction to this observation..."
                        sx={{ mt: 1 }}
                      />
                    </Box>
                  ))}
                </Alert>
              </Grid>
            )}
            {/* Quotation Prefill Notification */}
            {quotationPrefillInfo?.isPartiallyOrdered && (
              <Grid item xs={12}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="body2" fontWeight={600}>
                    Partial Indent Fulfillment:
                  </Typography>
                  <Typography variant="body2">
                    Showing only the remaining <strong>{quotationPrefillInfo.remainingItems}</strong> unfulfilled item(s) from Quotation <strong>{quotationPrefillInfo.quotationNumber}</strong> (Indent {quotationPrefillInfo.indentNumber}). Other item(s) were already ordered in previous Purchase Order(s).
                  </Typography>
                </Alert>
              </Grid>
            )}

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="date"
                label="Order Date"
                value={formData.orderDate}
                onChange={(e) => setFormData({ ...formData, orderDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="date"
                label="Expected Delivery Date"
                value={formData.expectedDeliveryDate}
                onChange={(e) => setFormData({ ...formData, expectedDeliveryDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Delivery Address"
                value={formData.deliveryAddress || ''}
                onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })}
                placeholder="Enter delivery address for this order"
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                multiline
                minRows={2}
              />
            </Grid>
            
            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Items</Typography>
                {!(formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected') && (
                  <Button size="small" startIcon={<AddIcon />} onClick={addItem}>
                    Add Item
                  </Button>
                )}
              </Box>
              {formData.items.map((item, index) => (
                <Paper key={index} sx={{ p: 2, mb: 2, bgcolor: alpha(theme.palette.primary.main, 0.02) }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Description"
                        value={item.description}
                        onChange={(e) => updateItem(index, 'description', e.target.value)}
                        disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                        required
                      />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Quantity"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value))}
                        disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                        required
                      />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Unit"
                        value={item.unit}
                        onChange={(e) => updateItem(index, 'unit', e.target.value)}
                        disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                        required
                      />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Unit Price"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(index, 'unitPrice', parseFloat(e.target.value))}
                        disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                        required
                      />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Tax %"
                        value={item.taxRate}
                        onChange={(e) => updateItem(index, 'taxRate', parseFloat(e.target.value))}
                        disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                      />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Discount"
                        value={item.discount}
                        onChange={(e) => updateItem(index, 'discount', parseFloat(e.target.value))}
                        disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
                      />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      {!(formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected') && (
                        <IconButton 
                          color="error" 
                          onClick={() => removeItem(index)}
                          disabled={formData.items.length === 1}
                        >
                          <DeleteIcon />
                        </IconButton>
                      )}
                    </Grid>
                  </Grid>
                </Paper>
              ))}
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="number"
                label="Shipping Cost"
                value={formData.shippingCost}
                onChange={(e) => setFormData({ ...formData, shippingCost: parseFloat(e.target.value) || 0 })}
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="number"
                label="Order Discount"
                value={formData.orderDiscount}
                onChange={(e) => setFormData({ ...formData, orderDiscount: parseFloat(e.target.value) || 0 })}
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Payment Terms"
                value={formData.paymentTerms}
                onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                disabled={formDialog.mode === 'edit' && formDialog.data?.status === 'Rejected'}
              />
            </Grid>
            {formDialog.mode === 'create' && formDialog.revisedFromPO && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  required
                  multiline
                  rows={2}
                  label={`Justification for replacing ${formDialog.revisedFromPO.orderNumber}`}
                  value={formData.replacementJustification || ''}
                  onChange={(e) => setFormData({ ...formData, replacementJustification: e.target.value })}
                  helperText="Shown on the rejected PO's status and in its history"
                />
              </Grid>
            )}
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.success.main, 0.1) }}>
                <Typography variant="h6" align="right">
                  Total: {formatPKR(calculateTotal())}
                </Typography>
              </Paper>
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Approval authorities</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                Search active users (same directory as indents) or type a name/designation. Saved values are stored as text for print.
              </Typography>
              <Grid container spacing={2}>
                {poAuthorityFieldsForDoc(
                  formDialog.mode === 'create' ? new Date() : formDialog.data?.createdAt
                ).map(({ key, label }) => (
                  <Grid item xs={12} sm={6} md={4} key={key}>
                    <Autocomplete
                      freeSolo
                      options={authoritySearchOptions}
                      loading={authoritySearchLoading}
                      value={approvalAuthority[key]}
                      onChange={(_, newValue) => {
                        if (newValue == null) {
                          setApprovalAuthority((prev) => ({ ...prev, [key]: '' }));
                        } else if (typeof newValue === 'string') {
                          setApprovalAuthority((prev) => ({ ...prev, [key]: newValue }));
                        } else {
                          setApprovalAuthority((prev) => ({ ...prev, [key]: approverLabel(newValue) }));
                        }
                      }}
                      onInputChange={(_, input, reason) => {
                        if (reason === 'input') {
                          handleAuthoritySearchInput(input);
                          setApprovalAuthority((prev) => ({ ...prev, [key]: input }));
                        }
                        if (reason === 'clear') {
                          setApprovalAuthority((prev) => ({ ...prev, [key]: '' }));
                          loadAuthorityApproverOptions('');
                        }
                      }}
                      getOptionLabel={(option) =>
                        typeof option === 'string' ? option : approverLabel(option)
                      }
                      filterOptions={(opts) => opts}
                      isOptionEqualToValue={(a, b) => {
                        if (a && b && typeof a === 'object' && typeof b === 'object') {
                          return a._id === b._id;
                        }
                        if (typeof a === 'string' && typeof b === 'string') return a === b;
                        return false;
                      }}
                      PopperComponent={WidePopper}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={label}
                          size="small"
                          placeholder="Search user or type name…"
                          InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {authoritySearchLoading ? (
                                  <CircularProgress color="inherit" size={16} />
                                ) : null}
                                {params.InputProps.endAdornment}
                              </>
                            )
                          }}
                        />
                      )}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setFormDialog({ open: false, mode: 'create', data: null, quotationId: null, revisedFromPO: null });
            setObservationAnswers({}); // Clear observation answers
          }}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSubmit}
            disabled={!formData.vendor || !formData.expectedDeliveryDate || formData.items.length === 0}
          >
            {formDialog.mode === 'create' ? 'Create' : (formDialog.data?.status === 'Rejected' ? 'Resubmit' : 'Update')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog */}
      <Dialog 
        open={viewDialog.open} 
        onClose={() => setViewDialog({ open: false, data: null, attachedGrns: [], quotations: [], poDetailTab: 0 })}
        maxWidth={false}
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: '95%' },
            maxWidth: {
              xs: '100%',
              sm: viewDialog.poDetailTab === 3 ? '1400px' : '230mm'
            },
            maxHeight: { xs: '100%', sm: '95vh' },
            height: { xs: '100%', sm: 'auto' },
            m: { xs: 0, sm: 2 },
            borderRadius: { xs: 0, sm: 1 },
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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h6" sx={{ fontSize: { xs: '1rem', sm: '1.25rem' } }}>Purchase Order Details</Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              {viewDialog.data && viewDialog.data.status === 'Pending Approval' && isAssignedAuthorityUser(viewDialog.data) && !hasCurrentUserApprovedAuthority(viewDialog.data) && (
                <>
                  <Button
                    variant="contained"
                    color="success"
                    startIcon={<ApproveIcon />}
                    onClick={async () => {
                      await handleApprove(viewDialog.data._id);
                      setViewDialog(prev => ({ ...prev, open: false, data: null, attachedGrns: [], quotations: [], poDetailTab: 0 }));
                    }}
                    size="small"
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<RejectIcon />}
                    onClick={() => handleOpenRejectDialog(viewDialog.data)}
                    size="small"
                  >
                    Reject with Observation
                  </Button>
                </>
              )}
              <Button
                variant="outlined"
                startIcon={<HistoryIcon />}
                onClick={() => setWorkflowHistoryDialog({ open: true, document: viewDialog.data })}
                size="small"
              >
                Workflow History
              </Button>
              <Button
                variant="contained"
                startIcon={<PrintIcon />}
                onClick={() => printPoFitToOneA4()}
                size="small"
              >
                Print
              </Button>
            </Stack>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0, overflow: 'auto', '@media print': { p: 0, overflow: 'visible' } }}>
          {viewDialog.data && (
            <>
              <Tabs
                value={viewDialog.poDetailTab ?? 0}
                onChange={(_, v) => setViewDialog(prev => ({ ...prev, poDetailTab: v }))}
                sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider', '@media print': { display: 'none' } }}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label="Purchase Order" />
                <Tab label={viewDialog.attachedGrns?.length > 0 ? `GRN(s) (${viewDialog.attachedGrns.length})` : 'GRN(s)'} />
                <Tab label="Indent" />
                <Tab label="Comparative Statement" />
                <Tab label={`Quotations (${viewDialog.quotations?.length || 0})`} />
              </Tabs>
              {viewDialog.poDetailTab === 0 && (
            <Box sx={{ width: '100%' }} className="print-content">
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
                    mb: 1.25,
                    fontSize: { xs: '1.35rem', print: '1.1rem' },
                    letterSpacing: 0.5,
                    '@media print': { mb: 1, fontSize: '22px' }
                  }}
                >
                  Purchase Order
                </Typography>

                {(viewDialog.data.supersededBy || viewDialog.data.resourcingReleasedAt || viewDialog.data.revisedFrom) && (
                  <Alert severity={viewDialog.data.revisedFrom && !viewDialog.data.supersededBy && !viewDialog.data.resourcingReleasedAt ? 'info' : 'warning'} sx={{ mb: 2, '@media print': { display: 'none' } }}>
                    {viewDialog.data.supersededBy
                      ? <>This PO is closed — replaced by <strong>{viewDialog.data.supersededBy.orderNumber}</strong>.</>
                      : viewDialog.data.resourcingReleasedAt
                        ? <>This PO is closed — released for re-sourcing on {formatDate(viewDialog.data.resourcingReleasedAt)}; Comparative Statement and quotation reopened.</>
                        : <>This PO replaces rejected PO <strong>{viewDialog.data.revisedFrom.orderNumber}</strong>.</>}
                    {(viewDialog.data.replacementJustification || viewDialog.data.revisedFrom?.replacementJustification) && (
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        <strong>Justification:</strong> {viewDialog.data.replacementJustification || viewDialog.data.revisedFrom?.replacementJustification}
                      </Typography>
                    )}
                  </Alert>
                )}

                {/* Rejection Observations - Show if status is Rejected */}
                {viewDialog.data.status === 'Rejected' && (
                  (viewDialog.data.auditRejectObservations && viewDialog.data.auditRejectObservations.length > 0) ||
                  viewDialog.data.auditRejectionComments ||
                  viewDialog.data.ceoRejectionComments
                ) && (
                  <Box sx={{ mb: 3, p: 2, bgcolor: alpha(theme.palette.error.main, 0.1), border: `1px solid ${theme.palette.error.main}`, borderRadius: 1 }}>
                    <Typography variant="h6" sx={{ mb: 2, color: 'error.main', fontWeight: 'bold' }}>
                      Rejection Observations
                    </Typography>
                    {(viewDialog.data.auditRejectionComments || viewDialog.data.ceoRejectionComments) && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Rejection Comments:</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                          {viewDialog.data.auditRejectionComments || viewDialog.data.ceoRejectionComments}
                        </Typography>
                      </Box>
                    )}
                    {viewDialog.data.auditRejectObservations && viewDialog.data.auditRejectObservations.map((obs, index) => (
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
                    {(viewDialog.data.auditRejectedBy || viewDialog.data.ceoRejectedBy) && (
                      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                        Rejected by: {viewDialog.data.auditRejectedBy?.firstName || viewDialog.data.ceoRejectedBy?.firstName || ''} {viewDialog.data.auditRejectedBy?.lastName || viewDialog.data.ceoRejectedBy?.lastName || ''}
                        {(viewDialog.data.auditRejectedAt || viewDialog.data.ceoRejectedAt) && ` on ${formatDate(viewDialog.data.auditRejectedAt || viewDialog.data.ceoRejectedAt)}`}
                      </Typography>
                    )}
                  </Box>
                )}

                {/* Buyer Information - First Row */}
                <Box sx={{ mb: 2.5, '@media print': { mb: 1 } }}>
                  <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: '1.1rem', '@media print': { mb: 0.45, fontSize: '14px' } }}>
                    {viewDialog.data.companyId?.name || viewDialog.data.indent?.companyId?.name || '—'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.9rem', '@media print': { fontSize: '12.5px' } }}>
                    Link Road I-14, adjacent to CDA Sectors I-14 and I-15
                  </Typography>
                </Box>

                {/* Divider */}
                <Divider sx={{ my: 2.5, borderWidth: 1, borderColor: '#ccc', '@media print': { my: 0.75 } }} />

                {/* Vendor and PO Details - Second Row in Columns */}
                <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', gap: 3, '@media print': { mb: 1, gap: 2 } }}>
                  {/* Left Column - Vendor Info */}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: '1.1rem' }}>
                      Vendor:
                    </Typography>
                    <Typography sx={{ fontSize: '0.9rem', mb: 0.5, fontWeight: 500 }}>
                      {viewDialog.data.vendor?.name || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mb: 0.5 }}>
                      {viewDialog.data.vendor?.contactPerson || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mb: 0.5 }}>
                      {viewDialog.data.vendor?.phone || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mb: 0.5 }}>
                      {viewDialog.data.vendor?.address || '—'}
                    </Typography>
                    {(viewDialog.data.vendor?.ntnCnic || viewDialog.data.vendor?.ntnNo || viewDialog.data.vendor?.cnic) && (
                      <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', fontWeight: 600, mt: 0.5 }}>
                        ntn / cnic : {viewDialog.data.vendor.ntnCnic || viewDialog.data.vendor.ntnNo || viewDialog.data.vendor.cnic}
                      </Typography>
                    )}
                  </Box>

                  {/* Right Column - PO Info */}
                  <Box sx={{ flex: 1, textAlign: 'right' }}>
                    <Box sx={{ mb: 1 }}>
                      <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        PO Number:{' '}
                      </Typography>
                      <Typography component="span" sx={{ fontSize: '0.9rem' }}>
                        {viewDialog.data.orderNumber}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                      <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        Order Date:{' '}
                      </Typography>
                      <Typography component="span" sx={{ fontSize: '0.9rem' }}>
                        {formatDateForPrint(viewDialog.data.orderDate)}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                      <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        Expected Delivery:{' '}
                      </Typography>
                      <Typography component="span" sx={{ fontSize: '0.9rem' }}>
                        {formatDateForPrint(viewDialog.data.expectedDeliveryDate)}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                      <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        Status:{' '}
                      </Typography>
                      <Typography component="span" sx={{ fontSize: '0.9rem' }}>
                        {viewDialog.data.status}
                      </Typography>
                    </Box>
                    {viewDialog.data.costCenter && (
                      <Box sx={{ mb: 1 }}>
                        <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                          Cost Center:{' '}
                        </Typography>
                        <Typography component="span" sx={{ fontSize: '0.9rem' }}>
                          {formatPurchaseOrderCostCenter(viewDialog.data, '—')}
                        </Typography>
                      </Box>
                    )}
                    {viewDialog.data.quotation && (
                      <Box sx={{ mb: 1 }}>
                        <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                          Quotation Ref:{' '}
                        </Typography>
                        <Typography component="span" sx={{ fontSize: '0.9rem' }}>
                          {viewDialog.data.quotation?.quotationNumber || (typeof viewDialog.data.quotation === 'string' ? viewDialog.data.quotation : '—')}
                        </Typography>
                      </Box>
                    )}
                    {viewDialog.data.indent && (
                      <Box>
                        <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                          Indent Ref:{' '}
                        </Typography>
                        <Typography component="span" sx={{ fontSize: '0.9rem' }}>
                          {viewDialog.data.indent?.indentNumber || (typeof viewDialog.data.indent === 'string' ? viewDialog.data.indent : '—')}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>

                {/* Items Table - Main Content */}
                <TableContainer 
                  component={Box} 
                  sx={{ 
                    mb: 3, 
                    border: '1px solid #000',
                    '@media print': { mb: 1 },
                    '& .MuiTable-root': {
                      borderCollapse: 'collapse'
                    },
                    '& .MuiTableCell-root': {
                      border: '1px solid #000',
                      padding: '8px 12px',
                      fontSize: '0.85rem',
                      '@media print': { padding: '5px 7px', fontSize: '12px' }
                    },
                    '& .MuiTableHead-root .MuiTableCell-root': {
                      backgroundColor: '#f5f5f5',
                      fontWeight: 700,
                      color: '#000'
                    }
                  }}
                >
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: '7%', textAlign: 'center' }}>S#</TableCell>
                        <TableCell sx={{ width: '36%' }}>Item Description</TableCell>
                        <TableCell sx={{ width: '10%', textAlign: 'center' }}>Qty</TableCell>
                        <TableCell sx={{ width: '9%', textAlign: 'center' }}>Unit</TableCell>
                        <TableCell sx={{ width: '12%', textAlign: 'right' }}>Unit Price</TableCell>
                        <TableCell sx={{ width: '12%', textAlign: 'right' }}>Discount</TableCell>
                        <TableCell sx={{ width: '14%', textAlign: 'right' }}>Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {viewDialog.data.items?.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell sx={{ textAlign: 'center' }}>{index + 1}</TableCell>
                          <TableCell>{item.description}</TableCell>
                          <TableCell sx={{ textAlign: 'center' }}>{item.quantity}</TableCell>
                          <TableCell sx={{ textAlign: 'center' }}>{item.unit}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{formatNumber(item.unitPrice)}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{formatNumber(item.discount || 0)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontWeight: 600 }}>{formatNumber(item.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Financial Summary - Right Aligned with Borders */}
                <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end', '@media print': { mb: 0.4 } }}>
                  <Box 
                    sx={{ 
                      width: '320px',
                      border: '1px solid #000',
                      '@media print': { width: '280px' },
                      '& > div': {
                        display: 'flex',
                        justifyContent: 'space-between',
                        p: 1,
                        borderBottom: '1px solid #ccc',
                        fontSize: '0.85rem',
                        '@media print': { p: '5px 7px', fontSize: '12px' },
                        '&:last-child': {
                          borderBottom: 'none',
                          borderTop: '2px solid #000',
                          fontWeight: 700,
                          backgroundColor: '#f5f5f5'
                        }
                      }
                    }}
                  >
                    <Box>
                      <Typography sx={{ fontSize: '0.85rem' }}>Subtotal:</Typography>
                      <Typography sx={{ fontSize: '0.85rem' }}>{formatPKR(viewDialog.data.subtotal)}</Typography>
                    </Box>
                    {viewDialog.data.taxAmount > 0 && (
                      <Box>
                        <Typography sx={{ fontSize: '0.85rem' }}>Tax:</Typography>
                        <Typography sx={{ fontSize: '0.85rem' }}>{formatPKR(viewDialog.data.taxAmount)}</Typography>
                      </Box>
                    )}
                    {viewDialog.data.discountAmount > 0 && (
                      <Grid container justifyContent="space-between" sx={{ mb: 1, color: 'text.secondary' }}>
                        <Typography sx={{ fontSize: '0.85rem' }}>Item Discount:</Typography>
                        <Typography sx={{ fontSize: '0.85rem' }}>-{formatPKR(viewDialog.data.discountAmount)}</Typography>
                      </Grid>
                    )}
                    {viewDialog.data.orderDiscount > 0 && (
                      <Grid container justifyContent="space-between" sx={{ mb: 1, color: 'text.secondary' }}>
                        <Typography sx={{ fontSize: '0.85rem' }}>Order Discount:</Typography>
                        <Typography sx={{ fontSize: '0.85rem' }}>-{formatPKR(viewDialog.data.orderDiscount)}</Typography>
                      </Grid>
                    )}
                    {viewDialog.data.shippingCost > 0 && (
                      <Box>
                        <Typography sx={{ fontSize: '0.85rem' }}>Shipping:</Typography>
                        <Typography sx={{ fontSize: '0.85rem' }}>{formatPKR(viewDialog.data.shippingCost)}</Typography>
                      </Box>
                    )}
                    <Box>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>Total Amount:</Typography>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>{formatPKR(viewDialog.data.totalAmount)}</Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Amount in Words */}
                <Box sx={{ mb: 3, p: 1.5, border: '1px solid #000', backgroundColor: '#fafafa', '@media print': { mb: 1, p: 1 } }}>
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, mb: 0.5, '@media print': { fontSize: '12.5px', mb: 0.35 } }}>
                    Amount in Words:
                  </Typography>
                  <Typography sx={{ fontSize: '0.85rem', textTransform: 'capitalize', fontStyle: 'italic', '@media print': { fontSize: '12.5px' } }}>
                    {numberToWords(viewDialog.data.totalAmount)}
                  </Typography>
                </Box>

                {/* Terms and Conditions — compact on print so rest of PO can stay larger */}
                <Box className="po-terms-block" sx={{ mb: 3, '@media print': { mb: 0.5 } }}>
                  <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: '1rem', '@media print': { mb: 0.15, fontSize: '10px' } }}>
                    Terms & Conditions:
                  </Typography>
                  <Box sx={{ fontSize: '0.8rem', color: 'text.secondary', pl: 2, '@media print': { fontSize: '9px', pl: 1, lineHeight: 1.12 } }}>
                    <Typography sx={{ fontSize: 'inherit', mb: 0.5, '@media print': { mb: 0 } }}>• Payment Terms: {viewDialog.data.paymentTerms || 'Standard Terms Apply'}</Typography>
                    <Typography sx={{ fontSize: 'inherit', mb: 0.5, '@media print': { mb: 0 } }}>• Delivery: As per schedule mentioned above</Typography>
                    <Typography sx={{ fontSize: 'inherit', mb: 0.5, '@media print': { mb: 0 } }}>• Inspection: Goods subject to inspection upon delivery</Typography>
                    <Typography sx={{ fontSize: 'inherit' }}>• Warranty: Standard manufacturer warranty applies</Typography>
                  </Box>
                </Box>

                {/* Delivery Address */}
                {viewDialog.data.deliveryAddress && (
                  <Box sx={{ mb: 3, '@media print': { mb: 0.45 } }}>
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: '1rem', '@media print': { mb: 0.2, fontSize: '10px' } }}>
                      Delivery Address:
                    </Typography>
                    <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', '@media print': { fontSize: '8.5px' } }}>
                      {viewDialog.data.deliveryAddress}
                    </Typography>
                  </Box>
                )}

                {/* Notes */}
                {viewDialog.data.notes && (
                  <Box sx={{ mb: 3, '@media print': { mb: 0.45 } }}>
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: '1rem', '@media print': { mb: 0.2, fontSize: '10px' } }}>
                      Notes:
                    </Typography>
                    <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', '@media print': { fontSize: '8.5px' } }}>
                      {viewDialog.data.notes}
                    </Typography>
                  </Box>
                )}

                {/* Signatures Section — keep with Store Vetting + authorities on same A4 page */}
                <Box
                  className="po-approval-block"
                  sx={{
                    mt: 1.5,
                    pt: 0.5,
                    '@media print': { mt: 1, pt: 0.5 }
                  }}
                >
                  {(() => {
                    const approvals = viewDialog.data.indent?.comparativeStatementApprovals || {};
                    const rows = [
                      {
                        key: 'preparedBy',
                        label: 'Prepared By',
                        user: approvals.preparedByUser || null,
                        fallback: viewDialog.data.approvalAuthorities?.preparedBy || approvals.preparedBy || ''
                      },
                      {
                        key: 'managerProcurement',
                        label: 'Manager Procurement',
                        user: approvals.managerProcurementUser || null,
                        fallback: viewDialog.data.approvalAuthorities?.managerProcurement || approvals.managerProcurement || ''
                      },
                      ...(sanitizeApprovalAuthorities(
                        viewDialog.data.approvalAuthorities,
                        viewDialog.data.createdAt
                      ).srManagerProcurement ? [{
                        key: 'srManagerProcurement',
                        label: 'Sr Manager Procurement',
                        user: null,
                        fallback: viewDialog.data.approvalAuthorities?.srManagerProcurement || ''
                      }] : []),
                      {
                        key: 'chiefOperatingOfficer',
                        label: 'Chief operating officer',
                        user: null,
                        fallback: viewDialog.data.approvalAuthorities?.chiefOperatingOfficer || viewDialog.data.approvalAuthorities?.verifiedBy || approvals.verifiedBy || ''
                      },
                      {
                        key: 'avpTaj',
                        label: 'AVP Taj',
                        user: null,
                        fallback: viewDialog.data.approvalAuthorities?.avpTaj || viewDialog.data.approvalAuthorities?.authorisedRep || approvals.authorisedRep || ''
                      },
                      ...(viewDialog.data.approvalAuthorities?.technicalDepartment || approvals.technicalDepartment ? [{
                        key: 'technicalDepartment',
                        label: 'Technical Department',
                        user: null,
                        fallback: viewDialog.data.approvalAuthorities?.technicalDepartment || approvals.technicalDepartment || ''
                      }] : [])
                    ];
                    const authorityApprovalHistory = Array.isArray(viewDialog.data?.workflowHistory)
                      ? [...viewDialog.data.workflowHistory]
                        .reverse()
                        .find((h) => h?.fromStatus === 'Pending Approval' && h?.toStatus === 'Pending Audit')
                      : null;
                    const authorityApprovedBy = viewDialog.data?.approvedBy || authorityApprovalHistory?.changedBy || null;
                    const authorityApprovedAt = viewDialog.data?.approvedAt || authorityApprovalHistory?.changedAt || null;
                    const authorityApprovals = Array.isArray(viewDialog.data?.authorityApprovals) ? viewDialog.data.authorityApprovals : [];
                    const authorityApprovalByKey = new Map(
                      authorityApprovals
                        .map((approval) => [String(approval?.authorityKey || '').trim(), approval])
                        .filter(([key]) => Boolean(key))
                    );
                    const normalizeToken = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
                    const getUserTokens = (u) => {
                      if (!u || typeof u !== 'object') return [];
                      return [
                        [u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
                        u.email,
                        u.employeeId
                      ].map(normalizeToken).filter(Boolean);
                    };
                    const authorityTokens = getUserTokens(authorityApprovedBy);
                    const matchesAuthority = (value) => {
                      const token = normalizeToken(value);
                      if (!token || authorityTokens.length === 0) return false;
                      return authorityTokens.some((at) => at === token || at.includes(token) || token.includes(at));
                    };
                    let legacyAuthorityApplied = false;
                    return (
                      <>
                      <StoreVettingNotice
                        indent={viewDialog.data.indent}
                        sx={{ mb: 0.5, '@media print': { mb: 0.25 } }}
                      />
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.35, fontSize: '0.72rem', color: '#1e293b', '@media print': { fontSize: '13px', mb: 0.45 } }}>
                        Finance Document Approval Authority
                      </Typography>
                      <TableContainer component={Box} sx={{ border: '1.5px solid #334155' }}>
                        <Table
                          size="small"
                          className="po-authority-table"
                          sx={{
                            '& th': {
                              bgcolor: '#f1f5f9',
                              fontWeight: 800,
                              fontSize: 12,
                              border: '1px solid #cbd5e1',
                              py: 0.4,
                              px: 0.8,
                              '@media print': { py: '5px', px: '7px', fontSize: '12px', lineHeight: 1.3 }
                            },
                            '& td': {
                              fontSize: 12,
                              border: '1px solid #cbd5e1',
                              py: 0.35,
                              px: 0.8,
                              verticalAlign: 'middle',
                              '@media print': { py: '5px', px: '7px', fontSize: '12px', lineHeight: 1.3 }
                            }
                          }}
                        >
                          <TableHead>
                            <TableRow>
                              <TableCell>Authority</TableCell>
                              <TableCell>Name</TableCell>
                              <TableCell align="center">Digital Signature</TableCell>
                              <TableCell>Date & Time</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {rows.map((row) => {
                              const authorityApproval = authorityApprovalByKey.get(row.key);
                              const authorityUser = authorityApproval?.approver || row.user;
                              const isLegacyApproved = !authorityApproval && !legacyAuthorityApplied && matchesAuthority(row.fallback);
                              if (isLegacyApproved) {
                                legacyAuthorityApplied = true;
                              }
                              const signatureUser = authorityApproval?.approver || row.user || (isLegacyApproved ? authorityApprovedBy : null);
                              const isApprovedRow = Boolean(authorityApproval || isLegacyApproved);
                              const actedAt = authorityApproval?.approvedAt || (isLegacyApproved ? authorityApprovedAt : null);
                              return (
                                <TableRow key={row.key}>
                                  <TableCell sx={{ fontWeight: 800 }}>{row.label}</TableCell>
                                  <TableCell>{authorityApproval?.approver && typeof authorityApproval.approver === 'object' ? (approverLabel(authorityApproval.approver) || row.fallback || '—') : (row.fallback || (authorityUser ? approverLabel(authorityUser) : '—'))}</TableCell>
                                  <TableCell align="center">
                                    {isApprovedRow && signatureUser?.digitalSignature ? (
                                      <Box sx={{ maxHeight: 24, display: 'flex', justifyContent: 'center', '& img': { maxHeight: 24, width: 'auto', objectFit: 'contain' }, '@media print': { maxHeight: 28, '& img': { maxHeight: 28 } } }}>
                                        <DigitalSignatureImage userOrPath={signatureUser} alt={`Signature ${row.label}`} sx={{ maxHeight: 24, maxWidth: 90, '@media print': { maxHeight: 28, maxWidth: 110 } }} />
                                      </Box>
                                    ) : isApprovedRow ? (
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', '@media print': { fontSize: '8px' } }}>Approved</Typography>
                                    ) : (
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', '@media print': { fontSize: '8px' } }}>—</Typography>
                                    )}
                                  </TableCell>
                                  <TableCell>{actedAt ? formatDateTime(actedAt) : '—'}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      </>
                    );
                  })()}
                  <Box sx={{ '@media print': { display: 'none' } }}>
                    <ProcurementDigitalSignaturesRow purchaseOrder={viewDialog.data} />
                  </Box>
                </Box>
              </Paper>
            </Box>
              )}
              {viewDialog.poDetailTab === 1 && (
            <Box sx={{ width: '100%', p: 2 }} className="print-content">
              {viewDialog.attachedGrns && viewDialog.attachedGrns.length > 0 ? viewDialog.attachedGrns.map((grn) => (
                <Paper
                  key={grn._id}
                  sx={{
                    p: { xs: 3, sm: 3.5, md: 4 },
                    maxWidth: '210mm',
                    mx: 'auto',
                    mt: 4,
                    backgroundColor: '#fff',
                    boxShadow: 'none',
                    width: '100%',
                    fontFamily: 'Arial, sans-serif',
                    border: '1px solid',
                    borderColor: 'divider',
                    '@media print': {
                      boxShadow: 'none',
                      p: 2.5,
                      maxWidth: '100%',
                      mx: 0,
                      width: '100%',
                      pageBreakBefore: 'always',
                      pageBreakInside: 'avoid'
                    }
                  }}
                >
                  <Typography variant="overline" color="textSecondary" sx={{ display: 'block', mb: 1 }}>Attached GRN (copy)</Typography>
                  <Grid container sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', pb: 2 }} alignItems="center">
                    <Grid item xs={4}>
                      <Typography variant="h6" fontWeight="bold">
                        {viewDialog.data.companyId?.name || viewDialog.data.indent?.companyId?.name || '—'}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">Head Office</Typography>
                    </Grid>
                    <Grid item xs={4} sx={{ textAlign: 'center' }}>
                      <Typography variant="h5" fontWeight="bold">Goods Received Note</Typography>
                    </Grid>
                    <Grid item xs={4} />
                  </Grid>
                  <Grid container spacing={3} sx={{ mb: 2 }}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="textSecondary">No.</Typography>
                      <Typography variant="body1" fontWeight="bold">{grn.receiveNumber || grn._id}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Supplier</Typography>
                      <Typography variant="body2">{[grn.supplier?.supplierId, grn.supplierName || grn.supplier?.name].filter(Boolean).join(' ') || '-'}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Address</Typography>
                      <Typography variant="body2">{grn.supplierAddress || grn.supplier?.address || '-'}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Narration</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{grn.narration || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="textSecondary">Date</Typography>
                      <Typography variant="body2">{formatGRNDate(grn.receiveDate)}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Currency</Typography>
                      <Typography variant="body2">{grn.currency || 'Rupees'}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>P.R No.</Typography>
                      <Typography variant="body2">{grn.prNumber || '—'}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>P.O No.</Typography>
                      <Typography variant="body2">{grn.poNumber || grn.purchaseOrder?.orderNumber || '—'}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Store</Typography>
                      <Typography variant="body2">{grn.store || '—'}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Gate Pass No.</Typography>
                      <Typography variant="body2">{grn.gatePassNo || '—'}</Typography>
                    </Grid>
                  </Grid>
                  <TableContainer component={Box} variant="outlined" sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 'bold' }}>S. No</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Product Code</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Description</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>Unit</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }} align="right">Quantity</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }} align="right">Rate</TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }} align="right">Value Excluding Sales Tax</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(grn.items || []).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{idx + 1}</TableCell>
                            <TableCell>{item.itemCode || '—'}</TableCell>
                            <TableCell>{item.itemName || '—'}</TableCell>
                            <TableCell>{item.unit || '—'}</TableCell>
                            <TableCell align="right">{formatGRNNumber(item.quantity)}</TableCell>
                            <TableCell align="right">{formatGRNNumber(item.unitPrice)}</TableCell>
                            <TableCell align="right">{formatGRNNumber(item.valueExcludingSalesTax ?? (item.quantity * item.unitPrice))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                    <Grid container spacing={1} sx={{ maxWidth: 320 }}>
                      <Grid item xs={6}><Typography variant="body2">Discount</Typography></Grid>
                      <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2">{formatGRNNumber(grn.discount)}</Typography></Grid>
                      <Grid item xs={6}><Typography variant="body2">Other Charges</Typography></Grid>
                      <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2">{formatGRNNumber(grn.otherCharges)}</Typography></Grid>
                      <Grid item xs={6}><Typography variant="body2" fontWeight="bold">Net Amount</Typography></Grid>
                      <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2" fontWeight="bold">{formatGRNNumber(grn.netAmount)}</Typography></Grid>
                      <Grid item xs={6}><Typography variant="body2" fontWeight="bold">Total</Typography></Grid>
                      <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2" fontWeight="bold">{formatGRNNumber(grn.total ?? grn.netAmount)}</Typography></Grid>
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
                    <Box sx={{ width: 120, height: 40, border: '1px dashed', borderColor: 'divider' }} />
                  </Box>
                </Paper>
              )) : (
                <Typography color="textSecondary" sx={{ py: 4, textAlign: 'center' }}>
                  No GRN(s) attached to this Purchase Order.
                </Typography>
              )}
            </Box>
              )}
              {viewDialog.poDetailTab === 2 && (
                <Box sx={{ width: '100%', p: 2 }} className="print-content">
                  {!viewDialog.data.indent ? (
                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      No Indent / Requisition linked to this Purchase Order.
                    </Typography>
                  ) : (
                    <Paper
                      sx={{
                        p: { xs: 3, sm: 3.5, md: 4 },
                        maxWidth: '210mm',
                        mx: 'auto',
                        backgroundColor: '#fff',
                        boxShadow: 'none',
                        border: '1px solid',
                        borderColor: 'divider',
                        fontFamily: 'Arial, sans-serif'
                      }}
                    >
                      <Typography variant="h5" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1 }}>
                        Purchase Request Form
                      </Typography>
                      {viewDialog.data.indent.title && (
                        <Typography variant="h6" fontWeight={600} align="center" sx={{ mb: 2 }}>
                          {viewDialog.data.indent.title}
                        </Typography>
                      )}
                      <Box sx={{ mb: 1.5, fontSize: '0.9rem', textAlign: 'center' }}>
                        <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                        <Typography component="span" sx={{ ml: 1 }}>
                          {viewDialog.data.indent.erpRef || 'PR #' + (viewDialog.data.indent.indentNumber?.split('-').pop() || '')}
                        </Typography>
                      </Box>
                      <Box sx={{ mb: 1.5, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        <Box><Typography component="span" fontWeight={600}>Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.data.indent.requestedDate)}</Typography></Box>
                        <Box><Typography component="span" fontWeight={600}>Required Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.data.indent.requiredDate) || '—'}</Typography></Box>
                        <Box><Typography component="span" fontWeight={600}>Indent No.:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.data.indent.indentNumber || '—'}</Typography></Box>
                      </Box>
                      <Box sx={{ mb: 3, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        <Box><Typography component="span" fontWeight={600}>Department:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.data.indent.department?.name || viewDialog.data.indent.department || '—'}</Typography></Box>
                        <Box><Typography component="span" fontWeight={600}>Originator:</Typography><Typography component="span" sx={{ ml: 1 }}>{viewDialog.data.indent.requestedBy?.firstName && viewDialog.data.indent.requestedBy?.lastName ? `${viewDialog.data.indent.requestedBy.firstName} ${viewDialog.data.indent.requestedBy.lastName}` : viewDialog.data.indent.requestedBy?.name || '—'}</Typography></Box>
                      </Box>
                      <Box sx={{ mb: 3 }}>
                        <TableContainer component={Box} sx={{ border: '1px solid', borderColor: 'divider' }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow sx={{ bgcolor: 'grey.100' }}>
                                <TableCell sx={{ fontWeight: 'bold' }}>S#</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Item Name</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Description</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Brand</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Unit</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }} align="center">Qty</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Purpose</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }} align="right">Est. Cost</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(viewDialog.data.indent.items || []).map((item, idx) => (
                                <TableRow key={idx}>
                                  <TableCell align="center">{idx + 1}</TableCell>
                                  <TableCell>{item.itemName || '—'}</TableCell>
                                  <TableCell>{item.description || '—'}</TableCell>
                                  <TableCell>{item.brand || '—'}</TableCell>
                                  <TableCell>{item.unit || '—'}</TableCell>
                                  <TableCell align="center">{item.quantity ?? '—'}</TableCell>
                                  <TableCell>{item.purpose || '—'}</TableCell>
                                  <TableCell align="right">{item.estimatedCost != null ? Number(item.estimatedCost).toFixed(2) : '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                      {viewDialog.data.indent.justification && (
                        <Box sx={{ mb: 2 }}>
                          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Justification:</Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                            {viewDialog.data.indent.justification}
                          </Typography>
                        </Box>
                      )}
                      {renderIndentApprovalProgress(viewDialog.data.indent, {
                        title: 'Indent approval progress'
                      })}
                    </Paper>
                  )}
                </Box>
              )}
              {viewDialog.poDetailTab === 3 && (
                <Box sx={{ width: '100%', p: 2, overflowX: 'auto' }}>
                  {!viewDialog.data.indent ? (
                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      No Comparative Statement linked to this Purchase Order.
                    </Typography>
                  ) : (
                    <ComparativeStatementView
                      requisition={viewDialog.data.indent}
                      quotations={viewDialog.quotations || []}
                      approvalAuthority={viewDialog.data.indent?.comparativeStatementApprovals || {}}
                      note={viewDialog.data.indent?.notes ?? ''}
                      readOnly
                      formatNumber={formatNumber}
                      loadingQuotations={false}
                      showPrintButton={false}
                    />
                  )}
                </Box>
              )}
              {viewDialog.poDetailTab === 4 && (
                <Box sx={{ width: '100%', p: 2 }}>
                  {(!viewDialog.quotations || viewDialog.quotations.length === 0) ? (
                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      No quotations linked to this Purchase Order / Indent.
                    </Typography>
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
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ '@media print': { display: 'none' } }}>
          <Button onClick={() => setViewDialog({ open: false, data: null, attachedGrns: [], quotations: [], poDetailTab: 0 })}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Print Styles for Dialog */}
      <Box
        component="style"
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: A4 portrait;
                margin: 5mm;
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
              ${PO_A4_ONE_PAGE_PRINT_CSS}
              .finance-po-print-page,
              .finance-po-print-page * {
                font-size: inherit;
              }
              .finance-po-items-table th,
              .finance-po-items-table td {
                padding: 2px 3px !important;
                font-size: 9.5px !important;
              }
              .comparative-table {
                font-size: 0.65rem !important;
              }
              .comparative-table th,
              .comparative-table td {
                padding: 2px 3px !important;
                font-size: 0.65rem !important;
                line-height: 1.15 !important;
              }
              .comparative-table thead th {
                padding: 3px 3px !important;
              }
              .terms-table th,
              .terms-table td {
                padding: 2px 3px !important;
                font-size: 0.65rem !important;
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
            }
          `
        }}
      />

      <WorkflowHistoryDialog
        open={workflowHistoryDialog.open}
        onClose={() => setWorkflowHistoryDialog({ open: false, document: null })}
        document={workflowHistoryDialog.document}
        documentType="document"
      />

      {/* Delete Confirmation Dialog */}
      <Dialog 
        open={deleteDialog.open} 
        onClose={() => setDeleteDialog({ open: false, id: null })}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this purchase order? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, id: null })}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Release rejected PO for re-sourcing */}
      <Dialog
        open={releaseDialog.open}
        onClose={() => !releaseDialog.saving && setReleaseDialog({ open: false, order: null, justification: '', saving: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold' }}>Release {releaseDialog.order?.orderNumber} for re-sourcing</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This closes the rejected PO permanently, reopens its Comparative Statement for approval and moves its quotation back to Received,
            so you can collect / negotiate quotations, approve a new Comparative Statement and create a new PO. The new PO will be linked as its replacement.
          </Alert>
          <TextField
            fullWidth
            required
            multiline
            rows={3}
            label="Justification"
            value={releaseDialog.justification}
            onChange={(e) => setReleaseDialog((d) => ({ ...d, justification: e.target.value }))}
            placeholder="e.g. Vendor rate not acceptable to CEO; re-sourcing from other vendors"
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={releaseDialog.saving} onClick={() => setReleaseDialog({ open: false, order: null, justification: '', saving: false })}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={releaseDialog.saving || !releaseDialog.justification.trim()}
            onClick={handleReleaseForResourcing}
          >
            {releaseDialog.saving ? 'Releasing...' : 'Release for re-sourcing'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject with Observations Dialog */}
      <Dialog
        open={rejectDialog.open}
        onClose={() => {
          if (!rejectingOrder) {
            setRejectDialog({ open: false, order: null });
            setRejectionComments('');
            setRejectObservations([{ observation: '', severity: 'medium' }]);
          }
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold' }}>Reject with Observation</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will reject the Purchase Order and record your observations. The procurement team can review these observations and make necessary adjustments.
          </Alert>

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Rejection Comments / Reason"
            value={rejectionComments}
            onChange={(e) => setRejectionComments(e.target.value)}
            placeholder="Enter general comments for rejection..."
            sx={{ mb: 3 }}
            required
          />

          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
            Observations
          </Typography>

          {rejectObservations.map((obs, index) => (
            <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: '#fafafa' }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={8}>
                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    size="small"
                    label={`Observation ${index + 1}`}
                    value={obs.observation}
                    onChange={(e) => updateRejectObservation(index, 'observation', e.target.value)}
                    placeholder="Describe specific observation/issue..."
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Severity"
                    value={obs.severity || 'medium'}
                    onChange={(e) => updateRejectObservation(index, 'severity', e.target.value)}
                  >
                    <MenuItem value="low">Low</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                    <MenuItem value="critical">Critical</MenuItem>
                  </TextField>
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
            Add Observation
          </Button>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button 
            onClick={() => {
              setRejectDialog({ open: false, order: null });
              setRejectionComments('');
              setRejectObservations([{ observation: '', severity: 'medium' }]);
            }}
            disabled={rejectingOrder}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmReject}
            variant="contained"
            color="error"
            startIcon={rejectingOrder ? <CircularProgress size={16} color="inherit" /> : <RejectIcon />}
            disabled={rejectingOrder || (!rejectionComments.trim() && rejectObservations.every(o => !o.observation.trim()))}
          >
            {rejectingOrder ? 'Rejecting...' : 'Reject with Observation'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const formatDateTime = (date) => {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleString();
  } catch {
    return '—';
  }
};

export default PurchaseOrders;
