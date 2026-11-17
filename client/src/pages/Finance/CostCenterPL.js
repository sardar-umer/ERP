import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Grid, Button, CircularProgress, Alert, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip,
  TextField, FormControl, InputLabel, Select, MenuItem, Stack, Collapse,
  Card, CardContent, IconButton, Tabs, Tab
} from '@mui/material';
import {
  AccountTree as CostCenterIcon, PictureAsPdf as PdfIcon, TableView as ExcelIcon,
  ExpandMore as ExpandIcon, ExpandLess as CollapseIcon
} from '@mui/icons-material';
import api from '../../services/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import FinanceCompanySelector from '../../components/Finance/FinanceCompanySelector';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function DeptSection({ dept, data }) {
  const [open, setOpen] = useState(true);
  const profit = (data.netProfit || 0);
  return (
    <Box mb={2}>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {/* Header row */}
        <Box
          display="flex" alignItems="center" justifyContent="space-between"
          px={2} py={1.2}
          sx={{ bgcolor: 'primary.50', borderBottom: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
          onClick={() => setOpen(v => !v)}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <IconButton size="small">{open ? <CollapseIcon /> : <ExpandIcon />}</IconButton>
            <Typography variant="subtitle1" fontWeight={800} color="primary.dark">{dept}</Typography>
          </Box>
          <Stack direction="row" spacing={2}>
            <Chip label={`Revenue: ${fmt(data.totalRevenue)}`} size="small" color="success" />
            <Chip label={`Expenses: ${fmt(data.totalExpenses)}`} size="small" color="error" />
            <Chip
              label={`Net: ${fmt(profit)}`} size="small"
              color={profit >= 0 ? 'primary' : 'error'}
              sx={{ fontWeight: 800 }}
            />
          </Stack>
        </Box>

        <Collapse in={open}>
          <Table size="small">
            <TableBody>
              {/* Revenue */}
              <TableRow sx={{ bgcolor: 'success.50' }}>
                <TableCell colSpan={2} sx={{ fontWeight: 700, color: 'success.dark', pl: 3 }}>Revenue</TableCell>
              </TableRow>
              {(data.revenue || []).map((r, i) => (
                <TableRow key={i} hover>
                  <TableCell sx={{ pl: 5 }}>
                    <Typography variant="body2">{r.accountName}</Typography>
                    <Typography variant="caption" color="text.disabled">{r.accountNumber}</Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'success.main' }}>
                    {fmt(r.balance)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'success.100' }}>
                <TableCell sx={{ fontWeight: 800, pl: 3 }}>Total Revenue</TableCell>
                <TableCell align="right" sx={{ fontWeight: 800, fontFamily: 'monospace', color: 'success.dark' }}>
                  {fmt(data.totalRevenue)}
                </TableCell>
              </TableRow>

              {/* Expenses */}
              <TableRow sx={{ bgcolor: 'error.50' }}>
                <TableCell colSpan={2} sx={{ fontWeight: 700, color: 'error.dark', pl: 3 }}>Expenses</TableCell>
              </TableRow>
              {(data.expenses || []).map((r, i) => (
                <TableRow key={i} hover>
                  <TableCell sx={{ pl: 5 }}>
                    <Typography variant="body2">{r.accountName}</Typography>
                    <Typography variant="caption" color="text.disabled">{r.accountNumber}</Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'error.main' }}>
                    {fmt(r.balance)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'error.100' }}>
                <TableCell sx={{ fontWeight: 800, pl: 3 }}>Total Expenses</TableCell>
                <TableCell align="right" sx={{ fontWeight: 800, fontFamily: 'monospace', color: 'error.dark' }}>
                  {fmt(data.totalExpenses)}
                </TableCell>
              </TableRow>

              {/* Net */}
              <TableRow sx={{ bgcolor: profit >= 0 ? 'primary.50' : 'error.50' }}>
                <TableCell sx={{ fontWeight: 900, pl: 3, fontSize: 14 }}>NET PROFIT / (LOSS)</TableCell>
                <TableCell align="right" sx={{ fontWeight: 900, fontFamily: 'monospace', fontSize: 15,
                  color: profit >= 0 ? 'success.dark' : 'error.dark' }}>
                  {fmt(profit)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Collapse>
      </Paper>
    </Box>
  );
}

function DepartmentPLView() {
  const [departments, setDepts]   = useState([]);
  const [selDept, setSelDept]     = useState('');
  const [fromDate, setFromDate]   = useState(`${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate]       = useState(new Date().toISOString().split('T')[0]);
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // Load department list
  useEffect(() => {
    api.get('/finance/reports/department-pl').then(r => {
      setDepts(r.data.data?.departments || []);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setData(null);
    try {
      const res = await api.get('/finance/reports/department-pl', {
        params: { department: selDept || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined }
      });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [selDept, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const byDept = data?.byDept || {};
  const deptKeys = Object.keys(byDept).sort();

  const totals = deptKeys.reduce((acc, d) => ({
    totalRevenue:  acc.totalRevenue  + (byDept[d].totalRevenue  || 0),
    totalExpenses: acc.totalExpenses + (byDept[d].totalExpenses || 0),
    netProfit:     acc.netProfit     + (byDept[d].netProfit     || 0)
  }), { totalRevenue: 0, totalExpenses: 0, netProfit: 0 });

  const exportPDF = () => {
    if (!data) return;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text('Department P&L', 14, 18);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`Period: ${fromDate} to ${toDate}${selDept ? ` | Dept: ${selDept}` : ''}`, 14, 26);
    const rows = [];
    deptKeys.forEach(dept => {
      rows.push([`--- ${dept} ---`, '', '']);
      byDept[dept].revenue.forEach(r => rows.push([`  ${r.accountName}`, 'Revenue', fmt(r.balance)]));
      rows.push([`  Total Revenue`, '', fmt(byDept[dept].totalRevenue)]);
      byDept[dept].expenses.forEach(r => rows.push([`  ${r.accountName}`, 'Expense', fmt(r.balance)]));
      rows.push([`  Total Expenses`, '', fmt(byDept[dept].totalExpenses)]);
      rows.push([`  NET PROFIT`, '', fmt(byDept[dept].netProfit)]);
      rows.push(['', '', '']);
    });
    autoTable(doc, { head: [['Account', 'Type', 'Amount (PKR)']], body: rows, startY: 30, styles: { fontSize: 8 }, headStyles: { fillColor: [21, 101, 192] } });
    doc.save('Department-PL.pdf');
  };

  const exportExcel = () => {
    if (!data) return;
    const rows = [['Department', 'Account', 'Type', 'Amount']];
    deptKeys.forEach(dept => {
      byDept[dept].revenue.forEach(r => rows.push([dept, r.accountName, 'Revenue', r.balance]));
      rows.push([dept, 'Total Revenue', '', byDept[dept].totalRevenue]);
      byDept[dept].expenses.forEach(r => rows.push([dept, r.accountName, 'Expense', r.balance]));
      rows.push([dept, 'Total Expenses', '', byDept[dept].totalExpenses]);
      rows.push([dept, 'NET PROFIT', '', byDept[dept].netProfit]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Dept PL');
    XLSX.writeFile(wb, 'Department-PL.xlsx');
  };

  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" alignItems="center" mb={2} className="print-hide-toolbar">
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" startIcon={<PdfIcon />} onClick={exportPDF} disabled={!data}>PDF</Button>
          <Button variant="outlined" size="small" startIcon={<ExcelIcon />} onClick={exportExcel} disabled={!data} color="success">Excel</Button>
        </Stack>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }} className="print-hide-toolbar">
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Department</InputLabel>
              <Select value={selDept} label="Department" onChange={e => setSelDept(e.target.value)}>
                <MenuItem value="">All Departments</MenuItem>
                {departments.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" label="From Date" type="date"
              value={fromDate} onChange={e => setFromDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" label="To Date" type="date"
              value={toDate} onChange={e => setToDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={12} sm={3} display="flex" justifyContent="flex-end">
            <Button variant="contained" onClick={load} disabled={loading}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <CostCenterIcon />}>
              {loading ? 'Loading…' : 'Generate'}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {/* Grand totals */}
      {data && deptKeys.length > 0 && (
        <>
          <Grid container spacing={2} mb={3}>
            {[
              { label: 'Total Revenue', value: totals.totalRevenue, color: 'success.main' },
              { label: 'Total Expenses', value: totals.totalExpenses, color: 'error.main' },
              { label: 'Net Profit', value: totals.netProfit, color: totals.netProfit >= 0 ? 'success.main' : 'error.main' },
              { label: 'Departments', value: deptKeys.length, color: 'primary.main', raw: true }
            ].map(c => (
              <Grid item xs={6} sm={3} key={c.label}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                    <Typography variant="h6" fontWeight={800} color={c.color}>
                      {c.raw ? c.value : `PKR ${fmt(c.value)}`}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {deptKeys.map(dept => (
            <DeptSection key={dept} dept={dept} data={byDept[dept]} />
          ))}
        </>
      )}

      {data && deptKeys.length === 0 && (
        <Alert severity="info">No posted revenue or expense transactions found for the selected filters.</Alert>
      )}
    </Box>
  );
}

const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');

function AccountLines({ title, rows, total, color }) {
  return (
    <>
      <TableRow>
        <TableCell colSpan={2} sx={{ fontWeight: 700, color: `${color}.dark`, pl: 4, borderBottom: 'none', pt: 1.5 }}>{title}</TableCell>
      </TableRow>
      {rows.length === 0 ? (
        <TableRow><TableCell colSpan={2} sx={{ pl: 6, color: 'text.disabled' }}>None</TableCell></TableRow>
      ) : rows.map((r) => (
        <TableRow key={r.accountId} hover>
          <TableCell sx={{ pl: 6 }}>
            <Typography variant="body2" component="span">{r.accountName}</Typography>
            <Typography variant="caption" color="text.disabled" sx={{ ml: 1 }}>{r.accountNumber}</Typography>
          </TableCell>
          <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{fmt(r.amount)}</TableCell>
        </TableRow>
      ))}
      <TableRow>
        <TableCell sx={{ pl: 4, fontWeight: 700 }}>Total {title}</TableCell>
        <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700, color: `${color}.dark` }}>{fmt(total)}</TableCell>
      </TableRow>
    </>
  );
}

function CostCenterRow({ row, totalExpenses, showCompany }) {
  const [open, setOpen] = useState(false);
  const untagged = !row._id;
  return (
    <>
      <TableRow hover onClick={() => setOpen((v) => !v)}
        sx={{ cursor: 'pointer', '& > td': { borderBottom: open ? 'none' : undefined }, ...(untagged ? { bgcolor: 'warning.50' } : {}) }}>
        <TableCell padding="checkbox">
          <IconButton size="small">{open ? <CollapseIcon /> : <ExpandIcon />}</IconButton>
        </TableCell>
        <TableCell sx={{ fontFamily: 'monospace' }}>{row.code || '—'}</TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={600} color={untagged ? 'warning.dark' : 'text.primary'}>{row.name}</Typography>
          {!row.isActive && <Chip label="Inactive" size="small" sx={{ ml: 1, height: 18 }} />}
        </TableCell>
        {showCompany && <TableCell>{row.companyName || '—'}</TableCell>}
        <TableCell align="right" sx={{ fontFamily: 'monospace', color: 'success.dark' }}>{fmt(row.totalRevenue)}</TableCell>
        <TableCell align="right" sx={{ fontFamily: 'monospace', color: 'error.dark' }}>{fmt(row.totalExpenses)}</TableCell>
        <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700, color: row.net >= 0 ? 'success.dark' : 'error.dark' }}>{fmt(row.net)}</TableCell>
        <TableCell align="right">{pct(row.totalExpenses, totalExpenses)}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={showCompany ? 8 : 7} sx={{ p: 0 }}>
          <Collapse in={open} unmountOnExit>
            <Table size="small" sx={{ bgcolor: 'grey.50' }}>
              <TableBody>
                <AccountLines title="Revenue" rows={row.revenue} total={row.totalRevenue} color="success" />
                <AccountLines title="Expenses" rows={row.expenses} total={row.totalExpenses} color="error" />
              </TableBody>
            </Table>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function CostCenterView() {
  const { selectedCompanyId, selectedCompany } = useFinanceCompany();
  const [costCenterOptions, setCostCenterOptions] = useState([]);
  const [selCostCenter, setSelCostCenter] = useState('');
  const [fromDate, setFromDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelCostCenter('');
    setCostCenterOptions([]);
    if (!selectedCompanyId || selectedCompanyId === 'all') return;
    api.get('/finance/cost-centers', { params: { companyId: selectedCompanyId } })
      .then((r) => setCostCenterOptions(r.data?.data || []))
      .catch(() => {});
  }, [selectedCompanyId]);

  const load = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true); setError('');
    try {
      const res = await api.get('/finance/reports/cost-center-pl', {
        params: {
          companyId: selectedCompanyId,
          costCenterId: selCostCenter || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined
        }
      });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load report');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, selCostCenter, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const showCompany = selectedCompanyId === 'all';
  const rows = data ? [...(data.costCenters || []), ...(data.untagged ? [data.untagged] : [])] : [];
  const totals = data?.totals || {};
  const companyName = data?.company?.name || selectedCompany?.name || '';
  const periodText = `${fromDate || 'start'} to ${toDate || 'today'}`;

  const exportPDF = () => {
    if (!data) return;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text('Cost Center P&L', 14, 16);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`${companyName} | Period: ${periodText}`, 14, 23);
    autoTable(doc, {
      startY: 28,
      head: [['Code', 'Cost Center', ...(showCompany ? ['Company'] : []), 'Revenue', 'Expenses', 'Net', '% of Exp.']],
      body: [
        ...rows.map((r) => [r.code || '', r.name, ...(showCompany ? [r.companyName || ''] : []),
          fmt(r.totalRevenue), fmt(r.totalExpenses), fmt(r.net), pct(r.totalExpenses, totals.expenses)]),
        ['', 'TOTAL', ...(showCompany ? [''] : []), fmt(totals.revenue), fmt(totals.expenses), fmt(totals.net), '']
      ],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [21, 101, 192] },
      columnStyles: showCompany ? { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }
        : { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
    });
    const detail = [];
    rows.forEach((r) => {
      detail.push([{ content: `${r.code ? `${r.code} — ` : ''}${r.name}`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: [235, 241, 250] } }]);
      r.revenue.forEach((a) => detail.push([`  ${a.accountNumber || ''} ${a.accountName}`, 'Revenue', fmt(a.amount)]));
      r.expenses.forEach((a) => detail.push([`  ${a.accountNumber || ''} ${a.accountName}`, 'Expense', fmt(a.amount)]));
      detail.push([{ content: 'Net', styles: { fontStyle: 'bold' } }, '', { content: fmt(r.net), styles: { fontStyle: 'bold' } }]);
    });
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Account', 'Type', 'Amount (PKR)']],
      body: detail,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [21, 101, 192] },
      columnStyles: { 2: { halign: 'right' } }
    });
    doc.save('Cost-Center-PL.pdf');
  };

  const exportExcel = () => {
    if (!data) return;
    const summary = [[`Cost Center P&L — ${companyName}`], [`Period: ${periodText}`], [],
      ['Code', 'Cost Center', ...(showCompany ? ['Company'] : []), 'Revenue', 'Expenses', 'Net', '% of Expenses']];
    rows.forEach((r) => summary.push([r.code || '', r.name, ...(showCompany ? [r.companyName || ''] : []),
      r.totalRevenue, r.totalExpenses, r.net, totals.expenses ? r.totalExpenses / totals.expenses : '']));
    summary.push(['', 'TOTAL', ...(showCompany ? [''] : []), totals.revenue, totals.expenses, totals.net, '']);
    const detail = [['Code', 'Cost Center', ...(showCompany ? ['Company'] : []), 'Type', 'Account No.', 'Account', 'Amount']];
    rows.forEach((r) => {
      const head = [r.code || '', r.name, ...(showCompany ? [r.companyName || ''] : [])];
      r.revenue.forEach((a) => detail.push([...head, 'Revenue', a.accountNumber || '', a.accountName, a.amount]));
      r.expenses.forEach((a) => detail.push([...head, 'Expense', a.accountNumber || '', a.accountName, a.amount]));
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), 'By Account');
    XLSX.writeFile(wb, 'Cost-Center-PL.xlsx');
  };

  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" mb={2} className="print-hide-toolbar">
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" startIcon={<PdfIcon />} onClick={exportPDF} disabled={!rows.length}>PDF</Button>
          <Button variant="outlined" size="small" startIcon={<ExcelIcon />} onClick={exportExcel} disabled={!rows.length} color="success">Excel</Button>
        </Stack>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }} className="print-hide-toolbar">
        <Grid container spacing={2} alignItems="flex-start">
          <Grid item xs={12} md={4}>
            <FinanceCompanySelector allowAll minWidth="100%" sx={{ '& .MuiFormControl-root': { width: '100%' } }} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel shrink>Cost Center</InputLabel>
              <Select value={selCostCenter} label="Cost Center" notched displayEmpty onChange={(e) => setSelCostCenter(e.target.value)}
                disabled={selectedCompanyId === 'all'}>
                <MenuItem value="">All cost centers</MenuItem>
                <MenuItem value="untagged"><em>Not tagged only</em></MenuItem>
                {costCenterOptions.map((c) => (
                  <MenuItem key={c._id} value={c._id}>{c.code ? `${c.code} — ` : ''}{c.name}{c.isActive === false ? ' (inactive)' : ''}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField fullWidth size="small" label="From Date" type="date" value={fromDate}
              onChange={(e) => setFromDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField fullWidth size="small" label="To Date" type="date" value={toDate}
              onChange={(e) => setToDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={12} md={1} display="flex" justifyContent="flex-end">
            <Button variant="contained" onClick={load} disabled={loading || !selectedCompanyId}>
              {loading ? <CircularProgress size={20} color="inherit" /> : 'Run'}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {data && rows.length > 0 && (
        <>
          <Grid container spacing={2} mb={2}>
            {[
              { label: 'Revenue', value: `PKR ${fmt(totals.revenue)}`, color: 'success.main' },
              { label: 'Expenses', value: `PKR ${fmt(totals.expenses)}`, color: 'error.main' },
              { label: 'Net Profit / (Loss)', value: `PKR ${fmt(totals.net)}`, color: totals.net >= 0 ? 'success.main' : 'error.main' },
              { label: 'Expenses with a cost center', value: totals.taggedExpensePct == null ? '—' : `${totals.taggedExpensePct}%`,
                color: totals.taggedExpensePct == null || totals.taggedExpensePct >= 95 ? 'primary.main' : 'warning.main' }
            ].map((c) => (
              <Grid item xs={6} md={3} key={c.label}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                    <Typography variant="h6" fontWeight={800} color={c.color}>{c.value}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {data.untagged && !selCostCenter && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              PKR {fmt(data.untagged.totalExpenses)} of expenses and PKR {fmt(data.untagged.totalRevenue)} of revenue in this period
              have no cost center. They are shown as "Not tagged". Older journals from before cost centers were required will appear here.
            </Alert>
          )}

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.100' } }}>
                  <TableCell padding="checkbox" />
                  <TableCell>Code</TableCell>
                  <TableCell>Cost Center</TableCell>
                  {showCompany && <TableCell>Company</TableCell>}
                  <TableCell align="right">Revenue</TableCell>
                  <TableCell align="right">Expenses</TableCell>
                  <TableCell align="right">Net</TableCell>
                  <TableCell align="right">% of Expenses</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <CostCenterRow key={r._id || 'untagged'} row={r} totalExpenses={totals.expenses} showCompany={showCompany} />
                ))}
                <TableRow sx={{ '& td': { fontWeight: 800, bgcolor: 'grey.100' } }}>
                  <TableCell />
                  <TableCell />
                  <TableCell>Total</TableCell>
                  {showCompany && <TableCell />}
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{fmt(totals.revenue)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{fmt(totals.expenses)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{fmt(totals.net)}</TableCell>
                  <TableCell align="right">{totals.expenses ? '100%' : '—'}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          <Divider sx={{ mt: 1, visibility: 'hidden' }} />
          <Typography variant="caption" color="text.secondary">
            Click a cost center to see its accounts. Figures come from posted journals of {companyName}; year-end closing journals are left out.
          </Typography>
        </>
      )}

      {data && rows.length === 0 && !loading && (
        <Alert severity="info">No posted revenue or expense transactions found for the selected filters.</Alert>
      )}
    </Box>
  );
}

export default function CostCenterPL() {
  const [tab, setTab] = useState(0);
  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <CostCenterIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>Cost Center P&L</Typography>
      </Box>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} className="print-hide-toolbar">
        <Tab label="By Cost Center" />
        <Tab label="By Department" />
      </Tabs>
      {tab === 0 ? <CostCenterView /> : <DepartmentPLView />}
    </Box>
  );
}
