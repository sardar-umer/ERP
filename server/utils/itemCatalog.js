const mongoose = require('mongoose');

/**
 * Item Catalog (ItemMaster) is the one item master. Inventory rows are stock cards linked to a catalog item.
 * Indents, POs and GRNs carry the item by name (and code where known); this resolves them to the same catalog
 * item everywhere: catalog id → item code (catalog or stock card) → exact name (case-insensitive, prefer the
 * one that already has a stock card).
 */

/** Catalog path for items first seen on a GRN / Inventory form that were not in the catalog */
const UNCATALOGUED_PATH = 'Material > Uncatalogued';
const UNCATALOGUED_CATEGORY = 'Uncatalogued';

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (v) => (v != null ? String(v).replace(/\s+/g, ' ').trim() : '');

const ItemMaster = () => require('../models/general/ItemMaster');

/** The default Finance Category: the one flagged isDefault, else "General", else the first active one */
const defaultFinanceCategory = async () => {
  const InventoryCategory = mongoose.model('InventoryCategory');
  return await InventoryCategory.findOne({ isDefault: true, isActive: true }).select('_id name').lean()
    || await InventoryCategory.findOne({ name: 'General', isActive: true }).select('_id name').lean()
    || await InventoryCategory.findOne({ isActive: true }).sort({ name: 1 }).select('_id name').lean();
};

const resolveCatalogItem = async ({ itemMaster, code, name } = {}) => {
  const IM = ItemMaster();
  const base = { isCategoryRoot: { $ne: true } };
  const id = String(itemMaster?._id || itemMaster || '');
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    const byId = await IM.findOne({ ...base, _id: id }).lean();
    if (byId) return byId;
  }
  const c = clean(code);
  if (c && c !== '—') {
    const byCode = await IM.findOne({ ...base, itemCode: c }).lean();
    if (byCode) return byCode;
    const Inventory = mongoose.model('Inventory');
    const card = await Inventory.findOne({ itemCode: c }).select('itemMaster').lean();
    if (card?.itemMaster) {
      const viaCard = await IM.findOne({ ...base, _id: card.itemMaster }).lean();
      if (viaCard) return viaCard;
    }
  }
  const n = clean(name);
  if (n && n !== '—') {
    const matches = await IM.find({ ...base, name: new RegExp(`^\\s*${escapeRx(n)}\\s*$`, 'i') })
      .sort({ inventoryItem: -1, isActive: -1, createdAt: 1 })
      .limit(5)
      .lean();
    return matches.find((m) => m.isActive !== false) || matches[0] || null;
  }
  return null;
};

/** Catalog row for something not in the catalog yet (kept under "Uncatalogued" so it can be tidied later) */
const createUncatalogued = async ({ name, unit, itemCode }) => {
  const IM = ItemMaster();
  const n = clean(name);
  const existing = await IM.findOne({ categoryPath: UNCATALOGUED_PATH, name: n });
  if (existing) return existing.toObject();
  const last = await IM.findOne({ categoryPath: UNCATALOGUED_PATH, isCategoryRoot: { $ne: true } }).sort({ srNo: -1 }).select('srNo').lean();
  const doc = await IM.create({
    category: UNCATALOGUED_CATEGORY,
    categoryPath: UNCATALOGUED_PATH,
    name: n,
    srNo: (last?.srNo || 0) + 1,
    unit: clean(unit),
    ...(itemCode ? { itemCode } : {}),
    isActive: true
  });
  return doc.toObject();
};

/**
 * Stock card (Inventory) for a catalog item — reuses the linked one, links an unlinked card with the same code,
 * or creates a new card carrying the catalog code / name / unit.
 */
const ensureStockCard = async (catalogItem, { userId, unit, unitPrice = 0, store, storeSnapshot, location, description } = {}) => {
  const Inventory = mongoose.model('Inventory');
  const IM = ItemMaster();
  if (catalogItem.inventoryItem) {
    const linked = await Inventory.findById(catalogItem.inventoryItem);
    if (linked) return linked;
  }
  let card = await Inventory.findOne({ itemMaster: catalogItem._id });
  if (!card && catalogItem.itemCode) card = await Inventory.findOne({ itemCode: catalogItem.itemCode });
  if (!card) {
    // Finance Category comes from the catalog item (set on its catalog category); default category otherwise
    const financeCategory = catalogItem.inventoryCategory || (await defaultFinanceCategory())?._id;
    const barcode = typeof Inventory.generateBarcodeValue === 'function'
      ? await Inventory.generateBarcodeValue(catalogItem.itemCode)
      : undefined;
    card = new Inventory({
      itemCode: catalogItem.itemCode,
      name: catalogItem.name,
      description: description || '',
      unit: clean(unit) || catalogItem.unit || 'Nos',
      quantity: 0,
      unitPrice: Number(unitPrice) || 0,
      inventoryCategory: financeCategory,
      itemMaster: catalogItem._id,
      barcode,
      barcodeType: 'CODE128',
      store: store || undefined,
      storeSnapshot,
      location: location || {},
      createdBy: userId
    });
    await card.save();
  } else if (!card.itemMaster) {
    await Inventory.updateOne({ _id: card._id }, { $set: { itemMaster: catalogItem._id } });
    card.itemMaster = catalogItem._id;
  }
  await IM.updateOne({ _id: catalogItem._id }, { $set: { inventoryItem: card._id, ...(catalogItem.unit ? {} : { unit: card.unit }) } });
  return card;
};

/** Fill catalog code / link on indent or PO lines that do not have one (used by their pre-save hooks) */
const annotateLines = async (lines, { nameField, codeField }) => {
  for (const line of lines || []) {
    if (line[codeField] && line.itemMaster) continue;
    const cat = await resolveCatalogItem({ itemMaster: line.itemMaster, code: line[codeField], name: line[nameField] });
    if (!cat) continue;
    if (!line[codeField]) line[codeField] = cat.itemCode;
    if (!line.itemMaster) line.itemMaster = cat._id;
  }
};

module.exports = { defaultFinanceCategory, resolveCatalogItem, createUncatalogued, ensureStockCard, annotateLines, UNCATALOGUED_PATH, UNCATALOGUED_CATEGORY };
