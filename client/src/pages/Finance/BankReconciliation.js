import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition, memo } from 'react';
import { FixedSizeList as VirtualList } from 'react-window';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Chip, CircularProgress, Alert, Skeleton,
  Tooltip, Stack, Card, CardContent, Grid, TextField, FormControl, InputLabel, Select, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, IconButton, Checkbox
} from '@mui/material';
import {
  AccountBalance as BankIcon,
  CheckCircle as ReconcileIcon,
  CalendarMonth as CalendarIcon,
  ReceiptLong as VoucherIcon,
  Search as SearchIcon,
  PictureAsPdf as PdfIcon,
  GridOn as ExcelIcon,
  EditCalendar as EditDateIcon,
  AttachFile as AttachIcon,
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  GetApp as DownloadIcon,
  InsertDriveFile as FileIcon,
  Close as CloseIcon,
  Undo as UndoIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemSecondaryAction from '@mui/material/ListItemSecondaryAction';
import api from '../../services/api';
import FinanceCompanySelector from '../../components/Finance/FinanceCompanySelector';
import { useFinanceCompany } from '../../context/FinanceCompanyContext';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import { fetchPayFromAccounts } from '../../utils/payFromAccounts';
import { formatDate } from '../../utils/dateUtils';
import { exportBankReconciliationPDF, exportBankStatementPeriodExcel } from '../../utils/reportExport';

const fmt = (n) => Number(Math.abs(n || 0)).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SIGNATORY_OPTIONS = [
  { value: 'Sardar Tanveer Ilyas', label: 'Sardar Tanveer Ilyas' },
  { value: 'Sardar Umer Tanveer', label: 'Sardar Umer Tanveer' },
  { value: 'Hamza Tanveer', label: 'Hamza Tanveer' }
];

const baseUploadsUrl = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');

const clearedAtToYmd = (raw) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
};

const isValidYmd = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

/** Stable string key per unpresented row (Dr/Cr on same voucher must differ). */
const rowKey = (txn) => String(txn?._id ?? '');

const normDupField = (v) => String(v || '').trim().toLowerCase();
const roundDupAmt = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Match keys for duplicate detection in Unpresented list.
 * - Reference + Amount + Dr/Cr (when reference present)
 * - VrNo + Amount + Dr/Cr (when VrNo present)
 * - Fallback: Date + Amount + Dr/Cr + Narration
 */
const getDuplicateMatchKeys = (txn) => {
  const amount = roundDupAmt(txn?.amount);
  const type = txn?.type || (Number(txn?.credit) > 0 ? 'Cr' : 'Dr');
  const ref = normDupField(txn?.reference);
  const vr = normDupField(txn?.vrNo);
  const keys = [];
  if (ref) keys.push(`ref:${ref}|${amount}|${type}`);
  if (vr) keys.push(`vr:${vr}|${amount}|${type}`);
  if (!ref && !vr) {
    const date = txn?.date ? clearedAtToYmd(txn.date) : '';
    const narr = normDupField(txn?.narration);
    keys.push(`fb:${date}|${amount}|${type}|${narr}`);
  }
  return keys;
};

/** Returns Set of rowKey values that appear in a duplicate group (2+ matches). */
const buildDuplicateRowKeySet = (rows) => {
  const keyToIds = new Map();
  (rows || []).forEach((txn, idx) => {
    const id = rowKey(txn) || `row-${idx}`;
    getDuplicateMatchKeys(txn).forEach((matchKey) => {
      if (!keyToIds.has(matchKey)) keyToIds.set(matchKey, []);
      keyToIds.get(matchKey).push(id);
    });
  });
  const dupIds = new Set();
  keyToIds.forEach((ids) => {
    if (ids.length < 2) return;
    ids.forEach((id) => dupIds.add(id));
  });
  return dupIds;
};

/** Virtual window inside scrollable recon tables — only mount visible rows. */
const RECON_TABLE_MAX_H = 480;
/** Locked row height — must match rendered rows or scroll math drifts. */
const RECON_ROW_H = 56;
const RECON_OVERSCAN = 16;
const RECON_DATA_ROW_SX = {
  height: RECON_ROW_H,
  maxHeight: RECON_ROW_H,
  '& > td': {
    py: 0.5,
    verticalAlign: 'middle',
    height: RECON_ROW_H,
    maxHeight: RECON_ROW_H,
    boxSizing: 'border-box',
    overflow: 'hidden'
  }
};

/** Fit tables to page width — vertical scroll only, fixed column sizes. */
const RECON_TABLE_CONTAINER_SX = {
  maxHeight: RECON_TABLE_MAX_H,
  overflowX: 'hidden',
  overflowY: 'auto',
  width: '100%',
  maxWidth: '100%'
};
const RECON_TABLE_SX = {
  tableLayout: 'fixed',
  width: '100%'
};
const RECON_CELL_CLIP = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
};

/** Unpresented column template for header + react-window rows (sum = 100%). */
const UP_GRID = '3% 7% 10% 16% 8% 9% 5% 10% 11% 7% 8% 6%';
const UP_HEADER_SX = {
  display: 'grid',
  gridTemplateColumns: UP_GRID,
  alignItems: 'center',
  px: 1,
  height: 44,
  bgcolor: 'grey.50',
  borderBottom: '1px solid',
  borderColor: 'divider',
  fontWeight: 700,
  fontSize: '0.75rem'
};
const UP_ROW_SX = {
  display: 'grid',
  gridTemplateColumns: UP_GRID,
  alignItems: 'center',
  px: 1,
  height: RECON_ROW_H,
  borderBottom: '1px solid',
  borderColor: 'divider',
  boxSizing: 'border-box',
  '&:hover': { bgcolor: 'action.hover' }
};

/** Period activity column widths. */
const PD_COL = {
  date: { width: '12%' },
  vrNo: { width: '12%' },
  narration: { width: '28%' },
  reference: { width: '14%' },
  amount: { width: '14%' },
  clearDate: { width: '12%' },
  action: { width: '8%' }
};

const getWindowRange = (rowCount, scrollTop, viewportH = RECON_TABLE_MAX_H) => {
  if (!rowCount || rowCount <= 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  }
  const start = Math.max(0, Math.floor(scrollTop / RECON_ROW_H) - RECON_OVERSCAN);
  const end = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewportH) / RECON_ROW_H) + RECON_OVERSCAN
  );
  return {
    start,
    end,
    topPad: start * RECON_ROW_H,
    bottomPad: Math.max(0, (rowCount - end) * RECON_ROW_H)
  };
};

const scrollBucket = (scrollTop) => Math.floor(Math.max(0, scrollTop) / RECON_ROW_H);

const ScrollPadRow = ({ height, colSpan }) => {
  if (!height) return null;
  return (
    <TableRow aria-hidden>
      <TableCell
        colSpan={colSpan}
        sx={{ height, p: 0, border: 0, lineHeight: 0 }}
      />
    </TableRow>
  );
};


/** Summary cards skeleton while phase-1 As-of load runs. */
const SummarySkeleton = () => (
  <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
    <Skeleton variant="text" width="40%" height={28} />
    <Skeleton variant="text" width="70%" height={22} sx={{ mt: 1 }} />
    <Skeleton variant="text" width="55%" height={22} />
  </Paper>
);

