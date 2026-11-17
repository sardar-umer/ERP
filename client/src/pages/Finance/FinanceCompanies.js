import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Switch,
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
  AccountBalance as BankIcon,
  Add as AddIcon,
  Business as BusinessIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Search as SearchIcon,
  Star as StarIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const emptyBankForm = () => ({
  bankName: '',
  accountTitle: '',
  accountNumber: '',
  branch: '',
  iban: '',
  isPrimary: false,
  isActive: true,
  notes: ''
});

const toBankForm = (bank) => ({
  bankName: bank?.bankName || '',
  accountTitle: bank?.accountTitle || '',
  accountNumber: bank?.accountNumber || '',
  branch: bank?.branch || '',
  iban: bank?.iban || '',
  isPrimary: Boolean(bank?.isPrimary),
  isActive: bank?.isActive !== false,
  notes: bank?.notes || ''
});

export default function FinanceCompanies() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [banksDialogOpen, setBanksDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [banks, setBanks] = useState([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankFormOpen, setBankFormOpen] = useState(false);
  const [editingBank, setEditingBank] = useState(null);
  const [bankForm, setBankForm] = useState(emptyBankForm());
  const [seedingCompanyId, setSeedingCompanyId] = useState('');
  const [syncingCodes, setSyncingCodes] = useState(false);

  const fetchCompanies = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = { status: 'all' };
      if (search.trim()) params.search = search.trim();
      const response = await api.get('/finance/companies', { params });
      setCompanies(response.data?.data || []);
    } catch (err) {
      setCompanies([]);
      setError(err.response?.data?.message || 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(fetchCompanies, search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [fetchCompanies, search]);

  const filteredCompanies = useMemo(() => companies, [companies]);

  const loadCompanyBanks = useCallback(async (companyId) => {
    try {
      setBanksLoading(true);
      const response = await api.get(`/finance/companies/${companyId}/banks`);
      setSelectedCompany(response.data?.data?.company || null);
      setBanks(response.data?.data?.banks || []);
    } catch (err) {
      setBanks([]);
      setError(err.response?.data?.message || 'Failed to load banks');
    } finally {
      setBanksLoading(false);
    }
  }, []);

  const handleSeedChart = async (company) => {
    if (!company?._id) return;
    try {
      setSeedingCompanyId(company._id);
      setError('');
      const response = await api.post(`/finance/companies/${company._id}/seed-chart-of-accounts`);
      setSuccess(response.data?.message || `Chart of accounts seeded for ${company.name}`);
      await fetchCompanies();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to seed chart of accounts');
    } finally {
      setSeedingCompanyId('');
    }
  };

  const handleSyncCompanyCodes = async () => {
    try {
      setSyncingCodes(true);
      setError('');
      const response = await api.post('/finance/companies/sync-codes');
      setSuccess(response.data?.message || 'Company codes updated');
      await fetchCompanies();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to sync company codes');
    } finally {
      setSyncingCodes(false);
    }
  };

  const handleOpenBanks = (company) => {
    setSelectedCompany(company);
    setBanksDialogOpen(true);
    setBankFormOpen(false);
    setEditingBank(null);
    loadCompanyBanks(company._id);
  };

  const handleCloseBanksDialog = () => {
    setBanksDialogOpen(false);
    setSelectedCompany(null);
    setBanks([]);
    setBankFormOpen(false);
    setEditingBank(null);
    fetchCompanies();
  };

  const handleOpenAddBank = () => {
    setEditingBank(null);
    setBankForm(emptyBankForm());
    setBankFormOpen(true);
  };

  const handleOpenEditBank = (bank) => {
    setEditingBank(bank);
    setBankForm(toBankForm(bank));
    setBankFormOpen(true);
  };

  const handleSaveBank = async () => {
    if (!selectedCompany?._id) return;
    if (!bankForm.bankName.trim() || !bankForm.accountNumber.trim()) {
      setError('Bank name and account number are required');
      return;
    }

    try {
      setBankSaving(true);
      setError('');
      const payload = {
        ...bankForm,
        bankName: bankForm.bankName.trim(),
        accountTitle: bankForm.accountTitle.trim(),
        accountNumber: bankForm.accountNumber.trim(),
        branch: bankForm.branch.trim(),
        iban: bankForm.iban.trim(),
        notes: bankForm.notes.trim()
      };

      if (editingBank?._id) {
        await api.put(`/finance/companies/${selectedCompany._id}/banks/${editingBank._id}`, payload);
        setSuccess('Bank account updated');
      } else {
        await api.post(`/finance/companies/${selectedCompany._id}/banks`, payload);
        setSuccess('Bank account added');
      }

      setBankFormOpen(false);
      setEditingBank(null);
      await loadCompanyBanks(selectedCompany._id);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save bank account');
    } finally {
      setBankSaving(false);
    }
  };

  const handleDeleteBank = async (bank) => {
    if (!selectedCompany?._id) return;
    if (!window.confirm(`Remove bank account ${bank.accountNumber}?`)) return;

    try {
      setError('');
      await api.delete(`/finance/companies/${selectedCompany._id}/banks/${bank._id}`);
      setSuccess('Bank account removed');
      await loadCompanyBanks(selectedCompany._id);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete bank account');
    }
  };

  const pg = useClientPagination(filteredCompanies);
  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BusinessIcon color="primary" />
          <Typography variant="h4" fontWeight={700}>Companies</Typography>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Legal companies for company-wise finance. Each company can have its own chart of accounts and bank accounts.
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Button variant="outlined" onClick={handleSyncCompanyCodes} disabled={syncingCodes}>
          {syncingCodes ? 'Syncing codes…' : 'Sync Company Codes'}
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                )
              }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Chip label={`Total: ${filteredCompanies.length}`} color="primary" variant="outlined" />
          </Grid>
        </Grid>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Company</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="center">COA Accounts</TableCell>
              <TableCell align="center">Banks</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : filteredCompanies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No companies found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              pg.rows.map((company) => (
                <TableRow key={company._id} hover>
                  <TableCell>
                    <Typography fontWeight={600}>{company.name}</Typography>
                  </TableCell>
                  <TableCell>{company.companyCode || '—'}</TableCell>
                  <TableCell>{company.type || '—'}</TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={company.accountCount || 0}
                      color={company.accountCount ? 'info' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      icon={<BankIcon />}
                      label={company.bankCount || 0}
                      color={company.bankCount ? 'primary' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={company.isActive !== false ? 'Active' : 'Inactive'}
                      color={company.isActive !== false ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="outlined"
                      sx={{ mr: 1 }}
                      disabled={seedingCompanyId === company._id}
                      onClick={() => handleSeedChart(company)}
                    >
                      {seedingCompanyId === company._id ? 'Seeding…' : 'Seed COA'}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<BankIcon />}
                      onClick={() => handleOpenBanks(company)}
                    >
                      Manage Banks
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>{pg.bar}
      </TableContainer>

      <Dialog open={banksDialogOpen} onClose={handleCloseBanksDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {selectedCompany?.name || 'Company Banks'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Bank accounts for this company
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAddBank}>
            Add Bank
          </Button>
        </DialogTitle>
        <DialogContent dividers>
          {banksLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : banks.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">No bank accounts yet. Click Add Bank to create one.</Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Bank</TableCell>
                  <TableCell>Account Title</TableCell>
                  <TableCell>Account No.</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>IBAN</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {banks.map((bank) => (
                  <TableRow key={bank._id}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {bank.isPrimary && (
                          <Tooltip title="Primary account">
                            <StarIcon color="warning" fontSize="small" />
                          </Tooltip>
                        )}
                        <Typography fontWeight={500}>{bank.bankName}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>{bank.accountTitle || '—'}</TableCell>
                    <TableCell>{bank.accountNumber}</TableCell>
                    <TableCell>{bank.branch || '—'}</TableCell>
                    <TableCell>{bank.iban || '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={bank.isActive !== false ? 'Active' : 'Inactive'}
                        color={bank.isActive !== false ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => handleOpenEditBank(bank)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => handleDeleteBank(bank)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {bankFormOpen && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                {editingBank ? 'Edit Bank Account' : 'Add Bank Account'}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Bank Name *"
                    value={bankForm.bankName}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, bankName: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Account Title"
                    value={bankForm.accountTitle}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, accountTitle: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Account Number *"
                    value={bankForm.accountNumber}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Branch"
                    value={bankForm.branch}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, branch: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="IBAN"
                    value={bankForm.iban}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, iban: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Notes"
                    value={bankForm.notes}
                    onChange={(e) => setBankForm((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={bankForm.isPrimary}
                        onChange={(e) => setBankForm((prev) => ({ ...prev, isPrimary: e.target.checked }))}
                      />
                    }
                    label="Primary account"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={bankForm.isActive}
                        onChange={(e) => setBankForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                      />
                    }
                    label="Active"
                  />
                </Grid>
              </Grid>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
                <Button onClick={() => { setBankFormOpen(false); setEditingBank(null); }}>Cancel</Button>
                <Button variant="contained" onClick={handleSaveBank} disabled={bankSaving}>
                  {bankSaving ? 'Saving…' : editingBank ? 'Update Bank' : 'Save Bank'}
                </Button>
              </Box>
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseBanksDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
