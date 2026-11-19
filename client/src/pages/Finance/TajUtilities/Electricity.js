import React, { useEffect, useState } from 'react';
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
  Collapse,
  Skeleton
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Close as CloseIcon,
  Visibility as ViewIcon,
  Print as PrintIcon,
  Download as DownloadIcon,
  ReceiptLong as ReceiptIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  AttachFile as AttachFileIcon,
  Delete as DeleteIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { getAdjustedGrandTotal, getAdjustedBalance } from '../../../utils/invoiceGracePeriodUtils';
import jsPDF from 'jspdf';
import { useNavigate } from 'react-router-dom';
import {
  fetchElectricity,
  createElectricity,
  updateElectricity,
  addPaymentToPropertyElectricity
} from '../../../services/electricityService';
import { createInvoice, updateInvoice, fetchInvoicesForProperty, fetchInvoice, deleteInvoice, deletePaymentFromInvoice, getElectricityCalculation } from '../../../services/propertyInvoiceService';
import { fetchPropertyById } from '../../../services/tajPropertiesService';
import { generateElectricityInvoicePDF as generateElectricityInvoicePDFUtil } from '../../../utils/invoicePDFGenerators';
import api from '../../../services/api';
import pakistanBanks from '../../../constants/pakistanBanks';
import { getImageUrl } from '../../../utils/imageService';
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

