import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Grid, IconButton, Paper, Stack, TextField, Tooltip, Typography
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { getBarterBalances, handoverBarterProperty, saveBarterProperties, searchBarterProperties } from '../../services/projectManagementService';
import { fmt } from './mainProjectUi';

const blankRow = () => ({ key: Math.random().toString(36).slice(2), property: null, label: '', propertyType: '', plotNumber: '', sector: '', area: '', agreedValue: '', notes: '' });

/** Search Taj Residencia properties; shows which are already promised on another contract */
const PropertySearch = ({ contractId, onPick }) => {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchBarterProperties(q, contractId);
        if (live) setOptions(res.data?.data || []);
      } catch {
        if (live) setOptions([]);
      } finally {
        if (live) setLoading(false);
      }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, contractId]);

  return (
    <Autocomplete
      options={options}
      filterOptions={(x) => x}
      getOptionLabel={(o) => o.label || ''}
      getOptionDisabled={(o) => Boolean(o.reservedBy)}
      loading={loading}
      value={null}
      inputValue={q}
      onInputChange={(_, v, reason) => reason !== 'reset' && setQ(v)}
      onChange={(_, o) => { if (o) { onPick(o); setQ(''); } }}
      renderOption={(props, o) => (
        <li {...props} key={o._id}>
          <Stack sx={{ width: '100%' }}>
            <Stack direction="row" justifyContent="space-between" gap={1}>
              <span>{o.label}</span>
              {o.reservedBy && <Typography variant="caption" color="error">On {o.reservedBy}</Typography>}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {[o.area, o.ownerName && `Owner: ${o.ownerName}`].filter(Boolean).join(' · ')}
            </Typography>
          </Stack>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label="Add from Taj Residencia properties"
          placeholder="Search plot, sector, block, unit…"
          InputProps={{ ...params.InputProps, endAdornment: <>{loading && <CircularProgress size={16} />}{params.InputProps.endAdornment}</> }}
        />
      )}
    />
  );
};

/**
 * Properties given to a contractor in exchange for work (Barter / Mixed contracts), each at its
 * agreed value. Their total should cover the contract's property share before it is activated.
 */
