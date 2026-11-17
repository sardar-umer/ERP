import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Button,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Card,
  CardContent,
  Alert,
  Snackbar,
  Chip,
  InputAdornment,
  CircularProgress,
  Autocomplete,
  FormControlLabel,
  Switch
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  People as PeopleIcon
} from '@mui/icons-material';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import api from '../../../services/api';
import {
  fetchRecoveryMembers,
  createRecoveryMember,
  updateRecoveryMember,
  deleteRecoveryMember
} from '../../../services/recoveryMemberService';
import useClientPagination from '../../../hooks/useClientPagination';

const formValidationSchema = Yup.object({
  employee: Yup.mixed().nullable(),
  notes: Yup.string().trim().max(500, 'Notes cannot exceed 500 characters'),
  isActive: Yup.boolean()
});

const getEmployeeDisplayName = (emp) => {
  if (!emp) return '-';
  const name = [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim();
  return name || emp.employeeId || '-';
};

const RecoveryMembers = () => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allEmployees, setAllEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadMembers = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (search.trim()) params.search = search.trim();
      const response = await fetchRecoveryMembers(params);
      setMembers(response.data?.data || []);
    } catch (error) {
      console.error('Error fetching recovery members:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error fetching recovery members',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadEmployees = useCallback(async () => {
    try {
      setEmployeesLoading(true);
      const response = await api.get('/finance/recovery-members/eligible-employees');
      const data = response.data?.data || [];
      setAllEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching employees:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error fetching eligible employees',
        severity: 'error'
      });
      setAllEmployees([]);
    } finally {
      setEmployeesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const memberEmployeeIds = useMemo(
    () => new Set(members.map((m) => (m.employee?._id || m.employee)?.toString()).filter(Boolean)),
    [members]
  );
  const availableEmployees = useMemo(
    () => allEmployees.filter((emp) => !memberEmployeeIds.has(emp._id?.toString())),
    [allEmployees, memberEmployeeIds]
  );

  const formik = useFormik({
    initialValues: {
      employee: null,
      notes: '',
      isActive: true
    },
    validationSchema: formValidationSchema,
    onSubmit: async (values) => {
      if (!isEditing && !values.employee) {
        formik.setFieldError('employee', 'Please select an employee');
        return;
      }
      try {
        setLoading(true);
        if (isEditing && selectedMember) {
          await updateRecoveryMember(selectedMember._id, {
            notes: values.notes?.trim() || '',
            isActive: values.isActive
          });
          setSnackbar({
            open: true,
            message: 'Recovery member updated successfully',
            severity: 'success'
          });
        } else {
          const employeeId = values.employee?._id || values.employee;
          await createRecoveryMember({
            employee: employeeId,
            notes: values.notes?.trim() || ''
          });
          setSnackbar({
            open: true,
            message: 'Recovery member added successfully',
            severity: 'success'
          });
        }
        loadMembers();
        handleCloseDialog();
      } catch (error) {
        setSnackbar({
          open: true,
          message: error.response?.data?.message || 'Error saving recovery member',
          severity: 'error'
        });
      } finally {
        setLoading(false);
      }
    }
  });

  const handleOpenDialog = (member = null) => {
    if (member) {
      setSelectedMember(member);
      setIsEditing(true);
      formik.setValues({
        employee: member.employee || null,
        notes: member.notes || '',
        isActive: member.isActive !== false
      });
    } else {
      setSelectedMember(null);
      setIsEditing(false);
      formik.setValues({ employee: null, notes: '', isActive: true });
      loadEmployees();
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedMember(null);
    setIsEditing(false);
    formik.resetForm({ values: { employee: null, notes: '', isActive: true } });
  };

  const handleDeleteClick = (member) => {
    setSelectedMember(member);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedMember) return;
    try {
      setLoading(true);
      await deleteRecoveryMember(selectedMember._id);
      setSnackbar({
        open: true,
        message: 'Recovery member removed successfully',
        severity: 'success'
      });
      loadMembers();
      setDeleteDialogOpen(false);
      setSelectedMember(null);
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error removing recovery member',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const activeMembers = members.filter((m) => m.isActive !== false);
  const inactiveCount = members.length - activeMembers.length;

  const pg = useClientPagination(members);
  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PeopleIcon color="primary" sx={{ fontSize: 32 }} />
          <Typography variant="h4" fontWeight={600}>
            Recovery Members
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
          disabled={loading}
        >
          Add Member
        </Button>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                placeholder="Search by name, employee ID, or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                size="small"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" />
                    </InputAdornment>
                  )
                }}
              />
            </Grid>
          </Grid>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : members.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                No recovery members found. Click &quot;Add Member&quot; to create one.
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Name</strong></TableCell>
                    <TableCell><strong>Employee ID</strong></TableCell>
                    <TableCell><strong>Email</strong></TableCell>
                    <TableCell><strong>Phone</strong></TableCell>
                    <TableCell><strong>Notes</strong></TableCell>
                    <TableCell><strong>Status</strong></TableCell>
                    <TableCell align="right"><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pg.rows.map((member) => (
                    <TableRow key={member._id} hover>
                      <TableCell>{getEmployeeDisplayName(member.employee) || '-'}</TableCell>
                      <TableCell>{member.employee?.employeeId ?? '-'}</TableCell>
                      <TableCell>{member.employee?.email ?? '-'}</TableCell>
                      <TableCell>{member.employee?.phone ?? '-'}</TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>{member.notes || '-'}</TableCell>
                      <TableCell>
                        <Chip
                          label={member.isActive !== false ? 'Active' : 'Inactive'}
                          color={member.isActive !== false ? 'success' : 'default'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenDialog(member)}
                          title="Edit"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        {member.isActive !== false && (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteClick(member)}
                            disabled={loading}
                            title="Remove"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>{pg.bar}
            </TableContainer>
          )}

          {!loading && members.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {activeMembers.length} active member{activeMembers.length !== 1 ? 's' : ''}
              {inactiveCount > 0 && ` • ${inactiveCount} inactive`}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{isEditing ? 'Edit Recovery Member' : 'Add Recovery Member'}</DialogTitle>
        <form onSubmit={formik.handleSubmit}>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {isEditing ? (
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Employee"
                    value={getEmployeeDisplayName(selectedMember?.employee)}
                    InputProps={{ readOnly: true }}
                    size="small"
                  />
                </Grid>
              ) : (
                <Grid item xs={12}>
                  <Autocomplete
                    options={availableEmployees}
                    getOptionLabel={(option) =>
                      typeof option === 'object' && option !== null
                        ? `${getEmployeeDisplayName(option)} ${option.employeeId ? `(${option.employeeId})` : ''}`.trim()
                        : ''
                    }
                    value={formik.values.employee}
                    onChange={(_, value) => formik.setFieldValue('employee', value)}
                    onBlur={() => formik.setFieldTouched('employee', true)}
                    loading={employeesLoading}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Select Employee"
                        required
                        error={formik.touched.employee && Boolean(formik.errors.employee)}
                        helperText={formik.touched.employee && formik.errors.employee ? formik.errors.employee : 'Only Finance department employees are shown'}
                      />
                    )}
                  />
                </Grid>
              )}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  name="notes"
                  label="Notes"
                  multiline
                  rows={2}
                  value={formik.values.notes}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  error={formik.touched.notes && Boolean(formik.errors.notes)}
                  helperText={formik.touched.notes && formik.errors.notes}
                />
              </Grid>
              {isEditing && (
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={formik.values.isActive}
                        onChange={(e) => formik.setFieldValue('isActive', e.target.checked)}
                        color="primary"
                      />
                    }
                    label="Active"
                  />
                </Grid>
              )}
            </Grid>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleCloseDialog}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={loading || (!isEditing && !formik.values.employee)}
            >
              {loading ? 'Saving...' : isEditing ? 'Update' : 'Add Member'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Remove Recovery Member</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to remove &quot;{getEmployeeDisplayName(selectedMember?.employee)}&quot;? This will mark the member as inactive.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" disabled={loading}>
            {loading ? 'Removing...' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RecoveryMembers;
