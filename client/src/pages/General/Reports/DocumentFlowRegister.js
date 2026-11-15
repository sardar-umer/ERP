import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Timeline as TimelineIcon
} from '@mui/icons-material';
import DocumentFlowGraphs from './DocumentFlowGraphs';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import api from '../../../services/api';

const KINDS = [
  { key: 'indent', label: 'Indents' },
  { key: 'purchase_order', label: 'Purchase Orders' },
  { key: 'cash_approval', label: 'Cash Approvals' },
  { key: 'vendor_bill', label: 'Vendor Bills' },
  { key: 'utility_bill', label: 'Utility Bills' }
];

const formatDuration = (minutes) => {
  if (minutes === null || minutes === undefined) return '';
  const m = Number(minutes) || 0;
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)} h`;
  const d = m / (60 * 24);
  return `${d.toFixed(d < 10 ? 1 : 0)} days`;
};

const toDays = (minutes) => (minutes === null || minutes === undefined ? '' : Math.round((minutes / 1440) * 100) / 100);
const fmtDate = (v) => (v ? dayjs(v).format('DD MMM YYYY') : '');
const fmtDateTime = (v) => (v ? dayjs(v).format('DD MMM YYYY hh:mm A') : '');
const SLOW_MINUTES = 3 * 24 * 60;

/** The whole journey as one line: "Draft → Pending Audit (2 days) → Approved". */
const flowText = (visits) =>
  visits
    .map((v) => `${v.stage}${v.minutes !== null && v.minutes >= 1 ? ` (${formatDuration(v.minutes)})` : ''}`)
    .join(' → ');

/** A stage can be visited more than once (returned and resubmitted) — show the latest visit and the total time. */
const stageCell = (visits, stage) => {
  const own = visits.filter((v) => v.stage === stage);
  if (!own.length) return null;
  const last = own[own.length - 1];
  const timed = own.filter((v) => v.minutes !== null);
  return {
    at: last.at,
    by: last.by,
    remark: last.remark,
    times: own.length,
    minutes: timed.length ? timed.reduce((s, v) => s + v.minutes, 0) : null
  };
};

const headSx = { fontWeight: 700, whiteSpace: 'nowrap', bgcolor: 'grey.100' };

const DocumentFlowRegister = () => {
  const navigate = useNavigate();
  const [kind, setKind] = useState('purchase_order');
  const [from, setFrom] = useState(dayjs().subtract(90, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [state, setState] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [reloadKey, setReloadKey] = useState(0);
  const isGraphs = kind === 'graphs';

  const load = useCallback(async () => {
    if (kind === 'graphs') {
      setData(null);
      setReloadKey((k) => k + 1);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/general-reports/flow-register', {
        params: { kind, from, to, state, q: appliedSearch }
      });
      setData(res.data?.data || null);
      setPage(0);
    } catch (e) {
      setData(null);
      setError(e.response?.data?.message || 'Could not load the document flow report');
    } finally {
      setLoading(false);
    }
  }, [kind, from, to, state, appliedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const rows = useMemo(() => data?.rows || [], [data]);
  const stageColumns = useMemo(() => data?.stageColumns || [], [data]);
  const kindLabel = KINDS.find((k) => k.key === kind)?.label || 'Documents';

  const totals = useMemo(() => {
    const open = rows.filter((r) => r.isOpen).length;
    const done = rows.filter((r) => !r.isOpen);
    const avgDone = done.length ? done.reduce((s, r) => s + r.totalMinutes, 0) / done.length : null;
    return { open, completed: done.length, avgDone, returned: rows.filter((r) => r.returns > 0).length };
  }, [rows]);

  const stageOwners = useMemo(() => data?.stageOwners || {}, [data]);
  const exportExcel = () => {
    const head = ['Sr', 'Document No', 'Title / Vendor', 'Amount (PKR)', 'Linked Documents', 'Initiated By', 'Initiated On'];
    stageColumns.forEach((s) => {
      const name = stageOwners[s] && stageOwners[s].toLowerCase() !== s.toLowerCase() ? `${s} (${stageOwners[s]})` : s;
      head.push(`${name} - Date`, `${name} - By`, `${name} - Days Spent`);
    });
    head.push('Current Status', 'Pending With', 'Last Action On', 'Last Action By', 'Total Days', 'Times Returned / Rejected', 'Last Remark', 'Full Flow');

    const body = rows.map((r, i) => {
      const line = [i + 1, r.number, r.party || r.title, r.amount || '', r.linked, r.initiatedBy, fmtDateTime(r.initiatedAt)];
      stageColumns.forEach((s) => {
        const c = stageCell(r.visits, s);
        line.push(c ? fmtDateTime(c.at) : '', c ? c.by : '', c ? toDays(c.minutes) : '');
      });
      line.push(
        r.status,
        r.pendingWith || (r.isOpen ? '' : 'Completed'),
        fmtDateTime(r.lastActionAt),
        r.lastActionBy,
        toDays(r.totalMinutes),
        r.returns,
        r.lastRemark,
        flowText(r.visits)
      );
      return line;
    });

    const title = [`${kindLabel} — Document Flow Report`];
    const sub = [`Created ${fmtDate(data.period.from)} to ${fmtDate(data.period.to)} · ${rows.length} documents · generated ${fmtDateTime(data.generatedAt)}`];
    const ws = XLSX.utils.aoa_to_sheet([title, sub, [], head, ...body]);
    ws['!cols'] = head.map((h, i) => ({
      wch: i === head.length - 1 ? 90 : i === 2 || h === 'Last Remark' ? 32 : Math.min(28, Math.max(12, h.length + 2))
    }));
    ws['!freeze'] = { xSplit: 2, ySplit: 4 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, kindLabel.slice(0, 31));
    XLSX.writeFile(wb, `document-flow-${kind}-${dayjs().format('YYYY-MM-DD')}.xlsx`);
  };

  const pageRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Document Flow Report
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Every document on one row: who initiated it, each stage it reached, when, by whom, and how long it stayed there.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {!isGraphs ? (
            <Button startIcon={<DownloadIcon />} variant="contained" color="success" onClick={exportExcel} disabled={!rows.length}>
              Download Excel
            </Button>
          ) : null}
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={kind} onChange={(_, v) => setKind(v)} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider' }}>
          {KINDS.map((k) => (
            <Tab key={k.key} value={k.key} label={k.label} />
          ))}
          <Tab value="graphs" label="Graphs" />
        </Tabs>
        <Box sx={{ p: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={6} md={2}>
              <TextField fullWidth size="small" type="date" label="Created from" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={6} md={2}>
              <TextField fullWidth size="small" type="date" label="Created to" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
            </Grid>
            {!isGraphs ? (
              <>
            <Grid item xs={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Show</InputLabel>
                <Select value={state} label="Show" onChange={(e) => setState(e.target.value)}>
                  <MenuItem value="all">All documents</MenuItem>
                  <MenuItem value="open">In progress only</MenuItem>
                  <MenuItem value="completed">Completed only</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} md={3}>
              <TextField fullWidth size="small" label="Search number / vendor" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Grid>
            <Grid item xs={12} md={3}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={`${rows.length} documents`} />
                <Chip size="small" color="warning" variant="outlined" label={`${totals.open} in progress`} />
                <Chip size="small" color="success" variant="outlined" label={`${totals.completed} completed`} />
                {totals.avgDone !== null ? <Chip size="small" variant="outlined" label={`avg ${formatDuration(Math.round(totals.avgDone))} to complete`} /> : null}
                {totals.returned ? <Chip size="small" color="error" variant="outlined" label={`${totals.returned} returned / rejected`} /> : null}
              </Stack>
            </Grid>
              </>
            ) : null}
          </Grid>
        </Box>
        {loading ? <LinearProgress /> : null}
      </Paper>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {data?.truncated ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Showing the latest 2,000 documents. Narrow the dates to see the rest.
        </Alert>
      ) : null}

      {data && !isGraphs ? (
        <Paper variant="outlined">
          <TableContainer sx={{ maxHeight: 'calc(100vh - 330px)' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={headSx}>Sr</TableCell>
                  <TableCell sx={{ ...headSx, position: 'sticky', left: 0, zIndex: 4 }}>Document</TableCell>
                  <TableCell sx={headSx}>Initiated</TableCell>
                  {stageColumns.map((s) => (
                    <TableCell key={s} sx={headSx}>
                      {s}
                      {stageOwners[s] && stageOwners[s].toLowerCase() !== s.toLowerCase() ? (
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ fontWeight: 400 }}>
                          {stageOwners[s]}
                        </Typography>
                      ) : null}
                    </TableCell>
                  ))}
                  <TableCell sx={headSx}>Current status</TableCell>
                  <TableCell sx={headSx} align="right">
                    Total time
                  </TableCell>
                  <TableCell sx={{ ...headSx, minWidth: 380 }}>Full flow</TableCell>
                  <TableCell sx={headSx} />
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((r, i) => (
                  <TableRow key={r.id} hover sx={{ verticalAlign: 'top' }}>
                    <TableCell>{page * rowsPerPage + i + 1}</TableCell>
                    <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, minWidth: 190, borderRight: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {r.number}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        {r.party || r.title}
                      </Typography>
                      {r.amount ? (
                        <Typography variant="caption" component="div">
                          PKR {Math.round(r.amount).toLocaleString('en-PK')}
                        </Typography>
                      ) : null}
                      {r.linked ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          Linked: {r.linked}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2">{fmtDate(r.initiatedAt)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.initiatedBy}
                      </Typography>
                    </TableCell>
                    {stageColumns.map((s) => {
                      const c = stageCell(r.visits, s);
                      if (!c) {
                        return (
                          <TableCell key={s} sx={{ color: 'text.disabled' }}>
                            —
                          </TableCell>
                        );
                      }
                      const slow = c.minutes !== null && c.minutes >= SLOW_MINUTES;
                      return (
                        <TableCell key={s} sx={{ whiteSpace: 'nowrap' }}>
                          <Tooltip title={c.remark ? `“${c.remark}”` : ''} placement="top" arrow>
                            <Box>
                              <Typography variant="body2">{fmtDate(c.at)}</Typography>
                              <Typography variant="caption" color="text.secondary" component="div">
                                {c.by || '—'}
                              </Typography>
                              {c.minutes !== null ? (
                                <Typography variant="caption" component="div" sx={{ fontWeight: 600, color: slow ? 'warning.dark' : 'text.secondary' }}>
                                  {formatDuration(c.minutes)}
                                  {c.times > 1 ? ` · ${c.times}×` : ''}
                                </Typography>
                              ) : null}
                            </Box>
                          </Tooltip>
                        </TableCell>
                      );
                    })}
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip size="small" label={r.status || '—'} color={r.isOpen ? 'warning' : 'success'} variant="outlined" />
                      {r.pendingWith ? (
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                          with {r.pendingWith}
                        </Typography>
                      ) : null}
                      {r.returns ? (
                        <Typography variant="caption" color="error" component="div">
                          returned / rejected {r.returns}×
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {formatDuration(r.totalMinutes)}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ lineHeight: 1.5 }}>
                        {flowText(r.visits)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip title="Step-by-step detail">
                        <IconButton size="small" onClick={() => navigate(`/general/reports/document-trace?kind=${r.kind}&id=${r.id}`)}>
                          <TimelineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && !loading ? (
                  <TableRow>
                    <TableCell colSpan={stageColumns.length + 7} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                      No {kindLabel.toLowerCase()} were created in this period.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={rows.length}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[25, 50, 100, 250]}
          />
        </Paper>
      ) : null}

      {isGraphs ? <DocumentFlowGraphs kinds={KINDS} from={from} to={to} reloadKey={reloadKey} /> : null}
    </Box>
  );
};

export default DocumentFlowRegister;
