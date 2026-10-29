import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Alert, CircularProgress, Chip, Grid
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import api from '../../../services/api';
import { formatDate } from '../../../utils/dateUtils';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Return items of one Store Issue Note to the store (creates a Store Return Note) */
export function StoreReturnDialog({ sin, open, onClose, onDone }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lines, setLines] = useState([]);
  const [qty, setQty] = useState({});
  const [condition, setCondition] = useState({});
  const [reason, setReason] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [returnedByName, setReturnedByName] = useState('');

  useEffect(() => {
    if (!open || !sin?._id) return;
    setError(''); setQty({}); setCondition({}); setReason(''); setReturnedByName('');
    setLoading(true);
    api.get(`/procurement/goods-issue/${sin._id}/returnable`)
      .then((res) => setLines(res.data?.data?.lines || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load the SIN items'))
      .finally(() => setLoading(false));
  }, [open, sin?._id]);

  const over = lines.find((l) => Number(qty[l.inventoryItem]) > l.qtyReturnable);
  const anyQty = lines.some((l) => Number(qty[l.inventoryItem]) > 0);

  const submit = async () => {
    setSaving(true); setError('');
    try {
      const res = await api.post('/procurement/store-returns', {
        goodsIssue: sin._id,
        reason,
        returnDate,
        returnedByName: returnedByName || undefined,
        items: lines
          .filter((l) => Number(qty[l.inventoryItem]) > 0)
          .map((l) => ({ inventoryItem: l.inventoryItem, quantity: Number(qty[l.inventoryItem]), condition: condition[l.inventoryItem] || 'good' }))
      });
      onDone(res.data?.message || 'Store Return Note posted');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not post the return');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>Return to Store — {sin?.sinNumber || sin?.issueNumber}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Items go back into {sin?.project?.name ? `${sin.project.name}'s` : 'the same project\'s'} stock at the SIN's issue cost,
          and the COGS posted by the SIN is reversed (DR Inventory / CR COGS).
          {sin?.issueType === 'customer' && ' Qty already billed to the customer cannot be returned until that invoice is cancelled.'}
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {loading ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box> : (
          <>
            <TableContainer sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Item</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Issued</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Returned</TableCell>
                    {sin?.issueType === 'customer' && <TableCell sx={{ fontWeight: 700 }} align="right">Invoiced</TableCell>}
                    <TableCell sx={{ fontWeight: 700 }} align="right">Can Return</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Return Qty</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Condition</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.inventoryItem}>
                      <TableCell>{l.itemName} <Typography component="span" variant="caption" color="text.secondary">({l.itemCode})</Typography></TableCell>
                      <TableCell align="right">{l.qtyIssued} {l.unit}</TableCell>
                      <TableCell align="right">{l.qtyReturned || '—'}</TableCell>
                      {sin?.issueType === 'customer' && <TableCell align="right">{l.qtyInvoiced || '—'}</TableCell>}
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{l.qtyReturnable}</TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small" type="number" sx={{ width: 100 }}
                          value={qty[l.inventoryItem] ?? ''}
                          disabled={l.qtyReturnable <= 0}
                          onChange={(e) => setQty((q) => ({ ...q, [l.inventoryItem]: e.target.value }))}
                          error={Number(qty[l.inventoryItem]) > l.qtyReturnable}
                          inputProps={{ min: 0, max: l.qtyReturnable, step: 'any' }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField select size="small" value={condition[l.inventoryItem] || 'good'} sx={{ minWidth: 110 }}
                          onChange={(e) => setCondition((c) => ({ ...c, [l.inventoryItem]: e.target.value }))}>
                          <MenuItem value="good">Good</MenuItem>
                          <MenuItem value="damaged">Damaged</MenuItem>
                        </TextField>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField fullWidth size="small" type="date" label="Return Date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={12} md={8}>
                <TextField fullWidth size="small" label="Returned By" value={returnedByName} onChange={(e) => setReturnedByName(e.target.value)} placeholder="Name of person returning the items" />
              </Grid>
              <Grid item xs={12}>
                <TextField fullWidth size="small" required label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Excess material after work completed" />
              </Grid>
            </Grid>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving || loading || !anyQty || Boolean(over) || !reason.trim()}>
          {saving ? 'Posting…' : 'Post Store Return'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Cancel (reverse) a whole Store Issue Note */
export function CancelSinDialog({ sin, open, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setReason(''); setError(''); } }, [open]);

  const submit = async () => {
    setSaving(true); setError('');
    try {
      const res = await api.post(`/procurement/goods-issue/${sin._id}/cancel`, { reason });
      onDone(res.data?.message || 'Store Issue Note cancelled');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not cancel');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Cancel {sin?.sinNumber || sin?.issueNumber}?</DialogTitle>
      <DialogContent dividers>
        <Alert severity="warning" sx={{ mb: 2 }}>
          All items not yet returned go back into stock through a Store Return Note, the COGS entry is reversed,
          and the SIN is marked Cancelled. This cannot be undone.
        </Alert>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField fullWidth required label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Issued against wrong project" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Keep SIN</Button>
        <Button variant="contained" color="error" onClick={submit} disabled={saving || !reason.trim()}>
          {saving ? 'Cancelling…' : 'Cancel SIN'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** List of Store Return Notes */
export function StoreReturnsList({ refreshKey }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(250);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/procurement/store-returns', { params: { page: page + 1, limit: rowsPerPage, search: search || undefined } });
      setRows(res.data?.data?.returns || []);
      setTotal(res.data?.data?.pagination?.total || 0);
    } catch (_) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search]);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <>
      <Box sx={{ p: 2 }}>
        <TextField
          size="small" fullWidth placeholder="Search SRN, SIN, customer, item or reason…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
        />
      </Box>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>SRN #</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Against SIN</TableCell>
              <TableCell>Project / Customer</TableCell>
              <TableCell>Items</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell align="right">Value</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Accounts</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={10} align="center"><CircularProgress /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={10} align="center">No store returns</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r._id} hover>
                <TableCell><Typography variant="body2" fontWeight="bold">{r.returnNumber}</Typography></TableCell>
                <TableCell>{formatDate(r.returnDate)}</TableCell>
                <TableCell>{r.sinNumber}</TableCell>
                <TableCell>{r.issueType === 'customer' ? r.customerName : r.project?.name || '—'}</TableCell>
                <TableCell sx={{ fontSize: 13 }}>{(r.items || []).map((i) => `${i.itemName} × ${i.quantity}${i.condition === 'damaged' ? ' (damaged)' : ''}`).join(', ')}</TableCell>
                <TableCell align="right">{r.totalQuantity}</TableCell>
                <TableCell align="right">{fmt(r.totalValue)}</TableCell>
                <TableCell>
                  <Chip size="small" label={r.kind === 'cancellation' ? 'SIN cancelled' : 'Return'} color={r.kind === 'cancellation' ? 'error' : 'info'} variant="outlined" />
                </TableCell>
                <TableCell sx={{ fontSize: 13 }}>{r.reason}</TableCell>
                <TableCell>
                  <Chip size="small"
                    label={r.financePostingStatus === 'posted' ? 'Posted' : r.financePostingStatus === 'partial' ? 'Partial' : 'Not posted'}
                    color={r.financePostingStatus === 'posted' ? 'success' : 'warning'} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div" count={total} page={page} onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[25, 50, 100, 250, 500]}
      />
    </>
  );
}
