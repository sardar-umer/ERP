import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert, Grid, TextField, Table, TableHead,
  TableRow, TableCell, TableBody, TableContainer, Typography, CircularProgress
} from '@mui/material';
import api from '../../../services/api';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/**
 * Developer-only audited GRN correction. Quantity/rate changes adjust stock, post a journal
 * for the difference and update the PO; every change is kept in the GRN's edit history.
 */
export default function GrnDeveloperEditDialog({ open, grnId, onClose, onSaved }) {
  const [grn, setGrn] = useState(null);
  const [header, setHeader] = useState({});
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !grnId) return;
    setGrn(null); setError(''); setReason('');
    setLoading(true);
    api.get(`/procurement/goods-receive/${grnId}`)
      .then((res) => {
        const g = res.data?.data;
        setGrn(g);
        setHeader({
          receiveDate: toDate(g.receiveDate),
          gatePassNo: g.gatePassNo || '',
          narration: g.narration || '',
          notes: g.notes || '',
          observation: g.observation || ''
        });
        setLines((g.items || []).map((l) => ({
          _id: l._id,
          itemName: l.itemName || l.itemCode || '—',
          unit: l.unit || '',
          returnedQuantity: Number(l.returnedQuantity) || 0,
          origQty: Number(l.quantity) || 0,
          origPrice: Number(l.unitPrice) || 0,
          quantity: l.quantity ?? 0,
          unitPrice: l.unitPrice ?? 0,
          rack: l.location?.rack || '',
          shelf: l.location?.shelf || '',
          bin: l.location?.bin || ''
        })));
      })
      .catch((e) => setError(e.response?.data?.message || 'Failed to load GRN'))
      .finally(() => setLoading(false));
  }, [open, grnId]);

  const activeBills = (grn?.bills || []).filter((b) => b.status !== 'cancelled');
  const valueDelta = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) - l.origQty * l.origPrice, 0), [lines]);
  const setLine = (i, k, v) => setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const save = async () => {
    try {
      setSaving(true); setError('');
      const res = await api.put(`/procurement/goods-receive/${grnId}/developer-edit`, {
        ...header,
        reason,
        items: lines.map((l) => ({
          _id: l._id,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          location: { rack: l.rack, shelf: l.shelf, bin: l.bin }
        }))
      });
      onSaved?.(res.data?.message || 'GRN updated');
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Developer edit — GRN {grn?.receiveNumber}</DialogTitle>
      <DialogContent dividers>
        {loading && <CircularProgress size={24} />}
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {grn && (
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
              Data correction only. For goods going back to the vendor use <b>Return to Vendor</b>.
              Changing quantity or rate adjusts stock, posts a journal for the difference and updates the PO.
              Every change is logged with your reason.
            </Alert>
            {activeBills.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                Billed on {activeBills.map((b) => `${b.billNumber} (${b.status})`).join(', ')} — quantity and rate are locked until that bill is voided.
              </Alert>
            )}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth type="date" label="Receive Date" value={header.receiveDate} onChange={(e) => setHeader((h) => ({ ...h, receiveDate: e.target.value }))} InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Gate Pass No." value={header.gatePassNo} onChange={(e) => setHeader((h) => ({ ...h, gatePassNo: e.target.value }))} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Observation" value={header.observation} onChange={(e) => setHeader((h) => ({ ...h, observation: e.target.value }))} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth multiline minRows={2} label="Narration" value={header.narration} onChange={(e) => setHeader((h) => ({ ...h, narration: e.target.value }))} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth multiline minRows={2} label="Notes" value={header.notes} onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} />
              </Grid>
            </Grid>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>Qty</TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>Rate</TableCell>
                    <TableCell sx={{ width: 90 }}>Rack</TableCell>
                    <TableCell sx={{ width: 90 }}>Shelf</TableCell>
                    <TableCell sx={{ width: 90 }}>Bin</TableCell>
                    <TableCell align="right">Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((l, i) => {
                    const changed = Number(l.quantity) !== l.origQty || Number(l.unitPrice) !== l.origPrice;
                    return (
                      <TableRow key={l._id} sx={changed ? { bgcolor: 'rgba(237, 108, 2, 0.08)' } : undefined}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{l.itemName}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            was {l.origQty} {l.unit} @ {fmt(l.origPrice)}{l.returnedQuantity ? ` · ${l.returnedQuantity} returned` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <TextField size="small" type="number" value={l.quantity} disabled={activeBills.length > 0}
                            onChange={(e) => setLine(i, 'quantity', e.target.value)} inputProps={{ min: l.returnedQuantity, step: 'any' }} />
                        </TableCell>
                        <TableCell align="right">
                          <TextField size="small" type="number" value={l.unitPrice} disabled={activeBills.length > 0}
                            onChange={(e) => setLine(i, 'unitPrice', e.target.value)} inputProps={{ min: 0, step: 'any' }} />
                        </TableCell>
                        <TableCell><TextField size="small" value={l.rack} onChange={(e) => setLine(i, 'rack', e.target.value)} /></TableCell>
                        <TableCell><TextField size="small" value={l.shelf} onChange={(e) => setLine(i, 'shelf', e.target.value)} /></TableCell>
                        <TableCell><TextField size="small" value={l.bin} onChange={(e) => setLine(i, 'bin', e.target.value)} /></TableCell>
                        <TableCell align="right">{fmt((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            {Math.abs(valueDelta) > 0.009 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Value change PKR {fmt(valueDelta)} — journal: {valueDelta > 0 ? 'Dr Inventory / Cr GRNI' : 'Dr GRNI / Cr Inventory'}
              </Alert>
            )}
            <TextField
              fullWidth
              required
              multiline
              minRows={2}
              sx={{ mt: 2 }}
              label="Reason for correction"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              helperText="Kept in the GRN edit history"
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} color="inherit">Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving || !grn || reason.trim().length < 5}>
          {saving ? 'Saving…' : 'Save Correction'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
