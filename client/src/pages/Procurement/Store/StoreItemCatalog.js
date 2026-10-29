import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePagination } from '../../../hooks/usePagination';
import TablePaginationWrapper from '../../../components/TablePaginationWrapper';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Toolbar,
  InputAdornment,
  Autocomplete
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  DeleteOutline as DeactivateIcon,
  Restore as RestoreIcon,
  Inventory2 as InventoryIcon,
  Search as SearchIcon,
  FileDownload as FileDownloadIcon
} from '@mui/icons-material';
import {
  fetchItemMasterManageList,
  createItemCategory,
  createItemMaster,
  updateItemMaster,
  deactivateItemMaster,
  fetchCategoryFinance,
  setCategoryFinance
} from '../../../services/itemMasterService';
import api from '../../../services/api';

const StoreItemCatalog = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ category: '', financeCategory: null });

  // Finance Categories (Finance → Inventory Categories) — each one carries the inventory / GRNI / COGS accounts
  const [financeCategories, setFinanceCategories] = useState([]);
  useEffect(() => {
    api.get('/inventory-categories', { params: { isActive: 'true' } })
      .then((res) => setFinanceCategories(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setFinanceCategories([]));
  }, []);

  // Bulk "catalog category → Finance Category" mapping
  const [financeMap, setFinanceMap] = useState({ open: false, loading: false, rows: [], search: '' });
  const openFinanceMap = async () => {
    setFinanceMap((m) => ({ ...m, open: true, loading: true }));
    try {
      const res = await fetchCategoryFinance();
      setFinanceMap((m) => ({ ...m, loading: false, rows: res.data?.data || [] }));
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to load categories', severity: 'error' });
      setFinanceMap((m) => ({ ...m, loading: false }));
    }
  };
  const saveFinanceMap = async (row, inventoryCategory) => {
    try {
      await setCategoryFinance(row.categoryPath, inventoryCategory);
      setFinanceMap((m) => ({
        ...m,
        rows: m.rows.map((r) => (r.categoryPath === row.categoryPath ? { ...r, inventoryCategory: inventoryCategory || null, mixed: false } : r))
      }));
      setSnackbar({ open: true, message: `${row.category}: Finance Category saved`, severity: 'success' });
      load();
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to save', severity: 'error' });
    }
  };

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [itemForm, setItemForm] = useState({
    category: '',
    categoryPath: '',
    name: '',
    srNo: '',
    financeCategory: null
  });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const pagination = usePagination({
    defaultRowsPerPage: 250,
    resetDependencies: [searchDebounced]
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchItemMasterManageList();
      setRows(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to load catalog',
        severity: 'error'
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categoryOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return [...set].sort((a, b) => String(a).localeCompare(String(b)));
  }, [rows]);

  const openAddCategory = () => {
    setCategoryForm({ category: '', financeCategory: null });
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async () => {
    const c = categoryForm.category?.trim();
    if (!c) {
      setSnackbar({ open: true, message: 'Enter a category name', severity: 'warning' });
      return;
    }
    try {
      setSaving(true);
      await createItemCategory(c, null, categoryForm.financeCategory?._id || null);
      setSnackbar({ open: true, message: 'Category created', severity: 'success' });
      setCategoryDialogOpen(false);
      setSearch('');
      setSearchDebounced('');
      pagination.setPage(0);
      await load();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to create category',
        severity: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const openAddItem = () => {
    setEditingId(null);
    const first = categoryOptions[0] || '';
    setItemForm({
      category: first,
      categoryPath: first,
      name: '',
      srNo: '',
      financeCategory: null
    });
    setItemDialogOpen(true);
  };

  const sameId = (a, b) => String(a?._id || a || '') === String(b?._id || b || '');

  const resolveFinanceOption = (ref) => {
    if (!ref) return null;
    const fromList = financeCategories.find((c) => sameId(c._id, ref));
    if (fromList) return fromList;
    return typeof ref === 'object' && ref._id ? ref : null;
  };

  const financeAutocompleteProps = {
    options: financeCategories,
    getOptionLabel: (o) => (o && typeof o === 'object' ? o.name || '' : ''),
    isOptionEqualToValue: (o, v) => sameId(o, v),
    renderInput: (params) => (
      <TextField {...params} label="Finance Category" margin="normal" size="small"
        helperText="Decides the inventory / GRNI / COGS accounts. Blank = the category's (or the default) Finance Category." />
    )
  };

  const openEdit = (row) => {
    setEditingId(row._id);
    setItemForm({
      category: row.category || '',
      categoryPath: row.categoryPath || row.category || '',
      name: row.isCategoryRoot ? '' : row.name || '',
      srNo: row.srNo != null && row.srNo !== '' ? String(row.srNo) : '',
      financeCategory: resolveFinanceOption(row.inventoryCategory)
    });
    setItemDialogOpen(true);
  };

  const handleSaveItem = async () => {
    const category = itemForm.category?.trim();
    const categoryPath = itemForm.categoryPath?.trim() || category;
    const name = itemForm.name?.trim();
    if (!category) {
      setSnackbar({ open: true, message: 'Category is required', severity: 'warning' });
      return;
    }
    if (editingId) {
      const row = rows.find((r) => sameId(r._id, editingId));
      const financePayload = itemForm.financeCategory?._id || null;
      if (row?.isCategoryRoot) {
        try {
          setSaving(true);
          await updateItemMaster(editingId, {
            category,
            categoryPath,
            name: category,
            isActive: true,
            inventoryCategory: financePayload,
            srNo: Number.isFinite(Number(row.srNo)) ? Number(row.srNo) : 0
          });
          setSnackbar({ open: true, message: 'Category updated', severity: 'success' });
          setItemDialogOpen(false);
          setEditingId(null);
          await load();
        } catch (err) {
          setSnackbar({
            open: true,
            message: err.response?.data?.message || 'Failed to update',
            severity: 'error'
          });
        } finally {
          setSaving(false);
        }
        return;
      }
      if (!name) {
        setSnackbar({ open: true, message: 'Item name is required', severity: 'warning' });
        return;
      }
      const parsedSr = itemForm.srNo?.trim() ? parseInt(itemForm.srNo, 10) : NaN;
      const srNo = Number.isFinite(parsedSr)
        ? parsedSr
        : (Number.isFinite(Number(row?.srNo)) ? Number(row.srNo) : 1);
      try {
        setSaving(true);
        await updateItemMaster(editingId, {
          category,
          categoryPath,
          name,
          inventoryCategory: financePayload,
          srNo
        });
        setSnackbar({ open: true, message: 'Item updated', severity: 'success' });
        setItemDialogOpen(false);
        setEditingId(null);
        await load();
      } catch (err) {
        setSnackbar({
          open: true,
          message: err.response?.data?.message || 'Failed to update',
          severity: 'error'
        });
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!name) {
      setSnackbar({ open: true, message: 'Item name is required', severity: 'warning' });
      return;
    }
    try {
      setSaving(true);
      await createItemMaster({
        category,
        categoryPath,
        name,
        inventoryCategory: itemForm.financeCategory?._id || null,
        ...(itemForm.srNo?.trim() ? { srNo: parseInt(itemForm.srNo, 10) } : {})
      });
      setSnackbar({ open: true, message: 'Item created', severity: 'success' });
      setItemDialogOpen(false);
      setSearch('');
      setSearchDebounced('');
      pagination.setPage(0);
      await load();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to create item',
        severity: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (row) => {
    const label = row.isCategoryRoot ? `category "${row.category}"` : `item "${row.name || row.category}"`;
    if (!window.confirm(`Deactivate ${label}? It will no longer appear when creating indents.`)) return;
    try {
      await deactivateItemMaster(row._id);
      setSnackbar({ open: true, message: 'Deactivated', severity: 'success' });
      await load();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to deactivate',
        severity: 'error'
      });
    }
  };

  const handleReactivate = async (row) => {
    try {
      await updateItemMaster(row._id, { isActive: true });
      setSnackbar({ open: true, message: 'Reactivated', severity: 'success' });
      await load();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to reactivate',
        severity: 'error'
      });
    }
  };

  /** Hide category placeholder rows when that path already has at least one active real item (matches server cleanup; covers legacy data). */
  const catalogRows = useMemo(() => {
    const pathsWithActiveItems = new Set();
    rows.forEach((r) => {
      if (!r.isCategoryRoot && r.isActive !== false) {
        pathsWithActiveItems.add(String(r.categoryPath || '').trim());
      }
    });
    return rows.filter((r) => {
      if (!r.isCategoryRoot) return true;
      const p = String(r.categoryPath || '').trim();
      return !pathsWithActiveItems.has(p);
    });
  }, [rows]);

  const sortedRows = useMemo(
    () =>
      [...catalogRows].sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        const byPath = String(a.categoryPath || '').localeCompare(String(b.categoryPath || ''));
        if (byPath !== 0) return byPath;
        if (a.isCategoryRoot !== b.isCategoryRoot) return a.isCategoryRoot ? -1 : 1;
        const bySr = (a.srNo || 0) - (b.srNo || 0);
        if (bySr !== 0) return bySr;
        return String(a.name || '').localeCompare(String(b.name || ''));
      }),
    [catalogRows]
  );

  const filteredRows = useMemo(() => {
    const terms = searchDebounced
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (terms.length === 0) return sortedRows;
    return sortedRows.filter((r) => {
      const typeLabel = r.isCategoryRoot ? 'category' : 'item';
      const statusLabel = r.isActive === false ? 'inactive' : 'active';
      const nameForSearch = r.isCategoryRoot ? r.category : r.name;
      const hay = [
        typeLabel,
        statusLabel,
        r.category,
        r.categoryPath,
        nameForSearch,
        r.itemCode,
        r.srNo != null ? String(r.srNo) : ''
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [sortedRows, searchDebounced]);

  useEffect(() => {
    const total = filteredRows.length;
    const maxPage = Math.max(0, Math.ceil(total / pagination.rowsPerPage) - 1);
    if (total > 0 && pagination.page > maxPage) {
      pagination.setPage(maxPage);
    }
  }, [filteredRows.length, pagination.rowsPerPage, pagination.page, pagination.setPage]);

  const pagedRows = useMemo(() => {
    const start = pagination.page * pagination.rowsPerPage;
    return filteredRows.slice(start, start + pagination.rowsPerPage);
  }, [filteredRows, pagination.page, pagination.rowsPerPage]);

  const handleExportExcel = async () => {
    if (!filteredRows.length) {
      setSnackbar({ open: true, message: 'Nothing to export', severity: 'warning' });
      return;
    }
    try {
      setExporting(true);
      const XLSX = await import('xlsx');
      const exportData = filteredRows.map((r) => ({
        'Sr #': r.isCategoryRoot ? '' : (r.srNo ?? ''),
        'Item code': r.isCategoryRoot ? '' : (r.itemCode || ''),
        Type: r.isCategoryRoot ? 'Category' : 'Item',
        Category: r.category || '',
        'Category path': r.categoryPath || '',
        'Item name': r.isCategoryRoot ? '' : (r.name || ''),
        'Finance category': r.inventoryCategory?.name || '',
        Unit: r.unit || '',
        'In stock': r.inventoryItem ? (r.inventoryItem.quantity ?? 0) : '',
        Status: r.isActive === false ? 'Inactive' : 'Active'
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Item Catalog');
      XLSX.writeFile(wb, `item-catalog-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setSnackbar({
        open: true,
        message: `Exported ${exportData.length} row(s) (all pages${searchDebounced.trim() ? ', current search' : ''})`,
        severity: 'success'
      });
    } catch (err) {
      console.error(err);
      setSnackbar({ open: true, message: 'Export failed', severity: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const editingRow = editingId ? rows.find((x) => sameId(x._id, editingId)) : null;

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <InventoryIcon color="primary" sx={{ fontSize: 32 }} />
        <Typography variant="h5" fontWeight={600}>
          Item catalog
        </Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        This is the <strong>one item master</strong>: every item has one code, used on indents, purchase orders, GRNs and
        Store Issue Notes. An item gets a stock card in Inventory automatically on its first GRN (or via Inventory → Add Item).
        Items first seen on a GRN that were not here are added under <strong>Material › Uncatalogued</strong> — move them to the right category.
      </Alert>

      <Card>
        <Toolbar sx={{ pl: 2, pr: 2, gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAddCategory} disabled={loading}>
            Add category
          </Button>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openAddItem} disabled={loading || categoryOptions.length === 0}>
            Add item
          </Button>
          <Button variant="outlined" onClick={openFinanceMap} disabled={loading}>
            Finance categories
          </Button>
          <Button
            variant="outlined"
            color="success"
            startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <FileDownloadIcon />}
            onClick={handleExportExcel}
            disabled={loading || exporting || filteredRows.length === 0}
          >
            {exporting ? 'Exporting…' : 'Export Excel'}
          </Button>
          <TextField
            size="small"
            placeholder="Search entire catalog…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading}
            sx={{ minWidth: 260, ml: { xs: 0, sm: 1 }, flex: { xs: '1 1 100%', sm: '0 1 280px' } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" fontSize="small" />
                </InputAdornment>
              )
            }}
            helperText="Searches all rows (every page), then results are paginated below."
          />
          {categoryOptions.length === 0 && !loading && (
            <Typography variant="body2" color="text.secondary">
              Create a category before adding items.
            </Typography>
          )}
        </Toolbar>
        <CardContent sx={{ pt: 0 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell align="right"><strong>Sr #</strong></TableCell>
                    <TableCell><strong>Item code</strong></TableCell>
                    <TableCell><strong>Type</strong></TableCell>
                    <TableCell><strong>Category</strong></TableCell>
                    <TableCell><strong>Category path</strong></TableCell>
                    <TableCell><strong>Item name</strong></TableCell>
                    <TableCell><strong>Finance category</strong></TableCell>
                    <TableCell align="right"><strong>In stock</strong></TableCell>
                    <TableCell><strong>Status</strong></TableCell>
                    <TableCell align="right"><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10}>
                        <Typography color="text.secondary">No catalog rows yet. Add a category to begin.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10}>
                        <Typography color="text.secondary">
                          No rows match &quot;{searchDebounced.trim()}&quot;. Try another term — search covers the full catalog, not only this page.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedRows.map((r) => (
                      <TableRow key={r._id} hover>
                        <TableCell align="right">{r.isCategoryRoot ? '—' : r.srNo}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{r.isCategoryRoot ? '—' : (r.itemCode || '—')}</TableCell>
                        <TableCell>
                          {r.isCategoryRoot ? (
                            <Chip size="small" label="Category" color="primary" variant="outlined" />
                          ) : (
                            <Chip size="small" label="Item" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell>{r.category}</TableCell>
                        <TableCell sx={{ maxWidth: 220, wordBreak: 'break-word' }}>{r.categoryPath}</TableCell>
                        <TableCell sx={{ maxWidth: 280, wordBreak: 'break-word' }}>
                          {r.isCategoryRoot ? '—' : r.name}
                        </TableCell>
                        <TableCell>
                          {r.inventoryCategory?.name || <Typography component="span" variant="caption" color="text.secondary">default</Typography>}
                        </TableCell>
                        <TableCell align="right">
                          {r.isCategoryRoot ? '—' : r.inventoryItem
                            ? `${r.inventoryItem.quantity ?? 0} ${r.inventoryItem.unit || r.unit || ''}`
                            : <Typography component="span" variant="caption" color="text.secondary">no stock card</Typography>}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={r.isActive === false ? 'Inactive' : 'Active'}
                            color={r.isActive === false ? 'default' : 'success'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            title="Edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(r);
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          {r.isActive !== false ? (
                            <IconButton size="small" title="Deactivate" onClick={() => handleDeactivate(r)} color="warning">
                              <DeactivateIcon fontSize="small" />
                            </IconButton>
                          ) : (
                            <IconButton size="small" title="Reactivate" onClick={() => handleReactivate(r)} color="success">
                              <RestoreIcon fontSize="small" />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {!loading && filteredRows.length > 0 && (
            <TablePaginationWrapper
              page={pagination.page}
              rowsPerPage={pagination.rowsPerPage}
              total={filteredRows.length}
              onPageChange={pagination.handleChangePage}
              onRowsPerPageChange={pagination.handleChangeRowsPerPage}
              rowsPerPageOptions={[25, 50, 100, 250, 500]}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={categoryDialogOpen} onClose={() => !saving && setCategoryDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add category</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            autoFocus
            margin="normal"
            label="Category name"
            value={categoryForm.category}
            onChange={(e) => setCategoryForm({ ...categoryForm, category: e.target.value })}
            placeholder="e.g. Bricks, Cement, Electrical"
          />
          <Autocomplete
            {...financeAutocompleteProps}
            value={categoryForm.financeCategory}
            onChange={(e, v) => setCategoryForm({ ...categoryForm, financeCategory: v })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCategoryDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSaveCategory} disabled={saving}>
            {saving ? <CircularProgress size={22} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={itemDialogOpen}
        onClose={() => {
          if (saving) return;
          setItemDialogOpen(false);
          setEditingId(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editingId ? (editingRow?.isCategoryRoot ? 'Edit category' : 'Edit item') : 'Add item'}
        </DialogTitle>
        <DialogContent>
          {editingRow?.isCategoryRoot ? (
            <>
              <TextField
                fullWidth
                margin="normal"
                size="small"
                label="Category name"
                value={itemForm.category}
                onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))}
              />
              <TextField
                fullWidth
                margin="normal"
                size="small"
                label="Category path"
                helperText="Usually same as category name."
                value={itemForm.categoryPath}
                onChange={(e) => setItemForm((f) => ({ ...f, categoryPath: e.target.value }))}
              />
              <Autocomplete
                {...financeAutocompleteProps}
                value={itemForm.financeCategory}
                onChange={(e, v) => setItemForm((f) => ({ ...f, financeCategory: v }))}
              />
            </>
          ) : editingId ? (
            <>
              <TextField
                fullWidth
                margin="normal"
                size="small"
                label="Category"
                value={itemForm.category}
                onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))}
              />
              <TextField
                fullWidth
                margin="normal"
                size="small"
                label="Category path"
                value={itemForm.categoryPath}
                onChange={(e) => setItemForm((f) => ({ ...f, categoryPath: e.target.value }))}
              />
              <TextField
                fullWidth
                margin="normal"
                size="small"
                required
                label="Item name"
                value={itemForm.name}
                onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
              />
              <TextField
                fullWidth
                margin="normal"
                size="small"
                label="Serial #"
                value={itemForm.srNo}
                onChange={(e) => setItemForm((f) => ({ ...f, srNo: e.target.value }))}
              />
              <Autocomplete
                {...financeAutocompleteProps}
                value={itemForm.financeCategory}
                onChange={(e, v) => setItemForm((f) => ({ ...f, financeCategory: v }))}
              />
            </>
          ) : (
            <>
              <FormControl fullWidth margin="normal" size="small">
                <InputLabel>Category</InputLabel>
                <Select
                  label="Category"
                  value={itemForm.category}
                  onChange={(e) => {
                    const v = e.target.value;
                    setItemForm((f) => ({ ...f, category: v, categoryPath: v }));
                  }}
                >
                  {categoryOptions.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                fullWidth
                margin="normal"
                size="small"
                label="Category path (optional)"
                helperText="Defaults to category. Use nested paths only if you use them elsewhere."
                value={itemForm.categoryPath}
                onChange={(e) => setItemForm((f) => ({ ...f, categoryPath: e.target.value }))}
              />
              <TextField
                fullWidth
                margin="normal"
                size="small"
                required
                label="Item name"
                value={itemForm.name}
                onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
              />
              <TextField
                fullWidth
                margin="normal"
                size="small"
                label="Serial # (optional)"
                value={itemForm.srNo}
                onChange={(e) => setItemForm((f) => ({ ...f, srNo: e.target.value }))}
                placeholder="Auto if empty"
              />
              <Autocomplete
                {...financeAutocompleteProps}
                value={itemForm.financeCategory}
                onChange={(e, v) => setItemForm((f) => ({ ...f, financeCategory: v }))}
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setItemDialogOpen(false);
              setEditingId(null);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSaveItem} disabled={saving}>
            {saving ? <CircularProgress size={22} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={financeMap.open} onClose={() => setFinanceMap((m) => ({ ...m, open: false }))} maxWidth="md" fullWidth>
        <DialogTitle>Finance categories</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            Pick a <strong>Finance Category</strong> for each catalog category once. Its accounts (Inventory, GRNI, COGS) are then
            used for every item in that category — no accounts on individual items. Accounts are set in
            <strong> Finance → Inventory Categories</strong>. Blank = the default Finance Category.
          </Alert>
          <TextField
            size="small" fullWidth placeholder="Filter categories…" sx={{ mb: 1 }}
            value={financeMap.search} onChange={(e) => setFinanceMap((m) => ({ ...m, search: e.target.value }))}
          />
          {financeMap.loading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>
          ) : (
            <TableContainer sx={{ maxHeight: 480 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Catalog category</strong></TableCell>
                    <TableCell align="right"><strong>Items</strong></TableCell>
                    <TableCell align="right"><strong>Stocked</strong></TableCell>
                    <TableCell sx={{ minWidth: 220 }}><strong>Finance category</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {financeMap.rows
                    .filter((r) => !financeMap.search.trim() || r.categoryPath.toLowerCase().includes(financeMap.search.trim().toLowerCase()))
                    .map((r) => (
                      <TableRow key={r.categoryPath} hover>
                        <TableCell sx={{ fontSize: 13 }}>{r.categoryPath}</TableCell>
                        <TableCell align="right">{r.items}</TableCell>
                        <TableCell align="right">{r.stocked || '—'}</TableCell>
                        <TableCell>
                          <Select
                            size="small" fullWidth displayEmpty
                            value={r.inventoryCategory || ''}
                            onChange={(e) => saveFinanceMap(r, e.target.value)}
                            renderValue={(v) => (v
                              ? financeCategories.find((c) => sameId(c._id, v))?.name || '—'
                              : (r.mixed ? `Mixed: ${r.financeCategoryNames.join(', ')}` : 'Default'))}
                          >
                            <MenuItem value=""><em>Default</em></MenuItem>
                            {financeCategories.map((c) => <MenuItem key={c._id} value={c._id}>{c.name}{c.isDefault ? ' (default)' : ''}</MenuItem>)}
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFinanceMap((m) => ({ ...m, open: false }))}>Done</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default StoreItemCatalog;
