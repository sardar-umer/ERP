import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, IconButton, Paper, Skeleton, Stack, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, Tooltip, Typography
} from '@mui/material';
import {
  AssignmentTurnedIn as InspectionIcon,
  FactCheck as CheckRequestIcon,
  Handshake as SubletIcon,
  OpenInNew as OpenIcon,
  Payments as PayIcon,
  Receipt as InvoiceIcon,
  Timer as TimerIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { getApprovalsInbox } from '../../services/projectManagementService';
import api from '../../services/api';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(v || 0);
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

/** Each queue = one kind of decision; `tab` is the project tab where the action is taken. */
const QUEUES = [
  {
    key: 'inspectionsToSign',
    label: 'Inspections to sign',
    icon: <InspectionIcon fontSize="small" />,
    tab: 'check-requests',
    link: (r) => `/general/project-management/${r.project?._id}?tab=check-requests&inspection=${r._id}`,
    action: 'Review & sign',
    empty: 'No inspection reports waiting for your signature.',
    columns: [
      ['Inspection', (r) => <><strong>{r.reportNumber}</strong><Typography variant="caption" display="block" color="text.secondary">{r.checkRequest?.checkRequestNumber} — {r.checkRequest?.title}</Typography></>],
      ['Signed', (r) => `${r.signed} of ${r.total}`],
      ['Value', (r) => fmt(r.inspectedTotal), 'right'],
      ['Inspection date', (r) => fmtDate(r.inspectionDate)]
    ]
  },
  {
    key: 'contractsToActivate',
    label: 'Contracts to activate',
    icon: <SubletIcon fontSize="small" />,
    tab: 'sublet-contracts',
    action: 'Review & activate',
    empty: 'No draft sublet contracts waiting.',
    columns: [
      ['Contract', (r) => <><strong>{r.contractNumber}</strong><Typography variant="caption" display="block" color="text.secondary">{r.title}</Typography></>],
      ['Type', (r) => <Chip size="small" variant="outlined" label={r.contractType === 'Slab' ? 'Slab wise' : 'BOQ wise'} />],
      ['Value', (r) => fmt(r.totalAmount), 'right'],
      ['Last updated', (r) => fmtDate(r.updatedAt)]
    ]
  },
  {
    key: 'checkRequestsToVerify',
    label: 'Awaiting inspection',
    icon: <CheckRequestIcon fontSize="small" />,
    tab: 'check-requests',
    action: 'Create inspection report',
    empty: 'Every submitted check request has an inspection report.',
    columns: [
      ['Check request', (r) => <><strong>{r.checkRequestNumber}</strong><Typography variant="caption" display="block" color="text.secondary">{r.title}</Typography></>],
      ['Claimed', (r) => fmt(r.claimedTotal), 'right'],
      ['Submitted', (r) => fmtDate(r.submittedAt || r.updatedAt)]
    ]
  },
  {
    key: 'checkRequestsReadyForIpc',
    label: 'Ready for IPC',
    icon: <InvoiceIcon fontSize="small" />,
    tab: 'invoices',
    action: 'Raise IPC',
    empty: 'No verified work waiting to be billed.',
    columns: [
      ['Check request', (r) => <><strong>{r.checkRequestNumber}</strong><Typography variant="caption" display="block" color="text.secondary">{r.title}</Typography></>],
      ['Billable', (r) => fmt(r.billableAmount), 'right'],
      ['Verified', (r) => fmtDate(r.verifiedAt || r.updatedAt)]
    ]
  },
  {
    key: 'ipcsToSubmit',
    label: 'IPCs to submit / revise',
    icon: <PayIcon fontSize="small" />,
    tab: 'invoices',
    action: 'Open IPC',
    empty: 'No draft or rejected IPCs waiting on the project team.',
    columns: [
      ['IPC', (r) => <><strong>{r.invoiceNumber || `IPC #${r.ipcNumber}`}</strong><Typography variant="caption" display="block" color="text.secondary">IPC #{r.ipcNumber}</Typography></>],
      ['Stage', (r) => (r.approvalStatus === 'Rejected'
        ? <Chip size="small" color="error" label="Rejected — revise & resubmit" />
        : <Chip size="small" label="Draft — submit" />)],
      ['Net payable', (r) => fmt(r.netPayableAmount || r.invoiceAmount), 'right'],
      ['Reason', (r) => (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 260 }} noWrap title={r.rejection?.comments}>
          {r.rejection?.comments || '—'}
        </Typography>
      )]
    ]
  }
];

const projectLabel = (p) => {
  if (!p) return '—';
  const main = p.parentProject?.name;
  return (
    <>
      <Typography variant="body2" fontWeight={600}>{p.name}</Typography>
      {main && <Typography variant="caption" color="text.secondary">{main}</Typography>}
    </>
  );
};

