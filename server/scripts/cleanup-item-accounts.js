/**
 * Finance setup cleanup — items should inherit accounts from their Finance Category, not hold frozen copies.
 * Safe to run more than once. Usage:
 *   node server/scripts/cleanup-item-accounts.js --dry-run
 *   node server/scripts/cleanup-item-accounts.js
 * Uses MONGODB_URI in production (NODE_ENV=production), otherwise MONGODB_URI_LOCAL.
 *
 * 1. Clears item-level accounts that are identical to the item's category account (real overrides are kept).
 * 2. Items without a Finance Category get the default category.
 * 3. Marks "General" as the default Finance Category when none is marked.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const uri = process.env.NODE_ENV === 'production' ? process.env.MONGODB_URI : (process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI);

const PAIRS = [
  ['inventoryAccount', 'stockValuationAccount'],
  ['grniAccount', 'stockInputAccount'],
  ['cogsAccount', 'stockOutputAccount'],
  ['salesAccount', 'salesAccount'],
  ['purchaseAccount', 'purchaseAccount']
];

(async () => {
  await mongoose.connect(uri);
  const InventoryCategory = require('../models/procurement/InventoryCategory');
  const Inventory = require('../models/procurement/Inventory');

  let def = await InventoryCategory.findOne({ isDefault: true, isActive: true }).lean();
  if (!def) {
    def = await InventoryCategory.findOne({ name: 'General', isActive: true }).lean()
      || await InventoryCategory.findOne({ isActive: true }).sort({ name: 1 }).lean();
    if (def && !DRY) await InventoryCategory.updateOne({ _id: def._id }, { $set: { isDefault: true } });
    console.log(`Default Finance Category: ${def ? def.name : '(none — create one)'}${def && !DRY ? ' (marked)' : ''}`);
  }

  const cats = new Map((await InventoryCategory.find({}).lean()).map((c) => [String(c._id), c]));
  const items = await Inventory.find({}).select('itemCode name inventoryCategory ' + PAIRS.map((p) => p[0]).join(' ')).lean();
  let cleared = 0; let kept = 0; let categorised = 0;
  const overrides = [];
  for (const it of items) {
    const set = {}; const unset = {};
    if (!it.inventoryCategory && def) { set.inventoryCategory = def._id; categorised++; }
    const cat = cats.get(String(it.inventoryCategory || def?._id));
    for (const [itemField, catField] of PAIRS) {
      if (!it[itemField]) continue;
      if (cat && String(cat[catField] || '') === String(it[itemField])) { unset[itemField] = ''; cleared++; }
      else { kept++; overrides.push(`${it.itemCode} ${it.name}: ${itemField}`); }
    }
    if (!DRY && (Object.keys(set).length || Object.keys(unset).length)) {
      await Inventory.updateOne({ _id: it._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    }
  }
  console.log(DRY ? '\nDRY RUN — nothing changed\n' : '\nApplied\n');
  console.log(`Item accounts that were copies of the category (cleared): ${cleared}`);
  console.log(`Item-level overrides kept (differ from category)        : ${kept}`);
  console.log(`Items given the default Finance Category                : ${categorised}`);
  overrides.slice(0, 50).forEach((o) => console.log(`   override kept – ${o}`));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
