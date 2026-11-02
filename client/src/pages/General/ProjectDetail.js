import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ProjectInvoicesTab from './ProjectInvoicesTab';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, FormControl, Grid,
  IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Skeleton,
  Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Tabs, TextField, Tooltip, Typography, InputAdornment
} from '@mui/material';
import {
  Add as AddIcon, ArrowBack as BackIcon,
  BarChart as ChartIcon,
  Construction as ConstructionIcon, Delete as DeleteIcon, Edit as EditIcon,
  Refresh as RefreshIcon, Search as SearchIcon,
  ShoppingCart as POIcon, Receipt as InvoiceIcon,
  Visibility as ViewIcon,
  AccountTree as TreeIcon,
  FactCheck as CheckRequestIcon,
  Handshake as SubletIcon,
  DeleteForever as DeleteForeverIcon,
  Place as PlaceIcon, Person as PersonIcon, Event as EventIcon, Notes as NotesIcon,
  AccountBalanceWallet as WalletIcon,
  HomeWork as UnitsIcon
} from '@mui/icons-material';
import { usePagination } from '../../hooks/usePagination';
import TablePaginationWrapper from '../../components/TablePaginationWrapper';
import { Checkbox } from '@mui/material';
import dayjs from 'dayjs';
import {
  getProjectById,
  getBOQHeaders, createBOQHeader, updateBOQHeader, deleteBOQHeader, allocateBOQItem,
  getBOQ, addBOQItem, updateBOQItem, deleteBOQItem,
  updateBoqDiscount,
  createPOFromBOQ, getProjectPurchaseOrders,
  getProjectWorkflow
} from '../../services/projectManagementService';
import api from '../../services/api';
import CheckRequestsTab from './CheckRequestsTab';
import SubletContractsTab from './SubletContractsTab';
import UnitsTab, { unitWord } from './UnitsTab';
import PermanentDeleteProjectDialog from '../../components/ProjectManagement/PermanentDeleteProjectDialog';
import ProjectWorkflowStrip from '../../components/ProjectManagement/ProjectWorkflowStrip';
import MainProjectPage from '../../components/ProjectManagement/MainProjectPage';
import { ProjectStatusMenu } from '../../components/ProjectManagement/ProjectQuickMenus';
import ProjectBudgetPanel from '../../components/ProjectManagement/ProjectBudgetPanel';
import MainCostReport from '../../components/ProjectManagement/MainCostReport';
import { ContractTypeTag } from '../../components/ProjectManagement/mainProjectUi';
import { useAuth } from '../../contexts/AuthContext';

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

/** Main projects only show portfolio tabs; Subs get the full execution suite. */
const ALL_TABS = [
  { id: 'overview', label: 'Overview', icon: <ViewIcon fontSize="small" />, onMain: true, onSub: true },
  { id: 'units', label: 'Units', icon: <UnitsIcon fontSize="small" />, onMain: false, onSub: true },
  { id: 'boq', label: 'Bill of Quantities', icon: <POIcon fontSize="small" />, onMain: true, onSub: true },
  { id: 'sublet-contracts', label: 'Sublet Contracts', icon: <SubletIcon fontSize="small" />, onMain: false, onSub: true },
  { id: 'check-requests', label: 'Check Requests', icon: <CheckRequestIcon fontSize="small" />, onMain: false, onSub: true },
  { id: 'invoices', label: 'Invoices', icon: <InvoiceIcon fontSize="small" />, onMain: false, onSub: true },
  { id: 'cost', label: 'Cost Report', icon: <ChartIcon fontSize="small" />, onMain: true, onSub: true },
  { id: 'budget', label: 'Budget', icon: <ChartIcon fontSize="small" />, onMain: true, onSub: false }
];

