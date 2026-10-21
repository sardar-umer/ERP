import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Print as PrintIcon } from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import presidentMeetingService, {
  formatMeetingTimeRange
} from '../../../services/presidentMeetingService';

const DetailRow = ({ label, value }) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr',
      columnGap: 2,
      rowGap: 0.5,
      py: 0.85,
      borderBottom: '1px solid #eee',
      '&:last-of-type': { borderBottom: 'none' }
    }}
  >
    <Typography variant="body2" fontWeight={700} color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2">{value || '—'}</Typography>
  </Box>
);

const Section = ({ title, children }) => (
  <Box sx={{ mt: 3 }}>
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        mb: 1.25
      }}
    >
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

const MeetingPrintView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await presidentMeetingService.fetchMeetingById(id);
        setMeeting(res.data?.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load meeting');
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

  if (error || !meeting) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Meeting not found'}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          Back
        </Button>
      </Box>
    );
  }

  const timeLabel = formatMeetingTimeRange(meeting.startTime, meeting.endTime);

  return (
    <Box
      sx={{
        minHeight: '100%',
        bgcolor: { xs: '#fff', sm: '#f3f4f6' },
        pb: 4,
        '@media print': {
          bgcolor: '#fff',
          pb: 0
        }
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
          onClick={() => navigate(`/general/president-secretariat/meetings/${id}`)}
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
              Minutes of Meeting
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {meeting.meetingNumber}
            </Typography>
          </Box>

          <Divider sx={{ mb: 1.5 }} />

          <Box sx={{ maxWidth: 640, mx: 'auto', width: '100%' }}>
            <DetailRow label="Title" value={meeting.title} />
            <DetailRow
              label="Date"
              value={
                meeting.meetingDate
                  ? dayjs(meeting.meetingDate).format('dddd, DD MMM YYYY')
                  : '—'
              }
            />
            <DetailRow label="Time" value={timeLabel} />
            <DetailRow label="Venue" value={meeting.venue} />
            <DetailRow label="Type" value={meeting.meetingType} />
            <DetailRow label="Chairperson" value={meeting.chairperson} />
            <DetailRow label="Status" value={meeting.status} />
          </Box>

          {meeting.agenda ? (
            <Section title="Agenda">
              <Typography variant="body2" whiteSpace="pre-wrap">
                {meeting.agenda}
              </Typography>
            </Section>
          ) : null}

          <Section title="Attendees">
            {meeting.attendees?.length ? (
              <Table
                size="small"
                sx={{
                  border: '1px solid #ccc',
                  '& th, & td': { border: '1px solid #ccc', py: 0.85 }
                }}
              >
                <TableHead>
                  <TableRow sx={{ bgcolor: '#f7f7f7' }}>
                    <TableCell width="8%">#</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Designation</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {meeting.attendees.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{a.designation || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2">No attendees listed</Typography>
            )}
          </Section>

          <Section title="Minutes of Meeting">
            <Typography variant="body2" whiteSpace="pre-wrap" minHeight={24}>
              {meeting.minutes || ''}
            </Typography>
          </Section>

          <Section title="Decisions">
            <Typography variant="body2" whiteSpace="pre-wrap" minHeight={24}>
              {meeting.decisions || ''}
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
                Chairperson
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

export default MeetingPrintView;
