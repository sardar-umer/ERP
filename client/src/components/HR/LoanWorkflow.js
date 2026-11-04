import React, { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, Grid, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography
} from '@mui/material';
import {
  CheckCircle as ApproveIcon,
  Undo as ReturnIcon,
  Send as ForwardIcon,
  Cancel as RejectIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { loanService } from '../../services/loanService';
import { formatPKR } from '../../utils/currency';
import LoanAttachments from './LoanAttachments';

/**
 * Employee loan approval chain (same as Final Settlement):
 * HR forwards → GM HR → AVP → CEO. The CEO's approval is final (loan → Approved); nothing goes to Finance.
 */

export const LOAN_WORKFLOW_COLORS = {
  Draft: 'default',
  'Pending HOD HR': 'warning',
  'Pending AVP': 'info',
  'Forwarded to CEO': 'secondary',
  'Approved by CEO': 'success',
  Returned: 'error',
  'Rejected by CEO': 'error'
};

export const loanWorkflowLabel = (l) => {
  const ws = l?.workflowStatus || 'Draft';
  return ws === 'Pending HOD HR' ? 'Pending GM HR' : ws === 'Draft' ? 'Not forwarded' : ws;
};
export const LOAN_IN_APPROVAL = ['Pending HOD HR', 'Pending AVP', 'Forwarded to CEO'];
export const canForwardLoan = (l) => l?.status === 'Pending' && !l?.isOngoingLoan
  && ['Draft', 'Returned', undefined, null, ''].includes(l?.workflowStatus);

const personName = (u) => (u && typeof u === 'object'
  ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || ''
  : '');
const userLabel = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '');

const approvalSteps = (l) => {
  const ws = l.workflowStatus || 'Draft';
  return [
    { label: 'Forwarded by HR', by: personName(l.forwardedBy), at: l.forwardedAt, done: Boolean(l.forwardedAt), current: ['Draft', 'Returned'].includes(ws) },
    { label: 'GM HR', by: personName(l.hodApprovedBy) || personName(l.assignedHod), at: l.hodApprovedAt, done: Boolean(l.hodApprovedAt), current: ws === 'Pending HOD HR', note: l.hodComments },
    { label: 'AVP', by: personName(l.avpApprovedBy) || personName(l.assignedAvp), at: l.avpApprovedAt, done: Boolean(l.avpApprovedAt), current: ws === 'Pending AVP', note: l.avpComments },
    {
      label: ws === 'Rejected by CEO' ? 'CEO (rejected)' : 'CEO — final approval',
      by: personName(l.ceoApprovedBy),
      at: l.ceoApprovedAt,
      done: ws === 'Approved by CEO',
      current: ws === 'Forwarded to CEO',
      note: l.ceoComments
    }
  ];
};