/** Unpresented section skeleton — no rows until phase 1 completes. */
const UnpresentedSkeleton = () => (
  <Box sx={{ mb: 5 }}>
    <Skeleton variant="text" width={360} height={32} sx={{ mb: 1.5 }} />
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Loading unpresented / uncleared cheques…
      </Typography>
      <Skeleton variant="rectangular" height={RECON_TABLE_MAX_H} sx={{ borderRadius: 1 }} />
    </Paper>
  </Box>
);

/** Period section skeleton while phase 2 fills Period Activity. */
const PeriodSkeleton = () => (
  <Box sx={{ mb: 3 }}>
    <Divider sx={{ my: 3 }} />
    <Skeleton variant="text" width={280} height={32} sx={{ mb: 1.5 }} />
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Loading period activity…
      </Typography>
      <Skeleton variant="rectangular" height={320} sx={{ borderRadius: 1 }} />
    </Paper>
  </Box>
);

const buildReconcilePayload = (txn, clearanceStatus, clearedAt) => {
  const type = txn?.type || (Number(txn?.credit) > 0 ? 'Cr' : 'Dr');
  const amount = Number(txn?.amount) || 0;
  const debit = Number(txn?.debit) > 0 ? Number(txn.debit) : (type === 'Dr' ? amount : 0);
  const credit = Number(txn?.credit) > 0 ? Number(txn.credit) : (type === 'Cr' ? amount : 0);
  const linkedGlIds = Array.isArray(txn?.linkedGlIds)
    ? txn.linkedGlIds.map(String).filter(Boolean)
    : undefined;
  return {
    transactionIds: [rowKey(txn)],
    clearanceStatus,
    clearedAt,
    debit,
    credit,
    amount: amount || debit || credit,
    type,
    journalEntryId: txn?.journalEntryId ? String(txn.journalEntryId) : undefined,
    accountId: txn?.accountId ? String(txn.accountId) : undefined,
    ...(linkedGlIds?.length ? { linkedGlIds } : {})
  };
};

