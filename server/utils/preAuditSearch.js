/**
 * Pre-Audit list search: matches a document when every word typed appears somewhere in it —
 * number, title, vendor / contractor / employee, items (description, code, brand, specification),
 * indent, project, department, amount, status, observations and comments.
 * Words can be in any order; commas in amounts are ignored (1,250,000 = 1250000).
 */

// Values that are never useful to search (ids, files, signatures, images, secrets)
const SKIP_KEY = /^(_id|__v|id)$|password|token|signature|stamp|path$|filename|url$|mimetype|base64|image|photo|logo|avatar|size$/i;
const MAX_DEPTH = 7;
const MAX_TERMS = 10;

const cache = new WeakMap();

const isObjectId = (v) => v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID');

const collect = (value, out, depth, seen) => {
  if (value == null || depth > MAX_DEPTH) return;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t && t.length < 5000) out.push(t);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      out.push(String(value));
      if (!Number.isInteger(value)) out.push(String(Math.round(value)));
    }
    return;
  }
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) out.push(value.toISOString().slice(0, 10));
    return;
  }
  if (typeof value !== 'object' || isObjectId(value) || Buffer.isBuffer(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v) => collect(v, out, depth + 1, seen));
    return;
  }
  Object.keys(value).forEach((k) => {
    if (SKIP_KEY.test(k)) return;
    collect(value[k], out, depth + 1, seen);
  });
};

/** All searchable text of one document, lower-case. */
const haystackOf = (doc) => {
  if (cache.has(doc)) return cache.get(doc);
  const parts = [];
  collect(doc, parts, 0, new WeakSet());
  const text = parts.join(' \n ').toLowerCase();
  cache.set(doc, text);
  return text;
};

/** Words typed in the search box, ready for matching ('' → []). */
const preAuditSearchTerms = (raw) => String(raw || '')
  .toLowerCase()
  .split(/\s+/)
  .map((w) => (/^[\d,.]+$/.test(w) ? w.replace(/,/g, '') : w))
  .map((w) => w.replace(/^[#"'(]+|[)"',.;:]+$/g, ''))
  .filter(Boolean)
  .slice(0, MAX_TERMS);

const matchesPreAuditSearch = (doc, terms) => {
  if (!terms || terms.length === 0) return true;
  const text = haystackOf(doc);
  return terms.every((t) => text.includes(t));
};

module.exports = { preAuditSearchTerms, matchesPreAuditSearch };
