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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  CircularProgress
} from '@mui/material';
import {
  Edit as EditIcon,
  Person as PersonIcon,
  Assignment as AssignmentIcon,
  Build as BuildIcon,
  DirectionsCar as DirectionsCarIcon,
  Add as AddIcon,
  Print as PrintIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import vehicleService from '../../../services/vehicleService';
import vehicleMaintenanceService from '../../../services/vehicleMaintenanceService';
import vehicleLogBookService from '../../../services/vehicleLogBookService';
import VehicleLocation from './VehicleLocation';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

const VehicleDetails = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assignDialog, setAssignDialog] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState('');
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
      const response = await vehicleMaintenanceService.getVehicleMaintenance(id, { limit: 5 });
      setMaintenanceRecords(response.data);
    } catch (err) {
      console.error('Error fetching maintenance records:', err);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const fetchLogBookEntries = async () => {
    try {
      setLogBookLoading(true);
      const response = await vehicleLogBookService.getVehicleLogBook(id, { limit: 5 });
      setLogBookEntries(response.data);
    } catch (err) {
      console.error('Error fetching log book entries:', err);
    } finally {
      setLogBookLoading(false);
    }
  };

  const handleAssignDriver = async () => {
    try {
      await vehicleService.assignDriver(id, selectedDriver || null);
      setAssignDialog(false);
      setSelectedDriver('');
      fetchVehicle();
    } catch (err) {
      setError('Failed to assign driver');
      console.error('Error assigning driver:', err);
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
            .status-active { background-color: #e8f5e8; }
            .status-maintenance { background-color: #fff3cd; }
            .status-out-of-service { background-color: #f8d7da; }
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
                <span class="status-chip status-${vehicle?.status?.toLowerCase().replace(' ', '-') || 'active'}">${vehicle?.status || 'N/A'}</span>
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
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Skeleton variant="text" width="25%" height={28} sx={{ mb: 2 }} />
                <Grid container spacing={2}>
                  {[1, 2, 3, 4, 5, 6].map((item) => (
                    <Grid item xs={12} sm={6} key={item}>
                      <Skeleton variant="text" height={16} width="40%" sx={{ mb: 1 }} />
                      <Skeleton variant="text" height={20} width="65%" />
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Card sx={{ mb: 3 }}>
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                      <Skeleton variant="text" width="35%" height={24} />
                      <Skeleton variant="rectangular" width={80} height={32} borderRadius={1} />
                    </Box>
                    {[1, 2, 3].map((item) => (
                      <Box key={item} display="flex" alignItems="center" justifyContent="space-between" py={1}>
                        <Skeleton variant="text" height={16} width={60} />
                        <Skeleton variant="text" height={16} width={40} />
                      </Box>
                    ))}
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={6}>
                <Card sx={{ mb: 3 }}>
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                      <Skeleton variant="text" width="30%" height={24} />
                      <Skeleton variant="rectangular" width={80} height={32} borderRadius={1} />
                    </Box>
                    {[1, 2, 3].map((item) => (
                      <Box key={item} display="flex" alignItems="center" justifyContent="space-between" py={1}>
                        <Skeleton variant="text" height={16} width={55} />
                        <Skeleton variant="text" height={16} width={35} />
                      </Box>
                    ))}
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Skeleton variant="text" width="40%" height={28} sx={{ mb: 2 }} />
                <Box sx={{ textAlign: 'center' }}>
                  <Skeleton variant="circular" width={80} height={80} sx={{ mb: 2, mx: 'auto' }} />
                  <Skeleton variant="rectangular" height={32} width={100} sx={{ mx: 'auto', mb: 2 }} />
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
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
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
            startIcon={<AssignmentIcon />}
            onClick={() => setAssignDialog(true)}
          >
            Assign Driver
          </Button>
          <Button
            variant="contained"
            startIcon={<EditIcon />}
            onClick={() => navigate(`/admin/vehicle-management/vehicles/${id}/edit`)}
          >
            Edit Vehicle
          </Button>
          <Button
            variant="outlined"
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
                  <Typography variant="subtitle2" color="text.secondary">
                    Vehicle ID
                  </Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {vehicle.vehicleId}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    License Plate
                  </Typography>
                  <Typography variant="h6" fontFamily="monospace">
                    {vehicle.licensePlate}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Make & Model
                  </Typography>
                  <Typography variant="body1">
                    {vehicle.make} {vehicle.model}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Year
                  </Typography>
                  <Typography variant="body1">
                    {vehicle.year}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Color
                  </Typography>
                  <Typography variant="body1">
                    {vehicle.color}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Fuel Type
                  </Typography>
                  <Typography variant="body1">
                    {vehicle.fuelType}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Capacity
                  </Typography>
                  <Typography variant="body1">
                    {vehicle.capacity} passengers
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Current Mileage
                  </Typography>
                  <Typography variant="body1">
                    {vehicle.currentMileage.toLocaleString()} km
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Status & Assignment */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Status & Assignment
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Box mb={2}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Current Status
                </Typography>
                <Chip
                  label={vehicle.status}
                  color={getStatusColor(vehicle.status)}
                  size="large"
                />
              </Box>
              
              <Box mb={2}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Assigned Driver
                </Typography>
                {vehicle.assignedDriver ? (
                  <Box display="flex" alignItems="center">
                    <PersonIcon sx={{ mr: 1, color: 'text.secondary' }} />
                    <Box>
                      <Typography variant="body1" fontWeight="bold">
                        {vehicle.assignedDriver.firstName} {vehicle.assignedDriver.lastName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        ID: {vehicle.assignedDriver.employeeId}
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No driver assigned
                  </Typography>
                )}
              </Box>
            </CardContent>
          </Card>

          {/* Vehicle Location Tracking */}
          {vehicle.trakkerPhone && vehicle.trakkerDeviceId && (
            <Box sx={{ mt: 3 }}>
              <VehicleLocation
                vehicleId={vehicle.vehicleId}
                vehicleName={`${vehicle.make} ${vehicle.model}`}
              />
            </Box>
          )}
        </Grid>

        {/* Financial Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Financial Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Purchase Date
                  </Typography>
                  <Typography variant="body1">
                    {formatDate(vehicle.purchaseDate)}
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Purchase Price
                  </Typography>
                  <Typography variant="h6" color="primary">
                    {formatCurrency(vehicle.purchasePrice)}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Maintenance Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Maintenance Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Last Service Date
                  </Typography>
                  <Typography variant="body1">
                    {vehicle.lastServiceDate ? formatDate(vehicle.lastServiceDate) : 'Not serviced'}
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Next Service Date
                  </Typography>
                  <Typography variant="body1">
                    {vehicle.nextServiceDate ? formatDate(vehicle.nextServiceDate) : 'Not scheduled'}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Notes */}
        {vehicle.notes && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Notes
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1">
                  {vehicle.notes}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Maintenance Records */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" gutterBottom>
                  Recent Maintenance
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => navigate(`/admin/vehicle-management/maintenance/new?vehicleId=${id}`)}
                >
                  Add Maintenance
                </Button>
              </Box>
              <Divider sx={{ mb: 2 }} />
              
              {maintenanceLoading ? (
                <Box display="flex" justifyContent="center" p={2}>
                  <CircularProgress size={24} />
                </Box>
              ) : maintenanceRecords.length > 0 ? (
                <Box>
                  {maintenanceRecords.map((record) => (
                    <Box key={record._id} sx={{ mb: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
                      <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
                        <Typography variant="subtitle2" fontWeight="bold">
                          {record.title}
                        </Typography>
                        <Chip
                          label={record.status}
                          size="small"
                          color={record.status === 'Completed' ? 'success' : record.status === 'In Progress' ? 'primary' : 'default'}
                        />
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {record.maintenanceType} • {formatDate(record.serviceDate)}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Provider: {record.serviceProvider}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Cost: {formatCurrency(record.cost)}
                      </Typography>
                    </Box>
                  ))}
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => navigate(`/admin/vehicle-management/maintenance?vehicleId=${id}`)}
                    sx={{ mt: 1 }}
                  >
                    View All Maintenance Records
                  </Button>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" textAlign="center" py={2}>
                  No maintenance records found
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Log Book Entries */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" gutterBottom>
                  Recent Log Book Entries
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => navigate(`/admin/vehicle-management/logbook/new?vehicleId=${id}`)}
                >
                  Add Entry
                </Button>
              </Box>
              <Divider sx={{ mb: 2 }} />
              
              {logBookLoading ? (
                <Box display="flex" justifyContent="center" p={2}>
                  <CircularProgress size={24} />
                </Box>
              ) : logBookEntries.length > 0 ? (
                <Box>
                  {logBookEntries.map((entry) => (
                    <Box key={entry._id} sx={{ mb: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
                      <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
                        <Typography variant="subtitle2" fontWeight="bold">
                          {entry.driverId?.firstName} {entry.driverId?.lastName}
                        </Typography>
                        <Chip
                          label={entry.purpose}
                          size="small"
                          color={entry.purpose === 'Business' ? 'success' : 'default'}
                        />
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {formatDate(entry.date)} • {entry.distanceTraveled} km
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {entry.startLocation} → {entry.endLocation}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Expenses: {formatCurrency(entry.totalExpenses || 0)}
                      </Typography>
                    </Box>
                  ))}
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => navigate(`/admin/vehicle-management/logbook?vehicleId=${id}`)}
                    sx={{ mt: 1 }}
                  >
                    View All Log Book Entries
                  </Button>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" textAlign="center" py={2}>
                  No log book entries found
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Assign Driver Dialog */}
      <Dialog open={assignDialog} onClose={() => setAssignDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Driver</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select a driver to assign to this vehicle, or leave empty to unassign current driver.
          </Typography>
          <FormControl fullWidth>
            <InputLabel>Select Driver</InputLabel>
            <Select
              value={selectedDriver}
              onChange={(e) => setSelectedDriver(e.target.value)}
              label="Select Driver"
            >
              <MenuItem value="">
                <em>Unassign Driver</em>
              </MenuItem>
              {/* Note: In a real implementation, you would fetch available drivers */}
              <MenuItem value="driver1">John Doe (EMP001)</MenuItem>
              <MenuItem value="driver2">Jane Smith (EMP002)</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignDialog(false)}>Cancel</Button>
          <Button onClick={handleAssignDriver} variant="contained">
            Assign Driver
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VehicleDetails;
