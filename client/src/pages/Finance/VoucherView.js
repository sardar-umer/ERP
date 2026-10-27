import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Button,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Alert
} from '@mui/material';
import { ArrowBack as BackIcon, Print as PrintIcon, Edit as EditIcon } from '@mui/icons-material';
import api from '../../services/api';
import { formatPKR } from '../../utils/currency';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import { useAuth } from '../../contexts/AuthContext';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';

const formatDateForPrint = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const VOUCHER_SERIES_TITLES = {
  BPV: 'Bank Payment Voucher',
  CPV: 'Cash Payment Voucher',
  JV: 'Journal Voucher',
  GRN: 'Goods Receipt Voucher',
  SIN: 'Store Issue Voucher'
};

const resolveCompanyName = (entry, linkedDocs, companies) => {
  const populated = entry?.companyId;
  if (populated && typeof populated === 'object' && populated.name) {
    return populated.name;
  }

  const companyId = populated?._id || entry?.companyId;
  if (companyId && Array.isArray(companies)) {
    const match = companies.find((row) => String(row._id) === String(companyId));
    if (match?.name) return match.name;
  }

  const { payrollPeriodPaymentApp, manualSalaryPaymentApp, apPaymentApp, vendorAdvanceDoc } = linkedDocs;
  if (payrollPeriodPaymentApp?.companyName) return payrollPeriodPaymentApp.companyName;
  if (manualSalaryPaymentApp?.companyName) return manualSalaryPaymentApp.companyName;
  if (apPaymentApp?.companyName) return apPaymentApp.companyName;
  const payingCo = vendorAdvanceDoc?.payingCompany || vendorAdvanceDoc?.payingCompanyId;
  const owningCo = vendorAdvanceDoc?.company || vendorAdvanceDoc?.companyId;
  if (payingCo?.name && entry?._id
    && String(vendorAdvanceDoc.payingJournalEntryId?._id || vendorAdvanceDoc.payingJournalEntryId) === String(entry._id)) {
    return payingCo.name;
  }
  if (owningCo?.name) return owningCo.name;

  return '—';
};

