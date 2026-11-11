/** Match a GRN line to a PO line: description → product code → same row index (simple, predictable). */
function matchPurchaseOrderLineIndex(poItems, grnLine, grnIndex) {
  if (!poItems?.length) return -1;
  const norm = (s) => (s == null ? '' : String(s).trim().toLowerCase().replace(/\s+/g, ' '));
  const name = norm(grnLine.itemName);
  const code = norm(grnLine.itemCode);
  for (let j = 0; j < poItems.length; j++) {
    if (name && norm(poItems[j].description) === name) return j;
  }
  for (let j = 0; j < poItems.length; j++) {
    const pc = poItems[j].productCode;
    if (pc && code && norm(pc) === code) return j;
  }
  if (grnIndex < poItems.length) return grnIndex;
  return -1;
}

module.exports = { matchPurchaseOrderLineIndex };
