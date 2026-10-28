const mongoose = require('mongoose');

/**
 * Collision-safe document numbers (replaces "countDocuments() + 1", which repeats a number after a delete
 * and when two users save at the same moment). One atomic counter per key; on first use it is seeded from
 * the highest number already in the collection, so existing numbering simply continues.
 */
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const SequenceCounter = mongoose.models.SequenceCounter || mongoose.model('SequenceCounter', counterSchema);

const seeded = new Set();

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Item codes are shared by Inventory and the Item Catalog — seed from both so a code is never reused */
const EXTRA_SOURCES = { 'INV-ITEM': [{ model: 'ItemMaster', field: 'itemCode', path: '../models/general/ItemMaster' }] };

const seedFromExisting = async ({ key, model, field, prefix }) => {
  if (seeded.has(key)) return;
  const rx = new RegExp(`^${escapeRx(prefix)}(\\d+)$`);
  let max = 0;
  for (const src of [{ model, field }, ...(EXTRA_SOURCES[key] || [])]) {
    if (!mongoose.models[src.model] && src.path) require(src.path);
    const rows = await mongoose.model(src.model).find({ [src.field]: rx }).select(src.field).lean();
    max = rows.reduce((m, r) => Math.max(m, Number(String(r[src.field]).match(rx)?.[1]) || 0), max);
  }
  await SequenceCounter.updateOne({ _id: key }, { $max: { seq: max } }, { upsert: true });
  seeded.add(key);
};

/** e.g. nextDocumentNumber({ key: 'SIN', model: 'GoodsIssue', field: 'issueNumber', prefix: 'SIN', pad: 8 }) → 'SIN00000042' */
const nextDocumentNumber = async ({ key, model, field, prefix, pad }) => {
  await seedFromExisting({ key, model, field, prefix });
  const { seq } = await SequenceCounter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true }).lean();
  return `${prefix}${String(seq).padStart(pad, '0')}`;
};

/** Reserve `count` numbers in one atomic step (bulk backfills) — returns the formatted numbers in order */
const reserveDocumentNumbers = async ({ key, model, field, prefix, pad, count }) => {
  if (!(count > 0)) return [];
  await seedFromExisting({ key, model, field, prefix });
  const { seq } = await SequenceCounter.findOneAndUpdate({ _id: key }, { $inc: { seq: count } }, { new: true, upsert: true }).lean();
  return Array.from({ length: count }, (_, i) => `${prefix}${String(seq - count + 1 + i).padStart(pad, '0')}`);
};

module.exports = { nextDocumentNumber, reserveDocumentNumbers };
