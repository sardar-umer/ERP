import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Print as PrintIcon,
  Send as SendIcon,
  RestartAlt as RestartAltIcon
} from '@mui/icons-material';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import utilityBillService from '../../../services/utilityBillService';
import { getImageUrl, handleImageError } from '../../../utils/imageService';
import {
  UTILITY_MEMO_COL_WIDTHS,
  utilityMemoDateCellSx,
  utilityMemoRefCellSx,
  utilityMemoTableSx
} from '../../../utils/utilityBillMemoUtils';
import { DigitalSignatureImage } from '../../../components/common/DigitalSignatureImage';
import LineAttachmentsView from '../../../components/UtilityBill/LineAttachmentsView';
import ZoomPanImageToolbar from '../../../components/common/ZoomPanImageToolbar';
import { useZoomPanImage } from '../../../hooks/useZoomPanImage';
import {
  approverSearchOnInputChange,
  mergeApproverOptionList,
  optionsForManagerApprover,
  optionsForHodApprover
} from '../../../utils/dualApproverAutocomplete';
import { getApprovalRoleLabel } from '../../../utils/utilityBillApprovalSlots';
import {
  AuditReturnFeedbackSection,
  ResendToPreAuditDialog,
  useAdminWorkflowAuditReturn,
  isWorkflowAuditBlockingEditStatus
} from '../../../components/Admin/workflowAuditReturn';
import { getCentralizedStoreDocumentTypeLabel } from '../../../utils/centralizedStoreBillKind';

const formatMemoDate = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit'
  }).replace(/ /g, '-');
};

const formatDateTime = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatMemoAmount = (amount) => new Intl.NumberFormat('en-PK', {
  maximumFractionDigits: 0
}).format(Number(amount || 0));

/** Centralized store commercial invoice (print + on-screen) */
const formatInvoiceDateDmy = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).replace(/ /g, '-');
};

const formatInvoiceTime12h = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

const formatDecimalPk = (amount) => new Intl.NumberFormat('en-PK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(amount || 0));

const displayValue = (value) => value || '';
const userDisplayName = (user) => {
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.employeeId || '';
};
const getUserId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value._id || value.id || value.userId || '');
};
const getSignatureSource = (row) => row?.signatureUser?.digitalSignature || '';

const utilityBillObservationKey = (obs) => {
  if (!obs) return '';
  return String(obs._id || obs.id || '');
};

