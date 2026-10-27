import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  CircularProgress,
  Tooltip,
  IconButton,
  Divider,
  DialogActions,
  Checkbox,
  FormControlLabel
} from '@mui/material';
import PaymentsIcon from '@mui/icons-material/Payments';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import PrintIcon from '@mui/icons-material/Print';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CopyIcon from '@mui/icons-material/ContentCopy';
import WarningIcon from '@mui/icons-material/Warning';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Stack from '@mui/material/Stack';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../services/api';
import FinanceCompanySelector from '../../components/Finance/FinanceCompanySelector';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import AddAccountDialog from '../../components/Finance/AddAccountDialog';
import { formatPKR } from '../../utils/currency';
import { fetchPayFromAccounts, formatPayFromAccountLabel } from '../../utils/payFromAccounts';
import ComparativeStatementView from '../../components/Procurement/ComparativeStatementView';
import QuotationDetailView from '../../components/Procurement/QuotationDetailView';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import { WorkflowAuditFeedbackPanel } from '../../components/Admin/workflowAuditReturn';
import { formatDateTime } from '../../utils/dateUtils';
import { numberToWords } from '../../utils/numberToWords';
import { formatPurchaseOrderCostCenter } from '../../utils/purchaseOrderAuthority';
import StoreVettingNotice from '../../components/Procurement/StoreVettingNotice';
import toast from 'react-hot-toast';

const emptyCategoryLine = () => ({
  id: Date.now() + Math.random(),
  account: null,
  description: '',
  amount: '',
  project: ''
});

const formatDateForPrint = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Issuance column: “Advance issued” only after the linked voucher’s signed document is recorded. */
function getVoucherIssuanceChip(a) {
  const wf = a.voucherWorkflowStatus || 'immediate';
  if (wf === 'pending_authority') return { label: 'Pending Signatures', color: 'warning' };
  if (wf === 'rejected') return { label: 'Rejected', color: 'error' };
  const signedOk = a.voucherSignedDocumentStatus === 'signed' && Boolean(a.voucherSignedDocumentAt);
  if (signedOk) return { label: 'Advance Issued', color: 'success' };
  if (wf === 'fully_approved' || wf === 'immediate') {
    return { label: 'Posted — Sign Voucher', color: 'info' };
  }
  return { label: 'Posted', color: 'success' };
}

/**
 * `embedPrefill` (Vendor Payments hub): { companyId, vendorId, vendorName, po: { _id, orderNumber, totalAmount } } —
 * selects the company, vendor and PO (with its remaining advance) on open. `onEmbedSubmitted` runs after an advance is
 * recorded. Without the props the page works as before.
 */
