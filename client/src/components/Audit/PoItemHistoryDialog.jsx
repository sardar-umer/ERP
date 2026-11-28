import React, { useEffect, useState } from 'react';
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
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';

const num = (v) => (Number(v) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });

/** "+12.5% above" in red, "−8% below" in green, "same" in grey */
const Diff = ({ pct }) => {
  if (pct == null) return null;
  if (Math.abs(pct) < 0.005) return <Typography component="span" variant="caption" color="text.secondary"> (same)</Typography>;
  const up = pct > 0;
  return (
    <Typography component="span" variant="caption" sx={{ fontWeight: 700, color: up ? '#d32f2f' : '#2e7d32' }}>
      {' '}({up ? '+' : '−'}{Math.abs(pct).toFixed(1)}% {up ? 'above' : 'below'})
    </Typography>
  );
};

const NOT_AGREED = ['Rejected', 'Cancelled'];

/**
 * Pre-Audit: earlier POs that bought the same or a similar item as one PO line, with rates
 * and how this PO's rate compares. Read-only.
 */
export default function PoItemHistoryDialog({ purchaseOrderId, lineIndex, onClose }) {
  const open = Boolean(purchaseOrderId) && lineIndex != null;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setData(null);
    setError('');
    setLoading(true);
    api.get(`/pre-audit/purchase-order/${purchaseOrderId}/item-history/${lineIndex}`)
      .then((res) => { if (!cancelled) setData(res.data?.data || null); })
      .catch((e) => { if (!cancelled) setError(e.response?.data?.message || 'Could not load the item history'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, purchaseOrderId, lineIndex]);

  const line = data?.line;
  const s = data?.summary;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Item purchase history
        {line && (
          <Typography variant="body2" color="text.secondary" component="div">
            {data.orderNumber} · line {line.index + 1}: <strong>{line.description}</strong>
            {line.specification ? ` — ${line.specification}` : ''}{line.brand ? ` · ${line.brand}` : ''}
            {' · '}{num(line.quantity)} {line.unit} @ <strong>{num(line.unitPrice)}</strong>
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {loading && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>}
        {error && <Alert severity="error">{error}</Alert>}

        {data && !loading && (
          <>
            {data.rows.length === 0 ? (
              <Alert severity="info">
                This item has not been bought on any earlier purchase order (no same or similar item found).
              </Alert>
            ) : (
              <>
                {s ? (
                  <Grid container spacing={1.5} sx={{ mb: 2 }}>
                    {[
                      ['This PO', line.unitPrice, null],
                      [`Last price (${s.last.orderNumber}, ${formatDate(s.last.date)})`, s.last.unitPrice, s.vsLastPct],
                      ['Lowest', s.lowest, s.vsLowestPct],
                      ['Average', s.average, s.vsAveragePct],
                      ['Highest', s.highest, null]
                    ].map(([label, value, pct]) => (
                      <Grid item xs={6} md key={label}>
                        <Paper variant="outlined" sx={{ p: 1.25, height: '100%' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
                          <Typography variant="body1" sx={{ fontWeight: 700 }}>{num(value)}</Typography>
                          {pct != null && <Typography variant="caption" component="div">This PO<Diff pct={pct} /></Typography>}
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                ) : null}
                {s?.basedOn === 'similar' && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    This exact item was not bought before; the prices above are from <strong>similar</strong> items — check the
                    description, specification and unit before comparing.
                  </Alert>
                )}
                {data.onlyNotAgreed && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    This item was on earlier POs, but all of them were <strong>rejected or cancelled</strong>, so there is no agreed
                    rate to compare with. Their rates are listed below.
                  </Alert>
                )}
                {s && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Prices from {s.count} earlier line{s.count === 1 ? '' : 's'} on POs that were not rejected or cancelled.
                  </Typography>
                )}

                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.100' } }}>
                        <TableCell>PO</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Vendor</TableCell>
                        <TableCell>Item</TableCell>
                        <TableCell align="right">Qty</TableCell>
                        <TableCell align="right">Rate</TableCell>
                        <TableCell align="right">This PO's rate</TableCell>
                        <TableCell>Match</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.rows.map((r, i) => {
                        const notAgreed = NOT_AGREED.includes(r.status);
                        const pct = r.unitPrice > 0 && line.unitPrice > 0 ? ((line.unitPrice - r.unitPrice) / r.unitPrice) * 100 : null;
                        return (
                          <TableRow key={`${r.purchaseOrderId}-${i}`} sx={notAgreed ? { '& td': { color: 'text.secondary' } } : undefined}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {r.orderNumber}
                              {r.indentNumber ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.indentNumber}</Typography> : null}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</TableCell>
                            <TableCell>
                              <Chip size="small" label={r.status} color={notAgreed ? 'default' : 'success'} variant={notAgreed ? 'outlined' : 'filled'} />
                            </TableCell>
                            <TableCell>{r.vendorName || '—'}</TableCell>
                            <TableCell>
                              {r.description}
                              {(r.specification || r.brand) && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  {[r.specification, r.brand].filter(Boolean).join(' · ')}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{num(r.quantity)} {r.unit}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>{num(r.unitPrice)}</TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                              {pct == null ? '—' : <Diff pct={pct} />}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {r.matchedBy === 'Similar' ? `Similar (${Math.round(r.similarity * 100)}%)` : r.matchedBy}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                {data.totalMatches > data.rows.length && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    Showing the {data.rows.length} closest of {data.totalMatches} matching lines.
                  </Typography>
                )}
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
