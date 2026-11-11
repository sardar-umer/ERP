import React from 'react';
import {
  Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography
} from '@mui/material';
import { ArrowDownward as NextIcon } from '@mui/icons-material';
import dayjs from 'dayjs';
import { fmt } from './mainProjectUi';

const STATUS_COLOR = { Draft: 'default', Active: 'success', Completed: 'info', Cancelled: 'error' };
const idOf = (v) => String(v?._id || v || '');
const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : null);

/**
 * The chain a contract belongs to when work was re-contracted: the cancelled contract(s) before it and the
 * contract(s) that took over after it. `rows` are the Sub Project's contracts; linked contracts that are not in
 * `rows` (e.g. filtered out) come from the populated replacesContract / replacedBy.
 */
export const buildContractChain = (contract, rows = []) => {
  const byId = new Map(rows.map((r) => [idOf(r), r]));
  const resolve = (ref) => byId.get(idOf(ref)) || (ref && typeof ref === 'object' ? ref : null);

  const before = [];
  const seen = new Set([idOf(contract)]);
  let cur = contract;
  while (cur?.replacesContract && !seen.has(idOf(cur.replacesContract))) {
    const prev = resolve(cur.replacesContract);
    if (!prev) break;
    seen.add(idOf(prev));
    before.unshift(prev);
    cur = prev;
  }

  // Replacements cancelled while still a Draft never took the work over — left out of the history
  const started = (c) => c.status !== 'Cancelled' || Boolean(c.activatedAt);
  const after = [];
  const queue = [...(contract.replacedBy || [])];
  while (queue.length) {
    const next = resolve(queue.shift());
    if (!next || seen.has(idOf(next)) || !started(next)) continue;
    seen.add(idOf(next));
    after.push(next);
    queue.push(...(byId.get(idOf(next))?.replacedBy || next.replacedBy || []));
  }
  return [...before, contract, ...after];
};

/** Old rate → new rate per BOQ line (or per villa on slab-wise contracts) against the contract this one replaced */
const RateComparison = ({ contract, previous }) => {
  if (!previous) return null;
  if (contract.contractType === 'Slab') {
    if (!(previous.ratePerUnit > 0) || !(contract.ratePerUnit > 0)) return null;
    const diff = contract.ratePerUnit - previous.ratePerUnit;
    return (
      <Typography variant="body2" sx={{ mt: 1 }}>
        <strong>Rate per villa:</strong> {fmt(previous.ratePerUnit)} ({previous.contractNumber}) → {fmt(contract.ratePerUnit)}
        {' '}<Typography component="span" variant="body2" color={diff > 0 ? 'error.main' : 'success.main'}>
          ({diff >= 0 ? '+' : ''}{fmt(diff)}, {Math.round((diff / previous.ratePerUnit) * 100)}%)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          The old rate is for all of its slabs; this contract covers only the slabs that were left.
        </Typography>
      </Typography>
    );
  }
  const oldRate = new Map((previous.items || []).map((i) => [idOf(i.boqItem), i.unitPrice]));
  const lines = (contract.items || []).filter((i) => oldRate.has(idOf(i.boqItem)));
  if (!lines.length) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2" fontWeight={700} gutterBottom>Rates against {previous.contractNumber}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>BOQ line</TableCell>
            <TableCell align="right">Old rate</TableCell>
            <TableCell align="right">New rate</TableCell>
            <TableCell align="right">Change</TableCell>
            <TableCell align="right">Extra cost on this qty</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((i) => {
            const old = Number(oldRate.get(idOf(i.boqItem))) || 0;
            const diff = (Number(i.unitPrice) || 0) - old;
            return (
              <TableRow key={idOf(i.boqItem)}>
                <TableCell>{i.title || i.boqItem?.title || i.description}</TableCell>
                <TableCell align="right">{fmt(old)}</TableCell>
                <TableCell align="right">{fmt(i.unitPrice)}</TableCell>
                <TableCell align="right" sx={{ color: diff > 0 ? 'error.main' : diff < 0 ? 'success.main' : undefined }}>
                  {diff >= 0 ? '+' : ''}{fmt(diff)}{old > 0 ? ` (${Math.round((diff / old) * 100)}%)` : ''}
                </TableCell>
                <TableCell align="right">{diff >= 0 ? '+' : ''}{fmt(diff * (Number(i.quantity) || 0))}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
};

/** One contract in the chain: who, value, and its dates (created, activated, completed / cancelled) */
const ChainEntry = ({ c, current }) => (
  <Paper variant="outlined" sx={{ p: 1.25, borderColor: current ? 'primary.main' : undefined, borderWidth: current ? 2 : 1 }}>
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="body2" fontWeight={700}>{c.contractNumber}</Typography>
      <Chip size="small" label={c.status} color={STATUS_COLOR[c.status] || 'default'} />
      <Typography variant="body2">{c.contractor?.name || '—'}</Typography>
      <Typography variant="body2" color="text.secondary">· {fmt(c.totalAmount)}</Typography>
      {current && <Chip size="small" variant="outlined" color="primary" label="This contract" />}
    </Stack>
    <Typography variant="caption" color="text.secondary" display="block">
      {[
        day(c.createdAt) && `Created ${day(c.createdAt)}`,
        day(c.activatedAt) && `activated ${day(c.activatedAt)}`,
        day(c.completedAt) && `completed ${day(c.completedAt)}`,
        c.status === 'Cancelled' && day(c.cancellation?.cancellationDate) && `cancelled ${day(c.cancellation.cancellationDate)}`
      ].filter(Boolean).join(' · ')}
    </Typography>
    {c.status === 'Cancelled' && c.cancellation && (
      <Typography variant="caption" display="block">
        Work done {fmt(c.cancellation.workDone?.amount)}{c.cancellation.reason ? ` — ${c.cancellation.reason}` : ''}
      </Typography>
    )}
  </Paper>
);

/** Contract history for the contract view: the re-contracting chain and the rate change from the contract it replaced */
const SubletContractHistory = ({ contract, rows }) => {
  const chain = buildContractChain(contract, rows);
  if (chain.length < 2) return null;
  const byId = new Map(rows.map((r) => [idOf(r), r]));
  const previous = contract.replacesContract
    ? { ...(typeof contract.replacesContract === 'object' ? contract.replacesContract : {}), ...(byId.get(idOf(contract.replacesContract)) || {}) }
    : null;
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>Contract history</Typography>
      <Stack spacing={0.5}>
        {chain.map((c, i) => (
          <React.Fragment key={idOf(c)}>
            {i > 0 && (
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ pl: 1, color: 'text.secondary' }}>
                <NextIcon fontSize="small" />
                <Typography variant="caption">remaining work re-contracted</Typography>
              </Stack>
            )}
            <ChainEntry c={c} current={idOf(c) === idOf(contract)} />
          </React.Fragment>
        ))}
      </Stack>
      <RateComparison contract={contract} previous={previous} />
    </Box>
  );
};

export default SubletContractHistory;
