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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Menu,
  MenuItem
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Print as PrintIcon,
  Receipt as ReceiptIcon,
  Payment as PaymentIcon,
  Visibility as VisibilityIcon,
  Close as CloseIcon,
  Home as HomeIcon,
  Person as PersonIcon,
  Description as DescriptionIcon,
  AttachMoney as MoneyIcon,
  FiberManualRecord as StatusIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchPropertyById, fetchInvoice, updatePaymentStatus } from '../../../services/tajRentalManagementService';
import { generateRentInvoicePDF } from '../../../utils/invoicePDFGenerators';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

const paymentStatuses = ['Draft', 'Unpaid', 'Pending Approval', 'Approved', 'Rejected', 'Cancelled'];

const RentalManagementDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paymentDetailsDialog, setPaymentDetailsDialog] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [statusMenuAnchor, setStatusMenuAnchor] = useState(null);
  const [statusMenuPayment, setStatusMenuPayment] = useState(null);

  useEffect(() => {
    fetchProperty();
  }, [id]);

  const fetchProperty = async () => {
    try {
      const response = await fetchPropertyById(id);
      setProperty(response.data?.data);
    } catch (error) {
      console.error('Error fetching property:', error);
      setError('Failed to fetch property details');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Available': return 'success';
      case 'Rented': return 'error';
      case 'Under Maintenance': return 'warning';
      case 'Reserved': return 'info';
      default: return 'default';
    }
  };

  const totalPayments = (payments) => {
    return payments?.reduce((sum, p) => sum + (p.totalAmount || p.amount || 0), 0) || 0;
  };

  const getPaymentStatusConfig = (status) => {
    const normalized = status || 'Approved';
    switch (normalized) {
      case 'Draft':
        return { color: 'default', label: 'Draft', iconColor: 'text.secondary' };
      case 'Unpaid':
        return { color: 'info', label: 'Unpaid', iconColor: 'info.main' };
      case 'Pending Approval':
        return { color: 'warning', label: 'Pending Approval', iconColor: 'warning.main' };
      case 'Rejected':
        return { color: 'error', label: 'Rejected', iconColor: 'error.main' };
      case 'Cancelled':
        return { color: 'default', label: 'Cancelled', iconColor: 'text.secondary' };
      case 'Approved':
      default:
        return { color: 'success', label: 'Approved', iconColor: 'success.main' };
    }
  };

  const buildInvoiceForPdf = (invoiceData) => {
    if (!invoiceData || !property) return null;
    const amount = invoiceData.amount ?? invoiceData.totalAmount ?? 0;
    const arrears = invoiceData.arrears ?? 0;
    const totalAmount = (invoiceData.totalAmount ?? amount + arrears) || (amount + arrears);
    return {
      ...invoiceData,
      property,
      chargeTypes: ['RENT'],
      charges: invoiceData.charges?.map((c) => ({ type: 'RENT', amount: c.amount ?? amount, arrears: c.arrears ?? arrears })) ?? [{ type: 'RENT', amount, arrears }],
      periodFrom: invoiceData.periodFrom,
      periodTo: invoiceData.periodTo,
      grandTotal: totalAmount,
      totalPaid: 0,
      invoiceNumber: invoiceData.invoiceNumber,
      dueDate: invoiceData.dueDate,
      invoiceDate: invoiceData.invoicingDate ?? invoiceData.periodFrom,
    };
  };

  const openInvoicePdfForPayment = async (payment) => {
    try {
      const response = await fetchInvoice(id, payment._id);
      const invoiceForPdf = buildInvoiceForPdf(response.data?.data);
      if (invoiceForPdf) await generateRentInvoicePDF(invoiceForPdf, property, { openInNewTab: true });
    } catch (err) {
      console.error('Error opening invoice PDF:', err);
    }
  };

  const handleViewPaymentDetails = async (payment) => {
    setSelectedPayment(payment);
    setPaymentDetailsDialog(true);
    await openInvoicePdfForPayment(payment);
  };

  const handleViewInvoicePDF = async () => {
    if (!selectedPayment) return;
    await openInvoicePdfForPayment(selectedPayment);
    setPaymentDetailsDialog(false);
  };

  const handlePrintInvoice = async (paymentId) => {
    try {
      const response = await fetchInvoice(id, paymentId);
      const invoiceData = response.data?.data;
      
      if (!invoiceData) {
        alert('Invoice data not found');
        return;
      }

      // Create a new window for printing
      const printWindow = window.open('', '_blank');
      const printDate = new Date().toLocaleString();
      
      const printContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Invoice - ${invoiceData.invoiceNumber || 'N/A'}</title>
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
                font-size: 24px;
                font-weight: bold;
              }
              .section {
                margin-bottom: 25px;
                page-break-inside: avoid;
                border: 1px solid #ccc;
                padding: 15px;
              }
              .section-title {
                background-color: #e0e0e0;
                padding: 10px 15px;
                margin: -15px -15px 15px -15px;
                border-bottom: 2px solid #000;
                font-weight: bold;
                font-size: 16px;
                color: #000;
                text-transform: uppercase;
              }
              .field-row {
                display: flex;
                margin-bottom: 8px;
                border-bottom: 1px dotted #999;
                padding-bottom: 5px;
              }
              .field-label {
                font-weight: bold;
                min-width: 180px;
                color: #000;
                font-size: 13px;
              }
              .field-value {
                flex: 1;
                color: #000;
                font-size: 13px;
              }
              .footer {
                margin-top: 30px;
                padding-top: 15px;
                border-top: 2px solid #000;
                text-align: center;
                color: #333;
                font-size: 11px;
              }
              @media print {
                body { margin: 0; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>RENTAL INVOICE</h1>
              <div>Invoice Number: ${invoiceData.invoiceNumber || 'N/A'}</div>
              <div style="color: #666; font-size: 12px;">Printed on: ${printDate}</div>
            </div>

            <div class="section">
              <div class="section-title">Property & Tenant Information</div>
              <div class="field-row">
                <div class="field-label">Property Type:</div>
                <div class="field-value">${invoiceData.propertyType || 'N/A'}</div>
              </div>
              <div class="field-row">
                <div class="field-label">Tenant Name:</div>
                <div class="field-value">${invoiceData.tenantName || 'N/A'}</div>
              </div>
              <div class="field-row">
                <div class="field-label">Address:</div>
                <div class="field-value">${invoiceData.address || 'N/A'}</div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Payment Details</div>
              <div class="field-row">
                <div class="field-label">Invoice Number:</div>
                <div class="field-value">${invoiceData.invoiceNumber || 'N/A'}</div>
              </div>
              <div class="field-row">
                <div class="field-label">Period From:</div>
                <div class="field-value">${invoiceData.periodFrom ? dayjs(invoiceData.periodFrom).format('DD/MM/YYYY') : 'N/A'}</div>
              </div>
              <div class="field-row">
                <div class="field-label">Period To:</div>
                <div class="field-value">${invoiceData.periodTo ? dayjs(invoiceData.periodTo).format('DD/MM/YYYY') : 'N/A'}</div>
              </div>
              <div class="field-row">
                <div class="field-label">Invoicing Date:</div>
                <div class="field-value">${invoiceData.invoicingDate ? dayjs(invoiceData.invoicingDate).format('DD/MM/YYYY') : 'N/A'}</div>
              </div>
              <div class="field-row">
                <div class="field-label">Due Date:</div>
                <div class="field-value">${invoiceData.dueDate ? dayjs(invoiceData.dueDate).format('DD/MM/YYYY') : 'N/A'}</div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Amount Details</div>
              <div class="field-row">
                <div class="field-label">Amount:</div>
                <div class="field-value">${formatCurrency(invoiceData.amount || 0)}</div>
              </div>
              <div class="field-row">
                <div class="field-label">Arrears:</div>
                <div class="field-value">${formatCurrency(invoiceData.arrears || 0)}</div>
              </div>
              <div class="field-row">
                <div class="field-label">Total Amount:</div>
                <div class="field-value"><strong>${formatCurrency(invoiceData.totalAmount || 0)}</strong></div>
              </div>
            </div>

            <div class="footer">
              <p><strong>Generated from SGC ERP System - Taj Utilities Rental Management</strong></p>
              <p>Invoice Number: ${invoiceData.invoiceNumber || 'N/A'} | Printed: ${printDate}</p>
            </div>
          </body>
        </html>
      `;

      printWindow.document.write(brandPrintHtml(printContent, { title: 'Rent Invoice' })); // Tovus ERP branded print
      printWindow.document.close();

      printWindow.onload = function() {
        printWindow.focus();
        printWindow.print();
        printWindow.close();
      };
    } catch (err) {
      console.error('Error generating invoice:', err);
      alert('Failed to generate invoice');
    }
  };

  const handleOpenStatusMenu = (event, payment) => {
    setStatusMenuAnchor(event.currentTarget);
    setStatusMenuPayment(payment);
  };

  const handleCloseStatusMenu = () => {
    setStatusMenuAnchor(null);
    setStatusMenuPayment(null);
  };

  const handleChangePaymentStatus = async (status) => {
    if (!statusMenuPayment || !property) return;
    try {
      await updatePaymentStatus(property._id, statusMenuPayment._id, status);
      setProperty((prev) => ({
        ...prev,
        payments: prev.payments.map((payment) =>
          payment._id === statusMenuPayment._id ? { ...payment, status } : payment
        )
      }));
      if (selectedPayment && selectedPayment._id === statusMenuPayment._id) {
        setSelectedPayment((prev) => ({ ...prev, status }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update payment status');
    } finally {
      handleCloseStatusMenu();
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <Skeleton variant="rectangular" width={100} height={36} borderRadius={1} />
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
                <Skeleton variant="rectangular" height={200} />
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
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/rental-management')}>
          Go Back
        </Button>
      </Box>
    );
  }

  if (!property) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>Property not found</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/rental-management')}>
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" mb={3}>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/rental-management')}>
          Back
        </Button>
        <Typography variant="h4" component="h1" fontWeight={700}>
          Rental Property Details
        </Typography>
      </Stack>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Property Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Property Code
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.propertyCode}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip
                    label={property.status}
                    color={getStatusColor(property.status)}
                    size="small"
                    sx={{ mb: 2 }}
                  />
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Property Name
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.propertyName}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Property Type
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.propertyType}
                  </Typography>
                </Grid>
                
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Full Address
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.fullAddress}
                  </Typography>
                </Grid>
                
                {(property.street || property.sector || property.block) && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Address Details
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {[
                        property.street,
                        property.sector && `Sector ${property.sector}`,
                        property.block && `Block ${property.block}`,
                        property.floor && `Floor ${property.floor}`,
                        property.unit && `Unit ${property.unit}`,
                        property.city
                      ].filter(Boolean).join(', ')}
                    </Typography>
                  </Grid>
                )}
                
                <Grid item xs={12} sm={4}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Area
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.area?.value || 0} {property.area?.unit || 'Sq Ft'}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Bedrooms
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.bedrooms || 0}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Bathrooms
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.bathrooms || 0}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Parking
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {property.parking || 0}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Tenant Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                {property.tenantName ? (
                  <>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Tenant Name
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        {property.tenantName}
                      </Typography>
                    </Grid>
                    
                    {property.tenantPhone && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Phone
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.tenantPhone}
                        </Typography>
                      </Grid>
                    )}
                    
                    {property.tenantEmail && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          Email
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.tenantEmail}
                        </Typography>
                      </Grid>
                    )}
                    
                    {property.tenantCNIC && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">
                          CNIC
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          {property.tenantCNIC}
                        </Typography>
                      </Grid>
                    )}
                  </>
                ) : (
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">
                      No tenant assigned
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Financial Details
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Expected Rent
                  </Typography>
                  <Typography variant="h6" color="primary" sx={{ mb: 2 }}>
                    {formatCurrency(property.expectedRent || 0)}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Security Deposit
                  </Typography>
                  <Typography variant="h6" color="secondary" sx={{ mb: 2 }}>
                    {formatCurrency(property.securityDeposit || 0)}
                  </Typography>
                </Grid>
                
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Total Payments Received
                  </Typography>
                  <Typography variant="h5" fontWeight={700} color="success.main" sx={{ mb: 2 }}>
                    {formatCurrency(totalPayments(property.payments))}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {property.payments?.length || 0} payment(s) recorded
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {property.rentalAgreement && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Rental Agreement
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Agreement Number
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {property.rentalAgreement?.agreementNumber || 'N/A'}
                    </Typography>
                  </Grid>
                  
                  {property.rentalAgreement?.startDate && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Agreement Period
                      </Typography>
                      <Typography variant="body1" sx={{ mb: 2 }}>
                        {dayjs(property.rentalAgreement.startDate).format('DD/MM/YYYY')} -{' '}
                        {dayjs(property.rentalAgreement.endDate).format('DD/MM/YYYY')}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </CardContent>
            </Card>
          )}

          {property.description && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Description
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                  {property.description}
                </Typography>
              </CardContent>
            </Card>
          )}

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Payment History
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              {property.payments && property.payments.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Invoice #</TableCell>
                        <TableCell>Period</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell align="right">Arrears</TableCell>
                        <TableCell align="right">Total</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Method</TableCell>
                        <TableCell align="center">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {property.payments
                        .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))
                        .map((payment, index) => (
                          <TableRow key={payment._id || index} hover>
                            <TableCell>
                              {dayjs(payment.paymentDate).format('DD/MM/YYYY')}
                            </TableCell>
                            <TableCell>
                              {payment.invoiceNumber || '-'}
                            </TableCell>
                            <TableCell>
                              {payment.periodFrom && payment.periodTo ? (
                                <>
                                  {dayjs(payment.periodFrom).format('DD/MM/YY')} -{' '}
                                  {dayjs(payment.periodTo).format('DD/MM/YY')}
                                </>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(payment.amount || 0)}
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(payment.arrears || 0)}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                              {formatCurrency(payment.totalAmount || (payment.amount || 0) + (payment.arrears || 0))}
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const { color, label, iconColor } = getPaymentStatusConfig(payment.status);
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
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={payment.paymentMethod || 'Bank Transfer'}
                                size="small"
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Stack direction="row" spacing={0.5} justifyContent="center">
                                <Tooltip title="Change Status">
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    onClick={(event) => handleOpenStatusMenu(event, payment)}
                                  >
                                    <StatusIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="View Details">
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    onClick={() => handleViewPaymentDetails(payment)}
                                  >
                                    <VisibilityIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Print Invoice">
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    onClick={() => handlePrintInvoice(payment._id)}
                                  >
                                    <PrintIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Box textAlign="center" py={4}>
                  <PaymentIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    No payments recorded yet
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Summary
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Total Payments
                  </Typography>
                  <Typography variant="h5" fontWeight={700} color="success.main">
                    {formatCurrency(totalPayments(property.payments))}
                  </Typography>
                </Box>
                
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Number of Payments
                  </Typography>
                  <Typography variant="h6">
                    {property.payments?.length || 0}
                  </Typography>
                </Box>
                
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Expected Monthly Rent
                  </Typography>
                  <Typography variant="h6" color="primary">
                    {formatCurrency(property.expectedRent || 0)}
                  </Typography>
                </Box>
                
                {property.rentalAgreement && (
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Agreement Monthly Rent
                    </Typography>
                    <Typography variant="h6">
                      {formatCurrency(property.rentalAgreement?.monthlyRent || 0)}
                    </Typography>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Created Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Typography variant="subtitle2" color="text.secondary">
                Created By
              </Typography>
              <Typography variant="body1" sx={{ mb: 2 }}>
                {property.createdBy?.firstName || ''} {property.createdBy?.lastName || ''}
              </Typography>
              
              <Typography variant="subtitle2" color="text.secondary">
                Created Date
              </Typography>
              <Typography variant="body1" sx={{ mb: 2 }}>
                {dayjs(property.createdAt).format('DD/MM/YYYY HH:mm')}
              </Typography>
              
              <Typography variant="subtitle2" color="text.secondary">
                Last Updated
              </Typography>
              <Typography variant="body1">
                {dayjs(property.updatedAt).format('DD/MM/YYYY HH:mm')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Payment Details Dialog */}
      {property && selectedPayment && (
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
                          {property.propertyCode}
                        </Typography>
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Property Name
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {property.propertyName}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Property Type
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {property.propertyType}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Status
                        </Typography>
                        <Chip
                          label={property.status}
                          size="small"
                          color={getStatusColor(property.status)}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Address
                        </Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {property.fullAddress}
                        </Typography>
                        {(property.street || property.sector || property.block) && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {[property.street, property.sector, property.block].filter(Boolean).join(' • ')}
                            {property.floor && ` • Floor: ${property.floor}`}
                            {property.unit && ` • Unit: ${property.unit}`}
                          </Typography>
                        )}
                      </Grid>
                      {property.area && property.area.value > 0 && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Area
                          </Typography>
                          <Typography variant="body1" fontWeight={600}>
                            {property.area.value} {property.area.unit}
                          </Typography>
                        </Grid>
                      )}
                      {property.bedrooms > 0 && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Bedrooms
                          </Typography>
                          <Typography variant="body1" fontWeight={600}>
                            {property.bedrooms}
                          </Typography>
                        </Grid>
                      )}
                      {property.bathrooms > 0 && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Bathrooms
                          </Typography>
                          <Typography variant="body1" fontWeight={600}>
                            {property.bathrooms}
                          </Typography>
                        </Grid>
                      )}
                      {property.expectedRent > 0 && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Expected Rent
                          </Typography>
                          <Typography variant="body1" fontWeight={600} color="primary">
                            {formatCurrency(property.expectedRent)}
                          </Typography>
                        </Grid>
                      )}
                      {property.securityDeposit > 0 && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            Security Deposit
                          </Typography>
                          <Typography variant="body1" fontWeight={600} color="primary">
                            {formatCurrency(property.securityDeposit)}
                          </Typography>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Tenant Details Section */}
              {property.tenantName && (
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
                            {property.tenantName}
                          </Typography>
                        </Grid>
                        {property.tenantPhone && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Phone
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {property.tenantPhone}
                            </Typography>
                          </Grid>
                        )}
                        {property.tenantEmail && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Email
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {property.tenantEmail}
                            </Typography>
                          </Grid>
                        )}
                        {property.tenantCNIC && (
                          <Grid item xs={12}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              CNIC
                            </Typography>
                            <Typography variant="body1" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                              {property.tenantCNIC}
                            </Typography>
                          </Grid>
                        )}
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>
              )}

              {/* Agreement Details Section */}
              {property.rentalAgreement && (
                <Grid item xs={12} md={property.tenantName ? 6 : 12}>
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
                            {property.rentalAgreement.agreementNumber || 'N/A'}
                          </Typography>
                        </Grid>
                        {property.rentalAgreement.propertyName && (
                          <Grid item xs={12}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Property Name (Agreement)
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {property.rentalAgreement.propertyName}
                            </Typography>
                          </Grid>
                        )}
                        {property.rentalAgreement.monthlyRent && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Monthly Rent
                            </Typography>
                            <Typography variant="body1" fontWeight={600} color="primary">
                              {formatCurrency(property.rentalAgreement.monthlyRent)}
                            </Typography>
                          </Grid>
                        )}
                        {property.rentalAgreement.startDate && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Start Date
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {dayjs(property.rentalAgreement.startDate).format('MMMM D, YYYY')}
                            </Typography>
                          </Grid>
                        )}
                        {property.rentalAgreement.endDate && (
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              End Date
                            </Typography>
                            <Typography variant="body1" fontWeight={600}>
                              {dayjs(property.rentalAgreement.endDate).format('MMMM D, YYYY')}
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
              startIcon={<VisibilityIcon />}
              onClick={handleViewInvoicePDF}
            >
              View Invoice (PDF)
            </Button>
          </DialogActions>
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
    </Box>
  );
};

export default RentalManagementDetail;

