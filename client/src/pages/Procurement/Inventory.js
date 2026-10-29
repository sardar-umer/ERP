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
  FormControlLabel,
  Checkbox,
  Autocomplete,
  Accordion,
  AccordionSummary,
  AccordionDetails
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
  FileDownload as FileDownloadIcon,
  FactCheck as StockCheckIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import api from '../../services/api';
import storeService from '../../services/storeService';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';

/** Accounts an item posts to — normally inherited from its Finance Category */
const ACCOUNT_ROLES = [
  { key: 'inventory', field: 'inventoryAccount', type: 'asset', label: 'Inventory (DR on GRN, CR on SIN)' },
  { key: 'grni', field: 'grniAccount', type: 'liability', label: 'GRNI (CR on GRN, cleared by vendor bill)' },
  { key: 'cogs', field: 'cogsAccount', type: 'expense', label: 'COGS (DR on SIN)' },
  { key: 'sales', field: 'salesAccount', type: 'revenue', label: 'Sales (customer invoices)' }
];

const Inventory = ({ openStockCheck = false }) => {
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
  const [rowsPerPage, setRowsPerPage] = useState(250);
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
  // Stock always belongs to a store + project (SIN checks project stock)
  const [projects, setProjects] = useState([]);
  const [stores, setStores] = useState([]);
  const [stockCheck, setStockCheck] = useState({ open: false, loading: false, rows: [], fix: {} });
  const [companies, setCompanies] = useState([]);
  const [movements, setMovements] = useState({ loading: false, rows: [] });
  // Add Item picks from the Item Catalog (the one item master)
  const [catalogOptions, setCatalogOptions] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogPick, setCatalogPick] = useState(null);
  const catalogSeq = React.useRef(0);
  const searchCatalog = useCallback(async (q) => {
    const seq = ++catalogSeq.current;
    setCatalogLoading(true);
    try {
      const res = await api.get('/items', { params: { q: q || undefined, limit: 50 } });
      if (seq === catalogSeq.current) setCatalogOptions(res.data?.data || []);
    } catch (_) {
      if (seq === catalogSeq.current) setCatalogOptions([]);
    } finally {
      if (seq === catalogSeq.current) setCatalogLoading(false);
    }
  }, []);
  
  // Form data
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'Other',
    unit: 'pcs',
    quantity: 0,
    minQuantity: 0,
    maxQuantity: '',
    companyId: '',
    unitPrice: 0,
    supplier: '',
    inventoryCategory: '',
    openingProject: '',
    openingStore: '',
    location: { rack: '', shelf: '', bin: '' },
    notes: '',
    inventoryAccount: '',
    grniAccount: '',
    cogsAccount: '',
    salesAccount: '',
    purchaseAccount: ''
  });
  const [effectiveAccounts, setEffectiveAccounts] = useState({ loading: false, data: null });

  // Stock form data
  const [stockFormData, setStockFormData] = useState({
    quantity: 0,
    project: '',
    store: '',
    unitCost: '',
    reference: '',
    reason: ''
  });
  const [projectBalance, setProjectBalance] = useState(null);

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

  // What the item will post to (category → default category → system accounts), refreshed when the category changes
  useEffect(() => {
    if (!formDialog.open || formTab !== 1) return;
    let cancelled = false;
    setEffectiveAccounts({ loading: true, data: null });
    api.get('/inventory-categories/effective-accounts', { params: { inventoryCategory: formData.inventoryCategory || undefined } })
      .then((res) => { if (!cancelled) setEffectiveAccounts({ loading: false, data: res.data?.data || null }); })
      .catch(() => { if (!cancelled) setEffectiveAccounts({ loading: false, data: null }); });
    return () => { cancelled = true; };
  }, [formDialog.open, formTab, formData.inventoryCategory]);

  // Projects + stores for opening stock and the stock buttons (same sources as GRN / SIN)
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/finance/fixed-assets/projects');
        setProjects(res.data?.data || []);
      } catch (_) {
        try {
          const res = await api.get('/projects');
          const rows = res.data?.data?.projects || res.data?.data || res.data || [];
          setProjects(Array.isArray(rows) ? rows : []);
        } catch (__) { setProjects([]); }
      }
      try {
        const res = await storeService.getStores({ type: 'main', activeOnly: 'true' });
        setStores(res.data || []);
      } catch (_) { setStores([]); }
      try {
        const res = await api.get('/indents/companies');
        setCompanies(res.data?.data || []);
      } catch (_) { setCompanies([]); }
    })();
  }, []);

  // Current stock of the item in the chosen project (+ store) — shown in the stock dialog
  useEffect(() => {
    const item = stockDialog.item;
    if (!stockDialog.open || !item || !stockFormData.project) { setProjectBalance(null); return; }
    let cancelled = false;
    api.get('/procurement/stock-balance', { params: { project: stockFormData.project, storeId: stockFormData.store || item.store?._id || item.store || undefined } })
      .then((res) => {
        if (cancelled) return;
        const row = (res.data?.data?.balances || []).find((b) => String(b.item) === String(item._id));
        setProjectBalance(Number(row?.balance) || 0);
      })
      .catch(() => { if (!cancelled) setProjectBalance(null); });
    return () => { cancelled = true; };
  }, [stockDialog.open, stockDialog.item, stockFormData.project, stockFormData.store]);

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
        inventoryCategory: categoryFilter || undefined,
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
            inventoryCategory: categoryFilter || undefined,
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
      minQuantity: 0,
      maxQuantity: '',
      companyId: '',
      unitPrice: 0,
      supplier: '',
      inventoryCategory: '',
      openingProject: '',
      openingStore: '',
      location: { rack: '', shelf: '', bin: '' },
      notes: '',
      inventoryAccount: '',
      grniAccount: '',
      cogsAccount: '',
      salesAccount: '',
      purchaseAccount: ''
    });
    setFormTab(0);
    setCatalogPick(null);
    searchCatalog('');
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
      maxQuantity: item.maxQuantity ?? '',
      companyId: item.companyId?._id || item.companyId || '',
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
    setFormDialog({ open: true, mode: 'edit', data: item });
    await loadFinanceDropdowns();
  };

  const handleView = async (item) => {
    setViewDialog({ open: true, data: item, tab: 0 });
    setMovements({ loading: true, rows: [] });
    api.get(`/procurement/inventory/${item._id}/movements`)
      .then((res) => setMovements({ loading: false, rows: res.data?.data || [] }))
      .catch(() => setMovements({ loading: false, rows: [] }));
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
    setStockFormData({ quantity: 0, project: '', store: item.store?._id || item.store || '', unitCost: '', reference: '', reason: '' });
    setStockDialog({ open: true, type, item });
  };

  const loadStockCheck = async () => {
    setStockCheck((s) => ({ ...s, open: true, loading: true }));
    try {
      const res = await api.get('/procurement/inventory-stock-check');
      setStockCheck((s) => ({ ...s, loading: false, rows: res.data?.data || [] }));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to run stock check');
      setStockCheck((s) => ({ ...s, loading: false }));
    }
  };

  // Sidebar "Stock Check" opens straight into the check
  useEffect(() => {
    if (openStockCheck) loadStockCheck();
  }, [openStockCheck]); // eslint-disable-line react-hooks/exhaustive-deps

  const fixStockRow = async (row) => {
    const fix = stockCheck.fix[row._id] || {};
    if (row.difference > 0 && !fix.project) {
      setError(`Select the project to allocate ${row.difference} ${row.unit || ''} of ${row.name} to`);
      return;
    }
    try {
      const res = await api.post(`/procurement/inventory/${row._id}/reconcile`, { project: fix.project, store: fix.store });
      setSuccess(res.data?.message || 'Fixed');
      loadStockCheck();
      loadInventory();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not fix this item');
    }
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
      
      if (!formData.inventoryCategory) {
        setError('Select the Finance Category — it decides the inventory / COGS accounts');
        setLoading(false);
        return;
      }
      const clean = (p) => ({ ...p, maxQuantity: p.maxQuantity === '' || p.maxQuantity == null || Number.isNaN(p.maxQuantity) ? null : p.maxQuantity, companyId: p.companyId || null });
      if (formDialog.mode === 'create') {
        const payload = { ...clean(formData), itemMaster: catalogPick?._id || undefined };
        if (Number(payload.quantity) > 0 && !payload.openingProject) {
          setError('Select the project for the opening stock (or set quantity to 0 and receive by GRN)');
          setLoading(false);
          return;
        }
        const res = await api.post('/procurement/inventory', payload);
        setSuccess(res.data?.message || 'Inventory item created successfully');
      } else {
        // Stock-derived fields are not sent — they change only through GRN, SIN or the stock buttons
        const payload = clean(formData);
        ['quantity', 'openingProject', 'openingStore'].forEach((k) => delete payload[k]);
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
      const res = await api.post(endpoint, {
        ...stockFormData,
        store: stockFormData.store || undefined,
        unitCost: stockFormData.unitCost === '' ? undefined : Number(stockFormData.unitCost)
      });

      setSuccess(res.data?.message || 'Stock updated');
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
              variant="outlined"
              startIcon={<StockCheckIcon />}
              onClick={loadStockCheck}
            >
              Stock Check
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
              {invCategories.map((cat) => <MenuItem key={cat._id} value={cat._id}>{cat.name}</MenuItem>)}
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
          rowsPerPageOptions={[25, 50, 100, 250, 500]}
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
            <Tab label="Accounts" />
          </Tabs>
        </Box>
        <DialogContent>
          {formTab === 0 && (
          <Grid container spacing={2} sx={{ mt: 1 }}>
            {formDialog.mode === 'create' && (
              <Grid item xs={12}>
                <Autocomplete
                  options={catalogOptions}
                  loading={catalogLoading}
                  value={catalogPick}
                  filterOptions={(x) => x}
                  getOptionLabel={(o) => (o ? `${o.itemCode || ''} — ${o.name}` : '')}
                  isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
                  getOptionDisabled={(o) => Boolean(o.inventoryItem)}
                  onInputChange={(_, v, reason) => { if (reason === 'input') searchCatalog(v); }}
                  onChange={(_, o) => {
                    setCatalogPick(o);
                    if (o) setFormData((fd) => ({ ...fd, name: o.name, unit: o.unit || fd.unit }));
                  }}
                  renderOption={(props, o) => (
                    <li {...props} key={o._id}>
                      <Box sx={{ width: '100%' }}>
                        <Typography variant="body2"><strong>{o.itemCode}</strong> — {o.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {o.categoryPath}{o.inventoryItem ? ` · already has a stock card (${o.inventoryItem.quantity ?? 0} in stock)` : ''}
                        </Typography>
                      </Box>
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Item from catalog"
                      placeholder="Search by name or code…"
                      helperText={catalogPick
                        ? `Code ${catalogPick.itemCode} comes from the Item Catalog`
                        : 'Pick the catalog item. If it is not in the catalog, just type the name below — it will be added under Uncatalogued.'}
                    />
                  )}
                />
              </Grid>
            )}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Item Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={formDialog.mode === 'create' && Boolean(catalogPick)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Company"
                value={formData.companyId || ''}
                onChange={(e) => setFormData({ ...formData, companyId: e.target.value })}
                helperText="Leave blank if the item is shared by all companies"
              >
                <MenuItem value=""><em>Shared (all companies)</em></MenuItem>
                {companies.map((c) => <MenuItem key={c._id} value={c._id}>{c.name}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Finance Category *"
                required
                value={formData.inventoryCategory}
                onChange={(e) => setFormData({ ...formData, inventoryCategory: e.target.value })}
                helperText="Links item to GL accounts — required for auto journal entries on GRN/SIN"
                onClick={loadFinanceDropdowns}
              >
                <MenuItem value=""><em>Select</em></MenuItem>
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
                label={formDialog.mode === 'create' ? 'Opening Quantity' : 'Quantity on Hand'}
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) })}
                disabled={formDialog.mode !== 'create'}
                helperText={formDialog.mode === 'create'
                  ? 'Leave 0 if stock will come by GRN'
                  : 'Changes only via GRN, SIN or Add / Remove / Adjust Stock'}
                inputProps={{ min: 0 }}
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
                label={formDialog.mode === 'create' ? 'Unit Cost' : 'Unit Price (list / fallback cost)'}
                value={formData.unitPrice}
                onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) })}
                disabled={formDialog.mode !== 'create' && Number(formDialog.data?.quantity) > 0}
                helperText={formDialog.mode !== 'create' && Number(formDialog.data?.quantity) > 0
                  ? `Locked while in stock — average cost ${formDialog.data?.averageCost || formDialog.data?.unitPrice || 0}`
                  : (formDialog.mode === 'create' ? 'Cost per unit of the opening stock' : undefined)}
                inputProps={{ min: 0 }}
              />
            </Grid>
            {formDialog.mode === 'create' && Number(formData.quantity) > 0 && (
              <>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth select required
                    label="Opening Stock Project *"
                    value={formData.openingProject}
                    onChange={(e) => setFormData({ ...formData, openingProject: e.target.value })}
                    helperText="Store Issue Notes issue stock project-wise"
                  >
                    <MenuItem value="">Select Project</MenuItem>
                    {projects.map((p) => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth select
                    label="Opening Stock Store"
                    value={formData.openingStore}
                    onChange={(e) => setFormData({ ...formData, openingStore: e.target.value })}
                    helperText="Posts DR Inventory / CR Opening Balance Equity"
                  >
                    <MenuItem value=""><em>Default store</em></MenuItem>
                    {stores.map((st) => <MenuItem key={st._id} value={st._id}>{st.name}{st.code ? ` (${st.code})` : ''}</MenuItem>)}
                  </TextField>
                </Grid>
              </>
            )}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Reorder Level (Min Qty)"
                value={formData.minQuantity}
                onChange={(e) => setFormData({ ...formData, minQuantity: parseFloat(e.target.value) })}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Max Quantity (optional)"
                value={formData.maxQuantity}
                onChange={(e) => setFormData({ ...formData, maxQuantity: e.target.value === '' ? '' : parseFloat(e.target.value) })}
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
              <Alert severity="success" sx={{ mb: 2 }}>
                Accounts come from the item's <strong>Finance Category</strong> (set on the Details tab, or on its catalog category in
                Item Catalog → Finance categories). Category accounts are managed in <strong>Finance → Inventory Categories</strong>.
                Nothing needs to be set here.
              </Alert>

              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>This item will post to</Typography>
              {effectiveAccounts.loading ? (
                <Box sx={{ py: 2, textAlign: 'center' }}><CircularProgress size={22} /></Box>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                  <Table size="small">
                    <TableBody>
                      {ACCOUNT_ROLES.map((role) => {
                        const overrideId = formData[role.field];
                        const override = overrideId ? coaAccounts.find((a) => String(a._id) === String(overrideId)) : null;
                        const eff = effectiveAccounts.data?.[role.key];
                        const acc = override || eff?.account;
                        return (
                          <TableRow key={role.key}>
                            <TableCell sx={{ fontWeight: 600, width: '38%' }}>{role.label}</TableCell>
                            <TableCell>{acc ? `${acc.accountNumber ? `${acc.accountNumber} – ` : ''}${acc.name}` : <em>not set</em>}</TableCell>
                            <TableCell sx={{ width: '28%' }}>
                              <Chip size="small" variant="outlined"
                                color={override ? 'warning' : eff?.source?.startsWith('system') || eff?.source === 'not set' ? 'default' : 'success'}
                                label={override ? 'item override' : (eff?.source || '—')} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              <Accordion disableGutters variant="outlined" defaultExpanded={ACCOUNT_ROLES.some((r) => formData[r.field])}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="body2" fontWeight={600}>
                    Advanced — use different accounts for this item only
                    {ACCOUNT_ROLES.some((r) => formData[r.field]) && <Chip size="small" color="warning" label="overrides set" sx={{ ml: 1, height: 20 }} />}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
                    Only for exceptions. An override stays fixed even if the Finance Category's accounts change later.
                  </Typography>
                  {coaLoading ? (
                    <Box sx={{ py: 2, textAlign: 'center' }}><CircularProgress size={22} /></Box>
                  ) : (
                    <Grid container spacing={2}>
                      {ACCOUNT_ROLES.map((role) => (
                        <Grid item xs={12} md={6} key={role.key}>
                          <TextField
                            fullWidth select size="small"
                            label={role.label}
                            value={formData[role.field] || ''}
                            onChange={(e) => setFormData({ ...formData, [role.field]: e.target.value })}
                          >
                            <MenuItem value=""><em>Use Finance Category</em></MenuItem>
                            {coaAccounts
                              .filter((a) => String(a.type || '').toLowerCase() === role.type)
                              .map((a) => (
                                <MenuItem key={a._id} value={a._id}>
                                  {a.accountNumber ? `${a.accountNumber} – ` : ''}{a.name}
                                </MenuItem>
                              ))}
                          </TextField>
                        </Grid>
                      ))}
                      <Grid item xs={12}>
                        <Button size="small" onClick={() => setFormData((fd) => ({ ...fd, ...Object.fromEntries(ACCOUNT_ROLES.map((r) => [r.field, ''])) }))}>
                          Clear all overrides
                        </Button>
                      </Grid>
                    </Grid>
                  )}
                </AccordionDetails>
              </Accordion>
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
            disabled={!formData.name || !formData.inventoryCategory || !formData.unit}
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
                <Tab label="Stock Movements" />
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
                movements.loading ? (
                  <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
                ) : movements.rows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                    No stock movements recorded yet
                  </Typography>
                ) : (
                  <TableContainer sx={{ mt: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Document</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Project / Store</TableCell>
                          <TableCell sx={{ fontWeight: 700 }} align="right">Qty</TableCell>
                          <TableCell sx={{ fontWeight: 700 }} align="right">Balance</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Notes</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {movements.rows.map((m) => (
                          <TableRow key={m._id}>
                            <TableCell>{formatDate(m.createdAt)}</TableCell>
                            <TableCell>
                              <Chip size="small" label={m.referenceType} sx={{ mr: 0.5, height: 20 }}
                                color={m.quantity > 0 ? 'success' : 'warning'} variant="outlined" />
                              {m.referenceNumber}
                            </TableCell>
                            <TableCell>{m.project?.name || '—'} / {m.storeSnapshot || '—'}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, color: m.quantity > 0 ? 'success.main' : 'warning.main' }}>
                              {m.quantity > 0 ? '+' : ''}{m.quantity} {viewDialog.data.unit}
                            </TableCell>
                            <TableCell align="right">{m.balanceAfter}</TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {m.description || m.notes}
                              {m.createdBy?.firstName ? ` • ${m.createdBy.firstName} ${m.createdBy.lastName || ''}` : ''}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )
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
              <Typography variant="body2" color="text.secondary">
                {stockDialog.item?.name} — item total {stockDialog.item?.quantity} {stockDialog.item?.unit}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth select required
                label="Project *"
                value={stockFormData.project}
                onChange={(e) => setStockFormData({ ...stockFormData, project: e.target.value })}
                helperText={projectBalance != null ? `In this project now: ${projectBalance} ${stockDialog.item?.unit || ''}` : 'Stock is held project-wise'}
              >
                <MenuItem value="">Select Project</MenuItem>
                {projects.map((p) => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth select
                label="Store"
                value={stockFormData.store}
                onChange={(e) => setStockFormData({ ...stockFormData, store: e.target.value })}
              >
                <MenuItem value=""><em>Item's store / default</em></MenuItem>
                {stores.map((st) => <MenuItem key={st._id} value={st._id}>{st.name}{st.code ? ` (${st.code})` : ''}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                type="number"
                label={stockDialog.type === 'adjust' ? 'Counted Quantity (physical count) *' : 'Quantity *'}
                value={stockFormData.quantity}
                onChange={(e) => setStockFormData({ ...stockFormData, quantity: parseFloat(e.target.value) })}
                helperText={stockDialog.type === 'adjust' && projectBalance != null && !Number.isNaN(stockFormData.quantity)
                  ? `Difference: ${(Number(stockFormData.quantity) || 0) - projectBalance > 0 ? '+' : ''}${(Number(stockFormData.quantity) || 0) - projectBalance}`
                  : undefined}
                inputProps={{ min: 0 }}
              />
            </Grid>
            {stockDialog.type === 'add' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  type="number"
                  label="Unit Cost"
                  value={stockFormData.unitCost}
                  onChange={(e) => setStockFormData({ ...stockFormData, unitCost: e.target.value })}
                  placeholder={String(stockDialog.item?.averageCost || stockDialog.item?.unitPrice || 0)}
                  helperText="Blank = current average cost"
                  inputProps={{ min: 0 }}
                />
              </Grid>
            )}
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                multiline
                rows={2}
                label="Reason *"
                placeholder={stockDialog.type === 'adjust' ? 'e.g. Physical count 28 Oct' : stockDialog.type === 'remove' ? 'e.g. Damaged / expired' : 'e.g. Found in store, not on any GRN'}
                value={stockFormData.reason}
                onChange={(e) => setStockFormData({ ...stockFormData, reason: e.target.value })}
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
              <Alert severity="info" sx={{ py: 0 }}>
                {stockDialog.type === 'remove'
                  ? 'Posts DR COGS (stock loss) / CR Inventory at average cost.'
                  : stockDialog.type === 'add'
                    ? 'Posts DR Inventory / CR COGS (stock gain).'
                    : 'Gain: DR Inventory / CR COGS. Loss: DR COGS / CR Inventory.'}
              </Alert>
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
            disabled={loading || !stockFormData.project || !stockFormData.reason.trim()
              || (stockDialog.type === 'adjust' ? !(stockFormData.quantity >= 0) : !(stockFormData.quantity > 0))}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stock Check: item total vs project stock */}
      <Dialog open={stockCheck.open} onClose={() => setStockCheck((s) => ({ ...s, open: false }))} maxWidth="lg" fullWidth>
        <DialogTitle>Stock Check — item total vs project stock</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Store Issue Notes issue from project stock. Items listed here have an item total that differs from their project stock.
            <strong> More on item</strong>: allocate the extra quantity to a project (no accounting entry — it is already valued).
            <strong> More in projects</strong>: raise the item total to match.
          </Typography>
          {stockCheck.loading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>
          ) : stockCheck.rows.length === 0 ? (
            <Alert severity="success">All items match their project stock.</Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Item</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Item Total</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Project Stock</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Difference</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>By Project</TableCell>
                    <TableCell sx={{ fontWeight: 700, minWidth: 320 }}>Fix</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stockCheck.rows.map((row) => {
                    const fix = stockCheck.fix[row._id] || {};
                    const setFix = (patch) => setStockCheck((s) => ({ ...s, fix: { ...s.fix, [row._id]: { ...fix, ...patch } } }));
                    return (
                      <TableRow key={row._id}>
                        <TableCell>{row.name} <Typography component="span" variant="caption" color="text.secondary">({row.itemCode})</Typography></TableCell>
                        <TableCell align="right">{row.itemQuantity} {row.unit}</TableCell>
                        <TableCell align="right">{row.ledgerQuantity}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: row.difference > 0 ? 'warning.main' : 'error.main' }}>
                          {row.difference > 0 ? '+' : ''}{row.difference}
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          {row.breakdown.length ? row.breakdown.map((b) => `${b.project} / ${b.store}: ${b.qty}`).join(', ') : '—'}
                        </TableCell>
                        <TableCell>
                          {row.difference > 0 ? (
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                              <TextField select size="small" label="Project" value={fix.project || ''} onChange={(e) => setFix({ project: e.target.value })} sx={{ minWidth: 150 }}>
                                {projects.map((p) => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
                              </TextField>
                              <TextField select size="small" label="Store" value={fix.store || ''} onChange={(e) => setFix({ store: e.target.value })} sx={{ minWidth: 110 }}>
                                <MenuItem value=""><em>Default</em></MenuItem>
                                {stores.map((st) => <MenuItem key={st._id} value={st._id}>{st.name}</MenuItem>)}
                              </TextField>
                              <Button size="small" variant="contained" onClick={() => fixStockRow(row)}>Allocate</Button>
                            </Box>
                          ) : (
                            <Button size="small" variant="outlined" onClick={() => fixStockRow(row)}>Raise item total</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={loadStockCheck} startIcon={<RefreshIcon />}>Re-check</Button>
          <Button onClick={() => setStockCheck((s) => ({ ...s, open: false }))}>Close</Button>
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
