/**
 * Tovus ERP branding for documents generated as PDF files with jsPDF (Final Settlement, loan detail,
 * salary sheet, EOBI, Taj invoices …). Same look as the web prints (tovusPrintBrand.js):
 *  - page-1 header: navy/orange top bar, Tovus logo left, centred navy title with orange accent
 *  - footer on EVERY page: navy→orange rule, TOVUS ERP + "A Product of Sardar Group of Companies",
 *    optional company lines, system-generated stamp + doc ref + print time, www.tovus.net,
 *    navy | orange | navy strip
 *
 * Usage (A4 portrait, units mm):
 *   await preloadTovusLogo();                       // before building, so the logo is embedded
 *   let y = drawTovusPdfHeader(doc, { title: 'FINAL DUES' });   // returns the first free y
 *   … draw content; before each block: y = ensureTovusPdfSpace(doc, y, blockHeight) …
 *   applyTovusPdfFooters(doc, { docRef: 'Emp 05604' });         // last step, after all pages exist
 */
import {
  TOVUS_OWNER_TAGLINE,
  TOVUS_WEBSITE,
  getTovusLogoDataUrl,
  preloadTovusLogo
} from './tovusPrintBrand';

export { preloadTovusLogo };

const NAVY = [16, 84, 108];
const ORANGE = [218, 108, 32];
const MARGIN = 14;
/** Height reserved at the bottom of every page for the footer (content must stay above it). */
export const TOVUS_PDF_FOOTER_SPACE = 34;
/** Logo aspect ratio of client/public/images/tovus-erp-logo.png (398 × 124). */
const LOGO_RATIO = 398 / 124;

const fill = (doc, rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
const text = (doc, rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

/** Lowest y content may use on a page (top of the footer area). */
export const tovusPdfContentBottom = (doc) => doc.internal.pageSize.getHeight() - TOVUS_PDF_FOOTER_SPACE;

/** Draws the page header; returns the y (mm) where content can start. */
export const drawTovusPdfHeader = (doc, { title = '' } = {}) => {
  const W = doc.internal.pageSize.getWidth();
  const L = MARGIN;
  const R = W - MARGIN;

  // top bar: navy, then orange (last 28%)
  const barY = 9;
  const split = L + (R - L) * 0.72;
  fill(doc, NAVY);
  doc.rect(L, barY, split - L, 1.4, 'F');
  fill(doc, ORANGE);
  doc.rect(split, barY, R - split, 1.4, 'F');

  // logo (embedded data URL) — falls back to the TOVUS ERP wordmark if it is not loaded
  const logoH = 11;
  const logoY = barY + 6;
  const logo = getTovusLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', L, logoY, logoH * LOGO_RATIO, logoH);
    } catch {
      /* ignore — wordmark below */
    }
  }
  if (!logo) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    text(doc, NAVY);
    doc.text('TOVUS', L, logoY + 6);
    text(doc, ORANGE);
    doc.text('ERP', L + doc.getTextWidth('TOVUS ') , logoY + 6);
  }

  // centred title, letter-spaced, navy
  const t = String(title || '').toUpperCase();
  const charSpace = 0.9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  text(doc, NAVY);
  const width = doc.getTextWidth(t) + charSpace * Math.max(0, t.length - 1);
  const titleY = logoY + 6.2;
  doc.text(t, W / 2 - width / 2, titleY, { charSpace });

  // accent under the title: thin navy rules either side of an orange bar
  const ay = titleY + 3.6;
  doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.setLineWidth(0.2);
  doc.line(W / 2 - 18, ay, W / 2 - 7.5, ay);
  doc.line(W / 2 + 7.5, ay, W / 2 + 18, ay);
  fill(doc, ORANGE);
  doc.roundedRect(W / 2 - 6, ay - 0.5, 12, 1, 0.5, 0.5, 'F');

  // reset colours for the caller
  text(doc, [20, 20, 20]);
  doc.setDrawColor(0, 0, 0);
  return ay + 7;
};

