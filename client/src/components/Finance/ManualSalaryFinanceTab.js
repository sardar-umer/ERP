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
  Typography
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  Delete as DeleteIcon,
  Payments as PaymentsIcon,
  Refresh as RefreshIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import api from '../../services/api';
import {
  fetchFinanceAuthorityCandidates,
  userOptionLabel,
  userOptionSecondary
} from '../../services/financeApprovalAuthorityService';
import { fetchPayFromAccounts, formatPayFromAccountLabel } from '../../utils/payFromAccounts';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';

const SR_MANAGER_ACCOUNTS_NAME = 'Muhammad Iftikhar Rashid';

const fmt = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;

const statusChip = (status) => {
  if (status === 'paid') return <Chip size="small" color="success" label="Paid" />;
  if (status === 'payment_pending') return <Chip size="small" color="info" label="Payment Pending Approval" />;
  if (status === 'draft_payment') return <Chip size="small" color="default" label="Draft BPV" />;
  if (status === 'pending_payment') return <Chip size="small" color="warning" label="Pending Payment" />;
  return <Chip size="small" label={status || '—'} />;
};

const recordStatusChip = (status) => {
  const s = String(status || '');
  let color = 'default';
  if (s === 'Paid') color = 'success';
  else if (s === 'Payment Pending') color = 'info';
  else if (s === 'Pending Finance' || s === 'Approved by CEO') color = 'warning';
  return <Chip size="small" label={s || '—'} color={color} variant={s === 'Paid' ? 'filled' : 'outlined'} />;
};

