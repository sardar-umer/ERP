import React from 'react';
import { Autocomplete, Grid, TextField, Typography } from '@mui/material';
import { userOptionLabel, userOptionSecondary } from '../../services/financeApprovalAuthorityService';

const userAutocompleteProps = ({
  disabled,
  candidateUsers,
  approverLoading,
  onOpenApproverSearch,
  onApproverSearchInput,
  value,
  onChange,
  label,
  helperText
}) => ({
  disabled,
  options: candidateUsers,
  value: value || null,
  onChange: (_, v) => onChange(v),
  loading: approverLoading,
  onOpen: onOpenApproverSearch,
  onInputChange: onApproverSearchInput,
  filterOptions: (opts) => opts,
  getOptionLabel: userOptionLabel,
  isOptionEqualToValue: (a, b) => String(a?._id || a?.id) === String(b?._id || b?.id),
  noOptionsText: approverLoading ? 'Loading…' : (candidateUsers.length ? 'No match — type to search' : 'Type a name to search users'),
  renderOption: (props, option) => (
    <li {...props} key={option._id || option.id}>
      <Typography variant="body2">{userOptionLabel(option)}</Typography>
      {userOptionSecondary(option) ? (
        <Typography variant="caption" color="text.secondary" display="block">
          {userOptionSecondary(option)}
        </Typography>
      ) : null}
    </li>
  ),
  renderInput: (params) => (
    <TextField
      {...params}
      label={label}
      size="small"
      required
      placeholder="Type name or employee ID…"
      helperText={helperText}
    />
  )
});

const PayrollApprovalAuthorityPicker = ({
  gmHrUser,
  onGmHrChange,
  candidateUsers = [],
  approverLoading = false,
  onOpenApproverSearch,
  onApproverSearchInput,
  preparerName = '',
  disabled = false,
  title = 'Payroll approval authorities (required)'
}) => (
  <>
    <Grid item xs={12}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Deputy Manager Payroll HR: <strong>{preparerName || 'You (preparer)'}</strong> — assigned automatically when you save.
        Approvals run in order: Deputy Manager Payroll HR → GM HR. GM HR's approval sends the month to Finance. Type in the GM HR field to search all active users.
      </Typography>
    </Grid>
    <Grid item xs={12} md={4}>
      <TextField
        fullWidth
        size="small"
        label="Deputy Manager Payroll HR"
        value={preparerName || 'You (preparer)'}
        disabled
        helperText="First approval authority (you)"
      />
    </Grid>
    <Grid item xs={12} md={4}>
      <Autocomplete
        {...userAutocompleteProps({
          disabled,
          candidateUsers,
          approverLoading,
          onOpenApproverSearch,
          onApproverSearchInput,
          value: gmHrUser,
          onChange: onGmHrChange,
          label: 'GM HR *',
          helperText: 'Final approval authority — search all users'
        })}
      />
    </Grid>
  </>
);

export default PayrollApprovalAuthorityPicker;
