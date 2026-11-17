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
  Chip
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Business as BusinessIcon
} from '@mui/icons-material';
import api from '../../services/authService';
import useClientPagination from '../../hooks/useClientPagination';

const DepartmentManagement = () => {
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    manager: '',
    parentDepartment: ''
  });

  // Fetch departments
  const fetchDepartments = async () => {
    try {
      setLoading(true);
      const response = await api.get('/hr/departments');
      setDepartments(response.data.data || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
      setSnackbar({
        open: true,
        message: 'Error fetching departments',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch employees for manager selection
  const fetchEmployees = async () => {
    try {
      const response = await api.get('/hr/employees?limit=1000');
      setEmployees(response.data.data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  // Initial data fetch - only run once on mount
  useEffect(() => {
    fetchDepartments();
    fetchEmployees();
  }, []); // Empty dependency array - only run once

  const handleAddDepartment = () => {
    setEditingDepartment(null);
    setFormData({
      name: '',
      description: '',
      manager: '',
      parentDepartment: ''
    });
    setDialogOpen(true);
  };

  const handleEditDepartment = (department) => {
    setEditingDepartment(department);
    setFormData({
      name: department.name,
      description: department.description || '',
      manager: department.manager?._id || '',
      parentDepartment: department.parentDepartment?._id || ''
    });
    setDialogOpen(true);
  };

  const handleSaveDepartment = async () => {
    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        manager: formData.manager || null,
        parentDepartment: formData.parentDepartment || null
      };
      if (editingDepartment) {
        await api.put(`/hr/departments/${editingDepartment._id}`, payload);
        setSnackbar({
          open: true,
          message: 'Department updated successfully',
          severity: 'success'
        });
      } else {
        await api.post('/hr/departments', payload);
        setSnackbar({
          open: true,
          message: 'Department created successfully',
          severity: 'success'
        });
      }
      setDialogOpen(false);
      fetchDepartments();
    } catch (error) {
      console.error('Error saving department:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error saving department',
        severity: 'error'
      });
    }
  };

  const handleDeleteDepartment = async (department) => {
    if (window.confirm(`Are you sure you want to delete ${department.name}?`)) {
      try {
        await api.delete(`/hr/departments/${department._id}`);
        setSnackbar({
          open: true,
          message: 'Department deleted successfully',
          severity: 'success'
        });
        fetchDepartments();
      } catch (error) {
        console.error('Error deleting department:', error);
        setSnackbar({
          open: true,
          message: 'Error deleting department',
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

  const pg = useClientPagination(departments);
  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading departments...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Department Management</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddDepartment}
        >
          Add Department
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Department</TableCell>
              <TableCell>Manager</TableCell>
              <TableCell>Parent Department</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pg.rows.map((department) => (
              <TableRow key={department._id}>
                <TableCell>
                  <Box>
                    <Typography variant="subtitle2">
                      {department.name}
                    </Typography>
                    {department.description && (
                      <Typography variant="caption" color="textSecondary">
                        {department.description}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  {department.manager ? (
                    `${department.manager.firstName} ${department.manager.lastName}`
                  ) : (
                    'No Manager'
                  )}
                </TableCell>
                <TableCell>
                  {department.parentDepartment ? (
                    department.parentDepartment.name
                  ) : (
                    'None'
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    label={department.isActive ? 'Active' : 'Inactive'}
                    color={department.isActive ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    onClick={() => handleEditDepartment(department)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteDepartment(department)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>{pg.bar}
      </TableContainer>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingDepartment ? 'Edit Department' : 'Add Department'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Department Name"
              value={formData.name}
              onChange={(e) => handleFormChange('name', e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Description"
              value={formData.description}
              onChange={(e) => handleFormChange('description', e.target.value)}
              multiline
              rows={3}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Manager</InputLabel>
              <Select
                value={formData.manager}
                onChange={(e) => handleFormChange('manager', e.target.value)}
                label="Manager"
              >
                <MenuItem value="">No Manager</MenuItem>
                {employees.map((employee) => (
                  <MenuItem key={employee._id} value={employee._id}>
                    {employee.firstName} {employee.lastName} - {employee.employeeId}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Parent Department</InputLabel>
              <Select
                value={formData.parentDepartment}
                onChange={(e) => handleFormChange('parentDepartment', e.target.value)}
                label="Parent Department"
              >
                <MenuItem value="">No Parent Department</MenuItem>
                {departments
                  .filter(dept => !editingDepartment || dept._id !== editingDepartment._id)
                  .map((department) => (
                    <MenuItem key={department._id} value={department._id}>
                      {department.name}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveDepartment} variant="contained">
            {editingDepartment ? 'Update' : 'Create'}
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

export default DepartmentManagement; 