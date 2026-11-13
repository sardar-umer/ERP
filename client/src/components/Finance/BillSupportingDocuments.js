import React from 'react';
import {
  Box, Chip, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography
} from '@mui/material';
import {
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  InsertDriveFile as FileIcon
} from '@mui/icons-material';
import { getImageUrl } from '../../utils/imageService';
import { formatDate } from '../../utils/dateUtils';

const fileIcon = (doc) => {
  const mime = String(doc.mimeType || '').toLowerCase();
  const name = String(doc.url || doc.name || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(name)) return <ImageIcon fontSize="small" color="action" />;
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return <PdfIcon fontSize="small" color="action" />;
  return <FileIcon fontSize="small" color="action" />;
};

/** Documents the bill is based on (GRN, PO, indent, quotations), named so the reader knows the trail. */
const linkedDocumentLabels = (poDetail) => {
  const labels = [];
  (poDetail?.grns || []).forEach((g) => labels.push(`GRN ${g.receiveNumber || ''}`.trim()));
  if (poDetail?.po) labels.push(`Purchase Order ${poDetail.po.orderNumber || ''}`.trim());
  if (poDetail?.indent) labels.push(`Indent ${poDetail.indent.indentNumber || ''}`.trim());
  const quotes = poDetail?.quotations?.length || 0;
  if (quotes) labels.push(`${quotes} quotation${quotes > 1 ? 's' : ''}`);
  return labels;
};

/**
 * All files that back a vendor bill — its own attachments plus the files on its GRN(s), purchase order,
 * indent and quotations — in one list. `documents` comes from the bill detail (`supportingDocuments`).
 */
const BillSupportingDocuments = ({ documents = [], poDetail = null, title = 'Supporting Documents' }) => {
  const labels = linkedDocumentLabels(poDetail);
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        {title} ({documents.length})
      </Typography>
      {labels.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">Bill is based on:</Typography>
          {labels.map((l) => <Chip key={l} label={l} size="small" variant="outlined" />)}
        </Stack>
      )}
      {documents.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
          No files are attached to this bill or its linked documents.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ fontWeight: 'bold' }}>From</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>File</TableCell>
                <TableCell sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>Uploaded</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id || doc.url} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{doc.source}</TableCell>
                  <TableCell>
                    <Stack direction="row" alignItems="center" gap={1}>
                      {fileIcon(doc)}
                      <Link href={getImageUrl(doc.url)} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ wordBreak: 'break-word' }}>
                        {doc.name}
                      </Link>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{doc.uploadedAt ? formatDate(doc.uploadedAt) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default BillSupportingDocuments;
