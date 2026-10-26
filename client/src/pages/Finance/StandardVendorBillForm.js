import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Autocomplete,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Tooltip,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  createFilterOptions
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  ExpandMore as ExpandMoreIcon,
  CloudUpload as CloudUploadIcon,
  Save as SaveIcon,
  Send as SendIcon,
  ArrowBack as ArrowBackIcon,
  Close as CloseIcon,
  Storefront as StorefrontIcon,
  AccountBalanceWallet as AccountBalanceWalletIcon
} from '@mui/icons-material';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatPKR } from '../../utils/currency';
import { useAuth } from '../../contexts/AuthContext';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import {
  fetchFinanceAuthorityCandidates,
  userOptionLabel,
  userOptionSecondary
} from '../../services/financeApprovalAuthorityService';

const SR_MANAGER_FINANCE_NAME = 'Muhammad Iftikhar Rashid';
const GM_FINANCE_NAME = 'Faisal Farooq';

const matchUserByName = (list, targetName) => {
  const target = String(targetName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!target) return null;
  const targetParts = target.split(' ').filter(Boolean);
  return (list || []).find((user) => {
    const full = `${user.firstName || ''} ${user.lastName || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
    if (full === target) return true;
    if (targetParts.every((part) => full.includes(part))) return true;
    return false;
  }) || null;
};

const vendorFilterOptions = createFilterOptions({
  stringify: (option) => `${option.name} ${option.phone || ''} ${option.email || ''} ${option.ntnCnic || ''} ${option.supplierId || ''}`.trim(),
});

const DEFAULT_TERMS = [
  { value: 'due_on_receipt', label: 'Due on receipt', days: 0 },
  { value: 'Cash', label: 'Cash / Due on receipt', days: 0 },
  { value: 'net_15', label: 'Net 15', days: 15 },
  { value: '15 Days', label: '15 Days', days: 15 },
  { value: 'net_30', label: 'Net 30', days: 30 },
  { value: '30 Days', label: '30 Days', days: 30 },
  { value: 'net_45', label: 'Net 45', days: 45 },
  { value: '45 Days', label: '45 Days', days: 45 },
  { value: 'net_60', label: 'Net 60', days: 60 },
  { value: '60 Days', label: '60 Days', days: 60 },
  { value: 'net_90', label: 'Net 90', days: 90 },
  { value: '90 Days', label: '90 Days', days: 90 },
  { value: 'custom', label: 'Custom', days: 30 }
];

const emptyCategoryLine = () => ({
  id: Date.now() + Math.random(),
  account: null,
  description: '',
  amount: '',
  project: '',
  company: ''
});

const emptyItemLine = () => ({
  id: Date.now() + Math.random(),
  itemName: '',
  description: '',
  quantity: 1,
  unitPrice: '',
  amount: '',
  project: ''
});

const StandardVendorBillForm = ({ onSwitchToStoreBill }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { selectedCompanyId } = useFinanceCompany();

  const isProcurement = location.pathname.startsWith('/procurement');
  const backPath = searchParams.get('from') || (isProcurement ? '/procurement/vendor-bills' : '/finance/accounts-payable');

  // Supplier & Bill Meta
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [mailingAddress, setMailingAddress] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState('');

  // Lines
  const [categoryLines, setCategoryLines] = useState([emptyCategoryLine(), emptyCategoryLine()]);
  const [itemLines, setItemLines] = useState([]);
  const [itemAccordionOpen, setItemAccordionOpen] = useState(false);
  const [categoryAccordionOpen, setCategoryAccordionOpen] = useState(true);

  // COA Accounts & Projects
  const [accounts, setAccounts] = useState([]);
  const [projectsList, setProjectsList] = useState([]);
  const [companiesList, setCompaniesList] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [loadingMaster, setLoadingMaster] = useState(false);

  // Attachments
  const [attachments, setAttachments] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  // Quick Add Account Dialog
  const [newAccountDialog, setNewAccountDialog] = useState(false);
  const [newAccountRowIndex, setNewAccountRowIndex] = useState(null);
  const [newAccountForm, setNewAccountForm] = useState({
    name: '',
    accountNumber: '',
    type: 'Expense',
    category: 'Operating Expenses',
    description: ''
  });
  const [creatingAccount, setCreatingAccount] = useState(false);

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

  const handleSaveNewVendor = async (e) => {
    e.preventDefault();
    if (!newVendorForm.name.trim()) return;
    try {
      setCreatingVendor(true);
      const res = await api.post('/procurement/vendors/quick', newVendorForm);
      if (res.data.success) {
        const createdVendor = res.data.data;
        // Update local list
        setVendors((prev) => [createdVendor, ...prev]);
        // Set selection
        setSelectedVendor(createdVendor);
        
        // Auto-fill mailing address and payment terms
        const parts = [
          createdVendor.name,
          createdVendor.address && createdVendor.address !== '—' ? createdVendor.address : null,
          createdVendor.phone && createdVendor.phone !== '—' ? `Phone: ${createdVendor.phone}` : null,
          createdVendor.email && !createdVendor.email.includes('@sgc.local') ? `Email: ${createdVendor.email}` : null
        ].filter(Boolean);
        setMailingAddress(parts.join('\n'));
        if (createdVendor.paymentTerms) {
          setPaymentTerms(createdVendor.paymentTerms);
        }

        // Reset
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
      alert(err.response?.data?.message || 'Failed to create vendor');
    } finally {
      setCreatingVendor(false);
    }
  };

  // Form submitting
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [financeAuthorityCandidates, setFinanceAuthorityCandidates] = useState([]);
  const [billFinAuth, setBillFinAuth] = useState({
    srManagerFinance: null,
    gmFinance: null
  });

  // Prefill COA bill department approval authorities (like store Manager/HOD): Sr Manager Finance + GM Finance
  useEffect(() => {
    let cancelled = false;
    fetchFinanceAuthorityCandidates()
      .then((list) => {
        if (cancelled) return;
        setFinanceAuthorityCandidates(list);
        const iftikhar = matchUserByName(list, SR_MANAGER_FINANCE_NAME);
        const faisal = matchUserByName(list, GM_FINANCE_NAME);
        setBillFinAuth((prev) => ({
          srManagerFinance: prev.srManagerFinance || iftikhar || null,
          gmFinance: prev.gmFinance || faisal || null
        }));
      })
      .catch(() => {
        if (!cancelled) setFinanceAuthorityCandidates([]);
      });
    return () => { cancelled = true; };
  }, []);

  // Auto-calculate Due Date based on Terms & Bill Date
  const updateDueDateFromTerms = useCallback((termsValue, bDate) => {
    if (!bDate) return;
    const term = DEFAULT_TERMS.find((t) => t.value === termsValue);
    const days = term ? term.days : 30;
    const d = new Date(bDate);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() + days);
      setDueDate(d.toISOString().split('T')[0]);
    }
  }, []);

  useEffect(() => {
    updateDueDateFromTerms(paymentTerms, billDate);
  }, [paymentTerms, billDate, updateDueDateFromTerms]);

  // Load Master Data (Vendors, COA Accounts, Companies, Projects)
  useEffect(() => {
    const fetchData = async () => {
      setLoadingMaster(true);
      try {
        const [vendRes, accRes, compRes, hrProjRes, pmProjRes] = await Promise.all([
          api.get('/procurement/vendors', { params: { limit: 1000 } }).catch(() => ({ data: { data: { vendors: [] } } })),
          api.get('/finance/accounts', { params: { limit: 5000 } }).catch(() => ({ data: { data: [] } })),
          api.get('/finance/companies').catch(() => ({ data: { data: [] } })),
          api.get('/hr/projects', { params: { limit: 1000 } }).catch(() => ({ data: { data: [] } })),
          api.get('/project-management/projects', { params: { limit: 1000 } }).catch(() => ({ data: { data: { projects: [] } } }))
        ]);

        const vList = vendRes.data?.data?.vendors || vendRes.data?.vendors || vendRes.data?.data || [];
        setVendors(Array.isArray(vList) ? vList : []);

        const aList = accRes.data?.data?.accounts || accRes.data?.accounts || accRes.data?.data || [];
        setAccounts(Array.isArray(aList) ? aList : []);

        const cList = compRes.data?.data || compRes.data || [];
        setCompaniesList(Array.isArray(cList) ? cList : []);
        if (selectedCompanyId && Array.isArray(cList)) {
          const match = cList.find((c) => String(c._id) === String(selectedCompanyId));
          if (match) setSelectedCompany(match);
        }

        const hrList = Array.isArray(hrProjRes.data?.data) ? hrProjRes.data.data : [];
        const pmList = Array.isArray(pmProjRes.data?.data?.projects) ? pmProjRes.data.data.projects : (Array.isArray(pmProjRes.data?.data) ? pmProjRes.data.data : []);
        const combinedProjects = [...hrList, ...pmList].filter((p) => p && typeof p === 'object');
        const uniqueProjects = Array.from(new Map(combinedProjects.map((p) => [p.name || p.title || p._id, p])).values())
          .filter((p) => p && (p.name || p.title));

        setProjectsList(uniqueProjects);

        // Suggest a bill number if blank
        const now = new Date();
        const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
        const rnd = Math.floor(1000 + Math.random() * 9000);
        setBillNumber(`BILL-${ymd}-${rnd}`);
      } catch (err) {
        console.error('Failed to load bill master data', err);
      } finally {
        setLoadingMaster(false);
      }
    };
    fetchData();
  }, []);

  // Re-fetch COA accounts when company is selected or changed
  useEffect(() => {
    const fetchCompanyAccounts = async () => {
      try {
        const compId = selectedCompany?._id;
        const res = await api.get('/finance/accounts', {
          params: { limit: 5000, ...(compId ? { companyId: compId } : { allCompanies: 'true' }) }
        });
        const aList = res.data?.data?.accounts || res.data?.accounts || res.data?.data || [];
        if (Array.isArray(aList) && aList.length > 0) {
          setAccounts(aList);
        }
      } catch (err) {
        console.error('Failed to load accounts for selected company', err);
      }
    };
    fetchCompanyAccounts();
  }, [selectedCompany]);

  // Filter COA accounts (prioritize Expenses and COGS, but include all)
  const expenseAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      if (a.type === 'Expense' && b.type !== 'Expense') return -1;
      if (b.type === 'Expense' && a.type !== 'Expense') return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [accounts]);

  // Handle Vendor Selection
  const handleVendorChange = (_, vendor) => {
    setSelectedVendor(vendor);
    if (vendor) {
      const parts = [
        vendor.name,
        vendor.address?.street,
        vendor.address?.city,
        vendor.address?.state,
        vendor.address?.country,
        vendor.phone ? `Phone: ${vendor.phone}` : null,
        vendor.email ? `Email: ${vendor.email}` : null
      ].filter(Boolean);
      setMailingAddress(parts.join('\n') || vendor.name || '');
      if (vendor.paymentTerms) {
        setPaymentTerms(vendor.paymentTerms);
      }
    } else {
      setMailingAddress('');
    }
  };

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

  // Item Line Operations
  const handleItemLineChange = (index, field, value) => {
    setItemLines((prev) => {
      const next = [...prev];
      const line = { ...next[index], [field]: value };
      if (field === 'quantity' || field === 'unitPrice') {
        const qty = Number(line.quantity) || 0;
        const rate = Number(line.unitPrice) || 0;
        line.amount = qty * rate > 0 ? (qty * rate).toFixed(2) : '';
      }
      next[index] = line;
      return next;
    });
  };

  const addItemLine = () => {
    setItemLines((prev) => [...prev, emptyItemLine()]);
  };

  const removeItemLine = (index) => {
    setItemLines((prev) => prev.filter((_, i) => i !== index));
  };

  // Total Calculation
  const categoryTotal = useMemo(() => {
    return categoryLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  }, [categoryLines]);

  const itemTotal = useMemo(() => {
    return itemLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  }, [itemLines]);

  const grandTotal = useMemo(() => {
    return categoryTotal + itemTotal;
  }, [categoryTotal, itemTotal]);

  // Attachments
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({
        file,
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB'
      }))
    ]);
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Quick Add COA Account
  const handleOpenAddAccount = (rowIndex) => {
    setNewAccountRowIndex(rowIndex);
    setNewAccountForm({
      name: '',
      accountNumber: String(6000 + Math.floor(Math.random() * 900)),
      type: 'Expense',
      category: 'Operating Expenses',
      description: ''
    });
    setNewAccountDialog(true);
  };

  const handleSaveNewAccount = async () => {
    if (!newAccountForm.name.trim() || !newAccountForm.accountNumber.trim()) {
      toast.error('Account name and number are required');
      return;
    }
    try {
      setCreatingAccount(true);
      const res = await api.post('/finance/accounts', newAccountForm);
      const created = res.data?.data?.account || res.data?.data || res.data?.account;
      if (created) {
        toast.success(`Account "${created.name}" created!`);
        setAccounts((prev) => [...prev, created]);
        if (newAccountRowIndex !== null) {
          handleCategoryLineChange(newAccountRowIndex, 'account', created);
        }
        setNewAccountDialog(false);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create account');
    } finally {
      setCreatingAccount(false);
    }
  };

  // Submit Bill
  const handleSubmitBill = async () => {
    if (!selectedVendor && !mailingAddress.trim()) {
      setError('Please select a supplier/vendor');
      return;
    }
    if (!billNumber.trim()) {
      setError('Please enter a bill number');
      return;
    }
    if (!dueDate) {
      setError('Please enter a due date');
      return;
    }

    const validCategoryLines = categoryLines
      .filter((l) => Number(l.amount) > 0)
      .map((l) => ({
        account: l.account?._id || null,
        accountNumber: l.account?.accountNumber || '',
        description: l.description || l.account?.name || 'Expense line item',
        quantity: 1,
        unitPrice: Number(l.amount),
        amount: Number(l.amount),
        project: l.project || '',
        company: l.company || ''
      }));

    const validItemLines = itemLines
      .filter((l) => Number(l.amount) > 0)
      .map((l) => ({
        description: l.itemName ? `${l.itemName} — ${l.description || ''}`.trim() : (l.description || 'Item line'),
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice) || Number(l.amount) || 0,
        amount: Number(l.amount) || 0,
        project: l.project || ''
      }));

    const allLines = [...validCategoryLines, ...validItemLines];

    if (allLines.length === 0 || grandTotal <= 0) {
      setError('Please add at least one line item with a positive amount.');
      return;
    }
    if (!billFinAuth.srManagerFinance || !billFinAuth.gmFinance) {
      setError('Select Sr Manager Finance and GM Finance as department approval authorities.');
      return;
    }
    const srId = String(billFinAuth.srManagerFinance?._id || billFinAuth.srManagerFinance || '');
    const gmId = String(billFinAuth.gmFinance?._id || billFinAuth.gmFinance || '');
    if (!srId || !gmId || srId === gmId) {
      setError('Sr Manager Finance and GM Finance must be two different users.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const vendorPayload = {
        name: selectedVendor?.name || mailingAddress.split('\n')[0] || 'Supplier',
        email: selectedVendor?.email || '',
        phone: selectedVendor?.phone || '',
        vendorId: selectedVendor?._id || null,
        address: selectedVendor?.address || { street: mailingAddress }
      };

      const compName = selectedCompany?.name || (typeof selectedCompany === 'string' ? selectedCompany : '');
      const primaryProject = allLines.find((l) => l.project)?.project || '';
      const generatedNarration = allLines.map((l) => l.description).filter(Boolean).join('; ');

      let uploadedAttachments = [];
      const filesToUpload = attachments.map((a) => a.file).filter(Boolean);
      if (filesToUpload.length > 0) {
        setUploadingFiles(true);
        try {
          const formData = new FormData();
          filesToUpload.forEach((f) => formData.append('files', f));
          const uploadRes = await api.post('/finance/accounts-payable/attachments', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          uploadedAttachments = uploadRes.data?.data || [];
        } finally {
          setUploadingFiles(false);
        }
      }

      const payload = {
        companyId: selectedCompany?._id || undefined,
        company: compName,
        project: primaryProject,
        vendor: vendorPayload,
        billNumber: billNumber.trim(),
        vendorInvoiceNumber: vendorInvoiceNumber.trim() || undefined,
        billDate,
        dueDate,
        paymentTerms,
        notes: generatedNarration,
        totalAmount: grandTotal,
        lineItems: allLines.map((l) => ({
          ...l,
          company: l.company || compName,
          project: l.project || primaryProject
        })),
        attachments: uploadedAttachments,
        // Department approval (like Centralized Store Manager/HOD) — NOT finance voucher authorities
        departmentApproverIds: [srId, gmId],
        departmentApprovalAuthorities: {
          srManagerFinance: srId,
          gmFinance: gmId
        }
      };

      const res = await api.post('/finance/accounts-payable', payload);
      if (res.data?.success || res.status === 201 || res.status === 200) {
        toast.success(res.data?.message || `Bill ${billNumber} submitted for department approval`);
        navigate(backPath);
      }
    } catch (err) {
      console.error('Error creating bill:', err);
      setError(err.response?.data?.message || 'Failed to create vendor bill');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1400, margin: '0 auto' }}>
      {/* Top Header Bar & Live Balance Due */}
      <Paper elevation={1} sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
        <Grid container spacing={2} alignItems="center" justifyContent="space-between">
          <Grid item xs={12} md={6}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={() => navigate(backPath)}
                size="small"
              >
                {isProcurement ? 'Back to Vendor Bills' : 'Back to Accounts Payable'}
              </Button>
              <Typography variant="h4" fontWeight={700} sx={{ color: 'text.primary', letterSpacing: -0.5 }}>
                Bill
              </Typography>
            </Stack>
          </Grid>
          <Grid item xs={12} md={6} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              Balance Due
            </Typography>
            <Typography variant="h4" fontWeight={800} color={grandTotal > 0 ? 'primary.main' : 'text.primary'}>
              {formatPKR(grandTotal)}
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* Main Form Body */}
      <Card elevation={2} sx={{ borderRadius: 2, mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          {/* Supplier & Header Fields */}
          <Grid container spacing={2.5} sx={{ mb: 3 }}>
            {/* Left Column: Supplier & Mailing Address */}
            <Grid item xs={12} md={4}>
              <Stack spacing={2}>
                <Autocomplete
                  options={vendors}
                  filterOptions={vendorFilterOptions}
                  getOptionLabel={(o) => o?.name || ''}
                  value={selectedVendor}
                  onChange={handleVendorChange}
                  loading={loadingMaster}
                  isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
                  renderOption={(props, option) => {
                    const extra = [option.phone, option.ntnCnic, option.email].filter(Boolean).join(' • ');
                    return (
                      <li {...props} key={option._id}>
                        <Box>
                          <Typography variant="body1">{option.name}</Typography>
                          {extra && <Typography variant="caption" color="text.secondary">{extra}</Typography>}
                        </Box>
                      </li>
                    );
                  }}
                  sx={{ flexGrow: 1 }}
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
                    <TextField
                      {...params}
                      label="Supplier / Vendor"
                      required
                      placeholder="Choose or search supplier"
                      size="small"
                      fullWidth
                    />
                  )}
                />
                <TextField
                  label="Mailing address"
                  multiline
                  rows={3}
                  value={mailingAddress}
                  onChange={(e) => setMailingAddress(e.target.value)}
                  placeholder="Address will auto-fill on supplier selection"
                  size="small"
                  fullWidth
                />
              </Stack>
            </Grid>

            {/* Right Column: Terms, Bill Date, Due Date, Bill No, Company, Project */}
            <Grid item xs={12} md={8}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Terms</InputLabel>
                    <Select
                      value={paymentTerms}
                      label="Terms"
                      onChange={(e) => setPaymentTerms(e.target.value)}
                    >
                      {DEFAULT_TERMS.map((t) => (
                        <MenuItem key={t.value} value={t.value}>
                          {t.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    fullWidth
                    type="date"
                    label="Bill date"
                    size="small"
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    required
                  />
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    fullWidth
                    type="date"
                    label="Due date"
                    size="small"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    required
                  />
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    fullWidth
                    label="Bill no."
                    size="small"
                    value={billNumber}
                    onChange={(e) => setBillNumber(e.target.value)}
                    placeholder="e.g. BILL-2026-001"
                    required
                  />
                </Grid>

                <Grid item xs={12} sm={6} md={6}>
                  <TextField
                    fullWidth
                    label="Vendor Invoice #"
                    size="small"
                    value={vendorInvoiceNumber}
                    onChange={(e) => setVendorInvoiceNumber(e.target.value)}
                    placeholder="Supplier's Invoice No."
                    helperText="Optional reference"
                  />
                </Grid>

                <Grid item xs={12} sm={6} md={6}>
                  <Autocomplete
                    options={companiesList}
                    getOptionLabel={(c) => c?.name || ''}
                    value={selectedCompany}
                    onChange={(_, val) => setSelectedCompany(val)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        label="Company"
                        placeholder="Select Company"
                        fullWidth
                      />
                    )}
                  />
                </Grid>
              </Grid>
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />

          {/* Collapsible Section 1: Category Details (Chart of Accounts) */}
          <Accordion
            expanded={categoryAccordionOpen}
            onChange={(_, expanded) => setCategoryAccordionOpen(expanded)}
            elevation={0}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', mb: 2 }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <span>Category details</span>
                <Chip label={`${categoryLines.filter((l) => Number(l.amount) > 0).length} lines`} size="small" variant="outlined" />
                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                  (Expense & Chart of Accounts categories)
                </Typography>
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
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

              {/* Table Action Buttons */}
              <Box sx={{ p: 2, display: 'flex', gap: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={addCategoryLine}>
                  Add lines
                </Button>
                <Button variant="text" size="small" color="inherit" onClick={clearAllCategoryLines}>
                  Clear all lines
                </Button>
              </Box>
            </AccordionDetails>
          </Accordion>

          {/* Collapsible Section 2: Item Details */}
          <Accordion
            expanded={itemAccordionOpen}
            onChange={(_, expanded) => setItemAccordionOpen(expanded)}
            elevation={0}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', mb: 3 }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <span>Item details</span>
                <Chip label={`${itemLines.filter((l) => Number(l.amount) > 0).length} items`} size="small" variant="outlined" />
                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                  (Optional inventory / product line items)
                </Typography>
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead sx={{ backgroundColor: 'action.hover' }}>
                    <TableRow>
                      <TableCell sx={{ width: 45, fontWeight: 700 }}>#</TableCell>
                      <TableCell sx={{ minWidth: 200, fontWeight: 700 }}>PRODUCT / SERVICE</TableCell>
                      <TableCell sx={{ minWidth: 220, fontWeight: 700 }}>DESCRIPTION</TableCell>
                      <TableCell sx={{ width: 90, fontWeight: 700 }} align="right">QTY</TableCell>
                      <TableCell sx={{ width: 130, fontWeight: 700 }} align="right">RATE (PKR)</TableCell>
                      <TableCell sx={{ width: 140, fontWeight: 700 }} align="right">AMOUNT (PKR)</TableCell>
                      <TableCell sx={{ width: 60, fontWeight: 700 }} align="center">ACTION</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {itemLines.map((row, idx) => (
                      <TableRow key={row.id} hover>
                        <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>{idx + 1}</TableCell>
                        <TableCell>
                          <TextField
                            fullWidth
                            size="small"
                            placeholder="Item name"
                            value={row.itemName}
                            onChange={(e) => handleItemLineChange(idx, 'itemName', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            fullWidth
                            size="small"
                            placeholder="Description"
                            value={row.description}
                            onChange={(e) => handleItemLineChange(idx, 'description', e.target.value)}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            fullWidth
                            size="small"
                            type="number"
                            value={row.quantity}
                            onChange={(e) => handleItemLineChange(idx, 'quantity', e.target.value)}
                            inputProps={{ min: 1, style: { textAlign: 'right' } }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            fullWidth
                            size="small"
                            type="number"
                            placeholder="0.00"
                            value={row.unitPrice}
                            onChange={(e) => handleItemLineChange(idx, 'unitPrice', e.target.value)}
                            inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={600}>
                            {formatPKR(Number(row.amount) || 0)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <IconButton size="small" color="error" onClick={() => removeItemLine(idx)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                    {itemLines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 2, color: 'text.secondary' }}>
                          No product items added. Click &quot;Add item&quot; below if needed.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={addItemLine}>
                  Add item
                </Button>
              </Box>
            </AccordionDetails>
          </Accordion>

          {/* Bottom Section: Attachments (Left) | Summary (Right) */}
          <Grid container spacing={3} sx={{ mt: 1 }}>
            {/* Left Side: Attachments */}
            <Grid item xs={12} md={7}>
              <Stack spacing={2.5}>
                {/* Attachments Box */}
                <Box
                  sx={{
                    border: '1.5px dashed',
                    borderColor: 'divider',
                    borderRadius: 2,
                    p: 2.5,
                    textAlign: 'center',
                    backgroundColor: 'background.default'
                  }}
                >
                  <CloudUploadIcon sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
                  <Typography variant="subtitle2" fontWeight={600}>
                    Add attachment
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                    Max file size: 20 MB (PDF, Images, Excel)
                  </Typography>
                  <Button variant="outlined" size="small" component="label">
                    Upload file
                    <input type="file" multiple hidden onChange={handleFileUpload} />
                  </Button>

                  {attachments.length > 0 && (
                    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2, justifyContent: 'center' }}>
                      {attachments.map((att, i) => (
                        <Chip
                          key={i}
                          label={`${att.name} (${att.size})`}
                          onDelete={() => removeAttachment(i)}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
              </Stack>
            </Grid>

            {/* Right Side: Calculation & Summary */}
            <Grid item xs={12} md={5}>
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
                <Stack spacing={1.5}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Category subtotal:
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {formatPKR(categoryTotal)}
                    </Typography>
                  </Box>
                  {itemTotal > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Item subtotal:
                      </Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {formatPKR(itemTotal)}
                      </Typography>
                    </Box>
                  )}
                  <Divider />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 1 }}>
                    <Typography variant="h6" fontWeight={700}>
                      Total:
                    </Typography>
                    <Typography variant="h5" fontWeight={800} color="primary.main">
                      {formatPKR(grandTotal)}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Department Approval Authorities — same stage as Centralized Store Manager/HOD (not finance voucher authorities) */}
      <Card sx={{ mb: 2, borderRadius: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Department Approval Authorities
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            Like Centralized Store bills: first department approval (Sr Manager Finance → GM Finance), then Audit, then Finance creates the voucher.
            This is not Finance voucher approval authorities.
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={financeAuthorityCandidates}
                value={billFinAuth.srManagerFinance || null}
                onChange={(_, v) => setBillFinAuth((prev) => ({ ...prev, srManagerFinance: v }))}
                getOptionLabel={userOptionLabel}
                isOptionEqualToValue={(a, b) => String(a?._id || a?.id) === String(b?._id || b?.id)}
                noOptionsText={financeAuthorityCandidates.length ? 'No match' : 'Loading finance users…'}
                renderOption={(props, option) => (
                  <li {...props} key={option._id || option.id}>
                    <Typography variant="body2">{userOptionLabel(option)}</Typography>
                    {userOptionSecondary(option) ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {userOptionSecondary(option)}
                      </Typography>
                    ) : null}
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Sr Manager Finance *"
                    size="small"
                    required
                    helperText={billFinAuth.srManagerFinance ? 'Pre-selected' : 'Select Muhammad Iftikhar Rashid'}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={financeAuthorityCandidates}
                value={billFinAuth.gmFinance || null}
                onChange={(_, v) => setBillFinAuth((prev) => ({ ...prev, gmFinance: v }))}
                getOptionLabel={userOptionLabel}
                isOptionEqualToValue={(a, b) => String(a?._id || a?.id) === String(b?._id || b?.id)}
                noOptionsText={financeAuthorityCandidates.length ? 'No match' : 'Loading finance users…'}
                renderOption={(props, option) => (
                  <li {...props} key={option._id || option.id}>
                    <Typography variant="body2">{userOptionLabel(option)}</Typography>
                    {userOptionSecondary(option) ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {userOptionSecondary(option)}
                      </Typography>
                    ) : null}
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="GM Finance *"
                    size="small"
                    required
                    helperText={billFinAuth.gmFinance ? 'Pre-selected' : 'Select Faisal Farooq'}
                  />
                )}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Bottom Sticky Action Bar */}
      <Paper
        elevation={3}
        sx={{
          p: 2,
          position: 'sticky',
          bottom: 16,
          borderRadius: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
          zIndex: 1000
        }}
      >
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(backPath)}
        >
          Cancel
        </Button>

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            color="primary"
            size="large"
            disabled={submitting || grandTotal <= 0}
            startIcon={submitting ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
            onClick={handleSubmitBill}
            sx={{ px: 4, fontWeight: 700 }}
          >
            {uploadingFiles ? 'Uploading attachments...' : submitting ? 'Submitting...' : 'Submit for Department Approval'}
          </Button>
        </Stack>
      </Paper>

      {/* Dialog: Quick Add Chart of Accounts Account */}
      <Dialog open={newAccountDialog} onClose={() => setNewAccountDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add New Chart of Accounts Category</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Account Name"
              required
              fullWidth
              size="small"
              placeholder="e.g. Audit Fee, Software Subscriptions, EOBI"
              value={newAccountForm.name}
              onChange={(e) => setNewAccountForm((p) => ({ ...p, name: e.target.value }))}
            />
            <TextField
              label="Account Number / Code"
              required
              fullWidth
              size="small"
              value={newAccountForm.accountNumber}
              onChange={(e) => setNewAccountForm((p) => ({ ...p, accountNumber: e.target.value }))}
            />
            <FormControl fullWidth size="small">
              <InputLabel>Account Type</InputLabel>
              <Select
                value={newAccountForm.type}
                label="Account Type"
                onChange={(e) => setNewAccountForm((p) => ({ ...p, type: e.target.value }))}
              >
                <MenuItem value="Expense">Expense</MenuItem>
                <MenuItem value="Asset">Asset</MenuItem>
                <MenuItem value="Liability">Liability</MenuItem>
                <MenuItem value="Equity">Equity</MenuItem>
                <MenuItem value="Revenue">Revenue</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Category"
              fullWidth
              size="small"
              value={newAccountForm.category}
              onChange={(e) => setNewAccountForm((p) => ({ ...p, category: e.target.value }))}
            />
            <TextField
              label="Description"
              multiline
              rows={2}
              fullWidth
              size="small"
              value={newAccountForm.description}
              onChange={(e) => setNewAccountForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setNewAccountDialog(false)} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleSaveNewAccount}
            variant="contained"
            disabled={creatingAccount || !newAccountForm.name.trim()}
          >
            {creatingAccount ? 'Saving...' : 'Save & Select'}
          </Button>
        </DialogActions>
      </Dialog>

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
    </Box>
  );
};

export default StandardVendorBillForm;
