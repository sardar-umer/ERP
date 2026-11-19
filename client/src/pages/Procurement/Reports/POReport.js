import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Link,
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
import { Download as DownloadIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import api from '../../../services/api';
import { formatPKR } from '../../../utils/currency';
import { formatDate } from '../../../utils/dateUtils';
import useClientPagination from '../../../hooks/useClientPagination';

const STATUS_COLORS = {
  Draft: 'default',
  'Pending Approval': 'warning',
  'Pending Audit': 'warning',
  'Forwarded to Audit Director': 'warning',
  'Pending Finance': 'warning',
  'Send to CEO Office': 'warning',
  'Forwarded to CEO': 'warning',
  Approved: 'success',
  'Sent to Store': 'info',
  'GRN Created': 'info',
  'Partially Received': 'warning',
  Received: 'success',
  'Sent to Procurement': 'info',
  'Sent to Audit': 'info',
  'Sent to Finance': 'info',
  Rejected: 'error',
  Cancelled: 'default'
};

const STAGE_COLORS = {
  Draft: 'default',
  'Procurement Approval': 'warning',
  'Pre-Audit': 'warning',
  'CEO Office': 'warning',
  Finance: 'warning',
  'Returned for Correction': 'error',
  'Approved, Awaiting Delivery': 'info',
  'Partially Received': 'secondary',
  Received: 'success',
  'Bill Processing': 'primary',
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

const POReport = () => {
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
      const res = await api.get('/procurement/reports/purchase-orders', {
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
      setError(err?.response?.data?.message || 'Failed to load PO report');
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
      ['Purchase Order Report'],
      ['Period', periodLabel],
      ['Status', status || 'All', 'Stage', stage || 'All'],
      ['Generated At', dayjs().format('DD-MMM-YYYY HH:mm')],
      []
    ];
    const detail = [
      ...header,
      ['#', 'PO No', 'Date', 'Vendor', 'Indent No', 'Department', 'Project', 'Cost Center', 'Items',
        'Subtotal', 'Tax', 'PO Amount', 'Received %', 'Received Value', 'GRN Numbers', 'Billed', 'Paid',
        'Bill Numbers', 'Status', 'Where It Is Now', 'Detail', 'Expected Delivery'],
      ...rows.map((r, i) => [
        i + 1, r.orderNumber, r.date ? dayjs(r.date).format('DD-MMM-YYYY') : '', r.vendor, r.indentNumber,
        r.department, r.project, r.costCenter, r.itemCount, r.subtotal, r.taxAmount, r.totalAmount,
        r.receivedPercent, r.receivedValue, r.grnNumbers, r.billedAmount, r.paidAmount, r.billNumbers,
        r.status, r.stage, r.stageDetail,
        r.expectedDeliveryDate ? dayjs(r.expectedDeliveryDate).format('DD-MMM-YYYY') : ''
      ]),
      [],
      ['', 'Total', '', '', '', '', '', '', '', '', '', summary?.totalAmount || 0, '',
        summary?.receivedValue || 0, '', summary?.billedAmount || 0, summary?.paidAmount || 0]
    ];
    const summarySheet = [
      ...header,
      ['POs Created', summary?.total || 0],
      ['Total PO Amount (all)', summary?.totalAmount || 0],
      ['Live POs (excl. rejected / cancelled)', summary?.liveCount || 0],
      ['Live PO Amount', summary?.liveAmount || 0],
      ['Received Value', summary?.receivedValue || 0],
      ['Billed Amount', summary?.billedAmount || 0],
      ['Paid Amount', summary?.paidAmount || 0],
      [],
      ['By Status', 'Count', 'PO Amount'],
      ...statusCounts.map((s) => [s.status, s.count, s.amount]),
      [],
      ['Where It Is Now', 'Count', 'PO Amount'],
      ...stageCounts.map((s) => [s.stage, s.count, s.amount])
    ];
    const wsDetail = XLSX.utils.aoa_to_sheet(detail);
    wsDetail['!cols'] = [4, 16, 12, 28, 10, 18, 22, 20, 7, 14, 12, 15, 10, 15, 20, 14, 14, 20, 20, 24, 44, 14].map((wch) => ({ wch }));
    const wsSummary = XLSX.utils.aoa_to_sheet(summarySheet);
    wsSummary['!cols'] = [{ wch: 36 }, { wch: 14 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Purchase Orders');
    XLSX.writeFile(wb, `PO-Report-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
  };

  const card = (label, value, caption) => (
    <Card sx={{ height: '100%' }}><CardContent>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h5" fontWeight={700}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{caption}</Typography>
    </CardContent></Card>
  );

  const breakdown = (title, list, keyName, selected, onPick, colors, variant) => (
    <Card sx={{ height: '100%' }}><CardContent>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>{title}</Typography>
      <Table size="small">
        <TableHead><TableRow>
          <TableCell><strong>{keyName === 'status' ? 'Status' : 'Stage'}</strong></TableCell>
          <TableCell align="right"><strong>POs</strong></TableCell>
          <TableCell align="right"><strong>Amount</strong></TableCell>
        </TableRow></TableHead>
        <TableBody>
          {list.length === 0 ? (
            <TableRow><TableCell colSpan={3} align="center"><Typography variant="body2" color="text.secondary">No purchase orders</Typography></TableCell></TableRow>
          ) : list.map((s) => (
            <TableRow key={s[keyName]} hover sx={{ cursor: 'pointer' }} selected={selected === s[keyName]}
              onClick={() => onPick(selected === s[keyName] ? '' : s[keyName])}>
              <TableCell><Chip size="small" variant={variant} label={s[keyName]} color={colors[s[keyName]] || 'default'} /></TableCell>
              <TableCell align="right">{s.count}</TableCell>
              <TableCell align="right">{formatPKR(s.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );

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
            <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 190 }}>
              <MenuItem value="">All Statuses</MenuItem>
              {statuses.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Where It Is Now" value={stage} onChange={(e) => setStage(e.target.value)} sx={{ minWidth: 210 }}>
              <MenuItem value="">All Stages</MenuItem>
              {stages.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All Departments</MenuItem>
              {departments.map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Search" placeholder="PO no, vendor, indent no, item, project" value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)} sx={{ minWidth: 260 }} />
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
            <Button variant="contained" startIcon={<DownloadIcon />} onClick={exportExcel} disabled={!rows.length}>Export Excel</Button>
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          {card('POs Created', summary?.total ?? 0, `${summary?.liveCount ?? 0} live · ${periodLabel}`)}
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          {card('PO Amount', formatPKR(summary?.liveAmount || 0), `Excl. rejected / cancelled (all: ${formatPKR(summary?.totalAmount || 0)})`)}
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          {card('Received Value', formatPKR(summary?.receivedValue || 0), 'Goods received so far (before tax)')}
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          {card('Billed / Paid', `${formatPKR(summary?.billedAmount || 0)}`, `Paid: ${formatPKR(summary?.paidAmount || 0)}`)}
        </Grid>

        <Grid item xs={12} md={6}>
          {breakdown('By Status', statusCounts, 'status', status, setStatus, STATUS_COLORS, 'filled')}
        </Grid>
        <Grid item xs={12} md={6}>
          {breakdown('Where They Are Now', stageCounts, 'stage', stage, setStage, STAGE_COLORS, 'outlined')}
        </Grid>
      </Grid>

      <Card>
        {loading && <LinearProgress />}
        <CardContent>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Purchase Orders ({rows.length})</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>#</strong></TableCell>
                  <TableCell><strong>PO No</strong></TableCell>
                  <TableCell><strong>Date</strong></TableCell>
                  <TableCell><strong>Vendor</strong></TableCell>
                  <TableCell><strong>Indent / Department</strong></TableCell>
                  <TableCell align="right"><strong>Items</strong></TableCell>
                  <TableCell align="right"><strong>PO Amount</strong></TableCell>
                  <TableCell align="right"><strong>Received</strong></TableCell>
                  <TableCell align="right"><strong>Billed</strong></TableCell>
                  <TableCell align="right"><strong>Paid</strong></TableCell>
                  <TableCell><strong>Status</strong></TableCell>
                  <TableCell><strong>Where It Is Now</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!loading && rows.length === 0 ? (
                  <TableRow><TableCell colSpan={12} align="center"><Typography variant="body2" color="text.secondary">No purchase orders for these filters</Typography></TableCell></TableRow>
                ) : pg.rows.map((r, i) => (
                  <TableRow key={r._id} hover sx={r.live ? undefined : { opacity: 0.6 }}>
                    <TableCell>{pg.offset + i + 1}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                      <Link component={RouterLink} to={`/procurement/purchase-orders?view=${r._id}`} underline="hover">{r.orderNumber || 'View PO'}</Link>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</TableCell>
                    <TableCell>{r.vendor || '-'}</TableCell>
                    <TableCell>
                      {r.indentId ? (
                        <Link component={RouterLink} to={`/general/indents/${r.indentId}`} underline="hover">{r.indentNumber || 'Indent'}</Link>
                      ) : '-'}
                      {(r.department || r.project) && (
                        <Typography variant="caption" color="text.secondary" display="block">{[r.department, r.project].filter(Boolean).join(' · ')}</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{r.itemCount}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatPKR(r.totalAmount)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {r.receivedPercent ? `${r.receivedPercent}%` : '-'}
                      {r.receivedValue > 0 && <Typography variant="caption" color="text.secondary" display="block">{formatPKR(r.receivedValue)}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{r.billedAmount ? formatPKR(r.billedAmount) : '-'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{r.paidAmount ? formatPKR(r.paidAmount) : '-'}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={STATUS_COLORS[r.status] || 'default'} /></TableCell>
                    <TableCell sx={{ minWidth: 210 }}>
                      <Chip size="small" variant="outlined" label={r.stage} color={STAGE_COLORS[r.stage] || 'default'} />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{r.stageDetail}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={6}><strong>Total ({rows.length} POs)</strong></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><strong>{formatPKR(summary?.totalAmount || 0)}</strong></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><strong>{formatPKR(summary?.receivedValue || 0)}</strong></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><strong>{formatPKR(summary?.billedAmount || 0)}</strong></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><strong>{formatPKR(summary?.paidAmount || 0)}</strong></TableCell>
                    <TableCell colSpan={2} />
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

export default POReport;
