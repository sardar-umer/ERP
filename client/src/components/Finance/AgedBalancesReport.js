import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Alert, Stack, TextField, Button,
  IconButton, Collapse, InputAdornment, Link, TablePagination
} from '@mui/material';
import {
  HourglassBottom as AgedIcon, Refresh as RefreshIcon, Search as SearchIcon,
  KeyboardArrowDown as ExpandIcon, KeyboardArrowRight as CollapseIcon, Add as AddIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import FinanceCompanyPageHeader from './FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';

const fmt = (n) => (Number(n) ? Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'days1_30', label: '1–30 Days' },
  { key: 'days31_60', label: '31–60' },
  { key: 'days61_90', label: '61–90' },
  { key: 'over90', label: 'Over 90', danger: true }
];

const headCell = { fontSize: 13, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 0.5 };
const subHeadCell = { fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 0.4 };

/**
 * Aged Receivables / Payables — one row per customer or vendor, click a row to expand its open documents.
 * kind: 'receivables' | 'payables'
 */
export default function AgedBalancesReport({ kind }) {
  const navigate = useNavigate();
  const isAR = kind === 'receivables';
  const partyLabel = isAR ? 'Customer' : 'Vendor';
  const docLabel = isAR ? 'Invoice' : 'Bill';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(250);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get(`/finance/reports/aged-${kind}`, { params: { asOfDate } });
      setData(res.data.data);
      setExpanded({});
      setPage(0);
    } catch (e) {
      setError(e.response?.data?.message || `Failed to load aged ${kind}`);
    } finally {
      setLoading(false);
    }
  }, [asOfDate, kind]);

  useFinanceCompanyReload(load, { skipInitial: true });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const parties = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = data?.parties || [];
    return term ? list.filter((p) => p.name.toLowerCase().includes(term)) : list;
  }, [data, search]);

  useEffect(() => { setPage(0); }, [search]);
  const pageParties = useMemo(
    () => parties.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [parties, page, rowsPerPage]
  );

  // Totals cover every matching row, not just the current page
  const totals = useMemo(() => {
    const t = Object.fromEntries([...BUCKETS.map((b) => b.key), 'balance'].map((k) => [k, 0]));
    parties.forEach((p) => Object.keys(t).forEach((k) => { t[k] += p[k] || 0; }));
    return t;
  }, [parties]);

  const toggle = (key) => setExpanded((e) => ({ ...e, [key]: !e[key] }));
  const openDoc = (id) => navigate(isAR ? `/finance/invoice-print/${id}` : `/finance/bill-print/${id}`);

  return (
    <Box sx={{ p: 3 }}>
      <FinanceCompanyPageHeader title={isAR ? 'Aged Receivables' : 'Aged Payables'} icon={AgedIcon} />
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>{isAR ? 'Receivables' : 'Payables'}</Typography>
        <TextField
          size="small" placeholder={`Search ${partyLabel.toLowerCase()}`} value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <TextField
          label="As of" type="date" size="small" value={asOfDate}
          onChange={(e) => setAsOfDate(e.target.value)} InputLabelProps={{ shrink: true }}
        />
        <Button variant="outlined" onClick={load} disabled={loading} startIcon={<RefreshIcon />}>Refresh</Button>
        <Button
          variant="contained" color="success" startIcon={<AddIcon />}
          onClick={() => navigate(isAR ? '/finance/customer-payments' : '/finance/vendor-payments')}
        >
          {isAR ? 'Receive payment' : 'Pay bills'}
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.selected', '& > th': { py: 1.5, borderBottom: 2, borderColor: 'divider' } }}>
              <TableCell sx={{ ...headCell, width: 40 }} />
              <TableCell sx={headCell}>{partyLabel}</TableCell>
              {BUCKETS.map((b) => <TableCell key={b.key} align="right" sx={headCell}>{b.label}</TableCell>)}
              <TableCell align="right" sx={headCell}>Balance</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5 }}><CircularProgress size={28} /></TableCell></TableRow>
            )}
            {!loading && parties.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                  {search ? `No ${partyLabel.toLowerCase()} matches "${search}"` : `No outstanding ${kind}`}
                </TableCell>
              </TableRow>
            )}
            {!loading && pageParties.map((p) => (
              <React.Fragment key={p.key}>
                <TableRow hover onClick={() => toggle(p.key)} sx={{ cursor: 'pointer', '& > td': { py: 1.25 } }}>
                  <TableCell>
                    <IconButton size="small">{expanded[p.key] ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}</IconButton>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>
                    {p.name}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {p.items.length} open
                    </Typography>
                  </TableCell>
                  {BUCKETS.map((b) => (
                    <TableCell key={b.key} align="right" sx={{ color: b.danger ? 'error.main' : 'text.primary' }}>
                      {fmt(p[b.key]) || <Typography component="span" color="text.disabled">—</Typography>}
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(p.balance)}</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell colSpan={8} sx={{ p: 0, borderBottom: expanded[p.key] ? undefined : 'none' }}>
                    <Collapse in={Boolean(expanded[p.key])} timeout="auto" unmountOnExit>
                      <Box sx={{ pl: 7, pr: 2, py: 1.5, bgcolor: 'background.default' }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={subHeadCell}>{docLabel} #</TableCell>
                              <TableCell sx={subHeadCell}>Date</TableCell>
                              <TableCell sx={subHeadCell}>Due Date</TableCell>
                              <TableCell align="right" sx={subHeadCell}>Total</TableCell>
                              <TableCell align="right" sx={subHeadCell}>Paid</TableCell>
                              <TableCell align="right" sx={subHeadCell}>Balance</TableCell>
                              <TableCell align="center" sx={subHeadCell}>Days Overdue</TableCell>
                              <TableCell sx={subHeadCell}>Status</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {p.items.map((it) => (
                              <TableRow key={it._id}>
                                <TableCell>
                                  <Link component="button" underline="hover" onClick={() => openDoc(it._id)} sx={{ fontFamily: 'monospace' }}>
                                    {it.number || '—'}
                                  </Link>
                                </TableCell>
                                <TableCell>{fmtDate(it.date)}</TableCell>
                                <TableCell>{fmtDate(it.dueDate)}</TableCell>
                                <TableCell align="right">{fmt(it.total) || '0.00'}</TableCell>
                                <TableCell align="right">{fmt(it.paid) || '—'}</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(it.balance)}</TableCell>
                                <TableCell align="center" sx={{ color: it.bucket === 'over90' ? 'error.main' : 'inherit' }}>
                                  {it.overdue ? it.daysOverdue : '—'}
                                </TableCell>
                                <TableCell>
                                  <Stack direction="row" gap={0.5}>
                                    <Chip
                                      size="small" sx={{ height: 20 }}
                                      label={it.status === 'partial' ? 'Partial' : 'Pending'}
                                      color={it.status === 'partial' ? 'info' : 'default'}
                                    />
                                    {it.overdue && <Chip size="small" sx={{ height: 20 }} label="Overdue" color="error" variant="outlined" />}
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            ))}
            {!loading && parties.length > 0 && (
              <TableRow sx={{ bgcolor: 'action.hover', '& > td': { fontWeight: 700, py: 1.25 } }}>
                <TableCell />
                <TableCell>Total ({parties.length})</TableCell>
                {BUCKETS.map((b) => (
                  <TableCell key={b.key} align="right" sx={{ color: b.danger ? 'error.main' : 'text.primary' }}>{fmt(totals[b.key]) || '—'}</TableCell>
                ))}
                <TableCell align="right">{fmt(totals.balance)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {parties.length > 0 && (
        <TablePagination
          component="div"
          count={parties.length}
          page={page}
          onPageChange={(_, p) => { setPage(p); setExpanded({}); }}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[50, 100, 250, 500, 1000]}
          labelRowsPerPage={`${partyLabel}s per page`}
        />
      )}
    </Box>
  );
}
