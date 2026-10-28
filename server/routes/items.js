const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { authorize } = require('../middleware/auth');
const ItemMaster = require('../models/general/ItemMaster');

const manageCatalog = authorize('super_admin', 'admin', 'procurement_manager', 'general_indent');

/** Internal item name for category-only rows — avoids unique(categoryPath+name) clash with a real item named like the category */
const CATEGORY_ROOT_ITEM_NAME = '__category_root__';

async function removeCategoryRootsForPath(categoryPath) {
  if (!categoryPath) return;
  await ItemMaster.deleteMany({ categoryPath, isCategoryRoot: true });
}

/** When no active real items remain under a path, recreate a single placeholder row so the category still appears in the catalog. */
async function ensureCategoryRootIfNoActiveItems(categoryPath, categoryLabel) {
  if (!categoryPath) return;
  const activeItems = await ItemMaster.countDocuments({
    categoryPath,
    isCategoryRoot: { $ne: true },
    isActive: true
  });
  if (activeItems > 0) return;
  const hasRoot = await ItemMaster.findOne({ categoryPath, isCategoryRoot: true }).lean();
  if (hasRoot) return;
  const label = trimStr(categoryLabel) || categoryPath;
  try {
    await ItemMaster.create({
      category: label,
      categoryPath,
      name: CATEGORY_ROOT_ITEM_NAME,
      srNo: 0,
      isActive: true,
      isCategoryRoot: true
    });
  } catch (e) {
    if (e && e.code !== 11000) throw e;
  }
}

const objId = (v) => {
  const id = String(v?._id || v || '');
  return /^[a-f0-9]{24}$/i.test(id) ? id : null;
};

/** Finance Category for a new row in a path: the category row's, else the most common one among its items */
async function financeCategoryForPath(categoryPath) {
  const root = await ItemMaster.findOne({ categoryPath, isCategoryRoot: true, inventoryCategory: { $ne: null } }).select('inventoryCategory').lean();
  if (root) return root.inventoryCategory;
  const [top] = await ItemMaster.aggregate([
    { $match: { categoryPath, inventoryCategory: { $ne: null } } },
    { $group: { _id: '$inventoryCategory', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 1 }
  ]);
  return top?._id || null;
}

/** Keep stock cards on the same Finance Category as their catalog item */
async function syncStockCardCategory(filter) {
  const Inventory = require('../models/procurement/Inventory');
  const rows = await ItemMaster.find({ ...filter, inventoryItem: { $ne: null }, inventoryCategory: { $ne: null } }).select('inventoryItem inventoryCategory').lean();
  if (!rows.length) return;
  await Inventory.bulkWrite(rows.map((r) => ({
    updateOne: { filter: { _id: r.inventoryItem }, update: { $set: { inventoryCategory: r.inventoryCategory } } }
  })));
}

function trimStr(v) {
  return v != null ? String(v).replace(/\s+/g, ' ').trim() : '';
}

// GET /api/items/categories
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const categories = await ItemMaster.distinct('category', { isActive: true });
    categories.sort((a, b) => String(a).localeCompare(String(b)));
    res.json({ success: true, data: categories });
  })
);

// GET /api/items/manage-list — full catalog for Store UI (includes inactive + category roots)
router.get(
  '/manage-list',
  manageCatalog,
  asyncHandler(async (req, res) => {
    const items = await ItemMaster.find({})
      .populate('inventoryCategory', 'name')
      .populate('inventoryItem', 'quantity unit itemCode')
      .sort({ updatedAt: -1, categoryPath: 1, isCategoryRoot: -1, srNo: 1, name: 1 })
      .lean();
    res.json({ success: true, data: items });
  })
);

// POST /api/items/categories — create an empty category (category root row)
router.post(
  '/categories',
  manageCatalog,
  asyncHandler(async (req, res) => {
    const category = trimStr(req.body.category);
    if (!category) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }
    if (trimStr(req.body.name) === CATEGORY_ROOT_ITEM_NAME || category === CATEGORY_ROOT_ITEM_NAME) {
      return res.status(400).json({ success: false, message: 'This category name is reserved' });
    }
    const categoryPath = trimStr(req.body.categoryPath) || category;
    const existingRoot = await ItemMaster.findOne({
      categoryPath,
      $or: [{ isCategoryRoot: true }, { name: CATEGORY_ROOT_ITEM_NAME }]
    }).lean();
    if (existingRoot) {
      return res.status(409).json({ success: false, message: 'This category already exists' });
    }
    const itemNameCollision = await ItemMaster.findOne({
      categoryPath,
      name: category,
      isCategoryRoot: { $ne: true }
    }).lean();
    if (itemNameCollision) {
      return res.status(409).json({
        success: false,
        message:
          `There is already a catalog item named "${category}" under this path. Use a different category label, or add more items under that category from Item catalog → Add item (the category may already appear in indents from import).`
      });
    }
    try {
      const doc = await ItemMaster.create({
        category,
        categoryPath,
        name: CATEGORY_ROOT_ITEM_NAME,
        srNo: 0,
        isActive: true,
        isCategoryRoot: true,
        inventoryCategory: objId(req.body.inventoryCategory)
      });
      res.status(201).json({ success: true, data: doc });
    } catch (e) {
      if (e && e.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'This category or path already exists in the catalog (duplicate key).'
        });
      }
      throw e;
    }
  })
);

