import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Print as PrintIcon } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import presidentMeetingService, {
  formatMeetingTimeRange
} from '../../../services/presidentMeetingService';

const MeetingsListPrintView = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const meetingType = searchParams.get('meetingType') || '';
  const bucket = searchParams.get('bucket') || '';

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await presidentMeetingService.fetchMeetings({
          page: 1,
          limit: 200,
          ...(bucket && { bucket }),
          ...(search && { search }),
          ...(status && { status }),
          ...(meetingType && { meetingType })
        });
        setRows(res.data?.data?.meetings || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load meetings');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [search, status, meetingType, bucket]);

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          Back
        </Button>
      </Box>
    );
  }

  const filterBits = [
    bucket === 'requests' && 'Meeting Requests',
    bucket === 'schedule' && 'Meeting Schedule',
    status && `Status: ${status}`,
    meetingType && `Type: ${meetingType}`,
    search && `Search: ${search}`
  ].filter(Boolean);

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
          onClick={() =>
            navigate(
              bucket === 'schedule'
                ? '/general/president-secretariat/meetings?tab=schedule'
                : '/general/president-secretariat/meetings'
            )
          }
        >
          Back
        </Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print
        </Button>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center', px: { xs: 1.5, sm: 3 }, '@media print': { px: 0 } }}>
      <Paper
        sx={{
          p: { xs: 2, sm: 3.5 },
          maxWidth: 1100,
          width: '100%',
          backgroundColor: '#fff',
          boxShadow: { xs: 'none', sm: '0 1px 4px rgba(0,0,0,0.12)' },
          border: '1px solid #e0e0e0',
          '@media print': {
            boxShadow: 'none',
            border: 'none',
            maxWidth: '100%',
            p: '14mm 12mm'
          }
        }}
      >
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={700}>
            President Secretariat
          </Typography>
          <Typography variant="subtitle1" fontWeight={600}>
            {bucket === 'schedule'
              ? 'Meeting Schedule'
              : bucket === 'requests'
                ? 'Meeting Requests'
                : 'Meetings List'}
          </Typography>
          {filterBits.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {filterBits.join(' | ')}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Total: {rows.length} meeting{rows.length === 1 ? '' : 's'}
          </Typography>
        </Box>

        <Table
          size="small"
          sx={{
            border: '1px solid #ccc',
            '& th, & td': { border: '1px solid #ccc', py: 0.75 }
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell width="5%">#</TableCell>
              <TableCell>Number</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Time</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Venue</TableCell>
              <TableCell>Chairperson</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  No meetings found
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => (
                <TableRow key={row._id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>{row.meetingNumber}</TableCell>
                  <TableCell>{row.title}</TableCell>
                  <TableCell>
                    {row.meetingDate ? dayjs(row.meetingDate).format('DD MMM YYYY') : '—'}
                  </TableCell>
                  <TableCell>
                    {formatMeetingTimeRange(row.startTime, row.endTime)}
                  </TableCell>
                  <TableCell>{row.meetingType || '—'}</TableCell>
                  <TableCell>{row.venue || '—'}</TableCell>
                  <TableCell>{row.chairperson || '—'}</TableCell>
                  <TableCell>{row.status || '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <Typography variant="caption" color="text.secondary" display="block" mt={2} textAlign="center">
          Printed on {dayjs().format('DD MMM YYYY, hh:mm A')}
        </Typography>
      </Paper>
      </Box>
    </Box>
  );
};

export default MeetingsListPrintView;
