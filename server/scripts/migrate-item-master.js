/**
 * One item master — link Inventory (stock cards) to the Item Catalog (ItemMaster) and give every item one code.
 * Safe to run more than once. Usage:
 *   node server/scripts/migrate-item-master.js --dry-run     (report only)
 *   node server/scripts/migrate-item-master.js               (apply)
 * Uses MONGODB_URI in production (NODE_ENV=production), otherwise MONGODB_URI_LOCAL.
 *
 * 1. Each stock card without a catalog link is linked to the catalog item with the same name, or added to the
 *    catalog under "Material > Uncatalogued". A clean stock-card code (not an auto "…-GRN…" code) becomes the
 *    catalog code; auto codes are replaced by the catalog code.
 * 2. Every catalog item without a code gets one (INV-xxxxx, same sequence as stock cards).
 * 3. Open indent / PO lines get the catalog code + link.
 * Two stock cards with the same name are reported (not merged) — fix them by hand with Stock Check / Adjust.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const uri = process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI : (process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI);

const isAutoCode = (code) => /-GRN/i.test(String(code || ''));
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const key = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

(async () => {
  await mongoose.connect(uri);
  require('../models/procurement/InventoryCategory');
  const Inventory = require('../models/procurement/Inventory');
  const ItemMaster = require('../models/general/ItemMaster');
  const Indent = require('../models/general/Indent');
  const PurchaseOrder = require('../models/procurement/PurchaseOrder');
  const { reserveDocumentNumbers } = require('../utils/documentSequence');
  const { UNCATALOGUED_PATH, UNCATALOGUED_CATEGORY } = require('../utils/itemCatalog');
  const seqArgs = { key: 'INV-ITEM', model: 'Inventory', field: 'itemCode', prefix: 'INV-', pad: 5 };

  const report = { linked: 0, addedToCatalog: 0, codesFromCard: 0, catalogCodesAssigned: 0, cardsRenamed: 0, duplicateCards: [], indentLines: 0, poLines: 0 };
  const renameCard = []; // [cardId, catalogId] — card gets the catalog code once codes exist

  // 1. Stock cards → catalog
  const cards = await Inventory.find({ $or: [{ itemMaster: null }, { itemMaster: { $exists: false } }] }).select('itemCode name unit').lean();
  for (const card of cards) {
    const sameName = await ItemMaster.find({ isCategoryRoot: { $ne: true }, name: new RegExp(`^\\s*${escapeRx(card.name.trim())}\\s*$`, 'i') })
      .sort({ inventoryItem: 1, isActive: -1, createdAt: 1 }).lean();
    let cat = sameName.find((c) => !c.inventoryItem);
    if (!cat && sameName.length) {
      report.duplicateCards.push(`${card.itemCode} "${card.name}" (catalog item already has a stock card)`);
      continue;
    }
    if (!cat) {
      report.addedToCatalog++;
      if (DRY) continue;
      const last = await ItemMaster.findOne({ categoryPath: UNCATALOGUED_PATH, isCategoryRoot: { $ne: true } }).sort({ srNo: -1 }).select('srNo').lean();
      cat = (await ItemMaster.create({
        category: UNCATALOGUED_CATEGORY, categoryPath: UNCATALOGUED_PATH, name: card.name.trim(), srNo: (last?.srNo || 0) + 1,
        unit: card.unit || '', isActive: true,
        ...(isAutoCode(card.itemCode) ? {} : { itemCode: card.itemCode })
      })).toObject();
      if (isAutoCode(card.itemCode)) renameCard.push([card._id, cat._id]);
    } else {
      report.linked++;
      const takeCardCode = !cat.itemCode && !isAutoCode(card.itemCode);
      if (takeCardCode) report.codesFromCard++;
      if (DRY) continue;
      await ItemMaster.updateOne({ _id: cat._id }, { $set: { inventoryItem: card._id, ...(cat.unit ? {} : { unit: card.unit || '' }), ...(takeCardCode ? { itemCode: card.itemCode } : {}) } });
      if (!takeCardCode && cat.itemCode !== card.itemCode) renameCard.push([card._id, cat._id]);
    }
    if (!DRY) {
      await Inventory.updateOne({ _id: card._id }, { $set: { itemMaster: cat._id } });
      await ItemMaster.updateOne({ _id: cat._id }, { $set: { inventoryItem: card._id } });
    }
  }

  // 2. Codes for every catalog item without one (in catalog order)
  const noCode = await ItemMaster.find({ isCategoryRoot: { $ne: true }, $or: [{ itemCode: null }, { itemCode: { $exists: false } }, { itemCode: '' }] })
    .select('_id').sort({ categoryPath: 1, srNo: 1, name: 1 }).lean();
  report.catalogCodesAssigned = noCode.length;
  if (!DRY && noCode.length) {
    const codes = await reserveDocumentNumbers({ ...seqArgs, count: noCode.length });
    for (let i = 0; i < noCode.length; i += 1000) {
      await ItemMaster.bulkWrite(noCode.slice(i, i + 1000).map((c, j) => ({
        updateOne: { filter: { _id: c._id }, update: { $set: { itemCode: codes[i + j] } } }
      })));
    }
  }

  // Auto-coded stock cards take their catalog item's code
  for (const [cardId, catId] of renameCard) {
    const cat = await ItemMaster.findById(catId).select('itemCode').lean();
    if (!cat?.itemCode) continue;
    const clash = await Inventory.findOne({ itemCode: cat.itemCode, _id: { $ne: cardId } }).select('_id').lean();
    if (clash) continue;
    await Inventory.updateOne({ _id: cardId }, { $set: { itemCode: cat.itemCode } });
    report.cardsRenamed++;
  }
  if (DRY) report.cardsRenamed = `${cards.filter((c) => isAutoCode(c.itemCode)).length} (auto codes)`;

  // 3. Indent / PO lines → catalog code + link
  const catalogByName = new Map();
  const lookup = async (name) => {
    const k = key(name);
    if (!k) return null;
    if (!catalogByName.has(k)) {
      const c = await ItemMaster.findOne({ isCategoryRoot: { $ne: true }, name: new RegExp(`^\\s*${escapeRx(name.trim())}\\s*$`, 'i') })
        .sort({ inventoryItem: -1, isActive: -1, createdAt: 1 }).select('itemCode').lean();
      catalogByName.set(k, c || null);
    }
    return catalogByName.get(k);
  };
  const backfill = async (Model, nameField, codeField, counterKey) => {
    const docs = await Model.find({}).select(`items.${nameField} items.${codeField} items.itemMaster`).lean();
    for (const d of docs) {
      const set = {};
      for (let i = 0; i < (d.items || []).length; i++) {
        const it = d.items[i];
        if (it[codeField] && it.itemMaster) continue;
        const c = await lookup(it[nameField]);
        if (!c?.itemCode) continue;
        if (!it[codeField]) set[`items.${i}.${codeField}`] = c.itemCode;
        if (!it.itemMaster) set[`items.${i}.itemMaster`] = c._id;
        report[counterKey]++;
      }
      if (!DRY && Object.keys(set).length) await Model.collection.updateOne({ _id: d._id }, { $set: set });
    }
  };
  await backfill(Indent, 'itemName', 'itemCode', 'indentLines');
  await backfill(PurchaseOrder, 'description', 'productCode', 'poLines');

  console.log(DRY ? '\nDRY RUN — nothing changed\n' : '\nApplied\n');
  console.log(`Stock cards linked to an existing catalog item : ${report.linked}`);
  console.log(`Stock cards added to catalog (Uncatalogued)     : ${report.addedToCatalog}`);
  console.log(`Catalog items that kept the stock-card code     : ${report.codesFromCard}`);
  console.log(`Catalog items given a new code                  : ${report.catalogCodesAssigned}`);
  console.log(`Auto-coded stock cards renamed to catalog code  : ${report.cardsRenamed}`);
  console.log(`Indent lines linked                             : ${report.indentLines}`);
  console.log(`PO lines linked                                 : ${report.poLines}`);
  console.log(`Duplicate stock cards (same name, not linked)   : ${report.duplicateCards.length}`);
  report.duplicateCards.slice(0, 50).forEach((d) => console.log(`   - ${d}`));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
