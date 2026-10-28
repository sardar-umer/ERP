import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControlLabel, Grid, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import EditIcon from '@mui/icons-material/Edit';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import api from '../../../services/api';
import { formatDate } from '../../../utils/dateUtils';

const EMPTY = { vehicleNumber: '', driverName: '', driverPhone: '', transporter: '', deliverTo: '', deliveryAddress: '', remarks: '', returnable: false };
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const personName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '');

/** Clean printable gate pass in its own window (the dialog and app chrome are not printed) */
const printGatePass = (sin) => {
  const gp = sin.gatePass || {};
  const rows = (sin.items || []).map((it, i) => `
    <tr><td>${i + 1}</td><td>${esc(it.itemCode)}</td><td>${esc(it.itemName)}</td>
    <td class="r">${esc(it.qtyIssued ?? it.quantity)} ${esc(it.unit)}</td><td>${esc(it.remarks || '')}</td></tr>`).join('');
  const field = (label, value) => `<div class="f"><span>${label}</span><b>${esc(value) || '&nbsp;'}</b></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(gp.number)}</title><style>
    body{font-family:Arial,sans-serif;color:#111;margin:28px;font-size:13px}
    h1{font-size:20px;margin:0}.sub{color:#555;margin-top:2px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
    .tag{border:2px solid #111;padding:4px 10px;font-weight:bold;font-size:12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:14px}
    .f{display:flex;gap:8px;border-bottom:1px dotted #999;padding:3px 0}.f span{color:#555;min-width:120px}
    table{width:100%;border-collapse:collapse;margin:8px 0 14px}th,td{border:1px solid #333;padding:6px;text-align:left}
    th{background:#f0f0f0}.r{text-align:right}
    .sign{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:56px}
    .sign div{border-top:1px solid #111;padding-top:4px;text-align:center;font-size:12px}
    @media print{body{margin:12mm}}
  </style></head><body>
    <div class="head"><div><h1>Outward Gate Pass / Delivery Note</h1>
      <div class="sub">${esc(gp.number)} &middot; ${esc(formatDate(gp.dispatchedAt || new Date()))}</div></div>
      <div class="tag">${gp.returnable ? 'RETURNABLE' : 'NON-RETURNABLE'}</div></div>
    <div class="grid">
      ${field('SIN', sin.issueNumber || sin.sinNumber)}${field('Issue date', formatDate(sin.issueDate))}
      ${field('Deliver to', gp.deliverTo || sin.customerName || sin.departmentName)}${field('Project', sin.project?.name)}
      ${field('Address', gp.deliveryAddress)}${field('From store', sin.storeSnapshot)}
      ${field('Vehicle no.', gp.vehicleNumber)}${field('Transporter', gp.transporter)}
      ${field('Driver', gp.driverName)}${field('Driver phone', gp.driverPhone)}
    </div>
    <table><thead><tr><th>#</th><th>Item code</th><th>Item</th><th class="r">Quantity</th><th>Remarks</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="3">Total</th><th class="r">${esc(sin.totalQuantity)}</th><th></th></tr></tfoot></table>
    ${gp.remarks ? `<div><b>Remarks:</b> ${esc(gp.remarks)}</div>` : ''}
    <div class="sign"><div>Store Keeper<br>${esc(personName(gp.issuedBy))}</div><div>Security / Gate</div><div>Driver</div><div>Received by</div></div>
    <script>window.onload=function(){window.print()}</script>
  </body></html>`;
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
};

/** Create / edit / print the Outward Gate Pass for an issued SIN */
export const GatePassDialog = ({ open, sin, onClose, onDone }) => {
  const [full, setFull] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !sin?._id) return;
    setError('');
    setLoading(true);
    api.get(`/procurement/goods-issue/${sin._id}`)
      .then((r) => {
        const doc = r.data?.data || sin;
        setFull(doc);
        setForm({ ...EMPTY, deliverTo: doc.customerName || doc.departmentName || '', ...(doc.gatePass || {}) });
        setEditing(!doc.gatePass?.number);
      })
      .catch(() => { setFull(sin); setEditing(!sin.gatePass?.number); })
      .finally(() => setLoading(false));
  }, [open, sin]);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/procurement/goods-issue/${sin._id}/gate-pass`, form);
      setFull((prev) => ({ ...prev, ...res.data.data }));
      setEditing(false);
      onDone && onDone(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save gate pass');
    } finally {
      setSaving(false);
    }
  };

  const gp = full?.gatePass;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <LocalShippingIcon color="primary" />
          <span>Outward Gate Pass — {sin?.issueNumber || sin?.sinNumber}</span>
          {gp?.number && <Chip size="small" color="success" label={gp.number} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {loading ? <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box> : (
          <>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {editing ? (
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" required label="Vehicle no." value={form.vehicleNumber} onChange={setField('vehicleNumber')} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Transporter" value={form.transporter} onChange={setField('transporter')} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Driver name" value={form.driverName} onChange={setField('driverName')} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Driver phone" value={form.driverPhone} onChange={setField('driverPhone')} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Deliver to" value={form.deliverTo} onChange={setField('deliverTo')} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Delivery address" value={form.deliveryAddress} onChange={setField('deliveryAddress')} /></Grid>
                <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label="Remarks" value={form.remarks} onChange={setField('remarks')} /></Grid>
                <Grid item xs={12}>
                  <FormControlLabel control={<Checkbox checked={Boolean(form.returnable)} onChange={setField('returnable')} />}
                    label="Returnable (goods are expected back, e.g. tools or equipment)" />
                </Grid>
              </Grid>
            ) : (
              <Grid container spacing={1.5}>
                {[
                  ['Vehicle', gp?.vehicleNumber], ['Transporter', gp?.transporter], ['Driver', [gp?.driverName, gp?.driverPhone].filter(Boolean).join(' · ')],
                  ['Deliver to', gp?.deliverTo], ['Address', gp?.deliveryAddress], ['Dispatched', gp?.dispatchedAt ? formatDate(gp.dispatchedAt) : '']
                ].map(([label, value]) => (
                  <Grid item xs={12} sm={4} key={label}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="body2" fontWeight={600}>{value || '—'}</Typography>
                  </Grid>
                ))}
                <Grid item xs={12}><Chip size="small" variant="outlined" label={gp?.returnable ? 'Returnable' : 'Non-returnable'} /></Grid>
              </Grid>
            )}
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Items leaving the store</Typography>
            <Table size="small">
              <TableHead>
                <TableRow><TableCell>#</TableCell><TableCell>Item</TableCell><TableCell align="right">Quantity</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {(full?.items || []).map((it, i) => (
                  <TableRow key={i}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>{it.itemCode ? `${it.itemCode} — ` : ''}{it.itemName}</TableCell>
                    <TableCell align="right">{it.qtyIssued ?? it.quantity} {it.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {editing ? (
          <Button variant="contained" onClick={save} disabled={saving || !form.vehicleNumber.trim()}>
            {saving ? 'Saving…' : gp?.number ? 'Save changes' : 'Create gate pass'}
          </Button>
        ) : (
          <>
            <Button startIcon={<EditIcon />} onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="contained" startIcon={<PrintIcon />}
              onClick={() => { if (!printGatePass(full)) setError('Allow pop-ups for this site to print the gate pass'); }}>
              Print
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default GatePassDialog;
