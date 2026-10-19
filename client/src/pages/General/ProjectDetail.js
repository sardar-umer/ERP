import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import GanttChart from './GanttChart';
import ProjectInvoicesTab from './ProjectInvoicesTab';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, FormControl, Grid,
  IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Skeleton,
  Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Tabs, TextField, Tooltip, Typography, Collapse, InputAdornment, Autocomplete
} from '@mui/material';
import {
  Add as AddIcon, ArrowBack as BackIcon, Assignment as TaskIcon,
  AttachMoney as MoneyIcon, BarChart as ChartIcon, CheckCircle as CheckIcon,
  Construction as ConstructionIcon, Delete as DeleteIcon, Edit as EditIcon,
  ExpandLess, ExpandMore, FiberManualRecord as DotIcon, Flag as FlagIcon,
  PhotoCamera as PhotoIcon, Refresh as RefreshIcon, Search as SearchIcon,
  Warning as WarnIcon, ShoppingCart as POIcon, Receipt as InvoiceIcon,
  Visibility as ViewIcon, Engineering as ContractorIcon,
  AccountTree as TreeIcon
} from '@mui/icons-material';
import { usePagination } from '../../hooks/usePagination';
import TablePaginationWrapper from '../../components/TablePaginationWrapper';
import { Checkbox } from '@mui/material';
import dayjs from 'dayjs';
import { getImageUrl } from '../../utils/imageService';
import {
  getProjectById, updateProject, updateBudgetStatus, setLumpSumBudget, allocateBudgetToSubs,
  getBOQHeaders, createBOQHeader, updateBOQHeader, deleteBOQHeader, allocateBOQItem,
  getBOQ, addBOQItem, updateBOQItem, deleteBOQItem,
  updateBoqDiscount, batchAssignBOQContractor, getSuppliers,
  getTasks, createTask, updateTask, deleteTask,
  getExpenses, addExpense, updateExpense, deleteExpense,
  getDPRList, submitDPR, deleteDPR,
  addMilestone, updateMilestone, deleteMilestone,
  createPOFromBOQ, getProjectPurchaseOrders,
  generateMilestoneInvoice
} from '../../services/projectManagementService';
import api from '../../services/api';

// ─── Constants ────────────────────────────────────────────────────────────────
/** Segregated budget groups for Sub project category allocation */
const BUDGET_CATEGORY_GROUPS = [
  {
    id: 'works',
    title: 'Construction Works',
    subtitle: 'Civil, finishes, materials & labor',
    accent: '#1d4ed8',
    categories: ['Civil Works', 'Finishes', 'Materials', 'Labor']
  },
  {
    id: 'mep',
    title: 'MEP & Utilities',
    subtitle: 'Electrical, plumbing, HVAC & networks',
    accent: '#0f766e',
    categories: ['Electrical', 'Plumbing', 'HVAC System', 'Sewerage', 'Water Supply & Gas']
  },
  {
    id: 'soft',
    title: 'Soft Costs & Contingency',
    subtitle: 'Consultancy, contingency and other',
    accent: '#b45309',
    categories: ['Consultancy', 'Contingency', 'Miscellaneous']
  }
];

const BUDGET_CATEGORIES = BUDGET_CATEGORY_GROUPS.flatMap((g) => g.categories);

const STATUS_COLOR = {
  Draft: 'default', Planning: 'info', Active: 'success',
  'On Hold': 'warning', Completed: 'primary', Cancelled: 'error'
};

const TASK_STATUS_COLOR = {
  'Not Started': 'default', 'In Progress': 'info',
  Completed: 'success', 'On Hold': 'warning', Cancelled: 'error'
};

const MS_STATUS_COLOR = {
  Pending: 'default', 'In Progress': 'info', Completed: 'success', Delayed: 'error'
};

/** Main projects only show portfolio tabs; Subs get the full execution suite. */
const ALL_TABS = [
  { id: 'overview', label: 'Overview', icon: <ViewIcon fontSize="small" />, onMain: true, onSub: true },
  { id: 'boq', label: 'Bill of Quantities', icon: <POIcon fontSize="small" />, onMain: true, onSub: true },
  { id: 'tasks', label: 'Tasks / WBS', icon: <TaskIcon fontSize="small" />, onMain: false, onSub: true },
  { id: 'expenses', label: 'Expenses', icon: <MoneyIcon fontSize="small" />, onMain: false, onSub: true },
  { id: 'dpr', label: 'Daily Reports', icon: <PhotoIcon fontSize="small" />, onMain: false, onSub: true },
  { id: 'gantt', label: 'Gantt Chart', icon: <ChartIcon fontSize="small" />, onMain: false, onSub: true },
  { id: 'invoices', label: 'Invoices', icon: <InvoiceIcon fontSize="small" />, onMain: false, onSub: true }
];

const getVisibleTabs = (isMain) => ALL_TABS.filter((t) => (isMain ? t.onMain : t.onSub));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })
    .format(Number(v || 0));

const boqTitle = (i) => String(i?.title || '').trim() || String(i?.description || '').split(/\r?\n/)[0]?.trim() || '—';
const boqEstTotal = (i) => (Number(i?.estimatedQuantity) || 0) * (Number(i?.estimatedUnitPrice) || 0) || Number(i?.estimatedTotalCost) || 0;
const boqDiscTotal = (i) => {
  const est = boqEstTotal(i);
  return est >= 0 ? Math.min(Math.max(0, Number(i?.discountAmount) || 0), est) : 0;
};
const boqNetTotal = (i) => Number(i?.netEstimatedCost) || (boqEstTotal(i) - boqDiscTotal(i));
const boqActTotal = (i) => (Number(i?.usedQuantity) || 0) * (Number(i?.actualUnitPrice) || 0) || Number(i?.actualTotalCost) || 0;

const pct = (spent, total) =>
  total > 0 ? Math.min(Math.round((spent / total) * 100), 100) : 0;

// ─── Mini components ──────────────────────────────────────────────────────────
const SectionHeader = ({ title, action }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
    <Typography variant="h6" fontWeight={600}>{title}</Typography>
    {action}
  </Stack>
);

const EmptyState = ({ icon: Icon, text, action }) => (
  <Box textAlign="center" py={4}>
    {Icon && <Icon sx={{ fontSize: 48, color: 'grey.300', mb: 1 }} />}
    <Typography color="text.secondary">{text}</Typography>
    {action && <Box mt={2}>{action}</Box>}
  </Box>
);

