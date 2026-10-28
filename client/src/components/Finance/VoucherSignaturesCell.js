import React from 'react';
import { Avatar, Badge, Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

const initials = (name, label) => {
  const source = String(name || label || '').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
};

const formatSignedAt = (at) => (at
  ? new Date(at).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '');

const STATUS_STYLE = {
  approved: { bg: 'success.main', color: 'common.white', badge: 'success.dark', text: 'Signed' },
  rejected: { bg: 'error.main', color: 'common.white', badge: 'error.dark', text: 'Rejected' },
  pending: { bg: 'transparent', color: 'text.secondary', badge: null, text: 'Pending' }
};

const SignatureTooltip = ({ slot }) => (
  <Box sx={{ p: 0.25 }}>
    <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>{slot.label}</Typography>
    <Typography variant="body2" fontWeight={600}>{slot.name || 'Not assigned'}</Typography>
    <Typography variant="caption" sx={{ display: 'block' }}>
      {STATUS_STYLE[slot.status].text}{slot.at ? ` · ${formatSignedAt(slot.at)}` : ''}
    </Typography>
  </Box>
);

/** Voucher Center "Signed By": one avatar per finance authority (green signed, red rejected, outlined pending) */
const VoucherSignaturesCell = ({ signatures }) => {
  if (!signatures?.slots?.length) {
    return (
      <Tooltip title="No finance sign-off on this voucher" arrow>
        <Typography variant="body2" color="text.disabled">—</Typography>
      </Tooltip>
    );
  }
  const { slots, signed, total, rejected } = signatures;
  const lastSigned = [...slots].filter((s) => s.status === 'approved' && s.at).sort((a, b) => new Date(b.at) - new Date(a.at))[0];

  return (
    <Box sx={{ minWidth: 150 }}>
      <Stack direction="row" spacing={0.5} sx={{ mb: 0.5 }}>
        {slots.map((slot) => {
          const style = STATUS_STYLE[slot.status];
          const avatar = (
            <Avatar
              sx={{
                width: 28,
                height: 28,
                fontSize: 11,
                fontWeight: 700,
                bgcolor: style.bg,
                color: style.color,
                border: slot.status === 'pending' ? '1.5px dashed' : 'none',
                borderColor: 'divider'
              }}
            >
              {initials(slot.name, slot.label)}
            </Avatar>
          );
          return (
            <Tooltip key={slot.key} title={<SignatureTooltip slot={slot} />} arrow>
              {style.badge ? (
                <Badge
                  overlap="circular"
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  badgeContent={(
                    <Box sx={{ width: 13, height: 13, borderRadius: '50%', bgcolor: style.badge, color: 'common.white', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid', borderColor: 'background.paper' }}>
                      {slot.status === 'approved' ? <CheckIcon sx={{ fontSize: 9 }} /> : <CloseIcon sx={{ fontSize: 9 }} />}
                    </Box>
                  )}
                >
                  {avatar}
                </Badge>
              ) : avatar}
            </Tooltip>
          );
        })}
      </Stack>
      <LinearProgress
        variant="determinate"
        value={(signed / total) * 100}
        color={rejected ? 'error' : signed === total ? 'success' : 'warning'}
        sx={{ height: 4, borderRadius: 2, mb: 0.25 }}
      />
      <Typography variant="caption" color={rejected ? 'error.main' : 'text.secondary'} sx={{ display: 'block', lineHeight: 1.3 }}>
        {rejected ? 'Rejected' : `${signed} of ${total} signed`}
        {!rejected && lastSigned ? ` · last: ${lastSigned.name || lastSigned.label}` : ''}
      </Typography>
    </Box>
  );
};

export default VoucherSignaturesCell;
