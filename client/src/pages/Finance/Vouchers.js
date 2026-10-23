import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  MenuItem,
  Grid,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Menu,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Divider as MuiDivider
} from '@mui/material';
import {
  Visibility as ViewIcon,
  Edit as EditIcon,
  ReceiptLong as VoucherIcon,
  Description as DescriptionIcon,
  Print as PrintIcon,
  Close as CloseIcon,
  Add as AddIcon,
  ArrowDropDown as ArrowDropDownIcon,
  Checklist as ChecklistIcon
} from '@mui/icons-material';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import { formatPKR } from '../../utils/currency';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import FinanceCompanySelector from '../../components/Finance/FinanceCompanySelector';
import ComparativeStatementView from '../../components/Procurement/ComparativeStatementView';
import QuotationDetailView from '../../components/Procurement/QuotationDetailView';
import StoreVettingNotice from '../../components/Procurement/StoreVettingNotice';
import CentralizedStoreBillInvoiceBody from '../../components/UtilityBill/CentralizedStoreBillInvoiceBody';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import {
  getDuePaymentAmountFromBill,
  getLineDuePaymentAmount
} from '../../utils/centralizedStoreBillDisplay';
import { numberToWords } from '../../utils/numberToWords';
import { formatPurchaseOrderCostCenter } from '../../utils/purchaseOrderAuthority';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import DeleteIcon from '@mui/icons-material/Delete';

const formatDateForPrint = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** User-facing voucher status (journal status + signed / clearance workflow + bill payment status). */
function getVoucherStatusDisplay(row) {
  const journalStatus = String(row?.status || '').toLowerCase();
  const refType = String(row?.referenceType || '').toLowerCase();

  // For BILL vouchers, display the settlement/payment status (Paid, Partial, Unpaid)
  if (refType === 'bill') {
    if (journalStatus === 'reversed') return { label: 'Reversed', color: 'default', tooltip: 'Journal entry reversed' };
    if (journalStatus === 'cancelled' || row?.billPaymentStatus === 'cancelled' || row?.billStatus === 'cancelled') {
      return { label: 'Cancelled', color: 'default', tooltip: 'Bill / Voucher Cancelled' };
    }
    if (row?.billPaymentStatus === 'paid' || row?.billStatus === 'paid') {
      return { label: 'Paid', color: 'success', tooltip: 'Bill fully paid' };
    }
    if (row?.billPaymentStatus === 'partial' || row?.billStatus === 'partial') {
      const settled = row?.billSettledAmount ? ` (Paid: ${Number(row.billSettledAmount).toLocaleString()})` : '';
      const balance = row?.billBalanceDue ? ` - Bal: ${Number(row.billBalanceDue).toLocaleString()}` : '';
      return {
        label: 'Partially Paid',
        color: 'warning',
        tooltip: `Bill partially paid${settled}${balance}`
      };
    }
    // Default for active bill with no payments recorded yet
    return {
      label: 'Unpaid',
      color: 'error',
      variant: 'outlined',
      tooltip: 'Bill is posted/open, awaiting payment'
    };
  }

  const signed =
    row?.signedDocumentStatus === 'signed' && Boolean(row?.signedDocumentAt);
  const cleared = row?.clearanceStatus === 'cleared';

  if (journalStatus === 'reversed') return { label: 'Reversed', color: 'default' };
  if (journalStatus === 'cancelled') return { label: 'Cancelled', color: 'default' };
  // if (cleared) return { label: 'Cleared', color: 'success' };
  if (signed) return { label: 'Signed', color: 'info' };
  if (journalStatus === 'posted') return { label: 'Posted', color: 'success' };
  if (journalStatus === 'draft') return { label: 'Draft', color: 'warning' };
  const fallback = journalStatus
    ? journalStatus.charAt(0).toUpperCase() + journalStatus.slice(1)
    : '—';
  return { label: fallback, color: 'default' };
}

/** Journal referenceType values → Voucher Type filter labels (Finance → Vouchers) */
const VOUCHER_TYPE_FILTER_OPTIONS = [
  { value: 'payment', label: 'PAYMENT' },
  { value: 'receipt', label: 'RECEIPT' },
  { value: 'bill', label: 'BILL' },
  { value: 'invoice', label: 'INVOICE' },
  { value: 'grn', label: 'GRN' },
  { value: 'sin', label: 'SIN' },
  { value: 'manual', label: 'MANUAL' },
  { value: 'adjustment', label: 'ADJUSTMENT' },
  { value: 'purchase_order', label: 'PURCHASE ORDER' },
  { value: 'depreciation', label: 'DEPRECIATION' },
  { value: 'expense', label: 'EXPENSE' },
  { value: 'stock_adjustment', label: 'STOCK ADJUSTMENT' },
  { value: 'purchase_return', label: 'PURCHASE RETURN' }
];

