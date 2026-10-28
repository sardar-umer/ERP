import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Grid, InputAdornment, LinearProgress, MenuItem, Paper, Stack, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import storeService from '../../../services/storeService';
import { formatDate } from '../../../utils/dateUtils';
import { formatPKR } from '../../../utils/currency';

const SLOW_DAY_OPTIONS = [30, 60, 90, 180, 365];

const downloadCsv = (filename, header, lines) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...lines].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const Kpi = ({ label, value, hint, color }) => (
  <Card variant="outlined" sx={{ height: '100%' }}>
    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" fontWeight={700} color={color || 'text.primary'}>{value}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </CardContent>
  </Card>
);

/** Totals per store or per project, with share of total value */
const groupTotals = (rows, key, nameKey) => {
  const map = new Map();
  rows.forEach((r) => {
    const g = map.get(String(r[key])) || { id: r[key], name: r[nameKey], items: 0, value: 0 };
    g.items += 1;
    g.value += r.value;
    map.set(String(r[key]), g);
  });
  return [...map.values()].sort((a, b) => b.value - a.value);
};

const StockReports = () => {
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stores, setStores] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState({ store: '', project: '', search: '' });
  const [slowDays, setSlowDays] = useState(90);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/procurement/store/stock-report', {
        params: { store: filters.store || undefined, project: filters.project || undefined, search: filters.search || undefined }
      });
      setRows(res.data?.data?.rows || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load stock report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(load, filters.search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, filters.search]);

  useEffect(() => {
    storeService.getStores({ activeOnly: 'true' }).then((r) => setStores(r?.data || [])).catch(() => setStores([]));
    api.get('/finance/fixed-assets/projects')
      .then((r) => setProjects(r.data?.data || []))
      .catch(() => api.get('/projects').then((r) => setProjects(Array.isArray(r.data?.data) ? r.data.data : [])).catch(() => setProjects([])));
  }, []);

  const totalValue = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);
  const byStore = useMemo(() => groupTotals(rows, 'store', 'storeName'), [rows]);
  const byProject = useMemo(() => groupTotals(rows, 'project', 'projectName'), [rows]);
  const slowRows = useMemo(
    () => rows.filter((r) => r.daysIdle == null || r.daysIdle >= slowDays).sort((a, b) => (b.daysIdle ?? 1e9) - (a.daysIdle ?? 1e9)),
    [rows, slowDays]
  );
  const slowValue = slowRows.reduce((s, r) => s + r.value, 0);
  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  const exportCurrent = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (tab === 0) {
      downloadCsv(`stock-on-hand-${stamp}.csv`, ['Store', 'Project', 'Item Code', 'Item', 'Unit', 'Qty', 'Unit Cost', 'Value', 'Last In', 'Last Out'],
        rows.map((r) => [r.storeName, r.projectName, r.itemCode, r.itemName, r.unit, r.balance, r.unitCost, r.value,
          r.lastIn ? formatDate(r.lastIn) : '', r.lastOut ? formatDate(r.lastOut) : '']));
    } else if (tab === 1) {
      downloadCsv(`stock-valuation-${stamp}.csv`, ['Group', 'Name', 'Item lines', 'Value'],
        [...byStore.map((g) => ['Store', g.name, g.items, g.value.toFixed(2)]), ...byProject.map((g) => ['Project', g.name, g.items, g.value.toFixed(2)])]);
    } else {
      downloadCsv(`slow-moving-${slowDays}d-${stamp}.csv`, ['Store', 'Project', 'Item Code', 'Item', 'Qty', 'Value', 'Last Out', 'Days Idle'],
        slowRows.map((r) => [r.storeName, r.projectName, r.itemCode, r.itemName, r.balance, r.value, r.lastOut ? formatDate(r.lastOut) : 'Never issued', r.daysIdle ?? '']));
    }
  };

  const ShareBar = ({ value }) => (
    <Stack direction="row" alignItems="center" spacing={1}>
      <LinearProgress variant="determinate" value={totalValue > 0 ? (value / totalValue) * 100 : 0} sx={{ flex: 1, height: 6, borderRadius: 3 }} />
      <Typography variant="caption" sx={{ width: 42, textAlign: 'right' }}>
        {totalValue > 0 ? `${((value / totalValue) * 100).toFixed(1)}%` : '—'}
      </Typography>
    </Stack>
  );

  const ValuationTable = ({ title, groups }) => (
    <Paper variant="outlined" sx={{ height: '100%' }}>
      <Typography variant="subtitle2" sx={{ p: 1.5, pb: 0.5 }}>{title}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell align="right">Item lines</TableCell>
            <TableCell align="right">Value</TableCell>
            <TableCell sx={{ width: 160 }}>Share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => (
            <TableRow key={String(g.id)} hover>
              <TableCell>{g.name}</TableCell>
              <TableCell align="right">{g.items}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>{formatPKR(g.value)}</TableCell>
              <TableCell><ShareBar value={g.value} /></TableCell>
            </TableRow>
          ))}
          {groups.length === 0 && <TableRow><TableCell colSpan={4} align="center" sx={{ color: 'text.secondary' }}>No stock</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Paper>
  );

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Stock Reports</Typography>
          <Typography variant="body2" color="text.secondary">Live from the stock ledger — every GRN, SIN, return and transfer.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refresh</Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCurrent} disabled={!rows.length}>Export CSV</Button>
        </Stack>
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} md={3}><Kpi label="Stock value" value={formatPKR(totalValue)} /></Grid>
        <Grid item xs={6} md={3}><Kpi label="Item lines in stock" value={rows.length} hint="store + project + item" /></Grid>
        <Grid item xs={6} md={3}><Kpi label="Stores holding stock" value={byStore.length} hint={`${byProject.length} project(s)`} /></Grid>
        <Grid item xs={6} md={3}>
          <Kpi label={`Slow-moving (${slowDays}+ days)`} value={formatPKR(slowValue)} hint={`${slowRows.length} line(s)`} color={slowRows.length ? 'warning.main' : undefined} />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <Grid container spacing={1.5}>
          <Grid item xs={12} sm={4}>
            <TextField select fullWidth size="small" label="Store" value={filters.store} onChange={setFilter('store')}>
              <MenuItem value="">All stores</MenuItem>
              {stores.map((s) => <MenuItem key={s._id} value={s._id}>{s.type === 'sub' ? `↳ ${s.name}` : s.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField select fullWidth size="small" label="Project" value={filters.project} onChange={setFilter('project')}>
              <MenuItem value="">All projects</MenuItem>
              {projects.map((p) => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" placeholder="Item name or code" value={filters.search} onChange={setFilter('search')}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
          </Grid>
        </Grid>
      </Paper>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1.5 }} variant="scrollable">
        <Tab label="Stock by Store / Project" />
        <Tab label="Valuation" />
        <Tab label={`Slow-moving (${slowRows.length})`} />
      </Tabs>
      {loading && <LinearProgress sx={{ mb: 1 }} />}

      {tab === 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Store</TableCell>
                <TableCell>Project</TableCell>
                <TableCell>Item</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Unit cost</TableCell>
                <TableCell align="right">Value</TableCell>
                <TableCell>Last in</TableCell>
                <TableCell>Last out</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.store}-${r.project}-${r.item}`} hover>
                  <TableCell>{r.storeName}</TableCell>
                  <TableCell>{r.projectName}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{r.itemName}</Typography>
                    <Typography variant="caption" color="text.secondary">{r.itemCode}{r.category ? ` · ${r.category}` : ''}</Typography>
                  </TableCell>
                  <TableCell align="right">{r.balance} {r.unit}</TableCell>
                  <TableCell align="right">{formatPKR(r.unitCost)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatPKR(r.value)}</TableCell>
                  <TableCell>{r.lastIn ? formatDate(r.lastIn) : '—'}</TableCell>
                  <TableCell>{r.lastOut ? formatDate(r.lastOut) : '—'}</TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>No stock for these filters</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tab === 1 && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}><ValuationTable title="By store" groups={byStore} /></Grid>
          <Grid item xs={12} md={6}><ValuationTable title="By project" groups={byProject} /></Grid>
        </Grid>
      )}

      {tab === 2 && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} gap={1.5} sx={{ mb: 1.5 }}>
            <TextField select size="small" label="Not issued for" value={slowDays} onChange={(e) => setSlowDays(Number(e.target.value))} sx={{ width: 180 }}>
              {SLOW_DAY_OPTIONS.map((d) => <MenuItem key={d} value={d}>{d}+ days</MenuItem>)}
            </TextField>
            <Alert severity={slowRows.length ? 'warning' : 'success'} sx={{ py: 0, flex: 1 }}>
              {slowRows.length
                ? `${slowRows.length} line(s) worth ${formatPKR(slowValue)} have not left the store in ${slowDays}+ days — consider transferring or using them.`
                : `Everything in stock moved within the last ${slowDays} days.`}
            </Alert>
          </Stack>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell>Store / Project</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Value</TableCell>
                  <TableCell>Last issued</TableCell>
                  <TableCell align="right">Days idle</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {slowRows.map((r) => (
                  <TableRow key={`${r.store}-${r.project}-${r.item}`} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{r.itemName}</Typography>
                      <Typography variant="caption" color="text.secondary">{r.itemCode}</Typography>
                    </TableCell>
                    <TableCell>{r.storeName} / {r.projectName}</TableCell>
                    <TableCell align="right">{r.balance} {r.unit}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{formatPKR(r.value)}</TableCell>
                    <TableCell>{r.lastOut ? formatDate(r.lastOut) : <Chip size="small" label="Never issued" variant="outlined" />}</TableCell>
                    <TableCell align="right">
                      <Chip size="small" label={r.daysIdle ?? '—'} color={(r.daysIdle ?? 0) >= 180 ? 'error' : 'warning'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
};

export default StockReports;
