import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, FormControl, Grid,
  IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select,
  Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import {
  Add as AddIcon, Cancel as CancelIcon, CheckCircle as CheckIcon,
  Construction as ConstructionIcon, Delete as DeleteIcon,
  Edit as EditIcon, Refresh as RefreshIcon, AccountTree as StructureIcon,
  TrendingUp as TrendingIcon, Visibility as ViewIcon,
  Publish as SubmitIcon, Undo as ResetIcon,
  FolderSpecial as FolderIcon, PlayCircleFilled as ActiveIcon,
  AssignmentTurnedIn as CompleteIcon, AttachMoney as MoneyIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { usePagination } from '../../hooks/usePagination';
import TablePaginationWrapper from '../../components/TablePaginationWrapper';
import {
  getProjects, getProjectStats, createProject, updateProject, cancelProject, updateBudgetStatus
} from '../../services/projectManagementService';
import MasterExecutiveControlTower from '../../components/ProjectManagement/MasterExecutiveControlTower';

// ─── Constants ────────────────────────────────────────────────────────────────
const PROJECT_TYPES = ['INFRASTRUCTURE DEVELOPMENT', 'COMMERCIAL', 'VILLAS'];
const PROJECT_STATUSES = ['Draft', 'Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'];
/** Sectors / blocks from Taj Residencia PM workflow PDF — by project type. */
const SECTORS_BY_TYPE = {
  'INFRASTRUCTURE DEVELOPMENT': [
    'Gardenia', 'Iris', 'Rose', 'Geranium', 'Cosmos', 'Zinnia', 'Blue Bell',
    'Lotus (Exec)', 'Cosmos-II', 'Daffodils', 'Lotus', 'Lavender', 'Tulip',
    'Lily', 'Jasmine', 'Sun Flower', 'Marigold', 'Daisy'
  ],
  COMMERCIAL: [
    'Boulevard Tower', 'Commercial Hub'
  ],
  VILLAS: [
    '4 Marla', '5 Marla', '7 Marla', '10 Marla', '1 Kanal'
  ]
};

const STATUS_COLOR = {
  Draft: 'default', Planning: 'info', Active: 'success',
  'On Hold': 'warning', Completed: 'primary', Cancelled: 'error'
};

const getParentId = (p) => {
  if (!p?.parentProject) return null;
  return String(p.parentProject._id || p.parentProject);
};

/** Main = root portfolio; Sub = anything under a parent (incl. legacy zone/block). */
const getHierarchyLevel = (p) => {
  if (!p) return 'sub';
  return getParentId(p) ? 'sub' : 'main';
};

const DEFAULT_SOCIETY = 'Taj Residencia';

const defaultForm = {
  hierarchyLevel: 'main',
  name: '',
  projectType: 'INFRASTRUCTURE DEVELOPMENT',
  description: '',
  society: DEFAULT_SOCIETY,
  sector: '',
  address: '',
  isMasterProject: true,
  parentProject: '',
  startDate: '',
  expectedEndDate: '',
  notes: '',
  status: 'Draft'
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));

const StatCard = ({ label, value, color = 'primary.main', subtitle, icon }) => (
  <Card variant="outlined" sx={{ 
    height: '100%', 
    borderRadius: 2, 
    borderColor: 'divider',
    transition: 'all 0.2s',
    '&:hover': { boxShadow: 2, borderColor: color }
  }}>
    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="body2" color="text.secondary" fontWeight={500} sx={{ mb: 0.5 }}>{label}</Typography>
          <Typography variant="h4" fontWeight={700} color={color}>{value}</Typography>
        </Box>
        <Box sx={{ 
          p: 1.2, 
          borderRadius: 1.5, 
          bgcolor: 'rgba(25, 118, 210, 0.04)', 
          color: color, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}>
          {icon}
        </Box>
      </Stack>
      {subtitle && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
          {subtitle}
        </Typography>
      )}
    </CardContent>
  </Card>
);

