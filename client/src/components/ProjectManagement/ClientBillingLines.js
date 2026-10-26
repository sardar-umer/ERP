import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Checkbox, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography
} from '@mui/material';
import api from '../../services/api';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));

/**
 * Pick verified work to bill to the client: each check-request line's verified quantity not yet billed,
 * priced at the BOQ (client) rate, with the subcontractor cost alongside for margin.
 * `value` / `onChange` = [{ crItem, quantity }].
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

  const qtyOf = (crItem) => value.find((v) => v.crItem === crItem)?.quantity;
  const set = (crItem, quantity) => {
    const rest = value.filter((v) => v.crItem !== crItem);
    onChange(quantity === null ? rest : [...rest, { crItem, quantity }]);
  };
  const chosen = lines.filter((l) => qtyOf(l.crItem) !== undefined);
  const clientTotal = chosen.reduce((t, l) => t + (Number(qtyOf(l.crItem)) || 0) * l.clientRate, 0);
  const costTotal = chosen.reduce((t, l) => t + (Number(qtyOf(l.crItem)) || 0) * l.costRate, 0);

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
                  onChange={(e) => onChange(e.target.checked ? lines.map((l) => ({ crItem: l.crItem, quantity: l.remaining })) : [])}
                />
              </TableCell>
              <TableCell>Work (check request)</TableCell>
              <TableCell align="right">Unbilled</TableCell>
              <TableCell align="right" sx={{ width: 120 }}>Bill now</TableCell>
              <TableCell align="right">Client rate</TableCell>
              <TableCell align="right">Client amount</TableCell>
              <TableCell align="right">Subcontract cost</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l) => {
              const q = qtyOf(l.crItem);
              const on = q !== undefined;
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
