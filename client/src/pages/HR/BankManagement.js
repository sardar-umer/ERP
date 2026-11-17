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
  AccountBalance as BankIcon
} from '@mui/icons-material';
import api from '../../services/authService';
import useClientPagination from '../../hooks/useClientPagination';

const BankManagement = () => {
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBank, setEditingBank] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    type: 'Commercial',
    country: 'Pakistan',
    website: '',
    contactInfo: {
      phone: '',
      email: '',
      address: ''
    },
    notes: ''
  });

  // Fetch banks
  const fetchBanks = async () => {
    try {
      setLoading(true);
      const response = await api.get('/banks');
      setBanks(response.data.data || []);
    } catch (error) {
      console.error('Error fetching banks:', error);
      setSnackbar({
        open: true,
        message: 'Error fetching banks',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBanks();
  }, []);

  const handleAddBank = () => {
    setEditingBank(null);
    setFormData({
      name: '',
      code: '',
      type: 'Commercial',
      country: 'Pakistan',
      website: '',
      contactInfo: {
        phone: '',
        email: '',
        address: ''
      },
      notes: ''
    });
    setDialogOpen(true);
  };

  const handleEditBank = (bank) => {
    setEditingBank(bank);
    setFormData({
      name: bank.name,
      code: bank.code,
      type: bank.type,
      country: bank.country,
      website: bank.website || '',
      contactInfo: {
        phone: bank.contactInfo?.phone || '',
        email: bank.contactInfo?.email || '',
        address: bank.contactInfo?.address || ''
      },
      notes: bank.notes || ''
    });
    setDialogOpen(true);
  };

  const handleSaveBank = async () => {
    try {
      if (editingBank) {
        await api.put(`/banks/${editingBank._id}`, formData);
        setSnackbar({
          open: true,
          message: 'Bank updated successfully',
          severity: 'success'
        });
      } else {
        await api.post('/banks', formData);
        setSnackbar({
          open: true,
          message: 'Bank created successfully',
          severity: 'success'
        });
      }
      setDialogOpen(false);
      fetchBanks();
    } catch (error) {
      console.error('Error saving bank:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error saving bank',
        severity: 'error'
      });
    }
  };

  const handleDeleteBank = async (bank) => {
    if (window.confirm(`Are you sure you want to delete ${bank.name}?`)) {
      try {
        await api.delete(`/banks/${bank._id}`);
        setSnackbar({
          open: true,
          message: 'Bank deleted successfully',
          severity: 'success'
        });
        fetchBanks();
      } catch (error) {
        console.error('Error deleting bank:', error);
        setSnackbar({
          open: true,
          message: 'Error deleting bank',
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

  const handleContactChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      contactInfo: {
        ...prev.contactInfo,
        [field]: value
      }
    }));
  };

  const pg = useClientPagination(banks);
  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading banks...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Bank Management</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddBank}
        >
          Add Bank
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Bank</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Country</TableCell>
              <TableCell>Contact</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pg.rows.map((bank) => (
              <TableRow key={bank._id}>
                <TableCell>
                  <Box>
                    <Typography variant="subtitle2">
                      {bank.name}
                    </Typography>
                    {bank.website && (
                      <Typography variant="caption" color="textSecondary">
                        {bank.website}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>{bank.code}</TableCell>
                <TableCell>
                  <Chip label={bank.type} size="small" />
                </TableCell>
                <TableCell>{bank.country}</TableCell>
                <TableCell>
                  {bank.contactInfo?.phone && (
                    <Typography variant="caption" display="block">
                      📞 {bank.contactInfo.phone}
                    </Typography>
                  )}
                  {bank.contactInfo?.email && (
                    <Typography variant="caption" display="block">
                      📧 {bank.contactInfo.email}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    label={bank.isActive ? 'Active' : 'Inactive'}
                    color={bank.isActive ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    onClick={() => handleEditBank(bank)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteBank(bank)}
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
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingBank ? 'Edit Bank' : 'Add Bank'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Bank Name"
                  value={formData.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Bank Code"
                  value={formData.code}
                  onChange={(e) => handleFormChange('code', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Bank Type</InputLabel>
                  <Select
                    value={formData.type}
                    onChange={(e) => handleFormChange('type', e.target.value)}
                    label="Bank Type"
                  >
                    <MenuItem value="Commercial">Commercial</MenuItem>
                    <MenuItem value="Islamic">Islamic</MenuItem>
                    <MenuItem value="Investment">Investment</MenuItem>
                    <MenuItem value="Central">Central</MenuItem>
                    <MenuItem value="Development">Development</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Country"
                  value={formData.country}
                  onChange={(e) => handleFormChange('country', e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Website"
                  value={formData.website}
                  onChange={(e) => handleFormChange('website', e.target.value)}
                />
              </Grid>
              
              {/* Contact Information */}
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>Contact Information</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Phone"
                  value={formData.contactInfo.phone}
                  onChange={(e) => handleContactChange('phone', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={formData.contactInfo.email}
                  onChange={(e) => handleContactChange('email', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Address"
                  value={formData.contactInfo.address}
                  onChange={(e) => handleContactChange('address', e.target.value)}
                />
              </Grid>
              
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Notes"
                  value={formData.notes}
                  onChange={(e) => handleFormChange('notes', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveBank} variant="contained">
            {editingBank ? 'Update' : 'Create'}
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

export default BankManagement; 