import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Paper, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Alert, CircularProgress, Chip, Grid, Stack
} from '@mui/material';
import {
  Assignment as DcIcon, Add as AddIcon, Refresh as RefreshIcon,
  Visibility as ViewIcon
} from '@mui/icons-material';
import api from '../../../services/api';
import { getDocCompanyName } from '../../../utils/documentCompany';
import { formatDate } from '../../../utils/dateUtils';

const statusColor = (s) => {
  if (s === 'qa_passed') return 'success';
  if (s === 'qa_pending') return 'warning';
  if (s === 'qa_failed') return 'error';
  if (s === 'closed') return 'default';
  return 'default';
};

export default function DeliveryChallans() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPo = searchParams.get('purchaseOrder') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(250);
  const [totalItems, setTotalItems] = useState(0);
  const [poFilter, setPoFilter] = useState(initialPo);
  const [statusFilter, setStatusFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [qaPassedPOs, setQaPassedPOs] = useState([]);
  const [qaPassedLoading, setQaPassedLoading] = useState(false);
  const [createPoId, setCreatePoId] = useState('');
  const [createLines, setCreateLines] = useState([]);
  const [vendorDcRef, setVendorDcRef] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [poGateMsg, setPoGateMsg] = useState('');

  const [viewOpen, setViewOpen] = useState(false);
  const [viewDoc, setViewDoc] = useState(null);

  const loadList = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        ...(poFilter.trim() ? { purchaseOrder: poFilter.trim() } : {}),
        ...(statusFilter ? { status: statusFilter } : {})
      };
      const res = await api.get('/procurement/delivery-challans', { params });
      if (res.data?.success) {
        setRows(res.data.data?.items || []);
        setTotalItems(res.data.data?.pagination?.totalItems || 0);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load delivery challans');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, poFilter, statusFilter]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const applyFilter = () => {
    const next = new URLSearchParams(searchParams);
    if (poFilter.trim()) next.set('purchaseOrder', poFilter.trim());
    else next.delete('purchaseOrder');
    setSearchParams(next);
    setPage(0);
  };

  useEffect(() => {
    const q = searchParams.get('purchaseOrder') || '';
    setPoFilter(q);
  }, [searchParams]);

  const openCreate = () => {
    setError('');
    setSuccess('');
    setCreatePoId('');
    setCreateLines([]);
    setVendorDcRef('');
    setPoGateMsg('');
    setCreateOpen(true);
  };

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    (async () => {
      try {
        setQaPassedLoading(true);
        const res = await api.get('/procurement/store/purchase-orders-for-dc-create');
        if (!cancelled && res.data?.success && res.data?.data?.purchaseOrders) {
          setQaPassedPOs(res.data.data.purchaseOrders);
        }
      } catch (_) {
        if (!cancelled) setQaPassedPOs([]);
      } finally {
        if (!cancelled) setQaPassedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [createOpen]);

  const loadPoForCreate = useCallback(async (poId) => {
    setCreatePoId(poId);
    setCreateLines([]);
    setPoGateMsg('');
    if (!poId) return;
    try {
      const res = await api.get(`/procurement/purchase-orders/${poId}`);
      const po = res.data?.data;
      if (!po) {
        setPoGateMsg('PO not found');
        return;
      }
      const msgs = [];
      if (po.grnRequiresDeliveryChallan !== true) {
        const e = po.grnDcEligibility;
        if (po.grnRequiresDeliveryChallan === undefined && !e) {
          msgs.push('Server did not return delivery-challan flags — refresh the page or restart the API.');
        } else if (e?.note) {
          msgs.push(e.note);
        } else {
          msgs.push('Delivery challans are only for full-advance POs (check payment terms).');
        }
      }
      if (po.dcCreationAllowedByStatus === false && po.dcCreationBlockedReason) {
        msgs.push(po.dcCreationBlockedReason);
      }
      if (msgs.length) {
        setPoGateMsg(msgs.join(' '));
        return;
      }
      const items = po.items || [];
      const lines = items.map((it, idx) => {
        const ordered = Number(it.quantity) || 0;
        const received = Number(it.receivedQuantity) || 0;
        const remaining = Math.max(0, Math.round((ordered - received) * 100) / 100);
        return {
          poLineIndex: idx,
          description: it.description || '—',
          unit: it.unit || '',
          remaining,
          qty: remaining > 0 ? remaining : 0
        };
      });
      setCreateLines(lines);
    } catch (e) {
      setPoGateMsg(e.response?.data?.message || 'Failed to load PO');
    }
  }, []);

  /** Store Dashboard links here with ?purchaseOrder=&openCreate=1 to jump straight into create DC. */
  useEffect(() => {
    if (searchParams.get('openCreate') !== '1') return;
    const poId = (searchParams.get('purchaseOrder') || '').trim();
    const next = new URLSearchParams(searchParams);
    next.delete('openCreate');
    if (!poId) {
      setSearchParams(next, { replace: true });
      return;
    }

    setError('');
    setSuccess('');
    setVendorDcRef('');
    setPoGateMsg('');
    setCreateOpen(true);
    loadPoForCreate(poId);

    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, loadPoForCreate]);

  const updateCreateLineQty = (idx, val) => {
    const n = Number(val);
    setCreateLines((prev) => {
      const next = [...prev];
      const cap = next[idx].remaining;
      next[idx] = { ...next[idx], qty: Math.min(Math.max(0, n || 0), cap) };
      return next;
    });
  };

  const submitCreate = async () => {
    if (!createPoId) {
      setError('Select a purchase order');
      return;
    }
    if (poGateMsg) return;
    const items = createLines
      .filter((l) => (Number(l.qty) || 0) > 0)
      .map((l) => ({ poLineIndex: l.poLineIndex, quantity: Number(l.qty) }));
    if (items.length === 0) {
      setError('Enter quantity on at least one line');
      return;
    }
    try {
      setCreateSubmitting(true);
      setError('');
      const res = await api.post('/procurement/delivery-challans', {
        purchaseOrder: createPoId,
        vendorDcReference: vendorDcRef.trim() || undefined,
        items
      });
      if (!res.data?.success) {
        setError(res.data?.message || 'Create failed');
        return;
      }
      const gp = res.data.data?.gatePassNo;
      setSuccess(
        gp
          ? `Created ${res.data.data?.dcNumber || 'delivery challan'} · Gate pass ${gp}`
          : `Created ${res.data.data?.dcNumber || 'delivery challan'}`
      );
      setCreateOpen(false);
      loadList();
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.errors?.[0]?.msg || 'Create failed');
    } finally {
      setCreateSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <DcIcon color="primary" />
            <Box>
              <Typography variant="h5" fontWeight="bold">Delivery challans</Typography>
              <Typography variant="body2" color="text.secondary">
                Full-advance POs: create delivery challans here. DC QA (pass/fail) is done in Store → <strong>QA (delivery challans)</strong>; then post GRN against a QA-passed challan.
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadList}>Refresh</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New delivery challan</Button>
            <Button component={RouterLink} to="/procurement/store/goods-receive" variant="outlined">GRN</Button>
          </Stack>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              label="Filter by PO id"
              value={poFilter}
              onChange={(e) => setPoFilter(e.target.value)}
              placeholder="MongoDB id of purchase order"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="qa_pending">QA pending</MenuItem>
              <MenuItem value="qa_passed">QA passed</MenuItem>
              <MenuItem value="qa_failed">QA failed</MenuItem>
              <MenuItem value="closed">Closed</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <Button variant="contained" onClick={applyFilter}>Apply</Button>
          </Grid>
        </Grid>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>DC #</TableCell>
              <TableCell>Company</TableCell>
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
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={28} /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center">No delivery challans</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r._id} hover>
                  <TableCell><Typography fontWeight="bold">{r.dcNumber}</Typography></TableCell>
                  <TableCell>{getDocCompanyName(r)}</TableCell>
                  <TableCell><Typography variant="body2">{r.gatePassNo || '—'}</Typography></TableCell>
                  <TableCell>
                    {r.purchaseOrder?.orderNumber || '—'}
                    <Typography variant="caption" display="block" color="text.secondary">{r.purchaseOrder?._id}</Typography>
                  </TableCell>
                  <TableCell><Chip size="small" label={r.status} color={statusColor(r.status)} /></TableCell>
                  <TableCell><Chip size="small" variant="outlined" label={r.qaStatus || '—'} /></TableCell>
                  <TableCell>{formatDate(r.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" startIcon={<ViewIcon />} onClick={async () => {
                      try {
                        const res = await api.get(`/procurement/delivery-challans/${r._id}`);
                        if (res.data?.success) {
                          setViewDoc(res.data.data);
                          setViewOpen(true);
                        }
                      } catch (e) {
                        setError(e.response?.data?.message || 'Load failed');
                      }
                    }}>View</Button>
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

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>New delivery challan</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                select
                label="Purchase order (store QA passed)"
                value={createPoId}
                onChange={(e) => loadPoForCreate(e.target.value)}
                disabled={qaPassedLoading}
                helperText="Choose a full-advance PO that is still open for new challans."
              >
                <MenuItem value="">Select PO</MenuItem>
                {qaPassedPOs.map((po) => (
                  <MenuItem key={po._id} value={po._id}>
                    {po.orderNumber || po._id} — {po.vendor?.name || 'Vendor'}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            {poGateMsg && (
              <Grid item xs={12}><Alert severity="warning">{poGateMsg}</Alert></Grid>
            )}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Vendor DC reference (optional)"
                value={vendorDcRef}
                onChange={(e) => setVendorDcRef(e.target.value)}
              />
            </Grid>
            {createLines.length > 0 && !poGateMsg && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Quantities per PO line</Typography>
                <TableContainer>
                  <Table size="small" variant="outlined">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Unit</TableCell>
                        <TableCell align="right">Max</TableCell>
                        <TableCell align="right">Qty on DC</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {createLines.map((line, i) => (
                        <TableRow key={line.poLineIndex}>
                          <TableCell>{line.poLineIndex + 1}</TableCell>
                          <TableCell>{line.description}</TableCell>
                          <TableCell>{line.unit}</TableCell>
                          <TableCell align="right">{line.remaining}</TableCell>
                          <TableCell align="right" width={120}>
                            <TextField
                              size="small"
                              type="number"
                              value={line.qty}
                              onChange={(e) => updateCreateLineQty(i, e.target.value)}
                              inputProps={{ min: 0, max: line.remaining, step: 0.01 }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submitCreate} disabled={createSubmitting || !!poGateMsg || !createPoId}>
            {createSubmitting ? <CircularProgress size={22} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={viewOpen} onClose={() => setViewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{viewDoc?.dcNumber}</DialogTitle>
        <DialogContent dividers>
          {viewDoc && (
            <Stack spacing={1}>
              <Typography variant="body2"><strong>Company:</strong> {getDocCompanyName(viewDoc)}</Typography>
              <Typography variant="body2"><strong>PO:</strong> {viewDoc.purchaseOrder?.orderNumber || '—'}</Typography>
              <Typography variant="body2"><strong>Gate pass:</strong> {viewDoc.gatePassNo || '—'}</Typography>
              <Typography variant="body2"><strong>Status:</strong> {viewDoc.status}</Typography>
              <Typography variant="body2"><strong>QA:</strong> {viewDoc.qaStatus} {viewDoc.qaRemarks ? `— ${viewDoc.qaRemarks}` : ''}</Typography>
              <Typography variant="body2"><strong>Vendor ref:</strong> {viewDoc.vendorDcReference || '—'}</Typography>
              <Table size="small" sx={{ mt: 2 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Line</TableCell>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Received</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(viewDoc.items || []).map((it) => (
                    <TableRow key={it._id || it.poLineIndex}>
                      <TableCell>{(it.poLineIndex ?? 0) + 1}</TableCell>
                      <TableCell>{it.itemName}</TableCell>
                      <TableCell align="right">{it.quantity}</TableCell>
                      <TableCell align="right">{it.quantityReceived ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {viewDoc.grnIds?.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Linked GRNs: {(viewDoc.grnIds || []).map((g) => g.receiveNumber || g._id).join(', ')}
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setViewOpen(false)}>Close</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
