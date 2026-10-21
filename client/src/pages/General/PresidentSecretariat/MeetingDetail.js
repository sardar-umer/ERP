import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  CheckCircle as AcceptIcon,
  Cancel as RejectIcon,
  Print as PrintIcon,
  Save as SaveIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import presidentMeetingService, {
  formatMeetingTimeRange
} from '../../../services/presidentMeetingService';

const REQUEST_STATUSES = ['Requested', 'Rejected'];
const SCHEDULE_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Postponed'];

const statusColor = (status) => {
  if (status === 'Requested') return 'warning';
  if (status === 'Rejected') return 'error';
  if (status === 'Scheduled') return 'info';
  if (status === 'Completed') return 'success';
  if (status === 'Cancelled') return 'error';
  if (status === 'Postponed') return 'warning';
  return 'default';
};

const MeetingDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [minutes, setMinutes] = useState('');
  const [decisions, setDecisions] = useState('');
  const [status, setStatus] = useState('Requested');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await presidentMeetingService.fetchMeetingById(id);
        const data = res.data?.data;
        setMeeting(data);
        setMinutes(data?.minutes || '');
        setDecisions(data?.decisions || '');
        setStatus(data?.status || 'Requested');
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load meeting');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const isRequest = REQUEST_STATUSES.includes(meeting?.status || status);
  const statusOptions = isRequest ? REQUEST_STATUSES : SCHEDULE_STATUSES;
  const backPath = isRequest
    ? '/general/president-secretariat/meetings'
    : '/general/president-secretariat/meetings?tab=schedule';

  const handleSaveNotes = async () => {
    try {
      setSaving(true);
      const res = await presidentMeetingService.updateMeeting(id, {
        minutes,
        decisions,
        status
      });
      setMeeting(res.data?.data);
      setStatus(res.data?.data?.status || status);
      toast.success('Meeting updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAccept = async () => {
    try {
      setActionLoading(true);
      const res = await presidentMeetingService.acceptMeetingRequest(id);
      setMeeting(res.data?.data);
      setStatus('Scheduled');
      toast.success('Accepted — moved to Meeting Schedule');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Accept failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('Reject this meeting request?')) return;
    try {
      setActionLoading(true);
      const res = await presidentMeetingService.rejectMeetingRequest(id);
      setMeeting(res.data?.data);
      setStatus('Rejected');
      toast.success('Meeting request rejected');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reject failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !meeting) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Meeting not found'}</Alert>
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
            onClick={() => navigate(backPath)}
            sx={{ mb: 1 }}
          >
            {isRequest ? 'Back to Meeting Requests' : 'Back to Meeting Schedule'}
          </Button>
          <Typography variant="h5" fontWeight={600}>
            {meeting.title}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
            <Typography variant="body2" color="text.secondary">
              {meeting.meetingNumber}
            </Typography>
            <Chip size="small" label={meeting.status} color={statusColor(meeting.status)} />
            <Chip size="small" variant="outlined" label={meeting.meetingType} />
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {meeting.status === 'Requested' && (
            <>
              <Button
                variant="contained"
                color="success"
                startIcon={<AcceptIcon />}
                onClick={handleAccept}
                disabled={actionLoading}
              >
                Accept
              </Button>
              <Button
                variant="outlined"
                color="warning"
                startIcon={<RejectIcon />}
                onClick={handleReject}
                disabled={actionLoading}
              >
                Reject
              </Button>
            </>
          )}
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => navigate(`/general/president-secretariat/meetings/${id}/print`)}
          >
            Print
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSaveNotes}
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
                  {meeting.meetingDate
                    ? dayjs(meeting.meetingDate).format('dddd, DD MMM YYYY')
                    : '—'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Time
                </Typography>
                <Typography>
                  {formatMeetingTimeRange(meeting.startTime, meeting.endTime)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Venue
                </Typography>
                <Typography>{meeting.venue || '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Chairperson
                </Typography>
                <Typography>{meeting.chairperson || '—'}</Typography>
              </Box>
              {meeting.agenda && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Agenda
                  </Typography>
                  <Typography whiteSpace="pre-wrap">{meeting.agenda}</Typography>
                </Box>
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" mb={1}>
              Attendees ({meeting.attendees?.length || 0})
            </Typography>
            {meeting.attendees?.length ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Designation</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {meeting.attendees.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{a.designation || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No attendees listed
              </Typography>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>
              Minutes & decisions
            </Typography>
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {statusOptions.map((s) => (
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
                label="Minutes of meeting"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
              <TextField
                fullWidth
                multiline
                minRows={4}
                label="Decisions"
                value={decisions}
                onChange={(e) => setDecisions(e.target.value)}
              />
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MeetingDetail;
