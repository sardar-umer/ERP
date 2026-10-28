const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authorize } = require('../middleware/auth');
const PayrollTaxSettings = require('../models/hr/PayrollTaxSettings');
const Employee = require('../models/hr/Employee');
const {
  ALLOWANCE_TAX_KEYS,
  normalizeSettings
} = require('../utils/allowanceTaxCalculator');
const { syncDraftPayrollsTaxFromSettings } = require('../utils/allowanceHelpers');

const router = express.Router();

const HR_ROLES = ['super_admin', 'admin', 'hr_manager'];

router.get(
  '/',
  authorize(...HR_ROLES),
  asyncHandler(async (req, res) => {
    const doc = await PayrollTaxSettings.getOrCreate();
    const settings = normalizeSettings(doc.toObject());

    res.json({
      success: true,
      data: {
        ...settings,
        _id: doc._id,
        updatedAt: doc.updatedAt,
        updatedBy: doc.updatedBy
      }
    });
  })
);

router.put(
  '/',
  authorize(...HR_ROLES),
  [
    body('salaryMedicalExemptPercent')
      .optional()
      .isFloat({ min: 0, max: 100 }),
    body('applyScope').optional().isIn(['all', 'selected']),
    body('selectedEmployeeIds').optional().isArray(),
    body('allowancePolicies').optional().isObject()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const doc = await PayrollTaxSettings.getOrCreate();
    const incoming = normalizeSettings({
      salaryMedicalExemptPercent: req.body.salaryMedicalExemptPercent,
      applyScope: req.body.applyScope,
      selectedEmployeeIds: req.body.selectedEmployeeIds,
      allowancePolicies: req.body.allowancePolicies
    });

    doc.salaryMedicalExemptPercent = incoming.salaryMedicalExemptPercent;
    doc.applyScope = incoming.applyScope;
    doc.selectedEmployeeIds = incoming.selectedEmployeeIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    doc.allowancePolicies = incoming.allowancePolicies;
    // Mixed fields must be explicitly marked modified or Mongoose skips them on save
    doc.markModified('allowancePolicies');
    doc.updatedBy = req.user?.id || req.user?._id;
    await doc.save();

    const syncResult = await syncDraftPayrollsTaxFromSettings(doc.toObject());

    res.json({
      success: true,
      message: `Tax settings saved. ${syncResult.updated} draft payroll(s) updated.`,
      data: {
        settings: normalizeSettings(doc.toObject()),
        draftPayrollsUpdated: syncResult.updated
      }
    });
  })
);

router.get(
  '/meta',
  authorize(...HR_ROLES),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        allowanceKeys: ALLOWANCE_TAX_KEYS,
        allowanceLabels: {
          conveyance: 'Conveyance',
          food: 'Food',
          mobile: 'Mobile',
          vehicle: 'Vehicle',
          fuel: 'Fuel',
          medical: 'Medical',
          houseRent: 'House Rent',
          special: 'Special',
          other: 'Other'
        },
        modes: [
          { value: 'taxable', label: 'Fully taxable' },
          { value: 'fully_exempt', label: 'Fully exempt' },
          { value: 'partial_exempt', label: 'Partially exempt' }
        ]
      }
    });
  })
);

router.get(
  '/employees',
  authorize(...HR_ROLES),
  asyncHandler(async (req, res) => {
    const { search, active = 'true' } = req.query;
    const query = { isDeleted: false };
    if (active === 'true') query.isActive = true;
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    const employees = await Employee.find(query)
      .select('firstName lastName employeeId isActive')
      .sort({ employeeId: 1 })
      .limit(2000);

    res.json({ success: true, data: employees });
  })
);

module.exports = router;
