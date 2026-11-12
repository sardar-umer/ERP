import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import {
  CheckCircle as ApproveIcon,
  Undo as ReturnIcon,
  Send as ForwardIcon
} from '@mui/icons-material';
import api from '../../services/api';
import finalSettlementService from '../../services/finalSettlementService';
import { formatPKR } from '../../utils/currency';
import LoanAttachments from './LoanAttachments';

/**
 * Final settlement approval workflow (same as Manual Salary):
 * HR forwards → GM HR → AVP → CEO → Finance (paid from Payables) → Paid.
 */

export const WORKFLOW_COLORS = {
  Draft: 'default',
  'Pending HOD HR': 'warning',
  'Pending AVP': 'info',
  'Forwarded to CEO': 'secondary',
  'Approved by CEO': 'success',
  'Pending Finance': 'primary',
  Paid: 'success',
  Returned: 'error',
  'Rejected by CEO': 'error'
};

export const workflowLabel = (s) => (s?.workflowStatus === 'Pending HOD HR' ? 'Pending GM HR' : (s?.workflowStatus || 'Draft'));
export const IN_APPROVAL = ['Pending HOD HR', 'Pending AVP', 'Forwarded to CEO'];
/** CEO-approved but not yet in Finance (e.g. the hand-off failed or the Finance bill was voided) */
export const canSendToFinance = (s) => s?.status === 'approved' && s?.workflowStatus === 'Approved by CEO' && !s?.financeApBillId;
export const inFinance = (s) => Boolean(s?.financeApBillId) || ['Pending Finance', 'Paid'].includes(s?.workflowStatus);
export const canForward = (s) => s?.status === 'pending' && ['Draft', 'Returned', 'Rejected by CEO'].includes(s?.workflowStatus || 'Draft');

const personName = (u) => (u && typeof u === 'object'
  ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || ''
  : '');
const userLabel = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '');

const approvalSteps = (s) => {
  const ws = s.workflowStatus || 'Draft';
  return [
    { label: 'Forwarded by HR', by: personName(s.forwardedBy), at: s.forwardedAt, done: Boolean(s.forwardedAt), current: ['Draft', 'Returned', 'Rejected by CEO'].includes(ws) },
    { label: 'GM HR', by: personName(s.hodApprovedBy) || personName(s.assignedHod), at: s.hodApprovedAt, done: Boolean(s.hodApprovedAt), current: ws === 'Pending HOD HR', note: s.hodComments },
    { label: 'AVP', by: personName(s.avpApprovedBy) || personName(s.assignedAvp), at: s.avpApprovedAt, done: Boolean(s.avpApprovedAt), current: ws === 'Pending AVP', note: s.avpComments },
    { label: 'CEO', by: personName(s.ceoApprovedBy), at: s.ceoApprovedAt, done: Boolean(s.ceoApprovedAt), current: ws === 'Forwarded to CEO', note: s.ceoComments },
    {
      label: 'Finance',
      by: s.financeApBillNumber ? `Bill ${s.financeApBillNumber}${s.companyName ? ` · ${s.companyName}` : ''}` : '',
      at: s.financePostedAt,
      done: Boolean(s.financeApBillId) || s.status === 'paid',
      current: s.status === 'approved' && !s.financeApBillId,
      note: !s.financeApBillId && s.financePostError ? s.financePostError : ''
    },
    { label: 'Paid', by: '', at: s.paidAt, done: s.status === 'paid', current: s.workflowStatus === 'Pending Finance' }
  ];
};

