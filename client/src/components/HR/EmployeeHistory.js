import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Paper,
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
import { alpha } from '@mui/material/styles';
import {
  History as HistoryIcon,
  PictureAsPdf as PdfIcon,
  GridOn as ExcelIcon,
  ArrowForward as ArrowIcon,
  SwapHoriz as TransferIcon,
  TrendingUp as IncrementIcon,
  Badge as DesignationIcon,
  CalendarMonth as ServiceIcon,
  Payments as SalaryIcon,
  ReceiptLong as PayrollIcon
} from '@mui/icons-material';
import api from '../../services/api';
import {
  CAREER_TYPES,
  ACTIVITY_TYPES,
  TYPE_META,
  fmtDate,
  serviceLength,
  downloadEmployeeHistoryPdf,
  downloadEmployeeHistoryExcel
} from '../../utils/employeeHistoryExport';

const pkr = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;

const StatTile = ({ icon, label, value, sub, color }) => (
  <Paper
    variant="outlined"
    sx={{ p: 1.75, height: '100%', borderRadius: 2, display: 'flex', gap: 1.5, alignItems: 'center' }}
  >
    <Box
      sx={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
        bgcolor: alpha(color, 0.12), color
      }}
    >
      {icon}
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: 700 }} noWrap>{value}</Typography>
      {sub ? <Typography variant="caption" color="text.secondary" noWrap display="block">{sub}</Typography> : null}
    </Box>
  </Paper>
);

