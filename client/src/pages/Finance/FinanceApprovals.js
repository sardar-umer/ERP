import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import {
  CheckCircle as ApproveIcon,
  OpenInNew as OpenIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Undo as ReturnIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { formatPKR } from '../../utils/currency';
import { formatDate } from '../../utils/dateUtils';

const rowKey = (item) => `${item.type}:${item.id}`;

/**
 * Finance → Approvals: everything waiting on the logged-in user's finance authority signature
 * (Accounts Officer / AM, Sr Manager Accounts, GM Finance) across bill payments, cash approvals,
 * vendor advances, payroll and manual salary payments, and manual journal vouchers.
 * Approve / Return call each document's own endpoint, the same as the voucher page.
 */
const FinanceApprovals = () => {
  const navigate = useNavigate();
  const [data, setData] = useState({ items: [], counts: {}, types: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { mode: 'approve' | 'return', items: [] }
  const [comments, setComments] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/finance/my-approvals');
      setData(res?.data?.data || { items: [], counts: {}, types: [] });
      setSelected(new Set());
    } catch (e) {
      setError(e?.response?.data?.message || 'Could not load your approvals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.items.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (!q) return true;
      return [item.number, item.party, item.detail, item.voucherNumber, item.typeLabel, item.createdBy]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [data.items, typeFilter, search]);

  useEffect(() => { setPage(0); }, [typeFilter, search]);

  const pageRows = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const selectedItems = data.items.filter((item) => selected.has(rowKey(item)));
  const selectedTotal = selectedItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((item) => selected.has(rowKey(item)));

  const toggle = (item) => setSelected((prev) => {
    const next = new Set(prev);
    const key = rowKey(item);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const togglePage = () => setSelected((prev) => {
    const next = new Set(prev);
    pageRows.forEach((item) => (allOnPageSelected ? next.delete(rowKey(item)) : next.add(rowKey(item))));
    return next;
  });

  const openItem = (item) => {
    if (item.voucherId) navigate(`/finance/vouchers/${item.voucherId}`);
    else if (item.openUrl) navigate(item.openUrl);
  };

  const runAction = async () => {
    if (!confirm) return;
    const { mode, items } = confirm;
    const text = comments.trim();
    if (mode === 'return' && !text) return;
    setBusy(true);
    let ok = 0;
    const failures = [];
    // One at a time: each approval may post a voucher to the ledger
    for (const item of items) {
      try {
        await api.put(mode === 'approve' ? item.approveUrl : item.rejectUrl, {
          comments: text || 'Approved from Finance Approvals'
        });
        ok += 1;
      } catch (e) {
        failures.push(`${item.typeLabel} ${item.number || item.voucherNumber}: ${e?.response?.data?.message || 'failed'}`);
      }
    }
    setBusy(false);
    setConfirm(null);
    setComments('');
    const verb = mode === 'approve' ? 'approved' : 'returned';
    setMessage({
      severity: failures.length ? (ok ? 'warning' : 'error') : 'success',
      text: `${ok} of ${items.length} ${verb}.${failures.length ? ` Not done: ${failures.join('; ')}` : ''}`
    });
    load();
  };

  const totalPending = data.items.length;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} mb={2}>
        <Box>
          <Typography variant="h5" fontWeight={600}>Approvals</Typography>
          <Typography variant="body2" color="text.secondary">
            Documents waiting for your signature as a finance authority. Approving here is the same as approving on the voucher.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading || busy}>Refresh</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {message && <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={2}>
        <Chip
          label={`All (${totalPending})`}
          color={typeFilter === 'all' ? 'primary' : 'default'}
          variant={typeFilter === 'all' ? 'filled' : 'outlined'}
          onClick={() => setTypeFilter('all')}
        />
        {data.types.filter((t) => data.counts[t.type]).map((t) => (
          <Chip
            key={t.type}
            label={`${t.label} (${data.counts[t.type]})`}
            color={typeFilter === t.type ? 'primary' : 'default'}
            variant={typeFilter === t.type ? 'filled' : 'outlined'}
            onClick={() => setTypeFilter(t.type)}
          />
        ))}
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} mb={1.5}>
        <TextField
          size="small"
          placeholder="Search number, vendor, voucher…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: { md: 320 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <Box sx={{ flex: 1 }} />
        {selectedItems.length > 0 && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2">
              {selectedItems.length} selected · {formatPKR(selectedTotal)}
            </Typography>
            <Button size="small" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<ApproveIcon />}
              disabled={busy}
              onClick={() => setConfirm({ mode: 'approve', items: selectedItems })}
            >
              Approve selected
            </Button>
          </Stack>
        )}
      </Stack>

      <Paper variant="outlined">
        {loading ? (
          <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress size={28} /></Box>
        ) : !filtered.length ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">
              {totalPending ? 'Nothing matches your search.' : 'Nothing is waiting for your approval.'}
            </Typography>
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={allOnPageSelected} onChange={togglePage} inputProps={{ 'aria-label': 'Select all on this page' }} />
                    </TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Number</TableCell>
                    <TableCell>Vendor / Company</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Voucher</TableCell>
                    <TableCell>Signatures</TableCell>
                    <TableCell>Your role</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageRows.map((item) => (
                    <TableRow key={rowKey(item)} hover selected={selected.has(rowKey(item))}>
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={selected.has(rowKey(item))} onChange={() => toggle(item)} inputProps={{ 'aria-label': `Select ${item.number || item.voucherNumber}` }} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.typeLabel}</TableCell>
                      <TableCell sx={{ maxWidth: 180 }}>
                        <Typography variant="body2" fontWeight={500} noWrap title={item.number}>{item.number || '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Typography variant="body2" noWrap title={item.party}>{item.party || '—'}</Typography>
                        {item.detail && (
                          <Typography variant="caption" color="text.secondary" noWrap component="div" title={item.detail}>{item.detail}</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatPKR(item.amount)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.voucherNumber || '—'}</TableCell>
                      <TableCell>
                        <Tooltip
                          title={item.signed.length
                            ? item.signed.map((s) => `${s.label}: ${s.by || '—'}${s.at ? ` (${formatDate(s.at)})` : ''}`).join(' · ')
                            : 'No one has signed yet'}
                        >
                          <Chip size="small" variant="outlined" label={`${item.signaturesDone} of ${item.signaturesRequired}`} />
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.mySlots.join(', ')}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.date ? formatDate(item.date) : '—'}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Open voucher">
                          <span>
                            <IconButton size="small" onClick={() => openItem(item)} disabled={!item.voucherId && !item.openUrl} aria-label="Open voucher">
                              <OpenIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Approve">
                          <IconButton size="small" color="success" disabled={busy} onClick={() => setConfirm({ mode: 'approve', items: [item] })} aria-label="Approve">
                            <ApproveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Return with observation">
                          <IconButton size="small" color="error" disabled={busy} onClick={() => setConfirm({ mode: 'return', items: [item] })} aria-label="Return">
                            <ReturnIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={filtered.length}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
              rowsPerPageOptions={[25, 50, 100]}
            />
          </>
        )}
      </Paper>

      <Dialog open={Boolean(confirm)} onClose={() => !busy && setConfirm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {confirm?.mode === 'return' ? 'Return with observation' : `Approve ${confirm?.items.length === 1 ? 'document' : `${confirm?.items.length} documents`}`}
        </DialogTitle>
        <DialogContent>
          {confirm?.items.length === 1 ? (
            <Typography variant="body2" sx={{ mb: 2 }}>
              {confirm.items[0].typeLabel} {confirm.items[0].number || confirm.items[0].voucherNumber}
              {confirm.items[0].party ? ` · ${confirm.items[0].party}` : ''} · {formatPKR(confirm.items[0].amount)}
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ mb: 2 }}>
              {confirm?.items.length} documents · {formatPKR((confirm?.items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0))}
            </Typography>
          )}
          {confirm?.mode === 'return' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Returning rejects the document and cancels its draft voucher, the same as rejecting on the voucher page.
            </Alert>
          )}
          <TextField
            fullWidth
            multiline
            minRows={2}
            label={confirm?.mode === 'return' ? 'Observation (required)' : 'Comments (optional)'}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setConfirm(null); setComments(''); }} disabled={busy}>Cancel</Button>
          <Button
            variant="contained"
            color={confirm?.mode === 'return' ? 'error' : 'success'}
            disabled={busy || (confirm?.mode === 'return' && !comments.trim())}
            onClick={runAction}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {confirm?.mode === 'return' ? 'Return' : 'Approve'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default FinanceApprovals;
