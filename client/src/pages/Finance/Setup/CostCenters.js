import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  FormControlLabel,
  CircularProgress,
  Chip
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import api from '../../../services/api';
import toast from 'react-hot-toast';
import useClientPagination from '../../../hooks/useClientPagination';

export default function CostCenters() {
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentCostCenter, setCurrentCostCenter] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', isActive: true });

  const fetchCostCenters = async () => {
    try {
      setLoading(true);
      const res = await api.get('/finance/cost-centers');
      if (res.data.success) {
        setCostCenters(res.data.data);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error fetching cost centers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCostCenters();
    // eslint-disable-next-line
  }, []);

  const handleOpenDialog = (costCenter = null) => {
    if (costCenter) {
      setCurrentCostCenter(costCenter);
      setFormData({
        name: costCenter.name,
        description: costCenter.description || '',
        isActive: costCenter.isActive
      });
    } else {
      setCurrentCostCenter(null);
      setFormData({ name: '', description: '', isActive: true });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setCurrentCostCenter(null);
  };

  const handleChange = (e) => {
    const { name, value, checked, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name) {
      toast.error('Name is required');
      return;
    }
    
    try {
      let res;
      if (currentCostCenter) {
        res = await api.put(`/finance/cost-centers/${currentCostCenter._id}`, formData);
      } else {
        res = await api.post('/finance/cost-centers', formData);
      }
      if (res.data.success) {
        toast.success('Cost Center saved successfully');
        setDialogOpen(false);
        fetchCostCenters();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving cost center');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this cost center?')) return;
    try {
      const res = await api.delete(`/finance/cost-centers/${id}`);
      if (res.data.success) {
        toast.success('Cost Center deleted');
        fetchCostCenters();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error deleting cost center');
    }
  };

  const pg = useClientPagination(costCenters);
  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight="bold">
          Cost Centers (Projects/BUs)
        </Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Add Cost Center
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        {loading ? (
          <Box p={3} textAlign="center">
            <CircularProgress />
          </Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {costCenters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">No Cost Centers found</TableCell>
                </TableRow>
              ) : (
                pg.rows.map((cc) => (
                  <TableRow key={cc._id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{cc.name}</TableCell>
                    <TableCell>{cc.description}</TableCell>
                    <TableCell>
                      <Chip 
                        label={cc.isActive ? 'Active' : 'Inactive'} 
                        color={cc.isActive ? 'success' : 'default'} 
                        size="small" 
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton size="small" color="primary" onClick={() => handleOpenDialog(cc)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(cc._id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </TableContainer>
      {pg.bar}

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{currentCostCenter ? 'Edit Cost Center' : 'Add Cost Center'}</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth
            label="Name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            margin="normal"
            multiline
            rows={2}
          />
          <Box mt={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.isActive}
                  onChange={handleChange}
                  name="isActive"
                  color="primary"
                />
              }
              label="Active"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained" color="primary">
            {currentCostCenter ? 'Update' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
