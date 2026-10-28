import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Snackbar,
  CircularProgress,
  Autocomplete,
  createFilterOptions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Stack,
  IconButton,
  Divider,
  Chip
} from '@mui/material';
import {
  Save as SaveIcon,
  Cancel as CancelIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Send as SendIcon,
  CloudUpload as UploadIcon,
  AttachFile as AttachFileIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../../contexts/DataContext';
import { useAuth } from '../../../contexts/AuthContext';
import indentService from '../../../services/indentService';
import api from '../../../services/api';
import dayjs from 'dayjs';
import { compressImage } from '../../../utils/compressImage';
import { resolveUploadFileHref } from '../../../utils/uploadPaths';

/** Catalog bucket for requests outside item master categories; requires categoryOtherDescription */
const OTHERS_CATEGORY = 'Others';

const newEmptyIndentItem = () => ({
  itemName: '',
  description: '',
  brand: '',
  quantity: 1,
  unit: 'Piece',
  purpose: '',
  estimatedCost: 0
});

// Custom filter that prioritizes items/categories starting with the typed query, then contains
const prefixFirstFilter = (options, { inputValue }) => {
  const query = (inputValue || '').trim().toLowerCase();
  if (!query) return options;

  const startsWithMatches = [];
  const containsMatches = [];

  options.forEach((option) => {
    const text = typeof option === 'string' ? option : (option.name || option.label || '');
    const lower = text.toLowerCase();
    if (lower.startsWith(query)) {
      startsWithMatches.push(option);
    } else if (lower.includes(query)) {
      containsMatches.push(option);
    }
  });

  return [...startsWithMatches, ...containsMatches];
};

const IndentForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { departments, fetchDepartments } = useData();
  const fetchDepartmentsRef = useRef(fetchDepartments);
  const departmentsRef = useRef(departments);
  fetchDepartmentsRef.current = fetchDepartments;
  departmentsRef.current = departments;
  const isEdit = !!id;
  const hasRunCreateLoad = useRef(false);

  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [itemCategories, setItemCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [itemOptions, setItemOptions] = useState([]);
  const [itemOptionsLoading, setItemOptionsLoading] = useState(false);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [indentNoError, setIndentNoError] = useState('');
  const [indentNoChecking, setIndentNoChecking] = useState(false);
  const indentNoDebounceRef = useRef(null);
  const itemOptionsReqSeq = useRef(0);
  const approverSearchDebounceRef = useRef(null);

  const [indentMeta, setIndentMeta] = useState({ status: null, approvalChain: [] });
  const [approverSlots, setApproverSlots] = useState([null]);
  const [approverSearchOptions, setApproverSearchOptions] = useState([]);
  const [approverSearchLoading, setApproverSearchLoading] = useState(false);
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [newAttachmentFiles, setNewAttachmentFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState([]);

  const [formData, setFormData] = useState({
    title: '',
    date: dayjs().format('YYYY-MM-DD'),
    requiredDate: '',
    indentNumber: '',
    department: '',
    companyId: '',
    originator: user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : '',
    items: [],
    justification: '',
    priority: 'Medium',
    category: '',
    categoryOtherDescription: '',
    signatures: {
      requester: { name: '', date: '' },
      headOfDepartment: { name: '', date: '' },
      gmPd: { name: '', date: '' },
      svpAvp: { name: '', date: '' }
    }
  });

  // Reset create-load flag when switching to edit
  useEffect(() => {
    if (isEdit) hasRunCreateLoad.current = false;
  }, [isEdit]);

  // Populate originator when user becomes available (fixes issue where user loads after form mount, e.g. non-superusers)
  useEffect(() => {
    if (isEdit || !user) return;
    const name = (user.firstName && user.lastName)
      ? `${user.firstName} ${user.lastName}`.trim()
      : (user.fullName || user.email || '').trim();
    if (name) {
      setFormData((prev) => {
        if (prev.originator?.trim()) return prev;
        return {
          ...prev,
          originator: name,
          signatures: {
            ...prev.signatures,
            requester: {
              ...prev.signatures?.requester,
              name: prev.signatures?.requester?.name?.trim() || name
            }
          }
        };
      });
    }
  }, [user, isEdit]);

  // Keep requester signature aligned with currently logged-in user.
  useEffect(() => {
    if (!user) return;
    const currentUserName = (user.firstName && user.lastName)
      ? `${user.firstName} ${user.lastName}`.trim()
      : (user.fullName || user.email || '').trim();

    if (!currentUserName) return;

    setFormData((prev) => {
      if (prev.signatures?.requester?.name === currentUserName) return prev;
      return {
        ...prev,
        signatures: {
          ...prev.signatures,
          requester: {
            ...prev.signatures?.requester,
            name: currentUserName
          }
        }
      };
    });
  }, [user]);

  const loadDepartmentsForIndent = useCallback(async () => {
    setDepartmentsLoading(true);
    try {
      const res = await api.get('/indents/departments');
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      if (list.length > 0) {
        setDepartmentOptions(list);
        return list;
      }
    } catch {
      // fallback below
    } finally {
      setDepartmentsLoading(false);
    }
    const fallback = await fetchDepartmentsRef.current(true);
    const out = Array.isArray(fallback) ? fallback : [];
    setDepartmentOptions(out);
    return out;
  }, []);

  const loadCompaniesForIndent = useCallback(async () => {
    setCompaniesLoading(true);
    try {
      let res = await api.get('/indents/companies');
      let list = Array.isArray(res.data?.data) ? res.data.data : [];
      if (list.length === 0) {
        res = await api.get('/hr/companies');
        list = Array.isArray(res.data?.data) ? res.data.data : [];
      }
      setCompanyOptions(list);
    } catch (err) {
      console.error('Failed to load companies:', err);
      try {
        const fallbackRes = await api.get('/hr/companies');
        setCompanyOptions(Array.isArray(fallbackRes.data?.data) ? fallbackRes.data.data : []);
      } catch (fallbackErr) {
        console.error('Fallback company fetch failed:', fallbackErr);
      }
    } finally {
      setCompaniesLoading(false);
    }
  }, []);

  // Load indent data if editing, or run next-number/next-erp-ref + departments once for create
  useEffect(() => {
    const loadData = async () => {
      if (isEdit) {
        try {
          setLoadingData(true);
          const response = await indentService.getIndentById(id);
          const indent = response.data;
          
          setIndentMeta({
            status: indent.status || null,
            approvalChain: Array.isArray(indent.approvalChain) ? indent.approvalChain : [],
            rawIndent: indent
          });
          const draftApprovers = (indent.draftApproverIds || []).slice(0, 1);
          const slots = [0].map((i) => {
            const u = draftApprovers[i];
            return u && typeof u === 'object' && u._id ? u : null;
          });
          setApproverSlots(slots);
          setExistingAttachments(Array.isArray(indent.attachments) ? indent.attachments : []);
          setNewAttachmentFiles([]);
          setRemovedAttachmentIds([]);

          setFormData({
            title: indent.title || '',
            date: indent.requestedDate ? dayjs(indent.requestedDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
            requiredDate: indent.requiredDate ? dayjs(indent.requiredDate).format('YYYY-MM-DD') : '',
            indentNumber: indent.indentNumber || '',
            department: indent.department?._id || '',
            companyId: indent.companyId?._id || indent.companyId || '',
            originator: indent.requestedBy?.firstName && indent.requestedBy?.lastName 
              ? `${indent.requestedBy.firstName} ${indent.requestedBy.lastName}` 
              : '',
            items: indent.items?.map(item => ({
              ...item,
              brand: item.brand || '',
              estimatedCost: item.estimatedCost ?? 0
            })) || [],
            justification: indent.justification || '',
            priority: indent.priority || 'Medium',
            category: indent.category || '',
            categoryOtherDescription: indent.categoryOtherDescription || '',
            signatures: indent.signatures || {
              requester: { name: '', date: '' },
              headOfDepartment: { name: '', date: '' },
              gmPd: { name: '', date: '' },
              svpAvp: { name: '', date: '' }
            }
          });
        } catch (err) {
          setError(err.response?.data?.message || 'Failed to load indent');
        } finally {
          setLoadingData(false);
        }
        if (departmentsRef.current.length === 0) {
          await loadDepartmentsForIndent();
        }
        await loadCompaniesForIndent();
        return;
      }

      // Create: run only once per mount so we don't loop (fetchDepartments/departments change triggers re-run otherwise)
      if (hasRunCreateLoad.current) return;
      hasRunCreateLoad.current = true;

      try {
        const indentResponse = await indentService.getNextIndentNumber();
        if (indentResponse.data?.nextIndentNumber) {
          setFormData(prev => ({ ...prev, indentNumber: indentResponse.data.nextIndentNumber }));
        }
      } catch (err) {
        // If API fails, backend will generate on save
      }

      if (departmentsRef.current.length === 0) {
        await loadDepartmentsForIndent();
      }
      await loadCompaniesForIndent();
    };

    loadData();
  }, [id, isEdit, loadDepartmentsForIndent, loadCompaniesForIndent]);

  useEffect(() => {
    if (Array.isArray(departments) && departments.length > 0) {
      setDepartmentOptions((prev) => (prev.length > 0 ? prev : departments));
    }
  }, [departments]);

  const handleChange = (field, value) => {
    if (field === 'category') {
      setFormData((prev) => {
        const categoryOtherDescription = value === OTHERS_CATEGORY ? prev.categoryOtherDescription : '';
        const needsItemRow =
          value === OTHERS_CATEGORY && (!prev.items || prev.items.length === 0);
        return {
          ...prev,
          category: value,
          categoryOtherDescription,
          items: needsItemRow ? [newEmptyIndentItem()] : prev.items
        };
      });
    } else {
      setFormData((prev) => ({
        ...prev,
        [field]: value
      }));
    }

    if (field === 'indentNumber') {
      setIndentNoError('');
      if (indentNoDebounceRef.current) clearTimeout(indentNoDebounceRef.current);
      const trimmed = String(value || '').trim();
      if (!trimmed) return;
      setIndentNoChecking(true);
      indentNoDebounceRef.current = setTimeout(async () => {
        try {
          const params = { value: trimmed };
          if (isEdit && id) params.excludeId = id;
          const res = await api.get('/indents/check-indent-number', { params });
          if (res.data?.exists) {
            setIndentNoError(`Already taken. Choose a different Indent No.`);
          } else {
            setIndentNoError('');
          }
        } catch {
          // silently ignore network errors for this check
        } finally {
          setIndentNoChecking(false);
        }
      }, 500);
    }
  };

  const fetchCategories = useCallback(async () => {
    try {
      setCategoriesLoading(true);
      const res = await api.get('/items/categories');
      const raw = Array.isArray(res.data?.data) ? res.data.data.filter(Boolean) : [];
      const cats = raw.includes(OTHERS_CATEGORY)
        ? raw
        : [...raw, OTHERS_CATEGORY];
      setItemCategories(cats);
      if (!isEdit) {
        setFormData((prev) => {
          const nextCat = prev.category || cats[0] || '';
          const needsItemRow =
            nextCat === OTHERS_CATEGORY && (!prev.items || prev.items.length === 0);
          return {
            ...prev,
            category: nextCat,
            items: needsItemRow ? [newEmptyIndentItem()] : prev.items
          };
        });
      }
    } catch (e) {
      // ignore; user can still type category manually if needed
    } finally {
      setCategoriesLoading(false);
    }
  }, [isEdit]);

  const fetchItemsForCategory = useCallback(async (category) => {
    const seq = ++itemOptionsReqSeq.current;
    if (!category || category === OTHERS_CATEGORY) {
      setItemOptions([]);
      setItemOptionsLoading(false);
      return;
    }
    try {
      setItemOptionsLoading(true);
      const res = await api.get('/items', { params: { category, limit: 5000 } });
      if (seq !== itemOptionsReqSeq.current) return;
      setItemOptions(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (e) {
      // silently ignore - free typing still works
    } finally {
      if (seq === itemOptionsReqSeq.current) setItemOptionsLoading(false);
    }
  }, []);

  const handleItemChange = (index, field, value) => {
    // Functional update — several fields are set in a row when an item is picked
    setFormData(prev => {
      const updatedItems = [...prev.items];
      updatedItems[index] = { ...updatedItems[index], [field]: value };
      return { ...prev, items: updatedItems };
    });
  };

  const handleAddItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, newEmptyIndentItem()]
    }));
  };

  const handleRemoveItem = (index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const handleSignatureChange = (signatureType, field, value) => {
    setFormData(prev => ({
      ...prev,
      signatures: {
        ...prev.signatures,
        [signatureType]: {
          ...prev.signatures[signatureType],
          [field]: value
        }
      }
    }));
  };

  // Refresh suggestions when category changes
  useEffect(() => {
    setItemOptions([]);
    if (formData.category) {
      fetchItemsForCategory(formData.category);
    }
  }, [formData.category, fetchItemsForCategory]);

  // Others has no catalog lines — keep at least one editable row so submit is not blocked
  useEffect(() => {
    if (formData.category !== OTHERS_CATEGORY) return;
    if ((formData.items?.length ?? 0) > 0) return;
    setFormData((prev) => {
      if (prev.category !== OTHERS_CATEGORY || (prev.items?.length ?? 0) > 0) return prev;
      return { ...prev, items: [newEmptyIndentItem()] };
    });
  }, [formData.category, formData.items?.length]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const loadApproverOptions = async (q) => {
    try {
      setApproverSearchLoading(true);
      const res = await api.get('/indents/approver-candidates', {
        params: { search: q || '', limit: 50 }
      });
      setApproverSearchOptions(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      setApproverSearchOptions([]);
    } finally {
      setApproverSearchLoading(false);
    }
  };

  useEffect(() => {
    loadApproverOptions('');
  }, []);

  const approverLabel = (u) => {
    if (!u) return '';
    const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return n || u.email || u.employeeId || '';
  };

  const handleApproverSearchInput = (value) => {
    if (approverSearchDebounceRef.current) clearTimeout(approverSearchDebounceRef.current);
    approverSearchDebounceRef.current = setTimeout(() => {
      loadApproverOptions(value);
    }, 300);
  };

  const handleApproverSlotChange = (index, user) => {
    setApproverSlots((prev) => {
      const next = [...prev];
      next[index] = user;
      return next;
    });
  };

  const validateForm = () => {
    if (!formData.title?.trim()) {
      setError('Title is required');
      return false;
    }
    if (!formData.department) {
      setError('Department is required');
      return false;
    }
    if (!formData.requiredDate) {
      setError('Required date is required');
      return false;
    }
    if (!formData.justification?.trim()) {
      setError('Justification is required');
      return false;
    }
    if (!formData.priority) {
      setError('Priority is required');
      return false;
    }
    if (!formData.category) {
      setError('Category is required');
      return false;
    }
    if (formData.category === OTHERS_CATEGORY && !formData.categoryOtherDescription?.trim()) {
      setError('When category is Others, describe what is required');
      return false;
    }
    if (!formData.originator.trim()) {
      setError('Originator is required');
      return false;
    }
    if (formData.items.length === 0) {
      setError(
        formData.category === OTHERS_CATEGORY
          ? 'Add at least one line in Items (use Add Item). For Others, item name is free text; fill description, brand, qty, purpose, and estimated cost.'
          : 'At least one item is required'
      );
      return false;
    }
    for (let i = 0; i < formData.items.length; i++) {
      const item = formData.items[i];
      if (!item.itemName?.trim()) {
        setError(`Item ${i + 1}: Item name is required`);
        return false;
      }
      if (!item.description?.trim()) {
        setError(`Item ${i + 1}: Item description is required`);
        return false;
      }
      if (!item.brand?.trim()) {
        setError(`Item ${i + 1}: Brand is required`);
        return false;
      }
      if (!item.quantity || item.quantity < 1) {
        setError(`Item ${i + 1}: Quantity must be at least 1`);
        return false;
      }
      if (!item.unit?.trim()) {
        setError(`Item ${i + 1}: Unit is required`);
        return false;
      }
      if (!item.purpose?.trim()) {
        setError(`Item ${i + 1}: Purpose is required`);
        return false;
      }
      if (
        item.estimatedCost === undefined ||
        item.estimatedCost === null ||
        String(item.estimatedCost).trim() === '' ||
        Number.isNaN(Number(item.estimatedCost)) ||
        Number(item.estimatedCost) < 0
      ) {
        setError(`Item ${i + 1}: Estimated cost is required and must be 0 or greater`);
        return false;
      }
    }
    return true;
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const totalCurrent = (existingAttachments?.length || 0) + (newAttachmentFiles?.length || 0);
    if (totalCurrent + files.length > 10) {
      setError('Maximum 10 attachments allowed in total.');
      return;
    }

    try {
      setUploadingFiles(true);
      const processedFiles = [];
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          const compressed = await compressImage(file);
          processedFiles.push(compressed);
        } else if (file.type === 'application/pdf') {
          processedFiles.push(file);
        } else {
          setError('Only images and PDF files are allowed as attachments.');
        }
      }
      setNewAttachmentFiles((prev) => [...prev, ...processedFiles]);
    } catch (err) {
      console.error('Error processing attachment files:', err);
      setError('Error processing attachment files. Please try again.');
    } finally {
      setUploadingFiles(false);
      // Reset input value
      e.target.value = '';
    }
  };

  const handleRemoveNewFile = (index) => {
    setNewAttachmentFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveExistingFile = (attachmentId) => {
    setExistingAttachments((prev) => prev.filter((att) => att._id !== attachmentId));
    setRemovedAttachmentIds((prev) => [...prev, attachmentId]);
  };

  const handleSubmit = async (submitForApproval = false) => {
    if (!validateForm()) {
      return;
    }

    if (submitForApproval) {
      const ids = approverSlots.map((u) => u?._id).filter(Boolean);
      if (ids.length !== 1) {
        setError('Submitting for approval requires Head of Department approver.');
        return;
      }
    }

    try {
      setLoading(true);
      setError('');

      const draftApproverIds = approverSlots.map((u) => u?._id).filter(Boolean);
      const canSendDraftApprovers = !isEdit || ['Draft', 'Rejected'].includes(indentMeta.status || 'Draft');

      const indentData = {
        title: formData.title.trim(),
        requestedDate: formData.date,
        requiredDate: formData.requiredDate,
        department: formData.department,
        companyId: formData.companyId || undefined,
        priority: formData.priority,
        category: formData.category,
        categoryOtherDescription:
          formData.category === OTHERS_CATEGORY ? formData.categoryOtherDescription.trim() : '',
        items: formData.items.map(item => ({
          itemName: item.itemName,
          itemCode: item.itemCode || '',
          itemMaster: item.itemMaster || undefined,
          description: item.description || '',
          brand: item.brand || '',
          quantity: item.quantity,
          unit: item.unit || 'Piece',
          purpose: item.purpose || '',
          estimatedCost: Number.isFinite(Number(item.estimatedCost)) && Number(item.estimatedCost) >= 0
            ? Number(item.estimatedCost)
            : 0
        })),
        justification: formData.justification.trim(),
        signatures: formData.signatures,
        status: isEdit ? (indentMeta.status || 'Draft') : 'Draft',
        ...(canSendDraftApprovers ? { draftApproverIds } : {})
      };
      
      // Include indentNumber if the user has provided one; backend auto-generates if omitted
      if (formData.indentNumber?.trim()) {
        indentData.indentNumber = formData.indentNumber.trim();
      }

      // Build payload either as FormData or JSON depending on whether new files are attached or existing files removed
      let payload;
      if (newAttachmentFiles.length > 0 || removedAttachmentIds.length > 0) {
        const fd = new FormData();
        fd.append('data', JSON.stringify({
          ...indentData,
          removedAttachmentIds
        }));
        newAttachmentFiles.forEach((file) => {
          fd.append('attachments', file);
        });
        payload = fd;
      } else {
        payload = indentData;
      }

      let response;
      let savedId;
      if (isEdit) {
        response = await indentService.updateIndent(id, payload);
        savedId = id;
      } else {
        response = await indentService.createIndent(payload);
        savedId = response.data?._id;
      }

      if (submitForApproval && savedId) {
        const approverIds = approverSlots.map((u) => u?._id).filter(Boolean);
        await indentService.submitIndent(savedId, { approverIds });
      }

      setSnackbar({
        open: true,
        message: submitForApproval 
          ? 'Indent submitted for approval successfully' 
          : isEdit 
            ? 'Indent updated successfully' 
            : 'Indent created successfully',
        severity: 'success'
      });

      setTimeout(() => {
        navigate('/general/indents');
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save indent');
    } finally {
      setLoading(false);
    }
  };

  if (loadingData) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  const selectedCompanyName =
    companyOptions.find((c) => String(c._id) === String(formData.companyId))?.name ||
    '';

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      {/* Header */}
      <Paper elevation={2} sx={{ p: 3, mb: 3, border: '2px solid #000' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              component="img"
              src="/images/taj-logo.png"
              alt="Company Logo"
              sx={{ height: 50, width: 'auto' }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
            <Typography variant="h5" fontWeight={700} sx={{ textTransform: 'uppercase' }}>
              {selectedCompanyName || 'Select Company'}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<CancelIcon />}
            onClick={() => navigate('/general/indents')}
          >
            Cancel
          </Button>
        </Box>
        <Typography variant="h4" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: 3 }}>
          Purchase Request Form
        </Typography>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {isEdit && indentMeta?.rawIndent && (indentMeta.rawIndent.rejectionReason || indentMeta.rawIndent.lastRejectionReason || indentMeta.rawIndent.procurementRejection?.observation?.trim()) && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 3, borderLeft: '6px solid #ed6c02', bgcolor: '#fff4e5', borderRadius: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} color="warning.dark">
            ⚠️ Rejection / Correction Request from Approver
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Please review the requested correction notes below, update your purchase request details, and click Submit to resubmit for approval.
          </Typography>
          <Typography variant="body2" fontWeight={600} sx={{ mt: 1, p: 1.5, bgcolor: '#ffffff', borderRadius: 1, border: '1px solid #ffe0b2' }}>
            "{indentMeta.rawIndent.rejectionReason || indentMeta.rawIndent.lastRejectionReason || indentMeta.rawIndent.procurementRejection?.observation?.trim()}"
          </Typography>
        </Alert>
      )}

      <Paper elevation={2} sx={{ p: 3, border: '1px solid #ccc' }}>
        {/* Title */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Title"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              required
              size="small"
              placeholder="e.g. Purchase Request - Office Supplies"
            />
          </Grid>
        </Grid>

        {/* Reference Information */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              label="Date"
              type="date"
              value={formData.date}
              onChange={(e) => handleChange('date', e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              label="Required Date"
              type="date"
              value={formData.requiredDate}
              onChange={(e) => handleChange('requiredDate', e.target.value)}
              InputLabelProps={{ shrink: true }}
              required
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              label="Indent No."
              value={formData.indentNumber}
              onChange={(e) => handleChange('indentNumber', e.target.value)}
              size="small"
              error={!!indentNoError}
              helperText={
                indentNoChecking
                  ? 'Checking availability…'
                  : indentNoError || 'Editable – must be unique'
              }
              InputProps={{
                endAdornment: indentNoChecking ? (
                  <CircularProgress size={14} sx={{ mr: 0.5 }} />
                ) : undefined
              }}
            />
          </Grid>
        </Grid>

        {/* Department, Originator, Priority, Category */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small" required>
              <InputLabel>Department</InputLabel>
              <Select
                value={formData.department}
                label="Department"
                onChange={(e) => handleChange('department', e.target.value)}
              >
                {departmentsLoading && (
                  <MenuItem value="" disabled>
                    Loading departments...
                  </MenuItem>
                )}
                {departmentOptions.map((dept) => (
                  <MenuItem key={dept._id} value={dept._id}>
                    {dept.name}
                  </MenuItem>
                ))}
                {!departmentsLoading && departmentOptions.length === 0 && (
                  <MenuItem value="" disabled>
                    No departments available
                  </MenuItem>
                )}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Company</InputLabel>
              <Select
                value={formData.companyId}
                label="Company"
                onChange={(e) => handleChange('companyId', e.target.value)}
              >
                <MenuItem value="">
                  <em>Select Company</em>
                </MenuItem>
                {companiesLoading && (
                  <MenuItem value="" disabled>
                    Loading companies...
                  </MenuItem>
                )}
                {companyOptions.map((comp) => (
                  <MenuItem key={comp._id} value={comp._id}>
                    {comp.name} {comp.code ? `(${comp.code})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              label="Originator"
              value={formData.originator}
              onChange={(e) => handleChange('originator', e.target.value)}
              required
              size="small"
              InputProps={{
                readOnly: !isEdit
              }}
              helperText={!isEdit ? 'Logged-in user (read-only)' : undefined}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small" required>
              <InputLabel>Priority</InputLabel>
              <Select
                value={formData.priority}
                label="Priority"
                onChange={(e) => handleChange('priority', e.target.value)}
              >
                <MenuItem value="Low">Low</MenuItem>
                <MenuItem value="Medium">Medium</MenuItem>
                <MenuItem value="High">High</MenuItem>
                <MenuItem value="Urgent">Urgent</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Autocomplete
              fullWidth
              size="small"
              options={itemCategories}
              filterOptions={prefixFirstFilter}
              loading={categoriesLoading}
              value={formData.category || null}
              onChange={(_, newValue) => handleChange('category', newValue || '')}
              renderInput={(params) => (
                <TextField
                  {...params}
                  required
                  label="Category"
                  placeholder="Search / select category"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {categoriesLoading ? <CircularProgress color="inherit" size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    )
                  }}
                />
              )}
            />
          </Grid>
          {formData.category === OTHERS_CATEGORY && (
            <Grid item xs={12} sm={6} md={9}>
              <TextField
                fullWidth
                required
                size="small"
                label="Specify what is required"
                value={formData.categoryOtherDescription}
                onChange={(e) => handleChange('categoryOtherDescription', e.target.value)}
                placeholder="Describe the category or items needed (not in the list above)"
                inputProps={{ maxLength: 500 }}
                helperText={`Describe the overall need. You still need at least one row in Items below with line-level details. ${(formData.categoryOtherDescription || '').length}/500`}
              />
            </Grid>
          )}
        </Grid>

        <Divider sx={{ my: 3 }} />

        {/* Items Table */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight={600}>
              Items <span style={{ color: 'red', fontWeight: 400, fontSize: '0.875rem' }}>(all fields required)</span>
              {formData.category === OTHERS_CATEGORY && (
                <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block', fontWeight: 400, mt: 0.5 }}>
                  For Others, item name is typed manually; other columns are still required for each line.
                </Typography>
              )}
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={handleAddItem}
            >
              Add Item
            </Button>
          </Box>

          {formData.items.length === 0 ? (
            <Alert severity="info">
              No items added. Click "Add Item" to add items to this indent.
            </Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                    <TableCell align="center" sx={{ fontWeight: 700, border: '1px solid #ddd' }}>S#</TableCell>
                    <TableCell sx={{ fontWeight: 700, border: '1px solid #ddd' }}>Item Name</TableCell>
                    <TableCell sx={{ fontWeight: 700, border: '1px solid #ddd' }}>Item Description</TableCell>
                    <TableCell sx={{ fontWeight: 700, border: '1px solid #ddd' }}>Brand</TableCell>
                    <TableCell sx={{ fontWeight: 700, border: '1px solid #ddd' }}>Unit</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700, border: '1px solid #ddd' }}>Qty.</TableCell>
                    <TableCell sx={{ fontWeight: 700, border: '1px solid #ddd' }}>Purpose</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, border: '1px solid #ddd' }}>Est. Cost</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700, border: '1px solid #ddd', width: 50 }}>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {formData.items.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell align="center" sx={{ border: '1px solid #ddd' }}>
                        {(index + 1).toString().padStart(2, '0')}
                      </TableCell>
                      <TableCell sx={{ border: '1px solid #ddd', p: 0.5, minWidth: 360 }}>
                        {formData.category === OTHERS_CATEGORY ? (
                          <TextField
                            fullWidth
                            size="small"
                            value={item.itemName || ''}
                            onChange={(e) => handleItemChange(index, 'itemName', e.target.value)}
                            required
                            placeholder="Enter item name"
                            variant="standard"
                            InputProps={{ disableUnderline: true }}
                            sx={{ '& .MuiInputBase-input': { py: 0.5, px: 0.5 } }}
                          />
                        ) : (
                          <Autocomplete
                            freeSolo
                            autoHighlight
                            size="small"
                            options={itemOptions.map(opt => (typeof opt === 'string' ? opt : opt.name || ''))}
                            filterOptions={prefixFirstFilter}
                            loading={itemOptionsLoading}
                            value={item.itemName || ''}
                            onChange={(_, newValue) => {
                              handleItemChange(index, 'itemName', newValue || '');
                              // If matched item has default unit/description, prefill optionally
                              const matchedOpt = itemOptions.find(o => (o.name || '') === newValue);
                              // Keep the Item Catalog link so PO / GRN / SIN carry the same item code
                              handleItemChange(index, 'itemMaster', matchedOpt?._id || null);
                              handleItemChange(index, 'itemCode', matchedOpt?.itemCode || '');
                              if (matchedOpt) {
                                if (matchedOpt.unit && !item.unit) {
                                  handleItemChange(index, 'unit', matchedOpt.unit);
                                }
                                if (matchedOpt.description && !item.description) {
                                  handleItemChange(index, 'description', matchedOpt.description);
                                }
                              }
                            }}
                            onInputChange={(_, newInputValue, reason) => {
                              handleItemChange(index, 'itemName', newInputValue || '');
                              if (reason === 'input') {
                                handleItemChange(index, 'itemMaster', null);
                                handleItemChange(index, 'itemCode', '');
                              }
                            }}
                            renderOption={(props, option) => {
                              const code = itemOptions.find(o => (o.name || '') === option)?.itemCode;
                              return (
                                <li {...props} key={`${option}-${code || ''}`}>
                                  {code && <Typography component="span" variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', mr: 1 }}>{code}</Typography>}
                                  {option}
                                </li>
                              );
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                required
                                placeholder="Search or type item name..."
                                variant="standard"
                                InputProps={{
                                  ...params.InputProps,
                                  disableUnderline: true,
                                  endAdornment: (
                                    <>
                                      {itemOptionsLoading ? <CircularProgress color="inherit" size={14} /> : null}
                                      {params.InputProps.endAdornment}
                                    </>
                                  )
                                }}
                                sx={{ '& .MuiInputBase-input': { py: 0.5, px: 0.5 } }}
                              />
                            )}
                          />
                        )}
                      </TableCell>
                      <TableCell sx={{ border: '1px solid #ddd', p: 0.5 }}>
                        <TextField
                          fullWidth
                          size="small"
                          value={item.description || ''}
                          onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                          placeholder="Description"
                          required
                          variant="standard"
                          InputProps={{ disableUnderline: true }}
                          sx={{ '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      </TableCell>
                      <TableCell sx={{ border: '1px solid #ddd', p: 0.5 }}>
                        <TextField
                          fullWidth
                          size="small"
                          value={item.brand || ''}
                          onChange={(e) => handleItemChange(index, 'brand', e.target.value)}
                          placeholder="Brand"
                          required
                          variant="standard"
                          InputProps={{ disableUnderline: true }}
                          sx={{ '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      </TableCell>
                      <TableCell sx={{ border: '1px solid #ddd', p: 0.5 }}>
                        <TextField
                          fullWidth
                          size="small"
                          value={item.unit ?? 'Piece'}
                          onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                          placeholder="Unit"
                          required
                          variant="standard"
                          InputProps={{ disableUnderline: true }}
                          sx={{ '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      </TableCell>
                      <TableCell align="center" sx={{ border: '1px solid #ddd', p: 0.5 }}>
                        <TextField
                          size="small"
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, 'quantity', parseInt(e.target.value) || 1)}
                          inputProps={{ min: 1, style: { textAlign: 'center' } }}
                          required
                          variant="standard"
                          InputProps={{ disableUnderline: true }}
                          sx={{ width: 60, '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      </TableCell>
                      <TableCell sx={{ border: '1px solid #ddd', p: 0.5 }}>
                        <TextField
                          fullWidth
                          size="small"
                          value={item.purpose || ''}
                          onChange={(e) => handleItemChange(index, 'purpose', e.target.value)}
                          placeholder="Purpose"
                          required
                          variant="standard"
                          InputProps={{ disableUnderline: true }}
                          sx={{ '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      </TableCell>
                      <TableCell sx={{ border: '1px solid #ddd', p: 0.5 }}>
                        <TextField
                          size="small"
                          type="number"
                          value={item.estimatedCost ?? ''}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            if (nextValue === '') {
                              handleItemChange(index, 'estimatedCost', '');
                              return;
                            }
                            const parsed = Number(nextValue);
                            if (Number.isNaN(parsed)) return;
                            handleItemChange(index, 'estimatedCost', parsed < 0 ? 0 : nextValue);
                          }}
                          inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }}
                          required
                          variant="standard"
                          InputProps={{ disableUnderline: true }}
                          sx={{ width: 90, '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      </TableCell>
                      <TableCell align="center" sx={{ border: '1px solid #ddd' }}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleRemoveItem(index)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Justification */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            Justification <span style={{ color: 'red' }}>*</span>
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={3}
            value={formData.justification}
            onChange={(e) => handleChange('justification', e.target.value)}
            placeholder="Enter justification for this purchase request..."
            required
            variant="outlined"
            size="small"
          />
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Attachments (Optional) */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Attachments <Typography component="span" variant="body2" color="text.secondary">(Optional — image or PDF)</Typography>
            </Typography>
            <Button
              variant="outlined"
              size="small"
              component="label"
              startIcon={<UploadIcon />}
              disabled={uploadingFiles || (existingAttachments.length + newAttachmentFiles.length >= 10)}
            >
              {uploadingFiles ? 'Processing...' : 'Upload Attachment'}
              <input
                type="file"
                hidden
                multiple
                accept="image/*,.pdf"
                onChange={handleFileSelect}
              />
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
            Upload quotation reference, product photo, specs, or supporting documents (up to 10 files, max 10MB each).
          </Typography>

          {existingAttachments.length === 0 && newAttachmentFiles.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 1 }}>
              No attachments added.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {/* Existing attachments from database */}
              {existingAttachments.map((att) => {
                const fileHref = resolveUploadFileHref(att.path);
                const isPdf = att.path?.toLowerCase().endsWith('.pdf') || att.filename?.toLowerCase().endsWith('.pdf');
                return (
                  <Paper
                    key={att._id}
                    variant="outlined"
                    sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fafafa' }}
                  >
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, flex: 1, mr: 1 }}>
                      <AttachFileIcon color="primary" fontSize="small" />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap fontWeight={500}>
                          {att.filename || 'Attachment'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Existing attachment {att.uploadedAt ? `(${dayjs(att.uploadedAt).format('DD-MMM-YYYY')})` : ''}
                        </Typography>
                      </Box>
                    </Stack>
                    <Stack direction="row" spacing={0.5}>
                      {fileHref && (
                        <IconButton
                          size="small"
                          color="primary"
                          component="a"
                          href={fileHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View attachment"
                        >
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleRemoveExistingFile(att._id)}
                        title="Remove attachment"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Paper>
                );
              })}

              {/* Newly selected files */}
              {newAttachmentFiles.map((file, idx) => (
                <Paper
                  key={`new-${idx}`}
                  variant="outlined"
                  sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#f0f7ff', borderColor: '#b3d7ff' }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, flex: 1, mr: 1 }}>
                    <AttachFileIcon color="info" fontSize="small" />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap fontWeight={500}>
                        {file.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        New file ({Math.round(file.size / 1024)} KB)
                      </Typography>
                    </Box>
                  </Stack>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleRemoveNewFile(idx)}
                    title="Remove file"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Approvals: requester + dynamic approvers / status */}
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
          Approvals
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose Head of Department approver before submitting (you may select yourself if you are the HOD).
          Approval status appears here automatically after submit.
        </Typography>
        {isEdit && indentMeta.status && indentMeta.status !== 'Draft' && (indentMeta.approvalChain || []).length > 0 ? (
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                  <TableCell sx={{ fontWeight: 700 }}>Role</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Approver</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(indentMeta.approvalChain || []).map((step, idx) => {
                  const label = idx === 0 ? 'Head of Department' : `Approver ${idx + 1}`;
                  const approver = step?.approver;
                  const name = approver ? approverLabel(approver) : '—';
                  const st = step?.status || 'pending';
                  return (
                    <TableRow key={label}>
                      <TableCell>{label}</TableCell>
                      <TableCell>{name}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={st === 'pending' ? 'Pending' : st === 'approved' ? 'Approved' : 'Rejected'}
                          color={st === 'approved' ? 'success' : st === 'rejected' ? 'error' : 'default'}
                          variant={st === 'pending' ? 'outlined' : 'filled'}
                        />
                      </TableCell>
                      <TableCell>
                        {step?.actedAt ? dayjs(step.actedAt).format('DD-MMM-YYYY HH:mm') : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : isEdit && indentMeta.status && indentMeta.status !== 'Draft' ? (
          <Alert severity="info" sx={{ mb: 3 }}>
            This indent was submitted before multi-step approvers were enabled. Users with admin or HR manager roles can approve or reject it from the indent list or detail page.
          </Alert>
        ) : (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Sig of Requester"
                value={formData.signatures.requester.name}
                size="small"
                InputProps={{ readOnly: true }}
                helperText="Auto-filled from logged-in user"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                options={approverSearchOptions}
                loading={approverSearchLoading}
                getOptionLabel={(option) => approverLabel(option)}
                isOptionEqualToValue={(a, b) => !!a && !!b && a._id === b._id}
                value={approverSlots[0]}
                onChange={(_, v) => handleApproverSlotChange(0, v)}
                onInputChange={(_, input, reason) => {
                  if (reason === 'input') handleApproverSearchInput(input);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Head of Department approver"
                    size="small"
                    placeholder="Search user (including yourself)…"
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {approverSearchLoading ? <CircularProgress color="inherit" size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      )
                    }}
                  />
                )}
              />
            </Grid>
          </Grid>
        )}

        {/* Distribution Section */}
        <Box sx={{ mt: 4, pt: 2, borderTop: '1px solid #ccc' }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            <strong>Original:</strong> Procurement
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            <strong>Green:</strong> Store
          </Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>
            <strong>Yellow:</strong> For Book Record
          </Typography>
        </Box>

        {/* Action Buttons */}
        <Stack direction="row" spacing={2} justifyContent="flex-end" sx={{ mt: 4 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/general/indents')}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => handleSubmit(false)}
            disabled={loading || !!indentNoError || indentNoChecking}
            title={indentNoError || ''}
          >
            {loading ? 'Saving...' : isEdit ? 'Update' : 'Save Draft'}
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<SendIcon />}
            onClick={() => handleSubmit(true)}
            disabled={
              loading ||
              !!indentNoError ||
              indentNoChecking ||
              (isEdit && indentMeta.status && !['Draft', 'Rejected'].includes(indentMeta.status))
            }
            title={
              isEdit && indentMeta.status && !['Draft', 'Rejected'].includes(indentMeta.status)
                ? 'Only draft or rejected indents can be submitted from this form'
                : indentNoError || ''
            }
          >
            {loading ? 'Submitting...' : (isEdit && indentMeta.status === 'Rejected') ? 'Resubmit for Approval' : 'Submit for Approval'}
          </Button>
        </Stack>
      </Paper>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </Box>
  );
};

export default IndentForm;