export default function BarterPropertiesDialog({ open, onClose, projectId, contract, onSaved }) {
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState(null);
  const [handing, setHanding] = useState('');

  useEffect(() => {
    if (!open || !contract) return;
    setError('');
    setBalance(null);
    getBarterBalances(projectId)
      .then((res) => setBalance((res.data?.data || []).find((b) => String(b.contractor?._id) === String(contract.contractor?._id || contract.contractor)) || null))
      .catch(() => setBalance(null));
    setRows((contract.barterProperties || []).map((p) => ({
      ...p,
      key: p._id,
      property: p.property?._id || p.property || null,
      agreedValue: p.agreedValue || ''
    })));
  }, [open, contract, projectId]);

  /** Hand a saved, reserved property over — allowed up to the property value earned on approved IPCs */
  const handOver = async (r) => {
    if (!window.confirm(`Hand over ${r.label} (${fmt(r.agreedValue)}) to ${contract.contractor?.name || 'the contractor'}?\n\nThis posts to Finance and can't be undone here.`)) return;
    setHanding(r._id);
    setError('');
    try {
      const res = await handoverBarterProperty(projectId, contract._id, r._id);
      onSaved?.(res.data?.message, res.data?.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not hand over');
    } finally {
      setHanding('');
    }
  };

  const live = rows.filter((r) => r.status !== 'Released');
  const covered = live.reduce((s, r) => s + (Number(r.agreedValue) || 0), 0);
  const share = Number(contract?.propertyAmount) || 0;
  const gap = share - covered;
  const locked = (r) => r.status === 'Handed over';

  const set = (key, k) => (e) => setRows((list) => list.map((r) => (r.key === key ? { ...r, [k]: e.target.value } : r)));
  const remove = (key) => setRows((list) => list.filter((r) => r.key !== key));
  const pick = (o) => {
    if (rows.some((r) => String(r.property) === String(o._id) && r.status !== 'Released')) return;
    setRows((list) => [...list, { ...blankRow(), property: o._id, label: o.label, propertyType: o.propertyType, plotNumber: o.plotNumber, sector: o.sector, area: o.area }]);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await saveBarterProperties(projectId, contract._id, rows.map(({ key, ...r }) => ({
        ...r,
        _id: r._id || undefined,
        agreedValue: Number(r.agreedValue) || 0
      })));
      onSaved?.(res.data?.message, res.data?.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    if (!share) return null;
    if (Math.abs(gap) < 1) return { severity: 'success', text: 'The properties cover the property share exactly.' };
    if (gap > 0) return { severity: 'warning', text: `${fmt(gap)} of the property share is not covered yet — the contract can't be activated until it is.` };
    return { severity: 'info', text: `The properties are worth ${fmt(-gap)} more than the property share — that difference is owed back by the contractor (e.g. deducted from the cash part).` };
  }, [share, gap]);

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>
        Properties given in exchange — {contract?.contractNumber}
        <Typography variant="body2" color="text.secondary">{contract?.contractor?.name} · {contract?.title}</Typography>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        <Stack direction="row" gap={3} flexWrap="wrap" sx={{ mb: 2 }}>
          <Box><Typography variant="caption" color="text.secondary">Contract value</Typography><Typography fontWeight={800}>{fmt(contract?.totalAmount)}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Cash part</Typography><Typography fontWeight={800}>{fmt(contract?.cashAmount)}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Property share ({contract?.propertyPercent}%)</Typography><Typography fontWeight={800}>{fmt(share)}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Covered by properties</Typography><Typography fontWeight={800} color={gap > 0 ? 'warning.main' : 'success.main'}>{fmt(covered)}</Typography></Box>
        </Stack>
        {balance && (
          <Alert severity="info" icon={false} sx={{ mb: 2 }}>
            Contractor has earned <strong>{fmt(balance.propertyEarned)}</strong> in property on approved IPCs
            {balance.propertyInApproval > 0 ? ` (+ ${fmt(balance.propertyInApproval)} in approval)` : ''}
            {' · '}handed over <strong>{fmt(balance.handedOver)}</strong>
            {' · '}can still be handed over <strong>{fmt(Math.max(0, balance.owedInProperty))}</strong>
          </Alert>
        )}

        <Grid container spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
          <Grid item xs={12} md={9}><PropertySearch contractId={contract?._id} onPick={pick} /></Grid>
          <Grid item xs={12} md={3}>
            <Button fullWidth startIcon={<AddIcon />} onClick={() => setRows((list) => [...list, blankRow()])}>Enter by hand</Button>
          </Grid>
        </Grid>

        {!rows.length ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
            <Typography color="text.secondary">No properties yet. Search Taj Residencia's records, or enter one by hand if it isn't there.</Typography>
          </Paper>
        ) : (
          <Stack gap={1.25}>
            {rows.map((r) => (
              <Paper key={r.key} variant="outlined" sx={{ p: 1.5, borderRadius: 2, opacity: r.status === 'Released' ? 0.6 : 1 }}>
                <Grid container spacing={1.5} alignItems="center">
                  {r.property ? (
                    <Grid item xs={12} md={5}>
                      <Typography fontWeight={700}>{r.label}</Typography>
                      <Typography variant="caption" color="text.secondary">{[r.area, 'From Taj Residencia records'].filter(Boolean).join(' · ')}</Typography>
                    </Grid>
                  ) : (
                    <>
                      <Grid item xs={6} md={2}><TextField fullWidth size="small" label="Type" placeholder="Plot / Villa" value={r.propertyType} onChange={set(r.key, 'propertyType')} disabled={locked(r)} /></Grid>
                      <Grid item xs={6} md={1.5}><TextField fullWidth size="small" label="Plot / Unit" value={r.plotNumber} onChange={set(r.key, 'plotNumber')} disabled={locked(r)} /></Grid>
                      <Grid item xs={6} md={1.5}><TextField fullWidth size="small" label="Sector" value={r.sector} onChange={set(r.key, 'sector')} disabled={locked(r)} /></Grid>
                    </>
                  )}
                  <Grid item xs={6} md={r.property ? 2 : 1.5}><TextField fullWidth size="small" label="Size" placeholder="5 Marla" value={r.area} onChange={set(r.key, 'area')} disabled={locked(r)} /></Grid>
                  <Grid item xs={8} md={3}>
                    <TextField fullWidth size="small" type="number" label="Agreed value (PKR)" value={r.agreedValue} onChange={set(r.key, 'agreedValue')} disabled={locked(r) || r.status === 'Released'} inputProps={{ min: 0, step: 'any' }} />
                  </Grid>
                  <Grid item xs={12} md sx={{ textAlign: 'right' }}>
                    {r.status === 'Handed over' ? (
                      <Tooltip title={r.handoverReference ? `Finance ${r.handoverReference}` : ''}>
                        <Chip size="small" color="success" label={`Handed over${r.handedOverAt ? ` ${new Date(r.handedOverAt).toLocaleDateString('en-GB')}` : ''}`} />
                      </Tooltip>
                    ) : (
                      <Stack direction="row" justifyContent="flex-end" alignItems="center" gap={0.5}>
                        {r._id && r.status === 'Reserved' && contract?.status === 'Active' && (
                          <Tooltip title={balance && Number(r.agreedValue) > balance.owedInProperty + 0.5 ? `Contractor has earned only ${fmt(Math.max(0, balance.owedInProperty))} not yet handed over` : 'Hand this property over to the contractor'}>
                            <span>
                              <Button
                                size="small"
                                variant="outlined"
                                color="success"
                                disabled={Boolean(handing) || !balance || Number(r.agreedValue) > balance.owedInProperty + 0.5}
                                onClick={() => handOver(r)}
                              >
                                {handing === r._id ? '…' : 'Hand over'}
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                        {r._id && r.status !== 'Released' && (
                          <Button size="small" color="inherit" onClick={() => setRows((list) => list.map((x) => (x.key === r.key ? { ...x, status: 'Released' } : x)))}>Release</Button>
                        )}
                        {r.status === 'Released' ? (
                          <Chip size="small" label="Released" onDelete={() => setRows((list) => list.map((x) => (x.key === r.key ? { ...x, status: 'Reserved' } : x)))} />
                        ) : (
                          <Tooltip title="Remove"><IconButton size="small" color="error" onClick={() => remove(r.key)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                        )}
                      </Stack>
                    )}
                  </Grid>
                </Grid>
              </Paper>
            ))}
          </Stack>
        )}

        {summary && <Alert severity={summary.severity} sx={{ mt: 2 }}>{summary.text}</Alert>}
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
          Saved properties are reserved for this contractor — no other contract can take them. Handing them over comes later, as the contractor earns their value.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Close</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save properties'}</Button>
      </DialogActions>
    </Dialog>
  );
}
