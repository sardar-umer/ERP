import React, { useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Alert
} from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import ChatService from '../../services/chatService';
import useClientPagination from '../../hooks/useClientPagination';

const adminRoles = new Set(['super_admin', 'admin', 'developer']);

const ChatModerationPage = () => {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const allowed = adminRoles.has(user?.role);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setErr('');
    try {
      const list = await ChatService.adminSearchMessages(q.trim(), 40);
      setRows(list);
    } catch (e) {
      setErr(e.response?.data?.message || e.message || 'Request failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const forceDelete = async (id) => {
    if (!window.confirm('Permanently delete this message?')) return;
    try {
      await ChatService.adminForceDeleteMessage(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setErr(e.response?.data?.message || e.message || 'Delete failed');
    }
  };

  const pg = useClientPagination(rows);
  if (!allowed) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">You need administrator access to use chat moderation.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Chat moderation
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Search message bodies across all conversations. Force-delete removes the row permanently (use for policy violations).
      </Typography>
      {err && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>
          {err}
        </Alert>
      )}
      <Paper sx={{ p: 2, mb: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search text in messages…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <Button variant="contained" onClick={search} disabled={loading || !q.trim()}>
          Search
        </Button>
      </Paper>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>When</TableCell>
            <TableCell>Sender</TableCell>
            <TableCell>Conversation</TableCell>
            <TableCell>Snippet</TableCell>
            <TableCell align="right">Action</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pg.rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}</TableCell>
              <TableCell>{r.sender?.name || r.sender?.id || '—'}</TableCell>
              <TableCell>{r.conversation}</TableCell>
              <TableCell sx={{ maxWidth: 360 }}>{r.body}</TableCell>
              <TableCell align="right">
                <Button color="error" size="small" onClick={() => forceDelete(r.id)}>
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>{pg.bar}
    </Box>
  );
};

export default ChatModerationPage;
