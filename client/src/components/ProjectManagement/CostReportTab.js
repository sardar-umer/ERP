import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Grid, LinearProgress, Paper, Skeleton, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography
} from '@mui/material';
import { Refresh as RefreshIcon, Warning as WarnIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const Kpi = ({ label, value, hint, color }) => (
  <Card variant="outlined" sx={{ height: '100%' }}>
    <CardContent sx={{ py: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" fontWeight={700} color={color}>{fmt(value)}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </CardContent>
  </Card>
);

/** Budget vs actual: Sub Project → per BOQ line and slab; Main Project → per Sub Project. */
export default function CostReportTab({ project }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await api.get(`/project-management/projects/${project._id}/cost-report`);
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the cost report');
    }
  }, [project._id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <Skeleton height={300} />;
  const s = data.summary || {};

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Budget vs Actual</Typography>
          <Typography variant="body2" color="text.secondary">
            Budget (BOQ) → contracted (sublet) → verified (check requests) → billed (IPCs) → approved (CEO) → paid (Finance)
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} md={2}><Kpi label="Budget" value={s.budget} hint={data.level === 'main' && s.lumpSumBudget ? `Main envelope ${fmt(s.lumpSumBudget)}` : null} /></Grid>
        <Grid item xs={6} md={2}><Kpi label="Contracted" value={s.contracted} color={s.contracted > s.budget ? 'error.main' : undefined} hint={`${pct(s.contracted, s.budget)}% of budget`} /></Grid>
        <Grid item xs={6} md={2}><Kpi label="Verified work" value={s.verified} hint={`${pct(s.verified, s.contracted)}% of contracted`} /></Grid>
        <Grid item xs={6} md={2}><Kpi label="Billed (IPCs)" value={s.billed} /></Grid>
        <Grid item xs={6} md={2}><Kpi label="CEO approved" value={s.approved} /></Grid>
        <Grid item xs={6} md={2}><Kpi label="Paid by Finance" value={s.paid} color="success.main" /></Grid>
      </Grid>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
        <Chip label={`Variance (contracted − budget): ${fmt(s.variance)}`} color={s.variance > 0 ? 'error' : 'success'} variant="outlined" />
        <Chip label={`Retention held: ${fmt(s.retentionHeld)}`} variant="outlined" />
        <Chip label={`Advance outstanding: ${fmt(s.advanceOutstanding)}`} variant="outlined" />
        {s.linesOverBudget > 0 && <Chip icon={<WarnIcon />} color="warning" label={`${s.linesOverBudget} line(s) need attention`} />}
      </Stack>

      {data.level === 'main' ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                {['Sub Project', 'Budget', 'Contracted', 'Verified', 'Billed', 'Approved', 'Paid', 'Variance', 'Progress (verified / contracted)'].map((h, i) => (
                  <TableCell key={h} align={i ? 'right' : 'left'}><strong>{h}</strong></TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.subProjects.map((r) => (
                <TableRow key={r.project._id} hover sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/general/project-management/${r.project._id}?tab=cost`)}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{r.project.name}</Typography>
                    {r.linesOverBudget > 0 && <Typography variant="caption" color="warning.main">{r.linesOverBudget} line(s) need attention</Typography>}
                  </TableCell>
                  <TableCell align="right">{fmt(r.budget)}</TableCell>
                  <TableCell align="right">{fmt(r.contracted)}</TableCell>
                  <TableCell align="right">{fmt(r.verified)}</TableCell>
                  <TableCell align="right">{fmt(r.billed)}</TableCell>
                  <TableCell align="right">{fmt(r.approved)}</TableCell>
                  <TableCell align="right">{fmt(r.paid)}</TableCell>
                  <TableCell align="right" sx={{ color: r.variance > 0 ? 'error.main' : 'success.main' }}>{fmt(r.variance)}</TableCell>
                  <TableCell align="right" sx={{ minWidth: 140 }}>
                    <LinearProgress variant="determinate" value={Math.min(100, pct(r.verified, r.contracted))} sx={{ height: 6, borderRadius: 3 }} />
                    <Typography variant="caption">{pct(r.verified, r.contracted)}%</Typography>
                  </TableCell>
                </TableRow>
              ))}
              {!data.subProjects.length && (
                <TableRow><TableCell colSpan={9} align="center"><Typography color="text.secondary" py={2}>No Sub Projects yet</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
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
                {data.lines.map((l) => (
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
                {!data.lines.length && (
                  <TableRow><TableCell colSpan={8} align="center"><Typography color="text.secondary" py={2}>No BOQ lines on this Sub Project</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {data.slabContracts.length > 0 && (
            <>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Slab-wise contracts</Typography>
              <Stack spacing={1.5}>
                {data.slabContracts.map((c) => (
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
        </>
      )}
    </Box>
  );
}
