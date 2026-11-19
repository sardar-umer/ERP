import React, { useEffect, useRef } from 'react';
import { Box, GlobalStyles, Typography } from '@mui/material';
import { fitTovusContent, resetTovusFit } from '../../utils/tovusPrintBrand';
import dayjs from 'dayjs';

/**
 * Tovus ERP branding for printable documents (indent, PO, GRN, bills, …).
 *
 *  <TovusDocHeader title="Purchase Request Form" docNumber="IND-…" companyName="…" />
 *  …document body…
 *  <TovusDocFooter company={companyDoc} docRef="IND-…" />
 *
 * Colours are forced to print (print-color-adjust: exact) so the brand shows on paper / PDF.
 */

export const TOVUS_NAVY = '#10546c';
export const TOVUS_ORANGE = '#da6c20';
export const TOVUS_WEBSITE = 'www.tovus.net';
export const TOVUS_OWNER_TAGLINE = 'A Product of Sardar Group of Companies';
export const TOVUS_LOGO_SRC = `${process.env.PUBLIC_URL || ''}/images/tovus-erp-logo.png`;

const printExact = {
  WebkitPrintColorAdjust: 'exact',
  printColorAdjust: 'exact'
};

/** Navy | orange | navy strip (used at the very bottom of the page). */
const SegmentBar = ({ height = 6, sx = {} }) => (
  <Box sx={{ display: 'flex', height, width: '100%', ...printExact, ...sx }}>
    <Box sx={{ flex: '0 0 30%', bgcolor: TOVUS_NAVY }} />
    <Box sx={{ flex: '0 0 45%', bgcolor: TOVUS_ORANGE }} />
    <Box sx={{ flex: '1 1 auto', bgcolor: TOVUS_NAVY }} />
  </Box>
);

/** "TOVUS ERP" wordmark in brand colours. */
export const TovusWordmark = ({ fontSize = '0.95rem' }) => (
  <Typography component="span" sx={{ fontWeight: 800, letterSpacing: 0.6, fontSize, lineHeight: 1.2, ...printExact }}>
    <Box component="span" sx={{ color: TOVUS_NAVY }}>TOVUS</Box>{' '}
    <Box component="span" sx={{ color: TOVUS_ORANGE }}>ERP</Box>
  </Typography>
);

/**
 * Document header: thin brand bar on top, Tovus logo on the left,
 * document title / number / issuing company on the right.
 */
export const TovusDocHeader = ({ title, docNumber, companyName, sx = {} }) => (
  <Box sx={{ mb: 3.5, '@media print': { mb: 2.5 }, ...printExact, ...sx }}>
    <Box sx={{ display: 'flex', height: 5, mb: 4, '@media print': { mb: 3 } }}>
      <Box sx={{ flex: '1 1 auto', bgcolor: TOVUS_NAVY }} />
      <Box sx={{ flex: '0 0 28%', bgcolor: TOVUS_ORANGE }} />
    </Box>
    {/* logo | centred title block | equal spacer, so the title sits in the true centre of the page */}
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr auto 1fr' },
        justifyItems: { xs: 'center', sm: 'stretch' },
        alignItems: 'center',
        gap: { xs: 1, sm: 2 },
        '@media print': { gridTemplateColumns: '1fr auto 1fr', justifyItems: 'stretch', columnGap: '8px' }
      }}
    >
      <Box
        component="img"
        src={TOVUS_LOGO_SRC}
        alt="Tovus ERP"
        sx={{
          height: { xs: 40, sm: 50 },
          width: 'auto',
          maxWidth: '100%',
          objectFit: 'contain',
          display: 'block',
          justifySelf: { xs: 'center', sm: 'start' },
          '@media print': { height: 44, justifySelf: 'start' }
        }}
      />
      <Box sx={{ textAlign: 'center' }}>
        <Typography
          component="div"
          sx={{
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: { xs: 1.5, sm: 3 },
            color: TOVUS_NAVY,
            fontSize: { xs: '1.15rem', sm: '1.5rem' },
            lineHeight: 1.15,
            whiteSpace: { sm: 'nowrap' },
            '@media print': { fontSize: '1.3rem', letterSpacing: 2.5, whiteSpace: 'nowrap' }
          }}
        >
          {title}
        </Typography>
        {/* brand accent under the title: orange bar flanked by thin navy rules */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, mt: 0.75 }}>
          <Box sx={{ width: 36, height: '1px', bgcolor: TOVUS_NAVY, opacity: 0.6 }} />
          <Box sx={{ width: 44, height: 3, bgcolor: TOVUS_ORANGE, borderRadius: 2 }} />
          <Box sx={{ width: 36, height: '1px', bgcolor: TOVUS_NAVY, opacity: 0.6 }} />
        </Box>
        {docNumber && (
          <Typography component="div" sx={{ fontSize: '0.85rem', color: '#444', mt: 0.25, letterSpacing: 0.3 }}>
            {docNumber}
          </Typography>
        )}
        {companyName && (
          <Typography
            component="div"
            sx={{ fontSize: '0.8rem', fontWeight: 700, color: TOVUS_NAVY, textTransform: 'uppercase', mt: 0.25, letterSpacing: 0.4 }}
          >
            {companyName}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: { xs: 'none', sm: 'block' }, '@media print': { display: 'block' } }} />
    </Box>
  </Box>
);

