import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Pagination,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider
} from '@mui/material';
import {
  AccountBalance as AccountBalanceIcon,
  Business as BusinessIcon,
  TrendingUp as TrendingUpIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as ViewIcon,
  Payment as PaymentIcon,
  Download as DownloadIcon,
  ReceiptLong as CreditNoteIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  History as HistoryIcon,
  Print as PrintIcon,
  Email as EmailIcon,
  Delete as DeleteIcon,
  EventNote as InstallmentIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import QuickbooksReceivePaymentModal from '../../components/Finance/QuickbooksReceivePaymentModal';
import api from '../../services/api';
import { financeListFromResponse } from '../../utils/financeApiData';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';
import toast from 'react-hot-toast';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import FinanceCompanySelector from '../../components/Finance/FinanceCompanySelector';

/** Local YYYY-MM-DD (avoids UTC day-shift from toISOString). */
const toYmd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** FBR / SGC financial year: 1 July → 30 June. */
const getFinancialYearStartYmd = (date = new Date()) => {
  const fyStartYear = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return toYmd(new Date(fyStartYear, 6, 1));
};

const isValidYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/** Month filter: "Last 12 months" + each of the last 12 calendar months (current month first) */
const buildMonthOptions = (today = new Date()) => {
  const opts = [];
  const yearAgo = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  opts.push({ key: 'last12', label: 'Last 12 months', start: toYmd(yearAgo), end: toYmd(today) });
  for (let i = 0; i < 12; i += 1) {
    const first = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const last = i === 0 ? today : new Date(first.getFullYear(), first.getMonth() + 1, 0);
    opts.push({
      key: toYmd(first).slice(0, 7),
      label: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + (i === 0 ? ' (this month)' : ''),
      start: toYmd(first),
      end: toYmd(last)
    });
  }
  return opts;
};

const AccountsReceivable = () => {
  const { selectedCompanyId } = useFinanceCompany();
  const navigate = useNavigate();
  const theme = useTheme();
  
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [creditNoteDialog, setCreditNoteDialog] = useState({ open: false, invoice: null, amount: '', reason: '' });
  const [emailDialog, setEmailDialog] = useState({ open: false, invoice: null });
  const [emailSending, setEmailSending] = useState(false);
  const [paymentData, setPaymentData] = useState({
    amount: 0,
    paymentMethod: 'bank_transfer',
    reference: '',
    paymentDate: new Date().toISOString().split('T')[0]
  });
  const [processingPayment, setProcessingPayment] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [deletingInvoice, setDeletingInvoice] = useState(false);

  const initialFyStart = getFinancialYearStartYmd();
  const initialToday = toYmd(new Date());

  const [filters, setFilters] = useState({
    status: '',
    customer: '',
    startDate: initialFyStart,
    endDate: initialToday,
    search: ''
  });
  // Draft inputs — typing here must NOT refetch until committed
  const [startDateInput, setStartDateInput] = useState(initialFyStart);
  const [endDateInput, setEndDateInput] = useState(initialToday);
  const [searchInput, setSearchInput] = useState('');
  const [customerInput, setCustomerInput] = useState('');
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    limit: 20
  });
  const [summary, setSummary] = useState({
    totalOutstanding: 0,
    totalOverdue: 0,
    totalPaid: 0,
    totalInvoices: 0
  });

  useEffect(() => {
    if (!selectedCompanyId) return;
    api.get('/finance/accounts', { params: { category: 'Current Asset', limit: 500, page: 1, companyId: selectedCompanyId } })
      .then(res => {
        const all = financeListFromResponse(res);
        setBankAccounts(all.filter(a => ['1001','1002'].includes(a.accountNumber) || a.name?.toLowerCase().includes('bank') || a.name?.toLowerCase().includes('cash')));
      })
      .catch(() => setBankAccounts([]));
  }, [selectedCompanyId]);

  // Debounce text filters into committed filters (dates apply only on blur — see handlers)
  useEffect(() => {
    const timer = setTimeout(() => {
      let changed = false;
      setFilters((prev) => {
        if (prev.search === searchInput && prev.customer === customerInput) return prev;
        changed = true;
        return { ...prev, search: searchInput, customer: customerInput };
      });
      if (changed) {
        setPagination((p) => (p.currentPage === 1 ? p : { ...p, currentPage: 1 }));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, customerInput]);

  const fetchAccountsReceivable = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.customer) params.append('customer', filters.customer);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.search) params.append('search', filters.search);
      params.append('page', pagination.currentPage);
      params.append('limit', pagination.limit);
      params.append('companyId', selectedCompanyId);

      const response = await api.get(`/finance/accounts-receivable?${params}`);
      if (response.data.success) {
        setInvoices(response.data.data.invoices || []);
        setPagination((prev) => ({
          ...prev,
          currentPage: response.data.data.pagination?.currentPage ?? prev.currentPage,
          totalPages: response.data.data.pagination?.totalPages ?? prev.totalPages,
          totalCount: response.data.data.pagination?.totalCount ?? prev.totalCount,
          limit: response.data.data.pagination?.limit ?? prev.limit
        }));
        setSummary(response.data.data.summary || {
          totalOutstanding: 0,
          totalOverdue: 0,
          totalPaid: 0,
          totalInvoices: response.data.data.pagination?.totalCount || 0
        });
      }
    } catch (error) {
      console.error('Error fetching accounts receivable:', error);
      setError('Failed to fetch accounts receivable data');
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
    fetchAccountsReceivable();
  }, [fetchAccountsReceivable, selectedCompanyId]);

  const applyDateFilters = (nextStart, nextEnd) => {
    const start = nextStart ?? startDateInput;
    const end = nextEnd ?? endDateInput;
    if (start && !isValidYmd(start)) {
      setStartDateInput(filters.startDate);
      return;
    }
    if (end && !isValidYmd(end)) {
      setEndDateInput(filters.endDate);
      return;
    }
    if (filters.startDate === start && filters.endDate === end) return;
    setFilters((prev) => ({ ...prev, startDate: start, endDate: end }));
    setPagination((p) => (p.currentPage === 1 ? p : { ...p, currentPage: 1 }));
  };

  // Customer name → the invoice's print preview directly: the invoice print page loads in a hidden frame and
  // prints itself, so there's no extra screen in between. The frame is removed after printing.
  const printInvoiceDirect = (invoiceId) => {
    if (!invoiceId) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;height:1400px;border:0;';
    frame.src = `/finance/invoice-print/${invoiceId}?autoprint=1`;
    const cleanup = () => { if (frame.parentNode) frame.parentNode.removeChild(frame); };
    frame.onload = () => {
      try { frame.contentWindow.addEventListener('afterprint', () => setTimeout(cleanup, 500)); } catch { /* ignore */ }
    };
    setTimeout(cleanup, 10 * 60 * 1000);
    document.body.appendChild(frame);
    toast.success('Opening print preview…', { duration: 1500 });
  };

  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const selectedMonthKey = monthOptions.find((o) => o.start === filters.startDate && o.end === filters.endDate)?.key || '';
  const handleMonthChange = (event) => {
    const opt = monthOptions.find((o) => o.key === event.target.value);
    if (!opt) return;
    setStartDateInput(opt.start);
    setEndDateInput(opt.end);
    applyDateFilters(opt.start, opt.end);
  };

  const handleDateInputChange = (field) => (event) => {
    const value = event.target.value;
    if (field === 'startDate') setStartDateInput(value);
    else setEndDateInput(value);
    // Do not fetch while editing — wait for blur
  };

  const handleDateBlur = (field) => () => {
    if (field === 'startDate') applyDateFilters(startDateInput, endDateInput);
    else applyDateFilters(startDateInput, endDateInput);
  };

  const handleDateKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.target.blur();
    }
  };

  const handleFilterChange = (field) => (event) => {
    setFilters((prev) => ({
      ...prev,
      [field]: event.target.value
    }));
    setPagination((prev) => ({ ...prev, currentPage: 1 }));
  };

  const handlePageChange = (event, page) => {
    setPagination((prev) => ({ ...prev, currentPage: page }));
  };

  const handleViewInvoice = async (invoice) => {
    try {
      setLoading(true);
      const response = await api.get(`/finance/accounts-receivable/${invoice._id}`);
      if (response.data.success) {
        setSelectedInvoice(response.data.data);
        syncInstallmentDraft(response.data.data);
        setViewDialogOpen(true);
      }
    } catch (error) {
      console.error('Error fetching invoice details:', error);
      toast.error('Failed to fetch invoice details');
    } finally {
      setLoading(false);
    }
  };

  
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [preselectedInstallmentId, setPreselectedInstallmentId] = useState(null);
  const [installmentDraft, setInstallmentDraft] = useState([]);
  const [savingInstallments, setSavingInstallments] = useState(false);

  const handleOpenPayment = (invoice, installmentId = null) => {
    setSelectedInvoice(invoice);
    setPreselectedInstallmentId(installmentId);
    setPaymentModalOpen(true);
  };

  const syncInstallmentDraft = (invoice) => {
    const outstanding = Math.round(((invoice.totalAmount || 0) - (invoice.paidAmount || invoice.amountPaid || 0)) * 100) / 100;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const existing = (invoice.installments || []).map((i) => {
      const amount = Number(i.amount) || 0;
      const paidAmount = Number(i.paidAmount) || 0;
      let status = i.status || 'pending';
      if (paidAmount >= amount - 0.01 && amount > 0) status = 'paid';
      else if (paidAmount > 0) status = 'partial';
      else if (
        i.dueDate &&
        new Date(i.dueDate) < todayStart &&
        status !== 'paid' &&
        status !== 'cancelled'
      ) {
        status = 'overdue';
      }
      return {
        _id: i._id,
        sequence: i.sequence,
        amount,
        dueDate: i.dueDate ? new Date(i.dueDate).toISOString().split('T')[0] : '',
        status,
        paidAmount,
        notes: i.notes || '',
        lastJournalEntry: (() => {
          const id = i.lastJournalEntry?._id || i.lastJournalEntry || null;
          return /^[a-fA-F0-9]{24}$/.test(String(id || '')) ? String(id) : null;
        })(),
        locked: status === 'paid' || paidAmount > 0
      };
    });
    if (existing.length) {
      setInstallmentDraft(existing);
      return;
    }
    if (outstanding > 0) {
      const half = Math.round((outstanding / 2) * 100) / 100;
      const rest = Math.round((outstanding - half) * 100) / 100;
      const d1 = new Date();
      const d2 = new Date();
      d2.setDate(d2.getDate() + 30);
      setInstallmentDraft([
        { amount: half, dueDate: d1.toISOString().split('T')[0], status: 'pending', paidAmount: 0, locked: false },
        { amount: rest, dueDate: d2.toISOString().split('T')[0], status: 'pending', paidAmount: 0, locked: false }
      ]);
    } else {
      setInstallmentDraft([]);
    }
  };

  const getInstallmentCapInfo = (invoice, draft) => {
    const outstanding = Math.round(((invoice?.totalAmount || 0) - (invoice?.paidAmount || invoice?.amountPaid || 0)) * 100) / 100;
    const lockedRemaining = Math.round(
      (draft || [])
        .filter((r) => r.locked)
        .reduce((s, r) => s + Math.max(0, (Number(r.amount) || 0) - (Number(r.paidAmount) || 0)), 0) * 100
    ) / 100;
    const needFromNew = Math.round(Math.max(0, outstanding - lockedRemaining) * 100) / 100;
    const unlockedSum = Math.round(
      (draft || []).filter((r) => !r.locked).reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100
    ) / 100;
    const planTotal = Math.round((draft || []).reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
    return { outstanding, needFromNew, unlockedSum, planTotal, overBy: Math.round((unlockedSum - needFromNew) * 100) / 100 };
  };

  const handleInstallmentAmountChange = (idx, raw) => {
    const num = Math.max(0, Number(raw) || 0);
    setInstallmentDraft((prev) => {
      const info = getInstallmentCapInfo(selectedInvoice, prev);
      const others = prev.reduce((s, r, i) => (i === idx || r.locked ? s : s + (Number(r.amount) || 0)), 0);
      const maxThis = Math.max(0, Math.round((info.needFromNew - others) * 100) / 100);
      const capped = Math.min(num, maxThis);
      if (num > maxThis + 0.001) {
        toast.error(`Cannot exceed outstanding. Max for this part: PKR ${maxThis.toLocaleString('en-PK', { minimumFractionDigits: 2 })}`);
      }
      return prev.map((r, i) => (i === idx ? { ...r, amount: capped } : r));
    });
  };

  
  const handleOpenEdit = (invoice) => {
    if (!invoice?._id) {
      toast.error('Invoice not found');
      return;
    }
    navigate(`/finance/accounts-receivable/${invoice._id}/edit`);
  };

  const canDeleteInvoice = (invoice) => {
    const paid = Number(invoice.paidAmount ?? invoice.amountPaid ?? 0);
    const hasPayments = Array.isArray(invoice.payments) && invoice.payments.length > 0;
    const hasInstallmentPaid = (invoice.installments || []).some(
      (i) => Number(i.paidAmount || 0) > 0 || i.status === 'paid'
    );
    return paid <= 0 && !hasPayments && !hasInstallmentPaid;
  };

  const handleOpenDelete = (invoice) => {
    setInvoiceToDelete(invoice);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!invoiceToDelete) return;
    try {
      setDeletingInvoice(true);
      const res = await api.delete(`/finance/accounts-receivable/${invoiceToDelete._id}`);
      if (res.data?.success || res.status === 200) {
        toast.success(res.data?.message || `Invoice ${invoiceToDelete.invoiceNumber} deleted`);
        setDeleteDialogOpen(false);
        setInvoiceToDelete(null);
        if (selectedInvoice && String(selectedInvoice._id) === String(invoiceToDelete._id)) {
          setViewDialogOpen(false);
          setSelectedInvoice(null);
        }
        fetchAccountsReceivable();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete invoice');
    } finally {
      setDeletingInvoice(false);
    }
  };

  const handleSaveInstallments = async () => {
    if (!selectedInvoice?._id) return;
    const editable = installmentDraft.filter((r) => !r.locked);
    if (editable.some((r) => !r.dueDate || !(Number(r.amount) > 0))) {
      toast.error('Each installment needs amount and due date');
      return;
    }
    const cap = getInstallmentCapInfo(selectedInvoice, installmentDraft);
    if (cap.overBy > 0.05) {
      toast.error(`Installments exceed outstanding by PKR ${cap.overBy.toFixed(2)}`);
      return;
    }
    if (Math.abs(cap.unlockedSum - cap.needFromNew) > 0.05) {
      toast.error(`Unpaid parts must total PKR ${cap.needFromNew.toFixed(2)} (currently ${cap.unlockedSum.toFixed(2)})`);
      return;
    }
    try {
      setSavingInstallments(true);
      const res = await api.put(`/finance/accounts-receivable/${selectedInvoice._id}/installments`, {
        installments: installmentDraft.map((r) => ({
          _id: r._id,
          amount: Number(r.amount),
          dueDate: r.dueDate,
          status: r.status,
          paidAmount: r.paidAmount,
          notes: r.notes || ''
        }))
      });
      if (res.data?.success) {
        toast.success(res.data.message || 'Installment schedule saved');
        setSelectedInvoice(res.data.data);
        syncInstallmentDraft(res.data.data);
        fetchAccountsReceivable();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save installments');
    } finally {
      setSavingInstallments(false);
    }
  };

  const addInstallmentRow = () => {
    const cap = getInstallmentCapInfo(selectedInvoice, installmentDraft);
    const room = Math.round((cap.needFromNew - cap.unlockedSum) * 100) / 100;
    if (room <= 0) {
      toast.error('No remaining amount — installments already cover the outstanding balance');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    setInstallmentDraft((prev) => [...prev, { amount: room, dueDate: today, status: 'pending', paidAmount: 0, locked: false }]);
  };

  const removeInstallmentRow = (idx) => {
    setInstallmentDraft((prev) => prev.filter((r, i) => i !== idx || r.locked));
  };

  const getStatusColor = (status) => {
    const colorMap = {
      'pending': 'warning',
      'paid': 'success',
      'overdue': 'error',
      'partial': 'info',
      'cancelled': 'default'
    };
    return colorMap[status] || 'default';
  };

  const getStatusIcon = (status) => {
    const iconMap = {
      'pending': <WarningIcon />,
      'paid': <CheckCircleIcon />,
      'overdue': <WarningIcon />,
      'partial': <TrendingUpIcon />,
      'cancelled': <AccountBalanceIcon />
    };
    return iconMap[status] || <AccountBalanceIcon />;
  };

  const calculateAge = (date) => {
    const today = new Date();
    const invoiceDate = new Date(date);
    const diffTime = Math.abs(today - invoiceDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getAgingColor = (days) => {
    if (days <= 30) return 'success';
    if (days <= 60) return 'warning';
    return 'error';
  };

  const getInvoiceOutstanding = (invoice) =>
    Math.round(((invoice.totalAmount || 0) - (invoice.paidAmount ?? invoice.amountPaid ?? 0)) * 100) / 100;

  /**
   * Per-invoice overdue balance — mirrors server summary `_overdueAmount`:
   * - with installments: sum of unpaid installment balances past due
   * - without: full outstanding if invoice due date has passed (or status is overdue)
   */
  const getInvoiceOverdue = (invoice) => {
    if (!invoice || invoice.status === 'cancelled' || invoice.status === 'paid') return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const installments = Array.isArray(invoice.installments) ? invoice.installments : [];
    if (installments.length > 0) {
      const overdue = installments.reduce((sum, inst) => {
        if (!inst || inst.status === 'paid' || inst.status === 'cancelled') return sum;
        const bal = Math.max(
          0,
          Math.round(((Number(inst.amount) || 0) - (Number(inst.paidAmount) || 0)) * 100) / 100
        );
        if (bal <= 0) return sum;
        const due = inst.dueDate ? new Date(inst.dueDate) : null;
        if (due) due.setHours(0, 0, 0, 0);
        const isPastDue = inst.status === 'overdue' || (due && due < today);
        return isPastDue ? sum + bal : sum;
      }, 0);
      return Math.round(overdue * 100) / 100;
    }

    const outstanding = getInvoiceOutstanding(invoice);
    if (outstanding <= 0) return 0;
    const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
    if (due) due.setHours(0, 0, 0, 0);
    const isPastDue = invoice.status === 'overdue' || (due && due < today);
    return isPastDue ? outstanding : 0;
  };

  const isValidVoucherId = (id) => /^[a-fA-F0-9]{24}$/.test(String(id || '').trim());

  /** Only real receipt vouchers — never show chip without a linked journal entry id */
  const getLatestReceiptVoucherId = (invoice) => {
    const paid = Number(invoice.paidAmount ?? invoice.amountPaid ?? 0);
    if (paid <= 0 && !(invoice.payments || []).length) return null;

    const payments = [...(invoice.payments || [])].reverse();
    for (const p of payments) {
      const id = p.journalEntry?._id || p.journalEntry;
      if (isValidVoucherId(id)) return String(id);
    }
    const installments = [...(invoice.installments || [])].reverse();
    for (const i of installments) {
      const id = i.lastJournalEntry?._id || i.lastJournalEntry;
      if (isValidVoucherId(id)) return String(id);
    }
    return null;
  };

  if (initialLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>Loading Accounts Receivable...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {loading && <LinearProgress sx={{ mb: 1, borderRadius: 1 }} />}
      {/* Header */}
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.1)} 100%)` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: theme.palette.success.main }}>
              <BusinessIcon />
            </Avatar>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.success.main }}>
                Accounts Receivable
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Manage customer invoices and payments
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <FinanceCompanySelector minWidth={240} showHelper={false} />
            <Button variant="outlined" size="small" color="warning"
              onClick={() => navigate('/finance/credit-notes')} sx={{ fontSize: 12 }}>
              Credit Notes
            </Button>
            <Button variant="outlined" size="small" color="success"
              onClick={() => navigate('/finance/customer-payments')} sx={{ fontSize: 12 }}>
              Payments
            </Button>
            <Button variant="outlined" size="small"
              onClick={() => navigate('/finance/customers')} sx={{ fontSize: 12 }}>
              Customers
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={fetchAccountsReceivable}
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
              onClick={() => { setSelectedInvoice(null); setPaymentModalOpen(true); }}
              sx={{ mr: 2 }}
            >
              Receive Payment
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/finance/accounts-receivable/new')}
            >
              New Invoice
            </Button>
          </Box>
        </Box>

        {/* Filters */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel shrink>Month</InputLabel>
              <Select
                value={selectedMonthKey}
                onChange={handleMonthChange}
                label="Month"
                displayEmpty
                notched
                renderValue={(v) => (v ? monthOptions.find((o) => o.key === v)?.label : 'Custom dates')}
              >
                {monthOptions.map((o, i) => [
                  <MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>,
                  i === 0 ? <Divider key="divider" /> : null
                ])}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              type="date"
              label="Start Date"
              value={startDateInput}
              onChange={handleDateInputChange('startDate')}
              onBlur={handleDateBlur('startDate')}
              onKeyDown={handleDateKeyDown}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              type="date"
              label="End Date"
              value={endDateInput}
              onChange={handleDateInputChange('endDate')}
              onBlur={handleDateBlur('endDate')}
              onKeyDown={handleDateKeyDown}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={filters.status}
                onChange={handleFilterChange('status')}
                label="Status"
              >
                <MenuItem value="">All Status</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="paid">Paid</MenuItem>
                <MenuItem value="overdue">Overdue</MenuItem>
                <MenuItem value="partial">Partial</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              label="Customer"
              value={customerInput}
              onChange={(e) => setCustomerInput(e.target.value)}
              placeholder="Search customers"
              size="small"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              label="Search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search invoices"
              size="small"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

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
                    {summary.totalInvoices} invoices
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'warning.main' }}>
                  <BusinessIcon />
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
                    Total Invoices
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                    {summary.totalInvoices}
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

      {/* Accounts Receivable Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Invoice Details
          </Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Invoice #</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Outstanding</TableCell>
                  <TableCell align="right">Overdue</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Aging</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.map((invoice) => {
                  const days = calculateAge(invoice.invoiceDate);
                  const outstanding = getInvoiceOutstanding(invoice);
                  const overdue = getInvoiceOverdue(invoice);
                  const voucherId = getLatestReceiptVoucherId(invoice);
                  const canMakePayment = outstanding > 0.01 && invoice.status !== 'paid' && invoice.status !== 'cancelled';
                  return (
                    <TableRow key={invoice._id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                          {invoice.invoiceNumber}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Tooltip title="Print invoice">
                            <Typography
                              component="button"
                              type="button"
                              variant="body2"
                              onClick={() => printInvoiceDirect(invoice._id)}
                              sx={{
                                font: 'inherit', fontWeight: 'bold', p: 0, border: 0, bgcolor: 'transparent',
                                color: 'primary.main', cursor: 'pointer', textAlign: 'left',
                                '&:hover': { textDecoration: 'underline' }
                              }}
                            >
                              {invoice.customer?.name || invoice.customerName || 'Unknown Customer'}
                            </Typography>
                          </Tooltip>
                          <Typography variant="caption" color="textSecondary">
                            {invoice.customer?.email || invoice.customerEmail || ''}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatDate(invoice.invoiceDate)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatDate(invoice.dueDate)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                          {formatPKR(invoice.totalAmount)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                          {formatPKR(invoice.paidAmount ?? invoice.amountPaid ?? 0)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography 
                          variant="body2" 
                          sx={{ 
                            fontWeight: 'bold',
                            color: outstanding > 0 ? 'warning.main' : 'success.main'
                          }}
                        >
                          {formatPKR(outstanding)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 'bold',
                            color: overdue > 0 ? 'error.main' : 'text.secondary'
                          }}
                        >
                          {formatPKR(overdue)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={invoice.status?.toUpperCase() || 'UNKNOWN'} 
                          size="small" 
                          color={getStatusColor(invoice.status)}
                          icon={getStatusIcon(invoice.status)}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={`${days} days`}
                          size="small" 
                          color={getAgingColor(days)}
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Tooltip title="View Details">
                            <IconButton 
                              size="small"
                              onClick={() => handleViewInvoice(invoice)}
                            >
                              <ViewIcon />
                            </IconButton>
                          </Tooltip>
                          {isValidVoucherId(voucherId) && (
                            <Tooltip title="View receipt voucher">
                              <Chip
                                onClick={() => navigate(`/finance/vouchers/${voucherId}`)}
                                label="VOUCHER CREATED"
                                size="small"
                                color="success"
                                variant="filled"
                                sx={{ height: 26, fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer' }}
                              />
                            </Tooltip>
                          )}
                          {canMakePayment && (
                            <Tooltip title="Make Payment">
                              <IconButton 
                                size="small" 
                                color="success"
                                onClick={() => handleOpenPayment(invoice)}
                              >
                                <PaymentIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Edit Invoice">
                            <IconButton 
                              size="small"
                              onClick={() => handleOpenEdit(invoice)}
                            >
                              <EditIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={canDeleteInvoice(invoice) ? 'Delete Invoice' : 'Cannot delete invoice with recorded payments'}>
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleOpenDelete(invoice)}
                                disabled={!canDeleteInvoice(invoice)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          {canMakePayment && !invoice.invoiceNumber?.startsWith('CN-') && (
                            <Tooltip title="Issue Credit Note">
                              <IconButton size="small" color="warning"
                                onClick={() => setCreditNoteDialog({ open: true, invoice, amount: invoice.totalAmount, reason: '' })}>
                                <CreditNoteIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Print / Download Invoice">
                            <IconButton size="small" color="default"
                              onClick={() => navigate(`/finance/invoice-print/${invoice._id}`)}>
                              <PrintIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Send Invoice by Email">
                            <IconButton size="small" color="info"
                              onClick={() => setEmailDialog({ open: true, invoice })}>
                              <EmailIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {invoices.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="h6" color="textSecondary">
                No invoices found
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                Create your first invoice to get started
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/finance/accounts-receivable/new')}
              >
                Create First Invoice
              </Button>
            </Box>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination
                count={pagination.totalPages}
                page={pagination.currentPage}
                onChange={handlePageChange}
                color="primary"
              />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Invoice Details Dialog */}
      <Dialog 
        open={viewDialogOpen} 
        onClose={() => setViewDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Invoice Details: {selectedInvoice?.invoiceNumber}
          <IconButton onClick={() => setViewDialogOpen(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedInvoice && (
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" color="textSecondary">Customer Information</Typography>
                <Typography variant="body1" sx={{ fontWeight: 'bold' }}>{selectedInvoice.customer?.name || selectedInvoice.customerName}</Typography>
                <Typography variant="body2">{selectedInvoice.customer?.email || selectedInvoice.customerEmail}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" color="textSecondary">Invoice Status</Typography>
                <Chip 
                  label={selectedInvoice.status?.toUpperCase()} 
                  color={getStatusColor(selectedInvoice.status)}
                  size="small"
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="subtitle2" color="textSecondary">Invoice Date</Typography>
                <Typography variant="body2">{formatDate(selectedInvoice.invoiceDate)}</Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="subtitle2" color="textSecondary">Due Date</Typography>
                <Typography variant="body2">{formatDate(selectedInvoice.dueDate)}</Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="subtitle2" color="textSecondary">Cost Center</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {selectedInvoice.costCenter
                    ? (typeof selectedInvoice.costCenter === 'object'
                      ? [selectedInvoice.costCenter.code, selectedInvoice.costCenter.name].filter(Boolean).join(' — ') || '—'
                      : String(selectedInvoice.costCenter))
                    : '—'}
                </Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="subtitle2" color="textSecondary">Amount</Typography>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{formatPKR(selectedInvoice.totalAmount)}</Typography>
              </Grid>

              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <InstallmentIcon /> Installment Schedule
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button size="small" startIcon={<AddIcon />} onClick={addInstallmentRow} disabled={selectedInvoice.status === 'paid'}>
                      Add part
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={handleSaveInstallments}
                      disabled={
                        savingInstallments ||
                        selectedInvoice.status === 'paid' ||
                        getInstallmentCapInfo(selectedInvoice, installmentDraft).overBy > 0.05
                      }
                    >
                      {savingInstallments ? 'Saving…' : 'Save schedule'}
                    </Button>
                  </Box>
                </Box>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  Schedule only — no voucher until you record a receipt. Parts cannot exceed outstanding.
                  {(selectedInvoice.installments || []).length > 0
                    ? ' After a schedule is saved, receive payment only against installment parts.'
                    : ' Without a schedule, you can still use Record Payment for a full / custom receipt.'}
                </Typography>
                {(() => {
                  const cap = getInstallmentCapInfo(selectedInvoice, installmentDraft);
                  const ok = Math.abs(cap.unlockedSum - cap.needFromNew) <= 0.05;
                  return (
                    <Alert severity={ok ? 'success' : 'warning'} sx={{ mb: 1 }}>
                      Outstanding: <strong>{formatPKR(cap.outstanding)}</strong>
                      {' · '}Unpaid parts total: <strong>{formatPKR(cap.unlockedSum)}</strong>
                      {' · '}Must equal: <strong>{formatPKR(cap.needFromNew)}</strong>
                      {cap.overBy > 0.05 ? ` — over by ${formatPKR(cap.overBy)}` : ''}
                    </Alert>
                  );
                })()}
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Amount</TableCell>
                      <TableCell>Due Date</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Paid</TableCell>
                      <TableCell align="center">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {installmentDraft.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', py: 2 }}>
                          No installments — click Add part, or use full receipt via Record Payment.
                        </TableCell>
                      </TableRow>
                    ) : (
                      installmentDraft.map((row, idx) => (
                        <TableRow key={row._id || idx}>
                          <TableCell>{row.sequence || idx + 1}</TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              type="number"
                              value={row.amount}
                              disabled={row.locked}
                              onChange={(e) => handleInstallmentAmountChange(idx, e.target.value)}
                              inputProps={{ min: 0, step: 0.01 }}
                              sx={{ width: 120 }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              type="date"
                              value={row.dueDate}
                              disabled={row.locked}
                              onChange={(e) => {
                                const val = e.target.value;
                                setInstallmentDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, dueDate: val } : r)));
                              }}
                              InputLabelProps={{ shrink: true }}
                            />
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                              <Chip
                                size="small"
                                label={row.status || 'pending'}
                                color={
                                  row.status === 'paid'
                                    ? 'success'
                                    : row.status === 'overdue'
                                      ? 'error'
                                      : row.status === 'partial'
                                        ? 'info'
                                        : 'default'
                                }
                              />
                              {isValidVoucherId(row.lastJournalEntry) && (
                                <Tooltip title="View receipt voucher">
                                  <Chip
                                    onClick={() => navigate(`/finance/vouchers/${row.lastJournalEntry}`)}
                                    label="VOUCHER CREATED"
                                    size="small"
                                    color="success"
                                    variant="filled"
                                    sx={{ height: 22, fontWeight: 'bold', fontSize: '0.65rem', cursor: 'pointer' }}
                                  />
                                </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell align="right">{formatPKR(row.paidAmount || 0)}</TableCell>
                          <TableCell align="center">
                            {!row.locked && (
                              <IconButton size="small" onClick={() => removeInstallmentRow(idx)} title="Remove">
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            )}
                            {row._id && row.status !== 'paid' && (Number(row.amount) - Number(row.paidAmount || 0)) > 0 && (
                              <Button
                                size="small"
                                color="success"
                                onClick={() => {
                                  setViewDialogOpen(false);
                                  handleOpenPayment(selectedInvoice, row._id);
                                }}
                              >
                                Receive
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Grid>

              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle1" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HistoryIcon /> Payment History
                </Typography>
                {selectedInvoice.payments && selectedInvoice.payments.length > 0 ? (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Method</TableCell>
                        <TableCell>Reference</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Voucher</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedInvoice.payments.map((payment, index) => {
                        const jeId = payment.journalEntry?._id || payment.journalEntry || null;
                        const hasVoucher = isValidVoucherId(jeId);
                        return (
                          <TableRow key={index}>
                            <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                            <TableCell>{payment.paymentMethod?.replace('_', ' ')}</TableCell>
                            <TableCell>{payment.reference || '-'}</TableCell>
                            <TableCell align="right">{formatPKR(payment.amount)}</TableCell>
                            <TableCell>
                              {hasVoucher ? (
                                <Tooltip title="View receipt voucher">
                                  <Chip
                                    onClick={() => navigate(`/finance/vouchers/${jeId}`)}
                                    label="VOUCHER CREATED"
                                    size="small"
                                    color="success"
                                    variant="filled"
                                    sx={{ height: 22, fontWeight: 'bold', fontSize: '0.65rem', cursor: 'pointer' }}
                                  />
                                </Tooltip>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <Typography variant="body2" color="textSecondary">No payments recorded yet</Typography>
                )}
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialogOpen(false)}>Close</Button>
          {selectedInvoice && (
            <Button
              startIcon={<EditIcon />}
              onClick={() => {
                setViewDialogOpen(false);
                handleOpenEdit(selectedInvoice);
              }}
            >
              Edit
            </Button>
          )}
          {selectedInvoice && canDeleteInvoice(selectedInvoice) && (
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => {
                setViewDialogOpen(false);
                handleOpenDelete(selectedInvoice);
              }}
            >
              Delete
            </Button>
          )}
          <Button 
            variant="contained" 
            color="success" 
            onClick={() => {
              setViewDialogOpen(false);
              handleOpenPayment(selectedInvoice, null);
            }}
            disabled={!selectedInvoice || getInvoiceOutstanding(selectedInvoice) <= 0.01 || selectedInvoice.status === 'paid'}
          >
            {(selectedInvoice?.installments || []).length > 0
              ? 'Receive Installment Payment'
              : 'Record Full / Custom Payment'}
          </Button>
        </DialogActions>
      </Dialog>

      
      <QuickbooksReceivePaymentModal
        open={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false);
          setPreselectedInstallmentId(null);
        }}
        onSuccess={fetchAccountsReceivable}
        selectedCompanyId={selectedCompanyId}
        preselectedCustomerId={selectedInvoice?.customer?.customerId || selectedInvoice?.customer?._id || selectedInvoice?.customerId || ''}
        preselectedCustomerName={selectedInvoice?.customer?.name || selectedInvoice?.customerName}
        preselectedInvoiceId={selectedInvoice?._id}
        preselectedInstallmentId={preselectedInstallmentId}
      />


      {/* Credit Note Dialog */}
      <Dialog open={creditNoteDialog.open} onClose={() => setCreditNoteDialog({ open: false, invoice: null, amount: '', reason: '' })} maxWidth="sm" fullWidth>
        <DialogTitle>
          Issue Credit Note
          <Typography variant="body2" color="text.secondary">Invoice: {creditNoteDialog.invoice?.invoiceNumber}</Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A Credit Note reduces the amount owed by the customer. It posts a reversal journal entry (DR Revenue / CR AR).
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField fullWidth label="Credit Note Amount (PKR)" type="number"
                value={creditNoteDialog.amount}
                onChange={e => setCreditNoteDialog(p => ({ ...p, amount: e.target.value }))}
                inputProps={{ min: 0.01, max: creditNoteDialog.invoice?.totalAmount, step: 0.01 }}
                helperText={`Max: PKR ${Number(creditNoteDialog.invoice?.totalAmount || 0).toLocaleString()}`}
                size="small" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Reason" multiline rows={2}
                value={creditNoteDialog.reason}
                onChange={e => setCreditNoteDialog(p => ({ ...p, reason: e.target.value }))}
                placeholder="e.g. Goods returned, pricing error, service issue…"
                size="small" />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreditNoteDialog({ open: false, invoice: null, amount: '', reason: '' })}>Cancel</Button>
          <Button variant="contained" color="warning"
            onClick={async () => {
              try {
                const res = await api.post(`/finance/accounts-receivable/${creditNoteDialog.invoice._id}/credit-note`, {
                  amount: Number(creditNoteDialog.amount),
                  reason: creditNoteDialog.reason
                });
                if (res.data.success) {
                  setCreditNoteDialog({ open: false, invoice: null, amount: '', reason: '' });
                  fetchAccountsReceivable();
                }
              } catch (err) {
                alert(err.response?.data?.message || 'Failed to create credit note');
              }
            }}
            disabled={!creditNoteDialog.amount || creditNoteDialog.amount <= 0}
          >
            Issue Credit Note
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Email Invoice Dialog ─────────────────────────────────────────── */}
      <Dialog open={emailDialog.open} onClose={() => setEmailDialog({ open: false, invoice: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Send Invoice by Email</DialogTitle>
        <DialogContent>
          {emailDialog.invoice && (
            <Box pt={1}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Send invoice <strong>{emailDialog.invoice.invoiceNumber}</strong> to:
              </Typography>
              <Typography variant="body1" fontWeight={600} color="primary.main">
                {emailDialog.invoice.customer?.name} &lt;{emailDialog.invoice.customer?.email}&gt;
              </Typography>
              {!emailDialog.invoice.customer?.email && (
                <Alert severity="warning" sx={{ mt: 1 }}>This customer has no email address on file.</Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmailDialog({ open: false, invoice: null })}>Cancel</Button>
          <Button
            variant="contained"
            color="info"
            disabled={emailSending || !emailDialog.invoice?.customer?.email}
            startIcon={<EmailIcon />}
            onClick={async () => {
              setEmailSending(true);
              try {
                await api.post(`/finance/accounts-receivable/${emailDialog.invoice._id}/send-email`);
                toast.success('Invoice emailed successfully!');
                setEmailDialog({ open: false, invoice: null });
              } catch (e) {
                toast.error(e.response?.data?.message || 'Failed to send email');
              } finally {
                setEmailSending(false);
              }
            }}
          >
            {emailSending ? 'Sending…' : 'Send Email'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Invoice Confirm */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => !deletingInvoice && setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DeleteIcon color="error" /> Delete Invoice
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to delete invoice{' '}
            <strong>{invoiceToDelete?.invoiceNumber}</strong>
            {invoiceToDelete?.customer?.name || invoiceToDelete?.customerName
              ? <> for <strong>{invoiceToDelete?.customer?.name || invoiceToDelete?.customerName}</strong></>
              : null}
            {' '}({formatPKR(invoiceToDelete?.totalAmount || 0)})?
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Linked invoice journal entries will also be removed. Invoices with payments cannot be deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deletingInvoice}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmDelete}
            disabled={deletingInvoice}
          >
            {deletingInvoice ? 'Deleting…' : 'Delete Invoice'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AccountsReceivable;