/** Forward dialog: choose the GM HR and AVP (defaults found like Manual Salary / Final Settlement). */
export const ForwardLoanDialog = ({ loan, onClose, onDone }) => {
  const [users, setUsers] = useState([]);
  const [hod, setHod] = useState('');
  const [avp, setAvp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loan) return;
    setError('');
    api.get('/auth/users', { params: { limit: 1000, active: true, dropdown: true } })
      .then((res) => {
        const list = res.data.data?.users || (Array.isArray(res.data.data) ? res.data.data : []);
        setUsers(list);
        const idOf = (u) => (u ? u.id || u._id : '');
        const gmHr = list.find((u) => String(u.department || '').toLowerCase() === 'human resource'
          && String(u.position || '').toLowerCase() === 'general manager');
        const avpUser = list.find((u) => {
          const full = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
          return String(u.position || '').toLowerCase() === 'assistant vice president' || (full.includes('fahad') && full.includes('farid'));
        });
        setHod(loan.assignedHod?._id || loan.assignedHod || idOf(gmHr));
        setAvp(loan.assignedAvp?._id || loan.assignedAvp || idOf(avpUser));
      })
      .catch(() => setError('Could not load users'));
  }, [loan]);

  const submit = async () => {
    if (!hod || !avp) { setError('Select both the GM HR and the AVP'); return; }
    try {
      setSaving(true);
      const res = await loanService.forwardLoan(loan._id, { assignedHod: hod, assignedAvp: avp });
      onDone(res.message || 'Loan forwarded');
    } catch (e) {
      setError(e.message || 'Could not forward the loan');
    } finally {
      setSaving(false);
    }
  };

  const emp = loan?.employee || {};
  return (
    <Dialog open={Boolean(loan)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Forward loan for approval — {[emp.firstName, emp.lastName].filter(Boolean).join(' ')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Approval: GM HR → AVP → CEO. The CEO&apos;s approval is final — then the loan can be disbursed.
          Loan amount: <strong>{formatPKR(loan?.loanAmount || 0)}</strong>
        </Typography>
        {loan?.workflowStatus === 'Returned' && loan?.returnComments ? (
          <Paper variant="outlined" sx={{ p: 1.25, mb: 2, borderLeft: 4, borderLeftColor: 'error.main' }}>
            <Typography variant="body2" fontWeight={700} color="error.main">Returned</Typography>
            <Typography variant="body2">{loan.returnComments}</Typography>
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

/** Approval dialog: loan figures + approval trail, with Approve / Return (and CEO Reject) when it is the user's turn. */
export const LoanApprovalDialog = ({ loan, onClose, onDone }) => {
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setComments(''); setError(''); }, [loan]);
  if (!loan) return null;

  const l = loan;
  const emp = l.employee || {};
  const role = l.myWorkflowRole;
  const roleLabel = role === 'HOD' ? 'GM HR' : role;
  const act = async (action) => {
    if (action !== 'approve' && !comments.trim()) { setError(`Write comments to ${action} the loan`); return; }
    try {
      setBusy(action);
      const res = await loanService.workflowAction(l._id, action, comments);
      onDone(res.message || 'Done');
    } catch (e) {
      setError(e.message || 'Action failed');
    } finally {
      setBusy('');
    }
  };

  const figures = [
    ['Loan Amount', formatPKR(l.loanAmount || 0)],
    ['Term', `${l.loanTerm || 0} months`],
    ['Monthly EMI', formatPKR(l.monthlyInstallment || 0)],
    ['Total Payable', formatPKR(l.totalPayable || 0)]
  ];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
        <Box>
          <Typography variant="h6" component="div">{[emp.firstName, emp.lastName].filter(Boolean).join(' ') || 'Employee'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {[emp.employeeId, `${l.loanType || ''} loan`, l.interestRate ? `${l.interestRate}% interest` : 'No interest'].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Chip label={loanWorkflowLabel(l)} color={LOAN_WORKFLOW_COLORS[l.workflowStatus || 'Draft']} />
          <Chip label={l.status} variant="outlined" />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          {figures.map(([label, v]) => (
            <Grid item xs={6} md={3} key={label}>
              <Paper variant="outlined" sx={{ p: 1.25, bgcolor: label === 'Loan Amount' ? '#fffde7' : undefined }}>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography variant="body1" fontWeight={label === 'Loan Amount' ? 700 : 600}>{v}</Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
        {l.purpose ? <Typography variant="body2" color="text.secondary">Purpose: {l.purpose}</Typography> : null}
        {l.guarantor?.name ? <Typography variant="body2" color="text.secondary">Guarantor: {l.guarantor.name}</Typography> : null}

        <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>Attachments</Typography>
        <LoanAttachments documents={l.documents || []} />

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Approval trail</Typography>
        <Stack spacing={1}>
          {approvalSteps(l).map((st) => (
            <Paper key={st.label} variant="outlined"
              sx={{ p: 1.25, borderLeft: 4, borderLeftColor: st.done ? 'success.main' : st.current ? 'warning.main' : 'grey.300' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Typography variant="body2" fontWeight={700}>{st.label}</Typography>
                <Chip size="small" label={st.done ? 'Done' : st.current ? 'Waiting' : 'Not yet'}
                  color={st.done ? 'success' : st.current ? 'warning' : 'default'} variant={st.done ? 'filled' : 'outlined'} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {[st.by, st.at ? fmtDateTime(st.at) : ''].filter(Boolean).join(' · ') || '—'}
              </Typography>
              {st.note ? <Typography variant="body2" sx={{ mt: 0.5 }}>“{st.note}”</Typography> : null}
            </Paper>
          ))}
        </Stack>
        {l.workflowStatus === 'Returned' && l.returnComments ? (
          <Paper variant="outlined" sx={{ p: 1.25, mt: 1.5, borderLeft: 4, borderLeftColor: 'error.main' }}>
            <Typography variant="body2" fontWeight={700} color="error.main">
              Returned{l.returnedBy ? ` by ${personName(l.returnedBy)}` : ''}{l.returnedAt ? ` · ${fmtDateTime(l.returnedAt)}` : ''}
            </Typography>
            <Typography variant="body2">{l.returnComments}</Typography>
          </Paper>
        ) : null}

        {role ? (
          <TextField fullWidth multiline minRows={2} label={`Comments (${roleLabel})`} value={comments}
            onChange={(e) => setComments(e.target.value)} sx={{ mt: 2 }}
            helperText={role === 'CEO' ? 'Required when returning or rejecting' : 'Required when returning'} />
        ) : null}
        {error ? <Typography color="error" variant="body2" sx={{ mt: 1 }}>{error}</Typography> : null}
      </DialogContent>
      <DialogActions>
        {role ? (
          <>
            {role === 'CEO' && (
              <Button color="error" startIcon={busy === 'reject' ? <CircularProgress size={16} /> : <RejectIcon />} disabled={!!busy} onClick={() => act('reject')}>
                Reject
              </Button>
            )}
            <Button color="warning" startIcon={busy === 'return' ? <CircularProgress size={16} /> : <ReturnIcon />} disabled={!!busy} onClick={() => act('return')}>
              Return to HR
            </Button>
            <Button variant="contained" color="success" startIcon={busy === 'approve' ? <CircularProgress size={16} /> : <ApproveIcon />} disabled={!!busy} onClick={() => act('approve')}>
              {role === 'CEO' ? 'Final Approve (CEO)' : `Approve as ${roleLabel}`}
            </Button>
          </>
        ) : null}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