const Vouchers = () => {
  const navigate = useNavigate();
  const { selectedCompanyId } = useFinanceCompany();
  const { user } = useAuth();
  const isDeveloper = user?.role === 'developer' || (user?.roles && user?.roles.includes('developer'));
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  /** '' | 'all' = no status filter; never send literal status=all to API historically matched nothing */
  const [status, setStatus] = useState('all');
  const [initialDraftCheckDone, setInitialDraftCheckDone] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [totalCount, setTotalCount] = useState(0);
  /** Default: PAYMENT vouchers (referenceType payment on journal) */
  const [voucherType, setVoucherType] = useState('payment');
  const fetchSeqRef = React.useRef(0);
  const [viewDialog, setViewDialog] = useState({
    open: false,
    voucher: null,
    billVoucher: null,
    billVouchers: [],
    activeVoucherSubTab: 'bill',
    po: null,
    poQuotations: [],
    poGrns: [],
    poLinkedDocs: [],
    poAuditTab: 0,
    financeAuthorityDoc: null,
    vendorAdvanceDoc: null,
    apPaymentApp: null,
    payrollPeriodPaymentApp: null,
    cashApproval: null,
    loading: false
  });

  // Print selection dialog state
  const [printSelectDialogOpen, setPrintSelectDialogOpen] = useState(false);
  const [printSelection, setPrintSelection] = useState({
    voucher: true,
    indent: true,
    po: true,
    bills: true,
    comparative: true,
    quotations: true,
    grns: true,
    attachments: true
  });
  const [multiPrintMode, setMultiPrintMode] = useState(false); // true when printing all or selected
  const [printMenuAnchor, setPrintMenuAnchor] = useState(null);
  
  const [newVoucherDialog, setNewVoucherDialog] = useState(false);
  const [selectedNewVoucherType, setSelectedNewVoucherType] = useState('');

  const handleDeleteVoucher = async (voucherId) => {
    if (!window.confirm('Are you sure you want to permanently delete this voucher and its ledger entries? This action cannot be undone.')) {
      return;
    }
    try {
      await api.delete(`/finance/journal-entries/${voucherId}`);
      toast.success('Voucher and ledger entries deleted successfully');
      fetchEntries(); // Refresh the list
    } catch (err) {
      console.error('Error deleting voucher:', err);
      toast.error(err.response?.data?.message || 'Failed to delete voucher');
    }
  };

  const handleCreateVoucher = () => {
    if (!selectedNewVoucherType) return;
    
    switch (selectedNewVoucherType) {
      case 'purchase_bill':
        navigate('/finance/accounts-payable/new');
        break;
      case 'payment_voucher':
        navigate('/finance/vendor-payments');
        break;
      case 'receipt_voucher':
        navigate('/finance/customer-payments');
        break;
      case 'journal_voucher':
        navigate('/finance/journal-entries/new');
        break;
      case 'vendor_advance':
        navigate('/finance/vendor-advance');
        break;
      default:
        break;
    }
  };

  const handleOpenVoucherDocs = async (voucherRow) => {
    setViewDialog({
      open: true,
      voucher: voucherRow,
      po: null,
      poQuotations: [],
      poGrns: [],
      poLinkedDocs: [],
      poAuditTab: 0,
      financeAuthorityDoc: null,
      vendorAdvanceDoc: null,
      apPaymentApp: null,
      payrollPeriodPaymentApp: null,
      cashApproval: null,
      loading: true
    });
    setMultiPrintMode(false);

    try {
      // 1. Fetch full journal entry to ensure complete lines, populated accounts and approval authorities
      let fullVoucher = voucherRow;
      if (voucherRow?._id) {
        try {
          const vRes = await api.get(`/finance/journal-entries/${voucherRow._id}`);
          if (vRes.data?.data) {
            fullVoucher = vRes.data.data;
          }
        } catch (_) {}
      }

      let poId = null;
      if (fullVoucher.purchaseOrder || fullVoucher.purchaseOrderId) {
        poId = fullVoucher.purchaseOrder?._id || fullVoucher.purchaseOrder || fullVoucher.purchaseOrderId;
      } else if (fullVoucher.referenceModel === 'PurchaseOrder' && fullVoucher.referenceId) {
        poId = fullVoucher.referenceId;
      }

      let vaData = null;
      let apData = null;
      let payrollData = null;
      let caData = null;

      if (fullVoucher._id) {
        try {
          const vaRes = await api.get(`/finance/vendor-advances/by-journal-entry/${fullVoucher._id}`);
          vaData = vaRes.data?.data || null;
          if (!poId && vaData && vaData.referenceType === 'purchase_order' && vaData.referenceId) {
            poId = vaData.referenceId;
          }
        } catch (_) {}
      }

      if (fullVoucher._id) {
        try {
          const apRes = await api.get(`/finance/ap-payment-applications/by-journal-entry/${fullVoucher._id}`);
          apData = apRes.data?.data || null;
          if (!poId && apData && apData.referenceType === 'purchase_order' && apData.referenceId) {
            poId = apData.referenceId;
          }
        } catch (_) {}
      }

      if (fullVoucher._id) {
        try {
          const pRes = await api.get(`/finance/payroll-period-payments/by-journal-entry/${fullVoucher._id}`);
          payrollData = pRes.data?.data || null;
        } catch (_) {}
      }

      if (fullVoucher.referenceId && fullVoucher.referenceModel === 'CashApproval') {
        try {
          const cRes = await api.get(`/cash-approvals/${fullVoucher.referenceId}`);
          caData = cRes.data?.data || null;
        } catch (_) {}
      }

      const financeAuthDoc = apData || payrollData || vaData || caData;

      // Fetch Vendor Bills linked to THIS payment voucher (prefer AP settlement bills only)
      let poBills = [];
      let billsFromPaymentApp = false;
      try {
        if (apData?.bills?.length > 0) {
          for (const item of apData.bills) {
            const bId = item.billId?._id || item.billId;
            if (!bId) continue;
            const bRes = await api.get(`/finance/accounts-payable/${bId}`).catch(() => null);
            if (bRes?.data?.data) {
              poBills.push(bRes.data.data);
            }
          }
          billsFromPaymentApp = poBills.length > 0;
        } else if (apData?.accountsPayableId?._id || apData?.accountsPayableId) {
          const bId = apData.accountsPayableId._id || apData.accountsPayableId;
          const bRes = await api.get(`/finance/accounts-payable/${bId}`).catch(() => null);
          if (bRes?.data?.data) {
            poBills.push(bRes.data.data);
            billsFromPaymentApp = true;
          }
        }

        // BPV journal entry often stores referenceId = AccountsPayable _id
        if (
          !billsFromPaymentApp
          && fullVoucher.referenceId
          && (fullVoucher.referenceModel === 'AccountsPayable'
            || fullVoucher.referenceType === 'payment'
            || fullVoucher.voucherSeries === 'BPV')
        ) {
          const bRes = await api.get(`/finance/accounts-payable/${fullVoucher.referenceId}`).catch(() => null);
          if (bRes?.data?.data) {
            poBills.push(bRes.data.data);
            billsFromPaymentApp = true;
          }
        }

        if (fullVoucher.referenceModel === 'AccountsPayable' && fullVoucher.referenceId) {
          const bRes = await api.get(`/finance/accounts-payable/${fullVoucher.referenceId}`).catch(() => null);
          if (bRes?.data?.data && !poBills.some((existing) => String(existing._id) === String(bRes.data.data._id))) {
            poBills.push(bRes.data.data);
            billsFromPaymentApp = true;
          }
        }

        // Only fall back to PO-linked bills when this voucher has no explicit settlement/bill link.
        // Otherwise a multi-bill PO would show unrelated bills for this BPV.
        if (!billsFromPaymentApp && poId) {
          const bRes = await api.get('/finance/accounts-payable', { params: { limit: 100, purchaseOrderId: poId } }).catch(() => null);
          const allBills = bRes?.data?.data?.bills || bRes?.data?.data || [];
          const matchedBills = allBills.filter((b) => {
            if (String(b.referenceId || '') === String(poId)) return true;
            if (b.lineItems?.some((li) => String(li.poId || '') === String(poId))) return true;
            if (b.linkedGRNs?.some((lg) => String(lg.poId || '') === String(poId))) return true;
            return false;
          });
          matchedBills.forEach((b) => {
            if (!poBills.some((existing) => String(existing._id) === String(b._id))) {
              poBills.push(b);
            }
          });
        }
      } catch (_) {}

      // Resolve Bill Voucher (Voucher Type: BILL) created when the bill was created
      let billVouchers = [];
      if (fullVoucher.voucherSeries === 'BILL' || fullVoucher.referenceType === 'bill') {
        billVouchers.push(fullVoucher);
      } else {
        if (poBills && poBills.length > 0) {
          for (const b of poBills) {
            try {
              const jRes = await api.get(`/finance/journal-entries/by-bill/${b._id || b.billNumber}`).catch(() => null);
              if (jRes?.data?.data && !billVouchers.some(jv => String(jv._id) === String(jRes.data.data._id))) {
                billVouchers.push(jRes.data.data);
              }
            } catch (_) {}
          }
        }
        // Only look up BILL voucher by ObjectId referenceId (never by cheque/reference text)
        if (
          billVouchers.length === 0
          && fullVoucher.referenceId
          && /^[a-fA-F0-9]{24}$/.test(String(fullVoucher.referenceId))
        ) {
          try {
            const jRes = await api.get(`/finance/journal-entries/by-bill/${fullVoucher.referenceId}`).catch(() => null);
            if (jRes?.data?.data && !billVouchers.some(jv => String(jv._id) === String(jRes.data.data._id))) {
              billVouchers.push(jRes.data.data);
            }
          } catch (_) {}
        }
      }
      const billVoucher = billVouchers[0] || null;

      if (!poId) {
        const fallbackDocs = (fullVoucher.attachments || []).map((att, idx) => ({
          id: att._id || `att-${idx}`,
          source: 'Voucher Attachment',
          name: att.originalName || att.filename || `Attachment ${idx + 1}`,
          url: att.filename ? `${(api.defaults.baseURL || '').replace(/\/api\/?$/, '')}/uploads/finance/${encodeURIComponent(att.filename)}` : '',
          uploadedAt: att.uploadedAt || null
        }));

        poBills.forEach((b) => {
          (b.attachments || []).forEach((att, idx) => {
            const pathUrl = att.path ? `${(api.defaults.baseURL || '').replace(/\/api\/?$/, '')}/${att.path.replace(/^\/+/, '')}` : '';
            fallbackDocs.push({
              id: att._id || `bill-att-${idx}`,
              source: `Vendor Bill (${b.billNumber})`,
              name: att.originalName || att.filename || `Bill Document ${idx + 1}`,
              url: pathUrl,
              uploadedAt: b.billDate || null
            });
          });
        });

        setViewDialog({
          open: true,
          voucher: fullVoucher,
          billVoucher,
          billVouchers,
          activeVoucherSubTab: billVoucher ? 'bill' : 'payment',
          po: null,
          poBills,
          poQuotations: [],
          poGrns: [],
          poLinkedDocs: fallbackDocs,
          poAuditTab: 0,
          financeAuthorityDoc: financeAuthDoc,
          vendorAdvanceDoc: vaData,
          apPaymentApp: apData,
          payrollPeriodPaymentApp: payrollData,
          cashApproval: caData,
          loading: false
        });
        return;
      }

      const r = await api.get(`/procurement/purchase-orders/${poId}`);
      const d = r.data?.data || null;

      const [qRes, grnRes] = await Promise.all([
        d?.indent?._id
          ? api.get(`/procurement/quotations/by-indent/${d.indent._id}`).catch(() => ({ data: { data: [] } }))
          : Promise.resolve({ data: { data: [] } }),
        d?._id
          ? api.get('/procurement/goods-receive', { params: { purchaseOrder: d._id, limit: 100 } }).catch(() => ({ data: { data: { receives: [] } } }))
          : Promise.resolve({ data: { data: { receives: [] } } })
      ]);

      const poQuotations = Array.isArray(qRes?.data?.data) ? qRes.data.data : [];
      const poGrns = Array.isArray(grnRes?.data?.data?.receives) ? grnRes.data.data.receives : [];
      const poLinkedDocs = [];

      const pushDocs = (items = [], source = 'Attachment') => {
        items.forEach((item, idx) => {
          const url = item?.url || (item?.path ? `${(api.defaults.baseURL || '').replace(/\/api\/?$/, '')}/${item.path.replace(/^\/+/, '')}` : '');
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

      if (d) {
        pushDocs(d.attachments, 'PO Attachment');
        if (d.indent) pushDocs(d.indent.attachments, 'Indent Attachment');
        poQuotations.forEach((q) => pushDocs(q?.attachments, `Quotation ${q?.quotationNumber || ''}`.trim()));
      }

      if (caData && caData.attachments) {
        pushDocs(caData.attachments, 'Cash Approval Attachment');
      }

      if (vaData && vaData.attachments) {
        pushDocs(vaData.attachments, 'Vendor Advance Attachment');
      }

      if (apData && apData.attachments) {
        pushDocs(apData.attachments, 'Payment App Attachment');
      }

      poBills.forEach((b) => {
        pushDocs(b.attachments, `Vendor Bill (${b.billNumber})`);
      });

      (fullVoucher.attachments || []).forEach((att, idx) => {
        const url = att.filename
          ? `${(api.defaults.baseURL || '').replace(/\/api\/?$/, '')}/uploads/finance/${encodeURIComponent(att.filename)}`
          : (att.path ? `${(api.defaults.baseURL || '').replace(/\/api\/?$/, '')}/${att.path.replace(/^\/+/, '')}` : (att.url || ''));
        poLinkedDocs.push({
          id: att._id || `v-att-${idx}`,
          source: 'Voucher Attachment',
          name: att.originalName || att.filename || `Attachment ${idx + 1}`,
          url,
          uploadedAt: att.uploadedAt || null
        });
      });

      setViewDialog({
        open: true,
        voucher: fullVoucher,
        billVoucher,
        billVouchers,
        activeVoucherSubTab: billVoucher ? 'bill' : 'payment',
        po: d,
        poBills,
        poQuotations,
        poGrns,
        poLinkedDocs,
        poAuditTab: 0,
        financeAuthorityDoc: financeAuthDoc,
        vendorAdvanceDoc: vaData,
        apPaymentApp: apData,
        payrollPeriodPaymentApp: payrollData,
        cashApproval: caData,
        loading: false
      });
    } catch (e) {
      console.error('Error loading voucher documents:', e);
      const fallbackDocs = (voucherRow.attachments || []).map((att, idx) => ({
        id: att._id || `att-${idx}`,
        source: 'Voucher Attachment',
        name: att.originalName || att.filename || `Attachment ${idx + 1}`,
        url: att.filename ? `${(api.defaults.baseURL || '').replace(/\/api\/?$/, '')}/uploads/finance/${encodeURIComponent(att.filename)}` : '',
        uploadedAt: att.uploadedAt || null
      }));
      setViewDialog({
        open: true,
        voucher: voucherRow,
        po: null,
        poBills: [],
        poQuotations: [],
        poGrns: [],
        poLinkedDocs: fallbackDocs,
        poAuditTab: 0,
        financeAuthorityDoc: null,
        vendorAdvanceDoc: null,
        apPaymentApp: null,
        payrollPeriodPaymentApp: null,
        cashApproval: null,
        loading: false
      });
    }
  };

  const handlePrintAllInOneGo = () => {
    setMultiPrintMode(true);
    setPrintSelection({
      voucher: true,
      indent: Boolean(viewDialog.po?.indent),
      po: Boolean(viewDialog.po),
      bills: Boolean(viewDialog.poBills?.length > 0),
      comparative: Boolean(viewDialog.poQuotations?.length > 0 || viewDialog.po?.indent?.comparativeApproval),
      quotations: Boolean(viewDialog.poQuotations?.length > 0),
      grns: Boolean(viewDialog.poGrns?.length > 0),
      attachments: Boolean(viewDialog.poLinkedDocs?.length > 0)
    });
    setPrintMenuAnchor(null);
    setTimeout(() => {
      window.print();
    }, 250);
  };

  const handleOpenPrintCustomizer = () => {
    setPrintSelection({
      voucher: true,
      indent: Boolean(viewDialog.po?.indent),
      po: Boolean(viewDialog.po),
      bills: Boolean(viewDialog.poBills?.length > 0),
      comparative: Boolean(viewDialog.poQuotations?.length > 0 || viewDialog.po?.indent?.comparativeApproval),
      quotations: Boolean(viewDialog.poQuotations?.length > 0),
      grns: Boolean(viewDialog.poGrns?.length > 0),
      attachments: Boolean(viewDialog.poLinkedDocs?.length > 0)
    });
    setPrintMenuAnchor(null);
    setPrintSelectDialogOpen(true);
  };

  const handleExecuteCustomPrint = () => {
    setPrintSelectDialogOpen(false);
    setMultiPrintMode(true);
    setTimeout(() => {
      window.print();
    }, 250);
  };

  const handlePrintCurrentTabOnly = () => {
    setMultiPrintMode(false);
    setPrintMenuAnchor(null);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  const fetchEntries = async (opts = {}) => {
    const nextPage = opts.page ?? page;
    const nextRowsPerPage = opts.rowsPerPage ?? rowsPerPage;
    const currentStatus = opts.status !== undefined ? opts.status : status;
    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('page', String(nextPage + 1));
      params.append('limit', String(nextRowsPerPage));
      // Only send real journal/signed filters — never "all" / blank (those match zero docs)
      const statusFilter = String(currentStatus || '').trim().toLowerCase();
      if (statusFilter && statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      if (search.trim()) params.append('search', search.trim());
      if (voucherType) params.append('referenceType', voucherType);
      // Payroll accrual JVs are auto-posted backend entries; finance uses Payroll Queue + BPV on payment.
      params.append('excludeReferenceTypes', 'payroll');
      if (selectedCompanyId) params.append('companyId', selectedCompanyId);
      const res = await api.get(`/finance/journal-entries?${params.toString()}`);
      if (seq !== fetchSeqRef.current) return; // stale response
      setEntries(res?.data?.data?.entries || []);
      setTotalCount(res?.data?.data?.pagination?.totalCount || 0);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      console.error('Error loading vouchers:', err);
      setEntries([]);
      setTotalCount(0);
      toast.error(err.response?.data?.message || 'Failed to load vouchers');
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  };

  const applyFilters = () => {
    setPage(0);
    fetchEntries({ page: 0, status });
  };

  useEffect(() => {
    setPage(0);
    setInitialDraftCheckDone(false);
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!initialDraftCheckDone) {
      const checkDrafts = async () => {
        try {
          setLoading(true);
          const params = new URLSearchParams();
          params.append('page', '1');
          params.append('limit', '1');
          params.append('status', 'draft');
          if (voucherType) params.append('referenceType', voucherType);
          params.append('excludeReferenceTypes', 'payroll');
          if (selectedCompanyId) params.append('companyId', selectedCompanyId);
          
          const res = await api.get(`/finance/journal-entries?${params.toString()}`);
          const count = res?.data?.data?.pagination?.totalCount || 0;
          
          if (count > 0) {
            setStatus('draft');
            await fetchEntries({ page: 0, status: 'draft' });
          } else {
            setStatus('all');
            await fetchEntries({ page: 0, status: 'all' });
          }
        } catch (e) {
          await fetchEntries({ page: 0, status: 'all' });
        } finally {
          setInitialDraftCheckDone(true);
        }
      };
      checkDrafts();
    } else {
      fetchEntries();
    }
  }, [page, rowsPerPage, selectedCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const voucherRows = useMemo(() => (
    entries.map((entry) => ({
      ...entry,
      voucherType: String(entry?.referenceType || 'manual').toUpperCase()
    }))
  ), [entries]);

  return (
    <Box sx={{ p: 3, '@media print': { display: 'none !important' } }} className="app-print-hide">
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <VoucherIcon color="primary" />
            <Typography variant="h5" fontWeight={700}>Voucher Center</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <FinanceCompanySelector minWidth={280} showHelper={false} />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setNewVoucherDialog(true)}
            >
              New Voucher
            </Button>
          </Box>
        </Box>
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              label="Search Voucher"
              placeholder="Entry number / reference / description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              select
              size="small"
              label="Voucher type"
              value={voucherType}
              onChange={(e) => setVoucherType(e.target.value)}
            >
              <MenuItem value="">
                <em>All types</em>
              </MenuItem>
              {VOUCHER_TYPE_FILTER_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              select
              size="small"
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="posted">Posted</MenuItem>
              <MenuItem value="draft">Draft</MenuItem>
              <MenuItem value="signed">Signed (document)</MenuItem>
              <MenuItem value="reversed">Reversed</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={2}>
            <Button fullWidth variant="contained" onClick={applyFilters}>Apply</Button>
          </Grid>
        </Grid>
      </Paper>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Voucher No</TableCell>
                <TableCell>Voucher Type</TableCell>
                <TableCell>Company</TableCell>
                <TableCell>Vendor/Customer/Employee</TableCell>
                <TableCell>Cost Center</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Cheque Number</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={11} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : voucherRows.length === 0 ? (
                <TableRow><TableCell colSpan={12} align="center">No vouchers found</TableCell></TableRow>
              ) : voucherRows.map((row) => {
                return (
                <TableRow key={row._id} hover>
                  <TableCell>{formatDate(row.date)}</TableCell>
                  <TableCell>{row.entryNumber}</TableCell>
                  <TableCell>{row.voucherType}</TableCell>
                    <TableCell>{row.companyId?.name || row.customCompany || '—'}</TableCell>
                    <TableCell>{row.vendorOrEmployeeName || '—'}</TableCell>
                    <TableCell>{row.costCenter?.name || row.costCenter || '—'}</TableCell>
                    <TableCell>{row.department?.name || (typeof row.department === 'string' ? row.department : '—')}</TableCell>
                    <TableCell>{row.reference || '—'}</TableCell>
                  <TableCell>{row.description}</TableCell>
                  <TableCell align="right">{formatPKR(row.totalDebits || 0)}</TableCell>
                    <TableCell>
                      {(() => {
                        const display = getVoucherStatusDisplay(row);
                        const chip = (
                          <Chip
                            size="small"
                            label={display.label}
                            color={display.color}
                            variant={display.variant || (display.color === 'default' ? 'outlined' : 'filled')}
                          />
                        );
                        return display.tooltip ? (
                          <Tooltip title={display.tooltip} arrow>
                            {chip}
                          </Tooltip>
                        ) : chip;
                      })()}
                    </TableCell>
                  <TableCell align="center">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        <Tooltip title="View Voucher">
                          <IconButton size="small" onClick={() => navigate(`/finance/vouchers/${row._id}`)}>
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit Voucher">
                          <IconButton size="small" color="primary" onClick={() => navigate(`/finance/journal-entries/${row._id}/edit`)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="View Docs (PO & Audit Trail)">
                          <IconButton size="small" color="info" onClick={() => handleOpenVoucherDocs(row)}>
                            <DescriptionIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {isDeveloper && (
                          <Tooltip title="Delete Voucher (Developer Only)">
                            <IconButton size="small" color="error" onClick={() => handleDeleteVoucher(row._id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
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
          rowsPerPageOptions={[25, 50, 100, 250, 500]}
        />
      </Paper>

      <Dialog open={newVoucherDialog} onClose={() => setNewVoucherDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          <Typography fontWeight={700}>Create New Voucher</Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ pt: 1 }}>
            <TextField
              select
              fullWidth
              label="Select Voucher Type"
              value={selectedNewVoucherType}
              onChange={(e) => setSelectedNewVoucherType(e.target.value)}
            >
              <MenuItem value="purchase_bill">Purchase Bill (PB)</MenuItem>
              <MenuItem value="payment_voucher">Payment Voucher (PV)</MenuItem>
              <MenuItem value="receipt_voucher">Receipt Voucher (RV)</MenuItem>
              <MenuItem value="vendor_advance">Vendor Advance (VA)</MenuItem>
              <MenuItem value="journal_voucher">Journal Voucher (JV)</MenuItem>
            </TextField>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Select the type of voucher you wish to create. This will redirect you to the corresponding financial form.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewVoucherDialog(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleCreateVoucher} 
            disabled={!selectedNewVoucherType}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {/* Related PO & Voucher Audit Documents Dialog */}
      <Dialog
        open={viewDialog.open}
        onClose={() => {
          setViewDialog((prev) => ({ ...prev, open: false }));
          setMultiPrintMode(false);
        }}
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 0,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            background: '#ffffff',
            width: '90%',
            maxWidth: '210mm',
            maxHeight: '95vh',
            '@media print': {
              boxShadow: 'none',
              maxWidth: '100%',
              margin: 0,
              padding: 0,
              height: 'auto',
              width: '100%',
              maxHeight: 'none',
              overflow: 'visible',
              position: 'static'
            }
          }
        }}
      >
        <DialogTitle sx={{ p: 0, m: 0, '@media print': { display: 'none !important' } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: '1px solid #e0e0e0' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <VoucherIcon color="primary" />
              <Typography variant="h6" sx={{ fontWeight: 600, color: '#333' }}>
                Voucher &amp; Linked Documents ({viewDialog.voucher?.entryNumber || viewDialog.po?.orderNumber || 'Audit View'})
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                startIcon={<PrintIcon />}
                endIcon={<ArrowDropDownIcon />}
                onClick={(e) => setPrintMenuAnchor(e.currentTarget)}
                size="small"
                sx={{ '@media print': { display: 'none' } }}
              >
                Print Options
              </Button>
              <Menu
                anchorEl={printMenuAnchor}
                open={Boolean(printMenuAnchor)}
                onClose={() => setPrintMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem onClick={handlePrintAllInOneGo}>
                  <PrintIcon fontSize="small" sx={{ mr: 1.5, color: 'primary.main' }} />
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Print All in One Go</Typography>
                    <Typography variant="caption" color="text.secondary">Prints Voucher + all attached docs in a single queue</Typography>
                  </Box>
                </MenuItem>
                <MenuItem onClick={handleOpenPrintCustomizer}>
                  <ChecklistIcon fontSize="small" sx={{ mr: 1.5, color: 'info.main' }} />
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Select Documents to Print...</Typography>
                    <Typography variant="caption" color="text.secondary">Choose which documents you want to include</Typography>
                  </Box>
                </MenuItem>
                <MuiDivider />
                <MenuItem onClick={handlePrintCurrentTabOnly}>
                  <DescriptionIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} />
                  <Box>
                    <Typography variant="body2">Print Current View Only</Typography>
                    <Typography variant="caption" color="text.secondary">Prints currently selected tab</Typography>
                  </Box>
                </MenuItem>
              </Menu>
                      <IconButton
                        size="small"
                onClick={() => {
                  setViewDialog((prev) => ({ ...prev, open: false }));
                  setMultiPrintMode(false);
                }}
                sx={{ color: '#666', '@media print': { display: 'none' } }}
              >
                <CloseIcon />
                      </IconButton>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0, background: '#ffffff', overflow: 'auto', '@media print': { p: 0, overflow: 'visible' } }}>
          {viewDialog.loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box sx={{ p: 0, background: '#ffffff', fontFamily: 'Arial, sans-serif' }} className="print-content">
              {/* Screen Tab Navigation */}
              <Tabs
                value={viewDialog.poAuditTab ?? 0}
                onChange={(_, v) => {
                  setMultiPrintMode(false);
                  setViewDialog((prev) => ({ ...prev, poAuditTab: v }));
                }}
                sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider', '@media print': { display: 'none' } }}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label="Voucher" />
                <Tab label="Indent" />
                <Tab label="Purchase Order" />
                <Tab label="Comparative Statement" />
                <Tab label={`Quotations (${viewDialog.poQuotations?.length || 0})`} />
                <Tab label={viewDialog.poGrns?.length > 0 ? `GRN(s) (${viewDialog.poGrns.length})` : 'GRN(s)'} />
                <Tab label={viewDialog.poBills?.length > 0 ? `Vendor Bills (${viewDialog.poBills.length})` : 'Vendor Bills'} />
                <Tab label={`Attached Documents (${viewDialog.poLinkedDocs?.length || 0})`} />
              </Tabs>

              {/* ----------------- SECTION 0: VOUCHER DETAILS ----------------- */}
              {(multiPrintMode ? printSelection.voucher : viewDialog.poAuditTab === 0) && (viewDialog.billVoucher || viewDialog.voucher) && (
                (() => {
                  const activeVoucher = (multiPrintMode && viewDialog.billVoucher)
                    ? viewDialog.billVoucher
                    : (viewDialog.activeVoucherSubTab === 'payment' && viewDialog.voucher)
                      ? viewDialog.voucher
                      : (viewDialog.billVoucher || viewDialog.voucher);
                  if (!activeVoucher) return null;

                  const hasBothVouchers = Boolean(
                    viewDialog.billVoucher &&
                    viewDialog.voucher &&
                    String(viewDialog.billVoucher._id || '') !== String(viewDialog.voucher._id || '')
                  );

                  return (
                    <Box
                      sx={{
                        p: 2,
                        '@media print': {
                          p: 0,
                          m: 0,
                          pageBreakAfter: 'always',
                          breakAfter: 'page',
                          pageBreakInside: 'avoid',
                          breakInside: 'avoid',
                          height: 'auto',
                          maxHeight: 'none',
                          overflow: 'visible'
                        }
                      }}
                    >
                      {/* Sub-tab toggle for Screen view when viewing linked Payment Voucher */}
                      {hasBothVouchers && !multiPrintMode && (
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, '@media print': { display: 'none !important' } }}>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                          size="small"
                              variant={viewDialog.activeVoucherSubTab === 'bill' ? 'contained' : 'outlined'}
                              onClick={() => setViewDialog((prev) => ({ ...prev, activeVoucherSubTab: 'bill' }))}
                              startIcon={<VoucherIcon />}
                              sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                              Bill Voucher ({viewDialog.billVoucher.entryNumber || 'Voucher Type: BILL'})
                            </Button>
                            <Button
                          size="small"
                              variant={viewDialog.activeVoucherSubTab === 'payment' ? 'contained' : 'outlined'}
                              onClick={() => setViewDialog((prev) => ({ ...prev, activeVoucherSubTab: 'payment' }))}
                              sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                              Payment Voucher ({viewDialog.voucher.entryNumber || 'Payment'})
                            </Button>
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            (Print All will print the <strong>Bill Voucher</strong>)
                          </Typography>
                        </Box>
                      )}

                      <Paper
                          sx={{
                          p: { xs: 3, sm: 3.5, md: 4 },
                          maxWidth: '210mm',
                          mx: 'auto',
                          backgroundColor: '#fff',
                          boxShadow: 'none',
                          border: '1px solid',
                          borderColor: 'divider',
                          fontFamily: 'Arial, sans-serif',
                          '@media print': {
                            p: '10mm 14mm',
                            boxShadow: 'none',
                            border: 'none',
                            maxWidth: '100%',
                            mx: 0,
                            pageBreakInside: 'avoid',
                            breakInside: 'avoid'
                          }
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2.5, '@media print': { mb: 2 } }}>
                          <Box>
                            <Typography fontWeight={700} sx={{ fontSize: '1.4rem', '@media print': { fontSize: '1.65rem', lineHeight: 1.2 } }}>
                              {activeVoucher?.companyId?.name || activeVoucher?.customCompany || '—'}
                            </Typography>
                            <Typography fontWeight={700} color="primary" sx={{ fontSize: '1.2rem', textTransform: 'uppercase', '@media print': { fontSize: '1.45rem', mt: 0.5, letterSpacing: 0.5 } }}>
                              {activeVoucher?.voucherSeries
                                ? `${activeVoucher.voucherSeries} Voucher`
                                : `${String(activeVoucher?.voucherType || activeVoucher?.referenceType || 'Bill').toUpperCase()} VOUCHER`}
                            </Typography>
                      </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography variant="body2" sx={{ '@media print': { fontSize: '1.1rem', mb: 0.5 } }}><strong>Date:</strong> {formatDateForPrint(activeVoucher.date)}</Typography>
                            <Typography variant="body2" sx={{ '@media print': { fontSize: '1.05rem', mb: 0.5 } }}>
                              <strong>Time:</strong> {activeVoucher.createdAt
                                ? new Date(activeVoucher.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
                                : new Date(activeVoucher.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                            </Typography>
                            <Typography variant="body2" sx={{ '@media print': { fontSize: '1.1rem' } }}><strong>Status:</strong> {getVoucherStatusDisplay(activeVoucher).label}</Typography>
                          </Box>
                        </Box>

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2.5, p: 2, bgcolor: '#f9f9f9', borderRadius: 1, border: '1px solid #eee', '@media print': { p: 1.8, mb: 2, bgcolor: '#fcfcfc', border: '1.5px solid #ddd' } }}>
                          <Box sx={{ '@media print': { lineHeight: 1.7 } }}>
                            <Typography variant="body2" sx={{ '@media print': { fontSize: '1.1rem', mb: 0.4 } }}><strong>Voucher No:</strong> {activeVoucher.entryNumber || '—'}</Typography>
                            <Typography variant="body2" sx={{ '@media print': { fontSize: '1.1rem', mb: 0.4 } }}><strong>Voucher Type:</strong> {String(activeVoucher.voucherType || activeVoucher.voucherSeries || activeVoucher.referenceType || 'BILL').toUpperCase()}</Typography>
                            <Typography variant="body2" sx={{ '@media print': { fontSize: '1.1rem' } }}><strong>Reference:</strong> {activeVoucher.reference || '—'}</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'right', '@media print': { lineHeight: 1.7 } }}>
                            <Typography variant="body2" sx={{ '@media print': { fontSize: '1.1rem', mb: 0.4 } }}><strong>Amount:</strong> {formatPKR(activeVoucher.totalDebits || 0)}</Typography>
                            <Typography variant="body2" sx={{ '@media print': { fontSize: '1.1rem', mb: 0.4 } }}><strong>Module:</strong> {activeVoucher.module || 'Finance'}</Typography>
                            {activeVoucher.signedBySignatory && (
                              <Typography variant="body2" sx={{ '@media print': { fontSize: '1.1rem' } }}><strong>Signed By:</strong> {activeVoucher.signedBySignatory}</Typography>
                            )}
                          </Box>
                        </Box>

                        {activeVoucher.description && (
                          <Box sx={{ mb: 2.5, '@media print': { mb: 2 } }}>
                            <Typography variant="subtitle2" fontWeight={700} sx={{ '@media print': { fontSize: '1.15rem', mb: 0.5 } }}>Narration / Description:</Typography>
                            <Typography variant="body2" sx={{ p: 1.5, bgcolor: '#fcfcfc', border: '1px solid #eee', borderRadius: 0.5, '@media print': { fontSize: '1.05rem', p: 1.2, border: '1.5px solid #ddd' } }}>
                              {activeVoucher.description}
                            </Typography>
                          </Box>
                        )}

                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, '@media print': { fontSize: '1.25rem', mb: 0.8 } }}>
                          Accounting Entries &amp; Lines
                        </Typography>
                        <Table size="small" sx={{ border: '1px solid', borderColor: 'divider', mb: 2.5, '@media print': { mb: 2, border: '1.5px solid #000' } }}>
                          <TableHead>
                            <TableRow sx={{ bgcolor: 'grey.100', '@media print': { bgcolor: '#f2f2f2' } }}>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1.2, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>Account Title</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1.2, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>Narration</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1.2, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>Ref</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1.2, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }} align="right">Debit (PKR)</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1.2, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }} align="right">Credit (PKR)</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(activeVoucher.lines || []).map((line, idx) => (
                              <TableRow key={idx}>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 1.1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>
                                  {line?.account?.name || line?.accountTitle || '—'}
                                  {line?.account?.accountNumber ? (
                                    <Typography variant="caption" display="block" color="text.secondary" sx={{ '@media print': { fontSize: '0.85rem' } }}>({line.account.accountNumber})</Typography>
                                  ) : null}
                  </TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 1.1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>{line.description || activeVoucher.description || '—'}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 1.1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>
                                  {(() => {
                                    const acc = line?.account || {};
                                    const category = (acc.category || line?.category || '').toLowerCase();
                                    const detailType = (acc.detailType || line?.detailType || '').toLowerCase();
                                    const accountCode = (acc.accountCode || line?.accountCode || '').toUpperCase();
                                    const name = (acc.name || line?.accountTitle || line?.name || '').toLowerCase();

                                    const isTaxOrWhtLine = accountCode.includes('WHT') || accountCode.includes('TAX') ||
                                      name.includes('wht') || name.includes('withholding') || name.includes('tax payable') || name.includes('income tax');

                                    if (isTaxOrWhtLine) {
                                      return '—';
                                    }

                                    const isBankOrCashLine = line?.isBank || line?.isBankLine ||
                                      category.includes('bank') || category.includes('cash') ||
                                      detailType.includes('bank') || detailType.includes('cash') ||
                                      accountCode.includes('BANK') || accountCode.includes('CASH') ||
                                      name.includes('bank') || name.includes('hbl') || name.includes('meezan') || name.includes('mcb') || name.includes('ubl') || name.includes('faysal') || name.includes('bop') || name.includes('allied') || name.includes('cash') || name.includes('c/a') || name.includes('a/c');

                                    if (line?.reference || line?.chequeNumber) {
                                      return line.reference || line.chequeNumber;
                                    }
                                    if (isBankOrCashLine) {
                                      return activeVoucher.chequeNumber || activeVoucher.reference || '—';
                                    }
                                    return '—';
                                  })()}
                  </TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 1.1, px: 1.5, fontSize: '1.05rem', fontWeight: 600, border: '1px solid #000' } }} align="right">{line.debit ? formatPKR(line.debit) : '0'}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 1.1, px: 1.5, fontSize: '1.05rem', fontWeight: 600, border: '1px solid #000' } }} align="right">{line.credit ? formatPKR(line.credit) : '0'}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow sx={{ bgcolor: '#fafafa', '@media print': { bgcolor: '#f5f5f5' } }}>
                              <TableCell colSpan={3} align="right" sx={{ fontWeight: 700, border: '1px solid', borderColor: 'divider', '@media print': { py: 1.2, px: 1.5, fontSize: '1.15rem', border: '1px solid #000' } }}>Total</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700, border: '1px solid', borderColor: 'divider', '@media print': { py: 1.2, px: 1.5, fontSize: '1.15rem', border: '1px solid #000' } }}>{formatPKR(activeVoucher.totalDebits || 0)}</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700, border: '1px solid', borderColor: 'divider', '@media print': { py: 1.2, px: 1.5, fontSize: '1.15rem', border: '1px solid #000' } }}>{formatPKR(activeVoucher.totalCredits || 0)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>

                    {/* Voucher Finance Approval Authorities */}
                    {viewDialog.financeAuthorityDoc && (
                      <Box sx={{ mt: 3, '@media print': { mt: 2.5, pageBreakInside: 'avoid', breakInside: 'avoid' } }}>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, '@media print': { fontSize: '1.25rem', mb: 0.8 } }}>
                          Finance Document Approval Authority
                        </Typography>
                        <Table size="small" sx={{ border: '1px solid', borderColor: 'divider', '@media print': { border: '1.5px solid #000' } }}>
                          <TableHead>
                            <TableRow sx={{ bgcolor: 'grey.100', '@media print': { bgcolor: '#f2f2f2' } }}>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>Authority</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>Approver</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>Status</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>Date &amp; Time</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }} align="center">Digital Signature</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                    {(() => {
                              const authorityDoc = viewDialog.financeAuthorityDoc;
                              const approvals = Array.isArray(authorityDoc?.financeAuthorityApprovals) ? authorityDoc.financeAuthorityApprovals : [];
                              const byKey = new Map(approvals.map((a) => [String(a?.authorityKey || '').trim(), a]).filter(([k]) => Boolean(k)));
                              const slots = [
                                { key: 'accountsOfficerUser', label: 'Accounts Officer / AM' },
                                { key: 'accountsManagerUser', label: 'Sr Manager Accounts' },
                                { key: 'financeControllerUser', label: 'GM Finance' },
                                { key: 'avpUser', label: 'AVP', hardcodedName: 'Fahad Farid' },
                                { key: 'ceoUser', label: 'CEO', hardcodedName: 'Sardar Umer Tanveer' },
                                { key: 'presidentUser', label: 'President', hardcodedName: 'Sardar Tanveer Ilyas' }
                              ];

                              return slots.map((slot) => {
                                const approval = byKey.get(slot.key);
                                const assigned = authorityDoc?.financeApprovalAuthorities?.[slot.key] || null;
                                const approver = approval?.approver || assigned || null;
                                const decision = approval ? String(approval.decision || 'approved').toLowerCase() : 'pending';
                                const approvedAt = approval?.approvedAt || null;
                                const approverName = slot.hardcodedName
                                  ? slot.hardcodedName
                                  : approver
                                    ? ([approver?.firstName, approver?.lastName].filter(Boolean).join(' ').trim() || approver?.email || '—')
                                    : '—';

                      return (
                                  <TableRow key={slot.key}>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider', fontWeight: 600, '@media print': { py: 1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>{slot.label}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 1, px: 1.5, fontSize: '1.05rem', border: '1px solid #000' } }}>{approverName}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.8, px: 1.2, border: '1px solid #000' } }}>
                        <Chip
                          size="small"
                                        label={decision === 'rejected' ? 'Rejected' : (decision === 'approved' ? 'Approved' : 'Pending')}
                                        color={decision === 'rejected' ? 'error' : (decision === 'approved' ? 'success' : 'warning')}
                                        variant={decision === 'approved' ? 'filled' : 'outlined'}
                                        sx={{ '@media print': { height: 26, fontSize: '0.9rem', fontWeight: 600 } }}
                                      />
                                    </TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 1, px: 1.5, fontSize: '1rem', border: '1px solid #000' } }}>{approvedAt ? formatDateForPrint(approvedAt) : '—'}</TableCell>
                                    <TableCell align="center" sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.6, px: 1, border: '1px solid #000' } }}>
                                      {decision === 'approved' && approver?.digitalSignature ? (
                                        <DigitalSignatureImage userOrPath={approver} alt={`${slot.label} signature`} sx={{ maxHeight: 56, maxWidth: 180, '@media print': { maxHeight: 52, maxWidth: 170 } }} />
                                      ) : decision === 'approved' ? (
                                        <Typography variant="caption" color="text.secondary" sx={{ '@media print': { fontSize: '0.9rem' } }}>No signature on file</Typography>
                                      ) : (
                                        <Typography variant="caption" color="text.secondary">—</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              });
                    })()}
                          </TableBody>
                        </Table>
                      </Box>
                    )}
                  </Paper>
                </Box>
              );
            })()
          )}

              {/* ----------------- SECTION 1: INDENT ----------------- */}
              {(multiPrintMode ? (printSelection.indent && viewDialog.po?.indent) : viewDialog.poAuditTab === 1) && (
                <Box
                  sx={{
                    p: 2,
                    overflowX: 'auto',
                    '@media print': {
                      p: 0,
                      m: 0,
                      pageBreakAfter: 'always',
                      breakAfter: 'page',
                      pageBreakInside: 'avoid',
                      breakInside: 'avoid',
                      height: '100%',
                      maxHeight: '100vh',
                      overflow: 'hidden'
                    }
                  }}
                >
                  {!viewDialog.po?.indent ? (
                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      No indent linked with this Purchase Order.
                    </Typography>
                  ) : (
                    <Paper sx={{ p: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider', '@media print': { p: '12mm 15mm', border: 'none', maxWidth: '100%', mx: 0, pageBreakInside: 'avoid', breakInside: 'avoid' } }}>
                      <Typography variant="h5" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1, '@media print': { fontSize: '1.2rem', mb: 0.5 } }}>
                        Purchase Request Form
                      </Typography>
                      {viewDialog.po.indent.title && (
                        <Typography variant="h6" fontWeight={600} align="center" sx={{ mb: 1.5, '@media print': { fontSize: '0.95rem', mb: 1 } }}>
                          {viewDialog.po.indent.title}
                        </Typography>
                      )}
                      <Box sx={{ mb: 1, fontSize: '0.9rem', textAlign: 'center', '@media print': { fontSize: '0.8rem', mb: 0.5 } }}>
                        <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                        <Typography component="span" sx={{ ml: 1 }}>
                          {viewDialog.po.indent.erpRef || 'PR #' + (viewDialog.po.indent.indentNumber?.split('-').pop() || '')}
                        </Typography>
                      </Box>
                      <Box sx={{ mb: 1, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 4, '@media print': { fontSize: '0.78rem', mb: 0.8, gap: 2 } }}>
                        <Box>
                          <Typography component="span" fontWeight={600}>Date:</Typography>
                          <Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.po.indent.requestedDate)}</Typography>
                        </Box>
                        <Box>
                          <Typography component="span" fontWeight={600}>Required Date:</Typography>
                          <Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(viewDialog.po.indent.requiredDate) || '—'}</Typography>
                        </Box>
                        <Box>
                          <Typography component="span" fontWeight={600}>Indent No.:</Typography>
                          <Typography component="span" sx={{ ml: 1 }}>{viewDialog.po.indent.indentNumber || '—'}</Typography>
                        </Box>
                      </Box>
                      <Box sx={{ mb: 1.5, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 4, '@media print': { fontSize: '0.78rem', mb: 1, gap: 2 } }}>
                        <Box>
                          <Typography component="span" fontWeight={600}>Department:</Typography>
                          <Typography component="span" sx={{ ml: 1 }}>{viewDialog.po.indent.department?.name || viewDialog.po.indent.department || '—'}</Typography>
                        </Box>
                        <Box>
                          <Typography component="span" fontWeight={600}>Originator:</Typography>
                          <Typography component="span" sx={{ ml: 1 }}>
                            {viewDialog.po.indent.requestedBy?.firstName && viewDialog.po.indent.requestedBy?.lastName
                              ? `${viewDialog.po.indent.requestedBy.firstName} ${viewDialog.po.indent.requestedBy.lastName}`
                              : viewDialog.po.indent.requestedBy?.name || '—'}
                          </Typography>
                        </Box>
                      </Box>
                      <Box sx={{ mb: 2, '@media print': { mb: 1 } }}>
                        <Table size="small" sx={{ border: '1px solid', borderColor: 'divider' }}>
                          <TableHead>
                            <TableRow sx={{ bgcolor: 'grey.100' }}>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.73rem' } }}>S#</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.73rem' } }}>Item Name</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.73rem' } }}>Description</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.73rem' } }}>Brand</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.73rem' } }}>Unit</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.73rem' } }} align="center">Qty</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.73rem' } }}>Purpose</TableCell>
                              <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.73rem' } }} align="right">Est. Cost</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(viewDialog.po.indent.items || []).map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }} align="center">{idx + 1}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>{item.itemName || '—'}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>{item.description || '—'}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>{item.brand || '—'}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>{item.unit || '—'}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }} align="center">{item.quantity ?? '—'}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>{item.purpose || '—'}</TableCell>
                                <TableCell sx={{ border: '1px solid', borderColor: 'divider', '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }} align="right">{item.estimatedCost != null ? Number(item.estimatedCost).toFixed(2) : '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                      {viewDialog.po.indent.justification && (
                        <Box sx={{ mb: 1.5, '@media print': { mb: 1 } }}>
                          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5, '@media print': { fontSize: '0.78rem' } }}>Justification:</Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, '@media print': { fontSize: '0.72rem', p: 0.5 } }}>
                            {viewDialog.po.indent.justification}
                          </Typography>
                        </Box>
                      )}
                      {Array.isArray(viewDialog.po.indent.approvalChain) && viewDialog.po.indent.approvalChain.length > 0 && (
                        <Box sx={{ mt: 2, '@media print': { mt: 1, pageBreakInside: 'avoid', breakInside: 'avoid' } }}>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, '@media print': { fontSize: '0.8rem', mb: 0.5 } }}>
                            Indent approval progress
                          </Typography>
                          <Table size="small" sx={{ border: '1px solid', borderColor: 'divider', maxWidth: 760 }}>
                            <TableHead>
                              <TableRow sx={{ bgcolor: 'action.hover' }}>
                                <TableCell sx={{ fontWeight: 700, '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>Approver</TableCell>
                                <TableCell sx={{ fontWeight: 700, '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>Status</TableCell>
                                <TableCell sx={{ fontWeight: 700, '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>Date &amp; time</TableCell>
                                <TableCell sx={{ fontWeight: 700, '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }} align="center">Digital signature</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {viewDialog.po.indent.approvalChain.map((step, idx) => {
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
                                    <TableCell sx={{ '@media print': { py: 0.4, px: 0.6, fontSize: '0.72rem' } }}>{name}</TableCell>
                                    <TableCell sx={{ '@media print': { py: 0.3, px: 0.5 } }}>
                                      <Chip size="small" label={chipLabel} color={chipColor} variant={status === 'pending' ? 'outlined' : 'filled'} sx={{ '@media print': { height: 20, fontSize: '0.65rem' } }} />
                  </TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap', '@media print': { py: 0.4, px: 0.6, fontSize: '0.7rem' } }}>{step?.actedAt ? formatDateForPrint(step.actedAt) : '—'}</TableCell>
                                    <TableCell align="center" sx={{ '@media print': { py: 0.2, px: 0.4 } }}>
                                      {status === 'approved' && approver?.digitalSignature ? (
                                        <DigitalSignatureImage userOrPath={approver} alt={`Signature ${name}`} sx={{ maxHeight: 36, maxWidth: 120, '@media print': { maxHeight: 32, maxWidth: 100 } }} />
                                      ) : status === 'approved' ? (
                                        <Typography variant="caption" color="text.secondary" sx={{ '@media print': { fontSize: '0.65rem' } }}>No signature on file</Typography>
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

              {/* ----------------- SECTION 2: PURCHASE ORDER ----------------- */}
              {(multiPrintMode ? (printSelection.po && viewDialog.po) : viewDialog.poAuditTab === 2) && (
                <Box
                  sx={{
                    p: 2,
                    '@media print': {
                      p: 0,
                      m: 0,
                      pageBreakAfter: 'always',
                      breakAfter: 'page',
                      pageBreakInside: 'avoid',
                      breakInside: 'avoid',
                      height: '100%',
                      maxHeight: '100vh',
                      overflow: 'hidden'
                    }
                  }}
                >
                  {!viewDialog.po ? (
                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      No direct Purchase Order linked with this voucher. See Attached Documents tab.
                    </Typography>
                  ) : (
                    <Paper
                      className="finance-po-print-page"
                      sx={{
                        p: { xs: 2, sm: 2.5 },
                        maxWidth: '210mm',
                        mx: 'auto',
                        backgroundColor: '#fff',
                        boxShadow: 'none',
                        width: '100%',
                        fontFamily: 'Arial, sans-serif',
                        '@media print': {
                          boxShadow: 'none',
                          p: '5mm 7mm',
                          maxWidth: '100%',
                          backgroundColor: '#fff',
                          mx: 0,
                          width: '100%',
                          pageBreakInside: 'avoid',
                          breakInside: 'avoid'
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
                          mb: 1,
                          fontSize: { xs: '1.25rem', print: '1.05rem' },
                          letterSpacing: 0.5,
                          '@media print': { mb: 0.5, lineHeight: 1.2 }
                        }}
                      >
                        Purchase Order
                      </Typography>

                      {/* Buyer Information */}
                      <Box sx={{ mb: 0.75, '@media print': { mb: 0.4 } }}>
                        <Typography variant="h6" fontWeight={600} sx={{ mb: 0.25, fontSize: '0.9rem', '@media print': { fontSize: '0.78rem', mb: 0.15 } }}>
                          {viewDialog.po.companyId?.name || viewDialog.po.indent?.companyId?.name || '—'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.78rem', lineHeight: 1.25, '@media print': { fontSize: '0.68rem' } }}>
                          Link Road I-14, adjacent to CDA Sectors I-14 and I-15
                        </Typography>
                      </Box>

                      <Divider sx={{ my: 0.75, borderWidth: 1, borderColor: '#ccc', '@media print': { my: 0.4 } }} />

                      {/* Vendor and PO Details */}
                      <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', gap: 1.5, '@media print': { mb: 0.6, gap: 1 } }}>
                        <Box sx={{ width: '48%', fontSize: '0.78rem', '@media print': { fontSize: '0.68rem' } }}>
                          <Typography variant="h6" fontWeight={600} sx={{ mb: 0.25, fontSize: '0.85rem', '@media print': { fontSize: '0.74rem', mb: 0.15 } }}>
                            {viewDialog.po.vendor?.name || 'Vendor Name'}
                          </Typography>
                          <Typography sx={{ fontSize: 'inherit', lineHeight: 1.3, mb: 0.25, fontWeight: 600 }}>
                            Payee Name: {viewDialog.po.vendor?.payeeName || viewDialog.po.vendor?.name || '—'}
                          </Typography>
                          <Typography sx={{ fontSize: 'inherit', lineHeight: 1.3, mb: 0.35 }}>
                            {viewDialog.po.vendor?.address || 'Vendor Address'}
                          </Typography>
                          {(viewDialog.po.vendor?.ntnCnic || viewDialog.po.vendor?.ntnNo || viewDialog.po.vendor?.cnic) && (
                            <Typography sx={{ fontSize: 'inherit', fontWeight: 600, mb: 0.35, color: 'text.secondary' }}>
                              ntn / cnic : {viewDialog.po.vendor.ntnCnic || viewDialog.po.vendor.ntnNo || viewDialog.po.vendor.cnic}
                            </Typography>
                          )}
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', lineHeight: 1.3 }}>
                            <Typography component="span" sx={{ fontWeight: 600, mr: 0.5, fontSize: 'inherit' }}>Indent Details:</Typography>
                            <Typography component="span" sx={{ fontSize: 'inherit' }}>
                              Indent# {viewDialog.po.indent?.indentNumber || 'N/A'} Dated. {viewDialog.po.indent?.requestedDate ? formatDateForPrint(viewDialog.po.indent.requestedDate) : 'N/A'}.
                              {viewDialog.po.indent?.title && ` ${viewDialog.po.indent.title}.`}
                              {viewDialog.po.indent?.requestedBy && ` End User. ${viewDialog.po.indent.requestedBy.firstName || ''} ${viewDialog.po.indent.requestedBy.lastName || ''}`}
                            </Typography>
                          </Box>
                        </Box>

                        <Box sx={{ width: '48%', fontSize: '0.78rem', lineHeight: 1.35, '@media print': { fontSize: '0.68rem', lineHeight: 1.25 } }}>
                          <Box sx={{ display: 'flex', mb: 0.1 }}>
                            <Typography component="span" sx={{ minWidth: '110px', fontWeight: 600, fontSize: 'inherit' }}>P.O No.:</Typography>
                            <Typography component="span" sx={{ fontSize: 'inherit' }}>
                              {viewDialog.po.orderNumber ? 
                                (viewDialog.po.orderNumber.startsWith('P') && !viewDialog.po.orderNumber.includes('-')
                                  ? viewDialog.po.orderNumber
                                  : 'P' + (viewDialog.po.orderNumber.match(/\d+$/)?.[0] || viewDialog.po.orderNumber.split('-').pop() || '').padStart(9, '0'))
                                : 'N/A'}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', mb: 0.1 }}>
                            <Typography component="span" sx={{ minWidth: '110px', fontWeight: 600, fontSize: 'inherit' }}>Date:</Typography>
                            <Typography component="span" sx={{ fontSize: 'inherit' }}>{formatDateForPrint(viewDialog.po.orderDate)}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', mb: 0.1 }}>
                            <Typography component="span" sx={{ minWidth: '110px', fontWeight: 600, fontSize: 'inherit' }}>Delivery Date:</Typography>
                            <Typography component="span" sx={{ fontSize: 'inherit' }}>{viewDialog.po.expectedDeliveryDate ? formatDateForPrint(viewDialog.po.expectedDeliveryDate) : '___________'}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', mb: 0.1 }}>
                            <Typography component="span" sx={{ minWidth: '110px', fontWeight: 600, fontSize: 'inherit' }}>Delivery Address:</Typography>
                            <Typography component="span" sx={{ fontSize: 'inherit' }}>
                              {(() => {
                                if (viewDialog.po.deliveryAddress && typeof viewDialog.po.deliveryAddress === 'string' && viewDialog.po.deliveryAddress.trim()) {
                                  return viewDialog.po.deliveryAddress.trim();
                                }
                                if (viewDialog.po.shippingAddress && typeof viewDialog.po.shippingAddress === 'object') {
                                  const parts = [
                                    viewDialog.po.shippingAddress.street,
                                    viewDialog.po.shippingAddress.city,
                                    viewDialog.po.shippingAddress.state,
                                    viewDialog.po.shippingAddress.zipCode,
                                    viewDialog.po.shippingAddress.country
                                  ].filter(Boolean);
                                  if (parts.length > 0) return parts.join(', ');
                                }
                                if (viewDialog.po.vendor?.address) return viewDialog.po.vendor.address;
                                return '___________';
                              })()}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', mb: 0.1 }}>
                            <Typography component="span" sx={{ minWidth: '110px', fontWeight: 600, fontSize: 'inherit' }}>Cost Center:</Typography>
                            <Typography component="span" sx={{ fontSize: 'inherit' }}>{formatPurchaseOrderCostCenter(viewDialog.po)}</Typography>
                          </Box>
                        </Box>
                      </Box>

                      {/* Items Table */}
                      <Box sx={{ mb: 0.75, '@media print': { mb: 0.5 } }}>
                        <table
                          className="finance-po-items-table"
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            border: '1px solid #000',
                            fontSize: '0.68rem',
                            fontFamily: 'Arial, sans-serif',
                            lineHeight: 1.2
                          }}
                        >
                          <thead>
                            <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'center', width: '5%' }}>Sr no</th>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'left', width: '11%' }}>Product</th>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'left', width: '23%' }}>Description</th>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'left', width: '14%' }}>Specification</th>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'left', width: '11%' }}>Brand</th>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'center', width: '11%' }}>Quantity Unit</th>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'right', width: '9%' }}>Rate</th>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'right', width: '9%' }}>Discount</th>
                              <th style={{ border: '1px solid #000', padding: '3px 3px', fontWeight: 700, textAlign: 'right', width: '11%' }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {viewDialog.po.items && viewDialog.po.items.length > 0 ? (
                              viewDialog.po.items.map((item, index) => (
                                <tr key={index} style={{ border: '1px solid #000' }}>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'center', verticalAlign: 'top' }}>{index + 1}</td>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', verticalAlign: 'top' }}>
                                    {item.productCode || viewDialog.po.indent?.items?.[index]?.itemCode || `44-001-${String(index + 1).padStart(4, '0')}`}
                                  </td>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', verticalAlign: 'top' }}>
                                    {item.itemName || item.description || viewDialog.po.indent?.items?.[index]?.itemName || '___________'}
                                  </td>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', verticalAlign: 'top' }}>
                                    {(() => {
                                      if (item.specification && String(item.specification).trim()) return item.specification.trim();
                                      const indentItem = viewDialog.po.indent?.items?.[index];
                                      if (indentItem?.specification && String(indentItem.specification).trim()) return indentItem.specification.trim();
                                      if (indentItem?.description && String(indentItem.description).trim()) return indentItem.description.trim();
                                      if (indentItem?.purpose && String(indentItem.purpose).trim()) return indentItem.purpose.trim();
                                      return '___________';
                                    })()}
                                  </td>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', verticalAlign: 'top' }}>
                                    {item.brand || viewDialog.po.indent?.items?.[index]?.brand || '___________'}
                                  </td>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'center', verticalAlign: 'top' }}>
                                    {item.quantity ? `${Math.round(Number(item.quantity)).toLocaleString()} ${item.unit || 'Nos'}` : '___________'}
                                  </td>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'right', verticalAlign: 'top' }}>
                                    {item.unitPrice != null ? Math.round(Number(item.unitPrice)).toLocaleString() : '___________'}
                                  </td>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'right', verticalAlign: 'top' }}>
                                    {Math.round(Number(item.discount || 0)).toLocaleString()}
                                  </td>
                                  <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'right', verticalAlign: 'top' }}>
                                    {item.totalPrice || item.amount ? Math.round(Number(item.totalPrice || item.amount)).toLocaleString() : '___________'}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={9} style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'center' }}>
                                  No items
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </Box>

                      {/* Financial Summary */}
                      <Box sx={{ mb: 0.75, display: 'flex', justifyContent: 'flex-end', '@media print': { mb: 0.45 } }}>
                        <Box sx={{ width: '240px', fontSize: '0.72rem', '@media print': { fontSize: '0.65rem' } }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.15 }}>
                            <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Subtotal:</Typography>
                            <Typography component="span" sx={{ fontSize: 'inherit' }}>{Math.round(Number(viewDialog.po.subtotal || viewDialog.po.totalAmount || 0)).toLocaleString()}</Typography>
                          </Box>
                          {Number(viewDialog.po.taxAmount) > 0 && (
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.15 }}>
                              <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Tax:</Typography>
                              <Typography component="span" sx={{ fontSize: 'inherit' }}>{Math.round(Number(viewDialog.po.taxAmount)).toLocaleString()}</Typography>
                            </Box>
                          )}
                          {Number(viewDialog.po.shippingCost) > 0 && (
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.15 }}>
                              <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Freight Charges:</Typography>
                              <Typography component="span" sx={{ fontSize: 'inherit' }}>{Math.round(Number(viewDialog.po.shippingCost)).toLocaleString()}</Typography>
                            </Box>
                          )}
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.15 }}>
                            <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Total Amount:</Typography>
                            <Typography component="span" sx={{ fontSize: 'inherit', fontWeight: 700 }}>{Math.round(Number(viewDialog.po.totalAmount || 0)).toLocaleString()}</Typography>
                          </Box>
                          <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, fontStyle: 'italic', mt: 0.25, '@media print': { fontSize: '0.6rem' } }}>
                            Rupees {numberToWords(Math.round(Number(viewDialog.po.totalAmount || 0)))}
                          </Typography>
                        </Box>
                      </Box>

                      {/* Terms & Conditions */}
                      <Box sx={{ mb: 0.75, border: '1px solid #ccc', p: 0.7, fontSize: '0.68rem', '@media print': { p: 0.45, mb: 0.45, fontSize: '0.62rem' } }}>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.25, textDecoration: 'underline', fontSize: '0.72rem', '@media print': { fontSize: '0.65rem', mb: 0.15 } }}>
                          TERMS &amp; CONDITIONS
                        </Typography>
                        <Box sx={{ lineHeight: 1.25 }}>
                          <Box sx={{ mb: 0.15 }}>
                            <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Payment Terms:</Typography>
                            <Typography component="span" sx={{ ml: 0.5, fontSize: 'inherit' }}>
                              {viewDialog.po.paymentTerms || '100% Advance Payment'}
                            </Typography>
                          </Box>
                          <Box sx={{ mb: 0.15 }}>
                            <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Delivery Terms:</Typography>
                            <Typography component="span" sx={{ ml: 0.5, fontSize: 'inherit' }}>
                              At-Site Delivery
                            </Typography>
                          </Box>
                          <Box sx={{ mb: 0.15 }}>
                            <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Delivery Time.</Typography>
                            <Typography component="span" sx={{ ml: 0.5, fontSize: 'inherit' }}>
                              Delivery within: {viewDialog.po.quotation?.deliveryTime || '03 days'} of confirmed PO &amp; Payment
                            </Typography>
                          </Box>
                          {(viewDialog.po.vendor?.cnic || viewDialog.po.vendor?.payeeName) && (
                            <Typography sx={{ fontSize: 'inherit' }}>
                              {[viewDialog.po.vendor?.cnic ? `CNIC: ${viewDialog.po.vendor.cnic}` : '', viewDialog.po.vendor?.payeeName ? `Payee: ${viewDialog.po.vendor.payeeName}` : ''].filter(Boolean).join(' | ')}
                            </Typography>
                          )}
                        </Box>
                      </Box>

                      {/* Approval Authorities Table — compact like vendor bill print */}
                      <StoreVettingNotice indent={viewDialog.po?.indent} sx={{ mb: 0.75 }} />
                      <Typography variant="subtitle2" fontWeight={800} sx={{ textAlign: 'left', mb: 0.35, fontSize: '0.72rem', color: '#1e293b', '@media print': { fontSize: '10px', mb: 0.25 } }}>
                        Finance Document Approval Authority
                      </Typography>
                      <TableContainer component={Box} sx={{ border: '1.5px solid #334155', mb: 0.5, '@media print': { pageBreakInside: 'avoid', breakInside: 'avoid', mb: 0 } }}>
                        <Table size="small"
                          sx={{
                            '& th': {
                              bgcolor: '#f1f5f9',
                              fontWeight: 800,
                              fontSize: '0.7rem',
                              border: '1px solid #cbd5e1',
                              py: 0.35,
                              px: 0.6,
                              '@media print': { py: 0.25, px: 0.5, fontSize: '9.5px' }
                            },
                            '& td': {
                              fontSize: '0.68rem',
                              border: '1px solid #cbd5e1',
                              py: 0.3,
                              px: 0.6,
                              verticalAlign: 'middle',
                              '@media print': { py: 0.2, px: 0.5, fontSize: '9.5px' }
                            }
                          }}
                        >
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ width: '25%' }}>Authority</TableCell>
                              <TableCell sx={{ width: '25%' }}>Name</TableCell>
                              <TableCell sx={{ width: '25%' }} align="center">Digital Signature</TableCell>
                              <TableCell sx={{ width: '25%' }}>Date &amp; Time</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(() => {
                              const poData = viewDialog.po;
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

                              return authorityRows.map((row) => {
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
                                    <TableCell sx={{ fontWeight: 800 }}>{row.label}</TableCell>
                                    <TableCell>{displayAuthorityName}</TableCell>
                                    <TableCell align="center">
                                      {authorityUser?.digitalSignature ? (
                                        <Box sx={{ maxHeight: 24, display: 'flex', justifyContent: 'center', alignItems: 'center', '& img': { maxHeight: 24, width: 'auto', objectFit: 'contain' }, '@media print': { maxHeight: 20, '& img': { maxHeight: 20 } } }}>
                                          <DigitalSignatureImage userOrPath={authorityUser} alt={`${row.label} signature`} sx={{ maxHeight: 24, maxWidth: 90, '@media print': { maxHeight: 20, maxWidth: 80 } }} />
                                        </Box>
                                      ) : (
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', '@media print': { fontSize: '9px' } }}>—</Typography>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {actionDate ? formatDateForPrint(actionDate) : '—'}
                                    </TableCell>
                                  </TableRow>
                                );
                              });
                            })()}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
                  )}
                </Box>
              )}

              {/* ----------------- SECTION 3: COMPARATIVE STATEMENT ----------------- */}
              {(multiPrintMode ? (printSelection.comparative && (viewDialog.poQuotations?.length > 0 || viewDialog.po?.indent?.comparativeApproval)) : viewDialog.poAuditTab === 3) && (
                <Box
                  sx={{
                    p: 2,
                    overflowX: 'auto',
                    '@media print': {
                      p: 0,
                      m: 0,
                      pageBreakAfter: 'always',
                      breakAfter: 'page',
                      pageBreakInside: 'avoid',
                      breakInside: 'avoid'
                    }
                  }}
                >
                  <ComparativeStatementView
                    requisition={viewDialog.po?.indent}
                    quotations={viewDialog.poQuotations || []}
                    approvalAuthority={viewDialog.po?.indent?.comparativeStatementApprovals || {}}
                    note={viewDialog.po?.indent?.notes ?? ''}
                    readOnly
                    formatNumber={(n) => Number(n || 0).toLocaleString()}
                    loadingQuotations={false}
                    showPrintButton={false}
                  />
                </Box>
              )}

              {/* ----------------- SECTION 4: QUOTATIONS ----------------- */}
              {(multiPrintMode ? (printSelection.quotations && viewDialog.poQuotations?.length > 0) : viewDialog.poAuditTab === 4) && (
                <Box
                  sx={{
                    p: 2,
                    '@media print': {
                      p: 0,
                      m: 0,
                      pageBreakAfter: 'always',
                      breakAfter: 'page',
                      pageBreakInside: 'avoid',
                      breakInside: 'avoid'
                    }
                  }}
                >
                  {(!viewDialog.poQuotations || viewDialog.poQuotations.length === 0) ? (
                    <Typography color="text.secondary">No quotations linked with this PO.</Typography>
                  ) : (
                    <Stack spacing={4}>
                      {viewDialog.poQuotations.map((q) => (
                        <Box key={q._id} sx={{ '@media print': { pageBreakAfter: 'always', breakAfter: 'page', pageBreakInside: 'avoid', breakInside: 'avoid' } }}>
                          <QuotationDetailView
                            quotation={q}
                            formatNumber={(n) => Number(n || 0).toLocaleString()}
                            formatDateForPrint={formatDateForPrint}
                          />
          </Box>
                      ))}
                    </Stack>
                  )}
            </Box>
          )}

              {/* ----------------- SECTION 5: GRNS ----------------- */}
              {(multiPrintMode ? (printSelection.grns && viewDialog.poGrns?.length > 0) : viewDialog.poAuditTab === 5) && (
                <Box
                  sx={{
                    p: 2,
                    '@media print': {
                      p: 0,
                      m: 0,
                      pageBreakAfter: 'always',
                      breakAfter: 'page',
                      pageBreakInside: 'avoid',
                      breakInside: 'avoid'
                    }
                  }}
                >
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
                              <TableCell>{formatDateForPrint(grn.receiveDate)}</TableCell>
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

              {/* ----------------- SECTION 6: VENDOR BILLS ----------------- */}
              {(multiPrintMode ? (printSelection.bills && viewDialog.poBills?.length > 0) : viewDialog.poAuditTab === 6) && (
                <Box
                  sx={{
                    p: 2,
                    '@media print': {
                      p: 0,
                      m: 0,
                      pageBreakAfter: 'always',
                      breakAfter: 'page',
                      pageBreakInside: 'avoid',
                      breakInside: 'avoid'
                    }
                  }}
                >
                  {(!viewDialog.poBills || viewDialog.poBills.length === 0) ? (
                    <Typography color="text.secondary">No vendor bills attached.</Typography>
                  ) : (
                    <Stack spacing={4}>
                      {viewDialog.poBills.map((b) => {
                        const getApprovalRows = () => {
                          const formatDateTime = (date) => {
                            if (!date) return '-';
                            return new Date(date).toLocaleString('en-PK', {
                              day: '2-digit', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit'
                            });
                          };

                          const userDisplayName = (u) => {
                            if (!u) return '-';
                            if (typeof u === 'string') return u;
                            const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || u.email;
                            return name || '-';
                          };

                          const rows = [];
                          const isCentralizedStore = b?.referenceType === 'utility_bill' || b?.module === 'taj_utilities';
                          const srcBill = b?.sourceUtilityBill;

                          // 1. Sig of Requester
                          const requester = (isCentralizedStore && srcBill?.createdBy) ? srcBill.createdBy : b?.createdBy;
                          const requesterDate = (isCentralizedStore && srcBill?.createdAt) ? srcBill.createdAt : b?.createdAt;
                          rows.push({
                            authority: 'Sig of Requester',
                            name: userDisplayName(requester),
                            status: 'Approved',
                            signatureUser: requester || null,
                            signaturePath: requester?.digitalSignature || '',
                            dateTime: requesterDate ? formatDateTime(requesterDate) : '-'
                          });

                          // 2. Manager / HOD Approver (from source utility bill)
                          if (isCentralizedStore && srcBill) {
                            const approvalChain = Array.isArray(srcBill.approvalChain) ? srcBill.approvalChain : [];
                            approvalChain.forEach((step) => {
                              if (step.status === 'approved' && step.approver) {
                                rows.push({
                                  authority: 'Manager / HOD Approver',
                                  name: userDisplayName(step.approver),
                                  status: 'Approved',
                                  signatureUser: step.approver || null,
                                  signaturePath: step.approver?.digitalSignature || '',
                                  dateTime: step.actedAt ? formatDateTime(step.actedAt) : '-'
                                });
                              }
                            });
                            if (!rows.some(r => r.authority === 'Manager / HOD Approver') && srcBill.approvedBy) {
                              rows.push({
                                authority: 'Manager / HOD Approver',
                                name: userDisplayName(srcBill.approvedBy),
                                status: 'Approved',
                                signatureUser: srcBill.approvedBy || null,
                                signaturePath: srcBill.approvedBy?.digitalSignature || '',
                                dateTime: srcBill.approvedAt ? formatDateTime(srcBill.approvedAt) : '-'
                              });
                            }
                          }

                          // 3. Pre-Audit & 4. Audit Director
                          const auditHistory = (isCentralizedStore && srcBill && Array.isArray(srcBill.workflowHistory) && srcBill.workflowHistory.length > 0)
                            ? [...srcBill.workflowHistory]
                            : (Array.isArray(b?.workflowHistory) ? [...b.workflowHistory] : []);

                          const preAuditEntry = [...auditHistory].reverse().find((e) =>
                            e.toStatus === 'Forwarded to Audit Director' || e.toStatus === 'initial audit approval' ||
                            e.toStatus === 'Initial Pre-Audit Approved' || e.toStatus?.includes('Pre-Audit') || e.toStatus === 'Send to Audit'
                          );
                          const directorEntry = [...auditHistory].reverse().find((e) =>
                            e.toStatus === 'approved' || e.toStatus === 'Approved' ||
                            e.toStatus?.includes('Audit Director') || e.toStatus?.startsWith('Approved (from')
                          );

                          rows.push({
                            authority: 'Pre-Audit Authority',
                            name: userDisplayName(preAuditEntry?.changedBy),
                            status: preAuditEntry ? 'Approved' : 'Pending',
                            signatureUser: preAuditEntry?.changedBy || null,
                            signaturePath: preAuditEntry?.stampUsed && preAuditEntry?.stampImage ? preAuditEntry.stampImage : (preAuditEntry?.changedBy?.digitalSignature || ''),
                            dateTime: preAuditEntry?.changedAt ? formatDateTime(preAuditEntry.changedAt) : '-'
                          });

                          rows.push({
                            authority: 'Audit Director',
                            name: userDisplayName(directorEntry?.changedBy),
                            status: directorEntry ? 'Approved' : 'Pending',
                            signatureUser: directorEntry?.changedBy || null,
                            signaturePath: directorEntry?.stampUsed && directorEntry?.stampImage ? directorEntry.stampImage : (directorEntry?.changedBy?.digitalSignature || ''),
                            dateTime: directorEntry?.changedAt ? formatDateTime(directorEntry.changedAt) : '-'
                          });

                          // 5. Finance
                          if (Array.isArray(b?.financeApprovalAuthorities) && b.financeApprovalAuthorities.length > 0) {
                            b.financeApprovalAuthorities.forEach((auth) => {
                              rows.push({
                                authority: auth.levelName || auth.levelKey || 'Finance Authority',
                                name: auth.assignedUser ? userDisplayName(auth.assignedUser) : (auth.userName || '-'),
                                status: auth.status || 'Pending',
                                signatureUser: auth.assignedUser || null,
                                signaturePath: auth.digitalSignature || auth.assignedUser?.digitalSignature || '',
                                dateTime: auth.actedAt ? formatDateTime(auth.actedAt) : '-'
                              });
                            });
                          } else {
                            rows.push({
                              authority: 'Finance Authority',
                              name: userDisplayName(b?.approval?.approvedBy),
                              status: b?.approval?.approvedBy ? 'Approved' : (b?.status === 'paid' ? 'Approved' : 'Pending'),
                              signatureUser: b?.approval?.approvedBy || null,
                              dateTime: b?.approval?.approvedDate ? formatDateTime(b.approval.approvedDate) : '-'
                            });
                          }

                          return rows;
                        };

                        const getSignatureSource = (row) => row?.signaturePath || row?.signatureUser?.digitalSignature || '';
                        const vendorName = b?.vendorName || b?.vendor?.name || (typeof b?.vendor === 'string' ? b?.vendor : '—');
                        const billCompanyName = b?.companyId?.name || b?.company?.name || b?.company || 'SGC International';

                        const normalizedBillData = {
                          ...b,
                          billId: b.billNumber,
                          billDate: b.billDate,
                          createdAt: b.createdAt || b.billDate,
                          provider: vendorName,
                          location: billCompanyName,
                          notes: b.notes || b.internalNotes,
                          forWhat: b.forWhat || b.notes,
                          duePaymentAmount: getDuePaymentAmountFromBill(b),
                          billLines: (b.lineItems && b.lineItems.length > 0)
                            ? b.lineItems.map((line, idx) => {
                                let code = (line.itemCode && line.itemCode !== '—') ? line.itemCode : '';
                                if (!code) {
                                  const text = [line.description, line.itemName].filter(Boolean).join(' ');
                                  const match = text.match(/\[([A-Za-z0-9_-]+)\]/);
                                  if (match && match[1]) code = match[1];
                                }
                                return {
                                  ...line,
                                  category: line.category || line.accountName || line.account?.name || (line.accountNumber ? `Account ${line.accountNumber}` : '—'),
                                  accountName: line.accountName || line.account?.name || '',
                                  accountNumber: line.accountNumber || line.account?.accountNumber || '',
                                  itemName: line.itemName || line.description || (line.accountNumber ? `Account ${line.accountNumber}` : 'Item'),
                                  description: line.description || line.itemName || '',
                                  itemCode: code || line.accountNumber || '—',
                                  amount: line.amount || (line.quantity * line.unitPrice) || 0,
                                  duePaymentAmount: getLineDuePaymentAmount(b, line, idx),
                                  attachments: idx === 0 && b.attachments?.length ? b.attachments.map(a => ({ url: a.path || a.filename, originalName: a.originalName })) : undefined
                                };
                              })
                            : (b.billLines || [])
                        };

                        const billStatusColorMap = {
                          draft: 'default',
                          pending: 'warning',
                          approved: 'info',
                          paid: 'success',
                          partial: 'warning',
                          cancelled: 'error'
                        };

                        return (
                          <Box key={b._id} sx={{ '@media print': { pageBreakAfter: 'always', breakAfter: 'page', pageBreakInside: 'avoid', breakInside: 'avoid' } }}>
                            <Paper
                              sx={{
                                p: { xs: 3, sm: 4 },
                                maxWidth: '210mm',
                                mx: 'auto',
                                backgroundColor: '#fff',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                                borderRadius: 1,
                                fontFamily: 'Arial, sans-serif',
                                border: '1px solid',
                                borderColor: 'divider',
                                '@media print': {
                                  p: '8mm 12mm',
                                  boxShadow: 'none',
                                  border: 'none',
                                  maxWidth: '100%',
                                  mx: 0,
                                  pageBreakInside: 'avoid',
                                  breakInside: 'avoid'
                                }
                              }}
                            >
                              {/* Document Header */}
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2.5, pb: 2, borderBottom: '2px solid #1e293b' }}>
                                <Box>
                                  <Typography fontWeight={900} sx={{ fontSize: '1.5rem', color: '#1e293b' }}>
                                    {billCompanyName}
                                  </Typography>
                                  <Typography fontWeight={800} color="primary" sx={{ fontSize: '1.15rem', textTransform: 'uppercase', mt: 0.5 }}>
                                    VENDOR BILL INVOICE
                                  </Typography>
                                </Box>
                                <Box sx={{ textAlign: 'right' }}>
                                  <Typography variant="h6" fontWeight={800} color="primary.main">
                                    {b.billNumber}
                                  </Typography>
                                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                                    <strong>Date:</strong> {formatDateForPrint(b.billDate)}
                                  </Typography>
                                  <Box sx={{ mt: 0.5 }}>
                                    <Chip
                                      label={b.status?.toUpperCase() || 'DRAFT'}
                                      size="small"
                                      color={billStatusColorMap[b.status] || 'default'}
                                      sx={{ fontWeight: 700 }}
                                    />
                                  </Box>
                                </Box>
                              </Box>

                              {/* Body */}
                              <CentralizedStoreBillInvoiceBody
                                bill={normalizedBillData}
                                showChargesSummary={true}
                              />

                              {/* Finance Document Approval Authority Table */}
                              <Box sx={{ mt: 2.5, '@media print': { mt: 2, pageBreakInside: 'avoid', breakInside: 'avoid' } }}>
                                <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1, color: '#1e293b', '@media print': { fontSize: '11px', mb: 0.5 } }}>
                                  Finance Document Approval Authority
                                </Typography>
                                <Table
                      size="small"
                                  sx={{
                                    border: '1.5px solid #334155',
                                    '& th': {
                                      bgcolor: '#f1f5f9',
                                      fontWeight: 800,
                                      fontSize: 12,
                                      border: '1px solid #cbd5e1',
                                      color: '#0f172a',
                                      py: 0.6,
                                      px: 1,
                                      '@media print': { py: 0.4, px: 0.8, fontSize: '10px' }
                                    },
                                    '& td': {
                                      fontSize: 12,
                                      border: '1px solid #cbd5e1',
                                      py: 0.6,
                                      px: 1,
                                      verticalAlign: 'middle',
                                      '@media print': { py: 0.4, px: 0.8, fontSize: '10px' }
                                    }
                                  }}
                                >
                                  <TableHead>
                                    <TableRow>
                                      <TableCell sx={{ width: '25%' }}>Authority</TableCell>
                                      <TableCell sx={{ width: '25%' }}>Name</TableCell>
                                      <TableCell sx={{ width: '25%' }} align="center">Digital Signature</TableCell>
                                      <TableCell sx={{ width: '25%' }}>Date &amp; Time</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {getApprovalRows().map((row) => (
                                      <TableRow key={row.authority}>
                                        <TableCell sx={{ fontWeight: 800 }}>{row.authority}</TableCell>
                                        <TableCell>{row.name || '-'}</TableCell>
                                        <TableCell align="center">
                                          {getSignatureSource(row) ? (
                                            <Box sx={{ maxHeight: 28, display: 'flex', justifyContent: 'center', alignItems: 'center', '& img': { maxHeight: 28, width: 'auto', objectFit: 'contain' } }}>
                                              <DigitalSignatureImage userOrPath={getSignatureSource(row)} alt={`${row.authority} signature`} />
                                            </Box>
                                          ) : (
                                            '-'
                                          )}
                                        </TableCell>
                                        <TableCell>{row.dateTime || '-'}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </Box>
                            </Paper>
                          </Box>
                        );
                      })}
                    </Stack>
                  )}
                </Box>
              )}

              {/* ----------------- SECTION 7: ATTACHED DOCUMENTS ----------------- */}
              {(multiPrintMode ? printSelection.attachments && viewDialog.poLinkedDocs?.length > 0 : viewDialog.poAuditTab === 7) && (
                <Box sx={{ p: 2, pageBreakBefore: multiPrintMode ? 'always' : 'auto' }}>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
                    Attached Documents ({viewDialog.poLinkedDocs?.length || 0})
                  </Typography>
                  {(!viewDialog.poLinkedDocs || viewDialog.poLinkedDocs.length === 0) ? (
                    <Typography color="text.secondary">No attached documents found.</Typography>
                  ) : (
                    <>
                      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>#</TableCell>
                              <TableCell>Source</TableCell>
                              <TableCell>Document</TableCell>
                              <TableCell>Date</TableCell>
                              <TableCell align="right" className="no-print">Action</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {viewDialog.poLinkedDocs.map((doc, idx) => (
                              <TableRow key={doc.id || idx}>
                                <TableCell>{idx + 1}</TableCell>
                                <TableCell>{doc.source || 'Attachment'}</TableCell>
                                <TableCell>{doc.name || 'Document'}</TableCell>
                                <TableCell>{doc.uploadedAt ? formatDateForPrint(doc.uploadedAt) : '—'}</TableCell>
                                <TableCell align="right" className="no-print">
                                  {doc.url ? (
                                    <Button size="small" variant="outlined" onClick={() => window.open(doc.url, '_blank', 'noopener,noreferrer')}>
                                      Open in New Tab
                                    </Button>
                                  ) : '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>

                      {/* Render full preview of attachments for viewing and printing */}
                      {viewDialog.poLinkedDocs.map((doc, idx) => {
                        if (!doc.url) return null;
                        const cleanUrl = doc.url.toLowerCase();
                        const isImg = cleanUrl.match(/\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i) || doc.mimeType?.startsWith('image/') || (!cleanUrl.match(/\.pdf(\?.*)?$/i) && !doc.mimeType?.includes('pdf'));
                        
                        return (
                          <Box key={`img-attach-${doc.id || idx}`} sx={{ my: 3, pageBreakInside: 'avoid' }}>
                            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary' }}>
                              Attachment #{idx + 1}: {doc.name || 'Document'} ({doc.source || 'Attachment'})
                            </Typography>
                            {isImg ? (
                              <Box
                                component="img"
                                src={doc.url}
                                alt={doc.name || 'Attached Document'}
                                sx={{
                                  maxWidth: '100%',
                                  maxHeight: '900px',
                                  objectFit: 'contain',
                                  border: '1px solid #ddd',
                                  borderRadius: 1,
                                  display: 'block',
                                  mx: 'auto'
                                }}
                              />
                            ) : (
                              <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', bgcolor: 'grey.50' }}>
                                <Typography variant="subtitle1" fontWeight={600} color="primary" sx={{ mb: 1 }}>
                                  📄 {doc.name || 'PDF Document Attachment'}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                  Source: {doc.source || 'Attachment'}
                                </Typography>
          <Button
            variant="outlined"
                                  size="small"
                                  className="no-print"
                                  onClick={() => window.open(doc.url, '_blank', 'noopener,noreferrer')}
                                >
                                  Open / Download Attachment
          </Button>
                              </Paper>
                            )}
                          </Box>
                        );
                      })}
                    </>
                  )}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* Select Documents to Print Dialog */}
      <Dialog
        open={printSelectDialogOpen}
        onClose={() => setPrintSelectDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ChecklistIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>Select Documents to Print</Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose which documents from this voucher package to include in the single print job:
          </Typography>
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={printSelection.voucher}
                  onChange={(e) => setPrintSelection((prev) => ({ ...prev, voucher: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {viewDialog.billVoucher ? `Bill Voucher (${viewDialog.billVoucher.entryNumber || 'Voucher Type: BILL'})` : 'Voucher (General Ledger & Lines)'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {viewDialog.billVoucher ? 'Bill creation voucher entries & lines (Voucher Type: BILL)' : 'Voucher summary, accounting entries & authorities'}
                  </Typography>
                </Box>
              }
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={printSelection.indent}
                  disabled={!viewDialog.po?.indent}
                  onChange={(e) => setPrintSelection((prev) => ({ ...prev, indent: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>Indent (Purchase Request Form)</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {viewDialog.po?.indent ? `PR #${viewDialog.po.indent.indentNumber || ''}` : 'No indent linked'}
                  </Typography>
                </Box>
              }
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={printSelection.po}
                  disabled={!viewDialog.po}
                  onChange={(e) => setPrintSelection((prev) => ({ ...prev, po: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>Purchase Order (PO)</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {viewDialog.po ? `PO #${viewDialog.po.orderNumber || ''}` : 'No PO linked'}
                  </Typography>
                </Box>
              }
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={printSelection.bills}
                  disabled={!viewDialog.poBills || viewDialog.poBills.length === 0}
                  onChange={(e) => setPrintSelection((prev) => ({ ...prev, bills: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>Vendor Bills ({viewDialog.poBills?.length || 0})</Typography>
                  <Typography variant="caption" color="text.secondary">Attached vendor bills &amp; line invoices</Typography>
                </Box>
              }
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={printSelection.comparative}
                  disabled={!viewDialog.poQuotations?.length && !viewDialog.po?.indent?.comparativeApproval}
                  onChange={(e) => setPrintSelection((prev) => ({ ...prev, comparative: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>Comparative Statement</Typography>
                  <Typography variant="caption" color="text.secondary">Vendor rate comparison &amp; committee approvals</Typography>
                </Box>
              }
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={printSelection.quotations}
                  disabled={!viewDialog.poQuotations || viewDialog.poQuotations.length === 0}
                  onChange={(e) => setPrintSelection((prev) => ({ ...prev, quotations: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>Quotations ({viewDialog.poQuotations?.length || 0})</Typography>
                  <Typography variant="caption" color="text.secondary">Official vendor quotation sheets</Typography>
                </Box>
              }
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={printSelection.grns}
                  disabled={!viewDialog.poGrns || viewDialog.poGrns.length === 0}
                  onChange={(e) => setPrintSelection((prev) => ({ ...prev, grns: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>GRN(s) ({viewDialog.poGrns?.length || 0})</Typography>
                  <Typography variant="caption" color="text.secondary">Goods Receipt Notes for delivered items</Typography>
                </Box>
              }
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={printSelection.attachments}
                  disabled={!viewDialog.poLinkedDocs || viewDialog.poLinkedDocs.length === 0}
                  onChange={(e) => setPrintSelection((prev) => ({ ...prev, attachments: e.target.checked }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>Attached Documents ({viewDialog.poLinkedDocs?.length || 0})</Typography>
                  <Typography variant="caption" color="text.secondary">All attached receipts, bills, approval files &amp; image documents</Typography>
                </Box>
              }
            />
          </FormGroup>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          <Button onClick={() => setPrintSelectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            onClick={handleExecuteCustomPrint}
            disabled={!Object.values(printSelection).some(Boolean)}
          >
            Print Selected
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Vouchers;
