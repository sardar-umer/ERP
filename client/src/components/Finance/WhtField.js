import React from 'react';
import { InputAdornment, MenuItem, Select, TextField } from '@mui/material';
import { formatPKR } from '../../utils/currency';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * WHT on a bill payment, from the form's `whtBy` ('rate' | 'amount'), `whtRate` and `whtAmount`.
 * Finance gives either the rate or the rupee amount; the other is worked out from the payment total.
 */
export const computeWht = (gross, form = {}) => {
  const total = round2(gross);
  const byAmount = form.whtBy === 'amount';
  const amount = byAmount ? round2(form.whtAmount) : round2(total * ((Number(form.whtRate) || 0) / 100));
  const rate = byAmount
    ? (total > 0 ? Math.round((amount / total) * 100 * 10000) / 10000 : 0)
    : (Number(form.whtRate) || 0);
  const invalid = amount < 0 || (amount > 0 && amount >= total);
  return { byAmount, amount, rate, invalid, net: invalid ? total : round2(total - amount) };
};

/** What to send with the payment: a typed amount is posted exactly, otherwise the rate. */
export const whtPayload = (form = {}) => (form.whtBy === 'amount'
  ? { whtRate: 0, whtAmount: Number(form.whtAmount) || 0 }
  : { whtRate: Number(form.whtRate) || 0, whtAmount: 0 });

/**
 * One WHT box with a % / PKR selector. `form` holds whtBy / whtRate / whtAmount;
 * `onChange` receives the fields to merge into it.
 */
const WhtField = ({ gross, form = {}, onChange, label = 'WHT', ...textFieldProps }) => {
  const wht = computeWht(gross, form);
  return (
    <TextField
      fullWidth
      size="small"
      type="number"
      label={label}
      placeholder={wht.byAmount ? 'e.g. 1500' : 'e.g. 4.5'}
      value={wht.byAmount ? (form.whtAmount ?? '') : (form.whtRate || '')}
      onChange={(e) => onChange(wht.byAmount
        ? { whtBy: 'amount', whtAmount: e.target.value, whtRate: 0 }
        : { whtBy: 'rate', whtRate: e.target.value, whtAmount: '' })}
      inputProps={wht.byAmount ? { min: 0, step: 0.01 } : { min: 0, max: 99, step: 0.01 }}
      error={wht.invalid}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Select
              variant="standard"
              disableUnderline
              value={wht.byAmount ? 'amount' : 'rate'}
              onChange={(e) => {
                // Switching carries the same WHT over, expressed the other way
                const toAmount = e.target.value === 'amount';
                if (toAmount === wht.byAmount) return;
                onChange(toAmount
                  ? { whtBy: 'amount', whtAmount: wht.amount > 0 ? wht.amount : '', whtRate: 0 }
                  : { whtBy: 'rate', whtRate: wht.amount > 0 && !wht.invalid ? wht.rate : 0, whtAmount: '' });
              }}
              inputProps={{ 'aria-label': 'WHT as percent or amount' }}
              sx={{ fontSize: 14, minWidth: 56 }}
            >
              <MenuItem value="rate">%</MenuItem>
              <MenuItem value="amount">PKR</MenuItem>
            </Select>
          </InputAdornment>
        )
      }}
      helperText={wht.invalid
        ? 'Must be less than the payment amount'
        : wht.amount > 0
          ? (wht.byAmount ? `= ${wht.rate}% of the payment` : `= ${formatPKR(wht.amount)}`)
          : 'Leave empty if no WHT applies'}
      {...textFieldProps}
    />
  );
};

export default WhtField;
