import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import api from '../../services/api';
import PODocumentView from '../../pages/Procurement/Store/PODocumentView';

const fmt = (v) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })
  .format(Number(v || 0));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const STAT_CARDS = [
  { key: 'budget', label: 'Budget', hint: 'Approved budget (estimate until approved)' },
  { key: 'indented', label: 'Indented', hint: 'Open indents not yet on a PO — not counted in Available' },
  { key: 'committed', label: 'Committed', hint: 'Approved POs' },
  { key: 'actual', label: 'Received', hint: 'Goods received on those POs, less returns' },
  { key: 'consumed', label: 'Consumed', hint: 'Stock issued to site on Store Issue Notes, less returns to store' },
  { key: 'available', label: 'Available', hint: 'Budget − Committed' }
];

const StatCard = ({ label, hint, value, negative }) => (
  <Tooltip title={hint} placement="top">
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>{label}</Typography>
      <Typography variant="h6" fontWeight={800} sx={{ color: negative ? 'error.main' : 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {fmt(value)}
      </Typography>
    </Paper>
  </Tooltip>
);

/** Committed share of budget, with the received part shaded darker */
const UsageBar = ({ totals }) => {
  const committed = pct(totals.committed, totals.budget);
  const received = pct(totals.actual, totals.budget);
  const over = totals.budget > 0 && totals.committed > totals.budget;
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {totals.budget > 0 ? `${committed}% of budget committed · ${received}% received` : 'No budget set for this project yet'}
        </Typography>
        {over && <Chip size="small" color="error" label={`Over budget by ${fmt(totals.committed - totals.budget)}`} />}
      </Stack>
      <Box sx={{ position: 'relative' }}>
        <LinearProgress
          variant="buffer"
          value={Math.min(100, received)}
          valueBuffer={Math.min(100, committed)}
          color={over ? 'error' : 'primary'}
          sx={{ height: 10, borderRadius: 5, '& .MuiLinearProgress-dashed': { display: 'none' } }}
        />
      </Box>
    </Box>
  );
};

const MoneyTable = ({ rows, firstColumn, showIndented = true, onRowClick }) => (
  <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, mb: 3, overflowX: 'auto' }}>
    <Table size="small">
      <TableHead>
        <TableRow sx={{ bgcolor: 'grey.50' }}>
          <TableCell sx={{ fontWeight: 700 }}>{firstColumn}</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>Budget</TableCell>
          {showIndented && <TableCell align="right" sx={{ fontWeight: 700 }}>Indented</TableCell>}
          <TableCell align="right" sx={{ fontWeight: 700 }}>Committed</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>Received</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>Consumed</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>On order</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>Available</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700, width: 110 }}>Used</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => {
          const over = r.available < 0;
          return (
            <TableRow
              key={r.key}
              hover={Boolean(onRowClick)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              sx={{ cursor: onRowClick ? 'pointer' : 'default', ...(r.isTotal ? { '& td': { fontWeight: 700, borderTop: '2px solid', borderColor: 'divider' } } : {}) }}
            >
              <TableCell>{r.label}</TableCell>
              <TableCell align="right">{fmt(r.budget)}</TableCell>
              {showIndented && <TableCell align="right" sx={{ color: 'text.secondary' }}>{fmt(r.indented)}</TableCell>}
              <TableCell align="right">{fmt(r.committed)}</TableCell>
              <TableCell align="right">{fmt(r.actual)}</TableCell>
              <TableCell align="right">{fmt(r.consumed)}</TableCell>
              <TableCell align="right">{fmt(r.open)}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, color: over ? 'error.main' : 'success.dark' }}>{fmt(r.available)}</TableCell>
              <TableCell align="right">
                {r.budget > 0 ? (
                  <Stack direction="row" alignItems="center" gap={0.75} justifyContent="flex-end">
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, pct(r.committed, r.budget))}
                      color={over ? 'error' : 'primary'}
                      sx={{ width: 50, height: 6, borderRadius: 3 }}
                    />
                    <Typography variant="caption" sx={{ minWidth: 30 }}>{pct(r.committed, r.budget)}%</Typography>
                  </Stack>
                ) : (
                  <Typography variant="caption" color={r.committed > 0 ? 'error.main' : 'text.secondary'}>
                    {r.committed > 0 ? 'No budget' : '—'}
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </TableContainer>
);

