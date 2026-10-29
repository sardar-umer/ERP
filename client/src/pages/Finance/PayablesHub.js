import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControl, FormControlLabel, Grid, IconButton, InputLabel, MenuItem, Paper, Select, Skeleton, Stack,
  Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  Business as CompanyIcon,
  Close as CloseIcon,
  OpenInNew as OpenIcon,
  Payments as PayIcon,
  Print as PrintIcon,
  Refresh as RefreshIcon,
  Savings as AdvanceIcon,
  WarningAmber as WarnIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import api from '../../services/api';
import AccountsPayable from './AccountsPayable';
import VendorAdvance from './VendorAdvance';
import PODocumentView from '../Procurement/Store/PODocumentView';
import { PO_A4_ONE_PAGE_PRINT_CSS, printPoFitToOneA4 } from '../../utils/poA4PrintStyles';
import ChangeCompanyDialog, { COMPANY_CHANGE_KIND } from './payables/ChangeCompanyDialog';

const CashApprovals = lazy(() => import('../Procurement/CashApprovals'));

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));

const STAGES = [
  { key: 'ready_to_pay', label: 'To pay', color: 'warning' },
  { key: 'in_payment_approval', label: 'In payment approval', color: 'info' },
  { key: 'awaiting_approval', label: 'Awaiting audit / approval', color: 'default' },
  { key: 'awaiting_bill', label: 'Received, not billed', color: 'default' },
  { key: 'paid', label: 'Paid (recent)', color: 'success' },
  { key: 'all', label: 'All', color: 'default' }
];
const SOURCES = [
  ['', 'All types'],
  ['purchase', 'Purchases (PO / GRN)'],
  ['vendor_bill', 'Vendor bills'],
  ['cash_approval', 'Cash approvals'],
  ['po_advance', 'PO advances'],
  ['ipc', 'Subcontractor IPCs'],
  ['utility', 'Utility / store bills']
];
const ACTION_LABEL = { pay_bill: 'Pay', cash_approval: 'Process', po_advance: 'Pay advance' };

