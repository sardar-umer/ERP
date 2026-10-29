import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Tooltip,
  Chip,
  Alert,
  Stack,
  Divider,
  Grid,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Autocomplete,
  Tabs,
  Tab
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  CheckCircle as ApproveIcon,
  ShoppingCart as POIcon,
  Print as PrintIcon,
  CallSplit as SplitIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { getDocCompanyName } from '../../utils/documentCompany';
import procurementService from '../../services/procurementService';
import { formatDate } from '../../utils/dateUtils';
import { formatPKR } from '../../utils/currency';
import dayjs from 'dayjs';
import QuotationDetailView from '../../components/Procurement/QuotationDetailView';
import ComparativeRejectionObservationsAlert from '../../components/Procurement/ComparativeRejectionObservationsAlert';
import {
  isBlankQuoteItem,
  isQuoteLineStillOrderable
} from '../../utils/comparativeQuoteItemMatch';

const Quotations = () => {
  const navigate = useNavigate();
  // State management
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [quotations, setQuotations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  /** When true, requisition dropdown is limited to API `mineOnly` (assigned to current user). */
  const [requisitionsFilteredToAssignee, setRequisitionsFilteredToAssignee] = useState(false);
  
  // Pagination and filters
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(250);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  // Dialog states
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', data: null, requisition: null, editReason: null });
  const [editReasonDialog, setEditReasonDialog] = useState({ open: false, quotation: null });
  const [viewDialog, setViewDialog] = useState({ open: false, data: null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: null });
  const [indentsWithSplitAssignments, setIndentsWithSplitAssignments] = useState([]);
  const [loadingSplitIndents, setLoadingSplitIndents] = useState(false);
  const [creatingSplitPOForIndent, setCreatingSplitPOForIndent] = useState(null);
  const [expandedRequisitions, setExpandedRequisitions] = useState({});
  
  // Form data
  const [formData, setFormData] = useState({
    indent: '',
    vendor: '',
    lotNumber: 'A',
    quotationDate: new Date().toISOString().split('T')[0],
    expiryDate: '',
    status: 'Received',
    items: [],
    validityDays: 30,
    deliveryTime: '',
    paymentTerms: '',
    deliveryPlace: '',
    freightCarriage: '',
    installation: '',
    freight: '',
    notes: '',
    attachments: []
  });
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  const [termTab, setTermTab] = useState(0);

  const loadIndentsWithSplitAssignments = useCallback(async () => {
    try {
      setLoadingSplitIndents(true);
      const response = await api.get('/procurement/indents-with-split-assignments');
      if (response.data?.success) {
        setIndentsWithSplitAssignments(response.data.data || []);
      }
    } catch {
      setIndentsWithSplitAssignments([]);
    } finally {
      setLoadingSplitIndents(false);
    }
  }, []);

  // Load data on component mount
  useEffect(() => {
    loadQuotations();
    loadVendors();
    loadRequisitions();
    loadIndentsWithSplitAssignments();
  }, [page, rowsPerPage, search, statusFilter]);

  const loadQuotations = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        search: search || undefined,
        status: statusFilter || undefined
      };
      
      const response = await procurementService.getQuotations(params);
      if (response.success) {
        setQuotations(response.data?.quotations || []);
        setTotalItems(response.data?.pagination?.totalItems || 0);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search, statusFilter]);

  const loadVendors = async () => {
    try {
      const response = await procurementService.getVendors({ limit: 1000 });
      if (response.success) {
        setVendors(response.data?.vendors || []);
      }
    } catch (err) {
      console.error('Failed to load vendors:', err);
    }
  };

  const loadRequisitions = async () => {
    try {
      const probe = await procurementService.getRequisitions({
        page: 1,
        limit: 1
      });
      const canManageAssignments = Boolean(probe?.data?.canManageAssignments);
      setRequisitionsFilteredToAssignee(!canManageAssignments);
      const params = {
        page: 1,
        limit: 1000,
        ...(canManageAssignments ? {} : { mineOnly: 'true' })
      };
      const response = await procurementService.getRequisitions(params);
      if (response.success) {
        setRequisitions(response.data?.indents || []);
      }
    } catch (err) {
      console.error('Failed to load requisitions:', err);
    }
  };

  const handleCreate = (requisition) => {
    if (requisition) {
      setFormData({
        indent: requisition._id,
        vendor: '',
        quotationDate: new Date().toISOString().split('T')[0],
        expiryDate: '',
        status: 'Received',
        items: requisition.items.map(item => {
          const isFulfilled = (item.orderedQuantity || 0) >= item.quantity;
          return {
            description: item.itemName,
            specification: item.specification || item.description || '',
            brand: item.brand || '',
            quantity: isFulfilled ? 0 : item.quantity,
            unit: item.unit || 'Piece',
            unitPrice: 0,
            taxRate: 0,
            discount: 0,
            amount: 0,
            isFulfilled
          };
        }),
        validityDays: 30,
        deliveryTime: '',
        paymentTerms: '',
        deliveryPlace: '',
        freightCarriage: '',
        installation: '',
        freight: '',
        notes: '',
        attachments: []
      });
      setAttachmentFiles([]);
      setTermTab(0);
      setFormDialog({ open: true, mode: 'create', data: null, requisition });
    } else {
      setFormData({
        indent: '',
        vendor: '',
        quotationDate: new Date().toISOString().split('T')[0],
        expiryDate: '',
        status: 'Received',
        items: [{ description: '', specification: '', brand: '', quantity: 1, unit: 'pcs', unitPrice: 0, taxRate: 0, discount: 0, amount: 0 }],
        validityDays: 30,
        deliveryTime: '',
        paymentTerms: '',
        deliveryPlace: '',
        freightCarriage: '',
        installation: '',
        freight: '',
        notes: '',
        attachments: []
      });
      setAttachmentFiles([]);
      setTermTab(0);
      setFormDialog({ open: true, mode: 'create', data: null, requisition: null });
    }
  };

  const handleEdit = (quotation) => {
    setEditReasonDialog({ open: true, quotation });
  };

  const handleProceedToEdit = () => {
    const quotation = editReasonDialog.quotation;
    setFormData({
      indent: quotation.indent?._id || quotation.indent || '',
      vendor: quotation.vendor?._id || quotation.vendor || '',
      quotationDate: new Date(quotation.quotationDate).toISOString().split('T')[0],
      expiryDate: quotation.expiryDate ? new Date(quotation.expiryDate).toISOString().split('T')[0] : '',
      status: quotation.status,
      items: (quotation.items || []).map((item) => ({
        ...item,
        specification: item.specification || '',
        brand: item.brand || ''
      })),
      validityDays: quotation.validityDays || 30,
      deliveryTime: quotation.deliveryTime || '',
      paymentTerms: quotation.paymentTerms || '',
      deliveryPlace: quotation.deliveryPlace || quotation.delivery_location || '',
      freightCarriage: quotation.freightCarriage || quotation.freight_carriage || '',
      installation: quotation.installation || quotation.installationDetails || '',
      freight: quotation.freight || '',
      notes: quotation.notes || '',
      attachments: quotation.attachments || []
    });
    setAttachmentFiles([]);
    setTermTab(0);
    setFormDialog({ open: true, mode: 'edit', data: quotation, requisition: null, editReason: 'Negotiating purpose' });
    setEditReasonDialog({ open: false, quotation: null });
  };

  const handleView = async (quotation) => {
    try {
      const response = await procurementService.getQuotationById(quotation._id);
      // API returns { success, data: quotation }; use data so expiryDate and vendor show correctly
      const quotationData = (response && response.success && response.data) ? response.data : quotation;
      setViewDialog({ open: true, data: quotationData });
    } catch (err) {
      setViewDialog({ open: true, data: quotation });
    }
  };

  const formatDateForPrint = (date) => {
    if (date === undefined || date === null || date === '') return '';
    const d = dayjs(date);
    return d.isValid() ? d.format('DD/MM/YYYY') : '';
  };

  const formatDateForQuotation = (date) => {
    if (!date) return '';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const d = new Date(date);
    return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined) return '0.00';
    return parseFloat(num).toFixed(2);
  };

  const handleDelete = (id) => {
    setDeleteDialog({ open: true, id });
  };

  const handleFinalize = async (id, groupQuotes = [], indentStatus = '') => {
    const isPartiallyFulfilled = indentStatus === 'Partially Fulfilled';
    const otherActive = (groupQuotes || []).find(
      (q) => q._id !== id && (isPartiallyFulfilled ? q.status === 'Shortlisted' : ['Finalized', 'Shortlisted'].includes(q.status))
    );
    if (otherActive) {
      setError(`Cannot finalize: Quotation ${otherActive.quotationNumber} is currently ${otherActive.status.toLowerCase()} for this requisition.`);
      return;
    }

    try {
      setLoading(true);
      const response = await procurementService.updateQuotation(id, { status: 'Finalized' });
      setSuccess(response.message || response.data?.message || 'Quotation finalized successfully. Use Create PO to create Purchase Order.');
      loadQuotations();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to finalize quotation');
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteDialog.id) return;
    try {
      setLoading(true);
      const response = await procurementService.deleteQuotation(deleteDialog.id);
      setSuccess(response?.message || 'Quotation deleted successfully');
      setDeleteDialog({ open: false, id: null });
      loadQuotations();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete quotation');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);

      // Upload any new attachment files
      let attachments = [...(formData.attachments || [])];
      if (attachmentFiles.length > 0) {
        for (const file of attachmentFiles) {
          const res = await procurementService.uploadQuotationAttachment(file);
          if (res.success && res.data) {
            attachments.push({ filename: res.data.filename, url: res.data.url });
          }
        }
      }
      
      // Calculate amounts for items
      const itemsToProcess = formData.items.filter((item) => {
        if (formDialog.mode === 'edit') return true;
        const otherLotQuote = quotations.find(q => 
          String(q.indent?._id || q.indent) === String(formData.indent) &&
          (q.lotNumber || 'A') !== (formData.lotNumber || 'A') &&
          q.items?.some(qi => qi.description === item.description && qi.quantity > 0)
        );
        return !otherLotQuote;
      });
      
      const items = itemsToProcess.map(item => {
        const subtotal = item.quantity * item.unitPrice;
        const discountAmount = item.discount || 0;
        const afterDiscount = subtotal - discountAmount;
        const taxAmount = (afterDiscount * (item.taxRate || 0)) / 100;
        const amount = afterDiscount + taxAmount;
        
        return {
          ...item,
          amount
        };
      });

      const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      const discountAmount = items.reduce((sum, item) => sum + (item.discount || 0), 0);
      const taxAmount = items.reduce((sum, item) => {
        const afterDiscount = (item.quantity * item.unitPrice) - (item.discount || 0);
        return sum + (afterDiscount * (item.taxRate || 0) / 100);
      }, 0);
      const totalAmount = subtotal - discountAmount + taxAmount;
      const normalizedTerms = {
        deliveryPlace: (formData.deliveryPlace || '').trim(),
        freightCarriage: (formData.freightCarriage || '').trim(),
        installation: (formData.installation || '').trim(),
        freight: (formData.freight || '').trim()
      };

      const quotationData = {
        ...formData,
        ...normalizedTerms,
        delivery_location: normalizedTerms.deliveryPlace,
        delivery_place: normalizedTerms.deliveryPlace,
        carriage: normalizedTerms.freightCarriage,
        freight_carriage: normalizedTerms.freightCarriage,
        installationDetails: normalizedTerms.installation,
        freightCharges: normalizedTerms.freight,
        terms: {
          deliveryPlace: normalizedTerms.deliveryPlace,
          delivery_location: normalizedTerms.deliveryPlace,
          freightCarriage: normalizedTerms.freightCarriage,
          freight_carriage: normalizedTerms.freightCarriage,
          carriage: normalizedTerms.freightCarriage,
          installation: normalizedTerms.installation,
          installationDetails: normalizedTerms.installation,
          freight: normalizedTerms.freight
        },
        items,
        subtotal,
        discountAmount,
        taxAmount,
        totalAmount,
        attachments
      };
      // Omit expiryDate when empty so server doesn't receive '' (causes save error)
      if (!quotationData.expiryDate || !String(quotationData.expiryDate).trim()) {
        delete quotationData.expiryDate;
      }

      if (formDialog.mode === 'create') {
        await procurementService.createQuotation(quotationData);
        setSuccess('Quotation created successfully');
      } else {
        const updateData = { ...quotationData };
        if (formDialog.editReason) {
          updateData.editReason = formDialog.editReason;
        }
        await procurementService.updateQuotation(formDialog.data._id, updateData);
        setSuccess('Quotation updated successfully');
      }
      
      setFormDialog({ open: false, mode: 'create', data: null, requisition: null, editReason: null });
      loadQuotations();
    } catch (err) {
      const res = err.response?.data;
      const msg = res?.message || (Array.isArray(res?.errors) && res.errors[0]?.msg) || err.message || 'Failed to save quotation';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { description: '', specification: '', brand: '', quantity: 1, unit: 'pcs', unitPrice: 0, taxRate: 0, discount: 0, amount: 0 }]
    });
  };

  const removeItem = (index) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index)
    });
  };

  const updateItem = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index][field] = value;
    
    // Recalculate amount
    const item = newItems[index];
    const subtotal = item.quantity * item.unitPrice;
    const discountAmount = item.discount || 0;
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = (afterDiscount * (item.taxRate || 0)) / 100;
    newItems[index].amount = afterDiscount + taxAmount;
    
    setFormData({ ...formData, items: newItems });
  };

  const getStatusColor = (status) => {
    const colors = {
      'Received': 'info',
      'Shortlisted': 'warning',
      'Finalized': 'success',
      'Rejected': 'error'
    };
    return colors[status] || 'default';
  };

  const handleCreateSplitPOsFromSaved = async (indentId) => {
    try {
      setCreatingSplitPOForIndent(indentId);
      setError('');
      const response = await api.post(`/procurement/quotations/by-indent/${indentId}/create-split-pos-from-saved`);
      const pos = response.data.data || [];
      const poNumbers = pos.map(p => p.orderNumber).join(', ');
      setSuccess(`${pos.length} Purchase Order(s) created: ${poNumbers}. You can track them in Purchase Orders.`);
      setTimeout(() => setSuccess(''), 8000);
      loadQuotations();
      loadIndentsWithSplitAssignments();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create split purchase orders');
    } finally {
      setCreatingSplitPOForIndent(null);
    }
  };

  const groupedQuotations = useMemo(() => {
    return quotations.reduce((groups, quote) => {
      const indent = quote.indent || null;
      const key = indent?._id || 'unassigned';
      if (!groups[key]) {
        groups[key] = {
          key,
          indent,
          quotations: []
        };
      }
      groups[key].quotations.push(quote);
      return groups;
    }, {});
  }, [quotations]);

  const groupedQuotationList = useMemo(() => {
    return Object.values(groupedQuotations).sort((a, b) => {
      const aNum = a.indent?.indentNumber || '';
      const bNum = b.indent?.indentNumber || '';
      const extractIndentSequence = (value) => {
        const matches = String(value || '').match(/\d+/g);
        if (!matches || matches.length === 0) return Number.NEGATIVE_INFINITY;
        return parseInt(matches[matches.length - 1], 10);
      };
      const aSeq = extractIndentSequence(aNum);
      const bSeq = extractIndentSequence(bNum);
      if (aSeq !== bSeq) return bSeq - aSeq;
      return bNum.localeCompare(aNum, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [groupedQuotations]);

  const handleRequisitionAccordionChange = (groupKey) => (_, isExpanded) => {
    setExpandedRequisitions((prev) => ({ ...prev, [groupKey]: isExpanded }));
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
            Quotations
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage vendor quotations
          </Typography>
        </Box>
        <Button 
          variant="outlined" 
          startIcon={<RefreshIcon />} 
          onClick={loadQuotations}
          sx={{ mr: 2 }}
        >
          Refresh
        </Button>
        <Button 
          variant="contained" 
          startIcon={<AddIcon />}
          onClick={() => handleCreate(null)}
        >
          New Quotation
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Requisitions ready for Split PO (shortlisted from Comparative Statement) */}
      {(loadingSplitIndents || indentsWithSplitAssignments.length > 0) && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: '#f5f5f5' }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
            Requisitions ready for Split PO
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These requisitions have vendor assignments saved from the Comparative Statement. Create one PO per assigned vendor here.
          </Typography>
          {loadingSplitIndents ? (
            <Typography variant="body2" color="text.secondary">Loading…</Typography>
          ) : indentsWithSplitAssignments.length === 0 ? (
            <Typography variant="body2" color="text.secondary">None. Use Comparative Statement to assign vendors and shortlist, then they will appear here.</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Requisition</strong></TableCell>
                    <TableCell><strong>Company</strong></TableCell>
                    <TableCell><strong>Title</strong></TableCell>
                    <TableCell><strong>Department</strong></TableCell>
                    <TableCell align="right"><strong>Action</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {indentsWithSplitAssignments.map((indent) => (
                    <TableRow key={indent._id}>
                      <TableCell>{indent.indentNumber || '-'}</TableCell>
                      <TableCell>{getDocCompanyName(indent)}</TableCell>
                      <TableCell>{indent.title || '-'}</TableCell>
                      <TableCell>{indent.department?.name || '-'}</TableCell>
                      <TableCell align="right">
                        <Button
                          variant="contained"
                          size="small"
                          color="primary"
                          startIcon={creatingSplitPOForIndent === indent._id ? <CircularProgress size={16} color="inherit" /> : <SplitIcon />}
                          onClick={() => handleCreateSplitPOsFromSaved(indent._id)}
                          disabled={creatingSplitPOForIndent != null}
                        >
                          {creatingSplitPOForIndent === indent._id ? 'Creating…' : 'Create Split POs'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <TextField
            size="small"
            placeholder="Search quotations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="Received">Received</MenuItem>
            <MenuItem value="Shortlisted">Shortlisted</MenuItem>
            <MenuItem value="Finalized">Finalized</MenuItem>
            <MenuItem value="Rejected">Rejected</MenuItem>
          </TextField>
        </Stack>

        {loading ? (
          <Typography align="center">Loading...</Typography>
        ) : groupedQuotationList.length === 0 ? (
          <Typography align="center" color="text.secondary">No quotations found</Typography>
        ) : (
          <Stack spacing={1.5}>
            {groupedQuotationList.map((group, index) => {
              const groupKey = group.key;
              const isExpanded = expandedRequisitions[groupKey] ?? index === 0;
              const requisitionLabel = group.indent?.indentNumber || 'No Requisition Linked';
              const requisitionTitle = group.indent?.title || 'N/A';
              return (
                <Accordion
                  key={groupKey}
                  expanded={isExpanded}
                  onChange={handleRequisitionAccordionChange(groupKey)}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 1 }}>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {requisitionLabel}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {requisitionTitle}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        color="primary"
                        label={`${group.quotations.length} quotation${group.quotations.length > 1 ? 's' : ''}`}
                      />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <ComparativeRejectionObservationsAlert
                      comparativeApproval={group.indent?.comparativeApproval}
                      showComparativeLink
                    />
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell><strong>Quote #</strong></TableCell>
                            <TableCell><strong>Lot</strong></TableCell>
                            <TableCell><strong>Vendor</strong></TableCell>
                            <TableCell><strong>Amount</strong></TableCell>
                            <TableCell><strong>Date</strong></TableCell>
                            <TableCell><strong>Status</strong></TableCell>
                            <TableCell align="center"><strong>Actions</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {group.quotations
                            .sort((a, b) => (a.lotNumber || 'A').localeCompare(b.lotNumber || 'A'))
                            .map((quote) => {
                            const isPartiallyFulfilled = group.indent?.status === 'Partially Fulfilled';
                            const otherActiveQuote = group.quotations.find(
                              (q) => q._id !== quote._id && (isPartiallyFulfilled ? q.status === 'Shortlisted' : ['Finalized', 'Shortlisted'].includes(q.status))
                            );
                            const groupHasPO = !isPartiallyFulfilled && (
                              (group.indent?.items || []).some((it) => (it.orderedQuantity || 0) > 0) ||
                              group.quotations.some((q) => q._id !== quote._id && (q.items || []).some((it) => (it.orderedQuantity || 0) > 0))
                            );
                            const isBlockedByOther = Boolean(otherActiveQuote || groupHasPO);
                            const blockReason = otherActiveQuote
                              ? `Quotation ${otherActiveQuote.quotationNumber} is currently ${otherActiveQuote.status.toLowerCase()} for this requisition`
                              : (groupHasPO ? 'A Purchase Order has already been created for this requisition' : '');

                            return (
                              <TableRow key={quote._id} hover>
                                <TableCell>{quote.quotationNumber}</TableCell>
                                <TableCell>{quote.lotNumber || 'A'}</TableCell>
                                <TableCell>{quote.vendor?.name || '-'}</TableCell>
                                <TableCell>{formatPKR(quote.totalAmount)}</TableCell>
                                <TableCell>{formatDate(quote.quotationDate)}</TableCell>
                                <TableCell>
                                  <Chip
                                    label={quote.status}
                                    color={getStatusColor(quote.status)}
                                    size="small"
                                  />
                                </TableCell>
                                <TableCell align="center">
                                  <Tooltip title="View Details">
                                    <IconButton size="small" onClick={() => handleView(quote)}>
                                      <ViewIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  {quote.status !== 'Finalized' && quote.status !== 'Rejected' && (
                                    <>
                                      <Tooltip title={isBlockedByOther ? `Cannot finalize: ${blockReason}` : "Finalize"}>
                                        <span>
                                          <IconButton
                                            size="small"
                                            color="success"
                                            disabled={isBlockedByOther}
                                            onClick={() => handleFinalize(quote._id, group.quotations, group.indent?.status)}
                                          >
                                            <ApproveIcon fontSize="small" />
                                          </IconButton>
                                        </span>
                                      </Tooltip>
                                      <Tooltip title="Edit (Negotiating purpose only)">
                                        <IconButton size="small" onClick={() => handleEdit(quote)}>
                                          <EditIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </>
                                  )}
                                  {quote.status !== 'Finalized' && (
                                    <Tooltip title="Delete">
                                      <IconButton
                                        size="small"
                                        color="error"
                                        onClick={() => handleDelete(quote._id)}
                                      >
                                        <DeleteIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {quote.status === 'Finalized' && (() => {
                                  const indentItems = group.indent?.items || [];
                                  const quoteItems = (quote.items || []).filter((qItem) => !isBlankQuoteItem(qItem));
                                  const isFullyOrdered = quoteItems.length > 0 && quoteItems.every((qItem, qIdx) => {
                                    // Use original index among full quote.items for matching helpers
                                    const fullIdx = (quote.items || []).indexOf(qItem);
                                    return !isQuoteLineStillOrderable(indentItems, qItem, fullIdx >= 0 ? fullIdx : qIdx);
                                  });

                                  if (isFullyOrdered) {
                                    return (
                                      <Stack direction="row" spacing={0.5} alignItems="center">
                                        <Tooltip title="PO already created for all items in this quotation / indent">
                                          <span>
                                            <IconButton
                                              size="small"
                                              disabled
                                              sx={{ opacity: 0.4 }}
                                            >
                                              <POIcon fontSize="small" />
                                            </IconButton>
                                          </span>
                                        </Tooltip>
                                        <Tooltip title="All items in this quotation / indent have already been ordered into PO(s)">
                                          <Chip
                                            size="small"
                                            label="PO Created"
                                            color="success"
                                            variant="outlined"
                                            sx={{ fontSize: '0.75rem', fontWeight: 600, height: 22 }}
                                          />
                                        </Tooltip>
                                      </Stack>
                                    );
                                  }

                                  return (
                                    <Tooltip title="Create PO">
                                      <IconButton
                                        size="small"
                                        color="primary"
                                        onClick={() => navigate('/procurement/purchase-orders', { state: { createFromQuotationId: quote._id } })}
                                      >
                                        <POIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  );
                                })()}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Stack>
        )}
        <TablePagination
          component="div"
          count={totalItems}
          page={page}
          onPageChange={(e, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[25, 50, 100, 250, 500]}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </Paper>

      {/* EDIT WITH REASON DIALOG */}
      <Dialog open={editReasonDialog.open} onClose={() => setEditReasonDialog({ open: false, quotation: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Quotation</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please confirm the reason for editing this quotation.
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Reason for Edit:</strong> Negotiating purpose
            </Typography>
            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
              Quotations can only be edited for negotiating purpose.
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditReasonDialog({ open: false, quotation: null })}>Cancel</Button>
          <Button variant="contained" onClick={handleProceedToEdit}>
            Proceed to Edit
          </Button>
        </DialogActions>
      </Dialog>

      {/* FORM DIALOG */}
      <Dialog open={formDialog.open} onClose={() => setFormDialog({ open: false, mode: 'create', data: null, requisition: null, editReason: null })} maxWidth="md" fullWidth>
        <DialogTitle>
          {formDialog.mode === 'create' ? 'Create Quotation' : 'Edit Quotation'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              select
              fullWidth
              label="Lot Group"
              value={formData.lotNumber || 'A'}
              onChange={(e) => setFormData({ ...formData, lotNumber: e.target.value })}
            >
              {['A', 'B', 'C', 'D', 'E', 'F'].map(lot => (
                <MenuItem key={lot} value={lot}>Lot {lot}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              label="Requisition"
              value={formData.indent}
              onChange={(e) => {
                const reqId = e.target.value;
                const req = requisitions.find(r => String(r._id) === String(reqId));
                if (req) {
                  setFormData({ 
                    ...formData, 
                    indent: reqId,
                    items: req.items.map(item => {
                      const isFulfilled = (item.orderedQuantity || 0) >= item.quantity;
                      return {
                        description: item.itemName,
                        specification: item.specification || item.description || '',
                        brand: item.brand || '',
                        quantity: isFulfilled ? 0 : item.quantity,
                        unit: item.unit || 'Piece',
                        unitPrice: 0,
                        taxRate: 0,
                        discount: 0,
                        amount: 0,
                        isFulfilled
                      };
                    })
                  });
                } else {
                  setFormData({ ...formData, indent: reqId });
                }
              }}
              helperText={
                requisitionsFilteredToAssignee
                  ? 'Only requisitions assigned to you appear here. Managers see all eligible requisitions.'
                  : 'Approved requisitions you can work on in procurement.'
              }
              FormHelperTextProps={{ sx: { mt: 0.5 } }}
            >
              {requisitions.map(req => (
                <MenuItem key={req._id} value={req._id}>
                  {req.indentNumber} - {req.title}
                </MenuItem>
              ))}
            </TextField>
            <Autocomplete
              fullWidth
              options={vendors}
              value={vendors.find((v) => String(v._id) === String(formData.vendor || '')) || null}
              onChange={(_, selectedVendor) => {
                setFormData({ ...formData, vendor: selectedVendor ? String(selectedVendor._id) : '' });
              }}
              groupBy={(option) => (option.vendorCategory || '').trim() || 'Uncategorized'}
              getOptionLabel={(option) => option?.name || ''}
              isOptionEqualToValue={(option, value) => String(option?._id) === String(value?._id)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Vendor"
                  required
                />
              )}
              ListboxProps={{ style: { maxHeight: 360 } }}
            />
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  type="date"
                  label="Quotation Date"
                  value={formData.quotationDate}
                  onChange={(e) => setFormData({ ...formData, quotationDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  type="date"
                  label="Expiry Date"
                  value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </Grid>
            <TextField
              select
              fullWidth
              label="Status"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
            >
              <MenuItem value="Received">Received</MenuItem>
              <MenuItem 
                value="Shortlisted"
                disabled={(() => {
                  if (!formData.indent) return false;
                  const indentObj = typeof formData.indent === 'object' ? formData.indent : null;
                  const indentId = indentObj ? indentObj._id : formData.indent;
                  const isPartiallyFulfilled = indentObj?.status === 'Partially Fulfilled';
                  const otherQuotes = quotations.filter(q => {
                    const qIndentId = typeof q.indent === 'object' ? q.indent?._id : q.indent;
                    return qIndentId === indentId && q._id !== formDialog.data?._id;
                  });
                  return otherQuotes.some(q => isPartiallyFulfilled ? q.status === 'Shortlisted' : ['Shortlisted', 'Finalized'].includes(q.status));
                })()}
              >
                Shortlisted
              </MenuItem>
              <MenuItem 
                value="Finalized"
                disabled={(() => {
                  if (!formData.indent) return false;
                  const indentObj = typeof formData.indent === 'object' ? formData.indent : null;
                  const indentId = indentObj ? indentObj._id : formData.indent;
                  const isPartiallyFulfilled = indentObj?.status === 'Partially Fulfilled';
                  const otherQuotes = quotations.filter(q => {
                    const qIndentId = typeof q.indent === 'object' ? q.indent?._id : q.indent;
                    return qIndentId === indentId && q._id !== formDialog.data?._id;
                  });
                  return otherQuotes.some(q => isPartiallyFulfilled ? q.status === 'Shortlisted' : ['Shortlisted', 'Finalized'].includes(q.status));
                })()}
              >
                Finalized
              </MenuItem>
              <MenuItem value="Rejected">Rejected</MenuItem>
            </TextField>
            
            <Divider />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6">Items</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flexBasis: '100%' }}>
                Leave quantity &amp; unit price as 0 for items you are not quoting. At least one item must have quantity and price &gt; 0.
              </Typography>
              <Button size="small" onClick={addItem}>Add Item</Button>
            </Box>
            
            {formData.items
              .map((item, originalIdx) => ({ item, originalIdx }))
              .filter(({ item }) => {
                if (formDialog.mode === 'edit') return true;
                const otherLotQuote = quotations.find(q => 
                  String(q.indent?._id || q.indent) === String(formData.indent) &&
                  (q.lotNumber || 'A') !== (formData.lotNumber || 'A') &&
                  q.items?.some(qi => qi.description === item.description && qi.quantity > 0)
                );
                return !otherLotQuote;
              })
              .map(({ item, originalIdx }) => {
                const idx = originalIdx;
                return (
              <Paper key={idx} variant="outlined" sx={{ p: 2, bgcolor: item.isFulfilled ? '#f0fff0' : 'inherit' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Chip size="small" label={`S.No. ${idx + 1}`} color="primary" variant="outlined" />
                  {formData.indent && (
                    <Typography variant="caption" color="text.secondary">
                      Requisition Item #{idx + 1}
                    </Typography>
                  )}
                  {item.isFulfilled && (
                    <Tooltip title="This item's PO has already been created.">
                      <ApproveIcon color="success" fontSize="small" />
                    </Tooltip>
                  )}
                </Box>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      size="small"
                      disabled={item.isFulfilled}
                      label="Description (optional if not quoting)"
                      placeholder="Leave empty if not quoting this item"
                      value={item.description ?? ''}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <TextField
                      fullWidth
                      size="small"
                      disabled={item.isFulfilled}
                      label="Specification"
                      placeholder="Technical specs"
                      value={item.specification ?? ''}
                      onChange={(e) => updateItem(idx, 'specification', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      disabled={item.isFulfilled}
                      label="Quantity"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                    />
                  </Grid>
                  <Grid item xs={6} md={1}>
                    <TextField
                      fullWidth
                      size="small"
                      disabled={item.isFulfilled}
                      label="Unit"
                      value={item.unit}
                      onChange={(e) => updateItem(idx, 'unit', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      disabled={item.isFulfilled}
                      label="Unit Price"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                    />
                  </Grid>
                  <Grid item xs={6} md={1}>
                    <Tooltip title="Remove item">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => removeItem(idx)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <TextField
                      fullWidth
                      size="small"
                      disabled={item.isFulfilled}
                      label="Brand"
                      value={item.brand ?? ''}
                      onChange={(e) => updateItem(idx, 'brand', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      disabled={item.isFulfilled}
                      label="Tax Rate %"
                      value={item.taxRate}
                      onChange={(e) => updateItem(idx, 'taxRate', parseFloat(e.target.value) || 0)}
                    />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      disabled={item.isFulfilled}
                      label="Discount"
                      value={item.discount}
                      onChange={(e) => updateItem(idx, 'discount', parseFloat(e.target.value) || 0)}
                    />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      disabled
                      label="Amount"
                      value={item.amount}
                      InputProps={{ readOnly: true }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      Amount: {formatPKR(item.amount)}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
                );
              })}
            
            <TextField
              fullWidth
              type="number"
              label="Validity Days"
              value={formData.validityDays}
              onChange={(e) => setFormData({ ...formData, validityDays: parseInt(e.target.value) || 30 })}
            />
            <TextField
              fullWidth
              label="Delivery Time"
              value={formData.deliveryTime}
              onChange={(e) => setFormData({ ...formData, deliveryTime: e.target.value })}
            />
            <TextField
              fullWidth
              select
              label="Payment Terms"
              value={formData.paymentTerms || ''}
              onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
            >
              <MenuItem value="">Select payment terms</MenuItem>
              <MenuItem value="Full Advance">Full Advance</MenuItem>
              <MenuItem value="Partial Advance">Partial Advance</MenuItem>
              <MenuItem value="Payment After Delivery">Payment After Delivery</MenuItem>
            </TextField>
            <TextField
              fullWidth
              label="Delivery Place"
              value={formData.deliveryPlace || ''}
              onChange={(e) => setFormData({ ...formData, deliveryPlace: e.target.value })}
            />
            <Box>
              <Tabs
                value={termTab}
                onChange={(_, value) => setTermTab(value)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ borderBottom: 1, borderColor: 'divider', mb: 1 }}
              >
                <Tab label="Freight/Carriage" />
                <Tab label="Installation" />
                <Tab label="Freight" />
              </Tabs>
              {termTab === 0 && (
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  label="Freight/Carriage"
                  value={formData.freightCarriage || ''}
                  onChange={(e) => setFormData({ ...formData, freightCarriage: e.target.value })}
                />
              )}
              {termTab === 1 && (
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  label="Installation"
                  value={formData.installation || ''}
                  onChange={(e) => setFormData({ ...formData, installation: e.target.value })}
                />
              )}
              {termTab === 2 && (
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  label="Freight"
                  value={formData.freight || ''}
                  onChange={(e) => setFormData({ ...formData, freight: e.target.value })}
                />
              )}
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Attachments</Typography>
              <input
                accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                style={{ display: 'none' }}
                id="quotation-attachment-input"
                type="file"
                multiple
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  setAttachmentFiles((prev) => [...prev, ...files]);
                  e.target.value = '';
                }}
              />
              <label htmlFor="quotation-attachment-input">
                <Button variant="outlined" component="span" size="small" startIcon={<AddIcon />}>
                  Add attachment
                </Button>
              </label>
              <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
                {(formData.attachments || []).map((att, idx) => (
                  <Chip
                    key={'att-' + idx}
                    label={att.filename || att.url}
                    onDelete={() => setFormData({
                      ...formData,
                      attachments: (formData.attachments || []).filter((_, i) => i !== idx)
                    })}
                    size="small"
                  />
                ))}
                {attachmentFiles.map((file, idx) => (
                  <Chip
                    key={'file-' + idx}
                    label={file.name}
                    onDelete={() => setAttachmentFiles((prev) => prev.filter((_, i) => i !== idx))}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                ))}
              </Stack>
            </Box>
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormDialog({ open: false, mode: 'create', data: null, requisition: null, editReason: null })}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSubmit} disabled={loading}>
            {formDialog.mode === 'create' ? 'Create' : 'Update'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* VIEW DIALOG */}
      <Dialog 
        open={viewDialog.open} 
        onClose={() => setViewDialog({ open: false, data: null })} 
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: {
            width: '90%',
            maxWidth: '210mm',
            maxHeight: '95vh',
            m: 2,
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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Quotation Details</Typography>
            <Button
              variant="contained"
              startIcon={<PrintIcon />}
              onClick={() => window.print()}
              size="small"
            >
              Print
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0, overflow: 'auto', '@media print': { p: 0, overflow: 'visible' } }}>
          {viewDialog.data && (
            <Box sx={{ width: '100%' }} className="print-content">
              <ComparativeRejectionObservationsAlert
                comparativeApproval={viewDialog.data?.indent?.comparativeApproval}
                showComparativeLink
                sx={{ mx: 2, mt: 2, '@media print': { mx: 0 } }}
              />
              <QuotationDetailView
                quotation={viewDialog.data}
                formatNumber={formatNumber}
                formatDateForPrint={formatDateForPrint}
                formatDateForQuotation={formatDateForQuotation}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ '@media print': { display: 'none' } }}>
          <Button onClick={() => setViewDialog({ open: false, data: null })}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Print Styles for Dialog */}
      <Box
        component="style"
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: A4;
                margin: 15mm;
              }
              body * {
                visibility: hidden;
              }
              .MuiDialog-container,
              .MuiDialog-container *,
              .MuiDialog-paper,
              .MuiDialog-paper *,
              .print-content,
              .print-content * {
                visibility: visible;
              }
              .MuiDialog-container {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                height: 100% !important;
                display: block !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: visible !important;
              }
              .MuiDialog-paper {
                box-shadow: none !important;
                margin: 0 !important;
                max-width: 100% !important;
                width: 100% !important;
                height: auto !important;
                max-height: none !important;
                position: relative !important;
                transform: none !important;
                overflow: visible !important;
              }
              .MuiDialogContent-root {
                overflow: visible !important;
                padding: 0 !important;
                height: auto !important;
                max-height: none !important;
                margin: 0 !important;
              }
              .MuiDialogTitle-root {
                display: none !important;
              }
              .MuiDialogActions-root {
                display: none !important;
              }
              .MuiBackdrop-root {
                display: none !important;
              }
              .MuiPaper-root {
                box-shadow: none !important;
              }
            }
          `
        }}
      />

      {/* DELETE DIALOG */}
      <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, id: null })}>
        <DialogTitle>Delete Quotation</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete this quotation? This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, id: null })}>Cancel</Button>
          <Button variant="contained" color="error" onClick={confirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Quotations;
