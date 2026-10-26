import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  FormHelperText,
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
  Cancel as CancelIcon,
  AssignmentTurnedIn as InspectionIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Print as PrintIcon,
  Refresh as RefreshIcon,
  Send as SubmitIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import {
  cancelCheckRequest,
  createCheckRequest,
  getBOQ,
  getCheckRequests,
  getSubletContracts,
  getWbsActivities,
  rejectCheckRequest,
  submitCheckRequest,
  updateCheckRequest,
  getInspectionReports
} from '../../services/projectManagementService';
import { normalizeWbsProjectType, wbsProjectTypeLabel } from '../../utils/wbsProjectTypes';
import { printCheckRequest } from '../../utils/checkRequestPrint';
import InspectionReportDialog from '../../components/ProjectManagement/InspectionReportDialog';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(v || 0));

const STATUS_COLOR = {
  Draft: 'default',
  Submitted: 'warning',
  Verified: 'success',
  Rejected: 'error',
  Cancelled: 'default',
  Billed: 'info'
};

const emptyForm = {
  title: '',
  contractor: '',
  claimType: 'BOQ', // 'Slab' = claim one stage of a slab-wise contract; 'BOQ' = claim BOQ quantities
  subletContract: '',
  slabId: '',
  activity: '',
  task: '',
  notes: '',
  lines: []
};

