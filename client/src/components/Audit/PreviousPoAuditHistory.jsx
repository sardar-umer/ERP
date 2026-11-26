import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, Divider, Link, Stack, Typography } from '@mui/material';
import {
  History as HistoryIcon,
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  InsertDriveFile as FileIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { getImageUrl } from '../../utils/imageService';
import { formatDateTime } from '../../utils/dateUtils';
import { formatPKR } from '../../utils/currency';

const fileIcon = (mime) => {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return <ImageIcon fontSize="small" />;
  if (m === 'application/pdf') return <PdfIcon fontSize="small" />;
  return <FileIcon fontSize="small" />;
};

const userName = (u) => {
  if (!u || typeof u !== 'object') return '';
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';
};

const obsText = (o) => (typeof o === 'object' ? o?.observation : o) || '';

/**
 * For a PO that replaces one Audit rejected, shows the audit feedback left on the earlier
 * PO(s): rejection comments, observations and the files Audit attached. Renders nothing
 * when the PO is not a replacement.
 */
export default function PreviousPoAuditHistory({ purchaseOrderId, sx }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!purchaseOrderId) {
      setRows([]);
      return undefined;
    }
    api
      .get(`/pre-audit/purchase-order/${purchaseOrderId}/previous-audit-history`)
      .then((res) => {
        if (!cancelled) setRows(Array.isArray(res.data?.data) ? res.data.data : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [purchaseOrderId]);

  if (rows.length === 0) return null;

  return (
    <Alert
      severity="warning"
      icon={<HistoryIcon />}
      sx={{ m: 2, '& .MuiAlert-message': { width: '100%' }, '@media print': { display: 'none' }, ...sx }}
    >
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Earlier audit feedback — this PO replaces {rows.length === 1 ? 'a rejected PO' : `${rows.length} earlier POs`}
      </Typography>
      <Stack spacing={1.5} divider={<Divider flexItem />}>
        {rows.map((po) => {
          const observations = [...(po.auditObservations || []), ...(po.auditRejectObservations || [])]
            .filter((o) => obsText(o).trim());
          const comments = [];
          if (po.auditRejectionComments) {
            comments.push({ text: po.auditRejectionComments, by: po.auditRejectedBy, at: po.auditRejectedAt, label: 'Rejected' });
          }
          if (po.auditReturnComments && po.auditReturnComments.trim() !== String(po.auditRejectionComments || '').trim()) {
            comments.push({ text: po.auditReturnComments, at: po.auditReturnedAt, label: 'Returned' });
          }
          (po.auditSteps || []).forEach((s) => {
            if (s.comments && !comments.some((c) => c.text.trim() === String(s.comments).trim())) {
              comments.push({ text: s.comments, by: s.changedBy, at: s.changedAt, label: s.toStatus });
            }
          });
          const files = (po.attachments || []).flatMap((a) => (a.files || []).map((f) => ({ ...f, by: a.uploadedBy, at: a.createdAt })));
          return (
            <Box key={po._id}>
              <Typography variant="body2" fontWeight={700}>
                {po.orderNumber} — {po.status}
                {po.totalAmount != null ? ` • ${formatPKR(po.totalAmount)}` : ''}
              </Typography>
              {comments.map((c, i) => (
                <Box key={`c-${i}`} sx={{ mt: 0.5 }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{c.text}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {c.label}{userName(c.by) ? ` by ${userName(c.by)}` : ''}{c.at ? `, ${formatDateTime(c.at)}` : ''}
                  </Typography>
                </Box>
              ))}
              {observations.length > 0 && (
                <Box sx={{ mt: 0.5 }}>
                  {observations.map((o, i) => (
                    <Box key={`o-${i}`} sx={{ mt: 0.5 }}>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        Observation {i + 1}{o?.severity ? ` [${String(o.severity).toUpperCase()}]` : ''}: {obsText(o)}
                      </Typography>
                      {(userName(o?.addedBy) || o?.addedAt) && (
                        <Typography variant="caption" color="text.secondary">
                          {userName(o?.addedBy)}{o?.addedAt ? `${userName(o?.addedBy) ? ', ' : ''}${formatDateTime(o.addedAt)}` : ''}
                        </Typography>
                      )}
                      {o?.answer && (
                        <Typography variant="body2" sx={{ ml: 2, whiteSpace: 'pre-wrap' }}>Response: {o.answer}</Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              )}
              {files.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                  {files.map((f) => (
                    <Chip
                      key={f._id || f.filename}
                      icon={fileIcon(f.mimeType)}
                      label={
                        <Link href={getImageUrl(f.path)} target="_blank" rel="noopener noreferrer" underline="hover" color="inherit">
                          {f.originalName || f.filename}
                        </Link>
                      }
                      size="small"
                      variant="outlined"
                      clickable
                    />
                  ))}
                </Stack>
              )}
              {po.replacementJustification && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Procurement's reason for the replacement: {po.replacementJustification}
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
    </Alert>
  );
}
