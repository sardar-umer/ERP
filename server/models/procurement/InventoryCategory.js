const mongoose = require('mongoose');

/**
 * InventoryCategory — Odoo-style product category with finance account defaults.
 *
 * This is the automation engine: instead of setting accounts on every inventory
 * item individually, you set them once on the category. Every item in that
 * category inherits these accounts automatically for journal posting.
 *
 * Account roles:
 *   stockValuationAccount : DR on GRN  (e.g. 1100 – Inventory Asset)
 *   stockInputAccount     : CR on GRN  (e.g. 2100 – GRNI / Stock Accrual) ← key clearing account
 *   stockOutputAccount    : DR on SIN  (e.g. 5000 – COGS)
 *   purchaseAccount       : Expense account for non-GRN direct purchases
 *   salesAccount          : Revenue account when item is sold
 */
const inventoryCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    // ─── Finance Account Defaults ───────────────────────────────────────────
    // DR on GRN: inventory asset increases (e.g. 1100)
    stockValuationAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    // CR on GRN: GRNI clearing liability (e.g. 2100 – Goods Received Not Invoiced)
    stockInputAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    // DR on SIN: cost of goods sold / project expense (e.g. 5000)
    stockOutputAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    // AP bill expense account for non-GRN purchases
    purchaseAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    // Revenue account when items are sold
    salesAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    // ────────────────────────────────────────────────────────────────────────
    // Aliases / Standards
    assetAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    expenseAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    grniAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    adjustmentAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account'
    },
    isActive: {
      type: Boolean,
      default: true
    },
    /** Used for items with no Finance Category (only one category is the default) */
    isDefault: {
      type: Boolean,
      default: false
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

inventoryCategorySchema.index({ name: 1 });
inventoryCategorySchema.index({ isActive: 1 });

/**
 * Resolve all finance accounts for a category.
 * Returns populated account objects or null for each role.
 */
inventoryCategorySchema.methods.getFinanceAccounts = async function () {
  const Account = mongoose.model('Account');
  const resolve = async (id) => (id ? Account.findById(id).lean() : null);
  return {
    stockValuationAccount: await resolve(this.stockValuationAccount),
    stockInputAccount: await resolve(this.stockInputAccount),
    stockOutputAccount: await resolve(this.stockOutputAccount),
    purchaseAccount: await resolve(this.purchaseAccount),
    salesAccount: await resolve(this.salesAccount)
  };
};

module.exports = mongoose.model('InventoryCategory', inventoryCategorySchema);
