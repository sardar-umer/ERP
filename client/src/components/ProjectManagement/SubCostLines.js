import React from 'react';
import {
  Box, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography
} from '@mui/material';
import { Warning as WarnIcon } from '@mui/icons-material';
import { Empty, fmt } from './mainProjectUi';

/**
 * Sub Project cost report detail: BOQ lines (budget → contracted → verified → billed → approved)
 * and slab-wise contracts per slab. `contractor` / `type` / `query` narrow what is shown.
 */
export default function SubCostLines({ data, contractor = null, type = 'all', query = '' }) {
  const q = query.trim().toLowerCase();
  const showLines = type === 'all' || type === 'BOQ';
  const showSlabs = type === 'all' || type === 'Slab';
  const lines = data.lines.filter((l) => (!contractor || l.contractors.includes(contractor))
    && (!q || [l.title, ...l.contractors].some((v) => (v || '').toLowerCase().includes(q))));
  const slabContracts = data.slabContracts.filter((c) => (!contractor || c.contractor === contractor)
    && (!q || [c.contractNumber, c.contractor, ...c.slabs.map((sl) => sl.name)].some((v) => (v || '').toLowerCase().includes(q))));

  if ((!showLines || !lines.length) && (!showSlabs || !slabContracts.length)) {
    return <Empty>No BOQ lines or slab contracts match.</Empty>;
  }

  return (
    <Box>
      {showLines && (
        <>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>BOQ lines</Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  {['Item', 'Scope qty', 'Budget', 'Contracted', 'Verified', 'Billed', 'Approved', 'Variance'].map((h, i) => (
                    <TableCell key={h} align={i ? 'right' : 'left'}><strong>{h}</strong></TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.boqItem} sx={{ bgcolor: l.flags.length ? 'rgba(237,108,2,0.06)' : undefined }}>
                    <TableCell>
                      <Stack direction="row" alignItems="center" gap={0.75}>
                        {l.flags.length > 0 && (
                          <Tooltip title={l.flags.join(' · ')}><WarnIcon fontSize="small" color="warning" /></Tooltip>
                        )}
                        <Box>
                          <Typography variant="body2" fontWeight={600}>{l.title}</Typography>
                          {l.contractors.length > 0 && <Typography variant="caption" color="text.secondary">{l.contractors.join(', ')}</Typography>}
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{l.scopeQty} {l.unit}</TableCell>
                    <TableCell align="right">{fmt(l.budget)}</TableCell>
                    <TableCell align="right">{fmt(l.contracted)}<Typography variant="caption" display="block" color="text.secondary">{l.contractedQty} {l.unit}</Typography></TableCell>
                    <TableCell align="right">{fmt(l.verified)}<Typography variant="caption" display="block" color="text.secondary">{l.verifiedQty} {l.unit}</Typography></TableCell>
                    <TableCell align="right">{fmt(l.billed)}<Typography variant="caption" display="block" color="text.secondary">{l.billedQty} {l.unit}</Typography></TableCell>
                    <TableCell align="right">{fmt(l.approved)}</TableCell>
                    <TableCell align="right" sx={{ color: l.variance > 0 ? 'error.main' : 'success.main' }}>{fmt(l.variance)}</TableCell>
                  </TableRow>
                ))}
                {!lines.length && (
                  <TableRow><TableCell colSpan={8} align="center"><Typography color="text.secondary" py={2}>{data.lines.length ? 'No BOQ lines match' : 'No BOQ lines on this sub project'}</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {showSlabs && slabContracts.length > 0 && (
        <>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Slab-wise contracts</Typography>
          <Stack spacing={1.5}>
            {slabContracts.map((c) => (
              <Paper key={c.contractNumber} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
                  <Typography variant="body2" fontWeight={700}>{c.contractNumber} · {c.contractor}</Typography>
                  <Typography variant="body2">Value {fmt(c.value)} · {c.status}</Typography>
                </Stack>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {['Slab', 'Share', 'Amount', 'Verified', 'Billed', 'Approved'].map((h, i) => <TableCell key={h} align={i ? 'right' : 'left'}>{h}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {c.slabs.map((sl) => (
                      <TableRow key={sl.name}>
                        <TableCell>
                          {sl.name}
                          {sl.activities.length > 0 && <Typography variant="caption" display="block" color="text.secondary">{sl.activities.join(', ')}</Typography>}
                        </TableCell>
                        <TableCell align="right">{sl.percentage}%</TableCell>
                        <TableCell align="right">{fmt(sl.amount)}</TableCell>
                        <TableCell align="right">{sl.verified ? fmt(sl.verified) : '—'}</TableCell>
                        <TableCell align="right">{sl.billed ? fmt(sl.billed) : '—'}</TableCell>
                        <TableCell align="right">{sl.approved ? fmt(sl.approved) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
