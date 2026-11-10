import React, { useState } from 'react';
import { Box, Chip, Link, Stack, Typography } from '@mui/material';
import {
  AttachFile as AttachFileIcon,
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  InsertDriveFile as FileIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { getImageUrl } from '../../utils/imageService';
import { formatDateTime } from '../../utils/dateUtils';
import { AuditAttachmentPicker } from '../Audit/AuditActionAttachments';

const fileIcon = (mime, name) => {
  const m = String(mime || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(n)) return <ImageIcon fontSize="small" />;
  if (m === 'application/pdf' || n.endsWith('.pdf')) return <PdfIcon fontSize="small" />;
  return <FileIcon fontSize="small" />;
};

const attName = (a, idx) => a?.originalName || a?.filename || `Attachment ${idx + 1}`;

/** Upload new files to a purchase order. Resolves to the PO's full attachment list. */
export async function uploadPurchaseOrderAttachments(purchaseOrderId, files) {
  if (!purchaseOrderId || !Array.isArray(files) || files.length === 0) return null;
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  const res = await api.post(`/procurement/purchase-orders/${purchaseOrderId}/attachments`, fd);
  return res.data?.data || null;
}

const AttachmentChip = ({ att, idx, onDelete }) => (
  <Chip
    icon={fileIcon(att.mimeType, att.originalName || att.filename)}
    label={
      <Link href={getImageUrl(att.url)} target="_blank" rel="noopener noreferrer" underline="hover" color="inherit">
        {attName(att, idx)}
      </Link>
    }
    size="small"
    variant="outlined"
    clickable
    onDelete={onDelete}
  />
);

/**
 * Create / edit form section: existing PO attachments (removable) + picker for new files.
 * New files are uploaded by the caller on save (they need the PO id).
 */
export function PurchaseOrderAttachmentsEditor({
  purchaseOrderId,
  existing = [],
  onExistingChange,
  pendingFiles = [],
  onPendingChange,
  onError
}) {
  const [removingId, setRemovingId] = useState(null);

  const removeExisting = async (att) => {
    if (!purchaseOrderId || !att?._id) return;
    if (!window.confirm(`Remove "${att.originalName || att.filename}" from this purchase order?`)) return;
    try {
      setRemovingId(att._id);
      const res = await api.delete(`/procurement/purchase-orders/${purchaseOrderId}/attachments/${att._id}`);
      onExistingChange?.(Array.isArray(res.data?.data) ? res.data.data : existing.filter((a) => a._id !== att._id));
    } catch (err) {
      onError?.(err.response?.data?.message || 'Failed to remove attachment');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Box>
      {existing.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
            Attached to this PO
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {existing.map((att, idx) => (
              <AttachmentChip
                key={att._id || idx}
                att={att}
                idx={idx}
                onDelete={removingId ? undefined : () => removeExisting(att)}
              />
            ))}
          </Stack>
        </Box>
      )}
      <AuditAttachmentPicker
        label={existing.length > 0 ? 'Add more attachments' : 'Attachments (Optional)'}
        files={pendingFiles}
        onChange={onPendingChange}
      />
    </Box>
  );
}

/**
 * Read-only list of supporting files procurement attached to the PO.
 * Renders nothing when there are none; hidden when printing.
 */
export function PurchaseOrderAttachmentsPanel({ attachments, title = 'PO Attachments', sx }) {
  const list = (Array.isArray(attachments) ? attachments : []).filter((a) => a && (a.url || a.filename));
  if (list.length === 0) return null;
  return (
    <Box
      className="no-print"
      sx={{
        mb: 2,
        p: 1.5,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'primary.light',
        bgcolor: '#f5f9ff',
        '@media print': { display: 'none' },
        ...sx
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <AttachFileIcon fontSize="small" /> {title} ({list.length})
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {list.map((att, idx) => (
          <Box key={att._id || idx} title={att.uploadedAt ? `Uploaded ${formatDateTime(att.uploadedAt)}` : undefined}>
            <AttachmentChip att={att} idx={idx} />
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export default PurchaseOrderAttachmentsPanel;
