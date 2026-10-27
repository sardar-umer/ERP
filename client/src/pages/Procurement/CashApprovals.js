import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Paper, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TablePagination, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  MenuItem, Tooltip, Chip, Alert, Stack, Divider, Grid,
  CircularProgress, Autocomplete, Stepper, Step, StepLabel,
  Card, CardContent, alpha, useTheme, useMediaQuery, Popper, Avatar
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Visibility as ViewIcon, Refresh as RefreshIcon,
  CheckCircle as ApproveIcon, Cancel as RejectIcon,
  Print as PrintIcon, Send as SendIcon, Undo as ReturnIcon,
  ArrowForward as ForwardIcon, MonetizationOn as CashIcon,
  Done as CompleteIcon,
  Search as SearchIcon, History as HistoryIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import procurementService from '../../services/procurementService';
import { formatDate } from '../../utils/dateUtils';
import WorkflowHistoryDialog from '../../components/WorkflowHistoryDialog';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import { formatPKR } from '../../utils/currency';
import { useAuth } from '../../contexts/AuthContext';
import CashApprovalDetailTabsView from '../../components/Procurement/CashApprovalDetailTabsView';
import CashApprovalGeneralDetailShell from '../../components/CashApprovals/CashApprovalGeneralDetailShell';
import { isGeneralModuleCashApproval } from '../../components/CashApprovals/cashApprovalGeneralDocumentUtils';
import CashApprovalAdvancePaymentDialog from '../../components/CashApprovals/CashApprovalAdvancePaymentDialog';
import CashApprovalPaymentFieldsView from '../../components/CashApprovals/CashApprovalPaymentFieldsView';
import { useCashApprovalPaymentFields } from '../../components/CashApprovals/useCashApprovalPaymentFields';
import NarrationTableCell from '../../components/common/NarrationTableCell';
import { getCashApprovalNarrationDisplay } from '../../utils/documentNarrationDisplay';
import LineAttachmentCell from '../../components/common/LineAttachmentCell';
import {
  appendCashApprovalLineAttachmentsToFormData,
  emptyCashApprovalLine,
  serializeCashApprovalItemsForSubmit
} from '../../utils/cashApprovalFormAttachments';
import { resolveUploadPublicUrl } from '../../components/CashApprovals/cashApprovalGeneralDocumentUtils';

// ─── Status helpers ───────────────────────────────────────────────────────────
const STATUS_COLORS = {
  'Draft': 'default',
  'Pending Approval': 'warning',
  'Pending Audit': 'warning',
  'Forwarded to Audit Director': 'info',
  'Send to CEO Office': 'info',
  'Forwarded to CEO': 'info',
  'Pending Finance': 'warning',
  'Finance Authority Approved': 'info',
  'Advance Issued': 'primary',
  'Payment Settled': 'success',
  'Sent to Procurement': 'success',
  'Completed': 'success',
  'Cancelled': 'default',
  'Rejected': 'error',
  'Returned from Audit': 'warning',
  'Returned from CEO Office': 'warning',
  'Returned from CEO Secretariat': 'warning'
};

const CA_APPROVAL_AUTHORITY_FIELDS = [
  { key: 'preparedBy', label: 'Prepared By' },
  { key: 'verifiedBy', label: 'Verified By (Procurement Committee)' },
  { key: 'authorisedRep', label: 'Authorised Rep.' },
  { key: 'financeRep', label: 'Finance Rep.' },
  { key: 'managerProcurement', label: 'Manager Procurement' }
];

const WidePopper = (props) => {
  const { style, ...rest } = props;
  return (
    <Popper
      {...rest}
      placement="bottom-start"
      style={{
        width: typeof window !== 'undefined' && window.innerWidth < 900 ? 'calc(100vw - 32px)' : 720,
        ...style
      }}
    />
  );
};

const WORKFLOW_STEPS = [
  'Draft', 'Pending Approval', 'Pending Audit', 'Forwarded to Audit Director',
  'Send to CEO Office', 'Forwarded to CEO', 'Pending Finance',
  'Finance Authority Approved', 'Advance Issued', 'Payment Settled', 'Sent to Procurement', 'Completed'
];

const FINANCE_EDITABLE_STATUSES = [
  'Pending Finance'
];

const PROCUREMENT_EDITABLE_STATUSES = [
  'Draft',
  'Rejected',
  'Returned from Audit',
  'Returned from CEO Office',
  'Returned from CEO Secretariat'
];

const PROCUREMENT_RESUBMIT_LABEL = {
  'Returned from Audit': 'Resubmit to Pre-Audit',
  'Returned from CEO Office': 'Resubmit to CEO',
  'Returned from CEO Secretariat': 'Resubmit to CEO Secretariat',
  Rejected: 'Resubmit'
};

const getProcurementResubmitLabel = (ca) => {
  if (ca?.status === 'Rejected') {
    const from = ca?.returnedFromStatus || '';
    if (from === 'Forwarded to CEO') return 'Resubmit to CEO';
    if (from === 'Send to CEO Office') return 'Resubmit to CEO Secretariat';
    if (from === 'Pending Finance') return 'Resubmit to Finance';
    if (from === 'Pending Approval') return 'Resubmit to Authority';
    if (from === 'Pending Audit' || from === 'Forwarded to Audit Director') return 'Resubmit to Pre-Audit';
  }
  return PROCUREMENT_RESUBMIT_LABEL[ca?.status] || 'Resubmit';
};

const EMPTY_FINANCE_EDIT_FORM = {
  notes: '',
  internalNotes: '',
  purpose: '',
  accountsOfficerUser: null,
  accountsManagerUser: null,
  financeControllerUser: null,
  signedCheckNumber: '',
  signedCheckDate: '',
  signedCheckBankName: '',
  signedCheckRemarks: '',
  advanceAmount: '',
  advanceRemarks: '',
  financeVerificationNotes: '',
  settlementRemarks: ''
};

const getStepIndex = (status) => {
  const idx = WORKFLOW_STEPS.indexOf(status);
  return idx >= 0 ? idx : 0;
};

const EMPTY_FORM = {
  companyId: '', vendor: '', approvalDate: new Date().toISOString().split('T')[0],
  expectedPurchaseDate: '', deliveryAddress: '', priority: 'Urgent',
  items: [emptyCashApprovalLine()],
  shippingCost: 0, notes: ''
};

// ─── Main Component ───────────────────────────────────────────────────────────
/**
 * `embedCaId` (Vendor Payments hub): mount hidden and open this page's own Finance step for that cash approval
 * (Create Voucher / Approve / Post Payment / Settle Payment); `onEmbedClose` runs when its dialog closes.
 */
const EMBED_FINANCE_ACTIONS = ['create-voucher', 'finance-approve', 'issue-advance', 'settle-payment'];

