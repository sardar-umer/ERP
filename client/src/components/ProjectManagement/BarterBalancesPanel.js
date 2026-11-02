import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography
} from '@mui/material';
import { getBarterBalances } from '../../services/projectManagementService';
import { fmt } from './mainProjectUi';

/**
 * Barter position per contractor on a Sub Project: property agreed, earned on approved IPCs,
 * handed over, and what is still owed in property — next to the cash side.
 */
export default function BarterBalancesPanel({ projectId, reloadKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getBarterBalances(projectId);
      setRows(res.data?.data || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load barter balances');
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (error) return <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>;
  if (!rows?.length) return null;

  return (
    <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: 'hidden', borderColor: '#fde68a' }}>
      <Box sx={{ px: 2, py: 1.25, bgcolor: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
        <Typography variant="subtitle2" fontWeight={800}>Barter balances</Typography>
        <Typography variant="caption" color="text.secondary">
          Property is earned as IPCs are CEO-approved, and can be handed over up to what has been earned.
        </Typography>
      </Box>
      <TableContainer>
        <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, fontSize: 12, bgcolor: '#f8fafc' } }}>
              <TableCell>Subcontractor</TableCell>
              <TableCell align="right">Property share</TableCell>
              <TableCell align="right">Earned (approved)</TableCell>
              <TableCell align="right">Handed over</TableCell>
              <TableCell align="right">Owed in property</TableCell>
              <TableCell align="right">Still to earn</TableCell>
              <TableCell align="right">Cash certified</TableCell>
              <TableCell align="right">Cash paid</TableCell>
              <TableCell>Properties</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.contractor?._id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={700}>{b.contractor?.name || '—'}</Typography>
                  <Typography variant="caption" color="text.secondary">{b.contracts.map((c) => `${c.contractNumber} (${c.propertyPercent}%)`).join(', ')}</Typography>
                </TableCell>
                <TableCell align="right">{fmt(b.propertyShare)}</TableCell>
                <TableCell align="right">
                  {fmt(b.propertyEarned)}
                  {b.propertyInApproval > 0 && <Typography variant="caption" color="text.secondary" display="block">+ {fmt(b.propertyInApproval)} in approval</Typography>}
                </TableCell>
                <TableCell align="right">{fmt(b.handedOver)}</TableCell>
                <TableCell align="right">
                  <Typography variant="body2" fontWeight={800} color={b.owedInProperty > 0 ? 'warning.main' : 'text.primary'}>{fmt(b.owedInProperty)}</Typography>
                </TableCell>
                <TableCell align="right">{fmt(b.propertyToEarn)}</TableCell>
                <TableCell align="right">{fmt(b.cashCertified)}</TableCell>
                <TableCell align="right">{fmt(b.cashPaid)}</TableCell>
                <TableCell>
                  <Stack direction="row" gap={0.5} flexWrap="wrap">
                    {b.properties.length ? b.properties.map((p) => (
                      <Tooltip key={p._id} title={`${p.contractNumber} · ${fmt(p.agreedValue)}${p.handoverReference ? ` · ${p.handoverReference}` : ''}`}>
                        <Chip size="small" variant={p.status === 'Handed over' ? 'filled' : 'outlined'} color={p.status === 'Handed over' ? 'success' : 'default'} label={p.label} />
                      </Tooltip>
                    )) : <Typography variant="caption" color="text.secondary">None yet</Typography>}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
