import React, { useRef, useState } from 'react';
import {
  Box, Button, CircularProgress, IconButton, List, ListItem, ListItemIcon, ListItemText, Tooltip, Typography
} from '@mui/material';
import {
  AttachFile as AttachIcon,
  CloudUpload as UploadIcon,
  DeleteOutline as DeleteIcon,
  Image as ImageIcon,
  InsertDriveFile as FileIcon,
  PictureAsPdf as PdfIcon
} from '@mui/icons-material';
import { loanService } from '../../services/loanService';
import { getImageUrl } from '../../utils/imageService';

export const LOAN_ATTACHMENT_ACCEPT = 'application/pdf,image/*,.doc,.docx,.xls,.xlsx';
const MAX_BYTES = 10 * 1024 * 1024;

const iconFor = (doc) => {
  const type = String(doc.mimeType || doc.type || doc.filePath || doc.name || '').toLowerCase();
  if (type.includes('pdf')) return <PdfIcon color="error" fontSize="small" />;
  if (type.includes('image') || /\.(png|jpe?g|gif|webp)$/.test(type)) return <ImageIcon color="primary" fontSize="small" />;
  return <FileIcon fontSize="small" />;
};
const sizeLabel = (bytes) => (bytes ? `${Math.max(1, Math.round(bytes / 1024))} KB` : '');
const personName = (u) => (u && typeof u === 'object' ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '');

/** Reject files over 10 MB before upload; returns { ok, tooBig } */
export const splitLoanFiles = (fileList) => {
  const files = Array.from(fileList || []);
  return { ok: files.filter((f) => f.size <= MAX_BYTES), tooBig: files.filter((f) => f.size > MAX_BYTES) };
};

/**
 * Loan attachments: list with open links; optional upload / remove.
 * `loanId` + `canUpload` / `canDelete` enable editing; `onChange(documents)` receives the new list.
 */
export default function LoanAttachments({ loanId, documents = [], canUpload = false, canDelete = false, onChange, onError, dense = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState('');

  const upload = async (fileList) => {
    const { ok, tooBig } = splitLoanFiles(fileList);
    if (tooBig.length) onError?.(`Over 10 MB, not uploaded: ${tooBig.map((f) => f.name).join(', ')}`);
    if (!ok.length) return;
    try {
      setBusy('upload');
      const res = await loanService.uploadDocuments(loanId, ok);
      onChange?.(res.documents || []);
    } catch (e) {
      onError?.(e.message || 'Upload failed');
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Remove attachment "${doc.name}"?`)) return;
    try {
      setBusy(doc._id);
      const res = await loanService.deleteDocument(loanId, doc._id);
      onChange?.(res.documents || []);
    } catch (e) {
      onError?.(e.message || 'Could not remove the attachment');
    } finally {
      setBusy('');
    }
  };

  return (
    <Box>
      {documents.length ? (
        <List dense disablePadding>
          {documents.map((doc) => (
            <ListItem
              key={doc._id || doc.filePath}
              disableGutters
              secondaryAction={canDelete ? (
                <Tooltip title="Remove">
                  <span>
                    <IconButton edge="end" size="small" disabled={busy === doc._id} onClick={() => remove(doc)}>
                      {busy === doc._id ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>{iconFor(doc)}</ListItemIcon>
              <ListItemText
                primary={(
                  <Typography component="a" href={getImageUrl(doc.filePath)} target="_blank" rel="noopener noreferrer"
                    variant="body2" color="primary" sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                    {doc.name}
                  </Typography>
                )}
                secondary={dense ? null : [sizeLabel(doc.size), personName(doc.uploadedBy),
                  doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('en-GB') : ''].filter(Boolean).join(' · ')}
              />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" color="text.secondary">No attachments.</Typography>
      )}
      {canUpload && (
        <>
          <input ref={inputRef} type="file" hidden multiple accept={LOAN_ATTACHMENT_ACCEPT}
            onChange={(e) => upload(e.target.files)} />
          <Button size="small" variant="outlined" sx={{ mt: 1 }} disabled={busy === 'upload'}
            startIcon={busy === 'upload' ? <CircularProgress size={16} /> : <UploadIcon />}
            onClick={() => inputRef.current?.click()}>
            Add attachments
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            <AttachIcon sx={{ fontSize: 12, verticalAlign: 'middle' }} /> PDF, image, Word or Excel — up to 10 MB each
          </Typography>
        </>
      )}
    </Box>
  );
}
