/**
 * Tovus ERP branding for documents printed from an HTML string (openPrintHtml / print windows).
 * Same look as the React <TovusDocHeader /> / <TovusDocFooter /> used on the Indent print:
 *  - header: navy/orange top bar, Tovus logo left, centred navy title with orange accent
 *  - footer: navy→orange rule, TOVUS ERP + "A Product of Sardar Group of Companies",
 *    issuing company details, system-generated stamp, www.tovus.net, navy|orange|navy strip;
 *    pinned to the bottom of every printed page
 *  - @page margin 0 so the browser does not print its own date/title/URL
 *
 * Usage inside a print template:
 *   <style>${tovusPrintCss()} ...</style>
 *   <body class="tovus-doc">
 *     ${tovusPrintHeaderHtml({ title: 'New-Hiring Approval' })}
 *     ...document body...
 *     ${tovusPrintFooterHtml({ company, docRef: 'NHA-0012' })}
 *   </body>
 */

export const TOVUS_NAVY = '#10546c';
export const TOVUS_ORANGE = '#da6c20';
export const TOVUS_WEBSITE = 'www.tovus.net';
export const TOVUS_OWNER_TAGLINE = 'A Product of Sardar Group of Companies';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const tovusLogoUrl = () => {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  return `${origin}${process.env.PUBLIC_URL || ''}/images/tovus-erp-logo.png`;
};

/*
 * The logo is embedded in printed documents as a data URL (fetched once and cached), so it is
 * already inside the page when the print snapshot is taken — no network load, no path, cache or
 * decode-timing issues in popups, iframes or cloned print copies.
 */
let tovusLogoDataUrl = null;
let tovusLogoLoading = null;
export const preloadTovusLogo = () => {
  if (tovusLogoDataUrl) return Promise.resolve(tovusLogoDataUrl);
  if (tovusLogoLoading) return tovusLogoLoading;
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return Promise.resolve(null);
  tovusLogoLoading = fetch(tovusLogoUrl())
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`logo HTTP ${res.status}`))))
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }))
    .then((dataUrl) => {
      tovusLogoDataUrl = dataUrl;
      return dataUrl;
    })
    .catch(() => {
      tovusLogoLoading = null;
      return null;
    });
  return tovusLogoLoading;
};
// warm the cache as soon as any print helper is loaded
if (typeof window !== 'undefined') preloadTovusLogo();

/** The cached logo data URL (null until preloadTovusLogo has finished) — used by the PDF branding. */
export const getTovusLogoDataUrl = () => tovusLogoDataUrl;

/** Wait until images are loaded AND decoded (painted), so the print snapshot never shows blanks. */
export const waitForImagesReady = (container, timeoutMs = 4000) =>
  Promise.all(
    Array.from(container.querySelectorAll('img')).map((img) => {
      const loaded = img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); setTimeout(res, timeoutMs); });
      return loaded.then(() => (img.decode ? img.decode().catch(() => {}) : null));
    })
  );