const VendorAdvance = ({ embedPrefill = null, onEmbedSubmitted = null } = {}) => {
  const [vendors, setVendors] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingPos, setLoadingPos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [selectedPo, setSelectedPo] = useState(null);
  const [loadingAdvances, setLoadingAdvances] = useState(false);
  const [advances, setAdvances] = useState([]);
  const [advancesPage, setAdvancesPage] = useState(0);
  const [advancesRowsPerPage, setAdvancesRowsPerPage] = useState(250);
  const [advancesTotalCount, setAdvancesTotalCount] = useState(0);
  const [poQueue, setPoQueue] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queuePage, setQueuePage] = useState(0);
  const [queueRowsPerPage, setQueueRowsPerPage] = useState(250);
  const [queueTotalCount, setQueueTotalCount] = useState(0);
  const [queuePrefillPoId, setQueuePrefillPoId] = useState(null);
  const [queuePrefillSnapshot, setQueuePrefillSnapshot] = useState(null);

  // Category details (Expense & Chart of Accounts categories)
  const [categoryLines, setCategoryLines] = useState([emptyCategoryLine(), emptyCategoryLine()]);
  const [pageTab, setPageTab] = useState('new');
  const [vendorOpenAdvance, setVendorOpenAdvance] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [projectsList, setProjectsList] = useState([]);

  // Quick Add COA Account Dialog
  const [newAccountDialog, setNewAccountDialog] = useState(false);
  const [newAccountRowIndex, setNewAccountRowIndex] = useState(null);

  // Quick Add Vendor Dialog
  const [openAddVendor, setOpenAddVendor] = useState(false);
  const [newVendorForm, setNewVendorForm] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    paymentTerms: 'Cash',
    vendorCategory: '',
    notes: ''
  });
  const [creatingVendor, setCreatingVendor] = useState(false);

  const [form, setForm] = useState({
    amount: '',
    paymentMethod: 'bank_transfer',
    bankAccountId: '',
    chequeNumber: '',
    reference: '',
    paymentDate: new Date().toISOString().split('T')[0],
    costCenter: ''
  });
  const [costCenters, setCostCenters] = useState([]);
  const [finAuth, setFinAuth] = useState({
    accountsManagerUser: null,
    financeControllerUser: null
  });
  const [approverPool, setApproverPool] = useState([]);
  // PO balance check: earlier advances (any voucher stage) reduce what can still be paid on this PO
  const [poPendingVoucher, setPoPendingVoucher] = useState({ loading: false, hasPending: false, poTotal: 0, alreadyRecorded: 0, remaining: null });
  const [bankAccounts, setBankAccounts] = useState([]);
  const advanceHistorySectionRef = useRef(null);
  const [highlightPoId, setHighlightPoId] = useState(null);
  const [ensuringVoucherId, setEnsuringVoucherId] = useState(null);
  const [removingAdvanceId, setRemovingAdvanceId] = useState(null);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const { selectedCompanyId, companies, setSelectedCompanyId } = useFinanceCompany();
  const [payingCompanyId, setPayingCompanyId] = useState('');

  const isRealCompanyId = useCallback((id) => {
    if (!id || String(id).toLowerCase() === 'all') return false;
    return /^[a-f\d]{24}$/i.test(String(id));
  }, []);

  const poCompanyId = useMemo(() => {
    const raw = selectedPo?.companyId?._id || selectedPo?.companyId || selectedPo?.company?._id || null;
    return isRealCompanyId(raw) ? String(raw) : null;
  }, [selectedPo, isRealCompanyId]);

  /** PO / advance owning company (must be a real PlacementCompany, never "all"). */
  const originalCompanyId = useMemo(() => {
    if (isRealCompanyId(selectedCompanyId)) return String(selectedCompanyId);
    if (poCompanyId) return poCompanyId;
    return null;
  }, [selectedCompanyId, poCompanyId, isRealCompanyId]);

  /** Company that pays the bank — defaults to original when not overridden. */
  const effectivePayingCompanyId = useMemo(() => {
    if (isRealCompanyId(payingCompanyId)) return String(payingCompanyId);
    return originalCompanyId;
  }, [payingCompanyId, originalCompanyId, isRealCompanyId]);

  const isIntercompanyAdvance = Boolean(
    originalCompanyId
    && effectivePayingCompanyId
    && String(originalCompanyId) !== String(effectivePayingCompanyId)
  );

  const originalCompanyName = useMemo(
    () => companies.find((c) => String(c._id) === String(originalCompanyId))?.name || 'Original company',
    [companies, originalCompanyId]
  );
  const payingCompanyName = useMemo(
    () => companies.find((c) => String(c._id) === String(effectivePayingCompanyId))?.name || 'Paying company',
    [companies, effectivePayingCompanyId]
  );

  /** @deprecated alias — kept for ensure-voucher / block checks on original company */
  const postingCompanyId = originalCompanyId;

  const companyBlockedForPayment = !originalCompanyId;

  const [viewDialog, setViewDialog] = useState({
    open: false,
    po: null,
    poQuotations: [],
    poGrns: [],
    poLinkedDocs: [],
    poAuditTab: 0,
    loading: false
  });

  const [returnDialog, setReturnDialog] = useState({ open: false, po: null });
  const [returnComments, setReturnComments] = useState('');
  const [returnSignature, setReturnSignature] = useState('');
  const [returnAgree, setReturnAgree] = useState(false);
  const [returnObservations, setReturnObservations] = useState([{ observation: '', severity: 'medium' }]);
  const [actionLoading, setActionLoading] = useState(false);

  const addObservation = () => {
    setReturnObservations((prev) => [...prev, { observation: '', severity: 'medium' }]);
  };

  const removeObservation = (index) => {
    setReturnObservations((prev) => prev.filter((_, i) => i !== index));
  };

  const updateObservation = (index, field, value) => {
    setReturnObservations((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleFinanceReturnPO = async () => {
    if (!returnAgree || !returnComments.trim()) {
      toast.error('Please provide return comments and agree to terms');
      return;
    }

    const obs = returnObservations
      .filter((o) => o.observation.trim())
      .map((o) => ({ observation: o.observation, severity: o.severity }));

    try {
      setActionLoading(true);
      await api.put(`/procurement/purchase-orders/${returnDialog.po._id}/finance-return`, {
        returnComments,
        digitalSignature: returnSignature || undefined,
        observations: obs.length > 0 ? obs : undefined
      });
      toast.success('Purchase Order returned to Procurement with observations');
      setReturnDialog({ open: false, po: null });
      setReturnComments('');
      setReturnSignature('');
      setReturnAgree(false);
      setReturnObservations([{ observation: '', severity: 'medium' }]);
      if (viewDialog.open && viewDialog.po?._id === returnDialog.po._id) {
        setViewDialog((prev) => ({ ...prev, open: false, po: null }));
      }
      loadPoQueue();
      if (selectedVendor?._id) {
        loadPosForVendor(selectedVendor._id);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to return purchase order');
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewPoDetails = async (poRow) => {
    setViewDialog({
      open: true,
      po: poRow,
      poQuotations: [],
      poGrns: [],
      poLinkedDocs: [],
      poAuditTab: 0,
      loading: true
    });

    try {
      const r = await api.get(`/procurement/purchase-orders/${poRow._id}`);
      const d = r.data?.data || poRow;

      const [qRes, grnRes] = await Promise.all([
        d?.indent?._id
          ? api.get(`/procurement/quotations/by-indent/${d.indent._id}`).catch(() => ({ data: { data: [] } }))
          : Promise.resolve({ data: { data: [] } }),
        api.get('/procurement/goods-receive', { params: { purchaseOrder: d._id, limit: 100 } }).catch(() => ({ data: { data: { receives: [] } } }))
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

      pushDocs(d?.attachments, 'PO Attachment');
      pushDocs(d?.indent?.attachments, 'Indent Attachment');
      poQuotations.forEach((q) => pushDocs(q?.attachments, `Quotation ${q?.quotationNumber || ''}`.trim()));

      setViewDialog({
        open: true,
        po: d,
        poQuotations,
        poGrns,
        poLinkedDocs,
        poAuditTab: 0,
        loading: false
      });
    } catch (e) {
      console.error('Error loading PO details:', e);
      setViewDialog((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    setSelectedVendor(null);
    setSelectedPo(null);
    setQueuePrefillPoId(null);
    setQueuePrefillSnapshot(null);
  }, [selectedCompanyId]);

  const loadVendors = useCallback(async () => {
    setLoadingVendors(true);
    try {
      const res = await api.get('/procurement/vendors', { params: { limit: 500 } });
      const list = res.data?.data?.vendors || res.data?.data || [];
      setVendors(Array.isArray(list) ? list : []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not load vendors');
      setVendors([]);
    } finally {
      setLoadingVendors(false);
    }
  }, []);

  const loadPosForVendor = useCallback(async (vendorId) => {
    if (!vendorId) {
      setPurchaseOrders([]);
      setSelectedPo(null);
      return;
    }
    setPurchaseOrders([]);
    setLoadingPos(true);
    try {
      const res = await api.get('/procurement/purchase-orders', {
        params: { vendor: vendorId, limit: 100, page: 1 }
      });
      const list = res.data?.data?.purchaseOrders || [];
      setPurchaseOrders(Array.isArray(list) ? list : []);
    } catch (e) {
      setPurchaseOrders([]);
      if (e.response?.status === 403) {
        toast.error('No permission to list purchase orders for this vendor (link PO in procurement or skip).');
      }
    } finally {
      setLoadingPos(false);
    }
  }, []);

  // Same cost center list as bill payments
  useEffect(() => {
    let cancelled = false;
    api.get('/finance/cost-centers')
      .then((res) => { if (!cancelled && res.data?.success) setCostCenters(res.data.data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    const targetComp = effectivePayingCompanyId || originalCompanyId;
    fetchPayFromAccounts(api, { companyId: targetComp })
      .then((accs) => {
        setBankAccounts(accs);
        if (form.bankAccountId && !accs.some((a) => String((a.account || a)._id) === String(form.bankAccountId))) {
          setForm((f) => ({ ...f, bankAccountId: '' }));
        }
      })
      .catch(() => setBankAccounts([]));
  }, [effectivePayingCompanyId, originalCompanyId]);

  // Load COA Accounts & Projects
  useEffect(() => {
    let cancelled = false;
    const fetchMaster = async () => {
      try {
        const [accRes, hrProjRes, pmProjRes] = await Promise.all([
          api.get('/finance/accounts', {
            params: { limit: 5000, ...(selectedCompanyId ? { companyId: selectedCompanyId } : { allCompanies: 'true' }) }
          }).catch(() => ({ data: { data: [] } })),
          api.get('/hr/projects', { params: { limit: 1000 } }).catch(() => ({ data: { data: [] } })),
          api.get('/project-management/projects', { params: { limit: 1000 } }).catch(() => ({ data: { data: { projects: [] } } }))
        ]);

        const aList = accRes.data?.data?.accounts || accRes.data?.accounts || accRes.data?.data || [];
        if (!cancelled) setAccounts(Array.isArray(aList) ? aList : []);

        const hrList = Array.isArray(hrProjRes.data?.data) ? hrProjRes.data.data : [];
        const pmList = Array.isArray(pmProjRes.data?.data?.projects) ? pmProjRes.data.data.projects : (Array.isArray(pmProjRes.data?.data) ? pmProjRes.data.data : []);
        const combinedProjects = [...hrList, ...pmList].filter((p) => p && typeof p === 'object');
        const uniqueProjects = Array.from(new Map(combinedProjects.map((p) => [p.name || p.title || p._id, p])).values())
          .filter((p) => p && (p.name || p.title));
        if (!cancelled) setProjectsList(uniqueProjects);
      } catch (err) {
        console.error('Failed to load accounts/projects for vendor advance', err);
      }
    };
    fetchMaster();
    return () => { cancelled = true; };
  }, [selectedCompanyId]);

  const expenseAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      if (a.type === 'Expense' && b.type !== 'Expense') return -1;
      if (b.type === 'Expense' && a.type !== 'Expense') return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [accounts]);

  // Category Line Operations
  const handleCategoryLineChange = (index, field, value) => {
    setCategoryLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addCategoryLine = () => {
    setCategoryLines((prev) => [...prev, emptyCategoryLine()]);
  };

  const removeCategoryLine = (index) => {
    setCategoryLines((prev) => {
      if (prev.length <= 1) return [emptyCategoryLine()];
      return prev.filter((_, i) => i !== index);
    });
  };

  const duplicateCategoryLine = (index) => {
    setCategoryLines((prev) => {
      const lineToCopy = prev[index];
      const next = [...prev];
      next.splice(index + 1, 0, { ...lineToCopy, id: Date.now() + Math.random() });
      return next;
    });
  };

  const clearAllCategoryLines = () => {
    setCategoryLines([emptyCategoryLine(), emptyCategoryLine()]);
  };

  const categoryTotal = useMemo(() => {
    return categoryLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  }, [categoryLines]);

  const recordAdvanceDisabledReason = useMemo(() => {
    if (submitting) return 'Submitting…';
    if (companyBlockedForPayment) {
      return 'Select the PO company in the company filter (top right), or link a PO that has a company. All Companies cannot create vouchers.';
    }
    if (selectedPo?._id && poPendingVoucher.remaining != null && poPendingVoucher.poTotal > 0) {
      if (poPendingVoucher.remaining <= 0.009) {
        return 'This PO is already fully covered by vendor advances.';
      }
      if (categoryTotal > poPendingVoucher.remaining + 0.009) {
        return `Amount is more than the remaining balance on this PO (${formatPKR(poPendingVoucher.remaining)}).`;
      }
    }
    if (!finAuth.accountsManagerUser || !finAuth.financeControllerUser) {
      return 'Select Sr Manager Accounts and GM Finance.';
    }
    if (bankAccounts.length === 0) {
      return `No pay-from accounts found for ${payingCompanyName}. Pick Paying company / company with bank accounts.`;
    }
    if (!form.bankAccountId) {
      return 'Select Pay from account.';
    }
    if (categoryTotal <= 0) {
      return 'Enter at least one Category details line with amount > 0.';
    }
    return '';
  }, [
    submitting,
    companyBlockedForPayment,
    selectedPo?._id,
    poPendingVoucher.remaining,
    poPendingVoucher.poTotal,
    categoryTotal,
    finAuth.accountsManagerUser,
    finAuth.financeControllerUser,
    bankAccounts.length,
    payingCompanyName,
    form.bankAccountId,
    categoryTotal
  ]);

  const recordAdvanceDisabled = Boolean(recordAdvanceDisabledReason);

  const handleOpenAddAccount = (idx) => {
    setNewAccountRowIndex(idx);
    setNewAccountDialog(true);
  };

  const handleSaveNewAccount = (newAcc) => {
    setAccounts((prev) => [...prev, newAcc]);
    if (newAccountRowIndex !== null) {
      handleCategoryLineChange(newAccountRowIndex, 'account', newAcc);
    }
    setNewAccountDialog(false);
    toast.success('Account created and selected');
  };

  const handleSaveNewVendor = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newVendorForm.name.trim()) {
      toast.error('Vendor name is required');
      return;
    }
    try {
      setCreatingVendor(true);
      const res = await api.post('/procurement/vendors/quick', newVendorForm);
      if (res.data.success) {
        const createdVendor = res.data.data;
        toast.success(`Vendor "${createdVendor.name}" created successfully!`);
        // Update local vendors list
        setVendors((prev) => [createdVendor, ...prev]);
        // Set as currently selected vendor
        setSelectedVendor(createdVendor);

        // Reset and close
        setNewVendorForm({
          name: '',
          contactPerson: '',
          phone: '',
          email: '',
          address: '',
          paymentTerms: 'Cash',
          vendorCategory: '',
          notes: ''
        });
        setOpenAddVendor(false);
      }
    } catch (err) {
      console.error('Error quick creating vendor:', err);
      toast.error(err.response?.data?.message || 'Failed to create vendor');
    } finally {
      setCreatingVendor(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/indents/approver-candidates', { params: { search: '', limit: 100 } });
        const list = Array.isArray(res.data?.data) ? res.data.data : [];
        if (!cancelled) setApproverPool(list);
      } catch {
        if (!cancelled) setApproverPool([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadPoQueue = useCallback(async (page = queuePage, rowsPerPage = queueRowsPerPage) => {
    setLoadingQueue(true);
    try {
      const res = await api.get('/finance/accounts-payable/vendor-advance-po-queue', {
        params: {
          companyId: selectedCompanyId,
          page: page + 1,
          limit: rowsPerPage
        }
      });
      const items = res.data?.data?.items || [];
      const pagination = res.data?.data?.pagination || {};
      setPoQueue(Array.isArray(items) ? items : []);
      setQueueTotalCount(Number(pagination.totalCount) || 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not load PO advance queue');
      setPoQueue([]);
      setQueueTotalCount(0);
    } finally {
      setLoadingQueue(false);
    }
  }, [selectedCompanyId, queuePage, queueRowsPerPage]);

  useEffect(() => {
    setQueuePage(0);
  }, [selectedCompanyId]);

  useEffect(() => {
    loadPoQueue(queuePage, queueRowsPerPage);
  }, [queuePage, queueRowsPerPage, loadPoQueue]);

  const vendorOptions = useMemo(() => {
    if (!selectedVendor?._id) return vendors;
    const has = vendors.some((v) => String(v._id) === String(selectedVendor._id));
    if (has) return vendors;
    return [selectedVendor, ...vendors];
  }, [vendors, selectedVendor]);

  useEffect(() => {
    if (!queuePrefillPoId || !selectedVendor?._id) return;
    if (loadingPos) return;
    const po = purchaseOrders.find((p) => String(p._id) === String(queuePrefillPoId));
    if (po) {
      setSelectedPo(po);
      setQueuePrefillPoId(null);
      setQueuePrefillSnapshot(null);
      return;
    }
    if (purchaseOrders.length >= 0 && queuePrefillSnapshot && String(queuePrefillSnapshot._id) === String(queuePrefillPoId)) {
      setSelectedPo({
        _id: queuePrefillSnapshot._id,
        orderNumber: queuePrefillSnapshot.orderNumber,
        totalAmount: queuePrefillSnapshot.totalAmount
      });
      setQueuePrefillPoId(null);
      setQueuePrefillSnapshot(null);
    }
  }, [queuePrefillPoId, purchaseOrders, loadingPos, selectedVendor, queuePrefillSnapshot]);

  useEffect(() => {
    if (selectedVendor?._id) {
      loadPosForVendor(selectedVendor._id);
    } else {
      setPurchaseOrders([]);
      setSelectedPo(null);
    }
  }, [selectedVendor, loadPosForVendor]);

  const loadAdvancesForVendor = useCallback(async (vendorId, page = advancesPage, rowsPerPage = advancesRowsPerPage) => {
    setLoadingAdvances(true);
    try {
      const params = {
        limit: rowsPerPage,
        page: page + 1,
        companyId: selectedCompanyId
      };
      if (vendorId) params.vendorId = vendorId;
      const res = await api.get('/finance/accounts-payable/vendor-advances', { params });
      const list = res.data?.data?.advances || [];
      const pagination = res.data?.data?.pagination || {};
      setAdvances(Array.isArray(list) ? list : []);
      setAdvancesTotalCount(Number(pagination.totalCount) || 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load vendor advances');
      setAdvances([]);
      setAdvancesTotalCount(0);
    } finally {
      setLoadingAdvances(false);
    }
  }, [selectedCompanyId, advancesPage, advancesRowsPerPage]);

  useEffect(() => {
    setAdvancesPage(0);
  }, [selectedVendor?._id, selectedCompanyId]);

  useEffect(() => {
    loadAdvancesForVendor(selectedVendor?._id || null, advancesPage, advancesRowsPerPage);
  }, [selectedVendor?._id, advancesPage, advancesRowsPerPage, loadAdvancesForVendor]);

  useEffect(() => {
    let cancelled = false;
    const poId = selectedPo?._id;
    const empty = { loading: false, hasPending: false, poTotal: 0, alreadyRecorded: 0, remaining: null };
    if (!poId) {
      setPoPendingVoucher(empty);
      return undefined;
    }
    (async () => {
      setPoPendingVoucher((p) => ({ ...p, loading: true }));
      try {
        const res = await api.get(`/finance/vendor-advances/po/${poId}/pending-voucher`);
        const d = res.data?.data || {};
        if (!cancelled) {
          setPoPendingVoucher({
            loading: false,
            hasPending: Boolean(d.hasPending),
            poTotal: Number(d.poTotal) || 0,
            alreadyRecorded: Number(d.alreadyRecorded) || 0,
            remaining: d.remaining == null ? null : Number(d.remaining)
          });
        }
      } catch {
        if (!cancelled) setPoPendingVoucher(empty);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPo?._id]);

  useEffect(() => {
    if (!highlightPoId || loadingAdvances) return;
    const rowElId = `vendor-advance-row-po-${highlightPoId}`;
    requestAnimationFrame(() => {
      advanceHistorySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const rowEl = document.getElementById(rowElId);
      if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [highlightPoId, advances, loadingAdvances]);

  // Unused advances already with the chosen vendor (shown under the payee, like QuickBooks' open balance)
  useEffect(() => {
    setVendorOpenAdvance(null);
    if (!selectedVendor?._id) return;
    api.get('/finance/accounts-payable/vendor-advance-balance', { params: { vendorId: selectedVendor._id } })
      .then((res) => setVendorOpenAdvance(Number(res.data?.data?.totalOpen) || 0))
      .catch(() => setVendorOpenAdvance(null));
  }, [selectedVendor?._id]);

  const resetAdvanceForm = () => {
    setForm({
      amount: '',
      paymentMethod: 'bank_transfer',
      bankAccountId: '',
      chequeNumber: '',
      reference: '',
      paymentDate: new Date().toISOString().split('T')[0],
      costCenter: ''
    });
    setCategoryLines([emptyCategoryLine(), emptyCategoryLine()]);
    setSelectedPo(null);
    setFinAuth({ accountsManagerUser: null, financeControllerUser: null });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVendor) {
      toast.error('Select a vendor');
      return;
    }
    if (!categoryTotal || categoryTotal <= 0) {
      toast.error('Please enter at least one category line with a positive amount in Category details');
      return;
    }

    const filledWithoutAccount = categoryLines.find((l) => Number(l.amount) > 0 && !l.account);
    if (filledWithoutAccount) {
      toast.error('Please select a Chart of Accounts category for all filled lines');
      return;
    }

    if (!finAuth.accountsManagerUser || !finAuth.financeControllerUser) {
      toast.error('Select Sr Manager Accounts and GM Finance (required for every vendor advance).');
      return;
    }
    if (!form.bankAccountId) {
      toast.error('Select the account the payment is made from (pay from account).');
      return;
    }
    if (!originalCompanyId || !isRealCompanyId(originalCompanyId)) {
      toast.error('Select the PO company in the finance company filter (not All Companies). Paying company can differ for intercompany.');
      return;
    }
    if (selectedPo?._id && poPendingVoucher.remaining != null && poPendingVoucher.poTotal > 0
      && categoryTotal > poPendingVoucher.remaining + 0.009) {
      toast.error(`This PO only has ${formatPKR(poPendingVoucher.remaining)} remaining. Reduce the amount.`);
      return;
    }
    const ref = (form.reference || '').trim() || `ADV-${Date.now()}`;
    const paymentDateIso = form.paymentDate
      ? new Date(`${form.paymentDate}T12:00:00`).toISOString()
      : new Date().toISOString();

    const validCategoryLines = categoryLines
      .filter((l) => Number(l.amount) > 0)
      .map((l) => ({
        account: l.account?._id || null,
        accountNumber: l.account?.accountNumber || '',
        description: l.description || l.account?.name || 'Category line item',
        amount: Number(l.amount),
        project: l.project || ''
      }));

    setSubmitting(true);
    try {
      const body = {
        vendorName: selectedVendor.name,
        vendorEmail: selectedVendor.email || '',
        vendorId: selectedVendor._id,
        amount: categoryTotal,
        paymentMethod: form.paymentMethod,
        bankAccountId: form.bankAccountId,
        chequeNumber: (form.chequeNumber || '').trim(),
        reference: ref,
        paymentDate: paymentDateIso,
        referenceType: selectedPo ? 'purchase_order' : 'advance',
        referenceId: selectedPo ? selectedPo._id : null,
        financeApprovalAuthorities: {
          accountsManagerUser: finAuth.accountsManagerUser._id,
          financeControllerUser: finAuth.financeControllerUser._id
        },
        companyId: originalCompanyId,
        payingCompanyId: effectivePayingCompanyId,
        categoryLines: validCategoryLines,
        costCenter: form.costCenter || null
      };
      const res = await api.post('/finance/accounts-payable/advance-payment', body);
      if (res.data?.success) {
        toast.success(res.data.message || 'Vendor advance recorded');
        if (onEmbedSubmitted) onEmbedSubmitted();
        setForm({
          amount: '',
          paymentMethod: 'bank_transfer',
          bankAccountId: '',
          chequeNumber: '',
          reference: '',
          paymentDate: new Date().toISOString().split('T')[0],
          costCenter: ''
        });
        setCategoryLines([emptyCategoryLine(), emptyCategoryLine()]);
        setSelectedPo(null);
        setFinAuth({
          accountsManagerUser: null,
          financeControllerUser: null
        });
        loadPoQueue();
        if (selectedVendor?._id) loadAdvancesForVendor(selectedVendor._id);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record advance');
    } finally {
      setSubmitting(false);
    }
  };

  const preparePaymentFromQueue = (row) => {
    setSelectedPo(null);
    const v = vendors.find((x) => String(x._id) === String(row.vendor?._id));
    const vendorObj = v || {
      _id: row.vendor._id,
      name: row.vendor.name || 'Vendor',
      email: row.vendor.email || ''
    };
    setSelectedVendor(vendorObj);
    setQueuePrefillSnapshot({
      _id: row._id,
      orderNumber: row.orderNumber,
      totalAmount: row.totalAmount
    });
    setQueuePrefillPoId(row._id);
    setCategoryLines([
      {
        ...emptyCategoryLine(),
        amount: String(row.remainingAdvanceDue > 0 ? row.remainingAdvanceDue : '')
      },
      emptyCategoryLine()
    ]);
    setForm((f) => ({
      ...f,
      reference: ''
    }));
    setPageTab('new');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast.success('Vendor and amount filled — select Chart of Accounts category and submit when ready.');
  };

  // Opened from the Vendor Payments hub: company first (changing it clears the form), then vendor / PO
  const embedPrefillDoneRef = useRef(false);
  useEffect(() => {
    if (!embedPrefill || embedPrefillDoneRef.current || loadingVendors) return;
    if (embedPrefill.companyId && String(selectedCompanyId) !== String(embedPrefill.companyId)) {
      setSelectedCompanyId(String(embedPrefill.companyId));
      return;
    }
    embedPrefillDoneRef.current = true;
    const vendor = { _id: embedPrefill.vendorId, name: embedPrefill.vendorName || 'Vendor', email: '' };
    if (embedPrefill.po?._id && embedPrefill.vendorId) {
      api.get(`/finance/vendor-advances/po/${embedPrefill.po._id}/pending-voucher`)
        .then((res) => Number(res.data?.data?.remaining))
        .catch(() => NaN)
        .then((remaining) => preparePaymentFromQueue({
          ...embedPrefill.po,
          vendor,
          remainingAdvanceDue: Number.isFinite(remaining) ? remaining : Number(embedPrefill.po.totalAmount) || 0
        }));
    } else if (embedPrefill.vendorId) {
      setSelectedVendor(vendors.find((v) => String(v._id) === String(embedPrefill.vendorId)) || vendor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedPrefill, loadingVendors, selectedCompanyId]);

  const showRelatedAdvanceInHistory = (row) => {
    const vid = row.vendor?._id;
    if (!vid) return;
    const v = vendors.find((x) => String(x._id) === String(vid));
    const vendorObj = v || {
      _id: vid,
      name: row.vendor?.name || 'Vendor',
      email: row.vendor?.email || ''
    };
    setSelectedVendor(vendorObj);
    setPageTab('history');
    setHighlightPoId(String(row._id));
  };

  const handleEnsureVoucher = async (advanceRow) => {
    if (!originalCompanyId || !isRealCompanyId(originalCompanyId)) {
      toast.error('Select the original company from the list (not All Companies), then click Create voucher again.');
      return;
    }
    setEnsuringVoucherId(advanceRow._id);
    try {
      const res = await api.post(`/finance/vendor-advances/${advanceRow._id}/ensure-voucher`, {
        companyId: originalCompanyId,
        payingCompanyId: effectivePayingCompanyId || originalCompanyId
      });
      toast.success(res.data?.message || 'Voucher created');
      await loadAdvancesForVendor(selectedVendor?._id || null);
      loadPoQueue();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create voucher');
    } finally {
      setEnsuringVoucherId(null);
    }
  };

  const handleRemoveBrokenAdvance = async (advanceRow) => {
    if (!window.confirm('Remove this broken advance (no voucher)? You can record the payment again after this.')) {
      return;
    }
    setRemovingAdvanceId(advanceRow._id);
    try {
      const res = await api.delete(`/finance/vendor-advances/${advanceRow._id}`);
      toast.success(res.data?.message || 'Broken advance removed');
      await loadAdvancesForVendor(selectedVendor?._id || null);
      loadPoQueue();
      if (selectedPo?._id) {
        setPoPendingVoucher({ loading: false, hasPending: false, poTotal: 0, alreadyRecorded: 0, remaining: null });
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to remove broken advance');
    } finally {
      setRemovingAdvanceId(null);
    }
  };

  const handleCleanupOrphans = async () => {
    if (!window.confirm('Remove ALL broken advances that have no voucher? You can re-record those payments afterwards.')) {
      return;
    }
    setCleaningOrphans(true);
    try {
      const res = await api.post('/finance/vendor-advances/cleanup-orphans');
      toast.success(res.data?.message || 'Broken advances cleared');
      await loadAdvancesForVendor(selectedVendor?._id || null);
      loadPoQueue();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to clear broken advances');
    } finally {
      setCleaningOrphans(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'center' }, gap: 2, mb: 1 }}>
        <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PaymentsIcon color="primary" /> Vendor Advance
        </Typography>
        <FinanceCompanySelector minWidth={280} showHelper={false} allowAll={true} />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Pay a supplier before the bill — with or without a PO. Company filter = PO / advance company; Paying company = where cash leaves, if different.
      </Typography>

      {companyBlockedForPayment ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Select the <strong>PO company</strong> in the company filter (top right) before recording a payment.
          <strong> All Companies</strong> is only for viewing — it cannot create payments or vouchers.
          Use <strong>Paying company</strong> only when another company will pay the bank.
        </Alert>
      ) : null}

      <Tabs value={pageTab} onChange={(_, v) => setPageTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="new" label="New advance" sx={{ textTransform: 'none' }} />
        <Tab value="queue" label={`PO advances due${queueTotalCount ? ` (${queueTotalCount})` : ''}`} sx={{ textTransform: 'none' }} />
        <Tab value="history" label="Advance history" sx={{ textTransform: 'none' }} />
      </Tabs>

      {pageTab === 'new' && (
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box component="form" onSubmit={handleSubmit}>
          {/* QuickBooks-style header: payee and pay-from account on the left, the amount large on the right */}
          <Box sx={{ p: 2.5, bgcolor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}>
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} md={4}>
                <Autocomplete
                  loading={loadingVendors}
                  options={vendorOptions}
                  getOptionLabel={(o) => (o?.name ? `${o.name}${o.email ? ` (${o.email})` : ''}` : '')}
                  value={selectedVendor}
                  onChange={(_, v) => setSelectedVendor(v)}
                  PaperComponent={({ children }) => (
                    <Paper>
                      {children}
                      <Divider />
                      <Box sx={{ p: 0.5 }}>
                        <Button
                          fullWidth
                          color="primary"
                          size="small"
                          startIcon={<AddIcon />}
                          sx={{ justifyContent: 'flex-start', py: 0.75 }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setOpenAddVendor(true);
                          }}
                        >
                          Add Vendor
                        </Button>
                      </Box>
                    </Paper>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} label="Vendor *" required placeholder="Search vendor" />
                  )}
                />
                {selectedVendor?._id && vendorOpenAdvance != null ? (
                  <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5 }}>
                    Unused advances with this vendor: <strong>{formatPKR(vendorOpenAdvance)}</strong>
                  </Typography>
                ) : null}
                <Box sx={{ mt: 2 }}>
                  <Autocomplete
                  loading={loadingPos}
                  options={purchaseOrders}
                  disabled={!selectedVendor}
                  getOptionLabel={(po) =>
                    po?.orderNumber ? `${po.orderNumber} — ${formatPKR(po.totalAmount || 0)}` : ''
                  }
                  value={selectedPo}
                  onChange={(_, v) => setSelectedPo(v)}
                  renderInput={(params) => (
                    <TextField {...params} label="Link to PO (optional)" placeholder="Select PO" />
                  )}
                />
                </Box>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small" required disabled={bankAccounts.length === 0}>
                  <InputLabel id="vendor-advance-pay-from-label">
                    Pay from account{isIntercompanyAdvance ? ` (${payingCompanyName})` : ''}
                  </InputLabel>
                  <Select
                    labelId="vendor-advance-pay-from-label"
                    value={form.bankAccountId}
                    label={`Pay from account${isIntercompanyAdvance ? ` (${payingCompanyName})` : ''}`}
                    onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))}
                  >
                    {bankAccounts.map((item) => {
                      const account = item?.account || item;
                      const depth = item?.depth || 0;
                      return (
                        <MenuItem key={account._id} value={account._id}>
                          {formatPayFromAccountLabel(account, depth)}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
                {bankAccounts.length === 0 ? (
                  <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                    No suitable pay-from accounts found for {payingCompanyName}. Add Cash/Bank accounts in that company&apos;s Chart of Accounts.
                  </Typography>
                ) : null}
              </Grid>
              <Grid item xs={12} md={4} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                <Typography variant="overline" color="text.secondary">Amount</Typography>
                <Typography variant="h4" fontWeight={800} color="primary.main">{formatPKR(categoryTotal)}</Typography>
              </Grid>
            </Grid>
          </Box>

          <Box sx={{ p: 2.5 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="Payment date"
                  type="date"
                  value={form.paymentDate}
                  onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Payment method</InputLabel>
                  <Select
                    value={form.paymentMethod}
                    label="Payment method"
                    onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  >
                    <MenuItem value="bank_transfer">Bank transfer</MenuItem>
                    <MenuItem value="cash">Cash</MenuItem>
                    <MenuItem value="check">Cheque</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="Cheque / ref no."
                  value={form.chequeNumber}
                  onChange={(e) => setForm((f) => ({ ...f, chequeNumber: e.target.value }))}
                  placeholder="Unique Cheque / TT / Ref #"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Paying company</InputLabel>
                  <Select
                    value={payingCompanyId}
                    label="Paying company"
                    onChange={(e) => {
                      setPayingCompanyId(e.target.value);
                      setForm((f) => ({ ...f, bankAccountId: '' }));
                    }}
                  >
                    <MenuItem value=""><em>Same as company filter ({originalCompanyName})</em></MenuItem>
                    {companies.map((c) => (
                      <MenuItem key={String(c._id)} value={String(c._id)}>
                        {c.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              {selectedPo?._id && poPendingVoucher.loading ? (
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">Checking this PO for pending voucher approval…</Typography>
                </Grid>
              ) : null}
              {selectedPo?._id && !poPendingVoucher.loading && poPendingVoucher.poTotal > 0 && poPendingVoucher.remaining != null ? (
                <Grid item xs={12}>
                  <Alert
                    severity={poPendingVoucher.remaining <= 0.009 ? 'warning' : 'info'}
                    action={poPendingVoucher.remaining > 0.009 && Math.abs(categoryTotal - poPendingVoucher.remaining) > 0.009 ? (
                      <Button
                        color="inherit"
                        size="small"
                        onClick={() => setCategoryLines((lines) => {
                          const next = lines.length ? [...lines] : [emptyCategoryLine()];
                          next[0] = { ...next[0], amount: String(poPendingVoucher.remaining) };
                          return next.map((l, i) => (i === 0 ? l : { ...l, amount: '' }));
                        })}
                      >
                        Use remaining
                      </Button>
                    ) : null}
                  >
                    PO total <strong>{formatPKR(poPendingVoucher.poTotal)}</strong>
                    {' · '}already recorded <strong>{formatPKR(poPendingVoucher.alreadyRecorded)}</strong>
                    {' · '}remaining <strong>{formatPKR(poPendingVoucher.remaining)}</strong>
                    {poPendingVoucher.remaining <= 0.009 && ' — this PO is fully covered, no more advances can be recorded.'}
                    {poPendingVoucher.hasPending && poPendingVoucher.remaining > 0.009 && ' (an earlier advance is still awaiting voucher signatures — it is already counted above)'}
                  </Alert>
                </Grid>
              ) : null}
              {isIntercompanyAdvance ? (
                <Grid item xs={12}>
                  <Alert severity="info">
                    Intercompany advance: advance stays on <strong>{originalCompanyName}</strong>
                    {' '}(DR selected COA / Vendor Advance, CR Intercompany — {payingCompanyName}).
                    Payment posts on <strong>{payingCompanyName}</strong>
                    {' '}(DR Intercompany — {originalCompanyName}, CR selected bank).
                    Bill settlement later applies against the <strong>{originalCompanyName}</strong> advance.
                  </Alert>
                </Grid>
              ) : null}
            </Grid>

            <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3, mb: 1 }}>
              Category details{' '}
              <Typography component="span" variant="body2" color="text.secondary">
                (Chart of Accounts of {originalCompanyName} — normally Advance to Suppliers)
              </Typography>
            </Typography>
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                    <TableContainer>
                      <Table size="small">
                        <TableHead sx={{ backgroundColor: 'action.hover' }}>
                          <TableRow>
                            <TableCell sx={{ width: 45, fontWeight: 700 }}>#</TableCell>
                            <TableCell sx={{ minWidth: 260, fontWeight: 700 }}>CATEGORY (CHART OF ACCOUNTS)</TableCell>
                            <TableCell sx={{ minWidth: 240, fontWeight: 700 }}>DESCRIPTION</TableCell>
                            <TableCell sx={{ width: 160, fontWeight: 700 }} align="right">AMOUNT (PKR)</TableCell>
                            <TableCell sx={{ minWidth: 180, fontWeight: 700 }}>CUSTOMER / PROJECT</TableCell>
                            <TableCell sx={{ width: 90, fontWeight: 700 }} align="center">ACTIONS</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {categoryLines.map((row, idx) => (
                            <TableRow key={row.id} hover>
                              {/* Line Number */}
                              <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>{idx + 1}</TableCell>

                              {/* Category Dropdown */}
                              <TableCell>
                                <Autocomplete
                                  options={expenseAccounts}
                                  getOptionLabel={(o) => {
                                    if (o?.__isNewOption) return '+ Add new account';
                                    return o?.name ? `${o.name} (${o.accountNumber || ''})` : '';
                                  }}
                                  value={row.account}
                                  onChange={(_, val) => {
                                    if (val?.__isNewOption) {
                                      handleOpenAddAccount(idx);
                                    } else {
                                      handleCategoryLineChange(idx, 'account', val);
                                    }
                                  }}
                                  isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
                                  filterOptions={(opts, state) => {
                                    const filtered = opts.filter((opt) =>
                                      (opt.name || '').toLowerCase().includes(state.inputValue.toLowerCase()) ||
                                      (opt.accountNumber || '').includes(state.inputValue)
                                    );
                                    return [{ __isNewOption: true }, ...filtered];
                                  }}
                                  renderOption={(props, option) => {
                                    if (option.__isNewOption) {
                                      return (
                                        <li {...props} key="add-new" style={{ color: '#1976d2', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>
                                          <AddIcon fontSize="small" sx={{ mr: 1 }} /> + Add new
                                        </li>
                                      );
                                    }
                                    return (
                                      <li {...props} key={option._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>{option.name} <Typography component="span" variant="caption" color="text.secondary">({option.accountNumber})</Typography></span>
                                        <Chip label={option.type || 'Expense'} size="small" variant="outlined" sx={{ height: 20, fontSize: 10, fontStyle: 'italic' }} />
                                      </li>
                                    );
                                  }}
                                  renderInput={(params) => (
                                    <TextField
                                      {...params}
                                      size="small"
                                      placeholder="Select expense category"
                                      fullWidth
                                    />
                                  )}
                                />
                              </TableCell>

                              {/* Description */}
                              <TableCell>
                                <TextField
                                  fullWidth
                                  size="small"
                                  placeholder="Description"
                                  value={row.description}
                                  onChange={(e) => handleCategoryLineChange(idx, 'description', e.target.value)}
                                />
                              </TableCell>

                              {/* Amount */}
                              <TableCell align="right">
                                <TextField
                                  fullWidth
                                  size="small"
                                  type="number"
                                  placeholder="0.00"
                                  value={row.amount}
                                  onChange={(e) => handleCategoryLineChange(idx, 'amount', e.target.value)}
                                  inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }}
                                />
                              </TableCell>

                              {/* Customer / Project */}
                              <TableCell>
                                <Autocomplete
                                  options={projectsList}
                                  getOptionLabel={(p) => (typeof p === 'string' ? p : (p?.name || p?.title || ''))}
                                  value={projectsList.find((p) => (p.name || p.title) === row.project || p._id === row.project) || (row.project ? { name: row.project } : null)}
                                  onChange={(_, val) => handleCategoryLineChange(idx, 'project', typeof val === 'string' ? val : (val?.name || val?.title || ''))}
                                  isOptionEqualToValue={(a, b) => {
                                    const aVal = typeof a === 'string' ? a : (a?.name || a?.title || a?._id || '');
                                    const bVal = typeof b === 'string' ? b : (b?.name || b?.title || b?._id || '');
                                    return aVal === bVal;
                                  }}
                                  renderInput={(params) => (
                                    <TextField
                                      {...params}
                                      size="small"
                                      placeholder="Customer / Project"
                                      fullWidth
                                    />
                                  )}
                                />
                              </TableCell>

                              {/* Actions */}
                              <TableCell align="center">
                                <Stack direction="row" spacing={0.5} justifyContent="center">
                                  <Tooltip title="Duplicate row">
                                    <IconButton size="small" onClick={() => duplicateCategoryLine(idx)}>
                                      <CopyIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="Delete row">
                                    <IconButton size="small" color="error" onClick={() => removeCategoryLine(idx)}>
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </Stack>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>

                    {/* Table Action Buttons & Total Advance Summary */}
                    <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}>
                      <Box sx={{ display: 'flex', gap: 1.5 }}>
                        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={addCategoryLine}>
                          Add lines
                        </Button>
                        <Button variant="text" size="small" color="inherit" onClick={clearAllCategoryLines}>
                          Clear all lines
                        </Button>
                      </Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', fontSize: '1rem' }}>
                        Total: {formatPKR(categoryTotal)}
                      </Typography>
                    </Box>
            </Paper>

            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  label="Memo"
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="Narration / notes or leave blank to auto-generate"
                />
                <Box sx={{ mt: 2 }}>
                  <FormControl fullWidth size="small">
                  <InputLabel id="vendor-advance-cost-center-label">Cost Center (Optional)</InputLabel>
                  <Select
                    labelId="vendor-advance-cost-center-label"
                    value={form.costCenter}
                    label="Cost Center (Optional)"
                    onChange={(e) => setForm((f) => ({ ...f, costCenter: e.target.value }))}
                  >
                    <MenuItem value="">None</MenuItem>
                    {costCenters.filter((cc) => cc.isActive).map((cc) => (
                      <MenuItem key={cc._id} value={cc._id}>
                        {cc.code ? `${cc.code} — ${cc.name}` : cc.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <Box sx={{ ml: { md: 'auto' }, maxWidth: 360, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">Subtotal</Typography>
                    <Typography variant="body2">{formatPKR(categoryTotal)}</Typography>
                  </Stack>
                  <Divider sx={{ my: 1 }} />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="subtitle1" fontWeight={800}>Total advance</Typography>
                    <Typography variant="subtitle1" fontWeight={800}>{formatPKR(categoryTotal)}</Typography>
                  </Stack>
                  {selectedPo?._id && poPendingVoucher.remaining != null && poPendingVoucher.poTotal > 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      PO {selectedPo.orderNumber} still due after this: {formatPKR(Math.max(0, poPendingVoucher.remaining - categoryTotal))}
                    </Typography>
                  ) : null}
                </Box>
              </Grid>
            </Grid>

            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1.5 }}>
              Finance voucher signatures (required)
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  options={approverPool}
                  value={finAuth.accountsManagerUser}
                  onChange={(_, v) => setFinAuth((f) => ({ ...f, accountsManagerUser: v }))}
                  getOptionLabel={(u) => ([u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || '')}
                  renderInput={(params) => <TextField {...params} label="Sr Manager Accounts *" size="small" required />}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  options={approverPool}
                  value={finAuth.financeControllerUser}
                  onChange={(_, v) => setFinAuth((f) => ({ ...f, financeControllerUser: v }))}
                  getOptionLabel={(u) => ([u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || '')}
                  renderInput={(params) => <TextField {...params} label="GM Finance *" size="small" required />}
                />
              </Grid>
            </Grid>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              The advance is applied when you pay this vendor&apos;s bill (Vendor Bills or Vendor Payments → Pay) — any balance is paid then.
            </Typography>
          </Box>

          {/* Save bar */}
          <Box
            sx={{
              position: 'sticky',
              bottom: 0,
              zIndex: 2,
              px: 2.5,
              py: 1.5,
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
              flexWrap: 'wrap'
            }}
          >
            <Button color="inherit" onClick={resetAdvanceForm} disabled={submitting}>Clear</Button>
            <Stack direction="row" alignItems="center" gap={2}>
              {recordAdvanceDisabledReason ? (
                <Typography variant="caption" color="error">{recordAdvanceDisabledReason}</Typography>
              ) : null}
              <Tooltip title={recordAdvanceDisabledReason || ''}>
                <span>
                  <Button type="submit" variant="contained" color="success" disabled={recordAdvanceDisabled} size="large">
                    {submitting ? 'Posting…' : 'Save advance'}
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          </Box>
        </Box>
      </Paper>
      )}

      {pageTab === 'queue' && (
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <AssignmentTurnedInIcon color="warning" fontSize="small" />
          Awaiting vendor advance payment
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Purchase orders in <strong>Pending Finance</strong> with <strong>Full Advance</strong> (or advance) terms that still need an advance posted.
          Use <strong>Prepare payment</strong> to fill the New advance form. If an advance is already in <strong>voucher approval</strong> for that PO, action is disabled until it is completed or rejected.
        </Typography>
        {loadingQueue ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">Loading queue…</Typography>
          </Box>
        ) : poQueue.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No POs are waiting for vendor advance right now.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'background.paper' }}>
                  <TableCell><b>PO</b></TableCell>
                  <TableCell><b>Company</b></TableCell>
                  <TableCell><b>Vendor</b></TableCell>
                  <TableCell><b>Terms</b></TableCell>
                  <TableCell align="right"><b>PO total</b></TableCell>
                  <TableCell align="right"><b>Already recorded</b></TableCell>
                  <TableCell align="right"><b>Still due</b></TableCell>
                  <TableCell><b>Voucher</b></TableCell>
                  <TableCell><b>Actions</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {poQueue.map((row) => (
                  <TableRow key={row._id} hover>
                    <TableCell>{row.orderNumber || row._id}</TableCell>
                    <TableCell>{row.company || '—'}</TableCell>
                    <TableCell>
                      {row.vendor?.name || '—'}
                      {row.vendor?.email ? (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {row.vendor.email}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>{row.paymentTerms || '—'}</TableCell>
                    <TableCell align="right">{formatPKR(row.totalAmount || 0)}</TableCell>
                    <TableCell align="right">{formatPKR(row.advanceRecordedAmount || 0)}</TableCell>
                    <TableCell align="right">
                      <Chip label={formatPKR(row.remainingAdvanceDue || 0)} size="small" color="warning" />
                    </TableCell>
                    <TableCell>
                      {row.hasPendingVoucherApproval ? (
                        <Chip size="small" color="info" label="Awaiting signatures" />
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="info"
                          startIcon={<VisibilityIcon />}
                          onClick={() => handleViewPoDetails(row)}
                        >
                          View Docs
                        </Button>
                        <Tooltip title="Show related advance in Advance history">
                          <IconButton
                            size="small"
                            color="primary"
                            aria-label="Show related advance in history"
                            onClick={() => showRelatedAdvanceInHistory(row)}
                          >
                            <ArticleOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={`Pay the remaining ${formatPKR(row.remainingAdvanceDue || 0)}`}>
                          <span>
                            <Button
                              size="small"
                              variant="contained"
                              color="warning"
                              onClick={() => preparePaymentFromQueue(row)}
                            >
                              {Number(row.advanceRecordedAmount) > 0 ? 'Pay remaining' : 'Prepare payment'}
                            </Button>
                          </span>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={queueTotalCount}
              page={queuePage}
              onPageChange={(_, newPage) => setQueuePage(newPage)}
              rowsPerPage={queueRowsPerPage}
              onRowsPerPageChange={(e) => {
                setQueueRowsPerPage(parseInt(e.target.value, 10));
                setQueuePage(0);
              }}
              rowsPerPageOptions={[50, 100, 250, 500]}
              labelRowsPerPage="Rows per page:"
            />
          </TableContainer>
        )}
      </Paper>

      )}

      {pageTab === 'history' && (
      <Box ref={advanceHistorySectionRef}>
        <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            Advance history (partial payments)
          </Typography>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            disabled={cleaningOrphans}
            onClick={handleCleanupOrphans}
          >
            {cleaningOrphans ? 'Clearing…' : 'Clear broken advances (no voucher)'}
          </Button>
        </Box>

        {loadingAdvances ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Loading advances…</Typography>
          </Box>
        ) : advances.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {selectedVendor?._id ? 'No vendor advances found for this vendor.' : 'No vendor advances recorded yet.'}
          </Typography>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><b>Reference</b></TableCell>
                  <TableCell><b>Cheque #</b></TableCell>
                  <TableCell><b>Vendor</b></TableCell>
                  <TableCell><b>Payment date</b></TableCell>
                  <TableCell><b>Company</b></TableCell>
                  <TableCell><b>Paying company</b></TableCell>
                  <TableCell><b>Pay from account</b></TableCell>
                  <TableCell><b>Cost center</b></TableCell>
                  <TableCell><b>Linked PO</b></TableCell>
                  <TableCell><b>Voucher</b></TableCell>
                  <TableCell><b>Issuance</b></TableCell>
                  <TableCell align="right"><b>Amount</b></TableCell>
                  <TableCell align="right"><b>Applied</b></TableCell>
                  <TableCell><b>Applied to bills</b></TableCell>
                  <TableCell align="right"><b>Remaining</b></TableCell>
                  <TableCell><b>Status</b></TableCell>
                  <TableCell><b>Actions</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {advances.map((a) => (
                  <TableRow
                    key={a._id}
                    id={
                      a.referenceType === 'purchase_order' && a.referenceId
                        ? `vendor-advance-row-po-${String(a.referenceId)}`
                        : undefined
                    }
                    sx={
                      highlightPoId
                      && a.referenceType === 'purchase_order'
                      && String(a.referenceId) === String(highlightPoId)
                        ? { bgcolor: 'action.selected' }
                        : undefined
                    }
                  >
                    <TableCell>{a.reference || a._id}</TableCell>
                    <TableCell>{a.chequeNumber || '—'}</TableCell>
                    <TableCell>{a.vendor?.name || '—'}</TableCell>
                    <TableCell>
                      {a.paymentDate ? new Date(a.paymentDate).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>{a.company?.name || '—'}</TableCell>
                    <TableCell>{a.payingCompany?.name || a.company?.name || '—'}</TableCell>
                    <TableCell>
                      {a.bankAccount?.name
                        ? `${a.bankAccount.name}${a.bankAccount.accountNumber ? ` (${a.bankAccount.accountNumber})` : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell>{a.costCenter?.name || '—'}</TableCell>
                    <TableCell>{a.linkedPoNumber || '—'}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {(a.payingJournalEntryId || a.journalEntryId) ? (
                          <RouterLink
                            to={`/finance/vouchers/${a.payingJournalEntryId || a.journalEntryId}`}
                            style={{ fontSize: 13 }}
                          >
                            {a.payingJournalEntryId ? 'Open payment voucher' : 'Open voucher'}
                          </RouterLink>
                        ) : (
                          '—'
                        )}
                        {a.payingJournalEntryId && a.journalEntryId ? (
                          <RouterLink to={`/finance/vouchers/${a.journalEntryId}`} style={{ fontSize: 12 }}>
                            Open advance voucher
                          </RouterLink>
                        ) : null}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" {...getVoucherIssuanceChip(a)} />
                    </TableCell>
                    <TableCell align="right">{formatPKR(a.amount || 0)}</TableCell>
                    <TableCell align="right">{formatPKR(a.appliedAmount || 0)}</TableCell>
                    <TableCell>
                      {a.allocations && a.allocations.length > 0 ? (
                        <Box sx={{ maxWidth: 260 }}>
                          {a.allocations.slice(0, 3).map((al, idx) => (
                            <Typography key={`${a._id}-al-${idx}`} variant="caption" sx={{ display: 'block' }}>
                              {al.billNumber || 'Bill'}: {formatPKR(al.amount || 0)}
                            </Typography>
                          ))}
                          {a.allocations.length > 3 && (
                            <Typography variant="caption" sx={{ display: 'block' }}>
                              +{a.allocations.length - 3} more
                            </Typography>
                          )}
                        </Box>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell align="right">{formatPKR(a.remainingAmount || 0)}</TableCell>
                    <TableCell>
                      <Chip
                        label={String(a.status || 'open').replaceAll('_', ' ').toUpperCase()}
                        size="small"
                        color={a.status === 'applied' ? 'success' : a.status === 'partially_applied' ? 'info' : 'warning'}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                        {!a.journalEntryId ? (
                          <>
                            <Button
                              size="small"
                              variant="contained"
                              color="error"
                              disabled={removingAdvanceId === a._id}
                              onClick={() => handleRemoveBrokenAdvance(a)}
                            >
                              {removingAdvanceId === a._id ? 'Removing…' : 'Remove broken'}
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="warning"
                              disabled={ensuringVoucherId === a._id || companyBlockedForPayment}
                              onClick={() => handleEnsureVoucher(a)}
                            >
                              {ensuringVoucherId === a._id ? 'Creating…' : 'Create voucher'}
                            </Button>
                          </>
                        ) : null}
                        {a.referenceType === 'purchase_order' && a.referenceId ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="info"
                            startIcon={<VisibilityIcon />}
                            onClick={() => handleViewPoDetails({ _id: a.referenceId, orderNumber: a.linkedPoNumber })}
                          >
                            View Docs
                          </Button>
                        ) : !a.journalEntryId ? null : (
                          '—'
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={advancesTotalCount}
              page={advancesPage}
              onPageChange={(_, newPage) => setAdvancesPage(newPage)}
              rowsPerPage={advancesRowsPerPage}
              onRowsPerPageChange={(e) => {
                setAdvancesRowsPerPage(parseInt(e.target.value, 10));
                setAdvancesPage(0);
              }}
              rowsPerPageOptions={[50, 100, 250, 500]}
              labelRowsPerPage="Rows per page:"
            />
          </TableContainer>
        )}
      </Box>

      )}

      {/* Related PO Documents Dialog (Reusing existing Indent, PO, CS, Quotation, GRN & Attachment components) */}
      <Dialog
        open={viewDialog.open}
        onClose={() => setViewDialog((prev) => ({ ...prev, open: false }))}
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
              height: '100%',
              width: '100%',
              maxHeight: '100%'
            }
          }
        }}
      >
        <DialogTitle sx={{ p: 0, m: 0, '@media print': { display: 'none' } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: '1px solid #e0e0e0' }}>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#333' }}>
              Purchase Order Documents ({viewDialog.po?.orderNumber || ''})
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              {['Pending Finance', 'Sent to Finance', 'Approved'].includes(viewDialog.po?.status) && (
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<WarningIcon />}
                  size="small"
                  onClick={() => {
                    setReturnDialog({ open: true, po: viewDialog.po });
                  }}
                  sx={{ '@media print': { display: 'none' } }}
                >
                  Return with Observations
                </Button>
              )}
              <Button
                variant="contained"
                startIcon={<PrintIcon />}
                onClick={() => window.print()}
                size="small"
                sx={{ '@media print': { display: 'none' } }}
              >
                Print
              </Button>
              <IconButton
                size="small"
                onClick={() => setViewDialog((prev) => ({ ...prev, open: false }))}
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
          ) : viewDialog.po ? (
            <Box sx={{ p: 0, background: '#ffffff', fontFamily: 'Arial, sans-serif' }} className="print-content">
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
                  {!viewDialog.po?.indent ? (
                    <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                      No indent linked with this PO.
                    </Typography>
                  ) : (
                    <Paper sx={{ p: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="h5" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1 }}>
                        Purchase Request Form
                      </Typography>
                      {viewDialog.po.indent.title && (
                        <Typography variant="h6" fontWeight={600} align="center" sx={{ mb: 2 }}>
                          {viewDialog.po.indent.title}
                        </Typography>
                      )}
                      <Box sx={{ mb: 1.5, fontSize: '0.9rem', textAlign: 'center' }}>
                        <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                        <Typography component="span" sx={{ ml: 1 }}>
                          {viewDialog.po.indent.erpRef || 'PR #' + (viewDialog.po.indent.indentNumber?.split('-').pop() || '')}
                        </Typography>
                      </Box>
                      <Box sx={{ mb: 1.5, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                      <Box sx={{ mb: 3, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                            {(viewDialog.po.indent.items || []).map((item, idx) => (
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
                      {viewDialog.po.indent.justification && (
                        <Box sx={{ mb: 2 }}>
                          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Justification:</Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                            {viewDialog.po.indent.justification}
                          </Typography>
                        </Box>
                      )}
                      {Array.isArray(viewDialog.po.indent.approvalChain) && viewDialog.po.indent.approvalChain.length > 0 && (
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
                                    <TableCell>{name}</TableCell>
                                    <TableCell>
                                      <Chip size="small" label={chipLabel} color={chipColor} variant={status === 'pending' ? 'outlined' : 'filled'} />
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{step?.actedAt ? formatDateForPrint(step.actedAt) : '—'}</TableCell>
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

              {/* Tab 1: Purchase Order — compact single A4 print (matches vendor bill sizing) */}
              {viewDialog.poAuditTab === 1 && (
                <Box sx={{ p: { xs: 1, sm: 1.5 }, '@media print': { p: 0 } }} className="vendor-advance-po-print">
                  <Paper
                    className="finance-po-print-page"
                    sx={{
                      p: { xs: 1.5, sm: 2 },
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
                    <Typography
                      variant="h4"
                      fontWeight={700}
                      align="center"
                      sx={{
                        textTransform: 'uppercase',
                        mb: 0.75,
                        fontSize: { xs: '1.2rem', print: '1.05rem' },
                        letterSpacing: 0.5,
                        '@media print': { mb: 0.4, lineHeight: 1.2 }
                      }}
                    >
                      Purchase Order
                    </Typography>

                    <Box sx={{ mb: 0.6, '@media print': { mb: 0.35 } }}>
                      <Typography fontWeight={600} sx={{ mb: 0.15, fontSize: '0.85rem', '@media print': { fontSize: '0.75rem' } }}>
                        {viewDialog.po.companyId?.name || viewDialog.po.indent?.companyId?.name || '—'}
                      </Typography>
                      <Typography sx={{ fontSize: '0.75rem', lineHeight: 1.25, '@media print': { fontSize: '0.65rem' } }}>
                        Link Road I-14, adjacent to CDA Sectors I-14 and I-15
                      </Typography>
                    </Box>

                    <Divider sx={{ my: 0.6, borderColor: '#ccc', '@media print': { my: 0.35 } }} />

                    <Box sx={{ mb: 0.75, display: 'flex', justifyContent: 'space-between', gap: 1.25, '@media print': { mb: 0.5, gap: 1 } }}>
                      <Box sx={{ width: '48%', fontSize: '0.75rem', '@media print': { fontSize: '0.65rem' } }}>
                        <Typography fontWeight={600} sx={{ mb: 0.2, fontSize: '0.82rem', '@media print': { fontSize: '0.72rem' } }}>
                          {viewDialog.po.vendor?.name || 'Vendor Name'}
                        </Typography>
                        <Typography sx={{ fontSize: 'inherit', lineHeight: 1.3, mb: 0.25, fontWeight: 600 }}>
                          Payee Name: {viewDialog.po.vendor?.payeeName || viewDialog.po.vendor?.name || '—'}
                        </Typography>
                        <Typography sx={{ fontSize: 'inherit', lineHeight: 1.3, mb: 0.3 }}>
                          {viewDialog.po.vendor?.address || 'Vendor Address'}
                        </Typography>
                        {(viewDialog.po.vendor?.ntnCnic || viewDialog.po.vendor?.ntnNo || viewDialog.po.vendor?.cnic) && (
                          <Typography sx={{ fontSize: 'inherit', fontWeight: 600, mb: 0.3, color: 'text.secondary' }}>
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

                      <Box sx={{ width: '48%', fontSize: '0.75rem', lineHeight: 1.3, '@media print': { fontSize: '0.65rem', lineHeight: 1.25 } }}>
                        <Box sx={{ display: 'flex', mb: 0.1 }}>
                          <Typography component="span" sx={{ minWidth: '110px', fontWeight: 600, fontSize: 'inherit' }}>P.O No.:</Typography>
                          <Typography component="span" sx={{ fontSize: 'inherit' }}>
                            {viewDialog.po.orderNumber
                              ? (viewDialog.po.orderNumber.startsWith('P') && !viewDialog.po.orderNumber.includes('-')
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

                    <Box sx={{ mb: 0.6, '@media print': { mb: 0.4 } }}>
                      <table
                        className="finance-po-items-table"
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          border: '1px solid #000',
                          fontSize: '0.65rem',
                          fontFamily: 'Arial, sans-serif',
                          lineHeight: 1.2
                        }}
                      >
                        <thead>
                          <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'center', width: '5%' }}>Sr no</th>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'left', width: '11%' }}>Product</th>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'left', width: '23%' }}>Description</th>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'left', width: '14%' }}>Specification</th>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'left', width: '11%' }}>Brand</th>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'center', width: '11%' }}>Quantity Unit</th>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'right', width: '9%' }}>Rate</th>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'right', width: '9%' }}>Discount</th>
                            <th style={{ border: '1px solid #000', padding: '3px', fontWeight: 700, textAlign: 'right', width: '11%' }}>Amount</th>
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
                              <td colSpan={9} style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'center' }}>No items</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </Box>

                    <Box sx={{ mb: 0.6, display: 'flex', justifyContent: 'flex-end', '@media print': { mb: 0.4 } }}>
                      <Box sx={{ width: '230px', fontSize: '0.7rem', '@media print': { fontSize: '0.62rem' } }}>
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
                          <Typography component="span" fontWeight={700} sx={{ fontSize: 'inherit' }}>{Math.round(Number(viewDialog.po.totalAmount || 0)).toLocaleString()}</Typography>
                        </Box>
                        <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, fontStyle: 'italic', mt: 0.2, '@media print': { fontSize: '0.58rem' } }}>
                          Rupees {numberToWords(Math.round(Number(viewDialog.po.totalAmount || 0)))}
                        </Typography>
                      </Box>
                    </Box>

                    <Box sx={{ mb: 0.6, border: '1px solid #ccc', p: 0.6, fontSize: '0.65rem', '@media print': { p: 0.4, mb: 0.4, fontSize: '0.6rem' } }}>
                      <Typography fontWeight={700} sx={{ mb: 0.2, textDecoration: 'underline', fontSize: '0.7rem', '@media print': { fontSize: '0.62rem' } }}>
                        TERMS &amp; CONDITIONS
                      </Typography>
                      <Box sx={{ lineHeight: 1.25 }}>
                        <Box sx={{ mb: 0.1 }}>
                          <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Payment Terms:</Typography>
                          <Typography component="span" sx={{ ml: 0.5, fontSize: 'inherit' }}>{viewDialog.po.paymentTerms || '100% Advance Payment'}</Typography>
                        </Box>
                        <Box sx={{ mb: 0.1 }}>
                          <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Delivery Terms:</Typography>
                          <Typography component="span" sx={{ ml: 0.5, fontSize: 'inherit' }}>At-Site Delivery</Typography>
                        </Box>
                        <Box sx={{ mb: 0.1 }}>
                          <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Delivery Time.</Typography>
                          <Typography component="span" sx={{ ml: 0.5, fontSize: 'inherit' }}>
                            Delivery within: {viewDialog.po.quotation?.deliveryTime || '03 days'} of confirmed PO &amp; Payment
                          </Typography>
                        </Box>
                        {(viewDialog.po.vendor?.cnic || viewDialog.po.vendor?.payeeName) && (
                          <Typography sx={{ fontSize: 'inherit' }}>
                            {[viewDialog.po.vendor?.cnic ? `CNIC ${viewDialog.po.vendor.cnic}` : '', viewDialog.po.vendor?.payeeName ? `Payee Name: ${viewDialog.po.vendor.payeeName}` : ''].filter(Boolean).join(' | ')}
                          </Typography>
                        )}
                      </Box>
                    </Box>

                    <StoreVettingNotice indent={viewDialog.po?.indent} sx={{ mb: 0.75 }} />
                    <Typography fontWeight={800} sx={{ mb: 0.3, fontSize: '0.7rem', color: '#1e293b', '@media print': { fontSize: '10px', mb: 0.2 } }}>
                      Finance Document Approval Authority
                    </Typography>
                    <TableContainer component={Box} sx={{ border: '1.5px solid #334155', mb: 0, '@media print': { pageBreakInside: 'avoid', breakInside: 'avoid' } }}>
                      <Table
                        size="small"
                        sx={{
                          '& th': {
                            bgcolor: '#f1f5f9',
                            fontWeight: 800,
                            fontSize: '0.68rem',
                            border: '1px solid #cbd5e1',
                            py: 0.3,
                            px: 0.55,
                            '@media print': { py: 0.2, px: 0.45, fontSize: '9.5px' }
                          },
                          '& td': {
                            fontSize: '0.65rem',
                            border: '1px solid #cbd5e1',
                            py: 0.25,
                            px: 0.55,
                            verticalAlign: 'middle',
                            '@media print': { py: 0.15, px: 0.45, fontSize: '9.5px' }
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
                                      <Box sx={{ maxHeight: 22, display: 'flex', justifyContent: 'center', alignItems: 'center', '& img': { maxHeight: 22, width: 'auto', objectFit: 'contain' }, '@media print': { maxHeight: 18, '& img': { maxHeight: 18 } } }}>
                                        <DigitalSignatureImage userOrPath={authorityUser} alt={`${row.label} signature`} sx={{ maxHeight: 22, maxWidth: 85, '@media print': { maxHeight: 18, maxWidth: 75 } }} />
                                      </Box>
                                    ) : (
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', '@media print': { fontSize: '9px' } }}>—</Typography>
                                    )}
                                  </TableCell>
                                  <TableCell>{actionDate ? formatDateForPrint(actionDate) : '—'}</TableCell>
                                </TableRow>
                              );
                            });
                          })()}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Paper>
                </Box>
              )}

              {/* Tab 2: Comparative Statement */}
              {viewDialog.poAuditTab === 2 && (
                <Box sx={{ p: 2, overflowX: 'auto' }}>
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

              {/* Tab 3: Quotations */}
              {viewDialog.poAuditTab === 3 && (
                <Box sx={{ p: 2 }}>
                  {(!viewDialog.poQuotations || viewDialog.poQuotations.length === 0) ? (
                    <Typography color="text.secondary">No quotations linked with this PO.</Typography>
                  ) : (
                    <Stack spacing={4}>
                      {viewDialog.poQuotations.map((q) => (
                        <QuotationDetailView
                          key={q._id}
                          quotation={q}
                          formatNumber={(n) => Number(n || 0).toLocaleString()}
                          formatDateForPrint={formatDateForPrint}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
              )}

              {/* Tab 4: GRNs */}
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

              {/* Tab 5: Attached Documents */}
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
                              <TableCell>{doc.uploadedAt ? formatDateForPrint(doc.uploadedAt) : '—'}</TableCell>
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
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dialog: Quick Add Chart of Accounts Account */}
      <AddAccountDialog 
        open={newAccountDialog} 
        onClose={() => setNewAccountDialog(false)}
        onSuccess={handleSaveNewAccount}
        selectedCompanyId={selectedCompanyId}
      />

      {/* Dialog: Quick Add Vendor */}
      <Dialog open={openAddVendor} onClose={() => setOpenAddVendor(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add New Vendor</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Vendor Name"
              required
              fullWidth
              size="small"
              placeholder="e.g. Sardar Cement Ltd"
              value={newVendorForm.name}
              onChange={(e) => setNewVendorForm((p) => ({ ...p, name: e.target.value }))}
            />
            <TextField
              label="Contact Person"
              fullWidth
              size="small"
              placeholder="e.g. Muhammad Ali"
              value={newVendorForm.contactPerson}
              onChange={(e) => setNewVendorForm((p) => ({ ...p, contactPerson: e.target.value }))}
            />
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Phone"
                  fullWidth
                  size="small"
                  placeholder="e.g. +92 300 1234567"
                  value={newVendorForm.phone}
                  onChange={(e) => setNewVendorForm((p) => ({ ...p, phone: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Email"
                  type="email"
                  fullWidth
                  size="small"
                  placeholder="e.g. ali@sardarcement.com"
                  value={newVendorForm.email}
                  onChange={(e) => setNewVendorForm((p) => ({ ...p, email: e.target.value }))}
                />
              </Grid>
            </Grid>
            <TextField
              label="Address"
              fullWidth
              size="small"
              placeholder="e.g. Sector G-8, Islamabad"
              value={newVendorForm.address}
              onChange={(e) => setNewVendorForm((p) => ({ ...p, address: e.target.value }))}
            />
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Payment Terms</InputLabel>
                  <Select
                    value={newVendorForm.paymentTerms}
                    label="Payment Terms"
                    onChange={(e) => setNewVendorForm((p) => ({ ...p, paymentTerms: e.target.value }))}
                  >
                    <MenuItem value="Cash">Cash</MenuItem>
                    <MenuItem value="net_15">Net 15</MenuItem>
                    <MenuItem value="net_30">Net 30</MenuItem>
                    <MenuItem value="net_45">Net 45</MenuItem>
                    <MenuItem value="net_60">Net 60</MenuItem>
                    <MenuItem value="due_on_receipt">Due on Receipt</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Vendor Category"
                  fullWidth
                  size="small"
                  placeholder="e.g. Construction Materials"
                  value={newVendorForm.vendorCategory}
                  onChange={(e) => setNewVendorForm((p) => ({ ...p, vendorCategory: e.target.value }))}
                />
              </Grid>
            </Grid>
            <TextField
              label="Notes"
              multiline
              rows={2}
              fullWidth
              size="small"
              value={newVendorForm.notes}
              onChange={(e) => setNewVendorForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpenAddVendor(false)} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleSaveNewVendor}
            variant="contained"
            disabled={creatingVendor || !newVendorForm.name.trim()}
          >
            {creatingVendor ? 'Saving...' : 'Save & Select'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog: Return PO with Observations to Procurement */}
      <Dialog
        open={returnDialog.open}
        onClose={() => {
          setReturnDialog({ open: false, po: null });
          setReturnComments('');
          setReturnSignature('');
          setReturnAgree(false);
          setReturnObservations([{ observation: '', severity: 'medium' }]);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          Return Purchase Order with Observations to Procurement
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You are returning Purchase Order: <strong>{returnDialog.po?.orderNumber}</strong> to Procurement with observations for revision.
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Return Comments (Required)"
            value={returnComments}
            onChange={(e) => setReturnComments(e.target.value)}
            required
            sx={{ mb: 3 }}
          />

          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
              Audit Observations / Points for Revision:
            </Typography>
            {returnObservations.map((obs, index) => (
              <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1, backgroundColor: '#fdfdfd' }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={8}>
                    <TextField
                      fullWidth
                      label={`Observation #${index + 1}`}
                      multiline
                      rows={2}
                      placeholder="Enter specific observation or requirement for Procurement..."
                      value={obs.observation}
                      onChange={(e) => updateObservation(index, 'observation', e.target.value)}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Severity</InputLabel>
                      <Select
                        value={obs.severity}
                        label="Severity"
                        onChange={(e) => updateObservation(index, 'severity', e.target.value)}
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
                      onClick={() => removeObservation(index)}
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
              onClick={addObservation}
              variant="outlined"
            >
              Add Observation
            </Button>
          </Box>

          <FormControlLabel
            control={
              <Checkbox
                checked={returnAgree}
                onChange={(e) => setReturnAgree(e.target.checked)}
              />
            }
            label="I confirm that I have reviewed this purchase order and am returning it to Procurement with the above observations."
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => {
              setReturnDialog({ open: false, po: null });
              setReturnComments('');
              setReturnSignature('');
              setReturnAgree(false);
              setReturnObservations([{ observation: '', severity: 'medium' }]);
            }}
            color="inherit"
          >
            Cancel
          </Button>
          <Button
            onClick={handleFinanceReturnPO}
            variant="contained"
            color="warning"
            disabled={actionLoading || !returnAgree || !returnComments.trim()}
            startIcon={actionLoading ? <CircularProgress size={20} /> : <WarningIcon />}
          >
            Return with Observations
          </Button>
        </DialogActions>
      </Dialog>

      <style>{`
        @page {
          size: A4 portrait;
          margin: 6mm 8mm;
        }
        @media print {
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          body * {
            visibility: hidden;
          }
          .print-content,
          .print-content *,
          .vendor-advance-po-print,
          .vendor-advance-po-print *,
          .finance-po-print-page,
          .finance-po-print-page * {
            visibility: visible;
          }
          .print-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .finance-po-print-page {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .finance-po-items-table th,
          .finance-po-items-table td {
            padding: 2px 3px !important;
            font-size: 9.5px !important;
            line-height: 1.15 !important;
          }
        }
      `}</style>
    </Box>
  );
};

export default VendorAdvance;