// ─── Create / Edit Dialog (Main Project ↔ Sub Project) ───────────────────────
const ProjectFormDialog = ({
  open,
  onClose,
  onSaved,
  editing,
  allProjects = [],
  defaultLevel = 'main',
  defaultParentId = ''
}) => {
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const mainProjects = allProjects.filter((p) => getHierarchyLevel(p) === 'main');
  const sectorOptions = SECTORS_BY_TYPE[form.projectType] || [];

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const level = getHierarchyLevel(editing);
      // Prefer direct main parent; if legacy zone parent, still keep that parent id so tree stays valid
      setForm({
        ...defaultForm,
        hierarchyLevel: level,
        name: editing.name || '',
        projectType: editing.projectType || 'INFRASTRUCTURE DEVELOPMENT',
        isMasterProject: level === 'main',
        parentProject: editing.parentProject?._id || editing.parentProject || '',
        description: editing.description || '',
        society: editing.society || DEFAULT_SOCIETY,
        sector: editing.sector || '',
        address: editing.address || '',
        startDate: editing.startDate ? dayjs(editing.startDate).format('YYYY-MM-DD') : '',
        expectedEndDate: editing.expectedEndDate ? dayjs(editing.expectedEndDate).format('YYYY-MM-DD') : '',
        notes: editing.notes || '',
        status: editing.status || 'Draft'
      });
    } else {
      const level = defaultLevel === 'sub' ? 'sub' : 'main';
      const parentId = level === 'sub'
        ? (defaultParentId || mainProjects[0]?._id || '')
        : '';
      setForm({
        ...defaultForm,
        hierarchyLevel: level,
        isMasterProject: level === 'main',
        parentProject: parentId,
        society: DEFAULT_SOCIETY
      });
    }
    setError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, defaultLevel, defaultParentId]);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleProjectTypeChange = (type) => {
    const options = SECTORS_BY_TYPE[type] || [];
    setForm((prev) => ({
      ...prev,
      projectType: type,
      sector: options.includes(prev.sector) ? prev.sector : ''
    }));
  };

  const handleSectorChange = (sector) => {
    setForm((prev) => ({
      ...prev,
      sector,
      // Prefill name from sector when empty or still matching previous sector
      name: !prev.name.trim() || prev.name === prev.sector ? sector : prev.name
    }));
  };

  const handleSave = async () => {
    const name = (form.name || '').trim();
    if (!name) {
      setError('Project name is required');
      return;
    }
    if (form.hierarchyLevel === 'sub' && !form.parentProject) {
      setError('Select the Main Project this sub-project belongs to');
      return;
    }
    if (form.hierarchyLevel === 'sub' && !form.sector) {
      setError('Select a Sector / Block');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const isMain = form.hierarchyLevel === 'main';
      const payload = {
        name,
        description: form.description,
        society: (form.society || '').trim() || DEFAULT_SOCIETY,
        sector: form.sector || '',
        address: form.address,
        startDate: form.startDate || undefined,
        expectedEndDate: form.expectedEndDate || undefined,
        notes: form.notes,
        isMasterProject: isMain,
        parentProject: isMain ? null : form.parentProject
      };
      // Project type belongs to Sub Projects only (Main is a simple portfolio container)
      if (!isMain) {
        payload.projectType = form.projectType || 'INFRASTRUCTURE DEVELOPMENT';
      }
      if (editing) {
        if (form.status) payload.status = form.status;
        await updateProject(editing._id, payload);
      } else {
        await createProject(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" gap={1}>
          <ConstructionIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {editing
              ? 'Edit Project'
              : form.hierarchyLevel === 'sub'
                ? 'Create Sub Project'
                : 'Create Main Project'}
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Grid container spacing={2}>
          {form.hierarchyLevel === 'sub' && (
            <>
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom>
                  Parent
                </Typography>
                <Divider sx={{ mb: 2 }} />
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth required>
                  <InputLabel>Under Main Project</InputLabel>
                  <Select
                    value={form.parentProject || ''}
                    label="Under Main Project"
                    onChange={set('parentProject')}
                  >
                    {mainProjects.length === 0 && (
                      <MenuItem value="" disabled>Create a Main Project first</MenuItem>
                    )}
                    {mainProjects.map((mp) => (
                      <MenuItem key={mp._id} value={mp._id}>{mp.name}</MenuItem>
                    ))}
                    {/* Keep current parent visible when editing a legacy nested sub */}
                    {editing && form.parentProject && !mainProjects.some((m) => String(m._id) === String(form.parentProject)) && (
                      <MenuItem value={form.parentProject}>
                        {editing.parentProject?.name || 'Current parent'}
                      </MenuItem>
                    )}
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}

          <Grid item xs={12}>
            <Typography variant="subtitle2" color="primary" fontWeight={600} gutterBottom sx={{ mt: form.hierarchyLevel === 'sub' ? 1 : 0 }}>
              Project Information
            </Typography>
            <Divider sx={{ mb: 2 }} />
          </Grid>

          <Grid item xs={12} md={form.hierarchyLevel === 'sub' ? 8 : 12}>
            <TextField
              fullWidth
              required
              label="Project Name"
              value={form.name}
              onChange={set('name')}
              placeholder={form.hierarchyLevel === 'main' ? 'e.g. Taj Residencia' : 'e.g. Gardenia / Boulevard Tower / 5 Marla'}
            />
          </Grid>

          {form.hierarchyLevel === 'sub' && (
            <Grid item xs={12} md={4}>
              <FormControl fullWidth required>
                <InputLabel>Project Type</InputLabel>
                <Select value={form.projectType} label="Project Type" onChange={(e) => handleProjectTypeChange(e.target.value)}>
                  {form.projectType && !PROJECT_TYPES.includes(form.projectType) && (
                    <MenuItem value={form.projectType}>{form.projectType} (legacy)</MenuItem>
                  )}
                  {PROJECT_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          )}

          {editing && (
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select value={form.status || 'Draft'} label="Status" onChange={set('status')}>
                  {PROJECT_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          )}

          <Grid item xs={12} md={form.hierarchyLevel === 'sub' ? 6 : 12}>
            <TextField
              fullWidth
              label="Society / Area"
              value={form.society}
              onChange={set('society')}
              placeholder={DEFAULT_SOCIETY}
            />
          </Grid>

          {form.hierarchyLevel === 'sub' && (
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>Sector / Block</InputLabel>
                <Select
                  value={form.sector || ''}
                  label="Sector / Block"
                  onChange={(e) => handleSectorChange(e.target.value)}
                >
                  {sectorOptions.length === 0 && (
                    <MenuItem value="" disabled>Select project type first</MenuItem>
                  )}
                  {sectorOptions.map((s) => (
                    <MenuItem key={s} value={s}>{s}</MenuItem>
                  ))}
                  {/* Keep legacy sector visible when editing */}
                  {form.sector && !sectorOptions.includes(form.sector) && (
                    <MenuItem value={form.sector}>{form.sector} (legacy)</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>
          )}

          <Grid item xs={12}>
            <TextField fullWidth label="Address / Location" value={form.address} onChange={set('address')} />
          </Grid>

          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Start Date"
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Expected End Date"
              type="date"
              value={form.expectedEndDate}
              onChange={set('expectedEndDate')}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              rows={2}
              label="Description / Scope"
              value={form.description}
              onChange={set('description')}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField fullWidth multiline rows={2} label="Notes" value={form.notes} onChange={set('notes')} />
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Project'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────
const ProjectManagement = () => {
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [dialogDefaults, setDialogDefaults] = useState({ level: 'main', parentId: '' });
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedMasterProjectId, setSelectedMasterProjectId] = useState(null);
  const [hierarchyProjects, setHierarchyProjects] = useState([]);

  const pagination = usePagination({
    defaultRowsPerPage: 20,
    resetDependencies: [search, statusFilter, typeFilter]
  });

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const params = pagination.getApiParams();
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.projectType = typeFilter;
      const res = await getProjects(params);
      setProjects(res.data?.data?.projects || []);
      if (res.data?.data?.pagination) pagination.setTotal(res.data.data.pagination.total);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.rowsPerPage, search, statusFilter, typeFilter]);

  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await getProjectStats();
      setStats(res.data?.data || null);
    } catch {
      // stats are non-critical
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadHierarchyOptions = useCallback(async () => {
    try {
      const res = await getProjects({ page: 1, limit: 500 });
      setHierarchyProjects(res.data?.data?.projects || []);
    } catch {
      // parent dropdown can fall back to current page list
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadHierarchyOptions(); }, [loadHierarchyOptions]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await cancelProject(deleteConfirm._id);
      setSuccess('Project cancelled successfully');
      setDeleteConfirm(null);
      loadProjects();
      loadStats();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel project');
    } finally {
      setDeleting(false);
    }
  };

  const handleApproveBudget = async (project) => {
    try {
      await updateBudgetStatus(project._id, 'approve');
      setSuccess('Budget approved');
      loadProjects();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to approve budget');
    }
  };

  const handleSubmitBudget = async (project) => {
    try {
      await updateBudgetStatus(project._id, 'submit');
      setSuccess('Budget submitted successfully');
      loadProjects();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit budget');
    }
  };

  const handleResetBudget = async (project) => {
    try {
      await updateBudgetStatus(project._id, 'reset');
      setSuccess('Budget reset to Draft');
      loadProjects();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset budget');
    }
  };

  const progressColor = (pct) => pct >= 80 ? 'success' : pct >= 40 ? 'warning' : 'error';

  if (selectedMasterProjectId) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 }, bgcolor: 'grey.50', minHeight: '100%' }}>
        <MasterExecutiveControlTower
          masterProjectId={selectedMasterProjectId}
          onClose={() => setSelectedMasterProjectId(null)}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, bgcolor: 'grey.50', minHeight: '100%' }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          mb: 3,
          p: 2.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          borderLeft: '5px solid',
          borderLeftColor: 'primary.main'
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
          <Stack direction="row" alignItems="center" gap={2}>
            <Box sx={{ p: 1.5, bgcolor: 'rgba(25, 118, 210, 0.04)', borderRadius: 2, color: 'primary.main', display: 'flex', alignItems: 'center' }}>
              <ConstructionIcon sx={{ fontSize: 32 }} />
            </Box>
            <Box>
              <Typography variant="h5" fontWeight={700} sx={{ color: 'text.primary' }}>Project Registry</Typography>
              <Typography variant="body2" color="text.secondary">
                Create a Main Project, then add Sub Projects under it for full PM workflow.
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" gap={1.5} alignItems="center">
            {(hierarchyProjects.some((p) => getHierarchyLevel(p) === 'main') ||
              projects.some((p) => getHierarchyLevel(p) === 'main')) && (
              <Button
                variant={selectedMasterProjectId ? "contained" : "outlined"}
                color="primary"
                startIcon={<StructureIcon />}
                onClick={() => {
                  const firstMain =
                    hierarchyProjects.find((p) => getHierarchyLevel(p) === 'main') ||
                    projects.find((p) => getHierarchyLevel(p) === 'main');
                  if (firstMain) setSelectedMasterProjectId(firstMain._id);
                }}
                sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5 }}
              >
                Executive Control Tower
              </Button>
            )}
            <Tooltip title="Refresh Registry">
              <IconButton onClick={() => { loadProjects(); loadStats(); loadHierarchyOptions(); }} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingProject(null);
                setDialogDefaults({ level: 'sub', parentId: '' });
                loadHierarchyOptions();
                setDialogOpen(true);
              }}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5 }}
            >
              New Sub Project
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingProject(null);
                setDialogDefaults({ level: 'main', parentId: '' });
                loadHierarchyOptions();
                setDialogOpen(true);
              }}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5 }}
            >
              New Main Project
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Alerts */}
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {/* Stat Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {statsLoading ? (
          [0, 1, 2, 3].map(i => (
            <Grid item xs={12} sm={6} md={3} key={i}>
              <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent><Skeleton height={80} /></CardContent></Card>
            </Grid>
          ))
        ) : stats && (
          <>
            <Grid item xs={12} sm={6} md={3}>
              <StatCard 
                label="Total Projects" 
                value={stats.totalProjects} 
                color="primary.main"
                icon={<FolderIcon />}
                subtitle={`${stats.planning || 0} planning`} 
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatCard 
                label="Active Projects" 
                value={stats.active || 0} 
                color="success.main"
                icon={<ActiveIcon />}
                subtitle={`${stats.onHold || 0} on hold`} 
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatCard 
                label="Completed" 
                value={stats.completed || 0} 
                color="info.main"
                icon={<CompleteIcon />}
                subtitle={`${stats.draft || 0} in draft`} 
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatCard 
                label="Total Budget" 
                value={fmt(stats.totalBudget)}
                color="warning.main" 
                icon={<MoneyIcon />}
                subtitle={`Spent: ${fmt(stats.totalSpent)}`} 
              />
            </Grid>
          </>
        )}
      </Grid>

      {/* Filters */}
      <Card variant="outlined" sx={{ mb: 3, borderRadius: 2 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={5}>
              <TextField fullWidth size="small" placeholder="Search by name, client, society, sector…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
                  <MenuItem value="">All Statuses</MenuItem>
                  {PROJECT_STATUSES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={typeFilter} label="Type" onChange={(e) => setTypeFilter(e.target.value)}>
                  <MenuItem value="">All Types</MenuItem>
                  {PROJECT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={1}>
              <Button fullWidth size="small" variant="outlined"
                onClick={() => { setSearch(''); setStatusFilter(''); setTypeFilter(''); }}>
                Clear
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Projects Table */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <TableContainer sx={{ borderRadius: 2 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>#</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>Project Directory</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>Progress</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>Overall Budget</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>Actual Spent</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>Expected Timeline</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: 'text.secondary', bgcolor: 'grey.50', py: 1.5 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <TableCell key={j}><Skeleton /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : projects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                      <TrendingIcon sx={{ fontSize: 48, color: 'grey.300', mb: 1, display: 'block', mx: 'auto' }} />
                      <Typography color="text.secondary">No projects found</Typography>
                      <Button
                        variant="outlined"
                        startIcon={<AddIcon />}
                        sx={{ mt: 2 }}
                        onClick={() => {
                          setEditingProject(null);
                          setDialogDefaults({ level: 'main', parentId: '' });
                          setDialogOpen(true);
                        }}
                      >
                        Create your first Main Project
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : (
                  (() => {
                    // Prefer full hierarchy list so Main → Sub nesting stays intact.
                    const raw = hierarchyProjects.length ? hierarchyProjects : projects;
                    const q = (search || '').trim().toLowerCase();
                    const matchesFilter = (p) => {
                      if (statusFilter && p.status !== statusFilter) return false;
                      if (typeFilter && p.projectType !== typeFilter) return false;
                      if (!q) return true;
                      return [p.name, p.projectNumber, p.society, p.sector, p.projectType]
                        .filter(Boolean)
                        .some((v) => String(v).toLowerCase().includes(q));
                    };

                    // Keep ancestors of matches so the tree still makes sense when filtering.
                    const byIdAll = new Map(raw.map((p) => [String(p._id), p]));
                    const keep = new Set();
                    raw.forEach((p) => {
                      if (!matchesFilter(p)) return;
                      keep.add(String(p._id));
                      let parentId = getParentId(p);
                      while (parentId && byIdAll.has(parentId)) {
                        keep.add(parentId);
                        parentId = getParentId(byIdAll.get(parentId));
                      }
                    });
                    const source = raw.filter((p) => keep.has(String(p._id)));

                    const byId = new Map(source.map((p) => [String(p._id), p]));
                    const childrenByParent = new Map();
                    const roots = [];

                    source.forEach((p) => {
                      const parentId = getParentId(p);
                      if (parentId && byId.has(parentId)) {
                        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
                        childrenByParent.get(parentId).push(p);
                      } else {
                        roots.push(p);
                      }
                    });

                    const sortNodes = (nodes) => [...nodes].sort((a, b) => {
                      const la = getHierarchyLevel(a) === 'main' ? 0 : 1;
                      const lb = getHierarchyLevel(b) === 'main' ? 0 : 1;
                      if (la !== lb) return la - lb;
                      return String(a.name || '').localeCompare(String(b.name || ''));
                    });

                    const levelChip = (level) => (
                      level === 'main'
                        ? { label: 'Main', color: 'primary' }
                        : { label: 'Sub', color: 'default' }
                    );

                    const renderRow = (project, depth = 0) => {
                      const pct = project.overallProgress || 0;
                      const budgetUsed = project.totalApprovedBudget
                        ? Math.round((project.totalActualSpent / project.totalApprovedBudget) * 100)
                        : 0;
                      const level = getHierarchyLevel(project);
                      const chip = levelChip(level);
                      const borderColor = level === 'main' ? '#1976d2' : 'transparent';

                      return (
                        <TableRow
                          key={project._id}
                          hover
                          sx={{
                            '& td': { py: 1.3 },
                            borderLeft: borderColor !== 'transparent' ? `4px solid ${borderColor}` : 'none',
                            bgcolor: level === 'main'
                              ? 'rgba(25, 118, 210, 0.03)'
                              : depth > 0
                              ? 'rgba(0, 0, 0, 0.01)'
                              : 'inherit'
                          }}
                        >
                          <TableCell>
                            <Typography variant="caption" color="text.secondary" fontFamily="monospace" fontWeight={500}>
                              {project.projectNumber}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Box sx={{ pl: depth * 2.5 }}>
                              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                                {depth > 0 && (
                                  <Typography color="text.disabled" sx={{ fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 700 }}>
                                    └─
                                  </Typography>
                                )}
                                <Typography
                                  variant="body2"
                                  fontWeight={level === 'main' ? 700 : 500}
                                  color={level === 'main' ? 'primary.main' : 'text.primary'}
                                >
                                  {project.name}
                                </Typography>
                                <Chip
                                  label={chip.label}
                                  size="small"
                                  color={chip.color}
                                  sx={{ height: 18, fontSize: '0.65rem', fontWeight: 600, borderRadius: 1 }}
                                />
                              </Stack>
                              {(project.sector || project.society) && (
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: depth > 0 ? 2.5 : 0 }}>
                                  {[project.society, project.sector].filter(Boolean).join(' — ')}
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color={level === 'main' ? 'text.disabled' : 'text.primary'}>
                              {level === 'main' ? '—' : (project.projectType || '—')}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip label={project.status} size="small" color={STATUS_COLOR[project.status] || 'default'} />
                          </TableCell>
                          <TableCell sx={{ minWidth: 130 }}>
                            <Stack spacing={0.5}>
                              <Stack direction="row" justifyContent="space-between">
                                <Typography variant="caption">{pct}%</Typography>
                                {project.budgetStatus === 'Approved' && (
                                  <Tooltip title={`Budget ${budgetUsed}% used`}>
                                    <Typography variant="caption" color={budgetUsed > 90 ? 'error.main' : 'text.secondary'}>
                                      💰 {budgetUsed}%
                                    </Typography>
                                  </Tooltip>
                                )}
                              </Stack>
                              <LinearProgress
                                variant="determinate"
                                value={pct}
                                color={progressColor(pct)}
                                sx={{ height: 6, borderRadius: 3 }}
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Stack>
                              <Typography variant="body2">
                                {fmt(
                                  getHierarchyLevel(project) === 'main'
                                    ? (project.lumpSumBudget || project.totalApprovedBudget || project.totalEstimatedCost)
                                    : (project.allocatedBudget || project.totalApprovedBudget || project.totalEstimatedCost)
                                )}
                              </Typography>
                              <Chip
                                size="small"
                                label={project.budgetStatus}
                                color={project.budgetStatus === 'Approved' ? 'success' : project.budgetStatus === 'Submitted' ? 'warning' : 'default'}
                                sx={{ fontSize: '0.65rem', height: 18 }}
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color={budgetUsed > 100 ? 'error.main' : 'text.primary'}>
                              {fmt(project.totalActualSpent)}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ minWidth: 110 }}>
                            {project.startDate && (
                              <Typography variant="caption" display="block">
                                Start: {dayjs(project.startDate).format('DD MMM YY')}
                              </Typography>
                            )}
                            {project.expectedEndDate && (
                              <Typography variant="caption" display="block" color={
                                dayjs(project.expectedEndDate).isBefore(dayjs()) && project.status === 'Active'
                                  ? 'error.main' : 'text.secondary'
                              }>
                                End: {dayjs(project.expectedEndDate).format('DD MMM YY')}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                              {level === 'main' && (
                                <Tooltip title="Senior Management Control Tower">
                                  <Button
                                    size="small" variant="contained" color="secondary"
                                    sx={{ textTransform: 'none', px: 1, py: 0.2, fontSize: '0.72rem' }}
                                    onClick={() => setSelectedMasterProjectId(project._id)}
                                  >
                                    Control Tower
                                  </Button>
                                </Tooltip>
                              )}
                              {level === 'main' && (
                                <Tooltip title="Add Sub Project under this Main Project">
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    sx={{ textTransform: 'none', px: 1, py: 0.2, fontSize: '0.72rem' }}
                                    onClick={() => {
                                      setEditingProject(null);
                                      setDialogDefaults({ level: 'sub', parentId: project._id });
                                      loadHierarchyOptions();
                                      setDialogOpen(true);
                                    }}
                                  >
                                    Add Sub
                                  </Button>
                                </Tooltip>
                              )}
                              <Tooltip title="View Detail">
                                <IconButton size="small" color="primary"
                                  onClick={() => {
                                    localStorage.setItem('pmLastProjectId', project._id);
                                    if (getParentId(project)) {
                                      localStorage.setItem('pmLastSubProjectId', project._id);
                                    }
                                    navigate(`/general/project-management/${project._id}`);
                                  }}>
                                  <ViewIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Edit">
                                <IconButton size="small"
                                  onClick={() => {
                                    setEditingProject(project);
                                    setDialogDefaults({ level: 'main', parentId: '' });
                                    loadHierarchyOptions();
                                    setDialogOpen(true);
                                  }}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              {project.budgetStatus === 'Draft' && (
                                <Tooltip title="Submit Budget">
                                  <IconButton size="small" color="warning"
                                    onClick={() => handleSubmitBudget(project)}>
                                    <SubmitIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {project.budgetStatus === 'Submitted' && (
                                <Tooltip title="Approve Budget">
                                  <IconButton size="small" color="success"
                                    onClick={() => handleApproveBudget(project)}>
                                    <CheckIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {project.budgetStatus === 'Approved' && (
                                <Tooltip title="Reset Budget to Draft">
                                  <IconButton size="small" color="default"
                                    onClick={() => handleResetBudget(project)}>
                                    <ResetIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              <Tooltip title="Cancel Project">
                                <IconButton size="small" color="error"
                                  onClick={() => setDeleteConfirm(project)}>
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    };

                    const rows = [];
                    const walk = (nodes, depth) => {
                      sortNodes(nodes).forEach((node) => {
                        rows.push(renderRow(node, depth));
                        const kids = childrenByParent.get(String(node._id)) || [];
                        if (kids.length) walk(kids, depth + 1);
                      });
                    };
                    walk(roots, 0);

                    return rows;
                  })()
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {!loading && !hierarchyProjects.length && projects.length > 0 && (
            <TablePaginationWrapper
              page={pagination.page}
              rowsPerPage={pagination.rowsPerPage}
              total={pagination.total}
              onPageChange={pagination.handleChangePage}
              onRowsPerPageChange={pagination.handleChangeRowsPerPage}
              rowsPerPageOptions={[10, 20, 50]}
            />
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <ProjectFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          loadProjects();
          loadStats();
          loadHierarchyOptions();
          setSuccess(editingProject ? 'Project updated' : 'Project created');
        }}
        editing={editingProject}
        allProjects={hierarchyProjects.length ? hierarchyProjects : projects}
        defaultLevel={dialogDefaults.level}
        defaultParentId={dialogDefaults.parentId}
      />

      {/* Cancel Confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Cancel Project?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to cancel <strong>{deleteConfirm?.name}</strong>?
            This will mark the project as Cancelled and cannot be undone easily.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>Keep Project</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : <DeleteIcon />}>
            {deleting ? 'Cancelling…' : 'Yes, Cancel Project'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProjectManagement;
