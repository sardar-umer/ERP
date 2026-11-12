import React from 'react';
import { Alert } from '@mui/material';

/**
 * Shown to approvers and Pre-Audit when a bill was saved although it looked like an existing bill
 * (same company + vendor + amount, or same meter / account number this month).
 */
export default function DuplicateConfirmationNote({ bill, sx }) {
  const dc = bill?.duplicateConfirmation;
  if (!dc?.reason || !(dc.matches || []).length) return null;
  const by = dc.confirmedBy && typeof dc.confirmedBy === 'object'
    ? `${dc.confirmedBy.firstName || ''} ${dc.confirmedBy.lastName || ''}`.trim()
    : '';
  const reasons = [...new Set(dc.matches.flatMap((m) => m.reasons || []))].join('; ');
  return (
    <Alert severity="warning" sx={{ mb: 2, ...sx }}>
      <strong>Possible duplicate:</strong> this bill looks like{' '}
      <strong>{dc.matches.map((m) => `${m.billId}${m.amount ? ` (Rs ${Number(m.amount).toLocaleString('en-PK')})` : ''}`).join(', ')}</strong>
      {reasons ? ` — ${reasons}` : ''}. It was saved anyway{by ? ` by ${by}` : ''}
      {dc.confirmedAt ? ` on ${new Date(dc.confirmedAt).toLocaleDateString('en-GB')}` : ''} with the reason: “{dc.reason}”.
    </Alert>
  );
}
