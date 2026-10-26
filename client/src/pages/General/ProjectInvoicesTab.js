import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, FormControl, Grid, IconButton,
  InputLabel, MenuItem, Paper, Select, Skeleton, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography, Divider
} from '@mui/material';
import {
  Add as AddIcon, CheckCircle as PaidIcon, Delete as DeleteIcon,
  Edit as EditIcon, Receipt as InvoiceIcon, Refresh as RefreshIcon,
  Send as SendIcon, Visibility as ViewIcon, Block as CancelInvoiceIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import {
  getProjectInvoices, createProjectInvoice, updateProjectInvoice, deleteProjectInvoice,
  recordInvoicePayment, cancelProjectInvoice,
  getBOQ, getCheckRequests, getCheckRequestById,
  getIpc, submitIpc, resubmitIpc, reviseIpc, retryIpcFinancePosting, getSubcontractorBalances
} from '../../services/projectManagementService';
import IpcKindDialog from '../../components/ProjectManagement/IpcKindDialog';
import ClientBillingLines from '../../components/ProjectManagement/ClientBillingLines';
import IpcApprovalTrail, { IPC_APPROVAL_COLOR, ipcStageText } from '../../components/ProjectManagement/IpcApprovalTrail';

const isIpc = (inv) => inv?.invoiceType === 'Subcontractor_IPC';
/** Documents that travel the approval chain: every IPC, and client invoices raised since the chain existed */
const inChain = (inv) => isIpc(inv)
  || (inv?.invoiceType === 'Client_Invoice' && (inv.status === 'Draft' || (inv.approvalStatus && inv.approvalStatus !== 'Draft')));
const isNonWorkIpc = (inv) => isIpc(inv) && ['Advance', 'Retention Release'].includes(inv.ipcKind);
const ipcKindLabel = (inv) => (inv.ipcKind === 'Advance' ? 'Advance' : inv.ipcKind === 'Retention Release' ? 'Retention Release' : 'Subcontractor IPC');
/** IPC is with the project team: never submitted, or rejected back */
const ipcEditable = (inv) => ['Draft', 'Rejected', undefined, null, ''].includes(inv?.approvalStatus);

const balanceOf = (inv) => Math.max(0, (Number(inv.netPayableAmount) || Number(inv.invoiceAmount) || 0) - (Number(inv.paidAmount) || 0));

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })
    .format(Number(v || 0));

const STATUS_COLOR = {
  Draft: 'default', Sent: 'info', Paid: 'success',
  'Partially Paid': 'warning', Cancelled: 'error'
};

const EMPTY_FORM = {
  invoiceType: 'Subcontractor_IPC',
  contractor: '',
  contractorName: '', // IPCs always pay the check request's subcontractor
  checkRequestId: '',
  slabClaim: null, // { name, percentage, amount } when the check request claims a slab
  invoiceAmount: '', description: '', issueDate: dayjs().format('YYYY-MM-DD'),
  dueDate: '', billingPercentage: '', clientName: '', clientContact: '',
  clientAddress: '', notes: '', status: 'Draft', boqItemId: '',
  retentionPercentage: 5, advanceRecoveryAmount: 0, whtPercentage: 0,
  ipcItems: [], // [{ boqItemId, currentQuantity, unitPrice }]
  clientMode: 'verified', // Client invoice: 'verified' (from verified work) or 'manual' (milestone amount)
  clientLines: [] // [{ crItem, quantity }]
};

