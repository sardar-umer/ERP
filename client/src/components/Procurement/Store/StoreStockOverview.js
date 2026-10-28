import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Grid, Paper, Typography, Card, CardActionArea, CardContent, Table, TableBody, TableCell, TableHead,
  TableRow, Chip, CircularProgress, Alert, IconButton, Tooltip
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import { formatPKR } from '../../../utils/currency';
import { formatDate } from '../../../utils/dateUtils';

const Kpi = ({ label, value, hint, color = 'text.primary', onClick }) => (
  <Card variant="outlined" sx={{ height: '100%' }}>
    <CardActionArea onClick={onClick} disabled={!onClick} sx={{ height: '100%' }}>
      <CardContent sx={{ py: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={800} color={color} sx={{ my: 0.25 }}>{value}</Typography>
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </CardContent>
    </CardActionArea>
  </Card>
);

const Panel = ({ title, children, action }) => (
  <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
      <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      {action}
    </Box>
    {children}
  </Paper>
);

const headSx = { fontWeight: 700, fontSize: 12, color: 'text.secondary', textTransform: 'uppercase' };

/** Store Dashboard — stock and activity at a glance; every number links to the page that acts on it */
export default function StoreStockOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/procurement/store/stock-kpis');
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load stock figures');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>;
  if (error) return <Alert severity="warning" sx={{ mb: 3 }}>{error}</Alert>;
  if (!data) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>Stock overview</Typography>
        <Tooltip title="Refresh"><IconButton size="small" onClick={load} disabled={loading}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
      </Box>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} md={3}>
          <Kpi label="Stock value" value={formatPKR(data.stockValue)} hint={`${data.totalItems} items on stock cards`}
            onClick={() => navigate('/procurement/store/inventory')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi label="Low stock" value={data.lowStockCount} color={data.lowStockCount ? 'warning.main' : 'text.primary'}
            hint={`${data.outOfStock} out of stock`} onClick={() => navigate('/procurement/store/inventory')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi label="Awaiting receipt" value={data.poAwaitingReceipt} color={data.poAwaitingReceipt ? 'info.main' : 'text.primary'}
            hint={`POs sent to store · ${data.dcQaPending} DC awaiting QA`} onClick={() => navigate('/procurement/store/goods-receive')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi label="Stock Check" value={data.stockCheckMismatches} color={data.stockCheckMismatches ? 'error.main' : 'success.main'}
            hint={data.stockCheckMismatches ? 'items need fixing' : 'all items match project stock'}
            onClick={() => navigate('/procurement/store/stock-check')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi label="Issued today" value={data.sinToday} hint={`${data.sinThisMonth} SINs this month`}
            onClick={() => navigate('/procurement/store/goods-issue')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi label="GRNs this month" value={data.grnThisMonth} onClick={() => navigate('/procurement/store/goods-receive')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi label="Returns this month" value={data.returnsThisMonth} onClick={() => navigate('/procurement/store/store-returns')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi label="Customer SINs to invoice" value={data.customerSinsToInvoice}
            color={data.customerSinsToInvoice ? 'warning.main' : 'text.primary'} hint="billed from Finance → AR invoices" />
        </Grid>
      </Grid>

      <Grid container spacing={1.5}>
        <Grid item xs={12} md={4}>
          <Panel title="Stock value by project">
            {data.stockByProject.length === 0 ? <Typography variant="body2" color="text.secondary">No stock yet</Typography> : (
              <Table size="small">
                <TableHead><TableRow><TableCell sx={headSx}>Project</TableCell><TableCell sx={headSx} align="right">Items</TableCell><TableCell sx={headSx} align="right">Value</TableCell></TableRow></TableHead>
                <TableBody>
                  {data.stockByProject.slice(0, 8).map((p) => (
                    <TableRow key={p.project}>
                      <TableCell>{p.project}</TableCell>
                      <TableCell align="right">{p.items}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatPKR(p.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </Grid>
        <Grid item xs={12} md={4}>
          <Panel title="Low stock (at or below reorder level)">
            {data.lowStock.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing below its reorder level. Set a reorder level on an item to be warned here.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead><TableRow><TableCell sx={headSx}>Item</TableCell><TableCell sx={headSx} align="right">In stock</TableCell><TableCell sx={headSx} align="right">Reorder at</TableCell></TableRow></TableHead>
                <TableBody>
                  {data.lowStock.map((i) => (
                    <TableRow key={i._id}>
                      <TableCell>{i.name} <Typography component="span" variant="caption" color="text.secondary">({i.itemCode})</Typography></TableCell>
                      <TableCell align="right" sx={{ color: i.quantity <= 0 ? 'error.main' : 'warning.main', fontWeight: 600 }}>{i.quantity} {i.unit}</TableCell>
                      <TableCell align="right">{i.minQuantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </Grid>
        <Grid item xs={12} md={4}>
          <Panel title="Latest stock movements">
            {data.recentMovements.length === 0 ? <Typography variant="body2" color="text.secondary">No movements yet</Typography> : (
              <Table size="small">
                <TableBody>
                  {data.recentMovements.map((m) => (
                    <TableRow key={m._id}>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>{formatDate(m.createdAt)}</TableCell>
                      <TableCell sx={{ fontSize: 13 }}>
                        <Chip size="small" label={m.referenceType} variant="outlined" color={m.quantity > 0 ? 'success' : 'warning'} sx={{ height: 18, fontSize: 10, mr: 0.5 }} />
                        {m.itemName}
                        <Typography variant="caption" color="text.secondary" display="block">{m.project?.name || '—'} · {m.referenceNumber}</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: m.quantity > 0 ? 'success.main' : 'warning.main', whiteSpace: 'nowrap' }}>
                        {m.quantity > 0 ? '+' : ''}{m.quantity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </Grid>
      </Grid>
    </Box>
  );
}
