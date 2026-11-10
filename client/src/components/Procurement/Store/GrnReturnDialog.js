import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert, Table, TableHead, TableRow,
  TableCell, TableBody, TableContainer, TextField, MenuItem, Grid, Typography, CircularProgress, Tooltip
} from '@mui/material';
import api from '../../../services/api';

const REASONS = [
  { value: 'defective', label: 'Defective' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'over_delivered', label: 'Over delivered' },
  { value: 'quality_issue', label: 'Quality issue' },
  { value: 'other', label: 'Other' }
];

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Return to Vendor against one GRN. Quantities are limited to what was received, not yet
 * returned, and still in stock; prices come from the GRN. Posting reduces stock and the
 * GRN's billable amount.
 */
export default function GrnReturnDialog({ open, grn, onClose, onPosted }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('defective');
  const [notes, setNotes] = useState('');
  const [creditNoteNumber, setCreditNoteNumber] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !grn?._id) return;
    setInfo(null); setQty({}); setError(''); setNotes(''); setCreditNoteNumber(''); setReason('defective');
    setLoading(true);
    api.get(`/procurement/purchase-returns/grn/${grn._id}/returnable`)
      .then((res) => setInfo(res.data?.data || null))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load GRN lines'))
      .finally(() => setLoading(false));
  }, [open, grn?._id]);

  const total = useMemo(() => (info?.lines || []).reduce((s, l) => s + (Number(qty[l.grnItem]) || 0) * l.unitPrice, 0), [info, qty]);
  const overBilled = info && total - info.billableRemaining > 0.01;
  const lineError = (info?.lines || []).some((l) => (Number(qty[l.grnItem]) || 0) - l.maxReturn > 0.0005);

  const submit = async () => {
    const items = (info?.lines || [])
      .filter((l) => Number(qty[l.grnItem]) > 0)
      .map((l) => ({ grnItem: l.grnItem, quantity: Number(qty[l.grnItem]) }));
    if (!items.length) { setError('Enter a quantity for at least one item'); return; }
    try {
      setSaving(true); setError('');
      const res = await api.post('/procurement/purchase-returns/from-grn', {
        goodsReceive: grn._id, items, reason, notes, creditNoteNumber
      });
      onPosted?.(res.data?.message || 'Return posted');
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to post return');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Return to Vendor — GRN {grn?.receiveNumber}</DialogTitle>
      <DialogContent dividers>
        {loading && <CircularProgress size={24} />}
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {info && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              Use this only when the goods themselves go back to {info.supplierName || 'the vendor'} (wrong / defective / extra).
              It reduces stock and the GRN's billable amount. A bill rejected by Audit does <b>not</b> need this.
            </Alert>
            {info.billedAmount > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                This GRN is billed PKR {fmt(info.billedAmount)}; only PKR {fmt(info.billableRemaining)} is unbilled.
                To return more than that, void the bill in GRN&apos;s &amp; Bills first, then re-bill what is kept.
              </Alert>
            )}
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Received</TableCell>
                    <TableCell align="right">Returned</TableCell>
                    <TableCell align="right">In stock</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>Return qty</TableCell>
                    <TableCell align="right">Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {info.lines.map((l) => {
                    const v = Number(qty[l.grnItem]) || 0;
                    const tooMuch = v - l.maxReturn > 0.0005;
                    return (
                      <TableRow key={l.grnItem}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{l.itemName || l.itemCode || '—'}</Typography>
                          {l.blockedReason && <Typography variant="caption" color="warning.main">{l.blockedReason}</Typography>}
                        </TableCell>
                        <TableCell align="right">{l.received} {l.unit}</TableCell>
                        <TableCell align="right">{l.returned}</TableCell>
                        <TableCell align="right">{l.onHand ?? '—'}</TableCell>
                        <TableCell align="right">{fmt(l.unitPrice)}</TableCell>
                        <TableCell align="right">
                          <Tooltip title={`Max ${l.maxReturn}`}>
                            <TextField
                              size="small"
                              type="number"
                              value={qty[l.grnItem] ?? ''}
                              disabled={!(l.maxReturn > 0)}
                              error={tooMuch}
                              onChange={(e) => setQty((p) => ({ ...p, [l.grnItem]: e.target.value }))}
                              inputProps={{ min: 0, max: l.maxReturn, step: 'any' }}
                            />
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right">{fmt(v * l.unitPrice)}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell colSpan={6} align="right"><b>Return value</b></TableCell>
                    <TableCell align="right"><b>PKR {fmt(total)}</b></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
            {overBilled && (
              <Alert severity="error" sx={{ mt: 2 }}>
                Return value is more than the unbilled amount (PKR {fmt(info.billableRemaining)}). Void the bill first.
              </Alert>
            )}
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={4}>
                <TextField select fullWidth label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={8}>
                <TextField fullWidth label="Vendor credit note # (optional)" value={creditNoteNumber} onChange={(e) => setCreditNoteNumber(e.target.value)} />
              </Grid>
              <Grid item xs={12}>
                <TextField fullWidth multiline minRows={2} label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Grid>
            </Grid>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} color="inherit">Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={submit}
          disabled={saving || !info || !(total > 0) || overBilled || lineError}
        >
          {saving ? 'Posting…' : 'Post Return'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