/** Slab-wise projects have no Bill of Quantities: their contracts are paid by stage, not by measured quantities */
const getVisibleTabs = (isMain, basis, projectType) => ALL_TABS
  .filter((t) => (isMain ? t.onMain : t.onSub))
  .filter((t) => !(basis === 'Slab' && t.id === 'boq'))
  .map((t) => (t.id === 'units' ? { ...t, label: unitWord(projectType, true) } : t));

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
  const [allocForm, setAllocForm] = useState({ subProjectId: '', allocatedQuantity: '', notes: '' });
  const [allocSaving, setAllocSaving] = useState(false);
  const [childProjects, setChildProjects] = useState([]);


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
      const [boqRes, headersRes, posRes, projRes] = await Promise.all([
        getBOQ(projectId, params),
        getBOQHeaders(projectId).catch(() => ({ data: { data: [] } })),
        getProjectPurchaseOrders(projectId).catch(() => ({ data: { data: [] } })),
        api.get('/project-management/projects', { params: { limit: 100 } }).catch(() => ({ data: { data: { projects: [] } } }))
      ]);
      setData(boqRes.data?.data ?? null);
      setBoqHeaders(headersRes.data?.data || []);
      setWholeDiscount(String(boqRes.data?.data?.boqDiscountAmount ?? ''));
      pagination.setTotal(boqRes.data?.data?.pagination?.total || 0);
      setProjectPOs(posRes.data?.data || []);

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
      subProjectId: '',
      allocatedQuantity: '',
      notes: ''
    });
    setAllocateOpen(true);
  };

  const handleSaveAllocation = async () => {
    if (!allocForm.subProjectId) { setError('Select the Sub Project to allocate to'); return; }
    if (!allocForm.allocatedQuantity || Number(allocForm.allocatedQuantity) <= 0) {
      setError('Allocated quantity is required'); return;
    }
    setAllocSaving(true);
    try {
      await allocateBOQItem(projectId, allocForm);
      setSuccess('Quantity allocated to Sub Project');
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
    // Contractor + agreed rate are assigned via Sublet Contracts — do not send from BOQ item form
    const { contractor, contractorUnitPrice, ...rest } = form;
    const payload = {
      ...rest,
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
          <strong>Sub-Project BOQ:</strong> Shows items created on this Sub Project and items
          allocated from the Main Project. Subcontractors and their rates are assigned only on the{' '}
          <strong>Sublet Contracts</strong> tab.
        </Alert>
      )}

      <SectionHeader
        title={`Bill of Quantities${selectedItems.size ? ` — ${selectedItems.size} selected` : ''}`}
        action={
          <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="flex-end">
            {selectedItems.size > 0 && (
              <>
                <Button size="small" startIcon={<POIcon />} onClick={openCreatePO} variant="outlined" color="secondary">
                  Create PO ({selectedItems.size})
                </Button>
              </>
            )}
            <Button size="small" startIcon={<RefreshIcon />} onClick={load} variant="outlined">Refresh</Button>
            <Button size="small" startIcon={<AddIcon />} onClick={openAdd} variant="contained">Add Line Item</Button>
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
                  <em>📁 All BOQ Documents</em>
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
                      {!isSubProject && (
                        <Tooltip title="Allocate quantity to a Sub Project">
                          <IconButton size="small" color="secondary" onClick={() => openAllocateModal(item)}>
                            <TreeIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
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
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editItem ? 'Edit BOQ Item' : 'Add BOQ Item'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Paper
                variant="outlined"
                sx={{ p: 2, bgcolor: 'grey.50', borderColor: 'divider' }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" mb={1}>
                  Project context (auto-fetched)
                </Typography>
                <Grid container spacing={1.5}>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Main Project"
                      value={
                        isSubProject
                          ? (project?.parentProject?.name || '—')
                          : (project?.name || '—')
                      }
                      InputProps={{ readOnly: true }}
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Sub Project"
                      value={isSubProject ? (project?.name || '—') : '—'}
                      InputProps={{ readOnly: true }}
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Sector / Block"
                      value={
                        project?.sector ||
                        project?.parentProject?.sector ||
                        '—'
                      }
                      InputProps={{ readOnly: true }}
                    />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
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
        <DialogTitle>Allocate Quantity to Sub Project</DialogTitle>
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
            <Grid item xs={12}>
              <Alert severity="info" sx={{ mb: 0.5 }}>
                Allocation only moves BOQ quantity to a Sub Project. The subcontractor and rate are set on that
                Sub Project's <strong>Sublet Contracts</strong> tab.
              </Alert>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth required>
                <InputLabel>Sub Project</InputLabel>
                <Select
                  value={allocForm.subProjectId}
                  label="Sub Project"
                  onChange={e => setAllocForm(p => ({ ...p, subProjectId: e.target.value }))}
                >
                  {!childProjects.length && <MenuItem value="" disabled>No Sub Projects under this Main Project yet</MenuItem>}
                  {childProjects.map(p => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
                </Select>
              </FormControl>
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

const OverviewTab = ({ project, onGoToTab }) => <SubProjectOverview project={project} onGoToTab={onGoToTab} />;

/** Label above a value; empty values show a dash so every field keeps its place */
// Labels: semi-bold grey. Values: large, bold and dark — so the eye lands on the information
const DetailField = ({ label, children, span = 1 }) => (
  <Box sx={{ gridColumn: { sm: `span ${span}` }, minWidth: 0 }}>
    <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>{label}</Typography>
    <Box sx={{ fontSize: 17, fontWeight: 700, color: '#0f172a', mt: 0.5, lineHeight: 1.35, wordBreak: 'break-word' }}>
      {children || <Typography component="span" sx={{ fontSize: 17, color: '#cbd5e1', fontWeight: 600 }}>—</Typography>}
    </Box>
  </Box>
);

/** One overview section as its own card: tinted icon, title, then its fields in a grid */
const DetailSection = ({ title, icon, tone = '#1976d2', cols = 3, action, children, sx }) => (
  <Paper
    elevation={0}
    sx={{
      p: { xs: 2, sm: 2.75 }, borderRadius: 3, border: '1px solid #e8edf3', bgcolor: '#fff',
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)', transition: 'box-shadow .2s', '&:hover': { boxShadow: '0 6px 20px rgba(15,23,42,0.06)' }, ...sx
    }}
  >
    <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 2.25 }}>
      <Box sx={{ width: 40, height: 40, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: `${tone}14`, color: tone, flexShrink: 0, '& svg': { fontSize: 22 } }}>{icon}</Box>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#0f172a', flex: 1 }}>{title}</Typography>
      {action}
    </Stack>
    <Box sx={{ display: 'grid', columnGap: 3, rowGap: 2.5, gridTemplateColumns: { xs: '1fr', sm: `repeat(${cols}, minmax(0,1fr))` } }}>{children}</Box>
  </Paper>
);

/** Sub Project overview: who / where / when, its budget and the work so far */
const SubProjectOverview = ({ project, onGoToTab }) => {
  const navigate = useNavigate();
  const [work, setWork] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getProjectWorkflow(project._id)
      .then((res) => { if (!cancelled) setWork(res.data?.data || null); })
      .catch(() => { if (!cancelled) setWork(null); });
    return () => { cancelled = true; };
  }, [project._id]);

  const isSlab = project.contractBasis === 'Slab';
  const main = project.parentProject;
  const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : null);
  const daysLeft = project.expectedEndDate ? dayjs(project.expectedEndDate).endOf('day').diff(dayjs(), 'day') : null;
  const timeLeft = project.status === 'Completed'
    ? <Chip color="success" label={`Completed${project.actualEndDate ? ` ${day(project.actualEndDate)}` : ''}`} sx={{ fontWeight: 700 }} />
    : daysLeft === null ? null
      : daysLeft < 0 ? <Box component="span" sx={{ color: 'error.main' }}>{Math.abs(daysLeft)} days overdue</Box>
        : <Box component="span" sx={{ color: daysLeft <= 7 ? 'warning.dark' : '#15803d' }}>{daysLeft} days left</Box>;
  // Project Manager: the HR employee picked on the Sub Project (older projects may have an ERP user instead)
  const pm = project.projectManagerEmployee;
  const managerName = pm ? `${pm.firstName || ''} ${pm.lastName || ''}`.trim()
    : project.projectManager ? `${project.projectManager.firstName || ''} ${project.projectManager.lastName || ''}`.trim() : null;
  const managerMeta = pm ? [pm.employeeId && `ID ${pm.employeeId}`, pm.placementDesignation?.title].filter(Boolean).join(' · ') : '';
  const initials = (managerName || '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  // Its share of the Main Project budget
  const b = project.budgetAllocation;
  const mine = b?.subProjects?.find((s) => String(s._id) === String(project._id));
  const share = mine?.allocatedBudget || 0;
  const committed = mine?.committed || 0;
  const inForce = b ? (b.inForce ?? b.budgetStatus === 'Approved') : false;
  const used = share > 0 ? Math.round((committed / share) * 100) : 0;

  const Stat = ({ label, value, sub, tab }) => (
    <Box
      onClick={tab ? () => onGoToTab?.(tab) : undefined}
      sx={{
        p: 1.75, borderRadius: 2.5, bgcolor: '#f8fafc', border: '1px solid #e8edf3', cursor: tab ? 'pointer' : 'default', transition: 'all .15s',
        '&:hover': tab ? { borderColor: 'primary.main', bgcolor: '#fff', transform: 'translateY(-1px)' } : {}
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>{label}</Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, color: '#0f172a', mt: 0.25 }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 12.5, color: '#64748b', mt: 0.25 }}>{sub}</Typography>}
    </Box>
  );

  return (
    <Grid container spacing={2.5}>
      <Grid item xs={12} lg={8}>
        <Stack gap={2.5}>
          <DetailSection title="Project" icon={<ConstructionIcon />} tone="#1976d2">
            <DetailField label="Project no.">{project.projectNumber}</DetailField>
            <DetailField label="Main project">
              {main?.name && (
                <Box component="span" onClick={() => navigate(`/general/project-management/${main._id || main}`)}
                  sx={{ color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
                  {main.name}
                </Box>
              )}
            </DetailField>
            <DetailField label="Status"><Chip label={project.status || 'Draft'} sx={{ fontWeight: 700, fontSize: 14 }} /></DetailField>
            <DetailField label="Project type">{project.projectType}</DetailField>
            <DetailField label="Contracts">
              {project.contractBasis ? <ContractTypeTag type={project.contractBasis} /> : 'BOQ-wise or Slab-wise'}
            </DetailField>
            <DetailField label="Progress">
              <Stack direction="row" alignItems="center" gap={1.25}>
                <LinearProgress variant="determinate" value={Math.min(100, project.overallProgress || 0)} sx={{ flex: 1, height: 8, borderRadius: 4 }} />
                <span>{project.overallProgress || 0}%</span>
              </Stack>
            </DetailField>
          </DetailSection>

          <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            <DetailSection title="Location" icon={<PlaceIcon />} tone="#0f766e" cols={2}>
              <DetailField label="Society">{project.society}</DetailField>
              <DetailField label="Sector / Block">{project.sector}</DetailField>
              <DetailField label="Street">{project.street}</DetailField>
              <DetailField label="Side">{project.side && `${project.side} side`}</DetailField>
              <DetailField label="Address" span={2}>{project.address}</DetailField>
            </DetailSection>

            <Stack gap={2.5}>
              <DetailSection title="Team" icon={<PersonIcon />} tone="#7c3aed" cols={1}>
                <DetailField label="Project Manager">
                  {managerName && (
                    <Stack direction="row" alignItems="center" gap={1.5}>
                      <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: '#7c3aed', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>{initials}</Box>
                      <Box>
                        {managerName}
                        {managerMeta && <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: '#64748b' }}>{managerMeta}</Typography>}
                      </Box>
                    </Stack>
                  )}
                </DetailField>
              </DetailSection>

              <DetailSection title="Timeline" icon={<EventIcon />} tone="#d97706" cols={2}>
                <DetailField label="Start">{day(project.startDate)}</DetailField>
                <DetailField label="Expected end">{day(project.expectedEndDate)}</DetailField>
                <DetailField label="Time" span={2}>{timeLeft}</DetailField>
              </DetailSection>
            </Stack>
          </Box>

          {(project.description || project.notes) && (
            <DetailSection title="Scope and notes" icon={<NotesIcon />} tone="#475569" cols={1}>
              {project.description && <DetailField label="Description / scope"><Box sx={{ whiteSpace: 'pre-line', fontWeight: 500, fontSize: 15.5 }}>{project.description}</Box></DetailField>}
              {project.notes && <DetailField label="Notes"><Box sx={{ whiteSpace: 'pre-line', fontWeight: 500, fontSize: 15.5 }}>{project.notes}</Box></DetailField>}
            </DetailSection>
          )}
        </Stack>
      </Grid>

      <Grid item xs={12} lg={4}>
        <Stack gap={2.5}>
          <DetailSection title="Budget" icon={<WalletIcon />} tone="#15803d" cols={1}>
            {!inForce ? (
              <Alert severity="warning" sx={{ fontSize: 14 }}>{main?.name || 'The Main Project'}&apos;s budget is not approved yet — no contracts can be made here until it is.</Alert>
            ) : !share ? (
              <Alert severity="warning" sx={{ fontSize: 14 }}>{project.name} is not in the approved budget yet. Ask for it to be added with a budget revision.</Alert>
            ) : (
              <Box>
                <Typography sx={{ fontSize: 32, fontWeight: 900, lineHeight: 1.1, color: '#0f172a' }}>{fmt(share)}</Typography>
                <Typography sx={{ fontSize: 13.5, color: '#64748b', mt: 0.5 }}>Its share of {main?.name || 'the Main Project'}&apos;s approved budget</Typography>
                <LinearProgress variant="determinate" value={Math.min(100, used)} color={used >= 90 ? 'error' : 'primary'} sx={{ mt: 2, height: 10, borderRadius: 5 }} />
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.25 }}>
                  <Box>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>In contracts</Typography>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{fmt(committed)}</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>Left for contracts</Typography>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: share - committed > 0 ? '#15803d' : 'error.main' }}>{fmt(share - committed)}</Typography>
                  </Box>
                </Stack>
              </Box>
            )}
          </DetailSection>

          <DetailSection title="Work so far" icon={<CheckRequestIcon />} tone="#0369a1" cols={2}>
            {!work ? <Skeleton variant="rounded" height={160} sx={{ gridColumn: '1 / -1' }} /> : (
              <>
                {!isSlab && <Stat label="BOQ lines" value={work.boq?.lines || 0} tab="boq" />}
                <Stat
                  label={isSlab ? 'Slab contracts' : 'Contracts'} tab="sublet-contracts"
                  value={(work.contracts?.active || 0) + (work.contracts?.completed || 0)}
                  sub={work.contracts?.draft ? `${work.contracts.draft} draft` : 'active'}
                />
                <Stat
                  label="Check requests" tab="check-requests"
                  value={work.checkRequests?.verifiedOrBilled || 0}
                  sub={work.checkRequests?.submitted ? `verified · ${work.checkRequests.submitted} in inspection` : 'verified'}
                />
                <Stat
                  label="IPCs" tab="invoices"
                  value={work.ipcs?.total || 0}
                  sub={work.ipcs?.inApproval ? `${work.ipcs.inApproval} in approval` : work.ipcs?.paid ? `${work.ipcs.paid} paid` : 'raised'}
                />
                {isSlab && <Stat label="With Finance" value={fmt(work.ipcs?.unpaidAmount || 0)} sub={work.ipcs?.unpaid ? `${work.ipcs.unpaid} unpaid` : 'nothing due'} tab="invoices" />}
              </>
            )}
          </DetailSection>
        </Stack>
      </Grid>
    </Grid>
  );
};

