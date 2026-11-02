import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as ActivateIcon,
  Delete as DeleteIcon,
  DoneAll as CompleteIcon,
  Edit as EditIcon,
  HomeWork as PropertyIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { Link as RouterLink } from 'react-router-dom';
import {
  activateSubletContract,
  cancelSubletContract,
  completeSubletContract,
  createSubletContract,
  getBOQ,
  getProjectUnits,
  getSlabSchedules,
  getSubletContracts,
  getSuppliers,
  getWbsActivities,
  updateSubletContract
} from '../../services/projectManagementService';
import SlabRowsEditor, { emptySlab, slabsTotalPercent } from '../../components/ProjectManagement/SlabRowsEditor';
import { SLAB_SCHEDULES_PATH, normalizeWbsProjectType, wbsProjectTypeLabel } from '../../utils/wbsProjectTypes';
import { SubBudgetStrip } from '../../components/ProjectManagement/ProjectBudgetPanel';
import { unitWord } from './UnitsTab';
import BarterPropertiesDialog from '../../components/ProjectManagement/BarterPropertiesDialog';
import BarterBalancesPanel from '../../components/ProjectManagement/BarterBalancesPanel';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(v || 0));

const STATUS_COLOR = {
  Draft: 'default',
  Active: 'success',
  Completed: 'info',
  Cancelled: 'error'
};

const CONTRACT_TYPE_LABEL = { BOQ: 'BOQ Wise', Slab: 'Slab Wise' };
const CONTRACT_TYPE_COLOR = { BOQ: 'primary', Slab: 'secondary' };
const contractTypeOf = (row) => (row?.contractType === 'Slab' ? 'Slab' : 'BOQ');

const emptyForm = {
  title: '',
  contractor: '',
  notes: '',
  startDate: dayjs().format('YYYY-MM-DD'),
  endDate: '',
  contractType: 'BOQ',
  lines: [],
  contractValue: '',
  clientValue: '', // slab-wise: what the client pays for this scope (client invoices bill clientValue × slab %)
  slabScheduleId: '',
  slabs: [],
  units: [], // ids of the Sub Project's villas / units this contract covers
  ratePerUnit: '', // slab-wise with units: contractor's price per villa
  clientRatePerUnit: '', // slab-wise with units: client's price per villa
  propertyPercent: '' // Mixed payment mode: share of the value paid in property
};

/** Contracts share work only if their units overlap — no units means the whole Sub Project */
const unitIdsOf = (row) => (row?.units || []).map((u) => String(u.unit?._id || u.unit));
const overlaps = (a, b) => !a.length || !b.length || a.some((id) => b.includes(id));

/** Contract slabs → SlabRowsEditor rows (activities as ids). */
const toEditorSlabs = (slabs = []) =>
  slabs.map((s) => ({
    key: s._id || emptySlab().key,
    name: s.name,
    percentage: s.percentage,
    description: s.notes || s.description || '',
    activities: (s.activities || []).map((a) => String(a.activity?._id || a.activity || a._id || a))
  }));

