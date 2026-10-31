/**
 * Check request supporting documents: an upload field for the create / edit form (at least one file is required)
 * and a read-only list for the view and the IPC review file.
 */
import React, { useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import {
  AttachFile as AttachIcon, Close as RemoveIcon, Description as DocIcon, Image as ImageIcon,
  PictureAsPdf as PdfIcon, TableChart as SheetIcon
} from '@mui/icons-material';
import { uploadCheckRequestAttachments } from '../../services/projectManagementService';
import { getImageUrl } from '../../utils/imageService';

const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv';

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const iconFor = (a) => {
  const t = a.mimeType || '';
  if (t.startsWith('image/')) return <ImageIcon fontSize="small" sx={{ color: '#0ea5e9' }} />;
  if (t === 'application/pdf') return <PdfIcon fontSize="small" sx={{ color: '#dc2626' }} />;
  if (/sheet|excel|csv/.test(t)) return <SheetIcon fontSize="small" sx={{ color: '#16a34a' }} />;
  return <DocIcon fontSize="small" sx={{ color: '#4f46e5' }} />;
};

/** One file row; images show a small preview, everything opens in a new tab */
const FileRow = ({ a, onRemove }) => (
  <Stack direction="row" alignItems="center" gap={1.25} sx={{ p: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
    {(a.mimeType || '').startsWith('image/')
      ? <Box component="img" src={getImageUrl(a.url)} alt="" sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />
      : <Box sx={{ width: 36, height: 36, display: 'grid', placeItems: 'center', bgcolor: '#f8fafc', borderRadius: 1, flexShrink: 0 }}>{iconFor(a)}</Box>}
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography
        component="a" href={getImageUrl(a.url)} target="_blank" rel="noopener noreferrer"
        variant="body2" fontWeight={700} noWrap sx={{ display: 'block', color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
      >
        {a.originalName || 'Attachment'}
      </Typography>
      {a.size > 0 && <Typography variant="caption" color="text.secondary">{kb(a.size)}</Typography>}
    </Box>
    {onRemove && (
      <Tooltip title="Remove">
        <IconButton size="small" onClick={onRemove}><RemoveIcon fontSize="small" /></IconButton>
      </Tooltip>
    )}
  </Stack>
);

/** Upload field: value = [{ url, originalName, mimeType, size }] */
export function CheckRequestAttachmentsField({ projectId, value = [], onChange, error }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const pick = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await uploadCheckRequestAttachments(projectId, files);
      onChange([...value, ...(res.data?.data || [])]);
      if (res.data?.message && res.data.message !== 'Uploaded') setMessage(res.data.message);
    } catch (e) {
      setMessage(e.response?.data?.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" fontWeight={700}>
            Supporting documents <Box component="span" sx={{ color: 'error.main' }}>*</Box>
          </Typography>
          <Typography variant="caption" color="text.secondary">Measurement sheet, site photos, contractor&apos;s bill — photos, PDF, Word or Excel, up to 20 MB each</Typography>
        </Box>
        <Button
          variant="outlined" size="small" startIcon={busy ? <CircularProgress size={14} /> : <AttachIcon />} disabled={busy}
          onClick={() => input.current?.click()} sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          {busy ? 'Uploading…' : 'Attach files'}
        </Button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => pick(e.target.files)} />
      </Stack>
      <Box
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files); }}
        sx={{
          p: value.length ? 1 : 2.5, borderRadius: 2, border: '1.5px dashed', textAlign: value.length ? 'left' : 'center',
          borderColor: error && !value.length ? 'error.main' : 'divider', bgcolor: error && !value.length ? '#fef2f2' : '#f8fafc'
        }}
      >
        {value.length ? (
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            {value.map((a, i) => <FileRow key={`${a.url}-${i}`} a={a} onRemove={() => onChange(value.filter((_, k) => k !== i))} />)}
          </Box>
        ) : (
          <Typography variant="body2" color={error ? 'error.main' : 'text.secondary'}>
            {error ? 'At least one document is required — ' : ''}Drop files here or use “Attach files”
          </Typography>
        )}
      </Box>
      {message && <Alert severity="warning" sx={{ mt: 1 }} onClose={() => setMessage('')}>{message}</Alert>}
    </Box>
  );
}

/** Read-only list */
export function CheckRequestAttachmentsList({ attachments = [], emptyText = 'No documents attached' }) {
  if (!attachments.length) return <Typography variant="body2" color="text.secondary">{emptyText}</Typography>;
  return (
    <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
      {attachments.map((a, i) => <FileRow key={`${a.url}-${i}`} a={a} />)}
    </Box>
  );
}
