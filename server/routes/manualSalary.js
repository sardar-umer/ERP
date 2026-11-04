const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { isDesignatedCeoApprover } = require('../utils/executiveAccess');

const ManualSalary = require('../models/hr/ManualSalary');
const PlacementCompany = require('../models/hr/Company');
const manualSalaryAudit = require('../utils/manualSalaryAudit');

/** Audit helper errors carry statusCode */
const auditAction = (fn) => asyncHandler(async (req, res) => {
  try {
    const { record, message } = await fn(req);
    res.json({ success: true, message, data: await populateApprovers(ManualSalary.findById(record._id)) });
  } catch (err) {
    if (!err.statusCode) throw err;
    res.status(err.statusCode).json({ success: false, message: err.message });
  }
});

/** Company id from the form → { companyId, companyName }; null when missing / unknown */
const resolveCompany = async (companyId) => {
  if (!companyId || !require('mongoose').Types.ObjectId.isValid(String(companyId))) return null;
  const company = await PlacementCompany.findById(companyId).select('name').lean();
  return company ? { companyId: company._id, companyName: company.name } : null;
};

const optionalUserId = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

const actorSignature = (user, bodySig) =>
  bodySig
  || user?.digitalSignature
  || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.email || '');

const assertAssignee = (assigned, userId, label) => {
  if (!assigned) return null;
  const assignedId = assigned._id ? String(assigned._id) : String(assigned);
  if (assignedId !== String(userId)) {
    return `You are not the assigned ${label} for this record`;
  }
  return null;
};

const populateApprovers = (q) => q
  .populate('initiator', 'firstName lastName email digitalSignature')
  .populate('assignedHod', 'firstName lastName email digitalSignature')
  .populate('assignedAvp', 'firstName lastName email digitalSignature')
  .populate('hodApprovedBy', 'firstName lastName email digitalSignature')
  .populate('avpApprovedBy', 'firstName lastName email digitalSignature')
  .populate('ceoApprovedBy', 'firstName lastName email digitalSignature')
  .populate('preAuditInitialApprovedBy', 'firstName lastName email digitalSignature')
  .populate('auditApprovedBy', 'firstName lastName email digitalSignature')
  .populate('paidBy', 'firstName lastName email');

// @route   GET /api/hr/manual-salary
router.get('/', asyncHandler(async (req, res) => {
  const records = await populateApprovers(
    ManualSalary.find().sort({ year: -1, month: -1, createdAt: -1 })
  );
  res.status(200).json({ success: true, data: records });
}));

// @route   GET /api/hr/manual-salary/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const record = await populateApprovers(ManualSalary.findById(req.params.id));
  if (!record) {
    return res.status(404).json({ success: false, message: 'Record not found' });
  }
  res.status(200).json({ success: true, data: record });
}));

// @route   POST /api/hr/manual-salary
router.post('/', [
  body('name').notEmpty().withMessage('Name is required'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('Valid month is required'),
  body('year').isInt({ min: 2000, max: 2100 }).withMessage('Valid year is required'),
  body('assignedHod').notEmpty().withMessage('GM HR (HOD) is required'),
  body('assignedAvp').notEmpty().withMessage('AVP is required'),
  body('companyId').notEmpty().withMessage('Company is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  const company = await resolveCompany(req.body.companyId);
  if (!company) {
    return res.status(400).json({ success: false, message: 'Select a valid company' });
  }

  const payload = {
    ...req.body,
    initiator: req.user.id,
    initiatedAt: new Date(),
    requesterSignature: actorSignature(req.user, req.body.requesterSignature),
    assignedHod: optionalUserId(req.body.assignedHod),
    assignedAvp: optionalUserId(req.body.assignedAvp),
    ...company,
    workflowStatus: 'Pending HOD HR'
  };

  const record = await ManualSalary.create(payload);
  const populated = await populateApprovers(ManualSalary.findById(record._id));

  res.status(201).json({
    success: true,
    data: populated
  });
}));

// @route   PUT /api/hr/manual-salary/:id
router.put('/:id', [
  body('name').notEmpty().withMessage('Name is required'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('Valid month is required'),
  body('year').isInt({ min: 2000, max: 2100 }).withMessage('Valid year is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const existing = await ManualSalary.findById(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Record not found' });
  }

  const locked = [
    'Pending AVP',
    'Forwarded to CEO',
    'Approved by CEO',
    'Pending Audit',
    'Forwarded to Audit Director',
    'Pending Finance',
    'Payment Pending',
    'Paid'
  ].includes(existing.workflowStatus);
  const isAdmin = ['super_admin', 'admin', 'developer'].includes(req.user.role);
  if (locked && !isAdmin) {
    return res.status(400).json({
      success: false,
      message: `Cannot edit while status is ${existing.workflowStatus}`
    });
  }

  const update = { ...req.body };
  delete update.companyName;
  if (req.body.companyId !== undefined || !existing.companyId) {
    const company = await resolveCompany(req.body.companyId);
    if (!company) {
      return res.status(400).json({ success: false, message: 'Select a valid company' });
    }
    Object.assign(update, company);
  }
  if (req.body.assignedHod !== undefined) update.assignedHod = optionalUserId(req.body.assignedHod);
  if (req.body.assignedAvp !== undefined) update.assignedAvp = optionalUserId(req.body.assignedAvp);

  // Resubmit returned/draft back into HOD queue
  if (['Returned', 'Draft', 'Rejected by CEO'].includes(existing.workflowStatus)) {
    update.workflowStatus = 'Pending HOD HR';
  }

  const record = await ManualSalary.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true, runValidators: true }
  );

  const populated = await populateApprovers(ManualSalary.findById(record._id));

  res.status(200).json({
    success: true,
    data: populated
  });
}));

