import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  InputAdornment,
  Alert,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Search as SearchIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import evaluationTrackingService from '../../services/evaluationTrackingService';
import useClientPagination from '../../hooks/useClientPagination';

dayjs.extend(relativeTime);

const statusColors = {
  sent: 'info',
  submitted: 'primary',
  in_approval: 'warning',
  approved: 'success',
  rejected: 'error',
  completed: 'success'
};

const EvaluationTracking = () => {
  const [tracking, setTracking] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTracking();
  }, []);

  const loadTracking = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await evaluationTrackingService.getAll();
      setTracking(response.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load tracking data');
    } finally {
      setLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    if (!search.trim()) return tracking;
    const term = search.toLowerCase();
    return tracking.filter((item) => {
      const employee = `${item.employeeName || ''}`.toLowerCase();
      const holder = item.currentHolder?.name?.toLowerCase() || '';
      const status = item.status?.toLowerCase() || '';
      return employee.includes(term) || holder.includes(term) || status.includes(term);
    });
  }, [tracking, search]);

  const formatDuration = (date) => {
    if (!date) return '—';
    return dayjs(date).fromNow(true);
  };

  const pg = useClientPagination(filteredData);
  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Evaluation & Appraisal Tracking
          </Typography>
          <Typography color="text.secondary">
            Live view of every evaluation document sent, submitted, and approved.
          </Typography>
        </Box>
        <Chip
          label={`${filteredData.length} Document${filteredData.length !== 1 ? 's' : ''}`}
          color="primary"
        />
      </Box>

      <TextField
        fullWidth
        placeholder="Search by employee, holder, or status..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          )
        }}
        sx={{ mb: 3 }}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          {loading ? (
            <Typography align="center" sx={{ py: 4 }}>
              Loading...
            </Typography>
          ) : filteredData.length === 0 ? (
            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
              No tracking data found
            </Typography>
          ) : (
            <TableContainer component={Paper} elevation={0}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Employee</TableCell>
                    <TableCell>Form Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Current Holder</TableCell>
                    <TableCell>With Holder</TableCell>
                    <TableCell>Last Updated</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pg.rows.map((item) => (
                    <TableRow key={item._id} hover>
                      <TableCell>
                        <Typography fontWeight={600}>{item.employeeName || '—'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.employee?.employeeId || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={item.formType === 'blue_collar' ? 'Blue Collar' : 'White Collar'}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={statusColors[item.status] || 'default'}
                          label={item.status?.replace('_', ' ').toUpperCase()}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {item.currentHolder?.name || 'System'}
                        </Typography>
                        {item.currentHolder?.designation && (
                          <Typography variant="caption" color="text.secondary">
                            {item.currentHolder.designation}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatDuration(item.currentHolder?.receivedAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {dayjs(item.updatedAt).format('DD MMM YYYY, HH:mm')}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="View Timeline">
                          <IconButton
                            size="small"
                            onClick={async () => {
                              try {
                                const response = await evaluationTrackingService.getById(
                                  item.evaluationDocument
                                );
                                console.log(response.data);
                              } catch (_) {
                                setError('Failed to load timeline');
                              }
                            }}
                          >
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>{pg.bar}
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default EvaluationTracking;







































































