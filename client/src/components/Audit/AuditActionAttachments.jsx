import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Link,
  Stack,
  Typography
} from '@mui/material';
import {
  AttachFile as AttachFileIcon,
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  InsertDriveFile as FileIcon
} from '@mui/icons-material';
import api from '../../services/api';
import { getImageUrl } from '../../utils/imageService';
import { formatDateTime } from '../../utils/dateUtils';

const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx';
const MAX_FILES = 10;
const MAX_SIZE = 10 * 1024 * 1024;

const ACTION_LABEL = {
  reject: 'Rejected',
  return: 'Returned',
  observation: 'Observation'
};

const fileIcon = (mime) => {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return <ImageIcon fontSize="small" />;
  if (m === 'application/pdf') return <PdfIcon fontSize="small" />;
  return <FileIcon fontSize="small" />;
};

const userName = (u) => {
  if (!u) return '';
  if (typeof u === 'string') return u;
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';
};

/**
 * Upload files Audit attached while rejecting / returning a document.
 * Resolves to the created record, or null when there is nothing to upload.
 */
export async function uploadAuditActionAttachments(documentId, files, { action = 'reject', documentType = '', comments = '' } = {}) {
  if (!documentId || !Array.isArray(files) || files.length === 0) return null;
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  fd.append('action', action);
  if (documentType) fd.append('documentType', documentType);
  if (comments) fd.append('comments', comments);
  const res = await api.post(`/pre-audit/${documentId}/audit-attachments`, fd);
  return res.data?.data || null;
}

/** File picker used inside the Pre-Audit reject / return dialogs. */
export function AuditAttachmentPicker({ files = [], onChange, label = 'Attachments (Optional)', disabled = false }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');

  const handleSelect = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    const tooBig = picked.filter((f) => f.size > MAX_SIZE);
    const ok = picked.filter((f) => f.size <= MAX_SIZE);
    const merged = [...files, ...ok].slice(0, MAX_FILES);
    setError(
      tooBig.length
        ? `${tooBig.map((f) => f.name).join(', ')} exceed 10 MB and were skipped.`
        : files.length + ok.length > MAX_FILES
          ? `Only ${MAX_FILES} files can be attached.`
          : ''
    );
    onChange(merged);
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
        {label}
      </Typography>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={handleSelect} />
      <Button
        variant="outlined"
        size="small"
        startIcon={<AttachFileIcon />}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || files.length >= MAX_FILES}
      >
        Attach Files
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
        Images, PDF, Word, Excel — up to {MAX_FILES} files, 10 MB each
      </Typography>
      {files.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {files.map((f, idx) => (
            <Chip
              key={`${f.name}-${idx}`}
              icon={fileIcon(f.type)}
              label={f.name}
              size="small"
              onDelete={disabled ? undefined : () => onChange(files.filter((_, i) => i !== idx))}
            />
          ))}
        </Stack>
      )}
      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Read-only list of files Audit attached when rejecting / returning this document.
 * Renders nothing when there are none, so it can be dropped into any returned-document view.
 */
export function AuditActionAttachmentsPanel({ documentId, title = 'Audit attachments', refreshKey, sx }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!documentId) {
      setRows([]);
      return undefined;
    }
    api
      .get(`/pre-audit/${documentId}/audit-attachments`)
      .then((res) => {
        if (!cancelled) setRows(Array.isArray(res.data?.data) ? res.data.data : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, refreshKey]);

  const withFiles = rows.filter((r) => Array.isArray(r.files) && r.files.length > 0);
  if (withFiles.length === 0) return null;

  return (
    <Box
      sx={{
        mb: 2,
        p: 2,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'error.light',
        bgcolor: '#fff8f8',
        ...sx
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <AttachFileIcon fontSize="small" /> {title}
      </Typography>
      <Stack spacing={1.5}>
        {withFiles.map((r) => (
          <Box key={r._id}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {ACTION_LABEL[r.action] || 'Audit'} by {userName(r.uploadedBy) || 'Audit'}
              {r.createdAt ? ` • ${formatDateTime(r.createdAt)}` : ''}
            </Typography>
            {r.comments ? (
              <Typography variant="body2" sx={{ mb: 0.5, whiteSpace: 'pre-wrap' }}>
                {r.comments}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {r.files.map((f) => (
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
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export default AuditActionAttachmentsPanel;
