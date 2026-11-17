import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  Chip,
  MenuItem,
  Tooltip
} from '@mui/material';
import { 
  Add as AddIcon, 
  Edit as EditIcon, 
  Delete as DeleteIcon, 
  Save as SaveIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import api from '../../../services/api';
import toast from 'react-hot-toast';
import useClientPagination from '../../../hooks/useClientPagination';

const KPITemplates = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    items: [{ title: '', description: '', weight: 0, measurementType: 'rating_1_to_5' }]
  });

  const fetchTemplates = async () => {
    try {
      const response = await api.get('/kpi/templates');
      setTemplates(response.data.data);
    } catch (error) {
      toast.error('Failed to fetch templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { title: '', description: '', weight: 0, measurementType: 'rating_1_to_5' }]
    });
  };

  const handleRemoveItem = (index) => {
    const newItems = [...formData.items];
    newItems.splice(index, 1);
    setFormData({ ...formData, items: newItems });
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index][field] = field === 'weight' ? Number(value) : value;
    setFormData({ ...formData, items: newItems });
  };

  const handleEdit = (template) => {
    setIsEditing(true);
    setIsViewing(false);
    setCurrentId(template._id);
    setFormData({
      title: template.title,
      description: template.description || '',
      items: template.items.map(i => ({ ...i }))
    });
    setOpenDialog(true);
  };

  const handleView = (template) => {
    setIsViewing(true);
    setIsEditing(false);
    setFormData({
      title: template.title,
      description: template.description || '',
      items: template.items.map(i => ({ ...i }))
    });
    setOpenDialog(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this template?')) return;
    try {
      await api.delete(`/kpi/templates/${id}`);
      toast.success('Template deleted successfully');
      fetchTemplates();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Error deleting template');
    }
  };

  const handleSubmit = async () => {
    try {
      const totalWeight = formData.items.reduce((sum, item) => sum + item.weight, 0);
      if (totalWeight !== 100) {
        toast.error(`Total weight must be exactly 100%. Current is ${totalWeight}%`);
        return;
      }

      if (isEditing) {
        await api.put(`/kpi/templates/${currentId}`, formData);
        toast.success('Template updated successfully');
      } else {
        await api.post('/kpi/templates', formData);
        toast.success('Template created successfully');
      }
      
      setOpenDialog(false);
      fetchTemplates();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Error saving template');
    }
  };

  const pg = useClientPagination(templates);
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight="bold">KPI Templates</Typography>
        <Button 
          variant="contained" 
          startIcon={<AddIcon />} 
          onClick={() => {
            setIsEditing(false);
            setIsViewing(false);
            setFormData({ title: '', description: '', items: [{ title: '', description: '', weight: 0, measurementType: 'rating_1_to_5' }] });
            setOpenDialog(true);
          }}
        >
          Create Template
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Total Items</TableCell>
              <TableCell>Total Weight</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pg.rows.map((template) => (
              <TableRow key={template._id}>
                <TableCell>
                  <Typography variant="subtitle2">{template.title}</Typography>
                  <Typography variant="caption" color="textSecondary">{template.description}</Typography>
                </TableCell>
                <TableCell>{template.items.length} items</TableCell>
                <TableCell>{template.totalWeight}%</TableCell>
                <TableCell>
                  <Chip size="small" label={template.isActive ? "Active" : "Inactive"} color={template.isActive ? "success" : "default"} />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="View">
                    <IconButton color="info" onClick={() => handleView(template)}><ViewIcon /></IconButton>
                  </Tooltip>
                  <Tooltip title="Edit">
                    <IconButton color="primary" onClick={() => handleEdit(template)}><EditIcon /></IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton color="error" onClick={() => handleDelete(template._id)}><DeleteIcon /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 3 }}>
                  No templates found. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>{pg.bar}
      </TableContainer>

      {/* CREATE/EDIT/VIEW TEMPLATE DIALOG */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {isViewing ? 'View KPI Template' : isEditing ? 'Edit KPI Template' : 'Create New KPI Template'}
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <TextField 
                fullWidth 
                label="Template Title" 
                required 
                disabled={isViewing}
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField 
                fullWidth 
                label="Description" 
                multiline 
                rows={2}
                disabled={isViewing}
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
              />
            </Grid>
            
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">KPI Items (Metrics)</Typography>
                <Typography variant="subtitle2" color={formData.items.reduce((sum, item) => sum + item.weight, 0) === 100 ? 'success.main' : 'error.main'}>
                  Total Weight: {formData.items.reduce((sum, item) => sum + item.weight, 0)}% (Must be 100%)
                </Typography>
              </Box>

              {formData.items.map((item, index) => (
                <Card key={index} sx={{ mb: 2, bgcolor: 'background.default' }} variant="outlined">
                  <CardContent>
                    <Grid container spacing={2} alignItems="center">
                      <Grid item xs={12} md={4}>
                        <TextField 
                          fullWidth 
                          label="Metric Title" 
                          size="small" 
                          required
                          disabled={isViewing}
                          value={item.title}
                          onChange={(e) => handleItemChange(index, 'title', e.target.value)}
                        />
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <TextField 
                          fullWidth 
                          label="Measurement Type" 
                          size="small" 
                          select
                          disabled={isViewing}
                          value={item.measurementType}
                          onChange={(e) => handleItemChange(index, 'measurementType', e.target.value)}
                        >
                          <MenuItem value="rating_1_to_5">1-5 Rating Scale</MenuItem>
                          <MenuItem value="percentage">Percentage (0-100)</MenuItem>
                        </TextField>
                      </Grid>
                      <Grid item xs={10} md={3}>
                        <TextField 
                          fullWidth 
                          label="Weight (%)" 
                          type="number" 
                          size="small" 
                          required
                          disabled={isViewing}
                          value={item.weight}
                          onChange={(e) => handleItemChange(index, 'weight', e.target.value)}
                        />
                      </Grid>
                      {!isViewing && (
                        <Grid item xs={2} md={2} sx={{ textAlign: 'right' }}>
                          <IconButton color="error" onClick={() => handleRemoveItem(index)}>
                            <DeleteIcon />
                          </IconButton>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              ))}
              
              {!isViewing && (
                <Button startIcon={<AddIcon />} variant="outlined" onClick={handleAddItem}>
                  Add Metric
                </Button>
              )}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>
            {isViewing ? 'Close' : 'Cancel'}
          </Button>
          {!isViewing && (
            <Button variant="contained" onClick={handleSubmit} startIcon={<SaveIcon />}>
              {isEditing ? 'Update Template' : 'Save Template'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default KPITemplates;