/** Same category across Sub Projects, added up (Main Project view) */
const combineCategories = (subProjects) => {
  const map = new Map();
  subProjects.forEach((s) => s.categories.forEach((c) => {
    const t = map.get(c.category) || { category: c.category, budget: 0, indented: 0, committed: 0, actual: 0, consumed: 0, open: 0, available: 0 };
    ['budget', 'indented', 'committed', 'actual', 'consumed', 'open', 'available'].forEach((k) => { t[k] += Number(c[k]) || 0; });
    map.set(c.category, t);
  }));
  return [...map.values()];
};

const statusColor = (status) => {
  if (['Cancelled', 'Rejected', 'Rejected in Procurement'].includes(status)) return 'error';
  if (['Approved', 'Received', 'Fulfilled', 'Complete'].includes(status)) return 'success';
  if (String(status || '').startsWith('Returned')) return 'warning';
  return 'default';
};

const CategoryChips = ({ categories }) => (
  <Stack direction="row" gap={0.5} flexWrap="wrap">
    {(categories || []).map((c) => <Chip key={c} label={c} size="small" variant="outlined" />)}
  </Stack>
);

/**
 * Procurement tab of a Construction Project: budget vs indented / committed / received per category
 * (and per Sub Project on a Main Project), plus the indents, POs and GRNs charged to it.
 */
