import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Table,
  Autocomplete,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import {
  Print as PrintIcon,
  Refresh as RefreshIcon,
  Payments as PaymentsIcon,
  Visibility as VisibilityIcon,
  Download as DownloadIcon,
  Assessment as AssessmentIcon,
  Description as DescriptionIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { useSearchParams, Link as RouterLink } from 'react-router-dom';
import api from '../../services/api';
import {
  fetchFinanceAuthorityCandidates,
  userOptionLabel,
  userOptionSecondary
} from '../../services/financeApprovalAuthorityService';
import { fetchPayFromAccounts, formatPayFromAccountLabel } from '../../utils/payFromAccounts';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import PayrollMonthlyComparisonDialog from '../../components/HR/PayrollMonthlyComparisonDialog';
import PayrollBpvDeductionSummary from '../../components/Finance/PayrollBpvDeductionSummary';
import ManualSalaryFinanceTab from '../../components/Finance/ManualSalaryFinanceTab';
import {
  downloadPayrollBankLetterExcel,
  openPayrollBankLetterPrint
} from '../../utils/payrollBankLetterPrint';
import {
  buildPayrollCompanySummary,
  buildPayrollBpvPreviewLines,
  downloadPayrollCompanySummaryExcel,
  getNetPayableColumnLabel,
  openPayrollCompanySummaryPrint,
  PROJECT_SUMMARY_AMOUNT_COLUMNS,
  aggregatePayrollBreakdownFromRows
} from '../../utils/payrollFinanceSummaryReport';
import useClientPagination from '../../hooks/useClientPagination';

const SR_MANAGER_ACCOUNTS_NAME = 'Muhammad Iftikhar Rashid';

const fmt = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;

const getPayrollColumnAmount = (row, key) => {
  if (key === 'eobiEmployee') {
    return Number(row.eobiEmployee ?? row.eobiDeduction ?? row.eobi ?? 0);
  }
  return Number(row[key] ?? 0);
};

const fmtDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
};

const userDisplayName = (user) => {
  if (!user) return '—';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || '—';
};

const grandTotalRowSx = {
  fontWeight: 800,
  fontSize: '0.9rem',
  color: 'text.primary',
  backgroundColor: 'grey.100',
  borderTop: 2,
  borderColor: 'divider'
};

const statusChip = (status) => {
  if (status === 'paid') return <Chip size="small" color="success" label="Paid" />;
  if (status === 'payment_pending') return <Chip size="small" color="info" label="Payment Pending Approval" />;
  if (status === 'draft_payment') return <Chip size="small" color="default" label="Draft BPV" />;
  if (status === 'pending_payment') return <Chip size="small" color="warning" label="Pending Payment" />;
  return <Chip size="small" label={status || '—'} />;
};

const payrollEmployeeStatusChip = (status) => {
  const label = status || '—';
  const isPaid = String(status || '').trim().toLowerCase() === 'paid';
  return (
    <Chip
      size="small"
      label={label}
      color={isPaid ? 'success' : 'default'}
      variant={isPaid ? 'filled' : 'outlined'}
    />
  );
};

