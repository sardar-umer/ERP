import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Chip,
  Divider,
  Stack,
  Alert,
  Skeleton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Print as PrintIcon,
  Edit as EditIcon,
  Image as ImageIcon,
  Visibility as VisibilityIcon,
  ReceiptLong as ReceiptIcon,
  SwapHoriz as TransferIcon,
  History as HistoryIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchPropertyById, updatePropertyStatus, transferPropertyOwnership } from '../../../services/tajPropertiesService';
import { fetchResidents } from '../../../services/tajResidentsService';
import { getImageUrl, handleImageError } from '../../../utils/imageService';
import { useAuth } from '../../../contexts/AuthContext';
import jsPDF from 'jspdf';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

const propertyStatuses = ['Pending', 'Active', 'Inactive', 'Under Maintenance', 'Rented', 'Available', 'Reserved'];

const TajPropertyDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    newOwnerName: '',
    newContact: '',
    newTenantName: '',
    newTenantPhone: '',
    newTenantEmail: '',
    newTenantCNIC: '',
    residentId: '',
    effectiveDate: dayjs().format('YYYY-MM-DD'),
    notes: ''
  });
  const [residents, setResidents] = useState([]);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');

  useEffect(() => {
    fetchProperty();
  }, [id]);

  useEffect(() => {
    if (transferDialogOpen) {
      fetchResidents({ isActive: 'true', limit: 500 })
        .then((res) => setResidents(res.data?.data || res.data || []))
        .catch(() => setResidents([]));
      if (property) {
        setTransferForm({
          newOwnerName: property.ownerName || '',
          newContact: property.contactNumber || '',
          newTenantName: property.tenantName || '',
          newTenantPhone: property.tenantPhone || '',
          newTenantEmail: property.tenantEmail || '',
          newTenantCNIC: property.tenantCNIC || '',
          residentId: property.resident?._id || property.resident || '',
          effectiveDate: dayjs().format('YYYY-MM-DD'),
          notes: ''
        });
      }
    }
  }, [transferDialogOpen, property]);

  const fetchProperty = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetchPropertyById(id);
      setProperty(response.data?.data || response.data);
    } catch (err) {
      console.error('Error fetching property:', err);
      setError(err.response?.data?.message || 'Failed to fetch property details');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      setStatusUpdating(true);
      setStatusError('');
      // If status is being set to Active, send the current user ID to track who activated it
      const updatedBy = (newStatus === 'Active' && user?._id) ? user._id : null;
      await updatePropertyStatus(id, newStatus, updatedBy);
      await fetchProperty(); // Refresh property data
    } catch (err) {
      setStatusError(err.response?.data?.message || 'Failed to update status');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleTransferFormChange = (field, value) => {
    setTransferForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleTransferOwnership = async () => {
    try {
      setTransferring(true);
      setTransferError('');
      const payload = {
        newOwnerName: transferForm.newOwnerName || undefined,
        newContact: transferForm.newContact || undefined,
        newTenantName: transferForm.newTenantName || undefined,
        newTenantPhone: transferForm.newTenantPhone || undefined,
        newTenantEmail: transferForm.newTenantEmail || undefined,
        newTenantCNIC: transferForm.newTenantCNIC || undefined,
        residentId: transferForm.residentId || undefined,
        effectiveDate: transferForm.effectiveDate || undefined,
        notes: transferForm.notes || undefined
      };
      await transferPropertyOwnership(id, payload);
      setTransferDialogOpen(false);
      await fetchProperty();
    } catch (err) {
      setTransferError(err.response?.data?.message || 'Failed to transfer ownership');
    } finally {
      setTransferring(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Active':
      case 'Available':
      case 'Rented':
        return 'success';
      case 'Pending':
        return 'warning';
      case 'Inactive':
      case 'Under Maintenance':
        return 'error';
      case 'Reserved':
        return 'info';
      default:
        return 'default';
    }
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 0
    }).format(Number(value || 0));

  const handleGenerateVoucher = () => {
    if (!property) return;

    const pdf = new jsPDF('portrait', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const panelWidth = pageWidth / 3;
    const horizontalMargin = 8;
    const contentWidth = panelWidth - horizontalMargin * 0.9;
    const foldTop = 6;
    const foldBottom = pageHeight - 6;

    const safeText = (value, fallback = 'N/A') =>
      value === undefined || value === null || value === ''
        ? fallback
        : value;

    const formatDate = (dateValue) =>
      dateValue ? dayjs(dateValue).format('DD MMM YYYY') : 'N/A';

    const panelSections = [
      {
        title: 'Property Overview',
        items: [
          ['Property Name', safeText(property.propertyName || property.project)],
          ['Property Code', property.srNo ? `SR-${property.srNo}` : safeText(property._id)],
          ['Type / Zone', `${safeText(property.propertyType)} • ${safeText(property.zoneType)}`],
          ['Category', safeText(property.categoryType)],
          ['Plot / RDA', `Plot ${safeText(property.plotNumber)} • RDA ${safeText(property.rdaNumber)}`],
          ['Address', safeText(property.address || property.fullAddress)],
          ['Area', `${safeText(property.areaValue || 0)} ${safeText(property.areaUnit)}`],
          ['Status', safeText(property.status)]
        ]
      },
      {
        title: 'Owner & Occupant',
        items: [
          ['Owner Name', safeText(property.ownerName)],
          ['Owner Contact', safeText(property.contactNumber)],
          ['Family Status', safeText(property.familyStatus)],
          ['Tenant Name', safeText(property.tenantName)],
          ['Tenant Contact', safeText(property.tenantPhone)],
          ['Tenant CNIC', safeText(property.tenantCNIC)],
          ['Expected Rent', formatCurrency(property.expectedRent || 0)],
          ['Security Deposit', formatCurrency(property.securityDeposit || 0)],
          ['Agreement Period',
            property.rentalAgreement
              ? `${formatDate(property.rentalAgreement?.startDate)} → ${formatDate(property.rentalAgreement?.endDate)}`
              : 'No rental agreement'
          ]
        ]
      },
      {
        title: 'Utilities & Notes',
        items: [
          ['Electricity & Water', property.hasElectricityWater ? 'Available' : 'Not Available'],
          ['Consumer', safeText(property.electricityWaterConsumer)],
          ['Meter Number', safeText(property.electricityWaterMeterNo)],
          ['Connection Type', safeText(property.connectionType)],
          ['Occupation Status', safeText(property.occupiedUnderConstruction)],
          ['Occupation Date', formatDate(property.dateOfOccupation)],
          ['Meter Type', safeText(property.meterType)],
          ['Description', safeText(property.description)],
          ['Notes', safeText(property.notes)]
        ]
      }
    ];

    // Header
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('TAJ UTILITIES — PROPERTY VOUCHER', pageWidth / 2, 12, { align: 'center' });
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(
      `Generated ${dayjs().format('DD MMM YYYY HH:mm')} • Property ID: ${property._id}`,
      pageWidth / 2,
      18,
      { align: 'center' }
    );

    // Fold guides
    pdf.setDrawColor(180);
    pdf.setLineWidth(0.2);
    if (pdf.setLineDash) {
      pdf.setLineDash([1, 2], 0);
    }
    [panelWidth, panelWidth * 2].forEach((xPos) => {
      pdf.line(xPos, foldTop, xPos, foldBottom);
    });
    if (pdf.setLineDash) {
      pdf.setLineDash([], 0);
    }

    const drawPanel = (panelIndex, panel) => {
      const startX = panelIndex * panelWidth + horizontalMargin / 2;
      let cursorY = 26;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text(panel.title, startX + (panelWidth / 2) - (horizontalMargin / 2), cursorY, { align: 'center' });
      cursorY += 4;

      panel.items.forEach(([label, value]) => {
        if (!value || value === 'N/A' || value === 'No rental agreement') {
          // Still show the label with available fallback text
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        cursorY += 5;
        pdf.text(label, startX, cursorY);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        const wrappedText = pdf.splitTextToSize(
          typeof value === 'string' ? value : String(value),
          contentWidth
        );
        wrappedText.forEach((line) => {
          cursorY += 4;
          pdf.text(line, startX, cursorY);
        });

        cursorY += 2;
      });
    };

    panelSections.forEach((panel, index) => drawPanel(index, panel));

    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.text(
      'Fold along dotted lines • Attach voucher with physical property file and digital record',
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );

    const sanitizedName = (property.propertyName || 'taj-property').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '_');
    pdf.save(`Voucher_${sanitizedName || property._id}.pdf`);
  };

  const handlePrint = () => {
    if (!property) return;
    
    const printWindow = window.open('', '_blank');
    const printDate = new Date().toLocaleString();
    
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Property Details - ${property?.propertyName || 'N/A'}</title>
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
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Property Details</h1>
            <p><strong>Property Name:</strong> ${property?.propertyName || 'N/A'}</p>
            <p><strong>Property Code:</strong> ${property?.srNo ? `SR-${property.srNo}` : 'N/A'}</p>
          </div>

          <div class="section">
            <div class="section-title">Property Information</div>
            <div class="field-row">
              <div class="field-label">Property Type:</div>
              <div class="field-value">${property?.propertyType || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Zone Type:</div>
              <div class="field-value">${property?.zoneType || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Category Type:</div>
              <div class="field-value">${property?.categoryType || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Status:</div>
              <div class="field-value">${property?.status || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Plot Number:</div>
              <div class="field-value">${property?.plotNumber || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">RDA Number:</div>
              <div class="field-value">${property?.rdaNumber || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Area:</div>
              <div class="field-value">${property?.areaValue || 0} ${property?.areaUnit || 'Sq Ft'}</div>
            </div>
            ${property?.bedrooms ? `
            <div class="field-row">
              <div class="field-label">Bedrooms:</div>
              <div class="field-value">${property.bedrooms}</div>
            </div>
            ` : ''}
            ${property?.bathrooms ? `
            <div class="field-row">
              <div class="field-label">Bathrooms:</div>
              <div class="field-value">${property.bathrooms}</div>
            </div>
            ` : ''}
            ${property?.parking ? `
            <div class="field-row">
              <div class="field-label">Parking Spaces:</div>
              <div class="field-value">${property.parking}</div>
            </div>
            ` : ''}
          </div>

          <div class="section">
            <div class="section-title">Location Details</div>
            <div class="field-row">
              <div class="field-label">Address:</div>
              <div class="field-value">${property?.address || property?.fullAddress || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Street:</div>
              <div class="field-value">${property?.street || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Sector:</div>
              <div class="field-value">${property?.sector || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Block:</div>
              <div class="field-value">${property?.block || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">City:</div>
              <div class="field-value">${property?.city || 'N/A'}</div>
            </div>
            ${property?.project ? `
            <div class="field-row">
              <div class="field-label">Project:</div>
              <div class="field-value">${property.project}</div>
            </div>
            ` : ''}
          </div>

          <div class="section">
            <div class="section-title">Owner Information</div>
            <div class="field-row">
              <div class="field-label">Owner Name:</div>
              <div class="field-value">${property?.ownerName || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Contact Number:</div>
              <div class="field-value">${property?.contactNumber || 'N/A'}</div>
            </div>
            ${property?.familyStatus ? `
            <div class="field-row">
              <div class="field-label">Family Status:</div>
              <div class="field-value">${property.familyStatus}</div>
            </div>
            ` : ''}
          </div>

          ${property?.categoryType === 'Personal Rent' ? `
          <div class="section">
            <div class="section-title">Rental Agreement Details</div>
            ${property?.rentalAgreement ? `
            <div class="field-row">
              <div class="field-label">Agreement Number:</div>
              <div class="field-value">${property.rentalAgreement.agreementNumber || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Agreement Status:</div>
              <div class="field-value">${property.rentalAgreement.status || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Start Date:</div>
              <div class="field-value">${property.rentalAgreement.startDate ? dayjs(property.rentalAgreement.startDate).format('DD/MM/YYYY') : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">End Date:</div>
              <div class="field-value">${property.rentalAgreement.endDate ? dayjs(property.rentalAgreement.endDate).format('DD/MM/YYYY') : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Tenant Name:</div>
              <div class="field-value">${property.rentalAgreement.tenantName || property.rentalAgreement.landlordName || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Tenant Contact:</div>
              <div class="field-value">${property.rentalAgreement.tenantContact || property.rentalAgreement.landlordContact || 'N/A'}</div>
            </div>
            ${(property.rentalAgreement.tenantIdCard || property.rentalAgreement.landlordIdCard) ? `
            <div class="field-row">
              <div class="field-label">Tenant ID Card:</div>
              <div class="field-value">${property.rentalAgreement.tenantIdCard || property.rentalAgreement.landlordIdCard}</div>
            </div>
            ` : ''}
            <div class="field-row">
              <div class="field-label">Monthly Rent:</div>
              <div class="field-value">${formatCurrency(property.rentalAgreement.monthlyRent || 0)}</div>
            </div>
            ${property.rentalAgreement.securityDeposit ? `
            <div class="field-row">
              <div class="field-label">Security Deposit (Agreement):</div>
              <div class="field-value">${formatCurrency(property.rentalAgreement.securityDeposit)}</div>
            </div>
            ` : ''}
            <div class="field-row">
              <div class="field-label">Property Name (Agreement):</div>
              <div class="field-value">${property.rentalAgreement.propertyName || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Property Address (Agreement):</div>
              <div class="field-value">${property.rentalAgreement.propertyAddress || 'N/A'}</div>
            </div>
            ${property.rentalAgreement.terms ? `
            <div class="field-row">
              <div class="field-label">Agreement Terms:</div>
              <div class="field-value">${property.rentalAgreement.terms}</div>
            </div>
            ` : ''}
            ` : '<div class="field-row"><div class="field-value">No rental agreement attached</div></div>'}
          </div>
          
          <div class="section">
            <div class="section-title">Tenant Information</div>
            ${property?.tenantName ? `
            <div class="field-row">
              <div class="field-label">Tenant Name:</div>
              <div class="field-value">${property.tenantName}</div>
            </div>
            ` : ''}
            ${property?.tenantPhone ? `
            <div class="field-row">
              <div class="field-label">Tenant Phone:</div>
              <div class="field-value">${property.tenantPhone}</div>
            </div>
            ` : ''}
            ${property?.tenantEmail ? `
            <div class="field-row">
              <div class="field-label">Tenant Email:</div>
              <div class="field-value">${property.tenantEmail}</div>
            </div>
            ` : ''}
            ${property?.tenantCNIC ? `
            <div class="field-row">
              <div class="field-label">Tenant CNIC:</div>
              <div class="field-value">${property.tenantCNIC}</div>
            </div>
            ` : ''}
            <div class="field-row">
              <div class="field-label">Expected Rent:</div>
              <div class="field-value">${formatCurrency(property?.expectedRent || 0)}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Security Deposit:</div>
              <div class="field-value">${formatCurrency(property?.securityDeposit || 0)}</div>
            </div>
          </div>
          ` : ''}

          ${property?.hasElectricityWater ? `
          <div class="section">
            <div class="section-title">Electricity & Water Details</div>
            ${property?.electricityWaterConsumer ? `
            <div class="field-row">
              <div class="field-label">Consumer:</div>
              <div class="field-value">${property.electricityWaterConsumer}</div>
            </div>
            ` : ''}
            ${property?.electricityWaterMeterNo ? `
            <div class="field-row">
              <div class="field-label">Meter No:</div>
              <div class="field-value">${property.electricityWaterMeterNo}</div>
            </div>
            ` : ''}
            ${property?.connectionType ? `
            <div class="field-row">
              <div class="field-label">Connection Type:</div>
              <div class="field-value">${property.connectionType}</div>
            </div>
            ` : ''}
            ${property?.occupiedUnderConstruction ? `
            <div class="field-row">
              <div class="field-label">Status:</div>
              <div class="field-value">${property.occupiedUnderConstruction}</div>
            </div>
            ` : ''}
            ${property?.dateOfOccupation ? `
            <div class="field-row">
              <div class="field-label">Date of Occupation:</div>
              <div class="field-value">${dayjs(property.dateOfOccupation).format('DD/MM/YYYY')}</div>
            </div>
            ` : ''}
            ${property?.meterType ? `
            <div class="field-row">
              <div class="field-label">Meter Type:</div>
              <div class="field-value">${property.meterType}</div>
            </div>
            ` : ''}
          </div>
          ` : ''}

          ${property?.description ? `
          <div class="section">
            <div class="section-title">Description</div>
            <div class="field-value">${property.description}</div>
          </div>
          ` : ''}

          ${property?.notes ? `
          <div class="section">
            <div class="section-title">Notes</div>
            <div class="field-value">${property.notes}</div>
          </div>
          ` : ''}

          <div class="section">
            <div class="section-title">System Information</div>
            <div class="field-row">
              <div class="field-label">Created Date:</div>
              <div class="field-value">${property?.createdAt ? new Date(property.createdAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Last Updated:</div>
              <div class="field-value">${property?.updatedAt ? new Date(property.updatedAt).toLocaleString() : 'N/A'}</div>
            </div>
          </div>

          <div class="footer">
            <p><strong>Generated from SGC ERP System - Taj Utilities Properties</strong></p>
            <p>Property ID: ${property?._id || 'N/A'} | Printed: ${printDate}</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(brandPrintHtml(printContent, { title: 'Property Details' })); // Tovus ERP branded print
    printWindow.document.close();

    printWindow.onload = function() {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <Skeleton variant="rectangular" width={100} height={36} sx={{ borderRadius: 1 }} />
          <Skeleton variant="text" width="35%" height={40} />
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Grid container spacing={3}>
                  {[1, 2, 3, 4, 5, 6].map((item) => (
                    <Grid item xs={12} sm={6} key={item}>
                      <Skeleton variant="text" height={16} width="40%" sx={{ mb: 1 }} />
                      <Skeleton variant="text" height={20} width="70%" />
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Skeleton variant="text" width="50%" height={28} sx={{ mb: 2 }} />
                <Box sx={{ textAlign: 'center' }}>
                  <Skeleton variant="rectangular" width={120} height={80} sx={{ mb: 2, mx: 'auto' }} />
                  <Skeleton variant="rectangular" height={24} width={80} sx={{ mx: 'auto' }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/taj-properties')}>
          Go Back
        </Button>
      </Box>
    );
  }

  if (!property) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>Property not found</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/taj-properties')}>
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" mb={3}>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/taj-properties')}>
          Back
        </Button>
        <Typography variant="h4" component="h1" fontWeight={700}>
          Property Details
        </Typography>
        <Button
          variant="outlined"
          startIcon={<TransferIcon />}
          onClick={() => setTransferDialogOpen(true)}
          sx={{ ml: 'auto' }}
        >
          Transfer Ownership
        </Button>
        <Button
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={() => navigate(`/finance/taj-utilities-charges/taj-properties?edit=${id}`)}
        >
          Edit
        </Button>
        <Button
          variant="contained"
          color="primary"
          startIcon={<ReceiptIcon />}
          onClick={handleGenerateVoucher}
        >
          Download Voucher
        </Button>
        <Button
          variant="outlined"
          startIcon={<PrintIcon />}
          onClick={handlePrint}
        >
          Print
        </Button>
      </Stack>

      {statusError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setStatusError('')}>
          {statusError}
        </Alert>
      )}

      <Dialog open={transferDialogOpen} onClose={() => !transferring && setTransferDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Transfer Ownership / Tenant</DialogTitle>
        <DialogContent>
          {transferError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setTransferError('')}>
              {transferError}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">New Owner</Typography>
            <TextField
              label="Owner Name"
              value={transferForm.newOwnerName}
              onChange={(e) => handleTransferFormChange('newOwnerName', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Contact Number"
              value={transferForm.newContact}
              onChange={(e) => handleTransferFormChange('newContact', e.target.value)}
              fullWidth
              size="small"
            />
            <FormControl fullWidth size="small">
              <InputLabel>Link to Resident Profile</InputLabel>
              <Select
                value={transferForm.residentId}
                label="Link to Resident Profile"
                onChange={(e) => handleTransferFormChange('residentId', e.target.value)}
              >
                <MenuItem value="">None</MenuItem>
                {residents.map((r) => (
                  <MenuItem key={r._id} value={r._id}>
                    {r.name || r.residentId || 'Unnamed'} {r.residentId ? `(${r.residentId})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>New Tenant (if applicable)</Typography>
            <TextField
              label="Tenant Name"
              value={transferForm.newTenantName}
              onChange={(e) => handleTransferFormChange('newTenantName', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Tenant Phone"
              value={transferForm.newTenantPhone}
              onChange={(e) => handleTransferFormChange('newTenantPhone', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Tenant Email"
              value={transferForm.newTenantEmail}
              onChange={(e) => handleTransferFormChange('newTenantEmail', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Tenant CNIC"
              value={transferForm.newTenantCNIC}
              onChange={(e) => handleTransferFormChange('newTenantCNIC', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Effective Date"
              type="date"
              value={transferForm.effectiveDate}
              onChange={(e) => handleTransferFormChange('effectiveDate', e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Notes"
              value={transferForm.notes}
              onChange={(e) => handleTransferFormChange('notes', e.target.value)}
              fullWidth
              size="small"
              multiline
              rows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransferDialogOpen(false)} disabled={transferring}>Cancel</Button>
          <Button variant="contained" onClick={handleTransferOwnership} disabled={transferring}>
            {transferring ? 'Transferring…' : 'Transfer'}
          </Button>
        </DialogActions>
      </Dialog>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight={600}>
                  Property Information
                </Typography>
                <Chip
                  label={property.status || 'Pending'}
                  color={getStatusColor(property.status)}
                  size="small"
                />
              </Stack>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Property Name
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.propertyName || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Property Type
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.propertyType || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Zone Type
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.zoneType || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Category Type
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.categoryType || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Plot Number
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.plotNumber || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    RDA Number
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.rdaNumber || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Area
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.areaValue || 0} {property.areaUnit || 'Sq Ft'}
                  </Typography>
                </Grid>
                {property.bedrooms && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Bedrooms
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {property.bedrooms}
                    </Typography>
                  </Grid>
                )}
                {property.bathrooms && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Bathrooms
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {property.bathrooms}
                    </Typography>
                  </Grid>
                )}
                {property.parking && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Parking Spaces
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {property.parking}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Location Details
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Full Address
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.address || property.fullAddress || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Street
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.street || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Sector
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.sector || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Block
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.block || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    City
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.city || '—'}
                  </Typography>
                </Grid>
                {property.project && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Project
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {property.project}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Owner Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Owner Name
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.ownerName || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Contact Number
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.contactNumber || '—'}
                  </Typography>
                </Grid>
                {property.familyStatus && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Family Status
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {property.familyStatus}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          {(property.ownershipHistory?.length > 0) && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                  <HistoryIcon color="action" />
                  <Typography variant="h6" fontWeight={600}>
                    Ownership & Tenant History
                  </Typography>
                </Stack>
                <Divider sx={{ mb: 2 }} />
                <Stack spacing={2}>
                  {[...(property.ownershipHistory || [])].reverse().map((entry, idx) => (
                    <Box
                      key={idx}
                      sx={{
                        p: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        bgcolor: 'grey.50'
                      }}
                    >
                      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                        {dayjs(entry.effectiveDate).format('DD MMM YYYY')}
                        {entry.transferredBy && (
                          <> • By {entry.transferredBy?.firstName} {entry.transferredBy?.lastName || entry.transferredBy?.email}</>
                        )}
                      </Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                          <Typography variant="caption" color="text.secondary" display="block">Previous</Typography>
                          <Typography variant="body2"><strong>Owner:</strong> {entry.previousOwnerName || '—'}</Typography>
                          {entry.previousContact && <Typography variant="body2"><strong>Contact:</strong> {entry.previousContact}</Typography>}
                          {entry.previousTenantName && <Typography variant="body2"><strong>Tenant:</strong> {entry.previousTenantName}</Typography>}
                          {(entry.previousResident?.name || entry.previousResident?.residentId) && (
                            <Typography variant="body2"><strong>Resident profile:</strong> {entry.previousResident?.name || entry.previousResident?.residentId}</Typography>
                          )}
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <Typography variant="caption" color="text.secondary" display="block">New</Typography>
                          <Typography variant="body2"><strong>Owner:</strong> {entry.newOwnerName || '—'}</Typography>
                          {entry.newContact && <Typography variant="body2"><strong>Contact:</strong> {entry.newContact}</Typography>}
                          {entry.newTenantName && <Typography variant="body2"><strong>Tenant:</strong> {entry.newTenantName}</Typography>}
                          {(entry.newResident?.name || entry.newResident?.residentId) && (
                            <Typography variant="body2"><strong>Resident profile:</strong> {entry.newResident?.name || entry.newResident?.residentId}</Typography>
                          )}
                        </Grid>
                        {entry.notes && (
                          <Grid item xs={12}>
                            <Typography variant="body2" color="text.secondary"><em>{entry.notes}</em></Typography>
                          </Grid>
                        )}
                      </Grid>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {property.categoryType === 'Personal Rent' && (
            <>
              {property.rentalAgreement ? (
                <Card sx={{ mb: 3 }}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                      <Typography variant="h6" fontWeight={600}>
                        Rental Agreement Details
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <Chip
                          label={property.rentalAgreement.status || 'N/A'}
                          color={getStatusColor(property.rentalAgreement.status)}
                          size="small"
                        />
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<VisibilityIcon />}
                          onClick={() => navigate(`/finance/taj-utilities-charges/rental-agreements/${property.rentalAgreement._id}`)}
                        >
                          View Full Agreement
                        </Button>
                      </Stack>
                    </Stack>
                    <Divider sx={{ mb: 2 }} />
                    
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Agreement Number
                        </Typography>
                        <Typography variant="body1" fontWeight={600} sx={{ mb: 2 }}>
                          {property.rentalAgreement.agreementNumber || '—'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Agreement Status
                        </Typography>
                        <Box sx={{ mb: 2 }}>
                          <Chip
                            label={property.rentalAgreement.status || 'N/A'}
                            color={getStatusColor(property.rentalAgreement.status)}
                            size="small"
                          />
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Start Date
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.rentalAgreement.startDate
                            ? dayjs(property.rentalAgreement.startDate).format('DD/MM/YYYY')
                            : '—'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          End Date
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.rentalAgreement.endDate
                            ? dayjs(property.rentalAgreement.endDate).format('DD/MM/YYYY')
                            : '—'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12}>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 1 }}>
                          Tenant Information
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Tenant Name
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.rentalAgreement.tenantName || property.rentalAgreement.landlordName || '—'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Tenant Contact
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.rentalAgreement.tenantContact || property.rentalAgreement.landlordContact || '—'}
                        </Typography>
                      </Grid>
                      {(property.rentalAgreement.tenantIdCard || property.rentalAgreement.landlordIdCard) && (
                        <Grid item xs={12} sm={6}>
                          <Typography variant="subtitle2" color="text.secondary">
                            Tenant ID Card
                          </Typography>
                          <Typography variant="body1" sx={{ mb: 2 }}>
                            {property.rentalAgreement.tenantIdCard || property.rentalAgreement.landlordIdCard}
                          </Typography>
                        </Grid>
                      )}
                      <Grid item xs={12}>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 1 }}>
                          Financial Details
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Monthly Rent
                        </Typography>
                        <Typography variant="body1" fontWeight={600} sx={{ mb: 2 }}>
                          {formatCurrency(property.rentalAgreement.monthlyRent || 0)}
                        </Typography>
                      </Grid>
                      {property.rentalAgreement.securityDeposit && (
                        <Grid item xs={12} sm={6}>
                          <Typography variant="subtitle2" color="text.secondary">
                            Security Deposit (Agreement)
                          </Typography>
                          <Typography variant="body1" fontWeight={600} sx={{ mb: 2 }}>
                            {formatCurrency(property.rentalAgreement.securityDeposit)}
                          </Typography>
                        </Grid>
                      )}
                      {property.rentalAgreement.increasedRent && property.rentalAgreement.increasedRent !== property.rentalAgreement.monthlyRent && (
                        <>
                          <Grid item xs={12} sm={6}>
                            <Typography variant="subtitle2" color="text.secondary">
                              Rent After One Year
                            </Typography>
                            <Typography variant="body1" fontWeight={600} color="success.main" sx={{ mb: 2 }}>
                              {formatCurrency(property.rentalAgreement.increasedRent)}
                            </Typography>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <Typography variant="subtitle2" color="text.secondary">
                              Annual Increase
                            </Typography>
                            <Typography variant="body1" sx={{ mb: 2 }}>
                              {property.rentalAgreement.annualRentIncreaseType === 'percentage' 
                                ? `${property.rentalAgreement.annualRentIncreaseValue || 0}%`
                                : `PKR ${(property.rentalAgreement.annualRentIncreaseValue || 0).toLocaleString()}`}
                            </Typography>
                          </Grid>
                        </>
                      )}
                      <Grid item xs={12}>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 1 }}>
                          Property Information (Agreement)
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Property Name
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.rentalAgreement.propertyName || '—'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Property Address
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.rentalAgreement.propertyAddress || '—'}
                        </Typography>
                      </Grid>
                      {property.rentalAgreement.terms && (
                        <>
                          <Grid item xs={12}>
                            <Divider sx={{ my: 1 }} />
                            <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 1 }}>
                              Agreement Terms
                            </Typography>
                          </Grid>
                          <Grid item xs={12}>
                            <Typography variant="body2" sx={{ 
                              p: 2, 
                              bgcolor: 'grey.50', 
                              borderRadius: 1,
                              whiteSpace: 'pre-wrap'
                            }}>
                              {property.rentalAgreement.terms}
                            </Typography>
                          </Grid>
                        </>
                      )}
                      {property.rentalAgreement.agreementImage && (
                        <>
                          <Grid item xs={12}>
                            <Divider sx={{ my: 1 }} />
                            <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 1 }}>
                              Agreement Image
                            </Typography>
                          </Grid>
                          <Grid item xs={12}>
                            <Box
                              sx={{
                                position: 'relative',
                                width: '100%',
                                maxWidth: 600,
                                cursor: 'pointer',
                                '&:hover': {
                                  opacity: 0.9
                                }
                              }}
                              onClick={() => {
                                const imageUrl = getImageUrl(property.rentalAgreement.agreementImage);
                                window.open(imageUrl, '_blank');
                              }}
                            >
                              <img
                                src={getImageUrl(property.rentalAgreement.agreementImage)}
                                alt="Rental Agreement"
                                onError={handleImageError}
                                style={{
                                  width: '100%',
                                  height: 'auto',
                                  borderRadius: 8,
                                  border: '1px solid #e0e0e0'
                                }}
                              />
                              <Box
                                sx={{
                                  position: 'absolute',
                                  top: 8,
                                  right: 8,
                                  bgcolor: 'rgba(0,0,0,0.5)',
                                  color: 'white',
                                  borderRadius: 1,
                                  p: 0.5,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 0.5
                                }}
                              >
                                <ImageIcon fontSize="small" />
                                <Typography variant="caption">Click to view full size</Typography>
                              </Box>
                            </Box>
                          </Grid>
                        </>
                      )}
                      <Grid item xs={12}>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                          Agreement Created: {property.rentalAgreement.createdAt
                            ? dayjs(property.rentalAgreement.createdAt).format('DD/MM/YYYY HH:mm')
                            : 'N/A'}
                        </Typography>
                        {property.rentalAgreement.updatedAt && (
                          <Typography variant="subtitle2" color="text.secondary">
                            Last Updated: {dayjs(property.rentalAgreement.updatedAt).format('DD/MM/YYYY HH:mm')}
                          </Typography>
                        )}
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              ) : (
                <Card sx={{ mb: 3 }}>
                  <CardContent>
                    <Alert severity="info">No rental agreement attached to this property</Alert>
                  </CardContent>
                </Card>
              )}

              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom fontWeight={600}>
                    Tenant Information
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                  
                  <Grid container spacing={2}>
                    {property.tenantName && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Tenant Name
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.tenantName}
                        </Typography>
                      </Grid>
                    )}
                    {property.tenantPhone && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Tenant Phone
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.tenantPhone}
                        </Typography>
                      </Grid>
                    )}
                    {property.tenantEmail && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Tenant Email
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.tenantEmail}
                        </Typography>
                      </Grid>
                    )}
                    {property.tenantCNIC && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Tenant CNIC
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.tenantCNIC}
                        </Typography>
                      </Grid>
                    )}
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Expected Rent
                      </Typography>
                      <Typography variant="body1" fontWeight={600} sx={{ mb: 2 }}>
                        {formatCurrency(property.expectedRent || 0)}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Security Deposit
                      </Typography>
                      <Typography variant="body1" fontWeight={600} sx={{ mb: 2 }}>
                        {formatCurrency(property.securityDeposit || 0)}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </>
          )}

          {property.hasElectricityWater && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Electricity & Water Details
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                <Grid container spacing={2}>
                  {property.electricityWaterConsumer && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Consumer
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        {property.electricityWaterConsumer}
                      </Typography>
                    </Grid>
                  )}
                  {property.electricityWaterMeterNo && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Meter No
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        {property.electricityWaterMeterNo}
                      </Typography>
                    </Grid>
                  )}
                  {property.connectionType && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Connection Type
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        {property.connectionType}
                      </Typography>
                    </Grid>
                  )}
                  {property.occupiedUnderConstruction && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Status
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        {property.occupiedUnderConstruction}
                      </Typography>
                    </Grid>
                  )}
                  {property.dateOfOccupation && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Date of Occupation
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        {dayjs(property.dateOfOccupation).format('DD/MM/YYYY')}
                      </Typography>
                    </Grid>
                  )}
                  {property.meterType && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Meter Type
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        {property.meterType}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </CardContent>
            </Card>
          )}

          {property.description && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Description
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1">{property.description}</Typography>
              </CardContent>
            </Card>
          )}

          {property.notes && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Notes
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1">{property.notes}</Typography>
              </CardContent>
            </Card>
          )}
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ position: 'sticky', top: 20 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Status Control
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <FormControl fullWidth>
                <InputLabel>Property Status</InputLabel>
                <Select
                  value={property.status || 'Pending'}
                  label="Property Status"
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={statusUpdating}
                >
                  {propertyStatuses.map((status) => (
                    <MenuItem key={status} value={status}>
                      {status}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Divider sx={{ my: 3 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                System Information
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Created:</strong>{' '}
                {property.createdAt
                  ? dayjs(property.createdAt).format('DD/MM/YYYY HH:mm')
                  : 'N/A'}
              </Typography>
              {property.createdBy && (
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>Created By:</strong>{' '}
                  {property.createdBy.firstName && property.createdBy.lastName
                    ? `${property.createdBy.firstName} ${property.createdBy.lastName}`
                    : property.createdBy.email || 'N/A'}
                  {property.createdBy._id && (
                    <span style={{ color: '#666', fontSize: '0.85em', marginLeft: '8px' }}>
                      (ID: {property.createdBy._id})
                    </span>
                  )}
                </Typography>
              )}
              {property.status === 'Active' && property.updatedBy && (
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>Activated By:</strong>{' '}
                  {property.updatedBy.firstName && property.updatedBy.lastName
                    ? `${property.updatedBy.firstName} ${property.updatedBy.lastName}`
                    : property.updatedBy.email || 'N/A'}
                  {property.updatedBy._id && (
                    <span style={{ color: '#666', fontSize: '0.85em', marginLeft: '8px' }}>
                      (ID: {property.updatedBy._id})
                    </span>
                  )}
                </Typography>
              )}
              <Typography variant="body2">
                <strong>Last Updated:</strong>{' '}
                {property.updatedAt
                  ? dayjs(property.updatedAt).format('DD/MM/YYYY HH:mm')
                  : 'N/A'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TajPropertyDetail;

