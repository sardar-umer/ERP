import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  createFilterOptions,
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
  Checkbox
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Save as SaveIcon,
  ArrowBack as ArrowBackIcon,
  Inventory2 as InventoryIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatPKR } from '../../utils/currency';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';

const toDateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
};

const DEFAULT_TERMS = [
  { value: 'due_on_receipt', label: 'Due on receipt', days: 0 },
  { value: 'net_15', label: 'Net 15', days: 15 },
  { value: 'net_30', label: 'Net 30', days: 30 },
  { value: 'net_45', label: 'Net 45', days: 45 },
  { value: 'net_60', label: 'Net 60', days: 60 },
  { value: 'custom', label: 'Custom', days: 30 }
];

const emptyLine = () => ({
  id: Date.now() + Math.random(),
  account: null,
  description: '',
  quantity: 1,
  unitPrice: '',
  amount: '',
  // Store Issue Note link (set only for lines loaded from a SIN)
  sourceSin: null,
  sourceSinNumber: '',
  inventoryItem: null,
  unit: '',
  unitCost: 0,
  maxQty: null
});

const sinKey = (sinId, itemId) => `${sinId}:${itemId}`;
const SIN_STATUS = {
  not_invoiced: { label: 'Not invoiced', color: 'default' },
  partial: { label: 'Partially invoiced', color: 'warning' },
  invoiced: { label: 'Invoiced', color: 'success' }
};

const filter = createFilterOptions();

