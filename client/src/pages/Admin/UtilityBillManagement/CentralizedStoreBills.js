import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Alert,
  Skeleton,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  TextField,
  Stack,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab
} from '@mui/material';
import {
  Add as AddIcon,
  Visibility as ViewIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../../contexts/AuthContext';
import api from '../../../services/api';
import utilityBillService from '../../../services/utilityBillService';
import centralizedStoreService from '../../../services/centralizedStoreService';
import NarrationTableCell from '../../../components/common/NarrationTableCell';
import TablePaginationWrapper from '../../../components/TablePaginationWrapper';
import { usePagination } from '../../../hooks/usePagination';
import { getBillNarrationDisplay } from '../../../utils/documentNarrationDisplay';
import { getCurrentHolder } from '../../../utils/documentTracker';
import {
  canApproveUtilityBillRow,
  isUtilityBillDeptApproved
} from '../../../utils/departmentApprovalListActions';
import { isUtilityCategoryName } from '../../../utils/centralizedStoreBillKind';

/** Unique store categories represented on a bill's line items */
const getBillCategories = (bill) => {
  const byId = new Map();
  (bill.billLines || []).forEach((line) => {
    const cat = line.storeItem?.category;
    if (!cat) return;
    const id = String(cat._id || cat);
    const name = cat.name || 'Uncategorized';
    if (!byId.has(id)) byId.set(id, name);
  });
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
};

/** Company names on a bill (header site + line-level company/site) */
const getBillCompanies = (bill) => {
  const names = new Set();
  const header = String(bill?.site || '').trim();
  if (header) names.add(header);
  (bill.billLines || []).forEach((line) => {
    const site = String(line?.site || '').trim();
    if (site) names.add(site);
  });
  return [...names];
};

const CentralizedStoreBills = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isGeneral = location.pathname.startsWith('/general/centralized-store');
  const newBillPath = isGeneral ? '/general/centralized-store/bill/new' : '/admin/centralized-store/bill/new';
  const getBillViewPath = (billId) => isGeneral ? `/general/centralized-store/bills/${billId}` : `/admin/centralized-store/bills/${billId}`;
  const { user } = useAuth();
  const [bills, setBills] = useState([]);
  const [categories, setCategories] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState('');
  const [rejectDialog, setRejectDialog] = useState({ open: false, bill: null });
  const [rejectReason, setRejectReason] = useState('');
  /** 'bill' = regular store bills, 'utility' = utility-type store bills */
  const [billKindTab, setBillKindTab] = useState('bill');
  const [kindCounts, setKindCounts] = useState({ bill: 0, utility: 0 });
  /** Whole-period bill count and amount by YYYY-MM, across all pages */
  const [periodSummary, setPeriodSummary] = useState({});
  const latestFetchRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const {
    page,
    rowsPerPage,
    total: totalBills,
    setTotal: setTotalBills,
    setPage,
    handleChangePage,
    handleChangeRowsPerPage,
    getApiParams
  } = usePagination({
    defaultRowsPerPage: 25,
    resetDependencies: [billKindTab, searchTerm, filterCategoryId, filterCompany]
  });

  // Debounce search so typing doesn't fire a request every keystroke / race results
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await centralizedStoreService.getCatalog();
      setCategories(res.data?.categories || res.categories || []);
    } catch (err) {
      console.error('Failed to load store categories', err);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await api.get('/hr/companies', { params: { status: 'active' } });
      setCompanies(res.data?.data || []);
    } catch (err) {
      console.error('Failed to load companies', err);
      setCompanies([]);
    }
  }, []);

  const fetchBills = useCallback(async () => {
    const requestId = ++latestFetchRef.current;
    try {
      setLoading(true);
      setError(null);
      const params = {
        centralizedStoreOnly: true,
        billKind: billKindTab,
        ...getApiParams()
      };
      if (searchTerm) params.search = searchTerm;
      if (filterCategoryId) params.storeCategoryId = filterCategoryId;
      if (filterCompany) params.company = filterCompany;

      const response = await utilityBillService.getUtilityBills(params);
      if (requestId !== latestFetchRef.current) return;

      const total = response.pagination?.total || 0;
      const lastPage = Math.max(0, Math.ceil(total / rowsPerPage) - 1);
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setBills(response.data || []);
      setTotalBills(total);
      setKindCounts(response.kindCounts || { bill: 0, utility: 0 });
      setPeriodSummary(response.periodSummary || {});
    } catch (err) {
      if (requestId !== latestFetchRef.current) return;
      setError('Failed to fetch centralized store bills');
      console.error(err);
    } finally {
      if (requestId === latestFetchRef.current) {
        hasLoadedRef.current = true;
        setLoading(false);
      }
    }
  }, [billKindTab, searchTerm, filterCategoryId, filterCompany, page, rowsPerPage, getApiParams, setPage, setTotalBills]);

  useEffect(() => {
    loadCategories();
    loadCompanies();
  }, [loadCategories, loadCompanies]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR' }).format(amount || 0);

  const formatDate = (date) => (date ? new Date(date).toLocaleDateString('en-PK') : '—');

  const getWorkflowLabel = (bill) => {
    if (bill.auditStatus && bill.auditStatus !== 'Not Sent') return bill.auditStatus;
    return bill.approvalStatus || 'Draft';
  };

  const getWorkflowColor = (bill) => {
    const label = getWorkflowLabel(bill);
    if (label.includes('Paid (from Finance)')) return 'success';
    if (label.includes('Partially Paid (from Finance)')) return 'info';
    if (label.includes('Approved')) return 'success';
    if (label === 'Send to Audit' || label === 'Forwarded to Audit Director' || label === 'Submitted') return 'warning';
    if (label.includes('Rejected') || label === 'Returned from Audit') return 'error';
    return 'default';
  };

  const vendorName = (bill) =>
    bill.vendorId?.name || bill.provider || '—';

  const billPeriodKey = (bill) => {
    const raw = bill.billDate || bill.dueDate;
    const d = raw ? new Date(raw) : null;
    if (!d || Number.isNaN(d.getTime())) return '0000-00';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const formatPeriodLabel = (key) => {
    if (key === '0000-00') return 'Unknown period';
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-PK', { month: 'long', year: 'numeric' });
  };

  const categoryOptionsForTab = useMemo(() => {
    return (categories || []).filter((cat) => {
      const isUtil = isUtilityCategoryName(cat.name);
      return billKindTab === 'utility' ? isUtil : !isUtil;
    });
  }, [categories, billKindTab]);

  const billsByMonthYear = useMemo(() => {
    const map = new Map();
    (bills || []).forEach((bill) => {
      const key = billPeriodKey(bill);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(bill);
    });
    const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));
    return keys.map((key) => {
      const groupBills = map.get(key);
      const pageTotal = groupBills.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
      const summary = periodSummary[key];
      return {
        key,
        label: formatPeriodLabel(key),
        bills: groupBills,
        count: summary?.count ?? groupBills.length,
        total: summary?.total ?? pageTotal
      };
    });
  }, [bills, periodSummary]);

  const newBillPathForTab =
    `${newBillPath}?kind=${billKindTab === 'utility' ? 'utility' : 'bill'}`;

  const clearFilters = () => {
    setSearchInput('');
    setSearchTerm('');
    setFilterCategoryId('');
    setFilterCompany('');
  };

  const hasActiveFilters = Boolean(searchTerm || filterCategoryId || filterCompany);

  const handleApprove = async (bill) => {
    try {
      setActionLoadingId(bill._id);
      await utilityBillService.approveUtilityBill(bill._id);
      toast.success('Bill approved');
      await fetchBills();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Approve failed');
    } finally {
      setActionLoadingId('');
    }
  };

  const openRejectDialog = (bill) => {
    setRejectReason('');
    setRejectDialog({ open: true, bill });
  };

  const handleReject = async () => {
    const bill = rejectDialog.bill;
    if (!bill) return;
    if (!rejectReason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    try {
      setActionLoadingId(bill._id);
      await utilityBillService.rejectUtilityBill(bill._id, rejectReason.trim());
      toast.success('Bill rejected');
      setRejectDialog({ open: false, bill: null });
      setRejectReason('');
      await fetchBills();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reject failed');
    } finally {
      setActionLoadingId('');
    }
  };

  const cellEllipsisSx = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 0,
    px: { xs: 0.75, md: 1 }
  };

  const renderChipList = (items, getKey, getLabel, empty = '—') => {
    if (!items?.length) {
      return (
        <Typography variant="body2" color="text.secondary" noWrap>
          {empty}
        </Typography>
      );
    }
    const shown = items.slice(0, 1);
    const extra = items.length - shown.length;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: '100%' }}>
        {shown.map((item) => (
          <Chip
            key={getKey(item)}
            label={getLabel(item)}
            size="small"
            variant="outlined"
            sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
          />
        ))}
        {extra > 0 ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            +{extra}
          </Typography>
        ) : null}
      </Box>
    );
  };

  if (loading && !hasLoadedRef.current) {
    return (
      <Box sx={{ p: 3, width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
        <Skeleton variant="text" width="40%" height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={56} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={320} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, width: '100%', maxWidth: '100%', overflowX: 'hidden', boxSizing: 'border-box' }}>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3} flexWrap="wrap" gap={2}>
        <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
          <Typography variant="h4" component="h1" sx={{ wordBreak: 'break-word' }}>
            Centralized Store Bills
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Segregated into Bills and Utility Bills. Create one kind per bill — categories cannot be mixed.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Button
            variant="outlined"
            onClick={() => navigate(isGeneral ? '/general/centralized-store' : '/admin/centralized-store')}
          >
            Store Setup
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate(newBillPathForTab)}
          >
            {billKindTab === 'utility' ? 'Create Utility Bill' : 'Create Bill'}
          </Button>
        </Stack>
      </Box>

      <Tabs
        value={billKindTab}
        onChange={(_, v) => {
          setBillKindTab(v);
          setFilterCategoryId('');
        }}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          value="bill"
          label={`Bills (${kindCounts.bill})`}
        />
        <Tab
          value="utility"
          label={`Utility Bills (${kindCounts.utility})`}
        />
      </Tabs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Search bills"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                size="small"
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                }}
                placeholder="Bill ID, vendor, company, narration..."
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Company</InputLabel>
                <Select
                  value={filterCompany}
                  onChange={(e) => setFilterCompany(e.target.value)}
                  label="Company"
                >
                  <MenuItem value="">All companies</MenuItem>
                  {companies.map((c) => (
                    <MenuItem key={c._id || c.name} value={c.name}>
                      {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Category</InputLabel>
                <Select
                  value={filterCategoryId}
                  onChange={(e) => setFilterCategoryId(e.target.value)}
                  label="Category"
                >
                  <MenuItem value="">All categories</MenuItem>
                  {categoryOptionsForTab.map((cat) => (
                    <MenuItem key={cat._id} value={cat._id}>
                      {cat.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
                <Button variant="outlined" fullWidth onClick={clearFilters} disabled={!hasActiveFilters && !searchInput}>
                  Clear
                </Button>
                <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchBills} sx={{ flexShrink: 0 }}>
                  Refresh
                </Button>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.5 }}>
        {billKindTab === 'utility' ? 'Utility bills' : 'Bills'} by period
      </Typography>

      {loading && <LinearProgress sx={{ mb: 1 }} />}

      {billsByMonthYear.length === 0 ? (
        <Card>
          <CardContent>
            <Typography color="text.secondary" align="center" py={2}>
              {hasActiveFilters
                ? `No ${billKindTab === 'utility' ? 'utility bills' : 'bills'} found for these filters. Try clearing search/company/category.`
                : billKindTab === 'utility'
                  ? 'No utility bills yet. Use Create Utility Bill (Electricity, Gas, Water, Internet, Phone).'
                  : 'No bills yet. Use Create Bill for non-utility store purchases.'}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {billsByMonthYear.map(({ key, label, bills: periodBills, count, total }, idx) => (
            <Accordion
              key={`${billKindTab}-${page}-${rowsPerPage}-${key}`}
              defaultExpanded={idx === 0}
              disableGutters
              elevation={0}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                width: '100%',
                maxWidth: '100%',
                overflow: 'hidden',
                '&:before': { display: 'none' }
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'action.hover' : 'grey.50') }}>
                <Box display="flex" alignItems="center" justifyContent="space-between" width="100%" pr={1} flexWrap="wrap" gap={1}>
                  <Typography fontWeight={600}>{label}</Typography>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Chip
                      size="small"
                      label={periodBills.length < count
                        ? `${periodBills.length} of ${count} bills`
                        : `${count} bill${count === 1 ? '' : 's'}`}
                    />
                    <Chip size="small" color="primary" variant="outlined" label={`Total ${formatCurrency(total)}`} />
                  </Box>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0, px: 0, overflow: 'hidden' }}>
                <TableContainer
                  component={Paper}
                  variant="outlined"
                  sx={{ width: '100%', maxWidth: '100%', overflowX: 'hidden', border: 0, borderRadius: 0 }}
                >
                  <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ ...cellEllipsisSx, width: '8%' }}>Bill ID</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '7%' }}>Bill date</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '9%' }}>Initiator</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '9%' }}>Company</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '9%' }}>Category</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '9%' }}>Vendor</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '12%' }}>Narration</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '4%' }} align="center">Items</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '8%' }} align="right">Amount</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '8%' }}>Workflow</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '9%' }}>With</TableCell>
                        <TableCell sx={{ ...cellEllipsisSx, width: '7%' }}>Due</TableCell>
                        <TableCell sx={{ width: '7%', px: 0.5 }} align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {periodBills.map((bill) => {
                        const billCategories = getBillCategories(bill);
                        const billCompanies = getBillCompanies(bill);
                        const initiator = bill.createdBy
                          ? `${bill.createdBy.firstName || ''} ${bill.createdBy.lastName || ''}`.trim() || bill.createdBy.email || '—'
                          : '—';
                        const tracker = getCurrentHolder('UtilityBill', bill);
                        return (
                          <TableRow key={bill._id} hover>
                            <TableCell sx={cellEllipsisSx}>
                              <Tooltip title={bill.billId || ''}>
                                <Typography variant="body2" noWrap>{bill.billId}</Typography>
                              </Tooltip>
                            </TableCell>
                            <TableCell sx={cellEllipsisSx}>{formatDate(bill.billDate)}</TableCell>
                            <TableCell sx={cellEllipsisSx}>
                              <Tooltip title={initiator}>
                                <Typography variant="body2" noWrap>{initiator}</Typography>
                              </Tooltip>
                            </TableCell>
                            <TableCell sx={cellEllipsisSx}>
                              {renderChipList(billCompanies, (n) => n, (n) => n)}
                            </TableCell>
                            <TableCell sx={cellEllipsisSx}>
                              {renderChipList(billCategories, (c) => c.id, (c) => c.name)}
                            </TableCell>
                            <TableCell sx={cellEllipsisSx}>
                              <Tooltip title={vendorName(bill) || ''}>
                                <Typography variant="body2" noWrap>{vendorName(bill)}</Typography>
                              </Tooltip>
                            </TableCell>
                            <NarrationTableCell text={getBillNarrationDisplay(bill)} minWidth={0} maxWidth={140} />
                            <TableCell sx={cellEllipsisSx} align="center">{bill.billLines?.length || 0}</TableCell>
                            <TableCell sx={cellEllipsisSx} align="right">
                              <Typography variant="body2" noWrap>{formatCurrency(bill.amount)}</Typography>
                            </TableCell>
                            <TableCell sx={cellEllipsisSx}>
                              <Tooltip title={getWorkflowLabel(bill)}>
                                <Chip
                                  label={getWorkflowLabel(bill)}
                                  color={getWorkflowColor(bill)}
                                  size="small"
                                  variant="outlined"
                                  sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                                />
                              </Tooltip>
                            </TableCell>
                            <TableCell sx={cellEllipsisSx}>
                              <Tooltip title={tracker.holder || ''}>
                                <Chip
                                  label={tracker.holder}
                                  color={tracker.type === 'authority' || tracker.type === 'user' ? 'secondary' : tracker.type === 'department' ? 'info' : 'default'}
                                  variant="outlined"
                                  size="small"
                                  sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                                />
                              </Tooltip>
                            </TableCell>
                            <TableCell sx={cellEllipsisSx}>{formatDate(bill.dueDate)}</TableCell>
                            <TableCell align="right" sx={{ px: 0.5, whiteSpace: 'nowrap' }}>
                              <Stack direction="row" spacing={0.25} justifyContent="flex-end" alignItems="center">
                                {isUtilityBillDeptApproved(bill) && (
                                  <Tooltip title="Department approval completed (Manager / HOD / optional authorities)">
                                    <CheckCircleIcon fontSize="small" color="success" sx={{ mx: 0.5 }} />
                                  </Tooltip>
                                )}
                                {canApproveUtilityBillRow(bill, user) && (
                                  <>
                                    <Tooltip title="Approve">
                                      <span>
                                        <IconButton
                                          size="small"
                                          color="success"
                                          disabled={actionLoadingId === bill._id}
                                          onClick={() => handleApprove(bill)}
                                        >
                                          <CheckCircleIcon fontSize="small" />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                    <Tooltip title="Reject">
                                      <span>
                                        <IconButton
                                          size="small"
                                          color="error"
                                          disabled={actionLoadingId === bill._id}
                                          onClick={() => openRejectDialog(bill)}
                                        >
                                          <CancelIcon fontSize="small" />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                  </>
                                )}
                                <Tooltip title="View bill">
                                  <IconButton
                                    size="small"
                                    onClick={() => navigate(getBillViewPath(bill._id))}
                                  >
                                    <ViewIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          ))}
        </Stack>
      )}

      {totalBills > 0 && (
        <TablePaginationWrapper
          page={page}
          rowsPerPage={rowsPerPage}
          total={totalBills}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[10, 25, 50, 100]}
          labelRowsPerPage="Bills per page:"
        />
      )}

      <Dialog
        open={rejectDialog.open}
        onClose={() => !actionLoadingId && setRejectDialog({ open: false, bill: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject bill</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {rejectDialog.bill?.billId ? `Bill ${rejectDialog.bill.billId}` : 'Provide a reason for rejection.'}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Rejection reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialog({ open: false, bill: null })} disabled={Boolean(actionLoadingId)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={Boolean(actionLoadingId) || !rejectReason.trim()}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CentralizedStoreBills;
