import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Event as EventIcon,
  Groups as MeetingIcon,
  NotificationsActive as ReminderIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon,
  WarningAmber as WarningIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import presidentMeetingService, {
  formatMeetingTimeRange
} from '../../../services/presidentMeetingService';
import presidentEventService, {
  formatEventTimeRange,
  getEventVenueDisplay
} from '../../../services/presidentEventService';

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

const ACTIVE_MEETING_STATUSES = ['Scheduled', 'Postponed'];
const ACTIVE_EVENT_STATUSES = ['Scheduled', 'Postponed'];

const startOfToday = () => dayjs().startOf('day');
const endOfWeek = () => dayjs().endOf('day').add(7, 'day');

const toDay = (date) => (date ? dayjs(date).startOf('day') : null);

const isActiveMeeting = (m) => ACTIVE_MEETING_STATUSES.includes(m.status);
const isActiveEvent = (e) => ACTIVE_EVENT_STATUSES.includes(e.status);

const reminderLevel = (date) => {
  const d = toDay(date);
  if (!d) return null;
  const today = startOfToday();
  if (d.isBefore(today)) return 'overdue';
  if (d.isSame(today, 'day')) return 'today';
  if (d.isSame(today.add(1, 'day'), 'day')) return 'tomorrow';
  if (d.isSameOrBefore(endOfWeek(), 'day')) return 'week';
  return null;
};

const levelChip = (level) => {
  if (level === 'overdue') return { label: 'Overdue', color: 'error' };
  if (level === 'today') return { label: 'Today', color: 'warning' };
  if (level === 'tomorrow') return { label: 'Tomorrow', color: 'info' };
  if (level === 'week') return { label: 'This week', color: 'default' };
  return { label: level, color: 'default' };
};

