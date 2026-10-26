import React, { useEffect, useState } from 'react';
import { Box, ButtonBase, Chip, Paper, Skeleton, Stack, Typography } from '@mui/material';
import {
  CheckCircle as DoneIcon,
  ChevronRight as ArrowIcon,
  ErrorOutline as AttentionIcon,
  RadioButtonUnchecked as PendingIcon
} from '@mui/icons-material';
import { getProjectWorkflow } from '../../services/projectManagementService';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(v || 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Each step: done (green), attention (amber — something is waiting), or pending (grey).
 * `hint` tells the user what to do next on that step.
 */
const buildSteps = (w) => {
  const { boq, contracts, checkRequests: cr, ipcs } = w;
  const liveContracts = contracts.active + contracts.completed;
  const crWaiting = cr.draft + cr.rejected;

  return [
    {
      tab: 'boq',
      title: 'BOQ',
      state: boq.lines > 0 ? 'done' : 'pending',
      status: boq.lines > 0 ? plural(boq.lines, 'line') : 'No lines yet',
      hint: 'Add BOQ lines, or allocate quantity from the Main Project BOQ'
    },
    {
      tab: 'sublet-contracts',
      title: 'Sublet Contract',
      state: contracts.draft > 0 ? 'attention' : liveContracts > 0 ? 'done' : 'pending',
      status: [
        liveContracts > 0 && `${liveContracts} active`,
        contracts.draft > 0 && `${contracts.draft} draft`
      ].filter(Boolean).join(' · ') || 'None yet',
      hint: contracts.draft > 0
        ? 'Activate the draft contract so work can be claimed'
        : 'Award BOQ lines to a subcontractor at agreed rates'
    },
    {
      tab: 'check-requests',
      title: 'Check Request',
      state: cr.submitted > 0 || crWaiting > 0 ? 'attention' : cr.verifiedOrBilled > 0 ? 'done' : 'pending',
      status: [
        cr.submitted > 0 && `${cr.submitted} in inspection`,
        crWaiting > 0 && `${crWaiting} not submitted`,
        cr.verifiedOrBilled > 0 && `${cr.verifiedOrBilled} verified`
      ].filter(Boolean).join(' · ') || 'None yet',
      hint: cr.submitted > 0
        ? 'Raise an inspection report and get every inspector to sign it'
        : crWaiting > 0
          ? 'Submit draft / rejected requests for verification'
          : 'Claim completed work for an active contract'
    },
    {
      tab: 'invoices',
      title: 'IPC',
      state: cr.readyForIpc > 0 || ipcs.draft > 0 || ipcs.rejected > 0 ? 'attention' : ipcs.total > 0 ? 'done' : 'pending',
      status: [
        cr.readyForIpc > 0 && `${plural(cr.readyForIpc, 'request')} ready to bill`,
        ipcs.draft > 0 && `${ipcs.draft} to submit`,
        ipcs.rejected > 0 && `${ipcs.rejected} rejected`
      ].filter(Boolean).join(' · ') || (ipcs.total > 0 ? plural(ipcs.total, 'IPC') : 'None yet'),
      hint: ipcs.rejected > 0
        ? 'Revise the rejected IPC and resubmit it with your response'
        : ipcs.draft > 0
          ? 'Submit the draft IPC for approval (Pre-Audit → Audit Director → CEO Secretariat → CEO)'
          : 'Raise an IPC from a verified check request'
    },
    {
      tab: 'invoices',
      title: 'Approval & Payment',
      state: ipcs.unpaid > 0 || ipcs.inApproval > 0 ? 'attention' : ipcs.paid > 0 ? 'done' : 'pending',
      status: [
        ipcs.inApproval > 0 && `${ipcs.inApproval} in approval`,
        ipcs.unpaid > 0 && `${ipcs.unpaid} with Finance · ${fmt(ipcs.unpaidAmount)}`
      ].filter(Boolean).join(' · ') || (ipcs.paid > 0 ? 'All paid' : 'Nothing due'),
      hint: ipcs.inApproval > 0
        ? 'Waiting on the approval chain — track it on the IPC'
        : 'Approved IPCs are paid by Finance from their Accounts Payable bill'
    }
  ];
};

const STATE_STYLE = {
  done: { color: 'success.main', Icon: DoneIcon },
  attention: { color: 'warning.main', Icon: AttentionIcon },
  pending: { color: 'text.disabled', Icon: PendingIcon }
};

/** Sub Project workflow: BOQ → Contract → Check Request → IPC → Payment, with the next action highlighted. */
export default function ProjectWorkflowStrip({ projectId, activeTabId, onGoToTab }) {
  const [workflow, setWorkflow] = useState(null);

  // Refetch on tab change so the strip reflects what was just done in a tab
  useEffect(() => {
    let cancelled = false;
    getProjectWorkflow(projectId)
      .then((res) => { if (!cancelled) setWorkflow(res.data?.data || null); })
      .catch(() => { if (!cancelled) setWorkflow(null); });
    return () => { cancelled = true; };
  }, [projectId, activeTabId]);

  if (!workflow) {
    return <Skeleton variant="rounded" height={84} sx={{ mb: 2, borderRadius: 2 }} />;
  }

  const steps = buildSteps(workflow);
  const nextIdx = steps.findIndex((s) => s.state !== 'done');
  const next = steps[nextIdx];

  return (
    <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} divider={<Box sx={{ borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider' }} />}>
        {steps.map((step, i) => {
          const { color, Icon } = STATE_STYLE[step.state];
          const isNext = i === nextIdx;
          const isOpen = step.tab === activeTabId;
          return (
            <ButtonBase
              key={step.title}
              onClick={() => onGoToTab(step.tab)}
              sx={{
                flex: 1,
                justifyContent: 'flex-start',
                textAlign: 'left',
                px: 1.75,
                py: 1.25,
                bgcolor: isNext ? 'rgba(237, 108, 2, 0.06)' : isOpen ? 'action.hover' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' }
              }}
            >
              <Stack direction="row" gap={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
                <Icon fontSize="small" sx={{ color, mt: 0.25 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" gap={0.75}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>{i + 1}</Typography>
                    <Typography variant="body2" fontWeight={700}>{step.title}</Typography>
                    {isNext && <Chip label="Next" size="small" color="warning" sx={{ height: 18, fontSize: '0.65rem' }} />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block" noWrap>{step.status}</Typography>
                </Box>
              </Stack>
            </ButtonBase>
          );
        })}
      </Stack>
      {next && (
        <ButtonBase
          onClick={() => onGoToTab(next.tab)}
          sx={{ width: '100%', justifyContent: 'flex-start', px: 1.75, py: 0.9, borderTop: 1, borderColor: 'divider', bgcolor: 'grey.50' }}
        >
          <Typography variant="body2" color="text.secondary">
            <strong>Next step:</strong> {next.hint}
          </Typography>
          <ArrowIcon fontSize="small" sx={{ ml: 'auto', color: 'text.secondary' }} />
        </ButtonBase>
      )}
    </Paper>
  );
}
