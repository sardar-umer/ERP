import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Chip,
  IconButton,
  Tooltip,
  Alert,
  Snackbar,
  Container,
  Stack,
  TextField,
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
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Rating,
  FormControlLabel,
  Switch
} from '@mui/material';
import {
  Add,
  Visibility,
  Edit,
  Delete,
  Search,
  FilterList,
  People,
  PlayArrow,
  CheckCircle,
  Schedule,
  Star,
  MoreVert,
  Assignment,
  PersonAdd
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import enrollmentService from '../../services/enrollmentService';
import useClientPagination from '../../hooks/useClientPagination';

const Enrollments = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  
  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [enrollmentTypeFilter, setEnrollmentTypeFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  
  // Pagination
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(0);
  const [totalEnrollments, setTotalEnrollments] = useState(0);

  // Delete confirmation
  const [deleteDialog, setDeleteDialog] = useState({ open: false, enrollment: null });

  useEffect(() => {
    loadEnrollments();
  }, [page, search, statusFilter, enrollmentTypeFilter, employeeFilter, courseFilter]);

  const loadEnrollments = async () => {
    try {
      setLoading(true);
      
      const params = {
        page,
        limit,
        search: search || undefined,
        status: statusFilter || undefined,
        enrollmentType: enrollmentTypeFilter || undefined,
        employee: employeeFilter || undefined,
        course: courseFilter || undefined
      };

      const response = await enrollmentService.getEnrollments(params);
      const { docs, totalPages: pages, totalDocs } = response.data;
      
      setEnrollments(docs);
      setTotalPages(pages);
      setTotalEnrollments(totalDocs);
      
    } catch (err) {
      setError('Failed to load enrollments');
      console.error('Error loading enrollments:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEnrollment = async () => {
    if (!deleteDialog.enrollment) return;

    try {
      await enrollmentService.deleteEnrollment(deleteDialog.enrollment._id);
      setSnackbar({
        open: true,
        message: 'Enrollment deleted successfully',
        severity: 'success'
      });
      loadEnrollments();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to delete enrollment',
        severity: 'error'
      });
    } finally {
      setDeleteDialog({ open: false, enrollment: null });
    }
  };

  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  const getStatusColor = (status) => {
    const colors = {
      enrolled: 'info',
      in_progress: 'warning',
      completed: 'success',
      dropped: 'error',
      expired: 'default'
    };
    return colors[status] || 'default';
  };

  const getEnrollmentTypeColor = (type) => {
    const colors = {
      self_enrolled: 'primary',
      assigned: 'secondary',
      required: 'error',
      recommended: 'success'
    };
    return colors[type] || 'default';
  };

  const formatProgress = (progress) => {
    if (!progress) return '0%';
    return `${Math.round(progress)}%`;
  };

  const formatTimeSpent = (minutes) => {
    if (!minutes) return '0 minutes';
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (hours === 0) {
      return `${remainingMinutes} minutes`;
    } else if (remainingMinutes === 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      return `${hours}h ${remainingMinutes}m`;
    }
  };

  const formatDueDate = (dueDate) => {
    if (!dueDate) return 'No due date';
    
    const date = new Date(dueDate);
    const now = new Date();
    const diffTime = date - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return `${Math.abs(diffDays)} days overdue`;
    } else if (diffDays === 0) {
      return 'Due today';
    } else if (diffDays === 1) {
      return 'Due tomorrow';
    } else if (diffDays <= 7) {
      return `Due in ${diffDays} days`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setEnrollmentTypeFilter('');
    setEmployeeFilter('');
    setCourseFilter('');
    setPage(1);
  };

  const pg = useClientPagination(enrollments);
  if (loading && enrollments.length === 0) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 4 }}>
          <LinearProgress />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Loading enrollments...
          </Typography>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 4 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
          <Box>
            <Typography variant="h4" component="h1" gutterBottom>
              Enrollments
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Manage employee course enrollments and track progress
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<PersonAdd />}
            onClick={() => navigate('/hr/learning/enrollments/new')}
          >
            Enroll Employee
          </Button>
        </Box>

        {/* Filters */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={2}>
                <TextField
                  fullWidth
                  label="Search enrollments"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  InputProps={{
                    startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />
                  }}
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={statusFilter}
                    label="Status"
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <MenuItem value="">All Status</MenuItem>
                    <MenuItem value="enrolled">Enrolled</MenuItem>
                    <MenuItem value="in_progress">In Progress</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                    <MenuItem value="dropped">Dropped</MenuItem>
                    <MenuItem value="expired">Expired</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel>Enrollment Type</InputLabel>
                  <Select
                    value={enrollmentTypeFilter}
                    label="Enrollment Type"
                    onChange={(e) => setEnrollmentTypeFilter(e.target.value)}
                  >
                    <MenuItem value="">All Types</MenuItem>
                    <MenuItem value="self_enrolled">Self Enrolled</MenuItem>
                    <MenuItem value="assigned">Assigned</MenuItem>
                    <MenuItem value="required">Required</MenuItem>
                    <MenuItem value="recommended">Recommended</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel>Employee</InputLabel>
                  <Select
                    value={employeeFilter}
                    label="Employee"
                    onChange={(e) => setEmployeeFilter(e.target.value)}
                  >
                    <MenuItem value="">All Employees</MenuItem>
                    {/* This would be populated with actual employees */}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel>Course</InputLabel>
                  <Select
                    value={courseFilter}
                    label="Course"
                    onChange={(e) => setCourseFilter(e.target.value)}
                  >
                    <MenuItem value="">All Courses</MenuItem>
                    {/* This would be populated with actual courses */}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={<FilterList />}
                    onClick={clearFilters}
                  >
                    Clear Filters
                  </Button>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                    {totalEnrollments} enrollments
                  </Typography>
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Error Alert */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {/* Enrollments Table */}
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell>Course</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Progress</TableCell>
                  <TableCell>Time Spent</TableCell>
                  <TableCell>Enrollment Type</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((enrollment) => (
                  <TableRow key={enrollment._id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Avatar sx={{ mr: 2, bgcolor: theme.palette.primary.main }}>
                          <People />
                        </Avatar>
                        <Box>
                          <Typography variant="subtitle2" component="div">
                            {enrollment.employee?.firstName} {enrollment.employee?.lastName}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {enrollment.employee?.email}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box>
                        <Typography variant="subtitle2" component="div">
                          {enrollment.course?.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {enrollment.course?.courseId}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={enrollment.statusLabel || enrollment.status}
                        color={getStatusColor(enrollment.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ mr: 1 }}>
                          {formatProgress(enrollment.progress)}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={enrollment.progress || 0}
                          sx={{ width: 60, height: 6, borderRadius: 3 }}
                        />
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatTimeSpent(enrollment.totalTimeSpent)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={enrollment.enrollmentTypeLabel || enrollment.enrollmentType}
                        color={getEnrollmentTypeColor(enrollment.enrollmentType)}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDueDate(enrollment.dueDate)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Date(enrollment.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1}>
                        <Tooltip title="View Enrollment">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/hr/learning/enrollments/${enrollment._id}`)}
                          >
                            <Visibility fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit Enrollment">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/hr/learning/enrollments/${enrollment._id}/edit`)}
                          >
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete Enrollment">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteDialog({ open: true, enrollment })}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                Page {page} of {totalPages}
              </Typography>
              <Button
                variant="outlined"
                disabled={page === totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </Stack>
          </Box>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={deleteDialog.open}
          onClose={() => setDeleteDialog({ open: false, enrollment: null })}
        >
          <DialogTitle>Delete Enrollment</DialogTitle>
          <DialogContent>
            <Typography>
              Are you sure you want to delete this enrollment? This action cannot be undone.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setDeleteDialog({ open: false, enrollment: null })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteEnrollment}
              color="error"
              variant="contained"
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>

        {/* Snackbar */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={6000}
          onClose={handleSnackbarClose}
        >
          <Alert onClose={handleSnackbarClose} severity={snackbar.severity}>
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Box>
    </Container>
  );
};

export default Enrollments; 