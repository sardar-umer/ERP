import React from 'react';
import { Box, Chip, Divider, Paper, Typography } from '@mui/material';
import { formatDateTime } from '../../../utils/dateUtils';

const STAGE_LABELS = {
  'Pending HOD HR': 'HOD HR',
  'Pending AVP': 'AVP',
  'Pending Chairman': 'Chairman Steering Committee',
  'Pending Sr Director': 'Sr Director',
  'Forwarded to CEO': 'CEO Secretariat'
};

const stageLabel = (status) => STAGE_LABELS[status] || status || '—';

/**
 * Return → resubmit cycles for a New-Hiring Approval record:
 * authority's remarks/observations and the initiator's comment + responses.
 */
const ResubmissionHistory = ({ record, sx }) => {
  const history = Array.isArray(record?.resubmissionHistory) ? record.resubmissionHistory : [];
  if (!history.length) return null;

  // Latest first
  const entries = [...history].reverse();

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, ...sx }}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ fontWeight: 600, letterSpacing: 1, display: 'block', mb: 1.5 }}
      >
        Return &amp; Resubmission History ({history.length})
      </Typography>
      {entries.map((entry, idx) => {
        const cycleNo = history.length - idx;
        const observations = Array.isArray(entry.observations)
          ? entry.observations.filter((o) => String(o?.observation || '').trim())
          : [];
        return (
          <Box key={entry._id || idx} sx={{ mb: idx < entries.length - 1 ? 2 : 0 }}>
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={1}>
              <Chip size="small" label={`Cycle ${cycleNo}`} color={idx === 0 ? 'primary' : 'default'} />
              <Typography variant="body2" color="text.secondary">
                Returned by <strong>{entry.returnedByName || stageLabel(entry.returnedFromStatus)}</strong>
                {' '}({stageLabel(entry.returnedFromStatus)})
                {entry.returnedAt ? ` on ${formatDateTime(entry.returnedAt)}` : ''}
              </Typography>
            </Box>

            {entry.returnComments ? (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
                <strong>Remarks:</strong> {entry.returnComments}
              </Typography>
            ) : null}

            {observations.length > 0 && (
              <Box component="ol" sx={{ m: 0, mb: 1, pl: 2.5 }}>
                {observations.map((obs, oIdx) => (
                  <Box component="li" key={obs._id || oIdx} sx={{ mb: 0.75 }}>
                    <Typography variant="body2">
                      <strong style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
                        [{obs.severity || 'medium'}]
                      </strong>{' '}
                      {obs.observation}
                    </Typography>
                    {obs.response ? (
                      <Typography
                        variant="body2"
                        color="success.dark"
                        sx={{ whiteSpace: 'pre-wrap', pl: 1.5, borderLeft: '3px solid', borderColor: 'success.light', mt: 0.25 }}
                      >
                        <strong>Response:</strong> {obs.response}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Box>
            )}

            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                <strong>Initiator comment:</strong> {entry.initiatorComment || '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Resubmitted{entry.resubmittedByName ? ` by ${entry.resubmittedByName}` : ''}
                {entry.resubmittedAt ? ` on ${formatDateTime(entry.resubmittedAt)}` : ''}
                {entry.resubmittedTo ? ` → ${stageLabel(entry.resubmittedTo)}` : ''}
              </Typography>
            </Box>
            {idx < entries.length - 1 && <Divider sx={{ mt: 2 }} />}
          </Box>
        );
      })}
    </Paper>
  );
};

export default ResubmissionHistory;
