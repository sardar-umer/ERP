const GoodsReceive = require('../models/procurement/GoodsReceive');

/**
 * A vendor bill's linked GRNs when the GRN was not made against a purchase order
 * (the PO lookup finds nothing, so the bill would otherwise show no linked documents).
 */
async function loadLinkedGrnsWithoutPo(bill) {
  const ids = (bill?.linkedGRNs || []).map((g) => g.grnId).filter(Boolean);
  if (!ids.length && bill?.referenceType === 'grn' && bill.referenceId) ids.push(bill.referenceId);
  if (!ids.length) return null;
  const grns = await GoodsReceive.find({ _id: { $in: ids } })
    .populate('supplier', 'name')
    .populate('receivedBy', 'firstName lastName email')
    .lean();
  return grns.length ? { po: null, indent: null, quotations: [], grns } : null;
}

/**
 * Every file that backs a vendor bill, in one list: the bill's own attachments, then the files on its
 * GRN(s), purchase order, indent and quotations. Each entry says which document it came from, so
 * Audit, Finance and the CEO see the whole trail without opening each document.
 */
function buildBillSupportingDocuments(bill, poDetail) {
  const docs = [];
  const seen = new Set();
  const push = (list, source, documentType) => {
    (Array.isArray(list) ? list : []).forEach((a, idx) => {
      const url = a?.path || a?.url || '';
      if (!url || seen.has(url)) return;
      seen.add(url);
      docs.push({
        id: `${documentType}-${a?._id || idx}-${docs.length}`,
        documentType,
        source,
        name: a?.originalName || a?.filename || `Document ${idx + 1}`,
        url,
        mimeType: a?.mimeType || '',
        uploadedAt: a?.uploadedAt || null
      });
    });
  };

  push(bill?.attachments, `Vendor Bill ${bill?.billNumber || ''}`.trim(), 'bill');
  (poDetail?.grns || []).forEach((g) => push(g.attachments, `GRN ${g.receiveNumber || ''}`.trim(), 'grn'));
  if (poDetail?.po) push(poDetail.po.attachments, `Purchase Order ${poDetail.po.orderNumber || ''}`.trim(), 'purchase_order');
  if (poDetail?.indent) push(poDetail.indent.attachments, `Indent ${poDetail.indent.indentNumber || ''}`.trim(), 'indent');
  (poDetail?.quotations || []).forEach((q) => push(q.attachments, `Quotation ${q.quotationNumber || ''}${q.vendor?.name ? ` (${q.vendor.name})` : ''}`.trim(), 'quotation'));
  return docs;
}

module.exports = { buildBillSupportingDocuments, loadLinkedGrnsWithoutPo };
