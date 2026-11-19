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
  Paper
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Print as PrintIcon,
  DirectionsCar as DirectionsCarIcon,
  Person as PersonIcon,
  Build as BuildIcon,
  Assignment as AssignmentIcon,
  LocationOn as LocationIcon,
  CalendarToday as CalendarIcon,
  AttachMoney as AttachMoneyIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import vehicleService from '../../../services/vehicleService';
import vehicleMaintenanceService from '../../../services/vehicleMaintenanceService';
import vehicleLogBookService from '../../../services/vehicleLogBookService';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

const VehicleDetailsView = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [maintenanceRecords, setMaintenanceRecords] = useState([]);
  const [logBookEntries, setLogBookEntries] = useState([]);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [logBookLoading, setLogBookLoading] = useState(false);

  useEffect(() => {
    fetchVehicle();
    fetchMaintenanceRecords();
    fetchLogBookEntries();
  }, [id]);

  const fetchVehicle = async () => {
    try {
      setLoading(true);
      const response = await vehicleService.getVehicle(id);
      setVehicle(response.data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch vehicle details');
      console.error('Error fetching vehicle:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMaintenanceRecords = async () => {
    try {
      setMaintenanceLoading(true);
      const response = await vehicleMaintenanceService.getMaintenanceRecords(id);
      setMaintenanceRecords(response.data || []);
    } catch (err) {
      console.error('Error fetching maintenance records:', err);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const fetchLogBookEntries = async () => {
    try {
      setLogBookLoading(true);
      const response = await vehicleLogBookService.getLogBookEntries(id);
      setLogBookEntries(response.data || []);
    } catch (err) {
      console.error('Error fetching log book entries:', err);
    } finally {
      setLogBookLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'Available': 'success',
      'In Use': 'primary',
      'Maintenance': 'warning',
      'Retired': 'default'
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

  const handlePrint = () => {
    if (!vehicle) return;
    
    // Create a new window for printing
    const printWindow = window.open('', '_blank');
    
    // Get the current date and time for the print header
    const printDate = new Date().toLocaleString();
    
    // Create the print content HTML with comprehensive styling
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Vehicle Details - ${vehicle?.registrationNumber || 'N/A'}</title>
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
            .status-available { background-color: #e8f5e8; }
            .status-in-use { background-color: #e3f2fd; }
            .status-maintenance { background-color: #fff3cd; }
            .status-retired { background-color: #e0e0e0; }
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
            .maintenance-table, .logbook-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            .maintenance-table th, .maintenance-table td,
            .logbook-table th, .logbook-table td {
              border: 1px solid #ddd;
              padding: 8px;
              text-align: left;
              font-size: 12px;
            }
            .maintenance-table th, .logbook-table th {
              background-color: #f5f5f5;
              font-weight: bold;
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
            <h1>VEHICLE DETAILS</h1>
            <div class="subtitle">Registration Number: ${vehicle?.registrationNumber || 'N/A'}</div>
            <div class="print-date">Printed on: ${printDate}</div>
          </div>

          <!-- Vehicle Summary -->
          <div class="section">
            <div class="section-title">🚗 Vehicle Summary</div>
            <div class="field-row">
              <div class="field-label">Vehicle ID:</div>
              <div class="field-value"><span class="record-id">${vehicle?._id || 'N/A'}</span></div>
            </div>
            <div class="field-row">
              <div class="field-label">Status:</div>
              <div class="field-value">
                <span class="status-chip status-${vehicle?.status?.toLowerCase().replace(' ', '-') || 'available'}">${vehicle?.status || 'N/A'}</span>
              </div>
            </div>
            <div class="field-row">
              <div class="field-label">Registration Number:</div>
              <div class="field-value">${vehicle?.registrationNumber || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Make & Model:</div>
              <div class="field-value">${vehicle?.make || 'N/A'} ${vehicle?.model || ''}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Year:</div>
              <div class="field-value">${vehicle?.year || 'N/A'}</div>
            </div>
          </div>

          <!-- Vehicle Details -->
          <div class="section">
            <div class="section-title">🔧 Vehicle Details</div>
            <div class="field-row">
              <div class="field-label">Engine Number:</div>
              <div class="field-value">${vehicle?.engineNumber || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Chassis Number:</div>
              <div class="field-value">${vehicle?.chassisNumber || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Color:</div>
              <div class="field-value">${vehicle?.color || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Fuel Type:</div>
              <div class="field-value">${vehicle?.fuelType || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Seating Capacity:</div>
              <div class="field-value">${vehicle?.seatingCapacity || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Purchase Date:</div>
              <div class="field-value">${vehicle?.purchaseDate ? formatDate(vehicle.purchaseDate) : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Purchase Price:</div>
              <div class="field-value">${vehicle?.purchasePrice ? formatCurrency(vehicle.purchasePrice) : 'N/A'}</div>
            </div>
          </div>

          <!-- Assignment Details -->
          <div class="section">
            <div class="section-title">👤 Assignment Details</div>
            <div class="field-row">
              <div class="field-label">Assigned Driver:</div>
              <div class="field-value">${vehicle?.assignedDriver ? `${vehicle.assignedDriver.firstName} ${vehicle.assignedDriver.lastName}` : 'Not assigned'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Department:</div>
              <div class="field-value">${vehicle?.department || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Location:</div>
              <div class="field-value">${vehicle?.location || 'N/A'}</div>
            </div>
          </div>

          <!-- Maintenance Records -->
          ${maintenanceRecords && maintenanceRecords.length > 0 ? `
          <div class="section">
            <div class="section-title">🔧 Maintenance Records (${maintenanceRecords.length})</div>
            <table class="maintenance-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${maintenanceRecords.map(record => `
                  <tr>
                    <td>${formatDate(record.date)}</td>
                    <td>${record.type || 'N/A'}</td>
                    <td>${record.description || 'N/A'}</td>
                    <td>${record.cost ? formatCurrency(record.cost) : 'N/A'}</td>
                    <td>${record.status || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : `
          <div class="section">
            <div class="section-title">🔧 Maintenance Records</div>
            <div class="field-row">
              <div class="field-label">Records:</div>
              <div class="field-value">No maintenance records found</div>
            </div>
          </div>
          `}

          <!-- Log Book Entries -->
          ${logBookEntries && logBookEntries.length > 0 ? `
          <div class="section">
            <div class="section-title">📝 Log Book Entries (${logBookEntries.length})</div>
            <table class="logbook-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Driver</th>
                  <th>Purpose</th>
                  <th>Start Odometer</th>
                  <th>End Odometer</th>
                  <th>Distance</th>
                </tr>
              </thead>
              <tbody>
                ${logBookEntries.map(entry => `
                  <tr>
                    <td>${formatDate(entry.date)}</td>
                    <td>${entry.driver ? `${entry.driver.firstName} ${entry.driver.lastName}` : 'N/A'}</td>
                    <td>${entry.purpose || 'N/A'}</td>
                    <td>${entry.startOdometer || 'N/A'}</td>
                    <td>${entry.endOdometer || 'N/A'}</td>
                    <td>${entry.distance || 'N/A'} km</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : `
          <div class="section">
            <div class="section-title">📝 Log Book Entries</div>
            <div class="field-row">
              <div class="field-label">Entries:</div>
              <div class="field-value">No log book entries found</div>
            </div>
          </div>
          `}

          <!-- System Information -->
          <div class="section">
            <div class="section-title">ℹ️ System Information</div>
            <div class="field-row">
              <div class="field-label">Created Date:</div>
              <div class="field-value">${vehicle?.createdAt ? new Date(vehicle.createdAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Last Updated:</div>
              <div class="field-value">${vehicle?.updatedAt ? new Date(vehicle.updatedAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Record Version:</div>
              <div class="field-value">${vehicle?.__v || '0'}</div>
            </div>
          </div>

          <!-- Additional Information -->
          <div class="section">
            <div class="section-title">📝 Additional Information</div>
            <div class="important-info">
              This document contains all available information for Vehicle ${vehicle?.registrationNumber || vehicle?._id || 'N/A'}
            </div>
            <div class="field-row">
              <div class="field-label">Total Fields:</div>
              <div class="field-value">${Object.keys(vehicle || {}).length} data fields</div>
            </div>
            <div class="field-row">
              <div class="field-label">Document Status:</div>
              <div class="field-value">Complete - All available data included</div>
            </div>
          </div>

          <div class="footer">
            <p><strong>Generated from SGC ERP System - Vehicle Management Module</strong></p>
            <p>Vehicle ID: <span class="record-id">${vehicle?._id || 'N/A'}</span> | Printed: ${printDate}</p>
            <p>This is a complete record printout containing all available information</p>
          </div>
        </body>
      </html>
    `;

    // Write the content to the new window
    printWindow.document.write(brandPrintHtml(printContent, { title: 'Vehicle Details' })); // Tovus ERP branded print
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
        <Button variant="outlined" onClick={() => navigate('/admin/vehicle-management')}>
          Back to Vehicles
        </Button>
      </Box>
    );
  }

  if (!vehicle) {
    return (
      <Box>
        <Typography variant="h6" color="textSecondary">
          Vehicle not found
        </Typography>
        <Button variant="outlined" onClick={() => navigate('/admin/vehicle-management')}>
          Back to Vehicles
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Vehicle Details
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
            onClick={() => navigate('/admin/vehicle-management')}
          >
            Back to Vehicles
          </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Basic Information */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Basic Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <DirectionsCarIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Vehicle ID
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {vehicle.vehicleId}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <AssignmentIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Registration Number
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {vehicle.registrationNumber}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <BuildIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Make & Model
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {vehicle.make} {vehicle.model}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <CalendarIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Year
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {vehicle.year}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <AttachMoneyIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Purchase Price
                      </Typography>
                      <Typography variant="body1" fontWeight="medium">
                        {formatCurrency(vehicle.purchasePrice)}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <LocationIcon color="primary" />
                    <Box>
                      <Typography variant="body2" color="textSecondary">
                        Status
                      </Typography>
                      <Chip
                        label={vehicle.status}
                        color={getStatusColor(vehicle.status)}
                        size="small"
                      />
                    </Box>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Technical Details */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Technical Details
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Engine Number
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {vehicle.engineNumber || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Chassis Number
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {vehicle.chassisNumber || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Color
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {vehicle.color || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Fuel Type
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {vehicle.fuelType || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Seating Capacity
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {vehicle.seatingCapacity || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Purchase Date
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {vehicle.purchaseDate ? formatDate(vehicle.purchaseDate) : 'N/A'}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Assignment Details */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Assignment Details
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Assigned Driver
                  </Typography>
                  {vehicle.assignedDriver ? (
                    <Box display="flex" alignItems="center" gap={1}>
                      <PersonIcon color="primary" />
                      <Typography variant="body1" fontWeight="medium">
                        {vehicle.assignedDriver.firstName} {vehicle.assignedDriver.lastName}
                      </Typography>
                    </Box>
                  ) : (
                    <Typography variant="body1" color="textSecondary">
                      Not assigned
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Department
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {vehicle.department || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="textSecondary">
                    Location
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {vehicle.location || 'N/A'}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Side Panel */}
        <Grid item xs={12} md={4}>
          {/* Vehicle Status Card */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Vehicle Status
              </Typography>
              <Box sx={{ textAlign: 'center' }}>
                <Avatar sx={{ width: 80, height: 80, mx: 'auto', mb: 2, bgcolor: 'primary.main' }}>
                  <DirectionsCarIcon sx={{ fontSize: 40 }} />
                </Avatar>
                <Chip
                  label={vehicle.status}
                  color={getStatusColor(vehicle.status)}
                  size="large"
                />
              </Box>
            </CardContent>
          </Card>

          {/* Maintenance Records */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Maintenance
              </Typography>
              {maintenanceLoading ? (
                <Box>
                  {[...Array(3)].map((_, index) => (
                    <Box key={index} sx={{ mb: 2 }}>
                      <Skeleton variant="text" height={20} width="70%" />
                      <Skeleton variant="text" height={16} width="50%" />
                    </Box>
                  ))}
                </Box>
              ) : maintenanceRecords.length > 0 ? (
                <Box>
                  {maintenanceRecords.slice(0, 3).map((record, index) => (
                    <Box key={index} sx={{ mb: 2, pb: 2, borderBottom: index < 2 ? '1px solid #eee' : 'none' }}>
                      <Typography variant="body2" fontWeight="medium">
                        {record.type || 'Maintenance'}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {formatDate(record.date)} - {record.cost ? formatCurrency(record.cost) : 'N/A'}
                      </Typography>
                    </Box>
                  ))}
                  {maintenanceRecords.length > 3 && (
                    <Typography variant="caption" color="primary">
                      +{maintenanceRecords.length - 3} more records
                    </Typography>
                  )}
                </Box>
              ) : (
                <Typography variant="body2" color="textSecondary">
                  No maintenance records found
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Maintenance Records Table */}
      {maintenanceRecords.length > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Maintenance Records
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Cost</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {maintenanceRecords.map((record) => (
                    <TableRow key={record._id}>
                      <TableCell>{formatDate(record.date)}</TableCell>
                      <TableCell>{record.type || 'N/A'}</TableCell>
                      <TableCell>{record.description || 'N/A'}</TableCell>
                      <TableCell>{record.cost ? formatCurrency(record.cost) : 'N/A'}</TableCell>
                      <TableCell>
                        <Chip
                          label={record.status || 'Completed'}
                          color="success"
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Log Book Entries Table */}
      {logBookEntries.length > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Log Book Entries
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Driver</TableCell>
                    <TableCell>Purpose</TableCell>
                    <TableCell>Start Odometer</TableCell>
                    <TableCell>End Odometer</TableCell>
                    <TableCell>Distance</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {logBookEntries.map((entry) => (
                    <TableRow key={entry._id}>
                      <TableCell>{formatDate(entry.date)}</TableCell>
                      <TableCell>
                        {entry.driver ? `${entry.driver.firstName} ${entry.driver.lastName}` : 'N/A'}
                      </TableCell>
                      <TableCell>{entry.purpose || 'N/A'}</TableCell>
                      <TableCell>{entry.startOdometer || 'N/A'}</TableCell>
                      <TableCell>{entry.endOdometer || 'N/A'}</TableCell>
                      <TableCell>{entry.distance || 'N/A'} km</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default VehicleDetailsView;
