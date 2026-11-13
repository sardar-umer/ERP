import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Paper, Typography, Grid, TextField, MenuItem, Button, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Checkbox,
  Tabs, Tab, Chip, CircularProgress, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, Badge, List, ListItemButton, ListItemText, TablePagination
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Send as SendIcon, InfoOutlined as InfoIcon,
  AttachFile as AttachFileIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { getImageUrl } from '../../utils/imageService';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_ROWS_PER_PAGE = 100;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp';
const attachmentName = (a) => a.originalName || a.name || a.filename || 'Attachment';
const formatFileSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (!n) return '';
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

/** Upload picked files; returns the saved-file details to store on the bill. */
const uploadBillFiles = async (files) => {
  if (!files.length) return [];
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  const res = await api.post('/procurement/vendor-bills/attachments', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return res.data?.data || [];
};

/** Attach button + chips. `saved` are files already on the bill, `files` are newly picked ones. */
const AttachmentPicker = ({ saved = [], files, onFiles, onRemoveSaved, onError, disabled }) => {
  const count = saved.length + files.length;
  const onPick = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    const tooBig = picked.find((f) => f.size > MAX_ATTACHMENT_SIZE);
    if (tooBig) {
      onError(`${tooBig.name} is larger than 10 MB`);
      return;
    }
    if (count + picked.length > MAX_ATTACHMENTS) {
      onError(`Maximum ${MAX_ATTACHMENTS} attachments per bill`);
      return;
    }
    onFiles([...files, ...picked]);
  };
  return (
    <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
      <Button variant="outlined" size="small" component="label" startIcon={<AttachFileIcon />} disabled={disabled}>
        Add attachment
        <input type="file" hidden multiple accept={ATTACHMENT_ACCEPT} onChange={onPick} />
      </Button>
      {count === 0 && (
        <Typography variant="caption" color="text.secondary">
          Vendor invoice, delivery challan etc. — PDF, image, Word or Excel, up to 10 MB each
        </Typography>
      )}
      {saved.map((a) => (
        <Chip
          key={a.path}
          size="small"
          variant="outlined"
          label={attachmentName(a)}
          component="a"
          href={getImageUrl(a.path)}
          target="_blank"
          rel="noopener noreferrer"
          clickable
          onDelete={disabled ? undefined : (e) => { e.preventDefault(); onRemoveSaved(a); }}
        />
      ))}
      {files.map((f, i) => (
        <Chip
          key={`${f.name}-${i}`}
          size="small"
          color="primary"
          variant="outlined"
          label={`${f.name}${formatFileSize(f.size) ? ` (${formatFileSize(f.size)})` : ''}`}
          onDelete={disabled ? undefined : () => onFiles(files.filter((_, idx) => idx !== i))}
        />
      ))}
    </Stack>
  );
};

