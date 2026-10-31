import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Chip, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography
} from '@mui/material';
import { OpenInNew as OpenIcon } from '@mui/icons-material';
import {
  ACCENT, BORDER, CONTRACT_STATUS_COLOR, CR_STATUS_COLOR, ContractTypeTag, Empty, HEALTH_COLOR, INK,
  GLASS_EDGE, IPC_APPROVAL_COLOR, Label, PASTEL_BG_TALL, PASTEL_SHADOW, PROJECT_STATUS_COLOR, SOFT, fmt, plural, progressColor
} from './mainProjectUi';

// Cards sit on the pastel panel as frosted white glass so tables stay easy to read
const CARD_BG = 'rgba(255,255,255,0.88)';

const Dash = () => <Typography variant="body2" color="text.disabled">—</Typography>;

/** Clickable cell content */
const Link = ({ onClick, children }) => (
  <Box
    onClick={onClick}
    sx={{ cursor: 'pointer', borderRadius: 1.5, mx: -0.75, px: 0.75, py: 0.25, '&:hover': { bgcolor: 'rgba(15,118,110,0.06)' } }}
  >
    {children}
  </Box>
);

const CheckRequestCell = ({ cr, onOpen }) => (
  <Link onClick={onOpen}>
    <Typography variant="body2" fontWeight={700}>{cr.checkRequestNumber || 'Check Request'}</Typography>
    <Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: 0.25 }}>
      <Typography variant="caption" color="text.secondary">{fmt(cr.verifiedTotal || cr.claimedTotal)}</Typography>
      <Chip size="small" label={cr.status} color={CR_STATUS_COLOR[cr.status] || 'default'} sx={{ height: 20, fontSize: 11 }} />
    </Stack>
  </Link>
);

const ipcTitle = (ipc) => `${ipc.ipcKind === 'Work' ? 'IPC' : `${ipc.ipcKind} IPC`} #${ipc.ipcNumber}`;

const IpcCell = ({ ipcs, onOpen }) => (
  ipcs.length ? (
    <Stack gap={0.75}>
      {ipcs.map((ipc) => (
        <Link key={ipc._id} onClick={onOpen}>
          <Typography variant="body2" fontWeight={700}>{ipcTitle(ipc)}</Typography>
          <Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: 0.25 }}>
            <Typography variant="caption" color="text.secondary">{fmt(ipc.grossAmount)}</Typography>
            <Chip size="small" label={ipc.approvalStatus} color={IPC_APPROVAL_COLOR[ipc.approvalStatus] || 'default'} sx={{ height: 20, fontSize: 11 }} />
          </Stack>
        </Link>
      ))}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">Not raised yet</Typography>
);

const PaymentCell = ({ ipcs }) => {
  if (!ipcs.length) return <Dash />;
  return (
    <Stack gap={0.75}>
      {ipcs.map((ipc) => {
        const due = ipc.netPayableAmount || ipc.grossAmount;
        const paid = ipc.paidAmount > 0 && ipc.paidAmount >= due - 0.5;
        let label = 'Waiting approval';
        let color = 'default';
        if (paid) { label = 'Paid'; color = 'success'; } else if (ipc.paidAmount > 0) { label = `Part paid ${fmt(ipc.paidAmount)}`; color = 'info'; } else if (ipc.approvalStatus === 'Approved') { label = 'Unpaid'; color = 'warning'; }
        return (
          <Box key={ipc._id} sx={{ minHeight: 44, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Chip size="small" variant="outlined" label={label} color={color} sx={{ alignSelf: 'flex-start' }} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>Net {fmt(due)}</Typography>
          </Box>
        );
      })}
    </Stack>
  );
};

/** "Sublet Contract 1 of 3" heading above each contract card */
const ContractHeading = ({ index, count, contract, unlinked }) => {
  const t = contract.totals || {};
  const parts = unlinked
    ? ['Raised without a sublet contract']
    : [
      contract.contractNumber,
      contract.contractType === 'Slab' ? 'Slab-wise' : 'BOQ-wise',
      contract.contractor,
      contract.contractType === 'Slab' && plural((contract.slabs || []).length, 'slab'),
      plural(t.checkRequests || 0, 'check request'),
      plural(t.ipcs || 0, 'IPC')
    ].filter(Boolean);
  return (
    <Stack direction="row" alignItems="center" gap={1.25} sx={{ mb: 1 }}>
      <Box
        sx={{
          width: 30, height: 30, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
          bgcolor: unlinked ? '#94a3b8' : ACCENT, color: '#fff', fontWeight: 800, fontSize: 14
        }}
      >
        {unlinked ? '!' : index + 1}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ color: INK, lineHeight: 1.2 }}>
          {unlinked ? 'Not linked to a contract' : `Sublet Contract ${index + 1}`}
          {!unlinked && count > 1 && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.75, fontWeight: 600 }}>of {count}</Typography>
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary">{parts.join(' · ')}</Typography>
      </Box>
    </Stack>
  );
};

