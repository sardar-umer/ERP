import { printTovusElement } from './tovusPrintBrand';

/**
 * Print one document on a single A4 portrait page: lays the element out at the A4 printable width,
 * measures what will print (elements hidden in print are left out) and shrinks it with CSS zoom
 * only when it is taller than the page. Everything is restored after the print dialog closes.
 *
 * @param {string} selector  - element that holds the printable document
 * @param {object} [options]
 * @param {number} [options.marginMm=8]   - @page margin used by the page's print CSS (all sides)
 * @param {string} [options.hiddenInPrint] - selector of parts inside the element that print hides
 */
const MM_TO_PX = 96 / 25.4;

export function printFitToOneA4(
  selector,
  { marginMm = 8, hiddenInPrint = '.app-print-hide, .MuiTabs-root', title = 'Cash Approval', docRef, tovus = true } = {}
) {
  const el = typeof document !== 'undefined' ? document.querySelector(selector) : null;
  if (!el) {
    window.print();
    return;
  }
  // Tovus ERP branded print (header, pinned footer, A4 portrait, one-page auto-fit that never cuts).
  // The document's own uppercase title (e.g. "CASH APPROVAL") moves into the Tovus header.
  if (tovus) {
    printTovusElement(el, { title, docRef, strip: ['.MuiTypography-h5'] });
    return;
  }

  const printableWidth = (210 - 2 * marginMm) * MM_TO_PX;
  // Small allowance for browser header/footer rounding so the last line never spills to page 2
  const printableHeight = (297 - 2 * marginMm) * MM_TO_PX * 0.97;

  const previous = { width: el.style.width, zoom: el.style.zoom };
  el.style.zoom = '1';
  el.style.width = `${printableWidth}px`;

  const hiddenHeight = [...el.querySelectorAll(hiddenInPrint)]
    .filter((node) => node.offsetParent !== null && !node.parentElement?.closest(hiddenInPrint))
    .reduce((sum, node) => {
      const style = window.getComputedStyle(node);
      return sum + node.offsetHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    }, 0);
  const contentHeight = Math.max(el.scrollHeight - hiddenHeight, 1);
  const scale = contentHeight > printableHeight ? printableHeight / contentHeight : 1;

  el.style.width = previous.width;
  if (scale < 1) el.style.zoom = String(Math.floor(scale * 1000) / 1000);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    el.style.zoom = previous.zoom;
    el.style.width = previous.width;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Let the zoom apply before the print snapshot
  requestAnimationFrame(() => {
    window.print();
    setTimeout(cleanup, 1000);
  });
}

export default printFitToOneA4;
