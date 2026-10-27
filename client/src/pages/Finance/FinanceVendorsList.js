import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  Card,
  CardContent,
  Grid,
  TextField,
  Button,
  Avatar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Tooltip,
  Link
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Store as VendorIcon,
  Person as PersonIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Payments as PayIcon,
  Visibility as ViewIcon,
  CallMerge as ApplyIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isRouteAccessible } from '../../utils/permissions';
import AccountsPayable from './AccountsPayable';
import api from '../../services/api';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import VendorTrialBalancePanel from './VendorTrialBalancePanel';
import EmployeeTrialBalancePanel from './EmployeeTrialBalancePanel';

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The server decides (same rule as Vendor Bills): at Finance, and no payment already created for the balance
const isBillPayable = (b) => Boolean(b.canPay);

const STATUS_COLOR = {
  paid: 'success',
  partial: 'info',
  pending: 'warning',
  overdue: 'error',
  approved: 'info',
  draft: 'default',
  received: 'default',
  cancelled: 'default'
};

export default function FinanceVendorsList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Same RBAC check the router uses: paying needs Vendor Bills access, viewing needs the Payables pages
  const canAccess = (path) => Boolean(user) && isRouteAccessible(user.role, path, user.subRoles, user.roleRef, user.roles);
  const canPay = canAccess('/finance/accounts-payable');
  const canOpenDocPage = canAccess('/finance/payables-hub');
  // Bill payment window (the same one Vendor Bills uses), mounted hidden with its dialog on top
  const [payBillId, setPayBillId] = useState(null);
  const [listTab, setListTab] = useState(0);
  const [vendors, setVendors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [detail, setDetail] = useState(null);
  const [employeeDetail, setEmployeeDetail] = useState(null);
  const [detailTab, setDetailTab] = useState(0);
  const [employeeDetailTab, setEmployeeDetailTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [employeeDetailLoading, setEmployeeDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('Active');
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState('Active');

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 400);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadVendors = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = { limit: 500, page: 1 };
      if (searchDebounced) params.search = searchDebounced;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/finance/vendors', { params });
      setVendors(res.data?.data?.vendors || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, [searchDebounced, statusFilter]);

  const loadEmployees = useCallback(async () => {
    try {
      setEmployeesLoading(true);
      setError('');
      const params = { limit: 500, page: 1 };
      if (searchDebounced) params.search = searchDebounced;
      if (employeeStatusFilter) params.status = employeeStatusFilter;
      const res = await api.get('/finance/employees', { params });
      setEmployees(res.data?.data?.employees || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load employees');
    } finally {
      setEmployeesLoading(false);
    }
  }, [searchDebounced, employeeStatusFilter]);

  useEffect(() => {
    if (listTab === 0) loadVendors();
    else loadEmployees();
  }, [listTab, loadVendors, loadEmployees]);

  useFinanceCompanyReload(() => {
    setSelected(null);
    setSelectedEmployee(null);
    setDetail(null);
    setEmployeeDetail(null);
    if (listTab === 0) loadVendors();
    else loadEmployees();
  }, { skipInitial: true });

  const openVendor = async (vendor) => {
    setSelected(vendor);
    setDetail(null);
    setDetailTab(0);
    setDetailLoading(true);
    try {
      const res = await api.get(`/finance/vendors/${vendor._id}`, {
        headers: { 'Cache-Control': 'no-cache' },
        params: { _: Date.now() }
      });
      const data = res.data?.data || null;
      setDetail(data);
      // Prefer Journal Entries when party-tagged vouchers exist
      if ((data?.journalEntries || []).some((je) => je.partyTagged)) {
        setDetailTab(2);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load vendor finance details');
    } finally {
      setDetailLoading(false);
    }
  };

  // Reload the open vendor after a payment without changing the tab
  const reloadVendorDetail = useCallback(async () => {
    if (!selected?._id) return;
    try {
      const res = await api.get(`/finance/vendors/${selected._id}`, { headers: { 'Cache-Control': 'no-cache' }, params: { _: Date.now() } });
      setDetail(res.data?.data || null);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to reload vendor finance details');
    }
  }, [selected]);
  const closeBillPayment = useCallback(() => { setPayBillId(null); reloadVendorDetail(); }, [reloadVendorDetail]);
  const openBillPage = (billId) => navigate(`/finance/payables-hub/document/bill/${billId}`);
  // Oldest payable bill first: the payment window loads all of this vendor's open bills and unused advances
  const firstPayableBill = () => [...(detail?.bills || [])]
    .filter(isBillPayable)
    .sort((a, b) => new Date(a.dueDate || a.billDate || 0) - new Date(b.dueDate || b.billDate || 0))[0] || null;

  const openEmployee = async (employee) => {
    setSelectedEmployee(employee);
    setEmployeeDetail(null);
    setEmployeeDetailTab(0);
    setEmployeeDetailLoading(true);
    try {
      const res = await api.get(`/finance/employees/${employee._id}`, {
        headers: { 'Cache-Control': 'no-cache' },
        params: { _: Date.now() }
      });
      const data = res.data?.data || null;
      setEmployeeDetail(data);
      if ((data?.journalEntries || []).some((je) => je.partyTagged)) {
        setEmployeeDetailTab(1);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load employee finance details');
    } finally {
      setEmployeeDetailLoading(false);
    }
  };

  if (selectedEmployee) {
    const emp = employeeDetail?.employee || selectedEmployee;
    const summary = employeeDetail?.summary || selectedEmployee.finance || {};
    const displayName =
      emp.name || [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim() || emp.employeeId || '—';

    return (
      <Box sx={{ p: 3 }}>
        <Button
          startIcon={<BackIcon />}
          onClick={() => {
            setSelectedEmployee(null);
            setEmployeeDetail(null);
          }}
          sx={{ mb: 2 }}
        >
          Back to Employees
        </Button>

        <Stack direction="row" alignItems="center" gap={2} mb={2} flexWrap="wrap">
          <Avatar sx={{ bgcolor: 'secondary.main' }}>{displayName.charAt(0).toUpperCase()}</Avatar>
          <Box>
            <Typography variant="h5" fontWeight={700}>{displayName}</Typography>
            <Typography variant="body2" color="text.secondary">
              {emp.employeeId} · {emp.email || '—'} · {emp.phone || '—'}
            </Typography>
          </Box>
          <Chip
            label={emp.employmentStatus || '—'}
            color={emp.employmentStatus === 'Active' ? 'success' : 'default'}
            size="small"
          />
        </Stack>

        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

        {employeeDetailLoading ? (
          <CircularProgress />
        ) : (
          <>
            <Grid container spacing={2} mb={3}>
              {[
                { label: 'Total Advanced', value: summary.totalAdvanced, color: 'primary.main' },
                { label: 'Total Settled', value: summary.totalSettled, color: 'success.main' },
                { label: 'Outstanding Advance', value: summary.outstanding, color: 'error.main' },
                { label: 'Cash Approvals', value: summary.caCount, color: 'info.main', isCount: true }
              ].map((c) => (
                <Grid item xs={12} sm={6} md={3} key={c.label}>
                  <Card variant="outlined">
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                      <Typography variant="h6" fontWeight={700} color={c.color}>
                        {c.isCount ? c.value || 0 : `PKR ${fmt(c.value)}`}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            <Paper variant="outlined" sx={{ mb: 2, px: 2 }}>
              <Tabs value={employeeDetailTab} onChange={(_, v) => setEmployeeDetailTab(v)}>
                <Tab label={`Cash Approvals (${employeeDetail?.cashApprovals?.length || 0})`} />
                <Tab label={`Journal Entries (${employeeDetail?.journalEntries?.length || 0})`} />
                <Tab label="Trial Balance" />
                <Tab label="Profile" />
              </Tabs>
            </Paper>

            {employeeDetailTab === 0 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><b>CA #</b></TableCell>
                      <TableCell><b>Date</b></TableCell>
                      <TableCell><b>Purpose</b></TableCell>
                      <TableCell align="right"><b>Total</b></TableCell>
                      <TableCell align="right"><b>Advance</b></TableCell>
                      <TableCell align="right"><b>Spent</b></TableCell>
                      <TableCell><b>Status</b></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(employeeDetail?.cashApprovals || []).map((ca) => (
                      <TableRow key={ca._id} hover>
                        <TableCell>{ca.caNumber || '—'}</TableCell>
                        <TableCell>
                          {ca.approvalDate ? new Date(ca.approvalDate).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>{ca.purpose || '—'}</TableCell>
                        <TableCell align="right">{fmt(ca.totalAmount)}</TableCell>
                        <TableCell align="right">{fmt(ca.advanceAmount)}</TableCell>
                        <TableCell align="right">{fmt(ca.actualAmountSpent)}</TableCell>
                        <TableCell>
                          <Chip label={ca.status} size="small" color={STATUS_COLOR[ca.status] || 'default'} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {(employeeDetail?.cashApprovals || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No cash approvals linked to this employee yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {employeeDetailTab === 1 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><b>Entry #</b></TableCell>
                      <TableCell><b>Date</b></TableCell>
                      <TableCell><b>Description</b></TableCell>
                      <TableCell><b>Reference</b></TableCell>
                      <TableCell align="right"><b>Debits</b></TableCell>
                      <TableCell align="right"><b>Credits</b></TableCell>
                      <TableCell><b>Tag</b></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(employeeDetail?.journalEntries || []).map((je) => (
                      <TableRow key={je._id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{je.entryNumber || '—'}</TableCell>
                        <TableCell>{je.date ? new Date(je.date).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>{je.description || '—'}</TableCell>
                        <TableCell>{je.reference || '—'}</TableCell>
                        <TableCell align="right">{fmt(je.totalDebits)}</TableCell>
                        <TableCell align="right">{fmt(je.totalCredits)}</TableCell>
                        <TableCell>
                          {je.partyTagged ? <Chip label="Party" size="small" color="secondary" /> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(employeeDetail?.journalEntries || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No journal entries linked to this employee yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {employeeDetailTab === 2 && (
              <EmployeeTrialBalancePanel employeeId={emp._id} employeeName={displayName} />
            )}

            {employeeDetailTab === 3 && (
              <Card variant="outlined">
                <CardContent>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Department</Typography>
                      <Typography>{emp.departmentName || emp.placementDepartment?.name || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Advance GL account</Typography>
                      <Typography>
                        {emp.employeeAdvanceAccount?.accountNumber ||
                          emp.employeeAdvanceAccountNumber ||
                          '—'}
                        {emp.employeeAdvanceAccount?.name ? ` — ${emp.employeeAdvanceAccount.name}` : ''}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Email</Typography>
                      <Typography>{emp.email || '—'}</Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="caption" color="text.secondary">Phone</Typography>
                      <Typography>{emp.phone || '—'}</Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Box>
    );
  }

  if (selected) {
    const supplier = detail?.supplier || selected;
    const summary = detail?.summary || selected.finance || {};

    return (
      <Box sx={{ p: 3 }}>
        <Button startIcon={<BackIcon />} onClick={() => { setSelected(null); setDetail(null); }} sx={{ mb: 2 }}>
          Back to Vendors
        </Button>

        <Stack direction="row" alignItems="center" gap={2} mb={2} flexWrap="wrap">
          <Avatar sx={{ bgcolor: 'primary.main' }}>{(supplier.name || 'V').charAt(0).toUpperCase()}</Avatar>
          <Box>
            <Typography variant="h5" fontWeight={700}>{supplier.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {supplier.supplierId} · {supplier.contactPerson} · {supplier.phone}
            </Typography>
          </Box>
          <Chip label={supplier.status || 'Active'} color={supplier.status === 'Active' ? 'success' : 'default'} size="small" />
          {canPay && detail && (
            <Tooltip title={firstPayableBill() ? 'Opens the bill payment window with all of this vendor’s open bills — pay several and apply unused advances' : 'No approved bills with a balance to pay'}>
              <span style={{ marginLeft: 'auto' }}>
                <Button variant="contained" startIcon={<PayIcon />} disabled={!firstPayableBill()}
                  onClick={() => setPayBillId(String(firstPayableBill()._id))}>
                  Pay bills
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>

        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

        {payBillId && (
          <Box sx={{ display: 'none' }}>
            <AccountsPayable embedPayBillId={payBillId} onEmbedClose={closeBillPayment} />
          </Box>
        )}

        {detailLoading ? (
          <CircularProgress />
        ) : (
          <>
            <Grid container spacing={2} mb={3}>
              {[
                { label: 'Total Billed', value: summary.totalBilled, color: 'primary.main' },
                { label: 'Total Paid', value: summary.totalPaid, color: 'success.main' },
                { label: 'Outstanding', value: summary.outstanding, color: 'error.main' },
                { label: 'Advance Balance', value: summary.advanceBalance, color: 'info.main' }
              ].map((c) => (
                <Grid item xs={12} sm={6} md={3} key={c.label}>
                  <Card variant="outlined">
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                      <Typography variant="h6" fontWeight={700} color={c.color}>PKR {fmt(c.value)}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            <Paper variant="outlined" sx={{ mb: 2, px: 2 }}>
              <Tabs value={detailTab} onChange={(_, v) => setDetailTab(v)}>
                <Tab label={`AP Bills (${detail?.bills?.length || 0})`} />
                <Tab label={`Vendor Advances (${detail?.advances?.length || 0})`} />
                <Tab label={`Journal Entries (${detail?.journalEntries?.length || 0})`} />
                <Tab label="Trial Balance" />
                <Tab label="Profile" />
              </Tabs>
            </Paper>

            {detailTab === 0 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><b>Bill #</b></TableCell>
                      <TableCell><b>Bill date</b></TableCell>
                      <TableCell><b>Due date</b></TableCell>
                      <TableCell align="right"><b>Total</b></TableCell>
                      <TableCell align="right"><b>Paid</b></TableCell>
                      <TableCell align="right"><b>Balance</b></TableCell>
                      <TableCell><b>Status</b></TableCell>
                      <TableCell align="right"><b>Actions</b></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail?.bills || []).map((b) => (
                      <TableRow key={b._id} hover>
                        <TableCell>
                          {canOpenDocPage ? (
                            <Link component="button" type="button" underline="hover" fontWeight={600} onClick={() => openBillPage(b._id)}>
                              {b.billNumber || '—'}
                            </Link>
                          ) : (b.billNumber || '—')}
                        </TableCell>
                        <TableCell>{b.billDate ? new Date(b.billDate).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>{b.dueDate ? new Date(b.dueDate).toLocaleDateString() : '—'}</TableCell>
                        <TableCell align="right">{fmt(b.totalAmount)}</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>{fmt(b.amountPaid)}</TableCell>
                        <TableCell align="right" sx={{ color: 'error.main' }}>{fmt(b.balanceDue)}</TableCell>
                        <TableCell>
                          <Chip label={b.status} size="small" color={STATUS_COLOR[b.status] || 'default'} />
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {canOpenDocPage && (
                            <Tooltip title="View bill — details, payments and accounting entry">
                              <Button size="small" startIcon={<ViewIcon fontSize="small" />} onClick={() => openBillPage(b._id)}>View</Button>
                            </Tooltip>
                          )}
                          {canPay && isBillPayable(b) && (
                            <Button size="small" variant="contained" startIcon={<PayIcon fontSize="small" />} sx={{ ml: 1 }}
                              onClick={() => setPayBillId(String(b._id))}>
                              Pay
                            </Button>
                          )}
                          {canPay && !isBillPayable(b) && b.payBlockedReason && b.payBlockedReason !== 'Fully paid' && (
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                              {b.payBlockedReason}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(detail?.bills || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No accounts payable bills for this vendor yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {detailTab === 1 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><b>Date</b></TableCell>
                      <TableCell><b>Reference</b></TableCell>
                      <TableCell align="right"><b>Amount</b></TableCell>
                      <TableCell align="right"><b>Applied</b></TableCell>
                      <TableCell align="right"><b>Balance</b></TableCell>
                      <TableCell><b>Status</b></TableCell>
                      <TableCell align="right"><b>Actions</b></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail?.advances || []).map((a) => (
                      <TableRow key={a._id} hover>
                        <TableCell>{a.paymentDate ? new Date(a.paymentDate).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>{a.reference || '—'}</TableCell>
                        <TableCell align="right">{fmt(a.amount)}</TableCell>
                        <TableCell align="right">{fmt(a.appliedAmount)}</TableCell>
                        <TableCell align="right">{fmt(a.balance)}</TableCell>
                        <TableCell><Chip label={a.status || '—'} size="small" /></TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {canOpenDocPage && a.journalEntryId && (
                            <Tooltip title="View the advance payment — voucher, bank and accounting entry">
                              <Button size="small" startIcon={<ViewIcon fontSize="small" />}
                                onClick={() => navigate(`/finance/payables-hub/payment/${a.journalEntryId}`)}>
                                View
                              </Button>
                            </Tooltip>
                          )}
                          {canPay && Number(a.balance) > 0.01 && a.voucherWorkflowStatus !== 'pending_authority' && a.voucherWorkflowStatus !== 'rejected' && (
                            <Tooltip title={firstPayableBill()
                              ? 'Opens the bill payment window for this vendor — enter the amount to adjust from unused advances against each bill'
                              : 'No approved bill with a balance to adjust this advance against'}>
                              <span>
                                <Button size="small" variant="outlined" startIcon={<ApplyIcon fontSize="small" />} sx={{ ml: 1 }}
                                  disabled={!firstPayableBill()}
                                  onClick={() => setPayBillId(String(firstPayableBill()._id))}>
                                  Adjust against bill
                                </Button>
                              </span>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(detail?.advances || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No vendor advances recorded.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {detailTab === 2 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell><b>Entry #</b></TableCell>
                      <TableCell><b>Date</b></TableCell>
                      <TableCell><b>Description</b></TableCell>
                      <TableCell><b>Reference</b></TableCell>
                      <TableCell align="right"><b>Debits</b></TableCell>
                      <TableCell align="right"><b>Credits</b></TableCell>
                      <TableCell><b>Tag</b></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail?.journalEntries || []).map((je) => (
                      <TableRow key={je._id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{je.entryNumber || '—'}</TableCell>
                        <TableCell>{je.date ? new Date(je.date).toLocaleDateString() : '—'}</TableCell>
                        <TableCell>{je.description || '—'}</TableCell>
                        <TableCell>{je.reference || '—'}</TableCell>
                        <TableCell align="right">{fmt(je.totalDebits)}</TableCell>
                        <TableCell align="right">{fmt(je.totalCredits)}</TableCell>
                        <TableCell>
                          {je.partyTagged ? <Chip label="Party" size="small" color="secondary" /> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(detail?.journalEntries || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          No journal entries linked to this vendor yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {detailTab === 3 && (
              <VendorTrialBalancePanel
                supplierId={supplier._id}
                supplierName={supplier.name}
              />
            )}

            {detailTab === 4 && (
              <Card variant="outlined">
                <CardContent>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}><Typography variant="caption" color="text.secondary">Email</Typography><Typography>{supplier.email || '—'}</Typography></Grid>
                    <Grid item xs={12} md={6}><Typography variant="caption" color="text.secondary">Payment terms</Typography><Typography>{supplier.paymentTerms || '—'}</Typography></Grid>
                    <Grid item xs={12}><Typography variant="caption" color="text.secondary">Address</Typography><Typography>{supplier.address || '—'}</Typography></Grid>
                    <Grid item xs={12} md={6}><Typography variant="caption" color="text.secondary">Category</Typography><Typography>{supplier.vendorCategory || '—'}</Typography></Grid>
                    <Grid item xs={12} md={6}><Typography variant="caption" color="text.secondary">NTN / CNIC</Typography><Typography>{supplier.ntnCnic || '—'}</Typography></Grid>
                  </Grid>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Box>
    );
  }

  const refreshList = () => {
    if (listTab === 0) loadVendors();
    else loadEmployees();
  };

  return (
    <Box sx={{ p: 3 }}>
      <FinanceCompanyPageHeader title="Vendors & Employees" icon={VendorIcon}>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshList} size="small">
          Refresh
        </Button>
      </FinanceCompanyPageHeader>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: -2 }}>
        {listTab === 0
          ? 'View vendor master data and finance summary (bills, payments, outstanding balance).'
          : 'View employees with cash advance activity and linked GL accounts (1120).'}
      </Typography>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={listTab} onChange={(_, v) => setListTab(v)}>
          <Tab icon={<VendorIcon fontSize="small" />} iconPosition="start" label="Vendors" />
          <Tab icon={<PersonIcon fontSize="small" />} iconPosition="start" label="Employees" />
        </Tabs>
      </Paper>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField
              size="small"
              label={listTab === 0 ? 'Search vendors' : 'Search employees'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 240, flex: 1 }}
              InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Status</InputLabel>
              {listTab === 0 ? (
                <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="Active">Active</MenuItem>
                  <MenuItem value="Inactive">Inactive</MenuItem>
                </Select>
              ) : (
                <Select
                  value={employeeStatusFilter}
                  label="Status"
                  onChange={(e) => setEmployeeStatusFilter(e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="Active">Active</MenuItem>
                  <MenuItem value="Inactive">Inactive</MenuItem>
                  <MenuItem value="Terminated">Terminated</MenuItem>
                  <MenuItem value="Resigned">Resigned</MenuItem>
                  <MenuItem value="Draft">Draft</MenuItem>
                </Select>
              )}
            </FormControl>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshList}>
              Refresh
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {listTab === 0 && (
        loading ? (
          <CircularProgress />
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><b>Vendor ID</b></TableCell>
                  <TableCell><b>Name</b></TableCell>
                  <TableCell><b>Contact</b></TableCell>
                  <TableCell align="right"><b>Total Billed</b></TableCell>
                  <TableCell align="right"><b>Total Paid</b></TableCell>
                  <TableCell align="right"><b>Outstanding</b></TableCell>
                  <TableCell align="center"><b>Bills</b></TableCell>
                  <TableCell><b>Status</b></TableCell>
                  <TableCell align="center"><b>Action</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vendors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No vendors found.
                    </TableCell>
                  </TableRow>
                )}
                {vendors.map((v) => (
                  <TableRow key={v._id} hover>
                    <TableCell>{v.supplierId}</TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" gap={1}>
                        <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>{(v.name || 'V').charAt(0)}</Avatar>
                        {v.name}
                      </Stack>
                    </TableCell>
                    <TableCell>{v.contactPerson || '—'}</TableCell>
                    <TableCell align="right">PKR {fmt(v.finance?.totalBilled)}</TableCell>
                    <TableCell align="right" sx={{ color: 'success.main' }}>PKR {fmt(v.finance?.totalPaid)}</TableCell>
                    <TableCell align="right" sx={{ color: (v.finance?.outstanding || 0) > 0 ? 'error.main' : 'text.primary' }}>
                      PKR {fmt(v.finance?.outstanding)}
                    </TableCell>
                    <TableCell align="center">{v.finance?.billCount || 0}</TableCell>
                    <TableCell>
                      <Chip label={v.status} size="small" color={v.status === 'Active' ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell align="center">
                      <Button size="small" variant="outlined" onClick={() => openVendor(v)}>
                        View finance
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {listTab === 1 && (
        employeesLoading ? (
          <CircularProgress />
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><b>Employee ID</b></TableCell>
                  <TableCell><b>Name</b></TableCell>
                  <TableCell><b>Department</b></TableCell>
                  <TableCell><b>GL Account</b></TableCell>
                  <TableCell align="right"><b>Total Advanced</b></TableCell>
                  <TableCell align="right"><b>Total Settled</b></TableCell>
                  <TableCell align="right"><b>Outstanding</b></TableCell>
                  <TableCell align="center"><b>CAs</b></TableCell>
                  <TableCell><b>Status</b></TableCell>
                  <TableCell align="center"><b>Action</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No employees found.
                    </TableCell>
                  </TableRow>
                )}
                {employees.map((e) => {
                  const name =
                    e.name || [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.employeeId;
                  return (
                    <TableRow key={e._id} hover>
                      <TableCell>{e.employeeId || '—'}</TableCell>
                      <TableCell>
                        <Stack direction="row" alignItems="center" gap={1}>
                          <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: 'secondary.main' }}>
                            {(name || 'E').charAt(0).toUpperCase()}
                          </Avatar>
                          {name}
                        </Stack>
                      </TableCell>
                      <TableCell>{e.departmentName || '—'}</TableCell>
                      <TableCell>
                        {e.employeeAdvanceAccount?.accountNumber || e.employeeAdvanceAccountNumber || '—'}
                      </TableCell>
                      <TableCell align="right">PKR {fmt(e.finance?.totalAdvanced)}</TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>
                        PKR {fmt(e.finance?.totalSettled)}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: (e.finance?.outstanding || 0) > 0 ? 'error.main' : 'text.primary' }}
                      >
                        PKR {fmt(e.finance?.outstanding)}
                      </TableCell>
                      <TableCell align="center">{e.finance?.caCount || 0}</TableCell>
                      <TableCell>
                        <Chip
                          label={e.employmentStatus || '—'}
                          size="small"
                          color={e.employmentStatus === 'Active' ? 'success' : 'default'}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Button size="small" variant="outlined" onClick={() => openEmployee(e)}>
                          View finance
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}
    </Box>
  );
}