// ─── Main Detail Page ─────────────────────────────────────────────────────────
/** Construction project detail — Main: Overview + BOQ; Sub: full execution tabs. */
const ProjectDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);

  const loadProject = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getProjectById(id);
      const data = res.data?.data || null;
      setProject(data);
      // Workspace shortcuts (Check Requests/Invoices/…) must reopen a Sub, not the Main envelope
      if (data) {
        localStorage.setItem('pmLastProjectId', data._id);
        if (data.parentProject) {
          localStorage.setItem('pmLastSubProjectId', data._id);
        }
      }
    } catch (err) {
      setProject(null);
      if (err.response?.status === 404 || err.response?.status === 400) {
        // Stale shortcut (project deleted or link mistyped): forget it so sidebar links stop landing here
        ['pmLastProjectId', 'pmLastSubProjectId'].forEach((key) => {
          if (localStorage.getItem(key) === String(id)) localStorage.removeItem(key);
        });
        setError('not-found');
      } else {
        setError(err.response?.data?.message || 'Could not load this project. Please try again.');
      }
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadProject(); }, [loadProject]);

  const isMainProject = project ? !project.parentProject : false;
  const visibleTabs = getVisibleTabs(isMainProject, project?.contractBasis, project?.projectType);
  const activeTab = visibleTabs[Math.min(tab, Math.max(0, visibleTabs.length - 1))] || visibleTabs[0];
  const goToTab = (tabId) => setSearchParams({ tab: tabId }, { replace: true });

  useEffect(() => {
    // Wait for the project in the URL: moving Main → Sub would otherwise map ?tab=invoices against the Main's tabs
    if (!project || String(project._id) !== String(id)) return;
    const tabs = getVisibleTabs(!project.parentProject, project.contractBasis, project.projectType);
    const raw = searchParams.get('tab');
    let idx = 0;
    if (raw != null && raw !== '') {
      const byId = tabs.findIndex((t) => t.id === raw);
      if (byId >= 0) {
        idx = byId;
      } else {
        const asNumber = Number(raw);
        if (Number.isFinite(asNumber)) {
          idx = Math.max(0, Math.min(tabs.length - 1, asNumber));
        }
      }
    }
    setTab(idx);
    const canonical = tabs[idx]?.id;
    // Prefer tab ids in the URL so Main/Sub different tab counts never mis-route
    if (canonical && raw !== canonical) {
      setSearchParams({ tab: canonical }, { replace: true });
    }
  }, [id, project, searchParams, setSearchParams]);

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton height={60} sx={{ mb: 2 }} />
        <Skeleton height={200} />
      </Box>
    );
  }

  if (error || !project) {
    const notFound = !project && (!error || error === 'not-found');
    const requestedTab = searchParams.get('tab');
    const canPickAnother = requestedTab && requestedTab !== 'overview';
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 640, borderRadius: 2 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            {notFound ? 'This project is no longer available' : 'Something went wrong'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            {notFound
              ? 'It may have been deleted, or the link is out of date. Pick another project to continue.'
              : error}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
            {canPickAnother && (
              <Button variant="contained" onClick={() => navigate(`/general/project-management/workspace/${requestedTab}`, { replace: true })}>
                Choose another project
              </Button>
            )}
            {!notFound && (
              <Button variant={canPickAnother ? 'outlined' : 'contained'} startIcon={<RefreshIcon />} onClick={loadProject}>
                Try again
              </Button>
            )}
            <Button
              variant={canPickAnother || !notFound ? 'outlined' : 'contained'}
              startIcon={<BackIcon />}
              onClick={() => navigate('/general/project-management/projects')}
            >
              All Projects
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  const deleteDialog = (
    <PermanentDeleteProjectDialog
      project={permanentDeleteOpen ? project : null}
      onClose={() => setPermanentDeleteOpen(false)}
      onDeleted={() => {
        setPermanentDeleteOpen(false);
        ['pmLastProjectId', 'pmLastSubProjectId'].forEach((key) => {
          if (localStorage.getItem(key) === String(id)) localStorage.removeItem(key);
        });
        navigate('/general/project-management/projects', { replace: true });
      }}
    />
  );

  // Main Project: its own page (sub project sidebar → contracts → check requests → IPCs)
  if (isMainProject) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 }, minHeight: '100%', bgcolor: '#f4f6f8' }}>
        <MainProjectPage
          project={project}
          view={activeTab?.id}
          onViewChange={goToTab}
          onBack={() => navigate('/general/project-management')}
          onRefresh={loadProject}
          onDelete={user?.role === 'developer' ? () => setPermanentDeleteOpen(true) : null}
          boqView={<BOQTab projectId={id} project={project} />}
          costView={<MainCostReport project={project} />}
          budgetView={<ProjectBudgetPanel project={project} onRefresh={loadProject} />}
        />
        {deleteDialog}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 3 },
        minHeight: '100%',
        bgcolor: 'grey.50'
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
                  {!isMainProject && project.contractBasis && <ContractTypeTag type={project.contractBasis} />}
                  <ProjectStatusMenu
                    project={project}
                    onChanged={loadProject}
                    chipSx={isMainProject ? { bgcolor: 'rgba(255,255,255,0.9)', fontWeight: 600 } : undefined}
                  />
                </Stack>
                <Typography variant="body2" sx={{ color: isMainProject ? 'rgba(255,255,255,0.72)' : 'text.secondary' }}>
                  {project.projectNumber}
                  {!isMainProject && project.projectType ? ` · ${project.projectType}` : ''}
                  {project.society && ` · ${project.society}`}
                  {project.sector && `, ${project.sector}`}
                  {!isMainProject && project.street && ` · ${project.street}`}
                  {!isMainProject && project.side && ` (${project.side} side)`}
                </Typography>
                {!isMainProject && project.projectManagerEmployee && (
                  <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                    Project Manager: <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                      {`${project.projectManagerEmployee.firstName || ''} ${project.projectManagerEmployee.lastName || ''}`.trim()}
                    </Box>
                  </Typography>
                )}
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
            {user?.role === 'developer' && (
              <Button
                size="small"
                variant="contained"
                color="error"
                startIcon={<DeleteForeverIcon />}
                onClick={() => setPermanentDeleteOpen(true)}
              >
                Delete (Developer)
              </Button>
            )}
          </Stack>
        </Stack>

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
            {(() => {
              const mine = project.budgetAllocation?.subProjects?.find((x) => String(x._id) === String(project._id));
              const daysLeft = project.expectedEndDate ? dayjs(project.expectedEndDate).endOf('day').diff(dayjs(), 'day') : null;
              return [
                ['Budget', mine?.allocatedBudget ? fmt(mine.allocatedBudget) : 'Not in budget yet',
                  mine?.allocatedBudget ? `${fmt(mine.allocatedBudget - (mine.committed || 0))} left for contracts` : 'No contracts until it has a budget'],
                ['Spent (certified)', fmt(project.totalActualSpent || 0), 'Certified work on IPCs'],
                ['Timeline',
                  `${project.startDate ? dayjs(project.startDate).format('DD MMM YYYY') : '—'} → ${project.expectedEndDate ? dayjs(project.expectedEndDate).format('DD MMM YYYY') : '—'}`,
                  project.status === 'Completed' ? 'Completed' : daysLeft === null ? 'No end date set' : daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days left`]
              ].map(([label, value, sub]) => (
                <Grid item xs={12} sm={4} key={label}>
                  <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: '#fff', height: '100%' }}>
                    <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: '#64748b' }}>{label}</Typography>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>{value}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 500, color: /overdue|Not in budget|No contracts/.test(sub) ? 'error.main' : 'text.secondary' }}>{sub}</Typography>
                  </Paper>
                </Grid>
              ));
            })()}
          </Grid>
        </>
      )}

      {!isMainProject && (
        <ProjectWorkflowStrip projectId={id} activeTabId={activeTab?.id} onGoToTab={goToTab} basis={project.contractBasis} />
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
            const nextId = visibleTabs[v]?.id || 'overview';
            setSearchParams({ tab: nextId }, { replace: true });
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
        {/* Overview cards sit on a soft grey so each section reads as its own card */}
        <Box sx={{ p: { xs: 1.5, sm: isMainProject ? 2.5 : 2 }, ...(activeTab?.id === 'overview' && !isMainProject ? { bgcolor: '#f6f8fb', borderBottomLeftRadius: 10, borderBottomRightRadius: 10 } : {}) }}>
          {activeTab?.id === 'overview' && <OverviewTab project={project} onGoToTab={goToTab} />}
          {activeTab?.id === 'units' && <UnitsTab projectId={id} project={project} />}
          {activeTab?.id === 'boq' && <BOQTab projectId={id} project={project} />}
          {activeTab?.id === 'sublet-contracts' && <SubletContractsTab projectId={id} project={project} onGoToTab={goToTab} />}
          {activeTab?.id === 'check-requests' && <CheckRequestsTab projectId={id} project={project} onGoToTab={goToTab} />}
          {activeTab?.id === 'invoices' && <ProjectInvoicesTab project={project} onGoToTab={goToTab} />}
          {activeTab?.id === 'cost' && <MainCostReport project={project} />}
        </Box>
      </Paper>

      {deleteDialog}
    </Box>
  );
};

export default ProjectDetail;
