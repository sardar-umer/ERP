import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Box, Typography, Paper, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Alert, CircularProgress,
  Avatar, useTheme, alpha, Chip, Grid, Divider, Checkbox, Autocomplete,
  ToggleButton, ToggleButtonGroup
} from '@mui/material';
import {
  ExitToApp as IssueIcon, Add as AddIcon, Visibility as ViewIcon,
  Search as SearchIcon, Refresh as RefreshIcon, Close as CloseIcon, Print as PrintIcon,
} from '@mui/icons-material';
import { useLocation, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import storeService from '../../services/storeService';
import { formatDate } from '../../utils/dateUtils';
import BarcodeScanner from '../../components/Procurement/Store/BarcodeScanner';
import LocationSelector from '../../components/Procurement/Store/LocationSelector';

const formatSINDate = (d) => {
  if (!d) return '';
  const x = new Date(d);
  const day = x.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[x.getMonth()]}, ${x.getFullYear()}`;
};

const GoodsIssue = () => {
  const theme = useTheme();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [issues, setIssues] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [projects, setProjects] = useState([]);
  // Customer-wise SINs pick from the same Finance → Customers list as AR invoices
  const [customers, setCustomers] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [viewDialog, setViewDialog] = useState({ open: false, data: null });
  const [viewLoading, setViewLoading] = useState(false);
  const [formDialog, setFormDialog] = useState({ open: false });
  const processedIndentRef = useRef(null);
  const urlSourceParamsAppliedRef = useRef(false);
  const [mainStores, setMainStores] = useState([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [indentOptions, setIndentOptions] = useState([]);
  const [poOptions, setPoOptions] = useState([]);
  const [grnOptions, setGrnOptions] = useState([]);
  const emptyItem = () => ({
    inventoryItem: '', itemCode: '', itemName: '', unit: '',
    qtyReturned: 0, qtyIssued: 1, balanceQty: 0,
    issuedFromNewStock: true, issuedFromOldStock: false,
    subStore: '', location: { rack: '', shelf: '', bin: '' }, notes: ''
  });
  const [formData, setFormData] = useState({
    issueDate: new Date().toISOString().split('T')[0],
    department: 'general',
    departmentName: 'General',
    concernedDepartment: '',
    issuingLocation: 'Store',
    store: '',
    project: '',
    issueType: 'project',
    customer: '',
    costCenter: '',
    costCenterCode: '',
    costCenterName: '',
    requiredFor: '',
    justification: '',
    eprNo: '',
    requestedBy: '',
    requestedByName: '',
    items: [emptyItem()],
    purpose: '',
    notes: '',
    referenceIndent: '',
    referencePurchaseOrder: '',
    referenceGoodsReceive: ''
  });

  const departments = [
    { value: 'hr', label: 'HR' },
    { value: 'admin', label: 'Admin' },
    { value: 'procurement', label: 'Procurement' },
    { value: 'sales', label: 'Sales' },
    { value: 'finance', label: 'Finance' },
    { value: 'audit', label: 'Audit' },
    { value: 'general', label: 'General' },
    { value: 'it', label: 'IT' }
  ];

  useEffect(() => {
    loadIssues();
    loadInventory();
    loadCostCenters();
    loadProjects();
    loadCustomers();
    loadMainStores();
  }, [page, rowsPerPage, search, departmentFilter]);

  const loadMainStores = async () => {
    try {
      const res = await storeService.getStores({ type: 'main', activeOnly: 'true' });
      setMainStores(res.data || []);
    } catch (_) { }
  };

  // Pre-fill form when navigating from Store Dashboard with indent
  useEffect(() => {
    const fromIndent = location.state?.fromIndent;
    const indentId = fromIndent?._id || fromIndent?.indentNumber;
    
    // Skip if already processed or if dialog is already open or if inventory not loaded
    if (!fromIndent || !indentId || inventory.length === 0 || formDialog.open || processedIndentRef.current === indentId) {
      return;
    }

    // Map indent items to GoodsIssue items format
    const mappedItems = (fromIndent.items || [])
      .filter((item) => item.inventoryMatch && item.inStock) // Only include items that are matched and in stock
      .map((item) => {
        return {
          inventoryItem: item.inventoryMatch._id || '',
          itemCode: item.inventoryMatch.itemCode || '',
          itemName: item.itemName || item.inventoryMatch.name || '',
          unit: item.unit || item.inventoryMatch.unit || '',
          qtyReturned: 0,
          qtyIssued: item.quantity || 1,
          balanceQty: 0,
          issuedFromNewStock: true,
          issuedFromOldStock: false,
          notes: item.purpose || ''
        };
      });

    if (mappedItems.length > 0) {
      // Map department from indent to GoodsIssue department
      const indentDeptName = fromIndent.department?.name || '';
      // Try to match department name (case-insensitive, partial match)
      let deptValue = 'general';
      let deptLabel = 'General';
      const matchedDept = departments.find((d) => {
        const deptLabelLower = d.label.toLowerCase();
        const indentDeptLower = indentDeptName.toLowerCase();
        return deptLabelLower === indentDeptLower || indentDeptLower.includes(deptLabelLower) || deptLabelLower.includes(indentDeptLower);
      });
      if (matchedDept) {
        deptValue = matchedDept.value;
        deptLabel = matchedDept.label;
      }

      setFormData({
        issueDate: new Date().toISOString().split('T')[0],
        department: deptValue,
        departmentName: deptLabel,
        concernedDepartment: indentDeptName || '',
        issuingLocation: 'Store',
        store: 'Main Store',
        project: '',
        costCenter: '',
        costCenterCode: '',
        costCenterName: '',
        requiredFor: fromIndent.title || '',
        justification: fromIndent.justification || '',
        eprNo: fromIndent.erpRef || fromIndent.indentNumber || '',
        requestedBy: fromIndent.requestedBy?._id || '',
        requestedByName: fromIndent.requestedBy
          ? `${fromIndent.requestedBy.firstName || ''} ${fromIndent.requestedBy.lastName || ''}`.trim() || fromIndent.requestedBy.email || ''
          : '',
        items: mappedItems,
        purpose: fromIndent.items?.map((i) => i.purpose).filter(Boolean).join('; ') || '',
        notes: `Created from Indent ${fromIndent.indentNumber || fromIndent._id}`,
        referenceIndent: fromIndent._id || '',
        referencePurchaseOrder: '',
        referenceGoodsReceive: ''
      });
      setFormDialog({ open: true });
      processedIndentRef.current = indentId;
      // Clear location state to prevent re-opening on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state, inventory, formDialog.open]);

  const loadIssues = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page: page + 1, limit: rowsPerPage, search, department: departmentFilter };
      const response = await api.get('/procurement/goods-issue', { params });
      if (response.data.success) {
        setIssues(response.data.data.issues);
        setTotalItems(response.data.data.pagination.totalItems);
      }
    } catch (err) {
      setError('Failed to load Store Issue Notes');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, departmentFilter]);

  const loadInventory = async () => {
    try {
      const response = await api.get('/procurement/inventory', {
        params: { limit: 2000, page: 1 }
      });
      if (response.data.success) {
        setInventory(response.data.data.items || []);
      }
    } catch (err) {
      console.error('Error loading inventory:', err);
    }
  };

  /** Stock issue is always against inventory lines; optional Indent / PO / GRN are for traceability only */
  const loadSourceDocumentOptions = useCallback(async () => {
    try {
      const [indRes, poRes, grnRes] = await Promise.all([
        api.get('/indents', { params: { limit: 100, page: 1 } }).catch(() => ({ data: {} })),
        api.get('/procurement/purchase-orders', { params: { limit: 100, page: 1 } }).catch(() => ({ data: {} })),
        api.get('/procurement/goods-receive', { params: { limit: 100, page: 1 } }).catch(() => ({ data: {} }))
      ]);
      const indData = indRes.data?.data;
      setIndentOptions(Array.isArray(indData) ? indData : []);
      setPoOptions(poRes.data?.data?.purchaseOrders || []);
      setGrnOptions(grnRes.data?.data?.receives || []);
    } catch (e) {
      console.error('loadSourceDocumentOptions:', e);
    }
  }, []);

  useEffect(() => {
    if (!formDialog.open) return;
    loadSourceDocumentOptions();
  }, [formDialog.open, loadSourceDocumentOptions]);

  useEffect(() => {
    if (!formDialog.open) return;
    if (urlSourceParamsAppliedRef.current) return;
    const po = searchParams.get('poId');
    const grn = searchParams.get('grnId');
    const ind = searchParams.get('indentId');
    if (!po && !grn && !ind) return;
    setFormData((prev) => ({
      ...prev,
      referencePurchaseOrder: po || prev.referencePurchaseOrder,
      referenceGoodsReceive: grn || prev.referenceGoodsReceive,
      referenceIndent: ind || prev.referenceIndent
    }));
    urlSourceParamsAppliedRef.current = true;
  }, [formDialog.open, searchParams]);

  // Open SIN form automatically when coming with source document params in URL,
  // then prefill references and practical defaults from GRN/PO/Indent context.
  useEffect(() => {
    const poId = searchParams.get('poId');
    const grnId = searchParams.get('grnId');
    const indentId = searchParams.get('indentId');
    if (!poId && !grnId && !indentId) return;
    if (formDialog.open) return;
    handleCreate();
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const poId = searchParams.get('poId');
    const grnId = searchParams.get('grnId');
    const indentId = searchParams.get('indentId');
    if (!formDialog.open) return;
    if (!poId && !grnId && !indentId) return;
    if (inventory.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        let next = {
          referenceIndent: indentId || '',
          referencePurchaseOrder: poId || '',
          referenceGoodsReceive: grnId || ''
        };

        // If GRN is provided, pull context defaults and map items to inventory rows.
        if (grnId) {
          const grnRes = await api.get(`/procurement/goods-receive/${grnId}`);
          const grn = grnRes.data?.data;
          if (grn) {
            next = {
              ...next,
              project: grn.project?._id || grn.project || '',
              store: grn.store?._id || grn.store || '',
              issuingLocation: grn.storeSnapshot || 'Store',
              requiredFor: grn.narration || '',
              eprNo: grn.poNumber || grn.receiveNumber || ''
            };
            if (!next.referencePurchaseOrder && grn.purchaseOrder?._id) {
              next.referencePurchaseOrder = grn.purchaseOrder._id;
            }

            const mappedItems = (grn.items || []).map((it) => {
              const linkedId = it.inventoryItem?._id || it.inventoryItem;
              let inv = linkedId ? inventory.find((x) => x._id === String(linkedId)) : null;
              if (!inv && it.itemCode) inv = inventory.find((x) => x.itemCode === it.itemCode);
              if (!inv && it.itemName) inv = inventory.find((x) => x.name === it.itemName);
              if (!inv) return null;
              const available = getAvailableStock(inv._id);
              return {
                inventoryItem: inv._id,
                itemCode: inv.itemCode,
                itemName: inv.name,
                unit: inv.unit,
                qtyReturned: 0,
                qtyIssued: Number(it.quantity) || 1,
                balanceQty: available,
                issuedFromNewStock: true,
                issuedFromOldStock: false,
                subStore: '',
                location: { rack: '', shelf: '', bin: '' },
                notes: it.notes || ''
              };
            }).filter(Boolean);
            if (mappedItems.length > 0) next.items = mappedItems;
          }
        } else if (poId) {
          // If only PO is provided, keep refs and context fields prefilled.
          const poRes = await api.get(`/procurement/purchase-orders/${poId}`);
          const po = poRes.data?.data;
          if (po) {
            next = {
              ...next,
              eprNo: po.orderNumber || '',
              requiredFor: po.description || ''
            };
          }
        } else if (indentId) {
          const indRes = await api.get(`/indents/${indentId}`);
          const ind = indRes.data?.data;
          if (ind) {
            next = {
              ...next,
              requiredFor: ind.title || '',
              justification: ind.justification || '',
              eprNo: ind.erpRef || ind.indentNumber || ''
            };
          }
        }

        if (!cancelled) {
          setFormData((prev) => ({
            ...prev,
            ...next
          }));
        }
      } catch (e) {
        // keep form usable even if source prefill fails
        console.error('SIN source prefill failed:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [formDialog.open, searchParams, inventory]); // eslint-disable-line react-hooks/exhaustive-deps

  const inventoryPickList = useMemo(() => {
    const q = (inventorySearch || '').trim().toLowerCase();
    return (inventory || []).filter((i) => {
      if ((i.quantity || 0) <= 0) return false;
      if (!q) return true;
      return (
        String(i.itemCode || '').toLowerCase().includes(q) ||
        String(i.name || '').toLowerCase().includes(q)
      );
    });
  }, [inventory, inventorySearch]);

  const loadCostCenters = async () => {
    try {
      const response = await api.get('/procurement/cost-centers', { params: { limit: 1000, isActive: 'true' } });
      if (response.data.success) {
        setCostCenters(response.data.data.costCenters || []);
      }
    } catch (err) {
      console.error('Error loading cost centers:', err);
    }
  };

  const loadCustomers = async () => {
    try {
      const res = await api.get('/procurement/goods-issue-customers');
      setCustomers(res.data?.data || []);
    } catch (e) {
      setCustomers([]);
    }
  };

  const loadProjects = async () => {
    try {
      const res = await api.get('/finance/fixed-assets/projects');
      setProjects(res.data?.data || []);
    } catch (e) {
      // Same as Finance → Fixed Assets / Store GRN: fixed-assets/projects with /projects fallback
      if (e?.response?.status === 404) {
        try {
          const fallbackRes = await api.get('/projects');
          const rows = fallbackRes.data?.data || [];
          setProjects(Array.isArray(rows) ? rows : []);
          return;
        } catch (fallbackErr) {
          setProjects([]);
          const fbMsg = fallbackErr?.response?.data?.message || 'Failed to load projects';
          if (fallbackErr?.response?.status === 403) {
            setError('You do not have access to fetch project dropdown data.');
          } else {
            setError(fbMsg);
          }
          return;
        }
      }

      setProjects([]);
      const msg = e?.response?.data?.message || 'Failed to load projects';
      if (e?.response?.status === 403) {
        setError('You do not have access to fetch project dropdown data.');
      } else {
        setError(msg);
      }
    }
  };

  const handleCreate = () => {
    processedIndentRef.current = null;
    urlSourceParamsAppliedRef.current = false;
    setInventorySearch('');
    setFormData({
      issueDate: new Date().toISOString().split('T')[0],
      department: 'general',
      departmentName: 'General',
      concernedDepartment: '',
      issuingLocation: 'Store',
      store: '',
      project: '',
      issueType: 'project',
      customer: '',
      costCenter: '',
      costCenterCode: '',
      costCenterName: '',
      requiredFor: '',
      justification: '',
      eprNo: '',
      requestedBy: '',
      requestedByName: '',
      items: [emptyItem()],
      purpose: '',
      notes: '',
      referenceIndent: '',
      referencePurchaseOrder: '',
      referenceGoodsReceive: ''
    });
    setFormDialog({ open: true });
  };

  const handleSubmit = async () => {
    const isCustomerIssue = formData.issueType === 'customer';
    if (isCustomerIssue && !formData.customer) {
      setError('Please select the customer');
      return;
    }
    if (!formData.project) {
      setError(isCustomerIssue ? 'Please select the project whose stock is being issued' : 'Please select a project');
      return;
    }
    try {
      setLoading(true);
      const {
        referenceIndent,
        referencePurchaseOrder,
        referenceGoodsReceive,
        ...formRest
      } = formData;
      const payload = {
        ...formRest,
        issueType: isCustomerIssue ? 'customer' : 'project',
        customer: isCustomerIssue ? formData.customer : undefined,
        referenceIndent: referenceIndent || undefined,
        referencePurchaseOrder: referencePurchaseOrder || undefined,
        referenceGoodsReceive: referenceGoodsReceive || undefined,
        store: formData.store || undefined,
        items: formData.items.map((item) => ({
          ...item,
          quantity: Number(item.qtyIssued) || 0,
          qtyReturned: Number(item.qtyReturned) || 0,
          balanceQty: Number(item.balanceQty) || 0,
          subStore: item.subStore || undefined,
          location: item.location || {}
        }))
      };
      await api.post('/procurement/goods-issue', payload);
      setSuccess('Store Issue Note created and inventory updated');
      setFormData({
        issueDate: new Date().toISOString().split('T')[0],
        department: 'general',
        departmentName: 'General',
        concernedDepartment: '',
        issuingLocation: 'Store',
        store: '',
        project: '',
        costCenter: '',
        costCenterCode: '',
        costCenterName: '',
        requiredFor: '',
        justification: '',
        eprNo: '',
        requestedBy: '',
        requestedByName: '',
        items: [emptyItem()],
        purpose: '',
        notes: '',
        referenceIndent: '',
        referencePurchaseOrder: '',
        referenceGoodsReceive: ''
      });
      setFormDialog({ open: false });
      processedIndentRef.current = null;
      // Clear location state to prevent reopening
      window.history.replaceState({}, document.title);
      loadIssues();
      loadInventory();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create Store Issue Note');
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => {
    setFormData({ ...formData, items: [...formData.items, emptyItem()] });
  };

  const removeItem = (index) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index)
    });
  };

  const updateItem = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index][field] = value;
    if (field === 'inventoryItem') {
      const inv = inventory.find((i) => i._id === value);
      if (inv) {
        newItems[index].itemCode = inv.itemCode;
        newItems[index].itemName = inv.name;
        newItems[index].unit = inv.unit;
        newItems[index].subStore = inv.subStore?._id || inv.subStore || newItems[index].subStore || '';
        if (!newItems[index].location?.rack && !newItems[index].location?.shelf && !newItems[index].location?.bin) {
          newItems[index].location = {
            rack: inv.location?.rack || '',
            shelf: inv.location?.shelf || '',
            bin: inv.location?.bin || ''
          };
        }
      }
    }
    setFormData({ ...formData, items: newItems });
  };


  const [projectStockBalances, setProjectStockBalances] = useState({});

  // Load project-wise stock balances when project changes
  useEffect(() => {
    if (!formData.project || !formDialog.open) {
      setProjectStockBalances({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get('/procurement/stock-balance', {
          params: { storeId: formData.store || undefined, project: formData.project }
        });
        if (!cancelled && response.data?.success && response.data?.data?.balances) {
          const balances = {};
          response.data.data.balances.forEach(b => {
            balances[b.item.toString()] = b.balance;
          });
          setProjectStockBalances(balances);
        }
      } catch (err) {
        if (!cancelled) console.error('Error loading project stock balances:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [formData.project, formData.store, formDialog.open]);

  const getAvailableStock = (itemId) => {
    const item = inventory.find(inv => inv._id === itemId);
    if (!formData.project) {
      // Fallback to overall inventory quantity if no project selected
      return item ? item.quantity : 0;
    }
    // Prefer project-wise balance when key exists; otherwise fallback to inventory qty.
    if (Object.prototype.hasOwnProperty.call(projectStockBalances, itemId)) {
      return projectStockBalances[itemId] || 0;
    }
    return item ? item.quantity : 0;
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.error.main, 0.1)} 100%)` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: theme.palette.warning.main, width: 56, height: 56 }}>
              <IssueIcon fontSize="large" />
            </Avatar>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.warning.main }}>
                Store Issue Note
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Create and view Taj Residencia Store Issue Notes (SIN)
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadIssues}>
              Refresh
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>
              Create Store Issue Note
            </Button>
          </Box>
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper>
        <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search by issue number, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            size="small"
            select
            label="Department"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            {departments.map((dept) => <MenuItem key={dept.value} value={dept.value}>{dept.label}</MenuItem>)}
          </TextField>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>SIN #</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Department / Customer</TableCell>
                <TableCell>Cost Center</TableCell>
                <TableCell>Requested By</TableCell>
                <TableCell>Items</TableCell>
                <TableCell>Total Qty</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} align="center"><CircularProgress /></TableCell></TableRow>
              ) : issues.length === 0 ? (
                <TableRow><TableCell colSpan={9} align="center">No records found</TableCell></TableRow>
              ) : (
                issues.map((issue) => (
                  <TableRow key={issue._id} hover>
                    <TableCell><Typography variant="body2" fontWeight="bold">{issue.sinNumber || issue.issueNumber}</Typography></TableCell>
                    <TableCell>{formatDate(issue.issueDate)}</TableCell>
                    <TableCell>
                      {issue.issueType === 'customer'
                        ? <><Chip label="Customer" size="small" color="info" variant="outlined" sx={{ mr: 0.5, height: 20 }} />{issue.customerName}</>
                        : (issue.departmentName || departments.find(d => d.value === issue.department)?.label || issue.department)}
                    </TableCell>
                    <TableCell>{issue.costCenterName || issue.costCenter?.name || issue.costCenterCode || '-'}</TableCell>
                    <TableCell>{issue.requestedByName || issue.requestedBy?.firstName || '-'}</TableCell>
                    <TableCell>{issue.totalItems || 0}</TableCell>
                    <TableCell>{issue.totalQuantity || 0}</TableCell>
                    <TableCell><Chip label={issue.status} size="small" color={issue.status === 'Issued' ? 'success' : 'default'} /></TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={async () => {
                        setViewDialog({ open: true, data: issue });
                        try {
                          setViewLoading(true);
                          const res = await api.get(`/procurement/goods-issue/${issue._id}`);
                          if (res.data?.success && res.data?.data) setViewDialog((prev) => ({ ...prev, data: res.data.data }));
                        } catch (_) { /* keep list data */ } finally { setViewLoading(false); }
                      }}>
                        <ViewIcon fontSize="small" />
                      </IconButton>
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
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[5, 10, 25, 50]}
        />
      </Paper>

      {/* Create Dialog - Store Issue Note layout */}
      <Dialog open={formDialog.open} onClose={() => {
        setFormDialog({ open: false });
        processedIndentRef.current = null;
        window.history.replaceState({}, document.title);
      }} maxWidth="lg" fullWidth>
        <DialogTitle>Create Store Issue Note (Taj Residencia)</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}><Typography variant="overline" color="textSecondary">Details</Typography></Grid>
            <Grid item xs={12}>
              <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 0.5 }}>Issue Type</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                color="primary"
                value={formData.issueType || 'project'}
                onChange={(_, v) => v && setFormData({ ...formData, issueType: v, customer: v === 'customer' ? formData.customer : '' })}
              >
                <ToggleButton value="project">Project (internal use)</ToggleButton>
                <ToggleButton value="customer">Customer (sale)</ToggleButton>
              </ToggleButtonGroup>
              {formData.issueType === 'customer' && (
                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                  This SIN will appear in Finance → AR Invoices under the selected customer for billing at selling price.
                </Typography>
              )}
            </Grid>
            <Grid item xs={12} md={6}>
              {formData.issueType === 'customer' && (
                <Autocomplete
                  options={customers}
                  getOptionLabel={(c) => (c?.name ? `${c.name}${c.company && c.company !== c.name ? ` (${c.company})` : ''}` : '')}
                  value={customers.find((c) => String(c._id) === String(formData.customer)) || null}
                  onChange={(_, c) => setFormData({ ...formData, customer: c?._id || '' })}
                  isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
                  renderInput={(params) => (
                    <TextField {...params} label="Customer *" required helperText="From Finance → Customers" />
                  )}
                  sx={{ mb: 1 }}
                />
              )}
              <TextField
                fullWidth select
                label={formData.issueType === 'customer' ? 'Issue Stock From Project *' : 'Project *'}
                helperText={formData.issueType === 'customer' ? "Items are taken out of this project's stock" : undefined}
                value={formData.project || ''} onChange={(e) => setFormData({ ...formData, project: e.target.value })} required>
                <MenuItem value="">Select Project</MenuItem>
                {projects.map((p) => (
                  <MenuItem key={p._id} value={p._id}>{p.name} {p.projectId ? `(${p.projectId})` : ''}</MenuItem>
                ))}
              </TextField>
              <TextField fullWidth label="Issuing Location" value={formData.issuingLocation} onChange={(e) => setFormData({ ...formData, issuingLocation: e.target.value })} placeholder="e.g. Store" sx={{ mt: 1 }} />
              <TextField
                fullWidth select label="Main Store" value={formData.store || ''} sx={{ mt: 1 }}
                onChange={(e) => setFormData({ ...formData, store: e.target.value })}
                helperText="Select the issuing store"
              >
                <MenuItem value=""><em>— Select Store —</em></MenuItem>
                {mainStores.map(s => <MenuItem key={s._id} value={s._id}>{s.name} ({s.code})</MenuItem>)}
              </TextField>
              <TextField fullWidth select label="Cost Center" value={formData.costCenter} onChange={(e) => {
                const cc = costCenters.find(c => c._id === e.target.value);
                setFormData({ ...formData, costCenter: e.target.value, costCenterCode: cc?.code || '', costCenterName: cc?.name || '' });
              }} sx={{ mt: 1 }}>
                <MenuItem value="">Select Cost Center</MenuItem>
                {costCenters.map((cc) => <MenuItem key={cc._id} value={cc._id}>{cc.name} {cc.code ? `(${cc.code})` : ''}</MenuItem>)}
              </TextField>
              <TextField fullWidth label="Required For" value={formData.requiredFor} onChange={(e) => setFormData({ ...formData, requiredFor: e.target.value })} placeholder="e.g. Plinth beam waterproofing" sx={{ mt: 1 }} />
              <TextField fullWidth label="Justification" value={formData.justification} onChange={(e) => setFormData({ ...formData, justification: e.target.value })} placeholder="e.g. MY Builders (Street #10)" sx={{ mt: 1 }} />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth label="Date" type="date" value={formData.issueDate} onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })} InputLabelProps={{ shrink: true }} />
              <TextField fullWidth label="EPR No." value={formData.eprNo} onChange={(e) => setFormData({ ...formData, eprNo: e.target.value })} placeholder="e.g. M3-00000461" sx={{ mt: 1 }} />
              <TextField fullWidth label="Concerned Department" value={formData.concernedDepartment} onChange={(e) => setFormData({ ...formData, concernedDepartment: e.target.value })} placeholder="e.g. Civil Structure" sx={{ mt: 1 }} />
              <TextField fullWidth select label="Department" value={formData.department} onChange={(e) => {
                const dept = departments.find(d => d.value === e.target.value);
                setFormData({ ...formData, department: e.target.value, departmentName: dept?.label || '' });
              }} sx={{ mt: 1 }}>
                {departments.map((dept) => <MenuItem key={dept.value} value={dept.value}>{dept.label}</MenuItem>)}
              </TextField>
              <TextField fullWidth label="Requested By" value={formData.requestedByName} onChange={(e) => setFormData({ ...formData, requestedByName: e.target.value })} placeholder="Name of requester" sx={{ mt: 1 }} />
              <TextField fullWidth select label="Reference Indent (optional)" value={formData.referenceIndent || ''} onChange={(e) => setFormData({ ...formData, referenceIndent: e.target.value })} sx={{ mt: 1 }}>
                <MenuItem value="">None</MenuItem>
                {indentOptions.map((ind) => <MenuItem key={ind._id} value={ind._id}>{ind.indentNumber || ind.title || ind._id}</MenuItem>)}
              </TextField>
              <TextField fullWidth select label="Reference PO (optional)" value={formData.referencePurchaseOrder || ''} onChange={(e) => setFormData({ ...formData, referencePurchaseOrder: e.target.value })} sx={{ mt: 1 }}>
                <MenuItem value="">None</MenuItem>
                {poOptions.map((po) => <MenuItem key={po._id} value={po._id}>{po.orderNumber} ({po.status})</MenuItem>)}
              </TextField>
              <TextField fullWidth select label="Reference GRN (optional)" value={formData.referenceGoodsReceive || ''} onChange={(e) => setFormData({ ...formData, referenceGoodsReceive: e.target.value })} sx={{ mt: 1 }}>
                <MenuItem value="">None</MenuItem>
                {grnOptions.map((g) => <MenuItem key={g._id} value={g._id}>{g.receiveNumber || g.poNumber || g._id} ({g.status})</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Purpose" value={formData.purpose} onChange={(e) => setFormData({ ...formData, purpose: e.target.value })} placeholder="Purpose of stock issue" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Inventory Search" value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} placeholder="Filter by item code or name" />
            </Grid>
            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1" fontWeight="bold">Items</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={addItem}>Add Item</Button>
              </Box>
              <BarcodeScanner
                label="Scan Item Barcode"
                onItemFound={(item) => {
                  const newItems = [...formData.items];
                  const emptyIdx = newItems.findIndex(i => !i.inventoryItem);
                  const targetIdx = emptyIdx >= 0 ? emptyIdx : newItems.length;
                  if (emptyIdx < 0) newItems.push(emptyItem());
                  const available = getAvailableStock(item._id);
                  newItems[targetIdx] = {
                    ...newItems[targetIdx],
                    inventoryItem: item._id,
                    itemCode: item.itemCode,
                    itemName: item.name,
                    unit: item.unit,
                    qtyIssued: 1,
                    balanceQty: available
                  };
                  setFormData({ ...formData, items: newItems });
                  setSuccess(`Item "${item.name}" added from barcode scan (available: ${available})`);
                }}
                onError={(msg) => setError(msg)}
              />
            </Grid>
            <Grid item xs={12}>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Sr. #</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>From inventory</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Item Code</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Description of Material</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>UOM</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }} align="right">Qty Returned</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }} align="right">Qty Issued</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }} align="right">Balance Qty</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>New Stock</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Old Stock</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Issue From Location</TableCell>
                      <TableCell width={40} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {formData.items.map((item, index) => {
                      const inv = inventory.find((i) => i._id === item.inventoryItem);
                      const dispCode = (item.itemCode != null && String(item.itemCode).trim() !== '') ? item.itemCode : (inv?.itemCode ?? '');
                      const dispName = (item.itemName != null && String(item.itemName).trim() !== '') ? item.itemName : (inv?.name ?? '');
                      const dispUnit = (item.unit != null && String(item.unit).trim() !== '') ? item.unit : (inv?.unit ?? '');
                      return (
                        <TableRow key={index}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <TextField size="small" fullWidth select value={item.inventoryItem} onChange={(e) => updateItem(index, 'inventoryItem', e.target.value)} sx={{ minWidth: 110 }}>
                              <MenuItem value="">Select</MenuItem>
                              {inventoryPickList.map((i) => <MenuItem key={i._id} value={i._id}>{i.itemCode} - {i.name}</MenuItem>)}
                            </TextField>
                          </TableCell>
                          <TableCell>
                            <TextField size="small" fullWidth value={item.itemCode ?? dispCode ?? ''} onChange={(e) => updateItem(index, 'itemCode', e.target.value)} placeholder="Item code" sx={{ minWidth: 100 }} />
                          </TableCell>
                          <TableCell>
                            <TextField size="small" fullWidth value={item.itemName ?? dispName ?? ''} onChange={(e) => updateItem(index, 'itemName', e.target.value)} placeholder="Description" sx={{ minWidth: 120 }} />
                          </TableCell>
                          <TableCell>
                            <TextField size="small" fullWidth value={item.unit ?? dispUnit ?? ''} onChange={(e) => updateItem(index, 'unit', e.target.value)} placeholder="UOM" sx={{ width: 70 }} />
                          </TableCell>
                          <TableCell align="right">
                            <TextField size="small" type="number" value={item.qtyReturned} onChange={(e) => updateItem(index, 'qtyReturned', e.target.value)} inputProps={{ min: 0, step: 0.01 }} sx={{ width: 80 }} />
                          </TableCell>
                          <TableCell align="right">
                            <TextField size="small" type="number" value={item.qtyIssued} onChange={(e) => updateItem(index, 'qtyIssued', e.target.value)} inputProps={{ min: 0, max: inv ? getAvailableStock(item.inventoryItem) : undefined, step: 0.01 }} sx={{ width: 80 }} helperText={inv ? `Avail: ${getAvailableStock(item.inventoryItem)}` : ''} error={inv && (Number(item.qtyIssued) || 0) > getAvailableStock(item.inventoryItem)} />
                          </TableCell>
                          <TableCell align="right">
                            <TextField size="small" type="number" value={item.balanceQty} onChange={(e) => updateItem(index, 'balanceQty', e.target.value)} inputProps={{ min: 0, step: 0.01 }} sx={{ width: 80 }} />
                          </TableCell>
                          <TableCell><Checkbox checked={!!item.issuedFromNewStock} onChange={(e) => updateItem(index, 'issuedFromNewStock', e.target.checked)} size="small" /></TableCell>
                          <TableCell><Checkbox checked={!!item.issuedFromOldStock} onChange={(e) => updateItem(index, 'issuedFromOldStock', e.target.checked)} size="small" /></TableCell>
                          <TableCell sx={{ minWidth: 200 }}>
                            <LocationSelector
                              mainStoreId={formData.store || undefined}
                              value={{ subStore: item.subStore || '', rack: item.location?.rack || '', shelf: item.location?.shelf || '', bin: item.location?.bin || '' }}
                              onChange={(loc) => {
                                const newItems = [...formData.items];
                                newItems[index] = { ...newItems[index], subStore: loc.subStore, location: { rack: loc.rack, shelf: loc.shelf, bin: loc.bin } };
                                setFormData({ ...formData, items: newItems });
                              }}
                              disabled={!formData.store}
                              size="small"
                            />
                          </TableCell>
                          <TableCell><IconButton size="small" onClick={() => removeItem(index)} color="error"><CloseIcon fontSize="small" /></IconButton></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Notes" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} multiline rows={1} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setFormDialog({ open: false });
            processedIndentRef.current = null;
            window.history.replaceState({}, document.title);
          }}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={loading || !formData.project || (formData.issueType === 'customer' && !formData.customer) || !formData.items.some((i) => i.inventoryItem && (Number(i.qtyIssued) || 0) > 0)}>
            Create Store Issue Note
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog - Taj Residencia Store Issue Note layout */}
      <Dialog open={viewDialog.open} onClose={() => setViewDialog({ open: false, data: null })} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Store Issue Note - {viewDialog.data?.sinNumber || viewDialog.data?.issueNumber}</span>
          <Button startIcon={<PrintIcon />} size="small" onClick={() => window.print()}>Print</Button>
        </DialogTitle>
        <DialogContent>
          {viewLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
          {!viewLoading && viewDialog.data && (
            <Box id="sin-document" sx={{ pt: 1 }}>
              {/* Header: TAJ RESIDENCIA / LIVE YOUR DREAMS (left), Taj Residencia Store Issue Note (center), Doc metadata (right) */}
              <Grid container sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', pb: 2 }} alignItems="center">
                <Grid item xs={4}>
                  <Typography variant="h6" fontWeight="bold">TAJ RESIDENCIA</Typography>
                  <Typography variant="caption" color="textSecondary">LIVE YOUR DREAMS</Typography>
                </Grid>
                <Grid item xs={4} sx={{ textAlign: 'center' }}>
                  <Typography variant="h6" fontWeight="bold">Taj Residencia Store Issue Note</Typography>
                </Grid>
                <Grid item xs={4} sx={{ textAlign: 'right' }}>
                  <Typography variant="caption" color="textSecondary">Doc. No. PROC/STR/FRM-13</Typography>
                  <Typography variant="caption" display="block" color="textSecondary">Rev: 00 | Page: 1 of 1</Typography>
                </Grid>
              </Grid>
              {/* Two-column details: Left (SIN No., Issuing Location, Cost Center, Required For, Justification) | Right (Date, EPR No., Concerned Department) */}
              <Grid container spacing={3} sx={{ mb: 2 }}>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">SIN No.</Typography>
                  <Typography variant="body1" fontWeight="bold">{viewDialog.data.sinNumber || viewDialog.data.issueNumber || '—'}</Typography>
                  {viewDialog.data.issueType === 'customer' && (
                    <>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Issued To Customer</Typography>
                      <Typography variant="body2" fontWeight="bold">{viewDialog.data.customerName || '—'}</Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Stock From Project</Typography>
                      <Typography variant="body2">{viewDialog.data.project?.name || '—'}</Typography>
                    </>
                  )}
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Issuing Location</Typography>
                  <Typography variant="body2">{viewDialog.data.issuingLocation || '—'}</Typography>
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Cost Center</Typography>
                  <Typography variant="body2">{viewDialog.data.costCenterName || viewDialog.data.costCenter?.name || viewDialog.data.costCenterCode || '—'}</Typography>
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Required For</Typography>
                  <Typography variant="body2">{viewDialog.data.requiredFor || '—'}</Typography>
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Justification</Typography>
                  <Typography variant="body2">{viewDialog.data.justification || '—'}</Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="caption" color="textSecondary">Date</Typography>
                  <Typography variant="body2">{formatSINDate(viewDialog.data.issueDate)}</Typography>
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>EPR No.</Typography>
                  <Typography variant="body2">{viewDialog.data.eprNo || '—'}</Typography>
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 1 }}>Concerned Department</Typography>
                  <Typography variant="body2">{viewDialog.data.concernedDepartment || viewDialog.data.departmentName || departments.find(d => d.value === viewDialog.data.department)?.label || '—'}</Typography>
                </Grid>
              </Grid>
              {/* Items table: Sr.#, Item Code, Description of Material, UOM, Qty Returned, Qty Issued, Balance Qty, New Stock, Old Stock */}
              <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Sr. #</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Item Code</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Description of Material</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>UOM</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }} align="right">Qty Returned</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }} align="right">Qty Issued</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }} align="right">Balance Qty</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>New Stock</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Old Stock</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(viewDialog.data.items || []).map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{idx + 1}</TableCell>
                        <TableCell>{item.itemCode || '—'}</TableCell>
                        <TableCell>{item.itemName || '—'}</TableCell>
                        <TableCell>{item.unit || '—'}</TableCell>
                        <TableCell align="right">{item.qtyReturned ?? '—'}</TableCell>
                        <TableCell align="right">{item.qtyIssued ?? item.quantity ?? '—'}</TableCell>
                        <TableCell align="right">{item.balanceQty ?? '—'}</TableCell>
                        <TableCell>{item.issuedFromNewStock ? '✓' : '—'}</TableCell>
                        <TableCell>{item.issuedFromOldStock ? '✓' : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {/* Footer: Signatures (Returned By, Approved By, Issued By, Received By) */}
              <Divider sx={{ my: 2 }} />
              <Grid container spacing={2}>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="textSecondary">Returned By</Typography>
                  <Typography variant="body2" fontWeight="medium">{viewDialog.data.returnedByName || '—'}</Typography>
                  <Box sx={{ height: 32, border: '1px dashed', borderColor: 'divider', mt: 0.5 }} />
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="textSecondary">Approved By (for)</Typography>
                  <Typography variant="caption" color="textSecondary">Sign & Position (HOD)</Typography>
                  <Typography variant="body2" fontWeight="medium">{viewDialog.data.approvedByName || '—'}</Typography>
                  <Box sx={{ height: 32, border: '1px dashed', borderColor: 'divider', mt: 0.5 }} />
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="textSecondary">Issued By</Typography>
                  <Typography variant="caption" color="textSecondary">Store (Sign & Name)</Typography>
                  <Typography variant="body2" fontWeight="medium">{viewDialog.data.issuedByName || (viewDialog.data.issuedBy?.firstName && viewDialog.data.issuedBy?.lastName ? `${viewDialog.data.issuedBy.firstName} ${viewDialog.data.issuedBy.lastName}` : '—')}</Typography>
                  <Box sx={{ height: 32, border: '1px dashed', borderColor: 'divider', mt: 0.5 }} />
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="textSecondary">Received By</Typography>
                  <Typography variant="caption" color="textSecondary">(Sign & Name)</Typography>
                  <Typography variant="body2" fontWeight="medium">{viewDialog.data.receivedByName || '—'}</Typography>
                  <Box sx={{ height: 32, border: '1px dashed', borderColor: 'divider', mt: 0.5 }} />
                </Grid>
              </Grid>
              {/* Distributions */}
              <Box sx={{ mt: 3, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" fontWeight="bold" color="textSecondary">DISTRIBUTIONS</Typography>
                <Typography variant="caption" display="block">1. White Copy ......... Store</Typography>
                <Typography variant="caption" display="block">2. Yellow Copy ......... Originator</Typography>
                <Typography variant="caption" display="block">3. Pink Copy ........... Book Copy</Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialog({ open: false, data: null })}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GoodsIssue;
