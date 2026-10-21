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
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as ActivateIcon,
  Delete as DeleteIcon,
  DoneAll as CompleteIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import {
  activateSubletContract,
  cancelSubletContract,
  completeSubletContract,
  createSubletContract,
  getBOQ,
  getSubletContracts,
  getSuppliers,
  updateSubletContract
} from '../../services/projectManagementService';

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

const emptyForm = {
  title: '',
  contractor: '',
  notes: '',
  startDate: dayjs().format('YYYY-MM-DD'),
  endDate: '',
  lines: []
};

const SubletContractsTab = ({ projectId, project }) => {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [boqItems, setBoqItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [viewRow, setViewRow] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [scRes, boqRes, suppRes] = await Promise.all([
        getSubletContracts(projectId, statusFilter ? { status: statusFilter } : {}),
        getBOQ(projectId, { limit: 500 }),
        getSuppliers().catch(() => ({ data: { data: [] } }))
      ]);
      setRows(scRes.data?.data?.contracts || []);
      setCounts(scRes.data?.data?.counts || {});
      setBoqItems(boqRes.data?.data?.items || []);
      const suppList = suppRes.data?.data?.suppliers || suppRes.data?.data || [];
      setSuppliers(Array.isArray(suppList) ? suppList : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load sublet contracts');
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter]);

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
    setForm({
      ...emptyForm,
      title: `Sublet — ${project?.name || ''}`.trim(),
      lines: buildLinesFromBoq()
    });
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
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
      lines: buildLinesFromBoq(selectedMap)
    });
    setDialogOpen(true);
  };

  const totalAmount = form.lines
    .filter((l) => l.selected && Number(l.quantity) > 0)
    .reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);

  const handleSave = async (activateAfter = false) => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!form.contractor) {
      setError('Subcontractor is required');
      return;
    }
    const items = form.lines
      .filter((l) => l.selected && Number(l.quantity) > 0)
      .map((l) => ({
        boqItemId: l.boqItemId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice) || 0
      }));
    if (!items.length) {
      setError('Select at least one BOQ line with quantity to sublet');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = {
        title: form.title.trim(),
        contractor: form.contractor,
        notes: form.notes,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        items,
        activate: activateAfter && !editing
      };

      if (editing) {
        await updateSubletContract(projectId, editing._id, payload);
        if (activateAfter) {
          await activateSubletContract(projectId, editing._id);
          setSuccess('Sublet contract updated and activated');
        } else {
          setSuccess('Sublet contract updated');
        }
      } else {
        await createSubletContract(projectId, payload);
        setSuccess(activateAfter ? 'Sublet contract created and activated' : 'Sublet contract created');
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (row) => {
    try {
      await activateSubletContract(projectId, row._id);
      setSuccess('Activated — BOQ lines assigned to subcontractor');
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
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Sublet Contracts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sublet BOQ line items to subcontractors with qty and rate
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
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New Sublet Contract
          </Button>
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
        Create a draft, select BOQ lines + quantities, then <strong>Activate</strong> to assign those
        lines to the subcontractor on the BOQ. Check Requests / IPC can then use that contractor.
      </Alert>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
              <TableHead>
            <TableRow>
              <TableCell>Number</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Main / Sub</TableCell>
              <TableCell>Sector / Block</TableCell>
              <TableCell>Subcontractor</TableCell>
              <TableCell align="right">Lines</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Period</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center">
                  <Typography color="text.secondary" py={3}>
                    No sublet contracts yet
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row._id} hover>
                  <TableCell>{row.contractNumber}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.title}
                    </Typography>
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
                  <TableCell align="right">{row.items?.length || 0}</TableCell>
                  <TableCell align="right">{fmt(row.totalAmount)}</TableCell>
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

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit Sublet Contract' : 'New Sublet Contract'}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
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
            <Grid item xs={12}>
              <Typography variant="subtitle2" fontWeight={700} mb={1}>
                BOQ lines to sublet
              </Typography>
              {boqItems.length === 0 ? (
                <Alert severity="warning">No BOQ items on this Sub Project yet.</Alert>
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

      <Dialog open={Boolean(viewRow)} onClose={() => setViewRow(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {viewRow?.contractNumber} — {viewRow?.title}
        </DialogTitle>
        <DialogContent dividers>
          {viewRow && (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={viewRow.status} color={STATUS_COLOR[viewRow.status]} />
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
              <Typography variant="body2" color="text.secondary">
                {viewRow.notes || 'No notes'}
              </Typography>
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
