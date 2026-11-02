import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, CircularProgress, LinearProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography
} from '@mui/material';
import { getProjectUnitProgress } from '../../services/projectManagementService';
import { fmt, progressColor } from './mainProjectUi';

/** Cell look per claim state of a villa's stage */
const CELL = {
  'Not claimed': { label: '—', bg: '#f1f5f9', color: '#94a3b8' },
  Draft: { label: 'Draft', bg: '#f1f5f9', color: '#475569' },
  Rejected: { label: 'Rejected', bg: '#fee2e2', color: '#b91c1c' },
  Submitted: { label: 'Claimed', bg: '#fef3c7', color: '#b45309' },
  Verified: { label: 'Done', bg: '#dcfce7', color: '#15803d' },
  Billed: { label: 'Billed', bg: '#dbeafe', color: '#1d4ed8' }
};

const Legend = () => (
  <Stack direction="row" gap={1.5} flexWrap="wrap">
    {['Not claimed', 'Submitted', 'Verified', 'Billed'].map((k) => (
      <Stack key={k} direction="row" alignItems="center" gap={0.5}>
        <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: CELL[k].bg, border: `1px solid ${CELL[k].color}` }} />
        <Typography variant="caption" color="text.secondary">{k === 'Submitted' ? 'Claimed, awaiting check' : k === 'Verified' ? 'Done (verified)' : k}</Typography>
      </Stack>
    ))}
  </Stack>
);

/**
 * Villa × stage grid for one Sub Project: a row per villa, a column per slab of each slab-wise
 * contract, coloured by the claim state, with each villa's progress by value.
 */
export default function UnitProgressGrid({ projectId, word: wordProp, compact = false, reloadKey, onLoaded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProjectUnitProgress(projectId);
      setData(res.data?.data || null);
      setError('');
      onLoaded?.(res.data?.data?.units?.length || 0, res.data?.data?.unitNamePlural);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load progress');
    } finally {
      setLoading(false);
    }
  }, [projectId, onLoaded]);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (loading && !data) return <Box textAlign="center" py={3}><CircularProgress size={24} /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data?.units?.length) return null;

  const { units, columns, summary } = data;
  // Villa / Floor / Unit / Section — from the Sub Project's type
  const word = wordProp || data.unitName || 'Unit';
  // Group stage columns under their contract
  const groups = [];
  columns.forEach((c) => {
    const last = groups[groups.length - 1];
    if (last && String(last.contract) === String(c.contract)) last.cols.push(c);
    else groups.push({ contract: c.contract, contractNumber: c.contractNumber, contractor: c.contractor, cols: [c] });
  });

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1} sx={{ mb: 1.5 }}>
        <Stack direction="row" gap={3} flexWrap="wrap">
          <Box>
            <Typography variant="caption" color="text.secondary">Overall</Typography>
            <Typography variant="h6" fontWeight={800}>{summary.progress}%</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Complete</Typography>
            <Typography variant="h6" fontWeight={800}>{summary.complete} / {summary.units}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Started</Typography>
            <Typography variant="h6" fontWeight={800}>{summary.started} / {summary.units}</Typography>
          </Box>
        </Stack>
        {!compact && columns.length > 0 && <Legend />}
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: compact ? 360 : 560 }}>
        <Table size="small" stickyHeader sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            {groups.length > 0 && (
              <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: 12 } }}>
                <TableCell colSpan={2} />
                {groups.map((g) => (
                  <TableCell key={g.contract} colSpan={g.cols.length} align="center" sx={{ borderLeft: '1px solid #e2e8f0' }}>
                    {g.contractNumber}{g.contractor ? ` · ${g.contractor}` : ''}
                  </TableCell>
                ))}
              </TableRow>
            )}
            <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: 12, top: groups.length ? 33 : 0 } }}>
              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3 }}>{word}</TableCell>
              <TableCell sx={{ minWidth: 140 }}>Progress</TableCell>
              {columns.map((c, i) => (
                <TableCell
                  key={c.key}
                  align="center"
                  sx={{ borderLeft: i === 0 || groups.some((g) => g.cols[0].key === c.key) ? '1px solid #e2e8f0' : undefined }}
                >
                  {c.slab}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>{c.percentage}%</Typography>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {units.map((u) => (
              <TableRow key={u._id} hover>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: '#fff', zIndex: 1, fontWeight: 600 }}>
                  {u.name}
                  {u.plotNumber && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>{u.plotNumber}</Typography>}
                </TableCell>
                <TableCell>
                  <Tooltip title={u.value > 0 ? `${fmt(u.done)} of ${fmt(u.value)} done${u.boqVerified ? ` · BOQ work ${fmt(u.boqVerified)}` : ''}` : `No contract covers this ${word.toLowerCase()} yet`}>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <LinearProgress
                        variant="determinate"
                        value={u.progress}
                        color={progressColor(u.progress)}
                        sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: '#eef2f6' }}
                      />
                      <Typography variant="caption" fontWeight={700} sx={{ minWidth: 34, textAlign: 'right' }}>
                        {u.value > 0 ? `${u.progress}%` : '—'}
                      </Typography>
                    </Stack>
                  </Tooltip>
                </TableCell>
                {columns.map((c, i) => {
                  const cell = u.cells[c.key];
                  const look = cell ? CELL[cell.status] || CELL.Draft : null;
                  return (
                    <TableCell
                      key={c.key}
                      align="center"
                      sx={{ borderLeft: i === 0 || groups.some((g) => g.cols[0].key === c.key) ? '1px solid #e2e8f0' : undefined, py: 0.5 }}
                    >
                      {look ? (
                        <Tooltip title={cell.checkRequestNumber ? `${cell.checkRequestNumber} · ${cell.status}` : 'Not claimed yet'}>
                          <Box sx={{ display: 'inline-block', px: 1, py: 0.25, borderRadius: 1, bgcolor: look.bg, color: look.color, fontSize: 12, fontWeight: 700, minWidth: 56 }}>
                            {look.label}
                          </Box>
                        </Tooltip>
                      ) : (
                        <Tooltip title={`Not on ${c.contractNumber}`}>
                          <Typography variant="caption" color="text.disabled">n/a</Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!columns.length && (
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
          No slab-wise contracts yet — progress here comes from verified claims on contracts covering each {word.toLowerCase()}.
        </Typography>
      )}
    </Box>
  );
}