/**
 * Document footer: navy→orange rule, Tovus wordmark with the issuing company's
 * details on the left, website + print stamp on the right, brand strip at the bottom.
 * `company` is the populated company document (name, contactInfo { address, phone, email }).
 */
export const TovusDocFooter = ({ company, docRef, pinToPageBottom = false, sx = {} }) => {
  const printedAt = dayjs().format('DD/MM/YYYY hh:mm A');
  const contact = company?.contactInfo || {};
  const phoneEmail = [contact.phone, contact.email].filter(Boolean).join('  ·  ');
  return (
    <Box
      sx={{
        // on screen: pushed to the bottom of the A4 sheet (parent must be a flex column)
        mt: pinToPageBottom ? 'auto' : 4,
        pt: pinToPageBottom ? 4 : 0,
        '@media print': pinToPageBottom
          ? {
              // fixed in print = stuck to the bottom edge of the printed page.
              // The document must leave ~40mm bottom padding so content never runs under it.
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              mt: 0,
              pt: 0,
              px: '12mm',
              pb: '6mm',
              bgcolor: '#fff'
            }
          : { mt: 2 },
        breakInside: 'avoid',
        pageBreakInside: 'avoid',
        ...printExact,
        ...sx
      }}
    >
      <Box sx={{ display: 'flex', height: 2, mb: 1.25 }}>
        <Box sx={{ flex: '0 0 55%', bgcolor: TOVUS_NAVY }} />
        <Box sx={{ flex: '1 1 auto', bgcolor: TOVUS_ORANGE }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap', mb: 1.25 }}>
        <Box sx={{ minWidth: 0 }}>
          <TovusWordmark />
          <Typography sx={{ fontSize: '0.66rem', fontStyle: 'italic', color: '#777', lineHeight: 1.3 }}>
            {TOVUS_OWNER_TAGLINE}
          </Typography>
          {company?.name && (
            <Typography sx={{ fontSize: '0.72rem', color: '#333', lineHeight: 1.45, mt: 0.75 }}>{company.name}</Typography>
          )}
          {contact.address && (
            <Typography sx={{ fontSize: '0.72rem', color: '#333', lineHeight: 1.45 }}>{contact.address}</Typography>
          )}
          {phoneEmail && (
            <Typography sx={{ fontSize: '0.72rem', color: '#333', lineHeight: 1.45 }}>{phoneEmail}</Typography>
          )}
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontSize: '0.66rem', color: '#666', lineHeight: 1.45 }}>
            System-generated document by Tovus ERP
          </Typography>
          <Typography sx={{ fontSize: '0.66rem', color: '#666', lineHeight: 1.45 }}>
            {docRef ? `${docRef}  ·  ` : ''}Printed: {printedAt}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: TOVUS_NAVY, lineHeight: 1.45 }}>
            {TOVUS_WEBSITE}
          </Typography>
        </Box>
      </Box>
      <SegmentBar />
    </Box>
  );
};

/**
 * Aligned "Label: value" details grid used under the header of every document
 * (same plain style the user approved on the Indent print). 3 columns on screen ≥ sm and in print.
 *   fields: [{ label, value, upper?, full? (whole row), span? (columns) }]
 * Empty values show `blank` (default '___________').
 */
export const TovusDocDetails = ({ fields = [], columns = 3, blank = '___________', sx = {} }) => (
  <Box
    sx={{
      mt: 2.5,
      mb: 3,
      fontSize: '0.9rem',
      lineHeight: 1.8,
      display: 'grid',
      gridTemplateColumns: { xs: '1fr', sm: `repeat(${columns}, 1fr)` },
      columnGap: 3,
      rowGap: 0.25,
      '@media print': { gridTemplateColumns: `repeat(${columns}, 1fr)`, mt: 2 },
      ...sx
    }}
  >
    {fields.filter(Boolean).map((f) => (
      <Box
        key={f.label}
        sx={{
          gridColumn: f.full ? '1 / -1' : f.span ? { xs: 'auto', sm: `span ${f.span}` } : 'auto',
          ...(f.span && !f.full && { '@media print': { gridColumn: `span ${f.span}` } }),
          minWidth: 0
        }}
      >
        <Typography component="span" fontWeight={600} sx={{ fontSize: 'inherit' }}>{f.label}:</Typography>
        <Typography
          component="span"
          sx={{ ml: 1, fontSize: 'inherit', textTransform: f.upper ? 'uppercase' : 'none', whiteSpace: f.full ? 'pre-wrap' : 'normal' }}
        >
          {f.value === 0 ? '0' : f.value || blank}
        </Typography>
      </Box>
    ))}
  </Box>
);

