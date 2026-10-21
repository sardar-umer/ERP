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
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as AcceptIcon,
  Cancel as RejectIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Print as PrintIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import presidentMeetingService, {
  formatMeetingTimeRange
} from '../../../services/presidentMeetingService';

const MEETING_TYPES = ['Board', 'Internal', 'External', 'Committee', 'Political', 'Other'];
const MEETING_VENUES = ['SGHQ', 'Annexe F8', 'Taj Site'];
const REQUEST_STATUSES = ['Requested', 'Rejected'];
const SCHEDULE_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Postponed'];

const DEFAULT_CHAIRPERSON = 'Sardar Tanveer Ilyas';

const emptyForm = {
  title: '',
  meetingDate: dayjs().format('YYYY-MM-DD'),
  startTime: '',
  endTime: '',
  venue: 'SGHQ',
  meetingType: 'Internal',
  chairperson: DEFAULT_CHAIRPERSON,
  agenda: '',
  status: 'Requested',
  attendees: [{ name: '', designation: '' }]
};

const statusColor = (status) => {
  if (status === 'Requested') return 'warning';
  if (status === 'Rejected') return 'error';
  if (status === 'Scheduled') return 'info';
  if (status === 'Completed') return 'success';
  if (status === 'Cancelled') return 'error';
  if (status === 'Postponed') return 'warning';
  return 'default';
};

