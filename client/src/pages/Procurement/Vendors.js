import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Card,
  CardContent,
  Grid,
  Chip,
  Alert,
  Avatar,
  alpha,
  useTheme,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Tooltip,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import {
  Store as StoreIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  CheckCircle as ActiveIcon,
  Cancel as InactiveIcon,
  ExpandMore as ExpandMoreIcon,
  Category as CategoryIcon,
  TableRows as TableRowsIcon
} from '@mui/icons-material';
import api from '../../services/api';

/** Ellipsis in table cells; full value on hover via `title` */
const ellipsisCell = (maxWidth) => ({
  maxWidth,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle'
});

/** Max widths (px) — generous so names/emails stay readable but layout stays even */
const VENDOR_TABLE = {
  name: 260,
  contact: 200,
  email: 300,
  category: 200
};

const Vendors = () => {
  const theme = useTheme();
  
  // State management
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [vendors, setVendors] = useState([]);
  const [statistics, setStatistics] = useState(null);
  
  // Pagination and filters
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(250);
  const [totalItems, setTotalItems] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [viewLayout, setViewLayout] = useState('categories'); // 'categories' | 'table'
  
  // Dialog states
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', data: null });
  const [viewDialog, setViewDialog] = useState({ open: false, data: null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: null });
  
  // Form data
  const [formData, setFormData] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    paymentTerms: 'Cash',
    status: 'Active',
    notes: '',
    vendorCategory: '',
    ntnCnic: '',
    payeeName: ''
  });

  const loadCategoryOptions = useCallback(async () => {
    try {
      const res = await api.get('/procurement/vendors/categories');
      if (res.data.success) {
        setCategoryOptions(res.data.data.categories || []);
      }
    } catch (err) {
      console.error('Error loading vendor categories:', err);
    }
  }, []);

  const loadVendors = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        search: searchDebounced,
        status: statusFilter,
        ...(categoryFilter ? { category: categoryFilter } : {})
      };

      const response = await api.get('/procurement/vendors', { params });
      
      if (response.data.success) {
        setVendors(response.data.data.vendors);
        setTotalItems(response.data.data.pagination.totalItems);
      }
    } catch (err) {
      setError('Failed to load vendors');
      console.error('Error loading vendors:', err);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, searchDebounced, statusFilter, categoryFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchInput.trim()), 450);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const loadStatistics = useCallback(async () => {
    try {
      const response = await api.get('/procurement/vendors/statistics');
      if (response.data.success) {
        setStatistics(response.data.data);
      }
    } catch (err) {
      console.error('Error loading statistics:', err);
    }
  }, []);

  useEffect(() => {
    loadVendors();
    loadStatistics();
    loadCategoryOptions();
  }, [loadVendors, loadStatistics, loadCategoryOptions]);

  const vendorsByCategory = useMemo(() => {
    const map = new Map();
    for (const v of vendors) {
      const key = (v.vendorCategory || '').trim() || 'Uncategorized';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(v);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [vendors]);

  const handleCreate = () => {
    setFormData({
      name: '',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      paymentTerms: 'Cash',
      status: 'Active',
      notes: '',
      vendorCategory: '',
      ntnCnic: '',
      payeeName: ''
    });
    setFormDialog({ open: true, mode: 'create', data: null });
  };

  const handleEdit = (vendor) => {
    setFormData({
      name: vendor.name,
      contactPerson: vendor.contactPerson,
      phone: vendor.phone,
      email: vendor.email,
      address: vendor.address,
      paymentTerms: vendor.paymentTerms,
      status: vendor.status,
      notes: vendor.notes || '',
      vendorCategory: vendor.vendorCategory || '',
      ntnCnic: vendor.ntnCnic || '',
      payeeName: vendor.payeeName || ''
    });
    setFormDialog({ open: true, mode: 'edit', data: vendor });
  };

  const handleView = (vendor) => {
    setViewDialog({ open: true, data: vendor });
  };

  const handleDelete = (id) => {
    setDeleteDialog({ open: true, id });
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/procurement/vendors/${deleteDialog.id}`);
      setSuccess('Vendor deleted successfully');
      setDeleteDialog({ open: false, id: null });
      loadVendors();
      loadStatistics();
      loadCategoryOptions();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete vendor');
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError('');
      
      if (formDialog.mode === 'create') {
        await api.post('/procurement/vendors', formData);
        setSuccess(isSubcontractorView ? 'Subcontractor created successfully' : 'Vendor created successfully');
      } else {
        await api.put(`/procurement/vendors/${formDialog.data._id}`, formData);
        setSuccess(isSubcontractorView ? 'Subcontractor updated successfully' : 'Vendor updated successfully');
      }
      
      setFormDialog({ open: false, mode: 'create', data: null });
      loadVendors();
      loadStatistics();
      loadCategoryOptions();
    } catch (err) {
      console.error('Error saving vendor:', err);
      const backendMsg = err.response?.data?.message
        || (err.response?.data?.errors && Array.isArray(err.response?.data?.errors) ? err.response.data.errors.map(e => e.msg).join(', ') : null)
        || 'Failed to save vendor';
      setError(backendMsg);
    } finally {
      setLoading(false);
    }
  };

  // Statistics cards
  const stats = [
    {
      title: 'Total Vendors',
      value: statistics?.totalVendors || 0,
      icon: <StoreIcon />,
      color: theme.palette.primary.main,
      bgColor: alpha(theme.palette.primary.main, 0.1)
    },
    {
      title: 'Active',
      value: statistics?.activeVendors || 0,
      icon: <ActiveIcon />,
      color: theme.palette.success.main,
      bgColor: alpha(theme.palette.success.main, 0.1)
    },
    {
      title: 'Inactive',
      value: statistics?.inactiveVendors || 0,
      icon: <InactiveIcon />,
      color: theme.palette.error.main,
      bgColor: alpha(theme.palette.error.main, 0.1)
    },
    {
      title: 'AVL categories',
      value: statistics?.categoryBreakdown?.length ?? 0,
      icon: <CategoryIcon />,
      color: theme.palette.info.main,
      bgColor: alpha(theme.palette.info.main, 0.1)
    }
  ];

  const isSubcontractorView = window.location.pathname.includes('subcontractors');

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 56, height: 56 }}>
              <StoreIcon fontSize="large" />
            </Avatar>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>
                {isSubcontractorView ? 'Subcontractors Registry' : 'Vendors & Subcontractors'}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {isSubcontractorView
                  ? 'Approved Subcontractors and Construction Contractors Registry linked with Project BOQs'
                  : 'Approved vendor & subcontractor list (AVL) grouped by procurement category'}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => {
                loadVendors();
                loadStatistics();
                loadCategoryOptions();
              }}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleCreate}
            >
              {isSubcontractorView ? 'Add Subcontractor' : 'Add Vendor'}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {stats.map((stat, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: stat.bgColor, color: stat.color, width: 48, height: 48 }}>
                    {stat.icon}
                  </Avatar>
                  <Box>
                    <Typography variant="body2" color="textSecondary">
                      {stat.title}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                      {stat.value}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Filters and Search */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search name, email, phone, category, address…"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(0);
              }}
              helperText="Searches your full vendor list; results paginate below."
              FormHelperTextProps={{ sx: { mt: 0.5 } }}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
              }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="Active">Active</MenuItem>
              <MenuItem value="Inactive">Inactive</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              select
              size="small"
              label="Category"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="">All categories</MenuItem>
              {categoryOptions.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3} sx={{ display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={viewLayout}
              onChange={(e, v) => {
                if (!v) return;
                setViewLayout(v);
                setPage(0);
              }}
            >
              <ToggleButton value="categories">
                <CategoryIcon sx={{ mr: 0.5 }} fontSize="small" />
                By category
              </ToggleButton>
              <ToggleButton value="table">
                <TableRowsIcon sx={{ mr: 0.5 }} fontSize="small" />
                Table
              </ToggleButton>
            </ToggleButtonGroup>
          </Grid>
        </Grid>
      </Paper>

      {/* Vendors: grouped by AVL category or flat table — both use server-side pagination */}
      <Paper sx={{ p: viewLayout === 'categories' ? 1 : 0 }}>
        {loading ? (
          <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        ) : vendors.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="body2" color="textSecondary">
              No vendors found
            </Typography>
          </Box>
        ) : (
          <>
            {viewLayout === 'categories' ? (
              <Box sx={{ px: 1, pb: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pb: 1 }}>
                  Up to {rowsPerPage} vendors per page (sorted by name). Sections show only vendors on this page.
                </Typography>
                {vendorsByCategory.map(([category, list]) => (
                  <Accordion key={category} defaultExpanded disableGutters>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography sx={{ fontWeight: 600 }}>{category}</Typography>
                      <Chip label={list.length} size="small" sx={{ ml: 2 }} />
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0 }}>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell><strong>ID</strong></TableCell>
                              <TableCell><strong>Name</strong></TableCell>
                              <TableCell><strong>Contact</strong></TableCell>
                              <TableCell><strong>Phone</strong></TableCell>
                              <TableCell><strong>Email</strong></TableCell>
                              <TableCell><strong>NTN / CNIC</strong></TableCell>
                              <TableCell><strong>Payee</strong></TableCell>
                              <TableCell><strong>Status</strong></TableCell>
                              <TableCell align="center"><strong>Actions</strong></TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {list.map((vendor) => (
                              <TableRow key={vendor._id} hover>
                                <TableCell>{vendor.supplierId}</TableCell>
                                <TableCell sx={ellipsisCell(VENDOR_TABLE.name)} title={vendor.name}>
                                  {vendor.name}
                                </TableCell>
                                <TableCell sx={ellipsisCell(VENDOR_TABLE.contact)} title={vendor.contactPerson}>
                                  {vendor.contactPerson}
                                </TableCell>
                                <TableCell>{vendor.phone}</TableCell>
                                <TableCell sx={ellipsisCell(VENDOR_TABLE.email)} title={vendor.email}>
                                  {vendor.email}
                                </TableCell>
                                <TableCell sx={ellipsisCell(140)} title={vendor.ntnCnic || ''}>
                                  {vendor.ntnCnic || '—'}
                                </TableCell>
                                <TableCell sx={ellipsisCell(200)} title={vendor.payeeName || ''}>
                                  {vendor.payeeName || '—'}
                                </TableCell>
                                <TableCell>
                                  <Chip
                                    label={vendor.status}
                                    color={vendor.status === 'Active' ? 'success' : 'error'}
                                    size="small"
                                  />
                                </TableCell>
                                <TableCell align="center">
                                  <Tooltip title="View">
                                    <IconButton size="small" onClick={() => handleView(vendor)}>
                                      <ViewIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="Edit">
                                    <IconButton size="small" onClick={() => handleEdit(vendor)}>
                                      <EditIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="Delete">
                                    <IconButton size="small" color="error" onClick={() => handleDelete(vendor._id)}>
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Box>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>ID</strong></TableCell>
                      <TableCell><strong>Category</strong></TableCell>
                      <TableCell><strong>Name</strong></TableCell>
                      <TableCell><strong>Contact Person</strong></TableCell>
                      <TableCell><strong>Phone</strong></TableCell>
                      <TableCell><strong>Email</strong></TableCell>
                      <TableCell><strong>Payment Terms</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell align="center"><strong>Actions</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {vendors.map((vendor) => (
                      <TableRow key={vendor._id} hover>
                        <TableCell>{vendor.supplierId}</TableCell>
                        <TableCell sx={ellipsisCell(VENDOR_TABLE.category)} title={vendor.vendorCategory || ''}>
                          {vendor.vendorCategory || '—'}
                        </TableCell>
                        <TableCell sx={ellipsisCell(VENDOR_TABLE.name)} title={vendor.name}>
                          {vendor.name}
                        </TableCell>
                        <TableCell sx={ellipsisCell(VENDOR_TABLE.contact)} title={vendor.contactPerson}>
                          {vendor.contactPerson}
                        </TableCell>
                        <TableCell>{vendor.phone}</TableCell>
                        <TableCell sx={ellipsisCell(VENDOR_TABLE.email)} title={vendor.email}>
                          {vendor.email}
                        </TableCell>
                        <TableCell>{vendor.paymentTerms}</TableCell>
                        <TableCell>
                          <Chip
                            label={vendor.status}
                            color={vendor.status === 'Active' ? 'success' : 'error'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title="View">
                            <IconButton size="small" onClick={() => handleView(vendor)}>
                              <ViewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => handleEdit(vendor)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton size="small" color="error" onClick={() => handleDelete(vendor._id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <TablePagination
              component="div"
              count={totalItems}
              page={page}
              onPageChange={(e, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100, 250, 500]}
            />
          </>
        )}
      </Paper>

      {/* Create/Edit Dialog */}
      <Dialog 
        open={formDialog.open} 
        onClose={() => setFormDialog({ open: false, mode: 'create', data: null })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {formDialog.mode === 'create' ? 'Add New Vendor' : 'Edit Vendor'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Vendor Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="AVL category"
                placeholder="e.g. Cement Vendors"
                value={formData.vendorCategory}
                onChange={(e) => setFormData({ ...formData, vendorCategory: e.target.value })}
                helperText="Section from the approved vendor list (optional)"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Contact Person"
                value={formData.contactPerson}
                onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="email"
                label="Email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="NTN / CNIC"
                value={formData.ntnCnic}
                onChange={(e) => setFormData({ ...formData, ntnCnic: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Payee name"
                value={formData.payeeName}
                onChange={(e) => setFormData({ ...formData, payeeName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Payment Terms"
                value={formData.paymentTerms}
                onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
              >
                <MenuItem value="Cash">Cash</MenuItem>
                <MenuItem value="Credit 7 days">Credit 7 days</MenuItem>
                <MenuItem value="Credit 15 days">Credit 15 days</MenuItem>
                <MenuItem value="Credit 30 days">Credit 30 days</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <MenuItem value="Active">Active</MenuItem>
                <MenuItem value="Inactive">Inactive</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormDialog({ open: false, mode: 'create', data: null })}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSubmit}
            disabled={!formData.name}
          >
            {formDialog.mode === 'create' ? 'Create' : 'Update'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog */}
      <Dialog 
        open={viewDialog.open} 
        onClose={() => setViewDialog({ open: false, data: null })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Vendor Details</DialogTitle>
        <DialogContent>
          {viewDialog.data && (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">Vendor ID</Typography>
                <Typography variant="body1" fontWeight="bold">{viewDialog.data.supplierId}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">Name</Typography>
                <Typography variant="body1" fontWeight="bold">{viewDialog.data.name}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">AVL category</Typography>
                <Typography variant="body1">{viewDialog.data.vendorCategory || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">NTN / CNIC</Typography>
                <Typography variant="body1">{viewDialog.data.ntnCnic || '—'}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Payee name</Typography>
                <Typography variant="body1">{viewDialog.data.payeeName || '—'}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">Contact Person</Typography>
                <Typography variant="body1">{viewDialog.data.contactPerson}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Phone</Typography>
                <Typography variant="body1">{viewDialog.data.phone}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Email</Typography>
                <Typography variant="body1">{viewDialog.data.email}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">Address</Typography>
                <Typography variant="body1">{viewDialog.data.address}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Payment Terms</Typography>
                <Typography variant="body1">{viewDialog.data.paymentTerms}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Status</Typography>
                <Chip label={viewDialog.data.status} color={viewDialog.data.status === 'Active' ? 'success' : 'error'} />
              </Grid>
              {viewDialog.data.notes && (
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Notes</Typography>
                  <Typography variant="body1">{viewDialog.data.notes}</Typography>
                </Grid>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialog({ open: false, data: null })}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog 
        open={deleteDialog.open} 
        onClose={() => setDeleteDialog({ open: false, id: null })}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this vendor? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, id: null })}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Vendors;