export default function FinancePayroll() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'manual' ? 1 : 0;
  const [mainTab, setMainTab] = useState(initialTab);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [companyFilter, setCompanyFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const { selectedCompanyId, companies: financeCompanies } = useFinanceCompany();
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [financeAuthorityCandidates, setFinanceAuthorityCandidates] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [paymentFinAuth, setPaymentFinAuth] = useState({
    financeControllerUser: null
  });
  const [paymentData, setPaymentData] = useState({
    amount: 0,
    grossAmount: 0,
    paymentMethod: 'bank_transfer',
    reference: '',
    narration: '',
    paymentDate: new Date().toISOString().split('T')[0],
    bankAccountId: ''
  });

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/finance/payroll-queue');
      setQueue(res.data?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load finance payroll queue');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (month, year) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/finance/payroll-queue/${month}/${year}`);
      setDetail(res.data?.data || null);
      setSelected({ month, year, periodLabel: res.data?.data?.periodLabel });
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to load payroll period detail'
      });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    const month = Number(searchParams.get('month'));
    const year = Number(searchParams.get('year'));
    if (month && year) {
      loadDetail(month, year);
    }
  }, [searchParams, loadDetail]);

  useEffect(() => {
    setCompanyFilter('');
    setProjectFilter('');
  }, [selected?.month, selected?.year]);

  const payFromCompanyId = useMemo(() => {
    if (!companyFilter) return selectedCompanyId;
    const match = financeCompanies.find((row) => row.name === companyFilter);
    return match?._id || selectedCompanyId;
  }, [companyFilter, financeCompanies, selectedCompanyId]);

  const [payingCompanyId, setPayingCompanyId] = useState('');

  const effectivePayingCompanyId = useMemo(() => {
    return payingCompanyId || payFromCompanyId;
  }, [payingCompanyId, payFromCompanyId]);

  useEffect(() => {
    if (!paymentDialogOpen) return;
    let cancelled = false;
    fetchFinanceAuthorityCandidates()
      .then((list) => {
        if (!cancelled) {
          setFinanceAuthorityCandidates(list);
          // Pre-select Faisal Farooq by default if available in candidates list
          const faisalMatch = list.find((user) => {
            const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim().toLowerCase();
            return fullName.includes('faisal') && fullName.includes('farooq');
          });
          if (faisalMatch) {
            setPaymentFinAuth((prev) => ({
              ...prev,
              financeControllerUser: faisalMatch
            }));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setFinanceAuthorityCandidates([]);
      });
    fetchPayFromAccounts(api, { companyId: effectivePayingCompanyId })
      .then((list) => {
        if (!cancelled) setBankAccounts(list);
      })
      .catch(() => {
        if (!cancelled) setBankAccounts([]);
      });
    return () => { cancelled = true; };
  }, [paymentDialogOpen, effectivePayingCompanyId]);

  const companyPendingPayrolls = useMemo(() => {
    if (!companyFilter) return [];
    return (detail?.payrolls || []).filter(
      (row) => row.status !== 'Paid' && row.employee?.company === companyFilter
    );
  }, [detail, companyFilter]);

  const selectedCompanyPaymentMeta = useMemo(() => {
    if (!companyFilter || !detail?.companyPayments?.length) return null;
    return detail.companyPayments.find((row) => row.companyName === companyFilter) || null;
  }, [detail, companyFilter]);

  const approvedCompanyPayment = selectedCompanyPaymentMeta?.latestApproval || null;
  const companyDraftPayment = selectedCompanyPaymentMeta?.draftPayment || null;

  const canGenerateBankLetter = Boolean(companyFilter && approvedCompanyPayment);

  const companyBankLetters = useMemo(() => {
    const letters = detail?.bankLetters || [];
    if (!companyFilter) return letters;
    return letters.filter((row) => row.companyName === companyFilter);
  }, [detail, companyFilter]);

  const companyHasPendingPayment = Boolean(selectedCompanyPaymentMeta?.pendingPayment);
  const companyHasDraftPayment = Boolean(companyDraftPayment);

  const bpvPreview = useMemo(() => {
    if (!companyFilter || !companyPendingPayrolls.length) return null;
    return buildPayrollBpvPreviewLines(companyPendingPayrolls, {
      periodLabel: detail?.periodLabel || selected?.periodLabel || '',
      companyName: companyFilter
    });
  }, [companyFilter, companyPendingPayrolls, detail?.periodLabel, selected?.periodLabel]);

  const applyDraftToPaymentForm = (draft) => {
    const meta = draft?.paymentMeta || {};
    const paymentDate = meta.paymentDate
      ? new Date(meta.paymentDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];
    setPaymentFinAuth({ financeControllerUser: null });
    setPaymentData({
      amount: Math.round(Number(draft?.amount) || 0),
      grossAmount: Math.round(Number(meta.grossSalary) || 0),
      paymentMethod: meta.paymentMethod || 'bank_transfer',
      reference: meta.reference || '',
      narration: meta.narration || '',
      paymentDate,
      bankAccountId: meta.bankAccountId ? String(meta.bankAccountId) : ''
    });
    setActiveDraftId(draft?._id || null);
  };

  const openPaymentDialog = (draft = companyDraftPayment) => {
    if (!detail?.summary || !companyFilter) return;
    if (draft) {
      applyDraftToPaymentForm(draft);
      setPaymentDialogOpen(true);
      return;
    }
    const pendingAmount = companyPendingPayrolls.reduce(
      (sum, row) => sum + Math.round(Number(row.netSalary) || 0),
      0
    );
    const pendingGross = companyPendingPayrolls.reduce(
      (sum, row) => sum + Math.round(Number(row.grossSalary) || 0),
      0
    );
    setPaymentFinAuth({ financeControllerUser: null });
    setPaymentData({
      amount: pendingAmount,
      grossAmount: pendingGross,
      paymentMethod: 'bank_transfer',
      reference: selected?.periodLabel ? `PAYROLL-${selected.month}-${selected.year}-${companyFilter.replace(/\s+/g, '-').toUpperCase()}` : '',
      narration: '',
      paymentDate: new Date().toISOString().split('T')[0],
      bankAccountId: ''
    });
    setActiveDraftId(null);
    setPaymentDialogOpen(true);
  };

  const buildPaymentPayload = () => ({
    companyName: companyFilter,
    paymentMethod: paymentData.paymentMethod,
    reference: paymentData.reference,
    narration: paymentData.narration,
    paymentDate: paymentData.paymentDate,
    bankAccountId: paymentData.bankAccountId || null,
    payingCompanyId: payingCompanyId || null,
    draftId: activeDraftId || null
  });

  const handleSaveDraft = async () => {
    if (!selected || !companyFilter) return;

    try {
      setProcessingPayment(true);
      const res = await api.post(
        `/finance/payroll-queue/${selected.month}/${selected.year}/save-draft`,
        buildPaymentPayload()
      );
      const draftId = res.data?.data?.application?._id;
      if (draftId) setActiveDraftId(draftId);
      setSnackbar({
        open: true,
        severity: 'success',
        message: res.data?.message || 'Payroll payment draft saved'
      });
      await Promise.all([loadQueue(), loadDetail(selected.month, selected.year)]);
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to save payroll payment draft'
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleMakePayment = async () => {
    if (!selected || !companyFilter) return;

    if (!activeDraftId) {
      setSnackbar({ open: true, severity: 'warning', message: 'Save a draft first, then submit for GM Finance approval.' });
      return;
    }

    if (!paymentFinAuth.financeControllerUser) {
      setSnackbar({ open: true, severity: 'warning', message: 'Select GM Finance before submitting.' });
      return;
    }

    const financeControllerUser =
      paymentFinAuth.financeControllerUser?._id || paymentFinAuth.financeControllerUser;

    try {
      setProcessingPayment(true);
      await api.post(
        `/finance/payroll-queue/${selected.month}/${selected.year}/save-draft`,
        buildPaymentPayload()
      );
      const res = await api.post(`/finance/payroll-period-payments/${activeDraftId}/submit`, {
        ...buildPaymentPayload(),
        financeControllerUser
      });
      setPaymentDialogOpen(false);
      setActiveDraftId(null);
      setSnackbar({
        open: true,
        severity: 'success',
        message: res.data?.message || 'Payroll payment submitted for GM Finance approval'
      });
      await Promise.all([loadQueue(), loadDetail(selected.month, selected.year)]);
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to submit payroll payment'
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleDeleteDraft = async () => {
    const draftId = activeDraftId || companyDraftPayment?._id;
    if (!draftId) return;
    if (!window.confirm('Delete this draft payroll payment and its BPV draft? This cannot be undone.')) return;

    try {
      setProcessingPayment(true);
      await api.delete(`/finance/payroll-period-payments/${draftId}`);
      setPaymentDialogOpen(false);
      setActiveDraftId(null);
      setSnackbar({
        open: true,
        severity: 'success',
        message: 'Draft payroll payment deleted'
      });
      if (selected) {
        await Promise.all([loadQueue(), loadDetail(selected.month, selected.year)]);
      }
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to delete draft payroll payment'
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  const companyOptions = useMemo(() => {
    if (!detail?.payrolls?.length) return [];
    return [...new Set(detail.payrolls.map((row) => row.employee?.company).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }, [detail]);

  const projectOptions = useMemo(() => {
    if (!detail?.payrolls?.length) return [];
    return [...new Set(detail.payrolls.map((row) => row.employee?.project).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }, [detail]);

  const filteredPayrolls = useMemo(() => {
    if (!detail?.payrolls?.length) return [];
    let rows = detail.payrolls;
    if (companyFilter) rows = rows.filter((row) => row.employee?.company === companyFilter);
    if (projectFilter) rows = rows.filter((row) => row.employee?.project === projectFilter);
    return rows;
  }, [detail, companyFilter, projectFilter]);

  const filteredSummary = useMemo(() => {
    const totalNetSalary = filteredPayrolls.reduce(
      (sum, row) => sum + Math.round(Number(row.netSalary) || 0),
      0
    );
    const totalGrossSalary = filteredPayrolls.reduce(
      (sum, row) => sum + Math.round(Number(row.grossSalary) || 0),
      0
    );
    return {
      employeeCount: filteredPayrolls.length,
      totalNetSalary,
      totalGrossSalary
    };
  }, [filteredPayrolls]);

  const companySummary = useMemo(
    () => buildPayrollCompanySummary(detail?.payrolls || []),
    [detail]
  );

  const employeeDetailTotals = useMemo(
    () => aggregatePayrollBreakdownFromRows(filteredPayrolls),
    [filteredPayrolls]
  );

  const netPayableColumnLabel = getNetPayableColumnLabel(detail?.periodLabel || selected?.periodLabel);

  const handleSelectPeriod = (row) => {
    setSearchParams({ month: String(row.month), year: String(row.year) });
  };

  const fetchCompanyProfile = async () => {
    const companyRes = await api.get('/finance/company-profile').catch(() => ({ data: { data: {} } }));
    return companyRes.data?.data || {};
  };

  const generateBankLetterBundle = useCallback(async (format) => {
    if (!selected?.month || !selected?.year || !companyFilter) {
      throw new Error('Select a company with an approved payment first.');
    }
    const res = await api.post(
      `/finance/payroll-queue/${selected.month}/${selected.year}/bank-letter/generate`,
      { companyName: companyFilter, format }
    );
    return res.data?.data || {};
  }, [selected, companyFilter]);

  const previewBankLetterFromPayment = useCallback(async (paymentApplicationId) => {
    const res = await api.get(`/finance/payroll-period-payments/${paymentApplicationId}/bank-letter/preview`);
    return res.data?.data || {};
  }, []);

  const handlePrintSummaryReport = async () => {
    if (!detail?.payrolls?.length) return;
    try {
      setProcessing(true);
      const company = await fetchCompanyProfile();
      const result = openPayrollCompanySummaryPrint({
        periodLabel: detail.periodLabel,
        company,
        summary: companySummary
      });
      if (result?.ok === false) {
        setSnackbar({ open: true, severity: 'warning', message: result.message });
      }
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to print summary report'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleExportSummaryReport = async () => {
    if (!detail?.payrolls?.length) return;
    try {
      setProcessing(true);
      const result = await downloadPayrollCompanySummaryExcel({
        periodLabel: detail.periodLabel,
        summary: companySummary
      });
      if (result?.ok === false) {
        setSnackbar({ open: true, severity: 'warning', message: result.message });
      }
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to export summary report'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handlePrintBankLetter = async () => {
    if (!selected || !canGenerateBankLetter) return;
    try {
      setProcessing(true);
      const { letter, company } = await generateBankLetterBundle('print');
      const result = openPayrollBankLetterPrint({ letter, company });
      if (result?.ok === false) {
        setSnackbar({ open: true, severity: 'warning', message: result.message });
      } else {
        await loadDetail(selected.month, selected.year);
      }
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to generate bank letter'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleExportBankLetter = async () => {
    if (!selected || !canGenerateBankLetter) return;
    try {
      setProcessing(true);
      const { letter, company } = await generateBankLetterBundle('excel');
      const result = await downloadPayrollBankLetterExcel({ letter, company });
      if (result?.ok === false) {
        setSnackbar({ open: true, severity: 'warning', message: result.message });
      } else {
        await loadDetail(selected.month, selected.year);
      }
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to export bank letter'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleReprintBankLetter = async (paymentApplicationId) => {
    if (!paymentApplicationId) return;
    try {
      setProcessing(true);
      const { letter, company } = await previewBankLetterFromPayment(paymentApplicationId);
      const result = openPayrollBankLetterPrint({ letter, company });
      if (result?.ok === false) {
        setSnackbar({ open: true, severity: 'warning', message: result.message });
      }
    } catch (err) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: err.response?.data?.message || 'Failed to reprint bank letter'
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleMainTabChange = (_e, value) => {
    setMainTab(value);
    const next = new URLSearchParams(searchParams);
    if (value === 1) next.set('tab', 'manual');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  const pg = useClientPagination(filteredPayrolls);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4">Payroll — Finance</Typography>
          <Typography variant="body2" color="text.secondary">
            Monthly payroll and CEO-approved Manual Salary payment processing.
          </Typography>
        </Box>
        {mainTab === 0 ? (
          <Button startIcon={<RefreshIcon />} onClick={loadQueue} disabled={loading}>
            Refresh
          </Button>
        ) : null}
      </Stack>

      <Tabs value={mainTab} onChange={handleMainTabChange} sx={{ mb: 2 }}>
        <Tab label="Monthly Payroll" />
        <Tab label="Manual Salary" />
      </Tabs>

      {mainTab === 1 ? (
        <ManualSalaryFinanceTab
          onSnackbar={(payload) => setSnackbar(payload)}
        />
      ) : (
      <>
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Paper sx={{ mb: 3 }}>
        {loading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Period</TableCell>
                  <TableCell align="right">Employees</TableCell>
                  <TableCell align="right">Total Net Salary</TableCell>
                  <TableCell>Comparison</TableCell>
                  <TableCell>Finance Status</TableCell>
                  <TableCell align="right">Pending</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {queue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">No GM HR-approved payroll periods in finance queue.</TableCell>
                  </TableRow>
                ) : queue.map((row) => (
                  <TableRow
                    key={`${row.month}-${row.year}`}
                    hover
                    selected={selected?.month === row.month && selected?.year === row.year}
                  >
                    <TableCell>{row.periodLabel}</TableCell>
                    <TableCell align="right">{row.employeeCount}</TableCell>
                    <TableCell align="right">{fmt(row.totalNetSalary)}</TableCell>
                    <TableCell><Chip size="small" label={row.comparisonStatus || '—'} /></TableCell>
                    <TableCell>{statusChip(row.financeStatus)}</TableCell>
                    <TableCell align="right">{row.pendingCount}</TableCell>
                    <TableCell align="right">{row.paidCount}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => handleSelectPeriod(row)}>Open</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {selected ? (
        <Paper sx={{ p: 2 }}>
          {detailLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>
          ) : detail ? (
            <>
              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6">{detail.periodLabel}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {filteredSummary.employeeCount} employees
                    {companyFilter || projectFilter ? ` in ${[companyFilter, projectFilter].filter(Boolean).join(' / ')}` : ''}
                    {' · '}Net {fmt(filteredSummary.totalNetSalary)}
                    {' · '}Gross {fmt(filteredSummary.totalGrossSalary)}
                    {companyFilter || projectFilter ? ` (filtered from ${detail.summary.employeeCount})` : ''}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    variant="outlined"
                    startIcon={<AssessmentIcon />}
                    onClick={() => setSummaryOpen(true)}
                    disabled={!detail?.payrolls?.length}
                  >
                    Summary Report
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<VisibilityIcon />}
                    onClick={() => setComparisonOpen(true)}
                    disabled={!detail?.comparisonReport}
                  >
                    Comparison Report
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    onClick={handleExportBankLetter}
                    disabled={processing || !canGenerateBankLetter}
                  >
                    Export Excel
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<PrintIcon />}
                    onClick={handlePrintBankLetter}
                    disabled={processing || !canGenerateBankLetter}
                  >
                    Print Bank Letter
                  </Button>
                  <Button
                    variant="contained"
                    color={companyHasDraftPayment ? 'warning' : 'success'}
                    startIcon={<PaymentsIcon />}
                    onClick={() => openPaymentDialog(companyHasDraftPayment ? companyDraftPayment : null)}
                    disabled={
                      processing
                      || !companyFilter
                      || companyPendingPayrolls.length === 0
                      || companyHasPendingPayment
                    }
                  >
                    {companyHasDraftPayment ? 'Open Draft BPV' : 'Make Payment'}
                  </Button>
                </Stack>
              </Stack>

              {!companyFilter ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Select a company to prepare a draft BPV, submit for GM Finance approval, or generate a bank letter after approval.
                </Alert>
              ) : null}

              {companyFilter && companyHasDraftPayment ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {companyFilter} has a draft BPV for {fmt(companyDraftPayment.amount)}.
                  {' '}Review it before submitting to GM Finance.
                  {companyDraftPayment.journalEntryId?._id ? (
                    <>
                      {' '}
                      <Button
                        component={RouterLink}
                        to={`/finance/vouchers/${companyDraftPayment.journalEntryId._id}`}
                        size="small"
                      >
                        View draft BPV
                      </Button>
                      {' '}
                      <Button size="small" onClick={() => openPaymentDialog(companyDraftPayment)}>
                        Open draft
                      </Button>
                      {' '}
                      <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={handleDeleteDraft}>
                        Delete draft
                      </Button>
                    </>
                  ) : null}
                </Alert>
              ) : null}

              {companyFilter && !canGenerateBankLetter ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Bank letter for {companyFilter} will be available after the company payment is fully approved on the BPV.
                </Alert>
              ) : null}

              {companyFilter && approvedCompanyPayment ? (
                <Alert severity="success" sx={{ mb: 2 }}>
                  Approved payment for {companyFilter}: {fmt(approvedCompanyPayment.amount)}
                  {' · '}Cheque/Ref: {approvedCompanyPayment.paymentMeta?.reference || '—'}
                  {approvedCompanyPayment.journalEntryId?.entryNumber ? (
                    <>
                      {' · '}BPV: {approvedCompanyPayment.journalEntryId.entryNumber}
                      {approvedCompanyPayment.journalEntryId?._id ? (
                        <>
                          {' '}
                          <Button
                            component={RouterLink}
                            to={`/finance/vouchers/${approvedCompanyPayment.journalEntryId._id}`}
                            size="small"
                          >
                            View voucher
                          </Button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </Alert>
              ) : null}

              {selectedCompanyPaymentMeta?.pendingPayment ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {companyFilter} payment of {fmt(selectedCompanyPaymentMeta.pendingPayment.amount)} is pending GM Finance approval on the BPV.
                  {selectedCompanyPaymentMeta.pendingPayment.journalEntryId?._id ? (
                    <>
                      {' '}Open the{' '}
                      <Button
                        component={RouterLink}
                        to={`/finance/vouchers/${selectedCompanyPaymentMeta.pendingPayment.journalEntryId._id}`}
                        size="small"
                      >
                        payment voucher
                      </Button>
                      {' '}for approval.
                    </>
                  ) : null}
                </Alert>
              ) : null}

              {selectedCompanyPaymentMeta?.latestRejection?.rejectionObservation ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Last payment for {companyFilter} was rejected: {selectedCompanyPaymentMeta.latestRejection.rejectionObservation}
                  {' '}Correct and submit a new payment when ready.
                </Alert>
              ) : null}

              {!companyFilter && (detail.pendingPayments || []).length ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {(detail.pendingPayments || []).length} company payment(s) pending GM Finance approval.
                </Alert>
              ) : null}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
                  <InputLabel>Company</InputLabel>
                  <Select
                    value={companyFilter}
                    label="Company"
                    onChange={(e) => setCompanyFilter(e.target.value)}
                  >
                    <MenuItem value="">All Companies</MenuItem>
                    {companyOptions.map((company) => (
                      <MenuItem key={company} value={company}>
                        {company}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
                  <InputLabel>Project</InputLabel>
                  <Select
                    value={projectFilter}
                    label="Project"
                    onChange={(e) => setProjectFilter(e.target.value)}
                  >
                    <MenuItem value="">All Projects</MenuItem>
                    {projectOptions.map((project) => (
                      <MenuItem key={project} value={project}>
                        {project}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {companyFilter || projectFilter ? (
                  <Button size="small" onClick={() => { setCompanyFilter(''); setProjectFilter(''); }} sx={{ alignSelf: { sm: 'center' } }}>
                    Clear filters
                  </Button>
                ) : null}
              </Stack>

              {(detail.bankLetters || []).length ? (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                    <DescriptionIcon fontSize="small" color="action" />
                    <Typography variant="subtitle1">Generated Bank Letters</Typography>
                    {companyFilter ? (
                      <Chip size="small" label={companyFilter} />
                    ) : (
                      <Chip size="small" label={`${(detail.bankLetters || []).length} total`} />
                    )}
                  </Stack>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Generated</TableCell>
                          <TableCell>Company</TableCell>
                          <TableCell>BPV</TableCell>
                          <TableCell>Cheque / Ref</TableCell>
                          <TableCell>Company A/C</TableCell>
                          <TableCell align="right">Employees</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell>Format</TableCell>
                          <TableCell>By</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {companyBankLetters.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={10} align="center">
                              No bank letters for the selected company.
                            </TableCell>
                          </TableRow>
                        ) : companyBankLetters.map((row) => (
                          <TableRow key={row._id}>
                            <TableCell>{fmtDateTime(row.generatedAt)}</TableCell>
                            <TableCell>{row.companyName}</TableCell>
                            <TableCell>
                              {row.voucherNumber || row.journalEntryId?.entryNumber || '—'}
                            </TableCell>
                            <TableCell>{row.chequeNumber || '—'}</TableCell>
                            <TableCell>{row.companyAccountNumber || '—'}</TableCell>
                            <TableCell align="right">{row.employeeCount}</TableCell>
                            <TableCell align="right">{fmt(row.totalNetSalary)}</TableCell>
                            <TableCell>
                              <Chip size="small" label={row.format === 'excel' ? 'Excel' : 'Print'} />
                            </TableCell>
                            <TableCell>{userDisplayName(row.generatedBy)}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                <Button
                                  size="small"
                                  startIcon={<PrintIcon />}
                                  onClick={() => handleReprintBankLetter(row.paymentApplicationId?._id || row.paymentApplicationId)}
                                  disabled={processing}
                                >
                                  Reprint
                                </Button>
                                {row.journalEntryId?._id ? (
                                  <Button
                                    component={RouterLink}
                                    to={`/finance/vouchers/${row.journalEntryId._id}`}
                                    size="small"
                                  >
                                    Voucher
                                  </Button>
                                ) : null}
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              ) : null}

              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Employee Salary Detail
                {companyFilter || projectFilter ? ` — ${[companyFilter, projectFilter].filter(Boolean).join(' / ')}` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Full salary breakdown per employee (same columns as Company-Wise Summary Report).
                Scroll horizontally to view all earnings and deductions.
              </Typography>
              <TableContainer sx={{ maxHeight: 560, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader sx={{ minWidth: 2200 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ minWidth: 44 }}>Sr</TableCell>
                      <TableCell sx={{ minWidth: 88 }}>Employee ID</TableCell>
                      <TableCell sx={{ minWidth: 140 }}>Name</TableCell>
                      <TableCell sx={{ minWidth: 160 }}>Company</TableCell>
                      <TableCell sx={{ minWidth: 130 }}>CNIC</TableCell>
                      <TableCell sx={{ minWidth: 72 }}>Branch</TableCell>
                      <TableCell sx={{ minWidth: 130 }}>Account No</TableCell>
                      {PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => (
                        <TableCell key={col.key} align="right" sx={{ whiteSpace: 'nowrap', minWidth: 110 }}>
                          {col.label}
                        </TableCell>
                      ))}
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap', minWidth: 120 }}>
                        {netPayableColumnLabel}
                      </TableCell>
                      <TableCell sx={{ minWidth: 120 }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredPayrolls.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={PROJECT_SUMMARY_AMOUNT_COLUMNS.length + 9} align="center">
                          No employees match the selected company filter.
                        </TableCell>
                      </TableRow>
                    ) : pg.rows.map((row, index) => (
                      <TableRow key={row._id} hover>
                        <TableCell>{pg.offset + index + 1}</TableCell>
                        <TableCell>{row.employee?.employeeId || '—'}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {row.employee?.name || '—'}
                            {row.isCashSalary && (
                              <Chip label="Cash" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>{row.employee?.company || '—'}</TableCell>
                        <TableCell>{row.employee?.idCard || '—'}</TableCell>
                        <TableCell>{row.employee?.branchCode || '—'}</TableCell>
                        <TableCell>{row.employee?.accountNumber || '—'}</TableCell>
                        {PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => (
                          <TableCell key={col.key} align="right">
                            {fmt(getPayrollColumnAmount(row, col.key))}
                          </TableCell>
                        ))}
                        <TableCell align="right">{fmt(row.netPayable ?? row.netSalary)}</TableCell>
                        <TableCell>{payrollEmployeeStatusChip(row.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={7} align="right" sx={grandTotalRowSx}>
                        <strong>
                          {companyFilter || projectFilter ? `Total — ${[companyFilter, projectFilter].filter(Boolean).join(' / ')}` : 'Grand Total'}
                        </strong>
                        {' '}
                        ({filteredSummary.employeeCount} employees)
                      </TableCell>
                      {PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => (
                        <TableCell key={col.key} align="right" sx={grandTotalRowSx}>
                          <strong>{fmt(employeeDetailTotals[col.key])}</strong>
                        </TableCell>
                      ))}
                      <TableCell align="right" sx={grandTotalRowSx}>
                        <strong>{fmt(employeeDetailTotals.netPayable)}</strong>
                      </TableCell>
                      <TableCell sx={grandTotalRowSx} />
                    </TableRow>
                  </TableFooter>
                </Table>{pg.bar}
              </TableContainer>
            </>
          ) : null}
        </Paper>
      ) : null}

      <Dialog
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        maxWidth={false}
        fullWidth
        PaperProps={{ sx: { width: 'min(96vw, 1400px)', maxWidth: '96vw' } }}
      >
        <DialogTitle>
          Company-Wise Summary of Salary — {detail?.periodLabel || selected?.periodLabel}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Company-wise salary breakdown for the full payroll period, with grand total for all companies.
          </Typography>
          <TableContainer sx={{ maxHeight: 520 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Sr No</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>Company Name</TableCell>
                  <TableCell align="right">No of Employees</TableCell>
                  {PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => (
                    <TableCell key={col.key} align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {col.label}
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {netPayableColumnLabel}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {companySummary.rows.map((row, index) => (
                  <TableRow
                    key={row.company}
                    selected={companyFilter === row.company}
                    hover
                  >
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{row.company}</TableCell>
                    <TableCell align="right">{row.employeeCount}</TableCell>
                    {PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => (
                      <TableCell key={col.key} align="right">
                        {fmt(row[col.key])}
                      </TableCell>
                    ))}
                    <TableCell align="right">{fmt(row.netPayable)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} align="right" sx={grandTotalRowSx}>
                    <strong>Grand Total (All Companies)</strong>
                  </TableCell>
                  <TableCell align="right" sx={grandTotalRowSx}>
                    <strong>{companySummary.totals.employeeCount}</strong>
                  </TableCell>
                  {PROJECT_SUMMARY_AMOUNT_COLUMNS.map((col) => (
                    <TableCell key={col.key} align="right" sx={grandTotalRowSx}>
                      <strong>{fmt(companySummary.totals[col.key])}</strong>
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={grandTotalRowSx}>
                    <strong>{fmt(companySummary.totals.netPayable)}</strong>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSummaryOpen(false)}>Close</Button>
          <Button
            startIcon={<DownloadIcon />}
            onClick={handleExportSummaryReport}
            disabled={processing}
          >
            Export Excel
          </Button>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            onClick={handlePrintSummaryReport}
            disabled={processing}
          >
            Print
          </Button>
        </DialogActions>
      </Dialog>

      <PayrollMonthlyComparisonDialog
        open={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
        report={detail?.comparisonReport}
        generatedAt={detail?.comparisonMeta?.generatedAt}
        reportStatus={detail?.comparisonMeta?.status || 'Approved by GM HR'}
        month={selected?.month}
        year={selected?.year}
        periodLabel={selected?.periodLabel}
        draftCount={0}
        approvalDoc={detail?.approval}
        approvalLoading={false}
        onRefreshApproval={() => selected && loadDetail(selected.month, selected.year)}
      />

      <Dialog
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {activeDraftId ? 'Draft Payroll Payment' : 'New Payroll Payment'} — {companyFilter || 'Company'}
          <Typography variant="body2" color="text.secondary">
            Step 1: Save draft BPV · Step 2: Submit for GM Finance approval
            {' · '}Gross: {fmt(paymentData.grossAmount || 0)} · Net bank: {fmt(paymentData.amount || 0)}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Company payment</Typography>
                <Typography fontWeight={700}>{companyFilter}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {detail?.periodLabel || selected?.periodLabel}
                  {' · '}{companyPendingPayrolls.length} employees pending payment
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Finance approval authorities
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  Sr Manager Accounts: <strong>{SR_MANAGER_ACCOUNTS_NAME}</strong> — auto-approved when you submit the draft.
                  {' '}GM Finance approves on the BPV voucher after submission.
                </Typography>
                <Autocomplete
                  disabled={processingPayment}
                  options={financeAuthorityCandidates}
                  value={paymentFinAuth.financeControllerUser || null}
                  onChange={(_, value) => setPaymentFinAuth({ financeControllerUser: value })}
                  getOptionLabel={userOptionLabel}
                  isOptionEqualToValue={(a, b) => String(a?._id || a?.id) === String(b?._id || b?.id)}
                  renderOption={(props, option) => (
                    <li {...props} key={option._id || option.id}>
                      <Typography variant="body2">{userOptionLabel(option)}</Typography>
                      {userOptionSecondary(option) ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {userOptionSecondary(option)}
                        </Typography>
                      ) : null}
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} label="GM Finance *" size="small" required />
                  )}
                />
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Payment details</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Gross Salary (BPV debit)"
                type="number"
                value={paymentData.grossAmount}
                InputProps={{ readOnly: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Net Bank Payment (PKR)"
                type="number"
                value={paymentData.amount}
                InputProps={{ readOnly: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Paying Company</InputLabel>
                <Select
                  value={payingCompanyId}
                  label="Paying Company"
                  onChange={(e) => setPayingCompanyId(e.target.value)}
                >
                  <MenuItem value=""><em>-- Target Company ({companyFilter || 'Same'}) --</em></MenuItem>
                  {financeCompanies.map((c) => (
                    <MenuItem key={c._id} value={c._id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={paymentData.paymentMethod}
                  label="Payment Method"
                  onChange={(e) => setPaymentData((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                >
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="check">Check / Cheque</MenuItem>
                  <MenuItem value="cash">Cash</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Pay From Account</InputLabel>
                <Select
                  value={paymentData.bankAccountId || ''}
                  label="Pay From Account"
                  onChange={(e) => setPaymentData((prev) => ({ ...prev, bankAccountId: e.target.value }))}
                >
                  <MenuItem value="">— Auto (default bank) —</MenuItem>
                  {bankAccounts.map((item) => {
                    const account = item?.account || item;
                    const depth = item?.depth || 0;
                    return (
                      <MenuItem key={account._id} value={account._id}>
                        {formatPayFromAccountLabel(account, depth)}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Payment Date"
                type="date"
                value={paymentData.paymentDate}
                onChange={(e) => setPaymentData((prev) => ({ ...prev, paymentDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Reference / Cheque # / TT #"
                value={paymentData.reference}
                onChange={(e) => setPaymentData((prev) => ({ ...prev, reference: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Narration"
                value={paymentData.narration}
                onChange={(e) => setPaymentData((prev) => ({ ...prev, narration: e.target.value }))}
                placeholder="Shown on every line of the BPV voucher"
                multiline
                minRows={2}
                inputProps={{ maxLength: 200 }}
                helperText="Optional. When filled, this replaces the line narrations below on the printed BPV."
              />
            </Grid>
            {bpvPreview?.totals ? (
              <Grid item xs={12}>
                <PayrollBpvDeductionSummary
                  compact
                  breakdown={bpvPreview.totals}
                  periodLabel={bpvPreview.periodLabel || detail?.periodLabel || ''}
                  companyName={bpvPreview.companyName || companyFilter}
                  employeeCount={companyPendingPayrolls.length}
                />
              </Grid>
            ) : null}
            {bpvPreview?.lines?.length ? (
              <Grid item xs={12}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="subtitle2">Accounting entries preview</Typography>
                    <Chip
                      size="small"
                      color={bpvPreview.balanced ? 'success' : 'error'}
                      label={bpvPreview.balanced ? 'Balanced' : 'Not balanced'}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Each deduction (EOBI employee/employer sub-accounts, loans, staff advance, tax, PF) and bank net payment post on this BPV.
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Side</TableCell>
                          <TableCell>Account / Description</TableCell>
                          <TableCell align="right">Amount (PKR)</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {bpvPreview.lines.map((line) => (
                          <TableRow key={`${line.side}-${line.label}`}>
                            <TableCell>
                              <Chip
                                size="small"
                                variant="outlined"
                                color={line.side === 'Debit' ? 'primary' : 'secondary'}
                                label={line.side}
                              />
                            </TableCell>
                            <TableCell>{line.label}</TableCell>
                            <TableCell align="right">{fmt(line.amount)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell colSpan={2} align="right" sx={{ fontWeight: 700 }}>
                            Total Debits / Credits
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {fmt(bpvPreview.totalDebit)} / {fmt(bpvPreview.totalCredit)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>
            ) : null}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {activeDraftId ? (
              <Button
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleDeleteDraft}
                disabled={processingPayment}
              >
                Delete Draft
              </Button>
            ) : null}
            {activeDraftId ? (
              <Button
                color="info"
                startIcon={<PrintIcon />}
                onClick={() => handleReprintBankLetter(activeDraftId)}
                disabled={processingPayment}
              >
                Preview Bank Letter
              </Button>
            ) : null}
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button
              variant="outlined"
              onClick={handleSaveDraft}
              disabled={processingPayment}
            >
              {processingPayment ? 'Saving…' : activeDraftId ? 'Update Draft' : 'Save Draft BPV'}
            </Button>
            <Button
              variant="contained"
              color="success"
              onClick={handleMakePayment}
              disabled={
                processingPayment
                || !activeDraftId
              }
            >
              {processingPayment ? 'Processing…' : 'Create BPV & Submit'}
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
      </>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        message={snackbar.message}
      />
    </Box>
  );
}