const VendorBills = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusBillId = searchParams.get('bill') || '';
  const [tabIndex, setTabIndex] = useState(focusBillId ? 1 : 0);
  const [reasonBill, setReasonBill] = useState(null);
  const [editBill, setEditBill] = useState(null);
  const [editForm, setEditForm] = useState({ vendorInvoiceNumber: '', billDate: '', paymentTerms: 'net_30', notes: '' });
  const [resubmitBill, setResubmitBill] = useState(null);
  const [resubmitComments, setResubmitComments] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [grns, setGrns] = useState([]);
  const [createdBills, setCreatedBills] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [billsTotal, setBillsTotal] = useState(0);
  const [billsRejected, setBillsRejected] = useState(0);
  const [billsPage, setBillsPage] = useState(0);
  const [billsRowsPerPage, setBillsRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [grnPage, setGrnPage] = useState(0);
  const [grnRowsPerPage, setGrnRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [selected, setSelected] = useState({});
  const [allocations, setAllocations] = useState({});
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [billFiles, setBillFiles] = useState([]);
  const [editFiles, setEditFiles] = useState([]);
  const [editSaved, setEditSaved] = useState([]);
  const [attachmentsBill, setAttachmentsBill] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [billToDelete, setBillToDelete] = useState(null);
  const [deletingBill, setDeletingBill] = useState(false);

  const handleOpenDelete = (bill) => {
    setBillToDelete(bill);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!billToDelete) return;
    try {
      setDeletingBill(true);
      await api.delete(`/finance/accounts-payable/${billToDelete._id}`);
      setSuccess(`✓ Bill ${billToDelete.billNumber} voided — its GRN amount is billable again`);
      setDeleteDialogOpen(false);
      setBillToDelete(null);
      loadCreatedBills(vendorId, billsPage, billsRowsPerPage);
      loadGrns(vendorId);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete bill');
    } finally {
      setDeletingBill(false);
    }
  };

  const loadGrns = useCallback(async (vId) => {
    try {
      const params = {};
      if (vId) params.vendorId = vId;
      const res = await api.get('/procurement/vendor-bills/billable-grns', { params });
      setGrns(res.data?.data?.grns || []);
      setGrnPage(0);
      setSelected({});
      setAllocations({});
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load billable GRNs');
    }
  }, []);

  // Bills are fetched one page at a time; `page` is zero-based here, one-based on the server
  const loadCreatedBills = useCallback(async (vId, page = 0, rowsPerPage = DEFAULT_ROWS_PER_PAGE) => {
    try {
      setBillsLoading(true);
      const params = { limit: rowsPerPage, page: page + 1 };
      if (vId) params.vendorId = vId;
      const res = await api.get('/procurement/vendor-bills', { params });
      const data = res.data?.data || {};
      setCreatedBills(data.bills || []);
      setBillsTotal(data.total ?? (data.bills || []).length);
      setBillsRejected(data.rejectedCount ?? (data.bills || []).filter((b) => b.status === 'Returned from Audit').length);
      // The page emptied (e.g. its last bill was voided) — step back to the last page that has bills
      if (page > 0 && (data.bills || []).length === 0) {
        setBillsPage(Math.max(0, Math.ceil((data.total || 0) / rowsPerPage) - 1));
      }
    } catch (e) {
      setError('Failed to load created vendor bills');
    } finally {
      setBillsLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/procurement/vendors', { params: { limit: 1000 } });
        setVendors(res.data?.data?.vendors || []);
      } catch {
        setError('Failed to load vendors');
      }
    })();
    api.get('/indents/companies')
      .then((res) => setCompanies(res.data?.data || []))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    loadGrns(vendorId);
  }, [vendorId, loadGrns]);

  useEffect(() => {
    loadCreatedBills(vendorId, billsPage, billsRowsPerPage);
  }, [vendorId, billsPage, billsRowsPerPage, loadCreatedBills]);

  // A different vendor is a different list — start again from its first page
  const changeVendor = (id) => {
    setVendorId(id);
    setBillsPage(0);
  };

  // Bill list returns the company id only; name it from the companies list
  const billCompanyName = (b) => {
    if (b.companyId && typeof b.companyId === 'object') return b.companyId.name || '—';
    const id = String(b.companyId || '');
    return companies.find((c) => String(c._id) === id)?.name || b.company || '—';
  };

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const total = useMemo(() => grns.filter((g) => selected[g._id]).reduce((s, g) => s + (Number(allocations[g._id]) || 0), 0), [grns, selected, allocations]);

  const onCreate = async () => {
    if (!vendorId || selectedIds.length === 0) {
      setError('Select vendor and at least one GRN');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const attachments = await uploadBillFiles(billFiles);
      const res = await api.post('/procurement/vendor-bills', {
        vendorId,
        grnIds: selectedIds,
        grnAllocations: selectedIds.map((id) => ({ grnId: id, amount: Number(allocations[id]) || 0 })).filter((x) => x.amount > 0),
        billDate,
        paymentTerms,
        vendorInvoiceNumber,
        notes,
        attachments
      });
      const newBillNo = res.data?.data?.billNumber || 'success';
      setSuccess(`✓ Bill created successfully: ${newBillNo}`);
      setSelected({});
      setAllocations({});
      setVendorInvoiceNumber('');
      setNotes('');
      setBillFiles([]);
      // Refresh both unbilled GRNs and created bills list, and switch to Created Bills tab
      // The new bill is the newest, so it is on the first page
      await Promise.all([loadGrns(vendorId), loadCreatedBills(vendorId, 0, billsRowsPerPage)]);
      setBillsPage(0);
      setTabIndex(1);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to create vendor bill');
    } finally {
      setLoading(false);
    }
  };

  const rejectedCount = billsRejected;
  const pagedGrns = useMemo(
    () => grns.slice(grnPage * grnRowsPerPage, grnPage * grnRowsPerPage + grnRowsPerPage),
    [grns, grnPage, grnRowsPerPage]
  );

  const openEdit = (b) => {
    setEditForm({
      vendorInvoiceNumber: b.vendorInvoiceNumber || '',
      billDate: b.billDate ? String(b.billDate).slice(0, 10) : '',
      paymentTerms: b.paymentTerms || 'net_30',
      notes: b.notes || ''
    });
    setEditSaved(b.attachments || []);
    setEditFiles([]);
    setEditBill(b);
  };

  const saveEdit = async () => {
    if (!editBill) return;
    try {
      setActionBusy(true);
      const uploaded = await uploadBillFiles(editFiles);
      const res = await api.put(`/procurement/vendor-bills/${editBill._id}`, {
        ...editForm,
        attachments: [...editSaved, ...uploaded]
      });
      setSuccess(res.data?.message || 'Bill updated');
      setEditBill(null);
      loadCreatedBills(vendorId, billsPage, billsRowsPerPage);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.errors?.[0]?.msg || 'Failed to update bill');
    } finally {
      setActionBusy(false);
    }
  };

  const doResubmit = async () => {
    if (!resubmitBill) return;
    try {
      setActionBusy(true);
      const res = await api.post(`/procurement/vendor-bills/${resubmitBill._id}/resubmit`, { comments: resubmitComments });
      setSuccess(res.data?.message || 'Bill resubmitted to Pre-Audit');
      setResubmitBill(null);
      setResubmitComments('');
      loadCreatedBills(vendorId, billsPage, billsRowsPerPage);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to resubmit bill');
    } finally {
      setActionBusy(false);
    }
  };

  const getBillStatusColor = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('paid')) return 'success';
    if (s.includes('partial')) return 'warning';
    if (s.includes('pending audit')) return 'warning';
    if (s.includes('forwarded')) return 'info';
    if (s.includes('returned')) return 'error';
    if (s.includes('posted') || s.includes('approved')) return 'info';
    if (s.includes('cancel')) return 'error';
    return 'default';
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Procurement GRN's & Bills</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/procurement/vendor-bills/new')}
          >
            Create Bill
          </Button>
        </Box>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField fullWidth select label="Supplier/Vendor" value={vendorId} onChange={(e) => changeVendor(e.target.value)}>
              <MenuItem value="">Select vendor (All)</MenuItem>
              {vendors.map((v) => <MenuItem key={v._id} value={v._id}>{v.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField fullWidth type="date" label="Bill Date" value={billDate} onChange={(e) => setBillDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField fullWidth select label="Terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
              <MenuItem value="due_on_receipt">Due on receipt</MenuItem>
              <MenuItem value="net_15">Net 15</MenuItem>
              <MenuItem value="net_30">Net 30</MenuItem>
              <MenuItem value="net_45">Net 45</MenuItem>
              <MenuItem value="net_60">Net 60</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              fullWidth
              label="Vendor Bill No."
              value={vendorInvoiceNumber}
              onChange={(e) => setVendorInvoiceNumber(e.target.value)}
              placeholder="Auto-generated if blank"
              helperText="Optional (Auto-generated)"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <Button fullWidth variant="contained" disabled={loading || !vendorId || selectedIds.length === 0} onClick={onCreate}>
              {loading ? <CircularProgress size={24} /> : 'Create Bill'}
            </Button>
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <AttachmentPicker files={billFiles} onFiles={setBillFiles} onError={setError} disabled={loading} />
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Tabs value={tabIndex} onChange={(e, v) => setTabIndex(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tab label={`Unbilled GRNs (${grns.length})`} />
          <Tab label={`Created Vendor Bills (${billsTotal})${rejectedCount ? ` · ${rejectedCount} rejected by Audit` : ''}`} />
        </Tabs>

        {tabIndex === 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Billable GRNs (Bill → GRN → PO) | Selected Total: {formatPKR(total)}
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell />
                    <TableCell>GRN</TableCell>
                    <TableCell>Company</TableCell>
                    <TableCell>Supplier / Vendor</TableCell>
                    <TableCell>PO</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Billing</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Billed</TableCell>
                    <TableCell align="right">Remaining</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pagedGrns.map((g) => (
                    <TableRow key={g._id}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={!!selected[g._id]}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            if (checked && !vendorId && g.vendorId) {
                              changeVendor(String(g.vendorId));
                            }
                            setSelected((p) => ({ ...p, [g._id]: checked }));
                            if (checked) {
                              setAllocations((p) => ({ ...p, [g._id]: Number(g.remainingAmount) || 0 }));
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell>{g.receiveNumber}</TableCell>
                      <TableCell>{g.companyName || '—'}</TableCell>
                      <TableCell>{g.vendorName || '—'}</TableCell>
                      <TableCell>{g.poNumber || '-'}</TableCell>
                      <TableCell>{g.status}</TableCell>
                      <TableCell>{g.billingStatus}</TableCell>
                      <TableCell align="right">{formatPKR(g.amount || 0)}</TableCell>
                      <TableCell align="right">{formatPKR(g.billedAmount || 0)}</TableCell>
                      <TableCell align="right">{formatPKR(g.remainingAmount || 0)}</TableCell>
                      <TableCell align="right" sx={{ width: 180 }}>
                        <TextField
                          size="small"
                          type="number"
                          value={allocations[g._id] ?? (selected[g._id] ? (Number(g.remainingAmount) || 0) : 0)}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setAllocations((p) => ({ ...p, [g._id]: v }));
                          }}
                          inputProps={{ min: 0, max: Number(g.remainingAmount) || 0, step: 0.01 }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {grns.length === 0 && (
                    <TableRow><TableCell colSpan={11} align="center">No billable GRNs found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={grns.length}
              page={grnPage}
              onPageChange={(e, p) => setGrnPage(p)}
              rowsPerPage={grnRowsPerPage}
              onRowsPerPageChange={(e) => { setGrnRowsPerPage(parseInt(e.target.value, 10)); setGrnPage(0); }}
              rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            />
          </Box>
        )}

        {tabIndex === 1 && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Created Vendor Bills & Payment Status
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Bill #</TableCell>
                    <TableCell>GRN(s)</TableCell>
                    <TableCell>Company</TableCell>
                    <TableCell>Vendor Invoice #</TableCell>
                    <TableCell>Supplier / Vendor</TableCell>
                    <TableCell>Bill Date</TableCell>
                    <TableCell>Due Date</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Total Amount</TableCell>
                    <TableCell align="right">Balance Due</TableCell>
                    <TableCell align="center">Files</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {billsLoading ? (
                    <TableRow><TableCell colSpan={12} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                  ) : createdBills.length === 0 ? (
                    <TableRow><TableCell colSpan={12} align="center">No vendor bills created yet</TableCell></TableRow>
                  ) : (
                    createdBills.map((b) => {
                      const rejected = b.status === 'Returned from Audit';
                      return (
                      <TableRow
                        key={b._id}
                        hover
                        selected={String(b._id) === focusBillId}
                        sx={rejected ? { bgcolor: 'rgba(211, 47, 47, 0.06)' } : undefined}
                      >
                        <TableCell><Typography variant="body2" fontWeight="bold">{b.billNumber}</Typography></TableCell>
                        <TableCell>{(b.linkedGRNs || []).map((l) => l.grnNumber).filter(Boolean).join(', ') || '—'}</TableCell>
                        <TableCell>{billCompanyName(b)}</TableCell>
                        <TableCell>{b.vendorInvoiceNumber || '—'}</TableCell>
                        <TableCell>{b.vendorName || b.supplierName || '—'}</TableCell>
                        <TableCell>{formatDate(b.billDate)}</TableCell>
                        <TableCell>{formatDate(b.dueDate)}</TableCell>
                        <TableCell>
                          <Chip
                            label={rejected ? 'Rejected by Audit' : (b.status || 'Draft')}
                            size="small"
                            color={getBillStatusColor(b.status)}
                          />
                          {rejected && b.auditReturn?.reason && (
                            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, maxWidth: 260 }}>
                              {b.auditReturn.reason}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right"><Typography variant="body2" fontWeight="bold">{formatPKR(b.totalAmount || b.amount || 0)}</Typography></TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" color={b.balanceDue > 0 ? 'error.main' : 'success.main'} fontWeight="bold">
                            {formatPKR(b.balanceDue != null ? b.balanceDue : (b.totalAmount || 0))}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          {(b.attachments || []).length > 0 ? (
                            <Tooltip title={`View ${b.attachments.length} attachment${b.attachments.length > 1 ? 's' : ''}`}>
                              <IconButton size="small" onClick={() => setAttachmentsBill(b)}>
                                <Badge badgeContent={b.attachments.length} color="primary">
                                  <AttachFileIcon fontSize="small" />
                                </Badge>
                              </IconButton>
                            </Tooltip>
                          ) : '—'}
                        </TableCell>
                        <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                          {rejected && (
                            <>
                              <Tooltip title="Why Audit rejected it">
                                <IconButton size="small" color="error" onClick={() => setReasonBill(b)}>
                                  <InfoIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Edit bill (invoice #, date, terms, notes, attachments)">
                                <IconButton size="small" color="primary" onClick={() => openEdit(b)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Resubmit to Pre-Audit">
                                <IconButton size="small" color="warning" onClick={() => { setResubmitComments(''); setResubmitBill(b); }}>
                                  <SendIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          <Tooltip title={b.amountPaid > 0 ? 'Cannot void bill with recorded payments' : 'Void bill (its amount goes back to the GRN for re-billing)'}>
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleOpenDelete(b)}
                                disabled={b.amountPaid > 0}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={billsTotal}
              page={billsPage}
              onPageChange={(e, p) => setBillsPage(p)}
              rowsPerPage={billsRowsPerPage}
              onRowsPerPageChange={(e) => { setBillsRowsPerPage(parseInt(e.target.value, 10)); setBillsPage(0); }}
              rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            />
          </Box>
        )}
      </Paper>

      {/* Audit rejection reason */}
      <Dialog open={!!reasonBill} onClose={() => setReasonBill(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Bill {reasonBill?.billNumber} — rejected by Audit</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {reasonBill?.auditReturn?.returnedBy ? `By ${reasonBill.auditReturn.returnedBy}` : 'By Audit'}
            {reasonBill?.auditReturn?.returnedAt ? ` on ${formatDate(reasonBill.auditReturn.returnedAt)}` : ''}
          </Typography>
          <Alert severity="error" sx={{ mb: 2 }}>{reasonBill?.auditReturn?.reason || 'No reason recorded'}</Alert>
          {(reasonBill?.auditReturn?.observations || []).length > 0 && (
            <>
              <Typography variant="subtitle2" gutterBottom>Observations</Typography>
              {reasonBill.auditReturn.observations.map((o, i) => (
                <Typography key={i} variant="body2" sx={{ mb: 0.5 }}>• [{o.severity}] {o.observation}</Typography>
              ))}
            </>
          )}
          <Alert severity="info" sx={{ mt: 2 }}>
            Rejection of a bill does not change stock. If the bill details are wrong, Edit and Resubmit.
            If the GRN itself is wrong (quantity / item / rate), void this bill — its amount goes back to the GRN — correct the GRN, then create a new bill.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReasonBill(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Edit returned bill */}
      <Dialog open={!!editBill} onClose={() => !actionBusy && setEditBill(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Edit bill {editBill?.billNumber}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Vendor Bill No." value={editForm.vendorInvoiceNumber} onChange={(e) => setEditForm((f) => ({ ...f, vendorInvoiceNumber: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth type="date" label="Bill Date" value={editForm.billDate} onChange={(e) => setEditForm((f) => ({ ...f, billDate: e.target.value }))} InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth select label="Terms" value={editForm.paymentTerms} onChange={(e) => setEditForm((f) => ({ ...f, paymentTerms: e.target.value }))}>
                <MenuItem value="due_on_receipt">Due on receipt</MenuItem>
                <MenuItem value="net_15">Net 15</MenuItem>
                <MenuItem value="net_30">Net 30</MenuItem>
                <MenuItem value="net_45">Net 45</MenuItem>
                <MenuItem value="net_60">Net 60</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth disabled label="Amount (from GRN)" value={formatPKR(editBill?.totalAmount || 0)} helperText="To change the amount, void and re-bill from the corrected GRN" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth multiline minRows={2} label="Notes" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <AttachmentPicker
                saved={editSaved}
                files={editFiles}
                onFiles={setEditFiles}
                onRemoveSaved={(a) => setEditSaved((list) => list.filter((x) => x.path !== a.path))}
                onError={setError}
                disabled={actionBusy}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditBill(null)} disabled={actionBusy} color="inherit">Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={actionBusy}>{actionBusy ? 'Saving...' : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      {/* Bill attachments */}
      <Dialog open={!!attachmentsBill} onClose={() => setAttachmentsBill(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Attachments — {attachmentsBill?.billNumber}</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <List dense disablePadding>
            {(attachmentsBill?.attachments || []).map((a) => (
              <ListItemButton key={a.path} component="a" href={getImageUrl(a.path)} target="_blank" rel="noopener noreferrer">
                <AttachFileIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} />
                <ListItemText
                  primary={attachmentName(a)}
                  secondary={[formatFileSize(a.size), a.uploadedAt ? formatDate(a.uploadedAt) : ''].filter(Boolean).join(' · ')}
                  primaryTypographyProps={{ sx: { wordBreak: 'break-word' } }}
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAttachmentsBill(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Resubmit to Pre-Audit */}
      <Dialog open={!!resubmitBill} onClose={() => !actionBusy && setResubmitBill(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Resubmit {resubmitBill?.billNumber} to Pre-Audit</DialogTitle>
        <DialogContent dividers>
          {resubmitBill?.auditReturn?.reason && (
            <Alert severity="error" sx={{ mb: 2 }}>Audit said: {resubmitBill.auditReturn.reason}</Alert>
          )}
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="What did you correct?"
            value={resubmitComments}
            onChange={(e) => setResubmitComments(e.target.value)}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResubmitBill(null)} disabled={actionBusy} color="inherit">Cancel</Button>
          <Button variant="contained" color="warning" onClick={doResubmit} disabled={actionBusy || !resubmitComments.trim()}>
            {actionBusy ? 'Resubmitting...' : 'Resubmit'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => !deletingBill && setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: 'error.main', display: 'flex', alignItems: 'center', gap: 1 }}>
          <DeleteIcon /> Void Vendor Bill
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            Are you sure you want to void bill <strong>{billToDelete?.billNumber}</strong> ({billToDelete?.vendorName || billToDelete?.supplierName}) for <strong>{formatPKR(billToDelete?.totalAmount || billToDelete?.amount || 0)}</strong>?
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
            Its journal is reversed and its amount goes back to the GRN(s), which then appear again under Unbilled GRNs. Stock is not changed.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deletingBill} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmDelete}
            disabled={deletingBill}
          >
            {deletingBill ? 'Voiding...' : 'Void Bill'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VendorBills;