// ─── BOQ Tab ─────────────────────────────────────────────────────────────────
const BOQTab = ({ projectId, project }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', unit: '', estimatedQuantity: '', estimatedUnitPrice: '', discountAmount: '',
    phase: 'General', category: '', specification: '', notes: '', contractor: '', contractorUnitPrice: '', boqHeader: ''
  });

  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // BOQ Document Header Containers state
  const [boqHeaders, setBoqHeaders] = useState([]);
  const [activeBoqHeaderId, setActiveBoqHeaderId] = useState('');
  const [createHeaderOpen, setCreateHeaderOpen] = useState(false);
  const [headerForm, setHeaderForm] = useState({ title: '', description: '', version: '1.0', notes: '' });
  const [headerSaving, setHeaderSaving] = useState(false);

  // Quantity Allocation state
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [allocatingItem, setAllocatingItem] = useState(null);
  const [allocForm, setAllocForm] = useState({ subProjectId: '', contractorId: '', allocatedQuantity: '', contractorUnitPrice: '', notes: '' });
  const [allocSaving, setAllocSaving] = useState(false);

  // Subcontractor & Sub-Project batch assignment state
  const [subcontractors, setSubcontractors] = useState([]);
  const [childProjects, setChildProjects] = useState([]);
  const [batchAssignOpen, setBatchAssignOpen] = useState(false);
  const [batchContractorId, setBatchContractorId] = useState('');
  const [batchSubProjectId, setBatchSubProjectId] = useState('');
  const [batchContractorUnitPrice, setBatchContractorUnitPrice] = useState('');
  const [batchAssignSaving, setBatchAssignSaving] = useState(false);

  const pagination = usePagination({
    defaultRowsPerPage: 25,
    resetDependencies: [searchDebounced, phaseFilter, categoryFilter, activeBoqHeaderId]
  });

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // PO creation state — Map preserves item details across pages
  const [selectedItems, setSelectedItems] = useState(new Map());
  const [poDialogOpen, setPoDialogOpen] = useState(false);
  const [poSaving, setPoSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [poItems, setPoItems] = useState([]);
  const [poForm, setPoForm] = useState({ vendorId: '', expectedDeliveryDate: '', deliveryAddress: '', notes: '' });

  // POs already created for this project
  const [projectPOs, setProjectPOs] = useState([]);
  const [wholeDiscount, setWholeDiscount] = useState('');
  const [wholeDiscountSaving, setWholeDiscountSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        ...pagination.getApiParams(),
        ...(searchDebounced && { search: searchDebounced }),
        ...(phaseFilter && { phase: phaseFilter }),
        ...(categoryFilter && { category: categoryFilter }),
        ...(activeBoqHeaderId && { boqHeaderId: activeBoqHeaderId })
      };
      const [boqRes, headersRes, posRes, suppRes, projRes] = await Promise.all([
        getBOQ(projectId, params),
        getBOQHeaders(projectId).catch(() => ({ data: { data: [] } })),
        getProjectPurchaseOrders(projectId).catch(() => ({ data: { data: [] } })),
        getSuppliers().catch(() => ({ data: { data: [] } })),
        api.get('/project-management/projects', { params: { limit: 100 } }).catch(() => ({ data: { data: { projects: [] } } }))
      ]);
      setData(boqRes.data?.data ?? null);
      setBoqHeaders(headersRes.data?.data || []);
      setWholeDiscount(String(boqRes.data?.data?.boqDiscountAmount ?? ''));
      pagination.setTotal(boqRes.data?.data?.pagination?.total || 0);
      setProjectPOs(posRes.data?.data || []);
      setSubcontractors(suppRes.data?.data?.suppliers || suppRes.data?.data || []);

      const allProjects = projRes.data?.data?.projects || projRes.data?.data || [];
      const subProjs = allProjects.filter(p => String(p.parentProject?._id || p.parentProject) === String(projectId));
      setChildProjects(subProjs);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load BOQ');
    } finally { setLoading(false); }
  }, [projectId, pagination.page, pagination.rowsPerPage, searchDebounced, phaseFilter, categoryFilter, activeBoqHeaderId]);

  useEffect(() => { load(); }, [load]);

  const toggleSelectItem = (item) => {
    setSelectedItems(prev => {
      const next = new Map(prev);
      if (next.has(item._id)) next.delete(item._id);
      else next.set(item._id, item);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setPhaseFilter('');
    setCategoryFilter('');
  };

  const openCreatePO = async () => {
    if (!selectedItems.size) return;
    setVendorsLoading(true);
    setPoDialogOpen(true);
    try {
      const res = await api.get('/procurement/vendors', { params: { status: 'Active', limit: 500 } });
      setVendors(res.data?.data?.suppliers || res.data?.data || []);
    } catch { /* leave empty */ }
    finally { setVendorsLoading(false); }

    setPoItems(
      [...selectedItems.values()].map(i => ({
        boqItemId: i._id,
        description: i.title || i.description,
        unit: i.unit,
        quantity: Math.max(0, (i.estimatedQuantity || 0) - (i.orderedQuantity || 0)),
        unitPrice: i.estimatedUnitPrice || 0,
        taxRate: 0,
        specification: i.specification || ''
      }))
    );
    setPoForm({ vendorId: '', expectedDeliveryDate: '', deliveryAddress: '', notes: '' });
  };

  const setPoItemField = (idx, field) => (e) => {
    setPoItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: e.target.value };
      return next;
    });
  };

  const handleSubmitPO = async () => {
    if (!poForm.vendorId) { setError('Please select a vendor'); return; }
    if (!poForm.expectedDeliveryDate) { setError('Please set expected delivery date'); return; }
    if (poItems.some(i => !i.quantity || Number(i.quantity) <= 0)) {
      setError('All items must have a quantity greater than 0'); return;
    }
    setPoSaving(true); setError('');
    try {
      const res = await createPOFromBOQ(projectId, {
        vendorId: poForm.vendorId,
        expectedDeliveryDate: poForm.expectedDeliveryDate,
        deliveryAddress: poForm.deliveryAddress,
        notes: poForm.notes,
        items: poItems.map(i => ({
          boqItemId: i.boqItemId,
          description: i.description,
          unit: i.unit,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          taxRate: Number(i.taxRate) || 0,
          specification: i.specification
        }))
      });
      setSuccess(`Purchase Order ${res.data?.data?.orderNumber || ''} created successfully`);
      setPoDialogOpen(false);
      setSelectedItems(new Map());
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create PO');
    } finally { setPoSaving(false); }
  };

  const handleBatchAssign = async () => {
    if (!batchContractorId && !batchSubProjectId) { setError('Please select a subcontractor or sub-project'); return; }
    setBatchAssignSaving(true);
    try {
      await batchAssignBOQContractor(projectId, {
        itemIds: Array.from(selectedItems.keys()),
        contractorId: batchContractorId,
        subProjectId: batchSubProjectId,
        contractorUnitPrice: batchContractorUnitPrice
      });
      setSuccess(`${selectedItems.size} BOQ items assigned successfully`);
      setBatchAssignOpen(false);
      setSelectedItems(new Map());
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign contractor');
    } finally { setBatchAssignSaving(false); }
  };

  const handleCreateHeader = async () => {
    if (!headerForm.title) { setError('BOQ Document Title is required'); return; }
    setHeaderSaving(true);
    try {
      const res = await createBOQHeader(projectId, headerForm);
      setSuccess(`BOQ Document "${res.data?.data?.title}" created successfully`);
      setCreateHeaderOpen(false);
      setHeaderForm({ title: '', description: '', version: '1.0', notes: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create BOQ document');
    } finally { setHeaderSaving(false); }
  };

  const openAllocateModal = (item) => {
    setAllocatingItem(item);
    setAllocForm({
      itemId: item._id,
      subProjectId: item.subProject?._id || item.subProject || '',
      contractorId: item.contractor?._id || item.contractor || '',
      allocatedQuantity: item.estimatedQuantity || '',
      contractorUnitPrice: item.contractorUnitPrice || item.estimatedUnitPrice || '',
      notes: ''
    });
    setAllocateOpen(true);
  };

  const handleSaveAllocation = async () => {
    if (!allocForm.allocatedQuantity || Number(allocForm.allocatedQuantity) <= 0) {
      setError('Allocated quantity is required'); return;
    }
    setAllocSaving(true);
    try {
      await allocateBOQItem(projectId, allocForm);
      setSuccess('Item quantity allocated to sub-project / contractor');
      setAllocateOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to allocate quantity');
    } finally { setAllocSaving(false); }
  };

  const openAdd = () => {
    setEditItem(null);
    setForm({ title: '', description: '', unit: '', estimatedQuantity: '', estimatedUnitPrice: '', discountAmount: '', phase: 'General', category: '', specification: '', notes: '', contractor: '', contractorUnitPrice: '', boqHeader: activeBoqHeaderId });
    setDialogOpen(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({
      title: item.title || '',
      description: item.description, unit: item.unit,
      estimatedQuantity: item.estimatedQuantity, estimatedUnitPrice: item.estimatedUnitPrice,
      discountAmount: (item.discountAmount && item.discountAmount > 0) ? item.discountAmount : '',
      phase: item.phase || 'General', category: item.category || '',
      specification: item.specification || '', notes: item.notes || '',
      usedQuantity: item.usedQuantity || '', actualUnitPrice: item.actualUnitPrice || '',
      contractor: item.contractor?._id || item.contractor || '',
      contractorUnitPrice: item.contractorUnitPrice || '',
      boqHeader: item.boqHeader?._id || item.boqHeader || ''
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const desc = form.description || form.title;
    if (!desc) { setError('Item Title / Description is required'); return; }
    const payload = {
      ...form,
      title: form.title || desc,
      description: desc
    };
    setSaving(true); setError('');
    try {
      if (editItem) {
        await updateBOQItem(projectId, editItem._id, payload);
      } else {
        await addBOQItem(projectId, payload);
      }
      setSuccess(editItem ? 'Item updated' : 'BOQ Item added successfully');
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save item');
    } finally { setSaving(false); }
  };

  const handleDelete = async (itemId) => {
    if (!window.confirm('Delete this BOQ item?')) return;
    try {
      await deleteBOQItem(projectId, itemId);
      setSuccess('Item deleted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete');
    }
  };

  const handleSaveWholeDiscount = async () => {
    setWholeDiscountSaving(true);
    setError('');
    try {
      const res = await updateBoqDiscount(projectId, Number(wholeDiscount) || 0);
      const payload = res.data?.data;
      setData((prev) => (prev ? { ...prev, ...payload } : prev));
      setWholeDiscount(String(payload?.boqDiscountAmount ?? ''));
      setSuccess('Whole BOQ discount saved');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save BOQ discount');
    } finally {
      setWholeDiscountSaving(false);
    }
  };

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const items = data?.items || [];
  const poTotal = poItems.reduce((s, i) => s + (Number(i.quantity) * Number(i.unitPrice)), 0);
  const phaseOptions = data?.phases?.length ? data.phases : ['General'];
  const totalEst = Number(data?.totalEstimated) || 0;
  const itemDisc = Number(data?.totalDiscount) || 0;
  const boqDisc = Number(data?.boqDiscountAmount) || 0;
  const netEst = Number(data?.netEstimated) || 0;
  const totalAct = Number(data?.totalActual) || 0;

  const PO_STATUS_COLOR = { Draft: 'default', Approved: 'success', Ordered: 'primary', 'Partially Received': 'info', Received: 'success', Cancelled: 'error' };

  const isSubProject = Boolean(project?.parentProject);

  return (
    <Box>
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {isSubProject && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>Sub-Project Scope View:</strong> Master BOQ Documents are created and managed at the Main Portfolio Project level. Below are the specific BOQ item scope allocations assigned from the Main Portfolio Project to this Sub-Project.
        </Alert>
      )}

      <SectionHeader
        title={`Bill of Quantities${selectedItems.size ? ` — ${selectedItems.size} selected` : ''}`}
        action={
          <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="flex-end">
            {selectedItems.size > 0 && (
              <>
                <Button size="small" startIcon={<ContractorIcon />} onClick={() => { setBatchContractorId(''); setBatchContractorUnitPrice(''); setBatchAssignOpen(true); }} variant="contained" color="secondary">
                  Assign Subcontractor ({selectedItems.size})
                </Button>
                <Button size="small" startIcon={<POIcon />} onClick={openCreatePO} variant="outlined" color="secondary">
                  Create PO ({selectedItems.size})
                </Button>
              </>
            )}
            <Button size="small" startIcon={<RefreshIcon />} onClick={load} variant="outlined">Refresh</Button>
            {!isSubProject && (
              <Button size="small" startIcon={<AddIcon />} onClick={openAdd} variant="contained">Add Line Item</Button>
            )}
          </Stack>
        }
      />

      {/* BOQ Document Containers Dropdown Bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2.5, borderRadius: 2, bgcolor: '#ffffff', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'text.primary', minWidth: 120 }}>
              BOQ Document:
            </Typography>
            <FormControl size="small" sx={{ minWidth: 320 }}>
              <Select
                value={activeBoqHeaderId || ''}
                displayEmpty
                onChange={(e) => setActiveBoqHeaderId(e.target.value)}
                sx={{ borderRadius: 1.5, fontWeight: activeBoqHeaderId ? 600 : 400, bgcolor: 'grey.50' }}
              >
                <MenuItem value="">
                  <em>📁 All BOQ Documents (Master Project)</em>
                </MenuItem>
                {boqHeaders.map((h) => (
                  <MenuItem key={h._id} value={h._id}>
                    📄 {h.title} ({h.boqNumber || 'v1'})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {!isSubProject && (
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setCreateHeaderOpen(true)}
                variant="outlined"
                color="primary"
                sx={{ borderRadius: 1.5 }}
              >
                New BOQ Document
              </Button>
            )}

            {activeBoqHeaderId && !isSubProject && (
              <IconButton
                size="small"
                color="error"
                title="Delete Selected BOQ Document"
                onClick={async () => {
                  const targetHeader = boqHeaders.find(h => h._id === activeBoqHeaderId);
                  if (window.confirm(`Delete BOQ Document "${targetHeader?.title}" and its linked line items?`)) {
                    await deleteBOQHeader(projectId, activeBoqHeaderId);
                    setSuccess('BOQ Document deleted');
                    setActiveBoqHeaderId('');
                    load();
                  }
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>

          {activeBoqHeaderId && (() => {
            const activeDoc = boqHeaders.find(h => h._id === activeBoqHeaderId);
            return activeDoc ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                Version: {activeDoc.version || '1.0'} {activeDoc.description ? `• ${activeDoc.description}` : ''}
              </Typography>
            ) : null;
          })()}
        </Stack>
      </Paper>

      {activeBoqHeaderId && (() => {
        const activeDoc = boqHeaders.find(h => h._id === activeBoqHeaderId);
        return activeDoc ? (
          <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight={700}>
              📄 Active BOQ Document Scope: {activeDoc.title} ({activeDoc.boqNumber || 'v1.0'})
            </Typography>
            {activeDoc.description && (
              <Typography variant="body2" sx={{ mt: 0.5 }}>{activeDoc.description}</Typography>
            )}
            {activeDoc.notes && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Notes: {activeDoc.notes}
              </Typography>
            )}
          </Alert>
        ) : null;
      })()}

      {data?.allItemsCount > 0 && (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {[
              { label: 'Gross Total', val: totalEst, color: 'text.primary' },
              { label: 'Item Discount', val: itemDisc, color: 'success.main' },
              { label: 'BOQ Discount', val: boqDisc, color: 'success.main' },
              { label: 'Net Cost', val: netEst, color: 'primary.main' },
              { label: 'Actual Total', val: totalAct, color: 'warning.main' },
              { label: 'Variance', val: totalAct - netEst, color: totalAct > netEst ? 'error.main' : 'success.main' }
            ].map(({ label, val, color }) => (
              <Grid item xs={6} sm={4} md={2} key={label}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="h6" fontWeight={600} color={color}>{fmt(val)}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 3 }}>
            <TextField
              size="small"
              type="number"
              label="Whole BOQ discount (PKR)"
              value={wholeDiscount}
              onChange={(e) => setWholeDiscount(e.target.value)}
              inputProps={{ min: 0 }}
              sx={{ maxWidth: 280 }}
            />
            <Button variant="outlined" onClick={handleSaveWholeDiscount} disabled={wholeDiscountSaving}>
              {wholeDiscountSaving ? 'Saving…' : 'Save BOQ discount'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Applied on top of item discounts across the full BOQ
            </Typography>
          </Stack>
        </>
      )}

      {/* Search & filters */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={5}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search title, description, spec, code, unit…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  )
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Phase</InputLabel>
                <Select value={phaseFilter} label="Phase" onChange={(e) => setPhaseFilter(e.target.value)}>
                  <MenuItem value="">All Phases</MenuItem>
                  {phaseOptions.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Category</InputLabel>
                <Select value={categoryFilter} label="Category" onChange={(e) => setCategoryFilter(e.target.value)}>
                  <MenuItem value="">All Categories</MenuItem>
                  {BUDGET_CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={1}>
              <Button fullWidth size="small" variant="outlined" onClick={clearFilters}>Clear</Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton height={300} />
      ) : !data?.allItemsCount ? (
        <EmptyState icon={ChartIcon} text="No BOQ items added yet"
          action={<Button variant="outlined" startIcon={<AddIcon />} onClick={openAdd}>Add First Item</Button>} />
      ) : !items.length ? (
        <EmptyState icon={ChartIcon} text="No BOQ items match your filters"
          action={<Button variant="outlined" onClick={clearFilters}>Clear Filters</Button>} />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell padding="checkbox" />
                <TableCell width={56}><strong>Sr No</strong></TableCell>
                <TableCell><strong>Title</strong></TableCell>
                <TableCell><strong>Phase</strong></TableCell>
                <TableCell><strong>Category</strong></TableCell>
                <TableCell><strong>Subcontractor</strong></TableCell>
                <TableCell><strong>Description</strong></TableCell>
                <TableCell><strong>Unit</strong></TableCell>
                <TableCell align="right"><strong>Est. Qty</strong></TableCell>
                <TableCell align="right"><strong>Allocated / Rem.</strong></TableCell>
                <TableCell align="right"><strong>Est. Price</strong></TableCell>
                <TableCell align="right"><strong>Gross</strong></TableCell>
                <TableCell align="right"><strong>Discount</strong></TableCell>
                <TableCell align="right"><strong>Net Cost</strong></TableCell>
                <TableCell align="right"><strong>Ordered</strong></TableCell>
                <TableCell align="right"><strong>Used</strong></TableCell>
                <TableCell align="right"><strong>Variance</strong></TableCell>
                <TableCell align="center"><strong>Fulfillment %</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={item._id} hover selected={selectedItems.has(item._id)}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selectedItems.has(item._id)}
                      onChange={() => toggleSelectItem(item)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {pagination.page * pagination.rowsPerPage + idx + 1}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{boqTitle(item)}</Typography>
                    {item.boqHeader?.title && (
                      <Chip
                        label={`📄 ${item.boqHeader.title}`}
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ mt: 0.5, fontSize: '0.65rem', height: 18 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={item.phase || 'General'} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {item.category
                      ? <Chip label={item.category} size="small" variant="outlined" />
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {item.contractor || item.subProject ? (
                      <Stack spacing={0.5}>
                        {item.contractor && <Chip label={item.contractor.name || 'Subcontractor'} size="small" color="info" variant="outlined" />}
                        {item.subProject && <Chip label={`Sub-Proj: ${item.subProject.name || item.subProject.projectNumber}`} size="small" color="primary" variant="outlined" />}
                        {item.contractorUnitPrice > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            Rate: {fmt(item.contractorUnitPrice)}
                          </Typography>
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">Unassigned</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{item.description}</Typography>
                    {item.specification && <Typography variant="caption" color="text.secondary">{item.specification}</Typography>}
                    {item.linkedPurchaseOrders?.length > 0 && (
                      <Chip size="small" icon={<POIcon />} label={`${item.linkedPurchaseOrders.length} PO`} variant="outlined" color="info" sx={{ mt: 0.5, fontSize: '0.65rem', height: 18 }} />
                    )}
                  </TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell align="right">{item.estimatedQuantity?.toLocaleString()}</TableCell>
                  <TableCell align="right">
                    {(() => {
                      const masterQty = Number(item.estimatedQuantity) || 0;
                      const allocQty = (item.allocations || []).reduce((s, a) => s + (Number(a.allocatedQuantity) || 0), 0);
                      const remaining = Math.max(0, masterQty - allocQty);
                      return (
                        <Stack spacing={0.2} alignItems="flex-end">
                          <Typography variant="body2" fontWeight={600} color={allocQty > 0 ? 'primary.main' : 'text.secondary'}>
                            {allocQty.toLocaleString()} / {masterQty.toLocaleString()}
                          </Typography>
                          <Chip
                            size="small"
                            label={remaining > 0 ? `${remaining.toLocaleString()} ${item.unit} Rem.` : 'Fully Allocated'}
                            color={remaining > 0 ? (allocQty > 0 ? 'info' : 'success') : 'default'}
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.65rem' }}
                          />
                        </Stack>
                      );
                    })()}
                  </TableCell>
                  <TableCell align="right">{fmt(item.estimatedUnitPrice)}</TableCell>
                  <TableCell align="right">{fmt(boqEstTotal(item))}</TableCell>
                  <TableCell align="right">
                    {boqDiscTotal(item) > 0
                      ? <Typography variant="body2" color="success.main">−{fmt(boqDiscTotal(item))}</Typography>
                      : '—'}
                  </TableCell>
                  <TableCell align="right"><strong>{fmt(boqNetTotal(item))}</strong></TableCell>
                  <TableCell align="right">
                    {item.orderedQuantity > 0
                      ? <Typography variant="body2" color="info.main">{item.orderedQuantity?.toLocaleString()}</Typography>
                      : '—'}
                  </TableCell>
                  <TableCell align="right">{item.usedQuantity?.toLocaleString() || '—'}</TableCell>
                  <TableCell align="right">
                    {(() => {
                      const variance = boqActTotal(item) - boqNetTotal(item);
                      return variance !== 0 ? (
                        <Typography variant="body2" color={variance > 0 ? 'error.main' : 'success.main'}>
                          {variance > 0 ? '+' : ''}{fmt(variance)}
                        </Typography>
                      ) : '—';
                    })()}
                  </TableCell>
                  <TableCell align="center">
                    {(() => {
                      const estQty = Number(item.estimatedQuantity) || 1;
                      const fulfillmentPct = Math.min(100, Math.round(((item.usedQuantity || 0) / estQty) * 100));
                      return (
                        <Stack spacing={0.5} alignItems="center">
                          <Typography variant="caption" fontWeight={600}>{fulfillmentPct}%</Typography>
                          <LinearProgress
                            variant="determinate"
                            value={fulfillmentPct}
                            color={fulfillmentPct >= 90 ? 'success' : fulfillmentPct >= 40 ? 'info' : 'warning'}
                            sx={{ width: 65, height: 4, borderRadius: 2 }}
                          />
                        </Stack>
                      );
                    })()}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title="Allocate Quantity to Sub-Project / Contractor">
                        <IconButton size="small" color="secondary" onClick={() => openAllocateModal(item)}>
                          <ContractorIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="View Details">
                        <IconButton size="small" onClick={() => setViewItem(item)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" onClick={() => openEdit(item)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(item._id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePaginationWrapper
            page={pagination.page}
            rowsPerPage={pagination.rowsPerPage}
            total={pagination.total}
            onPageChange={pagination.handleChangePage}
            onRowsPerPageChange={pagination.handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </TableContainer>
      )}

      {/* Purchase Orders linked to this project */}
      {projectPOs.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>Linked Purchase Orders</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><strong>PO Number</strong></TableCell>
                  <TableCell><strong>Vendor</strong></TableCell>
                  <TableCell><strong>Status</strong></TableCell>
                  <TableCell align="right"><strong>Total</strong></TableCell>
                  <TableCell><strong>Expected Delivery</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {projectPOs.map(po => (
                  <TableRow key={po._id} hover>
                    <TableCell><Typography variant="body2" fontWeight={600}>{po.orderNumber}</Typography></TableCell>
                    <TableCell>{po.vendor?.name || '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" label={po.status} color={PO_STATUS_COLOR[po.status] || 'default'} />
                    </TableCell>
                    <TableCell align="right">{fmt(po.totalAmount)}</TableCell>
                    <TableCell>{po.expectedDeliveryDate ? dayjs(po.expectedDeliveryDate).format('DD MMM YYYY') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Add/Edit BOQ Item Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editItem ? 'Edit BOQ Item' : 'Add BOQ Item'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField fullWidth label="Title" value={form.title} onChange={set('title')} placeholder="Short name e.g. Inner Ceiling Paint" />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                label="Description"
                value={form.description}
                onChange={set('description')}
                onBlur={() => {
                  if (!form.title?.trim() && form.description?.trim()) {
                    setForm((prev) => ({ ...prev, title: prev.description.split(/\r?\n/)[0]?.trim() || '' }));
                  }
                }}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Phase" value={form.phase} onChange={set('phase')} />
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select value={form.category} label="Category" onChange={set('category')}>
                  <MenuItem value="">None</MenuItem>
                  {BUDGET_CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>CBS Category</InputLabel>
                <Select value={form.cbsCategory || 'Materials'} label="CBS Category" onChange={set('cbsCategory')}>
                  {['Materials', 'Labor', 'Equipment', 'Subcontractor', 'Contingency', 'Other'].map(c => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {boqHeaders.length > 0 && (
              <Grid item xs={12}>
                <FormControl fullWidth size="small">
                  <InputLabel>BOQ Document Container</InputLabel>
                  <Select value={form.boqHeader || ''} label="BOQ Document Container" onChange={set('boqHeader')}>
                    <MenuItem value="">-- General Master BOQ --</MenuItem>
                    {boqHeaders.map(h => <MenuItem key={h._id} value={h._id}>{h.title} ({h.boqNumber || 'v1'})</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}

            <Grid item xs={6}>
              <Autocomplete
                options={subcontractors}
                getOptionLabel={(option) => {
                  if (typeof option === 'string') return option;
                  if (!option) return '';
                  const idStr = option.supplierId ? ` (${option.supplierId})` : '';
                  const catStr = option.vendorCategory ? ` - [${option.vendorCategory}]` : '';
                  return `${option.name || ''}${idStr}${catStr}`;
                }}
                value={subcontractors.find(s => String(s._id) === String(form.contractor)) || null}
                onChange={(event, newValue) => {
                  setForm(p => ({ ...p, contractor: newValue ? newValue._id : '' }));
                }}
                isOptionEqualToValue={(option, value) => String(option._id) === String(value._id || value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Assigned Subcontractor"
                    size="small"
                    placeholder="Search subcontractor..."
                  />
                )}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth size="small" label="Contractor Agreed Rate (PKR)" type="number" value={form.contractorUnitPrice || ''} onChange={set('contractorUnitPrice')} inputProps={{ min: 0 }} />
            </Grid>
            <Grid item xs={4}>
              <TextField fullWidth label="Unit" required value={form.unit} onChange={set('unit')} placeholder="Bags, Kg, Sq Ft…" />
            </Grid>
            <Grid item xs={4}>
              <TextField fullWidth label="Est. Quantity" type="number" required value={form.estimatedQuantity} onChange={set('estimatedQuantity')} />
            </Grid>
            <Grid item xs={4}>
              <TextField fullWidth label="Est. Unit Price" type="number" required value={form.estimatedUnitPrice} onChange={set('estimatedUnitPrice')} />
            </Grid>
            <Grid item xs={4}>
              <TextField fullWidth label="Discount (PKR)" type="number" value={form.discountAmount} onChange={set('discountAmount')} inputProps={{ min: 0 }} />
            </Grid>
            {(form.estimatedQuantity && form.estimatedUnitPrice) && (
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary">
                  Net cost: {fmt((() => {
                    const est = (Number(form.estimatedQuantity) || 0) * (Number(form.estimatedUnitPrice) || 0);
                    const disc = est >= 0 ? Math.min(Math.max(0, Number(form.discountAmount) || 0), est) : 0;
                    return est - disc;
                  })())}
                </Typography>
              </Grid>
            )}
            {editItem && (
              <>
                <Grid item xs={4}>
                  <TextField fullWidth label="Used Quantity" type="number" value={form.usedQuantity} onChange={set('usedQuantity')} />
                </Grid>
                <Grid item xs={4}>
                  <TextField fullWidth label="Actual Unit Price" type="number" value={form.actualUnitPrice} onChange={set('actualUnitPrice')} />
                </Grid>
              </>
            )}
            <Grid item xs={12}>
              <TextField fullWidth label="Specification / Notes" value={form.specification || form.notes} onChange={set('specification')} multiline rows={2} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editItem ? 'Update' : 'Add Item'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create New BOQ Document Header Dialog */}
      <Dialog open={createHeaderOpen} onClose={() => setCreateHeaderOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Create New BOQ Document</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth required label="BOQ Document Title"
                placeholder="e.g. Civil Works BOQ, MEP BOQ, Substructure v1"
                value={headerForm.title}
                onChange={e => setHeaderForm(p => ({ ...p, title: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth label="Version"
                value={headerForm.version}
                onChange={e => setHeaderForm(p => ({ ...p, version: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth label="Description / Scope Summary"
                multiline rows={2}
                value={headerForm.description}
                onChange={e => setHeaderForm(p => ({ ...p, description: e.target.value }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateHeaderOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateHeader} disabled={headerSaving}>
            {headerSaving ? 'Creating…' : 'Create BOQ Document'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Quantity Allocation Dialog */}
      <Dialog open={allocateOpen} onClose={() => setAllocateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Allocate Quantity to Sub-Project / Subcontractor</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {allocatingItem && (() => {
            const masterQty = Number(allocatingItem.estimatedQuantity) || 0;
            const allocTotal = (allocatingItem.allocations || []).reduce((s, a) => s + (Number(a.allocatedQuantity) || 0), 0);
            const remaining = Math.max(0, masterQty - allocTotal);
            return (
              <Box sx={{ mb: 2.5 }}>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                    Item: {allocatingItem.title || allocatingItem.description}
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Master Quantity</Typography>
                      <Typography variant="body1" fontWeight={700}>{masterQty.toLocaleString()} {allocatingItem.unit}</Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Allocated Quantity</Typography>
                      <Typography variant="body1" fontWeight={700} color="primary.main">{allocTotal.toLocaleString()} {allocatingItem.unit}</Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography variant="caption" color="text.secondary">Remaining Unallocated</Typography>
                      <Typography variant="body1" fontWeight={700} color={remaining > 0 ? 'success.main' : 'error.main'}>
                        {remaining.toLocaleString()} {allocatingItem.unit}
                      </Typography>
                    </Grid>
                  </Grid>
                </Paper>

                {/* Existing Allocations Table */}
                {(allocatingItem.allocations || []).length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Existing Allocations ({allocatingItem.allocations.length})
                    </Typography>
                    <Paper variant="outlined" sx={{ mt: 1, maxHeight: 160, overflowY: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ bgcolor: 'grey.100' }}>
                            <TableCell>Sub-Project</TableCell>
                            <TableCell>Contractor</TableCell>
                            <TableCell align="right">Qty ({allocatingItem.unit})</TableCell>
                            <TableCell align="right">Rate (PKR)</TableCell>
                            <TableCell align="right">Action</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {allocatingItem.allocations.map((alloc) => (
                            <TableRow key={alloc._id}>
                              <TableCell>{alloc.subProject?.name || alloc.subProject?.projectNumber || 'All / Main'}</TableCell>
                              <TableCell>{alloc.contractor?.name || '—'}</TableCell>
                              <TableCell align="right"><strong>{alloc.allocatedQuantity?.toLocaleString()}</strong></TableCell>
                              <TableCell align="right">{fmt(alloc.contractorUnitPrice)}</TableCell>
                              <TableCell align="right">
                                <IconButton
                                  size="small" color="error"
                                  title="Remove Allocation"
                                  onClick={async () => {
                                    if (window.confirm('Remove this allocation?')) {
                                      try {
                                        await api.delete(`/project-management/projects/${projectId}/boq/allocate/${allocatingItem._id}/${alloc._id}`);
                                        setSuccess('Allocation removed');
                                        setAllocateOpen(false);
                                        load();
                                      } catch (err) {
                                        setError(err.response?.data?.message || 'Failed to remove allocation');
                                      }
                                    }
                                  }}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Paper>
                  </Box>
                )}
              </Box>
            );
          })()}

          <Grid container spacing={2}>
            {childProjects.length > 0 && (
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Target Sub-Project</InputLabel>
                  <Select
                    value={allocForm.subProjectId}
                    label="Target Sub-Project"
                    onChange={e => setAllocForm(p => ({ ...p, subProjectId: e.target.value }))}
                  >
                    <MenuItem value="">-- All / Main Project --</MenuItem>
                    {childProjects.map(p => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12} sm={childProjects.length > 0 ? 6 : 12}>
              <Autocomplete
                options={subcontractors}
                getOptionLabel={(option) => {
                  if (typeof option === 'string') return option;
                  if (!option) return '';
                  const idStr = option.supplierId ? ` (${option.supplierId})` : '';
                  const catStr = option.vendorCategory ? ` - [${option.vendorCategory}]` : '';
                  return `${option.name || ''}${idStr}${catStr}`;
                }}
                value={subcontractors.find(s => String(s._id) === String(allocForm.contractorId)) || null}
                onChange={(event, newValue) => {
                  setAllocForm(p => ({ ...p, contractorId: newValue ? newValue._id : '' }));
                }}
                isOptionEqualToValue={(option, value) => String(option._id) === String(value._id || value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Assigned Subcontractor"
                    placeholder="Search subcontractor..."
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth required type="number"
                label={`Allocated Quantity (${allocatingItem?.unit || ''})`}
                value={allocForm.allocatedQuantity}
                onChange={e => setAllocForm(p => ({ ...p, allocatedQuantity: e.target.value }))}
                inputProps={{ min: 0, max: allocatingItem ? Math.max(0, (allocatingItem.estimatedQuantity || 0) - (allocatingItem.allocations || []).reduce((s, a) => s + (a.allocatedQuantity || 0), 0)) : undefined }}
                helperText={allocatingItem ? `Max Available: ${Math.max(0, (allocatingItem.estimatedQuantity || 0) - (allocatingItem.allocations || []).reduce((s, a) => s + (a.allocatedQuantity || 0), 0)).toLocaleString()} ${allocatingItem.unit}` : ''}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth type="number"
                label="Contractor Agreed Rate (PKR)"
                value={allocForm.contractorUnitPrice}
                onChange={e => setAllocForm(p => ({ ...p, contractorUnitPrice: e.target.value }))}
                inputProps={{ min: 0 }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth label="Allocation Notes"
                value={allocForm.notes}
                onChange={e => setAllocForm(p => ({ ...p, notes: e.target.value }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAllocateOpen(false)}>Cancel</Button>
          <Button variant="contained" color="secondary" onClick={handleSaveAllocation} disabled={allocSaving}>
            {allocSaving ? 'Allocating…' : 'Save Allocation'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={batchAssignOpen} onClose={() => setBatchAssignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Assign Subcontractor & Sub-Project ({selectedItems.size} BOQ Items)</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Autocomplete
                options={subcontractors}
                getOptionLabel={(option) => {
                  if (typeof option === 'string') return option;
                  if (!option) return '';
                  const idStr = option.supplierId ? ` (${option.supplierId})` : '';
                  const catStr = option.vendorCategory ? ` - [${option.vendorCategory}]` : '';
                  return `${option.name || ''}${idStr}${catStr}`;
                }}
                value={subcontractors.find(s => String(s._id) === String(batchContractorId)) || null}
                onChange={(event, newValue) => {
                  setBatchContractorId(newValue ? newValue._id : '');
                }}
                isOptionEqualToValue={(option, value) => String(option._id) === String(value._id || value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Subcontractor"
                    placeholder="Search subcontractor..."
                  />
                )}
              />
            </Grid>
            {childProjects.length > 0 && (
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Assign to Sub-Project</InputLabel>
                  <Select value={batchSubProjectId} label="Assign to Sub-Project" onChange={e => setBatchSubProjectId(e.target.value)}>
                    <MenuItem value="">-- All Sub-Projects --</MenuItem>
                    {childProjects.map(p => <MenuItem key={p._id} value={p._id}>{p.name} ({p.projectNumber || 'Sub-Project'})</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Contractor Agreed Rate (PKR) [Optional]"
                type="number"
                value={batchContractorUnitPrice}
                onChange={e => setBatchContractorUnitPrice(e.target.value)}
                helperText="Leave empty to keep existing BOQ unit price"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBatchAssignOpen(false)}>Cancel</Button>
          <Button variant="contained" color="secondary" onClick={handleBatchAssign} disabled={batchAssignSaving}>
            {batchAssignSaving ? 'Assigning…' : 'Confirm Assignment'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Purchase Order Dialog */}
      <Dialog open={poDialogOpen} onClose={() => setPoDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" alignItems="center" gap={1}>
            <POIcon color="secondary" />
            <span>Create Purchase Order from BOQ</span>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth required>
                <InputLabel>Vendor / Supplier</InputLabel>
                <Select
                  value={poForm.vendorId}
                  label="Vendor / Supplier"
                  onChange={e => setPoForm(p => ({ ...p, vendorId: e.target.value }))}
                  disabled={vendorsLoading}
                >
                  {vendorsLoading
                    ? <MenuItem disabled>Loading vendors…</MenuItem>
                    : vendors.map(v => <MenuItem key={v._id} value={v._id}>{v.name}</MenuItem>)
                  }
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth required type="date" label="Expected Delivery Date"
                InputLabelProps={{ shrink: true }}
                value={poForm.expectedDeliveryDate}
                onChange={e => setPoForm(p => ({ ...p, expectedDeliveryDate: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth label="Delivery Address"
                value={poForm.deliveryAddress}
                onChange={e => setPoForm(p => ({ ...p, deliveryAddress: e.target.value }))}
              />
            </Grid>

            {/* Items table */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>Items</Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><strong>Description</strong></TableCell>
                      <TableCell><strong>Unit</strong></TableCell>
                      <TableCell align="right" sx={{ width: 110 }}><strong>Quantity</strong></TableCell>
                      <TableCell align="right" sx={{ width: 130 }}><strong>Unit Price (PKR)</strong></TableCell>
                      <TableCell align="right"><strong>Total</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {poItems.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.description}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small" type="number" value={item.quantity}
                            onChange={setPoItemField(idx, 'quantity')}
                            inputProps={{ min: 0, style: { textAlign: 'right' } }}
                            sx={{ width: 100 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small" type="number" value={item.unitPrice}
                            onChange={setPoItemField(idx, 'unitPrice')}
                            inputProps={{ min: 0, style: { textAlign: 'right' } }}
                            sx={{ width: 120 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <strong>{fmt(Number(item.quantity) * Number(item.unitPrice))}</strong>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell colSpan={4} align="right"><strong>Grand Total</strong></TableCell>
                      <TableCell align="right"><strong>{fmt(poTotal)}</strong></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth label="Notes" multiline rows={2}
                value={poForm.notes}
                onChange={e => setPoForm(p => ({ ...p, notes: e.target.value }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPoDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="secondary" startIcon={poSaving ? <CircularProgress size={16} /> : <POIcon />}
            onClick={handleSubmitPO} disabled={poSaving}>
            {poSaving ? 'Creating…' : 'Create Purchase Order'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View BOQ Item Details Dialog */}
      <Dialog open={Boolean(viewItem)} onClose={() => setViewItem(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}>
          <Stack direction="row" alignItems="center" gap={1}>
            <ViewIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>BOQ Item Detailed Specification</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {viewItem && (
            <Stack spacing={2.5}>
              {project && (
                <Grid container spacing={2} sx={{ bgcolor: 'rgba(25, 118, 210, 0.04)', p: 1.5, borderRadius: 1.5, mt: 0, ml: 0, width: '100%' }}>
                  <Grid item xs={6} sx={{ pt: '0px !important', pl: '0px !important' }}>
                    <Typography variant="caption" color="text.secondary" display="block">Parent Portfolio</Typography>
                    <Typography variant="body2" fontWeight={700} color="text.primary">
                      {project.parentProject?.name || (project.isMasterProject ? 'This is Master Portfolio' : 'Independent Project')}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sx={{ pt: '0px !important' }}>
                    <Typography variant="caption" color="text.secondary" display="block">Sub-Project Unit</Typography>
                    <Typography variant="body2" fontWeight={700} color="primary.main">
                      {project.name}
                    </Typography>
                  </Grid>
                </Grid>
              )}

              <Box>
                <Typography variant="caption" color="text.secondary">Item Title</Typography>
                <Typography variant="body1" fontWeight={600} color="primary.main">
                  {viewItem.title || '—'} {viewItem.itemCode ? `(${viewItem.itemCode})` : ''}
                </Typography>
              </Box>
              
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">BOQ Document Container</Typography>
                  <Typography variant="body2" fontWeight={600} color="primary.main">
                    📄 {viewItem.boqHeader?.title || boqHeaders.find(h => h._id === (viewItem.boqHeader?._id || viewItem.boqHeader))?.title || 'General Master BOQ'}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Phase / Work Package</Typography>
                  <Typography variant="body2" fontWeight={500}>{viewItem.phase || 'General'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Category</Typography>
                  <Typography variant="body2" fontWeight={500}>{viewItem.category || '—'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Unit of Measure</Typography>
                  <Typography variant="body2" fontWeight={500}>{viewItem.unit || '—'}</Typography>
                </Grid>
              </Grid>

              <Divider />

              <Box>
                <Typography variant="caption" color="text.secondary">Scope Description</Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-line', bgcolor: 'grey.50', p: 1.5, borderRadius: 1 }}>
                  {viewItem.description}
                </Typography>
              </Box>

              {viewItem.specification && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Technical Specification</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line', bgcolor: 'grey.50', p: 1.5, borderRadius: 1 }}>
                    {viewItem.specification}
                  </Typography>
                </Box>
              )}

              <Divider />

              {/* Scope Allocations Breakdown */}
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                  Sub-Project & Subcontractor Quantity Allocations
                </Typography>
                {(() => {
                  const masterQty = Number(viewItem.estimatedQuantity) || 0;
                  const allocations = viewItem.allocations || [];
                  const allocTotal = allocations.reduce((s, a) => s + (Number(a.allocatedQuantity) || 0), 0);
                  const remaining = Math.max(0, masterQty - allocTotal);

                  return (
                    <Stack spacing={1.5}>
                      <Grid container spacing={2} sx={{ bgcolor: 'grey.50', p: 1.5, borderRadius: 1.5 }}>
                        <Grid item xs={4}>
                          <Typography variant="caption" color="text.secondary">Authorized Master Qty</Typography>
                          <Typography variant="body2" fontWeight={700}>{masterQty.toLocaleString()} {viewItem.unit}</Typography>
                        </Grid>
                        <Grid item xs={4}>
                          <Typography variant="caption" color="text.secondary">Total Allocated Qty</Typography>
                          <Typography variant="body2" fontWeight={700} color="primary.main">{allocTotal.toLocaleString()} {viewItem.unit}</Typography>
                        </Grid>
                        <Grid item xs={4}>
                          <Typography variant="caption" color="text.secondary">Remaining Unallocated</Typography>
                          <Typography variant="body2" fontWeight={700} color={remaining > 0 ? 'success.main' : 'error.main'}>
                            {remaining.toLocaleString()} {viewItem.unit}
                          </Typography>
                        </Grid>
                      </Grid>

                      {allocations.length > 0 ? (
                        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
                          <Table size="small">
                            <TableHead sx={{ bgcolor: 'grey.100' }}>
                              <TableRow>
                                <TableCell><strong>Sub-Project</strong></TableCell>
                                <TableCell><strong>Subcontractor</strong></TableCell>
                                <TableCell align="right"><strong>Allocated Qty</strong></TableCell>
                                <TableCell align="right"><strong>Agreed Rate</strong></TableCell>
                                <TableCell align="right"><strong>Total Cost</strong></TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {allocations.map((alloc, idx) => {
                                const q = Number(alloc.allocatedQuantity) || 0;
                                const rate = Number(alloc.contractorUnitPrice) || Number(viewItem.estimatedUnitPrice) || 0;
                                return (
                                  <TableRow key={alloc._id || idx}>
                                    <TableCell>{alloc.subProject?.name || alloc.subProject?.projectNumber || 'Main Portfolio'}</TableCell>
                                    <TableCell>{alloc.contractor?.name || viewItem.contractor?.name || 'Unassigned'}</TableCell>
                                    <TableCell align="right">
                                      <strong>{q.toLocaleString()}</strong> {viewItem.unit}
                                    </TableCell>
                                    <TableCell align="right">{fmt(rate)}</TableCell>
                                    <TableCell align="right"><strong>{fmt(q * rate)}</strong></TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', pl: 1 }}>
                          No sub-project or contractor allocations assigned yet.
                        </Typography>
                      )}
                    </Stack>
                  );
                })()}
              </Box>

              <Divider />

              <Typography variant="subtitle2" fontWeight={700}>Financials & Quantity Track</Typography>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Est. Quantity</Typography>
                  <Typography variant="body2" fontWeight={600}>{viewItem.estimatedQuantity?.toLocaleString()}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Est. Unit Price</Typography>
                  <Typography variant="body2" fontWeight={600}>{fmt(viewItem.estimatedUnitPrice)}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Net Est. Cost</Typography>
                  <Typography variant="body2" fontWeight={600} color="primary.main">{fmt(viewItem.netEstimatedCost)}</Typography>
                </Grid>

                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Ordered Qty</Typography>
                  <Typography variant="body2" fontWeight={600} color="info.main">{viewItem.orderedQuantity?.toLocaleString() || '0'}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Physically Used</Typography>
                  <Typography variant="body2" fontWeight={600} color="success.main">{viewItem.usedQuantity?.toLocaleString() || '0'}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">Actual Total Cost</Typography>
                  <Typography variant="body2" fontWeight={600}>{fmt(viewItem.actualTotalCost)}</Typography>
                </Grid>
              </Grid>

              {viewItem.notes && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Notes</Typography>
                  <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{viewItem.notes}</Typography>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 1.5 }}>
          <Button variant="contained" onClick={() => setViewItem(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// ─── Tasks Tab ────────────────────────────────────────────────────────────────
const TasksTab = ({ projectId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [parentPhase, setParentPhase] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [form, setForm] = useState({ title: '', description: '', plannedStartDate: '', plannedEndDate: '', assignedTo: '', estimatedLaborCost: '', level: 0, notes: '' });
  
  const [viewTask, setViewTask] = useState(null);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyTaskItem, setVerifyTaskItem] = useState(null);
  const [verificationForm, setVerificationForm] = useState({
    isPhysicallyVerified: false,
    verifiedBy: '',
    verificationNotes: '',
    verificationPhotoUrl: ''
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getTasks(projectId);
      setData(res.data?.data || null);
      // Expand all phases by default
      const expanded = {};
      (res.data?.data?.tree || []).forEach(p => { expanded[p._id] = true; });
      setExpanded(expanded);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load tasks');
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const openAddPhase = () => {
    setEditTask(null); setParentPhase(null);
    setForm({ title: '', description: '', plannedStartDate: '', plannedEndDate: '', assignedTo: '', estimatedLaborCost: '', level: 0, notes: '' });
    setDialogOpen(true);
  };

  const openAddTask = (phase) => {
    setEditTask(null); setParentPhase(phase);
    setForm({ title: '', description: '', plannedStartDate: '', plannedEndDate: '', assignedTo: '', estimatedLaborCost: '', level: 1, notes: '' });
    setDialogOpen(true);
  };

  const openEdit = (task) => {
    setEditTask(task); setParentPhase(null);
    setForm({
      title: task.title, description: task.description || '', level: task.level,
      plannedStartDate: task.plannedStartDate ? dayjs(task.plannedStartDate).format('YYYY-MM-DD') : '',
      plannedEndDate: task.plannedEndDate ? dayjs(task.plannedEndDate).format('YYYY-MM-DD') : '',
      assignedTo: task.assignedTo || '', estimatedLaborCost: task.estimatedLaborCost || '',
      progressPercent: task.progressPercent || 0, status: task.status, notes: task.notes || ''
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title) { setError('Title is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        plannedStartDate: form.plannedStartDate || undefined,
        plannedEndDate: form.plannedEndDate || undefined,
        parentTask: parentPhase?._id || undefined
      };
      if (editTask) {
        await updateTask(projectId, editTask._id, payload);
      } else {
        await createTask(projectId, payload);
      }
      setSuccess(editTask ? 'Task updated' : 'Task created');
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save task');
    } finally { setSaving(false); }
  };

  const handleProgressChange = async (task, value) => {
    try {
      await updateTask(projectId, task._id, { progressPercent: Number(value) });
      load();
    } catch { /* silent */ }
  };

  const openVerifyDialog = (task) => {
    setVerifyTaskItem(task);
    setVerificationForm({
      isPhysicallyVerified: Boolean(task.isPhysicallyVerified),
      verifiedBy: task.verifiedBy || '',
      verificationNotes: task.verificationNotes || '',
      verificationPhotoUrl: task.verificationPhotoUrl || ''
    });
    setVerifyDialogOpen(true);
  };

  const handleSaveVerification = async () => {
    if (!verifyTaskItem) return;
    setSaving(true);
    try {
      await updateTask(projectId, verifyTaskItem._id, {
        isPhysicallyVerified: verificationForm.isPhysicallyVerified,
        verifiedBy: verificationForm.verifiedBy,
        verificationNotes: verificationForm.verificationNotes,
        verificationPhotoUrl: verificationForm.verificationPhotoUrl,
        verifiedAt: verificationForm.isPhysicallyVerified ? new Date() : null
      });
      setSuccess('Physical verification updated successfully');
      setVerifyDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update physical verification');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (taskId) => {
    if (!window.confirm('Delete this task and all subtasks?')) return;
    try {
      await deleteTask(projectId, taskId);
      setSuccess('Task deleted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete');
    }
  };

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  if (loading) return <Skeleton height={300} />;

  const tree = data?.tree || [];

  return (
    <Box>
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <SectionHeader
        title="Work Breakdown Structure"
        action={
          <Stack direction="row" gap={1}>
            <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openAddPhase}>Add Phase</Button>
          </Stack>
        }
      />

      {!tree.length ? (
        <EmptyState icon={TaskIcon} text="No phases or tasks yet. Start by adding a phase."
          action={<Button variant="outlined" startIcon={<AddIcon />} onClick={openAddPhase}>Add Phase</Button>} />
      ) : (
        tree.map(phase => (
          <Card key={phase._id} variant="outlined" sx={{ mb: 2 }}>
            <CardContent sx={{ pb: 1 }}>
              {/* Phase header */}
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Stack direction="row" alignItems="center" gap={1}>
                  <IconButton size="small" onClick={() => setExpanded(prev => ({ ...prev, [phase._id]: !prev[phase._id] }))}>
                    {expanded[phase._id] ? <ExpandLess /> : <ExpandMore />}
                  </IconButton>
                  <Typography variant="subtitle1" fontWeight={700}>{phase.title}</Typography>
                  <Chip label={phase.status} size="small" color={TASK_STATUS_COLOR[phase.status] || 'default'} />
                </Stack>
                <Stack direction="row" gap={0.5}>
                  <Tooltip title="View Details">
                    <IconButton size="small" onClick={() => setViewTask(phase)}>
                      <ViewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => openAddTask(phase)}>Add Task</Button>
                  <IconButton size="small" onClick={() => openEdit(phase)}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(phase._id)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              </Stack>

              {/* Phase timeline */}
              {(phase.plannedStartDate || phase.plannedEndDate) && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 5 }}>
                  {phase.plannedStartDate ? dayjs(phase.plannedStartDate).format('DD MMM') : '—'}
                  {' → '}
                  {phase.plannedEndDate ? dayjs(phase.plannedEndDate).format('DD MMM YYYY') : '—'}
                </Typography>
              )}

              {/* Tasks */}
              <Collapse in={expanded[phase._id] !== false} timeout="auto">
                {phase.children?.length > 0 && (
                  <TableContainer sx={{ mt: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>Task</strong></TableCell>
                          <TableCell><strong>Assigned To</strong></TableCell>
                          <TableCell><strong>Planned Dates</strong></TableCell>
                          <TableCell><strong>Status</strong></TableCell>
                          <TableCell sx={{ width: 140 }}><strong>Progress</strong></TableCell>
                          <TableCell sx={{ width: 140 }}><strong>Physical Verification</strong></TableCell>
                          <TableCell align="right"><strong>Actions</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {phase.children.map(task => (
                          <TableRow key={task._id} hover>
                            <TableCell>
                              <Stack direction="row" alignItems="center" gap={0.5}>
                                <DotIcon sx={{ fontSize: 8, color: 'grey.400' }} />
                                <Typography variant="body2">{task.title}</Typography>
                              </Stack>
                              {task.description && (
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                                  {task.description}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{task.assignedTo || '—'}</Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption">
                                {task.plannedStartDate ? dayjs(task.plannedStartDate).format('DD MMM') : '—'}
                                {' → '}
                                {task.plannedEndDate ? dayjs(task.plannedEndDate).format('DD MMM') : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip label={task.status} size="small" color={TASK_STATUS_COLOR[task.status] || 'default'} />
                            </TableCell>
                            <TableCell>
                              <Stack spacing={0.5}>
                                <Stack direction="row" justifyContent="space-between">
                                  <Typography variant="caption">{task.progressPercent}%</Typography>
                                </Stack>
                                <TextField
                                  type="number"
                                  size="small"
                                  value={task.progressPercent}
                                  onChange={(e) => handleProgressChange(task, e.target.value)}
                                  InputProps={{ inputProps: { min: 0, max: 100 }, sx: { py: 0.5, fontSize: '0.75rem' } }}
                                  sx={{ width: 70, display: 'inline-block' }}
                                />
                                <LinearProgress
                                  variant="determinate"
                                  value={task.progressPercent || 0}
                                  color={task.progressPercent === 100 ? 'success' : task.progressPercent > 0 ? 'info' : 'inherit'}
                                  sx={{ height: 4, borderRadius: 2 }}
                                />
                              </Stack>
                            </TableCell>
                            <TableCell>
                              {task.isPhysicallyVerified ? (
                                <Tooltip title={`Verified by ${task.verifiedBy || 'QC'} on ${dayjs(task.verifiedAt).format('DD MMM YY')}${task.verificationNotes ? ': ' + task.verificationNotes : ''}`}>
                                  <Chip
                                    label="Verified"
                                    size="small"
                                    color="success"
                                    icon={<CheckIcon sx={{ fontSize: '0.8rem !important' }} />}
                                    onClick={() => openVerifyDialog(task)}
                                    sx={{ cursor: 'pointer', height: 22, fontSize: '0.7rem' }}
                                  />
                                </Tooltip>
                              ) : (
                                <Chip
                                  label="Pending Audit"
                                  size="small"
                                  variant="outlined"
                                  color="default"
                                  onClick={() => openVerifyDialog(task)}
                                  sx={{ cursor: 'pointer', height: 22, fontSize: '0.7rem' }}
                                />
                              )}
                            </TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                <Tooltip title="View Details">
                                  <IconButton size="small" onClick={() => setViewTask(task)}>
                                    <ViewIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <IconButton size="small" onClick={() => openEdit(task)}><EditIcon fontSize="small" /></IconButton>
                                <IconButton size="small" color="error" onClick={() => handleDelete(task._id)}><DeleteIcon fontSize="small" /></IconButton>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
                {!phase.children?.length && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 5, mt: 1, display: 'block' }}>
                    No tasks in this phase.{' '}
                    <Box component="span" sx={{ cursor: 'pointer', color: 'primary.main' }} onClick={() => openAddTask(phase)}>
                      Add a task
                    </Box>
                  </Typography>
                )}
              </Collapse>
            </CardContent>
          </Card>
        ))
      )}

      {/* Task Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editTask ? `Edit: ${editTask.title}` : parentPhase ? `Add Task to "${parentPhase.title}"` : 'Add Phase'}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField fullWidth required label="Title" value={form.title} onChange={set('title')} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Description" value={form.description} onChange={set('description')} multiline rows={2} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth type="date" label="Planned Start" value={form.plannedStartDate}
                onChange={set('plannedStartDate')} InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth type="date" label="Planned End" value={form.plannedEndDate}
                onChange={set('plannedEndDate')} InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Assigned To (Contractor)" value={form.assignedTo} onChange={set('assignedTo')} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Est. Labor Cost" type="number" value={form.estimatedLaborCost} onChange={set('estimatedLaborCost')} />
            </Grid>
            {editTask && (
              <>
                <Grid item xs={6}>
                  <TextField fullWidth label="Progress %" type="number" value={form.progressPercent}
                    onChange={set('progressPercent')} InputProps={{ inputProps: { min: 0, max: 100 } }} />
                </Grid>
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>Status</InputLabel>
                    <Select value={form.status || 'Not Started'} label="Status" onChange={set('status')}>
                      {['Not Started', 'In Progress', 'Completed', 'On Hold', 'Cancelled'].map(s =>
                        <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editTask ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Physical Verification Dialog */}
      <Dialog open={verifyDialogOpen} onClose={() => setVerifyDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}>
          <Stack direction="row" alignItems="center" gap={1}>
            <CheckIcon color="success" />
            <Typography variant="h6" fontWeight={600}>WBS Physical Verification</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Review and sign off on physical completion of: <strong>{verifyTaskItem?.title}</strong>
            </Typography>
            
            <FormControl fullWidth>
              <InputLabel>Verification Audit Status</InputLabel>
              <Select
                value={verificationForm.isPhysicallyVerified ? 'true' : 'false'}
                label="Verification Audit Status"
                onChange={(e) => setVerificationForm(p => ({ ...p, isPhysicallyVerified: e.target.value === 'true' }))}
              >
                <MenuItem value="false">⚠️ Pending Visual Inspection</MenuItem>
                <MenuItem value="true">✅ Physically Inspected & Verified</MenuItem>
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="Auditor / Verified By"
              placeholder="e.g. Lead Site Engineer, QC Manager"
              value={verificationForm.verifiedBy}
              onChange={(e) => setVerificationForm(p => ({ ...p, verifiedBy: e.target.value }))}
            />

            <TextField
              fullWidth
              label="Verification Audit Notes"
              placeholder="Provide comments on physical inspection quality and compliance..."
              multiline
              rows={3}
              value={verificationForm.verificationNotes}
              onChange={(e) => setVerificationForm(p => ({ ...p, verificationNotes: e.target.value }))}
            />

            <TextField
              fullWidth
              label="Inspection / Proof Image URL (Optional)"
              placeholder="e.g. https://images.unsplash.com/photo-1541888946425-d81bb19240f5"
              value={verificationForm.verificationPhotoUrl}
              onChange={(e) => setVerificationForm(p => ({ ...p, verificationPhotoUrl: e.target.value }))}
            />

            {verificationForm.isPhysicallyVerified && verificationForm.verificationPhotoUrl && (
              <Box sx={{ mt: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                <Typography variant="caption" sx={{ px: 1.5, py: 0.5, display: 'block', bgcolor: 'grey.50', fontWeight: 600 }}>Inspection Proof Preview</Typography>
                <img
                  src={getImageUrl(verificationForm.verificationPhotoUrl)}
                  alt="Inspection Proof Preview"
                  style={{ width: '100%', height: 140, objectFit: 'cover' }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 2 }}>
          <Button onClick={() => setVerifyDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={handleSaveVerification} disabled={saving}>
            {saving ? 'Saving Sign-off…' : 'Save Verification'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Phase / Task Details Dialog */}
      <Dialog open={Boolean(viewTask)} onClose={() => setViewTask(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}>
          <Stack direction="row" alignItems="center" gap={1}>
            <ViewIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              WBS {viewTask?.level === 0 ? 'Phase' : 'Task'} Detailed Specification
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {viewTask && (
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="caption" color="text.secondary">Title</Typography>
                <Typography variant="body1" fontWeight={600} color="primary.main">
                  {viewTask.title}
                </Typography>
              </Box>

              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Level</Typography>
                  <Typography variant="body2" fontWeight={500}>{viewTask.level === 0 ? 'Phase (Level 0)' : 'Task (Level 1/2)'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <Chip label={viewTask.status} size="small" color={TASK_STATUS_COLOR[viewTask.status] || 'default'} />
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Planned Dates</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {viewTask.plannedStartDate ? dayjs(viewTask.plannedStartDate).format('DD MMM YYYY') : '—'}
                    {' → '}
                    {viewTask.plannedEndDate ? dayjs(viewTask.plannedEndDate).format('DD MMM YYYY') : '—'}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Progress %</Typography>
                  <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 0.5 }}>
                    <LinearProgress
                      variant="determinate"
                      value={viewTask.progressPercent || 0}
                      color={viewTask.progressPercent === 100 ? 'success' : 'info'}
                      sx={{ width: 80, height: 6, borderRadius: 3 }}
                    />
                    <Typography variant="body2" fontWeight={700}>{viewTask.progressPercent || 0}%</Typography>
                  </Stack>
                </Grid>
              </Grid>

              {viewTask.description && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Description</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line', bgcolor: 'grey.50', p: 1.5, borderRadius: 1 }}>
                    {viewTask.description}
                  </Typography>
                </Box>
              )}

              <Divider />

              <Typography variant="subtitle2" fontWeight={700}>Financials & Assignment</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Assigned Contractor</Typography>
                  <Typography variant="body2" fontWeight={500}>{viewTask.assignedTo || '—'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Estimated Labor Cost</Typography>
                  <Typography variant="body2" fontWeight={600}>{fmt(viewTask.estimatedLaborCost)}</Typography>
                </Grid>
              </Grid>

              <Divider />

              <Typography variant="subtitle2" fontWeight={700}>Physical Verification Sign-off</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Inspection Status</Typography>
                  <Box sx={{ mt: 0.5 }}>
                    {viewTask.isPhysicallyVerified ? (
                      <Chip label="Verified & Approved" size="small" color="success" icon={<CheckIcon sx={{ fontSize: '0.8rem !important' }} />} />
                    ) : (
                      <Chip label="Pending Visual Audit" size="small" variant="outlined" />
                    )}
                  </Box>
                </Grid>
                {viewTask.isPhysicallyVerified && (
                  <>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Verified At</Typography>
                      <Typography variant="body2" fontWeight={500}>
                        {viewTask.verifiedAt ? dayjs(viewTask.verifiedAt).format('DD MMM YYYY HH:mm') : '—'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Verified By (Auditor)</Typography>
                      <Typography variant="body2" fontWeight={600} color="primary.main">{viewTask.verifiedBy || 'QC Officer'}</Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary">Auditor Notes</Typography>
                      <Typography variant="body2" sx={{ fontStyle: 'italic', bgcolor: 'grey.50', p: 1.5, borderRadius: 1 }}>
                        {viewTask.verificationNotes || 'No notes provided.'}
                      </Typography>
                    </Grid>
                  </>
                )}
              </Grid>

              {viewTask.isPhysicallyVerified && viewTask.verificationPhotoUrl && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>Site Verification Photo Proof</Typography>
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                    <img
                      src={getImageUrl(viewTask.verificationPhotoUrl)}
                      alt="Verification site photo proof"
                      style={{ width: '100%', maxHeight: 280, objectFit: 'cover', cursor: 'pointer' }}
                      onClick={() => {
                        const url = getImageUrl(viewTask.verificationPhotoUrl);
                        if (url.startsWith('data:')) {
                          const w = window.open('');
                          w.document.write(`<img src="${url}" style="max-width:100%"/>`);
                        } else {
                          window.open(url, '_blank');
                        }
                      }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </Box>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 1.5 }}>
          <Button variant="contained" onClick={() => setViewTask(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// ─── Expenses Tab ─────────────────────────────────────────────────────────────
const ExpensesTab = ({ projectId, project }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    category: '', description: '', amount: '', expenseDate: dayjs().format('YYYY-MM-DD'),
    vendor: '', invoiceNumber: '', paymentStatus: 'Pending', paymentMethod: 'Bank Transfer', notes: ''
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getExpenses(projectId);
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load expenses');
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditExpense(null);
    setForm({ category: '', description: '', amount: '', expenseDate: dayjs().format('YYYY-MM-DD'), vendor: '', invoiceNumber: '', paymentStatus: 'Pending', paymentMethod: 'Bank Transfer', notes: '' });
    setDialogOpen(true);
  };

  const openEdit = (exp) => {
    setEditExpense(exp);
    setForm({
      category: exp.category, description: exp.description,
      amount: exp.amount, expenseDate: dayjs(exp.expenseDate).format('YYYY-MM-DD'),
      vendor: exp.vendor || '', invoiceNumber: exp.invoiceNumber || '',
      paymentStatus: exp.paymentStatus, paymentMethod: exp.paymentMethod || 'Bank Transfer',
      notes: exp.notes || ''
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.category) { setError('Category is required'); return; }
    if (!form.description) { setError('Description is required'); return; }
    if (!form.amount) { setError('Amount is required'); return; }
    setSaving(true); setError('');
    try {
      if (editExpense) {
        await updateExpense(projectId, editExpense._id, form);
      } else {
        await addExpense(projectId, form);
      }
      setSuccess(editExpense ? 'Expense updated' : 'Expense recorded');
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save expense');
    } finally { setSaving(false); }
  };

  const handleDelete = async (expId) => {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await deleteExpense(projectId, expId);
      setSuccess('Expense deleted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete');
    }
  };

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  // Build budget vs actual per category
  const budgetByCategory = (project?.budgetCategories || []).reduce((acc, c) => {
    acc[c.category] = c.approvedAmount || c.estimatedAmount || 0;
    return acc;
  }, {});

  const spentByCategory = (data?.summary || []).reduce((acc, s) => {
    acc[s._id] = s.total;
    return acc;
  }, {});

  if (loading) return <Skeleton height={300} />;

  return (
    <Box>
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <SectionHeader
        title="Project Expenses"
        action={
          <Stack direction="row" gap={1}>
            <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openAdd}>Record Expense</Button>
          </Stack>
        }
      />

      {/* Budget vs Actual by category */}
      {Object.keys(budgetByCategory).length > 0 && (
        <Card variant="outlined" sx={{ mb: 3, p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>Budget vs Actual by Category</Typography>
          <Grid container spacing={1}>
            {BUDGET_CATEGORIES.filter(c => budgetByCategory[c] > 0 || spentByCategory[c] > 0).map(cat => {
              const budget = budgetByCategory[cat] || 0;
              const spent = spentByCategory[cat] || 0;
              const utilPct = pct(spent, budget);
              return (
                <Grid item xs={12} sm={6} md={4} key={cat}>
                  <Box>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" fontWeight={500}>{cat}</Typography>
                      <Typography variant="caption" color={utilPct > 100 ? 'error.main' : 'text.secondary'}>
                        {utilPct}%
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(utilPct, 100)}
                      color={utilPct > 100 ? 'error' : utilPct > 80 ? 'warning' : 'success'}
                      sx={{ height: 6, borderRadius: 3, mb: 0.5 }}
                    />
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">Budget: {fmt(budget)}</Typography>
                      <Typography variant="caption">Spent: {fmt(spent)}</Typography>
                    </Stack>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        </Card>
      )}

      {/* Expenses table */}
      {(!data?.expenses?.length) ? (
        <EmptyState icon={MoneyIcon} text="No expenses recorded yet"
          action={<Button variant="outlined" startIcon={<AddIcon />} onClick={openAdd}>Record First Expense</Button>} />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><strong>Expense #</strong></TableCell>
                <TableCell><strong>Date</strong></TableCell>
                <TableCell><strong>Category</strong></TableCell>
                <TableCell><strong>Description</strong></TableCell>
                <TableCell><strong>Vendor</strong></TableCell>
                <TableCell align="right"><strong>Amount</strong></TableCell>
                <TableCell><strong>Payment</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data.expenses || []).map(exp => (
                <TableRow key={exp._id} hover>
                  <TableCell>
                    <Typography variant="caption" fontFamily="monospace">{exp.expenseNumber}</Typography>
                  </TableCell>
                  <TableCell>{dayjs(exp.expenseDate).format('DD MMM YYYY')}</TableCell>
                  <TableCell><Chip label={exp.category} size="small" variant="outlined" /></TableCell>
                  <TableCell>
                    <Typography variant="body2">{exp.description}</Typography>
                    {exp.invoiceNumber && <Typography variant="caption" color="text.secondary">Inv: {exp.invoiceNumber}</Typography>}
                  </TableCell>
                  <TableCell>{exp.vendor || '—'}</TableCell>
                  <TableCell align="right"><strong>{fmt(exp.amount)}</strong></TableCell>
                  <TableCell>
                    <Chip
                      label={exp.paymentStatus}
                      size="small"
                      color={exp.paymentStatus === 'Paid' ? 'success' : exp.paymentStatus === 'Pending' ? 'warning' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <IconButton size="small" onClick={() => openEdit(exp)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(exp._id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell colSpan={5} align="right"><strong>Total</strong></TableCell>
                <TableCell align="right">
                  <strong>{fmt((data?.expenses || []).reduce((s, e) => s + (e.amount || 0), 0))}</strong>
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Expense Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editExpense ? 'Edit Expense' : 'Record Expense'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <FormControl fullWidth required>
                <InputLabel>Category</InputLabel>
                <Select value={form.category} label="Category" onChange={set('category')}>
                  {BUDGET_CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth type="date" label="Date" value={form.expenseDate}
                onChange={set('expenseDate')} InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth required label="Description" value={form.description} onChange={set('description')} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth required label="Amount (PKR)" type="number" value={form.amount} onChange={set('amount')} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Vendor / Contractor" value={form.vendor} onChange={set('vendor')} />
            </Grid>
            <Grid item xs={6}>
              <TextField fullWidth label="Invoice / Ref #" value={form.invoiceNumber} onChange={set('invoiceNumber')} />
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Payment Status</InputLabel>
                <Select value={form.paymentStatus} label="Payment Status" onChange={set('paymentStatus')}>
                  {['Pending', 'Paid', 'Cancelled'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select value={form.paymentMethod} label="Payment Method" onChange={set('paymentMethod')}>
                  {['Cash', 'Bank Transfer', 'Cheque', 'Online'].map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Notes" value={form.notes} onChange={set('notes')} multiline rows={2} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editExpense ? 'Update' : 'Record'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// ─── DPR Tab ──────────────────────────────────────────────────────────────────
const DPRTab = ({ projectId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState([]);
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    reportDate: dayjs().format('YYYY-MM-DD'), weather: '', temperature: '',
    workforceCivil: 0, workforceElectrical: 0, workforcePlumbing: 0, workforceSupervisors: 0,
    summary: '', nextDayPlan: '',
    workDone: [{ taskTitle: '', description: '', progressToday: 0 }],
    issues: []
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getDPRList(projectId);
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load DPRs');
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({
      reportDate: dayjs().format('YYYY-MM-DD'), weather: '', temperature: '',
      workforceCivil: 0, workforceElectrical: 0, workforcePlumbing: 0, workforceSupervisors: 0,
      summary: '', nextDayPlan: '',
      workDone: [{ taskTitle: '', description: '', progressToday: 0 }],
      issues: []
    });
    setPhotos([]);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.reportDate) { setError('Report date is required'); return; }
    setSaving(true); setError('');
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'workDone' || k === 'issues') {
          formData.append(k, JSON.stringify(v));
        } else {
          formData.append(k, v);
        }
      });
      photos.forEach(p => formData.append('photos', p.file));
      formData.append('photoCaptions', JSON.stringify(photos.map(p => p.caption || '')));

      await submitDPR(projectId, formData);
      setSuccess('DPR submitted successfully');
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit DPR');
    } finally { setSaving(false); }
  };

  const handleDelete = async (dprId) => {
    if (!window.confirm('Delete this DPR?')) return;
    try {
      await deleteDPR(projectId, dprId);
      setSuccess('DPR deleted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete DPR');
    }
  };

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));
  const setNum = (field) => (e) => setForm(prev => ({ ...prev, [field]: Number(e.target.value) || 0 }));

  const addWorkDone = () => setForm(prev => ({
    ...prev, workDone: [...prev.workDone, { taskTitle: '', description: '', progressToday: 0 }]
  }));

  const setWorkDone = (idx, field) => (e) => setForm(prev => {
    const wd = [...prev.workDone];
    wd[idx] = { ...wd[idx], [field]: e.target.value };
    return { ...prev, workDone: wd };
  });

  const removeWorkDone = (idx) => setForm(prev => ({
    ...prev, workDone: prev.workDone.filter((_, i) => i !== idx)
  }));

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || []);
    setPhotos(prev => [...prev, ...files.map(f => ({ file: f, caption: '', preview: URL.createObjectURL(f) }))]);
  };

  if (loading) return <Skeleton height={300} />;

  const reports = data?.reports || [];

  return (
    <Box>
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <SectionHeader
        title="Daily Progress Reports"
        action={
          <Stack direction="row" gap={1}>
            <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openAdd}>Submit DPR</Button>
          </Stack>
        }
      />

      {!reports.length ? (
        <EmptyState icon={PhotoIcon} text="No daily progress reports yet"
          action={<Button variant="outlined" startIcon={<AddIcon />} onClick={openAdd}>Submit First DPR</Button>} />
      ) : (
        reports.map(report => (
          <Card key={report._id} variant="outlined" sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  <Stack direction="row" alignItems="center" gap={1}>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {dayjs(report.reportDate).format('dddd, DD MMMM YYYY')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                      {report.reportNumber}
                    </Typography>
                  </Stack>
                  <Stack direction="row" gap={2} sx={{ mt: 0.5 }}>
                    {report.weather && <Typography variant="caption">🌤 {report.weather} {report.temperature}</Typography>}
                    <Typography variant="caption">
                      👷 {report.workforceTotal} workers
                      {report.workforceCivil > 0 && ` (Civil: ${report.workforceCivil}`}
                      {report.workforceElectrical > 0 && `, Elec: ${report.workforceElectrical}`}
                      {report.workforcePlumbing > 0 && `, Plumb: ${report.workforcePlumbing}`}
                      {report.workforceSupervisors > 0 && `, Sup: ${report.workforceSupervisors}`}
                      {report.workforceCivil > 0 && ')'}
                    </Typography>
                    {report.submittedBy && (
                      <Typography variant="caption">
                        By: {report.submittedBy.firstName} {report.submittedBy.lastName}
                      </Typography>
                    )}
                  </Stack>
                </Box>
                <IconButton size="small" color="error" onClick={() => handleDelete(report._id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>

              {report.summary && (
                <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>{report.summary}</Typography>
              )}

              {report.workDone?.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">WORK DONE:</Typography>
                  {report.workDone.map((w, i) => (
                    <Typography key={i} variant="body2" sx={{ ml: 1 }}>
                      • {w.taskTitle ? `[${w.taskTitle}] ` : ''}{w.description}
                      {w.progressToday > 0 && ` (+${w.progressToday}%)`}
                    </Typography>
                  ))}
                </Box>
              )}

              {report.issues?.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">ISSUES:</Typography>
                  {report.issues.map((iss, i) => (
                    <Stack key={i} direction="row" alignItems="center" gap={0.5} sx={{ ml: 1 }}>
                      <WarnIcon sx={{ fontSize: 14, color: iss.severity === 'High' || iss.severity === 'Critical' ? 'error.main' : 'warning.main' }} />
                      <Typography variant="body2">{iss.description}</Typography>
                      <Chip label={iss.severity} size="small" color={iss.severity === 'High' || iss.severity === 'Critical' ? 'error' : 'warning'} />
                      <Chip label={iss.status} size="small" color={iss.status === 'Resolved' ? 'success' : 'default'} />
                    </Stack>
                  ))}
                </Box>
              )}

              {report.photos?.length > 0 && (
                <Stack direction="row" gap={1} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
                  {report.photos.map((photo, i) => (
                    <Box key={i}>
                      <Box
                        component="img"
                        src={getImageUrl(photo.url)}
                        alt={photo.caption || `Photo ${i + 1}`}
                        sx={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 1, cursor: 'pointer' }}
                        onClick={() => {
                          const url = getImageUrl(photo.url);
                          if (url?.startsWith('data:')) {
                            const w = window.open('');
                            if (w) {
                              w.document.write(`<html><head><title>DPR Photo Preview</title></head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111;"><img src="${url}" style="max-width:100%;max-height:100vh;object-fit:contain;"/></body></html>`);
                              w.document.close();
                            }
                          } else if (url) {
                            window.open(url, '_blank');
                          }
                        }}
                      />
                      {photo.caption && <Typography variant="caption" display="block" align="center">{photo.caption}</Typography>}
                    </Box>
                  ))}
                </Stack>
              )}

              {report.nextDayPlan && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  <strong>Next day plan:</strong> {report.nextDayPlan}
                </Typography>
              )}
            </CardContent>
          </Card>
        ))
      )}

      {/* DPR Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Submit Daily Progress Report</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={6} md={4}>
              <TextField fullWidth type="date" label="Report Date" required value={form.reportDate}
                onChange={set('reportDate')} InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={6} md={4}>
              <TextField fullWidth label="Weather" value={form.weather} onChange={set('weather')} placeholder="Sunny, Cloudy…" />
            </Grid>
            <Grid item xs={6} md={4}>
              <TextField fullWidth label="Temperature" value={form.temperature} onChange={set('temperature')} placeholder="32°C" />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" gutterBottom>Workforce on Site</Typography>
              <Grid container spacing={2}>
                {[['workforceCivil', 'Civil'], ['workforceElectrical', 'Electrical'], ['workforcePlumbing', 'Plumbing'], ['workforceSupervisors', 'Supervisors']].map(([f, l]) => (
                  <Grid item xs={6} sm={3} key={f}>
                    <TextField fullWidth label={l} type="number" value={form[f]} onChange={setNum(f)} size="small" />
                  </Grid>
                ))}
              </Grid>
            </Grid>

            <Grid item xs={12}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle2">Work Done Today</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={addWorkDone}>Add</Button>
              </Stack>
              {form.workDone.map((wd, idx) => (
                <Stack key={idx} direction="row" gap={1} sx={{ mt: 1 }} alignItems="flex-start">
                  <TextField size="small" label="Task" value={wd.taskTitle} onChange={setWorkDone(idx, 'taskTitle')} sx={{ width: 160 }} />
                  <TextField size="small" label="Description" value={wd.description} onChange={setWorkDone(idx, 'description')} sx={{ flex: 1 }} />
                  <TextField size="small" label="Progress %" type="number" value={wd.progressToday} onChange={setWorkDone(idx, 'progressToday')} sx={{ width: 90 }} />
                  <IconButton size="small" onClick={() => removeWorkDone(idx)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              ))}
            </Grid>

            <Grid item xs={12}>
              <TextField fullWidth multiline rows={3} label="Summary of Day's Work" value={form.summary} onChange={set('summary')} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth multiline rows={2} label="Next Day Plan" value={form.nextDayPlan} onChange={set('nextDayPlan')} />
            </Grid>

            <Grid item xs={12}>
              <Stack direction="row" alignItems="center" gap={1}>
                <Button
                  variant="outlined"
                  startIcon={<PhotoIcon />}
                  onClick={() => fileInputRef.current?.click()}
                  size="small"
                >
                  Attach Photos ({photos.length})
                </Button>
                <input ref={fileInputRef} type="file" multiple accept="image/*" hidden onChange={handlePhotoSelect} />
              </Stack>
              {photos.length > 0 && (
                <Stack direction="row" gap={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                  {photos.map((p, i) => (
                    <Box key={i} position="relative">
                      <Box component="img" src={p.preview} alt={`photo-${i}`}
                        sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 1 }} />
                      <IconButton size="small" sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'background.paper' }}
                        onClick={() => setPhotos(prev => prev.filter((_, pi) => pi !== i))}>
                        <DeleteIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
              )}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'Submit DPR'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const MainKpi = ({ label, value, hint, accent = '#0f766e' }) => (
  <Box
    sx={{
      p: 2,
      height: '100%',
      borderRadius: 2,
      bgcolor: '#fff',
      border: '1px solid',
      borderColor: 'rgba(15, 118, 110, 0.14)',
      borderTop: `3px solid ${accent}`,
      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
    }}
  >
    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
      {label}
    </Typography>
    <Typography variant="h6" fontWeight={800} sx={{ mt: 0.5, color: '#0f172a', lineHeight: 1.2 }}>
      {value}
    </Typography>
    {hint && (
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {hint}
      </Typography>
    )}
  </Box>
);

// ─── Main portfolio overview (distinct from Sub execution view) ───────────────
const MainProjectOverview = ({ project, onRefresh }) => {
  const navigate = useNavigate();
  const alloc = project.budgetAllocation || {};
  const [lumpInput, setLumpInput] = useState(String(project.lumpSumBudget || alloc.lumpSumBudget || ''));
  const [rowAmounts, setRowAmounts] = useState({});
  const [savingLump, setSavingLump] = useState(false);
  const [savingAlloc, setSavingAlloc] = useState(false);
  const [budgetActionLoading, setBudgetActionLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    setLumpInput(String(project.lumpSumBudget || alloc.lumpSumBudget || ''));
    const next = {};
    (alloc.subProjects || []).forEach((s) => {
      next[s._id] = String(s.allocatedBudget || '');
    });
    setRowAmounts(next);
  }, [project._id, project.lumpSumBudget, project.budgetStatus, alloc.lumpSumBudget, alloc.totalAllocated, alloc.subProjects]);

  const lump = Number(alloc.lumpSumBudget) || Number(project.lumpSumBudget) || 0;
  const totalAllocated = Number(alloc.totalAllocated) || 0;
  const remaining = Number(alloc.remaining) || Math.max(0, lump - totalAllocated);
  const usedPct = lump > 0 ? Math.min(100, Math.round((totalAllocated / lump) * 100)) : 0;
  const spent = Number(project.totalActualSpent) || 0;
  const subs = alloc.subProjects || [];

  const handleSaveLump = async () => {
    setSavingLump(true);
    setErr('');
    setMsg('');
    try {
      await setLumpSumBudget(project._id, Number(lumpInput) || 0);
      setMsg('Lump-sum budget saved');
      onRefresh();
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to save lump-sum budget');
    } finally {
      setSavingLump(false);
    }
  };

  const handleSaveAllocations = async () => {
    setSavingAlloc(true);
    setErr('');
    setMsg('');
    try {
      const allocations = subs.map((s) => ({
        subProjectId: s._id,
        amount: Number(rowAmounts[s._id]) || 0
      }));
      await allocateBudgetToSubs(project._id, allocations);
      setMsg('Budget allocated to sub projects');
      onRefresh();
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to allocate budget');
    } finally {
      setSavingAlloc(false);
    }
  };

  const handleBudgetAction = async (action) => {
    setBudgetActionLoading(true);
    setErr('');
    setMsg('');
    try {
      await updateBudgetStatus(project._id, action);
      setMsg(`Budget ${action}d`);
      onRefresh();
    } catch (e) {
      setErr(e.response?.data?.message || `Failed to ${action} budget`);
    } finally {
      setBudgetActionLoading(false);
    }
  };

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <MainKpi label="Lump Sum" value={fmt(lump)} hint={`Status: ${project.budgetStatus || 'Draft'}`} accent="#0f766e" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MainKpi label="Allocated" value={fmt(totalAllocated)} hint={`${usedPct}% of envelope`} accent="#0369a1" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MainKpi
            label="Remaining"
            value={fmt(remaining)}
            hint={remaining === 0 && lump > 0 ? 'Fully allocated' : 'Still available'}
            accent={remaining === 0 && lump > 0 ? '#15803d' : '#b45309'}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MainKpi label="Portfolio Progress" value={`${project.overallProgress || 0}%`} hint={`Spent ${fmt(spent)}`} accent="#334155" />
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={8}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2, sm: 2.5 },
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'rgba(15, 118, 110, 0.18)',
              background: 'linear-gradient(180deg, #f0fdfa 0%, #ffffff 42%)'
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
              <Box>
                <Stack direction="row" alignItems="center" gap={1}>
                  <MoneyIcon sx={{ color: '#0f766e' }} />
                  <Typography variant="h6" fontWeight={800} sx={{ color: '#134e4a' }}>
                    Budget Envelope
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Set one lump-sum pool for the Main project, then distribute to Subs.
                </Typography>
              </Box>
              <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                <Chip
                  label={project.budgetStatus}
                  size="small"
                  color={project.budgetStatus === 'Approved' ? 'success' : project.budgetStatus === 'Submitted' ? 'warning' : 'default'}
                  sx={{ fontWeight: 700 }}
                />
                {project.budgetStatus === 'Draft' && (
                  <Button size="small" variant="outlined" disabled={budgetActionLoading || lump <= 0} onClick={() => handleBudgetAction('submit')}>
                    Submit
                  </Button>
                )}
                {project.budgetStatus === 'Submitted' && (
                  <Button size="small" variant="contained" color="success" disabled={budgetActionLoading} onClick={() => handleBudgetAction('approve')}>
                    Approve
                  </Button>
                )}
                {(project.budgetStatus === 'Submitted' || project.budgetStatus === 'Approved') && (
                  <Button size="small" disabled={budgetActionLoading} onClick={() => handleBudgetAction('reset')}>
                    Reset
                  </Button>
                )}
              </Stack>
            </Stack>

            {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}
            {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}

            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="Lump Sum Budget (PKR)"
                type="number"
                value={lumpInput}
                onChange={(e) => setLumpInput(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start">Rs</InputAdornment> }}
                sx={{ maxWidth: { sm: 320 }, bgcolor: '#fff' }}
              />
              <Button variant="contained" onClick={handleSaveLump} disabled={savingLump} sx={{ bgcolor: '#0f766e', '&:hover': { bgcolor: '#0d9488' } }}>
                {savingLump ? 'Saving…' : 'Save Envelope'}
              </Button>
            </Stack>

            <Box sx={{ mb: 1 }}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">Allocation coverage</Typography>
                <Typography variant="caption" fontWeight={700}>{usedPct}%</Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={usedPct}
                sx={{
                  height: 10,
                  borderRadius: 999,
                  bgcolor: 'rgba(15, 118, 110, 0.12)',
                  '& .MuiLinearProgress-bar': { bgcolor: '#0f766e', borderRadius: 999 }
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {fmt(totalAllocated)} allocated · {fmt(remaining)} remaining
            </Typography>
          </Paper>

          <Paper
            elevation={0}
            sx={{
              mt: 2.5,
              p: { xs: 2, sm: 2.5 },
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: '#fff'
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
              <Box>
                <Typography variant="h6" fontWeight={800}>Allocate to Sub Projects</Typography>
                <Typography variant="body2" color="text.secondary">
                  Assign each Sub its share of the Main envelope.
                </Typography>
              </Box>
              <Button
                variant="contained"
                onClick={handleSaveAllocations}
                disabled={savingAlloc || lump <= 0 || !subs.length}
                sx={{ bgcolor: '#0f766e', '&:hover': { bgcolor: '#0d9488' } }}
              >
                {savingAlloc ? 'Saving…' : 'Save Allocations'}
              </Button>
            </Stack>

            {!subs.length ? (
              <Alert severity="info">Create Sub Projects under this Main first, then allocate budget here.</Alert>
            ) : (
              <TableContainer sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell sx={{ fontWeight: 700 }}>Sub Project</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Sector</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>Allocated (PKR)</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Budget</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {subs.map((s) => (
                      <TableRow key={s._id} hover>
                        <TableCell>
                          <Typography
                            variant="body2"
                            fontWeight={700}
                            sx={{ cursor: 'pointer', color: '#0f766e', '&:hover': { textDecoration: 'underline' } }}
                            onClick={() => navigate(`/general/project-management/${s._id}`)}
                          >
                            {s.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">{s.projectNumber}</Typography>
                        </TableCell>
                        <TableCell>{s.sector || '—'}</TableCell>
                        <TableCell>
                          <Typography variant="caption">{s.projectType}</Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ minWidth: 150 }}>
                          <TextField
                            size="small"
                            type="number"
                            value={rowAmounts[s._id] ?? ''}
                            onChange={(e) => setRowAmounts((prev) => ({ ...prev, [s._id]: e.target.value }))}
                            inputProps={{ min: 0, style: { textAlign: 'right' } }}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip label={s.budgetStatus || 'Draft'} size="small" variant="outlined" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: '#0f172a',
              color: '#e2e8f0',
              mb: 2.5
            }}
          >
            <Typography variant="overline" sx={{ color: '#94a3b8', letterSpacing: 1.2 }}>Portfolio</Typography>
            <Typography variant="h6" fontWeight={800} sx={{ color: '#fff', mb: 2 }}>{project.name}</Typography>
            <Stack spacing={1.25}>
              {[
                ['Code', project.projectNumber],
                ['Society', project.society || '—'],
                ['Status', project.status],
                ['Start', project.startDate ? dayjs(project.startDate).format('DD MMM YYYY') : '—'],
                ['Expected End', project.expectedEndDate ? dayjs(project.expectedEndDate).format('DD MMM YYYY') : '—'],
                ['Sub Projects', String(subs.length)]
              ].map(([label, value]) => (
                <Stack key={label} direction="row" justifyContent="space-between" gap={1}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>{label}</Typography>
                  <Typography variant="caption" fontWeight={700} align="right" sx={{ color: '#f8fafc' }}>{value}</Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 2.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1.5 }}>
              <TreeIcon sx={{ color: '#0f766e' }} fontSize="small" />
              <Typography variant="subtitle1" fontWeight={800}>Sub Projects</Typography>
            </Stack>
            {!subs.length ? (
              <Typography variant="body2" color="text.secondary">No sub projects yet.</Typography>
            ) : (
              <Stack spacing={1}>
                {subs.map((s) => (
                  <Box
                    key={s._id}
                    onClick={() => navigate(`/general/project-management/${s._id}`)}
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      cursor: 'pointer',
                      transition: 'all .15s ease',
                      '&:hover': { borderColor: '#0f766e', bgcolor: 'rgba(15, 118, 110, 0.04)' }
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                      <Box>
                        <Typography variant="body2" fontWeight={700}>{s.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {[s.sector, s.projectType].filter(Boolean).join(' · ') || s.projectNumber}
                        </Typography>
                      </Box>
                      <Typography variant="caption" fontWeight={800} sx={{ color: '#0f766e' }}>
                        {fmt(s.allocatedBudget)}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

// ─── Sub project budget (allocated ceiling + segregated categories) ───────────
const SubBudgetPanel = ({ project, onRefresh }) => {
  const ceiling = Number(project.allocatedBudget) || 0;
  const locked = project.budgetStatus === 'Approved';
  const [cats, setCats] = useState([]);
  const [saving, setSaving] = useState(false);
  const [budgetActionLoading, setBudgetActionLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const existing = project.budgetCategories || [];
    const byName = new Map(existing.map((c) => [c.category, c]));
    setCats(BUDGET_CATEGORIES.map((name) => ({
      category: name,
      estimatedAmount: byName.get(name)?.estimatedAmount || 0,
      approvedAmount: byName.get(name)?.approvedAmount || 0
    })));
  }, [project._id, project.budgetCategories, project.allocatedBudget]);

  const amountByName = (name) => Number(cats.find((c) => c.category === name)?.estimatedAmount) || 0;
  const setAmount = (name, value) => {
    setCats((prev) => prev.map((c) => (
      c.category === name ? { ...c, estimatedAmount: Math.max(0, Number(value) || 0) } : c
    )));
  };

  const catTotal = cats.reduce((s, c) => s + (Number(c.estimatedAmount) || 0), 0);
  const remaining = Math.max(0, ceiling - catTotal);
  const over = catTotal > ceiling && ceiling > 0;
  const coverage = ceiling > 0 ? Math.min(100, Math.round((catTotal / ceiling) * 100)) : 0;
  const parentName = project.parentProject?.name || 'Main Project';

  const handleSaveCategories = async () => {
    if (over) {
      setErr(`Category total (${fmt(catTotal)}) exceeds allocated budget (${fmt(ceiling)})`);
      return;
    }
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      await updateProject(project._id, { budgetCategories: cats });
      setMsg('Category budget saved');
      onRefresh();
    } catch (e) {
      setErr(e.response?.data?.message || 'Failed to save categories');
    } finally {
      setSaving(false);
    }
  };

  const handleBudgetAction = async (action) => {
    setBudgetActionLoading(true);
    setErr('');
    setMsg('');
    try {
      await updateBudgetStatus(project._id, action);
      setMsg(`Budget ${action}d`);
      onRefresh();
    } catch (e) {
      setErr(e.response?.data?.message || `Failed to ${action} budget`);
    } finally {
      setBudgetActionLoading(false);
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      {/* Ceiling banner */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 2.5 },
          mb: 2,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: over ? 'error.light' : 'rgba(29, 78, 216, 0.2)',
          background: over
            ? 'linear-gradient(135deg, #fef2f2 0%, #fff 70%)'
            : 'linear-gradient(135deg, #eff6ff 0%, #ffffff 55%)'
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
          <Box>
            <Typography variant="overline" sx={{ color: '#64748b', letterSpacing: 1.1, fontWeight: 700 }}>
              Budget Allocation · Sub Project
            </Typography>
            <Typography variant="h6" fontWeight={800} sx={{ color: '#0f172a' }}>
              Distribute allocated funds by category
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Ceiling from <strong>{parentName}</strong> — segregate into groups, then submit for approval.
            </Typography>
          </Box>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Chip
              label={project.budgetStatus}
              size="small"
              color={project.budgetStatus === 'Approved' ? 'success' : project.budgetStatus === 'Submitted' ? 'warning' : 'default'}
              sx={{ fontWeight: 700 }}
            />
            {project.budgetStatus === 'Draft' && (
              <Button size="small" variant="outlined" disabled={budgetActionLoading || ceiling <= 0} onClick={() => handleBudgetAction('submit')}>
                Submit Budget
              </Button>
            )}
            {project.budgetStatus === 'Submitted' && (
              <Button size="small" variant="contained" color="success" disabled={budgetActionLoading} onClick={() => handleBudgetAction('approve')}>
                Approve
              </Button>
            )}
            {(project.budgetStatus === 'Submitted' || project.budgetStatus === 'Approved') && (
              <Button size="small" disabled={budgetActionLoading} onClick={() => handleBudgetAction('reset')}>
                Reset
              </Button>
            )}
          </Stack>
        </Stack>

        {ceiling <= 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No budget allocated yet. Open the Main Project and allocate lump-sum budget to this Sub first.
          </Alert>
        )}
        {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}
        {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
        {over && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Category total exceeds the Main allocation by {fmt(catTotal - ceiling)}. Reduce one or more categories.
          </Alert>
        )}

        <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
          {[
            { label: 'Allocated from Main', value: fmt(ceiling), color: '#1d4ed8' },
            { label: 'Distributed', value: fmt(catTotal), color: over ? '#b91c1c' : '#0f172a' },
            { label: 'Unassigned', value: fmt(remaining), color: remaining === 0 && ceiling > 0 ? '#15803d' : '#b45309' },
            { label: 'Coverage', value: `${coverage}%`, color: '#334155' }
          ].map((kpi) => (
            <Grid item xs={6} md={3} key={kpi.label}>
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: '#fff',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderLeft: `3px solid ${kpi.color}`
                }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {kpi.label}
                </Typography>
                <Typography variant="subtitle1" fontWeight={800} sx={{ color: kpi.color, mt: 0.25 }}>
                  {kpi.value}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>

        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">Distribution vs allocation</Typography>
          <Typography variant="caption" fontWeight={700}>{coverage}%</Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={Math.min(coverage, 100)}
          color={over ? 'error' : 'primary'}
          sx={{ height: 10, borderRadius: 999, bgcolor: 'rgba(29, 78, 216, 0.12)' }}
        />
      </Paper>

      {/* Grouped category tables */}
      <Stack spacing={2}>
        {BUDGET_CATEGORY_GROUPS.map((group) => {
          const groupTotal = group.categories.reduce((s, name) => s + amountByName(name), 0);
          const groupPct = ceiling > 0 ? Math.round((groupTotal / ceiling) * 100) : 0;
          return (
            <Paper
              key={group.id}
              elevation={0}
              sx={{
                borderRadius: 2.5,
                border: '1px solid',
                borderColor: 'divider',
                overflow: 'hidden',
                bgcolor: '#fff'
              }}
            >
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 1,
                  flexWrap: 'wrap',
                  bgcolor: `${group.accent}0d`,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  borderLeft: `4px solid ${group.accent}`
                }}
              >
                <Box>
                  <Typography variant="subtitle1" fontWeight={800} sx={{ color: group.accent }}>
                    {group.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{group.subtitle}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="subtitle2" fontWeight={800}>{fmt(groupTotal)}</Typography>
                  <Typography variant="caption" color="text.secondary">{groupPct}% of allocation</Typography>
                </Box>
              </Box>

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell sx={{ fontWeight: 700, width: '36%' }}>Category</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: '28%' }} align="right">Amount (PKR)</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: '12%' }} align="right">Share</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: '24%' }}>Of allocation</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {group.categories.map((name) => {
                      const amount = amountByName(name);
                      const share = ceiling > 0 ? Math.min(100, (amount / ceiling) * 100) : 0;
                      return (
                        <TableRow key={name} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>{name}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <TextField
                              size="small"
                              type="number"
                              value={amount || ''}
                              disabled={locked || ceiling <= 0}
                              onChange={(e) => setAmount(name, e.target.value)}
                              inputProps={{ min: 0, style: { textAlign: 'right' } }}
                              sx={{ width: { xs: 120, sm: 160 } }}
                              InputProps={{
                                startAdornment: <InputAdornment position="start">Rs</InputAdornment>
                              }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="caption" fontWeight={700}>
                              {share ? `${share.toFixed(1)}%` : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <LinearProgress
                              variant="determinate"
                              value={share}
                              sx={{
                                height: 6,
                                borderRadius: 999,
                                bgcolor: 'rgba(15, 23, 42, 0.06)',
                                '& .MuiLinearProgress-bar': { bgcolor: group.accent, borderRadius: 999 }
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={800}>Group total</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={800}>{fmt(groupTotal)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="caption" fontWeight={700}>{groupPct}%</Typography>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          );
        })}
      </Stack>

      {!locked && (
        <Paper
          elevation={0}
          sx={{
            mt: 2,
            p: 2,
            borderRadius: 2.5,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: '#fff',
            position: 'sticky',
            bottom: 8,
            zIndex: 2
          }}
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1.5}>
            <Box>
              <Typography variant="body2" fontWeight={700}>
                Total distributed: {fmt(catTotal)}
                {ceiling > 0 && (
                  <Typography component="span" variant="body2" color="text.secondary"> · Remaining {fmt(remaining)}</Typography>
                )}
              </Typography>
              <Typography variant="caption" color={over ? 'error.main' : 'text.secondary'}>
                {over ? 'Fix over-allocation before saving' : 'Save categories, then Submit → Approve'}
              </Typography>
            </Box>
            <Button
              variant="contained"
              onClick={handleSaveCategories}
              disabled={saving || ceiling <= 0 || over}
              sx={{ minWidth: 160 }}
            >
              {saving ? 'Saving…' : 'Save Category Budget'}
            </Button>
          </Stack>
        </Paper>
      )}
    </Box>
  );
};

// ─── Overview Tab ─────────────────────────────────────────────────────────────
const OverviewTab = ({ project, onRefresh }) => (
  !project.parentProject
    ? <MainProjectOverview project={project} onRefresh={onRefresh} />
    : <SubProjectOverview project={project} onRefresh={onRefresh} />
);

const SubProjectOverview = ({ project, onRefresh }) => {
  const [msDialogOpen, setMsDialogOpen] = useState(false);
  const [editMs, setEditMs] = useState(null);
  const [viewMs, setViewMs] = useState(null);
  const [msForm, setMsForm] = useState({ title: '', description: '', plannedDate: '', billingTrigger: false, billingPercentage: 0, notes: '' });
  const [msError, setMsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [genInvLoading, setGenInvLoading] = useState(null);
  const [genInvSuccess, setGenInvSuccess] = useState('');
  const [genInvError, setGenInvError] = useState('');

  const openAddMs = () => {
    setEditMs(null);
    setMsForm({ title: '', description: '', plannedDate: '', billingTrigger: false, billingPercentage: 0, notes: '' });
    setMsDialogOpen(true);
  };

  const openEditMs = (ms) => {
    setEditMs(ms);
    setMsForm({
      title: ms.title, description: ms.description || '',
      plannedDate: ms.plannedDate ? dayjs(ms.plannedDate).format('YYYY-MM-DD') : '',
      status: ms.status, completionPercentage: ms.completionPercentage || 0,
      billingTrigger: ms.billingTrigger || false,
      billingPercentage: ms.billingPercentage || 0, notes: ms.notes || ''
    });
    setMsDialogOpen(true);
  };

  const handleSaveMs = async () => {
    if (!msForm.title) { setMsError('Title is required'); return; }
    setSaving(true);
    try {
      if (editMs) {
        await updateMilestone(project._id, editMs._id, msForm);
      } else {
        await addMilestone(project._id, msForm);
      }
      setMsDialogOpen(false);
      onRefresh();
    } catch (err) {
      setMsError(err.response?.data?.message || 'Failed to save milestone');
    } finally { setSaving(false); }
  };

  const handleDeleteMs = async (msId) => {
    if (!window.confirm('Delete this milestone?')) return;
    try {
      await deleteMilestone(project._id, msId);
      onRefresh();
    } catch { /* silent */ }
  };

  const handleGenerateInvoice = async (ms) => {
    if (!project.contractValue) {
      setGenInvError('Set the project contract value first before generating invoices.');
      return;
    }
    setGenInvLoading(ms._id);
    setGenInvError(''); setGenInvSuccess('');
    try {
      const res = await generateMilestoneInvoice(project._id, ms._id);
      setGenInvSuccess(res.data?.message || 'Invoice generated');
    } catch (err) {
      setGenInvError(err.response?.data?.message || 'Failed to generate invoice');
    } finally { setGenInvLoading(null); }
  };

  const setMs = (field) => (e) => setMsForm(prev => ({ ...prev, [field]: e.target.value }));

  const displayBudget = project.allocatedBudget || project.totalApprovedBudget || project.totalEstimatedCost;
  const budgetPct = pct(project.totalActualSpent, displayBudget);
  const daysLeft = project.expectedEndDate
    ? dayjs(project.expectedEndDate).diff(dayjs(), 'day')
    : null;

  return (
    <Grid container spacing={3}>
      {/* Key Metrics */}
      <Grid item xs={12} md={8}>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Progress</Typography>
                <Typography variant="h5" fontWeight={700} color="primary.main">
                  {project.overallProgress || 0}%
                </Typography>
                <LinearProgress variant="determinate" value={project.overallProgress || 0} sx={{ mt: 0.5, height: 6, borderRadius: 3 }} />
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Allocated Budget</Typography>
                <Typography variant="h6" fontWeight={700}>{fmt(displayBudget)}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Spent</Typography>
                <Typography variant="h6" fontWeight={700} color={budgetPct > 90 ? 'error.main' : 'text.primary'}>
                  {fmt(project.totalActualSpent)}
                </Typography>
                <Typography variant="caption" color="text.secondary">{budgetPct}% of budget</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Days Remaining</Typography>
                <Typography variant="h6" fontWeight={700} color={daysLeft !== null && daysLeft < 0 ? 'error.main' : 'text.primary'}>
                  {daysLeft !== null ? (daysLeft < 0 ? `${Math.abs(daysLeft)} overdue` : daysLeft) : '—'}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        <SubBudgetPanel project={project} onRefresh={onRefresh} />
      </Grid>

      {/* Project Details */}
      <Grid item xs={12} md={4}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>Project Details</Typography>
            <Divider sx={{ mb: 1.5 }} />
            {[
              ['Type', project.projectType],
              ['Client', project.clientName],
              ['Contact', project.clientContact],
              ['Society', project.society],
              ['Sector', project.sector],
              ['Plot #', project.plotNumber],
              ['Address', project.address],
              ['Manager', project.projectManager ? `${project.projectManager.firstName} ${project.projectManager.lastName}` : null],
              ['Start Date', project.startDate ? dayjs(project.startDate).format('DD MMM YYYY') : null],
              ['Expected End', project.expectedEndDate ? dayjs(project.expectedEndDate).format('DD MMM YYYY') : null],
            ].filter(([, v]) => v).map(([label, value]) => (
              <Stack key={label} direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography variant="caption" align="right" sx={{ maxWidth: '60%', wordBreak: 'break-word' }}>{value}</Typography>
              </Stack>
            ))}
          </CardContent>
        </Card>
      </Grid>

      {/* Milestones */}
      <Grid item xs={12}>
        <SectionHeader
          title="Project Milestones"
          action={<Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openAddMs}>Add Milestone</Button>}
        />

        {genInvSuccess && <Alert severity="success" onClose={() => setGenInvSuccess('')} sx={{ mb: 2 }}>{genInvSuccess}</Alert>}
        {genInvError && <Alert severity="error" onClose={() => setGenInvError('')} sx={{ mb: 2 }}>{genInvError}</Alert>}

        {!project.milestones?.length ? (
          <EmptyState icon={FlagIcon} text="No milestones defined"
            action={<Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={openAddMs}>Add First Milestone</Button>} />
        ) : (
          <Grid container spacing={2}>
            {project.milestones.map((ms, idx) => (
              <Grid item xs={12} sm={6} md={4} key={ms._id || idx}>
                <Card variant="outlined">
                  <CardContent sx={{ pb: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2" fontWeight={600} noWrap>{ms.title}</Typography>
                        <Chip label={ms.status} size="small" color={MS_STATUS_COLOR[ms.status] || 'default'} sx={{ mt: 0.5 }} />
                      </Box>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="View Milestone Details">
                          <IconButton size="small" color="info" onClick={() => setViewMs(ms)}>
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit Milestone">
                          <IconButton size="small" color="primary" onClick={() => openEditMs(ms)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete Milestone">
                          <IconButton size="small" color="error" onClick={() => handleDeleteMs(ms._id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>
                    {ms.description && <Typography variant="caption" color="text.secondary">{ms.description}</Typography>}
                    {ms.plannedDate && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        Planned: {dayjs(ms.plannedDate).format('DD MMM YYYY')}
                      </Typography>
                    )}
                    {ms.completionPercentage > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <LinearProgress variant="determinate" value={ms.completionPercentage} sx={{ height: 4, borderRadius: 2 }} />
                        <Typography variant="caption">{ms.completionPercentage}% complete</Typography>
                      </Box>
                    )}
                    {ms.billingTrigger && (
                      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1 }}>
                        <Chip
                          icon={<InvoiceIcon />}
                          label={`Bill ${ms.billingPercentage}% of contract`}
                          size="small" color="warning" variant="outlined"
                        />
                        <Tooltip title={project.contractValue ? `Generate invoice for ${fmt((ms.billingPercentage / 100) * project.contractValue)}` : 'Set contract value first'}>
                          <span>
                            <Button
                              size="small" variant="outlined" color="warning"
                              startIcon={genInvLoading === ms._id ? <CircularProgress size={12} /> : <InvoiceIcon />}
                              onClick={() => handleGenerateInvoice(ms)}
                              disabled={genInvLoading === ms._id}
                              sx={{ mt: 0.5, fontSize: '0.65rem', py: 0.3 }}
                            >
                              {genInvLoading === ms._id ? 'Generating…' : 'Generate Invoice'}
                            </Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {/* Milestone Dialog */}
        <Dialog open={msDialogOpen} onClose={() => setMsDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{editMs ? 'Edit Milestone' : 'Add Milestone'}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            {msError && <Alert severity="error" sx={{ mb: 2 }}>{msError}</Alert>}
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField fullWidth required label="Milestone Title" value={msForm.title} onChange={setMs('title')} />
              </Grid>
              <Grid item xs={12}>
                <TextField fullWidth label="Description" value={msForm.description} onChange={setMs('description')} multiline rows={2} />
              </Grid>
              <Grid item xs={6}>
                <TextField fullWidth type="date" label="Planned Date" value={msForm.plannedDate}
                  onChange={setMs('plannedDate')} InputLabelProps={{ shrink: true }} />
              </Grid>
              {editMs && (
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>Status</InputLabel>
                    <Select value={msForm.status || 'Pending'} label="Status" onChange={setMs('status')}>
                      {['Pending', 'In Progress', 'Completed', 'Delayed'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              )}
              {editMs && (
                <Grid item xs={6}>
                  <TextField fullWidth label="Completion %" type="number" value={msForm.completionPercentage}
                    onChange={setMs('completionPercentage')} InputProps={{ inputProps: { min: 0, max: 100 } }} />
                </Grid>
              )}
              <Grid item xs={6}>
                <TextField fullWidth label="Billing % (if milestone billing)" type="number"
                  value={msForm.billingPercentage} onChange={setMs('billingPercentage')}
                  helperText="% of contract value to invoice" />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setMsDialogOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleSaveMs} disabled={saving}>
              {saving ? 'Saving…' : editMs ? 'Update' : 'Add'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* View Milestone Details Dialog */}
        <Dialog open={Boolean(viewMs)} onClose={() => setViewMs(null)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ m: 0, p: 2, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <FlagIcon color="primary" />
              <Typography variant="h6" fontWeight={700}>Milestone Details</Typography>
            </Stack>
            {viewMs?.status && (
              <Chip label={viewMs.status} size="small" color={MS_STATUS_COLOR[viewMs.status] || 'default'} />
            )}
          </DialogTitle>
          <Divider />
          {viewMs && (
            <DialogContent sx={{ p: 2.5 }}>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>MILESTONE TITLE</Typography>
                  <Typography variant="subtitle1" fontWeight={700}>{viewMs.title}</Typography>
                </Box>

                {viewMs.description && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>DESCRIPTION</Typography>
                    <Typography variant="body2" sx={{ bgcolor: 'action.hover', p: 1.5, borderRadius: 1 }}>{viewMs.description}</Typography>
                  </Box>
                )}

                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">PLANNED COMPLETION DATE</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {viewMs.plannedDate ? dayjs(viewMs.plannedDate).format('DD MMMM YYYY') : 'Not specified'}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">ACTUAL DATE</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {viewMs.actualDate ? dayjs(viewMs.actualDate).format('DD MMMM YYYY') : 'Pending Completion'}
                    </Typography>
                  </Grid>
                </Grid>

                <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>PHYSICAL COMPLETION</Typography>
                    <Typography variant="body2" fontWeight={700}>{viewMs.completionPercentage || 0}%</Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={viewMs.completionPercentage || 0}
                    sx={{ height: 8, borderRadius: 4, bgcolor: 'grey.200' }}
                  />
                </Box>

                <Box sx={{ p: 2, border: '1px solid', borderColor: 'warning.light', borderRadius: 2, bgcolor: 'warning.50' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="warning.dark" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <InvoiceIcon fontSize="small" /> Milestone Billing & Invoicing
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary" display="block">Billing Trigger:</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {viewMs.billingTrigger || viewMs.billingPercentage > 0 ? 'Enabled' : 'Disabled'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary" display="block">Billing Percentage:</Typography>
                      <Typography variant="body2" fontWeight={600}>{viewMs.billingPercentage || 0}% of Contract</Typography>
                    </Grid>
                    {Boolean(viewMs.billingPercentage > 0) && (
                      <Grid item xs={12} sx={{ mt: 1 }}>
                        <Typography variant="caption" color="text.secondary" display="block">Estimated Billable Amount:</Typography>
                        <Typography variant="subtitle1" fontWeight={700} color="success.main">
                          {project.contractValue ? fmt((viewMs.billingPercentage / 100) * project.contractValue) : 'Contract value not configured'}
                        </Typography>
                      </Grid>
                    )}
                  </Grid>

                  {(viewMs.billingTrigger || viewMs.billingPercentage > 0) && (
                    <Button
                      size="small" variant="contained" color="warning"
                      startIcon={genInvLoading === viewMs._id ? <CircularProgress size={14} color="inherit" /> : <InvoiceIcon />}
                      onClick={() => {
                        const targetMs = viewMs;
                        setViewMs(null);
                        handleGenerateInvoice(targetMs);
                      }}
                      disabled={genInvLoading === viewMs._id}
                      sx={{ mt: 1.5, width: '100%' }}
                    >
                      {genInvLoading === viewMs._id ? 'Generating Invoice…' : 'Generate Milestone Invoice'}
                    </Button>
                  )}
                </Box>

                {viewMs.notes && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>REMARKS / NOTES</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>{viewMs.notes}</Typography>
                  </Box>
                )}
              </Stack>
            </DialogContent>
          )}
          <DialogActions sx={{ p: 2, pt: 1 }}>
            <Button variant="outlined" startIcon={<EditIcon />} onClick={() => { const target = viewMs; setViewMs(null); openEditMs(target); }}>
              Edit Milestone
            </Button>
            <Button variant="contained" onClick={() => setViewMs(null)}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      </Grid>
    </Grid>
  );
};

// ─── Main Detail Page ─────────────────────────────────────────────────────────
/** Construction project detail — Main: Overview + BOQ; Sub: full execution tabs. */
const ProjectDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (id) {
      localStorage.setItem('pmLastProjectId', id);
    }
  }, [id]);

  const loadProject = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getProjectById(id);
      setProject(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load project');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadProject(); }, [loadProject]);

  const isMainProject = project ? !project.parentProject : false;
  const visibleTabs = getVisibleTabs(isMainProject);
  const activeTab = visibleTabs[Math.min(tab, Math.max(0, visibleTabs.length - 1))] || visibleTabs[0];

  useEffect(() => {
    if (!project) return;
    const tabs = getVisibleTabs(!project.parentProject);
    const raw = searchParams.get('tab');
    const tabParam = Number(raw || 0);
    const normalized = Number.isFinite(tabParam)
      ? Math.max(0, Math.min(tabs.length - 1, tabParam))
      : 0;
    setTab(normalized);
    // Clamp deep-links that point past Main's limited tabs (e.g. old ?tab=5)
    if (raw != null && Number(raw) !== normalized) {
      setSearchParams({ tab: String(normalized) }, { replace: true });
    }
  }, [project, searchParams, setSearchParams]);

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton height={60} sx={{ mb: 2 }} />
        <Skeleton height={200} />
      </Box>
    );
  }

  if (error || !project) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Project not found'}</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/general/project-management')} sx={{ mt: 2 }}>
          Back to Projects
        </Button>
      </Box>
    );
  }

  const alloc = project.budgetAllocation || {};
  const mainLump = Number(project.lumpSumBudget) || Number(alloc.lumpSumBudget) || 0;
  const mainAllocated = Number(alloc.totalAllocated) || 0;
  const mainRemaining = Number(alloc.remaining) || Math.max(0, mainLump - mainAllocated);

  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 3 },
        minHeight: '100%',
        bgcolor: isMainProject ? '#f1f5f9' : 'grey.50',
        backgroundImage: isMainProject
          ? 'radial-gradient(ellipse at top left, rgba(15,118,110,0.08), transparent 45%), radial-gradient(ellipse at top right, rgba(15,23,42,0.06), transparent 40%)'
          : 'none'
      }}
    >
      {/* Breadcrumb + Header */}
      <Paper
        elevation={0}
        sx={{
          mb: 3,
          p: { xs: 2, sm: 2.5 },
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: isMainProject ? 'rgba(15, 118, 110, 0.22)' : 'divider',
          overflow: 'hidden',
          position: 'relative',
          background: isMainProject
            ? 'linear-gradient(135deg, #0f172a 0%, #134e4a 55%, #0f766e 100%)'
            : 'linear-gradient(135deg, rgba(25,118,210,0.08) 0%, rgba(25,118,210,0.02) 100%)'
        }}
      >
        {isMainProject && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              opacity: 0.12,
              backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)',
              pointerEvents: 'none'
            }}
          />
        )}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" flexWrap="wrap" gap={1.5} sx={{ position: 'relative' }}>
          <Box>
            <Button
              startIcon={<BackIcon />}
              onClick={() => navigate('/general/project-management')}
              size="small"
              sx={{ mb: 1, color: isMainProject ? 'rgba(255,255,255,0.75)' : 'text.secondary' }}
            >
              Project Management
            </Button>
            <Stack direction="row" alignItems="center" gap={1.5}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: isMainProject ? 'rgba(255,255,255,0.12)' : 'rgba(25, 118, 210, 0.08)',
                  color: isMainProject ? '#fff' : 'primary.main'
                }}
              >
                {isMainProject ? <TreeIcon /> : <ConstructionIcon />}
              </Box>
              <Box>
                {isMainProject && (
                  <Typography
                    variant="caption"
                    sx={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}
                  >
                    Main Project · Portfolio Control
                  </Typography>
                )}
                <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                  <Typography variant="h5" fontWeight={800} sx={{ color: isMainProject ? '#fff' : 'inherit' }}>
                    {project.name}
                  </Typography>
                  <Chip
                    label={isMainProject ? 'Main' : 'Sub'}
                    size="small"
                    sx={isMainProject ? { bgcolor: 'rgba(255,255,255,0.16)', color: '#fff', fontWeight: 700 } : undefined}
                    color={isMainProject ? undefined : 'default'}
                  />
                  <Chip
                    label={project.status}
                    size="small"
                    color={STATUS_COLOR[project.status] || 'default'}
                    sx={isMainProject ? { bgcolor: 'rgba(255,255,255,0.9)', fontWeight: 600 } : undefined}
                  />
                </Stack>
                <Typography variant="body2" sx={{ color: isMainProject ? 'rgba(255,255,255,0.72)' : 'text.secondary' }}>
                  {project.projectNumber}
                  {!isMainProject && project.projectType ? ` · ${project.projectType}` : ''}
                  {project.society && ` · ${project.society}`}
                  {project.sector && `, ${project.sector}`}
                </Typography>
              </Box>
            </Stack>
          </Box>

          <Stack direction="row" gap={1} alignItems="center">
            <Tooltip title="Refresh">
              <IconButton
                onClick={loadProject}
                sx={isMainProject ? { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' } } : undefined}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {isMainProject && (
          <Grid container spacing={1.5} sx={{ mt: 2, position: 'relative' }}>
            {[
              { label: 'Lump Sum', value: fmt(mainLump) },
              { label: 'Allocated', value: fmt(mainAllocated) },
              { label: 'Remaining', value: fmt(mainRemaining) },
              { label: 'Progress', value: `${project.overallProgress || 0}%` }
            ].map((item) => (
              <Grid item xs={6} md={3} key={item.label}>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>{item.label}</Typography>
                  <Typography variant="subtitle1" fontWeight={800} sx={{ color: '#fff' }}>{item.value}</Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        )}
      </Paper>

      {!isMainProject && (
        <>
          <Card variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>
            <CardContent sx={{ py: 1.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">Overall Progress</Typography>
                <Typography variant="body2" fontWeight={600}>{project.overallProgress || 0}%</Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={project.overallProgress || 0}
                sx={{ height: 10, borderRadius: 5, mt: 0.5 }}
                color={project.overallProgress >= 80 ? 'success' : project.overallProgress >= 40 ? 'warning' : 'primary'}
              />
            </CardContent>
          </Card>

          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: '#fff' }}>
                <Typography variant="caption" color="text.secondary">Allocated Budget</Typography>
                <Typography variant="body2" fontWeight={700}>
                  {fmt(project.allocatedBudget || project.totalApprovedBudget || project.totalEstimatedCost)}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: '#fff' }}>
                <Typography variant="caption" color="text.secondary">Spent</Typography>
                <Typography variant="body2" fontWeight={700}>
                  {fmt(project.totalActualSpent || 0)}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: '#fff' }}>
                <Typography variant="caption" color="text.secondary">Timeline</Typography>
                <Typography variant="body2" fontWeight={700}>
                  {project.startDate ? dayjs(project.startDate).format('DD MMM YYYY') : '—'}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: '#fff' }}>
                <Typography variant="caption" color="text.secondary">Expected End</Typography>
                <Typography variant="body2" fontWeight={700}>
                  {project.expectedEndDate ? dayjs(project.expectedEndDate).format('DD MMM YYYY') : '—'}
                </Typography>
              </Paper>
            </Grid>
          </Grid>
        </>
      )}

      {/* Tabs */}
      <Box
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          mb: 2,
          bgcolor: '#fff',
          borderRadius: 2,
          px: 1,
          border: isMainProject ? '1px solid rgba(15, 118, 110, 0.16)' : undefined
        }}
      >
        <Tabs
          value={Math.min(tab, visibleTabs.length - 1)}
          onChange={(_, v) => {
            setTab(v);
            setSearchParams({ tab: String(v) }, { replace: true });
          }}
          variant="scrollable"
          scrollButtons="auto"
          textColor={isMainProject ? 'inherit' : 'primary'}
          TabIndicatorProps={isMainProject ? { style: { backgroundColor: '#0f766e' } } : undefined}
        >
          {visibleTabs.map((t) => (
            <Tab
              key={t.id}
              label={t.label}
              icon={t.icon}
              iconPosition="start"
              sx={isMainProject ? { '&.Mui-selected': { color: '#0f766e', fontWeight: 700 } } : undefined}
            />
          ))}
        </Tabs>
      </Box>

      <Paper
        variant="outlined"
        sx={{
          borderRadius: 2.5,
          bgcolor: '#fff',
          borderColor: isMainProject ? 'rgba(15, 118, 110, 0.16)' : 'divider'
        }}
      >
        {!isMainProject && (
          <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" alignItems="center" gap={1}>
              {activeTab?.icon}
              <Typography variant="subtitle1" fontWeight={700}>
                {activeTab?.label}
              </Typography>
            </Stack>
          </Box>
        )}
        <Box sx={{ p: { xs: 1.5, sm: isMainProject ? 2.5 : 2 } }}>
          {activeTab?.id === 'overview' && <OverviewTab project={project} onRefresh={loadProject} />}
          {activeTab?.id === 'boq' && <BOQTab projectId={id} project={project} />}
          {activeTab?.id === 'tasks' && <TasksTab projectId={id} />}
          {activeTab?.id === 'expenses' && <ExpensesTab projectId={id} project={project} />}
          {activeTab?.id === 'dpr' && <DPRTab projectId={id} />}
          {activeTab?.id === 'gantt' && <GanttChart project={project} />}
          {activeTab?.id === 'invoices' && <ProjectInvoicesTab project={project} />}
        </Box>
      </Paper>
    </Box>
  );
};

export default ProjectDetail;
