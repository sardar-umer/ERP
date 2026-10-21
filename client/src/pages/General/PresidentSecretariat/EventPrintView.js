import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Typography
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Print as PrintIcon } from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import presidentEventService, {
  formatEventTimeRange,
  getEventVenueDisplay
} from '../../../services/presidentEventService';

const DetailRow = ({ label, value }) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr',
      columnGap: 2,
      py: 0.85,
      borderBottom: '1px solid #eee',
      '&:last-of-type': { borderBottom: 'none' }
    }}
  >
    <Typography
      variant="body2"
      sx={{ fontWeight: 800, color: '#000', fontSize: '0.95rem' }}
    >
      {label}
    </Typography>
    <Typography variant="body2" sx={{ color: '#111', fontSize: '0.95rem' }}>
      {value || '—'}
    </Typography>
  </Box>
);

const Section = ({ title, children }) => (
  <Box sx={{ mt: 3 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25 }}>
      <Typography
        variant="subtitle2"
        fontWeight={700}
        sx={{
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          fontSize: '0.78rem',
          color: '#1a1a1a',
          whiteSpace: 'nowrap'
        }}
      >
        {title}
      </Typography>
      <Box sx={{ flex: 1, height: '1px', bgcolor: '#d0d0d0' }} />
    </Box>
    <Box
      sx={{
        px: 1.5,
        py: 1.25,
        bgcolor: '#fafafa',
        border: '1px solid #ececec',
        borderRadius: 1,
        '@media print': {
          bgcolor: 'transparent',
          border: '1px solid #ddd'
        }
      }}
    >
      {children}
    </Box>
  </Box>
);

const EventPrintView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await presidentEventService.fetchEventById(id);
        setEvent(res.data?.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load event');
      } finally {
        setLoading(false);
      }
    };
    if (id) load();
  }, [id]);

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !event) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Event not found'}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          Back
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100%',
        bgcolor: { xs: '#fff', sm: '#f3f4f6' },
        pb: 4,
        '@media print': { bgcolor: '#fff', pb: 0 }
      }}
    >
      <Box
        className="print-hide-toolbar app-print-hide"
        sx={{
          p: 2,
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap',
          justifyContent: 'center',
          '@media print': { display: 'none' }
        }}
      >
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/general/president-secretariat/events/${id}`)}
        >
          Back
        </Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print
        </Button>
      </Box>

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          px: { xs: 1.5, sm: 3 },
          '@media print': { px: 0 }
        }}
      >
        <Paper
          sx={{
            width: '100%',
            maxWidth: 820,
            p: { xs: 2.5, sm: 4.5 },
            backgroundColor: '#fff',
            boxShadow: { xs: 'none', sm: '0 1px 4px rgba(0,0,0,0.12)' },
            border: '1px solid #e0e0e0',
            borderRadius: 1,
            '@media print': {
              boxShadow: 'none',
              border: 'none',
              borderRadius: 0,
              maxWidth: '100%',
              width: '100%',
              p: '18mm 16mm'
            }
          }}
        >
          <Box sx={{ textAlign: 'center', mb: 2.5 }}>
            <Typography variant="h5" fontWeight={700} letterSpacing={0.3}>
              President Secretariat
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={{ mt: 0.5 }}>
              Event Details
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {event.eventNumber}
            </Typography>
          </Box>

          <Divider sx={{ mb: 1.5 }} />

          <Box sx={{ maxWidth: 640, mx: 'auto', width: '100%' }}>
            <DetailRow label="Title" value={event.title} />
            <DetailRow
              label="Date"
              value={
                event.eventDate ? dayjs(event.eventDate).format('dddd, DD MMM YYYY') : '—'
              }
            />
            <DetailRow
              label="Time"
              value={formatEventTimeRange(event.startTime, event.endTime)}
            />
            <DetailRow label="Venue" value={getEventVenueDisplay(event)} />
            <DetailRow label="Type" value={event.eventType} />
            <DetailRow label="Host / Organizer" value={event.host} />
            <DetailRow label="Representing" value={event.representing} />
            <DetailRow label="Status" value={event.status} />
          </Box>

          <Section title="Notes / Purpose">
            <Typography variant="body2" whiteSpace="pre-wrap" minHeight={24}>
              {event.notes || ''}
            </Typography>
          </Section>

          <Box
            sx={{
              mt: 7,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 4,
              px: { xs: 0, sm: 2 }
            }}
          >
            <Box sx={{ textAlign: 'center', flex: 1, maxWidth: 220 }}>
              <Divider />
              <Typography variant="caption" display="block" mt={0.75}>
                Prepared By
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center', flex: 1, maxWidth: 220 }}>
              <Divider />
              <Typography variant="caption" display="block" mt={0.75}>
                Representing
              </Typography>
            </Box>
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            mt={4}
            textAlign="center"
          >
            Printed on {dayjs().format('DD MMM YYYY, hh:mm A')}
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
};

export default EventPrintView;
