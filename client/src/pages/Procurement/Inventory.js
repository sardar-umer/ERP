import React, { useState, useEffect, useCallback } from 'react';
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
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  FormControlLabel,
  Checkbox,
  Divider
} from '@mui/material';
import {
  Inventory as InventoryIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  TrendingUp as AddStockIcon,
  TrendingDown as RemoveStockIcon,
  FileDownload as FileDownloadIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';

const Inventory = () => {
  const theme = useTheme();
  
  // State management
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [items, setItems] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [coaAccounts, setCoaAccounts] = useState([]);
  const [coaLoading, setCoaLoading] = useState(false);
  const [invCategories, setInvCategories] = useState([]);
  const [formTab, setFormTab] = useState(0);
  
  // Pagination and filters
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [exporting, setExporting] = useState(false);
  
  // Dialog states
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', data: null });
  const [viewDialog, setViewDialog] = useState({ open: false, data: null, tab: 0 });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, item: null, force: false, error: '' });
  const [stockDialog, setStockDialog] = useState({ open: false, type: '', item: null });
  
  // Form data
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'Other',
    unit: 'pcs',
    quantity: 0,
    minQuantity: 10,
    maxQuantity: 1000,
    unitPrice: 0,
    supplier: '',
    inventoryCategory: '',
    location: { rack: '', shelf: '', bin: '' },
    notes: '',
    inventoryAccount: '',
    grniAccount: '',
    cogsAccount: '',
    salesAccount: '',
    purchaseAccount: ''
  });
  const [financeItemType, setFinanceItemType] = useState('inventory');

  // Stock form data
  const [stockFormData, setStockFormData] = useState({
    quantity: 0,
    reference: '',
    notes: ''
  });

  const normalizeCategoryList = (res) => {
    const payload = res?.data;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload)) return payload;
    return [];
  };

  /** Load chart of accounts + inventory categories independently (procurement may lack finance write APIs; COA GET is allowed for GL pickers). */
  const loadFinanceDropdowns = useCallback(async () => {
    setCoaLoading(true);
    let categories = [];
    try {
      const [coaSettled, catSettled] = await Promise.allSettled([
        api.get('/finance/accounts', { params: { page: 1, limit: 5000 } }),
        api.get('/inventory-categories', {
          params: { isActive: 'true', _t: Date.now() },
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        })
      ]);

      if (coaSettled.status === 'fulfilled') {
        const r = coaSettled.value;
        const list = r.data?.data?.accounts || r.data?.data || [];
        setCoaAccounts(Array.isArray(list) ? list : []);
      }

      if (catSettled.status === 'fulfilled') {
        const raw = normalizeCategoryList(catSettled.value);
        categories = raw.filter((c) => c && c.isActive !== false);
        setInvCategories(categories);
      } else {
        console.warn(
          'Inventory: failed to load finance categories',
          catSettled.reason?.response?.status,
          catSettled.reason?.message
        );
        setInvCategories([]);
      }
    } finally {
      setCoaLoading(false);
    }
    return { categories };
  }, []);

  useEffect(() => {
    loadFinanceDropdowns();
  }, [loadFinanceDropdowns]);

  // Load data on component mount
  useEffect(() => {
    loadInventory();
    loadStatistics();
    loadVendors();
  }, [page, rowsPerPage, search, categoryFilter, statusFilter]);

  const loadInventory = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        search,
        category: categoryFilter,
        status: statusFilter
      };

      const response = await api.get('/procurement/inventory', { params });
      
      if (response.data.success) {
        setItems(response.data.data.items);
        setTotalItems(response.data.data.pagination.totalItems);
      }
    } catch (err) {
      setError('Failed to load inventory');
      console.error('Error loading inventory:', err);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, categoryFilter, statusFilter]);

  const loadStatistics = async () => {
    try {
      const response = await api.get('/procurement/inventory/statistics');
      if (response.data.success) {
        setStatistics(response.data.data);
      }
    } catch (err) {
      console.error('Error loading statistics:', err);
    }
  };

  const loadVendors = async () => {
    try {
      const response = await api.get('/procurement/vendors', { params: { limit: 1000 } });
      if (response.data.success) {
        setVendors(response.data.data.vendors);
      }
    } catch (err) {
      console.error('Error loading vendors:', err);
    }
  };

  /** Fetch every page matching current filters, then download Excel. */
  const handleExportExcel = async () => {
    try {
      setExporting(true);
      setError('');
      const pageSize = 500;
      let currentPage = 1;
      let totalPages = 1;
      const allItems = [];

      while (currentPage <= totalPages) {
        const response = await api.get('/procurement/inventory', {
          params: {
            page: currentPage,
            limit: pageSize,
            search,
            category: categoryFilter,
            status: statusFilter
          }
        });
        if (!response.data?.success) {
          throw new Error(response.data?.message || 'Failed to load inventory for export');
        }
        const batch = response.data.data?.items || [];
        allItems.push(...batch);
        const pagination = response.data.data?.pagination || {};
        totalPages = Math.max(1, Number(pagination.totalPages) || 1);
        const total = Number(pagination.totalItems);
        if (Number.isFinite(total) && allItems.length >= total) break;
        if (batch.length < pageSize) break;
        currentPage += 1;
        if (currentPage > 500) break; // safety
      }

      if (!allItems.length) {
        setError('Nothing to export');
        return;
      }

      const XLSX = await import('xlsx');
      const exportData = allItems.map((item) => ({
        'Item Code': item.itemCode || '',
        Name: item.name || '',
        Category: item.category || '',
        'Finance Category': item.inventoryCategory?.name || '',
        Store: item.storeSnapshot || '',
        'Sub-Store': item.subStoreSnapshot || '',
        Rack: item.location?.rack || '',
        Shelf: item.location?.shelf || '',
        Bin: item.location?.bin || '',
        Qty: item.quantity ?? '',
        Unit: item.unit || '',
        'WAC (Avg Cost)': item.averageCost ?? '',
        'List Price': item.unitPrice ?? '',
        'Stock Value': item.totalValue ?? '',
        Status: item.status || '',
        Description: item.description || ''
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
      XLSX.writeFile(wb, `inventory-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setSuccess(`Exported ${exportData.length} item(s) from all pages`);
    } catch (err) {
      console.error('Inventory export failed:', err);
      setError(err.response?.data?.message || err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleCreate = async () => {
    setFormData({
      name: '',
      description: '',
      category: 'Other',
      unit: 'pcs',
      quantity: 0,
      minQuantity: 10,
      maxQuantity: 1000,
      unitPrice: 0,
      supplier: '',
      inventoryCategory: '',
      location: { rack: '', shelf: '', bin: '' },
      notes: '',
      inventoryAccount: '',
      grniAccount: '',
      cogsAccount: '',
      salesAccount: '',
      purchaseAccount: ''
    });
    setFormTab(0);
    setFinanceItemType('inventory');
    setFormDialog({ open: true, mode: 'create', data: null });
    const { categories } = await loadFinanceDropdowns();
    const general = categories.find((c) => c.name === 'General');
    const pick = general || categories[0];
    if (pick) {
      setFormData((fd) => ({ ...fd, inventoryCategory: String(pick._id) }));
    }
  };

  const handleEdit = async (item) => {
    setFormData({
      name: item.name,
      description: item.description || '',
      category: item.category,
      unit: item.unit,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      maxQuantity: item.maxQuantity,
      unitPrice: item.unitPrice,
      supplier: item.supplier?._id || '',
      inventoryCategory: item.inventoryCategory?._id || item.inventoryCategory || '',
      location: { rack: item.location?.rack || '', shelf: item.location?.shelf || '', bin: item.location?.bin || '' },
      notes: item.notes || '',
      inventoryAccount: item.inventoryAccount?._id || item.inventoryAccount || '',
      grniAccount:      item.grniAccount?._id      || item.grniAccount      || '',
      cogsAccount:      item.cogsAccount?._id      || item.cogsAccount      || '',
      salesAccount:     item.salesAccount?._id     || item.salesAccount     || '',
      purchaseAccount:  item.purchaseAccount?._id  || item.purchaseAccount  || ''
    });
    setFormTab(0);
    setFinanceItemType('inventory');
    setFormDialog({ open: true, mode: 'edit', data: item });
    await loadFinanceDropdowns();
  };

  const handleView = async (item) => {
    setViewDialog({ open: true, data: item, tab: 0 });
    try {
      const res = await api.get(`/procurement/inventory/${item._id}`);
      if (res.data?.success && res.data?.data) {
        setViewDialog({ open: true, data: res.data.data, tab: 0 });
      }
    } catch (_) { /* use list data fallback */ }
  };

  const handleDelete = (item) => {
    setDeleteDialog({ open: true, item, force: false, error: '' });
  };

  const handleStockAction = (type, item) => {
    setStockFormData({ quantity: 0, reference: '', notes: '' });
    setStockDialog({ open: true, type, item });
  };

  const confirmDelete = async () => {
    const id = deleteDialog.item?._id;
    if (!id) return;
    const hasStock = (deleteDialog.item?.quantity || 0) > 0;
    const force = !!deleteDialog.force;
    if (hasStock && !force) {
      setDeleteDialog((prev) => ({ ...prev, error: 'Cannot delete item with existing stock. Adjust stock to zero first, or check "Force delete" below.' }));
      return;
    }
    try {
      const url = force ? `/procurement/inventory/${id}?force=true` : `/procurement/inventory/${id}`;
      await api.delete(url);
      setSuccess('Inventory item deleted successfully');
      setDeleteDialog({ open: false, item: null, force: false, error: '' });
      loadInventory();
      loadStatistics();
    } catch (err) {
      setDeleteDialog((prev) => ({ ...prev, error: err.response?.data?.message || 'Failed to delete item' }));
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      
      if (formDialog.mode === 'create') {
        const { ...payload } = formData;
        await api.post('/procurement/inventory', payload);
        setSuccess('Inventory item created successfully');
      } else {
        const { ...payload } = formData;
        await api.put(`/procurement/inventory/${formDialog.data._id}`, payload);
        setSuccess('Inventory item updated successfully');
      }
      
      setFormDialog({ open: false, mode: 'create', data: null });
      loadInventory();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save item');
    } finally {
      setLoading(false);
    }
  };

  const handleStockSubmit = async () => {
    try {
      setLoading(true);
      const endpoint = `/procurement/inventory/${stockDialog.item._id}/${stockDialog.type}-stock`;
      await api.post(endpoint, stockFormData);
      
      setSuccess(`Stock ${stockDialog.type === 'add' ? 'added' : stockDialog.type === 'remove' ? 'removed' : 'adjusted'} successfully`);
      setStockDialog({ open: false, type: '', item: null });
      loadInventory();
      loadStatistics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update stock');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'In Stock': 'success',
      'Low Stock': 'warning',
      'Out of Stock': 'error',
      'Discontinued': 'default'
    };
    return colors[status] || 'default';
  };

  // Statistics cards
  const stats = [
    {
      title: 'Total Items',
      value: statistics?.totalItems || 0,
      color: theme.palette.primary.main,
      bgColor: alpha(theme.palette.primary.main, 0.1)
    },
    {
      title: 'Total Value',
      value: formatPKR(statistics?.totalValue || 0),
      color: theme.palette.success.main,
      bgColor: alpha(theme.palette.success.main, 0.1)
    },
    {
      title: 'In Stock',
      value: statistics?.inStock || 0,
      color: theme.palette.success.main,
      bgColor: alpha(theme.palette.success.main, 0.1)
    },
    {
      title: 'Low Stock',
      value: statistics?.lowStock || 0,
      color: theme.palette.warning.main,
      bgColor: alpha(theme.palette.warning.main, 0.1)
    }
  ];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 56, height: 56 }}>
              <InventoryIcon fontSize="large" />
            </Avatar>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>
                Inventory
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Track and manage inventory items
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => {
                loadInventory();
                loadStatistics();
              }}
            >
              Refresh
            </Button>
            <Button
              variant="outlined"
              color="success"
              startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <FileDownloadIcon />}
              onClick={handleExportExcel}
              disabled={exporting || loading}
            >
              {exporting ? 'Exporting…' : 'Export Excel'}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleCreate}
            >
              Add Item
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
                    <InventoryIcon />
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
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
              }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              select
              size="small"
              label="Category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <MenuItem value="">All Categories</MenuItem>
              <MenuItem value="Raw Materials">Raw Materials</MenuItem>
              <MenuItem value="Finished Goods">Finished Goods</MenuItem>
              <MenuItem value="Office Supplies">Office Supplies</MenuItem>
              <MenuItem value="Equipment">Equipment</MenuItem>
              <MenuItem value="Consumables">Consumables</MenuItem>
              <MenuItem value="Other">Other</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="In Stock">In Stock</MenuItem>
              <MenuItem value="Low Stock">Low Stock</MenuItem>
              <MenuItem value="Out of Stock">Out of Stock</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </Paper>

      {/* Inventory Table */}
      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Item Code</strong></TableCell>
                <TableCell><strong>Name</strong></TableCell>
                <TableCell><strong>Category</strong></TableCell>
                <TableCell><strong>Finance Category</strong></TableCell>
                <TableCell><strong>Location</strong></TableCell>
                <TableCell align="right"><strong>Qty</strong></TableCell>
                <TableCell align="right"><strong>WAC (Avg Cost)</strong></TableCell>
                <TableCell align="right"><strong>List Price</strong></TableCell>
                <TableCell align="right"><strong>Stock Value</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell align="center"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={12} align="center">
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} align="center">
                    <Typography variant="body2" color="textSecondary">
                      No inventory items found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item._id} hover>
                    <TableCell>{item.itemCode}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>
                      {item.inventoryCategory?.name
                        ? <Chip label={item.inventoryCategory.name} size="small" color="primary" variant="outlined" />
                        : <Chip label="Not set" size="small" color="warning" variant="outlined" />
                      }
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ lineHeight: 1.4 }}>
                        {item.storeSnapshot || item.subStoreSnapshot
                          ? [item.storeSnapshot, item.subStoreSnapshot].filter(Boolean).join(' › ')
                          : '—'}
                      </Typography>
                      {(item.location?.rack || item.location?.shelf || item.location?.bin) && (
                        <Typography variant="caption" color="text.secondary">
                          {[item.location.rack, item.location.shelf, item.location.bin].filter(Boolean).join(' / ')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{item.quantity} {item.unit}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={item.averageCost > 0 ? 700 : 400} color={item.averageCost > 0 ? 'primary' : 'text.secondary'}>
                        {item.averageCost > 0 ? formatPKR(item.averageCost) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{formatPKR(item.unitPrice)}</TableCell>
                    <TableCell align="right">{formatPKR(item.totalValue)}</TableCell>
                    <TableCell>
                      <Chip 
                        label={item.status} 
                        color={getStatusColor(item.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="View">
                        <IconButton size="small" onClick={() => handleView(item)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => handleEdit(item)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Add Stock">
                        <IconButton size="small" color="success" onClick={() => handleStockAction('add', item)}>
                          <AddStockIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove Stock">
                        <IconButton size="small" color="warning" onClick={() => handleStockAction('remove', item)}>
                          <RemoveStockIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => handleDelete(item)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
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
          rowsPerPageOptions={[5, 10, 25, 50]}
        />
      </Paper>

      {/* Create/Edit Dialog */}
      <Dialog 
        open={formDialog.open} 
        onClose={() => setFormDialog({ open: false, mode: 'create', data: null })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {formDialog.mode === 'create' ? 'Add New Item' : 'Edit Item'}
        </DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <Tabs value={formTab} onChange={(_, v) => setFormTab(v)}>
            <Tab label="Item Details" />
            <Tab label="Finance / Accounts" />
          </Tabs>
        </Box>
        <DialogContent>
          {formTab === 0 && (
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Item Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                required
              >
                <MenuItem value="Raw Materials">Raw Materials</MenuItem>
                <MenuItem value="Finished Goods">Finished Goods</MenuItem>
                <MenuItem value="Office Supplies">Office Supplies</MenuItem>
                <MenuItem value="Equipment">Equipment</MenuItem>
                <MenuItem value="Consumables">Consumables</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Finance Category (Inventory Category)"
                value={formData.inventoryCategory}
                onChange={(e) => setFormData({ ...formData, inventoryCategory: e.target.value })}
                helperText="Links item to GL accounts — required for auto journal entries on GRN/SIN"
                onClick={loadFinanceDropdowns}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {invCategories.map((cat) => (
                  <MenuItem key={cat._id} value={cat._id}>
                    {cat.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={2}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="number"
                label="Quantity"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) })}
                required
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Unit"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="number"
                label="Unit Price"
                value={formData.unitPrice}
                onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) })}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Min Quantity"
                value={formData.minQuantity}
                onChange={(e) => setFormData({ ...formData, minQuantity: parseFloat(e.target.value) })}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Max Quantity"
                value={formData.maxQuantity}
                onChange={(e) => setFormData({ ...formData, maxQuantity: parseFloat(e.target.value) })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                select
                label="Supplier"
                value={formData.supplier}
                onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                {vendors.map((vendor) => (
                  <MenuItem key={vendor._id} value={vendor._id}>
                    {vendor.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Rack"
                value={formData.location.rack}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  location: { ...formData.location, rack: e.target.value }
                })}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Shelf"
                value={formData.location.shelf}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  location: { ...formData.location, shelf: e.target.value }
                })}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Bin"
                value={formData.location.bin}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  location: { ...formData.location, bin: e.target.value }
                })}
              />
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
          )}

          {formTab === 1 && (
            <Box sx={{ mt: 2 }}>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Button
                  variant={financeItemType === 'inventory' ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => setFinanceItemType('inventory')}
                >
                  Inventory
                </Button>
                <Button
                  variant={financeItemType === 'non_inventory' ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => setFinanceItemType('non_inventory')}
                >
                  Non-Inventory
                </Button>
                <Button
                  variant={financeItemType === 'services' ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => setFinanceItemType('services')}
                >
                  Services
                </Button>
              </Box>

              {financeItemType === 'inventory' && (
                <>
              <Alert severity="success" sx={{ mb: 2 }}>
                <strong>Recommended:</strong> Set <em>Finance Category</em> on the Details tab — the system will inherit all GL accounts from the category automatically. Use the fields below only if this item needs account overrides different from its category.
              </Alert>
              <Alert severity="info" sx={{ mb: 2 }}>
                <strong>Journal entries posted automatically:</strong><br/>
                • <strong>GRN received:</strong> DR Inventory Account &nbsp;/&nbsp; CR GRNI Account<br/>
                • <strong>Vendor Bill:</strong> DR GRNI Account &nbsp;/&nbsp; CR Accounts Payable<br/>
                • <strong>Goods Issue (SIN):</strong> DR COGS Account &nbsp;/&nbsp; CR Inventory Account &nbsp;(at Weighted Avg Cost)
              </Alert>

              {coaLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : (
                <Grid container spacing={2}>
                  {/* ── GRN Accounts ── */}
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 0.5 }}>
                      On GRN (Goods Received)
                    </Typography>
                    <Divider sx={{ mb: 1.5 }} />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth select size="small"
                      label="Inventory / Stock Valuation Account (DR)"
                      value={formData.inventoryAccount}
                      onChange={(e) => setFormData({ ...formData, inventoryAccount: e.target.value })}
                      helperText="Asset account — increases when stock is received (e.g. 1100 Inventory)"
                    >
                      <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                      {coaAccounts
                        .filter(a => a.type === 'Asset' || a.type === 'asset')
                        .map(a => (
                          <MenuItem key={a._id} value={a._id}>
                            {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                          </MenuItem>
                        ))}
                    </TextField>
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth select size="small"
                      label="GRNI Account — Goods Received Not Invoiced (CR)"
                      value={formData.grniAccount}
                      onChange={(e) => setFormData({ ...formData, grniAccount: e.target.value })}
                      helperText="Clearing liability — credited on GRN, debited when vendor bill is created (e.g. 2100 GRNI)"
                    >
                      <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                      {coaAccounts
                        .filter(a => a.type === 'Liability' || a.type === 'liability')
                        .map(a => (
                          <MenuItem key={a._id} value={a._id}>
                            {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                          </MenuItem>
                        ))}
                    </TextField>
                  </Grid>

                  {/* ── SIN Accounts ── */}
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 0.5, mt: 1 }}>
                      On SIN (Goods Issued from Store)
                    </Typography>
                    <Divider sx={{ mb: 1.5 }} />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth select size="small"
                      label="COGS / Expense Account (DR)"
                      value={formData.cogsAccount}
                      onChange={(e) => setFormData({ ...formData, cogsAccount: e.target.value })}
                      helperText="Expense account — debited at Weighted Avg Cost when stock is issued (e.g. 5000 COGS)"
                    >
                      <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                      {coaAccounts
                        .filter(a => a.type === 'Expense' || a.type === 'expense')
                        .map(a => (
                          <MenuItem key={a._id} value={a._id}>
                            {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                          </MenuItem>
                        ))}
                    </TextField>
                  </Grid>

                  {/* ── Sales / Purchase ── */}
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 0.5, mt: 1 }}>
                      Sales &amp; Direct Purchase (optional overrides)
                    </Typography>
                    <Divider sx={{ mb: 1.5 }} />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth select size="small"
                      label="Sales / Revenue Account"
                      value={formData.salesAccount}
                      onChange={(e) => setFormData({ ...formData, salesAccount: e.target.value })}
                      helperText="Revenue account when item is sold via AR invoice"
                    >
                      <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                      {coaAccounts
                        .filter(a => a.type === 'Revenue' || a.type === 'revenue' || a.type === 'Income' || a.type === 'income')
                        .map(a => (
                          <MenuItem key={a._id} value={a._id}>
                            {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                          </MenuItem>
                        ))}
                    </TextField>
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth select size="small"
                      label="Purchase / Direct Expense Account"
                      value={formData.purchaseAccount}
                      onChange={(e) => setFormData({ ...formData, purchaseAccount: e.target.value })}
                      helperText="Expense account for direct (non-GRN) AP bills only"
                    >
                      <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                      {coaAccounts
                        .filter(a => a.type === 'Expense' || a.type === 'expense')
                        .map(a => (
                          <MenuItem key={a._id} value={a._id}>
                            {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                          </MenuItem>
                        ))}
                    </TextField>
                  </Grid>

                  {coaAccounts.length === 0 && !coaLoading && (
                    <Grid item xs={12}>
                      <Alert severity="warning">
                        No Chart of Accounts found. Please set up accounts in Finance → Chart of Accounts first, then use the Finance Setup Wizard to seed standard accounts.
                      </Alert>
                    </Grid>
                  )}
                </Grid>
              )}
                </>
              )}

              {financeItemType === 'non_inventory' && (
                <>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Non-Inventory items are expensed directly when billed. GRN/SIN inventory postings are not used.
                  </Alert>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth select size="small"
                        label="Purchase / Expense Account"
                        value={formData.purchaseAccount}
                        onChange={(e) => setFormData({ ...formData, purchaseAccount: e.target.value })}
                        helperText="Used when vendor bill is posted directly to expense"
                      >
                        <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                        {coaAccounts
                          .filter(a => a.type === 'Expense' || a.type === 'expense')
                          .map(a => (
                            <MenuItem key={a._id} value={a._id}>
                              {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                            </MenuItem>
                          ))}
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth select size="small"
                        label="Sales / Revenue Account (optional)"
                        value={formData.salesAccount}
                        onChange={(e) => setFormData({ ...formData, salesAccount: e.target.value })}
                        helperText="Use only if this non-inventory item is sold"
                      >
                        <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                        {coaAccounts
                          .filter(a => a.type === 'Revenue' || a.type === 'revenue' || a.type === 'Income' || a.type === 'income')
                          .map(a => (
                            <MenuItem key={a._id} value={a._id}>
                              {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                            </MenuItem>
                          ))}
                      </TextField>
                    </Grid>
                  </Grid>
                </>
              )}

              {financeItemType === 'services' && (
                <>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Service items do not affect stock. Use service income/expense mapping below.
                  </Alert>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth select size="small"
                        label="Service Income / Revenue Account"
                        value={formData.salesAccount}
                        onChange={(e) => setFormData({ ...formData, salesAccount: e.target.value })}
                        helperText="Revenue account for service invoices"
                      >
                        <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                        {coaAccounts
                          .filter(a => a.type === 'Revenue' || a.type === 'revenue' || a.type === 'Income' || a.type === 'income')
                          .map(a => (
                            <MenuItem key={a._id} value={a._id}>
                              {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                            </MenuItem>
                          ))}
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth select size="small"
                        label="Service Cost / Expense Account (optional)"
                        value={formData.purchaseAccount}
                        onChange={(e) => setFormData({ ...formData, purchaseAccount: e.target.value })}
                        helperText="Optional service delivery cost account"
                      >
                        <MenuItem value=""><em>Inherit from Finance Category</em></MenuItem>
                        {coaAccounts
                          .filter(a => a.type === 'Expense' || a.type === 'expense')
                          .map(a => (
                            <MenuItem key={a._id} value={a._id}>
                              {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                            </MenuItem>
                          ))}
                      </TextField>
                    </Grid>
                  </Grid>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormDialog({ open: false, mode: 'create', data: null })}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSubmit}
            disabled={!formData.name || !formData.category || !formData.unit}
          >
            {formDialog.mode === 'create' ? 'Create' : 'Update'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog */}
      <Dialog 
        open={viewDialog.open} 
        onClose={() => setViewDialog({ open: false, data: null, tab: 0 })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Inventory Item Details</DialogTitle>
        <DialogContent>
          {viewDialog.data && (
            <Box>
              <Tabs value={viewDialog.tab} onChange={(e, v) => setViewDialog({ ...viewDialog, tab: v })}>
                <Tab label="Details" />
                <Tab label="Transactions" />
                <Tab label="Finance" />
              </Tabs>
              
              {viewDialog.tab === 0 && (
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Item Code</Typography>
                    <Typography variant="body1" fontWeight="bold">{viewDialog.data.itemCode}</Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Name</Typography>
                    <Typography variant="body1" fontWeight="bold">{viewDialog.data.name}</Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Category</Typography>
                    <Typography variant="body1">{viewDialog.data.category}</Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Status</Typography>
                    <Chip label={viewDialog.data.status} color={getStatusColor(viewDialog.data.status)} />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">Quantity</Typography>
                    <Typography variant="body1" fontWeight="bold">
                      {viewDialog.data.quantity} {viewDialog.data.unit}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">Unit / List Price</Typography>
                    <Typography variant="body1">{formatPKR(viewDialog.data.unitPrice)}</Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">Weighted Avg Cost (WAC)</Typography>
                    <Typography variant="body1" fontWeight="bold" color="primary">
                      {viewDialog.data.averageCost > 0 ? formatPKR(viewDialog.data.averageCost) : '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Used for COGS on SIN</Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">Total Stock Value</Typography>
                    <Typography variant="body1" fontWeight="bold">
                      {formatPKR(viewDialog.data.totalValue)}
                    </Typography>
                  </Grid>
                  {viewDialog.data.supplier && (
                    <Grid item xs={12}>
                      <Typography variant="body2" color="text.secondary">Supplier</Typography>
                      <Typography variant="body1">{viewDialog.data.supplier.name}</Typography>
                    </Grid>
                  )}
                  {(viewDialog.data.storeSnapshot || viewDialog.data.subStoreSnapshot) && (
                    <>
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="primary" sx={{ mt: 1, fontWeight: 'bold' }}>
                          Physical Location
                        </Typography>
                      </Grid>
                      {viewDialog.data.storeSnapshot && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="text.secondary">Main Store</Typography>
                          <Typography variant="body1">{viewDialog.data.storeSnapshot}</Typography>
                        </Grid>
                      )}
                      {viewDialog.data.subStoreSnapshot && (
                        <Grid item xs={12} md={6}>
                          <Typography variant="body2" color="text.secondary">Sub-Store</Typography>
                          <Typography variant="body1">{viewDialog.data.subStoreSnapshot}</Typography>
                        </Grid>
                      )}
                      {viewDialog.data.location?.rack && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary">Rack</Typography>
                          <Typography variant="body1">{viewDialog.data.location.rack}</Typography>
                        </Grid>
                      )}
                      {viewDialog.data.location?.shelf && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary">Shelf</Typography>
                          <Typography variant="body1">{viewDialog.data.location.shelf}</Typography>
                        </Grid>
                      )}
                      {viewDialog.data.location?.bin && (
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary">Bin</Typography>
                          <Typography variant="body1">{viewDialog.data.location.bin}</Typography>
                        </Grid>
                      )}
                    </>
                  )}
                </Grid>
              )}

              {viewDialog.tab === 1 && (
                <List>
                  {viewDialog.data.transactions && viewDialog.data.transactions.length > 0 ? (
                    [...viewDialog.data.transactions].reverse().map((trans, index) => {
                      const isAddition = trans.type === 'In' || trans.type === 'Addition';
                      const perfUser = trans.performedBy ? (trans.performedBy.firstName ? `${trans.performedBy.firstName} ${trans.performedBy.lastName || ''}` : trans.performedBy) : '';
                      return (
                        <ListItem key={index} divider sx={{ py: 1.5 }}>
                          <Box sx={{ mr: 2 }}>
                            <Chip
                              label={trans.type}
                              size="small"
                              color={isAddition ? 'success' : 'warning'}
                              variant="filled"
                              sx={{ fontWeight: 'bold', minWidth: 70 }}
                            />
                          </Box>
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Typography variant="subtitle2" fontWeight="bold">
                                  {isAddition ? '+' : '-'}{trans.quantity} {viewDialog.data.unit}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {formatDate(trans.date)}
                                </Typography>
                              </Box>
                            }
                            secondary={
                              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                                {trans.notes || trans.reference || 'No notes'}
                                {perfUser && ` • Performed by: ${perfUser}`}
                              </Typography>
                            }
                          />
                        </ListItem>
                      );
                    })
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                      No transactions recorded yet
                    </Typography>
                  )}
                </List>
              )}

              {viewDialog.tab === 2 && (
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  {/* WAC / Costing banner */}
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', gap: 3, p: 1.5, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.200', mb: 1 }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Weighted Avg Cost (WAC)</Typography>
                        <Typography variant="h6" fontWeight={700} color="primary">
                          {formatPKR(viewDialog.data.averageCost || 0)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">Used for COGS on every SIN</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">List / Standard Price</Typography>
                        <Typography variant="h6" fontWeight={700}>
                          {formatPKR(viewDialog.data.unitPrice || 0)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">Used on PO / initial cost</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Finance Category</Typography>
                        <Typography variant="body1" fontWeight={600}>
                          {viewDialog.data.inventoryCategory?.name || <em style={{ color: '#f57c00' }}>Not linked</em>}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">Inherits GL accounts from category</Typography>
                      </Box>
                    </Box>
                  </Grid>

                  {/* GL Account chips */}
                  {[
                    { label: 'Inventory / Stock Valuation Account (DR on GRN)', field: 'inventoryAccount', color: 'primary',   note: 'Asset — increases on receipt' },
                    { label: 'GRNI Account — Goods Received Not Invoiced (CR on GRN)', field: 'grniAccount', color: 'warning', note: 'Liability clearing — reversed by vendor bill' },
                    { label: 'COGS / Expense Account (DR on SIN)', field: 'cogsAccount', color: 'error',    note: 'Expense — debited at WAC on issue' },
                    { label: 'Sales / Revenue Account', field: 'salesAccount', color: 'success', note: 'Revenue — credited on AR invoice' },
                    { label: 'Direct Purchase Account', field: 'purchaseAccount', color: 'default', note: 'Expense for non-GRN direct AP bills' }
                  ].map(({ label, field, color, note }) => (
                    <Grid item xs={12} md={6} key={field}>
                      <Typography variant="body2" color="text.secondary" fontWeight={600}>{label}</Typography>
                      {viewDialog.data[field] ? (
                        <Chip
                          size="small"
                          color={color}
                          variant="outlined"
                          label={`${viewDialog.data[field].accountNumber ? viewDialog.data[field].accountNumber + ' – ' : ''}${viewDialog.data[field].name}`}
                          sx={{ mt: 0.5 }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
                          Inherited from Finance Category
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{note}</Typography>
                    </Grid>
                  ))}

                  {!viewDialog.data.inventoryAccount && !viewDialog.data.cogsAccount && !viewDialog.data.inventoryCategory && (
                    <Grid item xs={12}>
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        No finance accounts or Finance Category linked. Edit this item → set Finance Category on the Details tab (recommended), or manually link accounts on the Finance tab.
                      </Alert>
                    </Grid>
                  )}
                </Grid>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialog({ open: false, data: null, tab: 0 })}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Stock Action Dialog */}
      <Dialog 
        open={stockDialog.open} 
        onClose={() => setStockDialog({ open: false, type: '', item: null })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {stockDialog.type === 'add' ? 'Add Stock' : stockDialog.type === 'remove' ? 'Remove Stock' : 'Adjust Stock'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                type="number"
                label="Quantity"
                value={stockFormData.quantity}
                onChange={(e) => setStockFormData({ ...stockFormData, quantity: parseFloat(e.target.value) })}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Reference"
                value={stockFormData.reference}
                onChange={(e) => setStockFormData({ ...stockFormData, reference: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Notes"
                value={stockFormData.notes}
                onChange={(e) => setStockFormData({ ...stockFormData, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStockDialog({ open: false, type: '', item: null })}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleStockSubmit}
            disabled={!stockFormData.quantity || stockFormData.quantity <= 0}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog 
        open={deleteDialog.open} 
        onClose={() => setDeleteDialog({ open: false, item: null, force: false, error: '' })}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {deleteDialog.item && (
              <>Are you sure you want to delete <strong>{deleteDialog.item.name}</strong>{deleteDialog.item.quantity > 0 ? '? This item has existing stock.' : '?'}</>
            )}
          </Typography>
          {deleteDialog.item?.quantity > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This item has <strong>{deleteDialog.item.quantity} {deleteDialog.item.unit}</strong> in stock. Adjust stock to zero first (use Adjust Stock), or use force delete below to delete anyway.
            </Alert>
          )}
          {deleteDialog.item?.quantity > 0 && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={!!deleteDialog.force}
                  onChange={(e) => setDeleteDialog((prev) => ({ ...prev, force: e.target.checked, error: '' }))}
                  color="primary"
                />
              }
              label="Force delete (delete even with existing stock – use with care)"
            />
          )}
          {deleteDialog.error && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setDeleteDialog((prev) => ({ ...prev, error: '' }))}>
              {deleteDialog.error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, item: null, force: false, error: '' })}>Cancel</Button>
          <Button 
            color="error" 
            variant="contained" 
            onClick={confirmDelete}
            disabled={deleteDialog.item?.quantity > 0 && !deleteDialog.force}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Inventory;
