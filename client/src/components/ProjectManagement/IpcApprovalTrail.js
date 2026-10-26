import React from 'react';
import { Alert, Box, Chip, Paper, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import dayjs from 'dayjs';

/** Desks an IPC passes through, in order (same chain as Cash Approvals) */
export const IPC_STAGES = [
  { status: 'Draft', label: 'Project team' },
  { status: 'Pending Audit', label: 'Pre-Audit' },
  { status: 'Forwarded to Audit Director', label: 'Audit Director' },
  { status: 'Send to CEO Office', label: 'CEO Secretariat (PS)' },
  { status: 'Forwarded to CEO', label: 'CEO' },
  { status: 'Approved', label: 'Finance' }
];

export const IPC_APPROVAL_COLOR = {
  Draft: 'default',
  'Pending Audit': 'warning',
  'Forwarded to Audit Director': 'warning',
  'Send to CEO Office': 'info',
  'Forwarded to CEO': 'info',
  Rejected: 'error',
  Approved: 'success'
};

/** Short human label for where the IPC is now */
export const ipcStageText = (inv) => {
  const st = inv?.approvalStatus || 'Draft';
  if (st === 'Rejected') {
    const from = IPC_STAGES.find((s) => s.status === inv.returnedFromStatus)?.label;
    return `Rejected${from ? ` by ${from}` : ''}`;
  }
  if (st === 'Approved') return inv.financeApBillId ? `Approved · in Finance (${inv.financeBillNumber})` : 'Approved · Finance posting pending';
  if (st === 'Pending Audit' && inv.preAuditInitialApprovedAt) return 'Pre-Audit approved · to forward';
  return IPC_STAGES.find((s) => s.status === st)?.label ? `With ${IPC_STAGES.find((s) => s.status === st).label}` : st;
};

const person = (u) => (u && typeof u === 'object' ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '');

/** Stage stepper + history + observations + Finance hand-off for one IPC. */
export default function IpcApprovalTrail({ ipc }) {
  if (!ipc) return null;
  const st = ipc.approvalStatus || 'Draft';
  const rejectedAt = st === 'Rejected' ? IPC_STAGES.findIndex((s) => s.status === ipc.returnedFromStatus) : -1;
  const activeIdx = st === 'Rejected' ? rejectedAt : IPC_STAGES.findIndex((s) => s.status === st);
  const history = [...(ipc.workflowHistory || [])].reverse();

  return (
    <Box>
      <Stepper activeStep={st === 'Approved' ? IPC_STAGES.length : Math.max(0, activeIdx)} alternativeLabel sx={{ mb: 2 }}>
        {IPC_STAGES.map((s, idx) => (
          <Step key={s.status} completed={st === 'Approved' || (activeIdx > idx && st !== 'Rejected') || (st === 'Rejected' && idx < rejectedAt)}>
            <StepLabel error={st === 'Rejected' && idx === rejectedAt}>{s.label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {st === 'Rejected' && ipc.rejection?.comments && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          <strong>Rejected by {IPC_STAGES.find((s) => s.status === ipc.returnedFromStatus)?.label || 'approver'}</strong>
          {person(ipc.rejection.by) ? ` (${person(ipc.rejection.by)})` : ''}
          {ipc.rejection.at ? ` on ${dayjs(ipc.rejection.at).format('DD MMM YYYY')}` : ''}: {ipc.rejection.comments}
          <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
            Revise the IPC if needed, then resubmit with your response — it goes straight back to that desk.
          </Typography>
        </Alert>
      )}

      {st === 'Approved' && (
        <Alert severity={ipc.financeApBillId ? 'success' : 'warning'} sx={{ mb: 1.5 }}>
          {ipc.financeApBillId
            ? <>Posted to Finance as Accounts Payable bill <strong>{ipc.financeBillNumber}</strong>{ipc.financePostedAt ? ` on ${dayjs(ipc.financePostedAt).format('DD MMM YYYY')}` : ''}. Finance pays it through its normal payment process.</>
            : <>CEO approved, but posting to Finance needs attention: {ipc.financePostingError || 'pending'}</>}
        </Alert>
      )}

      {(ipc.observations || []).length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>Observations</Typography>
          <Stack spacing={0.75}>
            {ipc.observations.map((o, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                  <Chip size="small" label={o.severity} color={{ critical: 'error', high: 'error', medium: 'warning', low: 'default' }[o.severity] || 'default'} />
                  <Typography variant="caption" color="text.secondary">{o.stage}{person(o.addedBy) ? ` · ${person(o.addedBy)}` : ''}</Typography>
                  {o.resolved && <Chip size="small" variant="outlined" color="success" label="Answered" />}
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5 }}>{o.observation}</Typography>
                {o.initiatorResponse && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    Response: {o.initiatorResponse}
                  </Typography>
                )}
              </Paper>
            ))}
          </Stack>
        </Box>
      )}

      {history.length > 0 && (
        <Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>Approval history</Typography>
          <Stack spacing={0.5}>
            {history.map((h, idx) => (
              <Stack key={idx} direction="row" gap={1} alignItems="baseline" sx={{ borderLeft: 2, borderColor: 'divider', pl: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 118 }}>
                  {dayjs(h.changedAt).format('DD MMM YYYY, hh:mm A')}
                </Typography>
                <Typography variant="body2">
                  <strong>{h.module || '—'}</strong>{person(h.changedBy) ? ` · ${person(h.changedBy)}` : ''}:{' '}
                  {h.fromStatus === h.toStatus ? h.toStatus : `${h.fromStatus} → ${h.toStatus}`}
                  {h.comments ? ` — ${h.comments}` : ''}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
