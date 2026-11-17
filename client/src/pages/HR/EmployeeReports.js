import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  List,
  ListItem,
  ListItemIcon,
  ListItemText
} from '@mui/material';
import {
  DateRange,
  Download,
  Assessment,
  ExpandMore,
  FileDownload,
  Visibility,
  Description,
  TableChart,

} from '@mui/icons-material';
import { formatPKR } from '../../utils/currency';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const EmployeeReports = () => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'info'
  });
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState('csv');

  const generateReport = async (format = 'json', isDownload = false) => {
    if (!startDate || !endDate) {
      setSnackbar({
        open: true,
        message: 'Please select both start and end dates',
        severity: 'error'
      });
      return;
    }

    setLoading(true);
    try {
      const response = await api.get('/hr/employees/report', {
        params: {
          startDate,
          endDate,
          format
        },
        responseType: format === 'csv' ? 'blob' : 'json'
      });

      if (format === 'csv') {
        // Handle CSV download
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `employee-report-${startDate}-to-${endDate}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        setSnackbar({
          open: true,
          message: 'CSV report downloaded successfully!',
          severity: 'success'
        });
      } else if (format === 'json' && isDownload) {
        // Handle JSON download
        const jsonData = JSON.stringify(response.data, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `employee-report-${startDate}-to-${endDate}.json`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        setSnackbar({
          open: true,
          message: 'JSON report downloaded successfully!',
          severity: 'success'
        });
      } else {
        // Handle JSON response for viewing (not downloading)
        setReportData(response.data.data);
        setSnackbar({
          open: true,
          message: response.data.message,
          severity: 'success'
        });
      }
    } catch (error) {
      console.error('Error generating report:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error generating report',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const openDownloadDialog = () => {
    if (!reportData) {
      setSnackbar({
        open: true,
        message: 'Please generate a report first before downloading',
        severity: 'warning'
      });
      return;
    }
    setDownloadDialogOpen(true);
  };

  const handleDownload = () => {
    setDownloadDialogOpen(false);
    generateReport(selectedFormat, true);
  };

  const downloadCSV = () => {
    generateReport('csv', true);
  };

  const viewReport = () => {
    generateReport('json', false);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const pg = useClientPagination(reportData?.employees);
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Employee Reports
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Generate comprehensive employee reports by date range
      </Typography>

      {/* Report Generation Form */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <DateRange sx={{ mr: 1, verticalAlign: 'middle' }} />
            Generate Report
          </Typography>
          
          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  startIcon={<Visibility />}
                  onClick={viewReport}
                  disabled={loading}
                  sx={{ flex: 1 }}
                >
                  {loading ? <CircularProgress size={20} /> : 'View Report'}
                </Button>
                <Tooltip title="Download Report">
                  <IconButton
                    color="primary"
                    onClick={openDownloadDialog}
                    disabled={loading}
                  >
                    <FileDownload />
                  </IconButton>
                </Tooltip>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Report Results */}
      {reportData && (
        <Box>
          {/* Report Summary */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  <Assessment sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Report Summary
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<FileDownload />}
                  onClick={openDownloadDialog}
                  size="small"
                >
                  Download Report
                </Button>
              </Box>
              
              <Grid container spacing={3}>
                <Grid item xs={12} sm={3}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Total Employees
                  </Typography>
                  <Typography variant="h4" color="primary">
                    {reportData.reportInfo.totalEmployees}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Total Salary
                  </Typography>
                  <Typography variant="h4" color="success.main">
                    {formatPKR(reportData.reportInfo.totalGrossSalary || reportData.reportInfo.totalBasicSalary || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Average Salary
                  </Typography>
                  <Typography variant="h4" color="info.main">
                    {formatPKR(reportData.reportInfo.averageGrossSalary || reportData.reportInfo.averageBasicSalary || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Date Range
                  </Typography>
                  <Typography variant="h6">
                    {formatDate(reportData.reportInfo.startDate)} - {formatDate(reportData.reportInfo.endDate)}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Department Statistics */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Department Statistics
              </Typography>
              
              <Grid container spacing={2}>
                {Object.entries(reportData.departmentStats).map(([dept, stats]) => (
                  <Grid item xs={12} sm={6} md={4} key={dept}>
                    <Paper sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h6" color="primary">
                        {dept}
                      </Typography>
                      <Typography variant="h4">
                        {stats.count}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatPKR(stats.totalSalary)}
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>

          {/* Employee List */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Employee Details ({reportData.employees.length} employees)
              </Typography>
              
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Employee ID</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell>Phone</TableCell>
                      <TableCell>Hire Date</TableCell>
                      <TableCell>Department</TableCell>
                      <TableCell>Position</TableCell>
                      <TableCell>Salary</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pg.rows.map((employee) => (
                      <TableRow key={employee.employeeId}>
                        <TableCell>{employee.employeeId}</TableCell>
                        <TableCell>
                          {employee.firstName} {employee.lastName}
                        </TableCell>
                        <TableCell>{employee.email}</TableCell>
                        <TableCell>{employee.phone}</TableCell>
                        <TableCell>
                          {employee.hireDate ? formatDate(employee.hireDate) : 'N/A'}
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={typeof employee.placementDepartment === 'object' ? employee.placementDepartment?.name : typeof employee.department === 'object' ? employee.department?.name : employee.placementDepartment || employee.department || 'N/A'} 
                            size="small" 
                            color="primary" 
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>{employee.position}</TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            Basic: {formatPKR(employee.salary?.basic || 0)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Gross: {formatPKR(
                              (employee.salary?.basic || 0) +
                              (employee.salary?.houseRent || 0) +
                              (employee.salary?.medical || 0) +
                              (employee.salary?.conveyance || 0) +
                              (employee.salary?.special || 0) +
                              (employee.salary?.other || 0)
                            )}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={employee.status} 
                            size="small" 
                            color={employee.status === 'Active' ? 'success' : 'default'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>{pg.bar}
              </TableContainer>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Download Format Selection Dialog */}
      <Dialog
        open={downloadDialogOpen}
        onClose={() => setDownloadDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FileDownload color="primary" />
            Download Report
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Choose the format for your report download:
          </Typography>
          
          <FormControl component="fieldset" fullWidth>
            <RadioGroup
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value)}
            >
              <List>
                <ListItem>
                  <ListItemIcon>
                    <TableChart color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="CSV Format"
                    secondary="Comma-separated values file. Best for Excel, Google Sheets, and data analysis."
                  />
                  <FormControlLabel
                    value="csv"
                    control={<Radio />}
                    label=""
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <Description color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary="JSON Format"
                    secondary="JavaScript Object Notation. Best for developers and data processing."
                  />
                  <FormControlLabel
                    value="json"
                    control={<Radio />}
                    label=""
                  />
                </ListItem>

              </List>
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDownloadDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDownload}
            variant="contained"
            startIcon={<Download />}
          >
            Download {selectedFormat.toUpperCase()}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default EmployeeReports; 