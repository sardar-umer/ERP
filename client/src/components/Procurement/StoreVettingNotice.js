import React from 'react';
import { Box, Typography } from '@mui/material';

const personLabel = (user) => {
  if (!user) return '';
  if (typeof user === 'string') return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email || '';
};

const formatWhen = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Compact Store vetting banner (fits A4 one-page PO print).
 * Place immediately above Approval Authorities.
 */
export default function StoreVettingNotice({ indent, sx = {} }) {
  if (!indent || typeof indent !== 'object') return null;

  const reason = String(indent.movedToProcurementReason || '').trim();
  const moved =
    indent.storeRoutingStatus === 'moved_to_procurement' ||
    Boolean(indent.movedToProcurementAt) ||
    Boolean(reason);

  if (!moved) return null;

  const byName = personLabel(indent.movedToProcurementBy);
  const when = formatWhen(indent.movedToProcurementAt);
  const meta = [byName ? `By ${byName}` : null, when || null].filter(Boolean).join(' · ');

  return (
    <Box
      sx={{
        mb: 0.75,
        px: 1,
        py: 0.55,
        border: '1.5px solid #b45309',
        borderRadius: 0.75,
        bgcolor: '#fffbeb',
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        '@media print': {
          mb: 0.5,
          px: 0.75,
          py: 0.4,
          border: '1px solid #333',
          borderRadius: 0,
          bgcolor: '#f5f5f5',
          fontSize: '12.5px'
        },
        ...sx
      }}
    >
      <Typography
        component="div"
        sx={{
          fontWeight: 800,
          fontSize: '0.72rem',
          lineHeight: 1.25,
          color: '#92400e',
          '@media print': { fontSize: '12.5px', color: '#111', lineHeight: 1.25 }
        }}
      >
        Store Vetting — Store does not have the required item(s) in stock
        {reason ? (
          <>
            {' · '}
            <Box component="span" sx={{ fontWeight: 700 }}>
              Remark: {reason}
            </Box>
          </>
        ) : null}
      </Typography>
      {meta ? (
        <Typography
          component="div"
          sx={{
            mt: 0.15,
            fontSize: '0.65rem',
            lineHeight: 1.2,
            color: 'text.secondary',
            '@media print': { fontSize: '11px', color: '#333', mt: 0.15 }
          }}
        >
          {meta}
        </Typography>
      ) : null}
    </Box>
  );
}
