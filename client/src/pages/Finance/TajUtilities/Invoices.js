import React, { useEffect, useState, useMemo } from 'react';
import { usePagination } from '../../../hooks/usePagination';
import TablePaginationWrapper from '../../../components/TablePaginationWrapper';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  Tooltip,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Collapse,
  Autocomplete
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Visibility as ViewIcon,
  Download as DownloadIcon,
  FileDownload as FileDownloadIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { fetchAllInvoices, fetchInvoice, fetchMonthSummary } from '../../../services/propertyInvoiceService';
import { fetchProperties, fetchPropertyById } from '../../../services/tajPropertiesService';
import { fetchResidents } from '../../../services/tajResidentsService';
import { fetchSectors } from '../../../services/tajSectorsService';
import {
  generateElectricityInvoicePDF,
  generateCAMInvoicePDF,
  generateWaterInvoicePDF,
  generateRentInvoicePDF,
  generateGeneralInvoicePDF,
  outputPDF
} from '../../../utils/invoicePDFGenerators';
import { getAdjustedGrandTotal, getAdjustedBalance } from '../../../utils/invoiceGracePeriodUtils';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

const getPaymentStatusConfig = (status) => {
  const normalized = (status || 'unpaid').toLowerCase();
  switch (normalized) {
    case 'paid':
      return { color: 'success', label: 'Paid' };
    case 'partial_paid':
    case 'partial':
      return { color: 'warning', label: 'Partial Paid' };
    case 'unpaid':
    default:
      return { color: 'error', label: 'Unpaid' };
  }
};

