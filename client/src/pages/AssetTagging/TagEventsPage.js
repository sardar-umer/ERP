import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress, Alert, Button, Stack
} from '@mui/material';
import { History as HistoryIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

export default function TagEventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/asset-tagging/events', { params: { limit: 200 } });
      setEvents(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pg = useClientPagination(events);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Stack direction="row" alignItems="center" gap={1}>
          <HistoryIcon color="primary" />
          <Typography variant="h5" fontWeight={700}>Tag events</Typography>
        </Stack>
        <Button startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refresh</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box py={6} textAlign="center"><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell>When</TableCell>
                <TableCell>Event</TableCell>
                <TableCell>Tag</TableCell>
                <TableCell>Asset</TableCell>
                <TableCell>User</TableCell>
                <TableCell>Note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>No events yet.</TableCell></TableRow>
              )}
              {pg.rows.map((ev) => (
                <TableRow key={ev._id}>
                  <TableCell>{new Date(ev.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{ev.eventType?.replace(/_/g, ' ')}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{ev.tagCode || '—'}</TableCell>
                  <TableCell>{ev.asset?.assetNumber} {ev.asset?.name}</TableCell>
                  <TableCell>{ev.user?.firstName} {ev.user?.lastName}</TableCell>
                  <TableCell>{ev.note || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}
    </Box>
  );
}
