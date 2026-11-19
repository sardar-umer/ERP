import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import {
  Payment as PaymentIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon,
  Undo as ReturnIcon,
  Block as RejectIcon,
  OpenInNew as OpenIcon
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import { fetchPayFromAccounts, formatPayFromAccountLabel } from '../../utils/payFromAccounts';

// Same number / date formats as the Receive Payment screen
const formatPKR = (amount) => {
  const n = Number(amount) || 0;
  return `PKR ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatDate = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatMonth = (date) => (date
  ? new Date(date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  : '—');
const toInputDate = (date) => {
  const d = date ? new Date(date) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0];
};

const TABS = [
  { value: 'Pending Finance', label: 'Pending' },
  { value: 'Posted', label: 'Posted' },
  { value: 'Returned', label: 'Returned to HR' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'all', label: 'All' }
];

const STATUS_COLORS = {
  'Pending Finance': 'warning',
  Posting: 'warning',
  Posted: 'success',
  Returned: 'error',
  Rejected: 'error',
  Cancelled: 'default',
  Reversed: 'default'
};

const PAYMENT_METHODS = [
  { value: 'Bank Transfer', label: 'Bank Transfer / Online' },
  { value: 'Cheque', label: 'Cheque / TT' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Direct Payment', label: 'Other' }
];

const personName = (p) => [p?.firstName, p?.lastName].filter(Boolean).join(' ') || '—';
const modeLabel = (m) => (m === 'reduce_installment' ? 'Keep months, lower installment' : 'Keep installment, fewer months');

const emptyForm = () => ({
  paymentDate: toInputDate(),
  paymentMethod: 'Cash',
  bankAccountId: '',
  costCenter: '',
  reference: '',
  narration: '',
  comments: ''
});

const SummaryBox = ({ label, value, color = 'text.primary', bg = 'grey.50' }) => (
  <Paper variant="outlined" sx={{ p: 1.2, px: 2, bgcolor: bg, minWidth: 150 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="subtitle1" fontWeight={700} color={color}>{value}</Typography>
  </Paper>
);

const LoanReceipts = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { companies } = useFinanceCompany();
  const [tab, setTab] = useState('Pending Finance');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [acting, setActing] = useState('');
  const [decision, setDecision] = useState(null); // 'return' | 'reject' while asking for a comment
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/finance/loan-receipts', { params: { status: tab } });
      setRows(res.data?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load loan receipts');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useFinanceCompanyReload(load, { skipInitial: true });

  // /finance/loan-receipts?open=<id> (link from Finance → Approvals) opens that receipt straight away
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId) return;
    openDetail({ _id: openId });
    searchParams.delete('open');
    setSearchParams(searchParams, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = async (row) => {
    setOpen(true);
    setDetail(null);
    setDecision(null);
    setDialogError('');
    setBankAccounts([]);
    setCostCenters([]);
    setForm({
      ...emptyForm(),
      paymentDate: toInputDate(row.paymentDate),
      paymentMethod: row.paymentMethod || 'Cash',
      reference: row.reference || ''
    });
    setDetailLoading(true);
    try {
      const res = await api.get(`/finance/loan-receipts/${row._id}`);
      const data = res.data?.data;
      setDetail(data);
      // Opened from Finance → Approvals with only an id: fill the form from the loaded request
      if (data?.request) {
        setForm((f) => ({
          ...f,
          paymentDate: toInputDate(data.request.paymentDate),
          paymentMethod: data.request.paymentMethod || f.paymentMethod,
          reference: data.request.reference || f.reference
        }));
      }
      if (data?.request?.status === 'Pending Finance' && data.companyId) {
        fetchPayFromAccounts(api, { companyId: data.companyId }).then(setBankAccounts).catch(() => setBankAccounts([]));
        api.get('/finance/cost-centers', { params: { companyId: data.companyId } })
          .then((r) => setCostCenters(r.data?.data || []))
          .catch(() => setCostCenters([]));
      }
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Failed to load request');
      setDetail({ request: row });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    if (acting) return;
    setOpen(false);
    setDetail(null);
  };

  const req = detail?.request;
  const isPending = req?.status === 'Pending Finance';
  const preview = isPending ? detail?.currentPreview : req?.postingResult;
  const full = preview?.paymentType === 'Full Settlement';
  const companyName = companies.find((c) => String(c._id) === String(detail?.companyId))?.name
    || (detail?.companyId ? 'Employee company' : '—');

  const postReceipt = async () => {
    setActing('post');
    setDialogError('');
    try {
      const res = await api.post(`/finance/loan-receipts/${req._id}/post`, {
        bankAccountId: form.bankAccountId || undefined,
        date: form.paymentDate,
        paymentMethod: form.paymentMethod,
        reference: form.reference,
        costCenter: form.costCenter || undefined,
        narration: form.narration.trim() || undefined,
        comments: form.comments.trim() || undefined
      });
      toast.success(res.data?.message || 'Receipt posted');
      setOpen(false);
      setDetail(null);
      load();
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Failed to post receipt');
    } finally {
      setActing('');
    }
  };

  const sendDecision = async () => {
    if (!form.comments.trim()) {
      setDialogError('Please write a comment for HR.');
      return;
    }
    setActing(decision);
    setDialogError('');
    try {
      const res = await api.post(`/finance/loan-receipts/${req._id}/${decision}`, { comments: form.comments.trim() });
      toast.success(res.data?.message || 'Done');
      setOpen(false);
      setDetail(null);
      load();
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Action failed');
    } finally {
      setActing('');
    }
  };

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Box sx={{ p: { xs: 1, md: 3 } }}>
      <FinanceCompanyPageHeader title="Employee Loan Receipts" icon={PaymentIcon}>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refresh
        </Button>
      </FinanceCompanyPageHeader>

      <Alert severity="info" sx={{ mb: 2 }}>
        Lump-sum loan payments sent by HR. Confirm the money arrived, then post the receipt voucher
        (Dr Cash / Bank, Cr Employee Loan). The employee&apos;s loan schedule updates when you post.
      </Alert>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper variant="outlined">
        <Box sx={{ bgcolor: 'grey.100' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
            {TABS.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
          </Tabs>
        </Box>
        {loading ? (
          <Box p={4} textAlign="center"><CircularProgress size={28} /></Box>
        ) : rows.length === 0 ? (
          <Box p={4} textAlign="center">
            <Typography color="text.secondary">No loan receipts here.</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                  <TableCell>Request #</TableCell>
                  <TableCell>Employee</TableCell>
                  <TableCell>Payment Date</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Method / Reference</TableCell>
                  <TableCell>Sent By</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Voucher</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r._id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{r.requestNumber}</TableCell>
                    <TableCell>
                      {personName(r.employee)}
                      <Typography variant="caption" display="block" color="text.secondary">
                        {r.employee?.employeeId}{r.loan?.loanType ? ` · ${r.loan.loanType} loan` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatDate(r.paymentDate)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatPKR(r.amount)}</TableCell>
                    <TableCell>{r.paymentMethod}{r.reference ? ` · ${r.reference}` : ''}</TableCell>
                    <TableCell>
                      {personName(r.requestedBy)}
                      <Typography variant="caption" display="block" color="text.secondary">{formatDate(r.requestedAt)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={r.status === 'Posting' ? 'Pending Finance' : r.status} color={STATUS_COLORS[r.status] || 'default'} />
                    </TableCell>
                    <TableCell>
                      {r.voucherNumber ? <Chip size="small" color="success" variant="outlined" label={r.voucherNumber} /> : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {r.status === 'Pending Finance' ? (
                        <Button size="small" variant="contained" color="success" startIcon={<PaymentIcon />} onClick={() => openDetail(r)}>
                          Receive
                        </Button>
                      ) : (
                        <Button size="small" onClick={() => openDetail(r)}>View</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={open} onClose={closeDetail} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ bgcolor: 'success.dark', color: 'white', py: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center" gap={1.5}>
              <PaymentIcon fontSize="medium" />
              <Typography variant="h6" fontWeight={700}>
                Receive Loan Payment{req ? ` — ${req.requestNumber}` : ''}
              </Typography>
            </Box>
            <IconButton onClick={closeDetail} size="small" sx={{ color: 'white' }}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>

        <DialogContent dividers sx={{ p: 2.5 }}>
          {detailLoading && <Box p={4} textAlign="center"><CircularProgress size={28} /></Box>}

          {!detailLoading && req && (
            <>
              {/* Top: employee + balance highlights */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={5}>
                  <Typography variant="caption" color="text.secondary">Employee</Typography>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {personName(req.employee)} ({req.employee?.employeeId || '—'})
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {detail?.loan ? `${detail.loan.loanType} loan of ${formatPKR(detail.loan.loanAmount)}` : ''}
                    {' · '}Sent by {personName(req.requestedBy)} on {formatDate(req.requestedAt)}
                  </Typography>
                  {detail?.loan && (
                    <Button size="small" sx={{ mt: 0.5, px: 0 }} endIcon={<OpenIcon fontSize="small" />} onClick={() => navigate(`/hr/loans/${detail.loan._id}`)}>
                      Open loan
                    </Button>
                  )}
                </Grid>
                <Grid item xs={12} md={7}>
                  <Stack direction="row" spacing={2} justifyContent={{ xs: 'flex-start', md: 'flex-end' }} flexWrap="wrap" useFlexGap>
                    <SummaryBox label="Loan Balance" value={formatPKR(preview?.before?.principal ?? detail?.loan?.outstandingBalance)} color="error.main" />
                    <SummaryBox label="Monthly Installment" value={formatPKR(preview?.before?.installment ?? detail?.loan?.monthlyInstallment)} />
                    <SummaryBox label="Installments Left" value={preview?.before?.remainingInstallments ?? '—'} />
                  </Stack>
                </Grid>
              </Grid>

              {req.remarks && (
                <Alert severity="info" sx={{ mb: 2 }}>HR remarks: {req.remarks}</Alert>
              )}
              {!isPending && req.voucherNumber && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  Posted as <strong>{req.voucherNumber}</strong> by {personName(req.processedBy)} on {formatDate(req.processedAt)}.
                </Alert>
              )}
              {!isPending && req.financeComments && (
                <Alert severity="warning" sx={{ mb: 2 }}>Finance comments: {req.financeComments}</Alert>
              )}
              {isPending && detail?.previewError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {detail.previewError}. The loan has changed since HR sent this — return it to HR.
                </Alert>
              )}

              {/* Effect on the loan */}
              {preview && (
                <Paper variant="outlined" sx={{ mb: 2.5 }}>
                  <Box sx={{ p: 1.5, bgcolor: 'grey.100' }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Effect on Loan — {modeLabel(req.mode)}
                    </Typography>
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ '& th': { fontWeight: 700 } }}>
                          <TableCell />
                          <TableCell align="right">Before</TableCell>
                          <TableCell align="right">After</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell>Loan Balance</TableCell>
                          <TableCell align="right">{formatPKR(preview.before.principal)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{formatPKR(preview.after.principal)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Monthly Installment</TableCell>
                          <TableCell align="right">{formatPKR(preview.before.installment)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{full ? '—' : formatPKR(preview.after.installment)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Installments Left</TableCell>
                          <TableCell align="right">{preview.before.remainingInstallments}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {preview.after.remainingInstallments}{full ? ' (loan closes)' : ''}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Last Installment</TableCell>
                          <TableCell align="right">—</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{formatMonth(preview.after.lastDueDate)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              )}
              {isPending && (detail?.currentPreview?.warnings || []).map((w, i) => (
                <Alert key={i} severity="warning" sx={{ mb: 2 }}>{w}</Alert>
              ))}

              {/* Payment & Bank Details — same fields/order as Receive Payment */}
              {isPending && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                    Payment &amp; Bank Details
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        fullWidth size="small" type="date" label="Payment Date"
                        value={form.paymentDate}
                        onChange={setField('paymentDate')}
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField fullWidth size="small" label="Paying Company" value={companyName} InputProps={{ readOnly: true }} />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Payment Method</InputLabel>
                        <Select value={form.paymentMethod} label="Payment Method" onChange={setField('paymentMethod')}>
                          {PAYMENT_METHODS.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Receive-In Account</InputLabel>
                        <Select value={form.bankAccountId} label="Receive-In Account" onChange={setField('bankAccountId')}>
                          <MenuItem value="">
                            {form.paymentMethod === 'Cash' ? '-- Default Cash Account --' : '-- Default Bank Account --'}
                          </MenuItem>
                          {bankAccounts.map((item) => {
                            const acc = item?.account || item;
                            return (
                              <MenuItem key={acc._id} value={acc._id}>
                                {formatPayFromAccountLabel(acc, item?.depth || 0)}
                              </MenuItem>
                            );
                          })}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Cost Center</InputLabel>
                        <Select value={form.costCenter} label="Cost Center" onChange={setField('costCenter')}>
                          <MenuItem value="">-- None --</MenuItem>
                          {costCenters.filter((cc) => cc.isActive).map((cc) => (
                            <MenuItem key={cc._id} value={cc._id}>{cc.name}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth size="small" label="Cheque # / TT # / Transaction Reference"
                        value={form.reference}
                        onChange={setField('reference')}
                        placeholder="e.g. CHQ-991204"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth size="small" label="Narration / Description"
                        value={form.narration}
                        onChange={setField('narration')}
                        placeholder="Leave blank for: Employee Loan — lump sum recovery from …"
                      />
                    </Grid>
                    {decision && (
                      <Grid item xs={12}>
                        <TextField
                          fullWidth size="small" autoFocus multiline minRows={2}
                          label={decision === 'return' ? 'Reason for returning to HR *' : 'Reason for rejecting *'}
                          value={form.comments}
                          onChange={setField('comments')}
                          inputProps={{ maxLength: 500 }}
                        />
                      </Grid>
                    )}
                  </Grid>
                </Paper>
              )}

              {/* Summary banner */}
              {preview && (
                <Paper sx={{ p: 2, bgcolor: 'success.50', borderRadius: 2 }}>
                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={4}>
                      <Typography variant="body2" color="text.secondary">Amount to Receive:</Typography>
                      <Typography variant="h6" fontWeight={800} color="success.main">{formatPKR(req.amount)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="body2" color="text.secondary">Loan Balance After:</Typography>
                      <Typography variant="h6" fontWeight={800} color="success.dark">{formatPKR(preview.after.principal)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="body2" color="text.secondary">Installments Left After:</Typography>
                      <Typography variant="h6" fontWeight={700}>
                        {full ? 'Loan closes' : `${preview.after.remainingInstallments} × up to ${formatPKR(preview.after.installment)}`}
                      </Typography>
                    </Grid>
                  </Grid>
                </Paper>
              )}

              {(req.history || []).length > 0 && !isPending && (
                <Box mt={2}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>History</Typography>
                  {req.history.map((h, i) => (
                    <Typography key={i} variant="body2" color="text.secondary">
                      {formatDate(h.at)} — {h.action}{h.comments ? `: ${h.comments}` : ''}
                    </Typography>
                  ))}
                </Box>
              )}
            </>
          )}
          {dialogError && <Alert severity="error" sx={{ mt: 2 }}>{dialogError}</Alert>}
        </DialogContent>

        <DialogActions sx={{ p: 2, px: 3, justifyContent: 'space-between' }}>
          <Button onClick={decision ? () => { setDecision(null); setDialogError(''); } : closeDetail} disabled={Boolean(acting)}>
            {decision ? 'Back' : isPending ? 'Cancel' : 'Close'}
          </Button>
          {isPending && !decision && (
            <Stack direction="row" spacing={1}>
              <Button color="error" startIcon={<RejectIcon />} onClick={() => setDecision('reject')} disabled={Boolean(acting)}>
                Reject
              </Button>
              <Button color="warning" variant="outlined" startIcon={<ReturnIcon />} onClick={() => setDecision('return')} disabled={Boolean(acting)}>
                Return to HR
              </Button>
              <Button
                variant="contained"
                color="success"
                size="large"
                startIcon={<CheckCircleIcon />}
                onClick={postReceipt}
                disabled={Boolean(acting) || Boolean(detail?.previewError) || !detail?.currentPreview}
              >
                {acting === 'post' ? 'Posting Receipt…' : `Post Receipt (${formatPKR(req?.amount)})`}
              </Button>
            </Stack>
          )}
          {isPending && decision && (
            <Button
              variant="contained"
              color={decision === 'reject' ? 'error' : 'warning'}
              onClick={sendDecision}
              disabled={Boolean(acting)}
            >
              {acting ? 'Sending…' : decision === 'reject' ? 'Reject Request' : 'Return to HR'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LoanReceipts;
