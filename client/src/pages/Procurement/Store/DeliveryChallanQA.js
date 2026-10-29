import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Alert, CircularProgress, Chip, Stack, Tabs, Tab
} from '@mui/material';
import {
  FactCheck as QaIcon, Refresh as RefreshIcon, Visibility as ViewIcon
} from '@mui/icons-material';
import api from '../../../services/api';
import { formatDate } from '../../../utils/dateUtils';

const TAB = { pending: 'qa_pending', passed: 'qa_passed', failed: 'qa_failed' };

const statusChipColor = (s) => {
  if (s === 'qa_passed') return 'success';
  if (s === 'qa_pending') return 'warning';
  if (s === 'qa_failed') return 'error';
  if (s === 'closed') return 'default';
  return 'default';
};

export default function DeliveryChallanQA() {
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(250);
  const [totalItems, setTotalItems] = useState(0);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewDoc, setViewDoc] = useState(null);

  const [qaOpen, setQaOpen] = useState(false);
  const [qaRow, setQaRow] = useState(null);
  const [qaChoice, setQaChoice] = useState('passed');
  const [qaRemarks, setQaRemarks] = useState('');
  const [qaSubmitting, setQaSubmitting] = useState(false);

  const statusForApi = TAB[tab] || TAB.pending;

  const loadList = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/procurement/delivery-challans', {
        params: { page: page + 1, limit: rowsPerPage, status: statusForApi }
      });
      if (res.data?.success) {
        setRows(res.data.data?.items || []);
        setTotalItems(res.data.data?.pagination?.totalItems || 0);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load delivery challans');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, statusForApi]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    setPage(0);
  }, [tab]);

  const submitQa = async () => {
    if (!qaRow?._id) return;
    try {
      setQaSubmitting(true);
      setError('');
      const res = await api.patch(`/procurement/delivery-challans/${qaRow._id}/qa`, {
        qaStatus: qaChoice,
        qaRemarks: qaRemarks.trim()
      });
      if (!res.data?.success) {
        setError(res.data?.message || 'QA update failed');
        return;
      }
      setSuccess(`QA ${qaChoice === 'passed' ? 'passed' : 'failed'} for ${qaRow.dcNumber || qaRow._id}`);
      setQaOpen(false);
      setQaRow(null);
      loadList();
    } catch (e) {
      setError(e.response?.data?.message || 'QA update failed');
    } finally {
      setQaSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <QaIcon color="primary" />
            <Box>
              <Typography variant="h5" fontWeight="bold">QA — delivery challans</Typography>
              <Typography variant="body2" color="text.secondary">
                Review challans created by store (full-advance POs). Pass or fail QA here; store posts GRN only after QA passes.
              </Typography>
            </Box>
          </Stack>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadList} disabled={loading}>
            Refresh
          </Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab label="Pending QA" value="pending" />
          <Tab label="Passed" value="passed" />
          <Tab label="Failed" value="failed" />
        </Tabs>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>DC #</TableCell>
              <TableCell>Gate pass</TableCell>
              <TableCell>PO</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>QA</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={28} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center">No challans in this list</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r._id} hover>
                  <TableCell><Typography fontWeight="bold">{r.dcNumber}</Typography></TableCell>
                  <TableCell><Typography variant="body2">{r.gatePassNo || '—'}</Typography></TableCell>
                  <TableCell>
                    {r.purchaseOrder?.orderNumber || '—'}
                    <Typography variant="caption" display="block" color="text.secondary">{r.purchaseOrder?._id}</Typography>
                  </TableCell>
                  <TableCell><Chip size="small" label={r.status} color={statusChipColor(r.status)} /></TableCell>
                  <TableCell><Chip size="small" variant="outlined" label={r.qaStatus || '—'} /></TableCell>
                  <TableCell>{formatDate(r.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      startIcon={<ViewIcon />}
                      onClick={async () => {
                        try {
                          const res = await api.get(`/procurement/delivery-challans/${r._id}`);
                          if (res.data?.success) {
                            setViewDoc(res.data.data);
                            setViewOpen(true);
                          }
                        } catch (e) {
                          setError(e.response?.data?.message || 'Load failed');
                        }
                      }}
                    >
                      View
                    </Button>
                    {r.status === 'qa_pending' && tab === 'pending' && (
                      <Button
                        size="small"
                        startIcon={<QaIcon />}
                        sx={{ ml: 1 }}
                        variant="contained"
                        color="primary"
                        onClick={() => {
                          setQaRow(r);
                          setQaChoice('passed');
                          setQaRemarks('');
                          setQaOpen(true);
                        }}
                      >
                        QA decision
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={totalItems}
          page={page}
          onPageChange={(e, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[25, 50, 100, 250, 500]}
        />
      </TableContainer>

      <Dialog open={viewOpen} onClose={() => setViewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Delivery challan {viewDoc?.dcNumber}</DialogTitle>
        <DialogContent dividers>
          {viewDoc && (
            <Stack spacing={1}>
              <Typography variant="body2"><strong>PO:</strong> {viewDoc.purchaseOrder?.orderNumber || viewDoc.purchaseOrder?._id}</Typography>
              <Typography variant="body2"><strong>Gate pass:</strong> {viewDoc.gatePassNo || '—'}</Typography>
              <Typography variant="body2"><strong>Status:</strong> {viewDoc.status}</Typography>
              <Typography variant="body2"><strong>QA:</strong> {viewDoc.qaStatus} {viewDoc.qaRemarks ? `— ${viewDoc.qaRemarks}` : ''}</Typography>
              <Typography variant="subtitle2" sx={{ mt: 1 }}>Lines</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Qty</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(viewDoc.items || []).map((it, i) => (
                    <TableRow key={it._id || i}>
                      <TableCell>{(it.poLineIndex ?? i) + 1}</TableCell>
                      <TableCell>{it.itemName || it.description || '—'}</TableCell>
                      <TableCell align="right">{it.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={qaOpen} onClose={() => !qaSubmitting && setQaOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>QA — {qaRow?.dcNumber}</DialogTitle>
        <DialogContent dividers>
          <TextField
            select
            fullWidth
            label="Decision"
            value={qaChoice}
            onChange={(e) => setQaChoice(e.target.value)}
            sx={{ mb: 2, mt: 0.5 }}
          >
            <MenuItem value="passed">Pass QA</MenuItem>
            <MenuItem value="failed">Fail QA</MenuItem>
          </TextField>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Remarks"
            value={qaRemarks}
            onChange={(e) => setQaRemarks(e.target.value)}
            placeholder={qaChoice === 'failed' ? 'Reason for failure (recommended)' : 'Optional notes'}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQaOpen(false)} disabled={qaSubmitting}>Cancel</Button>
          <Button variant="contained" onClick={submitQa} disabled={qaSubmitting}>
            {qaSubmitting ? 'Saving…' : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
