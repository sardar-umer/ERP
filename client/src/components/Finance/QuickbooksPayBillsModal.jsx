import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Grid, TextField, FormControl, InputLabel, Select, MenuItem,
  Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Checkbox, Chip, Alert, Box, Stack,
  CircularProgress, Tooltip, Divider, InputAdornment, IconButton
} from '@mui/material';
import {
  Payment as PaymentIcon,
  AccountBalance as BankIcon,
  AttachMoney as MoneyIcon,
  Receipt as ReceiptIcon,
  CheckCircle as CheckCircleIcon,
  ClearAll as ClearIcon,
  SelectAll as SelectAllIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import api from '../../services/api';
import WhtField, { computeWht, whtPayload } from './WhtField';
import FinanceApprovalAuthorityPicker from './FinanceApprovalAuthorityPicker';
import {
  fetchFinanceAuthorityCandidates,
  buildFinanceApprovalAuthoritiesPayload,
  validateFinanceAuthoritySelection
} from '../../services/financeApprovalAuthorityService';
import {
  fetchPayFromAccounts,
  fetchRelatedPartyPayFromAccounts,
  formatPayFromAccountLabel,
  isIntercompanyPayingMode
} from '../../utils/payFromAccounts';

import { useFinanceCompany } from '../../context/FinanceCompanyContext';

const formatPKR = (amount) => {
  const n = Number(amount) || 0;
  return `PKR ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;

export default function QuickbooksPayBillsModal({
  open,
  onClose,
  onSuccess,
  selectedCompanyId = null,
  preselectedVendorId = null,
  preselectedVendorName = '',
  preselectedBillId = null
}) {
  const { companies } = useFinanceCompany();
  const [vendors, setVendors] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState(preselectedVendorId || '');
  const [selectedVendorName, setSelectedVendorName] = useState(preselectedVendorName || '');
  const [payingCompanyId, setPayingCompanyId] = useState(selectedCompanyId || '');

  useEffect(() => {
    if (open) {
      setSelectedVendorId(preselectedVendorId || '');
      setSelectedVendorName(preselectedVendorName || '');
      setPayingCompanyId(selectedCompanyId || '');
    }
  }, [open, preselectedVendorId, preselectedVendorName, selectedCompanyId]);
  
  const [openBills, setOpenBills] = useState([]);
  const [loadingBills, setLoadingBills] = useState(false);
  
  const [vendorAdvances, setVendorAdvances] = useState([]);
  const [loadingAdvances, setLoadingAdvances] = useState(false);
  
  const [bankAccounts, setBankAccounts] = useState([]);
  const [relatedPartyAccounts, setRelatedPartyAccounts] = useState([]);
  const [financeAuthorityCandidates, setFinanceAuthorityCandidates] = useState([]);
  
  const [finAuth, setFinAuth] = useState({
    accountsManagerUser: null,
    financeControllerUser: null
  });

  const [paymentForm, setPaymentForm] = useState({
    paymentDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'bank_transfer',
    bankAccountId: '',
    relatedPartyAccountId: '',
    reference: '',
    narration: '',
    whtRate: 0,
    whtAmount: '',
    whtBy: 'rate'
  });

  const [processing, setProcessing] = useState(false);

  // Load Vendors (combines procurement vendors and active AP vendors)
  useEffect(() => {
    if (!open) return;
    Promise.allSettled([
      api.get('/procurement/vendors', { params: { limit: 1000 } }),
      api.get('/finance/accounts-payable', { params: { limit: 1000 } })
    ]).then(([procRes, apRes]) => {
      const vMap = new Map();
      if (procRes.status === 'fulfilled' && procRes.value.data?.data?.vendors) {
        procRes.value.data.data.vendors.forEach((v) => {
          vMap.set(String(v._id), {
            vendorId: String(v._id),
            vendorName: v.name,
            email: v.email || '',
            phone: v.phone || ''
          });
        });
      }
      if (apRes.status === 'fulfilled' && apRes.value.data?.data?.bills) {
        apRes.value.data.data.bills.forEach((b) => {
          const vId = String(b.vendor?.vendorId || b.vendor?._id || '');
          const vName = b.vendor?.name || b.vendorName || '';
          if (vName) {
            const key = vId || vName;
            if (!vMap.has(key)) {
              vMap.set(key, {
                vendorId: key,
                vendorName: vName,
                email: b.vendor?.email || '',
                phone: ''
              });
            }
          }
        });
      }
      setVendors(Array.from(vMap.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName)));
    });
  }, [open]);

  // Pay From = paying company banks; Related Party = original bill company (IC only)
  useEffect(() => {
    if (!open) return;
    const billCompanyId = selectedCompanyId;
    const payingComp = payingCompanyId || selectedCompanyId;
    if (!payingComp) return;

    const icMode = isIntercompanyPayingMode(payingCompanyId, billCompanyId);

    fetchPayFromAccounts(api, { companyId: payingComp })
      .then((accs) => {
        setBankAccounts(accs);
        setPaymentForm((f) => {
          const stillValid = f.bankAccountId
            && accs.some((a) => String((a.account || a)._id) === String(f.bankAccountId));
          return { ...f, bankAccountId: stillValid ? f.bankAccountId : '' };
        });
      })
      .catch(() => setBankAccounts([]));

    if (icMode && billCompanyId) {
      fetchRelatedPartyPayFromAccounts(api, { companyId: billCompanyId })
        .then((accs) => {
          setRelatedPartyAccounts(accs);
          setPaymentForm((f) => {
            const stillValid = f.relatedPartyAccountId
              && accs.some((a) => String((a.account || a)._id) === String(f.relatedPartyAccountId));
            return { ...f, relatedPartyAccountId: stillValid ? f.relatedPartyAccountId : '' };
          });
        })
        .catch(() => setRelatedPartyAccounts([]));
    } else {
      setRelatedPartyAccounts([]);
      setPaymentForm((f) => (
        f.relatedPartyAccountId ? { ...f, relatedPartyAccountId: '' } : f
      ));
    }
  }, [open, payingCompanyId, selectedCompanyId]);

  // Load Finance Authorities
  useEffect(() => {
    if (!open) return;
    fetchFinanceAuthorityCandidates()
      .then(setFinanceAuthorityCandidates)
      .catch(() => setFinanceAuthorityCandidates([]));
  }, [open]);

  // Load Bills and Advances when Vendor changes
  const loadVendorData = useCallback(async (vendorId, vendorName) => {
    if (!vendorId && !vendorName) {
      setOpenBills([]);
      setVendorAdvances([]);
      return;
    }
    try {
      setLoadingBills(true);
      setLoadingAdvances(true);

      const cleanVendorName = String(vendorName || '').trim();
      const [billsRes, advancesRes] = await Promise.allSettled([
        api.get('/finance/accounts-payable', {
          params: { limit: 1000, search: cleanVendorName || '' }
        }),
        api.get('/finance/accounts-payable/vendor-advance-balance', {
          params: { vendorId: vendorId || undefined, vendorName: cleanVendorName || undefined }
        })
      ]);

      if (billsRes.status === 'fulfilled' && billsRes.value.data?.success) {
        const rawBills = billsRes.value.data.data.bills || [];
        const normName = cleanVendorName.toLowerCase();
        let filtered = rawBills.filter((b) => {
          if (b.status === 'cancelled') return false;
          const matchId = vendorId && String(b.vendor?.vendorId || b.vendor?._id || '') === String(vendorId);
          const bName = String(b.vendor?.name || b.vendorName || '').toLowerCase().trim();
          const matchName = normName && bName.includes(normName);
          return matchId || matchName;
        });

        // Ensure preselected bill is included if passed
        if (preselectedBillId && !filtered.some((b) => String(b._id) === String(preselectedBillId))) {
          try {
            const singleRes = await api.get(`/finance/accounts-payable/${preselectedBillId}`);
            if (singleRes.data?.success && singleRes.data?.data) {
              filtered = [singleRes.data.data, ...filtered];
            }
          } catch {
            // keep filtered
          }
        }

        const rows = filtered.map((b) => {
          const total = Number(b.totalAmount || 0);
          const paid = Number(b.paidAmount ?? b.amountPaid ?? 0);
          const advance = Number(b.advanceApplied || 0);
          const pending = Number(b.paymentPending || 0) + Number(b.advancePending || 0);
          const openBal = Math.max(0, round2(total - paid - advance - pending));
          const isTargetBill = preselectedBillId && String(b._id) === String(preselectedBillId);

          return {
            billId: String(b._id),
            billNumber: b.billNumber,
            billDate: b.billDate,
            dueDate: b.dueDate,
            totalAmount: total,
            amountPaid: paid,
            advanceApplied: advance,
            openBalance: openBal,
            selected: isTargetBill ? true : false,
            payAmount: isTargetBill ? openBal : 0
          };
        }).filter((r) => r.openBalance > 0);

        setOpenBills(rows);
      } else {
        setOpenBills([]);
      }

      if (advancesRes.status === 'fulfilled' && advancesRes.value.data?.success) {
        setVendorAdvances(advancesRes.value.data.data.advances || []);
      } else {
        setVendorAdvances([]);
      }
    } catch (err) {
      console.error('Error loading vendor bills and advances:', err);
      toast.error('Failed to load vendor data');
    } finally {
      setLoadingBills(false);
      setLoadingAdvances(false);
    }
  }, [preselectedBillId]);

  useEffect(() => {
    if (open && (selectedVendorId || selectedVendorName)) {
      loadVendorData(selectedVendorId, selectedVendorName);
    }
  }, [open, selectedVendorId, selectedVendorName, loadVendorData]);

  // Handle Vendor Selection Change
  const handleVendorChange = (e) => {
    const vId = e.target.value;
    setSelectedVendorId(vId);
    const v = vendors.find((x) => x.vendorId === vId);
    const vName = v?.vendorName || '';
    setSelectedVendorName(vName);
    if (vId || vName) {
      loadVendorData(vId, vName);
    }
  };

  // Toggle Single Bill Selection
  const handleToggleBill = (index) => {
    setOpenBills((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      row.selected = !row.selected;
      row.payAmount = row.selected ? row.openBalance : 0;
      next[index] = row;
      return next;
    });
  };

  // Change specific Pay Amount
  const handlePayAmountChange = (index, value) => {
    const num = Math.max(0, Math.min(Number(value) || 0, openBills[index].openBalance));
    setOpenBills((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        payAmount: round2(num),
        selected: num > 0
      };
      return next;
    });
  };

  // Select All Bills
  const handleSelectAll = () => {
    setOpenBills((prev) =>
      prev.map((r) => ({
        ...r,
        selected: true,
        payAmount: r.openBalance
      }))
    );
  };

  // Clear All
  const handleClearAll = () => {
    setOpenBills((prev) =>
      prev.map((r) => ({
        ...r,
        selected: false,
        payAmount: 0
      }))
    );
  };

  // Calculations
  const totalOpenBalance = useMemo(() => {
    return round2(openBills.reduce((s, r) => s + (Number(r.openBalance) || 0), 0));
  }, [openBills]);

  const totalOpenAdvances = useMemo(() => {
    return round2(vendorAdvances.reduce((s, r) => s + (Number(r.open) || 0), 0));
  }, [vendorAdvances]);

  const selectedBills = useMemo(() => {
    return openBills.filter((r) => r.selected && Number(r.payAmount) > 0);
  }, [openBills]);

  const totalSelectedPayAmount = useMemo(() => {
    return round2(selectedBills.reduce((s, r) => s + (Number(r.payAmount) || 0), 0));
  }, [selectedBills]);

  const wht = computeWht(totalSelectedPayAmount, paymentForm);
  const whtAmount = wht.invalid ? 0 : wht.amount;

  const netDisbursementAmount = useMemo(() => {
    return round2(Math.max(0, totalSelectedPayAmount - whtAmount));
  }, [totalSelectedPayAmount, whtAmount]);

  const isIcPayingMode = isIntercompanyPayingMode(payingCompanyId, selectedCompanyId);

  // Submit Multi-Bill Payment
  const handlePostPayments = async () => {
    if (selectedBills.length === 0) {
      toast.error('Please select at least one bill to pay');
      return;
    }

    if (totalSelectedPayAmount <= 0) {
      toast.error('Total payment amount must be greater than zero');
      return;
    }
    if (wht.invalid) {
      toast.error('WHT must be less than the payment amount');
      return;
    }

    if (isIcPayingMode && !paymentForm.bankAccountId) {
      toast.error('Select Pay From Account (bank/cash on the Paying company).');
      return;
    }
    if (isIcPayingMode && !paymentForm.relatedPartyAccountId) {
      toast.error('Select Related Party Account on the original (bill) company.');
      return;
    }

    const finAuthErr = validateFinanceAuthoritySelection(finAuth);
    if (finAuthErr) {
      toast.error(finAuthErr);
      return;
    }

    const financeApprovalAuthorities = buildFinanceApprovalAuthoritiesPayload(finAuth);

    try {
      setProcessing(true);
      const batchId = `PAY-BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

      const billsPayload = selectedBills.map(b => ({
        billId: b.billId,
        amount: b.payAmount
      }));

      await api.post(`/finance/accounts-payable/batch-payment`, {
        bills: billsPayload,
        paymentMethod: paymentForm.paymentMethod,
        reference: paymentForm.reference || '',
        narration: paymentForm.narration,
        paymentDate: paymentForm.paymentDate,
        // A typed WHT amount is posted exactly as entered; otherwise the rate is sent
        ...whtPayload(paymentForm),
        bankAccountId: paymentForm.bankAccountId || null,
        relatedPartyAccountId: paymentForm.relatedPartyAccountId || null,
        payingCompanyId: payingCompanyId || selectedCompanyId || null,
        financeApprovalAuthorities,
        batchId
      });

      toast.success(`✓ Successfully posted consolidated batch payment for ${selectedBills.length} bill(s)! Total: ${formatPKR(totalSelectedPayAmount)}`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error('Error posting batch payment:', err);
      toast.error(err.response?.data?.message || 'Failed to post bill payments');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.dark', color: 'white', py: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box display="flex" alignItems="center" gap={1.5}>
            <PaymentIcon fontSize="medium" />
            <Typography variant="h6" fontWeight={700}>
              Pay Bills — Multi-Bill Settlement
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 2.5 }}>
        {/* Top Controls: Vendor Selection & Balance Highlights */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={5}>
            <FormControl fullWidth size="small">
              <InputLabel>Select Payee / Vendor *</InputLabel>
              <Select
                value={selectedVendorId}
                label="Select Payee / Vendor *"
                onChange={handleVendorChange}
              >
                <MenuItem value=""><em>-- Choose a Vendor --</em></MenuItem>
                {vendors.map((v) => (
                  <MenuItem key={v.vendorId} value={v.vendorId}>
                    {v.vendorName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={7}>
            <Stack direction="row" spacing={2} justifyContent="flex-end">
              <Paper variant="outlined" sx={{ p: 1.2, px: 2, bgcolor: 'grey.50', minWidth: 160 }}>
                <Typography variant="caption" color="text.secondary">Total Open Balance</Typography>
                <Typography variant="subtitle1" fontWeight={700} color="error.main">
                  {formatPKR(totalOpenBalance)}
                </Typography>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.2, px: 2, bgcolor: totalOpenAdvances > 0 ? 'success.50' : 'grey.50', minWidth: 160 }}>
                <Typography variant="caption" color="text.secondary">Unapplied Advances / Credits</Typography>
                <Typography variant="subtitle1" fontWeight={700} color={totalOpenAdvances > 0 ? 'success.dark' : 'text.secondary'}>
                  {formatPKR(totalOpenAdvances)}
                </Typography>
              </Paper>
            </Stack>
          </Grid>
        </Grid>

        {/* Available Vendor Advances alert/details */}
        {totalOpenAdvances > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This vendor has <strong>{vendorAdvances.length} unapplied advance(s)</strong> totaling <strong>{formatPKR(totalOpenAdvances)}</strong>.
            You can record a direct settlement or deduct from cash approval in Accounts Payable.
          </Alert>
        )}

        {/* Bills Selection Table */}
        <Paper variant="outlined" sx={{ mb: 2.5 }}>
          <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: 'grey.100' }}>
            <Typography variant="subtitle2" fontWeight={700}>
              Open Bills for {selectedVendorName || 'Selected Vendor'} ({openBills.length})
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<SelectAllIcon />} onClick={handleSelectAll} disabled={!openBills.length}>
                Select All
              </Button>
              <Button size="small" variant="outlined" color="inherit" startIcon={<ClearIcon />} onClick={handleClearAll} disabled={!openBills.length}>
                Clear
              </Button>
            </Stack>
          </Box>

          <TableContainer sx={{ maxHeight: 300 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      indeterminate={selectedBills.length > 0 && selectedBills.length < openBills.length}
                      checked={openBills.length > 0 && selectedBills.length === openBills.length}
                      onChange={(e) => e.target.checked ? handleSelectAll() : handleClearAll()}
                      disabled={!openBills.length}
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Bill #</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Bill Date</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Due Date</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Total Amount</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Open Balance</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, width: 170 }}>Amount to Pay (PKR)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loadingBills ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                      <CircularProgress size={24} />
                    </TableCell>
                  </TableRow>
                ) : openBills.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      {selectedVendorId ? 'No open bills found for this vendor.' : 'Please select a vendor above to view open bills.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  openBills.map((row, index) => (
                    <TableRow key={row.billId} hover selected={row.selected}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={row.selected}
                          onChange={() => handleToggleBill(index)}
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{row.billNumber}</TableCell>
                      <TableCell>{formatDate(row.billDate)}</TableCell>
                      <TableCell>{formatDate(row.dueDate)}</TableCell>
                      <TableCell align="right">{formatPKR(row.totalAmount)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: 'error.main' }}>
                        {formatPKR(row.openBalance)}
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          type="number"
                          value={row.payAmount || ''}
                          inputProps={{ min: 0, max: row.openBalance, step: 0.01 }}
                          onChange={(e) => handlePayAmountChange(index, e.target.value)}
                          placeholder="0.00"
                          sx={{ width: 150 }}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        {/* Payment & Bank Configuration */}
        <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
            Payment & Bank Details
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth size="small" type="date" label="Payment Date"
                value={paymentForm.paymentDate}
                onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Paying Company</InputLabel>
                <Select
                  value={payingCompanyId || selectedCompanyId || ''}
                  label="Paying Company"
                  onChange={(e) => setPayingCompanyId(e.target.value)}
                >
                  {companies.map((c) => (
                    <MenuItem key={c._id} value={c._id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={paymentForm.paymentMethod}
                  label="Payment Method"
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                >
                  <MenuItem value="bank_transfer">Bank Transfer / Online</MenuItem>
                  <MenuItem value="check">Cheque / TT</MenuItem>
                  <MenuItem value="cash">Cash (CPV)</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Pay-From Account</InputLabel>
                <Select
                  value={paymentForm.bankAccountId}
                  label="Pay-From Account"
                  onChange={(e) => setPaymentForm({ ...paymentForm, bankAccountId: e.target.value })}
                >
                  <MenuItem value="">
                    {isIcPayingMode ? '— Select paying company bank —' : '-- Default Bank Account --'}
                  </MenuItem>
                  {bankAccounts.map((item) => {
                    const acc = item?.account || item;
                    const depth = item?.depth || 0;
                    return (
                      <MenuItem key={acc._id} value={acc._id}>
                        {formatPayFromAccountLabel(acc, depth)}
                      </MenuItem>
                    );
                  })}
                </Select>
                {bankAccounts.length === 0 && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                    No cash/bank accounts found for the Paying company.
                  </Typography>
                )}
              </FormControl>
            </Grid>

            {isIcPayingMode && (
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Related Party Account (Original Company)</InputLabel>
                  <Select
                    value={paymentForm.relatedPartyAccountId || ''}
                    label="Related Party Account (Original Company)"
                    onChange={(e) => setPaymentForm({ ...paymentForm, relatedPartyAccountId: e.target.value })}
                  >
                    <MenuItem value="">— Select related party account —</MenuItem>
                    {relatedPartyAccounts.map((item) => {
                      const acc = item?.account || item;
                      const depth = item?.depth || 0;
                      return (
                        <MenuItem key={acc._id} value={acc._id}>
                          {formatPayFromAccountLabel(acc, depth)}
                        </MenuItem>
                      );
                    })}
                  </Select>
                  {relatedPartyAccounts.length === 0 ? (
                    <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                      No Payable to Related Parties on the original (bill) company.
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      From the bill company COA — used with Pay From bank for intercompany posting.
                    </Typography>
                  )}
                </FormControl>
              </Grid>
            )}

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth size="small" label="Cheque # / TT # / Transaction Reference"
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                placeholder="e.g. CHQ-991204"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth size="small" label="Narration / Description"
                value={paymentForm.narration}
                onChange={(e) => setPaymentForm({ ...paymentForm, narration: e.target.value })}
                placeholder="Enter payment narration for voucher"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <WhtField
                label="WHT (Optional)"
                gross={totalSelectedPayAmount}
                form={paymentForm}
                onChange={(patch) => setPaymentForm({ ...paymentForm, ...patch })}
                helperText={wht.invalid
                  ? 'Must be less than the payment amount'
                  : whtAmount > 0
                    ? `WHT Deduction: ${formatPKR(whtAmount)} (${wht.rate}%) | Net Bank: ${formatPKR(netDisbursementAmount)}`
                    : 'Leave empty if exempt'}
              />
            </Grid>
          </Grid>
        </Paper>

        {/* Finance Authority Pickers */}
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={1.5}>
            <FinanceApprovalAuthorityPicker
              finAuth={finAuth}
              onChange={setFinAuth}
              candidateUsers={financeAuthorityCandidates}
              disabled={processing}
              title="Finance Voucher Approval Signatures (Required)"
            />
          </Grid>
        </Paper>

        {/* Final Payment Summary Banner */}
        <Paper sx={{ p: 2, bgcolor: 'primary.50', borderRadius: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Selected Bills:</Typography>
              <Typography variant="h6" fontWeight={700}>{selectedBills.length} bill(s)</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Gross Amount to Settle:</Typography>
              <Typography variant="h6" fontWeight={800} color="primary.main">
                {formatPKR(totalSelectedPayAmount)}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Net Bank Disbursement:</Typography>
              <Typography variant="h6" fontWeight={800} color="success.dark">
                {formatPKR(netDisbursementAmount)}
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      </DialogContent>

      <DialogActions sx={{ p: 2, px: 3, justifyContent: 'space-between' }}>
        <Button onClick={onClose} disabled={processing}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="success"
          size="large"
          startIcon={<CheckCircleIcon />}
          onClick={handlePostPayments}
          disabled={processing || selectedBills.length === 0 || totalSelectedPayAmount <= 0}
        >
          {processing ? 'Posting Payments…' : `Post Payment (${formatPKR(totalSelectedPayAmount)})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
