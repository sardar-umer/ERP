import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography
} from '@mui/material';
import { History as HistoryIcon } from '@mui/icons-material';
import api from '../../services/api';

const TYPE_LABELS = {
  joining: { label: 'Joining', color: 'success' },
  leaving: { label: 'Leaving', color: 'error' },
  increment: { label: 'Increment', color: 'primary' },
  payroll: { label: 'Payroll', color: 'default' },
  leave: { label: 'Leave', color: 'info' },
  loan: { label: 'Loan', color: 'warning' },
  advance: { label: 'Advance', color: 'warning' },
  salary_cut: { label: 'Salary Cut', color: 'error' },
  kpi: { label: 'KPI', color: 'secondary' },
  settlement: { label: 'Settlement', color: 'error' }
};

const fmtDate = (d, withTime = false) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
};

/** Employee History: timeline from existing records + change log of edits (old → new, who, when). */
const EmployeeHistory = ({ employeeId }) => {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState({ timeline: [], changes: [] });
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    if (!employeeId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get(`/hr/employees/${employeeId}/history`)
      .then((res) => { if (!cancelled) setData(res.data?.data || { timeline: [], changes: [] }); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Could not load employee history'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employeeId]);

  const typesPresent = useMemo(() => [...new Set((data.timeline || []).map((t) => t.type))], [data.timeline]);
  const timeline = useMemo(
    () => (data.timeline || []).filter((t) => typeFilter === 'all' || t.type === typeFilter),
    [data.timeline, typeFilter]
  );

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryIcon />
          Employee History
        </Typography>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={`Timeline (${(data.timeline || []).length})`} />
          <Tab label={`Changes (${(data.changes || []).length})`} />
        </Tabs>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>
        )}
        {!loading && error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && tab === 0 && (
          <>
            {typesPresent.length > 1 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                <Chip
                  label="All"
                  size="small"
                  color={typeFilter === 'all' ? 'primary' : 'default'}
                  variant={typeFilter === 'all' ? 'filled' : 'outlined'}
                  onClick={() => setTypeFilter('all')}
                />
                {typesPresent.map((t) => (
                  <Chip
                    key={t}
                    label={TYPE_LABELS[t]?.label || t}
                    size="small"
                    color={typeFilter === t ? 'primary' : 'default'}
                    variant={typeFilter === t ? 'filled' : 'outlined'}
                    onClick={() => setTypeFilter(t)}
                  />
                ))}
              </Stack>
            )}
            {timeline.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No history records yet.</Typography>
            ) : (
              <TableContainer sx={{ maxHeight: 480 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, width: 120 }}>Date</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 120 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Event</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {timeline.map((t, i) => (
                      <TableRow key={`${t.type}-${t.date}-${i}`} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(t.date)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={TYPE_LABELS[t.type]?.label || t.type} color={TYPE_LABELS[t.type]?.color || 'default'} variant="outlined" />
                        </TableCell>
                        <TableCell>{t.title}</TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>{t.details}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}

        {!loading && !error && tab === 1 && (
          (data.changes || []).length === 0 ? (
            <Alert severity="info">
              No changes recorded yet. From now on, every change to this employee&apos;s record (designation, department,
              project, salary, allowances, status, reporting line, bank, …) is saved here with the old and new value,
              who made it and when.
            </Alert>
          ) : (
            <TableContainer sx={{ maxHeight: 480 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, width: 170 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 160 }}>Changed By</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Field</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Old Value</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>New Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.changes.flatMap((c) => (c.changes || []).map((ch, i) => (
                    <TableRow key={`${c._id}-${ch.field}`} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{i === 0 ? fmtDate(c.changedAt, true) : ''}</TableCell>
                      <TableCell>{i === 0 ? c.changedBy : ''}</TableCell>
                      <TableCell>{ch.label}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{ch.from || '—'}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{ch.to || '—'}</TableCell>
                    </TableRow>
                  )))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        )}
      </CardContent>
    </Card>
  );
};

export default EmployeeHistory;