// @route   DELETE /api/hr/manual-salary/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const record = await ManualSalary.findById(req.params.id);
  if (!record) {
    return res.status(404).json({ success: false, message: 'Record not found' });
  }
  if (['Approved by CEO', 'Pending Audit', 'Forwarded to Audit Director', 'Pending Finance', 'Payment Pending', 'Paid', 'Forwarded to CEO', 'Pending AVP'].includes(record.workflowStatus)) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete while status is ${record.workflowStatus}`
    });
  }
  await record.deleteOne();
  res.status(200).json({ success: true, data: {} });
}));

// ─── Workflow actions ─────────────────────────────────────────────────────────

router.put('/:id/approve-hod', asyncHandler(async (req, res) => {
  const record = await ManualSalary.findById(req.params.id);
  if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
  if (record.workflowStatus !== 'Pending HOD HR') {
    return res.status(400).json({ success: false, message: `Invalid status: ${record.workflowStatus}` });
  }
  const deny = assertAssignee(record.assignedHod, req.user.id, 'GM HR');
  if (deny && !['super_admin', 'admin', 'developer'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: deny });
  }

  record.workflowStatus = 'Pending AVP';
  record.hodApprovedBy = req.user.id;
  record.hodApprovedAt = new Date();
  record.hodComments = req.body.comments || '';
  record.hodSignature = actorSignature(req.user, req.body.signature);
  await record.save();

  res.json({ success: true, data: await populateApprovers(ManualSalary.findById(record._id)) });
}));

router.put('/:id/reject-hod', asyncHandler(async (req, res) => {
  const record = await ManualSalary.findById(req.params.id);
  if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
  if (record.workflowStatus !== 'Pending HOD HR') {
    return res.status(400).json({ success: false, message: `Invalid status: ${record.workflowStatus}` });
  }
  const deny = assertAssignee(record.assignedHod, req.user.id, 'GM HR');
  if (deny && !['super_admin', 'admin', 'developer'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: deny });
  }

  record.workflowStatus = 'Returned';
  record.hodApprovedBy = req.user.id;
  record.hodApprovedAt = new Date();
  record.hodComments = req.body.comments || '';
  record.rejectionComments = req.body.comments || '';
  record.hodSignature = actorSignature(req.user, req.body.signature);
  await record.save();

  res.json({ success: true, data: await populateApprovers(ManualSalary.findById(record._id)) });
}));

router.put('/:id/approve-avp', asyncHandler(async (req, res) => {
  const record = await ManualSalary.findById(req.params.id);
  if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
  if (record.workflowStatus !== 'Pending AVP') {
    return res.status(400).json({ success: false, message: `Invalid status: ${record.workflowStatus}` });
  }
  const deny = assertAssignee(record.assignedAvp, req.user.id, 'AVP');
  if (deny && !['super_admin', 'admin', 'developer'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: deny });
  }

  // GM HR → AVP Taj → Audit → Finance (no CEO step)
  record.avpApprovedBy = req.user.id;
  record.avpApprovedAt = new Date();
  record.avpComments = req.body.comments || '';
  record.avpSignature = actorSignature(req.user, req.body.signature);
  await manualSalaryAudit.sendToAudit(record, req.user.id, req.body.comments ? `AVP: ${req.body.comments}` : 'AVP approved — sent to Audit');

  res.json({ success: true, message: 'AVP approved — sent to Audit', data: await populateApprovers(ManualSalary.findById(record._id)) });
}));

router.put('/:id/reject-avp', asyncHandler(async (req, res) => {
  const record = await ManualSalary.findById(req.params.id);
  if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
  if (record.workflowStatus !== 'Pending AVP') {
    return res.status(400).json({ success: false, message: `Invalid status: ${record.workflowStatus}` });
  }
  const deny = assertAssignee(record.assignedAvp, req.user.id, 'AVP');
  if (deny && !['super_admin', 'admin', 'developer'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: deny });
  }

  record.workflowStatus = 'Returned';
  record.avpApprovedBy = req.user.id;
  record.avpApprovedAt = new Date();
  record.avpComments = req.body.comments || '';
  record.rejectionComments = req.body.comments || '';
  record.avpSignature = actorSignature(req.user, req.body.signature);
  await record.save();

  res.json({ success: true, data: await populateApprovers(ManualSalary.findById(record._id)) });
}));

router.put('/:id/approve-ceo', asyncHandler(async (req, res) => {
  const record = await ManualSalary.findById(req.params.id);
  if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
  if (record.workflowStatus !== 'Forwarded to CEO') {
    return res.status(400).json({ success: false, message: `Invalid status: ${record.workflowStatus}` });
  }
  if (!isDesignatedCeoApprover(req.user)) {
    return res.status(403).json({ success: false, message: 'CEO approval access required' });
  }

  // CEO step is no longer part of the flow; records already waiting on the CEO go on to Audit
  record.ceoApprovedBy = req.user.id;
  record.ceoApprovedAt = new Date();
  record.ceoComments = req.body.comments || '';
  record.ceoSignature = actorSignature(req.user, req.body.signature);
  await manualSalaryAudit.sendToAudit(record, req.user.id, 'CEO approved — sent to Audit');

  res.json({
    success: true,
    message: 'CEO approved — sent to Audit.',
    data: await populateApprovers(ManualSalary.findById(record._id))
  });
}));

router.put('/:id/reject-ceo', asyncHandler(async (req, res) => {
  const record = await ManualSalary.findById(req.params.id);
  if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
  if (record.workflowStatus !== 'Forwarded to CEO') {
    return res.status(400).json({ success: false, message: `Invalid status: ${record.workflowStatus}` });
  }
  if (!isDesignatedCeoApprover(req.user)) {
    return res.status(403).json({ success: false, message: 'CEO approval access required' });
  }

  record.workflowStatus = 'Rejected by CEO';
  record.ceoApprovedBy = req.user.id;
  record.ceoApprovedAt = new Date();
  record.rejectionComments = req.body.comments || '';
  record.ceoSignature = actorSignature(req.user, req.body.signature);
  await record.save();

  res.json({ success: true, data: await populateApprovers(ManualSalary.findById(record._id)) });
}));

router.put('/:id/return-ceo', asyncHandler(async (req, res) => {
  const record = await ManualSalary.findById(req.params.id);
  if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
  if (record.workflowStatus !== 'Forwarded to CEO') {
    return res.status(400).json({ success: false, message: `Invalid status: ${record.workflowStatus}` });
  }
  if (!isDesignatedCeoApprover(req.user) && !['super_admin', 'admin', 'developer'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'CEO return access required' });
  }

  record.workflowStatus = 'Returned';
  record.returnComments = req.body.comments || '';
  await record.save();

  res.json({ success: true, data: await populateApprovers(ManualSalary.findById(record._id)) });
}));

// ─── Audit (after AVP) — also driven from the Pre-Audit screen ────────────────

// @route   PUT /api/hr/manual-salary/:id/audit-approve — initial pre-audit approval, then Audit Director final → Finance
router.put('/:id/audit-approve', auditAction((req) =>
  manualSalaryAudit.auditApprove(req.params.id, req.user, req.body.approvalComments || req.body.comments || '')));

// @route   PUT /api/hr/manual-salary/:id/forward-to-audit-director
router.put('/:id/forward-to-audit-director', auditAction((req) =>
  manualSalaryAudit.forwardToAuditDirector(req.params.id, req.user, req.body.forwardComments || req.body.comments || '')));

// @route   PUT /api/hr/manual-salary/:id/audit-return (and audit-reject — same: back to HR)
const auditReturnHandler = auditAction((req) => manualSalaryAudit.auditReturn(req.params.id, req.user, {
  comments: req.body.returnComments || req.body.rejectionComments || req.body.comments || '',
  observations: req.body.observations
}));
router.put('/:id/audit-return', auditReturnHandler);
router.put('/:id/audit-reject', auditReturnHandler);

module.exports = router;