const ProjectInvoicesTab = ({ project, onGoToTab }) => {
  const [data, setData] = useState(null);
  const [boqItems, setBoqItems] = useState([]);
  const [billableCheckRequests, setBillableCheckRequests] = useState([]);
  // Retention held / advances outstanding per subcontractor on this Sub Project
  const [balances, setBalances] = useState([]);
  const [kindDialog, setKindDialog] = useState(null); // { kind: 'Advance' | 'Retention Release', editing? }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewIpcDialog, setViewIpcDialog] = useState(null); // IPC invoice for detail modal
  const [viewIpcFull, setViewIpcFull] = useState(null); // same IPC with approval trail populated
  const [editInvoice, setEditInvoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', paidDate: dayjs().format('YYYY-MM-DD'), paymentMethod: '', paymentReference: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, boqRes, crRes, balRes] = await Promise.all([
        getProjectInvoices(project._id),
        getBOQ(project._id),
        getCheckRequests(project._id, { billable: 'true' }).catch(() => ({ data: { data: { checkRequests: [] } } })),
        getSubcontractorBalances(project._id).catch(() => ({ data: { data: [] } }))
      ]);
      setBalances(balRes.data?.data || []);
      setData(res.data?.data || null);
      setBoqItems(boqRes.data?.data?.items || []);
      setBillableCheckRequests(crRes.data?.data?.checkRequests || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load invoices');
    } finally { setLoading(false); }
  }, [project._id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setViewIpcFull(null);
    if (!viewIpcDialog || !inChain(viewIpcDialog)) return;
    getIpc(viewIpcDialog._id).then((res) => setViewIpcFull(res.data?.data || null)).catch(() => {});
  }, [viewIpcDialog]);

  const handleRetryFinance = async () => {
    try {
      const res = await retryIpcFinancePosting(viewIpcDialog._id);
      setSuccess(res.data?.message || 'Posted to Finance');
      setViewIpcFull(res.data?.data || null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Finance posting failed');
    }
  };

  const openAdd = () => {
    setEditInvoice(null);
    setForm({
      ...EMPTY_FORM,
      clientName: project.clientName || '',
      clientContact: project.clientContact || '',
      clientAddress: project.address || ''
    });
    setDialogOpen(true);
  };

  const openEdit = async (inv) => {
    if (isNonWorkIpc(inv)) {
      setKindDialog({ kind: inv.ipcKind, editing: inv });
      return;
    }
    if (isIpc(inv)) {
      setError('');
      try {
        const crId = inv.checkRequest?._id || inv.checkRequest;
        const cr = crId ? (await getCheckRequestById(project._id, crId)).data?.data : null;
        if (!cr) { setError('The check request behind this IPC could not be loaded'); return; }
        const mine = new Map((inv.items || []).map((i) => [String(i.boqItem?._id || i.boqItem), Number(i.currentQuantity) || 0]));
        const ipcItems = cr.claimType === 'Slab' ? [] : (cr.items || []).map((i) => {
          const id = String(i.boqItem?._id || i.boqItem);
          const thisIpc = mine.get(id) || 0;
          // This IPC's own quantity is available again while revising it
          const billableQty = Math.max(0, (Number(i.verifiedQuantity) || 0) - (Number(i.billedQuantity) || 0)) + thisIpc;
          return billableQty > 0 ? { boqItemId: id, label: i.title || i.description, unit: i.unit, billableQty, currentQuantity: thisIpc, unitPrice: i.unitPrice || 0 } : null;
        }).filter(Boolean);
        setEditInvoice(inv);
        setForm({
          ...EMPTY_FORM,
          invoiceType: 'Subcontractor_IPC',
          checkRequestId: String(cr._id),
          contractor: inv.contractor?._id || inv.contractor || '',
          contractorName: inv.contractor?.name || cr.contractor?.name || '',
          slabClaim: cr.claimType === 'Slab'
            ? { name: cr.slab?.name, percentage: cr.slab?.percentage, amount: Number(inv.grossAmount) || 0, contractNumber: cr.subletContract?.contractNumber }
            : null,
          ipcItems,
          description: inv.description || '',
          issueDate: inv.issueDate ? dayjs(inv.issueDate).format('YYYY-MM-DD') : '',
          dueDate: inv.dueDate ? dayjs(inv.dueDate).format('YYYY-MM-DD') : '',
          notes: inv.notes || '',
          retentionPercentage: inv.retentionPercentage || 0,
          advanceRecoveryAmount: inv.advanceRecoveryAmount || 0,
          whtPercentage: inv.whtPercentage || 0,
          revisionComment: ''
        });
        setDialogOpen(true);
      } catch (err) {
        setError(err.response?.data?.message || 'Could not open the IPC for revision');
      }
      return;
    }
    setEditInvoice(inv);
    setForm({
      invoiceType: inv.invoiceType || 'Subcontractor_IPC',
      contractor: inv.contractor?._id || inv.contractor || '',
      invoiceAmount: inv.invoiceAmount,
      description: inv.description || '',
      issueDate: inv.issueDate ? dayjs(inv.issueDate).format('YYYY-MM-DD') : '',
      dueDate: inv.dueDate ? dayjs(inv.dueDate).format('YYYY-MM-DD') : '',
      billingPercentage: inv.billingPercentage || '',
      clientName: inv.clientName || '',
      clientContact: inv.clientContact || '',
      clientAddress: inv.clientAddress || '',
      notes: inv.notes || '',
      status: inv.status,
      boqItemId: inv.boqItemId || '',
      retentionPercentage: inv.retentionPercentage || 0,
      advanceRecoveryAmount: inv.advanceRecoveryAmount || 0,
      whtPercentage: inv.whtPercentage || 0,
      ipcItems: (inv.items || []).map(i => ({
        boqItemId: i.boqItem?._id || i.boqItem,
        currentQuantity: i.currentQuantity || 0,
        unitPrice: i.unitPrice || 0
      }))
    });
    setDialogOpen(true);
  };

  /** Advance recovery the server will apply: recovery % of gross, capped at what is still outstanding */
  const suggestedRecovery = (contractorId, gross) => {
    const bal = balances.find((b) => String(b.contractor._id) === String(contractorId));
    if (!bal || !(bal.advanceOutstanding > 0)) return { amount: 0, bal };
    return { amount: Math.min(bal.advanceOutstanding, Math.round((gross * (bal.recoveryPercent || 0)) / 100)), bal };
  };

  // Prepare IPC items from a Verified Check Request
  const handleCheckRequestChange = (checkRequestId) => {
    const cr = billableCheckRequests.find((r) => r._id === checkRequestId);
    if (!cr) {
      setForm((prev) => ({ ...prev, checkRequestId: '', ipcItems: [], contractor: '', contractorName: '', slabClaim: null }));
      return;
    }
    if (cr.claimType === 'Slab') {
      setForm((prev) => ({
        ...prev,
        checkRequestId,
        contractor: cr.contractor?._id || cr.contractor || '',
        contractorName: cr.contractor?.name || '',
        ipcItems: [],
        slabClaim: {
          name: cr.slab?.name,
          percentage: cr.slab?.percentage,
          amount: Number(cr.billableTotal) || Number(cr.verifiedTotal) || 0,
          contractNumber: cr.subletContract?.contractNumber
        },
        advanceRecoveryAmount: suggestedRecovery(cr.contractor?._id || cr.contractor, Number(cr.billableTotal) || Number(cr.verifiedTotal) || 0).amount,
        description: prev.description || `IPC from ${cr.checkRequestNumber} — Slab: ${cr.slab?.name}`
      }));
      return;
    }
    const ipcItems = (cr.remainingItems || cr.items || [])
      .map((i) => {
        const billableQty = i.billableQuantity !== undefined
          ? Number(i.billableQuantity)
          : Math.max(0, (Number(i.verifiedQuantity) || 0) - (Number(i.billedQuantity) || 0));
        if (billableQty <= 0) return null;
        return {
          boqItemId: i.boqItem?._id || i.boqItem,
          label: i.title || i.description,
          unit: i.unit,
          currentQuantity: billableQty,
          billableQty,
          unitPrice: i.unitPrice || 0
        };
      })
      .filter(Boolean);

    setForm((prev) => ({
      ...prev,
      checkRequestId,
      contractor: cr.contractor?._id || cr.contractor || '',
      contractorName: cr.contractor?.name || '',
      ipcItems,
      slabClaim: null,
      advanceRecoveryAmount: suggestedRecovery(
        cr.contractor?._id || cr.contractor,
        ipcItems.reduce((t, i) => t + i.currentQuantity * i.unitPrice, 0)
      ).amount,
      description: prev.description || `IPC from ${cr.checkRequestNumber}`
    }));
  };

  const updateIpcItemQty = (boqItemId, qty) => {
    setForm(prev => ({
      ...prev,
      ipcItems: prev.ipcItems.map(item => String(item.boqItemId) === String(boqItemId) ? { ...item, currentQuantity: qty === '' ? '' : Number(qty) || 0 } : item)
    }));
  };

  // Calculations for Subcontractor IPC
  const calcGross = () => {
    if (form.slabClaim) return Number(form.slabClaim.amount) || 0;
    return form.ipcItems.reduce((sum, item) => sum + (Number(item.currentQuantity) * Number(item.unitPrice)), 0);
  };

  const grossAmt = calcGross();
  const retAmt = Math.round(grossAmt * ((Number(form.retentionPercentage) || 0) / 100));
  const advAmt = Number(form.advanceRecoveryAmount) || 0;
  const whtAmt = Math.round(grossAmt * ((Number(form.whtPercentage) || 0) / 100));
  const netPayableAmt = Math.max(0, grossAmt - retAmt - advAmt - whtAmt);

  const isIpcEdit = Boolean(editInvoice) && editInvoice.invoiceType === 'Subcontractor_IPC';

  const handleSave = async () => {
    setError('');
    if (isIpcEdit) {
      const over = form.ipcItems.find((i) => Number(i.currentQuantity) > Number(i.billableQty ?? Infinity));
      if (over) { setError(`Quantity for "${over.label}" is more than the ${over.billableQty} ${over.unit || ''} available`); return; }
      if (!form.slabClaim && !form.ipcItems.some((i) => Number(i.currentQuantity) > 0)) { setError('Bill at least one line'); return; }
      if (retAmt + advAmt + whtAmt > grossAmt) { setError('Deductions are more than the gross bill'); return; }
      setSaving(true);
      try {
        await reviseIpc(project._id, editInvoice._id, {
          items: form.ipcItems.map((i) => ({ boqItemId: i.boqItemId, currentQuantity: Number(i.currentQuantity) || 0 })),
          retentionPercentage: Number(form.retentionPercentage) || 0,
          advanceRecoveryAmount: Number(form.advanceRecoveryAmount) || 0,
          whtPercentage: Number(form.whtPercentage) || 0,
          description: form.description,
          issueDate: form.issueDate,
          dueDate: form.dueDate || undefined,
          notes: form.notes,
          comments: form.revisionComment
        });
        setSuccess(editInvoice.approvalStatus === 'Rejected' ? 'IPC revised — now resubmit it with your response' : 'IPC revised');
        setDialogOpen(false);
        load();
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to revise IPC');
      } finally { setSaving(false); }
      return;
    }
    if (form.invoiceType === 'Subcontractor_IPC') {
      if (!form.checkRequestId) {
        setError('Select a Verified Check Request first. IPC cannot be created without it.');
        return;
      }
      const activeItems = form.ipcItems.filter(i => Number(i.currentQuantity) > 0);
      const over = form.ipcItems.find((i) => Number(i.currentQuantity) > Number(i.billableQty ?? Infinity));
      if (over) {
        setError(`Quantity for "${over.label}" is more than the verified unbilled ${over.billableQty} ${over.unit || ''}`);
        return;
      }
      if (retAmt + advAmt + whtAmt > grossAmt) {
        setError('Deductions are more than the gross bill');
        return;
      }
      if (!form.slabClaim && !activeItems.length) {
        setError('Enter billable quantities from the Check Request.');
        return;
      }
    } else if (form.invoiceType === 'Client_Invoice' && form.clientMode === 'verified' && !editInvoice) {
      if (!form.clientLines.some((l) => Number(l.quantity) > 0 || Number(l.amount) > 0)) {
        setError('Tick the verified work to bill and enter quantities / amounts'); return;
      }
      if (form.clientLines.some((l) => l.amount !== undefined && !(Number(l.amount) > 0))) {
        setError('Enter the client amount for each ticked slab stage'); return;
      }
    } else {
      if (!form.invoiceAmount || Number(form.invoiceAmount) <= 0) {
        setError('Invoice amount is required'); return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        checkRequestId: form.checkRequestId || undefined,
        items: form.ipcItems.filter(i => Number(i.currentQuantity) > 0),
        invoiceAmount: form.invoiceType === 'Subcontractor_IPC' && grossAmt > 0 ? netPayableAmt : Number(form.invoiceAmount),
        clientLines: form.invoiceType === 'Client_Invoice' && form.clientMode === 'verified'
          ? form.clientLines.filter((l) => Number(l.quantity) > 0 || Number(l.amount) > 0)
          : undefined
      };

      if (editInvoice) {
        await updateProjectInvoice(project._id, editInvoice._id, payload);
        setSuccess('Invoice updated successfully');
      } else {
        await createProjectInvoice(project._id, payload);
        setSuccess('Invoice / IPC created successfully');
      }
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save invoice');
    } finally { setSaving(false); }
  };

  const openMarkPaid = (inv) => {
    setPayingInvoice(inv);
    setPayForm({
      amount: balanceOf(inv),
      paidDate: dayjs().format('YYYY-MM-DD'),
      paymentMethod: 'Bank Transfer',
      paymentReference: ''
    });
    setPayDialogOpen(true);
  };

  const handleMarkPaid = async () => {
    const amount = Number(payForm.amount);
    if (!(amount > 0)) { setError('Enter the amount paid'); return; }
    if (amount > balanceOf(payingInvoice) + 0.009) { setError(`Amount is more than the balance due (${fmt(balanceOf(payingInvoice))})`); return; }
    setSaving(true); setError('');
    try {
      const res = await recordInvoicePayment(project._id, payingInvoice._id, {
        amount,
        paidDate: payForm.paidDate,
        paymentMethod: payForm.paymentMethod,
        paymentReference: payForm.paymentReference
      });
      setSuccess(res.data?.message || 'Payment recorded');
      setPayDialogOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record payment');
    } finally { setSaving(false); }
  };

  const handleCancelInvoice = async (inv) => {
    const reason = window.prompt(`Cancel ${inv.invoiceNumber}? Its verified work becomes billable again.\n\nReason:`);
    if (reason === null) return;
    try {
      await cancelProjectInvoice(project._id, inv._id, reason);
      setSuccess('Invoice cancelled — its verified work can be billed again');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel');
    }
  };

  const handleSubmitIpc = async (inv) => {
    const label = isIpc(inv) ? `IPC #${inv.ipcNumber}` : `client invoice ${inv.invoiceNumber}`;
    if (!window.confirm(`Submit ${label} (${fmt(inv.netPayableAmount || inv.invoiceAmount)}) for approval?\n\nIt goes to Pre-Audit → Audit Director → CEO Secretariat → CEO, and reaches Finance only after the CEO approves it. It can't be edited unless it is rejected.`)) return;
    try {
      const res = await submitIpc(inv._id);
      setSuccess(res.data?.message || 'IPC submitted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit');
    }
  };

  const handleResubmitIpc = async (inv) => {
    const comments = window.prompt(`Resubmit ${isIpc(inv) ? `IPC #${inv.ipcNumber}` : `invoice ${inv.invoiceNumber}`} to ${ipcStageText(inv).replace('Rejected by ', '')}.\n\nYour response to the rejection / what you changed:`);
    if (comments === null) return;
    if (!comments.trim()) { setError('Write your response before resubmitting'); return; }
    try {
      const res = await resubmitIpc(inv._id, comments.trim());
      setSuccess(res.data?.message || 'IPC resubmitted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resubmit');
    }
  };

  const handleMarkSent = async (inv) => {
    try {
      await updateProjectInvoice(project._id, inv._id, { status: 'Sent' });
      setSuccess('Invoice marked as sent');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update status');
    }
  };

  const handleDelete = async (invId) => {
    if (!window.confirm('Delete this invoice?')) return;
    try {
      await deleteProjectInvoice(project._id, invId);
      setSuccess('Invoice deleted');
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete');
    }
  };

  const invoicesList = data?.invoices || [];

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Summary KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Total Invoiced / IPCs</Typography>
              <Typography variant="h5" fontWeight={700} color="primary.main">{fmt(data?.totalInvoiced)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Total Paid to Date</Typography>
              <Typography variant="h5" fontWeight={700} color="success.main">{fmt(data?.totalPaid)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Outstanding Balance</Typography>
              <Typography variant="h5" fontWeight={700} color={data?.totalOutstanding > 0 ? 'error.main' : 'text.primary'}>
                {fmt(data?.totalOutstanding)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Toolbar */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>Project Invoices & Subcontractor IPCs</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} size="small">Refresh</Button>
          <Button variant="outlined" startIcon={<AddIcon />} size="small" onClick={() => setKindDialog({ kind: 'Advance' })}>
            Advance
          </Button>
          <Button variant="outlined" startIcon={<AddIcon />} size="small" onClick={() => setKindDialog({ kind: 'Retention Release' })}
            disabled={!balances.some((b) => b.retentionAvailable > 0)}>
            Release Retention
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd} size="small">
            Create Bill / IPC
          </Button>
        </Stack>
      </Stack>

      {/* Retention held and advances outstanding per subcontractor */}
      {balances.some((b) => b.retentionHeld > 0 || b.advancePaid > 0 || b.advancePendingApproval > 0) && (
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><strong>Subcontractor</strong></TableCell>
                <TableCell align="right"><strong>Retention held</strong></TableCell>
                <TableCell align="right"><strong>Released / pending</strong></TableCell>
                <TableCell align="right"><strong>Retention available</strong></TableCell>
                <TableCell align="right"><strong>Advance paid</strong></TableCell>
                <TableCell align="right"><strong>Recovered</strong></TableCell>
                <TableCell align="right"><strong>Advance outstanding</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {balances.filter((b) => b.retentionHeld > 0 || b.advancePaid > 0 || b.advancePendingApproval > 0).map((b) => (
                <TableRow key={b.contractor._id}>
                  <TableCell>{b.contractor.name}</TableCell>
                  <TableCell align="right">{fmt(b.retentionHeld)}</TableCell>
                  <TableCell align="right">{fmt(b.retentionReleased)}</TableCell>
                  <TableCell align="right"><strong>{fmt(b.retentionAvailable)}</strong></TableCell>
                  <TableCell align="right">
                    {fmt(b.advancePaid)}
                    {b.advancePendingApproval > 0 && <Typography variant="caption" display="block" color="text.secondary">+{fmt(b.advancePendingApproval)} in approval</Typography>}
                  </TableCell>
                  <TableCell align="right">{fmt(b.advanceRecovered)}</TableCell>
                  <TableCell align="right">
                    <strong>{fmt(b.advanceOutstanding)}</strong>
                    {b.advanceOutstanding > 0 && <Typography variant="caption" display="block" color="text.secondary">recovering {b.recoveryPercent}% per IPC</Typography>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Table */}
      {loading ? (
        <Skeleton variant="rectangular" height={250} />
      ) : invoicesList.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <InvoiceIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography variant="subtitle1" color="text.secondary">No invoices or IPC bills created yet</Typography>
          {billableCheckRequests.length ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {billableCheckRequests.length} verified check request{billableCheckRequests.length === 1 ? ' is' : 's are'} ready to bill.
              </Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd} sx={{ mt: 2 }}>
                Create First Invoice / IPC
              </Button>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                A subcontractor IPC is raised from a verified check request. Nothing is ready to bill yet.
              </Typography>
              {onGoToTab && (
                <Button variant="outlined" onClick={() => onGoToTab('check-requests')} sx={{ mt: 2 }}>
                  Go to Check Requests
                </Button>
              )}
            </>
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell><strong>Invoice # / IPC</strong></TableCell>
                <TableCell><strong>Type</strong></TableCell>
                <TableCell><strong>Contractor / Client</strong></TableCell>
                <TableCell><strong>Issue Date</strong></TableCell>
                <TableCell align="right"><strong>Gross Amount</strong></TableCell>
                <TableCell align="right"><strong>Net Payable</strong></TableCell>
                <TableCell align="center"><strong>Status</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoicesList.map(inv => (
                <TableRow key={inv._id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {inv.invoiceType === 'Subcontractor_IPC' ? `IPC #${inv.ipcNumber || 1} (${inv.invoiceNumber})` : inv.invoiceNumber}
                    </Typography>
                    {inv.description && <Typography variant="caption" color="text.secondary" display="block">{inv.description}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={isIpc(inv) ? ipcKindLabel(inv) : inv.invoiceType === 'General' ? 'Ad-hoc (legacy)' : 'Client Invoice'}
                      color={isNonWorkIpc(inv) ? 'secondary' : inv.invoiceType === 'Subcontractor_IPC' ? 'info' : 'primary'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {inv.contractor?.name || inv.clientName || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>{inv.issueDate ? dayjs(inv.issueDate).format('DD MMM YYYY') : '—'}</TableCell>
                  <TableCell align="right">{fmt(inv.grossAmount || inv.invoiceAmount)}</TableCell>
                  <TableCell align="right">
                    <strong>{fmt(inv.netPayableAmount || inv.invoiceAmount)}</strong>
                    {Number(inv.paidAmount) > 0 && inv.status !== 'Cancelled' && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        Paid {fmt(inv.paidAmount)} · Due {fmt(balanceOf(inv))}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {inChain(inv) && inv.status !== 'Cancelled' ? (
                      <Stack alignItems="center" spacing={0.5}>
                        <Chip size="small" label={ipcStageText(inv)} color={IPC_APPROVAL_COLOR[inv.approvalStatus || 'Draft'] || 'default'} />
                        {['Paid', 'Partially Paid'].includes(inv.status) && (
                          <Chip size="small" variant="outlined" label={inv.status} color={STATUS_COLOR[inv.status]} />
                        )}
                        {inv.approvalStatus === 'Rejected' && inv.rejection?.comments && (
                          <Typography variant="caption" color="error.main" sx={{ maxWidth: 180 }} noWrap title={inv.rejection.comments}>
                            {inv.rejection.comments}
                          </Typography>
                        )}
                      </Stack>
                    ) : (
                      <Chip size="small" label={inv.status} color={STATUS_COLOR[inv.status] || 'default'} />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {(inChain(inv) || inv.items?.length > 0) && (
                        <Tooltip title="View Detailed IPC Bill Statement">
                          <IconButton size="small" onClick={() => setViewIpcDialog(inv)} color="info">
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {inChain(inv) && !['Cancelled', 'Paid', 'Partially Paid'].includes(inv.status) && (inv.approvalStatus || 'Draft') === 'Draft' && (
                        <Tooltip title="Submit for approval (Pre-Audit)">
                          <IconButton size="small" color="primary" onClick={() => handleSubmitIpc(inv)}><SendIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      )}
                      {inChain(inv) && inv.approvalStatus === 'Rejected' && inv.status !== 'Cancelled' && (
                        <Tooltip title="Resubmit to the desk that rejected it">
                          <IconButton size="small" color="primary" onClick={() => handleResubmitIpc(inv)}><SendIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      )}
                      {!inChain(inv) && !inv.financeArId && ['Sent', 'Partially Paid'].includes(inv.status) && (
                        <Tooltip title="Record payment">
                          <IconButton size="small" color="success" onClick={() => openMarkPaid(inv)}>
                            <PaidIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {inv.invoiceType === 'General' && inv.status === 'Draft' && (
                        <Tooltip title="Mark Sent">
                          <IconButton size="small" color="info" onClick={() => handleMarkSent(inv)}>
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {inv.status !== 'Cancelled' && (!inChain(inv) || ipcEditable(inv)) && (
                        <Tooltip title={isIpc(inv) ? 'Revise' : 'Edit'}>
                          <IconButton size="small" onClick={() => openEdit(inv)}><EditIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      )}
                      {inv.status !== 'Cancelled' && !(Number(inv.paidAmount) > 0) && (!inChain(inv) || ipcEditable(inv) || (!isIpc(inv) && inv.approvalStatus === 'Approved')) && (
                        <Tooltip title="Cancel (frees the verified work to rebill)">
                          <IconButton size="small" color="warning" onClick={() => handleCancelInvoice(inv)}><CancelInvoiceIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      )}
                      {inv.status === 'Draft' && !(Number(inv.paidAmount) > 0) && (!inChain(inv) || (inv.approvalStatus || 'Draft') === 'Draft') && (
                        <Tooltip title="Delete draft">
                          <IconButton size="small" color="error" onClick={() => handleDelete(inv._id)}><DeleteIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create/Edit Invoice & Subcontractor IPC Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{isIpcEdit ? `Revise IPC #${editInvoice.ipcNumber} · ${editInvoice.invoiceNumber}` : editInvoice ? 'Edit Bill / Invoice' : 'Create Subcontractor IPC / Invoice'}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2} sx={{ pt: 1 }}>
            {isIpcEdit && (
              <Grid item xs={12}>
                {editInvoice.approvalStatus === 'Rejected' && editInvoice.rejection?.comments && (
                  <Alert severity="error" sx={{ mb: 1 }}>
                    <strong>{ipcStageText(editInvoice)}:</strong> {editInvoice.rejection.comments}
                  </Alert>
                )}
                <Alert severity="info">
                  Change quantities (up to the verified work) or deductions. The rate stays the verified rate.
                  Currently gross {fmt(editInvoice.grossAmount)}, net {fmt(editInvoice.netPayableAmount)}.
                </Alert>
              </Grid>
            )}
            {!isIpcEdit && (
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Billing Category / Mode</InputLabel>
                <Select
                  value={form.invoiceType}
                  label="Billing Category / Mode"
                  onChange={e => setForm(p => ({ ...p, invoiceType: e.target.value }))}
                >
                  <MenuItem value="Subcontractor_IPC">Subcontractor IPC (RA Bill against BOQ)</MenuItem>
                  <MenuItem value="Client_Invoice">Client Milestone Invoice</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            )}

            {form.invoiceType === 'Subcontractor_IPC' && !isIpcEdit && (
              <Grid item xs={12}>
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  Subcontractor IPC must be created from a <strong>Verified Check Request</strong>.
                  Create and verify one under the Check Requests tab first.
                </Alert>
                <FormControl fullWidth size="small" required>
                  <InputLabel>Verified Check Request</InputLabel>
                  <Select
                    label="Verified Check Request"
                    value={form.checkRequestId}
                    onChange={(e) => handleCheckRequestChange(e.target.value)}
                    disabled={Boolean(editInvoice)}
                  >
                    <MenuItem value="">Select check request…</MenuItem>
                    {billableCheckRequests.map((cr) => (
                      <MenuItem key={cr._id} value={cr._id}>
                        {cr.checkRequestNumber} — {cr.title}
                        {cr.contractor?.name ? ` (${cr.contractor.name})` : ''}
                        {` · ${fmt(cr.billableTotal || cr.verifiedTotal || 0)}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {billableCheckRequests.length === 0 && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    No verified unpaid Check Requests available on this Sub Project.
                  </Alert>
                )}
              </Grid>
            )}

            {form.invoiceType === 'Subcontractor_IPC' && form.checkRequestId && (
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Subcontractor (payee)"
                  value={form.contractorName || '—'}
                  InputProps={{ readOnly: true }}
                  helperText="Always the subcontractor who raised the check request"
                />
              </Grid>
            )}

            {/* Subcontractor IPC lines from Check Request */}
            {form.invoiceType === 'Subcontractor_IPC' && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 1, mb: 1, color: 'primary.dark' }}>
                  Verified Check Request Quantities (billable)
                </Typography>
                {form.slabClaim ? (
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={1}>
                      <Typography variant="body2" fontWeight={600}>
                        Slab-wise stage: {form.slabClaim.name} · {form.slabClaim.percentage}%
                        {form.slabClaim.contractNumber ? ` of ${form.slabClaim.contractNumber}` : ''}
                      </Typography>
                      <Typography variant="subtitle1" fontWeight={700}>{fmt(form.slabClaim.amount)}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      The verified stage is billed in full; deductions below still apply.
                    </Typography>
                  </Paper>
                ) : form.ipcItems.length === 0 ? (
                  <Alert severity="info">Select a Verified Check Request to load billable quantities.</Alert>
                ) : (
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>BOQ Description</strong></TableCell>
                          <TableCell><strong>Unit</strong></TableCell>
                          <TableCell align="right"><strong>Verified, not yet billed</strong></TableCell>
                          <TableCell align="right" sx={{ width: 140 }}><strong>Bill now</strong></TableCell>
                          <TableCell align="right"><strong>Verified rate</strong></TableCell>
                          <TableCell align="right"><strong>Amount</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {form.ipcItems.map((itemInput) => {
                          const boq = boqItems.find((b) => String(b._id) === String(itemInput.boqItemId));
                          const isOver = Number(itemInput.currentQuantity || 0) > Number(itemInput.billableQty ?? Infinity);
                          return (
                            <TableRow key={itemInput.boqItemId} hover sx={{ bgcolor: isOver ? 'error.50' : 'inherit' }}>
                              <TableCell>
                                <Typography variant="body2" fontWeight={600}>
                                  {itemInput.label || boq?.title || boq?.description || 'BOQ item'}
                                </Typography>
                              </TableCell>
                              <TableCell>{itemInput.unit || boq?.unit || '—'}</TableCell>
                              <TableCell align="right">{itemInput.billableQty ?? '—'}</TableCell>
                              <TableCell align="right">
                                <TextField
                                  size="small"
                                  type="number"
                                  value={itemInput.currentQuantity ?? ''}
                                  onChange={(e) => updateIpcItemQty(itemInput.boqItemId, e.target.value)}
                                  error={isOver}
                                  helperText={isOver ? `Max ${itemInput.billableQty}` : ''}
                                  inputProps={{ min: 0, max: itemInput.billableQty, step: 'any' }}
                                />
                              </TableCell>
                              <TableCell align="right">{fmt(itemInput.unitPrice)}</TableCell>
                              <TableCell align="right">
                                <strong>{fmt(Number(itemInput.currentQuantity || 0) * Number(itemInput.unitPrice || 0))}</strong>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}

                {/* IPC Financial Deductions Section */}
                <Card variant="outlined" sx={{ mt: 2, p: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>Deductions & Net Payable Summary</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={3}>
                      <Typography variant="caption" color="text.secondary">Gross Bill Amount</Typography>
                      <Typography variant="h6" fontWeight={700}>{fmt(grossAmt)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <TextField
                        size="small"
                        fullWidth
                        label="Retention Money (%)"
                        inputProps={{ min: 0, max: 100 }}
                        type="number"
                        value={form.retentionPercentage}
                        onChange={e => setForm(p => ({ ...p, retentionPercentage: e.target.value }))}
                        helperText={`Deducted: ${fmt(retAmt)}`}
                      />
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <TextField
                        size="small"
                        fullWidth
                        label="Advance Recovery (PKR)"
                        inputProps={{ min: 0, max: suggestedRecovery(form.contractor, 0).bal?.advanceOutstanding }}
                        type="number"
                        value={form.advanceRecoveryAmount}
                        onChange={e => setForm(p => ({ ...p, advanceRecoveryAmount: e.target.value }))}
                        helperText={(() => {
                          const { bal } = suggestedRecovery(form.contractor, 0);
                          return bal?.advanceOutstanding > 0
                            ? `Outstanding ${fmt(bal.advanceOutstanding)} · ${bal.recoveryPercent}% suggested`
                            : 'No advance outstanding';
                        })()}
                      />
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <TextField
                        size="small"
                        fullWidth
                        label="WHT Tax (%)"
                        inputProps={{ min: 0, max: 100 }}
                        type="number"
                        value={form.whtPercentage}
                        onChange={e => setForm(p => ({ ...p, whtPercentage: e.target.value }))}
                        helperText={`Deducted: ${fmt(whtAmt)}`}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Divider sx={{ my: 1 }} />
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle1" fontWeight={700} color="primary.main">Net Amount Payable to Subcontractor:</Typography>
                        <Typography variant="h5" fontWeight={800} color="success.main">{fmt(netPayableAmt)}</Typography>
                      </Stack>
                    </Grid>
                  </Grid>
                </Card>
              </Grid>
            )}

            {form.invoiceType === 'Client_Invoice' && !editInvoice && (
              <Grid item xs={12}>
                <FormControl size="small" sx={{ minWidth: 280, mb: 1.5 }}>
                  <InputLabel>Bill the client for</InputLabel>
                  <Select label="Bill the client for" value={form.clientMode}
                    onChange={(e) => setForm((p) => ({ ...p, clientMode: e.target.value }))}>
                    <MenuItem value="verified">Verified work (BOQ client rates)</MenuItem>
                    <MenuItem value="manual">Milestone / fixed amount</MenuItem>
                  </Select>
                </FormControl>
                {form.clientMode === 'verified' && (
                  <ClientBillingLines projectId={project._id} value={form.clientLines}
                    onChange={(clientLines) => setForm((p) => ({ ...p, clientLines }))} />
                )}
              </Grid>
            )}
            {form.invoiceType !== 'Subcontractor_IPC' && (editInvoice || form.invoiceType !== 'Client_Invoice' || form.clientMode === 'manual') && (
              <Grid item xs={12}>
                <TextField
                  fullWidth required label="Invoice Amount (PKR)" type="number"
                  value={form.invoiceAmount} onChange={e => setForm(p => ({ ...p, invoiceAmount: e.target.value }))}
                  inputProps={{ min: 0 }}
                />
              </Grid>
            )}

            <Grid item xs={12}>
              <TextField fullWidth label="Description / Bill Notes" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} multiline rows={2} />
            </Grid>
            {isIpcEdit && (
              <Grid item xs={12}>
                <TextField fullWidth label="What did you change? (kept in the approval history)" value={form.revisionComment || ''}
                  onChange={e => setForm(p => ({ ...p, revisionComment: e.target.value }))} />
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <TextField fullWidth type="date" label="Issue Date" InputLabelProps={{ shrink: true }}
                value={form.issueDate} onChange={e => setForm(p => ({ ...p, issueDate: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth type="date" label="Due Date" InputLabelProps={{ shrink: true }}
                value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : null}>
            {saving ? 'Saving…' : isIpcEdit ? 'Save revision' : editInvoice ? 'Update Bill' : 'Generate IPC / Bill'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Detailed IPC Statement Modal */}
      {viewIpcDialog && (
        <Dialog open={Boolean(viewIpcDialog)} onClose={() => setViewIpcDialog(null)} maxWidth="md" fullWidth>
          <DialogTitle>
            Interim Payment Certificate (IPC #{viewIpcDialog.ipcNumber || 1}) — {viewIpcDialog.invoiceNumber}
          </DialogTitle>
          <DialogContent dividers>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6}>
                <Typography variant="body2"><strong>Subcontractor:</strong> {viewIpcDialog.contractor?.name || '—'}</Typography>
                <Typography variant="body2"><strong>Project:</strong> {project.name}</Typography>
              </Grid>
              <Grid item xs={6} align="right">
                <Typography variant="body2"><strong>Date:</strong> {dayjs(viewIpcDialog.issueDate).format('DD MMM YYYY')}</Typography>
                <Typography variant="body2"><strong>Status:</strong> {viewIpcDialog.status}</Typography>
              </Grid>
            </Grid>

            {!(viewIpcDialog.items || []).length ? (
              <Alert severity="info" sx={{ mt: 2 }}>
                {isNonWorkIpc(viewIpcDialog)
                  ? `${ipcKindLabel(viewIpcDialog)} — ${viewIpcDialog.description || ''}${viewIpcDialog.ipcKind === 'Advance' ? ` (recovered at ${viewIpcDialog.advanceRecoveryPercent || 0}% of later IPCs)` : ''}`
                  : `${viewIpcDialog.description || 'Slab-wise stage payment'} — billed in full from the verified check request.`}
              </Alert>
            ) : (
            <>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ mt: 2 }}>Executed BOQ Statement</Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell><strong>Description</strong></TableCell>
                    <TableCell><strong>Unit</strong></TableCell>
                    <TableCell align="right"><strong>Prev Qty</strong></TableCell>
                    <TableCell align="right"><strong>Curr Qty</strong></TableCell>
                    <TableCell align="right"><strong>Total Cum. Qty</strong></TableCell>
                    <TableCell align="right"><strong>Rate</strong></TableCell>
                    <TableCell align="right"><strong>Amount</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {viewIpcDialog.items?.map((i, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{i.title || i.description}</TableCell>
                      <TableCell>{i.unit}</TableCell>
                      <TableCell align="right">{i.previousQuantity}</TableCell>
                      <TableCell align="right"><strong>{i.currentQuantity}</strong></TableCell>
                      <TableCell align="right">{i.cumulativeQuantity}</TableCell>
                      <TableCell align="right">{fmt(i.unitPrice)}</TableCell>
                      <TableCell align="right"><strong>{fmt(i.currentAmount)}</strong></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            </>
            )}

            <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Grid container spacing={1}>
                <Grid item xs={6}><Typography variant="body2">Gross Executed Amount:</Typography></Grid>
                <Grid item xs={6} align="right"><Typography variant="body2" fontWeight={700}>{fmt(viewIpcDialog.grossAmount || viewIpcDialog.invoiceAmount)}</Typography></Grid>

                {viewIpcDialog.retentionAmount > 0 && (
                  <>
                    <Grid item xs={6}><Typography variant="body2" color="error.main">Less Retention Money ({viewIpcDialog.retentionPercentage}%):</Typography></Grid>
                    <Grid item xs={6} align="right"><Typography variant="body2" color="error.main">−{fmt(viewIpcDialog.retentionAmount)}</Typography></Grid>
                  </>
                )}
                {viewIpcDialog.advanceRecoveryAmount > 0 && (
                  <>
                    <Grid item xs={6}><Typography variant="body2" color="error.main">Less Advance Recovery:</Typography></Grid>
                    <Grid item xs={6} align="right"><Typography variant="body2" color="error.main">−{fmt(viewIpcDialog.advanceRecoveryAmount)}</Typography></Grid>
                  </>
                )}
                {viewIpcDialog.whtAmount > 0 && (
                  <>
                    <Grid item xs={6}><Typography variant="body2" color="error.main">Less Withholding Tax ({viewIpcDialog.whtPercentage}%):</Typography></Grid>
                    <Grid item xs={6} align="right"><Typography variant="body2" color="error.main">−{fmt(viewIpcDialog.whtAmount)}</Typography></Grid>
                  </>
                )}
                <Grid item xs={12}><Divider sx={{ my: 1 }} /></Grid>
                <Grid item xs={6}><Typography variant="subtitle1" fontWeight={800} color="success.main">Net Amount Payable:</Typography></Grid>
                <Grid item xs={6} align="right"><Typography variant="subtitle1" fontWeight={800} color="success.main">{fmt(viewIpcDialog.netPayableAmount || viewIpcDialog.invoiceAmount)}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2">Paid to date:</Typography></Grid>
                <Grid item xs={6} align="right"><Typography variant="body2">{fmt(viewIpcDialog.paidAmount)}</Typography></Grid>
                <Grid item xs={6}><Typography variant="body2" fontWeight={700}>Balance due:</Typography></Grid>
                <Grid item xs={6} align="right"><Typography variant="body2" fontWeight={700}>{fmt(balanceOf(viewIpcDialog))}</Typography></Grid>
              </Grid>
            </Box>

            {(viewIpcDialog.payments || []).length > 0 && (
              <>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2, mb: 1 }}>Payments</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow><TableCell>Date</TableCell><TableCell>Method</TableCell><TableCell>Reference</TableCell><TableCell align="right">Amount</TableCell></TableRow>
                  </TableHead>
                  <TableBody>
                    {viewIpcDialog.payments.map((pmt, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{dayjs(pmt.paidDate).format('DD MMM YYYY')}</TableCell>
                        <TableCell>{pmt.paymentMethod || '—'}</TableCell>
                        <TableCell>{pmt.paymentReference || '—'}</TableCell>
                        <TableCell align="right">{fmt(pmt.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            {inChain(viewIpcDialog) && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Approval</Typography>
                {viewIpcFull ? <IpcApprovalTrail ipc={viewIpcFull} /> : <Skeleton height={80} />}
                {viewIpcFull?.approvalStatus === 'Approved' && !(viewIpcFull.financeApBillId || viewIpcFull.financeArId) && (
                  <Button size="small" variant="outlined" sx={{ mt: 1 }} onClick={handleRetryFinance}>Retry posting to Finance</Button>
                )}
              </Box>
            )}
            {viewIpcDialog.status === 'Cancelled' && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Cancelled{viewIpcDialog.cancelledAt ? ` on ${dayjs(viewIpcDialog.cancelledAt).format('DD MMM YYYY')}` : ''}
                {viewIpcDialog.cancellationReason ? ` — ${viewIpcDialog.cancellationReason}` : ''}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setViewIpcDialog(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Mark as Paid Dialog */}
      <Dialog open={payDialogOpen} onClose={() => setPayDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Record Payment</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {payingInvoice && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {payingInvoice.invoiceNumber} — Net payable {fmt(payingInvoice.netPayableAmount || payingInvoice.invoiceAmount)} ·
              Paid {fmt(payingInvoice.paidAmount)} · <strong>Due {fmt(balanceOf(payingInvoice))}</strong>
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField fullWidth label="Amount paid now (PKR)" type="number"
                value={payForm.amount}
                onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                inputProps={{ min: 0, max: payingInvoice ? balanceOf(payingInvoice) : undefined }}
                helperText="Enter less than the balance for a part payment" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth type="date" label="Payment Date" InputLabelProps={{ shrink: true }}
                value={payForm.paidDate}
                onChange={e => setPayForm(p => ({ ...p, paidDate: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select value={payForm.paymentMethod} label="Payment Method"
                  onChange={e => setPayForm(p => ({ ...p, paymentMethod: e.target.value }))}>
                  {['Cash', 'Cheque', 'Bank Transfer', 'Online', 'Other'].map(m =>
                    <MenuItem key={m} value={m}>{m}</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Reference / Cheque No."
                value={payForm.paymentReference}
                onChange={e => setPayForm(p => ({ ...p, paymentReference: e.target.value }))} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={handleMarkPaid} disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : <PaidIcon />}>
            {saving ? 'Saving…' : 'Record Payment'}
          </Button>
        </DialogActions>
      </Dialog>
      <IpcKindDialog
        open={Boolean(kindDialog)}
        kind={kindDialog?.kind}
        editing={kindDialog?.editing || null}
        projectId={project._id}
        balances={balances}
        onClose={() => setKindDialog(null)}
        onSaved={(message) => { setKindDialog(null); setSuccess(message || 'Saved'); load(); }}
      />
    </Box>
  );
};

export default ProjectInvoicesTab;
