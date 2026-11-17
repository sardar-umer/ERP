import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { AssignmentInd, AssignmentTurnedIn, Groups, Refresh } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import procurementService from '../../services/procurementService';
import { formatDate } from '../../utils/dateUtils';
import useClientPagination from '../../hooks/useClientPagination';

const StatCard = ({ title, value, subtitle, color = 'primary.main' }) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Typography variant="body2" color="text.secondary">{title}</Typography>
      <Typography variant="h4" sx={{ fontWeight: 700, color, lineHeight: 1.2 }}>{value}</Typography>
      {subtitle ? <Typography variant="caption" color="text.secondary">{subtitle}</Typography> : null}
    </CardContent>
  </Card>
);

const ProcurementTaskAssignment = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tasks, setTasks] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [assignmentFilter, setAssignmentFilter] = useState('all');
  const [canManageAssignments, setCanManageAssignments] = useState(false);
  const [assignDialog, setAssignDialog] = useState({
    open: false,
    requisition: null,
    assigneeId: '',
    note: '',
    submitting: false
  });
  const [assignmentManagers, setAssignmentManagers] = useState([]);
  const [selectedManagerIds, setSelectedManagerIds] = useState([]);
  const [managersLoading, setManagersLoading] = useState(false);
  const [managersSaving, setManagersSaving] = useState(false);

  const canConfigureAssignmentManagers = useMemo(() => {
    if (!user) return false;
    if (user.role === 'super_admin' || user.role === 'developer' || user.role === 'admin') return true;
    const accepted = ['gm procurement', 'general manager procurement'];
    const roleRefName = String(user?.roleRef?.name || user?.roleRef?.displayName || '').toLowerCase();
    if (accepted.includes(roleRefName)) return true;
    if (Array.isArray(user?.roles)) {
      return user.roles.some((roleDoc) => {
        const roleName = String(roleDoc?.name || roleDoc?.displayName || '').toLowerCase();
        return accepted.includes(roleName);
      });
    }
    return false;
  }, [user]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const requisitionsRes = await procurementService.getRequisitions({
        page: 1,
        limit: 200,
        ...(assignmentFilter === 'assigned' ? { assignmentStatus: 'assigned' } : {}),
        ...(assignmentFilter === 'unassigned' ? { assignmentStatus: 'unassigned' } : {}),
        ...(assignmentFilter === 'mine' ? { mineOnly: 'true' } : {})
      });

      const requisitions = requisitionsRes?.data?.indents || [];
      setTasks(requisitions);
      setCanManageAssignments(Boolean(requisitionsRes?.data?.canManageAssignments));

      if (requisitionsRes?.data?.canManageAssignments) {
        const assigneesRes = await procurementService.getRequisitionAssignees();
        setAssignees(assigneesRes?.data || []);
      } else {
        setAssignees([]);
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load procurement task assignments');
    } finally {
      setLoading(false);
    }
  }, [assignmentFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadAssignmentManagers = useCallback(async () => {
    if (!canConfigureAssignmentManagers) return;
    try {
      setManagersLoading(true);
      const response = await procurementService.getAssignmentManagers();
      const users = response?.data || [];
      setAssignmentManagers(users);
      setSelectedManagerIds(
        users.filter((u) => u.canAssignProcurementTasks).map((u) => u._id)
      );
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load assignment rights');
    } finally {
      setManagersLoading(false);
    }
  }, [canConfigureAssignmentManagers]);

  useEffect(() => {
    loadAssignmentManagers();
  }, [loadAssignmentManagers]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const assigned = tasks.filter((task) => task?.procurementAssignment?.status === 'assigned' && task?.procurementAssignment?.assignedTo).length;
    const unassigned = total - assigned;
    const myTasks = tasks.filter((task) => {
      const assignedTo = task?.procurementAssignment?.assignedTo;
      if (!assignedTo) return false;
      const assignedToId = assignedTo._id || assignedTo.id;
      return assignedToId && String(assignedToId) === String(user?.id);
    }).length;
    return { total, assigned, unassigned, myTasks };
  }, [tasks, user?.id]);

  const openAssignDialog = (task) => {
    setAssignDialog({
      open: true,
      requisition: task,
      assigneeId: task?.procurementAssignment?.assignedTo?._id || '',
      note: task?.procurementAssignment?.note || '',
      submitting: false
    });
  };

  const submitAssignment = async () => {
    if (!assignDialog.requisition?._id || !assignDialog.assigneeId) {
      setError('Please choose an assignee.');
      return;
    }
    try {
      setAssignDialog((prev) => ({ ...prev, submitting: true }));
      const response = await procurementService.assignRequisition(assignDialog.requisition._id, {
        assigneeId: assignDialog.assigneeId,
        note: assignDialog.note
      });
      if (response.success) {
        setSuccess(response.message || 'Task assigned successfully.');
        setAssignDialog({ open: false, requisition: null, assigneeId: '', note: '', submitting: false });
        loadData();
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to assign task');
      setAssignDialog((prev) => ({ ...prev, submitting: false }));
    }
  };

  const handleSaveAssignmentManagers = async () => {
    try {
      setManagersSaving(true);
      const response = await procurementService.updateAssignmentManagers(selectedManagerIds);
      if (response?.success) {
        setSuccess(response.message || 'Assignment rights updated successfully.');
        await Promise.all([loadData(), loadAssignmentManagers()]);
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save assignment rights');
    } finally {
      setManagersSaving(false);
    }
  };

  const pg = useClientPagination(tasks);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} sx={{ mb: 3 }} spacing={2}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main' }}>
            Procurement Task Assignment
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Assign approved requisitions to procurement users and track task ownership.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            select
            size="small"
            label="Task View"
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="all">All Tasks</MenuItem>
            <MenuItem value="assigned">Assigned</MenuItem>
            <MenuItem value="unassigned">Unassigned</MenuItem>
            <MenuItem value="mine">My Tasks</MenuItem>
          </TextField>
          <Button variant="outlined" startIcon={<Refresh />} onClick={loadData}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      {error ? <Alert sx={{ mb: 2 }} severity="error" onClose={() => setError('')}>{error}</Alert> : null}
      {success ? <Alert sx={{ mb: 2 }} severity="success" onClose={() => setSuccess('')}>{success}</Alert> : null}

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard title="Total Tasks" value={stats.total} subtitle="Loaded requisitions" color="primary.main" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard title="Assigned" value={stats.assigned} subtitle="Ready for execution" color="success.main" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard title="Unassigned" value={stats.unassigned} subtitle="Needs assignment" color="warning.main" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard title="My Tasks" value={stats.myTasks} subtitle="Assigned to you" color="info.main" />
        </Grid>
      </Grid>

      {canConfigureAssignmentManagers && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              spacing={1.5}
              sx={{ mb: 1 }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Assignment Rights Control
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Choose which procurement users can assign and reassign requisition tasks.
                </Typography>
              </Box>
              <Button
                variant="contained"
                onClick={handleSaveAssignmentManagers}
                disabled={managersLoading || managersSaving}
              >
                {managersSaving ? 'Saving...' : 'Save Rights'}
              </Button>
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            {managersLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={22} />
              </Box>
            ) : assignmentManagers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No procurement users found.
              </Typography>
            ) : (
              <Grid container spacing={1}>
                {assignmentManagers.map((managerUser) => {
                  const checked = selectedManagerIds.includes(managerUser._id);
                  return (
                    <Grid item xs={12} md={6} lg={4} key={managerUser._id}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedManagerIds((prev) => [...new Set([...prev, managerUser._id])]);
                              } else {
                                setSelectedManagerIds((prev) => prev.filter((id) => id !== managerUser._id));
                              }
                            }}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {`${managerUser.firstName || ''} ${managerUser.lastName || ''}`.trim() || managerUser.email}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {managerUser.position || managerUser.role || 'Procurement user'}
                            </Typography>
                          </Box>
                        }
                      />
                    </Grid>
                  );
                })}
              </Grid>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Req #</strong></TableCell>
                    <TableCell><strong>Title</strong></TableCell>
                    <TableCell><strong>Department</strong></TableCell>
                    <TableCell><strong>Status</strong></TableCell>
                    <TableCell><strong>Assignment</strong></TableCell>
                    <TableCell><strong>Assigned On</strong></TableCell>
                    <TableCell align="center"><strong>Action</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tasks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography color="text.secondary">No tasks found</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pg.rows.map((task) => {
                      const assignment = task.procurementAssignment || {};
                      const assigneeName = assignment.assignedTo
                        ? `${assignment.assignedTo.firstName || ''} ${assignment.assignedTo.lastName || ''}`.trim()
                        : '';
                      return (
                        <TableRow key={task._id} hover>
                          <TableCell>{task.indentNumber || '-'}</TableCell>
                          <TableCell>{task.title || '-'}</TableCell>
                          <TableCell>{task.department?.name || '-'}</TableCell>
                          <TableCell>
                            <Chip size="small" label={task.status || 'Unknown'} color="success" />
                          </TableCell>
                          <TableCell>
                            {assignment.status === 'assigned' && assignment.assignedTo ? (
                              <Stack direction="row" spacing={1} alignItems="center">
                                <AssignmentTurnedIn color="success" fontSize="small" />
                                <Typography variant="body2">{assigneeName || 'Assigned User'}</Typography>
                              </Stack>
                            ) : (
                              <Stack direction="row" spacing={1} alignItems="center">
                                <AssignmentInd color="warning" fontSize="small" />
                                <Typography variant="body2" color="warning.main">Pending</Typography>
                              </Stack>
                            )}
                          </TableCell>
                          <TableCell>{assignment.assignedAt ? formatDate(assignment.assignedAt) : '-'}</TableCell>
                          <TableCell align="center">
                            {canManageAssignments ? (
                              <Button
                                size="small"
                                variant={assignment.status === 'assigned' ? 'outlined' : 'contained'}
                                startIcon={<Groups />}
                                onClick={() => openAssignDialog(task)}
                              >
                                {assignment.status === 'assigned' ? 'Reassign' : 'Assign'}
                              </Button>
                            ) : (() => {
                              const assignedTo = assignment.assignedTo;
                              const aid = assignedTo?._id || assignedTo?.id;
                              const isMine = aid && user?.id && String(aid) === String(user.id);
                              if (isMine) {
                                return (
                                  <Button
                                    size="small"
                                    variant="contained"
                                    onClick={() => navigate('/procurement/requisitions?myTasks=1')}
                                  >
                                    Open my tasks
                                  </Button>
                                );
                              }
                              return (
                                <Typography variant="body2" color="text.secondary">
                                  —
                                </Typography>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>{pg.bar}
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={assignDialog.open}
        onClose={() => setAssignDialog({ open: false, requisition: null, assigneeId: '', note: '', submitting: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Assign Procurement Task</DialogTitle>
        <DialogContent>
          {assignDialog.requisition ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>Requisition #:</strong> {assignDialog.requisition.indentNumber}<br />
                <strong>Title:</strong> {assignDialog.requisition.title}
              </Typography>
              <TextField
                fullWidth
                select
                label="Assign To"
                value={assignDialog.assigneeId}
                onChange={(e) => setAssignDialog((prev) => ({ ...prev, assigneeId: e.target.value }))}
                size="small"
                required
                sx={{ mb: 2 }}
              >
                {assignees.map((assignee) => (
                  <MenuItem key={assignee._id} value={assignee._id}>
                    {`${assignee.firstName || ''} ${assignee.lastName || ''}`.trim()} {assignee.position ? `(${assignee.position})` : ''}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Assignment Note (Optional)"
                value={assignDialog.note}
                onChange={(e) => setAssignDialog((prev) => ({ ...prev, note: e.target.value }))}
              />
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignDialog({ open: false, requisition: null, assigneeId: '', note: '', submitting: false })}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submitAssignment}
            disabled={assignDialog.submitting || !assignDialog.assigneeId}
          >
            {assignDialog.submitting ? 'Saving...' : 'Save Assignment'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProcurementTaskAssignment;
