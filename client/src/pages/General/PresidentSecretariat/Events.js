import React, { useCallback, useEffect, useState } from 'react';
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
  Delete as DeleteIcon,
  Edit as EditIcon,
  Print as PrintIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import presidentEventService, {
  formatEventTimeRange,
  getEventVenueDisplay
} from '../../../services/presidentEventService';

const EVENT_TYPES = ['Official', 'Political', 'Ceremony', 'Social', 'Wedding', 'Dua', 'Other'];
const EVENT_STATUSES = ['Scheduled', 'Attended', 'Cancelled', 'Postponed'];
const DEFAULT_REPRESENTING = 'Sardar Tanveer Ilyas';

const emptyForm = {
  title: '',
  eventDate: dayjs().format('YYYY-MM-DD'),
  startTime: '',
  endTime: '',
  venue: '',
  eventType: 'Official',
  host: '',
  representing: DEFAULT_REPRESENTING,
  notes: '',
  status: 'Scheduled'
};

const statusColor = (status) => {
  if (status === 'Scheduled') return 'info';
  if (status === 'Attended') return 'success';
  if (status === 'Cancelled') return 'error';
  if (status === 'Postponed') return 'warning';
  return 'default';
};

const Events = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ search: '', status: '', eventType: '' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await presidentEventService.fetchEvents({
        page: page + 1,
        limit: rowsPerPage,
        ...(filters.search && { search: filters.search }),
        ...(filters.status && { status: filters.status }),
        ...(filters.eventType && { eventType: filters.eventType })
      });
      setRows(res.data?.data?.events || []);
      setTotal(res.data?.data?.pagination?.total || 0);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row._id);
    setForm({
      title: row.title || '',
      eventDate: row.eventDate ? dayjs(row.eventDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      startTime: row.startTime || '',
      endTime: row.endTime || '',
      venue: row.venue || '',
      eventType: row.eventType || 'Official',
      host: row.host || '',
      representing: row.representing || DEFAULT_REPRESENTING,
      notes: row.notes || '',
      status: row.status || 'Scheduled'
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!form.eventDate) {
      toast.error('Event date is required');
      return;
    }

    const payload = {
      ...form,
      title: form.title.trim(),
      venue: form.venue.trim(),
      eventDate: new Date(form.eventDate).toISOString()
    };

    try {
      setSaving(true);
      if (editingId) {
        await presidentEventService.updateEvent(editingId, payload);
        toast.success('Event updated');
      } else {
        await presidentEventService.createEvent(payload);
        toast.success('Event created');
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete event "${row.title}"?`)) return;
    try {
      await presidentEventService.deleteEvent(row._id);
      toast.success('Event deleted');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            Event Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            President Secretariat — events the President attends
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
              if (filters.search) params.set('search', filters.search);
              if (filters.status) params.set('status', filters.status);
              if (filters.eventType) params.set('eventType', filters.eventType);
              const qs = params.toString();
              navigate(`/general/president-secretariat/events/print${qs ? `?${qs}` : ''}`);
            }}
          >
            Print List
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New Event
          </Button>
        </Stack>
      </Stack>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              label="Search"
              placeholder="Title, number, venue, host..."
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
                {EVENT_STATUSES.map((s) => (
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
                value={filters.eventType}
                onChange={(e) => {
                  setPage(0);
                  setFilters((f) => ({ ...f, eventType: e.target.value }));
                }}
              >
                <MenuItem value="">All</MenuItem>
                {EVENT_TYPES.map((t) => (
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
                  <TableCell>Host</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography color="text.secondary" py={3}>
                        No events found
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row._id} hover>
                      <TableCell>{row.eventNumber}</TableCell>
                      <TableCell>{row.title}</TableCell>
                      <TableCell>
                        {row.eventDate ? dayjs(row.eventDate).format('DD MMM YYYY') : '—'}
                      </TableCell>
                      <TableCell>{formatEventTimeRange(row.startTime, row.endTime)}</TableCell>
                      <TableCell>{row.eventType}</TableCell>
                      <TableCell>{getEventVenueDisplay(row)}</TableCell>
                      <TableCell>{row.host || '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" label={row.status} color={statusColor(row.status)} />
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="View">
                          <IconButton
                            size="small"
                            onClick={() =>
                              navigate(`/general/president-secretariat/events/${row._id}`)
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
        <DialogTitle>{editingId ? 'Edit Event' : 'New Event'}</DialogTitle>
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
                label="Event Date"
                InputLabelProps={{ shrink: true }}
                value={form.eventDate}
                onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))}
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
                  value={form.eventType}
                  onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))}
                >
                  {EVENT_TYPES.map((t) => (
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
                >
                  {EVENT_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Venue"
                value={form.venue}
                onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Host / Organizer"
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Representing"
                value={form.representing}
                onChange={(e) => setForm((f) => ({ ...f, representing: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Notes / Purpose"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Events;