/** Draws the footer on the current page. */
export const drawTovusPdfFooter = (doc, { docRef, company } = {}) => {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const L = MARGIN;
  const R = W - MARGIN;
  const top = H - 30;

  // rule: navy 55%, orange rest
  const split = L + (R - L) * 0.55;
  fill(doc, NAVY);
  doc.rect(L, top, split - L, 0.5, 'F');
  fill(doc, ORANGE);
  doc.rect(split, top, R - split, 0.5, 'F');

  // left: wordmark, tagline, company lines
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  text(doc, NAVY);
  doc.text('TOVUS', L, top + 6);
  text(doc, ORANGE);
  doc.text('ERP', L + doc.getTextWidth('TOVUS '), top + 6);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  text(doc, [119, 119, 119]);
  doc.text(TOVUS_OWNER_TAGLINE, L, top + 9.5);
  const contact = company?.contactInfo || {};
  const coLines = [company?.name, contact.address, [contact.phone, contact.email].filter(Boolean).join('  ·  ')].filter(Boolean);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  text(doc, [51, 51, 51]);
  coLines.slice(0, 2).forEach((line, i) => doc.text(String(line), L, top + 13.5 + i * 3.4, { maxWidth: (R - L) * 0.55 }));

  // right: stamp, ref + printed time, website
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const printed = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(h)}:${p2(d.getMinutes())} ${ampm}`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  text(doc, [102, 102, 102]);
  doc.text('System-generated document by Tovus ERP', R, top + 5.5, { align: 'right' });
  doc.text(`${docRef ? `${docRef}  ·  ` : ''}Printed: ${printed}`, R, top + 9, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  text(doc, NAVY);
  doc.text(TOVUS_WEBSITE, R, top + 13, { align: 'right' });

  // bottom strip: navy 30% | orange 45% | navy
  const sy = H - 11;
  const a = L + (R - L) * 0.3;
  const b = L + (R - L) * 0.75;
  fill(doc, NAVY);
  doc.rect(L, sy, a - L, 1.8, 'F');
  fill(doc, ORANGE);
  doc.rect(a, sy, b - a, 1.8, 'F');
  fill(doc, NAVY);
  doc.rect(b, sy, R - b, 1.8, 'F');

  text(doc, [20, 20, 20]);
};

/** Footer on every page — call once, after all pages (incl. attachments) have been added. */
export const applyTovusPdfFooters = (doc, opts = {}) => {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    drawTovusPdfFooter(doc, opts);
  }
  doc.setPage(pages);
};

/**
 * Never let a block run into the footer: if `height` mm from `y` would cross the footer area,
 * start a new page and return the top y there; otherwise return `y` unchanged.
 */
export const ensureTovusPdfSpace = (doc, y, height, newPageTop = 20) => {
  if (y + height <= tovusPdfContentBottom(doc)) return y;
  doc.addPage();
  return newPageTop;
};

/**
 * Wrap jspdf-autotable so every table keeps clear of the Tovus footer on every page
 * (bottom margin = footer space; tables continue on the next page instead of running under it).
 *   const autoTable = withTovusFooterSpace((await import('jspdf-autotable')).default);
 */
export const withTovusFooterSpace = (autoTable) => (doc, options = {}) => autoTable(doc, {
  ...options,
  margin: {
    ...(typeof options.margin === 'object' ? options.margin : {}),
    bottom: Math.max(
      typeof options.margin === 'object' && options.margin.bottom ? options.margin.bottom : 0,
      TOVUS_PDF_FOOTER_SPACE + 2
    )
  }
});

/**
 * Draw the Tovus header, then a small block of plain lines under it (company, period, generated …).
 * Returns the y where content can start. Works for portrait, landscape, A4 or A3.
 *   let y = drawTovusPdfHeaderWithInfo(doc, { title: 'Balance Sheet', lines: ['SGC', 'As of 31 Oct 2026'] });
 */
export const drawTovusPdfHeaderWithInfo = (doc, { title, lines = [] } = {}) => {
  const W = doc.internal.pageSize.getWidth();
  let y = drawTovusPdfHeader(doc, { title }) + 1;
  lines.filter(Boolean).forEach((line, i) => {
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
    doc.setFontSize(i === 0 ? 11 : 8.5);
    doc.setTextColor(i === 0 ? 20 : 90, i === 0 ? 20 : 90, i === 0 ? 20 : 90);
    doc.text(String(line), W / 2, y, { align: 'center' });
    y += i === 0 ? 5.5 : 4.5;
  });
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.line(14, y, W - 14, y);
  doc.setTextColor(20, 20, 20);
  return y + 5;
};
