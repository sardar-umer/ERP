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
  Divider
} from '@mui/material';
import {
  Add,
  Visibility,
  Edit,
  Delete,
  Search,
  FilterList,
  School,
  People,
  CheckCircle,
  Schedule,
  Star,
  MoreVert,
  Assignment,
  Timeline,
  TrendingUp
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import trainingProgramService from '../../services/trainingProgramService';
import useClientPagination from '../../hooks/useClientPagination';

const TrainingPrograms = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
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
  const [totalPrograms, setTotalPrograms] = useState(0);

  // Delete confirmation
  const [deleteDialog, setDeleteDialog] = useState({ open: false, program: null });
  
  // Status update confirmation
  const [statusDialog, setStatusDialog] = useState({ open: false, program: null, newStatus: '' });

  useEffect(() => {
    loadPrograms();
  }, [page, search, statusFilter, categoryFilter, difficultyFilter]);

  const loadPrograms = async () => {
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

      const response = await trainingProgramService.getTrainingPrograms(params);
      const { docs, totalPages: pages, totalDocs } = response.data;
      
      setPrograms(docs);
      setTotalPages(pages);
      setTotalPrograms(totalDocs);
      
    } catch (err) {
      setError('Failed to load training programs');
      console.error('Error loading training programs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProgram = async () => {
    if (!deleteDialog.program) return;

    try {
      await trainingProgramService.deleteTrainingProgram(deleteDialog.program._id);
      setSnackbar({
        open: true,
        message: 'Training program deleted successfully',
        severity: 'success'
      });
      loadPrograms();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to delete training program',
        severity: 'error'
      });
    } finally {
      setDeleteDialog({ open: false, program: null });
    }
  };

  const handleStatusUpdate = async () => {
    if (!statusDialog.program || !statusDialog.newStatus) return;

    try {
      await trainingProgramService.updateTrainingProgramStatus(
        statusDialog.program._id, 
        statusDialog.newStatus
      );
      setSnackbar({
        open: true,
        message: `Training program status updated to ${statusDialog.newStatus} successfully`,
        severity: 'success'
      });
      loadPrograms();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to update training program status',
        severity: 'error'
      });
    } finally {
      setStatusDialog({ open: false, program: null, newStatus: '' });
    }
  };

  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: 'default',
      active: 'success',
      inactive: 'error',
      archived: 'warning'
    };
    return colors[status] || 'default';
  };

  const getDifficultyColor = (difficulty) => {
    const colors = {
      beginner: 'success',
      intermediate: 'warning',
      advanced: 'error',
      expert: 'secondary'
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

  const formatEnrollmentCount = (current, max) => {
    if (!max) return `${current} enrolled`;
    return `${current}/${max} enrolled`;
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
    setDifficultyFilter('');
    setPage(1);
  };

  const pg = useClientPagination(programs);
  if (loading && programs.length === 0) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 4 }}>
          <LinearProgress />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Loading training programs...
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
              Training Programs
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Manage comprehensive training programs and learning paths
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => navigate('/hr/learning/programs/new')}
          >
            Create Program
          </Button>
        </Box>

        {/* Filters */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Search programs"
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
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="inactive">Inactive</MenuItem>
                    <MenuItem value="archived">Archived</MenuItem>
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
                    {totalPrograms} programs
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

        {/* Programs Table */}
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Program</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Difficulty</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Courses</TableCell>
                  <TableCell>Enrollments</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((program) => (
                  <TableRow key={program._id} hover>
                    <TableCell>
                      <Box>
                        <Typography variant="subtitle2" component="div">
                          {program.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {program.programId}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {program.description?.substring(0, 60)}...
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={program.categoryLabel || program.category}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={program.difficultyLabel || program.difficulty}
                        color={getDifficultyColor(program.difficulty)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDuration(program.totalDuration)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {program.courses?.length || 0} courses
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatEnrollmentCount(program.currentEnrollments || 0, program.maxEnrollments)}
                      </Typography>
                      {program.maxEnrollments && (
                        <LinearProgress
                          variant="determinate"
                          value={((program.currentEnrollments || 0) / program.maxEnrollments) * 100}
                          sx={{ height: 4, borderRadius: 2, mt: 0.5 }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={program.statusLabel || program.status}
                        color={getStatusColor(program.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Date(program.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1}>
                        <Tooltip title="View Program">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/hr/learning/programs/${program._id}`)}
                          >
                            <Visibility fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit Program">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/hr/learning/programs/${program._id}/edit`)}
                          >
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {program.status === 'draft' && (
                          <Tooltip title="Activate Program">
                            <IconButton
                              size="small"
                              color="success"
                              onClick={() => setStatusDialog({ 
                                open: true, 
                                program, 
                                newStatus: 'active' 
                              })}
                            >
                              <CheckCircle fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {program.status === 'active' && (
                          <Tooltip title="Deactivate Program">
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={() => setStatusDialog({ 
                                open: true, 
                                program, 
                                newStatus: 'inactive' 
                              })}
                            >
                              <Schedule fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Delete Program">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteDialog({ open: true, program })}
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

        {/* Empty State */}
        {!loading && programs.length === 0 && (
          <Card sx={{ mt: 3 }}>
            <CardContent sx={{ textAlign: 'center', py: 6 }}>
              <School sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                No Training Programs Found
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Create your first training program to get started with structured learning paths.
              </Typography>
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={() => navigate('/hr/learning/programs/new')}
              >
                Create Your First Program
              </Button>
            </CardContent>
          </Card>
        )}

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
          onClose={() => setDeleteDialog({ open: false, program: null })}
        >
          <DialogTitle>Delete Training Program</DialogTitle>
          <DialogContent>
            <Typography>
              Are you sure you want to delete "{deleteDialog.program?.title}"? This action cannot be undone.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setDeleteDialog({ open: false, program: null })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteProgram}
              color="error"
              variant="contained"
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>

        {/* Status Update Confirmation Dialog */}
        <Dialog
          open={statusDialog.open}
          onClose={() => setStatusDialog({ open: false, program: null, newStatus: '' })}
        >
          <DialogTitle>
            {statusDialog.newStatus === 'active' ? 'Activate' : 'Deactivate'} Training Program
          </DialogTitle>
          <DialogContent>
            <Typography>
              Are you sure you want to {statusDialog.newStatus === 'active' ? 'activate' : 'deactivate'} "{statusDialog.program?.title}"?
              {statusDialog.newStatus === 'active' && (
                <Typography component="div" variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  This will make the program available for enrollment.
                </Typography>
              )}
              {statusDialog.newStatus === 'inactive' && (
                <Typography component="div" variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  This will prevent new enrollments but keep existing enrollments active.
                </Typography>
              )}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setStatusDialog({ open: false, program: null, newStatus: '' })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleStatusUpdate}
              color={statusDialog.newStatus === 'active' ? 'success' : 'warning'}
              variant="contained"
            >
              {statusDialog.newStatus === 'active' ? 'Activate' : 'Deactivate'}
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

export default TrainingPrograms; 