const personName = (p) => {
  if (!p || typeof p !== 'object') return '';
  return p.name || [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.payeeName || '';
};
const accountText = (a) => (a && typeof a === 'object'
  ? `${a.name || ''}${a.accountNumber ? ` (${a.accountNumber})` : ''}`.trim()
  : '');
const METHOD_TEXT = {
  cash: 'Cash', check: 'Cheque', cheque: 'Cheque', bank_transfer: 'Bank transfer', bank: 'Bank transfer',
  credit_card: 'Credit card', ach: 'ACH', other: 'Other'
};
const methodText = (m) => METHOD_TEXT[m] || (m ? String(m).replace(/_/g, ' ') : '');

/**
 * Key facts for the voucher header: who was paid (vendor / employee), cost center, project, department, bank,
 * method / cheque, documents it settles, amount, status and preparer — from the voucher and its linked document.
 */
const resolveVoucherHeaderDetails = (entry, { apPaymentApp, vendorAdvanceDoc, cashApproval, linkedPo, payrollPeriodPaymentApp, manualSalaryPaymentApp }) => {
  if (!entry) return [];
  const lines = entry.lines || [];

  // Payee
  let payee = '';
  let payeeType = '';
  const appBills = (apPaymentApp?.bills || []).map((b) => b.billId).filter((b) => b && typeof b === 'object');
  const appBill = appBills[0] || (typeof apPaymentApp?.accountsPayableId === 'object' ? apPaymentApp.accountsPayableId : null);
  if (vendorAdvanceDoc?.vendor?.name) { payee = vendorAdvanceDoc.vendor.name; payeeType = 'Vendor'; }
  else if (appBill?.vendor?.name) { payee = appBill.vendor.name; payeeType = 'Vendor'; }
  else if (cashApproval && (cashApproval.advanceToName || cashApproval.vendor)) {
    payee = cashApproval.advanceToName || personName(cashApproval.vendor);
    payeeType = cashApproval.advanceToName ? 'Employee' : 'Vendor';
  } else if (payrollPeriodPaymentApp || manualSalaryPaymentApp) {
    const n = payrollPeriodPaymentApp?.employeeCount ?? manualSalaryPaymentApp?.employeeCount;
    payee = n != null ? `Payroll — ${n} employees` : 'Payroll';
    payeeType = 'Employees';
  }
  if (!payee) {
    const partyLine = lines.find((l) => l.party && personName(l.party));
    if (partyLine) { payee = personName(partyLine.party); payeeType = partyLine.partyType || ''; }
  }

  // Cost center / project / department
  const lineCostCenters = [...new Set(lines.map((l) => personName(l.costCenter) || '').filter(Boolean))];
  const costCenter = entry.costCenter?.name
    ? `${entry.costCenter.name}${entry.costCenter.code ? ` (${entry.costCenter.code})` : ''}`
    : (lineCostCenters.join(', ') || personName(vendorAdvanceDoc?.costCenter));
  const project = entry.project?.name || entry.customProject || '';
  const department = (entry.department && typeof entry.department === 'object' ? entry.department.name : entry.department)
    || cashApproval?.requestingDepartment || '';

  // Bank / cash paid from: the linked document's bank, else the asset account credited
  const bankFromDoc = accountText(vendorAdvanceDoc?.bankAccountId) || accountText(apPaymentApp?.paymentMeta?.bankAccountId)
    || accountText(cashApproval?.advanceBankAccount);
  const creditedAssets = lines
    .filter((l) => Number(l.credit) > 0 && String(l.account?.type || '').toLowerCase() === 'asset')
    .map((l) => accountText(l.account));
  const paidFrom = bankFromDoc || [...new Set(creditedAssets)].join(', ');

  const method = methodText(apPaymentApp?.paymentMeta?.paymentMethod || vendorAdvanceDoc?.paymentMethod || cashApproval?.advancePaymentMethod);
  const reference = [
    apPaymentApp?.paymentMeta?.reference,
    vendorAdvanceDoc?.chequeNumber && `Cheque ${vendorAdvanceDoc.chequeNumber}`,
    vendorAdvanceDoc?.reference,
    cashApproval?.signedCheckNumber && `Cheque ${cashApproval.signedCheckNumber}`
  ].filter(Boolean).join(' · ');

  // Documents this voucher is against
  const against = [
    ...appBills.map((b) => `Bill ${b.billNumber}`),
    ...(appBills.length === 0 && appBill?.billNumber ? [`Bill ${appBill.billNumber}`] : []),
    ...(linkedPo?.orderNumber ? [`PO ${linkedPo.orderNumber}`] : []),
    ...(cashApproval?.caNumber ? [`CA ${cashApproval.caNumber}`] : [])
  ];

  const workflow = apPaymentApp?.workflowStatus || vendorAdvanceDoc?.voucherWorkflowStatus;
  const WORKFLOW_TEXT = { pending_authority: 'awaiting finance authorities', fully_approved: 'all authorities approved', rejected: 'rejected' };
  const status = [String(entry.status || '').replace(/^\w/, (c) => c.toUpperCase()), WORKFLOW_TEXT[workflow]].filter(Boolean).join(' — ');

  return [
    { label: payeeType ? `Payee (${payeeType})` : 'Payee', value: payee || '—' },
    { label: 'Cost Center', value: costCenter || '—' },
    ...(project ? [{ label: 'Project', value: project }] : []),
    ...(department ? [{ label: 'Department', value: department }] : []),
    ...(paidFrom ? [{ label: 'Paid From', value: paidFrom }] : []),
    ...(method || reference ? [{ label: 'Method / Ref.', value: [method, reference].filter(Boolean).join(' · ') }] : []),
    ...(against.length ? [{ label: 'Against', value: against.join(', ') }] : []),
    { label: 'Amount', value: formatPKR(entry.totalDebits || 0) },
    { label: 'Status', value: status || '—' },
    { label: 'Prepared By', value: personName(entry.createdBy) || (entry.isAutoGenerated ? 'System' : '—') },
    ...(entry.description ? [{ label: 'Narration', value: entry.description, wide: true }] : [])
  ];
};

const resolveVoucherTitle = (entry) => {
  const series = String(entry?.voucherSeries || '').trim().toUpperCase();
  if (series && VOUCHER_SERIES_TITLES[series]) return VOUCHER_SERIES_TITLES[series];
  if (series === 'BPV' || entry?.module === 'payroll') return VOUCHER_SERIES_TITLES.BPV;
  return 'Journal Voucher';
};

const VoucherView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { companies } = useFinanceCompany();
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState(null);
  const [cashApproval, setCashApproval] = useState(null);
  const [vendorAdvanceDoc, setVendorAdvanceDoc] = useState(null);
  const [apPaymentApp, setApPaymentApp] = useState(null);
  const [payrollPeriodPaymentApp, setPayrollPeriodPaymentApp] = useState(null);
  const [manualSalaryPaymentApp, setManualSalaryPaymentApp] = useState(null);
  const [approvalMsg, setApprovalMsg] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setLoadError('');
        const res = await api.get(`/finance/journal-entries/${id}`);
        setEntry(res?.data?.data || null);
        if (!res?.data?.data) {
          setLoadError('Voucher not found.');
        }
      } catch (err) {
        setEntry(null);
        setLoadError(err.response?.data?.message || 'Could not load voucher.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  useEffect(() => {
    const loadCashApproval = async () => {
      try {
        if (!entry?.referenceId) {
          setCashApproval(null);
          return;
        }
        const res = await api.get(`/cash-approvals/${entry.referenceId}`);
        setCashApproval(res?.data?.data || null);
      } catch (_e) {
        setCashApproval(null);
      }
    };
    loadCashApproval();
  }, [entry?.referenceId]);

  useEffect(() => {
    const loadLinkedDocs = async () => {
      if (!entry?._id) {
        setVendorAdvanceDoc(null);
        setApPaymentApp(null);
        setPayrollPeriodPaymentApp(null);
        setManualSalaryPaymentApp(null);
        return;
      }
      try {
        const apRes = await api.get(`/finance/ap-payment-applications/by-journal-entry/${entry._id}`);
        setApPaymentApp(apRes?.data?.data || null);
      } catch (_e) {
        setApPaymentApp(null);
      }
      try {
        const payrollRes = await api.get(`/finance/payroll-period-payments/by-journal-entry/${entry._id}`);
        setPayrollPeriodPaymentApp(payrollRes?.data?.data || null);
      } catch (_e) {
        setPayrollPeriodPaymentApp(null);
      }
      try {
        const msalRes = await api.get(`/finance/manual-salary-payments/by-journal-entry/${entry._id}`);
        setManualSalaryPaymentApp(msalRes?.data?.data || null);
      } catch (_e) {
        setManualSalaryPaymentApp(null);
      }
      try {
        const res = await api.get(`/finance/vendor-advances/by-journal-entry/${entry._id}`);
        setVendorAdvanceDoc(res?.data?.data || null);
      } catch (_e) {
        setVendorAdvanceDoc(null);
      }
    };
    loadLinkedDocs();
  }, [entry?._id]);

  const [linkedPo, setLinkedPo] = useState(null);

  useEffect(() => {
    const loadLinkedPo = async () => {
      let poId = null;
      if (entry?.purchaseOrder || entry?.purchaseOrderId) {
        poId = entry.purchaseOrder?._id || entry.purchaseOrder || entry.purchaseOrderId;
      } else if (entry?.referenceModel === 'PurchaseOrder' && entry?.referenceId) {
        poId = entry.referenceId;
      } else if (vendorAdvanceDoc?.referenceType === 'purchase_order' && vendorAdvanceDoc?.referenceId) {
        poId = vendorAdvanceDoc.referenceId;
      } else if (apPaymentApp?.referenceType === 'purchase_order' && apPaymentApp?.referenceId) {
        poId = apPaymentApp.referenceId;
      }

      if (!poId) {
        setLinkedPo(null);
        return;
      }

      try {
        const res = await api.get(`/procurement/purchase-orders/${poId}`);
        setLinkedPo(res?.data?.data || null);
      } catch (_) {
        setLinkedPo(null);
      }
    };
    loadLinkedPo();
  }, [entry, vendorAdvanceDoc, apPaymentApp]);

  const reloadEntry = async () => {
    try {
      const res = await api.get(`/finance/journal-entries/${id}`);
      setEntry(res?.data?.data || null);
    } catch {
      /* ignore */
    }
  };

  const refreshApPaymentApp = async () => {
    try {
      const res = await api.get(`/finance/ap-payment-applications/by-journal-entry/${id}`);
      setApPaymentApp(res?.data?.data || apPaymentApp);
    } catch {
      /* ignore */
    }
  };

  const refreshPayrollPeriodPaymentApp = async () => {
    try {
      const res = await api.get(`/finance/payroll-period-payments/by-journal-entry/${id}`);
      setPayrollPeriodPaymentApp(res?.data?.data || payrollPeriodPaymentApp);
    } catch {
      /* ignore */
    }
  };

  const refreshManualSalaryPaymentApp = async () => {
    try {
      const res = await api.get(`/finance/manual-salary-payments/by-journal-entry/${id}`);
      setManualSalaryPaymentApp(res?.data?.data || manualSalaryPaymentApp);
    } catch {
      /* ignore */
    }
  };

  const approveMyAuthorityFromVoucher = async () => {
    try {
      setApprovalMsg('');
      if (apPaymentApp?._id) {
        await api.put(`/finance/ap-payment-applications/${apPaymentApp._id}/finance-approve`, {
          comments: 'Approved from Voucher page'
        });
        await refreshApPaymentApp();
        await reloadEntry();
        setApprovalMsg('Authority approval recorded. Bill is marked paid when all three authorities have approved.');
        return;
      }
      if (payrollPeriodPaymentApp?._id) {
        await api.put(`/finance/payroll-period-payments/${payrollPeriodPaymentApp._id}/finance-approve`, {
          comments: 'Approved from Voucher page'
        });
        await refreshPayrollPeriodPaymentApp();
        await reloadEntry();
        setApprovalMsg('Authority approval recorded. Payroll records are marked paid when GM Finance approves on the BPV.');
        return;
      }
      if (manualSalaryPaymentApp?._id) {
        await api.put(`/finance/manual-salary-payments/${manualSalaryPaymentApp._id}/finance-approve`, {
          comments: 'Approved from Voucher page'
        });
        await refreshManualSalaryPaymentApp();
        await reloadEntry();
        setApprovalMsg('Authority approval recorded. Manual salary is marked Paid when GM Finance approves on the BPV.');
        return;
      }
      if (cashApproval?._id) {
        await api.put(`/cash-approvals/${cashApproval._id}/finance-approve`, { comments: 'Approved from Voucher page' });
        const refreshed = await api.get(`/cash-approvals/${cashApproval._id}`);
        setCashApproval(refreshed?.data?.data || cashApproval);
        setApprovalMsg('Authority approval recorded from voucher and synced to Cash Approval.');
        return;
      }
      if (vendorAdvanceDoc?._id) {
        await api.put(`/finance/vendor-advances/${vendorAdvanceDoc._id}/finance-approve`, { comments: 'Approved from Voucher page' });
        const refreshed = await api.get(`/finance/vendor-advances/by-journal-entry/${id}`);
        setVendorAdvanceDoc(refreshed?.data?.data || vendorAdvanceDoc);
        await reloadEntry();
        setApprovalMsg('Authority approval recorded. Voucher posts to the ledger when all three have approved.');
        return;
      }
      if (entry?.referenceType === 'manual' && entry?.financeApprovalAuthorities?.financeControllerUser) {
        await api.put(`/finance/journal-entries/${entry._id}/finance-approve`, {
          comments: 'Approved from Voucher page'
        });
        await reloadEntry();
        setApprovalMsg('Authority approval recorded. Voucher posts when all authorities have approved.');
        return;
      }
    } catch (e) {
      setApprovalMsg(e?.response?.data?.message || 'Approval failed.');
    }
  };

  const rejectMyAuthorityFromVoucher = async () => {
    const observation = window.prompt('Enter rejection observation for the preparer:');
    if (!observation || !String(observation).trim()) {
      setApprovalMsg('Rejection cancelled — observation is required.');
      return;
    }
    const comments = String(observation).trim();
    try {
      setApprovalMsg('');
      if (apPaymentApp?._id) {
        await api.put(`/finance/ap-payment-applications/${apPaymentApp._id}/finance-reject`, { comments });
        await refreshApPaymentApp();
        await reloadEntry();
        setApprovalMsg('Settlement rejected. Draft voucher cancelled; bill remains unpaid.');
        return;
      }
      if (payrollPeriodPaymentApp?._id) {
        await api.put(`/finance/payroll-period-payments/${payrollPeriodPaymentApp._id}/finance-reject`, { comments });
        await refreshPayrollPeriodPaymentApp();
        await reloadEntry();
        setApprovalMsg('Payroll payment rejected with observation. BPV cancelled; Sr Manager Accounts can correct and resubmit.');
        return;
      }
      if (manualSalaryPaymentApp?._id) {
        await api.put(`/finance/manual-salary-payments/${manualSalaryPaymentApp._id}/finance-reject`, { comments });
        await refreshManualSalaryPaymentApp();
        await reloadEntry();
        setApprovalMsg('Manual salary payment rejected. BPV cancelled; sheets returned to Pending Finance.');
        return;
      }
      if (cashApproval?._id) {
        await api.put(`/cash-approvals/${cashApproval._id}/finance-reject`, { comments });
        const refreshed = await api.get(`/cash-approvals/${cashApproval._id}`);
        setCashApproval(refreshed?.data?.data || cashApproval);
        setApprovalMsg('Authority rejection recorded from voucher and synced to Cash Approval.');
        return;
      }
      if (vendorAdvanceDoc?._id) {
        await api.put(`/finance/vendor-advances/${vendorAdvanceDoc._id}/finance-reject`, { comments: 'Rejected from Voucher page' });
        const refreshed = await api.get(`/finance/vendor-advances/by-journal-entry/${id}`);
        setVendorAdvanceDoc(refreshed?.data?.data || vendorAdvanceDoc);
        await reloadEntry();
        setApprovalMsg('Authority rejection recorded. Draft voucher cancelled.');
        return;
      }
      if (entry?.referenceType === 'manual' && entry?.financeApprovalAuthorities?.financeControllerUser) {
        await api.put(`/finance/journal-entries/${entry._id}/finance-reject`, { comments });
        await reloadEntry();
        setApprovalMsg('Journal entry rejected and marked cancelled.');
        return;
      }
    } catch (e) {
      setApprovalMsg(e?.response?.data?.message || 'Rejection failed.');
    }
  };

  const isManualJV = entry?.referenceType === 'manual';
  const financeAuthorityDoc = isManualJV
    ? null
    : (apPaymentApp || payrollPeriodPaymentApp || manualSalaryPaymentApp || vendorAdvanceDoc || cashApproval);
  const pendingAuthorityVoucher = !isManualJV && (
    (apPaymentApp?.workflowStatus === 'pending_authority' && entry?.status === 'draft')
    || (payrollPeriodPaymentApp?.workflowStatus === 'pending_authority' && entry?.status === 'draft')
    || (manualSalaryPaymentApp?.workflowStatus === 'pending_authority' && entry?.status === 'draft')
    || (vendorAdvanceDoc?.voucherWorkflowStatus === 'pending_authority' && entry?.status === 'draft')
  );

  const authoritySlots = useMemo(() => {
    if (payrollPeriodPaymentApp || manualSalaryPaymentApp) {
      return [
        { key: 'accountsManagerUser', label: 'Sr Manager Accounts' },
        { key: 'financeControllerUser', label: 'GM Finance' }
      ];
    }
    return [
      { key: 'accountsOfficerUser', label: 'Accounts Officer / AM' },
      { key: 'accountsManagerUser', label: 'Sr Manager Accounts' },
      { key: 'financeControllerUser', label: 'GM Finance' },
      { key: 'avpUser', label: 'AVP', hardcodedName: 'Fahad Farid' },
      { key: 'ceoUser', label: 'CEO', hardcodedName: 'Sardar Umer Tanveer' },
      { key: 'presidentUser', label: 'President', hardcodedName: 'Sardar Tanveer Ilyas' }
    ];
  }, [payrollPeriodPaymentApp, manualSalaryPaymentApp]);

  const myPendingAuthorityLabels = useMemo(() => {
    if (!financeAuthorityDoc || !user) return [];
    const uid = String(user?.id || user?._id || '');
    const authorities = financeAuthorityDoc?.financeApprovalAuthorities || {};
    const normId = (v) => String(v?._id || v?.id || v || '').trim();
    const approvals = Array.isArray(financeAuthorityDoc?.financeAuthorityApprovals) ? financeAuthorityDoc.financeAuthorityApprovals : [];
    const decided = new Set(approvals.map((a) => String(a?.authorityKey || '').trim()).filter(Boolean));
    return authoritySlots
      .filter((s) => normId(authorities?.[s.key]) === uid && !decided.has(s.key))
      .map((s) => s.label);
  }, [financeAuthorityDoc, user, authoritySlots]);

  const voucherType = useMemo(() => String(entry?.referenceType || 'manual').toUpperCase(), [entry]);
  const voucherTitle = useMemo(() => resolveVoucherTitle(entry), [entry]);
  const voucherCompanyName = useMemo(
    () => resolveCompanyName(entry, { payrollPeriodPaymentApp, manualSalaryPaymentApp, apPaymentApp, vendorAdvanceDoc }, companies),
    [entry, payrollPeriodPaymentApp, manualSalaryPaymentApp, apPaymentApp, vendorAdvanceDoc, companies]
  );
  const headerDetails = useMemo(
    () => resolveVoucherHeaderDetails(entry, { apPaymentApp, vendorAdvanceDoc, cashApproval, linkedPo, payrollPeriodPaymentApp, manualSalaryPaymentApp }),
    [entry, apPaymentApp, vendorAdvanceDoc, cashApproval, linkedPo, payrollPeriodPaymentApp, manualSalaryPaymentApp]
  );
  const monthName = useMemo(() => {
    if (!entry?.date) return '—';
    return new Date(entry.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [entry]);

  const isPayrollBpv = useMemo(() => {
    const series = String(entry?.voucherSeries || '').trim().toUpperCase();
    return entry?.module === 'payroll' && (series === 'BPV' || series === 'CPV');
  }, [entry]);

  const payrollPeriodLabel =
    entry?.payrollVoucherSummary?.periodLabel
    || payrollPeriodPaymentApp?.periodLabel
    || manualSalaryPaymentApp?.periodLabel
    || monthName;
  const payrollEmployeeCount =
    entry?.payrollVoucherSummary?.employeeCount
    ?? payrollPeriodPaymentApp?.employeeCount
    ?? manualSalaryPaymentApp?.employeeCount;

  if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;
  if (!entry) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{loadError || 'Voucher not found'}</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate(-1)}>Back</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box className="app-print-hide" sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Button variant="outlined" startIcon={<BackIcon />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {entry.status !== 'reversed' && !entry.isReversed && (
            <Button
              variant="outlined"
              color="primary"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/finance/journal-entries/${entry._id}/edit`)}
            >
              Edit Voucher
            </Button>
          )}
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
            Print
          </Button>
        </Box>
      </Box>

      <Paper
        sx={{
          p: 3,
          maxWidth: '1200px',
          mx: 'auto',
          '@media print': {
            p: '10mm 12mm !important',
            m: '0 !important',
            maxWidth: '100% !important',
            boxShadow: 'none !important',
            border: 'none !important',
            fontSize: '12px !important',
            pageBreakInside: 'avoid !important',
            breakInside: 'avoid !important',
            '& .MuiTypography-root': {
              fontSize: '12px !important'
            },
            '& .MuiTypography-h5, & .MuiTypography-h6, & .MuiTypography-subtitle1': {
              fontSize: '14px !important',
              fontWeight: '700 !important'
            },
            '& .MuiTableCell-root': {
              padding: '5px 8px !important',
              fontSize: '11.5px !important'
            },
            '& .MuiAlert-root': {
              display: 'none !important'
            },
            '& .MuiChip-root': {
              height: '22px !important',
              fontSize: '11px !important'
            },
            '& img': {
              maxHeight: '34px !important'
            }
          }
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
          <Box>
            <Typography fontWeight={700} sx={{ fontSize: '17px !important' }}>{voucherCompanyName}</Typography>
            <Typography fontWeight={700} color="primary" sx={{ fontSize: '15px !important' }}>{voucherTitle}</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2">{formatDateForPrint(entry.date)}</Typography>
            <Typography variant="body2">
              {entry.createdAt
                ? new Date(entry.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
                : new Date(entry.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, p: 1, bgcolor: '#f9f9f9', borderRadius: 1, border: '1px solid #eee', '@media print': { p: '6px 10px', mb: 1 } }}>
          <Box>
            <Typography variant="body2"><strong>Voucher Type:</strong> {voucherType}</Typography>
            <Typography variant="body2"><strong>Voucher No:</strong> {entry.entryNumber}</Typography>
            <Typography variant="body2"><strong>Month:</strong> {payrollPeriodLabel}</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2"><strong>Date:</strong> {formatDateForPrint(entry.date)}</Typography>
            {entry.signedBySignatory ? (
              <Typography variant="body2"><strong>Signed By:</strong> {entry.signedBySignatory}</Typography>
            ) : null}
            {isPayrollBpv && payrollEmployeeCount != null ? (
              <Typography variant="body2"><strong>Employees:</strong> {payrollEmployeeCount}</Typography>
            ) : null}
          </Box>
        </Box>

        {/* Key details: payee, cost center, project, bank, documents, amount, status */}
        <Box
          sx={{
            mb: 1.5,
            p: 1.25,
            border: '1px solid #eee',
            borderRadius: 1,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' },
            columnGap: 2,
            rowGap: 1,
            '@media print': { p: '6px 10px', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', rowGap: '4px' }
          }}
        >
          {headerDetails.map((d) => (
            <Box key={d.label} sx={{ minWidth: 0, gridColumn: d.wide ? '1 / -1' : undefined }}>
              <Typography
                variant="caption"
                sx={{ display: 'block', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, fontSize: '10px !important' }}
              >
                {d.label}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: d.label.startsWith('Payee') || d.label === 'Amount' ? 700 : 400, wordBreak: 'break-word' }}>
                {d.value}
              </Typography>
            </Box>
          ))}
        </Box>

        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5, fontSize: '13px' }}>
          {isPayrollBpv ? 'Accounting Entries' : 'Voucher Lines'}
        </Typography>
        {isPayrollBpv ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5, '@media print': { display: 'none' } }}>
            Gross salary expense, EOBI employer expense, and each deduction post to their chart of accounts; bank is credited for net pay.
          </Typography>
        ) : null}
        <Table size="small" sx={{ mb: 1.5 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Account Title</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Narration</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Reference</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Cost Center</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Debit</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Credit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(entry.lines || []).map((line, idx) => (
              <TableRow key={idx}>
                <TableCell>
                  {(() => {
                    const accName = line?.account?.name || '—';
                    if (vendorAdvanceDoc?.vendor?.name && accName.toLowerCase().includes('advance to supplier')) {
                      return `Advance to Supplier — ${vendorAdvanceDoc.vendor.name}`;
                    }
                    return accName;
                  })()}
                  {line?.account?.accountNumber ? <Typography variant="caption" display="block" sx={{ fontSize: '9.5px !important' }}>({line.account.accountNumber})</Typography> : null}
                </TableCell>
                <TableCell>{line.description || entry.description || '—'}</TableCell>
                <TableCell>{line.reference || entry.reference || '—'}</TableCell>
                <TableCell>{entry.costCenter?.name || entry.costCenter || '—'}</TableCell>
                <TableCell align="right">{line.debit ? formatPKR(line.debit) : '0'}</TableCell>
                <TableCell align="right">{line.credit ? formatPKR(line.credit) : '0'}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={4} align="right"><strong>Total</strong></TableCell>
              <TableCell align="right"><strong>{formatPKR(entry.totalDebits || 0)}</strong></TableCell>
              <TableCell align="right"><strong>{formatPKR(entry.totalCredits || 0)}</strong></TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Box sx={{ mt: 1.5 }}>
          {isManualJV && entry?.status === 'draft' ? (
            <Alert 
              severity="info" 
              sx={{ mb: 1.5 }}
              action={
                <Button 
                  color="primary" 
                  variant="contained"
                  size="small" 
                  onClick={async () => {
                    if (!window.confirm('Are you sure you want to post this manual journal entry to the ledger?')) return;
                    try {
                      await api.put(`/finance/journal-entries/${entry._id}/post`);
                      window.location.reload();
                    } catch (e) {
                      alert(e.response?.data?.message || 'Posting failed');
                    }
                  }}
                >
                  Post to Ledger
                </Button>
              }
            >
              This manual journal entry is in <strong>Draft</strong> status and has not been posted to the ledger.
            </Alert>
          ) : null}

          {!isManualJV && financeAuthorityDoc ? (
            <>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, fontSize: '13px' }}>
                Finance Document Approval Authority
              </Typography>
              {approvalMsg ? (
                <Alert severity={approvalMsg.toLowerCase().includes('failed') ? 'error' : 'success'} sx={{ mb: 1, '@media print': { display: 'none' } }}>
                  {approvalMsg}
                </Alert>
              ) : null}
              {payrollPeriodPaymentApp?.workflowStatus === 'draft' ? (
                <Alert severity="info" sx={{ mb: 1, '@media print': { display: 'none' } }}>
                  This payroll BPV is still a <strong>draft</strong>. Submit it from Payroll — Finance when ready, or delete the draft from there.
                </Alert>
              ) : null}
              {pendingAuthorityVoucher ? (
                <Alert severity="warning" sx={{ mb: 1, '@media print': { display: 'none' } }}>
                  This voucher is <strong>draft</strong> until all finance authorities approve.
                </Alert>
              ) : null}
              {apPaymentApp?.bills?.length > 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Bill(s): <strong>{apPaymentApp.bills.map(b => b.billNumber || b.billId?.billNumber || '—').join(', ')}</strong>
                  {' · '}Settlement: {formatPKR(apPaymentApp.amount || 0)}
                </Typography>
              ) : apPaymentApp?.accountsPayableId ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Bill: <strong>{apPaymentApp.billNumber || apPaymentApp.accountsPayableId?.billNumber || '—'}</strong>
                  {' · '}Settlement: {formatPKR(apPaymentApp.amount || 0)}
                </Typography>
              ) : null}
              {payrollPeriodPaymentApp ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Company: <strong>{payrollPeriodPaymentApp.companyName || '—'}</strong>
                  {' · '}Period: <strong>{payrollPeriodPaymentApp.periodLabel || '—'}</strong>
                  {' · '}{payrollPeriodPaymentApp.employeeCount || 0} employees
                  {' · '}Payment: {formatPKR(payrollPeriodPaymentApp.amount || 0)}
                </Typography>
              ) : null}
              {manualSalaryPaymentApp ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Manual Salary
                  {' · '}Period: <strong>{manualSalaryPaymentApp.periodLabel || '—'}</strong>
                  {' · '}{manualSalaryPaymentApp.employeeCount || 0} employees
                  {' · '}Payment: {formatPKR(manualSalaryPaymentApp.amount || 0)}
                </Typography>
              ) : null}
              {payrollPeriodPaymentApp?.rejectionObservation ? (
                <Alert severity="error" sx={{ mb: 1, '@media print': { display: 'none' } }}>
                  Rejection observation: {payrollPeriodPaymentApp.rejectionObservation}
                </Alert>
              ) : null}
              {manualSalaryPaymentApp?.rejectionObservation ? (
                <Alert severity="error" sx={{ mb: 1, '@media print': { display: 'none' } }}>
                  Rejection observation: {manualSalaryPaymentApp.rejectionObservation}
                </Alert>
              ) : null}
              {myPendingAuthorityLabels.length > 0 ? (
                <Box className="app-print-hide" sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                    Your pending authority:
                  </Typography>
                  <Typography component="span" variant="body2" fontWeight={600} sx={{ mr: 1.5 }}>
                    {myPendingAuthorityLabels.join(', ')}
                  </Typography>
                  <Button size="small" variant="contained" color="success" onClick={approveMyAuthorityFromVoucher}>
                    Approve from Voucher
                  </Button>
                  <Button size="small" variant="contained" color="error" onClick={rejectMyAuthorityFromVoucher} sx={{ ml: 1 }}>
                    Reject from Voucher
                  </Button>
                </Box>
              ) : null}
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Authority</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Approver</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Date &amp; Time</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Digital Signature</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(() => {
                    const approvals = Array.isArray(financeAuthorityDoc?.financeAuthorityApprovals) ? financeAuthorityDoc.financeAuthorityApprovals : [];
                    const byKey = new Map(approvals.map((a) => [String(a?.authorityKey || '').trim(), a]).filter(([k]) => Boolean(k)));

                    return authoritySlots.map((slot) => {
                      const approval = byKey.get(slot.key);
                      const assigned = financeAuthorityDoc?.financeApprovalAuthorities?.[slot.key] || null;
                      const approver = approval?.approver || assigned || null;
                      const decision = approval ? String(approval.decision || 'approved').toLowerCase() : 'pending';
                      const approvedAt = approval?.approvedAt || null;
                      const approverName = slot.hardcodedName
                        ? slot.hardcodedName
                        : approver
                          ? ([approver?.firstName, approver?.lastName].filter(Boolean).join(' ').trim() || approver?.email || '—')
                          : '—';

                      return (
                        <TableRow key={slot.key}>
                          <TableCell>{slot.label}</TableCell>
                          <TableCell>{approverName}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={decision === 'rejected' ? 'Rejected' : (decision === 'approved' ? 'Approved' : 'Pending')}
                              color={decision === 'rejected' ? 'error' : (decision === 'approved' ? 'success' : 'warning')}
                              variant={decision === 'approved' || decision === 'rejected' ? 'filled' : 'outlined'}
                            />
                          </TableCell>
                          <TableCell>{approvedAt ? new Date(approvedAt).toLocaleString() : '—'}</TableCell>
                          <TableCell align="center">
                            {decision === 'approved' && approver?.digitalSignature ? (
                              <DigitalSignatureImage userOrPath={approver} alt={`${slot.label} signature`} />
                            ) : decision === 'approved' ? (
                              <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">—</Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            </>
          ) : null}
        </Box>
      </Paper>
    </Box>
  );
};

export default VoucherView;

