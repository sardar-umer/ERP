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
      .populate('accountId', 'accountNumber name')
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
        accountId: req.body.accountId || null
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

// GET /api/items?category=Bricks&q=brick&limit=50
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { category = '', q = '', limit = 50 } = req.query;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 5000);

    const query = { isActive: true, isCategoryRoot: { $ne: true } };
    if (category) query.category = category;
    if (q) query.name = { $regex: q, $options: 'i' };

    const items = await ItemMaster.find(query)
      .select('category categoryPath srNo name')
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
      accountId: req.body.accountId || null
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
    const nextAccountId = req.body.accountId !== undefined ? (req.body.accountId || null) : doc.accountId;

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
    doc.accountId = nextAccountId;
    await doc.save();

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
