import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Grid,
  Alert,
  Avatar,
  FormControl,
  InputLabel,
  OutlinedInput,
  InputAdornment,
  CardMedia,
  Stack,
  Divider,
  Skeleton,
  CircularProgress,
  Tooltip
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  CloudUpload as UploadIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  PhotoCamera as PhotoCameraIcon,
  PictureAsPdf as PdfIcon
} from '@mui/icons-material';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import { getImageUrl } from '../../../utils/imageService';
import useClientPagination from '../../../hooks/useClientPagination';

const RentalAgreementList = () => {
  const navigate = useNavigate();
  const [agreements, setAgreements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgreement, setEditingAgreement] = useState(null);
  const [formData, setFormData] = useState({
    agreementNumber: '',
    propertyName: '',
    status: 'Active'
  });
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchAgreements();
  }, []);

  const fetchAgreements = async () => {
    try {
      const response = await api.get('/rental-agreements');
      setAgreements(response.data);
    } catch (error) {
      console.error('Error fetching agreements:', error);
      setError('Failed to fetch rental agreements');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (agreement = null) => {
    if (agreement) {
      setEditingAgreement(agreement);
      setFormData({
        agreementNumber: agreement.agreementNumber,
        propertyName: agreement.propertyName,
        status: agreement.status
      });
      setImagePreview(agreement.agreementImage || null);
    } else {
      setEditingAgreement(null);
      setFormData({
        agreementNumber: '',
        propertyName: '',
        status: 'Active'
      });
      setImagePreview(null);
    }
    setSelectedImage(null);
    setDialogOpen(true);
    setError('');
    setSuccess('');
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingAgreement(null);
    setFormData({});
    setSelectedImage(null);
    setImagePreview(null);
    setError('');
    setSuccess('');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type (images or PDFs)
      const isValidType = file.type.startsWith('image/') || file.type === 'application/pdf';
      if (!isValidType) {
        setError('Please select an image or PDF file');
        return;
      }
      
      // Validate file size (10MB for PDFs, 5MB for images)
      const maxSize = file.type === 'application/pdf' ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > maxSize) {
        setError(file.type === 'application/pdf' 
          ? 'PDF size should be less than 10MB' 
          : 'Image size should be less than 5MB');
        return;
      }
      
      setSelectedImage(file);
      
      // For images, show preview; for PDFs, show file info
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setImagePreview(e.target.result);
        };
        reader.readAsDataURL(file);
      } else {
        // For PDFs, set a placeholder or file info
        setImagePreview(null);
      }
      setError(''); // Clear any previous errors
    }
  };

  const handleRemoveImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      // Validate file type
      const isValidType = file.type.startsWith('image/') || file.type === 'application/pdf';
      if (!isValidType) {
        setError('Please drop an image or PDF file');
        return;
      }
      
      const event = {
        target: {
          files: [file]
        }
      };
      handleImageChange(event);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Prevent multiple submissions
    if (submitting) {
      return;
    }
    
    // Clear previous errors
    setError('');
    setSuccess('');
    setSubmitting(true);
    
    try {
      // Validate required fields
      const requiredFields = ['agreementNumber', 'propertyName'];
      const missingFields = requiredFields.filter(field => {
        const value = formData[field];
        return !value || value.toString().trim() === '' || value === '';
      });
      
      if (missingFields.length > 0) {
        setError(`Please fill in all required fields: ${missingFields.join(', ')}`);
        console.log('❌ Validation failed - missing fields:', missingFields);
        return;
      }

      console.log('✅ All validations passed');

      console.log('📊 Form Data to Submit:', formData);
      console.log('📊 Required Fields Check:');
      requiredFields.forEach(field => {
        const value = formData[field];
        console.log(`  ${field}: "${value}" (type: ${typeof value}, empty: ${!value || value.toString().trim() === '' || value === ''})`);
      });
      
      // Double-check validation before API call
      const finalValidation = requiredFields.every(field => {
        const value = formData[field];
        return value && value.toString().trim() !== '' && value !== '';
      });
      
      if (!finalValidation) {
        setError('Validation failed. Please fill in all required fields.');
        console.log('❌ Final validation failed - aborting API call');
        return;
      }
      
      console.log('✅ Final validation passed - proceeding with API call');
      
      const formDataToSend = new FormData();
      
      // Append form data - convert empty strings to undefined for required fields
      Object.keys(formData).forEach(key => {
        const value = formData[key];
        // For required fields, don't send empty strings
        if (requiredFields.includes(key) && (!value || value.toString().trim() === '')) {
          console.log(`⚠️ Skipping empty required field: ${key}`);
          return;
        }
        formDataToSend.append(key, value);
      });

      // Append image if selected
      if (selectedImage) {
        formDataToSend.append('agreementImage', selectedImage);
      }

      console.log('📤 Sending FormData to API...');

      if (editingAgreement) {
        await api.put(`/rental-agreements/${editingAgreement._id}`, formDataToSend, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });
        setSuccess('Rental agreement updated successfully');
      } else {
        await api.post('/rental-agreements', formDataToSend, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });
        setSuccess('Rental agreement created successfully');
      }
      fetchAgreements();
      setTimeout(() => {
        handleCloseDialog();
      }, 1500);
    } catch (error) {
      console.error('Error saving agreement:', error);
      
      // Show more specific error messages
      if (error.response?.data?.message) {
        setError(`Failed to save rental agreement: ${error.response.data.message}`);
      } else if (error.response?.status === 400) {
        setError('Invalid data provided. Please check all fields and try again.');
      } else if (error.response?.status === 401) {
        setError('You are not authorized to perform this action.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to create rental agreements.');
      } else {
        setError('Failed to save rental agreement. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this rental agreement?')) {
      setDeleting(true);
      setError('');
      try {
        await api.delete(`/rental-agreements/${id}`);
        setSuccess('Rental agreement deleted successfully');
        await fetchAgreements(); // Wait for agreements to reload
      } catch (error) {
        console.error('Error deleting agreement:', error);
        setError('Failed to delete rental agreement');
      } finally {
        setDeleting(false);
      }
    }
  };

  const handleViewDetail = (id) => {
    navigate(`/admin/rental-agreements/${id}`);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Active': return 'success';
      case 'Expired': return 'error';
      case 'Terminated': return 'warning';
      default: return 'default';
    }
  };

  const formatPKR = (amount) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0
    }).format(amount);
  };


  const pg = useClientPagination(agreements);
  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Skeleton variant="text" width="30%" height={40} />
          <Skeleton variant="rectangular" width={160} height={36} sx={{ borderRadius: 1 }} />
        </Box>

        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    {[1, 2, 3, 4, 5, 6, 7].map((item) => (
                      <TableCell key={item}><Skeleton variant="text" height={20} /></TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[1, 2, 3, 4, 5].map((item) => (
                    <TableRow key={item}>
                      <TableCell><Skeleton variant="text" height={20} width="60%" /></TableCell>
                      <TableCell><Skeleton variant="text" height={20} width="70%" /></TableCell>
                      <TableCell><Skeleton variant="text" height={20} width="50%" /></TableCell>
                      <TableCell><Skeleton variant="text" height={20} width="60%" /></TableCell>
                      <TableCell><Skeleton variant="text" height={20} width="40%" /></TableCell>
                      <TableCell><Skeleton variant="text" height={20} width="35%" /></TableCell>
                      <TableCell><Skeleton variant="rectangular" height={20} width={60} /></TableCell>
                      <TableCell align="center">
                        <Box display="flex" justifyContent="center" gap={1}>
                          <Skeleton variant="circular" width={32} height={32} />
                          <Skeleton variant="circular" width={32} height={32} />
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Rental Agreements
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Add New Agreement
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Card>
        <CardContent>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Agreement #</TableCell>
                  <TableCell>Property Name</TableCell>
                  <TableCell>Image</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((agreement) => (
                  <TableRow key={agreement._id}>
                    <TableCell>{agreement.agreementNumber}</TableCell>
                    <TableCell>{agreement.propertyName}</TableCell>
                    <TableCell>
                      {agreement.agreementImage ? (
                        agreement.agreementImage.toLowerCase().endsWith('.pdf') ? (
                          <Tooltip title="Click to view PDF">
                            <Avatar 
                              sx={{ width: 40, height: 40, bgcolor: 'error.main', cursor: 'pointer' }} 
                              variant="rounded"
                              onClick={() => window.open(getImageUrl(agreement.agreementImage), '_blank')}
                            >
                              <PdfIcon />
                            </Avatar>
                          </Tooltip>
                        ) : (
                          <Avatar
                            src={getImageUrl(agreement.agreementImage)}
                            sx={{ width: 40, height: 40 }}
                            variant="rounded"
                          />
                        )
                      ) : (
                        <Avatar sx={{ width: 40, height: 40 }}>
                          <ImageIcon />
                        </Avatar>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={agreement.status}
                        color={getStatusColor(agreement.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => handleViewDetail(agreement._id)}
                        color="info"
                        title="View Details"
                      >
                        <ViewIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleOpenDialog(agreement)}
                        color="primary"
                        title="Edit"
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(agreement._id)}
                        color="error"
                        title="Delete"
                        disabled={deleting}
                      >
                        {deleting ? <CircularProgress size={16} /> : <DeleteIcon />}
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingAgreement ? 'Edit Rental Agreement' : 'Add New Rental Agreement'}
        </DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Agreement Number"
                  name="agreementNumber"
                  value={formData.agreementNumber}
                  onChange={handleInputChange}
                  required
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Property Name"
                  name="propertyName"
                  value={formData.propertyName}
                  onChange={handleInputChange}
                  required
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Status"
                  name="status"
                  select
                  value={formData.status}
                  onChange={handleInputChange}
                  required
                >
                  <MenuItem value="Active">Active</MenuItem>
                  <MenuItem value="Expired">Expired</MenuItem>
                  <MenuItem value="Terminated">Terminated</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>
                  Agreement File (Image or PDF)
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                {!imagePreview && !selectedImage ? (
                  <Card
                    sx={{
                      border: '2px dashed #ccc',
                      borderRadius: 2,
                      p: 3,
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        borderColor: 'primary.main',
                        backgroundColor: 'action.hover'
                      }
                    }}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => document.getElementById('file-upload').click()}
                  >
                    <input
                      id="file-upload"
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleImageChange}
                      style={{ display: 'none' }}
                    />
                    <Stack spacing={2} alignItems="center">
                      <PhotoCameraIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
                      <Typography variant="h6" color="text.secondary">
                        Upload Agreement File
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Drag and drop a file here, or click to select
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Supported formats: JPG, PNG, GIF (Max 5MB) or PDF (Max 10MB)
                      </Typography>
                      <Typography variant="caption" color="primary.main" fontWeight="bold">
                        PDF files will be automatically compressed
                      </Typography>
                    </Stack>
                  </Card>
                ) : (
                  <Card sx={{ maxWidth: 400, mx: 'auto' }}>
                    <Box position="relative">
                      {selectedImage?.type === 'application/pdf' ? (
                        <Box
                          sx={{
                            height: 300,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: '#f5f5f5',
                            borderRadius: 1,
                            border: '1px solid #ddd'
                          }}
                        >
                          <PdfIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
                          <Typography variant="h6" color="text.secondary">
                            PDF File
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {selectedImage?.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                            {(selectedImage?.size / 1024 / 1024).toFixed(2)} MB
                          </Typography>
                        </Box>
                      ) : (
                        <CardMedia
                          component="img"
                          height="300"
                          image={imagePreview}
                          alt="Agreement preview"
                          sx={{ borderRadius: 1 }}
                        />
                      )}
                      <IconButton
                        onClick={handleRemoveImage}
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          backgroundColor: 'rgba(0,0,0,0.5)',
                          color: 'white',
                          '&:hover': {
                            backgroundColor: 'rgba(0,0,0,0.7)'
                          }
                        }}
                        size="small"
                      >
                        <CloseIcon />
                      </IconButton>
                    </Box>
                    <CardContent>
                      <Stack direction="row" spacing={2} alignItems="center">
                        <Button
                          variant="outlined"
                          startIcon={<UploadIcon />}
                          onClick={() => document.getElementById('file-upload').click()}
                          size="small"
                        >
                          Change File
                        </Button>
                        <Typography variant="caption" color="text.secondary">
                          {selectedImage?.name}
                        </Typography>
                      </Stack>
                      <input
                        id="file-upload"
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={handleImageChange}
                        style={{ display: 'none' }}
                      />
                    </CardContent>
                  </Card>
                )}
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="contained" 
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} /> : null}
            >
              {submitting ? (editingAgreement ? 'Updating...' : 'Creating...') : (editingAgreement ? 'Update' : 'Create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default RentalAgreementList;