const SubletContractsTab = ({ projectId, project, onGoToTab }) => {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [boqItems, setBoqItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const basis = project?.contractBasis || null;
  // New contracts need an approved Main Project budget with a share given to this Sub Project
  const budgetBlocked = (() => {
    const b = project?.budgetAllocation;
    if (!b || !project?.parentProject) return null;
    if (!(b.inForce ?? b.budgetStatus === 'Approved')) return 'The Main Project budget is not approved yet';
    const mine = b.subProjects.find((s) => String(s._id) === String(project._id));
    return mine?.allocatedBudget > 0 ? null : 'This sub project is not in the approved budget yet — add it with a budget revision';
  })();
  const [slabSchedules, setSlabSchedules] = useState([]);
  const [wbsActivities, setWbsActivities] = useState([]);
  const [dialogError, setDialogError] = useState('');
  const wbsType = normalizeWbsProjectType(project?.projectType);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [viewRow, setViewRow] = useState(null);
  const [barterRow, setBarterRow] = useState(null);
  const [projectUnits, setProjectUnits] = useState(project?.units || []);
  const hasUnits = projectUnits.length > 0;
  const word = unitWord(project?.projectType);
  // Cash / Barter / Mixed — set on the Main Project; decides the property (barter) share of each contract
  const paymentMode = project?.paymentMode || 'Cash';
  const words = unitWord(project?.projectType, true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.contractType = typeFilter;
      const [scRes, boqRes, suppRes, schedRes, actRes, unitsRes] = await Promise.all([
        getSubletContracts(projectId, params),
        getBOQ(projectId, { limit: 500 }),
        getSuppliers().catch(() => ({ data: { data: [] } })),
        wbsType ? getSlabSchedules({ projectType: wbsType }).catch(() => ({ data: { data: [] } })) : { data: { data: [] } },
        wbsType ? getWbsActivities({ projectType: wbsType }).catch(() => ({ data: { data: {} } })) : { data: { data: {} } },
        getProjectUnits(projectId).catch(() => ({ data: { data: project?.units || [] } }))
      ]);
      setProjectUnits(unitsRes.data?.data || []);
      setRows(scRes.data?.data?.contracts || []);
      setSlabSchedules(schedRes.data?.data || []);
      setWbsActivities(actRes.data?.data?.activities || []);
      setCounts(scRes.data?.data?.counts || {});
      setBoqItems(boqRes.data?.data?.items || []);
      const suppList = suppRes.data?.data?.suppliers || suppRes.data?.data || [];
      setSuppliers(Array.isArray(suppList) ? suppList : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load sublet contracts');
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter, typeFilter, wbsType, project?.units]);

  useEffect(() => {
    load();
  }, [load]);

  const buildLinesFromBoq = (selectedMap = new Map()) =>
    boqItems.map((b) => {
      const hit = selectedMap.get(String(b._id));
      return {
        boqItemId: b._id,
        label: b.title || b.description,
        unit: b.unit,
        estimatedQuantity: b.estimatedQuantity,
        quantity: hit ? hit.quantity : 0,
        unitPrice: hit
          ? hit.unitPrice
          : b.contractorUnitPrice || b.estimatedUnitPrice || 0,
        selected: Boolean(hit)
      };
    });

  const openCreate = () => {
    setEditing(null);
    setDialogError('');
    setForm({
      ...emptyForm,
      title: `Sublet — ${project?.name || ''}`.trim(),
      lines: buildLinesFromBoq(),
      // The Main Project decides BOQ-wise or Slab-wise for everything under it
      contractType: basis || emptyForm.contractType,
      slabs: basis === 'Slab' ? [emptySlab()] : []
    });
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setDialogError('');
    const selectedMap = new Map(
      (row.items || []).map((i) => [
        String(i.boqItem?._id || i.boqItem),
        { quantity: i.quantity, unitPrice: i.unitPrice }
      ])
    );
    setForm({
      title: row.title || '',
      contractor: row.contractor?._id || row.contractor || '',
      notes: row.notes || '',
      startDate: row.startDate ? dayjs(row.startDate).format('YYYY-MM-DD') : '',
      endDate: row.endDate ? dayjs(row.endDate).format('YYYY-MM-DD') : '',
      contractType: contractTypeOf(row),
      lines: buildLinesFromBoq(selectedMap),
      contractValue: contractTypeOf(row) === 'Slab' ? row.totalAmount || '' : '',
      clientValue: contractTypeOf(row) === 'Slab' ? row.clientValue || '' : '',
      slabScheduleId: row.slabSchedule?._id || row.slabSchedule || '',
      slabs: toEditorSlabs(row.slabs),
      units: unitIdsOf(row),
      ratePerUnit: row.ratePerUnit || '',
      clientRatePerUnit: row.clientRatePerUnit || '',
      propertyPercent: row.propertyPercent || ''
    });
    setDialogOpen(true);
  };

  const isSlabForm = form.contractType === 'Slab';
  const perUnit = isSlabForm && hasUnits;
  const slabValue = perUnit ? (Number(form.ratePerUnit) || 0) * form.units.length : Number(form.contractValue) || 0;
  const slabClientValue = perUnit ? (Number(form.clientRatePerUnit) || 0) * form.units.length : Number(form.clientValue) || 0;
  const totalAmount = isSlabForm
    ? slabValue
    : form.lines
      .filter((l) => l.selected && Number(l.quantity) > 0)
      .reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);

  // Activities already covered by another open slab-wise contract for the same villas / units
  const takenActivityIds = new Set(
    rows
      .filter((r) => contractTypeOf(r) === 'Slab' && r.status !== 'Cancelled' && r._id !== editing?._id)
      .filter((r) => overlaps(unitIdsOf(r), form.units))
      .flatMap((r) => (r.slabs || []).flatMap((sl) => (sl.activities || []).map((a) => String(a.activity?._id || a.activity))))
  );

  const applySlabSchedule = (scheduleId) => {
    const schedule = slabSchedules.find((sc) => String(sc._id) === String(scheduleId));
    setForm((f) => ({
      ...f,
      slabScheduleId: scheduleId,
      slabs: schedule
        ? toEditorSlabs(schedule.slabs).map((sl) => ({
          ...sl,
          key: emptySlab().key,
          activities: sl.activities.filter((id) => !takenActivityIds.has(String(id)))
        }))
        : f.slabs
    }));
  };

  const handleSave = async (activateAfter = false) => {
    const fail = (msg) => setDialogError(msg);
    if (!form.title.trim()) return fail('Title is required');
    if (!form.contractor) return fail('Subcontractor is required');

    const payload = {
      title: form.title.trim(),
      contractor: form.contractor,
      notes: form.notes,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      contractType: form.contractType,
      activate: activateAfter && !editing
    };
    if (paymentMode === 'Mixed') {
      const pct = Number(form.propertyPercent);
      if (!(pct > 0 && pct < 100)) return fail('Enter the property share — between 1% and 99%');
      payload.propertyPercent = pct;
    }
    if (hasUnits) {
      if (!form.units.length) return fail(`Select the ${words.toLowerCase()} this contract covers`);
      payload.units = form.units;
    }

    if (isSlabForm) {
      if (!wbsType) return fail('Set this Sub Project\'s Project Type before creating a slab-wise contract');
      if (perUnit ? !(Number(form.ratePerUnit) > 0) : !(Number(form.contractValue) > 0)) {
        return fail(perUnit ? `Enter the rate per ${word.toLowerCase()}` : 'Enter the contract value');
      }
      if (!form.slabs.length) return fail('Add at least one slab');
      if (form.slabs.some((sl) => !String(sl.name).trim())) return fail('Every slab needs a name');
      if (Math.abs(slabsTotalPercent(form.slabs) - 100) >= 0.001) return fail('Slab percentages must total 100%');
      if (perUnit) {
        payload.ratePerUnit = Number(form.ratePerUnit);
        payload.clientRatePerUnit = Number(form.clientRatePerUnit) || 0;
      } else {
        payload.contractValue = Number(form.contractValue);
        payload.clientValue = Number(form.clientValue) || 0;
      }
      payload.slabSchedule = form.slabScheduleId || null;
      payload.slabs = form.slabs.map((sl) => ({
        name: String(sl.name).trim(),
        percentage: Number(sl.percentage) || 0,
        description: sl.description || '',
        activities: sl.activities
      }));
    } else {
      const items = form.lines
        .filter((l) => l.selected && Number(l.quantity) > 0)
        .map((l) => ({
          boqItemId: l.boqItemId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice) || 0
        }));
      if (!items.length) return fail('Select at least one BOQ line with quantity to sublet');
      payload.items = items;
    }

    try {
      setSaving(true);
      setDialogError('');

      if (editing) {
        await updateSubletContract(projectId, editing._id, payload);
        if (activateAfter) {
          await activateSubletContract(projectId, editing._id);
          setSuccess('Sublet contract updated and activated');
        } else {
          setSuccess('Sublet contract updated');
        }
      } else {
        const res = await createSubletContract(projectId, payload);
        setSuccess(res.data?.message || (activateAfter ? 'Sublet contract created and activated' : 'Sublet contract created'));
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (row) => {
    try {
      const res = await activateSubletContract(projectId, row._id);
      setSuccess(res.data?.message || 'Sublet contract activated');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Activate failed');
    }
  };

  const handleComplete = async (row) => {
    try {
      await completeSubletContract(projectId, row._id);
      setSuccess('Sublet contract completed');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Complete failed');
    }
  };

  const handleCancel = async (row) => {
    if (!window.confirm(`Cancel ${row.contractNumber}?`)) return;
    try {
      await cancelSubletContract(projectId, row._id);
      setSuccess('Sublet contract cancelled');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Cancel failed');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <SubBudgetStrip project={project} />
      {paymentMode !== 'Cash' && <BarterBalancesPanel projectId={projectId} reloadKey={rows} />}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Sublet Contracts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sublet work to subcontractors — BOQ wise (qty × rate) or Slab wise (% of contract value per stage)
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {!basis && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Type</InputLabel>
            <Select label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <MenuItem value="">All types</MenuItem>
              <MenuItem value="BOQ">BOQ Wise</MenuItem>
              <MenuItem value="Slab">Slab Wise</MenuItem>
            </Select>
          </FormControl>
          )}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              {['Draft', 'Active', 'Completed', 'Cancelled'].map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <IconButton onClick={load}>
            <RefreshIcon />
          </IconButton>
          <Tooltip title={budgetBlocked || ''}>
            <span>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={Boolean(budgetBlocked)}>
                New Sublet Contract
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" useFlexGap>
        {[
          ['Draft', counts.draft],
          ['Active', counts.active],
          ['Completed', counts.completed],
          ['Cancelled', counts.cancelled]
        ].map(([label, n]) => (
          <Chip
            key={label}
            size="small"
            label={`${label}: ${n || 0}`}
            color={STATUS_COLOR[label] || 'default'}
            variant="outlined"
          />
        ))}
      </Stack>

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

      <Alert severity="info" sx={{ mb: 2 }}>
        <strong>BOQ Wise:</strong> select BOQ lines + quantities and rates. <strong>Slab Wise:</strong> enter the
        contract value and split it into slabs (stages) by %, each covering WBS activities. Save as draft, then{' '}
        <strong>Activate</strong>. Check Requests / IPC can then use that contractor.
      </Alert>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
              <TableHead>
            <TableRow>
              <TableCell>Number</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Main / Sub</TableCell>
              <TableCell>Sector / Block</TableCell>
              <TableCell>Subcontractor</TableCell>
              <TableCell align="right">Lines / Slabs</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Period</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} align="center">
                  <Box py={3}>
                    <Typography color="text.secondary">No sublet contracts yet</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
                      {boqItems.length
                        ? 'Award BOQ lines to a subcontractor at agreed rates, then activate the contract.'
                        : 'This Sub Project has no BOQ lines yet — add them before creating a contract.'}
                    </Typography>
                    {boqItems.length ? (
                      <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate} disabled={Boolean(budgetBlocked)}>New Sublet Contract</Button>
                    ) : onGoToTab && (
                      <Button variant="outlined" size="small" onClick={() => onGoToTab('boq')}>Go to BOQ</Button>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row._id} hover>
                  <TableCell>{row.contractNumber}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={CONTRACT_TYPE_LABEL[contractTypeOf(row)]}
                      color={CONTRACT_TYPE_COLOR[contractTypeOf(row)]}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.title}
                    </Typography>
                    {row.units?.length > 0 && (
                      <Tooltip title={row.units.map((u) => u.name).join(', ')}>
                        <Typography variant="caption" color="text.secondary">
                          {row.units.length === projectUnits.length ? `All ${words.toLowerCase()}` : `${row.units.length} ${row.units.length === 1 ? word.toLowerCase() : words.toLowerCase()}`}
                          {row.ratePerUnit > 0 ? ` · ${fmt(row.ratePerUnit)} each` : ''}
                        </Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {row.mainProjectName || project?.parentProject?.name || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.subProjectName || project?.name || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.sector || project?.sector || '—'}</TableCell>
                  <TableCell>{row.contractor?.name || '—'}</TableCell>
                  <TableCell align="right">
                    {contractTypeOf(row) === 'Slab'
                      ? `${row.slabs?.length || 0} slab${row.slabs?.length === 1 ? '' : 's'}`
                      : `${row.items?.length || 0} line${row.items?.length === 1 ? '' : 's'}`}
                  </TableCell>
                  <TableCell align="right">
                    {fmt(row.totalAmount)}
                    {row.propertyPercent > 0 && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.propertyPercent >= 100 ? 'All in property' : `Cash ${fmt(row.cashAmount)} · Property ${fmt(row.propertyAmount)}`}
                        {` · ${(row.barterProperties || []).filter((p) => p.status !== 'Released').length || 'no'} propert${(row.barterProperties || []).filter((p) => p.status !== 'Released').length === 1 ? 'y' : 'ies'}`}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={row.status} color={STATUS_COLOR[row.status] || 'default'} />
                  </TableCell>
                  <TableCell>
                    {row.startDate ? dayjs(row.startDate).format('DD MMM YY') : '—'}
                    {row.endDate ? ` → ${dayjs(row.endDate).format('DD MMM YY')}` : ''}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="View">
                      <IconButton size="small" onClick={() => setViewRow(row)}>
                        <ViewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {row.propertyPercent > 0 && ['Draft', 'Active'].includes(row.status) && (
                      <Tooltip title="Properties given in exchange">
                        <IconButton size="small" color="warning" onClick={() => setBarterRow(row)}>
                          <PropertyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {row.status === 'Draft' && (
                      <>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => openEdit(row)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Activate">
                          <IconButton size="small" color="success" onClick={() => handleActivate(row)}>
                            <ActivateIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    {row.status === 'Active' && (
                      <Tooltip title="Mark Completed">
                        <IconButton size="small" color="info" onClick={() => handleComplete(row)}>
                          <CompleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {['Draft', 'Active'].includes(row.status) && (
                      <Tooltip title="Cancel">
                        <IconButton size="small" color="error" onClick={() => handleCancel(row)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth={isSlabForm ? 'lg' : 'md'} fullWidth>
        <DialogTitle>{editing ? `Edit Sublet Contract ${editing.contractNumber || ''}` : 'New Sublet Contract'}</DialogTitle>
        <DialogContent dividers>
          {dialogError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDialogError('')}>
              {dialogError}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" mb={0.75}>
                Contract type
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                color="primary"
                value={form.contractType}
                onChange={(_, v) => {
                  if (!v) return;
                  setDialogError('');
                  setForm((f) => ({ ...f, contractType: v, slabs: v === 'Slab' && !f.slabs.length ? [emptySlab()] : f.slabs }));
                }}
              >
                <ToggleButton value="BOQ" disabled={Boolean(basis) && basis !== 'BOQ'} sx={{ px: 2.5 }}>BOQ Wise</ToggleButton>
                <ToggleButton value="Slab" disabled={Boolean(basis) && basis !== 'Slab'} sx={{ px: 2.5 }}>Slab Wise (Percentage)</ToggleButton>
              </ToggleButtonGroup>
              {basis && (
                <Typography variant="caption" color="primary" fontWeight={700} display="block" mt={0.75}>
                  This project is {basis === 'Slab' ? 'Slab-wise' : 'BOQ-wise'} (set on the Main Project), so its contracts are {basis === 'Slab' ? 'Slab-wise' : 'BOQ-wise'}.
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" display="block" mt={0.75}>
                {isSlabForm
                  ? 'Lump-sum contract paid in stages: each slab is a % of the contract value and covers WBS activities.'
                  : 'Paid on measured quantities: BOQ line quantity × rate.'}
              </Typography>
            </Grid>
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
                        project?.parentProject?.name ||
                        editing?.mainProjectName ||
                        '—'
                      }
                      InputProps={{ readOnly: true }}
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Sub Project"
                      value={project?.name || editing?.subProjectName || '—'}
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
                        editing?.sector ||
                        '—'
                      }
                      InputProps={{ readOnly: true }}
                    />
                  </Grid>
                  {(project?.society || editing?.society) && (
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Society"
                        value={project?.society || editing?.society || '—'}
                        InputProps={{ readOnly: true }}
                      />
                    </Grid>
                  )}
                </Grid>
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                label="Title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={suppliers}
                getOptionLabel={(option) => {
                  if (!option) return '';
                  const idStr = option.supplierId ? ` (${option.supplierId})` : '';
                  return `${option.name || ''}${idStr}`;
                }}
                value={suppliers.find((s) => String(s._id) === String(form.contractor)) || null}
                onChange={(_, newValue) =>
                  setForm((f) => ({ ...f, contractor: newValue ? newValue._id : '' }))
                }
                isOptionEqualToValue={(option, value) =>
                  String(option._id) === String(value._id || value)
                }
                renderInput={(params) => (
                  <TextField {...params} required label="Subcontractor" />
                )}
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <TextField
                fullWidth
                type="date"
                label="Start Date"
                InputLabelProps={{ shrink: true }}
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <TextField
                fullWidth
                type="date"
                label="End Date"
                InputLabelProps={{ shrink: true }}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Grid>
            {hasUnits && (
              <Grid item xs={12}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.75}>
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>
                    {words} covered ({form.units.length} of {projectUnits.length})
                  </Typography>
                  <Stack direction="row" gap={1}>
                    <Button size="small" onClick={() => setForm((f) => ({ ...f, units: projectUnits.map((u) => String(u._id)) }))}>All {words.toLowerCase()}</Button>
                    <Button size="small" color="inherit" onClick={() => setForm((f) => ({ ...f, units: [] }))}>Clear</Button>
                  </Stack>
                </Stack>
                <Autocomplete
                  multiple
                  disableCloseOnSelect
                  options={projectUnits}
                  getOptionLabel={(u) => (u.plotNumber ? `${u.name} (${u.plotNumber})` : u.name)}
                  value={projectUnits.filter((u) => form.units.includes(String(u._id)))}
                  onChange={(_, picked) => setForm((f) => ({ ...f, units: picked.map((u) => String(u._id)) }))}
                  isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
                  renderInput={(params) => (
                    <TextField {...params} required label={`${words} this contract covers`} placeholder={form.units.length ? '' : `Pick ${words.toLowerCase()}`} />
                  )}
                />
                <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                  One contractor can take the same work for many {words.toLowerCase()}; another contractor can take the same work for other {words.toLowerCase()}.
                </Typography>
              </Grid>
            )}
            {paymentMode !== 'Cash' && (() => {
              const pct = paymentMode === 'Barter' ? 100 : Math.max(0, Math.min(100, Number(form.propertyPercent) || 0));
              const propertyAmount = Math.round((totalAmount * pct) / 100);
              return (
                <Grid item xs={12}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: '#fffbeb', borderColor: '#fde68a' }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Payment: {paymentMode === 'Barter' ? 'Barter — paid in property' : 'Mixed — part cash, part property'}
                    </Typography>
                    <Grid container spacing={2} alignItems="center" sx={{ mt: 0.25 }}>
                      {paymentMode === 'Mixed' && (
                        <Grid item xs={12} sm={4}>
                          <TextField
                            fullWidth
                            size="small"
                            required
                            type="number"
                            label="Property share (%)"
                            value={form.propertyPercent}
                            onChange={(e) => setForm((f) => ({ ...f, propertyPercent: e.target.value }))}
                            inputProps={{ min: 1, max: 99, step: 'any' }}
                          />
                        </Grid>
                      )}
                      <Grid item xs={6} sm={4}>
                        <Typography variant="caption" color="text.secondary">Cash ({100 - pct}%)</Typography>
                        <Typography fontWeight={800}>{fmt(totalAmount - propertyAmount)}</Typography>
                      </Grid>
                      <Grid item xs={6} sm={4}>
                        <Typography variant="caption" color="text.secondary">Property ({pct}%)</Typography>
                        <Typography fontWeight={800}>{fmt(propertyAmount)}</Typography>
                      </Grid>
                    </Grid>
                    <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                      The properties given in exchange are picked in the next step, once the contract is saved.
                    </Typography>
                  </Paper>
                </Grid>
              );
            })()}
            {isSlabForm && (
              <Grid item xs={12}>
                {!wbsType ? (
                  <Alert severity="warning">
                    This Sub Project's type ({project?.projectType || 'not set'}) has no WBS activities or slabs.
                    Set its Project Type to Infrastructure Development, Commercial or Villas first.
                  </Alert>
                ) : (
                  <>
                    <Grid container spacing={2} mb={2}>
                      <Grid item xs={12} md={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Load slab schedule ({wbsProjectTypeLabel(wbsType)})</InputLabel>
                          <Select
                            label={`Load slab schedule (${wbsProjectTypeLabel(wbsType)})`}
                            value={form.slabScheduleId}
                            onChange={(e) => applySlabSchedule(e.target.value)}
                          >
                            <MenuItem value="">— Custom slabs —</MenuItem>
                            {slabSchedules.map((sc) => (
                              <MenuItem key={sc._id} value={sc._id}>
                                {sc.name} ({sc.slabs.length} slabs)
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        {!slabSchedules.length && (
                          <Typography variant="caption" color="text.secondary">
                            No saved schedules for {wbsProjectTypeLabel(wbsType)}. Create them in{' '}
                            <RouterLink to={SLAB_SCHEDULES_PATH}>Slab Templates</RouterLink>, or enter slabs below.
                          </Typography>
                        )}
                      </Grid>
                      {perUnit ? (
                        <>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              size="small"
                              required
                              type="number"
                              label={`Rate per ${word.toLowerCase()} (PKR)`}
                              value={form.ratePerUnit}
                              onChange={(e) => setForm((f) => ({ ...f, ratePerUnit: e.target.value }))}
                              inputProps={{ min: 0, step: 'any' }}
                              helperText={`Contract value ${fmt(slabValue)} = ${fmt(form.ratePerUnit)} × ${form.units.length} ${form.units.length === 1 ? word.toLowerCase() : words.toLowerCase()}`}
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              size="small"
                              type="number"
                              label={`Client rate per ${word.toLowerCase()} (PKR) — optional`}
                              value={form.clientRatePerUnit}
                              onChange={(e) => setForm((f) => ({ ...f, clientRatePerUnit: e.target.value }))}
                              inputProps={{ min: 0, step: 'any' }}
                              helperText={slabClientValue > 0 && slabValue > 0
                                ? `Client value ${fmt(slabClientValue)} · margin ${Math.round(((slabClientValue - slabValue) / slabClientValue) * 100)}%`
                                : `What the client pays per ${word.toLowerCase()} — each verified slab is billed to the client at this × slab %`}
                            />
                          </Grid>
                        </>
                      ) : (<>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          size="small"
                          required
                          type="number"
                          label="Contract Value (PKR)"
                          value={form.contractValue}
                          onChange={(e) => setForm((f) => ({ ...f, contractValue: e.target.value }))}
                          inputProps={{ min: 0, step: 'any' }}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          size="small"
                          type="number"
                          label="Client value (PKR) — optional"
                          value={form.clientValue}
                          onChange={(e) => setForm((f) => ({ ...f, clientValue: e.target.value }))}
                          inputProps={{ min: 0, step: 'any' }}
                          helperText={Number(form.clientValue) > 0 && Number(form.contractValue) > 0
                            ? `What the client pays for this scope · margin ${Math.round(((Number(form.clientValue) - Number(form.contractValue)) / Number(form.clientValue)) * 100)}%`
                            : 'What the client pays for this scope — each verified slab is billed to the client at this × slab %'}
                        />
                      </Grid>
                      </>)}
                    </Grid>
                    <Typography variant="subtitle2" fontWeight={700} mb={1}>
                      Slabs (payment stages)
                    </Typography>
                    <SlabRowsEditor
                      slabs={form.slabs}
                      activities={wbsActivities}
                      contractValue={slabValue}
                      disabledActivityIds={takenActivityIds}
                      onChange={(slabs) => setForm((f) => ({ ...f, slabs }))}
                    />
                    {takenActivityIds.size > 0 && (
                      <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                        Greyed-out activities are already covered by another slab-wise contract{hasUnits ? ` for one of the selected ${words.toLowerCase()}` : ' on this Sub Project'}.
                      </Typography>
                    )}
                    <Typography variant="subtitle2" mt={1.5} fontWeight={700}>
                      Contract total: {fmt(totalAmount)}
                    </Typography>
                  </>
                )}
              </Grid>
            )}
            {!isSlabForm && (
            <Grid item xs={12}>
              <Typography variant="subtitle2" fontWeight={700} mb={1}>
                BOQ lines to sublet
              </Typography>
              {boqItems.length === 0 ? (
                <Alert
                  severity="warning"
                  action={onGoToTab && (
                    <Button color="inherit" size="small" onClick={() => { setDialogOpen(false); onGoToTab('boq'); }}>
                      Go to BOQ
                    </Button>
                  )}
                >
                  No BOQ items on this Sub Project yet. Add lines or allocate quantity from the Main Project BOQ first.
                </Alert>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">Use</TableCell>
                      <TableCell>Item</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell align="right">BOQ Qty</TableCell>
                      <TableCell align="right">Sublet Qty</TableCell>
                      <TableCell align="right">Rate</TableCell>
                      <TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {form.lines.map((line, idx) => (
                      <TableRow key={line.boqItemId}>
                        <TableCell padding="checkbox">
                          <input
                            type="checkbox"
                            checked={line.selected}
                            onChange={(e) => {
                              const selected = e.target.checked;
                              setForm((f) => {
                                const lines = [...f.lines];
                                lines[idx] = {
                                  ...lines[idx],
                                  selected,
                                  quantity:
                                    selected && !Number(lines[idx].quantity)
                                      ? lines[idx].estimatedQuantity || 0
                                      : lines[idx].quantity
                                };
                                return { ...f, lines };
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>{line.label}</TableCell>
                        <TableCell>{line.unit}</TableCell>
                        <TableCell align="right">{line.estimatedQuantity}</TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            disabled={!line.selected}
                            value={line.quantity}
                            onChange={(e) => {
                              const quantity = e.target.value;
                              setForm((f) => {
                                const lines = [...f.lines];
                                lines[idx] = { ...lines[idx], quantity };
                                return { ...f, lines };
                              });
                            }}
                            inputProps={{ min: 0, step: 'any' }}
                            sx={{ width: 100 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            disabled={!line.selected}
                            value={line.unitPrice}
                            onChange={(e) => {
                              const unitPrice = e.target.value;
                              setForm((f) => {
                                const lines = [...f.lines];
                                lines[idx] = { ...lines[idx], unitPrice };
                                return { ...f, lines };
                              });
                            }}
                            inputProps={{ min: 0, step: 'any' }}
                            sx={{ width: 110 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {line.selected
                            ? fmt(Number(line.quantity) * Number(line.unitPrice))
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Typography variant="subtitle2" mt={1.5} fontWeight={700}>
                Contract total: {fmt(totalAmount)}
              </Typography>
            </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="outlined" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button variant="contained" color="success" onClick={() => handleSave(true)} disabled={saving}>
            {saving ? 'Saving…' : 'Save & Activate'}
          </Button>
        </DialogActions>
      </Dialog>

      <BarterPropertiesDialog
        open={Boolean(barterRow)}
        projectId={projectId}
        contract={barterRow}
        onClose={() => setBarterRow(null)}
        onSaved={async (message) => {
          setSuccess(message || 'Properties saved');
          setBarterRow(null);
          await load();
        }}
      />

      <Dialog open={Boolean(viewRow)} onClose={() => setViewRow(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {viewRow?.contractNumber} — {viewRow?.title}
        </DialogTitle>
        <DialogContent dividers>
          {viewRow && (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={viewRow.status} color={STATUS_COLOR[viewRow.status]} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={CONTRACT_TYPE_LABEL[contractTypeOf(viewRow)]}
                  color={CONTRACT_TYPE_COLOR[contractTypeOf(viewRow)]}
                />
                <Typography variant="body2">
                  Subcontractor: {viewRow.contractor?.name || '—'}
                </Typography>
              </Stack>
              <Typography variant="body2">
                <strong>Main:</strong> {viewRow.mainProjectName || project?.parentProject?.name || '—'}
                {' · '}
                <strong>Sub:</strong> {viewRow.subProjectName || project?.name || '—'}
                {' · '}
                <strong>Sector / Block:</strong> {viewRow.sector || project?.sector || '—'}
              </Typography>
              {viewRow.propertyPercent > 0 && (
                <Typography variant="body2">
                  <strong>Payment:</strong> {viewRow.propertyPercent >= 100 ? 'Barter' : 'Mixed'}
                  {' · '}Cash {fmt(viewRow.cashAmount)} ({100 - viewRow.propertyPercent}%)
                  {' · '}Property {fmt(viewRow.propertyAmount)} ({viewRow.propertyPercent}%)
                </Typography>
              )}
              {(viewRow.barterProperties || []).length > 0 && (
                <Box>
                  <Typography variant="body2" fontWeight={700}>Properties given in exchange</Typography>
                  {viewRow.barterProperties.map((p) => (
                    <Typography key={p._id} variant="body2" color={p.status === 'Released' ? 'text.disabled' : 'text.primary'}>
                      {p.label}{p.area ? ` (${p.area})` : ''} — {fmt(p.agreedValue)} · {p.status}
                    </Typography>
                  ))}
                </Box>
              )}
              {viewRow.units?.length > 0 && (
                <Typography variant="body2">
                  <strong>{words} ({viewRow.units.length}):</strong> {viewRow.units.map((u) => u.name).join(', ')}
                  {viewRow.ratePerUnit > 0 && <> · <strong>Rate:</strong> {fmt(viewRow.ratePerUnit)} per {word.toLowerCase()}</>}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                {viewRow.notes || 'No notes'}
              </Typography>
              {contractTypeOf(viewRow) === 'Slab' ? (
                <>
                  {viewRow.slabSchedule?.name && (
                    <Typography variant="body2">
                      <strong>Slab schedule:</strong> {viewRow.slabSchedule.name}
                    </Typography>
                  )}
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Slab / Stage</TableCell>
                        <TableCell align="right">%</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>WBS Activities</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(viewRow.slabs || []).map((sl, idx) => (
                        <TableRow key={sl._id || idx}>
                          <TableCell>{idx + 1}</TableCell>
                          <TableCell>{sl.name}</TableCell>
                          <TableCell align="right">{sl.percentage}%</TableCell>
                          <TableCell align="right">{fmt(sl.amount)}</TableCell>
                          <TableCell>
                            <Stack direction="row" flexWrap="wrap" gap={0.5}>
                              {(sl.activities || []).length
                                ? sl.activities.map((a) => <Chip key={String(a.activity)} size="small" label={a.name} />)
                                : '—'}
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(viewRow.items || []).map((i, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{i.title || i.description}</TableCell>
                      <TableCell align="right">
                        {i.quantity} {i.unit}
                      </TableCell>
                      <TableCell align="right">{fmt(i.unitPrice)}</TableCell>
                      <TableCell align="right">{fmt(i.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
              <Typography variant="subtitle2" fontWeight={700}>
                Total: {fmt(viewRow.totalAmount)}
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewRow(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SubletContractsTab;