const Meetings = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // View mode from sidebar: Meeting Request | Meeting Schedule (?tab=schedule)
  const bucket = searchParams.get('tab') === 'schedule' ? 'schedule' : 'requests';
  const isRequestView = bucket === 'requests';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ search: '', status: '', meetingType: '' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const statusOptions = useMemo(
    () => (isRequestView ? REQUEST_STATUSES : SCHEDULE_STATUSES),
    [isRequestView]
  );

  // Reset list filters when switching sidebar view
  useEffect(() => {
    setPage(0);
    setFilters({ search: '', status: '', meetingType: '' });
  }, [bucket]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await presidentMeetingService.fetchMeetings({
        page: page + 1,
        limit: rowsPerPage,
        bucket,
        ...(filters.search && { search: filters.search }),
        ...(filters.status && { status: filters.status }),
        ...(filters.meetingType && { meetingType: filters.meetingType })
      });
      setRows(res.data?.data?.meetings || []);
      setTotal(res.data?.data?.pagination?.total || 0);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, filters, bucket]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, status: 'Requested' });
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({
      title: row.title || '',
      meetingDate: row.meetingDate ? dayjs(row.meetingDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      startTime: row.startTime || '',
      endTime: row.endTime || '',
      venue: MEETING_VENUES.includes(row.venue) ? row.venue : 'SGHQ',
      meetingType: row.meetingType || 'Internal',
      chairperson: row.chairperson || DEFAULT_CHAIRPERSON,
      agenda: row.agenda || '',
      status: row.status || (isRequestView ? 'Requested' : 'Scheduled'),
      attendees:
        Array.isArray(row.attendees) && row.attendees.length > 0
          ? row.attendees.map((a) => ({ name: a.name || '', designation: a.designation || '' }))
          : [{ name: '', designation: '' }]
    });
    setDialogOpen(true);
  };

  const handleAttendeeChange = (index, field, value) => {
    setForm((prev) => {
      const attendees = [...prev.attendees];
      attendees[index] = { ...attendees[index], [field]: value };
      return { ...prev, attendees };
    });
  };

  const addAttendee = () => {
    setForm((prev) => ({
      ...prev,
      attendees: [...prev.attendees, { name: '', designation: '' }]
    }));
  };

  const removeAttendee = (index) => {
    setForm((prev) => ({
      ...prev,
      attendees: prev.attendees.length === 1
        ? [{ name: '', designation: '' }]
        : prev.attendees.filter((_, i) => i !== index)
    }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!form.meetingDate) {
      toast.error('Meeting date is required');
      return;
    }

    const payload = {
      ...form,
      title: form.title.trim(),
      meetingDate: new Date(form.meetingDate).toISOString(),
      attendees: form.attendees.filter((a) => a.name.trim()),
      // New creates from Request tab always start as Requested
      status: editingId ? form.status : 'Requested'
    };

    try {
      setSaving(true);
      if (editingId) {
        await presidentMeetingService.updateMeeting(editingId, payload);
        toast.success(isRequestView ? 'Meeting request updated' : 'Meeting updated');
      } else {
        await presidentMeetingService.createMeeting(payload);
        toast.success('Meeting request created');
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAccept = async (row) => {
    try {
      setActionLoadingId(row._id);
      await presidentMeetingService.acceptMeetingRequest(row._id);
      toast.success('Accepted — moved to Meeting Schedule');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Accept failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (row) => {
    if (!window.confirm(`Reject meeting request "${row.title}"?`)) return;
    try {
      setActionLoadingId(row._id);
      await presidentMeetingService.rejectMeetingRequest(row._id);
      toast.success('Meeting request rejected');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reject failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (row) => {
    const label = isRequestView ? 'meeting request' : 'meeting';
    if (!window.confirm(`Delete ${label} "${row.title}"?`)) return;
    try {
      await presidentMeetingService.deleteMeeting(row._id);
      toast.success(isRequestView ? 'Meeting request deleted' : 'Meeting deleted');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed');
    }
  };

  const dialogStatusOptions = editingId
    ? (REQUEST_STATUSES.includes(form.status) ? REQUEST_STATUSES : SCHEDULE_STATUSES)
    : REQUEST_STATUSES;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            {isRequestView ? 'Meeting Request' : 'Meeting Schedule'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isRequestView
              ? 'Create and review meeting requests — accept to move them to the schedule'
              : 'Accepted meetings scheduled for the President Secretariat'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <IconButton onClick={load}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => {
              const params = new URLSearchParams();
              params.set('bucket', bucket);
              if (filters.search) params.set('search', filters.search);
              if (filters.status) params.set('status', filters.status);
              if (filters.meetingType) params.set('meetingType', filters.meetingType);
              navigate(`/general/president-secretariat/meetings/print?${params.toString()}`);
            }}
          >
            Print List
          </Button>
          {isRequestView && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              New Meeting Request
            </Button>
          )}
        </Stack>
      </Stack>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              label="Search"
              placeholder="Title, number, venue..."
              value={filters.search}
              onChange={(e) => {
                setPage(0);
                setFilters((f) => ({ ...f, search: e.target.value }));
              }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={filters.status}
                onChange={(e) => {
                  setPage(0);
                  setFilters((f) => ({ ...f, status: e.target.value }));
                }}
              >
                <MenuItem value="">All</MenuItem>
                {statusOptions.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select
                label="Type"
                value={filters.meetingType}
                onChange={(e) => {
                  setPage(0);
                  setFilters((f) => ({ ...f, meetingType: e.target.value }));
                }}
              >
                <MenuItem value="">All</MenuItem>
                {MEETING_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!isRequestView && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Meetings appear here after a request is <strong>Accepted</strong> from the Meeting Request tab.
        </Alert>
      )}

      <TableContainer component={Paper}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Number</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Venue</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <Typography color="text.secondary" py={3}>
                        {isRequestView
                          ? 'No meeting requests found'
                          : 'No scheduled meetings yet'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row._id} hover>
                      <TableCell>{row.meetingNumber}</TableCell>
                      <TableCell>{row.title}</TableCell>
                      <TableCell>
                        {row.meetingDate ? dayjs(row.meetingDate).format('DD MMM YYYY') : '—'}
                      </TableCell>
                      <TableCell>
                        {formatMeetingTimeRange(row.startTime, row.endTime)}
                      </TableCell>
                      <TableCell>{row.meetingType}</TableCell>
                      <TableCell>{row.venue || '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" label={row.status} color={statusColor(row.status)} />
                      </TableCell>
                      <TableCell align="right">
                        {isRequestView && row.status === 'Requested' && (
                          <>
                            <Tooltip title="Accept → Schedule">
                              <span>
                                <IconButton
                                  size="small"
                                  color="success"
                                  disabled={actionLoadingId === row._id}
                                  onClick={() => handleAccept(row)}
                                >
                                  <AcceptIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title="Reject">
                              <span>
                                <IconButton
                                  size="small"
                                  color="warning"
                                  disabled={actionLoadingId === row._id}
                                  onClick={() => handleReject(row)}
                                >
                                  <RejectIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </>
                        )}
                        <Tooltip title="View">
                          <IconButton
                            size="small"
                            onClick={() =>
                              navigate(`/general/president-secretariat/meetings/${row._id}`)
                            }
                          >
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => openEdit(row)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => handleDelete(row)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50]}
            />
          </>
        )}
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingId
            ? (isRequestView ? 'Edit Meeting Request' : 'Edit Meeting')
            : 'New Meeting Request'}
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                label="Title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                required
                type="date"
                label="Meeting Date"
                InputLabelProps={{ shrink: true }}
                value={form.meetingDate}
                onChange={(e) => setForm((f) => ({ ...f, meetingDate: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6} md={4}>
              <TextField
                fullWidth
                type="time"
                label="Start Time"
                InputLabelProps={{ shrink: true }}
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6} md={4}>
              <TextField
                fullWidth
                type="time"
                label="End Time"
                InputLabelProps={{ shrink: true }}
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Type</InputLabel>
                <Select
                  label="Type"
                  value={form.meetingType}
                  onChange={(e) => setForm((f) => ({ ...f, meetingType: e.target.value }))}
                >
                  {MEETING_TYPES.map((t) => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  disabled={!editingId}
                >
                  {dialogStatusOptions.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Venue</InputLabel>
                <Select
                  label="Venue"
                  value={form.venue}
                  onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))}
                >
                  {MEETING_VENUES.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Chairperson"
                value={form.chairperson}
                onChange={(e) => setForm((f) => ({ ...f, chairperson: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Agenda"
                value={form.agenda}
                onChange={(e) => setForm((f) => ({ ...f, agenda: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="subtitle2">Attendees</Typography>
                <Button size="small" onClick={addAttendee}>
                  Add attendee
                </Button>
              </Stack>
              {form.attendees.map((attendee, index) => (
                <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={1} mb={1}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Name"
                    value={attendee.name}
                    onChange={(e) => handleAttendeeChange(index, 'name', e.target.value)}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label="Designation"
                    value={attendee.designation}
                    onChange={(e) => handleAttendeeChange(index, 'designation', e.target.value)}
                  />
                  <IconButton color="error" onClick={() => removeAttendee(index)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : editingId ? 'Update' : 'Create Request'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Meetings;