const StatCard = ({ title, value, subtitle, icon, color, onClick }) => (
  <Paper
    onClick={onClick}
    sx={{
      p: 2.25,
      height: '100%',
      cursor: onClick ? 'pointer' : 'default',
      border: '1px solid',
      borderColor: 'divider',
      transition: 'box-shadow 0.15s, transform 0.15s',
      '&:hover': onClick
        ? { boxShadow: 3, transform: 'translateY(-2px)' }
        : undefined
    }}
  >
    <Stack direction="row" spacing={2} alignItems="center">
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: color,
          color: '#fff'
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
        <Typography variant="h4" fontWeight={700} lineHeight={1.2}>
          {value}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
    </Stack>
  </Paper>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meetings, setMeetings] = useState([]);
  const [events, setEvents] = useState([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [meetingsRes, eventsRes] = await Promise.all([
        presidentMeetingService.fetchMeetings({ page: 1, limit: 200 }),
        presidentEventService.fetchEvents({ page: 1, limit: 200 })
      ]);
      setMeetings(meetingsRes.data?.data?.meetings || []);
      setEvents(eventsRes.data?.data?.events || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const today = startOfToday();
    const weekEnd = endOfWeek();

    const activeMeetings = meetings.filter(isActiveMeeting);
    const activeEvents = events.filter(isActiveEvent);

    const meetingsToday = activeMeetings.filter((m) =>
      toDay(m.meetingDate)?.isSame(today, 'day')
    );
    const eventsToday = activeEvents.filter((e) =>
      toDay(e.eventDate)?.isSame(today, 'day')
    );

    const meetingsWeek = activeMeetings.filter((m) => {
      const d = toDay(m.meetingDate);
      return d && d.isSameOrAfter(today, 'day') && d.isSameOrBefore(weekEnd, 'day');
    });
    const eventsWeek = activeEvents.filter((e) => {
      const d = toDay(e.eventDate);
      return d && d.isSameOrAfter(today, 'day') && d.isSameOrBefore(weekEnd, 'day');
    });

    const meetingsOverdue = activeMeetings.filter((m) =>
      toDay(m.meetingDate)?.isBefore(today, 'day')
    );
    const eventsOverdue = activeEvents.filter((e) =>
      toDay(e.eventDate)?.isBefore(today, 'day')
    );

    return {
      meetingsToday: meetingsToday.length,
      eventsToday: eventsToday.length,
      upcomingWeek: meetingsWeek.length + eventsWeek.length,
      overdue: meetingsOverdue.length + eventsOverdue.length,
      meetingsWeek,
      eventsWeek,
      meetingsOverdue,
      eventsOverdue
    };
  }, [meetings, events]);

  const reminders = useMemo(() => {
    const items = [];

    meetings.filter(isActiveMeeting).forEach((m) => {
      const level = reminderLevel(m.meetingDate);
      if (!level) return;
      items.push({
        id: `meeting-${m._id}`,
        kind: 'Meeting',
        level,
        title: m.title,
        number: m.meetingNumber,
        date: m.meetingDate,
        time: formatMeetingTimeRange(m.startTime, m.endTime, ''),
        venue: m.venue || '—',
        status: m.status,
        path: `/general/president-secretariat/meetings/${m._id}`
      });
    });

    events.filter(isActiveEvent).forEach((e) => {
      const level = reminderLevel(e.eventDate);
      if (!level) return;
      items.push({
        id: `event-${e._id}`,
        kind: 'Event',
        level,
        title: e.title,
        number: e.eventNumber,
        date: e.eventDate,
        time: formatEventTimeRange(e.startTime, e.endTime, ''),
        venue: getEventVenueDisplay(e),
        status: e.status,
        path: `/general/president-secretariat/events/${e._id}`
      });
    });

    const order = { overdue: 0, today: 1, tomorrow: 2, week: 3 };
    return items.sort((a, b) => {
      const levelDiff = (order[a.level] ?? 9) - (order[b.level] ?? 9);
      if (levelDiff !== 0) return levelDiff;
      return dayjs(a.date).valueOf() - dayjs(b.date).valueOf();
    });
  }, [meetings, events]);

  const upcomingMeetings = useMemo(() => {
    const today = startOfToday();
    return meetings
      .filter((m) => isActiveMeeting(m) && toDay(m.meetingDate)?.isSameOrAfter(today, 'day'))
      .sort((a, b) => dayjs(a.meetingDate).valueOf() - dayjs(b.meetingDate).valueOf())
      .slice(0, 8);
  }, [meetings]);

  const upcomingEvents = useMemo(() => {
    const today = startOfToday();
    return events
      .filter((e) => isActiveEvent(e) && toDay(e.eventDate)?.isSameOrAfter(today, 'day'))
      .sort((a, b) => dayjs(a.eventDate).valueOf() - dayjs(b.eventDate).valueOf())
      .slice(0, 8);
  }, [events]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            President Secretariat Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Overview of meetings, events, and upcoming reminders
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
            onClick={() => navigate('/general/president-secretariat/meetings')}
          >
            Meeting Requests
          </Button>
          <Button
            variant="outlined"
            onClick={() => navigate('/general/president-secretariat/meetings?tab=schedule')}
          >
            Meeting Schedule
          </Button>
          <Button
            variant="contained"
            onClick={() => navigate('/general/president-secretariat/events')}
          >
            Events
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Meetings today"
            value={stats.meetingsToday}
            subtitle="Scheduled / postponed"
            icon={<MeetingIcon />}
            color="#1565c0"
            onClick={() => navigate('/general/president-secretariat/meetings')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Events today"
            value={stats.eventsToday}
            subtitle="Scheduled / postponed"
            icon={<EventIcon />}
            color="#2e7d32"
            onClick={() => navigate('/general/president-secretariat/events')}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Next 7 days"
            value={stats.upcomingWeek}
            subtitle="Meetings + events"
            icon={<ReminderIcon />}
            color="#6a1b9a"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Needs attention"
            value={stats.overdue}
            subtitle="Past date still open"
            icon={<WarningIcon />}
            color="#c62828"
          />
        </Grid>
      </Grid>

      <Paper sx={{ p: 2.5, mb: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={1} mb={2}>
          <ReminderIcon color="warning" />
          <Typography variant="h6" fontWeight={600}>
            Reminders
          </Typography>
          <Chip size="small" label={`${reminders.length}`} />
        </Stack>

        {reminders.length === 0 ? (
          <Alert severity="success">
            No upcoming reminders — nothing scheduled for today, tomorrow, or this week.
          </Alert>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Priority</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Venue</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Open</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reminders.map((item) => {
                  const chip = levelChip(item.level);
                  return (
                    <TableRow
                      key={item.id}
                      hover
                      sx={{
                        bgcolor:
                          item.level === 'overdue'
                            ? 'rgba(198,40,40,0.06)'
                            : item.level === 'today'
                              ? 'rgba(237,108,2,0.06)'
                              : 'transparent'
                      }}
                    >
                      <TableCell>
                        <Chip size="small" label={chip.label} color={chip.color} />
                      </TableCell>
                      <TableCell>{item.kind}</TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {item.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.number}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {item.date ? dayjs(item.date).format('DD MMM YYYY') : '—'}
                      </TableCell>
                      <TableCell>{item.time || '—'}</TableCell>
                      <TableCell>{item.venue}</TableCell>
                      <TableCell>{item.status}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => navigate(item.path)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', height: '100%' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" fontWeight={600}>
                Upcoming meetings
              </Typography>
              <Button
                size="small"
                onClick={() => navigate('/general/president-secretariat/meetings')}
              >
                View all
              </Button>
            </Stack>
            {upcomingMeetings.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No upcoming meetings
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Time</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {upcomingMeetings.map((m) => (
                    <TableRow key={m._id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {m.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {m.venue || '—'} · {m.status}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {m.meetingDate ? dayjs(m.meetingDate).format('DD MMM YYYY') : '—'}
                      </TableCell>
                      <TableCell>
                        {formatMeetingTimeRange(m.startTime, m.endTime)}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() =>
                            navigate(`/general/president-secretariat/meetings/${m._id}`)
                          }
                        >
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', height: '100%' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" fontWeight={600}>
                Upcoming events
              </Typography>
              <Button
                size="small"
                onClick={() => navigate('/general/president-secretariat/events')}
              >
                View all
              </Button>
            </Stack>
            {upcomingEvents.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No upcoming events
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Time</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {upcomingEvents.map((e) => (
                    <TableRow key={e._id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {e.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {getEventVenueDisplay(e)} · {e.status}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {e.eventDate ? dayjs(e.eventDate).format('DD MMM YYYY') : '—'}
                      </TableCell>
                      <TableCell>
                        {formatEventTimeRange(e.startTime, e.endTime)}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() =>
                            navigate(`/general/president-secretariat/events/${e._id}`)
                          }
                        >
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