// GET /api/items/category-finance — each catalog category with its Finance Category (decides the accounts)
router.get(
  '/category-finance',
  manageCatalog,
  asyncHandler(async (req, res) => {
    const rows = await ItemMaster.aggregate([
      { $group: {
        _id: '$categoryPath',
        category: { $first: '$category' },
        items: { $sum: { $cond: [{ $ne: ['$isCategoryRoot', true] }, 1, 0] } },
        // $ifNull: rows created before these fields existed do not have them at all
        stocked: { $sum: { $cond: [{ $ifNull: ['$inventoryItem', false] }, 1, 0] } },
        financeCategories: { $addToSet: { $ifNull: ['$inventoryCategory', null] } }
      } },
      { $sort: { _id: 1 } }
    ]);
    const InventoryCategory = require('../models/procurement/InventoryCategory');
    const names = new Map((await InventoryCategory.find({}).select('name').lean()).map((c) => [String(c._id), c.name]));
    res.json({
      success: true,
      data: rows.map((r) => {
        const set = r.financeCategories.filter(Boolean).map(String);
        return {
          categoryPath: r._id,
          category: r.category,
          items: r.items,
          stocked: r.stocked,
          inventoryCategory: set.length === 1 && r.financeCategories.every(Boolean) ? set[0] : null,
          mixed: set.length > 1 || (set.length === 1 && !r.financeCategories.every(Boolean)),
          financeCategoryNames: set.map((id) => names.get(id) || '?')
        };
      })
    });
  })
);

// PUT /api/items/category-finance { categoryPath, inventoryCategory } — set it for every item in the category
router.put(
  '/category-finance',
  manageCatalog,
  asyncHandler(async (req, res) => {
    const categoryPath = trimStr(req.body.categoryPath);
    if (!categoryPath) return res.status(400).json({ success: false, message: 'Category path is required' });
    const inventoryCategory = objId(req.body.inventoryCategory);
    const r = await ItemMaster.updateMany({ categoryPath }, { $set: { inventoryCategory } });
    await syncStockCardCategory({ categoryPath });
    res.json({ success: true, message: `Finance Category set for ${r.modifiedCount} catalog row(s) in ${categoryPath}` });
  })
);

// GET /api/items?category=Bricks&q=brick&limit=50
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { category = '', q = '', limit = 50 } = req.query;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 5000);

    const query = { isActive: true, isCategoryRoot: { $ne: true } };
    if (category) query.category = category;
    if (q) {
      const rx = { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      query.$or = [{ name: rx }, { itemCode: rx }];
    }

    const items = await ItemMaster.find(query)
      .select('category categoryPath srNo name itemCode unit inventoryItem')
      .populate('inventoryItem', 'quantity unit itemCode')
      .sort({ categoryPath: 1, srNo: 1, name: 1 })
      .limit(lim)
      .lean();

    res.json({ success: true, data: items });
  })
);

// POST /api/items — create catalog item (indent / store master)
router.post(
  '/',
  manageCatalog,
  asyncHandler(async (req, res) => {
    const category = trimStr(req.body.category);
    const name = trimStr(req.body.name);
    if (!category) {
      return res.status(400).json({ success: false, message: 'Category is required' });
    }
    if (!name) {
      return res.status(400).json({ success: false, message: 'Item name is required' });
    }
    if (name === CATEGORY_ROOT_ITEM_NAME) {
      return res.status(400).json({ success: false, message: 'This item name is reserved' });
    }
    const categoryPath = trimStr(req.body.categoryPath) || category;
    const dup = await ItemMaster.findOne({ categoryPath, name }).lean();
    if (dup) {
      return res.status(409).json({ success: false, message: 'An item with this name already exists in this category path' });
    }
    let srNo = parseInt(req.body.srNo, 10);
    if (!Number.isFinite(srNo) || srNo < 1) {
      const maxRow = await ItemMaster.findOne({
        categoryPath,
        isCategoryRoot: { $ne: true }
      })
        .sort({ srNo: -1 })
        .select('srNo')
        .lean();
      srNo = (maxRow && maxRow.srNo) ? maxRow.srNo + 1 : 1;
    }
    const doc = await ItemMaster.create({
      category,
      categoryPath,
      name,
      srNo,
      isActive: true,
      isCategoryRoot: false,
      unit: trimStr(req.body.unit),
      inventoryCategory: objId(req.body.inventoryCategory) || await financeCategoryForPath(categoryPath)
    });
    await removeCategoryRootsForPath(categoryPath);
    res.status(201).json({ success: true, data: doc });
  })
);