const StandardCustomerInvoiceForm = () => {
  const navigate = useNavigate();
  const { id: editInvoiceId } = useParams();
  const isEditMode = Boolean(editInvoiceId);
  const { selectedCompanyId } = useFinanceCompany();

  // Customer & Invoice Metadata
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  // Tax / identity numbers, copied from the customer and printed on the sales tax invoice
  const [customerTaxIds, setCustomerTaxIds] = useState({ ntn: '', strn: '', cnic: '' });
  const taxIdsOf = (c) => ({ ntn: c?.ntn || '', strn: c?.strn || '', cnic: c?.cnic || '' });
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [department, setDepartment] = useState('general');
  const [costCenter, setCostCenter] = useState('');
  const [notes, setNotes] = useState('');

  // Line items
  const [lines, setLines] = useState([emptyLine()]);

  // Master Data
  const [accounts, setAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  // "+ Add new cost center" from the dropdown
  const [newCostCenter, setNewCostCenter] = useState({ open: false, name: '', description: '', saving: false });
  const saveNewCostCenter = async () => {
    const name = newCostCenter.name.trim();
    if (!name) return;
    try {
      setNewCostCenter((d) => ({ ...d, saving: true }));
      const res = await api.post('/finance/cost-centers', { name, description: newCostCenter.description.trim() });
      const created = res.data?.data;
      if (created?._id) {
        setCostCenters((prev) => [...prev, created]);
        setCostCenter(created._id);
      }
      toast.success(`Cost center "${name}" added`);
      setNewCostCenter({ open: false, name: '', description: '', saving: false });
    } catch (err) {
      toast.error(err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Could not add cost center');
      setNewCostCenter((d) => ({ ...d, saving: false }));
    }
  };
  const [companiesList, setCompaniesList] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [loadingInvoice, setLoadingInvoice] = useState(isEditMode);
  const [invoiceLoaded, setInvoiceLoaded] = useState(false);
  const skipNextDueDateSync = useRef(false);

  // Quick Add Revenue Account Dialog
  const [newAccountDialog, setNewAccountDialog] = useState(false);
  const [newAccountRowIndex, setNewAccountRowIndex] = useState(null);
  const [newAccountForm, setNewAccountForm] = useState({
    name: '',
    accountNumber: '',
    type: 'Revenue',
    category: 'Operating Revenue',
    description: ''
  });
  const [creatingAccount, setCreatingAccount] = useState(false);

  // Quick Add Customer Dialog
  const [newCustomerDialog, setNewCustomerDialog] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
    street: ''
  });

  // Load lines from Store Issue Notes
  const [sinDialog, setSinDialog] = useState({ open: false, loading: false, search: '', list: [], picked: {} });

  // Submitting
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto calculate due date (create mode / when terms change — don't overwrite loaded edit due date on first paint)
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
    if (isEditMode && !invoiceLoaded) return;
    if (skipNextDueDateSync.current) {
      skipNextDueDateSync.current = false;
      return;
    }
    if (paymentTerms === 'custom') return;
    updateDueDateFromTerms(paymentTerms, invoiceDate);
  }, [paymentTerms, invoiceDate, updateDueDateFromTerms, isEditMode, invoiceLoaded]);

  // Load Master Data
  useEffect(() => {
    const fetchData = async () => {
      setLoadingMaster(true);
      try {
        const [accRes, compRes, deptRes, ccRes, custRes] = await Promise.all([
          api.get('/finance/accounts', { params: { limit: 5000, companyId: selectedCompanyId } }).catch(() => ({ data: { data: [] } })),
          api.get('/finance/companies').catch(() => ({ data: { data: [] } })),
          api.get('/indents/departments').catch(() => ({ data: { data: [] } })),
          api.get('/finance/cost-centers').catch(() => ({ data: { data: [] } })),
          api.get('/finance/customers', { params: { limit: 5000, status: 'active' } }).catch(() => ({ data: { data: { customers: [] } } }))
        ]);

        const aList = accRes.data?.data?.accounts || accRes.data?.accounts || accRes.data?.data || [];
        setAccounts(Array.isArray(aList) ? aList : []);

        const cList = compRes.data?.data || compRes.data || [];
        setCompaniesList(Array.isArray(cList) ? cList : []);
        if (selectedCompanyId && Array.isArray(cList)) {
          const match = cList.find((c) => String(c._id) === String(selectedCompanyId));
          if (match) setSelectedCompany(match);
        }

        const dList = deptRes.data?.data || [];
        setDepartments(Array.isArray(dList) ? dList : []);

        const ccList = ccRes.data?.data || [];
        setCostCenters(Array.isArray(ccList) ? ccList : []);

        const custList = custRes.data?.data?.customers || custRes.data?.customers || custRes.data?.data || [];
        setCustomers(Array.isArray(custList) ? custList : []);

        // Auto-generate invoice number suggestion (create only)
        if (!isEditMode) {
          const now = new Date();
          const rand = Math.floor(1000 + Math.random() * 9000);
          setInvoiceNumber(`INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${rand}`);
        }
      } catch (err) {
        console.error('Failed to load master data:', err);
      } finally {
        setLoadingMaster(false);
      }
    };
    fetchData();
  }, [selectedCompanyId, isEditMode]);

  // Load existing invoice for edit
  useEffect(() => {
    if (!isEditMode || loadingMaster || invoiceLoaded) return;
    let cancelled = false;
    (async () => {
      setLoadingInvoice(true);
      setError('');
      try {
        const res = await api.get(`/finance/accounts-receivable/${editInvoiceId}`);
        const inv = res.data?.data;
        if (!inv) throw new Error('Invoice not found');
        if (cancelled) return;

        const paid = Math.max(Number(inv.amountPaid || 0), Number(inv.paidAmount || 0));
        if (paid > 0.009 || (Array.isArray(inv.payments) && inv.payments.length > 0)) {
          toast.error('This invoice has payments and cannot be edited');
          navigate('/finance/accounts-receivable');
          return;
        }

        setInvoiceNumber(inv.invoiceNumber || '');
        setInvoiceDate(toDateInput(inv.invoiceDate) || new Date().toISOString().split('T')[0]);
        setDueDate(toDateInput(inv.dueDate));
        setPaymentTerms(inv.paymentTerms || 'net_30');
        setDepartment(inv.department || 'general');
        setCostCenter(inv.costCenter?._id || inv.costCenter || '');
        setNotes(inv.notes || '');
        setCustomerName(inv.customer?.name || inv.customerName || '');
        setCustomerEmail(inv.customer?.email || inv.customerEmail || '');
        setCustomerPhone(inv.customer?.phone || '');
        setCustomerTaxIds(taxIdsOf(inv.customer));
        setCustomerAddress(
          typeof inv.customer?.address === 'string'
            ? inv.customer.address
            : inv.customer?.address?.street || ''
        );

        const custId = inv.customer?.customerId?._id || inv.customer?.customerId || null;
        const matchedCustomer =
          (custId && customers.find((c) => String(c._id) === String(custId))) ||
          customers.find(
            (c) =>
              String(c.name || '').trim().toLowerCase() ===
              String(inv.customer?.name || inv.customerName || '').trim().toLowerCase()
          ) ||
          null;
        setSelectedCustomer(matchedCustomer);

        if (inv.companyId) {
          const companyIdStr = inv.companyId?._id || inv.companyId;
          const matchCo = companiesList.find((c) => String(c._id) === String(companyIdStr));
          if (matchCo) setSelectedCompany(matchCo);
        }

        const mappedLines = (inv.lineItems || []).map((li) => {
          const accId = li.account?._id || li.account || null;
          const account =
            (accId && accounts.find((a) => String(a._id) === String(accId))) ||
            (li.account && typeof li.account === 'object' ? li.account : null);
          return {
            id: Date.now() + Math.random(),
            account,
            description: li.description || '',
            quantity: Number(li.quantity) || 1,
            unitPrice: Number(li.unitPrice) || Number(li.amount) || '',
            amount: Number(li.amount) || '',
            sourceSin: li.sourceSin?._id || li.sourceSin || null,
            sourceSinNumber: li.sourceSinNumber || '',
            inventoryItem: li.inventoryItem?._id || li.inventoryItem || null,
            unit: li.unit || '',
            unitCost: Number(li.unitCost) || 0,
            maxQty: null
          };
        });
        setLines(mappedLines.length ? mappedLines : [emptyLine()]);
        skipNextDueDateSync.current = true;
        setInvoiceLoaded(true);
      } catch (err) {
        console.error('Failed to load invoice for edit:', err);
        if (!cancelled) {
          setError(err.response?.data?.message || 'Failed to load invoice for editing');
          toast.error(err.response?.data?.message || 'Failed to load invoice');
        }
      } finally {
        if (!cancelled) setLoadingInvoice(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isEditMode,
    editInvoiceId,
    loadingMaster,
    invoiceLoaded,
    customers,
    accounts,
    companiesList,
    navigate
  ]);

  // Filter Revenue Accounts
  const revenueAccounts = useMemo(() => {
    return accounts.filter((a) => a.type === 'Revenue');
  }, [accounts]);

  // Line Handlers
  const handleLineChange = (index, field, value) => {
    setLines((prev) => {
      const updated = [...prev];
      const row = { ...updated[index], [field]: value };
      if (field === 'quantity' || field === 'unitPrice') {
        const qty = Number(field === 'quantity' ? value : row.quantity) || 0;
        const price = Number(field === 'unitPrice' ? value : row.unitPrice) || 0;
        row.amount = Math.round(qty * price * 100) / 100;
      }
      updated[index] = row;
      return updated;
    });
  };

  const handleAddLine = () => {
    setLines((prev) => [...prev, emptyLine()]);
  };

  const handleDeleteLine = (index) => {
    if (lines.length === 1) {
      setLines([emptyLine()]);
      return;
    }
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Store Issue Note → invoice lines ──
  const fetchSins = async (search = '') => {
    setSinDialog((d) => ({ ...d, loading: true }));
    try {
      const res = await api.get('/finance/accounts-receivable-sin-sources', {
        params: { search: search || undefined, customerId: selectedCustomer?._id, excludeInvoiceId: editInvoiceId || undefined }
      });
      setSinDialog((d) => ({ ...d, loading: false, list: res.data?.data || [] }));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load Store Issue Notes');
      setSinDialog((d) => ({ ...d, loading: false }));
    }
  };

  const openSinDialog = () => {
    if (!selectedCustomer?._id) {
      toast.error('Select the customer first — only that customer\'s Store Issue Notes are listed');
      return;
    }
    setSinDialog({ open: true, loading: true, search: '', list: [], picked: {} });
    fetchSins('');
  };

  // Qty of a SIN item already sitting on this form (not saved yet)
  const qtyOnForm = (sinId, itemId) => lines
    .filter((l) => l.sourceSin && sinKey(l.sourceSin, l.inventoryItem) === sinKey(sinId, itemId))
    .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

  const togglePicked = (key) => setSinDialog((d) => {
    const picked = { ...d.picked };
    if (picked[key]) delete picked[key];
    else picked[key] = true;
    return { ...d, picked };
  });

  const addPickedSinLines = () => {
    const defaultSalesAccount = revenueAccounts.find((a) => String(a.accountNumber) === '4001') || null;
    const added = [];
    sinDialog.list.forEach((sin) => {
      sin.lines.forEach((l) => {
        if (!sinDialog.picked[sinKey(sin._id, l.inventoryItem)]) return;
        const open = Math.max(0, l.qtyAvailable - qtyOnForm(sin._id, l.inventoryItem));
        if (open <= 0) return;
        added.push({
          ...emptyLine(),
          account: defaultSalesAccount,
          description: `${l.itemName}${l.itemCode ? ` (${l.itemCode})` : ''}`,
          quantity: open,
          sourceSin: sin._id,
          sourceSinNumber: sin.sinNumber,
          inventoryItem: l.inventoryItem,
          unit: l.unit || '',
          unitCost: l.unitCost || 0,
          maxQty: open
        });
      });
    });
    if (!added.length) {
      toast.error('Select at least one item that still has qty to invoice');
      return;
    }
    setLines((prev) => {
      const kept = prev.filter((l) => l.sourceSin || l.account || l.description.trim() || Number(l.amount) > 0);
      return [...kept, ...added];
    });
    setSinDialog((d) => ({ ...d, open: false }));
    toast.success(`${added.length} item(s) added — enter the selling price for each`);
  };

  // Grand Total Calculation
  const grandTotal = useMemo(() => {
    return lines.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  }, [lines]);

  // Quick Add Revenue Account Dialog Handlers
  const handleOpenAddAccount = (rowIndex) => {
    setNewAccountRowIndex(rowIndex);
    setNewAccountForm({
      name: '',
      accountNumber: '',
      type: 'Revenue',
      category: 'Operating Revenue',
      description: ''
    });
    setNewAccountDialog(true);
  };

  const handleSaveNewAccount = async (e) => {
    e.preventDefault();
    if (!newAccountForm.name.trim() || !newAccountForm.accountNumber.trim()) {
      toast.error('Account Name and Number are required');
      return;
    }
    try {
      setCreatingAccount(true);
      const payload = {
        ...newAccountForm,
        companyId: selectedCompany?._id || selectedCompanyId || undefined
      };
      const res = await api.post('/finance/accounts', payload);
      if (res.data?.success || res.status === 201 || res.status === 200) {
        const created = res.data?.data || res.data;
        toast.success(`Account "${created.name}" created!`);
        setAccounts((prev) => [created, ...prev]);
        if (newAccountRowIndex !== null) {
          handleLineChange(newAccountRowIndex, 'account', created);
        }
        setNewAccountDialog(false);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create account');
    } finally {
      setCreatingAccount(false);
    }
  };

  // Quick Add Customer Dialog Handlers
  const handleOpenAddCustomer = () => {
    setNewCustomerForm({ name: '', email: '', phone: '', street: '', ntn: '', strn: '', cnic: '' });
    setNewCustomerDialog(true);
  };

  const handleSaveNewCustomer = async (e) => {
    e.preventDefault();
    if (!newCustomerForm.name.trim()) {
      toast.error('Customer Name is required');
      return;
    }
    try {
      setCreatingCustomer(true);
      const payload = {
        name: newCustomerForm.name,
        email: newCustomerForm.email,
        phone: newCustomerForm.phone,
        address: newCustomerForm.street ? { street: newCustomerForm.street } : undefined,
        ntn: (newCustomerForm.ntn || '').trim(),
        strn: (newCustomerForm.strn || '').trim(),
        cnic: (newCustomerForm.cnic || '').trim(),
        type: 'corporate',
        status: 'active'
      };
      const res = await api.post('/finance/customers', payload);
      if (res.data?.success || res.status === 201 || res.status === 200) {
        const created = res.data?.data || res.data;
        toast.success(`Customer "${created.name}" created!`);
        setCustomers((prev) => [created, ...prev]);
        setSelectedCustomer(created);
        setCustomerName(created.name);
        setCustomerEmail(created.email || '');
        setCustomerPhone(created.phone || '');
        setCustomerAddress(created.address?.street || '');
        setCustomerTaxIds(taxIdsOf(created));
        setNewCustomerDialog(false);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create customer');
    } finally {
      setCreatingCustomer(false);
    }
  };

  const handleCustomerSelect = (e, val) => {
    setSelectedCustomer(val);
    if (val) {
      setCustomerName(val.name || '');
      setCustomerEmail(val.email || '');
      setCustomerPhone(val.phone || '');
      setCustomerAddress(val.address?.street || '');
      setCustomerTaxIds(taxIdsOf(val));
    } else {
      setSelectedCustomer(null);
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerTaxIds({ ntn: '', strn: '', cnic: '' });
    }
  };

  // Submit Invoice
  const handleSubmitInvoice = async () => {
    setError('');
    if (!customerName.trim()) {
      setError('Customer name is required');
      return;
    }
    if (!selectedCustomer?._id) {
      setError('Please select a customer from the list (or create one) so the invoice links to Customer List');
      return;
    }
    if (!invoiceNumber.trim()) {
      setError('Invoice number is required');
      return;
    }
    if (!costCenter) {
      setError('Cost center is required');
      return;
    }
    if (grandTotal <= 0) {
      setError('Total invoice amount must be greater than zero');
      return;
    }

    const unpricedSin = lines.find((l) => l.sourceSin && Number(l.quantity) > 0 && !(Number(l.unitPrice) > 0));
    if (unpricedSin) {
      setError(`Enter the selling price for "${unpricedSin.description}" (${unpricedSin.sourceSinNumber})`);
      return;
    }
    const overSin = lines.find((l) => l.sourceSin && l.maxQty != null && Number(l.quantity) > l.maxQty);
    if (overSin) {
      setError(`"${overSin.description}": only ${overSin.maxQty} ${overSin.unit} left to invoice on ${overSin.sourceSinNumber}`);
      return;
    }

    const validLines = lines.filter((l) => Number(l.amount) > 0);
    if (validLines.length === 0) {
      setError('Please add at least one line item with an amount');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        customer: {
          customerId: selectedCustomer?._id || null,
          name: customerName.trim(),
          email: customerEmail.trim() || '',
          phone: customerPhone.trim() || '',
          address: { street: customerAddress.trim() || '' },
          ntn: customerTaxIds.ntn.trim(),
          strn: customerTaxIds.strn.trim(),
          cnic: customerTaxIds.cnic.trim()
        },
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        dueDate,
        paymentTerms,
        department: department || 'general',
        costCenter,
        notes: notes || '',
        totalAmount: grandTotal,
        companyId: selectedCompany?._id || selectedCompanyId || undefined,
        lineItems: validLines.map((l) => ({
          description: l.description.trim() || 'Service / Product Delivery',
          quantity: Number(l.quantity) || 1,
          unitPrice: Number(l.unitPrice) || Number(l.amount),
          amount: Number(l.amount),
          account: l.account?._id || null,
          ...(l.sourceSin ? { sourceSin: l.sourceSin, inventoryItem: l.inventoryItem } : {})
        }))
      };

      const res = isEditMode
        ? await api.put(`/finance/accounts-receivable/${editInvoiceId}`, payload)
        : await api.post('/finance/accounts-receivable', payload);
      if (res.data?.success || res.status === 201 || res.status === 200) {
        toast.success(
          isEditMode
            ? `✓ Invoice ${invoiceNumber} updated`
            : `✓ Invoice ${invoiceNumber} created and booked to revenue!`
        );
        navigate('/finance/accounts-receivable');
      }
    } catch (err) {
      console.error(isEditMode ? 'Error updating invoice:' : 'Error creating invoice:', err);
      setError(err.response?.data?.message || (isEditMode ? 'Failed to update invoice' : 'Failed to create invoice'));
    } finally {
      setSubmitting(false);
    }
  };

  if (isEditMode && loadingInvoice) {
    return (
      <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400, margin: '0 auto' }}>
      {/* Top Header Bar & Live Amount Due */}
      <Paper elevation={1} sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
        <Grid container spacing={2} alignItems="center" justifyContent="space-between">
          <Grid item xs={12} md={6}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={() => navigate('/finance/accounts-receivable')}
                size="small"
              >
                Back to Accounts Receivable
              </Button>
              <Typography variant="h4" fontWeight={700} sx={{ color: 'text.primary', letterSpacing: -0.5 }}>
                {isEditMode ? 'Edit Customer Invoice' : 'New Customer Invoice'}
              </Typography>
            </Stack>
          </Grid>
          <Grid item xs={12} md={6} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              Total Invoice Amount
            </Typography>
            <Typography variant="h4" fontWeight={800} color={grandTotal > 0 ? 'success.main' : 'text.primary'}>
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
          {/* Customer & Invoice Details */}
          <Grid container spacing={2.5} sx={{ mb: 3 }}>
            {/* Customer Details */}
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" fontWeight={700} color="primary" sx={{ mb: 1.5, textTransform: 'uppercase' }}>
                Customer Information
              </Typography>
              <Stack spacing={2}>
                  <Autocomplete
                    fullWidth
                    options={customers}
                    getOptionLabel={(opt) => {
                      if (opt?.__isNewOption) return '+ Add new customer';
                      return opt?.name || '';
                    }}
                    value={selectedCustomer || null}
                    isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
                    filterOptions={(options, params) => {
                      const filtered = filter(options, params);
                      return [{ __isNewOption: true }, ...filtered];
                    }}
                    onChange={(e, val) => {
                      if (val?.__isNewOption) {
                        handleOpenAddCustomer();
                        return;
                      }
                      handleCustomerSelect(e, val);
                    }}
                    renderOption={(props, option) => {
                      if (option.__isNewOption) {
                        return (
                          <li {...props} key="add-new-customer" style={{ color: '#1976d2', fontWeight: 600, borderBottom: '1px solid #e0e0e0' }}>
                            <AddIcon fontSize="small" sx={{ mr: 1 }} /> + Add new customer
                          </li>
                        );
                      }
                      return (
                        <li {...props} key={option._id}>
                          {option.name}
                        </li>
                      );
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Customer"
                        size="small"
                        required
                        placeholder="Select a customer"
                      />
                    )}
                  />
                  {selectedCustomer && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                      {[['ntn', 'NTN'], ['strn', 'STRN'], ['cnic', 'CNIC']].map(([key, label]) => (
                        <TextField
                          key={key}
                          fullWidth
                          size="small"
                          label={`Customer ${label}`}
                          value={customerTaxIds[key]}
                          onChange={(e) => setCustomerTaxIds((prev) => ({ ...prev, [key]: e.target.value }))}
                          helperText={key === 'ntn' ? 'From the customer — edit for this invoice if needed' : ' '}
                        />
                      ))}
                    </Stack>
                  )}
              </Stack>
            </Grid>

            {/* Invoice Meta */}
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" fontWeight={700} color="primary" sx={{ mb: 1.5, textTransform: 'uppercase' }}>
                Invoice Details & Terms
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Invoice #"
                    size="small"
                    required
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="e.g. INV-2026-001"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Payment Terms</InputLabel>
                    <Select
                      value={paymentTerms}
                      label="Payment Terms"
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
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Invoice Date"
                    type="date"
                    size="small"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    required
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Due Date"
                    type="date"
                    size="small"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    required
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    options={companiesList}
                    getOptionLabel={(c) => c?.name || ''}
                    value={selectedCompany}
                    onChange={(_, val) => setSelectedCompany(val)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        label="Entity / Company"
                        placeholder="Select Company"
                        fullWidth
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    select
                    label="Department"
                    size="small"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  >
                    <MenuItem value="general">General</MenuItem>
                    <MenuItem value="finance">Finance</MenuItem>
                    <MenuItem value="sales">Sales & Marketing</MenuItem>
                    <MenuItem value="operations">Operations</MenuItem>
                    <MenuItem value="admin">Administration</MenuItem>
                    {departments.map((d) => (
                      <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    select
                    required
                    label="Cost Center"
                    size="small"
                    value={costCenter}
                    onChange={(e) => {
                      if (e.target.value === '__add_new__') {
                        setNewCostCenter({ open: true, name: '', description: '', saving: false });
                        return;
                      }
                      setCostCenter(e.target.value);
                    }}
                    error={!costCenter && Boolean(error)}
                    helperText={
                      costCenters.filter((cc) => cc.isActive !== false).length === 0
                        ? 'No cost centers yet — use "Add new cost center" in this list'
                        : 'Required'
                    }
                  >
                    <MenuItem value="" disabled>
                      Select cost center…
                    </MenuItem>
                    {costCenters.filter((cc) => cc.isActive !== false).map((cc) => (
                      <MenuItem key={cc._id} value={cc._id}>
                        {cc.code ? `${cc.code} — ${cc.name}` : cc.name}
                      </MenuItem>
                    ))}
                    <Divider />
                    <MenuItem value="__add_new__" sx={{ color: 'primary.main', fontWeight: 600 }}>
                      <AddIcon fontSize="small" sx={{ mr: 1 }} /> Add new cost center
                    </MenuItem>
                  </TextField>
                  <Dialog
                    open={newCostCenter.open}
                    onClose={() => !newCostCenter.saving && setNewCostCenter({ open: false, name: '', description: '', saving: false })}
                    maxWidth="xs"
                    fullWidth
                  >
                    <DialogTitle>Add cost center</DialogTitle>
                    <DialogContent dividers>
                      <TextField
                        autoFocus
                        fullWidth
                        required
                        size="small"
                        label="Name"
                        value={newCostCenter.name}
                        onChange={(e) => setNewCostCenter((d) => ({ ...d, name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveNewCostCenter(); }}
                        sx={{ mb: 2 }}
                      />
                      <TextField
                        fullWidth
                        multiline
                        minRows={2}
                        size="small"
                        label="Description (optional)"
                        value={newCostCenter.description}
                        onChange={(e) => setNewCostCenter((d) => ({ ...d, description: e.target.value }))}
                      />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                        Added to the current finance company and selected on this invoice.
                      </Typography>
                    </DialogContent>
                    <DialogActions>
                      <Button
                        disabled={newCostCenter.saving}
                        onClick={() => setNewCostCenter({ open: false, name: '', description: '', saving: false })}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="contained"
                        startIcon={newCostCenter.saving ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
                        disabled={newCostCenter.saving || !newCostCenter.name.trim()}
                        onClick={saveNewCostCenter}
                      >
                        Add
                      </Button>
                    </DialogActions>
                  </Dialog>
                </Grid>
              </Grid>
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />

          {/* Revenue Line Items Section */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="h6" fontWeight={700}>
              Revenue & Line Item Breakdown
            </Typography>
            <Button variant="outlined" size="small" startIcon={<InventoryIcon />} onClick={openSinDialog}>
              Load from Store Issue Note
            </Button>
          </Stack>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <Table size="small">
              <TableHead sx={{ backgroundColor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ width: 45, fontWeight: 700 }}>#</TableCell>
                  <TableCell sx={{ minWidth: 260, fontWeight: 700 }}>REVENUE ACCOUNT (CHART OF ACCOUNTS)</TableCell>
                  <TableCell sx={{ minWidth: 260, fontWeight: 700 }}>DESCRIPTION</TableCell>
                  <TableCell sx={{ width: 100, fontWeight: 700 }} align="right">QTY</TableCell>
                  <TableCell sx={{ width: 150, fontWeight: 700 }} align="right">RATE (PKR)</TableCell>
                  <TableCell sx={{ width: 160, fontWeight: 700 }} align="right">AMOUNT (PKR)</TableCell>
                  <TableCell sx={{ width: 80, fontWeight: 700 }} align="center">ACTION</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((row, idx) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>{idx + 1}</TableCell>

                    {/* Revenue Account Selection */}
                    <TableCell>
                      <Autocomplete
                        options={revenueAccounts}
                        getOptionLabel={(o) => {
                          if (o?.__isNewOption) return '+ Add new revenue account';
                          return o?.name ? `${o.name} (${o.accountNumber || ''})` : '';
                        }}
                        value={row.account}
                        onChange={(_, val) => {
                          if (val?.__isNewOption) {
                            handleOpenAddAccount(idx);
                          } else {
                            handleLineChange(idx, 'account', val);
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
                              <Chip label={option.type || 'Revenue'} size="small" variant="outlined" color="success" sx={{ height: 20, fontSize: 10 }} />
                            </li>
                          );
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            size="small"
                            placeholder="Select Revenue Category"
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
                        placeholder="Description of goods or services"
                        value={row.description}
                        onChange={(e) => handleLineChange(idx, 'description', e.target.value)}
                      />
                      {row.sourceSin && (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                          <Chip label={row.sourceSinNumber || 'SIN'} size="small" color="info" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                          <Typography variant="caption" color="text.secondary">
                            Cost {formatPKR(row.unitCost)}{row.unit ? ` / ${row.unit}` : ''}
                            {row.maxQty != null ? ` · ${row.maxQty} open` : ''}
                          </Typography>
                        </Stack>
                      )}
                    </TableCell>

                    {/* Qty */}
                    <TableCell align="right">
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        value={row.quantity}
                        onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
                        inputProps={{ min: 1, ...(row.maxQty != null ? { max: row.maxQty } : {}), style: { textAlign: 'right' } }}
                        error={row.maxQty != null && Number(row.quantity) > row.maxQty}
                      />
                    </TableCell>

                    {/* Rate */}
                    <TableCell align="right">
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        value={row.unitPrice}
                        onChange={(e) => handleLineChange(idx, 'unitPrice', e.target.value)}
                        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }}
                        placeholder={row.sourceSin ? 'Selling price' : '0.00'}
                        error={Boolean(row.sourceSin) && !(Number(row.unitPrice) > 0)}
                      />
                      {row.sourceSin && Number(row.unitPrice) > 0 && row.unitCost > 0 && (
                        <Typography
                          variant="caption"
                          color={Number(row.unitPrice) >= row.unitCost ? 'success.main' : 'error.main'}
                          sx={{ display: 'block', mt: 0.5 }}
                        >
                          Margin {formatPKR((Number(row.unitPrice) - row.unitCost) * (Number(row.quantity) || 0))}
                        </Typography>
                      )}
                    </TableCell>

                    {/* Amount */}
                    <TableCell align="right">
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        placeholder="0.00"
                        value={row.amount}
                        onChange={(e) => handleLineChange(idx, 'amount', e.target.value)}
                        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right', fontWeight: 'bold' } }}
                      />
                    </TableCell>

                    {/* Delete Action */}
                    <TableCell align="center">
                      <IconButton size="small" color="error" onClick={() => handleDeleteLine(idx)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Button
            startIcon={<AddIcon />}
            variant="outlined"
            size="small"
            onClick={handleAddLine}
            sx={{ mb: 3 }}
          >
            Add Line
          </Button>

          {/* Notes & Summary */}
          <Grid container spacing={3}>
            <Grid item xs={12} md={7}>
              <TextField
                label="Invoice Notes & Terms"
                multiline
                rows={3}
                fullWidth
                size="small"
                placeholder="Payment instructions, bank wire info, or invoice notes for the client..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={5}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, backgroundColor: 'background.default' }}>
                <Stack spacing={1.5}>
                  <Box display="flex" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">Subtotal:</Typography>
                    <Typography variant="body2" fontWeight={600}>{formatPKR(grandTotal)}</Typography>
                  </Box>
                  <Divider />
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6" fontWeight={700}>Total Receivable:</Typography>
                    <Typography variant="h6" fontWeight={800} color="success.main">
                      {formatPKR(grandTotal)}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Posting this invoice will automatically debit <strong>1100 Accounts Receivable</strong> and credit your selected <strong>Revenue Accounts</strong> in the General Ledger.
                  </Typography>
                </Stack>
              </Paper>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Bottom Sticky Action Bar */}
      <Paper
        elevation={3}
        sx={{
          p: 2,
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          borderRadius: 2
        }}
      >
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            onClick={() => navigate('/finance/accounts-receivable')}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            size="large"
            disabled={submitting || grandTotal <= 0}
            startIcon={submitting ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
            onClick={handleSubmitInvoice}
            sx={{ px: 4, fontWeight: 700 }}
          >
            {submitting
              ? (isEditMode ? 'Updating Invoice…' : 'Booking Invoice…')
              : (isEditMode ? 'Update Invoice' : 'Save & Book Invoice')}
          </Button>
        </Stack>
      </Paper>

      {/* Load from Store Issue Note Dialog */}
      <Dialog open={sinDialog.open} onClose={() => setSinDialog((d) => ({ ...d, open: false }))} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Load items from Store Issue Note — {selectedCustomer?.name}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Cost (COGS / Inventory) was already posted when the store issued these items. Pick the items to bill — you enter the selling price on the invoice.
          </Typography>
          <TextField
            size="small"
            fullWidth
            placeholder="Search SIN number, department, item name or code… (press Enter)"
            value={sinDialog.search}
            onChange={(e) => setSinDialog((d) => ({ ...d, search: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchSins(sinDialog.search); }}
            sx={{ mb: 2 }}
          />
          {sinDialog.loading ? (
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress size={28} /></Box>
          ) : sinDialog.list.length === 0 ? (
            <Alert severity="info">No customer-wise Store Issue Notes for {selectedCustomer?.name} with qty left to invoice.</Alert>
          ) : (
            <Stack spacing={1.5}>
              {sinDialog.list.map((sin) => (
                <Paper key={sin._id} variant="outlined" sx={{ borderRadius: 2 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1, backgroundColor: 'action.hover' }} flexWrap="wrap">
                    <Typography fontWeight={700}>{sin.sinNumber}</Typography>
                    <Typography variant="body2" color="text.secondary">{toDateInput(sin.issueDate)}</Typography>
                    {[sin.project, sin.department, sin.requiredFor].filter(Boolean).map((t) => (
                      <Typography key={t} variant="body2" color="text.secondary">· {t}</Typography>
                    ))}
                    <Box sx={{ flexGrow: 1 }} />
                    <Chip size="small" label={SIN_STATUS[sin.invoiceStatus]?.label} color={SIN_STATUS[sin.invoiceStatus]?.color} />
                  </Stack>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" />
                        <TableCell sx={{ fontWeight: 700 }}>ITEM</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">ISSUED</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">INVOICED</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">OPEN</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">COST / UNIT</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sin.lines.map((l) => {
                        const key = sinKey(sin._id, l.inventoryItem);
                        const open = Math.max(0, l.qtyAvailable - qtyOnForm(sin._id, l.inventoryItem));
                        return (
                          <TableRow key={key} hover onClick={() => open > 0 && togglePicked(key)} sx={{ cursor: open > 0 ? 'pointer' : 'default', opacity: open > 0 ? 1 : 0.5 }}>
                            <TableCell padding="checkbox">
                              <Checkbox size="small" disabled={open <= 0} checked={Boolean(sinDialog.picked[key]) && open > 0} />
                            </TableCell>
                            <TableCell>
                              {l.itemName}
                              {l.itemCode && <Typography component="span" variant="caption" color="text.secondary"> ({l.itemCode})</Typography>}
                            </TableCell>
                            <TableCell align="right">{l.qtyIssued} {l.unit}</TableCell>
                            <TableCell align="right">{l.qtyInvoiced}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>
                              {open}
                              {open < l.qtyAvailable && <Typography component="span" variant="caption" color="text.secondary"> (rest on this form)</Typography>}
                            </TableCell>
                            <TableCell align="right">{formatPKR(l.unitCost)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Paper>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setSinDialog((d) => ({ ...d, open: false }))} color="inherit">Cancel</Button>
          <Button
            variant="contained"
            onClick={addPickedSinLines}
            disabled={!Object.keys(sinDialog.picked).length}
          >
            Add {Object.keys(sinDialog.picked).length || ''} item(s) to invoice
          </Button>
        </DialogActions>
      </Dialog>

      {/* Quick Add Revenue Account Dialog */}
      <Dialog open={newAccountDialog} onClose={() => setNewAccountDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add New Revenue Account</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Account Name"
              required
              fullWidth
              size="small"
              placeholder="e.g. Consultancy Services, Land Transfer Fee"
              value={newAccountForm.name}
              onChange={(e) => setNewAccountForm((p) => ({ ...p, name: e.target.value }))}
            />
            <TextField
              label="Account Number / Code"
              required
              fullWidth
              size="small"
              placeholder="e.g. 4050"
              value={newAccountForm.accountNumber}
              onChange={(e) => setNewAccountForm((p) => ({ ...p, accountNumber: e.target.value }))}
            />
            <FormControl fullWidth size="small">
              <InputLabel>Account Type</InputLabel>
              <Select
                value={newAccountForm.type}
                label="Account Type"
                disabled
              >
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
              placeholder="Optional notes"
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
            disabled={creatingAccount || !newAccountForm.name.trim() || !newAccountForm.accountNumber.trim()}
          >
            {creatingAccount ? 'Saving...' : 'Save Account'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* New Customer Dialog */}
      <Dialog open={newCustomerDialog} onClose={() => !creatingCustomer && setNewCustomerDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" fontWeight={700}>Quick Add Customer</Typography>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ mt: 1 }}>
          <Stack spacing={2}>
            <TextField
              label="Customer / Company Name"
              required
              fullWidth
              size="small"
              value={newCustomerForm.name}
              onChange={(e) => setNewCustomerForm((p) => ({ ...p, name: e.target.value }))}
            />
            <TextField
              label="Email"
              fullWidth
              size="small"
              type="email"
              value={newCustomerForm.email}
              onChange={(e) => setNewCustomerForm((p) => ({ ...p, email: e.target.value }))}
            />
            <TextField
              label="Phone"
              fullWidth
              size="small"
              value={newCustomerForm.phone}
              onChange={(e) => setNewCustomerForm((p) => ({ ...p, phone: e.target.value }))}
            />
            <TextField
              label="Street Address"
              fullWidth
              size="small"
              multiline
              rows={2}
              value={newCustomerForm.street}
              onChange={(e) => setNewCustomerForm((p) => ({ ...p, street: e.target.value }))}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {[['ntn', 'NTN'], ['strn', 'STRN'], ['cnic', 'CNIC']].map(([key, label]) => (
                <TextField
                  key={key}
                  label={label}
                  fullWidth
                  size="small"
                  value={newCustomerForm[key] || ''}
                  onChange={(e) => setNewCustomerForm((p) => ({ ...p, [key]: e.target.value }))}
                />
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setNewCustomerDialog(false)} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleSaveNewCustomer}
            variant="contained"
            disabled={creatingCustomer || !newCustomerForm.name.trim()}
          >
            {creatingCustomer ? 'Saving...' : 'Save Customer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StandardCustomerInvoiceForm;