/**
 * Reusable branded print document (React). Wrap any document body with it:
 *
 *   <TovusPrintDocument title="Purchase Order" docRef={po.poNumber} company={po.company}>
 *     …existing document body (remove its old logo / company / title heading)…
 *   </TovusPrintDocument>
 *
 * It adds the Tovus header (logo + centred title) and the footer, and when printing:
 *  - A4 portrait (or `pageSize="A4 landscape"`), @page margin 0 (no browser date/title/URL)
 *  - white page, footer pinned to the bottom edge of every sheet
 *  - a page frame that keeps top / footer space on every page, so nothing is ever cut off
 *  - auto-fit to ONE page just before printing (compact spacing, then the largest zoom that fits),
 *    undone after printing so the screen view is unchanged
 * `fit={false}` turns the auto-fit off (e.g. long reports that should flow over several pages).
 * `footerSpaceMm` must cover the footer height (taller company address → raise it).
 */
const FOOTER_SPACE_MM = 38;

export const TovusPrintDocument = ({
  title,
  docRef,
  company,
  pageSize = 'A4',
  fit = true,
  footerSpaceMm = FOOTER_SPACE_MM,
  sideMm = 12,
  sx = {},
  children
}) => {
  const fitRef = useRef(null);
  const portrait = !/landscape/i.test(pageSize);

  useEffect(() => {
    if (!fit) return undefined;
    const before = () => {
      // the app shell adds ~4mm side padding in print (print.css main.app-main-print)
      fitTovusContent(fitRef.current, {
        pageWidthMm: portrait ? 210 : 297,
        pageHeightMm: portrait ? 297 : 210,
        sideMm: sideMm + 5,
        topMm: 10,
        bottomMm: footerSpaceMm
      });
    };
    const after = () => resetTovusFit(fitRef.current);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [fit, portrait, footerSpaceMm, sideMm]);

  return (
    <Box
      className="tovus-print-doc"
      sx={{
        bgcolor: '#fff',
        color: '#111',
        maxWidth: portrait ? '210mm' : '297mm',
        width: '100%',
        minHeight: { xs: 'auto', sm: portrait ? '297mm' : '210mm' },
        mx: 'auto',
        p: { xs: 2, sm: 4 },
        display: 'flex',
        flexDirection: 'column',
        boxShadow: { sm: '0 1px 4px rgba(0,0,0,0.15)' },
        '@media print': { boxShadow: 'none', p: `0 ${sideMm}mm`, maxWidth: '100%', minHeight: 'auto', display: 'block' },
        ...sx
      }}
    >
      <GlobalStyles
        styles={{
          '@media print': {
            '@page': { size: pageSize, margin: 0 },
            'html, body, #root, #root *:has(.tovus-print-doc)': {
              background: '#fff !important',
              backgroundColor: '#fff !important'
            },
            body: { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' },
            '.tovus-print-doc table.tv-page': { width: '100%', borderCollapse: 'collapse' },
            '.tovus-print-doc table.tv-page > thead > tr > td, .tovus-print-doc table.tv-page > tbody > tr > td, .tovus-print-doc table.tv-page > tfoot > tr > td':
              { border: '0 !important', padding: '0 !important', background: 'none !important' },
            '.tovus-print-doc .tv-sp-top': { display: 'block !important', height: '10mm' },
            '.tovus-print-doc .tv-sp-bot': { display: 'block !important', height: `${footerSpaceMm}mm` }
          },
          '.tv-fit.tv-dense th, .tv-fit.tv-dense td': { padding: '3px 5px !important', lineHeight: '1.25 !important' },
          '.tv-fit.tv-dense .MuiTableCell-root': { padding: '3px 5px !important' }
        }}
      />
      {/* page frame: thead/tfoot spacers repeat on every printed page (hidden on screen) */}
      <table className="tv-page" style={{ width: '100%', borderCollapse: 'collapse', flex: '1 0 auto' }}>
        <thead>
          <tr>
            <td style={{ padding: 0, border: 0 }}>
              <div className="tv-sp-top" style={{ display: 'none' }} />
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: 0, border: 0, verticalAlign: 'top' }}>
              <div className="tv-fit" ref={fitRef}>
                <TovusDocHeader title={title} />
                {children}
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td style={{ padding: 0, border: 0 }}>
              <div className="tv-sp-bot" style={{ display: 'none' }} />
            </td>
          </tr>
        </tfoot>
      </table>
      <TovusDocFooter company={company} docRef={docRef} pinToPageBottom />
    </Box>
  );
};

export default TovusDocFooter;
