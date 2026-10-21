import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { ArrowBack as BackIcon, Print as PrintIcon, Save as SaveIcon } from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import presidentEventService, {
  formatEventTimeRange,
  getEventVenueDisplay
} from '../../../services/presidentEventService';

const EVENT_STATUSES = ['Scheduled', 'Attended', 'Cancelled', 'Postponed'];

const statusColor = (status) => {
  if (status === 'Scheduled') return 'info';
  if (status === 'Attended') return 'success';
  if (status === 'Cancelled') return 'error';
  if (status === 'Postponed') return 'warning';
  return 'default';
};

const EventDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('Scheduled');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await presidentEventService.fetchEventById(id);
        const data = res.data?.data;
        setEvent(data);
        setNotes(data?.notes || '');
        setStatus(data?.status || 'Scheduled');
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load event');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await presidentEventService.updateEvent(id, { notes, status });
      setEvent(res.data?.data);
      toast.success('Event updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !event) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Event not found'}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<BackIcon />} onClick={() => navigate(-1)}>
          Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Button
            startIcon={<BackIcon />}
            onClick={() => navigate('/general/president-secretariat/events')}
            sx={{ mb: 1 }}
          >
            Back to events
          </Button>
          <Typography variant="h5" fontWeight={600}>
            {event.title}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
            <Typography variant="body2" color="text.secondary">
              {event.eventNumber}
            </Typography>
            <Chip size="small" label={event.status} color={statusColor(event.status)} />
            <Chip size="small" variant="outlined" label={event.eventType} />
          </Stack>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => navigate(`/general/president-secretariat/events/${id}/print`)}
          >
            Print
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>
              Details
            </Typography>
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Date
                </Typography>
                <Typography>
                  {event.eventDate
                    ? dayjs(event.eventDate).format('dddd, DD MMM YYYY')
                    : '—'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Time
                </Typography>
                <Typography>{formatEventTimeRange(event.startTime, event.endTime)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Venue
                </Typography>
                <Typography>{getEventVenueDisplay(event)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Host / Organizer
                </Typography>
                <Typography>{event.host || '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Representing
                </Typography>
                <Typography>{event.representing || '—'}</Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>
              Status & notes
            </Typography>
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {EVENT_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                fullWidth
                multiline
                minRows={8}
                label="Notes / Purpose"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default EventDetail;