/** One Unpresented row inside react-window FixedSizeList. */
const UnpresentedVirtualRow = memo(({ index, style, data: itemData }) => {
  const {
    rows,
    selectedUnpresented,
    rowClearDates,
    clearingLoading,
    bulkClearing,
    getHandlers
  } = itemData;
  const {
    toggleUnpresentedSelect,
    setRowClearDates,
    handleDirectClear,
    openClearanceDialog,
    openRefDlg,
    openAttachDlg,
    saveSignedDocumentStatus
  } = getHandlers();
  const t = rows[index];
  if (!t) return null;
  const key = rowKey(t) || `row-${index}`;
  const isSigned = t.signedDocumentStatus === 'signed';
  const isSelected = selectedUnpresented.has(key);
  const defaultClearDate = rowClearDates[key] ?? '';
  const hasClearDate = isValidYmd(defaultClearDate);

  return (
    <Box
      style={style}
      sx={{
        ...UP_ROW_SX,
        bgcolor: isSelected ? 'action.selected' : 'background.paper'
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Checkbox
          size="small"
          checked={isSelected}
          onChange={() => toggleUnpresentedSelect(key)}
          disabled={bulkClearing}
          inputProps={{ 'aria-label': `Select ${t.vrNo || key}` }}
        />
      </Box>
      <Typography variant="body2" noWrap sx={RECON_CELL_CLIP}>{formatDate(t.date)}</Typography>
      <Typography variant="body2" fontWeight={600} noWrap>{t.vrNo}</Typography>
      <Tooltip title={t.narration || ''} enterDelay={500}>
        <Typography variant="body2" noWrap sx={RECON_CELL_CLIP}>{t.narration}</Typography>
      </Tooltip>
      <Stack direction="row" alignItems="center" gap={0.25} sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>{t.reference || '—'}</Typography>
        <IconButton size="small" onClick={() => openRefDlg(t)} sx={{ opacity: 0.3, flexShrink: 0, '&:hover': { opacity: 1 } }}>
          <EditIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Typography variant="body2" fontWeight={600} noWrap textAlign="right" sx={RECON_CELL_CLIP}>
        {t.type === 'Cr' ? `-${fmt(t.amount)}` : fmt(t.amount)}{' '}
        <Typography component="span" fontWeight={700} color={t.type === 'Cr' ? 'error.main' : 'success.main'}>
          {t.type}.
        </Typography>
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Tooltip title={`Attachments (${(t.attachments || []).length}) — click to add or view`}>
          <span>
            <IconButton
              size="small"
              color={(t.attachments || []).length > 0 ? 'primary' : 'default'}
              onClick={() => openAttachDlg(t)}
            >
              <AttachIcon fontSize="small" />
              {(t.attachments || []).length > 0 && (
                <Typography component="span" variant="caption" sx={{ fontSize: 10, fontWeight: 700, ml: 0.25 }}>
                  {t.attachments.length}
                </Typography>
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Box sx={{ overflow: 'hidden' }}>
        <Tooltip title="Click to toggle signed status">
          <Chip
            size="small"
            label={isSigned ? 'Signed' : 'Not Signed'}
            color={isSigned ? 'success' : 'default'}
            variant="outlined"
            onClick={() => saveSignedDocumentStatus(
              t,
              isSigned ? 'not_signed' : 'signed',
              isSigned ? '' : (t.signedBySignatory || SIGNATORY_OPTIONS[0]?.value || '')
            )}
            sx={{ height: 22, fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer' }}
          />
        </Tooltip>
      </Box>
      <Tooltip title={isSigned ? 'Click to cycle signatory' : 'Mark as Signed first'}>
        <Typography
          variant="caption"
          noWrap
          sx={{ cursor: isSigned ? 'pointer' : 'default', display: 'block' }}
          onClick={() => {
            if (!isSigned) return;
            const cur = t.signedBySignatory || '';
            const idx = SIGNATORY_OPTIONS.findIndex((o) => o.value === cur);
            const next = SIGNATORY_OPTIONS[(idx + 1) % SIGNATORY_OPTIONS.length];
            saveSignedDocumentStatus(t, 'signed', next.value);
          }}
        >
          {t.signedBySignatory || '—'}
        </Typography>
      </Tooltip>
      <Typography variant="body2" noWrap sx={RECON_CELL_CLIP}>
        {t.signedDocumentAt ? formatDate(t.signedDocumentAt) : '—'}
      </Typography>
      <Box sx={{ px: 0.25, overflow: 'hidden' }}>
        <TextField
          type="date"
          size="small"
          fullWidth
          value={defaultClearDate}
          onChange={(e) => {
            const val = e.target.value;
            setRowClearDates((prev) => ({ ...prev, [key]: val }));
          }}
          InputLabelProps={{ shrink: true }}
          inputProps={{ style: { fontSize: '0.75rem', padding: '4px 2px', height: 28, boxSizing: 'border-box' } }}
        />
      </Box>
      <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center">
        <Tooltip title={hasClearDate ? 'Clear cheque — moves to Period Activity' : 'Select a Clearing Date first'}>
          <span>
            <IconButton
              size="small"
              color="success"
              disabled={Boolean(clearingLoading[key]) || !hasClearDate}
              onClick={() => handleDirectClear(t)}
              sx={{
                bgcolor: 'rgba(46, 125, 50, 0.1)',
                border: '1px solid rgba(46, 125, 50, 0.3)',
                '&:hover': { bgcolor: 'success.main', color: '#fff' }
              }}
            >
              {clearingLoading[key] ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <ReconcileIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Clearance dialog / custom options">
          <IconButton size="small" color="primary" onClick={() => openClearanceDialog(t)}>
            <EditDateIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
});

export default function BankReconciliation() {
  const { selectedCompanyId, companies } = useFinanceCompany();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  /** True while phase-1 As-of runs — Unpresented skeleton only */
  const [blockingLoad, setBlockingLoad] = useState(false);
  /** True while phase-2 period rows are loading */
  const [periodLoading, setPeriodLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');
  const [bankAccounts, setBankAccounts] = useState([]);
  const [rowClearDates, setRowClearDates] = useState({});
  const [clearingLoading, setClearingLoading] = useState({});
  const [periodScrollTop, setPeriodScrollTop] = useState(0);
  const periodScrollRef = useRef(null);
  const periodBucketRef = useRef(0);
  const loadAbortRef = useRef(null);
  const unpresentedListRef = useRef(null);
  const [selectedUnpresented, setSelectedUnpresented] = useState(() => new Set());
  const [bulkClearing, setBulkClearing] = useState(false);

  const [filters, setFilters] = useState({
    asOfDate: new Date().toISOString().split('T')[0],
    // Period Activity default From — aligns with hard-coded ledger start
    fromDate: '2000-01-01',
    toDate: new Date().toISOString().split('T')[0],
    bankAccountId: ''
  });

  const [clearanceDialog, setClearanceDialog] = useState({
    open: false,
    transaction: null,
    status: 'pending',
    clearedAtDate: ''
  });

  const [attachDlg, setAttachDlg] = useState({ open: false, txn: null, uploading: false });
  const [attachError, setAttachError] = useState('');
  const [importDlg, setImportDlg] = useState({ open: false, uploading: false, file: null });

  const [refDlg, setRefDlg] = useState({ open: false, txn: null, reference: '', loading: false });

  const openRefDlg = (txn) => {
    setRefDlg({ open: true, txn, reference: txn.reference || '', loading: false });
  };

  const closeRefDlg = () => {
    setRefDlg({ open: false, txn: null, reference: '', loading: false });
  };

  const saveReference = async () => {
    if (!refDlg.txn) return;
    const targetJeId = refDlg.txn.journalEntry || refDlg.txn.journalEntryId || String(refDlg.txn._id).split('-')[0];
    if (!targetJeId || !/^[0-9a-fA-F]{24}$/.test(targetJeId)) {
      setError('Linked voucher not found for updating reference.');
      return;
    }
    
    try {
      setRefDlg(p => ({ ...p, loading: true }));
      await api.put(`/finance/journal-entries/${targetJeId}/reference`, {
        reference: refDlg.reference
      });
      setSuccess('Reference updated successfully');
      closeRefDlg();
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update reference');
      setRefDlg(p => ({ ...p, loading: false }));
    }
  };

  const openAttachDlg = (txn) => {
    setAttachError('');
    setAttachDlg({ open: true, txn, uploading: false });
  };

  const closeAttachDlg = () => {
    setAttachDlg({ open: false, txn: null, uploading: false });
    setAttachError('');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !attachDlg.txn) return;
    const targetJeId = attachDlg.txn.journalEntryId || String(attachDlg.txn._id).split('-')[0];
    if (!targetJeId || !/^[0-9a-fA-F]{24}$/.test(targetJeId)) {
      setAttachError('Linked voucher not found for uploading attachment.');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    setAttachDlg((d) => ({ ...d, uploading: true }));
    setAttachError('');
    try {
      const res = await api.post(`/finance/journal-entries/${targetJeId}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const updatedAttachments = res?.data?.data?.attachments || [];
      setAttachDlg((d) => ({
        ...d,
        txn: d.txn ? { ...d.txn, attachments: updatedAttachments } : null
      }));
      setSuccess('Attachment uploaded successfully');
      load();
    } catch (err) {
      setAttachError(err.response?.data?.message || 'Upload failed');
    } finally {
      setAttachDlg((d) => ({ ...d, uploading: false }));
      e.target.value = '';
    }
  };

  const handleDeleteAttachment = async (filename) => {
    if (!attachDlg.txn) return;
    const targetJeId = attachDlg.txn.journalEntryId || String(attachDlg.txn._id).split('-')[0];
    if (!targetJeId || !/^[0-9a-fA-F]{24}$/.test(targetJeId)) return;
    try {
      const res = await api.delete(`/finance/journal-entries/${targetJeId}/attachments/${encodeURIComponent(filename)}`);
      const updatedAttachments = res?.data?.data?.attachments || [];
      setAttachDlg((d) => ({
        ...d,
        txn: d.txn ? { ...d.txn, attachments: updatedAttachments } : null
      }));
      setSuccess('Attachment deleted');
      load();
    } catch (err) {
      setAttachError(err.response?.data?.message || 'Delete failed');
    }
  };

  const saveSignedDocumentStatus = async (txn, nextStatus, signedBySignatory) => {
    const targetJeId = txn.journalEntryId || String(txn._id).split('-')[0];
    if (!targetJeId || !/^[0-9a-fA-F]{24}$/.test(targetJeId)) {
      setError('Linked voucher not found.');
      return;
    }
    try {
      const payload = { signedDocumentStatus: nextStatus };
      if (nextStatus === 'signed') {
        if (signedBySignatory !== undefined) {
          payload.signedBySignatory = signedBySignatory || null;
        }
      }
      await api.put(`/finance/journal-entries/${targetJeId}/signed-document`, payload);
      setSuccess(`Voucher marked as ${nextStatus === 'signed' ? 'signed' : 'not signed'}`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update signed document status');
    }
  };

  const loadBankAccounts = useCallback(async () => {
    try {
      // 1. Fetch COA accounts (Asset bank/cash accounts & sub-accounts) for selected company
      const coaList = await fetchPayFromAccounts(api, { companyId: selectedCompanyId });
      let accountsList = (coaList || []).map((item) => ({
        _id: item.account?._id || item._id,
        accountName: item.account?.name || item.name,
        accountNumber: item.account?.accountNumber || item.accountNumber,
        bankName: item.account?.category || item.account?.detailType || 'Bank Account',
        depth: item.depth || 0
      }));

      // 2. If empty, fallback to /finance/accounts with broad bank/cash search
      if (!accountsList.length) {
        const res = await api.get('/finance/accounts', {
          params: {
            type: 'Asset',
            limit: 500,
            ...(selectedCompanyId ? { companyId: selectedCompanyId } : {})
          }
        });
        const list = res.data?.data?.accounts || res.data?.accounts || [];
        accountsList = list.map((a) => ({
          _id: a._id,
          accountName: a.name,
          accountNumber: a.accountNumber,
          bankName: a.category || a.detailType || 'Bank Account',
          depth: 0
        }));
      }

      // Filter out Cash in Hand accounts (Bank reconciliation is only for banks)
      accountsList = accountsList.filter((a) => {
        const name = (a.accountName || '').toLowerCase();
        return !name.includes('cash in hand') && !name.includes('cash');
      });

      setBankAccounts(accountsList);
      if (accountsList.length > 0) {
        setFilters((prev) => {
          const exists = accountsList.some(a => String(a._id) === String(prev.bankAccountId));
          return {
            ...prev,
            bankAccountId: exists ? prev.bankAccountId : accountsList[0]._id
          };
        });
      } else {
        setFilters((prev) => ({ ...prev, bankAccountId: '' }));
      }
    } catch (_) {
      setBankAccounts([]);
    }
  }, [selectedCompanyId]);

  // scope: 'all' | 'unpresented' | 'period' — As-of uses two-phase load (Unpresented first)
  const load = useCallback(async (scope = 'all') => {
    if (!filters.bankAccountId) return;

    const asOfDate = String(filters.asOfDate || '').trim();
    const fromDate = String(filters.fromDate || '').trim();
    const toDate = String(filters.toDate || '').trim();
    const LEDGER_FROM_BEGINNING = '2000-01-01';

    if (scope === 'unpresented') {
      if (!isValidYmd(asOfDate)) {
        setError('Please enter a valid As of Date.');
        return;
      }
    } else if (scope === 'period') {
      if (!isValidYmd(fromDate) || !isValidYmd(toDate)) {
        setError('Please enter valid Date From / Date To.');
        return;
      }
      if (fromDate > toDate) {
        setError('Date From cannot be after Date To.');
        return;
      }
    } else {
      if (!isValidYmd(asOfDate)) {
        setError('Please enter a valid As of Date.');
        return;
      }
      if (isValidYmd(fromDate) && isValidYmd(toDate) && fromDate > toDate) {
        setError('Date From cannot be after Date To.');
        return;
      }
    }

    if (loadAbortRef.current) {
      loadAbortRef.current.abort();
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    loadAbortRef.current = controller;

    const isBlocking = scope === 'all' || scope === 'unpresented';
    if (isBlocking) {
      setData(null);
      setBlockingLoad(true);
      setPeriodLoading(true);
      setPeriodScrollTop(0);
      periodBucketRef.current = 0;
      setSelectedUnpresented(new Set());
      if (unpresentedListRef.current) unpresentedListRef.current.scrollTo(0);
    } else {
      setPeriodLoading(true);
    }
    setLoading(true);
    setError('');

    // Period From/To are independent UI filters — never overwrite them from As of
    const periodFrom = isValidYmd(fromDate) ? fromDate : LEDGER_FROM_BEGINNING;
    const periodTo = isValidYmd(toDate) ? toDate : (isValidYmd(asOfDate) ? asOfDate : filters.toDate);
    const baseParams = {
      accountId: filters.bankAccountId,
      asOfDate: isValidYmd(asOfDate) ? asOfDate : filters.asOfDate,
      ledgerFromDate: LEDGER_FROM_BEGINNING,
      fromDate: periodFrom,
      toDate: periodTo
    };

    try {
      if (scope === 'period') {
        const res = await api.get('/finance/reports/bank-reconciliation', {
          params: { ...baseParams, includePeriodRows: 1, _t: Date.now() },
          signal: controller?.signal
        });
        const reportData = res.data?.data;
        if (!reportData) return;
        // Period filter only updates the lower section — top Bank Statement stays As-of
        startTransition(() => {
          setData((prev) => {
            if (!prev) return reportData;
            return {
              ...prev,
              fromDate: reportData.fromDate,
              toDate: reportData.toDate,
              openingBalance: reportData.openingBalance,
              openingBalanceType: reportData.openingBalanceType,
              periodTransactions: reportData.periodTransactions || [],
              periodTotalCount: reportData.periodTotalCount,
              periodDeferred: false,
              statementTotal: reportData.statementTotal,
              statementTotalType: reportData.statementTotalType
            };
          });
        });
        setPeriodScrollTop(0);
        periodBucketRef.current = 0;
        if (periodScrollRef.current) periodScrollRef.current.scrollTop = 0;
        return;
      }

      // ── Phase 1: summary (As-of Bank Statement) + full Unpresented ──
      const res1 = await api.get('/finance/reports/bank-reconciliation', {
        params: { ...baseParams, includePeriodRows: 0, _t: Date.now() },
        signal: controller?.signal
      });
      const phase1 = res1.data?.data;
      if (!phase1) {
        setData(null);
        return;
      }
      startTransition(() => {
        setData(phase1);
      });
      setBlockingLoad(false);
      setLoading(false);

      // ── Phase 2: Period Activity rows for current From/To (does not replace top As-of statement) ──
      if (controller?.signal?.aborted) return;
      setPeriodLoading(true);
      const res2 = await api.get('/finance/reports/bank-reconciliation', {
        params: { ...baseParams, includePeriodRows: 1, _t: Date.now() },
        signal: controller?.signal
      });
      const phase2 = res2.data?.data;
      if (!phase2) return;
      startTransition(() => {
        setData((prev) => {
          if (!prev) return phase2;
          return {
            ...prev,
            fromDate: phase2.fromDate,
            toDate: phase2.toDate,
            openingBalance: phase2.openingBalance,
            openingBalanceType: phase2.openingBalanceType,
            periodTransactions: phase2.periodTransactions || [],
            periodTotalCount: phase2.periodTotalCount,
            periodDeferred: false,
            statementTotal: phase2.statementTotal,
            statementTotalType: phase2.statementTotalType
            // keep prev.bankStatementBalance / glBalance / difference / unpresented from phase 1
          };
        });
      });
      setPeriodScrollTop(0);
      periodBucketRef.current = 0;
      if (periodScrollRef.current) periodScrollRef.current.scrollTop = 0;
    } catch (e) {
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED' || e?.name === 'AbortError') {
        return;
      }
      setError(e.response?.data?.message || 'Failed to load reconciliation data');
      if (isBlocking) setData(null);
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setLoading(false);
        setBlockingLoad(false);
        setPeriodLoading(false);
      }
    }
  }, [filters]);

  const unpresentedRows = useMemo(
    () => data?.unpresentedTransactions || [],
    [data?.unpresentedTransactions]
  );
  const clearableUnpresentedRows = useMemo(
    () => unpresentedRows.filter((t) => !t.isCleared),
    [unpresentedRows]
  );
  const periodRows = data?.periodTransactions || [];
  // Opening-balance row sits above the virtualized list — offset scroll by one row.
  const periodWindow = useMemo(
    () => getWindowRange(periodRows.length, Math.max(0, periodScrollTop - RECON_ROW_H)),
    [periodRows.length, periodScrollTop]
  );

  const handlePeriodScroll = (e) => {
    const top = e.currentTarget.scrollTop;
    const bucket = scrollBucket(top);
    if (bucket === periodBucketRef.current) return;
    periodBucketRef.current = bucket;
    setPeriodScrollTop(top);
  };

  useEffect(() => {
    loadBankAccounts();
  }, [loadBankAccounts, selectedCompanyId]);

  // Only auto-load when the bank account changes. Date fields apply via
  // Generate / Filter so typing or picking dates does not wipe the screen.
  useEffect(() => {
    if (!filters.bankAccountId) {
      setData(null);
      return undefined;
    }
    setData(null);
    setSelectedUnpresented(new Set());
    load();
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.bankAccountId]);

  useFinanceCompanyReload(() => {
    loadBankAccounts();
  }, { skipInitial: true });

  const openClearanceDialog = (txn) => {
    const isCleared = txn?.clearanceStatus === 'cleared';
    const key = rowKey(txn);
    setClearanceDialog({
      open: true,
      transaction: txn,
      status: isCleared ? 'cleared' : (txn?.clearanceStatus || 'pending'),
      // Blank by default — only use an existing clear date or a date the user already picked on the row
      clearedAtDate:
        (isCleared && txn?.clearingDate ? clearedAtToYmd(txn.clearingDate) : '')
        || (rowClearDates[key] || '')
    });
  };

  const closeClearanceDialog = () => {
    setClearanceDialog({ open: false, transaction: null, status: 'pending', clearedAtDate: '' });
  };

  const saveClearance = async () => {
    if (!clearanceDialog.transaction?._id) return;
    const txn = clearanceDialog.transaction;
    const nextStatus = clearanceDialog.status || 'pending';
    let clearedAt = null;

    if (nextStatus === 'cleared') {
      const ymd = (clearanceDialog.clearedAtDate || '').trim();
      if (!ymd) {
        window.alert('Please select a clearance date using the calendar.');
        return;
      }
      clearedAt = new Date(`${ymd}T12:00:00.000Z`).toISOString();
    }

    try {
      await api.post('/finance/reports/bank-reconciliation/reconcile', buildReconcilePayload(txn, nextStatus, clearedAt));

      setSuccess('Clearance status updated successfully');
      closeClearanceDialog();
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update clearance');
    }
  };

  const handleDirectClear = async (txn) => {
    if (!txn?._id) return;
    const key = rowKey(txn);
    // Clearing date must be chosen explicitly — never auto-fill today / As of
    const selectedDate = (rowClearDates[key] || '').trim();

    if (!isValidYmd(selectedDate)) {
      setError('Please select a Clearing Date for this row before clearing.');
      return;
    }

    const clearedAt = new Date(`${selectedDate}T12:00:00.000Z`).toISOString();
    setClearingLoading((prev) => ({ ...prev, [key]: true }));
    setError('');

    try {
      await api.post(
        '/finance/reports/bank-reconciliation/reconcile',
        buildReconcilePayload(txn, 'cleared', clearedAt)
      );
      setRowClearDates((prev) => ({ ...prev, [key]: selectedDate }));
      setSuccess(`Entry ${txn.vrNo || ''} (${txn.type || ''}) cleared.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not clear transaction');
    } finally {
      setClearingLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const toggleUnpresentedSelect = (key) => {
    setSelectedUnpresented((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllUnpresented = () => {
    setSelectedUnpresented((prev) => {
      const clearableKeys = clearableUnpresentedRows.map((t) => rowKey(t)).filter(Boolean);
      if (clearableKeys.length && prev.size === clearableKeys.length) {
        return new Set();
      }
      return new Set(clearableKeys);
    });
  };

  const handleBulkClearSelected = async () => {
    if (!selectedUnpresented.size) {
      setError('Select at least one uncleared record.');
      return;
    }

    const toClear = clearableUnpresentedRows.filter((t) => selectedUnpresented.has(rowKey(t)));
    if (!toClear.length) {
      setError('Selected records are already cleared or no longer available. Refresh and try again.');
      return;
    }

    const missingDate = toClear.filter((t) => !isValidYmd(rowClearDates[rowKey(t)]));
    if (missingDate.length) {
      setError(
        `Set Clearing Date on each selected row first (${missingDate.length} selected row${missingDate.length === 1 ? '' : 's'} missing a date).`
      );
      return;
    }

    setBulkClearing(true);
    setError('');
    setSuccess('');

    let ok = 0;
    let fail = 0;

    for (const txn of toClear) {
      const key = rowKey(txn);
      const ymd = String(rowClearDates[key] || '').trim();
      const clearedAt = new Date(`${ymd}T12:00:00.000Z`).toISOString();
      try {
        await api.post(
          '/finance/reports/bank-reconciliation/reconcile',
          buildReconcilePayload(txn, 'cleared', clearedAt)
        );
        ok += 1;
      } catch {
        fail += 1;
      }
    }

    setSelectedUnpresented(new Set());
    if (ok && !fail) {
      setSuccess(`Cleared ${ok} selected record${ok === 1 ? '' : 's'} using each row's clearing date.`);
    } else if (ok && fail) {
      setSuccess(`Cleared ${ok} record(s); ${fail} failed.`);
      setError(`${fail} selected record(s) could not be cleared.`);
    } else {
      setError('Could not clear the selected records.');
    }
    await load();
    setBulkClearing(false);
  };

  const handleDirectUnclear = async (txn) => {
    if (!txn?._id) return;
    const key = rowKey(txn);
    const existingDate = txn.clearingDate ? clearedAtToYmd(txn.clearingDate) : (rowClearDates[key] || null);
    setClearingLoading((prev) => ({ ...prev, [key]: true }));
    setError('');

    try {
      await api.post(
        '/finance/reports/bank-reconciliation/reconcile',
        buildReconcilePayload(
          txn,
          'pending',
          existingDate ? new Date(`${existingDate}T12:00:00.000Z`).toISOString() : null
        )
      );
      if (existingDate) {
        setRowClearDates((prev) => ({ ...prev, [key]: existingDate }));
      }
      setSuccess(`Entry ${txn.vrNo || ''} (${txn.type || ''}) moved back to unpresented.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not revert clearance');
    } finally {
      setClearingLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleImport = async () => {
    if (!importDlg.file) {
      setError('Please select an Excel file first.');
      return;
    }
    const companyId = selectedCompanyId;
    if (!companyId) {
      setError('Please select a company first.');
      return;
    }
    
    setImportDlg(prev => ({ ...prev, uploading: true }));
    const formData = new FormData();
    formData.append('file', importDlg.file);
    formData.append('companyId', companyId);
    
    try {
      const res = await api.post('/finance/journals/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSuccess(res.data.message || 'Import successful');
      setImportDlg({ open: false, uploading: false, file: null });
      if (filters.bankAccountId) {
        load();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to import data');
      setImportDlg(prev => ({ ...prev, uploading: false }));
    }
  };

  // Stable handler bag so FixedSizeList itemData identity only changes with row state
  const unpresentedHandlersRef = useRef({});
  unpresentedHandlersRef.current = {
    toggleUnpresentedSelect,
    setRowClearDates,
    handleDirectClear,
    openClearanceDialog,
    openRefDlg,
    openAttachDlg,
    saveSignedDocumentStatus
  };
  const unpresentedItemData = useMemo(() => ({
    rows: unpresentedRows,
    selectedUnpresented,
    rowClearDates,
    clearingLoading,
    bulkClearing,
    getHandlers: () => unpresentedHandlersRef.current
  }), [
    unpresentedRows,
    selectedUnpresented,
    rowClearDates,
    clearingLoading,
    bulkClearing
  ]);

  const selectedAccount = bankAccounts.find(a => a._id === filters.bankAccountId);

  return (
    <Box sx={{ p: 3, width: '100%', maxWidth: '100%', overflowX: 'hidden', boxSizing: 'border-box' }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h5" fontWeight={700} display="flex" alignItems="center" gap={1}>
            <BankIcon color="primary" /> Bank Reconciliation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Reconcile general ledger bank records against bank statements and unpresented cheques
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center">
          <Button 
            variant="outlined" 
            onClick={() => setImportDlg({ open: true, uploading: false, file: null })}
          >
            Import Data
          </Button>
          <FinanceCompanySelector size="small" />
        </Stack>
      </Stack>

      {error   && <Alert severity="error"   onClose={() => setError('')}   sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {/* Main Filter & Parameters Bar */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={5}>
            <FormControl fullWidth size="small">
              <InputLabel>Account Code / Bank Account</InputLabel>
              <Select
                label="Account Code / Bank Account"
                value={filters.bankAccountId}
                onChange={(e) => setFilters((prev) => ({ ...prev, bankAccountId: e.target.value }))}
              >
                {bankAccounts.map((acc) => {
                  const depth = acc.depth || 0;
                  return (
                    <MenuItem key={acc._id} value={acc._id} sx={{ pl: 2 + depth * 2.5 }}>
                      {depth > 0 && <span style={{ color: '#888', marginRight: 6 }}>↳</span>}
                      <b>{acc.accountNumber || '—'}</b> &nbsp;—&nbsp; {acc.accountName || acc.bankName}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              label="As of Date"
              type="date"
              size="small"
              value={filters.asOfDate}
              onChange={(e) => {
                setFilters((prev) => ({
                  ...prev,
                  asOfDate: e.target.value
                }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  load('unpresented');
                }
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Button
              fullWidth
              variant="contained"
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
              onClick={() => load('unpresented')}
              disabled={loading || !filters.bankAccountId}
              sx={{ height: 40 }}
            >
              Generate Reconciliation
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {blockingLoad && (
        <>
          <SummarySkeleton />
          <UnpresentedSkeleton />
          <PeriodSkeleton />
        </>
      )}

      {/* Summary after phase 1 — Unpresented paint; Period may still be loading */}
      {data && !blockingLoad && (
        <Paper variant="outlined" sx={{ mb: 4, overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell sx={{ fontWeight: 700, width: '65%' }}>Narration / Description</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Amount (PKR)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow hover>
                  <TableCell sx={{ fontWeight: 600 }}>Balance as Per Bank Ledger</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: data.glBalanceType === 'Cr' ? 'error.main' : 'success.main' }}>
                    {data.glBalance < 0 ? `-${fmt(data.glBalance)}` : fmt(data.glBalance)}{' '}
                    <Typography component="span" fontWeight={800} color={data.glBalanceType === 'Cr' ? 'error.main' : 'success.main'}>
                      {data.glBalanceType}.
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow hover>
                  <TableCell sx={{ fontWeight: 600 }}>Difference (Unpresented / Uncleared Cheques)</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: data.differenceType === 'Cr' ? 'error.main' : 'success.main' }}>
                    {data.difference < 0 ? `-${fmt(data.difference)}` : fmt(data.difference)}{' '}
                    <Typography component="span" fontWeight={800} color={data.differenceType === 'Cr' ? 'error.main' : 'success.main'}>
                      {data.differenceType}.
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow sx={{ bgcolor: 'primary.50' }}>
                  <TableCell sx={{ fontWeight: 800, color: 'primary.dark' }}>Balance as Per Bank Statement</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, fontSize: '1.05rem', color: data.bankStatementBalanceType === 'Cr' ? 'error.main' : 'success.main' }}>
                    {data.bankStatementBalance < 0 ? `-${fmt(data.bankStatementBalance)}` : fmt(data.bankStatementBalance)}{' '}
                    <Typography component="span" fontWeight={900} color={data.bankStatementBalanceType === 'Cr' ? 'error.main' : 'success.main'}>
                      {data.bankStatementBalanceType}.
                    </Typography>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Upper Table: Unpresented / Uncleared Cheques & Payments */}
      {data && !blockingLoad && (
        <Box sx={{ mb: 5 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5} flexWrap="wrap" gap={1}>
            <Typography variant="h6" fontWeight={700}>
              Unpresented / Uncleared Cheques &amp; Payments ({unpresentedRows.length})
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<PdfIcon />}
                disabled={exportingPdf || periodLoading}
                onClick={async () => {
                  try {
                    setExportingPdf(true);
                    let full = data;
                    if (data?.periodDeferred || periodLoading) {
                      const LEDGER_FROM_BEGINNING = '2000-01-01';
                      const res = await api.get('/finance/reports/bank-reconciliation', {
                        params: {
                          accountId: filters.bankAccountId,
                          asOfDate: filters.asOfDate,
                          ledgerFromDate: LEDGER_FROM_BEGINNING,
                          fromDate: filters.fromDate || LEDGER_FROM_BEGINNING,
                          toDate: filters.toDate,
                          includePeriodRows: 1,
                          _t: Date.now()
                        }
                      });
                      full = res.data?.data || data;
                    }
                    const bankName = bankAccounts.find(b => String(b._id) === String(filters.bankAccountId))?.accountName || 'Bank';
                    const companyName = companies?.find(c => String(c._id) === String(selectedCompanyId))?.name || '';
                    exportBankReconciliationPDF(full, filters, bankName, companyName);
                  } catch (e) {
                    setError(e.response?.data?.message || 'Failed to export PDF');
                  } finally {
                    setExportingPdf(false);
                  }
                }}
              >
                {exportingPdf ? 'Preparing…' : 'PDF'}
              </Button>
              {data.reconciledUpTo && (
                <Chip
                  label={`Reconciled Up To: ${formatDate(data.reconciledUpTo)}`}
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: 700 }}
                />
              )}
              <Chip
                label={`Total Difference: ${data.difference < 0 ? `-${fmt(data.difference)}` : fmt(data.difference)} ${data.differenceType}.`}
                color={data.differenceType === 'Cr' ? 'error' : 'success'}
                variant="outlined"
                sx={{ fontWeight: 700 }}
              />
            </Stack>
          </Box>

          {clearableUnpresentedRows.length > 0 && (
            <Paper
              variant="outlined"
              sx={{
                mb: 1.5,
                px: 2,
                py: 1.25,
                bgcolor: selectedUnpresented.size ? 'success.50' : 'grey.50'
              }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
              >
                <Typography variant="body2" fontWeight={600}>
                  {selectedUnpresented.size
                    ? `${selectedUnpresented.size} selected — each uses its own Clearing Date`
                    : 'Set Clearing Date on rows, select them, then Clear Selected (cleared items move to Period Activity)'}
                </Typography>
                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  startIcon={bulkClearing ? <CircularProgress size={16} color="inherit" /> : <ReconcileIcon />}
                  disabled={selectedUnpresented.size < 1 || bulkClearing}
                  onClick={handleBulkClearSelected}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  Clear Selected{selectedUnpresented.size ? ` (${selectedUnpresented.size})` : ''}
                </Button>
              </Stack>
            </Paper>
          )}

          <Paper variant="outlined" sx={{ overflow: 'hidden', width: '100%' }}>
            <Box sx={UP_HEADER_SX}>
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Checkbox
                  size="small"
                  indeterminate={
                    selectedUnpresented.size > 0
                    && selectedUnpresented.size < clearableUnpresentedRows.length
                  }
                  checked={
                    clearableUnpresentedRows.length > 0
                    && selectedUnpresented.size === clearableUnpresentedRows.length
                  }
                  onChange={toggleSelectAllUnpresented}
                  disabled={!clearableUnpresentedRows.length || bulkClearing}
                  inputProps={{ 'aria-label': 'Select all uncleared' }}
                />
              </Box>
              <Box>Date</Box>
              <Box>VrNo</Box>
              <Box>Narration</Box>
              <Box>Reference</Box>
              <Box sx={{ textAlign: 'right' }}>Amount</Box>
              <Box sx={{ textAlign: 'center' }}>Attachment</Box>
              <Box>Signed Document</Box>
              <Box>Signed By</Box>
              <Box>Signed Date</Box>
              <Box sx={{ textAlign: 'center' }}>Clearing.Date</Box>
              <Box sx={{ textAlign: 'center' }}>Action</Box>
            </Box>
            {unpresentedRows.length === 0 ? (
              <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                No unpresented / uncleared cheques up to {formatDate(filters.asOfDate)}.
              </Box>
            ) : (
              <VirtualList
                ref={unpresentedListRef}
                height={RECON_TABLE_MAX_H}
                width="100%"
                itemCount={unpresentedRows.length}
                itemSize={RECON_ROW_H}
                itemData={unpresentedItemData}
                overscanCount={8}
              >
                {UnpresentedVirtualRow}
              </VirtualList>
            )}
          </Paper>
          {unpresentedRows.length > 0 && (
            <Paper variant="outlined" sx={{ mt: 0, borderTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: UP_GRID,
                  alignItems: 'center',
                  px: 1,
                  py: 1.25,
                  bgcolor: 'grey.100'
                }}
              >
                <Box sx={{ gridColumn: '1 / 6', fontWeight: 800, fontSize: '0.95rem' }}>Total</Box>
                <Box
                  sx={{
                    gridColumn: '6 / 7',
                    textAlign: 'right',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                    color: data.differenceType === 'Cr' ? 'error.main' : 'success.main'
                  }}
                >
                  {data.difference < 0 ? `-${fmt(data.difference)}` : fmt(data.difference)} {data.differenceType}.
                </Box>
              </Box>
            </Paper>
          )}
        </Box>
      )}

      {/* Lower Table: Period Activity — skeleton until phase 2 completes */}
      {data && !blockingLoad && periodLoading && <PeriodSkeleton />}
      {data && !blockingLoad && !periodLoading && (
        <Box sx={{ mb: 3 }}>
          <Divider sx={{ my: 3 }} />

          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" mb={2} gap={2}>
            <Box>
              <Typography variant="h6" fontWeight={700}>
                Bank Statement &amp; Period Activity ({periodRows.length})
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Cleared bank transactions between selected dates
              </Typography>
            </Box>

            {/* Date Range Filter for Lower Table */}
            <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
              <TextField
                label="Date.From"
                type="date"
                size="small"
                value={filters.fromDate}
                onChange={(e) => {
                  const fromDate = e.target.value;
                  setFilters((prev) => ({
                    ...prev,
                    fromDate,
                    toDate: prev.toDate && fromDate && prev.toDate < fromDate ? fromDate : prev.toDate
                  }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    load('period');
                  }
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 160 }}
              />
              <TextField
                label="Date.To"
                type="date"
                size="small"
                value={filters.toDate}
                onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    load('period');
                  }
                }}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: filters.fromDate || undefined }}
                sx={{ width: 160 }}
              />
              <Button
                variant="outlined"
                size="small"
                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
                onClick={() => load('period')}
                disabled={loading || !filters.bankAccountId}
                sx={{ height: 40 }}
              >
                Filter
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="success"
                startIcon={<ExcelIcon />}
                disabled={!data}
                onClick={() => {
                  const bankName = bankAccounts.find((a) => a._id === filters.bankAccountId)?.accountName || 'Bank';
                  const companyName = companies.find((c) => c._id === selectedCompanyId)?.name || 'SGC International';
                  exportBankStatementPeriodExcel(data, filters, bankName, companyName);
                }}
                sx={{ height: 40, textTransform: 'none', fontWeight: 600 }}
              >
                Excel
              </Button>
            </Stack>
          </Stack>

          <TableContainer
            ref={periodScrollRef}
            component={Paper}
            variant="outlined"
            sx={RECON_TABLE_CONTAINER_SX}
            onScroll={handlePeriodScroll}
          >
            <Table size="small" stickyHeader sx={RECON_TABLE_SX}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', ...PD_COL.date }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', ...PD_COL.vrNo }}>VrNo</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', ...PD_COL.narration }}>Narration</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.50', ...PD_COL.reference }}>Reference</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, bgcolor: 'grey.50', ...PD_COL.amount }}>Amount</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700, bgcolor: 'grey.50', ...PD_COL.clearDate }}>Clearing.Date</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700, bgcolor: 'grey.50', ...PD_COL.action }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {/* Opening Balance Row */}
                <TableRow sx={{ bgcolor: 'info.50' }}>
                  <TableCell sx={{ fontWeight: 600, ...PD_COL.date }}>—</TableCell>
                  <TableCell sx={{ fontWeight: 600, ...PD_COL.vrNo }}>—</TableCell>
                  <TableCell sx={{ fontWeight: 700, ...PD_COL.narration }}>Opening Balance</TableCell>
                  <TableCell sx={PD_COL.reference}>—</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, ...PD_COL.amount }}>
                    {data.openingBalance < 0 ? `-${fmt(data.openingBalance)}` : fmt(data.openingBalance)}{' '}
                    <Typography component="span" fontWeight={800} color={data.openingBalanceType === 'Cr' ? 'error.main' : 'success.main'}>
                      {data.openingBalanceType}.
                    </Typography>
                  </TableCell>
                  <TableCell align="center" sx={PD_COL.clearDate}>—</TableCell>
                  <TableCell align="center" sx={PD_COL.action}>—</TableCell>
                </TableRow>

                {/* Period Transactions (windowed) */}
                <ScrollPadRow height={periodWindow.topPad} colSpan={7} />
                {periodRows.slice(periodWindow.start, periodWindow.end).map((t, idx) => (
                  <TableRow key={t._id || `period-${periodWindow.start + idx}`} hover sx={RECON_DATA_ROW_SX}>
                    <TableCell sx={{ ...RECON_CELL_CLIP, ...PD_COL.date }}>{formatDate(t.date)}</TableCell>
                    <TableCell sx={{ fontWeight: 600, ...RECON_CELL_CLIP, ...PD_COL.vrNo }}>{t.vrNo}</TableCell>
                    <TableCell sx={{ ...RECON_CELL_CLIP, ...PD_COL.narration }}>
                      <Tooltip title={t.narration || ''} enterDelay={500}>
                        <span>{t.narration}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ ...PD_COL.reference, overflow: 'hidden' }}>
                      <Stack direction="row" alignItems="center" gap={0.25} sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>{t.reference || '—'}</Typography>
                        <IconButton size="small" onClick={() => openRefDlg(t)} sx={{ opacity: 0.3, flexShrink: 0, '&:hover': { opacity: 1 } }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, ...RECON_CELL_CLIP, ...PD_COL.amount }}>
                      {t.type === 'Cr' ? `-${fmt(t.amount)}` : fmt(t.amount)}{' '}
                      <Typography component="span" fontWeight={700} color={t.type === 'Cr' ? 'error.main' : 'success.main'}>
                        {t.type}.
                      </Typography>
                    </TableCell>
                    <TableCell align="center" sx={{ ...RECON_CELL_CLIP, ...PD_COL.clearDate }}>
                      {t.clearingDate ? formatDate(t.clearingDate) : '—'}
                    </TableCell>
                    <TableCell align="center" sx={PD_COL.action}>
                      <Tooltip title="Un-clear / Move back to Unpresented Cheques">
                        <span>
                          <IconButton
                            size="small"
                            color="warning"
                            disabled={Boolean(clearingLoading[t._id])}
                            onClick={() => handleDirectUnclear(t)}
                            sx={{
                              bgcolor: 'rgba(237, 108, 2, 0.08)',
                              border: '1px solid rgba(237, 108, 2, 0.3)',
                              '&:hover': { bgcolor: 'warning.main', color: '#fff' }
                            }}
                          >
                            {clearingLoading[t._id] ? (
                              <CircularProgress size={16} color="inherit" />
                            ) : (
                              <UndoIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                <ScrollPadRow height={periodWindow.bottomPad} colSpan={7} />
              </TableBody>
            </Table>
          </TableContainer>
          <Paper variant="outlined" sx={{ mt: 0, borderTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            <Table size="small" sx={RECON_TABLE_SX}>
              <TableBody>
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={4} sx={{ fontWeight: 800, fontSize: '0.95rem' }}>
                    Total
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, fontSize: '0.95rem', color: data.statementTotalType === 'Cr' ? 'error.main' : 'success.main' }}>
                    {data.statementTotal < 0 ? `-${fmt(data.statementTotal)}` : fmt(data.statementTotal)}{' '}
                    <Typography component="span" fontWeight={800} color={data.statementTotalType === 'Cr' ? 'error.main' : 'success.main'}>
                      {data.statementTotalType}.
                    </Typography>
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}

      {/* Clearance Dialog */}
      <Dialog
        open={clearanceDialog.open}
        onClose={closeClearanceDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Update Clearance — {clearanceDialog.transaction?.vrNo || 'Transaction'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                select
                size="small"
                label="Clearance Status"
                value={clearanceDialog.status}
                onChange={(e) => {
                  const v = e.target.value;
                  setClearanceDialog((d) => ({
                    ...d,
                    status: v,
                    clearedAtDate: v === 'pending' ? '' : (d.clearedAtDate || new Date().toISOString().split('T')[0])
                  }));
                }}
              >
                <MenuItem value="pending">Pending (Unpresented / Uncleared)</MenuItem>
                <MenuItem value="cleared">Cleared (Reconciled in Bank)</MenuItem>
              </TextField>
            </Grid>
            {clearanceDialog.status === 'cleared' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="Clearing Date"
                  value={clearanceDialog.clearedAtDate}
                  onChange={(e) => setClearanceDialog((d) => ({ ...d, clearedAtDate: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                  helperText="Choose the date this transaction cleared in the bank statement."
                />
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeClearanceDialog} color="inherit">Cancel</Button>
          <Button variant="contained" onClick={saveClearance}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Dialog for Editing Reference / Cheque Number */}
      <Dialog open={refDlg.open} onClose={closeRefDlg} maxWidth="xs" fullWidth>
        <DialogTitle>Edit Reference / Cheque No.</DialogTitle>
        <DialogContent dividers>
          <TextField
            label="Cheque No. / Reference"
            size="small"
            fullWidth
            value={refDlg.reference}
            onChange={(e) => setRefDlg({ ...refDlg, reference: e.target.value })}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRefDlg} color="inherit" disabled={refDlg.loading}>Cancel</Button>
          <Button onClick={saveReference} variant="contained" disabled={refDlg.loading}>
            {refDlg.loading ? <CircularProgress size={24} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Attachments Dialog */}
      <Dialog open={attachDlg.open} onClose={closeAttachDlg} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6" fontWeight={700}>
              Voucher Attachments — {attachDlg.txn?.vrNo || ''}
            </Typography>
            <IconButton size="small" onClick={closeAttachDlg}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {attachError && <Alert severity="error" sx={{ mb: 2 }}>{attachError}</Alert>}
          {(attachDlg.txn?.attachments || []).length === 0 && (
            <Box textAlign="center" py={3} color="text.disabled">
              <AttachIcon sx={{ fontSize: 40, mb: 1, opacity: 0.4 }} />
              <Typography variant="body2">
                No attachments yet. Upload a voucher image, bank slip, or supporting document.
              </Typography>
            </Box>
          )}
          <List dense>
            {(attachDlg.txn?.attachments || []).map((a, i) => (
              <ListItem key={i} divider sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                <FileIcon fontSize="small" sx={{ mr: 1, color: 'primary.main' }} />
                <ListItemText
                  primary={<Typography variant="body2" fontWeight={600}>{a.originalName || a.filename}</Typography>}
                  secondary={a.uploadedAt ? new Date(a.uploadedAt).toLocaleDateString('en-PK') : ''}
                />
                <ListItemSecondaryAction>
                  <Tooltip title="Open / download">
                    <IconButton
                      size="small"
                      component="a"
                      href={`${baseUploadsUrl}/uploads/finance/${encodeURIComponent(a.filename)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={a.originalName}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" color="error" onClick={() => handleDeleteAttachment(a.filename)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
          <Button
            variant="outlined"
            startIcon={attachDlg.uploading ? <CircularProgress size={16} /> : <UploadIcon />}
            component="label"
            disabled={attachDlg.uploading}
          >
            Upload Document
            <input type="file" hidden onChange={handleFileUpload} accept=".pdf,.png,.jpg,.jpeg" />
          </Button>
          <Button variant="contained" onClick={closeAttachDlg}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDlg.open} onClose={() => !importDlg.uploading && setImportDlg({ ...importDlg, open: false })} maxWidth="sm" fullWidth>
        <DialogTitle>Import Data</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Upload an Excel file with historical journal entries for this company. The file must contain the following columns: <b>Date, Voucher No, Account Code, Account Title, Description, Debit, Credit</b>.
          </Typography>
          <Button
            variant="outlined"
            component="label"
            fullWidth
            sx={{ py: 3, borderStyle: 'dashed' }}
          >
            {importDlg.file ? importDlg.file.name : 'Select Excel File (.xlsx)'}
            <input 
              type="file" 
              hidden 
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setImportDlg(prev => ({ ...prev, file: e.target.files[0] }));
                }
              }} 
              accept=".xlsx,.xls" 
            />
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportDlg({ ...importDlg, open: false })} disabled={importDlg.uploading}>Cancel</Button>
          <Button variant="contained" onClick={handleImport} disabled={!importDlg.file || importDlg.uploading}>
            {importDlg.uploading ? <CircularProgress size={24} /> : 'Upload & Import'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
