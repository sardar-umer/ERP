import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Collapse,
  IconButton,
  Link,
  Tooltip,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import {
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
  UnfoldMore as ExpandAllIcon,
  UnfoldLess as CollapseAllIcon
} from '@mui/icons-material';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import api from '../../../services/api';
import { formatPKR } from '../../../utils/currency';
import { formatDate } from '../../../utils/dateUtils';
import useClientPagination from '../../../hooks/useClientPagination';

const STATUS_COLORS = {
  Draft: 'default',
  Submitted: 'info',
  'Under Review': 'warning',
  Approved: 'success',
  Rejected: 'error',
  'Rejected in Procurement': 'error',
  'Partially Fulfilled': 'warning',
  Fulfilled: 'success',
  Cancelled: 'default'
};

const STAGE_COLORS = {
  Draft: 'default',
  'Pending Approval': 'warning',
  'With Store (stock check)': 'info',
  'In Procurement': 'info',
  'Quotations Received': 'info',
  'Comparative Statement': 'secondary',
  'PO Raised': 'primary',
  'Partially Fulfilled': 'warning',
  Fulfilled: 'success',
  Rejected: 'error',
  Cancelled: 'default'
};

const presetRange = (preset) => {
  const today = dayjs();
  if (preset === '30d') return [today.subtract(30, 'day'), today];
  if (preset === '90d') return [today.subtract(90, 'day'), today];
  if (preset === 'month') return [today.startOf('month'), today];
  if (preset === 'ytd') return [today.startOf('year'), today];
  return null;
};

