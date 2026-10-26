import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, Paper,
  Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography
} from '@mui/material';
import dayjs from 'dayjs';
import { getIpc } from '../../services/projectManagementService';
import IpcApprovalTrail, { IPC_APPROVAL_COLOR, ipcStageText } from './IpcApprovalTrail';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));

/**
 * Read-only review of a subcontractor IPC for every desk in the chain (Pre-Audit, Audit Director,
 * CEO Secretariat, CEO). Each page keeps its own Approve / Reject buttons; `actions` renders them here.
 */
export default function IpcReviewDialog({ ipcId, open, onClose, actions = null }) {
  const [ipc, setIpc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !ipcId) return;
    setIpc(null);
    setError('');
    getIpc(ipcId)
      .then((res) => setIpc(res.data?.data || null))
      .catch((err) => setError(err.response?.data?.message || 'Could not load the IPC'));
  }, [open, ipcId]);

  const project = ipc?.project;
  const field = (label, value) => (
    <Grid item xs={12} sm={4} key={label}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" fontWeight={600}>{value || '—'}</Typography>
    </Grid>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <span>
            {ipc?.invoiceType === 'Client_Invoice'
              ? `Client Invoice ${ipc.invoiceNumber}`
              : `Subcontractor ${ipc?.ipcKind && ipc.ipcKind !== 'Work' ? ipc.ipcKind : 'IPC'} ${ipc ? `#${ipc.ipcNumber} · ${ipc.invoiceNumber}` : ''}`}
          </span>
          {ipc && <Chip label={ipcStageText(ipc)} color={IPC_APPROVAL_COLOR[ipc.approvalStatus || 'Draft'] || 'default'} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error">{error}</Alert>}
        {!ipc && !error && <Skeleton height={240} />}
        {ipc && (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1.5 }}>
              <Grid container spacing={1.5}>
                {field('Main Project', project?.parentProject?.name)}
                {field('Sub Project', project?.name)}
                {field('Sector', [project?.sector, project?.society].filter(Boolean).join(' · '))}
                {ipc.invoiceType === 'Client_Invoice' ? field('Client', ipc.clientName) : field('Subcontractor', ipc.contractor?.name)}
                {field('Check Request', ipc.checkRequest ? `${ipc.checkRequest.checkRequestNumber} — ${ipc.checkRequest.title}` : '')}
                {field('Verified by', ipc.checkRequest?.verifiedBy)}
                {field('Issue date', ipc.issueDate ? dayjs(ipc.issueDate).format('DD MMM YYYY') : '')}
                {field('Prepared by', [ipc.createdBy?.firstName, ipc.createdBy?.lastName].filter(Boolean).join(' '))}
                {field('Submitted', ipc.submittedAt ? dayjs(ipc.submittedAt).format('DD MMM YYYY') : '')}
              </Grid>
            </Paper>

            {(ipc.items || []).length ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Description</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell align="right">Previous</TableCell>
                      <TableCell align="right">This IPC</TableCell>
                      <TableCell align="right">Cumulative</TableCell>
                      <TableCell align="right">Rate</TableCell>
                      <TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ipc.items.map((i, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{i.title || i.description}</TableCell>
                        <TableCell>{i.unit}</TableCell>
                        <TableCell align="right">{i.previousQuantity}</TableCell>
                        <TableCell align="right"><strong>{i.currentQuantity}</strong></TableCell>
                        <TableCell align="right">{i.cumulativeQuantity}</TableCell>
                        <TableCell align="right">{fmt(i.unitPrice)}</TableCell>
                        <TableCell align="right"><strong>{fmt(i.currentAmount)}</strong></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">
                Slab-wise stage{ipc.checkRequest?.slab?.name ? `: ${ipc.checkRequest.slab.name} (${ipc.checkRequest.slab.percentage}%)` : ''} — billed in full from the verified check request.
              </Alert>
            )}

            <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
              {[
                ['Gross certified work', ipc.grossAmount, false],
                [`Retention (${ipc.retentionPercentage || 0}%)`, ipc.retentionAmount, true],
                ['Advance recovery', ipc.advanceRecoveryAmount, true],
                [`WHT (${ipc.whtPercentage || 0}%) — deducted by Finance at payment`, ipc.whtAmount, true]
              ].filter(([, v, neg]) => !neg || Number(v) > 0).map(([label, v, neg]) => (
                <Stack key={label} direction="row" justifyContent="space-between">
                  <Typography variant="body2" color={neg ? 'error.main' : 'text.primary'}>{label}</Typography>
                  <Typography variant="body2" color={neg ? 'error.main' : 'text.primary'}>{neg ? '−' : ''}{fmt(v)}</Typography>
                </Stack>
              ))}
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="subtitle1" fontWeight={800}>{ipc.invoiceType === 'Client_Invoice' ? 'Receivable from client' : 'Net payable to subcontractor'}</Typography>
                <Typography variant="subtitle1" fontWeight={800} color="success.main">{fmt(ipc.netPayableAmount || ipc.invoiceAmount)}</Typography>
              </Stack>
              {ipc.description && <Typography variant="caption" color="text.secondary">{ipc.description}</Typography>}
            </Box>

            <IpcApprovalTrail ipc={ipc} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ mr: 'auto' }}>Close</Button>
        {ipc && actions ? actions(ipc) : null}
      </DialogActions>
    </Dialog>
  );
}
