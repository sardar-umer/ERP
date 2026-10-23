import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  LinearProgress,
  Alert,
  alpha,
  useTheme,
  Avatar,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tabs,
  Tab,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  InputAdornment,
  Checkbox
} from '@mui/material';
import {
  AccountBalance as AccountBalanceIcon,
  ShoppingCart as ShoppingCartIcon,
  TrendingDown as TrendingDownIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as ViewIcon,
  Payment as PaymentIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  History as HistoryIcon,
  Print as PrintIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Undo as UndoIcon,
  Send as SendIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';
import {
  fetchPayFromAccounts,
  fetchRelatedPartyPayFromAccounts,
  formatPayFromAccountLabel,
  isIntercompanyPayingMode
} from '../../utils/payFromAccounts';
import toast from 'react-hot-toast';
import ComparativeStatementView from '../../components/Procurement/ComparativeStatementView';
import QuotationDetailView from '../../components/Procurement/QuotationDetailView';
import StoreVettingNotice from '../../components/Procurement/StoreVettingNotice';
import CentralizedStoreBillInvoiceBody from '../../components/UtilityBill/CentralizedStoreBillInvoiceBody';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import { getApprovalRoleLabel } from '../../utils/utilityBillApprovalSlots';
import NarrationTableCell from '../../components/common/NarrationTableCell';
import { getBillNarrationDisplay } from '../../utils/documentNarrationDisplay';
import {
  getBillCompany,
  getBillProject,
  getBillInvoiceLocation,
  getCentralizedStoreDocumentTypeLabel,
  getStoreInvoiceOrgTitle,
  getDuePaymentAmountFromBill,
  getLineDuePaymentAmount,
  getPayableAmountFromBill
} from '../../utils/centralizedStoreBillDisplay';
import { useAuth } from '../../contexts/AuthContext';
import FinanceApprovalAuthorityPicker from '../../components/Finance/FinanceApprovalAuthorityPicker';
import {
  buildFinanceApprovalAuthoritiesPayload,
  fetchFinanceAuthorityCandidates,
  validateFinanceAuthoritySelection
} from '../../services/financeApprovalAuthorityService';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import FinanceCompanySelector from '../../components/Finance/FinanceCompanySelector';
import WorkflowHistoryDialog from '../../components/WorkflowHistoryDialog';
import QuickbooksPayBillsModal from '../../components/Finance/QuickbooksPayBillsModal';

const getBillPayeeEmployeeId = (bill) => {
  const pe = bill?.payeeEmployee;
  if (!pe) return '';
  if (typeof pe === 'object' && pe !== null) return String(pe._id || '');
  return String(pe);
};

const getBillPayeeEmployeeDisplayName = (bill) => {
  const pe = bill?.payeeEmployee;
  if (pe && typeof pe === 'object') {
    const name = [pe.firstName, pe.lastName].filter(Boolean).join(' ').trim();
    if (name) return name;
    if (pe.employeeId) return String(pe.employeeId);
  }
  return bill?.vendorName || bill?.vendor?.name || '';
};

const calculateAge = (date) => {
  if (!date) return 0;
  const today = new Date();
  const billDate = new Date(date);
  const diffTime = Math.abs(today - billDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      const val = Math.min(row[j + 1] + 1, prev + 1, row[j] + cost);
      row[j] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
};

const matchesFuzzyToken = (token, corpus, words) => {
  if (!token) return true;
  // 1. Direct substring match in full corpus
  if (corpus.includes(token)) return true;

  // 2. Numeric / amount match without formatting
  const cleanDigits = token.replace(/[^0-9.]/g, '');
  if (cleanDigits && corpus.replace(/[^0-9.]/g, ' ').includes(cleanDigits)) {
    return true;
  }

  // 3. Typo-tolerant match against individual words (for words of length >= 5)
  if (token.length >= 5) {
    const maxDist = token.length <= 7 ? 1 : 2;
    for (const w of words) {
      if (w.length >= 5 && Math.abs(w.length - token.length) <= maxDist) {
        if (levenshtein(token, w) <= maxDist) return true;
      }
    }
  }

  return false;
};

const AccountsPayable = () => {
  const { selectedCompanyId, companies: financeCompanies } = useFinanceCompany();
  const [payingCompanyId, setPayingCompanyId] = useState('');
  const { user: currentUser } = useAuth();
  const preparerUserId = String(currentUser?.id || currentUser?._id || '');
  const preparerDisplayName = [currentUser?.firstName, currentUser?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim() || currentUser?.email || 'Preparer';

  const getPaidAmount = (bill) => {
    // Backend responses are inconsistent: sometimes use `paidAmount`, sometimes `amountPaid`.
    const paid = bill?.paidAmount ?? bill?.amountPaid ?? 0;
    return Number(paid) || 0;
  };
  const getAdvanceAppliedAmount = (bill) => Number(bill?.advanceApplied || 0) || 0;
  const getSettledAmount = (bill) => {
    // Settlement on AP is cash/bank paid + vendor advance applied.
    return Math.round((getPaidAmount(bill) + getAdvanceAppliedAmount(bill)) * 100) / 100;
  };

  const getSettlementPending = (bill) =>
    Number(bill?.settlementPending ?? ((bill?.advancePending || 0) + (bill?.paymentPending || 0))) || 0;

  const canEditVendorBill = (bill) => {
    if (!bill) return false;
    if (['paid', 'partial', 'cancelled', 'Pending Audit', 'Forwarded to Audit Director'].includes(bill.status)) return false;
    if (getSettledAmount(bill) > 0) return false;
    if (getSettlementPending(bill) > 0) return false;
    return true;
  };

  /** Finance may return an approved unpaid bill to initiator (approval chain stays intact). */
  const canFinanceReturnBill = (bill) => {
    if (!bill) return false;
    if (!['approved', 'received', 'overdue'].includes(bill.status)) return false;
    if (getSettledAmount(bill) > 0) return false;
    if (getSettlementPending(bill) > 0) return false;
    return true;
  };

  const isBillInitiator = (bill) => {
    const creatorId = String(bill?.createdBy?._id || bill?.createdBy || '');
    return Boolean(preparerUserId && creatorId && preparerUserId === creatorId);
  };

  const canResubmitToFinance = (bill) => {
    if (!bill || bill.status !== 'Returned from Finance') return false;
    return isBillInitiator(bill) || ['super_admin', 'admin', 'finance_manager', 'general_manager'].includes(
      String(currentUser?.role || '')
    );
  };

  const handleResubmitToAudit = async (bill) => {
    if (!bill?._id) return;
    try {
      const res = await api.post(`/finance/accounts-payable/${bill._id}/resubmit-to-audit`, {
        comments: 'Resubmitted to Pre-Audit after audit observations'
      });
      toast.success(res.data?.message || 'Bill resubmitted to Pre-Audit');
      if (selectedBill?._id === bill._id && res.data?.data) {
        setSelectedBill(res.data.data);
      }
      fetchAccountsPayable();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resubmit to Pre-Audit');
    }
  };

  const handleFinanceReturnBill = async (bill) => {
    const target = bill || selectedBill;
    if (!target?._id) return;
    const reason = window.prompt('Reason for returning this bill to the initiator');
    if (!reason || !String(reason).trim()) return;
    try {
      const res = await api.post(`/finance/accounts-payable/${target._id}/finance-return`, {
        rejectionReason: String(reason).trim()
      });
      toast.success(res.data?.message || 'Bill returned to initiator');
      if (selectedBill?._id === target._id && res.data?.data) {
        setSelectedBill(res.data.data);
      }
      fetchAccountsPayable();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to return bill');
    }
  };

  const handleResubmitToFinance = async (bill) => {
    const target = bill || selectedBill;
    if (!target?._id) return;
    try {
      const res = await api.post(`/finance/accounts-payable/${target._id}/resubmit-to-finance`, {
        comments: 'Resubmitted to Finance after corrections'
      });
      toast.success(res.data?.message || 'Bill resubmitted to Finance');
      if (selectedBill?._id === target._id && res.data?.data) {
        setSelectedBill(res.data.data);
      }
      fetchAccountsPayable();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resubmit to Finance');
    }
  };

  const getOutstanding = (bill) => {
    // After due date, payable base switches to duePaymentAmount (keeps original totalAmount for display)
    const total = getPayableAmountFromBill(bill);
    const paid = getPaidAmount(bill);
    const adv = getAdvanceAppliedAmount(bill);
    const actualUnpaid = Math.max(0, Math.round((total - paid - adv) * 100) / 100);
    const pending = getSettlementPending(bill);
    const afterPending = Math.max(0, Math.round((actualUnpaid - pending) * 100) / 100);
    // Prefer fresh local calc when API outstanding understates after-due payable
    if (bill?.outstandingAmount != null && Number(bill.outstandingAmount) >= 0) {
      const apiOut = Number(bill.outstandingAmount);
      return Math.max(apiOut, afterPending);
    }
    return afterPending;
  };

  const getCashPaidAmount = (bill) => {
    const total = Number(bill?.totalAmount || 0);
    const adv = Number(bill?.advanceApplied || 0);
    const outstanding = getOutstanding(bill);
    const cashPaid = total - adv - outstanding;
    return Math.round((Number(cashPaid) || 0) * 100) / 100;
  };

  const roundPay2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  /** Distribute cash-approval usage to bills (selected bill first), then set bank payment per row. */
  const distributeCaUsageToBillRows = (totalCaUsage, billRows, seedBillId) => {
    let remaining = roundPay2(totalCaUsage);
    const ordered = [...billRows];
    if (seedBillId) {
      ordered.sort((a, b) => {
        if (String(a.billId) === String(seedBillId)) return -1;
        if (String(b.billId) === String(seedBillId)) return 1;
        return 0;
      });
    }
    const byId = new Map(
      ordered.map((row) => {
        const advanceApplyAmount = remaining <= 0 ? 0 : Math.min(Number(row.outstanding) || 0, remaining);
        remaining = roundPay2(remaining - advanceApplyAmount);
        const payAmount = roundPay2(Math.max(0, (Number(row.outstanding) || 0) - advanceApplyAmount));
        return [String(row.billId), { ...row, advanceApplyAmount, payAmount }];
      })
    );
    return billRows.map((row) => byId.get(String(row.billId)) || row);
  };

  const syncBillPaymentFromCaApply = (nextCaApplyAmounts, billRows, seedBillId) => {
    const totalCaUsage = roundPay2(
      payeeCashApprovals.reduce((s, ca) => s + (Number(nextCaApplyAmounts[ca.cashApprovalId]) || 0), 0)
    );
    const nextBills = distributeCaUsageToBillRows(totalCaUsage, billRows, seedBillId);
    const totalBank = roundPay2(nextBills.reduce((s, r) => s + (Number(r.payAmount) || 0), 0));
    setOutstandingTransactions(nextBills);
    setPaymentData((prev) => ({ ...prev, amount: totalBank }));
    return nextBills;
  };

  /**
   * Per-GRN paid in Linked Documents: sum cash payments allocated to each GRN when present;
   * spread any remaining settlement (e.g. vendor advance applied to the bill) across GRN
   * lines by their bill portion so advance-only settlement still shows correct Paid / %.
   */
  const getLinkedGrnSettlementRows = (bill) => {
    const linked = bill?.linkedGRNs || [];
    if (!linked.length) return [];

    const paidByGrn = {};
    (bill?.payments || []).forEach((p) => {
      (p?.allocations || []).forEach((a) => {
        const key = String(a?.grnId || '');
        if (!key) return;
        paidByGrn[key] = (paidByGrn[key] || 0) + (Number(a?.amount) || 0);
      });
    });

    const totalSettled = getSettledAmount(bill);
    const rows = linked.map((ln) => {
      const portion = Number(ln?.amount) || 0;
      const key = String(ln?.grnId || '');
      const fromAlloc = Math.min(portion, Number(paidByGrn[key] || 0));
      return { ln, portion, fromAlloc };
    });

    const sumAlloc = rows.reduce((s, r) => s + r.fromAlloc, 0);
    const remaining = Math.round((totalSettled - sumAlloc) * 100) / 100;
    const sumCap = rows.reduce((s, r) => s + Math.max(0, r.portion - r.fromAlloc), 0);

    return rows.map((r) => {
      let paid = r.fromAlloc;
      if (remaining > 0.01 && sumCap > 0) {
        const cap = Math.max(0, r.portion - r.fromAlloc);
        paid = Math.round((r.fromAlloc + (remaining * cap) / sumCap) * 100) / 100;
        paid = Math.min(r.portion, paid);
      }
      const remainingByGrn = Math.max(0, Math.round((r.portion - paid) * 100) / 100);
      const pct = r.portion > 0 ? Math.round((paid / r.portion) * 100) : 0;
      return { ln: r.ln, portion: r.portion, paid, remainingByGrn, pct };
    });
  };

  const navigate = useNavigate();
  const theme = useTheme();
  
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [error, setError] = useState('');
  const [selectedBill, setSelectedBill] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [workflowHistoryDialog, setWorkflowHistoryDialog] = useState({ open: false, document: null });
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [payBillsModalOpen, setPayBillsModalOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editData, setEditData] = useState({
    billNumber: '',
    totalAmount: 0,
    billDate: '',
    dueDate: '',
    companyId: '',
    company: ''
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [billToDelete, setBillToDelete] = useState(null);
  const [deletingBill, setDeletingBill] = useState(false);

  const handleOpenDelete = (bill) => {
    setBillToDelete(bill);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!billToDelete) return;
    try {
      setDeletingBill(true);
      const res = await api.delete(`/finance/accounts-payable/${billToDelete._id}`);
      if (res.data?.success || res.status === 200) {
        toast.success(`✓ Bill ${billToDelete.billNumber} deleted successfully`);
        setDeleteDialogOpen(false);
        setBillToDelete(null);
        fetchAccountsPayable();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete bill');
    } finally {
      setDeletingBill(false);
    }
  };

  const [paymentData, setPaymentData] = useState({
    amount: 0,
    paymentMethod: 'bank_transfer',
    reference: '',
    narration: '',
    paymentDate: new Date().toISOString().split('T')[0],
    costCenter: '',
    bankAccountId: '',
    relatedPartyAccountId: ''
  });
  const [processingPayment, setProcessingPayment] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [relatedPartyAccounts, setRelatedPartyAccounts] = useState([]);
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [posForBilling, setPosForBilling] = useState([]);
  const [loadingPosForBilling, setLoadingPosForBilling] = useState(false);
  const [createFromPoDialog, setCreateFromPoDialog] = useState({ open: false, po: null, billNumber: '', creating: false });
  const [billViewTab, setBillViewTab] = useState(0);
  const [expandedRows, setExpandedRows] = useState({});
  const [payeeVendors, setPayeeVendors] = useState([]);
  const [selectedPayee, setSelectedPayee] = useState({ vendorId: '', vendorName: '' });
  const [payeeType, setPayeeType] = useState('vendor');
  const [financeEmployees, setFinanceEmployees] = useState([]);
  const [selectedEmployeePayee, setSelectedEmployeePayee] = useState({
    employeeId: '',
    employeeName: '',
    employeeCode: ''
  });
  const [outstandingTransactions, setOutstandingTransactions] = useState([]);
  const [loadingOutstandingTransactions, setLoadingOutstandingTransactions] = useState(false);
  const [payeeCashApprovals, setPayeeCashApprovals] = useState([]);
  const [loadingPayeeCashApprovals, setLoadingPayeeCashApprovals] = useState(false);
  const [payeeVendorAdvances, setPayeeVendorAdvances] = useState([]);
  const [caApplyAmounts, setCaApplyAmounts] = useState({});
  const [processingCaApply, setProcessingCaApply] = useState(false);
  const [financeAuthorityCandidates, setFinanceAuthorityCandidates] = useState([]);
  const [billPaymentFinAuth, setBillPaymentFinAuth] = useState({
    accountsManagerUser: null,
    financeControllerUser: null
  });
  const [filters, setFilters] = useState({
    status: 'unpaid',
    vendor: '',
    startDate: new Date(new Date().getFullYear(), 6, 1).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    search: '',
    billType: ''
  });
  const [searchInput, setSearchInput] = useState('');
  const [vendorInput, setVendorInput] = useState('');

  // Debounce search input into filters.search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        if (prev.search === searchInput) return prev;
        return { ...prev, search: searchInput };
      });
      setPagination((prev) => ({ ...prev, currentPage: 1 }));
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Debounce vendor input into filters.vendor
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        if (prev.vendor === vendorInput) return prev;
        return { ...prev, vendor: vendorInput };
      });
      setPagination((prev) => ({ ...prev, currentPage: 1 }));
    }, 350);
    return () => clearTimeout(timer);
  }, [vendorInput]);

  const getBillTypeBadge = (bill) => {
    if (bill.referenceType === 'utility_bill' || bill.module === 'taj_utilities') {
      return (
        <Chip
          label="Centralized Store"
          size="small"
          color="secondary"
          variant="outlined"
          sx={{ fontWeight: 600, fontSize: '0.72rem' }}
        />
      );
    }
    if (bill.referenceType === 'purchase_order' || bill.referenceType === 'grn') {
      return (
        <Chip
          label="PO / GRN"
          size="small"
          color="info"
          variant="outlined"
          sx={{ fontWeight: 600, fontSize: '0.72rem' }}
        />
      );
    }
    return (
      <Chip
        label="Chart of Accounts"
        size="small"
        color="primary"
        variant="outlined"
        sx={{ fontWeight: 600, fontSize: '0.72rem' }}
      />
    );
  };

  const getBillDepartment = (bill) => {
    if (bill.department && typeof bill.department === 'string' && bill.department.trim()) return bill.department;
    if (bill.department?.name && typeof bill.department.name === 'string') return bill.department.name;
    if (bill.departmentName && typeof bill.departmentName === 'string') return bill.departmentName;
    if (bill.lineItems && Array.isArray(bill.lineItems)) {
      const lineWithDept = bill.lineItems.find((l) => l.department && typeof l.department === 'string' && l.department.trim());
      if (lineWithDept) return lineWithDept.department;
    }
    return '—';
  };

  const getBillSearchCorpus = useCallback((bill) => {
    const parts = [];
    // Bill # & Vendor Invoice #
    if (bill.billNumber) parts.push(String(bill.billNumber));
    if (bill.vendorInvoiceNumber) parts.push(String(bill.vendorInvoiceNumber));

    // Bill Type
    if (bill.referenceType === 'utility_bill' || bill.module === 'taj_utilities') {
      parts.push('centralized store utility bill');
    } else if (bill.referenceType === 'purchase_order' || bill.referenceType === 'grn') {
      parts.push('purchase order po grn');
    } else {
      parts.push('chart of accounts coa manual finance');
    }

    // Vendor / Payee
    if (bill.vendorName) parts.push(String(bill.vendorName));
    if (bill.vendor?.name) parts.push(String(bill.vendor.name));
    if (bill.vendorEmail) parts.push(String(bill.vendorEmail));
    if (bill.vendor?.email) parts.push(String(bill.vendor.email));
    const payeeEmp = getBillPayeeEmployeeDisplayName(bill);
    if (payeeEmp) parts.push(payeeEmp);
    if (bill.payeeEmployee?.employeeId) parts.push(String(bill.payeeEmployee.employeeId));

    // Company & Project
    const comp = getBillCompany(bill);
    if (comp && comp !== '—') parts.push(comp);
    const proj = getBillProject(bill);
    if (proj && proj !== '—') parts.push(proj);

    // Narration / Description (all variants)
    const narration = getBillNarrationDisplay(bill);
    if (narration && narration !== '—') parts.push(narration);
    if (bill.notes) parts.push(String(bill.notes));
    if (bill.internalNotes) parts.push(String(bill.internalNotes));
    if (bill.forWhat) parts.push(String(bill.forWhat));
    if (bill.description) parts.push(String(bill.description));
    if (Array.isArray(bill.lineItems)) {
      bill.lineItems.forEach((li) => {
        if (li.description) parts.push(String(li.description));
        if (li.itemName) parts.push(String(li.itemName));
        if (li.company) parts.push(String(li.company));
        if (li.project) parts.push(String(li.project));
      });
    }

    // Dates
    if (bill.billDate) {
      parts.push(formatDate(bill.billDate));
      parts.push(String(bill.billDate));
    }
    if (bill.dueDate) {
      parts.push(formatDate(bill.dueDate));
      parts.push(String(bill.dueDate));
    }

    // Amounts: Total Amount, Paid, Outstanding
    const total = Number(bill.totalAmount || 0);
    const paid = getSettledAmount(bill);
    const outstanding = getOutstanding(bill);
    parts.push(String(total));
    parts.push(formatPKR(total));
    parts.push(String(Math.round(total)));
    parts.push(String(paid));
    parts.push(formatPKR(paid));
    parts.push(String(Math.round(paid)));
    parts.push(String(outstanding));
    parts.push(formatPKR(outstanding));
    parts.push(String(Math.round(outstanding)));

    // Status & approvals
    if (bill.status) parts.push(String(bill.status));
    if (getSettlementPending(bill) > 0) parts.push('pending approval');

    // Aging
    const days = calculateAge(bill.billDate);
    parts.push(`${days} days`);

    // Linked GRNs & POs
    if (Array.isArray(bill.linkedGRNs)) {
      bill.linkedGRNs.forEach((g) => {
        if (g.grnNumber) parts.push(String(g.grnNumber));
        if (g.poNumber) parts.push(String(g.poNumber));
      });
    }

    const fullText = parts.join(' ').toLowerCase();
    const words = fullText.split(/[\s,/;:\-–—_()[\]{}]+/).filter(Boolean);
    return { fullText, words };
  }, []);

  const billCompanyForPayment = useMemo(() => {
    if (selectedCompanyId && String(selectedCompanyId).toLowerCase() !== 'all') {
      return selectedCompanyId;
    }
    const payRows = selectedBill ? [selectedBill] : outstandingTransactions;
    if (payRows?.length > 0) {
      const c = payRows[0].companyId;
      return typeof c === 'object' ? c?._id : c;
    }
    return selectedCompanyId;
  }, [selectedCompanyId, selectedBill, outstandingTransactions]);

  const isIcPayingMode = isIntercompanyPayingMode(payingCompanyId, billCompanyForPayment);

  const filteredBills = useMemo(() => {
    let list = bills;

    // billType is filtered server-side; keep only client fuzzy search refinement
    const query = (searchInput || '').trim().toLowerCase();
    if (!query) return list;

    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) return list;

    return list.filter((bill) => {
      const { fullText, words } = getBillSearchCorpus(bill);
      return tokens.every((token) => matchesFuzzyToken(token, fullText, words));
    });
  }, [bills, searchInput, getBillSearchCorpus]);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    limit: 100
  });
  const [summary, setSummary] = useState({
    totalOutstanding: 0,
    totalOverdue: 0,
    totalPaid: 0,
    totalBills: 0,
    pendingUtilityBills: 0,
    dueUtilityWarningCount: 0,
    dueUtilityWarnings: []
  });
  const [utilityDueWarningOpen, setUtilityDueWarningOpen] = useState(false);

  useEffect(() => {
    if (!paymentDialogOpen) return;
    let cancelled = false;
    api.get('/finance/cost-centers').then(res => {
      if (!cancelled && res.data.success) setCostCenters(res.data.data);
    }).catch(e => console.error(e));

    fetchFinanceAuthorityCandidates()
      .then((list) => {
        if (!cancelled) {
          setFinanceAuthorityCandidates(list);
          const gmFinance = list.find(u => u.position?.toLowerCase() === 'general manager' && u.department?.toLowerCase() === 'finance/accounts');
          const srManager = list.find(u => u.position?.toLowerCase() === 'sr manager' && u.department?.toLowerCase() === 'finance/accounts');
          
          setBillPaymentFinAuth(prev => ({
            ...prev,
            financeControllerUser: prev.financeControllerUser || gmFinance || null,
            accountsManagerUser: prev.accountsManagerUser || srManager || null
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setFinanceAuthorityCandidates([]);
      });
    return () => { cancelled = true; };
  }, [paymentDialogOpen]);

  // Pay From = banks of paying company; Related Party = original bill company (IC only)
  useEffect(() => {
    let billCompanyId = selectedCompanyId;
    if (!billCompanyId || String(billCompanyId).toLowerCase() === 'all') {
      const payRows = selectedBill ? [selectedBill] : outstandingTransactions;
      if (payRows.length > 0) {
        billCompanyId = typeof payRows[0].companyId === 'object' ? payRows[0].companyId?._id : payRows[0].companyId;
      }
    }

    const payingComp = payingCompanyId || billCompanyId || selectedCompanyId;
    if (!payingComp || String(payingComp).toLowerCase() === 'all') return;

    const icMode = isIntercompanyPayingMode(payingCompanyId, billCompanyId);

    fetchPayFromAccounts(api, { companyId: payingComp })
      .then((accs) => {
        setBankAccounts(accs);
        setPaymentData((prev) => {
          const stillValid = prev.bankAccountId
            && accs.some((item) => String((item?.account || item)?._id) === String(prev.bankAccountId));
          return { ...prev, bankAccountId: stillValid ? prev.bankAccountId : '' };
        });
      })
      .catch(() => setBankAccounts([]));

    if (icMode && billCompanyId) {
      fetchRelatedPartyPayFromAccounts(api, { companyId: billCompanyId })
        .then((accs) => {
          setRelatedPartyAccounts(accs);
          setPaymentData((prev) => {
            const stillValid = prev.relatedPartyAccountId
              && accs.some((item) => String((item?.account || item)?._id) === String(prev.relatedPartyAccountId));
            return { ...prev, relatedPartyAccountId: stillValid ? prev.relatedPartyAccountId : '' };
          });
        })
        .catch(() => setRelatedPartyAccounts([]));
    } else {
      setRelatedPartyAccounts([]);
      setPaymentData((prev) => (
        prev.relatedPartyAccountId ? { ...prev, relatedPartyAccountId: '' } : prev
      ));
    }

    api.get('/finance/accounts', { params: { companyId: payingComp, limit: 500 } })
      .then((res) => {
        const accs = res.data?.data?.accounts || res.data?.data || [];
        setExpenseAccounts(accs.filter((a) => String(a.type).toLowerCase().includes('expense')));
      })
      .catch(() => setExpenseAccounts([]));
  }, [payingCompanyId, selectedCompanyId, selectedBill, outstandingTransactions, bills]);

  useEffect(() => {
    api.get('/procurement/vendors', { params: { limit: 1000 } })
      .then((res) => {
        const vendors = res.data?.data?.vendors || [];
        setPayeeVendors(vendors.map((v) => ({
          vendorId: String(v?._id || ''),
          vendorName: v?.name || 'Unknown Vendor'
        })));
      })
      .catch(() => setPayeeVendors([]));
  }, []);

  useEffect(() => {
    api.get('/finance/employees', { params: { limit: 500 } })
      .then((res) => {
        const rows = res.data?.data?.employees || [];
        setFinanceEmployees(
          rows.map((e) => ({
            employeeId: String(e._id),
            employeeCode: e.employeeId || '',
            employeeName:
              [e.firstName, e.lastName].filter(Boolean).join(' ').trim() ||
              e.employeeId ||
              'Employee'
          }))
        );
      })
      .catch(() => setFinanceEmployees([]));
  }, []);

  const fetchPosForBilling = async () => {
    try {
      setLoadingPosForBilling(true);
      const res = await api.get('/finance/accounts-payable/pos-for-billing');
      if (res.data?.success) setPosForBilling(res.data.data || []);
    } catch (e) {
      setPosForBilling([]);
    } finally {
      setLoadingPosForBilling(false);
    }
  };
  useEffect(() => { fetchPosForBilling(); }, [viewDialogOpen]);

  const fetchAccountsPayable = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.vendor) params.append('vendor', filters.vendor);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.search) params.append('search', filters.search);
      if (filters.billType) params.append('billType', filters.billType);
      params.append('page', pagination.currentPage);
      params.append('limit', pagination.limit);
      params.append('companyId', selectedCompanyId);
      params.append('_t', new Date().getTime());

      const response = await api.get(`/finance/accounts-payable?${params}`, {
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      if (response.data.success) {
        setBills(response.data.data.bills || []);
        setPagination(prev => ({
          ...prev,
          ...response.data.data.pagination
        }));
        setSummary(response.data.data.summary || {
          totalOutstanding: 0,
          totalOverdue: 0,
          totalPaid: 0,
          totalBills: 0,
          pendingUtilityBills: 0,
          dueUtilityWarningCount: 0,
          dueUtilityWarnings: []
        });
      }
    } catch (error) {
      console.error('Error fetching accounts payable:', error);
      setError('Failed to fetch accounts payable data');
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, [filters, pagination.currentPage, pagination.limit, selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setLoading(false);
      setInitialLoading(false);
      return;
    }
    fetchAccountsPayable();
  }, [fetchAccountsPayable, selectedCompanyId]);

  // Warning popup: unpaid utility bills due today or overdue (once per browser session until dismissed)
  useEffect(() => {
    const warnings = Array.isArray(summary.dueUtilityWarnings) ? summary.dueUtilityWarnings : [];
    const dismissKey = `sgc_ap_utility_due_warn_${selectedCompanyId || 'none'}`;
    if (!warnings.length || !selectedCompanyId) {
      try {
        sessionStorage.removeItem(dismissKey);
      } catch (_) {
        /* ignore */
      }
      setUtilityDueWarningOpen(false);
      return;
    }
    try {
      if (sessionStorage.getItem(dismissKey) === '1') {
        setUtilityDueWarningOpen(false);
        return;
      }
    } catch (_) {
      /* ignore */
    }
    setUtilityDueWarningOpen(true);
  }, [summary.dueUtilityWarnings, selectedCompanyId]);

  const dismissUtilityDueWarning = () => {
    if (selectedCompanyId) {
      try {
        sessionStorage.setItem(`sgc_ap_utility_due_warn_${selectedCompanyId}`, '1');
      } catch (_) {
        /* ignore */
      }
    }
    setUtilityDueWarningOpen(false);
  };

  const viewUtilityDueWarningBills = () => {
    dismissUtilityDueWarning();
    setFilters((prev) => ({
      ...prev,
      status: 'unpaid',
      billType: 'store',
      startDate: '',
      endDate: '',
      search: ''
    }));
    setSearchInput('');
    setPagination((prev) => ({ ...prev, currentPage: 1 }));
  };

  const handleFilterChange = (field) => (event) => {
    setFilters(prev => ({
      ...prev,
      [field]: event.target.value
    }));
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };

  const handlePageChange = (event, newPage) => {
    setPagination(prev => ({ ...prev, currentPage: newPage + 1 }));
  };

  const handleRowsPerPageChange = (event) => {
    setPagination(prev => ({
      ...prev,
      limit: parseInt(event.target.value, 10),
      currentPage: 1
    }));
  };

  const handleViewBill = async (bill) => {
    try {
      api.get('/finance/cost-centers').then(res => {
        if (res.data.success) setCostCenters(res.data.data);
      }).catch(e => console.error(e));
      setLoading(true);
      setBillViewTab(0);
      const billCompanyId =
        (bill?.companyId && typeof bill.companyId === 'object'
          ? bill.companyId._id
          : bill?.companyId) || selectedCompanyId || undefined;
      const response = await api.get(`/finance/accounts-payable/${bill._id}`, {
        params: billCompanyId && billCompanyId !== 'all' ? { companyId: billCompanyId } : undefined,
        headers: {
          'Cache-Control': 'no-cache',
          ...(billCompanyId && billCompanyId !== 'all'
            ? { 'x-finance-company-id': String(billCompanyId) }
            : {})
        }
      });
      if (response.data.success) {
        const b = response.data.data;
        setSelectedBill(b);
        setViewDialogOpen(true);
      } else {
        toast.error(response.data?.message || 'Failed to fetch bill details');
      }
    } catch (error) {
      console.error('Error fetching bill details:', error);
      const status = error.response?.status;
      const apiMsg = error.response?.data?.message;
      if (status === 403 || /another finance company/i.test(String(apiMsg || ''))) {
        toast.error(
          apiMsg ||
            'This bill belongs to another finance company. Switch the company selector (top of page) to the bill’s company and try again.'
        );
      } else if (status === 404) {
        toast.error(apiMsg || 'Bill not found for the selected finance company. Check the company selector.');
      } else {
        toast.error(apiMsg || error.message || 'Failed to fetch bill details');
      }
    } finally {
      setLoading(false);
    }
  };

  const mapOutstandingBillRows = (allBills, seedBillId) => {
    const rows = allBills
      .map((b) => {
        const outstanding = Math.max(0, getOutstanding(b));
        const isSelected = seedBillId ? String(b._id) === String(seedBillId) : false;
        return {
          billId: b._id,
          billNumber: b.billNumber,
          billDate: b.billDate,
          dueDate: b.dueDate,
          totalAmount: Number(b.totalAmount || 0),
          company: b.company || 'Unassigned',
          outstanding,
          payAmount: isSelected ? outstanding : 0,
          advanceApplyAmount: 0
        };
      })
      .filter((r) => r.outstanding > 0);

    // If no seedBillId matched or provided, default the first bill as selected
    if (rows.length > 0 && !rows.some((r) => r.payAmount > 0)) {
      rows[0].payAmount = rows[0].outstanding;
    }

    const totalPay = Math.round(rows.reduce((s, r) => s + (Number(r.payAmount) || 0), 0) * 100) / 100;
    setOutstandingTransactions(rows);
    setPaymentData((prev) => ({ ...prev, amount: totalPay }));
    return rows;
  };

  const loadPayeeCashApprovals = async (
    type = payeeType,
    employeeId = selectedEmployeePayee.employeeId,
    vendorId = selectedPayee.vendorId,
    employeeCode = selectedEmployeePayee.employeeCode
  ) => {
    const isEmployee = type === 'employee';
    if (isEmployee && !employeeId && !employeeCode) {
      setPayeeCashApprovals([]);
      return;
    }
    if (!isEmployee && !vendorId) {
      setPayeeCashApprovals([]);
      return;
    }
    try {
      setLoadingPayeeCashApprovals(true);
      const params = isEmployee
        ? { employeeId: employeeId || undefined, employeeCode: employeeCode || undefined }
        : { vendorId };
      const res = await api.get('/finance/accounts-payable/payee-cash-approvals', { params });
      setPayeeCashApprovals(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      setPayeeCashApprovals([]);
    } finally {
      setLoadingPayeeCashApprovals(false);
    }
  };

  const loadPayeeVendorAdvances = async (vendorId, vendorName) => {
    if (!vendorId && !vendorName) {
      setPayeeVendorAdvances([]);
      return;
    }
    try {
      const res = await api.get('/finance/accounts-payable/vendor-advance-balance', {
        params: { vendorId: vendorId || undefined, vendorName: vendorName || undefined }
      });
      setPayeeVendorAdvances(Array.isArray(res.data?.data?.advances) ? res.data.data.advances : []);
    } catch {
      setPayeeVendorAdvances([]);
    }
  };

  const getCashApprovalViewPath = (row) => {
    if (row?.originatingModule === 'general') {
      return `/general/cash-approvals/${row.cashApprovalId}`;
    }
    return `/cash-approvals/${row.cashApprovalId}/view`;
  };

  const loadOutstandingByVendor = async (vendorId, vendorName, seedBillId = null) => {
    try {
      setLoadingOutstandingTransactions(true);
      const cleanVendorName = String(vendorName || '').trim();
      const response = await api.get('/finance/accounts-payable', {
        params: { limit: 1000, search: cleanVendorName || '' }
      });
      const allBills = response.data?.data?.bills || [];
      const normName = cleanVendorName.toLowerCase();
      let filtered = allBills.filter((b) => {
        if (getBillPayeeEmployeeId(b)) return false;
        if (b.status === 'cancelled') return false;
        const bVendorId = String(b?.vendor?.vendorId || b?.vendor?._id || '');
        const bVendorName = String(b?.vendor?.name || b?.vendorName || '').toLowerCase().trim();
        const idMatch = vendorId && bVendorId && bVendorId === String(vendorId);
        const nameMatch = normName && bVendorName.includes(normName);
        return idMatch || nameMatch;
      });

      // Ensure seed bill is included if it was not in search results
      if (seedBillId && !filtered.some((b) => String(b._id) === String(seedBillId))) {
        try {
          const singleRes = await api.get(`/finance/accounts-payable/${seedBillId}`);
          if (singleRes.data?.success && singleRes.data?.data) {
            filtered = [singleRes.data.data, ...filtered];
          }
        } catch {
          // keep filtered as is
        }
      }

      mapOutstandingBillRows(filtered, seedBillId);
    } catch (e) {
      setOutstandingTransactions([]);
      toast.error('Failed to load vendor outstanding transactions');
    } finally {
      setLoadingOutstandingTransactions(false);
    }
  };

  const loadOutstandingByEmployee = async (employeeId, employeeName, seedBillId = null) => {
    try {
      setLoadingOutstandingTransactions(true);
      const response = await api.get('/finance/accounts-payable', { params: { limit: 500, search: employeeName || '' } });
      const allBills = response.data?.data?.bills || [];
      const filtered = allBills.filter((b) => {
        const empId = getBillPayeeEmployeeId(b);
        if (employeeId) return String(empId) === String(employeeId);
        const displayName = getBillPayeeEmployeeDisplayName(b) || b?.vendorName || '';
        return displayName.toLowerCase() === (employeeName || '').toLowerCase();
      });
      mapOutstandingBillRows(filtered, seedBillId);
    } catch (e) {
      setOutstandingTransactions([]);
      toast.error('Failed to load employee outstanding transactions');
    } finally {
      setLoadingOutstandingTransactions(false);
    }
  };

  const handleOpenPayment = async (bill) => {
    let b = bill;
    try {
      const response = await api.get(`/finance/accounts-payable/${bill._id}`);
      if (response.data?.success) b = response.data.data;
    } catch {
      // use list row if detail fetch fails
    }

    setSelectedBill(b);
    const outstanding = getOutstanding(b);
    const employeeId = getBillPayeeEmployeeId(b);
    const employeeName = getBillPayeeEmployeeDisplayName(b);
    const employeeCode =
      typeof b.payeeEmployee === 'object' && b.payeeEmployee?.employeeId
        ? b.payeeEmployee.employeeId
        : '';

    setPaymentData({
      amount: outstanding,
      paymentMethod: 'bank_transfer',
      reference: '',
      paymentDate: new Date().toISOString().split('T')[0],
      whtRate: 0,
      costCenter: '',
      bankAccountId: '',
      relatedPartyAccountId: ''
    });

    let vendorId = '';
    let vendorName = '';

    if (employeeId) {
      setPayeeType('employee');
      setSelectedEmployeePayee({ employeeId, employeeName, employeeCode });
      setSelectedPayee({ vendorId: '', vendorName: '' });
      setFinanceEmployees((prev) => {
        if (prev.some((e) => String(e.employeeId) === String(employeeId))) return prev;
        return [{ employeeId, employeeName, employeeCode }, ...prev];
      });
    } else {
      setPayeeType('vendor');
      vendorId = String(b?.vendor?.vendorId || b?.vendor?._id || '');
      vendorName = b?.vendor?.name || b?.vendorName || '';

      // Match vendor in payeeVendors or add temporary entry
      if (!vendorId && vendorName) {
        const found = payeeVendors.find((v) => (v.vendorName || '').toLowerCase().trim() === vendorName.toLowerCase().trim());
        if (found) vendorId = found.vendorId;
      }
      if (vendorName && (!vendorId || !payeeVendors.some((v) => String(v.vendorId) === String(vendorId)))) {
        setPayeeVendors((prev) => {
          const exists = prev.some((v) => (v.vendorName || '').toLowerCase().trim() === vendorName.toLowerCase().trim());
          if (exists) return prev;
          return [{ vendorId: vendorId || `temp_${Date.now()}`, vendorName }, ...prev];
        });
      }

      setSelectedPayee({ vendorId: vendorId || vendorName, vendorName });
      setSelectedEmployeePayee({ employeeId: '', employeeName: '', employeeCode: '' });
    }

    setCaApplyAmounts({});
    setBillPaymentFinAuth({ accountsManagerUser: null, financeControllerUser: null });
    setPaymentDialogOpen(true);

    if (employeeId) {
      await Promise.all([
        loadOutstandingByEmployee(employeeId, employeeName, b?._id),
        loadPayeeCashApprovals('employee', employeeId, '', employeeCode)
      ]);
    } else {
      await Promise.all([
        loadOutstandingByVendor(vendorId, vendorName, b?._id),
        loadPayeeCashApprovals('vendor', '', vendorId, ''),
        loadPayeeVendorAdvances(vendorId, vendorName)
      ]);
    }
  };

  const refreshPaymentDialogData = async () => {
    if (!selectedBill?._id) return;
    try {
      const refreshed = await api.get(`/finance/accounts-payable/${selectedBill._id}`);
      if (refreshed.data?.success) {
        const b = refreshed.data.data;
        setSelectedBill(b);
        const out = getOutstanding(b);
        setPaymentData((prev) => ({ ...prev, amount: out }));
      }
    } catch {
      // ignore refresh errors
    }
    if (payeeType === 'employee' && selectedEmployeePayee.employeeId) {
      await Promise.all([
        loadOutstandingByEmployee(
          selectedEmployeePayee.employeeId,
          selectedEmployeePayee.employeeName,
          selectedBill._id
        ),
        loadPayeeCashApprovals(
          'employee',
          selectedEmployeePayee.employeeId,
          '',
          selectedEmployeePayee.employeeCode
        )
      ]);
    } else if (selectedPayee.vendorId || selectedPayee.vendorName) {
      await Promise.all([
        loadOutstandingByVendor(selectedPayee.vendorId, selectedPayee.vendorName, selectedBill._id),
        loadPayeeCashApprovals('vendor', '', selectedPayee.vendorId, ''),
        loadPayeeVendorAdvances(selectedPayee.vendorId, selectedPayee.vendorName)
      ]);
    }
  };

  const employeeAdvanceApplyTotals = useMemo(() => {
    const totalCaUsage = Math.round(
      payeeCashApprovals.reduce((s, ca) => s + (Number(caApplyAmounts[ca.cashApprovalId]) || 0), 0) * 100
    ) / 100;
    const totalAllocatedToBills = Math.round(
      outstandingTransactions.reduce((s, r) => s + (Number(r.advanceApplyAmount) || 0), 0) * 100
    ) / 100;
    return {
      totalCaUsage,
      totalAllocatedToBills,
      remainingToAllocate: Math.round((totalCaUsage - totalAllocatedToBills) * 100) / 100
    };
  }, [payeeCashApprovals, caApplyAmounts, outstandingTransactions]);

  const handleApplyCaAdvanceToBill = async () => {
    if (payeeType !== 'employee' || !selectedEmployeePayee.employeeId) {
      toast.error('Cash approval apply is available for employee payees only');
      return;
    }

    const cashApprovalUsages = payeeCashApprovals
      .map((ca) => ({
        cashApprovalId: ca.cashApprovalId,
        amount: Math.round((Number(caApplyAmounts[ca.cashApprovalId]) || 0) * 100) / 100
      }))
      .filter((row) => row.amount > 0);

    const billAllocations = outstandingTransactions
      .map((row) => ({
        billId: row.billId,
        amount: Math.round((Number(row.advanceApplyAmount) || 0) * 100) / 100
      }))
      .filter((row) => row.amount > 0);

    if (!cashApprovalUsages.length) {
      toast.error('Enter amount to use on at least one cash approval');
      return;
    }
    if (!billAllocations.length) {
      toast.error('Enter apply from advance on at least one bill');
      return;
    }

    const { totalCaUsage, totalAllocatedToBills } = employeeAdvanceApplyTotals;
    if (Math.abs(totalCaUsage - totalAllocatedToBills) > 0.009) {
      if (totalAllocatedToBills < totalCaUsage) {
        toast.error(
          `Total applied to bills (${formatPKR(totalAllocatedToBills)}) is less than cash approval usage (${formatPKR(totalCaUsage)}). Allocate the full amount.`
        );
      } else {
        toast.error(
          `Total applied to bills (${formatPKR(totalAllocatedToBills)}) exceeds cash approval usage (${formatPKR(totalCaUsage)}).`
        );
      }
      return;
    }

    for (const row of billAllocations) {
      const billRow = outstandingTransactions.find((b) => String(b.billId) === String(row.billId));
      if (billRow && row.amount > (billRow.outstanding || 0) + 0.009) {
        toast.error(`${billRow.billNumber}: apply amount exceeds open balance`);
        return;
      }
    }

    const finAuthErr = validateFinanceAuthoritySelection(billPaymentFinAuth);
    if (finAuthErr) {
      toast.error(finAuthErr);
      return;
    }
    const financeApprovalAuthorities = buildFinanceApprovalAuthoritiesPayload(
      billPaymentFinAuth,
      preparerUserId
    );

    try {
      setProcessingCaApply(true);
      const response = await api.post('/finance/accounts-payable/apply-employee-advance-batch', {
        employeeId: selectedEmployeePayee.employeeId,
        cashApprovalUsages,
        billAllocations,
        financeApprovalAuthorities
      });
      if (response.data?.success) {
        toast.success(response.data.message || 'Cash approval submitted for bill(s)');
        setCaApplyAmounts({});
        await refreshPaymentDialogData();
        fetchAccountsPayable();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to apply cash approval to bill(s)');
    } finally {
      setProcessingCaApply(false);
    }
  };

  const handleRecordPayment = async () => {
    if (paymentData.amount <= 0) {
      toast.error('Payment amount must be greater than zero');
      return;
    }
    if (isIcPayingMode && !paymentData.bankAccountId) {
      toast.error('Select Pay From Account (bank/cash on the Paying company).');
      return;
    }
    if (isIcPayingMode && !paymentData.relatedPartyAccountId) {
      toast.error('Select Related Party Account on the original (bill) company.');
      return;
    }

    const finAuthErr = validateFinanceAuthoritySelection(billPaymentFinAuth);
    if (finAuthErr) {
      toast.error(finAuthErr);
      return;
    }
    const financeApprovalAuthorities = buildFinanceApprovalAuthoritiesPayload(
      billPaymentFinAuth,
      preparerUserId
    );

    try {
      setProcessingPayment(true);
      const payRows = outstandingTransactions
        .filter((r) => Number(r.payAmount) > 0)
        .map((r) => ({ ...r, payAmount: Math.round((Number(r.payAmount) || 0) * 100) / 100 }));
      if (payRows.length === 0) {
        toast.error('Enter payment amount against at least one outstanding bill');
        setProcessingPayment(false);
        return;
      }
      const billsPayload = payRows.map(row => ({
        billId: row.billId,
        amount: row.payAmount
      }));

      const payRes = await api.post('/finance/accounts-payable/batch-payment', {
        bills: billsPayload,
          paymentMethod: paymentData.paymentMethod,
        reference: paymentData.reference || '',
        narration: paymentData.narration,
          paymentDate: paymentData.paymentDate,
          whtRate: Number(paymentData.whtRate) || 0,
          bankAccountId: paymentData.bankAccountId || null,
          relatedPartyAccountId: paymentData.relatedPartyAccountId || null,
        costCenter: paymentData.costCenter || null,
        payingCompanyId: payingCompanyId || selectedCompanyId || null,
        batchId: `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          financeApprovalAuthorities
        });

      toast.success(
        payRes?.data?.message || `Consolidated batch payment submitted for ${payRows.length} bill(s) — pending finance approval`
      );
      setPaymentDialogOpen(false);
      fetchAccountsPayable();
    } catch (error) {
      console.error('Error recording payment:', error);
      toast.error(error.response?.data?.message || 'Failed to record payment');
    } finally {
      setProcessingPayment(false);
    }
  };

  const resolveBillCompanyId = (bill) => {
    if (!bill) return '';
    if (bill.companyId && typeof bill.companyId === 'object') {
      return String(bill.companyId._id || '');
    }
    if (bill.companyId) return String(bill.companyId);
    if (typeof bill.company === 'string' && bill.company.trim()) {
      const match = (financeCompanies || []).find(
        (c) => String(c.name || '').trim().toLowerCase() === bill.company.trim().toLowerCase()
      );
      if (match?._id) return String(match._id);
    }
    return '';
  };

  const loadExpenseAccountsForCompany = useCallback((companyId) => {
    const params = { limit: 500 };
    if (companyId && String(companyId).toLowerCase() !== 'all') {
      params.companyId = companyId;
    }
    api.get('/finance/accounts', { params })
      .then((res) => {
        const accs = res.data?.data?.accounts || res.data?.data || [];
        setExpenseAccounts(accs.filter((a) => String(a.type).toLowerCase().includes('expense')));
      })
      .catch(() => setExpenseAccounts([]));
  }, []);

  const handleOpenEdit = (bill) => {
    if (!canEditVendorBill(bill)) {
      toast.error('This bill cannot be edited after payment has been recorded or is pending');
      return;
    }
    setSelectedBill(bill);
    const companyId = resolveBillCompanyId(bill);
    const companyName = (bill.companyId && typeof bill.companyId === 'object' && bill.companyId.name)
      ? bill.companyId.name
      : (bill.company || '');
    setEditData({
      billNumber: bill.billNumber,
      totalAmount: bill.totalAmount,
      billDate: new Date(bill.billDate).toISOString().split('T')[0],
      dueDate: new Date(bill.dueDate).toISOString().split('T')[0],
      companyId,
      company: companyName,
      lineItems: bill.lineItems ? JSON.parse(JSON.stringify(bill.lineItems)) : []
    });
    loadExpenseAccountsForCompany(companyId || selectedCompanyId);
    setEditDialogOpen(true);
  };

  const handleVoucherCreatedClick = async (bill) => {
    try {
      const response = await api.get(`/finance/accounts-payable/${bill._id}/pending-voucher`);
      if (response.data?.journalEntryId) {
        navigate(`/finance/vouchers/${response.data.journalEntryId}`);
      }
    } catch (error) {
      toast.error('Could not find the pending voucher for this bill.');
    }
  };

  const handleUpdateBill = async () => {
    try {
      const companyMeta = (financeCompanies || []).find((c) => String(c._id) === String(editData.companyId));
      const payload = {
        ...editData,
        companyId: editData.companyId || null,
        company: companyMeta?.name || editData.company || ''
      };
      const response = await api.put(`/finance/accounts-payable/${selectedBill._id}`, payload);
      if (response.data.success) {
        toast.success('Bill updated successfully');
        setEditDialogOpen(false);
        fetchAccountsPayable();
      }
    } catch (error) {
      console.error('Error updating bill:', error);
      toast.error(error.response?.data?.message || 'Failed to update bill');
    }
  };

  const handleCreateBillFromPo = async (po) => {
    setCreateFromPoDialog({ open: true, po, billNumber: `BILL-PO-${po.orderNumber}`, creating: false });
  };

  const handleConfirmCreateFromPo = async () => {
    const { po } = createFromPoDialog;
    if (!po?._id) return;
    try {
      setCreateFromPoDialog(prev => ({ ...prev, creating: true }));
      const res = await api.post('/finance/accounts-payable/create-from-po', {
        purchaseOrderId: po._id,
        billNumber: createFromPoDialog.billNumber || undefined
      });
      if (res.data?.success) {
        toast.success('Bill created from purchase order');
        setCreateFromPoDialog({ open: false, po: null, billNumber: '', creating: false });
        fetchAccountsPayable();
        fetchPosForBilling();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create bill');
    } finally {
      setCreateFromPoDialog(prev => ({ ...prev, creating: false }));
    }
  };

  const getBillWorkflowStatusLabel = (bill) => {
    if (bill?.approvalStatus === 'Submitted') return 'PENDING DEPT APPROVAL';
    if (bill?.approvalStatus === 'Rejected') return 'DEPT REJECTED';
    if (bill?.status === 'draft' && bill?.approvalStatus === 'Approved') return 'PENDING AUDIT';
    return String(bill?.status || 'UNKNOWN').toUpperCase();
  };

  const getStatusColor = (status) => {
    const colorMap = {
      'draft': 'default',
      'received': 'info',
      'approved': 'success',
      'pending': 'warning',
      'paid': 'success',
      'overdue': 'error',
      'partial': 'info',
      'cancelled': 'default',
      'PENDING DEPT APPROVAL': 'warning',
      'DEPT REJECTED': 'error',
      'PENDING AUDIT': 'info',
      'RETURNED FROM AUDIT': 'error',
      'RETURNED FROM FINANCE': 'warning',
      'FORWARDED TO AUDIT DIRECTOR': 'primary'
    };
    return colorMap[status] || 'default';
  };

  const getStatusIcon = (status) => {
    const iconMap = {
      'draft': <AccountBalanceIcon />,
      'received': <AccountBalanceIcon />,
      'approved': <CheckCircleIcon />,
      'pending': <WarningIcon />,
      'paid': <CheckCircleIcon />,
      'overdue': <WarningIcon />,
      'partial': <TrendingDownIcon />,
      'cancelled': <AccountBalanceIcon />
    };
    return iconMap[status] || <AccountBalanceIcon />;
  };

  const getPendingCoaDeptStep = (bill) => {
    if (!bill || bill.approvalStatus !== 'Submitted') return null;
    const chain = Array.isArray(bill.approvalChain) ? bill.approvalChain : [];
    return chain.find((step) => step.status === 'pending') || null;
  };

  const canApproveCoaDeptBill = (bill) => {
    const pending = getPendingCoaDeptStep(bill);
    if (!pending?.approver) return false;
    const approverId = String(pending.approver?._id || pending.approver || '');
    return Boolean(preparerUserId && approverId && preparerUserId === approverId);
  };

  const handleCoaDepartmentApprove = async () => {
    if (!selectedBill?._id) return;
    try {
      const res = await api.post(`/finance/accounts-payable/${selectedBill._id}/department-approve`, {
        comments: 'Approved'
      });
      toast.success(res.data?.message || 'Department approval recorded');
      const refreshed = res.data?.data || null;
      if (refreshed) setSelectedBill(refreshed);
      fetchAccountsPayable();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve');
    }
  };

  const handleCoaDepartmentReject = async () => {
    if (!selectedBill?._id) return;
    const reason = window.prompt('Rejection reason');
    if (!reason || !String(reason).trim()) return;
    try {
      const res = await api.post(`/finance/accounts-payable/${selectedBill._id}/department-reject`, {
        rejectionReason: String(reason).trim()
      });
      toast.success(res.data?.message || 'Bill rejected');
      const refreshed = res.data?.data || null;
      if (refreshed) setSelectedBill(refreshed);
      fetchAccountsPayable();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reject');
    }
  };

  const getAgingColor = (days) => {
    if (days <= 30) return 'success';
    if (days <= 60) return 'warning';
    return 'error';
  };

  const formatGRNDate = (d) => {
    if (!d) return '';
    const x = new Date(d);
    const days = String(x.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days}-${months[x.getMonth()]}-${x.getFullYear()}`;
  };
  const formatGRNNumber = (n) => (n == null || n === '') ? '' : Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatDateForPrint = (date) => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '/');
  };
  const toggleExpandRow = (billId) => {
    setExpandedRows((prev) => ({ ...prev, [billId]: !prev[billId] }));
  };

  if (initialLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>Loading Accounts Payable...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.1)} 0%, ${alpha(theme.palette.warning.main, 0.1)} 100%)` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: theme.palette.error.main }}>
              <ShoppingCartIcon />
            </Avatar>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.error.main }}>
                Accounts Payable
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Manage vendor bills and payments
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <FinanceCompanySelector minWidth={240} showHelper={false} />
            <Button variant="outlined" size="small" color="info"
              onClick={() => navigate('/finance/vendor-advance')} sx={{ fontSize: 12 }}>
              Vendor advance
            </Button>
            <Button variant="outlined" size="small" color="primary"
              onClick={() => navigate('/finance/vendor-payments')} sx={{ fontSize: 12 }}>
              Payments
            </Button>
            <Button variant="outlined" size="small" color="error"
              onClick={() => navigate('/finance/vendor-refunds')} sx={{ fontSize: 12 }}>
              Refunds
            </Button>
            <Button variant="outlined" size="small" color="warning"
              onClick={() => navigate('/finance/bill-to-receive')} sx={{ fontSize: 12 }}>
              Bill to Receive
            </Button>
            <Button variant="outlined" size="small"
              onClick={() => navigate('/finance/billed-not-received')} sx={{ fontSize: 12 }}>
              Billed Not Received
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={fetchAccountsPayable}
            >
              Refresh
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => toast.success('Export functionality coming soon')}
            >
              Export
            </Button>
            <Button
              variant="contained"
              color="success"
              startIcon={<PaymentIcon />}
              onClick={() => setPayBillsModalOpen(true)}
              sx={{ fontWeight: 700 }}
            >
              Pay Bills (Multi-Bill)
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/finance/accounts-payable/new')}
            >
              New Bill
            </Button>
          </Box>
        </Box>

        {/* Filters */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              fullWidth
              type="date"
              label="Start Date"
              value={filters.startDate}
              onChange={handleFilterChange('startDate')}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              fullWidth
              type="date"
              label="End Date"
              value={filters.endDate}
              onChange={handleFilterChange('endDate')}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={filters.status}
                onChange={handleFilterChange('status')}
                label="Status"
              >
                <MenuItem value="">All Status</MenuItem>
                <MenuItem value="unpaid">Unpaid / Unsettled</MenuItem>
                <MenuItem value="pending_dept_approval">Pending Dept Approval</MenuItem>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="received">Received</MenuItem>
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="partial">Partial</MenuItem>
                <MenuItem value="paid">Paid</MenuItem>
                <MenuItem value="overdue">Overdue</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Bill Type</InputLabel>
              <Select
                value={filters.billType}
                onChange={handleFilterChange('billType')}
                label="Bill Type"
              >
                <MenuItem value="">All Bill Types</MenuItem>
                <MenuItem value="category">Chart of Accounts</MenuItem>
                <MenuItem value="store">Centralized Store</MenuItem>
                <MenuItem value="po">PO / GRN</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              fullWidth
              label="Vendor"
              value={vendorInput}
              onChange={(e) => setVendorInput(e.target.value)}
              placeholder="Search vendors"
              size="small"
              InputProps={{
                endAdornment: vendorInput ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setVendorInput('');
                        setFilters((prev) => ({ ...prev, vendor: '' }));
                        setPagination((prev) => ({ ...prev, currentPage: 1 }));
                      }}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null
              }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              fullWidth
              label="Search All Columns"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setFilters((prev) => ({ ...prev, search: searchInput }));
                  setPagination((prev) => ({ ...prev, currentPage: 1 }));
                }
              }}
              placeholder="Search bills..."
              size="small"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: searchInput ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setSearchInput('');
                        setFilters((prev) => ({ ...prev, search: '' }));
                        setPagination((prev) => ({ ...prev, currentPage: 1 }));
                      }}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null
              }}
            />
          </Grid>
        </Grid>
      </Paper>

      {/* POs for Billing */}
      {posForBilling.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <ShoppingCartIcon /> POs for Billing (Create Bill from Purchase Order)
            </Typography>
            {loadingPosForBilling ? (
              <LinearProgress sx={{ mb: 2 }} />
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>PO Number</strong></TableCell>
                      <TableCell><strong>Vendor</strong></TableCell>
                      <TableCell><strong>Indent</strong></TableCell>
                      <TableCell align="right"><strong>Amount</strong></TableCell>
                      <TableCell align="center"><strong>Action</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {posForBilling.map((po) => (
                      <TableRow key={po._id}>
                        <TableCell>{po.orderNumber}</TableCell>
                        <TableCell>{po.vendor?.name || 'N/A'}</TableCell>
                        <TableCell>{po.indent?.indentNumber || 'N/A'}</TableCell>
                        <TableCell align="right">{formatPKR(po.totalAmount)}</TableCell>
                        <TableCell align="center">
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => handleCreateBillFromPo(po)}
                          >
                            Create Bill
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* Utility due today / overdue warning */}
      <Dialog
        open={utilityDueWarningOpen}
        onClose={dismissUtilityDueWarning}
        maxWidth="md"
        fullWidth
        aria-labelledby="utility-due-warning-title"
      >
        <DialogTitle id="utility-due-warning-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 6, position: 'relative' }}>
          <Avatar sx={{ bgcolor: 'warning.main' }}>
            <WarningIcon />
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              Utility Bills Due Today / Overdue
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {(summary.dueUtilityWarnings || []).length} unpaid Centralized Store bill
              {(summary.dueUtilityWarnings || []).length === 1 ? '' : 's'} need attention
            </Typography>
          </Box>
          <IconButton
            aria-label="close"
            onClick={dismissUtilityDueWarning}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            These utility bills are due today or already past due. This warning will keep appearing when you open Vendor Bills until they are paid.
          </Alert>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Bill #</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Vendor</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Due Date</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Bill Amount</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>After Due Date</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Outstanding</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(summary.dueUtilityWarnings || []).map((row) => (
                  <TableRow key={row._id || row.billNumber} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{row.billNumber}</TableCell>
                    <TableCell>{row.vendorName || '—'}</TableCell>
                    <TableCell>{row.dueDate ? formatDate(row.dueDate) : '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={row.urgency === 'overdue' ? 'Overdue' : 'Due Today'}
                        color={row.urgency === 'overdue' ? 'error' : 'warning'}
                        sx={{ fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell align="right">{formatPKR(row.totalAmount)}</TableCell>
                    <TableCell align="right">
                      {Number(row.duePaymentAmount) > 0 ? formatPKR(row.duePaymentAmount) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>
                      {formatPKR(row.outstandingAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={dismissUtilityDueWarning} color="inherit">
            Dismiss for now
          </Button>
          <Button variant="contained" color="warning" onClick={viewUtilityDueWarningBills} startIcon={<ViewIcon />}>
            View utility bills
          </Button>
        </DialogActions>
      </Dialog>

      {/* Pending Utility Bills — full company count (all pages) */}
      <Card
        sx={{
          mb: 3,
          cursor: 'pointer',
          border: '1px solid',
          borderColor: (summary.pendingUtilityBills || 0) > 0 ? 'warning.main' : 'divider',
          bgcolor: (summary.pendingUtilityBills || 0) > 0
            ? alpha(theme.palette.warning.main, 0.08)
            : 'background.paper',
          transition: 'box-shadow 0.2s',
          '&:hover': { boxShadow: 3 }
        }}
        onClick={() => {
          setFilters((prev) => ({
            ...prev,
            status: 'unpaid',
            billType: 'store',
            startDate: '',
            endDate: '',
            search: ''
          }));
          setSearchInput('');
          setPagination((prev) => ({ ...prev, currentPage: 1 }));
        }}
      >
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
            <Box>
              <Typography color="textSecondary" variant="body2" sx={{ fontWeight: 600 }}>
                Pending Utility Bills
              </Typography>
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  color: (summary.pendingUtilityBills || 0) > 0 ? 'warning.dark' : 'text.primary',
                  lineHeight: 1.2
                }}
              >
                {summary.pendingUtilityBills || 0}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Unpaid Centralized Store / utility bills across all pages — click to filter
              </Typography>
            </Box>
            <Avatar sx={{ bgcolor: 'warning.main', width: 48, height: 48 }}>
              <WarningIcon />
            </Avatar>
          </Box>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography color="textSecondary" gutterBottom variant="body2">
                    Total Outstanding
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'warning.main' }}>
                    {formatPKR(summary.totalOutstanding)}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    {summary.totalBills} bills
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'warning.main' }}>
                  <ShoppingCartIcon />
                </Avatar>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography color="textSecondary" gutterBottom variant="body2">
                    Overdue Amount
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                    {formatPKR(summary.totalOverdue)}
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'error.main' }}>
                  <WarningIcon />
                </Avatar>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography color="textSecondary" gutterBottom variant="body2">
                    Total Paid
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                    {formatPKR(summary.totalPaid)}
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'success.main' }}>
                  <CheckCircleIcon />
                </Avatar>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography color="textSecondary" gutterBottom variant="body2">
                    Total Bills
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                    {summary.totalBills}
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: theme.palette.primary.main }}>
                  <AccountBalanceIcon />
                </Avatar>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Accounts Payable Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Bill Details
          </Typography>
          {loading && <LinearProgress sx={{ height: 4, mb: 1.5, borderRadius: 1 }} />}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell>Bill #</TableCell>
                  <TableCell>Bill Type</TableCell>
                  <TableCell>Vendor</TableCell>
                  <TableCell>Company</TableCell>
                  <TableCell>Department</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell sx={{ minWidth: 180, maxWidth: 280 }}>Narration / Description</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Outstanding</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Aging</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredBills.map((bill) => {
                  const days = calculateAge(bill.billDate);
                  const outstanding = getOutstanding(bill);
                  const grnSettlementRows = getLinkedGrnSettlementRows(bill);
                  return (
                    <React.Fragment key={bill._id}>
                      <TableRow hover>
                        <TableCell sx={{ width: 48 }}>
                          <IconButton size="small" onClick={() => toggleExpandRow(bill._id)}>
                            {expandedRows[bill._id] ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                          </IconButton>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                            {bill.billNumber}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {getBillTypeBadge(bill)}
                        </TableCell>
                        <TableCell>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                              {bill.vendorName || 'Unknown Vendor'}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              {bill.vendorEmail}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell><Typography variant="body2" fontWeight={600}>{getBillCompany(bill)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{getBillDepartment(bill)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{getBillProject(bill)}</Typography></TableCell>
                        <NarrationTableCell text={getBillNarrationDisplay(bill)} />
                        <TableCell><Typography variant="body2">{formatDate(bill.billDate)}</Typography></TableCell>
                        <TableCell><Typography variant="body2">{formatDate(bill.dueDate)}</Typography></TableCell>
                        <TableCell align="right"><Typography variant="body2" sx={{ fontWeight: 'bold' }}>{formatPKR(bill.totalAmount)}</Typography></TableCell>
                        <TableCell align="right"><Typography variant="body2" sx={{ fontWeight: 'bold', color: 'success.main' }}>{formatPKR(getSettledAmount(bill))}</Typography></TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" sx={{ fontWeight: 'bold', color: outstanding > 0 ? 'warning.main' : 'success.main' }}>
                            {formatPKR(outstanding)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getBillWorkflowStatusLabel(bill)}
                            size="small"
                            color={getStatusColor(getBillWorkflowStatusLabel(bill))}
                            icon={getStatusIcon(bill.status)}
                          />
                          {getSettlementPending(bill) > 0 ? (
                            <Chip label="Pending approval" size="small" color="warning" variant="outlined" sx={{ ml: 0.5 }} />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Chip label={`${days} days`} size="small" color={getAgingColor(days)} />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Tooltip title="View Details"><IconButton size="small" onClick={() => handleViewBill(bill)}><ViewIcon fontSize="small" /></IconButton></Tooltip>
                            {getSettlementPending(bill) > 0 && (
                              <Tooltip title="View Pending Voucher">
                                <Chip onClick={() => handleVoucherCreatedClick(bill)} label="VOUCHER CREATED" size="small" color="success" variant="filled" sx={{ height: 26, fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer' }} />
                              </Tooltip>
                            )}
                            {bill.status !== 'paid'
                              && outstanding > 0
                              && bill.status !== 'draft'
                              && !['Pending Audit', 'Forwarded to Audit Director', 'Returned from Audit', 'Returned from Finance'].includes(bill.status)
                              && bill.approvalStatus !== 'Submitted'
                              && bill.approvalStatus !== 'Rejected' && (
                              <Tooltip title="Make Payment">
                                <IconButton size="small" color="success" onClick={() => handleOpenPayment(bill)}>
                                  <PaymentIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canFinanceReturnBill(bill) && (
                              <Tooltip title="Reject / return to initiator (approval authorities stay intact)">
                                <IconButton size="small" color="error" onClick={() => handleFinanceReturnBill(bill)}>
                                  <UndoIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            {bill.status === 'Returned from Audit' && (
                              <Tooltip title="Resubmit to Pre-Audit">
                                <IconButton size="small" color="warning" onClick={() => handleResubmitToAudit(bill)}>
                                  <RefreshIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canResubmitToFinance(bill) && (
                              <Tooltip title="Resubmit to Finance (no re-approval needed)">
                                <IconButton size="small" color="primary" onClick={() => handleResubmitToFinance(bill)}>
                                  <SendIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title={canEditVendorBill(bill) ? 'Edit Bill' : 'Cannot edit after payment / while in audit'}>
                              <span>
                                <IconButton size="small" onClick={() => handleOpenEdit(bill)} disabled={!canEditVendorBill(bill)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={bill.amountPaid > 0 ? 'Cannot delete bill with recorded payments' : 'Delete Bill'}>
                              <span>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => handleOpenDelete(bill)}
                                  disabled={bill.amountPaid > 0}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      </TableRow>
                      {expandedRows[bill._id] && (
                        <TableRow>
                          <TableCell />
                          <TableCell colSpan={13} sx={{ bgcolor: 'grey.50' }}>
                            <Box sx={{ py: 1 }}>
                              <Typography variant="subtitle2" sx={{ mb: 1 }}>Linked Documents</Typography>
                              {bill?.linkedGRNs?.length ? (
                                <Table size="small">
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>GRN</TableCell>
                                      <TableCell>PO</TableCell>
                                      <TableCell align="right">Bill Portion</TableCell>
                                      <TableCell align="right">Paid</TableCell>
                                      <TableCell align="right">Remaining</TableCell>
                                      <TableCell>Progress</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {grnSettlementRows.map((row, idx) => {
                                      const { ln, portion, paid, remainingByGrn, pct } = row;
                                      return (
                                        <TableRow key={`${bill._id}-grn-${idx}`}>
                                          <TableCell>{ln?.grnNumber || '—'}</TableCell>
                                          <TableCell>{ln?.poNumber || '—'}</TableCell>
                                          <TableCell align="right">{formatPKR(portion)}</TableCell>
                                          <TableCell align="right">{formatPKR(paid)}</TableCell>
                                          <TableCell align="right">{formatPKR(remainingByGrn)}</TableCell>
                                          <TableCell sx={{ minWidth: 180 }}>
                                            <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4, mb: 0.5 }} />
                                            <Typography variant="caption" color="text.secondary">{pct}% paid</Typography>
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              ) : (
                                <Typography variant="body2" color="text.secondary">No GRN linkage found for this bill.</Typography>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {filteredBills.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="h6" color="textSecondary">
                {searchInput || filters.search || vendorInput || filters.vendor || (filters.status && filters.status !== 'unpaid') || filters.billType
                  ? 'No matching bills found'
                  : 'No bills found'}
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                {searchInput || filters.search || vendorInput || filters.vendor || (filters.status && filters.status !== 'unpaid') || filters.billType
                  ? 'Try adjusting your search terms or filters'
                  : 'Create your first bill to get started'}
              </Typography>
              {searchInput || filters.search || vendorInput || filters.vendor || (filters.status && filters.status !== 'unpaid') || filters.billType ? (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    setSearchInput('');
                    setVendorInput('');
                    setFilters((prev) => ({
                      ...prev,
                      search: '',
                      vendor: '',
                      status: 'unpaid',
                      billType: ''
                    }));
                    setPagination((prev) => ({ ...prev, currentPage: 1 }));
                  }}
                >
                  Reset Search & Filters
                </Button>
              ) : (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/finance/accounts-payable/new')}
              >
                Create First Bill
              </Button>
              )}
            </Box>
          )}

          <TablePagination
            component="div"
            count={pagination.totalCount}
            page={Math.max(0, pagination.currentPage - 1)}
            onPageChange={handlePageChange}
            rowsPerPage={pagination.limit}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[25, 50, 100, 250, 500]}
          />
        </CardContent>
      </Card>

      {/* Bill Details Dialog */}
      <Dialog 
        open={viewDialogOpen} 
        onClose={() => setViewDialogOpen(false)}
        maxWidth={selectedBill?.referenceType === 'purchase_order' ? 'lg' : 'md'}
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" component="div">
              {selectedBill && (selectedBill.referenceType === 'utility_bill' || selectedBill.module === 'taj_utilities')
                ? `${getCentralizedStoreDocumentTypeLabel(selectedBill)} Details: ${selectedBill?.billNumber || ''}`
                : `Bill Details: ${selectedBill?.billNumber || ''}`}
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ fontWeight: 'bold' }}>
              Company: {selectedBill ? getBillCompany(selectedBill) : '—'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {selectedBill && (
              <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={<PrintIcon />}
                onClick={() => navigate(`/finance/bill-print/${selectedBill._id}`)}
              >
                Print
              </Button>
            )}
          <IconButton onClick={() => setViewDialogOpen(false)}>
            <CloseIcon />
          </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {selectedBill && (() => {
            const isChartOfAccountsBill = selectedBill?.referenceType === 'manual' || selectedBill?.module === 'finance' || (!selectedBill?.referenceType && selectedBill?.lineItems?.length > 0);
            const isNonPOBill = selectedBill?.referenceType === 'store' || selectedBill?.referenceType === 'utility_bill' || selectedBill?.module === 'taj_utilities' || isChartOfAccountsBill;
            return (
              <>
                <Tabs
                  value={billViewTab}
                  onChange={(_, v) => setBillViewTab(v)}
                  sx={{ px: 2, pt: 1, borderBottom: 1, borderColor: 'divider', mb: 2 }}
                  variant="scrollable"
                  scrollButtons="auto"
                >
                  <Tab value={0} label="Vendor Bill" />
                  {!isNonPOBill && <Tab value={1} label={selectedBill?.poDetail?.indent ? 'Indent' : 'Indent'} />}
                  {!isNonPOBill && <Tab value={2} label={`Quotations (${selectedBill?.poDetail?.quotations?.length || 0})`} />}
                  {!isNonPOBill && <Tab value={3} label="Comparative Statement" />}
                  {!isNonPOBill && <Tab value={4} label={selectedBill?.poDetail?.po ? 'Purchase Order' : 'PO'} />}
                  {!isNonPOBill && <Tab value={5} label={(selectedBill?.poDetail?.grns?.length || 0) > 0 ? `GRN(s) (${selectedBill.poDetail.grns.length})` : 'GRN(s)'} />}
                  <Tab value={6} label="Payment History" />
                  <Tab
                    value={7}
                    label={`Workflow History${
                      (selectedBill?.fullWorkflowHistory || selectedBill?.workflowHistory || []).length
                        ? ` (${(selectedBill.fullWorkflowHistory || selectedBill.workflowHistory || []).length})`
                        : ''
                    }`}
                  />
                </Tabs>

                {/* Tab 0: Vendor Bill & Approval Authorities */}
                {billViewTab === 0 && (
                  <Box sx={{ p: 2 }}>
                    {(selectedBill?.referenceType === 'utility_bill' || selectedBill?.module === 'taj_utilities') && (
                      <Box sx={{ textAlign: 'center', mb: 2.5 }}>
                        <Typography
                          variant="h5"
                          sx={{
                            fontFamily: 'Arial, Helvetica, sans-serif',
                            fontWeight: 700,
                            fontSize: { xs: 20, md: 22 },
                            textTransform: 'none',
                            letterSpacing: 0.2
                          }}
                        >
                          {getStoreInvoiceOrgTitle({
                            ...selectedBill,
                            site: selectedBill.site || getBillCompany(selectedBill),
                            provider: selectedBill.vendorName || selectedBill.vendor?.name
                          })}
                  </Typography>
                        <Typography
                          variant="h6"
                          sx={{
                            fontFamily: 'Arial, Helvetica, sans-serif',
                            fontWeight: 700,
                            fontSize: { xs: 16, md: 18 },
                            mt: 0.5
                          }}
                        >
                          {getCentralizedStoreDocumentTypeLabel(selectedBill)}
                        </Typography>
                      </Box>
                    )}
                    <CentralizedStoreBillInvoiceBody
                      bill={{
                        ...selectedBill,
                        billId: selectedBill.billNumber,
                        billDate: selectedBill.billDate,
                        createdAt: selectedBill.createdAt || selectedBill.billDate,
                        provider: selectedBill.vendorName || selectedBill.vendor?.name,
                        location: getBillInvoiceLocation(selectedBill),
                        notes: selectedBill.notes || selectedBill.internalNotes || getBillNarrationDisplay(selectedBill),
                        forWhat: selectedBill.forWhat || getBillNarrationDisplay(selectedBill),
                        duePaymentAmount: getDuePaymentAmountFromBill(selectedBill),
                        billLines: (selectedBill.lineItems && selectedBill.lineItems.length > 0)
                          ? selectedBill.lineItems.map((line, idx) => {
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
                              amount: line.amount || (line.quantity * line.unitPrice),
                              duePaymentAmount: getLineDuePaymentAmount(selectedBill, line, idx),
                              attachments: idx === 0 && selectedBill.attachments?.length ? selectedBill.attachments.map(a => ({ url: a.path || a.filename, originalName: a.originalName })) : undefined
                            };
                          })
                          : (selectedBill.billLines || [])
                      }}
                      showChargesSummary={true}
                    />

                    {canApproveCoaDeptBill(selectedBill) && (
                      <Alert severity="info" sx={{ mb: 2 }}
                        action={
                          <Stack direction="row" spacing={1}>
                            <Button color="success" size="small" variant="contained" onClick={handleCoaDepartmentApprove}>
                              Approve
                            </Button>
                            <Button color="error" size="small" variant="outlined" onClick={handleCoaDepartmentReject}>
                              Reject
                            </Button>
                          </Stack>
                        }
                      >
                        You are the pending department approval authority
                        {getPendingCoaDeptStep(selectedBill)?.roleLabel
                          ? ` (${getPendingCoaDeptStep(selectedBill).roleLabel})`
                          : ''} for this Chart of Accounts bill.
                      </Alert>
                    )}

                    {canFinanceReturnBill(selectedBill) && (
                      <Alert severity="warning" sx={{ mb: 2 }}
                        action={
                          <Button color="error" size="small" variant="contained" onClick={() => handleFinanceReturnBill(selectedBill)}>
                            Reject to Initiator
                          </Button>
                        }
                      >
                        Return this bill to the initiator for correction. Department approval authorities stay intact — after edit &amp; resubmit it comes straight back to Finance.
                      </Alert>
                    )}

                    {selectedBill?.status === 'Returned from Finance' && (
                      <Alert severity="info" sx={{ mb: 2 }}
                        action={
                          canResubmitToFinance(selectedBill) ? (
                            <Stack direction="row" spacing={1}>
                              {canEditVendorBill(selectedBill) && (
                                <Button size="small" variant="outlined" onClick={() => handleOpenEdit(selectedBill)}>
                                  Edit
                                </Button>
                              )}
                              <Button color="primary" size="small" variant="contained" onClick={() => handleResubmitToFinance(selectedBill)}>
                                Resubmit to Finance
                              </Button>
                            </Stack>
                          ) : null
                        }
                      >
                        Returned from Finance for correction
                        {Array.isArray(selectedBill.observations) && selectedBill.observations.filter((o) => !o.resolved).length
                          ? `: ${(selectedBill.observations.filter((o) => !o.resolved).map((o) => o.observation).filter(Boolean).slice(-1)[0]) || ''}`
                          : '.'}
                        {' '}Approval authorities remain unchanged.
                      </Alert>
                    )}

                    {/* Approval Authority Table — Rendered for All Vendor Bills */}
                    {(() => {
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
                        const isCentralizedStore = selectedBill?.referenceType === 'utility_bill' || selectedBill?.module === 'taj_utilities';
                        const srcBill = selectedBill?.sourceUtilityBill;

                        // ─── 1. Sig of Requester ───
                        // For Centralized Store: the requester is on the source utility bill
                        const requester = (isCentralizedStore && srcBill?.createdBy) ? srcBill.createdBy : selectedBill?.createdBy;
                        const requesterDate = (isCentralizedStore && srcBill?.createdAt) ? srcBill.createdAt : selectedBill?.createdAt;
                        rows.push({
                          authority: 'Sig of Requester',
                          name: userDisplayName(requester),
                          signatureUser: requester || null,
                          signaturePath: requester?.digitalSignature || '',
                          dateTime: requesterDate ? formatDateTime(requesterDate) : '-'
                        });

                        // ─── 2. Department Approval Authorities ───
                        // Centralized Store: sourceUtilityBill.approvalChain (Manager / HOD / optional Sr Manager / AVP Taj)
                        // Chart of Accounts bills: bill.approvalChain (Sr Manager Finance / GM Finance)
                        if (isCentralizedStore && srcBill) {
                          const approvalChain = Array.isArray(srcBill.approvalChain) ? srcBill.approvalChain : [];
                          if (approvalChain.length > 0) {
                            approvalChain.forEach((step, idx) => {
                              if (step.status === 'approved' && step.approver) {
                                rows.push({
                                  authority: getApprovalRoleLabel(step.role, idx),
                                  name: userDisplayName(step.approver),
                                  signatureUser: step.approver || null,
                                  signaturePath: step.approver?.digitalSignature || '',
                                  dateTime: step.actedAt ? formatDateTime(step.actedAt) : '-'
                                });
                              }
                            });
                          }
                          // Fallback: if no approvalChain but approvedBy exists
                          if (approvalChain.length === 0 && srcBill.approvedBy) {
                            rows.push({
                              authority: 'Manager / HOD Approver',
                              name: userDisplayName(srcBill.approvedBy),
                              signatureUser: srcBill.approvedBy || null,
                              signaturePath: srcBill.approvedBy?.digitalSignature || '',
                              dateTime: srcBill.approvedAt ? formatDateTime(srcBill.approvedAt) : '-'
                            });
                          }
                        } else if (isChartOfAccountsBill) {
                          const coaChain = Array.isArray(selectedBill?.approvalChain) ? selectedBill.approvalChain : [];
                          if (coaChain.length > 0) {
                            coaChain.forEach((step, idx) => {
                              const label = step.roleLabel || (idx === 0 ? 'Sr Manager Finance' : 'GM Finance');
                              rows.push({
                                authority: label,
                                name: step.approver ? userDisplayName(step.approver) : '-',
                                signatureUser: step.status === 'approved' ? (step.approver || null) : null,
                                signaturePath: step.status === 'approved' ? (step.approver?.digitalSignature || '') : '',
                                dateTime: step.actedAt ? formatDateTime(step.actedAt) : (step.status === 'pending' ? 'Pending' : '-')
                              });
                            });
                          }
                        }

                        // ─── 3. Pre-Audit Authority & 4. Audit Director ───
                        // For Centralized Store: audit workflow entries are on the source utility bill's workflowHistory
                        // For other bill types: they are on the AP bill's own workflowHistory
                        const auditHistory = (isCentralizedStore && srcBill && Array.isArray(srcBill.workflowHistory) && srcBill.workflowHistory.length > 0)
                          ? [...srcBill.workflowHistory]
                          : (Array.isArray(selectedBill?.workflowHistory) ? [...selectedBill.workflowHistory] : []);

                        const preAuditEntry = [...auditHistory].reverse().find((e) =>
                          e.toStatus === 'Forwarded to Audit Director' ||
                          e.toStatus === 'initial audit approval' ||
                          e.toStatus === 'Initial Pre-Audit Approved' ||
                          e.toStatus?.includes('Pre-Audit') ||
                          e.toStatus === 'Send to Audit'
                        );
                        const directorEntry = [...auditHistory].reverse().find((e) =>
                          e.toStatus === 'approved' ||
                          e.toStatus === 'Approved' ||
                          e.toStatus?.includes('Audit Director') ||
                          e.toStatus?.startsWith('Approved (from')
                        );

                        rows.push({
                          authority: 'Pre-Audit Authority',
                          name: userDisplayName(preAuditEntry?.changedBy),
                          signatureUser: preAuditEntry?.changedBy || null,
                          signaturePath: preAuditEntry?.stampUsed && preAuditEntry?.stampImage ? preAuditEntry.stampImage : (preAuditEntry?.changedBy?.digitalSignature || ''),
                          dateTime: preAuditEntry?.changedAt ? formatDateTime(preAuditEntry.changedAt) : '-'
                        });

                        rows.push({
                          authority: 'Audit Director',
                          name: userDisplayName(directorEntry?.changedBy),
                          signatureUser: directorEntry?.changedBy || null,
                          signaturePath: directorEntry?.stampUsed && directorEntry?.stampImage ? directorEntry.stampImage : (directorEntry?.changedBy?.digitalSignature || ''),
                          dateTime: directorEntry?.changedAt ? formatDateTime(directorEntry.changedAt) : '-'
                        });

                        // ─── 5. Finance Authority ───
                        if (Array.isArray(selectedBill?.financeApprovalAuthorities) && selectedBill.financeApprovalAuthorities.length > 0) {
                          selectedBill.financeApprovalAuthorities.forEach((auth) => {
                            rows.push({
                              authority: auth.levelName || auth.levelKey || 'Finance Authority',
                              name: auth.assignedUser ? userDisplayName(auth.assignedUser) : (auth.userName || '-'),
                              signatureUser: auth.assignedUser || null,
                              signaturePath: auth.digitalSignature || auth.assignedUser?.digitalSignature || '',
                              dateTime: auth.actedAt ? formatDateTime(auth.actedAt) : '-'
                            });
                          });
                        } else {
                          rows.push({
                            authority: 'Finance Authority',
                            name: userDisplayName(selectedBill?.approval?.approvedBy),
                            signatureUser: selectedBill?.approval?.approvedBy || null,
                            dateTime: selectedBill?.approval?.approvedDate ? formatDateTime(selectedBill.approval.approvedDate) : '-'
                          });
                        }

                        return rows;
                      };
                      const getSignatureSource = (row) => row?.signaturePath || row?.signatureUser?.digitalSignature || '';
                      return (
                        <Table
                          size="small"
                          sx={{
                            mt: 4,
                            mb: 2,
                            border: '1px solid',
                            borderColor: 'grey.300',
                            '& th': {
                              bgcolor: 'grey.100',
                              fontWeight: 800,
                              fontSize: 14,
                              borderBottom: '1px solid',
                              borderColor: 'grey.300'
                            },
                            '& td': {
                              fontSize: 14,
                              borderBottom: '1px solid',
                              borderColor: 'grey.200',
                              py: 1.4
                            },
                            '& tr:last-child td': {
                              borderBottom: 0
                            }
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
                            {getApprovalRows().map((row) => (
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
                      );
                    })()}
                </Box>
              )}

                {/* Tab 1: Indent */}
                {billViewTab === 1 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }} className="print-content">
                    {!selectedBill?.poDetail?.indent ? (
                      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Indent linked to this Vendor Bill.</Typography>
                    ) : (
                      <Paper sx={{ p: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none' }}>
                        <Typography variant="h5" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1 }}>
                          Purchase Request Form
                        </Typography>
                        {selectedBill.poDetail.indent.title && (
                          <Typography variant="h6" fontWeight={600} align="center" sx={{ mb: 2 }}>{selectedBill.poDetail.indent.title}</Typography>
                        )}
                        <Box sx={{ mb: 1.5, fontSize: '0.9rem', textAlign: 'center' }}>
                          <Typography component="span" fontWeight={600}>ERP Ref:</Typography>
                          <Typography component="span" sx={{ ml: 1 }}>{selectedBill.poDetail.indent.erpRef || 'PR #' + (selectedBill.poDetail.indent.indentNumber?.split('-').pop() || '')}</Typography>
                        </Box>
                        <Box sx={{ mb: 1.5, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <Box><Typography component="span" fontWeight={600}>Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(selectedBill.poDetail.indent.requestedDate)}</Typography></Box>
                          <Box><Typography component="span" fontWeight={600}>Required Date:</Typography><Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(selectedBill.poDetail.indent.requiredDate) || '—'}</Typography></Box>
                          <Box><Typography component="span" fontWeight={600}>Indent No.:</Typography><Typography component="span" sx={{ ml: 1 }}>{selectedBill.poDetail.indent.indentNumber || '—'}</Typography></Box>
                        </Box>
                        <Box sx={{ mb: 3, fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <Box><Typography component="span" fontWeight={600}>Department:</Typography><Typography component="span" sx={{ ml: 1 }}>{selectedBill.poDetail.indent.department?.name || selectedBill.poDetail.indent.department || '—'}</Typography></Box>
                          <Box><Typography component="span" fontWeight={600}>Originator:</Typography><Typography component="span" sx={{ ml: 1 }}>{selectedBill.poDetail.indent.requestedBy?.firstName && selectedBill.poDetail.indent.requestedBy?.lastName ? `${selectedBill.poDetail.indent.requestedBy.firstName} ${selectedBill.poDetail.indent.requestedBy.lastName}` : selectedBill.poDetail.indent.requestedBy?.name || '—'}</Typography></Box>
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
                              {(selectedBill.poDetail.indent.items || []).map((item, idx) => (
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
                        {selectedBill.poDetail.indent.justification && (
                          <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Justification:</Typography>
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>{selectedBill.poDetail.indent.justification}</Typography>
                          </Box>
                        )}
                        {/* Approval Authorities for Indent */}
                        <Box sx={{ mt: 3 }}>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                            Approval Authorities (Indent)
                          </Typography>
                          <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.100' }}>
                                  <TableCell sx={{ fontWeight: 800 }}>Authority</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Name</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Status</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Date &amp; Time</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }} align="center">Digital Signature</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {(() => {
                                  const ind = selectedBill.poDetail.indent;
                                  const formatDt = (d) => d ? new Date(d).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
                                  const userNm = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.name || '-';
                                  const reqUser = ind.requestedBy;
                                  const compApprovals = ind.comparativeStatementApprovals || {};

                                  const rows = [
                                    { authority: 'Requester / Originator', name: userNm(reqUser), status: 'Submitted', dateTime: formatDt(ind.requestedDate || ind.createdAt), user: reqUser },
                                    { authority: 'Prepared By', name: userNm(compApprovals.preparedByUser), status: compApprovals.preparedByUser ? 'Approved' : 'Pending', dateTime: formatDt(compApprovals.preparedAt), user: compApprovals.preparedByUser },
                                    { authority: 'Verified By', name: userNm(compApprovals.verifiedByUser), status: compApprovals.verifiedByUser ? 'Approved' : 'Pending', dateTime: formatDt(compApprovals.verifiedAt), user: compApprovals.verifiedByUser },
                                    { authority: 'Authorised Rep', name: userNm(compApprovals.authorisedRepUser), status: compApprovals.authorisedRepUser ? 'Approved' : 'Pending', dateTime: formatDt(compApprovals.authorisedRepAt), user: compApprovals.authorisedRepUser },
                                    { authority: 'Finance Rep', name: userNm(compApprovals.financeRepUser), status: compApprovals.financeRepUser ? 'Approved' : 'Pending', dateTime: formatDt(compApprovals.financeRepAt), user: compApprovals.financeRepUser },
                                    { authority: 'Manager Procurement', name: userNm(compApprovals.managerProcurementUser), status: compApprovals.managerProcurementUser ? 'Approved' : 'Pending', dateTime: formatDt(compApprovals.managerProcurementAt), user: compApprovals.managerProcurementUser }
                                  ];

                                  return rows.map((r, i) => (
                                    <TableRow key={i}>
                                      <TableCell sx={{ fontWeight: 700 }}>{r.authority}</TableCell>
                                      <TableCell>{r.name}</TableCell>
                                      <TableCell>
                                        <Chip size="small" label={r.status} color={r.status === 'Approved' || r.status === 'Submitted' ? 'success' : 'default'} variant="outlined" />
                                      </TableCell>
                                      <TableCell>{r.dateTime}</TableCell>
                                      <TableCell align="center">
                                        {r.user?.digitalSignature ? (
                                          <DigitalSignatureImage userOrPath={r.user} alt={`${r.authority} signature`} />
                                        ) : (
                                          '-'
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ));
                                })()}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Box>
                      </Paper>
                    )}
                    </Box>
                  )}

                {/* Tab 2: Quotations */}
                {billViewTab === 2 && (
                    <Box sx={{ p: 2, maxHeight: 400, overflow: 'auto' }}>
                    {(!selectedBill?.poDetail?.quotations || selectedBill.poDetail.quotations.length === 0) ? (
                      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Quotations found.</Typography>
                      ) : (
                        <Stack spacing={4}>
                          {selectedBill.poDetail.quotations.map((q) => (
                            <QuotationDetailView
                              key={q._id}
                              quotation={{ ...q, indent: selectedBill.poDetail.indent || q.indent }}
                              formatNumber={(n) => formatPKR(n)}
                              formatDateForPrint={(d) => formatDate(d)}
                            />
                          ))}
                        </Stack>
                      )}
                    </Box>
                  )}

                {/* Tab 3: Comparative Statement */}
                {billViewTab === 3 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }}>
                    {!selectedBill?.poDetail?.indent ? (
                      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Comparative Statement available.</Typography>
                    ) : (
                      <ComparativeStatementView
                        requisition={selectedBill.poDetail.indent}
                        quotations={selectedBill.poDetail.quotations || []}
                        approvalAuthority={selectedBill.poDetail.indent?.comparativeStatementApprovals || {}}
                        note={selectedBill.poDetail.indent?.notes ?? ''}
                        readOnly
                        formatNumber={(n) => formatPKR(n)}
                        loadingQuotations={false}
                        showPrintButton={false}
                      />
                    )}
                    </Box>
                  )}

                {/* Tab 4: Purchase Order */}
                {billViewTab === 4 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }} className="print-content">
                    {!selectedBill?.poDetail?.po ? (
                      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No Purchase Order linked to this Vendor Bill.</Typography>
                    ) : (
                      <Paper
                        className="finance-po-print-page"
                        sx={{
                          p: 2,
                          maxWidth: '210mm',
                          mx: 'auto',
                          backgroundColor: '#fff',
                          boxShadow: 'none',
                          fontFamily: 'Arial, sans-serif',
                          '@media print': { p: '5mm 7mm', pageBreakInside: 'avoid', breakInside: 'avoid' }
                        }}
                      >
                        <Typography variant="h4" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 1, fontSize: { xs: '1.25rem', print: '1.05rem' }, '@media print': { mb: 0.5 } }}>Purchase Order</Typography>
                        <Box sx={{ mb: 0.75, '@media print': { mb: 0.4 } }}>
                          <Typography variant="h6" fontWeight={600} sx={{ mb: 0.25, fontSize: '0.9rem', '@media print': { fontSize: '0.78rem' } }}>
                            {selectedBill.poDetail.po.companyId?.name || selectedBill.poDetail.po.indent?.companyId?.name || '—'}
                          </Typography>
                          <Typography variant="body2" sx={{ fontSize: '0.78rem', lineHeight: 1.25, '@media print': { fontSize: '0.68rem' } }}>Link Road I-14, adjacent to CDA Sectors I-14 and I-15</Typography>
                        </Box>
                        <Divider sx={{ my: 0.75, '@media print': { my: 0.4 } }} />
                        <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap', '@media print': { mb: 0.6 } }}>
                          <Box sx={{ width: { xs: '100%', md: '45%' }, fontSize: '0.78rem', '@media print': { fontSize: '0.68rem' } }}>
                            <Typography variant="h6" fontWeight={600} sx={{ mb: 0.25, fontSize: '0.85rem', '@media print': { fontSize: '0.74rem' } }}>{selectedBill.poDetail.po.vendor?.name || 'Vendor Name'}</Typography>
                            <Typography variant="body2" sx={{ mb: 0.25, fontSize: 'inherit', lineHeight: 1.3, fontWeight: 600 }}>
                              Payee Name: {selectedBill.poDetail.po.vendor?.payeeName || selectedBill.poDetail.po.vendor?.name || '—'}
                            </Typography>
                            {(selectedBill.poDetail.po.vendor?.cnic || selectedBill.poDetail.po.vendor?.ntnCnic) && (
                              <Typography variant="body2" sx={{ mb: 0.35, fontSize: 'inherit', lineHeight: 1.3, fontWeight: 600, color: 'text.secondary' }}>
                                NTN / CNIC: {selectedBill.poDetail.po.vendor.ntnCnic || selectedBill.poDetail.po.vendor.cnic}
                              </Typography>
                            )}
                            <Typography variant="body2" sx={{ mb: 0.75, fontSize: 'inherit', lineHeight: 1.3 }}>{typeof selectedBill.poDetail.po.vendor?.address === 'string' ? selectedBill.poDetail.po.vendor.address : (selectedBill.poDetail.po.vendor?.address ? Object.values(selectedBill.poDetail.po.vendor.address).filter(Boolean).join(', ') : 'Vendor Address')}</Typography>
                            <Box>
                              <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>Indent Details: </Typography>
                              <Typography component="span" sx={{ fontSize: 'inherit' }}>Indent# {selectedBill.poDetail.po.indent?.indentNumber || selectedBill.poDetail.indent?.indentNumber || 'N/A'} Dated. {formatDateForPrint(selectedBill.poDetail.po.indent?.requestedDate || selectedBill.poDetail.indent?.requestedDate) || 'N/A'}.
                                {selectedBill.poDetail.po.indent?.title && ` ${selectedBill.poDetail.po.indent.title}.`}
                                {selectedBill.poDetail.indent?.requestedBy && ` End User. ${selectedBill.poDetail.indent.requestedBy.firstName || ''} ${selectedBill.poDetail.indent.requestedBy.lastName || selectedBill.poDetail.indent.requestedBy.name || ''}`}
                              </Typography>
                            </Box>
                          </Box>
                          <Box sx={{ width: { xs: '100%', md: '50%' }, fontSize: '0.78rem', '@media print': { fontSize: '0.68rem' } }}>
                            <Box sx={{ display: 'flex', mb: 0.15 }}><Typography component="span" sx={{ minWidth: 120, fontWeight: 600, fontSize: 'inherit' }}>P.O No.:</Typography><Typography component="span" sx={{ fontSize: 'inherit' }}>{selectedBill.poDetail.po.orderNumber || 'N/A'}</Typography></Box>
                            <Box sx={{ display: 'flex', mb: 0.15 }}><Typography component="span" sx={{ minWidth: 120, fontWeight: 600, fontSize: 'inherit' }}>Date:</Typography><Typography component="span" sx={{ fontSize: 'inherit' }}>{formatDateForPrint(selectedBill.poDetail.po.orderDate)}</Typography></Box>
                            <Box sx={{ display: 'flex', mb: 0.15 }}><Typography component="span" sx={{ minWidth: 120, fontWeight: 600, fontSize: 'inherit' }}>Delivery Date:</Typography><Typography component="span" sx={{ fontSize: 'inherit' }}>{formatDateForPrint(selectedBill.poDetail.po.expectedDeliveryDate) || '—'}</Typography></Box>
                            <Box sx={{ display: 'flex', mb: 0.15 }}><Typography component="span" sx={{ minWidth: 120, fontWeight: 600, fontSize: 'inherit' }}>Delivery Address:</Typography><Typography component="span" sx={{ fontSize: 'inherit' }}>{selectedBill.poDetail.po.deliveryAddress || '—'}</Typography></Box>
                          </Box>
                        </Box>
                        <TableContainer sx={{ mb: 1, border: '1px solid', borderColor: 'divider', '@media print': { mb: 0.5 } }}>
                          <Table size="small" sx={{
                            '& th, & td': {
                              fontSize: '0.7rem',
                              py: 0.35,
                              px: 0.5,
                              '@media print': { fontSize: '9.5px', py: 0.2, px: 0.35 }
                            }
                          }}>
                            <TableHead>
                              <TableRow sx={{ bgcolor: 'grey.100' }}>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Sr</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Product</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Description</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Specification</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Brand</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }}>Qty Unit</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="right">Rate</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="right">Discount</TableCell>
                                <TableCell sx={{ fontWeight: 'bold', border: '1px solid', borderColor: 'divider' }} align="right">Amount</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(selectedBill.poDetail.po.items || []).map((item, idx) => {
                                const indentItem = selectedBill.poDetail.indent?.items?.[idx];
                                return (
                                  <TableRow key={idx}>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="center">{idx + 1}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.productCode || indentItem?.itemCode || item.description?.split(' ')[0] || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.description || indentItem?.itemName || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.specification || indentItem?.description || indentItem?.specification || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }}>{item.brand || indentItem?.brand || '—'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="center">{item.quantity} {item.unit || 'pcs'}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatPKR(item.unitPrice)}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatPKR(item.discount || 0)}</TableCell>
                                    <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatPKR(item.amount != null ? item.amount : ((item.quantity || 0) * (item.unitPrice || 0) - (item.discount || 0)))}</TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.75, '@media print': { mb: 0.4 } }}>
                          <Typography variant="body1" fontWeight="bold" sx={{ fontSize: '0.8rem', '@media print': { fontSize: '0.7rem' } }}>Total: {formatPKR(selectedBill.poDetail.po.totalAmount)}</Typography>
                        </Box>
                        {/* Approval Authorities for PO — compact like vendor bill */}
                        <Box sx={{ mt: 1, '@media print': { mt: 0.5, pageBreakInside: 'avoid', breakInside: 'avoid' } }}>
                          <StoreVettingNotice indent={selectedBill.poDetail.po?.indent} sx={{ mb: 1 }} />
                          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.35, fontSize: '0.72rem', color: '#1e293b', '@media print': { fontSize: '10px', mb: 0.25 } }}>
                            Finance Document Approval Authority
                          </Typography>
                          <TableContainer>
                            <Table
                              size="small"
                              sx={{
                                border: '1.5px solid #334155',
                                '& th': {
                                  bgcolor: '#f1f5f9',
                                  fontWeight: 800,
                                  fontSize: 12,
                                  border: '1px solid #cbd5e1',
                                  py: 0.4,
                                  px: 0.8,
                                  '@media print': { py: 0.25, px: 0.5, fontSize: '9.5px' }
                                },
                                '& td': {
                                  fontSize: 12,
                                  border: '1px solid #cbd5e1',
                                  py: 0.4,
                                  px: 0.8,
                                  verticalAlign: 'middle',
                                  '@media print': { py: 0.2, px: 0.5, fontSize: '9.5px' }
                                }
                              }}
                            >
                              <TableHead>
                                <TableRow>
                                  <TableCell>Authority</TableCell>
                                  <TableCell>Name</TableCell>
                                  <TableCell>Status</TableCell>
                                  <TableCell>Date &amp; Time</TableCell>
                                  <TableCell align="center">Digital Signature</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {(() => {
                                  const po = selectedBill.poDetail.po;
                                  const history = Array.isArray(po.workflowHistory) ? [...po.workflowHistory].reverse() : [];
                                  const formatDt = (d) => d ? new Date(d).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
                                  const userNm = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.name || '-';

                                  const preAuditEntry = history.find(e => e.toStatus === 'Forwarded to Audit Director' || e.toStatus === 'initial audit approval' || e.toStatus?.includes('Pre-Audit'));
                                  const directorEntry = history.find(e => e.toStatus === 'approved' || e.toStatus === 'Approved' || e.toStatus?.includes('Audit Director'));

                                  const authText = po.approvalAuthorities || {};
                                  const approvalByKey = new Map(
                                    (Array.isArray(po.authorityApprovals) ? po.authorityApprovals : [])
                                      .filter((a) => a?.authorityKey)
                                      .map((a) => [String(a.authorityKey), a])
                                  );
                                  const poAuthorityRows = [
                                    { key: 'managerProcurement', label: 'Manager Procurement', value: authText.managerProcurement },
                                    { key: 'srManagerProcurement', label: 'Sr Manager Procurement', value: authText.srManagerProcurement },
                                    { key: 'chiefOperatingOfficer', label: 'Chief operating officer', value: authText.chiefOperatingOfficer || authText.verifiedBy },
                                    { key: 'avpTaj', label: 'AVP Taj', value: authText.avpTaj || authText.authorisedRep },
                                    { key: 'technicalDepartment', label: 'Technical Department', value: authText.technicalDepartment }
                                  ]
                                    .filter((a) => a.value && String(a.value).trim())
                                    .map((a) => {
                                      const approval = approvalByKey.get(a.key);
                                      const approver = approval?.approver && typeof approval.approver === 'object' ? approval.approver : null;
                                      return {
                                        authority: a.label,
                                        name: approver ? userNm(approver) : String(a.value).trim(),
                                        status: approval ? 'Approved' : 'Pending',
                                        dateTime: formatDt(approval?.approvedAt),
                                        user: approver
                                      };
                                    });

                                  const rows = [
                                    { authority: 'Prepared By (Procurement)', name: userNm(po.createdBy), status: 'Created', dateTime: formatDt(po.createdAt || po.orderDate), user: po.createdBy },
                                    ...poAuthorityRows,
                                    { authority: 'Pre-Audit Authority', name: userNm(preAuditEntry?.changedBy), status: preAuditEntry ? 'Approved' : 'Pending', dateTime: formatDt(preAuditEntry?.changedAt), user: preAuditEntry?.changedBy },
                                    { authority: 'Audit Director', name: userNm(po.auditApprovedBy || directorEntry?.changedBy), status: (po.auditApprovedBy || directorEntry) ? 'Approved' : 'Pending', dateTime: formatDt(po.auditApprovedAt || directorEntry?.changedAt), user: po.auditApprovedBy || directorEntry?.changedBy, stampPath: directorEntry?.stampUsed && directorEntry?.stampImage ? directorEntry.stampImage : '' }
                                  ];

                                  return rows.map((r, i) => (
                                    <TableRow key={i}>
                                      <TableCell sx={{ fontWeight: 800 }}>{r.authority}</TableCell>
                                      <TableCell>{r.name}</TableCell>
                                      <TableCell>{r.status}</TableCell>
                                      <TableCell>{r.dateTime}</TableCell>
                                      <TableCell align="center">
                                        {(r.stampPath || r.user?.digitalSignature) ? (
                                          <Box sx={{ maxHeight: 24, display: 'flex', justifyContent: 'center', alignItems: 'center', '& img': { maxHeight: 24, width: 'auto', objectFit: 'contain' }, '@media print': { maxHeight: 20, '& img': { maxHeight: 20 } } }}>
                                            <DigitalSignatureImage userOrPath={r.stampPath || r.user} alt={`${r.authority} signature`} sx={{ maxHeight: 24, maxWidth: 90, '@media print': { maxHeight: 20, maxWidth: 80 } }} />
                                          </Box>
                                        ) : (
                                          '-'
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ));
                                })()}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Box>
                      </Paper>
                    )}
                    </Box>
                  )}
                {/* Tab 5: GRNs */}
                {billViewTab === 5 && (
                    <Box sx={{ p: 2, overflowX: 'auto' }} className="print-content">
                    {(!selectedBill?.poDetail?.grns || selectedBill.poDetail.grns.length === 0) ? (
                        <Typography color="textSecondary" sx={{ py: 4, textAlign: 'center' }}>No GRN(s) attached to this Purchase Order.</Typography>
                      ) : (
                        selectedBill.poDetail.grns.map((grn) => (
                          <Paper key={grn._id} sx={{ p: 4, mb: 4, maxWidth: '210mm', mx: 'auto', backgroundColor: '#fff', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                            <Typography variant="overline" color="textSecondary" sx={{ display: 'block', mb: 1 }}>Attached GRN (copy)</Typography>
                            <Grid container sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', pb: 2 }} alignItems="center">
                              <Grid item xs={4}>
                                <Typography variant="h6" fontWeight="bold">
                                  {selectedBill.poDetail?.po?.companyId?.name || selectedBill.poDetail?.po?.indent?.companyId?.name || '—'}
                                </Typography>
                                <Typography variant="body2" color="textSecondary">Head Office</Typography>
                              </Grid>
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
                                <Typography variant="body2">{formatGRNDate(grn.receiveDate)}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Currency</Typography>
                                <Typography variant="body2">{grn.currency || 'Rupees'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>P.R No.</Typography>
                                <Typography variant="body2">{grn.prNumber || '—'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>P.O No.</Typography>
                                <Typography variant="body2">{grn.poNumber || selectedBill.poDetail.po?.orderNumber || '—'}</Typography>
                                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Store</Typography>
                                <Typography variant="body2">{grn.store || '—'}</Typography>
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
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatGRNNumber(item.quantity)}</TableCell>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatGRNNumber(item.unitPrice)}</TableCell>
                                      <TableCell sx={{ border: '1px solid', borderColor: 'divider' }} align="right">{formatGRNNumber(item.valueExcludingSalesTax ?? (item.quantity * item.unitPrice))}</TableCell>
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
                        ))
                      )}
                    </Box>
                  )}

                {/* Tab 6: Payment History */}
                {billViewTab === 6 && (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="subtitle1" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <HistoryIcon /> Payment History
                      </Typography>
                      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: 'grey.50' }}>
                        <Grid container spacing={1}>
                          <Grid item xs={6} md={3}>
                            <Typography variant="caption" color="text.secondary">Bill Total</Typography>
                            <Typography fontWeight={700}>{formatPKR(selectedBill?.totalAmount || 0)}</Typography>
                          </Grid>
                          <Grid item xs={6} md={3}>
                            <Typography variant="caption" color="text.secondary">Advance Applied</Typography>
                            <Typography fontWeight={700} color="info.main">{formatPKR(selectedBill?.advanceApplied || 0)}</Typography>
                          </Grid>
                          <Grid item xs={6} md={3}>
                            <Typography variant="caption" color="text.secondary">Cash/Bank Paid</Typography>
                        <Typography fontWeight={700} color="success.main">{formatPKR(getCashPaidAmount(selectedBill))}</Typography>
                          </Grid>
                          <Grid item xs={6} md={3}>
                            <Typography variant="caption" color="text.secondary">Outstanding</Typography>
                            <Typography fontWeight={800} color="error.main">{formatPKR(getOutstanding(selectedBill))}</Typography>
                          </Grid>
                        </Grid>
                      </Paper>
                      {selectedBill.payments && selectedBill.payments.length > 0 ? (
                        <TableContainer>
                          <Table size="small">
                            <TableHead>
                              <TableRow sx={{ bgcolor: 'grey.100' }}>
                                <TableCell sx={{ fontWeight: 'bold' }}>Date</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Method</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Reference</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }} align="right">Amount</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {selectedBill.payments.map((payment, index) => (
                                <TableRow key={index}>
                                  <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                                  <TableCell>{payment.paymentMethod?.replace('_', ' ')}</TableCell>
                                  <TableCell>{payment.reference || '—'}</TableCell>
                                  <TableCell align="right">{formatPKR(payment.amount)}</TableCell>
                                </TableRow>
                              ))}
                              {(selectedBill?.advanceApplied || 0) > 0 && (
                                <TableRow sx={{ bgcolor: 'info.50' }}>
                                  <TableCell>{formatDate(selectedBill?.updatedAt || selectedBill?.billDate)}</TableCell>
                                  <TableCell>advance adjustment</TableCell>
                                  <TableCell>Auto-applied to bill</TableCell>
                                  <TableCell align="right">{formatPKR(selectedBill.advanceApplied)}</TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      ) : (
                        <>
                          <Typography variant="body2" color="textSecondary">No cash/bank payments recorded yet</Typography>
                          {(selectedBill?.advanceApplied || 0) > 0 && (
                            <Typography variant="body2" sx={{ mt: 1 }} color="info.main">
                              Advance adjustment applied: {formatPKR(selectedBill.advanceApplied)}
                            </Typography>
                          )}
                        </>
                      )}
                    </Box>
                  )}

                {/* Tab 7: Full Workflow History (Indent → PO → Audit/CEO → Store → Finance) */}
                {billViewTab === 7 && (
                  <Box sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                      <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <HistoryIcon /> Full Workflow History
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<HistoryIcon />}
                        onClick={() => setWorkflowHistoryDialog({ open: true, document: selectedBill })}
                        disabled={!(selectedBill?.fullWorkflowHistory?.length || selectedBill?.workflowHistory?.length)}
                      >
                        Open Timeline View
                      </Button>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                      Complete trail across Indent, Requisition, Purchase Order, Pre-Audit / CEO, Cash Approval, Centralized Store, and Finance.
                    </Typography>
                    {(() => {
                      const history = Array.isArray(selectedBill?.fullWorkflowHistory) && selectedBill.fullWorkflowHistory.length
                        ? selectedBill.fullWorkflowHistory
                        : (Array.isArray(selectedBill?.workflowHistory) ? selectedBill.workflowHistory : []);
                      if (!history.length) {
                        return (
                          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                            <Typography color="text.secondary">No workflow history recorded for this bill yet.</Typography>
                          </Paper>
                        );
                      }
                      const moduleChipColor = (module) => {
                        if (!module) return 'default';
                        if (module === 'Indent' || module === 'Requisition') return 'success';
                        if (module === 'Procurement' || module === 'Cash Approval') return 'primary';
                        if (module === 'Pre-Audit') return 'secondary';
                        if (module === 'CEO Secretariat' || module === 'CEO') return 'info';
                        if (module === 'Finance') return 'warning';
                        if (module === 'Centralized Store') return 'default';
                        return 'default';
                      };
                      const personName = (u) => {
                        if (!u) return 'System';
                        if (typeof u === 'string') return u;
                        return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.name || u.email || 'System';
                      };
                      return (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell><strong>#</strong></TableCell>
                                <TableCell><strong>When</strong></TableCell>
                                <TableCell><strong>Module</strong></TableCell>
                                <TableCell><strong>From → To</strong></TableCell>
                                <TableCell><strong>By</strong></TableCell>
                                <TableCell><strong>Comments</strong></TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {history.map((entry, idx) => (
                                <TableRow key={`${entry.toStatus || 'step'}-${idx}-${entry.changedAt || ''}`} hover>
                                  <TableCell>{idx + 1}</TableCell>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                    {entry.changedAt
                                      ? new Date(entry.changedAt).toLocaleString('en-PK', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })
                                      : '—'}
                                  </TableCell>
                                  <TableCell>
                                    <Chip size="small" label={entry.module || '—'} color={moduleChipColor(entry.module)} variant="outlined" />
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="body2" component="span" color="text.secondary">
                                      {entry.fromStatus || '—'}
                                    </Typography>
                                    {' → '}
                                    <Typography variant="body2" component="span" fontWeight={700}>
                                      {entry.toStatus || '—'}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>{personName(entry.changedBy)}</TableCell>
                                  <TableCell sx={{ maxWidth: 280 }}>
                                    <Typography variant="body2" color="text.secondary">
                                      {entry.comments || '—'}
                                    </Typography>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      );
                    })()}
                  </Box>
              )}
            </>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {(selectedBill?.fullWorkflowHistory?.length > 0 || selectedBill?.workflowHistory?.length > 0) && (
              <Button
                variant="outlined"
                startIcon={<HistoryIcon />}
                onClick={() => setWorkflowHistoryDialog({ open: true, document: selectedBill })}
              >
                See Workflow History
              </Button>
            )}
            {selectedBill && (
              <Button
                variant="contained"
                color="primary"
                startIcon={<PrintIcon />}
                onClick={() => navigate(`/finance/bill-print/${selectedBill._id}`)}
              >
                Print / Download Bill
              </Button>
            )}
          </Box>
          <Button onClick={() => setViewDialogOpen(false)} variant="outlined">Close</Button>
        </DialogActions>
      </Dialog>

      <WorkflowHistoryDialog
        open={workflowHistoryDialog.open}
        onClose={() => setWorkflowHistoryDialog({ open: false, document: null })}
        document={workflowHistoryDialog.document}
        documentType="vendorBill"
      />

      {/* Create Bill from PO Dialog */}
      <Dialog open={createFromPoDialog.open} onClose={() => setCreateFromPoDialog({ open: false, po: null, billNumber: '', creating: false })} maxWidth="sm" fullWidth>
        <DialogTitle>Create Bill from Purchase Order</DialogTitle>
        <DialogContent>
          {createFromPoDialog.po && (
            <Box sx={{ pt: 1 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                PO: <strong>{createFromPoDialog.po.orderNumber}</strong> | Vendor: {createFromPoDialog.po.vendor?.name} | Amount: {formatPKR(createFromPoDialog.po.totalAmount)}
              </Typography>
              <TextField
                fullWidth
                label="Bill Number"
                value={createFromPoDialog.billNumber}
                onChange={(e) => setCreateFromPoDialog(prev => ({ ...prev, billNumber: e.target.value }))}
                size="small"
                sx={{ mt: 2 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateFromPoDialog({ open: false, po: null, billNumber: '', creating: false })}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmCreateFromPo} disabled={createFromPoDialog.creating}>
            {createFromPoDialog.creating ? 'Creating...' : 'Create Bill'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog 
        open={paymentDialogOpen} 
        onClose={() => setPaymentDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Bill Payment
          {outstandingTransactions.length > 0 && outstandingTransactions[0].company && (
            <Typography variant="body2" color="text.secondary">
              Company: {outstandingTransactions[0].company}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">Amount to post: {formatPKR(paymentData.amount || 0)}</Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                      Payee type
                    </Typography>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={payeeType}
                      onChange={async (_, v) => {
                        if (!v) return;
                        setPayeeType(v);
                        if (v === 'vendor') {
                          setSelectedEmployeePayee({ employeeId: '', employeeName: '', employeeCode: '' });
                          setOutstandingTransactions([]);
                          setPayeeCashApprovals([]);
                          if (selectedPayee.vendorId) {
                            await Promise.all([
                              loadOutstandingByVendor(
                                selectedPayee.vendorId,
                                selectedPayee.vendorName,
                                selectedBill?._id
                              ),
                              loadPayeeCashApprovals(
                                'vendor',
                                '',
                                selectedPayee.vendorId,
                                ''
                              )
                            ]);
                          }
                        } else {
                          setSelectedPayee({ vendorId: '', vendorName: '' });
                          setOutstandingTransactions([]);
                          setPayeeCashApprovals([]);
                          if (selectedEmployeePayee.employeeId) {
                            await Promise.all([
                              loadOutstandingByEmployee(
                                selectedEmployeePayee.employeeId,
                                selectedEmployeePayee.employeeName,
                                selectedBill?._id
                              ),
                              loadPayeeCashApprovals(
                                'employee',
                                selectedEmployeePayee.employeeId,
                                '',
                                selectedEmployeePayee.employeeCode
                              )
                            ]);
                          }
                        }
                      }}
                    >
                      <ToggleButton value="vendor">Vendor</ToggleButton>
                      <ToggleButton value="employee">Employee</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  <Grid container spacing={1} alignItems="flex-end">
                    <Grid item xs={12} md={6}>
                      {payeeType === 'employee' ? (
                        <FormControl fullWidth size="small">
                          <InputLabel>Payee (Employee)</InputLabel>
                          <Select
                            value={selectedEmployeePayee.employeeId || ''}
                            label="Payee (Employee)"
                            onChange={async (e) => {
                              const employeeId = e.target.value;
                              const row = financeEmployees.find(
                                (emp) => String(emp.employeeId) === String(employeeId)
                              );
                              const employeeName = row?.employeeName || '';
                              const employeeCode = row?.employeeCode || '';
                              setSelectedEmployeePayee({ employeeId, employeeName, employeeCode });
                              await Promise.all([
                                loadOutstandingByEmployee(employeeId, employeeName, selectedBill?._id),
                                loadPayeeCashApprovals('employee', employeeId, '', employeeCode)
                              ]);
                            }}
                          >
                            <MenuItem value="">
                              <em>Select employee</em>
                            </MenuItem>
                            {financeEmployees.map((e) => (
                              <MenuItem key={e.employeeId} value={e.employeeId}>
                                {e.employeeCode ? `${e.employeeCode} — ` : ''}
                                {e.employeeName}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        <FormControl fullWidth size="small">
                          <InputLabel>Payee (Vendor)</InputLabel>
                          <Select
                            value={selectedPayee.vendorId || ''}
                            label="Payee (Vendor)"
                            onChange={async (e) => {
                              const vendorId = e.target.value;
                              const row = payeeVendors.find((v) => String(v.vendorId) === String(vendorId));
                              const vendorName = row?.vendorName || '';
                              setSelectedPayee({ vendorId, vendorName });
                              await Promise.all([
                                loadOutstandingByVendor(vendorId, vendorName, selectedBill?._id),
                                loadPayeeCashApprovals('vendor', '', vendorId, ''),
                                loadPayeeVendorAdvances(vendorId, vendorName)
                              ]);
                            }}
                          >
                            <MenuItem value="">
                              <em>Select vendor</em>
                            </MenuItem>
                            {payeeVendors.map((v) => (
                              <MenuItem key={v.vendorId} value={v.vendorId}>
                                {v.vendorName}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">
                        {payeeType === 'employee' ? 'Selected employee' : 'Selected vendor'}
                      </Typography>
                      <Typography fontWeight={700}>
                        {payeeType === 'employee'
                          ? selectedEmployeePayee.employeeName
                            ? `${selectedEmployeePayee.employeeCode ? `${selectedEmployeePayee.employeeCode} — ` : ''}${selectedEmployeePayee.employeeName}`
                            : '—'
                          : selectedPayee.vendorName || '—'}
                      </Typography>
                    </Grid>
                  </Grid>
                </Stack>
              </Paper>
            </Grid>

            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">
                  {payeeType === 'employee' ? 'Outstanding bills — apply advance (Step 2a)' : 'Outstanding Transactions'}
                </Typography>
                  {outstandingTransactions.length > 0 && (
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          const next = outstandingTransactions.map((r) => {
                            const maxBank = roundPay2(Math.max(0, (r.outstanding || 0) - (Number(r.advanceApplyAmount) || 0)));
                            return { ...r, payAmount: maxBank };
                          });
                          setOutstandingTransactions(next);
                          const total = roundPay2(next.reduce((s, r) => s + (Number(r.payAmount) || 0), 0));
                          setPaymentData((prev) => ({ ...prev, amount: total }));
                        }}
                        sx={{ fontSize: '0.75rem', py: 0.2 }}
                      >
                        Select All Bills
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="inherit"
                        onClick={() => {
                          const next = outstandingTransactions.map((r) => ({ ...r, payAmount: 0 }));
                          setOutstandingTransactions(next);
                          setPaymentData((prev) => ({ ...prev, amount: 0 }));
                        }}
                        sx={{ fontSize: '0.75rem', py: 0.2 }}
                      >
                        Clear
                      </Button>
                    </Stack>
                  )}
                </Stack>
                {loadingOutstandingTransactions ? (
                  <LinearProgress />
                ) : outstandingTransactions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {payeeType === 'employee'
                      ? 'No outstanding bills for selected employee.'
                      : 'No outstanding bills for selected vendor.'}
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            indeterminate={
                              outstandingTransactions.some((r) => r.payAmount > 0) &&
                              !outstandingTransactions.every((r) => r.payAmount > 0)
                            }
                            checked={
                              outstandingTransactions.length > 0 &&
                              outstandingTransactions.every((r) => r.payAmount > 0)
                            }
                            onChange={(e) => {
                              const isChecked = e.target.checked;
                              const next = outstandingTransactions.map((r) => {
                                const maxBank = roundPay2(
                                  Math.max(0, (r.outstanding || 0) - (Number(r.advanceApplyAmount) || 0))
                                );
                                return { ...r, payAmount: isChecked ? maxBank : 0 };
                              });
                              setOutstandingTransactions(next);
                              const total = roundPay2(next.reduce((s, r) => s + (Number(r.payAmount) || 0), 0));
                              setPaymentData((prev) => ({ ...prev, amount: total }));
                            }}
                          />
                        </TableCell>
                        <TableCell>Bill #</TableCell>
                        <TableCell>Due Date</TableCell>
                        <TableCell align="right">Original Amount</TableCell>
                        <TableCell align="right">Open Balance</TableCell>
                        {payeeType === 'employee' && (
                          <TableCell align="right" sx={{ minWidth: 140 }}>Apply from advance</TableCell>
                        )}
                        <TableCell align="right" sx={{ minWidth: 140 }}>
                          {payeeType === 'employee' ? 'Bank payment' : 'Payment'}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {outstandingTransactions.map((row, idx) => {
                        const isChecked = (Number(row.payAmount) || 0) > 0;
                        const maxBank = roundPay2(
                          Math.max(0, (row.outstanding || 0) - (Number(row.advanceApplyAmount) || 0))
                        );
                        return (
                          <TableRow key={row.billId} hover selected={isChecked}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                size="small"
                                checked={isChecked}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  const next = [...outstandingTransactions];
                                  next[idx] = { ...next[idx], payAmount: checked ? maxBank : 0 };
                                  setOutstandingTransactions(next);
                                  const total = roundPay2(
                                    next.reduce((s, r) => s + (Number(r.payAmount) || 0), 0)
                                  );
                                  setPaymentData((prev) => ({ ...prev, amount: total }));
                                }}
                              />
                            </TableCell>
                            <TableCell sx={{ fontWeight: isChecked ? 600 : 400 }}>{row.billNumber}</TableCell>
                          <TableCell>{formatDate(row.dueDate)}</TableCell>
                          <TableCell align="right">{formatPKR(row.totalAmount)}</TableCell>
                          <TableCell align="right">
                            {formatPKR(
                              roundPay2(
                                Math.max(
                                  0,
                                  (Number(row.outstanding) || 0) - (Number(row.advanceApplyAmount) || 0)
                                )
                              )
                            )}
                          </TableCell>
                          {payeeType === 'employee' && (
                            <TableCell align="right">
                              <TextField
                                size="small"
                                type="number"
                                placeholder="0"
                                value={row.advanceApplyAmount ?? ''}
                                inputProps={{ min: 0, max: row.outstanding, step: 0.01 }}
                                onChange={(e) => {
                                  const next = [...outstandingTransactions];
                                  const v = Math.max(0, Math.min(Number(e.target.value) || 0, row.outstanding || 0));
                                  next[idx] = {
                                    ...next[idx],
                                    advanceApplyAmount: v,
                                    payAmount: roundPay2(Math.max(0, (row.outstanding || 0) - v))
                                  };
                                  setOutstandingTransactions(next);
                                  const total = roundPay2(
                                    next.reduce((s, r) => s + (Number(r.payAmount) || 0), 0)
                                  );
                                  setPaymentData((prev) => ({ ...prev, amount: total }));
                                }}
                                sx={{ width: 120 }}
                              />
                            </TableCell>
                          )}
                          <TableCell align="right">
                            <TextField
                              size="small"
                              type="number"
                              value={row.payAmount}
                              inputProps={{
                                min: 0,
                                  max: maxBank,
                                step: 0.01
                              }}
                              onChange={(e) => {
                                const next = [...outstandingTransactions];
                                const v = Math.max(0, Math.min(Number(e.target.value) || 0, maxBank));
                                next[idx] = { ...next[idx], payAmount: v };
                                setOutstandingTransactions(next);
                                const total = roundPay2(
                                  next.reduce((s, r) => s + (Number(r.payAmount) || 0), 0)
                                );
                                setPaymentData((prev) => ({ ...prev, amount: total }));
                              }}
                              sx={{ width: 120 }}
                            />
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'info.50' }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  flexWrap="wrap"
                  gap={1}
                  sx={{ mb: 1 }}
                >
                  <Typography variant="subtitle2">
                    {payeeType === 'employee'
                      ? 'Apply bill from cash approval (Step 1 — like Taj deposit)'
                      : `Cash approvals — ${payeeType === 'employee' ? 'employee' : 'vendor'}`}
                  </Typography>
                </Stack>
                {payeeType === 'employee' && payeeCashApprovals.length > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Enter <strong>Amount to use</strong> on each cash approval (deposit). Then allocate the same
                    total under <strong>Apply from advance</strong> on outstanding bills. Totals must match before you apply.
                  </Typography>
                )}
                {loadingPayeeCashApprovals ? (
                  <LinearProgress />
                ) : !(payeeType === 'employee' ? selectedEmployeePayee.employeeId : selectedPayee.vendorId) ? (
                  <Typography variant="body2" color="text.secondary">
                    Select a {payeeType === 'employee' ? 'employee' : 'vendor'} to view related cash approvals.
                  </Typography>
                ) : payeeCashApprovals.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No cash approvals found for this {payeeType === 'employee' ? 'employee' : 'vendor'}.
                  </Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>CA #</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Approval date</TableCell>
                          <TableCell>Advance issued</TableCell>
                          <TableCell>GL account</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell align="right">Applied to bills</TableCell>
                          <TableCell align="right">Open</TableCell>
                          {payeeType === 'employee' && (
                            <TableCell align="right" sx={{ minWidth: 140 }}>
                              Amount to use
                            </TableCell>
                          )}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {payeeCashApprovals.map((row) => (
                          <TableRow key={row.cashApprovalId} hover>
                            <TableCell>
                              <Typography
                                component="span"
                                variant="body2"
                                sx={{
                                  color: 'primary.main',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  '&:hover': { textDecoration: 'underline' }
                                }}
                                onClick={() => {
                                  setPaymentDialogOpen(false);
                                  navigate(getCashApprovalViewPath(row));
                                }}
                              >
                                {row.caNumber || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip label={row.status} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell>{row.approvalDate ? formatDate(row.approvalDate) : '—'}</TableCell>
                            <TableCell>{row.advanceIssuedAt ? formatDate(row.advanceIssuedAt) : '—'}</TableCell>
                            <TableCell>{row.advanceGlAccountNumber || '—'}</TableCell>
                            <TableCell align="right">{formatPKR(row.advanceAmount || row.totalAmount || 0)}</TableCell>
                            <TableCell align="right">
                              {row.applied != null ? formatPKR(row.applied) : '—'}
                            </TableCell>
                            <TableCell align="right">
                              {row.open != null ? formatPKR(row.open) : '—'}
                            </TableCell>
                            {payeeType === 'employee' && (
                              <TableCell align="right">
                                {row.advanceIssuedAt && (row.open == null || row.open > 0) ? (
                                  <TextField
                                    size="small"
                                    type="number"
                                    placeholder="0"
                                    value={caApplyAmounts[row.cashApprovalId] ?? ''}
                                    inputProps={{
                                      min: 0,
                                      max: row.open ?? undefined,
                                      step: 0.01
                                    }}
                                    onChange={(e) => {
                                      const max = Number(row.open) || 0;
                                      const v = Math.max(0, Math.min(Number(e.target.value) || 0, max));
                                      const nextCa = {
                                        ...caApplyAmounts,
                                        [row.cashApprovalId]: v > 0 ? String(v) : ''
                                      };
                                      setCaApplyAmounts(nextCa);
                                      syncBillPaymentFromCaApply(
                                        nextCa,
                                        outstandingTransactions,
                                        selectedBill?._id
                                      );
                                    }}
                                    sx={{ width: 120 }}
                                  />
                                ) : (
                                  <Typography variant="caption" color="text.secondary">
                                    —
                                  </Typography>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
                {payeeType === 'vendor' && payeeVendorAdvances.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'success.dark', fontWeight: 700 }}>
                      Available Vendor Advances / Credits ({payeeVendorAdvances.length})
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Advance Ref</TableCell>
                            <TableCell>Payment Date</TableCell>
                            <TableCell>Method</TableCell>
                            <TableCell align="right">Original Amount</TableCell>
                            <TableCell align="right">Applied</TableCell>
                            <TableCell align="right">Open Balance</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {payeeVendorAdvances.map((adv) => (
                            <TableRow key={adv.vendorAdvanceId} hover>
                              <TableCell sx={{ fontWeight: 600 }}>{adv.reference}</TableCell>
                              <TableCell>{formatDate(adv.paymentDate)}</TableCell>
                              <TableCell>{adv.paymentMethod}</TableCell>
                              <TableCell align="right">{formatPKR(adv.amount)}</TableCell>
                              <TableCell align="right">{formatPKR(adv.applied)}</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                                {formatPKR(adv.open)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}
                {payeeType === 'employee' && payeeCashApprovals.length > 0 && (
                  <>
                    <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, mt: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">Total from cash approvals:</Typography>
                        <Typography fontWeight={700} color="primary.main">
                          {formatPKR(employeeAdvanceApplyTotals.totalCaUsage)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">Total applied to bills:</Typography>
                        <Typography fontWeight={700}>
                          {formatPKR(employeeAdvanceApplyTotals.totalAllocatedToBills)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2" color="text.secondary">Remaining to allocate:</Typography>
                        <Typography
                          fontWeight={700}
                          color={
                            employeeAdvanceApplyTotals.remainingToAllocate === 0
                              ? 'success.main'
                              : 'warning.main'
                          }
                        >
                          {formatPKR(employeeAdvanceApplyTotals.remainingToAllocate)}
                        </Typography>
                      </Stack>
                    </Box>
                    {employeeAdvanceApplyTotals.totalCaUsage > 0 &&
                      employeeAdvanceApplyTotals.remainingToAllocate !== 0 && (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        Total from cash approvals must equal total applied to bills (like Taj Pay Invoices from Deposit).
                      </Alert>
                    )}
                    <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1.5 }}>
                      <Button
                        size="small"
                        variant="contained"
                        color="info"
                        disabled={
                          processingCaApply ||
                          employeeAdvanceApplyTotals.totalCaUsage <= 0 ||
                          employeeAdvanceApplyTotals.remainingToAllocate !== 0 ||
                          !billPaymentFinAuth.accountsManagerUser ||
                          !billPaymentFinAuth.financeControllerUser
                        }
                        onClick={handleApplyCaAdvanceToBill}
                      >
                        {processingCaApply ? 'Applying…' : 'Apply advance to bills'}
                      </Button>
                    </Stack>
                  </>
                )}
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {payeeType === 'employee' ? 'Bank payment (Step 2b)' : 'Payment details'}
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Total Payment Amount (PKR)" type="number"
                value={paymentData.amount}
                size="small"
                InputProps={{ readOnly: true }}
                helperText="Sum of selected bills in the table below" />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="WHT Rate %" type="number" placeholder="e.g. 4.5"
                value={paymentData.whtRate || ''}
                onChange={(e) => setPaymentData({ ...paymentData, whtRate: e.target.value })}
                size="small" inputProps={{ min: 0, max: 30, step: 0.01 }}
                helperText={paymentData.whtRate > 0
                  ? `WHT: PKR ${((paymentData.amount || 0) * (paymentData.whtRate / 100)).toFixed(2)} — Net to bank: PKR ${((paymentData.amount || 0) * (1 - paymentData.whtRate / 100)).toFixed(2)}`
                  : 'Leave 0 if no WHT applies'} />
            </Grid>
            <Grid item xs={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Paying Company</InputLabel>
                <Select
                  value={payingCompanyId}
                  onChange={(e) => setPayingCompanyId(e.target.value)}
                  label="Paying Company"
                >
                  <MenuItem value=""><em>-- Target Company / Default --</em></MenuItem>
                  {financeCompanies.map((c) => (
                    <MenuItem key={c._id} value={c._id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Payment Method</InputLabel>
                <Select value={paymentData.paymentMethod}
                  onChange={(e) => setPaymentData({ ...paymentData, paymentMethod: e.target.value })}
                  label="Payment Method">
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="check">Check / Cheque</MenuItem>
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Pay From Account</InputLabel>
                <Select value={paymentData.bankAccountId || ''}
                  onChange={(e) => setPaymentData({ ...paymentData, bankAccountId: e.target.value })}
                  label="Pay From Account">
                  <MenuItem value="">
                    {isIcPayingMode ? '— Select paying company bank —' : '— Auto (default bank) —'}
                  </MenuItem>
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
                {bankAccounts.length === 0 && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                    No Cash and cash equivalents accounts found for the Paying company.
                  </Typography>
                )}
              </FormControl>
            </Grid>
            {isIcPayingMode && (
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Related Party Account (Original Company)</InputLabel>
                  <Select
                    value={paymentData.relatedPartyAccountId || ''}
                    onChange={(e) => setPaymentData({ ...paymentData, relatedPartyAccountId: e.target.value })}
                    label="Related Party Account (Original Company)"
                  >
                    <MenuItem value="">— Select related party account —</MenuItem>
                    {relatedPartyAccounts.map((item) => {
                      const account = item?.account || item;
                      const depth = item?.depth || 0;
                      return (
                        <MenuItem key={account._id} value={account._id}>
                          {formatPayFromAccountLabel(account, depth)}
                        </MenuItem>
                      );
                    })}
                  </Select>
                  {relatedPartyAccounts.length === 0 ? (
                    <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                      No Payable to Related Parties on the original (bill) company. Add it in Chart of Accounts.
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      From the bill company COA — used with Pay From bank for intercompany posting.
                    </Typography>
                  )}
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>Cost Center (Optional)</InputLabel>
                <Select value={paymentData.costCenter || ''}
                  onChange={(e) => setPaymentData({ ...paymentData, costCenter: e.target.value })}
                  label="Cost Center (Optional)">
                  <MenuItem value="">None</MenuItem>
                  {costCenters.filter(cc => cc.isActive).map((cc) => (
                    <MenuItem key={cc._id} value={cc._id}>{cc.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Payment Date" type="date"
                value={paymentData.paymentDate}
                onChange={(e) => setPaymentData({ ...paymentData, paymentDate: e.target.value })}
                InputLabelProps={{ shrink: true }} size="small" />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Reference / Cheque # / TT #"
                value={paymentData.reference}
                onChange={(e) => setPaymentData({ ...paymentData, reference: e.target.value })}
                size="small" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Narration / Description"
                value={paymentData.narration}
                onChange={(e) => setPaymentData({ ...paymentData, narration: e.target.value })}
                placeholder="Enter narration for voucher"
                size="small" />
            </Grid>
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
                <Grid container spacing={1.5}>
                  <FinanceApprovalAuthorityPicker
                    finAuth={billPaymentFinAuth}
                    onChange={setBillPaymentFinAuth}
                    candidateUsers={financeAuthorityCandidates}
                    preparerName={preparerDisplayName}
                    disabled={processingCaApply || processingPayment}
                    title="Finance approval authorities (required before apply or payment)"
                  />
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleRecordPayment}
            disabled={
              processingPayment
              || !billPaymentFinAuth.accountsManagerUser
              || !billPaymentFinAuth.financeControllerUser
              || (isIcPayingMode && (!paymentData.bankAccountId || !paymentData.relatedPartyAccountId))
            }
          >
            {processingPayment ? 'Processing…' : 'Post Payment'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Bill Dialog */}
      <Dialog 
        open={editDialogOpen} 
        onClose={() => setEditDialogOpen(false)}
        maxWidth={selectedBill?.referenceType === 'purchase_order' ? 'lg' : 'md'}
        fullWidth
      >
        <DialogTitle>Edit Bill: {selectedBill?.billNumber}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mb: 4 }}>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Company</InputLabel>
                <Select
                  label="Company"
                  value={editData.companyId || ''}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const companyMeta = (financeCompanies || []).find((c) => String(c._id) === String(nextId));
                    setEditData({
                      ...editData,
                      companyId: nextId,
                      company: companyMeta?.name || ''
                    });
                    loadExpenseAccountsForCompany(nextId);
                  }}
                >
                  <MenuItem value=""><em>— Select company —</em></MenuItem>
                  {(financeCompanies || [])
                    .filter((c) => c && c._id && String(c._id).toLowerCase() !== 'all')
                    .map((c) => (
                      <MenuItem key={c._id} value={c._id}>
                        {c.name}{c.companyCode ? ` (${c.companyCode})` : ''}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Bill Number"
                value={editData.billNumber}
                onChange={(e) => setEditData({ ...editData, billNumber: e.target.value })}
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Total Amount"
                type="number"
                value={editData.totalAmount}
                onChange={(e) => setEditData({ ...editData, totalAmount: parseFloat(e.target.value) })}
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Bill Date"
                type="date"
                value={editData.billDate}
                onChange={(e) => setEditData({ ...editData, billDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Due Date"
                type="date"
                value={editData.dueDate}
                onChange={(e) => setEditData({ ...editData, dueDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                size="small"
              />
            </Grid>
          </Grid>

          <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>Line Items</Typography>
          <Table size="small" sx={{ mb: 4, border: '1px solid', borderColor: 'grey.300' }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell>Description</TableCell>
                <TableCell width={220}>Account (COA)</TableCell>
                <TableCell align="right" width={90}>Quantity</TableCell>
                <TableCell align="right" width={120}>Unit Price</TableCell>
                <TableCell align="right" width={120}>Amount</TableCell>
                <TableCell width={48} />
              </TableRow>
            </TableHead>
            <TableBody>
              {(editData.lineItems || []).map((line, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <TextField
                      fullWidth size="small"
                      value={line.description || ''}
                      onChange={e => {
                        const newLines = [...editData.lineItems];
                        newLines[idx].description = e.target.value;
                        setEditData({ ...editData, lineItems: newLines });
                      }}
                      placeholder="Item description"
                    />
                  </TableCell>
                  <TableCell>
                    <FormControl fullWidth size="small">
                      <Select
                        value={line.account?._id || line.account || line.expenseAccount || ''}
                        displayEmpty
                        onChange={e => {
                          const newLines = [...editData.lineItems];
                          newLines[idx].account = e.target.value;
                          setEditData({ ...editData, lineItems: newLines });
                        }}
                      >
                        <MenuItem value=""><em>Default (Auto/6200)</em></MenuItem>
                        {expenseAccounts.map((acc) => (
                          <MenuItem key={acc._id} value={acc._id}>
                            {acc.accountNumber} - {acc.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell>
                    <TextField
                      fullWidth size="small" type="number"
                      value={line.quantity || 0}
                      onChange={e => {
                        const newLines = [...editData.lineItems];
                        newLines[idx].quantity = parseFloat(e.target.value) || 0;
                        newLines[idx].amount = newLines[idx].quantity * newLines[idx].unitPrice;
                        setEditData({ ...editData, lineItems: newLines });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      fullWidth size="small" type="number"
                      value={line.unitPrice || 0}
                      onChange={e => {
                        const newLines = [...editData.lineItems];
                        newLines[idx].unitPrice = parseFloat(e.target.value) || 0;
                        newLines[idx].amount = newLines[idx].quantity * newLines[idx].unitPrice;
                        setEditData({ ...editData, lineItems: newLines });
                      }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ verticalAlign: 'middle' }}>
                    {formatPKR(line.amount || 0)}
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" color="error" onClick={() => {
                      const newLines = editData.lineItems.filter((_, i) => i !== idx);
                      setEditData({ ...editData, lineItems: newLines });
                    }}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={6}>
                  <Button startIcon={<AddIcon />} size="small" onClick={() => {
                    setEditData({
                      ...editData,
                      lineItems: [...(editData.lineItems || []), { description: '', quantity: 1, unitPrice: 0, amount: 0 }]
                    });
                  }}>
                    Add Line Item
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <Divider sx={{ mb: 3 }} />

          {selectedBill && (
            <Box sx={{ opacity: 0.9 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>Document Preview</Typography>
              <CentralizedStoreBillInvoiceBody
                bill={{
                  ...selectedBill,
                  billId: editData.billNumber || selectedBill.billNumber,
                  billDate: editData.billDate || selectedBill.billDate,
                  createdAt: selectedBill.createdAt || selectedBill.billDate,
                  totalAmount: editData.totalAmount ?? selectedBill.totalAmount,
                  provider: selectedBill.vendorName || selectedBill.vendor?.name,
                  location: getBillInvoiceLocation(selectedBill),
                  notes: selectedBill.notes || selectedBill.internalNotes,
                  duePaymentAmount: getDuePaymentAmountFromBill(selectedBill),
                  billLines: (editData.lineItems || []).map((line, idx) => ({
                    ...line,
                    itemName: line.description,
                    itemCode: line.itemCode || 'N/A',
                    amount: line.amount || (line.quantity * line.unitPrice),
                    duePaymentAmount: getLineDuePaymentAmount(selectedBill, line, idx)
                  }))
                }}
                showChargesSummary={true}
              />

              {(selectedBill?.referenceType === 'utility_bill' || selectedBill?.module === 'taj_utilities') && (() => {
                const getApprovalRows = () => {
                  const formatDateTime = (date) => {
                    if (!date) return '-';
                    return new Date(date).toLocaleString('en-PK', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    });
                  };

                  const rows = [];
                  if (selectedBill?.cashApproval?.workflowHistory?.length > 0) {
                    const history = [...selectedBill.cashApproval.workflowHistory].reverse();
                    history.forEach(entry => {
                      let actionDesc = entry.toStatus;
                      if (entry.comments) {
                        actionDesc += ` (${entry.comments})`;
                      }
                      rows.push({
                        authority: actionDesc,
                        name: [entry.changedBy?.firstName, entry.changedBy?.lastName].filter(Boolean).join(' ') || entry.changedBy?.name || 'System',
                        signatureUser: entry.changedBy,
                        dateTime: entry.changedAt ? formatDateTime(entry.changedAt) : '-'
                      });
                    });
                    return rows;
                  }
                  if (selectedBill?.poDetail?.po?.workflowHistory?.length > 0) {
                    const history = [...selectedBill.poDetail.po.workflowHistory].reverse();
                    history.forEach(entry => {
                      let actionDesc = entry.toStatus;
                      if (entry.comments) {
                        actionDesc += ` (${entry.comments})`;
                      }
                      rows.push({
                        authority: actionDesc,
                        name: [entry.changedBy?.firstName, entry.changedBy?.lastName].filter(Boolean).join(' ') || entry.changedBy?.name || 'System',
                        signatureUser: entry.changedBy,
                        dateTime: entry.changedAt ? formatDateTime(entry.changedAt) : '-'
                      });
                    });
                    return rows;
                  }
                  rows.push({
                    authority: 'Preparer',
                    name: [selectedBill?.createdBy?.firstName, selectedBill?.createdBy?.lastName].filter(Boolean).join(' ') || selectedBill?.createdBy?.name || '-',
                    signatureUser: selectedBill?.createdBy,
                    dateTime: selectedBill?.createdAt ? formatDateTime(selectedBill.createdAt) : '-'
                  });
                  if (selectedBill?.approval?.approvedBy) {
                    rows.push({
                      authority: 'Approver',
                      name: [selectedBill.approval.approvedBy.firstName, selectedBill.approval.approvedBy.lastName].filter(Boolean).join(' ') || selectedBill.approval.approvedBy.name || '-',
                      signatureUser: selectedBill.approval.approvedBy,
                      dateTime: selectedBill.approval.approvedDate ? formatDateTime(selectedBill.approval.approvedDate) : '-'
                    });
                  }
                  return rows;
                };
                const getSignatureSource = (row) => row?.signatureUser?.digitalSignature || '';
                return (
                  <Table
                    size="small"
                    sx={{
                      mt: 4,
                      mb: 2,
                      border: '1px solid',
                      borderColor: 'grey.300',
                      '& th': {
                        bgcolor: 'grey.100',
                        fontWeight: 800,
                        fontSize: 14,
                        borderBottom: '1px solid',
                        borderColor: 'grey.300'
                      },
                      '& td': {
                        fontSize: 14,
                        borderBottom: '1px solid',
                        borderColor: 'grey.200',
                        py: 1.4
                      },
                      '& tr:last-child td': {
                        borderBottom: 0
                      }
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>Authority</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Digital Signature</TableCell>
                        <TableCell>Date & Time</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {getApprovalRows().map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell sx={{ fontWeight: 600 }}>{row.authority}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>
                            {getSignatureSource(row) ? (
                              <DigitalSignatureImage
                                signatureUrl={getSignatureSource(row)}
                                userName={row.name}
                              />
                            ) : (
                              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                Not signed
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>{row.dateTime}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={handleUpdateBill}
          >
            Update Bill
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => !deletingBill && setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: 'error.main', display: 'flex', alignItems: 'center', gap: 1 }}>
          <DeleteIcon /> Delete Bill
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            Are you sure you want to delete bill <strong>{billToDelete?.billNumber}</strong> ({billToDelete?.vendorName}) for <strong>{formatPKR(billToDelete?.totalAmount || 0)}</strong>?
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
            This will permanently remove the bill and its corresponding General Ledger journal entries.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deletingBill} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmDelete}
            disabled={deletingBill}
          >
            {deletingBill ? 'Deleting...' : 'Delete Bill'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* QuickBooks-style Pay Bills Dialog */}
      <QuickbooksPayBillsModal
        open={payBillsModalOpen}
        onClose={() => {
          setPayBillsModalOpen(false);
          setSelectedBill(null);
          setSelectedPayee({ vendorId: '', vendorName: '' });
        }}
        onSuccess={fetchAccountsPayable}
        selectedCompanyId={selectedCompanyId}
        preselectedVendorId={selectedPayee.vendorId}
        preselectedVendorName={selectedPayee.vendorName}
        preselectedBillId={selectedBill?._id}
      />
    </Box>
  );
};

export default AccountsPayable;
