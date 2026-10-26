import React, { useMemo } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowDownward as DownIcon,
  ArrowUpward as UpIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })
    .format(Number(v || 0));

export const emptySlab = () => ({ key: `${Date.now()}-${Math.random()}`, name: '', percentage: '', activities: [] });

export const slabsTotalPercent = (slabs = []) =>
  slabs.reduce((sum, s) => sum + (Number(s.percentage) || 0), 0);

/** Amount per slab; last slab absorbs rounding so the total equals the contract value (mirrors server). */
export const slabAmounts = (slabs = [], contractValue = 0) => {
  const value = Number(contractValue) || 0;
  let allocated = 0;
  return slabs.map((s, idx) => {
    const amount = idx === slabs.length - 1
      ? Math.max(0, value - allocated)
      : Math.round((value * (Number(s.percentage) || 0)) / 100);
    allocated += amount;
    return amount;
  });
};

/**
 * Editable list of payment slabs: name, % and the master WBS activities each slab covers.
 * `slabs[].activities` holds activity ids. Pass `contractValue` to show rupee amounts.
 * `disabledActivityIds` greys out activities already covered elsewhere (e.g. another contract).
 */
const SlabRowsEditor = ({ slabs, onChange, activities = [], contractValue, disabledActivityIds = new Set(), readOnly = false }) => {
  const activityById = useMemo(() => new Map(activities.map((a) => [String(a._id), a])), [activities]);
  const total = slabsTotalPercent(slabs);
  const amounts = contractValue !== undefined ? slabAmounts(slabs, contractValue) : null;
  const showRowActions = !readOnly && slabs.length > 1;

  // Activities in no slab (and not covered elsewhere) would never be paid under a slab-wise contract
  const unassigned = useMemo(() => {
    if (readOnly) return [];
    const used = new Set(slabs.flatMap((s) => s.activities.map(String)));
    return activities.filter((a) => !used.has(String(a._id)) && !disabledActivityIds.has(String(a._id)));
  }, [readOnly, slabs, activities, disabledActivityIds]);

  const usedElsewhere = (slabIdx) => {
    const ids = new Set();
    slabs.forEach((s, i) => { if (i !== slabIdx) s.activities.forEach((id) => ids.add(String(id))); });
    return ids;
  };

  const update = (idx, patch) => onChange(slabs.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const remove = (idx) => onChange(slabs.filter((_, i) => i !== idx));
  const move = (idx, dir) => {
    const next = [...slabs];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  return (
    <Box>
      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ width: 40 }}>#</TableCell>
              <TableCell sx={{ minWidth: 180 }}>Slab / Stage</TableCell>
              <TableCell sx={{ width: 120 }}>%</TableCell>
              {amounts && <TableCell sx={{ width: 130 }} align="right">Amount</TableCell>}
              <TableCell sx={{ minWidth: 260 }}>WBS Activities covered</TableCell>
              {showRowActions && <TableCell sx={{ width: 110 }} align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {slabs.map((slab, idx) => {
              const taken = usedElsewhere(idx);
              const selected = slab.activities.map((id) => activityById.get(String(id))).filter(Boolean);
              return (
                <TableRow key={slab.key || slab._id || idx} sx={{ verticalAlign: 'top' }}>
                  <TableCell sx={{ pt: 2 }}>{idx + 1}</TableCell>
                  <TableCell>
                    {readOnly ? slab.name : (
                      <TextField
                        fullWidth size="small" value={slab.name} placeholder="e.g. Roof slab"
                        onChange={(e) => update(idx, { name: e.target.value })}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {readOnly ? `${slab.percentage}%` : (
                      <TextField
                        size="small" type="number" value={slab.percentage} placeholder="0"
                        onChange={(e) => update(idx, { percentage: e.target.value })}
                        inputProps={{ min: 0, max: 100, step: 0.5, style: { textAlign: 'right' } }}
                        InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                        sx={{ width: 110 }}
                      />
                    )}
                  </TableCell>
                  {amounts && <TableCell align="right" sx={{ pt: 2, fontWeight: 600 }}>{fmt(amounts[idx])}</TableCell>}
                  <TableCell>
                    {readOnly ? (
                      <Stack direction="row" flexWrap="wrap" gap={0.5}>
                        {selected.length ? selected.map((a) => <Chip key={a._id} size="small" label={a.name} />) : '—'}
                      </Stack>
                    ) : (
                      <Autocomplete
                        multiple
                        size="small"
                        options={activities}
                        groupBy={(a) => a.group}
                        getOptionLabel={(a) => (a.code ? `${a.code} — ${a.name}` : a.name)}
                        getOptionDisabled={(a) => taken.has(String(a._id)) || disabledActivityIds.has(String(a._id))}
                        isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
                        value={selected}
                        onChange={(_, v) => update(idx, { activities: v.map((a) => a._id) })}
                        renderInput={(params) => <TextField {...params} placeholder={selected.length ? '' : 'Select activities'} />}
                      />
                    )}
                  </TableCell>
                  {showRowActions && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title="Move up"><span><IconButton size="small" disabled={idx === 0} onClick={() => move(idx, -1)}><UpIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Move down"><span><IconButton size="small" disabled={idx === slabs.length - 1} onClick={() => move(idx, 1)}><DownIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Remove slab"><IconButton size="small" color="error" onClick={() => remove(idx)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {!slabs.length && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>No slabs yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
        {!readOnly ? (
          <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...slabs, emptySlab()])}>Add Slab</Button>
        ) : <span />}
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography variant="body2" color="text.secondary">Total</Typography>
          <Chip
            size="small"
            label={`${Number(total.toFixed(2))}%`}
            color={Math.abs(total - 100) < 0.001 ? 'success' : 'warning'}
          />
          {Math.abs(total - 100) >= 0.001 && (
            <Typography variant="caption" color="warning.main">must equal 100%</Typography>
          )}
        </Stack>
      </Stack>
      {unassigned.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          <strong>
            {unassigned.length} activit{unassigned.length === 1 ? 'y is' : 'ies are'} not in any slab
          </strong>
          {' '}— under a slab-wise contract they would not be paid:
          <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.75 }}>
            {unassigned.map((a) => (
              <Chip key={a._id} size="small" variant="outlined" label={`${a.group} › ${a.name}`} />
            ))}
          </Stack>
        </Alert>
      )}
    </Box>
  );
};

export default SlabRowsEditor;
