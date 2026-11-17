import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  FormControl,
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
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { authService } from '../../services/authService';
import { getImageUrl, handleImageError } from '../../utils/imageService';
import { useAuth } from '../../contexts/AuthContext';
import useClientPagination from '../../hooks/useClientPagination';

const OnlineUsers = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [rows, setRows] = useState([]);

  const loadOnline = async (opts = {}) => {
    try {
      if (!opts.silent) setLoading(true);
      const res = await authService.getOnlineUsers({
        search,
        department
      });
      const users = res?.data?.data?.users || [];
      setRows(users);
      setError('');
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to load online users');
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadOnline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, department]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return undefined;
    const baseURL =
      process.env.NODE_ENV === 'production'
        ? window.location.origin
        : (process.env.REACT_APP_API_URL || 'http://localhost:5001/api').replace(/\/api\/?$/, '');
    const socket = io(baseURL, {
      path: '/socket-notifications',
      transports: ['websocket', 'polling'],
      auth: { token }
    });
    const onPresence = () => {
      loadOnline({ silent: true });
    };
    socket.on('presence:changed', onPresence);
    return () => {
      socket.off('presence:changed', onPresence);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const departments = useMemo(() => {
    const set = new Set(rows.map((r) => r.department).filter(Boolean));
    return [...set].sort();
  }, [rows]);

  const pg = useClientPagination(rows);
  if (user?.role !== 'super_admin' && user?.role !== 'developer' && user?.role !== 'admin') {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Access denied. Admin privileges required.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Online Users</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          Currently online: {rows.length}
        </Typography>
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      ) : null}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            size="small"
            label="Search"
            placeholder="Name, email, employee id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 260 }}
          />
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Department</InputLabel>
            <Select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              label="Department"
            >
              <MenuItem value="">All Departments</MenuItem>
              {departments.map((d) => (
                <MenuItem key={d} value={d}>{d}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      <Paper>
        {loading ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <CircularProgress />
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Employee ID</TableCell>
                  <TableCell>Department</TableCell>
                  <TableCell>Position</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        No users online right now.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  pg.rows.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <Stack direction="row" spacing={1.25} alignItems="center">
                          <Avatar
                            src={getImageUrl(u.profileImage)}
                            onError={handleImageError}
                            sx={{ width: 34, height: 34 }}
                          >
                            {(u.firstName || '?')[0]}
                          </Avatar>
                          <Typography variant="body2">
                            {u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim()}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>{u.email || '—'}</TableCell>
                      <TableCell>{u.employeeId || '—'}</TableCell>
                      <TableCell>{u.department || '—'}</TableCell>
                      <TableCell>{u.position || '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" color="success" label="Online" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
};

export default OnlineUsers;
