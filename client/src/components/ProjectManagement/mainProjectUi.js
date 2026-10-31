/** Shared look for the Main Project page (MainProjectPage, SubProjectPanel, ProjectSummaryPanel). */
import React from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';

export const ACCENT = '#0f766e';
export const INK = '#0f172a';
export const BORDER = '#e2e8f0';
export const SOFT = '#f8fafc';
// Soft teal surface shared by the sub project sidebar and the header chart card
export const TEAL_SURFACE = '#e3f1ee';
export const TEAL_BORDER = '#c5e2dc';
export const TEAL_TEXT = '#3f6b63';

export const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })
    .format(Number(v || 0));

/** Short axis labels: 1.2M, 450K */
export const fmtShort = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e2) / 10}K`;
  return String(n);
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const PROJECT_STATUS_COLOR = {
  Draft: 'default', Planning: 'info', Active: 'success', 'On Hold': 'warning', Completed: 'primary', Cancelled: 'error'
};
export const STATUS_DOT = {
  Draft: '#94a3b8', Planning: '#0288d1', Active: '#2e7d32', 'On Hold': '#ed6c02', Completed: '#1976d2'
};
export const CONTRACT_STATUS_COLOR = { Draft: 'default', Active: 'success', Completed: 'primary' };
export const CR_STATUS_COLOR = { Draft: 'default', Submitted: 'info', Verified: 'success', Billed: 'primary', Rejected: 'error' };
export const IPC_APPROVAL_COLOR = {
  Draft: 'default', 'Pending Audit': 'warning', 'Forwarded to Audit Director': 'warning',
  'Send to CEO Office': 'warning', 'Forwarded to CEO': 'warning', Approved: 'success', Rejected: 'error'
};
export const HEALTH_COLOR = { 'On Track': 'success', 'Needs Attention': 'warning', 'Over Budget': 'error' };

export const progressColor = (pct) => (pct >= 80 ? 'success' : pct >= 40 ? 'warning' : 'primary');

/** White rounded card with an optional title row */
export const Panel = ({ title, action, children, sx }) => (
  <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${BORDER}`, bgcolor: '#fff', ...sx }}>
    {(title || action) && (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
        {title && <Typography variant="subtitle1" fontWeight={800} sx={{ color: INK }}>{title}</Typography>}
        {action}
      </Box>
    )}
    {children}
  </Paper>
);

export const Empty = ({ children }) => (
  <Box sx={{ py: 5, px: 2, textAlign: 'center', borderRadius: 2, bgcolor: SOFT }}>
    <Typography variant="body2" color="text.secondary">{children}</Typography>
  </Box>
);

/** Small grey label above a value */
export const Label = ({ children }) => (
  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', display: 'block' }}>
    {children}
  </Typography>
);

/** Contract type tag: BOQ-wise vs Slab-wise */
export const ContractTypeTag = ({ type }) => (
  <Chip
    size="small"
    label={type === 'Slab' ? 'Slab-wise' : 'BOQ-wise'}
    sx={{
      fontWeight: 700,
      bgcolor: type === 'Slab' ? 'rgba(124,58,237,0.1)' : 'rgba(3,105,161,0.1)',
      color: type === 'Slab' ? '#6d28d9' : '#0369a1'
    }}
  />
);
