import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Dialog, Paper, Skeleton, Stack, Typography
} from '@mui/material';
import { Print as PrintIcon } from '@mui/icons-material';
import dayjs from 'dayjs';
import { getBudgetApprovals, getBudgetRequest } from '../../services/projectManagementService';
import { BudgetApprovalActions, BudgetDocumentFrame } from '../../components/ProjectManagement/ProjectBudgetPanel';
import { budgetDocFromView, printBudgetDocument } from '../../components/ProjectManagement/budgetApprovalDocument';
import { fmt } from '../../components/ProjectManagement/mainProjectUi';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const STATUS_CHIP = { Draft: ['Returned / draft', 'default'], Submitted: ['In approval', 'warning'], Approved: ['Approved', 'success'] };

/** One budget in the list */
const Row = ({ r, onOpen }) => (
  <Paper
    elevation={0} onClick={onOpen}
    sx={{ p: 2, borderRadius: 3, border: `1px solid ${r.waitingForMe ? '#f59e0b' : LINE}`, cursor: 'pointer', transition: 'all .15s', '&:hover': { boxShadow: '0 6px 18px rgba(15,23,42,0.08)', transform: 'translateY(-1px)' } }}
  >
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 900, color: INK, fontSize: 16 }}>{r.name}</Typography>
        <Typography variant="body2" sx={{ color: MUTED }}>{[r.documentNo, r.projectType, r.location].filter(Boolean).join(' · ')}</Typography>
        <Typography variant="caption" sx={{ color: r.waitingForMe ? '#b45309' : MUTED, fontWeight: 700 }}>
          {r.waitingForMe
            ? `Waiting for your approval${r.submittedAt ? ` · sent ${dayjs(r.submittedAt).format('DD MMM YYYY')}` : ''}`
            : r.waitingFor ? `With ${r.waitingFor}` : r.myStatus && r.myActedAt ? `You ${r.myStatus === 'Approved' ? 'approved' : 'returned'} it on ${dayjs(r.myActedAt).format('DD MMM YYYY')}` : ''}
        </Typography>
      </Box>
      <Stack alignItems={{ sm: 'flex-end' }} gap={0.5}>
        <Typography sx={{ fontWeight: 900, fontSize: 20, color: INK }}>{fmt(r.amount)}</Typography>
        <Chip size="small" label={(STATUS_CHIP[r.status] || [r.status])[0]} color={(STATUS_CHIP[r.status] || [])[1] || 'default'} sx={{ fontWeight: 700 }} />
      </Stack>
    </Stack>
  </Paper>
);

/**
 * Budget approvals for COO / AVP / CEO (or whoever is chosen): the budgets waiting for the signed-in person,
 * each opened as its budget document with Approve / Return.
 * Open to every signed-in user; the server only lists budgets the user is an approver of.
 */
export default function BudgetApprovals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState(null);
  const openId = searchParams.get('project');

  const load = useCallback(async () => {
    try {
      const res = await getBudgetApprovals();
      setData(res.data?.data || { waiting: [], others: [] });
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load budget approvals');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!openId) { setView(null); return; }
    setView(null);
    getBudgetRequest(openId)
      .then((res) => setView(res.data?.data || null))
      .catch((e) => setError(e.response?.data?.message || 'Could not open the budget'));
  }, [openId]);

  const open = (id) => setSearchParams({ project: id });
  const close = () => setSearchParams({});

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1000, mx: 'auto' }}>
      <Typography sx={{ fontWeight: 900, fontSize: 24, color: INK }}>Budget approvals</Typography>
      <Typography variant="body2" sx={{ color: MUTED, mb: 2.5 }}>Project budgets sent to you for approval. Open one to read it, then approve or return it.</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      {!data ? <Skeleton variant="rounded" height={160} /> : (
        <Stack gap={3}>
          <Box>
            <Typography sx={{ fontWeight: 800, color: INK, mb: 1 }}>Waiting for you · {data.waiting.length}</Typography>
            <Stack gap={1.25}>
              {data.waiting.length ? data.waiting.map((r) => <Row key={r._id} r={r} onOpen={() => open(r._id)} />)
                : <Typography variant="body2" sx={{ color: MUTED, p: 2, bgcolor: '#f8fafc', borderRadius: 2 }}>Nothing waiting for you.</Typography>}
            </Stack>
          </Box>
          {data.others.length > 0 && (
            <Box>
              <Typography sx={{ fontWeight: 800, color: INK, mb: 1 }}>Other budgets you are an approver of</Typography>
              <Stack gap={1.25}>{data.others.map((r) => <Row key={r._id} r={r} onOpen={() => open(r._id)} />)}</Stack>
            </Box>
          )}
        </Stack>
      )}

      <Dialog open={Boolean(openId)} onClose={close} maxWidth="md" fullWidth PaperProps={{ sx: { height: '94vh' } }}>
        <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap" sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${LINE}` }}>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography fontWeight={800} noWrap>{view?.project?.name || 'Loading…'}</Typography>
            {view && <Typography variant="caption" sx={{ color: MUTED }}>{view.documentNo} · {fmt(view.amount)}{view.currentApprover ? ` · waiting for ${view.currentApprover.name}` : ''}</Typography>}
          </Box>
          {view && (
            <BudgetApprovalActions
              projectId={openId} view={view}
              onDone={(msg, next) => { setNotice(msg); if (next) setView(next); load(); }}
              onError={setError}
            />
          )}
          {view && <Button size="small" startIcon={<PrintIcon />} onClick={() => printBudgetDocument(budgetDocFromView(view))}>Print</Button>}
          <Button size="small" onClick={close}>Close</Button>
        </Stack>
        <Box sx={{ flex: 1, overflowY: 'auto', bgcolor: '#eceef1' }}>
          {view ? <BudgetDocumentFrame doc={budgetDocFromView(view)} /> : <Box sx={{ p: 4 }}><Skeleton height={400} /></Box>}
        </Box>
      </Dialog>
    </Box>
  );
}