const CashApprovalsPage = ({ embedCaId = null, embedViewCaId = null, onEmbedClose = null } = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isFinanceModule = Boolean(embedCaId || embedViewCaId) || location.pathname.startsWith('/finance/cash-approvals');

  const [approvalAuthority, setApprovalAuthority] = useState({
    preparedBy: '',
    verifiedBy: '',
    authorisedRep: '',
    financeRep: '',
    managerProcurement: ''
  });
  const authoritySearchDebounceRef = useRef(null);
  const [authoritySearchOptions, setAuthoritySearchOptions] = useState([]);
  const [authoritySearchLoading, setAuthoritySearchLoading] = useState(false);
  const [observationAnswers, setObservationAnswers] = useState({});

  const loadAuthorityApproverOptions = useCallback(async (q) => {
    try {
      setAuthoritySearchLoading(true);
      const res = await api.get('/indents/approver-candidates', {
        params: { search: q || '', limit: 50 }
      });
      setAuthoritySearchOptions(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      setAuthoritySearchOptions([]);
    } finally {
      setAuthoritySearchLoading(false);
    }
  }, []);

  const approverLabel = (u) => {
    if (!u) return '';
    const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return n || u.email || u.employeeId || '';
  };

  const handleAuthoritySearchInput = (value) => {
    if (authoritySearchDebounceRef.current) clearTimeout(authoritySearchDebounceRef.current);
    authoritySearchDebounceRef.current = setTimeout(() => {
      loadAuthorityApproverOptions(value);
    }, 300);
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cashApprovals, setCashApprovals] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statistics, setStatistics] = useState(null);

  // Dialogs
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', data: null });
  const [financeEditDialog, setFinanceEditDialog] = useState({ open: false, data: null });
  const [financeEditForm, setFinanceEditForm] = useState(EMPTY_FINANCE_EDIT_FORM);
  const [financeEditLoading, setFinanceEditLoading] = useState(false);

  const loadFinanceEditFormFromCa = useCallback((ca) => {
    const fa = ca?.financeApprovalAuthorities || {};
    setFinanceEditForm({
      notes: ca?.notes || '',
      internalNotes: ca?.internalNotes || '',
      purpose: ca?.purpose || '',
      accountsOfficerUser: fa.accountsOfficerUser?._id || fa.accountsOfficerUser || null,
      accountsManagerUser: fa.accountsManagerUser?._id || fa.accountsManagerUser || null,
      financeControllerUser: fa.financeControllerUser?._id || fa.financeControllerUser || null,
      signedCheckNumber: ca?.signedCheckNumber || '',
      signedCheckDate: ca?.signedCheckDate ? new Date(ca.signedCheckDate).toISOString().split('T')[0] : '',
      signedCheckBankName: ca?.signedCheckBankName || '',
      signedCheckRemarks: ca?.signedCheckRemarks || '',
      advanceAmount: ca?.advanceAmount || ca?.totalAmount || '',
      advanceRemarks: ca?.advanceRemarks || '',
      financeVerificationNotes: ca?.financeVerificationNotes || '',
      settlementRemarks: ca?.settlementRemarks || ''
    });
  }, []);

  const [viewDialog, setViewDialog] = useState({ open: false, data: null, tab: 0, quotations: [], linkedDocs: [] });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: null });
  const [actionDialog, setActionDialog] = useState({ open: false, type: '', ca: null });
  const [workflowHistoryDialog, setWorkflowHistoryDialog] = useState({ open: false, document: null });

  useEffect(() => {
    if (!formDialog.open) return;
    loadAuthorityApproverOptions('');
  }, [formDialog.open, loadAuthorityApproverOptions]);

  // Action form state
  const [actionComments, setActionComments] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Form data
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);
  const [prefillQuotationId, setPrefillQuotationId] = useState(null);

  const userHasModuleAccess = useCallback((moduleKey) => {
    const hasInRoleDoc = (roleDoc) => roleDoc?.isActive && Array.isArray(roleDoc?.permissions) &&
      roleDoc.permissions.some((p) => p?.module === moduleKey);
    if (hasInRoleDoc(user?.roleRef)) return true;
    if (Array.isArray(user?.roles) && user.roles.some((r) => hasInRoleDoc(r))) return true;
    return false;
  }, [user]);

  const canViewFinanceOnlyTabs = ['super_admin', 'admin', 'finance_manager'].includes(user?.role) || userHasModuleAccess('finance');

  const canFinanceEditCashApproval = useCallback((ca) => (
    FINANCE_EDITABLE_STATUSES.includes(ca?.status) && canViewFinanceOnlyTabs
  ), [canViewFinanceOnlyTabs]);

  const canProcurementEditCashApproval = useCallback((ca) => (
    PROCUREMENT_EDITABLE_STATUSES.includes(ca?.status)
  ), []);

  const canEditCashApproval = useCallback((ca) => {
    if (isFinanceModule) return canFinanceEditCashApproval(ca);
    return canProcurementEditCashApproval(ca);
  }, [isFinanceModule, canFinanceEditCashApproval, canProcurementEditCashApproval]);

  const loadStatistics = useCallback(async () => {
    try {
      const res = await procurementService.getCashApprovalStats();
      setStatistics(res?.success ? res.data : null);
    } catch {
      setStatistics(null);
    }
  }, []);

  // ─── Load data ──────────────────────────────────────────────────────────────
  const loadCashApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await procurementService.getCashApprovals({
        page: page + 1,
        limit: rowsPerPage,
        search,
        status: statusFilter,
        ...(priorityFilter ? { priority: priorityFilter } : {})
      });
      setCashApprovals(res.data || []);
      setTotal(res.total || 0);
    } catch (err) {
      setError('Failed to load cash approvals');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, statusFilter, priorityFilter]);

  const refreshList = useCallback(() => {
    loadCashApprovals();
    loadStatistics();
  }, [loadCashApprovals, loadStatistics]);

  const [companies, setCompanies] = useState([]);

  const loadVendors = useCallback(async () => {
    try {
      const res = await procurementService.getVendors({ limit: 500 });
      const list = res?.data?.vendors ?? res?.vendors;
      setVendors(Array.isArray(list) ? list : []);
    } catch {
      setVendors([]);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      let res = await api.get('/indents/companies');
      let list = Array.isArray(res?.data?.data) ? res.data.data : Array.isArray(res?.data) ? res.data : [];
      if (!list.length) {
        res = await api.get('/hr/companies');
        list = Array.isArray(res?.data?.data) ? res.data.data : Array.isArray(res?.data) ? res.data : [];
      }
      setCompanies(list);
    } catch {
      setCompanies([]);
    }
  }, []);

  useEffect(() => { loadCashApprovals(); }, [loadCashApprovals]);
  useEffect(() => { loadStatistics(); }, [loadStatistics]);
  useEffect(() => { loadVendors(); }, [loadVendors]);
  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  // Pre-fill from quotation (when navigated from Quotations page)
  useEffect(() => {
    if (location.state?.createFromQuotationId) {
      const qId = location.state.createFromQuotationId;
      setPrefillQuotationId(qId);
      setFormDialog({ open: true, mode: 'create', data: null });
      // Clear the state so back navigation doesn't re-trigger
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // When form opens for create with a quotation ID, pre-fetch quotation
  useEffect(() => {
    if (formDialog.open && formDialog.mode === 'create' && prefillQuotationId) {
      (async () => {
        try {
          const res = await api.get(`/procurement/quotations/${prefillQuotationId}`);
          const q = res.data?.data || res.data;
          if (!q) return;
          const items = (q.items || []).map((item) => ({
            ...emptyCashApprovalLine(),
            description: item.description || item.name || '',
            specification: item.specification || '',
            brand: item.brand || '',
            quantity: item.quantity || 1,
            unit: item.unit || 'pcs',
            unitPrice: item.unitPrice || item.price || 0,
            taxRate: item.taxRate || 0,
            discount: item.discount || 0,
            amount: ((item.quantity || 1) * (item.unitPrice || item.price || 0)) - (item.discount || 0)
          }));
          const csa = q.indent?.comparativeStatementApprovals || {};
          setFormData({
            ...EMPTY_FORM,
            vendor: q.vendor?._id || q.vendor || '',
            items: items.length ? items : EMPTY_FORM.items,
            notes: q.notes || ''
          });
          setApprovalAuthority({
            preparedBy: approverLabel(user) || '',
            verifiedBy: csa.verifiedBy || '',
            authorisedRep: csa.authorisedRep || '',
            financeRep: csa.financeRep || '',
            managerProcurement: csa.managerProcurement || ''
          });
        } catch { /* ignore, user can fill manually */ }
      })();
    } else if (formDialog.open && formDialog.mode === 'create' && !prefillQuotationId) {
      setFormData(EMPTY_FORM);
      setApprovalAuthority({
        preparedBy: approverLabel(user) || '',
        verifiedBy: '',
        authorisedRep: '',
        financeRep: '',
        managerProcurement: ''
      });
    } else if (formDialog.open && ['edit', 'finance-edit'].includes(formDialog.mode) && formDialog.data) {
      const ca = formDialog.data;
      setFormData({
        companyId: ca.companyId?._id || ca.companyId || '',
        vendor: ca.vendor?._id || ca.vendor || '',
        approvalDate: ca.approvalDate ? new Date(ca.approvalDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        expectedPurchaseDate: ca.expectedPurchaseDate ? new Date(ca.expectedPurchaseDate).toISOString().split('T')[0] : '',
        deliveryAddress: ca.deliveryAddress || '',
        priority: ca.priority || 'Urgent',
        items: (ca.items || []).map((item) => ({
          ...emptyCashApprovalLine(),
          ...item,
          attachments: item.attachments || [],
          _pendingFiles: []
        })),
        shippingCost: ca.shippingCost || 0,
        notes: ca.notes || ''
      });
      const approvals = ca.approvalAuthorities || {};
      setApprovalAuthority({
        preparedBy: approvals.preparedBy || '',
        verifiedBy: approvals.verifiedBy || '',
        authorisedRep: approvals.authorisedRep || '',
        financeRep: approvals.financeRep || '',
        managerProcurement: approvals.managerProcurement || ''
      });
      if (ca.auditObservations && ca.auditObservations.length > 0) {
        const answers = {};
        ca.auditObservations.forEach((obs) => {
          if (obs.answer) answers[obs._id] = obs.answer;
        });
        setObservationAnswers(answers);
      } else {
        setObservationAnswers({});
      }
      if (formDialog.mode === 'finance-edit') {
        loadFinanceEditFormFromCa(ca);
      }
    }
  }, [formDialog.open, formDialog.mode, formDialog.data, prefillQuotationId, user, loadFinanceEditFormFromCa]);

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const clearMessages = () => { setError(''); setSuccess(''); };

  const openCashApprovalEdit = async (ca) => {
    clearMessages();
    try {
      const res = await procurementService.getCashApprovalById(ca._id);
      const doc = res?.success ? res.data : ca;
      if (isFinanceModule && canFinanceEditCashApproval(doc) && isGeneralModuleCashApproval(doc)) {
        loadFinanceEditFormFromCa(doc);
        setFinanceEditDialog({ open: true, data: doc });
        return;
      }
      if (isFinanceModule && canFinanceEditCashApproval(doc)) {
        loadFinanceEditFormFromCa(doc);
        setFormDialog({ open: true, mode: 'finance-edit', data: doc });
        return;
      }
      setFormDialog({ open: true, mode: 'edit', data: doc });
    } catch {
      if (isFinanceModule && canFinanceEditCashApproval(ca) && isGeneralModuleCashApproval(ca)) {
        loadFinanceEditFormFromCa(ca);
        setFinanceEditDialog({ open: true, data: ca });
      } else {
        setFormDialog({ open: true, mode: isFinanceModule && canFinanceEditCashApproval(ca) ? 'finance-edit' : 'edit', data: ca });
        if (isFinanceModule && canFinanceEditCashApproval(ca)) loadFinanceEditFormFromCa(ca);
      }
    }
  };

  const appendFinanceEditFields = (fd) => {
    fd.append('internalNotes', financeEditForm.internalNotes || '');
    fd.append('financeApprovalAuthorities', JSON.stringify({
      accountsOfficerUser: financeEditForm.accountsOfficerUser || null,
      accountsManagerUser: financeEditForm.accountsManagerUser || null,
      financeControllerUser: financeEditForm.financeControllerUser || null
    }));
    fd.append('signedCheckNumber', financeEditForm.signedCheckNumber || '');
    fd.append('signedCheckDate', financeEditForm.signedCheckDate || '');
    fd.append('signedCheckBankName', financeEditForm.signedCheckBankName || '');
    fd.append('signedCheckRemarks', financeEditForm.signedCheckRemarks || '');
    fd.append('advanceAmount', String(financeEditForm.advanceAmount || ''));
    fd.append('advanceRemarks', financeEditForm.advanceRemarks || '');
    fd.append('financeVerificationNotes', financeEditForm.financeVerificationNotes || '');
    fd.append('settlementRemarks', financeEditForm.settlementRemarks || '');
  };

  const buildFinanceEditPayload = () => ({
    notes: financeEditForm.notes || '',
    purpose: financeEditForm.purpose || '',
    internalNotes: financeEditForm.internalNotes || '',
    financeApprovalAuthorities: {
      accountsOfficerUser: financeEditForm.accountsOfficerUser || null,
      accountsManagerUser: financeEditForm.accountsManagerUser || null,
      financeControllerUser: financeEditForm.financeControllerUser || null
    },
    signedCheckNumber: financeEditForm.signedCheckNumber || '',
    signedCheckDate: financeEditForm.signedCheckDate || '',
    signedCheckBankName: financeEditForm.signedCheckBankName || '',
    signedCheckRemarks: financeEditForm.signedCheckRemarks || '',
    advanceAmount: financeEditForm.advanceAmount || '',
    advanceRemarks: financeEditForm.advanceRemarks || '',
    financeVerificationNotes: financeEditForm.financeVerificationNotes || '',
    settlementRemarks: financeEditForm.settlementRemarks || ''
  });

  const handleFinanceEditSubmit = async () => {
    const id = financeEditDialog.data?._id;
    if (!id) return;
    clearMessages();
    setFinanceEditLoading(true);
    try {
      await procurementService.updateCashApproval(id, buildFinanceEditPayload());
      setSuccess('Cash Approval updated successfully');
      setFinanceEditDialog({ open: false, data: null });
      setFinanceEditForm(EMPTY_FINANCE_EDIT_FORM);
      refreshList();
      if (viewDialog.open && viewDialog.data?._id === id) {
        const res = await procurementService.getCashApprovalById(id);
        if (res?.success) setViewDialog((prev) => ({ ...prev, data: res.data }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update Cash Approval');
    } finally {
      setFinanceEditLoading(false);
    }
  };

  const renderFinanceEditFields = (caStatus, { includePurpose = false, includeNotes = false } = {}) => (
    <>
      {(includePurpose || includeNotes) && (
        <>
          {includePurpose && (
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Purpose"
                value={financeEditForm.purpose}
                onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, purpose: e.target.value }))}
                multiline
                minRows={2}
              />
            </Grid>
          )}
          {includeNotes && (
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes"
                value={financeEditForm.notes}
                onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                multiline
                minRows={2}
              />
            </Grid>
          )}
        </>
      )}
      <Grid item xs={12}>
        <TextField
          fullWidth
          label="Internal Notes"
          value={financeEditForm.internalNotes}
          onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, internalNotes: e.target.value }))}
          multiline
          minRows={2}
        />
      </Grid>
      {['Pending Finance', 'Finance Authority Approved'].includes(caStatus) && (
        <>
          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" fontWeight={600}>Finance Approval Authorities</Typography>
          </Grid>
          {[
            { key: 'accountsOfficerUser', label: 'Accounts Officer / AM' },
            { key: 'accountsManagerUser', label: 'Sr Manager Accounts' },
            { key: 'financeControllerUser', label: 'GM Finance' }
          ].map((slot) => (
            <Grid item xs={12} md={4} key={slot.key}>
              <Autocomplete
                options={financeAuthorityUsers}
                value={financeAuthorityUsers.find((u) => String(u?._id || u?.id || '') === String(financeEditForm[slot.key] || '')) || null}
                getOptionLabel={(u) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u.employeeId || ''}
                onChange={(_, v) => setFinanceEditForm((prev) => ({ ...prev, [slot.key]: String(v?._id || v?.id || '').trim() || null }))}
                renderInput={(params) => <TextField {...params} label={slot.label} size="small" />}
              />
            </Grid>
          ))}
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              type="number"
              label="Advance Amount"
              value={financeEditForm.advanceAmount}
              onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, advanceAmount: e.target.value }))}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Advance Remarks"
              value={financeEditForm.advanceRemarks}
              onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, advanceRemarks: e.target.value }))}
            />
          </Grid>
        </>
      )}
      {['Advance Issued', 'Evidence Submitted', 'Payment Settled', 'Finance Authority Approved'].includes(caStatus) && (
        <>
          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" fontWeight={600}>Signed Check / Payment Details</Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Check / Reference No."
              value={financeEditForm.signedCheckNumber}
              onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, signedCheckNumber: e.target.value }))}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              type="date"
              label="Check / Payment Date"
              value={financeEditForm.signedCheckDate}
              onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, signedCheckDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Bank Name"
              value={financeEditForm.signedCheckBankName}
              onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, signedCheckBankName: e.target.value }))}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Payment Remarks"
              value={financeEditForm.signedCheckRemarks}
              onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, signedCheckRemarks: e.target.value }))}
            />
          </Grid>
        </>
      )}
      {['Evidence Submitted', 'Payment Settled'].includes(caStatus) && (
        <>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Finance Verification Notes"
              value={financeEditForm.financeVerificationNotes}
              onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, financeVerificationNotes: e.target.value }))}
              multiline
              minRows={2}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Settlement Remarks"
              value={financeEditForm.settlementRemarks}
              onChange={(e) => setFinanceEditForm((prev) => ({ ...prev, settlementRemarks: e.target.value }))}
              multiline
              minRows={2}
            />
          </Grid>
        </>
      )}
    </>
  );
  const computeItemAmount = (item) => ((item.quantity || 0) * (item.unitPrice || 0)) - (item.discount || 0);
  const computeSubtotal = (items) => items.reduce((s, i) => s + computeItemAmount(i), 0);
  const computeTotal = (items, shippingCost) => {
    const sub = computeSubtotal(items);
    const tax = items.reduce((s, i) => {
      const base = computeItemAmount(i);
      return s + base * (i.taxRate || 0) / 100;
    }, 0);
    return sub + tax + (parseFloat(shippingCost) || 0);
  };

  const calculateFormTotal = () => computeTotal(formData.items, formData.shippingCost);

  const buildLinkedDocs = (doc) => {
    const linkedDocuments = [];
    const pushDocs = (items = [], source = 'Attachment') => {
      items.forEach((item, idx) => {
        const url = item?.url || '';
        const name = item?.originalName || item?.filename || `Document ${idx + 1}`;
        if (!name && !url) return;
        linkedDocuments.push({
          id: item?._id || `${source}-${idx}`,
          source,
          name,
          url,
          uploadedAt: item?.uploadedAt || null,
          mimeType: item?.mimeType || ''
        });
      });
    };
    pushDocs(doc?.attachments, 'General Attachment');
    pushDocs(doc?.purchaseReceipts, 'Purchase Receipt');
    pushDocs(doc?.signedCheckAttachments, 'Signed Check Evidence');
    pushDocs(doc?.receiptAttachments, 'Settlement Receipt');
    if (doc?.voucherEntryId) {
      linkedDocuments.push({
        id: String(doc?.voucherEntryId?._id || doc?.voucherEntryId || 'voucher-linked'),
        source: 'Voucher',
        name: doc?.voucherEntryId?.entryNumber || doc?.advanceVoucherNo || 'Linked Voucher',
        url: doc?.voucherEntryId?._id ? `/finance/vouchers/${doc.voucherEntryId._id}` : '',
        uploadedAt: doc?.voucherEntryId?.date || null,
        mimeType: 'application/x-voucher-link'
      });
    }
    return linkedDocuments;
  };

  const getPriorityColor = (priority) => {
    const colors = { Low: 'info', Medium: 'default', High: 'warning', Urgent: 'error' };
    return colors[priority] || 'default';
  };

  const getCaStatusChipColor = (status) => STATUS_COLORS[status] || 'default';

  // ─── Form handlers ────────────────────────────────────────────────────────────
  const handleItemChange = (idx, field, value) => {
    const items = [...formData.items];
    items[idx] = { ...items[idx], [field]: value };
    items[idx].amount = computeItemAmount(items[idx]);
    setFormData({ ...formData, items });
  };
  const addItem = () => setFormData({ ...formData, items: [...formData.items, emptyCashApprovalLine()] });

  const updateFormItem = (idx, patch) => {
    const items = [...formData.items];
    items[idx] = { ...items[idx], ...patch };
    if (patch.quantity != null || patch.unitPrice != null || patch.discount != null) {
      items[idx].amount = computeItemAmount(items[idx]);
    }
    setFormData({ ...formData, items });
  };

  const buildCashApprovalFormData = () => {
    const fd = new FormData();
    if (formData.companyId) fd.append('companyId', formData.companyId);
    fd.append('vendor', formData.vendor);
    fd.append('approvalDate', formData.approvalDate);
    fd.append('expectedPurchaseDate', formData.expectedPurchaseDate);
    fd.append('deliveryAddress', formData.deliveryAddress || '');
    fd.append('priority', formData.priority);
    fd.append('shippingCost', String(formData.shippingCost || 0));
    fd.append('notes', formData.notes || '');
    fd.append('approvalAuthorities', JSON.stringify({ ...approvalAuthority }));
    fd.append('items', JSON.stringify(serializeCashApprovalItemsForSubmit(formData.items)));
    appendCashApprovalLineAttachmentsToFormData(fd, formData.items);
    if (prefillQuotationId && formDialog.mode === 'create') {
      fd.append('quotationId', prefillQuotationId);
    }
    return fd;
  };
  const removeItem = (idx) => setFormData({ ...formData, items: formData.items.filter((_, i) => i !== idx) });

  const handleFormSubmit = async () => {
    clearMessages();
    if (!formData.vendor) return setError('Vendor is required');
    if (!formData.expectedPurchaseDate) return setError('Expected purchase date is required');
    if (!formData.items.length || !formData.items[0].description) return setError('At least one item is required');
    setFormLoading(true);
    try {
      const payload = buildCashApprovalFormData();
      if (formDialog.mode === 'create') {
        await procurementService.createCashApproval(payload);
        setSuccess('Cash Approval created successfully');
        setPrefillQuotationId(null);
      } else {
        if (formDialog.mode === 'finance-edit') appendFinanceEditFields(payload);
        await procurementService.updateCashApproval(formDialog.data._id, payload);
        setSuccess('Cash Approval updated successfully');
      }
      setFormDialog({ open: false, mode: 'create', data: null });
      setObservationAnswers({});
      refreshList();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save Cash Approval');
    } finally {
      setFormLoading(false);
    }
  };

  // ─── Action handlers ──────────────────────────────────────────────────────────
  const [advancePaymentDialog, setAdvancePaymentDialog] = useState({ open: false, ca: null });
  const openAction = (type, ca) => {
    if (type === 'issue-advance' && isGeneralModuleCashApproval(ca)) {
      setAdvancePaymentDialog({ open: true, ca });
      return;
    }
    setActionDialog({ open: true, type, ca });
    setActionComments('');
  };
  const closeAction = () => { setActionDialog({ open: false, type: '', ca: null }); setActionComments(''); };

  const buildObservationAnswerPayload = (ca) => {
    if (!ca?.auditObservations?.length) return null;
    const answers = ca.auditObservations
      .filter((obs) => observationAnswers[obs._id] && String(observationAnswers[obs._id]).trim())
      .map((obs) => ({ observationId: obs._id, answer: String(observationAnswers[obs._id]).trim() }));
    return answers.length ? answers : null;
  };

  const handleSendToAudit = async (id, ca = null) => {
    clearMessages();
    try {
      const payload = { comments: 'Sent to Pre-Audit' };
      const answers = buildObservationAnswerPayload(ca);
      if (answers) payload.observationAnswers = answers;
      await procurementService.caSendToAudit(id, payload);
      setSuccess('Cash approval sent to audit successfully. It will appear on the Pre-Audit page.');
      setObservationAnswers({});
      refreshList();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send cash approval to audit');
    }
  };

  const handleResubmitAfterReturn = async (ca) => {
    if (!ca?._id) return;
    clearMessages();
    try {
      const payload = { comments: `${getProcurementResubmitLabel(ca)} (prior approvals preserved)` };
      const answers = buildObservationAnswerPayload(ca);
      if (answers) payload.observationAnswers = answers;
      const res = await procurementService.caResubmitAfterReturn(ca._id, payload);
      setSuccess(res?.message || 'Cash approval resubmitted successfully.');
      setObservationAnswers({});
      refreshList();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resubmit cash approval');
    }
  };

  const handleAction = async (extraData = {}) => {
    clearMessages();
    setActionLoading(true);
    const { type, ca } = actionDialog;
    try {
      let actionRes = null;
      switch (type) {
        case 'send-to-audit': {
          const payload = { comments: actionComments || 'Sent to Pre-Audit' };
          const answers = buildObservationAnswerPayload(ca);
          if (answers) payload.observationAnswers = answers;
          actionRes = await procurementService.caSendToAudit(ca._id, payload);
          setObservationAnswers({});
          break;
        }
        case 'resubmit-after-return': {
          const payload = {
            comments: actionComments || `${getProcurementResubmitLabel(ca)} (prior approvals preserved)`
          };
          const answers = buildObservationAnswerPayload(ca);
          if (answers) payload.observationAnswers = answers;
          actionRes = await procurementService.caResubmitAfterReturn(ca._id, payload);
          setObservationAnswers({});
          break;
        }
        case 'approve': actionRes = await procurementService.caApprove(ca._id, { comments: actionComments }); break;
        case 'reject': actionRes = await procurementService.caReject(ca._id, { rejectionComments: actionComments, comments: actionComments }); break;
        case 'audit-approve': actionRes = await procurementService.caAuditApprove(ca._id, { comments: actionComments, approvalComments: actionComments }); break;
        case 'forward-to-audit-director': actionRes = await procurementService.caForwardToAuditDirector(ca._id, actionComments); break;
        case 'audit-reject': actionRes = await procurementService.caAuditReject(ca._id, { rejectionComments: actionComments, comments: actionComments }); break;
        case 'audit-return': actionRes = await procurementService.caAuditReturn(ca._id, { returnComments: actionComments, comments: actionComments }); break;
        case 'forward-to-ceo': actionRes = await procurementService.caForwardToCeo(ca._id, actionComments); break;
        case 'ceo-secretariat-return': actionRes = await procurementService.caCeoSecretariatReturn(ca._id, actionComments); break;
        case 'ceo-approve': actionRes = await procurementService.caCeoApprove(ca._id, { comments: actionComments, ...extraData }); break;
        case 'ceo-reject': actionRes = await procurementService.caCeoReject(ca._id, actionComments); break;
        case 'ceo-return': actionRes = await procurementService.caCeoReturn(ca._id, actionComments); break;
        case 'issue-advance': actionRes = await procurementService.caIssueAdvance(ca._id, extraData); break;
        case 'create-voucher': {
          const isGeneral = isGeneralModuleCashApproval(ca);
          if (isGeneral && !String(generalPayment.paymentData.reference || '').trim()) {
            setError('Reference / Cheque # / TT # is required');
            setActionLoading(false);
            return;
          }
          const payRows = isGeneral ? generalPayment.getAllocationRows() : [];
          const rowForCa = payRows.find((r) => String(r.cashApprovalId) === String(ca._id));
          const advanceAmount = isGeneral
            ? (rowForCa?.amount || parseFloat(generalPayment.paymentData.amount || 0))
            : parseFloat(advanceForm.advanceAmount || 0);
          actionRes = await procurementService.caCreateVoucher(ca._id, {
            comments: actionComments,
            remarks: advanceForm.advanceRemarks || generalPayment.paymentData.advanceRemarks || '',
            voucherType: String(advanceForm.voucherType || 'PAYMENT').toLowerCase(),
            paymentMethod: isGeneral
              ? generalPayment.paymentData.paymentMethod
              : String(advanceForm.advancePaymentMethod || 'Bank Transfer').toLowerCase(),
            advanceTo: advanceForm.advanceTo || null,
            advanceToName: advanceForm.advanceToName || '',
            advanceAmount,
            advancePaymentMethod: isGeneral
              ? generalPayment.paymentData.paymentMethod
              : (advanceForm.advancePaymentMethod || 'Cash'),
            bankAccountId: isGeneral ? (generalPayment.paymentData.bankAccountId || null) : null,
            reference: isGeneral ? (generalPayment.paymentData.reference || '') : '',
            paymentDate: isGeneral ? generalPayment.paymentData.paymentDate : '',
            whtRate: isGeneral ? (Number(generalPayment.paymentData.whtRate) || 0) : 0,
            advanceRemarks: advanceForm.advanceRemarks || generalPayment.paymentData.advanceRemarks || '',
            signedCheckNumber: isGeneral
              ? (generalPayment.paymentData.reference || '')
              : (advanceForm.signedCheckNumber || ''),
            signedCheckDate: isGeneral
              ? (generalPayment.paymentData.paymentDate || '')
              : (advanceForm.signedCheckDate || ''),
            signedCheckBankName: advanceForm.signedCheckBankName || '',
            signedCheckRemarks: advanceForm.signedCheckRemarks || '',
            financeApprovalAuthorities: {
              accountsOfficerUser: financeAuthoritiesForm.accountsOfficerUser || null,
              accountsManagerUser: financeAuthoritiesForm.accountsManagerUser || null,
              financeControllerUser: financeAuthoritiesForm.financeControllerUser || null
            }
          });
          break;
        }
        case 'finance-approve': actionRes = await procurementService.caFinanceApprove(ca._id, actionComments); break;
        case 'finance-reject': actionRes = await procurementService.caFinanceReject(ca._id, actionComments); break;
        case 'submit-settlement-bill':
          actionRes = await procurementService.caSubmitSettlementBill(ca._id, extraData);
          break;
        case 'settle-payment':
          actionRes = await procurementService.caSettlePayment(ca._id, extraData);
          break;
        case 'send-to-procurement': actionRes = await procurementService.caSendToProcurement(ca._id, actionComments); break;
        case 'complete': actionRes = await procurementService.caComplete(ca._id, actionComments); break;
        case 'cancel': actionRes = await procurementService.caCancel(ca._id, actionComments); break;
        default: break;
      }
      setSuccess(actionRes?.message || 'Action completed successfully');
      closeAction();
      refreshList();
      if (viewDialog.open && viewDialog.data?._id === ca._id) {
        const updated = await procurementService.getCashApprovalById(ca._id);
        setViewDialog({ open: true, data: updated?.data ?? viewDialog.data });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Determine what actions are available ─────────────────────────────────────
  const getAvailableActions = (ca) => {
    const role = user?.role;
    const hasModuleAccess = (moduleKey) => {
      const hasInRoleDoc = (roleDoc) => roleDoc?.isActive && Array.isArray(roleDoc?.permissions) &&
        roleDoc.permissions.some((p) => p?.module === moduleKey);
      if (hasInRoleDoc(user?.roleRef)) return true;
      if (Array.isArray(user?.roles) && user.roles.some((r) => hasInRoleDoc(r))) return true;
      return false;
    };
    const isAdmin = ['super_admin', 'admin'].includes(role);
    const uid = String(user?.id || user?._id || '');
    const csa = ca?.indent?.comparativeStatementApprovals || {};
    const authorityIds = [
      csa.preparedByUser?._id || csa.preparedByUser,
      csa.verifiedByUser?._id || csa.verifiedByUser,
      csa.authorisedRepUser?._id || csa.authorisedRepUser,
      csa.financeRepUser?._id || csa.financeRepUser,
      csa.managerProcurementUser?._id || csa.managerProcurementUser
    ].map((id) => String(id || '')).filter(Boolean);
    const chainIds = Array.isArray(ca?.indent?.comparativeApproval?.approvers)
      ? ca.indent.comparativeApproval.approvers.map((s) => String(s?.approver?._id || s?.approver || '')).filter(Boolean)
      : [];
    const authorityText = ca?.approvalAuthorities || {};
    const userTokens = [
      `${user?.firstName || ''} ${user?.lastName || ''}`.trim().toLowerCase(),
      String(user?.email || '').trim().toLowerCase(),
      String(user?.employeeId || '').trim().toLowerCase()
    ].filter(Boolean);
    const textAssigned = [
      authorityText.preparedBy,
      authorityText.verifiedBy,
      authorityText.authorisedRep,
      authorityText.financeRep,
      authorityText.managerProcurement
    ].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
    const isAssignedAuthority = (uid && [...authorityIds, ...chainIds].includes(uid)) || userTokens.some((t) => textAssigned.includes(t));
    const hasAlreadyApproved = Array.isArray(ca?.authorityApprovals)
      && ca.authorityApprovals.some((a) => String(a?.approver?._id || a?.approver || '') === uid);
    const financeAuthorities = ca?.financeApprovalAuthorities || {};
    const normId = (v) => String(v?._id || v?.id || v || '').trim();
    const financeMySlots = [
      'accountsOfficerUser',
      'accountsManagerUser',
      'financeControllerUser'
    ].filter((key) => normId(financeAuthorities?.[key]) === uid);
    const financeDecidedKeys = new Set(
      (Array.isArray(ca?.financeAuthorityApprovals) ? ca.financeAuthorityApprovals : [])
        .map((a) => String(a?.authorityKey || '').trim())
        .filter(Boolean)
    );
    const hasPendingFinanceAuthorityDecision = financeMySlots.some((k) => !financeDecidedKeys.has(k));
    const isProcurement = isAdmin || role === 'procurement_manager' || hasModuleAccess('procurement');
    // Same as the server's hasFinanceAccess: developer / higher_management act as Finance on cash approvals
    const isFinance = isAdmin || ['finance_manager', 'developer', 'higher_management'].includes(role) || hasModuleAccess('finance');
    const isCeoSecretariat = isAdmin || role === 'hr_manager' || role === 'higher_management' || hasModuleAccess('hr') || hasModuleAccess('general');
    const isCeo = isAdmin || role === 'higher_management' || hasModuleAccess('general');
    const actions = [];
    switch (ca.status) {
      case 'Pending Approval':
        if (isAssignedAuthority && !hasAlreadyApproved) {
          actions.push({ label: 'Approve', type: 'approve', color: 'success', icon: <ApproveIcon /> });
          actions.push({ label: 'Reject', type: 'reject', color: 'error', icon: <RejectIcon /> });
        }
        break;
      case 'Draft':
        if (isProcurement || isAssignedAuthority) {
          actions.push({ label: 'Send to Audit', type: 'send-to-audit', color: 'primary', icon: <SendIcon /> });
          actions.push({ label: 'Cancel', type: 'cancel', color: 'error', icon: <RejectIcon /> });
        }
        break;
      case 'Returned from Audit':
      case 'Returned from CEO Office':
      case 'Returned from CEO Secretariat':
      case 'Rejected':
        if (isProcurement || isAssignedAuthority) {
          actions.push({
            label: getProcurementResubmitLabel(ca),
            type: 'resubmit-after-return',
            color: 'primary',
            icon: <SendIcon />
          });
          actions.push({ label: 'Cancel', type: 'cancel', color: 'error', icon: <RejectIcon /> });
        }
        break;
      case 'Pending Audit':
      case 'Forwarded to Audit Director':
        break;
      case 'Send to CEO Office':
        if (isCeoSecretariat || isAssignedAuthority) {
          actions.push({ label: 'Forward to CEO', type: 'forward-to-ceo', color: 'primary', icon: <ForwardIcon /> });
          actions.push({ label: 'Return to Procurement', type: 'ceo-secretariat-return', color: 'warning', icon: <ReturnIcon /> });
        }
        break;
      case 'Forwarded to CEO':
        if (isCeo || isAssignedAuthority) {
          actions.push({ label: 'Approve', type: 'ceo-approve', color: 'success', icon: <ApproveIcon /> });
          actions.push({ label: 'Return', type: 'ceo-return', color: 'warning', icon: <ReturnIcon /> });
          actions.push({ label: 'Reject', type: 'ceo-reject', color: 'error', icon: <RejectIcon /> });
        }
        break;
      case 'Pending Finance':
        if (ca?.evidenceSubmittedAt && ca?.advanceIssuedAt) {
          if (isFinance || isAssignedAuthority) {
            actions.push({ label: 'Settle Payment', type: 'settle-payment', color: 'primary', icon: <CashIcon /> });
          }
        } else {
          if (isFinance && !ca?.voucherEntryId) {
            actions.push({ label: 'Create Voucher', type: 'create-voucher', color: 'primary', icon: <AddIcon /> });
          }
          const hasConfiguredFinanceAuthorities = Boolean(
            ca?.financeApprovalAuthorities?.accountsOfficerUser
            || ca?.financeApprovalAuthorities?.accountsManagerUser
            || ca?.financeApprovalAuthorities?.financeControllerUser
          );
          if (hasConfiguredFinanceAuthorities && hasPendingFinanceAuthorityDecision) {
            actions.push({ label: 'Approve', type: 'finance-approve', color: 'success', icon: <ApproveIcon /> });
            actions.push({ label: 'Reject', type: 'finance-reject', color: 'error', icon: <RejectIcon /> });
          }
        }
        break;
      case 'Finance Authority Approved':
        if (isFinance || isAssignedAuthority) {
          actions.push({
            label: isGeneralModuleCashApproval(ca) ? 'Post Payment' : 'Issue Advance',
            type: 'issue-advance',
            color: 'primary',
            icon: <CashIcon />
          });
        }
        break;
      case 'Advance Issued':
        if (isProcurement || isAssignedAuthority) {
          actions.push({ label: 'Create Bill', type: 'submit-settlement-bill', color: 'primary', icon: <AddIcon /> });
        }
        break;
      case 'Payment Settled':
        if (isFinance || isAssignedAuthority) {
          actions.push({ label: 'Send to Procurement', type: 'send-to-procurement', color: 'primary', icon: <SendIcon /> });
        }
        break;
      case 'Sent to Procurement':
        if (isProcurement) {
          actions.push({ label: 'Mark as Completed', type: 'complete', color: 'success', icon: <CompleteIcon /> });
        }
        break;
      default:
        break;
    }
    return actions;
  };

  // Opened from the Vendor Payments hub: run the Finance step due on that cash approval, report back on close
  const embedDialogShownRef = useRef(false);
  useEffect(() => {
    if (!embedCaId || !user) return undefined;
    let cancelled = false;
    embedDialogShownRef.current = false;
    (async () => {
      try {
        const res = await procurementService.getCashApprovalById(embedCaId);
        const ca = res?.success ? res.data : null;
        if (cancelled) return;
        const action = ca && getAvailableActions(ca).find((a) => EMBED_FINANCE_ACTIONS.includes(a.type));
        if (!action) {
          toast.error(ca ? `No Finance step is open for you on ${ca.caNumber || 'this cash approval'} (${ca.status})` : 'Cash approval not found');
          if (onEmbedClose) onEmbedClose();
          return;
        }
        openAction(action.type, ca);
      } catch (err) {
        toast.error(err.response?.data?.message || 'Could not load the cash approval');
        if (onEmbedClose) onEmbedClose();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedCaId, user]);
  const embedDialogOpen = actionDialog.open || advancePaymentDialog.open;
  useEffect(() => {
    if (!embedCaId) return;
    if (embedDialogOpen) embedDialogShownRef.current = true;
    else if (embedDialogShownRef.current) {
      embedDialogShownRef.current = false;
      if (onEmbedClose) onEmbedClose();
    }
  }, [embedDialogOpen, embedCaId, onEmbedClose]);
  // Opened from the Payables hub to view a cash approval: show its view dialog, report back when it closes
  const embedViewShownRef = useRef(false);
  useEffect(() => {
    if (!embedViewCaId) return;
    embedViewShownRef.current = false;
    handleView({ _id: embedViewCaId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedViewCaId]);
  useEffect(() => {
    if (!embedViewCaId) return;
    if (viewDialog.open) embedViewShownRef.current = true;
    else if (embedViewShownRef.current) {
      embedViewShownRef.current = false;
      if (onEmbedClose) onEmbedClose();
    }
  }, [viewDialog.open, embedViewCaId, onEmbedClose]);
  // The page's own message banners are hidden when embedded; show them as toasts instead
  useEffect(() => { if (embedCaId && success) toast.success(success); }, [embedCaId, success]);
  useEffect(() => { if (embedCaId && error) toast.error(error); }, [embedCaId, error]);

  // ─── Advance Issue Dialog State ───────────────────────────────────────────────
  const [advanceForm, setAdvanceForm] = useState({ advanceTo: null, advanceToName: '', advanceAmount: '', advancePaymentMethod: 'Cash', advanceVoucherNo: '', advanceRemarks: '' });
  const isGeneralCreateVoucherOpen = Boolean(
    actionDialog.open
    && actionDialog.type === 'create-voucher'
    && actionDialog.ca
    && isGeneralModuleCashApproval(actionDialog.ca)
  );
  const generalPayment = useCashApprovalPaymentFields(actionDialog.ca, {
    active: isGeneralCreateVoucherOpen,
    includePendingFinance: true,
    seedCaId: actionDialog.ca?._id
  });
  const [signedCheckAttachments, setSignedCheckAttachments] = useState([]);
  const [signedCheckUploadLoading, setSignedCheckUploadLoading] = useState(false);
  const [purchaseEvidenceAttachments, setPurchaseEvidenceAttachments] = useState([]);
  const [purchaseEvidenceUploadLoading, setPurchaseEvidenceUploadLoading] = useState(false);
  const [settlementBillForm, setSettlementBillForm] = useState({
    purchaseInvoiceNo: '',
    evidenceActualAmount: '',
    evidenceRemarks: ''
  });
  const [settlementFinanceForm, setSettlementFinanceForm] = useState({
    actualAmountSpent: '',
    settlementRemarks: '',
    financeVerificationNotes: ''
  });
  const resolveIssuedAdvanceAmount = (caDoc) => {
    const issued = Number(caDoc?.advanceAmount);
    if (Number.isFinite(issued) && issued > 0) return issued;
    const fallback = Number(caDoc?.totalAmount);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  };
  const [employees, setEmployees] = useState([]);
  const [financeAuthorityUsers, setFinanceAuthorityUsers] = useState([]);
  const [financeAuthoritiesForm, setFinanceAuthoritiesForm] = useState({
    accountsOfficerUser: null,
    accountsManagerUser: null,
    financeControllerUser: null
  });
  const resolveVoucherNoForDialog = (caDoc) => String(caDoc?.voucherEntryId?.entryNumber || '').trim();
  useEffect(() => {
    if (['issue-advance', 'create-voucher', 'submit-settlement-bill', 'settle-payment'].includes(actionDialog.type)) {
      const currentUserId = String(user?.id || user?._id || '').trim() || null;
      if (['issue-advance', 'create-voucher'].includes(actionDialog.type)) {
        api.get('/indents/approver-candidates', {
          params: { limit: 100, departmentLike: 'procurement', _ts: Date.now() },
          headers: { 'Cache-Control': 'no-cache' }
        })
          .then((r) => {
            const users = Array.isArray(r?.data?.data) ? r.data.data : [];
            if (users.length) {
              setEmployees(users);
              return;
            }
            // Fallback: broaden query and filter client-side if department labels vary.
            return api.get('/indents/approver-candidates', {
              params: { limit: 100, _ts: Date.now() },
              headers: { 'Cache-Control': 'no-cache' }
            }).then((r2) => {
              const all = Array.isArray(r2?.data?.data) ? r2.data.data : [];
              const procurementOnly = all.filter((u) => /procurement/i.test(String(u?.department || '')));
              setEmployees(procurementOnly.length ? procurementOnly : all);
            });
          })
          .catch(() => setEmployees([]));
      }
      api.get('/indents/approver-candidates', {
        params: { limit: 100, departmentLike: 'finance/accounts', _ts: Date.now() },
        headers: { 'Cache-Control': 'no-cache' }
      }).then((r) => {
        const allUsers = Array.isArray(r?.data?.data) ? r.data.data : [];
        const normalize = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const financeUsers = allUsers.filter((u) => {
          const dept = normalize(u?.department);
          return dept.includes('finance') || dept.includes('account');
        });
        const currentUserId = String(user?.id || user?._id || '').trim();
        const me = currentUserId
          ? allUsers.find((u) => String(u?._id || u?.id || '').trim() === currentUserId) || {
            _id: currentUserId,
            id: currentUserId,
            firstName: user?.firstName || '',
            lastName: user?.lastName || '',
            email: user?.email || '',
            employeeId: user?.employeeId || '',
            department: user?.department || ''
          }
          : null;
        const nextUsers = [...financeUsers];
        if (me && !nextUsers.some((u) => String(u?._id || u?.id || '').trim() === currentUserId)) {
          nextUsers.unshift(me);
        }
        setFinanceAuthorityUsers((prev) => (nextUsers.length ? nextUsers : prev));
      }).catch(() => {
        setFinanceAuthorityUsers((prev) => prev || []);
      });
      setAdvanceForm({
        advanceTo: null,
        advanceToName: '',
        advanceAmount: actionDialog.ca?.totalAmount || '',
        voucherType: 'PAYMENT',
        advancePaymentMethod: 'Cash',
        advanceVoucherNo: resolveVoucherNoForDialog(actionDialog.ca),
        advanceRemarks: '',
        signedCheckNumber: actionDialog.ca?.signedCheckNumber || '',
        signedCheckDate: actionDialog.ca?.signedCheckDate ? new Date(actionDialog.ca.signedCheckDate).toISOString().split('T')[0] : '',
        signedCheckBankName: actionDialog.ca?.signedCheckBankName || '',
        signedCheckRemarks: actionDialog.ca?.signedCheckRemarks || ''
      });
      setSignedCheckAttachments(Array.isArray(actionDialog.ca?.signedCheckAttachments) ? actionDialog.ca.signedCheckAttachments : []);
      const assignedFinanceAuthorities = actionDialog.ca?.financeApprovalAuthorities || {};
      setFinanceAuthoritiesForm({
        // For voucher creation, Accounts Officer / AM must default to the current finance user.
        accountsOfficerUser: actionDialog.type === 'create-voucher'
          ? (currentUserId || null)
          : (assignedFinanceAuthorities?.accountsOfficerUser?._id || currentUserId),
        accountsManagerUser: assignedFinanceAuthorities?.accountsManagerUser?._id || null,
        financeControllerUser: assignedFinanceAuthorities?.financeControllerUser?._id || null
      });
      setPurchaseEvidenceAttachments(Array.isArray(actionDialog.ca?.purchaseReceipts) ? actionDialog.ca.purchaseReceipts : []);
      setSettlementBillForm({
        purchaseInvoiceNo: actionDialog.ca?.purchaseInvoiceNo || '',
        evidenceActualAmount: actionDialog.ca?.evidenceActualAmount || actionDialog.ca?.advanceAmount || '',
        evidenceRemarks: actionDialog.ca?.evidenceRemarks || ''
      });
      setSettlementFinanceForm({
        actualAmountSpent: actionDialog.ca?.actualAmountSpent || actionDialog.ca?.evidenceActualAmount || '',
        settlementRemarks: actionDialog.ca?.settlementRemarks || '',
        financeVerificationNotes: actionDialog.ca?.financeVerificationNotes || ''
      });
    }
  }, [actionDialog.type, actionDialog.ca, user]);

  useEffect(() => {
    const financeEditOpen = (formDialog.open && formDialog.mode === 'finance-edit') || financeEditDialog.open;
    if (!financeEditOpen) return;
    api.get('/indents/approver-candidates', {
      params: { limit: 100, departmentLike: 'finance/accounts', _ts: Date.now() },
      headers: { 'Cache-Control': 'no-cache' }
    }).then((r) => {
      const allUsers = Array.isArray(r?.data?.data) ? r.data.data : [];
      const normalize = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const financeUsers = allUsers.filter((u) => {
        const dept = normalize(u?.department);
        return dept.includes('finance') || dept.includes('account');
      });
      const currentUserId = String(user?.id || user?._id || '').trim();
      const me = currentUserId
        ? allUsers.find((u) => String(u?._id || u?.id || '').trim() === currentUserId) || {
          _id: currentUserId,
          id: currentUserId,
          firstName: user?.firstName || '',
          lastName: user?.lastName || '',
          email: user?.email || '',
          employeeId: user?.employeeId || '',
          department: user?.department || ''
        }
        : null;
      const nextUsers = [...financeUsers];
      if (me && !nextUsers.some((u) => String(u?._id || u?.id || '').trim() === currentUserId)) {
        nextUsers.unshift(me);
      }
      setFinanceAuthorityUsers((prev) => (nextUsers.length ? nextUsers : prev));
    }).catch(() => {
      setFinanceAuthorityUsers((prev) => prev || []);
    });
  }, [formDialog.open, formDialog.mode, financeEditDialog.open, user]);

  const saveFinanceAuthorities = async () => {
    if (!actionDialog?.ca?._id) return;
    try {
      setActionLoading(true);
      const payload = {
        accountsOfficerUser: financeAuthoritiesForm.accountsOfficerUser || null,
        accountsManagerUser: financeAuthoritiesForm.accountsManagerUser || null,
        financeControllerUser: financeAuthoritiesForm.financeControllerUser || null
      };
      const res = await procurementService.caSetFinanceAuthorities(actionDialog.ca._id, payload);
      setSuccess(res?.message || 'Finance approval authorities saved');
      const updated = res?.data || actionDialog.ca;
      setActionDialog((prev) => ({ ...prev, ca: updated }));
      if (viewDialog.open && viewDialog.data?._id === updated._id) {
        setViewDialog((prev) => ({ ...prev, data: updated }));
      }
      await loadCashApprovals();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save finance authorities');
    } finally {
      setActionLoading(false);
    }
  };

  const uploadSignedCheckEvidence = async (fileList) => {
    if (!actionDialog?.ca?._id) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      setSignedCheckUploadLoading(true);
      const res = await procurementService.caUploadSignedCheckEvidence(actionDialog.ca._id, files);
      const uploaded = Array.isArray(res?.data) ? res.data : [];
      setSignedCheckAttachments((prev) => [...prev, ...uploaded]);
      setSuccess(res?.message || 'Signed check evidence uploaded');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload signed check evidence');
    } finally {
      setSignedCheckUploadLoading(false);
    }
  };
  const uploadPurchaseEvidence = async (fileList) => {
    if (!actionDialog?.ca?._id) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      setPurchaseEvidenceUploadLoading(true);
      const res = await procurementService.caUploadPurchaseEvidence(actionDialog.ca._id, files);
      const uploaded = Array.isArray(res?.data) ? res.data : [];
      setPurchaseEvidenceAttachments((prev) => [...prev, ...uploaded]);
      setSuccess(res?.message || 'Purchase evidence uploaded');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload purchase evidence');
    } finally {
      setPurchaseEvidenceUploadLoading(false);
    }
  };

  const approveMyFinanceAuthority = async () => {
    if (!actionDialog?.ca?._id) return;
    try {
      setActionLoading(true);
      const res = await procurementService.caFinanceApprove(actionDialog.ca._id);
      setSuccess(res?.message || 'Finance authority approval recorded');
      const updated = res?.data || actionDialog.ca;
      setActionDialog((prev) => ({ ...prev, ca: updated }));
      if (viewDialog.open && viewDialog.data?._id === updated._id) {
        setViewDialog((prev) => ({ ...prev, data: updated }));
      }
      await loadCashApprovals();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to approve finance authority');
    } finally {
      setActionLoading(false);
    }
  };

  const rejectMyFinanceAuthority = async () => {
    if (!actionDialog?.ca?._id) return;
    const rejectionComments = window.prompt('Enter rejection reason (optional):', '') || '';
    try {
      setActionLoading(true);
      const res = await procurementService.caFinanceReject(actionDialog.ca._id, rejectionComments);
      setSuccess(res?.message || 'Finance authority rejection recorded');
      const updated = res?.data || actionDialog.ca;
      setActionDialog((prev) => ({ ...prev, ca: updated }));
      if (viewDialog.open && viewDialog.data?._id === updated._id) {
        setViewDialog((prev) => ({ ...prev, data: updated }));
      }
      await loadCashApprovals();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reject finance authority');
    } finally {
      setActionLoading(false);
    }
  };

  const stats = [
    {
      title: 'Total Cash Approvals',
      value: statistics?.totalCAs || 0,
      color: theme.palette.primary.main,
      bgColor: alpha(theme.palette.primary.main, 0.1)
    },
    {
      title: 'Total Value',
      value: formatPKR(statistics?.totalValue || 0),
      color: theme.palette.success.main,
      bgColor: alpha(theme.palette.success.main, 0.1)
    },
    {
      title: 'Pending Audit',
      value: statistics?.byStatus?.find((s) => s._id === 'Pending Audit')?.count || 0,
      color: theme.palette.warning.main,
      bgColor: alpha(theme.palette.warning.main, 0.1)
    },
    {
      title: 'Completed',
      value: statistics?.byStatus?.find((s) => s._id === 'Completed')?.count || 0,
      color: theme.palette.info.main,
      bgColor: alpha(theme.palette.info.main, 0.1)
    }
  ];

  const handleView = async (ca) => {
    try {
      const res = await procurementService.getCashApprovalById(ca._id);
      const doc = res?.success ? res.data : ca;
      let quotations = [];
      if (doc?.indent?._id) {
        try {
          const qRes = await api.get(`/procurement/quotations/by-indent/${doc.indent._id}`);
          if (qRes.data?.success && Array.isArray(qRes.data.data)) {
            quotations = qRes.data.data;
          }
        } catch (_) {
          quotations = [];
        }
      }
      setViewDialog({ open: true, data: doc, tab: 0, quotations, linkedDocs: buildLinkedDocs(doc) });
    } catch {
      setViewDialog({ open: true, data: ca, tab: 0, quotations: [], linkedDocs: buildLinkedDocs(ca) });
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 3, background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 56, height: 56 }}>
              <CashIcon fontSize="large" />
            </Avatar>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>
                Cash Approvals
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {isFinanceModule ? 'Review and manage cash approvals in the finance workflow' : 'Manage cash advance approvals and finance workflow'}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshList}>
              Refresh
            </Button>
            {!isFinanceModule && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => {
              setPrefillQuotationId(null);
              setApprovalAuthority({
                preparedBy: approverLabel(user) || '',
                verifiedBy: '',
                authorisedRep: '',
                financeRep: '',
                managerProcurement: ''
              });
              setFormDialog({ open: true, mode: 'create', data: null });
            }}>
              New Cash Approval
            </Button>
            )}
          </Box>
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={clearMessages}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 3 }} onClose={clearMessages}>{success}</Alert>}

      <Grid container spacing={3} sx={{ mb: 3 }}>
        {stats.map((stat, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ bgcolor: stat.bgColor, color: stat.color, width: 48, height: 48 }}>
                    <CashIcon />
                  </Avatar>
                  <Box>
                    <Typography variant="body2" color="textSecondary">{stat.title}</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold' }}>{stat.value}</Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search cash approvals..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth select size="small" label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
              <MenuItem value="">All Statuses</MenuItem>
              {Object.keys(STATUS_COLORS).map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth select size="small" label="Priority" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(0); }}>
              <MenuItem value="">All Priorities</MenuItem>
              <MenuItem value="Low">Low</MenuItem>
              <MenuItem value="Medium">Medium</MenuItem>
              <MenuItem value="High">High</MenuItem>
              <MenuItem value="Urgent">Urgent</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </Paper>

      <Paper>
        <TableContainer sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <Table sx={{ minWidth: 980 }}>
            <TableHead>
              <TableRow>
                <TableCell><strong>CA Number</strong></TableCell>
                <TableCell><strong>Vendor</strong></TableCell>
                <TableCell><strong>Initiator</strong></TableCell>
                <TableCell sx={{ minWidth: 180, maxWidth: 280 }}><strong>Narration / Description</strong></TableCell>
                <TableCell><strong>Approval Date</strong></TableCell>
                <TableCell><strong>Expected Purchase</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell><strong>Priority</strong></TableCell>
                <TableCell align="right"><strong>Total Amount</strong></TableCell>
                <TableCell align="center"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} align="center"><CircularProgress /></TableCell>
                </TableRow>
              ) : cashApprovals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} align="center">
                    <Typography variant="body2" color="textSecondary">No cash approvals found</Typography>
                  </TableCell>
                </TableRow>
              ) : cashApprovals.map((ca) => (
                <TableRow key={ca._id} hover>
                  <TableCell>{ca.caNumber}</TableCell>
                  <TableCell>{ca.vendor?.name || 'N/A'}</TableCell>
                  <TableCell>
                    {ca.createdBy
                      ? `${ca.createdBy.firstName || ''} ${ca.createdBy.lastName || ''}`.trim() || ca.createdBy.email || '—'
                      : '—'}
                  </TableCell>
                  <NarrationTableCell text={getCashApprovalNarrationDisplay(ca)} />
                  <TableCell>{formatDate(ca.approvalDate)}</TableCell>
                  <TableCell>{formatDate(ca.expectedPurchaseDate)}</TableCell>
                  <TableCell>
                    <Chip label={ca.status} size="small" color={getCaStatusChipColor(ca.status)} />
                  </TableCell>
                  <TableCell>
                    <Chip label={ca.priority} size="small" color={getPriorityColor(ca.priority)} />
                  </TableCell>
                  <TableCell align="right">{formatPKR(ca.totalAmount)}</TableCell>
                  <TableCell align="center">
                    <Stack direction="row" spacing={0.5} justifyContent="center" flexWrap="wrap">
                      <Tooltip title="View"><IconButton size="small" onClick={() => handleView(ca)}><ViewIcon fontSize="small" /></IconButton></Tooltip>
                      {canEditCashApproval(ca) && (
                        <Tooltip title={['Rejected', 'Returned from Audit', 'Returned from CEO Office', 'Returned from CEO Secretariat'].includes(ca.status) ? 'Edit & Resubmit' : 'Edit'}>
                          <IconButton size="small" onClick={() => openCashApprovalEdit(ca)}><EditIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      )}
                      {ca.status === 'Draft' && (
                        <Tooltip title="Send to Audit">
                          <IconButton size="small" color="primary" onClick={() => handleSendToAudit(ca._id, ca)}>
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {['Returned from Audit', 'Returned from CEO Office', 'Returned from CEO Secretariat', 'Rejected'].includes(ca.status) && (
                        <Tooltip title={getProcurementResubmitLabel(ca)}>
                          <IconButton size="small" color="primary" onClick={() => handleResubmitAfterReturn(ca)}>
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {/* Finance / Procurement stage quick-action buttons */}
                      {getAvailableActions(ca).filter(a => !['send-to-audit', 'resubmit-after-return', 'cancel'].includes(a.type)).map((action) => (
                        <Tooltip key={action.type} title={action.label}>
                          <IconButton size="small" color={action.color} onClick={() => openAction(action.type, ca)}>
                            {action.icon}
                          </IconButton>
                        </Tooltip>
                      ))}
                      <Tooltip title="Print"><IconButton size="small" onClick={() => navigate(`/procurement/cash-approvals/${ca._id}/print`)}><PrintIcon fontSize="small" /></IconButton></Tooltip>
                      {['Draft', 'Cancelled', 'Rejected'].includes(ca.status) && (
                        <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleteDialog({ open: true, id: ca._id })}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(e, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Paper>

      {/* ─── Create/Edit Dialog (layout aligned with Purchase Orders) ───────── */}
      <Dialog
        open={formDialog.open}
        onClose={() => { setFormDialog({ open: false, mode: 'create', data: null }); setPrefillQuotationId(null); setObservationAnswers({}); }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {formDialog.mode === 'create' ? 'Create Cash Approval' : formDialog.mode === 'finance-edit' ? 'Edit Cash Approval (Finance)' : 'Edit Cash Approval'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Company"
                value={formData.companyId || ''}
                onChange={(e) => setFormData({ ...formData, companyId: e.target.value })}
              >
                <MenuItem value=""><em>None / Default</em></MenuItem>
                {companies.map((c) => (
                  <MenuItem key={c._id} value={c._id}>{c.name || c.companyName}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Vendor"
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                required
              >
                {vendors.map((vendor) => (
                  <MenuItem key={vendor._id} value={vendor._id}>{vendor.name}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth select label="Priority" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value })}>
                <MenuItem value="Low">Low</MenuItem>
                <MenuItem value="Medium">Medium</MenuItem>
                <MenuItem value="High">High</MenuItem>
                <MenuItem value="Urgent">Urgent</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth type="date" label="Approval Date" value={formData.approvalDate} onChange={(e) => setFormData({ ...formData, approvalDate: e.target.value })} InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField fullWidth type="date" label="Expected Purchase Date" value={formData.expectedPurchaseDate} onChange={(e) => setFormData({ ...formData, expectedPurchaseDate: e.target.value })} InputLabelProps={{ shrink: true }} required />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Delivery Address" value={formData.deliveryAddress || ''} onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })} placeholder="Enter delivery address" multiline minRows={2} />
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Items</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={addItem}>Add Item</Button>
              </Box>
              {formData.items.map((item, index) => (
                <Paper key={index} sx={{ p: 2, mb: 2, bgcolor: alpha(theme.palette.primary.main, 0.02) }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField fullWidth size="small" label="Description" value={item.description} onChange={(e) => handleItemChange(index, 'description', e.target.value)} required />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField fullWidth size="small" label="Specification" value={item.specification || ''} onChange={(e) => handleItemChange(index, 'specification', e.target.value)} />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField fullWidth size="small" label="Brand" value={item.brand || ''} onChange={(e) => handleItemChange(index, 'brand', e.target.value)} />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField fullWidth size="small" type="number" label="Quantity" value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', parseFloat(e.target.value) || 0)} required />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField fullWidth size="small" label="Unit" value={item.unit} onChange={(e) => handleItemChange(index, 'unit', e.target.value)} required />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField fullWidth size="small" type="number" label="Unit Price" value={item.unitPrice} onChange={(e) => handleItemChange(index, 'unitPrice', parseFloat(e.target.value) || 0)} required />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField fullWidth size="small" type="number" label="Tax %" value={item.taxRate || 0} onChange={(e) => handleItemChange(index, 'taxRate', parseFloat(e.target.value) || 0)} />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField fullWidth size="small" type="number" label="Discount" value={item.discount || 0} onChange={(e) => handleItemChange(index, 'discount', parseFloat(e.target.value) || 0)} />
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        Attachments (images/PDF, compressed — up to 50 per line)
                      </Typography>
                      <LineAttachmentCell
                        line={item}
                        onLineChange={(patch) => updateFormItem(index, patch)}
                        resolveUrl={resolveUploadPublicUrl}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <IconButton color="error" onClick={() => removeItem(index)} disabled={formData.items.length === 1}>
                        <DeleteIcon />
                      </IconButton>
                    </Grid>
                  </Grid>
                </Paper>
              ))}
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField fullWidth type="number" label="Shipping Cost" value={formData.shippingCost} onChange={(e) => setFormData({ ...formData, shippingCost: parseFloat(e.target.value) || 0 })} />
            </Grid>
            <Grid item xs={12} md={6} />
            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.success.main, 0.1) }}>
                <Typography variant="h6" align="right">Total: {formatPKR(calculateFormTotal())}</Typography>
              </Paper>
            </Grid>

            {formDialog.mode !== 'finance-edit' && (
            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>Approval authorities</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                Search active users (same directory as indents) or type a name/designation. Saved values are stored as text for print.
              </Typography>
              <Grid container spacing={2}>
                {CA_APPROVAL_AUTHORITY_FIELDS.map(({ key, label }) => (
                  <Grid item xs={12} sm={6} md={4} key={key}>
                    <Autocomplete
                      freeSolo
                      options={authoritySearchOptions}
                      loading={authoritySearchLoading}
                      value={approvalAuthority[key]}
                      onChange={(_, newValue) => {
                        if (newValue == null) setApprovalAuthority((prev) => ({ ...prev, [key]: '' }));
                        else if (typeof newValue === 'string') setApprovalAuthority((prev) => ({ ...prev, [key]: newValue }));
                        else setApprovalAuthority((prev) => ({ ...prev, [key]: approverLabel(newValue) }));
                      }}
                      onInputChange={(_, input, reason) => {
                        if (reason === 'input') {
                          handleAuthoritySearchInput(input);
                          setApprovalAuthority((prev) => ({ ...prev, [key]: input }));
                        }
                        if (reason === 'clear') {
                          setApprovalAuthority((prev) => ({ ...prev, [key]: '' }));
                          loadAuthorityApproverOptions('');
                        }
                      }}
                      getOptionLabel={(option) => (typeof option === 'string' ? option : approverLabel(option))}
                      filterOptions={(opts) => opts}
                      isOptionEqualToValue={(a, b) => {
                        if (a && b && typeof a === 'object' && typeof b === 'object') return a._id === b._id;
                        if (typeof a === 'string' && typeof b === 'string') return a === b;
                        return false;
                      }}
                      PopperComponent={WidePopper}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={label}
                          size="small"
                          placeholder="Search user or type name…"
                          InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {authoritySearchLoading ? <CircularProgress color="inherit" size={16} /> : null}
                                {params.InputProps.endAdornment}
                              </>
                            )
                          }}
                        />
                      )}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
            )}

            {formDialog.mode === 'edit' && formDialog.data?.status === 'Returned from Audit' && formDialog.data?.auditObservations?.length > 0 && (
              <Grid item xs={12}>
                <Alert severity="warning" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Audit observations — respond before sending back to Pre-Audit</Typography>
                  {formDialog.data.auditReturnComments && (
                    <Typography variant="body2" sx={{ mb: 1, whiteSpace: 'pre-wrap' }}>{formDialog.data.auditReturnComments}</Typography>
                  )}
                  {formDialog.data.auditObservations.map((obs, index) => (
                    <Box key={obs._id || index} sx={{ mb: 2, p: 1.5, bgcolor: alpha(theme.palette.warning.main, 0.06), borderRadius: 1 }}>
                      <Typography variant="caption" fontWeight={600}>Observation {index + 1}</Typography>
                      <Typography variant="body2" sx={{ my: 1 }}>{obs.observation}</Typography>
                      <TextField
                        fullWidth
                        size="small"
                        multiline
                        minRows={2}
                        label="Your response"
                        value={observationAnswers[obs._id] || ''}
                        onChange={(e) => setObservationAnswers((prev) => ({ ...prev, [obs._id]: e.target.value }))}
                      />
                    </Box>
                  ))}
                </Alert>
              </Grid>
            )}

            <Grid item xs={12}>
              <TextField fullWidth multiline rows={2} label="Notes"
                value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
            </Grid>

            {formDialog.mode === 'finance-edit' && renderFinanceEditFields(formDialog.data?.status)}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setFormDialog({ open: false, mode: 'create', data: null }); setPrefillQuotationId(null); setObservationAnswers({}); }}>Cancel</Button>
          <Button variant="contained" onClick={handleFormSubmit} disabled={formLoading || !formData.vendor || !formData.expectedPurchaseDate || !formData.items.length || !formData.items[0].description}>
            {formLoading ? <CircularProgress size={20} /> : (formDialog.mode === 'create' ? 'Create' : 'Update')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ─── View Dialog (layout aligned with Purchase Order details) ─────────── */}
      {viewDialog.open && viewDialog.data && (
        <Dialog
          open={viewDialog.open}
          onClose={() => setViewDialog({ open: false, data: null, tab: 0, quotations: [], linkedDocs: [] })}
          maxWidth={false}
          fullWidth
          fullScreen={isMobile}
          PaperProps={{
            sx: {
              width: { xs: '100%', sm: '96%' },
              maxWidth: { xs: '100%', sm: '1400px' },
              maxHeight: { xs: '100%', sm: '95vh' },
              height: { xs: '100%', sm: 'auto' },
              m: { xs: 0, sm: 2 },
              borderRadius: { xs: 0, sm: 1 },
              '@media print': {
                boxShadow: 'none',
                maxWidth: '100%',
                margin: 0,
                height: '100%',
                width: '100%',
                maxHeight: '100%'
              }
            }
          }}
        >
          <DialogTitle sx={{ '@media print': { display: 'none' }, pb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="h6" sx={{ fontSize: { xs: '1rem', sm: '1.25rem' } }}>Cash Approval Details</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {canEditCashApproval(viewDialog.data) && (
                  <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={() => openCashApprovalEdit(viewDialog.data)}>Edit</Button>
                )}
                <Button variant="outlined" size="small" startIcon={<HistoryIcon />} onClick={() => setWorkflowHistoryDialog({ open: true, document: viewDialog.data })}>Workflow History</Button>
                <Button variant="contained" size="small" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
              </Stack>
            </Box>
          </DialogTitle>
          <DialogContent sx={{ p: 0, overflow: 'auto', '@media print': { p: 0, overflow: 'visible' } }}>
            <Box className="print-content">
              <Box className="app-print-hide" sx={{ px: 2, pt: 1, pb: 2 }}>
                <Stepper activeStep={getStepIndex(viewDialog.data.status)} alternativeLabel>
                  {WORKFLOW_STEPS.map((step) => (
                    <Step key={step}><StepLabel sx={{ '& .MuiStepLabel-label': { fontSize: '0.65rem' } }}>{step}</StepLabel></Step>
                  ))}
                </Stepper>
              </Box>

              {isGeneralModuleCashApproval(viewDialog.data) ? (
                <CashApprovalGeneralDetailShell embedded hideBack ca={viewDialog.data} />
              ) : (
                <CashApprovalDetailTabsView
                  cashApproval={viewDialog.data}
                  tabValue={viewDialog.tab}
                  onTabChange={(tab) => setViewDialog((prev) => ({ ...prev, tab }))}
                  quotations={viewDialog.quotations || []}
                  linkedDocs={viewDialog.linkedDocs || []}
                  showFinanceOnlyTabs={canViewFinanceOnlyTabs}
                />
              )}

              <Box className="app-print-hide" sx={{ px: 2, pb: 2 }}>
                {getAvailableActions(viewDialog.data).length > 0 && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" fontWeight={600} mb={1}>Available Actions</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {getAvailableActions(viewDialog.data).map((action) => (
                        <Button
                          key={action.type}
                          size="small"
                          variant={['approve', 'audit-approve', 'ceo-approve', 'reject', 'audit-reject', 'ceo-reject'].includes(action.type) ? 'contained' : 'outlined'}
                          color={action.color}
                          startIcon={action.icon}
                          onClick={() => openAction(action.type, viewDialog.data)}>
                          {action.label}
                        </Button>
                      ))}
                    </Stack>
                  </>
                )}
              </Box>
            </Box>
          </DialogContent>
          <DialogActions sx={{ '@media print': { display: 'none' } }}>
            <Button onClick={() => setViewDialog({ open: false, data: null, tab: 0, quotations: [], linkedDocs: [] })}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      <Box
        component="style"
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: A4; margin: 8mm; }
              body * { visibility: hidden; }
              .MuiDialog-container, .MuiDialog-container *, .MuiDialog-paper, .MuiDialog-paper *,
              .print-content, .print-content * { visibility: visible; }
              .app-print-hide { display: none !important; visibility: hidden !important; }
              .MuiDialog-container {
                position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; height: 100% !important;
                display: block !important; padding: 0 !important; margin: 0 !important; overflow: visible !important;
              }
              .MuiDialog-paper {
                box-shadow: none !important; margin: 0 !important; max-width: 100% !important; width: 100% !important;
                height: auto !important; max-height: none !important; position: relative !important; transform: none !important; overflow: visible !important;
              }
              .MuiDialogContent-root { overflow: visible !important; padding: 0 !important; height: auto !important; max-height: none !important; margin: 0 !important; }
              .MuiDialogTitle-root { display: none !important; }
              .MuiDialogActions-root { display: none !important; }
              .MuiBackdrop-root { display: none !important; }
              .ca-print-page { page-break-inside: avoid !important; }
              .ca-print-page table th, .ca-print-page table td { padding-top: 6px !important; padding-bottom: 6px !important; }
            }
          `
        }}
      />

      <WorkflowHistoryDialog
        open={workflowHistoryDialog.open}
        onClose={() => setWorkflowHistoryDialog({ open: false, document: null })}
        document={workflowHistoryDialog.document}
        documentType="document"
      />

      {/* ─── Action Dialogs ───────────────────────────────────────────────────── */}
      <Dialog open={actionDialog.open && !['create-voucher', 'issue-advance'].includes(actionDialog.type)} onClose={closeAction} maxWidth="sm" fullWidth>
        <DialogTitle>
          {actionDialog.type === 'send-to-audit' && 'Send to Audit'}
          {actionDialog.type === 'resubmit-after-return' && getProcurementResubmitLabel(actionDialog.ca)}
          {actionDialog.type === 'approve' && 'Approve Cash Approval'}
          {actionDialog.type === 'reject' && 'Reject Cash Approval'}
          {actionDialog.type === 'audit-approve' && 'Audit Approval'}
          {actionDialog.type === 'forward-to-audit-director' && 'Forward to Audit Director'}
          {actionDialog.type === 'audit-reject' && 'Reject by Audit'}
          {actionDialog.type === 'audit-return' && 'Return from Audit'}
          {actionDialog.type === 'forward-to-ceo' && 'Forward to CEO'}
          {actionDialog.type === 'ceo-secretariat-return' && 'Return from CEO Secretariat'}
          {actionDialog.type === 'ceo-approve' && 'CEO Approval'}
          {actionDialog.type === 'ceo-reject' && 'CEO Reject'}
          {actionDialog.type === 'ceo-return' && 'CEO Return'}
          {actionDialog.type === 'create-voucher' && 'Create Voucher'}
          {actionDialog.type === 'finance-approve' && 'Finance Authority Approval'}
          {actionDialog.type === 'finance-reject' && 'Finance Authority Reject'}
          {actionDialog.type === 'submit-settlement-bill' && 'Create Settlement Bill'}
          {actionDialog.type === 'settle-payment' && 'Finance Settlement'}
          {actionDialog.type === 'send-to-procurement' && 'Send to Procurement'}
          {actionDialog.type === 'complete' && 'Mark as Completed'}
          {actionDialog.type === 'cancel' && 'Cancel Cash Approval'}
        </DialogTitle>
        <DialogContent>
          {['send-to-audit', 'resubmit-after-return'].includes(actionDialog.type) && actionDialog.ca?.auditObservations?.length > 0 && (
            <Stack spacing={2} sx={{ mb: 2 }}>
              <Alert severity="info">Provide responses to audit observations (optional fields left blank are skipped).</Alert>
              {actionDialog.ca.auditObservations.map((obs, idx) => (
                <Box key={obs._id || idx}>
                  <Typography variant="caption" color="text.secondary">Observation {idx + 1}</Typography>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>{obs.observation}</Typography>
                  <TextField
                    fullWidth
                    size="small"
                    multiline
                    minRows={2}
                    label="Response"
                    value={observationAnswers[obs._id] || ''}
                    onChange={(e) => setObservationAnswers((prev) => ({ ...prev, [obs._id]: e.target.value }))}
                  />
                </Box>
              ))}
            </Stack>
          )}
          {actionDialog.type === 'resubmit-after-return' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Prior approval authorities stay intact. This will go directly back to{' '}
              <strong>{getProcurementResubmitLabel(actionDialog.ca).replace(/^Resubmit to /i, '')}</strong>.
            </Alert>
          )}
          {actionDialog.type === 'submit-settlement-bill' && (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12}>
                <Alert severity="info">Advance Issued: <strong>{formatPKR(resolveIssuedAdvanceAmount(actionDialog.ca))}</strong></Alert>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Purchase Invoice / Receipt No."
                  value={settlementBillForm.purchaseInvoiceNo}
                  onChange={(e) => setSettlementBillForm((prev) => ({ ...prev, purchaseInvoiceNo: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Actual Utilized Amount *"
                  value={settlementBillForm.evidenceActualAmount}
                  onChange={(e) => setSettlementBillForm((prev) => ({ ...prev, evidenceActualAmount: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12}>
                <Button variant="outlined" component="label" disabled={purchaseEvidenceUploadLoading} fullWidth>
                  {purchaseEvidenceUploadLoading ? 'Uploading...' : 'Upload Purchase Evidence (Bill/Receipts)'}
                  <input type="file" hidden multiple accept="image/*,.pdf" onChange={(e) => uploadPurchaseEvidence(e.target.files)} />
                </Button>
                <Typography variant="caption" color="text.secondary">
                  Uploaded evidence files: {purchaseEvidenceAttachments.length}
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                  label="Evidence Remarks"
                  value={settlementBillForm.evidenceRemarks}
                  onChange={(e) => setSettlementBillForm((prev) => ({ ...prev, evidenceRemarks: e.target.value }))}
                />
              </Grid>
            </Grid>
          )}
          {actionDialog.type === 'settle-payment' && (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12}>
                <Alert severity="info">
                  Advance Issued: <strong>{formatPKR(resolveIssuedAdvanceAmount(actionDialog.ca))}</strong>
                  {' '}| Evidence Amount: <strong>{formatPKR(actionDialog.ca?.evidenceActualAmount || 0)}</strong>
                </Alert>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Actual Amount Spent *"
                  value={settlementFinanceForm.actualAmountSpent}
                  onChange={(e) => setSettlementFinanceForm((prev) => ({ ...prev, actualAmountSpent: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Settlement Remarks"
                  value={settlementFinanceForm.settlementRemarks}
                  onChange={(e) => setSettlementFinanceForm((prev) => ({ ...prev, settlementRemarks: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                  label="Finance Verification Notes"
                  value={settlementFinanceForm.financeVerificationNotes}
                  onChange={(e) => setSettlementFinanceForm((prev) => ({ ...prev, financeVerificationNotes: e.target.value }))}
                />
              </Grid>
            </Grid>
          )}
          <TextField fullWidth multiline rows={3} label="Comments / Remarks" value={actionComments}
            onChange={(e) => setActionComments(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAction}>Cancel</Button>
          <Button variant="contained"
            color={['reject', 'audit-reject', 'ceo-reject', 'cancel'].includes(actionDialog.type) ? 'error' : ['audit-return', 'ceo-return', 'ceo-secretariat-return'].includes(actionDialog.type) ? 'warning' : 'primary'}
            onClick={() => {
              if (actionDialog.type === 'submit-settlement-bill') {
                handleAction({
                  purchaseInvoiceNo: settlementBillForm.purchaseInvoiceNo,
                  evidenceActualAmount: parseFloat(settlementBillForm.evidenceActualAmount || 0),
                  evidenceRemarks: settlementBillForm.evidenceRemarks || actionComments,
                  purchaseReceipts: purchaseEvidenceAttachments
                });
                return;
              }
              if (actionDialog.type === 'settle-payment') {
                handleAction({
                  actualAmountSpent: parseFloat(settlementFinanceForm.actualAmountSpent || 0),
                  settlementRemarks: settlementFinanceForm.settlementRemarks || actionComments,
                  financeVerificationNotes: settlementFinanceForm.financeVerificationNotes
                });
                return;
              }
              handleAction();
            }} disabled={actionLoading}>
            {actionLoading ? <CircularProgress size={20} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Finance Advance Dialog (Create Voucher / Issue Advance) */}
      <Dialog
        open={actionDialog.open && ['create-voucher', 'issue-advance'].includes(actionDialog.type)}
        onClose={closeAction}
        maxWidth={isGeneralCreateVoucherOpen ? 'md' : 'sm'}
        fullWidth
      >
        <DialogTitle>
          {actionDialog.type === 'issue-advance'
            ? 'Issue Advance'
            : 'Create Voucher'}
          {' '}
          — {actionDialog.ca?.caNumber}
          {isGeneralCreateVoucherOpen && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Amount to post: {formatPKR(generalPayment.paymentData.amount || 0)}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <Alert severity="info">Total CA Amount: <strong>{formatPKR(actionDialog.ca?.totalAmount)}</strong></Alert>
            </Grid>
            {actionDialog.type === 'create-voucher' && !isGeneralModuleCashApproval(actionDialog.ca) && (
            <Grid item xs={12}>
              <Autocomplete
                options={employees}
                getOptionLabel={(e) => `${e?.firstName || ''} ${e?.lastName || ''} — ${e?.department || ''}`.trim()}
                onChange={(_, v) => setAdvanceForm({ ...advanceForm, advanceTo: (v?._id || v?.id || null), advanceToName: v ? `${v.firstName || ''} ${v.lastName || ''}`.trim() : '' })}
                renderInput={(params) => <TextField {...params} label="Advance To (Procurement Officer) *" size="small" />}
              />
            </Grid>
            )}
            {actionDialog.type === 'create-voucher' && !isGeneralModuleCashApproval(actionDialog.ca) && (
            <Grid item xs={12} md={6}>
              <TextField fullWidth size="small" type="number" label="Advance Amount *"
                value={advanceForm.advanceAmount} onChange={(e) => setAdvanceForm({ ...advanceForm, advanceAmount: e.target.value })} />
            </Grid>
            )}
            {actionDialog.type === 'create-voucher' && !isGeneralModuleCashApproval(actionDialog.ca) && (
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                select
                label="Voucher Type"
                value={advanceForm.voucherType || 'PAYMENT'}
                onChange={(e) => setAdvanceForm({ ...advanceForm, voucherType: e.target.value })}
              >
                {['PAYMENT', 'RECEIPT', 'ADJUSTMENT', 'MANUAL'].map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
              </TextField>
            </Grid>
            )}
            {actionDialog.type === 'create-voucher' && !isGeneralModuleCashApproval(actionDialog.ca) && (
            <Grid item xs={12} md={6}>
              <TextField fullWidth size="small" select label="Payment Method" value={advanceForm.advancePaymentMethod}
                onChange={(e) => setAdvanceForm({ ...advanceForm, advancePaymentMethod: e.target.value })}>
                {['Cash', 'Bank Transfer', 'Cheque', 'Online Transfer'].map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </TextField>
            </Grid>
            )}
            {isGeneralCreateVoucherOpen && (
            <>
              <CashApprovalPaymentFieldsView
                ca={actionDialog.ca}
                payeeEmployees={generalPayment.payeeEmployees}
                selectedPayee={generalPayment.selectedPayee}
                onPayeeChange={async (employeeId) => {
                  const row = generalPayment.payeeEmployees.find((v) => String(v.employeeId) === String(employeeId));
                  generalPayment.setSelectedPayee({ employeeId, employeeName: row?.employeeName || '' });
                  await generalPayment.loadOutstandingByEmployee(employeeId, actionDialog.ca?._id);
                }}
                paymentData={generalPayment.paymentData}
                onPaymentDataChange={generalPayment.setPaymentData}
                bankAccounts={generalPayment.bankAccounts}
                outstandingTransactions={generalPayment.outstandingTransactions}
                onOutstandingRowChange={(idx, value, maxOutstanding) => {
                  const next = [...generalPayment.outstandingTransactions];
                  const v = Math.max(0, Math.min(Number(value) || 0, maxOutstanding || 0));
                  next[idx] = { ...next[idx], payAmount: v };
                  generalPayment.setOutstandingTransactions(next);
                  const total = Math.round(next.reduce((s, r) => s + (Number(r.payAmount) || 0), 0) * 100) / 100;
                  generalPayment.setPaymentData((prev) => ({ ...prev, amount: total }));
                }}
                loadingOutstanding={generalPayment.loadingOutstanding}
                referenceRequired
              />
            </>
            )}
            {isGeneralCreateVoucherOpen && (
            <Grid item xs={12}>
              <Alert severity="info">
                Assign finance approval authorities below. Use <strong>Create Voucher</strong> in Finance to generate and post the BPV to the ledger (Trial Balance). After all authorities approve, use <strong>Post Payment</strong> to confirm advance issued.
              </Alert>
            </Grid>
            )}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="Voucher No."
                value={advanceForm.advanceVoucherNo}
                InputProps={{ readOnly: true }}
                helperText={actionDialog.type === 'create-voucher'
                  ? (advanceForm.advanceVoucherNo ? 'Linked voucher number (same as voucher list)' : 'Will be assigned when voucher is created')
                  : 'Linked voucher number (same as voucher list)'}
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 0.5, mb: 1 }}>
                Approval Authority
              </Typography>
              <Grid container spacing={1} sx={{ mb: 1.5 }}>
                {[
                  { key: 'accountsOfficerUser', label: 'Accounts Officer / AM' },
                  { key: 'accountsManagerUser', label: 'Sr Manager Accounts' },
                  { key: 'financeControllerUser', label: 'GM Finance' }
                ].map((slot) => (
                  <Grid item xs={12} md={4} key={slot.key}>
                    <Autocomplete
                      options={financeAuthorityUsers}
                      value={
                        financeAuthorityUsers.find((u) => String(u?._id || u?.id || '') === String(financeAuthoritiesForm[slot.key] || ''))
                        || (
                          slot.key === 'accountsOfficerUser'
                          && String(financeAuthoritiesForm[slot.key] || '') === String(user?.id || user?._id || '')
                          && (user?._id || user?.id)
                          ? {
                            _id: String(user?._id || user?.id),
                            id: String(user?._id || user?.id),
                            firstName: user?.firstName || '',
                            lastName: user?.lastName || '',
                            email: user?.email || '',
                            employeeId: user?.employeeId || '',
                            department: user?.department || ''
                          }
                          : null
                        )
                      }
                      getOptionLabel={(u) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u.employeeId || ''}
                      ListboxProps={{
                        style: {
                          maxHeight: 280,
                          overflow: 'auto'
                        }
                      }}
                      renderOption={(props, option) => (
                        <Box component="li" {...props} sx={{ py: 0.5 }}>
                          <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.2 }}>
                            {`${option.firstName || ''} ${option.lastName || ''}`.trim() || option.email || option.employeeId || 'User'}
                          </Typography>
                        </Box>
                      )}
                      onChange={(_, v) => setFinanceAuthoritiesForm((prev) => ({ ...prev, [slot.key]: String(v?._id || v?.id || '').trim() || null }))}
                      renderInput={(params) => <TextField {...params} label={slot.label} size="small" helperText="Finance/Accounts users from User Management" />}
                    />
                  </Grid>
                ))}
                <Grid item xs={12}>
                  <Button size="small" variant="outlined" onClick={saveFinanceAuthorities} disabled={actionLoading}>
                    Save Finance Authorities
                  </Button>
                </Grid>
              </Grid>
              <TableContainer component={Paper} variant="outlined">
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
                      const fmt = (d) => {
                        if (!d) return '—';
                        const dt = new Date(d);
                        return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString();
                      };
                      const financeSlots = [
                        { key: 'accountsOfficerUser', label: 'Accounts Officer / AM' },
                        { key: 'accountsManagerUser', label: 'Sr Manager Accounts' },
                        { key: 'financeControllerUser', label: 'GM Finance' }
                      ];
                      const financeApprovals = Array.isArray(actionDialog?.ca?.financeAuthorityApprovals) ? actionDialog.ca.financeAuthorityApprovals : [];
                      const financeByKey = new Map(
                        financeApprovals
                          .map((a) => [String(a?.authorityKey || '').trim(), a])
                          .filter(([k]) => Boolean(k))
                      );
                      return financeSlots.map((slot) => {
                        const explicit = financeByKey.get(slot.key);
                        const assignedUser = actionDialog?.ca?.financeApprovalAuthorities?.[slot.key];
                        const approver = explicit?.approver && typeof explicit.approver === 'object' ? explicit.approver : assignedUser;
                        const approvedAt = explicit?.approvedAt;
                        const decision = String(explicit?.decision || '').trim().toLowerCase();
                        const isRejected = decision === 'rejected';
                        const approverName = approver
                          ? ([approver?.firstName, approver?.lastName].filter(Boolean).join(' ').trim() || approver?.email || '—')
                          : '—';
                        const isApproved = Boolean(approvedAt) && !isRejected;
                        return (
                        <TableRow key={`issue-auth-${slot.key}`}>
                          <TableCell>{slot.label}</TableCell>
                          <TableCell>{approverName}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={isRejected ? 'Rejected' : (isApproved ? 'Approved' : 'Pending')}
                              color={isRejected ? 'error' : (isApproved ? 'success' : 'warning')}
                              variant={isRejected || isApproved ? 'filled' : 'outlined'}
                            />
                          </TableCell>
                          <TableCell>{fmt(approvedAt)}</TableCell>
                          <TableCell align="center">
                            {isApproved && approver?.digitalSignature ? (
                              <DigitalSignatureImage userOrPath={approver} alt={`${slot.label} signature`} />
                            ) : isApproved ? (
                              <Typography variant="caption" color="text.secondary">No signature on file</Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">—</Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );});
                    })()}
                  </TableBody>
                </Table>
              </TableContainer>
              {(() => {
                const me = String(user?.id || user?._id || '');
                const authorities = actionDialog?.ca?.financeApprovalAuthorities || {};
                const approvals = Array.isArray(actionDialog?.ca?.financeAuthorityApprovals) ? actionDialog.ca.financeAuthorityApprovals : [];
                const decidedKeys = new Set(approvals.map((a) => String(a?.authorityKey || '').trim()).filter(Boolean));
                const mine = [
                  { key: 'accountsOfficerUser', label: 'Accounts Officer / AM' },
                  { key: 'accountsManagerUser', label: 'Sr Manager Accounts' },
                  { key: 'financeControllerUser', label: 'GM Finance' }
                ].filter((s) => String(authorities?.[s.key]?._id || authorities?.[s.key] || '') === me && !decidedKeys.has(s.key));
                if (!mine.length) return null;
                return (
                  <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      startIcon={<ApproveIcon />}
                      onClick={approveMyFinanceAuthority}
                      disabled={actionLoading}
                    >
                      Approve My Finance Authority
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      color="error"
                      startIcon={<RejectIcon />}
                      onClick={rejectMyFinanceAuthority}
                      disabled={actionLoading}
                    >
                      Reject My Finance Authority
                    </Button>
                  </Box>
                );
              })()}
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth size="small" multiline rows={2} label="Remarks"
                value={advanceForm.advanceRemarks} onChange={(e) => setAdvanceForm({ ...advanceForm, advanceRemarks: e.target.value })} />
            </Grid>
            {actionDialog.type === 'issue-advance' && (
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="Signed Check Number *"
                value={advanceForm.signedCheckNumber || ''}
                onChange={(e) => setAdvanceForm({ ...advanceForm, signedCheckNumber: e.target.value })}
              />
            </Grid>
            )}
            {actionDialog.type === 'issue-advance' && (
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Signed Check Date"
                InputLabelProps={{ shrink: true }}
                value={advanceForm.signedCheckDate || ''}
                onChange={(e) => setAdvanceForm({ ...advanceForm, signedCheckDate: e.target.value })}
              />
            </Grid>
            )}
            {actionDialog.type === 'issue-advance' && (
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="Bank Name"
                value={advanceForm.signedCheckBankName || ''}
                onChange={(e) => setAdvanceForm({ ...advanceForm, signedCheckBankName: e.target.value })}
              />
            </Grid>
            )}
            {actionDialog.type === 'issue-advance' && (
            <Grid item xs={12} md={6}>
              <Button
                variant="outlined"
                component="label"
                disabled={signedCheckUploadLoading}
                fullWidth
              >
                {signedCheckUploadLoading ? 'Uploading...' : 'Upload Signed Check Evidence'}
                <input
                  type="file"
                  hidden
                  multiple
                  accept="image/*,.pdf"
                  onChange={(e) => uploadSignedCheckEvidence(e.target.files)}
                />
              </Button>
            </Grid>
            )}
            {actionDialog.type === 'issue-advance' && (
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                multiline
                rows={2}
                label="Signed Check Remarks"
                value={advanceForm.signedCheckRemarks || ''}
                onChange={(e) => setAdvanceForm({ ...advanceForm, signedCheckRemarks: e.target.value })}
              />
            </Grid>
            )}
            {actionDialog.type === 'issue-advance' && (
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                Uploaded evidence files: {signedCheckAttachments.length}
              </Typography>
            </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAction}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              if (actionDialog.type === 'issue-advance') {
                handleAction({
                  advanceTo: advanceForm.advanceTo || null,
                  advanceToName: advanceForm.advanceToName || '',
                  advanceAmount: parseFloat(advanceForm.advanceAmount || 0),
                  advancePaymentMethod: advanceForm.advancePaymentMethod || 'Cash',
                  advanceVoucherNo: advanceForm.advanceVoucherNo || '',
                  advanceRemarks: advanceForm.advanceRemarks || actionComments,
                  signedCheckNumber: advanceForm.signedCheckNumber || '',
                  signedCheckDate: advanceForm.signedCheckDate || '',
                  signedCheckBankName: advanceForm.signedCheckBankName || '',
                  signedCheckRemarks: advanceForm.signedCheckRemarks || '',
                  signedCheckAttachments
                });
                return;
              }
              handleAction();
            }}
            disabled={
              actionLoading
              || (actionDialog.type === 'create-voucher' && (
                !financeAuthoritiesForm.accountsOfficerUser
                || !financeAuthoritiesForm.accountsManagerUser
                || !financeAuthoritiesForm.financeControllerUser
                || (isGeneralCreateVoucherOpen && !(generalPayment.paymentData.amount > 0))
                || (isGeneralCreateVoucherOpen && !String(generalPayment.paymentData.reference || '').trim())
              ))
              || (actionDialog.type === 'issue-advance' && (
                !advanceForm.advanceAmount
                || !signedCheckAttachments.length
              ))
            }
          >
            {actionLoading ? <CircularProgress size={20} /> : (
              actionDialog.type === 'issue-advance' ? 'Issue Advance' : 'Create Voucher'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <CashApprovalAdvancePaymentDialog
        open={advancePaymentDialog.open}
        ca={advancePaymentDialog.ca}
        onClose={() => setAdvancePaymentDialog({ open: false, ca: null })}
        onSuccess={(msg) => {
          setSuccess(msg || 'Advance payment posted');
          setAdvancePaymentDialog({ open: false, ca: null });
          refreshList();
        }}
        onError={(msg) => setError(msg || 'Failed to post payment')}
      />

      {/* General module — finance edit dialog */}
      <Dialog
        open={financeEditDialog.open}
        onClose={() => { setFinanceEditDialog({ open: false, data: null }); setFinanceEditForm(EMPTY_FINANCE_EDIT_FORM); }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Edit Cash Approval (Finance) — {financeEditDialog.data?.caNumber}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {renderFinanceEditFields(financeEditDialog.data?.status, { includePurpose: true, includeNotes: true })}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setFinanceEditDialog({ open: false, data: null }); setFinanceEditForm(EMPTY_FINANCE_EDIT_FORM); }}>Cancel</Button>
          <Button variant="contained" onClick={handleFinanceEditSubmit} disabled={financeEditLoading}>
            {financeEditLoading ? <CircularProgress size={20} /> : 'Update'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, id: null })} maxWidth="xs">
        <DialogTitle>Delete Cash Approval</DialogTitle>
        <DialogContent><Typography>Are you sure you want to delete this Cash Approval? This cannot be undone.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, id: null })}>Cancel</Button>
          <Button color="error" variant="contained" onClick={async () => {
            try {
              await procurementService.deleteCashApproval(deleteDialog.id);
              setSuccess('Deleted successfully');
              setDeleteDialog({ open: false, id: null });
              refreshList();
            } catch (err) {
              setError(err.response?.data?.message || 'Delete failed');
            }
          }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CashApprovalsPage;