const Invoices = () => {
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [properties, setProperties] = useState([]);
  const [residents, setResidents] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [residentsLoading, setResidentsLoading] = useState(false);
  const [sectorsLoading, setSectorsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [residentFilter, setResidentFilter] = useState('');
  const [chargeTypeFilter, setChargeTypeFilter] = useState('all');
  const [sectorFilter, setSectorFilter] = useState('');
  const [monthYearFilter, setMonthYearFilter] = useState('');
  const [expandedMonths, setExpandedMonths] = useState([]);
  const [monthSummary, setMonthSummary] = useState({});
  const [exporting, setExporting] = useState(false);

  // Pagination
  const pagination = usePagination({
    defaultRowsPerPage: 50,
    resetDependencies: [statusFilter, paymentStatusFilter, propertyFilter, residentFilter, chargeTypeFilter, sectorFilter, monthYearFilter]
  });

  const loadInvoices = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError('');
      const params = {
        page: pagination.page + 1,
        limit: pagination.rowsPerPage
      };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (paymentStatusFilter !== 'all') params.paymentStatus = paymentStatusFilter;
      if (propertyFilter) params.propertyId = propertyFilter;
      
      // Handle "Open Invoice" filter option
      if (chargeTypeFilter === 'OPEN_INVOICE') {
        params.openInvoices = 'true';
      } else if (chargeTypeFilter !== 'all') {
        params.chargeType = chargeTypeFilter;
      }
      
      // Send resident and sector filters to backend
      if (residentFilter) params.residentId = residentFilter;
      if (sectorFilter) params.sector = sectorFilter;
      // Send search to backend (server-side search across all pages)
      if (search) params.search = search;
      // Send month/year filter to backend
      if (monthYearFilter) params.monthYear = monthYearFilter;
      // Add timestamp to bypass cache if force refresh
      if (forceRefresh) {
        params._t = Date.now();
      }
      
      const response = await fetchAllInvoices(params);
      const invoicesData = response.data?.data || [];
      
      setInvoices(invoicesData);
      if (response.data?.pagination) {
        pagination.setTotal(response.data.pagination.total);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  // The filters currently applied to the list (without paging) — the Excel export uses the same ones
  const currentFilterParams = () => {
    const params = {};
    if (statusFilter !== 'all') params.status = statusFilter;
    if (paymentStatusFilter !== 'all') params.paymentStatus = paymentStatusFilter;
    if (propertyFilter) params.propertyId = propertyFilter;
    if (chargeTypeFilter === 'OPEN_INVOICE') params.openInvoices = 'true';
    else if (chargeTypeFilter !== 'all') params.chargeType = chargeTypeFilter;
    if (residentFilter) params.residentId = residentFilter;
    if (sectorFilter) params.sector = sectorFilter;
    if (search) params.search = search;
    if (monthYearFilter) params.monthYear = monthYearFilter;
    return params;
  };

  /** Download every invoice that matches the current filters (all pages, not just the one on screen). */
  const handleExportExcel = async () => {
    const PAGE_SIZE = 1000;
    try {
      setExporting(true);
      setError('');
      const filters = currentFilterParams();
      const all = [];
      for (let page = 1; page <= 200; page += 1) {
        const response = await fetchAllInvoices({ ...filters, page, limit: PAGE_SIZE, _t: Date.now() });
        const rows = response.data?.data || [];
        all.push(...rows);
        const total = response.data?.pagination?.total;
        if (rows.length < PAGE_SIZE || (total != null && all.length >= total)) break;
      }
      if (!all.length) {
        setError('No invoices to export for the current filters');
        return;
      }

      const date = (d) => (d ? dayjs(d).format('DD-MMM-YYYY') : '');
      const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
      const rows = all.map((invoice) => {
        const isOpenInvoice = !invoice.property;
        const totalPaid = invoice.totalPaid || 0;
        const balance = getAdjustedBalance(invoice);
        const status = balance <= 0 ? 'paid' : totalPaid > 0 ? 'partial_paid' : 'unpaid';
        return {
          'Invoice #': invoice.invoiceNumber || '',
          'Invoice Month': invoice.periodTo || invoice.periodFrom || invoice.invoiceDate
            ? dayjs(invoice.periodTo || invoice.periodFrom || invoice.invoiceDate).format('MMM YYYY')
            : '',
          'Resident ID': isOpenInvoice ? '' : (invoice.property?.resident?.residentId || invoice.property?.residentId || ''),
          Property: isOpenInvoice
            ? (invoice.customerName || 'Open Invoice')
            : (invoice.property?.propertyName || invoice.property?.plotNumber || ''),
          Address: isOpenInvoice ? (invoice.customerAddress || '') : (invoice.property?.address || ''),
          Sector: isOpenInvoice ? '' : (invoice.property?.sector?.name || invoice.property?.sector || ''),
          Owner: isOpenInvoice ? (invoice.customerName || '') : (invoice.property?.ownerName || ''),
          'Charge Types': (invoice.chargeTypes || []).length ? getChargeTypesLabel(invoice.chargeTypes) : '',
          'Period From': date(invoice.periodFrom),
          'Period To': date(invoice.periodTo),
          'Due Date': date(invoice.dueDate),
          'Grand Total': money(getAdjustedGrandTotal(invoice)),
          Paid: money(totalPaid),
          Balance: money(balance),
          'Payment Status': getPaymentStatusConfig(status).label,
          'Recorded By': invoice.createdBy
            ? `${invoice.createdBy.firstName || ''} ${invoice.createdBy.lastName || ''}`.trim()
            : ''
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0]).map((key) => ({
        wch: Math.min(45, Math.max(key.length, ...rows.slice(0, 500).map((r) => String(r[key] ?? '').length)) + 2)
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
      XLSX.writeFile(wb, `Taj-Utilities-Invoices-${monthYearFilter || dayjs().format('YYYY-MM-DD')}.xlsx`);
      setSuccess(`Exported ${rows.length} invoice${rows.length > 1 ? 's' : ''} to Excel`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to export invoices');
    } finally {
      setExporting(false);
    }
  };

  const loadMonthSummary = async () => {
    try {
      const params = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (paymentStatusFilter !== 'all') params.paymentStatus = paymentStatusFilter;
      if (propertyFilter) params.propertyId = propertyFilter;
      if (chargeTypeFilter === 'OPEN_INVOICE') params.openInvoices = 'true';
      else if (chargeTypeFilter !== 'all') params.chargeType = chargeTypeFilter;
      if (residentFilter) params.residentId = residentFilter;
      if (sectorFilter) params.sector = sectorFilter;
      const response = await fetchMonthSummary(params);
      setMonthSummary(response.data?.data || {});
    } catch {
      setMonthSummary({});
    }
  };

  const loadProperties = async () => {
    try {
      setPropertiesLoading(true);
      const response = await fetchProperties({});
      setProperties(response.data?.data || []);
    } catch (err) {
      console.error('Failed to load properties:', err);
    } finally {
      setPropertiesLoading(false);
    }
  };

  const loadResidents = async () => {
    try {
      setResidentsLoading(true);
      const response = await fetchResidents({ isActive: 'true' });
      setResidents(response.data?.data || []);
    } catch (err) {
      console.error('Failed to load residents:', err);
    } finally {
      setResidentsLoading(false);
    }
  };

  const loadSectors = async () => {
    try {
      setSectorsLoading(true);
      const response = await fetchSectors({ isActive: 'true' });
      setSectors(response.data?.data || []);
    } catch (err) {
      console.error('Failed to load sectors:', err);
    } finally {
      setSectorsLoading(false);
    }
  };

  useEffect(() => {
    // Reset to page 1 when filters change (except pagination changes)
    if (pagination.page !== 0) {
      pagination.setPage(0);
    }
  }, [statusFilter, paymentStatusFilter, propertyFilter, residentFilter, chargeTypeFilter, sectorFilter, search, monthYearFilter]);

  useEffect(() => {
    // Force refresh on initial load to ensure we get the latest invoices
    const isInitialLoad = pagination.page === 0 && pagination.rowsPerPage === 50;
    loadInvoices(isInitialLoad);
    loadMonthSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.rowsPerPage, statusFilter, paymentStatusFilter, propertyFilter, residentFilter, chargeTypeFilter, sectorFilter, search, monthYearFilter]);

  useEffect(() => {
    loadProperties();
    loadResidents();
    loadSectors();
  }, []);

  const handleViewInvoice = async (invoice) => {
    // Open the same PDF as download in a new tab for viewing (all invoices)
    try {
      const fullInvoiceResponse = await fetchInvoice(invoice._id);
      const fullInvoice = fullInvoiceResponse?.data?.data || invoice;
      await generateInvoicePDF(fullInvoice, { openInNewTab: true });
    } catch (error) {
      console.error('Error opening invoice PDF:', error);
      setError('Failed to open invoice PDF');
    }
  };

  const generateInvoicePDF = async (invoice, options = {}) => {
    if (!invoice) {
      setError('Invoice data is missing');
      return;
    }

    // For open invoices (no property), use generateGeneralInvoicePDF
    if (!invoice.property) {
      return await generateGeneralInvoicePDF(invoice, null, options);
    }

    let property = invoice.property;
    
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
    
    const chargeTypes = invoice.chargeTypes || [];
    
    // Determine invoice type based on charge types
    const isElectricity = chargeTypes.includes('ELECTRICITY');
    const isCAM = chargeTypes.includes('CAM');
    const isWater = chargeTypes.includes('WATER');
    const isRent = chargeTypes.includes('RENT');
    
    // Route to specific detailed PDF generation for single-type invoices
    // For mixed invoices, use the general format below
    const isSingleType =
      (isElectricity && !isCAM && !isWater && !isRent) ||
      (isCAM && !isElectricity && !isWater && !isRent) ||
      (isWater && !isElectricity && !isCAM && !isRent) ||
      (isRent && !isElectricity && !isCAM && !isWater);
    
    if (isSingleType && isElectricity) {
      return await generateElectricityInvoicePDF(invoice, property, options);
    } else if (isSingleType && isCAM) {
      return await generateCAMInvoicePDF(invoice, property, options);
    } else if (isSingleType && isWater) {
      return await generateWaterInvoicePDF(invoice, property, options);
    } else if (isSingleType && isRent) {
      return await generateRentInvoicePDF(invoice, property, options);
    }
    
    // For mixed invoices or fallback, use the general format below

    const pdf = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const panelWidth = pageWidth / 3;
    const marginX = 6;
    const topMargin = 10;
    const contentWidth = panelWidth - 2 * marginX;

    const formatDate = (value, pattern = 'DD-MMM-YY') =>
      value ? dayjs(value).format(pattern) : '—';

    const formatFullDate = (value) =>
      value ? dayjs(value).format('MMMM D, YYYY') : '—';

    const formatMoney = (value) =>
      (Number(value) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0 });

    const periodFromRaw = invoice?.periodFrom || null;
    const periodToRaw = invoice?.periodTo || null;
    const periodFrom = formatDate(periodFromRaw);
    const periodTo = formatDate(periodToRaw);
    const invoiceNumber = invoice?.invoiceNumber || '—';
    const invoicingDate = formatFullDate(invoice?.invoiceDate || invoice?.createdAt);
    const computedDueDate = invoice?.dueDate || (periodToRaw ? dayjs(periodToRaw).add(30, 'day').toDate() : null);
    const dueDate = formatFullDate(computedDueDate);
    const monthLabel = (periodToRaw
      ? dayjs(periodToRaw)
      : invoice?.invoiceDate
      ? dayjs(invoice.invoiceDate)
      : dayjs()
    ).format('MMM-YY').toUpperCase();

    const residentName = property.tenantName || property.ownerName || '—';
    // Try multiple ways to get residentId: from populated resident object, from property.residentId, or from invoice.property.resident
    const residentId = property.resident?.residentId || 
                      (invoice?.property?.resident?.residentId) || 
                      property.residentId || 
                      (invoice?.property?.residentId) || 
                      '—';
    const propertyAddress =
      property.address ||
      [property.plotNumber ? `Plot No ${property.plotNumber}` : '', property.street]
        .filter(Boolean)
        .join(', ') ||
      '—';
    const propertySector = property.sector || '—';
    
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

    // Draw fold lines
    pdf.setDrawColor(170);
    pdf.setLineWidth(0.3);
    if (pdf.setLineDash) {
      pdf.setLineDash([1, 2], 0);
    }
    [panelWidth, panelWidth * 2].forEach((xPos) => {
      pdf.line(xPos, topMargin - 5, xPos, pageHeight - 15);
    });
    if (pdf.setLineDash) {
      pdf.setLineDash([], 0);
    }

    const drawInlineField = (label, value, startX, startY, labelWidth = 34) => {
      const valueWidth = contentWidth - labelWidth;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.text(label, startX, startY);
      pdf.setFont('helvetica', 'normal');
      const lines = pdf.splitTextToSize(String(value || '—'), valueWidth);
      lines.forEach((line, idx) => {
        pdf.text(line, startX + labelWidth, startY + idx * 4.5);
      });
      return startY + lines.length * 4.5 + 1.5;
    };

    const drawChargeDetails = (startX, startY) => {
      const width = contentWidth;
      let y = startY;
      pdf.setFillColor(242, 242, 242);
      pdf.rect(startX, y, width, 7, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(178, 34, 34);
      
      let title = 'INVOICE DETAILS';
      if (isElectricity && !isCAM && !isWater && !isRent) {
        title = 'ELECTRICITY CHARGES DETAILS';
      } else if (isCAM && !isElectricity && !isWater && !isRent) {
        title = 'CAM CHARGES DETAILS';
      } else if (isWater && !isElectricity && !isCAM && !isRent) {
        title = 'WATER CHARGES DETAILS';
      } else if (isRent && !isElectricity && !isCAM && !isWater) {
        title = 'RENT CHARGES DETAILS';
      }
      
      pdf.text(title, startX + width / 2, y + 4.5, { align: 'center' });
      pdf.setTextColor(0, 0, 0);
      y += 13;

      // Get charges from invoice
      const charges = invoice.charges || [];
      let totalAmount = 0;
      let totalArrears = 0;

      charges.forEach((charge) => {
        const amount = Number(charge.amount || 0);
        const arrears = Number(charge.arrears || 0);
        totalAmount += amount;
        totalArrears += arrears;
      });

      const payableWithinDue = invoice?.grandTotal || totalAmount + totalArrears;
      const lateSurcharge = Math.max(Math.round(payableWithinDue * 0.1), 0);
      const payableAfterDue = payableWithinDue + lateSurcharge;

      const rows = [];
      
      if (isElectricity) {
        const elecCharge = charges.find(c => c.type === 'ELECTRICITY');
        if (elecCharge) {
          rows.push(['Electricity Charges', formatMoney(elecCharge.amount || 0)]);
        }
      }
      
      if (isCAM) {
        const camCharge = charges.find(c => c.type === 'CAM');
        if (camCharge) {
          rows.push(['CAM Charges', formatMoney(camCharge.amount || 0)]);
        }
      }

      if (isWater) {
        const waterCharge = charges.find(c => c.type === 'WATER');
        if (waterCharge) {
          rows.push(['Water Charges', formatMoney(waterCharge.amount || 0)]);
        }
      }
      
      if (isRent) {
        const rentCharge = charges.find(c => c.type === 'RENT');
        if (rentCharge) {
          rows.push(['Rent Charges', formatMoney(rentCharge.amount || 0)]);
        }
      }

      if (totalArrears > 0) {
        rows.push(['Arrears', formatMoney(totalArrears)]);
      }
      
      rows.push(['Payable Within Due Date', formatMoney(payableWithinDue)]);
      rows.push(['Payable After Due Date', formatMoney(payableAfterDue)]);

      rows.forEach((row) => {
        pdf.setDrawColor(210);
        pdf.rect(startX, y - 5, width, 7);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.text(row[0], startX + 2, y - 1);
        pdf.setFont('helvetica', 'normal');
        pdf.text(row[1], startX + width - 2, y - 1, { align: 'right' });
        y += 7;
      });

      return y + 2;
    };

    const footnotes = [
      '1. The above mentioned charges are calculated based on proportionate share of user in total cost of services/utilities and do not include any profit element of Taj Residencia.',
      '2. Please make your cheque/bank draft/cash deposit on our specified deposit slip at any Allied Bank Ltd. branch in Pakistan to Account Title: Taj Residencia, Allied Bank Limited, The Centaurus Mall Branch, Islamabad (0917). Bank Account No.: PK68ABPA0010035700420129.',
      '3. Please deposit your dues before the due date to avoid Late Payment Surcharge.',
      '4. Please share proof of payment to TAJ Official WhatsApp No.: 0345 77 88 442.'
    ];

    // Helper function to load and add logo image to PDF
    const addLogoToPDF = async (pdf, x, y, width = 15, height = 15) => {
      try {
        const logoPath = '/images/taj-logo.png';
        const img = new Image();
        
        return new Promise((resolve) => {
          img.onload = () => {
            try {
              pdf.addImage(img, 'PNG', x, y, width, height);
            } catch (error) {
              console.error('Error adding logo to PDF:', error);
              pdf.setFontSize(7);
              pdf.setFont('helvetica', 'normal');
              pdf.text('LOGO', x, y + height / 2);
            }
            resolve();
          };
          img.onerror = () => {
            pdf.setFontSize(7);
            pdf.setFont('helvetica', 'normal');
            pdf.text('LOGO', x, y + height / 2);
            resolve();
          };
          img.src = logoPath;
        });
      } catch (error) {
        console.error('Error loading logo:', error);
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.text('LOGO', x, y + 5);
      }
    };

    const drawPanel = async (copyLabel, columnIndex) => {
      const startX = columnIndex * panelWidth + marginX;
      let cursorY = topMargin - 3; // Move first row up

      // Header row: Copy Label (left) | Taj Residencia (center) | Logo (right)
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.text(copyLabel, startX, cursorY); // Left: Copy label
      pdf.setFontSize(10);
      pdf.setTextColor(178, 34, 34);
      pdf.text('Taj Residencia', startX + contentWidth / 2, cursorY, { align: 'center' }); // Center: Taj Residencia
      pdf.setTextColor(0, 0, 0);
      
      // Add logo image on the right - bigger and better positioned
      const logoWidth = 20;
      const logoHeight = 20;
      const logoX = startX + contentWidth - logoWidth - 1; // Slight margin from edge
      const logoY = cursorY - 5; // Center vertically with text, accounting for larger size
      await addLogoToPDF(pdf, logoX, logoY, logoWidth, logoHeight);
      
      cursorY += 7; // Increased spacing to accommodate larger logo

      pdf.setFont('helvetica', 'bold'); // Make invoice type bold
      pdf.setFontSize(9); // Reduced from 11 to 9
      pdf.setTextColor(178, 34, 34);
      
      let invoiceTitle = 'Invoice of Charges';
      if (isElectricity && !isCAM && !isWater && !isRent) {
        invoiceTitle = 'Invoice of Electricity Charges';
      } else if (isCAM && !isElectricity && !isWater && !isRent) {
        invoiceTitle = 'Invoice of CAM Charges';
      } else if (isWater && !isElectricity && !isCAM && !isRent) {
        invoiceTitle = 'Invoice of Water Charges';
      } else if (isRent && !isElectricity && !isCAM && !isWater) {
        invoiceTitle = 'Invoice of Rent Charges';
      } else {
        invoiceTitle = 'Invoice of Charges';
      }
      
      pdf.text(invoiceTitle, startX + contentWidth / 2, cursorY, { align: 'center' });
      pdf.setTextColor(0, 0, 0);
      cursorY += 6;

      // Render "For The Month Of" in normal, then month label in bold
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      const monthPrefix = 'For The Month Of ';
      const monthValue = monthLabel;
      const prefixWidth = pdf.getTextWidth(monthPrefix);
      const totalWidth = pdf.getTextWidth(monthPrefix + monthValue);
      const centerX = startX + contentWidth / 2;
      pdf.text(monthPrefix, centerX - totalWidth / 2, cursorY);
      pdf.setFont('helvetica', 'bold'); // Make date/year bold
      pdf.text(monthValue, centerX - totalWidth / 2 + prefixWidth, cursorY);
      cursorY += 6;

      const inlineRows = [
        ['Resident ID', residentId],
        ['Residents Name', residentName],
        ['Address', propertyAddress],
        ['Sector', propertySector],
        ['Size', propertySize],
        ['Account No.', 'PK68ABPA0010035700420129'],
        ['Period From', periodFrom],
        ['Period To', periodTo],
        ['Invoice No.', invoiceNumber],
        ['Invoicing Date', invoicingDate],
        ['Due Date', dueDate]
      ];

      inlineRows.forEach(([label, value]) => {
        cursorY = drawInlineField(label, value, startX, cursorY);
      });

      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(6.5);
      pdf.text('(In Rupees)', startX + contentWidth, cursorY, { align: 'right' });
      cursorY += 4;

      cursorY = drawChargeDetails(startX, cursorY);

      let footY = cursorY + 2;
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(5.2);
      footnotes.forEach((line) => {
        const wrapped = pdf.splitTextToSize(line, contentWidth);
        wrapped.forEach((wrappedLine) => {
          pdf.text(wrappedLine, startX, footY);
          footY += 3.2;
        });
      });
    };

    const copies = ['Bank Copy', 'Office Copy', 'Client Copy'];
    // Draw all panels (await each one to ensure logo loads)
    for (let index = 0; index < copies.length; index++) {
      await drawPanel(copies[index], index);
    }

    const sanitizedName = (property.propertyName || property.plotNumber || property.srNo || 'invoice')
      .toString()
      .replace(/[^a-z0-9-_ ]/gi, '')
      .trim()
      .replace(/\s+/g, '_');
    outputPDF(pdf, `Invoice_${sanitizedName || invoice._id}.pdf`, options);
  };

  const handleDownloadInvoice = async (invoice) => {
    try {
      // Fetch full invoice details with all populated fields
      const fullInvoiceResponse = await fetchInvoice(invoice._id);
      const fullInvoice = fullInvoiceResponse?.data?.data || invoice;
      await generateInvoicePDF(fullInvoice);
    } catch (error) {
      console.error('Error generating PDF:', error);
      setError('Failed to generate invoice PDF');
    }
  };

  // Month key for an invoice (periodTo → periodFrom → invoiceDate)
  const getMonthKey = (invoice) => {
    const periodDate = invoice.periodTo
      ? dayjs(invoice.periodTo)
      : invoice.periodFrom
        ? dayjs(invoice.periodFrom)
        : invoice.invoiceDate
          ? dayjs(invoice.invoiceDate)
          : dayjs();
    return periodDate.format('YYYY-MM');
  };

  // Group by month: use whole-month totals from month-summary API when available; table rows = current page invoices in that month
  const invoicesByMonth = useMemo(() => {
    const summaryMonths = Object.keys(monthSummary || {}).filter(Boolean);
    if (summaryMonths.length > 0) {
      const sorted = [...summaryMonths].sort((a, b) => b.localeCompare(a));
      return sorted.map((monthKey) => {
        const s = monthSummary[monthKey];
        const monthInvoices = invoices.filter((inv) => getMonthKey(inv) === monthKey);
        return {
          key: monthKey,
          label: dayjs(monthKey + '-01').format('MMMM YYYY'),
          total: s?.total ?? 0,
          paid: s?.paid ?? 0,
          balance: s?.balance ?? 0,
          invoiceCount: s?.invoiceCount ?? 0,
          invoices: monthInvoices
        };
      });
    }
    const grouped = {};
    invoices.forEach((invoice) => {
      const monthKey = getMonthKey(invoice);
      const monthLabel = dayjs(monthKey + '-01').format('MMMM YYYY');
      if (!grouped[monthKey]) {
        grouped[monthKey] = {
          label: monthLabel,
          invoices: [],
          total: 0,
          paid: 0,
          balance: 0,
          invoiceCount: 0
        };
      }
      grouped[monthKey].invoices.push(invoice);
      const adjustedGrandTotal = getAdjustedGrandTotal(invoice);
      grouped[monthKey].total += adjustedGrandTotal;
      grouped[monthKey].paid += invoice.totalPaid || 0;
      const adjustedBalance = getAdjustedBalance(invoice);
      grouped[monthKey].balance += adjustedBalance;
      grouped[monthKey].invoiceCount = grouped[monthKey].invoices.length;
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, value]) => ({ key, ...value }));
  }, [invoices, monthSummary]);

  const toggleMonth = (monthKey) => {
    setExpandedMonths(prev => {
      if (prev.includes(monthKey)) {
        return prev.filter(key => key !== monthKey);
      } else {
        return [...prev, monthKey];
      }
    });
  };

  // Expand all months by default on initial load
  useEffect(() => {
    if (invoicesByMonth.length > 0 && expandedMonths.length === 0) {
      const allMonths = invoicesByMonth.map(m => m.key);
      setExpandedMonths(allMonths);
    }
  }, [invoicesByMonth.length]); // Only depend on length to avoid re-triggering on filter changes

  const getChargeTypesLabel = (chargeTypes) => {
    if (!chargeTypes || chargeTypes.length === 0) return '—';
    return chargeTypes.map(type => {
      switch (type) {
        case 'ELECTRICITY': return 'Electricity';
        case 'CAM': return 'CAM';
        case 'WATER': return 'Water';
        case 'RENT': return 'Rent';
        default: return type;
      }
    }).join(', ');
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Invoices
          </Typography>
          <Typography color="text.secondary">
            View and manage all property invoices.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            placeholder="Search by name, CNIC, Resident ID, invoice number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 250 }}
          />
          <Autocomplete
            size="small"
            options={properties}
            getOptionLabel={(option) => 
              `${option.propertyName || option.plotNumber || 'N/A'} - ${option.ownerName || 'N/A'}`
            }
            value={properties.find(p => String(p._id) === String(propertyFilter)) || null}
            onChange={(event, newValue) => {
              setPropertyFilter(newValue ? String(newValue._id) : '');
            }}
            loading={propertiesLoading}
            sx={{ minWidth: 250 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Property"
                placeholder="Select property"
              />
            )}
          />
          <Autocomplete
            size="small"
            options={residents}
            getOptionLabel={(option) => option.name || ''}
            value={residents.find(r => String(r._id) === String(residentFilter)) || null}
            onChange={(event, newValue) => {
              setResidentFilter(newValue ? String(newValue._id) : '');
            }}
            loading={residentsLoading}
            sx={{ minWidth: 200 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Resident"
                placeholder="Select resident"
              />
            )}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="all">All Status</MenuItem>
              <MenuItem value="Issued">Issued</MenuItem>
              <MenuItem value="Draft">Draft</MenuItem>
              <MenuItem value="Cancelled">Cancelled</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Payment</InputLabel>
            <Select
              value={paymentStatusFilter}
              label="Payment"
              onChange={(e) => setPaymentStatusFilter(e.target.value)}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="paid">Paid</MenuItem>
              <MenuItem value="partial_paid">Partial Paid</MenuItem>
              <MenuItem value="unpaid">Unpaid</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Charge Type</InputLabel>
            <Select
              value={chargeTypeFilter}
              label="Charge Type"
              onChange={(e) => setChargeTypeFilter(e.target.value)}
            >
              <MenuItem value="all">All Types</MenuItem>
              <MenuItem value="ELECTRICITY">Electricity</MenuItem>
              <MenuItem value="CAM">CAM</MenuItem>
              <MenuItem value="WATER">Water</MenuItem>
              <MenuItem value="RENT">Rent</MenuItem>
              <MenuItem value="OPEN_INVOICE">Open Invoice</MenuItem>
            </Select>
          </FormControl>
          <Autocomplete
            size="small"
            options={sectors}
            getOptionLabel={(option) => option.name || option.sectorName || String(option)}
            value={sectors.find(s => {
              const sectorName = s.name || s.sectorName || String(s);
              return String(sectorName).toLowerCase() === String(sectorFilter).toLowerCase();
            }) || null}
            onChange={(event, newValue) => {
              if (newValue) {
                const sectorName = newValue.name || newValue.sectorName || String(newValue);
                setSectorFilter(sectorName);
              } else {
                setSectorFilter('');
              }
            }}
            loading={sectorsLoading}
            sx={{ minWidth: 200 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Sector"
                placeholder="Select sector"
              />
            )}
          />
          <TextField
            size="small"
            type="month"
            label="Month/Year"
            value={monthYearFilter}
            onChange={(e) => setMonthYearFilter(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 180 }}
          />
          <Button
            variant="outlined"
            color="success"
            size="small"
            startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <FileDownloadIcon />}
            onClick={handleExportExcel}
            disabled={exporting || loading}
          >
            {exporting ? 'Exporting…' : 'Export to Excel'}
          </Button>
          <Tooltip title="Refresh">
            <IconButton onClick={() => loadInvoices(true)} disabled={loading}>
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

      {/* Statistics */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">Total Invoices</Typography>
            <Typography variant="h5" fontWeight={600}>
              {pagination.total || invoices.length}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">Current Page</Typography>
            <Typography variant="h5" fontWeight={600}>
              {invoices.length} of {pagination.total || invoices.length}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">Total Amount</Typography>
            <Typography variant="h5" fontWeight={600}>
              {formatCurrency(invoices.reduce((sum, inv) => sum + getAdjustedGrandTotal(inv), 0))}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">Total Balance</Typography>
            <Typography variant="h5" fontWeight={600} color="error.main">
              {formatCurrency(invoices.reduce((sum, inv) => sum + getAdjustedBalance(inv), 0))}
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      <Card>
        <CardContent>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          ) : invoicesByMonth.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <Typography color="text.secondary">No invoices found</Typography>
            </Box>
          ) : (
            invoicesByMonth.map((monthGroup) => (
              <Box key={monthGroup.key} sx={{ mb: 3 }}>
                <Card variant="outlined" sx={{ mb: 1 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{ cursor: 'pointer' }}
                      onClick={() => toggleMonth(monthGroup.key)}
                    >
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <IconButton 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMonth(monthGroup.key);
                          }}
                        >
                          {expandedMonths.includes(monthGroup.key) ? (
                            <ExpandLessIcon />
                          ) : (
                            <ExpandMoreIcon />
                          )}
                        </IconButton>
                        <Typography variant="h6" fontWeight={600}>
                          {monthGroup.label}
                        </Typography>
                        <Chip
                          label={`${(monthGroup.invoiceCount ?? monthGroup.invoices.length)} invoice${(monthGroup.invoiceCount ?? monthGroup.invoices.length) !== 1 ? 's' : ''}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      </Stack>
                      <Stack direction="row" spacing={3}>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Total
                          </Typography>
                          <Typography variant="body2" fontWeight={600}>
                            {formatCurrency(monthGroup.total)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Paid
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="success.main">
                            {formatCurrency(monthGroup.paid)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Balance
                          </Typography>
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            color={monthGroup.balance > 0 ? 'error.main' : 'success.main'}
                          >
                            {formatCurrency(monthGroup.balance)}
                          </Typography>
                        </Box>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
                <Collapse in={expandedMonths.includes(monthGroup.key)}>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Invoice #</TableCell>
                          <TableCell>Resident ID</TableCell>
                          <TableCell>Property</TableCell>
                          <TableCell>Owner</TableCell>
                          <TableCell>Charge Types</TableCell>
                          <TableCell>Period From</TableCell>
                          <TableCell>Period To</TableCell>
                          <TableCell>Due Date</TableCell>
                          <TableCell align="right">Grand Total</TableCell>
                          <TableCell align="right">Paid</TableCell>
                          <TableCell align="right">Balance</TableCell>
                          <TableCell>Payment Status</TableCell>
                          <TableCell>Recorded By</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {monthGroup.invoices.map((invoice) => {
                          // Check if this is an open invoice (no property)
                          const isOpenInvoice = !invoice.property;
                          
                          // Get Resident ID from invoice property (for property-based invoices)
                          const residentId = isOpenInvoice 
                            ? '—' 
                            : (invoice.property?.resident?.residentId || 
                               invoice.property?.residentId || 
                               '—');
                          
                          return (
                            <TableRow key={invoice._id} hover>
                              <TableCell>
                                <Typography variant="body2" fontWeight={600}>
                                  {invoice.invoiceNumber || 'N/A'}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">
                                  {residentId}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                {isOpenInvoice ? (
                                  <>
                                    <Typography variant="body2">
                                      {invoice.customerName || 'Open Invoice'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {invoice.customerAddress || '—'}
                                    </Typography>
                                  </>
                                ) : (
                                  <>
                                    <Typography variant="body2">
                                      {invoice.property?.propertyName || invoice.property?.plotNumber || 'N/A'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {invoice.property?.address || '—'}
                                    </Typography>
                                  </>
                                )}
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">
                                  {isOpenInvoice 
                                    ? (invoice.customerName || '—')
                                    : (invoice.property?.ownerName || '—')}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">
                                  {getChargeTypesLabel(invoice.chargeTypes)}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                {invoice.periodFrom ? dayjs(invoice.periodFrom).format('MMM D, YYYY') : '—'}
                              </TableCell>
                              <TableCell>
                                {invoice.periodTo ? dayjs(invoice.periodTo).format('MMM D, YYYY') : '—'}
                              </TableCell>
                              <TableCell>
                                {invoice.dueDate ? dayjs(invoice.dueDate).format('MMM D, YYYY') : 'N/A'}
                              </TableCell>
                              {(() => {
                                const totalPaid = invoice.totalPaid || 0;
                                const adjustedGrandTotal = getAdjustedGrandTotal(invoice);
                                const balance = getAdjustedBalance(invoice);
                                const displayStatus =
                                  balance <= 0
                                    ? 'paid'
                                    : totalPaid > 0
                                    ? 'partial_paid'
                                    : 'unpaid';
                                const { color, label } = getPaymentStatusConfig(displayStatus);

                                return (
                                  <>
                                    {/* Grand Total */}
                                    <TableCell align="right">
                                      <Typography fontWeight={600}>
                                        {formatCurrency(adjustedGrandTotal)}
                                      </Typography>
                                    </TableCell>
                                    {/* Paid */}
                                    <TableCell align="right">
                                      {formatCurrency(totalPaid)}
                                    </TableCell>
                                    {/* Balance */}
                                    <TableCell align="right">
                                      <Typography
                                        fontWeight={600}
                                        color={balance > 0 ? 'error.main' : 'success.main'}
                                      >
                                        {formatCurrency(balance)}
                                      </Typography>
                                    </TableCell>
                                    {/* Payment Status */}
                                    <TableCell>
                                      <Chip
                                        label={label}
                                        color={color}
                                        size="small"
                                      />
                                    </TableCell>
                                  </>
                                );
                              })()}
                              <TableCell>
                                <Typography variant="body2">
                                  {invoice.createdBy 
                                    ? `${invoice.createdBy.firstName || ''} ${invoice.createdBy.lastName || ''}`.trim() || 'N/A'
                                    : 'N/A'}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                <Stack direction="row" spacing={1} justifyContent="flex-end">
                                  <Tooltip title="Download Invoice PDF">
                                    <IconButton
                                      size="small"
                                      color="primary"
                                      onClick={() => handleDownloadInvoice(invoice)}
                                    >
                                      <DownloadIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="View Invoice">
                                    <IconButton
                                      size="small"
                                      color="primary"
                                      onClick={() => handleViewInvoice(invoice)}
                                    >
                                      <ViewIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </Stack>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Collapse>
              </Box>
            ))
          )}
          {!loading && invoicesByMonth.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <TablePaginationWrapper
                page={pagination.page}
                rowsPerPage={pagination.rowsPerPage}
                total={pagination.total}
                onPageChange={pagination.handleChangePage}
                onRowsPerPageChange={pagination.handleChangeRowsPerPage}
              />
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default Invoices;

