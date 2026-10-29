import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, IconButton,
  InputAdornment, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination,
  TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PrintIcon from '@mui/icons-material/Print';
import VisibilityIcon from '@mui/icons-material/Visibility';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import storeService from '../../../services/storeService';
import { formatDate } from '../../../utils/dateUtils';
import { formatPKR } from '../../../utils/currency';

const EMPTY_FORM = {
  transferDate: new Date().toISOString().slice(0, 10),
  fromStore: '', fromProject: '', toStore: '', toProject: '',
  reason: '', sentByName: '', receivedByName: '', vehicleNumber: '',
  lines: [{ inventoryItem: null, quantity: '' }]
};

const personName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '');

/** Route chip: "Store / Project → Store / Project" */
const TransferRoute = ({ t }) => (
  <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap">
    <Typography variant="body2">{t.fromStoreSnapshot} / {t.fromProject?.name || '—'}</Typography>
    <ArrowForwardIcon fontSize="small" color="primary" />
    <Typography variant="body2" fontWeight={600}>{t.toStoreSnapshot} / {t.toProject?.name || '—'}</Typography>
  </Stack>
);

const TransferNoteView = ({ t }) => (
  <Box className="stn-print">
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
      <Box>
        <Typography variant="h6" fontWeight={700}>Stock Transfer Note</Typography>
        <Typography variant="body2" color="text.secondary">{t.transferNumber} · {formatDate(t.transferDate)}</Typography>
      </Box>
      <Chip label={t.status || 'Completed'} color="success" size="small" />
    </Stack>
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={6}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">FROM</Typography>
          <Typography fontWeight={600}>{t.fromStoreSnapshot}</Typography>
          <Typography variant="body2">{t.fromProject?.name}</Typography>
        </Paper>
      </Grid>
      <Grid item xs={6}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">TO</Typography>
          <Typography fontWeight={600}>{t.toStoreSnapshot}</Typography>
          <Typography variant="body2">{t.toProject?.name}</Typography>
        </Paper>
      </Grid>
    </Grid>
    <Table size="small" sx={{ mb: 2 }}>
      <TableHead>
        <TableRow>
          <TableCell>#</TableCell>
          <TableCell>Item Code</TableCell>
          <TableCell>Item</TableCell>
          <TableCell align="right">Quantity</TableCell>
          <TableCell align="right">Unit Cost</TableCell>
          <TableCell align="right">Value</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {(t.items || []).map((it, i) => (
          <TableRow key={`${it.inventoryItem}-${i}`}>
            <TableCell>{i + 1}</TableCell>
            <TableCell>{it.itemCode}</TableCell>
            <TableCell>{it.itemName}</TableCell>
            <TableCell align="right">{it.quantity} {it.unit}</TableCell>
            <TableCell align="right">{formatPKR(it.unitCost)}</TableCell>
            <TableCell align="right">{formatPKR((Number(it.quantity) || 0) * (Number(it.unitCost) || 0))}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Total</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>{t.totalQuantity}</TableCell>
          <TableCell />
          <TableCell align="right" sx={{ fontWeight: 700 }}>{formatPKR(t.totalValue)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <Typography variant="body2" sx={{ mb: 0.5 }}><strong>Reason:</strong> {t.reason}</Typography>
    {t.vehicleNumber && <Typography variant="body2" sx={{ mb: 0.5 }}><strong>Vehicle:</strong> {t.vehicleNumber}</Typography>}
    <Grid container spacing={4} sx={{ mt: 4 }}>
      {[['Prepared by', personName(t.createdBy)], ['Sent by', t.sentByName], ['Received by', t.receivedByName]].map(([label, name]) => (
        <Grid item xs={4} key={label}>
          <Divider sx={{ mb: 0.5 }} />
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="body2">{name || ' '}</Typography>
        </Grid>
      ))}
    </Grid>
  </Box>
);

const StockTransfers = () => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(250);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [stores, setStores] = useState([]);
  const [projects, setProjects] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [sourceStock, setSourceStock] = useState([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/procurement/stock-transfers', { params: { page: page + 1, limit: rowsPerPage, search: search || undefined } });
      setRows(res.data?.data?.transfers || []);
      setTotal(res.data?.data?.pagination?.total || 0);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load stock transfers');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    storeService.getStores({ activeOnly: 'true' }).then((r) => setStores(r?.data || [])).catch(() => setStores([]));
    api.get('/finance/fixed-assets/projects')
      .then((r) => setProjects(r.data?.data || []))
      .catch(() => api.get('/projects').then((r) => setProjects(Array.isArray(r.data?.data) ? r.data.data : [])).catch(() => setProjects([])));
  }, []);

  // What the source store / project actually holds
  useEffect(() => {
    if (!formOpen || !form.fromStore || !form.fromProject) { setSourceStock([]); return; }
    let cancelled = false;
    setLoadingStock(true);
    api.get('/procurement/stock-balance', { params: { storeId: form.fromStore, project: form.fromProject } })
      .then((r) => { if (!cancelled) setSourceStock((r.data?.data?.balances || []).filter((b) => b.balance > 0)); })
      .catch(() => { if (!cancelled) setSourceStock([]); })
      .finally(() => { if (!cancelled) setLoadingStock(false); });
    return () => { cancelled = true; };
  }, [formOpen, form.fromStore, form.fromProject]);

  const balanceOf = (itemId) => sourceStock.find((b) => String(b.item) === String(itemId))?.balance || 0;
  const sameRoute = form.fromStore && form.fromStore === form.toStore && form.fromProject && form.fromProject === form.toProject;
  const overLines = form.lines.filter((l) => l.inventoryItem && Number(l.quantity) > balanceOf(l.inventoryItem.item));
  const validLines = form.lines.filter((l) => l.inventoryItem && Number(l.quantity) > 0);
  const canSave = !saving && form.fromStore && form.fromProject && form.toStore && form.toProject && !sameRoute
    && form.reason.trim() && validLines.length > 0 && overLines.length === 0;

  const setField = (key) => (e) => {
    const value = e.target.value;
    // Changing the source empties the lines: the items and balances belong to the old source
    setForm((f) => ({ ...f, [key]: value, ...(key === 'fromStore' || key === 'fromProject' ? { lines: [{ inventoryItem: null, quantity: '' }] } : {}) }));
  };
  const setLine = (idx, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.post('/procurement/stock-transfers', {
        transferDate: form.transferDate, fromStore: form.fromStore, fromProject: form.fromProject,
        toStore: form.toStore, toProject: form.toProject, reason: form.reason,
        sentByName: form.sentByName, receivedByName: form.receivedByName, vehicleNumber: form.vehicleNumber,
        items: validLines.map((l) => ({ inventoryItem: l.inventoryItem.item, quantity: Number(l.quantity) }))
      });
      toast.success(res.data?.message || 'Transfer posted');
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setViewing(res.data?.data || null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to post transfer');
    } finally {
      setSaving(false);
    }
  };

  const storeOptions = useMemo(() => stores.map((s) => ({ id: s._id, label: s.type === 'sub' ? `↳ ${s.name}` : s.name })), [stores]);
  const usedItemIds = new Set(form.lines.map((l) => String(l.inventoryItem?.item || '')));

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Stock Transfers</Typography>
          <Typography variant="body2" color="text.secondary">Move stock between stores and projects. The item total and its accounts stay the same.</Typography>
        </Box>
        <Button variant="contained" startIcon={<SwapHorizIcon />} onClick={() => { setForm(EMPTY_FORM); setFormOpen(true); }}>
          New Transfer
        </Button>
      </Stack>

      <Paper variant="outlined">
        <Box sx={{ p: 1.5 }}>
          <TextField
            size="small" placeholder="Search STN #, store, item, reason" value={search}
            onChange={(e) => { setPage(0); setSearch(e.target.value); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 360 } }}
          />
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>STN #</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>From → To</TableCell>
                <TableCell>Items</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Value</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>By</TableCell>
                <TableCell align="center">View</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>No stock transfers yet</TableCell></TableRow>
              )}
              {rows.map((t) => (
                <TableRow key={t._id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{t.transferNumber}</TableCell>
                  <TableCell>{formatDate(t.transferDate)}</TableCell>
                  <TableCell><TransferRoute t={t} /></TableCell>
                  <TableCell>
                    <Tooltip title={(t.items || []).map((i) => `${i.itemName}: ${i.quantity} ${i.unit || ''}`).join(', ')}>
                      <span>{(t.items || [])[0]?.itemName}{(t.items || []).length > 1 ? ` +${t.items.length - 1} more` : ''}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">{t.totalQuantity}</TableCell>
                  <TableCell align="right">{formatPKR(t.totalValue)}</TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>{t.reason}</TableCell>
                  <TableCell>{personName(t.createdBy)}</TableCell>
                  <TableCell align="center">
                    <IconButton size="small" onClick={() => setViewing(t)}><VisibilityIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div" count={total} page={page} rowsPerPage={rowsPerPage} rowsPerPageOptions={[25, 50, 100, 250, 500]}
          onPageChange={(_, p) => setPage(p)} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        />
      </Paper>

      {/* New transfer */}
      <Dialog open={formOpen} onClose={() => !saving && setFormOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>New Stock Transfer</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12} md={5}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="overline" color="text.secondary">From</Typography>
                <TextField select fullWidth size="small" label="Store" value={form.fromStore} onChange={setField('fromStore')} sx={{ mb: 1.5 }}>
                  {storeOptions.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
                </TextField>
                <TextField select fullWidth size="small" label="Project" value={form.fromProject} onChange={setField('fromProject')}>
                  {projects.map((p) => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
                </TextField>
              </Paper>
            </Grid>
            <Grid item xs={12} md={2} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowForwardIcon color="primary" sx={{ fontSize: 36, transform: { xs: 'rotate(90deg)', md: 'none' } }} />
            </Grid>
            <Grid item xs={12} md={5}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="overline" color="text.secondary">To</Typography>
                <TextField select fullWidth size="small" label="Store" value={form.toStore} onChange={setField('toStore')} sx={{ mb: 1.5 }}>
                  {storeOptions.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
                </TextField>
                <TextField select fullWidth size="small" label="Project" value={form.toProject} onChange={setField('toProject')}>
                  {projects.map((p) => <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>)}
                </TextField>
              </Paper>
            </Grid>
            {sameRoute && (
              <Grid item xs={12}><Alert severity="warning">Source and destination are the same — change the store or the project.</Alert></Grid>
            )}

            <Grid item xs={12}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">Items</Typography>
                <Button size="small" startIcon={<AddIcon />} disabled={!form.fromStore || !form.fromProject}
                  onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { inventoryItem: null, quantity: '' }] }))}>
                  Add item
                </Button>
              </Stack>
              {(!form.fromStore || !form.fromProject) ? (
                <Alert severity="info">Pick the source store and project to see what can be moved.</Alert>
              ) : !loadingStock && sourceStock.length === 0 ? (
                <Alert severity="info">Nothing in stock at this store / project.</Alert>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: '55%' }}>Item</TableCell>
                      <TableCell align="right">Available</TableCell>
                      <TableCell align="right" sx={{ width: 160 }}>Transfer qty</TableCell>
                      <TableCell padding="checkbox" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {form.lines.map((line, idx) => {
                      const available = line.inventoryItem ? balanceOf(line.inventoryItem.item) : null;
                      const over = line.inventoryItem && Number(line.quantity) > available;
                      return (
                        <TableRow key={idx}>
                          <TableCell>
                            <Autocomplete
                              size="small"
                              loading={loadingStock}
                              options={sourceStock.filter((b) => !usedItemIds.has(String(b.item)) || String(b.item) === String(line.inventoryItem?.item))}
                              value={line.inventoryItem}
                              isOptionEqualToValue={(a, b) => String(a.item) === String(b.item)}
                              getOptionLabel={(o) => `${o.itemCode ? `${o.itemCode} — ` : ''}${o.itemName}`}
                              onChange={(_, v) => setLine(idx, { inventoryItem: v, quantity: '' })}
                              renderInput={(params) => <TextField {...params} placeholder="Select item" />}
                            />
                          </TableCell>
                          <TableCell align="right">{available == null ? '—' : `${available} ${line.inventoryItem.unit || ''}`}</TableCell>
                          <TableCell align="right">
                            <TextField
                              size="small" type="number" value={line.quantity} disabled={!line.inventoryItem}
                              error={Boolean(over)} helperText={over ? 'More than available' : ''}
                              inputProps={{ min: 0, max: available || undefined, step: 'any' }}
                              onChange={(e) => setLine(idx, { quantity: e.target.value })}
                              InputProps={{ endAdornment: line.inventoryItem && available > 0 ? (
                                <InputAdornment position="end">
                                  <Button size="small" sx={{ minWidth: 0, px: 0.5 }} onClick={() => setLine(idx, { quantity: String(available) })}>All</Button>
                                </InputAdornment>
                              ) : null }}
                            />
                          </TableCell>
                          <TableCell padding="checkbox">
                            <IconButton size="small" disabled={form.lines.length === 1}
                              onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Grid>

            <Grid item xs={12} sm={4}>
              <TextField fullWidth size="small" type="date" label="Transfer date" InputLabelProps={{ shrink: true }}
                value={form.transferDate} onChange={setField('transferDate')} />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField fullWidth size="small" required label="Reason" value={form.reason} onChange={setField('reason')}
                placeholder="e.g. Cement needed at Site B" />
            </Grid>
            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Sent by" value={form.sentByName} onChange={setField('sentByName')} /></Grid>
            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Received by" value={form.receivedByName} onChange={setField('receivedByName')} /></Grid>
            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Vehicle no." value={form.vehicleNumber} onChange={setField('vehicleNumber')} /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={!canSave}>{saving ? 'Posting…' : 'Post Transfer'}</Button>
        </DialogActions>
      </Dialog>

      {/* View / print */}
      <Dialog open={Boolean(viewing)} onClose={() => setViewing(null)} maxWidth="md" fullWidth>
        <DialogContent>{viewing && <TransferNoteView t={viewing} />}</DialogContent>
        <DialogActions className="app-print-hide">
          <Button startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
          <Button variant="contained" onClick={() => setViewing(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StockTransfers;
