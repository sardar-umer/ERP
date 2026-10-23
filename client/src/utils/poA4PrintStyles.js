/**
 * Shared print CSS + fit-to-one-A4 helper for Purchase Orders
 * (items + Store Vetting + Approval Authorities on a single page).
 *
 * Strategy: larger readable body; Terms & Conditions stay tight to save height.
 */

export const PO_A4_ONE_PAGE_PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 6mm;
  }
  .po-print-page {
    page-break-after: avoid !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-size: 12.5px !important;
    line-height: 1.35 !important;
  }
  .po-print-page.po-print-scaled {
    zoom: var(--po-print-scale, 1) !important;
  }
  .po-print-page .MuiTypography-root {
    line-height: 1.35 !important;
  }
  .po-print-page .MuiTypography-h4 {
    font-size: 22px !important;
    margin-bottom: 8px !important;
    letter-spacing: 0.4px !important;
  }
  .po-print-page .MuiTypography-h6 {
    font-size: 14px !important;
    margin-bottom: 4px !important;
  }
  .po-print-page .MuiTypography-body1,
  .po-print-page .MuiTypography-body2,
  .po-print-page .MuiTypography-subtitle1,
  .po-print-page .MuiTypography-subtitle2,
  .po-print-page .MuiTypography-caption {
    font-size: 12.5px !important;
  }
  .po-print-page .MuiDivider-root {
    margin-top: 8px !important;
    margin-bottom: 8px !important;
  }
  .po-print-page table th,
  .po-print-page table td,
  .po-print-page .MuiTableCell-root {
    padding: 5px 7px !important;
    font-size: 12px !important;
    line-height: 1.3 !important;
  }
  .po-print-page img {
    max-height: 28px !important;
    max-width: 110px !important;
  }
  .po-approval-block {
    page-break-inside: auto !important;
    break-inside: auto !important;
    margin-top: 10px !important;
    margin-bottom: 0 !important;
  }
  .po-authority-table th,
  .po-authority-table td {
    padding: 4px 6px !important;
    font-size: 11.5px !important;
    line-height: 1.25 !important;
  }
  .po-authority-table img {
    max-height: 26px !important;
    max-width: 105px !important;
  }
  /* Terms: keep compact so the rest can stay larger */
  .po-terms-block {
    margin-top: 4px !important;
    margin-bottom: 6px !important;
    padding: 3px 5px !important;
  }
  .po-terms-block,
  .po-terms-block .MuiTypography-root {
    font-size: 9px !important;
    line-height: 1.12 !important;
  }
  .po-terms-block .MuiTypography-h6,
  .po-terms-block .MuiTypography-subtitle1 {
    font-size: 10px !important;
    margin-bottom: 2px !important;
    line-height: 1.12 !important;
  }
  .po-terms-block .MuiBox-root,
  .po-terms-block p {
    margin-top: 0 !important;
    margin-bottom: 1px !important;
  }
`;

const MM_TO_PX = 96 / 25.4;
/** A4 height minus 6mm top+bottom margins */
const A4_PRINTABLE_HEIGHT_PX = (297 - 12) * MM_TO_PX;

/**
 * Measures the PO paper, scales gently only when needed to fit one A4, then prints.
 */
export function printPoFitToOneA4(selector = '.po-print-page') {
  const el = typeof document !== 'undefined' ? document.querySelector(selector) : null;
  if (!el) {
    window.print();
    return;
  }

  const previous = {
    zoom: el.style.zoom,
    transform: el.style.transform,
    transformOrigin: el.style.transformOrigin,
    width: el.style.width,
    height: el.style.height,
    maxHeight: el.style.maxHeight,
    overflow: el.style.overflow,
    marginBottom: el.style.marginBottom
  };

  el.style.zoom = '1';
  el.style.transform = 'none';
  el.style.width = '';
  el.style.marginBottom = '';
  el.style.height = 'auto';
  el.style.maxHeight = 'none';
  el.classList.remove('po-print-scaled');
  el.style.removeProperty('--po-print-scale');

  const contentHeight = Math.max(el.scrollHeight, el.offsetHeight, 1);
  const estimatedPrintHeight = contentHeight * 0.9;

  let scale = 1;
  if (estimatedPrintHeight > A4_PRINTABLE_HEIGHT_PX) {
    scale = A4_PRINTABLE_HEIGHT_PX / estimatedPrintHeight;
    if (scale < 0.85) scale = 0.85;
    if (scale > 0.98) scale = 1;
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    el.classList.remove('po-print-scaled');
    el.style.zoom = previous.zoom;
    el.style.transform = previous.transform;
    el.style.transformOrigin = previous.transformOrigin;
    el.style.width = previous.width;
    el.style.height = previous.height;
    el.style.maxHeight = previous.maxHeight;
    el.style.overflow = previous.overflow;
    el.style.marginBottom = previous.marginBottom;
    el.style.removeProperty('--po-print-scale');
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup);

  if (scale < 1) {
    el.style.setProperty('--po-print-scale', String(scale));
    const supportsZoom = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('zoom', '1');
    if (supportsZoom) {
      el.style.zoom = String(scale);
    } else {
      el.style.transformOrigin = 'top left';
      el.style.transform = `scale(${scale})`;
      el.style.width = `${(100 / scale).toFixed(3)}%`;
      el.style.marginBottom = `${Math.round(-(1 - scale) * contentHeight)}px`;
    }
    el.classList.add('po-print-scaled');
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
      setTimeout(cleanup, 60000);
    });
  });
}