export default function ManualSalaryFinanceTab({ onSnackbar }) {
  const { selectedCompanyId, companies: financeCompanies } = useFinanceCompany();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [financeAuthorityCandidates, setFinanceAuthorityCandidates] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [paymentFinAuth, setPaymentFinAuth] = useState({ financeControllerUser: null });
  const [payingCompanyId, setPayingCompanyId] = useState('');
  const [paymentData, setPaymentData] = useState({
    amount: 0,
    grossAmount: 0,
    paymentMethod: 'bank_transfer',
    reference: '',
    narration: '',
    paymentDate: new Date().toISOString().split('T')[0],
    bankAccountId: ''
  });

  const notify = useCallback((message, severity = 'success') => {
    if (onSnackbar) onSnackbar({ open: true, message, severity });
  }, [onSnackbar]);

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/finance/manual-salary-queue');
      setQueue(res.data?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load manual salary finance queue');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (month, year) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/finance/manual-salary-queue/${month}/${year}`);
      setDetail(res.data?.data || null);
      setSelected({ month, year, periodLabel: res.data?.data?.periodLabel });
    } catch (err) {
      notify(err.response?.data?.message || 'Failed to load manual salary period', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const effectivePayingCompanyId = useMemo(
    () => payingCompanyId || selectedCompanyId,
    [payingCompanyId, selectedCompanyId]
  );

  useEffect(() => {
    if (!paymentDialogOpen) return;
    let cancelled = false;
    fetchFinanceAuthorityCandidates()
      .then((list) => {
        if (cancelled) return;
        setFinanceAuthorityCandidates(list);
        const faisalMatch = list.find((user) => {
          const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim().toLowerCase();
          return fullName.includes('faisal') && fullName.includes('farooq');
        });
        if (faisalMatch) {
          setPaymentFinAuth((prev) => ({
            ...prev,
            financeControllerUser: prev.financeControllerUser || faisalMatch
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setFinanceAuthorityCandidates([]);
      });
    fetchPayFromAccounts(api, { companyId: effectivePayingCompanyId })
      .then((list) => {
        if (!cancelled) setBankAccounts(list);
      })
      .catch(() => {
        if (!cancelled) setBankAccounts([]);
      });
    return () => { cancelled = true; };
  }, [paymentDialogOpen, effectivePayingCompanyId]);

  const pendingRecords = useMemo(
    () => (detail?.records || []).filter((r) =>
      r.workflowStatus === 'Pending Finance'
    ),
    [detail]
  );

  const draftPayment = detail?.draftPayment || null;
  const pendingPayment = detail?.pendingPayment || null;

  const applyDraftToPaymentForm = (draft) => {
    const meta = draft?.paymentMeta || {};
    const paymentDate = meta.paymentDate
      ? new Date(meta.paymentDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];
    setPaymentFinAuth({ financeControllerUser: null });
    setPaymentData({
      amount: Math.round(Number(draft?.amount) || 0),
      grossAmount: Math.round(Number(meta.grossSalary) || 0),
      paymentMethod: meta.paymentMethod || 'bank_transfer',
      reference: meta.reference || '',
      narration: meta.narration || '',
      paymentDate,
      bankAccountId: meta.bankAccountId ? String(meta.bankAccountId) : ''
    });
    setActiveDraftId(draft?._id || null);
    if (draft?.companyId) setPayingCompanyId(String(draft.companyId));
  };

  const openPaymentDialog = (draft = draftPayment) => {
    if (!detail?.summary) return;
    if (draft) {
      applyDraftToPaymentForm(draft);
      setPaymentDialogOpen(true);
      return;
    }
    if (!pendingRecords.length) return;
    const pendingAmount = pendingRecords.reduce((s, r) => s + Math.round(Number(r.netPayable) || 0), 0);
    const pendingGross = pendingRecords.reduce((s, r) => s + Math.round(Number(r.grossSalary) || 0), 0);
    setPaymentFinAuth({ financeControllerUser: null });
    setPaymentData({
      amount: pendingAmount,
      grossAmount: pendingGross,
      paymentMethod: 'bank_transfer',
      reference: selected ? `MSAL-${selected.month}-${selected.year}` : '',
      narration: selected?.periodLabel ? `Manual salary payment — ${selected.periodLabel}` : '',
      paymentDate: new Date().toISOString().split('T')[0],
      bankAccountId: ''
    });
    setActiveDraftId(null);
    setPayingCompanyId(selectedCompanyId || '');
    setPaymentDialogOpen(true);
  };

  const buildPaymentPayload = () => {
    const company = financeCompanies.find((c) => String(c._id) === String(effectivePayingCompanyId));
    return {
      paymentMethod: paymentData.paymentMethod,
      reference: paymentData.reference,
      narration: paymentData.narration,
      paymentDate: paymentData.paymentDate,
      bankAccountId: paymentData.bankAccountId || null,
      companyId: effectivePayingCompanyId || null,
      payingCompanyId: effectivePayingCompanyId || null,
      companyName: company?.name || '',
      draftId: activeDraftId || null
    };
  };

  const handleSaveDraft = async () => {
    if (!selected) return;
    try {
      setProcessingPayment(true);
      const res = await api.post(
        `/finance/manual-salary-queue/${selected.month}/${selected.year}/save-draft`,
        buildPaymentPayload()
      );
      const draftId = res.data?.data?.application?._id;
      if (draftId) setActiveDraftId(draftId);
      notify(res.data?.message || 'Manual salary payment draft saved');
      await Promise.all([loadQueue(), loadDetail(selected.month, selected.year)]);
    } catch (err) {
      notify(err.response?.data?.message || 'Failed to save manual salary payment draft', 'error');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleMakePayment = async () => {
    if (!selected) return;
    if (!activeDraftId) {
      notify('Save a draft first, then submit for GM Finance approval.', 'warning');
      return;
    }
    if (!paymentFinAuth.financeControllerUser) {
      notify('Select GM Finance before submitting.', 'warning');
      return;
    }
    const financeControllerUser =
      paymentFinAuth.financeControllerUser?._id || paymentFinAuth.financeControllerUser;

    try {
      setProcessingPayment(true);
      await api.post(
        `/finance/manual-salary-queue/${selected.month}/${selected.year}/save-draft`,
        buildPaymentPayload()
      );
      const res = await api.post(`/finance/manual-salary-payments/${activeDraftId}/submit`, {
        ...buildPaymentPayload(),
        financeControllerUser
      });
      setPaymentDialogOpen(false);
      setActiveDraftId(null);
      notify(res.data?.message || 'Manual salary payment submitted for GM Finance approval');
      await Promise.all([loadQueue(), loadDetail(selected.month, selected.year)]);
    } catch (err) {
      notify(err.response?.data?.message || 'Failed to submit manual salary payment', 'error');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleDeleteDraft = async () => {
    const draftId = activeDraftId || draftPayment?._id;
    if (!draftId) return;
    if (!window.confirm('Delete this draft manual salary payment and its BPV draft? This cannot be undone.')) return;

    try {
      setProcessingPayment(true);
      await api.delete(`/finance/manual-salary-payments/${draftId}`);
      setPaymentDialogOpen(false);
      setActiveDraftId(null);
      notify('Draft manual salary payment deleted');
      if (selected) {
        await Promise.all([loadQueue(), loadDetail(selected.month, selected.year)]);
      }
    } catch (err) {
      notify(err.response?.data?.message || 'Failed to delete draft payment', 'error');
    } finally {
      setProcessingPayment(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          CEO-approved manual salary sheets — same payment flow as Monthly Payroll (Save Draft BPV → Submit for GM Finance).
        </Typography>
        <Button startIcon={<RefreshIcon />} onClick={loadQueue} disabled={loading} size="small">
          Refresh
        </Button>
      </Stack>

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Paper sx={{ mb: 3 }}>
        {loading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Period</TableCell>
                  <TableCell align="right">Records</TableCell>
                  <TableCell align="right">Pending Amount</TableCell>
                  <TableCell>Finance Status</TableCell>
                  <TableCell align="right">Pending</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {queue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      No CEO-approved manual salary periods in finance queue.
                    </TableCell>
                  </TableRow>
                ) : queue.map((row) => (
                  <TableRow
                    key={`msal-${row.month}-${row.year}`}
                    hover
                    selected={selected?.month === row.month && selected?.year === row.year}
                  >
                    <TableCell>{row.periodLabel}</TableCell>
                    <TableCell align="right">{row.totalRecords}</TableCell>
                    <TableCell align="right">{fmt(row.pendingAmount || row.paymentPendingAmount)}</TableCell>
                    <TableCell>{statusChip(row.status)}</TableCell>
                    <TableCell align="right">{row.pendingFinance + row.paymentPending}</TableCell>
                    <TableCell align="right">{row.paid}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => loadDetail(row.month, row.year)}>Open</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {selected ? (
        <Paper sx={{ p: 2 }}>
          {detailLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : detail ? (
            <>
              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6">{detail.periodLabel} — Manual Salary</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {detail.summary.employeeCount} employees
                    {' · '}Net {fmt(detail.summary.totalNetPayable)}
                    {' · '}Pending payment {fmt(detail.summary.pendingNetPayable)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  {draftPayment ? (
                    <Button
                      variant="outlined"
                      startIcon={<PaymentsIcon />}
                      disabled={processingPayment}
                      onClick={() => openPaymentDialog(draftPayment)}
                    >
                      Continue Draft BPV
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={<PaymentsIcon />}
                      disabled={!pendingRecords.length || processingPayment || Boolean(pendingPayment)}
                      onClick={() => openPaymentDialog()}
                    >
                      New Payment ({pendingRecords.length})
                    </Button>
                  )}
                </Stack>
              </Stack>

              {draftPayment ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Draft BPV saved
                  {draftPayment.journalEntryId?.entryNumber ? ` (${draftPayment.journalEntryId.entryNumber})` : ''}.
                  {' '}Review and submit for GM Finance approval when ready.
                  {draftPayment.journalEntryId?._id || draftPayment.journalEntryId ? (
                    <>
                      {' '}
                      <Button
                        component={RouterLink}
                        to={`/finance/vouchers/${draftPayment.journalEntryId?._id || draftPayment.journalEntryId}`}
                        size="small"
                        startIcon={<VisibilityIcon />}
                      >
                        Open Draft BPV
                      </Button>
                    </>
                  ) : null}
                </Alert>
              ) : null}

              {pendingPayment ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Payment pending GM Finance approval on the BPV.
                  {pendingPayment.journalEntryId?._id || pendingPayment.journalEntryId ? (
                    <>
                      {' '}
                      <Button
                        component={RouterLink}
                        to={`/finance/vouchers/${pendingPayment.journalEntryId?._id || pendingPayment.journalEntryId}`}
                        size="small"
                        startIcon={<VisibilityIcon />}
                      >
                        Open BPV {pendingPayment.journalEntryId?.entryNumber || ''}
                      </Button>
                    </>
                  ) : null}
                </Alert>
              ) : null}

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Emp ID</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Designation</TableCell>
                      <TableCell>Project</TableCell>
                      <TableCell align="right">Gross</TableCell>
                      <TableCell align="right">Tax</TableCell>
                      <TableCell align="right">Net Payable</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail.records || []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} align="center">No records for this period.</TableCell>
                      </TableRow>
                    ) : detail.records.map((row) => (
                      <TableRow key={row._id}>
                        <TableCell>{row.empId || '—'}</TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>{row.designation || '—'}</TableCell>
                        <TableCell>{row.project || '—'}</TableCell>
                        <TableCell align="right">{fmt(row.grossSalary)}</TableCell>
                        <TableCell align="right">{fmt(row.incomeTax)}</TableCell>
                        <TableCell align="right">{fmt(row.netPayable)}</TableCell>
                        <TableCell>{recordStatusChip(row.workflowStatus)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : null}
        </Paper>
      ) : null}

      <Dialog
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {activeDraftId ? 'Draft Manual Salary Payment' : 'New Manual Salary Payment'} — {selected?.periodLabel || ''}
          <Typography variant="body2" color="text.secondary">
            Step 1: Save draft BPV · Step 2: Submit for GM Finance approval
            {' · '}Gross: {fmt(paymentData.grossAmount || 0)} · Net bank: {fmt(paymentData.amount || 0)}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Period payment</Typography>
                <Typography fontWeight={700}>{selected?.periodLabel}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {pendingRecords.length || paymentData.amount ? `${pendingRecords.length || '—'} employees pending payment` : '—'}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Finance approval authorities
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  Sr Manager Accounts: <strong>{SR_MANAGER_ACCOUNTS_NAME}</strong> — auto-approved when you submit the draft.
                  {' '}GM Finance approves on the BPV voucher after submission.
                </Typography>
                <Autocomplete
                  disabled={processingPayment}
                  options={financeAuthorityCandidates}
                  value={paymentFinAuth.financeControllerUser || null}
                  onChange={(_, value) => setPaymentFinAuth({ financeControllerUser: value })}
                  getOptionLabel={userOptionLabel}
                  isOptionEqualToValue={(a, b) => String(a?._id || a?.id) === String(b?._id || b?.id)}
                  renderOption={(props, option) => (
                    <li {...props} key={option._id || option.id}>
                      <Typography variant="body2">{userOptionLabel(option)}</Typography>
                      {userOptionSecondary(option) ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {userOptionSecondary(option)}
                        </Typography>
                      ) : null}
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} label="GM Finance *" size="small" required />
                  )}
                />
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Payment details</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Gross Salary (BPV debit)"
                type="number"
                value={paymentData.grossAmount}
                InputProps={{ readOnly: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Net Bank Payment (PKR)"
                type="number"
                value={paymentData.amount}
                InputProps={{ readOnly: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Paying Company</InputLabel>
                <Select
                  value={payingCompanyId}
                  label="Paying Company"
                  onChange={(e) => setPayingCompanyId(e.target.value)}
                >
                  <MenuItem value=""><em>— Default (context) —</em></MenuItem>
                  {financeCompanies.map((c) => (
                    <MenuItem key={c._id} value={c._id}>{c.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={paymentData.paymentMethod}
                  label="Payment Method"
                  onChange={(e) => setPaymentData((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                >
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="check">Check / Cheque</MenuItem>
                  <MenuItem value="cash">Cash</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Pay From Account</InputLabel>
                <Select
                  value={paymentData.bankAccountId || ''}
                  label="Pay From Account"
                  onChange={(e) => setPaymentData((prev) => ({ ...prev, bankAccountId: e.target.value }))}
                >
                  <MenuItem value="">— Auto (default bank) —</MenuItem>
                  {bankAccounts.map((item) => {
                    const account = item?.account || item;
                    const depth = item?.depth || 0;
                    return (
                      <MenuItem key={account._id} value={account._id}>
                        {formatPayFromAccountLabel(account, depth)}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Payment Date"
                type="date"
                value={paymentData.paymentDate}
                onChange={(e) => setPaymentData((prev) => ({ ...prev, paymentDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Reference / Cheque # / TT #"
                value={paymentData.reference}
                onChange={(e) => setPaymentData((prev) => ({ ...prev, reference: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Narration"
                value={paymentData.narration}
                onChange={(e) => setPaymentData((prev) => ({ ...prev, narration: e.target.value }))}
                placeholder="Shown on every line of the BPV voucher"
                multiline
                minRows={2}
                inputProps={{ maxLength: 500 }}
                helperText="Optional. When filled, this replaces the line narrations on the printed BPV."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {activeDraftId ? (
              <Button
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleDeleteDraft}
                disabled={processingPayment}
              >
                Delete Draft
              </Button>
            ) : null}
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button
              variant="outlined"
              onClick={handleSaveDraft}
              disabled={processingPayment}
            >
              {processingPayment ? 'Saving…' : activeDraftId ? 'Update Draft' : 'Save Draft BPV'}
            </Button>
            <Button
              variant="contained"
              color="success"
              onClick={handleMakePayment}
              disabled={processingPayment || !activeDraftId}
            >
              {processingPayment ? 'Processing…' : 'Create BPV & Submit'}
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
