const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const CostCenter = require('../models/finance/CostCenter');
const { authorize } = require('../middleware/auth');
const { financeScope } = require('../utils/financeRouteScope');
const { asyncHandler } = require('../middleware/errorHandler');

// @route   GET /api/finance/cost-centers
// @desc    Get all cost centers for the active company
// @access  Private
router.get('/',
  authorize('super_admin', 'admin', 'finance_manager', 'accountant'),
  asyncHandler(async (req, res) => {
    const { companyId, q } = await financeScope(req);
    // Cost centers are managed on Store → Cost Center; make sure this company has a copy of each that applies to it
    if (companyId) {
      const { ensureFinanceCopiesForCompany } = require('../utils/costCenterLink');
      await ensureFinanceCopiesForCompany(companyId);
    }
    const costCenters = await CostCenter.find(q({})).sort({ code: 1 });
    
    res.json({
      success: true,
      data: costCenters
    });
  })
);

// @route   POST /api/finance/cost-centers
// @desc    Create a new cost center
// @access  Private
router.post('/',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('name').trim().notEmpty().withMessage('Cost Center name is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { companyId, q } = await financeScope(req);

    const costCenter = new CostCenter({
      companyId,
      name: req.body.name,
      description: req.body.description,
      isActive: req.body.isActive !== false
    });

    await costCenter.save();

    res.status(201).json({
      success: true,
      data: costCenter
    });
  })
);

// @route   PUT /api/finance/cost-centers/:id
// @desc    Update cost center
// @access  Private
router.put('/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  [
    body('name').optional().trim().notEmpty().withMessage('Cost Center name cannot be empty')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { companyId } = await financeScope(req);
    const costCenter = await CostCenter.findOne({ _id: req.params.id, companyId });
    
    if (!costCenter) {
      return res.status(404).json({ success: false, message: 'Cost Center not found' });
    }

    if (req.body.name) costCenter.name = req.body.name;
    if (req.body.description !== undefined) costCenter.description = req.body.description;
    if (req.body.isActive !== undefined) costCenter.isActive = req.body.isActive;

    await costCenter.save();

    res.json({
      success: true,
      data: costCenter
    });
  })
);

// @route   DELETE /api/finance/cost-centers/:id
// @desc    Delete cost center
// @access  Private
router.delete('/:id',
  authorize('super_admin', 'admin', 'finance_manager'),
  asyncHandler(async (req, res) => {
    const { q } = await financeScope(req);
    const costCenter = await CostCenter.findOneAndDelete(q({ _id: req.params.id }));
    
    if (!costCenter) {
      return res.status(404).json({ success: false, message: 'Cost Center not found' });
    }

    res.json({
      success: true,
      message: 'Cost Center deleted successfully'
    });
  })
);

module.exports = router;
