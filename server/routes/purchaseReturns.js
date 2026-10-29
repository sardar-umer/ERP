const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const { authorize } = require('../middleware/auth');
const PurchaseReturn = require('../models/procurement/PurchaseReturn');
const Inventory = require('../models/procurement/Inventory');
const FinanceHelper = require('../utils/financeHelper');
const { getPurchaseReturnNarration, withVoucherNarration } = require('../utils/documentNarration');
const { resolveDocumentCompanyId } = require('../utils/financeCompanyContext');
const { withCompany } = require('../utils/financePosting');

// GET /api/procurement/purchase-returns
router.get('/', asyncHandler(async (req, res) => {
  const { status, supplier } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (supplier) filter.supplier = supplier;

  const returns = await PurchaseReturn.find(filter)
    .populate({ path: 'goodsReceive', select: 'receiveNumber receiveDate purchaseOrder', populate: { path: 'purchaseOrder', select: 'orderNumber companyId indent', populate: [{ path: 'companyId', select: 'name code symbol' }, { path: 'indent', select: 'companyId', populate: { path: 'companyId', select: 'name code symbol' } }] } })
    .populate({ path: 'purchaseOrder', select: 'orderNumber poNumber companyId indent', populate: [{ path: 'companyId', select: 'name code symbol' }, { path: 'indent', select: 'companyId', populate: { path: 'companyId', select: 'name code symbol' } }] })
    .populate('supplier', 'name code')
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });

  res.json({ success: true, data: returns, count: returns.length });
}));

// GET /api/procurement/purchase-returns/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const pr = await PurchaseReturn.findById(req.params.id)
    .populate({ path: 'goodsReceive', select: 'receiveNumber receiveDate purchaseOrder', populate: { path: 'purchaseOrder', select: 'orderNumber companyId indent', populate: [{ path: 'companyId', select: 'name code symbol' }, { path: 'indent', select: 'companyId', populate: { path: 'companyId', select: 'name code symbol' } }] } })
    .populate('supplier', 'name code email')
    .populate({ path: 'purchaseOrder', select: 'orderNumber poNumber companyId indent', populate: [{ path: 'companyId', select: 'name code symbol' }, { path: 'indent', select: 'companyId', populate: { path: 'companyId', select: 'name code symbol' } }] })
    .populate('items.inventoryItem', 'name itemCode unit averageCost')
    .populate('journalEntry', 'entryNumber date status');
  if (!pr) return res.status(404).json({ success: false, message: 'Purchase return not found' });
  res.json({ success: true, data: pr });
}));

// POST /api/procurement/purchase-returns — create return
router.post('/', authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const { goodsReceive, purchaseOrder, supplier, supplierName, returnDate, items, reason, notes } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'At least one item is required' });
  }

  const pr = await PurchaseReturn.create({
    goodsReceive, purchaseOrder, supplier, supplierName, returnDate, items, reason, notes,
    createdBy: req.user.id
  });

  res.status(201).json({ success: true, data: pr });
}));

// PUT /api/procurement/purchase-returns/:id — update draft
router.put('/:id', authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const pr = await PurchaseReturn.findById(req.params.id);
  if (!pr) return res.status(404).json({ success: false, message: 'Purchase return not found' });
  if (pr.status !== 'draft') return res.status(400).json({ success: false, message: 'Only draft returns can be edited' });

  ['items', 'reason', 'notes', 'returnDate', 'creditNoteNumber'].forEach(f => { if (req.body[f] !== undefined) pr[f] = req.body[f]; });
  pr.updatedBy = req.user.id;
  await pr.save();

  res.json({ success: true, data: pr });
}));

// POST /api/procurement/purchase-returns/:id/confirm — confirm + post inventory + finance
router.post('/:id/confirm', authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const pr = await PurchaseReturn.findById(req.params.id).populate('items.inventoryItem');
  if (!pr) return res.status(404).json({ success: false, message: 'Purchase return not found' });
  if (pr.status !== 'draft') return res.status(400).json({ success: false, message: 'Already confirmed' });

  // 1. Reverse inventory quantities
  for (const item of pr.items) {
    if (item.inventoryItem) {
      const inv = await Inventory.findById(item.inventoryItem._id || item.inventoryItem);
      if (inv) {
        inv.quantity = Math.max(0, (inv.quantity || 0) - item.quantity);
        await inv.save();
      }
    }
  }

  // 2. Post reversal journal entries (reverse of GRN entry)
  // GRN was: DR Inventory / CR GRNI
  // Return is: DR GRNI / CR Inventory
  const companyId = await resolveDocumentCompanyId({
    grnId: pr.goodsReceive,
    purchaseOrderId: pr.purchaseOrder,
    userId: req.user.id
  });
  const journalLines = [];
  for (const item of pr.items) {
    const invItem = item.inventoryItem;
    if (!invItem) continue;
    try {
      const { inventoryAccountId, grniAccountId } = await FinanceHelper.resolveInventoryAccounts(invItem, companyId);
      if (inventoryAccountId && grniAccountId) {
        const amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
        journalLines.push(
          { account: grniAccountId, description: `Return – ${item.itemName || invItem.name} (${pr.returnNumber})`, debit: amount, department: 'procurement' },
          { account: inventoryAccountId, description: `Stock reduction – ${item.itemName || invItem.name}`, credit: amount, department: 'procurement' }
        );
      }
    } catch (e) {
      console.warn('[PurchaseReturn] Account resolve error:', e.message);
    }
  }

  let journalEntry = null;
  if (journalLines.length > 0) {
    try {
      journalEntry = await FinanceHelper.createAndPostJournalEntry(
        withVoucherNarration(withCompany({
          date: pr.returnDate || new Date(),
          reference: pr.returnNumber,
          description: `Purchase Return ${pr.returnNumber}`,
          department: 'procurement',
          module: 'procurement',
          referenceId: pr._id,
          referenceType: 'purchase_return',
          journalCode: 'INV',
          createdBy: req.user.id,
          lines: journalLines
        }, companyId), getPurchaseReturnNarration(pr))
      );
    } catch (e) {
      console.warn('[PurchaseReturn] Journal entry failed:', e.message);
    }
  }

  pr.status = 'posted';
  pr.journalEntry = journalEntry?._id;
  pr.confirmedBy = req.user.id;
  pr.confirmedAt = new Date();
  await pr.save();

  res.json({ success: true, message: `Purchase return ${pr.returnNumber} confirmed and posted`, data: pr });
}));

// DELETE /api/procurement/purchase-returns/:id — delete draft
router.delete('/:id', authorize('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const pr = await PurchaseReturn.findById(req.params.id);
  if (!pr) return res.status(404).json({ success: false, message: 'Purchase return not found' });
  if (pr.status !== 'draft') return res.status(400).json({ success: false, message: 'Only draft returns can be deleted' });
  await pr.deleteOne();
  res.json({ success: true, message: 'Deleted' });
}));

module.exports = router;
