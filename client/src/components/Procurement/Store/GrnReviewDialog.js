import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Grid, Table, TableHead,
  TableRow, TableCell, TableBody, TableContainer, Paper, Chip, Stack, TextField, Alert, CircularProgress, Box
} from '@mui/material';
import { AttachFile as AttachFileIcon, Cancel as RejectIcon } from '@mui/icons-material';
import api from '../../../services/api';
import { formatDate } from '../../../utils/dateUtils';
import { formatPKR } from '../../../utils/currency';
import { resolveUploadFileHref } from '../../../utils/uploadPaths';

const userName = (u) => (u && typeof u === 'object' ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

const Field = ({ label, value }) => (
  <Grid item xs={6} md={4}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
  </Grid>
);

/**
 * GRN view for GRN's & Bills → Unbilled GRNs, with "Reject with observation".
 * Rejecting sends the GRN back to Store; stock, journal and PO quantities are reversed.
 */
const GrnReviewDialog = ({ open, grnId, onClose, onRejected }) => {
  const [grn, setGrn] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [observation, setObservation] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !grnId) return undefined;
    let cancelled = false;
    setGrn(null);
    setError('');
    setRejecting(false);
    setObservation('');
    (async () => {
      try {
        setLoading(true);
        const res = await api.get(`/procurement/goods-receive/${grnId}`);
        if (!cancelled) setGrn(res.data?.data || null);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.message || 'Failed to load GRN');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, grnId]);

  const billed = (Number(grn?.billedAmount) || 0) > 0;
  const canReject = grn && ['Received', 'Complete', 'Partial'].includes(grn.status) && !billed
    && (!grn.returnStatus || grn.returnStatus === 'none');

  const doReject = async () => {
    try {
      setBusy(true);
      setError('');
      const res = await api.post(`/procurement/goods-receive/${grnId}/reject`, { observation: observation.trim() });
      onRejected?.(res.data?.message || 'GRN rejected');
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to reject GRN');
    } finally {
      setBusy(false);
    }
  };

  const lines = grn?.items || [];
  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          GRN {grn?.receiveNumber || ''}
          {grn?.status && <Chip size="small" label={grn.status} color={grn.status === 'Returned' ? 'error' : 'success'} variant="outlined" />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {loading && <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {grn && (
          <>
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              <Field label="GRN date" value={formatDate(grn.receiveDate)} />
              <Field label="PO" value={grn.poNumber || grn.purchaseOrder?.orderNumber} />
              <Field label="Supplier / Vendor" value={grn.supplierName || grn.supplier?.name} />
              <Field label="Store" value={grn.storeSnapshot} />
              <Field label="Project" value={grn.project?.name} />
              <Field label="Delivery challan" value={grn.deliveryChallan?.dcNumber} />
              <Field label="Gate pass" value={grn.gatePassNo} />
              <Field label="Prepared by" value={grn.preparedByName || userName(grn.receivedBy)} />
              <Field label="Billing" value={billed ? `Billed ${formatPKR(grn.billedAmount)}` : 'Not billed'} />
              {grn.narration && <Grid item xs={12}><Typography variant="caption" color="text.secondary">Narration</Typography><Typography variant="body2">{grn.narration}</Typography></Grid>}
              {grn.observation && <Grid item xs={12}><Typography variant="caption" color="text.secondary">Store observation</Typography><Typography variant="body2">{grn.observation}</Typography></Grid>}
            </Grid>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Item</TableCell>
                    <TableCell>Code</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell>Unit</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={l._id || i}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{l.itemName}</TableCell>
                      <TableCell>{l.itemCode}</TableCell>
                      <TableCell align="right">{Number(l.quantity || 0).toLocaleString('en-PK')}</TableCell>
                      <TableCell>{l.unit}</TableCell>
                      <TableCell align="right">{formatPKR(l.unitPrice || 0)}</TableCell>
                      <TableCell align="right">{formatPKR((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={6} align="right"><strong>Subtotal</strong></TableCell>
                    <TableCell align="right"><strong>{formatPKR(subtotal)}</strong></TableCell>
                  </TableRow>
                  {(Number(grn.discount) || 0) !== 0 && (
                    <TableRow><TableCell colSpan={6} align="right">Discount</TableCell><TableCell align="right">-{formatPKR(grn.discount)}</TableCell></TableRow>
                  )}
                  {(Number(grn.otherCharges) || 0) !== 0 && (
                    <TableRow><TableCell colSpan={6} align="right">Other charges</TableCell><TableCell align="right">{formatPKR(grn.otherCharges)}</TableCell></TableRow>
                  )}
                  <TableRow>
                    <TableCell colSpan={6} align="right"><strong>Net amount</strong></TableCell>
                    <TableCell align="right"><strong>{formatPKR(grn.netAmount ?? grn.total ?? subtotal)}</strong></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            {(grn.attachments || []).length > 0 && (
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
                {grn.attachments.map((a) => (
                  <Chip key={a._id || a.path} size="small" icon={<AttachFileIcon />} label={a.filename || 'Attachment'}
                    component="a" href={resolveUploadFileHref(a.path)} target="_blank" clickable />
                ))}
              </Stack>
            )}

            {(grn.rejectionHistory || []).length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Earlier rejections</Typography>
                {grn.rejectionHistory.map((h, i) => (
                  <Typography key={i} variant="body2" color="text.secondary">
                    {formatDate(h.returnedAt)} — {h.observation}{h.resubmittedAt ? ` (resubmitted ${formatDate(h.resubmittedAt)})` : ''}
                  </Typography>
                ))}
              </Box>
            )}

            {rejecting && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  The GRN goes back to Store with your observation. Its stock, GRN journal and PO received
                  quantities are reversed; Store corrects it and submits it again.
                </Alert>
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  autoFocus
                  label="Observation (required)"
                  placeholder="What is wrong and what Store should correct"
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
                  disabled={busy}
                />
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {grn && !canReject && !rejecting && (
          <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
            {billed ? 'Partly billed — void the bill before rejecting.' : grn.status === 'Returned' ? 'Already sent back to Store.' : 'This GRN cannot be rejected.'}
          </Typography>
        )}
        <Button onClick={onClose} disabled={busy} color="inherit">Close</Button>
        {canReject && !rejecting && (
          <Button color="error" variant="outlined" startIcon={<RejectIcon />} onClick={() => setRejecting(true)}>
            Reject with observation
          </Button>
        )}
        {rejecting && (
          <>
            <Button onClick={() => setRejecting(false)} disabled={busy} color="inherit">Back</Button>
            <Button color="error" variant="contained" onClick={doReject} disabled={busy || observation.trim().length < 5}
              startIcon={busy ? <CircularProgress size={16} /> : <RejectIcon />}>
              Reject &amp; send back to Store
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default GrnReviewDialog;
