import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid,
  Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import dayjs from 'dayjs';
import { cancelSubletContract, getSubletCancelPreview } from '../../services/projectManagementService';
import { fmt } from './mainProjectUi';

/** One figure in the settlement summary */
const Figure = ({ label, value, hint, color }) => (
  <Grid item xs={6} sm={3}>
    <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
    <Typography variant="body2" fontWeight={700} color={color}>{fmt(value)}</Typography>
    {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
  </Grid>
);

/** Work done on a contract — per BOQ line or per slab (shared by the cancel dialog and the contract view) */
export const WorkDoneTable = ({ workDone, unitsWord = 'Villas' }) => {
  if (workDone?.lines?.length) {
    return (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>BOQ line</TableCell>
            <TableCell align="right">Contracted</TableCell>
            <TableCell align="right">Done</TableCell>
            <TableCell align="right">Left</TableCell>
            <TableCell align="right">Rate</TableCell>
            <TableCell align="right">Work done</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {workDone.lines.map((l) => (
            <TableRow key={String(l.boqItem)}>
              <TableCell>{l.title}</TableCell>
              <TableCell align="right">{l.contractedQuantity} {l.unit}</TableCell>
              <TableCell align="right">{l.quantity} {l.unit}</TableCell>
              <TableCell align="right">{Math.max(0, (l.contractedQuantity || 0) - (l.quantity || 0))} {l.unit}</TableCell>
              <TableCell align="right">{fmt(l.unitPrice)}</TableCell>
              <TableCell align="right">{fmt(l.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  if (workDone?.slabs?.length) {
    return (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Slab / Stage</TableCell>
            <TableCell align="right">%</TableCell>
            <TableCell>{unitsWord}</TableCell>
            <TableCell align="right">Work done</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {workDone.slabs.map((s) => (
            <TableRow key={String(s.slabId)}>
              <TableCell>{s.name}</TableCell>
              <TableCell align="right">{s.percentage}%</TableCell>
              <TableCell>{s.units?.length ? s.units.map((u) => u.name).join(', ') : 'All'}</TableCell>
              <TableCell align="right">{fmt(s.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  return <Typography variant="body2" color="text.secondary">No verified work on this contract.</Typography>;
};

/** Money position of a contract when it is (or would be) cancelled */
export const SettlementFigures = ({ money }) => (
  <Grid container spacing={1.5}>
    <Figure label="Work done (verified)" value={money.verified} />
    <Figure label="Billed (IPCs)" value={money.billed} hint={money.unbilled > 0 ? `${fmt(money.unbilled)} still to bill` : null} />
    <Figure label="Paid" value={money.paid} />
    <Figure label="Approved, not yet paid" value={money.payable} color={money.payable > 0 ? 'warning.main' : undefined} />
    <Figure label="Retention held" value={money.retentionHeld} hint={money.retentionHeld > 0 ? 'Release later with a Retention Release IPC' : null} />
    <Figure label="Advance not recovered" value={money.advanceOutstanding} color={money.advanceOutstanding > 0 ? 'error.main' : undefined}
      hint={money.advanceOutstanding > 0 ? 'Owed by the contractor — recover from their bills' : null} />
  </Grid>
);

/**
 * Cancel a sublet contract. A Draft is simply cancelled. An Active one shows what has been done and paid,
 * what is freed for a new contract, and needs a reason; claims or bills still in progress block it.
 */
const CancelSubletContractDialog = ({ open, projectId, contract, unitsWord, onClose, onCancelled }) => {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));

  useEffect(() => {
    if (!open || !contract?._id) return undefined;
    let live = true;
    setPreview(null); setError(''); setReason(''); setDate(dayjs().format('YYYY-MM-DD'));
    setLoading(true);
    getSubletCancelPreview(projectId, contract._id)
      .then((res) => { if (live) setPreview(res.data?.data || null); })
      .catch((err) => { if (live) setError(err.response?.data?.message || 'Could not load the contract position'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, projectId, contract?._id]);

  const isActive = preview?.status === 'Active';
  const reasonOk = !isActive || reason.trim().length >= 5;

  const submit = async () => {
    setSaving(true); setError('');
    try {
      const res = await cancelSubletContract(projectId, contract._id, { reason: reason.trim(), cancellationDate: date });
      onCancelled?.(res.data?.message || 'Contract cancelled');
    } catch (err) {
      setError(err.response?.data?.message || 'Cancel failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>Cancel {contract?.contractNumber} — {contract?.contractor?.name || contract?.title}</DialogTitle>
      <DialogContent dividers>
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {preview && !isActive && (
          <Typography variant="body2">This draft has not started — cancelling it simply removes it from the Sub Project.</Typography>
        )}
        {preview && isActive && (
          <Stack spacing={2}>
            {preview.pending.length > 0 && (
              <Alert severity="error">
                <strong>This contract cannot be cancelled yet.</strong> Finish or reject these first:
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {preview.pending.map((p) => <li key={`${p.kind}-${p.number}`}>{p.kind} {p.number} — {p.status}</li>)}
                </Box>
              </Alert>
            )}
            {preview.workDone.amount > 0 && preview.budgetReleased <= 0 && (
              <Alert severity="warning">
                All of this contract&apos;s work is already done — use <strong>Mark Completed</strong> instead, unless it really ended early.
              </Alert>
            )}
            <Box>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>Work done — stays with this contract</Typography>
              <WorkDoneTable workDone={preview.workDone} unitsWord={unitsWord} />
            </Box>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>Settlement with the contractor</Typography>
              <SettlementFigures money={preview.money} />
            </Paper>
            <Alert severity="info">
              Contract value {fmt(preview.contractValue)} · work done {fmt(preview.workDone.amount)} — <strong>{fmt(preview.budgetReleased)}</strong> of
              budget and the remaining scope become free for a new contract.
              {preview.propertiesToRelease.length > 0 && (
                <> {preview.propertiesToRelease.length} propert{preview.propertiesToRelease.length === 1 ? 'y' : 'ies'} not yet handed over will be released
                  ({preview.propertiesToRelease.map((p) => p.label).join(', ')}).</>
              )}
            </Alert>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Cancelled on" type="date" size="small" fullWidth value={date}
                  onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }}
                  inputProps={{ max: dayjs().format('YYYY-MM-DD') }}
                />
              </Grid>
              <Grid item xs={12} sm={8}>
                <TextField
                  label="Reason for cancelling" size="small" fullWidth multiline minRows={2} required value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  helperText="e.g. contractor left the site, poor quality, delay — kept in the contract history"
                />
              </Grid>
            </Grid>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Keep contract</Button>
        <Button
          variant="contained" color="error" onClick={submit}
          disabled={saving || loading || !preview || (isActive && (!preview.canCancel || !reasonOk))}
        >
          {saving ? 'Cancelling…' : 'Cancel contract'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CancelSubletContractDialog;
