import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
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
  Rating
} from '@mui/material';
import {
  Add,
  Visibility,
  Edit,
  Delete,
  Search,
  FilterList,
  School,
  PlayArrow,
  CheckCircle,
  Schedule,
  Star,
  MoreVert
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import courseService from '../../services/courseService';
import useClientPagination from '../../hooks/useClientPagination';

const Courses = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  
  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');
  
  // Pagination
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCourses, setTotalCourses] = useState(0);

  // Delete confirmation
  const [deleteDialog, setDeleteDialog] = useState({ open: false, course: null });

  useEffect(() => {
    loadCourses();
  }, [page, search, statusFilter, categoryFilter, difficultyFilter]);

  const loadCourses = async () => {
    try {
      setLoading(true);
      
      const params = {
        page,
        limit,
        search: search || undefined,
        status: statusFilter || undefined,
        category: categoryFilter || undefined,
        difficulty: difficultyFilter || undefined
      };

      const response = await courseService.getCourses(params);
      const { docs, totalPages: pages, totalDocs } = response.data;
      
      setCourses(docs);
      setTotalPages(pages);
      setTotalCourses(totalDocs);
      
    } catch (err) {
      setError('Failed to load courses');
      console.error('Error loading courses:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!deleteDialog.course) return;

    try {
      await courseService.deleteCourse(deleteDialog.course._id);
      setSnackbar({
        open: true,
        message: 'Course deleted successfully',
        severity: 'success'
      });
      loadCourses();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to delete course',
        severity: 'error'
      });
    } finally {
      setDeleteDialog({ open: false, course: null });
    }
  };

  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: 'default',
      published: 'success',
      archived: 'error',
      maintenance: 'warning'
    };
    return colors[status] || 'default';
  };

  const getDifficultyColor = (difficulty) => {
    const colors = {
      beginner: 'success',
      intermediate: 'warning',
      advanced: 'error',
      expert: 'error'
    };
    return colors[difficulty] || 'default';
  };

  const formatDuration = (minutes) => {
    if (!minutes) return '0 hours';
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

  const formatRating = (rating) => {
    if (!rating || rating.average === 0) return 'No ratings';
    return `${rating.average.toFixed(1)} (${rating.count})`;
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
    setDifficultyFilter('');
    setPage(1);
  };

  const pg = useClientPagination(courses);
  if (loading && courses.length === 0) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 4 }}>
          <LinearProgress />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Loading courses...
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
              Courses
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Manage and organize learning courses
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => navigate('/hr/learning/courses/new')}
          >
            Create Course
          </Button>
        </Box>

        {/* Filters */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Search courses"
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
                    <MenuItem value="draft">Draft</MenuItem>
                    <MenuItem value="published">Published</MenuItem>
                    <MenuItem value="archived">Archived</MenuItem>
                    <MenuItem value="maintenance">Under Maintenance</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel>Category</InputLabel>
                  <Select
                    value={categoryFilter}
                    label="Category"
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <MenuItem value="">All Categories</MenuItem>
                    <MenuItem value="technical">Technical Skills</MenuItem>
                    <MenuItem value="soft_skills">Soft Skills</MenuItem>
                    <MenuItem value="leadership">Leadership</MenuItem>
                    <MenuItem value="compliance">Compliance</MenuItem>
                    <MenuItem value="productivity">Productivity</MenuItem>
                    <MenuItem value="safety">Safety</MenuItem>
                    <MenuItem value="customer_service">Customer Service</MenuItem>
                    <MenuItem value="sales">Sales</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <FormControl fullWidth>
                  <InputLabel>Difficulty</InputLabel>
                  <Select
                    value={difficultyFilter}
                    label="Difficulty"
                    onChange={(e) => setDifficultyFilter(e.target.value)}
                  >
                    <MenuItem value="">All Levels</MenuItem>
                    <MenuItem value="beginner">Beginner</MenuItem>
                    <MenuItem value="intermediate">Intermediate</MenuItem>
                    <MenuItem value="advanced">Advanced</MenuItem>
                    <MenuItem value="expert">Expert</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={<FilterList />}
                    onClick={clearFilters}
                  >
                    Clear Filters
                  </Button>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                    {totalCourses} courses
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

        {/* Courses Table */}
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Course</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Difficulty</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Enrollments</TableCell>
                  <TableCell>Rating</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((course) => (
                  <TableRow key={course._id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Avatar sx={{ mr: 2, bgcolor: theme.palette.primary.main }}>
                          <School />
                        </Avatar>
                        <Box>
                          <Typography variant="subtitle2" component="div">
                            {course.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {course.courseId}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={course.categoryLabel || course.category}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={course.difficultyLabel || course.difficulty}
                        color={getDifficultyColor(course.difficulty)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDuration(course.duration)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={course.statusLabel || course.status}
                        color={getStatusColor(course.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {course.currentEnrollments || 0}
                        {course.maxEnrollments && ` / ${course.maxEnrollments}`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Rating
                          value={course.rating?.average || 0}
                          readOnly
                          size="small"
                          precision={0.5}
                        />
                        <Typography variant="body2" sx={{ ml: 1 }}>
                          {formatRating(course.rating)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Date(course.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1}>
                        <Tooltip title="View Course">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/hr/learning/courses/${course._id}`)}
                          >
                            <Visibility fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit Course">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/hr/learning/courses/${course._id}/edit`)}
                          >
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete Course">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteDialog({ open: true, course })}
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
          onClose={() => setDeleteDialog({ open: false, course: null })}
        >
          <DialogTitle>Delete Course</DialogTitle>
          <DialogContent>
            <Typography>
              Are you sure you want to delete "{deleteDialog.course?.title}"? This action cannot be undone.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setDeleteDialog({ open: false, course: null })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteCourse}
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

export default Courses; 