const CheckRequestsTab = ({ projectId, project, onGoToTab }) => {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [boqItems, setBoqItems] = useState([]);
  const [activities, setActivities] = useState([]);
  const wbsType = normalizeWbsProjectType(project?.projectType);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [viewRow, setViewRow] = useState(null);
  // Inspection reports verify Submitted requests; { checkRequest } = create, { report } = view / sign
  const [reports, setReports] = useState([]);
  const [inspection, setInspection] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectRow, setRejectRow] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  // Active sublet contracts on this Sub Project — the only source of contractors / activities / rates
  const [contracts, setContracts] = useState(null);
  const activeContracts = contracts ? contracts.length : null;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [crRes, boqRes, actRes, scRes, irRes] = await Promise.all([
        getCheckRequests(projectId, statusFilter ? { status: statusFilter } : {}),
        getBOQ(projectId, { limit: 500 }),
        wbsType
          ? getWbsActivities({ projectType: wbsType }).catch(() => ({ data: { data: {} } }))
          : { data: { data: {} } },
        getSubletContracts(projectId, { status: 'Active' }).catch(() => null),
        getInspectionReports(projectId).catch(() => ({ data: { data: [] } }))
      ]);
      setReports(irRes.data?.data || []);
      setContracts(scRes ? (scRes.data?.data?.contracts || []) : null);
      setRows(crRes.data?.data?.checkRequests || []);
      setCounts(crRes.data?.data?.counts || {});
      setBoqItems(boqRes.data?.data?.items || []);
      setActivities(actRes.data?.data?.activities || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load check requests');
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter, wbsType]);

  useEffect(() => {
    load();
  }, [load]);

  // Contractors = those holding an Active sublet contract here (plus the one already on an edited request)
  const contractorOptions = useMemo(() => {
    const byId = new Map();
    (contracts || []).forEach((c) => {
      if (c.contractor?._id) byId.set(String(c.contractor._id), c.contractor);
    });
    const current = editing?.contractor;
    if (current?._id && !byId.has(String(current._id))) byId.set(String(current._id), current);
    return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [contracts, editing]);

  /**
   * What a contractor's active contracts cover: WBS activities (slab-wise) and BOQ lines + agreed
   * rates (BOQ-wise). null = no restriction of that kind (e.g. BOQ-wise contracts don't map activities).
   */
  const scopeFor = useCallback((contractorId) => {
    const mine = (contracts || []).filter((c) => String(c.contractor?._id || c.contractor) === String(contractorId));
    const boqRates = new Map();
    const slabOptions = [];
    mine.forEach((c) => {
      if (c.contractType === 'Slab') {
        (c.slabs || []).forEach((slab) => slabOptions.push({ contract: c, slab }));
      } else {
        (c.items || []).forEach((i) => {
          const id = String(i.boqItem?._id || i.boqItem);
          if (!boqRates.has(id)) boqRates.set(id, { rate: Number(i.unitPrice) || 0, item: i });
        });
      }
    });
    const types = [...new Set(mine.map((c) => (c.contractType === 'Slab' ? 'Slab' : 'BOQ')))];
    return { types, slabOptions, boqRates: boqRates.size ? boqRates : null };
  }, [contracts]);

  const scope = useMemo(() => scopeFor(form.contractor), [scopeFor, form.contractor]);

  /** Contract type(s) per contractor, e.g. "Slab wise" or "BOQ wise" — a contractor may hold both. */
  const contractsByContractor = useMemo(() => {
    const map = new Map();
    (contracts || []).forEach((c) => {
      const key = String(c.contractor?._id || c.contractor);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });
    return map;
  }, [contracts]);
  const contractTypeLabel = (c) => (c.contractType === 'Slab' ? 'Slab wise' : 'BOQ wise');
  const typesFor = (contractorId) =>
    [...new Set((contractsByContractor.get(String(contractorId)) || []).map(contractTypeLabel))].join(' + ');

  const claimedSlabs = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      if (r.claimType === 'Slab' && r.slab?.slabId && r.status !== 'Cancelled' && String(r._id) !== String(editing?._id)) {
        map.set(String(r.slab.slabId), r.checkRequestNumber);
      }
    });
    return map;
  }, [rows, editing]);
  const selectedSlab = scope.slabOptions.find((o) => String(o.slab._id) === String(form.slabId)) || null;
  const slabAmount = (o) =>
    Number(o.slab.amount) || Math.round(((Number(o.contract.totalAmount) || 0) * (Number(o.slab.percentage) || 0)) / 100);

  // Contract(s) the form is claiming against — shown at the top of the dialog and on the print
  const formContracts = (() => {
    if (!form.contractor) return [];
    if (form.claimType === 'Slab' && selectedSlab) return [selectedSlab.contract];
    return (contractsByContractor.get(String(form.contractor)) || [])
      .filter((c) => (c.contractType === 'Slab' ? 'Slab' : 'BOQ') === form.claimType);
  })();
  const contractChipLabel = (c) => `${contractTypeLabel(c)} contract · ${c.contractNumber || c.title}`;

  const mainProjectName = project?.parentProject?.name || '—';
  const sectorLabel = [project?.sector, project?.society || project?.parentProject?.society].filter(Boolean).join(' · ')
    || project?.parentProject?.sector || '—';

  const projectPrintFields = { mainProject: mainProjectName, subProject: project?.name, sector: sectorLabel };

  /** Print the request being created / edited (works before it is saved). */
  const printForm = () => {
    const contractorName = contractorOptions.find((c) => String(c._id) === String(form.contractor))?.name;
    const activity = activityOptions.find((a) => String(a._id) === String(form.activity));
    const lines = form.lines
      .filter((l) => l.selected && Number(l.claimedQuantity) > 0)
      .map((l) => ({ label: l.label, unit: l.unit, claimed: l.claimedQuantity, verified: null, rate: l.unitPrice }));
    printCheckRequest({
      ...projectPrintFields,
      number: editing?.checkRequestNumber,
      status: editing?.status || 'Draft',
      date: editing?.createdAt,
      title: form.title,
      contractorName,
      contractLabel: formContracts.map(contractChipLabel).join('  |  '),
      claimType: form.claimType,
      activityLabel: activity ? `${activity.group ? `${activity.group} › ` : ''}${activity.name}` : '',
      slab: form.claimType === 'Slab' && selectedSlab
        ? { ...selectedSlab.slab, amount: slabAmount(selectedSlab) }
        : null,
      lines,
      claimedTotal: form.claimType === 'Slab' && selectedSlab ? slabAmount(selectedSlab) : claimedTotal,
      notes: form.notes
    });
  };

  /** Contract(s) a saved request was raised against (slab claims store theirs; BOQ claims use the contractor's BOQ-wise contracts). */
  const contractsForRow = (row) => (row.claimType === 'Slab'
    ? [row.subletContract].filter((c) => c?.contractNumber).map((c) => ({ ...c, contractType: 'Slab' }))
    : (contractsByContractor.get(String(row.contractor?._id || row.contractor)) || []).filter((c) => c.contractType !== 'Slab'));

  const activityText = (a) => (a ? `${a.group ? `${a.group} › ` : ''}${a.name}` : '');
  const personText = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

  const contextBar = (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: 'grey.50', borderRadius: 1.5 }}>
      <Grid container spacing={1.5}>
        {[
          ['Main Project', mainProjectName],
          ['Sub Project', project?.name || '—'],
          ['Sector', sectorLabel]
        ].map(([label, value]) => (
          <Grid item xs={12} sm={4} key={label}>
            <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
            <Typography variant="body2" fontWeight={600} noWrap title={value}>{value}</Typography>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );

  const reportsFor = (row) => reports.filter((r) => String(r.checkRequest?._id || r.checkRequest) === String(row._id));
  const latestReportFor = (row) => reportsFor(row).find((r) => r.status !== 'Cancelled');
  const openReportFor = (row) => reportsFor(row).find((r) => r.status === 'Pending');
  const openInspectionFor = (row) => {
    const pending = openReportFor(row);
    setInspection(pending ? { report: pending } : { checkRequest: row });
  };
  const inspectionContext = (row) => ({
    mainProject: mainProjectName,
    subProject: project?.name,
    sector: sectorLabel,
    contractLabel: row ? contractsForRow(row).map(contractChipLabel).join('  |  ') : ''
  });

  // Deep link from Approvals: ?inspection=<reportId> opens that report once loaded
  const linkedInspection = searchParams.get('inspection');
  useEffect(() => {
    if (!linkedInspection || !reports.length) return;
    const hit = reports.find((r) => String(r._id) === String(linkedInspection));
    if (hit) setInspection({ report: hit });
    const next = new URLSearchParams(searchParams);
    next.delete('inspection');
    setSearchParams(next, { replace: true });
  }, [linkedInspection, reports, searchParams, setSearchParams]);

  /** Print a saved request from the list / view dialog. */
  const printRow = (row) => {
    const rowContracts = contractsForRow(row);
    const verifiedStage = ['Verified', 'Billed'].includes(row.status);
    printCheckRequest({
      ...projectPrintFields,
      number: row.checkRequestNumber,
      status: row.status,
      date: row.createdAt,
      title: row.title,
      contractorName: row.contractor?.name,
      contractLabel: rowContracts.map(contractChipLabel).join('  |  '),
      claimType: row.claimType,
      activityLabel: row.activity ? `${row.activity.group ? `${row.activity.group} › ` : ''}${row.activity.name}` : '',
      slab: row.slab,
      lines: (row.items || []).map((i) => ({
        label: i.title || i.description,
        unit: i.unit,
        claimed: i.claimedQuantity,
        verified: verifiedStage ? i.verifiedQuantity : null,
        rate: i.unitPrice
      })),
      claimedTotal: row.claimedTotal,
      verifiedTotal: row.verifiedTotal,
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt,
      verificationNotes: row.verificationNotes,
      rejectionReason: row.rejectionReason,
      notes: row.notes
    });
  };

  // Only the selected contractor's activities; keep an edited request's activity selectable even if deactivated
  const activityOptions = useMemo(() => {
    if (!form.contractor) return [];
    const list = activities;
    const current = editing?.activity;
    if (current?._id && String(current._id) === String(form.activity) && !list.some((a) => String(a._id) === String(current._id))) {
      return [...list, current];
    }
    return list;
  }, [activities, form.contractor, form.activity, editing]);

  /** BOQ lines this contractor can claim (their contracted lines at contract rates), keeping any typed quantities. */
  const buildLines = useCallback((contractorId, previous = []) => {
    if (!contractorId) return [];
    const { boqRates } = scopeFor(contractorId);
    const prevById = new Map(previous.map((l) => [String(l.boqItemId), l]));
    const fromBoq = boqItems
      .filter((b) => !boqRates || boqRates.has(String(b._id)))
      .map((b) => ({
        boqItemId: b._id,
        label: b.title || b.description,
        unit: b.unit,
        rate: boqRates?.get(String(b._id))?.rate ?? (b.contractorUnitPrice || b.estimatedUnitPrice || 0)
      }));
    // Contracted lines outside this Sub's BOQ list (e.g. allocated from Main) still need to be claimable
    const seen = new Set(fromBoq.map((l) => String(l.boqItemId)));
    const extra = boqRates
      ? [...boqRates.entries()].filter(([id]) => !seen.has(id)).map(([id, { rate, item }]) => ({
          boqItemId: id,
          label: item.title || item.boqItem?.title || item.description || item.boqItem?.description || 'BOQ line',
          unit: item.unit || item.boqItem?.unit || '',
          rate
        }))
      : [];
    return [...fromBoq, ...extra].map(({ rate, ...l }) => {
      const prev = prevById.get(String(l.boqItemId));
      return prev
        ? { ...l, claimedQuantity: prev.claimedQuantity, unitPrice: prev.unitPrice, selected: prev.selected }
        : { ...l, claimedQuantity: 0, unitPrice: rate, selected: false };
    });
  }, [boqItems, scopeFor]);

  const defaultClaimType = (contractorId) => {
    const { types } = scopeFor(contractorId);
    return types.includes('Slab') ? 'Slab' : 'BOQ';
  };

  const handleContractorChange = (contractorId) => {
    setForm((f) => ({
      ...f,
      contractor: contractorId,
      claimType: defaultClaimType(contractorId),
      subletContract: '',
      slabId: '',
      lines: buildLines(contractorId, f.lines)
    }));
  };

  const openCreate = () => {
    setEditing(null);
    const onlyContractor = contractorOptions.length === 1 ? String(contractorOptions[0]._id) : '';
    setForm({
      ...emptyForm,
      title: `Check Request — ${project?.name || ''}`.trim(),
      contractor: onlyContractor,
      claimType: onlyContractor ? defaultClaimType(onlyContractor) : 'BOQ',
      lines: buildLines(onlyContractor)
    });
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    const selectedIds = new Set((row.items || []).map((i) => String(i.boqItem?._id || i.boqItem)));
    const claimedMap = new Map(
      (row.items || []).map((i) => [
        String(i.boqItem?._id || i.boqItem),
        { qty: i.claimedQuantity, price: i.unitPrice }
      ])
    );
    const contractorId = String(row.contractor?._id || row.contractor || '');
    const claimedLines = (row.items || []).map((i) => {
      const id = String(i.boqItem?._id || i.boqItem);
      const hit = claimedMap.get(id);
      return { boqItemId: id, claimedQuantity: hit.qty, unitPrice: hit.price, selected: selectedIds.has(id) };
    });
    const lines = buildLines(contractorId, claimedLines);
    // Lines already claimed stay visible even if they've since left the contract
    const shown = new Set(lines.map((l) => String(l.boqItemId)));
    (row.items || []).forEach((i) => {
      const id = String(i.boqItem?._id || i.boqItem);
      if (shown.has(id)) return;
      lines.push({
        boqItemId: id,
        label: i.title || i.description,
        unit: i.unit,
        claimedQuantity: i.claimedQuantity,
        unitPrice: i.unitPrice,
        selected: true
      });
    });
    setForm({
      title: row.title || '',
      contractor: contractorId,
      claimType: row.claimType === 'Slab' ? 'Slab' : 'BOQ',
      subletContract: String(row.subletContract?._id || row.subletContract || ''),
      slabId: String(row.slab?.slabId || ''),
      activity: row.activity?._id || row.activity || '',
      task: row.task?._id || row.task || '',
      notes: row.notes || '',
      lines
    });
    setDialogOpen(true);
  };

  const claimedTotal = form.lines
    .filter((l) => l.selected && Number(l.claimedQuantity) > 0)
    .reduce((s, l) => s + Number(l.claimedQuantity) * Number(l.unitPrice), 0);

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!form.contractor) {
      setError('Select the subcontractor this check request is for');
      return;
    }
    if (form.claimType === 'Slab') {
      if (!selectedSlab) {
        setError('Select the slab (stage) being claimed');
        return;
      }
      try {
        setSaving(true);
        setError('');
        const payload = {
          title: form.title.trim(),
          contractor: form.contractor,
          claimType: 'Slab',
          subletContract: selectedSlab.contract._id,
          slabId: selectedSlab.slab._id,
          notes: form.notes
        };
        if (editing) {
          await updateCheckRequest(projectId, editing._id, payload);
          setSuccess('Check Request updated');
        } else {
          await createCheckRequest(projectId, payload);
          setSuccess('Check Request created');
        }
        setDialogOpen(false);
        await load();
      } catch (err) {
        setError(err.response?.data?.message || 'Save failed');
      } finally {
        setSaving(false);
      }
      return;
    }
    if (activityOptions.length && !form.activity) {
      setError('Select the WBS activity this check request is for');
      return;
    }
    const items = form.lines
      .filter((l) => l.selected && Number(l.claimedQuantity) > 0)
      .map((l) => ({
        boqItemId: l.boqItemId,
        claimedQuantity: Number(l.claimedQuantity),
        unitPrice: Number(l.unitPrice) || 0
      }));
    if (!items.length) {
      setError('Select at least one BOQ line with claimed quantity');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = {
        title: form.title.trim(),
        contractor: form.contractor || null,
        claimType: 'BOQ',
        activity: form.activity || null,
        task: form.task || null,
        notes: form.notes,
        items
      };
      if (editing) {
        await updateCheckRequest(projectId, editing._id, payload);
        setSuccess('Check Request updated');
      } else {
        await createCheckRequest(projectId, payload);
        setSuccess('Check Request created');
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (row) => {
    try {
      await submitCheckRequest(projectId, row._id);
      setSuccess('Submitted for physical verification');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Submit failed');
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setError('Rejection reason is required');
      return;
    }
    try {
      setSaving(true);
      await rejectCheckRequest(projectId, rejectRow._id, { rejectionReason: rejectReason.trim() });
      setSuccess('Check Request rejected');
      setRejectOpen(false);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Reject failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (row) => {
    if (!window.confirm(`Cancel ${row.checkRequestNumber}?`)) return;
    try {
      await cancelCheckRequest(projectId, row._id);
      setSuccess('Check Request cancelled');
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
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Check Requests
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Claim work → submit → inspection report signed by every inspector → verified → IPC
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              {['Draft', 'Submitted', 'Verified', 'Rejected', 'Billed', 'Cancelled'].map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <IconButton onClick={load}>
            <RefreshIcon />
          </IconButton>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New Check Request
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" useFlexGap>
        {[
          ['Draft', counts.draft],
          ['Submitted', counts.submitted],
          ['Verified', counts.verified],
          ['Rejected', counts.rejected],
          ['Billed', counts.billed]
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

      {activeContracts === 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={onGoToTab && (
            <Button color="inherit" size="small" onClick={() => onGoToTab('sublet-contracts')}>Go to Sublet Contracts</Button>
          )}
        >
          No active Sublet Contract on this Sub Project yet. Award and activate a contract first, so work is
          claimed against an agreed subcontractor and rate.
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 2 }}>
        Raise a Check Request for a WBS activity. Commercial payment must go through a
        Verified Check Request before a Subcontractor IPC can be raised.
      </Alert>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Number</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Contractor</TableCell>
              <TableCell align="right">Claimed</TableCell>
              <TableCell align="right">Verified</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Box py={3}>
                    <Typography color="text.secondary">No check requests yet</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Raise one when a subcontractor finishes work, so it can be physically verified and billed as an IPC.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row._id} hover>
                  <TableCell>{row.checkRequestNumber}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.title}
                    </Typography>
                    {row.claimType === 'Slab' && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        Slab wise: {row.slab?.name} ({row.slab?.percentage}%)
                      </Typography>
                    )}
                    {(row.activity?.name || row.task?.title) && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        WBS: {row.activity
                          ? `${row.activity.group} › ${row.activity.name}`
                          : row.task.title}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{row.contractor?.name || '—'}</TableCell>
                  <TableCell align="right">{fmt(row.claimedTotal)}</TableCell>
                  <TableCell align="right">{fmt(row.verifiedTotal)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={row.status} color={STATUS_COLOR[row.status] || 'default'} />
                    {latestReportFor(row) && (() => {
                      const r = latestReportFor(row);
                      const signed = r.inspectors.filter((i) => i.status === 'Approved').length;
                      return (
                        <Typography
                          variant="caption"
                          display="block"
                          color={r.status === 'Rejected' ? 'error.main' : 'text.secondary'}
                          sx={{ mt: 0.5, cursor: 'pointer', textDecoration: 'underline dotted' }}
                          onClick={() => setInspection({ report: r })}
                        >
                          {r.reportNumber} · {r.status === 'Pending' ? `${signed}/${r.inspectors.length} signed` : r.status}
                        </Typography>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {row.createdAt ? dayjs(row.createdAt).format('DD MMM YYYY') : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="View">
                      <IconButton size="small" onClick={() => setViewRow(row)}>
                        <ViewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Print">
                      <IconButton size="small" onClick={() => printRow(row)}>
                        <PrintIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {['Draft', 'Rejected'].includes(row.status) && (
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(row)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {['Draft', 'Rejected'].includes(row.status) && (
                      <Tooltip title="Submit">
                        <IconButton size="small" color="warning" onClick={() => handleSubmit(row)}>
                          <SubmitIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {row.status === 'Submitted' && (
                      <>
                        <Tooltip title={openReportFor(row) ? 'Open inspection report' : 'Create inspection report'}>
                          <IconButton size="small" color="success" onClick={() => openInspectionFor(row)}>
                            <InspectionIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {!openReportFor(row) && (
                        <Tooltip title="Reject">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              setRejectRow(row);
                              setRejectOpen(true);
                            }}
                          >
                            <CancelIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        )}
                      </>
                    )}
                    {!['Billed', 'Cancelled'].includes(row.status) && (
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

      {/* Create / Edit */}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <span>{editing ? `Edit Check Request ${editing.checkRequestNumber || ''}` : 'New Check Request'}</span>
            <Stack direction="row" gap={0.75} flexWrap="wrap">
              {formContracts.map((c) => (
                <Chip
                  key={c._id}
                  color={c.contractType === 'Slab' ? 'secondary' : 'primary'}
                  label={contractChipLabel(c)}
                  sx={{ fontWeight: 700 }}
                />
              ))}
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {contextBar}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
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
              <FormControl fullWidth required>
                <InputLabel>Subcontractor</InputLabel>
                <Select
                  label="Subcontractor"
                  value={form.contractor}
                  onChange={(e) => handleContractorChange(e.target.value)}
                >
                  {!contractorOptions.length && (
                    <MenuItem value="" disabled>No subcontractor has an active contract on this Sub Project</MenuItem>
                  )}
                  {contractorOptions.map((c) => (
                    <MenuItem key={c._id} value={String(c._id)}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ width: '100%' }}>
                        <span>{c.name}</span>
                        {typesFor(c._id) && (
                          <Typography variant="caption" color="text.secondary">{typesFor(c._id)}</Typography>
                        )}
                      </Stack>
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>Only subcontractors with an active Sublet Contract here</FormHelperText>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              {form.claimType === 'Slab' ? (
                <FormControl fullWidth required disabled={!form.contractor}>
                  <InputLabel>Slab (stage)</InputLabel>
                  <Select
                    label="Slab (stage)"
                    value={selectedSlab ? String(form.slabId) : ''}
                    onChange={(e) => {
                      const hit = scope.slabOptions.find((o) => String(o.slab._id) === String(e.target.value));
                      setForm((f) => ({ ...f, slabId: e.target.value, subletContract: hit ? String(hit.contract._id) : '' }));
                    }}
                  >
                    {!scope.slabOptions.length && <MenuItem value="" disabled>No slabs on this subcontractor's contract</MenuItem>}
                    {scope.slabOptions.map((o) => {
                      const takenBy = claimedSlabs.get(String(o.slab._id));
                      return (
                        <MenuItem key={o.slab._id} value={String(o.slab._id)} disabled={Boolean(takenBy)}>
                          <Stack direction="row" justifyContent="space-between" gap={1} sx={{ width: '100%' }}>
                            <span>{o.slab.name} — {o.slab.percentage}%</span>
                            <Typography variant="caption" color="text.secondary">
                              {takenBy ? `Claimed in ${takenBy}` : fmt(slabAmount(o))}
                            </Typography>
                          </Stack>
                        </MenuItem>
                      );
                    })}
                  </Select>
                  <FormHelperText>{form.contractor ? 'Each stage is claimed once, for its full amount' : 'Select a subcontractor first'}</FormHelperText>
                </FormControl>
              ) : (
                <Autocomplete
                  options={activityOptions}
                  groupBy={(a) => a.group}
                  getOptionLabel={(a) => (a?.code ? `${a.code} — ${a.name}` : a?.name || '')}
                  isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
                  value={activityOptions.find((a) => String(a._id) === String(form.activity)) || null}
                  onChange={(_, v) => setForm((f) => ({ ...f, activity: v?._id || '' }))}
                  disabled={!form.contractor}
                  noOptionsText={!wbsType
                    ? 'Set this Sub Project\'s Project Type to see WBS activities'
                    : `No WBS activities for ${wbsProjectTypeLabel(wbsType)} yet — add them in WBS Activities`}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      required={activityOptions.length > 0}
                      label={`WBS Activity${wbsType ? ` (${wbsProjectTypeLabel(wbsType)})` : ''}`}
                      helperText={form.contractor ? '' : 'Select a subcontractor first'}
                    />
                  )}
                />
              )}
            </Grid>
            {form.contractor && scope.types.length > 1 && (
              <Grid item xs={12}>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  color="primary"
                  value={form.claimType}
                  onChange={(_, v) => v && setForm((f) => ({ ...f, claimType: v, slabId: '', subletContract: '' }))}
                >
                  <ToggleButton value="Slab" sx={{ textTransform: 'none' }}>Claim a slab (slab-wise contract)</ToggleButton>
                  <ToggleButton value="BOQ" sx={{ textTransform: 'none' }}>Claim BOQ quantities (BOQ-wise contract)</ToggleButton>
                </ToggleButtonGroup>
              </Grid>
            )}
            {form.claimType === 'Slab' && selectedSlab && (
              <Grid item xs={12}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={1}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      {selectedSlab.slab.name} · {selectedSlab.slab.percentage}% of {selectedSlab.contract.contractNumber}
                    </Typography>
                    <Typography variant="subtitle1" fontWeight={700} color="primary.main">
                      {fmt(slabAmount(selectedSlab))}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75, mb: 0.5 }}>
                    Work covered by this stage
                  </Typography>
                  <Stack direction="row" gap={0.75} flexWrap="wrap">
                    {(selectedSlab.slab.activities || []).length
                      ? selectedSlab.slab.activities.map((a, idx) => (
                        <Chip key={idx} size="small" variant="outlined" label={a.group ? `${a.group} › ${a.name}` : a.name} />
                      ))
                      : <Typography variant="body2" color="text.secondary">No WBS activities linked to this slab</Typography>}
                  </Stack>
                </Paper>
              </Grid>
            )}
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
            {form.claimType !== 'Slab' && (
            <Grid item xs={12}>
              <Typography variant="subtitle2" fontWeight={700} mb={1}>
                BOQ lines to claim
              </Typography>
              {!form.contractor ? (
                <Alert severity="info">Select a subcontractor to see the BOQ lines they can claim.</Alert>
              ) : form.lines.length === 0 && boqItems.length > 0 ? (
                <Alert severity="warning">This subcontractor's contract has no BOQ lines on this Sub Project.</Alert>
              ) : boqItems.length === 0 && form.lines.length === 0 ? (
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
                      <TableCell align="right">Claimed Qty</TableCell>
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
                                lines[idx] = { ...lines[idx], selected };
                                return { ...f, lines };
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>{line.label}</TableCell>
                        <TableCell>{line.unit}</TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            type="number"
                            disabled={!line.selected}
                            value={line.claimedQuantity}
                            onChange={(e) => {
                              const claimedQuantity = e.target.value;
                              setForm((f) => {
                                const lines = [...f.lines];
                                lines[idx] = { ...lines[idx], claimedQuantity };
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
                            ? fmt(Number(line.claimedQuantity) * Number(line.unitPrice))
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Typography variant="subtitle2" mt={1.5} fontWeight={700}>
                Claimed total: {fmt(claimedTotal)}
              </Typography>
            </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button startIcon={<PrintIcon />} onClick={printForm} disabled={!form.contractor} sx={{ mr: 'auto' }}>
            Print
          </Button>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>


      {/* Reject */}
      <Dialog open={rejectOpen} onClose={() => !saving && setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reject Check Request</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            required
            multiline
            minRows={3}
            label="Rejection reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleReject} disabled={saving}>
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      {/* View */}
      <InspectionReportDialog
        open={Boolean(inspection)}
        onClose={() => setInspection(null)}
        projectId={projectId}
        checkRequest={inspection?.checkRequest}
        report={inspection?.report}
        context={inspectionContext(inspection?.checkRequest
          || rows.find((r) => String(r._id) === String(inspection?.report?.checkRequest?._id)))}
        onChanged={async (message) => {
          setInspection(null);
          setViewRow(null);
          if (message) setSuccess(message);
          await load();
        }}
      />

      <Dialog open={Boolean(viewRow)} onClose={() => setViewRow(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <Stack direction="row" alignItems="center" gap={1}>
              <span>Check Request {viewRow?.checkRequestNumber}</span>
              {viewRow && <Chip size="small" label={viewRow.status} color={STATUS_COLOR[viewRow.status] || 'default'} />}
            </Stack>
            <Stack direction="row" gap={0.75} flexWrap="wrap">
              {viewRow && contractsForRow(viewRow).map((c) => (
                <Chip
                  key={c._id || c.contractNumber}
                  color={c.contractType === 'Slab' ? 'secondary' : 'primary'}
                  label={contractChipLabel(c)}
                  sx={{ fontWeight: 700 }}
                />
              ))}
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {viewRow && (() => {
            const isSlab = viewRow.claimType === 'Slab';
            const verifiedStage = ['Verified', 'Billed'].includes(viewRow.status);
            const field = (label, value, sm = 4) => (
              <Grid item xs={12} sm={sm} key={label}>
                <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
                <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>{value || '—'}</Typography>
              </Grid>
            );
            const when = (d, who) => (d ? `${dayjs(d).format('DD MMM YYYY, hh:mm A')}${who ? ` · ${who}` : ''}` : '');
            return (
              <Stack spacing={2}>
                {contextBar}

                <Grid container spacing={1.5}>
                  {field('Title', viewRow.title, 12)}
                  {field('Subcontractor', viewRow.contractor?.name)}
                  {field('Claim basis', isSlab ? 'Slab wise (stage payment)' : 'BOQ wise (quantities)')}
                  {field(isSlab ? 'Slab (stage)' : 'WBS Activity', isSlab
                    ? `${viewRow.slab?.name || '—'} · ${viewRow.slab?.percentage ?? 0}%`
                    : activityText(viewRow.activity) || viewRow.task?.title)}
                  {field('Created', when(viewRow.createdAt, personText(viewRow.createdBy)))}
                  {field('Submitted', when(viewRow.submittedAt, personText(viewRow.submittedBy)))}
                  {field('Verified', when(viewRow.verifiedAt, viewRow.verifiedBy))}
                  {viewRow.linkedInvoice && field(
                    'Billed in IPC',
                    `${viewRow.linkedInvoice.invoiceNumber || `IPC #${viewRow.linkedInvoice.ipcNumber}`} · ${viewRow.linkedInvoice.status} · ${fmt(viewRow.linkedInvoice.invoiceAmount)}`,
                    12
                  )}
                </Grid>

                {isSlab ? (
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={1}>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {viewRow.slab?.name} · {viewRow.slab?.percentage}%
                        {viewRow.subletContract?.contractNumber ? ` of ${viewRow.subletContract.contractNumber}` : ''}
                      </Typography>
                      <Typography variant="subtitle1" fontWeight={700} color="primary.main">{fmt(viewRow.slab?.amount)}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75, mb: 0.5 }}>
                      Work covered by this stage
                    </Typography>
                    <Stack direction="row" gap={0.75} flexWrap="wrap">
                      {(viewRow.slab?.activities || []).length
                        ? viewRow.slab.activities.map((a, idx) => <Chip key={idx} size="small" variant="outlined" label={a.name} />)
                        : <Typography variant="body2" color="text.secondary">No WBS activities linked to this slab</Typography>}
                    </Stack>
                  </Paper>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>#</TableCell>
                          <TableCell>Item</TableCell>
                          <TableCell align="right">Claimed</TableCell>
                          <TableCell align="right">Verified</TableCell>
                          <TableCell align="right">Billed</TableCell>
                          <TableCell align="right">Rate</TableCell>
                          <TableCell align="right">Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(viewRow.items || []).map((i, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{idx + 1}</TableCell>
                            <TableCell>{i.title || i.description}</TableCell>
                            <TableCell align="right">{i.claimedQuantity} {i.unit}</TableCell>
                            <TableCell align="right">{verifiedStage ? `${i.verifiedQuantity} ${i.unit}` : '—'}</TableCell>
                            <TableCell align="right">{i.billedQuantity || 0} {i.unit}</TableCell>
                            <TableCell align="right">{fmt(i.unitPrice)}</TableCell>
                            <TableCell align="right">{fmt((Number(i.claimedQuantity) || 0) * (Number(i.unitPrice) || 0))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}

                <Stack direction="row" justifyContent="flex-end" gap={3}>
                  <Typography variant="body2">Claimed: <strong>{fmt(viewRow.claimedTotal)}</strong></Typography>
                  <Typography variant="body2">Verified: <strong>{verifiedStage ? fmt(viewRow.verifiedTotal) : '—'}</strong></Typography>
                </Stack>

                {(viewRow.verificationNotes || viewRow.verificationPhotoUrl) && (
                  <Alert severity="success" icon={false}>
                    <Typography variant="subtitle2">Verification</Typography>
                    {viewRow.verificationNotes && <Typography variant="body2">{viewRow.verificationNotes}</Typography>}
                    {viewRow.verificationPhotoUrl && (
                      <Typography variant="body2">
                        Proof: <a href={viewRow.verificationPhotoUrl} target="_blank" rel="noreferrer">{viewRow.verificationPhotoUrl}</a>
                      </Typography>
                    )}
                  </Alert>
                )}
                {viewRow.rejectionReason && (
                  <Alert severity="error">
                    <Typography variant="subtitle2">Rejected</Typography>
                    {viewRow.rejectionReason}
                  </Alert>
                )}

                {reportsFor(viewRow).length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>Inspection reports</Typography>
                    <Stack spacing={0.75}>
                      {reportsFor(viewRow).map((r) => (
                        <Paper key={r._id} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                            <Stack direction="row" alignItems="center" gap={1}>
                              <Typography variant="body2" fontWeight={700}>{r.reportNumber}</Typography>
                              <Chip size="small" label={r.status}
                                color={{ Pending: 'warning', Approved: 'success', Rejected: 'error' }[r.status] || 'default'} />
                              <Typography variant="caption" color="text.secondary">
                                {r.inspectors.filter((i) => i.status === 'Approved').length}/{r.inspectors.length} signed ·{' '}
                                {dayjs(r.inspectionDate).format('DD MMM YYYY')}
                              </Typography>
                            </Stack>
                            <Button size="small" onClick={() => setInspection({ report: r })}>Open</Button>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                )}

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">Notes</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{viewRow.notes || '—'}</Typography>
                </Box>
              </Stack>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button startIcon={<PrintIcon />} onClick={() => printRow(viewRow)} sx={{ mr: 'auto' }}>Print</Button>
          <Button onClick={() => setViewRow(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CheckRequestsTab;
