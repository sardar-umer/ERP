const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const { authorize } = require('../middleware/auth');
const PurchaseReturn = require('../models/procurement/PurchaseReturn');
const { ReturnError, returnableLines, buildReturnItems, validateReturn, postPurchaseReturn } = require('../utils/purchaseReturnPosting');

const RETURN_ROLES = ['super_admin', 'admin', 'procurement_manager'];
const sendReturnError = (res, err) => {
  if (err instanceof ReturnError) return res.status(err.statusCode || 400).json({ success: false, message: err.message });
  throw err;
};

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

// GET /api/procurement/purchase-returns/grn/:grnId/returnable — what can still go back to the vendor
router.get('/grn/:grnId/returnable', asyncHandler(async (req, res) => {
  try {
    const data = await returnableLines(req.params.grnId);
    res.json({ success: true, data });
  } catch (err) { sendReturnError(res, err); }
}));

// POST /api/procurement/purchase-returns/from-grn — create and post a return from GRN lines in one step
router.post('/from-grn', authorize(...RETURN_ROLES), asyncHandler(async (req, res) => {
  const { goodsReceive, items, reason, notes, returnDate, creditNoteNumber } = req.body;
  let pr;
  try {
    const { info, items: built } = await buildReturnItems(goodsReceive, items);
    await validateReturn(goodsReceive, built);
    pr = await PurchaseReturn.create({
      goodsReceive: info.grnId,
      purchaseOrder: info.purchaseOrder,
      supplier: info.supplier,
      supplierName: info.supplierName,
      returnDate: returnDate || new Date(),
      items: built,
      reason: reason || 'other',
      notes,
      creditNoteNumber,
      createdBy: req.user.id
    });
    await postPurchaseReturn(pr, req.user.id);
  } catch (err) {
    // A return that could not post is not left behind as a stray draft
    if (pr && pr.status === 'draft') await PurchaseReturn.deleteOne({ _id: pr._id, status: 'draft' });
    return sendReturnError(res, err);
  }
  res.status(201).json({ success: true, message: `Return ${pr.returnNumber} posted — stock reduced and GRN updated`, data: pr });
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

// POST /api/procurement/purchase-returns — create draft return (lines must come from the GRN)
router.post('/', authorize(...RETURN_ROLES), asyncHandler(async (req, res) => {
  const { goodsReceive, returnDate, items, reason, notes } = req.body;
  try {
    const { info, items: built } = await buildReturnItems(goodsReceive, items);
    const pr = await PurchaseReturn.create({
      goodsReceive: info.grnId,
      purchaseOrder: info.purchaseOrder,
      supplier: info.supplier,
      supplierName: info.supplierName,
      returnDate, items: built, reason, notes,
      createdBy: req.user.id
    });
    res.status(201).json({ success: true, data: pr });
  } catch (err) { sendReturnError(res, err); }
}));

// PUT /api/procurement/purchase-returns/:id — update draft
router.put('/:id', authorize('super_admin', 'admin', 'procurement_manager'), asyncHandler(async (req, res) => {
  const pr = await PurchaseReturn.findById(req.params.id);
  if (!pr) return res.status(404).json({ success: false, message: 'Purchase return not found' });
  if (pr.status !== 'draft') return res.status(400).json({ success: false, message: 'Only draft returns can be edited' });

  if (req.body.items !== undefined) {
    try {
      pr.items = (await buildReturnItems(pr.goodsReceive, req.body.items)).items;
    } catch (err) { return sendReturnError(res, err); }
  }
  ['reason', 'notes', 'returnDate', 'creditNoteNumber'].forEach(f => { if (req.body[f] !== undefined) pr[f] = req.body[f]; });
  pr.updatedBy = req.user.id;
  await pr.save();

  res.json({ success: true, data: pr });
}));

// POST /api/procurement/purchase-returns/:id/confirm — validate, post journal, reduce stock, update GRN
router.post('/:id/confirm', authorize(...RETURN_ROLES), asyncHandler(async (req, res) => {
  const pr = await PurchaseReturn.findById(req.params.id);
  if (!pr) return res.status(404).json({ success: false, message: 'Purchase return not found' });
  try {
    await postPurchaseReturn(pr, req.user.id);
  } catch (err) { return sendReturnError(res, err); }
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
