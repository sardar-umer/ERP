import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Chip,
  Avatar,
  Divider,
  Stack,
  Alert,
  Skeleton,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Edit as EditIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  Print as PrintIcon,
  Download as DownloadIcon
} from '@mui/icons-material';
import { format } from 'date-fns';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import { getImageUrl, handleImageError } from '../../../utils/imageService';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

const RentalAgreementDetail = ({ onEdit }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imageModalOpen, setImageModalOpen] = useState(false);

  useEffect(() => {
    fetchAgreement();
  }, [id]);


  const fetchAgreement = async () => {
    try {
      const response = await api.get(`/rental-agreements/${id}`);
      setAgreement(response.data);
    } catch (error) {
      console.error('Error fetching agreement:', error);
      setError('Failed to fetch rental agreement details');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Active': return 'success';
      case 'Expired': return 'error';
      case 'Terminated': return 'warning';
      default: return 'default';
    }
  };

  const formatPKR = (amount) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const handlePrint = () => {
    if (!agreement) return;
    
    // Create a new window for printing
    const printWindow = window.open('', '_blank');
    
    // Get the current date and time for the print header
    const printDate = new Date().toLocaleString();
    
    // Create the print content HTML with comprehensive styling
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Rental Agreement - ${agreement?.agreementNumber || 'N/A'}</title>
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
            .header .subtitle {
              color: #333;
              font-size: 16px;
              margin-bottom: 8px;
              font-weight: bold;
            }
            .print-date {
              color: #666;
              font-size: 12px;
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
              min-height: 20px;
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
              word-wrap: break-word;
            }
            .status-chip {
              display: inline-block;
              padding: 3px 8px;
              border: 1px solid #000;
              font-size: 11px;
              font-weight: bold;
              text-transform: uppercase;
              background-color: #f0f0f0;
            }
            .status-active { background-color: #e8f5e8; }
            .status-expired { background-color: #f8d7da; }
            .status-terminated { background-color: #fff3cd; }
            .footer {
              margin-top: 30px;
              padding-top: 15px;
              border-top: 2px solid #000;
              text-align: center;
              color: #333;
              font-size: 11px;
            }
            .important-info {
              background-color: #fff3cd;
              border: 1px solid #ffeaa7;
              padding: 10px;
              margin: 10px 0;
              font-weight: bold;
            }
            .record-id {
              font-family: monospace;
              background-color: #f8f9fa;
              padding: 2px 5px;
              border: 1px solid #ccc;
            }
            .agreement-image {
              max-width: 300px;
              max-height: 200px;
              border: 1px solid #ccc;
              margin: 10px 0;
            }
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
              .section { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>RENTAL AGREEMENT</h1>
            <div class="subtitle">Agreement Number: ${agreement?.agreementNumber || 'N/A'}</div>
            <div class="print-date">Printed on: ${printDate}</div>
          </div>

          <!-- Agreement Summary -->
          <div class="section">
            <div class="section-title">📋 Agreement Summary</div>
            <div class="field-row">
              <div class="field-label">Agreement ID:</div>
              <div class="field-value"><span class="record-id">${agreement?._id || 'N/A'}</span></div>
            </div>
            <div class="field-row">
              <div class="field-label">Status:</div>
              <div class="field-value">
                <span class="status-chip status-${agreement?.status?.toLowerCase() || 'active'}">${agreement?.status || 'N/A'}</span>
              </div>
            </div>
            <div class="field-row">
              <div class="field-label">Agreement Number:</div>
              <div class="field-value">${agreement?.agreementNumber || 'N/A'}</div>
            </div>
          </div>

          <!-- Property Details -->
          <div class="section">
            <div class="section-title">🏢 Property Details</div>
            <div class="field-row">
              <div class="field-label">Property Size:</div>
              <div class="field-value">${agreement?.propertySize || 'N/A'} ${agreement?.sizeUnit || ''}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Property Description:</div>
              <div class="field-value">${agreement?.propertyDescription || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Furnished:</div>
              <div class="field-value">${agreement?.furnished ? 'Yes' : 'No'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Parking Available:</div>
              <div class="field-value">${agreement?.parkingAvailable ? 'Yes' : 'No'}</div>
            </div>
          </div>

          <!-- Tenant Details -->
          <div class="section">
            <div class="section-title">👤 Tenant Details</div>
            <div class="field-row">
              <div class="field-label">Tenant Name:</div>
              <div class="field-value">${agreement?.tenantName || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Tenant CNIC:</div>
              <div class="field-value">${agreement?.tenantCNIC || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Tenant Phone:</div>
              <div class="field-value">${agreement?.tenantPhone || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Tenant Email:</div>
              <div class="field-value">${agreement?.tenantEmail || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Tenant Address:</div>
              <div class="field-value">${agreement?.tenantAddress || 'N/A'}</div>
            </div>
          </div>

          <!-- Agreement Terms -->
          <div class="section">
            <div class="section-title">📝 Agreement Terms</div>
            <div class="field-row">
              <div class="field-label">Advance Payment:</div>
              <div class="field-value">${agreement?.advancePayment ? formatPKR(agreement.advancePayment) : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Payment Terms:</div>
              <div class="field-value">${agreement?.paymentTerms || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Special Terms:</div>
              <div class="field-value">${agreement?.specialTerms || 'N/A'}</div>
            </div>
          </div>

          <!-- Agreement File -->
          ${agreement?.agreementImage ? `
          <div class="section">
            <div class="section-title">📷 Agreement File</div>
            <div class="field-row">
              <div class="field-label">File Type:</div>
              <div class="field-value">${agreement.agreementImage.toLowerCase().endsWith('.pdf') ? 'PDF Document' : 'Image'}</div>
            </div>
            ${!agreement.agreementImage.toLowerCase().endsWith('.pdf') ? `
            <div class="field-row">
              <div class="field-label">Image:</div>
              <div class="field-value">
                <img src="${getImageUrl(agreement.agreementImage)}" alt="Agreement Image" class="agreement-image" />
              </div>
            </div>
            ` : `
            <div class="field-row">
              <div class="field-label">PDF File:</div>
              <div class="field-value">${agreement.agreementImage}</div>
            </div>
            `}
          </div>
          ` : ''}

          <!-- System Information -->
          <div class="section">
            <div class="section-title">ℹ️ System Information</div>
            <div class="field-row">
              <div class="field-label">Created Date:</div>
              <div class="field-value">${agreement?.createdAt ? new Date(agreement.createdAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Last Updated:</div>
              <div class="field-value">${agreement?.updatedAt ? new Date(agreement.updatedAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Record Version:</div>
              <div class="field-value">${agreement?.__v || '0'}</div>
            </div>
          </div>

          <!-- Additional Information -->
          <div class="section">
            <div class="section-title">📝 Additional Information</div>
            <div class="important-info">
              This document contains all available information for Rental Agreement ${agreement?.agreementNumber || agreement?._id || 'N/A'}
            </div>
            <div class="field-row">
              <div class="field-label">Total Fields:</div>
              <div class="field-value">${Object.keys(agreement || {}).length} data fields</div>
            </div>
            <div class="field-row">
              <div class="field-label">Document Status:</div>
              <div class="field-value">Complete - All available data included</div>
            </div>
          </div>

          <div class="footer">
            <p><strong>Generated from SGC ERP System - Rental Agreements Module</strong></p>
            <p>Agreement ID: <span class="record-id">${agreement?._id || 'N/A'}</span> | Printed: ${printDate}</p>
            <p>This is a complete record printout containing all available information</p>
          </div>
        </body>
      </html>
    `;

    // Write the content to the new window
    printWindow.document.write(brandPrintHtml(printContent, { title: 'Rental Agreement' })); // Tovus ERP branded print
    printWindow.document.close();

    // Wait for content to load, then trigger print
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
                <Box sx={{ textAlign: 'center' }}>
                  <Skeleton variant="rectangular" width={120} height={80} sx={{ mb: 2, mx: 'auto' }} />
                  <Skeleton variant="rectangular" height={24} width={80} sx={{ mx: 'auto' }} />
                </Box>
              </CardContent>
            </Card>

            <Stack spacing={2}>
              <Skeleton variant="rectangular" width={120} height={36} borderRadius={1} />
              <Skeleton variant="rectangular" width={100} height={36} borderRadius={1} />
            </Stack>
          </Grid>
        </Grid>
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </Box>
    );
  }

  if (!agreement) {
    return (
      <Box>
        <Alert severity="warning" sx={{ mb: 2 }}>Rental agreement not found</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={2} alignItems="center" mb={3}>
        <Button startIcon={<BackIcon />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <Typography variant="h4" component="h1">
          Rental Agreement Details
        </Typography>
        <Button
          variant="outlined"
          startIcon={<PrintIcon />}
          onClick={handlePrint}
          sx={{ ml: 'auto', mr: 1 }}
        >
          Print
        </Button>
        {onEdit && (
          <Button
            variant="contained"
            startIcon={<EditIcon />}
            onClick={() => onEdit(agreement)}
          >
            Edit
          </Button>
        )}
      </Stack>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Agreement Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Agreement Number
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {agreement.agreementNumber}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip
                    label={agreement.status}
                    color={getStatusColor(agreement.status)}
                    size="small"
                    sx={{ mb: 2 }}
                  />
                </Grid>
                
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Property Name
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {agreement.propertyName}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Agreement File
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              {agreement.agreementImage ? (
                <Box>
                  {agreement.agreementImage.toLowerCase().endsWith('.pdf') ? (
                    <Box
                      sx={{
                        width: '100%',
                        height: 200,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#f5f5f5',
                        borderRadius: 1,
                        mb: 2,
                        border: '1px solid',
                        borderColor: 'divider'
                      }}
                    >
                      <ImageIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        PDF Document
                      </Typography>
                      <Stack direction="row" spacing={2}>
                        <Button
                          variant="outlined"
                          onClick={() => {
                            const url = getImageUrl(agreement.agreementImage);
                            console.log('🔗 Generated URL for viewing:', url);
                            console.log('📄 Original path:', agreement.agreementImage);
                            if (url) {
                              window.open(url, '_blank', 'noopener,noreferrer');
                            } else {
                              console.error('❌ No URL generated');
                            }
                          }}
                          startIcon={<ImageIcon />}
                        >
                          View PDF
                        </Button>
                        <Button
                          variant="outlined"
                          onClick={() => {
                            const url = getImageUrl(agreement.agreementImage);
                            console.log('🔗 Generated URL for download:', url);
                            console.log('📄 Original path:', agreement.agreementImage);
                            if (url) {
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = agreement.agreementImage.split('/').pop();
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            } else {
                              console.error('❌ No URL generated');
                            }
                          }}
                          startIcon={<DownloadIcon />}
                        >
                          Download PDF
                        </Button>
                      </Stack>
                    </Box>
                  ) : (
                    <>
                      <Box
                        component="img"
                        src={getImageUrl(agreement.agreementImage)}
                        alt="Rental Agreement"
                        sx={{
                          width: '100%',
                          height: 200,
                          objectFit: 'cover',
                          borderRadius: 1,
                          mb: 2,
                          border: '1px solid',
                          borderColor: 'divider'
                        }}
                        onError={(e) => handleImageError(e)}
                      />
                      <Button
                        fullWidth
                        variant="outlined"
                        startIcon={<ImageIcon />}
                        onClick={() => setImageModalOpen(true)}
                      >
                        View Full Image
                      </Button>
                    </>
                  )}
                </Box>
              ) : (
                <Box textAlign="center" py={4}>
                  <ImageIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    No file uploaded
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Created Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Typography variant="subtitle2" color="text.secondary">
                Created By
              </Typography>
              <Typography variant="body1" sx={{ mb: 2 }}>
                {agreement.createdBy?.firstName} {agreement.createdBy?.lastName}
              </Typography>
              
              <Typography variant="subtitle2" color="text.secondary">
                Created Date
              </Typography>
              <Typography variant="body1" sx={{ mb: 2 }}>
                {format(new Date(agreement.createdAt), 'dd/MM/yyyy HH:mm')}
              </Typography>
              
              <Typography variant="subtitle2" color="text.secondary">
                Last Updated
              </Typography>
              <Typography variant="body1">
                {format(new Date(agreement.updatedAt), 'dd/MM/yyyy HH:mm')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Image Modal */}
      <Dialog
        open={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'transparent',
            boxShadow: 'none'
          }
        }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.8)',
          color: 'white'
        }}>
          <Typography variant="h6">Agreement Image</Typography>
          <IconButton
            onClick={() => setImageModalOpen(false)}
            sx={{ color: 'white' }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, backgroundColor: 'rgba(0,0,0,0.8)' }}>
          {agreement?.agreementImage?.toLowerCase().endsWith('.pdf') ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h6" color="white" gutterBottom>
                PDF Document
              </Typography>
              <Button
                variant="contained"
                onClick={() => {
                  const url = getImageUrl(agreement.agreementImage);
                  if (url) {
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }
                }}
                sx={{ mt: 2 }}
              >
                Open PDF in New Tab
              </Button>
            </Box>
          ) : (
            <Box
              component="img"
              src={getImageUrl(agreement?.agreementImage)}
              alt="Rental Agreement"
              sx={{
                width: '100%',
                height: 'auto',
                maxHeight: '80vh',
                objectFit: 'contain',
                display: 'block'
              }}
              onError={(e) => handleImageError(e)}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ 
          backgroundColor: 'rgba(0,0,0,0.8)',
          justifyContent: 'center'
        }}>
          <Button
            onClick={() => setImageModalOpen(false)}
            variant="contained"
            color="primary"
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RentalAgreementDetail;
