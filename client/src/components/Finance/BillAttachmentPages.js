import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { getImageUrl } from '../../utils/imageService';

/**
 * Bill attachments, each on its own printed page after the bill. Images print as they are; PDFs are drawn
 * page by page with PDF.js (a browser can't reliably print a PDF embedded in a page), one printed page per PDF
 * page. Other file types get a page naming the file. `onReady` fires once everything is drawn, so an automatic
 * print waits for the attachments.
 */

const isImage = (a) => /^image\//i.test(a.mimeType || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.path || a.filename || '');
const isPdf = (a) => /pdf/i.test(a.mimeType || '') || /\.pdf$/i.test(a.path || a.filename || '');
const fileUrl = (a) => getImageUrl(a.path || a.url || (a.filename ? `/uploads/finance/${a.filename}` : ''));
const fileName = (a) => a.originalName || a.filename || 'Attachment';

const loadPdfJs = async () => {
  const pdfjs = await import('pdfjs-dist/build/pdf');
  // Registers PDF.js's worker code on the page, so PDFs render without a separate worker file
  await import('pdfjs-dist/build/pdf.worker.entry');
  return pdfjs;
};

/** PDF → one PNG data URL per page */
const renderPdfPages = async (url) => {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ url, withCredentials: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pages.push(canvas.toDataURL('image/png'));
  }
  return pages;
};

const pageSx = {
  maxWidth: '210mm',
  mx: 'auto',
  mt: 3,
  p: { xs: 2, sm: 3 },
  bgcolor: '#fff',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  borderRadius: 1,
  breakBefore: 'page',
  pageBreakBefore: 'always',
  '@media print': { mt: 0, p: '8mm 12mm', boxShadow: 'none', borderRadius: 0, maxWidth: '100%' }
};

const imgSx = {
  display: 'block',
  maxWidth: '100%',
  maxHeight: '250mm',
  objectFit: 'contain',
  mx: 'auto',
  '@media print': { maxHeight: '255mm' }
};

const Header = ({ index, total, name, part }) => (
  <Typography variant="caption" sx={{ display: 'block', color: '#475569', mb: 1, fontWeight: 600 }}>
    Attachment {index} of {total} — {name}{part ? ` (page ${part})` : ''}
  </Typography>
);

export default function BillAttachmentPages({ attachments = [], onReady }) {
  const files = (attachments || []).filter((a) => a && (a.path || a.url || a.filename));
  // pdfPages[i]: undefined = loading, [] / array of data URLs, or { error }
  const [pdfPages, setPdfPages] = useState({});

  useEffect(() => {
    let cancelled = false;
    const pdfIdx = files.map((a, i) => (isPdf(a) ? i : -1)).filter((i) => i >= 0);
    if (!pdfIdx.length) return undefined;
    Promise.all(pdfIdx.map(async (i) => {
      try {
        const pages = await renderPdfPages(fileUrl(files[i]));
        return [i, pages];
      } catch (e) {
        return [i, { error: e?.message || 'Could not open the PDF' }];
      }
    })).then((results) => {
      if (!cancelled) setPdfPages(Object.fromEntries(results));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(files.map((a) => a.path || a.url || a.filename))]);

  const pending = files.some((a, i) => isPdf(a) && pdfPages[i] === undefined);
  useEffect(() => {
    if (!pending && onReady) onReady();
  }, [pending, onReady]);

  if (!files.length) return null;
  const total = files.length;

  return (
    <>
      {files.map((a, i) => {
        const name = fileName(a);
        if (isImage(a)) {
          return (
            <Box key={i} sx={pageSx} className="bill-attachment-page">
              <Header index={i + 1} total={total} name={name} />
              <Box component="img" src={fileUrl(a)} alt={name} sx={imgSx} />
            </Box>
          );
        }
        if (isPdf(a)) {
          const pages = pdfPages[i];
          if (pages === undefined) {
            return (
              <Box key={i} sx={{ ...pageSx, display: 'flex', alignItems: 'center', gap: 1, '@media print': { display: 'none' } }}>
                <CircularProgress size={18} />
                <Typography variant="body2">Preparing {name} for printing…</Typography>
              </Box>
            );
          }
          if (pages.error) {
            return (
              <Box key={i} sx={pageSx} className="bill-attachment-page">
                <Header index={i + 1} total={total} name={name} />
                <Typography variant="body2" color="error">This PDF could not be opened for printing ({pages.error}).</Typography>
              </Box>
            );
          }
          return pages.map((src, p) => (
            <Box key={`${i}-${p}`} sx={pageSx} className="bill-attachment-page">
              <Header index={i + 1} total={total} name={name} part={pages.length > 1 ? `${p + 1} of ${pages.length}` : ''} />
              <Box component="img" src={src} alt={`${name} page ${p + 1}`} sx={imgSx} />
            </Box>
          ));
        }
        return (
          <Box key={i} sx={pageSx} className="bill-attachment-page">
            <Header index={i + 1} total={total} name={name} />
            <Typography variant="body2" color="text.secondary">
              This file type can&apos;t be printed here — open it from the bill to print it separately.
            </Typography>
          </Box>
        );
      })}
    </>
  );
}
