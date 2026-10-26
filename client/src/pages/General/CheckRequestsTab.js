import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Cancel as CancelIcon,
  CheckCircle as VerifyIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
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
  getSuppliers,
  getWbsActivities,
  rejectCheckRequest,
  submitCheckRequest,
  updateCheckRequest,
  verifyCheckRequest
} from '../../services/projectManagementService';
import { normalizeWbsProjectType, wbsProjectTypeLabel } from '../../utils/wbsProjectTypes';

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
  activity: '',
  task: '',
  notes: '',
  lines: []
};

const CheckRequestsTab = ({ projectId, project }) => {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [boqItems, setBoqItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
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
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyRow, setVerifyRow] = useState(null);
  const [verifyForm, setVerifyForm] = useState({
    verifiedBy: '',
    verificationNotes: '',
    verificationPhotoUrl: '',
    items: []
  });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectRow, setRejectRow] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [crRes, boqRes, suppRes, actRes] = await Promise.all([
        getCheckRequests(projectId, statusFilter ? { status: statusFilter } : {}),
        getBOQ(projectId, { limit: 500 }),
        getSuppliers().catch(() => ({ data: { data: [] } })),
        wbsType
          ? getWbsActivities({ projectType: wbsType }).catch(() => ({ data: { data: {} } }))
          : { data: { data: {} } }
      ]);
      setRows(crRes.data?.data?.checkRequests || []);
      setCounts(crRes.data?.data?.counts || {});
      setBoqItems(boqRes.data?.data?.items || []);
      const suppList = suppRes.data?.data?.suppliers || suppRes.data?.data || [];
      setSuppliers(Array.isArray(suppList) ? suppList : []);
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

  // Keep the activity on an edited request selectable even if it was later deactivated in the master
  const activityOptions = useMemo(() => {
    const current = editing?.activity;
    if (current?._id && !activities.some((a) => String(a._id) === String(current._id))) {
      return [...activities, current];
    }
    return activities;
  }, [activities, editing]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      title: `Check Request — ${project?.name || ''}`.trim(),
      lines: boqItems.map((b) => ({
        boqItemId: b._id,
        label: b.title || b.description,
        unit: b.unit,
        claimedQuantity: 0,
        unitPrice: b.contractorUnitPrice || b.estimatedUnitPrice || 0,
        selected: false
      }))
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
    setForm({
      title: row.title || '',
      contractor: row.contractor?._id || row.contractor || '',
      activity: row.activity?._id || row.activity || '',
      task: row.task?._id || row.task || '',
      notes: row.notes || '',
      lines: boqItems.map((b) => {
        const hit = claimedMap.get(String(b._id));
        return {
          boqItemId: b._id,
          label: b.title || b.description,
          unit: b.unit,
          claimedQuantity: hit ? hit.qty : 0,
          unitPrice: hit ? hit.price : b.contractorUnitPrice || b.estimatedUnitPrice || 0,
          selected: selectedIds.has(String(b._id)) || Boolean(hit)
        };
      })
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
    if (activities.length && !form.activity) {
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

  const openVerify = (row) => {
    setVerifyRow(row);
    setVerifyForm({
      verifiedBy: '',
      verificationNotes: '',
      verificationPhotoUrl: '',
      items: (row.items || []).map((i) => ({
        boqItemId: i.boqItem?._id || i.boqItem,
        label: i.title || i.description,
        unit: i.unit,
        claimedQuantity: i.claimedQuantity,
        verifiedQuantity: i.claimedQuantity,
        unitPrice: i.unitPrice
      }))
    });
    setVerifyOpen(true);
  };

  const handleVerify = async () => {
    if (!verifyForm.verifiedBy.trim()) {
      setError('Auditor / Verified by is required');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await verifyCheckRequest(projectId, verifyRow._id, {
        verifiedBy: verifyForm.verifiedBy.trim(),
        verificationNotes: verifyForm.verificationNotes,
        verificationPhotoUrl: verifyForm.verificationPhotoUrl,
        items: verifyForm.items.map((i) => ({
          boqItemId: i.boqItemId,
          verifiedQuantity: Number(i.verifiedQuantity) || 0
        }))
      });
      setSuccess('Check Request verified — ready for IPC / expense');
      setVerifyOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Verification failed');
    } finally {
      setSaving(false);
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
            Claim work against BOQ → physical verify → then create IPC / expense
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

      <Alert severity="info" sx={{ mb: 2 }}>
        Raise a Check Request for a WBS activity. Commercial payment must go through a
        Verified Check Request before Subcontractor IPC or linked expense.
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
                  <Typography color="text.secondary" py={3}>
                    No check requests yet
                  </Typography>
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
                        <Tooltip title="Verify">
                          <IconButton size="small" color="success" onClick={() => openVerify(row)}>
                            <VerifyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
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
        <DialogTitle>{editing ? 'Edit Check Request' : 'New Check Request'}</DialogTitle>
        <DialogContent dividers>
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
              <FormControl fullWidth>
                <InputLabel>Contractor</InputLabel>
                <Select
                  label="Contractor"
                  value={form.contractor}
                  onChange={(e) => setForm((f) => ({ ...f, contractor: e.target.value }))}
                >
                  <MenuItem value="">None</MenuItem>
                  {suppliers.map((s) => (
                    <MenuItem key={s._id} value={s._id}>
                      {s.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={activityOptions}
                groupBy={(a) => a.group}
                getOptionLabel={(a) => (a?.code ? `${a.code} — ${a.name}` : a?.name || '')}
                isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
                value={activityOptions.find((a) => String(a._id) === String(form.activity)) || null}
                onChange={(_, v) => setForm((f) => ({ ...f, activity: v?._id || '' }))}
                noOptionsText={wbsType
                  ? `No WBS activities for ${wbsProjectTypeLabel(wbsType)} yet — add them in WBS Activities`
                  : 'Set this Sub Project\'s Project Type to see WBS activities'}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    required={activityOptions.length > 0}
                    label={`WBS Activity${wbsType ? ` (${wbsProjectTypeLabel(wbsType)})` : ''}`}
                  />
                )}
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
                BOQ lines to claim
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
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Verify */}
      <Dialog open={verifyOpen} onClose={() => !saving && setVerifyOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Physical Verification — Check Request</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            Confirm executed quantities for <strong>{verifyRow?.checkRequestNumber}</strong>. After
            verify, IPC / expenses can be raised against this request.
          </Alert>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                label="Verified By (Auditor)"
                value={verifyForm.verifiedBy}
                onChange={(e) => setVerifyForm((f) => ({ ...f, verifiedBy: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Proof image URL (optional)"
                value={verifyForm.verificationPhotoUrl}
                onChange={(e) =>
                  setVerifyForm((f) => ({ ...f, verificationPhotoUrl: e.target.value }))
                }
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Verification notes"
                value={verifyForm.verificationNotes}
                onChange={(e) =>
                  setVerifyForm((f) => ({ ...f, verificationNotes: e.target.value }))
                }
              />
            </Grid>
            <Grid item xs={12}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Claimed</TableCell>
                    <TableCell align="right">Verified Qty</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {verifyForm.items.map((item, idx) => (
                    <TableRow key={item.boqItemId}>
                      <TableCell>
                        {item.label} ({item.unit})
                      </TableCell>
                      <TableCell align="right">{item.claimedQuantity}</TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          type="number"
                          value={item.verifiedQuantity}
                          onChange={(e) => {
                            const verifiedQuantity = e.target.value;
                            setVerifyForm((f) => {
                              const items = [...f.items];
                              items[idx] = { ...items[idx], verifiedQuantity };
                              return { ...f, items };
                            });
                          }}
                          inputProps={{ min: 0, max: item.claimedQuantity, step: 'any' }}
                          sx={{ width: 110 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {fmt(Number(item.verifiedQuantity) * Number(item.unitPrice))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVerifyOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" color="success" onClick={handleVerify} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm Verified'}
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
      <Dialog open={Boolean(viewRow)} onClose={() => setViewRow(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {viewRow?.checkRequestNumber} — {viewRow?.title}
        </DialogTitle>
        <DialogContent dividers>
          {viewRow && (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1}>
                <Chip size="small" label={viewRow.status} color={STATUS_COLOR[viewRow.status]} />
                <Typography variant="body2">
                  Contractor: {viewRow.contractor?.name || '—'}
                </Typography>
              </Stack>
              {viewRow.verifiedBy && (
                <Typography variant="body2">
                  Verified by {viewRow.verifiedBy}
                  {viewRow.verifiedAt
                    ? ` on ${dayjs(viewRow.verifiedAt).format('DD MMM YYYY')}`
                    : ''}
                </Typography>
              )}
              {viewRow.verificationNotes && (
                <Typography variant="body2" color="text.secondary">
                  {viewRow.verificationNotes}
                </Typography>
              )}
              {viewRow.rejectionReason && (
                <Alert severity="error">{viewRow.rejectionReason}</Alert>
              )}
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Claimed</TableCell>
                    <TableCell align="right">Verified</TableCell>
                    <TableCell align="right">Billed</TableCell>
                    <TableCell align="right">Rate</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(viewRow.items || []).map((i, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{i.title || i.description}</TableCell>
                      <TableCell align="right">
                        {i.claimedQuantity} {i.unit}
                      </TableCell>
                      <TableCell align="right">
                        {i.verifiedQuantity} {i.unit}
                      </TableCell>
                      <TableCell align="right">
                        {i.billedQuantity || 0} {i.unit}
                      </TableCell>
                      <TableCell align="right">{fmt(i.unitPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography variant="subtitle2">
                Claimed {fmt(viewRow.claimedTotal)} · Verified {fmt(viewRow.verifiedTotal)}
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

export default CheckRequestsTab;