// PUT /api/items/:id
router.put(
  '/:id',
  manageCatalog,
  asyncHandler(async (req, res) => {
    const doc = await ItemMaster.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Item not found' });

    const prevPathForSync = doc.isCategoryRoot ? null : doc.categoryPath;
    const prevCatForSync = doc.isCategoryRoot ? null : doc.category;

    const nextCategory = req.body.category !== undefined ? trimStr(req.body.category) : doc.category;
    const nextName = req.body.name !== undefined ? trimStr(req.body.name) : doc.name;
    const nextPath = req.body.categoryPath !== undefined ? trimStr(req.body.categoryPath) : doc.categoryPath;
    let nextSr = req.body.srNo !== undefined ? parseInt(req.body.srNo, 10) : doc.srNo;
    const nextActive = req.body.isActive !== undefined ? !!req.body.isActive : doc.isActive;
    const prevFinanceCategory = doc.inventoryCategory ? String(doc.inventoryCategory) : null;
    const nextFinanceCategory = req.body.inventoryCategory !== undefined ? objId(req.body.inventoryCategory) : doc.inventoryCategory;
    const nextUnit = req.body.unit !== undefined ? trimStr(req.body.unit) : doc.unit;

    if (!nextCategory) return res.status(400).json({ success: false, message: 'Category is required' });
    if (!nextPath) return res.status(400).json({ success: false, message: 'Category path is required' });
    if (!doc.isCategoryRoot && !nextName) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!Number.isFinite(nextSr) || nextSr < 0) {
      // Keep existing serial when client sends blank/invalid instead of blocking edit
      nextSr = Number.isFinite(Number(doc.srNo)) ? Number(doc.srNo) : (doc.isCategoryRoot ? 0 : 1);
    }

    const effectiveName = doc.isCategoryRoot ? CATEGORY_ROOT_ITEM_NAME : nextName;

    if (doc.isCategoryRoot && (doc.categoryPath !== nextPath || doc.category !== nextCategory)) {
      const oldPath = doc.categoryPath;
      await ItemMaster.updateMany(
        { categoryPath: oldPath },
        { $set: { categoryPath: nextPath, category: nextCategory } }
      );
      doc.categoryPath = nextPath;
      doc.category = nextCategory;
    }

    if (nextPath !== doc.categoryPath || effectiveName !== doc.name) {
      const dup = await ItemMaster.findOne({
        categoryPath: nextPath,
        name: effectiveName,
        _id: { $ne: doc._id }
      }).lean();
      if (dup) {
        return res.status(409).json({ success: false, message: 'Another row already uses this category path and name' });
      }
    }

    doc.category = nextCategory;
    doc.name = effectiveName;
    doc.categoryPath = nextPath;
    doc.srNo = nextSr;
    doc.isActive = nextActive;
    doc.inventoryCategory = nextFinanceCategory;
    doc.unit = nextUnit;
    await doc.save();

    // Category row: its Finance Category flows to the items that followed the old one (or had none)
    const financeChanged = String(nextFinanceCategory || '') !== String(prevFinanceCategory || '');
    if (doc.isCategoryRoot && financeChanged) {
      await ItemMaster.updateMany(
        { categoryPath: doc.categoryPath, isCategoryRoot: { $ne: true }, inventoryCategory: { $in: [null, prevFinanceCategory].filter((v, i) => i === 0 || v) } },
        { $set: { inventoryCategory: nextFinanceCategory } }
      );
      await syncStockCardCategory({ categoryPath: doc.categoryPath });
    } else if (financeChanged) {
      await syncStockCardCategory({ _id: doc._id });
    }

    if (!doc.isCategoryRoot) {
      const newPath = doc.categoryPath;
      const newCat = doc.category;
      const pathsToSync = new Set([newPath]);
      if (prevPathForSync && prevPathForSync !== newPath) {
        pathsToSync.add(prevPathForSync);
      }
      for (const path of pathsToSync) {
        const activeCount = await ItemMaster.countDocuments({
          categoryPath: path,
          isCategoryRoot: { $ne: true },
          isActive: true
        });
        if (activeCount > 0) {
          await removeCategoryRootsForPath(path);
        } else {
          const label = path === newPath ? newCat : prevCatForSync || newCat;
          await ensureCategoryRootIfNoActiveItems(path, label);
        }
      }
    }

    res.json({ success: true, data: doc });
  })
);

// DELETE /api/items/:id — soft-delete (deactivate). Category root only if no active real items remain.
router.delete(
  '/:id',
  manageCatalog,
  asyncHandler(async (req, res) => {
    const doc = await ItemMaster.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Item not found' });

    if (doc.isCategoryRoot) {
      const remaining = await ItemMaster.countDocuments({
        categoryPath: doc.categoryPath,
        isCategoryRoot: { $ne: true },
        isActive: true,
        _id: { $ne: doc._id }
      });
      if (remaining > 0) {
        return res.status(400).json({
          success: false,
          message: 'Deactivate or remove all items in this category before removing the category'
        });
      }
    }

    doc.isActive = false;
    await doc.save();

    if (!doc.isCategoryRoot) {
      await ensureCategoryRootIfNoActiveItems(doc.categoryPath, doc.category);
    }

    res.json({ success: true, message: 'Item deactivated', data: doc });
  })
);

module.exports = router;
