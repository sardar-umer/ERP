import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormHelperText, Grid,
  InputLabel, MenuItem, Select, TextField
} from '@mui/material';
import { createAdvanceIpc, createRetentionRelease, reviseIpc } from '../../services/projectManagementService';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));

/**
 * Create or revise the non-work IPC kinds:
 *  - Advance: mobilisation advance against an Active sublet contract, recovered at a % of later IPCs
 *  - Retention Release: pays back retention held on CEO-approved IPCs
 * `balances` = /subcontractor-balances rows; `editing` = an existing Draft / Rejected IPC of that kind.
 */
export default function IpcKindDialog({ open, kind, onClose, onSaved, projectId, balances = [], editing = null }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isAdvance = kind === 'Advance';

  const contracts = useMemo(() => balances.flatMap((b) => (b.activeContracts || []).map((c) => ({ ...c, contractorName: b.contractor.name }))), [balances]);
  const releasable = useMemo(() => balances.filter((b) => b.retentionAvailable > 0), [balances]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(editing
      ? {
          subletContract: String(editing.subletContract?._id || editing.subletContract || ''),
          contractor: String(editing.contractor?._id || editing.contractor || ''),
          amount: editing.grossAmount,
          recoveryPercent: editing.advanceRecoveryPercent || '',
          description: editing.description || '',
          comments: ''
        }
      : { subletContract: '', contractor: '', amount: '', recoveryPercent: 10, description: '', comments: '' });
  }, [open, editing]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const selectedBalance = balances.find((b) => String(b.contractor._id) === String(form.contractor));
  // A release being revised may use its own amount again
  const releaseCap = (selectedBalance?.retentionAvailable || 0) + (editing ? Number(editing.grossAmount) || 0 : 0);

  const handleSave = async () => {
    const amount = Number(form.amount);
    if (!(amount > 0)) { setError('Enter the amount'); return; }
    if (isAdvance && !editing && !form.subletContract) { setError('Select the sublet contract'); return; }
    if (isAdvance && !(Number(form.recoveryPercent) > 0 && Number(form.recoveryPercent) <= 100)) { setError('Recovery % must be between 1 and 100'); return; }
    if (!isAdvance && !editing && !form.contractor) { setError('Select the subcontractor'); return; }
    if (!isAdvance && amount > releaseCap + 0.01) { setError(`Only ${fmt(releaseCap)} of retention can be released`); return; }
    if (!isAdvance && !String(form.description).trim()) { setError('Say why the retention is being released'); return; }
    try {
      setSaving(true);
      setError('');
      let res;
      if (editing) {
        res = await reviseIpc(projectId, editing._id, {
          amount, recoveryPercent: isAdvance ? Number(form.recoveryPercent) : undefined, description: form.description, comments: form.comments
        });
      } else if (isAdvance) {
        res = await createAdvanceIpc(projectId, {
          subletContract: form.subletContract, amount, recoveryPercent: Number(form.recoveryPercent), description: form.description
        });
      } else {
        res = await createRetentionRelease(projectId, { contractor: form.contractor, amount, description: form.description });
      }
      onSaved?.(res.data?.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>
        {editing ? `Revise ${kind} IPC #${editing.ipcNumber}` : isAdvance ? 'New Mobilisation Advance' : 'Release Retention'}
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Alert severity="info" sx={{ mb: 2 }}>
          {isAdvance
            ? 'Paid to the subcontractor up front against an Active sublet contract. Each later IPC deducts the recovery % of its gross until the advance is fully recovered.'
            : 'Pays back retention money held on CEO-approved IPCs — normally after the defects liability period. It goes through the same approval chain.'}
        </Alert>
        <Grid container spacing={2}>
          {isAdvance ? (
            <Grid item xs={12}>
              <FormControl fullWidth required disabled={Boolean(editing)}>
                <InputLabel>Sublet contract</InputLabel>
                <Select label="Sublet contract" value={form.subletContract || ''} onChange={set('subletContract')}>
                  {!contracts.length && <MenuItem value="" disabled>No Active sublet contracts on this Sub Project</MenuItem>}
                  {contracts.map((c) => (
                    <MenuItem key={c._id} value={String(c._id)}>
                      {c.contractorName} — {c.contractNumber} ({c.contractType === 'Slab' ? 'Slab wise' : 'BOQ wise'}) · {fmt(c.totalAmount)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          ) : (
            <Grid item xs={12}>
              <FormControl fullWidth required disabled={Boolean(editing)}>
                <InputLabel>Subcontractor</InputLabel>
                <Select label="Subcontractor" value={form.contractor || ''} onChange={set('contractor')}>
                  {!releasable.length && !editing && <MenuItem value="" disabled>No retention held on approved IPCs yet</MenuItem>}
                  {(editing ? balances : releasable).map((b) => (
                    <MenuItem key={b.contractor._id} value={String(b.contractor._id)}>
                      {b.contractor.name} — {fmt(b.retentionAvailable)} held
                    </MenuItem>
                  ))}
                </Select>
                {selectedBalance && <FormHelperText>Up to {fmt(releaseCap)} can be released</FormHelperText>}
              </FormControl>
            </Grid>
          )}
          <Grid item xs={12} sm={isAdvance ? 6 : 12}>
            <TextField fullWidth required type="number" label="Amount (PKR)" value={form.amount ?? ''} onChange={set('amount')}
              inputProps={{ min: 0, max: isAdvance ? undefined : releaseCap }} />
          </Grid>
          {isAdvance && (
            <Grid item xs={12} sm={6}>
              <TextField fullWidth required type="number" label="Recovery % of each later IPC" value={form.recoveryPercent ?? ''}
                onChange={set('recoveryPercent')} inputProps={{ min: 1, max: 100 }} />
            </Grid>
          )}
          <Grid item xs={12}>
            <TextField fullWidth multiline minRows={2} required={!isAdvance}
              label={isAdvance ? 'Description' : 'Reason for release (e.g. defects liability period ended on …)'}
              value={form.description || ''} onChange={set('description')} />
          </Grid>
          {editing && (
            <Grid item xs={12}>
              <TextField fullWidth label="What did you change?" value={form.comments || ''} onChange={set('comments')} />
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save revision' : 'Create (then submit for approval)'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
