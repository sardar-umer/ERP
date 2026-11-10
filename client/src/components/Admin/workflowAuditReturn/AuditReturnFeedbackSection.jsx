import React from 'react';
import {
  Alert,
  Box,
  Chip,
  Divider,
  Stack,
  Typography
} from '@mui/material';
import { AuditActionAttachmentsPanel } from '../../Audit/AuditActionAttachments';

const SETTLEMENT_PANEL_SX = {
  mb: 3,
  mt: 4,
  pt: 3,
  px: 2.5,
  pb: 2.5,
  borderRadius: 1,
  border: '2px solid',
  borderColor: '#d32f2f',
  bgcolor: '#ffebee'
};

const DEFAULT_PANEL_SX = {
  mb: 3,
  p: 2,
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'warning.light',
  bgcolor: 'warning.50'
};

function severityIsElevated(sev) {
  return /high|critical|urgent/i.test(String(sev || ''));
}

/**
 * Read-only panel: audit return context + structured observations (shared across admin workflow modules).
 */
export function AuditReturnFeedbackSection({
  /** When set, files Audit attached on reject/return are listed inside the panel. */
  documentId,
  auditStatus,
  returnedAuditStatus = 'Returned from Audit',
  latestReturnHistory,
  observations = [],
  getObservationKey,
  formatDateTime,
  userDisplayName,
  /** Preset look: `settlement` matches legacy payment-settlement “critical observations” styling. */
  visualVariant = 'default',
  returnedIntro = (
    <>
      This document was returned for correction. Review the points below, use <strong>Edit</strong> to update the
      record if needed, then use <strong>Resend to Pre-Audit</strong> when you are ready.
    </>
  ),
  rejectedIntro = (
    <>
      This document was <strong>rejected</strong> with the observations below. Review them before correcting and
      resubmitting.
    </>
  ),
  emptyReturnFallback = (
    <>
      No structured observation list was stored on this return; use the return note above or contact audit if you need
      details.
    </>
  ),
  /** Shown above the list when any observation has an admin/department reply (e.g. after resubmit to audit). */
  answeredIntro = null,
  /** Heading for the green reply block under each observation. */
  answerTitle = 'Answer:'
}) {
  const isSettlement = visualVariant === 'settlement';
  const obsList = Array.isArray(observations) ? observations : [];
  const keyFn =
    getObservationKey ||
    ((obs, idx) => String(obs?._id || obs?.id || `row-${idx}`));
  const hasAnswers = obsList.some((obs) => String(obs?.answer || '').trim());

  const statusLabel = String(auditStatus || '');
  const isReturned = statusLabel === returnedAuditStatus;
  const isRejected = /rejected/i.test(statusLabel);

  const showPanel =
    obsList.length > 0 ||
    latestReturnHistory ||
    isReturned ||
    isRejected;

  if (!showPanel) return null;

  const panelSx = isSettlement ? SETTLEMENT_PANEL_SX : DEFAULT_PANEL_SX;
  const returnAlertSeverity = isSettlement ? 'error' : 'warning';
  const panelTitle = isSettlement
    ? 'Critical observations'
    : isRejected && !isReturned
      ? 'Rejection feedback'
      : 'Audit feedback';

  return (
    <Box sx={panelSx}>
      <Typography
        variant="subtitle1"
        sx={
          isSettlement
            ? { fontWeight: 700, fontSize: '15px', color: '#d32f2f', textTransform: 'uppercase', mb: 2 }
            : { fontWeight: 800, mb: 1 }
        }
      >
        {panelTitle}
      </Typography>
      {isRejected && !isReturned && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {rejectedIntro}
        </Alert>
      )}
      {isReturned && (
        <Alert severity={returnAlertSeverity} sx={{ mb: 2 }}>
          {returnedIntro}
        </Alert>
      )}
      {hasAnswers && answeredIntro && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {answeredIntro}
        </Alert>
      )}
      {latestReturnHistory?.comments && (
        <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
          <Box component="span" sx={{ fontWeight: 700 }}>Latest return note: </Box>
          {latestReturnHistory.comments}
        </Typography>
      )}
      {obsList.length > 0 && (
        <Stack spacing={isSettlement ? 2 : 1.5} divider={isSettlement ? undefined : <Divider flexItem />}>
          {obsList.map((obs, idx) => {
            const k = keyFn(obs, idx);
            const sev = String(obs.severity || 'medium');
            const critical = isSettlement && severityIsElevated(sev);
            return (
              <Box
                key={k}
                sx={
                  isSettlement
                    ? {
                        p: 1.5,
                        borderRadius: 1,
                        bgcolor: critical ? '#ffcdd2' : '#fff',
                        border: `1px solid ${critical ? '#d32f2f' : '#ef5350'}`,
                        ...(idx < obsList.length - 1
                          ? { borderBottom: '1px dashed', borderColor: 'error.light', pb: 2, mb: 0 }
                          : {})
                      }
                    : undefined
                }
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.5 }}>
                  {critical ? (
                    <Chip
                      size="small"
                      label={sev.toUpperCase()}
                      sx={{
                        bgcolor: '#d32f2f',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '10px'
                      }}
                    />
                  ) : (
                    <Chip size="small" label={`Severity: ${sev}`} variant="outlined" />
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {formatDateTime(obs.addedAt)} — {userDisplayName(obs.addedBy)}
                  </Typography>
                  {obs.resolved && (
                    <Chip
                      size="small"
                      label={isSettlement ? 'RESOLVED' : 'Replied'}
                      color="success"
                      variant="outlined"
                      sx={isSettlement ? { fontSize: '10px' } : undefined}
                    />
                  )}
                </Stack>
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    fontWeight: isSettlement ? 500 : 600,
                    ...(isSettlement ? { color: '#c62828', lineHeight: 1.7, fontSize: '12px' } : {})
                  }}
                >
                  {obs.observation}
                </Typography>
                {String(obs.answer || '').trim() ? (
                  <Box
                    sx={{
                      mt: 2,
                      pt: 2,
                      borderTop: '1px solid #4caf50',
                      bgcolor: '#e8f5e9',
                      p: 1.5,
                      borderRadius: 1
                    }}
                  >
                    <Typography
                      variant="subtitle2"
                      sx={{ color: '#2e7d32', fontWeight: 'bold', mb: 1, fontSize: isSettlement ? undefined : '0.875rem' }}
                    >
                      {answerTitle}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontSize: isSettlement ? '12px' : '0.875rem',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.7,
                        color: '#1b5e20'
                      }}
                    >
                      {obs.answer}
                    </Typography>
                    {obs.answeredBy ? (
                      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#2e7d32', fontSize: '11px' }}>
                        — {userDisplayName(obs.answeredBy)}
                        {obs.answeredAt ? ` • ${formatDateTime(obs.answeredAt)}` : ''}
                      </Typography>
                    ) : obs.answeredAt ? (
                      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#2e7d32', fontSize: '11px' }}>
                        {formatDateTime(obs.answeredAt)}
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Stack>
      )}
      {obsList.length === 0 && (isReturned || isRejected) && !latestReturnHistory?.comments && (
        <Typography variant="body2" color="text.secondary">
          {emptyReturnFallback}
        </Typography>
      )}
      {documentId ? (
        <AuditActionAttachmentsPanel documentId={documentId} sx={{ mt: 2, mb: 0, bgcolor: '#fff' }} />
      ) : null}
    </Box>
  );
}