// Generate invoice number with type prefix (same logic as backend)
const generateInvoiceNumber = (propertySrNo, year, month, type = 'ELC') => {
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

const formatUnitPrice = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
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


const Electricity = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState(defaultForm);
  const [editingCharge, setEditingCharge] = useState(null);
  const [viewingCharge, setViewingCharge] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  
  // Filter state
  const [statusFilter, setStatusFilter] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  
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
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    arrears: 0,
    paymentDate: dayjs().format('YYYY-MM-DD'),
    periodFrom: dayjs().format('YYYY-MM-DD'),
    periodTo: dayjs().format('YYYY-MM-DD'),
    invoiceNumber: '',
    paymentMethod: 'Bank Transfer',
    bankName: '',
    reference: '',
    notes: ''
  });
  const [paymentAttachment, setPaymentAttachment] = useState(null);
  
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [, setInvoiceWasSaved] = useState(false);
  const [invoiceProperty, setInvoiceProperty] = useState(null);
  const [invoiceData, setInvoiceData] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [propertyInvoices, setPropertyInvoices] = useState({});
  const [loadingInvoices, setLoadingInvoices] = useState({});
  const [readingData, setReadingData] = useState({ previousReading: 0, previousArrears: 0, meterNo: '' });
  const [currentReading, setCurrentReading] = useState('');
  const [pendingReading, setPendingReading] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [meterReadings, setMeterReadings] = useState({}); // Store readings for each meter: { meterNo: { previousReading, currentReading, previousArrears, calculationData } }
  const [pendingMeterCalculations, setPendingMeterCalculations] = useState({}); // Track pending calculations per meter

  const loadCharges = async () => {
    try {
      setLoading(true);
      setError('');
      await fetchElectricity({ search });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load Electricity Bills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCharges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const response = await api.get('/taj-utilities/electricity/current-overview', { params });
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

  const handleDeletePayment = async (invoiceId, paymentId, propertyId) => {
    if (!window.confirm('Are you sure you want to delete this payment?')) {
      return;
    }

    try {
      await deletePaymentFromInvoice(invoiceId, paymentId);
      setSuccess('Payment deleted successfully');
      
      // Reload invoices for this property
      const response = await fetchInvoicesForProperty(propertyId);
      setPropertyInvoices(prev => ({ ...prev, [propertyId]: response.data?.data || [] }));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete payment');
    }
  };

  const handleDeleteInvoice = async (invoiceId, propertyId) => {
    if (!window.confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
      return;
    }

    try {
      await deleteInvoice(invoiceId);
      setSuccess('Invoice deleted successfully');
      
      // Reload invoices for this property
      const response = await fetchInvoicesForProperty(propertyId);
      setPropertyInvoices(prev => ({ ...prev, [propertyId]: response.data?.data || [] }));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete invoice');
    }
  };

  const handleEditInvoice = async (property, invoice) => {
    try {
      setInvoiceLoading(true);
      setInvoiceError('');
      
      // Fetch full property details including meters array
      const propertyResponse = await fetchPropertyById(property._id);
      const fullProperty = propertyResponse.data?.data || property;
      setInvoiceProperty(fullProperty);
      
      // Extract meter number from invoice number if it has suffix (e.g., INV-ELC-2026-01-1113-M2)
      const invoiceNumber = invoice.invoiceNumber || '';
      const meterSuffixMatch = invoiceNumber.match(/-M(\d+)$/);
      const meterIndex = meterSuffixMatch ? parseInt(meterSuffixMatch[1]) - 1 : 0; // M2 = index 1, M3 = index 2, etc.
      
      // Get active meters
      const activeMeters = (fullProperty.meters || []).filter(m => m.isActive !== false);
      const hasMultipleMeters = activeMeters.length > 1;
      
      // Determine which meter this invoice is for
      let targetMeter = null;
      let meterNo = '';
      
      if (hasMultipleMeters && meterIndex >= 0 && meterIndex < activeMeters.length) {
        targetMeter = activeMeters[meterIndex];
        meterNo = String(targetMeter?.meterNo || '');
      } else if (invoice.electricityBill?.meterNo) {
        // Fallback: use meter number from electricity bill
        meterNo = String(invoice.electricityBill.meterNo);
        targetMeter = activeMeters.find(m => String(m.meterNo) === meterNo) || activeMeters[0];
      } else if (activeMeters.length > 0) {
        // Fallback: use first meter
        targetMeter = activeMeters[0];
        meterNo = String(targetMeter?.meterNo || '');
      } else {
        // Legacy: use property meter fields
        meterNo = String(fullProperty.meterNumber || fullProperty.electricityWaterMeterNo || '');
      }
      
      // Load electricity bill data and calculation data for this specific meter
      let previousArrears = 0;
      let previousReading = 0;
      let calculationData = invoice.calculationData || null;
      
      // If invoice has electricityBill populated, use its arrears
      if (invoice.electricityBill?.arrears !== undefined) {
        previousArrears = invoice.electricityBill.arrears || 0;
      } else if (invoice.charges?.find(c => c.type === 'ELECTRICITY')?.arrears !== undefined) {
        previousArrears = invoice.charges.find(c => c.type === 'ELECTRICITY').arrears || 0;
      } else if (invoice.totalArrears !== undefined) {
        previousArrears = invoice.totalArrears || 0;
      }
      
      // Try to get calculation data from invoice, or fetch it
      if (!calculationData && meterNo) {
        try {
          const readingResponse = await getElectricityCalculation(fullProperty._id, undefined, meterNo);
          previousReading = readingResponse.data?.data?.previousReading || 0;
          previousArrears = readingResponse.data?.data?.previousArrears || previousArrears;
          // Build calculation data from invoice electricity bill if available
          if (invoice.electricityBill) {
            calculationData = {
              meterNo: meterNo,
              previousReading: invoice.electricityBill.prvReading || previousReading,
              currentReading: invoice.electricityBill.curReading || 0,
              unitsConsumed: invoice.electricityBill.unitsConsumed || 0,
              previousArrears: previousArrears,
              slab: {
                unitsSlab: invoice.electricityBill.iescoSlabs || '',
                unitRate: invoice.electricityBill.iescoUnitPrice || 0,
                fixRate: invoice.electricityBill.fixedCharges || 0
              },
              charges: {
                electricityCost: invoice.electricityBill.electricityCost || 0,
                fcSurcharge: invoice.electricityBill.fcSurcharge || 0,
                gst: invoice.electricityBill.gst || 0,
                electricityDuty: invoice.electricityBill.electricityDuty || 0,
                fixedCharges: invoice.electricityBill.fixedCharges || 0,
                withSurcharge: invoice.electricityBill.totalBill || invoice.electricityBill.amount || 0
              }
            };
          }
        } catch (err) {
          console.error('Error fetching reading data for edit:', err);
        }
      } else if (calculationData) {
        // Use existing calculation data
        previousReading = calculationData.previousReading || 0;
        previousArrears = calculationData.previousArrears || previousArrears;
      }
      
      // Set reading data for the target meter
      setReadingData({
        previousReading: previousReading,
        previousArrears: previousArrears,
        meterNo: meterNo,
        meterSelectValue: targetMeter ? `${meterNo}|${fullProperty.meters.findIndex(m => m === targetMeter)}` : meterNo
      });
      
      // If multiple meters, populate meterReadings for all meters
      if (hasMultipleMeters) {
        const meterReadingsData = {};
        for (const meter of activeMeters) {
          const mNo = String(meter.meterNo || '');
          if (mNo === meterNo && calculationData) {
            // This is the meter for this invoice
            meterReadingsData[mNo] = {
              previousReading: calculationData.previousReading || 0,
              previousArrears: calculationData.previousArrears || previousArrears,
              currentReading: calculationData.currentReading || (invoice.electricityBill?.curReading || ''),
              calculationData: calculationData,
              meter: meter
            };
          } else {
            // Fetch data for other meters
            try {
              const readingResponse = await getElectricityCalculation(fullProperty._id, undefined, mNo);
              meterReadingsData[mNo] = {
                previousReading: readingResponse.data?.data?.previousReading || 0,
                previousArrears: readingResponse.data?.data?.previousArrears || 0,
                currentReading: '',
                meter: meter
              };
            } catch (err) {
              console.error(`Error fetching reading for meter ${mNo}:`, err);
              meterReadingsData[mNo] = {
                previousReading: 0,
                previousArrears: 0,
                currentReading: '',
                meter: meter
              };
            }
          }
        }
        setMeterReadings(meterReadingsData);
      }
      
      // Update invoice data with calculation data
      const updatedInvoiceData = {
        ...invoice,
        calculationData: calculationData
      };
      
      setInvoiceData(updatedInvoiceData);
      setInvoiceWasSaved(true); // Mark as saved since it's an existing invoice
      setInvoiceDialogOpen(true);
    } catch (err) {
      console.error('Error loading invoice for edit:', err);
      setInvoiceError(err.response?.data?.message || 'Failed to load invoice data');
      // Still open dialog with basic invoice data
      setInvoiceProperty(property);
      setInvoiceData(invoice);
      setInvoiceWasSaved(true);
      setInvoiceDialogOpen(true);
    } finally {
      setInvoiceLoading(false);
    }
  };

  const handleCreateInvoice = async (property) => {
    setInvoiceData(null); // Reset invoice data for new invoice
    setInvoiceError('');
    setCurrentReading('');
    setMeterReadings({});
    setInvoiceWasSaved(false); // Reset saved flag
    setInvoiceDialogOpen(true);
    
    try {
      setInvoiceLoading(true);
      
      // Fetch full property details including meters array
      const propertyResponse = await fetchPropertyById(property._id);
      const fullProperty = propertyResponse.data?.data || property;
      setInvoiceProperty(fullProperty);
      
      // Check if property has multiple active meters
      const activeMeters = (fullProperty.meters || []).filter(m => m.isActive !== false);
      const hasMultipleMeters = activeMeters.length > 1;
      
      // Fetch previous readings for all meters if multiple meters exist
      const meterReadingsData = {};
      
      if (hasMultipleMeters) {
        // Fetch previous reading for each meter
        for (const meter of activeMeters) {
          const meterNo = String(meter.meterNo || '');
          try {
            const readingResponse = await getElectricityCalculation(fullProperty._id, undefined, meterNo);
            meterReadingsData[meterNo] = {
              previousReading: readingResponse.data?.data?.previousReading || 0,
              previousArrears: readingResponse.data?.data?.previousArrears || 0,
              currentReading: '',
              meter: meter
            };
          } catch (err) {
            console.error(`Error fetching reading for meter ${meterNo}:`, err);
            meterReadingsData[meterNo] = {
              previousReading: 0,
              previousArrears: 0,
              currentReading: '',
              meter: meter
            };
          }
        }
        setMeterReadings(meterReadingsData);
      }
      
      // Fetch previous reading for first meter (for single meter or fallback)
      const readingResponse = await getElectricityCalculation(fullProperty._id);
      const prevReading = readingResponse.data?.data?.previousReading || 0;
      const prevArrears = readingResponse.data?.data?.previousArrears || 0;
      
      // Get meter number - prioritize from meters array if available
      let meterNo = '';
      let meterSelectValue = '';
      
      if (activeMeters.length > 0) {
        // Use first active meter as default
        const firstMeter = activeMeters[0];
        meterNo = String(firstMeter?.meterNo || '');
        // Find the original index in the full meters array
        const originalIndex = fullProperty.meters.findIndex(m => m === firstMeter);
        meterSelectValue = `${meterNo}|${originalIndex}`;
      } else {
        // Fallback to legacy fields
        meterNo = String(readingResponse.data?.data?.meterNo || fullProperty.meterNumber || fullProperty.electricityWaterMeterNo || '');
        meterSelectValue = meterNo;
      }
      
      setReadingData({
        previousReading: prevReading,
        previousArrears: prevArrears,
        meterNo: meterNo,
        meterSelectValue: meterSelectValue
      });
      
      // Initialize invoice data with default values
      const now = dayjs();
      const periodFrom = now.startOf('month').toDate();
      const periodTo = now.endOf('month').toDate();
      
      // Generate invoice number for Electricity
      const invoiceNumber = generateInvoiceNumber(
        fullProperty.srNo,
        now.year(),
        now.month() + 1,
        'ELECTRICITY'
      );
      
      setInvoiceData({
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate: dayjs(periodTo).add(15, 'day').toDate(),
        periodFrom,
        periodTo,
        chargeTypes: ['ELECTRICITY'],
        charges: [{
          type: 'ELECTRICITY',
          description: 'Electricity Bill',
          amount: 0,
          arrears: prevArrears,
          total: prevArrears
        }],
        subtotal: 0,
        totalArrears: prevArrears,
        grandTotal: prevArrears,
        calculationData: null
      });
    } catch (err) {
      console.error('Error fetching reading data:', err);
      // Try to use the property we have, or fetch it
      let propertyToUse = property;
      try {
        const propertyResponse = await fetchPropertyById(property._id);
        propertyToUse = propertyResponse.data?.data || property;
      } catch (fetchErr) {
        console.error('Error fetching property details:', fetchErr);
      }
      setInvoiceProperty(propertyToUse);
      
      // Get meter number from property as fallback
      const meterNo = propertyToUse.meterNumber || propertyToUse.electricityWaterMeterNo || '';
      setReadingData({ previousReading: 0, previousArrears: 0, meterNo });
      // Still initialize with defaults
      const now = dayjs();
      // Generate invoice number for Electricity
      const invoiceNumber = generateInvoiceNumber(
        propertyToUse.srNo,
        now.year(),
        now.month() + 1,
        'ELECTRICITY'
      );
      
      setInvoiceData({
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate: now.endOf('month').add(15, 'day').toDate(),
        periodFrom: now.startOf('month').toDate(),
        periodTo: now.endOf('month').toDate(),
        chargeTypes: ['ELECTRICITY'],
        charges: [{
          type: 'ELECTRICITY',
          description: 'Electricity Bill',
          amount: 0,
          arrears: 0,
          total: 0
        }],
        subtotal: 0,
        totalArrears: 0,
        grandTotal: 0,
        calculationData: null
      });
    } finally {
      setInvoiceLoading(false);
    }
  };

  // Handle units consumed input change - simple and direct approach
  const handleUnitsConsumedChange = (unitsValue) => {
    const units = parseFloat(unitsValue) || 0;
    
    // Calculate current reading from units consumed for display
    if (units >= 0 && readingData.previousReading !== undefined) {
      const calculatedCurrentReading = readingData.previousReading + units;
      setCurrentReading(String(calculatedCurrentReading));
    }
    
    // Set pending reading to units consumed for calculation
    if (unitsValue === '' || isNaN(units) || units < 0) {
      setPendingReading(null);
      if (invoiceData?.calculationData) {
        setInvoiceData(prev => prev ? { ...prev, calculationData: null } : null);
      }
      return;
    }
    
    // Use units consumed directly for calculation
    setPendingReading(units);
  };

  // Handle current reading input change (fallback for manual entry)
  const handleCurrentReadingChange = (value) => {
    setCurrentReading(value);
    
    const trimmedValue = value?.trim() || '';
    if (!trimmedValue) {
      setPendingReading(null);
      if (invoiceData?.calculationData) {
        setInvoiceData(prev => prev ? { ...prev, calculationData: null } : null);
      }
      return;
    }
    
    const reading = parseFloat(trimmedValue);
    
    if (isNaN(reading) || reading < 0) {
      setPendingReading(null);
      return;
    }
    
    if (reading < readingData.previousReading) {
      setPendingReading(null);
      if (invoiceData?.calculationData) {
        setInvoiceData(prev => prev ? { ...prev, calculationData: null } : null);
      }
      return;
    }
    
    // Calculate units consumed from current reading
    const unitsConsumed = Math.max(0, reading - readingData.previousReading);
    setPendingReading(unitsConsumed);
  };

  // Debounced calculation effect - now works with units consumed
  useEffect(() => {
    // Don't calculate if no pending reading (which now represents units consumed) or missing dependencies
    if (pendingReading === null || !invoiceProperty?._id) {
      return;
    }

    // Debounce timer
    const timeoutId = setTimeout(async () => {
      try {
        setCalculating(true);
        setInvoiceError('');
        
        // Send units consumed directly to backend (simplified approach)
        // Pass manual previous reading to ensure it's used in calculation
        const response = await getElectricityCalculation(
          invoiceProperty._id, 
          undefined, 
          undefined, 
          pendingReading,
          readingData.previousReading
        );
        
        if (!response.data?.success) {
          throw new Error('Calculation failed');
        }
        
        const calcData = response.data.data;
        
        // Update invoice data with calculated values using functional update
        setInvoiceData(prev => {
          if (!prev) return prev;
          
          const chargeIndex = prev.charges?.findIndex(c => c.type === 'ELECTRICITY') ?? -1;
          const updatedCharges = prev.charges ? [...prev.charges] : [{
            type: 'ELECTRICITY',
            description: 'Electricity Bill',
            amount: 0,
            arrears: calcData.previousArrears || 0,
            total: 0
          }];
          
          // Round the bill amount to nearest integer (0.5 rounds up)
          // Electricity Bill Amount = charges.withSurcharge (includes all electricity charges)
          const electricityBillAmount = Math.round(calcData.charges.withSurcharge || 0);
          // Arrears = previousArrears
          const arrears = calcData.previousArrears || 0;
          // Grand Total = Electricity Bill Amount + Arrears
          const grandTotal = Math.round(electricityBillAmount + arrears);
          
          if (chargeIndex >= 0) {
            updatedCharges[chargeIndex] = {
              ...updatedCharges[chargeIndex],
              amount: electricityBillAmount,
              arrears: arrears,
              total: grandTotal
            };
          } else {
            updatedCharges.push({
              type: 'ELECTRICITY',
              description: 'Electricity Bill',
              amount: electricityBillAmount,
              arrears: arrears,
              total: grandTotal
            });
          }
          
          return {
            ...prev,
            chargeTypes: ['ELECTRICITY'],
            charges: updatedCharges,
            subtotal: electricityBillAmount,
            totalArrears: arrears,
            grandTotal: grandTotal,
            calculationData: calcData
          };
        });
      } catch (err) {
        setInvoiceError(err.response?.data?.message || 'Failed to calculate charges');
        setInvoiceData(prev => prev ? { ...prev, calculationData: null } : null);
      } finally {
        setCalculating(false);
      }
    }, 600); // 600ms debounce delay

    // Cleanup function
    return () => {
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readingData.previousReading read inside timeout; omitting avoids extra debounce cycles
  }, [pendingReading, invoiceProperty?._id, invoiceData?.periodFrom]);

  // Debounced calculation effect for multiple meters
  useEffect(() => {
    const activeMeters = (invoiceProperty?.meters || []).filter(m => m.isActive !== false);
    const hasMultipleMeters = activeMeters.length > 1;
    
    if (!hasMultipleMeters || !invoiceProperty?._id || Object.keys(pendingMeterCalculations).length === 0) {
      return;
    }

    // Debounce timer
    const timeoutId = setTimeout(async () => {
      try {
        setCalculating(true);
        setInvoiceError('');
        
        // Process each meter that has a pending calculation (filter out null/undefined first)
        // pendingMeterCalculations now stores units consumed directly
        const validCalculations = Object.entries(pendingMeterCalculations)
          .filter(([_, unitsConsumed]) => unitsConsumed !== null && unitsConsumed !== undefined);
        
        if (validCalculations.length === 0) {
          setCalculating(false);
          return;
        }
        
        const meterCalculationPromises = validCalculations.map(async ([meterNo, unitsConsumed]) => {
          try {
            // Get previous reading for this specific meter
            const meterReading = meterReadings[meterNo] || {};
            
            // Pass periodFrom so arrears = only immediately previous invoice's balance
            const periodFromVal = invoiceData?.periodFrom ? (typeof invoiceData.periodFrom === 'string' ? invoiceData.periodFrom : invoiceData.periodFrom?.toISOString?.()?.slice(0, 10)) : undefined;
            const response = await getElectricityCalculation(
              invoiceProperty._id, 
              undefined, 
              meterNo, 
              unitsConsumed,
              meterReading.previousReading,
              periodFromVal
            );
            
            if (!response.data?.success) {
              throw new Error('Calculation failed');
            }

            return { meterNo, calcData: response.data.data };
          } catch (err) {
            console.error(`Error calculating for meter ${meterNo}:`, err);
            return null;
          }
        });

        const results = (await Promise.all(meterCalculationPromises)).filter(Boolean);
        
        // Update meterReadings with calculation data
        if (results.length > 0) {
          setMeterReadings(prev => {
            const updated = { ...prev };
            results.forEach(({ meterNo, calcData }) => {
              updated[meterNo] = {
                ...updated[meterNo],
                calculationData: calcData
              };
            });
            return updated;
          });
        }

        // Store calculations per meter - each meter has its own separate calculation
        // Don't aggregate - each meter will get its own invoice with its own amounts
        // We don't update invoiceData totals for multiple meters since each meter gets separate invoice

        // Clear pending calculations
        setPendingMeterCalculations({});
      } catch (err) {
        setInvoiceError(err.response?.data?.message || 'Failed to calculate charges');
      } finally {
        setCalculating(false);
      }
    }, 600); // 600ms debounce delay

    // Cleanup function
    return () => {
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invoiceProperty.meters / meterReadings read inside timeout
  }, [pendingMeterCalculations, invoiceProperty?._id, invoiceData?.periodFrom]);

  const handleInvoiceFieldChange = (field, value) => {
    if (!invoiceData) return;
    
    if (field.startsWith('charge.')) {
      const [, chargeIndex, chargeField] = field.split('.');
      const updatedCharges = [...invoiceData.charges];
      let fieldValue = value;
      
      // Apply rounding to amount field for electricity charges
      if (chargeField === 'amount') {
        const numValue = Number(value) || 0;
        fieldValue = Math.round(numValue); // Round to nearest integer
      } else if (chargeField === 'arrears') {
        fieldValue = Number(value) || 0;
      } else {
        fieldValue = value;
      }
      
      updatedCharges[chargeIndex] = {
        ...updatedCharges[chargeIndex],
        [chargeField]: fieldValue
      };
      
      // Recalculate totals - only include ELECTRICITY charges
      const electricityCharges = updatedCharges.filter(c => c.type === 'ELECTRICITY');
      const subtotal = electricityCharges.reduce((sum, charge) => sum + (charge.amount || 0), 0);
      const totalArrears = electricityCharges.reduce((sum, charge) => sum + (charge.arrears || 0), 0);
      // Round grand total to nearest integer
      const grandTotal = Math.round(subtotal + totalArrears);
      
      setInvoiceData({
        ...invoiceData,
        charges: updatedCharges,
        subtotal,
        totalArrears,
        grandTotal
      });
    } else {
      // Use functional update to avoid stale state issues
      setInvoiceData(prevData => {
        if (!prevData) return prevData;
        
        // For date fields, parse with dayjs to avoid timezone issues
        let fieldValue;
        if (field === 'periodFrom' || field === 'periodTo' || field === 'dueDate' || field === 'invoiceDate') {
          fieldValue = value ? dayjs(value).toDate() : null;
        } else if (field === 'grandTotal' || field === 'subtotal' || field === 'totalArrears') {
          fieldValue = Number(value) || 0;
        } else {
          fieldValue = value;
        }
        
        const updatedData = {
          ...prevData,
          [field]: fieldValue
        };
        
        // Regenerate invoice number if period changes (for new invoices only)
        if ((field === 'periodFrom' || field === 'periodTo') && !prevData._id && invoiceProperty) {
          const periodDate = field === 'periodFrom' 
            ? (fieldValue ? dayjs(fieldValue) : dayjs(value))
            : (updatedData.periodTo ? dayjs(updatedData.periodTo) : dayjs(value));
          const newInvoiceNumber = generateInvoiceNumber(
            invoiceProperty.srNo,
            periodDate.year(),
            periodDate.month() + 1,
            'ELECTRICITY'
          );
          updatedData.invoiceNumber = newInvoiceNumber;
        }
        
        return updatedData;
      });
    }
  };

  const handleSaveInvoice = async () => {
    // If viewing existing invoice, update it
    if (invoiceData?._id) {
      if (!invoiceData) {
        setInvoiceError('Invoice data is incomplete');
        return;
      }

      try {
        setInvoiceLoading(true);
        setInvoiceError('');
        
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
        
        if (invoiceProperty?._id) {
          const invoiceResponse = await fetchInvoicesForProperty(invoiceProperty._id);
          setPropertyInvoices(prev => ({ ...prev, [invoiceProperty._id]: invoiceResponse.data?.data || [] }));
        }
        
        setTimeout(() => {
          handleCloseInvoiceDialog();
        }, 1500);
      } catch (err) {
        setInvoiceError(err.response?.data?.message || 'Failed to update invoice');
      } finally {
        setInvoiceLoading(false);
      }
      return;
    }

    // Create new invoice
    if (!invoiceProperty || !invoiceData) {
      setInvoiceError('Invoice data is incomplete');
      return;
    }

    // Check if property has multiple meters
    const activeMeters = (invoiceProperty.meters || []).filter(m => m.isActive !== false);
    const hasMultipleMeters = activeMeters.length > 1;

    // Validate readings for multiple meters
    if (hasMultipleMeters) {
      for (const meter of activeMeters) {
        const meterNo = String(meter.meterNo || '');
        const meterReading = meterReadings[meterNo];
        if (meterReading && meterReading.currentReading) {
          const current = parseFloat(meterReading.currentReading);
          const previous = meterReading.previousReading || 0;
          if (current < previous) {
            setInvoiceError(`Current reading (${current}) for meter ${meterNo} cannot be less than previous reading (${previous})`);
            return;
          }
        }
      }
    } else {
      // Validate current reading for single meter
    if (currentReading && parseFloat(currentReading) < readingData.previousReading) {
      setInvoiceError('Current reading cannot be less than previous reading');
      return;
      }
    }

    try {
      setInvoiceLoading(true);
      setInvoiceError('');
      
      // Prepare meter readings object for backend
      let meterReadingsPayload = {};
      if (hasMultipleMeters) {
        activeMeters.forEach(meter => {
          const meterNo = String(meter.meterNo || '');
          const meterReading = meterReadings[meterNo];
          if (meterReading) {
            meterReadingsPayload[meterNo] = {
              currentReading: meterReading.currentReading ? parseFloat(meterReading.currentReading) : undefined,
              previousReading: meterReading.previousReading !== undefined ? parseFloat(meterReading.previousReading) : undefined
            };
          }
        });
      }
      
      // ALWAYS send charges when we have calculated them (from units consumed calculation)
      // Backend will use these charges instead of recalculating
      const hasCalculatedCharges = invoiceData.charges && invoiceData.charges.length > 0 && invoiceData.charges.some(c => c.type === 'ELECTRICITY' && c.amount > 0);
      
      const response = await createInvoice(invoiceProperty._id, {
        includeCAM: false,
        includeElectricity: true,
        includeRent: false,
        invoiceDate: invoiceData.invoiceDate ? (invoiceData.invoiceDate instanceof Date ? invoiceData.invoiceDate : new Date(invoiceData.invoiceDate)) : new Date(),
        currentReading: hasMultipleMeters ? undefined : (currentReading ? parseFloat(currentReading) : undefined),
        meterReadings: hasMultipleMeters && Object.keys(meterReadingsPayload).length > 0 ? meterReadingsPayload : undefined,
        periodFrom: invoiceData.periodFrom,
        periodTo: invoiceData.periodTo,
        dueDate: invoiceData.dueDate,
        // Always send charges if we have calculated them (prioritize frontend calculation from units consumed)
        charges: hasCalculatedCharges ? (invoiceData.charges || []) : undefined,
        // Send full calculation data to backend so it can store the breakdown
        calculationData: invoiceData.calculationData
      });

      const savedInvoice = response.data?.data || invoiceData;
      setInvoiceData(savedInvoice);
      // Update meter number if available from response
      const meterNo = savedInvoice?.electricityBill?.meterNo || 
                      savedInvoice?.property?.meterNumber || 
                      savedInvoice?.property?.electricityWaterMeterNo || 
                      readingData.meterNo;
      if (meterNo) {
        setReadingData(prev => ({ ...prev, meterNo }));
      }
      setSuccess('Invoice created successfully');
      setInvoiceWasSaved(true); // Mark as saved
      
      if (invoiceProperty?._id) {
        const invoiceResponse = await fetchInvoicesForProperty(invoiceProperty._id);
        setPropertyInvoices(prev => ({ ...prev, [invoiceProperty._id]: invoiceResponse.data?.data || [] }));
      }
      
      setTimeout(() => {
        handleCloseInvoiceDialog();
      }, 1500);
    } catch (err) {
      setInvoiceError(err.response?.data?.message || 'Failed to create invoice');
    } finally {
      setInvoiceLoading(false);
    }
  };

  const handleCloseInvoiceDialog = () => {
    // Only close if invoice was saved or if it's an existing invoice being viewed
    // If it's a new invoice that wasn't saved, don't do anything that might trigger creation
    setInvoiceDialogOpen(false);
    setInvoiceProperty(null);
    setInvoiceData(null);
    setInvoiceError('');
    setCurrentReading('');
    setPendingReading(null);
    setReadingData({ previousReading: 0, previousArrears: 0, meterNo: '' });
    setMeterReadings({});
    setInvoiceWasSaved(false); // Reset saved flag
  };

  const generateElectricityVoucherPDF = async (propertyParam = null, invoiceParam = null, options = {}) => {
    let invoice = invoiceParam || invoiceData;
    let property = invoice?.property || propertyParam || invoiceProperty;
    
    if (!invoice) return;

    // Fetch full invoice (with latest arrears, payments, etc.) so Electricity PDF
    // matches the Invoices page and uses the same business logic.
    try {
      const fullInvoiceResponse = await fetchInvoice(invoice._id);
      if (fullInvoiceResponse?.data?.data) {
        invoice = fullInvoiceResponse.data.data;
        property = invoice.property || property;
      }
    } catch (e) {
      // If fetch fails, fall back to the original invoice object.
      // We still generate a PDF, just without enriched data.
    }
    
    if (!property || !invoice) return;
    
    return await generateElectricityInvoicePDFUtil(invoice, property, options);
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
    await generateElectricityVoucherPDF();
  };

  const generatePaymentReceiptPDF = async (invoice, payment, propertyParam) => {
    let property = invoice?.property || propertyParam;
    
    if (!property) return;
    
    // Fetch full property details if areaValue/areaUnit are missing or null/undefined
    const hasAreaValue = (property.areaValue !== undefined && property.areaValue !== null && property.areaValue !== '') ||
                         (invoice?.property?.areaValue !== undefined && invoice?.property?.areaValue !== null && invoice?.property?.areaValue !== '');
    const hasAreaUnit = (property.areaUnit !== undefined && property.areaUnit !== null && property.areaUnit !== '') ||
                        (invoice?.property?.areaUnit !== undefined && invoice?.property?.areaUnit !== null && invoice?.property?.areaUnit !== '');
    
    const needsFetch = !hasAreaValue && !hasAreaUnit;
    const propertyId = property._id || property.id || (typeof property === 'string' ? property : null);
    
    if (needsFetch && propertyId) {
      try {
        const propertyResponse = await fetchPropertyById(propertyId);
        if (propertyResponse?.data?.data) {
          property = { ...property, ...propertyResponse.data.data };
        }
      } catch (err) {
        // Silently fail - will use fallback values
      }
    }
    
    // Constants
    const CONSTANTS = {
      COPIES: ['Bank Copy', 'Office Copy', 'Client Copy'],
      MARGIN_X: 6,
      TOP_MARGIN: 10,
      FOOTER_NOTES: [
        '1. The above mentioned charges are calculated based on proportionate share of user in total cost of electricity of the Project and do not include any profit element of Taj Residencia.',
        '2. Please make your cheque/bank draft/cash deposit on our specified deposit slip at any Allied Bank Ltd. branch in Pakistan to Account Title: Taj Residencia, Allied Bank Limited, The Centaurus Mall Branch, Islamabad (0917). Bank Account No.: PK68ABPA0010035700420129.',
        '3. Please deposit your bills before due date to avoid Late Payment Surcharge.',
        '4. Please share proof of payment to TAJ Official WhatsApp No.: 0345 77 68 442.'
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
    const formatRate = (value) => (Number(value) || 0).toFixed(2);

    // Initialize PDF
    const pdf = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const panelWidth = pageWidth / 3;
    const availableWidth = panelWidth - CONSTANTS.MARGIN_X * 2;
    const panelCenterX = (panelWidth - CONSTANTS.MARGIN_X * 2) / 2;

    // Extract data
    const electricityCharge = invoice.charges?.find(c => c.type === 'ELECTRICITY');
    const electricityBill = invoice.electricityBill || {};
    
    // Calculate month label once
    const monthLabel = (invoice.periodTo || invoice.periodFrom)
      ? dayjs(invoice.periodTo || invoice.periodFrom).format('MMM-YY').toUpperCase()
      : (electricityBill.month?.toUpperCase() || dayjs().format('MMM-YY').toUpperCase());

    // Calculate invoice values
    const meterNo = electricityBill.meterNo || property.electricityWaterMeterNo || '—';
    // Fetch floor from meters array based on meterNo
    const matchedMeter = property.meters?.find(m => String(m.meterNo) === String(meterNo) && m.isActive !== false);
    const floor = matchedMeter?.floor || property.floor || '—';
    
    // Calculate property size - use property (which may have been updated after fetch) or invoice.property as fallback
    const sourceProperty = (property.areaValue !== undefined && property.areaValue !== null && property.areaValue !== '') 
      ? property 
      : (invoice?.property?.areaValue !== undefined && invoice?.property?.areaValue !== null && invoice?.property?.areaValue !== ''
          ? invoice.property 
          : property);
    
    let propertySize = '—';
    const areaValue = sourceProperty.areaValue;
    const areaUnit = sourceProperty.areaUnit;
    
    if (areaValue !== undefined && areaValue !== null && areaValue !== '') {
      const valueStr = String(areaValue).trim();
      const unitStr = areaUnit ? String(areaUnit).trim() : '';
      propertySize = valueStr ? `${valueStr}${unitStr ? ' ' + unitStr : ''}`.trim() : '—';
    }
    
    const invoiceData = {
      meterNo: meterNo,
      clientName: property.ownerName || property.tenantName || '—',
      sector: property.sector || '—',
      floor: floor,
      address: electricityBill.address || property.address || '—',
      propertySize: propertySize,
      invoiceNumber: invoice.invoiceNumber || '—',
      periodFrom: formatDate(invoice.periodFrom || electricityBill.fromDate),
      periodTo: formatDate(invoice.periodTo || electricityBill.toDate),
      readingDate: formatFullDate(invoice.periodTo || electricityBill.toDate),
      dueDate: formatFullDate(invoice.dueDate || electricityBill.dueDate),
      unitsConsumed: electricityBill.unitsConsumed || 0,
      unitsCharged: electricityBill.unitsConsumedForDays || electricityBill.unitsConsumed || 0
    };

    // Calculate amounts
    const totalBill = electricityCharge?.amount ?? electricityBill.totalBill ?? electricityBill.amount ?? 0;
    const arrears = electricityCharge?.arrears ?? electricityBill.arrears ?? 0;
    const amountReceived = electricityBill.receivedAmount || 0;
    const payableWithinDueDate = totalBill + arrears - amountReceived;
    const latePaymentSurcharge = Math.max(Math.round(payableWithinDueDate * 0.1), 0);
    const payableAfterDueDate = payableWithinDueDate + latePaymentSurcharge;

    // Calculate payment status
    const totalPaid = invoice.totalPaid || 0;
    const grandTotal = invoice.grandTotal || (totalBill + arrears);
    const balance = invoice.balance || (grandTotal - totalPaid);
    const isPaid = balance <= 0 && totalPaid > 0;
    const isPartiallyPaid = totalPaid > 0 && balance > 0;
    const paymentStatus = isPaid ? 'PAID' : isPartiallyPaid ? 'PARTIALLY PAID' : 'UNPAID';
    const paymentStatusColor = isPaid ? CONSTANTS.COLORS.GREEN : 
                              isPartiallyPaid ? CONSTANTS.COLORS.ORANGE : CONSTANTS.COLORS.RED;

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

    const drawInlineField = (label, value, startX, startY, labelWidth = 30, fontSize = 7) => {
      const valueWidth = availableWidth - labelWidth;
      setTextStyle('helvetica', 'bold', fontSize);
      pdf.text(label, startX, startY);
      setTextStyle('helvetica', 'normal', fontSize);
      const lines = pdf.splitTextToSize(String(value || '—'), valueWidth);
      lines.forEach((line, idx) => {
        pdf.text(line, startX + labelWidth, startY + idx * 4);
      });
      return startY + lines.length * 4 + 1;
    };

    const drawMeterTable = (startX, startY) => {
      const headers = ['Meter No.', 'Previous', 'Present', 'Unit Consumed', 'IESCO SLAB'];
      const values = [
        invoiceData.meterNo,
        formatAmount(electricityBill.prvReading),
        formatAmount(electricityBill.curReading),
        formatAmount(invoiceData.unitsConsumed),
        electricityBill.iescoSlabs || '—'
      ];
      const cellWidth = availableWidth / headers.length;
      const headerHeight = 5;
      const valueHeight = 6;
      
      headers.forEach((header, idx) => {
        const cellX = startX + idx * cellWidth;
        pdf.rect(cellX, startY, cellWidth, headerHeight);
        setTextStyle('helvetica', 'bold', 5);
        pdf.text(header, cellX + cellWidth / 2, startY + headerHeight - 1.2, { align: 'center' });
      });
      
      values.forEach((value, idx) => {
        const cellX = startX + idx * cellWidth;
        pdf.rect(cellX, startY + headerHeight, cellWidth, valueHeight);
        setTextStyle('helvetica', 'normal', 5.5);
        pdf.text(String(value || '—'), cellX + cellWidth / 2, startY + headerHeight + valueHeight - 1.2, { align: 'center' });
      });
      
      return startY + headerHeight + valueHeight;
    };

    const drawComputationTable = (startX, startY) => {
      const rows = [
        { label: 'Unit price', value: formatRate(electricityBill.iescoUnitPrice || 0), bold: false },
        { label: 'Share of IESCO Supply Cost Rate', value: formatAmount(electricityBill.electricityCost || 0), bold: false },
        { label: 'FC Surcharge', value: formatAmount(electricityBill.fcSurcharge || 0), bold: false },
        { label: 'Sales Tax', value: formatAmount(electricityBill.gst || 0), bold: false },
        { label: 'Electricity Duty', value: formatAmount(electricityBill.electricityDuty || 0), bold: false },
        { label: 'Fixed Charges', value: formatAmount(electricityBill.fixedCharges || 0), bold: false },
        { label: 'Charges for the Month', value: formatAmount(totalBill), bold: false },
        { label: `Amount Received in ${monthLabel.replace('-', ' ')}`, value: formatAmount(amountReceived ? -amountReceived : 0), bold: false },
        { label: 'Payable Within Due Date', value: formatAmount(payableWithinDueDate), bold: true },
        { label: 'Late Payment Surcharge', value: formatAmount(latePaymentSurcharge), bold: false },
        { label: 'Payable After Due Date', value: formatAmount(payableAfterDueDate), bold: true }
      ];

      const rowHeight = 6;
      setTextStyle('helvetica', 'normal', 7);
      
      rows.forEach((row, idx) => {
        const y = startY + idx * rowHeight;
        setTextStyle('helvetica', row.bold ? 'bold' : 'normal', 7);
        pdf.text(row.label, startX, y + 4);
        pdf.text(String(row.value), startX + availableWidth, y + 4, { align: 'right' });
        pdf.line(startX, y + rowHeight, startX + availableWidth, y + rowHeight);
      });

      return startY + rows.length * rowHeight;
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
      setTextStyle('helvetica', 'bold', 11);
      pdf.setTextColor(...CONSTANTS.COLORS.RED);
      pdf.text(`Taj Electricity Billing For The Month Of ${monthLabel}`, startX + panelCenterX, cursorY, { align: 'center' });
      pdf.setTextColor(...CONSTANTS.COLORS.BLACK);
      cursorY += 6;

      setTextStyle('helvetica', 'bold', 9);
      pdf.text('Invoice of Electricity Charges', startX + panelCenterX, cursorY, { align: 'center' });
      cursorY += 6;

      // Invoice fields
      const inlineFields = [
        ['Resident ID', property.resident?.residentId || property.residentId || '—'],
        ['Meter ID', invoiceData.meterNo],
        ['Client', invoiceData.clientName],
        ['Sector', invoiceData.sector],
        ['Floor', invoiceData.floor],
        ['Address', invoiceData.address],
        ['Size', invoiceData.propertySize],
        ['Account No.', 'PK68ABPA0010035700420129'],
        ['Period From', invoiceData.periodFrom],
        ['Period To', invoiceData.periodTo],
        ['Invoice No.', invoiceData.invoiceNumber],
        ['Reading Date', invoiceData.readingDate],
        ['Due Date', invoiceData.dueDate]
      ];
      
      inlineFields.forEach(([label, value]) => {
        // Use smaller font for Sector
        const fontSize = label === 'Sector' ? 6 : 7;
        cursorY = drawInlineField(label, value, startX, cursorY, 30, fontSize);
      });
      cursorY += 2;

      // Meter Reading Table
      setTextStyle('helvetica', 'bold', 8);
      pdf.text('IESCO Meter Reading', startX, cursorY);
      cursorY = drawMeterTable(startX - 2, cursorY + 2) + 4;
      
      // Bill Computation Table
      setTextStyle('helvetica', 'bold', 8);
      pdf.text('Bill Computation', startX, cursorY);
      cursorY = drawComputationTable(startX, cursorY + 3) + 4;

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
    const sanitizedName = (property.propertyName || property.plotNumber || property.srNo || 'property')
      .toString().replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '_');
    const receiptDate = dayjs(payment.paymentDate).format('YYYY-MM-DD');
    pdf.save(`Payment_Receipt_${sanitizedName}_${receiptDate}.pdf`);
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

  const handleElectricityPaymentMethodChange = (value) => {
    setPaymentForm((prev) => ({
      ...prev,
      paymentMethod: value,
      bankName: value === 'Cash' ? '' : prev.bankName
    }));
  };

  const handleElectricityAttachmentChange = (event) => {
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

      const formData = new FormData();
      Object.entries(paymentForm).forEach(([key, value]) => {
        formData.append(key, value ?? '');
      });
      if (paymentAttachment) {
        formData.append('attachment', paymentAttachment);
      }

      await addPaymentToPropertyElectricity(selectedProperty._id, formData);
      setSuccess('Payment recorded successfully');
      handleClosePaymentDialog();
      loadProperties();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record payment');
    }
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
          <title>Electricity Bill - ${viewingCharge.invoiceNumber || 'N/A'}</title>
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
            .charges-table {
              width: 100%;
              border-collapse: collapse;
              margin: 10px 0;
            }
            .charges-table th, .charges-table td {
              border: 1px solid #ddd;
              padding: 8px;
              text-align: left;
            }
            .charges-table th {
              background-color: #f0f0f0;
              font-weight: bold;
            }
            .total-row {
              font-weight: bold;
              background-color: #f9f9f9;
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
            <h1>Electricity Bill</h1>
            <p><strong>Invoice Number:</strong> ${viewingCharge.invoiceNumber || 'N/A'}</p>
            <p><strong>Serial Number:</strong> ${viewingCharge.serialNumber || 'N/A'}</p>
          </div>

          <div class="section">
            <div class="section-title">Meter & Reading Details</div>
            <div class="field-row">
              <div class="field-label">Meter Number:</div>
              <div class="field-value">${viewingCharge.meterNo || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Property Type:</div>
              <div class="field-value">${viewingCharge.propertyType || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Previous Reading:</div>
              <div class="field-value">${viewingCharge.prvReading || 0}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Current Reading:</div>
              <div class="field-value">${viewingCharge.curReading || 0}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Units Consumed:</div>
              <div class="field-value">${viewingCharge.unitsConsumed || 0}</div>
            </div>
            <div class="field-row">
              <div class="field-label">IESCO Slabs:</div>
              <div class="field-value">${viewingCharge.iescoSlabs || 'N/A'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Billing Period</div>
            <div class="field-row">
              <div class="field-label">From Date:</div>
              <div class="field-value">${viewingCharge.fromDate ? dayjs(viewingCharge.fromDate).format('DD-MMM-YYYY') : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">To Date:</div>
              <div class="field-value">${viewingCharge.toDate ? dayjs(viewingCharge.toDate).format('DD-MMM-YYYY') : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Month:</div>
              <div class="field-value">${viewingCharge.month || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Due Date:</div>
              <div class="field-value">${viewingCharge.dueDate ? dayjs(viewingCharge.dueDate).format('DD-MMM-YYYY') : 'N/A'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Charges Breakdown</div>
            <table class="charges-table">
              <tr>
                <th>Description</th>
                <th style="text-align: right;">Amount (PKR)</th>
              </tr>
              <tr>
                <td>IESCO Unit Price</td>
                <td style="text-align: right;">${formatUnitPrice(viewingCharge.iescoUnitPrice || 0)}</td>
              </tr>
              <tr>
                <td>Electricity Cost</td>
                <td style="text-align: right;">${formatCurrency(viewingCharge.electricityCost || 0)}</td>
              </tr>
              <tr>
                <td>F.C Surcharge (3.2 × Units)</td>
                <td style="text-align: right;">${formatCurrency(viewingCharge.fcSurcharge || 0)}</td>
              </tr>
              <tr>
                <td>Fixed Charges</td>
                <td style="text-align: right;">${formatCurrency(viewingCharge.fixedCharges || 0)}</td>
              </tr>
              <tr>
                <td>GST (18%)</td>
                <td style="text-align: right;">${formatCurrency(viewingCharge.gst || 0)}</td>
              </tr>
              <tr>
                <td>Electricity Duty (1.5%)</td>
                <td style="text-align: right;">${formatCurrency(viewingCharge.electricityDuty || 0)}</td>
              </tr>
              <tr class="total-row">
                <td><strong>Total Bill</strong></td>
                <td style="text-align: right;"><strong>${formatCurrency(viewingCharge.totalBill || 0)}</strong></td>
              </tr>
            </table>
          </div>

          <div class="section">
            <div class="section-title">Financial Summary</div>
            <div class="field-row">
              <div class="field-label">Total Bill:</div>
              <div class="field-value"><strong>${formatCurrency(viewingCharge.totalBill || 0)}</strong></div>
            </div>
            <div class="field-row">
              <div class="field-label">Received Amount:</div>
              <div class="field-value">${formatCurrency(viewingCharge.receivedAmount || 0)}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Balance:</div>
              <div class="field-value">${formatCurrency(viewingCharge.balance || 0)}</div>
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

          <div class="section">
            <div class="section-title">Property & Owner Information</div>
            <div class="field-row">
              <div class="field-label">Owner:</div>
              <div class="field-value">${viewingCharge.owner || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Contact Number:</div>
              <div class="field-value">${viewingCharge.contactNo || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Address:</div>
              <div class="field-value">${viewingCharge.address || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Plot No:</div>
              <div class="field-value">${viewingCharge.plotNo || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Sector:</div>
              <div class="field-value">${viewingCharge.sector || 'N/A'}</div>
            </div>
          </div>

          <div class="footer">
            <p><strong>Generated from SGC ERP System - Taj Utilities Electricity Bills</strong></p>
            <p>Bill ID: ${viewingCharge._id || 'N/A'} | Printed: ${printDate}</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(brandPrintHtml(printContent, { title: 'Electricity Bill' })); // Tovus ERP branded print
    printWindow.document.close();

    printWindow.onload = function() {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
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
    pdf.text('Electricity Bill', pageWidth / 2, yPos, { align: 'center' });
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

    // Meter & Reading Details
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Meter & Reading Details', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Meter Number:', leftMargin, yPos);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(viewingCharge.meterNo || 'N/A'), leftMargin + 35, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Property Type:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(String(viewingCharge.propertyType || 'N/A'), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.text('Previous Reading:', leftMargin, yPos);
    pdf.text(String(viewingCharge.prvReading || 0), leftMargin + 40, yPos);
    pdf.text('Current Reading:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(String(viewingCharge.curReading || 0), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.text('Units Consumed:', leftMargin, yPos);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(viewingCharge.unitsConsumed || 0), leftMargin + 35, yPos);
    pdf.setFont('helvetica', 'normal');
    pdf.text('IESCO Slabs:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(String(viewingCharge.iescoSlabs || 'N/A'), rightMargin, yPos, { align: 'right' });
    yPos += 8;

    // Billing Period
    checkNewPage(15);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Billing Period', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('From Date:', leftMargin, yPos);
    pdf.text(viewingCharge.fromDate ? dayjs(viewingCharge.fromDate).format('DD-MMM-YYYY') : 'N/A', leftMargin + 30, yPos);
    pdf.text('To Date:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(viewingCharge.toDate ? dayjs(viewingCharge.toDate).format('DD-MMM-YYYY') : 'N/A', rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.text('Month:', leftMargin, yPos);
    pdf.text(String(viewingCharge.month || 'N/A'), leftMargin + 25, yPos);
    pdf.text('Due Date:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(viewingCharge.dueDate ? dayjs(viewingCharge.dueDate).format('DD-MMM-YYYY') : 'N/A', rightMargin, yPos, { align: 'right' });
    yPos += 8;

    // Charges Breakdown
    checkNewPage(40);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Charges Breakdown', leftMargin, yPos);
    yPos += 6;
    
    // Table header
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.rect(leftMargin, yPos - 4, pageWidth - 2 * margin, 5);
    pdf.text('Description', leftMargin + 2, yPos);
    pdf.text('Amount (PKR)', rightMargin - 2, yPos, { align: 'right' });
    yPos += 6;
    
    // Charges rows
    pdf.setFont('helvetica', 'normal');
    const charges = [
      ['IESCO Unit Price', formatUnitPrice(viewingCharge.iescoUnitPrice || 0)],
      ['Electricity Cost', formatCurrency(viewingCharge.electricityCost || 0)],
      ['F.C Surcharge (3.2 × Units)', formatCurrency(viewingCharge.fcSurcharge || 0)],
      ['Fixed Charges', formatCurrency(viewingCharge.fixedCharges || 0)],
      ['GST (18%)', formatCurrency(viewingCharge.gst || 0)],
      ['Electricity Duty (1.5%)', formatCurrency(viewingCharge.electricityDuty || 0)]
    ];
    
    charges.forEach(([desc, amount]) => {
      checkNewPage(6);
      pdf.rect(leftMargin, yPos - 4, pageWidth - 2 * margin, 5);
      pdf.text(String(desc), leftMargin + 2, yPos);
      pdf.text(String(amount), rightMargin - 2, yPos, { align: 'right' });
      yPos += 6;
    });
    
    // Total row
    checkNewPage(6);
    pdf.setFont('helvetica', 'bold');
    pdf.rect(leftMargin, yPos - 4, pageWidth - 2 * margin, 5);
    pdf.text('Total Bill', leftMargin + 2, yPos);
    pdf.text(String(formatCurrency(viewingCharge.totalBill || 0)), rightMargin - 2, yPos, { align: 'right' });
    yPos += 8;

    // Financial Summary
    checkNewPage(25);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Financial Summary', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Total Bill:', leftMargin, yPos);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(formatCurrency(viewingCharge.totalBill || 0)), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.setFont('helvetica', 'normal');
    pdf.text('Received Amount:', leftMargin, yPos);
    pdf.text(String(formatCurrency(viewingCharge.receivedAmount || 0)), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
    pdf.text('Balance:', leftMargin, yPos);
    pdf.text(String(formatCurrency(viewingCharge.balance || 0)), rightMargin, yPos, { align: 'right' });
    yPos += 5;
    
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

    // Property Information
    checkNewPage(20);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Property & Owner Information', leftMargin, yPos);
    yPos += 6;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Owner:', leftMargin, yPos);
    pdf.text(String(viewingCharge.owner || 'N/A'), leftMargin + 25, yPos);
    yPos += 5;
    
    pdf.text('Contact Number:', leftMargin, yPos);
    pdf.text(String(viewingCharge.contactNo || 'N/A'), leftMargin + 40, yPos);
    yPos += 5;
    
    pdf.text('Address:', leftMargin, yPos);
    const addressLines = pdf.splitTextToSize(String(viewingCharge.address || 'N/A'), pageWidth - 2 * margin - 30);
    pdf.text(String(addressLines[0]), leftMargin + 30, yPos);
    if (addressLines.length > 1) {
      yPos += 5;
      pdf.text(String(addressLines[1]), leftMargin + 30, yPos);
    }
    yPos += 5;
    
    pdf.text('Plot No:', leftMargin, yPos);
    pdf.text(String(viewingCharge.plotNo || 'N/A'), leftMargin + 25, yPos);
    pdf.text('Sector:', rightMargin - 30, yPos, { align: 'right' });
    pdf.text(String(viewingCharge.sector || 'N/A'), rightMargin, yPos, { align: 'right' });

    // Footer
    yPos = pageHeight - 15;
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Generated from SGC ERP System - Taj Utilities Electricity Bills', pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;
    pdf.text(`Bill ID: ${viewingCharge._id || 'N/A'} | Generated: ${new Date().toLocaleString()}`, pageWidth / 2, yPos, { align: 'center' });

    pdf.save(`Electricity-Bill-${viewingCharge.invoiceNumber || 'INV'}.pdf`);
  };

  const handleOpenDialog = (charge) => {
    if (charge) {
      setEditingCharge(charge);
      setFormData({
        invoiceNumber: charge.invoiceNumber || '',
        plotNo: charge.plotNo || '',
        rdaNo: charge.rdaNo || '',
        street: charge.street || '',
        sector: charge.sector || '',
        category: charge.category || '',
        address: charge.address || '',
        project: charge.project || '',
        owner: charge.owner || '',
        contactNo: charge.contactNo || '',
        status: charge.status || 'Active',
        fileSubmission: charge.fileSubmission ? dayjs(charge.fileSubmission).format('YYYY-MM-DD') : '',
        demarcationDate: charge.demarcationDate ? dayjs(charge.demarcationDate).format('YYYY-MM-DD') : '',
        constructionDate: charge.constructionDate ? dayjs(charge.constructionDate).format('YYYY-MM-DD') : '',
        familyStatus: charge.familyStatus || '',
        arrears: charge.arrears || 0,
        amount: charge.amount || 0,
        amountInWords: charge.amountInWords || ''
      });
    } else {
      setEditingCharge(null);
      setFormData(defaultForm);
    }
    setDialogOpen(true);
    setError('');
    setSuccess('');
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCharge(null);
    setFormData(defaultForm);
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
        await updateElectricity(editingCharge._id, payload);
        setSuccess('Electricity Bill updated successfully');
      } else {
        await createElectricity(payload);
        setSuccess('Electricity Bill created successfully');
      }
      handleCloseDialog();
      loadCharges();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to save Electricity Bill');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Taj Utilities — Electricity Bills
          </Typography>
          <Typography color="text.secondary">
            Manage Electricity bills for properties.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            placeholder="Search by property, owner, meter number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Tooltip title="Refresh">
            <IconButton onClick={loadCharges} disabled={loading}>
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
        <StatCard title="Total Electricity Amount" value={formatCurrency(totalCounts.totalAmount)} />
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
                  <TableCell>Meters</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Electricity Amount</TableCell>
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
                      <TableCell><Skeleton variant="rectangular" width={60} height={24} /></TableCell>
                      <TableCell>
                        <Skeleton variant="text" width="70%" />
                        <Skeleton variant="text" width="90%" height={20} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width="60%" />
                        <Skeleton variant="text" width={100} height={20} />
                      </TableCell>
                      <TableCell><Skeleton variant="rectangular" width={80} height={24} /></TableCell>
                      <TableCell align="right">
                        <Skeleton variant="text" width={80} />
                        <Skeleton variant="text" width={100} height={20} />
                      </TableCell>
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
                        <TableCell>{property.srNo || '—'}</TableCell>
                        <TableCell>
                          <Box>
                            <Typography variant="subtitle2" fontWeight={600}>
                              {property.propertyName || property.propertyType || '—'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {property.plotNumber || '—'} / {property.rdaNumber || '—'}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const metersArray = Array.isArray(property.meters) ? property.meters : [];
                            const activeMetersCount = metersArray.filter(m => m && m.isActive !== false).length || 0;
                            const totalMetersCount = metersArray.length || 0;
                            
                            return totalMetersCount > 0 ? (
                              <Chip 
                                label={`${activeMetersCount}${totalMetersCount !== activeMetersCount ? `/${totalMetersCount}` : ''}`}
                                size="small"
                                color={activeMetersCount > 0 ? "primary" : "default"}
                                variant={activeMetersCount > 0 ? "filled" : "outlined"}
                              />
                            ) : (
                              <Typography variant="body2" color="text.secondary">0</Typography>
                            );
                          })()}
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
                            {formatCurrency(property.electricityAmount || 0)}
                          </Typography>
                          {property.electricityArrears > 0 && (
                            <Typography variant="caption" color="error.main" display="block">
                              Arrears: {formatCurrency(property.electricityArrears || 0)}
                            </Typography>
                          )}
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
                              ) : propertyInvoices[property._id] && propertyInvoices[property._id].filter(inv => inv.chargeTypes?.includes('ELECTRICITY')).length > 0 ? (
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
                                      .filter(inv => inv.chargeTypes?.includes('ELECTRICITY'))
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
                                        <TableCell align="right">{formatCurrency(getAdjustedBalance(invoice))}</TableCell>
                                        <TableCell>
                                          {(() => {
                                            const adjustedBalance = getAdjustedBalance(invoice);
                                            const totalPaid = invoice.totalPaid || 0;
                                            const displayStatus = adjustedBalance <= 0 ? 'paid' : totalPaid > 0 ? 'partial_paid' : 'unpaid';
                                            const { color, label } = getPaymentStatusConfig(displayStatus);
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
                                                  await generateElectricityVoucherPDF(property, invoice, { openInNewTab: true });
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
                                                onClick={async () => await generateElectricityVoucherPDF(property, invoice)}
                                              >
                                                <DownloadIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Delete Invoice">
                                              <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => handleDeleteInvoice(invoice._id, property._id)}
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
                                                      <TableCell>Actions</TableCell>
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
                                                        <TableCell>
                                                          <Stack direction="row" spacing={1}>
                                                            {payment.attachmentUrl && (
                                                              <Tooltip title="View Attachment">
                                                                <IconButton
                                                                  size="small"
                                                                  color="primary"
                                                                  onClick={() => {
                                                                    const attachmentUrl = getImageUrl(payment.attachmentUrl);
                                                                    window.open(attachmentUrl, '_blank');
                                                                  }}
                                                                >
                                                                  <ViewIcon fontSize="small" />
                                                                </IconButton>
                                                              </Tooltip>
                                                            )}
                                                            <Tooltip title="Download Payment Receipt">
                                                              <IconButton
                                                                size="small"
                                                                color="primary"
                                                                onClick={async () => {
                                                                  await generatePaymentReceiptPDF(invoice, payment, property);
                                                                }}
                                                              >
                                                                <DownloadIcon fontSize="small" />
                                                              </IconButton>
                                                            </Tooltip>
                                                            <Tooltip title="Delete Payment">
                                                              <IconButton
                                                                size="small"
                                                                color="error"
                                                                onClick={() => handleDeletePayment(invoice._id, payment._id, property._id)}
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
                                <Box sx={{ py: 3, textAlign: 'center' }}>
                                  <Typography variant="body2" color="text.secondary">
                                    No invoice found
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    Create an invoice using the "Create Invoice" button above
                                  </Typography>
                                </Box>
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
            // If it's a new invoice (no _id) and user hasn't saved, just close without confirmation
            // Only existing invoices need confirmation
            if (invoiceData?._id) {
              // For existing invoices, allow closing
              handleCloseInvoiceDialog();
            } else {
              // For new invoices, just close - don't create anything
              handleCloseInvoiceDialog();
            }
            return;
          }
          handleCloseInvoiceDialog();
        }} 
        maxWidth="sm" 
        fullWidth
        disableEscapeKeyDown={invoiceLoading}
      >
        <DialogTitle>{invoiceData?._id ? 'Edit Invoice' : 'Create Invoice'}</DialogTitle>
        <DialogContent dividers>
          {invoiceLoading && (
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress />
            </Box>
          )}
          {calculating && (
            <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {!invoiceLoading && invoiceError && (
            <Alert severity="error">{invoiceError}</Alert>
          )}
          {!invoiceLoading && !calculating && !invoiceError && invoiceProperty && invoiceData && (() => {
              const calcData = invoiceData?.calculationData;
              const electricityCharge = invoiceData.charges?.find(c => c.type === 'ELECTRICITY') || invoiceData.charges?.[0];
              
              // Calculate total amount: Electricity Bill Amount + Arrears
              // Use the actual charge values to ensure accuracy
              const electricityBillAmount = electricityCharge?.amount || 0;
              const arrears = electricityCharge?.arrears || 0;
              const totalAmount = Math.round(electricityBillAmount + arrears);
              
              // Calculate units consumed: Current Reading - Previous Reading
              // Always calculate directly from readings to ensure accuracy
              let unitsConsumed = 0;
              
              // Get current reading (prioritize input field, then calcData)
              const current = currentReading 
                ? parseFloat(String(currentReading).trim()) || 0
                : (calcData?.currentReading ? parseFloat(String(calcData.currentReading)) || 0 : 0);
              
              // Get previous reading (prioritize readingData, then calcData)
              const previous = readingData.previousReading !== undefined && readingData.previousReading !== null
                ? parseFloat(String(readingData.previousReading).trim()) || 0
                : (calcData?.previousReading !== undefined && calcData?.previousReading !== null
                    ? parseFloat(String(calcData.previousReading)) || 0 
                    : 0);
              
              // Always calculate: Units Consumed = Current Reading - Previous Reading
              if (current > 0) {
                unitsConsumed = Math.max(0, current - previous);
              } else if (calcData?.unitsConsumed !== undefined && calcData?.unitsConsumed !== null) {
                // Only use backend value if we don't have current reading
                const backendUnits = Number(calcData.unitsConsumed) || 0;
                // Verify backend calculation is correct
                const backendCurrent = calcData.currentReading ? parseFloat(String(calcData.currentReading)) || 0 : 0;
                const backendPrevious = calcData.previousReading !== undefined ? parseFloat(String(calcData.previousReading)) || 0 : 0;
                if (backendCurrent > 0 && backendPrevious >= 0) {
                  const expectedUnits = Math.max(0, backendCurrent - backendPrevious);
                  // Use backend value only if it matches expected calculation
                  unitsConsumed = (backendUnits === expectedUnits) ? backendUnits : expectedUnits;
                } else {
                  unitsConsumed = backendUnits;
                }
              }
              
              return (
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Property
                  </Typography>
                  <Typography variant="h6">{invoiceProperty.propertyName || invoiceProperty.propertyType || '—'}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {invoiceProperty.address || invoiceProperty.street || 'No address recorded'}
                  </Typography>
                </Box>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Invoice Number"
                    value={invoiceData.invoiceNumber || ''}
                    fullWidth
                    size="small"
                    InputProps={{ readOnly: true }}
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
                {!invoiceData._id && (() => {
                  const activeMeters = (invoiceProperty?.meters || []).filter(m => m.isActive !== false);
                  const hasMultipleMeters = activeMeters.length > 1;
                  
                  if (hasMultipleMeters) {
                    // Show inputs for each meter
                    return (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                          Meter Readings ({activeMeters.length} meters)
                        </Typography>
                        <Stack spacing={2}>
                          {activeMeters.map((meter, index) => {
                            const meterNo = String(meter.meterNo || '');
                            const meterReading = meterReadings[meterNo] || { previousReading: 0, currentReading: '', previousArrears: 0 };
                            // Calculate units consumed: Current Reading - Previous Reading
                            let unitsConsumed = 0;
                            if (meterReading.currentReading && meterReading.previousReading !== undefined) {
                              const current = parseFloat(meterReading.currentReading) || 0;
                              const previous = parseFloat(meterReading.previousReading) || 0;
                              unitsConsumed = Math.max(0, current - previous);
                            }
                            return (
                              <Box key={meterNo} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                                  Meter {meterNo} {meter.floor ? `- Floor ${meter.floor}` : ''} {meter.consumer ? `(${meter.consumer})` : ''}
                                </Typography>
                                <Grid container spacing={2}>
                                  <Grid item xs={12} sm={4}>
                                    <TextField
                                      label="Previous Reading"
                                      type="number"
                                      value={meterReading.previousReading || 0}
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        const previous = parseFloat(value) || 0;
                                        setMeterReadings(prev => ({
                                          ...prev,
                                          [meterNo]: {
                                            ...prev[meterNo],
                                            previousReading: previous
                                          }
                                        }));
                                        
                                        // Recalculate if current reading or units consumed exists
                                        if (meterReading.currentReading) {
                                          const current = parseFloat(meterReading.currentReading) || 0;
                                          const units = Math.max(0, current - previous);
                                          setPendingMeterCalculations(prev => ({
                                            ...prev,
                                            [meterNo]: units
                                          }));
                                        }
                                      }}
                    fullWidth
                    size="small"
                                      inputProps={{ min: 0, step: 1 }}
                                      helperText="Adjust previous reading if incorrect"
                                    />
                                  </Grid>
                                  <Grid item xs={12} sm={4}>
                                    <TextField
                                      label="Current Reading"
                                      type="number"
                                      value={meterReading.currentReading || ''}
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        setMeterReadings(prev => ({
                                          ...prev,
                                          [meterNo]: {
                                            ...prev[meterNo],
                                            currentReading: value
                                          }
                                        }));
                                        
                                        // Calculate units consumed from current reading and trigger calculation
                                        if (value && !isNaN(parseFloat(value))) {
                                          const current = parseFloat(value);
                                          const previous = meterReading.previousReading || 0;
                                          if (current >= previous) {
                                            const units = Math.max(0, current - previous);
                                            setPendingMeterCalculations(prev => ({
                                              ...prev,
                                              [meterNo]: units
                                            }));
                                          }
                                        } else {
                                          // Clear pending calculation if value is invalid
                                          setPendingMeterCalculations(prev => {
                                            const updated = { ...prev };
                                            delete updated[meterNo];
                                            return updated;
                                          });
                                        }
                                      }}
                                      fullWidth
                                      size="small"
                                      error={meterReading.currentReading && parseFloat(meterReading.currentReading) < (meterReading.previousReading || 0)}
                                      helperText={meterReading.currentReading && parseFloat(meterReading.currentReading) < (meterReading.previousReading || 0)
                                        ? 'Current reading cannot be less than previous reading' 
                                        : unitsConsumed > 0 ? `Units Consumed: ${unitsConsumed}` : 'Enter current reading'}
                                      inputProps={{ min: meterReading.previousReading || 0, step: 1 }}
                  />
                </Grid>
                                  <Grid item xs={12} sm={4}>
                                    <TextField
                                      label="Units Consumed"
                                      type="number"
                                      value={unitsConsumed}
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        const units = parseFloat(value) || 0;
                                        
                                        // Update current reading for display
                                        if (units >= 0 && meterReading.previousReading !== undefined) {
                                          const calculatedCurrentReading = meterReading.previousReading + units;
                                          setMeterReadings(prev => ({
                                            ...prev,
                                            [meterNo]: {
                                              ...prev[meterNo],
                                              currentReading: String(calculatedCurrentReading)
                                            }
                                          }));
                                        }
                                        
                                        // Trigger calculation with units consumed
                                        if (value && !isNaN(units) && units >= 0) {
                                          setPendingMeterCalculations(prev => ({
                                            ...prev,
                                            [meterNo]: units
                                          }));
                                        } else {
                                          setPendingMeterCalculations(prev => {
                                            const updated = { ...prev };
                                            delete updated[meterNo];
                                            return updated;
                                          });
                                        }
                                      }}
                                      fullWidth
                                      size="small"
                                      inputProps={{ min: 0, step: 1 }}
                                      helperText="Enter units consumed to calculate bill"
                                    />
                                  </Grid>
                                </Grid>
                                {/* Show separate amounts for this meter */}
                                {meterReading.calculationData && (
                                  <Box sx={{ mt: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                                      Meter {meterNo} Charges:
                                    </Typography>
                                    <Grid container spacing={1}>
                                      <Grid item xs={6}>
                                        <Typography variant="body2" color="text.secondary">
                                          Electricity Bill:
                                        </Typography>
                                      </Grid>
                                      <Grid item xs={6}>
                                        <Typography variant="body2" fontWeight={600}>
                                          PKR {Math.round(meterReading.calculationData.charges?.withSurcharge || 0).toLocaleString()}
                                        </Typography>
                                      </Grid>
                                      <Grid item xs={6}>
                                        <Typography variant="body2" color="text.secondary">
                                          Arrears:
                                        </Typography>
                                      </Grid>
                                      <Grid item xs={6}>
                                        <Typography variant="body2" fontWeight={600}>
                                          PKR {(meterReading.calculationData.previousArrears || 0).toLocaleString()}
                                        </Typography>
                                      </Grid>
                                      <Grid item xs={6}>
                                        <Typography variant="body2" fontWeight={600}>
                                          Total Amount:
                                        </Typography>
                                      </Grid>
                                      <Grid item xs={6}>
                                        <Typography variant="body2" fontWeight={600} color="primary">
                                          Rs {Math.round((meterReading.calculationData.charges?.withSurcharge || 0) + (meterReading.calculationData.previousArrears || 0)).toLocaleString()}
                                        </Typography>
                                      </Grid>
                                    </Grid>
                                  </Box>
                                )}
                              </Box>
                            );
                          })}
                        </Stack>
                      </Grid>
                    );
                  } else {
                    // Single meter - show original inputs
                    return (
                  <>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        label="Previous Reading"
                        type="number"
                        value={readingData.previousReading || 0}
                        onChange={(e) => {
                          const prevReading = parseFloat(e.target.value) || 0;
                          setReadingData(prev => ({ ...prev, previousReading: prevReading }));
                          // Recalculate units consumed if current reading exists
                          if (currentReading) {
                            const newUnitsConsumed = Math.max(0, parseFloat(currentReading) - prevReading);
                            // Trigger recalculation if needed
                            if (newUnitsConsumed >= 0) {
                              handleCurrentReadingChange(currentReading);
                            }
                          }
                        }}
                        fullWidth
                        size="small"
                        inputProps={{ min: 0, step: 1 }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        label="Current Reading"
                        type="number"
                        value={currentReading}
                        onChange={(e) => handleCurrentReadingChange(e.target.value)}
                        fullWidth
                        size="small"
                        error={currentReading && parseFloat(currentReading) < readingData.previousReading}
                        helperText={currentReading && parseFloat(currentReading) < readingData.previousReading 
                          ? 'Current reading cannot be less than previous reading' 
                          : unitsConsumed > 0 ? `Units Consumed: ${unitsConsumed}` : 'Enter current reading to auto-calculate'}
                        inputProps={{ min: readingData.previousReading || 0, step: 1 }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        label="Units Consumed"
                        type="number"
                        value={unitsConsumed}
                        onChange={(e) => {
                          handleUnitsConsumedChange(e.target.value);
                        }}
                        fullWidth
                        size="small"
                        inputProps={{ min: 0, step: 1 }}
                        helperText="Enter units consumed to calculate bill"
                      />
                    </Grid>
                  </>
                    );
                  }
                })()}
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Period From"
                    type="date"
                    value={invoiceData.periodFrom 
                      ? (dayjs(invoiceData.periodFrom).isValid() 
                          ? dayjs(invoiceData.periodFrom).format('YYYY-MM-DD') 
                          : '')
                      : ''}
                    onChange={(e) => {
                      const newPeriodFrom = e.target.value;
                      if (!invoiceData) return;
                      
                      if (newPeriodFrom) {
                        // Update both periodFrom and periodTo in a single state update
                        const newPeriodTo = dayjs(newPeriodFrom).endOf('month').format('YYYY-MM-DD');
                        setInvoiceData(prevData => {
                          if (!prevData) return prevData;
                          const updatedData = {
                            ...prevData,
                            periodFrom: dayjs(newPeriodFrom).toDate(),
                            periodTo: dayjs(newPeriodTo).toDate()
                          };
                          
                          // Regenerate invoice number if needed
                          if (!prevData._id && invoiceProperty) {
                            const periodDate = dayjs(newPeriodFrom);
                            updatedData.invoiceNumber = generateInvoiceNumber(
                              invoiceProperty.srNo,
                              periodDate.year(),
                              periodDate.month() + 1,
                              'ELECTRICITY'
                            );
                          }
                          
                          return updatedData;
                        });
                      } else {
                        handleInvoiceFieldChange('periodFrom', null);
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
                    value={invoiceData.periodTo 
                      ? (dayjs(invoiceData.periodTo).isValid() 
                          ? dayjs(invoiceData.periodTo).format('YYYY-MM-DD') 
                          : '')
                      : ''}
                    onChange={(e) => {
                      const newPeriodTo = e.target.value;
                      if (!invoiceData) return;
                      
                      if (newPeriodTo) {
                        // Update both periodTo and dueDate in a single state update
                        const dueDate = dayjs(newPeriodTo).add(15, 'day').format('YYYY-MM-DD');
                        setInvoiceData(prevData => {
                          if (!prevData) return prevData;
                          const updatedData = {
                            ...prevData,
                            periodTo: dayjs(newPeriodTo).toDate(),
                            dueDate: dayjs(dueDate).toDate()
                          };
                          
                          // Regenerate invoice number if needed
                          if (!prevData._id && invoiceProperty) {
                            const periodDate = updatedData.periodFrom 
                              ? dayjs(updatedData.periodFrom) 
                              : dayjs(newPeriodTo);
                            updatedData.invoiceNumber = generateInvoiceNumber(
                              invoiceProperty.srNo,
                              periodDate.year(),
                              periodDate.month() + 1,
                              'ELECTRICITY'
                            );
                          }
                          
                          return updatedData;
                        });
                      } else {
                        handleInvoiceFieldChange('periodTo', null);
                      }
                    }}
                    fullWidth
                    size="small"
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                {/* Show combined totals only for single meter, not for multiple meters */}
                {(() => {
                  const activeMeters = (invoiceProperty?.meters || []).filter(m => m.isActive !== false);
                  const hasMultipleMeters = activeMeters.length > 1;
                  
                  // For multiple meters when editing, show arrears field if invoice exists
                  // For multiple meters when creating new, don't show combined totals - each meter has its own amounts displayed above
                  if (hasMultipleMeters && !invoiceData._id) {
                    return null;
                  }
                  
                  // For single meter or editing multiple meter invoice, show the original combined totals
                  return (
                    <>
                {electricityCharge && (
                  <>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        label={electricityCharge.description || 'Electricity Bill'}
                        type="number"
                        value={electricityCharge.amount || 0}
                        onChange={(e) => {
                          const chargeIndex = invoiceData.charges.findIndex(c => c.type === 'ELECTRICITY');
                          if (chargeIndex >= 0) {
                            handleInvoiceFieldChange(`charge.${chargeIndex}.amount`, e.target.value);
                          }
                        }}
                        fullWidth
                        size="small"
                        InputProps={{
                          startAdornment: <Typography sx={{ mr: 1 }}>PKR</Typography>
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        label={`${electricityCharge.description || 'Electricity Bill'} Arrears`}
                        type="number"
                        value={electricityCharge.arrears || 0}
                        onChange={(e) => {
                          const chargeIndex = invoiceData.charges.findIndex(c => c.type === 'ELECTRICITY');
                          if (chargeIndex >= 0) {
                            handleInvoiceFieldChange(`charge.${chargeIndex}.arrears`, e.target.value);
                          }
                        }}
                        fullWidth
                        size="small"
                        InputProps={{
                          startAdornment: <Typography sx={{ mr: 1 }}>PKR</Typography>
                        }}
                      />
                    </Grid>
                  </>
                )}
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
                    </>
                  );
                })()}
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
                Download to view the tri-fold invoice (Bank, Office & Client copies) exactly as it will print.
              </Alert>
            </Stack>
            );
          })()}
        </DialogContent>
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
            disabled={invoiceLoading || calculating || !invoiceData}
          >
            {invoiceLoading ? (invoiceData?._id ? 'Updating...' : 'Creating...') : (invoiceData?._id ? 'Update Invoice' : 'Create Invoice')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="md">
        <DialogTitle>
          {editingCharge ? 'Update Electricity Bill' : 'New Electricity Bill'}
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
            {editingCharge ? 'Update' : 'Create'} Bill
          </Button>
        </DialogActions>
      </Dialog>


      {/* View Electricity Bill Dialog */}
      <Dialog open={viewDialogOpen} onClose={handleCloseViewDialog} maxWidth="lg" fullWidth>
        <DialogTitle>
          View Electricity Bill Details
          <IconButton
            onClick={handleCloseViewDialog}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {viewingCharge && (
            <Grid container spacing={3}>
              {/* Invoice & Basic Info */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                  Invoice Information
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Invoice Number</Typography>
                <Typography variant="body1" fontWeight={600}>{viewingCharge.invoiceNumber || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Serial Number</Typography>
                <Typography variant="body1">{viewingCharge.serialNumber || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Status</Typography>
                <Chip 
                  label={viewingCharge.status || 'Active'} 
                  size="small" 
                  color={
                    viewingCharge.status === 'Active' ? 'success' :
                    viewingCharge.status === 'Pending' ? 'warning' :
                    viewingCharge.status === 'Completed' ? 'info' : 'default'
                  }
                />
              </Grid>

              {/* Meter & Reading Details */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mt: 2 }}>
                  Meter & Reading Details
                </Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="caption" color="text.secondary">Meter Number</Typography>
                <Typography variant="body1" fontWeight={600}>{viewingCharge.meterNo || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="caption" color="text.secondary">Property Type</Typography>
                <Typography variant="body1">{viewingCharge.propertyType || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="caption" color="text.secondary">Previous Reading</Typography>
                <Typography variant="body1" fontWeight={600}>{viewingCharge.prvReading || 0}</Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="caption" color="text.secondary">Current Reading</Typography>
                <Typography variant="body1" fontWeight={600}>{viewingCharge.curReading || 0}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Units Consumed</Typography>
                <Typography variant="body1" fontWeight={600}>{viewingCharge.unitsConsumed || 0}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Units Consumed for Days</Typography>
                <Typography variant="body1">{viewingCharge.unitsConsumedForDays || 0}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">IESCO Slabs</Typography>
                <Typography variant="body1">{viewingCharge.iescoSlabs || '—'}</Typography>
              </Grid>

              {/* Billing Period */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mt: 2 }}>
                  Billing Period
                </Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="caption" color="text.secondary">From Date</Typography>
                <Typography variant="body1">
                  {viewingCharge.fromDate ? dayjs(viewingCharge.fromDate).format('DD-MMM-YYYY') : '—'}
                </Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="caption" color="text.secondary">To Date</Typography>
                <Typography variant="body1">
                  {viewingCharge.toDate ? dayjs(viewingCharge.toDate).format('DD-MMM-YYYY') : '—'}
                </Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="caption" color="text.secondary">Month</Typography>
                <Typography variant="body1">{viewingCharge.month || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="caption" color="text.secondary">Due Date</Typography>
                <Typography variant="body1">
                  {viewingCharge.dueDate ? dayjs(viewingCharge.dueDate).format('DD-MMM-YYYY') : '—'}
                </Typography>
              </Grid>

              {/* Charges Breakdown */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mt: 2 }}>
                  Charges Breakdown
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">IESCO Unit Price</Typography>
                <Typography variant="body1">{formatUnitPrice(viewingCharge.iescoUnitPrice || 0)}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Electricity Cost</Typography>
                <Typography variant="body1" fontWeight={600}>{formatCurrency(viewingCharge.electricityCost || 0)}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">F.C Surcharge (3.2 × Units)</Typography>
                <Typography variant="body1">{formatCurrency(viewingCharge.fcSurcharge || 0)}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">GST (18%)</Typography>
                <Typography variant="body1">{formatCurrency(viewingCharge.gst || 0)}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Electricity Duty (1.5%)</Typography>
                <Typography variant="body1">{formatCurrency(viewingCharge.electricityDuty || 0)}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Fixed Charges</Typography>
                <Typography variant="body1">{formatCurrency(viewingCharge.fixedCharges || 0)}</Typography>
              </Grid>

              {/* Financial Summary */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mt: 2 }}>
                  Financial Summary
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Total Bill</Typography>
                <Typography variant="body1" fontWeight={600} fontSize="1.1rem">
                  {formatCurrency(viewingCharge.totalBill || 0)}
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">With Surcharge</Typography>
                <Typography variant="body1" fontWeight={600} fontSize="1.1rem">
                  {formatCurrency(viewingCharge.withSurcharge || 0)}
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Received Amount</Typography>
                <Typography variant="body1" color={viewingCharge.receivedAmount > 0 ? 'success.main' : 'text.secondary'}>
                  {formatCurrency(viewingCharge.receivedAmount || 0)}
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Balance</Typography>
                <Typography variant="body1" fontWeight={600} color={viewingCharge.balance > 0 ? 'error.main' : 'success.main'}>
                  {formatCurrency(viewingCharge.balance || 0)}
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Arrears</Typography>
                <Typography variant="body1" fontWeight={600} color={viewingCharge.arrears > 0 ? 'error.main' : 'text.secondary'}>
                  {formatCurrency(viewingCharge.arrears || 0)}
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Amount in Words</Typography>
                <Typography variant="body2" sx={{ fontStyle: 'italic', mt: 0.5 }}>
                  {viewingCharge.amountInWords || '—'}
                </Typography>
              </Grid>

              {/* Property Details */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mt: 2 }}>
                  Property Details
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="caption" color="text.secondary">Owner</Typography>
                <Typography variant="body1" fontWeight={600}>{viewingCharge.owner || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="caption" color="text.secondary">Contact Number</Typography>
                <Typography variant="body1">{viewingCharge.contactNo || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Plot No</Typography>
                <Typography variant="body1">{viewingCharge.plotNo || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">RDA No</Typography>
                <Typography variant="body1">{viewingCharge.rdaNo || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Sector</Typography>
                <Typography variant="body1">{viewingCharge.sector || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Street</Typography>
                <Typography variant="body1">{viewingCharge.street || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Category</Typography>
                <Typography variant="body1">{viewingCharge.category || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography variant="caption" color="text.secondary">Project</Typography>
                <Typography variant="body1">{viewingCharge.project || '—'}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary">Full Address</Typography>
                <Typography variant="body1">{viewingCharge.address || '—'}</Typography>
              </Grid>
              {viewingCharge.familyStatus && (
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="text.secondary">Family Status</Typography>
                  <Typography variant="body1">{viewingCharge.familyStatus}</Typography>
                </Grid>
              )}

              {/* Additional Dates */}
              {(viewingCharge.fileSubmission || viewingCharge.demarcationDate || viewingCharge.constructionDate) && (
                <>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mt: 2 }}>
                      Additional Dates
                    </Typography>
                  </Grid>
                  {viewingCharge.fileSubmission && (
                    <Grid item xs={12} md={4}>
                      <Typography variant="caption" color="text.secondary">File Submission</Typography>
                      <Typography variant="body1">
                        {dayjs(viewingCharge.fileSubmission).format('DD-MMM-YYYY')}
                      </Typography>
                    </Grid>
                  )}
                  {viewingCharge.demarcationDate && (
                    <Grid item xs={12} md={4}>
                      <Typography variant="caption" color="text.secondary">Demarcation Date</Typography>
                      <Typography variant="body1">
                        {dayjs(viewingCharge.demarcationDate).format('DD-MMM-YYYY')}
                      </Typography>
                    </Grid>
                  )}
                  {viewingCharge.constructionDate && (
                    <Grid item xs={12} md={4}>
                      <Typography variant="caption" color="text.secondary">Construction Date</Typography>
                      <Typography variant="body1">
                        {dayjs(viewingCharge.constructionDate).format('DD-MMM-YYYY')}
                      </Typography>
                    </Grid>
                  )}
                </>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseViewDialog}>Close</Button>
          {viewingCharge && (
            <>
              <Button
                variant="outlined"
                startIcon={<PrintIcon />}
                onClick={handlePrintBill}
              >
                Print
              </Button>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleDownloadPDF}
              >
                Download PDF
              </Button>
              <Button
                variant="contained"
                onClick={() => {
                  handleCloseViewDialog();
                  handleOpenDialog(viewingCharge);
                }}
              >
                Edit
              </Button>
            </>
          )}
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
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: Number(e.target.value) }))}
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
                onChange={(e) => setPaymentForm(prev => ({ ...prev, paymentDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Period From"
                type="date"
                fullWidth
                value={paymentForm.periodFrom}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, periodFrom: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Period To"
                type="date"
                fullWidth
                value={paymentForm.periodTo}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, periodTo: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
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
                  onChange={(e) => handleElectricityPaymentMethodChange(e.target.value)}
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
                <input type="file" hidden accept="image/*,.pdf" onChange={handleElectricityAttachmentChange} />
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

export default Electricity;