/** Cross-project inbox: everything in the PM workflow that is waiting on someone. */
export default function ProjectApprovals() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queueIdx, setQueueIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getApprovalsInbox();
      const next = res.data?.data || {};
      setData(next);
      // Land on the first queue that has something in it
      setQueueIdx((cur) => {
        if (cur >= QUEUES.length || (next[QUEUES[cur].key] || []).length) return cur;
        const firstBusy = QUEUES.findIndex((q) => (next[q.key] || []).length);
        return firstBusy >= 0 ? firstBusy : cur;
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deskView = queueIdx === QUEUES.length;
  const queue = QUEUES[Math.min(queueIdx, QUEUES.length - 1)];
  const rows = data?.[queue.key] || [];

  // Desk time: average days IPCs spend at each desk + what is waiting now
  const [desk, setDesk] = useState(null);
  useEffect(() => {
    if (!deskView || desk) return;
    api.get('/project-management/ipcs/desk-report').then((res) => setDesk(res.data?.data || null)).catch(() => setDesk({ desks: [], waiting: [] }));
  }, [deskView, desk]);
  const openRow = (row) => {
    const pid = row.project?._id;
    if (!pid) return;
    navigate(queue.link ? queue.link(row) : `/general/project-management/${pid}?tab=${queue.tab}`);
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Approvals</Typography>
          <Typography variant="body2" color="text.secondary">
            Everything across all projects that is waiting on a decision. Open a row to act on it in its project.
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={load} disabled={loading}><RefreshIcon /></IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Tabs
          value={queueIdx}
          onChange={(_, v) => setQueueIdx(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}
        >
          {QUEUES.map((q) => {
            const count = (data?.[q.key] || []).length;
            return (
              <Tab
                key={q.key}
                icon={q.icon}
                iconPosition="start"
                sx={{ textTransform: 'none', minHeight: 52 }}
                label={(
                  <Stack direction="row" alignItems="center" gap={1.5}>
                    <span>{q.label}</span>
                    {!loading && count > 0 && <Chip size="small" color="warning" label={count} sx={{ height: 20, fontWeight: 700 }} />}
                  </Stack>
                )}
              />
            );
          })}
          <Tab icon={<TimerIcon fontSize="small" />} iconPosition="start" sx={{ textTransform: 'none', minHeight: 52 }} label="IPC desk time" />
        </Tabs>

        {deskView ? (
          !desk ? <Box sx={{ p: 2 }}><Skeleton height={160} /></Box> : (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Last {desk.sinceDays} days. Desks are reminded daily once an IPC waits more than {desk.reminderDays} days.
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell>Desk</TableCell>
                    <TableCell align="right">Average days</TableCell>
                    <TableCell align="right">Longest</TableCell>
                    <TableCell align="right">Handled</TableCell>
                    <TableCell align="right">Waiting now</TableCell>
                  </TableRow></TableHead>
                  <TableBody>
                    {desk.desks.map((d) => (
                      <TableRow key={d.status}>
                        <TableCell>{d.label}</TableCell>
                        <TableCell align="right" sx={{ color: d.averageDays > desk.reminderDays ? 'error.main' : undefined, fontWeight: 600 }}>
                          {d.averageDays ?? '—'}
                        </TableCell>
                        <TableCell align="right">{d.maxDays ?? '—'}</TableCell>
                        <TableCell align="right">{d.completedVisits}</TableCell>
                        <TableCell align="right">{d.waitingNow || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Waiting now</Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell>IPC</TableCell><TableCell>Project</TableCell><TableCell>Subcontractor</TableCell>
                    <TableCell>With</TableCell><TableCell align="right">Days</TableCell><TableCell align="right">Net</TableCell>
                  </TableRow></TableHead>
                  <TableBody>
                    {desk.waiting.map((w) => (
                      <TableRow key={w._id} hover sx={{ cursor: 'pointer' }}
                        onClick={() => w.project?._id && navigate(`/general/project-management/${w.project._id}?tab=invoices`)}>
                        <TableCell>#{w.ipcNumber} {w.invoiceNumber}{w.ipcKind !== 'Work' ? ` · ${w.ipcKind}` : ''}</TableCell>
                        <TableCell>{[w.project?.parentProject?.name, w.project?.name].filter(Boolean).join(' / ')}</TableCell>
                        <TableCell>{w.contractor || '—'}</TableCell>
                        <TableCell>{w.desk}</TableCell>
                        <TableCell align="right">
                          <Chip size="small" label={w.daysWaiting} color={w.daysWaiting > desk.reminderDays ? 'error' : 'default'} />
                        </TableCell>
                        <TableCell align="right">{fmt(w.netPayableAmount)}</TableCell>
                      </TableRow>
                    ))}
                    {!desk.waiting.length && <TableRow><TableCell colSpan={6} align="center"><Typography color="text.secondary" py={2}>Nothing waiting</Typography></TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )
        ) : loading ? (
          <Box sx={{ p: 2 }}><Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} /></Box>
        ) : !rows.length ? (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">{queue.empty}</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Project</TableCell>
                  <TableCell>Subcontractor</TableCell>
                  {queue.columns.map(([label, , align]) => (
                    <TableCell key={label} align={align || 'left'}>{label}</TableCell>
                  ))}
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row._id} hover sx={{ cursor: 'pointer' }} onClick={() => openRow(row)}>
                    <TableCell>{projectLabel(row.project)}</TableCell>
                    <TableCell>{row.contractor?.name || '—'}</TableCell>
                    {queue.columns.map(([label, render, align]) => (
                      <TableCell key={label} align={align || 'left'}>{render(row)}</TableCell>
                    ))}
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        endIcon={<OpenIcon fontSize="small" />}
                        onClick={(e) => { e.stopPropagation(); openRow(row); }}
                        sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                      >
                        {queue.action}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}