/** Bill detail page: payment recording is not offered here (removed from toolbar). */
const UtilityBillDetails = ({
  id: idProp = null,
  embedded = false,
  hideBack = false,
  hideModuleActions = false
} = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: idParam } = useParams();
  const id = idProp || idParam;
  const isFinanceContext = location.pathname.startsWith('/finance/utility-bills');
  const isGeneralStoreContext = location.pathname.startsWith('/general/centralized-store');
  const billsListPath = isFinanceContext
    ? '/finance/accounts-payable'
    : isGeneralStoreContext
      ? '/general/centralized-store/bills'
      : '/admin/centralized-store/bills';
  const billEditPath = (billId) =>
    isGeneralStoreContext
      ? `/general/centralized-store/bill/${billId}/edit`
      : `/admin/centralized-store/bill/${billId}/edit`;
  const { user } = useAuth();
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [managerApprover, setManagerApprover] = useState(null);
  const [hodApprover, setHodApprover] = useState(null);
  const [approverOptions, setApproverOptions] = useState([]);
  const [approverLoading, setApproverLoading] = useState(false);
  const submitRequesterId = getUserId(user);
  const mergedSubmitApprovers = useMemo(
    () => mergeApproverOptionList(approverOptions, managerApprover, hodApprover),
    [approverOptions, managerApprover, hodApprover]
  );
  const managerSubmitOptions = useMemo(
    () => optionsForManagerApprover({ optionsMerged: mergedSubmitApprovers, requesterId: submitRequesterId, hodApprover }),
    [mergedSubmitApprovers, submitRequesterId, hodApprover]
  );
  const hodSubmitOptions = useMemo(
    () => optionsForHodApprover({ optionsMerged: mergedSubmitApprovers, requesterId: submitRequesterId, managerApprover }),
    [mergedSubmitApprovers, submitRequesterId, managerApprover]
  );
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const billImageZoomPan = useZoomPanImage(imageModalOpen ? bill?.billImage : null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [postingFinance, setPostingFinance] = useState(false);
  useEffect(() => {
    fetchBill();
  }, [id]);

  const fetchBill = async () => {
    try {
      setLoading(true);
      const response = await utilityBillService.getUtilityBill(id);
      setBill(response.data);
    } catch (err) {
      setError('Failed to fetch utility bill details');
      console.error('Error fetching bill:', err);
    } finally {
      setLoading(false);
    }
  };

  const getGrandTotal = () => bill?.grandTotal ?? ((Number(bill?.amount) || 0) + (Number(bill?.balanceAmount) || 0));
  const getBalanceToPay = () => (
    Number(bill?.balanceAmount) || Math.max((Number(getGrandTotal()) || 0) - (Number(bill?.lastMonthAmount) || 0), 0)
  );
  const getForWhat = () => bill?.forWhat || bill?.description || '';
  const getPreparedBy = () => (
    userDisplayName(bill?.createdBy)
  );
  const getApprovedBy = () => userDisplayName(bill?.approvedBy);
  const getApprovalRows = () => {
    const chain = bill?.approvalChain || [];
    const workflowHistory = bill?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findLatestAuditEntry = (keywords = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      const fromStatus = normalize(entry?.fromStatus);
      return keywords.some((keyword) => toStatus.includes(keyword) || fromStatus.includes(keyword));
    });
    const findLatestByToStatus = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return accepted.some((status) => (
        toStatus === status || toStatus.startsWith(status)
      ));
    });

    const findPreferredAuditEntry = (accepted = []) => {
      const entries = history.filter((entry) => {
        const toStatus = normalize(entry?.toStatus);
        return accepted.some((status) => toStatus === status || toStatus.startsWith(status));
      });
      return entries.find((e) => e?.stampUsed && e?.stampImage)
        || entries.find((e) => e?.changedBy?.digitalSignature)
        || entries[0];
    };
    const preAuditActorEntry = findPreferredAuditEntry([
      'forwarded to audit director',
      'initial audit approval'
    ]) || findLatestAuditEntry([
      'forwarded to audit director',
      'initial audit approval'
    ]);
    const directorApproval = findLatestByToStatus([
      'approved (from forwarded to audit director)',
      'approved (from send to audit)'
    ]) || findLatestAuditEntry([
      'approved (from forwarded to audit director)',
      'approved (from send to audit)'
    ]);

    const rows = [
      {
        authority: 'Sig of Requester',
        name: getPreparedBy(),
        signature: '',
        signatureUser: bill?.createdBy,
        dateTime: formatDateTime(bill?.createdAt)
      }
    ];

    (Array.isArray(chain) ? chain : []).forEach((step, idx) => {
      const approved = step?.status === 'approved';
      rows.push({
        authority: getApprovalRoleLabel(step?.role, idx),
        name: userDisplayName(step?.approver),
        signature: approved ? userDisplayName(step?.approver) : '',
        signatureUser: approved ? step?.approver : null,
        dateTime: approved ? formatDateTime(step?.actedAt) : ''
      });
    });

    rows.push(
      {
        authority: 'Pre-Audit Authority',
        name: userDisplayName(preAuditActorEntry?.changedBy),
        signature: preAuditActorEntry?.changedBy ? userDisplayName(preAuditActorEntry.changedBy) : '',
        signatureUser: preAuditActorEntry?.changedBy || null,
        signaturePath: preAuditActorEntry?.stampUsed && preAuditActorEntry?.stampImage
          ? preAuditActorEntry.stampImage
          : preAuditActorEntry?.changedBy?.digitalSignature || '',
        dateTime: formatDateTime(preAuditActorEntry?.changedAt)
      },
      {
        authority: 'Audit Director',
        name: userDisplayName(directorApproval?.changedBy),
        signature: directorApproval?.changedBy ? userDisplayName(directorApproval.changedBy) : '',
        signatureUser: directorApproval?.changedBy || null,
        signaturePath: directorApproval?.stampUsed && directorApproval?.stampImage
          ? directorApproval.stampImage
          : directorApproval?.changedBy?.digitalSignature || '',
        dateTime: formatDateTime(directorApproval?.changedAt)
      }
    );

    return rows;
  };
  const getStampRows = () => {
    const workflowHistory = bill?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findStampedEntry = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return (entry?.stampUsed && entry?.stampImage)
        && accepted.some((status) => toStatus === status || toStatus.startsWith(status));
    });
    const preAuditStamp = findStampedEntry(['forwarded to audit director', 'initial audit approval']);
    const directorStamp = findStampedEntry(['approved (from forwarded to audit director)', 'approved (from send to audit)']);
    return [
      { authority: 'Pre-Audit Authority Stamp', stampImage: preAuditStamp?.stampImage || '', dateTime: formatDateTime(preAuditStamp?.changedAt) },
      { authority: 'Audit Director Stamp', stampImage: directorStamp?.stampImage || '', dateTime: formatDateTime(directorStamp?.changedAt) }
    ].filter((row) => row.stampImage);
  };
  const getPrimaryHeading = () => (bill?.accountHead || bill?.site || bill?.location || bill?.provider || bill?.utilityType || 'Utility Bill').toUpperCase();
  const getSecondaryHeading = () =>
    [bill?.provider, bill?.utilityType].filter(Boolean).join(' - ') || '';
  const isCentralizedStoreInvoice = Boolean(
    bill?.useCentralizedStore && Array.isArray(bill?.billLines) && bill.billLines.length > 0
  );
  const getStoreInvoiceOrgTitle = () =>
    (displayValue(bill?.site) || displayValue(bill?.accountHead) || displayValue(bill?.provider) || 'Bill').trim();
  const storeDocumentTypeLabel = getCentralizedStoreDocumentTypeLabel(bill);
  const getVendorSupplierLine = () => {
    const e = bill?.payeeEmployee;
    if (e && typeof e === 'object') {
      const name = [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
      const id = e.employeeId ? `${String(e.employeeId).trim()} ` : '';
      return `${id}${name}`.trim() || displayValue(bill?.provider);
    }
    const v = bill?.vendorId;
    if (v && typeof v === 'object') {
      const sid = v.supplierId != null && String(v.supplierId).trim() !== '' ? `${String(v.supplierId).trim()} ` : '';
      return `${sid}${v.name || ''}`.trim() || displayValue(bill?.provider);
    }
    return displayValue(bill?.provider);
  };
  const getPayeeNameLine = () => {
    if ((bill?.provider || '').trim()) return displayValue(bill.provider);
    const e = bill?.payeeEmployee;
    if (e && typeof e === 'object') {
      return [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.employeeId || '—';
    }
    return '—';
  };

  const isCoaBill =
    bill?.referenceType === 'manual' ||
    bill?.module === 'finance' ||
    (Boolean((bill?.billLines || bill?.lineItems || []).some((l) => l?.account || l?.accountNumber || l?.category)) &&
      !bill?.useCentralizedStore &&
      bill?.referenceType !== 'utility_bill');

  const getStoreLineCategoryOrCode = (line) => {
    if (isCoaBill) {
      if (line?.category && String(line.category).trim() !== '' && String(line.category).trim() !== '—') {
        return String(line.category).trim();
      }
      if (line?.accountName && String(line.accountName).trim() !== '') {
        const num = line.accountNumber ? ` (${String(line.accountNumber).trim()})` : '';
        return `${String(line.accountName).trim()}${num}`;
      }
      if (line?.account && typeof line.account === 'object' && line.account.name) {
        const num = line.account.accountNumber ? ` (${String(line.account.accountNumber).trim()})` : '';
        return `${String(line.account.name).trim()}${num}`;
      }
      if (line?.accountNumber && String(line.accountNumber).trim() !== '') {
        return `Account ${String(line.accountNumber).trim()}`;
      }
      if (line?.categoryName && String(line.categoryName).trim() !== '') {
        return String(line.categoryName).trim();
      }
      if (line?.itemCode && String(line.itemCode).trim() !== '—') {
        return String(line.itemCode).trim();
      }
      return '—';
    }
    const snap = displayValue(line?.itemCode);
    if (snap && snap !== '—') return snap;
    const si = line?.storeItem;
    if (si && typeof si === 'object' && si.code) return String(si.code).trim();
    if (si && typeof si === 'object' && si.itemCode) return String(si.itemCode).trim();
    if (line?.productCode && String(line.productCode).trim() !== '' && String(line.productCode).trim() !== '—') {
      return String(line.productCode).trim();
    }
    const text = [line?.description, line?.itemName, line?.notes].filter(Boolean).join(' ');
    const match = text.match(/\[([A-Za-z0-9_-]+)\]/);
    if (match && match[1]) return match[1].trim();
    return '—';
  };

  const getStoreLineProductCode = (line) => getStoreLineCategoryOrCode(line);
  const getStoreLineDescription = (line) => {
    const name = (line?.itemName || '').trim();
    const desc = (line?.description || '').trim();
    if (name && desc) {
      if (name === desc) return name;
      if (desc.includes(name)) return desc;
      if (name.includes(desc)) return name;
      return `${name} — ${desc}`;
    }
    return name || desc || '—';
  };
  const getStoreInvoiceNarration = () => displayValue(bill?.notes) || getForWhat() || '—';
  const getStoreInvoiceLinesTotal = () =>
    (bill?.billLines || []).reduce((s, l) => s + (Number(l?.amount) || 0), 0) || Number(bill?.amount) || 0;

  const approvalStatus = bill?.approvalStatus || 'Draft';
  const pendingApproval = (bill?.approvalChain || []).find((step) => step.status === 'pending');
  const pendingApproverId = getUserId(pendingApproval?.approver);
  const userId = getUserId(user);
  const requesterId = getUserId(bill?.createdBy);
  const isRequester = requesterId && userId && requesterId === userId;
  const isPendingApprover = pendingApproverId && userId && pendingApproverId === userId && !isRequester;
  const canSubmitForApproval = ['Draft', 'Rejected'].includes(approvalStatus);
  const canApproveReject = approvalStatus === 'Submitted' && isPendingApprover;
  const computeAuditUi = useCallback((b) => ({
    // Returned by Finance for correction: the initiator may edit, then resubmit to Finance
    auditBlocksEdit:
      b?.approvalStatus === 'Approved' &&
      isWorkflowAuditBlockingEditStatus(b?.auditStatus) &&
      !b?.financeReturn?.active,
    canResendToPreAudit:
      b?.auditStatus === 'Returned from Audit' &&
      b?.approvalStatus === 'Approved'
  }), []);

  const resendToAuditApi = useCallback(
    async (payload) => {
      const response = await utilityBillService.resendUtilityBillToAudit(bill._id, payload);
      return response.data;
    },
    [bill?._id]
  );

  const workflowAudit = useAdminWorkflowAuditReturn({
    document: bill,
    computeAuditUi,
    getObservationKey: utilityBillObservationKey,
    onResend: resendToAuditApi,
    onDocumentUpdate: setBill,
    onError: (message) => setSnackbar({ open: true, message, severity: 'error' }),
    onSuccess: (message) => setSnackbar({ open: true, message, severity: 'success' })
  });

  const getApprovalColor = (status) => {
    switch (status) {
      case 'Approved': return 'success';
      case 'Submitted': return 'warning';
      case 'Rejected': return 'error';
      default: return 'default';
    }
  };

  const getAuditStatusColor = (auditLabel) => {
    const s = String(auditLabel || '');
    if (s === 'Returned from Audit' || s.includes('Rejected')) return 'error';
    if (s.includes('Paid (from Finance)')) return 'success';
    if (s.includes('Partially Paid (from Finance)')) return 'info';
    if (s.startsWith('Approved')) return 'success';
    if (s === 'Not Sent') return 'default';
    return 'warning';
  };

  const isAuditFinallyApproved = String(bill?.auditStatus || '').startsWith('Approved (from ');
  const financeReturned = Boolean(bill?.financeReturn?.active);
  const financeReturnNote = financeReturned
    ? ((bill.observations || []).filter((o) => !o.resolved).map((o) => o.observation).filter(Boolean).slice(-1)[0]
      || bill.financeReturn.reason || '')
    : '';
  const [financeResubmit, setFinanceResubmit] = useState({ open: false, answer: '', saving: false });
  const handleResubmitToFinance = async () => {
    try {
      setFinanceResubmit((d) => ({ ...d, saving: true }));
      const res = await utilityBillService.resubmitUtilityBillToFinance(bill._id, { answer: financeResubmit.answer.trim() });
      if (res?.data) setBill(res.data);
      setFinanceResubmit({ open: false, answer: '', saving: false });
      setSnackbar({ open: true, message: res?.message || 'Resubmitted to Finance', severity: 'success' });
    } catch (err) {
      setFinanceResubmit((d) => ({ ...d, saving: false }));
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to resubmit to Finance', severity: 'error' });
    }
  };
  const needsFinancePost = isAuditFinallyApproved && !bill?.financeApBillId;

  const handlePostToFinance = async () => {
    try {
      setPostingFinance(true);
      const response = await utilityBillService.postUtilityBillToFinance(bill._id);
      setBill(response.data?.bill || response.data);
      setSnackbar({ open: true, message: response.message || 'Posted to Finance', severity: 'success' });
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.response?.data?.message || 'Failed to post to Finance',
        severity: 'error'
      });
    } finally {
      setPostingFinance(false);
    }
  };

  const loadApproverOptions = async (search = '') => {
    try {
      setApproverLoading(true);
      const response = await utilityBillService.getApproverCandidates({ search, limit: 50 });
      setApproverOptions(response.data || []);
    } catch {
      setApproverOptions([]);
    } finally {
      setApproverLoading(false);
    }
  };

  useEffect(() => {
    if (submitDialogOpen) loadApproverOptions('');
  }, [submitDialogOpen]);

  const handleSubmitForApproval = async () => {
    if (!managerApprover?._id || !hodApprover?._id) {
      setSnackbar({ open: true, message: 'Select Manager and Head Of Department approvers', severity: 'error' });
      return;
    }

    if ([getUserId(managerApprover), getUserId(hodApprover)].includes(getUserId(user))) {
      setSnackbar({ open: true, message: 'Requester cannot be selected as Manager or Head Of Department approver', severity: 'error' });
      return;
    }

    if (managerApprover._id === hodApprover._id) {
      setSnackbar({ open: true, message: 'Manager and Head Of Department approvers must be different', severity: 'error' });
      return;
    }

    try {
      const response = await utilityBillService.submitUtilityBill(bill._id, { approverIds: [managerApprover._id, hodApprover._id] });
      setBill(response.data);
      setSubmitDialogOpen(false);
      setManagerApprover(null);
      setHodApprover(null);
      setSnackbar({ open: true, message: 'Utility bill submitted for approval', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to submit utility bill', severity: 'error' });
    }
  };

  const handleApprove = async () => {
    try {
      const response = await utilityBillService.approveUtilityBill(bill._id);
      setBill(response.data);
      setSnackbar({ open: true, message: 'Utility bill approved', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to approve utility bill', severity: 'error' });
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('Please enter rejection reason:');
    if (!reason) return;

    try {
      const response = await utilityBillService.rejectUtilityBill(bill._id, reason);
      setBill(response.data);
      setSnackbar({ open: true, message: 'Utility bill rejected', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to reject utility bill', severity: 'error' });
    }
  };

  const buildMemoTableBodyHtml = () => `
              <tr class="body-row">
                <td>${formatMemoDate(bill?.billDate)}</td>
                <td>${displayValue(bill?.accountNumber)}</td>
                <td>${displayValue(bill?.provider)}</td>
                <td>${getForWhat()}</td>
                <td class="amount-col">${formatMemoAmount(bill?.amount)}</td>
                <td class="last-col">${formatMemoAmount(bill?.lastMonthAmount)}</td>
              </tr>
              <tr class="totals"><td colspan="4" class="total-label">Grand Total</td><td class="amount-col">${formatMemoAmount(getGrandTotal())}</td><td></td></tr>
              <tr class="totals"><td colspan="4" class="total-label">Cash Deposit Last Month</td><td class="amount-col">${formatMemoAmount(bill?.lastMonthAmount)}</td><td></td></tr>
              <tr class="totals"><td colspan="4" class="total-label">Balance Amount to be Paid</td><td class="amount-col">${formatMemoAmount(getBalanceToPay())}</td><td></td></tr>`;

  const getStoreCentralizedPrintHtml = () => {
    const esc = (s) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const lines = bill?.billLines || [];
    const totalVal = getStoreInvoiceLinesTotal();
    const grossVal = lines.reduce((s, l) => {
      const qty = l.quantity !== undefined && l.quantity !== null && l.quantity !== '' ? Number(l.quantity) : 1;
      const rate = l.unitPrice !== undefined && l.unitPrice !== null && l.unitPrice !== ''
        ? Number(l.unitPrice)
        : (qty ? (Number(l.amount) || 0) / qty : (Number(l.amount) || 0));
      return s + Math.max(0, qty * rate);
    }, 0);
    const discountVal = lines.reduce((s, l) => s + Math.max(0, Number(l.discount) || 0), 0);
    const duePayTotal =
      Number(bill?.duePaymentAmount) > 0
        ? Number(bill.duePaymentAmount)
        : lines.reduce((s, l) => s + (Number(l.duePaymentAmount) || 0), 0);
    const bd = bill?.billDate ? new Date(bill.billDate) : null;
    const created = bill?.createdAt ? new Date(bill.createdAt) : bd;
    const rowHtml = lines.map((line, i) => {
      const amt = Number(line.amount) || 0;
      const duePay = Number(line.duePaymentAmount) || 0;
      const hasQty = line.quantity !== undefined && line.quantity !== null && line.quantity !== '';
      const qty = hasQty ? Number(line.quantity) : 1;
      const hasRate = line.unitPrice !== undefined && line.unitPrice !== null && line.unitPrice !== '';
      const rate = hasRate ? Number(line.unitPrice) : (qty ? amt / qty : amt);
      const discount = Math.max(0, Number(line.discount) || 0);
      const valueExTax = Math.max(0, qty * rate);
      const netAmount = Math.max(0, valueExTax - discount);
      return `<tr class="data-row">
        <td class="c-num">${i + 1}</td>
        <td class="c-code">${esc(getStoreLineProductCode(line))}</td>
        <td class="c-desc">${esc(getStoreLineDescription(line))}</td>
        <td class="c-center">Nos</td>
        <td class="c-num">${formatDecimalPk(qty)}</td>
        <td class="c-num">${formatDecimalPk(rate)}</td>
        <td class="c-num">${formatDecimalPk(valueExTax)}</td>
        <td class="c-num">${formatDecimalPk(discount)}</td>
        <td class="c-num">${formatDecimalPk(amt || netAmount)}</td>
        <td class="c-num">${formatDecimalPk(duePay)}</td>
      </tr>`;
    }).join('');
    const charges = [
      ['Service Charges', 0],
      ['Freight Charges', 0],
      ['Packing Charges', 0],
      ['Loading Charges', 0],
      ['Income Tax', 0],
      ['Special Excise Duty', 0],
      ['Custom Duty', 0],
      ['Sales Tax', 0]
    ];
    const chargesHtml = charges
      .map(([label, val]) => `<div class="sum-row charge"><span>${esc(label)}</span><span>${formatDecimalPk(val)}</span></div>`)
      .join('');
    const orgTitle = esc(getStoreInvoiceOrgTitle());
    const narration = esc(getStoreInvoiceNarration());
    const docTypeLabel = esc(storeDocumentTypeLabel);

    return `<!DOCTYPE html>
<html>
  <head>
    <title></title>
    <style>
      @page { size: A4 portrait; margin: 10mm 12mm; }
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        margin: 0;
        padding: 0;
        background: #fff;
        color: #111;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .sheet { width: 100%; max-width: 100%; margin: 0; }
      .doc-title { text-align: center; margin: 0 0 10px; }
      .doc-title .org { font-size: 18px; font-weight: 700; letter-spacing: 0.3px; line-height: 1.2; }
      .doc-title .sub { font-size: 14px; font-weight: 700; margin-top: 2px; line-height: 1.2; }
      .meta {
        display: grid;
        grid-template-columns: 1.4fr 0.6fr;
        gap: 8px 20px;
        width: 100%;
        margin-bottom: 8px;
        border-bottom: 1px solid #bbb;
        padding-bottom: 8px;
      }
      .meta-block { line-height: 1.45; }
      .meta-block-right { text-align: right; }
      .meta-row {
        display: grid;
        grid-template-columns: 95px minmax(0, 1fr);
        column-gap: 8px;
        font-weight: 700;
        font-size: 11px;
        margin-bottom: 2px;
      }
      .meta-row span:last-child { word-break: break-word; }
      .meta-row-time {
        display: flex;
        justify-content: flex-end;
        align-items: baseline;
        gap: 8px;
        font-weight: 700;
        font-size: 11px;
      }
      .meta-row .lbl, .meta-row-time .lbl { color: #444; }
      .narration {
        width: 100%;
        background: #ffe7c2;
        border: 1px solid #e8b86a;
        padding: 7px 10px;
        margin: 0 0 10px;
        font-weight: 700;
        line-height: 1.35;
        font-size: 11px;
      }
      table.inv {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        margin: 0;
      }
      table.inv th {
        font-size: 9.5px;
        font-weight: 800;
        text-align: center;
        border: 1px solid #888;
        padding: 5px 3px;
        background: #f2f2f2;
        vertical-align: middle;
        line-height: 1.2;
      }
      table.inv td {
        border: 1px solid #999;
        padding: 5px 4px;
        vertical-align: top;
        font-size: 10.5px;
      }
      table.inv .c-num {
        text-align: right;
        font-family: Arial, Helvetica, sans-serif;
        font-variant-numeric: normal;
        white-space: nowrap;
      }
      table.inv .c-center { text-align: center; }
      table.inv .c-code { font-size: 10px; word-break: break-word; }
      table.inv .c-desc { text-align: left; line-height: 1.3; word-break: break-word; }
      table.inv tr.subtotal td { font-weight: 800; border-top: 2px solid #333; background: #fafafa; }
      .footer-sum { display: flex; justify-content: flex-end; width: 100%; margin-top: 10px; }
      .sum-box { width: 280px; max-width: 45%; font-size: 11px; }
      .sum-row { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; border-bottom: 1px solid #ddd; }
      .sum-row.charge { display: none; }
      .sum-row.net {
        border-bottom: 0;
        margin-top: 4px;
        padding-top: 6px;
        font-weight: 800;
        font-size: 12px;
      }
      .sum-row.net span:last-child {
        border-bottom: 3px double #111;
        padding-bottom: 2px;
        min-width: 90px;
        text-align: right;
        font-family: Arial, Helvetica, sans-serif;
        font-variant-numeric: normal;
      }
      .approval-table {
        margin-top: 18px;
        border: 1px solid #999;
        width: 100%;
        border-collapse: collapse;
        page-break-inside: avoid;
      }
      .approval-table th {
        text-align: left;
        font-size: 10px;
        background: #f5f5f5;
        border-bottom: 1px solid #999;
        padding: 6px 8px;
      }
      .approval-table td {
        border-bottom: 1px solid #ddd;
        padding: 6px 8px;
        font-size: 10px;
        vertical-align: middle;
      }
      .approval-table tr:last-child td { border-bottom: 0; }
      .approval-table img { max-height: 32px !important; max-width: 110px !important; object-fit: contain; }
      @media print {
        html, body { width: 100%; }
        .sheet { width: 100%; page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="doc-title">
        <div class="org">${orgTitle}</div>
        <div class="sub">${docTypeLabel}</div>
      </div>
      <div class="meta">
        <div class="meta-block">
          <div class="meta-row"><span class="lbl">Company</span><span>${esc(displayValue(bill?.site))}</span></div>
          <div class="meta-row"><span class="lbl">Date</span><span>${esc(formatInvoiceDateDmy(bd))}</span></div>
          <div class="meta-row"><span class="lbl">Bill ID</span><span>${esc(displayValue(bill?.billId))}</span></div>
          <div class="meta-row"><span class="lbl">Supplier</span><span>${esc(getVendorSupplierLine())}</span></div>
          <div class="meta-row"><span class="lbl">Payee Name</span><span>${esc(getPayeeNameLine())}</span></div>
          <div class="meta-row"><span class="lbl">Address</span><span>${esc(displayValue(bill?.location))}</span></div>
          <div class="meta-row"><span class="lbl">Due Date</span><span>${esc(formatInvoiceDateDmy(bill?.dueDate))}</span></div>
        </div>
        <div class="meta-block meta-block-right">
          <div class="meta-row-time"><span class="lbl">Time</span><span>${esc(formatInvoiceTime12h(created))}</span></div>
        </div>
      </div>
      <div class="narration">Narration: ${narration}</div>
      <table class="inv">
        <colgroup>
          <col style="width:4%" />
          <col style="width:11%" />
          <col style="width:24%" />
          <col style="width:5%" />
          <col style="width:7%" />
          <col style="width:9%" />
          <col style="width:10%" />
          <col style="width:5%" />
          <col style="width:11%" />
          <col style="width:14%" />
        </colgroup>
        <thead>
          <tr>
            <th>S.<br/>No</th>
            <th>Product<br/>Code</th>
            <th>Description</th>
            <th>Units</th>
            <th>Quantity</th>
            <th>Rate</th>
            <th>Value Excl.<br/>Tax</th>
            <th>Disc</th>
            <th>Net<br/>Amount</th>
            <th>Amount after<br/>Due Date</th>
          </tr>
        </thead>
        <tbody>
          ${rowHtml}
          <tr class="subtotal">
            <td colspan="6" style="text-align:right;">Sub Total</td>
            <td class="c-num">${formatDecimalPk(grossVal)}</td>
            <td class="c-num">${formatDecimalPk(discountVal)}</td>
            <td class="c-num">${formatDecimalPk(totalVal)}</td>
            <td class="c-num">${formatDecimalPk(duePayTotal)}</td>
          </tr>
        </tbody>
      </table>
      <div class="footer-sum">
        <div class="sum-box">
          ${chargesHtml}
          <div class="sum-row net"><span>Net Total</span><span>${formatDecimalPk(totalVal)}</span></div>
          <div class="sum-row net"><span>Amount after Due Date</span><span>${formatDecimalPk(duePayTotal)}</span></div>
        </div>
      </div>
      <table class="approval-table">
        <colgroup>
          <col style="width:28%" />
          <col style="width:24%" />
          <col style="width:26%" />
          <col style="width:22%" />
        </colgroup>
        <thead><tr><th>Authority</th><th>Name</th><th>Digital Signature</th><th>Date &amp; Time</th></tr></thead>
        <tbody>
          ${getApprovalRows().map((row) => `
            <tr>
              <td style="font-weight:800">${esc(row.authority)}</td>
              <td>${esc(row.name || '-')}</td>
              <td>${
                getSignatureSource(row)
                  ? `<img src="${esc(getImageUrl(getSignatureSource(row)))}" alt="" />`
                  : esc(row.signature || '-')
              }</td>
              <td>${esc(row.dateTime || '-')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </body>
</html>`;
  };

  const getPrintContent = () => {
    if (isCentralizedStoreInvoice) {
      return getStoreCentralizedPrintHtml();
    }
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <title></title>
        <style>
          body { font-family: Georgia, "Times New Roman", serif; color: #141414; margin: 20px; font-size: 12px; background: #fff; }
          .memo-paper { max-width: 960px; margin: 0 auto; padding: 38px 30px 30px; }
          .header { text-align: center; line-height: 1.15; margin-bottom: 14px; }
          .company { font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: .35px; }
          .title { font-size: 16px; font-weight: 700; margin-top: 2px; }
          .top-meta { display: grid; grid-template-columns: 1fr 170px; align-items: start; margin-bottom: 26px; }
          .left-meta { display: grid; grid-template-columns: 62px 1fr; width: 360px; margin-left: 150px; line-height: 1.35; font-weight: 700; }
          .right-meta { text-align: right; line-height: 2; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th { font-size: 10.5px; font-weight: 800; text-align: center; border-bottom: 1px solid #c7c7c7; padding: 7px 8px; color: #333; background: #f8f8f8; }
          td { padding: 9px 8px; vertical-align: top; }
          .main-table { margin-top: 6px; border-top: 1px solid #c7c7c7; border-bottom: 1px solid #c7c7c7; }
          .date-col { width: 11%; white-space: normal; }
          .ref-col { width: 14%; word-break: break-word; overflow-wrap: anywhere; }
          .paid-col { width: 20%; }
          .for-col { width: 27%; }
          .amount-col { width: 13%; text-align: right; }
          .last-col { width: 15%; text-align: right; }
          .main-table th, .main-table td { border-right: 1px solid #ededed; }
          .main-table th:last-child, .main-table td:last-child { border-right: 0; }
          .body-row td { border-top: 1px solid #d9d9d9; }
          .totals td { padding-top: 4px; padding-bottom: 4px; font-weight: 700; }
          .total-label { text-align: right; }
          .approval-table { margin-top: 56px; border: 1px solid #d8d8d8; }
          .approval-table th { text-align: left; font-size: 12px; background: #f5f5f5; border-bottom: 1px solid #d8d8d8; }
          .approval-table td { border-bottom: 1px solid #e0e0e0; }
          .approval-table tr:last-child td { border-bottom: 0; }
          .authority { font-weight: 800; }
          @media print { body { margin: 0; } .memo-paper { padding-top: 26px; } }
        </style>
      </head>
      <body>
        <div class="memo-paper">
          <div class="header">
            <div class="company">${getPrimaryHeading()}</div>
            <div class="title">${getSecondaryHeading()}</div>
          </div>
          <div class="top-meta">
            <div class="left-meta">
              <span>SITE :</span><span>${displayValue(bill?.site || bill?.location)}</span>
              <span>From:</span><span>${displayValue(bill?.department)}</span>
              <span>Custodian:</span><span>${displayValue(bill?.custodian)}</span>
            </div>
            <div class="right-meta">
              <div>${formatMemoDate(bill?.billDate)}</div>
              <div>${displayValue(bill?.billId)}</div>
            </div>
          </div>
          <table class="main-table">
            <colgroup>
              <col class="date-col" />
              <col class="ref-col" />
              <col class="paid-col" />
              <col class="for-col" />
              <col class="amount-col" />
              <col class="last-col" />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference<br />No</th>
                <th>To Whom Paid</th>
                <th class="for-col">For What</th>
                <th>Amount</th>
                <th>Last Month Amount</th>
              </tr>
            </thead>
            <tbody>
              ${buildMemoTableBodyHtml()}
            </tbody>
          </table>
          <table class="approval-table">
            <thead>
              <tr>
                <th>Authority</th>
                <th>Name</th>
                <th>Digital Signature</th>
                <th>Date &amp; Time</th>
              </tr>
            </thead>
            <tbody>
              ${getApprovalRows().map((row) => `
                <tr>
                  <td class="authority">${row.authority}</td>
                  <td>${row.name || '-'}</td>
                  <td>${
                    getSignatureSource(row)
                      ? `<img src="${getImageUrl(getSignatureSource(row))}" alt="${row.authority} signature" style="max-height:42px;max-width:135px;object-fit:contain;" />`
                      : row.signature || '-'
                  }</td>
                  <td>${row.dateTime || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
  };

  const handlePrint = () => {
    if (!bill) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError('Unable to open print window. Please allow pop-ups and try again.');
      return;
    }

    printWindow.document.write(getPrintContent());
    printWindow.document.close();
    try {
      printWindow.document.title = '';
    } catch (_) {
      /* ignore */
    }
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width="30%" height={48} />
        <Skeleton variant="rectangular" height={620} sx={{ mt: 2 }} />
      </Box>
    );
  }

  if (!bill) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Utility bill not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: embedded ? 0 : { xs: 1.5, sm: 3 } }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        mb={3}
        gap={2}
        flexDirection={{ xs: 'column', sm: 'row' }}
        flexWrap="wrap"
      >
        {!hideBack && !embedded && (
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(billsListPath)} sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}>
            {isFinanceContext ? 'Back to Accounts Payable' : 'Back to Bills'}
          </Button>
        )}
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          sx={{ ml: hideBack || embedded ? 0 : { sm: 'auto' }, width: { xs: '100%', sm: 'auto' }, '& .MuiButton-root': { minHeight: 40 } }}
        >
          <Chip label={`Approval: ${approvalStatus}`} color={getApprovalColor(approvalStatus)} sx={{ alignSelf: 'center' }} />
          {financeReturned && (
            <Chip label="Returned from Finance" color="error" sx={{ alignSelf: 'center', fontWeight: 700 }} />
          )}
          {!hideModuleActions && financeReturned && (
            <Button variant="contained" color="warning" startIcon={<SendIcon />} onClick={() => setFinanceResubmit({ open: true, answer: '', saving: false })}>
              Resubmit to Finance
            </Button>
          )}
          {bill.auditStatus && bill.auditStatus !== 'Not Sent' && (
            <Chip
              label={`Audit: ${bill.auditStatus}`}
              color={getAuditStatusColor(bill.auditStatus)}
              sx={{ alignSelf: 'center' }}
              variant="outlined"
            />
          )}
          {!hideModuleActions && canSubmitForApproval && (
            <Button variant="contained" color="info" startIcon={<SendIcon />} onClick={() => setSubmitDialogOpen(true)}>
              Submit
            </Button>
          )}
          {!hideModuleActions && canApproveReject && (
            <>
              <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={handleApprove}>
                Approve
              </Button>
              <Button variant="outlined" color="error" startIcon={<CancelIcon />} onClick={handleReject}>
                Reject
              </Button>
            </>
          )}
          <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>
            Print
          </Button>
          {!hideModuleActions && workflowAudit.canResendToPreAudit && (
            <Button variant="contained" color="warning" startIcon={<RestartAltIcon />} onClick={workflowAudit.openResendDialog}>
              Resend to Pre-Audit
            </Button>
          )}
          {!hideModuleActions && (
          <Tooltip
            title={
              workflowAudit.auditBlocksEdit
                ? 'This bill is with audit and cannot be edited until it is returned for correction.'
                : 'Edit bill fields'
            }
          >
            <span>
              <Button
                variant="contained"
                startIcon={<EditIcon />}
                disabled={workflowAudit.auditBlocksEdit}
                onClick={() => navigate(billEditPath(bill._id))}
              >
                Edit Bill
              </Button>
            </span>
          </Tooltip>
          )}
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {financeReturned && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <strong>Returned by Finance for correction</strong>
          {bill.financeReturn?.returnedAt ? ` on ${formatDateTime(bill.financeReturn.returnedAt)}` : ''}
          {financeReturnNote ? <>: {financeReturnNote}</> : '.'}
          <br />
          Use <strong>Edit Bill</strong> to make the correction (for a wrong company, change the company / site on the bill), then
          {' '}<strong>Resubmit to Finance</strong>. It goes straight back to Finance — no approval or audit again.
        </Alert>
      )}

      <Dialog open={financeResubmit.open} onClose={() => !financeResubmit.saving && setFinanceResubmit({ open: false, answer: '', saving: false })} maxWidth="sm" fullWidth>
        <DialogTitle>Resubmit to Finance</DialogTitle>
        <DialogContent>
          {financeReturnNote && (
            <Alert severity="info" sx={{ mb: 2 }}>Finance asked: {financeReturnNote}</Alert>
          )}
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            The Finance bill is rebuilt from this utility bill as it is now (company, lines and amount) and sent back to Finance.
          </Typography>
          <TextField
            fullWidth multiline minRows={2} label="What did you correct? (optional)"
            value={financeResubmit.answer}
            onChange={(e) => setFinanceResubmit((d) => ({ ...d, answer: e.target.value }))}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={financeResubmit.saving} onClick={() => setFinanceResubmit({ open: false, answer: '', saving: false })}>Cancel</Button>
          <Button variant="contained" color="warning" disabled={financeResubmit.saving} onClick={handleResubmitToFinance}>
            {financeResubmit.saving ? 'Resubmitting…' : 'Resubmit to Finance'}
          </Button>
        </DialogActions>
      </Dialog>

      {needsFinancePost && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Audit approved but this bill is not in Finance yet. Post it to create Accounts Payable and debit utilities account 6200.
          <Button
            variant="contained"
            size="small"
            sx={{ ml: 1 }}
            disabled={postingFinance}
            onClick={handlePostToFinance}
          >
            {postingFinance ? 'Posting…' : 'Post to Finance'}
          </Button>
        </Alert>
      )}

      <Paper
        elevation={2}
        sx={{
          maxWidth: 1050,
          mx: 'auto',
          p: { xs: 2.25, md: 5 },
          bgcolor: 'background.paper',
          color: '#151515',
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'grey.200',
          boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)'
        }}
      >
        <Box
          textAlign="center"
          sx={{
            lineHeight: 1.12,
            mb: 1.75,
            pb: 1.25,
            borderBottom: '1px solid',
            borderColor: 'grey.200'
          }}
        >
          {isCentralizedStoreInvoice ? (
            <>
              <Typography
                variant="h5"
                sx={{
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontWeight: 700,
                  fontSize: { xs: 20, md: 22 },
                  textTransform: 'none',
                  letterSpacing: 0.2
                }}
              >
                {getStoreInvoiceOrgTitle()}
              </Typography>
              <Typography
                variant="h6"
                sx={{
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontWeight: 700,
                  fontSize: { xs: 16, md: 18 },
                  mt: 0.5
                }}
              >
                {storeDocumentTypeLabel}
              </Typography>
            </>
          ) : (
            <>
              <Typography
                variant="h6"
                sx={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  fontSize: { xs: 17, md: 19 }
                }}
              >
                {getPrimaryHeading()}
              </Typography>
              <Typography
                variant="subtitle1"
                sx={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontWeight: 700,
                  fontSize: { xs: 15, md: 17 }
                }}
              >
                {getSecondaryHeading()}
              </Typography>
            </>
          )}
        </Box>

        <AuditReturnFeedbackSection
          documentId={bill._id}
          visualVariant="settlement"
          auditStatus={bill.auditStatus}
          returnedAuditStatus="Returned from Audit"
          latestReturnHistory={workflowAudit.latestReturnHistory}
          observations={workflowAudit.observations}
          getObservationKey={utilityBillObservationKey}
          formatDateTime={formatDateTime}
          userDisplayName={userDisplayName}
          answerTitle="Administration response:"
          answeredIntro={(
            <>
              Replies below are shown on this bill and in Pre-Audit when you resend. Open observations still need a reply
              in <strong>Resend to Pre-Audit</strong>.
            </>
          )}
          returnedIntro={(
            <>
              This bill was returned for correction. Review the points below, use <strong>Edit Bill</strong> to update the
              memo if needed, then use <strong>Resend to Pre-Audit</strong> when you are ready.
            </>
          )}
        />

        {isCentralizedStoreInvoice ? (
          <>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: { xs: 2, md: 3 },
                mb: 2,
                pb: 2,
                borderBottom: '1px solid',
                borderColor: 'grey.400'
              }}
            >
              <Box sx={{ display: 'grid', gridTemplateColumns: '100px 1fr', rowGap: 0.75, columnGap: 1, fontSize: 13 }}>
                <Typography sx={{ fontWeight: 800, color: 'grey.700' }}>Company</Typography>
                <Typography sx={{ fontWeight: 700 }}>{displayValue(bill.site)}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700' }}>Date</Typography>
                <Typography sx={{ fontWeight: 700 }}>{formatInvoiceDateDmy(bill.billDate)}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700' }}>Bill ID</Typography>
                <Typography sx={{ fontWeight: 700 }}>{bill.billId}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700' }}>
                  {bill.payeeEmployee ? 'Employee' : 'Supplier'}
                </Typography>
                <Typography sx={{ fontWeight: 700 }}>{getVendorSupplierLine()}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700' }}>Payee Name</Typography>
                <Typography sx={{ fontWeight: 700 }}>{getPayeeNameLine()}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700' }}>Address</Typography>
                <Typography sx={{ fontWeight: 700 }}>{displayValue(bill.location)}</Typography>
                <Typography sx={{ fontWeight: 800, color: 'grey.700' }}>Due Date</Typography>
                <Typography sx={{ fontWeight: 700 }}>{formatInvoiceDateDmy(bill.dueDate)}</Typography>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: { xs: 'flex-start', md: 'flex-end' },
                  alignItems: 'baseline',
                  gap: 1,
                  fontSize: 13
                }}
              >
                <Typography sx={{ fontWeight: 800, color: 'grey.700' }}>Time</Typography>
                <Typography sx={{ fontWeight: 700 }}>
                  {formatInvoiceTime12h(bill.createdAt || bill.billDate)}
                </Typography>
              </Box>
            </Box>
            <Box
              sx={{
                bgcolor: '#ffe7c2',
                border: '1px solid #e8b86a',
                p: 1.5,
                mb: 2,
                fontWeight: 700,
                fontSize: 13,
                lineHeight: 1.45
              }}
            >
              Narration: {getStoreInvoiceNarration()}
            </Box>
            <TableContainer sx={{ width: '100%', overflowX: 'auto' }}>
              <Table
                size="small"
                sx={{
                  border: '1px solid',
                  borderColor: 'grey.500',
                  '& th': {
                    bgcolor: 'grey.100',
                    border: '1px solid',
                    borderColor: 'grey.500',
                    fontSize: 11,
                    fontWeight: 800,
                    textAlign: 'center',
                    lineHeight: 1.2,
                    py: 1,
                    px: 0.5
                  },
                  '& td': {
                    border: '1px solid',
                    borderColor: 'grey.400',
                    fontSize: 12,
                    py: 1,
                    px: 0.75,
                    verticalAlign: 'top'
                  }
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: '4%' }}>S. No</TableCell>
                    <TableCell sx={{ width: isCoaBill ? '18%' : '11%' }}>{isCoaBill ? 'Category' : 'Product Code'}</TableCell>
                    <TableCell sx={{ width: isCoaBill ? '25%' : '22%' }}>Description</TableCell>
                    <TableCell sx={{ width: '14%', minWidth: 120 }}>Attachments</TableCell>
                    <TableCell sx={{ width: '7%' }}>Units</TableCell>
                    <TableCell sx={{ width: '9%', textAlign: 'right' }}>Quantity</TableCell>
                    <TableCell sx={{ width: '10%', textAlign: 'right' }}>Rate</TableCell>
                    <TableCell sx={{ width: '12%', textAlign: 'right' }}>Value Excluding Sales Tax</TableCell>
                    <TableCell sx={{ width: '7%', textAlign: 'center' }}>Discount</TableCell>
                    <TableCell sx={{ width: '11%', textAlign: 'right' }}>Net Amount</TableCell>
                    <TableCell sx={{ width: '12%', textAlign: 'right' }}>Amount after Due Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(bill.billLines || []).map((line, i) => {
                    const amt = Number(line.amount) || 0;
                    const duePay = Number(line.duePaymentAmount) || 0;
                    const qty = line.quantity !== undefined ? Number(line.quantity) : 1;
                    const rate = line.unitPrice !== undefined ? Number(line.unitPrice) : amt;
                    const discount = Math.max(0, Number(line.discount) || 0);
                    const valueExTax = Math.max(0, qty * rate);
                    const netAmount = Math.max(0, valueExTax - discount);
                    return (
                      <TableRow key={line._id || line.storeItem || i}>
                        <TableCell sx={{ textAlign: 'center' }}>{i + 1}</TableCell>
                        <TableCell sx={{ wordBreak: 'break-word', fontSize: 11, fontWeight: isCoaBill ? 600 : 400 }}>{getStoreLineProductCode(line)}</TableCell>
                        <TableCell sx={{ lineHeight: 1.35 }}>{getStoreLineDescription(line)}</TableCell>
                        <TableCell>
                          <LineAttachmentsView line={line} />
                        </TableCell>
                        <TableCell sx={{ textAlign: 'center' }}>Nos</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatDecimalPk(qty)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatDecimalPk(rate)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatDecimalPk(valueExTax)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatDecimalPk(discount)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                          {formatDecimalPk(amt || netAmount)}
                        </TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                          {formatDecimalPk(duePay)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow
                    sx={{
                      '& td': {
                        fontWeight: 800,
                        borderTop: '2px solid',
                        borderColor: 'grey.800',
                        bgcolor: 'grey.50'
                      }
                    }}
                  >
                    <TableCell colSpan={7} align="right" sx={{ borderRight: '1px solid', borderColor: 'grey.400' }}>
                      Sub Total
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDecimalPk(
                        (bill.billLines || []).reduce((s, l) => {
                          const qty = l.quantity !== undefined ? Number(l.quantity) : 1;
                          const rate = l.unitPrice !== undefined ? Number(l.unitPrice) : (Number(l.amount) || 0);
                          return s + Math.max(0, qty * rate);
                        }, 0)
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDecimalPk(
                        (bill.billLines || []).reduce((s, l) => s + Math.max(0, Number(l.discount) || 0), 0)
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDecimalPk(getStoreInvoiceLinesTotal())}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDecimalPk(
                        Number(bill.duePaymentAmount) > 0
                          ? bill.duePaymentAmount
                          : (bill.billLines || []).reduce((s, l) => s + (Number(l.duePaymentAmount) || 0), 0)
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
              <Stack spacing={0.35} sx={{ width: 280, fontSize: 12 }}>
                {[
                  'Service Charges',
                  'Freight Charges',
                  'Packing Charges',
                  'Loading Charges',
                  'Income Tax',
                  'Special Excise Duty',
                  'Custom Duty',
                  'Sales Tax'
                ].map((label) => (
                  <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'grey.300', py: 0.35 }}>
                    <Typography component="span" sx={{ fontSize: 12 }}>{label}</Typography>
                    <Typography component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatDecimalPk(0)}</Typography>
                  </Box>
                ))}
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    pt: 1,
                    mt: 0.5,
                    fontWeight: 800,
                    fontSize: 13,
                    borderBottom: '3px double',
                    borderColor: 'grey.900',
                    pb: 0.5
                  }}
                >
                  <Typography component="span">Net Total</Typography>
                  <Typography component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatDecimalPk(getStoreInvoiceLinesTotal())}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    pt: 0.75,
                    fontWeight: 800,
                    fontSize: 13,
                    borderBottom: '3px double',
                    borderColor: 'grey.900',
                    pb: 0.5
                  }}
                >
                  <Typography component="span">Amount after Due Date</Typography>
                  <Typography component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatDecimalPk(
                      Number(bill.duePaymentAmount) > 0
                        ? bill.duePaymentAmount
                        : (bill.billLines || []).reduce((s, l) => s + (Number(l.duePaymentAmount) || 0), 0)
                    )}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          </>
        ) : (
          <>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 170px' },
            alignItems: 'start',
            mb: 3
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr',
              width: { xs: '100%', md: 390 },
              ml: { xs: 0, md: 18 },
              lineHeight: 1.45,
              fontSize: 13
            }}
          >
            <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 13 }}>SITE :</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{displayValue(bill.site || bill.location)}</Typography>
            <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 13 }}>From:</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{displayValue(bill.department)}</Typography>
            <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 13 }}>Custodian:</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{displayValue(bill.custodian)}</Typography>
          </Box>
          <Box
            sx={{
              textAlign: { xs: 'left', md: 'right' },
              lineHeight: 2,
              mt: { xs: 2, md: 0 },
              color: 'grey.800'
            }}
          >
            <Typography sx={{ fontWeight: 800, fontSize: 13 }}>{formatMemoDate(bill.billDate)}</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 13 }}>{bill.billId}</Typography>
          </Box>
        </Box>

        <TableContainer sx={{ width: '100%', overflowX: 'auto' }}>
        <Table
          size="small"
          sx={{
            ...utilityMemoTableSx,
            mt: 1,
            borderTop: '1px solid',
            borderBottom: '1px solid',
            borderColor: 'grey.300',
            '& th': {
              bgcolor: 'grey.50',
              borderBottom: '1px solid',
              borderRight: '1px solid',
              borderColor: 'grey.300',
              p: 1,
              fontSize: 12,
              fontWeight: 800,
              textAlign: 'center',
              color: 'grey.700',
              lineHeight: 1.25
            },
            '& th:last-of-type': {
              borderRight: 0
            },
            '& td': {
              borderBottom: 0,
              borderTop: '1px solid',
              borderRight: '1px solid',
              borderColor: 'grey.200',
              p: 1.25,
              fontSize: 13,
              verticalAlign: 'top'
            },
            '& td:last-of-type': {
              borderRight: 0
            }
          }}
        >
          <colgroup>
            {UTILITY_MEMO_COL_WIDTHS.map((width, colIdx) => (
              <col key={`memo-col-${colIdx}`} style={{ width }} />
            ))}
          </colgroup>
          <TableHead>
            <TableRow>
              {[
                'Date',
                'Reference No',
                'To Whom Paid',
                'For What',
                'Amount',
                'Last Month Amount'
              ].map((label) => (
                <TableCell
                  key={label}
                  sx={{
                    textAlign: label.includes('Amount') ? 'right' : 'center'
                  }}
                >
                  {label === 'Reference No' ? <>Reference<br />No</> : label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={utilityMemoDateCellSx}>
                {formatMemoDate(bill.billDate)}
              </TableCell>
              <TableCell sx={utilityMemoRefCellSx}>{displayValue(bill.accountNumber)}</TableCell>
              <TableCell sx={{ fontWeight: 700, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{displayValue(bill.provider)}</TableCell>
              <TableCell sx={{ fontWeight: 700, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                {getForWhat()}
              </TableCell>
              <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>
                {formatMemoAmount(bill.amount)}
              </TableCell>
              <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>
                {formatMemoAmount(bill.lastMonthAmount)}
              </TableCell>
            </TableRow>

            {[
              ['Grand Total', formatMemoAmount(getGrandTotal())],
              ['Cash Deposit Last Month', formatMemoAmount(bill.lastMonthAmount)],
              ['Balance Amount to be Paid', formatMemoAmount(getBalanceToPay())]
            ].map(([label, value]) => (
              <TableRow key={label}>
                <TableCell colSpan={4} sx={{ p: 0.6, pr: 2, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>
                  {label}
                </TableCell>
                <TableCell sx={{ p: 0.6, pr: 1.25, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>
                  {value}
                </TableCell>
                <TableCell sx={{ borderTop: 0 }} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </TableContainer>
          </>
        )}

        {bill.notes && !isCentralizedStoreInvoice && (
          <Box sx={{ mt: 2, p: 1.5, borderTop: '1px solid', borderColor: 'grey.200', bgcolor: 'grey.50' }}>
            <Typography sx={{ fontWeight: 800, fontSize: 13 }}>Notes</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}>{bill.notes}</Typography>
          </Box>
        )}

        <Table
          size="small"
          sx={{
            mt: 7,
            border: '1px solid',
            borderColor: 'grey.300',
            '& th': {
              bgcolor: 'grey.100',
              fontWeight: 800,
              fontSize: 14,
              borderBottom: '1px solid',
              borderColor: 'grey.300'
            },
            '& td': {
              fontSize: 14,
              borderBottom: '1px solid',
              borderColor: 'grey.200',
              py: 1.4
            },
            '& tr:last-child td': {
              borderBottom: 0
            }
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>Authority</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Digital Signature</TableCell>
              <TableCell>Date &amp; Time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {getApprovalRows().map((row) => (
              <TableRow key={row.authority}>
                <TableCell sx={{ fontWeight: 800 }}>{row.authority}</TableCell>
                <TableCell>{row.name || '-'}</TableCell>
                <TableCell>
                  {getSignatureSource(row) ? (
                    <DigitalSignatureImage userOrPath={getSignatureSource(row)} alt={`${row.authority} signature`} />
                  ) : (
                    row.signature || '-'
                  )}
                </TableCell>
                <TableCell>{row.dateTime || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {getStampRows().length > 0 && (
          <Box sx={{ mt: 3, p: 2.5, border: '2px solid', borderColor: 'grey.300', borderRadius: 1.5, backgroundColor: 'grey.50' }}>
            <Typography sx={{ fontWeight: 900, fontSize: 17, mb: 2 }}>Approval Stamp</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {getStampRows().map((stampRow) => (
                <Box key={stampRow.authority} sx={{ flex: 1, minWidth: 260, p: 2, bgcolor: 'white', border: '1.5px solid', borderColor: 'grey.400', borderRadius: 1.5, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)' }}>
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>{stampRow.authority}</Typography>
                  <Box component="img" src={getImageUrl(stampRow.stampImage)} alt={stampRow.authority} sx={{ display: 'block', maxHeight: 170, width: '100%', objectFit: 'contain', border: '2px dashed', borderColor: 'grey.400', p: 1.5, backgroundColor: '#fff'  }} />
                  <Typography sx={{ mt: 1, fontSize: 12.5, color: 'grey.700' }}>{stampRow.dateTime || '-'}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        )}

        <Box sx={{ mt: 5, minHeight: 120 }} />

        {bill.billImage && (
          <Box sx={{ mt: 3 }}>
            <Typography fontWeight="bold" gutterBottom>Attached Bill Image</Typography>
            <Box
              component="img"
              src={getImageUrl(bill.billImage)}
              alt="Utility Bill"
              onClick={() => {
                billImageZoomPan.resetView();
                setImageModalOpen(true);
              }}
              onError={(e) => handleImageError(e)}
              sx={{ maxWidth: 220, maxHeight: 220, border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
            />
          </Box>
        )}
      </Paper>

      <ResendToPreAuditDialog
        open={workflowAudit.resendDialogOpen}
        onClose={workflowAudit.closeResendDialog}
        submitting={workflowAudit.resendSubmitting}
        observations={workflowAudit.observations}
        getObservationKey={utilityBillObservationKey}
        resendComments={workflowAudit.resendComments}
        onResendCommentsChange={workflowAudit.setResendComments}
        resendAnswers={workflowAudit.resendAnswers}
        onResendAnswerChange={(key, value) =>
          workflowAudit.setResendAnswers((prev) => ({ ...prev, [key]: value }))}
        onSubmit={workflowAudit.handleResendToAudit}
        intro={(
          <>
            Save any memo changes with <strong>Edit Bill</strong> before confirming. Add replies for each open
            observation, then send the bill back to the audit queue.
          </>
        )}
      />

      <Dialog open={submitDialogOpen} onClose={() => setSubmitDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Select Approval Authorities</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Users are filtered by User Management department only (Administration / code ADMIN).
          </Typography>
          <Autocomplete
            options={managerSubmitOptions}
            value={managerApprover}
            loading={approverLoading}
            onChange={(_, value) => setManagerApprover(value)}
            onOpen={() => loadApproverOptions('')}
            onInputChange={approverSearchOnInputChange(loadApproverOptions)}
            getOptionLabel={(option) => userDisplayName(option)}
            isOptionEqualToValue={(option, value) => option._id === value._id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Manager Approver"
                placeholder="Search manager approver"
                margin="normal"
              />
            )}
          />
          <Autocomplete
            options={hodSubmitOptions}
            value={hodApprover}
            loading={approverLoading}
            onChange={(_, value) => setHodApprover(value)}
            onOpen={() => loadApproverOptions('')}
            onInputChange={approverSearchOnInputChange(loadApproverOptions)}
            getOptionLabel={(option) => userDisplayName(option)}
            isOptionEqualToValue={(option, value) => option._id === value._id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Head Of Department Approver"
                placeholder="Search HOD approver"
                margin="normal"
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubmitDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" startIcon={<SendIcon />} onClick={handleSubmitForApproval}>
            Submit for Approval
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={imageModalOpen} onClose={() => setImageModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Bill Image
          <Box sx={{ position: 'absolute', right: 48, top: 8 }}>
            <ZoomPanImageToolbar
              onZoomIn={billImageZoomPan.zoomIn}
              onZoomOut={billImageZoomPan.zoomOut}
              onReset={billImageZoomPan.resetView}
            />
          </Box>
          <IconButton onClick={() => setImageModalOpen(false)} sx={{ position: 'absolute', right: 8, top: 8 }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={billImageZoomPan.containerSx} {...billImageZoomPan.containerHandlers}>
          {bill.billImage && (
            <Box
              component="img"
              src={getImageUrl(bill.billImage)}
              alt="Utility Bill"
              onError={(e) => handleImageError(e)}
              onMouseDown={billImageZoomPan.startDrag}
              sx={{
                ...billImageZoomPan.imageSx,
                width: '100%'
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UtilityBillDetails;