/** Forward dialog: choose the GM HR and AVP (defaults found like Manual Salary). */
export const ForwardSettlementDialog = ({ settlement, onClose, onDone }) => {
  const [users, setUsers] = useState([]);
  const [hod, setHod] = useState('');
  const [avp, setAvp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!settlement) return;
    setError('');
    api.get('/auth/users', { params: { limit: 1000, active: true, dropdown: true } })
      .then((res) => {
        const list = res.data.data?.users || (Array.isArray(res.data.data) ? res.data.data : []);
        setUsers(list);
        const idOf = (u) => (u ? u.id || u._id : '');
        const prevHod = settlement.assignedHod?._id || settlement.assignedHod;
        const prevAvp = settlement.assignedAvp?._id || settlement.assignedAvp;
        const gmHr = list.find((u) => String(u.department || '').toLowerCase() === 'human resource'
          && String(u.position || '').toLowerCase() === 'general manager');
        const avpUser = list.find((u) => {
          const full = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
          return String(u.position || '').toLowerCase() === 'assistant vice president' || (full.includes('fahad') && full.includes('farid'));
        });
        setHod(prevHod || idOf(gmHr));
        setAvp(prevAvp || idOf(avpUser));
      })
      .catch(() => setError('Could not load users'));
  }, [settlement]);

  const submit = async () => {
    if (!hod || !avp) { setError('Select both the GM HR and the AVP'); return; }
    try {
      setSaving(true);
      const res = await finalSettlementService.forwardSettlement(settlement._id, { assignedHod: hod, assignedAvp: avp });
      onDone(res.message || 'Settlement forwarded');
    } catch (e) {
      setError(e.response?.data?.message || 'Could not forward the settlement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(settlement)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Forward for approval — {settlement?.employeeName}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Approval: GM HR → AVP → CEO. After the CEO approves, it goes to Finance and is paid from Payables.
          Net settlement: <strong>{formatPKR(settlement?.netSettlementAmount || 0)}</strong>
        </Typography>
        {settlement?.returnComments && settlement?.workflowStatus === 'Returned' ? (
          <Paper variant="outlined" sx={{ p: 1.25, mb: 2, borderLeft: 4, borderLeftColor: 'error.main' }}>
            <Typography variant="body2" fontWeight={700} color="error.main">Returned</Typography>
            <Typography variant="body2">{settlement.returnComments}</Typography>
          </Paper>
        ) : null}
        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel>GM HR</InputLabel>
            <Select label="GM HR" value={hod} onChange={(e) => setHod(e.target.value)}>
              {users.map((u) => <MenuItem key={u.id || u._id} value={u.id || u._id}>{userLabel(u)}{u.position ? ` — ${u.position}` : ''}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>AVP</InputLabel>
            <Select label="AVP" value={avp} onChange={(e) => setAvp(e.target.value)}>
              {users.map((u) => <MenuItem key={u.id || u._id} value={u.id || u._id}>{userLabel(u)}{u.position ? ` — ${u.position}` : ''}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        {error ? <Typography color="error" variant="body2" sx={{ mt: 1.5 }}>{error}</Typography> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} /> : <ForwardIcon />} disabled={saving} onClick={submit}>
          Forward
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/** Process dialog: settlement figures + approval trail, with Approve / Return when it is the user's turn. */
export const SettlementProcessDialog = ({ settlement, onClose, onDone, onEdit }) => {
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setComments(''); setError(''); }, [settlement]);
  if (!settlement) return null;

  const s = settlement;
  const role = s.myWorkflowRole;
  const roleLabel = role === 'HOD' ? 'GM HR' : role;
  const act = async (action) => {
    if (action === 'return' && !comments.trim()) { setError('Write comments to return the settlement'); return; }
    try {
      setBusy(action);
      const res = await finalSettlementService.workflowAction(s._id, action, comments);
      onDone(res.message || 'Done');
    } catch (e) {
      setError(e.response?.data?.message || 'Action failed');
    } finally {
      setBusy('');
    }
  };

  const figures = [
    ['Gross Salary', s.grossSalary],
    ['Total Earnings', s.earnings?.totalEarnings ?? s.grossSettlementAmount],
    ['Total Deductions', s.deductions?.totalDeductions],
    ['Net Settlement', s.netSettlementAmount]
  ];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
        <Box>
          <Typography variant="h6" component="div">{s.employeeName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {[s.employeeId, s.designation, s.department].filter((x) => x && x !== 'Unknown').join(' · ')}
            {' · '}{finalSettlementService.getSettlementTypeLabel(s.settlementType)}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Chip label={workflowLabel(s)} color={WORKFLOW_COLORS[s.workflowStatus || 'Draft']} />
          <Chip label={finalSettlementService.getStatusLabel(s.status)} variant="outlined" />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          {figures.map(([label, v]) => (
            <Grid item xs={6} md={3} key={label}>
              <Paper variant="outlined" sx={{ p: 1.25, bgcolor: label === 'Net Settlement' ? '#fffde7' : undefined }}>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography variant="body1" fontWeight={label === 'Net Settlement' ? 700 : 600}>{formatPKR(v || 0)}</Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
        <Typography variant="body2" color="text.secondary">
          Last working date: {s.lastWorkingDate ? new Date(s.lastWorkingDate).toLocaleDateString('en-GB') : '—'}
          {' · '}Days served: {s.noticePeriodServed || 0}
          {s.reason ? ` · Reason: ${s.reason}` : ''}
        </Typography>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Approval trail</Typography>
        <Stack spacing={1}>
          {approvalSteps(s).map((st) => (
            <Paper
              key={st.label}
              variant="outlined"
              sx={{ p: 1.25, borderLeft: 4, borderLeftColor: st.done ? 'success.main' : st.current ? 'warning.main' : 'grey.300' }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Typography variant="body2" fontWeight={700}>{st.label}</Typography>
                <Chip
                  size="small"
                  label={st.done ? 'Done' : st.current ? 'Waiting' : 'Not yet'}
                  color={st.done ? 'success' : st.current ? 'warning' : 'default'}
                  variant={st.done ? 'filled' : 'outlined'}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {[st.by, st.at ? fmtDateTime(st.at) : ''].filter(Boolean).join(' · ') || '—'}
              </Typography>
              {st.note ? <Typography variant="body2" sx={{ mt: 0.5 }}>“{st.note}”</Typography> : null}
            </Paper>
          ))}
        </Stack>
        {(s.documents || []).length > 0 ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>Attachments ({s.documents.length})</Typography>
            <LoanAttachments documents={s.documents} dense />
          </Box>
        ) : null}
        {s.workflowStatus === 'Returned' && s.returnComments ? (
          <Paper variant="outlined" sx={{ p: 1.25, mt: 1.5, borderLeft: 4, borderLeftColor: 'error.main' }}>
            <Typography variant="body2" fontWeight={700} color="error.main">
              Returned{s.returnedBy ? ` by ${personName(s.returnedBy)}` : ''}{s.returnedAt ? ` · ${fmtDateTime(s.returnedAt)}` : ''}
            </Typography>
            <Typography variant="body2">{s.returnComments}</Typography>
          </Paper>
        ) : null}

        {role ? (
          <TextField
            fullWidth
            multiline
            minRows={2}
            label={`Comments (${roleLabel})`}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            sx={{ mt: 2 }}
            helperText="Required when returning"
          />
        ) : null}
        {error ? <Typography color="error" variant="body2" sx={{ mt: 1 }}>{error}</Typography> : null}
      </DialogContent>
      <DialogActions>
        {role ? (
          <>
            <Button color="error" startIcon={busy === 'return' ? <CircularProgress size={16} /> : <ReturnIcon />} disabled={!!busy} onClick={() => act('return')}>
              Return to HR
            </Button>
            <Button variant="contained" color="success" startIcon={busy === 'approve' ? <CircularProgress size={16} /> : <ApproveIcon />} disabled={!!busy} onClick={() => act('approve')}>
              Approve as {roleLabel}
            </Button>
          </>
        ) : null}
        {onEdit && s.status === 'pending' && !IN_APPROVAL.includes(s.workflowStatus) ? (
          <Button onClick={() => onEdit(s)}>Edit</Button>
        ) : null}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

/** Send a CEO-approved settlement to Finance → Payables; asks for the company when the settlement has none. */
export const SendToFinanceDialog = ({ settlement, onClose, onDone }) => {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!settlement) return;
    setError('');
    setCompanyId(settlement.companyId?._id || settlement.companyId || '');
    api.get('/hr/companies').then((res) => setCompanies(res.data?.data || [])).catch(() => setCompanies([]));
  }, [settlement]);

  const submit = async () => {
    if (!companyId) { setError('Select the company'); return; }
    try {
      setSaving(true);
      const res = await finalSettlementService.sendToFinance(settlement._id, companyId);
      onDone(res.message || 'Sent to Finance');
    } catch (e) {
      setError(e.response?.data?.message || 'Could not send to Finance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(settlement)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Send to Finance — {settlement?.employeeName}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Creates a bill payable to the employee for <strong>{formatPKR(settlement?.netSettlementAmount || 0)}</strong> under
          the selected company. Finance pays it from Payables — Bills, POs &amp; Cash Approvals.
        </Typography>
        {settlement?.financePostError ? (
          <Typography variant="body2" color="error" sx={{ mb: 2 }}>Last try: {settlement.financePostError}</Typography>
        ) : null}
        <FormControl fullWidth size="small" required>
          <InputLabel>Company</InputLabel>
          <Select label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <MenuItem key={c._id} value={c._id}>{c.name}</MenuItem>)}
          </Select>
        </FormControl>
        {error ? <Typography color="error" variant="body2" sx={{ mt: 1.5 }}>{error}</Typography> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} /> : <ForwardIcon />} disabled={saving} onClick={submit}>
          Send to Finance
        </Button>
      </DialogActions>
    </Dialog>
  );
};
