/**
 * Company (legal entity) a procurement document belongs to, so Finance knows whose books it falls in.
 * Documents without their own company take it from the PO / requisition they came from.
 */
const nameOf = (c) => (c && typeof c === 'object' ? c.name : '') || '';

const fromPo = (po) => nameOf(po?.companyId) || nameOf(po?.indent?.companyId);

export const getDocCompanyName = (doc, fallback = '—') => {
  if (!doc) return fallback;
  return (
    nameOf(doc.companyId) ||
    nameOf(doc.indent?.companyId) ||
    nameOf(doc.referenceIndent?.companyId) ||
    fromPo(doc.purchaseOrder) ||
    fromPo(doc.referencePurchaseOrder) ||
    fromPo(doc.goodsReceive?.purchaseOrder) ||
    (typeof doc.company === 'string' ? doc.company : '') ||
    fallback
  );
};

export default getDocCompanyName;