/** One contract: header + a row per slab (or per check request), then advances / retention */
const ContractCard = ({ contract, go, unlinked = false }) => {
  const isSlab = contract.contractType === 'Slab';
  const rows = [];
  if (isSlab) {
    (contract.slabs || []).forEach((sl, i) => {
      const first = { name: `Slab ${i + 1}: ${sl.name}`, note: `${sl.percentage}% · ${fmt(sl.amount)}` };
      if (!sl.checkRequests.length) rows.push({ key: `${sl._id}`, ...first, cr: null, ipcs: [], unclaimed: true });
      sl.checkRequests.forEach((cr, j) => rows.push({
        key: `${sl._id}-${cr._id}`, ...(j === 0 ? first : { name: '', note: '' }), cr, ipcs: cr.ipcs
      }));
    });
  } else {
    contract.checkRequests.forEach((cr) => rows.push({ key: `${cr._id}`, name: cr.title || 'Claim', note: '', cr, ipcs: cr.ipcs }));
  }
  contract.otherIpcs.forEach((ipc) => rows.push({ key: `x-${ipc._id}`, name: ipc.ipcKind, note: 'Not from a check request', cr: null, ipcs: [ipc], direct: true }));

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3, border: `1px solid ${GLASS_EDGE}`, borderLeft: `4px solid ${unlinked ? '#94a3b8' : ACCENT}`,
        bgcolor: CARD_BG, backdropFilter: 'blur(6px)', boxShadow: '0 4px 14px rgba(15,23,42,0.06)', overflow: 'hidden'
      }}
    >
      <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${BORDER}` }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} gap={1.5}>
          <Box>
            <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
              <Typography variant="subtitle1" fontWeight={800} sx={{ color: INK }}>{contract.contractNumber || 'Sublet Contract'}</Typography>
              {!unlinked && <ContractTypeTag type={contract.contractType} />}
              {!unlinked && <Chip size="small" variant="outlined" label={contract.status} color={CONTRACT_STATUS_COLOR[contract.status] || 'default'} />}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {unlinked ? 'Check requests and IPCs raised without a sublet contract' : `${contract.contractor}${contract.title ? ` · ${contract.title}` : ''}`}
            </Typography>
          </Box>
          {!unlinked && <Stack direction="row" alignItems="center" gap={3} flexWrap="wrap">
            <Box><Label>Value</Label><Typography variant="body2" fontWeight={800}>{fmt(contract.totalAmount)}</Typography></Box>
            <Box><Label>Billed</Label><Typography variant="body2" fontWeight={800}>{fmt(contract.totals.billed)}</Typography></Box>
            <Box><Label>Paid</Label><Typography variant="body2" fontWeight={800}>{fmt(contract.totals.paid)}</Typography></Box>
            <Button size="small" endIcon={<OpenIcon sx={{ fontSize: 14 }} />} onClick={() => go('sublet-contracts')} sx={{ textTransform: 'none', color: ACCENT }}>
              Open
            </Button>
          </Stack>}
        </Stack>
      </Box>

      {!rows.length ? (
        <Box sx={{ p: 2.5 }}><Empty>{isSlab ? 'No slabs on this contract.' : 'No check requests yet.'}</Empty></Box>
      ) : (
        <TableContainer>
          <Table size="small" sx={{ minWidth: 640 }}>
            <TableHead>
              <TableRow sx={{ '& th': { bgcolor: SOFT, color: 'text.secondary', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, py: 1 } }}>
                <TableCell sx={{ width: '28%', pl: 2.5 }}>{isSlab ? 'Slab' : 'Claim'}</TableCell>
                <TableCell sx={{ width: '24%' }}>Check Request</TableCell>
                <TableCell sx={{ width: '26%' }}>IPC</TableCell>
                <TableCell>Payment</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key} sx={{ verticalAlign: 'top', '&:last-child td': { borderBottom: 0 }, '& td': { py: 1.25 } }}>
                  <TableCell sx={{ pl: 2.5 }}>
                    {r.name && <Typography variant="body2" fontWeight={700}>{r.name}</Typography>}
                    {r.note && <Typography variant="caption" color="text.secondary">{r.note}</Typography>}
                  </TableCell>
                  <TableCell>
                    {r.cr ? <CheckRequestCell cr={r.cr} onOpen={() => go('check-requests')} />
                      : r.unclaimed ? <Chip size="small" variant="outlined" label="Not claimed yet" />
                        : <Dash />}
                  </TableCell>
                  <TableCell>{r.unclaimed ? <Dash /> : <IpcCell ipcs={r.ipcs} onOpen={() => go('invoices')} />}</TableCell>
                  <TableCell><PaymentCell ipcs={r.ipcs} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

/** Right-hand panel for one Sub Project: its numbers, then every contract → check request → IPC → payment */
export default function SubProjectPanel({ sub, money, index = 0, count = 1 }) {
  const navigate = useNavigate();
  const go = (tab) => navigate(`/general/project-management/${sub._id}?tab=${tab}`);
  const t = sub.totals;
  const unlinked = sub.unlinked;
  const unlinkedContract = (unlinked.checkRequests.length || unlinked.ipcs.length) ? {
    _id: 'unlinked', contractNumber: 'Not linked to a contract', contractType: 'BOQ',
    checkRequests: unlinked.checkRequests, otherIpcs: unlinked.ipcs
  } : null;

  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 2.5 }, borderRadius: 3, background: PASTEL_BG_TALL,
        border: `1px solid ${GLASS_EDGE}`, boxShadow: PASTEL_SHADOW
      }}
    >
      {/* "Sub Project 1 of 3" heading, same style as the contract headings */}
      <Stack direction="row" alignItems="center" gap={1.25} sx={{ mb: 1 }}>
        <Box sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: INK, color: '#fff', fontWeight: 800, fontSize: 15 }}>
          {index + 1}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" fontWeight={800} sx={{ color: INK, lineHeight: 1.2 }}>
            Sub Project {index + 1}
            {count > 1 && (
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.75, fontWeight: 600 }}>of {count}</Typography>
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {[sub.name, sub.projectNumber, plural(sub.totals.contracts, 'sublet contract')].join(' · ')}
          </Typography>
        </Box>
      </Stack>

      {/* Sub Project header */}
      <Paper elevation={0} sx={{ mb: 2, p: 2.5, borderRadius: 3, border: `1px solid ${GLASS_EDGE}`, bgcolor: CARD_BG, backdropFilter: 'blur(6px)', boxShadow: '0 4px 14px rgba(15,23,42,0.06)' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} gap={1.5}>
          <Box>
            <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
              <Typography variant="h6" fontWeight={800} sx={{ color: INK }}>{sub.name}</Typography>
              <Chip size="small" label={sub.status || 'Draft'} color={PROJECT_STATUS_COLOR[sub.status] || 'default'} />
              {money && <Chip size="small" variant="outlined" label={money.health} color={HEALTH_COLOR[money.health] || 'default'} />}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {[sub.projectNumber, sub.sector].filter(Boolean).join(' · ')}
              {' · '}{plural(t.contracts, 'contract')} · {plural(t.checkRequests, 'check request')} · {plural(t.ipcs, 'IPC')}
            </Typography>
          </Box>
          <Button variant="outlined" endIcon={<OpenIcon sx={{ fontSize: 16 }} />} onClick={() => go('overview')} sx={{ textTransform: 'none', color: ACCENT, borderColor: ACCENT, flexShrink: 0 }}>
            Open Sub Project
          </Button>
        </Stack>
        <Box sx={{ mt: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
          <Box>
            <Label>Progress</Label>
            <Typography variant="h6" fontWeight={800}>{sub.progress}%</Typography>
            <LinearProgress variant="determinate" value={Math.min(100, sub.progress)} color={progressColor(sub.progress)} sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: '#eef2f6' }} />
          </Box>
          <Box><Label>Budget</Label><Typography variant="h6" fontWeight={800}>{fmt(money?.budget)}</Typography></Box>
          <Box><Label>Spent</Label><Typography variant="h6" fontWeight={800}>{fmt(money?.spent ?? t.billed)}</Typography></Box>
          <Box><Label>Paid</Label><Typography variant="h6" fontWeight={800}>{fmt(t.paid)}</Typography></Box>
        </Box>
      </Paper>

      {/* Contracts */}
      <Typography variant="overline" sx={{ display: 'block', color: 'text.secondary', fontWeight: 800, letterSpacing: 1, mb: 1 }}>
        Sublet contracts ({sub.contracts.length})
      </Typography>
      {!sub.contracts.length && !unlinkedContract && (
        <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${GLASS_EDGE}`, bgcolor: CARD_BG }}>
          <Empty>No sublet contracts yet. Open the sub project to add one.</Empty>
        </Paper>
      )}
      {sub.contracts.map((c, i) => (
        <Box key={c._id} sx={{ mb: 3, '&:last-child': { mb: 0 } }}>
          <ContractHeading index={i} count={sub.contracts.length} contract={c} />
          <ContractCard contract={c} go={go} />
        </Box>
      ))}
      {unlinkedContract && (
        <Box sx={{ mb: 3, '&:last-child': { mb: 0 } }}>
          <ContractHeading contract={unlinkedContract} unlinked />
          <ContractCard contract={unlinkedContract} go={go} unlinked />
        </Box>
      )}
    </Box>
  );
}