const Kpi = ({ label, value, color, hint, onClick }) => (
  <Card variant="outlined" sx={{ height: '100%', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
    <CardContent sx={{ py: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" fontWeight={700} color={color}>{fmt(value)}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </CardContent>
  </Card>
);

/**
 * Payables — Bills, POs & Cash Approvals: everything the company owes, from every module, paid from one screen like QuickBooks.
 * Each Pay button opens the existing payment window for that item (Vendor Bills payment dialog, the Cash Approval
 * Finance step, Vendor Advance), so authorities, WHT, intercompany and vouchers work exactly as on those pages.
 * Payroll stays on its own queue.
 */
export default function PayablesHub() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [stage, setStage] = useState('ready_to_pay');
  const [source, setSource] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [vendor, setVendor] = useState(null);
  const [vendorAdvance, setVendorAdvance] = useState(null);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [exceptions, setExceptions] = useState(null);
  // Existing payment windows opened from here
  const [payBillId, setPayBillId] = useState(null);
  const [caId, setCaId] = useState(null);
  const [advanceDialog, setAdvanceDialog] = useState({ open: false, prefill: null });
  // PO printable view opened from a row's payee
  const [poView, setPoView] = useState({ open: false, data: null, loading: false });
  // Row whose company is being changed
  const [companyRow, setCompanyRow] = useState(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await api.get('/finance/payables-hub', { params: companyId ? { companyId } : {} });
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load payables');
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/hr/companies', { params: { limit: 1000 } })
      .then((res) => setCompanies(res.data?.data?.companies || res.data?.data || []))
      .catch(() => {});
  }, []);

  // Unused advances for the chosen vendor (applied inside the bill payment dialog)
  useEffect(() => {
    setVendorAdvance(null);
    if (!vendor?.vendorId) return;
    api.get('/finance/accounts-payable/vendor-advance-balance', { params: { vendorId: vendor.vendorId, vendorName: vendor.party } })
      .then((res) => setVendorAdvance(Number(res.data?.data?.totalOpen) || 0))
      .catch(() => setVendorAdvance(null));
  }, [vendor]);

  const vendorOptions = useMemo(() => {
    const seen = new Map();
    (data?.rows || []).forEach((r) => {
      if (!r.party || r.party === '—') return;
      const key = r.vendorId || r.party.toLowerCase();
      if (!seen.has(key)) seen.set(key, { key, vendorId: r.vendorId, party: r.party });
    });
    return [...seen.values()].sort((a, b) => a.party.localeCompare(b.party));
  }, [data]);

  const isVendorRow = useCallback((r) => !vendor
    || (vendor.vendorId ? r.vendorId === vendor.vendorId : (r.party || '').toLowerCase() === vendor.party.toLowerCase()), [vendor]);

  const vendorRows = useMemo(() => (data?.rows || []).filter(isVendorRow), [data, isVendorRow]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendorRows
      .filter((r) => stage === 'all' || r.stage === stage)
      .filter((r) => !source || r.source === source)
      .filter((r) => !overdueOnly || r.overdue)
      .filter((r) => !q || [r.number, r.party, r.company, r.project, ...(r.trail || []).map((t) => t.number)]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .sort((a, b) => (b.overdue - a.overdue) || new Date(a.dueDate || a.date || 0) - new Date(b.dueDate || b.date || 0));
  }, [vendorRows, stage, source, overdueOnly, search]);

  const vendorSummary = useMemo(() => {
    if (!vendor) return null;
    const sum = (list) => list.reduce((t, r) => t + (Number(r.balance) || 0), 0);
    const bills = vendorRows.filter((r) => r.action === 'pay_bill');
    return {
      toPay: sum(bills),
      overdue: sum(vendorRows.filter((r) => r.overdue)),
      inApproval: sum(vendorRows.filter((r) => r.stage === 'in_payment_approval' || r.stage === 'awaiting_approval')),
      poAdvances: sum(vendorRows.filter((r) => r.action === 'po_advance')),
      firstBill: [...bills].sort((a, b) => new Date(a.dueDate || a.date || 0) - new Date(b.dueDate || b.date || 0))[0] || null
    };
  }, [vendor, vendorRows]);

  const closeBillPayment = useCallback(() => { setPayBillId(null); load(); }, [load]);
  const closeCaStep = useCallback(() => { setCaId(null); load(); }, [load]);
  const closeAdvance = () => { setAdvanceDialog({ open: false, prefill: null }); load(); };

  const openPoView = async (id) => {
    setPoView({ open: true, data: null, loading: true });
    try {
      const res = await api.get(`/procurement/purchase-orders/${id}`);
      setPoView({ open: true, data: res.data?.data || null, loading: false });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load the purchase order');
      setPoView({ open: false, data: null, loading: false });
    }
  };

  // Document number → the document page (details, payments, accounting entry, Pay)
  const DOC_KIND = { ap: 'bill', ca: 'cash-approval', po: 'po' };
  const openDocument = (r) => {
    const kind = DOC_KIND[r.key.split(':')[0]];
    if (kind) navigate(`/finance/payables-hub/document/${kind}/${r.id}`);
    else navigate(r.link);
  };

  // Payee → the document's printable view (new tab, so the list keeps its filters)
  const openPrintable = (r) => {
    const id = String(r.id);
    if (r.key.startsWith('ap:')) window.open(`/finance/bill-print/${id}`, '_blank', 'noopener');
    else if (r.key.startsWith('ca:')) window.open(`/procurement/cash-approvals/${id}/print`, '_blank', 'noopener');
    else if (r.key.startsWith('po:')) openPoView(id);
    else navigate(r.link);
  };

  const runAction = (r) => {
    if (r.action === 'pay_bill') setPayBillId(String(r.id));
    else if (r.action === 'cash_approval') setCaId(String(r.id));
    else if (r.action === 'po_advance') {
      setAdvanceDialog({
        open: true,
        prefill: {
          companyId: r.companyId ? String(r.companyId) : '',
          vendorId: r.vendorId,
          vendorName: r.party,
          po: { _id: String(r.id), orderNumber: r.number, totalAmount: r.amount }
        }
      });
    } else navigate(r.link);
  };

  // Advance with or without a PO — the Vendor Advance form lets the PO be left empty
  const openAdvance = () => setAdvanceDialog({
    open: true,
    prefill: vendor?.vendorId
      ? { companyId: companyId || '', vendorId: vendor.vendorId, vendorName: vendor.party }
      : (companyId ? { companyId } : null)
  });

  const openExceptions = async () => {
    setExceptionsOpen(true);
    setExceptions(null);
    try {
      const res = await api.get('/finance/posting-exceptions');
      setExceptions(res.data?.data || []);
    } catch (err) {
      setExceptions([]);
      toast.error(err.response?.data?.message || 'Could not load exceptions');
    }
  };
  const retry = async (item) => {
    try {
      const res = await api.post(item.retryUrl.replace(/^\/api/, ''));
      toast.success(res.data?.message || 'Posted');
      openExceptions();
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Still not posted');
    }
  };

  const s = data?.summary || {};
  const counts = vendor
    ? vendorRows.reduce((acc, r) => { acc[r.stage] = (acc[r.stage] || 0) + 1; return acc; }, {})
    : (s.counts || {});
  const w = data?.warnings || {};

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" alignItems={{ lg: 'center' }} gap={2} sx={{ mb: 2 }}>
        <Box>
          <Stack direction="row" alignItems="center" gap={1}>
            <Typography variant="h5" fontWeight={700}>Payables — Bills, POs &amp; Cash Approvals</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Every bill and payment owed — vendor bills, purchases, IPCs, utilities, cash approvals and advances — paid from one place
          </Typography>
        </Box>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => navigate('/finance/accounts-payable/new?from=/finance/payables-hub')}>
            Enter bill
          </Button>
          <Button variant="outlined" startIcon={<AdvanceIcon />} onClick={openAdvance}>Pay advance</Button>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Company</InputLabel>
            <Select label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <MenuItem value="">All companies</MenuItem>
              {companies.map((c) => <MenuItem key={c._id} value={c._id}>{c.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {(w.postingExceptions > 0 || (w.companiesWithoutFiscalPeriods || []).length > 0) && (
        <Stack spacing={1} sx={{ mb: 2 }}>
          {w.postingExceptions > 0 && (
            <Alert severity="warning" icon={<WarnIcon />} action={<Button color="inherit" size="small" onClick={openExceptions}>Review</Button>}>
              {w.postingExceptions} approved document(s) are not in the ledger yet (store issues / project IPCs / client invoices).
            </Alert>
          )}
          {(w.companiesWithoutFiscalPeriods || []).length > 0 && (
            <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => navigate('/finance/fiscal-periods')}>Set up</Button>}>
              No fiscal periods yet for: {w.companiesWithoutFiscalPeriods.join(', ')} — postings to any date are allowed until periods are opened.
            </Alert>
          )}
        </Stack>
      )}

      <Autocomplete
        size="small"
        options={vendorOptions}
        value={vendor}
        onChange={(_, v) => setVendor(v)}
        getOptionLabel={(o) => o.party}
        isOptionEqualToValue={(a, b) => a.key === b.key}
        renderInput={(params) => <TextField {...params} label="Vendor / payee — show everything for one vendor" />}
        sx={{ mb: 2, maxWidth: 520 }}
      />

      {vendor && vendorSummary ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={2}>
            <Box>
              <Typography variant="h6" fontWeight={700}>{vendor.party}</Typography>
              <Stack direction="row" gap={3} flexWrap="wrap" sx={{ mt: 0.5 }}>
                <Typography variant="body2">Bills to pay: <strong>{fmt(vendorSummary.toPay)}</strong></Typography>
                <Typography variant="body2" color={vendorSummary.overdue ? 'error.main' : 'text.primary'}>Overdue: <strong>{fmt(vendorSummary.overdue)}</strong></Typography>
                <Typography variant="body2">In approval: <strong>{fmt(vendorSummary.inApproval)}</strong></Typography>
                <Typography variant="body2">PO advances due: <strong>{fmt(vendorSummary.poAdvances)}</strong></Typography>
                <Typography variant="body2" color="success.main">
                  Unused advances: <strong>{vendorAdvance == null ? '—' : fmt(vendorAdvance)}</strong>
                </Typography>
              </Stack>
            </Box>
            <Stack direction="row" gap={1}>
              <Button variant="contained" startIcon={<PayIcon />} disabled={!vendorSummary.firstBill}
                onClick={() => setPayBillId(String(vendorSummary.firstBill.id))}>
                Pay bills
              </Button>
              <Button variant="outlined" startIcon={<AdvanceIcon />} onClick={openAdvance}>Pay advance</Button>
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Pay bills opens the bill payment window with all of this vendor&apos;s open bills — enter amounts per bill and apply unused advances there.
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} md={2}><Kpi label="To pay" value={s.readyToPay} color="warning.main" onClick={() => setStage('ready_to_pay')} /></Grid>
          <Grid item xs={6} md={2}><Kpi label="Overdue" value={s.overdue} color="error.main" onClick={() => { setStage('all'); setOverdueOnly(true); }} /></Grid>
          <Grid item xs={6} md={2}><Kpi label="Due in 7 days" value={s.dueIn7Days} hint="Cash needed this week" /></Grid>
          <Grid item xs={6} md={2}><Kpi label="In payment approval" value={s.inPaymentApproval} color="info.main" onClick={() => setStage('in_payment_approval')} /></Grid>
          <Grid item xs={6} md={2}><Kpi label="Awaiting approval / bill" value={(s.awaitingApproval || 0) + (s.awaitingBill || 0)} onClick={() => setStage('awaiting_approval')} /></Grid>
          <Grid item xs={6} md={2}><Kpi label="Paid (last 60 days)" value={s.paidRecently} color="success.main" onClick={() => setStage('paid')} /></Grid>
        </Grid>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Tabs value={stage} onChange={(_, v) => setStage(v)} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}>
          {STAGES.map((st) => (
            <Tab key={st.key} value={st.key} sx={{ textTransform: 'none' }}
              label={`${st.label}${st.key !== 'all' && counts[st.key] ? ` (${counts[st.key]})` : ''}`} />
          ))}
        </Tabs>

        <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }} sx={{ p: 1.5 }}>
          <TextField size="small" label="Search bill, PO, GRN, CA, project…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 280 }} />
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Type</InputLabel>
            <Select label="Type" value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControlLabel control={<Switch checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />} label="Overdue only" />
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary">{rows.length} item(s)</Typography>
        </Stack>

        {!data ? <Box sx={{ p: 2 }}><Skeleton height={240} /></Box> : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Document</TableCell>
                  <TableCell>Payee</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Due</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Balance</TableCell>
                  <TableCell>Stage</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const st = STAGES.find((x) => x.key === r.stage);
                  return (
                    <TableRow key={r.key} hover sx={{ bgcolor: r.overdue ? 'rgba(211,47,47,0.04)' : undefined }}>
                      <TableCell>
                        <Tooltip title="View document">
                          <Typography component="button" type="button" variant="body2" fontWeight={600} color="primary"
                            onClick={() => openDocument(r)}
                            sx={{ font: 'inherit', fontWeight: 600, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer', textAlign: 'left', '&:hover': { textDecoration: 'underline' } }}>
                            {r.number}
                          </Typography>
                        </Tooltip>
                        <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.25 }}>
                          {(r.trail || []).filter((t) => t.number !== r.number).map((t) => (
                            <Chip key={`${t.type}-${t.number}`} size="small" variant="outlined" label={`${t.type} ${t.number}`} sx={{ height: 18, fontSize: '0.65rem' }} />
                          ))}
                        </Stack>
                        {r.note && <Typography variant="caption" color="text.secondary" display="block">{r.note}</Typography>}
                      </TableCell>
                      <TableCell>
                        <Tooltip title="Open printable view">
                          <Typography component="button" type="button" variant="body2" color="primary"
                            onClick={() => openPrintable(r)}
                            sx={{ font: 'inherit', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer', textAlign: 'left', display: 'block', '&:hover': { textDecoration: 'underline' } }}>
                            {r.party}
                          </Typography>
                        </Tooltip>
                        {(r.company || r.project) && <Typography variant="caption" color="text.secondary">{[r.company, r.project].filter(Boolean).join(' · ')}</Typography>}
                        {!r.company && COMPANY_CHANGE_KIND[r.key.split(':')[0]] && (
                          <Chip size="small" color="warning" variant="outlined" label="No company" sx={{ height: 18, fontSize: '0.65rem', ml: r.project ? 0.5 : 0 }} />
                        )}
                      </TableCell>
                      <TableCell><Chip size="small" label={r.sourceLabel} variant="outlined" /></TableCell>
                      <TableCell>{r.date ? dayjs(r.date).format('DD MMM YY') : '—'}</TableCell>
                      <TableCell sx={{ color: r.overdue ? 'error.main' : undefined, fontWeight: r.overdue ? 700 : 400 }}>
                        {r.dueDate ? dayjs(r.dueDate).format('DD MMM YY') : '—'}
                        {r.overdue && <Typography variant="caption" display="block">overdue</Typography>}
                      </TableCell>
                      <TableCell align="right">{fmt(r.amount)}</TableCell>
                      <TableCell align="right">{r.paid ? fmt(r.paid) : '—'}</TableCell>
                      <TableCell align="right"><strong>{fmt(r.balance)}</strong>
                        {r.inApprovalAmount > 0 && <Typography variant="caption" display="block" color="info.main">{fmt(r.inApprovalAmount)} in approval</Typography>}
                      </TableCell>
                      <TableCell><Chip size="small" color={st?.color || 'default'} label={st?.label || r.stage} /></TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {r.action && (
                          <Button size="small" variant="contained" color={r.action === 'pay_bill' ? 'primary' : 'secondary'} onClick={() => runAction(r)}>
                            {ACTION_LABEL[r.action]}
                          </Button>
                        )}
                        {COMPANY_CHANGE_KIND[r.key.split(':')[0]] && r.stage !== 'paid' && (
                          <Tooltip title="Change company">
                            <IconButton size="small" onClick={() => setCompanyRow(r)}><CompanyIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Open in its own screen">
                          <IconButton size="small" onClick={() => navigate(r.link)}><OpenIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!rows.length && (
                  <TableRow><TableCell colSpan={10} align="center"><Typography color="text.secondary" py={3}>Nothing here</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        Pay opens the same payment windows as Vendor Bills, Cash Approvals and Vendor Advance — finance authorities, WHT,
        intercompany and vouchers work exactly as there. Payroll is paid from Payroll (Finance).
      </Typography>

      {/* Existing payment windows. The pages mount hidden; their dialogs show on top of this page. */}
      {payBillId && (
        <Box sx={{ display: 'none' }}>
          <AccountsPayable embedPayBillId={payBillId} onEmbedClose={closeBillPayment} />
        </Box>
      )}
      {caId && (
        <Box sx={{ display: 'none' }}>
          <Suspense fallback={null}>
            <CashApprovals embedCaId={caId} onEmbedClose={closeCaStep} />
          </Suspense>
        </Box>
      )}
      {(payBillId || caId) && <Box sx={{ position: 'fixed', bottom: 16, right: 16 }}><CircularProgress size={20} /></Box>}

      <Dialog open={advanceDialog.open} onClose={closeAdvance} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
          <AdvanceIcon color="primary" />
          <Box component="span" sx={{ flex: 1 }}>Pay vendor advance</Box>
          <IconButton onClick={closeAdvance} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {advanceDialog.open && (
            <VendorAdvance embedPrefill={advanceDialog.prefill} onEmbedSubmitted={closeAdvance} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={poView.open} onClose={() => setPoView({ open: false, data: null, loading: false })} maxWidth={false} fullWidth
        className="payables-po-print"
        PaperProps={{ sx: { width: '90%', maxWidth: '210mm', maxHeight: '95vh', m: 2 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Box component="span" sx={{ flex: 1 }}>Purchase Order {poView.data?.orderNumber || ''}</Box>
          <Button size="small" variant="outlined" startIcon={<PrintIcon />} disabled={!poView.data} onClick={() => printPoFitToOneA4()}>Print</Button>
          <IconButton onClick={() => setPoView({ open: false, data: null, loading: false })} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {poView.loading ? <Box sx={{ p: 3 }}><Skeleton height={400} /></Box> : <PODocumentView data={poView.data} />}
        </DialogContent>
      </Dialog>
      {poView.open && (
        <Box component="style" dangerouslySetInnerHTML={{ __html: `
          @media print {
            body * { visibility: hidden; }
            .payables-po-print .po-print-page, .payables-po-print .po-print-page * { visibility: visible; }
            .payables-po-print .MuiDialog-container { position: absolute !important; inset: 0 !important; display: block !important; }
            .payables-po-print .MuiDialog-paper { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; width: 100% !important; max-height: none !important; overflow: visible !important; }
            .payables-po-print .MuiDialogContent-root { overflow: visible !important; padding: 0 !important; }
            .payables-po-print .MuiDialogTitle-root, .MuiBackdrop-root { display: none !important; }
            ${PO_A4_ONE_PAGE_PRINT_CSS}
          }
        ` }} />
      )}

      <ChangeCompanyDialog
        row={companyRow}
        companies={companies}
        onClose={() => setCompanyRow(null)}
        onChanged={() => { setCompanyRow(null); load(); }}
      />

      <Dialog open={exceptionsOpen} onClose={() => setExceptionsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Documents not in the ledger</DialogTitle>
        <DialogContent dividers>
          {!exceptions ? <Skeleton height={120} /> : !exceptions.length ? (
            <Typography color="text.secondary">Nothing outstanding.</Typography>
          ) : (
            <Table size="small">
              <TableHead><TableRow><TableCell>Document</TableCell><TableCell>Reason</TableCell><TableCell align="right">Amount</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {exceptions.map((x) => (
                  <TableRow key={`${x.kind}-${x.id}`}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{x.number}</Typography>
                      <Typography variant="caption" color="text.secondary">{x.kind.replace(/_/g, ' ')}{x.party ? ` · ${x.party}` : ''}{x.project ? ` · ${x.project}` : ''}</Typography>
                    </TableCell>
                    <TableCell><Typography variant="caption">{x.reasons.join(' · ')}</Typography></TableCell>
                    <TableCell align="right">{fmt(x.amount)}</TableCell>
                    <TableCell align="right"><Button size="small" onClick={() => retry(x)}>Retry</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setExceptionsOpen(false)}>Close</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
