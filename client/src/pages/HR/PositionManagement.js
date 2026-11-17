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
  Button,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Snackbar,
  Chip,
  Grid
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Work as WorkIcon
} from '@mui/icons-material';
import api from '../../services/authService';
import useClientPagination from '../../hooks/useClientPagination';

const PositionManagement = () => {
  const [positions, setPositions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [formData, setFormData] = useState({
    title: '',
    department: '',
    description: '',
    level: 'Entry',
    minSalary: '',
    maxSalary: '',
    requirements: [''],
    responsibilities: ['']
  });
  const [quickAddDialog, setQuickAddDialog] = useState(false);
  const [quickAddData, setQuickAddData] = useState({
    title: '',
    department: '',
    level: 'Entry',
    description: ''
  });

  // Fetch positions
  const fetchPositions = async () => {
    try {
      setLoading(true);
      const response = await api.get('/positions');
      setPositions(response.data.data || []);
    } catch (error) {
      console.error('Error fetching positions:', error);
      setSnackbar({
        open: true,
        message: 'Error fetching positions',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch departments
  const fetchDepartments = async () => {
    try {
      const response = await api.get('/hr/departments');
      setDepartments(response.data.data || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  useEffect(() => {
    fetchPositions();
    fetchDepartments();
  }, []);

  const handleAddPosition = () => {
    setEditingPosition(null);
    setFormData({
      title: '',
      department: '',
      description: '',
      level: 'Entry',
      minSalary: '',
      maxSalary: '',
      requirements: [''],
      responsibilities: ['']
    });
    setDialogOpen(true);
  };

  const handleEditPosition = (position) => {
    setEditingPosition(position);
    setFormData({
      title: position.title,
      department: position.department._id,
      description: position.description || '',
      level: position.level,
      minSalary: position.minSalary || '',
      maxSalary: position.maxSalary || '',
      requirements: position.requirements && position.requirements.length > 0 ? position.requirements : [''],
      responsibilities: position.responsibilities && position.responsibilities.length > 0 ? position.responsibilities : ['']
    });
    setDialogOpen(true);
  };

  const handleSavePosition = async () => {
    try {
      const dataToSend = {
        ...formData,
        minSalary: formData.minSalary ? parseFloat(formData.minSalary) : undefined,
        maxSalary: formData.maxSalary ? parseFloat(formData.maxSalary) : undefined,
        requirements: formData.requirements.filter(req => req.trim() !== ''),
        responsibilities: formData.responsibilities.filter(resp => resp.trim() !== '')
      };

      if (editingPosition) {
        await api.put(`/positions/${editingPosition._id}`, dataToSend);
        setSnackbar({
          open: true,
          message: 'Position updated successfully',
          severity: 'success'
        });
      } else {
        await api.post('/positions', dataToSend);
        setSnackbar({
          open: true,
          message: 'Position created successfully',
          severity: 'success'
        });
      }
      setDialogOpen(false);
      fetchPositions();
    } catch (error) {
      console.error('Error saving position:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error saving position',
        severity: 'error'
      });
    }
  };

  const handleDeletePosition = async (position) => {
    if (window.confirm(`Are you sure you want to delete ${position.title}?`)) {
      try {
        await api.delete(`/positions/${position._id}`);
        setSnackbar({
          open: true,
          message: 'Position deleted successfully',
          severity: 'success'
        });
        fetchPositions();
      } catch (error) {
        console.error('Error deleting position:', error);
        setSnackbar({
          open: true,
          message: 'Error deleting position',
          severity: 'error'
        });
      }
    }
  };

  const handleFormChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleArrayChange = (field, index, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => i === index ? value : item)
    }));
  };

  const addArrayItem = (field) => {
    setFormData(prev => ({
      ...prev,
      [field]: [...prev[field], '']
    }));
  };

  const removeArrayItem = (field, index) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index)
    }));
  };

  // Quick add position functions
  const handleQuickAdd = () => {
    setQuickAddData({
      title: '',
      department: '',
      level: 'Entry',
      description: ''
    });
    setQuickAddDialog(true);
  };

  const handleQuickAddSave = async () => {
    try {
      const dataToSend = {
        ...quickAddData,
        minSalary: undefined,
        maxSalary: undefined,
        requirements: [],
        responsibilities: []
      };

      await api.post('/positions', dataToSend);
      setSnackbar({
        open: true,
        message: 'Position added successfully',
        severity: 'success'
      });
      setQuickAddDialog(false);
      fetchPositions();
    } catch (error) {
      console.error('Error adding position:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error adding position',
        severity: 'error'
      });
    }
  };

  const handleQuickAddChange = (field, value) => {
    setQuickAddData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const pg = useClientPagination(positions);
  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading positions...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Position Management</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleQuickAdd}
          >
            Quick Add
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddPosition}
          >
            Add Position
          </Button>
        </Box>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Position</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Level</TableCell>
              <TableCell>Salary Range</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pg.rows.map((position) => (
              <TableRow key={position._id}>
                <TableCell>
                  <Box>
                    <Typography variant="subtitle2">
                      {position.title}
                    </Typography>
                    {position.description && (
                      <Typography variant="caption" color="textSecondary">
                        {position.description}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>{position.department?.name}</TableCell>
                <TableCell>
                  <Chip label={position.level} size="small" />
                </TableCell>
                <TableCell>
                  {position.minSalary && position.maxSalary ? (
                    `${position.minSalary} - ${position.maxSalary} PKR`
                  ) : (
                    'Not specified'
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    label={position.isActive ? 'Active' : 'Inactive'}
                    color={position.isActive ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    onClick={() => handleEditPosition(position)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeletePosition(position)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>{pg.bar}
      </TableContainer>

      {/* Quick Add Dialog */}
      <Dialog open={quickAddDialog} onClose={() => setQuickAddDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Quick Add Position</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Position Title"
                  value={quickAddData.title}
                  onChange={(e) => handleQuickAddChange('title', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Department</InputLabel>
                  <Select
                    value={quickAddData.department}
                    onChange={(e) => handleQuickAddChange('department', e.target.value)}
                    label="Department"
                    required
                  >
                    {departments.map((dept) => (
                      <MenuItem key={dept._id} value={dept._id}>
                        {dept.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Level</InputLabel>
                  <Select
                    value={quickAddData.level}
                    onChange={(e) => handleQuickAddChange('level', e.target.value)}
                    label="Level"
                  >
                    <MenuItem value="Entry">Entry</MenuItem>
                    <MenuItem value="Junior">Junior</MenuItem>
                    <MenuItem value="Mid">Mid</MenuItem>
                    <MenuItem value="Senior">Senior</MenuItem>
                    <MenuItem value="Lead">Lead</MenuItem>
                    <MenuItem value="Manager">Manager</MenuItem>
                    <MenuItem value="Director">Director</MenuItem>
                    <MenuItem value="Executive">Executive</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description"
                  value={quickAddData.description}
                  onChange={(e) => handleQuickAddChange('description', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQuickAddDialog(false)}>Cancel</Button>
          <Button onClick={handleQuickAddSave} variant="contained">
            Add Position
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingPosition ? 'Edit Position' : 'Add Position'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Position Title"
                  value={formData.title}
                  onChange={(e) => handleFormChange('title', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Department</InputLabel>
                  <Select
                    value={formData.department}
                    onChange={(e) => handleFormChange('department', e.target.value)}
                    label="Department"
                  >
                    {departments.map((dept) => (
                      <MenuItem key={dept._id} value={dept._id}>
                        {dept.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Level</InputLabel>
                  <Select
                    value={formData.level}
                    onChange={(e) => handleFormChange('level', e.target.value)}
                    label="Level"
                  >
                    <MenuItem value="Entry">Entry</MenuItem>
                    <MenuItem value="Junior">Junior</MenuItem>
                    <MenuItem value="Mid">Mid</MenuItem>
                    <MenuItem value="Senior">Senior</MenuItem>
                    <MenuItem value="Lead">Lead</MenuItem>
                    <MenuItem value="Manager">Manager</MenuItem>
                    <MenuItem value="Director">Director</MenuItem>
                    <MenuItem value="Executive">Executive</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Minimum Salary"
                  type="number"
                  value={formData.minSalary}
                  onChange={(e) => handleFormChange('minSalary', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Maximum Salary"
                  type="number"
                  value={formData.maxSalary}
                  onChange={(e) => handleFormChange('maxSalary', e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description"
                  value={formData.description}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
              
              {/* Requirements */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Requirements</Typography>
                {formData.requirements.map((req, index) => (
                  <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                    <TextField
                      fullWidth
                      label={`Requirement ${index + 1}`}
                      value={req}
                      onChange={(e) => handleArrayChange('requirements', index, e.target.value)}
                    />
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => removeArrayItem('requirements', index)}
                      disabled={formData.requirements.length === 1}
                    >
                      Remove
                    </Button>
                  </Box>
                ))}
                <Button
                  variant="outlined"
                  onClick={() => addArrayItem('requirements')}
                  sx={{ mt: 1 }}
                >
                  Add Requirement
                </Button>
              </Grid>

              {/* Responsibilities */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Responsibilities</Typography>
                {formData.responsibilities.map((resp, index) => (
                  <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                    <TextField
                      fullWidth
                      label={`Responsibility ${index + 1}`}
                      value={resp}
                      onChange={(e) => handleArrayChange('responsibilities', index, e.target.value)}
                    />
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => removeArrayItem('responsibilities', index)}
                      disabled={formData.responsibilities.length === 1}
                    >
                      Remove
                    </Button>
                  </Box>
                ))}
                <Button
                  variant="outlined"
                  onClick={() => addArrayItem('responsibilities')}
                  sx={{ mt: 1 }}
                >
                  Add Responsibility
                </Button>
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSavePosition} variant="contained">
            {editingPosition ? 'Update' : 'Create'}
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
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PositionManagement; 