const printedAtLabel = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(h)}:${p(d.getMinutes())} ${ampm}`;
};

/**
 * CSS for the branded page. `pageSize` e.g. 'A4' or 'A4 landscape';
 * `footerSpaceMm` is the room kept free at the bottom so content never runs under the pinned footer.
 */
export const tovusPrintCss = ({ pageSize = 'A4', footerSpaceMm = 38 } = {}) => `
  @page { size: ${pageSize}; margin: 0; }
  html, body { background: #fff; }
  body.tovus-doc {
    margin: 0;
    padding: 0 12mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Page frame (built by tovusFit): thead/tfoot spacers repeat on EVERY printed page, so the top
     margin and the room for the pinned footer are kept on each sheet — content is never cut off
     or hidden under the footer, even when a document runs to a second page. */
  table.tv-page { width: 100%; border-collapse: collapse; margin: 0; }
  table.tv-page > thead > tr > td,
  table.tv-page > tbody > tr > td,
  table.tv-page > tfoot > tr > td { border: 0 !important; padding: 0 !important; background: none !important; }
  .tv-sp-top { height: 10mm; }
  .tv-sp-bot { height: ${footerSpaceMm}mm; }
  .tv-topbar { display: flex; height: 5px; margin-bottom: 22px; }
  .tv-topbar .tv-navy { flex: 1 1 auto; background: ${TOVUS_NAVY}; }
  .tv-topbar .tv-orange { flex: 0 0 28%; background: ${TOVUS_ORANGE}; }
  .tv-head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; column-gap: 8px; margin-bottom: 20px; }
  .tv-head img { height: 44px; width: auto; display: block; justify-self: start; }
  .tv-title { text-align: center; }
  .tv-title .tv-t {
    color: ${TOVUS_NAVY}; font-weight: 800; text-transform: uppercase;
    letter-spacing: 2.5px; font-size: 20px; line-height: 1.15; white-space: nowrap;
  }
  .tv-title .tv-accent { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 6px; }
  .tv-title .tv-accent .tv-rule { width: 36px; height: 1px; background: ${TOVUS_NAVY}; opacity: 0.6; }
  .tv-title .tv-accent .tv-bar { width: 44px; height: 3px; background: ${TOVUS_ORANGE}; border-radius: 2px; }
  /* compact mode, switched on by tovusFit() before it starts shrinking text */
  .tv-fit.tv-dense th, .tv-fit.tv-dense td { padding: 3px 5px !important; line-height: 1.25 !important; }
  .tv-fit.tv-dense h2 { margin: 8px 0 4px !important; }
  .tv-fit.tv-dense .tv-topbar { margin-bottom: 12px !important; }
  .tv-fit.tv-dense .tv-head { margin-bottom: 10px !important; }
  .tv-fit.tv-dense .auth-card { min-height: 0 !important; padding: 6px 8px !important; }
  .tv-footer {
    position: fixed; left: 0; right: 0; bottom: 0;
    padding: 0 12mm 6mm; background: #fff;
    font-family: Arial, Helvetica, sans-serif;
  }
  .tv-footer .tv-rule { display: flex; height: 2px; margin-bottom: 8px; }
  .tv-footer .tv-rule .tv-navy { flex: 0 0 55%; background: ${TOVUS_NAVY}; }
  .tv-footer .tv-rule .tv-orange { flex: 1 1 auto; background: ${TOVUS_ORANGE}; }
  .tv-footer .tv-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 8px; }
  .tv-footer .tv-wordmark { font-weight: 800; letter-spacing: 0.6px; font-size: 14px; line-height: 1.2; }
  .tv-footer .tv-wordmark .tv-navy { color: ${TOVUS_NAVY}; }
  .tv-footer .tv-wordmark .tv-orange { color: ${TOVUS_ORANGE}; }
  .tv-footer .tv-tagline { font-size: 10px; font-style: italic; color: #777; line-height: 1.3; }
  .tv-footer .tv-co { font-size: 11px; color: #333; line-height: 1.45; }
  .tv-footer .tv-co.tv-first { margin-top: 6px; }
  .tv-footer .tv-right { text-align: right; }
  .tv-footer .tv-stamp { font-size: 10px; color: #666; line-height: 1.45; }
  .tv-footer .tv-web { font-size: 11px; font-weight: 700; color: ${TOVUS_NAVY}; line-height: 1.45; }
  .tv-footer .tv-strip { display: flex; height: 6px; }
  .tv-footer .tv-strip .tv-a { flex: 0 0 30%; background: ${TOVUS_NAVY}; }
  .tv-footer .tv-strip .tv-b { flex: 0 0 45%; background: ${TOVUS_ORANGE}; }
  .tv-footer .tv-strip .tv-c { flex: 1 1 auto; background: ${TOVUS_NAVY}; }
`;

/**
 * One-page auto-fit (shared by HTML prints and React print pages — keep it plain ES5, no outside
 * references: it is also embedded as text into print HTML via tovusFitScript).
 * Measures `el` at the printable width; if it is taller than the space between the top margin and
 * the pinned footer (or wider than the page), it first switches on compact spacing (.tv-dense),
 * then finds the LARGEST CSS zoom that still fits. Short documents stay at 100%.
 * It never shrinks below `minScale` (unreadable) — the document then flows to a 2nd page instead,
 * and the page frame keeps footer space on every page, so nothing is ever cut off.
 * Returns the applied scale.
 */
export function fitTovusContent(el, o) {
  if (!el) return 1;
  var MM = 96 / 25.4;
  var pageW = o && o.pageWidthMm ? o.pageWidthMm : 210;
  var pageH = o && o.pageHeightMm ? o.pageHeightMm : 297;
  var side = o && o.sideMm != null ? o.sideMm : 12;
  var top = o && o.topMm != null ? o.topMm : 10;
  var bottom = o && o.bottomMm != null ? o.bottomMm : 38;
  var minScale = o && o.minScale ? o.minScale : 0.55;
  // 8mm safety margin: print fonts can lay out a little taller than the on-screen measurement
  var reservePx = o && o.reservePx ? o.reservePx : 0;
  var available = (pageH - top - bottom - 8) * MM - reservePx;
  var width = (pageW - 2 * side) * MM;
  var measure = function (z) {
    el.style.zoom = String(z);
    el.style.width = (width / z) + 'px';
    var r = el.getBoundingClientRect();
    var overflowX = el.clientWidth ? el.scrollWidth / el.clientWidth : 1;
    return { h: r.height, w: r.width * overflowX };
  };
  var fits = function (m) { return m.h <= available && m.w <= width + 1; };
  el.style.zoom = '';
  el.classList.remove('tv-dense');
  var scale = 1;
  if (!fits(measure(1))) {
    el.classList.add('tv-dense');
    if (!fits(measure(1))) {
      var lo = minScale;
      var hi = 1;
      for (var i = 0; i < 9; i += 1) {
        var mid = (lo + hi) / 2;
        if (fits(measure(mid))) lo = mid; else hi = mid;
      }
      scale = Math.floor(lo * 100) / 100;
    }
  }
  el.style.width = '';
  el.style.zoom = scale < 1 ? String(scale) : '';
  return scale;
}

/** Undo fitTovusContent (after printing, so the on-screen view is back to normal). */
export function resetTovusFit(el) {
  if (!el) return;
  el.style.zoom = '';
  el.style.width = '';
  el.classList.remove('tv-dense');
}

/**
 * For HTML-string prints: wrap header + body in <div class="tv-fit">…</div> and put this script at
 * the end of <body>. It builds the page frame (top / footer space repeated on every page) and runs
 * the fit; openPrintHtml calls window.tovusFit() again after images have loaded.
 * Defaults match tovusPrintCss: 12mm sides, 10mm top, `bottomMm` = footerSpaceMm.
 */
export const tovusFitScript = (opts = {}) => `
<script>
(function () {
  var fitTovusContent = ${fitTovusContent.toString()};
  var opts = ${JSON.stringify(opts)};
  window.tovusFit = function () {
    var el = document.querySelector('.tv-fit');
    if (!el) return 1;
    if (!el.closest('table.tv-page')) {
      var frame = document.createElement('table');
      frame.className = 'tv-page';
      frame.innerHTML =
        '<thead><tr><td><div class="tv-sp-top"></div></td></tr></thead>' +
        '<tbody><tr><td class="tv-cell"></td></tr></tbody>' +
        '<tfoot><tr><td><div class="tv-sp-bot"></div></td></tr></tfoot>';
      el.parentNode.insertBefore(frame, el);
      frame.querySelector('.tv-cell').appendChild(el);
    }
    if (opts.noFit) return 1; // multi-page documents: page frame only, normal size
    return fitTovusContent(el, opts);
  };
  window.tovusFit();
})();
</script>`;

/**
 * Brand an existing print template in one call: injects the Tovus CSS into <head>, the header
 * right after <body>, wraps the body in .tv-fit, and adds the pinned footer + auto-fit script.
 * Remove the template's own old title/company heading first so it is not shown twice.
 *   html = brandPrintHtml(html, { title: 'Gate Pass', docRef: gp.number, company })
 * fit:false → multi-page records (normal size, footer on every page);
 * header:false → formal letters on the company letterhead (Tovus footer only);
 * margins:{topMm,leftMm,rightMm} → keep the letter's own page margins.
 */
export const brandPrintHtml = (
  html,
  { title, docRef, company, pageSize = 'A4', footerSpaceMm = 36, fit = true, header = true, margins } = {}
) => {
  if (!html) return html;
  const portrait = !/landscape/i.test(pageSize);
  // margins: { topMm, leftMm, rightMm } — keep a letter's own page margins (e.g. a wide filing margin)
  const m = margins
    ? `body.tovus-doc { padding: 0 ${margins.rightMm}mm 0 ${margins.leftMm}mm !important; }
       .tv-sp-top { height: ${margins.topMm}mm !important; }
       .tv-footer { padding-left: ${margins.leftMm}mm !important; padding-right: ${margins.rightMm}mm !important; }`
    : '';
  const css = `<style>${tovusPrintCss({ pageSize, footerSpaceMm })}${m}</style>`;
  const fitScript = tovusFitScript({
    pageWidthMm: portrait ? 210 : 297,
    pageHeightMm: portrait ? 297 : 210,
    bottomMm: footerSpaceMm,
    noFit: !fit,
    ...(margins && { sideMm: (margins.leftMm + margins.rightMm) / 2, topMm: margins.topMm })
  });
  let out = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${css}</head>`) : css + html;
  out = out.replace(/<body([^>]*)>/i, (m, attrs) => {
    const withClass = /class="/i.test(attrs)
      ? attrs.replace(/class="/i, 'class="tovus-doc ')
      : `${attrs} class="tovus-doc"`;
    return `<body${withClass}><div class="tv-fit">${header ? tovusPrintHeaderHtml({ title }) : ''}`;
  });
  out = out.replace(/<\/body>/i, `</div>${tovusPrintFooterHtml({ company, docRef })}${fitScript}</body>`);
  return out;
};

export const tovusPrintHeaderHtml = ({ title }) => `
  <div class="tv-topbar"><div class="tv-navy"></div><div class="tv-orange"></div></div>
  <div class="tv-head">
    <img src="${esc(tovusLogoDataUrl || tovusLogoUrl())}" alt="Tovus ERP" />
    <div class="tv-title">
      <div class="tv-t">${esc(title)}</div>
      <div class="tv-accent"><span class="tv-rule"></span><span class="tv-bar"></span><span class="tv-rule"></span></div>
    </div>
    <div></div>
  </div>`;

/**
 * `company`: { name, contactInfo: { address, phone, email } } — the issuing company (optional).
 * `docRef`: document number shown next to the print time (optional).
 */
export const tovusPrintFooterHtml = ({ company, docRef } = {}) => {
  const contact = company?.contactInfo || {};
  const phoneEmail = [contact.phone, contact.email].filter(Boolean).map(esc).join('  ·  ');
  const coLines = [
    company?.name ? `<div class="tv-co tv-first">${esc(company.name)}</div>` : '',
    contact.address ? `<div class="tv-co${company?.name ? '' : ' tv-first'}">${esc(contact.address)}</div>` : '',
    phoneEmail ? `<div class="tv-co">${phoneEmail}</div>` : ''
  ].join('');
  return `
  <div class="tv-footer">
    <div class="tv-rule"><div class="tv-navy"></div><div class="tv-orange"></div></div>
    <div class="tv-row">
      <div>
        <div class="tv-wordmark"><span class="tv-navy">TOVUS</span> <span class="tv-orange">ERP</span></div>
        <div class="tv-tagline">${esc(TOVUS_OWNER_TAGLINE)}</div>
        ${coLines}
      </div>
      <div class="tv-right">
        <div class="tv-stamp">System-generated document by Tovus ERP</div>
        <div class="tv-stamp">${docRef ? `${esc(docRef)}  ·  ` : ''}Printed: ${printedAtLabel()}</div>
        <div class="tv-web">${TOVUS_WEBSITE}</div>
      </div>
    </div>
    <div class="tv-strip"><div class="tv-a"></div><div class="tv-b"></div><div class="tv-c"></div></div>
  </div>`;
};

/**
 * Print ANY on-screen document element with Tovus branding — the reusable path for every
 * "window.print()" style document (dialogs, detail pages). It does not touch the live React DOM:
 * it clones the element into a temporary print root with the Tovus header, the pinned footer,
 * the A4 page frame (footer space kept on every page) and the one-page auto-fit, prints, then
 * removes the clone.
 *
 *   printTovusElement('.po-print-page', { title: 'Purchase Order', docRef: 'P000123', company })
 *
 * opts.strip: CSS selectors removed from the copy (the document's old title / logo heading).
 * opts.pageSize: 'A4' (default, portrait) or 'A4 landscape'.
 * opts.fitTarget: fit only this part of the copy onto page 1 (e.g. the bill itself, while the
 *   attachments after it keep printing on their own pages). Default: the whole document.
 */
export const printTovusElement = async (target, opts = {}) => {
  const {
    title = '',
    docRef,
    company,
    strip = [],
    fitTarget,
    pageSize = 'A4',
    footerSpaceMm = 36,
    fit = true
  } = opts;
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) {
    window.print();
    return;
  }
  const portrait = !/landscape/i.test(pageSize);
  const pageW = portrait ? 210 : 297;
  const pageH = portrait ? 297 : 210;

  await preloadTovusLogo();
  document.querySelectorAll('.tovus-print-root').forEach((n) => n.remove());
  const clone = el.cloneNode(true);
  strip.forEach((sel) => {
    const n = clone.matches?.(sel) ? null : clone.querySelector(sel);
    if (n) n.remove();
  });
  // keep the copy's own size free so the fit can size it
  clone.style.zoom = '';
  clone.style.maxWidth = 'none';
  clone.style.width = 'auto';
  clone.style.boxShadow = 'none';
  // full-screen pages (min-height: 100vh) would otherwise count the empty screen height
  clone.style.minHeight = '0';
  clone.style.height = 'auto';
  clone.style.margin = '0';
  clone.style.padding = '0';

  const root = document.createElement('div');
  root.className = 'tovus-print-root';
  root.innerHTML = `
    <style>
      ${tovusPrintCss({ pageSize, footerSpaceMm }).replace(/body\.tovus-doc/g, '.tovus-print-root')}
      @media screen { .tovus-print-root { position: absolute; left: -10000px; top: 0; width: ${pageW}mm; background: #fff; } }
      @media print {
        body > *:not(.tovus-print-root) { display: none !important; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        /* many screens print with "body * { visibility: hidden }" + only the dialog visible —
           the branded copy lives outside the dialog, so force it (and everything in it) visible */
        .tovus-print-root, .tovus-print-root * { visibility: visible !important; }
        .tovus-print-root { display: block !important; }
        /* some screens pin their print area to the page corner ("position:absolute; top:0; left:0")
           — in the branded copy that would lay the document OVER the Tovus header; keep it in flow */
        .tovus-print-root .tv-body > *,
        .tovus-print-root .tv-body .print-content {
          position: static !important;
          left: auto !important;
          top: auto !important;
          transform: none !important;
          margin: 0 !important;
        }
        .tovus-print-root { position: static; width: auto; font-family: Arial, Helvetica, sans-serif; color: #111; }
      }
      .tovus-print-root table.tv-page { width: 100%; border-collapse: collapse; }
      .tovus-print-root table.tv-page > thead > tr > td,
      .tovus-print-root table.tv-page > tbody > tr > td,
      .tovus-print-root table.tv-page > tfoot > tr > td { border: 0 !important; padding: 0 !important; background: none !important; }
      .tovus-print-root .tv-sp-top { height: 10mm; }
      .tovus-print-root .tv-sp-bot { height: ${footerSpaceMm}mm; }
    </style>
    <table class="tv-page">
      <thead><tr><td><div class="tv-sp-top"></div></td></tr></thead>
      <tbody><tr><td><div class="tv-fit">${tovusPrintHeaderHtml({ title })}<div class="tv-body"></div></div></td></tr></tbody>
      <tfoot><tr><td><div class="tv-sp-bot"></div></td></tr></tfoot>
    </table>
    ${tovusPrintFooterHtml({ company, docRef })}`;
  root.querySelector('.tv-body').appendChild(clone);
  document.body.appendChild(root);

  // wait for images (logo, signatures) to load and decode, so the fit measures their real size
  // and the print snapshot never shows an empty logo box
  await waitForImagesReady(root);
  if (fit) {
    const fitEl = (fitTarget && root.querySelector(`.tv-body ${fitTarget}`)) || root.querySelector('.tv-fit');
    const header = root.querySelector('.tv-head');
    const reservePx = fitEl.classList.contains('tv-fit') || !header
      ? 0
      : header.getBoundingClientRect().bottom - root.querySelector('.tv-fit').getBoundingClientRect().top + 8;
    fitTovusContent(fitEl, {
      pageWidthMm: pageW,
      pageHeightMm: pageH,
      sideMm: 12,
      topMm: 10,
      bottomMm: footerSpaceMm,
      reservePx
    });
  }

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    window.removeEventListener('afterprint', cleanup);
    root.remove();
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 1500);
};
