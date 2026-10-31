import React from 'react';
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
  Collapse
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  GetApp as GetAppIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import TablePaginationWrapper from '../../../components/TablePaginationWrapper';
import { useDeposits } from '../../../hooks/useDeposits';

const Deposits = () => {
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
    handleCreateDepositSubmit,
    unknownResidents,
    loadingResidents,
    PAYMENT_METHODS,
    chargeTypeOptions,
    bankOptions,
    formatCurrency,
    renderBankField,
    exportingMonthKey,
    exportMonthToExcel
  } = useDeposits();

  const bankFieldConfig = renderBankField(editForm, setEditForm);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom fontWeight={600}>
        Deposits
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
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                placeholder="Search by resident name, transaction number, or description"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
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
                            Suspense Account
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="warning.main">
                            {formatCurrency(monthGroup.suspenseTotalAmount || 0)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Total Amount (Suspense + Deposits)
                          </Typography>
                          <Typography variant="body2" fontWeight={600}>
                            {formatCurrency((monthGroup.suspenseTotalAmount || 0) + monthGroup.totalAmount)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Remaining
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="success.main">
                            {formatCurrency((monthGroup.suspenseTotalRemaining || 0) + monthGroup.totalRemaining)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Used
                          </Typography>
                          <Typography variant="body2" fontWeight={600} color="text.secondary">
                            {formatCurrency((monthGroup.suspenseTotalUsed || 0) + monthGroup.totalUsed)}
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
                          <TableCell><strong>Charge Type</strong></TableCell>
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
                            <TableCell>{deposit.resident?.residentId || '-'}</TableCell>
                            <TableCell>{deposit.chargeType || '-'}</TableCell>
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
          description: '',
          depositDate: '',
          chargeType: ''
        });
      }} maxWidth="sm" fullWidth>
        <DialogTitle>
          Edit Deposit - {editingDeposit?.resident?.name}
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
              <TextField
                fullWidth
                label="Deposit Date"
                type="date"
                value={editForm.depositDate}
                onChange={(e) => setEditForm({ ...editForm, depositDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Charge Type</InputLabel>
                <Select
                  value={editForm.chargeType || ''}
                  label="Charge Type"
                  onChange={(e) => setEditForm({ ...editForm, chargeType: e.target.value })}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {chargeTypeOptions.map((type) => (
                    <MenuItem key={type} value={type}>
                      {type}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={editForm.paymentMethod}
                  label="Payment Method"
                  onChange={(e) => setEditForm({ ...editForm, paymentMethod: e.target.value, bank: e.target.value === 'Cash' ? '' : editForm.bank })}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <MenuItem key={method} value={method}>
                      {method}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            {bankFieldConfig && (
              <Grid item xs={12} md={6}>
                <FormControl fullWidth required>
                  <InputLabel>Bank</InputLabel>
                  <Select
                    value={editForm.bank || ''}
                    label="Bank"
                    onChange={(e) => setEditForm({ ...editForm, bank: e.target.value })}
                  >
                    {bankOptions.map((bank) => (
                      <MenuItem key={bank} value={bank}>
                        {bank}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Transaction Number"
                value={editForm.referenceNumberExternal}
                onChange={(e) => setEditForm({ ...editForm, referenceNumberExternal: e.target.value })}
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
              depositDate: '',
              chargeType: ''
            });
          }}>Cancel</Button>
          <Button onClick={handleUpdate} variant="contained" disabled={loading || !editForm.amount || !editForm.referenceNumberExternal || !editForm.depositDate}>
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
          residentId: '',
          chargeType: ''
        });
      }} maxWidth="sm" fullWidth>
        <DialogTitle>Create Deposit</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <FormControl fullWidth required>
                <InputLabel>Resident</InputLabel>
                <Select
                  value={createForm.residentId}
                  label="Resident"
                  onChange={(e) => setCreateForm({ ...createForm, residentId: e.target.value })}
                  disabled={loadingResidents}
                >
                  {unknownResidents.map((resident) => (
                    <MenuItem key={resident._id} value={resident._id}>
                      {resident.name || 'Unknown'} {resident.residentId ? `(${resident.residentId})` : ''}
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
                <InputLabel>Charge Type</InputLabel>
                <Select
                  value={createForm.chargeType || ''}
                  label="Charge Type"
                  onChange={(e) => setCreateForm({ ...createForm, chargeType: e.target.value })}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {chargeTypeOptions.map((type) => (
                    <MenuItem key={type} value={type}>
                      {type}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={createForm.paymentMethod}
                  label="Payment Method"
                  onChange={(e) => setCreateForm({ ...createForm, paymentMethod: e.target.value, bank: e.target.value === 'Cash' ? '' : createForm.bank })}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <MenuItem key={method} value={method}>
                      {method}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            {createForm.paymentMethod !== 'Cash' && (
              <Grid item xs={12} md={6}>
                <FormControl fullWidth required>
                  <InputLabel>Bank</InputLabel>
                  <Select
                    value={createForm.bank || ''}
                    label="Bank"
                    onChange={(e) => setCreateForm({ ...createForm, bank: e.target.value })}
                  >
                    {bankOptions.map((bank) => (
                      <MenuItem key={bank} value={bank}>
                        {bank}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
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
              residentId: '',
              chargeType: ''
            });
          }}>Cancel</Button>
          <Button 
            onClick={handleCreateDepositSubmit} 
            variant="contained" 
            disabled={loading || !createForm.amount || !createForm.referenceNumberExternal || !createForm.depositDate || !createForm.residentId}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Deposits;

