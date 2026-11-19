import React, { useEffect, useState, useRef } from 'react';
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
  MenuItem,
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
  FormControl,
  InputLabel,
  Select,
  Collapse,
  CircularProgress,
  Tooltip,
  Menu,
  Skeleton,
  Snackbar
} from '@mui/material';
import {
  Close as CloseIcon,
  Home as HomeIcon,
  Print as PrintIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Download as DownloadIcon,
  Visibility as VisibilityIcon,
  AttachMoney as MoneyIcon,
  Description as DescriptionIcon,
  Person as PersonIcon,
  Receipt as ReceiptIcon,
  ReceiptLong as ReceiptLongIcon,
  FiberManualRecord as StatusIcon,
  AttachFile as AttachFileIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import jsPDF from 'jspdf';
import { useNavigate } from 'react-router-dom';
import {
  fetchProperties,
  fetchPropertyById,
  addPayment,
  fetchInvoice,
  updatePaymentStatus
} from '../../../services/tajRentalManagementService';
import {
  createInvoice,
  updateInvoice,
  fetchInvoicesForProperty,
  deleteInvoice,
  deletePaymentFromInvoice,
  getRentCalculation,
  bulkCreateRentInvoices
} from '../../../services/propertyInvoiceService';
import { generateRentInvoicePDF as generateRentInvoicePDFUtil, outputPDF } from '../../../utils/invoicePDFGenerators';
import pakistanBanks from '../../../constants/pakistanBanks';
import { printTovusElement } from '../../../utils/tovusPrintBrand';

const paymentMethods = ['Cash', 'Bank Transfer', 'Cheque', 'Online'];
const paymentStatuses = ['Draft', 'Unpaid', 'Pending Approval', 'Approved', 'Rejected', 'Cancelled'];

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

const defaultSummary = {
  totalProperties: 0,
  statusBreakdown: {
    available: 0,
    rented: 0,
    reserved: 0,
    underMaintenance: 0,
    pending: 0
  },
  rent: {
    expectedTotal: 0,
    securityDepositTotal: 0,
    expectedAverage: 0
  }
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

// Generate invoice number with type prefix (same logic as backend)
const generateInvoiceNumber = (propertySrNo, year, month, type = 'REN') => {
  const paddedMonth = String(month).padStart(2, '0');
  const paddedIndex = String(propertySrNo || 1).padStart(4, '0');
  
  // Determine prefix based on type
  let prefix = 'INV';
  if (type === 'CAM' || type === 'CMC') {
    prefix = 'INV-CMC';
  } else if (type === 'ELECTRICITY' || type === 'ELC') {
    prefix = 'INV-ELC';
  } else if (type === 'RENT' || type === 'REN') {
    prefix = 'INV-REN';
  } else if (type === 'MIXED' || type === 'MIX') {
    prefix = 'INV-MIX';
  }
  
  return `${prefix}-${year}-${paddedMonth}-${paddedIndex}`;
};

const RentalManagement = () => {
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [summary, setSummary] = useState(defaultSummary);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [paymentInvoiceDialog, setPaymentInvoiceDialog] = useState(false);
  const [paymentDetailsDialog, setPaymentDetailsDialog] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [expandedInvoices, setExpandedInvoices] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  
  // Filter state
  const [statusFilter, setStatusFilter] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [paymentInvoiceData] = useState(null);
  const [statusMenuAnchor, setStatusMenuAnchor] = useState(null);
  const [statusMenuContext, setStatusMenuContext] = useState(null);
  const unpaidPayments =
    selectedProperty?.payments?.filter((payment) => payment.status === 'Unpaid') || [];
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [invoiceProperty, setInvoiceProperty] = useState(null);
  const [invoiceData, setInvoiceData] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [, setInvoiceWasSaved] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [propertyInvoices, setPropertyInvoices] = useState({});
  const [loadingInvoices, setLoadingInvoices] = useState({});
  const [rentPaymentContext, setRentPaymentContext] = useState({ baseCharge: 0, baseArrears: 0 });
  const [paymentAttachment, setPaymentAttachment] = useState(null);
  
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

  const loadData = async () => {
    try {
      setLoading(true);
      const params = {};
      // Add search and filter parameters
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (sectorFilter) params.sector = sectorFilter;
      if (categoryFilter) params.categoryType = categoryFilter;
      const response = await fetchProperties(params);
      setProperties(response.data?.data?.properties || response.data?.data || []);
      // Summary can be at data.summary (properties endpoint) or data.data.summary (general-properties)
      const summaryData = response.data?.summary || response.data?.data?.summary;
      if (summaryData) {
        setSummary(summaryData);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initial load; filters applied when user refreshes or after mutations
  }, []);

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
        formData.append(key, value ?? '');
      });
      
      // Add periodFrom and periodTo from month/year
      formData.append('periodFrom', periodFrom);
      formData.append('periodTo', periodTo);
      
      if (paymentAttachment) {
        formData.append('attachment', paymentAttachment);
      }

      await addPayment(selectedProperty._id, formData);
      setSuccess('Payment recorded successfully');
      handleClosePaymentDialog();
      resetPaymentForm();
      loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record payment');
    }
  };

  const handleViewInvoice = async (property, payment) => {
    try {
      const res = await fetchInvoice(property._id, payment._id);
      const invoiceData = res.data?.data;
      if (invoiceData) {
        handleDownloadPDF(invoiceData, property, { openInNewTab: true });
      } else {
        setError('Failed to load invoice');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load invoice');
    }
  };

  const handleEditInvoice = async (property, invoice) => {
    setInvoiceProperty(property);
    setInvoiceData(invoice);
    setInvoiceError('');
    setInvoiceWasSaved(true); // Mark as saved since it's an existing invoice
    setInvoiceDialogOpen(true);
  };

  const handleCreateInvoice = async (property) => {
    setInvoiceProperty(property);
    setInvoiceData(null); // Reset invoice data for new invoice
    setInvoiceError('');
    setInvoiceWasSaved(false); // Reset saved flag
    setInvoiceDialogOpen(true);
    
    try {
      setInvoiceLoading(true);
      
      // Fetch full property details with rental agreement populated if needed
      let propertyWithAgreement = property;
      if (!property.rentalAgreement || typeof property.rentalAgreement === 'string') {
        try {
          const propertyResponse = await fetchPropertyById(property._id);
          propertyWithAgreement = propertyResponse.data?.data || property;
        } catch (err) {
          // If fetch fails, use the property we have
          console.error('Failed to fetch property details:', err);
        }
      }
      
      // Prepare invoice data locally without creating it in database
      // This is just for preview - actual creation happens in handleSaveInvoice
      const now = dayjs();
      const periodFrom = now.startOf('month').toDate();
      const periodTo = now.endOf('month').toDate();
      const invoiceNumber = generateInvoiceNumber(
        propertyWithAgreement.srNo,
        now.year(),
        now.month() + 1,
        'RENT'
      );
      
      // Fetch rent calculation from backend (includes carry-forward arrears)
      let monthlyRent = 0;
      let arrears = 0;
      let carryForwardArrears = 0;
      
      try {
        const rentCalculationResponse = await getRentCalculation(propertyWithAgreement._id);
        const rentData = rentCalculationResponse.data?.data;
        if (rentData) {
          monthlyRent = rentData.monthlyRent || 0;
          arrears = rentData.totalArrears || 0;
          carryForwardArrears = rentData.carryForwardArrears || 0;
        }
      } catch (err) {
        console.error('Failed to fetch rent calculation:', err);
        // Fallback to local calculation if API fails
        if (propertyWithAgreement.rentalAgreement?.monthlyRent) {
          monthlyRent = propertyWithAgreement.rentalAgreement.monthlyRent || 0;
        } else if (propertyWithAgreement.categoryType === 'Personal Rent' && propertyWithAgreement.rentalPayments?.length > 0) {
          const latestPayment = [...propertyWithAgreement.rentalPayments]
            .sort((a, b) => new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0))[0];
          if (latestPayment) {
            monthlyRent = latestPayment.amount || 0;
            arrears = latestPayment.arrears || 0;
          }
        }
      }
      
      const rentDescription = carryForwardArrears > 0 
        ? 'Rental Charges (with Carry Forward Arrears)' 
        : 'Rental Charges';
      
      const charges = [{
        type: 'RENT',
        description: rentDescription,
        amount: monthlyRent,
        arrears: arrears,
        total: monthlyRent + arrears
      }];
      
      const subtotal = monthlyRent;
      const totalArrears = arrears;
      const grandTotal = subtotal + totalArrears;
      
      setInvoiceData({
        invoiceNumber,
        dueDate: dayjs(periodTo).add(15, 'day').toDate(),
        periodFrom,
        periodTo,
        chargeTypes: ['RENT'],
        charges,
        subtotal,
        totalArrears,
        grandTotal,
        amountInWords: '' // Can be calculated if needed
      });
      
      if (monthlyRent === 0) {
        setInvoiceError('No rental payment found. You can manually enter the amount.');
      }
    } catch (err) {
      setInvoiceError(err.response?.data?.message || 'Failed to prepare invoice');
      // Initialize with defaults on error
      const now = dayjs();
      const periodFrom = now.startOf('month').toDate();
      const periodTo = now.endOf('month').toDate();
      const invoiceNumber = generateInvoiceNumber(
        property.srNo,
        now.year(),
        now.month() + 1,
        'RENT'
      );
      
      setInvoiceData({
        invoiceNumber,
        dueDate: dayjs(periodTo).add(15, 'day').toDate(),
        periodFrom,
        periodTo,
        chargeTypes: ['RENT'],
        charges: [{
          type: 'RENT',
          description: 'Rental Charges',
          amount: 0,
          arrears: 0,
          total: 0
        }],
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
      const [, chargeIndex, chargeField] = field.split('.');
      const updatedCharges = [...invoiceData.charges];
      const chargeValue = chargeField === 'amount' || chargeField === 'arrears' ? Number(value) || 0 : value;
      
      updatedCharges[chargeIndex] = {
        ...updatedCharges[chargeIndex],
        [chargeField]: chargeValue
      };
      
      // Recalculate total for this specific charge
      const charge = updatedCharges[chargeIndex];
      charge.total = (charge.amount || 0) + (charge.arrears || 0);
      
      // Recalculate totals - only include RENT charges
      const rentCharges = updatedCharges.filter(c => c.type === 'RENT');
      const subtotal = rentCharges.reduce((sum, charge) => sum + (charge.amount || 0), 0);
      const totalArrears = rentCharges.reduce((sum, charge) => sum + (charge.arrears || 0), 0);
      const grandTotal = subtotal + totalArrears;
      
      setInvoiceData({
        ...invoiceData,
        charges: updatedCharges,
        subtotal,
        totalArrears,
        grandTotal
      });
    } else {
      const updatedData = {
        ...invoiceData,
        [field]: field === 'periodFrom' || field === 'periodTo' || field === 'dueDate' || field === 'invoiceDate'
          ? (value ? new Date(value) : null)
          : field === 'grandTotal' || field === 'subtotal' || field === 'totalArrears'
          ? Number(value) || 0
          : value
      };
      
      // Regenerate invoice number if period changes (for new invoices only)
      if ((field === 'periodFrom' || field === 'periodTo') && !invoiceData._id && invoiceProperty) {
        const periodDate = field === 'periodFrom' ? new Date(value) : (updatedData.periodTo || new Date(value));
        const periodDayjs = dayjs(periodDate);
        const newInvoiceNumber = generateInvoiceNumber(
          invoiceProperty.srNo,
          periodDayjs.year(),
          periodDayjs.month() + 1,
          'RENT'
        );
        updatedData.invoiceNumber = newInvoiceNumber;
      }
      
      setInvoiceData(updatedData);
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
          charges: invoiceData.charges || [],
          subtotal: invoiceData.subtotal,
          totalArrears: invoiceData.totalArrears,
          grandTotal: invoiceData.grandTotal
        });

        const savedInvoice = response.data?.data || invoiceData;
        setInvoiceData(savedInvoice);
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
        includeCAM: false,
        includeElectricity: false,
        includeRent: true,
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

  const handleDeleteInvoice = async (property, invoice) => {
    if (!window.confirm(`Are you sure you want to delete invoice ${invoice.invoiceNumber || invoice._id}?`)) {
      return;
    }

    const propertyId = property?._id;
    const prevInvoices = propertyId ? propertyInvoices[propertyId] : null;

    // Optimistic update: remove invoice from UI instantly
    if (propertyId && prevInvoices) {
      setPropertyInvoices(prev => ({
        ...prev,
        [propertyId]: prev[propertyId].filter(inv => inv._id !== invoice._id)
      }));
    }

    try {
      setError('');
      await deleteInvoice(invoice._id);
      setSuccess('Invoice deleted successfully');
      setSnackbar({ open: true, message: 'Invoice deleted successfully', severity: 'success' });
    } catch (err) {
      // Revert optimistic update on error
      if (propertyId && prevInvoices) {
        setPropertyInvoices(prev => ({ ...prev, [propertyId]: prevInvoices }));
      }
      const errMsg = err.response?.data?.message || 'Failed to delete invoice';
      setError(errMsg);
      setSnackbar({ open: true, message: errMsg, severity: 'error' });
    }
  };

  const handleDeleteInvoicePayment = async (invoiceId, paymentId, propertyId) => {
    if (!window.confirm('Are you sure you want to delete this payment?')) {
      return;
    }

    const prevInvoices = propertyId ? propertyInvoices[propertyId] : null;

    // Optimistic update: remove payment from invoice instantly
    if (propertyId && prevInvoices) {
      setPropertyInvoices(prev => ({
        ...prev,
        [propertyId]: prev[propertyId].map(inv =>
          inv._id === invoiceId
            ? { ...inv, payments: (inv.payments || []).filter(p => p._id !== paymentId) }
            : inv
        )
      }));
    }

    try {
      setError('');
      await deletePaymentFromInvoice(invoiceId, paymentId);
      setSuccess('Payment deleted successfully');
      setSnackbar({ open: true, message: 'Payment deleted successfully', severity: 'success' });

      // Refresh invoices to get updated totals
      if (propertyId) {
        const invoiceResponse = await fetchInvoicesForProperty(propertyId);
        setPropertyInvoices(prev => ({ ...prev, [propertyId]: invoiceResponse.data?.data || [] }));
      }
    } catch (err) {
      // Revert optimistic update on error
      if (propertyId && prevInvoices) {
        setPropertyInvoices(prev => ({ ...prev, [propertyId]: prevInvoices }));
      }
      const errMsg = err.response?.data?.message || 'Failed to delete payment';
      setError(errMsg);
      setSnackbar({ open: true, message: errMsg, severity: 'error' });
    }
  };

  const handleCloseInvoiceDialog = () => {
    setInvoiceDialogOpen(false);
    setInvoiceProperty(null);
    setInvoiceData(null);
    setInvoiceLoading(false);
    setInvoiceError('');
    setInvoiceWasSaved(false); // Reset saved flag
  };

  const handleOpenBulkCreateDialog = () => {
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

      const propertiesToProcess = filteredProperties;

      if (propertiesToProcess.length === 0) {
        setError('No properties found to create invoices for');
        setBulkCreating(false);
        return;
      }

      setSuccess(`Creating invoices for ${propertiesToProcess.length} property(ies)...`);

      const propertyIds = propertiesToProcess.map((p) => p._id);
      const res = await bulkCreateRentInvoices({
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

      await loadData();

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

  const handlePrintInvoice = () => {
    // Tovus-branded print of the rent invoice preview (keeps the invoice's own letterhead)
    printTovusElement('#invoice-print', { title: 'Rent Invoice' });
  };

  const handleDownloadPDF = (invoiceDataParam = null, propertyParam = null, options = {}) => {
    const invoiceData = invoiceDataParam ?? paymentInvoiceData;
    const property = propertyParam ?? selectedProperty;
    if (!invoiceData || !property) return;

    const pdf = new jsPDF('portrait', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 15;
    const leftMargin = margin;
    const rightMargin = pageWidth - margin;

    const copies = ['Bank Copy', 'Office Copy', 'Client Copy'];
    const currentDate = new Date();
    const invoiceDate = dayjs(invoiceData.invoicingDate || invoiceData.periodFrom);
    const dueDate = dayjs(invoiceData.dueDate || invoiceData.periodTo);
    const periodFrom = dayjs(invoiceData.periodFrom);
    const periodTo = dayjs(invoiceData.periodTo);
    const billMonth = invoiceDate.format('MMMM YYYY');
    const currentAmount = selectedPayment?.amount || invoiceData.totalAmount || 0;
    const arrearsAmount = selectedPayment?.arrears || 0;
    const totalAmount = selectedPayment?.totalAmount || (currentAmount + arrearsAmount);
    const formattedCurrentAmount = currentAmount.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedArrears = arrearsAmount.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedTotalAmount = totalAmount.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    copies.forEach((copyLabel, copyIndex) => {
      if (copyIndex > 0) {
        pdf.addPage();
      }

      let yPos = margin;

      // Header Section - Logo Area (left side)
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('TAJ', leftMargin, yPos + 5);
      pdf.setFontSize(12);
      pdf.text('RESIDENCIA', leftMargin, yPos + 10);

      // Document Title (center)
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Rent Invoice', pageWidth / 2, yPos + 8, { align: 'center' });

      // Invoice Generation Date & Time (right side)
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      const dateTimeStr = dayjs(currentDate).format('dddd, MMMM D, YYYY, h:mm:ss A');
      pdf.text(dateTimeStr, rightMargin, yPos + 5, { align: 'right' });

      // Copy Label
      pdf.setFontSize(10);
      pdf.text(`(${copyLabel})`, rightMargin, yPos + 10, { align: 'right' });

      yPos += 18;

      // Client Details Section
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Client Name:', leftMargin, yPos);
      pdf.setFont('helvetica', 'normal');
      pdf.text(invoiceData.tenantName || property.tenantName || 'N/A', leftMargin + 30, yPos);
      
      yPos += 6;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Client Location/Address:', leftMargin, yPos);
      pdf.setFont('helvetica', 'normal');
      const addressLines = pdf.splitTextToSize(invoiceData.address || property.fullAddress || 'N/A', 80);
      pdf.text(addressLines[0], leftMargin + 45, yPos);
      if (addressLines.length > 1) {
        yPos += 5;
        pdf.text(addressLines[1], leftMargin + 45, yPos);
      }

      yPos += 6;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Unit:', leftMargin, yPos);
      pdf.setFont('helvetica', 'normal');
      const unitInfo = property.unit ? `(${property.unit})` : '';
      pdf.text(unitInfo, leftMargin + 15, yPos);

      yPos += 6;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Unit Address:', leftMargin, yPos);
      pdf.setFont('helvetica', 'normal');
      const unitAddress = [
        property.floor && `Floor: ${property.floor}`,
        property.unit && `Unit: ${property.unit}`,
        property.block && `Block: ${property.block}`,
        property.street && `Street: ${property.street}`,
        property.sector && `Sector: ${property.sector}`
      ].filter(Boolean).join(', ') || invoiceData.address || 'N/A';
      pdf.text(unitAddress, leftMargin + 30, yPos);

      yPos += 12;

      // Invoice Details Table
      const col1X = leftMargin;
      const col2X = leftMargin + 50;
      const col3X = leftMargin + 100;
      const col4X = leftMargin + 140;

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      
      // Table Header
      pdf.rect(col1X, yPos - 3, 180, 6);
      pdf.text('Invoice Number', col1X + 2, yPos);
      pdf.text('Bill Month', col2X + 2, yPos);
      pdf.text('Invoice Date', col3X + 2, yPos);
      pdf.text('Due Date', col4X + 2, yPos);
      
      yPos += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.rect(col1X, yPos - 3, 180, 6);
      pdf.text(invoiceData.invoiceNumber || 'N/A', col1X + 2, yPos);
      pdf.text(billMonth, col2X + 2, yPos);
      pdf.text(invoiceDate.format('DD-MMM-YYYY'), col3X + 2, yPos);
      pdf.text(dueDate.format('DD-MMM-YYYY'), col4X + 2, yPos);

      yPos += 6;
      pdf.rect(col1X, yPos - 3, 90, 6);
      pdf.text('Period From', col1X + 2, yPos);
      pdf.text(periodFrom.format('DD-MMM-YYYY'), col1X + 25, yPos);
      pdf.rect(col1X + 90, yPos - 3, 90, 6);
      pdf.text('Period To', col1X + 92, yPos);
      pdf.text(periodTo.format('DD-MMM-YYYY'), col1X + 115, yPos);

      yPos += 10;

      // Rent Details Table
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Rent From ' + periodFrom.format('DD-MMM-YYYY') + ' To ' + periodTo.format('DD-MMM-YYYY'), leftMargin, yPos);
      yPos += 6;

      // Detailed Charges Table
      const tableCols = [
        { x: col1X, width: 50, label: 'Description' },
        { x: col1X + 50, width: 20, label: 'Quantity' },
        { x: col1X + 70, width: 25, label: 'Rate' },
        { x: col1X + 95, width: 25, label: 'Charges' },
        { x: col1X + 120, width: 20, label: 'Sales Tax %' },
        { x: col1X + 140, width: 25, label: 'Sales Tax' }
      ];

      // Table Header
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      tableCols.forEach(col => {
        pdf.rect(col.x, yPos - 3, col.width, 5);
        pdf.text(col.label, col.x + 1, yPos);
      });
      yPos += 5;

      // Table Row
      pdf.setFont('helvetica', 'normal');
      pdf.rect(tableCols[0].x, yPos - 3, tableCols[0].width, 5);
      pdf.text('Rent', tableCols[0].x + 1, yPos);
      pdf.rect(tableCols[1].x, yPos - 3, tableCols[1].width, 5);
      pdf.text('1', tableCols[1].x + 1, yPos);
      pdf.rect(tableCols[2].x, yPos - 3, tableCols[2].width, 5);
      pdf.text(formattedCurrentAmount, tableCols[2].x + 1, yPos);
      pdf.rect(tableCols[3].x, yPos - 3, tableCols[3].width, 5);
      pdf.text(formattedCurrentAmount, tableCols[3].x + 1, yPos);
      pdf.rect(tableCols[4].x, yPos - 3, tableCols[4].width, 5);
      pdf.text('0%', tableCols[4].x + 1, yPos);
      pdf.rect(tableCols[5].x, yPos - 3, tableCols[5].width, 5);
      pdf.text('0', tableCols[5].x + 1, yPos);

      yPos += 8;

      // Summary Section
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Charges For The Month Inc Sales Tax:', leftMargin + 100, yPos);
      pdf.setFont('helvetica', 'bold');
      pdf.text(formattedCurrentAmount, rightMargin, yPos, { align: 'right' });
      yPos += 5;
      pdf.setFont('helvetica', 'normal');
      pdf.text('Payment:', leftMargin + 100, yPos);
      pdf.text('0.00', rightMargin, yPos, { align: 'right' });
      yPos += 5;
      pdf.text('Current Invoice Balance:', leftMargin + 100, yPos);
      pdf.setFont('helvetica', 'bold');
      pdf.text(formattedCurrentAmount, rightMargin, yPos, { align: 'right' });
      yPos += 5;
      pdf.setFont('helvetica', 'normal');
      pdf.text('Arrears:', leftMargin + 100, yPos);
      pdf.text(formattedArrears, rightMargin, yPos, { align: 'right' });
      yPos += 5;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Payable within Due Date Inc Sales Tax:', leftMargin + 50, yPos);
      pdf.text(formattedTotalAmount, rightMargin, yPos, { align: 'right' });
      yPos += 5;
      pdf.setFont('helvetica', 'normal');
      pdf.text('Late Payment Surcharge:', leftMargin + 100, yPos);
      pdf.text('0.00', rightMargin, yPos, { align: 'right' });
      yPos += 5;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Payable After Due Date:', leftMargin + 80, yPos);
      pdf.text(formattedTotalAmount, rightMargin, yPos, { align: 'right' });

      yPos += 10;

      // Payment Instructions
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Payment Instructions:', leftMargin, yPos);
      yPos += 6;
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      const paymentInstructions = [
        'Accepted Payment Methods: Banking channels only (cheque, online transfer, or deposit slip). Cash payments are not accepted.',
        'Deposit Instructions: Deposits can be made through cash, crossed cheque, or bank drafts on a specified deposit slip at any Allied Bank Limited branch in Pakistan.',
        'Bank Account Title: Taj Residencia, Allied Bank Limited',
        'Bank Branch: The Centaurus Mall Branch, Islamabad. (0917)',
        'Bank Account No: PK68ABPA0010035700420129'
      ];
      paymentInstructions.forEach(instruction => {
        const lines = pdf.splitTextToSize(instruction, pageWidth - 2 * margin);
        lines.forEach(line => {
          pdf.text(line, leftMargin, yPos);
          yPos += 4;
        });
        yPos += 2;
      });

      yPos += 3;

      // Important Notes
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Important Notes:', leftMargin, yPos);
      yPos += 6;
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      const notes = [
        'Payment must be made on or before the due date to avoid penalties or discontinuation of service.',
        'After payment, an email or WhatsApp copy of the deposit slip or online transfer proof should be sent to the Accounts Department for record verification.',
        'TAJ Official WhatsApp No.: 03457788442',
        'A late payment surcharge may apply if the amount is not received by the specified due date.',
        'Any returned or dishonored cheques will attract service charges.'
      ];
      notes.forEach(note => {
        const lines = pdf.splitTextToSize(note, pageWidth - 2 * margin);
        lines.forEach(line => {
          pdf.text(line, leftMargin, yPos);
          yPos += 4;
        });
        yPos += 2;
      });
    });

    outputPDF(pdf, `Rent-Invoice-${invoiceData.invoiceNumber || 'INV'}.pdf`, options);
  };

  const generateRentInvoicePDF = async (propertyParam = null, invoiceParam = null, options = {}) => {
    const invoice = invoiceParam || invoiceData;
    const property = invoice?.property || propertyParam || invoiceProperty;
    if (!property || !invoice) return;
    return await generateRentInvoicePDFUtil(invoice, property, options);
  };

  const generateRentalPaymentReceiptPDF = (invoice, payment, property) => {
    // Constants
    const CONSTANTS = {
      COPIES: ['Bank Copy', 'Office Copy', 'Client Copy'],
      MARGIN_X: 6,
      TOP_MARGIN: 10,
      FOOTER_NOTES: [
        '1. This receipt confirms payment received for rental charges as per the rental agreement.',
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
    const rentCharge = invoice.charges?.find(c => c.type === 'RENT');
    const monthlyRent = rentCharge?.amount || 0;
    const arrears = rentCharge?.arrears || 0;
    
    // Calculate month label
    const monthLabel = invoice.periodTo 
      ? dayjs(invoice.periodTo).format('MMMM-YY').toUpperCase()
      : dayjs().format('MMMM-YY').toUpperCase();

    // Calculate payment status
    const totalPaid = invoice.totalPaid || 0;
    const grandTotal = invoice.grandTotal || (monthlyRent + arrears);
    const balance = invoice.balance || (grandTotal - totalPaid);
    const isPaid = balance <= 0 && totalPaid > 0;
    const isPartiallyPaid = totalPaid > 0 && balance > 0;
    const paymentStatus = isPaid ? 'PAID' : isPartiallyPaid ? 'PARTIALLY PAID' : 'UNPAID';
    const paymentStatusColor = isPaid ? CONSTANTS.COLORS.GREEN : 
                              isPartiallyPaid ? CONSTANTS.COLORS.ORANGE : CONSTANTS.COLORS.RED;

    // Property data
    const tenantName = property.tenantName || property.ownerName || '—';
    const propertyName = property.propertyName || property.plotNumber || '—';
    const address = property.fullAddress || property.address || '—';
    const floor = property.floor || '—';

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
      pdf.text(`Taj Rental Payment Receipt For The Month Of ${monthLabel}`, startX + panelCenterX, cursorY, { align: 'center' });
      pdf.setTextColor(...CONSTANTS.COLORS.BLACK);
      cursorY += 5;

      setTextStyle('helvetica', 'bold', 9);
      pdf.text('Rental Payment Receipt', startX + panelCenterX, cursorY, { align: 'center' });
      cursorY += 6;

      // Property and Invoice fields
      const inlineFields = [
        ['Property Name', propertyName],
        ['Tenant Name', tenantName],
        ['Floor', floor],
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

      // Rental Charges Summary
      setTextStyle('helvetica', 'bold', 8);
      pdf.text('Rental Charges Summary', startX, cursorY);
      cursorY += 3;

      const chargesRows = [
        { label: 'Monthly Rent', value: formatAmount(monthlyRent), bold: false },
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
    const sanitizedName = (property.propertyName || property.plotNumber || property.srNo || 'rent-property')
      .toString().replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '_');
    const receiptDate = dayjs(payment.paymentDate).format('YYYY-MM-DD');
    pdf.save(`Rental_Payment_Receipt_${sanitizedName}_${receiptDate}.pdf`);
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
    await generateRentInvoicePDF();
  };

  const renderInvoicePreview = () => {
    if (invoiceLoading) {
      return (
        <Stack alignItems="center" spacing={1} py={3}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Creating invoice...
          </Typography>
        </Stack>
      );
    }

    if (invoiceError) {
      return <Alert severity="error">{invoiceError}</Alert>;
    }

    if (!invoiceProperty) {
      return <Typography color="text.secondary">Select a property to create invoice.</Typography>;
    }

    if (!invoiceData) {
      return (
        <Alert severity="info">
          Creating invoice...
        </Alert>
      );
    }

    // Calculate total amount from charges + arrears
    const rentCharges = invoiceData.charges?.filter(c => c.type === 'RENT') || [];
    const chargesTotal = rentCharges.reduce((sum, charge) => sum + (charge.amount || 0), 0);
    const arrearsTotal = rentCharges.reduce((sum, charge) => sum + (charge.arrears || 0), 0);
    const totalAmount = chargesTotal + arrearsTotal;

    return (
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle2" color="text.secondary">
            Property
          </Typography>
          <Typography variant="h6">{invoiceProperty.propertyName || invoiceProperty.propertyCode}</Typography>
          <Typography variant="body2" color="text.secondary">
            {invoiceProperty.fullAddress || invoiceProperty.address || 'No address recorded'}
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
              helperText={invoiceData.invoiceNumber ? '' : 'Auto-generated if left empty'}
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
              label="Due Date"
              type="date"
              value={invoiceData.dueDate ? dayjs(invoiceData.dueDate).format('YYYY-MM-DD') : ''}
              onChange={(e) => handleInvoiceFieldChange('dueDate', e.target.value)}
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
                handleInvoiceFieldChange('periodTo', newPeriodTo);
                // Auto-set Due Date to 15 days after Period To
                if (newPeriodTo) {
                  const dueDate = dayjs(newPeriodTo).add(15, 'day').format('YYYY-MM-DD');
                  handleInvoiceFieldChange('dueDate', dueDate);
                }
              }}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          {invoiceData.charges?.filter(charge => charge.type === 'RENT').map((charge, filteredIdx) => {
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
        </Grid>

        <Alert severity="info">
          Download to view the tri-fold invoice (Bank, Office & Client copies) exactly as it will print.
        </Alert>
      </Stack>
    );
  };

  const resetPaymentForm = () => {
    const currentDate = dayjs();
    setPaymentForm({
      amount: 0,
      arrears: 0,
      paymentDate: currentDate.format('YYYY-MM-DD'),
      month: currentDate.format('MM'),
      year: currentDate.format('YYYY'),
      invoiceNumber: '',
      paymentMethod: 'Bank Transfer',
      bankName: '',
      reference: '',
      notes: ''
    });
    setRentPaymentContext({ baseCharge: 0, baseArrears: 0 });
    setPaymentAttachment(null);
  };

  const handleMonthYearChange = (month, year) => {
    const baseCharge = Number(rentPaymentContext.baseCharge || 0);
    
    // Auto-populate amount with rent amount when month changes
    setPaymentForm((prev) => ({
      ...prev,
      month: month,
      year: year,
      amount: baseCharge > 0 ? baseCharge : (prev.amount || ''),
      arrears: 0 // Reset arrears when month changes
    }));
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
  
  // Reload data when filters change
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, sectorFilter, categoryFilter]);

  const toggleInvoiceExpansion = (invoiceId) => {
    const newExpanded = new Set(expandedInvoices);
    if (newExpanded.has(invoiceId)) {
      newExpanded.delete(invoiceId);
    } else {
      newExpanded.add(invoiceId);
    }
    setExpandedInvoices(newExpanded);
  };

  const handleRentAmountChange = (value) => {
    const numericValue = Number(value) || 0;
    const baseCharge = Number(rentPaymentContext.baseCharge || 0);
    const baseArrears = Number(rentPaymentContext.baseArrears || 0);

    if (!baseCharge && !baseArrears) {
      setPaymentForm((prev) => ({ ...prev, amount: numericValue }));
      return;
    }

    const calculatedArrears = baseArrears + (baseCharge - numericValue);
    setPaymentForm((prev) => ({
      ...prev,
      amount: numericValue,
      arrears: Math.max(Number(calculatedArrears.toFixed(2)), 0)
    }));
  };

  const handleRentPaymentMethodChange = (value) => {
    setPaymentForm((prev) => ({
      ...prev,
      paymentMethod: value,
      bankName: value === 'Cash' ? '' : prev.bankName
    }));
  };

  const handleRentAttachmentChange = (event) => {
    const file = event.target.files?.[0];
    setPaymentAttachment(file || null);
  };

  const handleClosePaymentDialog = () => {
    setPaymentDialog(false);
    setPaymentAttachment(null);
  };

  const getPaymentStatusConfig = (status) => {
    const normalized = (status || '').toString().toLowerCase();
    switch (normalized) {
      case 'paid':
      case 'approved':
        return { color: 'success', label: 'Paid', iconColor: 'success.main' };
      case 'partial_paid':
      case 'pending approval':
        return { color: 'warning', label: 'Partial Paid', iconColor: 'warning.main' };
      case 'unpaid':
        return { color: 'error', label: 'Unpaid', iconColor: 'error.main' };
      case 'draft':
        return { color: 'default', label: 'Draft', iconColor: 'text.secondary' };
      case 'cancelled':
        return { color: 'default', label: 'Cancelled', iconColor: 'text.secondary' };
      case 'rejected':
        return { color: 'error', label: 'Rejected', iconColor: 'error.main' };
      default:
        return { color: 'default', label: status || 'N/A', iconColor: 'text.secondary' };
    }
  };

  // Helper function to calculate adjusted grandTotal for overdue unpaid invoices
  const getAdjustedGrandTotal = (invoice) => {
    if (!invoice) return 0;
    
    // Check if invoice is overdue (after due date ends) and unpaid/partially paid
    const invoiceDueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const dueStart = invoiceDueDate ? new Date(invoiceDueDate) : null; if (dueStart) dueStart.setHours(0, 0, 0, 0);
    const isOverdue = dueStart && todayStart > dueStart;
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

  const handleCloseStatusMenu = () => {
    setStatusMenuAnchor(null);
    setStatusMenuContext(null);
  };

  const handleChangePaymentStatus = async (status) => {
    if (!statusMenuContext) return;
    try {
      await updatePaymentStatus(statusMenuContext.propertyId, statusMenuContext.paymentId, status);
      setProperties((prev) =>
        prev.map((property) => {
          if (property._id !== statusMenuContext.propertyId) return property;
          return {
            ...property,
            payments: property.payments.map((payment) =>
              payment._id === statusMenuContext.paymentId ? { ...payment, status } : payment
            )
          };
        })
      );
      if (selectedProperty && selectedProperty._id === statusMenuContext.propertyId) {
        setSelectedProperty((prev) => ({
          ...prev,
          payments: prev.payments.map((payment) =>
            payment._id === statusMenuContext.paymentId ? { ...payment, status } : payment
          )
        }));
      }
      if (selectedPayment && selectedPayment._id === statusMenuContext.paymentId) {
        setSelectedPayment((prev) => ({ ...prev, status }));
      }
      setSuccess('Payment status updated');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update payment status');
    } finally {
      handleCloseStatusMenu();
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Rental Management
          </Typography>
          <Typography color="text.secondary">
            Manage your rental properties, agreements, and payments
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            placeholder="Search properties"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Tooltip title="Refresh">
            <IconButton onClick={loadData} disabled={loading}>
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
        <StatCard title="Total Properties" value={summary.totalProperties || properties.length} />
        <StatCard title="Filtered Properties" value={filteredProperties.length} />
        <StatCard title="Total Expected Rent" value={formatCurrency(summary.rent?.expectedTotal || filteredProperties.reduce((sum, p) => sum + (p.expectedRent || p.rentalAgreement?.monthlyRent || 0), 0))} />
        <StatCard title="Avg Monthly Rent" value={formatCurrency(summary.rent?.expectedAverage || (filteredProperties.length > 0 ? filteredProperties.reduce((sum, p) => sum + (p.expectedRent || p.rentalAgreement?.monthlyRent || 0), 0) / filteredProperties.length : 0))} />
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
                  <MenuItem value="Available">Available</MenuItem>
                  <MenuItem value="Rented">Rented</MenuItem>
                  <MenuItem value="Reserved">Reserved</MenuItem>
                  <MenuItem value="Under Maintenance">Under Maintenance</MenuItem>
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
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleOpenBulkCreateDialog}
              disabled={bulkCreating}
              startIcon={<ReceiptLongIcon />}
            >
              {bulkCreating ? 'Creating Invoices...' : `Create Invoices for ${filteredProperties.length > 0 ? filteredProperties.length : properties.length} Properties`}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell width={50}></TableCell>
                  <TableCell>Property Code</TableCell>
                  <TableCell>Property Details</TableCell>
                  <TableCell>Address</TableCell>
                  <TableCell>Agreement</TableCell>
                  <TableCell>Tenant</TableCell>
                  <TableCell>Rent</TableCell>
                  <TableCell>Property Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  // Skeleton loading rows
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell><Skeleton variant="circular" width={32} height={32} /></TableCell>
                      <TableCell><Skeleton variant="text" width={100} /></TableCell>
                      <TableCell>
                        <Skeleton variant="text" width="60%" />
                        <Skeleton variant="text" width="80%" height={20} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width="70%" />
                        <Skeleton variant="text" width="90%" height={20} />
                      </TableCell>
                      <TableCell><Skeleton variant="text" width={120} /></TableCell>
                      <TableCell>
                        <Skeleton variant="text" width="60%" />
                        <Skeleton variant="text" width={100} height={20} />
                      </TableCell>
                      <TableCell><Skeleton variant="text" width={80} /></TableCell>
                      <TableCell><Skeleton variant="rectangular" width={80} height={24} /></TableCell>
                      <TableCell align="right">
                        <Skeleton variant="circular" width={32} height={32} />
                        <Skeleton variant="circular" width={32} height={32} sx={{ ml: 1 }} />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredProperties.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No properties found matching your filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProperties.map((property) => (
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
                      <TableCell>
                        <Typography fontWeight={600}>{property.propertyCode}</Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box>
                            <Typography fontWeight={600}>{property.propertyName}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {property.propertyType} • {property.area?.value} {property.area?.unit}
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
                        <Typography variant="body2">{property.fullAddress}</Typography>
                        {property.sector && (
                          <Typography variant="caption" color="text.secondary">
                            Sector {property.sector} {property.block && `• Block ${property.block}`}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {property.rentalAgreement ? (
                          <Typography variant="body2">
                            {property.rentalAgreement.agreementNumber}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">No Agreement</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {property.tenantName ? (
                          <>
                            <Typography variant="body2">{property.tenantName}</Typography>
                            {property.tenantPhone && (
                              <Typography variant="caption" color="text.secondary">
                                {property.tenantPhone}
                              </Typography>
                            )}
                          </>
                        ) : (
                          <Typography variant="body2" color="text.secondary">No Tenant</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={600}>
                          {formatCurrency(property.rentAmount ?? property.expectedRent ?? 0)}
                        </Typography>
                        {property.rentArrears > 0 ? (
                          <Typography variant="caption" color="error.main" display="block">
                            Arrears: {formatCurrency(property.rentArrears)}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            No arrears
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={property.status}
                          size="small"
                          color={
                            property.status === 'Available' ? 'success' :
                            property.status === 'Rented' ? 'error' :
                            property.status === 'Under Maintenance' ? 'warning' : 'default'
                          }
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Tooltip title="View Details">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => navigate(`/finance/taj-utilities-charges/rental-management/${property._id}`)}
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Create Invoice">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleCreateInvoice(property)}
                            >
                              <ReceiptLongIcon fontSize="small" />
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
                                    .filter(inv => inv.chargeTypes?.includes('RENT'))
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
                                                await generateRentInvoicePDF(property, invoice, { openInNewTab: true });
                                              }}
                                            >
                                              <VisibilityIcon fontSize="small" />
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
                                              onClick={async () => await generateRentInvoicePDF(property, invoice)}
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
                                      <TableCell colSpan={9} sx={{ py: 0, border: 0 }}>
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
                                                              onClick={() => generateRentalPaymentReceiptPDF(invoice, payment, property)}
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
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
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
                Property: {selectedProperty?.propertyName} ({selectedProperty?.propertyCode})
              </Typography>
            </Grid>
            {unpaidPayments.length > 0 && (
              <Grid item xs={12}>
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'warning.light',
                    borderRadius: 1,
                    p: 2,
                    backgroundColor: 'warning.50'
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" color="warning.dark">
                      Existing Unpaid Payments
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {unpaidPayments.length} record{unpaidPayments.length > 1 ? 's' : ''}
                    </Typography>
                  </Stack>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Invoice</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {unpaidPayments.map((payment) => (
                        <TableRow key={payment._id}>
                          <TableCell>{dayjs(payment.paymentDate).format('DD MMM, YYYY')}</TableCell>
                          <TableCell>{payment.invoiceNumber || 'N/A'}</TableCell>
                          <TableCell align="right">
                            {formatCurrency(payment.totalAmount || payment.amount || 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Typography variant="caption" color="text.secondary">
                    Clear the listed unpaid payments before adding another if needed.
                  </Typography>
                </Box>
              </Grid>
            )}
            <Grid item xs={12} md={6}>
              <TextField
                label="Amount (PKR)"
                type="number"
                fullWidth
                value={paymentForm.amount}
                onChange={(e) => handleRentAmountChange(e.target.value)}
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
                <Typography variant="caption" color="text.secondary">
                  Current Amount: {formatCurrency(paymentForm.amount || 0)} + Arrears: {formatCurrency(paymentForm.arrears || 0)}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Payment Date"
                type="date"
                fullWidth
                value={paymentForm.paymentDate}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, paymentDate: e.target.value }))}
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
                  onChange={(e) => handleRentPaymentMethodChange(e.target.value)}
                  label="Payment Method"
                >
                  {paymentMethods.map(method => (
                    <MenuItem key={method} value={method}>{method}</MenuItem>
                  ))}
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
                    onChange={(e) => setPaymentForm(prev => ({ ...prev, bankName: e.target.value }))}
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
              <TextField
                label="Reference/Transaction ID"
                fullWidth
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, reference: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <Button
                variant="outlined"
                component="label"
                startIcon={<AttachFileIcon />}
                sx={{ mr: 2 }}
              >
                {paymentAttachment ? 'Change Attachment' : 'Attach Receipt'}
                <input type="file" hidden accept="image/*,.pdf" onChange={handleRentAttachmentChange} />
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

      {/* Payment Details Dialog */}
      {selectedProperty && selectedPayment && (
        <Dialog open={paymentDetailsDialog} onClose={() => setPaymentDetailsDialog(false)} maxWidth="lg" fullWidth>
          <DialogTitle sx={{ 
            borderBottom: '1px solid #e0e0e0',
            py: 2.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5
          }}>
            <ReceiptIcon color="primary" sx={{ fontSize: 28 }} />
            <Box>
              <Typography variant="h5" fontWeight={600}>
                Payment Details
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Invoice: {selectedPayment.invoiceNumber || 'N/A'}
              </Typography>
            </Box>
            <IconButton
              onClick={() => setPaymentDetailsDialog(false)}
              sx={{ 
                position: 'absolute', 
                right: 8, 
                top: 8
              }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ p: 3 }}>
            <Grid container spacing={3}>
              {/* Payment Details Section */}
              <Grid item xs={12}>
                <Card elevation={1} sx={{ borderRadius: 1 }}>
                  <Box sx={{ 
                    p: 2,
                    borderBottom: '1px solid #e0e0e0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5
                  }}>
                    <MoneyIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>
                      Payment Information
                    </Typography>
                  </Box>
                  <CardContent sx={{ p: 3 }}>
                    <Grid container spacing={3}>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Payment Date
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {dayjs(selectedPayment.paymentDate).format('MMMM D, YYYY')}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Amount
                        </Typography>
                        <Typography variant="h6" fontWeight={600} color="primary">
                          {formatCurrency(selectedPayment.amount)}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Status
                        </Typography>
                        {(() => {
                          const { color, label, iconColor } = getPaymentStatusConfig(selectedPayment.status);
                          return (
                            <Chip
                              label={label}
                              color={color === 'default' ? undefined : color}
                              variant={color === 'default' ? 'outlined' : 'filled'}
                              size="small"
                              icon={<StatusIcon fontSize="small" sx={{ color: iconColor }} />}
                            />
                          );
                        })()}
                      </Grid>
                      {selectedPayment.arrears > 0 && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Arrears
                          </Typography>
                          <Typography variant="body1" fontWeight={600} color="error">
                            {formatCurrency(selectedPayment.arrears)}
                          </Typography>
                        </Grid>
                      )}
                      {(selectedPayment.arrears > 0 || selectedPayment.totalAmount) && (
                        <Grid item xs={12}>
                          <Box sx={{ 
                            p: 2, 
                            borderRadius: 1, 
                            backgroundColor: '#e8f5e9',
                            borderLeft: '3px solid #4caf50'
                          }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Total Payment Amount
                            </Typography>
                            <Typography variant="h6" fontWeight={700} color="primary">
                              {formatCurrency(selectedPayment.totalAmount || (selectedPayment.amount + (selectedPayment.arrears || 0)))}
                            </Typography>
                          </Box>
                        </Grid>
                      )}
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Period From
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {selectedPayment.periodFrom ? dayjs(selectedPayment.periodFrom).format('MMMM D, YYYY') : 'N/A'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Period To
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {selectedPayment.periodTo ? dayjs(selectedPayment.periodTo).format('MMMM D, YYYY') : 'N/A'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Invoice Number
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {selectedPayment.invoiceNumber || 'N/A'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Payment Method
                        </Typography>
                        <Chip 
                          label={selectedPayment.paymentMethod} 
                          size="small" 
                          color="primary"
                          variant="outlined"
                        />
                      </Grid>
                      {selectedPayment.reference && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Reference/Transaction ID
                          </Typography>
                          <Typography variant="body1" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                            {selectedPayment.reference}
                          </Typography>
                        </Grid>
                      )}
                      {selectedPayment.notes && (
                        <Grid item xs={12}>
                          <Box sx={{ 
                            p: 2, 
                            borderRadius: 1, 
                            backgroundColor: '#f5f5f5',
                            borderLeft: '3px solid #1976d2'
                          }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Notes
                            </Typography>
                            <Typography variant="body1">
                              {selectedPayment.notes}
                            </Typography>
                          </Box>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Property Details Section */}
              <Grid item xs={12} md={6}>
                <Card elevation={1} sx={{ borderRadius: 1, height: '100%' }}>
                  <Box sx={{ 
                    p: 2,
                    borderBottom: '1px solid #e0e0e0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5
                  }}>
                    <HomeIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>
                      Property Details
                    </Typography>
                  </Box>
                  <CardContent sx={{ p: 3 }}>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Property Code
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {selectedProperty.propertyCode}
                        </Typography>
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Property Name
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {selectedProperty.propertyName}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Property Type
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {selectedProperty.propertyType}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Status
                        </Typography>
                        <Chip
                          label={selectedProperty.status}
                          size="small"
                          color={
                            selectedProperty.status === 'Available' ? 'success' :
                            selectedProperty.status === 'Rented' ? 'error' :
                            selectedProperty.status === 'Under Maintenance' ? 'warning' : 'default'
                          }
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Address
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {selectedProperty.fullAddress}
                        </Typography>
                        {(selectedProperty.street || selectedProperty.sector || selectedProperty.block) && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {[selectedProperty.street, selectedProperty.sector, selectedProperty.block].filter(Boolean).join(' • ')}
                            {selectedProperty.floor && ` • Floor: ${selectedProperty.floor}`}
                            {selectedProperty.unit && ` • Unit: ${selectedProperty.unit}`}
                          </Typography>
                        )}
                      </Grid>
                      {selectedProperty.area && selectedProperty.area.value > 0 && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Area
                          </Typography>
                          <Typography variant="body1" fontWeight={600}>
                            {selectedProperty.area.value} {selectedProperty.area.unit}
                          </Typography>
                        </Grid>
                      )}
                      {selectedProperty.bedrooms > 0 && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Bedrooms
                          </Typography>
                          <Typography variant="body1" fontWeight={600}>
                            {selectedProperty.bedrooms}
                          </Typography>
                        </Grid>
                      )}
                      {selectedProperty.bathrooms > 0 && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Bathrooms
                          </Typography>
                          <Typography variant="body1" fontWeight={600}>
                            {selectedProperty.bathrooms}
                          </Typography>
                        </Grid>
                      )}
                      {selectedProperty.expectedRent > 0 && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Expected Rent
                          </Typography>
                          <Typography variant="body1" fontWeight={600} color="primary">
                            {formatCurrency(selectedProperty.expectedRent)}
                          </Typography>
                        </Grid>
                      )}
                      {selectedProperty.securityDeposit > 0 && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Security Deposit
                          </Typography>
                          <Typography variant="body1" fontWeight={600} color="primary">
                            {formatCurrency(selectedProperty.securityDeposit)}
                          </Typography>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Tenant Details Section */}
              {selectedProperty.tenantName && (
                <Grid item xs={12} md={6}>
                  <Card elevation={1} sx={{ borderRadius: 1, height: '100%' }}>
                    <Box sx={{ 
                      p: 2,
                      borderBottom: '1px solid #e0e0e0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5
                    }}>
                      <PersonIcon color="primary" />
                      <Typography variant="h6" fontWeight={600}>
                        Tenant Details
                      </Typography>
                    </Box>
                    <CardContent sx={{ p: 3 }}>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Tenant Name
                          </Typography>
                          <Typography variant="body1" fontWeight={600}>
                            {selectedProperty.tenantName}
                          </Typography>
                        </Grid>
                        {selectedProperty.tenantPhone && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Phone
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {selectedProperty.tenantPhone}
                            </Typography>
                          </Grid>
                        )}
                        {selectedProperty.tenantEmail && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Email
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {selectedProperty.tenantEmail}
                            </Typography>
                          </Grid>
                        )}
                        {selectedProperty.tenantCNIC && (
                          <Grid item xs={12}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              CNIC
                            </Typography>
                            <Typography variant="body1" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                              {selectedProperty.tenantCNIC}
                            </Typography>
                          </Grid>
                        )}
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>
              )}

              {/* Agreement Details Section */}
              {selectedProperty.rentalAgreement && (
                <Grid item xs={12} md={selectedProperty.tenantName ? 6 : 12}>
                  <Card elevation={1} sx={{ borderRadius: 1, height: '100%' }}>
                    <Box sx={{ 
                      p: 2,
                      borderBottom: '1px solid #e0e0e0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5
                    }}>
                      <DescriptionIcon color="primary" />
                      <Typography variant="h6" fontWeight={600}>
                        Rental Agreement Details
                      </Typography>
                    </Box>
                    <CardContent sx={{ p: 3 }}>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Agreement Number
                          </Typography>
                          <Typography variant="body1" fontWeight={600}>
                            {selectedProperty.rentalAgreement.agreementNumber || 'N/A'}
                          </Typography>
                        </Grid>
                        {selectedProperty.rentalAgreement.propertyName && (
                          <Grid item xs={12}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Property Name (Agreement)
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {selectedProperty.rentalAgreement.propertyName}
                            </Typography>
                          </Grid>
                        )}
                        {selectedProperty.rentalAgreement.monthlyRent && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Monthly Rent
                            </Typography>
                            <Typography variant="body1" fontWeight={600} color="primary">
                              {formatCurrency(selectedProperty.rentalAgreement.monthlyRent)}
                            </Typography>
                          </Grid>
                        )}
                        {selectedProperty.rentalAgreement.startDate && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Start Date
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {dayjs(selectedProperty.rentalAgreement.startDate).format('MMMM D, YYYY')}
                            </Typography>
                          </Grid>
                        )}
                        {selectedProperty.rentalAgreement.endDate && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              End Date
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {dayjs(selectedProperty.rentalAgreement.endDate).format('MMMM D, YYYY')}
                            </Typography>
                          </Grid>
                        )}
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>
              )}
            </Grid>
          </DialogContent>
          <DialogActions sx={{ p: 2.5, borderTop: '1px solid #e0e0e0' }}>
            <Button 
              onClick={() => setPaymentDetailsDialog(false)}
              variant="outlined"
            >
              Close
            </Button>
            <Button
              variant="contained"
              startIcon={<PrintIcon />}
              onClick={() => {
                setPaymentDetailsDialog(false);
                handleViewInvoice(selectedProperty, selectedPayment);
              }}
            >
              View Invoice
            </Button>
          </DialogActions>
        </Dialog>
      )}

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
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleBulkCreateInvoices}
            disabled={bulkCreating || !bulkCreateInvoiceData.periodFrom || !bulkCreateInvoiceData.periodTo}
          >
            {bulkCreating ? 'Creating...' : 'Create All Invoices'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Invoice Print Dialog */}
      {paymentInvoiceData && (
        <Dialog open={paymentInvoiceDialog} onClose={() => setPaymentInvoiceDialog(false)} maxWidth="lg" fullWidth>
          <DialogTitle sx={{ '@media print': { display: 'none' } }}>
            Invoice - {paymentInvoiceData.invoiceNumber}
            <Stack direction="row" spacing={1} sx={{ position: 'absolute', right: 8, top: 8 }}>
              <Button startIcon={<DownloadIcon />} onClick={handleDownloadPDF} variant="outlined">
                Download PDF
              </Button>
              <Button startIcon={<PrintIcon />} onClick={handlePrintInvoice} variant="outlined">
                Print
              </Button>
              <IconButton onClick={() => setPaymentInvoiceDialog(false)}>
                <CloseIcon />
              </IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent>
            <Box id="invoice-print" sx={{ '@media print': { display: 'block' } }}>
              {/* Triplicate Copies */}
              {['Bank Copy', 'Office Copy', 'Client Copy'].map((copyLabel, copyIndex) => (
                <Paper
                  key={copyIndex}
                  sx={{
                    p: 3,
                    mb: copyIndex < 2 ? 3 : 0,
                    border: '1px solid #ddd',
                    pageBreakAfter: copyIndex < 2 ? 'always' : 'auto',
                    '@media print': {
                      pageBreakAfter: copyIndex < 2 ? 'always' : 'auto',
                      mb: copyIndex < 2 ? 0 : 0
                    }
                  }}
                >
                  {/* Header Section */}
                  <Box sx={{ textAlign: 'center', mb: 3 }}>
                    <Typography variant="h5" fontWeight={700} color="primary">
                      TAJ RESIDENCIA
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      LIVE YOUR DREAMS
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      ({copyLabel})
                    </Typography>
                    <Typography variant="h6" fontWeight={700} color="error" sx={{ mt: 1 }}>
                      {paymentInvoiceData.propertyType.toUpperCase()} CHARGES
                    </Typography>
                  </Box>

                  {/* Property and Tenant Details */}
                  <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid item xs={12} md={6}>
                      <Table size="small">
                        <TableBody>
                          <TableRow>
                            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600, width: '40%' }}>
                              Property Type:
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {paymentInvoiceData.propertyType}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>
                              Tenant Name:
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {paymentInvoiceData.tenantName}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>
                              Address:
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {paymentInvoiceData.address}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Table size="small">
                        <TableBody>
                          <TableRow>
                            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600, width: '40%' }}>
                              Period From:
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {dayjs(paymentInvoiceData.periodFrom).format('D-MMM-YY')}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>
                              Period To:
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {dayjs(paymentInvoiceData.periodTo).format('D-MMM-YY')}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>
                              Invoice No.:
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {paymentInvoiceData.invoiceNumber}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>
                              Invoicing Date:
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {dayjs(paymentInvoiceData.invoicingDate).format('MMMM D, YYYY')}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>
                              Due Date:
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {dayjs(paymentInvoiceData.dueDate).format('MMMM D, YYYY')}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </Grid>
                  </Grid>

                  {/* Rent Details Section */}
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="body2" align="center" sx={{ mb: 1, fontWeight: 600 }}>
                      (In Rupees)
                    </Typography>
                    <Typography variant="subtitle2" align="center" sx={{ mb: 2, fontWeight: 700 }}>
                      RENT DETAILS
                    </Typography>
                    <Table size="small" sx={{ mb: 2 }}>
                      <TableBody>
                        {paymentInvoiceData.charges.map((charge, idx) => (
                          <TableRow key={idx}>
                            <TableCell sx={{ border: 0, py: 0.5 }}>
                              {charge.description}
                            </TableCell>
                            <TableCell align="right" sx={{ border: 0, py: 0.5 }}>
                              {formatCurrency(charge.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell sx={{ borderTop: '1px solid #ddd', py: 1, fontWeight: 700 }}>
                            Total Due Amount
                          </TableCell>
                          <TableCell align="right" sx={{ borderTop: '1px solid #ddd', py: 1, fontWeight: 700 }}>
                            {formatCurrency(paymentInvoiceData.totalAmount)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </Box>

                  {/* Payment Instructions */}
                  <Box sx={{ fontSize: '0.875rem', mt: 4 }}>
                    <Typography variant="body2" paragraph sx={{ mb: 1.5 }}>
                      1. The above mentioned charges are calculated based on proportionate share of user in total cost of electricity of the Project and do not include any profit element of TAJ Residencia.
                    </Typography>
                    <Typography variant="body2" paragraph sx={{ mb: 1.5 }}>
                      2. Please make your deposits through cash, crossed cheque or bank drafts on our specified deposit slip at any Allied Bank Limited branch in Pakistan to Account Title: <strong>Taj Residencia, Allied Bank Limited, The Centaurus Mall Branch, Islamabad. (0917) Bank Account No: PK68ABPA0010035700420129.</strong>
                    </Typography>
                    <Typography variant="body2" paragraph sx={{ mb: 1.5 }}>
                      3. Please deposit your dues before due date to avoid Late Payment Surcharge.
                    </Typography>
                    <Typography variant="body2">
                      4. Please share proof of payment to TAJ Official Whats App No.: <strong>0345 77 88 442:</strong>
                    </Typography>
                  </Box>
                </Paper>
              ))}
            </Box>
          </DialogContent>
        </Dialog>
      )}

      <Menu
        anchorEl={statusMenuAnchor}
        open={Boolean(statusMenuAnchor)}
        onClose={handleCloseStatusMenu}
      >
        {paymentStatuses.map((status) => {
          const { label, iconColor } = getPaymentStatusConfig(status);
          return (
            <MenuItem key={status} onClick={() => handleChangePaymentStatus(status)}>
              <StatusIcon fontSize="small" sx={{ mr: 1, color: iconColor }} />
              {label}
            </MenuItem>
          );
        })}
      </Menu>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
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

export default RentalManagement;
