import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Skeleton,
  Alert
} from '@mui/material';
import {
  GetApp as ExportIcon,
  TrendingUp as TrendingIcon,
  Build as MaintenanceIcon,
  LocalGasStation as FuelIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import vehicleService from '../../../services/vehicleService';
import vehicleMaintenanceService from '../../../services/vehicleMaintenanceService';
import vehicleLogBookService from '../../../services/vehicleLogBookService';
import { formatDate, formatCurrency } from '../../../utils/dateUtils';
import useClientPagination from '../../../hooks/useClientPagination';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

// Lightweight reusable components
const ReportCard = ({ title, value, subtitle, icon: Icon, color = 'primary' }) => (
  <Card>
    <CardContent>
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography color="textSecondary" gutterBottom variant="body2">
            {title}
          </Typography>
          <Typography variant="h6" component="div">
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="textSecondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Icon color={color} sx={{ fontSize: 40 }} />
      </Box>
    </CardContent>
  </Card>
);

const ExportButton = ({ onExport, loading, format = 'PDF' }) => (
  <Button
    variant="outlined"
    startIcon={<ExportIcon />}
    onClick={onExport}
    disabled={loading}
    size="small"
  >
    {loading ? <CircularProgress size={16} /> : `Export ${format}`}
  </Button>
);

const VehicleReports = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [dateRange, setDateRange] = useState('30');
  const [data, setData] = useState({
    vehicles: [],
    maintenance: [],
    logBook: []
  });

  // Helper function for date filtering
  const isWithinDateRange = (date, range) => {
    if (!date) return false;
    const targetDate = new Date(date);
    const now = new Date();
    
    // Handle numeric values from dropdown
    const daysAgo = parseInt(range);
    
    if (!isNaN(daysAgo)) {
      const startDate = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
      return targetDate >= startDate && targetDate <= now;
    }
    
    // Handle named ranges
    switch (range) {
      case 'lastWeek':
        const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return targetDate >= lastWeek && targetDate <= now;
      case 'lastMonth':
        const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return targetDate >= lastMonth && targetDate <= now;
      case 'lastYear':
        const lastYear = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        return targetDate >= lastYear && targetDate <= now;
      case 'all':
        return true;
      default:
        return false;
    }
  };

  // Memoized calculations for performance
  const reports = useMemo(() => {
    const { vehicles, maintenance, logBook } = data;
    
    // Filter data based on selected vehicle and date range
    const filteredMaintenance = maintenance.filter(m => {
      // Handle multiple possible vehicle ID formats:
      // 1. m.vehicleId is a string matching selectedVehicle
      // 2. m.vehicleId is an object with _id property
      // 3. m.vehicle is a populated object with _id
      const vehicleMatch = !selectedVehicle || 
        m.vehicleId === selectedVehicle || 
        (typeof m.vehicleId === 'object' && m.vehicleId?._id === selectedVehicle) ||
        m.vehicle?._id === selectedVehicle;
      
      const dateMatch = isWithinDateRange(m.serviceDate, dateRange);
      
      
      return vehicleMatch && dateMatch;
    });
    
    const filteredLogBook = logBook.filter(l => {
      // Handle multiple possible vehicle ID formats:
      // 1. l.vehicleId is a string matching selectedVehicle
      // 2. l.vehicleId is an object with _id property
      // 3. l.vehicle is a populated object with _id
      const vehicleMatch = !selectedVehicle || 
        l.vehicleId === selectedVehicle || 
        (typeof l.vehicleId === 'object' && l.vehicleId?._id === selectedVehicle) ||
        l.vehicle?._id === selectedVehicle;
      
      const dateMatch = isWithinDateRange(l.date, dateRange);
      
      
      return vehicleMatch && dateMatch;
    });

    // Calculate metrics
    const totalMaintenanceCost = filteredMaintenance.reduce((sum, m) => sum + (m.cost || 0), 0);
    const totalFuelCost = filteredLogBook.reduce((sum, l) => sum + (l.fuelCost || 0), 0);
    const totalDistance = filteredLogBook.reduce((sum, l) => sum + (l.distanceTraveled || 0), 0);
    const totalFuelConsumed = filteredLogBook.reduce((sum, l) => sum + (l.fuelConsumed || 0), 0);
    
    // Calculate fuel efficiency
    const fuelEfficiency = totalFuelConsumed > 0 ? (totalDistance / totalFuelConsumed).toFixed(2) : 0;
    
    // Maintenance frequency
    const maintenanceFrequency = filteredMaintenance.length;
    
    // Average maintenance cost
    const avgMaintenanceCost = maintenanceFrequency > 0 ? totalMaintenanceCost / maintenanceFrequency : 0;

    return {
      totalMaintenanceCost,
      totalFuelCost,
      totalDistance,
      fuelEfficiency,
      maintenanceFrequency,
      avgMaintenanceCost,
      filteredMaintenance,
      filteredLogBook
    };
  }, [data, selectedVehicle, dateRange]);

  useEffect(() => {
    fetchReportData();
  }, []);

  const fetchReportData = async () => {
    try {
      setLoading(true);
      const [vehiclesRes, maintenanceRes, logBookRes] = await Promise.all([
        vehicleService.getVehicles(),
        vehicleMaintenanceService.getMaintenanceRecords(),
        vehicleLogBookService.getLogBookEntries()
      ]);

      const vehiclesData = vehiclesRes?.data || vehiclesRes || [];
      const maintenanceData = maintenanceRes?.data || maintenanceRes || [];
      const logBookData = logBookRes?.data || logBookRes || [];

      setData({
        vehicles: vehiclesData,
        maintenance: maintenanceData,
        logBook: logBookData
      });
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format) => {
    try {
      setExportLoading(true);
      
      // Find vehicle name for display
      const selectedVehicleObj = data.vehicles.find(v => v._id === selectedVehicle);
      const vehicleDisplayName = selectedVehicleObj 
        ? `${selectedVehicleObj.make} ${selectedVehicleObj.model} (${selectedVehicleObj.licensePlate})`
        : 'All Vehicles';
      
      const exportData = {
        vehicles: data.vehicles,
        maintenance: reports.filteredMaintenance,
        logBook: reports.filteredLogBook,
        filters: {
          selectedVehicle,
          vehicleDisplayName,
          dateRange
        },
        summary: {
          totalMaintenanceCost: reports.totalMaintenanceCost,
          totalFuelCost: reports.totalFuelCost,
          totalDistance: reports.totalDistance,
          fuelEfficiency: reports.fuelEfficiency,
          maintenanceFrequency: reports.maintenanceFrequency,
          avgMaintenanceCost: reports.avgMaintenanceCost
        }
      };

      if (format === 'pdf') {
        await exportToPDF(exportData);
      } else if (format === 'excel') {
        await exportToExcel(exportData);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert(`Export failed: ${error.message}`);
    } finally {
      setExportLoading(false);
    }
  };

  const exportToPDF = async (data) => {
    try {
      // Generate HTML content
      const htmlContent = generateReportHTML(data);
      
      // Create a blob with the HTML content
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      
      // For browsers that support direct PDF download, try to create PDF
      if (window.htmlToPdf) {
        try {
          // Use htmlToPdf if available
          await window.htmlToPdf(htmlContent, 'vehicle-reports.pdf');
          alert('PDF exported successfully!');
          return;
        } catch (pdfError) {
          console.warn('Direct PDF conversion failed, falling back to print dialog');
        }
      }
      
      // Fallback: Open in new window with print dialog
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Please allow popups for this site to export PDF');
        return;
      }
      
      printWindow.document.write(brandPrintHtml(htmlContent, { title: 'Vehicle Report', fit: false })); // Tovus ERP branded print
      printWindow.document.close();
      
      // Wait a moment for content to load, then trigger print
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
        alert('PDF export: Use your browser\'s "Save as PDF" option in the print dialog');
      }, 1000);
      
    } catch (error) {
      console.error('PDF export error:', error);
      alert('PDF export failed. Please try again.');
    }
  };

  const exportToExcel = async (data) => {
    try {
      // Create CSV content (simplified Excel export)
      const csvContent = generateCSVContent(data);
      
      // Add BOM (Byte Order Mark) for proper UTF-8 encoding in Excel
      const BOM = '\uFEFF';
      const csvWithBOM = BOM + csvContent;
      
      const blob = new Blob([csvWithBOM], { type: 'text/csv;charset=utf-8;' });
      
      // Try modern file download approach
      if (window.showSaveFilePicker) {
        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: `vehicle-reports-${new Date().toISOString().split('T')[0]}.csv`,
            types: [{
              description: 'CSV files',
              accept: { 'text/csv': ['.csv'] }
            }]
          });
          
          const writable = await fileHandle.createWritable();
          await writable.write(csvWithBOM);
          await writable.close();
          
          alert('Excel export completed successfully!');
          return;
        } catch (saveError) {
          console.warn('Modern file picker failed, falling back to classic download');
        }
      }
      
      // Fallback: Classical download approach
      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `vehicle-reports-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up the URL object
        setTimeout(() => URL.revokeObjectURL(url), 100);
        
        alert('Excel export completed! File downloaded.');
      } else {
        alert('Excel export failed: Browser does not support file downloads');
      }
    } catch (error) {
      console.error('Excel export error:', error);
      alert('Excel export failed. Please try again.');
    }
  };

  const generateReportHTML = (data) => {
    const now = new Date().toLocaleDateString();
    return `