/** Item lines of one indent, shown when its row is expanded */
const IndentItemsTable = ({ items }) => (
  <Table size="small" sx={{ '& td, & th': { fontSize: 12.5 } }}>
    <TableHead>
      <TableRow>
        <TableCell><strong>#</strong></TableCell>
        <TableCell><strong>Item</strong></TableCell>
        <TableCell><strong>Description / Brand</strong></TableCell>
        <TableCell align="right"><strong>Qty</strong></TableCell>
        <TableCell><strong>Unit</strong></TableCell>
        <TableCell align="right"><strong>Est. Rate</strong></TableCell>
        <TableCell align="right"><strong>Est. Amount</strong></TableCell>
        <TableCell><strong>Purpose</strong></TableCell>
        <TableCell><strong>On PO</strong></TableCell>
        <TableCell align="right"><strong>PO Qty</strong></TableCell>
        <TableCell align="right"><strong>PO Amount</strong></TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {(items || []).length === 0 ? (
        <TableRow><TableCell colSpan={11} align="center">No items</TableCell></TableRow>
      ) : items.map((it) => (
        <TableRow key={it.line}>
          <TableCell>{it.line}</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>
            {it.itemName}
            {it.itemCode && <Typography variant="caption" color="text.secondary" display="block">{it.itemCode}</Typography>}
          </TableCell>
          <TableCell>
            {it.description}
            {it.brand && <Typography variant="caption" color="text.secondary" display="block">Brand: {it.brand}</Typography>}
          </TableCell>
          <TableCell align="right">{it.quantity}</TableCell>
          <TableCell>{it.unit}</TableCell>
          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{it.estimatedRate ? formatPKR(it.estimatedRate) : '-'}</TableCell>
          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{it.estimatedAmount ? formatPKR(it.estimatedAmount) : '-'}</TableCell>
          <TableCell>{it.purpose || '-'}</TableCell>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>{it.poNumbers || <Typography variant="caption" color="text.secondary">Not on a PO</Typography>}</TableCell>
          <TableCell align="right">{it.poQuantity || '-'}</TableCell>
          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{it.poAmount ? formatPKR(it.poAmount) : '-'}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/** Marks Excel rows that are item lines under an indent (removed before writing) */
const ITEM_ROW = '__item__';

const IndentReport = () => {
  const [expanded, setExpanded] = useState({});
  const [expandAll, setExpandAll] = useState(false);
  const toggleRow = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const isOpen = (id) => (expandAll ? expanded[id] !== false : Boolean(expanded[id]));
  const [rangePreset, setRangePreset] = useState('month');
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [toDate, setToDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [status, setStatus] = useState('');
  const [stage, setStage] = useState('');
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [departments, setDepartments] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [stages, setStages] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/hr/departments')
      .then((res) => setDepartments(res.data?.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/procurement/reports/indents', {
        params: {
          from: fromDate || undefined,
          to: toDate || undefined,
          status: status || undefined,
          stage: stage || undefined,
          department: department || undefined,
          search: search || undefined,
          all: true
        }
      });
      const data = res.data?.data || {};
      setRows(data.rows || []);
      setSummary(data.summary || null);
      if (data.statuses) setStatuses(data.statuses);
      if (data.stages) setStages(data.stages);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load indent report');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, status, stage, department, search]);

  useEffect(() => { load(); }, [load]);

  const changePreset = (value) => {
    setRangePreset(value);
    const range = presetRange(value);
    if (range) {
      setFromDate(range[0].format('YYYY-MM-DD'));
      setToDate(range[1].format('YYYY-MM-DD'));
    } else if (value === 'all') {
      setFromDate('');
      setToDate('');
    }
  };

  const pg = useClientPagination(rows);

  const stageCounts = useMemo(() => summary?.byStage || [], [summary]);
  const statusCounts = useMemo(() => summary?.byStatus || [], [summary]);
  const periodLabel = fromDate || toDate ? `${fromDate || 'Start'} to ${toDate || 'Today'}` : 'All dates';

  const exportExcel = () => {
    const header = [
      ['Indent Report'],
      ['Period', periodLabel],
      ['Status', status || 'All', 'Stage', stage || 'All'],
      ['Generated At', dayjs().format('DD-MMM-YYYY HH:mm')],
      []
    ];
    const detail = [
      ...header,
      ['#', 'Indent No', 'Date', 'Title', 'Department', 'Project', 'Cost Center', 'Requested By', 'Items',
        'Estimated Amount', 'Status', 'Where It Is Now', 'Detail', 'Quotations', 'PO Count', 'PO Numbers', 'PO Amount'],
      ...rows.flatMap((r, i) => [
        [
          i + 1, r.indentNumber, r.date ? dayjs(r.date).format('DD-MMM-YYYY') : '', r.title, r.department, r.project,
          r.costCenter, r.requestedBy, r.itemCount, r.estimatedAmount, r.status, r.stage, r.stageDetail,
          r.quotations, r.poCount, r.poNumbers, r.poAmount
        ],
        // Item lines sit under their indent (grouped, so Excel can collapse them with the +/- buttons)
        ...((r.items || []).length ? [
          [ITEM_ROW, '', 'Items:', 'Item', 'Description', 'Brand', 'Qty', 'Unit', 'Est. Rate', 'Est. Amount',
            'Purpose', 'On PO', 'PO Qty', 'PO Amount'],
          ...r.items.map((it) => [ITEM_ROW, '', it.line, it.itemName, it.description, it.brand, it.quantity, it.unit,
            it.estimatedRate, it.estimatedAmount, it.purpose, it.poNumbers || 'Not on a PO', it.poQuantity, it.poAmount])
        ] : [])
      ]),
      [],
      ['', 'Total', '', '', '', '', '', '', '', summary?.totalAmount || 0, '', '', '', '', '', '', summary?.totalPoAmount || 0]
    ];
    const summarySheet = [
      ...header,
      ['Total Indents', summary?.total || 0],
      ['Total Estimated Amount', summary?.totalAmount || 0],
      ['Total PO Amount', summary?.totalPoAmount || 0],
      [],
      ['By Status', 'Count', 'Estimated Amount'],
      ...statusCounts.map((s) => [s.status, s.count, s.amount]),
      [],
      ['Where It Is Now', 'Count', 'Estimated Amount'],
      ...stageCounts.map((s) => [s.stage, s.count, s.amount])
    ];
    const itemSheet = [
      ...header,
      ['Indent No', 'Indent Date', 'Department', 'Indent Status', 'Where It Is Now', 'Line', 'Item', 'Item Code',
        'Description', 'Brand', 'Qty', 'Unit', 'Est. Rate', 'Est. Amount', 'Purpose', 'On PO', 'PO Qty', 'PO Amount'],
      ...rows.flatMap((r) => (r.items || []).map((it) => [
        r.indentNumber, r.date ? dayjs(r.date).format('DD-MMM-YYYY') : '', r.department, r.status, r.stage,
        it.line, it.itemName, it.itemCode, it.description, it.brand, it.quantity, it.unit, it.estimatedRate,
        it.estimatedAmount, it.purpose, it.poNumbers, it.poQuantity, it.poAmount
      ]))
    ];
    const wsItems = XLSX.utils.aoa_to_sheet(itemSheet);
    wsItems['!cols'] = [12, 12, 18, 16, 22, 5, 28, 12, 32, 14, 8, 8, 12, 14, 24, 22, 8, 14].map((wch) => ({ wch }));
    const detailRowLevels = detail.map((row) => (row[0] === ITEM_ROW ? { level: 1 } : {}));
    detail.forEach((row) => { if (row[0] === ITEM_ROW) row[0] = ''; });
    const wsDetail = XLSX.utils.aoa_to_sheet(detail);
    wsDetail['!rows'] = detailRowLevels;
    wsDetail['!outline'] = { above: true };
    wsDetail['!cols'] = [4, 16, 12, 32, 20, 24, 20, 20, 7, 16, 18, 22, 40, 10, 9, 24, 16].map((wch) => ({ wch }));
    const wsSummary = XLSX.utils.aoa_to_sheet(summarySheet);
    wsSummary['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Indents');
    XLSX.utils.book_append_sheet(wb, wsItems, 'Indent Items');
    XLSX.writeFile(wb, `Indent-Report-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Card sx={{ mb: 2.5 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
            <TextField select size="small" label="Period" value={rangePreset} onChange={(e) => changePreset(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="month">This Month</MenuItem>
              <MenuItem value="30d">Last 30 Days</MenuItem>
              <MenuItem value="90d">Last 90 Days</MenuItem>
              <MenuItem value="ytd">Year to Date</MenuItem>
              <MenuItem value="all">All Dates</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </TextField>
            <TextField size="small" type="date" label="From" value={fromDate} InputLabelProps={{ shrink: true }}
              onChange={(e) => { setRangePreset('custom'); setFromDate(e.target.value); }} />
            <TextField size="small" type="date" label="To" value={toDate} InputLabelProps={{ shrink: true }}
              onChange={(e) => { setRangePreset('custom'); setToDate(e.target.value); }} />
            <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 170 }}>
              <MenuItem value="">All Statuses</MenuItem>
              {statuses.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Where It Is Now" value={stage} onChange={(e) => setStage(e.target.value)} sx={{ minWidth: 200 }}>
              <MenuItem value="">All Stages</MenuItem>
              {stages.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All Departments</MenuItem>
              {departments.map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Search" placeholder="Indent no, title, item, project" value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)} sx={{ minWidth: 240 }} />
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button variant="contained" startIcon={<DownloadIcon />} onClick={exportExcel} disabled={!rows.length}>
              {`Export Excel${rows.length ? ` (all ${rows.length})` : ''}`}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={4}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary">Indents Created</Typography>
            <Typography variant="h5" fontWeight={700}>{summary?.total ?? 0}</Typography>
            <Typography variant="caption" color="text.secondary">{periodLabel}</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary">Estimated Amount</Typography>
            <Typography variant="h5" fontWeight={700}>{formatPKR(summary?.totalAmount || 0)}</Typography>
            <Typography variant="caption" color="text.secondary">Total of indent estimates</Typography>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card><CardContent>
            <Typography variant="caption" color="text.secondary">PO Amount Against These Indents</Typography>
            <Typography variant="h5" fontWeight={700}>{formatPKR(summary?.totalPoAmount || 0)}</Typography>
            <Typography variant="caption" color="text.secondary">Excludes cancelled / rejected POs</Typography>
          </CardContent></Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>By Status</Typography>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell align="right"><strong>Indents</strong></TableCell>
                <TableCell align="right"><strong>Amount</strong></TableCell>
              </TableRow></TableHead>
              <TableBody>
                {statusCounts.length === 0 ? (
                  <TableRow><TableCell colSpan={3} align="center"><Typography variant="body2" color="text.secondary">No indents</Typography></TableCell></TableRow>
                ) : statusCounts.map((s) => (
                  <TableRow key={s.status} hover sx={{ cursor: 'pointer' }} selected={status === s.status}
                    onClick={() => setStatus(status === s.status ? '' : s.status)}>
                    <TableCell><Chip size="small" label={s.status} color={STATUS_COLORS[s.status] || 'default'} /></TableCell>
                    <TableCell align="right">{s.count}</TableCell>
                    <TableCell align="right">{formatPKR(s.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}><CardContent>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Where They Are Now</Typography>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell><strong>Stage</strong></TableCell>
                <TableCell align="right"><strong>Indents</strong></TableCell>
                <TableCell align="right"><strong>Amount</strong></TableCell>
              </TableRow></TableHead>
              <TableBody>
                {stageCounts.length === 0 ? (
                  <TableRow><TableCell colSpan={3} align="center"><Typography variant="body2" color="text.secondary">No indents</Typography></TableCell></TableRow>
                ) : stageCounts.map((s) => (
                  <TableRow key={s.stage} hover sx={{ cursor: 'pointer' }} selected={stage === s.stage}
                    onClick={() => setStage(stage === s.stage ? '' : s.stage)}>
                    <TableCell><Chip size="small" variant="outlined" label={s.stage} color={STAGE_COLORS[s.stage] || 'default'} /></TableCell>
                    <TableCell align="right">{s.count}</TableCell>
                    <TableCell align="right">{formatPKR(s.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </Grid>
      </Grid>

      <Card>
        {loading && <LinearProgress />}
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography variant="h6" fontWeight={700}>Indents ({rows.length})</Typography>
            <Button size="small" startIcon={expandAll ? <CollapseAllIcon /> : <ExpandAllIcon />}
              onClick={() => { setExpandAll((v) => !v); setExpanded({}); }}>
              {expandAll ? 'Hide All Items' : 'Show All Items'}
            </Button>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell><strong>#</strong></TableCell>
                  <TableCell><strong>Indent No</strong></TableCell>
                  <TableCell><strong>Date</strong></TableCell>
                  <TableCell><strong>Title</strong></TableCell>
                  <TableCell><strong>Department / Project</strong></TableCell>
                  <TableCell><strong>Requested By</strong></TableCell>
                  <TableCell align="right"><strong>Items</strong></TableCell>
                  <TableCell align="right"><strong>Est. Amount</strong></TableCell>
                  <TableCell><strong>Status</strong></TableCell>
                  <TableCell><strong>Where It Is Now</strong></TableCell>
                  <TableCell align="right"><strong>PO Amount</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!loading && rows.length === 0 ? (
                  <TableRow><TableCell colSpan={12} align="center"><Typography variant="body2" color="text.secondary">No indents for these filters</Typography></TableCell></TableRow>
                ) : pg.rows.map((r, i) => (
                  <React.Fragment key={r._id}>
                  <TableRow hover sx={{ cursor: 'pointer', '& > td': isOpen(r._id) ? { borderBottom: 'none' } : undefined }} onClick={() => toggleRow(r._id)}>
                    <TableCell padding="checkbox">
                      <Tooltip title={isOpen(r._id) ? 'Hide items' : 'Show items'}>
                        <IconButton size="small">{isOpen(r._id) ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}</IconButton>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{pg.offset + i + 1}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                      <Link component={RouterLink} to={`/general/indents/${r._id}`} underline="hover" onClick={(e) => e.stopPropagation()}>{r.indentNumber || 'View'}</Link>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell>
                      {r.department || '-'}
                      {r.project && <Typography variant="caption" color="text.secondary" display="block">{r.project}</Typography>}
                    </TableCell>
                    <TableCell>{r.requestedBy || '-'}</TableCell>
                    <TableCell align="right">{r.itemCount}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatPKR(r.estimatedAmount)}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={STATUS_COLORS[r.status] || 'default'} /></TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <Chip size="small" variant="outlined" label={r.stage} color={STAGE_COLORS[r.stage] || 'default'} />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{r.stageDetail}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{r.poCount ? formatPKR(r.poAmount) : '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={12} sx={{ py: 0, ...(isOpen(r._id) ? {} : { borderBottom: 'none' }) }}>
                      <Collapse in={isOpen(r._id)} timeout="auto" unmountOnExit>
                        <Box sx={{ my: 1.5, ml: 6, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                          <IndentItemsTable items={r.items} />
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                  </React.Fragment>
                ))}
                {rows.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={8}><strong>Total ({rows.length} indents)</strong></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><strong>{formatPKR(summary?.totalAmount || 0)}</strong></TableCell>
                    <TableCell colSpan={2} />
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><strong>{formatPKR(summary?.totalPoAmount || 0)}</strong></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default IndentReport;
