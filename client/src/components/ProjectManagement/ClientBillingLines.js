import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Checkbox, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography
} from '@mui/material';
import api from '../../services/api';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));

/**
 * Pick verified work to bill to the client, with the subcontractor cost alongside for margin:
 *  - BOQ lines: verified quantity not yet billed, at the BOQ (client) rate
 *  - slab stages: billed once, for an amount (suggested from the contract's client value × slab %)
 * `value` / `onChange` = [{ crItem, quantity }] for BOQ lines, [{ crItem, amount }] for slab stages.
 */
export default function ClientBillingLines({ projectId, value = [], onChange }) {
  const [lines, setLines] = useState(null);

  useEffect(() => {
    api.get(`/project-management/projects/${projectId}/client-billable`)
      .then((res) => setLines(res.data?.data || []))
      .catch(() => setLines([]));
  }, [projectId]);

  if (!lines) return <Skeleton height={120} />;
  if (!lines.length) {
    return <Alert severity="info">No verified work left to bill to the client. Lines appear here once their check requests are verified.</Alert>;
  }

  const isSlab = (l) => l.kind === 'slab';
  const entry = (crItem) => value.find((v) => v.crItem === crItem);
  const qtyOf = (crItem) => entry(crItem)?.quantity;
  const set = (crItem, quantity) => {
    const rest = value.filter((v) => v.crItem !== crItem);
    onChange(quantity === null ? rest : [...rest, { crItem, quantity }]);
  };
  const setAmount = (crItem, amount) => {
    const rest = value.filter((v) => v.crItem !== crItem);
    onChange(amount === null ? rest : [...rest, { crItem, amount }]);
  };
  const defaultEntry = (l) => (isSlab(l) ? { crItem: l.crItem, amount: l.suggestedClientAmount || 0 } : { crItem: l.crItem, quantity: l.remaining });
  const chosen = lines.filter((l) => entry(l.crItem));
  const clientOf = (l) => (isSlab(l) ? Number(entry(l.crItem)?.amount) || 0 : (Number(qtyOf(l.crItem)) || 0) * l.clientRate);
  const costOf = (l) => (isSlab(l) ? l.costAmount : (Number(qtyOf(l.crItem)) || 0) * l.costRate);
  const clientTotal = chosen.reduce((t, l) => t + clientOf(l), 0);
  const costTotal = chosen.reduce((t, l) => t + costOf(l), 0);

  return (
    <Box>
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={chosen.length === lines.length}
                  indeterminate={chosen.length > 0 && chosen.length < lines.length}
                  onChange={(e) => onChange(e.target.checked ? lines.map(defaultEntry) : [])}
                />
              </TableCell>
              <TableCell>Work (check request)</TableCell>
              <TableCell align="right">Unbilled</TableCell>
              <TableCell align="right" sx={{ width: 140 }}>Bill now</TableCell>
              <TableCell align="right">Client rate</TableCell>
              <TableCell align="right">Client amount</TableCell>
              <TableCell align="right">Subcontract cost</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l) => {
              const on = Boolean(entry(l.crItem));
              if (isSlab(l)) {
                const amount = entry(l.crItem)?.amount;
                return (
                  <TableRow key={l.crItem} hover>
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={on} onChange={(e) => setAmount(l.crItem, e.target.checked ? l.suggestedClientAmount || 0 : null)} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{l.title}</Typography>
                      <Typography variant="caption" color="text.secondary">{l.checkRequestNumber}{l.contractor ? ` · ${l.contractor}` : ''}</Typography>
                    </TableCell>
                    <TableCell align="right">1 stage</TableCell>
                    <TableCell align="right">
                      <TextField size="small" type="number" disabled={!on} value={on ? amount : ''} label="Client amount"
                        error={on && !(Number(amount) > 0)}
                        helperText={l.suggestedClientAmount ? `Suggested ${fmt(l.suggestedClientAmount)}` : 'No client value on contract'}
                        onChange={(e) => setAmount(l.crItem, e.target.value === '' ? 0 : Number(e.target.value))}
                        inputProps={{ min: 0 }} />
                    </TableCell>
                    <TableCell align="right">—</TableCell>
                    <TableCell align="right">{on ? fmt(amount) : '—'}</TableCell>
                    <TableCell align="right">{fmt(l.costAmount)}</TableCell>
                  </TableRow>
                );
              }
              const q = qtyOf(l.crItem);
              const over = on && Number(q) > l.remaining;
              return (
                <TableRow key={l.crItem} hover>
                  <TableCell padding="checkbox">
                    <Checkbox size="small" checked={on} onChange={(e) => set(l.crItem, e.target.checked ? l.remaining : null)} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{l.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{l.checkRequestNumber}{l.contractor ? ` · ${l.contractor}` : ''}</Typography>
                  </TableCell>
                  <TableCell align="right">{l.remaining} {l.unit}</TableCell>
                  <TableCell align="right">
                    <TextField size="small" type="number" disabled={!on} value={on ? q : ''} error={over}
                      helperText={over ? `Max ${l.remaining}` : ''}
                      onChange={(e) => set(l.crItem, e.target.value === '' ? 0 : Number(e.target.value))}
                      inputProps={{ min: 0, max: l.remaining, step: 'any' }} />
                  </TableCell>
                  <TableCell align="right">{l.clientRate ? fmt(l.clientRate) : <Typography variant="caption" color="error.main">No BOQ rate</Typography>}</TableCell>
                  <TableCell align="right">{on ? fmt((Number(q) || 0) * l.clientRate) : '—'}</TableCell>
                  <TableCell align="right">{on ? fmt((Number(q) || 0) * l.costRate) : '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" justifyContent="flex-end" gap={3} sx={{ mt: 1 }}>
        <Typography variant="body2">Client amount: <strong>{fmt(clientTotal)}</strong></Typography>
        <Typography variant="body2">Subcontract cost: <strong>{fmt(costTotal)}</strong></Typography>
        <Typography variant="body2" color={clientTotal - costTotal >= 0 ? 'success.main' : 'error.main'}>
          Margin: <strong>{fmt(clientTotal - costTotal)}</strong>{clientTotal > 0 ? ` (${Math.round(((clientTotal - costTotal) / clientTotal) * 100)}%)` : ''}
        </Typography>
      </Stack>
    </Box>
  );
}
