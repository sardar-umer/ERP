/** Search-as-you-type picker over active HR employees (name or employee ID); value = { _id, name, employeeId, designation } */
import React, { useEffect, useState } from 'react';
import { Autocomplete, Box, CircularProgress, TextField, Typography } from '@mui/material';
import { getEmployeeOptions } from '../../services/projectManagementService';

export default function EmployeePicker({ label, value, onChange, helperText, required = false }) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      getEmployeeOptions(input)
        .then((res) => { if (!cancelled) setOptions(res.data?.data?.options || []); })
        .catch(() => { if (!cancelled) setOptions([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [input]);

  // Keep the chosen person in the list so it shows even when the search does not return it
  const list = value && !options.some((o) => String(o._id) === String(value._id)) ? [value, ...options] : options;

  return (
    <Autocomplete
      value={value || null}
      options={list}
      loading={loading}
      filterOptions={(x) => x}
      isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
      getOptionLabel={(o) => o?.name || ''}
      onChange={(_, v) => onChange(v)}
      onInputChange={(_, v, reason) => { if (reason === 'input') setInput(v); if (reason === 'clear') setInput(''); }}
      renderOption={(props, o) => (
        <Box component="li" {...props} key={o._id}>
          <Box>
            <Typography variant="body2" fontWeight={700}>{o.name}</Typography>
            <Typography variant="caption" color="text.secondary">{[o.employeeId && `ID ${o.employeeId}`, o.designation].filter(Boolean).join(' · ')}</Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          helperText={helperText || (value ? [value.employeeId && `ID ${value.employeeId}`, value.designation].filter(Boolean).join(' · ') : 'Type a name or employee ID')}
          InputProps={{ ...params.InputProps, endAdornment: <>{loading ? <CircularProgress size={16} /> : null}{params.InputProps.endAdornment}</> }}
        />
      )}
    />
  );
}
