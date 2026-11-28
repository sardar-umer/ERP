/**
 * Item purchase history for Pre-Audit: earlier POs that bought the same (or a similar) item as one
 * line of a PO, with their rates, so Audit can check this PO's rate against SGC's own purchases.
 *
 * Match order (most PO lines have no catalogue link or product code, so description matters most):
 *   same item  — same catalogue item, same product code, or same description (case / spacing ignored)
 *   similar    — descriptions sharing most of their key words (score shown, 0.6 and above)
 * Only POs created before this PO count; drafts are left out. Read-only.
 */
const mongoose = require('mongoose');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
require('../models/hr/Supplier');
require('../models/general/Indent');

const SIMILAR_MIN = 0.6;
const MAX_ROWS = 60;
// Statuses whose rates were not actually agreed (still listed, left out of the price summary)
const NOT_AGREED = ['Rejected', 'Cancelled'];
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'a', 'an', 'by', 'per', 'as', 'or',
  'nos', 'no', 'pcs', 'pc', 'piece', 'pieces', 'qty', 'set', 'sets', 'each', 'unit', 'units', 'item', 'items'
]);

const normText = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Key words of a description: lower-case, no punctuation, no filler words; "16 gb" → "16gb" */
const keyWords = (v) => {
  const words = normText(v)
    .replace(/(\d)\s+(gb|tb|mb|mm|cm|kg|ft|inch|in|kw|kva|w|v|hp|ltr|l|m)\b/g, '$1$2')
    .replace(/[^a-z0-9./"#-]+/g, ' ')
    .split(' ')
    .map((w) => w.replace(/^[./"#-]+|[./"#-]+$/g, ''))
    .filter((w) => w && (w.length >= 2 || /\d/.test(w)) && !STOP_WORDS.has(w));
  return [...new Set(words)];
};

const isWord = (w) => /[a-z]{3,}/.test(w);

/**
 * Share of key words two descriptions have in common (Dice coefficient, 0–1). Needs at least one real
 * word in common, so sizes alone ("3/8", "16gb") never make two different items similar.
 */
const similarity = (a, b) => {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const common = a.filter((w) => setB.has(w));
  if (!common.some(isWord)) return 0;
  return (2 * common.length) / (a.length + b.length);
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const buildPoItemHistory = async (poId, lineIndex) => {
  const po = await PurchaseOrder.findById(poId).select('orderNumber orderDate createdAt items').lean();
  if (!po) return null;
  const line = (po.items || [])[Number(lineIndex)];
  if (!line) return null;

  const lineMaster = line.itemMaster ? String(line.itemMaster) : '';
  const lineCode = normText(line.productCode);
  const lineDesc = normText(line.description);
  const lineWords = keyWords(`${line.description || ''} ${line.specification || ''}`.trim() || line.description);
  const descWords = keyWords(line.description);

  const others = await PurchaseOrder.find({
    _id: { $ne: po._id },
    status: { $ne: 'Draft' },
    createdAt: { $lt: po.createdAt }
  })
    .select('orderNumber orderDate createdAt status vendor indent items.itemMaster items.productCode items.description items.specification items.brand items.quantity items.unit items.unitPrice items.discount')
    .sort({ createdAt: -1 })
    .lean();

  const rows = [];
  for (const other of others) {
    (other.items || []).forEach((it) => {
      let matchedBy = '';
      let score = 0;
      if (lineMaster && it.itemMaster && String(it.itemMaster) === lineMaster) matchedBy = 'Same catalogue item';
      else if (lineCode && normText(it.productCode) === lineCode) matchedBy = 'Same product code';
      else if (lineDesc && normText(it.description) === lineDesc) matchedBy = 'Same description';
      else {
        // Compare on the description; also try with specification for lines whose description is short
        score = Math.max(
          similarity(descWords, keyWords(it.description)),
          similarity(lineWords, keyWords(`${it.description || ''} ${it.specification || ''}`))
        );
        if (score >= SIMILAR_MIN) matchedBy = 'Similar';
      }
      if (!matchedBy) return;
      rows.push({
        purchaseOrderId: other._id,
        orderNumber: other.orderNumber,
        date: other.orderDate || other.createdAt,
        status: other.status,
        vendorId: other.vendor ? String(other.vendor) : '',
        indentId: other.indent ? String(other.indent) : '',
        description: it.description || '',
        specification: it.specification || '',
        brand: it.brand || '',
        quantity: Number(it.quantity) || 0,
        unit: it.unit || '',
        unitPrice: Number(it.unitPrice) || 0,
        discount: Number(it.discount) || 0,
        matchedBy,
        similarity: matchedBy === 'Similar' ? round2(score) : 1
      });
    });
  }

  // Same items first, then the closest similar ones; newest first within each
  rows.sort((a, b) => (b.similarity - a.similarity) || (new Date(b.date) - new Date(a.date)));
  const listed = rows.slice(0, MAX_ROWS);

  // Vendor and indent names only for the POs that matched
  const Supplier = mongoose.model('Supplier');
  const Indent = mongoose.model('Indent');
  const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter(Boolean))];
  const indentIds = [...new Set(listed.map((r) => r.indentId).filter(Boolean))];
  const [vendors, indents] = await Promise.all([
    vendorIds.length ? Supplier.find({ _id: { $in: vendorIds } }).select('name').lean() : [],
    indentIds.length ? Indent.find({ _id: { $in: indentIds } }).select('indentNumber').lean() : []
  ]);
  const vendorName = new Map(vendors.map((v) => [String(v._id), v.name || '']));
  const indentNumber = new Map(indents.map((i) => [String(i._id), i.indentNumber || '']));
  rows.forEach((r) => {
    r.vendorName = vendorName.get(r.vendorId) || '';
    r.indentNumber = indentNumber.get(r.indentId) || '';
    delete r.vendorId;
    delete r.indentId;
  });

  // Price summary from earlier POs whose rate was agreed (not rejected / cancelled). Uses the same item
  // when it was bought before; similar items only when the same item never appears at all.
  const agreed = rows.filter((r) => !NOT_AGREED.includes(r.status) && r.unitPrice > 0);
  const hasSame = rows.some((r) => r.matchedBy !== 'Similar');
  const basis = hasSame ? agreed.filter((r) => r.matchedBy !== 'Similar') : agreed;
  const byDate = [...basis].sort((a, b) => new Date(b.date) - new Date(a.date));
  const prices = basis.map((r) => r.unitPrice);
  const current = Number(line.unitPrice) || 0;
  const pct = (ref) => (ref > 0 && current > 0 ? round2(((current - ref) / ref) * 100) : null);
  const summary = prices.length ? {
    basedOn: hasSame ? 'same' : 'similar',
    count: prices.length,
    last: { unitPrice: byDate[0].unitPrice, orderNumber: byDate[0].orderNumber, date: byDate[0].date, vendorName: byDate[0].vendorName },
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    average: round2(prices.reduce((s, p) => s + p, 0) / prices.length),
    vsLastPct: pct(byDate[0].unitPrice),
    vsLowestPct: pct(Math.min(...prices)),
    vsAveragePct: pct(prices.reduce((s, p) => s + p, 0) / prices.length)
  } : null;

  return {
    purchaseOrderId: po._id,
    orderNumber: po.orderNumber,
    line: {
      index: Number(lineIndex),
      description: line.description || '',
      specification: line.specification || '',
      brand: line.brand || '',
      productCode: line.productCode || '',
      quantity: Number(line.quantity) || 0,
      unit: line.unit || '',
      unitPrice: current
    },
    rows: listed,
    totalMatches: rows.length,
    summary,
    // Same item bought before, but every such PO was rejected / cancelled (no agreed rate to compare)
    onlyNotAgreed: hasSame && !summary
  };
};

module.exports = { buildPoItemHistory, keyWords, similarity };
