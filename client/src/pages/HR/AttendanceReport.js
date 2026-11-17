import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Card,
  CardContent,
  Grid,
  Tabs,
  Tab,
  Chip,
  Alert,
  CircularProgress,
  Checkbox,
  FormControlLabel
} from '@mui/material';
import {
  Calculate as CalculateIcon,
  Assessment as ReportIcon,
  FileDownload as ExportIcon,
  DesignServices as DesignerIcon,
  Sort as SortIcon
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import api from '../../services/api';
import { formatAttendanceTime, formatLocalDate, isLateCheckIn, getTimeDifference } from '../../utils/timezoneHelper';
import useClientPagination from '../../hooks/useClientPagination';

const AttendanceReport = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [attendanceData, setAttendanceData] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [filters, setFilters] = useState({
    department: '',
    employee: '',
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    endDate: new Date()
  });
  const [sortOptions, setSortOptions] = useState({
    department: false,
    userNum: false,
    name: false,
    time: false,
    descend: false
  });

  // Fetch employees and departments - only run once on mount
  useEffect(() => {
    fetchEmployees();
    fetchDepartments();
  }, []); // Empty dependency array - only run once

  const fetchEmployees = async () => {
    try {
      const response = await api.get('/hr/employees?limit=1000');
      if (response.data.success) {
        setEmployees(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await api.get('/hr/departments');
      if (response.data.success) {
        setDepartments(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const fetchAttendanceReport = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        startDate: filters.startDate.toISOString(),
        endDate: filters.endDate.toISOString(),
        department: filters.department,
        employee: filters.employee
      });

      const response = await api.get(`/attendance/report?${params.toString()}`);
      
      if (response.data.success) {
        setAttendanceData(response.data.data);
      } else {
        setError('Failed to fetch attendance report');
      }
    } catch (error) {
      console.error('Error fetching attendance report:', error);
      setError('Failed to fetch attendance report');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSortChange = (field) => {
    setSortOptions(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const formatTime = (time) => {
    if (!time) return '';
    return new Date(time).toLocaleTimeString('en-GB', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const calculateLateMinutes = (checkInTime, scheduledTime = '07:00') => {
    if (!checkInTime) return 0;
    
    const checkIn = new Date(checkInTime);
    const [scheduledHour, scheduledMinute] = scheduledTime.split(':').map(Number);
    const scheduled = new Date(checkIn);
    scheduled.setHours(scheduledHour, scheduledMinute, 0, 0);
    
    if (checkIn > scheduled) {
      return Math.floor((checkIn - scheduled) / (1000 * 60));
    }
    return 0;
  };

  const getStatusColor = (record) => {
    if (!record.checkIn?.time) return 'error';
    if (!record.checkOut?.time) return 'warning';
    return 'success';
  };

  const getLateDisplay = (record) => {
    const lateMinutes = calculateLateMinutes(record.checkIn?.time);
    if (lateMinutes > 0) {
      const hours = Math.floor(lateMinutes / 60);
      const minutes = lateMinutes % 60;
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
    return '';
  };

  const calculateWorkHours = (checkIn, checkOut) => {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffMs = end - start;
    return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
  };

  const pg = useClientPagination(attendanceData);
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 'bold' }}>
        Attendance Calculation
      </Typography>

      {/* Filters Section */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Department</InputLabel>
                <Select
                  value={filters.department}
                  onChange={(e) => handleFilterChange('department', e.target.value)}
                  label="Department"
                >
                  <MenuItem value="">All Departments</MenuItem>
                  {departments.map((dept) => (
                    <MenuItem key={dept._id} value={dept._id}>
                      {dept.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Employee</InputLabel>
                <Select
                  value={filters.employee}
                  onChange={(e) => handleFilterChange('employee', e.target.value)}
                  label="Employee"
                >
                  <MenuItem value="">All Employees</MenuItem>
                  {employees.map((emp) => (
                    <MenuItem key={emp._id} value={emp._id}>
                      {emp.firstName} {emp.lastName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <DatePicker
                  label="From Date"
                  value={filters.startDate}
                  onChange={(newValue) => handleFilterChange('startDate', newValue)}
                  renderInput={(params) => <TextField {...params} size="small" fullWidth />}
                />
              </LocalizationProvider>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <DatePicker
                  label="To Date"
                  value={filters.endDate}
                  onChange={(newValue) => handleFilterChange('endDate', newValue)}
                  renderInput={(params) => <TextField {...params} size="small" fullWidth />}
                />
              </LocalizationProvider>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Button
                variant="contained"
                startIcon={<CalculateIcon />}
                onClick={fetchAttendanceReport}
                disabled={loading}
                fullWidth
              >
                Calculate
              </Button>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <Button
                variant="outlined"
                startIcon={<ReportIcon />}
                onClick={fetchAttendanceReport}
                disabled={loading}
                fullWidth
              >
                Report
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Sort Options */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Sort Options
          </Typography>
          <Grid container spacing={2}>
            <Grid item>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sortOptions.department}
                    onChange={() => handleSortChange('department')}
                  />
                }
                label="Department"
              />
            </Grid>
            <Grid item>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sortOptions.userNum}
                    onChange={() => handleSortChange('userNum')}
                  />
                }
                label="User Num."
              />
            </Grid>
            <Grid item>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sortOptions.name}
                    onChange={() => handleSortChange('name')}
                  />
                }
                label="Name"
              />
            </Grid>
            <Grid item>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sortOptions.time}
                    onChange={() => handleSortChange('time')}
                  />
                }
                label="Time"
              />
            </Grid>
            <Grid item>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sortOptions.descend}
                    onChange={() => handleSortChange('descend')}
                  />
                }
                label="Descend"
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
          <Tab label="Clock In/Out Log Exceptions" />
          <Tab label="Shift Exception" />
          <Tab label="Misc Exception" />
          <Tab label="Calculated Items" />
          <Tab label="OT Reports" />
          <Tab label="No Shift User Alt" />
        </Tabs>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Attendance Report Table */}
      {activeTab === 0 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: 'primary.main' }}>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Emp No.</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>AC-No.</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>No.</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Name</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Auto-Assign</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Date</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Timetable</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>On Duty</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Off Duty</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Clock In</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Clock Out</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Normal</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Real Time</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Late</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Early Out</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>OT</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Absent</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Leave</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Holiday</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Total</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Status</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>Remarks</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={24} align="center">
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : attendanceData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={24} align="center">
                    No attendance data found
                  </TableCell>
                </TableRow>
              ) : (
                pg.rows.map((record, index) => (
                  <TableRow 
                    key={record._id || index}
                    sx={{
                      backgroundColor: !record.checkIn?.time || !record.checkOut?.time ? '#ffebee' : 
                                    record.checkOut?.time ? '#e8f5e8' : 'inherit'
                    }}
                  >
                    <TableCell>{record.employee?.employeeId || ''}</TableCell>
                    <TableCell>{record.employee?._id?.slice(-4) || ''}</TableCell>
                    <TableCell>{pg.offset + index + 1}</TableCell>
                    <TableCell>
                      {record.employee ? `${record.employee.firstName} ${record.employee.lastName}` : ''}
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell>{formatDate(record.date)}</TableCell>
                    <TableCell>General</TableCell>
                    <TableCell>07:00</TableCell>
                    <TableCell>20:00</TableCell>
                    <TableCell 
                      sx={{ 
                        backgroundColor: !record.checkIn?.time ? '#ffcdd2' : 
                                      record.checkIn?.time ? '#c8e6c9' : 'inherit'
                      }}
                    >
                      {formatTime(record.checkIn?.time)}
                    </TableCell>
                    <TableCell 
                      sx={{ 
                        backgroundColor: !record.checkOut?.time ? '#ffcdd2' : 
                                      record.checkOut?.time ? '#c8e6c9' : 'inherit'
                      }}
                    >
                      {formatTime(record.checkOut?.time)}
                    </TableCell>
                    <TableCell>1</TableCell>
                    <TableCell>{record.checkIn?.time && record.checkOut?.time ? '0.5' : '1'}</TableCell>
                    <TableCell>{getLateDisplay(record)}</TableCell>
                    <TableCell></TableCell>
                    <TableCell>{record.overtimeHours || 0}</TableCell>
                    <TableCell>{record.status === 'Absent' ? '1' : '0'}</TableCell>
                    <TableCell>{record.status === 'Leave' ? '1' : '0'}</TableCell>
                    <TableCell>{record.status === 'Holiday' ? '1' : '0'}</TableCell>
                    <TableCell>{calculateWorkHours(record.checkIn?.time, record.checkOut?.time)}</TableCell>
                    <TableCell>
                      <Chip 
                        label={record.status} 
                        color={getStatusColor(record)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{record.notes || ''}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}

      {/* Other tabs content */}
      {activeTab > 0 && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="h6" color="textSecondary">
            {activeTab === 1 && 'Shift Exception'}
            {activeTab === 2 && 'Misc Exception'}
            {activeTab === 3 && 'Calculated Items'}
            {activeTab === 4 && 'OT Reports'}
            {activeTab === 5 && 'No Shift User Alt'}
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            This feature is coming soon...
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default AttendanceReport;
