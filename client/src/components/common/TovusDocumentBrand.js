import React from 'react';
import { Box, Typography } from '@mui/material';
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
  <Box sx={{ mb: 2.5, '@media print': { mb: 1.5 }, ...printExact, ...sx }}>
    <Box sx={{ display: 'flex', height: 5, mb: 2, '@media print': { mb: 1.25 } }}>
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
        '@media print': { gridTemplateColumns: '1fr auto 1fr', justifyItems: 'stretch' }
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
            letterSpacing: 1,
            color: '#1d1d1d',
            fontSize: { xs: '1.2rem', sm: '1.45rem' },
            lineHeight: 1.15,
            '@media print': { fontSize: '1.3rem' }
          }}
        >
          {title}
        </Typography>
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

export default TovusDocFooter;
