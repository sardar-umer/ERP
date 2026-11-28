import React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { getWorkflowFeedbackObservations } from '../Admin/workflowAuditReturn';
import { AUDIT_RED_BOX_SX, AUDIT_RED_TITLE_SX, AUDIT_RED_ITEM_SX } from './auditRedBoxStyles';
import { getInitialAuditNotes, auditPersonName } from './auditInitialNotes';
import PreviousPoAuditHistory from './PreviousPoAuditHistory';
import { formatDateTime } from '../../utils/dateUtils';

const text = (v) => String(v || '').trim();

/**
 * Read-only audit feedback for the CEO desk, in the red audit box:
 * - notes from the initial pre-audit review
 * - audit observations with the department's replies, and reject / return comments
 * - for a replacement PO, the feedback Audit left on the PO(s) it replaces
 * Renders nothing when the document has none.
 *
 * @param {object} doc
 * @param {boolean} [showObservations=true] false where the document view already lists observations
 * @param {boolean} [showEarlierPoFeedback=false] PO only: show earlier rejected POs' feedback
 */
export default function CeoAuditFeedbackPanel({ doc, showObservations = true, showEarlierPoFeedback = false, sx }) {
  if (!doc) return null;

  const { entries } = getInitialAuditNotes(doc);
  const observations = showObservations
    ? getWorkflowFeedbackObservations(doc)
      .filter((o) => text(o?.observation))
      // IPCs keep the department's reply as initiatorResponse
      .map((o) => ({ ...o, answer: o.answer || o.initiatorResponse }))
    : [];
  const comments = [];
  if (showObservations) {
    const add = (label, value, by, at) => {
      const t = text(value);
      if (t && !comments.some((c) => c.text === t) && !observations.some((o) => text(o.observation) === t)) {
        comments.push({ label, text: t, by: auditPersonName(by), at });
      }
    };
    add('Rejection comments', doc.auditRejectionComments, doc.auditRejectedBy, doc.auditRejectedAt);
    add('Return comments', doc.auditReturnComments, doc.auditReturnedBy, doc.auditReturnedAt);
    add('Audit Director comments', doc.auditComments, doc.auditApprovedBy, doc.auditApprovedAt);
    if (/audit/i.test(String(doc.rejection?.stage || ''))) {
      add('Rejection comments', doc.rejection?.comments, doc.rejection?.by, doc.rejection?.at);
    }
  }

  const hasMain = entries.length > 0 || observations.length > 0 || comments.length > 0;
  const earlier = showEarlierPoFeedback && doc.revisedFrom && doc._id
    ? <PreviousPoAuditHistory purchaseOrderId={doc._id} sx={{ m: 0, mb: 2 }} />
    : null;
  if (!hasMain && !earlier) return null;

  return (
    <Box sx={{ px: 2, pt: 2, '@media print': { display: 'none' }, ...sx }}>
      {hasMain && (
        <Box sx={{ p: 2, mb: 2, ...AUDIT_RED_BOX_SX }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5, ...AUDIT_RED_TITLE_SX }}>
            {observations.length || comments.length ? 'Audit observations' : 'Pre-audit notes'}
          </Typography>

          {entries.length > 0 && (
            <Box sx={{ mb: observations.length || comments.length ? 2 : 0 }}>
              {(observations.length > 0 || comments.length > 0) && (
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Observation from initial pre-audit</Typography>
              )}
              {entries.map((e, i) => (
                <Box key={`n-${i}`} sx={{ mb: 1 }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{e.text}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {e.label}{e.by ? ` — ${e.by}` : ''}{e.at ? `, ${formatDateTime(e.at)}` : ''}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {comments.map((c, i) => (
            <Box key={`c-${i}`} sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{c.label}:</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{c.text}</Typography>
              {(c.by || c.at) && (
                <Typography variant="caption" color="text.secondary">
                  {c.by}{c.at ? `${c.by ? ', ' : ''}${formatDateTime(c.at)}` : ''}
                </Typography>
              )}
            </Box>
          ))}

          {observations.length > 0 && (
            <Stack spacing={1.5}>
              {observations.map((o, i) => (
                <Box key={o._id || i} sx={{ p: 1.5, ...AUDIT_RED_ITEM_SX }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Observation {i + 1}</Typography>
                    {o.severity && <Chip size="small" variant="outlined" label={String(o.severity).toUpperCase()} />}
                    {text(o.stage) && <Chip size="small" variant="outlined" label={o.stage} />}
                    {(auditPersonName(o.addedBy) || o.addedAt) && (
                      <Typography variant="caption" color="text.secondary">
                        {auditPersonName(o.addedBy)}{o.addedAt ? `${auditPersonName(o.addedBy) ? ', ' : ''}${formatDateTime(o.addedAt)}` : ''}
                      </Typography>
                    )}
                  </Stack>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{o.observation}</Typography>
                  {text(o.answer) ? (
                    <Box sx={{ mt: 1.5, p: 1.5, bgcolor: '#e8f5e9', borderTop: '1px solid #4caf50', borderRadius: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5, color: '#2e7d32' }}>
                        Department response:
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: '#1b5e20' }}>{o.answer}</Typography>
                      {(auditPersonName(o.answeredBy) || o.answeredAt) && (
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: '#2e7d32' }}>
                          — {auditPersonName(o.answeredBy)}{o.answeredAt ? ` • ${formatDateTime(o.answeredAt)}` : ''}
                        </Typography>
                      )}
                    </Box>
                  ) : (
                    <Typography variant="caption" sx={{ display: 'block', mt: 1, fontStyle: 'italic', color: 'text.secondary' }}>
                      No response from the department
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      )}
      {earlier}
    </Box>
  );
}