<!DOCTYPE html>
<html>
  <head>
    <title>Vehicle Reports - ${now}</title>
    <style>
      body { font-family: Arial; margin: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
      .summary { background-color: #e9f5f9; padding: 15px; margin-bottom: 20px; }
      h1, h2 { color: #1976d2; }
    </style>
  </head>
  <body>
    <h1>Vehicle Reports & Analytics</h1>
    <p>Generated on: ${now}</p>
    <p>Filter - Vehicle: ${data.filters.vehicleDisplayName || 'All Vehicles'}, Date Range: ${data.filters.dateRange} days</p>
    
    <div class="summary">
      <h2>Summary</h2>
      <p>Total Maintenance Cost: ${formatCurrency(data.summary.totalMaintenanceCost)}</p>
      <p>Total Fuel Cost: ${formatCurrency(data.summary.totalFuelCost)}</p>
      <p>Total Distance: ${data.summary.totalDistance} km</p>
      <p>Fuel Efficiency: ${data.summary.fuelEfficiency} km/L</p>
      <p>Maintenance Frequency: ${data.summary.maintenanceFrequency}</p>
      <p>Average Maintenance Cost: ${formatCurrency(data.summary.avgMaintenanceCost)}</p>
    </div>
    
    <h2>Maintenance Records</h2>
    <table>
      <thead>
        <tr>
          <th>Vehicle</th>
          <th>Date</th>
          <th>Service Type</th>
          <th>Cost</th>
          <th>Provider</th>
        </tr>
      </thead>
      <tbody>
        ${data.maintenance.map(m => `
          <tr>
            <td>${m.vehicleId?.make || 'N/A'} ${m.vehicleId?.model || ''}</td>
            <td>${formatDate(m.serviceDate)}</td>
            <td>${m.serviceType}</td>
            <td>${formatCurrency(m.cost)}</td>
            <td>${m.serviceProvider || 'N/A'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    <h2>Log Book Entries</h2>
    <table>
      <thead>
        <tr>
          <th>Vehicle</th>
          <th>Driver</th>
          <th>Date</th>
          <th>Purpose</th>
          <th>Distance</th>
          <th>Fuel Cost</th>
        </tr>
      </thead>
      <tbody>
        ${data.logBook.map(l => `
          <tr>
            <td>${l.vehicleId?.make || 'N/A'} ${l.vehicleId?.model || ''}</td>
            <td>${l.driverId?.firstName || 'N/A'} ${l.driverId?.lastName || ''}</td>
            <td>${formatDate(l.date)}</td>
            <td>${l.purpose}</td>
            <td>${l.distanceTraveled} km</td>
            <td>${formatCurrency(l.fuelCost)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </body>
</html>
    `;
  };

  const generateCSVContent = (data) => {
    const csvRows = [];
    
    // Summary CSV
    csvRows.push(['SUMMARY METRICS']);
    csvRows.push(['Total Maintenance Cost', data.summary.totalMaintenanceCost]);
    csvRows.push(['Total Fuel Cost', data.summary.totalFuelCost]);
    csvRows.push(['Total Distance (km)', data.summary.totalDistance]);
    csvRows.push(['Fuel Efficiency (km/L)', data.summary.fuelEfficiency]);
    csvRows.push(['Maintenance Frequency', data.summary.maintenanceFrequency]);
    csvRows.push(['Average Maintenance Cost', data.summary.avgMaintenanceCost]);
    csvRows.push([]);
    
    // Maintenance CSV
    csvRows.push(['MAINTENANCE RECORDS']);
    csvRows.push(['Vehicle', 'Date', 'Service Type', 'Cost', 'Provider', 'Next Service Due']);
    data.maintenance.forEach(m => {
      csvRows.push([
        `${m.vehicleId?.make || ''} ${m.vehicleId?.model || ''}`.trim(),
        formatDate(m.serviceDate),
        m.serviceType || '',
        m.cost || '',
        m.serviceProvider || '',
        formatDate(m.nextServiceDue) || ''
      ]);
    });
    csvRows.push([]);
    
    // Log Book CSV
    csvRows.push(['LOG BOOK ENTRIES']);
    csvRows.push(['Vehicle', 'Driver', 'Date', 'Purpose', 'Distance (km)', 'Fuel Cost', 'Fuel Efficiency']);
    data.logBook.forEach(l => {
      csvRows.push([
        `${l.vehicleId?.make || ''} ${l.vehicleId?.model || ''}`.trim(),
        `${l.driverId?.firstName || ''} ${l.driverId?.lastName || ''}`.trim(),
        formatDate(l.date),
        l.purpose || '',
        l.distanceTraveled || '0',
        l.fuelCost || '0',
        l.fuelEfficiency || '0'
      ]);
    });
    
    return csvRows.map(row => row.join(',')).join('\n');
  };

  const pg = useClientPagination(reports?.filteredMaintenance);
  const pg2 = useClientPagination(reports?.filteredLogBook);
  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        {/* Header Skeleton */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Skeleton variant="text" width="40%" height={40} />
          <Box display="flex" gap={1}>
            <Skeleton variant="rectangular" width={120} height={36} borderRadius={1} />
            <Skeleton variant="rectangular" width={120} height={36} borderRadius={1} />
          </Box>
        </Box>

        {/* Summary Cards Skeleton */}
        <Grid container spacing={3} mb={3}>
          {[1, 2, 3, 4].map((item) => (
            <Grid item xs={12} sm={6} md={3} key={item}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box flexGrow={1}>
                      <Skeleton variant="text" height={16} width="60%" sx={{ mb: 1 }} />
                      <Skeleton variant="text" height={28} width="40%" sx={{ mb: 0.5 }} />
                      <Skeleton variant="text" height={14} width="70%" />
                    </Box>
                    <Skeleton variant="circular" width={40} height={40} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Filters Skeleton */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Skeleton variant="text" width="15%" height={24} sx={{ mb: 2 }} />
            <Grid container spacing={2}>
              {[1, 2, 3].map((item) => (
                <Grid item xs={12} sm={6} md={4} key={item}>
                  <Skeleton variant="rectangular" height={56} width="100%" />
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>

        {/* Tables Skeleton */}
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Skeleton variant="text" width="35%" height={28} sx={{ mb: 2 }} />
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        {[1, 2, 3, 4, 5, 6].map((item) => (
                          <TableCell key={item}><Skeleton variant="text" height={20} /></TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[1, 2, 3, 4].map((row) => (
                        <TableRow key={row}>
                          {[1, 2, 3, 4, 5, 6].map((col) => (
                            <TableCell key={col}><Skeleton variant="text" height={20} width="80%" /></TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Skeleton variant="text" width="30%" height={28} sx={{ mb: 2 }} />
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        {[1, 2, 3, 4, 5, 6].map((item) => (
                          <TableCell key={item}><Skeleton variant="text" height={20} /></TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[1, 2, 3, 4].map((row) => (
                        <TableRow key={row}>
                          {[1, 2, 3, 4, 5, 6].map((col) => (
                            <TableCell key={col}><Skeleton variant="text" height={20} width="75%" /></TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Vehicle Reports & Analytics
        </Typography>
        <Box display="flex" gap={1}>
          <ExportButton onExport={() => handleExport('pdf')} loading={exportLoading} format="PDF" />
          <ExportButton onExport={() => handleExport('excel')} loading={exportLoading} format="Excel" />
        </Box>
      </Box>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Vehicle</InputLabel>
                <Select
                  value={selectedVehicle}
                  onChange={(e) => setSelectedVehicle(e.target.value)}
                  label="Vehicle"
                >
                  <MenuItem value="">All Vehicles</MenuItem>
                  {data.vehicles.map((vehicle) => (
                    <MenuItem key={vehicle._id} value={vehicle._id}>
                      {vehicle.make} {vehicle.model} ({vehicle.licensePlate})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Date Range</InputLabel>
                <Select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  label="Date Range"
                >
                  <MenuItem value="7">Last 7 days</MenuItem>
                  <MenuItem value="30">Last 30 days</MenuItem>
                  <MenuItem value="90">Last 90 days</MenuItem>
                  <MenuItem value="365">Last year</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Button
                variant="contained"
                onClick={fetchReportData}
                fullWidth
              >
                Refresh Data
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <ReportCard
            title="Total Maintenance Cost"
            value={formatCurrency(reports.totalMaintenanceCost)}
            subtitle={`${reports.maintenanceFrequency} services`}
            icon={MaintenanceIcon}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <ReportCard
            title="Total Fuel Cost"
            value={formatCurrency(reports.totalFuelCost)}
            subtitle={`${reports.totalDistance} km traveled`}
            icon={FuelIcon}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <ReportCard
            title="Fuel Efficiency"
            value={`${reports.fuelEfficiency} km/L`}
            subtitle="Average efficiency"
            icon={TrendingIcon}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <ReportCard
            title="Avg Maintenance Cost"
            value={formatCurrency(reports.avgMaintenanceCost)}
            subtitle="Per service"
            icon={MaintenanceIcon}
            color="primary"
          />
        </Grid>
      </Grid>

      {/* Maintenance Records Table */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Maintenance Records
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Vehicle</TableCell>
                  <TableCell>Service Type</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell align="right">Cost</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reports.filteredMaintenance.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography variant="body2" color="text.secondary">
                        {data.maintenance.length === 0 
                          ? 'No maintenance records available' 
                          : `No maintenance records found for selected filter (${reports.filteredMaintenance.length} of ${data.maintenance.length} total)`
                        }
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.rows.map((record) => (
                    <TableRow key={record._id}>
                    <TableCell>
                      {record.vehicleId?.make} {record.vehicleId?.model}
                    </TableCell>
                    <TableCell>{record.maintenanceType}</TableCell>
                    <TableCell>{formatDate(record.serviceDate)}</TableCell>
                    <TableCell>{record.serviceProvider}</TableCell>
                    <TableCell align="right">{formatCurrency(record.cost)}</TableCell>
                    <TableCell>
                      <Chip
                        label={record.status}
                        size="small"
                        color={record.status === 'Completed' ? 'success' : 'default'}
                      />
                    </TableCell>
                  </TableRow>
                  ))
                )}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        </CardContent>
      </Card>

      {/* Log Book Entries Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Log Book Entries
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Vehicle</TableCell>
                  <TableCell>Driver</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Purpose</TableCell>
                  <TableCell align="right">Distance</TableCell>
                  <TableCell align="right">Fuel Cost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reports.filteredLogBook.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography variant="body2" color="text.secondary">
                        {data.logBook.length === 0 
                          ? 'No log book entries available' 
                          : `No log book entries found for selected filter (${reports.filteredLogBook.length} of ${data.logBook.length} total)`
                        }
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  pg2.rows.map((entry) => (
                    <TableRow key={entry._id}>
                    <TableCell>
                      {entry.vehicleId?.make} {entry.vehicleId?.model}
                    </TableCell>
                    <TableCell>
                      {entry.driverId?.firstName} {entry.driverId?.lastName}
                    </TableCell>
                    <TableCell>{formatDate(entry.date)}</TableCell>
                    <TableCell>{entry.purpose}</TableCell>
                    <TableCell align="right">{entry.distanceTraveled || 0} km</TableCell>
                    <TableCell align="right">{formatCurrency(entry.fuelCost || 0)}</TableCell>
                  </TableRow>
                  ))
                )}
              </TableBody>
            </Table>{pg2.bar}
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default VehicleReports;
