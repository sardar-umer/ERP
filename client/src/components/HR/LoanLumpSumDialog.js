import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { Payments as PaymentIcon } from '@mui/icons-material';
import { loanService } from '../../services/loanService';
import { formatPKR } from '../../utils/currency';

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (from = null) => ({
  amount: from?.amount != null ? String(from.amount) : '',
  mode: from?.mode || 'reduce_tenure',
  paymentDate: from?.paymentDate ? String(from.paymentDate).slice(0, 10) : today(),
  paymentMethod: from?.paymentMethod || 'Cash',
  reference: from?.reference || '',
  remarks: from?.remarks || ''
});

const fmtMonth = (d) =>
  d ? new Date(d).toLocaleDateString('en-PK', { month: 'short', year: 'numeric' }) : '—';

/**
 * HR sends a lump-sum payment (received from the employee outside payroll) to Finance.
 * Shows a live before/after preview. The loan changes only when Finance posts the voucher.
 * Pass `resubmitRequest` to edit and resubmit a request Finance returned.
 */
const LoanLumpSumDialog = ({ open, loan, onClose, onDone, resubmitRequest = null }) => {
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(null);
  const [pendingPayrolls, setPendingPayrolls] = useState([]);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(emptyForm(resubmitRequest));
      setPreview(null);
      setPreviewError('');
      setSaveError('');
      setPendingPayrolls([]);
    }
  }, [open, resubmitRequest]);

  const amount = Number(form.amount);

  // Debounced server preview whenever amount / option / date changes
  useEffect(() => {
    if (!open || !loan?._id) return undefined;
    if (!(amount > 0)) {
      setPreview(null);
      setPreviewError('');
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await loanService.previewLumpSum(loan._id, {
          amount,
          mode: form.mode,
          paymentDate: form.paymentDate,
          paymentMethod: form.paymentMethod
        });
        if (cancelled) return;
        setPreview(res.preview);
        setPendingPayrolls(res.pendingPayrolls || []);
        setPreviewError('');
      } catch (err) {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(err?.message || 'Could not build preview');
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, loan?._id, amount, form.mode, form.paymentDate, form.paymentMethod]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        ...form,
        amount,
        reference: form.reference.trim() || undefined,
        remarks: form.remarks.trim() || undefined
      };
      const res = resubmitRequest
        ? await loanService.resubmitLumpSumRequest(resubmitRequest._id, payload)
        : await loanService.sendLumpSumRequest(loan._id, payload);
      onDone?.(res);
    } catch (err) {
      setSaveError(err?.message || 'Failed to send to Finance');
    } finally {
      setSaving(false);
    }
  };

  const isFull = preview?.paymentType === 'Full Settlement';
  const canSave = preview && !previewing && !previewError && !saving;

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>
        <PaymentIcon sx={{ mr: 1, verticalAlign: 'middle', color: 'success.main' }} />
        {resubmitRequest ? `Resubmit ${resubmitRequest.requestNumber} to Finance` : 'Send Lump-Sum Payment to Finance'}
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          Use this when the employee pays an amount directly (cash, bank or cheque) on top of payroll deductions.
          Finance confirms the money and posts the receipt voucher — <strong>only then</strong> does the balance go down
          and the remaining installments get rebuilt. The figures below are a preview as of today.
          {loan && (
            <>
              {' '}Current installment: <strong>{formatPKR(loan.monthlyInstallment)}</strong>
              {' · '}Outstanding: <strong>{formatPKR(loan.outstandingBalance)}</strong>
            </>
          )}
        </Alert>

        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              autoFocus
              type="number"
              label="Amount received (Rs)"
              value={form.amount}
              onChange={set('amount')}
              inputProps={{ min: 1 }}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              type="date"
              label="Payment date"
              value={form.paymentDate}
              onChange={set('paymentDate')}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: today() }}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth>
              <InputLabel>Payment method</InputLabel>
              <Select label="Payment method" value={form.paymentMethod} onChange={set('paymentMethod')}>
                {['Cash', 'Bank Transfer', 'Cheque', 'Direct Payment'].map((m) => (
                  <MenuItem key={m} value={m}>{m}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Receipt / reference no."
              value={form.reference}
              onChange={set('reference')}
              inputProps={{ maxLength: 100 }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Remarks"
              value={form.remarks}
              onChange={set('remarks')}
              inputProps={{ maxLength: 500 }}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControl>
              <FormLabel>After this payment</FormLabel>
              <RadioGroup row value={form.mode} onChange={set('mode')}>
                <FormControlLabel
                  value="reduce_tenure"
                  control={<Radio />}
                  label="Keep installment, finish loan sooner"
                />
                <FormControlLabel
                  value="reduce_installment"
                  control={<Radio />}
                  label="Keep months, lower installment"
                />
              </RadioGroup>
            </FormControl>
          </Grid>
        </Grid>

        <Box sx={{ mt: 2, minHeight: 60 }}>
          {previewing && (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={18} />
              <Typography variant="body2">Calculating new schedule…</Typography>
            </Box>
          )}
          {!previewing && previewError && <Alert severity="error">{previewError}</Alert>}
          {!previewing && preview && (
            <>
              <TableContainer sx={{ mb: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell />
                      <TableCell align="right">Before</TableCell>
                      <TableCell align="right">After</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell>Balance owed</TableCell>
                      <TableCell align="right">{formatPKR(preview.before.principal)}</TableCell>
                      <TableCell align="right"><strong>{formatPKR(preview.after.principal)}</strong></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Monthly installment</TableCell>
                      <TableCell align="right">{formatPKR(preview.before.installment)}</TableCell>
                      <TableCell align="right"><strong>{isFull ? '—' : formatPKR(preview.after.installment)}</strong></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Installments left</TableCell>
                      <TableCell align="right">{preview.before.remainingInstallments}</TableCell>
                      <TableCell align="right"><strong>{preview.after.remainingInstallments}</strong></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Last installment</TableCell>
                      <TableCell align="right">—</TableCell>
                      <TableCell align="right"><strong>{fmtMonth(preview.after.lastDueDate)}</strong></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>

              {isFull ? (
                <Alert severity="success">
                  This clears the full balance. Once Finance posts it, the loan is marked <strong>Completed</strong> and payroll deductions stop.
                </Alert>
              ) : (
                <>
                  <Typography variant="subtitle2" gutterBottom>New remaining installments</Typography>
                  <TableContainer sx={{ maxHeight: 220 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>#</TableCell>
                          <TableCell>Month</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell align="right">Balance after</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {preview.newPendingSchedule.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell>{fmtMonth(row.dueDate)}</TableCell>
                            <TableCell align="right">{formatPKR(row.amount)}</TableCell>
                            <TableCell align="right">{formatPKR(row.balance)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}

              {(preview.warnings || []).map((w, i) => (
                <Alert key={i} severity="warning" sx={{ mt: 1 }}>{w}</Alert>
              ))}
              {pendingPayrolls.length > 0 && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  Payroll not yet paid already includes this employee&apos;s old loan deduction
                  ({pendingPayrolls.map((p) => `${p.month}/${p.year}: ${formatPKR(p.loanDeductions)}`).join(', ')}).
                  Regenerate it after Finance posts this so it uses the new schedule.
                </Alert>
              )}
            </>
          )}
        </Box>

        {resubmitRequest?.financeComments && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Finance returned this: <strong>{resubmitRequest.financeComments}</strong>
          </Alert>
        )}
        {saveError && <Alert severity="error" sx={{ mt: 2 }}>{saveError}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" color="success" onClick={handleSave} disabled={!canSave}>
          {saving ? 'Sending…' : resubmitRequest ? 'Resubmit to Finance' : 'Send to Finance'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LoanLumpSumDialog;
