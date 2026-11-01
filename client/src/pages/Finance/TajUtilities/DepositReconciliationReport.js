import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import {
  GetApp as DownloadIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { fetchDepositReconciliation } from '../../../services/tajResidentsService';
import { fetchReports } from '../../../services/propertyInvoiceService';

const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

const POSTED_AS = {
  current: { label: 'Current month', color: 'success' },
  arrears: { label: 'Arrears', color: 'warning' },
  advance: { label: 'Advance', color: 'info' },
  not_linked: { label: 'Not linked to invoice', color: 'default' }
};

const formatBillMonth = (key) => (key ? dayjs(`${key}-01`).format('MMM YYYY') : '—');
const formatDate = (value) => (value ? dayjs(value).format('DD MMM YYYY') : '—');

const residentLabel = (resident, isSuspense) => {
  if (isSuspense) return 'Suspense Account';
  return resident?.name || resident?.residentId || '—';
};

const SummaryCard = ({ title, value, color, note }) => (
  <Grid item xs={6} sm={4} md={2}>
    <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Typography variant="caption" color="text.secondary">{title}</Typography>
      <Typography variant="subtitle1" fontWeight={700} color={color}>{formatCurrency(value)}</Typography>
      {note && <Typography variant="caption" color="text.secondary">{note}</Typography>}
    </Paper>
  </Grid>
);

const MonthStep = ({ sign, title, value, color, strong }) => (
  <Grid item xs={6} sm={4} md>
    <Paper variant="outlined" sx={{ p: 1.5, height: '100%', bgcolor: strong ? 'action.hover' : undefined }}>
      <Typography variant="caption" color="text.secondary">{sign ? `${sign} ` : ''}{title}</Typography>
      <Typography variant="subtitle1" fontWeight={700} color={color}>{formatCurrency(value)}</Typography>
    </Paper>
  </Grid>
);

/** Same figures as the Month-wise Breakdown row: arrears + invoiced − paid on that month's invoices. */
const buildMonthReconciliation = (monthRow) => {
  if (!monthRow) return null;
  const arrears = Number(monthRow.arrears) || 0;
  const invoiced = Number(monthRow.invoiceAmount) || 0;
  const received = Number(monthRow.paymentsReceived) || 0;
  return {
    arrears,
    invoiced,
    totalDue: arrears + invoiced,
    received,
    balance: arrears + invoiced - received,
    invoiceCount: Number(monthRow.invoiceCount) || 0
  };
};

const DepositRow = ({ row }) => {
  const [open, setOpen] = useState(false);
  const { resident } = row;
  return (
    <Fragment>
      <TableRow hover sx={{ '& > td': { borderBottom: open ? 'unset' : undefined } }}>
        <TableCell padding="checkbox">
          <IconButton size="small" onClick={() => setOpen((v) => !v)} aria-label="Show postings">
            {open ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell>{formatDate(row.date)}</TableCell>
        <TableCell>{row.isSuspense ? '—' : (resident.residentId || '—')}</TableCell>
        <TableCell>
          <Typography variant="body2" color={row.isSuspense ? 'error.main' : 'text.primary'}>
            {residentLabel(resident, row.isSuspense)}
          </Typography>
        </TableCell>
        <TableCell>{row.bank}</TableCell>
        <TableCell>{row.reference || '—'}</TableCell>
        <TableCell align="right"><strong>{formatCurrency(row.amount)}</strong></TableCell>
        <TableCell align="right" sx={{ color: 'success.main' }}>{formatCurrency(row.posted.current)}</TableCell>
        <TableCell align="right" sx={{ color: 'warning.main' }}>{formatCurrency(row.posted.arrears)}</TableCell>
        <TableCell align="right" sx={{ color: 'info.main' }}>{formatCurrency(row.posted.advance + row.posted.not_linked)}</TableCell>
        <TableCell align="right" sx={{ color: row.unposted > 0 ? 'error.main' : 'text.secondary' }}>
          {formatCurrency(row.unposted)}
        </TableCell>
        <TableCell align="right" sx={{ color: row.outstandingShare > 0 ? 'warning.main' : 'text.secondary' }}>
          {row.isSuspense ? '—' : formatCurrency(row.outstandingShare)}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={12} sx={{ py: 0, bgcolor: 'action.hover' }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ py: 2 }}>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={7}>
                  <Typography variant="subtitle2" gutterBottom>Resident</Typography>
                  {row.isSuspense ? (
                    <Typography variant="body2" color="text.secondary">
                      Deposit sits in the Suspense Account (resident not identified yet).
                    </Typography>
                  ) : (
                    <Grid container spacing={1}>
                      {[
                        ['Name', resident.name],
                        ['Resident ID', resident.residentId],
                        ['Account type', resident.accountType],
                        ['CNIC', resident.cnic],
                        ['Contact', resident.contactNumber],
                        ['Email', resident.email],
                        ['Address', resident.address],
                        ['Properties', resident.properties.join(', ')]
                      ].map(([label, value]) => (
                        <Grid item xs={12} sm={6} key={label}>
                          <Typography variant="caption" color="text.secondary">{label}</Typography>
                          <Typography variant="body2">{value || '—'}</Typography>
                        </Grid>
                      ))}
                    </Grid>
                  )}
                </Grid>
                <Grid item xs={12} md={5}>
                  <Typography variant="subtitle2" gutterBottom>Deposit &amp; balances (as of today)</Typography>
                  <Grid container spacing={1}>
                    {[
                      ['Payment method', row.paymentMethod || '—'],
                      ['Description', row.description || '—'],
                      ['Resident total outstanding', row.isSuspense ? '—' : `${formatCurrency(resident.outstandingBalance)} (${resident.openInvoices} open invoices)`],
                      ['Unused deposits', row.isSuspense ? '—' : formatCurrency(resident.unusedDeposits)]
                    ].map(([label, value]) => (
                      <Grid item xs={12} sm={6} key={label}>
                        <Typography variant="caption" color="text.secondary">{label}</Typography>
                        <Typography variant="body2">{value}</Typography>
                      </Grid>
                    ))}
                  </Grid>
                </Grid>
              </Grid>

              <Typography variant="subtitle2" gutterBottom>Posted to invoices</Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Invoice #</strong></TableCell>
                      <TableCell><strong>Bill month</strong></TableCell>
                      <TableCell><strong>Posted as</strong></TableCell>
                      <TableCell><strong>Charges</strong></TableCell>
                      <TableCell><strong>Property</strong></TableCell>
                      <TableCell><strong>Posted on</strong></TableCell>
                      <TableCell align="right"><strong>Amount posted</strong></TableCell>
                      <TableCell align="right"><strong>Invoice total</strong></TableCell>
                      <TableCell align="right"><strong>Invoice balance</strong></TableCell>
                      <TableCell align="right"><strong>Outstanding (today)</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {row.postings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} align="center">
                          <Typography variant="body2" color="text.secondary">Not posted to any invoice yet</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {row.postings.map((p, i) => (
                      <TableRow key={`${p.invoiceId || 'none'}-${i}`}>
                        <TableCell>{p.invoiceNumber || '—'}</TableCell>
                        <TableCell>{formatBillMonth(p.billMonth)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={POSTED_AS[p.postedAs].label} color={POSTED_AS[p.postedAs].color} variant="outlined" />
                        </TableCell>
                        <TableCell>{(p.chargeTypes || []).join(', ') || '—'}</TableCell>
                        <TableCell>{p.property || '—'}</TableCell>
                        <TableCell>{formatDate(p.postedAt)}</TableCell>
                        <TableCell align="right"><strong>{formatCurrency(p.amount)}</strong></TableCell>
                        <TableCell align="right">{p.invoiceId ? formatCurrency(p.invoiceTotal) : '—'}</TableCell>
                        <TableCell align="right" sx={{ color: p.invoiceBalance > 0 ? 'warning.main' : 'text.secondary' }}>
                          {p.invoiceId ? formatCurrency(p.invoiceBalance) : '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ color: p.outstanding > 0 ? 'warning.main' : 'text.secondary' }}>
                          {row.isSuspense ? '—' : formatCurrency(p.outstanding)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {row.unposted > 0 && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Typography variant="body2" color="error.main">Unposted (still in deposit)</Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ color: 'error.main' }}><strong>{formatCurrency(row.unposted)}</strong></TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    )}
                    {row.otherOpenInvoices.map((o) => (
                      <TableRow key={`open-${o.invoiceId}`}>
                        <TableCell>{o.invoiceNumber || '—'}</TableCell>
                        <TableCell>{formatBillMonth(o.billMonth)}</TableCell>
                        <TableCell>
                          <Chip size="small" label="Open – nothing posted" variant="outlined" />
                        </TableCell>
                        <TableCell>{(o.chargeTypes || []).join(', ') || '—'}</TableCell>
                        <TableCell>{o.property || '—'}</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell align="right">—</TableCell>
                        <TableCell align="right">{formatCurrency(o.invoiceTotal)}</TableCell>
                        <TableCell align="right">{formatCurrency(o.invoiceBalance)}</TableCell>
                        <TableCell align="right" sx={{ color: 'warning.main' }}>{formatCurrency(o.outstanding)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  );
};

const DepositReconciliationReport = () => {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [bank, setBank] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [monthRecon, setMonthRecon] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    try {
      setLoading(true);
      setError('');
      const params = { month, timezone: BROWSER_TIMEZONE };
      if (bank) params.bank = bank;
      if (search) params.search = search;
      const [response, monthReport] = await Promise.all([
        fetchDepositReconciliation(params),
        // Neighbouring months too, so edge-of-month invoices bucket exactly as in the Month-wise Breakdown
        fetchReports({
          startMonth: dayjs(`${month}-01`).subtract(1, 'month').format('YYYY-MM'),
          endMonth: dayjs(`${month}-01`).add(1, 'month').format('YYYY-MM')
        })
      ]);
      setData(response.data?.data || null);
      const monthRow = (monthReport.data?.data?.byMonth || []).find((r) => r.month === month);
      setMonthRecon(buildMonthReconciliation(monthRow));
      setPage(0);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load deposit reconciliation');
    } finally {
      setLoading(false);
    }
  }, [month, bank, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounce the search box
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const totals = data?.totals;
  const deposits = useMemo(() => data?.deposits || [], [data]);
  const pagedDeposits = deposits.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const reconciled = totals ? Math.abs(totals.amount - totals.totalPosted - totals.unposted) < 1 : true;

  const exportToExcel = useCallback(async () => {
    if (!data) return;
    try {
      setExporting(true);
      const { Workbook } = await import('exceljs');
      const workbook = new Workbook();
      const monthLabel = formatBillMonth(data.month);

      if (monthRecon) {
        const reconSheet = workbook.addWorksheet('Month Reconciliation');
        reconSheet.columns = [{ width: 44 }, { width: 20 }];
        reconSheet.addRow([`Month reconciliation — ${monthLabel} (all invoices billed in the month)`]).font = { bold: true };
        [
          ['Arrears brought forward', monthRecon.arrears],
          ['+ Invoiced in the month', monthRecon.invoiced],
          ['= Total due', monthRecon.totalDue],
          ['− Received on these invoices', monthRecon.received],
          ['= Balance remaining', monthRecon.balance]
        ].forEach(([label, value]) => {
          const added = reconSheet.addRow([label, value]);
          if (label.startsWith('=')) added.font = { bold: true };
        });
      }

      const summarySheet = workbook.addWorksheet('Bank Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
      const summaryHeaders = ['Bank', 'Deposits', 'Received', 'Posted - Current month', 'Posted - Arrears', 'Posted - Advance', 'Posted - Not linked', 'Unposted'];
      summarySheet.columns = summaryHeaders.map((h, i) => ({ width: i === 0 ? 28 : 20 }));
      summarySheet.addRow(summaryHeaders).font = { bold: true };
      [...data.byBank, { ...data.totals, bank: 'Total' }].forEach((b) => {
        const added = summarySheet.addRow([
          b.bank, b.count, b.amount, b.posted.current, b.posted.arrears, b.posted.advance, b.posted.not_linked, b.unposted
        ]);
        if (b.bank === 'Total') added.font = { bold: true };
      });

      const detailSheet = workbook.addWorksheet('Deposit Postings', { views: [{ state: 'frozen', ySplit: 1 }] });
      const detailHeaders = [
        'Deposit Date', 'Bank', 'Payment Method', 'Reference', 'Deposit Amount',
        'Resident ID', 'Resident Name', 'Account Type', 'CNIC', 'Contact', 'Email', 'Address', 'Properties',
        'Invoice #', 'Bill Month', 'Posted As', 'Charges', 'Invoice Property', 'Posted On', 'Amount Posted',
        'Invoice Total', 'Invoice Balance', 'Outstanding (today)', 'Resident Unused Deposits (today)'
      ];
      const widths = [14, 22, 16, 18, 16, 12, 24, 14, 16, 16, 24, 28, 30, 18, 12, 18, 18, 28, 14, 16, 16, 16, 20, 20];
      detailSheet.columns = widths.map((width) => ({ width }));
      detailSheet.addRow(detailHeaders).font = { bold: true };

      // Resident balances go on one row each so a resident's rows add up to their total
      const unusedShown = new Set();
      data.deposits.forEach((d) => {
        const r = d.resident;
        const residentKey = String(r._id);
        const unusedCell = () => {
          if (d.isSuspense || unusedShown.has(residentKey)) return '';
          unusedShown.add(residentKey);
          return r.unusedDeposits;
        };
        const base = [
          formatDate(d.date), d.bank, d.paymentMethod || '', d.reference || '', d.amount,
          d.isSuspense ? '' : r.residentId, residentLabel(r, d.isSuspense), r.accountType, r.cnic, r.contactNumber,
          r.email, r.address, r.properties.join(', ')
        ];
        d.postings.forEach((p) => {
          detailSheet.addRow([
            ...base,
            p.invoiceNumber || '', formatBillMonth(p.billMonth), POSTED_AS[p.postedAs].label,
            (p.chargeTypes || []).join(', '), p.property || '', formatDate(p.postedAt), p.amount,
            p.invoiceId ? p.invoiceTotal : '', p.invoiceId ? p.invoiceBalance : '',
            d.isSuspense ? '' : p.outstanding, unusedCell()
          ]);
        });
        if (d.unposted > 0 || d.postings.length === 0) {
          detailSheet.addRow([...base, '', '', 'Unposted', '', '', '', d.unposted, '', '', d.isSuspense ? '' : 0, unusedCell()]);
        }
        d.otherOpenInvoices.forEach((o) => {
          detailSheet.addRow([
            ...base,
            o.invoiceNumber || '', formatBillMonth(o.billMonth), 'Open – nothing posted',
            (o.chargeTypes || []).join(', '), o.property || '', '', '',
            o.invoiceTotal, o.invoiceBalance, o.outstanding, unusedCell()
          ]);
        });
      });

      [summarySheet, detailSheet].forEach((sheet) => {
        sheet.eachRow((row) => row.eachCell((cell) => {
          if (typeof cell.value === 'number') cell.numFmt = '#,##0';
        }));
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Deposit_Reconciliation_${monthLabel.replace(' ', '_')}${bank ? `_${bank.replace(/\s+/g, '_')}` : ''}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to export deposit reconciliation');
    } finally {
      setExporting(false);
    }
  }, [data, bank, monthRecon]);

  return (
    <Card sx={{ mt: 4 }}>
      <CardContent>
        <Typography variant="h6" fontWeight={600}>
          Deposit Reconciliation (Bank-wise)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Every deposit received in the month, by bank, and the invoices it was posted to. A posting is
          &quot;Current month&quot; when the invoice is for the deposit month, &quot;Arrears&quot; when it is for an earlier month,
          and &quot;Advance&quot; for a later month. Balances are as of today: Outstanding is split per invoice (same as the
          Resident Ledger), so a resident&apos;s rows add up to their total.
        </Typography>

        <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              label="Month"
              type="month"
              size="small"
              fullWidth
              value={month}
              onChange={(e) => { setMonth(e.target.value); setBank(''); }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl size="small" fullWidth>
              <InputLabel>Bank</InputLabel>
              <Select label="Bank" value={bank} onChange={(e) => setBank(e.target.value)}>
                <MenuItem value="">All banks</MenuItem>
                {(data?.banks || []).map((b) => (
                  <MenuItem key={b} value={b}>{b}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              size="small"
              fullWidth
              placeholder="Resident, ID, CNIC, contact, plot or reference"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                )
              }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
                Refresh
              </Button>
              <Button
                variant="contained"
                startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
                onClick={exportToExcel}
                disabled={!data || exporting || deposits.length === 0}
              >
                Excel
              </Button>
            </Stack>
          </Grid>
        </Grid>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        {loading && !data ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
        ) : totals && (
          <Box sx={{ opacity: loading ? 0.6 : 1 }}>
            {monthRecon && (
              <>
                <Typography variant="subtitle1" fontWeight={600}>
                  Month reconciliation — {formatBillMonth(data.month)}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                  All {monthRecon.invoiceCount} invoices billed in the month, same figures as the Month-wise Breakdown
                  (not affected by the bank or search filter). Paying an older invoice already lowers the arrears here.
                </Typography>
                <Grid container spacing={1.5} sx={{ mb: 3 }}>
                  <MonthStep title="Arrears brought forward" value={monthRecon.arrears} color="warning.main" />
                  <MonthStep sign="+" title="Invoiced in the month" value={monthRecon.invoiced} />
                  <MonthStep sign="=" title="Total due" value={monthRecon.totalDue} strong />
                  <MonthStep sign="−" title="Received on these invoices" value={monthRecon.received} color="success.main" />
                  <MonthStep sign="=" title="Balance remaining" value={monthRecon.balance} color="error.main" strong />
                </Grid>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Deposits received in the month</Typography>
              </>
            )}
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              <SummaryCard title={`Received (${totals.count})`} value={totals.amount} />
              <SummaryCard title="Posted - Current month" value={totals.posted.current} color="success.main" />
              <SummaryCard title="Posted - Arrears" value={totals.posted.arrears} color="warning.main" />
              <SummaryCard
                title="Posted - Advance"
                value={totals.posted.advance + totals.posted.not_linked}
                color="info.main"
                note={totals.posted.not_linked > 0 ? `incl. ${formatCurrency(totals.posted.not_linked)} not linked` : undefined}
              />
              <SummaryCard title="Total posted" value={totals.totalPosted} />
              <SummaryCard title="Unposted" value={totals.unposted} color={totals.unposted > 0 ? 'error.main' : undefined} />
            </Grid>

            {!reconciled && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Postings exceed some deposit amounts: received {formatCurrency(totals.amount)} vs posted {formatCurrency(totals.totalPosted)} + unposted {formatCurrency(totals.unposted)}.
              </Alert>
            )}

            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Bank-wise summary</Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell><strong>Bank</strong></TableCell>
                    <TableCell align="right"><strong>Deposits</strong></TableCell>
                    <TableCell align="right"><strong>Received</strong></TableCell>
                    <TableCell align="right"><strong>Current month</strong></TableCell>
                    <TableCell align="right"><strong>Arrears</strong></TableCell>
                    <TableCell align="right"><strong>Advance</strong></TableCell>
                    <TableCell align="right"><strong>Unposted</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.byBank.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography variant="body2" color="text.secondary">No deposits in {formatBillMonth(data.month)}</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {data.byBank.map((b) => (
                    <TableRow
                      key={b.bank}
                      hover
                      selected={bank === b.bank}
                      sx={{ cursor: 'pointer' }}
                      onClick={() => setBank(bank === b.bank ? '' : b.bank)}
                    >
                      <TableCell>{b.bank}</TableCell>
                      <TableCell align="right">{b.count}</TableCell>
                      <TableCell align="right"><strong>{formatCurrency(b.amount)}</strong></TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>{formatCurrency(b.posted.current)}</TableCell>
                      <TableCell align="right" sx={{ color: 'warning.main' }}>{formatCurrency(b.posted.arrears)}</TableCell>
                      <TableCell align="right" sx={{ color: 'info.main' }}>{formatCurrency(b.posted.advance + b.posted.not_linked)}</TableCell>
                      <TableCell align="right" sx={{ color: b.unposted > 0 ? 'error.main' : 'text.secondary' }}>{formatCurrency(b.unposted)}</TableCell>
                    </TableRow>
                  ))}
                  {data.byBank.length > 1 && (
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      <TableCell><strong>Total</strong></TableCell>
                      <TableCell align="right"><strong>{totals.count}</strong></TableCell>
                      <TableCell align="right"><strong>{formatCurrency(totals.amount)}</strong></TableCell>
                      <TableCell align="right"><strong>{formatCurrency(totals.posted.current)}</strong></TableCell>
                      <TableCell align="right"><strong>{formatCurrency(totals.posted.arrears)}</strong></TableCell>
                      <TableCell align="right"><strong>{formatCurrency(totals.posted.advance + totals.posted.not_linked)}</strong></TableCell>
                      <TableCell align="right"><strong>{formatCurrency(totals.unposted)}</strong></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
              Deposits {bank ? `— ${bank}` : ''}
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell padding="checkbox" />
                    <TableCell><strong>Date</strong></TableCell>
                    <TableCell><strong>Resident ID</strong></TableCell>
                    <TableCell><strong>Resident</strong></TableCell>
                    <TableCell><strong>Bank</strong></TableCell>
                    <TableCell><strong>Reference</strong></TableCell>
                    <TableCell align="right"><strong>Amount</strong></TableCell>
                    <TableCell align="right"><strong>Current month</strong></TableCell>
                    <TableCell align="right"><strong>Arrears</strong></TableCell>
                    <TableCell align="right"><strong>Advance</strong></TableCell>
                    <TableCell align="right"><strong>Unposted</strong></TableCell>
                    <TableCell align="right"><strong>Outstanding (today)</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deposits.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} align="center">
                        <Typography variant="body2" color="text.secondary">No deposits match the filters</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {pagedDeposits.map((row) => <DepositRow key={row._id} row={row} />)}
                </TableBody>
              </Table>
            </TableContainer>
            {deposits.length > 0 && (
              <TablePagination
                component="div"
                count={deposits.length}
                page={page}
                onPageChange={(e, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                rowsPerPageOptions={[25, 50, 100]}
              />
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default DepositReconciliationReport;