/** Vertical timeline grouped by year. */
const EventTimeline = ({ events, empty }) => {
  if (!events.length) {
    return <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{empty}</Typography>;
  }
  let lastYear = null;
  return (
    <Box sx={{ maxHeight: 560, overflowY: 'auto', pr: 1 }}>
      {events.map((t, i) => {
        const year = new Date(t.date).getFullYear();
        const showYear = year !== lastYear;
        lastYear = year;
        const meta = TYPE_META[t.type] || { label: t.type, color: '#757575' };
        return (
          <React.Fragment key={`${t.type}-${t.date}-${i}`}>
            {showYear && (
              <Typography variant="overline" sx={{ display: 'block', fontWeight: 700, color: 'text.secondary', mt: i ? 1.5 : 0, mb: 0.5 }}>
                {year}
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ width: 84, flexShrink: 0, pt: 1.1, textAlign: 'right' }}>
                {fmtDate(t.date)}
              </Typography>
              <Box sx={{ position: 'relative', width: 16, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                <Box sx={{ position: 'absolute', top: 0, bottom: 0, width: 2, bgcolor: 'divider' }} />
                <Box
                  sx={{
                    position: 'relative', mt: 1.25, width: 12, height: 12, borderRadius: '50%',
                    bgcolor: meta.color, boxShadow: (th) => `0 0 0 3px ${th.palette.background.paper}`
                  }}
                />
              </Box>
              <Paper
                variant="outlined"
                sx={{ flex: 1, minWidth: 0, p: 1.25, mb: 1, borderRadius: 1.5, borderLeft: `3px solid ${meta.color}` }}
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip
                    label={meta.label}
                    size="small"
                    sx={{ height: 20, fontSize: 11, fontWeight: 600, bgcolor: alpha(meta.color, 0.12), color: meta.color }}
                  />
                  <Typography variant="body2" fontWeight={600}>{t.title}</Typography>
                </Stack>
                {t.details ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
                    {t.details}
                  </Typography>
                ) : null}
              </Paper>
            </Box>
          </React.Fragment>
        );
      })}
    </Box>
  );
};

/** Employee History: career timeline, payroll by month, leaves/loans, change log + PDF / Excel download. */
const EmployeeHistory = ({ employeeId }) => {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    if (!employeeId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get(`/hr/employees/${employeeId}/history`)
      .then((res) => { if (!cancelled) setData(res.data?.data || null); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Could not load employee history'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employeeId]);

  const timeline = useMemo(() => data?.timeline || [], [data]);
  const career = useMemo(() => timeline.filter((t) => CAREER_TYPES.includes(t.type)), [timeline]);
  const activity = useMemo(() => timeline.filter((t) => ACTIVITY_TYPES.includes(t.type) || t.type === 'kpi'), [timeline]);
  const payroll = data?.payroll || [];
  const changes = data?.changes || [];
  const emp = data?.employee || {};
  const count = (type) => timeline.filter((t) => t.type === type).length;

  const download = async (kind) => {
    if (!data) return;
    setDownloading(kind);
    try {
      if (kind === 'pdf') await downloadEmployeeHistoryPdf(data);
      else await downloadEmployeeHistoryExcel(data);
    } catch (e) {
      setError(`Download failed: ${e.message}`);
    } finally {
      setDownloading('');
    }
  };

  return (
    <Card sx={{ mt: 3, borderRadius: 2 }}>
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1.5}
          sx={{ mb: 2 }}
        >
          <Box>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
              <HistoryIcon color="primary" />
              Employee History
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Transfers, designation changes, increments, salary revisions, payroll, leaves, loans and every change to the record.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              startIcon={downloading === 'pdf' ? <CircularProgress size={14} /> : <PdfIcon />}
              disabled={!data || !!downloading}
              onClick={() => download('pdf')}
            >
              PDF
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="success"
              startIcon={downloading === 'excel' ? <CircularProgress size={14} /> : <ExcelIcon />}
              disabled={!data || !!downloading}
              onClick={() => download('excel')}
            >
              Excel
            </Button>
          </Stack>
        </Stack>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress size={30} /></Box>
        )}
        {!loading && error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!loading && data && (
          <>
            <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
              <Grid item xs={6} md={4} lg={2}>
                <StatTile icon={<ServiceIcon fontSize="small" />} color="#2e7d32" label="Service"
                  value={serviceLength(emp.joinedOn, emp.leftOn)} sub={`Joined ${fmtDate(emp.joinedOn)}`} />
              </Grid>
              <Grid item xs={6} md={4} lg={2}>
                <StatTile icon={<SalaryIcon fontSize="small" />} color="#00838f" label="Gross Salary"
                  value={pkr(emp.grossSalary)} sub={emp.status || ''} />
              </Grid>
              <Grid item xs={6} md={4} lg={2}>
                <StatTile icon={<TransferIcon fontSize="small" />} color="#6a1b9a" label="Transfers"
                  value={count('transfer')} sub={emp.project || emp.department || ''} />
              </Grid>
              <Grid item xs={6} md={4} lg={2}>
                <StatTile icon={<DesignationIcon fontSize="small" />} color="#1565c0" label="Designation Changes"
                  value={count('promotion')} sub={emp.designation || ''} />
              </Grid>
              <Grid item xs={6} md={4} lg={2}>
                <StatTile icon={<IncrementIcon fontSize="small" />} color="#00897b" label="Increments / Revisions"
                  value={count('increment') + count('salary_change')} sub={`${count('increment')} increment(s)`} />
              </Grid>
              <Grid item xs={6} md={4} lg={2}>
                <StatTile icon={<PayrollIcon fontSize="small" />} color="#546e7a" label="Payroll Months"
                  value={payroll.length} sub={payroll[0] ? `Last: ${payroll[0].label}` : ''} />
              </Grid>
            </Grid>

            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
            >
              <Tab label={`Career (${career.length})`} />
              <Tab label={`Payroll (${payroll.length})`} />
              <Tab label={`Leaves & Loans (${activity.length})`} />
              <Tab label={`Change Log (${changes.length})`} />
            </Tabs>

            {tab === 0 && (
              <EventTimeline
                events={career}
                empty="No career events yet. Transfers, designation changes, salary revisions and status changes appear here as they are made."
              />
            )}

            {tab === 1 && (
              payroll.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No payrolls yet.</Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 520, borderRadius: 1.5 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {['Month', 'Gross', 'Days', 'Arrears', 'Earnings', 'Income Tax', 'Deductions', 'Net Pay', 'Status'].map((h, i) => (
                          <TableCell key={h} align={i > 0 && i < 8 && h !== 'Days' ? 'right' : 'left'} sx={{ fontWeight: 700, bgcolor: 'grey.100' }}>
                            {h}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {payroll.map((p) => (
                        <TableRow key={`${p.year}-${p.month}`} hover>
                          <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.label}</TableCell>
                          <TableCell align="right">{pkr(p.grossSalary)}</TableCell>
                          <TableCell>
                            {p.days === 'Full' ? 'Full' : <Chip size="small" label={p.days} color="warning" variant="outlined" sx={{ height: 20 }} />}
                          </TableCell>
                          <TableCell align="right">{p.arrears ? pkr(p.arrears) : '—'}</TableCell>
                          <TableCell align="right">{pkr(p.totalEarnings)}</TableCell>
                          <TableCell align="right">{pkr(p.incomeTax)}</TableCell>
                          <TableCell align="right">{pkr(p.totalDeductions)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{pkr(p.netSalary)}</TableCell>
                          <TableCell><Chip size="small" label={p.status} variant="outlined" sx={{ height: 20 }} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )
            )}

            {tab === 2 && (
              <EventTimeline events={activity} empty="No leaves, loans, advances, salary cuts or KPI records yet." />
            )}

            {tab === 3 && (
              changes.length === 0 ? (
                <Alert severity="info">
                  No changes recorded yet. Every change to this employee&apos;s record (designation, department, project,
                  salary, allowances, status, reporting line, bank, …) is saved here with the old and new value, who made it and when.
                </Alert>
              ) : (
                <Stack spacing={1.25} sx={{ maxHeight: 560, overflowY: 'auto', pr: 1 }}>
                  {changes.map((c) => (
                    <Paper key={c._id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                        <Typography variant="body2" fontWeight={700}>{fmtDate(c.changedAt, true)}</Typography>
                        <Typography variant="body2" color="text.secondary">by {c.changedBy}</Typography>
                        {c.source === 'audit' && (
                          <Chip size="small" label="From audit trail" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                        )}
                      </Stack>
                      {(c.changes || []).map((ch) => (
                        <Box
                          key={ch.field}
                          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr auto 1fr' }, gap: 1, alignItems: 'center', py: 0.5, borderTop: 1, borderColor: 'divider' }}
                        >
                          <Typography variant="body2" color="text.secondary" fontWeight={600}>{ch.label}</Typography>
                          <Typography variant="body2" sx={{ color: 'text.secondary', textDecoration: ch.from ? 'line-through' : 'none', wordBreak: 'break-word' }}>
                            {ch.from || '—'}
                          </Typography>
                          <ArrowIcon fontSize="small" color="action" sx={{ display: { xs: 'none', sm: 'block' } }} />
                          <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>{ch.to || '—'}</Typography>
                        </Box>
                      ))}
                    </Paper>
                  ))}
                </Stack>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default EmployeeHistory;