const ProjectProcurementTab = ({ project }) => {
  const navigate = useNavigate();
  const isMain = !project.parentProject;
  const [summary, setSummary] = useState(null);
  const [docs, setDocs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [docTab, setDocTab] = useState(0);
  const [subFilter, setSubFilter] = useState(null);
  const [poView, setPoView] = useState({ open: false, loading: false, data: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, d] = await Promise.all([
        api.get(`/project-management/projects/${project._id}/procurement-summary`),
        api.get(`/project-management/projects/${project._id}/procurement-documents`)
      ]);
      setSummary(s.data?.data || null);
      setDocs(d.data?.data || null);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load procurement for this project');
    } finally {
      setLoading(false);
    }
  }, [project._id]);

  useEffect(() => { load(); }, [load]);

  const openPo = async (poId) => {
    setPoView({ open: true, loading: true, data: null });
    try {
      const res = await api.get(`/procurement/purchase-orders/${poId}`);
      setPoView({ open: true, loading: false, data: res.data?.data || null });
    } catch {
      setPoView({ open: true, loading: false, data: null });
    }
  };

  const selectedSub = subFilter && summary ? summary.subProjects.find((s) => String(s._id) === subFilter) : null;
  const categoryRows = useMemo(() => {
    if (!summary) return [];
    const source = selectedSub ? selectedSub.categories : (isMain ? combineCategories(summary.subProjects) : (summary.subProjects[0]?.categories || []));
    return source.map((c) => ({ key: c.category, label: c.category, ...c }));
  }, [summary, selectedSub, isMain]);

  const filterDocs = (list) => (selectedSub ? (list || []).filter((d) => String(d.subProjectId) === String(selectedSub._id)) : (list || []));

  if (loading && !summary) {
    return <Box display="flex" justifyContent="center" py={6}><CircularProgress size={28} /></Box>;
  }
  if (error) {
    return <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>{error}</Alert>;
  }
  if (!summary) return null;

  const totals = selectedSub ? selectedSub.totals : summary.totals;
  const indents = filterDocs(docs?.indents);
  const pos = filterDocs(docs?.purchaseOrders);
  const grns = filterDocs(docs?.grns);
  const issues = filterDocs(docs?.issues);
  const nothingYet = !(docs?.indents?.length || docs?.purchaseOrders?.length || docs?.grns?.length || docs?.issues?.length);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }} gap={1} flexWrap="wrap">
        <Typography variant="subtitle1" fontWeight={700}>
          {selectedSub ? `Procurement — ${selectedSub.name}` : (isMain ? 'Procurement across all sub-projects' : 'Procurement')}
        </Typography>
        <Stack direction="row" gap={1} alignItems="center">
          {selectedSub && <Button size="small" onClick={() => setSubFilter(null)}>Show all sub-projects</Button>}
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={load} sx={{ border: '1px solid', borderColor: 'divider' }}>
              {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {nothingYet && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Nothing has been procured for this project yet. Indents raised with <strong>For a project</strong> turned on
          will show here, along with their POs and GRNs.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 1.5, mb: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' } }}>
        {STAT_CARDS.map((c) => (
          <StatCard key={c.key} label={c.label} hint={c.hint} value={totals[c.key]} negative={c.key === 'available' && totals.available < 0} />
        ))}
      </Box>
      <UsageBar totals={totals} />

      {isMain && !selectedSub && summary.subProjects.length > 0 && (
        <>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>By sub-project <Typography component="span" variant="caption" color="text.secondary">(click a row to see its categories and documents)</Typography></Typography>
          <MoneyTable
            firstColumn="Sub-project"
            onRowClick={(r) => r.subId && setSubFilter(r.subId)}
            rows={[
              ...summary.subProjects.map((s) => ({ key: String(s._id), subId: String(s._id), label: s.name, ...s.totals })),
              { key: 'total', label: 'Total', isTotal: true, ...summary.totals }
            ]}
          />
        </>
      )}

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>By budget category</Typography>
      {categoryRows.length ? (
        <MoneyTable
          firstColumn="Category"
          rows={[...categoryRows, { key: 'total', label: 'Total', isTotal: true, ...totals }]}
        />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>No category budget or procurement yet.</Typography>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Tabs value={docTab} onChange={(_, v) => setDocTab(v)} sx={{ px: 1, borderBottom: '1px solid', borderColor: 'divider' }} variant="scrollable" allowScrollButtonsMobile>
          <Tab label={`Indents (${indents.length})`} sx={{ textTransform: 'none', fontWeight: 600 }} />
          <Tab label={`Purchase Orders (${pos.length})`} sx={{ textTransform: 'none', fontWeight: 600 }} />
          <Tab label={`GRNs (${grns.length})`} sx={{ textTransform: 'none', fontWeight: 600 }} />
          <Tab label={`Store Issues (${issues.length})`} sx={{ textTransform: 'none', fontWeight: 600 }} />
        </Tabs>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            {docTab === 0 && (
              <>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Indent</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Title</TableCell>
                    {isMain && <TableCell sx={{ fontWeight: 700 }}>Sub-project</TableCell>}
                    <TableCell sx={{ fontWeight: 700 }}>Categories</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Estimate</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {indents.map((d) => (
                    <TableRow key={d._id} hover>
                      <TableCell>
                        <Link component="button" variant="body2" fontWeight={600} onClick={() => navigate(`/general/indents/${d._id}`)}>
                          {d.number || '—'}
                        </Link>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260 }}>{d.title}</TableCell>
                      {isMain && <TableCell>{d.subProjectName}</TableCell>}
                      <TableCell><CategoryChips categories={d.categories} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(d.date)}</TableCell>
                      <TableCell><Chip size="small" label={d.status} color={statusColor(d.status)} /></TableCell>
                      <TableCell align="right">{fmt(d.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {!indents.length && <TableRow><TableCell colSpan={7} sx={{ color: 'text.secondary' }}>No indents.</TableCell></TableRow>}
                </TableBody>
              </>
            )}
            {docTab === 1 && (
              <>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>PO</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Vendor</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Indent</TableCell>
                    {isMain && <TableCell sx={{ fontWeight: 700 }}>Sub-project</TableCell>}
                    <TableCell sx={{ fontWeight: 700 }}>Categories</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Received</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pos.map((d) => (
                    <TableRow key={d._id} hover>
                      <TableCell>
                        <Link component="button" variant="body2" fontWeight={600} onClick={() => openPo(d._id)}>{d.number || '—'}</Link>
                      </TableCell>
                      <TableCell>{d.vendorName || '—'}</TableCell>
                      <TableCell>{d.indentNumber || '—'}</TableCell>
                      {isMain && <TableCell>{d.subProjectName}</TableCell>}
                      <TableCell><CategoryChips categories={d.categories} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(d.date)}</TableCell>
                      <TableCell>
                        <Stack direction="row" gap={0.5} alignItems="center" flexWrap="wrap">
                          <Chip size="small" label={d.status} color={statusColor(d.status)} />
                          {!d.committed && !['Cancelled', 'Rejected'].includes(d.status) && (
                            <Tooltip title="Not approved yet, so not counted in Committed">
                              <Chip size="small" variant="outlined" label="Not committed" />
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">{d.receivedPercent}%</TableCell>
                      <TableCell align="right" sx={{ textDecoration: ['Cancelled', 'Rejected'].includes(d.status) ? 'line-through' : 'none' }}>{fmt(d.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {!pos.length && <TableRow><TableCell colSpan={9} sx={{ color: 'text.secondary' }}>No purchase orders.</TableCell></TableRow>}
                </TableBody>
              </>
            )}
            {docTab === 2 && (
              <>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>GRN</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>PO</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Supplier</TableCell>
                    {isMain && <TableCell sx={{ fontWeight: 700 }}>Sub-project</TableCell>}
                    <TableCell sx={{ fontWeight: 700 }}>Categories</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {grns.map((d) => (
                    <TableRow key={d._id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{d.number || '—'}</TableCell>
                      <TableCell>{d.poNumber || '—'}</TableCell>
                      <TableCell>{d.supplierName || '—'}</TableCell>
                      {isMain && <TableCell>{d.subProjectName}</TableCell>}
                      <TableCell><CategoryChips categories={d.categories} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(d.date)}</TableCell>
                      <TableCell align="right">{fmt(d.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {!grns.length && <TableRow><TableCell colSpan={7} sx={{ color: 'text.secondary' }}>No GRNs.</TableCell></TableRow>}
                </TableBody>
              </>
            )}
            {docTab === 3 && (
              <>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>SIN</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Stock from</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Required for</TableCell>
                    {isMain && <TableCell sx={{ fontWeight: 700 }}>Sub-project</TableCell>}
                    <TableCell sx={{ fontWeight: 700 }}>Categories</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Qty used</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {issues.map((d) => (
                    <TableRow key={d._id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{d.number || '—'}</TableCell>
                      <TableCell>{d.storeProjectName || '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>{d.requiredFor || '—'}</TableCell>
                      {isMain && <TableCell>{d.subProjectName}</TableCell>}
                      <TableCell><CategoryChips categories={d.categories} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(d.date)}</TableCell>
                      <TableCell><Chip size="small" label={d.status} color={statusColor(d.status)} /></TableCell>
                      <TableCell align="right">{d.quantity}</TableCell>
                    </TableRow>
                  ))}
                  {!issues.length && <TableRow><TableCell colSpan={8} sx={{ color: 'text.secondary' }}>No store issues.</TableCell></TableRow>}
                </TableBody>
              </>
            )}
          </Table>
        </TableContainer>
        {docs && [docs.indents, docs.purchaseOrders, docs.grns, docs.issues].some((l) => (l || []).length >= docs.limit) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1 }}>
            Showing the latest {docs.limit} of each. The totals above include everything.
          </Typography>
        )}
      </Paper>

      <Dialog open={poView.open} onClose={() => setPoView({ open: false, loading: false, data: null })} maxWidth="lg" fullWidth>
        <DialogTitle>Purchase Order {poView.data?.orderNumber || ''}</DialogTitle>
        <DialogContent dividers>
          {poView.loading && <Box display="flex" justifyContent="center" py={4}><CircularProgress size={28} /></Box>}
          {!poView.loading && !poView.data && <Alert severity="error">Could not load this purchase order.</Alert>}
          {!poView.loading && poView.data && <PODocumentView data={poView.data} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPoView({ open: false, loading: false, data: null })}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProjectProcurementTab;
