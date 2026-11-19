import React, { useEffect, useState, useRef } from 'react';
import { usePagination } from '../../../hooks/usePagination';
import TablePaginationWrapper from '../../../components/TablePaginationWrapper';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Alert,
  Stack,
  MenuItem,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  CircularProgress,
  Divider,
  Collapse,
  Skeleton
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  Visibility as ViewIcon,
  Print as PrintIcon,
  Download as DownloadIcon,
  ReceiptLong as ReceiptIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  AttachFile as AttachFileIcon,
  Edit as EditIcon,
  Add as AddIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import jsPDF from 'jspdf';
import { useNavigate } from 'react-router-dom';
import {
  createWaterCharge,
  updateWaterCharge,
  addPaymentToPropertyWater
} from '../../../services/waterChargesService';
import {
  createInvoice,
  updateInvoice,
  fetchInvoicesForProperty,
  deleteInvoice,
  deletePaymentFromInvoice,
  getWaterCalculation,
  bulkCreateWaterInvoices
} from '../../../services/propertyInvoiceService';
import { generateWaterInvoicePDF as generateWaterInvoicePDFUtil } from '../../../utils/invoicePDFGenerators';
import api from '../../../services/api';
import pakistanBanks from '../../../constants/pakistanBanks';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

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

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

const defaultForm = {
  invoiceNumber: '',
  plotNo: '',
  rdaNo: '',
  street: '',
  sector: '',
  category: '',
  address: '',
  project: '',
  owner: '',
  contactNo: '',
  status: 'Active',
  fileSubmission: '',
  demarcationDate: '',
  constructionDate: '',
  familyStatus: '',
  arrears: 0,
  amount: 0,
  amountInWords: ''
};

const statusOptions = ['Active', 'Pending', 'Completed', 'Cancelled'];

const months = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' }
];

