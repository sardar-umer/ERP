import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Chip,
  Alert,
  Skeleton,
  Divider,
  Stack,
  Avatar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Print as PrintIcon,
  Assignment as LogBookIcon,
  Assignment as AssignmentIcon,
  Person as PersonIcon,
  DirectionsCar as DirectionsCarIcon,
  CalendarToday as CalendarIcon,
  LocationOn as LocationIcon,
  Route as RouteIcon,
  LocalGasStation as FuelIcon,
  AttachMoney as MoneyIcon,
  Speed as SpeedIcon,
  Notes as NotesIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import vehicleLogBookService from '../../../services/vehicleLogBookService';
import vehicleService from '../../../services/vehicleService';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

const VehicleLogBookDetailsView = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [logBookEntry, setLogBookEntry] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLogBookEntry();
  }, [id]);

  const fetchLogBookEntry = async () => {
    try {
      setLoading(true);
      const response = await vehicleLogBookService.getLogBookEntry(id);
      setLogBookEntry(response.data);
      
      // Fetch vehicle details if vehicle ID is available
      if (response.data.vehicleId) {
        try {
          const vehicleResponse = await vehicleService.getVehicle(response.data.vehicleId);
          setVehicle(vehicleResponse.data);
        } catch (err) {
          console.error('Error fetching vehicle details:', err);
        }
      }
      
      setError(null);
    } catch (err) {
      setError('Failed to fetch log book entry details');
      console.error('Error fetching log book entry:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'Active': 'primary',
      'Completed': 'success',
      'Cancelled': 'error'
    };
    return colors[status] || 'default';
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (time) => {
    if (!time) return 'N/A';
    return time;
  };

  const handlePrint = () => {
    if (!logBookEntry) return;
    
    // Create a new window for printing
    const printWindow = window.open('', '_blank');
    
    // Get the current date and time for the print header
    const printDate = new Date().toLocaleString();
    
    // Create the print content HTML with comprehensive styling
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Log Book Entry - ${logBookEntry?.purpose || 'N/A'}</title>
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
            .status-active { background-color: #e3f2fd; }
            .status-completed { background-color: #e8f5e8; }
            .status-cancelled { background-color: #ffebee; }
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
            .route-info {
              background-color: #f8f9fa;
              border: 1px solid #dee2e6;
              padding: 10px;
              margin: 10px 0;
              border-radius: 4px;
            }
            .fuel-cost-highlight {
              font-size: 16px;
              font-weight: bold;
              color: #000;
              background-color: #fff3cd;
              padding: 8px;
              border: 1px solid #ffeaa7;
              border-radius: 4px;
              text-align: center;
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
            <h1>VEHICLE LOG BOOK ENTRY</h1>
            <div class="subtitle">Purpose: ${logBookEntry?.purpose || 'N/A'}</div>
            <div class="print-date">Printed on: ${printDate}</div>
          </div>

          <!-- Entry Summary -->
          <div class="section">
            <div class="section-title">📋 Entry Summary</div>
            <div class="field-row">
              <div class="field-label">Entry ID:</div>
              <div class="field-value"><span class="record-id">${logBookEntry?._id || 'N/A'}</span></div>
            </div>
            <div class="field-row">
              <div class="field-label">Status:</div>
              <div class="field-value">
                <span class="status-chip status-${logBookEntry?.status?.toLowerCase() || 'active'}">${logBookEntry?.status || 'N/A'}</span>
              </div>
            </div>
            <div class="field-row">
              <div class="field-label">Purpose:</div>
              <div class="field-value">${logBookEntry?.purpose || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Date:</div>
              <div class="field-value">${logBookEntry?.date ? formatDate(logBookEntry.date) : 'N/A'}</div>
            </div>
          </div>

          <!-- Vehicle Information -->
          <div class="section">
            <div class="section-title">🚗 Vehicle Information</div>
            <div class="field-row">
              <div class="field-label">Vehicle:</div>
              <div class="field-value">${vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.registrationNumber})` : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Vehicle ID:</div>
              <div class="field-value">${logBookEntry?.vehicleId || 'N/A'}</div>
            </div>
            ${vehicle ? `
            <div class="field-row">
              <div class="field-label">Vehicle Status:</div>
              <div class="field-value">${vehicle.status || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Vehicle Year:</div>
              <div class="field-value">${vehicle.year || 'N/A'}</div>
            </div>
            ` : ''}
          </div>

          <!-- Driver Information -->
          <div class="section">
            <div class="section-title">👤 Driver Information</div>
            <div class="field-row">
              <div class="field-label">Driver:</div>
              <div class="field-value">${logBookEntry?.driver ? `${logBookEntry.driver.firstName} ${logBookEntry.driver.lastName}` : 'N/A'}</div>
            </div>
            <div class="field-label">Driver ID:</div>
            <div class="field-value">${logBookEntry?.driverId || 'N/A'}</div>
          </div>
          ${logBookEntry?.driver ? `
          <div class="field-row">
            <div class="field-label">Driver Email:</div>
            <div class="field-value">${logBookEntry.driver.email || 'N/A'}</div>
          </div>
          <div class="field-row">
            <div class="field-label">Driver Phone:</div>
            <div class="field-value">${logBookEntry.driver.phone || 'N/A'}</div>
          </div>
          <div class="field-row">
            <div class="field-label">Driver Department:</div>
            <div class="field-value">${logBookEntry.driver.department || 'N/A'}</div>
          </div>
          ` : ''}

          <!-- Trip Details -->
          <div class="section">
            <div class="section-title">🛣️ Trip Details</div>
            <div class="field-row">
              <div class="field-label">Start Location:</div>
              <div class="field-value">${logBookEntry?.startLocation || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">End Location:</div>
              <div class="field-value">${logBookEntry?.endLocation || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Route Description:</div>
              <div class="field-value">${logBookEntry?.route || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Start Time:</div>
              <div class="field-value">${formatTime(logBookEntry?.startTime)}</div>
            </div>
            <div class="field-row">
              <div class="field-label">End Time:</div>
              <div class="field-value">${formatTime(logBookEntry?.endTime)}</div>
            </div>
          </div>

          <!-- Distance and Odometer -->
          <div class="section">
            <div class="section-title">📏 Distance Information</div>
            <div class="field-row">
              <div class="field-label">Start Odometer:</div>
              <div class="field-value">${logBookEntry?.startOdometer || 'N/A'} km</div>
            </div>
            <div class="field-row">
              <div class="field-label">End Odometer:</div>
              <div class="field-value">${logBookEntry?.endOdometer || 'N/A'} km</div>
            </div>
            <div class="field-row">
              <div class="field-label">Distance Traveled:</div>
              <div class="field-value">${logBookEntry?.distance || 'N/A'} km</div>
            </div>
          </div>

          <!-- Fuel Information -->
          ${logBookEntry?.fuelCost || logBookEntry?.fuelConsumed ? `
          <div class="section">
            <div class="section-title">⛽ Fuel Information</div>
            ${logBookEntry?.fuelCost ? `
            <div class="fuel-cost-highlight">
              💰 Fuel Cost: ${formatCurrency(logBookEntry.fuelCost)}
            </div>
            ` : ''}
            ${logBookEntry?.fuelConsumed ? `
            <div class="field-row">
              <div class="field-label">Fuel Consumed:</div>
              <div class="field-value">${logBookEntry.fuelConsumed} liters</div>
            </div>
            ` : ''}
            ${logBookEntry?.fuelEfficiency ? `
            <div class="field-row">
              <div class="field-label">Fuel Efficiency:</div>
              <div class="field-value">${logBookEntry.fuelEfficiency} km/liter</div>
            </div>
            ` : ''}
          </div>
          ` : ''}

          <!-- Additional Information -->
          ${logBookEntry?.notes || logBookEntry?.remarks ? `
          <div class="section">
            <div class="section-title">📝 Additional Information</div>
            ${logBookEntry?.notes ? `
            <div class="field-row">
              <div class="field-label">Notes:</div>
              <div class="field-value">${logBookEntry.notes}</div>
            </div>
            ` : ''}
            ${logBookEntry?.remarks ? `
            <div class="field-row">
              <div class="field-label">Remarks:</div>
              <div class="field-value">${logBookEntry.remarks}</div>
            </div>
            ` : ''}
          </div>
          ` : ''}

          <!-- System Information -->
          <div class="section">
            <div class="section-title">ℹ️ System Information</div>
            <div class="field-row">
              <div class="field-label">Created Date:</div>
              <div class="field-value">${logBookEntry?.createdAt ? new Date(logBookEntry.createdAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Last Updated:</div>
              <div class="field-value">${logBookEntry?.updatedAt ? new Date(logBookEntry.updatedAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Record Version:</div>
              <div class="field-value">${logBookEntry?.__v || '0'}</div>
            </div>
          </div>

          <!-- Additional Information -->
          <div class="section">
            <div class="section-title">📝 Additional Information</div>
            <div class="important-info">
              This document contains all available information for Log Book Entry ${logBookEntry?.purpose || logBookEntry?._id || 'N/A'}
            </div>
            <div class="field-row">
              <div class="field-label">Total Fields:</div>
              <div class="field-value">${Object.keys(logBookEntry || {}).length} data fields</div>
            </div>
            <div class="field-row">
              <div class="field-label">Document Status:</div>
              <div class="field-value">Complete - All available data included</div>
            </div>
          </div>

          <div class="footer">
            <p><strong>Generated from SGC ERP System - Vehicle Log Book Module</strong></p>
            <p>Entry ID: <span class="record-id">${logBookEntry?._id || 'N/A'}</span> | Printed: ${printDate}</p>
            <p>This is a complete record printout containing all available information</p>
          </div>
        </body>
      </html>
    `;

    // Write the content to the new window
    printWindow.document.write(brandPrintHtml(printContent, { title: 'Vehicle Log Book Entry' })); // Tovus ERP branded print
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
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Skeleton variant="text" width="30%" height={40} />
          <Box display="flex" gap={1}>
            <Skeleton variant="rectangular" width={120} height={36} borderRadius={1} />
            <Skeleton variant="rectangular" width={100} height={36} borderRadius={1} />
          </Box>
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Skeleton variant="text" width="40%" height={28} sx={{ mb: 2 }} />
                <Grid container spacing={2}>
                  {[...Array(6)].map((_, index) => (
                    <Grid item xs={12} sm={6} key={index}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <Skeleton variant="circular" width={24} height={24} />
                        <Box flexGrow={1}>
                          <Skeleton variant="text" height={16} width="40%" />
                          <Skeleton variant="text" height={20} width="60%" />
                        </Box>
                      </Box>
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
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button variant="outlined" onClick={() => navigate('/admin/vehicle-management/logbook')}>
          Back to Log Book
        </Button>
      </Box>
    );
  }

  if (!logBookEntry) {
    return (
      <Box>
        <Typography variant="h6" color="textSecondary">
          Log book entry not found
        </Typography>
        <Button variant="outlined" onClick={() => navigate('/admin/vehicle-management/logbook')}>
          Back to Log Book
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Log Book Entry Details
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={handlePrint}
          >
            Print
          </Button>
          <Button
            variant="outlined"
            startIcon={<BackIcon />}
            onClick={() => navigate('/admin/vehicle-management/logbook')}
          >
            Back to Log Book
          </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Main Information */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Entry Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <LogBookIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Purpose
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.purpose}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <CalendarIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Date
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {formatDate(logBookEntry.date)}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <CheckCircleIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Status
                      </Typography>
                      <Chip
                        label={logBookEntry.status}
                        color={getStatusColor(logBookEntry.status)}
                        size="small"
                      />
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <PersonIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Driver
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.driver ? `${logBookEntry.driver.firstName} ${logBookEntry.driver.lastName}` : 'N/A'}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Vehicle Information */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Vehicle Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <DirectionsCarIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Vehicle
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {vehicle ? `${vehicle.make} ${vehicle.model}` : 'N/A'}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <AssignmentIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Registration
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {vehicle?.registrationNumber || 'N/A'}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                {vehicle && (
                  <>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="textSecondary">
                        Year
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {vehicle.year || 'N/A'}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="textSecondary">
                        Status
                      </Typography>
                      <Chip
                        label={vehicle.status}
                        color="success"
                        size="small"
                      />
                    </Grid>
                  </>
                )}
              </Grid>
            </CardContent>
          </Card>

          {/* Trip Details */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Trip Details
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <LocationIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Start Location
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.startLocation || 'N/A'}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <LocationIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        End Location
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.endLocation || 'N/A'}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <RouteIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Route Description
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.route || 'N/A'}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Start Time
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {formatTime(logBookEntry.startTime)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    End Time
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {formatTime(logBookEntry.endTime)}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Distance and Odometer */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Distance Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <SpeedIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Start Odometer
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.startOdometer || 'N/A'} km
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <SpeedIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        End Odometer
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.endOdometer || 'N/A'} km
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <RouteIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Distance Traveled
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.distance || 'N/A'} km
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Fuel Information */}
          {(logBookEntry.fuelCost || logBookEntry.fuelConsumed) && (
            <Card sx={{ mt: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Fuel Information
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                <Grid container spacing={2}>
                  {logBookEntry.fuelCost && (
                    <Grid item xs={12} sm={6}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <MoneyIcon color="primary" />
                        <Box>
                          <Typography variant="body2" color="textSecondary">
                            Fuel Cost
                          </Typography>
                          <Typography variant="h6" color="primary" fontWeight="bold">
                            {formatCurrency(logBookEntry.fuelCost)}
                          </Typography>
                        </Box>
                      </Box>
                    </Grid>
                  )}
                  {logBookEntry.fuelConsumed && (
                    <Grid item xs={12} sm={6}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <FuelIcon color="primary" />
                        <Box>
                          <Typography variant="body2" color="textSecondary">
                            Fuel Consumed
                          </Typography>
                          <Typography variant="body1" fontWeight="medium">
                            {logBookEntry.fuelConsumed} liters
                          </Typography>
                        </Box>
                      </Box>
                    </Grid>
                  )}
                  {logBookEntry.fuelEfficiency && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="textSecondary">
                        Fuel Efficiency
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {logBookEntry.fuelEfficiency} km/liter
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </CardContent>
            </Card>
          )}

          {/* Additional Information */}
          {(logBookEntry.notes || logBookEntry.remarks) && (
            <Card sx={{ mt: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Additional Information
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                <Grid container spacing={2}>
                  {logBookEntry.notes && (
                    <Grid item xs={12}>
                      <Box display="flex" alignItems="flex-start" gap={2}>
                        <NotesIcon color="primary" />
                        <Box>
                          <Typography variant="body2" color="textSecondary">
                            Notes
                          </Typography>
                          <Typography variant="body1">
                            {logBookEntry.notes}
                          </Typography>
                        </Box>
                      </Box>
                    </Grid>
                  )}
                  {logBookEntry.remarks && (
                    <Grid item xs={12}>
                      <Typography variant="body2" color="textSecondary">
                        Remarks
                      </Typography>
                      <Typography variant="body1">
                        {logBookEntry.remarks}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* Side Panel */}
        <Grid item xs={12} md={4}>
          {/* Entry Status Card */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Entry Status
              </Typography>
              <Box sx={{ textAlign: 'center' }}>
                <Avatar sx={{ width: 80, height: 80, mx: 'auto', mb: 2, bgcolor: 'primary.main' }}>
                  <LogBookIcon sx={{ fontSize: 40 }} />
                </Avatar>
                <Chip
                  label={logBookEntry.status}
                  color={getStatusColor(logBookEntry.status)}
                  size="large"
                />
              </Box>
            </CardContent>
          </Card>

          {/* Quick Info */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Quick Information
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <CalendarIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Date"
                    secondary={formatDate(logBookEntry.date)}
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <PersonIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Driver"
                    secondary={logBookEntry.driver ? `${logBookEntry.driver.firstName} ${logBookEntry.driver.lastName}` : 'N/A'}
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <RouteIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="Distance"
                    secondary={`${logBookEntry.distance || 'N/A'} km`}
                  />
                </ListItem>
                {logBookEntry.fuelCost && (
                  <ListItem>
                    <ListItemIcon>
                      <MoneyIcon color="primary" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Fuel Cost"
                      secondary={formatCurrency(logBookEntry.fuelCost)}
                    />
                  </ListItem>
                )}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default VehicleLogBookDetailsView;
