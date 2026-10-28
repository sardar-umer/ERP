const mongoose = require('mongoose');

const itemMasterSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true },
    categoryPath: { type: String, required: true, trim: true },
    srNo: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    /** When true, this row exists only so the category appears before any real items are added. Hidden from indent item pickers. */
    isCategoryRoot: { type: Boolean, default: false },
    /** Legacy — never used for posting; Finance Category below decides the accounts */
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    /** Finance Category (InventoryCategory) — its accounts are used when this item is received / issued.
     *  Set on the category row; items inherit it. Copied to the item's stock card. */
    inventoryCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryCategory', default: null },
    /** The one item code — shared with the item's stock card (Inventory) and carried on indent / PO / GRN / SIN lines */
    itemCode: { type: String, trim: true },
    unit: { type: String, trim: true, default: '' },
    /** Stock card for this item (created on first receipt / opening stock) */
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', default: null }
  },
  { timestamps: true }
);

// Every real catalog item gets a code from the same sequence as inventory item codes
itemMasterSchema.pre('save', async function (next) {
  if (!this.isCategoryRoot && !this.itemCode) {
    const { nextDocumentNumber } = require('../../utils/documentSequence');
    this.itemCode = await nextDocumentNumber({ key: 'INV-ITEM', model: 'Inventory', field: 'itemCode', prefix: 'INV-', pad: 5 });
  }
  next();
});

itemMasterSchema.index({ categoryPath: 1, name: 1 }, { unique: true });
itemMasterSchema.index({ categoryPath: 1, srNo: 1 });
itemMasterSchema.index({ category: 1 });
itemMasterSchema.index({ name: 1 });
itemMasterSchema.index({ itemCode: 1 }, { unique: true, partialFilterExpression: { itemCode: { $type: 'string' } } });

module.exports = mongoose.model('ItemMaster', itemMasterSchema);