const WaterBills = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingCharge, setViewingCharge] = useState(null);
  const [formData, setFormData] = useState(defaultForm);
  const [editingCharge, setEditingCharge] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  
  // Filter state
  const [statusFilter, setStatusFilter] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  
  // Bulk create state
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkCreateDialogOpen, setBulkCreateDialogOpen] = useState(false);
  const [bulkCreateInvoiceData, setBulkCreateInvoiceData] = useState({
    invoiceDate: dayjs().format('YYYY-MM-DD'),
    periodFrom: dayjs().startOf('month').format('YYYY-MM-DD'),
    periodTo: dayjs().endOf('month').format('YYYY-MM-DD'),
    dueDate: dayjs().endOf('month').add(15, 'day').format('YYYY-MM-DD')
  });
  // Track properties with invoices created (for visual indicator)
  const [propertiesWithInvoicesCreated, setPropertiesWithInvoicesCreated] = useState(new Set());
  const clearIndicatorsTimeoutRef = useRef(null);
  
  // Properties state
  const [properties, setProperties] = useState([]);
  const [totalCounts, setTotalCounts] = useState({ totalProperties: 0, totalAmount: 0, totalArrears: 0 });
  const [currentOverviewLoading, setCurrentOverviewLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [expandedInvoices, setExpandedInvoices] = useState(new Set());
  
  // Pagination
  const pagination = usePagination({
    defaultRowsPerPage: 50,
    resetDependencies: [search, statusFilter, sectorFilter, categoryFilter]
  });
  
  // Payment state
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [selectedProperty] = useState(null);
  const [paymentContext] = useState({ baseCharge: 0, baseArrears: 0 });
  const [selectedPaymentMonth, setSelectedPaymentMonth] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    arrears: 0,
    paymentDate: dayjs().format('YYYY-MM-DD'),
    month: dayjs().format('MM'),
    year: dayjs().format('YYYY'),
    invoiceNumber: '',
    paymentMethod: 'Bank Transfer',
    bankName: '',
    reference: '',
    notes: ''
  });
  const [paymentAttachment, setPaymentAttachment] = useState(null);
  
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [invoiceProperty, setInvoiceProperty] = useState(null);
  const [invoiceData, setInvoiceData] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [, setInvoiceWasSaved] = useState(false);
  const [propertyInvoices, setPropertyInvoices] = useState({});
  const [loadingInvoices, setLoadingInvoices] = useState({});

  // Removed loadCharges() - not needed, data comes from current-overview endpoint
  // The water-charges overview returns property rows with slab-based amounts

  useEffect(() => {
    // Load properties when component mounts, pagination changes, or filters change
    loadProperties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.rowsPerPage, search, statusFilter, sectorFilter, categoryFilter]);

  const loadProperties = async () => {
    try {
      setCurrentOverviewLoading(true);
      const params = pagination.getApiParams();
      // Add search and filter parameters
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (sectorFilter) params.sector = sectorFilter;
      if (categoryFilter) params.categoryType = categoryFilter;
      const response = await api.get('/taj-utilities/water-charges/current-overview', { params });
      setProperties(response.data.data?.properties || []);
      if (response.data.data?.pagination) {
        pagination.setTotal(response.data.data.pagination.total);
      }
      if (response.data.data) {
        setTotalCounts({
          totalProperties: response.data.data.totalProperties || 0,
          totalAmount: response.data.data.totalAmountAllPages || response.data.data.totalAmount || 0,
          totalArrears: response.data.data.totalArrearsAllPages || response.data.data.totalArrears || 0
        });
      }
    } catch (error) {
      console.error('Error fetching properties:', error);
      setError('Failed to load properties');
    } finally {
      setCurrentOverviewLoading(false);
    }
  };

  const toggleRowExpansion = async (propertyId) => {
    const newExpanded = new Set(expandedRows);
    const isExpanding = !newExpanded.has(propertyId);

    if (isExpanding) {
      newExpanded.add(propertyId);
      // Fetch invoices when expanding
      if (!propertyInvoices[propertyId]) {
        try {
          setLoadingInvoices(prev => ({ ...prev, [propertyId]: true }));
          const response = await fetchInvoicesForProperty(propertyId);
          setPropertyInvoices(prev => ({ ...prev, [propertyId]: response.data?.data || [] }));
        } catch (err) {
          console.error('Error fetching invoices:', err);
          setPropertyInvoices(prev => ({ ...prev, [propertyId]: [] }));
        } finally {
          setLoadingInvoices(prev => ({ ...prev, [propertyId]: false }));
        }
      }
    } else {
      newExpanded.delete(propertyId);
    }
    setExpandedRows(newExpanded);
  };

  // Properties are already filtered on the backend, so use them directly
  const filteredProperties = properties;


  const toggleInvoiceExpansion = (invoiceId) => {
    const newExpanded = new Set(expandedInvoices);
    if (newExpanded.has(invoiceId)) {
      newExpanded.delete(invoiceId);
    } else {
      newExpanded.add(invoiceId);
    }
    setExpandedInvoices(newExpanded);
  };

  const handleEditInvoice = async (property, invoice) => {
    setInvoiceProperty(property);
    setInvoiceData(invoice);
    setInvoiceError('');
    setInvoiceWasSaved(true); // Mark as saved since it's an existing invoice
    setInvoiceDialogOpen(true);
  };

  // Generate invoice number helper function
  const generateInvoiceNumber = (propertySrNo, year, month, type = 'WATER') => {
    const paddedMonth = String(month).padStart(2, '0');
    const paddedIndex = String(propertySrNo || 1).padStart(4, '0');
    
    let prefix = 'INV';
    if (type === 'WATER' || type === 'WTR') {
      prefix = 'INV-WTR';
    } else if (type === 'ELECTRICITY' || type === 'ELC') {
      prefix = 'INV-ELC';
    } else if (type === 'RENT' || type === 'REN') {
      prefix = 'INV-REN';
    } else if (type === 'MIXED' || type === 'MIX') {
      prefix = 'INV-MIX';
    }
    
    return `${prefix}-${year}-${paddedMonth}-${paddedIndex}`;
  };

  const handleCreateInvoice = async (property) => {
    setInvoiceProperty(property);
    setInvoiceData(null); // Reset invoice data for new invoice
    setInvoiceError('');
    setInvoiceWasSaved(false); // Reset saved flag
    setInvoiceDialogOpen(true);

    try {
      setInvoiceLoading(true);

      const now = dayjs();
      const periodFrom = now.startOf('month').toDate();
      const periodTo = now.endOf('month').toDate();
      const invoiceNumber = generateInvoiceNumber(
        property.srNo,
        now.year(),
        now.month() + 1,
        'WATER'
      );

      // Fetch water amount from charges slabs + overdue arrears for this property
      let waterAmount = 0;
      let waterArrears = 0;
      let chargeDescription = 'Water Charges';
      try {
        const calcRes = await getWaterCalculation(property._id);
        const calcData = calcRes?.data?.data;
        if (calcData) {
          waterAmount = Number(calcData.amount) || 0;
          waterArrears = Number(calcData.arrears) || 0;
          chargeDescription = calcData.description || chargeDescription;
        }
      } catch (err) {
        console.error('Failed to fetch water calculation:', err);
      }

      const total = waterAmount + waterArrears;
      setInvoiceData({
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate: dayjs(periodTo).add(15, 'day').toDate(),
        periodFrom,
        periodTo,
        chargeTypes: ['WATER'],
        charges: [{
          type: 'WATER',
          description: chargeDescription,
          amount: waterAmount,
          arrears: waterArrears,
          total
        }],
        subtotal: waterAmount,
        totalArrears: waterArrears,
        grandTotal: total
      });
    } catch (err) {
      setInvoiceError(err.response?.data?.message || 'Failed to prepare invoice');
      const now = dayjs();
      const periodFrom = now.startOf('month').toDate();
      const periodTo = now.endOf('month').toDate();
      setInvoiceData({
        invoiceNumber: generateInvoiceNumber(property.srNo, now.year(), now.month() + 1, 'WATER'),
        invoiceDate: new Date(),
        dueDate: dayjs(periodTo).add(15, 'day').toDate(),
        periodFrom,
        periodTo,
        chargeTypes: ['WATER'],
        charges: [{ type: 'WATER', description: 'Water Charges', amount: 0, arrears: 0, total: 0 }],
        subtotal: 0,
        totalArrears: 0,
        grandTotal: 0
      });
    } finally {
      setInvoiceLoading(false);
    }
  };

  const handleInvoiceFieldChange = (field, value) => {
    if (!invoiceData) return;
    
    if (field.startsWith('charge.')) {
      const parts = field.split('.');
      const chargeIndex = parseInt(parts[1], 10);
      const chargeField = parts[2];
      const updatedCharges = [...invoiceData.charges];
      const numVal = chargeField === 'amount' || chargeField === 'arrears' ? Number(value) || 0 : value;
      updatedCharges[chargeIndex] = {
        ...updatedCharges[chargeIndex],
        [chargeField]: numVal
      };
      const c = updatedCharges[chargeIndex];
      const amt = Number(c.amount) || 0;
      const arr = Number(c.arrears) || 0;
      updatedCharges[chargeIndex] = { ...c, total: amt + arr };
      
      const waterLines = updatedCharges.filter(ch => ch.type === 'WATER');
      const subtotal = waterLines.reduce((sum, charge) => sum + (charge.amount || 0), 0);
      const totalArrears = waterLines.reduce((sum, charge) => sum + (charge.arrears || 0), 0);
      const grandTotal = subtotal + totalArrears;
      
      setInvoiceData({
        ...invoiceData,
        charges: updatedCharges,
        subtotal,
        totalArrears,
        grandTotal
      });
    } else {
      setInvoiceData({
        ...invoiceData,
        [field]: field === 'periodFrom' || field === 'periodTo' || field === 'dueDate' || field === 'invoiceDate'
          ? (value ? new Date(value) : null)
          : field === 'grandTotal' || field === 'subtotal' || field === 'totalArrears'
          ? Number(value) || 0
          : value
      });
    }
  };

  const handleSaveInvoice = async () => {
    if (!invoiceData || !invoiceProperty) {
      setInvoiceError('Invoice data is incomplete');
      return;
    }

    try {
      setInvoiceLoading(true);
      setInvoiceError('');
      
      // If editing existing invoice (has _id), update it
      if (invoiceData._id) {
        const response = await updateInvoice(invoiceData._id, {
          invoiceNumber: invoiceData.invoiceNumber,
          invoiceDate: invoiceData.invoiceDate ? (invoiceData.invoiceDate instanceof Date ? invoiceData.invoiceDate : new Date(invoiceData.invoiceDate)) : new Date(),
          dueDate: invoiceData.dueDate,
          periodFrom: invoiceData.periodFrom,
          periodTo: invoiceData.periodTo,
          charges: invoiceData.charges,
          subtotal: invoiceData.subtotal,
          totalArrears: invoiceData.totalArrears,
          grandTotal: invoiceData.grandTotal
        });

        setInvoiceData(response.data?.data || invoiceData);
        setSuccess('Invoice updated successfully');
        setInvoiceWasSaved(true); // Mark as saved
        
        // Refresh invoices for this property
        if (invoiceProperty?._id) {
          const invoiceResponse = await fetchInvoicesForProperty(invoiceProperty._id);
          setPropertyInvoices(prev => ({ ...prev, [invoiceProperty._id]: invoiceResponse.data?.data || [] }));
        }
        
        // Close dialog after a short delay
        setTimeout(() => {
          handleCloseInvoiceDialog();
        }, 1500);
        return;
      }
      
      // Create new invoice
      const response = await createInvoice(invoiceProperty._id, {
        includeWater: true,
        includeElectricity: false,
        includeRent: false,
        invoiceDate: invoiceData.invoiceDate ? (invoiceData.invoiceDate instanceof Date ? invoiceData.invoiceDate : new Date(invoiceData.invoiceDate)) : new Date(),
        periodFrom: invoiceData.periodFrom,
        periodTo: invoiceData.periodTo,
        dueDate: invoiceData.dueDate,
        charges: invoiceData.charges || []
      });

      const savedInvoice = response.data?.data || invoiceData;
      setInvoiceData(savedInvoice);
      setSuccess('Invoice created successfully');
      setInvoiceWasSaved(true); // Mark as saved
      
      // Refresh invoices for this property
      if (invoiceProperty?._id) {
        const invoiceResponse = await fetchInvoicesForProperty(invoiceProperty._id);
        setPropertyInvoices(prev => ({ ...prev, [invoiceProperty._id]: invoiceResponse.data?.data || [] }));
      }
      
      // Close dialog after a short delay
      setTimeout(() => {
        handleCloseInvoiceDialog();
      }, 1500);
    } catch (err) {
      setInvoiceError(err.response?.data?.message || 'Failed to save invoice');
    } finally {
      setInvoiceLoading(false);
    }
  };

  const handleCloseInvoiceDialog = () => {
    setInvoiceDialogOpen(false);
    setInvoiceProperty(null);
    setInvoiceData(null);
    setInvoiceError('');
    setInvoiceWasSaved(false); // Reset saved flag
  };

  const handleDeleteInvoice = async (property, invoice) => {
    if (!window.confirm(`Are you sure you want to delete invoice ${invoice.invoiceNumber || invoice._id}?`)) {
      return;
    }

    try {
      setError('');
      await deleteInvoice(invoice._id);
      setSuccess('Invoice deleted successfully');
      
      // Refresh invoices for this property
      if (property?._id) {
        const invoiceResponse = await fetchInvoicesForProperty(property._id);
        setPropertyInvoices(prev => ({ ...prev, [property._id]: invoiceResponse.data?.data || [] }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete invoice');
    }
  };

  const handleDeleteInvoicePayment = async (invoiceId, paymentId, propertyId) => {
    if (!window.confirm('Are you sure you want to delete this payment?')) {
      return;
    }

    try {
      setError('');
      await deletePaymentFromInvoice(invoiceId, paymentId);
      setSuccess('Payment deleted successfully');
      
      // Refresh invoices for this property
      if (propertyId) {
        const invoiceResponse = await fetchInvoicesForProperty(propertyId);
        setPropertyInvoices(prev => ({ ...prev, [propertyId]: invoiceResponse.data?.data || [] }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete payment');
    }
  };

  const generateInvoicePDF = async (propertyParam = null, invoiceParam = null, options = {}) => {
    const invoice = invoiceParam || invoiceData;
    const property = invoice?.property || propertyParam || invoiceProperty;
    
    if (!property || !invoice) return;
    
    return await generateWaterInvoicePDFUtil(invoice, property, options);
  };

  const handleDownloadInvoice = async () => {
    if (!invoiceProperty || !invoiceData) {
      setInvoiceError('Invoice data is not ready yet. Please wait a moment.');
      return;
    }
    // Only allow download if invoice is already saved (has _id) or if it's an existing invoice
    if (!invoiceData._id) {
      setInvoiceError('Please create the invoice first before downloading.');
      return;
    }
    await generateInvoicePDF();
  };

  // Helper function to check if invoice matches month/year
  const handleOpenBulkCreateDialog = () => {
    // Initialize bulk create invoice data with current month/year as defaults
    const now = dayjs();
    const periodFrom = now.startOf('month');
    const periodTo = now.endOf('month');
    
    setBulkCreateInvoiceData({
      invoiceDate: now.format('YYYY-MM-DD'),
      periodFrom: periodFrom.format('YYYY-MM-DD'),
      periodTo: periodTo.format('YYYY-MM-DD'),
      dueDate: periodTo.add(15, 'day').format('YYYY-MM-DD')
    });
    
    setBulkCreateDialogOpen(true);
  };

  const handleBulkCreateInvoices = async () => {
    if (!bulkCreateInvoiceData.periodFrom || !bulkCreateInvoiceData.periodTo) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setBulkCreating(true);
      setError('');
      setSuccess('');
      setBulkCreateDialogOpen(false);
      setPropertiesWithInvoicesCreated(new Set());
      if (clearIndicatorsTimeoutRef.current) {
        clearTimeout(clearIndicatorsTimeoutRef.current);
        clearIndicatorsTimeoutRef.current = null;
      }

      const periodFrom = new Date(bulkCreateInvoiceData.periodFrom);
      const periodTo = new Date(bulkCreateInvoiceData.periodTo);
      const invoiceDate = new Date(bulkCreateInvoiceData.invoiceDate);
      const dueDate = new Date(bulkCreateInvoiceData.dueDate);

      const propertiesToProcess = filteredProperties.length > 0 ? filteredProperties : properties;

      if (propertiesToProcess.length === 0) {
        setError('No properties found to create invoices for');
        setBulkCreating(false);
        return;
      }

      setSuccess(`Creating invoices for ${propertiesToProcess.length} property(ies)...`);

      const propertyIds = propertiesToProcess.map((p) => p._id);
      const res = await bulkCreateWaterInvoices({
        propertyIds,
        periodFrom: periodFrom.toISOString(),
        periodTo: periodTo.toISOString(),
        dueDate: dueDate.toISOString(),
        invoiceDate: invoiceDate.toISOString()
      });

      const summary = res?.data?.summary;
      const results = res?.data?.results || [];
      const createdIds = results.filter((r) => r.status === 'created').map((r) => String(r.propertyId));

      if (createdIds.length > 0) {
        setPropertiesWithInvoicesCreated(new Set(createdIds));
      }

      await loadProperties();

      let resultMessage = `Successfully created ${summary?.createdCount ?? 0} invoice(s)`;
      if (summary?.skippedCount > 0) {
        resultMessage += `, skipped ${summary.skippedCount} (already exist)`;
      }
      if (summary?.failedCount > 0) {
        resultMessage += `, ${summary.failedCount} failed`;
      }
      setSuccess(resultMessage);

      if (clearIndicatorsTimeoutRef.current) {
        clearTimeout(clearIndicatorsTimeoutRef.current);
      }
      clearIndicatorsTimeoutRef.current = setTimeout(() => {
        setPropertiesWithInvoicesCreated(new Set());
        clearIndicatorsTimeoutRef.current = null;
      }, 120000);
    } catch (err) {
      console.error('Bulk create error:', err);
      setError(err.response?.data?.message || err.message || 'Failed to create invoices. Please try again.');
    } finally {
      setBulkCreating(false);
    }
  };

  const renderInvoicePreview = () => {
    if (invoiceLoading) {
      return (
        <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      );
    }

    if (invoiceError) {
      return <Alert severity="error">{invoiceError}</Alert>;
    }

    if (!invoiceProperty) {
      return <Typography color="text.secondary">Select a property to create invoice.</Typography>;
    }

    if (!invoiceData) {
      return <Typography color="text.secondary">Creating invoice...</Typography>;
    }

    // Calculate total amount from charges + arrears
    const waterLines = invoiceData.charges?.filter(c => c.type === 'WATER') || [];
    const chargesTotal = waterLines.reduce((sum, charge) => sum + (charge.amount || 0), 0);
    const arrearsTotal = waterLines.reduce((sum, charge) => sum + (charge.arrears || 0), 0);
    const totalAmount = chargesTotal + arrearsTotal;

    return (
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle2" color="text.secondary">
            Property
          </Typography>
          <Typography variant="h6">
            {invoiceProperty.propertyName || invoiceProperty.propertyType || '—'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {invoiceProperty.address || invoiceProperty.street || 'No address recorded'}
          </Typography>
        </Box>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Invoice Number"
              value={invoiceData.invoiceNumber || ''}
              onChange={(e) => handleInvoiceFieldChange('invoiceNumber', e.target.value)}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Invoice Date"
              type="date"
              value={invoiceData.invoiceDate ? dayjs(invoiceData.invoiceDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')}
              onChange={(e) => handleInvoiceFieldChange('invoiceDate', e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Period From"
              type="date"
              value={invoiceData.periodFrom ? dayjs(invoiceData.periodFrom).format('YYYY-MM-DD') : ''}
              onChange={(e) => handleInvoiceFieldChange('periodFrom', e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Period To"
              type="date"
              value={invoiceData.periodTo ? dayjs(invoiceData.periodTo).format('YYYY-MM-DD') : ''}
              onChange={(e) => {
                const newPeriodTo = e.target.value;
                if (!invoiceData) return;
                
                // Update both periodTo and dueDate in a single state update
                const updatedData = {
                  ...invoiceData,
                  periodTo: newPeriodTo ? dayjs(newPeriodTo).toDate() : null
                };
                
                // Auto-set Due Date to 15 days after Period To
                if (newPeriodTo) {
                  const dueDate = dayjs(newPeriodTo).add(15, 'day').format('YYYY-MM-DD');
                  updatedData.dueDate = dayjs(dueDate).toDate();
                } else {
                  updatedData.dueDate = null;
                }
                
                setInvoiceData(updatedData);
              }}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          {invoiceData.charges?.filter(charge => charge.type === 'WATER').map((charge, filteredIdx) => {
            const originalIdx = invoiceData.charges.findIndex(c => c === charge);
            return (
              <React.Fragment key={originalIdx}>
          <Grid item xs={12} sm={6}>
                  <TextField
                    label={charge.description}
                    type="number"
                    value={charge.amount || 0}
                    onChange={(e) => handleInvoiceFieldChange(`charge.${originalIdx}.amount`, e.target.value)}
                    fullWidth
                    size="small"
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 1 }}>PKR</Typography>
                    }}
                  />
          </Grid>
          <Grid item xs={12} sm={6}>
                  <TextField
                    label={`${charge.description} Arrears`}
                    type="number"
                    value={charge.arrears || 0}
                    onChange={(e) => handleInvoiceFieldChange(`charge.${originalIdx}.arrears`, e.target.value)}
                    fullWidth
                    size="small"
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 1 }}>PKR</Typography>
                    }}
                  />
          </Grid>
              </React.Fragment>
            );
          })}
          <Grid item xs={12} sm={6}>
            <TextField
              label="Total Amount"
              value={formatCurrency(totalAmount)}
              fullWidth
              size="small"
              InputProps={{ readOnly: true }}
              sx={{
                '& .MuiInputBase-input': {
                  fontWeight: 600,
                  fontSize: '1.1rem'
                }
              }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Due Date"
              type="date"
              value={invoiceData.dueDate ? dayjs(invoiceData.dueDate).format('YYYY-MM-DD') : ''}
              onChange={(e) => handleInvoiceFieldChange('dueDate', e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
        </Grid>
        <Alert severity="info">
          Download to view the tri-fold invoice (Bank, Office & Client copies).
        </Alert>
      </Stack>
    );
  };

  const getPaymentStatusConfig = (status) => {
    const normalized = (status || 'unpaid').toLowerCase();
    switch (normalized) {
      case 'paid':
        return { color: 'success', label: 'Paid', iconColor: 'success.main' };
      case 'partial_paid':
        return { color: 'warning', label: 'Partial Paid', iconColor: 'warning.main' };
      case 'unpaid':
      default:
        return { color: 'error', label: 'Unpaid', iconColor: 'error.main' };
    }
  };

  // Helper function to calculate adjusted grandTotal for overdue unpaid invoices
  const getAdjustedGrandTotal = (invoice) => {
    if (!invoice) return 0;
    
    // Check if invoice is overdue (after due date + 4-day grace period ends) and unpaid/partially paid
    const GRACE_PERIOD_DAYS = 6;
    const invoiceDueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const dueStart = invoiceDueDate ? new Date(invoiceDueDate) : null; if (dueStart) dueStart.setHours(0, 0, 0, 0);
    const dueWithGrace = dueStart ? new Date(dueStart) : null; if (dueWithGrace) dueWithGrace.setDate(dueWithGrace.getDate() + GRACE_PERIOD_DAYS);
    const isOverdue = dueWithGrace && todayStart > dueWithGrace;
    const isUnpaid = invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'partial_paid' || (invoice.balance || 0) > 0;
    
    // If not overdue or already paid, return original grandTotal
    if (!isOverdue || !isUnpaid) {
      return invoice.grandTotal || 0;
    }
    
    // Calculate late payment surcharge (10% of charges for the month)
    let chargesForMonth = invoice.subtotal || 0;
    
    // If invoice has charges array, sum up the amount (not arrears) for each charge
    if (invoice.charges && Array.isArray(invoice.charges) && invoice.charges.length > 0) {
      const totalChargesAmount = invoice.charges.reduce((sum, charge) => sum + (charge.amount || 0), 0);
      if (totalChargesAmount > 0) {
        chargesForMonth = totalChargesAmount;
      }
    }
    
    // Calculate late payment surcharge
    const latePaymentSurcharge = Math.max(Math.round(chargesForMonth * 0.1), 0);
    
    // Calculate original grandTotal (without surcharge)
    const originalGrandTotal = invoice.grandTotal || (chargesForMonth + (invoice.totalArrears || 0));
    
    // Return adjusted grandTotal (original + surcharge)
    return originalGrandTotal + latePaymentSurcharge;
  };

  const handlePaymentDateChange = (dateValue) => {
    setPaymentForm((prev) => ({ ...prev, paymentDate: dateValue }));
  };

  const handleMonthYearChange = (month, year) => {
    const baseCharge = Number(paymentContext.baseCharge || 0);
    const selectedMonthKey = `${year}-${month}`;
    const monthChanged = selectedMonthKey !== selectedPaymentMonth;

    if (monthChanged) {
      // Auto-populate amount with Water Amount when month changes
    setPaymentForm((prev) => ({
      ...prev,
        month: month,
        year: year,
        amount: baseCharge > 0 ? baseCharge : '',
        arrears: 0 // Reset arrears when month changes
      }));
      setSelectedPaymentMonth(selectedMonthKey);
    } else {
      setPaymentForm((prev) => ({
        ...prev,
        month: month,
        year: year
      }));
    }
  };

  const handleCamAmountChange = (value) => {
    // Allow empty string to clear the field, otherwise convert to number
    const amountValue = value === '' || value === null || value === undefined 
      ? '' 
      : (Number(value) || 0);
    setPaymentForm((prev) => ({ ...prev, amount: amountValue }));
  };

  const handleCamPaymentMethodChange = (value) => {
    setPaymentForm((prev) => ({
      ...prev,
      paymentMethod: value,
      bankName: value === 'Cash' ? '' : prev.bankName
    }));
  };

  const handleCamAttachmentChange = (event) => {
    const file = event.target.files?.[0];
    setPaymentAttachment(file || null);
  };

  const handleClosePaymentDialog = () => {
    setPaymentDialog(false);
    setPaymentAttachment(null);
  };

  const handlePaymentSave = async () => {
    try {
      setError('');
      if (!selectedProperty) return;

      // Convert month/year to periodFrom/periodTo
      const selectedMonth = paymentForm.month || dayjs().format('MM');
      const selectedYear = paymentForm.year || dayjs().format('YYYY');
      const periodFrom = dayjs(`${selectedYear}-${selectedMonth}-01`).startOf('month').format('YYYY-MM-DD');
      const periodTo = dayjs(`${selectedYear}-${selectedMonth}-01`).endOf('month').format('YYYY-MM-DD');

      const formData = new FormData();
      Object.entries(paymentForm).forEach(([key, value]) => {
        // Skip month and year fields, we'll add periodFrom/periodTo instead
        if (key === 'month' || key === 'year') {
          return;
        }
        // Convert empty string to 0 for amount and arrears fields
        if ((key === 'amount' || key === 'arrears') && (value === '' || value === null || value === undefined)) {
          formData.append(key, 0);
        } else {
          formData.append(key, value ?? '');
        }
      });
      
      // Add periodFrom and periodTo from month/year
      formData.append('periodFrom', periodFrom);
      formData.append('periodTo', periodTo);
      
      if (paymentAttachment) {
        formData.append('attachment', paymentAttachment);
      }

      await addPaymentToPropertyWater(selectedProperty._id, formData);
      setSuccess('Payment recorded successfully');
      handleClosePaymentDialog();
      loadProperties();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record payment');
    }
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCharge(null);
    setFormData(defaultForm);
  };


  const handleCloseViewDialog = () => {
    setViewDialogOpen(false);
    setViewingCharge(null);
  };

  const handlePrintBill = () => {
    if (!viewingCharge) return;
    
    const printWindow = window.open('', '_blank');
    const printDate = new Date().toLocaleString();
    
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Water charge - ${viewingCharge.invoiceNumber || 'N/A'}</title>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              margin: 15px;
              color: #000;
              line-height: 1.5;
              font-size: 14px;
            }
            .header {
              text-align: center;
              border: 3px solid #000;
              padding: 20px;
              margin-bottom: 25px;
              background-color: #f9f9f9;
            }
            .header h1 {
              margin: 0 0 10px 0;
              color: #000;
            }
            .section {
              margin-bottom: 20px;
              border: 1px solid #ddd;
              padding: 15px;
            }
            .section-title {
              font-weight: bold;
              font-size: 16px;
              margin-bottom: 10px;
              border-bottom: 2px solid #000;
              padding-bottom: 5px;
            }
            .field-row {
              display: flex;
              margin-bottom: 8px;
            }
            .field-label {
              font-weight: bold;
              width: 200px;
            }
            .field-value {
              flex: 1;
            }
            .footer {
              margin-top: 30px;
              text-align: center;
              font-size: 12px;
              color: #666;
              border-top: 1px solid #ddd;
              padding-top: 10px;
            }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Water charge</h1>
            <p><strong>Invoice Number:</strong> ${viewingCharge.invoiceNumber || 'N/A'}</p>
            <p><strong>Serial Number:</strong> ${viewingCharge.serialNumber || 'N/A'}</p>
          </div>

          <div class="section">
            <div class="section-title">Invoice Information</div>
            <div class="field-row">
              <div class="field-label">Invoice Number:</div>
              <div class="field-value">${viewingCharge.invoiceNumber || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Serial Number:</div>
              <div class="field-value">${viewingCharge.serialNumber || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Status:</div>
              <div class="field-value">${viewingCharge.status || 'Active'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Property Information</div>
            <div class="field-row">
              <div class="field-label">Plot No:</div>
              <div class="field-value">${viewingCharge.plotNo || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">RDA No:</div>
              <div class="field-value">${viewingCharge.rdaNo || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Street:</div>
              <div class="field-value">${viewingCharge.street || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Sector:</div>
              <div class="field-value">${viewingCharge.sector || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Category:</div>
              <div class="field-value">${viewingCharge.category || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Project:</div>
              <div class="field-value">${viewingCharge.project || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Address:</div>
              <div class="field-value">${viewingCharge.address || 'N/A'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Owner Information</div>
            <div class="field-row">
              <div class="field-label">Owner:</div>
              <div class="field-value">${viewingCharge.owner || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Contact Number:</div>
              <div class="field-value">${viewingCharge.contactNo || 'N/A'}</div>
            </div>
            ${viewingCharge.familyStatus ? `
            <div class="field-row">
              <div class="field-label">Family Status:</div>
              <div class="field-value">${viewingCharge.familyStatus}</div>
            </div>
            ` : ''}
          </div>

          <div class="section">
            <div class="section-title">Financial Details</div>
            <div class="field-row">
              <div class="field-label">Amount:</div>
              <div class="field-value"><strong>${formatCurrency(viewingCharge.amount || 0)}</strong></div>
            </div>
            <div class="field-row">
              <div class="field-label">Arrears:</div>
              <div class="field-value">${formatCurrency(viewingCharge.arrears || 0)}</div>
            </div>
            ${viewingCharge.amountInWords ? `
            <div class="field-row">
              <div class="field-label">Amount in Words:</div>
              <div class="field-value">${viewingCharge.amountInWords}</div>
            </div>
            ` : ''}
          </div>

          ${(viewingCharge.fileSubmission || viewingCharge.demarcationDate || viewingCharge.constructionDate) ? `
          <div class="section">
            <div class="section-title">Important Dates</div>
            ${viewingCharge.fileSubmission ? `
            <div class="field-row">
              <div class="field-label">File Submission:</div>
              <div class="field-value">${dayjs(viewingCharge.fileSubmission).format('DD-MMM-YYYY')}</div>
            </div>
            ` : ''}
            ${viewingCharge.demarcationDate ? `
            <div class="field-row">
              <div class="field-label">Demarcation Date:</div>
              <div class="field-value">${dayjs(viewingCharge.demarcationDate).format('DD-MMM-YYYY')}</div>
            </div>
            ` : ''}
            ${viewingCharge.constructionDate ? `
            <div class="field-row">
              <div class="field-label">Construction Date:</div>
              <div class="field-value">${dayjs(viewingCharge.constructionDate).format('DD-MMM-YYYY')}</div>
            </div>
            ` : ''}
          </div>
          ` : ''}

          <div class="footer">
            <p><strong>Generated from SGC ERP System - Taj Utilities Water Charges</strong></p>
            <p>Charge ID: ${viewingCharge._id || 'N/A'} | Printed: ${printDate}</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(brandPrintHtml(printContent, { title: 'Water Bill' })); // Tovus ERP branded print
    printWindow.document.close();

    printWindow.onload = function() {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
  };

  const generateWaterPaymentReceiptPDF = (invoice, payment, property) => {
    // Constants
    const CONSTANTS = {
      COPIES: ['Bank Copy', 'Office Copy', 'Client Copy'],
      MARGIN_X: 6,
      TOP_MARGIN: 10,
      FOOTER_NOTES: [
        '1. This receipt confirms payment received for water charges as per the property agreement.',
        '2. Please keep this receipt for your records.',
        '3. For any queries, please contact TAJ Official WhatsApp No.: 0345 77 68 442.',
        '4. Late payment surcharges may apply if payment is made after the due date.'
      ],
      COLORS: {
        RED: [178, 34, 34],
        GREEN: [0, 128, 0],
        ORANGE: [255, 140, 0],
        WATERMARK_PAID: [200, 230, 200],
        WATERMARK_PARTIAL: [255, 220, 180],
        BLACK: [0, 0, 0]
      }
    };

    // Helper functions
    const formatDate = (value, format = 'D-MMM-YY') => value ? dayjs(value).format(format) : '—';
    const formatFullDate = (value) => value ? dayjs(value).format('MMMM D, YYYY') : '—';
    const formatAmount = (value) => {
      const num = Number(value) || 0;
      return (num < 0 ? '(' : '') + Math.abs(num).toLocaleString('en-PK', { minimumFractionDigits: 0 }) + (num < 0 ? ')' : '');
    };

    // Initialize PDF
    const pdf = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const panelWidth = pageWidth / 3;
    const availableWidth = panelWidth - CONSTANTS.MARGIN_X * 2;
    const panelCenterX = (panelWidth - CONSTANTS.MARGIN_X * 2) / 2;

    // Extract data
    const waterLine = invoice.charges?.find(c => c.type === 'WATER');
    const waterAmount = waterLine?.amount || 0;
    const arrears = waterLine?.arrears || 0;
    
    // Calculate month label
    const monthLabel = invoice.periodTo 
      ? dayjs(invoice.periodTo).format('MMMM-YY').toUpperCase()
      : dayjs().format('MMMM-YY').toUpperCase();

    // Calculate payment status
    const totalPaid = invoice.totalPaid || 0;
    const grandTotal = invoice.grandTotal || (waterAmount + arrears);
    const balance = invoice.balance || (grandTotal - totalPaid);
    const isPaid = balance <= 0 && totalPaid > 0;
    const isPartiallyPaid = totalPaid > 0 && balance > 0;
    const paymentStatus = isPaid ? 'PAID' : isPartiallyPaid ? 'PARTIALLY PAID' : 'UNPAID';
    const paymentStatusColor = isPaid ? CONSTANTS.COLORS.GREEN : 
                              isPartiallyPaid ? CONSTANTS.COLORS.ORANGE : CONSTANTS.COLORS.RED;

    // Property data
    const ownerName = property.ownerName || property.tenantName || '—';
    const propertyName = property.propertyName || property.plotNumber || '—';
    const address = property.address || property.fullAddress || '—';
    const plotNumber = property.plotNumber || '—';

    // Draw vertical dividers
    pdf.setDrawColor(170);
    pdf.setLineWidth(0.3);
    if (pdf.setLineDash) pdf.setLineDash([1, 2], 0);
    pdf.line(panelWidth, CONSTANTS.TOP_MARGIN - 5, panelWidth, pageHeight - 15);
    pdf.line(panelWidth * 2, CONSTANTS.TOP_MARGIN - 5, panelWidth * 2, pageHeight - 15);
    if (pdf.setLineDash) pdf.setLineDash([], 0);

    // Reusable drawing functions
    const setTextStyle = (font = 'helvetica', style = 'normal', size = 10) => {
      pdf.setFont(font, style);
      pdf.setFontSize(size);
    };

    const drawInlineField = (label, value, startX, startY, labelWidth = 30) => {
      const valueWidth = availableWidth - labelWidth;
      setTextStyle('helvetica', 'bold', 7);
      pdf.text(label, startX, startY);
      setTextStyle('helvetica', 'normal');
      const lines = pdf.splitTextToSize(String(value || '—'), valueWidth);
      lines.forEach((line, idx) => {
        pdf.text(line, startX + labelWidth, startY + idx * 4.5);
      });
      return startY + lines.length * 4.5 + 1.5;
    };

    const drawWatermark = (startX) => {
      if (!isPaid && !isPartiallyPaid) return;
      
      const watermarkText = isPaid ? 'PAID' : 'PARTIAL PAID';
      const centerX = startX + panelCenterX;
      const centerY = pageHeight / 2;
      
      setTextStyle('helvetica', 'bold', 40);
      pdf.setTextColor(...(isPaid ? CONSTANTS.COLORS.WATERMARK_PAID : CONSTANTS.COLORS.WATERMARK_PARTIAL));
      pdf.text(watermarkText, centerX, centerY, { align: 'center', angle: -45 });
      pdf.setTextColor(...CONSTANTS.COLORS.BLACK);
    };

    const drawFooter = (startX, cursorY) => {
      setTextStyle('helvetica', 'italic', 5.2);
      const footerWidth = availableWidth;
      
      // Pre-calculate wrapped lines and height
      const wrappedLines = [];
      let totalFooterHeight = 0;
      CONSTANTS.FOOTER_NOTES.forEach((line) => {
        const wrapped = pdf.splitTextToSize(line, footerWidth);
        wrappedLines.push(wrapped);
        totalFooterHeight += wrapped.length * 3.2;
      });
      
      const footerStartY = Math.max(cursorY + 5, pageHeight - totalFooterHeight - 8);
      let noteY = footerStartY;
      
      wrappedLines.forEach((wrapped) => {
        wrapped.forEach((wrappedLine) => {
          pdf.text(wrappedLine, startX, noteY);
          noteY += 3.2;
        });
      });
    };

    const drawPanel = (copyLabel, columnIndex) => {
      const startX = columnIndex * panelWidth + CONSTANTS.MARGIN_X;
      let cursorY = CONSTANTS.TOP_MARGIN;

      // Copy label
      setTextStyle('helvetica', 'italic', 8);
      pdf.text(`(${copyLabel})`, startX + panelCenterX, cursorY, { align: 'center' });
      cursorY += 5;

      // Header
      setTextStyle('helvetica', 'bold', 9);
      pdf.setTextColor(...CONSTANTS.COLORS.RED);
      pdf.text(`Taj Water Payment Receipt For The Month Of ${monthLabel}`, startX + panelCenterX, cursorY, { align: 'center' });
      pdf.setTextColor(...CONSTANTS.COLORS.BLACK);
      cursorY += 5;

      setTextStyle('helvetica', 'bold', 9);
      pdf.text('Water Payment Receipt', startX + panelCenterX, cursorY, { align: 'center' });
      cursorY += 6;

      // Property and Invoice fields
      const inlineFields = [
        ['Property Name', propertyName],
        ['Owner Name', ownerName],
        ['Plot Number', plotNumber],
        ['Address', address],
        ['Period From', formatDate(invoice.periodFrom)],
        ['Period To', formatDate(invoice.periodTo)],
        ['Invoice No.', invoice.invoiceNumber || '—'],
        ['Due Date', formatFullDate(invoice.dueDate)],
      ];
      
      inlineFields.forEach(([label, value]) => {
        cursorY = drawInlineField(label, value, startX, cursorY);
      });
      cursorY += 2;

      // Water Charges Summary
      setTextStyle('helvetica', 'bold', 8);
      pdf.text('Water Charges Summary', startX, cursorY);
      cursorY += 3;

      const chargesRows = [
        { label: 'Water Charges', value: formatAmount(waterAmount), bold: false },
        { label: 'Arrears', value: formatAmount(arrears), bold: false },
        { label: 'Grand Total', value: formatAmount(grandTotal), bold: true }
      ];

      const rowHeight = 5;
      setTextStyle('helvetica', 'normal', 7);
      
      chargesRows.forEach((row) => {
        setTextStyle('helvetica', row.bold ? 'bold' : 'normal', 7);
        pdf.text(row.label, startX, cursorY + 4);
        pdf.text(String(row.value), startX + availableWidth, cursorY + 4, { align: 'right' });
        pdf.line(startX, cursorY + rowHeight, startX + availableWidth, cursorY + rowHeight);
        cursorY += rowHeight;
      });
      cursorY += 4;

      // Payment Information Section
      setTextStyle('helvetica', 'bold', 8);
      pdf.text('Payment Information', startX, cursorY);
      cursorY += 5;

      const paymentInfo = [
        ['Payment Date:', formatFullDate(payment.paymentDate)],
        ['Payment Amount:', formatAmount(payment.amount || 0)],
        ['Arrears Paid:', formatAmount(payment.arrears || 0)],
        ['Total Paid:', formatAmount(payment.totalAmount || payment.amount || 0)],
        ['Payment Method:', payment.paymentMethod || '—'],
        ['Bank:', payment.bankName || '—'],
        ['Reference:', payment.reference || '—'],
      ];

      paymentInfo.forEach(([label, value]) => {
        cursorY = drawInlineField(label, value, startX, cursorY);
      });
      cursorY += 3;

      // Payment Status
      setTextStyle('helvetica', 'bold', 9);
      pdf.setTextColor(...paymentStatusColor);
      pdf.text(`Status: ${paymentStatus}`, startX + panelCenterX, cursorY, { align: 'center' });
      pdf.setTextColor(...CONSTANTS.COLORS.BLACK);
      cursorY += 5;

      // Total Summary
      setTextStyle('helvetica', 'bold', 7);
      pdf.text('Grand Total:', startX, cursorY);
      pdf.text(formatAmount(grandTotal), startX + availableWidth, cursorY, { align: 'right' });
      cursorY += 5;
      pdf.text('Total Paid:', startX, cursorY);
      pdf.text(formatAmount(totalPaid), startX + availableWidth, cursorY, { align: 'right' });
      cursorY += 5;
      setTextStyle('helvetica', 'bold', 8);
      pdf.text('Balance:', startX, cursorY);
      pdf.text(formatAmount(balance), startX + availableWidth, cursorY, { align: 'right' });
      cursorY += 8;

      // Footer and watermark
      drawFooter(startX, cursorY);
      drawWatermark(startX);
    };

    // Generate all panels
    CONSTANTS.COPIES.forEach((copy, index) => drawPanel(copy, index));

    // Save PDF
    const sanitizedName = (property.propertyName || property.plotNumber || property.srNo || 'water-property')
      .toString().replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '_');
    const receiptDate = dayjs(payment.paymentDate).format('YYYY-MM-DD');
    pdf.save(`Water_Payment_Receipt_${sanitizedName}_${receiptDate}.pdf`);
  };

  const handleDownloadPDF = () => {
    if (!viewingCharge) return;

    const pdf = new jsPDF('portrait', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const leftMargin = margin;
    const rightMargin = pageWidth - margin;
    let yPos = margin;

    // Helper function to add new page if needed
    const checkNewPage = (requiredSpace) => {
      if (yPos + requiredSpace > pageHeight - margin) {
        pdf.addPage();
        yPos = margin;
        return true;
      }
      return false;
    };

    // Header
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text('TAJ RESIDENCIA', pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;
    
    pdf.setFontSize(16);
    pdf.text('Water charge', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;

    // Invoice Information
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Invoice Information', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Invoice Number:', leftMargin, yPos);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(viewingCharge.invoiceNumber || 'N/A'), leftMargin + 40, yPos);
    yPos += 5;
    
    pdf.setFont('helvetica', 'normal');
    pdf.text('Serial Number:', leftMargin, yPos);
    pdf.text(String(viewingCharge.serialNumber || 'N/A'), leftMargin + 40, yPos);
    pdf.text('Status:', rightMargin - 30, yPos, { align: 'right' });
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(viewingCharge.status || 'Active'), rightMargin, yPos, { align: 'right' });
    yPos += 8;

    // Property Information
    checkNewPage(30);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Property Information', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Plot No:', leftMargin, yPos);
    pdf.text(String(viewingCharge.plotNo || 'N/A'), leftMargin + 30, yPos);
    pdf.text('RDA No:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(String(viewingCharge.rdaNo || 'N/A'), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.text('Street:', leftMargin, yPos);
    pdf.text(String(viewingCharge.street || 'N/A'), leftMargin + 30, yPos);
    pdf.text('Sector:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(String(viewingCharge.sector || 'N/A'), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.text('Category:', leftMargin, yPos);
    pdf.text(String(viewingCharge.category || 'N/A'), leftMargin + 30, yPos);
    pdf.text('Project:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(String(viewingCharge.project || 'N/A'), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.text('Address:', leftMargin, yPos);
    const addressLines = pdf.splitTextToSize(String(viewingCharge.address || 'N/A'), pageWidth - 2 * margin - 30);
    pdf.text(String(addressLines[0]), leftMargin + 30, yPos);
    if (addressLines.length > 1) {
      yPos += 5;
      pdf.text(String(addressLines[1]), leftMargin + 30, yPos);
    }
    yPos += 8;

    // Owner Information
    checkNewPage(20);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Owner Information', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Owner:', leftMargin, yPos);
    pdf.text(String(viewingCharge.owner || 'N/A'), leftMargin + 25, yPos);
    yPos += 5;
    
    pdf.text('Contact Number:', leftMargin, yPos);
    pdf.text(String(viewingCharge.contactNo || 'N/A'), leftMargin + 40, yPos);
    yPos += 5;
    
    if (viewingCharge.familyStatus) {
      pdf.text('Family Status:', leftMargin, yPos);
      pdf.text(String(viewingCharge.familyStatus), leftMargin + 35, yPos);
      yPos += 5;
    }
    yPos += 5;

    // Financial Details
    checkNewPage(25);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Financial Details', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Amount:', leftMargin, yPos);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(formatCurrency(viewingCharge.amount || 0)), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.setFont('helvetica', 'normal');
    pdf.text('Arrears:', leftMargin, yPos);
    pdf.text(String(formatCurrency(viewingCharge.arrears || 0)), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    if (viewingCharge.amountInWords) {
      pdf.text('Amount in Words:', leftMargin, yPos);
      const words = pdf.splitTextToSize(String(viewingCharge.amountInWords), pageWidth - 2 * margin - 40);
      pdf.text(String(words[0]), leftMargin + 40, yPos);
      yPos += 5;
      if (words.length > 1) {
        pdf.text(String(words[1]), leftMargin + 40, yPos);
        yPos += 5;
      }
    }
    yPos += 5;

    // Important Dates
    if (viewingCharge.fileSubmission || viewingCharge.demarcationDate || viewingCharge.constructionDate) {
      checkNewPage(20);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Important Dates', leftMargin, yPos);
      yPos += 6;
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      
      if (viewingCharge.fileSubmission) {
        pdf.text('File Submission:', leftMargin, yPos);
        pdf.text(dayjs(viewingCharge.fileSubmission).format('DD-MMM-YYYY'), leftMargin + 40, yPos);
        yPos += 5;
      }
      
      if (viewingCharge.demarcationDate) {
        pdf.text('Demarcation Date:', leftMargin, yPos);
        pdf.text(dayjs(viewingCharge.demarcationDate).format('DD-MMM-YYYY'), leftMargin + 40, yPos);
        yPos += 5;
      }
      
      if (viewingCharge.constructionDate) {
        pdf.text('Construction Date:', leftMargin, yPos);
        pdf.text(dayjs(viewingCharge.constructionDate).format('DD-MMM-YYYY'), leftMargin + 40, yPos);
        yPos += 5;
      }
    }

    // Footer
    yPos = pageHeight - 15;
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Generated from SGC ERP System - Taj Utilities Water Charges', pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;
    pdf.text(`Charge ID: ${viewingCharge._id || 'N/A'} | Generated: ${new Date().toLocaleString()}`, pageWidth / 2, yPos, { align: 'center' });

    pdf.save(`Water-charge-${viewingCharge.invoiceNumber || 'INV'}.pdf`);
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    let updatedForm = { ...formData, [name]: value };
    
    // Auto-generate amount in words when amount changes
    if (name === 'amount') {
      const amountValue = Number(value) || 0;
      updatedForm.amountInWords = numberToWords(amountValue);
    }
    
    setFormData(updatedForm);
  };

  const handleSaveCharge = async () => {
    try {
      setError('');
      const payload = {
        ...formData,
        amount: Number(formData.amount) || 0,
        arrears: Number(formData.arrears) || 0,
        fileSubmission: formData.fileSubmission || undefined,
        demarcationDate: formData.demarcationDate || undefined,
        constructionDate: formData.constructionDate || undefined
      };

      if (editingCharge) {
        await updateWaterCharge(editingCharge._id, payload);
        setSuccess('Water charge updated successfully');
      } else {
        await createWaterCharge(payload);
        setSuccess('Water charge created successfully');
      }
      handleCloseDialog();
      loadProperties();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save Water charge');
    }
  };


  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Taj Utilities — Water Bills
          </Typography>
          <Typography color="text.secondary">
            Fixed monthly water utility charges for properties with water billing enabled.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            placeholder="Search charges"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Tooltip title="Refresh">
            <IconButton onClick={loadProperties} disabled={currentOverviewLoading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {/* Statistics Cards */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <StatCard title="Total Properties" value={totalCounts.totalProperties || pagination.total || 0} />
        <StatCard title="Total Water Amount" value={formatCurrency(totalCounts.totalAmount)} />
        <StatCard title="Total Arrears" value={formatCurrency(totalCounts.totalArrears)} />
      </Stack>

      {/* Filters */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  label="Status"
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <MenuItem value="">All Status</MenuItem>
                  <MenuItem value="Active">Active</MenuItem>
                  <MenuItem value="Pending">Pending</MenuItem>
                  <MenuItem value="Completed">Completed</MenuItem>
                  <MenuItem value="Cancelled">Cancelled</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Sector</InputLabel>
                <Select
                  value={sectorFilter}
                  label="Sector"
                  onChange={(e) => setSectorFilter(e.target.value)}
                >
                  <MenuItem value="">All Sectors</MenuItem>
                  {[...new Set(properties.map(p => p.sector).filter(Boolean))].sort().map((sector) => (
                    <MenuItem key={sector} value={sector}>{sector}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Category</InputLabel>
                <Select
                  value={categoryFilter}
                  label="Category"
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <MenuItem value="">All Categories</MenuItem>
                  <MenuItem value="Personal">Personal</MenuItem>
                  <MenuItem value="Private">Private</MenuItem>
                  <MenuItem value="Personal Rent">Personal Rent</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
          <Divider sx={{ my: 2 }} />
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Bulk Create Invoices
              </Typography>
            </Grid>
            <Grid item xs={12} sm={12} md={6}>
              <Button
                variant="contained"
                color="success"
                startIcon={<AddIcon />}
                onClick={handleOpenBulkCreateDialog}
                disabled={bulkCreating}
                sx={{ minWidth: 200 }}
              >
                {bulkCreating ? 'Creating Invoices...' : `Create Invoices for ${filteredProperties.length > 0 ? filteredProperties.length : properties.length} Properties`}
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={50}></TableCell>
                  <TableCell>Property ID</TableCell>
                  <TableCell>Property</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Water Amount</TableCell>
                  <TableCell align="right">Arrears</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {currentOverviewLoading ? (
                  // Skeleton loading rows
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell><Skeleton variant="circular" width={32} height={32} /></TableCell>
                      <TableCell><Skeleton variant="text" width={40} /></TableCell>
                      <TableCell>
                        <Skeleton variant="text" width="60%" />
                        <Skeleton variant="text" width="80%" height={20} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width="70%" />
                        <Skeleton variant="text" width="90%" height={20} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width="60%" />
                        <Skeleton variant="text" width={100} height={20} />
                      </TableCell>
                      <TableCell><Skeleton variant="rectangular" width={80} height={24} /></TableCell>
                      <TableCell align="right"><Skeleton variant="text" width={80} /></TableCell>
                      <TableCell align="right"><Skeleton variant="text" width={80} /></TableCell>
                      <TableCell align="right">
                        <Skeleton variant="circular" width={32} height={32} />
                        <Skeleton variant="circular" width={32} height={32} sx={{ ml: 1 }} />
                    </TableCell>
                  </TableRow>
                  ))
                ) : filteredProperties.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 3 }}>
                      <Typography color="text.secondary">No properties found</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProperties.map((property) => {
                    return (
                    <React.Fragment key={property._id}>
                      <TableRow hover>
                        <TableCell>
                          <IconButton
                            size="small"
                            onClick={() => toggleRowExpansion(property._id)}
                          >
                            {expandedRows.has(property._id) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                          </IconButton>
                        </TableCell>
                        <TableCell>{property.srNo || '—'}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box>
                              <Typography variant="subtitle2" fontWeight={600}>
                                {property.propertyName || property.propertyType || '—'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {property.plotNumber || '—'} / {property.rdaNumber || '—'}
                              </Typography>
                            </Box>
                            {propertiesWithInvoicesCreated.has(String(property._id)) && (
                              <Tooltip title="Invoice created successfully">
                                <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                              </Tooltip>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{property.address || '—'}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {property.street || '—'} • Sector {property.sector || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{property.ownerName || '—'}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {property.contactNumber || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={property.status || 'Pending'}
                            size="small"
                            color={
                              property.status === 'Active' || property.status === 'active' ? 'success' :
                              property.status === 'Pending' || property.status === 'pending' ? 'warning' :
                              property.status === 'Completed' || property.status === 'completed' ? 'info' : 'default'
                            }
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight={600}>
                            {formatCurrency(property.waterAmount || 0)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight={600} color={property.waterArrears > 0 ? 'error.main' : 'text.primary'}>
                            {formatCurrency(property.waterArrears || 0)}
                            </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Tooltip title="View Details">
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => navigate(`/finance/taj-utilities-charges/taj-properties/${property._id}`)}
                              >
                                <ViewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Create Invoice">
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => handleCreateInvoice(property)}
                              >
                                <ReceiptIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                      <TableCell colSpan={10} sx={{ py: 0, border: 0 }}>
                          <Collapse in={expandedRows.has(property._id)} timeout="auto" unmountOnExit>
                            <Box sx={{ py: 2, px: 3 }}>
                              <Typography variant="subtitle2" gutterBottom>
                                Invoice History
                              </Typography>
                              {loadingInvoices[property._id] ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                  <CircularProgress size={20} />
                                </Box>
                              ) : propertyInvoices[property._id] && propertyInvoices[property._id].length > 0 ? (
                                <Table size="small">
                                  <TableHead>
                                    <TableRow>
                                      <TableCell></TableCell>
                                      <TableCell>Invoice #</TableCell>
                                      <TableCell>Date</TableCell>
                                      <TableCell>Period</TableCell>
                                      <TableCell>Due Date</TableCell>
                                      <TableCell align="right">Amount</TableCell>
                                      <TableCell align="right">Paid</TableCell>
                                      <TableCell align="right">Balance</TableCell>
                                      <TableCell>Status</TableCell>
                                      <TableCell align="right">Actions</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {propertyInvoices[property._id]
                                      .filter(inv => inv.chargeTypes?.includes('WATER'))
                                      .map((invoice) => (
                                      <React.Fragment key={invoice._id}>
                                      <TableRow>
                                        <TableCell>
                                          <IconButton
                                            size="small"
                                            onClick={() => toggleInvoiceExpansion(invoice._id)}
                                            sx={{ p: 0.5 }}
                                          >
                                            {expandedInvoices.has(invoice._id) ? (
                                              <ExpandLessIcon fontSize="small" />
                                            ) : (
                                              <ExpandMoreIcon fontSize="small" />
                                            )}
                                          </IconButton>
                                        </TableCell>
                                        <TableCell>{invoice.invoiceNumber || 'N/A'}</TableCell>
                                        <TableCell>
                                          {invoice.invoiceDate ? dayjs(invoice.invoiceDate).format('MMM D, YYYY') : 'N/A'}
                                        </TableCell>
                                        <TableCell>
                                          {invoice.periodFrom && invoice.periodTo ? (
                                            `${dayjs(invoice.periodFrom).format('MMM D')} - ${dayjs(invoice.periodTo).format('MMM D, YYYY')}`
                                          ) : (
                                            'N/A'
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {invoice.dueDate ? dayjs(invoice.dueDate).format('MMM D, YYYY') : 'N/A'}
                                        </TableCell>
                                        <TableCell align="right">{formatCurrency(getAdjustedGrandTotal(invoice))}</TableCell>
                                        <TableCell align="right">{formatCurrency(invoice.totalPaid || 0)}</TableCell>
                                        <TableCell align="right">{formatCurrency(getAdjustedGrandTotal(invoice) - (invoice.totalPaid || 0))}</TableCell>
                        <TableCell>
                          {(() => {
                                            const { color, label } = getPaymentStatusConfig(invoice.paymentStatus || 'unpaid');
                            return (
                              <Chip
                                label={label}
                                color={color}
                                size="small"
                              />
                            );
                          })()}
                        </TableCell>
                                        <TableCell align="right">
                                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                                            <Tooltip title="View Invoice">
                                              <IconButton
                                                size="small"
                                                color="primary"
                                                onClick={async () => {
                                                  await generateInvoicePDF(property, invoice, { openInNewTab: true });
                                                }}
                                              >
                                                <ViewIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Edit Invoice">
                                              <IconButton
                                                size="small"
                                                color="primary"
                                                onClick={() => handleEditInvoice(property, invoice)}
                                              >
                                                <EditIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Download Invoice">
                                              <IconButton
                                                size="small"
                                                color="primary"
                                                onClick={async () => await generateInvoicePDF(property, invoice)}
                                              >
                                                <DownloadIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Delete Invoice">
                                              <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => handleDeleteInvoice(property, invoice)}
                                              >
                                                <DeleteIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                          </Stack>
                                        </TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell colSpan={10} sx={{ py: 0, border: 0 }}>
                                          <Collapse in={expandedInvoices.has(invoice._id)} timeout="auto" unmountOnExit>
                                            <Box sx={{ py: 2, px: 3, bgcolor: 'grey.50' }}>
                                              <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
                                                Payment History
                                              </Typography>
                                              {invoice.payments && invoice.payments.length > 0 ? (
                                                <Table size="small">
                                                  <TableHead>
                                                    <TableRow>
                                                      <TableCell>Date</TableCell>
                                                      <TableCell align="right">Amount</TableCell>
                                                      <TableCell>Method</TableCell>
                                                      <TableCell>Bank</TableCell>
                                                      <TableCell>Reference</TableCell>
                                                      <TableCell>Notes</TableCell>
                                                      <TableCell>Recorded By</TableCell>
                                                      <TableCell align="center">Actions</TableCell>
                                                    </TableRow>
                                                  </TableHead>
                                                  <TableBody>
                                                    {invoice.payments.map((payment, idx) => (
                                                      <TableRow key={idx}>
                                                        <TableCell>
                                                          {dayjs(payment.paymentDate).format('MMM D, YYYY')}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                          {formatCurrency(payment.amount || 0)}
                                                        </TableCell>
                                                        <TableCell>{payment.paymentMethod || 'N/A'}</TableCell>
                                                        <TableCell>{payment.bankName || 'N/A'}</TableCell>
                                                        <TableCell>{payment.reference || 'N/A'}</TableCell>
                                                        <TableCell>{payment.notes || 'N/A'}</TableCell>
                                                        <TableCell>
                                                          {payment.recordedBy?.firstName && payment.recordedBy?.lastName
                                                            ? `${payment.recordedBy.firstName} ${payment.recordedBy.lastName}`
                                                            : 'N/A'}
                                                        </TableCell>
                                                        <TableCell align="center">
                                                          <Stack direction="row" spacing={1} justifyContent="center">
                                                            <Tooltip title="Download Payment Receipt">
                                                              <IconButton
                                                                size="small"
                                                                color="primary"
                                                                onClick={() => generateWaterPaymentReceiptPDF(invoice, payment, property)}
                                                              >
                                                                <DownloadIcon fontSize="small" />
                                                              </IconButton>
                                                            </Tooltip>
                                                            <Tooltip title="Delete Payment">
                                                              <IconButton
                                                                size="small"
                                                                color="error"
                                                                onClick={() => handleDeleteInvoicePayment(invoice._id, payment._id, property._id)}
                                                              >
                                                                <DeleteIcon fontSize="small" />
                                                              </IconButton>
                                                            </Tooltip>
                                                          </Stack>
                                                        </TableCell>
                                                      </TableRow>
                                                    ))}
                                                  </TableBody>
                                                </Table>
                                              ) : (
                                                <Typography variant="body2" color="text.secondary">
                                                  No payments recorded yet.
                                                </Typography>
                                              )}
                                            </Box>
                                          </Collapse>
                                        </TableCell>
                                      </TableRow>
                                      </React.Fragment>
                                    ))}
                                  </TableBody>
                                </Table>
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  No invoices found. Create an invoice using the "Create Invoice" button.
                                </Typography>
                              )}
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePaginationWrapper
            page={pagination.page}
            rowsPerPage={pagination.rowsPerPage}
            total={pagination.total}
            onPageChange={pagination.handleChangePage}
            onRowsPerPageChange={pagination.handleChangeRowsPerPage}
            onResetExpanded={() => setExpandedRows(new Set())}
          />
        </CardContent>
      </Card>

      <Dialog 
        open={invoiceDialogOpen} 
        onClose={(event, reason) => {
          // Prevent closing on backdrop click or ESC if invoice is being created/updated
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
            if (invoiceLoading) {
              return; // Don't close if loading
            }
          }
          handleCloseInvoiceDialog();
        }} 
        maxWidth="sm" 
        fullWidth
        disableEscapeKeyDown={invoiceLoading}
      >
        <DialogTitle>{invoiceData?._id ? 'Edit Invoice' : 'Create Invoice'}</DialogTitle>
        <DialogContent dividers>{renderInvoicePreview()}</DialogContent>
        <DialogActions>
          <Button onClick={handleCloseInvoiceDialog}>Close</Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownloadInvoice}
            disabled={invoiceLoading || !invoiceData}
          >
            Download
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveInvoice}
            disabled={invoiceLoading || !invoiceData}
          >
            {invoiceLoading ? (invoiceData?._id ? 'Updating...' : 'Creating...') : (invoiceData?._id ? 'Update Invoice' : 'Save Invoice')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Create Invoices Dialog */}
      <Dialog open={bulkCreateDialogOpen} onClose={() => setBulkCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Bulk Create Invoices - Common Fields</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              These fields will be applied to all invoices. Other fields (charges, amounts) will be calculated per property.
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Invoice Date"
                  type="date"
                  value={bulkCreateInvoiceData.invoiceDate}
                  onChange={(e) => setBulkCreateInvoiceData(prev => ({ ...prev, invoiceDate: e.target.value }))}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Period From"
                  type="date"
                  value={bulkCreateInvoiceData.periodFrom}
                  onChange={(e) => {
                    const newPeriodFrom = e.target.value;
                    setBulkCreateInvoiceData(prev => ({ ...prev, periodFrom: newPeriodFrom }));
                    // Auto-update Due Date if Period To exists
                    if (bulkCreateInvoiceData.periodTo) {
                      const dueDate = dayjs(bulkCreateInvoiceData.periodTo).add(15, 'day').format('YYYY-MM-DD');
                      setBulkCreateInvoiceData(prev => ({ ...prev, dueDate }));
                    }
                  }}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Period To"
                  type="date"
                  value={bulkCreateInvoiceData.periodTo}
                  onChange={(e) => {
                    const newPeriodTo = e.target.value;
                    setBulkCreateInvoiceData(prev => ({ ...prev, periodTo: newPeriodTo }));
                    // Auto-set Due Date to 15 days after Period To
                    const dueDate = dayjs(newPeriodTo).add(15, 'day').format('YYYY-MM-DD');
                    setBulkCreateInvoiceData(prev => ({ ...prev, dueDate }));
                  }}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Due Date"
                  type="date"
                  value={bulkCreateInvoiceData.dueDate}
                  onChange={(e) => setBulkCreateInvoiceData(prev => ({ ...prev, dueDate: e.target.value }))}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </Grid>
            <Alert severity="info">
              This will create invoices for {filteredProperties.length > 0 ? filteredProperties.length : properties.length} properties. Invoices that already exist for this period will be skipped.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleBulkCreateInvoices}
            disabled={bulkCreating || !bulkCreateInvoiceData.periodFrom || !bulkCreateInvoiceData.periodTo}
          >
            {bulkCreating ? 'Creating...' : 'Create All Invoices'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="md">
        <DialogTitle>
          {editingCharge ? 'Update Water charge' : 'New Water charge'}
          <IconButton
            onClick={handleCloseDialog}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Invoice Number"
                name="invoiceNumber"
                value={formData.invoiceNumber}
                onChange={handleInputChange}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Plot No"
                name="plotNo"
                value={formData.plotNo}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="RDA No"
                name="rdaNo"
                value={formData.rdaNo}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Street"
                name="street"
                value={formData.street}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Sector"
                name="sector"
                value={formData.sector}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Category"
                name="category"
                value={formData.category}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Address"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                fullWidth
                required
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Project"
                name="project"
                value={formData.project}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Owner"
                name="owner"
                value={formData.owner}
                onChange={handleInputChange}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Contact No"
                name="contactNo"
                value={formData.contactNo}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  name="status"
                  value={formData.status}
                  onChange={handleInputChange}
                  label="Status"
                >
                  {statusOptions.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="File Submission"
                type="date"
                name="fileSubmission"
                value={formData.fileSubmission}
                onChange={handleInputChange}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Demarcation Date"
                type="date"
                name="demarcationDate"
                value={formData.demarcationDate}
                onChange={handleInputChange}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Construction Date"
                type="date"
                name="constructionDate"
                value={formData.constructionDate}
                onChange={handleInputChange}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Family Status"
                name="familyStatus"
                value={formData.familyStatus}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Arrears (PKR)"
                type="number"
                name="arrears"
                value={formData.arrears}
                onChange={handleInputChange}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Amount (PKR)"
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleInputChange}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Amount in Words"
                name="amountInWords"
                value={formData.amountInWords}
                fullWidth
                multiline
                rows={2}
                InputProps={{
                  readOnly: true
                }}
                helperText="Auto-generated from amount"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveCharge}>
            {editingCharge ? 'Update' : 'Create'} Charge
          </Button>
        </DialogActions>
      </Dialog>


      {/* View Water charge Details Dialog */}
      <Dialog open={viewDialogOpen} onClose={handleCloseViewDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">Water charge Details</Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<PrintIcon />}
                onClick={handlePrintBill}
                disabled={!viewingCharge}
              >
                Print
              </Button>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleDownloadPDF}
                disabled={!viewingCharge}
              >
                Download PDF
              </Button>
              <IconButton onClick={handleCloseViewDialog} size="small">
                <CloseIcon />
              </IconButton>
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {viewingCharge ? (
            <Grid container spacing={3}>
              {/* Invoice Information */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                  Invoice Information
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Invoice Number</Typography>
                <Typography variant="body1" fontWeight={600}>{viewingCharge.invoiceNumber || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Serial Number</Typography>
                <Typography variant="body1">{viewingCharge.serialNumber || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Status</Typography>
                <Chip 
                  label={viewingCharge.status || 'Active'} 
                  color={viewingCharge.status === 'Active' ? 'success' : viewingCharge.status === 'Pending' ? 'warning' : 'default'}
                  size="small"
                />
              </Grid>

              {/* Property Information */}
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }} />
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                  Property Information
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Plot No</Typography>
                <Typography variant="body1">{viewingCharge.plotNo || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">RDA No</Typography>
                <Typography variant="body1">{viewingCharge.rdaNo || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Street</Typography>
                <Typography variant="body1">{viewingCharge.street || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Sector</Typography>
                <Typography variant="body1">{viewingCharge.sector || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Category</Typography>
                <Typography variant="body1">{viewingCharge.category || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Project</Typography>
                <Typography variant="body1">{viewingCharge.project || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary">Address</Typography>
                <Typography variant="body1">{viewingCharge.address || 'N/A'}</Typography>
              </Grid>

              {/* Owner Information */}
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }} />
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                  Owner Information
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Owner</Typography>
                <Typography variant="body1" fontWeight={600}>{viewingCharge.owner || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Contact Number</Typography>
                <Typography variant="body1">{viewingCharge.contactNo || 'N/A'}</Typography>
              </Grid>
              {viewingCharge.familyStatus && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">Family Status</Typography>
                  <Typography variant="body1">{viewingCharge.familyStatus}</Typography>
                </Grid>
              )}

              {/* Financial Details */}
              <Grid item xs={12}>
                <Divider sx={{ my: 2 }} />
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                  Financial Details
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Amount</Typography>
                <Typography variant="body1" fontWeight={600} fontSize="1.2rem" color="primary.main">
                  {formatCurrency(viewingCharge.amount || 0)}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">Arrears</Typography>
                <Typography variant="body1" color={viewingCharge.arrears > 0 ? 'error.main' : 'text.secondary'}>
                  {formatCurrency(viewingCharge.arrears || 0)}
                </Typography>
              </Grid>
              {viewingCharge.amountInWords && (
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">Amount in Words</Typography>
                  <Typography variant="body1" sx={{ fontStyle: 'italic' }}>
                    {viewingCharge.amountInWords}
                  </Typography>
                </Grid>
              )}

              {/* Important Dates */}
              {(viewingCharge.fileSubmission || viewingCharge.demarcationDate || viewingCharge.constructionDate) && (
                <>
                  <Grid item xs={12}>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                      Important Dates
                    </Typography>
                  </Grid>
                  {viewingCharge.fileSubmission && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">File Submission</Typography>
                      <Typography variant="body1">
                        {dayjs(viewingCharge.fileSubmission).format('DD-MMM-YYYY')}
                      </Typography>
                    </Grid>
                  )}
                  {viewingCharge.demarcationDate && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">Demarcation Date</Typography>
                      <Typography variant="body1">
                        {dayjs(viewingCharge.demarcationDate).format('DD-MMM-YYYY')}
                      </Typography>
                    </Grid>
                  )}
                  {viewingCharge.constructionDate && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">Construction Date</Typography>
                      <Typography variant="body1">
                        {dayjs(viewingCharge.constructionDate).format('DD-MMM-YYYY')}
                      </Typography>
                    </Grid>
                  )}
                </>
              )}
            </Grid>
          ) : (
            <Alert severity="info">No charge data available</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseViewDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={paymentDialog} onClose={handleClosePaymentDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          Record Payment
          <IconButton
            onClick={handleClosePaymentDialog}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">
                Property: {selectedProperty?.propertyName || selectedProperty?.plotNumber} ({selectedProperty?.srNo || 'N/A'})
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Amount (PKR)"
                type="number"
                fullWidth
                value={paymentForm.amount || ''}
                onChange={(e) => handleCamAmountChange(e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Arrears (PKR)"
                type="number"
                fullWidth
                value={paymentForm.arrears}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, arrears: Number(e.target.value) }))}
                helperText="Outstanding amount from previous periods"
              />
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ 
                p: 2, 
                borderRadius: 1, 
                backgroundColor: '#f5f5f5',
                borderLeft: '3px solid #1976d2'
              }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Total Payment Amount
                </Typography>
                <Typography variant="h6" fontWeight={600} color="primary">
                  {formatCurrency((paymentForm.amount || 0) + (paymentForm.arrears || 0))}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Payment Date"
                type="date"
                fullWidth
                value={paymentForm.paymentDate}
                onChange={(e) => handlePaymentDateChange(e.target.value)}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Month</InputLabel>
                <Select
                  value={paymentForm.month}
                  label="Month"
                  onChange={(e) => handleMonthYearChange(e.target.value, paymentForm.year)}
                >
                  {months.map((month) => (
                    <MenuItem key={month.value} value={month.value}>
                      {month.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Year</InputLabel>
                <Select
                  value={paymentForm.year}
                  label="Year"
                  onChange={(e) => handleMonthYearChange(paymentForm.month, e.target.value)}
                >
                  {(() => {
                    const currentYear = dayjs().year();
                    const years = [];
                    // Generate years from 2020 to 10 years in the future
                    for (let year = 2020; year <= currentYear + 10; year++) {
                      years.push(year);
                    }
                    return years.map((year) => (
                      <MenuItem key={year} value={year.toString()}>
                        {year}
                      </MenuItem>
                    ));
                  })()}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Invoice Number"
                fullWidth
                value={paymentForm.invoiceNumber}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, invoiceNumber: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={paymentForm.paymentMethod}
                  onChange={(e) => handleCamPaymentMethodChange(e.target.value)}
                  label="Payment Method"
                >
                  <MenuItem value="Cash">Cash</MenuItem>
                  <MenuItem value="Bank Transfer">Bank Transfer</MenuItem>
                  <MenuItem value="Cheque">Cheque</MenuItem>
                  <MenuItem value="Online">Online</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {paymentForm.paymentMethod !== 'Cash' && (
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Receiving Bank</InputLabel>
                  <Select
                    value={paymentForm.bankName}
                    label="Receiving Bank"
                    onChange={(e) => setPaymentForm((prev) => ({ ...prev, bankName: e.target.value }))}
                  >
                    {pakistanBanks.map((bank) => (
                      <MenuItem key={bank} value={bank}>
                        {bank}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12}>
              <Button
                variant="outlined"
                component="label"
                startIcon={<AttachFileIcon />}
                sx={{ mr: 2 }}
              >
                {paymentAttachment ? 'Change Attachment' : 'Attach Receipt'}
                <input type="file" hidden accept="image/*,.pdf" onChange={handleCamAttachmentChange} />
              </Button>
              {paymentAttachment && (
                <>
                  <Typography variant="caption" sx={{ mr: 2 }}>
                    {paymentAttachment.name}
                  </Typography>
                  <Button size="small" onClick={() => setPaymentAttachment(null)}>
                    Remove
                  </Button>
                </>
              )}
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Reference/Transaction ID"
                fullWidth
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, reference: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notes"
                fullWidth
                multiline
                rows={3}
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, notes: e.target.value }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClosePaymentDialog}>Cancel</Button>
          <Button variant="contained" onClick={handlePaymentSave}>
            Record Payment
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// StatCard component for displaying statistics
const StatCard = ({ title, value }) => (
  <Paper sx={{ flex: 1, p: 2, borderRadius: 3 }} elevation={0}>
    <Typography variant="body2" color="text.secondary">
      {title}
    </Typography>
    <Typography variant="h5" fontWeight={700}>
      {value}
    </Typography>
  </Paper>
);

export default WaterBills;

