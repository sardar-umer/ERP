import React, { useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Alert,
  Stack,
  MenuItem,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  CircularProgress,
  Collapse,
  Autocomplete
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Add as AddIcon,
  GetApp as GetAppIcon,
  SwapHoriz as TransferIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import TablePaginationWrapper from '../../../components/TablePaginationWrapper';
import { useDeposits } from '../../../hooks/useDeposits';

const BANK_REQUIRED_METHODS = ['Bank Transfer', 'Cheque', 'Online'];

const SuspenseAccount = () => {
  const {
    loading,
    error,
    success,
    search,
    setSearch,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    expandedMonths,
    editDialog,
    editingDeposit,
    editForm,
    setEditForm,
    depositsByMonth,
    pagination,
    loadDeposits,
    handleEdit,
    handleUpdate,
    handleDelete,
    toggleMonth,
    setEditDialog,
    setEditingDeposit,
    setError,
    setSuccess,
    createDialog,
    setCreateDialog,
    createForm,
    setCreateForm,
    handleCreateDeposit,
    handleCreateDepositSubmit,
    unknownResidents,
    loadingResidents,
    transferDialog,
    setTransferDialog,
    transferringDeposit,
    setTransferringDeposit,
    setTransferResidentSearch,
    transferResidentId,
    setTransferResidentId,
    transferResidents,
    loadingTransferResidents,
    handleTransferDeposit,
    handleTransferDepositSubmit,
    suspenseAccountTotals,
    exportingMonthKey,
    exportMonthToExcel,
    bankOptions,
    PAYMENT_METHODS,
    formatCurrency
  } = useDeposits({ suspenseAccount: true });

  // Payment method change handler
  const handlePaymentMethodChange = useCallback((form, setForm, newMethod) => {
    setForm({
      ...form,
      paymentMethod: newMethod,
      bank: BANK_REQUIRED_METHODS.includes(newMethod) ? form.bank : ''
    });
  }, []);

  // Render bank field using centrally managed bankOptions
  const renderBankField = useCallback((form, setForm, show = true) => {
    if (!show || !BANK_REQUIRED_METHODS.includes(form.paymentMethod)) return null;
    return (
      <Grid item xs={12} md={6}>
        <FormControl fullWidth required>
          <InputLabel>Bank</InputLabel>
          <Select
            value={form.bank || ''}
            label="Bank"
            onChange={(e) => setForm({ ...form, bank: e.target.value })}
          >
            {bankOptions.length === 0 ? (
              <MenuItem disabled value="">
                <Typography variant="body2" color="text.secondary">
                  No banks available. Add banks from the Banks page.
                </Typography>
              </MenuItem>
            ) : (
              bankOptions.map((bank) => (
                <MenuItem key={bank} value={bank}>
                  {bank}
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>
      </Grid>
    );
  }, [bankOptions]);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom fontWeight={600}>
        Suspense Account
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                placeholder="Search by transaction number or description"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                }}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={loadDeposits}
                disabled={loading}
              >
                Refresh
              </Button>
            </Grid>
            <Grid item xs={12} md={3}>
              <Button
                fullWidth
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleCreateDeposit}
                disabled={loading}
              >
                Create Deposit
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Overall Totals Card - Shows totals from ALL deposits */}
      <Card sx={{ mb: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 2.5, fontWeight: 500 }}>
            Overall Summary
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <Box sx={{ 
                borderLeft: '4px solid',
                borderColor: 'primary.main',
                pl: 2,
                py: 1
              }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Total Amount
                </Typography>
                <Typography variant="h6" fontWeight={600} color="primary.main">
                  {formatCurrency(suspenseAccountTotals?.totalAmount || 0)}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Box sx={{ 
                borderLeft: '4px solid',
                borderColor: 'success.main',
                pl: 2,
                py: 1
              }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Remaining
                </Typography>
                <Typography variant="h6" fontWeight={600} color="success.main">
                  {formatCurrency(suspenseAccountTotals?.totalRemaining || 0)}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Box sx={{ 
                borderLeft: '4px solid',
                borderColor: 'warning.main',
                pl: 2,
                py: 1
              }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Used
                </Typography>
                <Typography variant="h6" fontWeight={600} color="warning.main">
                  {formatCurrency(suspenseAccountTotals?.totalUsed || 0)}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : depositsByMonth.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No deposits found
              </Typography>
            </Box>
          ) : (
            depositsByMonth.map((monthGroup) => (
              <Box key={monthGroup.key} sx={{ mb: 3 }}>
                <Card variant="outlined" sx={{ mb: 1 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{ cursor: 'pointer' }}
                      onClick={() => toggleMonth(monthGroup.key)}
                    >
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <IconButton 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMonth(monthGroup.key);
                          }}
                        >
                          {expandedMonths.includes(monthGroup.key) ? (
                            <ExpandLessIcon />
                          ) : (
                            <ExpandMoreIcon />
                          )}
                        </IconButton>
                        <Typography variant="h6" fontWeight={600}>
                          {monthGroup.label}
                        </Typography>
                        <Chip
                          label={`${monthGroup.depositCount} deposit${monthGroup.depositCount !== 1 ? 's' : ''}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      </Stack>
                      <Stack direction="row" spacing={3} alignItems="center">
                        <Tooltip title="Export all records for this month to Excel">
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={exportingMonthKey === monthGroup.key ? <CircularProgress size={18} /> : <GetAppIcon />}
                            onClick={(e) => {
                              e.stopPropagation();
                              exportMonthToExcel(monthGroup.key);
                            }}
                            disabled={!!exportingMonthKey}
                          >
                            {exportingMonthKey === monthGroup.key ? 'Exporting...' : 'Export Excel'}
                          </Button>
                        </Tooltip>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Total Amount
                          </Typography>
                          <Typography variant="body2" fontWeight={600}>
                            {formatCurrency(monthGroup.totalAmount)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Remaining
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="success.main">
                            {formatCurrency(monthGroup.totalRemaining)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Used
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="text.secondary">
                            {formatCurrency(monthGroup.totalUsed)}
                          </Typography>
                        </Box>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
                <Collapse in={expandedMonths.includes(monthGroup.key)}>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>Date</strong></TableCell>
                          <TableCell><strong>Resident</strong></TableCell>
                          <TableCell><strong>Resident ID</strong></TableCell>
                          <TableCell align="right"><strong>Amount</strong></TableCell>
                          <TableCell align="right"><strong>Remaining</strong></TableCell>
                          <TableCell><strong>Payment Method</strong></TableCell>
                          <TableCell><strong>Bank</strong></TableCell>
                          <TableCell><strong>Transaction Number</strong></TableCell>
                          <TableCell><strong>Description</strong></TableCell>
                          <TableCell align="right"><strong>Actions</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {monthGroup.deposits.map((deposit) => (
                          <TableRow key={deposit._id} hover>
                            <TableCell>{dayjs(deposit.createdAt).format('DD MMM YYYY HH:mm')}</TableCell>
                            <TableCell>{deposit.resident?.name || '-'}</TableCell>
                            <TableCell>-</TableCell>
                            <TableCell align="right">{formatCurrency(deposit.amount)}</TableCell>
                            <TableCell align="right">
                              <Typography
                                variant="body2"
                                color={deposit.remainingAmount > 0 ? 'success.main' : 'text.secondary'}
                                fontWeight="bold"
                              >
                                {formatCurrency(deposit.remainingAmount)}
                              </Typography>
                            </TableCell>
                            <TableCell>{deposit.paymentMethod || '-'}</TableCell>
                            <TableCell>{deposit.bank || '-'}</TableCell>
                            <TableCell>{deposit.referenceNumberExternal || '-'}</TableCell>
                            <TableCell>{deposit.description || '-'}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Tooltip title="Transfer to Resident">
                                  <IconButton
                                    size="small"
                                    color="success"
                                    onClick={() => handleTransferDeposit(deposit)}
                                    disabled={loading}
                                  >
                                    <TransferIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Edit Deposit">
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    onClick={() => handleEdit(deposit)}
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Delete Deposit">
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => handleDelete(deposit)}
                                    disabled={loading}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Collapse>
              </Box>
            ))
          )}
          {!loading && depositsByMonth.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <TablePaginationWrapper
                page={pagination.page}
                rowsPerPage={pagination.rowsPerPage}
                total={pagination.total}
                onPageChange={pagination.handleChangePage}
                onRowsPerPageChange={pagination.handleChangeRowsPerPage}
              />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialog} onClose={() => {
        setEditDialog(false);
        setEditingDeposit(null);
        setEditForm({
          amount: '',
          paymentMethod: 'Cash',
          bank: '',
          referenceNumberExternal: '',
          description: ''
        });
      }} maxWidth="sm" fullWidth>
        <DialogTitle>
          Edit Deposit - {editingDeposit?.resident?.name || 'Unknown Resident'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Alert severity="info">
                Current Balance: {formatCurrency(editingDeposit?.resident?.balance || 0)}
              </Alert>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Amount"
                type="number"
                value={editForm.amount}
                onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={editForm.paymentMethod}
                  label="Payment Method"
                  onChange={(e) => handlePaymentMethodChange(editForm, setEditForm, e.target.value)}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <MenuItem key={method} value={method}>
                      {method}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            {renderBankField(editForm, setEditForm)}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Transaction Number"
                value={editForm.referenceNumberExternal}
                onChange={(e) => setEditForm({ ...editForm, referenceNumberExternal: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Deposit Date"
                type="date"
                value={editForm.depositDate || ''}
                onChange={(e) => setEditForm({ ...editForm, depositDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setEditDialog(false);
            setEditingDeposit(null);
            setEditForm({
              amount: '',
              paymentMethod: 'Cash',
              bank: '',
              referenceNumberExternal: '',
              description: '',
              depositDate: ''
            });
          }}>Cancel</Button>
          <Button onClick={handleUpdate} variant="contained" disabled={loading || !editForm.amount || !editForm.referenceNumberExternal}>
            Update
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Deposit Dialog */}
      <Dialog open={createDialog} onClose={() => {
        setCreateDialog(false);
        setCreateForm({
          amount: '',
          paymentMethod: 'Cash',
          bank: '',
          referenceNumberExternal: '',
          description: '',
          depositDate: dayjs().format('YYYY-MM-DD'),
          residentId: ''
        });
      }} maxWidth="sm" fullWidth>
        <DialogTitle>Create Deposit</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Resident</InputLabel>
                <Select
                  value={createForm.residentId}
                  label="Resident"
                  onChange={(e) => setCreateForm({ ...createForm, residentId: e.target.value })}
                  disabled={loadingResidents}
                >
                  <MenuItem value="new">Create New Unknown Resident</MenuItem>
                  {unknownResidents.map((resident) => (
                    <MenuItem key={resident._id} value={resident._id}>
                      {resident.name || 'Unknown'} {resident.residentId ? `(${resident.residentId})` : '(No ID)'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Amount"
                type="number"
                value={createForm.amount}
                onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
                required
                inputProps={{ min: 0, step: 0.01 }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Deposit Date"
                type="date"
                value={createForm.depositDate}
                onChange={(e) => setCreateForm({ ...createForm, depositDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={createForm.paymentMethod}
                  label="Payment Method"
                  onChange={(e) => handlePaymentMethodChange(createForm, setCreateForm, e.target.value)}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <MenuItem key={method} value={method}>
                      {method}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            {renderBankField(createForm, setCreateForm)}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Transaction Number"
                value={createForm.referenceNumberExternal}
                onChange={(e) => setCreateForm({ ...createForm, referenceNumberExternal: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={2}
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setCreateDialog(false);
            setCreateForm({
              amount: '',
              paymentMethod: 'Cash',
              bank: '',
              referenceNumberExternal: '',
              description: '',
              depositDate: dayjs().format('YYYY-MM-DD'),
              residentId: ''
            });
          }}>Cancel</Button>
          <Button 
            onClick={handleCreateDepositSubmit} 
            variant="contained" 
            disabled={loading || !createForm.amount || !createForm.referenceNumberExternal || !createForm.depositDate}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Transfer Deposit Dialog */}
      <Dialog open={transferDialog} onClose={() => {
        setTransferDialog(false);
        setTransferringDeposit(null);
        setTransferResidentSearch('');
        setTransferResidentId('');
      }} maxWidth="sm" fullWidth>
        <DialogTitle>Transfer Deposit to Resident</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Alert severity="info">
                Transferring deposit of {formatCurrency(transferringDeposit?.amount || 0)} from suspense account to a known resident.
              </Alert>
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                fullWidth
                options={transferResidents}
                getOptionLabel={(option) => {
                  if (typeof option === 'string') return option;
                  return `${option.name || ''} (${option.residentId || ''})`;
                }}
                value={transferResidents.find(r => r._id === transferResidentId) || null}
                onChange={(event, newValue) => {
                  setTransferResidentId(newValue ? newValue._id : '');
                }}
                onInputChange={(event, newInputValue, reason) => {
                  // Only update search on user input, not on selection
                  if (reason === 'input') {
                    setTransferResidentSearch(newInputValue);
                  }
                }}
                loading={loadingTransferResidents}
                filterOptions={(options) => {
                  // Disable all client-side filtering - we use server-side search only
                  return options;
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Search and Select Resident"
                    placeholder="Type name or resident ID to search..."
                    required
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <>
                          <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                          {params.InputProps.startAdornment}
                        </>
                      ),
                      endAdornment: (
                        <>
                          {loadingTransferResidents ? <CircularProgress color="inherit" size={20} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      )
                    }}
                  />
                )}
                renderOption={(props, resident) => (
                  <Box component="li" {...props} key={resident._id}>
                    <Box>
                      <Typography variant="body2">{resident.name || 'Unknown'}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Resident ID: {resident.residentId || 'N/A'}
                        {resident.contactNumber && ` • ${resident.contactNumber}`}
                      </Typography>
                    </Box>
                  </Box>
                )}
                isOptionEqualToValue={(option, value) => String(option._id) === String(value._id)}
                noOptionsText={loadingTransferResidents ? 'Loading residents...' : 'No residents found. Try a different search term.'}
                ListboxProps={{
                  style: { maxHeight: '300px' }
                }}
              />
            </Grid>
            {transferResidentId && (
              <Grid item xs={12}>
                <Alert severity="success">
                  Deposit will be transferred to: {transferResidents.find(r => r._id === transferResidentId)?.name || ''} ({transferResidents.find(r => r._id === transferResidentId)?.residentId || ''})
                </Alert>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setTransferDialog(false);
            setTransferringDeposit(null);
            setTransferResidentSearch('');
            setTransferResidentId('');
          }}>Cancel</Button>
          <Button 
            onClick={handleTransferDepositSubmit} 
            variant="contained" 
            disabled={loading || !transferResidentId}
            color="success"
          >
            Transfer
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
};

export default SuspenseAccount;
